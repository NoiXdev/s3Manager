import { useTranslation } from 'react-i18next';
import { FiTrash2 } from 'react-icons/fi';
import type { CorsRule } from '../../../main/s3/cors';
import { StringListEditor } from './StringListEditor';

const METHODS = ['GET', 'PUT', 'POST', 'DELETE', 'HEAD'] as const;

export function CorsRuleCard({
  rule,
  onChange,
  onRemove,
}: {
  rule: CorsRule;
  onChange: (rule: CorsRule) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const toggleMethod = (m: string) => {
    const has = rule.allowedMethods.includes(m);
    onChange({
      ...rule,
      allowedMethods: has ? rule.allowedMethods.filter((x) => x !== m) : [...rule.allowedMethods, m],
    });
  };

  return (
    <div className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{t('cors.rule.label')}</span>
        <button type="button" aria-label={t('cors.rule.removeAria')} className="text-slate-400 dark:text-slate-500 hover:text-red-600 dark:hover:text-red-400" onClick={onRemove}>
          <FiTrash2 className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <div className="mt-2 flex flex-wrap gap-3 text-sm">
        {METHODS.map((m) => (
          <label key={m} className="flex items-center gap-1">
            <input type="checkbox" checked={rule.allowedMethods.includes(m)} onChange={() => toggleMethod(m)} />
            {m}
          </label>
        ))}
      </div>

      <StringListEditor label={t('cors.rule.allowedOrigins')} values={rule.allowedOrigins} onChange={(v) => onChange({ ...rule, allowedOrigins: v })} />
      <StringListEditor label={t('cors.rule.allowedHeaders')} values={rule.allowedHeaders} onChange={(v) => onChange({ ...rule, allowedHeaders: v })} />
      <StringListEditor label={t('cors.rule.exposeHeaders')} values={rule.exposeHeaders} onChange={(v) => onChange({ ...rule, exposeHeaders: v })} />

      <label className="mt-2 block text-sm">
        {t('cors.rule.maxAge')}
        <input
          type="number"
          className="mt-1 block w-40 rounded border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 px-2 py-1"
          value={rule.maxAgeSeconds ?? ''}
          onChange={(e) => onChange({ ...rule, maxAgeSeconds: e.target.value === '' ? null : Number(e.target.value) })}
        />
      </label>
    </div>
  );
}
