# gh-api-proxy

GitHub 反向代理，运行在 EdgeOne Pages 边缘节点，面向 Home Assistant Marketplace。

用法：把完整 GitHub URL 拼在本服务域名后面即可。

```
https://<your-domain>/https://api.github.com/rate_limit
https://<your-domain>/https://github.com/owner/repo/releases/download/v1.0.0/asset.zip
https://<your-domain>/https://raw.githubusercontent.com/owner/repo/main/file.txt
```

要求：

- `User-Agent` 须包含 `HomeAssistantMarketplace`
- 携带 `x-proxy-key` 请求头或 `?key=` 参数
- 仅允许 github.com 及其子域

## 部署

1. EdgeOne Makers 连接本仓库，加速区域选「全球可用区（含中国大陆）」
2. 构建命令留空，输出目录 `public`
3. 环境变量：`PROXY_KEY`（访问密钥）
4. 绑定已备案的自定义域名
