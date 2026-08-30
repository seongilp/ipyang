import { runSummaryCron } from '@/lib/summary-cron';

/** 매일 18시(KST) 현황 요약. 동작은 아침 라우트와 같고 스케줄만 다르다. */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  return runSummaryCron(request);
}
