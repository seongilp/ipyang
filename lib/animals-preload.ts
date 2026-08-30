/**
 * 기본 화면의 목록 요청을 HTML 파싱 시점에 미리 띄우기 위한 약속.
 *
 * `app/layout.tsx` 의 인라인 스크립트가 이 URL 로 요청을 걸어 두고,
 * `components/animal-browser.tsx` 가 같은 URL 일 때만 그 Promise 를 가져다 쓴다.
 *
 * URL 을 여기 한 곳에만 두는 이유: 양쪽이 만드는 쿼리 문자열이 **한 글자라도** 다르면
 * 미리 받아 둔 응답이 그냥 버려지고, 그런데도 화면은 멀쩡히 뜨기 때문에 아무도 눈치채지
 * 못한다. 조용히 무효가 되는 최적화라 문자열을 복사해 두면 안 된다.
 */
export const ANIMALS_PRELOAD_URL = '/api/animals?page=1&state=notice';

/** 미리 받아 둔 응답. 실패했으면 `promise` 가 null 로 풀린다. */
export interface AnimalsPreload {
  url: string;
  promise: Promise<unknown>;
}

declare global {
  interface Window {
    __animalsPreload?: AnimalsPreload;
  }
}

/**
 * 미리 받아 둔 응답을 **한 번만** 꺼낸다.
 *
 * 한 번 쓰고 지우는 이유: 이건 첫 화면 한 번을 앞당기는 장치다. 남겨 두면 사용자가 필터를
 * 옮겼다가 기본 화면으로 되돌아왔을 때 그때는 이미 낡았을 수 있는 응답을 다시 쓰게 된다.
 */
export function takeAnimalsPreload(url: string): Promise<unknown> | null {
  if (typeof window === 'undefined') return null;
  const preload = window.__animalsPreload;
  if (!preload || preload.url !== url) return null;
  delete window.__animalsPreload;
  return preload.promise;
}
