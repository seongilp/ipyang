'use client';

import { formatKstMonthDay } from '@/lib/animal';
import { toGroups, type OutcomeTally } from '@/lib/map-data';
import { cn } from '@/lib/utils';

/**
 * 결과별 인포그래픽. 선택한 지역(또는 전국)의 개체를 **대기 / 삶 / 무지개다리** 세 계층으로
 * 담담하게 보여준다.
 *
 * 분류는 새로 만들지 않는다 — `toGroups`(=displayState·endOutcome)가 목록·배지·회색과 같은
 * 기준으로 나눈다. 자연사·안락사는 둘 다 죽음이지만 **별개 코드라 따로 센다**(자연사가 안락사
 * 보다 8배 많다는 것 자체가 정보다). "무지개다리" 아래에 자연사/안락사를 나눠 적는다.
 *
 * "대기중"은 아직 기다리는 개체(공고중·보호중)에만 붙인다. 종료된 개체는 이미 결과가 났으므로
 * 삶/무지개다리 문구를 쓴다 — 성격이 다른 걸 같은 말로 뭉개지 않는다.
 */

/** 색은 카드 배지와 같은 성격 매핑. 삶=emerald, 죽음=neutral, 대기=토스 블루. 숫자·라벨이 항상 붙는다. */
const GROUP = {
  waiting: { dot: 'bg-primary', bar: 'bg-primary', label: '대기' },
  life: { dot: 'bg-emerald-500', bar: 'bg-emerald-500', label: '삶으로' },
  loss: { dot: 'bg-neutral-400', bar: 'bg-neutral-400', label: '무지개다리' },
} as const;

export function RegionInfographic({
  title,
  tally,
  fetchedAt,
  onClear,
}: {
  /** '전국' 또는 '경기 성남시'. */
  title: string;
  tally: OutcomeTally;
  fetchedAt: string | undefined;
  /** 지역이 선택된 경우 전국으로 되돌리는 버튼. 전국이면 없음. */
  onClear?: () => void;
}) {
  const groups = toGroups(tally);
  const { waitingTotal, lifeTotal, lossTotal, total } = groups;
  const asOf = formatKstMonthDay(fetchedAt);

  if (total === 0) {
    return (
      <section className="border-border bg-card/60 rounded-xl border p-4">
        <Header title={title} total={0} onClear={onClear} />
        <p className="text-muted-foreground mt-2 text-sm">이 조건에 맞는 개체가 없습니다.</p>
      </section>
    );
  }

  // 문구는 '있는 것'으로만 만든다. 종료가 없으면 무지개다리 문장을 아예 안 쓴다.
  const sentence = buildSentence(waitingTotal, lifeTotal, lossTotal, total);

  // 모수를 반드시 밝힌다("전체 N마리 중"). 오늘 이 프로젝트에서 모수를 안 밝혀 생긴 오해를 막는다.
  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);

  return (
    <section className="border-border bg-card/60 rounded-xl border p-4">
      <Header title={title} total={total} onClear={onClear} />

      <p className="text-foreground mt-2 text-sm leading-relaxed">{sentence}</p>

      {/* 비율 막대. 세 그룹의 상대 규모를 한 줄로. 색만이 아니라 아래 라벨·숫자가 값을 말한다. */}
      <div className="mt-3">
        <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-neutral-800">
          {waitingTotal > 0 && (
            <span className={GROUP.waiting.bar} style={{ width: `${(waitingTotal / total) * 100}%` }} />
          )}
          {lifeTotal > 0 && (
            <span className={GROUP.life.bar} style={{ width: `${(lifeTotal / total) * 100}%` }} />
          )}
          {lossTotal > 0 && (
            <span className={GROUP.loss.bar} style={{ width: `${(lossTotal / total) * 100}%` }} />
          )}
        </div>
        <p className="text-muted-foreground mt-1 text-[11px]">전체 {total.toLocaleString()}마리 기준</p>
      </div>

      {/* 계층별 상세. 그룹 헤더(큰 숫자) + 하위 유형(작은 줄)로 8개 항목을 접어 정리한다. */}
      <div className="mt-3 space-y-2.5">
        {waitingTotal > 0 && (
          <GroupBlock
            kind="waiting"
            total={waitingTotal}
            pct={pct(waitingTotal)}
            rows={groups.waiting}
          />
        )}
        {lifeTotal > 0 && (
          <GroupBlock kind="life" total={lifeTotal} pct={pct(lifeTotal)} rows={groups.life} />
        )}
        {lossTotal > 0 && (
          <GroupBlock kind="loss" total={lossTotal} pct={pct(lossTotal)} rows={groups.loss} />
        )}
      </div>

      {asOf && (
        <p className="text-muted-foreground mt-3 text-[11px]">{asOf} 기준 · 지자체 입력 시점과 시차가 있을 수 있습니다.</p>
      )}
    </section>
  );
}

function Header({ title, total, onClear }: { title: string; total: number; onClear?: () => void }) {
  return (
    <div className="flex items-baseline gap-2">
      <h2 className="text-sm font-bold">{title}</h2>
      <span className="text-primary text-lg font-bold">{total.toLocaleString()}</span>
      <span className="text-muted-foreground text-xs">마리</span>
      {onClear && (
        <button
          type="button"
          onClick={onClear}
          className="text-muted-foreground hover:text-foreground ml-auto text-xs underline underline-offset-2"
        >
          전국 보기
        </button>
      )}
    </div>
  );
}

function GroupBlock({
  kind,
  total,
  pct,
  rows,
}: {
  kind: keyof typeof GROUP;
  total: number;
  pct: number;
  rows: { label: string; count: number }[];
}) {
  const group = GROUP[kind];
  return (
    <div>
      <div className="flex items-baseline gap-1.5">
        <span aria-hidden className={cn('size-2 rounded-full', group.dot)} />
        <span className="text-sm font-semibold">{group.label}</span>
        <span className="text-foreground text-sm font-bold">{total.toLocaleString()}</span>
        <span className="text-muted-foreground text-xs">({pct}%)</span>
      </div>
      {/* 하위 유형은 정확한 수치로. 자연사·안락사를 합치지 않는다. */}
      <p className="text-muted-foreground mt-0.5 pl-3.5 text-xs">
        {rows.map((row) => `${row.label} ${row.count.toLocaleString()}`).join(' · ')}
      </p>
    </div>
  );
}

/** 있는 그룹으로만 문장을 만든다. 대기는 '기다린다', 종료는 삶/무지개다리로. */
function buildSentence(waiting: number, life: number, loss: number, total: number): string {
  const clauses: string[] = [];
  if (waiting > 0) clauses.push(`${waiting.toLocaleString()}마리가 새 가족을 기다리고`);
  if (life > 0) clauses.push(`${life.toLocaleString()}마리는 가족을 만나거나 자연으로 돌아갔으며`);
  if (loss > 0) clauses.push(`${loss.toLocaleString()}마리는 무지개다리를 건넜습니다`);

  if (clauses.length === 0) return '';
  // 대기만 있을 때는 종결어미를 맞춘다.
  if (waiting > 0 && life === 0 && loss === 0) {
    return `${total.toLocaleString()}마리가 새 가족을 기다리고 있습니다.`;
  }
  // 마지막 절이 '무지개다리를 건넜습니다'가 아니면(=삶만 있음) 종결을 맞춘다.
  if (loss === 0) {
    const parts: string[] = [];
    if (waiting > 0) parts.push(`${waiting.toLocaleString()}마리가 기다리고`);
    if (life > 0) parts.push(`${life.toLocaleString()}마리는 가족을 만나거나 자연으로 돌아갔습니다`);
    return `${parts.join(', ')}.`;
  }
  return `${clauses.join(', ')}.`;
}
