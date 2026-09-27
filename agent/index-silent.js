const { io } = require('socket.io-client');
const desktopScreenshot = require('screenshot-desktop');
const os = require('os');
const activeWin = require('active-win');
const si = require('systeminformation');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

const isSilent = process.argv.includes('--silent');

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';
const CAPTURE_INTERVAL = parseInt(process.env.CAPTURE_INTERVAL || '5000', 10);
const AGENT_ID = process.env.AGENT_ID || uuidv4();

const DATA_DIR = path.join(os.homedir(), '.agent-monitor');
const LOCK_FILE = path.join(DATA_DIR, 'running.lock');
const PID_FILE = path.join(DATA_DIR, 'agent.pid');

try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}
fs.writeFileSync(LOCK_FILE, process.pid.toString());
fs.writeFileSync(PID_FILE, process.pid.toString());

process.on('exit', () => {
  try { fs.unlinkSync(LOCK_FILE); } catch {}
});
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

if (isSilent) {
  const streams = [process.stdout, process.stderr];
  streams.forEach((s) => {
    try { s.write = function () {}; } catch {}
  });
}

const hostname = os.hostname();
const userName = os.userInfo().username;

const socket = io(SERVER_URL, {
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 30000,
  timeout: 20000,
  autoConnect: true
});

function log(...args) {
  if (!isSilent) console.log('[AGENT]', ...args);
}

socket.on('connect', () => {
  log(`Conectado ao servidor: ${SERVER_URL}`);
  socket.emit('register', { name: `${hostname} (${userName})`, team: 'Geral' });
});

socket.on('disconnect', () => {
  log('Desconectado, reconectando...');
});

socket.on('connect_error', (err) => {
  log('Erro de conexão:', err.message);
});

async function getActiveApps() {
  try {
    const current = await activeWin();
    if (!current) return [];
    return [
      {
        name: current.owner.name,
        title: current.title,
        url: current.url || null,
        state: 'active'
      }
    ];
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

async function capture() {
  try {
    const img = await desktopScreenshot({ format: 'png' });
    const apps = await getActiveApps();
    const cpuUsage = await getCpuUsage();
    let activityLevel = 'idle';
    if (cpuUsage > 30) activityLevel = 'active';
    else if (cpuUsage > 10) activityLevel = 'moderate';

    socket.emit('screenshot', {
      image: img.toString('base64'),
      apps,
      activityLevel,
      cpu: cpuUsage
    });
  } catch (err) {
    log('Erro na captura:', err.message);
  }
}

setInterval(capture, CAPTURE_INTERVAL);
capture();
log(`Agente iniciado | ID: ${AGENT_ID}`);
log(`Capturando a cada ${CAPTURE_INTERVAL}ms`);
