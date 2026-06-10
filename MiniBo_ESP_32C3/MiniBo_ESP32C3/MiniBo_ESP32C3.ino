/*
 * ============================================================
 * MiniBo — Firmware ESP32-C3 Super Mini
 * Controla 4 servos de 360° via WebSocket (servidor Railway)
 * ============================================================
 */

#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ESP32Servo.h>

// ----------------------------------------------------------------
//  CONFIGURAÇÕES — edite aqui
// ----------------------------------------------------------------
const char* WIFI_SSID     = "Telemeteam";        // Nome da rede Wi-Fi
const char* WIFI_PASSWORD = "12345678";          // Senha da rede Wi-Fi

// URL do servidor Railway (apenas o host, sem https://)
const char* WS_HOST = "minibo-production.up.railway.app";
const int   WS_PORT = 443; // <--- MUDADO PARA 443 (Porta Segura SSL/WSS)
const char* WS_PATH = "/";

// Pinos PWM dos servos (verifique o seu esquema elétrico)
const int PINO_FFE = 5;   // Motor Frente-Esquerda (dianteiro)
const int PINO_FFD = 6;   // Motor Frente-Direita  (dianteiro)
const int PINO_FTE = 7;   // Motor Trás-Esquerda   (traseiro)
const int PINO_FTD = 8;   // Motor Trás-Direita    (traseiro)

// Valor de ponto-morto do servo (90 = parado em servos de 360°)
const int SERVO_STOP = 90;

// ----------------------------------------------------------------
//  Objetos globais
// ----------------------------------------------------------------
Servo sFFE, sFFD, sFTE, sFTD;
WebSocketsClient webSocket;

bool wsConectado = false;

// ----------------------------------------------------------------
//  Utilitários
// ----------------------------------------------------------------

int valorParaAngulo(int valor) {
  valor = constrain(valor, -100, 100);
  return map(valor, -100, 100, 0, 180);
}

void pararTodos() {
  sFFE.write(SERVO_STOP);
  sFFD.write(SERVO_STOP);
  sFTE.write(SERVO_STOP);
  sFTD.write(SERVO_STOP);
  Serial.println("[Motores] PARADO");
}

// ----------------------------------------------------------------
//  Parser CSV  "v1,v2,v3,v4"
// ----------------------------------------------------------------
bool parsearComando(const String& cmd, int valores[4]) {
  String s = cmd;
  s.trim();
  int idx = 0;
  int inicio = 0;

  for (int i = 0; i <= s.length(); i++) {
    if (s[i] == ',' || s[i] == '\0' || i == (int)s.length()) {
      if (idx >= 4) return false;          
      valores[idx++] = s.substring(inicio, i).toInt();
      inicio = i + 1;
    }
  }
  return (idx == 4);
}

// ----------------------------------------------------------------
//  Callback WebSocket
// ----------------------------------------------------------------
void webSocketEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {

    case WStype_CONNECTED:
      wsConectado = true;
      Serial.println("[WS] Conectado ao servidor na Nuvem!");
      break;

    case WStype_DISCONNECTED:
      wsConectado = false;
      Serial.println("[WS] Desconectado. Parando motores por segurança.");
      pararTodos();
      break;

    case WStype_TEXT: {
      String comando = String((char*)payload);
      Serial.print("[WS] Recebido: ");
      Serial.println(comando);

      int v[4];
      if (parsearComando(comando, v)) {
        sFFE.write(valorParaAngulo(v[0]));
        sFFD.write(valorParaAngulo(v[1]));
        sFTE.write(valorParaAngulo(v[2]));
        sFTD.write(valorParaAngulo(v[3]));

        Serial.printf("[Motores] FFE=%d  FFD=%d  FTE=%d  FTD=%d\n", v[0], v[1], v[2], v[3]);
      } else {
        Serial.println("[AVISO] Formato invalido.");
      }
      break;
    }

    case WStype_ERROR:
      Serial.println("[WS] Erro de conexão.");
      break;

    default:
      break;
  }
}

// ----------------------------------------------------------------
//  Conexão Wi-Fi (COM CORREÇÃO DE MEMÓRIA)
// ----------------------------------------------------------------
void conectarWifi() {
  if (WiFi.status() == WL_CONNECTED) return;

  Serial.printf("\n[WiFi] Conectando a '%s'\n", WIFI_SSID);

  // --- O TRUQUE PARA LIMPAR A MEMÓRIA DA ESP32 ---
  WiFi.disconnect(true);  // Força a desconexão e limpa a NVS
  delay(1000);            // Dá tempo para o chip de rádio respirar
  WiFi.mode(WIFI_STA);    // Garante que está no modo Estação (Cliente)
  // -----------------------------------------------

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int tentativas = 0;
  while (WiFi.status() != WL_CONNECTED && tentativas < 40) {
    delay(500);
    Serial.print(".");
    tentativas++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println();
    Serial.print("[WiFi] Conectado! IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\n[WiFi] Falha na conexão. Sera tentado de novo.");
  }
}

// ----------------------------------------------------------------
//  Setup
// ----------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n=== MiniBo ESP32-C3 iniciando ===");

  // Configuração recomendada para servos no ESP32
  sFFE.setPeriodHertz(50);
  sFFD.setPeriodHertz(50);
  sFTE.setPeriodHertz(50);
  sFTD.setPeriodHertz(50);

  sFFE.attach(PINO_FFE, 500, 2400);
  sFFD.attach(PINO_FFD, 500, 2400);
  sFTE.attach(PINO_FTE, 500, 2400);
  sFTD.attach(PINO_FTD, 500, 2400);
  
  pararTodos();

  conectarWifi();

  // <--- A MÁGICA ACONTECE AQUI --->
  // Usamos beginSSL para forçar a conexão criptografada exigida pelo Railway
  webSocket.beginSSL(WS_HOST, WS_PORT, WS_PATH, "", "");
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(3000);

  // Mantém a conexão ativa com pings
  webSocket.enableHeartbeat(15000, 3000, 2);

  Serial.println("[Setup] Pronto. Aguardando comandos...");
}

// ----------------------------------------------------------------
//  Loop principal
// ----------------------------------------------------------------
void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[WiFi] Conexão perdida. Reconectando...");
    conectarWifi();
  }

  webSocket.loop();
}
