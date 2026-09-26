// ═══════════════════════════════════════════════════════════════════════════
// Samsung Tizen TV Control API Client
// ═══════════════════════════════════════════════════════════════════════════
//
// Talks to the WebSocket remote-control interface that ships built into every
// network-connected Samsung TV from ~2016 onward (Tizen K-series and newer).
// Nothing needs to be installed on the TV — this is Samsung's own interface,
// the same one the SmartThings / Smart View apps use.
//
// Two channels are used:
//   1. A WebSocket to ws://<tv-ip>:8001/api/v2/channels/samsung.remote.control
//      — opened DIRECTLY from the browser. WebSocket connections are not
//      subject to the browser's CORS/fetch restrictions, so (unlike the PC
//      agent) this does NOT need to go through the /pcproxy-style relay.
//   2. A couple of plain REST calls (device info) which DO need the relay,
//      because the TV doesn't send CORS headers on its HTTP responses.
//      These go through /tvproxy/<ip>/<port>/<path>, added in vite.config.js
//      and production-server.mjs alongside the existing /pcproxy route.
//
// IMPORTANT — protocol notes:
//   • Key presses and cursor/touchpad control are the officially-used
//     "ms.remote.control" messages and are stable across models.
//   • Text injection ("SendInputString") and the installed-app list/launch
//     events are community-reverse-engineered (Samsung has never published
//     a spec for them). They work on most 2018+ models but can vary by
//     firmware — test on your TV and adjust MSG shapes below if needed.
//   • Text injection only reaches Samsung's own text fields (Smart Hub
//     search, browser address bar, login prompts). Apps with their own
//     custom keyboard widget (Netflix, YouTube search, etc.) generally do
//     NOT accept it — that's a TV-side limitation, not a bug here.
// ═══════════════════════════════════════════════════════════════════════════

const MAX_TEXT_LEN = 500;

// ── Helpers ─────────────────────────────────────────────────────────────────

function b64(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

function sanitizeIp(ip) {
  if (!ip || typeof ip !== 'string') return '';
  return /^[\w.\\-]+$/.test(ip) ? ip : '';
}

function getDeviceName() {
  let id = '';
  try { id = localStorage.getItem('itc_tv_device_id') || ''; } catch { /* empty */ }
  if (!id) {
    id = 'WebAdmin_' + Math.random().toString(36).substring(2, 8);
    try { localStorage.setItem('itc_tv_device_id', id); } catch { /* empty */ }
  }
  return id;
}

/** REST calls to the TV go through the same style of relay as /pcproxy */
function toTvProxyUrl(ip, port, path) {
  const safeIp = sanitizeIp(ip);
  if (!safeIp) return '';
  return `/tvproxy/${safeIp}/${port}${path}`;
}

async function tvRestRequest(ip, port, path, timeout = 6000) {
  const url = toTvProxyUrl(ip, port, path);
  if (!url) return { ok: false, error: 'Invalid TV address' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res  = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { ok: res.ok, status: res.status, data: json };
  } catch (e) {
    clearTimeout(timer);
    return { ok: false, error: e.message || 'Network error' };
  }
}

/** Basic reachability + device info check (used by "Ping" / connect flow) */
export async function getTvInfo(ip, port = 8001) {
  return tvRestRequest(ip, port, '/api/v2/');
}

// ═══════════════════════════════════════════════════════════════════════════
// WebSocket remote-control session
// ═══════════════════════════════════════════════════════════════════════════
//
// This is a small class rather than one-shot functions because the TV only
// shows its "Allow this device?" popup on a NEW connection, and we want to
// keep one persistent socket open for the whole session (repeatedly
// reconnecting would re-trigger the popup and add latency to every command).

export class TvSession {
  /**
   * @param {string} ip
   * @param {object} opts
   * @param {number}  [opts.port=8001]      8001 = plaintext (most 2018+ models).
   *                                         8002 = TLS (wss://), needed by some
   *                                         older models — browsers will only
   *                                         accept this if the TV's self-signed
   *                                         cert has been trusted once, e.g. by
   *                                         visiting https://<ip>:8002 directly.
   * @param {string}  [opts.name]           Device name shown on the TV's popup.
   * @param {string}  [opts.token]          Saved pairing token, if any.
   * @param {function} [opts.onEvent]       (eventName, data) => void — fires for
   *                                         every message from the TV (used to
   *                                         receive the app list, etc.)
   */
  constructor(ip, { port = 8001, name = getDeviceName(), token = '' } = {}) {
    this.ip = sanitizeIp(ip);
    this.port = port;
    this.name = name;
    this.token = token;
    this.ws = null;
    this.onEvent = () => {};
  }

  /** Resolves with { token } once the TV accepts the connection. */
  connect({ timeout = 25000 } = {}) {
    return new Promise((resolve, reject) => {
      if (!this.ip) return reject(new Error('Invalid TV IP address'));

      const scheme = this.port === 8002 ? 'wss' : 'ws';
      const params = new URLSearchParams({ name: b64(this.name) });
      if (this.token) params.set('token', this.token);
      const url = `${scheme}://${this.ip}:${this.port}/api/v2/channels/samsung.remote.control?${params.toString()}`;

      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.close();
        reject(new Error('Timed out waiting for approval on the TV screen.'));
      }, timeout);

      try {
        this.ws = new WebSocket(url);
      } catch (e) {
        clearTimeout(timer);
        return reject(e);
      }

      this.ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }

        if (!settled && msg.event === 'ms.channel.connect') {
          settled = true;
          clearTimeout(timer);
          if (msg.data?.token) this.token = msg.data.token;
          resolve({ token: this.token });
        } else if (!settled && msg.event === 'ms.channel.unauthorized') {
          settled = true;
          clearTimeout(timer);
          reject(new Error('Connection was rejected on the TV.'));
        }

        this.onEvent(msg.event, msg.data);
      };

      this.ws.onerror = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error('Could not reach the TV at ' + this.ip + ':' + this.port));
      };

      this.ws.onclose = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error('Connection closed before the TV approved it.'));
      };
    });
  }

  isOpen() {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  close() {
    if (this.ws) {
      try { this.ws.close(); } catch { /* empty */ }
    }
    this.ws = null;
  }

  _send(payload) {
    if (!this.isOpen()) throw new Error('Not connected to TV');
    this.ws.send(JSON.stringify(payload));
  }

  // ── Remote keys ────────────────────────────────────────────────────────
  sendKey(key) {
    this._send({
      method: 'ms.remote.control',
      params: { Cmd: 'Click', DataOfCmd: key, Option: 'false', TypeOfRemote: 'SendRemoteKey' },
    });
  }

  // ── Touchpad / cursor ──────────────────────────────────────────────────
  moveCursor(dx, dy) {
    this._send({
      method: 'ms.remote.control',
      params: {
        Cmd: 'Move',
        Position: { x: dx, y: dy, Time: String(Date.now()) },
        TypeOfRemote: 'ProcessMouseDevice',
      },
    });
  }

  click(button = 'left') {
    this._send({
      method: 'ms.remote.control',
      params: { Cmd: button === 'right' ? 'RightClick' : 'LeftClick', TypeOfRemote: 'ProcessMouseDevice' },
    });
  }

  // ── Text input (Samsung native fields only — see notes at top of file) ──
  sendText(text) {
    const safe = String(text || '').substring(0, MAX_TEXT_LEN);
    if (!safe) return;
    this._send({
      method: 'ms.remote.control',
      params: { Cmd: b64(safe), DataOfCmd: 'base64', TypeOfRemote: 'SendInputString' },
    });
  }

  // ── Installed apps (reverse-engineered ed.* events) ─────────────────────
  requestAppList() {
    this._send({ method: 'ms.channel.emit', params: { event: 'ed.installedApp.get', to: 'host' } });
  }

  launchApp(appId) {
    const safeId = String(appId || '').replace(/[^\w.-]/g, '').substring(0, 100);
    if (!safeId) return;
    this._send({
      method: 'ms.channel.emit',
      params: { event: 'ed.apps.launch', to: 'host', data: { appId: safeId, action_type: 'NATIVE_LAUNCH' } },
    });
  }
}

// ── Constants ───────────────────────────────────────────────────────────────

export const TV_REMOTE_KEYS = [
  'KEY_POWER', 'KEY_HOME', 'KEY_MENU', 'KEY_RETURN', 'KEY_EXIT',
  'KEY_UP', 'KEY_DOWN', 'KEY_LEFT', 'KEY_RIGHT', 'KEY_ENTER',
  'KEY_VOLUP', 'KEY_VOLDOWN', 'KEY_MUTE',
  'KEY_CHUP', 'KEY_CHDOWN', 'KEY_SOURCE',
  'KEY_PLAY', 'KEY_PAUSE', 'KEY_STOP', 'KEY_REWIND', 'KEY_FF',
  'KEY_RED', 'KEY_GREEN', 'KEY_YELLOW', 'KEY_BLUE',
  'KEY_GUIDE', 'KEY_TOOLS', 'KEY_INFO', 'KEY_HDMI',
];

export const TV_QUICK_KEYS = [
  { id: 'KEY_POWER', label: 'Power',  icon: '⏻' },
  { id: 'KEY_HOME',  label: 'Home',   icon: '🏠' },
  { id: 'KEY_MENU',  label: 'Menu',   icon: '☰' },
  { id: 'KEY_RETURN',label: 'Back',   icon: '↩' },
  { id: 'KEY_VOLUP', label: 'Vol +',  icon: '🔊' },
  { id: 'KEY_VOLDOWN',label: 'Vol -', icon: '🔉' },
  { id: 'KEY_MUTE',  label: 'Mute',   icon: '🔇' },
  { id: 'KEY_SOURCE',label: 'Source', icon: '🔌' },
];
