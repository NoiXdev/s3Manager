import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SectionNav, type Section } from './SectionNav';

describe('SectionNav', () => {
  it('renders all sections including Accounts and marks the active one', () => {
    render(<SectionNav active="dashboard" onSelect={() => {}} />);
    for (const label of ['Dashboard', 'Files', 'Object Lock', 'CORS', 'Sync', 'Settings', 'Accounts']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
  });

  it('orders items Dashboard first, then S3 tools, then Settings and Accounts', () => {
    render(<SectionNav active="dashboard" onSelect={() => {}} />);
    const labels = screen.getAllByRole('button').map((b) => b.textContent);
    expect(labels).toEqual(['Dashboard', 'Files', 'Object Lock', 'CORS', 'Sync', 'Settings', 'Accounts']);
  });

  it('renders a divider between the primary and secondary groups', () => {
    render(<SectionNav active="files" onSelect={() => {}} />);
    expect(screen.getByRole('separator')).toBeInTheDocument();
  });

  it('routes the Accounts item to the connections section', async () => {
    const onSelect = vi.fn();
    render(<SectionNav active="dashboard" onSelect={onSelect} />);
    await userEvent.click(screen.getByRole('button', { name: 'Accounts' }));
    expect(onSelect).toHaveBeenCalledWith('connections' satisfies Section);
  });

  it('calls onSelect with the section id when clicked', async () => {
    const onSelect = vi.fn();
    render(<SectionNav active="dashboard" onSelect={onSelect} />);
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(onSelect).toHaveBeenCalledWith('settings' satisfies Section);
  });
});
