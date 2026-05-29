import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider, useToast } from './ToastProvider';

function Trigger() {
  const { show } = useToast();
  return (
    <button type="button" onClick={() => show('Saved!', 'success')}>
      go
    </button>
  );
}

describe('ToastProvider', () => {
  it('shows a toast message when show() is called', async () => {
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'go' }));
    expect(await screen.findByText('Saved!')).toBeInTheDocument();
  });

  it('useToast outside a provider is a no-op (does not throw)', async () => {
    render(<Trigger />);
    await userEvent.click(screen.getByRole('button', { name: 'go' }));
    expect(screen.queryByText('Saved!')).not.toBeInTheDocument();
  });
});
