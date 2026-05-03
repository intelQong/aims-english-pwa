# Deployment & Security Readiness Audit (Cloudflare)

Date (UTC): 2026-05-03

## 1) Unpack status
- Source archive `aims-english-pwa.zip` was extracted.
- Runtime files present: `index.html`, `worker.js`, `sw.js`, `manifest.json`, `schema.sql`, `wrangler.toml`, and `icons/*`.

## 2) Configuration hardening checklist

### Required pre-deploy replacements
1. In `index.html`:
   - Replace `https://aims-worker.YOUR-SUBDOMAIN.workers.dev` with your real Worker URL.
   - Replace `YOUR_VAPID_PUBLIC_KEY_HERE` with your real VAPID public key.
2. In `wrangler.toml`:
   - Replace `REPLACE_WITH_YOUR_D1_DATABASE_ID`.
   - Replace `REPLACE_WITH_YOUR_KV_NAMESPACE_ID`.

### Required Worker secrets
Set all of the following in Cloudflare Worker settings:
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `JWT_SECRET`
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT`

### Operational safety recommendations
- Rotate `JWT_SECRET` and VAPID keys if they were ever shared in chat/email.
- Keep `ADMIN_PASSWORD` in a secret manager and rotate regularly.
- Restrict admin credentials to specific operators only.
- Enable Cloudflare access logs/analytics for auditability.
- Add periodic D1 exports/backups.

## 3) Quick code audit findings
- Placeholder values are intentionally present and must be replaced before production.
- API relies on bearer token auth and role checks in the Worker.
- Single-device login uses KV session and device keys; expected behavior is documented in `CODEX_SUMMARY.md`.
- Push workflow is implemented using VAPID and persisted subscriptions in KV.

## 4) Suggested deployment command sequence
```bash
# 1) Authenticate
wrangler login

# 2) Create D1 and KV resources (if not already created)
wrangler d1 create aims-db
wrangler kv namespace create AIMS_KV

# 3) Update IDs in wrangler.toml
#    - d1_databases[].database_id
#    - kv_namespaces[].id

# 4) Initialize schema
wrangler d1 execute aims-db --file=./schema.sql

# 5) Set secrets
wrangler secret put ADMIN_EMAIL
wrangler secret put ADMIN_PASSWORD
wrangler secret put JWT_SECRET
wrangler secret put VAPID_PUBLIC_KEY
wrangler secret put VAPID_PRIVATE_KEY
wrangler secret put VAPID_SUBJECT

# 6) Deploy worker
wrangler deploy
```

## 5) Production smoke test checklist
1. Register student account.
2. Approve student from admin portal.
3. Verify student login and dashboard values.
4. Verify dues calculations and payment section.
5. Add schedule item from admin and confirm student visibility.
6. Send notification and verify student unread counter.
7. Test push notification on mobile device.
8. Verify second-device login is blocked when session exists.


## 6) Repository compatibility note
- Binary assets (DOCX and PNG icon files) were removed to keep this repo patch text-only in environments that do not support binary diffs.
- Regenerate and re-add production icons (72/96/128/192/512) and setup guide document separately when binary artifacts are allowed.
