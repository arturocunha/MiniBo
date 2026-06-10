/*
 * ============================================================
 *  MiniBo — Firmware ESP32-C3 Super Mini
 *  Controla 4 servos de 360° via WebSocket (servidor Railway)
 * ============================================================
 *
 *  Protocolo WebSocket:
 *    Recebe string CSV:  "v1,v2,v3,v4"
 *    Cada valor de -100 a 100  (0 = parado)
 *
 *  Mapeamento de motores:
 *    v1 → FFE  (Frente Frente Esquerda)  pino 5
 *    v2 → FFD  (Frente Frente Direita)   pino 6
 *    v3 → FTE  (Frente Trás Esquerda)    pino 7
 *    v4 → FTD  (Frente Trás Direita)     pino 8
 *
 *  Bibliotecas necessárias (Gerenciador de Bibliotecas Arduino):
 *    - ESP32Servo         (Kevin Harrington)
 *    - WebSockets         (Markus Sattler) ← "arduinoWebSockets"
 *
 *  Board: ESP32C3 Dev Module  (Arduino-ESP32 ≥ 2.0)
 * ============================================================
 */

#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ESP32Servo.h>

// ----------------------------------------------------------------
//  CONFIGURAÇÕES — edite aqui
// ----------------------------------------------------------------
const char* WIFI_SSID     = "Telemeteam";        // Nome da rede Wi-Fi
const char* WIFI_PASSWORD = "12345678";           // Senha da rede Wi-Fi

// URL do servidor Railway (apenas o host, sem https://)
const char* WS_HOST = "minibo-production.up.railway.app";
const int   WS_PORT = 80;
const char* WS_PATH = "/";

// Pinos PWM dos servos (verifique o seu esquema elétrico)
const int PINO_FFE = 5;   // Motor Frente-Esquerda (dianteiro)
const int PINO_FFD = 6;   // Motor Frente-Direita  (dianteiro)
const int PINO_FTE = 7;   // Motor Trás-Esquerda   (traseiro)
const int PINO_FTD = 8;   // Motor Trás-Direita    (traseiro)

// Valor de ponto-morto do servo (90 = parado em servos de 360°)
// Ajuste ±2 se o seu servo não parar perfeitamente em 90
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

// Converte valor -100..100 para ângulo 0..180 (servo 360°)
// -100 → 0°  (giro máximo sentido A)
//    0 → 90° (parado)
// +100 → 180° (giro máximo sentido B)
int valorParaAngulo(int valor) {
  valor = constrain(valor, -100, 100);
  return map(valor, -100, 100, 0, 180);
}

// Para todos os motores imediatamente
void pararTodos() {
  sFFE.write(SERVO_STOP);
  sFFD.write(SERVO_STOP);
  sFTE.write(SERVO_STOP);
  sFTD.write(SERVO_STOP);
  Serial.println("[Motores] PARADO");
}

// ----------------------------------------------------------------
//  Parser CSV  "v1,v2,v3,v4"
//  Retorna true se 4 valores foram extraídos com sucesso
// ----------------------------------------------------------------
bool parsearComando(const String& cmd, int valores[4]) {
  String s = cmd;
  s.trim();
  int idx = 0;
  int inicio = 0;

  for (int i = 0; i <= s.length(); i++) {
    if (s[i] == ',' || s[i] == '\0' || i == (int)s.length()) {
      if (idx >= 4) return false;          // mais campos do que esperado
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
      Serial.println("[WS] Conectado ao servidor!");
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

        Serial.printf("[Motores] FFE=%d  FFD=%d  FTE=%d  FTD=%d  "
                      "(angulos: %d %d %d %d)\n",
                      v[0], v[1], v[2], v[3],
                      valorParaAngulo(v[0]), valorParaAngulo(v[1]),
                      valorParaAngulo(v[2]), valorParaAngulo(v[3]));
      } else {
        Serial.println("[AVISO] Formato de comando inválido. Esperado: v1,v2,v3,v4");
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
//  Conexão Wi-Fi (com timeout e retry automático)
// ----------------------------------------------------------------
void conectarWifi() {
  if (WiFi.status() == WL_CONNECTED) return;

  Serial.printf("[WiFi] Conectando a '%s'", WIFI_SSID);
  WiFi.mode(WIFI_STA);
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
    Serial.println("\n[WiFi] Falha na conexão. Será tentado de novo em breve.");
  }
}

// ----------------------------------------------------------------
//  Setup
// ----------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n=== MiniBo ESP32-C3 iniciando ===");

  // Inicializa servos e garante que ficam parados
  sFFE.attach(PINO_FFE);
  sFFD.attach(PINO_FFD);
  sFTE.attach(PINO_FTE);
  sFTD.attach(PINO_FTD);
  pararTodos();

  // Conecta ao Wi-Fi
  conectarWifi();

  // Inicia WebSocket
  // setReconnectInterval: tenta reconectar automaticamente se cair
  webSocket.begin(WS_HOST, WS_PORT, WS_PATH);
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(3000);   // tenta a cada 3 segundos

  // Opcional: envia ping a cada 15 s para manter a conexão viva
  webSocket.enableHeartbeat(15000, 3000, 2);

  Serial.println("[Setup] Pronto. Aguardando comandos...");
}

// ----------------------------------------------------------------
//  Loop principal
// ----------------------------------------------------------------
void loop() {
  // Mantém o Wi-Fi activo — reconecta se cair
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[WiFi] Conexão perdida. Reconectando...");
    conectarWifi();
  }

  // Processa eventos WebSocket
  webSocket.loop();
}
