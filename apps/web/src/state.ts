// Workbench state model and presets, ported from the Claude Design source.

import type {
  BeamWidthBasis,
  BeamWidthMeasurement,
  HeadlessJobResult,
  MaterialModel,
  ModeForgeProject,
  PulseInput,
  TwoLensOptimizationResult,
  ValidationResult,
} from "../../../packages/api/src/index.ts";
import type { Lang } from "./i18n.ts";
import { loadLang } from "./i18n.ts";

export type Tab = "beamline" | "optimizer" | "import" | "fit" | "field";

export type PulseDraft = {
  averagePowerW: number;
  repetitionRateHz: number;
  pulseEnergyJ: number;
  durationFwhmS: number;
  shape: PulseInput["shape"];
};

export type OptLensDraft = { id: string; f: string; ap: string };

export type OptState = {
  lenses: OptLensDraft[];
  l1From: string;
  l1To: string;
  l1Step: string;
  l2From: string;
  l2To: string;
  l2Step: string;
  targetZ: string;
  targetRadius: string;
  targetWaistRadius: string;
  targetWaistZ: string;
  minSep: string;
  marginMin: string;
  maxResults: string;
  sensOn: boolean;
  sensShift: string;
  sensFocal: string;
  sensM2: string;
  usePulse: boolean;
};

export type ZmxJob = ValidationResult<Extract<HeadlessJobResult, { kind: "zmx-import" }>>;
export type AgfJob = ValidationResult<Extract<HeadlessJobResult, { kind: "agf-import" }>>;
export type FitJobResult = Extract<HeadlessJobResult, { kind: "measured-beam-fit" }>["result"];
export type FieldJobResult = Extract<HeadlessJobResult, { kind: "field-fresnel" }>["result"];
export type FieldBeamlineResult = Extract<HeadlessJobResult, { kind: "field-beamline" }>["result"];

export type ImportState = {
  zmxText: string;
  agfText: string;
  lambda: string;
  zmx: ZmxJob | null;
  agf: AgfJob | null;
  session: MaterialModel[];
  adoptedCount: number;
};

export type FitState = {
  csv: string;
  basis: BeamWidthBasis;
  lambda: string;
  res: FitJobResult | null;
  meas: BeamWidthMeasurement[] | null;
  errs: string[];
};

export type FieldState = {
  mode: "beamline" | "source";
  n: string;
  dx: string;
  lambda: string;
  waist: string;
  apOn: boolean;
  ap: string;
  dist: string;
  bz: string;
  method: "fresnel" | "angular-spectrum";
  sp: "ideal" | "real-sag";
  res: FieldJobResult | null;
  resB: FieldBeamlineResult | null;
  busy: boolean;
  progress: { done: number; total: number } | null;
  errs: string[];
};

export type AppState = {
  lang: Lang;
  tab: Tab;
  presetId: string;
  project: ModeForgeProject;
  pulseOn: boolean;
  pulseMode: "energy" | "avg";
  pulseDraft: PulseDraft;
  pulseDurUnit: "fs" | "ps" | "ns";
  widthBasis: BeamWidthBasis;
  selId: string | null;
  drafts: Record<string, string>;
  modal: "json" | null;
  modalMode: "export" | "import";
  importDraft: string;
  importErrors: string[];
  copied: boolean;
  modeHelper: { type: "HG" | "LG"; p1: string; p2: string };
  opt: OptState;
  optResult: TwoLensOptimizationResult | null;
  optBusy: boolean;
  optSel: number;
  optErrors: string[];
  imp: ImportState;
  fit: FitState;
  fld: FieldState;
};

export type PresetDef = {
  id: string;
  pulseOn: boolean;
  make: () => ModeForgeProject;
};

export const PRESETS: PresetDef[] = [
  {
    id: "focus",
    pulseOn: true,
    make: () => ({
      version: "0.1",
      beam: { kind: "gaussian", wavelengthUm: 1.064, waistRadiusMm: 0.5, waistPositionMm: 0, powerW: 1 },
      beamline: [
        { id: "window", kind: "slab", thicknessMm: 2, refractiveIndex: 1.45, apertureRadiusMm: 5 },
        { id: "drift-1", kind: "free-space", lengthMm: 80 },
        { id: "L1", kind: "thick-lens", radius1Mm: 50, radius2Mm: -50, thicknessMm: 5, refractiveIndex: 1.5, apertureRadiusMm: 12 },
        { id: "to-sample", kind: "free-space", lengthMm: 120 },
      ],
    }),
  },
  {
    id: "telescope",
    pulseOn: false,
    make: () => ({
      version: "0.1",
      beam: { kind: "gaussian", wavelengthUm: 0.78, waistRadiusMm: 0.4, waistPositionMm: 0, powerW: 0.05 },
      beamline: [
        { id: "drift-1", kind: "free-space", lengthMm: 100 },
        { id: "L1", kind: "thin-lens", focalLengthMm: 100, apertureRadiusMm: 6 },
        { id: "drift-2", kind: "free-space", lengthMm: 300 },
        { id: "L2", kind: "thin-lens", focalLengthMm: 200, apertureRadiusMm: 1 },
        { id: "drift-3", kind: "free-space", lengthMm: 200 },
      ],
    }),
  },
  {
    id: "astig",
    pulseOn: false,
    make: () => ({
      version: "0.1",
      beam: {
        kind: "elliptical-gaussian",
        wavelengthUm: 0.405,
        waistRadiusXmm: 0.03,
        waistRadiusYmm: 0.12,
        waistPositionXmm: 0,
        waistPositionYmm: 0,
        powerW: 0.12,
        m2x: 1.1,
        m2y: 1.3,
      },
      beamline: [
        { id: "drift-1", kind: "free-space", lengthMm: 50 },
        { id: "CL1", kind: "cylindrical-lens", focalLengthMm: 100, axis: "x", apertureRadiusMm: 6 },
        { id: "drift-2", kind: "free-space", lengthMm: 150 },
      ],
    }),
  },
];

export function initialState(): AppState {
  return {
    lang: loadLang(),
    tab: "beamline",
    presetId: "focus",
    project: PRESETS[0].make(),
    pulseOn: true,
    pulseMode: "avg",
    pulseDraft: { averagePowerW: 1, repetitionRateHz: 1000, pulseEnergyJ: 0.001, durationFwhmS: 1e-13, shape: "gaussian" },
    pulseDurUnit: "fs",
    widthBasis: "one_over_e2_radius",
    selId: null,
    drafts: {},
    modal: null,
    modalMode: "export",
    importDraft: "",
    importErrors: [],
    copied: false,
    modeHelper: { type: "HG", p1: "1", p2: "0" },
    opt: {
      lenses: [
        { id: "f050", f: "50", ap: "10" },
        { id: "f100", f: "100", ap: "10" },
        { id: "f150", f: "150", ap: "10" },
        { id: "f200", f: "200", ap: "10" },
      ],
      l1From: "60",
      l1To: "140",
      l1Step: "20",
      l2From: "220",
      l2To: "380",
      l2Step: "20",
      targetZ: "500",
      targetRadius: "0.5",
      targetWaistRadius: "",
      targetWaistZ: "",
      minSep: "50",
      marginMin: "1.5",
      maxResults: "8",
      sensOn: true,
      sensShift: "1",
      sensFocal: "1",
      sensM2: "0.1",
      usePulse: false,
    },
    optResult: null,
    optBusy: false,
    optSel: 1,
    optErrors: [],
    imp: { zmxText: "", agfText: "", lambda: "0.5876", zmx: null, agf: null, session: [], adoptedCount: 0 },
    fit: { csv: "", basis: "one_over_e2_radius", lambda: "0.632", res: null, meas: null, errs: [] },
    fld: {
      mode: "beamline",
      n: "48",
      dx: "0.05",
      lambda: "1.064",
      waist: "0.3",
      apOn: false,
      ap: "0.35",
      dist: "150",
      bz: "",
      method: "fresnel",
      sp: "ideal",
      res: null,
      resB: null,
      busy: false,
      progress: null,
      errs: [],
    },
  };
}
