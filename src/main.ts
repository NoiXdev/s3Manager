import { app, BrowserWindow, ipcMain, safeStorage } from 'electron';
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
  registerIpc(ipcMain, { accounts, settings, secrets, crypto: safeStorage, db });
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
  initBackend();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
