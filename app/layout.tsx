import type { Metadata } from 'next';
import { Noto_Sans_KR } from 'next/font/google';

import './globals.css';

const notoSansKr = Noto_Sans_KR({
  variable: '--font-sans',
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: '입양 — 전국 유기동물 공고',
  description:
    '전국 동물보호센터의 구조동물 공고를 공고 마감이 임박한 순으로 봅니다. 국가동물보호정보시스템 공공데이터 기반.',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="ko" className={`dark ${notoSansKr.variable} antialiased`} suppressHydrationWarning>
      <body className="bg-background text-foreground min-h-dvh">{children}</body>
    </html>
  );
}
