const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getInfo: () => ipcRenderer.invoke('get-info'),
  onChangeScreen: (index) => ipcRenderer.send('change-screen', index),
  onMinimizeToTray: () => ipcRenderer.send('minimize-to-tray'),
  onQuitApp: () => ipcRenderer.send('quit-app'),
  onStatus: (callback) => ipcRenderer.on('status', (_event, data) => callback(data)),
  onCapture: (callback) => ipcRenderer.on('capture', (_event, data) => callback(data)),
  onAppInfo: (callback) => ipcRenderer.on('app-info', (_event, data) => callback(data))
});
