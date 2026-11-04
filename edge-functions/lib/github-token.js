// Shared GitHub token fetch & cache / GitHub 共享 token 获取与缓存
// Edge Functions shared module / Edge Functions 共享模块
//
// Source / 来源: HACS China tokenhub shared pool / HACS China tokenhub 共享池
//   https://tokenhub.hacs.vip/api/token/get
//
// isolate-level memory cache for 30 minutes; a rejected token is dropped immediately
// and the next request fetches a fresh one (the pool rotates many tokens).
// isolate 内存缓存 30 分钟；token 被拒立即作废，下个请求换新的（池内多 token 轮换）。

export const TOKENHUB_API = 'https://tokenhub.hacs.vip/api/token/get';

// Cache TTL / 缓存有效期
const TOKEN_CACHE_TTL_MS = 30 * 60 * 1000;
// Cooldown after a rejection, to avoid hammering the pool API during upstream failures
// 被拒后的冷却期，防止上游故障时打爆池接口
const RETRY_COOLDOWN_MS = 10 * 1000;

// isolate-level cache (globals live as long as the isolate) / isolate 级缓存（全局变量随 isolate 存活）
const tokenCache = { token: null, fetchedAt: 0, rejectedAt: 0 };

function markRejected() {
  tokenCache.token = null;
  tokenCache.fetchedAt = 0;
  tokenCache.rejectedAt = Date.now();
}

// Called when upstream returns 401/403: invalidate cache now, next request gets a new token
// 上游返回 401/403 时调用：立刻作废缓存，下个请求换新 token
export function invalidateGithubToken() {
  markRejected();
}

// Within cooldown, skip pool requests entirely; after cooldown, fetching resumes automatically
// 冷却期内直接放弃请求池接口，冷却过后自动恢复拉取
function inCooldown() {
  return tokenCache.rejectedAt && Date.now() - tokenCache.rejectedAt < RETRY_COOLDOWN_MS;
}

// Returns a token or null (null = anonymous requests, 60/hour)
// 返回 token 或 null（null = 匿名请求，60 次/时）
export async function getGithubToken() {
  if (inCooldown()) {
    return null;
  }
  const now = Date.now();
  if (tokenCache.token && now - tokenCache.fetchedAt < TOKEN_CACHE_TTL_MS) {
    return tokenCache.token;
  }
  try {
    const res = await fetch(TOKENHUB_API, {
      headers: { 'User-Agent': 'HomeAssistantMarketplace' },
    });
    if (res.ok) {
      const data = await res.json();
      const token = data && data.data && data.data.token;
      if (token) {
        tokenCache.token = token;
        tokenCache.fetchedAt = now;
        return token;
      }
    }
  } catch (e) {
    // tokenhub unreachable / tokenhub 不可达
  }
  return null;
}
