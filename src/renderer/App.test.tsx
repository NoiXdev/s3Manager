import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = {
    accounts: { list: vi.fn().mockResolvedValue({ ok: true, data: [] }) },
  };
});

function renderApp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  );
}

describe('App', () => {
  it('renders the shell with the product name and Files section active by default', async () => {
    renderApp();
    expect(screen.getByText('S3 Manager')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Files' })).toHaveAttribute('aria-current', 'page');
    expect(await screen.findByText('No accounts yet')).toBeInTheDocument();
  });

  it('switches to a placeholder section', async () => {
    renderApp();
    await userEvent.click(screen.getByRole('button', { name: 'CORS' }));
    expect(screen.getByText('Coming soon')).toBeInTheDocument();
  });
});
