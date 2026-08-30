import { NextResponse } from 'next/server';

import { AnimalApiFailure } from '@/lib/animal-api';
import { filterAnimals, getAnimalSnapshot, isStateCode, SPECIES_BY_CODE } from '@/lib/animal-cache';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const PAGE_SIZE = 60;

/**
 * 전체를 한 번 받아 두고 필터는 메모리에서 건다.
 *
 * 필터 조합마다 업스트림을 전수 수집하던 때는 캐시에 없는 조합이 **7초** 걸렸다(실측).
 * 조합 수만큼 캐시가 갈라져 대부분의 요청이 콜드였다. 전체가 6,791건뿐이라
 * 통째로 받는 편이 모든 면에서 낫다.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const params = new URL(request.url).searchParams;
  const page = Math.max(1, Number(params.get('page')) || 1);

  /**
   * 모르는 값은 400 으로 돌려준다.
   *
   * 예전에는 조용히 무시했다 — `state=bogus` 는 "notice 가 아니면 protect" 삼항에 걸려
   * 보호중 목록을, `upkind=999999` 는 코드 매핑이 undefined 라 전체 목록을 돌려줬다.
   * 둘 다 요청한 적 없는 결과를 200 으로 주는 거라 호출자가 오타를 알아챌 수 없다.
   */
  const state = params.get('state');
  if (state && !isStateCode(state)) {
    return NextResponse.json(
      { error: 'INVALID_STATE', message: `state 는 notice/protect/return 중 하나여야 합니다: ${state}` },
      { status: 400 },
    );
  }

  const upkind = params.get('upkind');
  if (upkind && !Object.hasOwn(SPECIES_BY_CODE, upkind)) {
    return NextResponse.json(
      {
        error: 'INVALID_UPKIND',
        message: `upkind 는 ${Object.keys(SPECIES_BY_CODE).join('/')} 중 하나여야 합니다: ${upkind}`,
      },
      { status: 400 },
    );
  }

  try {
    const { animals, fetchedAt } = await getAnimalSnapshot();

    const filtered = filterAnimals(animals, {
      species: SPECIES_BY_CODE[upkind ?? ''],
      region: params.get('region') ?? undefined,
      state: state ?? undefined,
      keyword: params.get('q') ?? undefined,
    });

    const start = (page - 1) * PAGE_SIZE;

    return NextResponse.json(
      {
        totalCount: filtered.length,
        pageSize: PAGE_SIZE,
        // 업스트림에서 실제로 받아온 시각. 갱신 여부를 밖에서 확인할 유일한 단서다.
        fetchedAt,
        animals: filtered.slice(start, start + PAGE_SIZE),
      },
      { headers: { 'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=7200' } },
    );
  } catch (error) {
    if (error instanceof AnimalApiFailure) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.status });
    }
    throw error;
  }
}
