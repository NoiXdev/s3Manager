import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { AppLogo } from './AppLogo';

describe('AppLogo', () => {
  it('renders an svg element', () => {
    const { container } = render(<AppLogo />);
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('forwards the className to the svg', () => {
    const { container } = render(<AppLogo className="h-7 w-7" />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute('class')).toContain('h-7 w-7');
  });

  it('is hidden from assistive tech', () => {
    const { container } = render(<AppLogo />);
    expect(container.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
  });
});
