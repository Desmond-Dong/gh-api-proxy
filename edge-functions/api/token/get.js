// Shared token pool API — tokenhub-compatible / 共享 token 池 API —— tokenhub 兼容格式
//
// GET /api/token/get -> one token record for the Marketplace proxy, same JSON shape as
// https://tokenhub.hacs.vip/api/token/get so existing consumers can switch by URL alone.
// 返回一条 token 记录，JSON 结构与 tokenhub 完全一致，消费方只改 URL 即可切换。
//
// Response shape / 返回结构:
// {
//   "data": {
//     "id", "created_at", "updated_at", "type": "github", "login", "token",
//     "use_count", "remaining", "expired_at": "", "deleted_at": null,
//     "usage": { ... latest usage record or null ... }, "usages": null
//   }
// }
//
// Data source / 数据源: self-hosted KV pool (primary, per-login dedupe & round-robin),
// falling back to tokenhub while the KV pool is empty/unprovisioned.
// 数据源：自建 KV 池（主，按 login 去重 + 轮换），KV 池为空/未开通时回退 tokenhub。
//
// Selection strategy / 选取策略: pick the record with the highest remaining quota among
// freshly revalidated entries; records are revalidated against GitHub /rate_limit.
// 在验活通过的记录里选剩余额度最高的一条；验活走 GitHub /rate_limit。

import { TOKENHUB_API } from '../../lib/github-token.js';

const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'cache-control': 'no-store',
};

// KV namespace binding is console-configured; absent before provisioning.
// KV 命名空间绑定由控制台配置，开通前该全局变量不存在。
function kv() {
  return typeof TOKENPOOL_KV !== 'undefined' ? TOKENPOOL_KV : null;
}

function json(status, payload) {
  return new Response(JSON.stringify(payload), { status, headers: { ...jsonHeaders } });
}

function nowStr() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

// tokenhub-shaped record / tokenhub 形状的记录
function shape(id, rec) {
  return {
    id,
    created_at: rec.created_at,
    updated_at: rec.updated_at,
    type: 'github',
    login: rec.login,
    token: rec.token,
    use_count: rec.use_count || 0,
    remaining: rec.remaining != null ? rec.remaining : 0,
    expired_at: rec.expired_at || '',
    deleted_at: null,
    usage: rec.usage || null,
    usages: null,
  };
}

// Revalidate one token against GitHub and return remaining quota, or null if dead.
// 对单条 token 走 GitHub 验活，返回剩余额度；失效返回 null。
async function revalidate(rec) {
  try {
    const res = await fetch('https://api.github.com/rate_limit', {
      headers: {
        authorization: `Bearer ${rec.token}`,
        'user-agent': 'HomeAssistantMarketplace',
        accept: 'application/vnd.github+json',
      },
    });
    if (!res.ok) return null;
    const d = await res.json();
    const core = d && d.resources && d.resources.core;
    if (!core || core.remaining <= 0) return null;
    return core.remaining;
  } catch (e) {
    return null;
  }
}

// Round-robin cursor in module scope (per-isolate); avoids always serving the same entry.
// 模块级轮换游标（每 isolate），避免总是返回同一条。
let rrCursor = 0;

export async function onRequestGet() {
  const kvb = kv();
  if (kvb) {
    try {
      // Load the whole pool (keys: pool/<n>, small pool by design / 键 pool/<n>, 池子天然小)
      const keys = [];
      let cursor;
      do {
        const page = await kvb.list({ prefix: 'pool/', limit: 256, cursor });
        keys.push(...page.keys);
        cursor = page.complete ? undefined : page.cursor;
      } while (cursor);

      let best = null;
      for (const k of keys) {
        const raw = await kvb.get(k.name, 'json');
        if (!raw || !raw.token || raw.disabled) continue;
        // Cache the quota for 10 min inside the record to bound /rate_limit calls.
        // 记录内缓存额度 10 分钟，限制 /rate_limit 调用频次。
        const fresh = raw.checked_at && Date.now() - raw.checked_at < 10 * 60 * 1000;
        let remaining = fresh ? raw.remaining : await revalidate(raw);
        if (remaining == null) {
          // Dead token: mark disabled, prune from candidates.
          // 失效 token：标记停用，剔出候选。
          raw.disabled = true;
          raw.updated_at = nowStr();
          await kvb.put(k.name, JSON.stringify(raw));
          continue;
        }
        raw.remaining = remaining;
        raw.checked_at = Date.now();
        if (!fresh) await kvb.put(k.name, JSON.stringify(raw));
        if (!best || remaining > best.remaining) best = { key: k.name, rec: raw };
      }
      if (best) {
        best.rec.use_count = (best.rec.use_count || 0) + 1;
        best.rec.updated_at = nowStr();
        await kvb.put(best.key, JSON.stringify(best.rec));
        return json(200, { data: shape(Number(best.key.split('/')[1]), best.rec) });
      }
    } catch (e) {
      // KV errors fall through to tokenhub fallback / KV 异常落到 tokenhub 回退
    }
  }

  // Fallback: proxy a tokenhub record verbatim (already the same shape).
  // 回退：原样转发 tokenhub 记录（结构本就一致）。
  try {
    const res = await fetch(TOKENHUB_API, {
      headers: { 'User-Agent': 'HomeAssistantMarketplace' },
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.data && data.data.token) {
        return json(200, { data: data.data });
      }
    }
  } catch (e) { /* tokenhub unreachable / tokenhub 不可达 */ }
  return json(503, { error: 'pool unavailable' });
}
