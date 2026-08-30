import { NextResponse } from 'next/server';

import { assertCron, siteUrl } from '@/lib/cron-auth';
import { getAllAnimals } from '@/lib/animal-cache';
import { hasWebhook, sendSummary } from '@/lib/discord';

/** 매일 09시·18시(KST) 현황 요약. */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  const denied = assertCron(request);
  if (denied) return denied;

  if (!hasWebhook()) {
    return NextResponse.json({ ok: false, reason: 'DISCORD_WEBHOOK_URL 없음' }, { status: 503 });
  }

  const animals = await getAllAnimals();
  await sendSummary(animals, siteUrl());

  return NextResponse.json({ ok: true, total: animals.length });
}
