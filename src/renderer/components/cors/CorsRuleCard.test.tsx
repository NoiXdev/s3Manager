import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CorsRuleCard } from './CorsRuleCard';
import type { CorsRule } from '../../../main/s3/cors';

const rule: CorsRule = { id: null, allowedMethods: ['GET'], allowedOrigins: ['*'], allowedHeaders: [], exposeHeaders: [], maxAgeSeconds: null };

describe('CorsRuleCard', () => {
  it('toggles a method', async () => {
    const onChange = vi.fn();
    render(<CorsRuleCard rule={rule} onChange={onChange} onRemove={() => {}} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'PUT' }));
    expect(onChange).toHaveBeenCalledWith({ ...rule, allowedMethods: ['GET', 'PUT'] });
  });

  it('updates max age', () => {
    const onChange = vi.fn();
    render(<CorsRuleCard rule={rule} onChange={onChange} onRemove={() => {}} />);
    fireEvent.change(screen.getByLabelText('Max age (seconds)'), { target: { value: '7200' } });
    expect(onChange).toHaveBeenCalledWith({ ...rule, maxAgeSeconds: 7200 });
  });

  it('clears max age to null when emptied', () => {
    const onChange = vi.fn();
    render(<CorsRuleCard rule={{ ...rule, maxAgeSeconds: 3600 }} onChange={onChange} onRemove={() => {}} />);
    fireEvent.change(screen.getByLabelText('Max age (seconds)'), { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith({ ...rule, maxAgeSeconds: null });
  });

  it('calls onRemove', async () => {
    const onRemove = vi.fn();
    render(<CorsRuleCard rule={rule} onChange={() => {}} onRemove={onRemove} />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove rule' }));
    expect(onRemove).toHaveBeenCalled();
  });
});
