import { useState, useEffect, useRef } from 'react';
import './App.css';

function App() {
  // =========================================================================
  // ⚙️ ZONA DE CONFIGURAÇÃO RÁPIDA DE MOTORES
  // =========================================================================
  // Se o robô for para trás quando você disser "Frente", mude de 1 para -1.
  // Como você relatou que o robô inverteu, já deixei ambos como -1.
  const INVERTER_ESQ = -1; 
  const INVERTER_DIR = -1;

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
  
  // Memória contínua do estado dos motores (A Mágica do Loop)
  const motoresRef = useRef({ e: 0, d: 0 });

  // =========================================================================
  // 1. LIGAÇÃO WEBSOCKET E LOOP CONTÍNUO (HEARTBEAT)
  // =========================================================================
  useEffect(() => {
    const protocoloWs = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const urlWs = `${protocoloWs}//${window.location.host}`;
    
    ws.current = new WebSocket(urlWs);
    ws.current.onopen = () => setStatusWs('Ligado 🟢');
    ws.current.onclose = () => setStatusWs('Desligado 🔴');
    ws.current.onerror = () => setStatusWs('Erro na ligação ⚠️');

    // Dispara a cada 100ms (10 vezes por segundo) mantendo o robô em movimento contínuo
    const loopControle = setInterval(() => {
      if (ws.current && ws.current.readyState === WebSocket.OPEN) {
        const { e, d } = motoresRef.current;
        
        // Aplica a inversão caso os motores estejam fisicamente invertidos
        const pwmE = e * INVERTER_ESQ;
        const pwmD = d * INVERTER_DIR;

        const stringCmd = `${pwmE},${pwmD},${pwmE},${pwmD}`;
        ws.current.send(stringCmd);
      }
    }, 100);

    return () => {
      clearInterval(loopControle);
      ws.current?.close();
    };
  }, []);

  // =========================================================================
  // 2. COMANDO DE VOZ (Com Sinônimos)
  // =========================================================================
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.lang = 'pt-BR'; 
      recognitionRef.current.continuous = true; 
      recognitionRef.current.interimResults = true; 

      recognitionRef.current.onresult = (event: any) => {
        const lastIndex = event.results.length - 1;
        const fala = event.results[lastIndex][0].transcript.toLowerCase().trim();
        
        setFraseOuvida(fala);
        
        let novoComando = ""; 
        let motorE = 0, motorD = 0;
        let encontrouComando = false;

        // Adicionado dicionário de sinônimos para melhorar o reconhecimento
        if (fala.includes("frente") || fala.includes("avançar") || fala.includes("vai") || fala.includes("go")) { 
          novoComando = "FRENTE"; motorE = 100; motorD = 100; encontrouComando = true; 
        } 
        else if (fala.includes("trás") || fala.includes("tras") || fala.includes("ré") || fala.includes("re") || fala.includes("recuar") || fala.includes("voltar")) { 
          novoComando = "TRÁS"; motorE = -100; motorD = -100; encontrouComando = true; 
        } 
        else if (fala.includes("esquerda") || fala.includes("left")) { 
          novoComando = "ESQUERDA"; motorE = -100; motorD = 100; encontrouComando = true; 
        } 
        else if (fala.includes("direita") || fala.includes("right")) { 
          novoComando = "DIREITA"; motorE = 100; motorD = -100; encontrouComando = true; 
        } 
        else if (fala.includes("para") || fala.includes("pare") || fala.includes("parar") || fala.includes("stop")) { 
          novoComando = "PARADO"; motorE = 0; motorD = 0; encontrouComando = true; 
        }

        if (encontrouComando) {
          setComandoAtualVoz(novoComando);
          // Apenas atualiza a memória. O LoopControle se encarrega de enviar para a ESP32.
          motoresRef.current = { e: motorE, d: motorD };
        }
      };

      recognitionRef.current.onend = () => { if (ouvindoRef.current) recognitionRef.current.start(); };
    }
  }, []); 

  const alternarMicrofone = () => {
    if (!recognitionRef.current) return alert("O navegador não suporta comando de voz.");
    if (ouvindoVoz) { 
      ouvindoRef.current = false; 
      setOuvindoVoz(false); 
      recognitionRef.current.stop(); 
      motoresRef.current = { e: 0, d: 0 }; 
      setComandoAtualVoz("PARADO"); 
      setFraseOuvida('');
    } else { 
      ouvindoRef.current = true; 
      setOuvindoVoz(true); 
      recognitionRef.current.start(); 
    }
  };

  // =========================================================================
  // 3. VISÃO COMPUTACIONAL
  // =========================================================================
  
  const processarFrame = async () => {
    if (visaoAtivaRef.current && videoRef.current && handsRef.current) {
      await handsRef.current.send({ image: videoRef.current });
      loopVisaoRef.current = requestAnimationFrame(processarFrame);
    }
  };

  const onResultsHand = (results: any) => {
    if (!canvasRef.current || !videoRef.current || !visaoAtivaRef.current) return;

    const canvasCtx = canvasRef.current.getContext('2d');
    if (!canvasCtx) return;

    canvasCtx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
      const landmarks = results.multiHandLandmarks[0];
        
      const drawConnectors = (window as any).drawConnectors;
      const drawLandmarks = (window as any).drawLandmarks;
      const HAND_CONNECTIONS = (window as any).HAND_CONNECTIONS;

      if(drawConnectors && drawLandmarks) {
         drawConnectors(canvasCtx, landmarks, HAND_CONNECTIONS, { color: '#00FF00', lineWidth: 3 });
         drawLandmarks(canvasCtx, landmarks, { color: '#FF0000', lineWidth: 1, radius: 4 });
      }

      const centroDaMao = landmarks[9]; 
      const eixoX = centroDaMao.x - 0.5; 
      const eixoY = centroDaMao.y - 0.5; 

      const forward_speed = Math.max(-100, Math.min(100, eixoY * -200));
      const turn_speed = Math.max(-100, Math.min(100, eixoX * -200));

      const deadzone = 20; 
      const speed_filtered = Math.abs(forward_speed) < deadzone ? 0 : forward_speed;
      const turn_filtered = Math.abs(turn_speed) < deadzone ? 0 : turn_speed;

      let motorEsq = speed_filtered + turn_filtered;
      let motorDir = speed_filtered - turn_filtered;

      const max_raw = Math.max(Math.abs(motorEsq), Math.abs(motorDir));
      if (max_raw > 100) {
        motorEsq = (motorEsq / max_raw) * 100;
        motorDir = (motorDir / max_raw) * 100;
      }

      setInfoJoystick({ speed: Math.round(speed_filtered), turn: Math.round(turn_filtered), l: Math.round(motorEsq), r: Math.round(motorDir) });
      motoresRef.current = { e: Math.round(motorEsq), d: Math.round(motorDir) };
      
    } else {
      setInfoJoystick({ speed: 0, turn: 0, l: 0, r: 0 });
      motoresRef.current = { e: 0, d: 0 };
    }
  };

  const iniciarVision = async () => {
    if (!videoRef.current || !canvasRef.current) return;

    const Hands = (window as any).Hands;
    if (!Hands) return alert("A aguardar as bibliotecas de IA do Google. Tente em 2 segundos.");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
      streamRef.current = stream;
      videoRef.current.srcObject = stream;

      if (!handsRef.current) {
        handsRef.current = new Hands({
          locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
        });
        handsRef.current.setOptions({
          maxNumHands: 1,
          modelComplexity: 1,
          minDetectionConfidence: 0.7,
          minTrackingConfidence: 0.7
        });
        handsRef.current.onResults(onResultsHand);
      }

      videoRef.current.onloadedmetadata = () => {
        if (videoRef.current) videoRef.current.play();
        visaoAtivaRef.current = true;
        setCameraLigada(true);
        processarFrame(); 
      };

    } catch (erro) {
      console.error("Erro na visão:", erro);
      alert("Não foi possível aceder à câmara.");
    }
  };

  const desligarVision = () => {
    visaoAtivaRef.current = false;
    cancelAnimationFrame(loopVisaoRef.current); 

    if (streamRef.current) streamRef.current.getTracks().forEach(track => track.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx && canvasRef.current) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);

    motoresRef.current = { e: 0, d: 0 }; 

    setCameraLigada(false);
    setInfoJoystick({ speed: 0, turn: 0, l: 0, r: 0 });
  };

  useEffect(() => {
    if (abaAtiva !== 'visao') desligarVision();
    if (abaAtiva !== 'voz' && ouvindoVoz) alternarMicrofone();
  }, [abaAtiva]);

  // =========================================================================
  // INTERFACE
  // =========================================================================
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
          <h2>Diga para onde o MiniBo deve ir</h2>
          <p>Palavras-chave: <strong>Frente, Avançar, Trás, Ré, Esquerda, Direita, Para</strong></p>
          <button onClick={alternarMicrofone} style={{ padding: '20px 40px', fontSize: '20px', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', marginTop: '10px', backgroundColor: ouvindoVoz ? '#dc3545' : '#28a745' }}>{ouvindoVoz ? '🛑 Parar de Ouvir' : '🎙️ Começar a Ouvir'}</button>
          
          <div style={{ marginTop: '30px', minHeight: '40px' }}>
             <p style={{ color: '#aaa', margin: 0 }}>O navegador ouviu:</p>
             <h3 style={{ color: '#ffc107', marginTop: '5px', fontStyle: 'italic' }}>
               {ouvindoVoz ? `"${fraseOuvida}"` : 'Microfone desligado'}
             </h3>
          </div>

          <div style={{ marginTop: '20px', padding: '20px', backgroundColor: '#333', borderRadius: '10px', display: 'inline-block', minWidth: '300px' }}>
            <p style={{ margin: 0, fontSize: '18px', color: '#aaa' }}>Estado da Voz:</p>
            <p style={{ margin: '10px 0 0 0', fontSize: '36px', fontWeight: 'bold', color: comandoAtualVoz === 'PARADO' ? '#dc3545' : '#17a2b8' }}>{comandoAtualVoz}</p>
          </div>
        </div>
      )}

      {abaAtiva === 'visao' && (
        <div style={{ marginTop: '30px' }}>
          <h2>Pilote o MiniBo arrastando a Mão pela tela</h2>
          <p style={{ color: '#aaa' }}>Mão no Topo: Frente | Rodapé: Ré | Lados: Curva | Centro: Parar</p>
          
          <button onClick={cameraLigada ? desligarVision : iniciarVision} style={{ padding: '15px 30px', fontSize: '16px', backgroundColor: cameraLigada ? '#dc3545' : '#17a2b8', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', marginBottom: '20px' }}>{cameraLigada ? '❌ Desligar Piloto Automático' : '🤖 Ativar Piloto Automático'}</button>

          <br />
          
          <div style={{ position: 'relative', width: '640px', height: '480px', margin: '0 auto', border: cameraLigada ? '3px solid #28a745' : '3px solid #555', borderRadius: '10px', backgroundColor: '#000', overflow: 'hidden' }}>
            
            <video ref={videoRef} playsInline style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} />
            
            <canvas ref={canvasRef} width="640" height="480" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 10, transform: 'scaleX(-1)' }} />
            
            {cameraLigada && (
              <div style={{ position: 'absolute', bottom: '20px', left: '20px', backgroundColor: 'rgba(0,0,0,0.7)', padding: '10px', borderRadius: '5px', textAlign: 'left', fontSize: '14px', color: '#0f0', zIndex: 20 }}>
                <p style={{ margin: 0 }}>Velocidade: {infoJoystick.speed}%</p>
                <p style={{ margin: 0 }}>Curva: {infoJoystick.turn}%</p>
                <hr style={{ borderColor: '#333', margin: '5px 0' }} />
                <p style={{ margin: 0 }}>Motor Esq: {infoJoystick.l}</p>
                <p style={{ margin: 0 }}>Motor Dir: {infoJoystick.r}</p>
              </div>
            )}
            
            {cameraLigada && (
              <div style={{ position: 'absolute', top: '50%', left: '50%', width: '10px', height: '10px', backgroundColor: 'red', borderRadius: '50%', transform: 'translate(-50%, -50%)', opacity: 0.5, zIndex: 15 }} />
            )}
          </div>
        </div>
      )}

    </div>
  );
}

export default App;