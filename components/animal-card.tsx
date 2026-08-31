'use client';

import { Phone } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { displayState, endOutcome, endOutcomeLabel, formatYmd, isEnded, type Animal } from '@/lib/animal';
import { cn } from '@/lib/utils';

/*
 * 배지 색은 **불투명**이어야 한다.
 *
 * 배지는 업스트림 사진 위에 얹힌다. 사진 밝기를 통제할 수 없는데 반투명 배경을 쓰면
 * 최종 색이 사진에 따라 달라진다. 실제로 bg-red-500/15 + text-red-400 조합은
 * 검은 사진 위에서 6.5:1 이지만 흰 사진 위에서는 2.3:1 까지 무너져 안 읽혔다.
 * 흰 사진과 검은 사진 양쪽을 동시에 만족하는 투명도 값은 존재하지 않으므로,
 * 배경을 불투명으로 못박아 사진과 무관하게 대비를 고정한다.
 *
 * 각 단계는 흰/검은 사진 어느 쪽에서도 동일하게 아래 대비를 낸다(WCAG AA 4.5:1 기준).
 *   임박 red-700 + white        6.42:1
 *   주의 amber-400 + amber-950  8.73:1
 *   평상 neutral-900 + neutral-100 16.42:1
 *
 * 공고 종료는 안락사 가능 시점과 연결된다. 그렇다고 모든 카드를 빨갛게 칠하면
 * 사용자가 이내 무시하게 되므로, 정말 임박한 것만 올린다.
 */
const TONE = {
  /** 평상. neutral-900 은 카드 표면과 같은 색이라 사진 위에서도 튀지 않는다. */
  calm: 'bg-neutral-900 text-neutral-100',
  warn: 'bg-amber-400 text-amber-950',
  urgent: 'bg-red-700 text-white',
  /*
   * 종료 결과 배지. 배경이 사진 위에 얹히므로 위 배지들과 같은 원칙 — **불투명**으로 대비를 고정한다.
   *   삶(반환·입양·기증·방사) emerald-800 + white     7.68:1
   *   죽음(자연사·안락사)      neutral-800 + neutral-100 13.88:1
   * (흰/검은 사진 어느 쪽에서도 동일. WCAG AA 4.5:1 을 양쪽 다 넘는다.)
   * 삶은 초록으로 살려 내고 죽음은 무채색으로 가라앉혀, 색만 봐도 결과가 갈리게 한다.
   */
  life: 'bg-emerald-800 text-white',
  loss: 'bg-neutral-800 text-neutral-100',
} as const;

/**
 * 진행 중 공고의 마감 배지.
 *
 * **종료된 개체에는 쓰지 않는다** — 종료 개체는 noticeEdt 가 오늘이라 daysLeft 가 0 으로
 * 나와 '오늘 마감'(빨강)이 붙었는데, 이미 결과가 난 아이에게 마감을 알리는 건 틀렸고
 * 오해를 부른다. 그쪽은 endBadge 가 결과(반환/자연사…)를 대신 보여준다.
 */
function deadlineTone(daysLeft: number | null): {
  label: string;
  className: string;
} {
  if (daysLeft === null) return { label: '기한 미상', className: TONE.calm };
  if (daysLeft < 0) return { label: '공고 종료', className: TONE.calm };
  if (daysLeft === 0) return { label: '오늘 마감', className: TONE.urgent };
  if (daysLeft <= 3) return { label: `${daysLeft}일 남음`, className: TONE.urgent };
  if (daysLeft <= 7) return { label: `${daysLeft}일 남음`, className: TONE.warn };
  return { label: `${daysLeft}일 남음`, className: TONE.calm };
}

/** 종료 개체의 결과 배지. 마감 대신 '반환'·'자연사' 같은 결과를 결과별 색으로 보여준다. */
function endBadge(state: string): { label: string; className: string } {
  return {
    label: endOutcomeLabel(state),
    className: endOutcome(state) === 'life' ? TONE.life : TONE.loss,
  };
}

export function AnimalCard({ animal, onSelect }: { animal: Animal; onSelect: (a: Animal) => void }) {
  const ended = isEnded(animal.state);
  // 종료된 아이는 마감 배지 대신 결과 배지. 마감은 이미 지난 이야기다.
  const tone = ended ? endBadge(animal.state) : deadlineTone(animal.daysLeft);

  return (
    <button
      type="button"
      onClick={() => onSelect(animal)}
      className="bg-card border-border hover:border-primary/50 focus-visible:ring-ring group overflow-hidden rounded-xl border text-left transition-colors focus-visible:ring-2 focus-visible:outline-none"
    >
      <div className="bg-muted relative aspect-4/3 overflow-hidden">
        {animal.photo ? (
          /*
           * next/image 를 쓰지 않는 이유:
           * 원본이 1000x750·250KB 라 리사이즈가 이상적이지만, Vercel 의 이미지 변환은
           * 플랜 할당량을 소모한다. 공고는 매일 수천 건이 바뀌어 캐시 적중률이 낮고,
           * 할당량을 넘기면 이미지가 통째로 안 나온다. 그래서 프록시(app/api/photo)로
           * mixed content 와 content-type 만 바로잡고, 지연 로딩으로 대역폭을 줄인다.
           * 프록시 응답에 한 달짜리 s-maxage 를 걸어 CDN 이 실제 부담을 진다.
           */
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={animal.photo}
            alt={`${animal.breed} ${animal.sex}`}
            loading="lazy"
            decoding="async"
            className={cn(
              'size-full object-cover transition-transform group-hover:scale-105',
              // 종료된 아이의 사진은 회색으로. 결과가 난 아이임을 사진 자체로 알린다.
              // 다크 테마에서 회색조가 그대로면 너무 가라앉아 brightness 를 살짝 올린다.
              ended && 'grayscale brightness-105 dark:brightness-110',
            )}
          />
        ) : (
          <div className="text-muted-foreground flex size-full items-center justify-center text-xs">
            사진 없음
          </div>
        )}
        <span
          className={cn(
            /*
             * backdrop-blur 를 뺐다. 배경이 불투명해져 뒤가 비치지 않으므로 아무 효과가 없고,
             * 카드마다 합성 레이어만 하나씩 늘린다.
             * ring 은 어두운 사진 위에서 평상 배지(거의 검정)의 윤곽이 사라지지 않게 하는 장식이다.
             */
            'absolute top-2 left-2 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-white/15',
            tone.className,
          )}
        >
          {tone.label}
        </span>
      </div>

      <div className="p-3">
        <div className="flex items-baseline gap-1.5">
          <span className="truncate text-sm font-bold">{animal.breed}</span>
          <span className="text-muted-foreground shrink-0 text-xs">{animal.sex}</span>
        </div>
        <p className="text-muted-foreground mt-0.5 truncate text-xs">
          {animal.age} · {animal.weight}
        </p>

        <div className="mt-2 flex flex-wrap items-center gap-1">
          <Badge variant="secondary" className="text-[10px]">
            {animal.species}
          </Badge>
          {animal.neutered === '예' && (
            <Badge variant="outline" className="text-[10px]">
              중성화
            </Badge>
          )}
          <Badge variant="outline" className="text-[10px]">
            {displayState(animal)}
          </Badge>
        </div>

        <p className="text-muted-foreground mt-2 truncate text-[11px]">
          {animal.shelter.name || '보호소 미상'}
        </p>
        <p className="text-muted-foreground flex items-center gap-1 text-[11px]">
          <Phone className="size-3 shrink-0" aria-hidden />
          {animal.shelter.tel || '연락처 미상'}
        </p>
        <p className="text-muted-foreground mt-1 text-[11px]">
          공고 {formatYmd(animal.noticeFrom)} ~ {formatYmd(animal.noticeTo)}
        </p>
      </div>
    </button>
  );
}
