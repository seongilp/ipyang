import type { Metadata } from 'next';
import { Noto_Sans_KR } from 'next/font/google';

import { ANIMALS_PRELOAD_URL } from '@/lib/animals-preload';

import './globals.css';

const notoSansKr = Noto_Sans_KR({
  variable: '--font-sans',
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: '입양나우 — 전국 유기동물 공고',
  applicationName: '입양나우',
  description:
    '전국 동물보호센터의 구조동물 공고를 공고 마감이 임박한 순으로 봅니다. 국가동물보호정보시스템 공공데이터 기반.',
  openGraph: {
    siteName: '입양나우',
    title: '입양나우 — 전국 유기동물 공고',
    description:
      '전국 동물보호센터의 구조동물 공고를 공고 마감이 임박한 순으로 봅니다. 국가동물보호정보시스템 공공데이터 기반.',
    locale: 'ko_KR',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: '입양나우 — 전국 유기동물 공고',
    description:
      '전국 동물보호센터의 구조동물 공고를 공고 마감이 임박한 순으로 봅니다. 국가동물보호정보시스템 공공데이터 기반.',
  },
  appleWebApp: { title: '입양나우' },
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="ko" className={`dark ${notoSansKr.variable} antialiased`} suppressHydrationWarning>
      <head>
        {/*
         * 목록 요청을 HTML 파싱 시점에 띄운다. 이 앱에서 가장 큰 체감 지연이 여기 있었다.
         *
         * 문제: 목록은 클라이언트 컴포넌트의 effect 에서 받는데, 그 effect 는 JS 157KB(압축)를
         * 내려받아 파싱하고 하이드레이션이 끝나야 비로소 돈다. 유선에서도 요청 **시작**이
         * t=110ms 였고(실측), 대역폭이 좁은 모바일에서는 이 구간이 훨씬 길어진다.
         * 사용자가 본 "셸은 떴는데 스켈레톤만" 이 정확히 이 구간이다 — 서버가 느린 게 아니라
         * 요청이 아직 시작도 안 한 상태다.
         *
         * `<link rel="preload" as="fetch">` 를 먼저 시도했다가 버렸다. Chrome 이 동일 출처
         * as=fetch preload 를 fetch() 와 매칭하지 못해 "credentials mode does not match" 경고를
         * 계속 냈고(crossorigin 유무, credentials/mode 를 omit·cors 로 맞춘 조합까지 전부 실측),
         * 실제 재사용은 preload 캐시가 아니라 브라우저 HTTP 캐시의 휴리스틱에 기대고 있었다.
         * `rel="prefetch"` 는 경고가 없는 대신 우선순위가 Lowest 라, 폰트·JS 와 대역폭을
         * 다투는 바로 그 모바일 상황에서 밀릴 수 있다.
         *
         * 그래서 요청을 그냥 여기서 **직접** 시작하고 그 Promise 를 넘긴다. 캐시 매칭에 기대지
         * 않으므로 재사용이 확정적이고, 일반 fetch 라 우선순위도 높고, 경고도 없다.
         *
         * 기본 화면(공고중·1페이지)만 건다. 필터가 걸린 주소로 들어오면 이 응답은 버려지는데,
         * brotli 로 8.4KB 인 데다 CDN 히트라 손해가 작다. 반대로 기본 화면은 압도적 다수다.
         * 실패는 여기서 삼키고 null 로 떨어뜨린다 — 처리기 없는 rejection 이 콘솔을 더럽히고,
         * 어차피 컴포넌트가 평소 경로로 다시 받으면 된다.
         *
         * 남은 한계: Next 가 이 스크립트를 자기 `<link rel="stylesheet">` **뒤에** 넣는데,
         * 동기 인라인 스크립트는 앞선 스타일시트가 다 올 때까지 실행되지 않는다. 프로덕션
         * 실측에서 CSS 가 305ms 에 끝나고 이 요청이 307ms 에 시작했다. 즉 지금은 CSS 37KB
         * 뒤에 줄을 선다 — 그래도 JS 157KB + 파싱 + 하이드레이션을 기다리던 것보다는 훨씬
         * 앞이다. 더 당기려면 head 안에서 스타일시트보다 앞에 놓아야 하는데 그 순서는 Next 가
         * 정하고, `rel="preload"` 로 preload 스캐너를 태우는 방법은 위에 적은 매칭 문제로
         * 요청이 두 번 나갈 위험이 있어 택하지 않았다.
         */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var u=${JSON.stringify(ANIMALS_PRELOAD_URL)};window.__animalsPreload={url:u,promise:fetch(u).then(function(r){return r.ok?r.json():null}).catch(function(){return null})}})()`,
          }}
        />
      </head>
      <body className="bg-background text-foreground min-h-dvh">{children}</body>
    </html>
  );
}
