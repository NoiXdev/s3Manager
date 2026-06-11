import { useMemo, useState } from 'react';

export interface LicenseEntry {
  name: string;
  version: string;
  license: string;
  repository: string | null;
}

export function LicensesList({ licenses }: { licenses: LicenseEntry[] }) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return licenses;
    return licenses.filter((l) => l.name.toLowerCase().includes(q));
  }, [licenses, query]);

  return (
    <div className="mt-2">
      <input
        type="search"
        aria-label="Filter packages"
        placeholder="Filter packages…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="mb-2 block w-full rounded border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 px-2 py-1 text-sm"
      />
      {filtered.length === 0 ? (
        <p className="py-2 text-slate-500 dark:text-slate-400">No packages match.</p>
      ) : (
        <ul className="max-h-80 overflow-auto rounded border border-slate-100 dark:border-slate-800">
          {filtered.map((l) => {
            const repo = l.repository;
            return (
            <li
              key={`${l.name}@${l.version}`}
              className="flex items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 px-2 py-1.5 last:border-b-0"
            >
              <span className="truncate">
                {repo ? (
                  <button
                    type="button"
                    onClick={() => void window.s3.openExternal(repo)}
                    className="text-sky-700 hover:underline"
                  >
                    {l.name}
                  </button>
                ) : (
                  <span className="text-slate-800 dark:text-slate-100">{l.name}</span>
                )}
                <span className="pl-1.5 text-slate-400 dark:text-slate-500">{l.version}</span>
              </span>
              <span className="shrink-0 text-slate-500 dark:text-slate-400">{l.license}</span>
            </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
