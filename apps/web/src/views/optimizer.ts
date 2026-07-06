// Optimizer tab — layout and bindings transcribed from the Claude Design source.

import { relativeError, type BeamlineComponent, type TwoLensSolution } from "../../../../packages/api/src/index.ts";
import { denseRunFor } from "../compute.ts";
import { esc, fmtMm, sig } from "../format.ts";
import type { Strings } from "../i18n.ts";
import { envelopeSvg, plotVals, type PlotVals } from "../plot.ts";
import { S } from "../store.ts";
import { bareInput, fieldCol, toggle, warnLines } from "./ui.ts";

export function rangeArray(from: string, to: string, step: string): number[] {
  const f = Number(from);
  const t = Number(to);
  const st = Number(step);
  if (!Number.isFinite(f) || !Number.isFinite(t) || !Number.isFinite(st) || st <= 0) return [];
  const out: number[] = [];
  for (let v = f; v <= t + 1e-9 && out.length < 60; v += st) out.push(Number(v.toFixed(6)));
  return out;
}

export function solutionComponents(sol: TwoLensSolution): BeamlineComponent[] {
  return [
    { id: "pre-lens-1", kind: "free-space", lengthMm: sol.lens1Zmm },
    { id: sol.lens1.id, kind: "thin-lens", focalLengthMm: sol.lens1.focalLengthMm, apertureRadiusMm: sol.lens1.apertureRadiusMm },
    { id: "between-lenses", kind: "free-space", lengthMm: sol.lens2Zmm - sol.lens1Zmm },
    { id: sol.lens2.id, kind: "thin-lens", focalLengthMm: sol.lens2.focalLengthMm, apertureRadiusMm: sol.lens2.apertureRadiusMm },
    { id: "to-target", kind: "free-space", lengthMm: sol.targetZmm - sol.lens2Zmm },
  ];
}

function leftPanel(T: Strings): string {
  const o = S.opt;
  const combos = rangeArray(o.l1From, o.l1To, o.l1Step).length * rangeArray(o.l2From, o.l2To, o.l2Step).length * o.lenses.length * o.lenses.length;
  return `
  <div class="wb-side w330 gap16">
    <div style="display: flex; flex-direction: column; gap: 4px;">
      <div class="mf-sec-title">${esc(T.optTitle)}</div>
      <div style="font: 400 11px 'IBM Plex Mono'; color: #8B94A3; line-height: 1.5;">${esc(T.optIntro)}</div>
    </div>

    <div style="display: flex; flex-direction: column; gap: 8px;">
      <div style="display: flex; align-items: center; gap: 8px;">
        <div class="mf-sec-title">${esc(T.lensCandidates)}</div>
        <div style="flex: 1;"></div>
        <button data-act="opt-add-lens" class="btn-dashed" style="padding: 3px 8px;">${esc(T.addLens)}</button>
      </div>
      <div style="display: grid; grid-template-columns: 1fr 74px 64px 26px; gap: 6px; font: 500 9.5px 'IBM Plex Mono'; color: #5C6675; padding: 0 2px;">
        <span>ID</span><span>f mm</span><span>ap mm</span><span></span>
      </div>
      ${o.lenses
        .map(
          (l, i) => `
        <div style="display: grid; grid-template-columns: 1fr 74px 64px 26px; gap: 6px; align-items: center;">
          ${bareInput(`ol-id-${i}`, l.id, { small: true, blur: false })}
          ${bareInput(`ol-f-${i}`, l.f, { small: true, blur: false })}
          ${bareInput(`ol-ap-${i}`, l.ap, { small: true, blur: false })}
          <button data-act="opt-del-lens" data-arg="${i}" class="icon-x">✕</button>
        </div>`,
        )
        .join("")}
    </div>

    <div style="display: flex; flex-direction: column; gap: 8px;">
      <div class="mf-sec-title">${esc(T.searchGrid)}</div>
      <div style="display: grid; grid-template-columns: 44px 1fr 1fr 1fr; gap: 6px; align-items: center;">
        <span class="mf-lbl">L1 z</span>
        ${bareInput("l1From", o.l1From, { small: true, blur: false, placeholder: "from" })}
        ${bareInput("l1To", o.l1To, { small: true, blur: false, placeholder: "to" })}
        ${bareInput("l1Step", o.l1Step, { small: true, blur: false, placeholder: "step" })}
        <span class="mf-lbl">L2 z</span>
        ${bareInput("l2From", o.l2From, { small: true, blur: false, placeholder: "from" })}
        ${bareInput("l2To", o.l2To, { small: true, blur: false, placeholder: "to" })}
        ${bareInput("l2Step", o.l2Step, { small: true, blur: false, placeholder: "step" })}
      </div>
      <div class="mf-note">${combos} ${esc(T.candWord)}</div>
    </div>

    <div style="display: flex; flex-direction: column; gap: 8px;">
      <div class="mf-sec-title">${esc(T.target)}</div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
        ${fieldCol(T.targetPlane, bareInput("targetZ", o.targetZ, { small: true, blur: false }))}
        ${fieldCol(T.radiusAtTarget, bareInput("targetRadius", o.targetRadius, { small: true, blur: false, placeholder: "—" }))}
        ${fieldCol(T.targetWaistR, bareInput("targetWaistRadius", o.targetWaistRadius, { small: true, blur: false, placeholder: "—" }))}
        ${fieldCol(T.targetWaistZ, bareInput("targetWaistZ", o.targetWaistZ, { small: true, blur: false, placeholder: "—" }))}
      </div>
      <div class="mf-note">${esc(T.targetNote)}</div>
    </div>

    <div style="display: flex; flex-direction: column; gap: 8px;">
      <div class="mf-sec-title">${esc(T.constraints)}</div>
      <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px;">
        ${fieldCol(T.minSep, bareInput("minSep", o.minSep, { small: true, blur: false }))}
        ${fieldCol(T.apMarginMin, bareInput("marginMin", o.marginMin, { small: true, blur: false }))}
        ${fieldCol(T.maxResults, bareInput("maxResults", o.maxResults, { small: true, blur: false }))}
      </div>
    </div>

    <div style="display: flex; flex-direction: column; gap: 8px;">
      <div style="display: flex; align-items: center; justify-content: space-between;">
        <div class="mf-sec-title">${esc(T.sensitivity)}</div>
        ${toggle("opt-sens-toggle", o.sensOn)}
      </div>
      ${
        o.sensOn
          ? `<div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px;">
              ${fieldCol(T.sensShift, bareInput("sensShift", o.sensShift, { small: true, blur: false }))}
              ${fieldCol("± f mm", bareInput("sensFocal", o.sensFocal, { small: true, blur: false }))}
              ${fieldCol("± M²", bareInput("sensM2", o.sensM2, { small: true, blur: false }))}
            </div>`
          : ""
      }
      <div style="display: flex; align-items: center; justify-content: space-between;">
        <div style="font: 500 11px 'Space Grotesk'; color: #97A1B2;">${esc(T.optPulseLabel)}</div>
        ${toggle("opt-pulse-toggle", o.usePulse)}
      </div>
    </div>

    <button data-act="run-opt" class="btn-primary">${esc(S.optBusy ? T.searching : T.runOpt)}</button>
  </div>`;
}

function resultsPanel(T: Strings): string {
  const res = S.optResult;
  const optWarnRows = [
    ...S.optErrors.map((t) => `INVALID_INPUT — ${t}`),
    ...(res?.warnings ?? []).map((w) => `${w.code} — ${w.message}`),
  ];
  const selSol = res?.solutions.find((x) => x.rank === S.optSel) ?? null;
  let optPlot: PlotVals | null = null;
  let comps: BeamlineComponent[] = [];
  if (selSol) {
    // re-simulate the winning layout densified for a smooth envelope (same
    // components the optimizer built) — computed by the core, not the UI
    comps = solutionComponents(selSol);
    const dense = denseRunFor(S.project.beam, comps, 0);
    optPlot = plotVals(dense, selSol.beamline, comps);
  }
  const solRows = (res?.solutions ?? [])
    .map((sol) => {
      const mismatch =
        sol.targetRadiusMm !== undefined ? `${(relativeError(sol.achievedRadiusMm, sol.targetRadiusMm) * 100).toFixed(1)}%` : sig(sol.score, 3);
      return `
      <button data-act="opt-sel" data-arg="${sol.rank}" class="sol-row${S.optSel === sol.rank ? " active" : ""}">
        <span style="font: 600 12px 'IBM Plex Mono'; color: #5CE1A0;">#${sol.rank}</span>
        <span style="font: 500 11.5px 'IBM Plex Mono'; color: #E7ECF4;">${esc(sol.lens1.id)} @ ${esc(sig(sol.lens1Zmm, 4))} · ${esc(sol.lens2.id)} @ ${esc(sig(sol.lens2Zmm, 4))}</span>
        <span style="font: 500 11.5px 'IBM Plex Mono'; color: #E7ECF4;">${esc(fmtMm(sol.achievedRadiusMm))}</span>
        <span style="font: 500 11.5px 'IBM Plex Mono'; color: #97A1B2;">${esc(mismatch)}</span>
        <span style="font: 400 10.5px 'IBM Plex Mono'; color: #97A1B2;">${
          sol.achievedWaistRadiusMm !== undefined ? `${esc(fmtMm(sol.achievedWaistRadiusMm))} @ ${esc(sig(sol.achievedWaistZmm, 4))}mm` : "—"
        }</span>
        <span style="font: 400 10.5px 'IBM Plex Mono'; color: #97A1B2;">${sol.sensitivity ? `±${esc(fmtMm(sol.sensitivity.maxRadiusDeltaMm))}` : "—"}</span>
      </button>`;
    })
    .join("");

  const selSens = selSol?.sensitivity
    ? `${T.sensWord}: ±${selSol.sensitivity.positionShiftMm ?? "—"}mm ${T.shiftWord} → ±${fmtMm(selSol.sensitivity.maxRadiusDeltaFromPositionMm ?? Number.NaN)} · ±${selSol.sensitivity.focalLengthShiftMm ?? "—"}mm f → ±${fmtMm(selSol.sensitivity.maxRadiusDeltaFromFocalLengthMm ?? Number.NaN)} · ΔM² ${selSol.sensitivity.m2Delta ?? "—"} → ±${fmtMm(selSol.sensitivity.maxRadiusDeltaFromM2Mm ?? Number.NaN)}`
    : T.notRequested;

  return `
  <div class="wb-center">
    ${warnLines(optWarnRows)}
    ${
      res && res.solutions.length > 0
        ? `<div class="mf-card">
            <div style="display: grid; grid-template-columns: 44px 1fr 110px 90px 110px 90px; gap: 8px; padding: 0 12px 8px; font: 500 9.5px 'IBM Plex Mono'; letter-spacing: 0.08em; color: #5C6675;">
              <span>${esc(T.thRank)}</span><span>${esc(T.thLayout)}</span><span>${esc(T.thRadius)}</span><span>${esc(T.thMismatch)}</span><span>${esc(T.thWaist)}</span><span>${esc(T.thSens)}</span>
            </div>
            <div style="display: flex; flex-direction: column; gap: 6px;">${solRows}</div>
          </div>
          ${
            selSol && optPlot
              ? `<div class="mf-card">
                  <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 6px;">
                    <div style="font: 600 12px 'IBM Plex Mono'; color: #E7ECF4;">#${selSol.rank} — ${esc(selSol.lens1.id)} + ${esc(selSol.lens2.id)}</div>
                    <div style="font: 400 10.5px 'IBM Plex Mono'; color: #8B94A3;">${esc(T.targetWord)} ${esc(
                      fmtMm(selSol.targetRadiusMm ?? selSol.targetWaistRadiusMm ?? 0),
                    )} · ${esc(T.achievedWord)} ${esc(fmtMm(selSol.achievedRadiusMm))} ${esc(T.atZWord)} ${esc(sig(selSol.targetZmm, 4))} mm</div>
                    <div style="flex: 1;"></div>
                    <button data-act="send-solution" class="btn-solid">${esc(T.sendToBeamline)}</button>
                  </div>
                  <div style="font: 400 10.5px 'IBM Plex Mono'; color: #8B94A3; margin-bottom: 8px;">${esc(selSens)}</div>
                  ${envelopeSvg(optPlot, { interactive: false })}
                </div>`
              : ""
          }`
        : ""
    }
    ${
      res && res.solutions.length === 0
        ? `<div class="mf-card" style="padding: 40px; display: flex; align-items: center; justify-content: center;">
            <div style="font: 500 12px 'IBM Plex Mono'; color: #8B94A3;">${esc(T.optEmptyText)}</div>
          </div>`
        : ""
    }
    ${res && res.solutions.length > 0 ? `<div class="mf-note-faint">${esc(T.optFootnote)}</div>` : ""}
  </div>`;
}

export function renderOptimizerTab(T: Strings): string {
  return `
  <div class="wb-workspace">
    ${leftPanel(T)}
    ${resultsPanel(T)}
  </div>`;
}
