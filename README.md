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
- Provide the access key via the `x-proxy-key` header or a `?key=` query parameter
  通过 `x-proxy-key` 请求头或 `?key=` 参数携带访问密钥
- Only `github.com` and its subdomains are allowed
  仅允许 `github.com` 及其子域

## Deployment / 部署

1. Connect this repository to EdgeOne Makers, acceleration region: "Global (including Chinese mainland)"
   在 EdgeOne Makers 连接本仓库，加速区域选「全球可用区（含中国大陆）」
2. Leave the build command empty; output directory: `public`
   构建命令留空，输出目录 `public`
3. Environment variable: `PROXY_KEY` (access key)
   环境变量：`PROXY_KEY`（访问密钥）
4. Bind an ICP-filed custom domain
   绑定已备案的自定义域名
