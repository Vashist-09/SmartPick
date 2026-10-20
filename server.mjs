import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = new URL('./', import.meta.url);
const files = { '/': ['index.html', 'text/html'], '/src/app.js': ['src/app.js', 'text/javascript'], '/src/data.js': ['src/data.js', 'text/javascript'], '/src/styles.css': ['src/styles.css', 'text/css'] };
const server = http.createServer(async (req, res) => {
  const entry = files[new URL(req.url, 'http://localhost').pathname];
  if (!entry) { res.writeHead(404); res.end('Not found'); return; }
  try { res.writeHead(200, { 'Content-Type': `${entry[1]}; charset=utf-8` }); res.end(await readFile(fileURLToPath(new URL(entry[0], root)))); }
  catch { res.writeHead(500); res.end('Unable to load app'); }
});
server.listen(Number(process.env.PORT) || 5173, '127.0.0.1', () => console.log(`SmartPick: http://localhost:${server.address().port}`));
