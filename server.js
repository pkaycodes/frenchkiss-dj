'use strict';

/**
 * FrenchKiss DJ — tiny static site server + two form endpoints.
 * No dependencies. Node 18+ (uses the global fetch-free http module).
 *
 *   GET  /*                → files in this folder
 *   POST /api/booking      → appends to data/bookings.jsonl
 *   POST /api/newsletter   → appends unique emails to data/subscribers.jsonl
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const MAX_BODY = 32 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8'
};

/* ── very small in-memory rate limit ─────────────────────── */
const hits = new Map();
const WINDOW = 10 * 60 * 1000;
const LIMIT = 8;

function rateLimited(ip) {
  const now = Date.now();
  const entry = hits.get(ip) || { count: 0, start: now };
  if (now - entry.start > WINDOW) {
    entry.count = 0;
    entry.start = now;
  }
  entry.count += 1;
  hits.set(ip, entry);
  if (hits.size > 5000) hits.clear();
  return entry.count > LIMIT;
}

/* ── helpers ─────────────────────────────────────────────── */
function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('Payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (_) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function appendLine(file, line) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.appendFileSync(path.join(DATA_DIR, file), line + '\n', 'utf8');
}

function clean(value, max) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

/* ── API ─────────────────────────────────────────────────── */
async function handleApi(req, res, pathname) {
  if (req.method !== 'POST') {
    json(res, 405, { error: 'Method not allowed' });
    return;
  }
  if (rateLimited(clientIp(req))) {
    json(res, 429, { error: 'Too many requests — please try again in a few minutes.' });
    return;
  }

  let body;
  try {
    body = await readBody(req);
  } catch (err) {
    json(res, err.message === 'Payload too large' ? 413 : 400, { error: 'Could not read that request.' });
    return;
  }

  if (pathname === '/api/booking') {
    if (clean(body.website, 50)) { // honeypot
      json(res, 200, { ok: true });
      return;
    }
    const record = {
      at: new Date().toISOString(),
      name: clean(body.name, 120),
      email: clean(body.email, 180),
      date: clean(body.date, 40),
      venue: clean(body.venue, 160),
      type: clean(body.type, 40),
      budget: clean(body.budget, 40),
      message: clean(body.message, 4000)
    };

    if (record.name.length < 2) return json(res, 400, { error: 'Please add your name.' });
    if (!EMAIL_RE.test(record.email)) return json(res, 400, { error: 'Please add a valid email address.' });
    if (record.message.length < 10) return json(res, 400, { error: 'Please add a few more details about the event.' });

    appendLine('bookings.jsonl', JSON.stringify(record));
    console.log(`[booking] ${record.date || 'no date'} · ${record.venue || 'no venue'} · ${record.name} <${record.email}>`);
    json(res, 200, { ok: true });
    return;
  }

  if (pathname === '/api/newsletter') {
    const email = clean(body.email, 180).toLowerCase();
    if (!EMAIL_RE.test(email)) return json(res, 400, { error: 'Enter a valid email address.' });

    let existing = '';
    try {
      existing = fs.readFileSync(path.join(DATA_DIR, 'subscribers.jsonl'), 'utf8');
    } catch (_) { /* first subscriber */ }

    if (!existing.includes(`"${email}"`)) {
      appendLine('subscribers.jsonl', JSON.stringify({ at: new Date().toISOString(), email }));
      console.log(`[newsletter] +1 subscriber`);
    }
    json(res, 200, { ok: true });
    return;
  }

  json(res, 404, { error: 'Not found' });
}

/* ── static files ────────────────────────────────────────── */
function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    res.end();
    return;
  }

  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch (_) {
    res.writeHead(400);
    res.end('Bad request');
    return;
  }

  if (rel === '/' || rel === '') rel = '/index.html';

  // never expose submissions or dotfiles
  if (rel.startsWith('/data') || rel.split('/').some((part) => part.startsWith('.'))) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

  const filePath = path.join(ROOT, path.normalize(rel));
  if (!filePath.startsWith(ROOT + path.sep)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      send404(res, req.method === 'HEAD');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': ['.html', '.css', '.js'].includes(ext)
        ? 'no-cache'
        : 'public, max-age=86400'
    };
    headers['X-Content-Type-Options'] = 'nosniff';
    headers['Referrer-Policy'] = 'strict-origin-when-cross-origin';
    res.writeHead(200, headers);
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(filePath).pipe(res);
  });
}

function send404(res, isHead) {
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>404 — FrenchKiss DJ</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0A0A0A;color:#F2EDE4;
font-family:Arial,Helvetica,sans-serif;text-align:center;padding:2rem}h1{font-size:clamp(4rem,18vw,10rem);
margin:0;line-height:.8;letter-spacing:-.02em}p{color:#8E877B;margin:1.2rem 0 2rem}a{color:#FF3B26;
text-transform:uppercase;letter-spacing:.18em;font-size:.75rem;text-decoration:none;border-bottom:1px solid #FF3B26;padding-bottom:.35rem}</style>
</head><body><main><h1>404</h1><p>That track isn't in the crate.</p><a href="/">Back to the booth</a></main></body></html>`;
  res.writeHead(404, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(isHead ? undefined : body);
}

/* ── server ──────────────────────────────────────────────── */
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  if (pathname.startsWith('/api/')) {
    handleApi(req, res, pathname).catch((err) => {
      console.error('[api]', err);
      if (!res.headersSent) json(res, 500, { error: 'Server error. Please try again.' });
    });
    return;
  }

  serveStatic(req, res, pathname);
});

server.listen(PORT, HOST, () => {
  console.log(`FrenchKiss DJ — http://localhost:${PORT}`);
});
