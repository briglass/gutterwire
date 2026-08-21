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
    schemaReady = sql`
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

export async function listClips({ includeHidden = false } = {}) {
  if (dbUrl) {
    await ensureSchema();
    // Newest first: score controls how highlighted a clip looks, not where
    // it sits on the page.
    return includeHidden
      ? sql`SELECT * FROM clips ORDER BY created_at DESC, id DESC`
      : sql`SELECT * FROM clips WHERE hidden = FALSE ORDER BY created_at DESC, id DESC`;
  }
  const store = memStore();
  return store.clips
    .filter((c) => includeHidden || !c.hidden)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : b.id - a.id));
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
