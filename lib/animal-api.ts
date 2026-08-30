/**
 * 국가동물보호정보시스템 구조동물 API 클라이언트. 서버 전용.
 *
 * data.go.kr 15098931(구조동물) / 15098915(동물보호센터).
 *
 * 함정 정리 — 전부 실측으로 확인한 것들이다.
 *  - serviceKey 는 Encoding 키라 %2F 등이 이미 들어 있다. 다시 인코딩하면
 *    SERVICE_KEY_IS_NOT_REGISTERED_ERROR 가 난다. 그래서 쿼리스트링을 직접 조립한다.
 *  - 사진 URL 이 http:// 다. https 페이지에서 직접 쓰면 mixed content 로 차단된다.
 *    content-type 도 application/octet-stream 이라 브라우저가 이미지로 안 볼 수 있다.
 *    app/api/photo 로 프록시한다.
 *  - 상위코드 없이 sigungu/shelter 를 부르면 에러 없이 0건이 온다.
 */

const BASE = 'https://apis.data.go.kr/1543061';
const ABANDONMENT = `${BASE}/abandonmentPublicService_v2/abandonmentPublic_v2`;
const SIDO = `${BASE}/abandonmentPublicService_v2/sido_v2`;
const SHELTER_INFO = `${BASE}/animalShelterSrvc_v2/shelterInfo_v2`;

/** 응답 1,000건이 약 1.2MB. 이보다 키우면 전송이 무거워진다. */
export const MAX_ROWS = 1_000;

export class AnimalApiFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 502,
  ) {
    super(message);
    this.name = 'AnimalApiFailure';
  }
}

function serviceKey(): string {
  const key = process.env.DATA_GO_KR_KEY?.trim();
  if (!key) throw new AnimalApiFailure('NO_KEY', 'DATA_GO_KR_KEY 가 설정되지 않았습니다.', 500);
  return key;
}

export type QueryParams = Record<string, string | number | undefined>;

function buildUrl(endpoint: string, params: QueryParams): string {
  const key = serviceKey();
  // Encoding 키는 그대로, Decoding 키만 한 번 인코딩한다.
  const parts = [`serviceKey=${key.includes('%') ? key : encodeURIComponent(key)}`, '_type=json'];
  for (const [name, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue;
    parts.push(`${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`);
  }
  return `${endpoint}?${parts.join('&')}`;
}

interface StandardResponse<T> {
  response?: {
    header?: { resultCode?: string; resultMsg?: string };
    body?: { totalCount?: number; items?: { item?: T[] } | T[] | '' };
  };
  OpenAPI_ServiceResponse?: { cmmMsgHeader?: { errMsg?: string; returnAuthMsg?: string } };
}

async function call<T>(
  endpoint: string,
  params: QueryParams,
  revalidate: number,
): Promise<{ items: T[]; totalCount: number }> {
  const response = await fetch(buildUrl(endpoint, params), {
    next: { revalidate },
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });

  const text = await response.text();
  let parsed: StandardResponse<T>;
  try {
    parsed = JSON.parse(text) as StandardResponse<T>;
  } catch {
    // 인증 오류는 JSON 을 요청해도 XML 로 떨어진다.
    const code = /<(?:errMsg|returnAuthMsg)>([^<]*)</.exec(text)?.[1] ?? 'NON_JSON';
    throw new AnimalApiFailure(code, `응답을 해석할 수 없습니다: ${text.slice(0, 160)}`);
  }

  const cmm = parsed.OpenAPI_ServiceResponse?.cmmMsgHeader;
  if (cmm?.errMsg) {
    throw new AnimalApiFailure(cmm.errMsg, cmm.returnAuthMsg ?? cmm.errMsg);
  }

  const header = parsed.response?.header;
  if (header?.resultCode && header.resultCode !== '00') {
    throw new AnimalApiFailure(header.resultCode, header.resultMsg ?? '조회 실패');
  }

  const body = parsed.response?.body;
  const raw = body?.items;
  // 결과가 없으면 items 가 빈 문자열로 온다. 1건이면 배열이 아니라 객체다.
  const container = raw && typeof raw === 'object' && 'item' in raw ? raw.item : raw;
  const items = Array.isArray(container) ? container : container ? [container as T] : [];

  return { items, totalCount: Number(body?.totalCount) || items.length };
}

/* ------------------------------------------------------------------ */

export interface RawAnimal {
  desertionNo: string;
  happenDt: string;
  happenPlace: string;
  kindFullNm?: string;
  upKindNm?: string;
  kindNm?: string;
  colorCd?: string;
  age?: string;
  weight?: string;
  noticeNo?: string;
  noticeSdt: string;
  noticeEdt: string;
  popfile1?: string;
  popfile2?: string;
  processState?: string;
  sexCd?: string;
  neuterYn?: string;
  specialMark?: string;
  careRegNo?: string;
  careNm?: string;
  careTel?: string;
  careAddr?: string;
  orgNm?: string;
  updTm?: string;
}

export interface AnimalQuery {
  page?: number;
  rows?: number;
  /** 축종 대분류 코드. 417000=개, 422400=고양이, 429900=기타 */
  upkind?: string;
  /** 시도 코드 (sido_v2 의 orgCd) */
  uprCd?: string;
  /** protect=보호중, notice=공고중, return=종료 */
  state?: string;
  /** YYYYMMDD */
  bgnde?: string;
  endde?: string;
}

/** 구조동물 목록. 공고는 매일 바뀌므로 30분 캐시. */
export function fetchAnimals(query: AnimalQuery = {}) {
  return call<RawAnimal>(
    ABANDONMENT,
    {
      pageNo: query.page ?? 1,
      numOfRows: Math.min(query.rows ?? 60, MAX_ROWS),
      upkind: query.upkind,
      upr_cd: query.uprCd,
      state: query.state,
      bgnde: query.bgnde,
      endde: query.endde,
    },
    1_800,
  );
}

export interface RawSido {
  orgCd: string;
  orgdownNm: string;
}

/** 시도 목록. 바뀌지 않으므로 하루 캐시. */
export function fetchSido() {
  return call<RawSido>(SIDO, { pageNo: 1, numOfRows: 50 }, 86_400);
}

export interface RawShelter {
  careNm: string;
  careRegNo: string;
  orgNm?: string;
  careAddr?: string;
  lat?: string;
  lng?: string;
  careTel?: string;
  weekOprStime?: string;
  weekOprEtime?: string;
  closeDay?: string;
  saveTrgtAnimal?: string;
  dataStdDt?: string;
}

/** 동물보호센터. 335곳, 좌표 보유율 99.7%(실측). 하루 캐시. */
export function fetchShelters(page = 1, rows = 100) {
  return call<RawShelter>(SHELTER_INFO, { pageNo: page, numOfRows: rows }, 86_400);
}
