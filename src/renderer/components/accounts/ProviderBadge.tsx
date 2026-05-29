import type { ProviderId } from '../../../main/s3/providers';
import { UI_PROVIDERS } from '../../lib/providers';

export function ProviderBadge({ provider }: { provider: ProviderId }) {
  const label = UI_PROVIDERS.find((p) => p.id === provider)?.label ?? provider;
  return (
    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{label}</span>
  );
}
