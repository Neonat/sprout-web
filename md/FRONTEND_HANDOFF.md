# Frontend Handoff

This is the fast-start guide for teammates building the real React UI.

## What Exists Today

The repo already has:

```text
client/  -> React + Vite test app
server/  -> Express + TypeScript backend
Firebase -> Firestore + Firebase Auth
```

The current React app is intentionally a **backend test page**, not the final
product UI. It exists so frontend/design teammates can see the API flows working
before building polished screens.

## First Local Run

From the repo root:

```bash
npm install
cp .env.example server/.env
cp client/.env.example client/.env.local
```

Windows option: copy the files in Explorer and rename the copies manually.

Backend env:

```text
server/.env
FIREBASE_SERVICE_ACCOUNT_PATH=./serviceAccountKey.json
AUTH_DEV_BYPASS=true
EMAIL_MODE=console
```

Put the private backend service account at:

```text
server/serviceAccountKey.json
```

Never commit that file.

Frontend env:

```text
client/.env.local
VITE_API_URL=http://localhost:3001
VITE_FIREBASE_API_KEY=<Firebase web config>
VITE_FIREBASE_AUTH_DOMAIN=<Firebase web config>
VITE_FIREBASE_PROJECT_ID=<Firebase web config>
VITE_FIREBASE_APP_ID=<Firebase web config>
```

The `VITE_FIREBASE_*` values are the Firebase **web app config**, not the
backend service account. They are safe to use in frontend code.

Run:

```bash
npm run dev:server
npm run dev:client
```

Use two terminals.

## Demo Auth User

To test login with real Firebase Auth and still see seeded avatars:

```bash
npm run seed:firestore -w server
npm run seed:firebase-auth-demo -w server
```

Then use:

```text
email: demo@sprout.app
password: Password123!
```

This Firebase Auth user has UID:

```text
demo-user-0001
```

That matches the seeded avatar owner.

## Auth Flow For The Real UI

The real frontend should use Firebase-first auth:

```text
1. User signs up through POST /api/auth/signup.
2. Backend creates Firebase Auth user and sends verification link.
3. User opens verification link from email.
4. Frontend logs in with Firebase JS SDK.
5. Frontend gets Firebase ID token.
6. Frontend sends Authorization: Bearer <idToken> to protected backend routes.
```

Login example:

```ts
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';

const auth = getAuth(initializeApp(firebaseConfig));
const cred = await signInWithEmailAndPassword(auth, email, password);
const idToken = await cred.user.getIdToken();

api.defaults.headers.common.Authorization = `Bearer ${idToken}`;
```

Protected route example:

```ts
const { data } = await api.get('/api/avatar', {
  headers: { Authorization: `Bearer ${idToken}` },
});
```

## Auth Endpoints

Base URL locally:

```text
http://localhost:3001
```

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/auth/signup` | none | Create Firebase user + backend profile |
| `GET` | `/api/auth/me` | Bearer token | Get current profile |
| `POST` | `/api/auth/request-reset` | none | Send OTP to email/log |
| `POST` | `/api/auth/verify-reset` | none | Verify OTP and update password |
| `GET` | `/api/avatar` | Bearer token | Fetch current user's avatars. Each record's `spriteUrl` is overlaid with the species' currently-published dex sprite (resolved on read), so a dex-gate publish shows up on the next archive load — no client change and no response-shape change. |
| `POST` | `/api/avatar` | Bearer token | Save a scanned plant into the archive |
| `DELETE` | `/api/avatar/:avatarId` | Bearer token | Remove one owned avatar (archive shovel); 204 on success, 404 if not yours |
| `POST` | `/api/query/submit` | none | Submit contact/query ticket |
| `GET` | `/api/almanac` | **none** | 50-species almanac: taxonomy + found/not-found + counts |
| `GET` | `/api/almanac/:speciesId` | Bearer token | Adds the first finder, the date and their photo |
| `GET` | `/api/admin/almanac` | Bearer token + ADMIN_EMAILS | Full taxonomy with finders, plus off-list discoveries |
| `POST` | `/api/admin/cleanup` | Bearer token + ADMIN_EMAILS | Dry-run/delete expired web uploads |
| `GET` | `/api/platform/health-check` | Bearer token + ADMIN_EMAILS | Live upstream provider probes |
| `GET` | `/api/platform/logs` | Bearer token + superadmin | In-memory admin log ring, fed by real pipeline runs (identify/prompt/render/cutout/eval/persist per scan) |
| `GET` | `/api/platform/metrics` | Bearer token + superadmin | Per-API latency/request/error metrics (`{ apis: [{api, requests, errors, avgMs, p50Ms, p95Ms, maxMs, recent}] }`, slowest-first) |
| `GET` | `/api/platform/metrics-report` | Bearer token + superadmin | Exportable observability report: `{ current: {metrics, logs}, previousRuns: [...] }` — previous runs come from `platform_run_reports`, flushed periodically and on SIGTERM, so the report covers data from before the last redeploy |
| `GET` | `/api/platform/dex-docs` | Bearer token + superadmin | Real dex species with their sprite candidates: `{ species: [{speciesKey, speciesName, discoveryCount, spriteUrl, candidates: [...]}] }` |
| `POST` | `/api/platform/dex-approve` | Bearer token + superadmin | `{candidateId, action: 'publish'\|'reject'}` — publish swaps `dex.spriteUrl` (the global reference) atomically; rejecting the published sprite is a 409 |

## Saving A Scan (`POST /api/avatar`)

What the Scan screen sends after a pipeline run finishes, via
`createAvatar()` in `client/src/services/sproutApi.ts`:

```json
{
  "speciesName": "Monstera deliciosa",
  "speciesFamily": "Araceae",
  "spriteDataUrl": "data:image/png;base64,...",
  "photoDataUrl": "data:image/jpeg;base64,...",
  "source": "mobile",
  "metadata": {
    "taxonomy": { "Family": "Araceae" },
    "commonNames": ["Swiss cheese plant"],
    "description": "...",
    "confidence": 0.91
  }
}
```

- **`source` decides how long the record lives**, and is required — there is no
  default, because a mislabelled client must not be able to quietly grant an
  upload permanence. `mobile` is an IRL camera scan and is kept; `web` is a file
  upload and becomes the 24 h `TempAvatar` of requirements.md 6.12. The single
  rule lives in `server/data/capture-source.ts`; the archive shows it as an
  "IRL Scan" / "Web Upload" badge.
- The finished 192×192 PNG travels on the record itself — there is no object
  store wired up — so the sprite must be a `data:image/png;base64,` URL under
  512 000 characters. Anything else is a 400.
- `photoDataUrl` is optional: a downscaled JPEG of the original photo, under
  300 000 characters, stored as `metadata.photoUrl` and shown on the specimen
  card. The demo plants use the same slot, pointing at files in
  `client/public/plants/` instead.
- Battle stats are **not** accepted from the client: the server derives them
  from the species name and family (`services/avatar-stats.ts`), so the same
  species always yields the same creature.
- Unlisted `metadata` keys are stripped.
- Responds `201` with the created `AvatarRecord` (plus `battleEligible`), the
  same shape `GET /api/avatar` returns. Capped at 30 saves per account per hour.

## The Almanac (`GET /api/almanac`)

50 Singapore plants, and which of them players have brought in.

- **The list endpoint is public and deliberately anonymous.** It backs the
  `/almanac` page, shown to visitors who have never signed up, so it returns
  the taxonomy plus `discovered` and `discoveryCount` and *nothing a player
  contributed* — no uid, no display name, no photograph.
- **`GET /api/almanac/:speciesId` requires a login**, and is the only place the
  finder's name, the discovery date and their original photo appear. That split
  is the privacy model: anyone can see Tembusu has been found three times; you
  have to sign in to see who found it and what they photographed.
- Discoveries are recorded as a side effect of `POST /api/avatar`. The response
  carries an `almanac` object — `{ speciesId, commonName, firstDiscovery }` —
  when the scanned species is one of the 200, and `null` when it is not. A
  failure to record never fails the save.
- First discovery is claimed in a Firestore transaction keyed on the species, so
  two simultaneous scans cannot both claim it. The finder's display name is
  snapshotted at discovery time and does not follow a later rename.
- The taxonomy is fixed data (`server/data/almanac-taxonomy.json`) from the
  published Chong, Tan & Corlett (2009) checklist. `scripts/extract-flora-checklist.py`
  regenerates it and documents the selection rules.

## Password Reset Flow

For local demo, `EMAIL_MODE=console` prints the OTP in the backend terminal.

Frontend flow:

```text
1. User enters email.
2. Call POST /api/auth/request-reset.
3. User enters OTP from email.
4. User enters new password.
5. Call POST /api/auth/verify-reset.
6. User logs in with Firebase using the new password.
```

The backend always returns success from request-reset even if the email is not
registered. That avoids leaking account existence.

## Temporary Dev Bypass

The old avatar test can still use:

```text
x-dev-uid: demo-user-0001
```

That only works when:

```text
AUTH_DEV_BYPASS=true
NODE_ENV is not production
```

The real UI should use Firebase ID tokens instead.

## Common Problems

| Problem | Fix |
|---|---|
| Frontend calls `localhost:3001` in production | Set `VITE_API_URL` in Vercel and redeploy |
| Login button says Firebase config missing | Fill `client/.env.local` with `VITE_FIREBASE_*` values |
| `/api/auth/me` returns `401` | No Firebase ID token was sent |
| `/api/auth/me` returns `403` | User email is not verified yet; open verification link and refresh token |
| Avatar list is empty after login | Use the seeded demo user or create avatars for that Firebase UID |
| Reset OTP not visible | Check backend terminal logs with `EMAIL_MODE=console` |

Related docs:

```text
README.md
DEPLOYMENT.md
server/FIREBASE_SETUP.md
requirements.md
```
