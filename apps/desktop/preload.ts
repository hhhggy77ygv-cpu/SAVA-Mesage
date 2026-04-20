import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electron', {
  isDesktop: true,
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  store: {
    get: (key: string) => ipcRenderer.invoke('store-get', key),
    set: (key: string, value: any) => ipcRenderer.invoke('store-set', key, value),
    delete: (key: string) => ipcRenderer.invoke('store-delete', key),
  },
  notification: {
    show: (title: string, body: string, options?: any) => 
      ipcRenderer.invoke('notification-show', title, body, options),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings-get'),
    set: (settings: any) => ipcRenderer.invoke('settings-set', settings),
  },
  dialog: {
    showOpenDialog: (options: any) => ipcRenderer.invoke('dialog-open', options),
    showSaveDialog: (options: any) => ipcRenderer.invoke('dialog-save', options),
  },
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  on: (channel: string, callback: (...args: any[]) => void) => {
    ipcRenderer.on(channel, (_event, ...args) => callback(...args));
  },
  removeListener: (channel: string, callback: (...args: any[]) => void) => {
    ipcRenderer.removeListener(channel, callback);
  },
});
