// GitHub API 反向代理 — EdgeOne Pages Edge Function
// 路由: /api/github/<path> -> https://api.github.com/<path>
// 鉴权: x-proxy-key 请求头 或 ?key= 查询参数（不透传给 GitHub）
// GitHub token: 优先 HACS China 共享池（内存缓存 30min），兑底环境变量 GH_TOKEN
import { getGithubToken, invalidateGithubToken } from '../lib/github-token.js';

const UPSTREAM = 'https://api.github.com';

// 不透传给上游的请求头
const STRIP_REQ_HEADERS = new Set([
  'host', 'connection', 'content-length', 'transfer-encoding',
  'accept-encoding', 'x-proxy-key', 'x-forwarded-for',
  'x-forwarded-proto', 'x-forwarded-host', 'cf-connecting-ip',
  'x-real-ip', 'eo-connecting-ip',
]);

// UA 白名单：只放行包含该子串的请求
const ALLOWED_UA_SUBSTRING = 'HomeAssistantMarketplace';

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

  // UA 白名单：必须包含 HomeAssistantMarketplace
  const ua = request.headers.get('user-agent') || '';
  if (!ua.includes(ALLOWED_UA_SUBSTRING)) {
    return jsonError(403, 'user-agent not allowed');
  }

  // ---- 鉴权 ----
  if (!env.PROXY_KEY) {
    return jsonError(503, 'proxy not configured: PROXY_KEY env missing');
  }

  // ---- 目标路径（先解析，后验 key，保证错误语义不受顺序影响）----
  // 路由为 /api/[[default]]，需自行校验第一段必须是 github：/api/github/<path>
  const segments = Array.isArray(params.default) ? params.default : [params.default || ''];
  if (segments[0] !== 'github') {
    return jsonError(404, 'unknown api scope: use /api/github/<path>');
  }
  const path = segments.slice(1).join('/');
  if (!path) {
    return jsonError(400, 'empty path');
  }
  const key = request.headers.get('x-proxy-key') || url.searchParams.get('key');
  if (!key || key !== env.PROXY_KEY) {
    return jsonError(401, 'unauthorized');
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
  // User-Agent 透传客户端原始值（已通过白名单校验）；GitHub 强制要求 UA，兜底中性值
  headers.set('User-Agent', request.headers.get('user-agent') || 'gh-api-proxy');
  headers.set('Accept', request.headers.get('accept') || 'application/vnd.github+json');
  const token = await getGithubToken(env);
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
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

  // 共享 token 撞 401/403（额度尽/被吊销）时清缓存，下个请求重新从池里拉
  if (upstream.status === 401 || upstream.status === 403) {
    invalidateGithubToken();
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
