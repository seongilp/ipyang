import { NextResponse } from 'next/server';

import { AnimalApiFailure, fetchAnimals, MAX_ROWS, type RawAnimal } from '@/lib/animal-api';
import { normalizeAnimal, type Animal } from '@/lib/animal';

/** 빌드 타임에 외부 API 를 부르지 않도록. 캐싱은 업스트림 fetch 의 revalidate 가 맡는다. */
export const dynamic = 'force-dynamic';
export const maxDuration = 45;

const PAGE_SIZE = 60;

/**
 * 안전장치. 공고 전체가 2,000~3,000건 수준이라 3~4콜이면 끝나지만,
 * 데이터가 갑자기 늘어도 무한 루프에 빠지지 않게 상한을 둔다.
 */
const MAX_PAGES = 8;

/**
 * 조건에 맞는 공고를 **전부** 받아 마감 임박 순으로 정렬한다.
 *
 * 왜 전부 받나: API 는 최신 공고순으로 준다. 그래서 한 페이지(60건) 안에서만 정렬하면
 * 정작 오늘·내일 마감인 개체가 뒷페이지에 묻힌다(실측: 20페이지에서 0일 남은 건이 나왔다).
 * 이 앱의 존재 이유가 "마감이 임박한 아이를 먼저 보여주는 것"이라 전수 정렬이 필요하다.
 *
 * 비용: 1,000건씩 3~4콜. 업스트림 fetch 가 30분 캐시되므로 필터 조합당 30분에 3콜이다.
 * 개발계정 일 10,000회 한도에 여유가 크다.
 */
async function fetchAllSorted(query: {
  upkind?: string;
  uprCd?: string;
  state?: string;
}): Promise<Animal[]> {
  const collected: RawAnimal[] = [];
  let totalCount = 0;

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const result = await fetchAnimals({ ...query, page, rows: MAX_ROWS });
    totalCount = result.totalCount;
    collected.push(...result.items);
    if (result.items.length < MAX_ROWS || collected.length >= totalCount) break;
  }

  const animals = collected.map(normalizeAnimal);

  return animals.sort((a, b) => {
    const left = a.daysLeft;
    const right = b.daysLeft;
    // 기한을 모르는 건 뒤로.
    if (left === null) return right === null ? 0 : 1;
    if (right === null) return -1;
    // 이미 지난 건 더 뒤로. 지난 것끼리는 최근에 끝난 순.
    const leftPast = left < 0;
    const rightPast = right < 0;
    if (leftPast !== rightPast) return leftPast ? 1 : -1;
    if (leftPast) return right - left;
    return left - right;
  });
}

export async function GET(request: Request): Promise<NextResponse> {
  const params = new URL(request.url).searchParams;
  const page = Math.max(1, Number(params.get('page')) || 1);

  try {
    const sorted = await fetchAllSorted({
      upkind: params.get('upkind') ?? undefined,
      uprCd: params.get('sido') ?? undefined,
      state: params.get('state') ?? undefined,
    });

    const start = (page - 1) * PAGE_SIZE;

    return NextResponse.json(
      {
        totalCount: sorted.length,
        pageSize: PAGE_SIZE,
        animals: sorted.slice(start, start + PAGE_SIZE),
      },
      {
        headers: { 'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=7200' },
      },
    );
  } catch (error) {
    if (error instanceof AnimalApiFailure) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.status });
    }
    throw error;
  }
}
