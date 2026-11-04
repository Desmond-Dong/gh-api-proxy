// GitHub 共享 token 获取与缓存（Edge Functions 共享模块）
// 来源: HACS China tokenhub 共享池 https://tokenhub.hacs.vip/api/token/get
// isolate 内存缓存 30 分钟；token 失效立即换新的（池内多 token 轮换）

export const TOKENHUB_API = 'https://tokenhub.hacs.vip/api/token/get';
const TOKEN_CACHE_TTL_MS = 30 * 60 * 1000;
// token 被拒后短时间内不再重复请求池接口（防止上游故障时打爆 tokenhub）
const RETRY_COOLDOWN_MS = 10 * 1000;

// isolate 级缓存
const tokenCache = { token: null, fetchedAt: 0, rejectedAt: 0 };

function markRejected() {
  tokenCache.token = null;
  tokenCache.fetchedAt = 0;
  tokenCache.rejectedAt = Date.now();
}

// 上游返回 401/403 时调用：立刻作废缓存，下个请求换新 token
export function invalidateGithubToken() {
  markRejected();
}

// 冷却期内直接放弃（避免每个请求都去打 tokenhub），冷却过后自动恢复拉取
function inCooldown() {
  return tokenCache.rejectedAt && Date.now() - tokenCache.rejectedAt < RETRY_COOLDOWN_MS;
}

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
    // tokenhub 不可达
  }
  return null;
}
