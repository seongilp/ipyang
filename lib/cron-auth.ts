/**
 * 크론 라우트 인증.
 *
 * 이 라우트들은 Discord 로 메시지를 보내고 외부 API 를 전수 호출한다.
 * 공개돼 있으면 누구나 우리 채널에 도배하고 API 할당량을 태울 수 있다.
 *
 * Vercel Cron 은 요청에 `Authorization: Bearer $CRON_SECRET` 을 붙여 준다.
 * CRON_SECRET 이 설정돼 있지 않으면 **거부**한다 — 실수로 열어두는 쪽보다 낫다.
 */
export function assertCron(request: Request): Response | null {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return new Response('CRON_SECRET 이 설정되지 않았습니다.', { status: 503 });
  }

  const header = request.headers.get('authorization');
  if (header !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  return null;
}

/**
 * 절대 URL. Discord 가 썸네일을 가져가려면 상대경로로는 안 된다.
 *
 * `NEXT_PUBLIC_` 접두사를 쓰지 않는다. 이 값은 크론 라우트(서버)에서만 쓰는데
 * 접두사를 붙이면 클라이언트 번들에 그대로 박히고, Vercel 도 그 접두사에는
 * sensitive 설정을 거부한다.
 *
 * 폴백인 `VERCEL_PROJECT_PRODUCTION_URL` 은 Vercel 이 자동 배정한 프로덕션
 * 도메인이라 실제로 쓰는 별칭(ipyang.vercel.app)과 다를 수 있다. 그래서
 * `SITE_URL` 을 명시하는 쪽이 정답이고, 폴백은 어디까지나 최후의 수단이다.
 */
export function siteUrl(): string {
  const explicit = process.env.SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, '');
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  return vercel ? `https://${vercel}` : 'https://ipyang.vercel.app';
}

/**
 * 이 요청을 **누가** 발생시켰는지. 자동 발화 / 수동 호출을 구분한다.
 *
 * 왜 필요한가: Hobby 의 런타임 로그 보존은 1시간이라, 크론이 새벽이나 저녁에 돌면
 * 사람이 확인할 때쯤엔 로그가 이미 사라진다. 그러면 "정말 발화했는가"를
 * 사후에 확인할 방법이 없다 — 수동 호출로는 자동 발화를 증명할 수 없기 때문이다.
 *
 * Vercel 은 크론이 부른 요청에만 `x-vercel-cron-schedule` 헤더(발화시킨 크론
 * 표현식 그대로)와 `vercel-cron/1.0` User-Agent 를 붙인다. 이 값을 응답 본문과
 * Discord 메시지에 함께 남기면, 로그가 만료된 뒤에도 **메시지 자체가 발화 기록**이
 * 된다. 외부 저장소를 새로 붙이지 않아도 되고, 인스턴스별로 흩어지는 메모리와 달리
 * 신뢰할 수 있다.
 */
export type CronTrigger = {
  /** 크론이 부른 요청이면 true */
  readonly automatic: boolean;
  /** 발화시킨 크론 표현식. 수동 호출이면 null */
  readonly schedule: string | null;
};

export function cronTrigger(request: Request): CronTrigger {
  const schedule = request.headers.get('x-vercel-cron-schedule');
  const isVercelCron = request.headers.get('user-agent')?.startsWith('vercel-cron/') ?? false;

  return {
    automatic: isVercelCron || schedule !== null,
    schedule: schedule?.trim() || null,
  };
}

/** Discord 푸터 등에 넣을 한 줄 표기. */
export function describeTrigger(trigger: CronTrigger): string {
  if (!trigger.automatic) return '수동 호출';
  return trigger.schedule ? `자동 발화 (${trigger.schedule} UTC)` : '자동 발화';
}
