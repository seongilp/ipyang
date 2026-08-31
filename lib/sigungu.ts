/**
 * 보호소 주소(careAddr) → 시군구 행정구역 코드.
 *
 * 지도를 개별 보호소 좌표가 아니라 **시군구 경계 폴리곤**에 얹기로 했으므로(choropleth),
 * 지오코딩 없이 주소 앞부분(시도·시군구)만 파싱하면 된다. 부정확한 좌표 변환 단계가
 * 통째로 사라진다.
 *
 * 코드 체계는 번들된 경계 데이터(`public/sgg.geojson`, southkorea-maps 2013 시군구)에 맞춘다.
 * 코드는 `<시도2자리>_<시군구명>` 형태다(예: `31_성남시`). geojson 의 `code` 프로퍼티와
 * 글자 단위로 같아야 조인된다.
 *
 * 실측(2026-08-31, 6,835건): 주소 파싱 100%, 시군구 폴리곤 조인 100%.
 * 아래 정규화 규칙이 그 100% 를 만든다 — 규칙을 지우면 조인율이 떨어진다.
 */

/** 시도명 → 경계 코드 2자리 접두어(2013 KOSTAT). geojson 코드의 앞 두 자리와 일치한다. */
const SIDO_PREFIX: Record<string, string> = {
  서울특별시: '11',
  부산광역시: '21',
  대구광역시: '22',
  인천광역시: '23',
  광주광역시: '24',
  대전광역시: '25',
  울산광역시: '26',
  세종특별자치시: '29',
  경기도: '31',
  // 강원·전북은 특별자치도로 개명됐다. 업스트림에 옛 이름과 새 이름이 섞여 온다(실측).
  강원도: '32',
  강원특별자치도: '32',
  충청북도: '33',
  충청남도: '34',
  전라북도: '35',
  전북특별자치도: '35',
  전라남도: '36',
  경상북도: '37',
  경상남도: '38',
  제주특별자치도: '39',
};

/** 접두어 → 시도 표준명. 화면 표기·툴팁에 쓴다. */
export const SIDO_BY_PREFIX: Record<string, string> = {
  '11': '서울',
  '21': '부산',
  '22': '대구',
  '23': '인천',
  '24': '광주',
  '25': '대전',
  '26': '울산',
  '29': '세종',
  '31': '경기',
  '32': '강원',
  '33': '충북',
  '34': '충남',
  '35': '전북',
  '36': '전남',
  '37': '경북',
  '38': '경남',
  '39': '제주',
};

/**
 * 시군구명 재매핑. 최근 신설·개편돼 2013 경계에 없는 이름을 같은 자리의 옛 시군구로 보낸다.
 *  - 인천 제물포구(2024 신설, 옛 중구+동구) → 중구
 *  - 인천 검단구(2024 신설, 옛 서구 일부)   → 서구
 * 근사지만 물리적으로 같은 지역이라 지도상 위치가 맞다. 소수 건이라 영향도 작다.
 */
const SGG_REMAP: Record<string, string> = {
  제물포구: '중구',
  검단구: '서구',
};

export interface Region {
  /** `<시도2자리>_<시군구명>`. geojson `code` 와 동일. */
  code: string;
  /** 시군구명(예: 성남시). */
  name: string;
  /** 시도 표준 약칭(예: 경기). */
  sido: string;
}

const SIDO_END = /(특별자치시|특별자치도|특별시|광역시|자치도|도)$/;

function make(prefix: string, name: string): Region {
  return { code: `${prefix}_${name}`, name, sido: SIDO_BY_PREFIX[prefix] ?? prefix };
}

/**
 * 주소 문자열에서 시군구를 뽑는다. 실패하면 null(호출부가 '지역 미상'으로 센다).
 *
 * 예외 처리:
 *  - 세종특별자치시: 시군구가 없다. 시도 자체가 한 단위다(경계 이름 '세종시').
 *  - '전남광주통합특별시': 업스트림 오표기다. 광주와 전남 시군이 뒤섞여 이 이름으로 온다.
 *    자치'구'는 광주(24)뿐이고 '시/군'은 전남(36)뿐이라, 접미어로 결정론적으로 가른다.
 *  - 대구 군위군: 2023 경북→대구로 이관됐지만 2013 경계에선 경북(37)에 있다. 그리로 보낸다.
 */
export function resolveRegion(address: string | undefined): Region | null {
  const tokens = (address ?? '').trim().split(/\s+/);
  const sido = tokens[0] ?? '';
  if (!sido) return null;

  // 세종: 시군구 토큰이 없어도 성립한다.
  if (sido.startsWith('세종')) return make('29', '세종시');

  const sgg = tokens[1] ?? '';
  if (!/(시|군|구)$/.test(sgg)) return null;

  // 업스트림 오표기: 전남·광주 혼합. 구=광주, 시/군=전남.
  if (sido === '전남광주통합특별시') {
    return sgg.endsWith('구') ? make('24', sgg) : make('36', SGG_REMAP[sgg] ?? sgg);
  }

  // 대구로 이관된 군위군은 옛 경계(경북)에 있다.
  if (sido === '대구광역시' && sgg === '군위군') return make('37', '군위군');

  if (!SIDO_END.test(sido)) return null;
  const prefix = SIDO_PREFIX[sido];
  if (!prefix) return null;

  return make(prefix, SGG_REMAP[sgg] ?? sgg);
}
