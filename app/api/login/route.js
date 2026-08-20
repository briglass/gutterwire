import { NextResponse } from 'next/server';
import { checkCredentials, createSessionToken, SESSION_COOKIE, SESSION_TTL_MS } from '../../../lib/auth';

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }
  const username = String(body.username || '').trim().toLowerCase();
  const password = String(body.password || '');

  if (!checkCredentials(username, password)) {
    return NextResponse.json({ error: 'Invalid username or password' }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true, username });
  res.cookies.set(SESSION_COOKIE, createSessionToken(username), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  return res;
}
