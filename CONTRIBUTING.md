# CONTRIBUTING / 贡献指南

## 分支模型 / Branch model

- `dev` — 开发分支（默认分支），push 自动部署预览环境
  Development branch (default). Pushes auto-deploy the preview environment.
- `main` — 生产分支，push 自动部署生产环境
  Production branch. Pushes auto-deploy production.
- **生产更新一律走 PR**：`dev` → `main` 由仓库所有者手动建 PR 并合并，禁止直接 push `main`
  Production updates must go through a PR: the owner creates and merges `dev` → `main` manually. Direct pushes to `main` are not allowed.
- PR 合并后由合并者（或协助的 agent）验证生产环境行为
  After merging, verify production behavior.

## 提交规范 / Commit conventions

- 所有 commit message 使用中英双语（中文在前，英文在后）
  All commit messages must be bilingual: Chinese first, English after.
- 建议格式 / Suggested format:
  ```
  <类型>: <中文摘要> / <English summary>

  <中文正文（可选）>
  <English body (optional)>
  ```
- 类型 / Types: `feat` `fix` `docs` `refactor` `chore`

## 环境变量 / Environment variables

- 所有密钥通过 EdgeOne Pages 环境变量注入，禁止硬编码；生产与预览环境需分别配置
  All secrets come from EdgeOne Pages environment variables — never hardcode them. Configure both production and preview environments.
- 变量改动生效需要重新触发构建
  Environment variable changes require a rebuild to take effect.

## 安全红线 / Security rules

- Token 明文永不出现在页面、日志或浏览器响应中
  Raw tokens must never appear in pages, logs, or browser responses.
- 同源校验不依赖客户端可控的请求头（referer 等），使用平台注入的 host 头
  Same-origin checks must not rely on client-controlled headers (e.g. referer); use platform-injected host headers.
