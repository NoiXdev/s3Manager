import { useState } from 'react';
import { SectionNav, type Section } from './components/SectionNav';
import { AccountsPane } from './components/accounts/AccountsPane';
import { BucketsPane } from './components/buckets/BucketsPane';
import { FileBrowser } from './components/files/FileBrowser';
import { MetadataPanel } from './components/files/MetadataPanel';
import { ToastProvider } from './components/ui/ToastProvider';
import { Dashboard } from './components/dashboard/Dashboard';
import { CorsEditor } from './components/cors/CorsEditor';
import { ObjectLockEditor } from './components/objectlock/ObjectLockEditor';
import { SyncSection } from './components/sync/SyncSection';

export function App() {
  const [section, setSection] = useState<Section>('files');
  const [accountId, setAccountId] = useState<string | null>(null);
  const [bucket, setBucket] = useState<string | null>(null);
  const [prefix, setPrefix] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // Once Sync is opened, keep it mounted (hidden when inactive) so an in-flight
  // sync's progress/result and active sub-tab survive navigating to other sections.
  const [syncVisited, setSyncVisited] = useState(false);

  const goToSection = (s: Section) => {
    setSection(s);
    if (s === 'sync') setSyncVisited(true);
  };

  const selectAccount = (id: string) => {
    setAccountId(id);
    setBucket(null);
    setPrefix('');
    setSelectedKey(null);
  };
  const selectBucket = (b: string) => {
    setBucket(b);
    setPrefix('');
    setSelectedKey(null);
  };
  const navigate = (p: string) => {
    setPrefix(p);
    setSelectedKey(null);
  };
  const openInFiles = (id: string, b: string | null = null) => {
    setAccountId(id);
    setBucket(b);
    setPrefix('');
    setSelectedKey(null);
    setSection('files');
  };

  return (
    <ToastProvider>
      <div className="flex h-full text-sm text-slate-800">
        <aside className="w-48 shrink-0 border-r border-slate-200 bg-slate-50 p-3">
          <h1 className="px-2 pb-3 text-base font-semibold">S3 Manager</h1>
          <SectionNav active={section} onSelect={goToSection} />
        </aside>

        <main className="flex-1 overflow-hidden">
          {section === 'files' ? (
            <div className="flex h-full">
              <div className="w-60 shrink-0 border-r border-slate-200">
                <AccountsPane selectedId={accountId} onSelect={selectAccount} />
              </div>
              <div className="w-56 shrink-0 border-r border-slate-200">
                <BucketsPane accountId={accountId} selectedBucket={bucket} onSelect={selectBucket} />
              </div>
              <div className="flex-1 overflow-hidden">
                <FileBrowser
                  accountId={accountId}
                  bucket={bucket}
                  prefix={prefix}
                  selectedKey={selectedKey}
                  onNavigate={navigate}
                  onSelectFile={setSelectedKey}
                />
              </div>
              {selectedKey !== null && (
                <MetadataPanel
                  accountId={accountId}
                  bucket={bucket}
                  objectKey={selectedKey}
                  onClose={() => setSelectedKey(null)}
                />
              )}
            </div>
          ) : section === 'dashboard' ? (
            <Dashboard
              onOpenAccount={(id) => openInFiles(id, null)}
              onOpenBucket={(id, b) => openInFiles(id, b)}
            />
          ) : section === 'cors' ? (
            <CorsEditor initialAccountId={accountId} initialBucket={bucket} />
          ) : section === 'objectLock' ? (
            <ObjectLockEditor initialAccountId={accountId} initialBucket={bucket} />
          ) : section === 'sync' ? null : (
            <div className="flex h-full items-center justify-center text-slate-400">Coming soon</div>
          )}

          {/* Sync stays mounted once opened (hidden when inactive) so a running
              sync keeps its progress, result, and active sub-tab across navigation. */}
          {syncVisited && (
            <div className={section === 'sync' ? 'h-full' : 'hidden'}>
              <SyncSection initialAccountId={accountId} initialBucket={bucket} />
            </div>
          )}
        </main>
      </div>
    </ToastProvider>
  );
}
