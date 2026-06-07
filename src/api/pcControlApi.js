// ═══════════════════════════════════════════════════════════════════════════
// PC Control API Client — Security-hardened
// ═══════════════════════════════════════════════════════════════════════════

// ── Security constants ─────────────────────────────────────────────────────
const MAX_KEY_LEN     = 128;   // secret key max length
const MAX_PATH_LEN    = 512;   // file path max length
const MAX_TEXT_LEN    = 2000;  // typed text max length

// ── Sanitization helpers ───────────────────────────────────────────────────

/** Sanitize a secret key — strip anything that's not printable ASCII */
function sanitizeKey(key) {
  if (!key || typeof key !== 'string') return '';
  return key.replace(/[^\x20-\x7E]/g, '').substring(0, MAX_KEY_LEN);
}

/** Sanitize a file path — prevent directory traversal */
function sanitizePath(path) {
  if (!path || typeof path !== 'string') return '';
  // Reject obvious traversal attempts
  if (path.includes('..') || path.includes('\x00')) {
    console.warn('[pcControlApi] Rejected suspicious path:', path);
    return '';
  }
  return path.substring(0, MAX_PATH_LEN);
}

/** Sanitize numeric values */
function sanitizeNum(val, min, max, def) {
  const n = Number(val);
  if (!isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

// ── Proxy URL builder ──────────────────────────────────────────────────────

function toProxyUrl(baseUrl, path) {
  try {
    const parsed = new URL(path.startsWith('http') ? path : baseUrl + path);
    const ip     = parsed.hostname;
    const port   = parsed.port || '5000';
    const rest   = parsed.pathname + parsed.search;
    // Validate IP — must be a valid IPv4 or hostname (no SSRF-style tricks)
    if (!/^[\w.\\-]+$/.test(ip)) {
      console.warn('[pcControlApi] Rejected suspicious IP:', ip);
      return '';
    }
    return `/pcproxy/${ip}/${port}${rest}`;
  } catch {
    const match = baseUrl.match(/^https?:\/\/([^:/]+):?(\d+)?/);
    if (match) {
      const ip   = match[1];
      const port = match[2] || '5000';
      if (!/^[\w.\\-]+$/.test(ip)) return '';
      return `/pcproxy/${ip}/${port}${path}`;
    }
    return '';
  }
}

function withPort(baseUrl, port) {
  try {
    const parsed = new URL(baseUrl);
    parsed.port  = String(sanitizeNum(port, 1, 65535, 5001));
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return baseUrl;
  }
}

function getDeviceId() {
  let id = '';
  try { id = localStorage.getItem('itc_device_id') || ''; } catch { /* empty */ }
  if (!id) {
    id = 'web_' + Math.random().toString(36).substring(2, 10);
    try { localStorage.setItem('itc_device_id', id); } catch { /* empty */ }
  }
  return id;
}

// ── Core request helper ────────────────────────────────────────────────────

async function agentRequest(method, url, secretKey, body = null, timeout = 15000) {
  if (!url) return { ok: false, status: 0, data: null, error: 'Invalid URL' };

  const safeKey = sanitizeKey(secretKey);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  const headers = {
    'Content-Type':  'application/json',
    'X-Secret-Key':  safeKey,
    'X-Device-Name': 'WebAdmin/2.0',
    'X-Device-Id':   getDeviceId(),
    // Security headers
    'X-Requested-With': 'XMLHttpRequest',
  };

  const opts = { method, headers, signal: controller.signal };
  if (body) {
    // Validate body is a plain object or string (prevent prototype pollution)
    const safeBody = typeof body === 'string' ? body : JSON.stringify(body);
    if (safeBody.length > 1_000_000) {
      clearTimeout(timer);
      return { ok: false, status: 0, data: null, error: 'Request body too large' };
    }
    opts.body = safeBody;
  }

  try {
    const res  = await fetch(url, opts);
    clearTimeout(timer);
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = text; }
    return { ok: res.ok, status: res.status, data: json };
  } catch (e) {
    clearTimeout(timer);
    return { ok: false, status: 0, data: null, error: e.message || 'Network error' };
  }
}

function proxyRequest(method, baseUrl, path, secretKey, body = null, timeout = 15000) {
  const proxiedUrl = toProxyUrl(baseUrl, path);
  return agentRequest(method, proxiedUrl, secretKey, body, timeout);
}

function enc(val) {
  return encodeURIComponent(String(val || '').substring(0, 512));
}

// ── Connection ─────────────────────────────────────────────────────────────

export async function ping(baseUrl, secretKey) {
  return proxyRequest('GET', baseUrl, '/ping', secretKey, null, 4000);
}

// ── Screen ─────────────────────────────────────────────────────────────────

export async function getScreenSize(baseUrl, secretKey) {
  return proxyRequest('GET', baseUrl, '/screen_size', secretKey);
}

/**
 * Capture a single frame.
 * quality: 10–95 (JPEG quality)
 * scale: 1–4 (downscale factor — 1=full res, 2=half, 4=quarter)
 */
export async function captureScreen(baseUrl, secretKey, quality = 65, scale = 2) {
  const q = sanitizeNum(quality, 10, 95, 65);
  const s = sanitizeNum(scale,   1,  4,  2);
  return proxyRequest('GET', baseUrl, `/screen/capture?q=${q}&s=${s}`, secretKey);
}

/** Build MJPEG stream URL (1080p by default, supports 2K) */
export function getScreenStreamUrl(baseUrl, secretKey, options = {}) {
  const width      = sanitizeNum(options.width,      320, 3840, 1920);
  const quality    = sanitizeNum(options.quality,    30,  95,   75);
  const fps        = sanitizeNum(options.fps,        1,   60,   20);
  const streamPort = sanitizeNum(options.streamPort, 1,   65535, 5001);
  const safeKey    = sanitizeKey(secretKey);
  const streamBase = withPort(baseUrl, streamPort);
  return toProxyUrl(
      streamBase,
      `/screen/stream?key=${enc(safeKey)}&w=${enc(width)}&q=${enc(quality)}&fps=${enc(fps)}`,
  );
}

export async function fetchScreenSnapshot(baseUrl, secretKey) {
  return proxyRequest('GET', baseUrl, '/screen/snapshot', secretKey);
}

export async function fetchScreenInfo(baseUrl, secretKey) {
  return proxyRequest('GET', baseUrl, '/screen/info', secretKey);
}

// ── Mouse Input ────────────────────────────────────────────────────────────

export async function moveMouse(baseUrl, secretKey, dx, dy) {
  const sdx = sanitizeNum(dx, -500, 500, 0);
  const sdy = sanitizeNum(dy, -500, 500, 0);
  return proxyRequest('POST', baseUrl, '/input/mouse/move', secretKey, { dx: sdx, dy: sdy });
}

export async function clickMouse(baseUrl, secretKey, button = 'left', double = false) {
  const safeButton = ['left', 'right', 'middle'].includes(button) ? button : 'left';
  return proxyRequest('POST', baseUrl, '/input/mouse/click', secretKey, { button: safeButton, double: !!double });
}

export async function scrollMouse(baseUrl, secretKey, amount, horizontal = false) {
  const safeAmount = sanitizeNum(amount, -20, 20, 3);
  return proxyRequest('POST', baseUrl, '/input/mouse/scroll', secretKey, { amount: safeAmount, horizontal: !!horizontal });
}

export async function mouseButtonDown(baseUrl, secretKey, button = 'left') {
  const safeButton = ['left', 'right'].includes(button) ? button : 'left';
  return proxyRequest('POST', baseUrl, '/input/mouse/down', secretKey, { button: safeButton });
}

export async function mouseButtonUp(baseUrl, secretKey, button = 'left') {
  const safeButton = ['left', 'right'].includes(button) ? button : 'left';
  return proxyRequest('POST', baseUrl, '/input/mouse/up', secretKey, { button: safeButton });
}

// ── Keyboard Input ─────────────────────────────────────────────────────────

// Allowed key combo pattern
const KEY_COMBO_PATTERN = /^[A-Z0-9+_]{1,30}$/;

export async function pressKey(baseUrl, secretKey, key) {
  const safeKey = String(key || '').toUpperCase().trim().substring(0, 30);
  if (!KEY_COMBO_PATTERN.test(safeKey)) {
    console.warn('[pcControlApi] Rejected unsafe key combo:', key);
    return { ok: false, error: 'Invalid key combo' };
  }
  return proxyRequest('POST', baseUrl, '/input/keyboard/key', secretKey, { value: safeKey });
}

export async function typeText(baseUrl, secretKey, text) {
  const safeText = String(text || '').substring(0, MAX_TEXT_LEN);
  return proxyRequest('POST', baseUrl, '/input/keyboard/type', secretKey, { value: safeText });
}

export async function holdKey(baseUrl, secretKey, key) {
  const safeKey = String(key || '').toUpperCase().trim().substring(0, 20);
  if (!KEY_COMBO_PATTERN.test(safeKey)) return { ok: false, error: 'Invalid key' };
  return proxyRequest('POST', baseUrl, '/input/keyboard/hold', secretKey, { value: safeKey });
}

export async function releaseKey(baseUrl, secretKey, key) {
  const safeKey = String(key || '').toUpperCase().trim().substring(0, 20);
  if (!KEY_COMBO_PATTERN.test(safeKey) && safeKey !== 'ALL') return { ok: false, error: 'Invalid key' };
  return proxyRequest('POST', baseUrl, '/input/keyboard/release', secretKey, { value: safeKey });
}

// ── System / Quick Commands ────────────────────────────────────────────────

// Whitelist of allowed quick step types
const ALLOWED_QUICK_TYPES = new Set([
  'LAUNCH_APP','KILL_APP','KEY_PRESS','TYPE_TEXT','MOUSE_CLICK',
  'MOUSE_MOVE','MOUSE_SCROLL','OPEN_FILE','SYSTEM_CMD','WAIT','FILE_OP',
]);

export async function executeQuickStep(baseUrl, secretKey, step) {
  if (!step || !ALLOWED_QUICK_TYPES.has(String(step.type || '').toUpperCase())) {
    return { ok: false, error: 'Invalid step type' };
  }
  return proxyRequest('POST', baseUrl, '/quick', secretKey, step);
}

// ── Plans ──────────────────────────────────────────────────────────────────

export async function executePlan(baseUrl, secretKey, planName, steps) {
  const safeName = String(planName || '').substring(0, 100);
  return proxyRequest('POST', baseUrl, '/execute', secretKey, { planName: safeName, steps });
}

// ── Processes ──────────────────────────────────────────────────────────────

export async function getProcesses(baseUrl, secretKey) {
  return proxyRequest('GET', baseUrl, '/processes', secretKey);
}

// ── Browse ─────────────────────────────────────────────────────────────────

export async function getDrives(baseUrl, secretKey) {
  return proxyRequest('GET', baseUrl, '/browse/drives', secretKey);
}

export async function browseDir(baseUrl, secretKey, path, exts = '') {
  const safePath = sanitizePath(path);
  if (!safePath) return { ok: false, error: 'Invalid path' };
  // Sanitize file extension filter
  const safeExts = String(exts || '').replace(/[^a-zA-Z0-9,]/g, '').substring(0, 200);
  const extParam  = safeExts ? `&exts=${enc(safeExts)}` : '';
  return proxyRequest('GET', baseUrl, `/browse/dir?path=${enc(safePath)}${extParam}`, secretKey);
}

export async function searchFiles(baseUrl, secretKey, rootPath, query, maxResults = 100) {
  const safePath  = sanitizePath(rootPath);
  const safeQuery = String(query || '').substring(0, 100).replace(/[<>"|]/g, '');
  const safeMax   = sanitizeNum(maxResults, 1, 200, 100);
  if (!safePath) return { ok: false, error: 'Invalid path' };
  return proxyRequest('GET', baseUrl,
      `/browse/search?path=${enc(safePath)}&q=${enc(safeQuery)}&maxResults=${safeMax}`,
      secretKey,
  );
}

export async function getInstalledApps(baseUrl, secretKey) {
  return proxyRequest('GET', baseUrl, '/browse/apps', secretKey);
}

export async function getSpecialFolders(baseUrl, secretKey) {
  return proxyRequest('GET', baseUrl, '/browse/special', secretKey);
}

export async function getRecentPaths(baseUrl, secretKey) {
  return proxyRequest('GET', baseUrl, '/browse/recent', secretKey);
}

// ── File Transfer ──────────────────────────────────────────────────────────

export function getDownloadUrl(baseUrl, secretKey, remotePath) {
  const safePath = sanitizePath(remotePath);
  if (!safePath) return '';
  return toProxyUrl(baseUrl, `/file/download?path=${enc(safePath)}`);
}

export async function uploadFile(baseUrl, secretKey, file, remotePath) {
  const safePath = sanitizePath(remotePath);
  if (!safePath) return { ok: false, error: 'Invalid path' };
  // Validate file — reject executables in upload
  const dangerousExts = ['exe','bat','ps1','cmd','msi','scr','vbs','js','wsf'];
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  if (dangerousExts.includes(ext)) {
    console.warn('[pcControlApi] Blocked upload of potentially dangerous file:', file.name);
    return { ok: false, error: 'Upload of executable files is not allowed from the browser.' };
  }

  const uploadUrl = toProxyUrl(baseUrl, `/file/upload?dest=${enc(safePath)}`);
  if (!uploadUrl) return { ok: false, error: 'Invalid URL' };
  const formData = new FormData();
  formData.append('dest', safePath);
  formData.append('file', file, file.name);
  try {
    const res = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'X-Secret-Key':     sanitizeKey(secretKey),
        'X-Device-Name':    'WebAdmin/2.0',
        'X-Device-Id':      getDeviceId(),
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: formData,
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = text; }
    return { ok: res.ok, status: res.status, data: json };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── Admin Endpoints (Master Key only) ─────────────────────────────────────

export async function getConnectedUsers(baseUrl, masterKey) {
  return proxyRequest('GET', baseUrl, '/connections', masterKey);
}

export async function kickUser(baseUrl, masterKey, deviceId) {
  const safeId = String(deviceId || '').replace(/[^a-zA-Z0-9_\\-]/g, '').substring(0, 80);
  return proxyRequest('POST', baseUrl, '/connections/kick', masterKey, { device_id: safeId });
}

export async function changeSecretKey(baseUrl, masterKey, newKey) {
  const safeNew = sanitizeKey(newKey);
  if (safeNew.length < 6) return { ok: false, error: 'Key must be at least 6 characters' };
  return proxyRequest('POST', baseUrl, '/settings/key', masterKey, { new_key: safeNew });
}

export async function getConnectionLogs(baseUrl, masterKey) {
  return proxyRequest('GET', baseUrl, '/connections/logs', masterKey);
}

// ── App Management ─────────────────────────────────────────────────────────

export async function launchApp(baseUrl, secretKey, appPath) {
  const safePath = sanitizePath(appPath);
  if (!safePath) return { ok: false, error: 'Invalid path' };
  return proxyRequest('POST', baseUrl, '/quick', secretKey, {
    type: 'LAUNCH_APP', value: safePath, args: [safePath],
  });
}

export async function killApp(baseUrl, secretKey, processName) {
  const safeName = String(processName || '').replace(/[^a-zA-Z0-9._\- ]/g, '').substring(0, 100);
  if (!safeName) return { ok: false, error: 'Invalid process name' };
  return proxyRequest('POST', baseUrl, '/quick', secretKey, {
    type: 'KILL_APP', value: safeName,
  });
}

export async function minimizeApp(baseUrl, secretKey, name) {
  return proxyRequest('POST', baseUrl, '/app/minimize', secretKey, { name });
}

export async function restoreApp(baseUrl, secretKey, name) {
  return proxyRequest('POST', baseUrl, '/app/restore', secretKey, { name });
}

// ── Constants ──────────────────────────────────────────────────────────────

export const PC_COMMON_KEYS = [
  'F1','F2','F3','F4','F5','F6','F7','F8','F9','F10','F11','F12',
  'ENTER','ESC','SPACE','TAB','BACKSPACE','DELETE',
  'UP','DOWN','LEFT','RIGHT','HOME','END','PAGE_UP','PAGE_DOWN',
  'CTRL+C','CTRL+V','CTRL+Z','CTRL+S','CTRL+A',
  'ALT+F4','ALT+TAB','WIN+D','WIN+L','WIN+R','WIN+E',
  'WIN+TAB','WIN+I','WIN+A','WIN+S','CTRL+SHIFT+ESC',
];

export const PC_SYSTEM_COMMANDS = [
  { id: 'LOCK',          label: 'Lock PC',       icon: '🔒' },
  { id: 'SLEEP',         label: 'Sleep',          icon: '😴' },
  { id: 'SHUTDOWN',      label: 'Shutdown',       icon: '⏻'  },
  { id: 'RESTART',       label: 'Restart',        icon: '🔄' },
  { id: 'VOLUME_UP',     label: 'Volume Up',      icon: '🔊' },
  { id: 'VOLUME_DOWN',   label: 'Volume Down',    icon: '🔉' },
  { id: 'MUTE',          label: 'Mute',           icon: '🔇' },
  { id: 'SCREENSHOT',    label: 'Screenshot',     icon: '📸' },
  { id: 'TASK_MANAGER',  label: 'Task Manager',   icon: '📊' },
  { id: 'SETTINGS',      label: 'Settings',       icon: '⚙️' },
  { id: 'CONTROL_PANEL', label: 'Control Panel',  icon: '🎛️' },
  { id: 'OPEN_URL',      label: 'Open URL',       icon: '🌐' },
];

export function getFileIcon(ext) {
  if (!ext) return '📄';
  const e = ext.toLowerCase();
  if (['mp4','mkv','avi','mov','wmv'].includes(e))         return '🎬';
  if (['mp3','wav','flac','aac','m4a'].includes(e))        return '🎵';
  if (['jpg','jpeg','png','gif','bmp','webp'].includes(e)) return '🖼️';
  if (e === 'pdf')                                         return '📕';
  if (['doc','docx','rtf'].includes(e))                    return '📘';
  if (['xls','xlsx','csv'].includes(e))                    return '📗';
  if (['ppt','pptx'].includes(e))                          return '📊';
  if (['py','bat','ps1','sh','cmd'].includes(e))           return '⚙️';
  if (['txt','log','md'].includes(e))                      return '📄';
  if (['zip','rar','7z','tar','gz'].includes(e))           return '🗜️';
  if (['exe','msi'].includes(e))                           return '🖥️';
  return '📂';
}

export function formatFileSize(kb) {
  if (kb < 1)            return '0 KB';
  if (kb < 1024)         return `${kb} KB`;
  if (kb < 1024 * 1024)  return `${(kb / 1024).toFixed(1)} MB`;
  return `${(kb / (1024 * 1024)).toFixed(2)} GB`;
}

// ── AI / Ollama ─────────────────────────────────────────────────────────────

/**
 * Send a natural language command to the Ollama agent-v12 model.
 * ollamaUrl: e.g. "http://192.168.5.32:5004"
 * model: "agent-v12" | "llama3b-fast" | "tinyllama"
 */
export async function askAI(ollamaUrl, prompt, model = 'agent-v12', signal = null) {
  const url = `${ollamaUrl}/api/generate`;
  const body = JSON.stringify({
    model,
    prompt,
    keep_alive: -1,
    stream: false,
  });
  try {
    const res  = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal,
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = text; }
    return { ok: res.ok, data: json };
  } catch (e) {
    return { ok: false, error: e.message || 'AI request failed' };
  }
}

/** List models available on the Ollama server */
export async function listAIModels(ollamaUrl) {
  try {
    const res  = await fetch(`${ollamaUrl}/api/tags`);
    const json = await res.json();
    return { ok: true, models: (json.models || []).map(m => m.name) };
  } catch (e) {
    return { ok: false, models: [], error: e.message };
  }
}