import { Chart, registerables, ChartConfiguration, ChartItem } from 'chart.js';
import { createCanvas } from 'canvas';
import sharp from 'sharp';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { createRequire } from 'module';
import { generateSvgChart } from './svg-generator.js';
import { getChartsDir, cleanupOldCharts } from './chart-server.js';

// Register Chart.js components
Chart.register(...registerables);

type OutputFormat = 'interactive' | 'html' | 'json' | 'svg';

type ChartGenerationSuccess = {
  success: true;
  buffer?: Buffer;           // PNG render (when format = 'interactive')
  htmlSnippet?: string;      // HTML div snippet (when format = 'html')
  jsonConfig?: object;       // Chart.js config object (when format = 'json')
  htmlFileName?: string;     // Nombre de archivo del HTML interactivo servible via chart-server
  svgSource?: string;        // SVG markup (when format = 'svg')
  message: string;
};

type ChartGenerationError = {
  success: false;
  error: string;
  message: string;
};

type ChartGenerationResult = ChartGenerationSuccess | ChartGenerationError;

// Lee (una sola vez) el build UMD de Chart.js desde el node_modules local y lo
// cachea. Se resuelve vía el entry point exportado "." porque el campo "exports"
// de chart.js no expone la subruta dist directamente.
const localRequire = createRequire(import.meta.url);
let chartJsUmdSource: string | null = null;
function getChartJsUmdSource(): string {
  if (chartJsUmdSource === null) {
    const distDir = path.dirname(localRequire.resolve('chart.js'));
    const umdPath = path.join(distDir, 'chart.umd.min.js');
    // Escapamos cualquier </script> para que la librería embebida no rompa el <script>.
    chartJsUmdSource = fs.readFileSync(umdPath, 'utf8').replace(/<\/script>/gi, '<\\/script>');
  }
  return chartJsUmdSource;
}

// Escapa secuencias que permiten salir del contexto <script> cuando se
// inyecta texto dentro de un <script> (config del gráfico): </script> y
// aperturas de comentario HTML (<!--), que también cambian el estado del
// parser HTML dentro de script data.
function escapeForScript(text: string): string {
  return text
    .replace(/<\/script>/gi, '<\\/script>')
    .replace(/<!--/g, '<\\!--');
}

// Escape completo para texto que va en contexto HTML (título de la página).
function escapeHtml(text: string): string {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function generateHtmlSnippet(chartConfig: ChartConfiguration): string {
  const uniqueId = `chart-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const chartJsSource = getChartJsUmdSource();
  const configJson = escapeForScript(JSON.stringify(chartConfig, null, 2));

  const template = `<div id="chart-container-${uniqueId}" style="width: 800px; height: 400px; margin: 0 auto; position: relative;">
  <canvas id="chart-${uniqueId}"></canvas>
  <script>
    if (typeof Chart === 'undefined') {
      ${chartJsSource}
    }
  </script>
  <script>
    (function() {
      const ctx = document.getElementById('chart-${uniqueId}').getContext('2d');
      const config = ${configJson};
      new Chart(ctx, config);
    })();
  </script>
</div>`;

  return template.trim();
}

// Guarda una pagina HTML completa e interactiva del chart en el directorio
// local de charts (configurable con CHARTS_OUTPUT_DIR). Devuelve el NOMBRE de
// archivo (no el path) para armar la URL del chart-server, o null si no se
// pudo escribir (no debe romper la generacion del PNG).
// El nombre lleva 16 chars aleatorios (capability URL): quien no tiene el
// link no puede adivinarlo ni enumerar charts de otros usuarios.
function saveInteractiveHtml(chartConfig: ChartConfiguration): string | null {
  try {
    const outDir = getChartsDir();
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const title = (chartConfig as any)?.options?.plugins?.title?.text || 'Chart';
    const id = crypto.randomBytes(12).toString('base64url').replace(/[_-]/g, 'x').slice(0, 16);
    const fileName = `chart-${id}.html`;
    const filePath = path.join(outDir, fileName);

    const snippet = generateHtmlSnippet(chartConfig)
      // El snippet trae tamano fijo 800x400; en la pagina standalone lo hacemos fluido.
      .replace('width: 800px; height: 400px;', 'width: 90vw; max-width: 1100px; height: 75vh;');

    const page = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: 'Segoe UI', Arial, sans-serif; background: #f7f7fb; margin: 0;
         display: flex; align-items: center; justify-content: center; min-height: 100vh; }
</style>
</head>
<body>
${snippet}
</body>
</html>`;
    fs.writeFileSync(filePath, page, 'utf8');
    cleanupOldCharts();
    return fileName;
  } catch {
    return null;
  }
}

export async function generateChart(
  chartConfig: ChartConfiguration,
  outputFormat: OutputFormat = 'interactive'
): Promise<ChartGenerationResult> {
  try {
    // Validate basic required structure
    if (!chartConfig.data || !chartConfig.data.datasets || !Array.isArray(chartConfig.data.datasets)) {
      throw new Error('Invalid chart configuration: data.datasets is required and must be an array');
    }

    if (chartConfig.data.datasets.length === 0) {
      throw new Error('Invalid chart configuration: at least one dataset is required');
    }

    // Clean up the config to handle undefined values
    const cleanedConfig = { ...chartConfig };
    
    // If options is undefined, remove it from the config (Chart.js will use defaults)
    if (cleanedConfig.options === undefined) {
      delete cleanedConfig.options;
    }

    // Handle JSON format - return raw config for client-side rendering
    if (outputFormat === 'json') {
      return {
        success: true,
        jsonConfig: cleanedConfig,
        message: "Chart config generated successfully"
      };
    }

    // Handle HTML format
    if (outputFormat === 'html') {
      const htmlSnippet = generateHtmlSnippet(cleanedConfig);
      return {
        success: true,
        htmlSnippet,
        message: "HTML chart generated successfully"
      };
    }

    // Handle SVG format
    if (outputFormat === 'svg') {
      const svgSource = generateSvgChart(cleanedConfig as any);
      return {
        success: true,
        svgSource,
        message: "SVG chart generated successfully"
      };
    }

    // Handle 'interactive' format: renderizamos el chart en canvas (esto valida
    // el config de verdad) y guardamos la pagina HTML interactiva que se sirve
    // via el chart-server embebido.
    const width = 400;
    const height = 260;

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // Snapshot del config ANTES de instanciar Chart.js: new Chart() muta el
    // objeto (resuelve defaults, apaga animation, etc.) y el HTML interactivo
    // debe llevar el config original del agente, no el mutado.
    const configForHtml = JSON.parse(JSON.stringify(cleanedConfig));

    // Create the chart directly with cleanedConfig - Chart.js will handle detailed validation
    const chart = new Chart(ctx as unknown as ChartItem, cleanedConfig);

    // Post-procesamos con sharp para reducir a paleta indexada. Un chart PNG
    // pasa de ~20KB a ~4-6KB perdiendo antialiasing pero manteniendo legibilidad.
    const rawBuffer = canvas.toBuffer('image/png');

    // El MCP es un proceso long-running: sin destroy() cada render deja
    // referencias vivas (animator, listeners) y el proceso pierde memoria.
    chart.destroy();

    const buffer = await sharp(rawBuffer)
      .png({ palette: true, colours: 32, compressionLevel: 9, effort: 10 })
      .toBuffer();

    // Guardamos la version interactiva a tamano completo, que se sirve via el
    // chart-server embebido.
    const htmlFileName = saveInteractiveHtml(configForHtml);

    return {
      success: true,
      buffer,
      htmlFileName: htmlFileName ?? undefined,
      message: "Chart generated successfully"
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      message: `Error generating chart: ${error instanceof Error ? error.message : String(error)}`
    };
  }
} 