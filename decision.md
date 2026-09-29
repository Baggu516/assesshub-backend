# AssessHub Backend — Decision Log

Track incidents, fixes, and rules so we don’t repeat the same mistakes.

---

## 2026-09-29 — Bulk student CSV import

### Decision
- Admins with `user_create` can `POST /users/members/import` with up to 200 rows (`mode: create | invite`).
- Admins with `subordinate_create` can `POST /users/subordinates/import` with up to 200 teacher rows.
- Existing emails (and duplicate rows in the same file) are **skipped**; other rows still import.
- Real validation/create errors count as `failed`; response returns `created` / `skipped` / `failed` / `results`.
- CSV is parsed on the frontend; API accepts JSON only (no multer for this path).
- Class enrollment stays a separate step (Classes wizard) — import only creates accounts.

---

## 2026-09-29 — School register ID string for student/teacher IDs

### Decision
- Organization stores optional `registrationPrefix` (2–24 A–Z/0–9), set when creating a client.
- Student/teacher `registrationId` = `PREFIX` + 5 random digits (e.g. `PEA48291`).
- Prefix is **not** the subdomain; subdomain stays for tenant URL/DB. Legacy orgs without prefix still fall back to subdomain.
- Prefix is locked after set (patch only allowed when missing).

---

## 2026-09-29 — Class teacher (homeroom) on AcademicClass

### Decision
- Store exactly one optional `classTeacherId` on `Class` (must be an active teacher member).
- Do **not** add a separate ClassMember role for class teacher — keeps uniqueness simple.
- Teachers track homeroom via `GET /classes/homeroom` and a frontend **My class** nav (read-focused), separate from admin **Classes** CRUD.

### Rules
- Clearing / removing a teacher who is class teacher clears `classTeacherId`.
- Admins set class teacher in the class wizard Teachers step (radio).

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
