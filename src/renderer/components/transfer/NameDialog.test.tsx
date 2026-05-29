import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NameDialog } from './NameDialog';

describe('NameDialog', () => {
  it('emits the trimmed name on confirm', async () => {
    const onConfirm = vi.fn();
    render(<NameDialog title="New folder" initialValue="" confirmLabel="Create" onConfirm={onConfirm} onCancel={() => {}} />);
    await userEvent.type(screen.getByLabelText('Name'), '  reports  ');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(onConfirm).toHaveBeenCalledWith('reports');
  });

  it('disables confirm for empty and slash-containing names', async () => {
    render(<NameDialog title="Rename" initialValue="logo.png" confirmLabel="Rename" onConfirm={() => {}} onCancel={() => {}} />);
    const confirm = screen.getByRole('button', { name: 'Rename' });
    expect(confirm).toBeEnabled();
    const input = screen.getByLabelText('Name');
    await userEvent.clear(input);
    expect(confirm).toBeDisabled();
    await userEvent.type(input, 'a/b');
    expect(confirm).toBeDisabled();
  });
});
