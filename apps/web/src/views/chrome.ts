// Workbench header and project-JSON modal — transcribed from the design source.

import { serializeProject } from "../../../../packages/api/src/index.ts";
import { currentProjectInput } from "../compute.ts";
import { esc } from "../format.ts";
import type { Strings } from "../i18n.ts";
import { S } from "../store.ts";
import type { ModeForgeProject } from "../../../../packages/api/src/index.ts";
import { logoSvg } from "./ui.ts";

export function exportProject(): ModeForgeProject {
  const project = JSON.parse(JSON.stringify(S.project)) as ModeForgeProject;
  if (S.pulseOn) project.pulses = currentProjectInput(S).pulses;
  project.display = { widthBasis: S.widthBasis };
  return project;
}

export function renderHeader(T: Strings): string {
  const pill =
    S.tab === "field"
      ? { text: "FIELD JOB · SCALAR DFT", c: "#6FA8F5", bg: "rgba(111,168,245,0.07)", bd: "rgba(111,168,245,0.28)" }
      : { text: "FAST MODE · PARAXIAL", c: "#5CE1A0", bg: "rgba(92,225,160,0.06)", bd: "rgba(92,225,160,0.25)" };
  const tab = (id: string, label: string) =>
    `<button data-act="tab" data-arg="${id}" class="wb-tab${S.tab === id ? " active" : ""}">${esc(label)}</button>`;
  return `
  <div class="wb-header">
    <a href="./" title="Home / Übersicht" style="display: flex; align-items: center; gap: 11px; text-decoration: none; color: inherit;">
      <div class="wb-logo-box">${logoSvg()}</div>
      <div style="display: flex; align-items: baseline; gap: 8px;">
        <div class="wb-brand-name">ModeForge</div>
        <div class="wb-brand-tag">v1.0 · HEADLESS CORE</div>
      </div>
    </a>

    <div class="wb-tabs">
      ${tab("beamline", T.tabBeamline)}
      ${tab("optimizer", T.tabOptimizer)}
      ${tab("import", T.tabImport)}
      ${tab("fit", T.tabFit)}
      ${tab("field", T.tabField)}
    </div>

    <div style="flex: 1;"></div>

    <div style="display: flex; align-items: center; gap: 8px;">
      <div style="display: flex; align-items: center; gap: 6px; white-space: nowrap; flex: none; font: 500 10.5px 'IBM Plex Mono'; color: ${pill.c}; letter-spacing: 0.08em; border: 1px solid ${pill.bd}; border-radius: 5px; padding: 4px 8px; background: ${pill.bg};">
        <span style="width: 6px; height: 6px; border-radius: 50%; background: ${pill.c};"></span>
        ${esc(pill.text)}
      </div>
      <a href="guide.html" target="_blank" rel="noopener" class="wb-lang-btn" style="text-decoration: none;" title="Guide / Anleitung">?</a>
      <div class="wb-lang-seg">
        <button data-act="lang" data-arg="en" class="wb-lang-btn${S.lang === "en" ? " active" : ""}">EN</button>
        <button data-act="lang" data-arg="de" class="wb-lang-btn${S.lang === "de" ? " active" : ""}">DE</button>
      </div>
      <button data-act="open-import" class="btn-ghost">${esc(T.importJson)}</button>
      <button data-act="open-export" class="btn-solid">${esc(T.exportJson)}</button>
    </div>
  </div>`;
}

export function renderModal(T: Strings): string {
  if (S.modal === null) return "";
  const isExport = S.modalMode === "export";
  const projectJson = isExport ? serializeProject(exportProject()) : "";
  return `
  <div class="modal-backdrop" data-act-backdrop="close-modal">
    <div class="modal-box">
      <div style="display: flex; align-items: center; gap: 12px;">
        <div style="font: 600 14px 'Space Grotesk'; color: #E7ECF4;">${esc(T.projectJson)}</div>
        <div style="font: 400 10.5px 'IBM Plex Mono'; color: #5C6675;">ModeForgeProject · version 0.1</div>
        <div style="flex: 1;"></div>
        <button data-act="close-modal" style="background: none; border: none; color: #97A1B2; font: 500 16px 'Space Grotesk'; cursor: pointer; padding: 2px 6px;">✕</button>
      </div>
      <div class="mf-seg" style="align-self: flex-start;">
        <button data-act="modal-export" class="mf-seg-btn${isExport ? " active" : ""}" style="padding: 5px 14px; flex: none;">${esc(T.export)}</button>
        <button data-act="modal-import" class="mf-seg-btn${!isExport ? " active" : ""}" style="padding: 5px 14px; flex: none;">${esc(T.import)}</button>
      </div>
      ${
        isExport
          ? `<textarea readonly rows="16" class="mf-textarea">${esc(projectJson)}</textarea>
            <div style="display: flex; gap: 8px;">
              <button data-act="copy-project" class="btn-solid" style="padding: 7px 14px;">${esc(S.copied ? T.copiedBtn : T.copyBtn)}</button>
              <button data-act="download-project" class="btn-ghost" style="padding: 7px 14px;">${esc(T.download)}</button>
            </div>`
          : `<div style="display:flex; justify-content:flex-end; margin-bottom:8px;"><button data-act="pick-file" data-arg="importDraft" class="btn-dashed">${esc(T.loadFile)}</button></div>
          <textarea data-k="importDraft" data-drop="importDraft" rows="14" placeholder="${esc(T.pastePlaceholder)}" class="mf-textarea">${esc(S.importDraft)}</textarea>
            ${
              S.importErrors.length > 0
                ? `<div class="error-box">${S.importErrors.map((t) => `<div class="error-box-line">${esc(t)}</div>`).join("")}</div>`
                : ""
            }
            <button data-act="apply-import" class="btn-solid" style="align-self: flex-start; padding: 7px 14px;">${esc(T.validateLoad)}</button>`
      }
    </div>
  </div>`;
}
