const { spawn } = require('child_process');
const { Client } = require('ngrok');
const http = require('http');

async function waitForServer(url) {
  return new Promise((resolve) => {
    const check = () => {
      http.get(url, (res) => {
        if (res.statusCode === 200) resolve();
        else setTimeout(check, 500);
      }).on('error', () => setTimeout(check, 500));
    };
    check();
  });
}

async function main() {
  console.log('Iniciando servidor local...');
  const server = spawn('node', ['server/server.js'], { stdio: 'inherit', shell: true });
  await waitForServer('http://localhost:3000');
  console.log('\nServidor pronto. Iniciando ngrok...');
  const client = await Client.connect({ authtoken_from_env: false, addr: 3000 });
  console.log('\n========================================');
  console.log('  URL PUBLICA DO SERVIDOR:', client.url);
  console.log('  Dashboard:', client.url + '/dashboard.html');
  console.log('  Agente:', client.url + '/capture.html');
  console.log('========================================\n');
  process.on('SIGINT', () => {
    server.kill();
    client.kill();
    process.exit();
  });
}

main().catch((err) => {
  console.error('Erro:', err.message);
  process.exit(1);
});
