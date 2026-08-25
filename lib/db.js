import { neon } from '@neondatabase/serverless';

// Uses Neon Postgres when DATABASE_URL (or POSTGRES_URL) is set — that's what
// Vercel's Postgres/Neon integration provides. Falls back to an in-memory
// store for local development so the site runs with zero setup. In-memory
// data is lost on restart and must not be relied on in production.
const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;

let _sql;
function sql(...args) {
  if (!_sql) _sql = neon(dbUrl);
  return _sql(...args);
}

let schemaReady;
function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS clips (
          id SERIAL PRIMARY KEY,
          text TEXT NOT NULL,
          url TEXT NOT NULL,
          score INTEGER NOT NULL DEFAULT 0,
          hidden BOOLEAN NOT NULL DEFAULT FALSE,
          added_by TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      // Every article URL the wirebot has ever looked at, so it never
      // re-fetches or re-analyzes the same story on later runs.
      await sql`
        CREATE TABLE IF NOT EXISTS ingest_log (
          url TEXT PRIMARY KEY,
          status TEXT NOT NULL,
          detail TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      // Small key/value store; holds the editors' free-form theme text.
      await sql`
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_by TEXT,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
    })();
  }
  return schemaReady;
}

// ---- in-memory fallback (dev only) ----
function memStore() {
  if (!globalThis.__gutterwire) {
    globalThis.__gutterwire = {
      nextId: 4,
      clips: [
        {
          id: 1,
          text: 'DEV MODE: no DATABASE_URL set, using in-memory store. Clips vanish on restart.',
          url: 'https://vercel.com/docs/storage',
          score: 5,
          hidden: false,
          added_by: 'system',
          created_at: new Date().toISOString(),
        },
        {
          id: 2,
          text: 'Sample clip: officials say the thing everyone suspected is, in fact, the case.',
          url: 'https://example.com/story',
          score: 1,
          hidden: false,
          added_by: 'system',
          created_at: new Date().toISOString(),
        },
        {
          id: 3,
          text: 'Another sample clip with a lower score sits toward the bottom of the page.',
          url: 'https://example.com/other-story',
          score: -2,
          hidden: false,
          added_by: 'system',
          created_at: new Date().toISOString(),
        },
      ],
    };
  }
  return globalThis.__gutterwire;
}

// limit === null returns everything (the editor desk); otherwise a page.
export async function listClips({ includeHidden = false, limit = null, offset = 0 } = {}) {
  if (dbUrl) {
    await ensureSchema();
    // Newest first: score controls how highlighted a clip looks, not where
    // it sits on the page.
    if (limit === null) {
      return includeHidden
        ? sql`SELECT * FROM clips ORDER BY created_at DESC, id DESC`
        : sql`SELECT * FROM clips WHERE hidden = FALSE ORDER BY created_at DESC, id DESC`;
    }
    return includeHidden
      ? sql`SELECT * FROM clips ORDER BY created_at DESC, id DESC LIMIT ${limit} OFFSET ${offset}`
      : sql`SELECT * FROM clips WHERE hidden = FALSE ORDER BY created_at DESC, id DESC LIMIT ${limit} OFFSET ${offset}`;
  }
  const store = memStore();
  const all = store.clips
    .filter((c) => includeHidden || !c.hidden)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : b.id - a.id));
  return limit === null ? all : all.slice(offset, offset + limit);
}

export async function createClip({ text, url, score = 0, addedBy = null }) {
  if (dbUrl) {
    await ensureSchema();
    const rows = await sql`
      INSERT INTO clips (text, url, score, added_by)
      VALUES (${text}, ${url}, ${score}, ${addedBy})
      RETURNING *
    `;
    return rows[0];
  }
  const store = memStore();
  const clip = {
    id: store.nextId++,
    text,
    url,
    score,
    hidden: false,
    added_by: addedBy,
    created_at: new Date().toISOString(),
  };
  store.clips.push(clip);
  return clip;
}

export async function updateClip(id, { text, url, score, hidden }) {
  if (dbUrl) {
    await ensureSchema();
    const rows = await sql`
      UPDATE clips SET
        text = COALESCE(${text ?? null}, text),
        url = COALESCE(${url ?? null}, url),
        score = COALESCE(${score ?? null}, score),
        hidden = COALESCE(${hidden ?? null}, hidden)
      WHERE id = ${id}
      RETURNING *
    `;
    return rows[0] || null;
  }
  const store = memStore();
  const clip = store.clips.find((c) => c.id === id);
  if (!clip) return null;
  if (text !== undefined) clip.text = text;
  if (url !== undefined) clip.url = url;
  if (score !== undefined) clip.score = score;
  if (hidden !== undefined) clip.hidden = hidden;
  return clip;
}

export async function deleteClip(id) {
  if (dbUrl) {
    await ensureSchema();
    const rows = await sql`DELETE FROM clips WHERE id = ${id} RETURNING id`;
    return rows.length > 0;
  }
  const store = memStore();
  const before = store.clips.length;
  store.clips = store.clips.filter((c) => c.id !== id);
  return store.clips.length < before;
}

// Free-form notes the editors keep about what to hunt for; the wirebot
// distills this into search queries on each run.
export async function getThemeText() {
  if (dbUrl) {
    await ensureSchema();
    const rows = await sql`SELECT value FROM settings WHERE key = 'theme_text'`;
    return rows[0] ? rows[0].value : '';
  }
  const store = memStore();
  return store.themeText || '';
}

export async function setThemeText(text, updatedBy = null) {
  if (dbUrl) {
    await ensureSchema();
    await sql`
      INSERT INTO settings (key, value, updated_by, updated_at)
      VALUES ('theme_text', ${text}, ${updatedBy}, NOW())
      ON CONFLICT (key) DO UPDATE SET value = ${text}, updated_by = ${updatedBy}, updated_at = NOW()
    `;
    return;
  }
  const store = memStore();
  store.themeText = text;
}

// Returns the subset of urls the wirebot has never processed and that no
// clip (bot- or editor-posted) already links to.
export async function filterUnseenUrls(urls) {
  if (!urls.length) return [];
  if (dbUrl) {
    await ensureSchema();
    const seenLog = await sql`SELECT url FROM ingest_log WHERE url = ANY(${urls})`;
    const seenClips = await sql`SELECT url FROM clips WHERE url = ANY(${urls})`;
    const seen = new Set([...seenLog, ...seenClips].map((r) => r.url));
    return urls.filter((u) => !seen.has(u));
  }
  const store = memStore();
  store.ingestLog = store.ingestLog || new Map();
  const clipUrls = new Set(store.clips.map((c) => c.url));
  return urls.filter((u) => !store.ingestLog.has(u) && !clipUrls.has(u));
}

export async function logIngest(url, status, detail = null) {
  if (dbUrl) {
    await ensureSchema();
    await sql`
      INSERT INTO ingest_log (url, status, detail)
      VALUES (${url}, ${status}, ${detail})
      ON CONFLICT (url) DO UPDATE SET status = ${status}, detail = ${detail}
    `;
    return;
  }
  const store = memStore();
  store.ingestLog = store.ingestLog || new Map();
  store.ingestLog.set(url, { status, detail });
}

export async function bumpScore(id, delta) {
  if (dbUrl) {
    await ensureSchema();
    const rows = await sql`
      UPDATE clips SET score = score + ${delta}
      WHERE id = ${id} AND hidden = FALSE
      RETURNING id, score
    `;
    return rows[0] || null;
  }
  const store = memStore();
  const clip = store.clips.find((c) => c.id === id && !c.hidden);
  if (!clip) return null;
  clip.score += delta;
  return { id: clip.id, score: clip.score };
}
