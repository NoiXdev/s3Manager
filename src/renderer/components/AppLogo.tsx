export function AppLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 120 120"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="appLogoGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#0EA5E9" />
          <stop offset="1" stopColor="#6366F1" />
        </linearGradient>
      </defs>
      <rect x="6" y="6" width="108" height="108" rx="28" fill="url(#appLogoGrad)" />
      <rect x="30" y="38" width="60" height="14" rx="7" fill="#FFFFFF" fillOpacity="0.96" />
      <rect x="30" y="60" width="60" height="14" rx="7" fill="#FFFFFF" fillOpacity="0.80" />
      <rect x="30" y="82" width="60" height="14" rx="7" fill="#FFFFFF" fillOpacity="0.64" />
      <circle cx="82" cy="45" r="4.5" fill="#F59E0B" />
    </svg>
  );
}
