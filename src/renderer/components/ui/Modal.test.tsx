import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
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

    it('does not dismiss the outer modal too when the inner one unmounts itself on Escape', async () => {
      // The inner modal's own Escape listener unmounts it synchronously, which pops it off the stack
      // before the outer modal's listener runs. The outer one must still see that Escape as handled.
      const outer = vi.fn();
      function Stateful({ outerDismiss }: { outerDismiss: () => void }) {
        const [showInner, setShowInner] = useState(true);
        return (
          <Modal onDismiss={outerDismiss}>
            outer
            {showInner && <Modal onDismiss={() => flushSync(() => setShowInner(false))}>inner</Modal>}
          </Modal>
        );
      }
      // A fresh onDismiss re-subscribes the outer listener after the inner one, so it runs second.
      const { rerender } = render(<Stateful outerDismiss={() => outer()} />);
      rerender(<Stateful outerDismiss={() => outer()} />);
      expect(screen.getByText('inner')).toBeInTheDocument();

      await userEvent.keyboard('{Escape}');
      expect(screen.queryByText('inner')).not.toBeInTheDocument();
      expect(outer).not.toHaveBeenCalled();

      await userEvent.keyboard('{Escape}');
      expect(outer).toHaveBeenCalledTimes(1);
    });
  });
});
