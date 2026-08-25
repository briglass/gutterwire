import { NextResponse } from 'next/server';
import { getThemeText, setThemeText } from '../../../lib/db';
import { getSessionUser } from '../../../lib/auth';

export const dynamic = 'force-dynamic';

const MAX_CHARS = 6000;

// GET /api/themes  -> the editors' free-form theme text (editors only)
export async function GET(request) {
  const editor = getSessionUser(request);
  if (!editor) return NextResponse.json({ error: 'Not logged in' }, { status: 401 });
  const text = await getThemeText();
  return NextResponse.json({ text });
}

// POST /api/themes  { text }  -> save the theme text (editors only)
export async function POST(request) {
  const editor = getSessionUser(request);
  if (!editor) return NextResponse.json({ error: 'Not logged in' }, { status: 401 });

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }

  const text = String(body.text ?? '').slice(0, MAX_CHARS);
  await setThemeText(text, editor);
  return NextResponse.json({ ok: true, chars: text.length });
}
