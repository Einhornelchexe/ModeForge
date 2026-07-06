import type { SimulationWarning } from "./warnings.ts";

export type BeamWidthBasis = "one_over_e2_radius" | "fwhm_diameter" | "rms_radius" | "d4sigma_diameter";

export type BeamInput =
  | {
      kind: "gaussian";
      wavelengthUm: number;
      waistRadiusMm: number;
      waistPositionMm: number;
      powerW?: number;
      m2?: number;
    }
  | {
      kind: "elliptical-gaussian";
      wavelengthUm: number;
      waistRadiusXmm: number;
      waistRadiusYmm: number;
      waistPositionXmm: number;
      waistPositionYmm: number;
      powerW?: number;
      m2x?: number;
      m2y?: number;
    }
  | {
      kind: "moment";
      wavelengthUm: number;
      d4SigmaDiameterXmm: number;
      d4SigmaDiameterYmm?: number;
      waistPositionXmm: number;
      waistPositionYmm?: number;
      m2x: number;
      m2y?: number;
      powerW?: number;
    };

export type BeamlineComponent =
  | {
      id: string;
      kind: "free-space";
      lengthMm: number;
      refractiveIndex?: number;
    }
  | {
      id: string;
      kind: "thin-lens";
      focalLengthMm: number;
      apertureRadiusMm?: number;
    }
  | {
      id: string;
      kind: "cylindrical-lens";
      focalLengthMm: number;
      axis: "x" | "y";
      apertureRadiusMm?: number;
    }
  | {
      id: string;
      kind: "slab";
      thicknessMm: number;
      refractiveIndex: number;
      apertureRadiusMm?: number;
    }
  | {
      id: string;
      kind: "thick-lens";
      radius1Mm: number | "Infinity";
      radius2Mm: number | "Infinity";
      thicknessMm: number;
      refractiveIndex: number;
      apertureRadiusMm?: number;
    }
  | {
      id: string;
      kind: "aperture";
      apertureRadiusMm: number;
    }
  | {
      id: string;
      kind: "surface-stack";
      name?: string;
      // Sequential spherical surfaces (S15, e.g. from a ZMX import). The
      // component sits in air: the LAST surface must exit into n = 1 and
      // carry thicknessAfterMm = 0 — trailing gaps belong to a following
      // free-space component.
      surfaces: Array<{
        radiusMm: number | "Infinity";
        thicknessAfterMm: number;
        refractiveIndexAfter: number;
        apertureRadiusMm?: number;
        materialAfter?: string;
      }>;
    };

export type PulseInput = {
  averagePowerW?: number;
  pulseEnergyJ?: number;
  repetitionRateHz?: number;
  durationFwhmS: number;
  shape: "gaussian" | "sech2" | "rectangular";
};

export type PulseResult = {
  pulseEnergyJ: number;
  peakPowerW: number;
  fluenceJPerCm2?: number;
  peakIntensityWPerCm2?: number;
  warnings: SimulationWarning[];
};

export type BeamlineInput = {
  version: "0.1";
  beam: BeamInput;
  components: BeamlineComponent[];
  zStepMm?: number;
  pulse?: PulseInput;
};

export type WaistResult = {
  axis: "x" | "y";
  zMm: number;
  radiusMm: number;
  rayleighRangeMm: number;
  m2: number;
};

export type ComponentResult = {
  componentId: string;
  kind: BeamlineComponent["kind"];
  startZmm: number;
  endZmm: number;
  apertureMargin?: number;
  warnings: SimulationWarning[];
};

export type MatrixResult = {
  componentId: string;
  axis?: "x" | "y" | "both";
  a: number;
  b: number;
  c: number;
  d: number;
  determinant: number;
};

export type BeamlineResult = {
  zGridMm: number[];
  envelope: {
    radiusXmm: number[];
    radiusYmm?: number[];
    diameterXmm: number[];
    diameterYmm?: number[];
  };
  waists: WaistResult[];
  components: ComponentResult[];
  matrices: MatrixResult[];
  pulse?: PulseResult;
  warnings: SimulationWarning[];
};

export type ModeForgeProject = {
  version: "0.1";
  beam: BeamInput;
  beamline: BeamlineComponent[];
  pulses?: PulseInput;
  display?: {
    widthBasis?: BeamWidthBasis;
  };
};
