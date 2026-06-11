import { useState, useEffect, useRef, useCallback } from 'react';
import './App.css';

function App() {
  // =========================================================================
  // ⚙️ MATRIZ DE CALIBRAÇÃO DE SINAIS
  // =========================================================================
  const MULT_FFE = 1; 
  const MULT_FFD = 1; 
  const MULT_FTE = 1; 
  const MULT_FTD = 1; 

  const [abaAtiva, setAbaAtiva] = useState<'voz' | 'visao' | 'manual'>('manual');
  const [statusWs, setStatusWs] = useState('A ligar...');
  
  const [comandoAtualVoz, setComandoAtualVoz] = useState('PARADO');
  const [ouvindoVoz, setOuvindoVoz] = useState(false);
  const [fraseOuvida, setFraseOuvida] = useState('');
  
  const [cameraLigada, setCameraLigada] = useState(false); 

  const ws = useRef<WebSocket | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null); 
  
  const handsRef = useRef<any>(null); 
  const loopVisaoRef = useRef<number>(0); 
  const visaoAtivaRef = useRef<boolean>(false);
  const recognitionRef = useRef<any>(null); 
  const ouvindoRef = useRef(false); 
  
  // A MÁGICA ESTÁ AQUI: Evita enviar o mesmo comando repetidas vezes
  const direcaoRef = useRef('PARADO');
  const [direcaoManual, setDirecaoManual] = useState('PARADO');

  // =========================================================================
  // 1. LIGAÇÃO WEBSOCKET
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

    return () => ws.current?.close();
  }, []);

  // FUNÇÃO CENTRALIZADA: Envia o comando UMA VEZ e a ESP32 segura!
  const dispararAcao = useCallback((novaDirecao: string, motores: number[]) => {
    // Se o robô já estiver fazendo isso, não envia de novo para não afogar a placa!
    if (direcaoRef.current === novaDirecao) return; 

    direcaoRef.current = novaDirecao;
    setDirecaoManual(novaDirecao);
    setComandoAtualVoz(novaDirecao); // Unifica o visual

    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      const cmd = [
        motores[0] * MULT_FFE,
        motores[1] * MULT_FFD,
        motores[2] * MULT_FTE,
        motores[3] * MULT_FTD
      ].join(',');
      
      ws.current.send(cmd);
      console.log("Enviado para a ESP32:", cmd);
    }
  }, []);

  const pararTudo = () => dispararAcao('PARADO', [0, 0, 0, 0]);

  // =========================================================================
  // 2. MODO MANUAL: APERTOU = ANDOU | SOLTOU = PAROU
  // =========================================================================
  useEffect(() => {
    if (abaAtiva !== 'manual') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key === 'w') dispararAcao('FRENTE', [100, -100, 100, -100]);
      if (key === 's') dispararAcao('TRAS', [-100, 100, -100, 100]);
      if (key === 'a') dispararAcao('ESQUERDA', [-100, -100, -100, -100]);
      if (key === 'd') dispararAcao('DIREITA', [100, 100, 100, 100]);
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (['w', 'a', 's', 'd'].includes(key)) pararTudo();
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      pararTudo(); 
    };
  }, [abaAtiva, dispararAcao]);

  // =========================================================================
  // 3. COMANDO DE VOZ
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
        
        if (/\b(frente|avançar|vai)\b/.test(fala)) dispararAcao('FRENTE', [100, -100, 100, -100]);
        else if (/\b(esquerda|left)\b/.test(fala)) dispararAcao('ESQUERDA', [-100, -100, -100, -100]);
        else if (/\b(direita|right)\b/.test(fala)) dispararAcao('DIREITA', [100, 100, 100, 100]);
        else if (/\b(tr[aász]|r[eé]|recuar)\b/.test(fala)) dispararAcao('TRÁS', [-100, 100, -100, 100]);
        else if (/\b(para|pare|parar|stop)\b/.test(fala)) pararTudo();
      };

      recognitionRef.current.onend = () => { if (ouvindoRef.current) recognitionRef.current.start(); };
    }
  }, [dispararAcao]); 

  const alternarMicrofone = () => {
    if (!recognitionRef.current) return alert("Navegador não suporta voz.");
    if (ouvindoVoz) { 
      ouvindoRef.current = false; 
      setOuvindoVoz(false); 
      recognitionRef.current.stop(); 
      pararTudo();
      setFraseOuvida('');
    } else { 
      ouvindoRef.current = true; 
      setOuvindoVoz(true); 
      recognitionRef.current.start(); 
    }
  };

  // =========================================================================
  // 4. VISÃO COMPUTACIONAL 
  // =========================================================================
  const onResultsHand = useCallback((results: any) => {
    if (!canvasRef.current || !videoRef.current || !visaoAtivaRef.current) return;
    const canvasCtx = canvasRef.current.getContext('2d');
    if (!canvasCtx) return;

    const W = canvasRef.current.width; const H = canvasRef.current.height;
    canvasCtx.clearRect(0, 0, W, H);

    canvasCtx.globalAlpha = 0.18;
    canvasCtx.fillStyle = '#00aaff'; canvasCtx.beginPath(); canvasCtx.moveTo(0,0); canvasCtx.lineTo(W,0); canvasCtx.lineTo(W/2,H/2); canvasCtx.fill();
    canvasCtx.fillStyle = '#ff3333'; canvasCtx.beginPath(); canvasCtx.moveTo(0,H); canvasCtx.lineTo(W,H); canvasCtx.lineTo(W/2,H/2); canvasCtx.fill();
    canvasCtx.fillStyle = '#ff9900'; canvasCtx.beginPath(); canvasCtx.moveTo(0,0); canvasCtx.lineTo(0,H); canvasCtx.lineTo(W/2,H/2); canvasCtx.fill();
    canvasCtx.fillStyle = '#00cc44'; canvasCtx.beginPath(); canvasCtx.moveTo(W,0); canvasCtx.lineTo(W,H); canvasCtx.lineTo(W/2,H/2); canvasCtx.fill();
    canvasCtx.globalAlpha = 1.0;

    const margemCentro = 0.18;
    const sqX = (0.5 - margemCentro) * W, sqY = (0.5 - margemCentro) * H, sqL = (margemCentro * 2) * W, sqA = (margemCentro * 2) * H;
    canvasCtx.globalAlpha = 0.45; canvasCtx.fillStyle = '#222'; canvasCtx.fillRect(sqX, sqY, sqL, sqA); canvasCtx.globalAlpha = 1.0;
    canvasCtx.strokeStyle = '#fff'; canvasCtx.lineWidth = 3; canvasCtx.strokeRect(sqX, sqY, sqL, sqA);

    canvasCtx.font = 'bold 22px Arial'; canvasCtx.fillStyle = 'rgba(255,255,255,0.85)'; canvasCtx.textAlign = 'center';
    canvasCtx.fillText('▲ FRENTE', W/2, 36); canvasCtx.fillText('▼ RÉ', W/2, H-16); canvasCtx.fillText('◀ DIREITA', 70, H/2); canvasCtx.fillText('ESQUERDA ▶', W-70, H/2);

    canvasCtx.save(); canvasCtx.translate(W/2, H/2); canvasCtx.scale(-1, 1); 
    canvasCtx.font = 'bold 30px Arial'; canvasCtx.fillText('■ PARE', 0, -22); canvasCtx.restore();

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
      const landmarks = results.multiHandLandmarks[0];
      const cx = landmarks[9].x, cy = landmarks[9].y; 
      const dx = Math.abs(cx - 0.5), dy = Math.abs(cy - 0.5);
      
      if (dx < margemCentro && dy < margemCentro) dispararAcao('PARADO', [0, 0, 0, 0]);
      else if (dy > dx) {
        if (cy < 0.5) dispararAcao('FRENTE', [100, -100, 100, -100]);
        else dispararAcao('RÉ', [-100, 100, -100, 100]);
      } else {
        if (cx < 0.5) dispararAcao('DIREITA', [100, 100, 100, 100]);
        else dispararAcao('ESQUERDA', [-100, -100, -100, -100]);
      }

      const drawConnectors = (window as any).drawConnectors;
      const drawLandmarks = (window as any).drawLandmarks;
      const HAND_CONNECTIONS = (window as any).HAND_CONNECTIONS;
      if (drawConnectors && drawLandmarks) {
        drawConnectors(canvasCtx, landmarks, HAND_CONNECTIONS, { color: '#ffffff', lineWidth: 3 });
        drawLandmarks(canvasCtx, landmarks, { color: '#ffff00', lineWidth: 1, radius: 5 });
      }
    } else {
      pararTudo();
    }
  }, [dispararAcao]);

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
    if (!Hands) return alert("A aguardar bibliotecas IA...");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
      streamRef.current = stream; videoRef.current.srcObject = stream;
      handsRef.current = new Hands({ locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}` });
      handsRef.current.setOptions({ maxNumHands: 1, modelComplexity: 1, minDetectionConfidence: 0.7, minTrackingConfidence: 0.7 });
      handsRef.current.onResults(onResultsHand);
      videoRef.current.onloadedmetadata = () => {
        if (videoRef.current) {
          videoRef.current.play();
          if (canvasRef.current && videoRef.current.videoWidth) {
            canvasRef.current.width = videoRef.current.videoWidth; canvasRef.current.height = videoRef.current.videoHeight;
          }
        }
        visaoAtivaRef.current = true; setCameraLigada(true); processarFrameRef.current();
      };
    } catch (erro) { alert("Erro na câmera."); }
  };

  const desligarVision = () => {
    visaoAtivaRef.current = false; cancelAnimationFrame(loopVisaoRef.current); 
    if (streamRef.current) streamRef.current.getTracks().forEach(track => track.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    pararTudo(); setCameraLigada(false); 
  };

  useEffect(() => {
    if (abaAtiva !== 'visao') desligarVision();
    if (abaAtiva !== 'voz' && ouvindoVoz) alternarMicrofone();
  }, [abaAtiva]);

  const btnStyle = {
    width: '80px', height: '80px', fontSize: '24px', fontWeight: 'bold', 
    backgroundColor: '#007bff', color: 'white', border: 'none', 
    borderRadius: '15px', cursor: 'pointer', userSelect: 'none' as const,
    boxShadow: '0 6px 0 #0056b3', touchAction: 'none'
  };

  return (
    <div style={{ fontFamily: 'Arial', padding: '20px', textAlign: 'center', backgroundColor: '#1e1e1e', color: 'white', minHeight: '100vh', touchAction: 'none' }}>
      <h1>Painel de Controle do MiniBo</h1>
      <p>Status do Servidor: <strong>{statusWs}</strong></p>

      <div style={{ marginBottom: '20px', display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: '10px' }}>
        <button onClick={() => setAbaAtiva('manual')} style={{ padding: '10px 20px', backgroundColor: abaAtiva === 'manual' ? '#007bff' : '#444', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}>🎮 Controle Manual</button>
        <button onClick={() => setAbaAtiva('voz')} style={{ padding: '10px 20px', backgroundColor: abaAtiva === 'voz' ? '#007bff' : '#444', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}>🗣️ Comando de Voz</button>
        <button onClick={() => setAbaAtiva('visao')} style={{ padding: '10px 20px', backgroundColor: abaAtiva === 'visao' ? '#007bff' : '#444', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}>👁️ Visão Computacional</button>
      </div>

      <hr style={{ borderColor: '#444' }} />

      {abaAtiva === 'manual' && (
        <div style={{ marginTop: '30px' }}>
          <h2>Aperte e Segure para Andar</h2>
          <p style={{ color: '#aaa', fontSize: '14px', marginBottom: '30px' }}>No PC segure as teclas <strong>W, A, S, D</strong>.</p>

          <div style={{ display: 'grid', gridTemplateColumns: '80px 80px 80px', gap: '15px', justifyContent: 'center', marginTop: '40px' }}>
            <div />
            <button style={btnStyle}
              onPointerDown={(e) => { e.preventDefault(); dispararAcao('FRENTE', [100, -100, 100, -100]); }}
              onPointerUp={(e) => { e.preventDefault(); pararTudo(); }}
              onPointerLeave={(e) => { e.preventDefault(); pararTudo(); }}
            > ▲ </button>
            <div />
            <button style={btnStyle}
              onPointerDown={(e) => { e.preventDefault(); dispararAcao('ESQUERDA', [-100, -100, -100, -100]); }}
              onPointerUp={(e) => { e.preventDefault(); pararTudo(); }}
              onPointerLeave={(e) => { e.preventDefault(); pararTudo(); }}
            > ◀ </button>
            <button style={btnStyle}
              onPointerDown={(e) => { e.preventDefault(); dispararAcao('TRAS', [-100, 100, -100, 100]); }}
              onPointerUp={(e) => { e.preventDefault(); pararTudo(); }}
              onPointerLeave={(e) => { e.preventDefault(); pararTudo(); }}
            > ▼ </button>
            <button style={btnStyle}
              onPointerDown={(e) => { e.preventDefault(); dispararAcao('DIREITA', [100, 100, 100, 100]); }}
              onPointerUp={(e) => { e.preventDefault(); pararTudo(); }}
              onPointerLeave={(e) => { e.preventDefault(); pararTudo(); }}
            > ▶ </button>
          </div>

          <div style={{ marginTop: '40px', padding: '15px', backgroundColor: '#222', borderRadius: '10px', display: 'inline-block' }}>
             <p style={{ margin: 0, color: '#aaa', fontSize: '13px' }}>Ação Atual</p>
             <p style={{ margin: '5px 0 0 0', fontWeight: 'bold', color: direcaoManual === 'PARADO' ? '#dc3545' : '#0f0', fontSize: '24px' }}>
               {direcaoManual}
             </p>
          </div>
        </div>
      )}

      {abaAtiva === 'voz' && (
        <div style={{ marginTop: '30px' }}>
          <h2>Controle por Comando de Voz Estável</h2>
          <button onClick={alternarMicrofone} style={{ padding: '20px 40px', fontSize: '20px', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', marginTop: '10px', backgroundColor: ouvindoVoz ? '#dc3545' : '#28a745' }}>{ouvindoVoz ? '🛑 Parar Ouvinte' : '🎙️ Ativar Ouvinte'}</button>
          <div style={{ marginTop: '30px', minHeight: '40px' }}>
             <p style={{ color: '#aaa', margin: 0 }}>O navegador ouviu:</p>
             <h3 style={{ color: '#ffc107', marginTop: '5px', fontStyle: 'italic' }}>{ouvindoVoz ? `"${fraseOuvida}"` : 'Microfone desligado'}</h3>
          </div>
          <div style={{ marginTop: '20px', padding: '20px', backgroundColor: '#333', borderRadius: '10px', display: 'inline-block', minWidth: '300px' }}>
            <p style={{ margin: 0, fontSize: '18px', color: '#aaa' }}>Estado Atual:</p>
            <p style={{ margin: '10px 0 0 0', fontSize: '36px', fontWeight: 'bold', color: direcaoManual === 'PARADO' ? '#dc3545' : '#17a2b8' }}>{direcaoManual}</p>
          </div>
        </div>
      )}

      {abaAtiva === 'visao' && (
        <div style={{ marginTop: '30px' }}>
          <h2>Pilote Arrastando a Mão pela Tela</h2>
          <button onClick={cameraLigada ? desligarVision : iniciarVision} style={{ padding: '15px 30px', fontSize: '16px', backgroundColor: cameraLigada ? '#dc3545' : '#17a2b8', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', marginBottom: '20px' }}>{cameraLigada ? '❌ Desligar Câmera' : '🤖 Ligar Câmera'}</button>
          <div style={{ position: 'relative', width: '640px', height: '480px', margin: '0 auto', border: cameraLigada ? '3px solid #28a745' : '3px solid #555', borderRadius: '10px', backgroundColor: '#000', overflow: 'hidden' }}>
            <video ref={videoRef} playsInline muted style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} />
            <canvas ref={canvasRef} width="640" height="480" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 10, transform: 'scaleX(-1)' }} />
            {cameraLigada && (
              <div style={{ position: 'absolute', bottom: '20px', left: '20px', backgroundColor: 'rgba(0,0,0,0.75)', padding: '10px 14px', borderRadius: '8px', textAlign: 'left', fontSize: '14px', color: '#0f0', zIndex: 20 }}>
                <p style={{ margin: 0, fontWeight: 'bold', color: direcaoManual === 'PARADO' ? '#dc3545' : '#ffff00', fontSize: '18px' }}>⬛ {direcaoManual}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;