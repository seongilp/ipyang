import { NextResponse } from 'next/server';

import { assertCron, siteUrl } from '@/lib/cron-auth';
import { getAnimalSnapshotFresh } from '@/lib/animal-cache';
import { dayToYmd, kstToday } from '@/lib/kst';
import { hasWebhook, sendNewNotices } from '@/lib/discord';

/**
 * 새 공고 알림.
 *
 * "새로 뜬 것"의 기준은 `noticeSdt`(공고 시작일)다. 개체 단위로 무엇을 이미 보냈는지
 * 기억하려면 저장소가 필요한데, 이 앱은 상태를 두지 않는다.
 * 대신 **하루치를 통째로** 보내고 하루 한 번만 돈다 — 중복 없이 목적을 달성한다.
 *
 * 그 하루는 **어제**다. 오늘치가 아니다.
 * 이 크론은 `30 22 UTC` = 07:30 KST 에 도는데, 그 시각엔 당일 공고가 거의 등록돼 있지
 * 않다. 보호소 등록은 업무 시간 내내 들어온다 — 16:40 KST 실측으로 당일 26건,
 * 전날 138건, 그 전날 202건이었다. 오늘치를 보내면 하루 분의 5분의 1도 안 되는
 * 알림이 나가고 나머지는 영영 안 나간다. 어제를 보내면 하루가 다 쌓인 뒤라 전수가 나간다.
 *
 * 발송 시각을 늦추지 않은 이유: 어느 시각이든 "그날치가 다 들어왔다"는 보장이 없고,
 * Hobby 크론은 ±59분 지터가 있어 경계가 더 흐려진다. 지터를 다 먹어도 실행 시각은
 * KST 06:31~08:29 라 **KST 날짜가 바뀌지 않는다**(자정은 15:00 UTC). 그래서 "어제"가
 * 실행마다 정확히 하루씩 전진한다 — 빠뜨리는 날도, 겹치는 날도 없다.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  const denied = assertCron(request);
  if (denied) return denied;

  if (!hasWebhook()) {
    return NextResponse.json({ ok: false, reason: 'DISCORD_WEBHOOK_URL 없음' }, { status: 503 });
  }

  // 발송 직전 강제 수집. 하루에 한 번뿐인 발송이라 캐시된(최대 30분 묵은) 목록이면
  // 그 사이 들어온 공고를 통째로 빠뜨린다 — 이 라우트에선 되돌릴 기회가 없다.
  const started = Date.now();
  const { animals, fetchedAt } = await getAnimalSnapshotFresh();
  const targetYmd = dayToYmd(kstToday() - 1);
  const sent = await sendNewNotices(animals, targetYmd, siteUrl());

  return NextResponse.json({
    ok: true,
    noticeSdt: targetYmd,
    newCount: sent,
    fetchedAt,
    elapsedMs: Date.now() - started,
  });
}
