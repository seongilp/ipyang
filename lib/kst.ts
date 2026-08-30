/**
 * KST 달력 날짜 계산.
 *
 * 왜 따로 두는가: 이 앱의 핵심 값인 `daysLeft` 가 **인스턴트(시각)와 달력 날짜를
 * 섞어 쓰다가** 항상 하루 적게 나오는 결함이 있었다. 공고 종료일을 "KST 자정에
 * 해당하는 UTC 인스턴트"(=전날 15:00Z)로 바꿔 놓고, 거기서 다시 **UTC 달력 날짜**를
 * 뽑았기 때문이다. 오늘 쪽은 +9h 보정 후 UTC 날짜를 뽑아 KST 날짜가 제대로 나왔으니
 * 두 항의 기준이 달랐다.
 *
 * 그래서 여기서는 Date 객체(인스턴트)를 아예 만들지 않는다. 양쪽 모두
 * **KST 달력 날짜 → 에폭 일수(정수)** 로 바꾼 뒤 정수끼리 뺀다. 기준이 하나뿐이라
 * 한쪽만 고쳐서 다시 어긋날 여지가 없다.
 */

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;

/** 지금이 KST 로 며칠인지, 1970-01-01 을 0 으로 세는 정수. */
export function kstToday(nowMs: number = Date.now()): number {
  return Math.floor((nowMs + KST_OFFSET_MS) / DAY_MS);
}

/**
 * `20260831` → 에폭 일수. 형식이 어긋나거나 존재하지 않는 날짜면 null.
 *
 * 자릿수만 보고 넘기면 `20260231` 같은 값이 3월 3일로 조용히 굴러간다.
 * 되돌려 비교해서 실제로 있는 날짜인지 확인한다.
 */
export function ymdToDay(value: string | undefined): number | null {
  if (!value || !/^\d{8}$/.test(value)) return null;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const ms = Date.UTC(year, month - 1, day);
  if (Number.isNaN(ms)) return null;
  const back = new Date(ms);
  if (
    back.getUTCFullYear() !== year ||
    back.getUTCMonth() !== month - 1 ||
    back.getUTCDate() !== day
  ) {
    return null;
  }
  return ms / DAY_MS;
}

/** 에폭 일수 → `20260831`. */
export function dayToYmd(day: number): string {
  const date = new Date(day * DAY_MS);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`;
}

/** KST 기준 오늘 `YYYYMMDD`. 서버가 UTC 로 도므로 직접 보정한다. */
export function todayYmdKst(nowMs: number = Date.now()): string {
  return dayToYmd(kstToday(nowMs));
}

/**
 * 다음 KST 자정까지 남은 밀리초. 자정 정각이면 꼬박 하루(86,400,000).
 *
 * 왜 여기 있나: 캐시 수명을 정할 때 쓴다. `daysLeft` 는 수집 시점의 KST '오늘'을
 * 기준으로 계산돼 응답에 박혀 있으므로, **자정을 넘겨 재사용된 캐시는 전부 하루씩
 * 틀린다**. 캐시 수명을 이 값으로 잘라 두면 그 일이 구조적으로 불가능해진다.
 *
 * 이 파일에 두는 이유는 KST 오프셋을 두 군데서 계산하지 않기 위해서다 — 기준이
 * 갈렸다가 하루 밀림 결함이 났던 게 이 파일이 존재하는 이유 그 자체다.
 */
export function msUntilKstMidnight(nowMs: number = Date.now()): number {
  return (kstToday(nowMs) + 1) * DAY_MS - KST_OFFSET_MS - nowMs;
}

/**
 * 공고 종료일까지 남은 일수. 오늘 마감이면 0, 어제 마감이면 -1.
 *
 * 둘 다 KST 달력 날짜의 에폭 일수라 뺄셈만으로 끝난다.
 */
export function daysUntilKst(ymd: string | undefined, nowMs: number = Date.now()): number | null {
  const target = ymdToDay(ymd);
  if (target === null) return null;
  return target - kstToday(nowMs);
}
