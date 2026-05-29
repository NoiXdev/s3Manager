export function App() {
  return (
    <div className="flex h-full text-sm text-slate-800">
      <aside className="w-48 shrink-0 border-r border-slate-200 bg-slate-50 p-3">
        <h1 className="px-2 pb-3 text-base font-semibold">S3 Manager</h1>
      </aside>
      <main className="flex-1 overflow-auto p-4">Select a section</main>
    </div>
  );
}
