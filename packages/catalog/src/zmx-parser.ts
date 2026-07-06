import { warning, type SimulationWarning } from "../../core/src/index.ts";
import { type MaterialModel, materialWarnings, refractiveIndex, resolveMaterial } from "../../materials/src/index.ts";
import type { OpticalSurface, SurfaceStackOptic } from "../../optics/src/index.ts";

export type CatalogImportResult<T> =
  | { ok: true; value: T; warnings: SimulationWarning[]; unresolvedMaterials: [] }
  | { ok: false; warnings: SimulationWarning[]; unresolvedMaterials: string[] };

type ParsedSurface = {
  radiusMm: number | "Infinity";
  thicknessAfterMm: number;
  materialAfter: string;
  apertureRadiusMm?: number;
  infiniteDisz?: boolean;
};

function radiusFromCurvature(curvature: number): number | "Infinity" {
  if (!Number.isFinite(curvature)) throw new RangeError("CURV must be finite");
  return curvature === 0 ? "Infinity" : 1 / curvature;
}

function parseRadius(value: string): number | "Infinity" {
  if (value.toUpperCase() === "INFINITY") return "Infinity";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) throw new RangeError("RADIUS must be finite or Infinity");
  return numeric === 0 ? "Infinity" : numeric;
}

export function parseZmxSequential(
  text: string,
  options: { id?: string; wavelengthUm?: number; materials?: readonly MaterialModel[] } = {},
): CatalogImportResult<SurfaceStackOptic> {
  const warnings: SimulationWarning[] = [];
  const unresolved = new Set<string>();
  const surfaces: ParsedSurface[] = [];
  let current: ParsedSurface | undefined;

  function finishSurface(): void {
    if (current) surfaces.push(current);
    current = undefined;
  }

  // Wild-file honesty (S16): the parser reads a conservative sequential
  // subset. Everything else is REPORTED, never silently dropped — and
  // geometry-changing keywords (aspheres, tilts/decenters, mirrors) block
  // the import outright instead of importing a wrong sphere.
  const geometryKeywords = new Set(["CONI", "PARM", "COORDBRK", "TILT", "DECEN", "MIRROR", "MIRR", "XDAT", "ZERNIKE"]);
  const knownMetaKeywords = new Set([
    "VERS", "MODE", "NAME", "UNIT", "ENPD", "ENVD", "GFAC", "GCAT", "RAIM", "PUSH", "SDMA", "FTYP", "ROPD", "PICB",
    "XFLN", "YFLN", "FWGN", "VDXN", "VDYN", "VCXN", "VCYN", "VANN", "WAVM", "WAVL", "WWGT", "WAVN", "PWAV", "POLS",
    "GLRS", "GSTD", "NSCD", "COAT", "COMM", "CONF", "PZUP", "LANG", "FIMP", "TYPE", "HIDE", "SLAB", "STOP",
    "FLOA", "PPAR", "EFFL", "BLNK", "TOL", "MNUM", "MOFF",
  ]);
  const ignoredKeywords = new Set<string>();
  const blockedKeywords = new Set<string>();

  // Lens-unit handling (S16 review H2): geometry values are scaled to mm.
  // Unknown unit tokens block the import instead of silently assuming mm.
  const unitScales: Record<string, number> = { MM: 1, CM: 10, METER: 1000, M: 1000, IN: 25.4, INCH: 25.4 };
  let unitScale = 1;
  for (const rawLine of text.split(/\r?\n/)) {
    const parts = rawLine.trim().split(/\s+/);
    if (parts[0]?.toUpperCase() !== "UNIT") continue;
    const token = parts[1]?.toUpperCase() ?? "MM";
    const scale = unitScales[token];
    if (scale === undefined) {
      return {
        ok: false,
        warnings: [warning("INVALID_INPUT", `Unsupported ZMX lens unit "${token}"; supported: MM, CM, METER, IN.`, "error")],
        unresolvedMaterials: [],
      };
    }
    unitScale = scale;
    if (scale !== 1) {
      warnings.push(warning("INVALID_INPUT", `ZMX lens unit ${token} converted to mm (scale ${scale}).`, "info"));
    }
    break;
  }

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("!")) continue;
    const parts = line.split(/\s+/);
    const keyword = parts[0]?.toUpperCase();
    if (keyword === undefined) continue;
    try {
      if (keyword === "SURF") {
        finishSurface();
        current = { radiusMm: "Infinity", thicknessAfterMm: 0, materialAfter: "AIR" };
      } else if (keyword === "CURV" && current) {
        const radius = radiusFromCurvature(Number(parts[1]));
        current.radiusMm = radius === "Infinity" ? radius : radius * unitScale;
      } else if (keyword === "RADIUS" && current && parts[1]) {
        const radius = parseRadius(parts[1]);
        current.radiusMm = radius === "Infinity" ? radius : radius * unitScale;
      } else if (keyword === "DISZ" && current) {
        if (parts[1]?.toUpperCase() === "INFINITY") {
          // object at infinity (typical OBJ plane in real exports)
          current.thicknessAfterMm = 0;
          current.infiniteDisz = true;
        } else {
          const thicknessAfterMm = Number(parts[1]) * unitScale;
          if (!Number.isFinite(thicknessAfterMm) || thicknessAfterMm < 0) throw new RangeError("DISZ must be finite and >= 0");
          current.thicknessAfterMm = thicknessAfterMm;
        }
      } else if (keyword === "GLAS" && current) {
        const glass = parts[1] ?? "AIR";
        if (glass.toUpperCase() === "MIRROR") {
          blockedKeywords.add("GLAS MIRROR");
        } else {
          current.materialAfter = glass;
        }
      } else if (keyword === "DIAM" && current) {
        const apertureRadiusMm = Number(parts[1]) * unitScale;
        if (!Number.isFinite(apertureRadiusMm) || apertureRadiusMm <= 0) throw new RangeError("DIAM must be finite and > 0");
        current.apertureRadiusMm = apertureRadiusMm;
      } else if (keyword === "UNIT") {
        // handled in the pre-scan above
      } else if (geometryKeywords.has(keyword)) {
        // CONI 0 is an explicit sphere — harmless; anything else changes geometry
        const isExplicitSphere = keyword === "CONI" && Number(parts[1]) === 0;
        if (!isExplicitSphere) blockedKeywords.add(keyword);
      } else if (!knownMetaKeywords.has(keyword)) {
        ignoredKeywords.add(keyword);
      }
    } catch (error) {
      warnings.push(warning("INVALID_INPUT", error instanceof Error ? error.message : String(error), "error"));
    }
  }
  finishSurface();

  if (ignoredKeywords.size > 0) {
    warnings.push(
      warning(
        "INVALID_INPUT",
        `Unrecognized ZMX keywords ignored: ${[...ignoredKeywords].sort().join(", ")}. Only the sequential sphere subset (SURF/CURV/RADIUS/DISZ/GLAS/DIAM) is modeled.`,
        "info",
      ),
    );
  }
  if (blockedKeywords.size > 0) {
    return {
      ok: false,
      warnings: [
        ...warnings,
        warning(
          "INVALID_INPUT",
          `Prescription uses unsupported geometry (${[...blockedKeywords].sort().join(", ")}): aspheres, tilts/decenters and mirrors are not modeled. Import blocked — no silent substitution.`,
          "error",
        ),
      ],
      unresolvedMaterials: [],
    };
  }

  // Trim optically neutral plane-air surfaces at the START and END of the
  // prescription (OBJ/IMA planes in real Zemax exports): they carry no
  // refraction, and their gaps are object/image space — not part of the
  // optic itself (S16 Gemini cross-review finding).
  const isAir = (name: string): boolean => name.toUpperCase() === "AIR";
  let trimmedLeadingGapMm = 0;
  let trimmedPlanes = 0;
  let droppedImagePlaneApertureMm: number | undefined;
  while (surfaces.length > 0) {
    const first = surfaces[0];
    if (!(first.radiusMm === "Infinity" && isAir(first.materialAfter))) break;
    // a leading plane-air surface with an aperture and a FINITE gap may be a
    // real front iris — keep it (an object plane at infinity is trimmed even
    // with Zemax's bookkeeping DIAM)
    if (first.apertureRadiusMm !== undefined && !first.infiniteDisz) {
      warnings.push(
        warning(
          "INVALID_INPUT",
          `Leading plane air surface with aperture ${first.apertureRadiusMm} mm kept as an iris — remove it from the file if it is an object-plane artifact.`,
          "info",
        ),
      );
      break;
    }
    trimmedLeadingGapMm += first.thicknessAfterMm;
    surfaces.shift();
    trimmedPlanes += 1;
  }
  while (surfaces.length > 1) {
    const last = surfaces[surfaces.length - 1];
    const mediumBeforeLast = surfaces[surfaces.length - 2].materialAfter;
    if (last.radiusMm === "Infinity" && isAir(last.materialAfter) && isAir(mediumBeforeLast)) {
      if (last.apertureRadiusMm !== undefined) droppedImagePlaneApertureMm = last.apertureRadiusMm;
      surfaces.pop();
      trimmedPlanes += 1;
    } else {
      break;
    }
  }
  if (trimmedPlanes > 0) {
    warnings.push(
      warning(
        "INVALID_INPUT",
        `${trimmedPlanes} neutral object/image plane(s) trimmed from the prescription` +
          (trimmedLeadingGapMm > 0 ? `; leading object-space gap of ${trimmedLeadingGapMm} mm dropped` : "") +
          (droppedImagePlaneApertureMm !== undefined
            ? `; image-plane semi-diameter ${droppedImagePlaneApertureMm} mm dropped (not a physical stop)`
            : "") +
          ". The remaining surfaces describe the optic itself.",
        "info",
      ),
    );
  }
  if (surfaces.some((surface) => surface.infiniteDisz)) {
    return {
      ok: false,
      warnings: [
        ...warnings,
        warning("INVALID_INPUT", "DISZ INFINITY on an optical surface cannot be embedded. Import blocked.", "error"),
      ],
      unresolvedMaterials: [],
    };
  }

  const wavelengthUm = options.wavelengthUm ?? 0.5876;
  const opticalSurfaces: OpticalSurface[] = [];
  for (const surface of surfaces) {
    const material = surface.materialAfter.toUpperCase() === "AIR" ? undefined : resolveMaterial(surface.materialAfter, options.materials);
    if (material && !material.material) {
      unresolved.add(surface.materialAfter);
      warnings.push(...material.warnings);
      continue;
    }
    const refractiveIndexAfter = material?.material ? refractiveIndex(material.material, wavelengthUm) : 1;
    if (material?.material) {
      // S16 review H1: surface range warnings and never accept non-finite n
      warnings.push(...materialWarnings(material.material, wavelengthUm));
      if (!Number.isFinite(refractiveIndexAfter)) {
        return {
          ok: false,
          warnings: [
            ...warnings,
            warning(
              "INVALID_INPUT",
              `Refractive index of ${surface.materialAfter} is not finite at ${wavelengthUm} um (outside the Sellmeier validity range). Import blocked.`,
              "error",
            ),
          ],
          unresolvedMaterials: [],
        };
      }
    }
    opticalSurfaces.push({
      radiusMm: surface.radiusMm,
      thicknessAfterMm: surface.thicknessAfterMm,
      materialAfter: surface.materialAfter,
      refractiveIndexAfter,
      apertureRadiusMm: surface.apertureRadiusMm,
      supportedInFastMode: true,
    });
  }

  if (unresolved.size > 0) {
    return { ok: false, warnings, unresolvedMaterials: [...unresolved].sort() };
  }
  if (opticalSurfaces.length === 0) {
    return { ok: false, warnings: [...warnings, warning("INVALID_INPUT", "No ZMX surfaces were parsed.", "error")], unresolvedMaterials: [] };
  }

  return {
    ok: true,
    value: {
      id: options.id ?? "zmx-import",
      source: "zmx-import",
      surfaces: opticalSurfaces,
      warnings,
    },
    warnings,
    unresolvedMaterials: [],
  };
}
