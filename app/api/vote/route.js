import { NextResponse } from 'next/server';
import { bumpScore } from '../../../lib/db';

export const dynamic = 'force-dynamic';

// POST /api/vote  { id, delta }  (public)
// delta is clamped to [-2, 2] so a browser can reverse a previous vote
// (e.g. up -> down is -2) but nobody can jump a clip by an arbitrary amount
// in one request.
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }

  const id = Number(body.id);
  let delta = Math.trunc(Number(body.delta));
  if (!Number.isInteger(id) || !Number.isFinite(delta) || delta === 0) {
    return NextResponse.json({ error: 'Bad vote' }, { status: 400 });
  }
  delta = Math.max(-2, Math.min(2, delta));

  const result = await bumpScore(id, delta);
  if (!result) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(result);
}
