import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StringListEditor } from './StringListEditor';

describe('StringListEditor', () => {
  it('adds a trimmed entry via the input + Add button', async () => {
    const onChange = vi.fn();
    render(<StringListEditor label="Allowed origins" values={['*']} onChange={onChange} />);
    await userEvent.type(screen.getByLabelText('Add to Allowed origins'), '  https://x  ');
    await userEvent.click(screen.getByRole('button', { name: 'Add to Allowed origins' }));
    expect(onChange).toHaveBeenCalledWith(['*', 'https://x']);
  });

  it('removes an entry', async () => {
    const onChange = vi.fn();
    render(<StringListEditor label="Allowed origins" values={['*', 'https://x']} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove https://x' }));
    expect(onChange).toHaveBeenCalledWith(['*']);
  });
});
