import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
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

  describe('nested modals', () => {
    function Nested({ showInner, outerDismiss, innerDismiss }: { showInner: boolean; outerDismiss: () => void; innerDismiss: () => void }): ReactNode {
      return (
        <Modal onDismiss={outerDismiss}>
          outer
          {showInner && <Modal onDismiss={innerDismiss}>inner</Modal>}
        </Modal>
      );
    }

    it('dismisses only the top-most modal on Escape, then the next one once it is gone', async () => {
      const outer = vi.fn();
      const inner = vi.fn();
      const { rerender } = render(<Nested showInner outerDismiss={outer} innerDismiss={inner} />);

      await userEvent.keyboard('{Escape}');
      expect(inner).toHaveBeenCalledTimes(1);
      expect(outer).not.toHaveBeenCalled();

      rerender(<Nested showInner={false} outerDismiss={outer} innerDismiss={inner} />);
      await userEvent.keyboard('{Escape}');
      expect(outer).toHaveBeenCalledTimes(1);
      expect(inner).toHaveBeenCalledTimes(1);
    });

    it('treats a modal opened later inside an already open one as the top-most', async () => {
      const outer = vi.fn();
      const inner = vi.fn();
      const { rerender } = render(<Nested showInner={false} outerDismiss={outer} innerDismiss={inner} />);
      rerender(<Nested showInner outerDismiss={outer} innerDismiss={inner} />);

      await userEvent.keyboard('{Escape}');
      expect(inner).toHaveBeenCalledTimes(1);
      expect(outer).not.toHaveBeenCalled();
    });

    it('keeps the stack order when the outer modal gets a new onDismiss while the inner one is open', async () => {
      const outer = vi.fn();
      const inner = vi.fn();
      const { rerender } = render(<Nested showInner outerDismiss={() => outer()} innerDismiss={inner} />);
      rerender(<Nested showInner outerDismiss={() => outer()} innerDismiss={inner} />);

      await userEvent.keyboard('{Escape}');
      expect(inner).toHaveBeenCalledTimes(1);
      expect(outer).not.toHaveBeenCalled();
    });
  });
});
