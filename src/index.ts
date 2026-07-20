#!/usr/bin/env node

import { loadDotEnv } from './env.js';
// Cargar .env ANTES de importar módulos que leen process.env.
loadDotEnv();

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { generateChart } from './chart-generator.js';
import { ensureChartServer, getBaseUrl } from './chart-server.js';

// Create MCP server instance
const server = new McpServer({
  name: "@ax-crew/chartjs-mcp-server",
  version: "1.0.0",
  capabilities: {
    tools: {},
  },
});

// Validation function for chart configuration
function validateChartConfig(chartConfig: any) {
  // Handle case where chartConfig is a string (parse it)
  let config = chartConfig;
  if (typeof chartConfig === 'string') {
    try {
      config = JSON.parse(chartConfig);
    } catch (parseError) {
      throw new Error('Chart configuration string is not valid JSON');
    }
  }

  // Check if config is an object
  if (!config || typeof config !== 'object') {
    throw new Error('Chart configuration must be an object');
  }

  // Check for valid chart type
  const validTypes = ['bar', 'line', 'scatter', 'bubble', 'pie', 'doughnut', 'polarArea', 'radar'];
  if (!config.type || !validTypes.includes(config.type)) {
    throw new Error(`Invalid chart type. Must be one of: ${validTypes.join(', ')}`);
  }

  // Check for data object
  if (!config.data || typeof config.data !== 'object') {
    throw new Error('Chart configuration must include a data object');
  }

  // Check for datasets array
  if (!config.data.datasets || !Array.isArray(config.data.datasets)) {
    throw new Error('Chart data must include a datasets array');
  }

  // Check for at least one dataset
  if (config.data.datasets.length === 0) {
    throw new Error('Chart data must include at least one dataset');
  }

  return config; // Return the parsed config
}

// Register the chart generation tool
server.registerTool(
  "generateChart",
  {
    title: "Generate Chart",
    description: "Generates charts using Chart.js. Can output PNG images or interactive HTML divs. Supports full Chart.js v4 configuration options.",
    inputSchema: {
      chartConfig: z.union([z.record(z.any()), z.string()]).describe("Complete Chart.js configuration object supporting full v4 schema (accepts a JSON object or a JSON string)"),
      outputFormat: z.enum(['interactive', 'png', 'html', 'json', 'svg']).optional().default('interactive').describe("Output format: 'interactive' (default, recommended for chat agents) renders the chart and returns a clickable markdown link to a full-screen interactive page; 'png' is a legacy alias of 'interactive'; 'html' returns a raw self-contained HTML snippet; 'json' returns the validated Chart.js config; 'svg' returns a vector image as a markdown data URI")
    }
  },
  async ({ chartConfig, outputFormat }) => {
    // Validate chart configuration first and get parsed config
    let parsedChartConfig;
    try {
      parsedChartConfig = validateChartConfig(chartConfig);
    } catch (validationError) {
      // Return validation error as content
      const message = validationError instanceof Error ? validationError.message : String(validationError);
      return {
        content: [
          {
            type: "text",
            text: `Error: ${message}`
          }
        ]
      };
    }

    // 'png' queda como alias legacy del formato principal 'interactive'.
    const normalizedFormat = outputFormat === 'png' ? 'interactive' : outputFormat;

    const result = await generateChart(parsedChartConfig, normalizedFormat);

    if (result.success) {
      // Handle JSON format - structured config for client-side rendering
      if (result.jsonConfig) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result.jsonConfig),
              mimeType: "application/json"
            }
          ]
        };
      }

      // Handle HTML format
      if (result.htmlSnippet) {
        return {
          content: [
            {
              type: 'text',
              text: result.htmlSnippet,
              mimeType: "text/html"
            }
          ]
        };
      }

      // Handle SVG format — inline as a Markdown data URI. SVG is text, so we
      // base64-encode it to survive any downstream serialization that might
      // mangle raw markup, at a modest size cost (~35%).
      if (result.svgSource) {
        const base64 = Buffer.from(result.svgSource, 'utf8').toString('base64');
        return {
          content: [
            {
              type: 'text',
              text: `![chart](data:image/svg+xml;base64,${base64})`,
              mimeType: 'text/markdown'
            }
          ]
        };
      }

      // Handle 'interactive' format (default)
      if (result.buffer) {
        // Sin imagen inline (varias UIs de chat bloquean o degradan data URIs
        // grandes). El chart interactivo se sirve desde el HTTP server
        // embebido y devolvemos un link markdown clickeable.
        const htmlFileName = (result as any).htmlFileName as string | undefined;
        // Texto del link = titulo del chart, para que con varios graficos en
        // una misma respuesta el usuario sepa cual es cual.
        const chartTitle = (parsedChartConfig as any)?.options?.plugins?.title?.text;
        const linkText = typeof chartTitle === 'string' && chartTitle.trim()
          ? chartTitle.trim().replace(/[\[\]]/g, '')
          : 'Abrir gráfico interactivo';
        let text: string;
        if (htmlFileName) {
          try {
            await ensureChartServer();
            const url = `${getBaseUrl()}/charts/${htmlFileName}`;
            text = `📈 [${linkText}](${url})`;
          } catch (serverError) {
            // Server no disponible: al menos informamos el archivo local.
            text = `📈 Gráfico generado: \`${htmlFileName}\` en el directorio de charts (no se pudo iniciar el servidor HTTP: ${serverError instanceof Error ? serverError.message : serverError})`;
          }
        } else {
          text = 'Gráfico generado, pero no se pudo guardar el archivo HTML local.';
        }
        return {
          content: [
            {
              type: 'text',
              text,
              mimeType: 'text/markdown'
            }
          ]
        };
      } else {
        // Fallback - shouldn't happen
        return {
          content: [
            { type: "text", text: result.message }
          ]
        };
      }
    } else {
      return {
        content: [
          {
            type: "text", 
            text: `${result.message}\n\nPlease ensure your configuration follows the Chart.js v4 schema. Common issues:\n- Check data format matches chart type (e.g., scatter charts need {x, y} objects)\n- Verify all required dataset properties are provided\n- Ensure chart type is supported: ${['bar', 'line', 'scatter', 'bubble', 'pie', 'doughnut', 'polarArea', 'radar'].join(', ')}` 
          }
        ]
      };
    }
  }
);

// Main function to start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});