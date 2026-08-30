'use client';

import { Info, PawPrint } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { AnimalCard } from '@/components/animal-card';
import { AnimalDetail } from '@/components/animal-detail';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { SPECIES_OPTIONS, STATE_OPTIONS, type Animal } from '@/lib/animal';
import { cn } from '@/lib/utils';

interface Sido {
  code: string;
  name: string;
}

interface Filters {
  upkind: string;
  sido: string;
  state: string;
}

/*
 * 기본을 '공고중' 으로 둔다. '보호중' 은 공고 기간이 끝난 뒤에도 보호소에 남아 있는
 * 개체라 마감까지 남은 날이 전부 음수다(실측: 60건 전부 -3~-12일).
 * 이 앱의 축이 마감이므로 기본 화면은 공고가 살아 있는 쪽이어야 한다.
 */
const INITIAL: Filters = { upkind: '', sido: '', state: 'notice' };

export function AnimalBrowser() {
  const [filters, setFilters] = useState<Filters>(INITIAL);
  const [sido, setSido] = useState<Sido[]>([]);
  const [animals, setAnimals] = useState<Animal[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Animal | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch('/api/sido');
        if (!response.ok) return;
        const body = (await response.json()) as { sido: Sido[] };
        if (!cancelled) setSido(body.sido);
      } catch {
        // 지역 필터는 없어도 목록은 성립한다. 조용히 넘어간다.
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    // effect 본문에서 동기 setState 를 하면 연쇄 렌더가 난다. async 경계 뒤로 미룬다.
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const query = new URLSearchParams({ page: String(page) });
        if (filters.upkind) query.set('upkind', filters.upkind);
        if (filters.sido) query.set('sido', filters.sido);
        if (filters.state) query.set('state', filters.state);

        const response = await fetch(`/api/animals?${query}`, { signal: controller.signal });
        const body = await response.json();
        if (!response.ok) throw new Error(body.message ?? '조회 실패');
        if (controller.signal.aborted) return;
        setAnimals(body.animals as Animal[]);
        setTotalCount(body.totalCount as number);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : '조회 실패');
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    void load();
    return () => controller.abort();
  }, [filters, page]);

  const update = useCallback((patch: Partial<Filters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  }, []);

  // 정렬은 서버가 전수로 한다. 페이지 안에서만 정렬하면 정작 오늘 마감인 개체가
  // 뒷페이지에 묻힌다(실측으로 확인).
  const sorted = animals;

  const totalPages = Math.max(1, Math.ceil(totalCount / 60));

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16">
      <header className="sticky top-0 z-30 -mx-4 mb-4 px-4 pt-4 pb-3 backdrop-blur">
        <div className="mb-3 flex items-center gap-2">
          <PawPrint className="text-primary size-5" aria-hidden />
          <h1 className="text-base font-bold">입양</h1>
          <span className="text-muted-foreground text-xs">
            {loading ? '불러오는 중…' : `${totalCount.toLocaleString()}마리`}
          </span>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {SPECIES_OPTIONS.map((option) => (
            <FilterChip
              key={option.code}
              active={filters.upkind === option.code}
              onClick={() => update({ upkind: option.code })}
            >
              {option.label}
            </FilterChip>
          ))}
          <span className="border-border mx-1 border-l" />
          {STATE_OPTIONS.map((option) => (
            <FilterChip
              key={option.code}
              active={filters.state === option.code}
              onClick={() => update({ state: option.code })}
            >
              {option.label}
            </FilterChip>
          ))}
        </div>

        {sido.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            <FilterChip active={filters.sido === ''} onClick={() => update({ sido: '' })}>
              전국
            </FilterChip>
            {sido.map((region) => (
              <FilterChip
                key={region.code}
                active={filters.sido === region.code}
                onClick={() => update({ sido: region.code })}
              >
                {region.name.replace(/(특별시|광역시|특별자치시|특별자치도)$/, '')}
              </FilterChip>
            ))}
          </div>
        )}
      </header>

      {/* 갱신 시차를 밝힌다. 원천이 지자체 수기 입력이라 처리와 반영 사이에 시차가 있다. */}
      <p className="border-border bg-card/60 text-muted-foreground mb-4 flex items-start gap-2 rounded-lg border p-3 text-xs leading-relaxed">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>
          국가동물보호정보시스템 공고 데이터입니다. 지자체 입력 시점과 실제 상황 사이에 시차가 있을 수
          있으니, <strong className="text-foreground">입양 전 반드시 보호소에 직접 확인</strong>하세요.
          각 카드의 상세에서 정보 기준 시각을 볼 수 있습니다.
        </span>
      </p>

      {error && (
        <p className="border-destructive/40 bg-destructive/10 mb-4 rounded-lg border p-3 text-xs">
          {error}
        </p>
      )}

      {loading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 12 }, (_, index) => (
            <Skeleton key={index} className="aspect-3/4 w-full rounded-xl" />
          ))}
        </div>
      ) : sorted.length === 0 ? (
        <p className="text-muted-foreground py-16 text-center text-sm">조건에 맞는 공고가 없습니다.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {sorted.map((animal) => (
            <AnimalCard key={animal.id} animal={animal} onSelect={setSelected} />
          ))}
        </div>
      )}

      {totalPages > 1 && !loading && (
        <div className="mt-6 flex items-center justify-center gap-2 text-sm">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="border-border hover:bg-accent rounded-md border px-3 py-1.5 disabled:opacity-40"
          >
            이전
          </button>
          <Badge variant="secondary">
            {page} / {totalPages.toLocaleString()}
          </Badge>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="border-border hover:bg-accent rounded-md border px-3 py-1.5 disabled:opacity-40"
          >
            다음
          </button>
        </div>
      )}

      {selected && <AnimalDetail animal={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-full border px-2.5 py-1 text-xs transition-colors',
        active
          ? 'bg-primary text-primary-foreground border-primary'
          : 'border-border hover:bg-accent',
      )}
    >
      {children}
    </button>
  );
}
