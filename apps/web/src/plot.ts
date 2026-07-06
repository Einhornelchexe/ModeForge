// Envelope plot geometry and SVG builders, ported 1:1 from the Claude Design
// source. Pure display code — every number comes from headless core results.

import type { BeamlineComponent, BeamlineResult } from "../../../packages/api/src/index.ts";
import { esc, fmtMm, sig } from "./format.ts";

export const PALETTE: [string, string] = ["#5CE1A0", "#F2B33D"];
export const GRID_DIVISIONS = 6;

export type GlyphPath = { d: string; fill: string; stroke: string; sw: number };

export type PlotVals = {
  envAreaX: string;
  envAreaY: string;
  envLineX: string;
  envLineY: string;
  zTicks: Array<{ x: string; label: string }>;
  rTicks: Array<{ y: string; ly: string; label: string }>;
  compMarks: Array<{ x: string; label: string; lineColor: string; labelColor: string }>;
  waistMarks: Array<{ x: string; y1: string; y2: string; cy: string; tx: string; ty: string; anchor: string; color: string; label: string }>;
  apMarks: Array<{ x: string; topY: string; botY: string; color: string }>;
  glyphs: Array<{ paths: GlyphPath[] }>;
  axisY: string;
  plotEnd: number;
  z?: number[];
  rx?: number[];
  ry?: number[];
};

const P = { W: 940, H: 380, L: 54, R: 924, T: 18, B: 346 };

export const PLOT_FRAME = P;

// lens cross-section outline: quadratic surfaces through the vertex sag.
// s1 > 0 → front surface bulges left (convex); s2 > 0 → back bulges right.
export function lensPath(xc: number, yC: number, h: number, wHalf: number, s1: number, s2: number): string {
  const top = (yC - h).toFixed(1);
  const bot = (yC + h).toFixed(1);
  const yc = yC.toFixed(1);
  const xfe = xc - wHalf;
  const xbe = xc + wHalf;
  const cF = (xfe - 2 * s1).toFixed(1);
  const cB = (xbe + 2 * s2).toFixed(1);
  return `M${xfe.toFixed(1)} ${top} Q${cF} ${yc} ${xfe.toFixed(1)} ${bot} L${xbe.toFixed(1)} ${bot} Q${cB} ${yc} ${xbe.toFixed(1)} ${top} Z`;
}

export function kindIcon(c: BeamlineComponent): GlyphPath[] {
  const glass = { fill: "rgba(140,180,235,0.16)", stroke: "#7FA8D9", sw: 1.1 };
  if (c.kind === "free-space") return [{ fill: "none", stroke: "#97A1B2", sw: 1.3, d: "M2.5 9 H13.5 M10.5 5.5 L14.5 9 L10.5 12.5" }];
  if (c.kind === "thin-lens") {
    const s = c.focalLengthMm < 0 ? -2.4 : 2.4;
    return [{ ...glass, d: lensPath(9, 9, 6.8, 1.7, s, s) }];
  }
  if (c.kind === "cylindrical-lens") {
    const s = c.focalLengthMm < 0 ? -2.4 : 2.4;
    return [
      { ...glass, d: lensPath(9, 9, 6.8, 1.7, s, s) },
      { fill: "none", stroke: "rgba(127,168,217,0.6)", sw: 0.9, d: "M9 3.4 V14.6" },
    ];
  }
  if (c.kind === "thick-lens") {
    const s1 = c.radius1Mm === "Infinity" ? 0 : 2.6 * Math.sign(c.radius1Mm);
    const s2 = c.radius2Mm === "Infinity" ? 0 : -2.6 * Math.sign(c.radius2Mm);
    return [{ ...glass, d: lensPath(9, 9, 6.8, 3.2, s1, s2) }];
  }
  if (c.kind === "slab")
    return [
      { ...glass, d: "M5.5 2.5 H12.5 V15.5 H5.5 Z" },
      { fill: "none", stroke: "rgba(140,180,235,0.55)", sw: 0.8, d: "M7 14 L11.5 4" },
    ];
  if (c.kind === "aperture")
    return [
      { fill: "none", stroke: "#97A1B2", sw: 2, d: "M9 2.2 V6.4 M9 11.6 V15.8" },
      { fill: "none", stroke: "#97A1B2", sw: 1.2, d: "M5.8 6.4 H12.2 M5.8 11.6 H12.2" },
    ];
  if (c.kind === "surface-stack") {
    const first = c.surfaces[0]?.radiusMm;
    const last = c.surfaces[c.surfaces.length - 1]?.radiusMm;
    const s1 = first === undefined || first === "Infinity" ? 0 : 2.6 * Math.sign(first);
    const s2 = last === undefined || last === "Infinity" ? 0 : -2.6 * Math.sign(last);
    return [
      { ...glass, d: lensPath(9, 9, 6.8, 3.6, s1, s2) },
      { fill: "none", stroke: "rgba(127,168,217,0.6)", sw: 0.9, d: "M7.5 3.4 V14.6 M10.5 3.4 V14.6" },
    ];
  }
  return [];
}

function stackMinApertureMm(component: BeamlineComponent): number | undefined {
  if (component.kind !== "surface-stack") return undefined;
  return component.surfaces.reduce<number | undefined>(
    (min, surface) =>
      surface.apertureRadiusMm !== undefined && (min === undefined || surface.apertureRadiusMm < min) ? surface.apertureRadiusMm : min,
    undefined,
  );
}

export function plotVals(
  dense: BeamlineResult | null,
  canonical: BeamlineResult | null,
  sourceComps: BeamlineComponent[],
  gridDivisions: number = GRID_DIVISIONS,
  palette: [string, string] = PALETTE,
): PlotVals {
  const empty: PlotVals = {
    envAreaX: "",
    envAreaY: "",
    envLineX: "",
    envLineY: "",
    zTicks: [],
    rTicks: [],
    compMarks: [],
    waistMarks: [],
    apMarks: [],
    glyphs: [],
    axisY: String((P.T + P.B) / 2),
    plotEnd: 0,
  };
  if (!dense || !canonical || dense.zGridMm.length < 2) return empty;
  const z = dense.zGridMm;
  const rx = dense.envelope.radiusXmm;
  const ry = dense.envelope.radiusYmm;
  const zEnd = z.at(-1) as number;
  let rMax = 0;
  for (const v of rx) rMax = Math.max(rMax, v);
  if (ry) for (const v of ry) rMax = Math.max(rMax, v);
  const apRs = canonical.components.map((c) => {
    const src = sourceComps.find((b) => b.id === c.componentId);
    return src && "apertureRadiusMm" in src && src.apertureRadiusMm !== undefined ? src.apertureRadiusMm : 0;
  });
  const apMax = Math.max(0, ...apRs);
  if (apMax > 0 && apMax < rMax * 2.4) rMax = Math.max(rMax, apMax * 1.05);
  rMax *= 1.12;
  const x = (zv: number) => P.L + (zv / zEnd) * (P.R - P.L);
  const yC = (P.T + P.B) / 2;
  const y = (rv: number) => yC - (rv / rMax) * (yC - P.T);
  const line = (arr: number[], sign: number) =>
    arr.map((rv, i) => `${i === 0 ? "M" : "L"}${x(z[i]).toFixed(1)} ${y(sign * rv).toFixed(1)}`).join(" ");
  const area = (arr: number[]) => {
    let d = arr.map((rv, i) => `${i === 0 ? "M" : "L"}${x(z[i]).toFixed(1)} ${y(rv).toFixed(1)}`).join(" ");
    for (let i = arr.length - 1; i >= 0; i -= 1) d += ` L${x(z[i]).toFixed(1)} ${y(-arr[i]).toFixed(1)}`;
    return d + " Z";
  };
  const niceStep = (range: number, n: number) => {
    const raw = range / n;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const norm = raw / mag;
    const step = norm >= 5 ? 10 : norm >= 2.5 ? 5 : norm >= 1.5 ? 2 : 1;
    return step * mag;
  };
  const gridN = Math.round(gridDivisions);
  const zStep = niceStep(zEnd, gridN);
  const zTicks: PlotVals["zTicks"] = [];
  for (let zv = 0; zv <= zEnd * 1.0001; zv += zStep) zTicks.push({ x: x(zv).toFixed(1), label: sig(zv, 4) });
  const rStep = niceStep(rMax * 2, 4);
  const rTicks: PlotVals["rTicks"] = [];
  for (let rv = 0; rv <= rMax * 1.0001; rv += rStep) {
    if (rv === 0) {
      rTicks.push({ y: yC.toFixed(1), ly: (yC + 3.5).toFixed(1), label: "0" });
      continue;
    }
    rTicks.push({ y: y(rv).toFixed(1), ly: (y(rv) + 3.5).toFixed(1), label: sig(rv, 3) });
    rTicks.push({ y: y(-rv).toFixed(1), ly: (y(-rv) + 3.5).toFixed(1), label: sig(rv, 3) });
  }
  const compMarks: PlotVals["compMarks"] = [];
  const apMarks: PlotVals["apMarks"] = [];
  const glyphs: PlotVals["glyphs"] = [];
  // stylized element silhouettes: curvature sign/strength from the real prescription,
  // sag exaggerated for legibility (true sag is sub-pixel at plot scale)
  const sag = (R: number | "Infinity", hMm: number, hPx: number) => {
    if (R === "Infinity" || !Number.isFinite(R) || R === 0) return 0;
    const k = Math.min(1, (Math.abs(hMm) / Math.abs(R)) * 1.6);
    return (3 + hPx * 0.3 * k) * Math.sign(R);
  };
  for (const c of canonical.components) {
    if (c.kind === "free-space") continue;
    const src = sourceComps.find((b) => b.id === c.componentId);
    const warn = c.warnings.length > 0;
    const glassFill = warn ? "rgba(242,179,61,0.10)" : "rgba(140,180,235,0.10)";
    const glassStroke = warn ? "#F2B33D" : "#8FB4E3";
    const xs = x(c.startZmm);
    const xe = x(c.endZmm);
    const xc = (xs + xe) / 2;
    const apMm =
      src && "apertureRadiusMm" in src && src.apertureRadiusMm !== undefined
        ? src.apertureRadiusMm
        : src
          ? stackMinApertureMm(src)
          : undefined;
    const hMm = apMm !== undefined ? apMm : rMax * 0.55;
    const h = Math.min((hMm / rMax) * (yC - P.T), yC - P.T - 6);
    let label = c.componentId;
    if (c.kind === "aperture") {
      if (apMm !== undefined && apMm < rMax) {
        const yTop = y(apMm);
        const yBot = y(-apMm);
        const bladeColor = warn ? "#F2B33D" : "#8B94A3";
        glyphs.push({
          paths: [
            { d: `M${xc.toFixed(1)} ${P.T} V${yTop.toFixed(1)} M${xc.toFixed(1)} ${yBot.toFixed(1)} V${P.B}`, fill: "none", stroke: bladeColor, sw: 2.6 },
            {
              d: `M${(xc - 5).toFixed(1)} ${yTop.toFixed(1)} H${(xc + 5).toFixed(1)} M${(xc - 5).toFixed(1)} ${yBot.toFixed(1)} H${(xc + 5).toFixed(1)}`,
              fill: "none",
              stroke: bladeColor,
              sw: 1.3,
            },
          ],
        });
      }
    } else if (c.kind === "slab") {
      const wh = Math.max(4, (xe - xs) / 2);
      const t = yC - h;
      const b2 = yC + h;
      glyphs.push({
        paths: [
          {
            d: `M${(xc - wh).toFixed(1)} ${t.toFixed(1)} H${(xc + wh).toFixed(1)} V${b2.toFixed(1)} H${(xc - wh).toFixed(1)} Z`,
            fill: "rgba(111,168,245,0.09)",
            stroke: warn ? "#F2B33D" : "#6FA8F5",
            sw: 1.1,
          },
          {
            d: `M${(xc - wh * 0.4).toFixed(1)} ${(b2 - 5).toFixed(1)} L${(xc + wh * 0.5).toFixed(1)} ${(t + 5).toFixed(1)}`,
            fill: "none",
            stroke: "rgba(111,168,245,0.4)",
            sw: 0.9,
          },
        ],
      });
    } else if (c.kind === "thin-lens" || c.kind === "cylindrical-lens") {
      const f = src && "focalLengthMm" in src && Number.isFinite(src.focalLengthMm) ? src.focalLengthMm : 100;
      const s = Math.min(4 + h * 0.14, 13) * (f < 0 ? -1 : 1);
      const paths: GlyphPath[] = [{ d: lensPath(xc, yC, h, 4.5, s, s), fill: glassFill, stroke: glassStroke, sw: 1.2 }];
      if (c.kind === "cylindrical-lens") {
        paths.push({
          d: `M${xc.toFixed(1)} ${(yC - h + 5).toFixed(1)} V${(yC + h - 5).toFixed(1)}`,
          fill: "none",
          stroke: "rgba(143,180,227,0.5)",
          sw: 0.9,
        });
        label = `${c.componentId} · ${src && "axis" in src ? src.axis : ""}`;
      }
      glyphs.push({ paths });
    } else if (c.kind === "thick-lens") {
      const wh = Math.max(5, (xe - xs) / 2);
      const s1 = src && src.kind === "thick-lens" ? sag(src.radius1Mm, hMm, h) : 6;
      const s2 = src && src.kind === "thick-lens" ? -sag(src.radius2Mm, hMm, h) : 6;
      glyphs.push({ paths: [{ d: lensPath(xc, yC, h, wh, s1, s2), fill: glassFill, stroke: glassStroke, sw: 1.2 }] });
    } else if (c.kind === "surface-stack") {
      const wh = Math.max(6, (xe - xs) / 2);
      const stackSrc = src && src.kind === "surface-stack" ? src : undefined;
      const firstR = stackSrc?.surfaces[0]?.radiusMm;
      const lastR = stackSrc?.surfaces[stackSrc.surfaces.length - 1]?.radiusMm;
      const s1 = firstR !== undefined ? sag(firstR, hMm, h) : 5;
      const s2 = lastR !== undefined ? -sag(lastR, hMm, h) : 5;
      const paths: GlyphPath[] = [{ d: lensPath(xc, yC, h, wh, s1, s2), fill: glassFill, stroke: glassStroke, sw: 1.2 }];
      if (stackSrc && stackSrc.surfaces.length > 2) {
        const total = stackSrc.surfaces.reduce((sum, surface) => sum + surface.thicknessAfterMm, 0) || 1;
        let acc = 0;
        for (let si = 0; si < stackSrc.surfaces.length - 2; si += 1) {
          acc += stackSrc.surfaces[si].thicknessAfterMm;
          const xi = xs + (acc / total) * (xe - xs);
          paths.push({
            d: `M${xi.toFixed(1)} ${(yC - h + 4).toFixed(1)} V${(yC + h - 4).toFixed(1)}`,
            fill: "none",
            stroke: "rgba(143,180,227,0.45)",
            sw: 0.9,
          });
        }
      }
      glyphs.push({ paths });
    }
    compMarks.push({
      x: xc.toFixed(1),
      label,
      lineColor: warn ? "rgba(242,179,61,0.45)" : "rgba(46,57,74,0.8)",
      labelColor: warn ? "#F2B33D" : "#8B94A3",
    });
    if (apMm !== undefined && c.kind !== "aperture" && apMm <= rMax) {
      apMarks.push({
        x: xe.toFixed(1),
        topY: y(apMm).toFixed(1),
        botY: y(-apMm).toFixed(1),
        color: (c.apertureMargin ?? 99) < 1.5 ? "#F2B33D" : "#55617A",
      });
    }
  }
  const waistMarks: PlotVals["waistMarks"] = [];
  canonical.waists.forEach((w, i) => {
    if (w.zMm < -zEnd * 0.02 || w.zMm > zEnd) return;
    const color = w.axis === "x" ? palette[0] : palette[1];
    const wy = y(w.radiusMm);
    waistMarks.push({
      x: x(w.zMm).toFixed(1),
      y1: wy.toFixed(1),
      y2: y(-w.radiusMm).toFixed(1),
      cy: yC.toFixed(1),
      tx: (x(w.zMm) + 6).toFixed(1),
      ty: (P.B - 8 - i * 13).toFixed(1),
      anchor: x(w.zMm) > P.R - 130 ? "end" : "start",
      color,
      label: `w0${w.axis} ${fmtMm(w.radiusMm)} @ ${sig(w.zMm, 4)}mm`,
    });
  });
  return {
    envAreaX: area(rx),
    envAreaY: ry ? area(ry) : "",
    envLineX: line(rx, 1) + " " + line(rx, -1),
    envLineY: ry ? line(ry, 1) + " " + line(ry, -1) : "",
    zTicks,
    rTicks,
    compMarks,
    waistMarks,
    apMarks,
    glyphs,
    axisY: yC.toFixed(1),
    plotEnd: zEnd,
    z,
    rx,
    ry: ry ?? undefined,
  };
}

function ticksSvg(plot: PlotVals): string {
  return `
    ${plot.zTicks
      .map(
        (t) => `<line x1="${t.x}" y1="18" x2="${t.x}" y2="346" stroke="#1A212C" stroke-width="1"></line>
      <text x="${t.x}" y="362" fill="#5C6675" font-size="10.5" font-family="IBM Plex Mono" text-anchor="middle">${esc(t.label)}</text>`,
      )
      .join("")}
    ${plot.rTicks
      .map(
        (t) => `<line x1="54" y1="${t.y}" x2="924" y2="${t.y}" stroke="#1A212C" stroke-width="1"></line>
      <text x="48" y="${t.ly}" fill="#5C6675" font-size="10.5" font-family="IBM Plex Mono" text-anchor="end">${esc(t.label)}</text>`,
      )
      .join("")}
    <line x1="54" y1="${plot.axisY}" x2="924" y2="${plot.axisY}" stroke="#2A3442" stroke-width="1" stroke-dasharray="2 4"></line>`;
}

function marksSvg(plot: PlotVals): string {
  return `
    ${plot.apMarks
      .map(
        (a) => `<line x1="${a.x}" y1="18" x2="${a.x}" y2="${a.topY}" stroke="${a.color}" stroke-width="2.5"></line>
      <line x1="${a.x}" y1="${a.botY}" x2="${a.x}" y2="346" stroke="${a.color}" stroke-width="2.5"></line>`,
      )
      .join("")}
    ${plot.compMarks
      .map(
        (c) => `<line x1="${c.x}" y1="18" x2="${c.x}" y2="346" stroke="${c.lineColor}" stroke-width="1" stroke-dasharray="3 3"></line>
      <text x="${c.x}" y="12" fill="${c.labelColor}" font-size="10" font-family="IBM Plex Mono" text-anchor="middle">${esc(c.label)}</text>`,
      )
      .join("")}
    ${plot.glyphs
      .map((g) =>
        g.paths
          .map(
            (p) =>
              `<path d="${p.d}" fill="${p.fill}" stroke="${p.stroke}" stroke-width="${p.sw}" stroke-linecap="round" opacity="0.95"></path>`,
          )
          .join(""),
      )
      .join("")}
    ${plot.waistMarks
      .map(
        (w) => `<line x1="${w.x}" y1="${w.y1}" x2="${w.x}" y2="${w.y2}" stroke="${w.color}" stroke-width="1" stroke-dasharray="1.5 3"></line>
      <circle cx="${w.x}" cy="${w.cy}" r="2.6" fill="${w.color}"></circle>
      <text x="${w.tx}" y="${w.ty}" fill="${w.color}" font-size="10" font-family="IBM Plex Mono" text-anchor="${w.anchor}">${esc(w.label)}</text>`,
      )
      .join("")}`;
}

export function envelopeSvg(
  plot: PlotVals,
  opts: { interactive: boolean; envelopeArea?: boolean; palette?: [string, string] },
): string {
  const palette = opts.palette ?? PALETTE;
  const fillOn = opts.envelopeArea !== false;
  const hexToRgb = (hex: string) => {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!m) return "92,225,160";
    return `${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)}`;
  };
  const envFillX = `rgba(${hexToRgb(palette[0])},0.13)`;
  const envFillY = `rgba(${hexToRgb(palette[1])},0.10)`;
  return `
  <svg ${opts.interactive ? 'id="env-plot" style="cursor: crosshair;"' : ""} viewBox="0 0 940 380" class="plot-svg">
    <path d="M54 27 V18 H63 M915 18 H924 V27 M54 337 V346 H63 M915 346 H924 V337" stroke="#2A3442" stroke-width="1.2" fill="none"></path>
    ${ticksSvg(plot)}
    <text x="922" y="374" fill="#5C6675" font-size="10.5" font-family="IBM Plex Mono" text-anchor="end">z — mm</text>
    <text x="14" y="30" fill="#5C6675" font-size="10.5" font-family="IBM Plex Mono">mm</text>
    ${fillOn && plot.envAreaY ? `<path d="${plot.envAreaY}" fill="${envFillY}"></path>` : ""}
    ${fillOn && plot.envAreaX ? `<path d="${plot.envAreaX}" fill="${envFillX}"></path>` : ""}
    ${plot.envLineY ? `<path d="${plot.envLineY}" stroke="${palette[1]}" stroke-width="5" fill="none" opacity="0.09"></path>` : ""}
    ${plot.envLineX ? `<path d="${plot.envLineX}" stroke="${palette[0]}" stroke-width="6" fill="none" opacity="0.11"></path>` : ""}
    ${plot.envLineY ? `<path d="${plot.envLineY}" stroke="${palette[1]}" stroke-width="1.5" fill="none" opacity="0.9"></path>` : ""}
    ${plot.envLineX ? `<path d="${plot.envLineX}" stroke="${palette[0]}" stroke-width="1.7" fill="none"></path>` : ""}
    ${marksSvg(plot)}
    ${opts.interactive ? `<line id="hover-line" x1="0" y1="18" x2="0" y2="346" stroke="#4A5A70" stroke-width="1" visibility="hidden"></line>` : ""}
  </svg>`;
}
