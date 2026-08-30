import type { RawAnimal } from './animal-api';

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

/** `20260909` → Date (KST 자정 기준). 형식이 다르면 null. */
function parseYmd(value: string | undefined): Date | null {
  if (!value || !/^\d{8}$/.test(value)) return null;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day) - 9 * 60 * 60 * 1000);
  return Number.isNaN(date.getTime()) ? null : date;
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

function daysUntil(target: Date | null): number | null {
  if (!target) return null;
  const nowKst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const today = Date.UTC(nowKst.getUTCFullYear(), nowKst.getUTCMonth(), nowKst.getUTCDate());
  const end = Date.UTC(
    target.getUTCFullYear(),
    target.getUTCMonth(),
    target.getUTCDate(),
  );
  return Math.round((end - today) / 86_400_000);
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

export function normalizeAnimal(raw: RawAnimal): Animal {
  const noticeTo = parseYmd(raw.noticeEdt);
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
    daysLeft: daysUntil(noticeTo),
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
