// GitHub OAuth Device Flow endpoints for the token sharing page
// Token 共享页的 GitHub OAuth Device Flow 端点
//
// POST /share/device/start  -> ask GitHub for a device + user code (visitor enters it at github.com/login/device)
// POST /share/device/poll   -> poll GitHub for the token; on success validate via /user and hand the
//                              masked profile back to the page. The raw token NEVER reaches the browser.
//                              用 GitHub 换取 token，成功后经 /user 验证并把脱敏档案回给页面。
//                              Token 明文永远不回到浏览器。
//
// Required environment variables / 需要的环境变量:
//   Client_ID      - OAuth App client id (public by design / 本身就是公开的)
//   Client_Secret  - OAuth App client secret (configured in the EdgeOne console / 在 EdgeOne 控制台配置)

const GITHUB_DEVICE_CODE_URL = 'https://github.com/login/device/code';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_USER_URL = 'https://api.github.com/user';

const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'cache-control': 'no-store',
};

function json(status, payload) {
  return new Response(JSON.stringify(payload), { status, headers: { ...jsonHeaders } });
}

// Vague errors on purpose: do not leak internals / 刻意模糊的错误，不暴露内部细节
function err(status, code) {
  return json(status, { error: code });
}

async function readJsonBody(request) {
  try {
    const data = await request.json();
    return data && typeof data === 'object' ? data : {};
  } catch (e) {
    return {};
  }
}

// ---- POST /share/device/start ----
// Returns: { user_code, verification_uri, expires_in, interval }
// 绝不向页面下发 device_code（那是服务端与 GitHub 之间的凭据），轮询由服务端代持。
// The device_code (a server-side credential for GitHub) is never sent to the page;
// polling is proxied server-side, keyed by an opaque session id.
// Server-side session store for pending device flows.
// KV is not provisioned yet — use in-isolate memory with TTL cleanup (single-isolate behavior is
// acceptable for the preview phase; sessions are short-lived by design, ≤15min).
// When EdgeOne KV lands, swap this object for the KV namespace binding (same get/put/delete shape).
// Device Flow 会话暂存。KV 未开通前用 isolate 内存 + 过期清理（预览阶段可接受；会话天生短命 ≤15 分钟）。
// EdgeOne KV 就绪后把此对象换成 KV 命名空间绑定（get/put/delete 同形替换）。
const DEVFLOW_STORE = {
  _m: new Map(),
  async put(k, v, opts) {
    this._m.set(k, { v, exp: Date.now() + ((opts && opts.expirationTtl) || 900) * 1000 });
    if (this._m.size > 500) this._sweep();
  },
  async get(k) {
    const e = this._m.get(k);
    if (!e) return null;
    if (Date.now() > e.exp) { this._m.delete(k); return null; }
    return e.v;
  },
  async delete(k) { this._m.delete(k); },
  _sweep() { const now = Date.now(); for (const [k, e] of this._m) if (now > e.exp) this._m.delete(k); },
};

export async function startDeviceFlow(request, env) {
  const clientId = env && env.Client_ID;
  const clientSecret = env && env.Client_Secret;
  if (!clientId || !clientSecret) {
    return err(503, 'service unavailable');
  }
  // Referer must be our own share page / 仅允许自家共享页调用
  const referer = request.headers.get('referer') || '';
  if (!/\/share\/?$/.test(new URL(referer || 'https://x.invalid/share/').pathname)) {
    return err(403, 'not allowed');
  }

  let res;
  try {
    res = await fetch(GITHUB_DEVICE_CODE_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'user-agent': 'HomeAssistantMarketplace',
      },
      body: JSON.stringify({ client_id: clientId, scope: '' }), // zero scope / 零权限
    });
  } catch (e) {
    return err(502, 'upstream error');
  }
  if (!res.ok) {
    return err(502, 'upstream error');
  }
  const data = await res.json();
  if (!data || !data.device_code || !data.user_code) {
    return err(502, 'upstream error');
  }

  // Keep device_code server-side, addressable by an opaque session id
  // device_code 留在服务端，用一个不透明会话 id 索引
  const sessionId = crypto.randomUUID();
  await DEVFLOW_STORE.put(sessionId, JSON.stringify({
    device_code: data.device_code,
    created_at: Date.now(),
    expires_at: Date.now() + (Number(data.expires_in) || 900) * 1000,
  }), { expirationTtl: Math.max(60, Math.min(900, Number(data.expires_in) || 900)) });

  return json(200, {
    session: sessionId,
    user_code: data.user_code,
    verification_uri: data.verification_uri || 'https://github.com/login/device',
    expires_in: Number(data.expires_in) || 900,
    interval: Number(data.interval) || 5,
  });
}

// ---- POST /share/device/poll ----
// Body: { session }
// Returns while pending: { status: 'pending' | 'expired' | 'denied' }
// On success: { status: 'ok', login, avatar_url } — the token stays on the server side.
// In-memory dedupe so parallel tabs share one flow / 内存级去重，多标签页并发同一流程只入库一次
const consumedSessions = new Set();

export async function pollDeviceFlow(request, env) {
  const clientId = env && env.Client_ID;
  const clientSecret = env && env.Client_Secret;
  if (!clientId || !clientSecret) {
    return err(503, 'service unavailable');
  }
  const referer = request.headers.get('referer') || '';
  if (!/\/share\/?$/.test(new URL(referer || 'https://x.invalid/share/').pathname)) {
    return err(403, 'not allowed');
  }
  const body = await readJsonBody(request);
  const session = typeof body.session === 'string' ? body.session : '';
  if (!session || session.length > 64 || !/^[0-9a-f-]{36}$/i.test(session)) {
    return err(404, 'not found');
  }
  if (consumedSessions.has(session)) {
    return json(200, { status: 'ok', reused: true });
  }

  let rec;
  try {
    rec = await DEVFLOW_STORE.get(session);
  } catch (e) {
    return err(502, 'upstream error');
  }
  if (!rec) {
    return json(200, { status: 'expired' });
  }
  let parsed;
  try {
    parsed = JSON.parse(rec);
  } catch (e) {
    return err(502, 'upstream error');
  }
  if (!parsed.device_code || Date.now() > parsed.expires_at) {
    await DEVFLOW_STORE.delete(session).catch(() => {});
    return json(200, { status: 'expired' });
  }

  let res;
  try {
    res = await fetch(GITHUB_TOKEN_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'user-agent': 'HomeAssistantMarketplace',
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        device_code: parsed.device_code,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });
  } catch (e) {
    return err(502, 'upstream error');
  }
  const data = await res.json().catch(() => null);
  if (!data) {
    return err(502, 'upstream error');
  }

  if (data.error === 'authorization_pending') {
    return json(200, { status: 'pending' });
  }
  if (data.error === 'slow_down') {
    return json(200, { status: 'pending', slow_down: true });
  }
  if (data.error === 'expired_token') {
    await DEVFLOW_STORE.delete(session).catch(() => {});
    return json(200, { status: 'expired' });
  }
  if (data.error === 'access_denied') {
    await DEVFLOW_STORE.delete(session).catch(() => {});
    return json(200, { status: 'denied' });
  }
  if (!data.access_token) {
    return err(502, 'upstream error');
  }

  // Success: validate the token and enrich with the login, still server-side
  // 成功：服务端验活并取 login，token 不出服务端
  let login = null;
  let avatarUrl = null;
  try {
    const ures = await fetch(GITHUB_USER_URL, {
      headers: {
        authorization: `Bearer ${data.access_token}`,
        accept: 'application/vnd.github+json',
        'user-agent': 'HomeAssistantMarketplace',
      },
    });
    if (ures.ok) {
      const u = await ures.json();
      login = u.login || null;
      avatarUrl = u.avatar_url || null;
    }
  } catch (e) { /* fallthrough: login optional / login 拿不到不阻断 */ }
  if (!login) {
    // Token failed validation right after issuance — do not store it
    // 刚签发就验活失败——不入库
    await DEVFLOW_STORE.delete(session).catch(() => {});
    return err(502, 'upstream error');
  }

  // KV is not provisioned yet: acknowledge the flow, drop the token (nothing persisted).
  // When KV lands, replace this block with the pool insert (dedupe by login).
  // KV 尚未开通：确认流程成功但丢弃 token（不落盘）。KV 就绪后把这里换成入池逻辑（按 login 去重）。
  await DEVFLOW_STORE.delete(session).catch(() => {});
  consumedSessions.add(session);

  return json(200, { status: 'ok', login, avatar_url: avatarUrl });
}
