# AIMS English PWA — Release Checklist & Rollback Plan

## Pre-release
- [ ] Confirm Cloudflare D1 database exists and schema applied.
- [ ] Confirm KV namespace exists and is bound as `AIMS_KV`.
- [ ] Set all required Worker secrets (`ADMIN_EMAIL`, `ADMIN_PASSWORD`, `JWT_SECRET`, `VAPID_*`).
- [ ] Replace `API` and `VAPID_PUBLIC_KEY` placeholders in frontend.
- [ ] Confirm `ALLOWED_ORIGIN` is set to production domain.
- [ ] Deploy Worker to staging and run smoke tests.

## Go-live checklist
- [ ] Deploy Worker to production (`wrangler deploy`).
- [ ] Deploy frontend to Cloudflare Pages.
- [ ] Verify login/signup flows.
- [ ] Verify admin approve/reject and schedule CRUD.
- [ ] Verify notification list and unread counter.
- [ ] Verify push notifications on at least one Android/iOS device.
- [ ] Verify single-device login lockout behavior.

## Rollback triggers
- Login or auth failures > 5%.
- Notification delivery failures > 20%.
- Unhandled Worker 5xx spikes or D1 query errors.

## Rollback plan
1. Re-deploy last known good Worker version.
2. Revert frontend deployment to previous Pages build.
3. Invalidate active sessions if auth logic changed (`session:*`, `device:*` keys as needed).
4. Announce temporary maintenance window to admin users.
5. Re-run smoke tests before re-opening access.
