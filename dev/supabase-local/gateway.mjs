// Local gateway: serves the Supabase URL shape (/auth/v1, /rest/v1) on http://127.0.0.1:54321, like a real project.
// Development and tests only.
import http from 'node:http'

const ROUTES = [
  ['/auth/v1', 'http://127.0.0.1:9999'],
  ['/rest/v1', 'http://127.0.0.1:3001'],
]
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info, prefer, accept-profile, content-profile, range, x-supabase-api-version',
  'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'access-control-expose-headers': 'content-range, x-supabase-api-version',
}
http
  .createServer((req, res) => {
    if (req.method === 'OPTIONS') return res.writeHead(204, cors).end()
    const r = ROUTES.find(([p]) => req.url.startsWith(p + '/') || req.url === p)
    if (!r) return res.writeHead(404, cors).end('not found')
    const target = new URL(r[1] + (req.url.slice(r[0].length) || '/'))
    const up = http.request(target, { method: req.method, headers: { ...req.headers, host: target.host } }, (u) => {
      res.writeHead(u.statusCode, { ...u.headers, ...cors })
      u.pipe(res)
    })
    up.on('error', (e) => res.writeHead(502, cors).end(String(e)))
    req.pipe(up)
  })
  .listen(54321, '127.0.0.1', () => console.log('local Supabase gateway on http://127.0.0.1:54321'))
