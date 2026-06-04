export type Section =
  | 'files'
  | 'dashboard'
  | 'objectLock'
  | 'cors'
  | 'sync'
  | 'settings'
  | 'connections';

const PRIMARY: { id: Section; label: string }[] = [
  { id: 'files', label: 'Files' },
  { id: 'objectLock', label: 'Object Lock' },
  { id: 'cors', label: 'CORS' },
  { id: 'sync', label: 'Sync' },
];

const SECONDARY: { id: Section; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'settings', label: 'Settings' },
];

export function SectionNav({
  active,
  onSelect,
}: {
  active: Section;
  onSelect: (section: Section) => void;
}) {
  const renderItem = (s: { id: Section; label: string }) => {
    const isActive = s.id === active;
    return (
      <button
        key={s.id}
        type="button"
        aria-current={isActive ? 'page' : undefined}
        onClick={() => onSelect(s.id)}
        className={`rounded px-2 py-1.5 text-left ${
          isActive ? 'bg-slate-200 font-medium' : 'hover:bg-slate-100'
        }`}
      >
        {s.label}
      </button>
    );
  };

  return (
    <nav className="flex flex-col gap-1">
      {PRIMARY.map(renderItem)}
      <div role="separator" className="my-1 border-t border-slate-200" />
      {SECONDARY.map(renderItem)}
    </nav>
  );
}
