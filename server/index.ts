import { WebSocketServer, WebSocket } from 'ws';

// Define a porta onde o servidor vai rodar
const port = 8080;
const wss = new WebSocketServer({ port });

console.log(`Servidor WebSocket rodando na porta ${port}...`);

// Evento disparado toda vez que alguém (Site ou ESP32) se conecta
wss.on('connection', (ws: WebSocket) => {
  console.log('Novo cliente conectado!');

  // Evento disparado quando o servidor recebe uma mensagem
  ws.on('message', (data: Buffer) => {
    const mensagem = data.toString();
    console.log(`Comando recebido: ${mensagem}`);

    // Broadcast: Pega a mensagem de quem enviou (Site) e distribui para os outros (ESP32)
    wss.clients.forEach((client) => {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(mensagem);
      }
    });
  });

  // Evento disparado quando alguém perde a conexão
  ws.on('close', () => {
    console.log('Cliente desconectado.');
  });
});