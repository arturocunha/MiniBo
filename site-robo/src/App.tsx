import { useState, useEffect, useRef } from 'react';
import './App.css';

function App() {
  const [abaAtiva, setAbaAtiva] = useState<'voz' | 'visao' | 'manual'>('voz');
  const [statusWs, setStatusWs] = useState('A ligar...');
  
  // Estados da Voz
  const [comandoAtualVoz, setComandoAtualVoz] = useState('PARAR');
  const [ouvindoVoz, setOuvindoVoz] = useState(false);
  const [fraseOuvida, setFraseOuvida] = useState('');

  // Referências principais
  const ws = useRef<WebSocket | null>(null);
  const recognitionRef = useRef<any>(null); 
  const ouvindoRef = useRef(false); 
  
  // Armazena a String exata que vai ser enviada para o ESP32
  const comandoRoboRef = useRef<string>("PARAR");

  // =========================================================================
  // 1. LIGAÇÃO WEBSOCKET E TRANSMISSÃO CONTÍNUA
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

    // Coração do Robô: Envia apenas a PALAVRA DE COMANDO atual
    const transmissor = setInterval(() => {
      if (ws.current && ws.current.readyState === WebSocket.OPEN) {
        if (abaAtiva === 'voz') {
          ws.current.send(comandoRoboRef.current);
        }
      }
    }, 150);

    return () => {
      clearInterval(transmissor);
      ws.current?.close();
    };
  }, [abaAtiva]);

  // =========================================================================
  // 2. COMANDO DE VOZ (REFORMULADO PARA TEXTO)
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
        
        let novoComando = comandoRoboRef.current; 

        if (/\b(frente|avançar|vai|andar)\b/.test(fala)) novoComando = "FRENTE";
        else if (/\b(esquerda|left)\b/.test(fala)) novoComando = "ESQUERDA";
        else if (/\b(direita|right)\b/.test(fala)) novoComando = "DIREITA";
        else if (/\b(tr[aász]|r[eé]|recuar)\b/.test(fala)) novoComando = "TRAS";
        else if (/\b(senta|sentar)\b/.test(fala)) novoComando = "SENTAR";
        else if (/\b(deita|deitar)\b/.test(fala)) novoComando = "DEITAR";
        else if (/\b(estica|alongar|espreguiça|espreguiçar)\b/.test(fala)) novoComando = "ALONGAR";
        else if (/\b(dança|dançar|dancinha)\b/.test(fala)) novoComando = "DANCAR";
        else if (/\b(feliz|alegre|abana|fofo)\b/.test(fala)) novoComando = "ALEGRE";
        else if (/\b(para|pare|parar|stop)\b/.test(fala)) novoComando = "PARAR";

        setComandoAtualVoz(novoComando);
        comandoRoboRef.current = novoComando;
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
      
      comandoRoboRef.current = "PARAR"; 
      setComandoAtualVoz("PARAR"); 
      setFraseOuvida('');
    } else { 
      ouvindoRef.current = true; 
      setOuvindoVoz(true); 
      recognitionRef.current.start(); 
    }
  };

  // Trava o robô e desliga o mic se mudar de aba
  useEffect(() => {
    if (abaAtiva !== 'voz' && ouvindoVoz) alternarMicrofone();
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
            <p style={{ margin: 0, fontSize: '18px', color: '#aaa' }}>Enviando para o Robô:</p>
            <p style={{ margin: '10px 0 0 0', fontSize: '36px', fontWeight: 'bold', color: comandoAtualVoz === 'PARAR' ? '#dc3545' : '#17a2b8' }}>{comandoAtualVoz}</p>
          </div>
        </div>
      )}

      {/* TELAS INATIVAS */}
      {abaAtiva === 'manual' && (
        <div style={{ marginTop: '30px', opacity: 0.5 }}>
          <h2>Pilote o MiniBo Manualmente</h2>
          <p style={{ color: '#ffcc00' }}>⚠️ Temporariamente desativado enquanto focamos na voz.</p>
        </div>
      )}

      {abaAtiva === 'visao' && (
        <div style={{ marginTop: '30px', opacity: 0.5 }}>
          <h2>Pilote Arrastando a Mão pela Tela</h2>
          <p style={{ color: '#ffcc00' }}>⚠️ Temporariamente desativado enquanto focamos na voz.</p>
        </div>
      )}
    </div>
  );
}

export default App;