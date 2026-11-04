// GitHub reverse proxy (gh-proxy style) / GitHub 全站反向代理（gh-proxy 风格）
// EdgeOne Pages Edge Function
//
// Usage / 用法: append the full GitHub URL after this service's domain
// 把完整 GitHub URL 拼在本服务域名后面
//   /https://api.github.com/<path>                    -> API (shared-pool token auto-attached / 自动附共享池 token)
//   /https://github.com/<owner>/<repo>/releases/...   -> release assets, follows 302 / release 资产（跟随 302）
//   /https://raw.githubusercontent.com/<...>          -> repo files / 仓库文件
//   /https://codeload.github.com/<...>                -> source archives / 源码包
//   /https://gist.githubusercontent.com/<...>         -> gist files / gist 文件
//
// Auth / 鉴权: UA must contain HomeAssistantMarketplace; non-GitHub hosts rejected
// UA 须含 HomeAssistantMarketplace；非 GitHub 域名拒绝
//
// Downloads are streamed (no buffering) with Range resume support; no accept-encoding is sent.
// 下载流式转发（不缓冲），支持 Range 断点续传；不声明 accept-encoding。

import { getGithubToken, invalidateGithubToken } from './lib/github-token.js';
import { startDeviceFlow, pollDeviceFlow } from './lib/device-flow.js';

// Upstream hosts allowed through the proxy / 允许代理的上游域名
// NOTE: raw.githubusercontent.com (Fastly 185.199.x) is unreachable from EdgeOne egress,
// so /https://raw.githubusercontent.com/... URLs are transparently remapped to the official
// Contents API on api.github.com (reachable; raw media type returns file bytes).
// 注：EdgeOne 出口连不上 Fastly 托管的 raw.githubusercontent.com，
// raw 路径自动改走 api.github.com 上的官方 Contents API（可达；raw 媒体类型返回文件本体）
const ALLOWED_HOSTS = new Set([
  'api.github.com',
  'github.com',
  'www.github.com',
  'raw.githubusercontent.com',
  'codeload.github.com',
  'gist.github.com',
  'gist.githubusercontent.com',
  'objects.githubusercontent.com',
]);

// UA whitelist: only requests containing this substring pass / UA 白名单：只放行包含该子串的请求
const ALLOWED_UA_SUBSTRING = 'HomeAssistantMarketplace';

// Hop-by-hop and proxy-internal request headers, not forwarded upstream
// 逐跳头 + 代理自身头，不透传给上游
// NOTE: the upstream fetch MUST carry an explicit Host header — the EdgeOne runtime routes
// by Host instead of deriving it from the URL; omitting it fails every upstream request (site-wide 502).
// 注：上游 fetch 必须显式带 Host 头——EdgeOne 运行时按 Host 路由而非从 URL 派生，
// 缺失会导致所有上游请求失败（全站 502）
const STRIP_REQ_HEADERS = new Set([
  'host', 'connection', 'content-length', 'transfer-encoding',
  'accept-encoding', 'x-forwarded-for',
  'x-forwarded-proto', 'x-forwarded-host', 'cf-connecting-ip',
  'x-real-ip', 'eo-connecting-ip', 'authorization',
]);

// Hop-by-hop / platform-injected response headers, not forwarded to the client
// 逐跳头 + 平台注入的响应头，不透传给客户端
const STRIP_RES_HEADERS = new Set([
  'connection', 'transfer-encoding', 'content-encoding', 'content-length',
  'content-type',
]);

// Uniform JSON error; details are deliberately vague to avoid leaking proxy internals
// 统一 JSON 错误；信息刻意模糊，避免暴露代理内部逻辑
function jsonError(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
    },
  });
}

// CORS headers for browser clients / 浏览器客户端的 CORS 头
function withCors(headers) {
  headers.set('access-control-allow-origin', '*');
  headers.set('access-control-allow-headers', 'authorization, content-type, range');
  headers.set('access-control-allow-methods', 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS');
  headers.set('access-control-expose-headers', 'content-length, content-range, etag, last-modified');
  return headers;
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const url = new URL(request.url);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: withCors(new Headers()) });
  }

  // Token-sharing Device Flow endpoints (before the UA gate: they are browser-facing pages' APIs,
  // guarded by same-origin referer checks inside the handlers)
  // Token 共享的 Device Flow 端点（放在 UA 门禁之前：这是给浏览器页面用的 API，
  // 由 handler 内部的同源 referer 校验保护）
  if (url.pathname === '/share/device/start' && request.method === 'POST') {
    return startDeviceFlow(request, env);
  }
  if (url.pathname === '/share/device/poll' && request.method === 'POST') {
    return pollDeviceFlow(request, env);
  }

  // Non-proxy paths that look like pages should fall through to static assets
  // (the catch-all below only handles /https://... prefixed proxy requests)
  // 看起来是页面的非代理路径继续走静态资源（下方 catch-all 只处理 /https://… 前缀的代理请求）
  if (!/^https?:/i.test(url.pathname.slice(1))) {
    return context.next();
  }

  // UA whitelist check / UA 白名单校验
  const ua = request.headers.get('user-agent') || '';
  if (!ua.includes(ALLOWED_UA_SUBSTRING)) {
    return jsonError(403, 'not allowed');
  }

  // ---- Target URL / 解析目标 URL: /https://github.com/... ----
  // Some HTTP clients collapse "//" into "/" in the path; repair the scheme first
  // 部分 HTTP 客户端会把路径里的 // 折叠成 /，先修复 scheme
  let raw = url.pathname.slice(1).replace(/^(https?):\/(?!\/)/i, '$1://');
  raw += url.search; // inner URL query rides on the outer request's search / 内层 URL 的查询参数在外层请求的 search 里
  let target;
  try {
    target = new URL(raw);
  } catch (e) {
    return jsonError(404, 'not found');
  }
  if (!ALLOWED_HOSTS.has(target.hostname)) {
    return jsonError(403, 'not allowed');
  }

  // raw.githubusercontent.com remap / raw 域名改走官方 Contents API
  // EdgeOne egress cannot reach Fastly-hosted raw.githubusercontent.com (nor third-party mirrors);
  // GitHub's Contents API lives on api.github.com (reachable) and serves file bytes with the raw media type.
  //   /https://raw.githubusercontent.com/<owner>/<repo>/<ref>/<path...>
  //     -> https://api.github.com/repos/<owner>/<repo>/contents/<path...>?ref=<ref>
  // EdgeOne 出口连不上 Fastly 托管的 raw.githubusercontent.com（第三方镜像同样被拦），
  // 改走官方 Contents API（在可达的 api.github.com 上，还能附共享池 token）
  let rawRemap = false;
  if (target.hostname === 'raw.githubusercontent.com') {
    const segs = target.pathname.replace(/^\/+/, '').split('/');
    if (segs.length >= 4) {
      const [owner, repo, ref, ...rest] = segs;
      const path = rest.map(encodeURIComponent).join('/');
      target = new URL(`https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`);
      rawRemap = true;
    }
  }
  // Never forward proxy-internal params upstream / 代理内部参数不透传给上游
  target.searchParams.delete('key');

  // ---- Upstream request headers / 构造上游请求头 ----
  const headers = new Headers();
  for (const [k, v] of request.headers.entries()) {
    if (!STRIP_REQ_HEADERS.has(k.toLowerCase())) {
      headers.set(k, v);
    }
  }
  // EdgeOne runtime routes the upstream fetch by the Host header (not derived from the URL);
  // without it every upstream request fails (site-wide 502). / EdgeOne 运行时按 Host 头路由上游
  // 请求（不会从 URL 派生），缺 Host 会导致所有上游请求失败（全站 502）
  headers.set('Host', target.host);
  headers.set('User-Agent', ua); // already whitelist-approved, forward as-is / 已过白名单，直接透传

  const isApi = target.hostname === 'api.github.com';
  if (isApi) {
    // raw remap → Contents API: request the raw media type to get file bytes, not JSON metadata
    // raw 重映射 → Contents API：用 raw 媒体类型拿文件本体而非 JSON 元数据
    headers.set('Accept', rawRemap ? 'application/vnd.github.raw' : (request.headers.get('accept') || 'application/vnd.github+json'));
    // API uses the shared token pool (download endpoints don't consume API quota)
    // API 走共享池 token（下载类端点不占 API 配额）
    const token = await getGithubToken();
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
  }

  let upstream;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
      redirect: 'follow', // release assets 302 to objects.githubusercontent.com / release 资产 302 到 objects.githubusercontent.com
    });
  } catch (e) {
    // Single retry for transient upstream failures / 单次重试应对上游偶发失败
    try {
      upstream = await fetch(target, {
        method: request.method,
        headers,
        body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
        redirect: 'follow',
      });
    } catch (e2) {
      return jsonError(502, 'upstream error');
    }
  }

  // Shared token rejected (quota exhausted / revoked): drop cache, next request fetches a fresh one
  // 共享 token 被拒（额度尽/被吊销）：清缓存，下个请求换新 token
  if (isApi && (upstream.status === 401 || upstream.status === 403)) {
    invalidateGithubToken();
  }

  const resHeaders = new Headers();
  for (const [k, v] of upstream.headers.entries()) {
    if (!STRIP_RES_HEADERS.has(k.toLowerCase())) {
      resHeaders.set(k, v);
    }
  }
  // We stripped content-encoding (edge re-compresses); set a safe content-type by status.
  // Body was decoded by fetch, so no binary/charset mismatch can leak through.
  // content-type 已随 content-encoding 一并剥离（fetch 已解压 body），按状态码重置，避免边缘对解码后的 body 误判
  if (!resHeaders.has('content-type')) {
    resHeaders.set('content-type', upstream.status < 400 ? 'application/octet-stream' : 'text/plain');
  }
  withCors(resHeaders);

  // Stream the body through: function CPU doesn't grow with size (CPU limit excludes I/O wait)
  // 流式透传 body：函数 CPU 不随体积增长（CPU 限制不含 I/O 等待）
  return new Response(upstream.body, {
    status: upstream.status,
    headers: resHeaders,
  });
}
