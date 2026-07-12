# AssessHub API

Multi-tenant assessment platform backend (Express + MongoDB).

## Layout

```
src/
  app.js              # Express app factory (also Vercel entry)
  server.js           # Local process entry
  config/             # Infrastructure (DB connection)
  constants/          # Shared constants (permission keys)
  db/                 # Tenant DB factory + catalog seed
  middleware/         # Cross-cutting HTTP middleware
  models/             # Mongoose schemas/models
  modules/            # Feature modules (routes → controller → service)
  routes/             # /api aggregator
  utils/              # Pure helpers (jwt, errors, mailer, …)
scripts/              # CLI / ops (seed, request examples)
```

## Tenancy

- **Registry DB** (`MONGODB_URI`): organizations + platform users
- **Tenant DBs**: `${TENANT_DB_PREFIX}${subdomain}` on the same cluster
- Tenant resolved from Host subdomain or `X-Tenant-Subdomain`

## Modules

Each feature under `src/modules/<name>/` typically has:

| File | Role |
|------|------|
| `*.routes.js` | HTTP routes + middleware stack |
| `*.controller.js` | Request/response only |
| `*.service.js` | Business logic |
| `*.schemas.js` | Zod validation |

## Setup

```bash
cp .env.example .env   # fill required secrets
npm install
npm run seed           # optional demo org
npm run dev
```

Required env: `MONGODB_URI`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`. See `.env.example`.
