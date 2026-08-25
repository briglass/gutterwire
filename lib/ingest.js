import Parser from 'rss-parser';
import { extract } from '@extractus/article-extractor';
import Anthropic from '@anthropic-ai/sdk';
import { FEEDS, MAX_PER_RUN } from './feeds';
import { createClip, filterUnseenUrls, logIngest } from './db';

const MODEL = 'claude-haiku-4-5';
const ARTICLE_CHARS = 6000; // ~1.5K tokens of article body per LLM call
const FETCH_TIMEOUT_MS = 10000;
// Some outlets 403 anything that doesn't look like a browser.
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const SYSTEM_PROMPT = `You are the wire editor for GUTTERWIRE, a terse news
excerpt site. You receive one news article at a time and decide whether it
belongs on the wire.

Accept articles that are newsworthy and substantive: politics, world events,
power, money, conflict, scandal, science with real stakes, striking cultural
moments. Reject fluff: press releases, product promos, listicles, recaps of
other outlets' reporting, horoscopes, sports scores, celebrity gossip with no
larger significance, and pages that are clearly truncated or paywalled stubs.

If you accept, choose the single most compelling passage of 3 to 5 complete
consecutive sentences — a substantial excerpt of roughly 300 to 600
characters that a reader can sink into, not a one-line teaser. It must be
copied VERBATIM from the article text, with no edits, no ellipses, and no
added words. Prefer passages that are concrete and surprising over generic
summary sentences.

Respond with ONLY a JSON object, no other text:
{"accept": true|false, "excerpt": "<verbatim passage or null>", "reason": "<one short sentence>"}`;

// Strips tags and decodes the handful of entities that matter for matching.
function htmlToText(html) {
  return String(html || '')
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Loose normalization so smart quotes / spacing differences don't fail the
// verbatim check.
function normalizeForMatch(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanUrl(raw) {
  try {
    const u = new URL(raw);
    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|cmpid|smid)/i.test(key)) u.searchParams.delete(key);
    }
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}

async function fetchCandidates() {
  const parser = new Parser({ timeout: FETCH_TIMEOUT_MS });
  const results = await Promise.allSettled(FEEDS.map((f) => parser.parseURL(f)));

  const perFeed = [];
  let feedsFailed = 0;
  for (const r of results) {
    if (r.status !== 'fulfilled') {
      feedsFailed += 1;
      continue;
    }
    const items = [];
    for (const item of r.value.items || []) {
      const url = cleanUrl(item.link);
      if (url && item.title) items.push({ url, title: item.title.trim() });
    }
    perFeed.push(items);
  }

  // Round-robin across feeds so one busy feed doesn't crowd out the others.
  const interleaved = [];
  const seen = new Set();
  const longest = Math.max(0, ...perFeed.map((f) => f.length));
  for (let i = 0; i < longest; i++) {
    for (const items of perFeed) {
      const item = items[i];
      if (item && !seen.has(item.url)) {
        seen.add(item.url);
        interleaved.push(item);
      }
    }
  }
  return { candidates: interleaved, feedsOk: perFeed.length, feedsFailed };
}

async function curate(client, { title, url, text }) {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 800,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `TITLE: ${title}\nURL: ${url}\n\nARTICLE TEXT:\n${text}`,
      },
    ],
  });

  const raw = response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('model returned no JSON');
  const verdict = JSON.parse(raw.slice(start, end + 1));

  if (!verdict.accept) {
    return { accept: false, reason: String(verdict.reason || 'rejected') };
  }
  const excerpt = String(verdict.excerpt || '').trim();
  if (excerpt.length < 150) {
    return { accept: false, reason: 'excerpt missing or too short' };
  }
  if (!normalizeForMatch(text).includes(normalizeForMatch(excerpt))) {
    return { accept: false, reason: 'excerpt was not verbatim from the article' };
  }
  return { accept: true, excerpt, reason: String(verdict.reason || '') };
}

// The whole pipeline: feeds -> unseen articles -> extract text -> LLM verdict
// -> insert accepted excerpts as clips (score 0, added_by 'wirebot').
// dryRun stops before the LLM/insert so the fetch+parse half can be tested
// without an API key (and without logging urls as seen).
export async function runIngest({ dryRun = false, limit = MAX_PER_RUN } = {}) {
  if (!dryRun && !process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not set');
  }

  const { candidates, feedsOk, feedsFailed } = await fetchCandidates();
  const unseen = await filterUnseenUrls(candidates.map((c) => c.url));
  const unseenSet = new Set(unseen);
  const queue = candidates.filter((c) => unseenSet.has(c.url)).slice(0, Math.max(1, limit));

  const client = dryRun ? null : new Anthropic();
  const summary = {
    dryRun,
    feedsOk,
    feedsFailed,
    candidates: candidates.length,
    unseen: unseen.length,
    processed: 0,
    accepted: 0,
    rejected: 0,
    errors: 0,
    details: [],
  };

  for (const item of queue) {
    summary.processed += 1;
    try {
      const article = await extract(item.url, {}, (u) =>
        fetch(u, {
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          redirect: 'follow',
          headers: { 'user-agent': USER_AGENT },
        })
      );
      const text = htmlToText(article?.content).slice(0, ARTICLE_CHARS);
      if (text.length < 400) {
        if (!dryRun) await logIngest(item.url, 'error', 'article text too short to judge');
        summary.errors += 1;
        summary.details.push({ url: item.url, outcome: 'error', note: 'text too short' });
        continue;
      }

      if (dryRun) {
        summary.details.push({ url: item.url, outcome: 'dry', note: `${text.length} chars extracted` });
        continue;
      }

      const verdict = await curate(client, { title: item.title, url: item.url, text });
      if (verdict.accept) {
        await createClip({ text: verdict.excerpt, url: item.url, score: 0, addedBy: 'wirebot' });
        await logIngest(item.url, 'accepted', verdict.reason);
        summary.accepted += 1;
        summary.details.push({ url: item.url, outcome: 'accepted' });
      } else {
        await logIngest(item.url, 'rejected', verdict.reason);
        summary.rejected += 1;
        summary.details.push({ url: item.url, outcome: 'rejected', note: verdict.reason });
      }
    } catch (err) {
      const note = String(err && err.message ? err.message : err).slice(0, 300);
      if (!dryRun) {
        try {
          await logIngest(item.url, 'error', note);
        } catch {
          /* logging failure should not kill the run */
        }
      }
      summary.errors += 1;
      summary.details.push({ url: item.url, outcome: 'error', note });
    }
  }

  return summary;
}
