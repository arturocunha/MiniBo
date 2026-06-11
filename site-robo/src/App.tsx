import { useState, useEffect, useRef, useCallback } from 'react';
import './App.css';

function App() {
  // =========================================================================
  // ⚙️ MATRIZ DE CALIBRAÇÃO INDEPENDENTE DOS MOTORES (Mude para 1 ou -1)
  // =========================================================================
  const MULT_FFE = 1; // Frente-Frente-Esquerda (Pino 5)
  const MULT_FFD = 1; // Frente-Frente-Direita  (Pino 6)
  const MULT_FTE = 1; // Frente-Trás-Esquerda   (Pino 7)
  const MULT_FTD = 1; // Frente-Trás-Direita    (Pino 8)

  const [abaAtiva, setAbaAtiva] = useState<'voz' | 'visao'>('voz');
  const [statusWs, setStatusWs] = useState('A ligar...');
  
  const [comandoAtualVoz, setComandoAtualVoz] = useState('PARADO');
  const [ouvindoVoz, setOuvindoVoz] = useState(false);
  const [fraseOuvida, setFraseOuvida] = useState('');
  
  const [cameraLigada, setCameraLigada] = useState(false); 
  const [infoJoystick, setInfoJoystick] = useState({ speed: 0, turn: 0, l: 0, r: 0 });

  const ws = useRef<WebSocket | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null); 
  
  const handsRef = useRef<any>(null); 
  const loopVisaoRef = useRef<number>(0); 
  const visaoAtivaRef = useRef<boolean>(false);

  const recognitionRef = useRef<any>(null); 
  const ouvindoRef = useRef(false); 
  
  const estadoMotores = useRef<[number, number, number, number]>([0, 0, 0, 0]);

  // =========================================================================
  // 1. LIGAÇÃO WEBSOCKET E TRANSMISSÃO CONTÍNUA CRONOMETRADA
  // =========================================================================
  useEffect(() => {
    // CORREÇÃO: Conecta diretamente ao servidor WebSocket (server.js)
    // Se estiver rodando em produção (porta 3000), usa o mesmo host
    // Se estiver em dev (Vite na porta 5173), aponta para a porta do servidor
    const protocoloWs = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    
    // Em desenvolvimento o Vite roda na 5173 e o server.js na 3000
    // Em produção ambos estão na mesma porta (3000)
    const host = window.location.hostname;
    const porta = window.location.port === '5173' ? '3000' : window.location.port;
    const urlWs = `${protocoloWs}//${host}:${porta}`;
    
    const conectar = () => {
      ws.current = new WebSocket(urlWs);
      ws.current.onopen = () => setStatusWs('Ligado 🟢');
      ws.current.onclose = () => {
        setStatusWs('Desligado 🔴');
        // Tenta reconectar após 3 segundos
        setTimeout(conectar, 3000);
      };
      ws.current.onerror = () => setStatusWs('Erro na ligação ⚠️');
    };

    conectar();

    const transmissor = setInterval(() => {
      if (ws.current && ws.current.readyState === WebSocket.OPEN) {
        const [ffe, ffd, fte, ftd] = estadoMotores.current;
        
        const cmdFinal = [
          ffe * MULT_FFE,
          ffd * MULT_FFD,
          fte * MULT_FTE,
          ftd * MULT_FTD
        ].join(',');

        ws.current.send(cmdFinal);
      }
    }, 100);

    return () => {
      clearInterval(transmissor);
      ws.current?.close();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // =========================================================================
  // 2. COMANDO DE VOZ — MANTÉM ESTADO (não para ao silenciar)
  // =========================================================================
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.lang = 'pt-BR'; 
      recognitionRef.current.continuous = true; 
      recognitionRef.current.interimResults = false; 

      recognitionRef.current.onresult = (event: any) => {
        const lastIndex = event.results.length - 1;
        
        if (!event.results[lastIndex].isFinal) return;

        const fala = event.results[lastIndex][0].transcript.toLowerCase().trim();
        setFraseOuvida(fala);
        
        // CORREÇÃO DOS MAPEAMENTOS:
        // Frente  = todos os motores positivos → robô vai para frente
        // Trás    = todos os motores negativos → robô vai para trás
        // Esquerda = motores esquerdos negativos, direitos positivos → gira à esquerda
        // Direita  = motores esquerdos positivos, direitos negativos → gira à direita
        //
        // Layout dos motores: [FFE, FFD, FTE, FTD]
        //   FFE/FTE = lado Esquerdo
        //   FFD/FTD = lado Direito

        if (/\b(frente|avançar|avançar|vai)\b/.test(fala)) { 
          setComandoAtualVoz("FRENTE");
          // CORREÇÃO: mantém rodando continuamente — não para até receber outro comando
          estadoMotores.current = [180, -180, 180, -180]; 
        } 
        else if (/\b(esquerda|left)\b/.test(fala)) { 
          setComandoAtualVoz("ESQUERDA");
          // Esquerda: motor esq para trás (-), motor dir para frente (+)
          estadoMotores.current = [-180, -180, -180, -180]; 
        } 
        else if (/\b(direita|right)\b/.test(fala)) { 
          setComandoAtualVoz("DIREITA");
          // Direita: motor esq para frente (+), motor dir para trás (-)
          estadoMotores.current = [180, 180, 180, 180]; 
        } 
        else if (/\b(tr[aász]|r[eé]|recuar)\b/.test(fala)) { 
          setComandoAtualVoz("TRÁS");
          estadoMotores.current = [-180, 180, -180, 180]; 
        } 
        else if (/\b(para|pare|parar|stop)\b/.test(fala)) { 
          setComandoAtualVoz("PARADO");
          // CORREÇÃO DA PARADA: envia 0,0,0,0 -> a ESP coloca os 4 servos
          // exatamente no ponto-morto (90°). Antes era 90,90,90,90, que a ESP
          // interpretava como ~171° e fazia algumas rodas continuarem girando.
          estadoMotores.current = [0, 0, 0, 0]; 
        }
        // NOTA: Se a palavra não for reconhecida, o estado anterior é MANTIDO.
        // Isso garante que "frente" continue indo pra frente até ouvir outro comando.
      };

      // CORREÇÃO: reinicia automaticamente para manter escuta contínua
      recognitionRef.current.onend = () => { 
        if (ouvindoRef.current) recognitionRef.current.start(); 
      };
    }
  }, []); 

  const alternarMicrofone = () => {
    if (!recognitionRef.current) return alert("O navegador não suporta comando de voz.");
    if (ouvindoVoz) { 
      ouvindoRef.current = false; 
      setOuvindoVoz(false); 
      recognitionRef.current.stop(); 
      // Para os motores ao desligar o microfone
      estadoMotores.current = [0, 0, 0, 0];
      setComandoAtualVoz("PARADO"); 
      setFraseOuvida('');
    } else { 
      ouvindoRef.current = true; 
      setOuvindoVoz(true); 
      recognitionRef.current.start(); 
    }
  };

  // =========================================================================
  // 3. VISÃO COMPUTACIONAL — CORREÇÃO DO LOOP E DO CANVAS
  // =========================================================================

  const [zonaAtual, setZonaAtual] = useState<string>('PARADO');

  // Divide a tela em 4 zonas triangulares + 1 QUADRADO CENTRAL de PARADA:
  //   QUADRADO CENTRAL        → PARAR (0,0,0,0)
  //   CIMA    (topo)          → FRENTE
  //   BAIXO   (rodapé)        → RÉ
  //   DIREITA / ESQUERDA      → curvas pivotadas
  // Os valores dos motores de movimento são idênticos aos do comando de voz.
  const onResultsHand = useCallback((results: any) => {
    if (!canvasRef.current || !videoRef.current || !visaoAtivaRef.current) return;

    const canvas = canvasRef.current;
    const vid = videoRef.current;
    const canvasCtx = canvas.getContext('2d');
    if (!canvasCtx) return;

    // Sincroniza dimensões
    if (vid.videoWidth && vid.videoHeight) {
      if (canvas.width !== vid.videoWidth) {
        canvas.width = vid.videoWidth;
        canvas.height = vid.videoHeight;
      }
    }

    const W = canvas.width;
    const H = canvas.height;

    canvasCtx.clearRect(0, 0, W, H);

    // ---------------------------------------------------------------------
    // Desenha as 4 zonas triangulares (a partir do centro) com transparência
    // CIMA = azul, BAIXO = vermelho, ESQUERDA = laranja, DIREITA = verde
    // Como o vídeo está espelhado (scaleX(-1)), as zonas visuais também ficam
    // espelhadas: o lado esquerdo da tela = lado direito real do usuário.
    // ---------------------------------------------------------------------
    canvasCtx.globalAlpha = 0.18;
    // Triângulo CIMA (FRENTE)
    canvasCtx.fillStyle = '#00aaff';
    canvasCtx.beginPath();
    canvasCtx.moveTo(0, 0); canvasCtx.lineTo(W, 0); canvasCtx.lineTo(W / 2, H / 2);
    canvasCtx.fill();
    // Triângulo BAIXO (RÉ)
    canvasCtx.fillStyle = '#ff3333';
    canvasCtx.beginPath();
    canvasCtx.moveTo(0, H); canvasCtx.lineTo(W, H); canvasCtx.lineTo(W / 2, H / 2);
    canvasCtx.fill();
    // Triângulo ESQUERDA da imagem (= DIREITA real por causa do espelho)
    canvasCtx.fillStyle = '#ff9900';
    canvasCtx.beginPath();
    canvasCtx.moveTo(0, 0); canvasCtx.lineTo(0, H); canvasCtx.lineTo(W / 2, H / 2);
    canvasCtx.fill();
    // Triângulo DIREITA da imagem (= ESQUERDA real)
    canvasCtx.fillStyle = '#00cc44';
    canvasCtx.beginPath();
    canvasCtx.moveTo(W, 0); canvasCtx.lineTo(W, H); canvasCtx.lineTo(W / 2, H / 2);
    canvasCtx.fill();
    canvasCtx.globalAlpha = 1.0;

    // ---------------------------------------------------------------------
    // QUADRADO CENTRAL DE PARADA
    // margemCentro = metade do lado do quadrado, em fração da tela (0 a 0.5)
    // ---------------------------------------------------------------------
    const margemCentro = 0.18;
    const sqX = (0.5 - margemCentro) * W;
    const sqY = (0.5 - margemCentro) * H;
    const sqLargura = (margemCentro * 2) * W;
    const sqAltura  = (margemCentro * 2) * H;

    canvasCtx.globalAlpha = 0.45;
    canvasCtx.fillStyle = '#222222';
    canvasCtx.fillRect(sqX, sqY, sqLargura, sqAltura);
    canvasCtx.globalAlpha = 1.0;
    canvasCtx.strokeStyle = '#ffffff';
    canvasCtx.lineWidth = 3;
    canvasCtx.strokeRect(sqX, sqY, sqLargura, sqAltura);

    // Labels das zonas (mantidos como no original)
    canvasCtx.font = 'bold 22px Arial';
    canvasCtx.textAlign = 'center';
    canvasCtx.fillStyle = 'rgba(255,255,255,0.85)';
    canvasCtx.fillText('▲ FRENTE', W / 2, 36);
    canvasCtx.fillText('▼ RÉ', W / 2, H - 16);
    // Espelhado: o label esquerdo da tela corresponde ao lado direito real
    canvasCtx.fillText('◀ DIREITA', 70, H / 2);
    canvasCtx.fillText('ESQUERDA ▶', W - 70, H / 2);

    // Texto "PARE" dentro do quadrado — des-espelhado para ficar legível
    canvasCtx.save();
    canvasCtx.translate(W / 2, H / 2);
    canvasCtx.scale(-1, 1); // desfaz o scaleX(-1) do canvas só para este texto
    canvasCtx.fillStyle = '#ffffff';
    canvasCtx.font = 'bold 30px Arial';
    canvasCtx.textAlign = 'center';
    canvasCtx.fillText('■ PARE', 0, -22);
    canvasCtx.restore();

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
      const landmarks = results.multiHandLandmarks[0];

      const drawConnectors = (window as any).drawConnectors;
      const drawLandmarks = (window as any).drawLandmarks;
      const HAND_CONNECTIONS = (window as any).HAND_CONNECTIONS;

      if (drawConnectors && drawLandmarks) {
        drawConnectors(canvasCtx, landmarks, HAND_CONNECTIONS, { color: '#ffffff', lineWidth: 3 });
        drawLandmarks(canvasCtx, landmarks, { color: '#ffff00', lineWidth: 1, radius: 5 });
      }

      // Ponto 9 = centro da palma
      const cx = landmarks[9].x; // 0 = esquerda da imagem, 1 = direita
      const cy = landmarks[9].y; // 0 = topo, 1 = base

      const dx = Math.abs(cx - 0.5);
      const dy = Math.abs(cy - 0.5);

      // A mão está dentro do quadrado central?
      const noCentro = dx < margemCentro && dy < margemCentro;

      let zona: string;
      let motores: [number, number, number, number];

      if (noCentro) {
        // Mão no quadrado central → PARAR (todos no ponto-morto)
        zona = 'PARADO';
        motores = [0, 0, 0, 0];
      } else if (dy > dx) {
        if (cy < 0.5) {
          // Mão no topo → FRENTE
          zona = 'FRENTE';
          motores = [180, -180, 180, -180];
        } else {
          // Mão embaixo → RÉ
          zona = 'RÉ';
          motores = [-180, 180, -180, 180];
        }
      } else {
        // Vídeo espelhado: cx=0 é o lado direito real do usuário
        if (cx < 0.5) {
          // Lado esquerdo da imagem = lado direito do usuário → DIREITA
          zona = 'DIREITA';
          motores = [180, 180, 180, 180];
        } else {
          // Lado direito da imagem = lado esquerdo do usuário → ESQUERDA
          zona = 'ESQUERDA';
          motores = [-180, -180, -180, -180];
        }
      }

      estadoMotores.current = motores;
      setZonaAtual(zona);
      setInfoJoystick({ speed: motores[0], turn: motores[1], l: motores[0], r: motores[1] });

      // Destaca a zona ativa com o nome no centro
      canvasCtx.strokeStyle = '#ffff00';
      canvasCtx.lineWidth = 4;
      canvasCtx.font = 'bold 40px Arial';
      canvasCtx.fillStyle = '#ffff00';
      canvasCtx.textAlign = 'center';
      canvasCtx.fillText(zona, W / 2, H / 2 + 28);

    } else {
      // Sem mão detectada → para
      estadoMotores.current = [0, 0, 0, 0];
      setZonaAtual('PARADO');
      setInfoJoystick({ speed: 0, turn: 0, l: 0, r: 0 });
    }
  }, []);

  // CORREÇÃO: processarFrame usa referência estável via ref
  const processarFrameRef = useRef<() => void>(() => {});

  processarFrameRef.current = async () => {
    if (visaoAtivaRef.current && videoRef.current && handsRef.current) {
      // Só processa se o vídeo tiver dados reais
      if (videoRef.current.readyState >= 2) {
        try {
          await handsRef.current.send({ image: videoRef.current });
        } catch {
          // ignora erros de frame
        }
      }
      loopVisaoRef.current = requestAnimationFrame(processarFrameRef.current);
    }
  };

  const iniciarVision = async () => {
    if (!videoRef.current || !canvasRef.current) return;
    const Hands = (window as any).Hands;
    if (!Hands) return alert("A aguardar bibliotecas IA...");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
      streamRef.current = stream;
      videoRef.current.srcObject = stream;

      // CORREÇÃO: recria o objeto Hands se necessário para garantir callback atualizado
      handsRef.current = new Hands({
        locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
      });
      handsRef.current.setOptions({
        maxNumHands: 1, modelComplexity: 1, minDetectionConfidence: 0.7, minTrackingConfidence: 0.7
      });
      // CORREÇÃO: usa o callback estável do useCallback
      handsRef.current.onResults(onResultsHand);

      videoRef.current.onloadedmetadata = () => {
        if (videoRef.current) {
          videoRef.current.play();
          // Sincroniza tamanho do canvas com o vídeo real
          if (canvasRef.current && videoRef.current.videoWidth) {
            canvasRef.current.width = videoRef.current.videoWidth;
            canvasRef.current.height = videoRef.current.videoHeight;
          }
        }
        visaoAtivaRef.current = true;
        setCameraLigada(true);
        processarFrameRef.current();
      };
    } catch (erro) {
      alert("Erro na câmera. Verifique se permitiu o acesso.");
    }
  };

  const desligarVision = () => {
    visaoAtivaRef.current = false;
    cancelAnimationFrame(loopVisaoRef.current); 
    if (streamRef.current) streamRef.current.getTracks().forEach(track => track.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    estadoMotores.current = [0, 0, 0, 0]; 
    setCameraLigada(false);
    setInfoJoystick({ speed: 0, turn: 0, l: 0, r: 0 });
  };

  useEffect(() => {
    if (abaAtiva !== 'visao') desligarVision();
    if (abaAtiva !== 'voz' && ouvindoVoz) alternarMicrofone();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abaAtiva]);

  return (
    <div style={{ fontFamily: 'Arial', padding: '20px', textAlign: 'center', backgroundColor: '#1e1e1e', color: 'white', minHeight: '100vh' }}>
      <h1>Painel de Controle do MiniBo</h1>
      <p>Status do Servidor: <strong>{statusWs}</strong></p>

      <div style={{ marginBottom: '20px' }}>
        <button onClick={() => setAbaAtiva('voz')} style={{ padding: '10px 20px', marginRight: '10px', backgroundColor: abaAtiva === 'voz' ? '#007bff' : '#444', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}>🗣️ Comando de Voz</button>
        <button onClick={() => setAbaAtiva('visao')} style={{ padding: '10px 20px', backgroundColor: abaAtiva === 'visao' ? '#007bff' : '#444', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}>👁️ Visão Computacional</button>
      </div>

      <hr style={{ borderColor: '#444' }} />

      {abaAtiva === 'voz' && (
        <div style={{ marginTop: '30px' }}>
          <h2>Controle por Comando de Voz Estável</h2>
          <p>Diga de forma clara: <strong>Frente, Trás, Esquerda, Direita, Parar</strong></p>
          <p style={{ color: '#aaa', fontSize: '13px' }}>💡 O robô continua em movimento até ouvir um novo comando ou "Parar"</p>
          <button onClick={alternarMicrofone} style={{ padding: '20px 40px', fontSize: '20px', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', marginTop: '10px', backgroundColor: ouvindoVoz ? '#dc3545' : '#28a745' }}>{ouvindoVoz ? '🛑 Parar Ouvinte' : '🎙️ Ativar Ouvinte'}</button>
          
          <div style={{ marginTop: '30px', minHeight: '40px' }}>
             <p style={{ color: '#aaa', margin: 0 }}>O navegador ouviu:</p>
             <h3 style={{ color: '#ffc107', marginTop: '5px', fontStyle: 'italic' }}>
               {ouvindoVoz ? `"${fraseOuvida}"` : 'Microfone desligado'}
             </h3>
          </div>

          <div style={{ marginTop: '20px', padding: '20px', backgroundColor: '#333', borderRadius: '10px', display: 'inline-block', minWidth: '300px' }}>
            <p style={{ margin: 0, fontSize: '18px', color: '#aaa' }}>Estado Atual Trancado:</p>
            <p style={{ margin: '10px 0 0 0', fontSize: '36px', fontWeight: 'bold', color: comandoAtualVoz === 'PARADO' ? '#dc3545' : '#17a2b8' }}>{comandoAtualVoz}</p>
          </div>
        </div>
      )}

      {abaAtiva === 'visao' && (
        <div style={{ marginTop: '30px' }}>
          <h2>Pilote Arrastando a Mão pela Tela</h2>
          <p style={{ color: '#aaa' }}>Topo: Frente | Rodapé: Ré | Laterais: Curva Pivotada | Centro: Pare</p>
          <button onClick={cameraLigada ? desligarVision : iniciarVision} style={{ padding: '15px 30px', fontSize: '16px', backgroundColor: cameraLigada ? '#dc3545' : '#17a2b8', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', marginBottom: '20px' }}>{cameraLigada ? '❌ Desligar Câmera' : '🤖 Ligar Câmera'}</button>
          <br />
          <div style={{ position: 'relative', width: '640px', height: '480px', margin: '0 auto', border: cameraLigada ? '3px solid #28a745' : '3px solid #555', borderRadius: '10px', backgroundColor: '#000', overflow: 'hidden' }}>
            <video ref={videoRef} playsInline muted style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} />
            <canvas ref={canvasRef} width="640" height="480" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 10, transform: 'scaleX(-1)' }} />
            {cameraLigada && (
              <div style={{ position: 'absolute', bottom: '20px', left: '20px', backgroundColor: 'rgba(0,0,0,0.75)', padding: '10px 14px', borderRadius: '8px', textAlign: 'left', fontSize: '14px', color: '#0f0', zIndex: 20 }}>
                <p style={{ margin: 0, fontWeight: 'bold', color: zonaAtual === 'PARADO' ? '#dc3545' : '#ffff00', fontSize: '18px' }}>⬛ {zonaAtual}</p>
                <hr style={{ borderColor: '#444', margin: '6px 0' }} />
                <p style={{ margin: 0 }}>Motor Esq: {infoJoystick.l}</p>
                <p style={{ margin: 0 }}>Motor Dir: {infoJoystick.r}</p>
              </div>
            )}
            {cameraLigada && (
              <div style={{ position: 'absolute', top: '50%', left: '50%', width: '12px', height: '12px', backgroundColor: 'red', borderRadius: '50%', transform: 'translate(-50%, -50%)', opacity: 0.6, zIndex: 15 }} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;