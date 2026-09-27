const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const os = require('os');
const si = require('systeminformation');
const desktopScreenshot = require('screenshot-desktop');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '../public')));

const RECORDINGS_DIR = path.join(__dirname, '../recordings');
fs.mkdirSync(RECORDINGS_DIR, { recursive: true });

const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || 'admin123';
const clients = new Map();

function checkAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${DASHBOARD_PASSWORD}`) {
    return res.status(401).json({ error: 'Nao autorizado' });
  }
  next();
}

app.get('/api/clients', checkAuth, (req, res) => {
  res.json(Array.from(clients.values()));
});

app.get('/api/recordings/:clientId', checkAuth, (req, res) => {
  const clientId = req.params.clientId;
  const clientDir = path.join(RECORDINGS_DIR, clientId);
  if (!fs.existsSync(clientDir)) return res.json([]);
  const files = fs.readdirSync(clientDir)
    .filter((f) => f.endsWith('.webm'))
    .map((f) => {
      const stats = fs.statSync(path.join(clientDir, f));
      return {
        filename: f,
        size: stats.size,
        createdAt: stats.mtimeMs,
        url: `/recordings/${clientId}/${f}`
      };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
  res.json(files);
});

app.get('/recordings/:clientId/:filename', checkAuth, (req, res) => {
  const { clientId, filename } = req.params;
  const filePath = path.join(RECORDINGS_DIR, clientId, filename);
  if (!fs.existsSync(filePath)) return res.sendStatus(404);
  res.download(filePath);
});

app.delete('/api/recordings/:clientId/:filename', checkAuth, (req, res) => {
  const { clientId, filename } = req.params;
  const filePath = path.join(RECORDINGS_DIR, clientId, filename);
  if (!fs.existsSync(filePath)) return res.sendStatus(404);
  fs.unlinkSync(filePath);
  res.json({ success: true });
});

io.on('connection', (socket) => {
  console.log('Conectado:', socket.id);

  socket.on('register', (data) => {
    const { name, team, screenInfo } = data || {};
    clients.set(socket.id, {
      id: socket.id,
      name: name || 'Colaborador',
      team: team || 'Geral',
      connectedAt: Date.now(),
      lastSeen: Date.now(),
      isOnline: true,
      isRecording: false,
      hasLiveStream: false,
      screenInfo: screenInfo || null,
      monitorNames: {},
      stats: { cpu: 0, network: 0 }
    });
    io.emit('clients:update', Array.from(clients.values()));
  });

  socket.on('live:frame', (data) => {
    const client = clients.get(socket.id);
    if (!client) return;
    client.lastSeen = Date.now();
    client.isOnline = true;
    client.hasLiveStream = true;
    if (data && data.monitorIndex != null) {
      client.monitorNames = client.monitorNames || {};
      client.monitorNames[data.monitorIndex] = data.monitorName || `Monitor ${data.monitorIndex + 1}`;
    }
    socket.broadcast.emit('live:frame', {
      clientId: socket.id,
      clientName: client.name,
      monitorIndex: data && data.monitorIndex,
      monitorName: (client.monitorNames || {})[data && data.monitorIndex] || `Monitor ${(data && data.monitorIndex) + 1}`,
      frame: data && data.frame,
      timestamp: Date.now()
    });
  });

  socket.on('live:stats', (data) => {
    const client = clients.get(socket.id);
    if (!client) return;
    client.stats = data && data.stats ? data.stats : client.stats;
  });

  socket.on('recording:status', (data) => {
    const client = clients.get(socket.id);
    if (!client) return;
    client.isRecording = !!(data && data.recording);
  });

  socket.on('recording:upload', (data) => {
    try {
      const clientDir = path.join(RECORDINGS_DIR, socket.id);
      fs.mkdirSync(clientDir, { recursive: true });
      const filename = `recording_${Date.now()}.webm`;
      const filePath = path.join(clientDir, filename);
      const buffer = Buffer.from(data.file, 'base64');
      fs.writeFileSync(filePath, buffer);
      io.emit('recording:saved', {
        clientId: socket.id,
        clientName: clients.get(socket.id)?.name || 'Colaborador',
        filename,
        size: buffer.length,
        createdAt: Date.now(),
        url: `/recordings/${socket.id}/${filename}`
      });
    } catch (err) {
      console.error('Erro ao salvar gravacao:', err);
    }
  });

  socket.on('disconnect', () => {
    const client = clients.get(socket.id);
    if (client) {
      client.isOnline = false;
      client.hasLiveStream = false;
    }
    io.emit('clients:update', Array.from(clients.values()));
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
  console.log(`Dashboard: http://localhost:${PORT}/dashboard.html`);
});
