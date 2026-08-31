import type { RawAnimal } from './animal-api';
import { dayToYmd, daysUntilKst, kstToday } from './kst';

/**
 * 화면이 쓰는 구조동물 모델.
 *
 * 원본 필드명이 축약형(desertionNo, noticeEdt…)이라 그대로 쓰면 읽기 어렵다.
 * 그리고 원본에는 없지만 이 앱의 핵심인 값이 하나 있다 — **공고 마감까지 남은 날**.
 */
export interface Animal {
  id: string;
  /** 개 / 고양이 / 기타 */
  species: string;
  breed: string;
  sex: '수컷' | '암컷' | '미상';
  neutered: '예' | '아니오' | '미상';
  age: string;
  weight: string;
  color: string;
  /** 특징. 보호소가 자유롭게 적는 칸이라 길이가 들쭉날쭉하다. */
  note: string;
  photo: string | null;
  photos: string[];
  foundAt: string;
  foundPlace: string;
  noticeFrom: string;
  noticeTo: string;
  /** 공고 마감까지 남은 일수. 음수면 이미 지났다. 알 수 없으면 null. */
  daysLeft: number | null;
  state: string;
  shelter: {
    name: string;
    tel: string;
    address: string;
    regNo: string;
    org: string;
  };
  /** 이 레코드가 마지막으로 갱신된 시각. 화면에 반드시 노출해야 한다. */
  updatedAt: string;
}

export function formatYmd(value: string | undefined): string {
  if (!value || !/^\d{8}$/.test(value)) return '—';
  return `${value.slice(0, 4)}.${value.slice(4, 6)}.${value.slice(6, 8)}`;
}

/** `20260830110813` 같은 갱신시각을 사람이 읽을 형태로. */
export function formatUpdatedAt(value: string | undefined): string {
  if (!value) return '—';
  const digits = value.replace(/\D/g, '');
  if (digits.length < 12) return formatYmd(digits.slice(0, 8));
  return `${formatYmd(digits.slice(0, 8))} ${digits.slice(8, 10)}:${digits.slice(10, 12)}`;
}

/**
 * 카드에 붙일 상태 라벨.
 *
 * 원본 `processState` 를 그대로 쓰면 공고중이든 보호중이든 전부 '보호중' 이라고 나온다
 * (업스트림이 두 상태를 구분해 주지 않는다 — animal-cache.ts 의 matchesState 참고).
 * 필터는 '공고중' 인데 배지는 '보호중' 이라 한 화면에서 말이 어긋났다.
 * 목록 필터와 **같은 축**(공고 기간)으로 라벨을 뽑아 둘을 일치시킨다.
 */
export function displayState(animal: Pick<Animal, 'state' | 'daysLeft'>): string {
  if (animal.state.startsWith('종료')) return animal.state;
  if (animal.daysLeft === null) return animal.state;
  return animal.daysLeft >= 0 ? '공고중' : '보호중';
}

/** 공고가 이미 끝난(종료된) 개체인가. `processState` 가 '종료(...)' 로 온다. */
export function isEnded(state: string): boolean {
  return state.startsWith('종료');
}

/**
 * 종료 결과를 **삶/죽음** 두 축으로 가른다.
 *
 * 왜 이 구분이 핵심인가: '종료' 안에는 성격이 완전히 다른 결과가 섞여 있다(실측 2,126건).
 *   반환·입양·기증·방사 — 살아서 나갔다(전체의 62.6%)
 *   자연사·안락사       — 죽었다(37.4%)
 * 한 문장("떠나갔습니다")으로 뭉치면 가족 품으로 돌아간 절반을 죽은 것처럼 말하게 된다.
 *
 * 죽음 코드만 화이트리스트로 못박는다. 정부가 새 코드를 추가하더라도(미지의 코드는)
 * 죽음으로 단정하지 않고 '삶' 쪽으로 두는 편이 덜 위험하다 — 산 아이를 죽었다고
 * 말하는 것이 그 반대보다 훨씬 큰 왜곡이기 때문이다.
 */
export type EndOutcome = 'life' | 'loss';

const LOSS_KINDS = new Set(['자연사', '안락사']);

/** '종료(반환)' → '반환'. 괄호 안 라벨만 뽑는다. 형식이 어긋나면 '종료'. */
export function endOutcomeLabel(state: string): string {
  return /^종료\(([^)]+)\)/.exec(state)?.[1] ?? '종료';
}

export function endOutcome(state: string): EndOutcome {
  return LOSS_KINDS.has(endOutcomeLabel(state)) ? 'loss' : 'life';
}

/**
 * 죽음(자연사·안락사)으로 종료된 개체인가.
 *
 * 사진 회색 처리 판정에 쓴다. 회색은 '종료'가 아니라 '죽음'의 신호다 —
 * 반환·입양처럼 잘된 결과까지 회색으로 만들면 슬픈 일처럼 보인다.
 * 판정을 새로 짜지 않고 endOutcome 을 그대로 재사용해, 문구·배지·회색이 늘 같은
 * 화이트리스트를 본다. 정부가 새 종료 코드를 추가해도 죽음으로 단정하지 않고 컬러로 남는다.
 */
export function isLoss(state: string): boolean {
  return isEnded(state) && endOutcome(state) === 'loss';
}

/**
 * ISO 인스턴트(예: 업스트림 수집 시각 `fetchedAt`) → **KST** '8월 31일'.
 *
 * 왜 KST 로 변환하나: `fetchedAt` 은 UTC 인스턴트라 KST 자정 근처면 날짜가 하루 어긋난다.
 * 날짜 계산을 새로 짜지 않고 `kst.ts` 의 검증된 헬퍼로만 KST 달력 날짜를 뽑는다 —
 * 이 파일들이 존재하는 이유가 하루 밀림 결함이었다.
 */
export function formatKstMonthDay(isoInstant: string | undefined): string | null {
  const ms = Date.parse(isoInstant ?? '');
  if (Number.isNaN(ms)) return null;
  const ymd = dayToYmd(kstToday(ms));
  return `${Number(ymd.slice(4, 6))}월 ${Number(ymd.slice(6, 8))}일`;
}

const SEX: Record<string, Animal['sex']> = { M: '수컷', F: '암컷' };
const NEUTER: Record<string, Animal['neutered']> = { Y: '예', N: '아니오' };

/**
 * 사진 URL 을 프록시 경로로 바꾼다.
 *
 * 원본이 http:// 라 https 페이지에서 직접 쓰면 브라우저가 차단한다.
 * content-type 도 application/octet-stream 이라 그대로는 이미지로 안 읽힌다.
 */
function toProxy(url: string | undefined): string | null {
  if (!url) return null;
  if (!/^https?:\/\/openapi\.animal\.go\.kr\//i.test(url)) return null;
  return `/api/photo?u=${encodeURIComponent(url)}`;
}

/**
 * `nowMs` 를 인자로 받는 이유: `daysLeft` 가 시각에 의존하는 유일한 값이라
 * 이걸 주입할 수 없으면 날짜 경계를 테스트할 방법이 없다. 이 결함이 프로덕션까지
 * 나간 것도 그래서였다.
 */
export function normalizeAnimal(raw: RawAnimal, nowMs: number = Date.now()): Animal {
  const photos = [raw.popfile1, raw.popfile2]
    .map(toProxy)
    .filter((url): url is string => url !== null);

  return {
    id: raw.desertionNo,
    species: raw.upKindNm?.trim() || '미상',
    breed: (raw.kindNm || raw.kindFullNm || '').replace(/^\[[^\]]*\]\s*/, '').trim() || '미상',
    sex: SEX[raw.sexCd ?? ''] ?? '미상',
    neutered: NEUTER[raw.neuterYn ?? ''] ?? '미상',
    age: raw.age?.trim() || '미상',
    weight: raw.weight?.trim() || '미상',
    color: raw.colorCd?.trim() || '미상',
    note: raw.specialMark?.trim() || '',
    photo: photos[0] ?? null,
    photos,
    foundAt: raw.happenDt ?? '',
    foundPlace: raw.happenPlace?.trim() || '',
    noticeFrom: raw.noticeSdt ?? '',
    noticeTo: raw.noticeEdt ?? '',
    daysLeft: daysUntilKst(raw.noticeEdt, nowMs),
    state: raw.processState?.trim() || '미상',
    shelter: {
      name: raw.careNm?.trim() || '',
      tel: raw.careTel?.trim() || '',
      address: raw.careAddr?.trim() || '',
      regNo: raw.careRegNo?.trim() || '',
      org: raw.orgNm?.trim() || '',
    },
    updatedAt: raw.updTm ?? '',
  };
}

/** 축종 대분류 코드. sido 와 달리 API 가 목록을 안 주므로 상수로 둔다. */
export const SPECIES_OPTIONS = [
  { code: '', label: '전체' },
  { code: '417000', label: '개' },
  { code: '422400', label: '고양이' },
  { code: '429900', label: '기타' },
] as const;

export const STATE_OPTIONS = [
  { code: '', label: '전체' },
  { code: 'notice', label: '공고중' },
  { code: 'protect', label: '보호중' },
  { code: 'return', label: '종료' },
] as const;
