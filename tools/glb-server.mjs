import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('public/assets/castle');
const PORT = 8799;
const FILE = 'cathedral.glb';

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/' + FILE || url === '/cathedral.glb') {
    const fp = path.join(ROOT, FILE);
    if (!fs.existsSync(fp)) { res.writeHead(404); res.end('not found'); return; }
    const stat = fs.statSync(fp);
    const range = req.headers.range;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', 'model/gltf-binary');
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      const start = m && m[1] ? parseInt(m[1], 10) : 0;
      const end = m && m[2] ? parseInt(m[2], 10) : stat.size - 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Content-Length': end - start + 1,
      });
      fs.createReadStream(fp, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { 'Content-Length': stat.size });
      fs.createReadStream(fp).pipe(res);
    }
  } else {
    res.writeHead(404); res.end('nope');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[glb-server] serving ${FILE} on :${PORT} (CORS *)`);
});
