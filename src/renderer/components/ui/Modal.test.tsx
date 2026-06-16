import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Modal } from './Modal';

describe('Modal', () => {
  it('renders a dialog with the panel content', () => {
    render(<Modal onDismiss={() => {}} className="w-96">hi</Modal>);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('hi')).toBeInTheDocument();
  });

  it('dismisses on Escape', async () => {
    const onDismiss = vi.fn();
    render(<Modal onDismiss={onDismiss}>hi</Modal>);
    await userEvent.keyboard('{Escape}');
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('dismisses on a backdrop click', async () => {
    const onDismiss = vi.fn();
    render(<Modal onDismiss={onDismiss}>hi</Modal>);
    await userEvent.click(screen.getByRole('dialog'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('does not dismiss when clicking inside the panel', async () => {
    const onDismiss = vi.fn();
    render(<Modal onDismiss={onDismiss}><button type="button">inside</button></Modal>);
    await userEvent.click(screen.getByText('inside'));
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
