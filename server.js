const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { handleApi } = require('./controller/hotelController');

const ROOT = __dirname;
const VIEW_DIR = path.join(ROOT, 'view');
const PORT = Number(process.env.PORT) || 3000;
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': CONTENT_TYPES['.json'], 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname.startsWith('/api/')) {
    try {
      await handleApi(req, res, url);
    } catch (error) {
      console.error(error);
      sendJson(res, error.status || 500, { error: error.message || 'Đã có lỗi xảy ra.' });
    }
    return;
  }

  const requestedPath = url.pathname === '/' ? 'index.html' : url.pathname === '/rooms' ? 'rooms.html' : url.pathname === '/customers' ? 'customers.html' : decodeURIComponent(url.pathname.slice(1));
  const resolvedPath = path.resolve(VIEW_DIR, requestedPath);
  if (!resolvedPath.startsWith(`${VIEW_DIR}${path.sep}`) && resolvedPath !== path.join(VIEW_DIR, 'index.html')) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  try {
    const content = await fs.readFile(resolvedPath);
    res.writeHead(200, {
      'Content-Type': CONTENT_TYPES[path.extname(resolvedPath)] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(content);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Không tìm thấy trang.');
  }
});

server.listen(PORT, () => {
  console.log(`Mây Retreat đang chạy tại http://localhost:${PORT}`);
});
