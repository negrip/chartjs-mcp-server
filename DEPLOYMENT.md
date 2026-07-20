# ChartJS MCP Server — Guía de despliegue e integración

MCP (Model Context Protocol) server que genera gráficos Chart.js v4 para agentes de IA.
Pensado para integrarse con **Globant Enterprise AI (GEAI)** a través de su proxy MCP,
aunque funciona con cualquier cliente MCP estándar. Fork de
[`@ax-crew/chartjs-mcp-server`](https://github.com/ax-crew/chartjs-mcp-server) adaptado
para entornos donde la UI del chat no permite embeber imágenes (CSP estricto).

## Qué hace

Un agente (por ejemplo, un analista de datos que consulta una base) llama a la tool
`generateChart` con una configuración Chart.js v4 armada a partir de datos reales. El MCP:

1. Renderiza y valida el gráfico server-side (node-canvas).
2. Guarda una **página HTML interactiva** (Chart.js embebido, self-contained, sin CDN)
   en un directorio local.
3. Sirve esa página desde un **servidor HTTP embebido** en el mismo proceso.
4. Devuelve al agente un **link markdown clickeable** cuyo texto es el título del gráfico:

   ```
   📈 [Ventas por trimestre — 2026](http://localhost:8123/charts/chart-U7pXnxRKq087ou18.html)
   ```

El usuario hace click en el chat y el gráfico se abre a pantalla completa en su
navegador, con tooltips y leyendas interactivas. Tip: con Ctrl+click se abre en una
pestaña nueva sin salir de la conversación.

### Por qué un link y no una imagen embebida

Muchas UIs de chat empresariales aplican un CSP estricto a las imágenes
(`img-src 'self' data: blob: ...` con whitelist de dominios) y además:

- Data URIs PNG solo renderizan inline hasta cierto tamaño (~15 KB), con streaming
  lento del base64 en pantalla.
- Data URIs SVG dentro de `<img>` suelen no renderizar.
- HTML crudo se elimina (sanitizer).
- URLs de imagen externas quedan bloqueadas por CSP.

Un **link** en cambio es navegación top-level: no pasa por `img-src` y abre en pestaña
nueva sin restricciones.

## Arquitectura

```
Usuario (navegador)
   │  chat                                  click en el link ─────────────┐
   ▼                                                                      ▼
UI del chat (cloud) ──► Agente ──► Plataforma ──► Proxy MCP (local/server) ──► HTTP :8123
                                                   │  stdio                   (charts)
                                                   ▼
                                             ChartJS MCP (este proyecto)
                                                   │
                                                   ▼
                                          CHARTS_OUTPUT_DIR/*.html
```

El proxy MCP y este server corren en la **misma máquina** (la PC del desarrollador
durante el desarrollo; un servidor en producción). El servidor HTTP embebido corre
dentro del proceso del MCP y vive mientras viva el proxy.

## Requisitos

- **Node.js >= 18**
- **Windows / Linux / macOS** (node-canvas y sharp traen binarios precompilados para
  las plataformas comunes)
- Un cliente MCP (proxy GEAI o cualquier cliente MCP estándar)
- Los navegadores de los usuarios deben poder alcanzar el puerto del chart server
  (en desarrollo: el mismo equipo; en producción: ver [Despliegue en servidor](#despliegue-en-servidor))

## Instalación

```bash
git clone <este-repo>
cd <repo>
npm install
npm run build        # compila TypeScript a dist/
```

Prueba rápida standalone (sin plataforma):

```bash
node dist/index.js   # queda esperando JSON-RPC por stdin — Ctrl+C para salir
```

## Configuración

La forma recomendada es un archivo **`.env`** en la raíz del proyecto:

```bash
cp .env.example .env    # y editar los valores
```

El `.env` no se versiona (está en `.gitignore`). Las variables definidas en el
entorno real (terminal, servicio, Docker, config del proxy) tienen prioridad
sobre el archivo.

| Variable | Default | Descripción |
|---|---|---|
| `CHARTS_OUTPUT_DIR` | `<temp del sistema>/chartjs-mcp-charts` | Directorio donde se guardan los HTML de los gráficos |
| `CHARTS_HTTP_HOST` | `127.0.0.1` | Interfaz de escucha del server. `0.0.0.0` para exponer en red |
| `CHARTS_HTTP_PORT` | `8123` | Puerto del server (si está ocupado prueba hasta +9) |
| `CHARTS_BASE_URL` | `http://localhost:<puerto>` | URL base que va en los links. **Obligatoria en producción** |
| `CHARTS_MAX_FILES` | `50` | Retención: se conservan los N gráficos más recientes |

## Integración con GEAI (Globant Enterprise AI)

### 1. Registrar el MCP en el proxy

En el JSON de configuración del proxy GEAI:

```json
{
  "mcpServers": {
    "ChartJS": {
      "command": "node",
      "args": ["/ruta/a/dist/index.js"]
    }
  }
}
```

Al reiniciar el proxy, la tool queda registrada como **`ChartJS__generatechart`**
(el proxy normaliza el nombre a minúsculas).

### 2. Cargar los parámetros de la tool en GEAI

En la consola de Globant.AI: *Integrations → ChartJS → Tool Parameters*. El proxy no
propaga el schema completo, así que los parámetros se cargan a mano:

| Key | Type | Data Type | Required |
|---|---|---|---|
| `chartConfig` | Application | **String** | ✅ |
| `outputFormat` | Application | String | ✅ |

Notas importantes:

- **Ambos parámetros deben quedar Required.** GEAI envía el schema al LLM con
  `strict: true`, y OpenAI exige que todo parámetro declarado esté en `required`.
- **`chartConfig` va como String, no Json.** El Data Type "Json" de GEAI genera
  `"type": "json"` en el schema, que el proveedor LLM rechaza. El MCP acepta el config
  como JSON string y lo parsea internamente.
- Truco de la UI: si el checkbox Required aparece deshabilitado con Type=Application,
  seleccioná primero otro Type, marcá Required y volvé a Application.

### 3. Adjuntar la tool al agente

En el agente (resource pool), agregar `ChartJS__generatechart` junto a las demás tools.

### 4. Instrucciones del agente (prompt)

El agente debe: (a) obtener los datos reales, (b) armar el `chartConfig` con esos
valores, (c) llamar a la tool, y (d) **reproducir el link tal cual** lo devuelve la
tool. Bloque sugerido para las instrucciones:

```
# Chart tool
You have a tool `ChartJS__generatechart` that renders an interactive chart and
returns a markdown link to open it in the browser.
- ALWAYS fill both parameters: `chartConfig` (JSON of the Chart.js v4 config)
  and `outputFormat` ("interactive").
- NEVER call the tool with empty arguments. Never invent data: build the config
  only from real results.
- Give every chart a descriptive title in options.plugins.title.text — it becomes
  the link text the user sees.
- After the tool returns, your response MUST include the returned markdown link
  EXACTLY as-is (the `📈 [...](...)` line), followed by one short sentence
  interpreting the chart.
```

### Varios gráficos en una respuesta

La tool es stateless: una llamada = un gráfico = un link. Si el usuario pide, por
ejemplo, los mismos datos en barras y en torta, el agente llama a la tool dos veces
(un `chartConfig` por tipo) y la respuesta incluye dos links, cada uno con el título
de su gráfico. Verificar que el `maxRuns` del agente admita la cantidad de llamadas
(consulta de datos + una por gráfico).

## Despliegue en servidor

Cuando el proxy + MCP corren en un servidor y los usuarios acceden desde sus equipos:

1. **Exponer el server**: `CHARTS_HTTP_HOST=0.0.0.0` (o dejar `127.0.0.1` y publicar
   vía reverse proxy, recomendado).
2. **Configurar la URL pública**: `CHARTS_BASE_URL=https://charts.midominio.com`
   (la URL que los navegadores de los clientes pueden alcanzar). Sin esto los links
   dirían `localhost` y solo funcionarían en el propio servidor.
3. **HTTPS**: el server embebido habla HTTP plano. En producción ponerlo detrás de un
   reverse proxy con TLS (nginx, Caddy, IIS con ARR):

   ```nginx
   server {
     listen 443 ssl;
     server_name charts.midominio.com;
     location /charts/ {
       proxy_pass http://127.0.0.1:8123/charts/;
     }
   }
   ```

4. **Firewall**: permitir el puerto elegido (o el 443 del reverse proxy) desde las
   redes de los usuarios.

## Seguridad

- **Links no adivinables**: cada gráfico recibe un ID aleatorio de 16 caracteres
  (~89 bits de entropía). Sin el link exacto no se puede acceder ni enumerar gráficos.
  Es el modelo "cualquiera con el link" — si se necesita autenticación real por
  usuario, debe resolverse en el reverse proxy (SSO, IP allowlist, etc.).
- **Superficie mínima**: el server solo responde `GET /charts/<nombre-válido>`.
  Sin listado de directorio, sin otros métodos, con validación estricta del nombre y
  chequeo del path resuelto (sin path traversal).
- **Sin caching intermedio**: responde `Cache-Control: private, no-store`.
- **Escapes**: título y configuración se escapan para impedir inyección de HTML/JS en
  la página generada.
- **Retención**: los gráficos viejos se borran automáticamente (`CHARTS_MAX_FILES`),
  acotando la exposición histórica de datos.
- El bind por defecto es `127.0.0.1`: exponer a la red es una decisión explícita.

## API de la tool

`generateChart(chartConfig, outputFormat?)`

- `chartConfig` (object | JSON string, requerido): configuración completa Chart.js v4.
  Tipos soportados: `bar`, `line`, `pie`, `doughnut`, `scatter`, `bubble`, `polarArea`, `radar`.
- `outputFormat` (`"interactive"` | `"png"` | `"html"` | `"json"` | `"svg"`, default `"interactive"`):
  - `interactive` — **flujo principal para agentes de chat.** Renderiza el gráfico
    (validación real del config vía node-canvas), guarda la página HTML interactiva
    y devuelve el **link markdown** cuyo texto es el título del gráfico.
  - `png` — alias legacy de `interactive` (compatibilidad con prompts existentes).
  - `html` — devuelve el snippet HTML crudo (para embeber en aplicaciones propias).
  - `json` — devuelve el config validado (para renderizar client-side, p. ej. con
    react-chartjs-2).
  - `svg` — devuelve un SVG vectorial como data URI markdown (`bar`/`line`/`pie`/
    `doughnut`). Útil solo si la UI destino renderiza data URIs SVG.

## Troubleshooting

| Síntoma | Causa probable | Solución |
|---|---|---|
| El agente llama la tool con `{}` | La plataforma no tiene los parámetros de la tool | Cargar los 2 parámetros a mano (ver arriba) |
| Error `'json' is not valid under any of the given schemas` | Data Type "Json" en GEAI | Cambiar `chartConfig` a String |
| Error `'required' is required to be supplied...` | Falta marcar algún parámetro Required | Todos los parámetros declarados deben ser Required |
| El link dice `localhost` pero el MCP corre en un server | Falta `CHARTS_BASE_URL` | Setearla con la URL pública |
| El link no abre desde otra máquina | Server solo en loopback o firewall | `CHARTS_HTTP_HOST=0.0.0.0` o reverse proxy + firewall |
| `EADDRINUSE` en los logs | Puerto ocupado | El server prueba automáticamente los 9 puertos siguientes; o cambiar `CHARTS_HTTP_PORT` |
| El link abre en la misma pestaña y "se pierde" el chat | El renderer de la UI no usa `target="_blank"` (no controlable desde el MCP) | Ctrl+click / click con rueda / click derecho → pestaña nueva |
| Cambios en el código no impactan | Falta rebuild/reinicio | `npm run build` y reiniciar el proceso que lanza el MCP |

## Cambios respecto del proyecto original

- `chartConfig` acepta objeto **o JSON string** (`z.union`) — el `z.any()` original
  generaba un schema sin `type` que algunas plataformas no propagan al LLM.
- El resultado se devuelve como **TextContent markdown** (algunos proxies MCP
  descartan `ImageContent`).
- Nuevo **servidor HTTP embebido** (`src/chart-server.ts`) + página HTML interactiva
  autogenerada por gráfico, con link clickeable (texto = título del gráfico) como
  respuesta principal.
- PNG comprimido con **sharp** (paleta indexada) — de ~20 KB a ~5 KB.
- Nuevo formato de salida `svg` (renderer vectorial propio para bar/line/pie/doughnut).
- Formato principal renombrado a `interactive` (con `png` como alias legacy);
  el parámetro `saveToFile` fue eliminado.
- Fixes: `chart.destroy()` tras cada render (memory leak), escapes HTML completos,
  IDs aleatorios (sin colisiones ni enumeración), retención automática de archivos.
