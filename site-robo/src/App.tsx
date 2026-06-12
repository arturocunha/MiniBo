import { useState, useEffect, useRef, useCallback } from 'react';
import './App.css';

function App() {
  const [abaAtiva, setAbaAtiva] = useState<'voz' | 'visao' | 'manual'>('voz');
  const [statusWs, setStatusWs] = useState('A ligar...');
  
  // Estados Globais
  const comandoRoboRef = useRef<string>("PARAR");
  const ultimoEnvioRef = useRef<number>(0);

  // ==================== ESTADOS DA VOZ ====================
  const [comandoAtualVoz, setComandoAtualVoz] = useState('PARAR');
  const [ouvindoVoz, setOuvindoVoz] = useState(false);
  const [fraseOuvida, setFraseOuvida] = useState('');
  const recognitionRef = useRef<any>(null); 
  const ouvindoRef = useRef(false); 

  // ==================== ESTADOS DA VISÃO ====================
  const [cameraLigada, setCameraLigada] = useState(false); 
  const [comandoAtualVisao, setComandoAtualVisao] = useState('PARAR');
  const [gestoNome, setGestoNome] = useState('Nenhum');
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null); 
  const handsRef = useRef<any>(null); 
  const loopVisaoRef = useRef<number>(0); 
  const visaoAtivaRef = useRef<boolean>(false);
  
  // Anti-Flicker
  const filtroGestoRef = useRef({ comando: 'PARAR', contagem: 0 });

  const ws = useRef<WebSocket | null>(null);

  // Trava a rolagem da tela globalmente
  useEffect(() => {
    document.body.style.margin = "0";
    document.body.style.padding = "0";
    document.body.style.overflow = "hidden";
    document.body.style.backgroundColor = "#1e1e1e";
  }, []);

  // =========================================================================
  // 1. LIGAÇÃO WEBSOCKET (KEEP-ALIVE)
  // =========================================================================
  useEffect(() => {
    const protocoloWs = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.hostname;
    const porta = window.location.port === '5173' ? '3000' : window.location.port;
    const urlWs = `${protocoloWs}//${host}:${porta}`;
    
    const conectar = () => {
      ws.current = new WebSocket(urlWs);
      ws.current.onopen = () => setStatusWs('Ligado 🟢');
      ws.current.onclose = () => {
        setStatusWs('Desligado 🔴');
        setTimeout(conectar, 3000);
      };
      ws.current.onerror = () => setStatusWs('Erro na ligação ⚠️');
    };

    conectar();

    const keepAlive = setInterval(() => {
      if (ws.current && ws.current.readyState === WebSocket.OPEN) {
        ws.current.send("PING");
      }
    }, 10000);

    return () => {
      clearInterval(keepAlive);
      ws.current?.close();
    };
  }, []);

  // ENVIO INTELIGENTE (SEM FILA / SEM BUFFER BLOAT)
  const enviarComando = (novoComando: string) => {
    if (novoComando !== comandoRoboRef.current) {
      const agora = Date.now();
      
      // Se não for "PARAR", espera pelo menos 1.5s entre comandos 
      // para dar tempo do robô fazer a animação e não enfileirar ações.
      if (novoComando !== "PARAR" && agora - ultimoEnvioRef.current < 1500) {
        return; 
      }

      comandoRoboRef.current = novoComando;
      ultimoEnvioRef.current = agora;
      
      if (ws.current && ws.current.readyState === WebSocket.OPEN) {
        ws.current.send(novoComando);
      }
    }
  };

  // =========================================================================
  // 2. COMANDO DE VOZ
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
        
        let novo = comandoRoboRef.current; 
        if (/\b(frente|avançar|vai|andar)\b/.test(fala)) novo = "FRENTE";
        else if (/\b(esquerda|left)\b/.test(fala)) novo = "ESQUERDA";
        else if (/\b(direita|right)\b/.test(fala)) novo = "DIREITA";
        else if (/\b(tr[aász]|r[eé]|recuar)\b/.test(fala)) novo = "TRAS";
        else if (/\b(senta|sentar)\b/.test(fala)) novo = "SENTAR";
        else if (/\b(deita|deitar)\b/.test(fala)) novo = "DEITAR";
        else if (/\b(estica|alongar|espreguiça|espreguiçar)\b/.test(fala)) novo = "ALONGAR";
        else if (/\b(dança|dançar|dancinha)\b/.test(fala)) novo = "DANCAR";
        else if (/\b(feliz|alegre|abana|fofo)\b/.test(fala)) novo = "ALEGRE";
        else if (/\b(para|pare|parar|stop)\b/.test(fala)) novo = "PARAR";

        setComandoAtualVoz(novo);
        enviarComando(novo);
      };

      recognitionRef.current.onend = () => { 
        if (ouvindoRef.current) recognitionRef.current.start(); 
      };
    }
  }, []); 

  const alternarMicrofone = () => {
    if (!recognitionRef.current) return alert("Navegador não suporta voz.");
    if (ouvindoVoz) { 
      ouvindoRef.current = false; setOuvindoVoz(false); recognitionRef.current.stop(); 
      setComandoAtualVoz("PARAR"); setFraseOuvida(''); enviarComando("PARAR");
    } else { 
      ouvindoRef.current = true; setOuvindoVoz(true); recognitionRef.current.start(); 
    }
  };

  // =========================================================================
  // 3. VISÃO COMPUTACIONAL (NOVA LÓGICA POR DISTÂNCIA E CONTAGEM)
  // =========================================================================
  const getDist = (p1: any, p2: any) => Math.hypot(p1.x - p2.x, p1.y - p2.y);

  const onResultsHand = useCallback((results: any) => {
    if (!canvasRef.current || !visaoAtivaRef.current) return;
    const canvasCtx = canvasRef.current.getContext('2d');
    if (!canvasCtx) return;

    const W = canvasRef.current.width;
    const H = canvasRef.current.height;
    canvasCtx.clearRect(0, 0, W, H);

    let detectadoComando = "PARAR";
    let detectadoNome = "🚫 Nenhuma mão detectada";

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
      const landmarks = results.multiHandLandmarks[0];

      canvasCtx.save();
      for (let i = 0; i < 21; i++) {
        canvasCtx.beginPath();
        canvasCtx.arc(landmarks[i].x * W, landmarks[i].y * H, 4, 0, 2 * Math.PI);
        canvasCtx.fillStyle = '#00ff00';
        canvasCtx.fill();
      }
      canvasCtx.restore();

      const wrist = landmarks[0];
      
      // Verifica se o dedo está esticado comparando a distância da ponta até o pulso 
      // com a distância da articulação do meio até o pulso. Funciona em qualquer ângulo!
      const isIndexUp  = getDist(wrist, landmarks[8])  > getDist(wrist, landmarks[6]) * 1.1;
      const isMiddleUp = getDist(wrist, landmarks[12]) > getDist(wrist, landmarks[10]) * 1.1;
      const isRingUp   = getDist(wrist, landmarks[16]) > getDist(wrist, landmarks[14]) * 1.1;
      const isPinkyUp  = getDist(wrist, landmarks[20]) > getDist(wrist, landmarks[18]) * 1.1;

      // Polegar para fora? (Compara a base do mindinho)
      const isThumbOut = getDist(landmarks[4], landmarks[17]) > getDist(landmarks[2], landmarks[17]);

      // Distâncias Especiais
      const distThumbIndex = getDist(landmarks[4], landmarks[8]);
      const isOkSign = distThumbIndex < 0.05 && isMiddleUp && isRingUp && isPinkyUp; // Dedão e Ind. colados
      
      // Star Trek (Buraco entre dedo médio e anelar)
      const distMiddleRing = getDist(landmarks[12], landmarks[16]);
      const distIndexMiddle = getDist(landmarks[8], landmarks[12]);
      const isStarTrek = isIndexUp && isMiddleUp && isRingUp && isPinkyUp && (distMiddleRing > distIndexMiddle * 1.8);

      // --- MAPEAMENTO EXATO DOS SINAIS ---
      if (isOkSign) {
        detectadoComando = "ALONGAR"; detectadoNome = "👌 OK (Alongar)";
      } 
      else if (isStarTrek) {
        detectadoComando = "SENTAR"; detectadoNome = "🖖 Star Trek (Sentar)";
      } 
      else if (isIndexUp && !isMiddleUp && !isRingUp && isPinkyUp) {
        detectadoComando = "DANCAR"; detectadoNome = "🤘 Rock (Dançar)";
      } 
      else if (!isIndexUp && !isMiddleUp && !isRingUp && isPinkyUp && isThumbOut) {
        detectadoComando = "ALEGRE"; detectadoNome = "🤙 Hang Loose (Alegre)";
      } 
      else if (!isIndexUp && !isMiddleUp && !isRingUp && !isPinkyUp && !isThumbOut) {
        detectadoComando = "PARAR"; detectadoNome = "✊ 0 Dedos (Parar)";
      } 
      else if (isIndexUp && !isMiddleUp && !isRingUp && !isPinkyUp) {
        detectadoComando = "ESQUERDA"; detectadoNome = "☝️ 1 Dedo (Esquerda)";
      } 
      else if (isIndexUp && isMiddleUp && !isRingUp && !isPinkyUp) {
        detectadoComando = "TRAS"; detectadoNome = "✌️ 2 Dedos (Trás)";
      } 
      else if (isIndexUp && isMiddleUp && isRingUp && !isPinkyUp) {
        detectadoComando = "DIREITA"; detectadoNome = "3️⃣ 3 Dedos (Direita)";
      } 
      else if (isIndexUp && isMiddleUp && isRingUp && isPinkyUp && !isThumbOut) {
        detectadoComando = "DEITAR"; detectadoNome = "✋ 4 Dedos (Deitar)";
      } 
      else if (isIndexUp && isMiddleUp && isRingUp && isPinkyUp && isThumbOut) {
        detectadoComando = "FRENTE"; detectadoNome = "🖐️ Mão Aberta (Frente)";
      } 
      else {
        // Ignora transições bizarras da mão e mantem parado/aguardando
        detectadoComando = "PARAR"; detectadoNome = "⏳ Lendo Mão...";
      }
    }

    // DEBOUNCE (15 frames = A mão precisa estar parada na mesma pose por ~0.5s)
    if (detectadoComando === filtroGestoRef.current.comando) {
      filtroGestoRef.current.contagem++;
    } else {
      filtroGestoRef.current = { comando: detectadoComando, contagem: 1 };
    }

    if (filtroGestoRef.current.contagem >= 15) {
      setGestoNome(detectadoNome);
      setComandoAtualVisao(detectadoComando);
      enviarComando(detectadoComando);
    }

  }, []);

  const processarFrameRef = useRef<() => void>(() => {});
  processarFrameRef.current = async () => {
    if (visaoAtivaRef.current && videoRef.current && handsRef.current) {
      if (videoRef.current.readyState >= 2) {
        try { await handsRef.current.send({ image: videoRef.current }); } catch {}
      }
      loopVisaoRef.current = requestAnimationFrame(processarFrameRef.current);
    }
  };

  const iniciarVision = async () => {
    if (!videoRef.current || !canvasRef.current) return;
    const Hands = (window as any).Hands;
    if (!Hands) return alert("Aguarde a IA carregar...");
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
      streamRef.current = stream; videoRef.current.srcObject = stream;
      handsRef.current = new Hands({ locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}` });
      handsRef.current.setOptions({ maxNumHands: 1, modelComplexity: 1, minDetectionConfidence: 0.7, minTrackingConfidence: 0.7 });
      handsRef.current.onResults(onResultsHand);
      
      videoRef.current.onloadedmetadata = () => {
        if (videoRef.current && canvasRef.current) {
          videoRef.current.play();
          canvasRef.current.width = videoRef.current.videoWidth; 
          canvasRef.current.height = videoRef.current.videoHeight;
        }
        visaoAtivaRef.current = true; setCameraLigada(true); processarFrameRef.current();
      };
    } catch (erro) { alert("Câmera bloqueada."); }
  };

  const desligarVision = () => {
    visaoAtivaRef.current = false; cancelAnimationFrame(loopVisaoRef.current); 
    if (streamRef.current) streamRef.current.getTracks().forEach(track => track.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraLigada(false); setComandoAtualVisao('PARAR'); setGestoNome('Nenhum'); enviarComando("PARAR");
  };

  useEffect(() => {
    if (abaAtiva !== 'voz' && ouvindoVoz) alternarMicrofone();
    if (abaAtiva !== 'visao' && cameraLigada) desligarVision();
    enviarComando("PARAR");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abaAtiva]);

  // =========================================================================
  // INTERFACE - RESPONSIVA, FLEXBOX E SEM ROLAGEM
  // =========================================================================
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', color: 'white', fontFamily: 'Arial' }}>
      
      {/* HEADER FIXO */}
      <div style={{ padding: '10px 20px', textAlign: 'center', flexShrink: 0 }}>
        <h2 style={{ margin: '5px 0' }}>MiniBo Painel</h2>
        <p style={{ margin: '0 0 10px 0', fontSize: '14px' }}>Rede: <strong>{statusWs}</strong></p>
        
        <div style={{ display: 'flex', justifyContent: 'center', gap: '8px' }}>
          <button onClick={() => setAbaAtiva('voz')} style={{ padding: '8px 15px', backgroundColor: abaAtiva === 'voz' ? '#007bff' : '#444', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}>🗣️ Voz</button>
          <button onClick={() => setAbaAtiva('visao')} style={{ padding: '8px 15px', backgroundColor: abaAtiva === 'visao' ? '#007bff' : '#444', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}>👁️ Visão</button>
          <button onClick={() => setAbaAtiva('manual')} style={{ padding: '8px 15px', backgroundColor: abaAtiva === 'manual' ? '#007bff' : '#444', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}>🎮 Manual</button>
        </div>
      </div>

      {/* ÁREA DE CONTEÚDO (Ocupa o resto da tela, não rola) */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' }}>
        
        {/* ================= ABA VOZ ================= */}
        {abaAtiva === 'voz' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
            <p style={{ color: '#aaa', textAlign: 'center' }}>Diga: Frente, Trás, Esquerda, Direita, Sentar, Deitar, Alongar, Dançar, Alegre, Parar</p>
            <button onClick={alternarMicrofone} style={{ padding: '20px 40px', fontSize: '20px', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', backgroundColor: ouvindoVoz ? '#dc3545' : '#28a745', marginBottom: '20px' }}>
              {ouvindoVoz ? '🛑 Parar Ouvinte' : '🎙️ Ativar Ouvinte'}
            </button>
            <p style={{ color: '#ffc107', fontStyle: 'italic', height: '30px' }}>{ouvindoVoz ? `"${fraseOuvida}"` : ''}</p>
            <div style={{ padding: '20px', backgroundColor: '#333', borderRadius: '10px', minWidth: '250px', textAlign: 'center' }}>
              <p style={{ margin: 0, color: '#aaa' }}>Executando:</p>
              <p style={{ margin: '10px 0 0 0', fontSize: '30px', fontWeight: 'bold', color: comandoAtualVoz === 'PARAR' ? '#dc3545' : '#17a2b8' }}>{comandoAtualVoz}</p>
            </div>
          </div>
        )}

        {/* ================= ABA VISÃO ================= */}
        {abaAtiva === 'visao' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            
            {/* Controles da Visão */}
            <div style={{ padding: '10px', textAlign: 'center', flexShrink: 0 }}>
              <button onClick={cameraLigada ? desligarVision : iniciarVision} style={{ padding: '10px 20px', fontSize: '14px', backgroundColor: cameraLigada ? '#dc3545' : '#28a745', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>
                {cameraLigada ? '❌ Desligar Câmera' : '🤖 Ligar Câmera'}
              </button>
            </div>

            {/* Container do Vídeo (Preenche o resto da tela, ajusta aspect-ratio) */}
            <div style={{ flex: 1, position: 'relative', backgroundColor: '#000' }}>
              <video ref={videoRef} playsInline muted style={{ width: '100%', height: '100%', objectFit: 'contain', transform: 'scaleX(-1)' }} />
              <canvas ref={canvasRef} style={{ width: '100%', height: '100%', objectFit: 'contain', position: 'absolute', top: 0, left: 0, transform: 'scaleX(-1)' }} />
              
              {/* LEGENDA FLUTUANTE (No topo esquerdo, não empurra nada) */}
              {cameraLigada && (
                <div style={{ position: 'absolute', top: '15px', left: '15px', backgroundColor: 'rgba(0,0,0,0.7)', padding: '10px 15px', borderRadius: '8px', zIndex: 20 }}>
                  <p style={{ margin: 0, fontSize: '12px', color: '#aaa' }}>Gesto:</p>
                  <p style={{ margin: '2px 0 5px 0', fontWeight: 'bold', color: '#ffff00', fontSize: '16px' }}>{gestoNome}</p>
                  <p style={{ margin: 0, fontSize: '12px', color: '#aaa' }}>Comando:</p>
                  <p style={{ margin: '2px 0 0 0', fontWeight: 'bold', color: comandoAtualVisao === 'PARAR' ? '#dc3545' : '#17a2b8', fontSize: '18px' }}>{comandoAtualVisao}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ================= ABA MANUAL ================= */}
        {abaAtiva === 'manual' && (
           <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
             <p style={{ color: '#ffcc00' }}>⚠️ Desativado enquanto focamos na IA.</p>
           </div>
        )}

      </div>
    </div>
  );
}

export default App;