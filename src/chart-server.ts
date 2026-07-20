// Mini servidor HTTP embebido en el proceso del MCP para servir los charts
// interactivos generados. El agente devuelve un link a este servidor y el
// usuario lo abre en su navegador (misma máquina en la POC, o vía red cuando
// el MCP corre en un server).
//
// Seguridad:
// - Solo GET. Sin listado de directorio. Sin path traversal (el nombre del
//   archivo se valida con un patrón estricto y se resuelve SOLO dentro del
//   directorio de charts).
// - Los nombres de archivo llevan un ID aleatorio de 16 chars (capability
//   URL): un tercero no puede enumerar/adivinar los links.
// - Cache-Control: no-store para que proxies intermedios no retengan datos.
// - Por defecto escucha SOLO en 127.0.0.1. Para exponerlo en red se debe
//   setear CHARTS_HTTP_HOST=0.0.0.0 explícitamente (ver README de deploy).

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const DEFAULT_PORT = 8123;
const MAX_PORT_ATTEMPTS = 10;

// Nombre válido: chart-<id aleatorio>.html (sin puntos extra, sin slashes)
const CHART_NAME_PATTERN = /^chart-[A-Za-z0-9]{16}\.html$/;

let serverInstance: http.Server | null = null;
let boundPort: number | null = null;
let startPromise: Promise<number> | null = null;

export function getChartsDir(): string {
  return process.env.CHARTS_OUTPUT_DIR || path.join(os.tmpdir(), 'chartjs-mcp-charts');
}

function getHost(): string {
  return process.env.CHARTS_HTTP_HOST || '127.0.0.1';
}

function getConfiguredPort(): number {
  const p = parseInt(process.env.CHARTS_HTTP_PORT || '', 10);
  return Number.isInteger(p) && p > 0 && p < 65536 ? p : DEFAULT_PORT;
}

// Base URL pública que va en los links. En la POC es el localhost del mismo
// equipo; cuando el MCP corre en un server, setear CHARTS_BASE_URL con la URL
// que los navegadores de los clientes pueden alcanzar (idealmente HTTPS detrás
// de un reverse proxy).
export function getBaseUrl(): string {
  const explicit = process.env.CHARTS_BASE_URL;
  if (explicit) return explicit.replace(/\/+$/, '');
  const port = boundPort ?? getConfiguredPort();
  return `http://localhost:${port}`;
}

function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'text/plain' });
    res.end('Method Not Allowed');
    return;
  }

  const url = new URL(req.url || '/', 'http://localhost');
  const match = url.pathname.match(/^\/charts\/([^/]+)$/);
  const name = match ? match[1] : null;

  if (!name || !CHART_NAME_PATTERN.test(name)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
    return;
  }

  const chartsDir = path.resolve(getChartsDir());
  const filePath = path.resolve(chartsDir, name);

  // Defensa en profundidad: además del patrón, verificamos que el path
  // resuelto quede dentro del directorio de charts.
  if (!filePath.startsWith(chartsDir + path.sep)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': data.length,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff'
    });
    res.end(data);
  });
}

function tryListen(port: number, host: string): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const srv = http.createServer(handleRequest);
    srv.once('error', reject);
    srv.listen(port, host, () => {
      srv.removeAllListeners('error');
      // Si el proceso del MCP muere, el server muere con él (no mantenemos
      // el event loop vivo solo por esto).
      srv.unref();
      resolve(srv);
    });
  });
}

// Levanta el servidor si no está corriendo. Prueba el puerto configurado y,
// si está ocupado, los siguientes MAX_PORT_ATTEMPTS-1. Devuelve el puerto.
export async function ensureChartServer(): Promise<number> {
  if (boundPort !== null) return boundPort;
  if (startPromise) return startPromise;

  startPromise = (async () => {
    const host = getHost();
    const basePort = getConfiguredPort();
    let lastError: unknown = null;
    for (let i = 0; i < MAX_PORT_ATTEMPTS; i++) {
      const port = basePort + i;
      try {
        serverInstance = await tryListen(port, host);
        boundPort = port;
        return port;
      } catch (err) {
        lastError = err;
      }
    }
    startPromise = null;
    throw new Error(`No se pudo iniciar el servidor de charts en los puertos ${basePort}-${basePort + MAX_PORT_ATTEMPTS - 1}: ${lastError}`);
  })();

  return startPromise;
}

// Política de retención: conservar como máximo N charts, borrar los más viejos.
const MAX_CHARTS = parseInt(process.env.CHARTS_MAX_FILES || '50', 10);

export function cleanupOldCharts(): void {
  try {
    const dir = getChartsDir();
    const files = fs.readdirSync(dir)
      .filter(f => CHART_NAME_PATTERN.test(f))
      .map(f => {
        const full = path.join(dir, f);
        return { full, mtime: fs.statSync(full).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);

    for (const f of files.slice(MAX_CHARTS)) {
      try { fs.unlinkSync(f.full); } catch { /* mejor esfuerzo */ }
    }
  } catch {
    // La limpieza nunca debe romper la generación del chart.
  }
}
