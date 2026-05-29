import { Fragment } from 'react';
import { prefixToBreadcrumb } from '../../../main/s3/listTransform';

export function Breadcrumb({
  prefix,
  onNavigate,
}: {
  prefix: string;
  onNavigate: (prefix: string) => void;
}) {
  const crumbs = prefixToBreadcrumb(prefix);
  return (
    <nav className="flex flex-wrap items-center gap-1 text-slate-600">
      {crumbs.map((crumb, i) => (
        <Fragment key={crumb.prefix}>
          {i > 0 && <span className="text-slate-300">/</span>}
          <button
            type="button"
            onClick={() => onNavigate(crumb.prefix)}
            className="rounded px-1 hover:bg-slate-100"
          >
            {crumb.label}
          </button>
        </Fragment>
      ))}
    </nav>
  );
}
