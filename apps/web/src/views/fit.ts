// Beam-fit tab (measured caustic → least-squares fit) — from the design source.

import { gaussianRadiusAtZ } from "../../../../packages/api/src/index.ts";
import { esc, fmtMm, sig } from "../format.ts";
import type { Strings } from "../i18n.ts";
import { S } from "../store.ts";
import { bareInput, fieldCol, warnLines } from "./ui.ts";

function fitPlot(): { dots: Array<{ cx: string; cy: string }>; curve: string; zTicks: Array<{ x: string; label: string }>; rTicks: Array<{ y: string; label: string }>; hasData: boolean } {
  const fit = S.fit;
  const meas = fit.meas;
  const res = fit.res;
  const out = { dots: [] as Array<{ cx: string; cy: string }>, curve: "", zTicks: [] as Array<{ x: string; label: string }>, rTicks: [] as Array<{ y: string; label: string }>, hasData: false };
  if (!meas || meas.length === 0) return out;
  const zMin = Math.min(...meas.map((m) => m.zMm));
  const zMax = Math.max(...meas.map((m) => m.zMm));
  const span = Math.max(zMax - zMin, 1e-6);
  const z0 = zMin - span * 0.06;
  const z1 = zMax + span * 0.06;
  let rMax = Math.max(...meas.map((m) => m.radiusMm));
  const curvePts: Array<[number, number]> = [];
  if (res?.ok && res.waistPositionMm !== undefined && res.waistRadiusMm !== undefined) {
    // fitted curve rendered from core gaussianRadiusAtZ — display sampling only
    for (let i = 0; i <= 120; i += 1) {
      const zv = z0 + ((z1 - z0) * i) / 120;
      const rv = gaussianRadiusAtZ(zv - res.waistPositionMm, res.waistRadiusMm, Number(fit.lambda), res.m2);
      curvePts.push([zv, rv]);
      rMax = Math.max(rMax, rv);
    }
  }
  rMax *= 1.15;
  const L = 52;
  const R = 624;
  const T2 = 14;
  const B = 268;
  const x = (zv: number) => L + ((zv - z0) / (z1 - z0)) * (R - L);
  const y = (rv: number) => B - (rv / rMax) * (B - T2);
  out.hasData = true;
  out.dots = meas.map((m) => ({ cx: x(m.zMm).toFixed(1), cy: y(m.radiusMm).toFixed(1) }));
  out.curve = curvePts.map(([zv, rv], i) => `${i === 0 ? "M" : "L"}${x(zv).toFixed(1)} ${y(rv).toFixed(1)}`).join(" ");
  const step = (z1 - z0) / 5;
  for (let i = 0; i <= 5; i += 1) out.zTicks.push({ x: x(z0 + step * i).toFixed(1), label: sig(z0 + step * i, 3) });
  for (let i = 1; i <= 3; i += 1) out.rTicks.push({ y: y((rMax * i) / 3.5).toFixed(1), label: sig((rMax * i) / 3.5, 2) });
  return out;
}

export function renderFitTab(T: Strings): string {
  const fit = S.fit;
  const res = fit.res;
  const meas = fit.meas;
  const plot = fitPlot();
  const fitWarnRows = [...fit.errs, ...(res?.warnings ?? []).map((w) => `${w.code} — ${w.message}`)];
  const hasFitResult = !!res && res.ok;
  const tile = (label: string, value: string, color = "#E7ECF4") =>
    `<div class="mf-card result-tile"><div class="tile-label">${esc(label)}</div><div class="tile-value" style="color: ${color};">${esc(value)}</div></div>`;
  return `
  <div class="wb-workspace">
    <div class="wb-side w330">
      <div style="display: flex; flex-direction: column; gap: 4px;">
        <div class="mf-sec-title">${esc(T.fitTitle)}</div>
        <div style="font: 400 11px 'IBM Plex Mono'; color: #8B94A3; line-height: 1.5;">${esc(T.fitIntro)}</div>
      </div>
      <div style="display: flex; align-items: center; gap: 8px;">
        <button data-act="fit-sample" class="btn-dashed">${esc(T.sampleCaustic)}</button>
        <div class="mf-note">${meas ? `${meas.length} ${esc(T.pointsWord)}` : ""}</div>
      </div>
      <textarea data-k="fitCsv" rows="13" placeholder="# z_mm  width&#10;0    0.141&#10;10   0.128&#10;20   0.119&#10;…" spellcheck="false" class="mf-textarea" style="line-height: 1.6;">${esc(fit.csv)}</textarea>
      <div style="display: flex; flex-direction: column; gap: 8px;">
        <div class="field-col">
          <label class="mf-lbl">${esc(T.widthColBasis)}</label>
          <select data-k="fitBasis" class="mf-select">
            <option value="one_over_e2_radius"${fit.basis === "one_over_e2_radius" ? " selected" : ""}>${esc(T.b1e2)}</option>
            <option value="fwhm_diameter"${fit.basis === "fwhm_diameter" ? " selected" : ""}>${esc(T.bFwhm)}</option>
            <option value="d4sigma_diameter"${fit.basis === "d4sigma_diameter" ? " selected" : ""}>${esc(T.bD4)}</option>
            <option value="rms_radius"${fit.basis === "rms_radius" ? " selected" : ""}>${esc(T.bRms)}</option>
          </select>
        </div>
        ${fieldCol(T.wavelengthUm, bareInput("fitLambda", fit.lambda, { blur: false }))}
      </div>
      <button data-act="run-fit" class="btn-primary">${esc(T.runFit)}</button>
    </div>

    <div class="wb-center">
      ${warnLines(fitWarnRows)}
      ${
        hasFitResult && res
          ? `<div style="display: grid; grid-template-columns: repeat(6, 1fr); gap: 10px;">
              ${tile(T.fitW0, fmtMm(res.waistRadiusMm))}
              ${tile(T.fitZ0, `${sig(res.waistPositionMm, 4)} mm`)}
              ${tile(T.fitTheta, `${sig((res.divergenceHalfAngleRad ?? Number.NaN) * 1000)} mrad`)}
              ${tile("M²", sig(res.m2, 4), "#5CE1A0")}
              ${tile(T.fitRms, fmtMm(res.residualRmsMm))}
              ${tile(T.fitMaxRes, res.maxRelativeResidual !== undefined ? `${(res.maxRelativeResidual * 100).toFixed(2)}%` : "—")}
            </div>`
          : ""
      }
      ${
        plot.hasData
          ? `<div class="mf-card">
              <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 4px;">
                <div class="mf-card-title">${esc(T.causticTitle)}</div>
                <div style="display: flex; align-items: center; gap: 5px;"><span style="width: 8px; height: 8px; border-radius: 50%; border: 1.5px solid #6FA8F5;"></span><span style="font: 500 10.5px 'IBM Plex Mono'; color: #97A1B2;">${esc(T.measured)}</span></div>
                <div style="display: flex; align-items: center; gap: 5px;"><span style="width: 14px; height: 3px; border-radius: 2px; background: #5CE1A0;"></span><span style="font: 500 10.5px 'IBM Plex Mono'; color: #97A1B2;">${esc(T.fitCurve)}</span></div>
                <div style="flex: 1;"></div>
                ${hasFitResult ? `<button data-act="apply-fit-beam" class="btn-solid">${esc(T.useAsBeam)}</button>` : ""}
              </div>
              <svg viewBox="0 0 640 300" class="plot-svg" style="max-width: 860px;">
                ${plot.zTicks
                  .map(
                    (t) => `<line x1="${t.x}" y1="14" x2="${t.x}" y2="268" stroke="#1A212C" stroke-width="1"></line>
                  <text x="${t.x}" y="284" fill="#5C6675" font-size="10" font-family="IBM Plex Mono" text-anchor="middle">${esc(t.label)}</text>`,
                  )
                  .join("")}
                ${plot.rTicks
                  .map(
                    (t) => `<line x1="52" y1="${t.y}" x2="624" y2="${t.y}" stroke="#1A212C" stroke-width="1"></line>
                  <text x="46" y="${t.y}" fill="#5C6675" font-size="10" font-family="IBM Plex Mono" text-anchor="end">${esc(t.label)}</text>`,
                  )
                  .join("")}
                <text x="622" y="296" fill="#5C6675" font-size="10" font-family="IBM Plex Mono" text-anchor="end">z — mm</text>
                <text x="14" y="26" fill="#5C6675" font-size="10" font-family="IBM Plex Mono">w mm</text>
                ${plot.curve ? `<path d="${plot.curve}" stroke="#5CE1A0" stroke-width="1.7" fill="none"></path>` : ""}
                ${plot.dots.map((d) => `<circle cx="${d.cx}" cy="${d.cy}" r="3.2" fill="none" stroke="#6FA8F5" stroke-width="1.5"></circle>`).join("")}
              </svg>
            </div>`
          : ""
      }
      ${hasFitResult ? `<div class="mf-note-faint">${esc(T.fitNote)}</div>` : ""}
    </div>
  </div>`;
}
