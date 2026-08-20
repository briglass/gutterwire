import { NextResponse } from 'next/server';
import { updateClip, deleteClip } from '../../../../lib/db';
import { getSessionUser } from '../../../../lib/auth';

export const dynamic = 'force-dynamic';

// PATCH /api/clips/:id  { text?, url?, score?, hidden? }  (editors only)
export async function PATCH(request, { params }) {
  const editor = getSessionUser(request);
  if (!editor) return NextResponse.json({ error: 'Not logged in' }, { status: 401 });

  const { id } = await params;
  const clipId = Number(id);
  if (!Number.isInteger(clipId)) return NextResponse.json({ error: 'Bad id' }, { status: 400 });

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }

  const fields = {};
  if (body.text !== undefined) {
    const text = String(body.text).trim();
    if (!text) return NextResponse.json({ error: 'Clip text cannot be empty' }, { status: 400 });
    fields.text = text;
  }
  if (body.url !== undefined) {
    let url = String(body.url).trim();
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    try {
      new URL(url);
    } catch {
      return NextResponse.json({ error: 'Source URL is not a valid URL' }, { status: 400 });
    }
    fields.url = url;
  }
  if (body.score !== undefined) {
    const score = Math.trunc(Number(body.score));
    if (!Number.isFinite(score)) return NextResponse.json({ error: 'Bad score' }, { status: 400 });
    fields.score = score;
  }
  if (body.hidden !== undefined) fields.hidden = !!body.hidden;

  const clip = await updateClip(clipId, fields);
  if (!clip) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ clip });
}

// DELETE /api/clips/:id  (editors only)
export async function DELETE(request, { params }) {
  const editor = getSessionUser(request);
  if (!editor) return NextResponse.json({ error: 'Not logged in' }, { status: 401 });

  const { id } = await params;
  const clipId = Number(id);
  if (!Number.isInteger(clipId)) return NextResponse.json({ error: 'Bad id' }, { status: 400 });

  const ok = await deleteClip(clipId);
  if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
