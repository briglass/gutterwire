import { NextResponse } from 'next/server';
import { deleteTheme } from '../../../../lib/db';
import { getSessionUser } from '../../../../lib/auth';

export const dynamic = 'force-dynamic';

// DELETE /api/themes/:id  (editors only)
export async function DELETE(request, { params }) {
  const editor = getSessionUser(request);
  if (!editor) return NextResponse.json({ error: 'Not logged in' }, { status: 401 });

  const { id } = await params;
  const themeId = Number(id);
  if (!Number.isInteger(themeId)) return NextResponse.json({ error: 'Bad id' }, { status: 400 });

  const ok = await deleteTheme(themeId);
  if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
