/*
 * ============================================================
 * MiniBo — Firmware ESP32-C3 Super Mini
 * Controla 4 servos de 360° via WebSocket (servidor Railway)
 * (Modo Produção: Sem logs de Serial)
 * ============================================================
 */

#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ESP32Servo.h>

const char* WIFI_SSID     = "Telemeteam";        
const char* WIFI_PASSWORD = "12345678";          

const char* WS_HOST = "minibo-production.up.railway.app";
const int   WS_PORT = 443; 
const char* WS_PATH = "/";

const int PINO_FFE = 5;   
const int PINO_FFD = 6;   
const int PINO_FTE = 7;   
const int PINO_FTD = 8;   

int FFE = 0, FFD = 0, FTE = 0, FTD = 0;
bool parado = true;   

// Ponto-morto de Servo 360° é 90
const int SERVO_STOP = 90;

Servo sFFE, sFFD, sFTE, sFTD;
WebSocketsClient webSocket;

int valorParaAngulo(int valor) {
  valor = constrain(valor, -100, 100);
  return map(valor, -100, 100, 0, 180);
}

int STOP_FFE = 1540; 
int STOP_FFD = 1540;
int STOP_FTE = 1540;
int STOP_FTD = 1540;

void pararTodos() {
  sFFE.writeMicroseconds(STOP_FFE); 
  sFFD.writeMicroseconds(STOP_FFD);
  sFTE.writeMicroseconds(STOP_FTE);
  sFTD.writeMicroseconds(STOP_FTD);
  parado = true;
}

void frente() {
  parado = false;
  sFFE.writeMicroseconds(2400); 
  sFTE.writeMicroseconds(2400);
  sFFD.writeMicroseconds(500);  
  sFTD.writeMicroseconds(500);
}

void tras() {
  parado = false;
  sFFE.writeMicroseconds(500);
  sFTE.writeMicroseconds(500);
  sFFD.writeMicroseconds(2400);
  sFTD.writeMicroseconds(2400);
}

void direita() {
  parado = false;
  sFFE.writeMicroseconds(2400);
  sFTE.writeMicroseconds(2400);
  sFFD.writeMicroseconds(2400);
  sFTD.writeMicroseconds(2400);
}

void esquerda() {
  parado = false;
  sFFE.writeMicroseconds(500);
  sFTE.writeMicroseconds(500);
  sFFD.writeMicroseconds(500);
  sFTD.writeMicroseconds(500);
}

// bool parsearComando(const String& cmd, int valores[4]) {
//   String s = cmd;
//   s.trim();
//   int idx = 0;
//   int inicio = 0;
//   for (int i = 0; i <= s.length(); i++) {
//     if (s[i] == ',' || s[i] == '\0' || i == (int)s.length()) {
//       if (idx >= 4) return false;          
//       valores[idx++] = s.substring(inicio, i).toInt();
//       inicio = i + 1;
//     }
//   }
//   return (idx == 4);
// }

void webSocketEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_DISCONNECTED:
      parado = true;
      pararTodos();
      break;

    case WStype_TEXT: {
      String comando = String((char*)payload);
      comando.trim();

      if (comando == "PARAR") {
        pararTodos();
      }else if (comando == "FRENTE") {
        frente();
      }else if (comando == "TRAS") {
        tras();
      }else if (comando == "DIREITA") {
        direita();
      }else if (comando == "ESQUERDA") {
        esquerda();
      }

      
      break;
    }
    // Os outros cases (CONNECTED e ERROR) foram removidos pois serviam apenas para print
  }
}

void conectarWifi() {
  if (WiFi.status() == WL_CONNECTED) return;

  WiFi.disconnect(true);  
  delay(1000);            
  WiFi.mode(WIFI_STA);    
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  // Fica travado aqui até o Wi-Fi conectar
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
  }
}

void setup() {

  ESP32PWM::allocateTimer(0);
  ESP32PWM::allocateTimer(1);
  ESP32PWM::allocateTimer(2);
  ESP32PWM::allocateTimer(3);

  sFFE.setPeriodHertz(50);
  sFFD.setPeriodHertz(50);
  sFTE.setPeriodHertz(50);
  sFTD.setPeriodHertz(50);

  sFFE.attach(PINO_FFE, 500, 2400);
  sFFD.attach(PINO_FFD, 500, 2400);
  sFTE.attach(PINO_FTE, 500, 2400);
  sFTD.attach(PINO_FTD, 500, 2400);
  
  //conectarWifi();
  pararTodos();
  delay(1000);

  // webSocket.beginSSL(WS_HOST, WS_PORT, WS_PATH, "", "");
  // webSocket.onEvent(webSocketEvent);
  // webSocket.setReconnectInterval(3000);
  // webSocket.enableHeartbeat(15000, 3000, 2);
}

void loop() {
  // if (WiFi.status() != WL_CONNECTED) {
  //   conectarWifi();
  // }

  //webSocket.loop();

  frente();
  delay(500);

  // tras();
  // delay(3000);
  // pararTodos();
  // delay(1000);
  
  // direita();
  // delay(3000);
  // pararTodos();
  // delay(1000);
  
  // esquerda();
  // delay(3000);
  // pararTodos();
  // delay(1000);
}
