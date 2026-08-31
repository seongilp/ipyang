import { endOutcome, endOutcomeLabel, formatKstMonthDay } from '@/lib/animal';

/**
 * 종료(`state=return`) 목록 위에 붙는 요약 배너.
 *
 * 왜 이 화면에만 있고, 왜 문구를 결과별로 가르나:
 * '종료' 한 덩어리 안에 성격이 완전히 다른 결과가 섞여 있다(실측 2,126건).
 *   반환 709 · 입양 502 · 기증 75 · 방사 44  → 살아서 나갔다 (62.6%)
 *   자연사 710 · 안락사 86                    → 죽었다 (37.4%)
 * "떠나갔습니다" 한 문장으로 뭉치면 가족 품으로 돌아간 절반을 죽은 것처럼 말하게 된다.
 * 그래서 삶과 죽음을 갈라 각각의 수치로 담담하게 적는다.
 *
 * 날짜는 **수집 시각(fetchedAt) 기준일**이다. 이 목록은 하루치가 아니라 최근 한 달에 걸쳐
 * 종료된 개체가 굴러 들어오는 창이라(실측: updatedAt 이 7/31~8/31 에 분포), 특정 하루에
 * "N마리가 떠났다"고 말하면 거짓이 된다. 그래서 '기준'·'최근'으로 스냅샷 시점임을 밝힌다.
 */
export function ReturnSummary({
  breakdown,
  fetchedAt,
}: {
  breakdown: Record<string, number>;
  fetchedAt: string | undefined;
}) {
  const entries = Object.entries(breakdown).filter(([state]) => state.startsWith('종료'));
  if (entries.length === 0) return null;

  const life = entries.filter(([state]) => endOutcome(state) === 'life');
  const loss = entries.filter(([state]) => endOutcome(state) === 'loss');
  const sum = (rows: [string, number][]) => rows.reduce((acc, [, n]) => acc + n, 0);
  const lifeCount = sum(life);
  const lossCount = sum(loss);
  const total = lifeCount + lossCount;

  const asOf = formatKstMonthDay(fetchedAt);

  // 있는 그룹만 문장에 넣는다. 없는 결과를 미리 만들지 않는다.
  const clauses: string[] = [];
  if (lifeCount > 0) {
    clauses.push(`${lifeCount.toLocaleString()}마리는 가족을 만나거나 자연으로 돌아갔고`);
  }
  if (lossCount > 0) {
    clauses.push(`${lossCount.toLocaleString()}마리는 무지개다리를 건넜습니다`);
  }
  // 마지막 절만 종결어미로 끝나므로, 삶만 있을 때도 문장이 어색하지 않게 맞춘다.
  const sentence =
    clauses.length === 0
      ? ''
      : clauses.length === 1 && lossCount === 0
        ? `${lifeCount.toLocaleString()}마리가 가족을 만나거나 자연으로 돌아갔습니다.`
        : `${clauses.join(', ')}.`;

  return (
    <section className="border-border bg-card/60 mb-4 rounded-lg border p-4">
      <p className="text-muted-foreground text-xs">
        {asOf ? `${asOf} 기준` : '집계 기준'} · 최근 종료된{' '}
        <strong className="text-foreground">{total.toLocaleString()}마리</strong>
      </p>
      <p className="text-foreground mt-1 text-sm leading-relaxed">{sentence}</p>

      <div className="mt-3 space-y-2">
        {life.length > 0 && <OutcomeRow tone="life" label="삶으로" rows={life} subtotal={lifeCount} />}
        {loss.length > 0 && (
          <OutcomeRow tone="loss" label="무지개다리" rows={loss} subtotal={lossCount} />
        )}
      </div>
    </section>
  );
}

/**
 * 결과 그룹 한 줄. 색점 + 그룹명 + 소계, 아래에 하위 유형별 정확한 수치.
 * 텍스트로만 수치를 밝히므로 대비는 본문 색을 그대로 쓴다(사진 위가 아니다).
 */
function OutcomeRow({
  tone,
  label,
  rows,
  subtotal,
}: {
  tone: 'life' | 'loss';
  label: string;
  rows: [string, number][];
  subtotal: number;
}) {
  // 큰 순서대로. 같은 그룹 안에서도 어떤 결과가 많은지 한눈에 보이게.
  const sorted = [...rows].sort((a, b) => b[1] - a[1]);
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs">
      <span className="flex items-center gap-1.5 font-medium">
        <span
          aria-hidden
          className={tone === 'life' ? 'size-2 rounded-full bg-emerald-500' : 'size-2 rounded-full bg-neutral-400'}
        />
        {label}
        <span className="text-muted-foreground">{subtotal.toLocaleString()}</span>
      </span>
      <span className="text-muted-foreground">
        {sorted.map(([state, n]) => `${endOutcomeLabel(state)} ${n.toLocaleString()}`).join(' · ')}
      </span>
    </div>
  );
}
