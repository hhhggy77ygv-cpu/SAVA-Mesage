// Типы для Electron API
interface ElectronAPI {
  store: {
    get: (key: string) => Promise<any>;
    set: (key: string, value: any) => Promise<void>;
    delete: (key: string) => Promise<void>;
  };
  notification: {
    show: (title: string, body: string, options?: any) => Promise<void>;
  };
  settings: {
    get: () => Promise<{
      autoLaunch: boolean;
      autoLaunchMinimized: boolean;
      minimizeToTray: boolean;
      closeToTray: boolean;
    }>;
    set: (settings: Partial<{
      autoLaunch: boolean;
      autoLaunchMinimized: boolean;
      minimizeToTray: boolean;
      closeToTray: boolean;
    }>) => Promise<boolean>;
  };
  dialog: {
    showOpenDialog: (options: any) => Promise<any>;
    showSaveDialog: (options: any) => Promise<any>;
  };
  getAppVersion: () => Promise<string>;
  isDesktop: boolean;
  on: (channel: string, callback: (...args: any[]) => void) => void;
  removeListener: (channel: string, callback: (...args: any[]) => void) => void;
}

declare global {
  interface Window {
    electron?: ElectronAPI;
  }
}

// Проверка запуска в Electron
export const isElectron = (): boolean => {
  return typeof window !== 'undefined' && window.electron?.isDesktop === true;
};

// Получение API Electron
export const getElectronAPI = (): ElectronAPI | null => {
  if (isElectron()) {
    return window.electron!;
  }
  return null;
};

// Хранилище для Electron
export const electronStore = {
  async get(key: string): Promise<any> {
    const api = getElectronAPI();
    if (api) {
      return api.store.get(key);
    }
    return null;
  },

  async set(key: string, value: any): Promise<void> {
    const api = getElectronAPI();
    if (api) {
      await api.store.set(key, value);
    }
  },

  async delete(key: string): Promise<void> {
    const api = getElectronAPI();
    if (api) {
      await api.store.delete(key);
    }
  }
};

// Получение версии приложения
export const getAppVersion = async (): Promise<string | null> => {
  const api = getElectronAPI();
  if (api) {
    return api.getAppVersion();
  }
  return null;
};

// Подписка на события Electron
export const onElectronEvent = (channel: string, callback: (...args: any[]) => void): (() => void) => {
  const api = getElectronAPI();
  if (api) {
    api.on(channel, callback);
    return () => api.removeListener(channel, callback);
  }
  return () => {};
};

// Показать уведомление
export const showNotification = async (title: string, body: string, options?: any): Promise<void> => {
  const api = getElectronAPI();
  if (api) {
    await api.notification.show(title, body, options);
  } else {
    // Fallback для браузера
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body, ...options });
    }
  }
};

// Получить настройки приложения
export const getAppSettings = async () => {
  const api = getElectronAPI();
  if (api) {
    return api.settings.get();
  }
  return null;
};

// Установить настройки приложения
export const setAppSettings = async (settings: any) => {
  const api = getElectronAPI();
  if (api) {
    return api.settings.set(settings);
  }
  return false;
};

// Показать диалог открытия файла
export const showOpenDialog = async (options: any) => {
  const api = getElectronAPI();
  if (api) {
    return api.dialog.showOpenDialog(options);
  }
  return null;
};

// Показать диалог сохранения файла
export const showSaveDialog = async (options: any) => {
  const api = getElectronAPI();
  if (api) {
    return api.dialog.showSaveDialog(options);
  }
  return null;
};

export default {
  isElectron,
  getElectronAPI,
  electronStore,
  getAppVersion,
  onElectronEvent,
  showNotification,
  getAppSettings,
  setAppSettings,
  showOpenDialog,
  showSaveDialog
};
