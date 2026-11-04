# gh-api-proxy

EdgeOne Pages (Makers) Edge Function：GitHub API + 资源下载反向代理。

部署在 EdgeOne Pages，用于 Home Assistant Marketplace 集成在国内直连访问 GitHub。
走腾讯 EdgeOne 大陆节点，出站请求 GitHub（杭州移动家宽实测 API 200 / 0.7~2.3s）。

## 访问控制

- **UA 白名单**：请求头 `User-Agent` 必须包含 `HomeAssistantMarketplace`，否则 403
- **密钥**：需携带 `x-proxy-key` 请求头或 `?key=` 参数，与 `PROXY_KEY` 环境变量匹配，否则 401
- key 自身不透传给上游；OPTIONS 预检放行

## 部署（EdgeOne Makers 控制台）

1. 连接本 GitHub 仓库创建项目，加速区域选「全球可用区（含中国大陆）」
2. 构建配置：构建命令留空，输出目录 `public`（仓库内 `edgeone.json` 已声明）
3. 环境变量（Project Settings → Environment Variables）：
   - `GH_TOKEN` — GitHub fine-grained PAT（Public repositories 只读即可，限额 5000 次/时）
   - `PROXY_KEY` — 自定义访问密钥，防止接口被滥用
4. Domain Management → 绑定自定义域名（需已备案），按提示加 DNS 验证 + CNAME，申请免费证书

## 路由

| 入口 | 上游 | 用途 |
|---|---|---|
| `/api/github/<path>` | `api.github.com/<path>` | API 元数据（release、repo 信息等） |
| `/gh/raw/<path>` | `raw.githubusercontent.com/<path>` | 仓库文件原文 |
| `/gh/archive/<path>` | `codeload.github.com/<path>` | 源码 tar.gz |
| `/gh/dl/<path>` | `github.com/<path>`（自动跟随 302） | release 资产、`/releases/download/...` |
| `/gh/gist/<path>` | `gist.githubusercontent.com/<path>` | Gist 文件 |

全部流式转发、支持 `Range` 断点续传（保留 206/416 语义），下载不占函数 CPU 配额（CPU 不含 I/O 等待）。

## 使用

```bash
export P="x-proxy-key: $PROXY_KEY"
export U="user-agent: HomeAssistantMarketplace"
export D="https://<your-domain>"

# API：查询 rate_limit（应显示认证后额度）
curl "$D/api/github/rate_limit" -H "$P" -H "$U"

# release 最新版本信息
curl "$D/api/github/repos/home-assistant/core/releases/latest" -H "$P" -H "$U"

# 下载某个 release 资产（跟随 302 到 CDN）
curl -LO "$D/gh/dl/user/repo/releases/download/v1.0.0/asset.zip" -H "$P" -H "$U"

# 仓库单文件
curl "$D/gh/raw/user/repo/main/manifest.json" -H "$P" -H "$U"

# 源码包
curl -o repo.tar.gz "$D/gh/archive/user/repo/tar.gz/refs/heads/main" -H "$P" -H "$U"
```

HA 集成侧配置示例（Python requests）：

```python
headers = {
    "user-agent": "HomeAssistantMarketplace",
    "x-proxy-key": PROXY_KEY,
}
r = await hass.async_add_executor_job(
    requests.get, f"https://<your-domain>/api/github/repos/{owner}/{repo}/releases/latest", None, headers
)
```

## 代码结构

```
edge-functions/api/github/[[default]].js   # API 代理
edge-functions/gh/[[default]].js           # 下载代理（raw/archive/dl/gist）
public/index.html                          # 占位说明页
edgeone.json                               # 构建配置（无构建，输出 public/）
```

## 限额与注意

- GitHub API：带 token 5000 次/时（未认证 60 次/时，务必配 `GH_TOKEN`）；下载类端点（raw/codeload/release 资产）不占用 API 配额
- Edge Functions：单次 CPU 200ms（不含 I/O 等待），请求体 ≤1MB，代码包 ≤5MB，仅 JavaScript
- 超大文件受平台函数执行时长限制约束，建议大文件仍走下载工具断点续传（已支持 Range）
