# Hallo News

Next.js 14 news-platform foundation with editorial pages, source attribution, JSON-LD, health/audit endpoints, and opt-in AdSense components.

## Local setup

```bash
cp .env.example .env.local
npm install
npm run build
npm run dev
```

Set actual API keys, database credentials, site URL, and advertising configuration in `.env.local`; it is intentionally ignored by Git. Advertisements do not render until the corresponding `NEXT_PUBLIC_AD_*` environment values are present.

## Checks

```bash
npm run validate:adsense
npm run validate:content
npm run health
```

## Production

Build then run with PM2 (on a host you administer):

```bash
npm ci
npm run build
pm2 start ecosystem.config.cjs
```

Configure the reverse proxy, TLS domain, PostgreSQL, Redis, DNS, and firewall in the target hosting environment. No host-level configuration is committed or automatically applied by this repository.
