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

/** 서버 인스턴스 안에서만 사는 캐시. Vercel 함수는 언제든 새로 뜨므로 최선의 추정이다. */
let cached: { at: number; animals: Animal[] } | null = null;

/** 서울시 데이터와 달리 공고는 하루 단위로 바뀐다. 30분이면 충분히 신선하다. */
const TTL_MS = 30 * 60 * 1000;

/** 진행 중인 수집. 동시에 여러 요청이 들어와도 업스트림은 한 번만 친다. */
let inflight: Promise<Animal[]> | null = null;

async function collect(): Promise<Animal[]> {
  const rows: RawAnimal[] = [];
  let totalCount = 0;

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const result = await fetchAnimals({ page, rows: MAX_ROWS });
    totalCount = result.totalCount;
    rows.push(...result.items);
    if (result.items.length < MAX_ROWS || rows.length >= totalCount) break;
  }

  return rows.map(normalizeAnimal).sort(byDeadline);
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

export async function getAllAnimals(): Promise<Animal[]> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.animals;
  if (inflight) return inflight;

  inflight = collect()
    .then((animals) => {
      cached = { at: Date.now(), animals };
      return animals;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
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
