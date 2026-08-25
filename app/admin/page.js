'use client';

import { useCallback, useEffect, useState } from 'react';

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function LoginForm({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Login failed');
      } else {
        onLogin(data.username);
      }
    } catch {
      setError('Network error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="login-box" onSubmit={submit}>
      <h2>Editor Login</h2>
      <div className="field">
        <label htmlFor="gw-user">Username</label>
        <input
          id="gw-user"
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          autoCapitalize="none"
          required
        />
      </div>
      <div className="field">
        <label htmlFor="gw-pass">Password</label>
        <input
          id="gw-pass"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
      </div>
      {error && <p className="error-msg">{error}</p>}
      <button className="btn" type="submit" disabled={busy}>
        {busy ? 'Checking...' : 'Log in'}
      </button>
    </form>
  );
}

function AddClipForm({ onAdded }) {
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [score, setScore] = useState('0');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/clips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, url, score: Number(score) || 0 }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not add clip');
      } else {
        setText('');
        setUrl('');
        setScore('0');
        onAdded();
      }
    } catch {
      setError('Network error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="add-form" onSubmit={submit}>
      <h3>Paste a clip</h3>
      <div className="field">
        <label htmlFor="gw-text">Clip text (sentence or paragraph)</label>
        <textarea
          id="gw-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste the excerpt here..."
          required
        />
      </div>
      <div className="add-form-row">
        <div className="field grow">
          <label htmlFor="gw-url">Source URL</label>
          <input
            id="gw-url"
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://..."
            inputMode="url"
            required
          />
        </div>
        <div className="field score-field">
          <label htmlFor="gw-score">Score</label>
          <input
            id="gw-score"
            type="number"
            value={score}
            onChange={(e) => setScore(e.target.value)}
          />
        </div>
        <button className="btn" type="submit" disabled={busy}>
          {busy ? '...' : 'Post it'}
        </button>
      </div>
      {error && <p className="error-msg">{error}</p>}
    </form>
  );
}

function ThemesPanel() {
  const [themes, setThemes] = useState([]);
  const [text, setText] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch('/api/themes', { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      setThemes(data.themes);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function add(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/themes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not add theme');
      } else {
        setText('');
        refresh();
      }
    } catch {
      setError('Network error');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id) {
    await fetch(`/api/themes/${id}`, { method: 'DELETE' });
    refresh();
  }

  return (
    <div className="add-form">
      <h3>Themes</h3>
      <p className="panel-hint">
        Wirebot hunts for news matching these themes (each stays active for 7 days).
      </p>
      {themes.length > 0 && (
        <div className="theme-chips">
          {themes.map((t) => (
            <span className="theme-chip" key={t.id}>
              {t.text}
              <button
                className="theme-chip-x"
                onClick={() => remove(t.id)}
                aria-label={`Remove theme ${t.text}`}
              >
                &times;
              </button>
            </span>
          ))}
        </div>
      )}
      <form className="add-form-row" onSubmit={add}>
        <div className="field grow">
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. supreme court, AI regulation, oil prices"
            maxLength={80}
            required
          />
        </div>
        <button className="btn" type="submit" disabled={busy}>
          Add
        </button>
      </form>
      {error && <p className="error-msg">{error}</p>}
    </div>
  );
}

function WirebotPanel({ onFinished }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  async function run() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch('/api/ingest', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setResult(`Failed: ${data.error || res.status}`);
      } else {
        setResult(
          `Scanned ${data.candidates} headlines (${data.unseen} new). ` +
            `Analyzed ${data.processed}: ${data.accepted} posted, ` +
            `${data.rejected} rejected, ${data.errors} errors.`
        );
        onFinished();
      }
    } catch {
      setResult('Failed: network error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="add-form">
      <h3>Wirebot</h3>
      <div className="add-form-row">
        <button className="btn" onClick={run} disabled={busy}>
          {busy ? 'Scanning the wires...' : 'Run wirebot now'}
        </button>
        {result && <span className="wirebot-result">{result}</span>}
      </div>
    </div>
  );
}

function AdminClip({ clip, onChanged }) {
  const [score, setScore] = useState(String(clip.score));
  const [busy, setBusy] = useState(false);

  useEffect(() => setScore(String(clip.score)), [clip.score]);

  async function patch(fields) {
    setBusy(true);
    try {
      await fetch(`/api/clips/${clip.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
      });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm('Delete this clip for good?')) return;
    setBusy(true);
    try {
      await fetch(`/api/clips/${clip.id}`, { method: 'DELETE' });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`admin-clip${clip.hidden ? ' is-hidden' : ''}`}>
      <p className="admin-clip-text">
        {clip.hidden && <span className="hidden-tag">hidden</span>} {clip.text}
      </p>
      <p className="admin-clip-url">
        <a href={clip.url} target="_blank" rel="noopener noreferrer">
          {hostOf(clip.url)}
        </a>
        {clip.added_by ? ` · added by ${clip.added_by}` : ''}
      </p>
      <div className="admin-clip-controls">
        <input
          className="score-input"
          type="number"
          value={score}
          onChange={(e) => setScore(e.target.value)}
          disabled={busy}
          aria-label="Score"
        />
        <button
          className="btn small secondary"
          onClick={() => patch({ score: Number(score) || 0 })}
          disabled={busy}
        >
          Set score
        </button>
        <button
          className="btn small secondary"
          onClick={() => patch({ hidden: !clip.hidden })}
          disabled={busy}
        >
          {clip.hidden ? 'Unhide' : 'Hide'}
        </button>
        <button className="btn small danger" onClick={remove} disabled={busy}>
          Delete
        </button>
      </div>
    </div>
  );
}

export default function AdminPage() {
  const [user, setUser] = useState(undefined); // undefined = checking, null = logged out
  const [clips, setClips] = useState([]);

  const refresh = useCallback(async () => {
    const res = await fetch('/api/clips?all=1', { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      setClips(data.clips);
    }
  }, []);

  useEffect(() => {
    fetch('/api/me')
      .then((r) => r.json())
      .then((d) => setUser(d.username))
      .catch(() => setUser(null));
  }, []);

  useEffect(() => {
    if (user) refresh();
  }, [user, refresh]);

  async function logout() {
    await fetch('/api/logout', { method: 'POST' });
    setUser(null);
  }

  return (
    <div className="container">
      <header className="masthead">
        <h1>
          <a href="/">GUTTERWIRE</a>
        </h1>
        <p className="tagline">editor desk</p>
      </header>

      {user === undefined && <p className="wire-status">CHECKING CREDENTIALS...</p>}

      {user === null && <LoginForm onLogin={setUser} />}

      {user && (
        <div className="admin-panel">
          <div className="admin-bar">
            <span>
              LOGGED IN AS <strong>{user.toUpperCase()}</strong>
            </span>
            <span>
              <a href="/">view the wire</a>{' '}
              <button className="btn small secondary" onClick={logout}>
                Log out
              </button>
            </span>
          </div>

          <AddClipForm onAdded={refresh} />

          <ThemesPanel />

          <WirebotPanel onFinished={refresh} />

          {clips.length === 0 && <p className="wire-status">NO CLIPS YET.</p>}
          {clips.map((clip) => (
            <AdminClip key={clip.id} clip={clip} onChanged={refresh} />
          ))}
        </div>
      )}

      <footer className="footer">
        <p>GUTTERWIRE EDITOR DESK</p>
      </footer>
    </div>
  );
}
