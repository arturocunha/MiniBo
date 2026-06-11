import { useState, useEffect, useRef, useCallback } from 'react';
import './App.css';

function App() {
  // =========================================================================
  // ⚙️ MATRIZ DE CALIBRAÇÃO INDEPENDENTE DOS MOTORES
  // =========================================================================
  const MULT_FFE = 1; 
  const MULT_FFD = 1; 
  const MULT_FTE = 1; 
  const MULT_FTD = 1; 

  const [abaAtiva, setAbaAtiva] = useState<'voz' | 'visao' | 'manual'>('manual'); // Já abre na aba manual para você testar
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
  
  // A MEMÓRIA DE ESTADO: O que estiver aqui, o robô faz.
  const estadoMotores = useRef<[number, number, number, number]>([0, 0, 0, 0]);
  
  // Controle de estado para mostrar na tela qual botão está pressionado
  const [direcaoManual, setDirecaoManual] = useState('PARADO');

  // =========================================================================
  // 1. LIGAÇÃO WEBSOCKET E TRANSMISSÃO CONTÍNUA (HEARTBEAT)
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

    // O CORAÇÃO DO ROBÔ: Metralha o comando 10 vezes por segundo.
    // Se o dedo estiver no botão, metralha movimento. Se soltar, metralha zeros.
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
  }, []);

  // =========================================================================
  // 2. MODO MANUAL: BOTÕES DE APERTAR E SEGURAR (À PROVA DE FALHAS)
  // =========================================================================
  const pressionarBotao = (direcao: string) => {
    setDirecaoManual(direcao);
    if (direcao === 'FRENTE')   estadoMotores.current = [100, -100, 100, -100];
    if (direcao === 'TRAS')     estadoMotores.current = [-100, 100, -100, 100];
    if (direcao === 'ESQUERDA') estadoMotores.current = [-100, -100, -100, -100];
    if (direcao === 'DIREITA')  estadoMotores.current = [100, 100, 100, 100];
  };

  const soltarBotao = () => {
    setDirecaoManual('PARADO');
    estadoMotores.current = [0, 0, 0, 0];
  };

  // Suporte ao Teclado (WASD) mantido caso queira usar no PC
  useEffect(() => {
    if (abaAtiva !== 'manual') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key === 'w') pressionarBotao('FRENTE');
      if (key === 's') pressionarBotao('TRAS');
      if (key === 'a') pressionarBotao('ESQUERDA');
      if (key === 'd') pressionarBotao('DIREITA');
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (['w', 'a', 's', 'd'].includes(key)) soltarBotao();
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      soltarBotao(); 
    };
  }, [abaAtiva]);

  // =========================================================================
  // 3. COMANDO DE VOZ (MANTIDO INTACTO)
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
        
        if (/\b(frente|avançar|vai)\b/.test(fala)) { 
          setComandoAtualVoz("FRENTE");
          estadoMotores.current = [100, -100, 100, -100]; 
        } 
        else if (/\b(esquerda|left)\b/.test(fala)) { 
          setComandoAtualVoz("ESQUERDA");
          estadoMotores.current = [-100, -100, -100, -100]; 
        } 
        else if (/\b(direita|right)\b/.test(fala)) { 
          setComandoAtualVoz("DIREITA");
          estadoMotores.current = [100, 100, 100, 100]; 
        } 
        else if (/\b(tr[aász]|r[eé]|recuar)\b/.test(fala)) { 
          setComandoAtualVoz("TRÁS");
          estadoMotores.current = [-100, 100, -100, 100]; 
        } 
        else if (/\b(para|pare|parar|stop)\b/.test(fala)) { 
          setComandoAtualVoz("PARADO");
          estadoMotores.current = [0, 0, 0, 0]; 
        }
      };

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
  // 4. VISÃO COMPUTACIONAL (MANTIDO INTACTO)
  // =========================================================================
  const [zonaAtual, setZonaAtual] = useState<string>('PARADO');

  const onResultsHand = useCallback((results: any) => {
    if (!canvasRef.current || !videoRef.current || !visaoAtivaRef.current) return;
    const canvasCtx = canvasRef.current.getContext('2d');
    if (!canvasCtx) return;

    const W = canvasRef.current.width;
    const H = canvasRef.current.height;
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
      
      let zona = 'PARADO';
      let motores: [number, number, number, number] = [0, 0, 0, 0];

      if (dx < margemCentro && dy < margemCentro) {
        zona = 'PARADO'; motores = [0, 0, 0, 0];
      } else if (dy > dx) {
        if (cy < 0.5) { zona = 'FRENTE'; motores = [100, -100, 100, -100]; } 
        else { zona = 'RÉ'; motores = [-100, 100, -100, 100]; }
      } else {
        if (cx < 0.5) { zona = 'DIREITA'; motores = [100, 100, 100, 100]; } 
        else { zona = 'ESQUERDA'; motores = [-100, -100, -100, -100]; }
      }

      estadoMotores.current = motores;
      setZonaAtual(zona);
      setInfoJoystick({ speed: Math.abs(motores[0]), turn: motores[0] !== motores[1] ? 100 : 0, l: motores[0], r: motores[1] });
    } else {
      estadoMotores.current = [0, 0, 0, 0];
      setZonaAtual('PARADO');
      setInfoJoystick({ speed: 0, turn: 0, l: 0, r: 0 });
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
    estadoMotores.current = [0, 0, 0, 0]; setCameraLigada(false); setInfoJoystick({ speed: 0, turn: 0, l: 0, r: 0 });
  };

  useEffect(() => {
    if (abaAtiva !== 'visao') desligarVision();
    if (abaAtiva !== 'voz' && ouvindoVoz) alternarMicrofone();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abaAtiva]);

  // Estilo padronizado para os botões do D-Pad
  const btnStyle = {
    width: '80px', height: '80px', fontSize: '24px', fontWeight: 'bold', 
    backgroundColor: '#007bff', color: 'white', border: 'none', 
    borderRadius: '15px', cursor: 'pointer', userSelect: 'none' as const,
    boxShadow: '0 6px 0 #0056b3', touchAction: 'none'
  };

  // =========================================================================
  // INTERFACE
  // =========================================================================
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

      {/* TELA DE CONTROLE MANUAL (D-PAD GIGANTE E SIMPLES) */}
      {abaAtiva === 'manual' && (
        <div style={{ marginTop: '30px' }}>
          <h2>Aperte e Segure para Andar</h2>
          <p style={{ color: '#aaa', fontSize: '14px', marginBottom: '30px' }}>
            No PC você também pode segurar as teclas <strong>W, A, S, D</strong>.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '80px 80px 80px', gap: '15px', justifyContent: 'center', marginTop: '40px' }}>
            <div /> {/* Espaço vazio no grid */}
            <button 
              style={btnStyle}
              onPointerDown={(e) => { e.preventDefault(); pressionarBotao('FRENTE'); }}
              onPointerUp={(e) => { e.preventDefault(); soltarBotao(); }}
              onPointerLeave={(e) => { e.preventDefault(); soltarBotao(); }}
            > ▲ </button>
            <div />

            <button 
              style={btnStyle}
              onPointerDown={(e) => { e.preventDefault(); pressionarBotao('ESQUERDA'); }}
              onPointerUp={(e) => { e.preventDefault(); soltarBotao(); }}
              onPointerLeave={(e) => { e.preventDefault(); soltarBotao(); }}
            > ◀ </button>

            <button 
              style={btnStyle}
              onPointerDown={(e) => { e.preventDefault(); pressionarBotao('TRAS'); }}
              onPointerUp={(e) => { e.preventDefault(); soltarBotao(); }}
              onPointerLeave={(e) => { e.preventDefault(); soltarBotao(); }}
            > ▼ </button>

            <button 
              style={btnStyle}
              onPointerDown={(e) => { e.preventDefault(); pressionarBotao('DIREITA'); }}
              onPointerUp={(e) => { e.preventDefault(); soltarBotao(); }}
              onPointerLeave={(e) => { e.preventDefault(); soltarBotao(); }}
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

      {/* TELA DE COMANDO DE VOZ (MANTIDA INTACTA) */}
      {abaAtiva === 'voz' && (
        <div style={{ marginTop: '30px' }}>
          <h2>Controle por Comando de Voz Estável</h2>
          <p>Diga de forma clara: <strong>Frente, Trás, Esquerda, Direita, Parar</strong></p>
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

      {/* TELA DE VISÃO COMPUTACIONAL (MANTIDA INTACTA) */}
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
          </div>
        </div>
      )}
    </div>
  );
}

export default App;