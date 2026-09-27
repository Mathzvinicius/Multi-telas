# Deploy Online - Guia Rapido
## Opcao 1: Teste rapido com ngrok (5 minutos)

1. Instale o ngrok: https://ngrok.com/download
2. Faca cadastro gratuito em https://dashboard.ngrok.com/signup
3. Execute: ngrok http 3000
4. O ngrok vai mostrar uma URL publica, ex: https://abc123.ngrok.io
5. Use essa URL no dashboard e no agente

## Opcao 2: Deploy em VPS (produção)

1. Compre uma VPS barata (Hostinger, DigitalOcean, AWS, Azure)
2. Instale Node.js na VPS
3. Suba o projeto com PM2:
   npm install -g pm2
   pm2 start server/server.js --name monitoramento
   pm2 startup
   pm2 save

4. Aponte um dominio para o IP da VPS
5. Instale certificado SSL:
   npm install -g certbot
   certbot --nginx

6. Configure o agente para conectar em https://seu-dominio.com

## Opcao 3: Deploy em plataforma cloud (Railway/Render/Fly.io)

1. Suba o servidor em uma plataforma cloud
2. Use o servico de dominio/SSL deles
3. Configure o agente para conectar na URL deles

## Configuracao do Agente para online

Edite o arquivo agent/.env ou configure a variavel de ambiente:
SERVER_URL=https://sua-url-publica.com

## Teste local primeiro
1. Inicie o servidor: npm run server
2. Abra o dashboard: http://localhost:3000/dashboard.html
3. Abra o agente: http://localhost:3000/capture.html
4. Depois use ngrok para expor publicamente
