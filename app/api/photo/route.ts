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

  try {
    const upstream = await fetch(source, {
      // 원본 사진은 바뀌지 않으므로 오래 잡아 둔다.
      next: { revalidate: 604_800 },
      signal: AbortSignal.timeout(15_000),
    });

    if (!upstream.ok) {
      return NextResponse.json({ error: `원본 응답 ${upstream.status}` }, { status: 502 });
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
    return NextResponse.json({ error: '사진을 가져오지 못했습니다.' }, { status: 502 });
  }
}
