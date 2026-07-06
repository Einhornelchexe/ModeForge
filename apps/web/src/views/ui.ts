// Small shared HTML builders for the workbench views.

import { esc } from "../format.ts";
import { fv } from "../store.ts";
import type { SimulationWarning } from "../../../../packages/api/src/index.ts";

export function unitInput(key: string, formatted: string, unit: string, opts: { placeholder?: string; small?: boolean } = {}): string {
  return `
    <div class="unit-wrap">
      <input data-k="${key}" data-blur="1" class="mf-input${opts.small ? " sm" : ""}" value="${esc(fv(key, formatted))}"${
        opts.placeholder !== undefined ? ` placeholder="${esc(opts.placeholder)}"` : ""
      } spellcheck="false" autocomplete="off">
      ${unit ? `<span class="unit">${esc(unit)}</span>` : ""}
    </div>`;
}

export function bareInput(key: string, formatted: string, opts: { placeholder?: string; small?: boolean; blur?: boolean } = {}): string {
  return `<input data-k="${key}"${opts.blur === false ? "" : ' data-blur="1"'} class="mf-input${opts.small ? " sm" : ""}" value="${esc(
    fv(key, formatted),
  )}"${opts.placeholder !== undefined ? ` placeholder="${esc(opts.placeholder)}"` : ""} spellcheck="false" autocomplete="off">`;
}

export function fieldCol(label: string, inner: string, labelColor?: string): string {
  return `
    <div class="field-col">
      <label class="mf-lbl"${labelColor ? ` style="color: ${labelColor};"` : ""}>${esc(label)}</label>
      ${inner}
    </div>`;
}

export function segBtn(act: string, arg: string, label: string, active: boolean, extra = ""): string {
  return `<button data-act="${act}" data-arg="${esc(arg)}" class="mf-seg-btn${active ? " active" : ""}"${extra}>${esc(label)}</button>`;
}

export function toggle(act: string, on: boolean): string {
  return `<button data-act="${act}" class="mf-toggle${on ? " on" : ""}" type="button"><span class="knob"></span></button>`;
}

const SEV_STYLE: Record<string, { bg: string; border: string; dot: string; code: string }> = {
  error: { bg: "rgba(242,109,109,0.07)", border: "rgba(242,109,109,0.3)", dot: "#F26D6D", code: "#F2A0A0" },
  warning: { bg: "rgba(242,179,61,0.06)", border: "rgba(242,179,61,0.28)", dot: "#F2B33D", code: "#F2C879" },
  info: { bg: "rgba(111,168,245,0.06)", border: "rgba(111,168,245,0.25)", dot: "#6FA8F5", code: "#9CC1F5" },
};

export function warningCard(w: SimulationWarning, meta: string): string {
  const sv = SEV_STYLE[w.severity] ?? SEV_STYLE.info;
  return `
    <div style="border: 1px solid ${sv.border}; background: ${sv.bg}; border-radius: 7px; padding: 8px 10px;">
      <div style="display: flex; align-items: center; gap: 7px;">
        <span style="width: 6px; height: 6px; border-radius: 50%; background: ${sv.dot}; flex: none;"></span>
        <span style="font: 600 10px 'IBM Plex Mono'; letter-spacing: 0.06em; color: ${sv.code};">${esc(w.code)}</span>
        <span style="font: 400 10px 'IBM Plex Mono'; color: #5C6675;">${esc(meta)}</span>
      </div>
      <div style="font: 400 11px 'Space Grotesk'; color: #C7CFDB; margin-top: 4px; line-height: 1.45;">${esc(w.message)}</div>
    </div>`;
}

export function warnLines(rows: string[]): string {
  if (rows.length === 0) return "";
  return `<div class="warn-box">${rows.map((t) => `<div class="warn-box-line">${esc(t)}</div>`).join("")}</div>`;
}

export function iconSvg(paths: Array<{ d: string; fill: string; stroke: string; sw: number }>, size = 18): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 18 18" style="flex: none;">${paths
    .map(
      (p) =>
        `<path d="${p.d}" fill="${p.fill}" stroke="${p.stroke}" stroke-width="${p.sw}" stroke-linecap="round" stroke-linejoin="round"></path>`,
    )
    .join("")}</svg>`;
}

export function logoSvg(width = 24, height = 17): string {
  return `<svg width="${width}" height="${height}" viewBox="0 0 26 18" fill="none">
    <path d="M1 3 C 10 3, 10.5 9, 13 9 C 15.5 9, 16 3, 25 3" stroke="#5CE1A0" stroke-width="1.6" fill="none"></path>
    <path d="M1 15 C 10 15, 10.5 9, 13 9 C 15.5 9, 16 15, 25 15" stroke="#5CE1A0" stroke-width="1.6" fill="none" opacity="0.55"></path>
    <circle cx="13" cy="9" r="1.8" fill="#F2B33D"></circle>
  </svg>`;
}
