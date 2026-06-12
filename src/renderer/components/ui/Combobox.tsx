import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { FiChevronDown } from 'react-icons/fi';

export interface ComboboxItem {
  value: string;
  label: string;
}

export interface ComboboxFooterAction {
  label: string;
  onClick: () => void;
}

export function Combobox({
  items,
  value,
  onSelect,
  placeholder,
  ariaLabel,
  disabled = false,
  loading = false,
  footerAction,
}: {
  items: ComboboxItem[];
  value: string | null;
  onSelect: (value: string) => void;
  placeholder: string;
  ariaLabel: string;
  disabled?: boolean;
  loading?: boolean;
  footerAction?: ComboboxFooterAction;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  const selected = items.find((i) => i.value === value) ?? null;
  const filtered = items.filter((i) => i.label.toLowerCase().includes(query.trim().toLowerCase()));

  // Fix 2: Clamp active index against the current filtered list
  const active = filtered.length === 0 ? -1 : Math.min(activeIndex, filtered.length - 1);

  const close = () => {
    setOpen(false);
    setQuery('');
    setActiveIndex(0);
  };

  const choose = (v: string) => {
    close();
    triggerRef.current?.focus();
    onSelect(v);
  };

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Fix 5: Deduplicate close logic — call close() in the outside-mousedown handler
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (rootRef.current !== null && !rootRef.current.contains(e.target as Node)) {
        close();
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  // Fix 4: Keep the active option scrolled into view
  useEffect(() => {
    if (!open || active < 0) return;
    document.getElementById(`${listboxId}-opt-${active}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [open, active, listboxId]);

  const onInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      // Fix 2: Clamp ArrowDown against filtered list
      setActiveIndex(filtered.length === 0 ? 0 : Math.min(active + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      // Fix 2: Clamp ArrowUp against filtered list
      setActiveIndex(Math.max(active - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // Fix 2: Only select if active >= 0
      if (active >= 0) {
        const item = filtered[active];
        if (item !== undefined) choose(item.value);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
      triggerRef.current?.focus();
    } else if (e.key === 'Tab') {
      // Fix 3: Close on Tab without preventing default (allows normal focus movement)
      close();
    }
  };

  return (
    <div ref={rootRef} className="relative">
      {/* Fix 1: APG "select-only combobox" trigger pattern */}
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={listboxId}
        disabled={disabled}
        className="flex w-full items-center justify-between gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-left text-sm disabled:bg-slate-100 disabled:text-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:disabled:bg-slate-800 dark:disabled:text-slate-500"
        onClick={() => (open ? close() : setOpen(true))}
      >
        <span className={`truncate ${selected === null ? 'text-slate-500 dark:text-slate-400' : ''}`}>
          {selected !== null ? selected.label : placeholder}
        </span>
        <FiChevronDown className="h-4 w-4 shrink-0" aria-hidden />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded border border-slate-200 bg-white text-sm shadow-lg dark:border-slate-700 dark:bg-slate-900">
          {/* Fix 1: type="search" (implicit searchbox role), remove combobox/expanded/autocomplete attrs */}
          <input
            ref={inputRef}
            type="search"
            aria-label={t('combobox.searchAria')}
            aria-controls={listboxId}
            aria-activedescendant={!loading && active >= 0 ? `${listboxId}-opt-${active}` : undefined}
            placeholder={t('combobox.searchPlaceholder')}
            className="w-full border-b border-slate-200 bg-transparent px-2 py-1.5 outline-none dark:border-slate-700 dark:text-slate-100"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={onInputKeyDown}
          />
          <ul role="listbox" id={listboxId} className="max-h-60 overflow-auto py-1">
            {loading ? (
              <li className="px-2 py-1 text-slate-400 dark:text-slate-500">{t('common.loading')}</li>
            ) : filtered.length === 0 ? (
              <li className="px-2 py-1 text-slate-400 dark:text-slate-500">{t('combobox.noMatches')}</li>
            ) : (
              filtered.map((item, i) => (
                <li
                  key={item.value}
                  id={`${listboxId}-opt-${i}`}
                  role="option"
                  aria-selected={item.value === value}
                  className={`cursor-pointer px-2 py-1 ${i === active ? 'bg-slate-100 dark:bg-slate-800' : ''}`}
                  onClick={() => choose(item.value)}
                  onMouseEnter={() => setActiveIndex(i)}
                >
                  {item.label}
                </li>
              ))
            )}
          </ul>
          {footerAction !== undefined && (
            <button
              type="button"
              className="w-full border-t border-slate-200 px-2 py-1.5 text-left text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              onClick={() => {
                close();
                footerAction.onClick();
              }}
            >
              {footerAction.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
