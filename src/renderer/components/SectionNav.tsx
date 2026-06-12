import { useTranslation } from 'react-i18next';

// 'connections' is reached via a standalone sidebar button in App, not rendered as a nav item here.
export type Section =
  | 'files'
  | 'dashboard'
  | 'objectLock'
  | 'cors'
  | 'sync'
  | 'settings'
  | 'connections';

const PRIMARY: { id: Section; key: string }[] = [
  { id: 'files', key: 'nav.files' },
  { id: 'objectLock', key: 'nav.objectLock' },
  { id: 'cors', key: 'nav.cors' },
  { id: 'sync', key: 'nav.sync' },
];

const SECONDARY: { id: Section; key: string }[] = [
  { id: 'dashboard', key: 'nav.dashboard' },
  { id: 'settings', key: 'nav.settings' },
];

export function SectionNav({
  active,
  onSelect,
}: {
  active: Section;
  onSelect: (section: Section) => void;
}) {
  const { t } = useTranslation();
  const renderItem = (s: { id: Section; key: string }) => {
    const isActive = s.id === active;
    return (
      <button
        key={s.id}
        type="button"
        aria-current={isActive ? 'page' : undefined}
        onClick={() => onSelect(s.id)}
        className={`rounded px-2 py-1.5 text-left ${
          isActive ? 'bg-slate-200 font-medium dark:bg-slate-700' : 'hover:bg-slate-100 dark:hover:bg-slate-800'
        }`}
      >
        {t(s.key)}
      </button>
    );
  };

  return (
    <nav className="flex flex-col gap-1">
      {PRIMARY.map(renderItem)}
      <div role="separator" className="my-1 border-t border-slate-200 dark:border-slate-700" />
      {SECONDARY.map(renderItem)}
    </nav>
  );
}
