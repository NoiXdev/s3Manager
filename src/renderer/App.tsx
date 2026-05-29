import { useState } from 'react';
import { SectionNav, type Section } from './components/SectionNav';
import { AccountsPane } from './components/accounts/AccountsPane';

export function App() {
  const [section, setSection] = useState<Section>('files');
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);

  return (
    <div className="flex h-full text-sm text-slate-800">
      <aside className="w-48 shrink-0 border-r border-slate-200 bg-slate-50 p-3">
        <h1 className="px-2 pb-3 text-base font-semibold">S3 Manager</h1>
        <SectionNav active={section} onSelect={setSection} />
      </aside>

      <main className="flex-1 overflow-hidden">
        {section === 'files' ? (
          <div className="flex h-full">
            <div className="w-60 shrink-0 border-r border-slate-200">
              <AccountsPane selectedId={selectedAccountId} onSelect={setSelectedAccountId} />
            </div>
            <div className="w-64 shrink-0 border-r border-slate-200 p-3 text-slate-400">
              Buckets (Plan 2b)
            </div>
            <div className="flex-1 p-3 text-slate-400">File browser (Plan 2b)</div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-slate-400">Coming soon</div>
        )}
      </main>
    </div>
  );
}
