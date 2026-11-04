# gh-api-proxy / GitHub 反向代理

GitHub reverse proxy running on EdgeOne Pages edge nodes, built for Home Assistant Marketplace.
运行在 EdgeOne Pages 边缘节点的 GitHub 反向代理，面向 Home Assistant Marketplace。

## Usage / 用法

Append the full GitHub URL after this service's domain:
把完整 GitHub URL 拼在本服务域名后面即可：

```
https://<your-domain>/https://api.github.com/rate_limit
https://<your-domain>/https://github.com/owner/repo/releases/download/v1.0.0/asset.zip
https://<your-domain>/https://raw.githubusercontent.com/owner/repo/main/file.txt
```

## Requirements / 请求要求

- `User-Agent` must contain `HomeAssistantMarketplace`
  请求头 `User-Agent` 必须包含 `HomeAssistantMarketplace`
- Only `github.com` and its subdomains are allowed
  仅允许 `github.com` 及其子域

## Deployment / 部署

1. Connect this repository to EdgeOne Makers, acceleration region: "Global (including Chinese mainland)"
   在 EdgeOne Makers 连接本仓库，加速区域选「全球可用区（含中国大陆）」
2. Leave the build command empty; output directory: `public`
   构建命令留空，输出目录 `public`
3. Branches: `main` → production, `dev` → preview
   分支：`main` 对应生产环境，`dev` 对应预览环境
4. Bind an ICP-filed custom domain
   绑定已备案的自定义域名

No environment variables required / 无需配置任何环境变量

## Roadmap / 规划

- [ ] Migrate the shared GitHub token pool from the external tokenhub to an EdgeOne Pages KV pool hosted in this project (visitors can voluntarily share tokens on the page; the page shows only masked stats — login / use count / remaining quota; raw tokens never leave the edge)
  将共享 GitHub token 池从外部 tokenhub 迁移到本项目自建的 EdgeOne Pages KV 池（页面访客可自愿分享 token；页面仅展示脱敏统计——账号名 / 使用次数 / 剩余额度；token 明文不出边缘节点）
- [ ] Admin endpoints `export` / `import` (AdminKey auth) for KV backup & restore
  管理端点 `export` / `import`（AdminKey 鉴权）用于 KV 备份与恢复
