import { useState, useRef, useCallback } from 'react';
import {
  Tv, Wifi, WifiOff, RefreshCw, Send, Mouse, Keyboard, Grid3x3,
  Power, Home, Menu as MenuIcon, ArrowLeft, Volume2, VolumeX, Cable,
} from 'lucide-react';
import { useTvControl } from '../context/TvControlContext';
import { TV_QUICK_KEYS } from '../api/tvControlApi';
import { useToast } from '../context/ToastContext';

const ICONS = { Power, Home, MenuIcon, ArrowLeft, Volume2, VolumeX, Cable };

export default function TvControlPage() {
  const {
    settings, connected, connecting, connectionError,
    connect, disconnect, sendKey, moveCursor, clickCursor, sendText,
    launchApp, refreshApps, apps,
  } = useTvControl();
  const { addToast } = useToast();

  const [tab, setTab]   = useState('connect'); // connect | remote | touchpad | apps
  const [formIp, setFormIp]     = useState(settings.ip);
  const [formPort, setFormPort] = useState(settings.port);
  const [formName, setFormName] = useState(settings.name);
  const [textInput, setTextInput] = useState('');

  async function handleConnect(e) {
    e?.preventDefault();
    if (!formIp.trim()) { addToast('Enter the TV\'s IP address', 'error'); return; }
    addToast('Check the TV screen and select "Allow" if prompted…', 'info');
    const ok = await connect(formIp.trim(), Number(formPort) || 8001, formName.trim());
    if (ok) {
      addToast('Connected to TV', 'success');
      setTab('remote');
    }
  }

  async function handleKey(key) {
    if (!connected) return;
    try { sendKey(key); } catch { addToast('Failed to send key', 'error'); }
  }

  async function handleSendText() {
    if (!connected || !textInput.trim()) return;
    sendText(textInput);
    addToast('Text sent to TV', 'success');
    setTextInput('');
  }

  // ── Touchpad drag handling (mirrors the PC Touchpad page) ────────────────
  const padRef = useRef(null);
  const dragging = useRef(false);
  const lastPos  = useRef({ x: 0, y: 0 });
  const throttle = useRef(null);
  const sensitivity = 2.2;

  function onPadDown(e) {
    if (!connected) return;
    dragging.current = true;
    const rect = padRef.current.getBoundingClientRect();
    lastPos.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
  function onPadMove(e) {
    if (!dragging.current || !connected) return;
    const rect = padRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const dx = (x - lastPos.current.x) * sensitivity;
    const dy = (y - lastPos.current.y) * sensitivity;
    lastPos.current = { x, y };
    if (!throttle.current && (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5)) {
      throttle.current = setTimeout(() => { throttle.current = null; }, 16);
      moveCursor(dx, dy);
    }
  }
  function onPadUp() { dragging.current = false; }

  const loadApps = useCallback(() => {
    if (!connected) return;
    refreshApps();
    addToast('Requesting app list from TV…', 'info');
  }, [connected, refreshApps, addToast]);

  return (
    <div className="animate-in">
      <div className="page-header">
        <div>
          <h1>TV Control</h1>
          <p>Control a Samsung Tizen TV over the network — no app install needed on the TV</p>
        </div>
        <span className={`badge ${connected ? 'badge-emerald' : 'badge-rose'}`}>
          <span className="badge-dot" />{connected ? 'Connected' : 'Disconnected'}
        </span>
      </div>

      <div className="tabs" style={{ marginBottom: 20 }}>
        <button className={`tab ${tab === 'connect' ? 'active' : ''}`} onClick={() => setTab('connect')}>
          <Cable size={14} /> Connect
        </button>
        <button className={`tab ${tab === 'remote' ? 'active' : ''}`} onClick={() => setTab('remote')} disabled={!connected}>
          <Tv size={14} /> Remote
        </button>
        <button className={`tab ${tab === 'touchpad' ? 'active' : ''}`} onClick={() => setTab('touchpad')} disabled={!connected}>
          <Mouse size={14} /> Touchpad & Keyboard
        </button>
        <button className={`tab ${tab === 'apps' ? 'active' : ''}`} onClick={() => setTab('apps')} disabled={!connected}>
          <Grid3x3 size={14} /> Apps
        </button>
      </div>

      {tab === 'connect' && (
        <div className="card" style={{ maxWidth: 480 }}>
          <h3 style={{ fontSize: '0.88rem', fontWeight: 700, marginBottom: 12 }}>Pair with a TV</h3>
          <form onSubmit={handleConnect}>
            <label className="form-label">TV IP address</label>
            <input className="input" value={formIp} onChange={e => setFormIp(e.target.value)}
                   placeholder="192.168.1.42" style={{ marginBottom: 12 }} />

            <label className="form-label">Port</label>
            <select className="input" value={formPort} onChange={e => setFormPort(e.target.value)} style={{ marginBottom: 12 }}>
              <option value={8001}>8001 — plaintext (most 2018+ models)</option>
              <option value={8002}>8002 — TLS (older models; trust the TV's certificate first by visiting it in a browser tab)</option>
            </select>

            <label className="form-label">Device name (shown on the TV's pairing prompt)</label>
            <input className="input" value={formName} onChange={e => setFormName(e.target.value)}
                   style={{ marginBottom: 16 }} />

            <button className="btn btn-primary" type="submit" disabled={connecting} style={{ width: '100%' }}>
              {connecting
                ? <><div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> Waiting for TV…</>
                : <><Wifi size={16} /> Connect</>}
            </button>
          </form>

          {connectionError && (
            <p style={{ color: 'var(--accent-rose)', fontSize: '0.8rem', marginTop: 12 }}>{connectionError}</p>
          )}

          {connected && (
            <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border-subtle)' }}>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', marginBottom: 8 }}>
                Connected to {settings.ip}:{settings.port}
              </p>
              <button className="btn btn-outline btn-sm" onClick={disconnect}>
                <WifiOff size={14} /> Disconnect
              </button>
            </div>
          )}

          <p style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: 16 }}>
            The first connection shows an "Allow this device?" prompt on the TV screen —
            accept it there. After that, the pairing token is saved and future connections
            are instant.
          </p>
        </div>
      )}

      {tab === 'remote' && connected && (
        <div className="rc-actions-grid">
          {TV_QUICK_KEYS.map(k => (
            <button key={k.id} className="rc-action-btn blue" onClick={() => handleKey(k.id)}>
              <div className="rc-action-icon blue" style={{ fontSize: '1.1rem' }}>{k.icon}</div>
              <span>{k.label}</span>
            </button>
          ))}
        </div>
      )}

      {tab === 'touchpad' && connected && (
        <div className="tp-layout">
          <div className="tp-main">
            <div className="tp-touchpad-container">
              <span style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>Drag to move the TV's on-screen pointer</span>
              <div
                ref={padRef}
                className="tp-touchpad"
                onMouseDown={onPadDown}
                onMouseMove={onPadMove}
                onMouseUp={onPadUp}
                onMouseLeave={onPadUp}
              >
                <div className="tp-touchpad-hint">
                  <Mouse size={32} style={{ opacity: 0.3 }} />
                  <p>Drag here to move the TV cursor</p>
                </div>
              </div>
              <div className="tp-mouse-buttons">
                <button className="tp-click-btn left" onClick={() => clickCursor('left')}>Select</button>
                <button className="tp-click-btn right" onClick={() => clickCursor('right')}>Back</button>
              </div>
            </div>
          </div>

          <div className="tp-sidebar">
            <h3 style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 10 }}>
              Directional Keys
            </h3>
            <div className="tp-quick-keys">
              {['KEY_UP','KEY_DOWN','KEY_LEFT','KEY_RIGHT','KEY_ENTER','KEY_RETURN'].map(k => (
                <button key={k} className="tp-key-btn" onClick={() => handleKey(k)}>{k.replace('KEY_', '')}</button>
              ))}
            </div>

            <h3 style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginTop: 16, marginBottom: 10 }}>
              Type Text
            </h3>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                className="input"
                value={textInput}
                onChange={e => setTextInput(e.target.value)}
                placeholder="Tap a search box on TV first…"
                onKeyDown={e => { if (e.key === 'Enter') handleSendText(); }}
                style={{ flex: 1 }}
              />
              <button className="btn btn-primary btn-sm" onClick={handleSendText} disabled={!textInput.trim()}>
                <Send size={14} />
              </button>
            </div>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', marginTop: 8 }}>
              Works in Samsung's own search/URL fields. Apps with their own keyboard
              (Netflix, YouTube) generally don't accept injected text.
            </p>
          </div>
        </div>
      )}

      {tab === 'apps' && connected && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ fontSize: '0.88rem', fontWeight: 700 }}>Installed Apps</h3>
            <button className="btn btn-outline btn-sm" onClick={loadApps}><RefreshCw size={13} /> Refresh</button>
          </div>
          {apps.length === 0 ? (
            <p style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>
              No apps loaded yet — click Refresh. (Support for this list varies by TV model/firmware.)
            </p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
              {apps.map(app => (
                <button
                  key={app.appId}
                  className="btn btn-outline btn-sm"
                  style={{ justifyContent: 'flex-start' }}
                  onClick={() => launchApp(app.appId)}
                >
                  {app.name || app.appId}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {!connected && tab !== 'connect' && (
        <div className="card" style={{ textAlign: 'center', padding: 48 }}>
          <Tv size={48} style={{ opacity: 0.3, marginBottom: 16 }} />
          <h3 style={{ marginBottom: 8 }}>Not Connected</h3>
          <p style={{ color: 'var(--text-tertiary)' }}>Go to the Connect tab and pair with a TV first.</p>
        </div>
      )}
    </div>
  );
}
