'use client';

import { Building2, ExternalLink, MapPin, Phone, X } from 'lucide-react';

import { Separator } from '@/components/ui/separator';
import { displayState, formatUpdatedAt, formatYmd, type Animal } from '@/lib/animal';

/**
 * 상세 패널.
 *
 * 입양 문의는 이 앱이 받지 않는다. 절차·가능 여부·현재 상태를 아는 곳은 보호소뿐이고,
 * 데이터에 `careTel` 이 들어 있으므로 전화로 바로 연결한다.
 */
export function AnimalDetail({ animal, onClose }: { animal: Animal; onClose: () => void }) {
  return (
    <div
      className="bg-background/70 fixed inset-0 z-50 flex items-end justify-center backdrop-blur-sm sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={`${animal.breed} 상세`}
      onClick={onClose}
    >
      <div
        className="bg-card border-border max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl border sm:rounded-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="bg-card sticky top-0 z-10 flex items-start gap-2 border-b border-inherit px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-bold">{animal.breed}</h2>
            <p className="text-muted-foreground text-xs">
              {animal.species} · {animal.sex} · {animal.age}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="hover:bg-accent text-muted-foreground rounded-md p-1"
          >
            <X className="size-4" />
          </button>
        </div>

        {animal.photos.length > 0 && (
          <div className="flex gap-1 overflow-x-auto p-1">
            {animal.photos.map((src) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={src}
                src={src}
                alt={animal.breed}
                loading="lazy"
                className="bg-muted h-56 w-auto shrink-0 rounded-lg object-cover"
              />
            ))}
          </div>
        )}

        <div className="space-y-4 px-4 py-4">
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
            {[
              ['상태', displayState(animal)],
              ['중성화', animal.neutered],
              ['체중', animal.weight],
              ['색상', animal.color],
              ['발견일', formatYmd(animal.foundAt)],
              ['공고기간', `${formatYmd(animal.noticeFrom)} ~ ${formatYmd(animal.noticeTo)}`],
            ].map(([label, value]) => (
              <div key={label} className="flex items-baseline justify-between gap-2">
                <dt className="text-muted-foreground shrink-0 text-xs">{label}</dt>
                <dd className="truncate text-right text-xs">{value}</dd>
              </div>
            ))}
          </dl>

          {animal.foundPlace && (
            <p className="text-muted-foreground flex items-start gap-1.5 text-xs">
              <MapPin className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              발견장소 {animal.foundPlace}
            </p>
          )}

          {animal.note && (
            <div className="bg-background/50 border-border/60 rounded-lg border p-3">
              <p className="text-muted-foreground mb-1 text-xs font-medium">특징</p>
              <p className="text-xs leading-relaxed whitespace-pre-wrap">{animal.note}</p>
            </div>
          )}

          <Separator />

          <div>
            <p className="text-muted-foreground mb-2 flex items-center gap-1.5 text-xs font-medium">
              <Building2 className="size-3.5" aria-hidden />
              보호소
            </p>
            <p className="text-sm font-medium">{animal.shelter.name || '미상'}</p>
            {animal.shelter.address && (
              <p className="text-muted-foreground mt-0.5 text-xs">{animal.shelter.address}</p>
            )}
            {animal.shelter.org && (
              <p className="text-muted-foreground text-xs">관할 {animal.shelter.org}</p>
            )}

            {animal.shelter.tel && (
              <a
                href={`tel:${animal.shelter.tel.replace(/[^0-9+]/g, '')}`}
                className="bg-primary text-primary-foreground mt-3 flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium"
              >
                <Phone className="size-4" />
                {animal.shelter.tel} 로 문의
              </a>
            )}

            <p className="text-muted-foreground mt-2 text-[11px] leading-relaxed">
              입양 가능 여부와 절차는 보호소에 직접 확인하세요. 이 앱은 문의를 대신 받지 않습니다.
            </p>
          </div>

          <Separator />

          <div className="text-muted-foreground space-y-1 text-[11px]">
            <p>공고번호 {animal.id}</p>
            {/* 갱신 시각은 반드시 노출한다. 원천이 지자체 수기 입력이라 시차가 있다. */}
            <p>정보 기준 {formatUpdatedAt(animal.updatedAt)}</p>
            <a
              href="https://www.animal.go.kr/front/index.do"
              target="_blank"
              rel="noreferrer"
              className="text-primary inline-flex items-center gap-1 hover:underline"
            >
              국가동물보호정보시스템에서 확인
              <ExternalLink className="size-3" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
