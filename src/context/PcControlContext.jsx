import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { ping } from '../api/pcControlApi';

const PcControlContext = createContext(null);

const STORAGE_KEY = 'itc_pc_control';

function loadSettings() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch {}
  return { ip: '', port: 5000, secretKey: 'Ritik@2002' };
}

function saveSettings(settings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function PcControlProvider({ children }) {
  const [settings, setSettings] = useState(loadSettings);
  const [connected, setConnected] = useState(false);
  const [pcName, setPcName] = useState('');
  const [pinging, setPinging] = useState(false);
  const pingTimerRef = useRef(null);

  const baseUrl = settings.ip ? `http://${settings.ip}:${settings.port}` : '';

  const updateSettings = useCallback((update) => {
    setSettings(prev => {
      const next = { ...prev, ...update };
      saveSettings(next);
      return next;
    });
  }, []);

  const doPing = useCallback(async () => {
    if (!settings.ip) {
      setConnected(false);
      setPcName('');
      return false;
    }
    setPinging(true);
    try {
      const res = await ping(baseUrl, settings.secretKey);
      if (res.ok && res.data) {
        setConnected(true);
        setPcName(res.data.pc_name || res.data.pcName || 'Unknown PC');
        setPinging(false);
        return true;
      } else {
        setConnected(false);
        setPcName('');
        setPinging(false);
        return false;
      }
    } catch {
      setConnected(false);
      setPcName('');
      setPinging(false);
      return false;
    }
  }, [baseUrl, settings.secretKey, settings.ip]);

  // Auto-ping every 8 seconds when IP is configured
  useEffect(() => {
    if (!settings.ip) return;
    doPing();
    pingTimerRef.current = setInterval(doPing, 8000);
    return () => {
      if (pingTimerRef.current) clearInterval(pingTimerRef.current);
    };
  }, [settings.ip, settings.port, settings.secretKey, doPing]);

  const disconnect = useCallback(() => {
    setConnected(false);
    setPcName('');
    if (pingTimerRef.current) clearInterval(pingTimerRef.current);
  }, []);

  return (
    <PcControlContext.Provider value={{
      settings, updateSettings,
      baseUrl, connected, pcName, pinging,
      doPing, disconnect,
    }}>
      {children}
    </PcControlContext.Provider>
  );
}

export function usePcControl() {
  const ctx = useContext(PcControlContext);
  if (!ctx) throw new Error('usePcControl must be inside PcControlProvider');
  return ctx;
}
