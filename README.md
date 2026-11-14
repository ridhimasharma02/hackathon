# Civic Lens

**Snap a civic hazard, pin it with GPS, and let the city fix the most dangerous problems first.**

Civic Lens is a citizen reporting app for urban infrastructure problems: potholes, broken streetlights, sewer overflows and traffic hazards. A citizen takes a photo and the app geotags it. It checks whether someone already reported the same problem nearby and gives the report a priority score, so a pothole outside a hospital rises above one on a quiet lane.

Built as a hackathon project. It runs on one Node.js server with no database server, no build step and no external accounts.

---

## Why

Municipal complaint portals tend to fail in the same three ways:

1. **Duplicates.** Fifty people report the same pothole and get fifty tickets, so crews can't tell what is actually urgent.
2. **First come, first served.** A dark alley and a blind turn next to a school wait in the same queue.
3. **No closure.** Citizens never hear back, so they stop reporting.

Civic Lens addresses each one:

| Problem | Civic Lens |
|---|---|
| Duplicate reports | **30 m proximity check.** A new report of the same category within 30 m becomes a +1 upvote and an extra photo on the existing ticket. |
| Flat queue | **Multi-factor priority score (0–100)** from distance to hospitals, schools and traffic hubs, community votes, urgency and age. |
| No feedback | **Notifications** when a report is registered and when it is resolved, followed by a 1–5 star rating of the repair. |

---

## Features

- **Citizen sign-in in four ways:** mobile OTP, email and password (bcrypt-hashed), one-click demo "Google" sign-in, or guest.
- **Snap & Report:** pick a category and attach a photo. The location comes from live device GPS or from a demo preset.
- **Verification step:** before a ticket is created, the server finds the nearest critical zone and checks for a duplicate within 30 m. It also previews the priority score and SLA.
- **Duplicate handling:** if a match is found, the citizen chooses to *support* it (+1 vote and a photo), *escalate* it (mark it urgent), or file it as a different issue.
- **Track & Upvote:** a public list of tickets with search, filtering by category and zone, and sorting by priority, votes or newest.
- **Live Map:** Leaflet map with every ticket and circles for the critical zones.
- **Priority Queue dashboard:** a dispatch view ranked by score, with total tickets, critical count, total votes and average resolution time.
- **Resolution and rating:** "Simulate Municipal Resolution" closes a ticket, notifies the reporter and opens a star-rating modal with feedback chips.
- **Notifications:** per-citizen history behind the bell icon, stored on the server.
- **Giraffe 🦒:** a keyword-based in-app guide that answers questions about the app.
- **Light and dark theme**, plus animations from [Motion](https://motion.dev).

---

## How priority is scored

All scoring happens on the server in [`utils/priority.js`](utils/priority.js). The browser never computes a score.

```
score = 15                                  base
      + zone bonus (if inside a critical zone)
          Hospital / Emergency   ≤ 200 m  → +45
          School / College       ≤ 150 m  → +35
          Traffic corridor       ≤ 180 m  → +30
      + votes × 5                           community support
      + 40 if flagged as an urgent hazard
      + min(days old × 3, 20)               aging, capped
score = min(score, 100)
```

| Score | SLA |
|---|---|
| ≥ 80 | 🚨 Critical: 12–24 h |
| ≥ 50 | ⚡ High: 48 h |
| ≥ 30 | 🟡 Medium: 72 h |
| < 30 | 🟢 Standard: 5 days |

Distances for zone matching and the 30 m duplicate check both use the haversine formula. The critical zones (AIIMS, DPS, Ring Road and others) are configured in [`utils/zones.js`](utils/zones.js).

---

## Tech stack

| Layer | Tech |
|---|---|
| Backend | Node.js 18+, Express 4 |
| Auth | JWT (`jsonwebtoken`, 7-day tokens), `bcryptjs` |
| Uploads | `multer`: images only, 8 MB max, stored on local disk |
| Storage | JSON file store (`data/db.json`), created and seeded on first boot |
| Frontend | Plain HTML, CSS and JavaScript (ES modules), no framework or bundler |
| Map | Leaflet 1.9.4 |
| Animation | Motion (loaded from a CDN) |

The frontend and API are served by the same Express server on the same origin, so there is no CORS setup and no second process.

---

## Quick start

Requires **Node.js 18 or later**.

```bash
git clone https://github.com/ridhimasharma02/hackathon.git
```

```bash
cd hackathon
```

```bash
cp .env.example .env
```

Open `.env` and set `JWT_SECRET` to a long random string.

```bash
npm install
```

```bash
npm start
```

Open **http://localhost:5050**. That one URL serves the whole app.

| Script | What it does |
|---|---|
| `npm start` | Runs the server |
| `npm run dev` | Runs with `node --watch` and restarts on file changes |
| `npm run seed:reset` | Resets `data/db.json` to the four seed tickets |

### Environment variables

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `5050` | Port for the API and the frontend |
| `JWT_SECRET` | dev fallback | **Change this** before any shared demo |
| `NODE_ENV` | `development` | In `production`, the OTP is no longer returned in the API response |

---

## Demo walkthrough

1. **Sign in.** Mobile OTP is the most realistic option. No SMS is sent: the code is printed in the server console, and outside `production` it is also pre-filled in the form.
2. **Report.** Choose a category, attach a photo, and pick a location preset such as *Near Hospital*. The score jumps because of the zone bonus.
3. **Trigger a duplicate.** Pick the preset *Duplicate Spot: MG Road Pothole* with category *Pothole*. The 30 m match modal shows the existing ticket.
4. **Track & Upvote.** Upvote a ticket and watch it move up the priority sort.
5. **Live Map.** See every ticket and the critical-zone circles.
6. **Resolve.** On one of your tickets, click *Simulate Municipal Resolution*. You get a notification and the rating modal opens.
7. **Priority Queue.** The dispatcher view ranked by score.

To start over, run `npm run seed:reset` or delete `data/db.json`, then restart the server.

---

## API overview

`(auth)` means the route needs `Authorization: Bearer <token>`. `(form)` means `multipart/form-data`.

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/health` | Health check |
| GET | `/api/zones` | Categories, critical zones, duplicate threshold |
| POST | `/api/auth/otp/request` | Send OTP (logged to the console) |
| POST | `/api/auth/otp/verify` | Verify OTP → `{ token, user }` |
| POST | `/api/auth/email/register` | Register with email |
| POST | `/api/auth/email/login` | Log in (first login auto-registers) |
| POST | `/api/auth/demo-google` | Demo Google sign-in |
| POST | `/api/auth/guest` | Guest account |
| GET | `/api/auth/me` | Current user (auth) |
| GET | `/api/tickets` | List tickets: `?search=&sort=priority\|votes\|newest&cat=&zone=` |
| GET | `/api/tickets/:id` | One ticket |
| POST | `/api/tickets/analyze` | Preview zone, duplicate and score (auth) |
| POST | `/api/tickets` | Create a ticket (auth, form). Returns `409` if a duplicate is found, unless `force=true` |
| POST | `/api/tickets/:id/support` | +1 vote and a photo (auth, form) |
| POST | `/api/tickets/:id/escalate` | +1 vote and mark urgent (auth, form) |
| POST | `/api/tickets/:id/upvote` | Toggle your vote (auth) |
| POST | `/api/tickets/:id/resolve` | Mark completed and notify the reporter (auth) |
| POST | `/api/tickets/:id/rating` | `{ stars, chips, comment }` (auth) |
| GET | `/api/dashboard/stats` | Totals for the Priority Queue |
| GET | `/api/notifications` | Your notifications (auth) |
| POST | `/api/notifications/read-all` | Mark all as read (auth) |

[`backend.txt`](backend.txt) has request and response shapes, the step-by-step report flow, and the reasoning behind design choices.

---

## Project structure

```
.
├── server.js                    Express app: middleware, routes, static frontend
├── db.js                        JSON-file store (load / persist / reset)
├── middleware/auth.js           JWT sign/verify, attachUser, requireAuth
├── routes/
│   ├── auth.routes.js           OTP, email, demo Google, guest, /me
│   ├── tickets.routes.js        List, analyze, create, support, escalate, upvote, resolve, rate
│   ├── dashboard.routes.js      Priority Queue stats
│   └── notifications.routes.js  Notification list and read-all
├── utils/
│   ├── zones.js                 Categories and critical-zone config
│   └── priority.js              Haversine, zone detection, scoring, SLA
├── public/
│   ├── index.html
│   ├── css/styles.css
│   └── js/script.js             All frontend logic and Motion animations
├── data/                        db.json, created at runtime (gitignored)
├── uploads/                     Report photos, created at runtime (gitignored)
└── backend.txt                  Detailed architecture and API notes
```

---

## Limitations and next steps

This is a hackathon demo. These gaps are known and deliberate:

- **No SMS gateway or real Google OAuth.** OTP codes go to the console, and the Google button signs in to one fixed demo account. Adding either needs only credentials, not new architecture.
- **JSON-file storage.** Fine for a demo. Only `db.js` touches storage, so swapping in a real database is a change to that one file.
- **Photos on local disk.** Moving to object storage (for example S3) is needed before running more than one instance.
- **No rate limiting** on the OTP endpoint.
- **Notifications are fetched after each action, not pushed.** A multi-user deployment would want WebSockets or SSE.
- **The "AI verification" step is rule-based** (geospatial distance checks), not a trained model. Image classification of the photo is a natural next step.
- **No municipal or admin role.** In the demo, the citizen also plays the crew that resolves tickets.
- **No automated tests.**
