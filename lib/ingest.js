import Parser from 'rss-parser';
import { extract } from '@extractus/article-extractor';
import Anthropic from '@anthropic-ai/sdk';
import { FEEDS, MAX_PER_RUN } from './feeds';
import { createClip, filterUnseenUrls, getThemeText, logIngest } from './db';

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
    let u = new URL(raw);
    // Bing News RSS wraps article links in a tracking redirect; unwrap it so
    // clips link (and dedupe) to the real article.
    if (u.hostname.endsWith('bing.com') && u.pathname.includes('/news/apiclick')) {
      const real = u.searchParams.get('url');
      if (!real) return null;
      u = new URL(real);
    }
    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|cmpid|smid)/i.test(key)) u.searchParams.delete(key);
    }
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}

// Round-robin across feeds so one busy feed doesn't crowd out the others.
function interleave(perFeed, seen) {
  const out = [];
  const longest = Math.max(0, ...perFeed.map((f) => f.length));
  for (let i = 0; i < longest; i++) {
    for (const items of perFeed) {
      const item = items[i];
      if (item && !seen.has(item.url)) {
        seen.add(item.url);
        out.push(item);
      }
    }
  }
  return out;
}

async function parseFeeds(parser, urls, themed) {
  const results = await Promise.allSettled(urls.map((f) => parser.parseURL(f)));
  const perFeed = [];
  let failed = 0;
  for (const r of results) {
    if (r.status !== 'fulfilled') {
      failed += 1;
      continue;
    }
    const items = [];
    for (const item of r.value.items || []) {
      const url = cleanUrl(item.link);
      if (url && item.title) items.push({ url, title: item.title.trim(), themed });
    }
    perFeed.push(items);
  }
  return { perFeed, failed };
}

// Editor themes become Bing News searches (Bing's RSS carries direct
// article URLs; Google News RSS wraps links in unresolvable redirects).
function themeFeedUrl(theme) {
  return `https://www.bing.com/news/search?q=${encodeURIComponent(theme)}&format=rss`;
}

async function fetchCandidates(themes, { skipGeneral = false } = {}) {
  const parser = new Parser({ timeout: FETCH_TIMEOUT_MS });
  const [general, themed] = await Promise.all([
    skipGeneral
      ? Promise.resolve({ perFeed: [], failed: 0 })
      : parseFeeds(parser, FEEDS, false),
    themes.length
      ? parseFeeds(parser, themes.map((t) => themeFeedUrl(t)), true)
      : Promise.resolve({ perFeed: [], failed: 0 }),
  ]);

  // Themed candidates lead the queue; general news follows.
  const seen = new Set();
  const themedCandidates = interleave(themed.perFeed, seen);
  const generalCandidates = interleave(general.perFeed, seen);
  return {
    themedCandidates,
    generalCandidates,
    feedsOk: general.perFeed.length + themed.perFeed.length,
    feedsFailed: general.failed + themed.failed,
  };
}

// Distills the editors' free-form notes (chat snippets, links, rambling)
// into a handful of concrete news-search queries.
async function extractThemes(client, blob) {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 400,
    system: `You turn an editor's unstructured notes (often pasted chat
snippets) into news search queries. Identify the distinct news topics,
stories, or subjects being discussed and produce up to 6 short search
queries (2-6 words each) that would find current news coverage of them.
Ignore greetings, jokes, and logistics chatter. If a URL is mentioned,
treat its subject as a topic. Respond with ONLY a JSON array of strings,
e.g. ["supreme court ruling", "oil prices opec"]. Return [] if there are
no news topics.`,
    messages: [{ role: 'user', content: blob }],
  });
  const raw = response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start === -1 || end <= start) return [];
  try {
    const arr = JSON.parse(raw.slice(start, end + 1));
    return arr
      .filter((q) => typeof q === 'string')
      .map((q) => q.trim())
      .filter((q) => q.length >= 3 && q.length <= 60)
      .slice(0, 6);
  } catch {
    return [];
  }
}

async function curate(client, { title, url, text, themes }) {
  const themeNote = themes.length
    ? `\nEDITORS ARE CURRENTLY TRACKING THESE THEMES (lean toward accepting articles that match one): ${themes.join('; ')}\n`
    : '';
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 800,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `TITLE: ${title}\nURL: ${url}\n${themeNote}\nARTICLE TEXT:\n${text}`,
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
// dryRun stops before the curation LLM/insert so the fetch+parse half can be
// tested without an API key. themedOnly (the admin desk's Go button) skips
// the general feeds and fills every slot from the editors' theme text.
export async function runIngest({ dryRun = false, limit = MAX_PER_RUN, themedOnly = false } = {}) {
  const hasKey = !!process.env.ANTHROPIC_API_KEY;
  if (!dryRun && !hasKey) {
    throw new Error('ANTHROPIC_API_KEY is not set');
  }
  const client = hasKey ? new Anthropic() : null;

  // Distill the editors' free-form notes into search queries (needs the
  // LLM; a keyless dry run just skips theming).
  const themeText = (await getThemeText()).trim();
  const themes = themeText && client ? await extractThemes(client, themeText) : [];

  const { themedCandidates, generalCandidates, feedsOk, feedsFailed } =
    await fetchCandidates(themes, { skipGeneral: themedOnly });
  const candidates = [...themedCandidates, ...generalCandidates];
  const unseen = await filterUnseenUrls(candidates.map((c) => c.url));
  const unseenSet = new Set(unseen);

  // Normally themed articles lead but never take every slot, so general
  // news keeps flowing; a themed-only run gives them everything.
  const cap = Math.max(1, limit);
  const themedCap = themedOnly ? cap : themes.length ? Math.ceil(cap * 0.6) : 0;
  const themedQueue = themedCandidates.filter((c) => unseenSet.has(c.url)).slice(0, themedCap);
  const generalQueue = themedOnly
    ? []
    : generalCandidates.filter((c) => unseenSet.has(c.url)).slice(0, cap - themedQueue.length);
  const queue = [...themedQueue, ...generalQueue];

  const summary = {
    dryRun,
    themedOnly,
    themeTextChars: themeText.length,
    themes,
    feedsOk,
    feedsFailed,
    candidates: candidates.length,
    themedCandidates: themedCandidates.length,
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
        summary.details.push({
          url: item.url,
          themed: !!item.themed,
          outcome: 'error',
          note: 'text too short',
        });
        continue;
      }

      if (dryRun) {
        summary.details.push({
          url: item.url,
          themed: !!item.themed,
          outcome: 'dry',
          note: `${text.length} chars extracted`,
        });
        continue;
      }

      const verdict = await curate(client, { title: item.title, url: item.url, text, themes });
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
      summary.details.push({ url: item.url, themed: !!item.themed, outcome: 'error', note });
    }
  }

  return summary;
}
