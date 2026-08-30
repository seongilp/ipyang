import { NextResponse } from 'next/server';

import { AnimalApiFailure } from '@/lib/animal-api';
import { filterAnimals, getAllAnimals, SPECIES_BY_CODE } from '@/lib/animal-cache';

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

  try {
    const all = await getAllAnimals();

    const filtered = filterAnimals(all, {
      species: SPECIES_BY_CODE[params.get('upkind') ?? ''],
      region: params.get('region') ?? undefined,
      state: params.get('state') ?? undefined,
      keyword: params.get('q') ?? undefined,
    });

    const start = (page - 1) * PAGE_SIZE;

    return NextResponse.json(
      {
        totalCount: filtered.length,
        pageSize: PAGE_SIZE,
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
