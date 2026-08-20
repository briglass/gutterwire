import crypto from 'crypto';

// The editor password is NEVER stored in the codebase. Set ADMIN_PASSWORD in
// the environment (.env.local for dev, Vercel project settings for prod).
// SESSION_SECRET signs the login cookie; set a long random value in prod.
const ADMIN_USERS = ['briglass', 'sixtas', 'bpaulsen'];
const SESSION_COOKIE = 'gw_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

function secret() {
  return process.env.SESSION_SECRET || 'gutterwire-dev-secret-change-me';
}

function sign(payload) {
  return crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

export function checkCredentials(username, password) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false; // no password configured => nobody logs in
  return ADMIN_USERS.includes(username) && safeEqual(password, expected);
}

export function createSessionToken(username) {
  const exp = Date.now() + SESSION_TTL_MS;
  const payload = `${username}.${exp}`;
  return `${payload}.${sign(payload)}`;
}

// Returns the username if the token is valid and unexpired, else null.
export function verifySessionToken(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [username, exp, sig] = parts;
  if (!ADMIN_USERS.includes(username)) return null;
  if (!safeEqual(sig, sign(`${username}.${exp}`))) return null;
  if (Number(exp) < Date.now()) return null;
  return username;
}

export function getSessionUser(request) {
  return verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);
}

export { SESSION_COOKIE, SESSION_TTL_MS };
