const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  maxHttpBufferSize: 50 * 1024 * 1024,
  transports: ['websocket', 'polling']
});

app.use(express.json({ limit: '50mb' }));

const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || 'admin123';
const clients = new Map();
const LIVE_DIR = path.join(__dirname, 'live');
const RECORDINGS_DIR = path.join(__dirname, 'recordings');
try { fs.mkdirSync(LIVE_DIR, { recursive: true }); } catch {}
try { fs.mkdirSync(RECORDINGS_DIR, { recursive: true }); } catch {}

function checkAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || auth !== 'Bearer ' + DASHBOARD_PASSWORD) {
    return res.status(401).json({ error: 'Nao autorizado' });
  }
  next();
}

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

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

app.get('/live/:clientId', (req, res) => {
  const clientId = req.params.clientId;
  const liveFile = path.join(LIVE_DIR, clientId + '.webm');
  if (!fs.existsSync(liveFile)) {
    return res.status(404).send('Stream nao disponivel');
  }

  const stat = fs.statSync(liveFile);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = (end - start) + 1;

    const fileStream = fs.createReadStream(liveFile, { start, end });
    res.writeHead(206, {
      'Content-Range': 'bytes ' + start + '-' + end + '/' + fileSize,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': 'video/webm'
    });
    fileStream.pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': 'video/webm',
      'Accept-Ranges': 'bytes'
    });
    fs.createReadStream(liveFile).pipe(res);
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

    // Remove TODAS as conexoes antigas do mesmo agentId (sem duplicatas)
    if (agentId) {
      const toRemove = [];
      for (const [id, client] of clients) {
        if (client.agentId === agentId && id !== socket.id) {
          toRemove.push(id);
        }
      }
      toRemove.forEach(function(id) {
        clients.delete(id);
        console.log('Removido duplicado:', id, '| agentId:', agentId.slice(0, 8));
      });
    }

    const liveFile = path.join(LIVE_DIR, socket.id + '.webm');
    fs.writeFileSync(liveFile, Buffer.alloc(0));

    clients.set(socket.id, {
      id: socket.id,
      agentId: agentId,
      name: name,
      team: team,
      connectedAt: Date.now(),
      lastSeen: Date.now(),
      isOnline: true,
      isRecording: false,
      hasLiveStream: true,
      monitorNames: {},
      stats: { cpu: 0, network: 0 }
    });
    io.emit('clients:update', Array.from(clients.values()));
    console.log('Registrado:', name, '| online:', clients.size);
  });

  socket.on('live:chunk', function(data) {
    const client = clients.get(socket.id);
    if (!client) return;

    try {
      const liveFile = path.join(LIVE_DIR, socket.id + '.webm');
      const chunkBuf = Buffer.from(data, 'base64');
      fs.appendFileSync(liveFile, chunkBuf);
    } catch (err) {
      console.error('Erro ao salvar chunk:', err);
    }
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

setInterval(function() {
  const now = Date.now();
  const maxAge = 5 * 60 * 1000; // 5 minutos sem heartbeat = offline
  try {
    const files = fs.readdirSync(LIVE_DIR);
    files.forEach(function(f) {
      const fp = path.join(LIVE_DIR, f);
      const stat = fs.statSync(fp);
      if (now - stat.mtimeMs > maxAge) {
        fs.unlinkSync(fp);
      }
    });
  } catch {}

  // Remove clientes offline antigos
  for (const [id, client] of clients) {
    if (now - client.lastSeen > maxAge) {
      clients.delete(id);
    }
  }
  io.emit('clients:update', Array.from(clients.values()));
}, 60 * 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', function() {
  console.log('Servidor rodando na porta ' + PORT);
});
