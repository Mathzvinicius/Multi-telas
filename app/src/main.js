const { app, BrowserWindow, ipcMain, Notification } = require('electron');
const path = require('path');
const os = require('os');
const { io } = require('socket.io-client');
const desktopScreenshot = require('screenshot-desktop');
const activeWin = require('active-win');
const si = require('systeminformation');
const crypto = require('crypto');
const { createCanvas, loadImage } = require('canvas');

const isDev = process.argv.includes('--dev');
const SERVER_URL = process.env.SERVER_URL || 'https://optimistic-creativity-production-7d23.up.railway.app';
const CAPTURE_INTERVAL = parseInt(process.env.CAPTURE_INTERVAL || '2000', 10);
const hostname = os.hostname();
const userName = os.userInfo().username;

// Agent ID estavel: hash do hostname + username
const AGENT_ID = process.env.AGENT_ID || crypto.createHash('md5').update(hostname + '|' + userName).digest('hex');

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
      const n = new Notification({
        title: 'Monitoramento ativo',
        body: 'Sua tela esta sendo transmitida.\nComputador: ' + hostname + '\nUsuario: ' + userName,
        silent: true
      });
      n.show();
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
    console.log('Conectado ao servidor');
    socket.emit('register', {
      name: hostname + ' (' + userName + ')',
      team: 'Geral',
      agentId: AGENT_ID
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
    return displays.map(function(d, i) {
      return { index: i, name: 'Monitor ' + (i + 1), bounds: d.bounds };
    });
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
      // Comprimir para JPEG pequeno (funciona no Electron empacotado)
      let imageBase64;
      try {
        const sourceImg = await loadImage(img);
        // Resolucao baixa para transmitir rapido
        const maxW = 960;
        const maxH = 540;
        const scale = Math.min(maxW / sourceImg.width, maxH / sourceImg.height, 1);
        const w = Math.round(sourceImg.width * scale);
        const h = Math.round(sourceImg.height * scale);
        const canvas = createCanvas(w, h);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(sourceImg, 0, 0, w, h);
        const jpegBuf = canvas.toBuffer('image/jpeg', { quality: 0.45 });
        imageBase64 = jpegBuf.toString('base64');
      } catch (err) {
        console.error('Erro compressao, enviando raw:', err.message);
        imageBase64 = img.toString('base64');
      }

      console.log('Enviando frame:', imageBase64.length, 'chars');

      socket.emit('live:frame', {
        image: imageBase64,
        apps: apps,
        activityLevel: activityLevel,
        cpu: cpuUsage,
        monitorIndex: currentScreenIndex,
        monitorName: screenInfo.name,
        totalScreens: screens.length,
        allScreens: screens.map(function(s) { return { index: s.index, name: s.name }; })
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

app.whenReady().then(function() {
  console.log('=== Monitoramento v1.0 ===');
  console.log('Hostname:', hostname);
  console.log('Usuario:', userName);
  console.log('Agent ID:', AGENT_ID);
  console.log('Servidor:', SERVER_URL);
  showStartupNotification();
  connectSocket();
  startCapture();
});

app.on('before-quit', function() {
  stopCapture();
  if (socket) socket.disconnect();
});

app.on('window-all-closed', function() {
  stopCapture();
  if (socket) socket.disconnect();
});
