'use client';

import { Phone } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { displayState, formatYmd, type Animal } from '@/lib/animal';
import { cn } from '@/lib/utils';

/**
 * 남은 날에 따른 강조.
 *
 * 공고 종료는 안락사 가능 시점과 연결된다. 그렇다고 모든 카드를 빨갛게 칠하면
 * 사용자가 이내 무시하게 되므로, 정말 임박한 것만 올린다.
 */
function deadlineTone(daysLeft: number | null): {
  label: string;
  className: string;
} {
  if (daysLeft === null) return { label: '기한 미상', className: 'bg-muted text-muted-foreground' };
  if (daysLeft < 0) return { label: '공고 종료', className: 'bg-muted text-muted-foreground' };
  if (daysLeft === 0) return { label: '오늘 마감', className: 'bg-red-500/15 text-red-400' };
  if (daysLeft <= 3) return { label: `${daysLeft}일 남음`, className: 'bg-red-500/15 text-red-400' };
  if (daysLeft <= 7) return { label: `${daysLeft}일 남음`, className: 'bg-amber-500/15 text-amber-400' };
  return { label: `${daysLeft}일 남음`, className: 'bg-muted text-muted-foreground' };
}

export function AnimalCard({ animal, onSelect }: { animal: Animal; onSelect: (a: Animal) => void }) {
  const tone = deadlineTone(animal.daysLeft);

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
            className="size-full object-cover transition-transform group-hover:scale-105"
          />
        ) : (
          <div className="text-muted-foreground flex size-full items-center justify-center text-xs">
            사진 없음
          </div>
        )}
        <span
          className={cn(
            'absolute top-2 left-2 rounded-full px-2 py-0.5 text-[11px] font-medium backdrop-blur',
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
