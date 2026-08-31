import { displayState, endOutcome, isEnded, type Animal } from './animal';
import { resolveRegion } from './sigungu';

/**
 * 지도용 집계. 필터가 끝난 개체를 **시군구 행정구역 단위로 묶는다.**
 *
 * 개별 개체·보호소를 점으로 찍지 않는다 — 6,800마리를 점으로 뿌리는 건 무의미하고 느리다.
 * 지역별 마리 수와 결과 구성만 보여준다. 목록과 **같은 필터 결과**를 받으므로 지도·목록·
 * 인포그래픽이 늘 같은 숫자를 본다.
 *
 * 분류는 새로 만들지 않고 기존 판정을 그대로 재사용한다(displayState/isEnded/endOutcome).
 * 문구·배지·회색·인포그래픽이 전부 같은 기준을 봐야 한다.
 */

/**
 * 한 집합의 결과 구성.
 *
 *  waiting  아직 기다리는 개체. displayState 로 공고중/보호중을 가른다(daysLeft 부호 기준).
 *  ended    종료된 개체. 원본 상태 문자열별로 센다(종료(반환)·종료(자연사)…). 인포그래픽에서
 *           endOutcome 으로 삶/죽음을 다시 묶고, endOutcomeLabel 로 하위 유형을 보인다.
 */
export interface OutcomeTally {
  total: number;
  /** displayState 결과별. '공고중' / '보호중' / (기한 미상이면 원본 상태). */
  waiting: Record<string, number>;
  /** 원본 상태 문자열별. '종료(반환)' 등. */
  ended: Record<string, number>;
}

export interface RegionAgg extends OutcomeTally {
  /** `<시도2자리>_<시군구명>`. geojson `code` 와 일치. */
  code: string;
  /** 시군구명(예: 성남시). */
  name: string;
  /** 시도 약칭(예: 경기). */
  sido: string;
}

export interface RegionData {
  /** 시군구별 집계. 폴리곤 색·라벨·지역별 인포그래픽에 쓴다. */
  regions: RegionAgg[];
  /** 전체(지역 미상 포함) 집계. 지역 미선택 시 인포그래픽 기본값. */
  nationwide: OutcomeTally;
  /** 시군구로 못 떨어진 개체 수. 숨기지 않고 '지역 미상'으로 밝힌다. */
  unknownCount: number;
}

function emptyTally(): OutcomeTally {
  return { total: 0, waiting: {}, ended: {} };
}

/** 개체 하나를 집계에 더한다. waiting/ended 는 기존 판정을 그대로 쓴다. */
function add(tally: OutcomeTally, animal: Animal): void {
  tally.total += 1;
  if (isEnded(animal.state)) {
    tally.ended[animal.state] = (tally.ended[animal.state] ?? 0) + 1;
  } else {
    const label = displayState(animal); // '공고중' / '보호중' / (기한 미상 시 원본)
    tally.waiting[label] = (tally.waiting[label] ?? 0) + 1;
  }
}

export function buildRegionData(animals: Animal[]): RegionData {
  const nationwide = emptyTally();
  const byCode = new Map<string, RegionAgg>();
  let unknownCount = 0;

  for (const animal of animals) {
    add(nationwide, animal);

    const region = resolveRegion(animal.shelter.address);
    if (!region) {
      unknownCount += 1;
      continue;
    }

    let agg = byCode.get(region.code);
    if (!agg) {
      agg = { ...emptyTally(), code: region.code, name: region.name, sido: region.sido };
      byCode.set(region.code, agg);
    }
    add(agg, animal);
  }

  // 큰 지역부터. 폴리곤 라벨이 겹칠 때 개체 많은 곳을 우선 살린다.
  const regions = [...byCode.values()].sort((a, b) => b.total - a.total);

  return { regions, nationwide, unknownCount };
}

/**
 * 결과 구성 → 삶/죽음/대기 3그룹.
 *
 * 자연사·안락사는 **둘 다 별개 코드로 존재한다**(합치지 않는다). endOutcome 이 둘을 'loss'
 * 하나로 묶지만, 하위 유형은 endOutcomeLabel 로 따로 세어 인포그래픽에서 나눠 보인다 —
 * 자연사가 안락사보다 8배 많다는 것 자체가 정보다.
 */
export interface OutcomeGroups {
  /** 아직 기다림. 공고중/보호중 등. */
  waiting: { label: string; count: number }[];
  waitingTotal: number;
  /** 살아서 나감(반환·입양·기증·방사). */
  life: { label: string; count: number }[];
  lifeTotal: number;
  /** 죽음(자연사·안락사). */
  loss: { label: string; count: number }[];
  lossTotal: number;
  total: number;
}

/** 원본 상태 문자열('종료(반환)')에서 괄호 안 라벨만. 형식이 어긋나면 통째로. */
function bareLabel(state: string): string {
  return /^종료\(([^)]+)\)/.exec(state)?.[1] ?? state;
}

export function toGroups(tally: OutcomeTally): OutcomeGroups {
  const waiting = Object.entries(tally.waiting)
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
  const waitingTotal = waiting.reduce((sum, row) => sum + row.count, 0);

  const life: { label: string; count: number }[] = [];
  const loss: { label: string; count: number }[] = [];
  for (const [state, count] of Object.entries(tally.ended)) {
    (endOutcome(state) === 'life' ? life : loss).push({ label: bareLabel(state), count });
  }
  life.sort((a, b) => b.count - a.count);
  loss.sort((a, b) => b.count - a.count);
  const lifeTotal = life.reduce((sum, row) => sum + row.count, 0);
  const lossTotal = loss.reduce((sum, row) => sum + row.count, 0);

  return { waiting, waitingTotal, life, lifeTotal, loss, lossTotal, total: tally.total };
}
