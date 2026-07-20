// SVG chart generator: takes the same chartConfig shape that Chart.js consumes
// and renders it directly to an SVG string.
//
// We render SVG on the server (instead of PNG via node-canvas) because SVG is
// tiny (~2-5KB) and vector — perfect for inlining as a data URI in markdown
// without bloating the message stream.
//
// Supports: bar, line, pie, doughnut.

interface Dataset {
  label?: string;
  data: number[];
  backgroundColor?: string | string[];
  borderColor?: string | string[];
  borderWidth?: number;
  fill?: boolean;
}

interface ChartConfig {
  type: string;
  data: {
    labels?: string[];
    datasets: Dataset[];
  };
  options?: {
    plugins?: {
      title?: { display?: boolean; text?: string };
      legend?: { display?: boolean; position?: string };
    };
    scales?: {
      x?: { title?: { display?: boolean; text?: string } };
      y?: { title?: { display?: boolean; text?: string }; beginAtZero?: boolean };
    };
  };
}

const DEFAULT_PALETTE = [
  'rgba(31, 47, 152, 0.85)',
  'rgba(220, 53, 69, 0.85)',
  'rgba(40, 167, 69, 0.85)',
  'rgba(255, 193, 7, 0.85)',
  'rgba(23, 162, 184, 0.85)',
  'rgba(111, 66, 193, 0.85)',
  'rgba(253, 126, 20, 0.85)',
  'rgba(232, 62, 140, 0.85)',
  'rgba(102, 16, 242, 0.85)',
  'rgba(20, 164, 77, 0.85)',
  'rgba(214, 51, 132, 0.85)',
  'rgba(255, 133, 27, 0.85)',
  'rgba(75, 192, 192, 0.85)',
  'rgba(153, 102, 255, 0.85)',
  'rgba(255, 99, 132, 0.85)'
];

function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Cualquier caracter no-ASCII (acentos, guion largo, etc.) se convierte a
    // entidad XML numerica para que el SVG quede 100% ASCII y no dependa del
    // encoding declarado. Asi funciona como <img src="data:image/svg+xml;..."/>
    // sin necesidad de prolog XML, que rompe el parseo en algunos navegadores.
    .replace(/[-￿]/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

function colorAt(colors: string | string[] | undefined, i: number, fallback: string): string {
  if (Array.isArray(colors)) return colors[i] ?? fallback;
  if (typeof colors === 'string') return colors;
  return fallback;
}

function formatNumber(n: number): string {
  if (!isFinite(n)) return String(n);
  if (Math.abs(n) >= 1000) return n.toLocaleString('es-AR', { maximumFractionDigits: 0 });
  if (Number.isInteger(n)) return String(n);
  return n.toLocaleString('es-AR', { maximumFractionDigits: 2 });
}

function niceScale(min: number, max: number, ticks: number): { min: number; max: number; step: number } {
  if (min === max) { max = min + 1; }
  const range = max - min;
  const roughStep = range / Math.max(1, ticks);
  const pow10 = Math.pow(10, Math.floor(Math.log10(roughStep)));
  const norm = roughStep / pow10;
  let step: number;
  if (norm < 1.5) step = 1 * pow10;
  else if (norm < 3) step = 2 * pow10;
  else if (norm < 7) step = 5 * pow10;
  else step = 10 * pow10;
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  return { min: niceMin, max: niceMax, step };
}

function renderBarOrLine(cfg: ChartConfig, width: number, height: number): string {
  const type = cfg.type;
  const labels = cfg.data.labels ?? [];
  const datasets = cfg.data.datasets ?? [];
  const title = cfg.options?.plugins?.title?.text ?? '';
  const showLegend = (cfg.options?.plugins?.legend?.display ?? (datasets.length > 1));
  const xAxisTitle = cfg.options?.scales?.x?.title?.text ?? '';
  const yAxisTitle = cfg.options?.scales?.y?.title?.text ?? '';
  const beginAtZero = cfg.options?.scales?.y?.beginAtZero ?? true;

  const margin = {
    top: title ? 36 : 16,
    right: 16,
    bottom: 60 + (xAxisTitle ? 18 : 0),
    left: 60 + (yAxisTitle ? 18 : 0)
  };
  if (showLegend) margin.top += 22;

  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;

  const allValues = datasets.flatMap(d => d.data);
  const rawMin = beginAtZero ? Math.min(0, ...allValues) : Math.min(...allValues);
  const rawMax = Math.max(0, ...allValues);
  const scale = niceScale(rawMin, rawMax, 6);
  const yMin = scale.min;
  const yMax = scale.max;
  const yStep = scale.step;

  const yFor = (v: number) => margin.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH;
  const xCatCenter = (i: number, n: number) => margin.left + ((i + 0.5) / n) * plotW;

  const svgParts: string[] = [];
  svgParts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" font-family="Segoe UI, Arial, sans-serif" font-size="11">`);
  svgParts.push(`<rect width="${width}" height="${height}" fill="#ffffff"/>`);

  // Title
  if (title) {
    svgParts.push(`<text x="${width / 2}" y="22" text-anchor="middle" font-size="15" font-weight="600" fill="#222">${esc(title)}</text>`);
  }

  // Legend
  if (showLegend) {
    const legendY = title ? 42 : 20;
    let cursorX = margin.left;
    datasets.forEach((ds, i) => {
      const color = colorAt(ds.backgroundColor, 0, DEFAULT_PALETTE[i % DEFAULT_PALETTE.length]);
      const label = ds.label ?? `Serie ${i + 1}`;
      svgParts.push(`<rect x="${cursorX}" y="${legendY - 8}" width="10" height="10" fill="${esc(color)}"/>`);
      svgParts.push(`<text x="${cursorX + 14}" y="${legendY}" fill="#333">${esc(label)}</text>`);
      cursorX += 14 + label.length * 6 + 20;
    });
  }

  // Y grid lines + labels
  for (let v = yMin; v <= yMax + 1e-9; v += yStep) {
    const y = yFor(v);
    svgParts.push(`<line x1="${margin.left}" y1="${y}" x2="${margin.left + plotW}" y2="${y}" stroke="#eaeaea" stroke-width="1"/>`);
    svgParts.push(`<text x="${margin.left - 6}" y="${y + 3}" text-anchor="end" fill="#666">${esc(formatNumber(v))}</text>`);
  }
  // Y axis line
  svgParts.push(`<line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + plotH}" stroke="#999" stroke-width="1"/>`);
  // X axis line
  svgParts.push(`<line x1="${margin.left}" y1="${margin.top + plotH}" x2="${margin.left + plotW}" y2="${margin.top + plotH}" stroke="#999" stroke-width="1"/>`);

  // Axis titles
  if (yAxisTitle) {
    svgParts.push(`<text x="18" y="${margin.top + plotH / 2}" text-anchor="middle" transform="rotate(-90 18 ${margin.top + plotH / 2})" fill="#444" font-size="12">${esc(yAxisTitle)}</text>`);
  }
  if (xAxisTitle) {
    svgParts.push(`<text x="${margin.left + plotW / 2}" y="${height - 8}" text-anchor="middle" fill="#444" font-size="12">${esc(xAxisTitle)}</text>`);
  }

  // Data
  const n = labels.length;
  if (type === 'bar') {
    const groupWidth = plotW / n;
    const barsPerGroup = datasets.length;
    const barGap = 2;
    const innerPadding = 4;
    const barWidth = Math.max(1, (groupWidth - innerPadding * 2 - barGap * (barsPerGroup - 1)) / barsPerGroup);
    datasets.forEach((ds, dsIdx) => {
      const fallbackColor = DEFAULT_PALETTE[dsIdx % DEFAULT_PALETTE.length];
      ds.data.forEach((v, i) => {
        const color = colorAt(ds.backgroundColor, i, fallbackColor);
        const xGroupStart = margin.left + i * groupWidth + innerPadding;
        const x = xGroupStart + dsIdx * (barWidth + barGap);
        const y0 = yFor(Math.max(0, v));
        const y1 = yFor(Math.min(0, v));
        const h = Math.max(0.5, y1 - y0);
        svgParts.push(`<rect x="${x.toFixed(1)}" y="${y0.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${h.toFixed(1)}" fill="${esc(color)}"/>`);
      });
    });
  } else {
    // line
    datasets.forEach((ds, dsIdx) => {
      const fallbackColor = DEFAULT_PALETTE[dsIdx % DEFAULT_PALETTE.length];
      const stroke = colorAt(ds.borderColor, 0, fallbackColor);
      const fill = ds.fill ? colorAt(ds.backgroundColor, 0, fallbackColor.replace(/0\.85\)/, '0.25)')) : 'none';
      const strokeW = ds.borderWidth ?? 2;
      const points = ds.data.map((v, i) => `${xCatCenter(i, n).toFixed(1)},${yFor(v).toFixed(1)}`);
      if (ds.fill && points.length > 0) {
        const baseline = yFor(Math.max(yMin, 0));
        const firstX = xCatCenter(0, n).toFixed(1);
        const lastX = xCatCenter(n - 1, n).toFixed(1);
        const path = `M ${firstX},${baseline} L ${points.join(' L ')} L ${lastX},${baseline} Z`;
        svgParts.push(`<path d="${path}" fill="${esc(fill)}" stroke="none"/>`);
      }
      svgParts.push(`<polyline points="${points.join(' ')}" fill="none" stroke="${esc(stroke)}" stroke-width="${strokeW}" stroke-linejoin="round" stroke-linecap="round"/>`);
      ds.data.forEach((v, i) => {
        svgParts.push(`<circle cx="${xCatCenter(i, n).toFixed(1)}" cy="${yFor(v).toFixed(1)}" r="3" fill="${esc(stroke)}"/>`);
      });
    });
  }

  // X labels
  labels.forEach((label, i) => {
    const cx = xCatCenter(i, n);
    const y = margin.top + plotH + 14;
    const short = String(label);
    if (short.length > 12) {
      svgParts.push(`<text x="${cx}" y="${y + 4}" text-anchor="end" transform="rotate(-35 ${cx} ${y + 4})" fill="#333">${esc(short)}</text>`);
    } else {
      svgParts.push(`<text x="${cx}" y="${y}" text-anchor="middle" fill="#333">${esc(short)}</text>`);
    }
  });

  svgParts.push(`</svg>`);
  return svgParts.join('');
}

function renderPie(cfg: ChartConfig, width: number, height: number, doughnut: boolean): string {
  const labels = cfg.data.labels ?? [];
  const dataset = cfg.data.datasets[0];
  const values = dataset.data;
  const total = values.reduce((a, b) => a + b, 0) || 1;
  const title = cfg.options?.plugins?.title?.text ?? '';
  const showLegend = cfg.options?.plugins?.legend?.display ?? true;

  const marginTop = title ? 36 : 12;
  const legendWidth = showLegend ? 160 : 0;
  const chartArea = { x: 12, y: marginTop, w: width - 24 - legendWidth, h: height - marginTop - 12 };
  const cx = chartArea.x + chartArea.w / 2;
  const cy = chartArea.y + chartArea.h / 2;
  const rOuter = Math.min(chartArea.w, chartArea.h) / 2 - 8;
  const rInner = doughnut ? rOuter * 0.55 : 0;

  const svgParts: string[] = [];
  svgParts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" font-family="Segoe UI, Arial, sans-serif" font-size="11">`);
  svgParts.push(`<rect width="${width}" height="${height}" fill="#ffffff"/>`);

  if (title) {
    svgParts.push(`<text x="${width / 2}" y="22" text-anchor="middle" font-size="15" font-weight="600" fill="#222">${esc(title)}</text>`);
  }

  let angle = -Math.PI / 2;
  values.forEach((v, i) => {
    const slice = (v / total) * Math.PI * 2;
    const nextAngle = angle + slice;
    const color = colorAt(dataset.backgroundColor, i, DEFAULT_PALETTE[i % DEFAULT_PALETTE.length]);

    const x0 = cx + rOuter * Math.cos(angle);
    const y0 = cy + rOuter * Math.sin(angle);
    const x1 = cx + rOuter * Math.cos(nextAngle);
    const y1 = cy + rOuter * Math.sin(nextAngle);
    const largeArc = slice > Math.PI ? 1 : 0;

    let path: string;
    if (doughnut) {
      const ix0 = cx + rInner * Math.cos(angle);
      const iy0 = cy + rInner * Math.sin(angle);
      const ix1 = cx + rInner * Math.cos(nextAngle);
      const iy1 = cy + rInner * Math.sin(nextAngle);
      path = `M ${x0.toFixed(2)},${y0.toFixed(2)} A ${rOuter},${rOuter} 0 ${largeArc} 1 ${x1.toFixed(2)},${y1.toFixed(2)} L ${ix1.toFixed(2)},${iy1.toFixed(2)} A ${rInner},${rInner} 0 ${largeArc} 0 ${ix0.toFixed(2)},${iy0.toFixed(2)} Z`;
    } else {
      path = `M ${cx.toFixed(2)},${cy.toFixed(2)} L ${x0.toFixed(2)},${y0.toFixed(2)} A ${rOuter},${rOuter} 0 ${largeArc} 1 ${x1.toFixed(2)},${y1.toFixed(2)} Z`;
    }
    svgParts.push(`<path d="${path}" fill="${esc(color)}" stroke="#fff" stroke-width="1"/>`);
    angle = nextAngle;
  });

  if (showLegend) {
    const legendX = width - legendWidth + 8;
    labels.forEach((label, i) => {
      const y = chartArea.y + 12 + i * 18;
      const color = colorAt(dataset.backgroundColor, i, DEFAULT_PALETTE[i % DEFAULT_PALETTE.length]);
      const pct = ((values[i] / total) * 100).toFixed(1);
      svgParts.push(`<rect x="${legendX}" y="${y - 9}" width="10" height="10" fill="${esc(color)}"/>`);
      const text = `${label} (${pct}%)`;
      svgParts.push(`<text x="${legendX + 14}" y="${y}" fill="#333">${esc(text)}</text>`);
    });
  }

  svgParts.push(`</svg>`);
  return svgParts.join('');
}

export function generateSvgChart(cfg: ChartConfig, width = 500, height = 320): string {
  const type = (cfg.type || '').toLowerCase();
  if (type === 'bar' || type === 'line') return renderBarOrLine(cfg, width, height);
  if (type === 'pie') return renderPie(cfg, width, height, false);
  if (type === 'doughnut') return renderPie(cfg, width, height, true);
  throw new Error(`SVG output not supported for chart type "${cfg.type}". Supported: bar, line, pie, doughnut.`);
}
