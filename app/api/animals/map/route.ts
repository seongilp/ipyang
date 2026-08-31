import { NextResponse } from 'next/server';

import { AnimalApiFailure } from '@/lib/animal-api';
import { filterAnimals, getAnimalSnapshot, isStateCode, SPECIES_BY_CODE } from '@/lib/animal-cache';
import { msUntilKstMidnight } from '@/lib/kst';
import { buildRegionData } from '@/lib/map-data';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const FRESH_S = 1_800;

/**
 * 목록 라우트와 **같은 규칙으로** CDN 수명을 KST 자정에 자른다.
 * 집계에 daysLeft 기반 공고중/보호중 구분이 들어가므로 자정을 넘겨 재사용되면 어긋난다.
 */
function cacheControl(nowMs: number = Date.now()): string {
  const untilMidnight = Math.max(0, Math.floor(msUntilKstMidnight(nowMs) / 1000));
  const maxAge = Math.min(FRESH_S, untilMidnight);
  return `public, s-maxage=${maxAge}, stale-while-revalidate=${untilMidnight - maxAge}`;
}

/**
 * 지도용 시군구 집계. 목록과 똑같이 필터한 개체를 행정구역 단위로 묶어 돌려준다.
 *
 * 개별 개체는 담지 않는다 — 지도는 지역별 마리 수와 결과 구성만 보여준다.
 * 필터 검증·필터링 로직은 목록 라우트와 공유한다(둘이 다른 걸 보여주면 안 된다).
 */
export async function GET(request: Request): Promise<NextResponse> {
  const params = new URL(request.url).searchParams;

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

    const { regions, nationwide, unknownCount } = buildRegionData(filtered);

    return NextResponse.json(
      { fetchedAt, totalCount: filtered.length, regions, nationwide, unknownCount },
      { headers: { 'Cache-Control': cacheControl() } },
    );
  } catch (error) {
    if (error instanceof AnimalApiFailure) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.status });
    }
    throw error;
  }
}
