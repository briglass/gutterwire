'use client';

import { useCallback, useEffect, useState } from 'react';

const VOTES_KEY = 'gw_votes'; // { [clipId]: 1 | -1 } for this browser

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

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export default function HomePage() {
  const [clips, setClips] = useState(null);
  const [votes, setVotes] = useState({});
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/clips', { cache: 'no-store' });
      if (!res.ok) throw new Error('fetch failed');
      const data = await res.json();
      setClips(data.clips);
      setError(null);
    } catch {
      setError('COULD NOT LOAD THE WIRE. TRY AGAIN SHORTLY.');
    }
  }, []);

  useEffect(() => {
    setVotes(loadVotes());
    refresh();
  }, [refresh]);

  async function vote(clip, dir) {
    const prev = votes[clip.id] || 0;
    const next = prev === dir ? 0 : dir; // same button again = undo
    const delta = next - prev;
    if (delta === 0) return;

    // optimistic: update score locally and re-sort so the clip visibly moves
    const newVotes = { ...votes };
    if (next === 0) delete newVotes[clip.id];
    else newVotes[clip.id] = next;
    setVotes(newVotes);
    saveVotes(newVotes);
    setClips((cs) =>
      [...cs]
        .map((c) => (c.id === clip.id ? { ...c, score: c.score + delta } : c))
        .sort((a, b) => b.score - a.score || new Date(b.created_at) - new Date(a.created_at))
    );

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

  return (
    <div className="container">
      <header className="masthead">
        <h1>
          <a href="/">Gutter Wire</a>
        </h1>
        <p className="tagline">the wire from the gutter &middot; read it all at once</p>
      </header>

      {error && <p className="wire-status">{error}</p>}
      {!error && clips === null && <p className="wire-status">LOADING THE WIRE...</p>}
      {!error && clips !== null && clips.length === 0 && (
        <p className="wire-status">NOTHING ON THE WIRE YET.</p>
      )}

      {clips !== null && clips.length > 0 && (
        <main className="wire">
          {clips.map((clip) => {
            const myVote = votes[clip.id] || 0;
            return (
              <article className="clip" key={clip.id}>
                <a className="clip-link" href={clip.url} target="_blank" rel="noopener noreferrer">
                  {clip.text}
                </a>
                <div className="clip-meta">
                  <span className="clip-source">{hostOf(clip.url)}</span>
                  <span className="vote-box">
                    <button
                      className={`vote-btn${myVote === 1 ? ' active-up' : ''}`}
                      onClick={() => vote(clip, 1)}
                      aria-label="Vote up"
                      title="Push toward the top"
                    >
                      +
                    </button>
                    <span className="vote-score">{clip.score}</span>
                    <button
                      className={`vote-btn${myVote === -1 ? ' active-down' : ''}`}
                      onClick={() => vote(clip, -1)}
                      aria-label="Vote down"
                      title="Push toward the bottom"
                    >
                      &minus;
                    </button>
                  </span>
                </div>
              </article>
            );
          })}
        </main>
      )}

      <footer className="footer">
        <p>
          GUTTER WIRE &middot; clips link to their original sources &middot;{' '}
          <a href="/admin">editors</a>
        </p>
      </footer>
    </div>
  );
}
