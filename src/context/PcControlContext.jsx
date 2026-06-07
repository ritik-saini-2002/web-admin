import { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { getScreenSize, ping } from '../api/pcControlApi';

const PcControlContext = createContext(null);

const STORAGE_KEY              = 'itc_pc_control';
const DEFAULT_SECRET_KEY       = 'Ritik@2002';
const PREVIOUS_DEFAULT_SECRET_KEY = 'Saini@2004';

function loadSettings() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const s = JSON.parse(saved);
      if (s.secretKey === PREVIOUS_DEFAULT_SECRET_KEY) {
        return { ...s, secretKey: DEFAULT_SECRET_KEY };
      }
      return s;
    }
  } catch { /* fall */ }
  return { ip: '', port: 5000, secretKey: DEFAULT_SECRET_KEY };
}

function saveSettings(s) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

export function PcControlProvider({ children }) {
  const [settings, setSettings]         = useState(loadSettings);
  const [connected, setConnected]       = useState(false);
  const [pcName, setPcName]             = useState('');
  const [pinging, setPinging]           = useState(false);
  const [connectionError, setConnectionError] = useState('');
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
      setConnectionError('');
      return false;
    }
    setPinging(true);
    try {
      const res = await ping(baseUrl, settings.secretKey);
      if (!res.ok || !res.data) {
        setConnected(false);
        setPcName('');
        setConnectionError(res.error || res.data?.error || 'PC agent is not reachable from this server.');
        setPinging(false);
        return false;
      }

      const accessCheck = await getScreenSize(baseUrl, settings.secretKey);
      if (!accessCheck.ok) {
        setConnected(false);
        setPcName('');
        setConnectionError(
            accessCheck.status === 401
                ? 'PC is reachable, but the secret key is rejected.'
                : accessCheck.error || accessCheck.data?.error || 'PC control endpoint is not reachable from this server.',
        );
        setPinging(false);
        return false;
      }

      setConnected(true);
      setPcName(res.data.pc_name || res.data.pcName || 'Unknown PC');
      setConnectionError('');
      setPinging(false);
      return true;
    } catch {
      setConnected(false);
      setPcName('');
      setConnectionError('PC agent is not reachable from this server.');
      setPinging(false);
      return false;
    }
  }, [baseUrl, settings.secretKey, settings.ip]);

  // Auto-ping every 8 seconds when IP is configured
  useEffect(() => {
    if (!settings.ip) return;
    const initialPing = setTimeout(doPing, 0);
    pingTimerRef.current = setInterval(doPing, 8000);
    return () => {
      clearTimeout(initialPing);
      if (pingTimerRef.current) clearInterval(pingTimerRef.current);
    };
  }, [settings.ip, settings.port, settings.secretKey, doPing]);

  const disconnect = useCallback(() => {
    setConnected(false);
    setPcName('');
    setConnectionError('');
    if (pingTimerRef.current) clearInterval(pingTimerRef.current);
  }, []);

  /**
   * selectedPc — a rich PC object derived from current settings + connection
   * state, stable across renders (useMemo). Used by Aicontrol.jsx.
   */
  const selectedPc = useMemo(() => {
    if (!settings.ip || !connected) return null;
    return {
      ip:           settings.ip,
      command_port: settings.port || 5000,
      stream_port:  5001,
      _key:         settings.secretKey,
      pc_name:      pcName || 'Connected PC',
    };
  }, [settings.ip, settings.port, settings.secretKey, connected, pcName]);

  return (
      <PcControlContext.Provider value={{
        settings, updateSettings,
        baseUrl, connected, pcName, pinging, connectionError,
        doPing, disconnect,
        selectedPc,        // ← consumed by Aicontrol
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