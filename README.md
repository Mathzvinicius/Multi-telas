# Monitoramento de Colaboradores

Sistema de monitoramento de tela com streaming ao vivo, gravacao local e dashboard web. Projeto LGPD-compliant: o usuario sabe que esta sendo monitorado e ve o status da transmissao.

## Estrutura do projeto

```text
monitoramento-colaboradores/
├── server/
│   └── server.js
├── public/
│   ├── dashboard.html
│   └── capture.html
├── app/
│   └── src/
│       ├── main.js
│       ├── preload.js
│       └── index.html
├── agent/
│   ├── index-silent.js
│   ├── launcher.vbs
│   ├── install.bat
│   └── uninstall.bat
├── scripts/
│   └── tunnel.js
├── package.json
├── README.md
└── DEPLOY.md
```

## Como funciona

### 1) App do colaborador
- App desktop para Windows que captura a tela periodicamente.
- Detecta multiplos monitores.
- Transmite frames e metadados para o servidor via Socket.IO.
- Salva gravacoes locais em `.webm` quando estiver offline.
- Envia as gravacoes automaticamente quando voltar a ficar online.
- Mostra status da transmissao em tempo real.
- Inicia automaticamente no boot.

### 2) Servidor
- Servidor Node.js + Express + Socket.IO.
- Recebe os frames em tempo real.
- Armazena gravacoes `.webm` enviadas pelos colaboradores.
- Expoe API REST para listar e baixar gravacoes.
- Serve o dashboard web.

### 3) Dashboard do gestor
- Interface web para ver todos os colaboradores em tempo real.
- Exibe frames ao vivo, status online/offline e apps em uso.
- Permite buscar, filtrar e baixar gravacoes `.webm`.
- Separacao por monitor quando houver multiplos monitores.

## Como rodar

### Servidor + dashboard
```bash
npm install
npm run server
```
Depois abra:
- Dashboard: http://localhost:3000/dashboard.html
- Captura web: http://localhost:3000/capture.html

### App desktop (Electron)
```bash
cd app
npm install
npm run electron-dev
```

### Empacotar instalador
```bash
cd app
npm run dist
```
O `.exe` sera gerado em `app/dist/`.

## Deploy online

Veja `DEPLOY.md` para opcoes de deploy online e como usar o tunel para teste rapido.

## Importante

Use este sistema apenas em ambiente onde voce tem autorizacao para monitorar e de acordo com a legislacao trabalhista e LGPD. O colaborador deve ser informado formalmente e concordar com o monitoramento.
