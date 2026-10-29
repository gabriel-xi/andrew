import http from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb } from './db.js';
import { currentUser } from '../Routes/middleware/auth.js';
import registerAppRoutes from '../Routes/app.js';
import registerLoginRoutes from '../Routes/login.js';
import registerRegisterRoutes from '../Routes/register.js';
import registerMeRoutes from '../Routes/me.js';
import registerCalendarRoutes from '../Routes/calendar.js';
import registerCourseRoutes from '../Routes/courses.js';
import registerTutorRoutes from '../Routes/tutors.js';
import registerDatabaseRoutes from '../Routes/db.js';
import registerContractRoutes from '../Routes/contracts.js';
import registerDocumentRoutes from '../Routes/documents.js';
import registerReportRoutes from '../Routes/reports.js';
import registerImportExportRoutes from '../Routes/importExport.js';
import registerTimecardRoutes from '../Routes/timecards.js';
import registerCourseCalendarRoutes from '../Routes/courseCalendars.js';

const publicDir = resolve(fileURLToPath(new URL('../public/', import.meta.url)));
const mime = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.js':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8',
  '.svg':'image/svg+xml', '.png':'image/png', '.ico':'image/x-icon' };

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function send(res, status, data) {
  res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff' });
  res.end(JSON.stringify(data));
}
export async function readJson(req) {
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
    throw new HttpError(415, 'È richiesto Content-Type: application/json');
  }
  let length = 0;
  const chunks = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 256 * 1024) throw new HttpError(413, 'Richiesta troppo grande');
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (value === null || Array.isArray(value) || typeof value !== 'object') throw new Error();
    return value;
  } catch { throw new HttpError(400, 'JSON non valido'); }
}

export function makeRouter() {
  const definitions = [];
  return {
    add(method, pattern, handler, access='user') {
      const names = [...pattern.matchAll(/:([a-zA-Z_]+)/g)].map(x => x[1]);
      const regexp = new RegExp('^' + pattern.replace(/:[a-zA-Z_]+/g, '([^/]+)') + '$');
      definitions.push({ method, regexp, names, handler, access });
    },
    async dispatch(req, res, pathname, url) {
      const entry = definitions.find(route => route.method === req.method && route.regexp.test(pathname));
      if (!entry) throw new HttpError(404, 'API non trovata');
      const match = pathname.match(entry.regexp);
      const params = Object.fromEntries(entry.names.map((name, i) => [name, match[i+1]]));
      const db = getDb();
      const user = currentUser(req, db);
      if (entry.access !== 'public' && !user) throw new HttpError(401, 'Autenticazione richiesta');
      if (entry.access === 'admin' && user.role !== 'admin') throw new HttpError(403, 'Riservato all’amministratore');
      const ctx = { req, res, db, user, params, query:url.searchParams, body:() => readJson(req),
        send: (status, data) => send(res, status, data) };
      await entry.handler(ctx);
    }
  };
}
const router = makeRouter();
for (const register of [
  registerAppRoutes,registerLoginRoutes,registerRegisterRoutes,registerMeRoutes,
  registerCalendarRoutes,registerCourseRoutes,registerTutorRoutes,registerDatabaseRoutes,
  registerContractRoutes,registerDocumentRoutes,registerReportRoutes,registerImportExportRoutes,registerTimecardRoutes,registerCourseCalendarRoutes
]) register(router);

async function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Metodo non consentito');
  const pages = { '/':'index.html' };
  const requested = pages[pathname] || pathname.replace(/^\/+/, '');
  const absolute = resolve(publicDir, requested);
  if (!absolute.startsWith(publicDir + sep)) throw new HttpError(403, 'Percorso non valido');
  let real;
  try { real = await realpath(absolute); } catch { throw new HttpError(404, 'Pagina non trovata'); }
  if (!real.startsWith(publicDir + sep)) throw new HttpError(403, 'Percorso non valido');
  let content;
  try { content = await readFile(real); } catch { throw new HttpError(404, 'Pagina non trovata'); }
  res.writeHead(200, { 'Content-Type':mime[extname(real)] || 'application/octet-stream',
    'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff' });
  res.end(req.method === 'HEAD' ? undefined : content);
}
export function createServer() {
  return http.createServer(async (req, res) => {
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    try {
      const url = new URL(req.url, 'http://localhost');
      const pathname = decodeURIComponent(url.pathname);
      if (pathname.startsWith('/api/')) {
        if (!['GET','HEAD','OPTIONS'].includes(req.method) && req.headers.origin) {
          const origin = new URL(req.headers.origin);
          if (origin.host !== req.headers.host || !['http:','https:'].includes(origin.protocol)) {
            throw new HttpError(403, 'Origine richiesta non autorizzata');
          }
        }
        await router.dispatch(req, res, pathname, url);
      } else await serveStatic(req, res, pathname);
    } catch (error) {
      if (!res.headersSent) {
        const status = error.status || 500;
        if (status >= 500) console.error(error);
        send(res, status, { status:'error', message:status >= 500 ? 'Errore interno' : error.message });
      }
    }
  });
}
