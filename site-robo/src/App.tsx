import { useState, useEffect, useRef } from 'react';
import './App.css';

function App() {
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
  
  const ultimoComandoRef = useRef('0,0,0,0'); 
  const ultimaMensagemRef = useRef<number>(0); // Trava de Flood (Inundação)

  // =========================================================================
  // 1. LIGAÇÃO WEBSOCKET
  // =========================================================================
  useEffect(() => {
    const protocoloWs = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const urlWs = `${protocoloWs}//${window.location.host}`;
    
    ws.current = new WebSocket(urlWs);
    ws.current.onopen = () => setStatusWs('Ligado 🟢');
    ws.current.onclose = () => setStatusWs('Desligado 🔴');
    ws.current.onerror = () => setStatusWs('Erro na ligação ⚠️');

    return () => ws.current?.close();
  }, []);

  const enviarComandoMixado = (vel_esq: number, vel_dir: number) => {
    const pwm_e = Math.round(vel_esq);
    const pwm_d = Math.round(vel_dir);
    const novaStringComando = `${pwm_e},${pwm_d},${pwm_e},${pwm_d}`;

    const agora = Date.now();

    if (ws.current && ws.current.readyState === WebSocket.OPEN && novaStringComando !== ultimoComandoRef.current) {
      // Evita o travamento do servidor enviando comandos a no máximo 10 vezes por segundo (100ms)
      // Comandos de PARAR (0,0) furam a fila para garantir segurança imediata
      if (novaStringComando === '0,0,0,0' || agora - ultimaMensagemRef.current > 100) {
        ultimoComandoRef.current = novaStringComando;
        ultimaMensagemRef.current = agora;
        ws.current.send(novaStringComando);
        console.log(`📡 WebSocket: ${novaStringComando}`);
      }
    }
  };

  // =========================================================================
  // 2. COMANDO DE VOZ (Velocidade ajustada para 100%)
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

        if (fala.includes("frente") || fala.includes("forward") || fala.includes("go")) { 
          novoComando = "FRENTE"; motorE = 100; motorD = 100; encontrouComando = true; 
        } 
        if (fala.includes("trás") || fala.includes("tras") || fala.includes("back") || fala.includes("ré") || fala.includes("re")) { 
          novoComando = "TRÁS"; motorE = -100; motorD = -100; encontrouComando = true; 
        } 
        if (fala.includes("esquerda") || fala.includes("left")) { 
          novoComando = "ESQUERDA"; motorE = -100; motorD = 100; encontrouComando = true; 
        } 
        if (fala.includes("direita") || fala.includes("right")) { 
          novoComando = "DIREITA"; motorE = 100; motorD = -100; encontrouComando = true; 
        } 
        
        if (fala.includes("para") || fala.includes("pare") || fala.includes("parar") || fala.includes("stop")) { 
          novoComando = "PARADO"; motorE = 0; motorD = 0; encontrouComando = true; 
        }

        if (encontrouComando) {
          setComandoAtualVoz(novoComando);
          enviarComandoMixado(motorE, motorD);
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
      enviarComandoMixado(0,0); 
      setComandoAtualVoz("PARADO"); 
      setFraseOuvida('');
    } else { 
      ouvindoRef.current = true; 
      setOuvindoVoz(true); 
      recognitionRef.current.start(); 
    }
  };

  // =========================================================================
  // 3. VISÃO COMPUTACIONAL (Lógica Joystick XYZ de Tela)
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
      // Usamos apenas a primeira mão que aparecer na tela
      const landmarks = results.multiHandLandmarks[0];
        
      const drawConnectors = (window as any).drawConnectors;
      const drawLandmarks = (window as any).drawLandmarks;
      const HAND_CONNECTIONS = (window as any).HAND_CONNECTIONS;

      if(drawConnectors && drawLandmarks) {
         drawConnectors(canvasCtx, landmarks, HAND_CONNECTIONS, { color: '#00FF00', lineWidth: 3 });
         drawLandmarks(canvasCtx, landmarks, { color: '#FF0000', lineWidth: 1, radius: 4 });
      }

      // Base central da mão
      const centroDaMao = landmarks[9]; 

      // A tela vai de 0.0 a 1.0. O centro absoluto é 0.5.
      // Calculamos a diferença entre onde a mão está e o centro da câmera
      const eixoX = centroDaMao.x - 0.5; // Curva
      const eixoY = centroDaMao.y - 0.5; // Velocidade

      // O eixo Y na câmera é invertido (0 é o topo). Multiplicamos por -200
      // para que a mão no topo (ex: eixoY = -0.4) resulte em +80% de velocidade pra frente.
      const forward_speed = Math.max(-100, Math.min(100, eixoY * -200));
      const turn_speed = Math.max(-100, Math.min(100, eixoX * -200));

      const deadzone = 20; // Tamanho do "quadrado invisível" no meio da tela onde o robô fica parado
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
      enviarComandoMixado(motorEsq, motorDir);
      
    } else {
      // Se não achar a mão, para na mesma hora
      setInfoJoystick({ speed: 0, turn: 0, l: 0, r: 0 });
      enviarComandoMixado(0, 0);
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

    if (ws.current) enviarComandoMixado(0,0); 

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
          <p>Palavras-chave: <strong>Frente, Trás, Ré, Esquerda, Direita, Para</strong></p>
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
            
            {/* Desenha uma mira invisível no centro da tela para ajudar na referência visual */}
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