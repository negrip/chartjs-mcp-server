/**
 * Example: Using the chartjs-mcp-server JSON output format with assistant-ui
 *
 * This is a reference snippet — not a standalone runnable file.
 * Copy the relevant pieces into your assistant-ui / Next.js project.
 *
 * Setup:
 *   1. Create an assistant-ui project:  npx assistant-ui@latest create
 *   2. Install chart.js:                npm install chart.js
 *   3. Copy ChartBlock into             src/components/chart-block.tsx
 *   4. Copy ChartToolUI into            src/components/chart-tool-ui.tsx
 *   5. Add <ChartToolUI /> next to      <Thread /> inside your AssistantRuntimeProvider
 *
 * How it works:
 *   - Your backend connects to chartjs-mcp-server and calls generateChart
 *     with outputFormat: "json"
 *   - The MCP server returns the raw Chart.js config as a JSON string
 *   - assistant-ui's makeAssistantToolUI intercepts the tool call result
 *     and renders it as an interactive chart via Chart.js on a <canvas>
 *
 * Prerequisites:
 *   npm install @assistant-ui/react chart.js
 */

// ─── src/components/chart-block.tsx ──────────────────────────────────────────

import { useEffect, useRef } from "react";
import { Chart, registerables } from "chart.js";

Chart.register(...registerables);

interface ChartBlockProps {
  config: Record<string, any>;
}

export function ChartBlock({ config }: ChartBlockProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    chartRef.current?.destroy();

    const ctx = canvasRef.current.getContext("2d");
    if (!ctx) return;

    chartRef.current = new Chart(ctx, {
      ...config,
      options: {
        ...config.options,
        responsive: true,
        maintainAspectRatio: true,
      },
    } as any);

    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [config]);

  return (
    <div className="my-3 rounded-lg border bg-white p-3">
      <canvas ref={canvasRef} />
    </div>
  );
}

// ─── src/components/chart-tool-ui.tsx ────────────────────────────────────────

import {
  makeAssistantToolUI,
  AssistantRuntimeProvider,
} from "@assistant-ui/react";

// Import ChartBlock from the file above
// import { ChartBlock } from "./chart-block";

const ChartToolUI = makeAssistantToolUI<
  { chartConfig: any; outputFormat?: string; saveToFile?: boolean },
  string // The JSON format returns a JSON string as text content
>({
  toolName: "generateChart",
  render: ({ args, result, status }) => {
    // Loading state
    if (status.type === "running") {
      return (
        <div className="my-3 flex items-center gap-2 rounded-lg border p-4 text-muted-foreground">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          Generating chart...
        </div>
      );
    }

    // Error state
    if (status.type === "incomplete" && status.reason === "error") {
      return (
        <div className="my-3 rounded-lg border border-red-200 bg-red-50 p-4 text-red-600">
          Chart generation failed. Please try again.
        </div>
      );
    }

    // Success — parse the JSON config and render
    if (result) {
      try {
        const config =
          typeof result === "string" ? JSON.parse(result) : result;
        return <ChartBlock config={config} />;
      } catch {
        return (
          <div className="my-3 rounded-lg border p-4 text-muted-foreground">
            Unable to parse chart configuration.
          </div>
        );
      }
    }

    return null;
  },
});

export { ChartToolUI };

// ─── Usage in your page / layout ─────────────────────────────────────────────
//
// import { Thread } from "@/components/assistant-ui/thread";
// import { ChartToolUI } from "@/components/chart-tool-ui";
//
// export default function ChatPage() {
//   return (
//     <AssistantRuntimeProvider runtime={runtime}>
//       <Thread />
//       <ChartToolUI />
//     </AssistantRuntimeProvider>
//   );
// }
