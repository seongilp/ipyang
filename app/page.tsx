import { ArrowRight, Clock, Phone, ShieldCheck } from 'lucide-react';
import Link from 'next/link';

/**
 * 랜딩.
 *
 * 이 앱이 무엇을 하는지, 데이터가 어디서 오는지, 그리고 **무엇을 하지 않는지**를 먼저 밝힌다.
 * 유기동물 정보는 오해하면 사람이 헛걸음하고 동물이 기회를 잃는다.
 */
export default function Landing() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-16 sm:py-24">
      <p className="text-primary text-sm font-medium">공공데이터 기반</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
        공고가 끝나기 전에,
        <br />
        먼저 보이도록
      </h1>
      <p className="text-muted-foreground mt-4 leading-relaxed">
        전국 동물보호센터의 구조동물 공고를 <strong className="text-foreground">마감이 임박한
        순서로</strong> 보여줍니다. 공고 기간이 지나면 보호소의 여건에 따라 다음 절차로 넘어갑니다.
      </p>

      <Link
        href="/browse"
        className="bg-primary text-primary-foreground mt-8 inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-medium"
      >
        공고 보러 가기
        <ArrowRight className="size-4" />
      </Link>

      <dl className="mt-12 grid gap-4 sm:grid-cols-3">
        {[
          {
            icon: Clock,
            title: '마감 임박 순',
            body: '조건에 맞는 공고를 전부 받아 남은 날짜로 정렬합니다. 오늘 마감인 아이가 맨 앞에 옵니다.',
          },
          {
            icon: Phone,
            title: '보호소로 직접',
            body: '입양 문의는 이 앱이 받지 않습니다. 각 공고의 보호소 연락처로 바로 연결합니다.',
          },
          {
            icon: ShieldCheck,
            title: '기준 시각 표기',
            body: '지자체 입력과 실제 상황 사이에는 시차가 있습니다. 각 공고의 갱신 시각을 함께 보여줍니다.',
          },
        ].map(({ icon: Icon, title, body }) => (
          <div key={title} className="border-border bg-card/50 rounded-xl border p-4">
            <Icon className="text-primary size-5" aria-hidden />
            <dt className="mt-3 text-sm font-bold">{title}</dt>
            <dd className="text-muted-foreground mt-1 text-xs leading-relaxed">{body}</dd>
          </div>
        ))}
      </dl>

      <section className="text-muted-foreground mt-12 space-y-2 text-xs leading-relaxed">
        <h2 className="text-foreground text-sm font-bold">데이터 출처</h2>
        <p>
          농림축산식품부 농림축산검역본부{' '}
          <a
            className="text-primary hover:underline"
            href="https://www.data.go.kr/data/15098931/openapi.do"
            target="_blank"
            rel="noreferrer"
          >
            국가동물보호정보시스템 구조동물 조회 서비스
          </a>{' '}
          및{' '}
          <a
            className="text-primary hover:underline"
            href="https://www.data.go.kr/data/15098915/openapi.do"
            target="_blank"
            rel="noreferrer"
          >
            동물보호센터 정보 조회서비스
          </a>
          . 공공데이터포털 제공.
        </p>
        <p>
          이 서비스는 참고용입니다. 입양 가능 여부, 절차, 개체의 현재 상태는 반드시 해당 보호소에
          직접 확인하세요. 원본은{' '}
          <a
            className="text-primary hover:underline"
            href="https://www.animal.go.kr/front/index.do"
            target="_blank"
            rel="noreferrer"
          >
            국가동물보호정보시스템
          </a>
          에서 볼 수 있습니다.
        </p>
      </section>
    </main>
  );
}
