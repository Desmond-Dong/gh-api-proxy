// GitHub 资源下载代理 — EdgeOne Pages Edge Function
// 路由映射（全部流式转发，不缓冲）:
//   /gh/raw/<path>       -> https://raw.githubusercontent.com/<path>
//   /gh/archive/<path>   -> https://codeload.github.com/<path>
//   /gh/dl/<path>        -> https://github.com/<path>   (跟随 302 到 release 资产 CDN)
//   /gh/gist/<path>      -> https://gist.githubusercontent.com/<path>
// 鉴权: x-proxy-key 请求头 或 ?key= 查询参数（不透传给上游）
// 支持 Range（断点续传）；不发送 accept-encoding，上游按原始格式返回

const HOSTS = {
  raw: 'https://raw.githubusercontent.com',
  archive: 'https://codeload.github.com',
  dl: 'https://github.com',
  gist: 'https://gist.githubusercontent.com',
};

// 逐跳头 + 代理自身头，不透传
const STRIP_REQ_HEADERS = new Set([
  'host', 'connection', 'content-length', 'transfer-encoding',
  'accept-encoding', 'x-proxy-key', 'x-forwarded-for',
  'x-forwarded-proto', 'x-forwarded-host', 'cf-connecting-ip',
  'x-real-ip', 'eo-connecting-ip',
]);

const STRIP_RES_HEADERS = new Set([
  'connection', 'transfer-encoding', 'content-encoding', 'content-length',
]);

function jsonError(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
    },
  });
}

function withCors(headers) {
  headers.set('access-control-allow-origin', '*');
  headers.set('access-control-allow-headers', 'authorization, content-type, x-proxy-key, range');
  headers.set('access-control-allow-methods', 'GET, HEAD, OPTIONS');
  headers.set('access-control-expose-headers', 'content-length, content-range, etag, last-modified');
  return headers;
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const url = new URL(request.url);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: withCors(new Headers()) });
  }

  if (!env.PROXY_KEY) {
    return jsonError(503, 'proxy not configured: PROXY_KEY env missing');
  }
  const key = request.headers.get('x-proxy-key') || url.searchParams.get('key');
  if (!key || key !== env.PROXY_KEY) {
    return jsonError(401, 'unauthorized');
  }

  const segments = Array.isArray(params.default) ? params.default : [params.default || ''];
  const [scope, ...rest] = segments;
  const upstreamBase = HOSTS[scope];
  if (!upstreamBase) {
    return jsonError(404, `unknown scope: use /gh/raw|archive|dl|gist/<path>`);
  }
  const path = rest.join('/');
  if (!path) {
    return jsonError(400, 'empty path');
  }
  const search = new URLSearchParams(url.search);
  search.delete('key');
  const qs = search.toString();
  const target = `${upstreamBase}/${path}${qs ? '?' + qs : ''}`;

  const headers = new Headers();
  for (const [k, v] of request.headers.entries()) {
    if (!STRIP_REQ_HEADERS.has(k.toLowerCase())) {
      headers.set(k, v);
    }
  }
  // UA 兜底（GitHub 强制要求）；不声明 accept-encoding，避免压缩流
  headers.set('User-Agent', request.headers.get('user-agent') || 'gh-api-proxy');

  let upstream;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      redirect: 'follow', // dl 路径依赖：release 资产 302 到 objects.githubusercontent.com
    });
  } catch (e) {
    return jsonError(502, 'upstream fetch failed');
  }

  const resHeaders = new Headers();
  for (const [k, v] of upstream.headers.entries()) {
    if (!STRIP_RES_HEADERS.has(k.toLowerCase())) {
      resHeaders.set(k, v);
    }
  }
  withCors(resHeaders);

  // 流式透传 body：CPU 不随体积增长（CPU 限制不含 I/O 等待）
  return new Response(upstream.body, {
    status: upstream.status,
    headers: resHeaders,
  });
}
