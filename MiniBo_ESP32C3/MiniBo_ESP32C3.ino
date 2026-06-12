/*
 * ============================================================
 * MiniBo — Firmware ESP32-C3 Super Mini (Versão de Produção)
 * Controla 4 servos via WebSocket com movimentos biônicos amortecidos
 * Sistema de looping contínuo por comando
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

// Definição dos Pinos
const int PINO_FFE = 5;   // Front Left (FL)
const int PINO_FFD = 6;   // Front Right (FR)
const int PINO_FTE = 7;   // Back Left (BL)
const int PINO_FTD = 8;   // Back Right (BR)

Servo sFFE, sFFD, sFTE, sFTD;
WebSocketsClient webSocket;

// Estrutura de posições
struct legs_t {
    int fl, fr, bl, br;
};

// Posição em tempo real das pernas
legs_t cur_legs = {90, 90, 90, 90};

// Offsets para garantir o ponto morto ideal (90°)
const int OFFSET_FFE = 0;   // Base 90
const int OFFSET_FFD = 11;  // Base 101
const int OFFSET_FTE = 5;   // Base 95
const int OFFSET_FTD = 7;   // Base 97

// Gerenciador de Estado
String comandoAtual = "PARAR";
String comandoAnterior = "";

// --- Funções de Atuação com Inversão de Software Transparente ---
void set_fl(int deg) { cur_legs.fl = deg; sFFE.write(deg + OFFSET_FFE); }
void set_fr(int deg) { cur_legs.fr = deg; sFFD.write((180 - deg) + OFFSET_FFD); } 
void set_bl(int deg) { cur_legs.bl = deg; sFTE.write((180 - deg) + OFFSET_FTE); } 
void set_br(int deg) { cur_legs.br = deg; sFTD.write(deg + OFFSET_FTD); }

// --- Motor de Interpolação Orgânica (Smoothstep) ---
void ease_to(legs_t to, int duration_ms) {
    legs_t from = cur_legs;
    int steps = 20;
    for (int i = 0; i <= steps; i++) {
        float t = (float)i / steps;
        float e = t * t * (3.0f - 2.0f * t);
        set_fl(from.fl + (int)((to.fl - from.fl) * e));
        set_fr(from.fr + (int)((to.fr - from.fr) * e));
        set_bl(from.bl + (int)((to.bl - from.bl) * e));
        set_br(from.br + (int)((to.br - from.br) * e));
        delay(duration_ms / steps);
    }
}

void reset_to_neutral() {
    ease_to({90, 90, 90, 90}, 500);
    delay(150);
}

// ============================================================
// ANIMAÇÕES E COMPORTAMENTOS
// ============================================================

void anim_sit_down_six_seven() {
    reset_to_neutral();
    legs_t lean = {75, 75, 90, 90};     
    legs_t sit = {90, 90, 110, 110};    
    legs_t bounce = {75, 75, 120, 120}; 
    legs_t settle = {90, 90, 135, 135}; 

    ease_to(lean, 600); delay(200);
    ease_to(sit, 700); delay(200);
    ease_to(bounce, 150); delay(80);
    ease_to(settle, 150); delay(400);

    for (int i = 0; i < 3; i++) {
        ease_to({20, 75, 135, 135}, 350); delay(150);
        ease_to({75, 20, 135, 135}, 350); delay(150);
    }
    
    ease_to(settle, 400); delay(300);
    reset_to_neutral();
}

void anim_walk() {
    reset_to_neutral();
    ease_to({100, 100, 80, 80}, 600); delay(300);

    int cycles = 6;
    for (int i = 0; i < cycles; i++) {
        legs_t phase_a_front = {80, 60, 80, 80}; 
        legs_t phase_a_full  = {80, 60, 120, 120};  
        ease_to(phase_a_front, 220); ease_to(phase_a_full, 220); delay(60);

        legs_t phase_b_front = {100, 120, 120, 120};  
        legs_t phase_b_full  = {100, 120, 80, 80}; 
        ease_to(phase_b_front, 220); ease_to(phase_b_full, 220); delay(60);
    }
    ease_to({100, 100, 80, 80}, 400);
    reset_to_neutral();
}

void anim_move_backward() {
    ease_to({80, 80, 100, 100}, 400); 
    
    for(int i=0; i<6; i++) {
        ease_to({120, 100, 100, 100}, 220); ease_to({120, 100, 80, 80}, 220);
        ease_to({60, 80, 80, 80}, 220); ease_to({60, 80, 120, 120}, 220);
    }
    reset_to_neutral();
}

void anim_turn_left() {
    for(int i=0; i<4; i++) {
        ease_to({120, 60, 90, 90}, 200); 
        ease_to({120, 60, 120, 60}, 200); 
        ease_to({90, 90, 120, 60}, 200); 
        ease_to({90, 90, 90, 90}, 200); 
    }
}

void anim_turn_right() {
    for(int i=0; i<4; i++) {
        ease_to({60, 120, 90, 90}, 200); 
        ease_to({60, 120, 60, 120}, 200); 
        ease_to({90, 90, 60, 120}, 200); 
        ease_to({90, 90, 90, 90}, 200); 
    }
}

void anim_good_boy() {
    reset_to_neutral();
    int wag_angles[] = {75, 105, 70, 110, 75, 105, 82, 98, 90};
    int wag_times[]  = {120, 120, 110, 110, 100, 100, 90, 90, 80};
    int n = sizeof(wag_angles) / sizeof(wag_angles[0]);

    for (int i = 0; i < n; i++) {
        set_bl(wag_angles[i]);
        set_br(180 - wag_angles[i]);
        delay(wag_times[i]);
    }
    reset_to_neutral();
}

void anim_lie_down() {
    reset_to_neutral();
    ease_to({60, 60, 90, 90}, 500); delay(150);
    ease_to({80, 80, 60, 60}, 500); delay(100);
    ease_to({120, 120, 50, 50}, 200); delay(80);
    ease_to({180, 180, 0, 0}, 600); delay(300); 
}

void anim_stretch() {
    reset_to_neutral();
    ease_to({160, 160, 90, 90}, 1000); delay(600);
    ease_to({90, 90, 90, 90}, 800); delay(300);
    ease_to({90, 90, 30, 30}, 1000); delay(600);
    reset_to_neutral();
}

void anim_dance() {
    reset_to_neutral();
    for (int i = 0; i < 3; i++) {
        ease_to({60, 90, 90, 60}, 350); delay(100);
        ease_to({90, 60, 60, 90}, 350); delay(100);
    }
    ease_to({90, 90, 90, 90}, 400);

    for(int i=0; i<2; i++) {
        ease_to({120, 120, 120, 120}, 400); delay(150);
        ease_to({60, 60, 60, 60}, 400); delay(150);
    }
    
    ease_to({180, 180, 0, 0}, 600); delay(400);
    for (int i = 0; i < 4; i++) {
        ease_to({170, 180, 0, 10}, 200); delay(50);
        ease_to({180, 170, 10, 0}, 200); delay(50);
    }
    ease_to({180, 180, 0, 0}, 300); delay(400);
    reset_to_neutral();
}

// --- Processador WebSocket ---
void webSocketEvent(WStype_t type, uint8_t* payload, size_t length) {
    switch (type) {
        case WStype_DISCONNECTED:
            comandoAtual = "PARAR"; 
            break;
        case WStype_TEXT: {
            // Converte os dados do payload para String usando o tamanho exato (mais seguro)
            String comando = "";
            for (size_t i = 0; i < length; i++) {
                comando += (char)payload[i];
            }
            comando.trim();

            // MÁGICA AQUI: O robô recebe o "PING" para se manter conectado ao servidor,
            // mas NÃO deixa ele substituir a ação que está sendo executada!
            if (comando == "PING") {
                return; 
            }

            comandoAtual = comando;
            break;
        }
    }
}

void conectarWifi() {
    if (WiFi.status() == WL_CONNECTED) return;
    WiFi.disconnect(true);  
    delay(1000);            
    WiFi.mode(WIFI_STA);    
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    while (WiFi.status() != WL_CONNECTED) {
        delay(500);
    }
}

void setup() {
    Serial.begin(115200);

    ESP32PWM::allocateTimer(0);
    ESP32PWM::allocateTimer(1);
    ESP32PWM::allocateTimer(2);
    ESP32PWM::allocateTimer(3);

    sFFE.setPeriodHertz(50);
    sFFD.setPeriodHertz(50);
    sFTE.setPeriodHertz(50);
    sFTD.setPeriodHertz(50);

    sFFE.attach(PINO_FFE);
    sFFD.attach(PINO_FFD);
    sFTE.attach(PINO_FTE);
    sFTD.attach(PINO_FTD);
    
    reset_to_neutral(); 
    delay(1000);

    // WiFi e WebSocket em Produção
    conectarWifi();
    webSocket.beginSSL(WS_HOST, WS_PORT, WS_PATH, "", "");
    webSocket.onEvent(webSocketEvent);
    webSocket.setReconnectInterval(3000);
    webSocket.enableHeartbeat(15000, 3000, 2);
}

void loop() {
    // Mantém a conexão ativa
    if (WiFi.status() != WL_CONNECTED) { conectarWifi(); }
    webSocket.loop();

    // Sistema de execução contínua com base no último comando
    if (comandoAtual == "PARAR") {
        if (comandoAnterior != "PARAR") {
            reset_to_neutral();
            comandoAnterior = "PARAR";
        }
    } else {
        comandoAnterior = comandoAtual;

        if (comandoAtual == "FRENTE")         { anim_walk(); }
        else if (comandoAtual == "TRAS")      { anim_move_backward(); }
        else if (comandoAtual == "DIREITA")   { anim_turn_right(); }
        else if (comandoAtual == "ESQUERDA")  { anim_turn_left(); }
        else if (comandoAtual == "SENTAR")    { anim_sit_down_six_seven(); }
        else if (comandoAtual == "DEITAR")    { anim_lie_down(); }
        else if (comandoAtual == "ALONGAR")   { anim_stretch(); }
        else if (comandoAtual == "DANCAR")    { anim_dance(); }
        else if (comandoAtual == "ALEGRE")    { anim_good_boy(); }
    }
}