import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import http from 'http'
import https from 'https'
import { URL } from 'url'

/**
 * Custom Vite plugin that creates a local proxy for PC Agent requests.
 *
 * WHY: Browsers enforce Same-Origin Policy (CORS). The PC Agent on
 * 192.168.x.x:5000 doesn't send CORS headers, so the browser blocks
 * direct fetch() calls from the web app.
 *
 * HOW: The web app sends requests to its OWN origin at /pcproxy/...
 * and this middleware forwards them to the actual PC Agent. Since the
 * Vite dev server runs on YOUR machine, this is still direct
 * source-computer → destination-computer communication — no remote
 * server involved.
 *
 * Route format: /pcproxy/<ip>/<port>/rest/of/path?query
 * Example:      /pcproxy/192.168.1.5/5000/ping
 */
function pcProxyPlugin() {
  return {
    name: 'pc-agent-proxy',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        // Only handle /pcproxy/ routes
        if (!req.url.startsWith('/pcproxy/')) return next()

        // Parse: /pcproxy/<ip>/<port>/<path>
        const stripped = req.url.slice('/pcproxy/'.length)
        const parts = stripped.split('/')
        if (parts.length < 3) {
          res.statusCode = 400
          res.end(JSON.stringify({ error: 'Invalid proxy URL. Use /pcproxy/<ip>/<port>/<path>' }))
          return
        }

        const targetIp = parts[0]
        const targetPort = parts[1]
        const pathAndQuery = '/' + parts.slice(2).join('/')
        const targetUrl = `http://${targetIp}:${targetPort}${pathAndQuery}`

        // Collect request body
        const bodyChunks = []
        req.on('data', chunk => bodyChunks.push(chunk))
        req.on('end', () => {
          const body = bodyChunks.length > 0 ? Buffer.concat(bodyChunks) : null

          const parsed = new URL(targetUrl)
          const options = {
            hostname: parsed.hostname,
            port: parsed.port,
            path: parsed.pathname + parsed.search,
            method: req.method,
            headers: {
              ...req.headers,
              host: `${targetIp}:${targetPort}`,
            },
            timeout: 15000,
          }
          // Remove browser-specific headers that cause issues
          delete options.headers['origin']
          delete options.headers['referer']
          delete options.headers['sec-fetch-mode']
          delete options.headers['sec-fetch-site']
          delete options.headers['sec-fetch-dest']

          const proxyReq = http.request(options, (proxyRes) => {
            // Add CORS headers so browser accepts the response
            res.setHeader('Access-Control-Allow-Origin', '*')
            res.setHeader('Access-Control-Allow-Methods', '*')
            res.setHeader('Access-Control-Allow-Headers', '*')
            res.statusCode = proxyRes.statusCode
            // Forward response headers
            Object.entries(proxyRes.headers).forEach(([key, value]) => {
              if (key.toLowerCase() !== 'transfer-encoding') {
                res.setHeader(key, value)
              }
            })
            proxyRes.pipe(res)
          })

          proxyReq.on('error', (err) => {
            res.statusCode = 502
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({
              error: 'Failed to connect to PC Agent',
              detail: err.message,
              target: targetUrl
            }))
          })

          proxyReq.on('timeout', () => {
            proxyReq.destroy()
            res.statusCode = 504
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'Connection timed out', target: targetUrl }))
          })

          if (body) proxyReq.write(body)
          proxyReq.end()
        })
      })

      // Handle CORS preflight for the proxy routes
      server.middlewares.use((req, res, next) => {
        if (req.method === 'OPTIONS' && req.url.startsWith('/pcproxy/')) {
          res.setHeader('Access-Control-Allow-Origin', '*')
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
          res.setHeader('Access-Control-Allow-Headers', '*')
          res.setHeader('Access-Control-Max-Age', '86400')
          res.statusCode = 204
          res.end()
          return
        }
        next()
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    pcProxyPlugin(),
  ],
})
