import { NextResponse } from 'next/server';

import { assertCron } from '@/lib/cron-auth';
import { getAllAnimals } from '@/lib/animal-cache';

/**
 * 새벽 데이터 수집.
 *
 * 캐시는 서버 인스턴스 메모리에 있고 Vercel 함수는 언제든 새로 뜨므로,
 * 이 라우트가 "미리 데워두는" 역할을 완전히 보장하지는 못한다.
 * 다만 업스트림 fetch 에 걸린 30분 revalidate 가 Vercel Data Cache 에 남으므로,
 * 새벽에 한 번 돌려두면 아침 첫 사용자가 콜드를 덜 맞는다.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  const denied = assertCron(request);
  if (denied) return denied;

  const started = Date.now();
  const animals = await getAllAnimals();

  return NextResponse.json({
    ok: true,
    count: animals.length,
    elapsedMs: Date.now() - started,
  });
}
