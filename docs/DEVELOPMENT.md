# 🌱 Sprout Web App

**Scan. Grow. Battle.** — the web platform for Sprout (50.003 ESC, Cohort 3 Team 2): auth, Pokédex-style plant avatar archive, GenAI sprite pipeline, PVE battles, a public almanac of 50 Singapore plants, an admin dashboard (API health, Firestore cleanup, discoveries), and a contact/query-ticket system. **Stack: TypeScript everywhere** — React + Vite (frontend) and Node.js + Express (backend), with **Cloud Firestore** as the database (Firebase Auth for login).

> 👉 **Building the frontend? Read [`md/FRONTEND_HANDOFF.md`](../md/FRONTEND_HANDOFF.md) first** — it's the fast path: run the backend, call the API, done.

This README assumes **zero prior setup** — follow it top to bottom and you'll have the backend running locally in ~10 minutes. If something breaks, check [Common problems](#common-problems) before pinging the chat.

> **Deploying or explaining hosting? Read [`md/DEPLOYMENT.md`](../md/DEPLOYMENT.md)** for the simple Vercel + Render setup, env vars, CORS, and demo auth bypass.

---

## 0. What's in this repo?

```
sprout-app/
├── md/                 ← every spec and guide lives here
│   ├── SPECS.md            ← START HERE: how the 3 spec docs work + ground rules
│   ├── requirements.md     ← WHAT to build (exact endpoints, status codes, error strings)
│   ├── process.md          ← WHY (product context, priorities, prof feedback decisions §14)
│   ├── tasks.md            ← ORDER (22 tasks with checkboxes + suggested owners)
│   ├── FRONTEND_HANDOFF.md ← frontend teammates: your fast-start guide
│   ├── DEPLOYMENT.md       ← production hosting guide (Vercel + Render)
│   ├── DESIGN.md           ← visual design source of truth
│   └── checkoff.md         ← flow-by-flow walkthrough with file:line refs
├── firestore.rules     ← Firestore security rules (deny-all; backend-only access)
├── scripts/            ← one-off tooling (the flora checklist extractor)
├── server/             ← the Express + TypeScript backend (working — see below)
└── client/             ← the React + Vite frontend
```

**Read `md/SPECS.md` first.** It explains which document wins when they disagree and the rules for working in parallel without stepping on each other.

**Everything is TypeScript.** The backend runs directly from `.ts` files via `tsx` (no build step in dev); tests use `ts-jest`. `npm run typecheck` in `server/` checks types without running.

## 1. Prerequisites (one-time)

| Tool | Check if you have it | If not |
|---|---|---|
| **Node.js 22 LTS** | run `node --version` in a terminal | install the LTS from https://nodejs.org |
| **Git** | `git --version` | https://git-scm.com/downloads |
| A terminal | PowerShell (Windows) / Terminal (Mac) | built-in |
| **Postman** *(optional)* | — | https://www.postman.com/downloads — nice GUI for testing APIs |

> **Windows note:** if `node` isn't recognised after installing, close and reopen your terminal.

## 2. First-time local setup

Follow this when you clone the repo for the first time.

### Step 1: Clone and install

```bash
git clone https://github.com/Kopi-O-Kosong-Beng/sprout-web-app.git
cd sprout-web-app
npm install
```

This installs dependencies for both workspaces:

```text
client/
server/
```

### Step 2: Create backend env file

Copy the root example env into `server/.env`:

```bash
cp .env.example server/.env
```

Windows option: copy `.env.example` in File Explorer, paste it inside
`server/`, then rename it to `.env`.

Firestore is the only application datastore. For local backend development,
get `serviceAccountKey.json` privately from Zhi Feng, place it in `server/`, and
set `FIREBASE_SERVICE_ACCOUNT_PATH=./serviceAccountKey.json`. Automated tests
need no key: they use the isolated `sprout-test` Firestore Emulator on
`127.0.0.1:8080`.

For local frontend work before Firebase login is implemented, keep this in
`server/.env`:

```text
AUTH_DEV_BYPASS=true
```

That lets local requests use:

```text
x-dev-uid: demo-user-0001
```

If Firestore is empty, seed it with:

```bash
npm run seed:firestore -w server
```

To make the auth test panel login as the seeded avatar owner, also run:

```bash
npm run seed:firebase-auth-demo -w server
```

Demo login:

```text
email: demo@sprout.app
password: Password123!
```

To create the admin login that opens the `/admin` account dashboard:

```bash
npm run seed:admin -w server
```

It reads `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` from `server/.env`, or takes
them as arguments (`-- sprout@gmail.com 'the-password'`). The account is created
with its email already verified, so no verification link has to be collected
from a shared inbox. Re-running it is safe and is also how you reset a forgotten
admin password: the uid, PVE stats and history survive.

Creating the account is not what grants access. Add `--superadmin` to set the
Firestore flag, or put the address in `SUPER_ADMIN_EMAILS` in `server/.env` (`ADMIN_EMAILS` is
an advisory badge only and opens nothing) — either
grant alone is enough, and both fail closed. The seed warns when the account
ends up with neither.

```bash
npm run seed:admin -w server -- sprout@gmail.com 'the-password' --superadmin
```

To promote someone who already has an account, use **Admin → Accounts → Make
superadmin** rather than the seed: re-running the seed resets that account's
password. See [`docs/COMMANDS.md`](COMMANDS.md) for the full command reference.
Restart the backend after editing it.

**Where login lands.** Everyone enters at `/`, the public landing page, and
that is also where a signed-in player returns — the separate `/home` hub is
archived (`HomePage.tsx` is still in the tree, nothing routes to it). After a
successful login a superadmin goes to `/admin` and everyone else goes to `/`,
unless a protected route bounced them, in which case they return to the page
they originally asked for.

**Who sees what.** One nav, three audiences:

| | visitor (signed out or unverified) | player | superadmin |
|---|---|---|---|
| Home, Ranking, Contact | open | open | open |
| Scan, Archive, PVE Battle | greyed out | open | open |
| Admin, Studio, API Test, Ticket Manager | hidden | hidden | open |

Greyed vs hidden is deliberate: greyed means "verify your account and you are
in", hidden means no amount of logging in helps, so showing it disabled would
be a lie. The frontend reads `isAdmin` / `isSuperAdmin` from
`GET /api/auth/me`; it decides navigation only, and every `/api/admin` and
`/api/platform` request re-resolves the grant server-side.

### Step 3: Create frontend env file

Copy the frontend example env:

```bash
cp client/.env.example client/.env.local
```

Windows option: copy `client/.env.example`, paste it in `client/`, then rename
the copy to `.env.local`.

For local development, `client/.env.local` should contain:

```text
VITE_API_URL=http://localhost:3001
VITE_FIREBASE_API_KEY=<from Firebase web app config>
VITE_FIREBASE_AUTH_DOMAIN=<from Firebase web app config>
VITE_FIREBASE_PROJECT_ID=<from Firebase web app config>
VITE_FIREBASE_APP_ID=<from Firebase web app config>
```

`VITE_API_URL` tells the Vite frontend where the local backend is running. The
`VITE_FIREBASE_*` values are the Firebase **web app config**, not the secret
service account. They are safe for frontend code and are needed for the auth
test panel.

### Step 4: Start the backend

> **Shortcut:** `npm run dev` at the repo root now starts the backend and the
> frontend together (via `concurrently`, with `[server]`/`[client]`-prefixed
> logs; one Ctrl-C stops both). Steps 4 and 5 describe running them in
> separate terminals, which still works and keeps the logs apart.

In terminal 1:

```bash
npm run dev:server
```

You should see:

```text
Sprout backend listening on http://localhost:3001 (Firestore)
Health check: http://localhost:3001/api/health
```

Verify backend:

```text
http://localhost:3001/api/health
```

Expected:

```json
{ "status": "ok", "timestamp": "..." }
```

### Step 5: Start the frontend

In terminal 2:

```bash
npm run dev:client
```

Vite should print a local URL, usually:

```text
http://localhost:5173
```

Open that URL in the browser.

### Step 6: Quick local checks

Backend health should work:

```bash
curl http://localhost:3001/api/health
```

Query submit should return a ticket reference:

```bash
curl -X POST http://localhost:3001/api/query/submit \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Local Smoke\",\"email\":\"local@example.com\",\"category\":\"general\",\"message\":\"Local setup test\"}"
```

Avatar demo data should work while `AUTH_DEV_BYPASS=true`:

```bash
curl http://localhost:3001/api/avatar -H "x-dev-uid: demo-user-0001"
```

See the database anytime:

```bash
npm run inspect:firestore -w server
```

### Signing in locally without a password

You do not need a real Firebase account to click through the app. On the login
page, enter:

```
email:     test@sprout.com
password:  anything at all — it is not read
```

That takes a local-only shortcut: no Firebase call, no ID token. The client
stores a "dev session" and sends `x-dev-uid` / `x-dev-email` headers, which the
backend's `AUTH_DEV_BYPASS` already understands. You land as an **operator**,
so `/admin`, `/studio` and `/test` are reachable too.

Two things have to be true for it to work, and both are already set by
[Step 2](#step-2-create-backend-env-file):

```
AUTH_DEV_BYPASS=true
SUPER_ADMIN_EMAILS=...,test@sprout.com    # the address must be on the operator allowlist
```

The operator part is not special-cased — the server derives `isSuperAdmin`
from that email through the normal allowlist, so if you take `test@sprout.com`
out of `SUPER_ADMIN_EMAILS` you still sign in, just as an ordinary player.
Handy for checking what a non-operator sees. "Log out" clears the session as
usual.

> **This cannot activate on a deployment.** The client half goes through
> `import.meta.env.DEV`, which compiles to a literal `false` in `vite build`
> (it minifies to `function(){return!1}`), so the dev session is always `null`
> and the headers are never sent. The server half independently requires
> `AUTH_DEV_BYPASS=true` **and** `NODE_ENV !== 'production'`, and `render.yaml`
> pins `AUTH_DEV_BYPASS=false`. Neither half alone opens anything: a deployed
> API refuses these headers even from a locally-run client, and a deployed
> client never sends them even against a local API.
>
> Note the shortcut is inert in the production bundle, not stripped from it —
> `test@sprout.com` and `sprout-dev-session` are readable in the shipped JS.
> Nothing relies on them being secret. Still, do not add `test@sprout.com` to
> `SUPER_ADMIN_EMAILS` (or `ADMIN_EMAILS`) on a deployed environment: that
> would make it a live operator address the moment anyone creates that
> Firebase account for real.

To act as a specific user instead — a different archive, say — set the dev
session yourself in the browser console:

```js
localStorage.setItem('sprout-dev-session',
  JSON.stringify({ uid: 'demo-user-0001', email: 'test@sprout.com' }))
```

### The almanac taxonomy

The `/almanac` page and the admin dashboard share a fixed list of 50 Singapore
plants, in `server/data/almanac-taxonomy.json`. The species are curated in
`scripts/almanac-curated.json`; their details are derived from:

> Chong, K. Y., Tan, H. T. W. & Corlett, R. T. (2009). *A Checklist of the Total
> Vascular Plant Flora of Singapore: Native, Naturalised and Cultivated
> Species.* Raffles Museum of Biodiversity Research, NUS.

`scripts/extract-flora-checklist.py` builds the file from that PDF and documents
the selection rules — only species the checklist itself calls common,
naturalised or casual; flowering plants only; families drawn round-robin so no
one family dominates. Species, family, status, origin and growth form all come
from the source. **Common names do not** — the checklist has none, so they are
hand-added in the script for the 68 species whose name is well established here,
and left null for the rest.

### Plant art

The five demo plants use hand-made art in `client/public/plants/` — a
`SPRITE_<Name>.png` creature and the `IMG_<Name>.jpg` photo it was drawn from,
which the archive shows on the specimen card. The exact filenames are listed in
the README there and named in `server/data/demo-avatar-templates.ts`, alongside
each plant's stats.

Thornback, the battle opponent, is rendered by the pipeline instead. Run this
once and commit the PNG so every deploy serves the same opponent:

```bash
npm run sprites:generate -w server                     # anything still missing
npm run sprites:generate -w server -- --force          # re-render everything
npm run sprites:generate -w server -- --only=thornback # just one
```

This needs an image-model key in `server/.env` — `FLUX_API_KEY` (or
`NVIDIA_API_KEY`) and/or `GEMINI_API_KEY`, ideally with `REMOVE_BG_API_KEY` for
a transparent cutout. Without one the script stops rather than commit the
pipeline's placeholder drawing. Missing sprites are not fatal: an avatar with no
sprite file renders as an empty pot.

## 3. Try the API

**Easiest:** use the in-app API test bench at `/api-test` (operator accounts only), or call the endpoint directly with `curl`/Postman. The old throwaway `test.html` form was removed — the test bench replaces it and is covered by the automated suite.

**Or with Postman / curl:**

```bash
curl -X POST http://localhost:3001/api/query/submit \
  -H "Content-Type: application/json" \
  -d '{"name":"Your Name","email":"you@example.com","category":"general","message":"hello"}'
```

→ returns `201 {"refNumber":"SPR-20260712-0001"}` and the row is now in the database.

**Seeded demo data:** user `demo@sprout.app` (id `demo-user-0001`) with 5 plant avatars, ready for the avatar-archive endpoints. Reseed with `npm run seed`.

**Try a protected endpoint** (avatar archive) — during dev you can stand in for the demo user with one header, no login needed:

```bash
curl http://localhost:3001/api/avatar -H "x-dev-uid: demo-user-0001"
```

→ returns the 5 seeded avatars. (This dev shortcut needs `AUTH_DEV_BYPASS=true` in `server/.env`; it's off in production. See [`md/FRONTEND_HANDOFF.md`](../md/FRONTEND_HANDOFF.md) §3.)

**Run the tests:** `npm test`. Backend integration tests run against the local
`sprout-test` Firestore Emulator and never your live Firebase project.

Two environment gotchas worth knowing before you blame the code:

- **The emulator suite needs Java 11+.** On an older JDK the emulator exits
  immediately and no test runs. `java -version` to check. This is the suite that
  covers the auth, admin and ticket APIs, so it is the one to get working.
- **On Windows, vitest's default fork pool times out.** Run the client suite as
  `npx vitest run --pool=threads --no-file-parallelism` from `client/`.

Every command in the repo, with these caveats spelled out: [`docs/COMMANDS.md`](COMMANDS.md).

## 4. Current API (more coming — check back)

| Method | Endpoint | Auth | What it does |
|---|---|---|---|
| GET | `/api/health` | — | liveness ping |
| POST | `/api/auth/signup` | — | create Firebase Auth user + profile |
| GET | `/api/auth/me` | Bearer token | current authenticated profile |
| POST | `/api/auth/request-reset` | — | send 6-digit OTP via email log/SMTP |
| POST | `/api/auth/verify-reset` | — | verify OTP and update password |
| POST | `/api/auth/sign-in-method` | — | after a failed login: is this address Google-only? |
| POST | `/api/query/submit` | — | create query ticket → `{refNumber}` |
| POST | `/api/query/status` | — | check one ticket with its refNumber + filing email |
| GET | `/api/leaderboard` | optional | XP and discovery boards; a login adds your own standing |
| GET | `/api/avatar` | Bearer token | list caller's avatars (paginated) |
| GET | `/api/avatar/:id` | Bearer token | one avatar (ownership-checked) |
| POST | `/api/avatar` | Bearer token | save a scanned plant into the archive |
| GET | `/api/almanac` | **—** | the 50-species almanac: found / not found + tallies |
| GET | `/api/almanac/:speciesId` | optional | one species; a login adds the finder, date and photo |
| POST | `/api/battle/pve/start` | Bearer token | start a PVE battle with one of your avatars |
| GET/POST | `/api/battle/pve/:sessionId`(`/action`, `/abandon`) | Bearer token | read a session, take a turn, concede |
| POST | `/api/pipeline/run-stream` | Bearer token | the 4-hop sprite pipeline, streamed as SSE |
| GET | `/api/admin/users`, `/api/admin/almanac` | Bearer + superadmin | accounts; taxonomy with finders |
| PATCH | `/api/admin/users/:uid/superadmin` | Bearer + superadmin | grant / revoke the operator grant |
| GET | `/api/admin/tickets` | Bearer + superadmin | the Ticket Manager queue |
| PATCH | `/api/admin/tickets/:id/status` | Bearer + superadmin | resolve / reopen, stamps the reply time |
| POST | `/api/admin/cleanup` | Bearer + superadmin | dry-run / delete expired web uploads |
| GET | `/api/platform/*` | Bearer + superadmin | pipeline portal: config, live provider health, tests |

Two of these are deliberately unlike the rest. `GET /api/almanac` takes no auth
at all — it is the landing page's centrepiece and is shown to visitors who have
never signed up, so it carries the taxonomy and a found/not-found flag and
nothing a player contributed. `GET /api/almanac/:speciesId` takes *optional*
auth: anyone may see a species, the sprite the game made of it and its battle
stats, while the finder's display name, the discovery date and their own
photograph need a login. That split is the privacy model, and
[`md/FRONTEND_HANDOFF.md`](../md/FRONTEND_HANDOFF.md) documents the exact shapes.

The **exact** request/response contracts (status codes, error strings, limits like "5 MB", "10 attempts / 15 min") live in `md/requirements.md` — the tests assert those exact values, so code against the doc, not from memory. Frontend integration details: [`md/FRONTEND_HANDOFF.md`](../md/FRONTEND_HANDOFF.md).

## 5. The database story (IMPORTANT — read once)

The database is Cloud Firestore, shared with the Sprout mobile app. Runtime code
always uses the Firebase Admin repositories in `server/repositories/`; services
and controllers depend on repository interfaces instead of Firebase Admin
directly. Local automated tests use the Firebase Emulator. Full setup steps:
[`server/FIREBASE_SETUP.md`](../server/FIREBASE_SETUP.md).

**Auth (for frontend work):** users sign in with the **Firebase JS SDK** in the React app, grab the ID token, and send it as `Authorization: Bearer <idToken>` on every protected API call. The current demo flow uses email/password; other Firebase sign-in providers can be added later without changing the backend token-verification pattern.

## Production auth, email, and storage

Render declares SMTP delivery but does not store credentials in `render.yaml`. For `hello.sprout.team@gmail.com`, enable Google 2-Step Verification, create a Google Account -> Security -> App passwords entry named `Sprout Backend`, and place the resulting 16-character app password only in local `server/.env` (`SMTP_PASS`) and Render's secret environment dashboard. With it configured, run `npm.cmd run check:email -w server`; a live SMTP preflight is successful only when it prints `[email-check] mode=smtp verified=true`.

Before deployment, add the Vercel domain in Firebase Console -> Authentication -> Settings -> Authorized domains and set Render `FRONTEND_URL` to that HTTPS origin. Verification links must point to `https://<vercel-domain>/verify-email?...`, and the page must successfully apply the Firebase action code. Firebase remains the authority for identity: the client sends Firebase ID tokens and the backend verifies them.

Firebase Storage is active at `sprout-dev-66f08.firebasestorage.app`, and it is the only place sprites go — every scan writes there through `server/services/sprite-storage.ts`. `FIREBASE_STORAGE_BUCKET` is therefore required, not optional: without it the whole scan-to-archive path throws and the player is told their plant could not be saved.

`STORAGE_MODE` used to appear here as a pin holding that back. No code ever read it, so it has been removed from `render.yaml` and `.env` rather than left looking load-bearing. The live Node 22 Admin preflight passed write, exact read-back and deletion on 2026-07-21 (`npm run check:storage -w server` re-runs it). That proves backend credential and bucket access only — Admin SDK requests bypass client Security Rules, and the direct client rules remain untested. Details in [`server/FIREBASE_SETUP.md`](../server/FIREBASE_SETUP.md).

## 6. Backend layout (where to put things)

```
server/
├── app.ts              ← Express wiring (CORS, rate limit, routers, error handler)
├── server.ts           ← Firestore-backed entry point listening on :3001
├── routes/             ← URL definitions + validation schemas
├── controllers/        ← request/response handling, no business logic
├── services/           ← business logic (ticket refs, emails, battle math…)
├── repositories/       ← Firebase Admin persistence adapters
├── models/             ← TypeScript domain types + repository interfaces
├── middleware/         ← auth (Firebase ID tokens), validation, errors
├── data/               ← deterministic demo avatar templates
├── scripts/            ← Firestore seeds, inspection, and preflight utilities
├── firebase.ts         ← Firebase Admin SDK init (lazy)
└── tests/              ← Jest + Supertest (ts-jest)
```

Rule of thumb: routes stay thin → controllers translate HTTP → services do the thinking → repositories do the storing.

## 7. Team workflow

1. Claim your task in `md/tasks.md` (suggested owners are at the top) — put your name
2. Branch: `git checkout -b feat/task-<n>-<slug>` (e.g. `feat/task-14-avatar-archive-ui`)
3. Code against `md/requirements.md`. Keep `USE_MOCK_APIS=true` in `server/.env` unless you are deliberately exercising the real pipeline — it withholds every upstream credential, so Plant.id, Gemini, NVIDIA and withoutBG are never called and a scan costs nothing. A mocked run finishes in well under a second against ~13s live, and ends with `renderSource: "placeholder"`. Set it to `false` when you need real art, and remember each run spends quota on five services.
4. Done = happy path + error paths work, your module's tests pass, `npm run dev` still boots
5. Push your branch → open a Pull Request on GitHub → someone else eyeballs it → merge
6. `git pull` main regularly so integration stays boring

## Common problems

| Symptom | Fix |
|---|---|
| `EADDRINUSE :::3001` on start | Something else is on port 3001. Either stop it, or run with another port: `PORT=3002 npm run dev` (PowerShell: `$env:PORT=3002; npm run dev`) — remember the frontend then needs the new port |
| `'node' is not recognized` | Install Node LTS, then **reopen** the terminal |
| `Cannot find module ...` | You skipped `npm install`, or you're in the wrong folder — run it from the repo root |
| Startup error mentioning Firebase / credentials | Configure one Firebase Admin credential method from `.env.example`; automated tests use the emulator and need no key |
| `The query requires an index` from Firestore | shouldn't happen with current code (we sort in-memory); if a new query hits it, click the link in the error to create the index, or sort in the app |
| `401 Unauthorised` on `/api/avatar` | preferred: login in the auth test panel and send the Firebase ID token. Fallback: send `x-dev-uid: demo-user-0001` in dev with `AUTH_DEV_BYPASS=true` |
| Frontend says "Backend not reachable" | Backend isn't running (`npm run dev`), or it's on a different port |
| "Failed to fetch" in browser but Postman works | CORS — dev server allows origins `:5173` and `:5500` only; serve your page from one of those (Vite / Live Server) |
| `.env` questions | Never commit `server/.env` or `serviceAccountKey.json`. They're gitignored on purpose. `.env.example` shows what keys exist |

Still stuck? Share only the minimal relevant, sanitized error lines. Redact tokens, OTPs, email addresses, environment values, local paths, and service-account details before posting anything to the group chat.

## Related repos

- 🎨 **[Sprout_Dev_Platform](https://github.com/Neonat/Sprout_Dev_Platform)** — where the GenAI sprite pipeline and its operations portal come from. Both were migrated into this repo (`server/pipeline/`, `server/platform/`, `client/src/studio/`) rather than kept as a third app, and changes made there since are ported across periodically. The two copies are intentionally not identical: this one keeps its verified-login + superadmin gate on the portal, accepts either spelling of each provider key, and adapts a handful of lines to this repo's stricter tsconfig. Commit messages on the ports record every deliberate divergence.
- 📚 **[sprout-knowledge-base](https://github.com/Kopi-O-Kosong-Beng/sprout-knowledge-base)** — the team's Obsidian vault: rubrics, use cases, design decisions, prof feedback, Q&As. When you wonder "why is it built this way?", the answer is there.
