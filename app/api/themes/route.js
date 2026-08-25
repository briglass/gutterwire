import { NextResponse } from 'next/server';
import { listThemes, createTheme } from '../../../lib/db';
import { getSessionUser } from '../../../lib/auth';

export const dynamic = 'force-dynamic';

const MAX_ACTIVE_THEMES = 10;

// GET /api/themes  -> active themes (editors only)
export async function GET(request) {
  const editor = getSessionUser(request);
  if (!editor) return NextResponse.json({ error: 'Not logged in' }, { status: 401 });
  const themes = await listThemes();
  return NextResponse.json({ themes });
}

// POST /api/themes  { text }  (editors only)
export async function POST(request) {
  const editor = getSessionUser(request);
  if (!editor) return NextResponse.json({ error: 'Not logged in' }, { status: 401 });

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }

  const text = String(body.text || '').trim().replace(/\s+/g, ' ');
  if (!text) return NextResponse.json({ error: 'Theme text is required' }, { status: 400 });
  if (text.length > 80) {
    return NextResponse.json({ error: 'Keep themes under 80 characters' }, { status: 400 });
  }

  const active = await listThemes();
  if (active.length >= MAX_ACTIVE_THEMES) {
    return NextResponse.json(
      { error: `Max ${MAX_ACTIVE_THEMES} active themes; delete one first` },
      { status: 400 }
    );
  }
  if (active.some((t) => t.text.toLowerCase() === text.toLowerCase())) {
    return NextResponse.json({ error: 'That theme is already active' }, { status: 400 });
  }

  const theme = await createTheme({ text, addedBy: editor });
  return NextResponse.json({ theme }, { status: 201 });
}
