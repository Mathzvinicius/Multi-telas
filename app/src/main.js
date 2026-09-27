const { app, BrowserWindow, ipcMain, Notification } = require('electron');
const path = require('path');
const os = require('os');
const http = require('http');
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

// Agent ID estavel: hash do hostname + username (mesmo entre reinicializacoes)
const AGENT_ID = process.env.AGENT_ID || crypto.createHash('md5').update(hostname + '|' + userName).digest('hex');

let socket = null;
let captureInterval = null;
let streamServer = null;
let streamPort = 0;
let currentScreenIndex = 0;
let totalScreens = 1;
let notified = false;
let streamReady = false;

function showStartupNotification() {
  if (notified) return;
  notified = true;
  try {
    if (Notification.isSupported()) {
      const notification = new Notification({
        title: 'Monitoramento ativo',
        body: `Sua tela esta sendo transmitida.\nComputador: ${hostname}\nUsuario: ${userName}`,
        silent: true
      });
      notification.show();
    }
  } catch {}
}

function getLocalIp() {
  try {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        if (net.family === 'IPv4' && !net.internal) return net.address;
      }
    }
  } catch {}
  return '127.0.0.1';
}

function findFreePort(startPort) {
  return new Promise((resolve) => {
    const server = http.createServer();
    server.listen(startPort, '0.0.0.0', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
    server.on('error', () => resolve(findFreePort(startPort + 1)));
  });
}

function startStreamServer() {
  return new Promise(async (resolve, reject) => {
    try {
      streamPort = await findFreePort(19000);
      const BOUNDARY = 'frame-boundary-' + AGENT_ID.slice(0, 8);

      streamServer = http.createServer(async (req, res) => {
        if (!req.url.startsWith('/stream')) {
          res.writeHead(404);
          res.end('Not Found');
          return;
        }

        res.writeHead(200, {
          'Content-Type': 'multipart/x-mixed-replace; boundary=' + BOUNDARY,
          'Connection': 'keep-alive',
          'Cache-Control': 'no-cache',
          'Access-Control-Allow-Origin': '*'
        });

        let closed = false;
        req.on('close', () => { closed = true; });

        async function sendFrame() {
          if (closed) return;
          try {
            const screens = await detectScreens();
            if (!screens.length) return;
            const screenInfo = screens[currentScreenIndex];
            const img = await desktopScreenshot({ format: 'png' });

            let jpegBuf;
            try {
              const sourceImg = await loadImage(img);
              const maxW = 1280;
              const maxH = 720;
              const scale = Math.min(maxW / sourceImg.width, maxH / sourceImg.height, 1);
              const w = Math.round(sourceImg.width * scale);
              const h = Math.round(sourceImg.height * scale);
              const canvas = createCanvas(w, h);
              const ctx = canvas.getContext('2d');
              ctx.drawImage(sourceImg, 0, 0, w, h);
              jpegBuf = canvas.toBuffer('image/jpeg', { quality: 0.55 });
            } catch {
              jpegBuf = img;
            }

            const header = '--' + BOUNDARY + '\r\n' +
              'Content-Type: image/jpeg\r\n' +
              'Content-Length: ' + jpegBuf.length + '\r\n\r\n';
            res.write(header);
            res.write(jpegBuf);
          } catch {}
        }

        // Send first frame immediately
        await sendFrame();
        // Then send frames at the capture interval
        const interval = setInterval(sendFrame, CAPTURE_INTERVAL);

        req.on('close', () => {
          closed = true;
          clearInterval(interval);
        });
      });

      streamServer.listen(streamPort, '0.0.0.0', () => {
        console.log('Stream server rodando na porta', streamPort);
        streamReady = true;
        resolve(streamPort);
      });

      streamServer.on('error', reject);
    } catch (err) {
      reject(err);
    }
  });
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
      agentId: AGENT_ID,
      streamPort: streamPort,
      localIp: getLocalIp()
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
    return displays.map((d, i) => ({
      index: i,
      name: 'Monitor ' + (i + 1),
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
    const apps = await getActiveApps();
    const cpuUsage = await getCpuUsage();
    let activityLevel = 'idle';
    if (cpuUsage > 30) activityLevel = 'active';
    else if (cpuUsage > 10) activityLevel = 'moderate';

    if (socket && socket.connected) {
      socket.emit('live:frame', {
        apps,
        activityLevel,
        cpu: cpuUsage,
        monitorIndex: currentScreenIndex,
        monitorName: screenInfo.name,
        totalScreens: screens.length,
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

app.whenReady().then(async () => {
  console.log('Iniciando Monitoramento v1.0');
  console.log('Hostname:', hostname, '| Usuario:', userName);
  console.log('Agent ID:', AGENT_ID);

  try {
    await startStreamServer();
  } catch (err) {
    console.error('Falha ao iniciar stream server:', err.message);
  }

  showStartupNotification();
  connectSocket();
  startCapture();
});

app.on('before-quit', () => {
  stopCapture();
  if (socket) socket.disconnect();
  if (streamServer) streamServer.close();
});

app.on('window-all-closed', () => {
  stopCapture();
  if (socket) socket.disconnect();
  if (streamServer) streamServer.close();
});
