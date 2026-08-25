import { NextResponse } from 'next/server';
import { runIngest } from '../../../lib/ingest';
import { getSessionUser } from '../../../lib/auth';

export const dynamic = 'force-dynamic';
// Each article costs an outbound fetch plus an LLM call; give the run room.
export const maxDuration = 60;

// Vercel Cron calls GET with "Authorization: Bearer <CRON_SECRET>".
// Editors can also trigger a run from the admin desk (session cookie).
function authorize(request) {
  const auth = request.headers.get('authorization');
  if (process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`) {
    return 'cron';
  }
  return getSessionUser(request);
}

async function handle(request) {
  const caller = authorize(request);
  if (!caller) return NextResponse.json({ error: 'Not authorized' }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const dryRun = params.get('dry') === '1';
  const parsedLimit = Math.trunc(Number(params.get('limit')));
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(10, parsedLimit) : undefined;

  try {
    const summary = await runIngest({ dryRun, limit });
    return NextResponse.json({ caller, ...summary });
  } catch (err) {
    return NextResponse.json(
      { error: String(err && err.message ? err.message : err) },
      { status: 500 }
    );
  }
}

export async function GET(request) {
  return handle(request);
}

export async function POST(request) {
  return handle(request);
}
