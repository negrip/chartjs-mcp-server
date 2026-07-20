// Loader minimalista de .env (sin dependencias externas).
//
// Busca un archivo `.env` en la raíz del proyecto (un nivel arriba de dist/)
// y carga sus KEY=VALUE en process.env SIN pisar variables ya definidas —
// el entorno real (proxy, systemd, Docker, setx) siempre tiene prioridad.
//
// Formato soportado: líneas KEY=VALUE, comentarios con #, valores opcionalmente
// entre comillas simples o dobles. Suficiente para la configuración de este
// proyecto; no pretende ser un parser dotenv completo.

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

export function loadDotEnv(): void {
  try {
    const moduleDir = path.dirname(fileURLToPath(import.meta.url)); // .../dist
    const envPath = path.join(moduleDir, '..', '.env');             // raíz del proyecto
    if (!fs.existsSync(envPath)) return;

    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;

      const eq = line.indexOf('=');
      if (eq <= 0) continue;

      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();

      // Quitar comillas envolventes si las hay
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch {
    // Un .env malformado o ilegible nunca debe impedir el arranque del MCP.
  }
}
