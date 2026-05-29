import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProviderBadge } from './ProviderBadge';

describe('ProviderBadge', () => {
  it('shows the human label for a provider id', () => {
    render(<ProviderBadge provider="hetzner" />);
    expect(screen.getByText('Hetzner Object Storage')).toBeInTheDocument();
  });

  it('falls back to the raw id for an unknown provider', () => {
    render(<ProviderBadge provider={'gcs' as never} />);
    expect(screen.getByText('gcs')).toBeInTheDocument();
  });
});
