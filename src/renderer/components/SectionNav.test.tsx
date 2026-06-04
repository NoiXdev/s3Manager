import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SectionNav, type Section } from './SectionNav';

describe('SectionNav', () => {
  it('renders the menu sections and marks the active one', () => {
    render(<SectionNav active="files" onSelect={() => {}} />);
    for (const label of ['Files', 'Object Lock', 'CORS', 'Sync', 'Dashboard', 'Settings']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Files' })).toHaveAttribute('aria-current', 'page');
  });

  it('does not render a Connections menu item (reached via the sidebar button)', () => {
    render(<SectionNav active="files" onSelect={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Connections' })).not.toBeInTheDocument();
  });

  it('renders a divider between primary and secondary groups', () => {
    render(<SectionNav active="files" onSelect={() => {}} />);
    expect(screen.getByRole('separator')).toBeInTheDocument();
  });

  it('calls onSelect with the section id when clicked', async () => {
    const onSelect = vi.fn();
    render(<SectionNav active="files" onSelect={onSelect} />);
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(onSelect).toHaveBeenCalledWith('settings' satisfies Section);
  });
});
