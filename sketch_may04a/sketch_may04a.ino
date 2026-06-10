#include <WiFi.h>
#include <WebServer.h>
#include <ESP32Servo.h>

// =========================================================================
// 1. CONFIGURAÇÕES DA REDE WI-FI
// =========================================================================
const char* ssid = "Telemeteam";
const char* password = "12345678";

// Cria o servidor web na porta padrão 80
WebServer server(80);

// =========================================================================
// 2. CONFIGURAÇÕES DOS MOTORES
// =========================================================================
Servo rodaFrenteEsq;
Servo rodaFrenteDir;
Servo rodaTrasEsq;
Servo rodaTrasDir;

const int pinoFFE = 5; 
const int pinoFFD = 6; 
const int pinoFTE = 7; 
const int pinoFTD = 8; 

// =========================================================================
// 3. FUNÇÃO DE MAPEAMENTO DE VELOCIDADE
// =========================================================================
// Transforma a velocidade enviada pelo site (-100 a 100) no sinal do Servo (0 a 180)
int mapearVelocidade(int velocidadeSite) {
  // Se o site mandar 0, garante a trava no 90 absoluto
  if (velocidadeSite == 0) return 90; 
  
  // Limita os valores recebidos para não quebrar o cálculo
  if (velocidadeSite > 100) velocidadeSite = 100;
  if (velocidadeSite < -100) velocidadeSite = -100;
  
  // Converte a escala: -100~100 vira 0~180
  return map(velocidadeSite, -100, 100, 0, 180);
}

// =========================================================================
// 4. ROTEAMENTO DO SITE (O QUE A ESP32 FAZ QUANDO RECEBE O COMANDO)
// =========================================================================
void receberComandosMotores() {
  // Verifica se o site enviou os 4 parâmetros esperados
  if (server.hasArg("ffe") && server.hasArg("ffd") && server.hasArg("fte") && server.hasArg("ftd")) {
    
    // Lê os valores como inteiros (ex: 100, -50, 0)
    int v_ffe = server.arg("ffe").toInt();
    int v_ffd = server.arg("ffd").toInt();
    int v_fte = server.arg("fte").toInt();
    int v_ftd = server.arg("ftd").toInt();

    // Converte a velocidade do site (-100 a 100) para PWM (0 a 180)
    int pwm_ffe = mapearVelocidade(v_ffe);
    int pwm_ffd = mapearVelocidade(v_ffd);
    int pwm_fte = mapearVelocidade(v_fte);
    int pwm_ftd = mapearVelocidade(v_ftd);

    // Aplica a velocidade fisicamente nas rodas
    rodaFrenteEsq.write(pwm_ffe);
    rodaFrenteDir.write(pwm_ffd);
    rodaTrasEsq.write(pwm_fte);
    rodaTrasDir.write(pwm_ftd);

    // Responde ao site liberando o bloqueio de CORS
    server.sendHeader("Access-Control-Allow-Origin", "*");
    server.send(200, "text/plain", "Motores atualizados com sucesso!");
    
    Serial.printf("Recebido do site -> FFE:%d FFD:%d FTE:%d FTD:%d\n", v_ffe, v_ffd, v_fte, v_ftd);
  } else {
    // Se o site enviar o comando faltando informações, avisa o erro também liberando o CORS
    server.sendHeader("Access-Control-Allow-Origin", "*");
    server.send(400, "text/plain", "Erro: Faltam parametros (ffe, ffd, fte, ftd)");
  }
}

// Para todos os motores por segurança
void pararTudo() {
  rodaFrenteEsq.write(90);
  rodaFrenteDir.write(90);
  rodaTrasEsq.write(90);
  rodaTrasDir.write(90);
}

// =========================================================================
// SETUP E LOOP PRINCIPAL
// =========================================================================
void setup() {
  Serial.begin(115200);
  
  // Inicia Servos
  rodaFrenteEsq.setPeriodHertz(50);
  rodaFrenteDir.setPeriodHertz(50);
  rodaTrasEsq.setPeriodHertz(50);
  rodaTrasDir.setPeriodHertz(50);

  rodaFrenteEsq.attach(pinoFFE, 500, 2400);
  rodaFrenteDir.attach(pinoFFD, 500, 2400);
  rodaTrasEsq.attach(pinoFTE, 500, 2400);
  rodaTrasDir.attach(pinoFTD, 500, 2400);
  
  pararTudo();

  // Conecta ao Wi-Fi
  Serial.println("\nConectando ao Wi-Fi...");
  WiFi.begin(ssid, password);
  
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  
  Serial.println("\nWi-Fi conectado!");
  Serial.print("Endereco IP do Robo: ");
  Serial.println(WiFi.localIP()); // ANOTE ESSE IP PARA USAR NO SEU SITE!

  // Define os caminhos da URL que a ESP32 vai escutar
  server.on("/motor", receberComandosMotores); 
  
  // Caminho rápido para parar tudo
  server.on("/parar", []() {                   
    pararTudo();
    server.sendHeader("Access-Control-Allow-Origin", "*");
    server.send(200, "text/plain", "Todos os motores parados");
  });

  // Inicia o servidor web interno
  server.begin();
  Serial.println("Servidor HTTP iniciado. Aguardando site...");
}

void loop() {
  // Mantém o servidor rodando e escutando conexões
  server.handleClient();
}
