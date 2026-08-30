'use client';

import { Search, X } from 'lucide-react';
import { useEffect, useRef } from 'react';

/**
 * 전역 단축키.
 *
 * `?` 는 입력 중에는 잡으면 안 된다 — 검색창에 물음표를 못 치게 된다.
 * 그래서 포커스가 input/textarea 에 있을 때는 통과시킨다.
 */
export function useShortcuts({
  onHelp,
  onSearch,
  onClose,
}: {
  onHelp: () => void;
  onSearch: () => void;
  onClose: () => void;
}) {
  const handlers = useRef({ onHelp, onSearch, onClose });
  useEffect(() => {
    handlers.current = { onHelp, onSearch, onClose };
  }, [onHelp, onSearch, onClose]);

  useEffect(() => {
    const isTyping = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      if (!el) return false;
      return (
        el.tagName === 'INPUT' ||
        el.tagName === 'TEXTAREA' ||
        el.isContentEditable
      );
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handlers.current.onClose();
        return;
      }
      // ⌘K / Ctrl+K 는 입력 중에도 동작해야 한다. 검색을 여는 키라서.
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        handlers.current.onSearch();
        return;
      }
      if (event.key === '?' && !isTyping(event.target) && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        handlers.current.onHelp();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}

export function HelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <Overlay onClose={onClose} label="사용법">
      <h2 className="text-base font-bold">사용법</h2>

      <section className="mt-4 space-y-3 text-sm">
        <div>
          <p className="font-medium">공고는 마감이 임박한 순서로 나옵니다</p>
          <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
            오늘 마감인 아이가 맨 앞에 옵니다. 카드 왼쪽 위 배지가 남은 날짜입니다.
            3일 이내면 빨강, 7일 이내면 주황입니다.
          </p>
        </div>
        <div>
          <p className="font-medium">공고중과 보호중은 다릅니다</p>
          <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
            <strong className="text-foreground">공고중</strong>은 공고 기간이 남은 아이,
            <strong className="text-foreground"> 보호중</strong>은 공고가 끝났지만 아직 보호소에 있는
            아이입니다.
          </p>
        </div>
        <div>
          <p className="font-medium">입양 문의는 보호소로 직접</p>
          <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
            카드를 누르면 보호소 전화번호가 나옵니다. 이 앱은 문의를 대신 받지 않습니다.
            절차와 현재 상태는 보호소만 알 수 있습니다.
          </p>
        </div>
      </section>

      <section className="mt-5">
        <p className="text-muted-foreground mb-2 text-xs font-medium">단축키</p>
        <dl className="space-y-1.5 text-sm">
          {[
            ['⌘K / Ctrl+K', '키워드 검색'],
            ['?', '이 도움말'],
            ['Esc', '닫기'],
          ].map(([key, desc]) => (
            <div key={key} className="flex items-center justify-between gap-3">
              <dt>
                <kbd className="bg-muted border-border rounded border px-1.5 py-0.5 font-mono text-[11px]">
                  {key}
                </kbd>
              </dt>
              <dd className="text-muted-foreground text-xs">{desc}</dd>
            </div>
          ))}
        </dl>
      </section>

      <p className="text-muted-foreground mt-5 text-[11px] leading-relaxed">
        데이터는 국가동물보호정보시스템 공고입니다. 지자체 입력과 실제 상황 사이에 시차가 있을 수
        있으니, 방문 전 반드시 보호소에 확인하세요.
      </p>
    </Overlay>
  );
}

export function SearchDialog({
  value,
  onChange,
  onClose,
}: {
  value: string;
  onChange: (next: string) => void;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <Overlay onClose={onClose} label="검색" align="top">
      <div className="flex items-center gap-2">
        <Search className="text-muted-foreground size-4 shrink-0" aria-hidden />
        <input
          ref={inputRef}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onClose();
          }}
          placeholder="품종, 특징, 보호소, 지역…"
          aria-label="키워드 검색"
          className="w-full bg-transparent text-sm outline-none"
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange('')}
            aria-label="지우기"
            className="hover:bg-accent text-muted-foreground rounded p-1"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
      <p className="text-muted-foreground mt-3 text-[11px]">
        품종·특징·보호소 이름·지역을 한꺼번에 찾습니다. 예: 진돗개, 사람 좋아함, 순한
      </p>
    </Overlay>
  );
}

function Overlay({
  children,
  onClose,
  label,
  align = 'center',
}: {
  children: React.ReactNode;
  onClose: () => void;
  label: string;
  align?: 'center' | 'top';
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onClick={onClose}
      className={`bg-background/70 fixed inset-0 z-50 flex justify-center px-4 backdrop-blur-sm ${
        align === 'top' ? 'items-start pt-24' : 'items-center'
      }`}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="bg-card border-border max-h-[80dvh] w-full max-w-md overflow-y-auto rounded-2xl border p-5"
      >
        {children}
      </div>
    </div>
  );
}
