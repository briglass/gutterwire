'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const VOTES_KEY = 'gw_votes'; // { [clipId]: 1 | -1 } for this browser
const SITE_URL = 'https://www.gutterwire.com'; // canonical home for share links

function loadVotes() {
  try {
    return JSON.parse(localStorage.getItem(VOTES_KEY)) || {};
  } catch {
    return {};
  }
}

function saveVotes(votes) {
  try {
    localStorage.setItem(VOTES_KEY, JSON.stringify(votes));
  } catch {
    /* private mode etc. -- votes just won't stick */
  }
}

function lerp(a, b, t) {
  return Math.round(a + (b - a) * t);
}

// Score maps to how "hot" an excerpt looks, not where it sits on the page:
// the top band goes reddish, below that the background stays light and clean
// while text stays dark and high-contrast for readability.
function clipStyle(score, min, max) {
  const t = max === min ? 0.55 : (score - min) / (max - min);
  if (max !== min && t >= 0.85) {
    return { backgroundColor: '#fbebe8', color: '#5a0e02', fontWeight: 700 };
  }
  const bg = lerp(250, 232, t);
  const fg = lerp(50, 0, t);
  return {
    backgroundColor: `rgb(${bg},${bg},${bg})`,
    color: `rgb(${fg},${fg},${fg})`,
    fontWeight: t > 0.62 ? 600 : 400,
  };
}

function ShareIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      aria-hidden="true"
    >
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="M8.7 10.6l6.6-3.8M8.7 13.4l6.6 3.8" />
    </svg>
  );
}

const PAGE_SIZE = 20;

export default function HomePage() {
  const [clips, setClips] = useState(null);
  const [votes, setVotes] = useState({});
  const [copiedId, setCopiedId] = useState(null);
  const [error, setError] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(() => {
    try {
      const saved = localStorage.getItem('gw_autorefresh');
      return saved !== null ? JSON.parse(saved) : true;
    } catch {
      return true;
    }
  });
  const scrolledRef = useRef(false);
  const loadingRef = useRef(false);
  const clipsRef = useRef([]);
  const sentinelRef = useRef(null);

  useEffect(() => {
    clipsRef.current = clips || [];
  }, [clips]);

  const loadMore = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const offset = clipsRef.current.length;
      const res = await fetch(`/api/clips?limit=${PAGE_SIZE}&offset=${offset}`, {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error('fetch failed');
      const data = await res.json();
      // dedupe by id: a clip posted while scrolling shifts the offsets
      setClips((prev) => {
        const seen = new Set((prev || []).map((c) => c.id));
        return [...(prev || []), ...data.clips.filter((c) => !seen.has(c.id))];
      });
      if (data.clips.length < PAGE_SIZE) setHasMore(false);
      setError(null);
    } catch {
      if (!clipsRef.current.length) setError('COULD NOT LOAD THE WIRE. TRY AGAIN SHORTLY.');
    } finally {
      loadingRef.current = false;
    }
  }, []);

  useEffect(() => {
    setVotes(loadVotes());
    loadMore();
  }, [loadMore]);

  // Auto-refresh the page every 60 seconds unless paused by user
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      window.location.reload();
    }, 60000);
    return () => clearInterval(interval);
  }, [autoRefresh]);

  // Load the next page whenever the sentinel below the stack nears the
  // viewport.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMore();
      },
      { rootMargin: '500px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore, hasMore, clips === null]);

  // If someone arrives via a shared link (/#clip-N), scroll to that excerpt
  // once it has rendered (paging in more clips until it shows up); CSS
  // :target rings it.
  useEffect(() => {
    if (!clips || scrolledRef.current) return;
    const hash = window.location.hash;
    if (!hash.startsWith('#clip-')) return;
    const el = document.getElementById(hash.slice(1));
    if (el) {
      scrolledRef.current = true;
      el.scrollIntoView({ block: 'center' });
    } else if (hasMore) {
      loadMore();
    }
  }, [clips, hasMore, loadMore]);

  async function vote(clip, dir) {
    const prev = votes[clip.id] || 0;
    const next = prev === dir ? 0 : dir; // same button again = undo
    const delta = next - prev;
    if (delta === 0) return;

    const newVotes = { ...votes };
    if (next === 0) delete newVotes[clip.id];
    else newVotes[clip.id] = next;
    setVotes(newVotes);
    saveVotes(newVotes);
    // optimistic: bump the score locally; the highlight shifts on its own
    setClips((cs) => cs.map((c) => (c.id === clip.id ? { ...c, score: c.score + delta } : c)));

    try {
      await fetch('/api/vote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: clip.id, delta }),
      });
    } catch {
      /* keep the optimistic state; next refresh reconciles */
    }
  }

  async function share(clip) {
    const url = `${SITE_URL}/#clip-${clip.id}`;
    const payload = `“${clip.text}”\n\n${url}`;
    try {
      await navigator.clipboard.writeText(payload);
      setCopiedId(clip.id);
      setTimeout(() => setCopiedId((id) => (id === clip.id ? null : id)), 1600);
    } catch {
      window.prompt('Copy this:', payload);
    }
  }

  const scores = clips ? clips.map((c) => c.score) : [];
  const min = scores.length ? Math.min(...scores) : 0;
  const max = scores.length ? Math.max(...scores) : 0;

  return (
    <div className="container">
      <header className="masthead">
        <h1>
          <a href="/">GUTTERWIRE</a>
        </h1>
        <p className="tagline">MONITOR THE GUTTER WITHOUT GETTING DIRTY</p>
      </header>

      {error && <p className="wire-status">{error}</p>}
      {!error && clips === null && <p className="wire-status">LOADING THE WIRE...</p>}
      {!error && clips !== null && clips.length === 0 && (
        <p className="wire-status">NOTHING ON THE WIRE YET.</p>
      )}

      {clips !== null && clips.length > 0 && (
        <main className="wire-stack">
          {clips.map((clip) => {
            const myVote = votes[clip.id] || 0;
            return (
              <div className="clip-row" key={clip.id}>
                <div
                  className="clip"
                  id={`clip-${clip.id}`}
                  style={clipStyle(clip.score, min, max)}
                >
                  <a href={clip.url} target="_blank" rel="noopener noreferrer">
                    {clip.text}
                  </a>
                </div>
                <div className="clip-ctrls">
                  <button
                    className={`ctrl-btn${myVote === 1 ? ' voted' : ''}`}
                    onClick={() => vote(clip, 1)}
                    aria-label="Vote up"
                    title="Heat it up"
                  >
                    +
                  </button>
                  <button
                    className={`ctrl-btn${myVote === -1 ? ' voted' : ''}`}
                    onClick={() => vote(clip, -1)}
                    aria-label="Vote down"
                    title="Cool it down"
                  >
                    &minus;
                  </button>
                  <button
                    className="ctrl-btn"
                    onClick={() => share(clip)}
                    aria-label="Copy link to this excerpt"
                    title="Copy link"
                  >
                    {copiedId === clip.id ? '✓' : <ShareIcon />}
                  </button>
                </div>
              </div>
            );
          })}
        </main>
      )}

      {clips !== null && clips.length > 0 && hasMore && (
        <p className="wire-status" ref={sentinelRef}>
          DOWN THE GUTTER
        </p>
      )}

      <footer className="footer">
        <p>
          &copy; {new Date().getFullYear()} GUTTERWIRE &middot; excerpts link to their original sources &middot;{' '}
          <a href="/admin">editors</a>
        </p>
      </footer>

      {/* Floating Action Menu Button */}
      <div className="fab-container">
        {menuOpen && (
          <div className="fab-menu">
            <button
              className="fab-item"
              onClick={() => {
                setAutoRefresh((prev) => {
                  const next = !prev;
                  try {
                    localStorage.setItem('gw_autorefresh', JSON.stringify(next));
                  } catch {}
                  return next;
                });
              }}
            >
              <svg
                className={`refresh-icon${autoRefresh ? ' spinning' : ''}`}
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
              </svg>
              <span>AUTO-REFRESH: {autoRefresh ? 'LIVE' : 'PAUSED'}</span>
            </button>

            <a className="fab-item" href="/admin" onClick={() => setMenuOpen(false)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
              <span>EDITORS</span>
            </a>

            <button
              className="fab-item"
              onClick={() => {
                setAboutOpen(true);
                setMenuOpen(false);
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
              <span>ABOUT</span>
            </button>
          </div>
        )}

        <button
          className={`fab-btn${menuOpen ? ' open' : ''}`}
          onClick={() => setMenuOpen((prev) => !prev)}
          aria-label="Toggle menu"
          title="Menu"
        >
          {menuOpen ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          )}
        </button>
      </div>

      {/* About Floating Modal */}
      {aboutOpen && (
        <div className="about-backdrop" onClick={() => setAboutOpen(false)}>
          <div className="about-modal" onClick={(e) => e.stopPropagation()}>
            <div className="about-header">
              <h2>ABOUT GUTTERWIRE</h2>
              <button
                className="about-close"
                onClick={() => setAboutOpen(false)}
                aria-label="Close"
              >
                &times;
              </button>
            </div>
            <div className="about-body">
              <p>
                GUTTERWIRE fills the space between a simple headline aggregator and a full news page. Instead of just headlines or wall-to-wall articles, direct excerpts are provided as mini-stories to keep you instantly informed.
              </p>
              <p>
                The news on GUTTERWIRE can come from anywhere across the web—sparing you from having to trek through seedy parts of the internet yourself.
              </p>
              <p>
                The best way to experience GUTTERWIRE is to keep it running in the background while you work, letting a continuous stream of consciousness from humanity trickle in.
              </p>
              <div className="about-copyright">
                &copy; {new Date().getFullYear()} GUTTERWIRE &middot; ALL RIGHTS RESERVED
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
