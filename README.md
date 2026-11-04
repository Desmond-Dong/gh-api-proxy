# gh-api-proxy

GitHub reverse proxy running on EdgeOne Pages edge nodes, built for Home Assistant Marketplace.

## Usage

Append the full GitHub URL after this service's domain:

```
https://<your-domain>/https://api.github.com/rate_limit
https://<your-domain>/https://github.com/owner/repo/releases/download/v1.0.0/asset.zip
https://<your-domain>/https://raw.githubusercontent.com/owner/repo/main/file.txt
```

## Requirements

- `User-Agent` must contain `HomeAssistantMarketplace`
- Only `github.com` and its subdomains are allowed

## Deployment

1. Connect this repository to EdgeOne Makers, acceleration region: "Global (including Chinese mainland)"
2. Leave the build command empty; output directory: `public`
3. Branches: `main` → production, `dev` → preview
4. Bind an ICP-filed custom domain

No environment variables required.

## Roadmap

- [ ] Migrate the shared GitHub token pool from the external tokenhub to an EdgeOne Pages KV pool hosted in this project (visitors can voluntarily share tokens on the page; the page shows only masked stats — login / use count / remaining quota; raw tokens never leave the edge)
- [ ] Admin endpoints `export` / `import` (AdminKey auth) for KV backup & restore

## README

[中文文档](README.zh-CN.md)
