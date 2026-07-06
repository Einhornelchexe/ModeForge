// Display-only number formatting, ported 1:1 from the Claude Design source.

export function sig(v: number | undefined, n = 3): string {
  if (v === undefined || !Number.isFinite(v)) return "—";
  if (v === 0) return "0";
  const abs = Math.abs(v);
  if (abs >= 1e5 || abs < 1e-4) return v.toExponential(2).replace("e+", "e");
  const digits = Math.max(0, n - 1 - Math.floor(Math.log10(abs)));
  return v.toFixed(Math.min(digits, 6)).replace(/\.?0+$/, (m) => (m.includes(".") ? "" : m));
}

export function fmtMm(mm: number | undefined): string {
  if (mm === undefined || !Number.isFinite(mm)) return "—";
  const abs = Math.abs(mm);
  if (abs >= 1000) return `${sig(mm / 1000)} m`;
  if (abs >= 1) return `${sig(mm)} mm`;
  if (abs >= 1e-3) return `${sig(mm * 1000)} µm`;
  return `${sig(mm * 1e6)} nm`;
}

export function fmtJ(j: number): string {
  const abs = Math.abs(j);
  if (abs >= 1) return `${sig(j)} J`;
  if (abs >= 1e-3) return `${sig(j * 1e3)} mJ`;
  if (abs >= 1e-6) return `${sig(j * 1e6)} µJ`;
  if (abs >= 1e-9) return `${sig(j * 1e9)} nJ`;
  return `${sig(j * 1e12)} pJ`;
}

export function fmtW(w: number): string {
  const abs = Math.abs(w);
  if (abs >= 1e12) return `${sig(w / 1e12)} TW`;
  if (abs >= 1e9) return `${sig(w / 1e9)} GW`;
  if (abs >= 1e6) return `${sig(w / 1e6)} MW`;
  if (abs >= 1e3) return `${sig(w / 1e3)} kW`;
  return `${sig(w)} W`;
}

export function fmtPerCm2(v: number | undefined, unit: string): string {
  if (v === undefined || !Number.isFinite(v)) return "—";
  if (Math.abs(v) >= 1e4) return `${v.toExponential(2).replace("e+", "e")} ${unit}`;
  return `${sig(v)} ${unit}`;
}

export function esc(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
