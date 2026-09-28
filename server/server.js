const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  maxHttpBufferSize: 20 * 1024 * 1024,
  transports: ['websocket', 'polling']
});

app.use(express.json({ limit: '50mb' }));

const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || 'admin123';
const clients = new Map();

function checkAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || auth !== 'Bearer ' + DASHBOARD_PASSWORD) {
    return res.status(401).json({ error: 'Nao autorizado' });
  }
  next();
}

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const RECORDINGS_DIR = path.join(__dirname, 'recordings');
try { fs.mkdirSync(RECORDINGS_DIR, { recursive: true }); } catch {}

app.get('/health', (req, res) => {
  res.json({ status: 'ok', clients: clients.size });
});

app.get('/dashboard', (req, res) => {
  const filePath = path.join(PUBLIC_DIR, 'dashboard.html');
  if (fs.existsSync(filePath)) {
    return res.sendFile(filePath);
  }
  res.status(404).send('Dashboard nao encontrado');
});

app.get('/', (req, res) => {
  res.redirect('/dashboard');
});

app.use(express.static(PUBLIC_DIR));

app.get('/api/clients', checkAuth, (req, res) => {
  res.json(Array.from(clients.values()));
});

app.get('/stream/:clientId', async (req, res) => {
  const clientId = req.params.clientId;
  const client = clients.get(clientId);
  if (!client || !client.streamPort) {
    return res.status(404).send('Stream nao disponivel');
  }

  // Proxy do stream MJPEG do agente
  const targetHost = client.localIp || '127.0.0.1';
  const targetUrl = 'http://' + targetHost + ':' + client.streamPort + '/stream';

  try {
    const proxyRes = await fetch(targetUrl);
    if (!proxyRes.ok) {
      return res.status(502).send('Erro ao conectar ao stream');
    }

    res.writeHead(proxyRes.status, {
      'Content-Type': 'multipart/x-mixed-replace; boundary=frame-boundary',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });

    proxyRes.body.on('data', (chunk) => {
      if (!res.writableEnded) res.write(chunk);
    });

    proxyRes.body.on('end', () => {
      if (!res.writableEnded) res.end();
    });

    proxyRes.body.on('error', () => {
      if (!res.writableEnded) res.end();
    });
  } catch (err) {
    res.status(502).send('Erro no proxy: ' + err.message);
  }
});

app.get('/api/recordings/:clientId', checkAuth, (req, res) => {
  const clientId = req.params.clientId;
  const clientDir = path.join(RECORDINGS_DIR, clientId);
  if (!fs.existsSync(clientDir)) return res.json([]);
  const files = fs.readdirSync(clientDir)
    .filter(function(f) { return f.endsWith('.webm'); })
    .map(function(f) {
      const stats = fs.statSync(path.join(clientDir, f));
      return {
        filename: f,
        size: stats.size,
        createdAt: stats.mtimeMs,
        url: '/recordings/' + clientId + '/' + f
      };
    })
    .sort(function(a, b) { return b.createdAt - a.createdAt; });
  res.json(files);
});

app.get('/recordings/:clientId/:filename', checkAuth, (req, res) => {
  const filePath = path.join(RECORDINGS_DIR, req.params.clientId, req.params.filename);
  if (!fs.existsSync(filePath)) return res.sendStatus(404);
  res.download(filePath);
});

app.delete('/api/recordings/:clientId/:filename', checkAuth, (req, res) => {
  const filePath = path.join(RECORDINGS_DIR, req.params.clientId, req.params.filename);
  if (!fs.existsSync(filePath)) return res.sendStatus(404);
  fs.unlinkSync(filePath);
  res.json({ success: true });
});

io.on('connection', function(socket) {
  console.log('Conectado:', socket.id);

  socket.on('register', function(data) {
    const name = (data && data.name) || 'Colaborador';
    const team = (data && data.team) || 'Geral';
    const agentId = (data && data.agentId) || null;

    if (agentId) {
      for (const [id, client] of clients) {
        if (client.agentId === agentId && id !== socket.id) {
          clients.delete(id);
          console.log('Removido duplicado:', id);
          break;
        }
      }
    }

    clients.set(socket.id, {
      id: socket.id,
      agentId: agentId,
      name: name,
      team: team,
      connectedAt: Date.now(),
      lastSeen: Date.now(),
      isOnline: true,
      isRecording: false,
      hasLiveStream: false,
      monitorNames: {},
      stats: { cpu: 0, network: 0 },
      streamPort: (data && data.streamPort) || null,
      localIp: (data && data.localIp) || null
    });
    io.emit('clients:update', Array.from(clients.values()));
    console.log('Registrado:', name, '| stream:', (data && data.streamPort) || 'nenhum');
  });

  socket.on('live:frame', function(data) {
    const client = clients.get(socket.id);
    if (!client) return;
    client.lastSeen = Date.now();
    client.isOnline = true;
    client.hasLiveStream = true;
    if (data && data.monitorIndex != null) {
      client.monitorNames = client.monitorNames || {};
      client.monitorNames[data.monitorIndex] = data.monitorName || 'Monitor ' + (data.monitorIndex + 1);
    }
    socket.broadcast.emit('live:frame', {
      clientId: socket.id,
      clientName: client.name,
      monitorIndex: data && data.monitorIndex,
      monitorName: (client.monitorNames || {})[data && data.monitorIndex] || 'Monitor ' + ((data && data.monitorIndex) + 1),
      frame: data && data.image,
      timestamp: Date.now()
    });
  });

  socket.on('live:stats', function(data) {
    const client = clients.get(socket.id);
    if (!client) return;
    client.stats = (data && data.stats) ? data.stats : client.stats;
  });

  socket.on('recording:status', function(data) {
    const client = clients.get(socket.id);
    if (!client) return;
    client.isRecording = !!(data && data.recording);
  });

  socket.on('recording:upload', function(data) {
    try {
      const clientDir = path.join(RECORDINGS_DIR, socket.id);
      fs.mkdirSync(clientDir, { recursive: true });
      const filename = 'recording_' + Date.now() + '.webm';
      const filePath = path.join(clientDir, filename);
      const buffer = Buffer.from(data.file, 'base64');
      fs.writeFileSync(filePath, buffer);
      io.emit('recording:saved', {
        clientId: socket.id,
        clientName: (clients.get(socket.id) && clients.get(socket.id).name) || 'Colaborador',
        filename: filename,
        size: buffer.length,
        createdAt: Date.now(),
        url: '/recordings/' + socket.id + '/' + filename
      });
    } catch (err) {
      console.error('Erro ao salvar gravacao:', err);
    }
  });

  socket.on('disconnect', function() {
    const client = clients.get(socket.id);
    if (client) {
      client.isOnline = false;
      client.hasLiveStream = false;
    }
    io.emit('clients:update', Array.from(clients.values()));
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', function() {
  console.log('Servidor rodando na porta ' + PORT);
});
