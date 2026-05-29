import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from './App';

describe('App', () => {
  it('renders the app shell with the product name', () => {
    render(<App />);
    expect(screen.getByText('S3 Manager')).toBeInTheDocument();
  });
});
