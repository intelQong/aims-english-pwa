# AIMS English PWA — Codex Summary

## Project Overview
A Progressive Web App (PWA) for AIMS English institute (British Council affiliated, Chattogram, Bangladesh).
Single HTML file app with role-based access: Student view and Admin view.
Backend: Cloudflare Worker. Database: Cloudflare D1 (SQLite). Sessions/Push: Cloudflare KV.

---

## File Structure
```
aims-pwa/
  index.html        — Full PWA (student + admin, role-based, logo embedded as base64 WebP)
  sw.js             — Service Worker (offline support + push notification display)
  manifest.json     — PWA manifest (name, icons, theme)
  worker.js         — Cloudflare Worker API (all backend logic)
  schema.sql        — D1 database schema (run once in Cloudflare D1 Console)
  wrangler.toml     — Worker deployment config (fill in D1 ID and KV ID)
  icons/            — PWA icons: 72, 96, 128, 192, 512px (teal background + shield logo)
  SETUP-GUIDE.docx  — Full mobile-friendly setup tutorial
```

---

## Brand Colors
- Teal (primary): #1D6B7A
- Gold (accent):  #BF8C4C
- Background:     #f7f5f0
- Danger:         #c0392b
- Success:        #27ae60

---

## Database Schema (D1 — SQLite)

### users table
| Column           | Type    | Notes                                      |
|------------------|---------|--------------------------------------------|
| id               | TEXT PK | UUID                                       |
| first_name       | TEXT    |                                            |
| last_name        | TEXT    |                                            |
| email            | TEXT    | UNIQUE                                     |
| phone            | TEXT    |                                            |
| password_hash    | TEXT    | SHA-256 hex                                |
| role             | TEXT    | 'student' or 'admin' (admin is env var)    |
| status           | TEXT    | 'pending', 'approved', 'rejected'          |
| course_type      | TEXT    | e.g. 'IELTS Academic', 'Spoken English'    |
| enrollment_date  | TEXT    | ISO date string                            |
| course_fee       | INTEGER | Total fee in BDT                           |
| amount_paid      | INTEGER | Total paid so far                          |
| total_mocks      | INTEGER | Total mock tests assigned                  |
| completed_mocks  | INTEGER | Mocks completed                            |
| services         | TEXT    | JSON: {chat_club, movie_club, mock_tests, coaching} |
| last_payment_date| TEXT    | ISO date string or null                    |
| created_at       | TEXT    | ISO datetime                               |

### notifications table
| Column     | Type    | Notes                        |
|------------|---------|------------------------------|
| id         | TEXT PK | UUID                         |
| target     | TEXT    | 'all' or 'student'           |
| student_id | TEXT    | null if target='all'         |
| title      | TEXT    |                              |
| body       | TEXT    |                              |
| created_at | TEXT    | ISO datetime                 |

### schedule table
| Column     | Type       | Notes           |
|------------|------------|-----------------|
| id         | INTEGER PK | AUTOINCREMENT   |
| name       | TEXT       | Class name      |
| day        | TEXT       | e.g. 'Saturday' |
| time       | TEXT       | e.g. '10:00'    |
| room       | TEXT       |                 |
| instructor | TEXT       |                 |

---

## KV Keys (Cloudflare KV — binding: AIMS_KV)
| Key pattern       | Value                        | TTL       |
|-------------------|------------------------------|-----------|
| session:{userId}  | JWT token string             | 30 days   |
| device:{userId}   | deviceId string              | 30 days   |
| push:{userId}     | JSON push subscription       | 60 days   |
| read:{userId}     | JSON array of notification IDs| 30 days  |

---

## Environment Variables / Secrets (Cloudflare Worker)
| Name             | Description                                      |
|------------------|--------------------------------------------------|
| ADMIN_EMAIL      | Admin login email (not stored in DB)             |
| ADMIN_PASSWORD   | Admin login password                             |
| JWT_SECRET       | Secret for signing JWT tokens (long random str)  |
| VAPID_PUBLIC_KEY | Web push VAPID public key (starts with B...)     |
| VAPID_PRIVATE_KEY| Web push VAPID private key                       |
| VAPID_SUBJECT    | Contact email: mailto:admin@aims-english.com     |

---

## API Endpoints (Cloudflare Worker)

### Public (no auth)
| Method | Path           | Body                              | Returns          |
|--------|----------------|-----------------------------------|------------------|
| POST   | /auth/signup   | {first,last,email,phone,password} | {ok}             |
| POST   | /auth/login    | {email,password,deviceId}         | {ok,token,user}  |
| POST   | /auth/logout   | {userId}                          | {ok}             |
| POST   | /auth/verify   | {token,userId}                    | {ok,user}        |

### Authenticated (Bearer token required)
| Method | Path                        | Returns                     |
|--------|-----------------------------|-----------------------------|
| GET    | /student/me                 | {ok,student}                |
| GET    | /schedule                   | {ok,classes:[]}             |
| GET    | /notifications              | {ok,notifications:[]}       |
| GET    | /notifications/unread-count | {ok,count}                  |
| POST   | /notifications/mark-read    | {ok}                        |
| POST   | /push/subscribe             | {ok}                        |

### Admin Only (Bearer token + admin role)
| Method | Path                           | Notes                        |
|--------|--------------------------------|------------------------------|
| GET    | /admin/stats                   | Overview counts and totals   |
| GET    | /admin/students                | All students                 |
| POST   | /admin/students                | Create student manually      |
| GET    | /admin/students/:id            | Single student               |
| PUT    | /admin/students/:id            | Update student               |
| DELETE | /admin/students/:id            | Remove student               |
| POST   | /admin/students/:id/approve    | Approve pending student      |
| POST   | /admin/students/:id/reject     | Reject and delete student    |
| POST   | /admin/notify                  | Send notification + push     |
| GET    | /admin/notifications           | Notification history         |
| POST   | /admin/schedule                | Add class                    |
| DELETE | /admin/schedule/:id            | Remove class                 |

---

## Student Portal Features
- Splash screen with AIMS English logo
- Login / Register (pending admin approval on register)
- Dashboard: welcome card, enrollment date, course type badge, stats grid (total mocks, completed, total paid, amount due), course inclusions (Chat Club, Movie Club, Mock Tests, 1-on-1 Coaching)
- Schedule: grouped by day, shows time, class name, instructor, room
- Notifications: list with unread indicator (gold dot), mark all read
- Payment: due amount summary card, full breakdown (course type, fee, paid, due, last payment, enrollment date)
- Single device login enforcement (blocked if logged in elsewhere)
- Push notification support (Web Push API via VAPID)
- Installable PWA (Add to Home Screen on Android and iPhone)

## Admin Portal Features
- Overview stats: total students, pending, students with dues, total paid ৳, total due ৳, total mocks
- Quick actions: send notification, view students with dues, review pending
- Students tab:
  - Search by name or email
  - Filter buttons: All / Has Dues / Fully Paid / IELTS / Spoken / General
  - Students with dues highlighted with red left border and due badge
  - Edit: all student fields including course type, fees, payment, services
  - Remove student
- Pending tab: approve or reject new registrations
- Notifications tab: send to all or specific student, view history
- Schedule tab: add/remove classes

---

## Course Types Available
- IELTS Academic
- IELTS General
- Spoken English
- General English
- Business English
- Kids English

---

## Two-Line Config Change Before Deploying Frontend
In index.html, find and replace:
```
const API = 'https://aims-worker.YOUR-SUBDOMAIN.workers.dev';
const VAPID_PUBLIC_KEY = 'YOUR_VAPID_PUBLIC_KEY_HERE';
```

---

## Deployment Steps Summary
1. Create Cloudflare D1 database named `aims-db` → run schema.sql in Console → copy database_id
2. Create Cloudflare KV namespace named `AIMS_KV` → copy id
3. Paste both IDs into wrangler.toml
4. Upload all files to GitHub repo
5. Generate VAPID keys: open web-push-codelab.glitch.me → copy Public Key and Private Key
6. Set 6 secrets in Cloudflare Worker Settings > Variables (ADMIN_EMAIL, ADMIN_PASSWORD, JWT_SECRET, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT)
7. Deploy worker: run `wrangler deploy` (Termux on Android / iSH on iPhone / GitHub Actions)
8. Connect GitHub repo to Cloudflare Pages → deploy frontend
9. Update index.html with Worker URL and VAPID Public Key
10. Test: register student → approve as admin → login as student

---

## Single Device Login Logic
On login: Worker stores JWT in KV as `session:{userId}` and deviceId as `device:{userId}`.
On subsequent login from same device: allowed (same deviceId).
On login from different device while session exists: returns error "Already logged in on another device."
Force clear: delete `session:{userId}` and `device:{userId}` from KV.

## Push Notification Flow
1. Student opens PWA → browser asks for notification permission
2. On allow: browser creates push subscription (endpoint + keys)
3. Subscription sent to Worker → stored in KV as `push:{userId}`
4. Admin sends notification → Worker fetches all push subscriptions → sends via Web Push API
5. Service worker receives push event → shows native device notification

---

## Contact
AIMS English — Lucy Square Level 3, Mehedibag, Chattogram
www.aims-english.com | British Council Affiliated
AdSense publisher: ca-pub-7271437521398641


## Binary Compatibility Note
This text-only repository variant omits binary assets (`icons/*.png`, setup guide `.docx`) to avoid binary-diff issues in constrained review tools. Add them back in a binary-capable delivery channel before production release.
