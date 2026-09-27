const { io } = require('socket.io-client');
const desktopScreenshot = require('screenshot-desktop');
const os = require('os');
const activeWin = require('active-win');
const si = require('systeminformation');
const { v4: uuidv4 } = require('uuid');

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';
const CAPTURE_INTERVAL = parseInt(process.env.CAPTURE_INTERVAL || '5000', 10);
const AGENT_ID = process.env.AGENT_ID || uuidv4();

const hostname = os.hostname();
const userName = os.userInfo().username;

const socket = io(SERVER_URL, { transports: ['websocket', 'polling'] });

socket.on('connect', () => {
  console.log(`Conectado ao servidor: ${SERVER_URL}`);
  socket.emit('register', { name: `${hostname} (${userName})`, team: 'TI' });
});

socket.on('disconnect', () => {
  console.log('Desconectado do servidor, tentando reconectar...');
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
    console.error('Erro na captura:', err.message);
  }
}

setInterval(capture, CAPTURE_INTERVAL);
capture();
console.log(`Agente iniciado | ID: ${AGENT_ID}`);
console.log(`Capturando a cada ${CAPTURE_INTERVAL}ms`);
console.log(`Servidor: ${SERVER_URL}`);
