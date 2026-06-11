import { describe, it, expect, vi } from 'vitest';
import { registerIpc, type RegisterDeps } from './register';
import { CH } from './channels';

function fakeSettingsRepo() {
  const m = new Map<string, string>();
  return { get: (k: string) => m.get(k), set: (k: string, v: string) => void m.set(k, v) };
}

// Capture the handler registered for a given channel.
function harness(overrides: Partial<RegisterDeps> = {}) {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  const ipcMain = { handle: (ch: string, fn: (event: unknown, ...args: unknown[]) => unknown) => handlers.set(ch, fn) };
  const applyTheme = vi.fn();
  const deps = {
    accounts: {}, secrets: {}, settings: fakeSettingsRepo(), crypto: {}, db: {},
    saveDialog: vi.fn(), selectDirectory: vi.fn(), appVersion: '1.0.0', openExternal: vi.fn(),
    applyTheme,
    ...overrides,
  } as unknown as RegisterDeps;
  registerIpc(ipcMain as never, deps);
  return { handlers, applyTheme };
}

describe('setSettings theme application', () => {
  it('calls applyTheme with the resolved theme after writing settings', async () => {
    const { handlers, applyTheme } = harness();
    await handlers.get(CH.setSettings)!(null, { theme: 'dark' });
    expect(applyTheme).toHaveBeenCalledWith('dark');
  });

  it('does not throw when applyTheme is not provided', async () => {
    const { handlers } = harness({ applyTheme: undefined });
    await expect(handlers.get(CH.setSettings)!(null, { theme: 'light' })).resolves.toBeTruthy();
  });
});
