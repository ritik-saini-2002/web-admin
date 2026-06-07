import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Shield, X, Monitor, Wifi, Mouse, Keyboard as KeyboardIcon,
  AlertTriangle, Maximize, Minimize, ZapOff, ZoomIn, ZoomOut,
  RotateCcw, Eye
} from 'lucide-react';
import { usePcControl } from '../context/PcControlContext';
import {
  moveMouse, clickMouse, scrollMouse,
  pressKey, getScreenStreamUrl
} from '../api/pcControlApi';

// ─── Allowed key names (whitelist to prevent injection) ──────────────────────
const SAFE_KEYS = new Set([
  'ESC','ENTER','TAB','BACKSPACE','DELETE','INSERT','SPACE',
  'UP','DOWN','LEFT','RIGHT','HOME','END','PAGE_UP','PAGE_DOWN',
  'CAPS','NUMLOCK','SCROLLLOCK','PRINTSCREEN','PAUSE','APPS',
  'F1','F2','F3','F4','F5','F6','F7','F8','F9','F10','F11','F12',
  'CTRL','SHIFT','ALT','WIN',
]);

function mapBrowserKey(e) {
  const keyMap = {
    'Escape':'ESC','Enter':'ENTER','Tab':'TAB','Backspace':'BACKSPACE',
    'Delete':'DELETE','Insert':'INSERT',' ':'SPACE','Space':'SPACE',
    'ArrowUp':'UP','ArrowDown':'DOWN','ArrowLeft':'LEFT','ArrowRight':'RIGHT',
    'Home':'HOME','End':'END','PageUp':'PAGE_UP','PageDown':'PAGE_DOWN',
    'CapsLock':'CAPS','NumLock':'NUMLOCK','ScrollLock':'SCROLLLOCK',
    'PrintScreen':'PRINTSCREEN','Pause':'PAUSE','ContextMenu':'APPS',
    'F1':'F1','F2':'F2','F3':'F3','F4':'F4','F5':'F5','F6':'F6',
    'F7':'F7','F8':'F8','F9':'F9','F10':'F10','F11':'F11','F12':'F12',
    'Control':'CTRL','Shift':'SHIFT','Alt':'ALT','Meta':'WIN',
  };
  if (keyMap[e.key]) return keyMap[e.key];
  // Alphanumeric single chars only
  if (e.key.length === 1 && /^[a-zA-Z0-9 `~!@#$%^&*()\-_=+[\]{}|;:'",.<>/?\\]$/.test(e.key)) {
    return e.key.toUpperCase();
  }
  return null; // reject unknown / unsafe keys
}

function buildCombo(e, baseKey) {
  if (!baseKey) return null;
  const modifierKeys = ['CTRL','SHIFT','ALT','WIN'];
  if (modifierKeys.includes(baseKey)) return baseKey;
  const parts = [];
  if (e.ctrlKey)  parts.push('CTRL');
  if (e.altKey)   parts.push('ALT');
  if (e.shiftKey) parts.push('SHIFT');
  if (e.metaKey)  parts.push('WIN');
  parts.push(baseKey);
  const combo = parts.join('+');
  // Validate combo — only allow safe parts
  const allParts = combo.split('+');
  for (const p of allParts) {
    if (!SAFE_KEYS.has(p) && !/^[A-Z0-9]$/.test(p)) return null;
  }
  return combo;
}

// Rate limiter: max N calls per second
function makeRateLimiter(maxPerSec) {
  let count = 0;
  let resetAt = Date.now() + 1000;
  return () => {
    const now = Date.now();
    if (now > resetAt) { count = 0; resetAt = now + 1000; }
    if (count >= maxPerSec) return false;
    count++;
    return true;
  };
}

export default function AdminControl({ onExit }) {
  const { settings, baseUrl } = usePcControl();

  const [active, setActive]             = useState(false);
  const [streamSrc, setStreamSrc]       = useState('');
  const [streamReady, setStreamReady]   = useState(false);
  const [fps, setFps]                   = useState(20);
  const [quality, setQuality]           = useState('1080p');
  const [inputCount, setInputCount]     = useState(0);
  const [pointerLocked, setPointerLocked] = useState(false);
  const [fullscreen, setFullscreen]     = useState(false);
  const [escCount, setEscCount]         = useState(0);
  const [zoom, setZoom]                 = useState(1);
  const [panOffset, setPanOffset]       = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning]       = useState(false);
  const [streamError, setStreamError]   = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [networkQuality, setNetworkQuality] = useState('auto');

  const containerRef    = useRef(null);
  const imgRef          = useRef(null);
  const escTimestamps   = useRef([]);
  const isActive        = useRef(false);
  const moveThrottle    = useRef(null);
  const panStart        = useRef(null);
  const panOffsetStart  = useRef({ x: 0, y: 0 });
  const streamRetry     = useRef(null);
  const retryCount      = useRef(0);
  const mouseRateLimit  = makeRateLimiter(120); // max 120 mouse moves/s
  const keyRateLimit    = makeRateLimiter(30);  // max 30 key presses/s

  const QUALITY_PRESETS = {
    '720p':  { width: 1280, quality: 55, fps: 25 },
    '1080p': { width: 1920, quality: 75, fps: 20 },
    '2K':    { width: 2560, quality: 85, fps: 15 },
  };

  // ─── Build stream URL ─────────────────────────────────────────────────────
  function buildStreamUrl(preset) {
    const p = QUALITY_PRESETS[preset] || QUALITY_PRESETS['1080p'];
    return getScreenStreamUrl(baseUrl, settings.secretKey, {
      streamPort: 5001,
      width: p.width,
      quality: p.quality,
      fps: p.fps,
    });
  }

  // ─── Start admin control ──────────────────────────────────────────────────
  const startControl = useCallback(() => {
    retryCount.current = 0;
    const src = buildStreamUrl(quality);
    setStreamSrc(src);
    setStreamReady(false);
    setStreamError(false);
    setActive(true);
    isActive.current = true;
    escTimestamps.current = [];
    setEscCount(0);
    setZoom(1);
    setPanOffset({ x: 0, y: 0 });
    setTimeout(() => {
      containerRef.current?.focus();
    }, 50);
  }, [baseUrl, settings.secretKey, quality]);

  // ─── Exit admin control ───────────────────────────────────────────────────
  const exitControl = useCallback(() => {
    isActive.current = false;
    setActive(false);
    setPointerLocked(false);
    setEscCount(0);
    clearTimeout(streamRetry.current);
    if (document.pointerLockElement) document.exitPointerLock();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    onExit?.();
  }, [onExit]);

  // ─── Stream error / auto-reconnect ───────────────────────────────────────
  const handleStreamError = useCallback(() => {
    if (!isActive.current) return;
    setStreamReady(false);
    setStreamError(true);
    clearTimeout(streamRetry.current);
    retryCount.current = Math.min(retryCount.current + 1, 5);
    const delay = Math.min(1000 * retryCount.current, 8000);
    setReconnecting(true);
    streamRetry.current = setTimeout(() => {
      if (!isActive.current) return;
      setReconnecting(false);
      setStreamError(false);
      // Cache-bust URL to force reconnect
      setStreamSrc(buildStreamUrl(quality) + `&_r=${Date.now()}`);
    }, delay);
  }, [quality]);

  // ─── Pointer lock ─────────────────────────────────────────────────────────
  useEffect(() => {
    function handleLockChange() {
      setPointerLocked(!!document.pointerLockElement);
    }
    document.addEventListener('pointerlockchange', handleLockChange);
    return () => document.removeEventListener('pointerlockchange', handleLockChange);
  }, []);

  // ─── Mouse movement ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!active) return;
    function handleMouseMove(e) {
      if (!isActive.current || !document.pointerLockElement) return;
      if (!mouseRateLimit()) return;
      const dx = Math.round(e.movementX * 1.5 / zoom);
      const dy = Math.round(e.movementY * 1.5 / zoom);
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      if (!moveThrottle.current) {
        moveThrottle.current = setTimeout(() => { moveThrottle.current = null; }, 8);
        moveMouse(baseUrl, settings.secretKey, dx, dy).catch(() => {});
        setInputCount(c => c + 1);
      }
    }
    document.addEventListener('mousemove', handleMouseMove);
    return () => document.removeEventListener('mousemove', handleMouseMove);
  }, [active, baseUrl, settings.secretKey, zoom]);

  // ─── Mouse click ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!active) return;
    function handleMouseDown(e) {
      if (!isActive.current) return;
      if (e.target?.closest?.('.ac-bar-btn')) return;
      e.preventDefault();
      const buttonMap = { 0: 'left', 1: 'middle', 2: 'right' };
      const button = buttonMap[e.button] || 'left';
      clickMouse(baseUrl, settings.secretKey, button, false).catch(() => {});
      setInputCount(c => c + 1);
    }
    function handleDblClick(e) {
      if (!isActive.current) return;
      e.preventDefault();
      clickMouse(baseUrl, settings.secretKey, 'left', true).catch(() => {});
      setInputCount(c => c + 1);
    }
    function handleContextMenu(e) {
      if (!isActive.current) return;
      e.preventDefault();
    }
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('dblclick', handleDblClick);
    document.addEventListener('contextmenu', handleContextMenu);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('dblclick', handleDblClick);
      document.removeEventListener('contextmenu', handleContextMenu);
    };
  }, [active, baseUrl, settings.secretKey]);

  // ─── Scroll / zoom ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!active) return;
    function handleWheel(e) {
      if (!isActive.current) return;
      e.preventDefault();
      if (e.ctrlKey) {
        // Ctrl+scroll = zoom
        setZoom(z => Math.min(4, Math.max(0.5, z + (e.deltaY < 0 ? 0.15 : -0.15))));
        return;
      }
      const amount = (e.deltaY > 0 ? 1 : -1) * 3;
      scrollMouse(baseUrl, settings.secretKey, amount, e.shiftKey).catch(() => {});
      setInputCount(c => c + 1);
    }
    document.addEventListener('wheel', handleWheel, { passive: false });
    return () => document.removeEventListener('wheel', handleWheel);
  }, [active, baseUrl, settings.secretKey]);

  // ─── Keyboard ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!active) return;
    function handleKeyDown(e) {
      if (!isActive.current) return;
      e.preventDefault();
      e.stopPropagation();

      // Zoom shortcuts (local only, don't forward)
      if (e.ctrlKey && (e.key === '+' || e.key === '=')) {
        setZoom(z => Math.min(4, z + 0.25)); return;
      }
      if (e.ctrlKey && e.key === '-') {
        setZoom(z => Math.max(0.5, z - 0.25)); return;
      }
      if (e.ctrlKey && e.key === '0') {
        setZoom(1); setPanOffset({ x: 0, y: 0 }); return;
      }

      const key = mapBrowserKey(e);
      if (!key) return; // reject unmapped / unsafe keys

      // Triple ESC detection
      if (key === 'ESC') {
        const now = Date.now();
        escTimestamps.current.push(now);
        escTimestamps.current = escTimestamps.current.filter(t => now - t < 1500);
        setEscCount(escTimestamps.current.length);
        if (escTimestamps.current.length >= 3) { exitControl(); return; }
      }

      if (!keyRateLimit()) return; // rate-limit key presses
      const combo = buildCombo(e, key);
      if (!combo) return;
      pressKey(baseUrl, settings.secretKey, combo).catch(() => {});
      setInputCount(c => c + 1);
    }
    function handleKeyUp(e) {
      if (!isActive.current) return;
      e.preventDefault();
      e.stopPropagation();
    }
    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('keyup', handleKeyUp, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('keyup', handleKeyUp, true);
    };
  }, [active, baseUrl, settings.secretKey, exitControl]);

  // ─── Cleanup ──────────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      isActive.current = false;
      clearTimeout(streamRetry.current);
      if (document.pointerLockElement) document.exitPointerLock();
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, []);

  // ─── Quality change ───────────────────────────────────────────────────────
  function changeQuality(q) {
    setQuality(q);
    if (active) {
      const src = buildStreamUrl(q) + `&_r=${Date.now()}`;
      setStreamSrc(src);
      setStreamReady(false);
    }
  }

  // ─── Zoom controls ────────────────────────────────────────────────────────
  function zoomIn()    { setZoom(z => Math.min(4, z + 0.25)); }
  function zoomOut()   { setZoom(z => Math.max(0.5, z - 0.25)); }
  function resetZoom() { setZoom(1); setPanOffset({ x: 0, y: 0 }); }

  // ─── Pan with middle mouse / space+drag ───────────────────────────────────
  function handleScreenMouseDown(e) {
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      setIsPanning(true);
      panStart.current = { x: e.clientX, y: e.clientY };
      panOffsetStart.current = { ...panOffset };
      e.preventDefault();
    }
  }
  function handleScreenMouseMove(e) {
    if (!isPanning || !panStart.current) return;
    const dx = e.clientX - panStart.current.x;
    const dy = e.clientY - panStart.current.y;
    setPanOffset({ x: panOffsetStart.current.x + dx, y: panOffsetStart.current.y + dy });
  }
  function handleScreenMouseUp() {
    setIsPanning(false);
    panStart.current = null;
  }

  // ─── Fullscreen ───────────────────────────────────────────────────────────
  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen();
      setFullscreen(false);
    } else if (containerRef.current) {
      containerRef.current.requestFullscreen();
      setFullscreen(true);
    }
  }

  // ─── Lock pointer (click to capture) ──────────────────────────────────────
  function handleScreenClick() {
    if (!document.pointerLockElement && containerRef.current) {
      containerRef.current.requestPointerLock?.();
    }
  }

  // ─── Pre-activation prompt ────────────────────────────────────────────────
  if (!active) {
    return (
        <div className="ac-overlay">
          <div className="ac-prompt">
            <div className="ac-prompt-icon"><Shield size={48} /></div>
            <h2>Admin Control Mode</h2>
            <p className="ac-prompt-desc">
              Your mouse, keyboard, and scroll will be <strong>directly forwarded</strong> to the remote computer.
              The browser captures all input — nothing interacts with your local machine.
            </p>

            {/* Quality selector */}
            <div className="ac-quality-select">
              <span className="ac-quality-label">Stream Quality:</span>
              <div className="ac-quality-btns">
                {Object.keys(QUALITY_PRESETS).map(q => (
                    <button
                        key={q}
                        className={`ac-quality-btn ${quality === q ? 'active' : ''}`}
                        onClick={() => setQuality(q)}
                    >
                      {q}
                      <span className="ac-quality-sub">
                    {q === '720p' ? 'Low BW' : q === '1080p' ? 'Balanced' : 'Best Quality'}
                  </span>
                    </button>
                ))}
              </div>
            </div>

            <div className="ac-prompt-info">
              <div className="ac-info-row"><Mouse size={16} /> Mouse movements → Remote cursor</div>
              <div className="ac-info-row"><KeyboardIcon size={16} /> All keystrokes → Remote keyboard</div>
              <div className="ac-info-row"><Monitor size={16} /> Live {quality} screen feed</div>
              <div className="ac-info-row"><ZoomIn size={16} /> Ctrl+Scroll or +/- buttons to zoom</div>
            </div>

            <div className="ac-prompt-warning">
              <AlertTriangle size={16} />
              <span>Press <kbd>ESC</kbd> three times quickly to disconnect</span>
            </div>

            <div className="ac-prompt-actions">
              <button className="btn btn-primary btn-lg ac-start-btn" onClick={startControl}>
                <Shield size={18} /> Activate Admin Control
              </button>
              <button className="btn btn-outline" onClick={onExit}>Cancel</button>
            </div>
          </div>
        </div>
    );
  }

  // ─── Active control mode ──────────────────────────────────────────────────
  return (
      <div
          className={`ac-container ${fullscreen ? 'ac-fullscreen' : ''}`}
          ref={containerRef}
          tabIndex={0}
      >
        {/* Status bar */}
        <div className="ac-statusbar">
          <div className="ac-statusbar-left">
            <Shield size={14} style={{ color: 'var(--accent-emerald)' }} />
            <span className="ac-status-label">ADMIN CONTROL</span>
            <span className="ac-status-dot online" />
            <span className="ac-status-detail">{settings.ip}:{settings.port}</span>
          </div>

          <div className="ac-statusbar-center">
          <span className="ac-stat">
            <Mouse size={12} /> {pointerLocked ? 'Locked' : 'Click to lock'}
          </span>
            <span className="ac-stat">
            <Monitor size={12} /> {streamReady ? `${QUALITY_PRESETS[quality]?.fps}fps` : 'Connecting'}
          </span>
            <span className="ac-stat">
            <Eye size={12} /> {Math.round(zoom * 100)}%
          </span>
            <span className="ac-stat">
            <Wifi size={12} /> {inputCount} inputs
          </span>
          </div>

          <div className="ac-statusbar-right">
            {/* Quality selector */}
            <div className="ac-inline-quality">
              {Object.keys(QUALITY_PRESETS).map(q => (
                  <button
                      key={q}
                      className={`ac-bar-btn ac-q-btn ${quality === q ? 'active' : ''}`}
                      onClick={() => changeQuality(q)}
                      title={`Switch to ${q}`}
                  >{q}</button>
              ))}
            </div>

            {/* Zoom controls */}
            <button className="ac-bar-btn" onClick={zoomOut} title="Zoom Out (Ctrl+-)"><ZoomOut size={13} /></button>
            <span className="ac-zoom-display">{Math.round(zoom * 100)}%</span>
            <button className="ac-bar-btn" onClick={zoomIn} title="Zoom In (Ctrl++)"><ZoomIn size={13} /></button>
            <button className="ac-bar-btn" onClick={resetZoom} title="Reset Zoom (Ctrl+0)"><RotateCcw size={13} /></button>

            <button className="ac-bar-btn" onClick={toggleFullscreen} title="Toggle Fullscreen">
              {fullscreen ? <Minimize size={14} /> : <Maximize size={14} />}
            </button>
            <button className="ac-bar-btn danger" onClick={exitControl} title="Disconnect (ESC×3)">
              <ZapOff size={14} /> Disconnect
            </button>
          </div>
        </div>

        {/* Screen display */}
        <div
            className="ac-screen"
            onClick={handleScreenClick}
            onMouseDown={handleScreenMouseDown}
            onMouseMove={handleScreenMouseMove}
            onMouseUp={handleScreenMouseUp}
            onMouseLeave={handleScreenMouseUp}
            style={{ cursor: isPanning ? 'grabbing' : pointerLocked ? 'none' : 'crosshair' }}
        >
          <div
              className="ac-screen-inner"
              style={{
                transform: `scale(${zoom}) translate(${panOffset.x / zoom}px, ${panOffset.y / zoom}px)`,
                transformOrigin: 'center center',
                transition: isPanning ? 'none' : 'transform 0.1s ease',
                width: '100%',
                height: '100%',
              }}
          >
            {streamSrc && (
                <img
                    ref={imgRef}
                    src={streamSrc}
                    alt="Remote PC Screen"
                    className="ac-screen-img"
                    draggable={false}
                    onLoad={() => { setStreamReady(true); setStreamError(false); retryCount.current = 0; }}
                    onError={handleStreamError}
                />
            )}
          </div>

          {/* Overlays */}
          {!streamReady && !streamError && (
              <div className="ac-screen-loading">
                <div className="spinner spinner-lg" />
                <p>Connecting to remote display…</p>
                <small style={{ color: 'var(--text-tertiary)', marginTop: 6 }}>{quality} · {QUALITY_PRESETS[quality]?.fps}fps</small>
              </div>
          )}

          {streamError && (
              <div className="ac-screen-loading">
                {reconnecting
                    ? <><div className="spinner spinner-lg" /><p>Reconnecting…</p></>
                    : <><AlertTriangle size={32} style={{ color: 'var(--accent-rose)', marginBottom: 8 }} /><p>Stream lost</p></>
                }
              </div>
          )}
        </div>

        {/* Pointer lock hint */}
        {!pointerLocked && streamReady && (
            <div className="ac-lock-hint" onClick={handleScreenClick}>
              <Mouse size={24} />
              <p>Click to capture mouse</p>
              <p style={{ fontSize: '0.72rem', opacity: 0.6 }}>ESC×3 to exit · Ctrl+Scroll to zoom · Alt+Drag to pan</p>
            </div>
        )}

        {/* ESC counter */}
        {escCount > 0 && escCount < 3 && (
            <div className="ac-esc-indicator">ESC × {escCount} / 3</div>
        )}

        {/* Zoom indicator (transient) */}
        {zoom !== 1 && (
            <div className="ac-zoom-indicator">{Math.round(zoom * 100)}%</div>
        )}
      </div>
  );
}