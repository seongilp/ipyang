import { NextResponse } from 'next/server';

import { assertCron, siteUrl } from './cron-auth';
import { getAllAnimals } from './animal-cache';
import { hasWebhook, sendSummary } from './discord';

/**
 * 현황 요약 발송. 아침(09시)·저녁(18시) 라우트가 이 동작을 공유한다.
 *
 * 두 시각을 **경로로 나눈** 이유:
 * Vercel 은 같은 path 를 두 스케줄로 등록하는 것 자체는 지원한다
 * (`x-vercel-cron-schedule` 헤더로 어느 스케줄인지 구분하라고 문서에 적혀 있다).
 * 다만 `vercel crons ls` 는 크론을 **path 로 식별해서** 로컬 vercel.json 과 배포본을
 * 비교하기 때문에, 같은 path 가 두 번 나오면 둘을 한 항목으로 보고
 * "0 9 * * * → 0 0 * * * modified" 라는 없는 변경을 만들어 낸다.
 * 재배포해도 사라지지 않는 경고라 실제 미배포 변경과 구분이 안 된다.
 * 경로를 나누면 배포 상태와 로컬 설정이 1:1 로 맞아 그 착시가 없어진다.
 */
export async function runSummaryCron(request: Request): Promise<Response> {
  const denied = assertCron(request);
  if (denied) return denied;

  if (!hasWebhook()) {
    return NextResponse.json({ ok: false, reason: 'DISCORD_WEBHOOK_URL 없음' }, { status: 503 });
  }

  const animals = await getAllAnimals();
  await sendSummary(animals, siteUrl());

  return NextResponse.json({ ok: true, total: animals.length });
}
