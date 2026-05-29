import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SectionNav, type Section } from './SectionNav';

describe('SectionNav', () => {
  it('renders all sections and marks the active one', () => {
    render(<SectionNav active="files" onSelect={() => {}} />);
    for (const label of ['Files', 'Dashboard', 'Object Lock', 'CORS', 'Settings']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Files' })).toHaveAttribute('aria-current', 'page');
  });

  it('calls onSelect with the section id when clicked', async () => {
    const onSelect = vi.fn();
    render(<SectionNav active="files" onSelect={onSelect} />);
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(onSelect).toHaveBeenCalledWith('settings' satisfies Section);
  });
});
