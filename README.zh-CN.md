# gh-api-proxy / GitHub 反向代理

运行在 EdgeOne Pages 边缘节点的 GitHub 反向代理，面向 Home Assistant Marketplace。

## 用法

把完整 GitHub URL 拼在本服务域名后面即可：

```
https://<your-domain>/https://api.github.com/rate_limit
https://<your-domain>/https://github.com/owner/repo/releases/download/v1.0.0/asset.zip
https://<your-domain>/https://raw.githubusercontent.com/owner/repo/main/file.txt
```

## 请求要求

- 请求头 `User-Agent` 必须包含 `HomeAssistantMarketplace`
- 仅允许 `github.com` 及其子域

## 部署

1. 在 EdgeOne Makers 连接本仓库，加速区域选「全球可用区（含中国大陆）」
2. 构建命令留空，输出目录 `public`
3. 分支：`main` 对应生产环境，`dev` 对应预览环境
4. 绑定已备案的自定义域名

无需配置任何环境变量。

## 规划

- [ ] 将共享 GitHub token 池从外部 tokenhub 迁移到本项目自建的 EdgeOne Pages KV 池（页面访客可自愿分享 token；页面仅展示脱敏统计——账号名 / 使用次数 / 剩余额度；token 明文不出边缘节点）
- [ ] 管理端点 `export` / `import`（AdminKey 鉴权），用于 KV 备份与恢复

## README

[English](README.md)
