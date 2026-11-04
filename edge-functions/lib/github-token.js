// GitHub 共享 token 获取与缓存（Edge Functions 共享模块）
// 来源: HACS China tokenhub 共享池 https://tokenhub.hacs.vip/api/token/get
// isolate 内存缓存 30 分钟，避免每次请求都打 tokenhub；
// tokenhub 失败时返回 null（匿名请求，60 次/时）

export const TOKENHUB_API = 'https://tokenhub.hacs.vip/api/token/get';
const TOKEN_CACHE_TTL_MS = 30 * 60 * 1000;

// isolate 级缓存（全局变量随 isolate 存活）
const tokenCache = { token: null, fetchedAt: 0 };

export function invalidateGithubToken() {
  tokenCache.token = null;
  tokenCache.fetchedAt = 0;
}

export async function getGithubToken() {
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
    // tokenhub 不可达，匿名请求
  }
  return null;
}
