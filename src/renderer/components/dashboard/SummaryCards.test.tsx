import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SummaryCards } from './SummaryCards';

describe('SummaryCards', () => {
  it('renders account total, bucket total, and the provider split', () => {
    render(
      <SummaryCards
        accountCount={3}
        bucketCount={5}
        providerAccountCounts={[
          { provider: 'amazon-s3', count: 2 },
          { provider: 'hetzner', count: 1 },
        ]}
      />,
    );
    expect(screen.getByText('Accounts')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('Buckets')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('Amazon S3 · 2')).toBeInTheDocument();
    expect(screen.getByText('Hetzner Object Storage · 1')).toBeInTheDocument();
  });
});
