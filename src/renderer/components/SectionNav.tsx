import { useTranslation } from 'react-i18next';
import type { IconType } from 'react-icons';
import { FiGrid, FiFolder, FiLock, FiGlobe, FiRefreshCw, FiSettings, FiUsers } from 'react-icons/fi';

export type Section =
  | 'files'
  | 'dashboard'
  | 'objectLock'
  | 'cors'
  | 'sync'
  | 'settings'
  | 'connections';

type NavItem = { id: Section; key: string; icon: IconType };

const PRIMARY: NavItem[] = [
  { id: 'dashboard', key: 'nav.dashboard', icon: FiGrid },
  { id: 'files', key: 'nav.files', icon: FiFolder },
  { id: 'objectLock', key: 'nav.objectLock', icon: FiLock },
  { id: 'cors', key: 'nav.cors', icon: FiGlobe },
  { id: 'sync', key: 'nav.sync', icon: FiRefreshCw },
];

const SECONDARY: NavItem[] = [
  { id: 'settings', key: 'nav.settings', icon: FiSettings },
  { id: 'connections', key: 'nav.accounts', icon: FiUsers },
];

export function SectionNav({
  active,
  onSelect,
}: {
  active: Section;
  onSelect: (section: Section) => void;
}) {
  const { t } = useTranslation();
  const renderItem = (s: NavItem) => {
    const isActive = s.id === active;
    const Icon = s.icon;
    return (
      <button
        key={s.id}
        type="button"
        aria-current={isActive ? 'page' : undefined}
        onClick={() => onSelect(s.id)}
        className={`flex items-center gap-2 rounded px-2 py-1.5 text-left ${
          isActive ? 'bg-slate-200 font-medium dark:bg-slate-700' : 'hover:bg-slate-100 dark:hover:bg-slate-800'
        }`}
      >
        <Icon className="h-4 w-4 shrink-0" aria-hidden />
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
