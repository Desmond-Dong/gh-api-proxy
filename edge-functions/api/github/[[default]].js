// GitHub API 反向代理 — EdgeOne Pages Edge Function
// 路由: /api/github/<path> -> https://api.github.com/<path>
// 鉴权: x-proxy-key 请求头 或 ?key= 查询参数（不透传给 GitHub）

const UPSTREAM = 'https://api.github.com';

// 不透传给上游的请求头
const STRIP_REQ_HEADERS = new Set([
  'host', 'connection', 'content-length', 'transfer-encoding',
  'accept-encoding', 'x-proxy-key', 'x-forwarded-for',
  'x-forwarded-proto', 'x-forwarded-host', 'cf-connecting-ip',
  'x-real-ip', 'eo-connecting-ip',
]);

// 不透传给客户端的响应头（逐跳头 + 平台注入的头）
const STRIP_RES_HEADERS = new Set([
  'connection', 'transfer-encoding', 'content-encoding', 'content-length',
]);

function jsonError(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization, content-type, x-proxy-key',
      'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS',
    },
  });
}

function withCors(headers) {
  headers.set('access-control-allow-origin', '*');
  headers.set('access-control-allow-headers', 'authorization, content-type, x-proxy-key');
  headers.set('access-control-allow-methods', 'GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS');
  return headers;
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const url = new URL(request.url);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: withCors(new Headers()) });
  }

  // ---- 鉴权 ----
  if (!env.PROXY_KEY) {
    return jsonError(503, 'proxy not configured: PROXY_KEY env missing');
  }
  const key = request.headers.get('x-proxy-key') || url.searchParams.get('key');
  if (!key || key !== env.PROXY_KEY) {
    return jsonError(401, 'unauthorized');
  }

  // ---- 目标路径 ----
  const path = Array.isArray(params.default) ? params.default.join('/') : (params.default || '');
  if (!path) {
    return jsonError(400, 'empty path');
  }
  // key 不透传给 GitHub
  const search = new URLSearchParams(url.search);
  search.delete('key');
  const qs = search.toString();
  const target = `${UPSTREAM}/${path}${qs ? '?' + qs : ''}`;

  // ---- 构造上游请求头 ----
  const headers = new Headers();
  for (const [k, v] of request.headers.entries()) {
    if (!STRIP_REQ_HEADERS.has(k.toLowerCase())) {
      headers.set(k, v);
    }
  }
  headers.set('Host', 'api.github.com');
  // User-Agent 透传客户端原始值；GitHub 强制要求 UA，客户端未携带时用中性兜底
  headers.set('User-Agent', request.headers.get('user-agent') || 'gh-api-proxy');
  headers.set('Accept', request.headers.get('accept') || 'application/vnd.github+json');
  if (env.GH_TOKEN) {
    headers.set('Authorization', `Bearer ${env.GH_TOKEN}`);
  }

  let upstream;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
      redirect: 'manual',
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
  // GitHub 返回 content-encoding 压缩数据但边缘会重新压缩，剥离后由平台自行协商
  resHeaders.delete('content-encoding');
  withCors(resHeaders);

  return new Response(upstream.body, {
    status: upstream.status,
    headers: resHeaders,
  });
}
