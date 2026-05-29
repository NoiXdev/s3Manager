import type { ProviderId } from '../../../main/s3/providers';
import { UI_PROVIDERS } from '../../lib/providers';

function Card({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded border border-slate-200 bg-white p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

export function SummaryCards({
  accountCount,
  bucketCount,
  providerAccountCounts,
}: {
  accountCount: number;
  bucketCount: number;
  providerAccountCounts: { provider: ProviderId; count: number }[];
}) {
  const label = (p: ProviderId) => UI_PROVIDERS.find((x) => x.id === p)?.label ?? p;

  return (
    <div className="grid grid-cols-3 gap-3">
      <Card label="Accounts">
        <span className="text-2xl font-semibold">{accountCount}</span>
      </Card>
      <Card label="Buckets">
        <span className="text-2xl font-semibold">{bucketCount}</span>
      </Card>
      <Card label="Providers">
        <ul className="text-sm text-slate-700">
          {providerAccountCounts.map((pc) => (
            <li key={pc.provider}>
              {label(pc.provider)} · {pc.count}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
