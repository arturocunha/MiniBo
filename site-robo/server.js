import express from 'express';
import { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// O Express vai servir a pasta "dist", que é onde o Vite joga o site pronto
app.use(express.static(path.join(__dirname, 'dist')));

// Qualquer URL acessada vai carregar o seu painel React
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// Inicia o servidor web
const server = app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});

// Acopla o WebSocket na MESMA porta do site
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  console.log('Robô ou Painel conectado!');

  ws.on('message', (message) => {
    // Repassa os comandos (ex: "100,100,100,100") para todos os outros conectados
    wss.clients.forEach((client) => {
      if (client !== ws && client.readyState === 1) { // 1 = OPEN
        client.send(message.toString());
      }
    });
  });
});