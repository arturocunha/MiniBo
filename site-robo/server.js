import express from 'express';
import { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'dist')));

app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});

const wss = new WebSocketServer({ server });

// CORREÇÃO: identifica quem é o painel (site) e quem é o robô (ESP32)
// O painel envia comandos como "100,100,100,100"
// O ESP32 pode se identificar enviando "ESP32_CONNECTED" ao conectar

const clientes = new Set();

wss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress;
  console.log(`Cliente conectado: ${ip}`);
  clientes.add(ws);

  ws.on('message', (message) => {
    const texto = message.toString();

    // Faz broadcast para TODOS os outros clientes conectados
    // Isso garante que o ESP32 receba os comandos do painel
    // e que o painel receba status do ESP32 (se implementado)
    clientes.forEach((client) => {
      if (client !== ws && client.readyState === 1) {
        client.send(texto);
      }
    });
  });

  ws.on('close', () => {
    console.log(`Cliente desconectado: ${ip}`);
    clientes.delete(ws);
  });

  ws.on('error', (err) => {
    console.error(`Erro no cliente ${ip}:`, err.message);
    clientes.delete(ws);
  });
});