// Field tab (scalar field-fresnel job) — transcribed from the design source.

import { gaussianRadiusAtZ } from "../../../../packages/api/src/index.ts";
import { computeSim } from "../compute.ts";
import { esc, fmtMm, sig } from "../format.ts";
import type { Strings } from "../i18n.ts";
import { S } from "../store.ts";
import { bareInput, fieldCol, segBtn, toggle, warnLines } from "./ui.ts";

export function projectBeamW0(): number {
  const beam = S.project.beam;
  if (beam.kind === "gaussian") return beam.waistRadiusMm;
  if (beam.kind === "elliptical-gaussian") return beam.waistRadiusXmm;
  return beam.d4SigmaDiameterXmm / 2;
}

function progressBar(T: Strings): string {
  const p = S.fld.progress;
  if (!S.fld.busy || !p || p.total === 0) return "";
  const pct = Math.round((p.done / p.total) * 100);
  return `
    <div style="display: flex; flex-direction: column; gap: 4px;">
      <div class="progress-track"><div class="progress-fill" style="width: ${pct}%;"></div></div>
      <div class="mf-note" style="text-align: right;">${esc(T.segmentWord)} ${p.done}/${p.total} · ${pct}%</div>
    </div>`;
}

function modeSeg(T: Strings): string {
  return `
    <div class="mf-seg">
      ${segBtn("fld-mode", "beamline", T.modeBeamline, S.fld.mode === "beamline")}
      ${segBtn("fld-mode", "source", T.modeSource, S.fld.mode === "source")}
    </div>`;
}


function srcModeRow(T: Strings): string {
  const f = S.fld;
  const orders =
    f.srcMode === "gauss"
      ? ""
      : `<div style="display: flex; gap: 6px; align-items: center;">
          <span class="mf-lbl">${f.srcMode === "hg" ? "m" : "p"}</span><span style="width: 46px;">${bareInput("fldMp1", f.mp1, { small: true, blur: false })}</span>
          <span class="mf-lbl">${f.srcMode === "hg" ? "n" : "l"}</span><span style="width: 46px;">${bareInput("fldMp2", f.mp2, { small: true, blur: false })}</span>
        </div>`;
  return `
    <div style="display: flex; flex-direction: column; gap: 6px;">
      <div class="mf-sec-title">${esc(T.fieldSourceMode)}</div>
      <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
        <div class="mf-seg">
          ${segBtn("fld-srcmode", "gauss", T.modeFundamental, f.srcMode === "gauss")}
          ${segBtn("fld-srcmode", "hg", "HG", f.srcMode === "hg")}
          ${segBtn("fld-srcmode", "lg", "LG", f.srcMode === "lg")}
        </div>
        ${orders}
      </div>
    </div>`;
}

function renderBeamlineMode(T: Strings): string {
  const f = S.fld;
  const res = f.resB;
  const sim = computeSim(S);
  const totalLen = sim.canonical?.zGridMm.at(-1) ?? 0;
  const zProbe = f.bz.trim() === "" ? totalLen : Number(f.bz);
  const probeIn = res && res.probes.length > 0 ? res.probes[0] : null;
  const probeOut = res && res.probes.length > 0 ? res.probes[res.probes.length - 1] : null;
  const transmission = probeIn && probeOut && probeIn.power > 0 ? (probeOut.power / probeIn.power) * 100 : 0;
  const warnRows = [...f.errs, ...(res?.warnings ?? []).map((w) => `${w.code} — ${w.message}${w.zMm !== undefined ? ` (z ${sig(w.zMm, 4)}mm)` : ""}`)];
  const tile = (label: string, value: string, color = "#E7ECF4") =>
    `<div class="mf-card result-tile"><div class="tile-label">${esc(label)}</div><div class="tile-value" style="color: ${color};">${esc(value)}</div></div>`;

  // analytic cross-check at the probe plane: nearest sample of the densified
  // core envelope (display-only lookup — the UI computes no physics)
  let cross = "";
  const dense = sim.dense;
  if (probeOut && dense && dense.zGridMm.length > 0 && probeOut.zMm <= (dense.zGridMm.at(-1) ?? 0) + 1e-9) {
    let best = 0;
    let bestD = Number.POSITIVE_INFINITY;
    dense.zGridMm.forEach((z, i) => {
      const d = Math.abs(z - probeOut.zMm);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    const ax = dense.envelope.radiusXmm[best];
    const ay = dense.envelope.radiusYmm?.[best];
    const relX = ax > 0 ? Math.abs(probeOut.radiusXmm - ax) / ax : 0;
    const relY = ay !== undefined && ay > 0 ? Math.abs(probeOut.radiusYmm - ay) / ay : undefined;
    const hasAperture = S.project.beamline.some(
      (c) => c.kind === "aperture" || ("apertureRadiusMm" in c && c.apertureRadiusMm !== undefined),
    );
    const worst = Math.max(relX, relY ?? 0);
    const hasSamplingWarning = (res?.warnings ?? []).some((w) => w.code === "FIELD_SAMPLING_LOW" && w.severity === "warning");
    const color = hasSamplingWarning ? "#F2B33D" : hasAperture ? "#6FA8F5" : worst < 0.02 ? "#5CE1A0" : "#F2B33D";
    const note = hasSamplingWarning ? T.analyticNoteSampling : hasAperture ? T.analyticNoteAp : worst < 0.02 ? T.analyticNoteOk : T.analyticNoteBad;
    const parts = [`${T.fieldVsWord} wx ${fmtMm(probeOut.radiusXmm)} ${T.vsParaxialWord} ${fmtMm(ax)} · Δ ${(relX * 100).toFixed(2)}%`];
    if (relY !== undefined && ay !== undefined) parts.push(`wy ${fmtMm(probeOut.radiusYmm)} ${T.vsParaxialWord} ${fmtMm(ay)} · Δ ${(relY * 100).toFixed(2)}%`);
    cross = `
      <div class="mf-card">
        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 6px; flex-wrap: wrap;">
          <div class="mf-card-title">${esc(T.crossCheckAtZ)} = ${esc(sig(probeOut.zMm, 4))} mm</div>
          <span style="font: 600 12px 'IBM Plex Mono'; color: ${color};">${esc(parts.join(" · "))}</span>
        </div>
        <div style="font: 400 11px 'Space Grotesk'; color: #97A1B2; line-height: 1.5;">${esc(note)}</div>
      </div>`;
  }

  return `
  <div class="wb-workspace">
    <div class="wb-side w330">
      <div style="display: flex; flex-direction: column; gap: 4px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <div class="mf-sec-title">${esc(T.fieldTitle)}</div>
          <div style="font: 500 9px 'IBM Plex Mono'; letter-spacing: 0.08em; color: #6FA8F5; border: 1px solid rgba(111,168,245,0.3); border-radius: 4px; padding: 2px 6px; white-space: nowrap; flex: none;">${esc(T.scalarBadge)}</div>
        </div>
        <div style="font: 400 11px 'IBM Plex Mono'; color: #8B94A3; line-height: 1.5;">${esc(T.beamlineIntro)}</div>
      </div>

      ${modeSeg(T)}
      ${srcModeRow(T)}

      <div style="display: flex; flex-direction: column; gap: 8px;">
        <div class="mf-sec-title">${esc(T.planesQuick)}</div>
        <div style="display: flex; gap: 4px; flex-wrap: wrap;">
          <button data-act="fld-chip" data-arg="0" class="btn-dashed">${esc(T.source)} · 0</button>
          ${(sim.canonical?.components ?? [])
            .map(
              (c) =>
                `<button data-act="fld-chip" data-arg="${esc(sig(c.endZmm, 6))}" class="btn-dashed">${esc(c.componentId)} · ${esc(sig(c.endZmm, 4))}</button>`,
            )
            .join("")}
        </div>
        ${fieldCol(T.probeZ, bareInput("bz", f.bz, { blur: false, placeholder: sig(totalLen, 4) }))}
      </div>

      <div style="display: flex; flex-direction: column; gap: 8px;">
        <div class="mf-sec-title">${esc(T.propagation)}</div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
          ${fieldCol(T.gridN, bareInput("fldN", f.n, { blur: false }))}
          <div class="field-col">
            <label class="mf-lbl">${esc(T.spacingDx)}</label>
            <div style="display: flex; gap: 4px;">
              <span style="flex: 1; min-width: 0;">${bareInput("fldDx", f.dx, { blur: false })}</span>
              <button data-act="fld-auto-dx" class="btn-dashed" style="flex: none;">${esc(T.autoDx)}</button>
            </div>
          </div>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
          <div class="field-col">
            <label class="mf-lbl">${esc(T.method)}</label>
            <select data-k="fldMethod" class="mf-select">
              <option value="fresnel"${f.method === "fresnel" ? " selected" : ""}>Fresnel TF</option>
              <option value="angular-spectrum"${f.method === "angular-spectrum" ? " selected" : ""}>${esc(T.angularSpectrum)}</option>
            </select>
          </div>
          <div class="field-col">
            <label class="mf-lbl">${esc(T.surfacePhase)}</label>
            <select data-k="fldSp" class="mf-select">
              <option value="ideal"${f.sp === "ideal" ? " selected" : ""}>${esc(T.spIdeal)}</option>
              <option value="real-sag"${f.sp === "real-sag" ? " selected" : ""}>${esc(T.spSag)}</option>
            </select>
          </div>
        </div>
        <div class="mf-note">${esc(`${T.extentWord} ±${sig(((Number(f.n) || 48) * (Number(f.dx) || 0.05)) / 2, 3)} mm · ${T.extentCap}`)}</div>
        ${f.sp === "real-sag" ? `<div class="mf-note">${esc(T.sagNote)}</div>` : ""}
      </div>

      <button data-act="run-field-beamline" class="btn-primary">${esc(f.busy ? T.propagating : T.runField)}</button>
      ${progressBar(T)}

      <div class="mf-note-faint">${esc(T.beamlineNote)}</div>
    </div>

    <div class="wb-center">
      ${warnLines(warnRows)}
      ${
        probeIn && probeOut
          ? `<div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px;">
              ${tile(T.powerIn, sig(probeIn.power, 4))}
              ${tile(T.powerAtZ, sig(probeOut.power, 4))}
              ${tile("TRANSMISSION", `${sig(transmission, 4)}%`, transmission < 99 ? "#F2B33D" : "#E7ECF4")}
              ${tile("MOMENT Rx", fmtMm(probeOut.radiusXmm))}
              ${tile("MOMENT Ry", fmtMm(probeOut.radiusYmm))}
            </div>
            ${cross}
            <div style="display: flex; gap: 12px; flex-wrap: wrap;">
              <div class="mf-card" style="flex: 1; min-width: 320px;">
                <div class="mf-card-title" style="margin-bottom: 10px;">${esc(T.inputPlane)}</div>
                <canvas id="field-canvas-in" class="field-canvas"></canvas>
              </div>
              <div class="mf-card" style="flex: 1; min-width: 320px;">
                <div class="mf-card-title" style="margin-bottom: 10px;">${esc(T.probePlane)} (z = ${esc(sig(probeOut.zMm, 4))} mm)</div>
                <canvas id="field-canvas-out" class="field-canvas"></canvas>
              </div>
            </div>
            <div class="mf-note-faint">${esc(T.dftNote)}</div>`
          : ""
      }
    </div>
  </div>`;
}

export function renderFieldTab(T: Strings): string {
  if (S.fld.mode === "beamline") return renderBeamlineMode(T);
  return renderSourceMode(T);
}

function renderSourceMode(T: Strings): string {
  const f = S.fld;
  const res = f.res;
  const beam = S.project.beam;
  const transmission = res ? (res.outputPower / res.inputPower) * 100 : 0;
  const fieldWarnRows = [...f.errs, ...(res?.warnings ?? []).map((w) => `${w.code} — ${w.message}`)];
  // Cross-check vs Fast Mode: the field starts at its waist, so the paraxial
  // envelope at distance d is closed-form (core gaussianRadiusAtZ).
  let analytic: { wA: number; rel: number } | null = null;
  if (res) {
    try {
      const m2xMode =
        f.srcMode === "hg"
          ? 2 * Math.max(0, Math.round(Number(f.mp1) || 0)) + 1
          : f.srcMode === "lg"
            ? 2 * Math.max(0, Math.round(Number(f.mp1) || 0)) + Math.abs(Math.round(Number(f.mp2) || 0)) + 1
            : 1;
      const wA = gaussianRadiusAtZ(Number(f.dist), Number(f.waist), Number(f.lambda), m2xMode);
      analytic = { wA, rel: Math.abs(res.momentRadiusXmm - wA) / wA };
    } catch {
      analytic = null;
    }
  }
  const analyticColor = analytic && (analytic.rel < 0.02 || f.apOn) ? (f.apOn ? "#6FA8F5" : "#5CE1A0") : "#F2B33D";
  const analyticNote = f.apOn ? T.analyticNoteAp : analytic && analytic.rel < 0.02 ? T.analyticNoteOk : T.analyticNoteBad;
  const extent = `${T.extentWord} ±${sig(((Number(f.n) || 48) * (Number(f.dx) || 0.05)) / 2, 3)} mm · ${T.extentCap}`;
  const tile = (label: string, value: string, color = "#E7ECF4") =>
    `<div class="mf-card result-tile"><div class="tile-label">${esc(label)}</div><div class="tile-value" style="color: ${color};">${esc(value)}</div></div>`;

  return `
  <div class="wb-workspace">
    <div class="wb-side w330">
      <div style="display: flex; flex-direction: column; gap: 4px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <div class="mf-sec-title">${esc(T.fieldTitle)}</div>
          <div style="font: 500 9px 'IBM Plex Mono'; letter-spacing: 0.08em; color: #6FA8F5; border: 1px solid rgba(111,168,245,0.3); border-radius: 4px; padding: 2px 6px; white-space: nowrap; flex: none;">${esc(T.scalarBadge)}</div>
        </div>
        <div style="font: 400 11px 'IBM Plex Mono'; color: #8B94A3; line-height: 1.5;">${esc(T.fieldIntro)}</div>
      </div>

      ${modeSeg(T)}
      ${srcModeRow(T)}

      <div style="display: flex; flex-direction: column; gap: 8px;">
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
          <div class="mf-sec-title">${esc(T.fieldSource)}</div>
          <button data-act="fld-sync" class="btn-dashed" style="font-size: 10px;">${esc(T.useProjectBeam)}</button>
        </div>
        <div class="mf-note">${esc(T.projectBeamWord)}: λ ${esc(sig(beam.wavelengthUm, 4))} µm · w0 ${esc(fmtMm(projectBeamW0()))}</div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
          ${fieldCol(T.gridN, bareInput("fldN", f.n, { blur: false }))}
          ${fieldCol(T.spacingDx, bareInput("fldDx", f.dx, { blur: false }))}
          ${fieldCol(T.wavelengthUm, bareInput("fldLambda", f.lambda, { blur: false }))}
          ${fieldCol(T.fieldWaist, bareInput("fldWaist", f.waist, { blur: false }))}
        </div>
        <div class="mf-note">${esc(extent)}</div>
      </div>

      <div style="display: flex; flex-direction: column; gap: 8px;">
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <div class="mf-sec-title">${esc(T.hardAperture)}</div>
          ${toggle("fld-ap-toggle", f.apOn)}
        </div>
        ${f.apOn ? fieldCol(T.apertureR, bareInput("fldAp", f.ap, { blur: false })) : ""}
      </div>

      <div style="display: flex; flex-direction: column; gap: 8px;">
        <div class="mf-sec-title">${esc(T.propagation)}</div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
          ${fieldCol(T.distance, bareInput("fldDist", f.dist, { blur: false }))}
          <div class="field-col">
            <label class="mf-lbl">${esc(T.method)}</label>
            <select data-k="fldMethod" class="mf-select">
              <option value="fresnel"${f.method === "fresnel" ? " selected" : ""}>Fresnel TF</option>
              <option value="angular-spectrum"${f.method === "angular-spectrum" ? " selected" : ""}>${esc(T.angularSpectrum)}</option>
            </select>
          </div>
        </div>
      </div>

      <button data-act="run-field" class="btn-primary">${esc(f.busy ? T.propagating : T.runField)}</button>
      ${progressBar(T)}

      <div class="mf-note-faint">${esc(T.fieldJobNote)}</div>
    </div>

    <div class="wb-center">
      ${warnLines(fieldWarnRows)}
      ${
        res
          ? `<div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px;">
              ${tile(T.powerIn, sig(res.inputPower, 4))}
              ${tile(T.powerOut, sig(res.outputPower, 4))}
              ${tile("TRANSMISSION", `${sig(transmission, 4)}%`, transmission < 99 ? "#F2B33D" : "#E7ECF4")}
              ${tile("MOMENT Rx", fmtMm(res.momentRadiusXmm))}
              ${tile("MOMENT Ry", fmtMm(res.momentRadiusYmm))}
            </div>
            ${
              analytic
                ? `<div class="mf-card">
                    <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 6px;">
                      <div class="mf-card-title">${esc(T.crossCheck)}</div>
                      <span style="font: 600 12px 'IBM Plex Mono'; color: ${analyticColor};">${esc(T.fieldVsWord)} ${esc(fmtMm(res.momentRadiusXmm))} ${esc(T.vsParaxialWord)} ${esc(fmtMm(analytic.wA))} · Δ ${(analytic.rel * 100).toFixed(2)}%</span>
                    </div>
                    <div style="font: 400 11px 'Space Grotesk'; color: #97A1B2; line-height: 1.5;">${esc(analyticNote)}</div>
                  </div>`
                : ""
            }
            <div style="display: flex; gap: 12px; flex-wrap: wrap;">
              <div class="mf-card" style="flex: 1; min-width: 320px;">
                <div class="mf-card-title" style="margin-bottom: 10px;">${esc(T.inputPlane)}</div>
                <canvas id="field-canvas-in" class="field-canvas"></canvas>
              </div>
              <div class="mf-card" style="flex: 1; min-width: 320px;">
                <div class="mf-card-title" style="margin-bottom: 10px;">${esc(T.outputPlane)}</div>
                <canvas id="field-canvas-out" class="field-canvas"></canvas>
              </div>
            </div>
            <div class="mf-note-faint">${esc(T.dftNote)}</div>`
          : ""
      }
    </div>
  </div>`;
}
