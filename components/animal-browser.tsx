'use client';

import { Info, PawPrint, Search, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import { AnimalCard } from '@/components/animal-card';
import { AnimalDetail } from '@/components/animal-detail';
import { ReturnSummary } from '@/components/return-summary';
import { HelpDialog, SearchDialog, useShortcuts } from '@/components/shortcuts';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { SPECIES_OPTIONS, STATE_OPTIONS, type Animal } from '@/lib/animal';
import { takeAnimalsPreload } from '@/lib/animals-preload';
import { cn } from '@/lib/utils';

interface Sido {
  code: string;
  name: string;
}

interface Filters {
  upkind: string;
  region: string;
  state: string;
  keyword: string;
}

/*
 * 기본을 '공고중' 으로 둔다. '보호중' 은 공고 기간이 끝난 뒤에도 보호소에 남아 있는
 * 개체라 마감까지 남은 날이 전부 음수다(실측: 60건 전부 -3~-12일).
 * 이 앱의 축이 마감이므로 기본 화면은 공고가 살아 있는 쪽이어야 한다.
 */
const INITIAL: Filters = { upkind: '', region: '', state: 'notice', keyword: '' };

const SPECIES_CODES = new Set<string>(SPECIES_OPTIONS.map((option) => option.code));
const STATE_CODES = new Set<string>(STATE_OPTIONS.map((option) => option.code));

/**
 * URL → 필터.
 *
 * 값을 화이트리스트로 거른다. 주소창은 사용자가 손댈 수 있는 입력이고,
 * API 가 모르는 upkind/state 에 400 을 주도록 바뀌었으므로 여기서 걸러야
 * 오타 링크 하나가 화면 전체를 에러로 만들지 않는다.
 */
function readUrl(search: string): { filters: Filters; page: number } {
  const params = new URLSearchParams(search);
  const upkind = params.get('upkind') ?? '';
  const state = params.get('state');
  const page = Number(params.get('page'));

  return {
    filters: {
      upkind: SPECIES_CODES.has(upkind) ? upkind : INITIAL.upkind,
      region: params.get('region') ?? INITIAL.region,
      // state 가 아예 없으면 기본값(공고중), 빈 문자열이면 사용자가 고른 '전체'다.
      state: state !== null && STATE_CODES.has(state) ? state : INITIAL.state,
      keyword: params.get('q') ?? INITIAL.keyword,
    },
    page: Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1,
  };
}

/**
 * 주소창을 필터의 단일 출처로 쓴다.
 *
 * `popstate` 만 듣는 걸로는 부족하다 — 우리가 부르는 `pushState` 는 이벤트를 안 낸다.
 * 그래서 구독자를 직접 들고 있다가 push 할 때 같이 깨운다.
 */
const urlListeners = new Set<() => void>();

function subscribeUrl(onChange: () => void): () => void {
  urlListeners.add(onChange);
  window.addEventListener('popstate', onChange);
  return () => {
    urlListeners.delete(onChange);
    window.removeEventListener('popstate', onChange);
  };
}

function pushUrl(next: string, replace = false): void {
  if (next === `${window.location.pathname}${window.location.search}`) return;
  // 검색어는 한 글자마다 바뀐다. push 하면 뒤로가기 한 번이 한 글자를 지우는 꼴이 된다.
  if (replace) window.history.replaceState(null, '', next);
  else window.history.pushState(null, '', next);
  for (const listener of urlListeners) listener();
}

/** 필터 → 쿼리스트링. 기본값은 적지 않아 주소가 짧게 유지된다. */
function writeUrl(filters: Filters, page: number): string {
  const params = new URLSearchParams();
  if (filters.upkind) params.set('upkind', filters.upkind);
  if (filters.region) params.set('region', filters.region);
  // '전체'(빈 문자열)도 반드시 적는다. 없으면 기본값 '공고중' 으로 되돌아간다.
  if (filters.state !== INITIAL.state) params.set('state', filters.state);
  if (filters.keyword) params.set('q', filters.keyword);
  if (page > 1) params.set('page', String(page));
  const query = params.toString();
  return query ? `${window.location.pathname}?${query}` : window.location.pathname;
}

interface AnimalsPage {
  totalCount: number;
  animals: Animal[];
  // 종료 요약 배너가 쓰는 값. 정상 응답에만 있고, 종료 필터가 아니면 배너를 안 그린다.
  fetchedAt?: string;
  stateBreakdown?: Record<string, number>;
}

/** 라우트가 400/502 에 실어 보내는 형태. 정상 응답에는 `error` 가 없다. */
function isApiError(body: unknown): body is { error: string; message?: string } {
  return typeof body === 'object' && body !== null && 'error' in body;
}

async function fetchAnimalsPage(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal });
  return response.json();
}

export function AnimalBrowser() {
  /*
   * 필터를 useState 에 두면 딥링크·뒤로가기·새로고침에서 전부 날아간다.
   * 주소창을 출처로 삼아 그 문제를 없앤다. 서버 스냅샷은 빈 문자열이라
   * SSR 은 기본 필터로 그리고, 하이드레이션 후 실제 주소로 한 번 맞춰진다.
   */
  const search = useSyncExternalStore(
    subscribeUrl,
    () => window.location.search,
    () => '',
  );
  const { filters, page } = useMemo(() => readUrl(search), [search]);

  const [helpOpen, setHelpOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [sido, setSido] = useState<Sido[]>([]);
  const [animals, setAnimals] = useState<Animal[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [breakdown, setBreakdown] = useState<Record<string, number>>({});
  const [fetchedAt, setFetchedAt] = useState<string | undefined>(undefined);
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
        if (filters.region) query.set('region', filters.region);
        if (filters.state) query.set('state', filters.state);
        if (filters.keyword) query.set('q', filters.keyword);

        const url = `/api/animals?${query}`;

        /*
         * layout 이 HTML 파싱 시점에 띄워 둔 요청이 있으면 그걸 쓴다. 하이드레이션을
         * 기다리는 동안 응답이 이미 날아와 있으므로 스켈레톤이 그만큼 짧아진다.
         * 없거나(필터가 걸린 진입) 실패했으면(null) 평소대로 직접 받는다.
         */
        const body = (await takeAnimalsPreload(url)) ?? (await fetchAnimalsPage(url, controller.signal));
        if (controller.signal.aborted) return;
        if (isApiError(body)) throw new Error(body.message ?? '조회 실패');
        const result = body as AnimalsPage;
        setAnimals(result.animals);
        setTotalCount(result.totalCount);
        setBreakdown(result.stateBreakdown ?? {});
        setFetchedAt(result.fetchedAt);
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
    // filters 는 URL 에서 새로 만들어지는 객체라 참조로 비교하면 안 된다. 값으로 건다.
  }, [filters.upkind, filters.region, filters.state, filters.keyword, page]);

  useShortcuts({
    onHelp: () => setHelpOpen(true),
    onSearch: () => setSearchOpen(true),
    onClose: () => {
      setHelpOpen(false);
      setSearchOpen(false);
      setSelected(null);
    },
  });

  // 필터가 바뀌면 1페이지부터 다시 본다. 3페이지에서 축종을 바꾸면 빈 화면이 나온다.
  const update = useCallback(
    (patch: Partial<Filters>, replace = false) => {
      pushUrl(writeUrl({ ...filters, ...patch }, 1), replace);
    },
    [filters],
  );

  // 페이지를 넘기면 목록 맨 위로. 안 그러면 새 목록의 중간부터 보게 된다.
  const goToPage = useCallback(
    (next: number) => {
      pushUrl(writeUrl(filters, next));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    [filters],
  );

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

          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              aria-label="검색 (⌘K)"
              title="검색 (⌘K)"
              className="border-border hover:bg-accent flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs"
            >
              <Search className="size-3.5" />
              <span className="hidden sm:inline">검색</span>
            </button>
            <button
              type="button"
              onClick={() => setHelpOpen(true)}
              aria-label="사용법 (?)"
              title="사용법 (?)"
              className="border-border hover:bg-accent size-7 rounded-full border text-xs"
            >
              ?
            </button>
          </div>
        </div>

        {filters.keyword && (
          <div className="mb-2 flex items-center gap-1.5">
            <span className="bg-primary/15 text-primary flex items-center gap-1 rounded-full px-2.5 py-1 text-xs">
              “{filters.keyword}”
              <button
                type="button"
                onClick={() => update({ keyword: '' })}
                aria-label="검색어 지우기"
                className="hover:bg-primary/20 rounded-full"
              >
                <X className="size-3" />
              </button>
            </span>
          </div>
        )}

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
            <FilterChip active={filters.region === ''} onClick={() => update({ region: '' })}>
              전국
            </FilterChip>
            {sido.map((region) => {
              // 메모리 필터는 보호소 관할 기관명(orgNm)에 포함되는지로 판정한다.
              // orgNm 이 '경기도 오산시' 처럼 시도명으로 시작하므로 접두어가 그대로 키가 된다.
              const key = region.name.replace(/(특별시|광역시|특별자치시|특별자치도)$/, '');
              return (
                <FilterChip
                  key={region.code}
                  active={filters.region === key}
                  onClick={() => update({ region: key })}
                >
                  {key}
                </FilterChip>
              );
            })}
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

      {/* 종료 필터에서만, 그리고 목록이 실제로 그려질 때만 요약을 보인다. */}
      {filters.state === 'return' && !loading && totalCount > 0 && (
        <ReturnSummary breakdown={breakdown} fetchedAt={fetchedAt} />
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
            onClick={() => goToPage(Math.max(1, page - 1))}
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
            onClick={() => goToPage(page + 1)}
            className="border-border hover:bg-accent rounded-md border px-3 py-1.5 disabled:opacity-40"
          >
            다음
          </button>
        </div>
      )}

      {selected && <AnimalDetail animal={selected} onClose={() => setSelected(null)} />}
      {helpOpen && <HelpDialog onClose={() => setHelpOpen(false)} />}
      {searchOpen && (
        <SearchDialog
          value={filters.keyword}
          onChange={(keyword) => update({ keyword }, true)}
          onClose={() => setSearchOpen(false)}
        />
      )}
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
