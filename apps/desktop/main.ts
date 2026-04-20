import { app, BrowserWindow, shell, ipcMain } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;

const isDev = !app.isPackaged && process.env.VITE_DEV_SERVER_URL;

// IPC Handlers
function setupIpcHandlers() {
  // Open external links
  ipcMain.handle('open-external', async (_event, url: string) => {
    await shell.openExternal(url);
  });

  // Store handlers (simple in-memory store for now)
  const store = new Map<string, any>();
  
  ipcMain.handle('store-get', (_event, key: string) => {
    return store.get(key);
  });

  ipcMain.handle('store-set', (_event, key: string, value: any) => {
    store.set(key, value);
  });

  ipcMain.handle('store-delete', (_event, key: string) => {
    store.delete(key);
  });

  // App version
  ipcMain.handle('get-app-version', () => {
    return app.getVersion();
  });

  // Settings handlers (placeholder)
  ipcMain.handle('settings-get', () => {
    return {
      autoLaunch: false,
      autoLaunchMinimized: false,
      minimizeToTray: false,
      closeToTray: false,
    };
  });

  ipcMain.handle('settings-set', (_event, settings: any) => {
    console.log('Settings updated:', settings);
    return true;
  });
}

function createWindow() {
  // Determine if dev server is HTTPS
  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  const isHttpsDev = devServerUrl?.startsWith('https');

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
    backgroundColor: '#09090b',
    show: false,
  });

  // Allow self-signed certificates in dev mode (don't downgrade security)
  if (isDev) {
    mainWindow.webContents.session.setCertificateVerifyProc((req, callback) => {
      // For dev: allow self-signed certificates from localhost
      if (req.hostname === 'localhost' || req.hostname === '127.0.0.1') {
        callback(0); // Trust the certificate
      } else {
        callback(-2); // Use default verification
      }
    });
  }

  // Настраиваем разрешения для внешнего API
  mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    // Разрешаем только необходимые разрешения
    const allowedPermissions = ['notifications', 'media'];
    callback(allowedPermissions.includes(permission));
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL!);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(() => {
  setupIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});