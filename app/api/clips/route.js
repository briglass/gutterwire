import { NextResponse } from 'next/server';
import { listClips, createClip } from '../../../lib/db';
import { getSessionUser } from '../../../lib/auth';

export const dynamic = 'force-dynamic';

// GET /api/clips?limit=20&offset=0 -> a page of visible clips (public)
// GET /api/clips                   -> all visible clips
// GET /api/clips?all=1             -> everything incl. hidden (editors only)
export async function GET(request) {
  const params = new URL(request.url).searchParams;
  const wantAll = params.get('all') === '1';
  const editor = getSessionUser(request);

  let limit = null;
  let offset = 0;
  if (params.get('limit') !== null) {
    const parsedLimit = Math.trunc(Number(params.get('limit')));
    limit = Number.isFinite(parsedLimit) ? Math.min(100, Math.max(1, parsedLimit)) : 20;
    const parsedOffset = Math.trunc(Number(params.get('offset')));
    offset = Number.isFinite(parsedOffset) ? Math.max(0, parsedOffset) : 0;
  }

  const clips = await listClips({ includeHidden: wantAll && !!editor, limit, offset });
  return NextResponse.json({ clips });
}

// POST /api/clips  { text, url, score? }  (editors only)
export async function POST(request) {
  const editor = getSessionUser(request);
  if (!editor) return NextResponse.json({ error: 'Not logged in' }, { status: 401 });

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }

  const text = String(body.text || '').trim();
  let url = String(body.url || '').trim();
  const score = Number.isFinite(Number(body.score)) ? Math.trunc(Number(body.score)) : 0;

  if (!text) return NextResponse.json({ error: 'Clip text is required' }, { status: 400 });
  if (!url) return NextResponse.json({ error: 'Source URL is required' }, { status: 400 });
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  try {
    new URL(url);
  } catch {
    return NextResponse.json({ error: 'Source URL is not a valid URL' }, { status: 400 });
  }

  const clip = await createClip({ text, url, score, addedBy: editor });
  return NextResponse.json({ clip }, { status: 201 });
}
