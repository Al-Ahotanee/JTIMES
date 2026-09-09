# Jigawa Times

Informing People, Demanding Accountability.

An independent digital newsroom platform for Buji Local Government Area,
Jigawa State and Nigeria — public homepage, editorial workflow (Reporter →
Editor → Admin), and a role-based dashboard, built to run as a single free
Render Web Service backed by a free Neon PostgreSQL database.

## Why this project looks the way it does

- **Render's free Web Service plan has no shell/SSH access after deploy.**
  That rules out running `prisma migrate deploy` or a seed script
  interactively in production. So the schema and seed data are created by
  hand, once, by pasting **`migrations.sql`** into the **Neon SQL Editor**
  before your first deploy. `prisma/schema.prisma` is kept in sync with that
  SQL by hand and is only used to run `prisma generate` (pure code
  generation, no DB connection) as part of the build.
- **Images/video are never stored on Render's disk or in Postgres.** Render's
  free filesystem is ephemeral (wiped on every deploy/restart). Uploads go
  straight from the browser to a **Cloudinary free-tier** account instead;
  the database only stores the resulting URL.
- **One Render Web Service serves both the API and the built Vue app**, kept
  under a minimal file count, per the project's own constraints.

## Project structure

```
package.json         Scripts & dependencies
render.yaml           Render Blueprint (single web service)
.env.example           Environment variable template
migrations.sql         Manual schema + seed — run this in Neon's SQL Editor
prisma/schema.prisma    Prisma models (code-gen only, not used to migrate)
server.js               Express REST API + serves the built Vue app
src/main.js             Vue app entry
src/App.vue              Root layout (header, ticker, footer)
src/router.js             Routes + role guards
src/api.js                 Fetch wrapper
src/store.js                Auth session / categories / site settings
src/components.js            Header, footer, cards, uploader, etc.
src/pages.js                  All page-level views (public + dashboards)
src/styles.css                 Design tokens & layout
```
(`vite.config.js`, `index.html`, `.gitignore` are standard build tooling and
aren't counted against the file budget.)

---

## 1. Create your Neon database

1. Sign up at neon.tech and create a new project (free tier).
2. Create a database (or use the default one).
3. Copy the connection string from the Neon dashboard — it looks like
   `postgresql://user:password@ep-xxxx.neon.tech/dbname?sslmode=require`.

## 2. Run the migration + seed in the Neon SQL Editor

1. In the Neon console, open **SQL Editor** for your database.
2. Open `migrations.sql` from this repo, copy its full contents, paste them
   into the SQL Editor, and click **Run**.
3. This creates every table, enum, index and full-text-search index, and
   inserts seed data: 1 admin, 1 editor, 2 reporters, all default
   categories, a few tags, sample articles, editorial actions and site
   settings.
4. The script is idempotent (`IF NOT EXISTS` / `ON CONFLICT`) — safe to
   re-run if you need to reapply it.
5. Verify it worked:
   ```sql
   SELECT role, count(*) FROM "User" GROUP BY role;
   SELECT status, count(*) FROM "Article" GROUP BY status;
   ```

**Seed login (development only — change before going live):**

| Role     | Email                            | Password    |
|----------|-----------------------------------|-------------|
| Admin    | admin@jigawatimes.ng              | DevPass123! |
| Editor   | editor@jigawatimes.ng             | DevPass123! |
| Reporter | amina.reporter@jigawatimes.ng     | DevPass123! |
| Reporter | ibrahim.reporter@jigawatimes.ng   | DevPass123! |

### Making future schema changes

Since there's no automated migration runner in production:
1. Update `prisma/schema.prisma` **and** write the equivalent `ALTER TABLE`
   / `CREATE TABLE` statements by hand.
2. Test the SQL locally against a scratch database, or on a Neon branch
   database (Neon supports database branching for exactly this).
3. Run the finished SQL in the Neon SQL Editor for your production branch.
4. Commit the SQL as a new file, e.g. `migrations/002_add_x.sql`, so there's
   a paper trail — and append the same change to `migrations.sql` so a fresh
   database can still be bootstrapped in one paste.

## 3. Set up Cloudinary (free tier) for images/video

1. Sign up at cloudinary.com (the free tier is plenty for this use case).
2. From your Cloudinary **Dashboard**, copy: **Cloud name**, **API Key**,
   **API Secret**.
3. You do **not** need to create an upload preset — uploads are signed
   server-side (`POST /api/uploads/sign`), so no credentials are exposed to
   the browser and no preset configuration is required in Cloudinary.

## 4. Configure environment variables

Copy `.env.example` to `.env` for local development, or set these directly
in the Render dashboard for production:

```
DATABASE_URL=<your Neon connection string>
AUTH_SECRET=<a long random string>
CLOUDINARY_CLOUD_NAME=<from Cloudinary>
CLOUDINARY_API_KEY=<from Cloudinary>
CLOUDINARY_API_SECRET=<from Cloudinary>
NODE_ENV=production
```

Never commit real values. `render.yaml` marks `DATABASE_URL` and the
Cloudinary keys as `sync: false` so you paste them into the Render
dashboard rather than the repo, and generates `AUTH_SECRET` automatically.

## 5. Local development

```bash
npm install
cp .env.example .env   # then fill in DATABASE_URL, AUTH_SECRET, Cloudinary keys
npm run build && npm start   # builds the Vue app and serves it + the API together
```

Running the built app through `npm start` (rather than the Vite dev server
alone) exercises the exact single-server setup used in production, since
Express serves both `/api/*` and the built frontend from one port.

## 6. Deploy to Render

1. Push this repo to GitHub.
2. In Render, **New > Blueprint**, point it at the repo — it will read
   `render.yaml` automatically. Or create a Web Service manually with:
   - **Build command:** `npm install && npm run build`
   - **Start command:** `npm start`
3. Set the environment variables from step 4 above in the Render dashboard.
4. Make sure you've already run `migrations.sql` in Neon (step 2) — the app
   expects the schema to exist before its first request.
5. Deploy. Render provides `PORT` automatically; the server listens on
   `process.env.PORT` and never hardcodes a port.

## Package scripts

```
npm run dev          Vite + Express concurrently, for local development
npm run build         Build the Vue app, then `prisma generate`
npm start               Start the production server (node server.js)
npm run db:generate      Regenerate the Prisma client only
```

There is intentionally no `db:migrate` or `db:seed` script — see "Why this
project looks the way it does" above.

## Deployment troubleshooting

**`vite: not found` during the Render build.** This means the build step
installed only production dependencies and skipped `devDependencies` — npm
and Yarn both do this automatically when `NODE_ENV=production` is set during
install (which `render.yaml` sets for the running service, and Render's
build step inherits it). This repo avoids the problem by keeping every
build-time tool (`vite`, `@vitejs/plugin-vue`, `prisma`) in `dependencies`
rather than `devDependencies` — only `concurrently` (used solely by the
local-only `npm run dev` script) stays a dev dependency. If you add any new
build-time tooling later, put it in `dependencies`, not `devDependencies`.

**Render used `yarn install; yarn build` instead of the `npm` commands in
`render.yaml`.** `render.yaml` is only read when the service is created via
Render's **Blueprint** flow. A manually-created Web Service ignores it and
auto-detects a package manager and build command instead — and if it can't
find a lockfile in the repo, it may default to Yarn. Make sure
`package-lock.json` is committed (don't `.gitignore` it — this repo's
`.gitignore` does not), and either deploy via **New > Blueprint**, or set
the Build/Start commands explicitly in the service's Settings tab to
`npm install && npm run build` / `npm start`.

## Security notes

- Passwords hashed with bcrypt; hashes are never returned by the API.
- All authorization is enforced server-side in `server.js`; Vue route
  guards in `router.js` are a UX convenience only.
- Article body HTML is sanitized (`sanitize-html`) before it's stored.
- Rate limiting on all `/api/*` routes, stricter on `/api/auth/login`.
- Auth cookie is `httpOnly`, `sameSite=lax`, and `secure` in production.
