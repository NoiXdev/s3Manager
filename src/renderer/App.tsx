import { useState } from 'react';
import { SectionNav, type Section } from './components/SectionNav';
import { AccountSelect } from './components/accounts/AccountSelect';
import { BucketSelect } from './components/buckets/BucketSelect';
import { ConnectionsScreen } from './components/connections/ConnectionsScreen';
import { FileBrowser } from './components/files/FileBrowser';
import { MetadataPanel } from './components/files/MetadataPanel';
import { ToastProvider } from './components/ui/ToastProvider';
import { Dashboard } from './components/dashboard/Dashboard';
import { CorsEditor } from './components/cors/CorsEditor';
import { ObjectLockEditor } from './components/objectlock/ObjectLockEditor';
import { SyncSection } from './components/sync/SyncSection';
import { SyncRunProvider } from './components/sync/SyncRunProvider';
import { SyncStatus } from './components/sync/SyncStatus';
import { SettingsScreen } from './components/settings/SettingsScreen';

// Sections whose work targets the single account/bucket chosen in the sidebar.
const SELECTOR_SECTIONS: Section[] = ['files', 'cors', 'objectLock'];

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

  const showSelectors = SELECTOR_SECTIONS.includes(section);

  return (
    <ToastProvider>
      <SyncRunProvider>
      <div className="flex h-full text-sm text-slate-800">
        <aside className="flex w-48 shrink-0 flex-col border-r border-slate-200 bg-slate-50 p-3">
          <h1 className="px-2 pb-3 text-base font-semibold">S3 Manager</h1>

          {showSelectors && (
            <div className="flex flex-col gap-2 px-2 pb-3">
              <AccountSelect selectedId={accountId} onSelect={selectAccount} />
              <BucketSelect accountId={accountId} selectedBucket={bucket} onSelect={selectBucket} />
            </div>
          )}

          <button
            type="button"
            onClick={() => setSection('connections')}
            aria-current={section === 'connections' ? 'page' : undefined}
            className={`mb-3 rounded px-2 py-1.5 text-left ${
              section === 'connections' ? 'bg-slate-200 font-medium' : 'hover:bg-slate-100'
            }`}
          >
            Manage connections
          </button>

          <SectionNav active={section} onSelect={goToSection} />
          <SyncStatus onOpen={() => goToSection('sync')} />
          <p className="mt-auto px-2 pt-3 text-xs text-slate-400">
            © {new Date().getFullYear()} S3 Manager
          </p>
        </aside>

        <main className="flex-1 overflow-hidden">
          {section === 'files' ? (
            <div className="flex h-full">
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
          ) : section === 'connections' ? (
            <ConnectionsScreen
              onAccountRemoved={(id) => {
                if (id === accountId) {
                  setAccountId(null);
                  setBucket(null);
                  setPrefix('');
                  setSelectedKey(null);
                }
              }}
            />
          ) : section === 'dashboard' ? (
            <Dashboard
              onOpenAccount={(id) => openInFiles(id, null)}
              onOpenBucket={(id, b) => openInFiles(id, b)}
            />
          ) : section === 'cors' ? (
            <CorsEditor accountId={accountId} bucket={bucket} />
          ) : section === 'objectLock' ? (
            <ObjectLockEditor accountId={accountId} bucket={bucket} />
          ) : section === 'sync' ? null : section === 'settings' ? (
            <SettingsScreen />
          ) : (
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
      </SyncRunProvider>
    </ToastProvider>
  );
}
