const { app, BrowserWindow, ipcMain, Notification } = require('electron');
const path = require('path');
const os = require('os');
const { io } = require('socket.io-client');
const desktopScreenshot = require('screenshot-desktop');
const activeWin = require('active-win');
const si = require('systeminformation');
const { v4: uuidv4 } = require('uuid');

const isDev = process.argv.includes('--dev');
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';
const CAPTURE_INTERVAL = parseInt(process.env.CAPTURE_INTERVAL || '5000', 10);
const AGENT_ID = process.env.AGENT_ID || uuidv4();
const hostname = os.hostname();
const userName = os.userInfo().username;

let socket = null;
let captureInterval = null;
let currentScreenIndex = 0;
let totalScreens = 1;
let notified = false;

function showStartupNotification() {
  if (notified) return;
  notified = true;
  try {
    if (Notification.isSupported()) {
      const notification = new Notification({
        title: 'Monitoramento ativo',
        body: `Sua tela esta sendo transmitida para o gestor.\nComputador: ${hostname}\nUsuario: ${userName}`,
        silent: true
      });
      notification.show();
    }
  } catch {}
}

function connectSocket() {
  socket = io(SERVER_URL, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 30000,
    timeout: 20000,
    autoConnect: true
  });

  socket.on('connect', () => {
    console.log('Conectado:', SERVER_URL);
    socket.emit('register', {
      name: `${hostname} (${userName})`,
      team: 'Geral'
    });
  });

  socket.on('disconnect', () => {
    console.log('Desconectado, reconectando...');
  });

  socket.on('connect_error', (err) => {
    console.log('Erro conexao:', err.message);
  });
}

async function detectScreens() {
  try {
    const displays = screen.getAllDisplays ? screen.getAllDisplays() : [{ bounds: { x: 0, y: 0, width: 1920, height: 1080 } }];
    totalScreens = displays.length;
    currentScreenIndex = 0;
    return displays.map((d, i) => ({
      index: i,
      name: `Monitor ${i + 1}`,
      bounds: d.bounds
    }));
  } catch {
    return [{ index: 0, name: 'Monitor 1', bounds: { x: 0, y: 0, width: 1920, height: 1080 } }];
  }
}

async function getActiveApps() {
  try {
    const current = await activeWin();
    if (!current) return [];
    return [{ name: current.owner.name, title: current.title, url: current.url || null }];
  } catch {
    return [];
  }
}

async function getCpuUsage() {
  try {
    const cpu = await si.currentLoad();
    return Math.round(cpu.currentLoad || 0);
  } catch {
    return 0;
  }
}

async function captureAndSend() {
  try {
    const screens = await detectScreens();
    if (!screens.length) return;

    const screenInfo = screens[currentScreenIndex];
    const img = await desktopScreenshot({ format: 'png' });
    const apps = await getActiveApps();
    const cpuUsage = await getCpuUsage();
    let activityLevel = 'idle';
    if (cpuUsage > 30) activityLevel = 'active';
    else if (cpuUsage > 10) activityLevel = 'moderate';

    if (socket && socket.connected) {
      socket.emit('live:frame', {
        image: img.toString('base64'),
        apps,
        activityLevel,
        cpu: cpuUsage,
        monitorIndex: currentScreenIndex,
        monitorName: screenInfo.name,
        totalScreens,
        allScreens: screens.map((s) => ({ index: s.index, name: s.name }))
      });
    }

    currentScreenIndex = (currentScreenIndex + 1) % totalScreens;
  } catch (err) {
    console.error('Erro captura:', err.message);
  }
}

function startCapture() {
  if (captureInterval) clearInterval(captureInterval);
  captureInterval = setInterval(captureAndSend, CAPTURE_INTERVAL);
  captureAndSend();
}

function stopCapture() {
  if (captureInterval) clearInterval(captureInterval);
  captureInterval = null;
}

app.whenReady().then(() => {
  showStartupNotification();
  connectSocket();
  startCapture();
});

app.on('before-quit', () => {
  stopCapture();
  if (socket) socket.disconnect();
});

app.on('window-all-closed', () => {
  stopCapture();
  if (socket) socket.disconnect();
});
