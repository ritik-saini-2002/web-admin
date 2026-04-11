// ═══════════════════════════════════════════════════════════════════════════
// PC Control API Client — mirrors PcControlApiClient.kt for the browser
// ═══════════════════════════════════════════════════════════════════════════

/**
 * All calls go to the IT Connect Agent running on the target PC.
 * Base URL format:  http://<ip>:<port>
 * Default port: 5000, Default secret: "Ritik@2002"
 *
 * IMPORTANT — CORS Proxy:
 * Browsers block cross-origin requests. Since the PC Agent doesn't serve
 * CORS headers, we route ALL requests through a local Vite middleware at
 * /pcproxy/<ip>/<port>/<path>. This runs on YOUR machine (the source
 * computer), NOT a remote server. The chain is:
 *
 *   Browser  →  Vite dev server (localhost)  →  PC Agent (target IP)
 *   ^^^^^^      ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
 *   same machine as the browser             direct to target
 */

// ── Helper ─────────────────────────────────────────────────────────────────

/**
 * Convert a baseUrl like "http://192.168.1.5:5000" into
 * a proxy prefix like "/pcproxy/192.168.1.5/5000"
 */
function toProxyUrl(baseUrl, path) {
  try {
    // baseUrl = "http://192.168.1.5:5000"
    const parsed = new URL(path.startsWith('http') ? path : baseUrl + path);
    const ip = parsed.hostname;
    const port = parsed.port || '5000';
    const rest = parsed.pathname + parsed.search;
    return `/pcproxy/${ip}/${port}${rest}`;
  } catch {
    // Fallback: try extracting manually
    const match = baseUrl.match(/^https?:\/\/([^:]+):?(\d+)?/);
    if (match) {
      const ip = match[1];
      const port = match[2] || '5000';
      return `/pcproxy/${ip}/${port}${path}`;
    }
    // Last resort: use original URL (will fail with CORS, but at least shows error)
    return baseUrl + path;
  }
}

async function agentRequest(method, url, secretKey, body = null, timeout = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const headers = {
    'Content-Type': 'application/json',
    'X-Secret-Key': secretKey,
    'X-Device-Name': 'WebAdmin/' + navigator.userAgent.split(' ').pop(),
    'X-Device-Id': 'web_admin_' + (localStorage.getItem('itc_device_id') || generateDeviceId()),
  };
  const opts = { method, headers, signal: controller.signal };
  if (body) opts.body = typeof body === 'string' ? body : JSON.stringify(body);
  try {
    const res = await fetch(url, opts);
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

/** Proxy-aware request: converts baseUrl + path into /pcproxy/... route */
function proxyRequest(method, baseUrl, path, secretKey, body = null, timeout = 15000) {
  const proxiedUrl = toProxyUrl(baseUrl, path);
  return agentRequest(method, proxiedUrl, secretKey, body, timeout);
}

function generateDeviceId() {
  const id = 'web_' + Math.random().toString(36).substring(2, 8);
  localStorage.setItem('itc_device_id', id);
  return id;
}

function enc(val) {
  return encodeURIComponent(val);
}

// ── Connection ─────────────────────────────────────────────────────────────

export async function ping(baseUrl, secretKey) {
  return proxyRequest('GET', baseUrl, '/ping', secretKey, null, 4000);
}

// ── Screen ─────────────────────────────────────────────────────────────────

export async function getScreenSize(baseUrl, secretKey) {
  return proxyRequest('GET', baseUrl, '/screen_size', secretKey);
}

export async function captureScreen(baseUrl, secretKey, quality = 25, scale = 4) {
  return proxyRequest('GET', baseUrl, `/screen/capture?q=${quality}&s=${scale}`, secretKey);
}

export async function fetchScreenSnapshot(baseUrl, secretKey) {
  return proxyRequest('GET', baseUrl, '/screen/snapshot', secretKey);
}

export async function fetchScreenInfo(baseUrl, secretKey) {
  return proxyRequest('GET', baseUrl, '/screen/info', secretKey);
}

// ── Mouse Input ────────────────────────────────────────────────────────────

export async function moveMouse(baseUrl, secretKey, dx, dy) {
  return proxyRequest('POST', baseUrl, '/input/mouse/move', secretKey, { dx, dy });
}

export async function clickMouse(baseUrl, secretKey, button = 'left', double = false) {
  return proxyRequest('POST', baseUrl, '/input/mouse/click', secretKey, { button, double });
}

export async function scrollMouse(baseUrl, secretKey, amount, horizontal = false) {
  return proxyRequest('POST', baseUrl, '/input/mouse/scroll', secretKey, { amount, horizontal });
}

export async function mouseButtonDown(baseUrl, secretKey, button = 'left') {
  return proxyRequest('POST', baseUrl, '/input/mouse/down', secretKey, { button });
}

export async function mouseButtonUp(baseUrl, secretKey, button = 'left') {
  return proxyRequest('POST', baseUrl, '/input/mouse/up', secretKey, { button });
}

// ── Keyboard Input ─────────────────────────────────────────────────────────

export async function pressKey(baseUrl, secretKey, key) {
  return proxyRequest('POST', baseUrl, '/input/keyboard/key', secretKey, { value: key });
}

export async function typeText(baseUrl, secretKey, text) {
  return proxyRequest('POST', baseUrl, '/input/keyboard/type', secretKey, { value: text });
}

export async function holdKey(baseUrl, secretKey, key) {
  return proxyRequest('POST', baseUrl, '/input/keyboard/hold', secretKey, { value: key });
}

export async function releaseKey(baseUrl, secretKey, key) {
  return proxyRequest('POST', baseUrl, '/input/keyboard/release', secretKey, { value: key });
}

// ── System / Quick Commands ────────────────────────────────────────────────

export async function executeQuickStep(baseUrl, secretKey, step) {
  return proxyRequest('POST', baseUrl, '/quick', secretKey, step);
}

// ── Plans ──────────────────────────────────────────────────────────────────

export async function executePlan(baseUrl, secretKey, planName, steps) {
  return proxyRequest('POST', baseUrl, '/execute', secretKey, { planName, steps });
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
  const extParam = exts ? `&exts=${enc(exts)}` : '';
  return proxyRequest('GET', baseUrl, `/browse/dir?path=${enc(path)}${extParam}`, secretKey);
}

export async function searchFiles(baseUrl, secretKey, rootPath, query, maxResults = 100) {
  return proxyRequest('GET', baseUrl, `/browse/search?path=${enc(rootPath)}&q=${enc(query)}&maxResults=${maxResults}`, secretKey);
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
  // Download also goes through proxy
  return toProxyUrl(baseUrl, `/file/download?path=${enc(remotePath)}`);
}

export async function uploadFile(baseUrl, secretKey, file, remotePath) {
  const formData = new FormData();
  formData.append('dest', remotePath);
  formData.append('file', file, file.name);
  const uploadUrl = toProxyUrl(baseUrl, `/file/upload?dest=${enc(remotePath)}`);
  try {
    const res = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'X-Secret-Key': secretKey,
        'X-Device-Name': 'WebAdmin',
        'X-Device-Id': localStorage.getItem('itc_device_id') || 'web_admin',
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

// ── Admin Endpoints (Master Key) ───────────────────────────────────────────

export async function getConnectedUsers(baseUrl, masterKey) {
  return proxyRequest('GET', baseUrl, '/connections', masterKey);
}

export async function kickUser(baseUrl, masterKey, deviceId) {
  return proxyRequest('POST', baseUrl, '/connections/kick', masterKey, { device_id: deviceId });
}

export async function changeSecretKey(baseUrl, masterKey, newKey) {
  return proxyRequest('POST', baseUrl, '/settings/key', masterKey, { new_key: newKey });
}

export async function getConnectionLogs(baseUrl, masterKey) {
  return proxyRequest('GET', baseUrl, '/connections/logs', masterKey);
}

// ── App Management ─────────────────────────────────────────────────────────

export async function launchApp(baseUrl, secretKey, appPath) {
  return proxyRequest('POST', baseUrl, '/quick', secretKey, {
    type: 'LAUNCH_APP',
    value: appPath,
    args: [appPath],
  });
}

export async function killApp(baseUrl, secretKey, processName) {
  return proxyRequest('POST', baseUrl, '/quick', secretKey, {
    type: 'KILL_APP',
    value: processName,
  });
}

export async function minimizeApp(baseUrl, secretKey, name) {
  return proxyRequest('POST', baseUrl, '/app/minimize', secretKey, { name });
}

export async function restoreApp(baseUrl, secretKey, name) {
  return proxyRequest('POST', baseUrl, '/app/restore', secretKey, { name });
}

// ── Constants (mirrors PcControlModels.kt) ─────────────────────────────────

export const PC_COMMON_KEYS = [
  'F1','F2','F3','F4','F5','F6','F7','F8','F9','F10','F11','F12',
  'ENTER','ESC','SPACE','TAB','BACKSPACE','DELETE',
  'UP','DOWN','LEFT','RIGHT','HOME','END','PAGE_UP','PAGE_DOWN',
  'CTRL+C','CTRL+V','CTRL+Z','CTRL+S','CTRL+A',
  'ALT+F4','ALT+TAB','WIN+D','WIN+L','WIN+R','WIN+E',
  'WIN+TAB','WIN+I','WIN+A','WIN+S','CTRL+SHIFT+ESC',
];

export const PC_SYSTEM_COMMANDS = [
  { id: 'LOCK', label: 'Lock PC', icon: '🔒' },
  { id: 'SLEEP', label: 'Sleep', icon: '😴' },
  { id: 'SHUTDOWN', label: 'Shutdown', icon: '⏻' },
  { id: 'RESTART', label: 'Restart', icon: '🔄' },
  { id: 'VOLUME_UP', label: 'Volume Up', icon: '🔊' },
  { id: 'VOLUME_DOWN', label: 'Volume Down', icon: '🔉' },
  { id: 'MUTE', label: 'Mute', icon: '🔇' },
  { id: 'SCREENSHOT', label: 'Screenshot', icon: '📸' },
  { id: 'TASK_MANAGER', label: 'Task Manager', icon: '📊' },
  { id: 'SETTINGS', label: 'Settings', icon: '⚙️' },
  { id: 'CONTROL_PANEL', label: 'Control Panel', icon: '🎛️' },
  { id: 'OPEN_URL', label: 'Open URL', icon: '🌐' },
];

export function getFileIcon(ext) {
  if (!ext) return '📄';
  const e = ext.toLowerCase();
  if (['mp4','mkv','avi','mov','wmv'].includes(e)) return '🎬';
  if (['mp3','wav','flac','aac','m4a'].includes(e)) return '🎵';
  if (['jpg','jpeg','png','gif','bmp','webp'].includes(e)) return '🖼️';
  if (e === 'pdf') return '📕';
  if (['doc','docx','rtf'].includes(e)) return '📘';
  if (['xls','xlsx','csv'].includes(e)) return '📗';
  if (['ppt','pptx'].includes(e)) return '📊';
  if (['py','bat','ps1','sh','cmd'].includes(e)) return '⚙️';
  if (['txt','log','md'].includes(e)) return '📄';
  if (['zip','rar','7z','tar','gz'].includes(e)) return '🗜️';
  if (['exe','msi'].includes(e)) return '🖥️';
  return '📂';
}

export function formatFileSize(kb) {
  if (kb < 1) return '0 KB';
  if (kb < 1024) return `${kb} KB`;
  if (kb < 1024 * 1024) return `${(kb / 1024).toFixed(1)} MB`;
  return `${(kb / (1024 * 1024)).toFixed(2)} GB`;
}
