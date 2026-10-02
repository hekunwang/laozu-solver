'use strict';
// Optional local preview. No packages, no LAN listener, no game connection.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (pathname !== '/' && pathname !== '/index.html') { res.writeHead(404); res.end(); return; }
  res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'});
  res.end(fs.readFileSync(path.join(root, 'index.html')));
}).listen(18764, '127.0.0.1', () => console.log('http://127.0.0.1:18764'));
