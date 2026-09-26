import { createContext, useContext, useState, useCallback, useRef, useMemo } from 'react';
import { TvSession, getTvInfo } from '../api/tvControlApi';

const TvControlContext = createContext(null);

const STORAGE_KEY = 'itc_tv_control';

function loadSettings() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch { /* fall */ }
  return { ip: '', port: 8001, name: 'WebAdmin TV Remote', token: '' };
}

function saveSettings(s) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

export function TvControlProvider({ children }) {
  const [settings, setSettings]   = useState(loadSettings);
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [connectionError, setConnectionError] = useState('');
  const [apps, setApps]           = useState([]);
  const sessionRef = useRef(null);

  const updateSettings = useCallback((update) => {
    setSettings(prev => {
      const next = { ...prev, ...update };
      saveSettings(next);
      return next;
    });
  }, []);

  const handleEvent = useCallback((eventName, data) => {
    if (eventName === 'ed.installedApp.get' && Array.isArray(data?.data)) {
      setApps(data.data);
    }
  }, []);

  const connect = useCallback(async (ip, port = 8001, name) => {
    setConnecting(true);
    setConnectionError('');
    try {
      // Optional reachability pre-check (best-effort — some TVs don't
      // respond to this REST endpoint even when the WS channel works fine).
      await getTvInfo(ip, port).catch(() => null);

      if (sessionRef.current) sessionRef.current.close();
      const session = new TvSession(ip, { port, name: name || settings.name, token: settings.token });
      session.onEvent = handleEvent;
      const { token } = await session.connect();

      sessionRef.current = session;
      updateSettings({ ip, port, name: name || settings.name, token });
      setConnected(true);
      setConnecting(false);
      return true;
    } catch (e) {
      setConnected(false);
      setConnecting(false);
      setConnectionError(e.message || 'Could not connect to the TV.');
      return false;
    }
  }, [settings.name, settings.token, updateSettings, handleEvent]);

  const disconnect = useCallback(() => {
    if (sessionRef.current) sessionRef.current.close();
    sessionRef.current = null;
    setConnected(false);
    setApps([]);
  }, []);

  // ── Imperative command helpers exposed to pages ──────────────────────────
  const sendKey     = useCallback((key)        => sessionRef.current?.sendKey(key), []);
  const moveCursor   = useCallback((dx, dy)     => sessionRef.current?.moveCursor(dx, dy), []);
  const clickCursor  = useCallback((btn)        => sessionRef.current?.click(btn), []);
  const sendText     = useCallback((text)       => sessionRef.current?.sendText(text), []);
  const launchApp    = useCallback((appId)      => sessionRef.current?.launchApp(appId), []);
  const refreshApps  = useCallback(()           => sessionRef.current?.requestAppList(), []);

  const value = useMemo(() => ({
    settings, updateSettings,
    connected, connecting, connectionError,
    connect, disconnect,
    sendKey, moveCursor, clickCursor, sendText, launchApp, refreshApps,
    apps,
  }), [settings, updateSettings, connected, connecting, connectionError,
       connect, disconnect, sendKey, moveCursor, clickCursor, sendText, launchApp, refreshApps, apps]);

  return (
    <TvControlContext.Provider value={value}>
      {children}
    </TvControlContext.Provider>
  );
}

export function useTvControl() {
  const ctx = useContext(TvControlContext);
  if (!ctx) throw new Error('useTvControl must be inside TvControlProvider');
  return ctx;
}
