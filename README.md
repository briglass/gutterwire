# GUTTERWIRE

A clip wire. Editors paste excerpts (a sentence or a paragraph) with a link
to the source; readers see all the clips run together into one big flowing
block of text, click through to sources, and vote clips up or down — which
controls how highlighted each excerpt looks.

Built with Next.js (App Router) + Neon Postgres.

## Features

- **Public wire** (`/`): visible clips flow inline like one long paragraph,
  newest first, each in a rounded chip. Score sets the highlight: the hottest
  excerpts go reddish, then grays fade down to washed-out for low scores.
  Each clip links to its source. `+` / `−` buttons let any reader vote (one
  vote per clip per browser; clicking the same button again undoes it), and a
  share button copies a link to the excerpt on this site (`/#clip-ID`).
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

## Wirebot (AI auto-ingestion)

A scheduled bot fills the wire automatically:

1. **Vercel Cron** hits `/api/ingest` once a day (see `vercel.json`; Hobby
   tier allows daily — on Pro you can raise it to hourly, e.g.
   `"0 * * * *"`).
2. The route pulls candidate articles from the RSS feeds in `lib/feeds.js`,
   skips anything it has processed before (tracked in the `ingest_log`
   table), and extracts the main body text of up to `MAX_PER_RUN` new
   articles.
3. **Claude Haiku 4.5** judges each article against Gutterwire's tone and,
   when it accepts one, returns the single most compelling 1-3 sentence
   passage. The server verifies the excerpt is verbatim from the article
   before posting.
4. Accepted excerpts are inserted as normal clips: score 0, linked to the
   source, `added_by = 'wirebot'`. Editors can hide, delete, or re-score
   them like anything else, and readers vote as usual.

Setup (Vercel → Settings → Environment Variables):

- `ANTHROPIC_API_KEY` — from https://console.anthropic.com
- `CRON_SECRET` — any long random string; Vercel automatically sends it as
  a bearer token on cron requests so nobody else can trigger the bot

### Steering the wirebot with themes

Editors can add **themes** on `/admin` (e.g. "supreme court", "AI
regulation"). While a theme is active (7 days, or until deleted), the bot
also searches news for it via Bing News RSS, gives matching articles
priority for up to 60% of each run's slots, and tells the curator model
which themes editors are tracking. The usual tone filter, verbatim check,
and dedupe still apply.

Editors can also press **Run wirebot now** on `/admin`. For a no-cost test
of the fetch/parse half, hit `/api/ingest?dry=1` while logged in — it runs
everything except the LLM and the insert.

Approximate cost: ~5 articles/day ≈ $0.50/month in Haiku 4.5 tokens.

## API overview

| Route                 | Method | Auth   | Purpose                              |
| --------------------- | ------ | ------ | ------------------------------------ |
| `/api/clips`          | GET    | public | visible clips (`?all=1` + editor cookie: include hidden) |
| `/api/clips`          | POST   | editor | add a clip                           |
| `/api/clips/:id`      | PATCH  | editor | edit text/url/score/hidden           |
| `/api/clips/:id`      | DELETE | editor | delete a clip                        |
| `/api/vote`           | POST   | public | bump a clip's score (delta clamped)  |
| `/api/login` `/api/logout` `/api/me` | POST/GET | — | session management  |
