import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Breadcrumb } from './Breadcrumb';

describe('Breadcrumb', () => {
  it('renders root plus each segment and navigates on click', async () => {
    const onNavigate = vi.fn();
    render(<Breadcrumb prefix="images/thumbs/" onNavigate={onNavigate} />);
    expect(screen.getByRole('button', { name: 'root' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'images' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'thumbs' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'images' }));
    expect(onNavigate).toHaveBeenCalledWith('images/');
  });
});
