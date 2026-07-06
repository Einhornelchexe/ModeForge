// Import tab (ZMX prescription + AGF catalog) — transcribed from the design.

import { paraxialCard, refractiveIndex, type ParaxialCard, type SurfaceStackOptic } from "../../../../packages/api/src/index.ts";
import { esc, sig } from "../format.ts";
import type { Strings } from "../i18n.ts";
import { S } from "../store.ts";
import { bareInput, warnLines } from "./ui.ts";

export function zmxStack(): SurfaceStackOptic | null {
  const job = S.imp.zmx;
  if (job?.ok && job.value.result.ok) return job.value.result.value as SurfaceStackOptic;
  return null;
}

export function canImportAsThickLens(stack: SurfaceStackOptic | null): boolean {
  return (
    !!stack &&
    stack.surfaces.length === 2 &&
    stack.surfaces[0].materialAfter.toUpperCase() !== "AIR" &&
    stack.surfaces[0].thicknessAfterMm > 0 &&
    stack.surfaces[1].materialAfter.toUpperCase() === "AIR"
  );
}

export function renderImportTab(T: Strings): string {
  const imp = S.imp;
  const zmxJob = imp.zmx;
  const stack = zmxStack();
  const zmxOk = !!stack;
  let card: ParaxialCard | null = null;
  if (stack) {
    try {
      card = paraxialCard(stack);
    } catch {
      card = null;
    }
  }
  const unresolved = zmxJob && zmxJob.ok && !zmxJob.value.result.ok ? zmxJob.value.result.unresolvedMaterials : [];
  const zmxWarnRows = zmxJob
    ? zmxJob.ok
      ? zmxJob.value.result.warnings.map((w) => `${w.code} — ${w.message}`)
      : zmxJob.errors.map((t) => `ERROR — ${t}`)
    : [];
  const agfJob = imp.agf;
  const agfMats = agfJob?.ok ? agfJob.value.result.materials : [];
  const agfWarnRows = agfJob?.ok ? agfJob.value.result.warnings.map((w) => `${w.code} — ${w.message}`) : [];
  const canThickLens = canImportAsThickLens(stack);
  const zmxCardText =
    card && card.effectiveFocalLengthMm !== undefined
      ? `EFL ${sig(card.effectiveFocalLengthMm, 4)} mm · BFL ${sig(card.backFocalLengthMm, 4)} mm · FFL ${sig(card.frontFocalLengthMm, 4)} mm · det ${sig(card.determinant, 4)}`
      : card
        ? `afocal stack · det ${sig(card.determinant, 4)}`
        : "";

  return `
  <div class="wb-workspace" style="gap: 12px; padding: 14px; overflow-y: auto;">

    <div style="flex: 1.2; min-width: 0; display: flex; flex-direction: column; gap: 12px;">
      <div class="mf-card" style="display: flex; flex-direction: column; gap: 10px;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <div class="mf-card-title">${esc(T.zmxTitle)}</div>
          <div style="flex: 1;"></div>
          <button data-act="pick-file" data-arg="zmxText" class="btn-dashed">${esc(T.loadFile)}</button>
          <button data-act="zmx-sample" class="btn-dashed">${esc(T.sampleSinglet)}</button>
          <button data-act="zmx-sample-unknown" class="btn-dashed">${esc(T.sampleUnknown)}</button>
        </div>
        <textarea data-k="zmxText" data-drop="zmxText" rows="9" placeholder="${esc(T.zmxPlaceholder)}" spellcheck="false" class="mf-textarea">${esc(imp.zmxText)}</textarea>
        <div style="display: flex; align-items: center; gap: 10px;">
          <div style="display: flex; align-items: center; gap: 6px;">
            <label class="mf-lbl">${esc(T.lambdaForN)}</label>
            <span style="width: 70px;">${bareInput("impLambda", imp.lambda, { small: true, blur: false })}</span>
            <span style="font: 400 10.5px 'IBM Plex Mono'; color: #5C6675;">µm</span>
          </div>
          <div class="mf-note">${esc(T.sessionWord(imp.session.length))}</div>
          <div style="flex: 1;"></div>
          <button data-act="run-zmx" class="btn-primary sm">${esc(T.parseRx)}</button>
        </div>
      </div>

      ${
        unresolved.length > 0
          ? `<div style="border: 1px solid rgba(242,109,109,0.3); background: rgba(242,109,109,0.07); border-radius: 10px; padding: 12px 14px;">
              <div style="font: 600 10.5px 'IBM Plex Mono'; letter-spacing: 0.1em; color: #F2A0A0; margin-bottom: 6px;">${esc(T.importBlocked)}</div>
              <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                ${unresolved
                  .map(
                    (name) =>
                      `<span style="font: 600 11px 'IBM Plex Mono'; color: #F2A0A0; border: 1px solid rgba(242,109,109,0.35); border-radius: 5px; padding: 3px 8px;">${esc(name)}</span>`,
                  )
                  .join("")}
              </div>
              <div style="font: 400 11px 'Space Grotesk'; color: #C7CFDB; margin-top: 8px; line-height: 1.5;">${esc(T.importBlockedNote)}</div>
            </div>`
          : ""
      }

      ${
        zmxOk && stack
          ? `<div class="mf-card">
              <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px;">
                <div class="mf-card-title">${esc(T.surfaceStack)}</div>
                <div style="flex: 1;"></div>
                ${
                  canThickLens
                    ? `<button data-act="add-imported-lens" class="btn-solid">${esc(T.addToBeamline)}</button>`
                    : stack && stack.surfaces.length >= 2
                      ? `<button data-act="add-imported-stack" class="btn-solid">${esc(T.addToBeamline)}</button>`
                      : ""
                }
              </div>
              <div style="display: grid; grid-template-columns: 34px 1fr 1fr 1fr 1fr 1fr; gap: 6px; padding: 0 2px 6px; font: 500 9.5px 'IBM Plex Mono'; letter-spacing: 0.08em; color: #5C6675;">
                <span>#</span><span>${esc(T.thSurfR)}</span><span>${esc(T.thSurfT)}</span><span>${esc(T.thSurfMat)}</span><span>n</span><span>${esc(T.thSurfAp)}</span>
              </div>
              <div style="display: flex; flex-direction: column; gap: 4px;">
                ${stack.surfaces
                  .map(
                    (sf, i) => `
                  <div style="display: grid; grid-template-columns: 34px 1fr 1fr 1fr 1fr 1fr; gap: 6px; border: 1px solid #1A2230; border-radius: 7px; padding: 7px 8px; background: linear-gradient(180deg, #070B11 0%, #0A1018 100%); box-shadow: inset 0 1px 4px rgba(0,0,0,0.35); font: 400 11px 'IBM Plex Mono';">
                    <span style="color: #5C6675;">${i}</span>
                    <span style="color: #E7ECF4;">${sf.radiusMm === "Infinity" ? "∞" : esc(sig(sf.radiusMm, 4))}</span>
                    <span style="color: #97A1B2;">${esc(sig(sf.thicknessAfterMm, 4))}</span>
                    <span style="color: #97A1B2;">${esc(sf.materialAfter)}</span>
                    <span style="color: #E7ECF4;">${esc(sig(sf.refractiveIndexAfter, 5))}</span>
                    <span style="color: #97A1B2;">${sf.apertureRadiusMm !== undefined ? esc(sig(sf.apertureRadiusMm)) : "—"}</span>
                  </div>`,
                  )
                  .join("")}
              </div>
              ${
                card
                  ? `<div style="margin-top: 10px; border: 1px solid rgba(92,225,160,0.25); background: rgba(92,225,160,0.05); border-radius: 7px; padding: 9px 11px; font: 500 11px 'IBM Plex Mono'; color: #5CE1A0;">${esc(zmxCardText)}</div>`
                  : ""
              }
            </div>`
          : ""
      }

      ${warnLines(zmxWarnRows)}
    </div>

    <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 12px;">
      <div class="mf-card" style="display: flex; flex-direction: column; gap: 10px;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <div class="mf-card-title">${esc(T.agfTitle)}</div>
          <div style="flex: 1;"></div>
          <button data-act="pick-file" data-arg="agfText" class="btn-dashed">${esc(T.loadFile)}</button>
          <button data-act="agf-sample" class="btn-dashed">${esc(T.sampleCatalog)}</button>
        </div>
        <textarea data-k="agfText" data-drop="agfText" rows="7" placeholder="${esc(T.agfPlaceholder)}" spellcheck="false" class="mf-textarea">${esc(imp.agfText)}</textarea>
        <div style="display: flex; align-items: center; gap: 10px;">
          <div style="flex: 1;"></div>
          <button data-act="run-agf" class="btn-primary sm">${esc(T.parseCatalog)}</button>
        </div>
      </div>

      ${
        agfJob
          ? `<div class="mf-card">
              <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px;">
                <div class="mf-card-title">${esc(T.materials)}</div>
                <div style="flex: 1;"></div>
                ${
                  agfMats.length > 0
                    ? `<button data-act="adopt-agf" class="btn-solid">${esc(imp.session.length > 0 ? `${T.resolverActive} (${imp.session.length})` : T.adopt)}</button>`
                    : ""
                }
              </div>
              <div style="display: flex; flex-direction: column; gap: 5px;">
                ${agfMats
                  .map((m) => {
                    const sell = m.formula === "sellmeier";
                    const n = `n(${imp.lambda}µm) ${sig(refractiveIndex(m, Number(imp.lambda) || 0.5876), 5)}`;
                    return `
                  <div style="display: flex; align-items: center; gap: 10px;" class="mini-row">
                    <span style="font: 600 11.5px 'IBM Plex Mono'; color: #E7ECF4;">${esc(m.displayName)}</span>
                    <span style="font: 600 9.5px 'IBM Plex Mono'; letter-spacing: 0.05em; border-radius: 4px; padding: 2px 6px; color: ${sell ? "#5CE1A0" : "#F2B33D"}; border: 1px solid ${sell ? "rgba(92,225,160,0.35)" : "rgba(242,179,61,0.35)"};">${esc(m.formula)}</span>
                    <div style="flex: 1;"></div>
                    <span style="font: 400 10.5px 'IBM Plex Mono'; color: #97A1B2;">${esc(n)}</span>
                  </div>`;
                  })
                  .join("")}
              </div>
              ${agfWarnRows.length > 0 ? `<div style="margin-top: 8px;">${warnLines(agfWarnRows)}</div>` : ""}
            </div>`
          : ""
      }

      <div class="mf-note-faint">${esc(T.importNote)}</div>
    </div>
  </div>`;
}
