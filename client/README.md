# Sprout Web client

The React application for Sprout Web. It includes plant scanning, the creature
archive, battles, rankings, a public almanac, and operator pages. The shared
project context and team credits are in the [root README](../README.md).

## Run locally

Use Node.js 22. Run these commands from the repository root:

```bash
npm ci
cp client/.env.example client/.env.local
npm run dev
```

Set `VITE_API_URL` to the Express API address. The example uses
`http://localhost:3001`. Add the Firebase web configuration for sign-in.
The [development guide](../docs/DEVELOPMENT.md) covers backend configuration,
Firebase, and local seeding. Provider credentials belong on the server.

Vite serves the client at [localhost:5173](http://localhost:5173). The root
`dev` command starts both workspaces. To start only this client, run
`npm run dev -w client`.

## Check the client

Run these commands from the repository root:

```bash
npm test -w client
npm run typecheck -w client
npm run lint -w client
npm run build -w client
```

Vitest uses jsdom and React Testing Library. The production build checks
TypeScript before writing `client/dist/`. End-to-end tests and their backing
services are documented in the root README.

## Source and configuration

- `src/App.tsx` defines routes, layouts, and access wrappers.
- `src/pages/` contains player pages, public pages, and operator pages.
- `src/studio/` contains the embedded pipeline tooling.
- `src/index.css` defines the Tailwind CSS theme with `@theme`.
- `vite.config.ts` configures React, Tailwind CSS, and Vitest.
- `.oxlintrc.json` configures the React, TypeScript, and Oxc lint rules.
