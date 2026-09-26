// ═══════════════════════════════════════════════════════════════════════════
// production-server.mjs
// ─────────────────────────────────────────────────────────────────────────
// Standalone Node server for hosting the built `dist/` folder on the LAN.
// This is the file `npm run serve` / `npm run start` expects (see package.json).
//
// It does two things that a plain static file server (e.g. `serve dist`)
// does NOT do, both required by the app:
//   1. Serves the Vite production build from ./dist
//   2. Proxies /pcproxy/<ip>/<port>/... to the target PC agent, and
//      /tvproxy/<ip>/<port>/... to the target Samsung TV's REST endpoints —
//      the same relay Vite's dev server provides via vite.config.js, needed
//      because neither the PC agent nor the TV sends CORS headers.
//
// Usage:
//   npm run build
//   npm run serve        (or: node production-server.mjs)
//   → http://<this-machine-ip>:5008
// ═══════════════════════════════════════════════════════════════════════════

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR  = path.join(__dirname, 'dist');
const PORT      = process.env.PORT || 5008;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
};

// ── Generic relay used by both /pcproxy/ and /tvproxy/ ─────────────────────
function relay(req, res, prefix, defaultTimeout) {
  const stripped = req.url.slice(prefix.length);
  const parts = stripped.split('/');
  if (parts.length < 3) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Invalid proxy URL. Use ${prefix}<ip>/<port>/<path>` }));
    return;
  }

  const targetIp   = parts[0];
  const targetPort = parts[1];
  // Basic SSRF guard — only allow hostname/IP-looking targets, same rule the
  // client-side API modules already enforce before ever reaching here.
  if (!/^[\w.-]+$/.test(targetIp)) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Rejected suspicious target IP' }));
    return;
  }

  const pathAndQuery = '/' + parts.slice(2).join('/');
  const targetUrl = `http://${targetIp}:${targetPort}${pathAndQuery}`;
  let parsed;
  try { parsed = new URL(targetUrl); } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid target URL' }));
    return;
  }

  const bodyChunks = [];
  req.on('data', chunk => bodyChunks.push(chunk));
  req.on('end', () => {
    const body = bodyChunks.length > 0 ? Buffer.concat(bodyChunks) : null;
    const headers = { ...req.headers, host: `${targetIp}:${targetPort}` };
    delete headers['origin'];
    delete headers['referer'];
    delete headers['sec-fetch-mode'];
    delete headers['sec-fetch-site'];
    delete headers['sec-fetch-dest'];

    let responded = false;

    const proxyReq = http.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: req.method,
      headers,
      timeout: defaultTimeout,
    }, (proxyRes) => {
      if (responded || res.headersSent) return;
      responded = true;
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', '*');
      res.setHeader('Access-Control-Allow-Headers', '*');
      res.writeHead(proxyRes.statusCode, Object.fromEntries(
        Object.entries(proxyRes.headers).filter(([k]) => k.toLowerCase() !== 'transfer-encoding'),
      ));
      proxyRes.pipe(res);
    });

    // 'timeout' fires first and destroys the socket, which then also emits
    // 'error' — only the first of the two should ever write a response.
    proxyReq.on('error', (err) => {
      if (responded || res.headersSent) return;
      responded = true;
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to connect to target', detail: err.message, target: targetUrl }));
    });
    proxyReq.on('timeout', () => {
      proxyReq.destroy();
      if (responded || res.headersSent) return;
      responded = true;
      res.writeHead(504, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Connection timed out', target: targetUrl }));
    });

    if (body) proxyReq.write(body);
    proxyReq.end();
  });
}

// ── Static file serving with SPA fallback (client-side routing) ────────────
function serveStatic(req, res) {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  let filePath = path.join(DIST_DIR, urlPath === '/' ? 'index.html' : urlPath);

  // Prevent path traversal outside dist/
  if (!filePath.startsWith(DIST_DIR)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      // SPA fallback — let React Router handle the route client-side
      filePath = path.join(DIST_DIR, 'index.html');
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS' && (req.url.startsWith('/pcproxy/') || req.url.startsWith('/tvproxy/'))) {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Max-Age': '86400',
    });
    res.end();
    return;
  }

  if (req.url.startsWith('/pcproxy/')) return relay(req, res, '/pcproxy/', 15000);
  if (req.url.startsWith('/tvproxy/')) return relay(req, res, '/tvproxy/', 6000);

  serveStatic(req, res);
});

if (!fs.existsSync(DIST_DIR)) {
  console.error(`[production-server] dist/ not found — run "npm run build" first.`);
  process.exit(1);
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Web Admin production server running:`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`  Serving:  ${DIST_DIR}`);
  console.log(`  Proxies:  /pcproxy/<ip>/<port>/...  and  /tvproxy/<ip>/<port>/...`);
});
