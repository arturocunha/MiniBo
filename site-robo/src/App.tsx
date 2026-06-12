import { useState, useEffect, useRef, useCallback } from 'react';
import './App.css';

function App() {
  const [abaAtiva, setAbaAtiva] = useState<'voz' | 'visao' | 'manual'>('voz');
  const [statusWs, setStatusWs] = useState('A ligar...');
  
  // Estados Globais
  const comandoRoboRef = useRef<string>("PARAR");

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
  
  // Anti-Flicker: Exige que o gesto se mantenha igual por 5 frames seguidos
  const filtroGestoRef = useRef({ comando: 'PARAR', contagem: 0 });

  const ws = useRef<WebSocket | null>(null);

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

  const enviarComando = (novoComando: string) => {
    if (novoComando !== comandoRoboRef.current) {
      comandoRoboRef.current = novoComando;
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
  // 3. VISÃO COMPUTACIONAL (LÓGICA GEOMÉTRICA DE GESTOS)
  // =========================================================================
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

      // Desenha as bolinhas verdes nas juntas
      canvasCtx.save();
      for (let i = 0; i < 21; i++) {
        const x = landmarks[i].x * W;
        const y = landmarks[i].y * H;
        canvasCtx.beginPath();
        canvasCtx.arc(x, y, 4, 0, 2 * Math.PI);
        canvasCtx.fillStyle = '#00ff00';
        canvasCtx.fill();
      }
      canvasCtx.restore();

      // MÁGICA 1: Saber quais dedos estão esticados (Ponta do dedo acima da base)
      const isIndexUp = landmarks[8].y < landmarks[6].y;
      const isMiddleUp = landmarks[12].y < landmarks[10].y;
      const isRingUp = landmarks[16].y < landmarks[14].y;
      const isPinkyUp = landmarks[20].y < landmarks[18].y;

      // MÁGICA 2: Saber se o polegar está aberto ou dobrado para dentro
      const isThumbOut = Math.abs(landmarks[4].x - landmarks[9].x) > Math.abs(landmarks[3].x - landmarks[9].x);

      // MÁGICA 3: Medir distâncias entre as pontas dos dedos para sinais especiais
      // Distância Polegar - Indicador (Para o sinal de OK)
      const distThumbIndex = Math.hypot(landmarks[8].x - landmarks[4].x, landmarks[8].y - landmarks[4].y);
      const isOkSign = distThumbIndex < 0.08; // Se estiverem muito próximos

      // Distâncias para o Star Trek (Buraco entre dedo médio e anelar)
      const distMiddleRing = Math.hypot(landmarks[12].x - landmarks[16].x, landmarks[12].y - landmarks[16].y);
      const distIndexMiddle = Math.hypot(landmarks[8].x - landmarks[12].x, landmarks[8].y - landmarks[12].y);
      const distRingPinky = Math.hypot(landmarks[16].x - landmarks[20].x, landmarks[16].y - landmarks[20].y);
      
      const isStarTrek = isIndexUp && isMiddleUp && isRingUp && isPinkyUp && 
                         (distMiddleRing > distIndexMiddle * 1.5) && 
                         (distMiddleRing > distRingPinky * 1.5);

      // ==============================================================
      // NOVO DICIONÁRIO DE GESTOS DO MINIBO (Por prioridade)
      // ==============================================================
      if (isOkSign && isMiddleUp && isRingUp && isPinkyUp) {
        detectadoComando = "ALONGAR"; detectadoNome = "👌 Sinal de OK (Alongar)";
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
      else if (!isIndexUp && !isMiddleUp && !isRingUp && !isPinkyUp) {
        detectadoComando = "PARAR"; detectadoNome = "✊ Mão Fechada (Parar)";
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
      else if (isIndexUp && isMiddleUp && isRingUp && isPinkyUp) {
        // Se 4 dedos estão pra cima, a diferença é o polegar (Aberto = 5, Fechado = 4)
        if (isThumbOut) {
          detectadoComando = "FRENTE"; detectadoNome = "🖐️ Mão Aberta (Frente)";
        } else {
          detectadoComando = "DEITAR"; detectadoNome = "✋ 4 Dedos (Deitar)";
        }
      }
      else {
        // Gesto de transição confuso
        detectadoComando = "PARAR"; detectadoNome = "⏳ Analisando...";
      }
    }

    // SISTEMA ANTI-FLICKER (Debounce)
    if (detectadoComando === filtroGestoRef.current.comando) {
      filtroGestoRef.current.contagem++;
    } else {
      filtroGestoRef.current = { comando: detectadoComando, contagem: 1 };
    }

    // Só consolida o envio se a mão ficou parada no mesmo gesto por uns 5 frames
    if (filtroGestoRef.current.contagem >= 5) {
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
    if (!Hands) return alert("Aguarde o carregamento das bibliotecas de IA...");
    
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
    } catch (erro) { alert("Erro na câmera. Verifique se permitiu o acesso."); }
  };

  const desligarVision = () => {
    visaoAtivaRef.current = false; cancelAnimationFrame(loopVisaoRef.current); 
    if (streamRef.current) streamRef.current.getTracks().forEach(track => track.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraLigada(false); 
    setComandoAtualVisao('PARAR'); setGestoNome('Nenhum'); enviarComando("PARAR");
  };

  // =========================================================================
  // GESTÃO DE ABAS (Desliga ferramentas ao trocar)
  // =========================================================================
  useEffect(() => {
    if (abaAtiva !== 'voz' && ouvindoVoz) alternarMicrofone();
    if (abaAtiva !== 'visao' && cameraLigada) desligarVision();
    enviarComando("PARAR");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abaAtiva]);

  // =========================================================================
  // INTERFACE
  // =========================================================================
  return (
    <div style={{ fontFamily: 'Arial', padding: '20px', textAlign: 'center', backgroundColor: '#1e1e1e', color: 'white', minHeight: '100vh', touchAction: 'none' }}>
      <h1>Painel de Controle do MiniBo</h1>
      <p>Status do Servidor: <strong>{statusWs}</strong></p>

      <div style={{ marginBottom: '20px', display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: '10px' }}>
        <button onClick={() => setAbaAtiva('voz')} style={{ padding: '10px 20px', backgroundColor: abaAtiva === 'voz' ? '#007bff' : '#444', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}>🗣️ Comando de Voz</button>
        <button onClick={() => setAbaAtiva('visao')} style={{ padding: '10px 20px', backgroundColor: abaAtiva === 'visao' ? '#007bff' : '#444', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}>👁️ Visão Computacional</button>
        <button onClick={() => setAbaAtiva('manual')} style={{ padding: '10px 20px', backgroundColor: abaAtiva === 'manual' ? '#007bff' : '#444', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}>🎮 Controle Manual</button>
      </div>

      <hr style={{ borderColor: '#444' }} />

      {/* TELA DE COMANDO DE VOZ */}
      {abaAtiva === 'voz' && (
        <div style={{ marginTop: '30px' }}>
          <h2>Controle por Comando de Voz Estável</h2>
          <p style={{ color: '#aaa' }}>
            Diga: <strong>Frente, Trás, Esquerda, Direita, Sentar, Deitar, Alongar, Dançar, Alegre, Parar</strong>
          </p>
          <button onClick={alternarMicrofone} style={{ padding: '20px 40px', fontSize: '20px', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', marginTop: '10px', backgroundColor: ouvindoVoz ? '#dc3545' : '#28a745' }}>{ouvindoVoz ? '🛑 Parar Ouvinte' : '🎙️ Ativar Ouvinte'}</button>
          
          <div style={{ marginTop: '30px', minHeight: '40px' }}>
             <p style={{ color: '#aaa', margin: 0 }}>O navegador ouviu:</p>
             <h3 style={{ color: '#ffc107', marginTop: '5px', fontStyle: 'italic' }}>
               {ouvindoVoz ? `"${fraseOuvida}"` : 'Microfone desligado'}
             </h3>
          </div>

          <div style={{ marginTop: '20px', padding: '20px', backgroundColor: '#333', borderRadius: '10px', display: 'inline-block', minWidth: '300px' }}>
            <p style={{ margin: 0, fontSize: '18px', color: '#aaa' }}>Robô Executando:</p>
            <p style={{ margin: '10px 0 0 0', fontSize: '36px', fontWeight: 'bold', color: comandoAtualVoz === 'PARAR' ? '#dc3545' : '#17a2b8' }}>{comandoAtualVoz}</p>
          </div>
        </div>
      )}

      {/* TELA DE VISÃO COMPUTACIONAL */}
      {abaAtiva === 'visao' && (
        <div style={{ marginTop: '30px' }}>
          <h2>Reconhecimento de Gestos da Mão</h2>
          <p style={{ color: '#aaa', fontSize: '14px', maxWidth: '600px', margin: '0 auto 20px auto' }}>
            Faça gestos na câmera! Punho = Parar | Mão Aberta = Frente | 1 Dedo = Esquerda | 2 Dedos = Trás | 3 Dedos = Direita | 4 Dedos = Deitar | Star Trek = Sentar | OK = Alongar | Rock = Dançar | Hang Loose = Alegre
          </p>
          
          <button onClick={cameraLigada ? desligarVision : iniciarVision} style={{ padding: '15px 30px', fontSize: '16px', backgroundColor: cameraLigada ? '#dc3545' : '#28a745', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', marginBottom: '20px' }}>
            {cameraLigada ? '❌ Desligar Câmera' : '🤖 Ligar IA de Mão'}
          </button>
          
          <br />
          
          <div style={{ position: 'relative', width: '640px', height: '480px', margin: '0 auto', border: cameraLigada ? '3px solid #007bff' : '3px solid #555', borderRadius: '10px', backgroundColor: '#000', overflow: 'hidden' }}>
            <video ref={videoRef} playsInline muted style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} />
            <canvas ref={canvasRef} width="640" height="480" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 10, transform: 'scaleX(-1)' }} />
            
            {cameraLigada && (
              <div style={{ position: 'absolute', bottom: '20px', left: '20px', backgroundColor: 'rgba(0,0,0,0.85)', padding: '15px', borderRadius: '10px', textAlign: 'left', zIndex: 20, minWidth: '220px' }}>
                <p style={{ margin: 0, fontSize: '14px', color: '#aaa' }}>Gesto Detectado:</p>
                <p style={{ margin: '5px 0 10px 0', fontWeight: 'bold', color: '#ffff00', fontSize: '18px' }}>{gestoNome}</p>
                <hr style={{ borderColor: '#444', margin: '10px 0' }} />
                <p style={{ margin: 0, fontSize: '14px', color: '#aaa' }}>Ação do Robô:</p>
                <p style={{ margin: '5px 0 0 0', fontWeight: 'bold', color: comandoAtualVisao === 'PARAR' ? '#dc3545' : '#17a2b8', fontSize: '24px' }}>{comandoAtualVisao}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TELA DE CONTROLE MANUAL */}
      {abaAtiva === 'manual' && (
        <div style={{ marginTop: '30px', opacity: 0.5 }}>
          <h2>Pilote o MiniBo Manualmente</h2>
          <p style={{ color: '#ffcc00' }}>⚠️ Temporariamente desativado enquanto focamos na IA.</p>
        </div>
      )}
    </div>
  );
}

export default App;