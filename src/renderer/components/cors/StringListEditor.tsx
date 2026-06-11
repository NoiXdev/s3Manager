import { useId, useState } from 'react';
import { FiTrash2 } from 'react-icons/fi';

export function StringListEditor({
  label,
  values,
  onChange,
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
}) {
  const [draft, setDraft] = useState('');
  const inputId = useId();

  const add = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onChange([...values, trimmed]);
    setDraft('');
  };

  return (
    <div className="mt-2">
      <div className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</div>
      <ul className="mt-1 flex flex-wrap gap-1">
        {values.map((value, i) => (
          <li key={`${value}-${i}`} className="flex items-center gap-1 rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-xs">
            {value}
            <button
              type="button"
              aria-label={`Remove ${value}`}
              className="text-slate-400 dark:text-slate-500 hover:text-red-600"
              onClick={() => onChange(values.filter((_, j) => j !== i))}
            >
              <FiTrash2 className="h-3.5 w-3.5" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-1 flex gap-1">
        <label htmlFor={inputId} className="sr-only">{`Add to ${label}`}</label>
        <input
          id={inputId}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="rounded border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 px-2 py-0.5 text-xs"
        />
        <button
          type="button"
          className="rounded border border-slate-300 dark:border-slate-700 px-2 py-0.5 text-xs hover:bg-slate-50 dark:hover:bg-slate-800"
          onClick={add}
        >
          <span className="sr-only">{`Add to ${label}`}</span>
          <span aria-hidden="true">Add</span>
        </button>
      </div>
    </div>
  );
}
