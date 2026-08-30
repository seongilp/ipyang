import { fetchAnimals, MAX_ROWS, type RawAnimal } from './animal-api';
import { normalizeAnimal, type Animal } from './animal';

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

async function collect(force = false): Promise<AnimalSnapshot> {
  const rows: RawAnimal[] = [];
  let totalCount = 0;

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const result = await fetchAnimals({ page, rows: MAX_ROWS }, force);
    totalCount = result.totalCount;
    rows.push(...result.items);
    if (result.items.length < MAX_ROWS || rows.length >= totalCount) break;
  }

  return {
    animals: rows.map(normalizeAnimal).sort(byDeadline),
    fetchedAt: new Date().toISOString(),
  };
}

/** 마감 임박 순. 기한 미상은 뒤로, 이미 지난 것은 더 뒤로(최근에 끝난 순). */
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
  if (cached && Date.now() - cached.at < TTL_MS) return cached.snapshot;
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
 * 그래서 메모리 필터는 daysLeft 부호로 판정한다.
 */
export type StateCode = 'notice' | 'protect' | 'return';

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
