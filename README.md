# GUTTER WIRE

A Drudge-style clip wire. Editors paste excerpts (a sentence or a paragraph)
with a link to the source; readers see all the clips stitched together across
the page, click through to sources, and vote clips up or down — which moves
them toward the top or bottom of the page.

Built with Next.js (App Router) + Vercel Postgres.

## Features

- **Public wire** (`/`): all visible clips in a dense multi-column layout,
  sorted by score. Each clip links to its source. `+` / `−` buttons let any
  reader nudge a clip up or down (one vote per clip per browser; clicking the
  same button again undoes the vote).
- **Editor desk** (`/admin`): editors log in and can
  - paste a new clip (text + source URL, optional starting score),
  - set a clip's score directly,
  - hide/unhide clips (hidden clips stay in the database but leave the page),
  - delete clips permanently.

Editor usernames: `briglass`, `sixtas`, `bpaulsen`. The shared password is
**not** in the code — it comes from the `ADMIN_PASSWORD` environment variable.

## Local development

```bash
npm install
cp .env.example .env.local   # then fill in ADMIN_PASSWORD and SESSION_SECRET
npm run dev
```

Open http://localhost:3000. Without `POSTGRES_URL` set, the app uses an
in-memory store with sample clips so you can try everything; data resets on
restart.

## Deploying to Vercel

1. Push this repo to GitHub and import it at vercel.com (framework is
   auto-detected as Next.js).
2. In the Vercel project, go to **Storage → Create Database → Postgres
   (Neon)** and connect it. This sets `POSTGRES_URL` automatically. The
   `clips` table is created on first use — no migrations to run.
3. In **Settings → Environment Variables**, add:
   - `ADMIN_PASSWORD` — the shared editor password
   - `SESSION_SECRET` — a long random string
     (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)
4. Deploy. Log in at `/admin` and start posting clips.

## API overview

| Route                 | Method | Auth   | Purpose                              |
| --------------------- | ------ | ------ | ------------------------------------ |
| `/api/clips`          | GET    | public | visible clips (`?all=1` + editor cookie: include hidden) |
| `/api/clips`          | POST   | editor | add a clip                           |
| `/api/clips/:id`      | PATCH  | editor | edit text/url/score/hidden           |
| `/api/clips/:id`      | DELETE | editor | delete a clip                        |
| `/api/vote`           | POST   | public | bump a clip's score (delta clamped)  |
| `/api/login` `/api/logout` `/api/me` | POST/GET | — | session management  |
