import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LicensesList, type LicenseEntry } from './LicensesList';

const FIXTURE: LicenseEntry[] = [
  { name: 'react', version: '19.2.0', license: 'MIT', repository: 'https://github.com/facebook/react' },
  { name: '@aws-sdk/client-s3', version: '3.500.0', license: 'Apache-2.0', repository: 'https://github.com/aws/aws-sdk-js-v3' },
  { name: 'no-repo-pkg', version: '1.0.0', license: 'ISC', repository: null },
];

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = { openExternal: vi.fn().mockResolvedValue({ ok: true, data: true }) };
});

describe('LicensesList', () => {
  it('renders a row per package', () => {
    render(<LicensesList licenses={FIXTURE} />);
    expect(screen.getByText('react')).toBeInTheDocument();
    expect(screen.getByText('@aws-sdk/client-s3')).toBeInTheDocument();
    expect(screen.getByText('Apache-2.0')).toBeInTheDocument();
  });

  it('filters by name, case-insensitive', async () => {
    render(<LicensesList licenses={FIXTURE} />);
    await userEvent.type(screen.getByPlaceholderText('Filter packages…'), 'AWS');
    expect(screen.getByText('@aws-sdk/client-s3')).toBeInTheDocument();
    expect(screen.queryByText('react')).not.toBeInTheDocument();
  });

  it('shows an empty state when nothing matches', async () => {
    render(<LicensesList licenses={FIXTURE} />);
    await userEvent.type(screen.getByPlaceholderText('Filter packages…'), 'zzzzz');
    expect(screen.getByText('No packages match.')).toBeInTheDocument();
  });

  it('opens the repository externally when a linked name is clicked', async () => {
    render(<LicensesList licenses={FIXTURE} />);
    await userEvent.click(screen.getByRole('button', { name: 'react' }));
    expect(window.s3.openExternal).toHaveBeenCalledWith('https://github.com/facebook/react');
  });

  it('renders names without a repository as plain text', () => {
    render(<LicensesList licenses={FIXTURE} />);
    expect(screen.queryByRole('button', { name: 'no-repo-pkg' })).not.toBeInTheDocument();
    expect(screen.getByText('no-repo-pkg')).toBeInTheDocument();
  });
});
