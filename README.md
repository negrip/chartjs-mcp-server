# ChartJS MCP Server

Servidor MCP (Model Context Protocol) que genera gráficos **Chart.js v4** para agentes de
IA. Está pensado para integrarse con **GLOB.AI OS / Globant Enterprise AI (GEAI)** a través
de su proxy MCP, aunque funciona con cualquier cliente MCP estándar.

> Esta versión parte del proyecto de código abierto
> [ax-crew/chartjs-mcp-server](https://github.com/ax-crew/chartjs-mcp-server) (MIT) y lo
> adapta para funcionar con **GLOB.AI OS / Globant Enterprise AI**: cambia la salida de
> imagen embebida por un **link a un gráfico interactivo** servido por un HTTP server
> propio, ajusta el esquema de la tool para el proxy de GEAI y agrega configuración por
> `.env`, entre otras mejoras. El detalle de los cambios está al final de este README.

En lugar de intentar embeber la imagen en el chat (donde muchas UIs bloquean o degradan
las imágenes por políticas de seguridad), el server **renderiza el gráfico, guarda una
página HTML interactiva y devuelve un link clickeable**. El usuario abre el link y ve el
gráfico a pantalla completa, con tooltips y leyendas interactivas.

```
📈 [Ventas por trimestre — 2026](http://localhost:8123/charts/chart-U7pXnxRKq087ou18.html)
```

## Características

- **Link interactivo** como salida principal (sin límites de tamaño de imagen ni CSP).
- **8 tipos de gráfico**: bar, line, pie, doughnut, polarArea, radar, scatter, bubble.
- **Servidor HTTP embebido** en el propio proceso del MCP.
- **Configuración por `.env`** (sin dependencias externas).
- **Seguro por diseño**: links no adivinables, sin listado de directorio, sin path
  traversal, retención automática de archivos.
- Formatos alternativos: `html` (snippet crudo), `json` (config validado), `svg`
  (data URI vectorial).

## Requisitos

- Node.js >= 18
- Windows / Linux / macOS

Ver [REQUIREMENTS.txt](./REQUIREMENTS.txt) para el detalle.

## Instalación

```bash
git clone https://github.com/negrip/chartjs-mcp-server.git
cd chartjs-mcp-server
npm install
npm run build
```

## Configuración

Copiar la plantilla y ajustar según el entorno:

```bash
cp .env.example .env
```

| Variable | Default | Descripción |
|---|---|---|
| `CHARTS_OUTPUT_DIR` | `<temp>/chartjs-mcp-charts` | Dónde se guardan los HTML de los gráficos |
| `CHARTS_HTTP_HOST` | `127.0.0.1` | Interfaz del server (`0.0.0.0` para exponer en red) |
| `CHARTS_HTTP_PORT` | `8123` | Puerto del server (fallback automático hasta +9) |
| `CHARTS_BASE_URL` | `http://localhost:<puerto>` | URL base de los links. **Obligatoria en servidor** |
| `CHARTS_MAX_FILES` | `50` | Cantidad de gráficos que se conservan |

## Uso en GLOB.AI OS / Globant Enterprise AI

Esta es la guía rápida. El paso a paso completo (incluida la puesta en un servidor con
HTTPS/reverse proxy) está en **[DEPLOYMENT.md](./DEPLOYMENT.md)**.

### 1. Registrar el MCP en el proxy

En la configuración del proxy MCP:

```json
{
  "mcpServers": {
    "ChartJS": {
      "command": "node",
      "args": ["/ruta/a/chartjs-mcp-server/dist/index.js"]
    }
  }
}
```

Al reiniciar el proxy, la tool queda registrada como **`ChartJS__generatechart`**.

### 2. Cargar los parámetros de la tool

En *Integrations → ChartJS → Tool Parameters*, cargar a mano (el proxy no propaga el
schema completo):

| Key | Type | Data Type | Required |
|---|---|---|---|
| `chartConfig` | Application | **String** | ✅ |
| `outputFormat` | Application | String | ✅ |

Ambos deben quedar **Required** (la plataforma envía el schema con `strict: true`).
`chartConfig` va como **String** (el server parsea el JSON internamente).

### 3. Adjuntar la tool al agente e instruirlo

Agregar `ChartJS__generatechart` al resource pool del agente. El agente debe: obtener
los datos, armar el `chartConfig` con valores reales, llamar a la tool con
`outputFormat: "interactive"`, y reproducir el link markdown tal cual lo devuelve la tool.

En [DEPLOYMENT.md](./DEPLOYMENT.md) hay un bloque de instrucciones sugerido para el
prompt del agente.

## API de la tool

`generateChart(chartConfig, outputFormat?)`

- **`chartConfig`** (object | JSON string, requerido): configuración completa Chart.js v4.
- **`outputFormat`** (opcional, default `"interactive"`):
  - `interactive` — renderiza, guarda el HTML interactivo y devuelve el link markdown.
  - `png` — alias legacy de `interactive`.
  - `html` — snippet HTML crudo self-contained.
  - `json` — config Chart.js validado (para render client-side).
  - `svg` — SVG vectorial como data URI markdown (bar/line/pie/doughnut).

## Documentación

- **[DEPLOYMENT.md](./DEPLOYMENT.md)** — guía completa: arquitectura, integración con
  GLOB.AI OS paso a paso, despliegue en servidor, seguridad, troubleshooting.
- **[REQUIREMENTS.txt](./REQUIREMENTS.txt)** — requisitos de sistema y dependencias.

## Cambios respecto del proyecto original

Este proyecto deriva de [ax-crew/chartjs-mcp-server](https://github.com/ax-crew/chartjs-mcp-server).
Principales adaptaciones para su uso con GLOB.AI OS / GEAI:

- **Salida como link a un gráfico interactivo** (servidor HTTP embebido), en lugar de la
  imagen embebida — evita las restricciones de CSP y de tamaño de data URI de las UIs de chat.
- **`chartConfig` acepta objeto o JSON string**, con `type` declarado en el esquema para
  que el proxy de GEAI lo propague correctamente al modelo.
- **Respuesta como texto/markdown** (compatibilidad con proxies MCP que descartan contenido
  de tipo imagen).
- **Formato principal `interactive`** (con `png` como alias); nuevo formato `svg` con
  renderer vectorial propio.
- **Configuración por `.env`** sin dependencias externas.
- Mejoras internas: compresión de PNG, liberación de recursos por render, escapes de HTML,
  identificadores de archivo no adivinables y retención automática.

## Licencia

MIT — ver [LICENSE](./LICENSE). Se conserva la licencia y el aviso de copyright del
proyecto original.
