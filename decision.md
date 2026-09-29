# AssessHub Backend — Decision Log

Track incidents, fixes, and rules so we don’t repeat the same mistakes.

---

## 2026-09-29 — Production API down after Redis commit

### What happened
- Commit `e1d23db` (“integrate Upstash Redis…”) was pushed and deployed to Vercel.
- `src/config/redis.js` was committed **empty** (imports of `getRedis` / `redisEnabled` still existed).
- Rate limiting loads on every request → calling missing `redisEnabled` crashed the serverless function.
- Symptom: `FUNCTION_INVOCATION_FAILED` on **all** routes (including `/` and `/api/public/tenants/:subdomain`).
- Same commit also wiped:
  - `src/modules/assessment/assessment.service.js` (~1743 lines → 0 bytes)
  - `src/modules/reports/reports.service.js` (~537 lines → 0 bytes)

### Root cause
Incomplete Redis integration: callers and cache helpers were wired, but the Redis module body was never written. Large service files were accidentally emptied in the same change set and shipped without a size/export sanity check.

### Decision / fix
1. Implement real `src/config/redis.js` using `@upstash/redis`.
2. Redis stays **optional**: if `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` are missing, `getRedis()` returns `null` and rate limit falls back to in-memory store.
3. Restore `assessment.service.js` and `reports.service.js` from pre-Redis commit `65d6c55`.
4. Add safeguards (see below) so empty critical modules cannot be committed/deployed casually.

### Safeguards added
- Cursor rule: `.cursor/rules/no-empty-critical-modules.mdc` (agent must not ship empty modules or wipe large services).
- Script: `npm run check:critical` — fails if Redis exports are missing or listed service files are empty/tiny.
- This log file (`decision.md`) for human tracking.

### Deploy note
Production stays broken until this fix is committed and pushed to `assesshub-backend` so Vercel redeploys.

### Follow-ups
- [ ] Commit + push fix (redis.js + restored services + check script + decision.md).
- [ ] Optionally set Upstash env vars on Vercel if Redis caching/rate-limit sharing across instances is desired.
- [ ] Prefer small, reviewable PRs for infra (Redis) separate from unrelated service edits.

---

## Template for new entries

```
## YYYY-MM-DD — Short title

### What happened
### Root cause
### Decision / fix
### Safeguards / follow-ups
```
