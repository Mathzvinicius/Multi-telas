FROM node:20-slim

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY server/ ./server/
COPY public/ ./public/

EXPOSE 3000

CMD ["node", "server/server.js"]
