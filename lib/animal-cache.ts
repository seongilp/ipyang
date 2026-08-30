import { fetchAnimals, MAX_ROWS, type RawAnimal } from './animal-api';
import { normalizeAnimal, type Animal } from './animal';
import { kstToday } from './kst';

/**
 * 전체 공고를 한 번만 받아 두고, 필터는 메모리에서 건다.
 *
 * 왜: 처음에는 필터 조합마다 업스트림을 전수 수집했는데, 캐시에 없는 조합은
 * 매번 3~4콜이 새로 돌아 **7초**가 걸렸다(실측). 조합 수만큼 캐시가 갈라지니
 * 대부분의 요청이 콜드였다.
 *
 * 전체가 6,791건뿐이라 통째로 받아도 7콜이면 끝난다. 한 번 받아 두면 어떤 필터
 * 조합이든 메모리 필터링이라 즉시 응답한다. 업스트림 호출도 조합 수와 무관하게
 * 30분에 7콜로 고정된다.
 */

const MAX_PAGES = 12;

/**
 * 한 번의 전수 수집 결과.
 *
 * `fetchedAt` 을 같이 들고 다니는 이유: 이게 없으면 "데이터가 실제로 갱신됐는지"를
 * 밖에서 확인할 방법이 없다. 응답 본문을 바이트 단위로 비교하는 수밖에 없었고,
 * 실제로 크론이 캐시만 읽고 있던 결함을 잡는 데 그 때문에 시간을 크게 썼다.
 *
 * 값은 업스트림 응답의 `Date` 헤더다(`animal-api.ts`). 수집을 끝낸 시각을 찍으면
 * Next Data Cache 히트일 때 최대 30분 묵은 데이터를 "방금"이라고 보고하게 된다.
 */
export interface AnimalSnapshot {
  animals: Animal[];
  fetchedAt: string;
}

/** 서버 인스턴스 안에서만 사는 캐시. Vercel 함수는 언제든 새로 뜨므로 최선의 추정이다. */
let cached: { at: number; snapshot: AnimalSnapshot } | null = null;

/**
 * 서울시 데이터와 달리 공고는 하루 단위로 바뀐다. 30분이면 충분히 신선하다.
 *
 * 알림 크론이 발송 직전에 강제 수집하게 바꾼 뒤에도 30분을 유지한다.
 * 알림 시각(07:30/09:00/18:00) 사이는 여전히 이 TTL 이 신선도를 정하는데,
 * 18:00 → 다음 07:30 이 13시간 반이라 가장 긴 구간이다. 보호소 등록은 업무 시간 내내
 * 들어오므로 이 창을 늘리면 사용자가 보는 목록이 실제로 뒤처진다.
 * 비용도 막지 않는다 — 전수 수집이 7콜이라 최악(30분마다 갱신)이 하루 336콜,
 * data.go.kr 일 10,000 한도에 여유가 크다. 그래서 바꾸지 않는다.
 */
const TTL_MS = 30 * 60 * 1000;

/** 진행 중인 수집. 동시에 여러 요청이 들어와도 업스트림은 한 번만 친다. */
let inflight: Promise<AnimalSnapshot> | null = null;

/**
 * 업스트림에 동시에 띄우는 페이지 수.
 *
 * 6이면 현재 데이터(6,582건 = 7페이지)에서 2페이지부터 끝까지가 **한 묶음**에 들어간다.
 * 그래서 전수 수집의 직렬 왕복이 7번에서 2번(1페이지 → 나머지)으로 줄어든다.
 *
 * 왜 더 올리지 않나: 왕복이 이미 2번이라 그 이상은 얻는 게 없고, 정부 API 에 한 번에
 * 던지는 동시 요청만 늘어난다. 왜 더 내리지 않나: 4로 재 봤을 때 묶음이 2개가 되어
 * 느린 구간에서 손해였다(실측 c=4 10.2~15.8s vs c=7 2.4~9.2s — 다만 업스트림 편차가
 * 워낙 커서 둘의 차이보다 같은 설정의 회차 간 차이가 더 컸다).
 * 메모리는 c=7 에서 RSS 148MB 로 문제되지 않았다.
 *
 * data.go.kr 호출 **횟수**는 순차와 동일하다. 일 10,000 쿼터에는 영향이 없다.
 */
const COLLECT_CONCURRENCY = 6;

/**
 * 전수 수집. 1페이지로 총 건수를 먼저 알아낸 뒤 나머지를 묶음 병렬로 받는다.
 *
 * 왜 바꿨나: 예전에는 7페이지를 **순차**로 받아 콜드 요청 하나가 6.95초를 기다렸다.
 * 한 페이지가 1~2.3초(한국에서 실측)라 그 시간의 거의 전부가 대기다 — 연산이 아니다.
 * 첫 응답의 `totalCount` 로 필요한 페이지 수가 정해지므로, 2페이지부터는 서로를
 * 기다릴 이유가 없다.
 *
 * 순차의 유일한 장점이던 "조기 종료"(`items.length < MAX_ROWS` 면 그만)는 totalCount 로
 * 페이지 수를 먼저 계산해 대신한다. 결과적으로 요청 수는 예전과 같거나 적다.
 */
async function collect(force = false): Promise<AnimalSnapshot> {
  const first = await fetchAnimals({ page: 1, rows: MAX_ROWS }, force);
  const totalCount = first.totalCount;
  const rows: RawAnimal[] = [...first.items];
  // 페이지마다 캐시 히트 여부가 다를 수 있다. 스냅샷의 신선도는 **가장 오래된** 페이지가 정한다.
  let oldestFetchedAt: string | null = first.fetchedAt;

  // 1페이지가 덜 찼으면 그게 전부다. 총 건수를 못 믿을 때도 MAX_PAGES 에서 멈춘다.
  const lastPage =
    first.items.length < MAX_ROWS ? 1 : Math.min(MAX_PAGES, Math.ceil(totalCount / MAX_ROWS));

  for (let page = 2; page <= lastPage; page += COLLECT_CONCURRENCY) {
    const batch = [];
    for (let offset = 0; offset < COLLECT_CONCURRENCY && page + offset <= lastPage; offset += 1) {
      batch.push(fetchAnimals({ page: page + offset, rows: MAX_ROWS }, force));
    }

    // 한 페이지라도 실패하면 목록에 구멍이 난 채로 30분간 캐시된다. 통째로 실패시킨다.
    for (const result of await Promise.all(batch)) {
      rows.push(...result.items);
      if (result.fetchedAt < oldestFetchedAt) oldestFetchedAt = result.fetchedAt;
    }
  }

  // 한 스냅샷 안의 모든 개체가 같은 '오늘'을 기준으로 daysLeft 를 갖게 한다.
  // 수집 도중 KST 자정을 넘기면 앞뒤 페이지의 기준일이 갈릴 수 있다.
  const now = Date.now();

  return {
    animals: dedupe(rows)
      .map((raw) => normalizeAnimal(raw, now))
      .sort(byDeadline),
    fetchedAt: oldestFetchedAt,
  };
}

/**
 * 업스트림에 같은 `desertionNo` 가 두 번 오는 경우가 있다(state=notice 2,361건 중 5건 실측).
 * React key 중복과 "총 N건"의 과대 계수를 만들므로 먼저 온 것만 남긴다.
 */
function dedupe(rows: RawAnimal[]): RawAnimal[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (!row.desertionNo) return true;
    if (seen.has(row.desertionNo)) return false;
    seen.add(row.desertionNo);
    return true;
  });
}

/** 마감 임박 순 → 이미 지난 것(최근에 끝난 순) → 기한 미상. */
export function byDeadline(a: Animal, b: Animal): number {
  const left = a.daysLeft;
  const right = b.daysLeft;
  if (left === null) return right === null ? 0 : 1;
  if (right === null) return -1;
  const leftPast = left < 0;
  const rightPast = right < 0;
  if (leftPast !== rightPast) return leftPast ? 1 : -1;
  if (leftPast) return right - left;
  return left - right;
}

export async function getAnimalSnapshot(): Promise<AnimalSnapshot> {
  /*
   * TTL 뿐 아니라 **KST 날짜가 바뀌었는지**도 본다.
   *
   * `daysLeft` 는 수집 시점의 '오늘'을 기준으로 계산돼 스냅샷에 박혀 있다. 자정 직전에
   * 채운 캐시를 자정 이후에 그대로 내보내면 모든 개체의 남은 날이 하루씩 많게 나온다 —
   * 방금 고친 그 결함이 30분짜리로 되살아나는 셈이다.
   *
   * 예전에는 여기까지만 막을 수 있었고 CDN 캐시가 자정 직후 어제 계산을 계속 내보냈다.
   * 지금은 라우트가 CDN 수명을 KST 자정에 맞춰 자르므로(`app/api/animals/route.ts` 의
   * `cacheControl`) 두 겹이 같은 경계를 쓴다.
   */
  const now = Date.now();
  if (cached && now - cached.at < TTL_MS && kstToday(cached.at) === kstToday(now)) {
    return cached.snapshot;
  }
  if (inflight) return inflight;

  inflight = collect()
    .then((snapshot) => {
      cached = { at: Date.now(), snapshot };
      return snapshot;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

export async function getAllAnimals(): Promise<Animal[]> {
  return (await getAnimalSnapshot()).animals;
}

/**
 * 캐시를 전부 무시하고 지금 업스트림에서 다시 받는다. **알림 크론 전용.**
 *
 * 캐시가 두 겹이라 둘 다 뚫어야 한다 —
 *  (1) 이 파일의 `cached`/`TTL_MS` 메모리 캐시: `getAnimalSnapshot` 을 아예 거치지 않는다.
 *  (2) Next 의 Data Cache: `collect(true)` → `fetchAnimals(..., force)` → `cache: 'no-store'`.
 * 한 겹만 뚫으면 여전히 옛 공고 목록이 발송된다.
 *
 * `inflight` 는 건드리지 않는다. 강제 수집이 그 자리를 차지하면 동시에 들어온
 * 사용자 요청의 중복 제거가 깨진다. 대신 결과로 `cached` 만 갱신해서,
 * 알림 직후 접속한 사용자도 방금 받은 데이터를 보게 한다(워밍 효과).
 */
export async function getAnimalSnapshotFresh(): Promise<AnimalSnapshot> {
  const snapshot = await collect(true);
  cached = { at: Date.now(), snapshot };
  return snapshot;
}

export interface AnimalFilters {
  /** 축종 대분류명. API 코드가 아니라 응답의 upKindNm 과 맞춘다. */
  species?: string;
  /** 시도명 일부. 보호소 관할 기관명(orgNm)으로 거른다. */
  region?: string;
  state?: string;
  /** 자유 키워드. 품종·특징·보호소·지역을 한꺼번에 훑는다. */
  keyword?: string;
}

/** API 의 upkind 코드 → 응답의 upKindNm. 메모리 필터링에 쓴다. */
export const SPECIES_BY_CODE: Record<string, string> = {
  '417000': '개',
  '422400': '고양이',
  '429900': '기타',
};

/**
 * `state` 파라미터는 응답 필드로 재현할 수 없다.
 *
 * `state=notice` 와 `state=protect` 둘 다 processState 가 '보호중' 으로 온다(실측 300건씩).
 * 실제로 갈리는 축은 **공고 기간**이다 — notice 는 noticeEdt 가 오늘 이후인 것 300/300,
 * protect 는 지난 것 300/300 이었다.
 * 그래서 메모리 필터는 daysLeft 부호로 판정한다. **오늘 마감(daysLeft === 0)은 공고중이다** —
 * 가장 급한 개체라 여기서 밀려나면 기본 화면에서 사라진다.
 */
export type StateCode = 'notice' | 'protect' | 'return';

const STATE_CODES: readonly string[] = ['notice', 'protect', 'return'];

export function isStateCode(value: string): value is StateCode {
  return STATE_CODES.includes(value);
}

function matchesState(animal: Animal, state: string): boolean {
  // processState 가 '종료(반환)' '종료(안락사)' 처럼 괄호가 붙어 온다.
  if (state === 'return') return animal.state.startsWith('종료');
  if (animal.state.startsWith('종료')) return false;
  if (animal.daysLeft === null) return true;
  return state === 'notice' ? animal.daysLeft >= 0 : animal.daysLeft < 0;
}

export function filterAnimals(animals: Animal[], filters: AnimalFilters): Animal[] {
  const keyword = filters.keyword?.trim().toLowerCase();

  return animals.filter((animal) => {
    if (filters.species && animal.species !== filters.species) return false;
    if (filters.state && !matchesState(animal, filters.state)) return false;
    if (filters.region && !animal.shelter.org.includes(filters.region)) return false;

    if (keyword) {
      // 품종·특징·보호소·지역을 한꺼번에 훑는다. 사용자가 무엇으로 찾을지 모른다.
      const haystack = [
        animal.breed,
        animal.note,
        animal.color,
        animal.shelter.name,
        animal.shelter.org,
        animal.shelter.address,
        animal.foundPlace,
      ]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(keyword)) return false;
    }

    return true;
  });
}
