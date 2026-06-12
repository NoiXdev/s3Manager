import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Combobox } from './Combobox';

const items = [
  { value: 'a1', label: 'AWS prod (Amazon S3)' },
  { value: 'a2', label: 'Hetzner backup (Hetzner)' },
  { value: 'a3', label: 'MinIO lab (Custom)' },
];

function renderBox(over: Partial<Parameters<typeof Combobox>[0]> = {}) {
  return render(
    <Combobox
      items={items}
      value={null}
      onSelect={() => {}}
      placeholder="Select account"
      ariaLabel="Account"
      {...over}
    />,
  );
}

describe('Combobox', () => {
  it('shows the placeholder when nothing is selected and no list', () => {
    renderBox();
    expect(screen.getByLabelText('Account')).toHaveTextContent('Select account');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('shows the selected item label on the trigger', () => {
    renderBox({ value: 'a2' });
    expect(screen.getByLabelText('Account')).toHaveTextContent('Hetzner backup (Hetzner)');
  });

  it('opens on trigger click and lists all items', async () => {
    renderBox();
    await userEvent.click(screen.getByLabelText('Account'));
    expect(screen.getAllByRole('option')).toHaveLength(3);
  });

  it('filters items by search text, case-insensitive', async () => {
    renderBox();
    await userEvent.click(screen.getByLabelText('Account'));
    await userEvent.type(screen.getByRole('searchbox'), 'hetz');
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.getByRole('option', { name: 'Hetzner backup (Hetzner)' })).toBeInTheDocument();
  });

  it('shows a no-matches hint when the search has no results', async () => {
    renderBox();
    await userEvent.click(screen.getByLabelText('Account'));
    await userEvent.type(screen.getByRole('searchbox'), 'zzz');
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByText('No matches')).toBeInTheDocument();
  });

  it('selects an item by click, closes, and reports the value', async () => {
    const onSelect = vi.fn();
    renderBox({ onSelect });
    await userEvent.click(screen.getByLabelText('Account'));
    await userEvent.click(screen.getByRole('option', { name: 'AWS prod (Amazon S3)' }));
    expect(onSelect).toHaveBeenCalledWith('a1');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('selects with the keyboard: ArrowDown + Enter', async () => {
    const onSelect = vi.fn();
    renderBox({ onSelect });
    await userEvent.click(screen.getByLabelText('Account'));
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(onSelect).toHaveBeenCalledWith('a2');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('closes on Escape without selecting', async () => {
    const onSelect = vi.fn();
    renderBox({ onSelect });
    await userEvent.click(screen.getByLabelText('Account'));
    await userEvent.keyboard('{Escape}');
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('renders the footer action even with zero matches and fires it', async () => {
    const onAdd = vi.fn();
    renderBox({ footerAction: { label: '+ Add account', onClick: onAdd } });
    await userEvent.click(screen.getByLabelText('Account'));
    await userEvent.type(screen.getByRole('searchbox'), 'zzz');
    await userEvent.click(screen.getByRole('button', { name: '+ Add account' }));
    expect(onAdd).toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('is disabled via the disabled prop', () => {
    renderBox({ disabled: true });
    expect(screen.getByLabelText('Account')).toBeDisabled();
  });

  it('shows a loading row in the open panel', async () => {
    renderBox({ items: [], loading: true });
    await userEvent.click(screen.getByLabelText('Account'));
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('closes on outside mousedown', async () => {
    renderBox();
    await userEvent.click(screen.getByLabelText('Account'));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await userEvent.click(document.body);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('closes on Tab without selecting', async () => {
    const onSelect = vi.fn();
    renderBox({ onSelect });
    await userEvent.click(screen.getByLabelText('Account'));
    await userEvent.keyboard('{Tab}');
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('keyboard on an empty result list does not crash or select', async () => {
    const onSelect = vi.fn();
    renderBox({ onSelect });
    await userEvent.click(screen.getByLabelText('Account'));
    await userEvent.type(screen.getByRole('searchbox'), 'zzz');
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('shows the loading row even when stale items exist', async () => {
    renderBox({ loading: true });
    await userEvent.click(screen.getByLabelText('Account'));
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });

  it('returns focus to the trigger after selecting', async () => {
    renderBox({ onSelect: () => {} });
    await userEvent.click(screen.getByLabelText('Account'));
    await userEvent.click(screen.getByRole('option', { name: 'AWS prod (Amazon S3)' }));
    expect(screen.getByLabelText('Account')).toHaveFocus();
  });

  it('re-selecting the current value closes without firing onSelect', async () => {
    const onSelect = vi.fn();
    renderBox({ value: 'a1', onSelect });
    await userEvent.click(screen.getByLabelText('Account'));
    await userEvent.click(screen.getByRole('option', { name: 'AWS prod (Amazon S3)' }));
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
