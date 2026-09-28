const { app, BrowserWindow, ipcMain, Notification } = require('electron');
const path = require('path');
const os = require('os');
const { io } = require('socket.io-client');
const activeWin = require('active-win');
const si = require('systeminformation');
const crypto = require('crypto');

const isDev = process.argv.includes('--dev');
const SERVER_URL = process.env.SERVER_URL || 'https://optimistic-creativity-production-7d23.up.railway.app';
const CHUNK_INTERVAL = parseInt(process.env.CHUNK_INTERVAL || '1000', 10);
const hostname = os.hostname();
const userName = os.userInfo().username;

// Agent ID estavel
const AGENT_ID = process.env.AGENT_ID || crypto.createHash('md5').update(hostname + '|' + userName).digest('hex');

let socket = null;
let mediaRecorder = null;
let videoChunks = [];
let currentScreenIndex = 0;
let totalScreens = 1;
let notified = false;
let captureWindow = null;

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

async function startVideoCapture() {
  try {
    // Cria janela oculta para capturar a tela
    if (!captureWindow) {
      captureWindow = new BrowserWindow({
        width: 1,
        height: 1,
        show: false,
        webPreferences: {
          nodeIntegration: true,
          contextIsolation: false
        }
      });

      captureWindow.loadURL('data:text/html;charset=utf-8,<html><body><script>require("electron").ipcRenderer.on("start-capture", function() { startCapture(); }); function startCapture() { var stream = null; var recorder = null; var chunkInterval = null; require("electron").ipcRenderer.send("capture-ready"); require("electron").ipcRenderer.on("begin-capture", function(event, sourceId) { navigator.mediaDevices.getUserMedia({ video: { mandatory: { chromeMediaSource: "desktop", chromeMediaSourceId: sourceId, minWidth: 1280, maxWidth: 1920, minHeight: 720, maxHeight: 1080 } }, audio: false }).then(function(s) { stream = s; recorder = new MediaRecorder(s, { mimeType: "video/webm; codecs=vp8", videoBitsPerSecond: 500000 }); recorder.ondataavailable = function(e) { if (e.data && e.data.size > 0) { require("electron").ipcRenderer.send("video-chunk", e.data); } }; recorder.start(500); chunkInterval = setInterval(function() { if (recorder && recorder.state === "recording") { recorder.requestData(); } }, 500); require("electron").ipcRenderer.send("capture-started"); }).catch(function(err) { require("electron").ipcRenderer.send("capture-error", err.message); }); }); require("electron").ipcRenderer.on("stop-capture", function() { if (recorder && recorder.state !== "inactive") { recorder.stop(); } if (stream) { stream.getTracks().forEach(function(t) { t.stop(); }); } if (chunkInterval) { clearInterval(chunkInterval); } }); }</script></body></html>');
    }

    // Espera a janela estar pronta
    await new Promise(function(resolve) {
      captureWindow.webContents.on('did-finish-load', resolve);
      setTimeout(resolve, 2000);
    });

    // Pega os sources de tela disponíveis
    const sources = await captureWindow.webContents.desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } });
    if (!sources || !sources.length) {
      console.error('Nenhuma tela encontrada');
      return;
    }

    const sourceId = sources[currentScreenIndex].id;
    console.log('Capturando tela:', sources[currentScreenIndex].name, '| source:', sourceId.slice(0, 20) + '...');

    // Envia comando para iniciar captura
    captureWindow.webContents.send('begin-capture', sourceId);

    // Aguarda confirmação
    await new Promise(function(resolve) {
      captureWindow.webContents.on('capture-started', resolve);
      setTimeout(resolve, 3000);
    });

    console.log('Captura de vídeo iniciada com sucesso');
  } catch (err) {
    console.error('Erro ao iniciar captura de vídeo:', err.message);
  }
}

function stopVideoCapture() {
  if (captureWindow) {
    captureWindow.webContents.send('stop-capture');
  }
}

async function captureAndSend() {
  try {
    const screens = await detectScreens();
    if (!screens.length) return;

    const screenInfo = screens[currentScreenIndex];
    const apps = await getActiveApps();
    const cpuUsage = await getCpuUsage();
    let activityLevel = 'idle';
    if (cpuUsage > 30) activityLevel = 'active';
    else if (cpuUsage > 10) activityLevel = 'moderate';

    if (socket && socket.connected) {
      socket.emit('live:stats', {
        apps: apps,
        activityLevel: activityLevel,
        cpu: cpuUsage,
        monitorIndex: currentScreenIndex,
        monitorName: screenInfo.name,
        timestamp: Date.now()
      });
    }

    currentScreenIndex = (currentScreenIndex + 1) % totalScreens;
  } catch (err) {
    console.error('Erro captura:', err.message);
  }
}

function startCapture() {
  if (captureInterval) clearInterval(captureInterval);
  captureInterval = setInterval(captureAndSend, 2000);
  startVideoCapture();
  captureAndSend();
}

function stopCapture() {
  if (captureInterval) clearInterval(captureInterval);
  captureInterval = null;
  stopVideoCapture();
}

app.whenReady().then(function() {
  console.log('=== Monitoramento v1.0 (Video Stream) ===');
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
  if (captureWindow) {
    captureWindow.destroy();
    captureWindow = null;
  }
});

app.on('window-all-closed', function() {
  stopCapture();
  if (socket) socket.disconnect();
});

// IPC handlers para captura de vídeo
ipcMain.on('capture-ready', function() {
  console.log('Captura pronta');
});

ipcMain.on('capture-started', function() {
  console.log('MediaRecorder iniciado');
});

ipcMain.on('capture-error', function(event, err) {
  console.error('Erro na captura:', err);
});

ipcMain.on('video-chunk', function(event, chunkBuffer) {
  // Envia chunk de vídeo via socket como binary
  if (socket && socket.connected) {
    const uint8 = new Uint8Array(chunkBuffer);
    socket.emit('live:chunk', uint8ArrayToBase64(uint8));
  }
});

function uint8ArrayToBase64(uint8) {
  let binary = '';
  const len = uint8.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(uint8[i]);
  }
  return btoa(binary);
}
