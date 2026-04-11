import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Shield, X, Monitor, Wifi, Mouse, Keyboard as KeyboardIcon,
  AlertTriangle, Maximize, Minimize, ZapOff
} from 'lucide-react';
import { usePcControl } from '../context/PcControlContext';
import {
  moveMouse, clickMouse, scrollMouse,
  pressKey, typeText, captureScreen, holdKey, releaseKey
} from '../api/pcControlApi';

// ─── Key mapping: browser event.key → agent key format ──────────────────
function mapBrowserKey(e) {
  const keyMap = {
    'Escape': 'ESC', 'Enter': 'ENTER', 'Tab': 'TAB',
    'Backspace': 'BACKSPACE', 'Delete': 'DELETE', 'Insert': 'INSERT',
    ' ': 'SPACE', 'Space': 'SPACE',
    'ArrowUp': 'UP', 'ArrowDown': 'DOWN', 'ArrowLeft': 'LEFT', 'ArrowRight': 'RIGHT',
    'Home': 'HOME', 'End': 'END', 'PageUp': 'PAGE_UP', 'PageDown': 'PAGE_DOWN',
    'CapsLock': 'CAPS', 'NumLock': 'NUMLOCK', 'ScrollLock': 'SCROLLLOCK',
    'PrintScreen': 'PRINTSCREEN', 'Pause': 'PAUSE',
    'ContextMenu': 'APPS',
    'F1': 'F1', 'F2': 'F2', 'F3': 'F3', 'F4': 'F4',
    'F5': 'F5', 'F6': 'F6', 'F7': 'F7', 'F8': 'F8',
    'F9': 'F9', 'F10': 'F10', 'F11': 'F11', 'F12': 'F12',
    'Control': 'CTRL', 'Shift': 'SHIFT', 'Alt': 'ALT', 'Meta': 'WIN',
  };

  if (keyMap[e.key]) return keyMap[e.key];

  // Single printable character
  if (e.key.length === 1) return e.key.toUpperCase();

  return e.key.toUpperCase();
}

function buildCombo(e, baseKey) {
  // Don't add modifier prefix if the key itself IS the modifier
  const modifierKeys = ['CTRL', 'SHIFT', 'ALT', 'WIN'];
  if (modifierKeys.includes(baseKey)) return baseKey;

  const parts = [];
  if (e.ctrlKey) parts.push('CTRL');
  if (e.altKey) parts.push('ALT');
  if (e.shiftKey) parts.push('SHIFT');
  if (e.metaKey) parts.push('WIN');
  parts.push(baseKey);
  return parts.join('+');
}

export default function AdminControl({ onExit }) {
  const { settings, baseUrl, connected } = usePcControl();

  const [active, setActive] = useState(false);
  const [screenImg, setScreenImg] = useState(null);
  const [fps, setFps] = useState(0);
  const [inputCount, setInputCount] = useState(0);
  const [pointerLocked, setPointerLocked] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const escTimestamps = useRef([]);
  const screenInterval = useRef(null);
  const frameCount = useRef(0);
  const fpsInterval = useRef(null);
  const isActive = useRef(false);
  const mouseSensitivity = 1.5;
  const scrollSensitivity = 3;
  const moveThrottle = useRef(null);

  // ─── Start admin control ──────────────────────────────────
  const startControl = useCallback(() => {
    setActive(true);
    isActive.current = true;
    escTimestamps.current = [];

    // Request pointer lock
    if (containerRef.current) {
      containerRef.current.requestPointerLock?.();
    }

    // Start screen capture loop
    screenInterval.current = setInterval(async () => {
      if (!isActive.current) return;
      try {
        const res = await captureScreen(baseUrl, settings.secretKey, 35, 3);
        if (res.ok && res.data?.image) {
          setScreenImg('data:image/jpeg;base64,' + res.data.image);
          frameCount.current++;
        }
      } catch {}
    }, 800);

    // FPS counter
    fpsInterval.current = setInterval(() => {
      setFps(frameCount.current);
      frameCount.current = 0;
    }, 1000);
  }, [baseUrl, settings.secretKey]);

  // ─── Exit admin control ───────────────────────────────────
  const exitControl = useCallback(() => {
    isActive.current = false;
    setActive(false);
    setPointerLocked(false);

    // Exit pointer lock
    if (document.pointerLockElement) {
      document.exitPointerLock();
    }
    // Exit fullscreen
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }

    clearInterval(screenInterval.current);
    clearInterval(fpsInterval.current);

    onExit?.();
  }, [onExit]);

  // ─── Pointer lock change tracking ────────────────────────
  useEffect(() => {
    function handleLockChange() {
      setPointerLocked(!!document.pointerLockElement);
      // If pointer lock was lost and we're still active, re-request it
      if (!document.pointerLockElement && isActive.current) {
        // Small delay to avoid rapid re-lock issues
        setTimeout(() => {
          if (isActive.current && containerRef.current) {
            containerRef.current.requestPointerLock?.();
          }
        }, 500);
      }
    }
    document.addEventListener('pointerlockchange', handleLockChange);
    return () => document.removeEventListener('pointerlockchange', handleLockChange);
  }, []);

  // ─── Mouse movement handler ───────────────────────────────
  useEffect(() => {
    if (!active) return;

    function handleMouseMove(e) {
      if (!isActive.current || !document.pointerLockElement) return;
      const dx = e.movementX * mouseSensitivity;
      const dy = e.movementY * mouseSensitivity;
      if (Math.abs(dx) < 0.3 && Math.abs(dy) < 0.3) return;

      // Throttle mouse movement to ~60fps
      if (!moveThrottle.current) {
        moveThrottle.current = setTimeout(() => { moveThrottle.current = null; }, 16);
        moveMouse(baseUrl, settings.secretKey, dx, dy);
        setInputCount(c => c + 1);
      }
    }

    document.addEventListener('mousemove', handleMouseMove);
    return () => document.removeEventListener('mousemove', handleMouseMove);
  }, [active, baseUrl, settings.secretKey]);

  // ─── Mouse click handler ──────────────────────────────────
  useEffect(() => {
    if (!active) return;

    function handleMouseDown(e) {
      if (!isActive.current) return;
      e.preventDefault();
      const buttonMap = { 0: 'left', 1: 'middle', 2: 'right' };
      const button = buttonMap[e.button] || 'left';
      clickMouse(baseUrl, settings.secretKey, button, false);
      setInputCount(c => c + 1);
    }

    function handleDblClick(e) {
      if (!isActive.current) return;
      e.preventDefault();
      clickMouse(baseUrl, settings.secretKey, 'left', true);
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

  // ─── Scroll handler ───────────────────────────────────────
  useEffect(() => {
    if (!active) return;

    function handleWheel(e) {
      if (!isActive.current) return;
      e.preventDefault();
      const amount = (e.deltaY > 0 ? 1 : -1) * scrollSensitivity;
      scrollMouse(baseUrl, settings.secretKey, amount, e.shiftKey);
      setInputCount(c => c + 1);
    }

    document.addEventListener('wheel', handleWheel, { passive: false });
    return () => document.removeEventListener('wheel', handleWheel);
  }, [active, baseUrl, settings.secretKey]);

  // ─── Keyboard handler with triple-ESC detection ───────────
  useEffect(() => {
    if (!active) return;

    function handleKeyDown(e) {
      if (!isActive.current) return;
      e.preventDefault();
      e.stopPropagation();

      const key = mapBrowserKey(e);

      // ── Triple ESC detection ──
      if (key === 'ESC') {
        const now = Date.now();
        escTimestamps.current.push(now);
        // Keep only timestamps within last 1.5 seconds
        escTimestamps.current = escTimestamps.current.filter(t => now - t < 1500);
        if (escTimestamps.current.length >= 3) {
          exitControl();
          return;
        }
        // Still send single ESC to the remote PC
      }

      // Build combo with modifiers
      const combo = buildCombo(e, key);
      pressKey(baseUrl, settings.secretKey, combo);
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

  // ─── Cleanup on unmount ───────────────────────────────────
  useEffect(() => {
    return () => {
      isActive.current = false;
      clearInterval(screenInterval.current);
      clearInterval(fpsInterval.current);
      if (document.pointerLockElement) document.exitPointerLock();
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, []);

  // ─── Toggle fullscreen ────────────────────────────────────
  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen();
      setFullscreen(false);
    } else if (containerRef.current) {
      containerRef.current.requestFullscreen();
      setFullscreen(true);
    }
  }

  // ─── Pre-activation prompt ────────────────────────────────
  if (!active) {
    return (
      <div className="ac-overlay">
        <div className="ac-prompt">
          <div className="ac-prompt-icon">
            <Shield size={48} />
          </div>
          <h2>Admin Control Mode</h2>
          <p className="ac-prompt-desc">
            Your mouse, keyboard, and scroll will be <strong>directly forwarded</strong> to the remote computer.
            The browser will capture all input — nothing will interact with your local machine.
          </p>

          <div className="ac-prompt-info">
            <div className="ac-info-row">
              <Mouse size={16} /> Mouse movements → Remote cursor
            </div>
            <div className="ac-info-row">
              <KeyboardIcon size={16} /> All keystrokes → Remote keyboard
            </div>
            <div className="ac-info-row">
              <Monitor size={16} /> Live screen feed from remote PC
            </div>
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

  // ─── Active control mode ──────────────────────────────────
  return (
    <div
      className="ac-container"
      ref={containerRef}
      tabIndex={0}
    >
      {/* Status bar */}
      <div className="ac-statusbar">
        <div className="ac-statusbar-left">
          <Shield size={14} style={{ color: 'var(--accent-emerald)' }} />
          <span className="ac-status-label">ADMIN CONTROL ACTIVE</span>
          <span className="ac-status-dot online" />
          <span className="ac-status-detail">{settings.ip}:{settings.port}</span>
        </div>
        <div className="ac-statusbar-center">
          <span className="ac-stat">
            <Mouse size={12} /> {pointerLocked ? 'Locked' : 'Click to lock'}
          </span>
          <span className="ac-stat">
            <Monitor size={12} /> {fps} FPS
          </span>
          <span className="ac-stat">
            <Wifi size={12} /> {inputCount} inputs
          </span>
        </div>
        <div className="ac-statusbar-right">
          <button className="ac-bar-btn" onClick={toggleFullscreen} title={fullscreen ? 'Exit Fullscreen' : 'Fullscreen'}>
            {fullscreen ? <Minimize size={14} /> : <Maximize size={14} />}
          </button>
          <button className="ac-bar-btn danger" onClick={exitControl} title="Disconnect (or press ESC×3)">
            <ZapOff size={14} /> Disconnect
          </button>
        </div>
      </div>

      {/* Screen display */}
      <div className="ac-screen" onClick={() => {
        if (!document.pointerLockElement && containerRef.current) {
          containerRef.current.requestPointerLock?.();
        }
      }}>
        {screenImg ? (
          <img src={screenImg} alt="Remote PC Screen" className="ac-screen-img" draggable={false} />
        ) : (
          <div className="ac-screen-loading">
            <div className="spinner spinner-lg" />
            <p>Connecting to remote display...</p>
          </div>
        )}
      </div>

      {/* Pointer lock hint overlay */}
      {!pointerLocked && (
        <div className="ac-lock-hint">
          <Mouse size={24} />
          <p>Click anywhere to capture mouse</p>
          <p style={{ fontSize: '0.72rem', opacity: 0.6 }}>Press ESC three times to exit</p>
        </div>
      )}

      {/* ESC hint pulse */}
      {escTimestamps.current.length > 0 && escTimestamps.current.length < 3 && (
        <div className="ac-esc-indicator">
          ESC × {escTimestamps.current.length} / 3
        </div>
      )}
    </div>
  );
}
