import { NextResponse } from 'next/server';

import { assertCron, siteUrl } from '@/lib/cron-auth';
import { getAnimalSnapshotFresh } from '@/lib/animal-cache';
import { hasWebhook, sendNewNotices } from '@/lib/discord';

/**
 * 새 공고 알림.
 *
 * "새로 뜬 것"의 기준은 `noticeSdt`(공고 시작일)다. 개체 단위로 무엇을 이미 보냈는지
 * 기억하려면 저장소가 필요한데, 이 앱은 상태를 두지 않는다.
 * 대신 **오늘 시작된 공고**만 보내고 하루 한 번만 돈다 — 중복 없이 목적을 달성한다.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** KST 기준 오늘 YYYYMMDD. 서버가 UTC 라 직접 보정한다. */
function todayKst(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${kst.getUTCFullYear()}${pad(kst.getUTCMonth() + 1)}${pad(kst.getUTCDate())}`;
}

export async function GET(request: Request): Promise<Response> {
  const denied = assertCron(request);
  if (denied) return denied;

  if (!hasWebhook()) {
    return NextResponse.json({ ok: false, reason: 'DISCORD_WEBHOOK_URL 없음' }, { status: 503 });
  }

  // 발송 직전 강제 수집. "오늘 시작된 공고"를 찾는 크론이라 캐시된 목록이면
  // 오늘치가 아직 안 들어와 0건으로 조용히 넘어간다 — 이 라우트에선 치명적이다.
  const started = Date.now();
  const { animals, fetchedAt } = await getAnimalSnapshotFresh();
  const sent = await sendNewNotices(animals, todayKst(), siteUrl());

  return NextResponse.json({
    ok: true,
    newCount: sent,
    fetchedAt,
    elapsedMs: Date.now() - started,
  });
}
