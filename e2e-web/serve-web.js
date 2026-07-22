/* Static server for the exported web build (dist-web) with COOP/COEP so
 * wa-sqlite (expo-sqlite web) can use its OPFS/SharedArrayBuffer backend, and
 * correct .wasm MIME. Dev/CI only. Usage: node e2e-web/serve-web.js [dir] [port] */
const http = require('http');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', process.argv[2] || 'dist-web');
const PORT = Number(process.argv[3] || 8080);
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8', '.wasm':'application/wasm', '.ttf':'font/ttf', '.png':'image/png', '.ico':'image/x-icon', '.svg':'image/svg+xml', '.map':'application/json' };
http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  let filePath = path.join(ROOT, urlPath);
  if (urlPath === '/' || !path.extname(filePath)) filePath = path.join(ROOT, 'index.html');
  fs.readFile(filePath, (err, data) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    if (err) { res.statusCode = 404; res.end('Not found: ' + urlPath); return; }
    res.setHeader('Content-Type', MIME[path.extname(filePath)] || 'application/octet-stream');
    res.end(data);
  });
}).listen(PORT, () => console.log(`serving ${ROOT} on http://127.0.0.1:${PORT} (COOP/COEP on)`));
