import { app, BrowserWindow, ipcMain, safeStorage, dialog, shell } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { openDatabase } from './main/storage/db';
import { createAccountsRepo } from './main/storage/accountsRepo';
import { createSettingsRepo } from './main/storage/settingsRepo';
import { createSecretsStore } from './main/storage/secrets';
import { registerIpc } from './main/ipc/register';

if (started) {
  app.quit();
}

function initBackend() {
  const db = openDatabase(path.join(app.getPath('userData'), 's3manager.db'));
  const accounts = createAccountsRepo(db);
  const settings = createSettingsRepo(db);
  const secrets = createSecretsStore(db, safeStorage);
  const saveDialog = async (defaultFileName: string): Promise<string | null> => {
    const win = BrowserWindow.getFocusedWindow();
    const result = win
      ? await dialog.showSaveDialog(win, { defaultPath: defaultFileName })
      : await dialog.showSaveDialog({ defaultPath: defaultFileName });
    return result.canceled || !result.filePath ? null : result.filePath;
  };
  const selectDirectory = async (): Promise<string | null> => {
    const win = BrowserWindow.getFocusedWindow();
    const result = win
      ? await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory'] });
    return result.canceled || !result.filePaths[0] ? null : result.filePaths[0];
  };
  registerIpc(ipcMain, { accounts, settings, secrets, crypto: safeStorage, db, saveDialog, selectDirectory, appVersion: app.getVersion(), openExternal: (url) => shell.openExternal(url) });
}

const createWindow = () => {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }
};

app.on('ready', () => {
  // In dev (`npm start`) macOS shows the generic Electron Dock icon because the
  // Electron binary runs directly; packaged builds use the bundled .icns. Set it
  // explicitly here so dev matches the shipped icon. cwd is the project root in dev.
  if (process.platform === 'darwin' && MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    app.dock?.setIcon(path.join(process.cwd(), 'build/icons/icon.png'));
  }
  initBackend();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
