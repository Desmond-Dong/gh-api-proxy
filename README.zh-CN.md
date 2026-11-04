# gh-api-proxy / GitHub 反向代理

运行在 EdgeOne Pages 边缘节点的 GitHub 反向代理，面向 Home Assistant Marketplace。

## 用法

把完整 GitHub URL 拼在本服务域名后面即可：

```
https://<your-domain>/https://api.github.com/rate_limit
https://<your-domain>/https://github.com/owner/repo/releases/download/v1.0.0/asset.zip
https://<your-domain>/https://raw.githubusercontent.com/owner/repo/main/file.txt
```

## 请求流程 / 从请求到响应

```
Home Assistant Marketplace
        │  GET https://<域名>/https://api.github.com/…
        ▼
[1] 门禁层（不涉及任何环境变量）
    ├─ User-Agent 必须含 "HomeAssistantMarketplace"，否则 403
    └─ 目标域名必须在 GitHub 白名单内，否则 403
        ▼
[2] URL 归一化与重映射
    ├─ 修复折叠的协议头：https:/ → https://
    └─ raw.githubusercontent.com/<o>/<r>/<ref>/<path>
         被透明重映射到官方 Contents API：
         api.github.com/repos/<o>/<r>/contents/<path>?ref=<ref>
         并附 Accept: application/vnd.github.raw（返回文件本体而非 JSON）
        ▼
[3] 组装上游请求
    ├─ 显式设置 Host 头为目标域名（EdgeOne 运行时按 Host 路由，
    │   缺失会导致所有上游请求失败）
    ├─ 剥离逐跳头与客户端的 authorization 头
    └─ fetch() 使用 redirect: follow；body 流式转发
        ▼
[4] 上游：仅 GitHub 官方域名（白名单）
    ├─ api.github.com        — API 调用；此处附加共享池 token
    ├─ github.com            — 页面与 release 下载（302 → objects CDN，匿名）
    ├─ codeload.github.com   — 源码包（匿名）
    └─ objects.githubusercontent.com — release 资产 CDN（匿名）
        ▼
[5] 响应回传客户端
    ├─ 状态码原样透传（GitHub 的 404 就是 404）
    ├─ 剥离逐跳头；支持 Range 断点（206）
    └─ body 流式转发——函数 CPU 不随文件体积增长
```

### 共享 token 用在哪里 / Token usage

- **仅 `api.github.com` 请求附加 token。** 从共享池取一个 token，以
  `Authorization: Bearer <token>` 附加，把限额从 60 次/时提升到 5,000 次/时。
  token 只存在于边缘函数内存中（缓存 30 分钟；被拒立即作废，下个请求自动换新）。
  token 明文永不下发客户端、不写日志、不用于下载类端点。
- **下载类端点对公开仓库保持匿名**（不消耗 API 配额）：release 下载、源码包、objects CDN。
- **关于重映射 raw 的说明**：raw.githubusercontent.com 本身对公开仓库是匿名下载，
  但本代理把 raw 请求重映射到了 Contents API（api.github.com），因此这类请求
  会消耗共享池的认证 API 配额。直连 raw 在本代理中本就不可用
  （EdgeOne 出口连不上 raw 的 Fastly 节点）。
- **`/share/device/*` 端点**（token 共享页）代表页面访客与 GitHub OAuth Device Flow 通信；
  签发的 token 经 `/user` 验证后只留在服务端。

### 透传与改写的边界 / Pass-through vs. rewriting

| 环节 | 行为 |
|---|---|
| URL 路径 | 代理式前缀；解析内层 GitHub URL 后原样透传（白名单域名）或重映射（raw → Contents API） |
| 请求方法 | 原样透传 |
| 查询参数 | 原样透传（内层 URL 的查询参数随外层请求传递） |
| 请求体 | 流式透传，不做修改 |
| 响应状态码 | 原样透传 |
| 响应头 | 剥离逐跳头，附加 CORS，其余透传 |
| 响应体 | 逐字节流式透传 |

## 请求要求

- 请求头 `User-Agent` 必须包含 `HomeAssistantMarketplace`
- 仅允许 `github.com` 及其子域

## 部署

1. 在 EdgeOne Makers 连接本仓库，加速区域选「全球可用区（含中国大陆）」
2. 构建命令留空，输出目录 `public`
3. 分支：`main` 对应生产环境（push 自动构建），`dev` 对应预览环境（手动构建）
4. 绑定已备案的自定义域名

代理本身无需任何环境变量。启用 token 共享端点时，函数读取
`Client_ID` / `Client_Secret`（Device Flow 用的 OAuth App）。

## 规划

- [ ] 将共享 GitHub token 池从外部 tokenhub 迁移到本项目自建的 EdgeOne Pages KV 池（页面访客可自愿分享 token；页面仅展示脱敏统计——账号名 / 使用次数 / 剩余额度；token 明文不出边缘节点）
- [ ] GitHub OAuth Device Flow 一键分享 token：访客点击页面按钮，在 github.com/login/device 授权一个零 scope 的 OAuth App，token 自动入池（token 不经过浏览器；每位访客独立设备码；失效 token 定期验活自动剔除）
- [ ] 管理端点 `export` / `import`（AdminKey 鉴权），用于 KV 备份与恢复

## README

[English](README.md)
