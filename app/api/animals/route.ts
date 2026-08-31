import { NextResponse } from 'next/server';

import { AnimalApiFailure } from '@/lib/animal-api';
import { filterAnimals, getAnimalSnapshot, isStateCode, SPECIES_BY_CODE } from '@/lib/animal-cache';
import { msUntilKstMidnight } from '@/lib/kst';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const PAGE_SIZE = 60;

/** 신선한 것으로 취급할 최대 시간. 공고는 하루 단위로 바뀌므로 30분이면 충분하다. */
const FRESH_S = 1_800;

/**
 * CDN 수명을 **KST 자정에 맞춰 자른다.**
 *
 * 왜 자르나: `daysLeft` 는 수집 시점의 KST '오늘'을 기준으로 계산돼 이 응답에 박혀 있다.
 * 자정을 넘겨 재사용된 항목은 모든 개체가 하루씩 많게 나온다 — 얼마 전에 고친 하루 밀림
 * 결함이 캐시를 통해 되살아나는 셈이다. 예전 값(`s-maxage=1800, swr=7200`)은 자정 이후
 * **최대 2.5시간** 그 상태가 될 수 있었다. 자정에 하드 만료시키면 그 창이 0이 된다.
 *
 * 자르고 나니 오히려 `stale-while-revalidate` 를 **남은 하루치만큼 길게** 줄 수 있다.
 * 자정을 못 넘기는 것이 보장되므로 늘려도 하루 밀림이 안 생긴다. swr 구간에서 CDN 은
 * 옛 응답을 **즉시** 주고 뒤에서 갱신하므로, 사용자가 전수 수집(느릴 때 20초 이상)을
 * 기다리는 일이 낮 시간대에는 사실상 사라진다.
 *
 * 대가: 트래픽이 아주 뜸하면 그날 안에서 최대 반나절 묵은 목록을 볼 수 있다(새 공고가
 * 늦게 뜬다). 다만 stale 을 한 번 주는 순간 뒤에서 갱신이 걸리므로 방문이 조금이라도
 * 있으면 30분 신선도로 수렴한다. 그리고 상세에 `fetchedAt` 을 그대로 노출하므로
 * 사용자에게 묵은 데이터를 신선한 척 보여주지는 않는다.
 *
 * 남는 비용: 자정 직후 첫 요청 한 건은 전수 수집을 기다린다. KST 자정은 이 앱에서
 * 트래픽이 가장 적은 시간대라 하루 한 명이 감당하는 값으로 받아들인다.
 */
function cacheControl(nowMs: number = Date.now()): string {
  const untilMidnight = Math.max(0, Math.floor(msUntilKstMidnight(nowMs) / 1000));
  const maxAge = Math.min(FRESH_S, untilMidnight);
  const staleWhileRevalidate = untilMidnight - maxAge;
  return `public, s-maxage=${maxAge}, stale-while-revalidate=${staleWhileRevalidate}`;
}

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
      // 지도에서 시군구를 눌러 넘어왔을 때 그 지역 개체만. 없으면 전체.
      regionCode: params.get('rc') ?? undefined,
    });

    const start = (page - 1) * PAGE_SIZE;

    /*
     * 상태(processState)별 건수. 종료 요약 배너가 하위 유형 분포를 그리는 데 쓴다.
     * 한 페이지(60건)만 받는 클라이언트는 전체 분포를 알 수 없으므로 여기서 전수 집계해 넘긴다.
     * O(n) 이고 filtered 는 이미 메모리에 있어 부담이 없다. 필터가 걸리면 그 부분집합의 분포라,
     * 배너 수치가 실제로 보이는 목록과 항상 일치한다.
     */
    const stateBreakdown: Record<string, number> = {};
    for (const animal of filtered) {
      stateBreakdown[animal.state] = (stateBreakdown[animal.state] ?? 0) + 1;
    }

    return NextResponse.json(
      {
        totalCount: filtered.length,
        pageSize: PAGE_SIZE,
        // 업스트림에서 실제로 받아온 시각. 갱신 여부를 밖에서 확인할 유일한 단서다.
        fetchedAt,
        stateBreakdown,
        animals: filtered.slice(start, start + PAGE_SIZE),
      },
      { headers: { 'Cache-Control': cacheControl() } },
    );
  } catch (error) {
    if (error instanceof AnimalApiFailure) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.status });
    }
    throw error;
  }
}
