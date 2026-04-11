import { useState, useRef, useCallback, useEffect } from 'react';
import {
  Mouse, Keyboard, Type, Send, RefreshCw, MonitorSmartphone,
  ArrowUp, ArrowDown, ArrowLeft, ArrowRight, CornerDownLeft,
  Delete, Space, SkipBack, ChevronUp, ChevronDown
} from 'lucide-react';
import { usePcControl } from '../context/PcControlContext';
import {
  moveMouse, clickMouse, scrollMouse, pressKey, typeText,
  captureScreen, PC_COMMON_KEYS
} from '../api/pcControlApi';
import { useToast } from '../context/ToastContext';

const KEYBOARD_ROWS = [
  ['ESC','F1','F2','F3','F4','F5','F6','F7','F8','F9','F10','F11','F12'],
  ['`','1','2','3','4','5','6','7','8','9','0','-','=','BACKSPACE'],
  ['TAB','Q','W','E','R','T','Y','U','I','O','P','[',']','\\'],
  ['CAPS','A','S','D','F','G','H','J','K','L',';','\'','ENTER'],
  ['SHIFT','Z','X','C','V','B','N','M',',','.','/','SHIFT'],
  ['CTRL','WIN','ALT','SPACE','ALT','CTRL','LEFT','UP','DOWN','RIGHT'],
];

const MODIFIER_KEYS = ['CTRL', 'ALT', 'SHIFT', 'WIN'];

export default function TouchpadPage() {
  const { settings, baseUrl, connected, pcName } = usePcControl();
  const { addToast } = useToast();
  const [tab, setTab] = useState('touchpad'); // touchpad | keyboard
  const [textInput, setTextInput] = useState('');
  const [screenImg, setScreenImg] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [activeModifiers, setActiveModifiers] = useState(new Set());

  // ── Touchpad state ──
  const touchpadRef = useRef(null);
  const isDragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const moveThrottle = useRef(null);
  const sensitivity = 1.8;

  function handleTouchpadMouseDown(e) {
    if (!connected) return;
    isDragging.current = true;
    const rect = touchpadRef.current.getBoundingClientRect();
    lastPos.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    touchpadRef.current.style.cursor = 'grabbing';
  }

  function handleTouchpadMouseMove(e) {
    if (!isDragging.current || !connected) return;
    const rect = touchpadRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const dx = (x - lastPos.current.x) * sensitivity;
    const dy = (y - lastPos.current.y) * sensitivity;
    lastPos.current = { x, y };
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
      if (!moveThrottle.current) {
        moveThrottle.current = setTimeout(() => { moveThrottle.current = null; }, 16);
        moveMouse(baseUrl, settings.secretKey, dx, dy);
      }
    }
  }

  function handleTouchpadMouseUp() {
    isDragging.current = false;
    if (touchpadRef.current) touchpadRef.current.style.cursor = 'grab';
  }

  function handleTouchpadWheel(e) {
    if (!connected) return;
    e.preventDefault();
    const amount = e.deltaY > 0 ? 3 : -3;
    scrollMouse(baseUrl, settings.secretKey, amount, e.shiftKey);
  }

  async function handleClick(button = 'left', dbl = false) {
    if (!connected) { addToast('Not connected', 'error'); return; }
    await clickMouse(baseUrl, settings.secretKey, button, dbl);
  }

  async function handleScroll(amount) {
    if (!connected) return;
    await scrollMouse(baseUrl, settings.secretKey, amount);
  }

  // ── Keyboard ──
  async function handleKeyPress(key) {
    if (!connected) { addToast('Not connected', 'error'); return; }
    // If modifiers are active, combine them
    if (activeModifiers.size > 0 && !MODIFIER_KEYS.includes(key)) {
      const combo = [...activeModifiers, key].join('+');
      await pressKey(baseUrl, settings.secretKey, combo);
      setActiveModifiers(new Set());
    } else if (MODIFIER_KEYS.includes(key)) {
      setActiveModifiers(prev => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
    } else {
      await pressKey(baseUrl, settings.secretKey, key);
    }
  }

  async function handleTypeText() {
    if (!connected || !textInput.trim()) return;
    await typeText(baseUrl, settings.secretKey, textInput);
    addToast('Text sent', 'success');
    setTextInput('');
  }

  // ── Screen refresh ──
  const refreshScreen = useCallback(async () => {
    if (!connected) return;
    try {
      const res = await captureScreen(baseUrl, settings.secretKey, 30, 4);
      if (res.ok && res.data?.image) {
        setScreenImg('data:image/jpeg;base64,' + res.data.image);
      }
    } catch {}
  }, [baseUrl, settings.secretKey, connected]);

  useEffect(() => {
    if (!autoRefresh || !connected) return;
    refreshScreen();
    const iv = setInterval(refreshScreen, 3000);
    return () => clearInterval(iv);
  }, [autoRefresh, connected, refreshScreen]);

  if (!connected) {
    return (
      <div className="animate-in">
        <div className="page-header">
          <div><h1>Touchpad & Keyboard</h1><p>Control mouse and keyboard remotely</p></div>
        </div>
        <div className="card" style={{ textAlign: 'center', padding: 48 }}>
          <Mouse size={48} style={{ opacity: 0.3, marginBottom: 16 }} />
          <h3 style={{ marginBottom: 8 }}>Not Connected</h3>
          <p style={{ color: 'var(--text-tertiary)' }}>Go to Remote Control and connect to a PC first.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-in">
      <div className="page-header">
        <div>
          <h1>Touchpad & Keyboard</h1>
          <p>Connected to {pcName}</p>
        </div>
        <div className="page-header-actions">
          <div className="tabs" style={{ marginBottom: 0 }}>
            <button className={`tab ${tab === 'touchpad' ? 'active' : ''}`} onClick={() => setTab('touchpad')}>
              <Mouse size={14} /> Touchpad
            </button>
            <button className={`tab ${tab === 'keyboard' ? 'active' : ''}`} onClick={() => setTab('keyboard')}>
              <Keyboard size={14} /> Keyboard
            </button>
          </div>
        </div>
      </div>

      {tab === 'touchpad' && (
        <div className="tp-layout">
          {/* Touchpad area */}
          <div className="tp-main">
            <div className="tp-touchpad-container">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>Drag to move mouse • Scroll with wheel</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn btn-outline btn-sm" onClick={refreshScreen}><RefreshCw size={13} /></button>
                  <button className={`btn btn-sm ${autoRefresh ? 'btn-primary' : 'btn-outline'}`} onClick={() => setAutoRefresh(!autoRefresh)}>
                    <MonitorSmartphone size={13} /> {autoRefresh ? 'Live' : 'Preview'}
                  </button>
                </div>
              </div>

              <div
                ref={touchpadRef}
                className="tp-touchpad"
                onMouseDown={handleTouchpadMouseDown}
                onMouseMove={handleTouchpadMouseMove}
                onMouseUp={handleTouchpadMouseUp}
                onMouseLeave={handleTouchpadMouseUp}
                onWheel={handleTouchpadWheel}
              >
                {screenImg ? (
                  <img src={screenImg} alt="Screen" className="tp-screen-img" draggable={false} />
                ) : (
                  <div className="tp-touchpad-hint">
                    <Mouse size={32} style={{ opacity: 0.3 }} />
                    <p>Drag here to move the mouse</p>
                    <p style={{ fontSize: '0.72rem' }}>Use scroll wheel for scrolling</p>
                  </div>
                )}
              </div>

              {/* Mouse buttons */}
              <div className="tp-mouse-buttons">
                <button className="tp-click-btn left" onClick={() => handleClick('left')} onDoubleClick={() => handleClick('left', true)}>
                  Left Click
                </button>
                <button className="tp-click-btn middle" onClick={() => handleClick('middle')}>
                  Middle
                </button>
                <button className="tp-click-btn right" onClick={() => handleClick('right')}>
                  Right Click
                </button>
              </div>

              {/* Scroll buttons */}
              <div className="tp-scroll-buttons">
                <button className="btn btn-outline btn-sm" onClick={() => handleScroll(-5)}><ChevronUp size={16} /> Scroll Up</button>
                <button className="btn btn-outline btn-sm" onClick={() => handleScroll(5)}><ChevronDown size={16} /> Scroll Down</button>
              </div>
            </div>
          </div>

          {/* Quick keys sidebar */}
          <div className="tp-sidebar">
            <h3 style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 10 }}>Quick Keys</h3>
            <div className="tp-quick-keys">
              {PC_COMMON_KEYS.map(k => (
                <button key={k} className="tp-key-btn" onClick={() => handleKeyPress(k)}>
                  {k}
                </button>
              ))}
            </div>

            {/* Text input */}
            <h3 style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginTop: 16, marginBottom: 10 }}>Type Text</h3>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                className="input"
                value={textInput}
                onChange={e => setTextInput(e.target.value)}
                placeholder="Type text..."
                onKeyDown={e => { if (e.key === 'Enter') handleTypeText(); }}
                style={{ flex: 1 }}
              />
              <button className="btn btn-primary btn-sm" onClick={handleTypeText} disabled={!textInput.trim()}>
                <Send size={14} />
              </button>
            </div>
          </div>
        </div>
      )}

      {tab === 'keyboard' && (
        <div>
          {/* Modifier indicators */}
          {activeModifiers.size > 0 && (
            <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
              {[...activeModifiers].map(m => (
                <span key={m} className="badge badge-blue">{m} held</span>
              ))}
              <button className="btn btn-outline btn-sm" onClick={() => setActiveModifiers(new Set())}>Clear</button>
            </div>
          )}

          {/* Virtual keyboard */}
          <div className="vk-container">
            {KEYBOARD_ROWS.map((row, ri) => (
              <div key={ri} className="vk-row">
                {row.map((key, ki) => {
                  const isModifier = MODIFIER_KEYS.includes(key);
                  const isActive = activeModifiers.has(key);
                  const isWide = ['BACKSPACE','TAB','CAPS','ENTER','SHIFT','SPACE'].includes(key);
                  return (
                    <button
                      key={`${ri}-${ki}`}
                      className={`vk-key ${isWide ? 'wide' : ''} ${key === 'SPACE' ? 'space' : ''} ${isModifier ? 'modifier' : ''} ${isActive ? 'active' : ''}`}
                      onClick={() => handleKeyPress(key)}
                    >
                      {key === 'BACKSPACE' ? <SkipBack size={14} /> :
                       key === 'ENTER' ? <CornerDownLeft size={14} /> :
                       key === 'SPACE' ? <Space size={14} /> :
                       key === 'DELETE' ? <Delete size={14} /> :
                       key === 'LEFT' ? <ArrowLeft size={14} /> :
                       key === 'RIGHT' ? <ArrowRight size={14} /> :
                       key === 'UP' ? <ArrowUp size={14} /> :
                       key === 'DOWN' ? <ArrowDown size={14} /> :
                       key}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          {/* Text input */}
          <div className="card" style={{ marginTop: 20 }}>
            <h3 style={{ fontSize: '0.88rem', fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Type size={16} /> Direct Text Input
            </h3>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="input"
                value={textInput}
                onChange={e => setTextInput(e.target.value)}
                placeholder="Type text to send to PC..."
                onKeyDown={e => { if (e.key === 'Enter') handleTypeText(); }}
                style={{ flex: 1 }}
              />
              <button className="btn btn-primary" onClick={handleTypeText} disabled={!textInput.trim()}>
                <Send size={16} /> Send
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
