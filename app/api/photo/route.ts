import { NextResponse } from 'next/server';

/**
 * 구조동물 사진 프록시.
 *
 * 원본이 `http://openapi.animal.go.kr/...` 라 세 가지 문제가 한꺼번에 있다.
 *  1. https 페이지에서 http 이미지는 mixed content 로 차단된다.
 *  2. content-type 이 application/octet-stream 이라 브라우저가 이미지로 안 읽는다.
 *  3. 정부 서버 직접 핫링크는 피해야 한다 — 카드 그리드는 스크롤당 수십 장이다.
 *
 * 프록시하면서 content-type 을 바로잡고 오래 캐시한다. 공고 사진은 바뀌지 않는다.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 20;

/** 이 호스트 외에는 프록시하지 않는다. 열린 프록시가 되면 안 된다. */
const ALLOWED_HOST = 'openapi.animal.go.kr';

/** 1x1 투명 GIF. 원본이 실패했을 때 깨진 이미지 대신 돌려준다. */
const TRANSPARENT_PIXEL = Uint8Array.from(
  atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'),
  (c) => c.charCodeAt(0),
);

export async function GET(request: Request): Promise<NextResponse> {
  const target = new URL(request.url).searchParams.get('u');
  if (!target) {
    return NextResponse.json({ error: 'u 파라미터가 필요합니다.' }, { status: 400 });
  }

  let source: URL;
  try {
    source = new URL(target);
  } catch {
    return NextResponse.json({ error: '잘못된 URL 입니다.' }, { status: 400 });
  }

  if (source.hostname !== ALLOWED_HOST) {
    return NextResponse.json({ error: '허용되지 않은 호스트입니다.' }, { status: 403 });
  }

  /*
   * 원본 서버가 간헐적으로 실패한다 — 한 화면 44장 중 2장이 502 로 떨어졌다(실측).
   * 개별 요청을 따로 치면 12장 모두, 동시 20장도 모두 성공하므로 부하 문제가 아니라
   * 서버 쪽 산발적 오류로 보인다. 그래서 짧게 한 번 재시도한다.
   */
  const attempt = async (): Promise<Response> =>
    fetch(source, {
      // 원본 사진은 바뀌지 않으므로 오래 잡아 둔다.
      next: { revalidate: 604_800 },
      signal: AbortSignal.timeout(15_000),
    });

  try {
    let upstream = await attempt().catch(() => null);
    if (!upstream?.ok) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      upstream = await attempt().catch(() => null);
    }

    if (!upstream?.ok) {
      // 실패해도 카드 레이아웃이 깨지지 않도록 투명 1x1 을 돌려준다.
      // 502 를 그대로 주면 브라우저 콘솔이 에러로 뒤덮이고 깨진 이미지 아이콘이 뜬다.
      return new NextResponse(TRANSPARENT_PIXEL, {
        headers: {
          'Content-Type': 'image/gif',
          // 실패는 짧게만 캐시한다. 다음에 성공할 수 있다.
          'Cache-Control': 'public, max-age=60',
        },
      });
    }

    const buffer = await upstream.arrayBuffer();

    // 원본이 octet-stream 을 주므로 매직 넘버로 형식을 판별한다.
    const bytes = new Uint8Array(buffer.slice(0, 4));
    const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
    const contentType = isPng ? 'image/png' : 'image/jpeg';

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=604800, s-maxage=2592000, immutable',
      },
    });
  } catch {
    return new NextResponse(TRANSPARENT_PIXEL, {
      headers: { 'Content-Type': 'image/gif', 'Cache-Control': 'public, max-age=60' },
    });
  }
}
