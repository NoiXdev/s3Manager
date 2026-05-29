export type Section = 'files' | 'dashboard' | 'objectLock' | 'cors' | 'settings';

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'files', label: 'Files' },
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'objectLock', label: 'Object Lock' },
  { id: 'cors', label: 'CORS' },
  { id: 'settings', label: 'Settings' },
];

export function SectionNav({
  active,
  onSelect,
}: {
  active: Section;
  onSelect: (section: Section) => void;
}) {
  return (
    <nav className="flex flex-col gap-1">
      {SECTIONS.map((s) => {
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
      })}
    </nav>
  );
}
