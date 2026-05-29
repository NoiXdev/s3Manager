import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DropZone } from './DropZone';

describe('DropZone', () => {
  it('shows the overlay on drag-over and hides it on drag-leave', () => {
    render(
      <DropZone onDropFiles={() => {}}>
        <p>content</p>
      </DropZone>,
    );
    const zone = screen.getByTestId('dropzone');
    expect(screen.queryByText('Drop files to upload')).not.toBeInTheDocument();
    fireEvent.dragOver(zone, { dataTransfer: { types: ['Files'] } });
    expect(screen.getByText('Drop files to upload')).toBeInTheDocument();
    fireEvent.dragLeave(zone);
    expect(screen.queryByText('Drop files to upload')).not.toBeInTheDocument();
  });

  it('calls onDropFiles with the dropped files', () => {
    const onDropFiles = vi.fn();
    render(
      <DropZone onDropFiles={onDropFiles}>
        <p>content</p>
      </DropZone>,
    );
    const file = new File(['x'], 'a.txt');
    fireEvent.drop(screen.getByTestId('dropzone'), { dataTransfer: { files: [file], types: ['Files'] } });
    expect(onDropFiles).toHaveBeenCalledWith([file]);
  });
});
