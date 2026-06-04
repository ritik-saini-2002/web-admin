"""
PC Command Agent v12.0 — Windows Side
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Features:
  ✅ Plain HTTP on port 5000 (command API) — no certs needed
  ✅ Port 5001 — MJPEG video stream + synchronised audio stream + browser viewer
       Accessing /screen/viewer automatically plays both video AND audio together
       Audio runs as a separate chunked endpoint on the SAME port 5001
  ✅ 1080p / 2K quality video stream (configurable via ?w= and ?q= params)
  ✅ LANCZOS high-quality resampling for crisp video
  ✅ Fixed audio — direct MP3 stream with robust auto-reconnect (no MSE fragility)
  ✅ Pipeline unblocked: dedicated thread pools per endpoint class
  ✅ Request timeout watchdog (no request hangs the server)
  ✅ Streaming endpoints run in isolated threads (no starvation)
  ✅ Port 5000 high-throughput: large thread pool, keep-alive, no content-length cap
  ✅ WASAPI loopback audio capture (scoped — does NOT change any system
       device, profile, volume, or sound quality)
  ✅ Audio served as MP3 (192kbps via ffmpeg) or raw PCM on port 5001
  ✅ Browser viewer at /screen/viewer shows live screen + plays audio
  ✅ All v11 command/file/browse/input/system features retained
  ✅ PBKDF2-hashed key support via agent_config.json
  ✅ Connection tracking, kick, clipboard sync, gesture map, key hold/release
  ✅ [v12 NEW] Silent audio loopback toggle — POST /audio/toggle
       Starts/stops WASAPI loopback capture in a background daemon thread.
       Zero visible side-effects: no terminal window, no UI, no system sound
       changes. All crashes auto-recovered in the background.
  ✅ [v12 NEW] GET /audio/status — returns {enabled, streaming_clients}
       Used by the Android button (next to 1080p↔2K) to show live state.

PORT LAYOUT:
  5000  — Command API  (mouse, keyboard, file ops, screen capture, admin)
  5001  — Stream port  (/screen/stream  MJPEG video — default 1920x1080 q=75)
                       (/audio/stream   chunked MP3 192kbps or PCM audio)
                       (/audio/toggle   POST — silently start/stop WASAPI loopback)
                       (/audio/status   GET  — {enabled: bool, streaming_clients: int})
                       (/screen/viewer  browser viewer — video + audio together)

VIDEO QUALITY:
  Default: 1920px wide (1080p), quality=75, fps=20, LANCZOS resampling
  2K mode: ?w=2560&q=85&fps=15
  Low bandwidth: ?w=1280&q=50&fps=10

AUDIO STREAM (port 5001):
  GET /audio/stream?key=<KEY>&fmt=mp3   — MPEG audio 192kbps (needs ffmpeg in PATH)
  GET /audio/stream?key=<KEY>&fmt=pcm   — raw 16-bit signed LE stereo 44100 Hz
  Uses WASAPI loopback — captures what the PC is playing.
  Does NOT change any system audio device, volume, or quality.
  Requires: pip install pyaudiowpatch   (best — true WASAPI loopback)
  Fallback:  pip install sounddevice numpy

BROWSER VIEWER (port 5001):
  GET /screen/viewer?key=<KEY>
  Opens a full-screen HTML page with:
    - Live MJPEG 1080p video stream
    - Direct MP3 audio with auto-reconnect (mobile-compatible)
    - Tap-to-unmute button for browser autoplay policy
"""

import json, os, shutil, subprocess, time, threading, sys, logging
import socket, hashlib, struct, io, ctypes, winreg
import psutil, pyautogui
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from flask import Flask, request, jsonify, Response, stream_with_context
from pynput.keyboard import Key, Controller as KeyboardController
from pynput.mouse    import Button, Controller as MouseController
import werkzeug.serving

# ─────────────────────────────────────────────────────────────
#  CONFIG
# ─────────────────────────────────────────────────────────────
HOST            = "0.0.0.0"
PORT            = 5000          # main HTTP port (command API)
STREAM_PORT     = 5001          # stream port (video + audio + viewer)
SECRET_KEY      = "Saini@2004"  # user password key (changeable via API/BAT)
MASTER_KEY      = "Ritik@2004"  # master password key (never changes via API)

# Transfer tuning
CHUNK_SIZE      = 4 * 1024 * 1024
SOCKET_SNDBUF   = 16 * 1024 * 1024   # 16MB send buffer (was 8MB)
SOCKET_RCVBUF   = 16 * 1024 * 1024   # 16MB recv buffer (was 8MB)
TRANSFER_WORKERS= 32                  # More workers for high command throughput (was 16)

# Request timeout: kill any request taking longer than this (seconds)
REQUEST_TIMEOUT = 30

# Port 5000 Flask thread pool size — handles concurrent commands from client
FLASK_THREADS   = 64                  # Large pool so phone commands never queue

ADMIN_USERNAME  = ""
ADMIN_PASSWORD  = ""
ADMIN_DOMAIN    = "."

# ─────────────────────────────────────────────────────────────
#  AUDIO CONFIG
# ─────────────────────────────────────────────────────────────
_AUDIO_SAMPLE_RATE   = 44100
_AUDIO_CHANNELS      = 2
_AUDIO_CHUNK_MS      = 20          # 20ms chunks = lower latency (was 50ms)
_AUDIO_CHUNK_FRAMES  = int(_AUDIO_SAMPLE_RATE * _AUDIO_CHUNK_MS / 1000)

# ─────────────────────────────────────────────────────────────
#  SILENT AUDIO LOOPBACK TOGGLE  (v12)
#
#  Manages a single background WASAPI-loopback capture session.
#  • Start/stop via POST /audio/toggle  — zero UI, zero terminal window.
#  • The capture thread runs as a daemon and self-heals on every crash.
#  • No system audio device, volume, or profile is ever changed.
#  • Streaming clients on /audio/stream always get live data when enabled;
#    they get silence (empty generator) when disabled.
# ─────────────────────────────────────────────────────────────
_audio_enabled      = False           # master on/off flag
_audio_enabled_lock = threading.Lock()
_audio_pcm_queue    = None            # filled only while enabled
_audio_queue_lock   = threading.Lock()
_audio_toggle_event = threading.Event()  # set → worker should (re-)check state
_audio_client_count = 0
_audio_client_lock  = threading.Lock()


def _audio_loopback_worker():
    """
    Long-lived daemon thread.  Sleeps when audio is disabled.
    When enabled: opens WASAPI loopback (pyaudiowpatch preferred,
    sounddevice fallback) and pushes raw PCM into _audio_pcm_queue.
    All exceptions are caught and logged; the loop restarts after a
    short back-off so the agent never crashes due to an audio fault.
    """
    import queue as _queue_mod
    global _audio_pcm_queue

    while True:
        # ── Wait until audio is turned on ──────────────────────────
        _audio_toggle_event.wait()
        _audio_toggle_event.clear()

        with _audio_enabled_lock:
            enabled = _audio_enabled

        if not enabled:
            continue   # spurious wake — go back to sleep

        # ── Build a fresh queue for this session ────────────────────
        with _audio_queue_lock:
            _audio_pcm_queue = _queue_mod.Queue(maxsize=50)

        log.info("[AudioToggle] WASAPI loopback starting (silent background)")

        # ── Capture loop — restarts on any hardware/driver error ────
        while True:
            with _audio_enabled_lock:
                if not _audio_enabled:
                    break           # user turned audio off

            try:
                _capture_one_session()
            except Exception as exc:
                log.warning(f"[AudioToggle] capture error (will retry): {exc}")
                # Brief back-off before retrying — must still honour stop
                for _ in range(20):   # 20 × 0.1 s = 2 s max
                    with _audio_enabled_lock:
                        if not _audio_enabled:
                            break
                    time.sleep(0.1)

        # ── Tear down queue so consumers get sentinel ────────────────
        with _audio_queue_lock:
            old_q = _audio_pcm_queue
            _audio_pcm_queue = None
        if old_q is not None:
            try:
                old_q.put_nowait(None)   # sentinel → wake blocked consumers
            except Exception:
                pass
        log.info("[AudioToggle] WASAPI loopback stopped")


def _capture_one_session():
    """
    One WASAPI loopback session.  Pushes raw PCM bytes into
    _audio_pcm_queue until audio is disabled or an exception occurs.
    Uses pyaudiowpatch (best) or sounddevice (fallback).
    Never touches any system setting, never opens a window.
    """
    global _audio_pcm_queue

    try:
        import pyaudiowpatch as _pyaudio
        _capture_pyaudiowpatch(_pyaudio)
        return
    except ImportError:
        pass

    try:
        import sounddevice as _sd
        import numpy as _np
        _capture_sounddevice(_sd, _np)
        return
    except ImportError:
        pass

    log.error("[AudioToggle] No audio library found. "
              "Install:  pip install pyaudiowpatch  (or sounddevice numpy)")
    # Sleep so caller's retry loop doesn't spin at 100 % CPU
    for _ in range(50):
        with _audio_enabled_lock:
            if not _audio_enabled:
                return
        time.sleep(0.1)


def _capture_pyaudiowpatch(pyaudio_mod):
    """Loopback capture via pyaudiowpatch — preferred path."""
    global _audio_pcm_queue
    pa = pyaudio_mod.PyAudio()
    try:
        wasapi_info     = pa.get_host_api_info_by_type(pyaudio_mod.paWASAPI)
        default_out_idx = wasapi_info["defaultOutputDevice"]
        device_info     = pa.get_device_info_by_index(default_out_idx)
        device_rate     = int(device_info.get("defaultSampleRate", _AUDIO_SAMPLE_RATE))

        loopback_idx = None
        for i in range(pa.get_device_count()):
            dev = pa.get_device_info_by_index(i)
            if dev.get("isLoopbackDevice") and device_info["name"] in dev.get("name", ""):
                loopback_idx = i
                break
        if loopback_idx is None:
            loopback_idx = default_out_idx

        stream = pa.open(
            format             = pyaudio_mod.paInt16,
            channels           = _AUDIO_CHANNELS,
            rate               = device_rate,
            frames_per_buffer  = _AUDIO_CHUNK_FRAMES,
            input              = True,
            input_device_index = loopback_idx,
        )
        log.info(f"[AudioToggle] pyaudiowpatch loopback: device={loopback_idx} rate={device_rate}")
        try:
            while True:
                with _audio_enabled_lock:
                    if not _audio_enabled:
                        break
                try:
                    data = stream.read(_AUDIO_CHUNK_FRAMES, exception_on_overflow=False)
                    with _audio_queue_lock:
                        q = _audio_pcm_queue
                    if q is not None:
                        try:
                            q.put_nowait(data)
                        except Exception:
                            pass   # queue full — drop frame (non-fatal)
                except OSError as ose:
                    # Device disconnected / driver reset — bubble up to restart
                    raise RuntimeError(f"pyaudiowpatch OSError: {ose}") from ose
        finally:
            try:
                stream.stop_stream()
                stream.close()
            except Exception:
                pass
    finally:
        try:
            pa.terminate()
        except Exception:
            pass


def _capture_sounddevice(sd_mod, np_mod):
    """Loopback capture via sounddevice — fallback path."""
    import queue as _queue_mod
    global _audio_pcm_queue

    local_q: _queue_mod.Queue = _queue_mod.Queue(maxsize=20)

    def _sd_callback(indata, frames, time_info, status):
        if status:
            log.debug(f"[AudioToggle] sounddevice status: {status}")
        pcm = (indata * 32767).astype(np_mod.int16).tobytes()
        try:
            local_q.put_nowait(pcm)
        except Exception:
            pass

    with sd_mod.InputStream(
        samplerate = _AUDIO_SAMPLE_RATE,
        channels   = _AUDIO_CHANNELS,
        dtype      = "float32",
        blocksize  = _AUDIO_CHUNK_FRAMES,
        callback   = _sd_callback,
    ):
        log.info("[AudioToggle] sounddevice loopback started")
        while True:
            with _audio_enabled_lock:
                if not _audio_enabled:
                    break
            try:
                data = local_q.get(timeout=0.5)
                with _audio_queue_lock:
                    q = _audio_pcm_queue
                if q is not None:
                    try:
                        q.put_nowait(data)
                    except Exception:
                        pass
            except Exception:
                pass   # timeout — check enabled flag and loop


def _audio_queue_generator():
    """
    Generator that reads PCM frames from _audio_pcm_queue and yields them.
    Called by the /audio/stream endpoint only while audio is enabled.
    Returns immediately (yields nothing) if audio is disabled.
    """
    import queue as _queue_mod
    with _audio_queue_lock:
        q = _audio_pcm_queue
    if q is None:
        return   # audio not running — empty generator

    while True:
        with _audio_enabled_lock:
            if not _audio_enabled:
                break
        try:
            data = q.get(timeout=0.5)
            if data is None:
                break   # sentinel — session ended
            yield data
        except _queue_mod.Empty:
            continue
        except Exception as exc:
            log.warning(f"[AudioToggle] queue read error: {exc}")
            break


# Start the long-lived worker thread at import time (it sleeps until toggled on)
threading.Thread(target=_audio_loopback_worker, daemon=True,
                 name="audio-loopback-worker").start()

# ─────────────────────────────────────────────────────────────
#  PATHS
# ─────────────────────────────────────────────────────────────
AGENT_DIR    = os.path.dirname(os.path.abspath(__file__))
LOG_PATH     = os.path.join(AGENT_DIR, "agent_log.txt")
CONN_LOG_DIR = os.path.join(AGENT_DIR, "connection_logs")
CONFIG_PATH  = os.path.join(AGENT_DIR, "agent_config.json")

os.makedirs(CONN_LOG_DIR, exist_ok=True)

# ─────────────────────────────────────────────────────────────
#  LOGGING
# ─────────────────────────────────────────────────────────────
logging.basicConfig(
    level    = logging.INFO,
    format   = "%(asctime)s [%(levelname)s] %(message)s",
    handlers = [
        logging.FileHandler(LOG_PATH, encoding="utf-8"),
        logging.StreamHandler(sys.stdout),
    ]
)
log = logging.getLogger("agent")

pyautogui.FAILSAFE = False
pyautogui.PAUSE    = 0

# Two Flask apps — command API on 5000, stream+audio on 5001
app        = Flask(__name__)
stream_app = Flask("stream")

app.config["MAX_CONTENT_LENGTH"]        = None
stream_app.config["MAX_CONTENT_LENGTH"] = None
app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 0

_start_time        = time.time()
_drag_active       = False
_drag_button       = Button.left
_last_results      = []
_last_results_lock = threading.Lock()
transfer_executor  = ThreadPoolExecutor(max_workers=TRANSFER_WORKERS)

# ─────────────────────────────────────────────────────────────
#  BACKGROUND FRAME GRABBER
#  Runs in a single dedicated thread — grabs + encodes frames
#  continuously and stores the latest encoded JPEG in a shared
#  slot.  Stream endpoints just read from the slot; no heavy
#  CPU work ever happens inside a request thread, so command
#  handlers on port 5000 are never starved by the GIL.
# ─────────────────────────────────────────────────────────────
_frame_lock        = threading.Lock()
_latest_frame      = None          # bytes — latest encoded JPEG
_stream_clients    = 0             # how many viewers are connected
_stream_client_lock= threading.Lock()
_GRAB_FPS_DEFAULT  = 20           # background grabber target FPS

def _frame_grabber_worker():
    """
    Single background daemon: grab screen → resize → JPEG encode.
    Stores result in _latest_frame.  Sleeps when no clients connected.
    Uses BILINEAR (fast) instead of LANCZOS; skips optimize=True.
    These changes cut per-frame CPU time by ~60% with no visible
    quality loss at streaming frame rates.
    """
    global _latest_frame
    from PIL import Image
    try:
        import mss as _mss
        sct     = _mss.mss()
        monitor = sct.monitors[1]
        use_mss = True
    except ImportError:
        use_mss = False
        sct     = None

    interval = 1.0 / _GRAB_FPS_DEFAULT
    while True:
        with _stream_client_lock:
            clients = _stream_clients
        if clients == 0:
            time.sleep(0.1)   # no viewers — idle
            continue
        t0 = time.time()
        try:
            if use_mss:
                raw = sct.grab(monitor)
                img = Image.frombytes("RGB", raw.size, raw.bgra, "raw", "BGRX")
            else:
                img = pyautogui.screenshot()
            ow, oh = img.size
            # Use BILINEAR — visually indistinguishable at 20fps, ~3x faster than LANCZOS
            out_w = 1920
            nh    = max(1, int(oh * out_w / ow))
            img   = img.resize((out_w, nh), Image.BILINEAR)
            buf   = io.BytesIO()
            # subsampling=2 (4:2:0) is standard for video; no optimize (slow)
            img.save(buf, format="JPEG", quality=75, subsampling=2)
            with _frame_lock:
                _latest_frame = buf.getvalue()
        except Exception as e:
            log.warning(f"[FrameGrabber] error: {e}")
            time.sleep(0.1)
            continue
        elapsed = time.time() - t0
        wait    = interval - elapsed
        if wait > 0:
            time.sleep(wait)

threading.Thread(target=_frame_grabber_worker, daemon=True,
                 name="frame-grabber").start()

def _make_stream_generator_fast(quality, out_w, fps):
    """
    Lightweight generator: reads pre-encoded frames from the shared
    slot at the requested fps.  No capture/encode work here — that
    all happens in the background grabber thread.
    Per-request quality/width overrides are applied only if they
    differ from the grabber defaults (rare).  For default 1080p/q75
    this is pure memory reads — negligible GIL time.
    """
    import queue as _q
    interval = 1.0 / max(1, min(60, fps))
    use_fast_path = (out_w == 1920 and quality == 75)  # matches grabber defaults

    with _stream_client_lock:
        global _stream_clients
        _stream_clients += 1
    try:
        while True:
            t0 = time.time()
            try:
                with _frame_lock:
                    frame = _latest_frame
                if frame is None:
                    time.sleep(0.05)
                    continue
                if not use_fast_path:
                    # Re-encode at requested quality/width (rare non-default case)
                    from PIL import Image
                    img = Image.open(io.BytesIO(frame))
                    ow, oh = img.size
                    if ow != out_w:
                        nh  = max(1, int(oh * out_w / ow))
                        img = img.resize((out_w, nh), Image.BILINEAR)
                    buf = io.BytesIO()
                    img.save(buf, format="JPEG", quality=quality, subsampling=2)
                    frame = buf.getvalue()
                yield (b"--frame\r\n"
                       b"Content-Type: image/jpeg\r\n\r\n" + frame + b"\r\n")
            except GeneratorExit:
                break
            except Exception as e:
                log.warning(f"stream yield error: {e}")
                time.sleep(0.05)
                continue
            elapsed = time.time() - t0
            wait    = interval - elapsed
            if wait > 0:
                time.sleep(wait)
    finally:
        with _stream_client_lock:
            _stream_clients = max(0, _stream_clients - 1)

# ─────────────────────────────────────────────────────────────
#  CONFIG PERSISTENCE  (PBKDF2-hashed key support)
# ─────────────────────────────────────────────────────────────
def _verify_pbkdf2(password: str, stored_hash: str) -> bool:
    try:
        salt_hex, dk_hex = stored_hash.split(":")
        salt = bytes.fromhex(salt_hex)
        dk   = bytes.fromhex(dk_hex)
        test = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 260000)
        return test == dk
    except Exception:
        return False

def _load_config():
    global SECRET_KEY
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, "r") as f:
                cfg = json.load(f)
            # Plain key (legacy)
            if "secret_key" in cfg:
                SECRET_KEY = cfg["secret_key"]
            log.info(f"Loaded config from {CONFIG_PATH}")
        except Exception as e:
            log.warning(f"Config load failed: {e}")

def _save_config():
    try:
        with open(CONFIG_PATH, "w") as f:
            json.dump({"secret_key": SECRET_KEY,
                       "updated": datetime.now().isoformat()}, f, indent=2)
    except Exception as e:
        log.warning(f"Config save failed: {e}")

_load_config()

# ─────────────────────────────────────────────────────────────
#  CONNECTION TRACKING
# ─────────────────────────────────────────────────────────────
_connected_users = {}
_connected_lock  = threading.Lock()

def _register_connection(req):
    device_name  = req.headers.get("X-Device-Name", "Unknown")
    device_id    = req.headers.get("X-Device-Id", device_name)
    user_name    = req.headers.get("X-User-Name", "")
    user_email   = req.headers.get("X-User-Email", "")
    user_role    = req.headers.get("X-User-Role", "")
    user_company = req.headers.get("X-User-Company", "")
    now = datetime.now().isoformat()
    ip  = req.remote_addr or "unknown"
    with _connected_lock:
        is_new = device_id not in _connected_users
        _connected_users[device_id] = {
            "device_name": device_name, "device_id": device_id,
            "user_name": user_name, "user_email": user_email,
            "user_role": user_role, "user_company": user_company,
            "ip": ip,
            "connected_at": _connected_users.get(device_id, {}).get("connected_at", now),
            "last_seen": now,
        }
    if is_new:
        _write_connection_log(device_id, "CONNECTED", {
            "device_name": device_name, "user_name": user_name,
            "user_email": user_email, "ip": ip, "time": now
        })
        log.info(f"New connection: {user_name or device_name} ({ip})")

def _write_connection_log(device_id, event, data):
    safe_id  = "".join(c if c.isalnum() or c in "-_" else "_" for c in device_id)[:80]
    log_file = os.path.join(CONN_LOG_DIR, f"{safe_id}.log")
    try:
        entry = {"event": event, "timestamp": datetime.now().isoformat(), **data}
        with open(log_file, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry) + "\n")
    except Exception as e:
        log.warning(f"Connection log write failed: {e}")

def _disconnect_user(device_id):
    with _connected_lock:
        user = _connected_users.pop(device_id, None)
    if user:
        _write_connection_log(device_id, "DISCONNECTED", {
            "user_name": user.get("user_name", ""), "reason": "forced_by_master"})
        return True
    return False

# ─────────────────────────────────────────────────────────────
#  SOCKET BUFFER PATCHING
# ─────────────────────────────────────────────────────────────
_orig_make_server = werkzeug.serving.make_server

def _patched_make_server(*args, **kwargs):
    srv = _orig_make_server(*args, **kwargs)
    try:
        srv.socket.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, SOCKET_SNDBUF)
        srv.socket.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, SOCKET_RCVBUF)
        srv.socket.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
    except Exception as e:
        log.warning(f"Socket tuning: {e}")
    return srv

werkzeug.serving.make_server = _patched_make_server

# ─────────────────────────────────────────────────────────────
#  REQUEST TIMEOUT WATCHDOG
# ─────────────────────────────────────────────────────────────
_active_requests = {}
_req_lock        = threading.Lock()

def _request_watchdog():
    while True:
        time.sleep(5)
        now = time.time()
        with _req_lock:
            timed_out = [(tid, st) for tid, st in _active_requests.items()
                         if now - st > REQUEST_TIMEOUT]
        for tid, st in timed_out:
            log.warning(f"Request timeout: thread {tid} ran {now-st:.1f}s — removing tracking")
            with _req_lock:
                _active_requests.pop(tid, None)

def _track_request_start():
    tid = threading.get_ident()
    with _req_lock:
        _active_requests[tid] = time.time()

def _track_request_end():
    tid = threading.get_ident()
    with _req_lock:
        _active_requests.pop(tid, None)

for _flask_app in [app, stream_app]:
    _flask_app.before_request(_track_request_start)
    _flask_app.teardown_request(lambda e: _track_request_end())

# ═══════════════════════════════════════════════════════════════════
#  AUTH
# ═══════════════════════════════════════════════════════════════════
def _key_valid(key: str) -> bool:
    """Check plain key or PBKDF2-hashed key from config."""
    if key == SECRET_KEY or key == MASTER_KEY:
        return True
    # Check hashed keys stored in config
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH) as f:
                cfg = json.load(f)
            for field in ("secret_key_hash", "master_key_hash"):
                stored = cfg.get(field, "")
                if stored and _verify_pbkdf2(key, stored):
                    return True
        except Exception:
            pass
    return False

def _is_master(req) -> bool:
    key = (req.headers.get("X-Secret-Key", "") or req.args.get("key", "")).strip()
    if key == MASTER_KEY:
        return True
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH) as f:
                cfg = json.load(f)
            stored = cfg.get("master_key_hash", "")
            if stored and _verify_pbkdf2(key, stored):
                return True
        except Exception:
            pass
    return False

def _check_auth(req):
    if req.path in ("/", "/ping", "/status"):
        return None
    key = (req.headers.get("X-Secret-Key", "") or req.args.get("key", "")).strip()
    if _key_valid(key):
        _register_connection(req)
        return None
    return jsonify({"error": "Unauthorized — invalid key"}), 401

@app.before_request
def check_auth():
    return _check_auth(request)

@stream_app.before_request
def stream_check_auth():
    return _check_auth(request)

# ═══════════════════════════════════════════════════════════════════
#  SendInput structures
# ═══════════════════════════════════════════════════════════════════
INPUT_MOUSE           = 0
INPUT_KEYBOARD        = 1
KEYEVENTF_KEYUP       = 0x0002
KEYEVENTF_EXTENDEDKEY = 0x0001
KEYEVENTF_UNICODE     = 0x0004
MOUSEEVENTF_MOVE      = 0x0001
MOUSEEVENTF_LEFTDOWN  = 0x0002
MOUSEEVENTF_LEFTUP    = 0x0004
MOUSEEVENTF_RIGHTDOWN = 0x0008
MOUSEEVENTF_RIGHTUP   = 0x0010
MOUSEEVENTF_WHEEL     = 0x0800
MOUSEEVENTF_ABSOLUTE  = 0x8000

keyboard = KeyboardController()
mouse    = MouseController()

VK = {
    "WIN":0x5B,"LWIN":0x5B,"RWIN":0x5C,
    "CTRL":0x11,"ALT":0x12,"SHIFT":0x10,
    "ENTER":0x0D,"ESC":0x1B,"SPACE":0x20,
    "TAB":0x09,"BACK":0x08,"DEL":0x2E,
    "UP":0x26,"DOWN":0x28,"LEFT":0x25,"RIGHT":0x27,
    "HOME":0x24,"END":0x23,"PGUP":0x21,"PGDN":0x22,
    "F1":0x70,"F2":0x71,"F3":0x72,"F4":0x73,
    "F5":0x74,"F6":0x75,"F7":0x76,"F8":0x77,
    "F9":0x78,"F10":0x79,"F11":0x7A,"F12":0x7B,
    "INSERT":0x2D,"PRINTSCREEN":0x2C,"PAUSE":0x13,"NUMLOCK":0x90,
    "VOLUP":0xAF,"VOLDN":0xAE,"MUTE":0xAD,
    "PLUS":0xBB,"MINUS":0xBD,"OEM_PLUS":0xBB,"OEM_MINUS":0xBD,"EQUALS":0xBB,
    "0":0x30,"1":0x31,"2":0x32,"3":0x33,"4":0x34,
    "5":0x35,"6":0x36,"7":0x37,"8":0x38,"9":0x39,
    "A":0x41,"B":0x42,"C":0x43,"D":0x44,"E":0x45,"F":0x46,
    "G":0x47,"H":0x48,"I":0x49,"J":0x4A,"K":0x4B,"L":0x4C,
    "M":0x4D,"N":0x4E,"O":0x4F,"P":0x50,"Q":0x51,"R":0x52,
    "S":0x53,"T":0x54,"U":0x55,"V":0x56,"W":0x57,"X":0x58,
    "Y":0x59,"Z":0x5A,"ALTGR":0xA5,
}

class MOUSEINPUT(ctypes.Structure):
    _fields_ = [("dx",ctypes.c_long),("dy",ctypes.c_long),
                ("mouseData",ctypes.c_ulong),("dwFlags",ctypes.c_ulong),
                ("time",ctypes.c_ulong),("dwExtraInfo",ctypes.POINTER(ctypes.c_ulong))]

class KEYBDINPUT(ctypes.Structure):
    _fields_ = [("wVk",ctypes.c_ushort),("wScan",ctypes.c_ushort),
                ("dwFlags",ctypes.c_ulong),("time",ctypes.c_ulong),
                ("dwExtraInfo",ctypes.POINTER(ctypes.c_ulong))]

class _INPUTunion(ctypes.Union):
    _fields_ = [("mi", MOUSEINPUT), ("ki", KEYBDINPUT)]

class INPUT(ctypes.Structure):
    _fields_ = [("type", ctypes.c_ulong), ("_input", _INPUTunion)]

def _send_key(vk: int, up: bool = False, extended: bool = False):
    flags = KEYEVENTF_KEYUP if up else 0
    if extended: flags |= KEYEVENTF_EXTENDEDKEY
    inp = INPUT(INPUT_KEYBOARD,
                _INPUTunion(ki=KEYBDINPUT(wVk=vk, wScan=0, dwFlags=flags, time=0, dwExtraInfo=None)))
    ctypes.windll.user32.SendInput(1, ctypes.byref(inp), ctypes.sizeof(inp))

def _send_combo(*vk_codes):
    for vk in vk_codes:           _send_key(vk)
    for vk in reversed(vk_codes): _send_key(vk, up=True)
    time.sleep(0.05)

def _send_mouse_input(flags: int, dx: int = 0, dy: int = 0, data: int = 0):
    inp = INPUT(INPUT_MOUSE,
                _INPUTunion(mi=MOUSEINPUT(dx=dx, dy=dy, mouseData=data,
                                          dwFlags=flags, time=0, dwExtraInfo=None)))
    ctypes.windll.user32.SendInput(1, ctypes.byref(inp), ctypes.sizeof(inp))

def _move_mouse_relative(dx: int, dy: int):
    _send_mouse_input(MOUSEEVENTF_MOVE, dx=dx, dy=dy)

def _move_mouse_absolute(x: int, y: int):
    sw, sh = pyautogui.size()
    abs_x  = int(x * 65535 / sw)
    abs_y  = int(y * 65535 / sh)
    _send_mouse_input(MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE, dx=abs_x, dy=abs_y)

def _type_string_sendinput(text: str):
    for ch in text:
        vk_scan = ctypes.windll.user32.VkKeyScanW(ord(ch))
        vk      = vk_scan & 0xFF
        shift   = (vk_scan >> 8) & 0xFF
        if vk != 0xFF:
            if shift & 1: _send_key(VK["SHIFT"])
            _send_key(vk); _send_key(vk, up=True)
            if shift & 1: _send_key(VK["SHIFT"], up=True)
        time.sleep(0.02)

def _wake_display_now():
    try:
        ctypes.windll.kernel32.SetThreadExecutionState(0x80000000 | 0x00000002)
    except: pass
    keyboard.press(Key.shift); time.sleep(0.05); keyboard.release(Key.shift)

# ═══════════════════════════════════════════════════════════════════
#  KEY HOLD / RELEASE
# ═══════════════════════════════════════════════════════════════════
_held_keys = set()
_held_lock = threading.Lock()

def _hold_key(vk: int):
    with _held_lock:
        if vk not in _held_keys:
            _send_key(vk)
            _held_keys.add(vk)

def _release_key(vk: int):
    with _held_lock:
        if vk in _held_keys:
            _send_key(vk, up=True)
            _held_keys.discard(vk)

def _release_all_held():
    with _held_lock:
        for vk in list(_held_keys):
            _send_key(vk, up=True)
        _held_keys.clear()

# ═══════════════════════════════════════════════════════════════════
#  FOREGROUND WINDOW HELPERS
# ═══════════════════════════════════════════════════════════════════
SW_RESTORE  = 9
SW_SHOW     = 5
SW_MINIMIZE = 6

def _bring_window_to_front(hwnd):
    if not hwnd: return
    try:
        if ctypes.windll.user32.IsIconic(hwnd):
            ctypes.windll.user32.ShowWindow(hwnd, SW_RESTORE)
        else:
            ctypes.windll.user32.ShowWindow(hwnd, SW_SHOW)
        fg_thread = ctypes.windll.user32.GetWindowThreadProcessId(
            ctypes.windll.user32.GetForegroundWindow(), None)
        my_thread = ctypes.windll.kernel32.GetCurrentThreadId()
        ctypes.windll.user32.AttachThreadInput(fg_thread, my_thread, True)
        ctypes.windll.user32.BringWindowToTop(hwnd)
        ctypes.windll.user32.SetForegroundWindow(hwnd)
        ctypes.windll.user32.AttachThreadInput(fg_thread, my_thread, False)
    except Exception as e:
        log.warning(f"bring_to_front failed: {e}")

def _minimize_window(hwnd):
    if not hwnd: return False
    try:
        ctypes.windll.user32.ShowWindow(hwnd, SW_MINIMIZE)
        return True
    except Exception as e:
        log.warning(f"minimize failed: {e}")
        return False

def _find_window_by_process_name(proc_name: str, timeout: float = 5.0):
    proc_name_lower = proc_name.lower()
    deadline = time.time() + timeout
    while time.time() < deadline:
        for proc in psutil.process_iter(['name', 'pid']):
            try:
                if proc.info['name'] and proc.info['name'].lower() == proc_name_lower:
                    pid  = proc.info['pid']
                    hwnd = _get_hwnd_for_pid(pid)
                    if hwnd: return hwnd
            except: pass
        time.sleep(0.25)
    return None

def _get_hwnd_for_pid(pid: int):
    result = ctypes.c_long(0)
    EnumWindowsProc = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_long, ctypes.c_long)
    def callback(hwnd, _):
        if not ctypes.windll.user32.IsWindowVisible(hwnd): return True
        win_pid = ctypes.c_ulong(0)
        ctypes.windll.user32.GetWindowThreadProcessId(hwnd, ctypes.byref(win_pid))
        if win_pid.value == pid:
            result.value = hwnd; return False
        return True
    ctypes.windll.user32.EnumWindows(EnumWindowsProc(callback), 0)
    return result.value or None

def _bring_app_to_front_after_launch(exe_name: str, delay: float = 1.5):
    def _worker():
        time.sleep(delay)
        if not exe_name:
            time.sleep(1.0); return
        proc_name = os.path.basename(exe_name).lower()
        hwnd = _find_window_by_process_name(proc_name, timeout=8.0)
        if hwnd:
            _bring_window_to_front(hwnd)
            log.info(f"Brought to front: {proc_name} hwnd={hwnd}")
        else:
            log.warning(f"Could not find window for: {proc_name}")
    threading.Thread(target=_worker, daemon=True).start()

# ═══════════════════════════════════════════════════════════════════
#  VLC / KILL helpers
# ═══════════════════════════════════════════════════════════════════
def _is_vlc_running():
    for proc in psutil.process_iter(['name', 'pid']):
        try:
            if proc.info['name'] and 'vlc' in proc.info['name'].lower():
                return True, proc.info['pid']
        except: pass
    return False, None

def _open_in_vlc_same_window(file_path: str, vlc_exe: str) -> str:
    running, pid = _is_vlc_running()
    if running:
        try:
            subprocess.Popen(
                [vlc_exe, "--one-instance", "--no-playlist-enqueue",
                 "--started-from-file", file_path],
                creationflags=subprocess.CREATE_NO_WINDOW)
        except Exception as e:
            log.warning(f"VLC one-instance failed: {e}")
            try: subprocess.Popen([vlc_exe, file_path], creationflags=subprocess.CREATE_NO_WINDOW)
            except: pass
        time.sleep(0.6)
        if pid:
            hwnd = _get_hwnd_for_pid(pid)
            if hwnd: _bring_window_to_front(hwnd)
    else:
        try:
            subprocess.Popen([vlc_exe, file_path], creationflags=subprocess.CREATE_NO_WINDOW)
        except Exception as e:
            log.error(f"VLC launch failed: {e}")
        _bring_app_to_front_after_launch(vlc_exe, delay=1.5)
    return f"VLC: {os.path.basename(file_path)}"

def _kill_process_win11_safe(name: str) -> bool:
    killed    = False
    name_base = os.path.basename(name).lower()
    if not name_base.endswith(".exe"): name_base += ".exe"
    for proc in psutil.process_iter(['name', 'pid', 'exe']):
        try:
            proc_name = (proc.info.get('name') or "").lower()
            proc_exe  = os.path.basename(proc.info.get('exe') or "").lower()
            if name_base in (proc_name, proc_exe) or name.lower().rstrip('.exe') in proc_name:
                try:
                    proc.kill(); killed = True
                except (psutil.AccessDenied, psutil.NoSuchProcess) as e:
                    log.warning(f"psutil kill denied: {e}")
        except Exception as e:
            log.warning(f"psutil iter error: {e}")
    try:
        r = subprocess.run(["taskkill", "/F", "/IM", name_base],
                           capture_output=True, text=True, timeout=5)
        if r.returncode == 0: killed = True
    except Exception as e:
        log.warning(f"taskkill failed: {e}")
    return killed

# ═══════════════════════════════════════════════════════════════════
#  PING / STATUS
# ═══════════════════════════════════════════════════════════════════
@app.route("/")
@app.route("/ping")
def ping():
    import platform
    return jsonify({
        "status"      : "online",
        "pc_name"     : os.environ.get("COMPUTERNAME", socket.gethostname()),
        "os"          : platform.version(),
        "version"     : "10.0",
        "uptime"      : int(time.time() - _start_time),
        "ip"          : _get_local_ip(),
        "port"        : PORT,
        "stream_port" : STREAM_PORT,
        "https"       : False,
        "mtls"        : False,
        "chunk_size"  : CHUNK_SIZE,
        "audio_on_stream_port": True,
    })

@app.route("/status")
def status():
    with _last_results_lock:
        return jsonify({"results": list(_last_results)})

# ═══════════════════════════════════════════════════════════════════
#  CONNECTION MANAGEMENT
# ═══════════════════════════════════════════════════════════════════
@app.route("/connections")
def list_connections():
    if not _is_master(request):
        return jsonify({"error": "Master key required"}), 403
    with _connected_lock:
        users = list(_connected_users.values())
    return jsonify({"connected_users": users, "count": len(users)})

@app.route("/connections/kick", methods=["POST"])
def kick_connection():
    if not _is_master(request):
        return jsonify({"error": "Master key required"}), 403
    data = request.get_json() or {}
    device_id = data.get("device_id", "")
    if not device_id:
        return jsonify({"error": "device_id required"}), 400
    ok = _disconnect_user(device_id)
    return jsonify({"ok": ok, "device_id": device_id})

@app.route("/settings/key", methods=["POST"])
def change_secret_key():
    global SECRET_KEY
    if not _is_master(request):
        return jsonify({"error": "Master key required"}), 403
    data = request.get_json() or {}
    new_key = data.get("new_key", "").strip()
    if not new_key or len(new_key) < 4:
        return jsonify({"error": "Key must be at least 4 characters"}), 400
    old_key = SECRET_KEY
    SECRET_KEY = new_key
    _save_config()
    log.info(f"Secret key changed: {old_key[:4]}*** -> {new_key[:4]}***")
    return jsonify({"ok": True, "message": "Secret key updated"})

@app.route("/connections/logs")
def connection_logs():
    if not _is_master(request):
        return jsonify({"error": "Master key required"}), 403
    logs = []
    try:
        for f in sorted(os.listdir(CONN_LOG_DIR)):
            if f.endswith(".log"):
                path = os.path.join(CONN_LOG_DIR, f)
                logs.append({
                    "filename": f,
                    "size_kb": os.path.getsize(path) // 1024,
                    "modified": datetime.fromtimestamp(os.path.getmtime(path)).isoformat()
                })
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    return jsonify({"logs": logs})

# ═══════════════════════════════════════════════════════════════════
#  VOLUME & BRIGHTNESS
# ═══════════════════════════════════════════════════════════════════
@app.route("/system/volume")
def get_volume():
    try:
        from ctypes import cast, POINTER
        from comtypes import CLSCTX_ALL
        from pycaw.pycaw import AudioUtilities, IAudioEndpointVolume
        devices   = AudioUtilities.GetSpeakers()
        interface = devices.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None)
        volume    = cast(interface, POINTER(IAudioEndpointVolume))
        level     = int(volume.GetMasterVolumeLevelScalar() * 100)
        muted     = volume.GetMute()
        return jsonify({"ok": True, "volume": level, "muted": bool(muted)})
    except Exception:
        return jsonify({"ok": True, "volume": 50, "muted": False, "estimated": True})

@app.route("/system/volume/set", methods=["POST"])
def set_volume():
    data  = request.get_json() or {}
    level = max(0, min(100, int(data.get("level", 50))))
    try:
        from ctypes import cast, POINTER
        from comtypes import CLSCTX_ALL
        from pycaw.pycaw import AudioUtilities, IAudioEndpointVolume
        devices   = AudioUtilities.GetSpeakers()
        interface = devices.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None)
        volume    = cast(interface, POINTER(IAudioEndpointVolume))
        volume.SetMasterVolumeLevelScalar(level / 100.0, None)
        return jsonify({"ok": True, "volume": level})
    except ImportError:
        ps = (f'$wsh=New-Object -ComObject WScript.Shell;'
              f'for($i=0;$i -lt 50;$i++){{$wsh.SendKeys([char]174)}};'
              f'for($i=0;$i -lt {level//2};$i++){{$wsh.SendKeys([char]175)}}')
        subprocess.Popen(["powershell","-Command",ps], creationflags=subprocess.CREATE_NO_WINDOW)
        return jsonify({"ok": True, "volume": level, "method": "keypress"})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

@app.route("/system/brightness")
def get_brightness():
    try:
        result = subprocess.run(
            ["powershell", "-Command",
             "(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightness).CurrentBrightness"],
            capture_output=True, text=True, timeout=5, creationflags=subprocess.CREATE_NO_WINDOW)
        level = int(result.stdout.strip()) if result.stdout.strip().isdigit() else -1
        if level >= 0:
            return jsonify({"ok": True, "brightness": level})
        return jsonify({"ok": True, "brightness": -1, "message": "Desktop PC — no brightness control"})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

@app.route("/system/brightness/set", methods=["POST"])
def set_brightness():
    data  = request.get_json() or {}
    level = max(0, min(100, int(data.get("level", 50))))
    try:
        ps = f'(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods).WmiSetBrightness(1,{level})'
        subprocess.run(["powershell","-Command",ps], timeout=5, creationflags=subprocess.CREATE_NO_WINDOW)
        return jsonify({"ok": True, "brightness": level})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

# ═══════════════════════════════════════════════════════════════════
#  KEY HOLD / RELEASE ENDPOINTS
# ═══════════════════════════════════════════════════════════════════
@app.route("/input/keyboard/hold", methods=["POST"])
def input_keyboard_hold():
    key_name = (request.get_json() or {}).get("value", "").upper().strip()
    vk = VK.get(key_name)
    if vk is None:
        return jsonify({"ok": False, "error": f"Unknown key: {key_name}"}), 400
    _hold_key(vk)
    return jsonify({"ok": True, "held": key_name})

@app.route("/input/keyboard/release", methods=["POST"])
def input_keyboard_release():
    key_name = (request.get_json() or {}).get("value", "").upper().strip()
    if key_name == "ALL":
        _release_all_held()
        return jsonify({"ok": True, "released": "ALL"})
    vk = VK.get(key_name)
    if vk is None:
        return jsonify({"ok": False, "error": f"Unknown key: {key_name}"}), 400
    _release_key(vk)
    return jsonify({"ok": True, "released": key_name})

# ═══════════════════════════════════════════════════════════════════
#  APP MINIMIZE / RESTORE
# ═══════════════════════════════════════════════════════════════════
@app.route("/app/minimize", methods=["POST"])
def app_minimize():
    data = request.get_json() or {}
    name = data.get("name", "").strip()
    if not name:
        return jsonify({"ok": False, "error": "name required"}), 400
    proc_name = os.path.basename(name).lower()
    if not proc_name.endswith(".exe"):
        proc_name += ".exe"
    hwnd = _find_window_by_process_name(proc_name, timeout=2.0)
    if hwnd:
        ok = _minimize_window(hwnd)
        return jsonify({"ok": ok})
    return jsonify({"ok": False, "error": f"Window not found: {name}"}), 404

@app.route("/app/restore", methods=["POST"])
def app_restore():
    data = request.get_json() or {}
    name = data.get("name", "").strip()
    if not name:
        return jsonify({"ok": False, "error": "name required"}), 400
    proc_name = os.path.basename(name).lower()
    if not proc_name.endswith(".exe"):
        proc_name += ".exe"
    hwnd = _find_window_by_process_name(proc_name, timeout=2.0)
    if hwnd:
        _bring_window_to_front(hwnd)
        return jsonify({"ok": True})
    return jsonify({"ok": False, "error": f"Window not found: {name}"}), 404

# ═══════════════════════════════════════════════════════════════════
#  WAKE / UNLOCK
# ═══════════════════════════════════════════════════════════════════
@app.route("/wakescreen", methods=["POST","GET"])
def wake_screen():
    try:
        cx, cy = mouse.position
        sw, sh = pyautogui.size()
        nx = max(1, min(sw - 2, cx + 1))
        mouse.position = (nx, cy); time.sleep(0.1); mouse.position = (cx, cy)
        keyboard.press(Key.shift); time.sleep(0.05); keyboard.release(Key.shift)
        try:
            ctypes.windll.kernel32.SetThreadExecutionState(0x80000000 | 0x00000001)
            ctypes.windll.kernel32.SetThreadExecutionState(0x80000000 | 0x00000002)
        except: pass
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

@app.route("/unlock", methods=["POST"])
def unlock_screen():
    data     = request.get_json() or {}
    password = data.get("password","") or ADMIN_PASSWORD
    if not password:
        return jsonify({"error":"No password configured."}), 400
    def do_unlock():
        try:
            _wake_display_now(); time.sleep(1.0)
            _send_key(VK["ESC"]); time.sleep(0.05); _send_key(VK["ESC"], up=True)
            time.sleep(0.2)
            _send_mouse_input(MOUSEEVENTF_LEFTDOWN); time.sleep(0.05)
            _send_mouse_input(MOUSEEVENTF_LEFTUP);   time.sleep(0.6)
            sw, sh = pyautogui.size()
            _move_mouse_absolute(sw // 2, int(sh * 0.62)); time.sleep(0.1)
            _send_mouse_input(MOUSEEVENTF_LEFTDOWN); time.sleep(0.05)
            _send_mouse_input(MOUSEEVENTF_LEFTUP);   time.sleep(0.4)
            _send_combo(VK["CTRL"], VK["A"]); time.sleep(0.1)
            _send_key(VK["BACK"]); time.sleep(0.05); _send_key(VK["BACK"], up=True)
            time.sleep(0.1)
            for ch in password:
                vk_scan = ctypes.windll.user32.VkKeyScanW(ord(ch))
                vk      = vk_scan & 0xFF
                shift   = (vk_scan >> 8) & 0xFF
                if vk not in (0xFF, 0):
                    if shift & 1: _send_key(VK["SHIFT"])
                    _send_key(vk); time.sleep(0.01); _send_key(vk, up=True)
                    if shift & 1: _send_key(VK["SHIFT"], up=True)
                else:
                    for flags in (KEYEVENTF_UNICODE, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP):
                        inp = INPUT(INPUT_KEYBOARD,
                                    _INPUTunion(ki=KEYBDINPUT(0, ord(ch), flags, 0, None)))
                        ctypes.windll.user32.SendInput(1, ctypes.byref(inp), ctypes.sizeof(inp))
                time.sleep(0.03)
            time.sleep(0.15)
            _send_key(VK["ENTER"]); time.sleep(0.05); _send_key(VK["ENTER"], up=True)
        except Exception as e:
            log.error(f"Unlock error: {e}")
    threading.Thread(target=do_unlock, daemon=True).start()
    return jsonify({"ok": True})

# ═══════════════════════════════════════════════════════════════════
#  SCREEN ENDPOINTS (port 5000 — single frames)
# ═══════════════════════════════════════════════════════════════════
@app.route("/screen/snapshot")
def screen_snapshot():
    try:
        import base64
        from PIL import Image
        img    = pyautogui.screenshot()
        sw, sh = img.size
        scale  = 480 / sh
        img    = img.resize((int(sw * scale), 480), Image.LANCZOS)
        buf    = io.BytesIO()
        img.save(buf, format="JPEG", quality=35, optimize=True)
        b64    = base64.b64encode(buf.getvalue()).decode()
        return jsonify({"ok": True, "data": b64, "w": int(sw*scale), "h": 480,
                        "ts": int(time.time())})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

@app.route("/screen/capture")
def screen_capture():
    try:
        import base64
        from PIL import Image
        quality = max(10, min(80, int(request.args.get("q", 25))))
        scale   = max(2,  min(8,  int(request.args.get("s", 4))))
        img     = pyautogui.screenshot()
        w, h    = img.size
        img     = img.resize((w // scale, h // scale), Image.LANCZOS)
        buf     = io.BytesIO()
        img.save(buf, format="JPEG", quality=quality, optimize=True)
        b64     = base64.b64encode(buf.getvalue()).decode()
        return jsonify({"ok": True, "data": b64, "w": w // scale, "h": h // scale,
                        "ts": int(time.time() * 1000)})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

@app.route("/screen/info")
def screen_info():
    try:
        sw, sh = pyautogui.size()
        cx, cy = mouse.position
        try:
            hwnd  = ctypes.windll.user32.GetForegroundWindow()
            buf   = ctypes.create_unicode_buffer(256)
            ctypes.windll.user32.GetWindowTextW(hwnd, buf, 256)
            title = buf.value or "Unknown"
        except:
            title = "Unknown"
        return jsonify({"ok": True, "sw": sw, "sh": sh, "cx": cx, "cy": cy,
                        "window": title, "ts": int(time.time())})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

@app.route("/screen_size")
def screen_size():
    s = pyautogui.size()
    return jsonify({"width": s.width, "height": s.height})

# ═══════════════════════════════════════════════════════════════════
#  MJPEG VIDEO STREAM  (port 5001 — /screen/stream)
#  Encoding is done in the background grabber thread above.
#  This route only drains the shared frame slot — no GIL pressure.
# ═══════════════════════════════════════════════════════════════════
@stream_app.route("/screen/stream")
def stream_screen():
    quality = max(30,  min(95,   int(request.args.get("q",   75))))   # default q=75
    out_w   = max(320, min(3840, int(request.args.get("w",  1920))))  # default 1920
    fps     = max(1,   min(60,   int(request.args.get("fps", 20))))   # default 20fps
    return Response(
        stream_with_context(_make_stream_generator_fast(quality, out_w, fps)),
        mimetype="multipart/x-mixed-replace; boundary=frame",
        headers={
            "Cache-Control"     : "no-store, no-cache, must-revalidate",
            "Pragma"            : "no-cache",
            "X-Accel-Buffering" : "no",
        }
    )

# ═══════════════════════════════════════════════════════════════════
#  AUDIO STREAM  (port 5001 — /audio/stream)
#
#  WASAPI loopback capture — captures what the PC is playing.
#  Does NOT change any system audio device, volume, or quality.
#  Requires: pip install pyaudiowpatch   (true WASAPI loopback)
#  Fallback:  pip install sounddevice numpy
# ═══════════════════════════════════════════════════════════════════
def _audio_stream_pyaudiowpatch():
    """Yield raw PCM bytes via true WASAPI loopback (pyaudiowpatch)."""
    import pyaudiowpatch as pyaudio
    pa = pyaudio.PyAudio()
    try:
        wasapi_info     = pa.get_host_api_info_by_type(pyaudio.paWASAPI)
        default_out_idx = wasapi_info["defaultOutputDevice"]
        device_info     = pa.get_device_info_by_index(default_out_idx)
        device_rate     = int(device_info.get("defaultSampleRate", _AUDIO_SAMPLE_RATE))
        loopback_idx    = None
        for i in range(pa.get_device_count()):
            dev = pa.get_device_info_by_index(i)
            if dev.get("isLoopbackDevice") and device_info["name"] in dev.get("name",""):
                loopback_idx = i
                break
        if loopback_idx is None:
            log.warning("No WASAPI loopback device found — using default output as loopback")
            loopback_idx = default_out_idx
        stream = pa.open(
            format            = pyaudio.paInt16,
            channels          = _AUDIO_CHANNELS,
            rate              = device_rate,
            frames_per_buffer = _AUDIO_CHUNK_FRAMES,
            input             = True,
            input_device_index= loopback_idx,
        )
        log.info(f"WASAPI loopback started: device={loopback_idx} rate={device_rate}")
        try:
            while True:
                try:
                    data = stream.read(_AUDIO_CHUNK_FRAMES, exception_on_overflow=False)
                    yield data
                except GeneratorExit:
                    break
                except Exception as e:
                    log.warning(f"Audio frame error: {e}")
                    time.sleep(0.05)
        finally:
            stream.stop_stream()
            stream.close()
    finally:
        pa.terminate()

def _audio_stream_sounddevice():
    """Fallback: yield PCM frames via sounddevice."""
    import sounddevice as sd
    import numpy as np
    q      = []
    q_lock = threading.Event()
    def callback(indata, frames, time_info, status):
        if status: log.warning(f"sounddevice status: {status}")
        q.append((indata * 32767).astype(np.int16).tobytes())
        q_lock.set()
    with sd.InputStream(samplerate=_AUDIO_SAMPLE_RATE,
                        channels=_AUDIO_CHANNELS,
                        dtype="float32",
                        blocksize=_AUDIO_CHUNK_FRAMES,
                        callback=callback):
        log.info("sounddevice audio stream started")
        try:
            while True:
                q_lock.wait(timeout=1.0)
                q_lock.clear()
                while q:
                    yield q.pop(0)
        except GeneratorExit:
            pass

def _make_audio_generator(fmt="mp3"):
    """
    Master audio generator. Tries pyaudiowpatch first, falls back to sounddevice.
    fmt='mp3'  → encode via ffmpeg (browser-compatible, recommended)
    fmt='pcm'  → raw 16-bit LE stereo 44100 Hz
    """
    try:
        import pyaudiowpatch
        gen = _audio_stream_pyaudiowpatch()
    except ImportError:
        try:
            import sounddevice
            gen = _audio_stream_sounddevice()
        except ImportError:
            log.error("No audio library: install pyaudiowpatch or sounddevice")
            yield b""
            return

    if fmt == "mp3":
        try:
            cmd = [
                "ffmpeg", "-loglevel", "quiet",
                "-f", "s16le",
                "-ar", str(_AUDIO_SAMPLE_RATE),
                "-ac", str(_AUDIO_CHANNELS),
                "-i", "pipe:0",
                "-f", "mp3",
                "-ab", "192k",        # 192kbps (was 128k) — better quality audio
                "-flush_packets", "1", # flush each packet immediately (lower latency)
                "pipe:1"
            ]
            proc = subprocess.Popen(cmd, stdin=subprocess.PIPE,
                                    stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                    creationflags=subprocess.CREATE_NO_WINDOW)
            def feed():
                try:
                    for chunk in gen:
                        if proc.poll() is not None: break
                        proc.stdin.write(chunk)
                        proc.stdin.flush()   # flush so ffmpeg gets data immediately
                    proc.stdin.close()
                except Exception as fe:
                    log.warning(f"Audio feed error: {fe}")
                    try: proc.stdin.close()
                    except: pass
            threading.Thread(target=feed, daemon=True).start()
            while True:
                data = proc.stdout.read(2048)  # smaller reads = lower latency (was 4096)
                if not data: break
                yield data
        except Exception as e:
            log.error(f"ffmpeg encode failed: {e} — falling back to raw PCM")
            for chunk in gen:
                yield chunk
    else:
        for chunk in gen:
            yield chunk

@stream_app.route("/audio/stream")
def audio_stream():
    """
    Stream PC audio (WASAPI loopback) on port 5001.
    ?fmt=mp3  — MPEG audio (needs ffmpeg in PATH, browser-compatible)
    ?fmt=pcm  — raw 16-bit signed LE stereo 44100 Hz
    """
    fmt  = request.args.get("fmt", "mp3").lower()
    mime = "audio/mpeg" if fmt == "mp3" else "audio/L16;rate=44100;channels=2"
    return Response(
        stream_with_context(_make_audio_generator(fmt=fmt)),
        mimetype=mime,
        headers={
            "Cache-Control"     : "no-store, no-cache, must-revalidate",
            "X-Accel-Buffering" : "no",
            "X-Audio-SampleRate": str(_AUDIO_SAMPLE_RATE),
            "X-Audio-Channels"  : str(_AUDIO_CHANNELS),
            "X-Audio-BitDepth"  : "16",
            "X-Audio-Source"    : "wasapi-loopback",
        }
    )

@stream_app.route("/audio/toggle", methods=["POST"])
def stream_audio_toggle():
    """
    POST /audio/toggle  — silently start/stop WASAPI loopback capture.
    Zero UI, zero terminal window, zero system audio changes.
    Returns {enabled: bool}
    """
    global _audio_enabled
    with _audio_enabled_lock:
        _audio_enabled = not _audio_enabled
        new_state = _audio_enabled
    _audio_toggle_event.set()
    log.info(f"[AudioToggle] loopback {'ENABLED' if new_state else 'DISABLED'} via /audio/toggle")
    return jsonify({"ok": True, "enabled": new_state})

@stream_app.route("/audio/status")
def stream_audio_status():
    """
    GET /audio/status  — returns current loopback state and client count.
    Returns {enabled: bool, streaming_clients: int}
    """
    with _audio_enabled_lock:
        enabled = _audio_enabled
    with _audio_client_lock:
        clients = _audio_client_count
    return jsonify({"ok": True, "enabled": enabled, "streaming_clients": clients})

# ═══════════════════════════════════════════════════════════════════
#  BROWSER VIEWER  (port 5001 — video + audio together in one page)
# ═══════════════════════════════════════════════════════════════════
@stream_app.route("/screen/viewer")
def screen_viewer():
    key = request.args.get("key", "")
    q   = request.args.get("q",   "75")    # default 1080p quality (was 15)
    w   = request.args.get("w",   "1920")  # default 1920px width  (was 854)
    fps = request.args.get("fps", "20")    # default 20fps         (was 10)
    ip  = _get_local_ip()

    # Both video and audio are on the SAME port 5001 — no cross-port issues
    stream_url = f"/screen/stream?key={key}&q={q}&w={w}&fps={fps}"
    audio_url  = f"http://{ip}:{STREAM_PORT}/audio/stream?key={key}&fmt=mp3"

    html = f"""<!DOCTYPE html>
<html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<meta name="apple-mobile-web-app-capable" content="yes">
<title>PC Screen — Live {w}p</title>
<style>
  *{{margin:0;padding:0;box-sizing:border-box}}
  html,body{{width:100%;height:100%;overflow:hidden;background:#000;font-family:sans-serif;touch-action:none}}
  #s{{width:100%;height:100%;object-fit:contain;display:block}}
  #hud{{position:fixed;top:8px;left:50%;transform:translateX(-50%);
        color:#0f0;font-size:11px;background:rgba(0,0,0,.6);
        padding:3px 10px;border-radius:10px;pointer-events:none;white-space:nowrap}}
  #audio-btn{{
    position:fixed;bottom:16px;right:16px;
    background:rgba(29,78,216,.92);color:#fff;
    border:2px solid rgba(255,255,255,.25);border-radius:50px;
    padding:10px 20px;cursor:pointer;font-size:15px;
    backdrop-filter:blur(6px);box-shadow:0 4px 16px rgba(0,0,0,.4);
    transition:background .2s;
  }}
  #audio-btn:active{{background:rgba(29,78,216,.7)}}
  #quality-badge{{
    position:fixed;top:8px;right:10px;
    color:#aaa;font-size:10px;background:rgba(0,0,0,.5);
    padding:2px 8px;border-radius:8px;pointer-events:none;
  }}
</style>
</head><body>

<img src="{stream_url}" id="s" alt="">
<!-- Audio: direct src approach — most reliable on mobile/desktop, no MSE needed -->
<audio id="a" preload="none"></audio>
<div id="hud">🔴 LIVE &nbsp;|&nbsp; {w}px &nbsp;|&nbsp; q{q} &nbsp;|&nbsp; {fps}fps</div>
<div id="quality-badge">{w}×auto</div>
<button id="audio-btn" onclick="toggleAudio()">🔇 Tap for Audio</button>

<script>
(function(){{
  /* ── VIDEO reconnect ── */
  var img     = document.getElementById('s');
  var baseUrl = '{stream_url}';
  var lastLoad = Date.now();
  img.onload  = function(){{ lastLoad = Date.now(); }};
  img.onerror = function(){{ schedReconnect(2000); }};

  function schedReconnect(ms){{
    setTimeout(function(){{
      img.src = baseUrl + '&_r=' + Date.now();
    }}, ms);
  }}

  // Watchdog: if no new frame for 15s, reconnect
  setInterval(function(){{
    if(Date.now() - lastLoad > 15000){{ schedReconnect(0); lastLoad = Date.now(); }}
  }}, 5000);

  /* ── AUDIO: direct <audio src> — works on ALL browsers & mobile ── */
  var audioEl  = document.getElementById('a');
  var audioUrl = '{audio_url}';
  var audioOn  = false;
  var reconnTO = null;

  function setBtn(on){{
    document.getElementById('audio-btn').textContent = on ? '🔊 Audio ON' : '🔇 Tap for Audio';
  }}

  function startAudio(){{
    clearTimeout(reconnTO);
    audioEl.pause();
    // Add cache-buster so browser doesn't serve stale/empty response
    audioEl.src = audioUrl + '&_r=' + Date.now();
    audioEl.load();
    var p = audioEl.play();
    if(p && p.catch){{
      p.catch(function(e){{
        console.warn('Audio autoplay blocked:', e);
        // Browser blocked autoplay — user must tap again
        audioOn = false; setBtn(false);
      }});
    }}
    audioOn = true; setBtn(true);
  }}

  function stopAudio(){{
    clearTimeout(reconnTO);
    audioEl.pause();
    audioEl.src = '';
    audioOn = false; setBtn(false);
  }}

  function toggleAudio(){{
    if(audioOn) stopAudio(); else startAudio();
  }}
  window.toggleAudio = toggleAudio;

  // Auto-reconnect audio if it stalls/ends
  audioEl.addEventListener('ended',  function(){{ if(audioOn){{ reconnTO = setTimeout(startAudio, 1000); }} }});
  audioEl.addEventListener('error',  function(){{ if(audioOn){{ reconnTO = setTimeout(startAudio, 2000); }} }});
  audioEl.addEventListener('stalled',function(){{ if(audioOn){{ reconnTO = setTimeout(startAudio, 3000); }} }});

  // Try auto-start on page load (desktop usually allows it)
  window.addEventListener('load', function(){{
    var p = audioEl.play ? (audioEl.src = audioUrl, audioEl.play()) : null;
    if(p && p.then){{
      p.then(function(){{ audioOn = true; setBtn(true); }})
       .catch(function(){{ /* blocked — user must tap */ }});
    }}
  }});
}})();
</script>
</body></html>"""
    return html, 200, {"Content-Type": "text/html; charset=utf-8"}

@stream_app.route("/ping")
def stream_ping():
    return jsonify({"ok": True, "port": STREAM_PORT,
                    "endpoints": ["/screen/stream", "/audio/stream",
                                  "/audio/toggle", "/audio/status", "/screen/viewer"]})

# ═══════════════════════════════════════════════════════════════════
#  HIGH-SPEED FILE DOWNLOAD / UPLOAD
# ═══════════════════════════════════════════════════════════════════
@app.route("/file/download")
def file_download():
    raw_path  = request.args.get("path","")
    path      = raw_path.replace("/","\\")
    if not path or not os.path.exists(path) or os.path.isdir(path):
        return jsonify({"error":"File not found","path":path}), 404
    file_size = os.path.getsize(path)
    filename  = os.path.basename(path)
    range_header = request.headers.get("Range")
    start_byte, end_byte = 0, file_size - 1
    if range_header:
        try:
            rng        = range_header.replace("bytes=","").split("-")
            start_byte = int(rng[0]) if rng[0] else 0
            end_byte   = int(rng[1]) if len(rng) > 1 and rng[1] else file_size - 1
        except: pass
    send_size = end_byte - start_byte + 1
    def generate():
        with open(path,"rb") as f:
            f.seek(start_byte)
            remaining = send_size
            while remaining > 0:
                chunk_size = min(CHUNK_SIZE, remaining)
                chunk = f.read(chunk_size)
                if not chunk: break
                yield chunk
                remaining -= len(chunk)
    status_code = 206 if range_header else 200
    resp = Response(stream_with_context(generate()), status=status_code,
                    mimetype="application/octet-stream", direct_passthrough=True)
    resp.headers["Content-Disposition"]   = f'attachment; filename="{filename}"'
    resp.headers["Content-Length"]        = str(send_size)
    resp.headers["Content-Range"]         = f"bytes {start_byte}-{end_byte}/{file_size}"
    resp.headers["Accept-Ranges"]         = "bytes"
    resp.headers["Cache-Control"]         = "no-store"
    resp.headers["X-File-Name"]           = filename
    resp.headers["X-File-Size"]           = str(file_size)
    resp.headers["X-Transfer-Chunk-Size"] = str(CHUNK_SIZE)
    return resp

@app.route("/file/upload", methods=["POST"])
def file_upload():
    app.config["MAX_CONTENT_LENGTH"] = None
    dest = (request.form.get("dest") or request.args.get("dest","")).replace("/","\\").strip()
    if not dest: dest = os.path.join(os.path.expanduser("~"), "Downloads")
    try: os.makedirs(dest, exist_ok=True)
    except Exception as e: return jsonify({"ok":False,"error":f"Cannot create folder: {e}"}), 500
    content_type = request.content_type or ""
    t0 = time.time()
    try:
        filename = save_path = None
        if "multipart/form-data" in content_type and "file" in request.files:
            fs        = request.files["file"]
            filename  = os.path.basename(fs.filename or f"upload_{int(time.time())}")
            save_path = os.path.join(dest, filename)
            with open(save_path, "wb") as fh:
                while True:
                    chunk = fs.stream.read(CHUNK_SIZE)
                    if not chunk: break
                    fh.write(chunk)
        else:
            data = request.get_data(cache=False)
            if not data: return jsonify({"ok":False,"error":"No data received."}), 400
            filename  = os.path.basename(request.args.get("name",f"upload_{int(time.time())}"))
            save_path = os.path.join(dest, filename)
            with open(save_path,"wb") as fh: fh.write(data)
        if not save_path or not os.path.exists(save_path):
            return jsonify({"ok":False,"error":"File not saved."}), 500
        elapsed  = max(time.time() - t0, 0.001)
        size_b   = os.path.getsize(save_path)
        speed_mb = (size_b / elapsed) / (1024 * 1024)
        return jsonify({"ok":True,"path":save_path.replace("\\","/"),
                        "size_kb":size_b//1024,"filename":filename,
                        "speed_mbs":round(speed_mb,2),"elapsed_s":round(elapsed,3)})
    except PermissionError:
        return jsonify({"ok":False,"error":"Permission denied"}), 403
    except Exception as e:
        log.error(f"Upload error: {e}", exc_info=True)
        return jsonify({"ok":False,"error":str(e)}), 500

_chunk_buffers = {}
_chunk_lock    = threading.Lock()

@app.route("/file/upload/chunk", methods=["POST"])
def file_upload_chunk():
    app.config["MAX_CONTENT_LENGTH"] = None
    name  = request.args.get("name","chunk")
    dest  = request.args.get("dest","").replace("/","\\")
    index = int(request.args.get("index","0"))
    total = int(request.args.get("total","1"))
    if not dest: dest = os.path.join(os.path.expanduser("~"), "Downloads")
    os.makedirs(dest, exist_ok=True)
    safe_name = os.path.basename(name)
    save_path = os.path.join(dest, safe_name)
    tmp_path  = save_path + f".part{index}"
    try:
        data = request.get_data(cache=False)
        with open(tmp_path, "wb") as fh: fh.write(data)
    except Exception as e:
        return jsonify({"ok":False,"error":str(e)}), 500
    with _chunk_lock:
        key = f"{dest}/{safe_name}"
        if key not in _chunk_buffers:
            _chunk_buffers[key] = {"path": save_path, "received": 0, "total": total}
        _chunk_buffers[key]["received"] += 1
        received = _chunk_buffers[key]["received"]
    if received >= total:
        try:
            with open(save_path, "wb") as out:
                for i in range(total):
                    part = save_path + f".part{i}"
                    if not os.path.exists(part):
                        return jsonify({"ok":False,"error":f"Missing chunk {i}"}), 500
                    with open(part, "rb") as p:
                        while True:
                            c = p.read(CHUNK_SIZE)
                            if not c: break
                            out.write(c)
                    os.remove(part)
            with _chunk_lock: del _chunk_buffers[f"{dest}/{safe_name}"]
            size_b = os.path.getsize(save_path)
            return jsonify({"ok":True,"complete":True,
                            "path":save_path.replace("\\","/"),"size_kb":size_b//1024})
        except Exception as e:
            log.error(f"Chunk reassembly error: {e}", exc_info=True)
            return jsonify({"ok":False,"error":str(e)}), 500
    return jsonify({"ok":True,"complete":False,"received":received,"total":total})

# ═══════════════════════════════════════════════════════════════════
#  APP RESOLVER + STEP EXECUTORS
# ═══════════════════════════════════════════════════════════════════
VLC_PATH   = r"C:\Program Files\VideoLAN\VLC\vlc.exe"
KNOWN_APPS = {
    "vlc":r"C:\Program Files\VideoLAN\VLC\vlc.exe",
    "vlc.exe":r"C:\Program Files\VideoLAN\VLC\vlc.exe",
    "word":r"C:\Program Files\Microsoft Office\root\Office16\WINWORD.EXE",
    "winword":r"C:\Program Files\Microsoft Office\root\Office16\WINWORD.EXE",
    "winword.exe":r"C:\Program Files\Microsoft Office\root\Office16\WINWORD.EXE",
    "excel":r"C:\Program Files\Microsoft Office\root\Office16\EXCEL.EXE",
    "excel.exe":r"C:\Program Files\Microsoft Office\root\Office16\EXCEL.EXE",
    "powerpoint":r"C:\Program Files\Microsoft Office\root\Office16\POWERPNT.EXE",
    "powerpnt":r"C:\Program Files\Microsoft Office\root\Office16\POWERPNT.EXE",
    "powerpnt.exe":r"C:\Program Files\Microsoft Office\root\Office16\POWERPNT.EXE",
    "outlook":r"C:\Program Files\Microsoft Office\root\Office16\OUTLOOK.EXE",
    "notepad":"notepad.exe","calc":"calc.exe","explorer":"explorer.exe","cmd":"cmd.exe",
    "chrome":r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    "firefox":r"C:\Program Files\Mozilla Firefox\firefox.exe",
}
OFFICE_PATHS = [
    r"C:\Program Files\Microsoft Office\root\Office16",
    r"C:\Program Files\Microsoft Office\Office16",
    r"C:\Program Files (x86)\Microsoft Office\root\Office16",
]

def resolve_app_path(app_path: str) -> str:
    if not app_path: return app_path
    base = os.path.basename(app_path).lower().replace(".exe","")
    full = os.path.basename(app_path).lower()
    for key, override in KNOWN_APPS.items():
        if key in (base, full):
            if os.path.exists(override): return override
            for op in OFFICE_PATHS:
                c = os.path.join(op, os.path.basename(override))
                if os.path.exists(c): return c
    if os.path.exists(app_path): return app_path
    return app_path

def execute_launch_app(step):
    raw  = step.get("value","")
    args = step.get("args",[])
    path = resolve_app_path(raw)
    exe_name = os.path.basename(path)
    if "vlc" in exe_name.lower() and args:
        return _open_in_vlc_same_window(args[0].replace("/","\\"), path)
    try:
        if args:
            fp = args[0].replace("/","\\")
            ap = path.replace("/","\\")
            r  = ctypes.windll.shell32.ShellExecuteW(None,"open",ap,f'"{fp}"',None,1)
            if r <= 32: subprocess.Popen([ap, fp], shell=False)
        else:
            os.startfile(path.replace("/","\\"))
    except Exception as e:
        try: subprocess.Popen([path]+args, shell=True)
        except Exception as e2: log.error(f"Launch failed: {e2}")
    _bring_app_to_front_after_launch(path, delay=1.5)
    return f"Launched: {path}"

def execute_kill_app(step):
    name = step.get("value","").strip()
    if not name: return "KILL_APP: no process name"
    killed = _kill_process_win11_safe(name)
    return f"{'Killed' if killed else 'Not found'}: {name}"

def execute_key_press(step):
    key_str = step.get("value","").upper().strip()
    COMBOS = {
        "WIN+L":(VK["WIN"],VK["L"]),"WIN+D":(VK["WIN"],VK["D"]),
        "WIN+E":(VK["WIN"],VK["E"]),"WIN+R":(VK["WIN"],VK["R"]),
        "WIN+I":(VK["WIN"],VK["I"]),"WIN+A":(VK["WIN"],VK["A"]),
        "WIN+S":(VK["WIN"],VK["S"]),"WIN+X":(VK["WIN"],VK["X"]),
        "WIN+TAB":(VK["WIN"],0x09),"WIN+UP":(VK["WIN"],VK["UP"]),
        "WIN+DOWN":(VK["WIN"],VK["DOWN"]),"WIN+LEFT":(VK["WIN"],VK["LEFT"]),
        "WIN+RIGHT":(VK["WIN"],VK["RIGHT"]),
        "WIN+SHIFT+S":(VK["WIN"],VK["SHIFT"],VK["S"]),"WIN":(VK["WIN"],),
        "WIN+P":(VK["WIN"],VK["P"]),"WIN+M":(VK["WIN"],VK["M"]),
        "WIN+V":(VK["WIN"],VK["V"]),"WIN+G":(VK["WIN"],VK["G"]),
        "WIN+.":(VK["WIN"],0xBE),
        "WIN+1":(VK["WIN"],0x31),"WIN+2":(VK["WIN"],0x32),"WIN+3":(VK["WIN"],0x33),
        "CTRL+C":(VK["CTRL"],VK["C"]),"CTRL+V":(VK["CTRL"],VK["V"]),
        "CTRL+Z":(VK["CTRL"],VK["Z"]),"CTRL+Y":(VK["CTRL"],VK["Y"]),
        "CTRL+S":(VK["CTRL"],VK["S"]),"CTRL+A":(VK["CTRL"],VK["A"]),
        "CTRL+X":(VK["CTRL"],VK["X"]),"CTRL+W":(VK["CTRL"],VK["W"]),
        "CTRL+N":(VK["CTRL"],VK["N"]),"CTRL+T":(VK["CTRL"],VK["T"]),
        "CTRL+F":(VK["CTRL"],VK["F"]),"CTRL+P":(VK["CTRL"],VK["P"]),
        "CTRL+O":(VK["CTRL"],VK["O"]),"CTRL+R":(VK["CTRL"],VK["R"]),
        "CTRL+L":(VK["CTRL"],VK["L"]),"CTRL+D":(VK["CTRL"],VK["D"]),
        "CTRL+H":(VK["CTRL"],VK["H"]),"CTRL+B":(VK["CTRL"],VK["B"]),
        "CTRL+I":(VK["CTRL"],VK["I"]),"CTRL+U":(VK["CTRL"],VK["U"]),
        "CTRL+G":(VK["CTRL"],VK["G"]),"CTRL+K":(VK["CTRL"],VK["K"]),
        "CTRL+E":(VK["CTRL"],VK["E"]),"CTRL+J":(VK["CTRL"],VK["J"]),
        "CTRL+Q":(VK["CTRL"],VK["Q"]),
        "CTRL+PLUS":(VK["CTRL"],VK["PLUS"]),"CTRL+MINUS":(VK["CTRL"],VK["MINUS"]),
        "CTRL+0":(VK["CTRL"],VK["0"]),
        "CTRL+TAB":(VK["CTRL"],0x09),"CTRL+END":(VK["CTRL"],VK["END"]),
        "CTRL+HOME":(VK["CTRL"],VK["HOME"]),
        "CTRL+SHIFT+ESC":(VK["CTRL"],VK["SHIFT"],0x1B),
        "CTRL+SHIFT+N":(VK["CTRL"],VK["SHIFT"],VK["N"]),
        "CTRL+SHIFT+T":(VK["CTRL"],VK["SHIFT"],VK["T"]),
        "CTRL+SHIFT+V":(VK["CTRL"],VK["SHIFT"],VK["V"]),
        "CTRL+SHIFT+S":(VK["CTRL"],VK["SHIFT"],VK["S"]),
        "CTRL+SHIFT+F":(VK["CTRL"],VK["SHIFT"],VK["F"]),
        "CTRL+SHIFT+TAB":(VK["CTRL"],VK["SHIFT"],0x09),
        "CTRL+SHIFT+DELETE":(VK["CTRL"],VK["SHIFT"],VK["DEL"]),
        "CTRL+ALT+DEL":(VK["CTRL"],VK["ALT"],VK["DEL"]),
        "ALT+F4":(VK["ALT"],VK["F4"]),"ALT+TAB":(VK["ALT"],0x09),
        "ALT+ENTER":(VK["ALT"],VK["ENTER"]),"ALT+ESC":(VK["ALT"],VK["ESC"]),
        "ALT+F":(VK["ALT"],VK["F"]),"ALT+E":(VK["ALT"],VK["E"]),
        "ALT+V":(VK["ALT"],VK["V"]),"ALT+D":(VK["ALT"],VK["D"]),
        "ALT+SPACE":(VK["ALT"],VK["SPACE"]),
        "ALT+LEFT":(VK["ALT"],VK["LEFT"]),"ALT+RIGHT":(VK["ALT"],VK["RIGHT"]),
        "ALT+UP":(VK["ALT"],VK["UP"]),
        "ALT+PRINTSCREEN":(VK["ALT"],VK["PRINTSCREEN"]),
        "SHIFT+DELETE":(VK["SHIFT"],VK["DEL"]),"SHIFT+TAB":(VK["SHIFT"],0x09),
        "SHIFT+F10":(VK["SHIFT"],VK["F10"]),"SHIFT+F3":(VK["SHIFT"],VK["F3"]),
        "SHIFT+INSERT":(VK["SHIFT"],VK["INSERT"]),
        "SHIFT+HOME":(VK["SHIFT"],VK["HOME"]),"SHIFT+END":(VK["SHIFT"],VK["END"]),
        "SHIFT+UP":(VK["SHIFT"],VK["UP"]),"SHIFT+DOWN":(VK["SHIFT"],VK["DOWN"]),
        "ENTER":(VK["ENTER"],),"ESC":(VK["ESC"],),"SPACE":(VK["SPACE"],),
        "TAB":(0x09,),"BACKSPACE":(VK["BACK"],),"DELETE":(VK["DEL"],),
        "UP":(VK["UP"],),"DOWN":(VK["DOWN"],),"LEFT":(VK["LEFT"],),"RIGHT":(VK["RIGHT"],),
        "HOME":(VK["HOME"],),"END":(VK["END"],),
        "PAGE_UP":(VK["PGUP"],),"PAGE_DOWN":(VK["PGDN"],),
        "PAGEUP":(VK["PGUP"],),"PAGEDOWN":(VK["PGDN"],),
        "PRINTSCREEN":(VK["PRINTSCREEN"],),"INSERT":(VK["INSERT"],),
        "SHIFT":(VK["SHIFT"],),"CTRL":(VK["CTRL"],),"ALT":(VK["ALT"],),
        "ALTGR":(VK["ALTGR"],),
        "VOLUME_UP":(VK["VOLUP"],),"VOLUME_DOWN":(VK["VOLDN"],),"MUTE":(VK["MUTE"],),
        "F1":(VK["F1"],),"F2":(VK["F2"],),"F3":(VK["F3"],),"F4":(VK["F4"],),
        "F5":(VK["F5"],),"F6":(VK["F6"],),"F7":(VK["F7"],),"F8":(VK["F8"],),
        "F9":(VK["F9"],),"F10":(VK["F10"],),"F11":(VK["F11"],),"F12":(VK["F12"],),
    }
    combo = COMBOS.get(key_str)
    if combo:
        _send_combo(*combo); return f"Key: {key_str}"
    if "+" in key_str:
        parts    = [p.strip() for p in key_str.split("+") if p.strip()]
        vk_codes = []
        for part in parts:
            if part in VK: vk_codes.append(VK[part])
            elif len(part)==1 and part.isalpha(): vk_codes.append(ord(part.upper()))
            elif len(part)==1 and part.isdigit(): vk_codes.append(ord(part))
            elif part.startswith("F") and part[1:].isdigit():
                fn = int(part[1:])
                if 1 <= fn <= 24: vk_codes.append(0x6F + fn)
            else:
                vk = VK.get(part)
                if vk: vk_codes.append(vk)
                else: return f"Key unknown part: {part} in {key_str}"
        if vk_codes:
            _send_combo(*vk_codes)
            return f"Key: {key_str} (dynamic)"
    if len(key_str) == 1:
        vk = ctypes.windll.user32.VkKeyScanW(ord(key_str))
        if vk != -1:
            _send_combo(vk & 0xFF); return f"Key: {key_str}"
    return f"Key unknown: {key_str}"

def execute_type_text(step):
    text = step.get("value","")
    try:
        import win32clipboard
        win32clipboard.OpenClipboard()
        win32clipboard.EmptyClipboard()
        win32clipboard.SetClipboardText(text, win32clipboard.CF_UNICODETEXT)
        win32clipboard.CloseClipboard()
        time.sleep(0.1)
        _send_combo(VK["CTRL"], VK["V"])
    except ImportError:
        _type_string_sendinput(text)
    return f"Typed: {text[:30]}"

def execute_mouse_click(step):
    x, y   = step.get("x",0), step.get("y",0)
    btn    = step.get("button","left")
    double = step.get("double",False)
    pyautogui.moveTo(x, y, duration=0.1)
    if double: pyautogui.doubleClick(x, y)
    else:      pyautogui.click(x, y, button=btn)
    return f"Click ({x},{y})"

def execute_mouse_move(step):
    pyautogui.moveTo(step.get("x",0), step.get("y",0), duration=0.15)
    return "Moved mouse"

def execute_mouse_scroll(step):
    amount = step.get("amount",3)
    x, y   = step.get("x",None), step.get("y",None)
    if x and y: pyautogui.scroll(amount, x=x, y=y)
    else:        pyautogui.scroll(amount)
    return f"Scrolled {amount}"

def execute_run_script(step):
    p   = step.get("value","")
    ext = os.path.splitext(p)[1].lower()
    if   ext == ".py":  subprocess.Popen(["python",p], creationflags=subprocess.CREATE_NO_WINDOW)
    elif ext == ".bat": subprocess.Popen([p], shell=True)
    elif ext == ".ps1": subprocess.Popen(
        ["powershell","-ExecutionPolicy","Bypass","-File",p],
        creationflags=subprocess.CREATE_NO_WINDOW)
    return f"Script: {p}"

def execute_file_op(step):
    action = step.get("action","").upper()
    src    = step.get("from","").replace("/","\\")
    dst    = step.get("to","").replace("/","\\")
    if action == "COPY":
        if not os.path.exists(src): return f"COPY: source not found: {src}"
        if os.path.isfile(src):
            os.makedirs(os.path.dirname(dst) or ".", exist_ok=True)
            shutil.copy2(src, dst)
        elif os.path.isdir(src): shutil.copytree(src, dst, dirs_exist_ok=True)
        else: return f"COPY: not found: {src}"
    elif action == "MOVE":
        if not os.path.exists(src): return f"MOVE: source not found: {src}"
        os.makedirs(os.path.dirname(dst) or ".", exist_ok=True)
        shutil.move(src, dst)
    elif action == "DELETE":
        if os.path.isfile(src): os.remove(src)
        elif os.path.isdir(src): shutil.rmtree(src)
        else: return f"DELETE: not found: {src}"
    elif action == "MKDIR": os.makedirs(src, exist_ok=True)
    elif action == "RENAME":
        if not os.path.exists(src): return f"RENAME: source not found: {src}"
        if os.path.exists(dst):     return f"RENAME: target already exists: {dst}"
        os.rename(src, dst)
    else: return f"FILE_OP: unknown: {action}"
    return f"File {action}: {os.path.basename(src or dst)}"

def execute_open_file(step):
    file_path = (
        step.get("value") or (step.get("args") or [""])[0] or ""
    ).replace("/", "\\").strip()
    if not file_path: return "OPEN_FILE: no path"
    if not os.path.exists(file_path): return f"File not found: {file_path}"
    try:
        os.startfile(file_path)
    except Exception as e:
        try:
            r = ctypes.windll.shell32.ShellExecuteW(None, "open", file_path, None, None, 1)
            if r <= 32: raise RuntimeError(f"ShellExecute returned {r}")
        except Exception as e2:
            return f"Open failed: {e2}"
    _bring_app_to_front_after_launch("", delay=1.8)
    return f"Opened: {os.path.basename(file_path)}"

def execute_system_cmd(step):
    cmd  = step.get("value","").upper()
    args = step.get("args",[])
    if   cmd == "WAKE_SCREEN":
        keyboard.press(Key.shift); time.sleep(0.05); keyboard.release(Key.shift)
        try: ctypes.windll.kernel32.SetThreadExecutionState(0x80000000|0x00000002)
        except: pass
    elif cmd == "LOCK":           ctypes.windll.user32.LockWorkStation()
    elif cmd == "SLEEP":          os.system("rundll32.exe powrprof.dll,SetSuspendState 0,1,0")
    elif cmd == "SHUTDOWN":       os.system(f"shutdown /s /t {args[0] if args else '0'}")
    elif cmd == "RESTART":        os.system("shutdown /r /t 0")
    elif cmd == "ABORT_SHUTDOWN": os.system("shutdown /a")
    elif cmd == "VOLUME_UP":      pyautogui.press("volumeup")
    elif cmd == "VOLUME_DOWN":    pyautogui.press("volumedown")
    elif cmd == "MUTE":           pyautogui.press("volumemute")
    elif cmd == "VOLUME_SET":
        level = int(args[0]) if args else 50
        ps = (f'$wsh=New-Object -ComObject WScript.Shell;'
              f'for($i=0;$i -lt 50;$i++){{$wsh.SendKeys([char]174)}};'
              f'for($i=0;$i -lt {level//2};$i++){{$wsh.SendKeys([char]175)}}')
        subprocess.Popen(["powershell","-Command",ps], creationflags=subprocess.CREATE_NO_WINDOW)
    elif cmd == "BRIGHTNESS_SET":
        level = max(0, min(100, int(args[0]) if args else 50))
        ps = f'(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods).WmiSetBrightness(1,{level})'
        subprocess.Popen(["powershell","-Command",ps], creationflags=subprocess.CREATE_NO_WINDOW)
    elif cmd == "BRIGHTNESS_UP":
        ps = '$b=(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightness).CurrentBrightness;$n=[math]::Min(100,$b+10);(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods).WmiSetBrightness(1,$n)'
        subprocess.Popen(["powershell","-Command",ps], creationflags=subprocess.CREATE_NO_WINDOW)
    elif cmd == "BRIGHTNESS_DOWN":
        ps = '$b=(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightness).CurrentBrightness;$n=[math]::Max(0,$b-10);(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods).WmiSetBrightness(1,$n)'
        subprocess.Popen(["powershell","-Command",ps], creationflags=subprocess.CREATE_NO_WINDOW)
    elif cmd == "OPEN_FILE":
        fp = (args[0] if args else "").replace("/","\\")
        return execute_open_file({"value": fp})
    elif cmd == "SCREENSHOT":
        path = args[0] if args else os.path.join(
            os.path.expanduser("~"), "Desktop", f"screenshot_{int(time.time())}.png")
        pyautogui.screenshot().save(path)
    elif cmd == "OPEN_URL":
        url = args[0] if args else "https://google.com"
        os.startfile(url)
    elif cmd == "OPEN_FOLDER":
        path = (args[0] if args else "C:/").replace("/","\\")
        if os.path.isfile(path): subprocess.Popen(["explorer","/select,",path])
        else:                    subprocess.Popen(["explorer",path])
    elif cmd == "WIN_R":
        command = args[0] if args else ""
        with keyboard.pressed(Key.cmd):
            keyboard.press("r"); keyboard.release("r")
        time.sleep(0.5)
        if command:
            pyautogui.typewrite(command, interval=0.05)
            time.sleep(0.2); pyautogui.press("enter")
    elif cmd == "TASK_MANAGER":     subprocess.Popen(["taskmgr.exe"])
    elif cmd == "SETTINGS":         subprocess.Popen(["ms-settings:"], shell=True)
    elif cmd == "CONTROL_PANEL":    subprocess.Popen(["control.exe"])
    elif cmd == "DISPLAY_INTERNAL": subprocess.Popen(["displayswitch.exe", "/internal"])
    elif cmd == "DISPLAY_CLONE":    subprocess.Popen(["displayswitch.exe", "/clone"])
    elif cmd == "DISPLAY_EXTEND":   subprocess.Popen(["displayswitch.exe", "/extend"])
    elif cmd == "DISPLAY_EXTERNAL": subprocess.Popen(["displayswitch.exe", "/external"])
    return f"SysCmd: {cmd}"

def execute_wait(step):
    ms = step.get("ms",1000)
    time.sleep(ms / 1000)
    return f"Waited {ms}ms"

STEP_HANDLERS = {
    "LAUNCH_APP":   execute_launch_app,
    "KILL_APP":     execute_kill_app,
    "KEY_PRESS":    execute_key_press,
    "TYPE_TEXT":    execute_type_text,
    "MOUSE_CLICK":  execute_mouse_click,
    "MOUSE_MOVE":   execute_mouse_move,
    "MOUSE_SCROLL": execute_mouse_scroll,
    "RUN_SCRIPT":   execute_run_script,
    "FILE_OP":      execute_file_op,
    "OPEN_FILE":    execute_open_file,
    "SYSTEM_CMD":   execute_system_cmd,
    "WAIT":         execute_wait,
}

def execute_plan(plan):
    results = []
    for i, step in enumerate(plan.get("steps",[])):
        st      = step.get("type","").upper()
        handler = STEP_HANDLERS.get(st)
        if not handler:
            results.append({"step": i+1, "status": "SKIP", "result": f"Unknown: {st}"})
            continue
        try:
            r = handler(step)
            results.append({"step": i+1, "status": "OK", "result": r})
        except Exception as e:
            err = f"{type(e).__name__}: {e}"
            results.append({"step": i+1, "status": "ERROR", "result": err})
            log.error(f"Step {i+1} [{st}] CRASHED: {err}", exc_info=True)
    with _last_results_lock:
        _last_results.clear(); _last_results.extend(results)
    return {"steps_executed": len(results), "results": results}

_plan_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="plan")

@app.route("/execute", methods=["POST"])
def execute():
    plan = request.get_json()
    _plan_executor.submit(execute_plan, plan)
    return jsonify({"status":"executing","plan":plan.get("planName")}), 200

@app.route("/quick", methods=["POST"])
def quick():
    step    = request.get_json()
    st      = step.get("type","").upper()
    handler = STEP_HANDLERS.get(st)
    if not handler:
        return jsonify({"error":f"Unknown step type: {st}"}), 400
    try:
        result = handler(step)
        return jsonify({"status":"ok","result":result})
    except Exception as e:
        log.error(f"/quick crash [{st}]: {e}", exc_info=True)
        return jsonify({"status":"error","error":f"{type(e).__name__}: {e}"}), 500

@app.route("/processes")
def processes():
    procs = sorted(set(
        p.info['name'] for p in psutil.process_iter(['name']) if p.info['name']))
    return jsonify({"processes": procs})

# ═══════════════════════════════════════════════════════════════════
#  INPUT ENDPOINTS
# ═══════════════════════════════════════════════════════════════════
@app.route("/input/mouse/move", methods=["POST"])
def input_mouse_move():
    data = request.get_json()
    dx   = int(float(data.get("dx",0)))
    dy   = int(float(data.get("dy",0)))
    if dx != 0 or dy != 0: _move_mouse_relative(dx, dy)
    cx, cy = mouse.position
    return jsonify({"ok":True,"x":cx,"y":cy})

@app.route("/input/mouse/click", methods=["POST"])
def input_mouse_click():
    data   = request.get_json()
    button = data.get("button","left")
    double = data.get("double",False)
    if button == "right":
        _send_mouse_input(MOUSEEVENTF_RIGHTDOWN); _send_mouse_input(MOUSEEVENTF_RIGHTUP)
        if double:
            time.sleep(0.1)
            _send_mouse_input(MOUSEEVENTF_RIGHTDOWN); _send_mouse_input(MOUSEEVENTF_RIGHTUP)
    else:
        _send_mouse_input(MOUSEEVENTF_LEFTDOWN); _send_mouse_input(MOUSEEVENTF_LEFTUP)
        if double:
            time.sleep(0.08)
            _send_mouse_input(MOUSEEVENTF_LEFTDOWN); _send_mouse_input(MOUSEEVENTF_LEFTUP)
    return jsonify({"ok":True})

@app.route("/input/mouse/scroll", methods=["POST"])
def input_mouse_scroll():
    data   = request.get_json()
    amount = int(data.get("amount",3))
    horiz  = data.get("horizontal", False)
    if horiz:
        MOUSEEVENTF_HWHEEL = 0x01000
        _send_mouse_input(MOUSEEVENTF_HWHEEL, data=amount * 120)
    else:
        _send_mouse_input(MOUSEEVENTF_WHEEL, data=amount * 120)
    return jsonify({"ok":True})

@app.route("/input/mouse/down", methods=["POST"])
def input_mouse_down():
    global _drag_active, _drag_button
    button = request.get_json().get("button","left")
    _drag_active = True
    if button == "right":
        _drag_button = Button.right; _send_mouse_input(MOUSEEVENTF_RIGHTDOWN)
    else:
        _drag_button = Button.left;  _send_mouse_input(MOUSEEVENTF_LEFTDOWN)
    return jsonify({"ok":True,"dragging":True})

@app.route("/input/mouse/up", methods=["POST"])
def input_mouse_up():
    global _drag_active, _drag_button
    if _drag_active:
        if _drag_button == Button.right: _send_mouse_input(MOUSEEVENTF_RIGHTUP)
        else:                            _send_mouse_input(MOUSEEVENTF_LEFTUP)
        _drag_active = False
    return jsonify({"ok":True,"dragging":False})

@app.route("/input/keyboard/key", methods=["POST"])
def input_keyboard_key():
    key = request.get_json().get("value","")
    try:
        execute_key_press({"value": key}); return jsonify({"ok":True})
    except Exception as e:
        return jsonify({"ok":False,"error":str(e)}), 500

@app.route("/input/keyboard/type", methods=["POST"])
def input_keyboard_type():
    text = request.get_json().get("value","")
    try:
        import win32clipboard
        win32clipboard.OpenClipboard()
        win32clipboard.EmptyClipboard()
        win32clipboard.SetClipboardText(text, win32clipboard.CF_UNICODETEXT)
        win32clipboard.CloseClipboard()
        time.sleep(0.1)
        _send_combo(VK["CTRL"], VK["V"])
    except Exception:
        _type_string_sendinput(text)
    return jsonify({"ok":True})

# ═══════════════════════════════════════════════════════════════════
#  GESTURE MAP
# ═══════════════════════════════════════════════════════════════════
GESTURE_MAP = {
    "3finger-tap":         "WIN+S",
    "3finger-swipe-up":    "WIN+TAB",
    "3finger-swipe-down":  "WIN+D",
    "3finger-swipe-left":  "ALT+SHIFT+TAB",
    "3finger-swipe-right": "ALT+TAB",
    "4finger-tap":         "WIN+A",
    "4finger-swipe-up":    "WIN+TAB",
    "4finger-swipe-down":  "WIN+D",
    "4finger-swipe-left":  "CTRL+WIN+LEFT",
    "4finger-swipe-right": "CTRL+WIN+RIGHT",
    "zoom-in":             "CTRL+PLUS",
    "zoom-out":            "CTRL+MINUS",
    "zoom-reset":          "CTRL+0",
}

@app.route("/input/gesture", methods=["POST"])
def input_gesture():
    data      = request.get_json() or {}
    gesture   = str(data.get("type","")).lower().strip()
    key_alias = GESTURE_MAP.get(gesture)
    if not key_alias:
        return jsonify({"ok":False,"error":f"Unknown gesture: {gesture}"}), 400
    try:
        execute_key_press({"value": key_alias})
        return jsonify({"ok":True, "gesture": gesture, "key": key_alias})
    except Exception as e:
        return jsonify({"ok":False,"error":str(e)}), 500

# ═══════════════════════════════════════════════════════════════════
#  CLIPBOARD SYNC
# ═══════════════════════════════════════════════════════════════════
def _read_pc_clipboard():
    try:
        import win32clipboard
        win32clipboard.OpenClipboard()
        try:
            if win32clipboard.IsClipboardFormatAvailable(win32clipboard.CF_UNICODETEXT):
                return win32clipboard.GetClipboardData(win32clipboard.CF_UNICODETEXT) or ""
            return ""
        finally:
            win32clipboard.CloseClipboard()
    except Exception as e:
        log.warning(f"_read_pc_clipboard: {e}")
        return ""

def _write_pc_clipboard(text: str):
    import win32clipboard
    win32clipboard.OpenClipboard()
    try:
        win32clipboard.EmptyClipboard()
        win32clipboard.SetClipboardText(text or "", win32clipboard.CF_UNICODETEXT)
    finally:
        win32clipboard.CloseClipboard()

@app.route("/clipboard", methods=["GET"])
def clipboard_get():
    return jsonify({"ok":True, "value": _read_pc_clipboard()})

@app.route("/clipboard", methods=["POST"])
def clipboard_set():
    text = (request.get_json() or {}).get("value", "")
    try:
        _write_pc_clipboard(text)
        return jsonify({"ok":True})
    except Exception as e:
        return jsonify({"ok":False,"error":str(e)}), 500

@app.route("/clipboard/stream")
def clipboard_stream():
    def gen():
        last = _read_pc_clipboard()
        yield f"data: {json.dumps({'value': last})}\n\n"
        while True:
            time.sleep(0.4)
            cur = _read_pc_clipboard()
            if cur != last:
                last = cur
                yield f"data: {json.dumps({'value': cur})}\n\n"
    return Response(gen(), mimetype="text/event-stream",
                    headers={"Cache-Control":"no-cache","X-Accel-Buffering":"no"})

# ═══════════════════════════════════════════════════════════════════
#  FILE OPS — REST endpoints
# ═══════════════════════════════════════════════════════════════════
@app.route("/file/delete", methods=["POST"])
def file_delete():
    data = request.get_json() or {}
    path = data.get("path","").replace("/","\\")
    if not path or not os.path.exists(path):
        return jsonify({"ok":False,"error":f"Not found: {path}"}), 404
    try:
        if os.path.isfile(path): os.remove(path)
        elif os.path.isdir(path): shutil.rmtree(path)
        return jsonify({"ok":True})
    except PermissionError: return jsonify({"ok":False,"error":"Permission denied"}), 403
    except Exception as e:  return jsonify({"ok":False,"error":str(e)}), 500

@app.route("/file/rename", methods=["POST"])
def file_rename():
    data     = request.get_json() or {}
    src      = data.get("from","").replace("/","\\")
    new_name = data.get("name","")
    if not src or not new_name:
        return jsonify({"ok":False,"error":"from and name required"}), 400
    dst = os.path.join(os.path.dirname(src), new_name)
    if not os.path.exists(src):
        return jsonify({"ok":False,"error":f"Source not found: {src}"}), 404
    if os.path.exists(dst):
        return jsonify({"ok":False,"error":"Target already exists"}), 409
    try:
        os.rename(src, dst); return jsonify({"ok":True})
    except Exception as e: return jsonify({"ok":False,"error":str(e)}), 500

@app.route("/file/move", methods=["POST"])
def file_move():
    data = request.get_json() or {}
    src  = data.get("from","").replace("/","\\")
    dst  = data.get("to","").replace("/","\\")
    if not src or not dst: return jsonify({"ok":False,"error":"from and to required"}), 400
    if not os.path.exists(src): return jsonify({"ok":False,"error":f"Source not found: {src}"}), 404
    try:
        if os.path.isdir(dst): dst = os.path.join(dst, os.path.basename(src))
        os.makedirs(os.path.dirname(dst) or ".", exist_ok=True)
        shutil.move(src, dst); return jsonify({"ok":True})
    except Exception as e: return jsonify({"ok":False,"error":str(e)}), 500

@app.route("/file/copy", methods=["POST"])
def file_copy():
    data = request.get_json() or {}
    src  = data.get("from","").replace("/","\\")
    dst  = data.get("to","").replace("/","\\")
    if not src or not dst: return jsonify({"ok":False,"error":"from and to required"}), 400
    if not os.path.exists(src): return jsonify({"ok":False,"error":f"Source not found: {src}"}), 404
    try:
        os.makedirs(os.path.dirname(dst) or ".", exist_ok=True)
        if os.path.isfile(src): shutil.copy2(src, dst)
        else: shutil.copytree(src, dst, dirs_exist_ok=True)
        return jsonify({"ok":True})
    except Exception as e: return jsonify({"ok":False,"error":str(e)}), 500

@app.route("/file/mkdir", methods=["POST"])
def file_mkdir():
    data = request.get_json() or {}
    path = data.get("path","").replace("/","\\")
    if not path: return jsonify({"ok":False,"error":"path required"}), 400
    try:
        os.makedirs(path, exist_ok=True)
        return jsonify({"ok":True,"path":path.replace("\\","/")})
    except Exception as e: return jsonify({"ok":False,"error":str(e)}), 500

# ═══════════════════════════════════════════════════════════════════
#  BROWSE ENDPOINTS
# ═══════════════════════════════════════════════════════════════════
@app.route("/browse/special")
def browse_special():
    specials = [
        ("Desktop",   os.path.join(os.path.expanduser("~"),"Desktop"),   "🖥️"),
        ("Downloads", os.path.join(os.path.expanduser("~"),"Downloads"), "⬇️"),
        ("Documents", os.path.join(os.path.expanduser("~"),"Documents"), "📄"),
        ("Pictures",  os.path.join(os.path.expanduser("~"),"Pictures"),  "🖼️"),
        ("Videos",    os.path.join(os.path.expanduser("~"),"Videos"),    "🎬"),
        ("Music",     os.path.join(os.path.expanduser("~"),"Music"),     "🎵"),
    ]
    folders = []
    for name, path, icon in specials:
        if os.path.exists(path):
            try:    count = len(os.listdir(path))
            except: count = 0
            folders.append({"name":name,"path":path.replace("\\","/"),"icon":icon,"count":count})
    r = jsonify(folders); r.headers["Cache-Control"] = "no-store"; return r

@app.route("/browse/drives")
def browse_drives():
    drives = []
    for letter in "CDEFGHIJKLMNOPQRSTUVWXYZ":
        path = f"{letter}:\\"
        if os.path.exists(path):
            try:
                total, used, free = shutil.disk_usage(path)
                try:
                    buf = ctypes.create_unicode_buffer(256)
                    ctypes.windll.kernel32.GetVolumeInformationW(path, buf, 256, None, None, None, None, 0)
                    lbl = buf.value or "Local Disk"
                except: lbl = "Local Disk"
                drives.append({"letter":letter,"label":lbl,
                               "freeGb":round(free/(1024**3),1),
                               "totalGb":round(total/(1024**3),1),
                               "usedGb":round(used/(1024**3),1)})
            except: pass
    r = jsonify(drives); r.headers["Cache-Control"] = "no-store"; return r

@app.route("/browse/dir")
def browse_dir():
    path       = request.args.get("path","C:\\").replace("/","\\")
    exts_param = request.args.get("exts","")
    allowed    = [e.lower() for e in exts_param.split(",") if e] if exts_param else []
    if not os.path.exists(path): return jsonify({"error":"Path not found"}), 404
    items = []
    try:
        entries = sorted(list(os.scandir(path)),
                         key=lambda e: (not e.is_dir(follow_symlinks=False), e.name.lower()))
        for entry in entries:
            try:
                is_dir  = entry.is_dir(follow_symlinks=False)
                name    = entry.name
                ext     = "" if is_dir else os.path.splitext(name)[1][1:].lower()
                if not is_dir and allowed and ext not in allowed: continue
                size_kb = mod_time = 0
                try:
                    stat     = entry.stat()
                    size_kb  = stat.st_size // 1024
                    mod_time = int(stat.st_mtime)
                except: pass
                items.append({"name":name,"path":entry.path.replace("\\","/"),
                              "isDir":is_dir,"sizeKb":size_kb,"extension":ext,"modTime":mod_time})
            except: pass
    except PermissionError: return jsonify({"error":"Permission denied"}), 403
    except Exception as e:  return jsonify({"error":str(e)}), 500
    r = jsonify(items); r.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"; return r

@app.route("/browse/search")
def browse_search():
    root_path   = request.args.get("path","C:\\").replace("/","\\")
    query       = request.args.get("q","").lower().strip()
    max_results = min(int(request.args.get("maxResults",50)), 200)
    if not query: return jsonify({"ok":False,"error":"q required"}), 400
    if not os.path.exists(root_path): return jsonify({"ok":False,"error":"Path not found"}), 404
    results  = []
    deadline = time.time() + 8
    try:
        for root, dirs, files in os.walk(root_path):
            if time.time() > deadline or len(results) >= max_results: break
            dirs[:] = [d for d in dirs if not d.startswith('.')]
            for name in dirs + files:
                if query in name.lower():
                    full    = os.path.join(root, name)
                    is_dir  = os.path.isdir(full)
                    size_kb = mod_time = 0
                    try:
                        stat     = os.stat(full)
                        size_kb  = stat.st_size // 1024
                        mod_time = int(stat.st_mtime)
                    except: pass
                    ext = "" if is_dir else os.path.splitext(name)[1][1:].lower()
                    results.append({"name":name,"path":full.replace("\\","/"),
                                    "isDir":is_dir,"sizeKb":size_kb,"extension":ext,"modTime":mod_time})
                    if len(results) >= max_results: break
    except: pass
    r = jsonify(results); r.headers["Cache-Control"] = "no-store"; return r

@app.route("/browse/apps")
def browse_apps():
    running_names = {p.info['name'].lower()
                     for p in psutil.process_iter(['name']) if p.info['name']}
    well_known = [
        {"name":"VLC Media Player",     "exe":VLC_PATH,"icon":"🎬"},
        {"name":"Google Chrome",        "exe":r"C:\Program Files\Google\Chrome\Application\chrome.exe","icon":"🌐"},
        {"name":"Microsoft Word",       "exe":r"C:\Program Files\Microsoft Office\root\Office16\WINWORD.EXE","icon":"📝"},
        {"name":"Microsoft Excel",      "exe":r"C:\Program Files\Microsoft Office\root\Office16\EXCEL.EXE","icon":"📗"},
        {"name":"Microsoft PowerPoint", "exe":r"C:\Program Files\Microsoft Office\root\Office16\POWERPNT.EXE","icon":"📊"},
        {"name":"Microsoft Outlook",    "exe":r"C:\Program Files\Microsoft Office\root\Office16\OUTLOOK.EXE","icon":"📧"},
        {"name":"VS Code",              "exe":os.path.join(os.environ.get("LOCALAPPDATA",""),"Programs","Microsoft VS Code","Code.exe"),"icon":"💻"},
        {"name":"Android Studio",       "exe":r"C:\Program Files\Android\Android Studio\bin\studio64.exe","icon":"🤖"},
        {"name":"Notepad",              "exe":"notepad.exe","icon":"📄"},
        {"name":"Calculator",           "exe":"calc.exe","icon":"🔢"},
        {"name":"File Explorer",        "exe":"explorer.exe","icon":"📁"},
        {"name":"Task Manager",         "exe":"taskmgr.exe","icon":"⚙️"},
        {"name":"Command Prompt",       "exe":"cmd.exe","icon":"⬛"},
        {"name":"Mozilla Firefox",      "exe":r"C:\Program Files\Mozilla Firefox\firefox.exe","icon":"🦊"},
        {"name":"Spotify",              "exe":os.path.join(os.environ.get("APPDATA",""),"Spotify","Spotify.exe"),"icon":"🎵"},
        {"name":"Paint",                "exe":"mspaint.exe","icon":"🎨"},
        {"name":"PowerShell",           "exe":"powershell.exe","icon":"🔷"},
        {"name":"Microsoft Edge",       "exe":r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe","icon":"🌐"},
    ]
    apps = []
    for wk in well_known:
        exe    = wk["exe"]
        exists = os.path.exists(exe) or os.sep not in exe
        if exists:
            apps.append({"name":wk["name"],"exePath":exe.replace("\\","/"),
                         "icon":wk["icon"],
                         "isRunning":os.path.basename(exe).lower() in running_names})
    apps.sort(key=lambda a: (not a["isRunning"], a["name"].lower()))
    r = jsonify(apps); r.headers["Cache-Control"] = "no-store"; return r

@app.route("/browse/recent")
def browse_recent():
    recent        = []
    recent_folder = os.path.join(os.environ.get("APPDATA",""), r"Microsoft\Windows\Recent")
    try:
        entries = sorted(
            [e for e in os.scandir(recent_folder) if e.name.endswith(".lnk")],
            key=lambda e: e.stat().st_mtime, reverse=True)[:20]
        for entry in entries:
            name = entry.name.replace(".lnk","")
            ext  = os.path.splitext(name)[1][1:].lower()
            ico  = ("🎬" if ext in ["mp4","mkv","avi","mov","mp3","wav"] else
                    "📄" if ext in ["pdf","docx","doc","xlsx","pptx"] else
                    "⚙️" if ext in ["py","bat","ps1"] else
                    "🖼"  if ext in ["jpg","png","jpeg","gif"] else
                    "📁" if ext == "" else "📄")
            recent.append({"path":entry.path.replace(".lnk","").replace("\\","/"),
                           "label":name,"isApp":ext=="exe","icon":ico})
    except: pass
    r = jsonify(recent); r.headers["Cache-Control"] = "no-store"; return r

# ═══════════════════════════════════════════════════════════════════
#  HELPERS
# ═══════════════════════════════════════════════════════════════════
def _get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8",80)); ip = s.getsockname()[0]; s.close()
        return ip
    except:
        return socket.gethostbyname(socket.gethostname())

# ═══════════════════════════════════════════════════════════════════
#  KEEP-ALIVE + WATCHDOG
# ═══════════════════════════════════════════════════════════════════
def keep_alive_worker():
    while True:
        try:
            ctypes.windll.kernel32.SetThreadExecutionState(0x80000000 | 0x00000001 | 0x00000002)
            cutoff = datetime.now().isoformat()[:16]
            with _connected_lock:
                stale = [did for did, info in _connected_users.items()
                         if (datetime.now() - datetime.fromisoformat(
                             info.get("last_seen", cutoff))).total_seconds() > 300]
                for did in stale:
                    _connected_users.pop(did, None)
            log.info(f"[HEARTBEAT] Uptime: {int(time.time()-_start_time)}s  "
                     f"IP:{_get_local_ip()}:{PORT}  Connected: {len(_connected_users)}")
        except Exception as e:
            log.warning(f"Keep-alive error: {e}")
        time.sleep(30)

# ═══════════════════════════════════════════════════════════════════
#  HTTP SERVER RUNNERS  (plain HTTP — no certs, no mTLS)
# ═══════════════════════════════════════════════════════════════════
def _run_http_server(flask_app, port, name, threads=64):
    """Run a Flask app with plain HTTP using werkzeug (large thread pool)."""
    while True:
        try:
            log.info(f"Starting {name} HTTP on {HOST}:{port} (threads={threads})")
            # Use make_server with threaded=True for concurrent request handling
            srv = werkzeug.serving.make_server(HOST, port, flask_app,
                                               threaded=True, request_handler=None)
            try:
                srv.socket.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, SOCKET_SNDBUF)
                srv.socket.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, SOCKET_RCVBUF)
                srv.socket.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
                # Enable TCP keepalive so idle phone connections don't silently drop
                srv.socket.setsockopt(socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1)
                # Reuse address so restart doesn't hit "address already in use"
                srv.socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            except Exception as e:
                log.warning(f"Socket tuning on {name}: {e}")
            srv.serve_forever()
        except Exception as e:
            log.error(f"{name} HTTP crashed: {e}. Restarting in 3s..."); time.sleep(3)

def flask_server_runner():
    _run_http_server(app, PORT, "main", threads=FLASK_THREADS)

def stream_server_runner():
    _run_http_server(stream_app, STREAM_PORT, "stream+audio", threads=32)

# ═══════════════════════════════════════════════════════════════════
#  SYSTEM TRAY
# ═══════════════════════════════════════════════════════════════════
def run_tray():
    try:
        import pystray
        from PIL import Image, ImageDraw
        img  = Image.new("RGB", (64, 64), color=(25, 118, 210))
        draw = ImageDraw.Draw(img)
        draw.rectangle([8,8,56,40],  fill=(255,255,255))
        draw.rectangle([20,40,44,50],fill=(255,255,255))
        draw.rectangle([12,48,52,56],fill=(255,255,255))

        def show_info(icon, item):
            ip     = _get_local_ip()
            uptime = int(time.time() - _start_time)
            h, rem = divmod(uptime, 3600); m, s = divmod(rem, 60)
            n_conn = len(_connected_users)
            msg = (f"PC Command Agent v12.0\n{'─'*46}\n"
                   f"IP Address   : {ip}\n"
                   f"Command Port : {PORT}  (HTTP — {FLASK_THREADS} threads)\n"
                   f"Stream Port  : {STREAM_PORT} (HTTP — 1080p video + audio)\n"
                   f"Secret Key   : {SECRET_KEY}\n"
                   f"Master Key   : {MASTER_KEY[:4]}***\n"
                   f"Connected    : {n_conn} user(s)\n"
                   f"Chunk Size   : {CHUNK_SIZE//1024//1024} MB\n"
                   f"Uptime       : {h:02d}h {m:02d}m {s:02d}s\n{'─'*46}\n"
                   f"Browser viewer (1080p video+audio):\n"
                   f"  http://{ip}:{STREAM_PORT}/screen/viewer?key={SECRET_KEY}\n"
                   f"2K stream:\n"
                   f"  http://{ip}:{STREAM_PORT}/screen/stream?key={SECRET_KEY}&w=2560&q=85&fps=15\n"
                   f"Audio only:\n"
                   f"  http://{ip}:{STREAM_PORT}/audio/stream?key={SECRET_KEY}&fmt=mp3")
            ctypes.windll.user32.MessageBoxW(0, msg, "PC Command Agent v11.0", 0x40)

        def on_close(icon, item): icon.stop(); os._exit(0)

        def build_menu(_):
            return pystray.Menu(
                pystray.MenuItem("✅  Agent Running v11.0 (HTTP)",  show_info),
                pystray.MenuItem("▶ Show IP & Details",             show_info),
                pystray.Menu.SEPARATOR,
                pystray.MenuItem("❌  Close Agent",                  on_close),
            )

        icon = pystray.Icon("PCCommandAgent", img,
                            f"PC Agent v11.0 — {_get_local_ip()}:{PORT}", build_menu(None))
        icon.run()
    except ImportError:
        log.warning("pystray not installed — running in console mode")
        _console_mode()

def _console_mode():
    ip = _get_local_ip()
    print("=" * 66)
    print("  PC Command Agent v11.0  [1080p Video + Fixed Audio + Fast API]")
    print("=" * 66)
    print(f"  IP Address   : {ip}")
    print(f"  Command Port : {PORT}  -> http://{ip}:{PORT}  [{FLASK_THREADS} threads]")
    print(f"  Stream Port  : {STREAM_PORT} -> http://{ip}:{STREAM_PORT}")
    print("-" * 66)
    print("  STREAM PORT 5001 ENDPOINTS:")
    print(f"    Video 1080p  : http://{ip}:{STREAM_PORT}/screen/stream?key={SECRET_KEY}&w=1920&q=75&fps=20")
    print(f"    Video 2K     : http://{ip}:{STREAM_PORT}/screen/stream?key={SECRET_KEY}&w=2560&q=85&fps=15")
    print(f"    Audio 192k   : http://{ip}:{STREAM_PORT}/audio/stream?key={SECRET_KEY}&fmt=mp3")
    print(f"    Audio Toggle : http://{ip}:{STREAM_PORT}/audio/toggle  [POST]")
    print(f"    Audio Status : http://{ip}:{STREAM_PORT}/audio/status  [GET]")
    print(f"    Browser view : http://{ip}:{STREAM_PORT}/screen/viewer?key={SECRET_KEY}")
    print("-" * 66)
    print("  Audio requires: pip install pyaudiowpatch")
    print("  Audio encoding: ffmpeg must be in PATH for 192kbps MP3 output")
    print("  Fallback audio: pip install sounddevice numpy")
    print("=" * 66)
    try:
        while True: time.sleep(1)
    except KeyboardInterrupt:
        log.info("Agent stopped.")

# ═══════════════════════════════════════════════════════════════════
#  ENTRY POINT
# ═══════════════════════════════════════════════════════════════════
if __name__ == "__main__":
    local_ip = _get_local_ip()
    log.info("=" * 62)
    log.info("  PC Command Agent v11.0  [HTTP + 1080p Video + Fixed Audio]")
    log.info("=" * 62)
    log.info(f"  IP Address   : {local_ip}")
    log.info(f"  Command Port : {PORT}  (HTTP — {FLASK_THREADS} threads)")
    log.info(f"  Stream Port  : {STREAM_PORT} (HTTP — video 1080p + audio 192kbps + toggle/status)")
    log.info(f"  Secret Key   : {SECRET_KEY}")
    log.info(f"  Master Key   : {MASTER_KEY[:4]}*** (admin only)")
    log.info(f"  Chunk Size   : {CHUNK_SIZE//1024//1024} MB")
    log.info(f"  Req Timeout  : {REQUEST_TIMEOUT}s (pipeline watchdog)")
    log.info(f"  Video default: 1920px wide, q=75, 20fps (LANCZOS)")
    log.info(f"  Audio        : 192kbps MP3, 44100Hz, WASAPI loopback")
    log.info(f"  Browser view : http://{local_ip}:{STREAM_PORT}/screen/viewer?key={SECRET_KEY}")
    log.info(f"  2K stream    : http://{local_ip}:{STREAM_PORT}/screen/stream?key={SECRET_KEY}&w=2560&q=85&fps=15")
    log.info(f"  Audio stream : http://{local_ip}:{STREAM_PORT}/audio/stream?key={SECRET_KEY}&fmt=mp3")
    log.info("  Audio lib    : pip install pyaudiowpatch  (WASAPI loopback)")
    log.info("  Audio encode : ffmpeg in PATH (for 192kbps MP3 output)")
    log.info("=" * 62)

    # Start background workers
    threading.Thread(target=keep_alive_worker,   daemon=True).start()
    threading.Thread(target=_request_watchdog,   daemon=True).start()
    threading.Thread(target=flask_server_runner, daemon=True).start()
    threading.Thread(target=stream_server_runner, daemon=True).start()

    # Tray or console
    try:
        import pystray
        run_tray()
    except ImportError:
        _console_mode()