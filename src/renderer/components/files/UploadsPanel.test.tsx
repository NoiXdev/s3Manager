import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UploadsPanel } from './UploadsPanel';
import type { UploadItem } from '../../hooks/useUploads';

const items: UploadItem[] = [
  { id: '1', name: 'a.txt', status: 'uploading', loaded: 50, total: 100 },
  { id: '2', name: 'b.txt', status: 'done', loaded: 10, total: 10 },
];

describe('UploadsPanel', () => {
  it('renders nothing when there are no items', () => {
    const { container } = render(<UploadsPanel items={[]} onClear={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('lists upload items with names and status', () => {
    render(<UploadsPanel items={items} onClear={() => {}} />);
    expect(screen.getByText('a.txt')).toBeInTheDocument();
    expect(screen.getByText('b.txt')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();
  });

  it('calls onClear when Clear finished is clicked', async () => {
    const onClear = vi.fn();
    render(<UploadsPanel items={items} onClear={onClear} />);
    await userEvent.click(screen.getByRole('button', { name: 'Clear finished' }));
    expect(onClear).toHaveBeenCalled();
  });
});
