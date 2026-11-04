# gh-api-proxy

EdgeOne Pages (Makers) Edge Function：GitHub API 反向代理。

部署在 EdgeOne Pages，用于前端/脚本在国内直连访问 GitHub API。
走腾讯 EdgeOne 大陆节点，出站请求 GitHub API（杭州移动家宽实测 200 / 0.7~2.3s）。

## 部署（EdgeOne Makers 控制台）

1. 连接本 GitHub 仓库创建项目，加速区域选「全球可用区（含中国大陆）」
2. 构建配置：构建命令留空，输出目录 `public`
3. 环境变量（Project Settings → Environment Variables）：
   - `GH_TOKEN` — GitHub fine-grained PAT（Public repositories 只读即可，限额 5000 次/时）
   - `PROXY_KEY` — 自定义访问密钥，防止接口被滥用
4. Domain Management → 绑定自定义域名（需已备案），按提示加 DNS 验证 + CNAME，申请免费证书

## 使用

```bash
curl "https://<your-domain>/api/github/rate_limit" -H "x-proxy-key: $PROXY_KEY"
curl "https://<your-domain>/api/github/repos/home-assistant/core/releases/latest" -H "x-proxy-key: $PROXY_KEY"
```

鉴权方式二选一：`x-proxy-key` 请求头，或 URL 追加 `?key=...`（会透传给 GitHub 的查询参数除外）。

## 路由

- `/api/github/*` → `api.github.com/*`（`[[default]].js` 多级动态路由）
- 纯转发：method 透传，body 透传（≤1MB，平台限制），GitHub 响应头/状态码原样返回
- 自动补充 `User-Agent` / `Accept` / `Authorization`，剥离请求侧的敏感头
- 响应带 `Access-Control-Allow-Origin: *`，支持 OPTIONS 预检

## 代码结构

```
edge-functions/api/github/[[default]].js   # 代理主体
public/index.html                          # 占位说明页
edgeone.json                               # 构建配置（无构建，输出 public/）
```

## 限额与注意

- GitHub PAT：5000 次/小时（未认证 60 次/小时，务必配 token）
- Edge Functions：单次 CPU 200ms（不含 I/O 等待），请求体 ≤1MB，代码包 ≤5MB，仅 JavaScript
- 大文件（release 二进制等）不建议走本代理，单次响应没有分块缓冲，参考实测 codeload 下载较慢
