import { NextResponse } from 'next/server';
import { getSessionUser } from '../../../lib/auth';

export async function GET(request) {
  const username = getSessionUser(request);
  return NextResponse.json({ username: username || null });
}
