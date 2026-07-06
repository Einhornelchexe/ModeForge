// Beamline tab — layout and bindings transcribed from the Claude Design source.

import {
  divergenceHalfAngleRad,
  hermiteGaussianM2,
  laguerreGaussianM2,
  oneOverE2RadiusToBasisValueMm,
  paraxialCard,
  surfaceStackComponentCard,
  thickSphericalLensStack,
  type BeamlineComponent,
} from "../../../../packages/api/src/index.ts";
import type { Sim } from "../compute.ts";
import { esc, fmtJ, fmtMm, fmtPerCm2, fmtW, sig } from "../format.ts";
import type { Strings } from "../i18n.ts";
import { envelopeSvg, kindIcon, PALETTE, type PlotVals } from "../plot.ts";
import { S } from "../store.ts";
import { fieldCol, iconSvg, segBtn, toggle, unitInput, warningCard } from "./ui.ts";
import { PRESETS } from "../state.ts";

function basisLabel(): string {
  const b = S.widthBasis;
  if (b === "fwhm_diameter") return "FWHM ⌀";
  if (b === "d4sigma_diameter") return "D4σ ⌀";
  if (b === "rms_radius") return "rms";
  return "w 1/e²";
}

function presetName(T: Strings, id: string): { name: string; desc: string } {
  if (id === "telescope") return { name: T.presetTele, desc: T.presetTeleDesc };
  if (id === "astig") return { name: T.presetAstig, desc: T.presetAstigDesc };
  return { name: T.presetFocus, desc: T.presetFocusDesc };
}

function beamFields(T: Strings): string {
  const beam = S.project.beam;
  if (beam.kind === "gaussian") {
    return `
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
        ${fieldCol(T.waistW0, unitInput("w0", String(beam.waistRadiusMm ?? ""), "mm"))}
        ${fieldCol(T.waistPos, unitInput("z0", String(beam.waistPositionMm ?? ""), "mm"))}
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
        ${fieldCol("M²", unitInput("m2", beam.m2 !== undefined ? String(beam.m2) : "", "", { placeholder: "1" }))}
        <div></div>
      </div>`;
  }
  if (beam.kind === "elliptical-gaussian") {
    return `
      <div style="display: grid; grid-template-columns: auto 1fr 1fr; gap: 6px 8px; align-items: center;">
        <div></div>
        <label class="mf-lbl" style="color: ${PALETTE[0]}; text-align: center;">${esc(T.xAxis)}</label>
        <label class="mf-lbl" style="color: ${PALETTE[1]}; text-align: center;">${esc(T.yAxis)}</label>
        <label class="mf-lbl">w0 mm</label>
        ${unitInput("wx", String(beam.waistRadiusXmm ?? ""), "", { small: true })}
        ${unitInput("wy", String(beam.waistRadiusYmm ?? ""), "", { small: true })}
        <label class="mf-lbl">z0 mm</label>
        ${unitInput("zx", String(beam.waistPositionXmm ?? ""), "", { small: true })}
        ${unitInput("zy", String(beam.waistPositionYmm ?? ""), "", { small: true })}
        <label class="mf-lbl">M²</label>
        ${unitInput("m2x", beam.m2x !== undefined ? String(beam.m2x) : "", "", { small: true, placeholder: "1" })}
        ${unitInput("m2y", beam.m2y !== undefined ? String(beam.m2y) : "", "", { small: true, placeholder: "1" })}
      </div>`;
  }
  return `
    <div style="display: grid; grid-template-columns: auto 1fr 1fr; gap: 6px 8px; align-items: center;">
      <div></div>
      <label class="mf-lbl" style="color: ${PALETTE[0]}; text-align: center;">${esc(T.xAxis)}</label>
      <label class="mf-lbl" style="color: ${PALETTE[1]}; text-align: center;">${esc(T.yAxis)}</label>
      <label class="mf-lbl">D4σ mm</label>
      ${unitInput("d4x", String(beam.d4SigmaDiameterXmm ?? ""), "", { small: true })}
      ${unitInput("d4y", beam.d4SigmaDiameterYmm !== undefined ? String(beam.d4SigmaDiameterYmm) : "", "", { small: true, placeholder: "= x" })}
      <label class="mf-lbl">z0 mm</label>
      ${unitInput("mzx", String(beam.waistPositionXmm ?? ""), "", { small: true })}
      ${unitInput("mzy", beam.waistPositionYmm !== undefined ? String(beam.waistPositionYmm) : "", "", { small: true, placeholder: "= x" })}
      <label class="mf-lbl">M²</label>
      ${unitInput("mm2x", String(beam.m2x ?? ""), "", { small: true })}
      ${unitInput("mm2y", beam.m2y !== undefined ? String(beam.m2y) : "", "", { small: true, placeholder: "= x" })}
    </div>
    <div class="mf-note">${esc(T.momentNote)}</div>`;
}

function modeHelperM2Text(T: Strings): string {
  const h = S.modeHelper;
  try {
    if (h.type === "HG") {
      const r = hermiteGaussianM2({ kind: "HG", m: Number(h.p1), n: Number(h.p2), waistRadiusMm: 1 });
      return `M²x ${r.m2x} · M²y ${r.m2y}`;
    }
    const r = laguerreGaussianM2({ kind: "LG", p: Number(h.p1), l: Number(h.p2), waistRadiusMm: 1 });
    return `M² ${r} (both axes)`;
  } catch {
    return T.invalidOrder;
  }
}

function pulsePanel(T: Strings): string {
  const s = S;
  const durUnitFactor = { fs: 1e-15, ps: 1e-12, ns: 1e-9 }[s.pulseDurUnit];
  if (!s.pulseOn) {
    return `
      <div style="display: flex; align-items: center; justify-content: space-between;">
        <div class="mf-sec-title">${esc(T.pulse)}</div>
        ${toggle("pulse-toggle", false)}
      </div>`;
  }
  return `
    <div style="display: flex; align-items: center; justify-content: space-between;">
      <div class="mf-sec-title">${esc(T.pulse)}</div>
      ${toggle("pulse-toggle", true)}
    </div>
    <div class="mf-seg">
      ${segBtn("pulse-mode", "energy", T.ePulse, s.pulseMode === "energy", ' style="font-size: 11px;"')}
      ${segBtn("pulse-mode", "avg", T.pRate, s.pulseMode === "avg", ' style="font-size: 11px;"')}
    </div>
    ${
      s.pulseMode === "energy"
        ? fieldCol(T.pulseEnergy, unitInput("pe", String(s.pulseDraft.pulseEnergyJ), "J"))
        : `<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
            ${fieldCol(T.avgPower, unitInput("pa", String(s.pulseDraft.averagePowerW), "W"))}
            ${fieldCol(T.repRate, unitInput("pr", String(s.pulseDraft.repetitionRateHz), "Hz"))}
          </div>`
    }
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
      <div class="field-col">
        <label class="mf-lbl">${esc(T.durFwhm)}</label>
        <div style="display: flex; gap: 4px;">
          <input data-k="pd" data-blur="1" class="mf-input" style="flex: 1; min-width: 0; width: auto;" value="${esc(
            S.drafts.pd !== undefined ? S.drafts.pd : sig(s.pulseDraft.durationFwhmS / durUnitFactor, 5),
          )}" spellcheck="false" autocomplete="off">
          <select data-k="pdu" class="mf-select" style="width: auto; padding: 0 20px 0 6px; font-size: 11px; color: #97A1B2;">
            <option value="fs"${s.pulseDurUnit === "fs" ? " selected" : ""}>fs</option>
            <option value="ps"${s.pulseDurUnit === "ps" ? " selected" : ""}>ps</option>
            <option value="ns"${s.pulseDurUnit === "ns" ? " selected" : ""}>ns</option>
          </select>
        </div>
      </div>
      <div class="field-col">
        <label class="mf-lbl">${esc(T.shape)}</label>
        <select data-k="pshape" class="mf-select">
          <option value="gaussian"${s.pulseDraft.shape === "gaussian" ? " selected" : ""}>${esc(T.gaussian)}</option>
          <option value="sech2"${s.pulseDraft.shape === "sech2" ? " selected" : ""}>sech²</option>
          <option value="rectangular"${s.pulseDraft.shape === "rectangular" ? " selected" : ""}>${esc(T.rect)}</option>
        </select>
      </div>
    </div>`;
}

function leftPanel(T: Strings): string {
  const beam = S.project.beam;
  return `
  <div class="wb-side w300">
    <div style="display: flex; flex-direction: column; gap: 6px;">
      <div class="mf-sec-title">${esc(T.preset)}</div>
      ${PRESETS.map((p) => {
        const meta = presetName(T, p.id);
        return `
        <button data-act="preset" data-arg="${p.id}" class="preset-btn${S.presetId === p.id ? " active" : ""}">
          <span style="font: 500 12px 'Space Grotesk'; color: #E7ECF4;">${esc(meta.name)}</span>
          <span style="font: 400 10.5px 'IBM Plex Mono'; color: #8B94A3;">${esc(meta.desc)}</span>
        </button>`;
      }).join("")}
    </div>

    <div class="mf-divider"></div>

    <div style="display: flex; flex-direction: column; gap: 10px;">
      <div class="mf-sec-title">${esc(T.beam)}</div>
      <div class="mf-seg" style="border-color: #1E2836;">
        ${segBtn("kind", "gaussian", T.gaussian, beam.kind === "gaussian")}
        ${segBtn("kind", "elliptical-gaussian", T.elliptical, beam.kind === "elliptical-gaussian")}
        ${segBtn("kind", "moment", T.moment, beam.kind === "moment")}
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
        ${fieldCol(T.wavelength, unitInput("wl", String(beam.wavelengthUm), "µm"))}
        ${fieldCol(T.power, unitInput("pw", beam.powerW !== undefined ? String(beam.powerW) : "", "W", { placeholder: "—" }))}
      </div>
      ${beamFields(T)}
    </div>

    <div class="mf-divider"></div>

    <div style="display: flex; flex-direction: column; gap: 8px;">
      <div style="display: flex; align-items: center; justify-content: space-between;">
        <div class="mf-sec-title">${esc(T.modeHelper)}</div>
        <div class="mf-seg boxed" style="border-radius: 7px;">
          ${segBtn("mode-type", "HG", "HG", S.modeHelper.type === "HG", ' style="padding: 3px 10px; font-size: 10.5px; flex: none;"')}
          ${segBtn("mode-type", "LG", "LG", S.modeHelper.type === "LG", ' style="padding: 3px 10px; font-size: 10.5px; flex: none;"')}
        </div>
      </div>
      <div style="display: flex; gap: 8px; align-items: flex-end;">
        <div class="field-col" style="width: 64px;">
          <label class="mf-lbl">${S.modeHelper.type === "HG" ? "m" : "p"}</label>
          <input data-k="mp1" class="mf-input sm" value="${esc(S.modeHelper.p1)}" spellcheck="false" autocomplete="off">
        </div>
        <div class="field-col" style="width: 64px;">
          <label class="mf-lbl">${S.modeHelper.type === "HG" ? "n" : "l"}</label>
          <input data-k="mp2" class="mf-input sm" value="${esc(S.modeHelper.p2)}" spellcheck="false" autocomplete="off">
        </div>
        <div style="flex: 1; font: 500 11px 'IBM Plex Mono'; color: #97A1B2; padding-bottom: 7px;">${esc(modeHelperM2Text(T))}</div>
      </div>
      <button data-act="apply-m2" class="btn-ghost" style="align-self: flex-start; font-size: 11px; padding: 5px 10px;">${esc(T.applyM2)}</button>
      <div class="mf-note">${esc(T.modeNote)}</div>
    </div>

    <div class="mf-divider"></div>

    <div style="display: flex; flex-direction: column; gap: 10px;">
      ${pulsePanel(T)}
    </div>

    <div class="mf-divider"></div>

    <div style="display: flex; flex-direction: column; gap: 6px;">
      <label class="mf-sec-title">${esc(T.widthBasis)}</label>
      <select data-k="wb" class="mf-select">
        <option value="one_over_e2_radius"${S.widthBasis === "one_over_e2_radius" ? " selected" : ""}>${esc(T.b1e2)}</option>
        <option value="fwhm_diameter"${S.widthBasis === "fwhm_diameter" ? " selected" : ""}>${esc(T.bFwhm)}</option>
        <option value="d4sigma_diameter"${S.widthBasis === "d4sigma_diameter" ? " selected" : ""}>${esc(T.bD4)}</option>
        <option value="rms_radius"${S.widthBasis === "rms_radius" ? " selected" : ""}>${esc(T.bRms)}</option>
      </select>
      <div class="mf-note">${esc(T.basisNote)}</div>
    </div>

    <div style="flex: 1;"></div>
    <div class="mf-note-faint">${esc(T.designNote)}</div>
  </div>`;
}

function selEditor(T: Strings, sim: Sim): string {
  const sel = S.project.beamline.find((c) => c.id === S.selId);
  if (!sel) return "";
  const selRes = sim.canonical?.components.find((r) => r.componentId === sel.id) ?? null;
  const kindLabels: Record<BeamlineComponent["kind"], string> = {
    "free-space": T.kindFree,
    "thin-lens": T.kindThin,
    "cylindrical-lens": T.kindCyl,
    slab: T.kindSlab,
    "thick-lens": T.kindThick,
    aperture: T.kindAperture,
    "surface-stack": T.surfaceStack,
  };
  const fields: string[] = [];
  if (sel.kind !== "free-space") {
    fields.push(fieldCol(T.positionZ, unitInput("sp", selRes ? sig(selRes.startZmm, 6) : "", "", { small: true }), "#5CE1A0"));
  }
  if (sel.kind === "free-space") fields.push(fieldCol(T.lengthMm, unitInput("sl", String(sel.lengthMm), "", { small: true })));
  if (sel.kind === "thin-lens" || sel.kind === "cylindrical-lens") {
    fields.push(fieldCol(T.focalMm, unitInput("sf", String(sel.focalLengthMm), "", { small: true })));
  }
  if (sel.kind === "cylindrical-lens") {
    fields.push(`
      <div class="field-col">
        <label class="mf-lbl">${esc(T.axis)}</label>
        <div class="mf-seg boxed">
          ${segBtn("axis", "x", "x", sel.axis === "x", ' style="padding: 4px 4px; font-size: 11px;"')}
          ${segBtn("axis", "y", "y", sel.axis === "y", ' style="padding: 4px 4px; font-size: 11px;"')}
        </div>
      </div>`);
  }
  if (sel.kind === "slab" || sel.kind === "thick-lens") {
    fields.push(fieldCol(T.thickness, unitInput("st", String(sel.thicknessMm), "", { small: true })));
  }
  if (sel.kind === "thick-lens") {
    fields.push(fieldCol('R1 mm · "inf"', unitInput("sr1", String(sel.radius1Mm), "", { small: true })));
    fields.push(fieldCol('R2 mm · "inf"', unitInput("sr2", String(sel.radius2Mm), "", { small: true })));
  }
  if (sel.kind === "slab" || sel.kind === "thick-lens") {
    fields.push(fieldCol(T.refIndex, unitInput("sn", sel.refractiveIndex !== undefined ? String(sel.refractiveIndex) : "", "", { small: true })));
  }
  if (sel.kind !== "free-space" && sel.kind !== "surface-stack") {
    const label = sel.kind === "aperture" ? "RADIUS mm" : "APERTURE R mm";
    const placeholder = sel.kind === "aperture" ? "" : "none";
    fields.push(
      fieldCol(label, unitInput("sa", "apertureRadiusMm" in sel && sel.apertureRadiusMm !== undefined ? String(sel.apertureRadiusMm) : "", "", { small: true, placeholder })),
    );
  }
  return `
    <div class="sel-editor">
      <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 12px;">
        <span style="font: 600 10px 'IBM Plex Mono'; letter-spacing: 0.1em; color: #5C6675;">${esc(kindLabels[sel.kind])}</span>
        <input data-k="sid" class="mf-input" style="width: 130px; padding: 5px 8px; font: 600 12px 'IBM Plex Mono';" value="${esc(sel.id)}" spellcheck="false" autocomplete="off">
        <div style="flex: 1;"></div>
        <button data-act="move-left" title="Move earlier" class="btn-ghost" style="font: 500 12px 'IBM Plex Mono'; padding: 4px 9px;">←</button>
        <button data-act="move-right" title="Move later" class="btn-ghost" style="font: 500 12px 'IBM Plex Mono'; padding: 4px 9px;">→</button>
        <button data-act="dup-sel" class="btn-ghost" style="font-size: 11px; padding: 4px 9px;">${esc(T.duplicate)}</button>
        <button data-act="del-sel" class="btn-danger">${esc(T.del)}</button>
      </div>
      <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px;">
        ${fields.join("")}
      </div>
      ${
        sel.kind === "surface-stack"
          ? `<div style="margin-top: 10px;">
              <div style="display: grid; grid-template-columns: 30px 1fr 1fr 1fr 1fr 1fr; gap: 6px; padding: 0 2px 6px; font: 500 9.5px 'IBM Plex Mono'; letter-spacing: 0.08em; color: #5C6675;">
                <span>#</span><span>${esc(T.thSurfR)}</span><span>${esc(T.thSurfT)}</span><span>${esc(T.thSurfMat)}</span><span>n</span><span>${esc(T.thSurfAp)}</span>
              </div>
              <div style="display: flex; flex-direction: column; gap: 4px;">
                ${sel.surfaces
                  .map(
                    (sf, i) => `
                  <div style="display: grid; grid-template-columns: 30px 1fr 1fr 1fr 1fr 1fr; gap: 6px; border: 1px solid #1A2230; border-radius: 7px; padding: 6px 8px; background: linear-gradient(180deg, #070B11 0%, #0A1018 100%); font: 400 10.5px 'IBM Plex Mono';">
                    <span style="color: #5C6675;">${i}</span>
                    <span style="color: #E7ECF4;">${sf.radiusMm === "Infinity" ? "∞" : esc(sig(sf.radiusMm, 4))}</span>
                    <span style="color: #97A1B2;">${esc(sig(sf.thicknessAfterMm, 4))}</span>
                    <span style="color: #97A1B2;">${esc(sf.materialAfter ?? (sf.refractiveIndexAfter === 1 ? "AIR" : "—"))}</span>
                    <span style="color: #E7ECF4;">${esc(sig(sf.refractiveIndexAfter, 5))}</span>
                    <span style="color: #97A1B2;">${sf.apertureRadiusMm !== undefined ? esc(sig(sf.apertureRadiusMm)) : "—"}</span>
                  </div>`,
                  )
                  .join("")}
              </div>
            </div>`
          : ""
      }
    </div>`;
}

function centerPanel(T: Strings, sim: Sim, plot: PlotVals): string {
  const canonical = sim.canonical;
  const simOk = !!canonical && !canonical.warnings.some((w) => w.severity === "error") && sim.errors.length === 0;
  const totalLen = canonical?.zGridMm.at(-1) ?? 0;
  const hasY = !!sim.dense?.envelope.radiusYmm;
  return `
  <div class="wb-center">
    <div class="mf-card" style="padding: 12px 14px 8px;">
      <div style="display: flex; align-items: center; gap: 14px; margin-bottom: 4px;">
        <div class="mf-card-title">${esc(T.plotTitle)}</div>
        <div style="display: flex; align-items: center; gap: 5px;">
          <span style="width: 14px; height: 3px; border-radius: 2px; background: ${PALETTE[0]};"></span>
          <span style="font: 500 10.5px 'IBM Plex Mono'; color: #97A1B2;">w x</span>
        </div>
        ${
          hasY
            ? `<div style="display: flex; align-items: center; gap: 5px;">
                <span style="width: 14px; height: 3px; border-radius: 2px; background: ${PALETTE[1]};"></span>
                <span style="font: 500 10.5px 'IBM Plex Mono'; color: #97A1B2;">w y</span>
              </div>`
            : ""
        }
        <div style="flex: 1;"></div>
        <div id="hover-text" style="font: 500 11px 'IBM Plex Mono'; color: #97A1B2; min-height: 15px;"></div>
      </div>
      ${
        simOk
          ? envelopeSvg(plot, { interactive: true })
          : `<div style="height: 300px; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 8px;">
              <div style="font: 500 13px 'Space Grotesk'; color: #97A1B2;">${esc(T.simFailed)}</div>
              <div style="font: 400 11px 'IBM Plex Mono'; color: #5C6675;">${esc(T.simFailedSub)}</div>
            </div>`
      }
    </div>

    <div class="mf-card">
      <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px;">
        <div class="mf-card-title">${esc(T.beamlineTitle)}</div>
        <div style="font: 500 10.5px 'IBM Plex Mono'; color: #5C6675;">${S.project.beamline.length} ${esc(T.compsWord)} · ${esc(sig(totalLen, 4))} mm</div>
        <div style="flex: 1;"></div>
        <div style="display: flex; gap: 4px; flex-wrap: wrap;">
          <button data-act="add-free" class="btn-dashed">${esc(T.addFree)}</button>
          <button data-act="add-thin" class="btn-dashed">${esc(T.addThin)}</button>
          <button data-act="add-thick" class="btn-dashed">${esc(T.addThick)}</button>
          <button data-act="add-cyl" class="btn-dashed">${esc(T.addCyl)}</button>
          <button data-act="add-slab" class="btn-dashed">${esc(T.addSlab)}</button>
          <button data-act="add-aperture" class="btn-dashed">${esc(T.addAperture)}</button>
        </div>
      </div>

      <div style="display: flex; gap: 6px; overflow-x: auto; padding-bottom: 4px;">
        <div style="display: flex; align-items: center; gap: 6px; flex: none; border: 1px solid #232E3C; border-radius: 8px; padding: 8px 10px; background: linear-gradient(180deg, #111721 0%, #0C1117 100%); box-shadow: inset 0 1px 0 rgba(255,255,255,0.04), 0 3px 8px -4px rgba(0,0,0,0.6);">
          <svg width="16" height="16" viewBox="0 0 16 16"><path d="M2 8 C 6 8, 6 5, 8 5 C 10 5, 10 8, 14 8 M2 8 C 6 8, 6 11, 8 11 C 10 11, 10 8, 14 8" stroke="#5CE1A0" stroke-width="1.2" fill="none"></path></svg>
          <div style="font: 500 11px 'IBM Plex Mono'; color: #8B94A3;">${esc(T.source)}</div>
        </div>
        ${S.project.beamline
          .map((c) => {
            const res = sim.canonical?.components.find((r) => r.componentId === c.id);
            const subMap: Record<string, string> = {
              "free-space": c.kind === "free-space" ? `L ${sig(c.lengthMm)} mm` : "",
              "thin-lens": c.kind === "thin-lens" ? `f ${sig(c.focalLengthMm)} mm` : "",
              "cylindrical-lens": c.kind === "cylindrical-lens" ? `f ${sig(c.focalLengthMm)} · ${c.axis}` : "",
              slab: c.kind === "slab" ? `t ${sig(c.thicknessMm)} · n ${sig(c.refractiveIndex)}` : "",
              "thick-lens":
                c.kind === "thick-lens"
                  ? `R ${c.radius1Mm === "Infinity" ? "∞" : sig(c.radius1Mm)}/${c.radius2Mm === "Infinity" ? "∞" : sig(c.radius2Mm)} · n ${sig(c.refractiveIndex)}`
                  : "",
              aperture: c.kind === "aperture" ? `⌀ ${sig(c.apertureRadiusMm * 2)} mm` : "",
              "surface-stack":
                c.kind === "surface-stack"
                  ? (() => {
                      try {
                        const card = surfaceStackComponentCard(c);
                        return `${c.surfaces.length} ${T.surfWord}${card.effectiveFocalLengthMm !== undefined ? ` · EFL ${sig(card.effectiveFocalLengthMm, 4)}` : ""}`;
                      } catch {
                        return `${c.surfaces.length} ${T.surfWord}`;
                      }
                    })()
                  : "",
            };
            const warn = (res?.warnings.length ?? 0) > 0;
            return `
            <button data-act="comp-select" data-arg="${esc(c.id)}" class="comp-chip${S.selId === c.id ? " active" : ""}">
              <div style="display: flex; align-items: center; gap: 7px;">
                ${iconSvg(kindIcon(c))}
                <span style="font: 600 11.5px 'IBM Plex Mono'; color: #E7ECF4;">${esc(c.id)}</span>
                ${warn ? '<span style="width: 6px; height: 6px; border-radius: 50%; background: #F2B33D;"></span>' : ""}
              </div>
              <div style="font: 400 10px 'IBM Plex Mono'; color: #8B94A3; white-space: nowrap;">${esc(subMap[c.kind] ?? c.kind)}</div>
            </button>`;
          })
          .join("")}
      </div>
      ${selEditor(T, sim)}
    </div>
  </div>`;
}

function rightPanel(T: Strings, sim: Sim): string {
  const canonical = sim.canonical;
  const beam = S.project.beam;
  const pulse = canonical?.pulse;
  const allWarnings = [
    ...sim.errors.map((message) => ({ code: "INVALID_INPUT" as const, message, severity: "error" as const })),
    ...(canonical?.warnings ?? []),
    ...(pulse?.warnings ?? []),
  ];
  const waistRows = (canonical?.waists ?? [])
    .map((w) => {
      const chipBg = w.axis === "x" ? PALETTE[0] : PALETTE[1];
      const theta = sig(divergenceHalfAngleRad(w.radiusMm, beam.wavelengthUm, w.m2) * 1000);
      return `
      <div class="mini-card">
        <div style="display: flex; align-items: baseline; gap: 8px; margin-bottom: 8px;">
          <span style="font: 600 10px 'IBM Plex Mono'; letter-spacing: 0.06em; color: #0A0D12; background: ${chipBg}; border-radius: 4px; padding: 2px 6px;">${w.axis}</span>
          <span style="font: 600 17px 'IBM Plex Mono'; color: #E7ECF4;">${esc(fmtMm(oneOverE2RadiusToBasisValueMm(w.radiusMm, S.widthBasis)))}</span>
          <span style="font: 400 10.5px 'IBM Plex Mono'; color: #5C6675;">${esc(basisLabel())}</span>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px 12px;">
          <div class="kv-line"><span class="k">${esc(T.zWaist)}</span><span class="v">${esc(sig(w.zMm, 4))} mm</span></div>
          <div class="kv-line"><span class="k">z_R</span><span class="v">${esc(fmtMm(w.rayleighRangeMm))}</span></div>
          <div class="kv-line"><span class="k">${esc(T.thetaHalf)}</span><span class="v">${esc(theta)} mrad</span></div>
          <div class="kv-line"><span class="k">M²</span><span class="v">${esc(sig(w.m2))}</span></div>
        </div>
      </div>`;
    })
    .join("");

  const compTable = (canonical?.components ?? [])
    .map((c) => {
      const src = S.project.beamline.find((b) => b.id === c.componentId);
      let detail = "";
      if (src?.kind === "thick-lens") {
        try {
          const card = paraxialCard(
            thickSphericalLensStack({
              id: src.id,
              radius1Mm: src.radius1Mm,
              radius2Mm: src.radius2Mm,
              thicknessMm: src.thicknessMm,
              refractiveIndex: src.refractiveIndex,
            }),
          );
          if (card.effectiveFocalLengthMm !== undefined)
            detail = `EFL ${sig(card.effectiveFocalLengthMm, 4)} · BFL ${sig(card.backFocalLengthMm, 4)} · FFL ${sig(card.frontFocalLengthMm, 4)} mm`;
        } catch {
          detail = "";
        }
      }
      if (src?.kind === "surface-stack") {
        try {
          const card = surfaceStackComponentCard(src);
          detail =
            card.effectiveFocalLengthMm !== undefined
              ? `${src.surfaces.length} ${T.surfWord} · EFL ${sig(card.effectiveFocalLengthMm, 4)} · BFL ${sig(card.backFocalLengthMm, 4)} · FFL ${sig(card.frontFocalLengthMm, 4)} mm`
              : `${src.surfaces.length} ${T.surfWord} · afocal`;
        } catch {
          detail = `${src.surfaces.length} ${T.surfWord}`;
        }
      }
      const m = c.apertureMargin;
      return `
      <div class="mini-row">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font: 600 11.5px 'IBM Plex Mono'; color: #E7ECF4;">${esc(c.componentId)}</span>
          <span style="font: 400 10px 'IBM Plex Mono'; color: #5C6675;">${esc(c.kind)}</span>
          <div style="flex: 1;"></div>
          <span style="font: 400 10.5px 'IBM Plex Mono'; color: #97A1B2;">${
            c.startZmm === c.endZmm ? `z ${sig(c.startZmm, 4)}` : `z ${sig(c.startZmm, 4)} → ${sig(c.endZmm, 4)}`
          }</span>
        </div>
        ${detail ? `<div style="font: 400 10.5px 'IBM Plex Mono'; color: #8B94A3; margin-top: 5px;">${esc(detail)}</div>` : ""}
        ${
          m !== undefined
            ? `<div style="display: flex; align-items: center; gap: 6px; margin-top: 5px;">
                <span style="font: 400 10px 'IBM Plex Mono'; color: #5C6675;">${esc(T.apMargin)}</span>
                <span style="font: 600 10.5px 'IBM Plex Mono'; border-radius: 4px; padding: 1px 6px; color: ${m < 1.5 ? "#0A0D12" : "#97A1B2"}; background: ${m < 1.5 ? "#F2B33D" : "#1A222D"};">${m.toFixed(2)}×</span>
              </div>`
            : ""
        }
      </div>`;
    })
    .join("");

  return `
  <div class="wb-results">
    <div class="mf-card">
      <div class="mf-card-title" style="margin-bottom: 10px;">${esc(T.outputWaist)}</div>
      <div style="display: flex; flex-direction: column; gap: 10px;">${waistRows}</div>
    </div>
    ${
      pulse
        ? `<div class="mf-card">
            <div class="mf-card-title" style="margin-bottom: 10px;">${esc(T.pulseExit)}</div>
            <div style="display: flex; flex-direction: column; gap: 7px;">
              <div style="display: flex; justify-content: space-between; align-items: baseline;"><span style="font: 400 11px 'IBM Plex Mono'; color: #5C6675;">${esc(T.rPulseEnergy)}</span><span style="font: 600 13px 'IBM Plex Mono'; color: #E7ECF4;">${esc(fmtJ(pulse.pulseEnergyJ))}</span></div>
              <div style="display: flex; justify-content: space-between; align-items: baseline;"><span style="font: 400 11px 'IBM Plex Mono'; color: #5C6675;">${esc(T.peakPower)}</span><span style="font: 600 13px 'IBM Plex Mono'; color: #E7ECF4;">${esc(fmtW(pulse.peakPowerW))}</span></div>
              <div style="display: flex; justify-content: space-between; align-items: baseline;"><span style="font: 400 11px 'IBM Plex Mono'; color: #5C6675;">${esc(T.peakFluence)}</span><span style="font: 600 13px 'IBM Plex Mono'; color: ${pulse.fluenceJPerCm2 !== undefined && pulse.fluenceJPerCm2 > 1 ? "#F2B33D" : "#E7ECF4"};">${esc(fmtPerCm2(pulse.fluenceJPerCm2, "J/cm²"))}</span></div>
              <div style="display: flex; justify-content: space-between; align-items: baseline;"><span style="font: 400 11px 'IBM Plex Mono'; color: #5C6675;">${esc(T.peakIntensity)}</span><span style="font: 600 13px 'IBM Plex Mono'; color: #E7ECF4;">${esc(fmtPerCm2(pulse.peakIntensityWPerCm2, "W/cm²"))}</span></div>
            </div>
            <div class="mf-note" style="margin-top: 9px;">${esc(T.pulseNote)} · ${esc(
              S.pulseDraft.shape === "sech2" ? T.shapeNoteSech : S.pulseDraft.shape === "rectangular" ? T.shapeNoteRect : T.shapeNoteGauss,
            )}</div>
          </div>`
        : ""
    }
    ${
      allWarnings.length > 0
        ? `<div class="mf-card">
            <div class="mf-card-title" style="margin-bottom: 10px;">${esc(T.warnings)}</div>
            <div style="display: flex; flex-direction: column; gap: 6px;">
              ${allWarnings
                .map((w) =>
                  warningCard(
                    w,
                    ["componentId" in w ? (w as { componentId?: string }).componentId : undefined, "zMm" in w && (w as { zMm?: number }).zMm !== undefined ? `z ${sig((w as { zMm?: number }).zMm, 4)}mm` : undefined]
                      .filter(Boolean)
                      .join(" · "),
                  ),
                )
                .join("")}
            </div>
          </div>`
        : ""
    }
    <div class="mf-card">
      <div class="mf-card-title" style="margin-bottom: 10px;">${esc(T.components)}</div>
      <div style="display: flex; flex-direction: column; gap: 6px;">${compTable}</div>
    </div>
    <div class="mf-note-faint">${esc(T.fastNote)}</div>
  </div>`;
}

export function renderBeamlineTab(T: Strings, sim: Sim, plot: PlotVals): string {
  return `
  <div class="wb-workspace">
    ${leftPanel(T)}
    ${centerPanel(T, sim, plot)}
    ${rightPanel(T, sim)}
  </div>`;
}
