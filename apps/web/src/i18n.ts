// Workbench UI strings, transcribed verbatim from the Claude Design source.

import type { SimulationWarningCode } from "../../../packages/api/src/index.ts";

export type Lang = "en" | "de";

export type Strings = {
  tabBeamline: string;
  tabOptimizer: string;
  tabImport: string;
  tabFit: string;
  tabField: string;
  tabAnalyzer: string;
  importJson: string;
  exportJson: string;
  preset: string;
  beam: string;
  gaussian: string;
  elliptical: string;
  moment: string;
  wavelength: string;
  power: string;
  waistW0: string;
  waistPos: string;
  xAxis: string;
  yAxis: string;
  momentNote: string;
  modeHelper: string;
  applyM2: string;
  modeNote: string;
  invalidOrder: string;
  pulse: string;
  ePulse: string;
  pRate: string;
  pulseEnergy: string;
  avgPower: string;
  repRate: string;
  durFwhm: string;
  shape: string;
  rect: string;
  widthBasis: string;
  b1e2: string;
  bFwhm: string;
  bD4: string;
  bRms: string;
  basisNote: string;
  designNote: string;
  plotTitle: string;
  simFailed: string;
  simFailedSub: string;
  beamlineTitle: string;
  compsWord: string;
  addFree: string;
  addThin: string;
  addThick: string;
  addCyl: string;
  addSlab: string;
  addAperture: string;
  source: string;
  duplicate: string;
  del: string;
  positionZ: string;
  lengthMm: string;
  focalMm: string;
  axis: string;
  thickness: string;
  refIndex: string;
  kindFree: string;
  kindThin: string;
  kindCyl: string;
  kindSlab: string;
  kindThick: string;
  kindAperture: string;
  outputWaist: string;
  zWaist: string;
  thetaHalf: string;
  pulseExit: string;
  rPulseEnergy: string;
  peakPower: string;
  peakFluence: string;
  peakIntensity: string;
  pulseNote: string;
  shapeNoteGauss: string;
  shapeNoteSech: string;
  shapeNoteRect: string;
  warnings: string;
  components: string;
  apMargin: string;
  fastNote: string;
  projectJson: string;
  export: string;
  import: string;
  copyBtn: string;
  copiedBtn: string;
  download: string;
  validateLoad: string;
  pastePlaceholder: string;
  presetFocus: string;
  presetFocusDesc: string;
  presetTele: string;
  presetTeleDesc: string;
  presetAstig: string;
  presetAstigDesc: string;
  optTitle: string;
  optIntro: string;
  lensCandidates: string;
  addLens: string;
  searchGrid: string;
  candWord: string;
  target: string;
  targetPlane: string;
  radiusAtTarget: string;
  targetWaistR: string;
  targetWaistZ: string;
  targetNote: string;
  constraints: string;
  minSep: string;
  apMarginMin: string;
  maxResults: string;
  sensitivity: string;
  sensShift: string;
  sensF: string;
  sensM2: string;
  optPulseLabel: string;
  runOpt: string;
  searching: string;
  thRank: string;
  thLayout: string;
  thRadius: string;
  thMismatch: string;
  thWaist: string;
  thSens: string;
  sendToBeamline: string;
  optEmptyText: string;
  optFootnote: string;
  targetWord: string;
  achievedWord: string;
  atZWord: string;
  sensWord: string;
  shiftWord: string;
  notRequested: string;
  zmxTitle: string;
  sampleSinglet: string;
  sampleUnknown: string;
  lambdaForN: string;
  parseRx: string;
  importBlocked: string;
  importBlockedNote: string;
  surfaceStack: string;
  addToBeamline: string;
  thSurfR: string;
  thSurfT: string;
  thSurfMat: string;
  thSurfAp: string;
  agfTitle: string;
  sampleCatalog: string;
  parseCatalog: string;
  materials: string;
  adopt: string;
  resolverActive: string;
  sessionWord: (n: number) => string;
  importNote: string;
  fitTitle: string;
  fitIntro: string;
  sampleCaustic: string;
  pointsWord: string;
  widthColBasis: string;
  wavelengthUm: string;
  runFit: string;
  fitW0: string;
  fitZ0: string;
  fitTheta: string;
  fitRms: string;
  fitMaxRes: string;
  causticTitle: string;
  measured: string;
  fitCurve: string;
  useAsBeam: string;
  fitNote: string;
  fieldTitle: string;
  fieldIntro: string;
  useProjectBeam: string;
  projectBeamWord: string;
  fieldSource: string;
  gridN: string;
  spacingDx: string;
  fieldWaist: string;
  extentWord: string;
  extentCap: string;
  hardAperture: string;
  apertureR: string;
  propagation: string;
  distance: string;
  method: string;
  angularSpectrum: string;
  runField: string;
  propagating: string;
  fieldJobNote: string;
  powerIn: string;
  powerOut: string;
  crossCheck: string;
  analyticNoteAp: string;
  analyticNoteSampling: string;
  analyticNoteOk: string;
  analyticNoteBad: string;
  inputPlane: string;
  outputPlane: string;
  dftNote: string;
  fieldVsWord: string;
  vsParaxialWord: string;
  scalarBadge: string;
  zmxPlaceholder: string;
  agfPlaceholder: string;
  modeBeamline: string;
  modeSource: string;
  probeZ: string;
  planesQuick: string;
  autoDx: string;
  probePlane: string;
  powerAtZ: string;
  beamlineIntro: string;
  beamlineNote: string;
  crossCheckAtZ: string;
  segmentWord: string;
  surfacePhase: string;
  spIdeal: string;
  spSag: string;
  sagNote: string;
  surfWord: string;
  loadFile: string;
  fieldSourceMode: string;
  modeFundamental: string;
  // Image analyzer tab (S18e-C) — product-neutral plain language only.
  imgUpload: string;
  imgDropHint: string;
  imgPickFile: string;
  imgPage: string;
  imgChannel: string;
  imgCalibration: string;
  imgCalX: string;
  imgCalY: string;
  imgBackground: string;
  imgBgNone: string;
  imgAuto: string;
  imgAutoMode: string;
  imgBgManualOffset: string;
  imgBgOffsetCounts: string;
  imgRoi: string;
  imgRoiFull: string;
  imgRoiRect: string;
  imgRoiAuto: string;
  imgRoiNote: string;
  imgRoiOutOfRange: string;
  imgRoiClamped: string;
  imgRoiFromFit: string;
  imgRun: string;
  imgBusy: string;
  imgDecoding: string;
  imgSuppressed: string;
  imgPhysical: string;
  imgPhysicalD4: string;
  imgKeyResults: string;
  imgRawRender: string;
  imgNoData: string;
  imgExportJson: string;
  imgExportCsv: string;
  imgExportPng: string;
  imgDiagnostics: string;
  imgRawStats: string;
  imgWarnings: string;
  imgBackgroundNoise: string;
  imgSigmaB: string;
  imgScaleSource: string;
  imgMedian: string;
  imgMean: string;
  imgStd: string;
  imgMad: string;
  imgIqr: string;
  imgFloorApplied: string;
  imgRoiStability: string;
  imgValidVariants: string;
  imgUndeterminable: string;
  imgHalfSpread: string;
  imgMomentsProfiles: string;
  imgStageB: string;
  imgD4Sigma: string;
  imgCentroid: string;
  imgTheta: string;
  imgEllipticity: string;
  imgEllipticityPhysical: string;
  imgFitWidth: string;
  imgStageA: string;
  imgProfilesCut: string;
  imgFitsResiduals: string;
  imgFitStatus: string;
  imgResidualRms: string;
  imgResidualMax: string;
  imgResidualSigma: string;
  imgResidualNrmse: string;
  imgResidualRmsSigma: string;
  imgResidualMode: string;
  imgResidualModeCounts: string;
  imgResidualModePercentPeak: string;
  imgResidualModeSigma: string;
  imgResidualModePercentPeakUnavailable: string;
  imgResidualModeSigmaNoSigma: string;
  imgResidualModeSigmaZero: string;
  imgResidualModeSigmaFloor: string;
  imgResidualBlockHint: string;
  imgResidualScale: string;
  imgResidualMaxAbs: string;
  imgResidualMaxDisplayBlocks: string;
  imgResidualManualScale: string;
  imgResidualAutoScale: string;
  imgResidualGaussMap: string;
  imgResidualSuperMap: string;
  imgResidualSuperUnavailable: string;
  imgResidualHistogram: string;
  imgHistogramUnderflow: string;
  imgHistogramOverflow: string;
  imgSkewness: string;
  imgExcessKurtosis: string;
  imgFiniteCount: string;
  imgFullResRoi: string;
  imgModelComparison: string;
  imgGaussianDescription: string;
  imgFlatTopDescription: string;
  imgExponentBoundaryDescription: string;
  imgExponentNoInterpretation: string;
  imgQualityBox: string;
  imgQualityStability: string;
  imgGeometryReleasable: string;
  imgMomentSuppression: string;
  imgWidthFwhm: string;
  imgWidth1e2: string;
  imgYes: string;
  imgNo: string;
  imgPass: string;
  imgFail: string;
  imgPeakToBackground: string;
  imgSize: string;
  imgDtype: string;
  imgMin: string;
  imgMax: string;
  imgDynamicRange: string;
  imgSaturated: string;
  imgClippingSuspect: string;
  imgHotPixels: string;
  imgZeros: string;
  imgNegatives: string;
  imgNonFinite: string;
  imgEdgeTouch: string;
  imgLocalMaxima: string;
  imgHistogram: string;
  imgFitParams: string;
  imgAmplitude: string;
  imgFitBackground: string;
  imgSigmaMajor: string;
  imgSigmaMinor: string;
  imgSuperGaussN: string;
  imgIterations: string;
  imgCutX: string;
  imgCutY: string;
  imgProjX: string;
  imgProjY: string;
  imgAxisMajor: string;
  imgAxisMinor: string;
  imgMajor: string;
  imgMinor: string;
  imgLongAxis: string;
  imgShortAxis: string;
  imgResidualMap: string;
  imgAperture: string;
  imgGateFit: string;
  imgGateAmplitude: string;
  imgGateResidual: string;
  imgGateClip: string;
  imgGateAlpha: string;
  imgGateMultiPeak: string;
  imgPedestal: string;
  imgAbsorbedPower: string;
  imgAlphaUsed: string;
  imgWidthScatter: string;
  imgPartialSweep: string;
  imgFullFrame: string;
  imgClamped: string;
  imgRoiSource: string;
  imgRoiSourceInput: string;
  imgRoiSourceFull: string;
  imgRoiSourceAuto: string;
  imgDisplayNote: string;
  imgSpotCloseup: string;
  imgViewFull: string;
  imgViewForcedBgDraw: string;
  imgColorMap: string;
  imgColorMapGray: string;
  imgColorMapTurbo: string;
  imgColorMapViridis: string;
  imgCountsUnit: string;
  imgLegendFit: string;
  imgLegendRoi: string;
  imgRoiFullFrameNote: string;
  imgLegendSuggestion: string;
  imgRoiOutsideCrop: string;
  imgEllipsePowerNote: string;
  imgCloseupRoiNote: string;
  imgCloseupFallbackNote: string;
  imgCloseupFixedNote: string;
  imgAnisoPxNote: string;
  imgSigmaBUnmeasurable: string;
  imgPhysicalFromFit: string;
  imgUngatedHint: string;
  imgUngatedInfo: string;
  imgResidualRoiLabel: (width: number, height: number) => string;
  imgResidualWindowLabel: (width: number, height: number) => string;
  imgWarningTitle: (code: string) => string;
  warningDescription: (code: string, fallback: string) => string;
  imgValid: string;
  imgPeak: string;
  imgEncircled: string;
  imgModelCompare: string;
  imgSampleCount: string;
  imgScaleMad: string;
  imgScaleIqr: string;
  imgScaleFloor: string;
  imgScaleZero: string;
  imgReasonFitNotConverged: string;
  imgReasonNonpositiveAmplitude: string;
  imgReasonResidualHigh: string;
  imgReasonApertureClipped: string;
  // S20 stage A (additive).
  imgReasonCoverageInsufficient: string;
  imgReasonAlphaInconsistent: string;
  imgReasonMultiPeak: string;
  imgStatusConverged: string;
  imgStatusMaxIterations: string;
  imgStatusTimeBudget: string;
  imgStatusSingular: string;
  imgStatusInvalidStart: string;
  imgWidthLowSignal: string;
  imgWidthNonpositivePeak: string;
  imgWidthGap: string;
  imgMomentNonfinite: string;
  imgMomentNonpositiveSum: string;
  imgMomentBackgroundDominated: string;
  imgMomentIndefinite: string;
  imgMomentZeroCovariance: string;
  imgAmbiguous: string;
  imgGauss2d: string;
  imgSuperGauss2d: string;
  // Image analyzer tab (S18e-C) — extended background controls, part A.
  imgBgDarkFrame: string;
  imgBgRectMedian: string;
  imgBgRobustPlane: string;
  imgRectAdd: string;
  imgRectRemove: string;
  imgRectCorners: string;
  imgRectEditor: string;
  imgRectHint: string;
  imgRectX0: string;
  imgRectY0: string;
  imgRectW: string;
  imgRectH: string;
  imgBgPickDark: string;
  imgBgDarkLoaded: (name: string, width: number, height: number, sourceDtype: string) => string;
  imgSuggestedRoi: string;
  imgApplySuggestion: string;
  imgSuggestionClamped: string;
  imgSuggestionNoiseDominated: string;
  imgSettingsReset: string;
  imgSettingsAdjusted: string;
  imgSettingsDarkDtypeChanged: string;
  imgBgAutoRobustPlane: string;
  imgBgAutoNone: string;
  imgAutoRoi: (x0: number, y0: number, width: number, height: number) => string;
  imgAutoRoiNoSuggestion: string;
  imgSymmetry: string;
  imgRotationAsymmetry: string;
  imgAxialAsymmetryX: string;
  imgAxialAsymmetryY: string;
  imgAlphaThreshold: string;
  imgMcRealizationCount: string;
  imgMultiPeakThreshold: string;
  // Image analyzer tab — profile plot with the fit model overlaid.
  imgProfilePlot: string;
  imgProfileMeasured: string;
  imgProfileGaussModel: string;
  imgProfileSuperModel: string;
  imgProfileFwhmMark: string;
  imgProfileE2Mark: string;
  imgProfilePositionPx: string;
  imgProfilePositionUm: string;
  imgProfileIntensity: string;
  imgProfileExportPng: string;
  imgProfileMissing: string;
  imgProfileNoModel: string;
  imgProfileResidualLane: string;
  imgProfileResidualIntensity: string;
  imgProfileProjectionNote: string;
  imgProfileAxisNote: string;
  // Image analyzer tab — honest suggestion-iteration callout.
  imgSuggestionCalloutTighter: string;
  imgSuggestionCalloutWider: string;
  imgSuggestionCalloutShifted: string;
  imgSuggestionCalloutNumbers: (
    width: number,
    height: number,
    x0: number,
    y0: number,
    analyzedWidth: number,
    analyzedHeight: number,
    areaPercent: string,
  ) => string;
  imgSuggestionCalloutWhy: string;
  imgApplySuggestionRun: string;
  // Image analyzer tab — ROI-from-fit non-shrink clamp.
  imgRoiFitNotNarrowed: string;
  // S20 stage G — canvas draw target and background-rectangle legend.
  imgDrawTargetRoi: string;
  imgDrawTargetBgRect: string;
  imgLegendBgRect: string;
  // S20 stage C (additive) — dark-frame error kinds.
  imgBgDarkDimMismatch: (darkWidth: number, darkHeight: number, imageWidth: number, imageHeight: number) => string;
  imgBgDarkDecodeFailed: string;
  imgBgDarkDtypeMismatch: (darkDtype: string, imageDtype: string) => string;
};

const WARNING_DESCRIPTION_EN: Record<SimulationWarningCode, string> = {
  PARAXIAL_ANGLE_HIGH: "The propagation angle is high enough that the paraxial approximation may be inaccurate.",
  APERTURE_MARGIN_LOW: "The beam is close to the aperture limit.",
  MATERIAL_CONSTANT_N: "This material uses a fixed refractive index, so dispersion is unavailable.",
  MATERIAL_OUTSIDE_RANGE: "The selected wavelength lies outside the material's available range.",
  MATERIAL_UNKNOWN: "A required material is unknown or the catalog supplied none; details are in the message.",
  DISPERSION_UNAVAILABLE: "Dispersion data is unavailable for this material.",
  FIELD_PROPAGATION_UNAVAILABLE: "This field propagation cannot be computed for the current configuration.",
  FIELD_SAMPLING_LOW: "A sampling or grid notice for the field calculation; details are in the message.",
  MEASUREMENT_FIT_RESIDUAL_HIGH: "The beam-fit residual exceeds the reporting threshold.",
  UNSUPPORTED_PROFILE_PROPAGATION: "The selected profile is approximated for propagation.",
  INVALID_INPUT: "The supplied input is not usable for this calculation.",
  IMAGE_APERTURE_SUPPRESSED: "Stage-B aperture moments are not released because a release gate did not pass; the message gives the reason.",
  IMAGE_AXIS_NOT_RESOLVED: "The released minor axis is below the resolvable size.",
  IMAGE_BACKGROUND_DEGENERATE: "The requested background model could not be applied; the image is analyzed without it.",
  IMAGE_EDGE_TOUCH: "The beam reaches the image border, so power outside the image cannot be excluded.",
  IMAGE_FIT_NOT_CONVERGED: "The 2D Gaussian fit did not converge to a usable geometry.",
  IMAGE_FLOAT_SPECIALS: "The image contains non-finite pixel values; where they lie in the measurement aperture, they shift the released widths.",
  IMAGE_FWHM_AMBIGUOUS: "At least one profile width is ambiguous because another lobe reaches the threshold.",
  IMAGE_HOT_PIXELS: "The image contains an elevated number of hot-pixel candidates.",
  IMAGE_MOMENTS_UNDEFINED: "The ROI moments could not be determined.",
  IMAGE_MULTI_PEAK: "More than one significant peak was detected.",
  IMAGE_NEGATIVE_POWER: "The negative power is high compared with the positive power; check the background correction.",
  IMAGE_NOISE_SCALE_SUSPECT: "The background noise estimate may not distinguish beam from noise.",
  IMAGE_ORIENTATION_UNSTABLE: "The beam orientation is unstable.",
  IMAGE_PEDESTAL_HINT: "A remaining background level may bias the reported widths.",
  IMAGE_RESIDUAL_HIGH: "The Gaussian model residual exceeds the release ceiling.",
  IMAGE_ROI_SENSITIVE: "The released quantities react noticeably to the ROI choice.",
  IMAGE_ROI_UNDETERMINABLE: "The ROI stability sweep could not determine the sensitivity spread.",
  IMAGE_SATURATION: "Pixels are at or above the saturation limit.",
  IMAGE_CLIPPING_SUSPECT: "Many pixels share the frame maximum below the sensor limit; clipping may be present.",
  IMAGE_RADIAL_NOISE_DOMINATED: "The radial distribution is dominated by background noise.",
  IMAGE_WIDTH_RESOLUTION_LIMIT: "The smaller released width is below the resolution limit and reads systematically high under pixel integration.",
  IMAGE_ABSORBED_POWER: "The background model may contain a wide, faint beam wing and bias the released width.",
  IMAGE_TIER_DISAGREEMENT: "The released aperture widths differ from the diagnostic ROI moments.",
  IMAGE_WIDTH_SCATTER: "The released widths have substantial uncertainty from this image's noise.",
  IMAGE_COVERAGE_LOSS: "Missing data in the measurement aperture slightly shifts the released widths.",
  IMAGE_ALPHA_GATE_WEAK: "The aperture-consistency check cannot distinguish reliably for this image.",
  IMAGE_TIER_CHECK_UNAVAILABLE: "The released widths were not compared with the diagnostic ROI moments.",
  IMAGE_WING_PROBE_REDUCED: "The widest wing probes do not fit in the ROI.",
  IMAGE_BACKGROUND_GRADIENT_IN_REFERENCE: "The background reference has a trend that a single-offset correction leaves in the image.",
  IMAGE_BEAM_IN_BACKGROUND_REFERENCE:
    "A background reference rectangle intersects the beam's 4-sigma ellipse; the background model may contain beam power.",
};

const WARNING_DESCRIPTION_DE: Record<SimulationWarningCode, string> = {
  PARAXIAL_ANGLE_HIGH: "Der Ausbreitungswinkel ist so groß, dass die paraxiale Näherung ungenau werden kann.",
  APERTURE_MARGIN_LOW: "Der Strahl liegt nahe an der Aperturgrenze.",
  MATERIAL_CONSTANT_N: "Dieses Material verwendet einen festen Brechungsindex; Dispersion ist nicht verfügbar.",
  MATERIAL_OUTSIDE_RANGE: "Die gewählte Wellenlänge liegt außerhalb des verfügbaren Bereichs des Materials.",
  MATERIAL_UNKNOWN: "Ein benoetigtes Material ist nicht bekannt oder der Katalog lieferte keines; Einzelheiten in der Meldung.",
  DISPERSION_UNAVAILABLE: "Für dieses Material sind keine Dispersionsdaten verfügbar.",
  FIELD_PROPAGATION_UNAVAILABLE: "Die Ausbreitung des Feldes kann für diese Einstellung nicht berechnet werden.",
  FIELD_SAMPLING_LOW: "Ein Abtast- oder Gitter-Hinweis zur Feldrechnung; Einzelheiten stehen in der Meldung.",
  MEASUREMENT_FIT_RESIDUAL_HIGH: "Die Abweichung des Strahl-Fits überschreitet die Meldeschwelle.",
  UNSUPPORTED_PROFILE_PROPAGATION: "Das gewählte Profil wird für die Ausbreitung angenähert.",
  INVALID_INPUT: "Die Eingabe ist für diese Berechnung nicht verwendbar.",
  IMAGE_APERTURE_SUPPRESSED: "Die Blenden-Momente der Stufe B werden nicht freigegeben, weil ein Freigabe-Gate fehlgeschlagen ist; der Grund steht in der Meldung.",
  IMAGE_AXIS_NOT_RESOLVED: "Die freigegebene Nebenachse liegt unterhalb der aufloesbaren Groesse.",
  IMAGE_BACKGROUND_DEGENERATE: "Das angeforderte Hintergrund-Modell konnte nicht angewendet werden; das Bild wird ohne diese Korrektur ausgewertet.",
  IMAGE_EDGE_TOUCH: "Der Strahl erreicht den Bildrand; Leistung außerhalb des Bildes kann nicht ausgeschlossen werden.",
  IMAGE_FIT_NOT_CONVERGED: "Der 2D-Gauß-Fit ist nicht zu einer verwendbaren Geometrie konvergiert.",
  IMAGE_FLOAT_SPECIALS: "Das Bild enthaelt nicht-endliche Pixelwerte; wo sie in der Messblende liegen, verschieben sie die freigegebenen Breiten.",
  IMAGE_FWHM_AMBIGUOUS: "Mindestens eine Profilbreite ist mehrdeutig, weil eine weitere Keule die Schwelle erreicht.",
  IMAGE_HOT_PIXELS: "Das Bild enthält auffällig viele Hot-Pixel-Kandidaten.",
  IMAGE_MOMENTS_UNDEFINED: "Die ROI-Momente konnten nicht bestimmt werden.",
  IMAGE_MULTI_PEAK: "Es wurden mehrere deutliche Peaks erkannt.",
  IMAGE_NEGATIVE_POWER: "Der negative Leistungsanteil ist im Verhältnis zur positiven Leistung hoch; Hintergrundkorrektur prüfen.",
  IMAGE_NOISE_SCALE_SUSPECT: "Die Hintergrund-Rauschschätzung kann Strahl und Rauschen möglicherweise nicht sicher trennen.",
  IMAGE_ORIENTATION_UNSTABLE: "Die Strahlorientierung ist instabil.",
  IMAGE_PEDESTAL_HINT: "Ein verbleibender Hintergrundanteil kann die ausgewiesenen Breiten beeinflussen.",
  IMAGE_RESIDUAL_HIGH: "Das Residuum des Gauß-Modells überschreitet die Freigabegrenze.",
  IMAGE_ROI_SENSITIVE: "Die freigegebenen Groessen reagieren merklich auf die ROI-Wahl.",
  IMAGE_ROI_UNDETERMINABLE: "Die ROI-Stabilitätsprüfung konnte die Empfindlichkeit nicht bestimmen.",
  IMAGE_SATURATION: "Pixel liegen an oder über der Sättigungsgrenze.",
  IMAGE_CLIPPING_SUSPECT: "Viele Pixel haben unterhalb der Sättigungsgrenze denselben Bild-Maximalwert; Sensor-Clipping ist möglich.",
  IMAGE_RADIAL_NOISE_DOMINATED: "Die radiale Verteilung wird vom Hintergrundrauschen dominiert.",
  IMAGE_WIDTH_RESOLUTION_LIMIT: "Die kleinere freigegebene Breite liegt unterhalb der Aufloesungsgrenze und wird bei Pixelintegration systematisch zu hoch gemessen.",
  IMAGE_ABSORBED_POWER: "Das Hintergrund-Modell kann einen breiten, schwachen Strahlflügel enthalten und die freigegebene Breite beeinflussen.",
  IMAGE_TIER_DISAGREEMENT: "Die freigegebenen Blendenbreiten weichen von den diagnostischen ROI-Momenten ab.",
  IMAGE_WIDTH_SCATTER: "Die freigegebenen Breiten haben durch das Bildrauschen eine merkliche Streuung.",
  IMAGE_COVERAGE_LOSS: "Fehlende Daten in der Messblende verschieben die freigegebenen Breiten leicht.",
  IMAGE_ALPHA_GATE_WEAK: "Die Konsistenzpruefung der Blende hat bei diesem Bildrauschen keine Trennschaerfe.",
  IMAGE_TIER_CHECK_UNAVAILABLE: "Die freigegebenen Breiten wurden nicht mit den diagnostischen ROI-Momenten verglichen.",
  IMAGE_WING_PROBE_REDUCED: "Die weitesten Flügelsonden passen nicht in das ROI.",
  IMAGE_BACKGROUND_GRADIENT_IN_REFERENCE: "Die Hintergrundreferenz weist einen Verlauf auf, den eine Einzelwert-Korrektur im Bild belässt.",
  IMAGE_BEAM_IN_BACKGROUND_REFERENCE:
    "Ein Hintergrund-Referenzrechteck schneidet die 4-sigma-Ellipse des Strahls; das Hintergrund-Modell kann Strahlleistung enthalten.",
};

const IMAGE_WARNING_TITLE_EN: Record<string, string> = {
  IMAGE_APERTURE_SUPPRESSED: "Stage-B aperture suppressed",
  IMAGE_AXIS_NOT_RESOLVED: "Axis not resolved",
  IMAGE_BACKGROUND_DEGENERATE: "Background model degenerate",
  IMAGE_EDGE_TOUCH: "Beam touches the edge",
  IMAGE_FIT_NOT_CONVERGED: "Fit did not converge",
  IMAGE_FLOAT_SPECIALS: "Non-finite pixels",
  IMAGE_FWHM_AMBIGUOUS: "FWHM ambiguous",
  IMAGE_HOT_PIXELS: "Hot-pixel candidates",
  IMAGE_MOMENTS_UNDEFINED: "Moments undefined",
  IMAGE_MULTI_PEAK: "Multiple peaks",
  IMAGE_NEGATIVE_POWER: "Negative power",
  IMAGE_NOISE_SCALE_SUSPECT: "Noise scale suspect",
  IMAGE_ORIENTATION_UNSTABLE: "Orientation unstable",
  IMAGE_PEDESTAL_HINT: "Background pedestal",
  IMAGE_RESIDUAL_HIGH: "Residual too high",
  IMAGE_ROI_SENSITIVE: "Result depends on the ROI",
  IMAGE_ROI_UNDETERMINABLE: "ROI sensitivity undeterminable",
  IMAGE_SATURATION: "Saturation",
  IMAGE_CLIPPING_SUSPECT: "Possible sensor clipping",
  IMAGE_RADIAL_NOISE_DOMINATED: "Radial profile noise-dominated",
  IMAGE_WIDTH_RESOLUTION_LIMIT: "Width near the resolution limit",
  IMAGE_ABSORBED_POWER: "Absorbed-power wing",
  IMAGE_TIER_DISAGREEMENT: "Stage A and stage B disagree",
  IMAGE_WIDTH_SCATTER: "Released width scatter",
  // S20 stage A (additive).
  IMAGE_COVERAGE_LOSS: "Aperture partly without data",
  // S20 stage B (additive).
  IMAGE_ALPHA_GATE_WEAK: "Consistency test had no power",
  IMAGE_TIER_CHECK_UNAVAILABLE: "Cross-tier check not evaluated",
  IMAGE_WING_PROBE_REDUCED: "Wing probes reduced by the ROI",
  // S20 stage E (additive).
  IMAGE_BACKGROUND_GRADIENT_IN_REFERENCE: "Background reference is tilted",
  IMAGE_BEAM_IN_BACKGROUND_REFERENCE: "Background reference intersects beam",
};

const IMAGE_WARNING_TITLE_DE: Record<string, string> = {
  IMAGE_APERTURE_SUPPRESSED: "Blenden-Stufe B unterdrückt",
  IMAGE_AXIS_NOT_RESOLVED: "Achse nicht aufgelöst",
  IMAGE_BACKGROUND_DEGENERATE: "Untergrundmodell entartet",
  IMAGE_EDGE_TOUCH: "Strahl berührt den Rand",
  IMAGE_FIT_NOT_CONVERGED: "Fit nicht konvergiert",
  IMAGE_FLOAT_SPECIALS: "Nicht-endliche Pixel",
  IMAGE_FWHM_AMBIGUOUS: "FWHM mehrdeutig",
  IMAGE_HOT_PIXELS: "Hot-Pixel-Kandidaten",
  IMAGE_MOMENTS_UNDEFINED: "Momente undefiniert",
  IMAGE_MULTI_PEAK: "Mehrere Peaks",
  IMAGE_NEGATIVE_POWER: "Negative Leistung",
  IMAGE_NOISE_SCALE_SUSPECT: "Rauschskala unsicher",
  IMAGE_ORIENTATION_UNSTABLE: "Orientierung instabil",
  IMAGE_PEDESTAL_HINT: "Untergrundsockel",
  IMAGE_RESIDUAL_HIGH: "Residuum zu hoch",
  IMAGE_ROI_SENSITIVE: "Ergebnis hängt vom ROI ab",
  IMAGE_ROI_UNDETERMINABLE: "ROI-Empfindlichkeit unbestimmbar",
  IMAGE_SATURATION: "Sättigung",
  IMAGE_CLIPPING_SUSPECT: "Mögliches Sensor-Clipping",
  IMAGE_RADIAL_NOISE_DOMINATED: "Radialprofil rauschdominiert",
  IMAGE_WIDTH_RESOLUTION_LIMIT: "Breite nahe der Auflösungsgrenze",
  IMAGE_ABSORBED_POWER: "Absorbierte Leistungsflügel",
  IMAGE_TIER_DISAGREEMENT: "Stufe A und Stufe B weichen ab",
  IMAGE_WIDTH_SCATTER: "Streuung der freigegebenen Breite",
  // S20 Stufe A (additiv).
  IMAGE_COVERAGE_LOSS: "Blende teilweise ohne Daten",
  // S20 Stufe B (additiv).
  IMAGE_ALPHA_GATE_WEAK: "Konsistenztest ohne Trennschärfe",
  IMAGE_TIER_CHECK_UNAVAILABLE: "Stufenvergleich nicht ausgewertet",
  IMAGE_WING_PROBE_REDUCED: "Flügelsonden durch ROI verkürzt",
  // S20 Stufe E (additiv).
  IMAGE_BACKGROUND_GRADIENT_IN_REFERENCE: "Untergrundreferenz ist verkippt",
  IMAGE_BEAM_IN_BACKGROUND_REFERENCE: "Hintergrundreferenz schneidet Strahl",
};

const en: Strings = {
  tabBeamline: "Beamline",
  tabOptimizer: "Optimizer",
  tabImport: "Import",
  tabFit: "Beam fit",
  tabField: "Field",
  tabAnalyzer: "Analyzer",
  importJson: "Import JSON",
  exportJson: "Export JSON",
  preset: "PRESET",
  beam: "BEAM",
  gaussian: "Gaussian",
  elliptical: "Elliptical",
  moment: "Moment",
  wavelength: "WAVELENGTH",
  power: "POWER",
  waistW0: "WAIST w0",
  waistPos: "WAIST POS z0",
  xAxis: "X AXIS",
  yAxis: "Y AXIS",
  momentNote: "Second-moment beam: D4σ diameter at waist + M² per axis.",
  modeHelper: "MODE → M² HELPER",
  applyM2: "Apply as beam M²",
  modeNote: "Ideal HG/LG mode order sets the envelope M². For TRUE mode fields switch the Field tab to FIELD SOURCE: HG/LG.",
  invalidOrder: "invalid order",
  pulse: "PULSE",
  ePulse: "E / pulse",
  pRate: "P̄ + rate",
  pulseEnergy: "PULSE ENERGY",
  avgPower: "AVG POWER",
  repRate: "REP RATE",
  durFwhm: "DURATION FWHM",
  shape: "SHAPE",
  rect: "Rectangular",
  widthBasis: "WIDTH DISPLAY BASIS",
  b1e2: "1/e² radius w",
  bFwhm: "FWHM diameter",
  bD4: "D4σ diameter",
  bRms: "rms radius",
  basisNote: "Affects result tables. The plot stays in 1/e² radius.",
  designNote: "Design prototype — every value rendered from the headless core result. UI computes no physics.",
  plotTitle: "BEAM ENVELOPE — 1/e² RADIUS vs z",
  simFailed: "Input rejected by the core validator",
  simFailedSub: "See warnings panel for the exact errors.",
  beamlineTitle: "BEAMLINE",
  compsWord: "components",
  addFree: "+ FREE",
  addThin: "+ THIN LENS",
  addThick: "+ THICK LENS",
  addCyl: "+ CYL LENS",
  addSlab: "+ SLAB",
  addAperture: "+ APERTURE",
  source: "SOURCE",
  duplicate: "Duplicate",
  del: "Delete",
  positionZ: "POSITION z mm",
  lengthMm: "LENGTH mm",
  focalMm: "FOCAL LENGTH mm",
  axis: "ACTIVE AXIS",
  thickness: "THICKNESS mm",
  refIndex: "REFR. INDEX n",
  kindFree: "FREE SPACE",
  kindThin: "THIN LENS",
  kindCyl: "CYLINDRICAL LENS",
  kindSlab: "SLAB / WINDOW",
  kindThick: "THICK SPHERICAL LENS",
  kindAperture: "APERTURE / IRIS",
  outputWaist: "OUTPUT WAIST",
  zWaist: "z waist",
  thetaHalf: "θ half",
  pulseExit: "PULSE — AT EXIT PLANE",
  rPulseEnergy: "Pulse energy",
  peakPower: "Peak power",
  peakFluence: "Peak fluence",
  peakIntensity: "Peak intensity",
  pulseNote: "Gaussian spatial peak at the final plane",
  shapeNoteGauss: "Gaussian shape factor",
  shapeNoteSech: "sech² shape factor",
  shapeNoteRect: "rectangular shape factor",
  warnings: "WARNINGS",
  components: "COMPONENTS",
  apMargin: "aperture margin",
  fastNote: "Fast Mode — paraxial ABCD. Thick lenses and surface stacks are paraxial; aberrations are not modeled.",
  projectJson: "Project JSON",
  export: "Export",
  import: "Import",
  copyBtn: "Copy to clipboard",
  copiedBtn: "Copied ✓",
  download: "Download .modeforge.json",
  validateLoad: "Validate & load project",
  pastePlaceholder: "Paste a ModeForgeProject JSON…",
  presetFocus: "Thick-lens focus",
  presetFocusDesc: "1064 nm · pulsed · fluence at focus",
  presetTele: "Two-lens telescope",
  presetTeleDesc: "780 nm · 2× expander · clip check",
  presetAstig: "Astigmatic diode",
  presetAstigDesc: "405 nm · x/y split · cylinder lens",
  optTitle: "TWO-LENS TELESCOPE OPTIMIZER",
  optIntro: "Uses the current project beam. Grid search over lens pairs and positions, ranked by target mismatch.",
  lensCandidates: "LENS CANDIDATES",
  addLens: "+ LENS",
  searchGrid: "POSITION SEARCH GRID",
  candWord: "candidate layouts",
  target: "TARGET",
  targetPlane: "TARGET PLANE z mm",
  radiusAtTarget: "RADIUS @ TARGET mm",
  targetWaistR: "WAIST RADIUS mm",
  targetWaistZ: "WAIST POS z mm",
  targetNote: "Blank = unused. At least one target is required; the core validator enforces the rest.",
  constraints: "CONSTRAINTS",
  minSep: "MIN SEP mm",
  apMarginMin: "AP MARGIN ≥",
  maxResults: "MAX RESULTS",
  sensitivity: "SENSITIVITY ANALYSIS",
  sensShift: "± SHIFT mm",
  sensF: "± f mm",
  sensM2: "± M²",
  optPulseLabel: "Include pulse constraints (uses pulse panel)",
  runOpt: "Run optimizer",
  searching: "Searching…",
  thRank: "RANK",
  thLayout: "LAYOUT",
  thRadius: "RADIUS @ TGT",
  thMismatch: "MISMATCH",
  thWaist: "WAIST",
  thSens: "SENS ΔR",
  sendToBeamline: "Send to Beamline →",
  optEmptyText: "No solution satisfied the constraints — widen the grids or relax the aperture margin.",
  optFootnote: "Grid search over thin-lens pairs · ranked by relative mismatch · sensitivity re-runs the core with shifted parameters.",
  targetWord: "target",
  achievedWord: "achieved",
  atZWord: "at z",
  sensWord: "sensitivity",
  shiftWord: "shift",
  notRequested: "sensitivity: not requested",
  zmxTitle: "ZMX SEQUENTIAL PRESCRIPTION",
  sampleSinglet: "SAMPLE: SINGLET",
  sampleUnknown: "SAMPLE: UNKNOWN GLASS",
  lambdaForN: "λ FOR n",
  parseRx: "Parse prescription",
  importBlocked: "IMPORT BLOCKED — UNRESOLVED MATERIALS",
  importBlockedNote:
    "Load an AGF catalog on the right that defines these glasses, adopt it into the resolver, then parse again. No silent fallback indices.",
  surfaceStack: "SURFACE STACK",
  addToBeamline: "Add to Beamline →",
  thSurfR: "R mm",
  thSurfT: "t AFTER mm",
  thSurfMat: "MATERIAL",
  thSurfAp: "AP mm",
  agfTitle: "AGF GLASS CATALOG",
  sampleCatalog: "SAMPLE CATALOG",
  parseCatalog: "Parse catalog",
  materials: "MATERIALS",
  adopt: "Use in material resolver",
  resolverActive: "Resolver active",
  sessionWord: (n) => `${n} session material${n === 1 ? "" : "s"} active in resolver`,
  importNote:
    "Materials without CD coefficients import as constant-n and carry DISPERSION_UNAVAILABLE warnings. Unknown ZMX glasses block import until a catalog resolves them — no silent index guesses.",
  fitTitle: "MEASURED-BEAM FIT",
  fitIntro: "Paste z / width pairs from a beam profiler. Least-squares fit of w²(z) recovers waist, position, divergence and M².",
  sampleCaustic: "SAMPLE: CAUSTIC SCAN",
  pointsWord: "points parsed",
  widthColBasis: "WIDTH COLUMN BASIS",
  wavelengthUm: "WAVELENGTH µm",
  runFit: "Fit beam",
  fitW0: "WAIST w0",
  fitZ0: "WAIST POS z0",
  fitTheta: "θ HALF-ANGLE",
  fitRms: "RESIDUAL RMS",
  fitMaxRes: "MAX REL RESIDUAL",
  causticTitle: "CAUSTIC — MEASURED vs FITTED",
  measured: "measured",
  fitCurve: "fit w(z)",
  useAsBeam: "Use as beam input →",
  fitNote: "Quadratic least-squares on w²(z) · fitted M² below 1 or residuals above 2% raise core warnings.",
  fieldTitle: "FIELD MODE",
  fieldIntro:
    "Scalar field propagation on a grid — Fresnel transfer function or angular spectrum. Diffraction that Fast Mode cannot see.",
  useProjectBeam: "← USE PROJECT BEAM",
  projectBeamWord: "project beam",
  fieldSource: "SOURCE — GAUSSIAN AT WAIST",
  gridN: "GRID N×N",
  spacingDx: "SPACING dx mm",
  fieldWaist: "WAIST w0 mm",
  extentWord: "grid extent",
  extentCap: "N capped at 256 (FFT-accelerated)",
  hardAperture: "HARD APERTURE BEFORE PROPAGATION",
  apertureR: "APERTURE RADIUS mm",
  propagation: "PROPAGATION",
  distance: "DISTANCE mm",
  method: "METHOD",
  angularSpectrum: "Angular spectrum",
  runField: "Run field job",
  propagating: "Propagating…",
  fieldJobNote:
    "Runs the headless field-fresnel job: power before/after, second-moment radii, sampling warnings. Full beamline field propagation lands with the Field Mode UI stage.",
  powerIn: "POWER IN",
  powerOut: "POWER OUT",
  crossCheck: "CROSS-CHECK — FIELD vs FAST MODE AT z = d",
  analyticNoteAp:
    "Hard aperture active — diffraction is expected to pull the field away from the paraxial envelope. That deviation is exactly what Field Mode exists to show.",
  analyticNoteOk: "Matches the Fast-Mode envelope within 2% — sampling is adequate for this distance.",
  analyticNoteBad:
    "Deviation above 2% without an aperture usually means the grid is too coarse — raise N or use “Use project beam” to auto-size dx.",
  inputPlane: "|E|² — INPUT PLANE (z = 0)",
  outputPlane: "|E|² — OUTPUT PLANE (z = d)",
  dftNote: "Unitary DFT — power is conserved in free propagation; losses only from hard apertures. sqrt-scaled colormap.",
  fieldVsWord: "field",
  vsParaxialWord: "vs paraxial",
  scalarBadge: "SCALAR · S11",
  zmxPlaceholder: "Paste a .zmx sequential file… (SURF / RADIUS / CURV / DISZ / GLAS / DIAM)",
  agfPlaceholder: "Paste an .agf catalog… (NM + CD lines)",
  modeBeamline: "Project beamline",
  modeSource: "Source playground",
  probeZ: "EVALUATION PLANE z mm",
  planesQuick: "PLANES",
  autoDx: "AUTO dx",
  probePlane: "|E|² — EVALUATION PLANE",
  powerAtZ: "POWER @ z",
  beamlineIntro:
    "Propagates the scalar field through the current beamline — lenses as paraxial phase masks, hard apertures included — and reads it out at any z plane.",
  beamlineNote:
    "Planes inside glass use the reduced optical path t/n. A plane exactly at a lens or aperture samples directly behind the element. Planes beyond the last component continue in free space.",
  crossCheckAtZ: "CROSS-CHECK — FIELD vs FAST MODE AT z",
  segmentWord: "segment",
  analyticNoteSampling:
    "SAMPLING LIMIT - the grid cannot resolve this result (see warnings below): the deviation is a grid artifact, not physics. Do not trust the field image near the focus.",
  surfacePhase: "SURFACE PHASE",
  spIdeal: "Ideal (paraxial)",
  spSag: "Real sag (TEA)",
  sagNote:
    "Real sag imprints the exact spherical surface phase of each thick lens and surface stack (thin-element approximation): sag-driven spherical aberration becomes visible. Incidence-angle aberrations are not modeled — watch the sampling warnings.",
  surfWord: "surf",
  loadFile: "LOAD FILE",
  fieldSourceMode: "FIELD SOURCE",
  modeFundamental: "Gauss",
  imgUpload: "UPLOAD — IMAGE FILE",
  imgDropHint: "Drop a .tif / .tiff / .png here (max 128 MB)",
  imgPickFile: "Pick file",
  imgPage: "PAGE",
  imgChannel: "CHANNEL",
  imgCalibration: "CALIBRATION",
  imgCalX: "um / px X",
  imgCalY: "um / px Y",
  imgBackground: "BACKGROUND",
  imgBgNone: "None",
  imgAuto: "Auto",
  imgAutoMode: "Auto mode",
  imgBgManualOffset: "Manual offset",
  imgBgOffsetCounts: "OFFSET counts",
  imgRoi: "ROI",
  imgRoiFull: "Full frame",
  imgRoiRect: "Rectangle",
  imgRoiAuto: "Auto",
  imgRoiNote: "Drag a new rectangle on the image, drag inside the blue box to move it, drag an edge or corner to resize, type pixel coordinates, or apply a suggestion. Full frame uses the whole image. Run analysis confirms the ROI.",
  imgRoiOutOfRange: "ROI rectangle is outside the image — please correct it.",
  imgRoiClamped: "ROI rectangle was clamped to the image.",
  imgRoiFromFit: "ROI from fit",
  imgRun: "Run analysis",
  imgBusy: "Running…",
  imgDecoding: "Decoding…",
  imgSuppressed: "suppressed",
  imgPhysical: "physical",
  imgPhysicalD4: "physical D4sigma",
  imgKeyResults: "KEY RESULTS",
  imgRawRender: "RAW RENDER",
  imgNoData: "Load an image and run the analysis. The result is rendered here.",
  imgExportJson: "Export JSON",
  imgExportCsv: "Export CSV",
  imgExportPng: "Export PNG",
  imgDiagnostics: "DIAGNOSTICS",
  imgRawStats: "RAW STATISTICS",
  imgWarnings: "WARNINGS",
  imgBackgroundNoise: "BACKGROUND / NOISE",
  imgSigmaB: "sigma_B counts",
  imgScaleSource: "scale source",
  imgMedian: "median",
  imgMean: "mean",
  imgStd: "std",
  imgMad: "MAD",
  imgIqr: "IQR",
  imgFloorApplied: "floor applied",
  imgRoiStability: "ROI / STABILITY",
  imgValidVariants: "valid variants",
  imgUndeterminable: "undeterminable",
  imgHalfSpread: "D4sigma HALF-SPREAD",
  imgMomentsProfiles: "MOMENTS / PROFILES",
  imgStageB: "RELEASED (stage B)",
  imgD4Sigma: "D4sigma (ellipse)",
  imgCentroid: "centroid",
  imgTheta: "theta",
  imgEllipticity: "ellipticity",
  imgEllipticityPhysical: "ellipticity (physical)",
  imgFitWidth: "fit width 4sigma",
  imgStageA: "ROI MOMENTS (stage A)",
  imgProfilesCut: "CUT PROFILES",
  imgFitsResiduals: "FITS / RESIDUALS",
  imgFitStatus: "FIT STATUS",
  imgResidualRms: "residual rms",
  imgResidualMax: "residual max abs",
  imgResidualSigma: "residual sigma",
  imgResidualNrmse: "NRMSE",
  imgResidualRmsSigma: "RMS / sigma_B",
  imgResidualMode: "Residual normalization",
  imgResidualModeCounts: "Counts",
  imgResidualModePercentPeak: "% peak",
  imgResidualModeSigma: "sigma_B",
  imgResidualModePercentPeakUnavailable: "% peak requires a finite, positive Gaussian fitted amplitude.",
  imgResidualModeSigmaNoSigma: "sigma_B normalization requires sigma_B > 0.",
  imgResidualModeSigmaZero: "sigma_B normalization is unavailable when the noise scale source is zero.",
  imgResidualModeSigmaFloor: "sigma_B normalization is unavailable when a noise floor was applied.",
  imgResidualBlockHint:
    "Map cells are block means. For b > 1, |R/sigma_B| approximately 1 is only a noise-level approximation; edge blocks and correlated residuals can differ.",
  imgResidualScale: "shared residual scale S",
  imgResidualMaxAbs: "max |R|",
  imgResidualMaxDisplayBlocks: "max |R| (display blocks)",
  imgResidualManualScale: "manual S",
  imgResidualAutoScale: "automatic",
  imgResidualGaussMap: "Gaussian residual",
  imgResidualSuperMap: "super-Gaussian residual",
  imgResidualSuperUnavailable: "Super-Gaussian residual views require a converged fit.",
  imgResidualHistogram: "RESIDUAL HISTOGRAM",
  imgHistogramUnderflow: "underflow",
  imgHistogramOverflow: "overflow",
  imgSkewness: "skewness",
  imgExcessKurtosis: "excess kurtosis",
  imgFiniteCount: "finite count",
  imgFullResRoi: "full-resolution finite ROI",
  imgModelComparison: "MODEL COMPARISON",
  imgGaussianDescription: "n near 1: the Gaussian describes the beam.",
  imgFlatTopDescription: "n clearly above 1: flat-top character.",
  imgExponentBoundaryDescription: "n is at its fit boundary; no interpretation is shown.",
  imgExponentNoInterpretation: "n lies between the interpretation ranges; no interpretation is shown.",
  imgQualityBox: "QUALITY / CONFIDENCE",
  imgQualityStability: "ROI stability",
  imgGeometryReleasable: "fit geometry releasable",
  imgMomentSuppression: "moment release",
  imgWidthFwhm: "FWHM width",
  imgWidth1e2: "1/e² width",
  imgYes: "yes",
  imgNo: "no",
  imgPass: "pass",
  imgFail: "fail",
  imgPeakToBackground: "peak / sigma_B",
  imgSize: "size",
  imgDtype: "data type",
  imgMin: "min",
  imgMax: "max",
  imgDynamicRange: "dynamic range",
  imgSaturated: "saturated",
  imgClippingSuspect: "clipping suspect",
  imgHotPixels: "hot-pixel candidates",
  imgZeros: "zeros",
  imgNegatives: "negatives",
  imgNonFinite: "non-finite",
  imgEdgeTouch: "edge touch",
  imgLocalMaxima: "local maxima",
  imgHistogram: "HISTOGRAM",
  imgFitParams: "GAUSS 2D PARAMETERS",
  imgAmplitude: "amplitude",
  imgFitBackground: "fit background",
  imgSigmaMajor: "sigma major",
  imgSigmaMinor: "sigma minor",
  imgSuperGaussN: "super-Gauss n",
  imgIterations: "iterations",
  imgCutX: "cut X",
  imgCutY: "cut Y",
  imgProjX: "projection X",
  imgProjY: "projection Y",
  imgAxisMajor: "major axis",
  imgAxisMinor: "minor axis",
  imgMajor: "major",
  imgMinor: "minor",
  imgLongAxis: "major axis",
  imgShortAxis: "minor axis",
  imgResidualMap: "RESIDUAL MAP",
  imgAperture: "RELEASE GATES",
  imgGateFit: "fit converged",
  imgGateAmplitude: "amplitude positive",
  imgGateResidual: "residual",
  imgGateClip: "check ellipse inside the ROI",
  imgGateAlpha: "alpha consistency",
  imgGateMultiPeak: "single peak",
  imgPedestal: "pedestal hint",
  imgAbsorbedPower: "absorbed-power flag",
  imgAlphaUsed: "alpha used",
  imgWidthScatter: "width scatter",
  imgPartialSweep: "partial sweep",
  imgFullFrame: "full frame",
  imgClamped: "clamped",
  imgRoiSource: "ROI source",
  imgRoiSourceInput: "rectangle",
  imgRoiSourceFull: "full frame",
  imgRoiSourceAuto: "automatic",
  imgDisplayNote:
    "Display-only: linear contrast of the visible pixels and a close-up of a compact spot. Not a calibrated intensity scale. A 4sigma ellipse encloses about 86 percent of a Gaussian's power; the stretch still shows the fainter tails. The dashed orange overlay is the fit ellipse, not the ROI.",
  imgSpotCloseup: "spot close-up",
  imgViewFull: "full frame",
  imgViewForcedBgDraw: "Full-frame view is required while drawing background rectangles.",
  imgColorMap: "Color map",
  imgColorMapGray: "Grayscale",
  imgColorMapTurbo: "Turbo",
  imgColorMapViridis: "Viridis",
  imgCountsUnit: "counts",
  imgLegendFit: "fit 4sigma ellipse",
  imgLegendRoi: "ROI rectangle",
  imgRoiFullFrameNote: "ROI = full frame",
  imgLegendSuggestion: "suggested ROI",
  imgRoiOutsideCrop: "ROI is outside this close-up — switch to full frame to see it.",
  imgEllipsePowerNote: "4sigma ellipse: about 86 percent of Gaussian power; stretch shows fainter tails.",
  imgCloseupRoiNote:
    "This close-up is about three times the D4sigma diameter. Switch to full frame to see the blue ROI rectangle. The orange dashed ellipse is the fit, not a clip of the beam.",
  imgCloseupFallbackNote:
    "This close-up is a window of about 0.6 times the shorter frame side (at least 96 px), not three D4sigma diameters. Switch to full frame to see the blue ROI rectangle. The orange dashed ellipse is the fit, not a clip of the beam.",
  imgCloseupFixedNote:
    "This close-up is a 96 px window around the spot, not three D4sigma diameters. Switch to full frame to see the blue ROI rectangle. The orange dashed ellipse is the fit, not a clip of the beam.",
  imgAnisoPxNote: "anisotropic pixels not directly convertible",
  imgSigmaBUnmeasurable: "sigma_B not measurable",
  imgPhysicalFromFit: "from fit (stage B suppressed)",
  imgUngatedHint: "guideline value - no gate check of its own",
  imgUngatedInfo:
    "Only D4sigma passes the release checks. The 1/e2 and FWHM values are profile-cut widths, and the fit 4-sigma value is a model width. When D4sigma is suppressed, these values rest on the unreleased fit and are shown for orientation only. The D4sigma release checks cover fit convergence, non-positive amplitude, residual ceiling, the ellipse/ROI clipping gate, alpha consistency, multi-peak, and coverage.",
  imgResidualRoiLabel: (width, height) => `RESIDUAL MAP — ROI ${width}×${height} px`,
  imgResidualWindowLabel: (width, height) => `RESIDUAL MAP — ${width}×${height} px`,
  imgWarningTitle: (code) => IMAGE_WARNING_TITLE_EN[code] ?? code,
  warningDescription: (code, fallback) => WARNING_DESCRIPTION_EN[code as SimulationWarningCode] ?? fallback,
  imgValid: "valid",
  imgPeak: "peak",
  imgEncircled: "encircled power radii",
  imgModelCompare: "model RMS reduction",
  imgSampleCount: "samples",
  imgScaleMad: "MAD",
  imgScaleIqr: "IQR",
  imgScaleFloor: "floor",
  imgScaleZero: "zero",
  imgReasonFitNotConverged: "fit did not converge",
  imgReasonNonpositiveAmplitude: "non-positive amplitude",
  imgReasonResidualHigh: "residual too high",
  imgReasonApertureClipped: "ellipse clipped by the ROI",
  imgReasonCoverageInsufficient: "aperture partly without data",
  imgReasonAlphaInconsistent: "alpha-consistency gate",
  imgReasonMultiPeak: "multiple peaks",
  imgStatusConverged: "converged",
  imgStatusMaxIterations: "iteration limit",
  imgStatusTimeBudget: "time budget exceeded",
  imgStatusSingular: "singular normal equations",
  imgStatusInvalidStart: "invalid start",
  imgWidthLowSignal: "low signal",
  imgWidthNonpositivePeak: "non-positive peak",
  imgWidthGap: "gap in the profile",
  imgMomentNonfinite: "non-finite aggregate",
  imgMomentNonpositiveSum: "non-positive sum",
  imgMomentBackgroundDominated: "background-dominated",
  imgMomentIndefinite: "indefinite covariance",
  imgMomentZeroCovariance: "zero covariance",
  imgAmbiguous: "ambiguous",
  imgGauss2d: "Gauss 2D",
  imgSuperGauss2d: "super-Gauss 2D",
  imgBgDarkFrame: "Dark frame",
  imgBgRectMedian: "Rectangle median",
  imgBgRobustPlane: "Robust plane",
  imgRectAdd: "Add rectangle",
  imgRectRemove: "Remove",
  imgRectCorners: "Corner preset",
  imgRectEditor: "RECTANGLES",
  imgRectHint: "Place rectangles on empty background, not on the beam. The corner preset fills four edge patches.",
  imgRectX0: "x0",
  imgRectY0: "y0",
  imgRectW: "w",
  imgRectH: "h",
  imgBgPickDark: "Pick dark frame",
  imgBgDarkLoaded: (name, width, height, dtype) => `Loaded: ${name} · ${width}×${height} · ${dtype}`,
  imgSuggestedRoi: "Suggested ROI",
  imgApplySuggestion: "Apply suggestion",
  imgSuggestionClamped: "Clamped to the image frame.",
  imgSuggestionNoiseDominated:
    "Noise-dominated: the mask covers much of the frame under a non-measured noise scale — verify before applying.",
  imgSettingsReset: "Analysis settings were reset for the new image (display preferences kept).",
  imgSettingsAdjusted: "Settings were adjusted to the new image size.",
  imgSettingsDarkDtypeChanged: "The dark frame was removed because the image data type changed.",
  imgBgAutoRobustPlane: "Auto background: robust plane over corner references.",
  imgBgAutoNone: "Auto background: no background correction was applied.",
  imgAutoRoi: (x0, y0, width, height) => `Auto ROI: ${x0},${y0},${width} × ${height}`,
  imgAutoRoiNoSuggestion: "Auto ROI: no suggestion — full frame was analyzed.",
  imgSymmetry: "SYMMETRY",
  imgRotationAsymmetry: "rotation asymmetry",
  imgAxialAsymmetryX: "axial asymmetry X",
  imgAxialAsymmetryY: "axial asymmetry Y",
  imgAlphaThreshold: "alpha threshold",
  imgMcRealizationCount: "MC realizations",
  imgMultiPeakThreshold: "multi-peak threshold",
  imgProfilePlot: "PROFILE PLOT",
  imgProfileMeasured: "measured",
  imgProfileGaussModel: "Gauss fit model",
  imgProfileSuperModel: "Super-Gauss fit model",
  imgProfileFwhmMark: "FWHM crossings",
  imgProfileE2Mark: "1/e² crossings",
  imgProfilePositionPx: "position — px",
  imgProfilePositionUm: "position — µm",
  imgProfileIntensity: "intensity — counts",
  imgProfileExportPng: "Plot PNG",
  imgProfileMissing: "This profile was not released for the current run.",
  imgProfileNoModel: "No fit model drawn: the fit produced no parameters for this line.",
  imgProfileResidualLane: "RESIDUAL LANE",
  imgProfileResidualIntensity: "residual — counts",
  imgProfileProjectionNote:
    "A projection is a sum over the ROI, so the model line is the analytic marginal of the fitted 2D Gauss (sigma from the covariance) plus the summed background.",
  imgProfileAxisNote: "Position is the signed distance from the profile centre along the profile direction.",
  imgSuggestionCalloutTighter: "This run suggests a tighter ROI — apply it and analyse again.",
  imgSuggestionCalloutWider: "This run suggests a wider ROI — apply it and analyse again.",
  imgSuggestionCalloutShifted: "This run suggests a differently placed ROI — apply it and analyse again.",
  imgSuggestionCalloutNumbers: (width, height, x0, y0, analyzedWidth, analyzedHeight, areaPercent) =>
    `Proposal ${width}×${height} px at x0 ${x0}, y0 ${y0} · area ${areaPercent} versus the analysed ${analyzedWidth}×${analyzedHeight} px.`,
  imgSuggestionCalloutWhy:
    "The proposal is iterative — each run recomputes it from that run's corrected image and noise scale, so it can refine after an applied change.",
  imgApplySuggestionRun: "Apply and analyse again",
  imgRoiFitNotNarrowed: "Profile is not Gaussian — the ROI is not narrowed further.",
  imgDrawTargetRoi: "Measurement ROI",
  imgDrawTargetBgRect: "Background rectangle",
  imgLegendBgRect: "background rectangle",
  imgBgDarkDimMismatch: (darkWidth, darkHeight, imageWidth, imageHeight) =>
    `Dark frame dimensions ${darkWidth}×${darkHeight} do not match image dimensions ${imageWidth}×${imageHeight}.`,
  imgBgDarkDecodeFailed: "The dark frame file could not be read.",
  imgBgDarkDtypeMismatch: (darkDtype, imageDtype) =>
    `Dark frame data type ${darkDtype} does not match image data type ${imageDtype}.`,
};

const de: Strings = {
  tabBeamline: "Strahlengang",
  tabOptimizer: "Optimierer",
  tabImport: "Import",
  tabFit: "Strahl-Fit",
  tabField: "Feld",
  tabAnalyzer: "Bildanalyse",
  importJson: "JSON importieren",
  exportJson: "JSON exportieren",
  preset: "VORLAGE",
  beam: "STRAHL",
  gaussian: "Gauß",
  elliptical: "Elliptisch",
  moment: "Moment",
  wavelength: "WELLENLÄNGE",
  power: "LEISTUNG",
  waistW0: "TAILLE w0",
  waistPos: "TAILLENPOS. z0",
  xAxis: "X-ACHSE",
  yAxis: "Y-ACHSE",
  momentNote: "Zweite-Momente-Strahl: D4σ-Durchmesser an der Taille + M² je Achse.",
  modeHelper: "MODEN → M²-HELFER",
  applyM2: "Als Strahl-M² übernehmen",
  modeNote: "Ideale HG/LG-Modenordnung setzt das Envelope-M². Fuer ECHTE Moden-Felder im Feld-Tab die FELD-QUELLE auf HG/LG stellen.",
  invalidOrder: "ungültige Ordnung",
  pulse: "PULS",
  ePulse: "E / Puls",
  pRate: "P̄ + Rate",
  pulseEnergy: "PULSENERGIE",
  avgPower: "MITTL. LEISTUNG",
  repRate: "REP-RATE",
  durFwhm: "DAUER FWHM",
  shape: "FORM",
  rect: "Rechteck",
  widthBasis: "BREITEN-ANZEIGEBASIS",
  b1e2: "1/e²-Radius w",
  bFwhm: "FWHM-Durchmesser",
  bD4: "D4σ-Durchmesser",
  bRms: "rms-Radius",
  basisNote: "Wirkt auf die Ergebnistabellen. Der Plot bleibt im 1/e²-Radius.",
  designNote: "Design-Prototyp — jeder Wert stammt aus dem Headless-Core-Ergebnis. Die UI rechnet keine Physik.",
  plotTitle: "STRAHL-ENVELOPE — 1/e²-RADIUS über z",
  simFailed: "Eingabe vom Core-Validator abgelehnt",
  simFailedSub: "Die genauen Fehler stehen im Warnungen-Panel.",
  beamlineTitle: "STRAHLENGANG",
  compsWord: "Komponenten",
  addFree: "+ FREISTRECKE",
  addThin: "+ DÜNNE LINSE",
  addThick: "+ DICKE LINSE",
  addCyl: "+ ZYL. LINSE",
  addSlab: "+ PLATTE",
  addAperture: "+ BLENDE",
  source: "QUELLE",
  duplicate: "Duplizieren",
  del: "Löschen",
  positionZ: "POSITION z mm",
  lengthMm: "LÄNGE mm",
  focalMm: "BRENNWEITE mm",
  axis: "AKTIVE ACHSE",
  thickness: "DICKE mm",
  refIndex: "BRECHZAHL n",
  kindFree: "FREISTRECKE",
  kindThin: "DÜNNE LINSE",
  kindCyl: "ZYLINDERLINSE",
  kindSlab: "PLATTE / FENSTER",
  kindThick: "DICKE SPHÄR. LINSE",
  kindAperture: "BLENDE / IRIS",
  outputWaist: "AUSGANGS-TAILLE",
  zWaist: "z Taille",
  thetaHalf: "θ halb",
  pulseExit: "PULS — AN DER AUSTRITTSEBENE",
  rPulseEnergy: "Pulsenergie",
  peakPower: "Spitzenleistung",
  peakFluence: "Spitzenfluenz",
  peakIntensity: "Spitzenintensität",
  pulseNote: "Räumlicher Gauß-Peak an der Endebene",
  shapeNoteGauss: "Gauß-Formfaktor",
  shapeNoteSech: "sech²-Formfaktor",
  shapeNoteRect: "Rechteck-Formfaktor",
  warnings: "WARNUNGEN",
  components: "KOMPONENTEN",
  apMargin: "Apertur-Reserve",
  fastNote: "Fast Mode — paraxiale ABCD-Rechnung. Dicke Linsen und Flächenstapel paraxial; Aberrationen werden nicht modelliert.",
  projectJson: "Projekt-JSON",
  export: "Export",
  import: "Import",
  copyBtn: "In die Zwischenablage",
  copiedBtn: "Kopiert ✓",
  download: ".modeforge.json herunterladen",
  validateLoad: "Validieren & Projekt laden",
  pastePlaceholder: "ModeForgeProject-JSON einfügen…",
  presetFocus: "Dicklinsen-Fokus",
  presetFocusDesc: "1064 nm · gepulst · Fluenz im Fokus",
  presetTele: "Zweilinsen-Teleskop",
  presetTeleDesc: "780 nm · 2×-Aufweiter · Clipping-Check",
  presetAstig: "Astigmatische Diode",
  presetAstigDesc: "405 nm · x/y getrennt · Zylinderlinse",
  optTitle: "ZWEILINSEN-TELESKOP-OPTIMIERER",
  optIntro: "Nutzt den aktuellen Projektstrahl. Gittersuche über Linsenpaare und Positionen, sortiert nach Ziel-Abweichung.",
  lensCandidates: "LINSEN-KANDIDATEN",
  addLens: "+ LINSE",
  searchGrid: "POSITIONS-SUCHGITTER",
  candWord: "Kandidaten-Layouts",
  target: "ZIEL",
  targetPlane: "ZIELEBENE z mm",
  radiusAtTarget: "RADIUS @ ZIEL mm",
  targetWaistR: "TAILLENRADIUS mm",
  targetWaistZ: "TAILLENPOS. z mm",
  targetNote: "Leer = ungenutzt. Mindestens ein Ziel ist nötig; den Rest erzwingt der Core-Validator.",
  constraints: "RANDBEDINGUNGEN",
  minSep: "MIN. ABSTAND mm",
  apMarginMin: "AP-RESERVE ≥",
  maxResults: "MAX. ERGEBNISSE",
  sensitivity: "SENSITIVITÄTSANALYSE",
  sensShift: "± VERSATZ mm",
  sensF: "± f mm",
  sensM2: "± M²",
  optPulseLabel: "Puls-Randbedingungen einbeziehen (nutzt das Puls-Panel)",
  runOpt: "Optimierer starten",
  searching: "Suche…",
  thRank: "RANG",
  thLayout: "LAYOUT",
  thRadius: "RADIUS @ ZIEL",
  thMismatch: "ABWEICHUNG",
  thWaist: "TAILLE",
  thSens: "SENS ΔR",
  sendToBeamline: "In den Strahlengang →",
  optEmptyText: "Keine Lösung erfüllt die Randbedingungen — Gitter erweitern oder Apertur-Reserve lockern.",
  optFootnote:
    "Gittersuche über Dünnlinsen-Paare · sortiert nach relativer Abweichung · Sensitivität rechnet den Core mit verschobenen Parametern erneut.",
  targetWord: "Ziel",
  achievedWord: "erreicht",
  atZWord: "bei z",
  sensWord: "Sensitivität",
  shiftWord: "Versatz",
  notRequested: "Sensitivität: nicht angefordert",
  zmxTitle: "ZMX-SEQUENZ-VERSCHREIBUNG",
  sampleSinglet: "BEISPIEL: SINGLETT",
  sampleUnknown: "BEISPIEL: UNBEK. GLAS",
  lambdaForN: "λ FÜR n",
  parseRx: "Verschreibung parsen",
  importBlocked: "IMPORT BLOCKIERT — UNAUFGELÖSTE MATERIALIEN",
  importBlockedNote:
    "Rechts einen AGF-Katalog laden, der diese Gläser definiert, in den Resolver übernehmen und erneut parsen. Keine stillen Ersatz-Brechzahlen.",
  surfaceStack: "FLÄCHENSTAPEL",
  addToBeamline: "In den Strahlengang →",
  thSurfR: "R mm",
  thSurfT: "t DANACH mm",
  thSurfMat: "MATERIAL",
  thSurfAp: "AP mm",
  agfTitle: "AGF-GLASKATALOG",
  sampleCatalog: "BEISPIELKATALOG",
  parseCatalog: "Katalog parsen",
  materials: "MATERIALIEN",
  adopt: "Im Material-Resolver verwenden",
  resolverActive: "Resolver aktiv",
  sessionWord: (n) => `${n} Sitzungs-Material${n === 1 ? "" : "ien"} im Resolver aktiv`,
  importNote:
    "Materialien ohne CD-Koeffizienten importieren als konstantes n und tragen DISPERSION_UNAVAILABLE-Warnungen. Unbekannte ZMX-Gläser blockieren den Import, bis ein Katalog sie auflöst — keine stillen Brechzahl-Schätzungen.",
  fitTitle: "MESSSTRAHL-FIT",
  fitIntro: "z/Breite-Paare aus dem Strahlprofiler einfügen. Least-Squares-Fit von w²(z) liefert Taille, Position, Divergenz und M².",
  sampleCaustic: "BEISPIEL: KAUSTIK-SCAN",
  pointsWord: "Punkte geparst",
  widthColBasis: "BASIS DER BREITEN-SPALTE",
  wavelengthUm: "WELLENLÄNGE µm",
  runFit: "Strahl fitten",
  fitW0: "TAILLE w0",
  fitZ0: "TAILLENPOS. z0",
  fitTheta: "θ HALBWINKEL",
  fitRms: "RESIDUUM RMS",
  fitMaxRes: "MAX. REL. RESIDUUM",
  causticTitle: "KAUSTIK — GEMESSEN vs GEFITTET",
  measured: "gemessen",
  fitCurve: "Fit w(z)",
  useAsBeam: "Als Strahl-Eingabe →",
  fitNote: "Quadratischer Least-Squares-Fit auf w²(z) · M² unter 1 oder Residuen über 2 % erzeugen Core-Warnungen.",
  fieldTitle: "FELD-MODUS",
  fieldIntro:
    "Skalare Feldpropagation auf einem Gitter — Fresnel-Transferfunktion oder Winkelspektrum. Beugung, die Fast Mode nicht sieht.",
  useProjectBeam: "← PROJEKTSTRAHL ÜBERNEHMEN",
  projectBeamWord: "Projektstrahl",
  fieldSource: "QUELLE — GAUSS AN DER TAILLE",
  gridN: "GITTER N×N",
  spacingDx: "RASTER dx mm",
  fieldWaist: "TAILLE w0 mm",
  extentWord: "Gitterausdehnung",
  extentCap: "N auf 256 begrenzt (FFT-beschleunigt)",
  hardAperture: "HARTE BLENDE VOR DER PROPAGATION",
  apertureR: "BLENDENRADIUS mm",
  propagation: "PROPAGATION",
  distance: "DISTANZ mm",
  method: "METHODE",
  angularSpectrum: "Winkelspektrum",
  runField: "Feld-Job starten",
  propagating: "Propagiere…",
  fieldJobNote:
    "Startet den Headless-field-fresnel-Job: Leistung vorher/nachher, Zweite-Momente-Radien, Sampling-Warnungen. Volle Feldpropagation durch den Strahlengang kommt mit der Field-Mode-UI-Stufe.",
  powerIn: "LEISTUNG EIN",
  powerOut: "LEISTUNG AUS",
  crossCheck: "KREUZCHECK — FELD vs FAST MODE BEI z = d",
  analyticNoteAp:
    "Harte Blende aktiv — Beugung zieht das Feld erwartungsgemäß von der paraxialen Envelope weg. Genau diese Abweichung zeigt der Feld-Modus.",
  analyticNoteOk: "Stimmt innerhalb von 2 % mit der Fast-Mode-Envelope überein — das Sampling reicht für diese Distanz.",
  analyticNoteBad:
    "Über 2 % Abweichung ohne Blende heißt meist: Gitter zu grob — N erhöhen oder „Projektstrahl übernehmen“ wählt dx automatisch.",
  inputPlane: "|E|² — EINGANGSEBENE (z = 0)",
  outputPlane: "|E|² — AUSGANGSEBENE (z = d)",
  dftNote: "Unitäre DFT — Leistung bleibt bei freier Propagation erhalten; Verluste nur durch harte Blenden. Farbskala wurzel-skaliert.",
  fieldVsWord: "Feld",
  vsParaxialWord: "vs paraxial",
  scalarBadge: "SKALAR · S11",
  zmxPlaceholder: ".zmx-Sequenzdatei einfügen… (SURF / RADIUS / CURV / DISZ / GLAS / DIAM)",
  agfPlaceholder: ".agf-Katalog einfügen… (NM- + CD-Zeilen)",
  modeBeamline: "Projekt-Strahlengang",
  modeSource: "Quell-Playground",
  probeZ: "AUSWERTE-EBENE z mm",
  planesQuick: "EBENEN",
  autoDx: "AUTO dx",
  probePlane: "|E|² — AUSWERTE-EBENE",
  powerAtZ: "LEISTUNG @ z",
  beamlineIntro:
    "Propagiert das skalare Feld durch den aktuellen Strahlengang — Linsen als paraxiale Phasenmasken, harte Blenden inklusive — und liest es an einer beliebigen z-Ebene aus.",
  beamlineNote:
    "Ebenen innerhalb von Glas nutzen den reduzierten optischen Weg t/n. Eine Ebene exakt an Linse oder Blende misst direkt hinter dem Element. Ebenen hinter der letzten Komponente laufen in Freiraum weiter.",
  crossCheckAtZ: "KREUZCHECK — FELD vs FAST MODE BEI z",
  segmentWord: "Segment",
  analyticNoteSampling:
    "SAMPLING-GRENZE - das Gitter kann dieses Ergebnis nicht aufloesen (siehe Warnungen unten): Die Abweichung ist ein Gitter-Artefakt, keine Physik. Dem Feldbild nahe dem Fokus nicht vertrauen.",
  surfacePhase: "FLÄCHEN-PHASE",
  spIdeal: "Ideal (paraxial)",
  spSag: "Echte Flächen (TEA)",
  sagNote:
    "Echte Flächen prägt die exakte sphärische Flächenphase jeder Dicklinse und jedes Flächenstapels auf (Thin-Element-Näherung): sag-getriebene sphärische Aberration wird sichtbar. Einfallswinkel-Aberrationen werden nicht modelliert — Sampling-Warnungen beachten.",
  surfWord: "Fl.",
  loadFile: "DATEI LADEN",
  fieldSourceMode: "FELD-QUELLE",
  modeFundamental: "Gauß",
  imgUpload: "UPLOAD — BILDDATEI",
  imgDropHint: ".tif / .tiff / .png hier ablegen (max. 128 MB)",
  imgPickFile: "Datei wählen",
  imgPage: "SEITE",
  imgChannel: "KANAL",
  imgCalibration: "KALIBRIERUNG",
  imgCalX: "µm / px X",
  imgCalY: "µm / px Y",
  imgBackground: "UNTERGRUND",
  imgBgNone: "Keiner",
  imgAuto: "Auto",
  imgAutoMode: "Automodus",
  imgBgManualOffset: "Manueller Offset",
  imgBgOffsetCounts: "OFFSET Zählwerte",
  imgRoi: "ROI",
  imgRoiFull: "Gesamtes Bild",
  imgRoiRect: "Rechteck",
  imgRoiAuto: "Auto",
  imgRoiNote: "Neues Rechteck auf dem Bild ziehen, im blauen Kasten verschieben, am Rand oder an einer Ecke die Größe ändern, Pixelkoordinaten eintippen oder einen Vorschlag übernehmen. Gesamtes Bild verwendet alle Pixel. „Analyse starten“ bestätigt die ROI.",
  imgRoiOutOfRange: "ROI-Rechteck liegt außerhalb des Bildes — bitte korrigieren.",
  imgRoiClamped: "ROI-Rechteck wurde auf das Bild beschnitten.",
  imgRoiFromFit: "ROI aus Fit ableiten",
  imgRun: "Analyse starten",
  imgBusy: "Läuft…",
  imgDecoding: "Dekodiere…",
  imgSuppressed: "unterdrückt",
  imgPhysical: "physikalisch",
  imgPhysicalD4: "physikalisches D4sigma",
  imgKeyResults: "KERNWERTE",
  imgRawRender: "ROH-DARSTELLUNG",
  imgNoData: "Bild laden und Analyse starten. Das Ergebnis erscheint hier.",
  imgExportJson: "JSON exportieren",
  imgExportCsv: "CSV exportieren",
  imgExportPng: "PNG exportieren",
  imgDiagnostics: "DIAGNOSE",
  imgRawStats: "ROH-STATISTIK",
  imgWarnings: "WARNUNGEN",
  imgBackgroundNoise: "UNTERGRUND / RAUSCHEN",
  imgSigmaB: "sigma_B Zählwerte",
  imgScaleSource: "Skalenquelle",
  imgMedian: "Median",
  imgMean: "Mittelwert",
  imgStd: "Std",
  imgMad: "MAD",
  imgIqr: "IQR",
  imgFloorApplied: "Boden angewandt",
  imgRoiStability: "ROI / STABILITÄT",
  imgValidVariants: "gültige Varianten",
  imgUndeterminable: "nicht bestimmbar",
  imgHalfSpread: "D4sigma HALBE SPANNWEITE",
  imgMomentsProfiles: "MOMENTE / PROFILE",
  imgStageB: "FREIGEGEBEN (Stufe B)",
  imgD4Sigma: "D4sigma (Ellipse)",
  imgCentroid: "Schwerpunkt",
  imgTheta: "Theta",
  imgEllipticity: "Elliptizität",
  imgEllipticityPhysical: "Elliptizität (physikalisch)",
  imgFitWidth: "Fit-Breite 4sigma",
  imgStageA: "ROI-MOMENTE (Stufe A)",
  imgProfilesCut: "SCHNITTPROFILE",
  imgFitsResiduals: "FITS / RESIDUEN",
  imgFitStatus: "FIT-STATUS",
  imgResidualRms: "Residuum RMS",
  imgResidualMax: "Residuum max. abs.",
  imgResidualSigma: "Residuen-Sigma",
  imgResidualNrmse: "NRMSE",
  imgResidualRmsSigma: "RMS / sigma_B",
  imgResidualMode: "Residuen-Normierung",
  imgResidualModeCounts: "Zählwerte",
  imgResidualModePercentPeak: "% Peak",
  imgResidualModeSigma: "sigma_B",
  imgResidualModePercentPeakUnavailable: "% Peak erfordert eine endliche, positive angepasste Gauß-Amplitude.",
  imgResidualModeSigmaNoSigma: "Die sigma_B-Normierung erfordert sigma_B > 0.",
  imgResidualModeSigmaZero: "Die sigma_B-Normierung ist bei Skalenquelle Null nicht verfügbar.",
  imgResidualModeSigmaFloor: "Die sigma_B-Normierung ist bei angewandtem Rauschboden nicht verfügbar.",
  imgResidualBlockHint:
    "Kartenfelder sind Blockmittelwerte. Für b > 1 ist |R/sigma_B| ungefähr 1 nur eine Rauschniveau-Näherung; Randblöcke und korrelierte Residuen können abweichen.",
  imgResidualScale: "gemeinsame Residuenskala S",
  imgResidualMaxAbs: "max |R|",
  imgResidualMaxDisplayBlocks: "max |R| (Anzeigeblöcke)",
  imgResidualManualScale: "manuelles S",
  imgResidualAutoScale: "automatisch",
  imgResidualGaussMap: "Gauß-Residuum",
  imgResidualSuperMap: "Super-Gauß-Residuum",
  imgResidualSuperUnavailable: "Super-Gauß-Residuenansichten erfordern einen konvergierten Fit.",
  imgResidualHistogram: "RESIDUEN-HISTOGRAMM",
  imgHistogramUnderflow: "Unterlauf",
  imgHistogramOverflow: "Überlauf",
  imgSkewness: "Schiefe",
  imgExcessKurtosis: "Exzess-Kurtosis",
  imgFiniteCount: "Anzahl endlicher Werte",
  imgFullResRoi: "volle Auflösung, endliche ROI-Pixel",
  imgModelComparison: "MODELLVERGLEICH",
  imgGaussianDescription: "n nahe 1: Der Gauß beschreibt den Strahl.",
  imgFlatTopDescription: "n deutlich über 1: Flat-Top-Charakter.",
  imgExponentBoundaryDescription: "n liegt an seiner Fit-Grenze; keine Deutung wird gezeigt.",
  imgExponentNoInterpretation: "n liegt zwischen den Deutungsbereichen; keine Deutung wird gezeigt.",
  imgQualityBox: "QUALITÄT / VERTRAUEN",
  imgQualityStability: "ROI-Stabilität",
  imgGeometryReleasable: "Fit-Geometrie freigabefähig",
  imgMomentSuppression: "Momentenfreigabe",
  imgWidthFwhm: "FWHM-Breite",
  imgWidth1e2: "1/e²-Breite",
  imgYes: "ja",
  imgNo: "nein",
  imgPass: "bestanden",
  imgFail: "nicht bestanden",
  imgPeakToBackground: "Peak / sigma_B",
  imgSize: "Größe",
  imgDtype: "Datentyp",
  imgMin: "min",
  imgMax: "max",
  imgDynamicRange: "Dynamik",
  imgSaturated: "gesättigt",
  imgClippingSuspect: "Clipping-Verdacht",
  imgHotPixels: "Hot-Pixel-Kandidaten",
  imgZeros: "Nullen",
  imgNegatives: "Negative",
  imgNonFinite: "nicht endlich",
  imgEdgeTouch: "Randberührung",
  imgLocalMaxima: "lokale Maxima",
  imgHistogram: "HISTOGRAMM",
  imgFitParams: "GAUSS-2D-PARAMETER",
  imgAmplitude: "Amplitude",
  imgFitBackground: "Fit-Untergrund",
  imgSigmaMajor: "Sigma (große Achse)",
  imgSigmaMinor: "Sigma (kleine Achse)",
  imgSuperGaussN: "Super-Gauss n",
  imgIterations: "Iterationen",
  imgCutX: "Schnitt X",
  imgCutY: "Schnitt Y",
  imgProjX: "Projektion X",
  imgProjY: "Projektion Y",
  imgAxisMajor: "lange Achse",
  imgAxisMinor: "kurze Achse",
  imgMajor: "große Achse",
  imgMinor: "kleine Achse",
  imgLongAxis: "lange Achse",
  imgShortAxis: "kurze Achse",
  imgResidualMap: "RESIDUENKARTE",
  imgAperture: "FREIGABE-GATES",
  imgGateFit: "Fit konvergiert",
  imgGateAmplitude: "Amplitude positiv",
  imgGateResidual: "Residuum",
  imgGateClip: "Prüfellipse im ROI",
  imgGateAlpha: "Alpha-Konsistenz",
  imgGateMultiPeak: "einzelner Peak",
  imgPedestal: "Sockel-Hinweis",
  imgAbsorbedPower: "absorbierte-Leistung-Flag",
  imgAlphaUsed: "verwendetes Alpha",
  imgWidthScatter: "Breitenstreuung",
  imgPartialSweep: "unvollständiger Sweep",
  imgFullFrame: "gesamtes Bild",
  imgClamped: "geklemmt",
  imgRoiSource: "ROI-Quelle",
  imgRoiSourceInput: "Rechteck",
  imgRoiSourceFull: "gesamtes Bild",
  imgRoiSourceAuto: "automatisch",
  imgDisplayNote:
    "Nur Darstellung: linearer Kontrast der sichtbaren Pixel und Ausschnitt eines kompakten Spots. Keine kalibrierte Intensitätsskala. Eine 4sigma-Ellipse umschließt etwa 86 Prozent der Leistung eines Gauß-Strahls; die Kontrastspreizung macht die schwächeren Flügel trotzdem sichtbar. Die gestrichelte orange Linie ist die Fit-Ellipse, nicht die ROI.",
  imgSpotCloseup: "Spot-Ausschnitt",
  imgViewFull: "gesamtes Bild",
  imgViewForcedBgDraw: "Beim Zeichnen von Hintergrund-Rechtecken ist das gesamte Bild erforderlich.",
  imgColorMap: "Farbdarstellung",
  imgColorMapGray: "Graustufen",
  imgColorMapTurbo: "Turbo",
  imgColorMapViridis: "Viridis",
  imgCountsUnit: "Zählwerte",
  imgLegendFit: "Fit-4sigma-Ellipse",
  imgLegendRoi: "ROI-Rechteck",
  imgRoiFullFrameNote: "ROI = gesamtes Bild",
  imgLegendSuggestion: "ROI-Vorschlag",
  imgRoiOutsideCrop: "ROI liegt außerhalb dieses Ausschnitts — auf gesamtes Bild umschalten, um sie zu sehen.",
  imgEllipsePowerNote: "4sigma-Ellipse: etwa 86 Prozent der Gauß-Leistung; Anzeige zeigt schwächere Flügel.",
  imgCloseupRoiNote:
    "Dieser Ausschnitt ist etwa das Dreifache des D4sigma-Durchmessers. Auf gesamtes Bild umschalten, um das blaue ROI-Rechteck zu sehen. Die orange gestrichelte Ellipse ist der Fit, kein Beschnitt des Strahls.",
  imgCloseupFallbackNote:
    "Dieser Ausschnitt ist ein Fenster von etwa 0,6 der kürzeren Bildseite (mindestens 96 px), nicht das Dreifache des D4sigma-Durchmessers. Auf gesamtes Bild umschalten, um das blaue ROI-Rechteck zu sehen. Die orange gestrichelte Ellipse ist der Fit, kein Beschnitt des Strahls.",
  imgCloseupFixedNote:
    "Dieser Ausschnitt ist ein 96-px-Fenster um den Spot, nicht das Dreifache des D4sigma-Durchmessers. Auf gesamtes Bild umschalten, um das blaue ROI-Rechteck zu sehen. Die orange gestrichelte Ellipse ist der Fit, kein Beschnitt des Strahls.",
  imgAnisoPxNote: "anisotrope Pixel nicht direkt umrechenbar",
  imgSigmaBUnmeasurable: "sigma_B nicht messbar",
  imgPhysicalFromFit: "aus dem Fit (Stufe B unterdrückt)",
  imgUngatedHint: "Richtwert - keine eigene Freigabe",
  imgUngatedInfo:
    "Nur D4sigma durchlaeuft die Freigabepruefungen. Die 1/e2- und FWHM-Werte sind Breiten aus Profilschnitten, die Fit-4-sigma-Breite ist eine Modellbreite. Wenn D4sigma unterdrueckt ist, beruhen diese Werte auf dem nicht freigegebenen Fit und dienen nur der Orientierung. Die D4sigma-Freigabepruefungen umfassen Fit-Konvergenz, nicht-positive Amplitude, Residuenobergrenze, das Ellipse/ROI-Clipping-Gate, Alpha-Konsistenz, Mehrfach-Peak und Abdeckung.",
  imgResidualRoiLabel: (width, height) => `RESIDUENKARTE — ROI ${width}×${height} px`,
  imgResidualWindowLabel: (width, height) => `RESIDUENKARTE — ${width}×${height} px`,
  imgWarningTitle: (code) => IMAGE_WARNING_TITLE_DE[code] ?? code,
  warningDescription: (code, fallback) => WARNING_DESCRIPTION_DE[code as SimulationWarningCode] ?? fallback,
  imgValid: "gültig",
  imgPeak: "Peak",
  imgEncircled: "eingeschlossene Leistungsradien",
  imgModelCompare: "Modell-RMS-Reduktion",
  imgSampleCount: "Stichproben",
  imgScaleMad: "MAD",
  imgScaleIqr: "IQR",
  imgScaleFloor: "Boden",
  imgScaleZero: "Null",
  imgReasonFitNotConverged: "Fit nicht konvergiert",
  imgReasonNonpositiveAmplitude: "nicht-positive Amplitude",
  imgReasonResidualHigh: "Residuum zu hoch",
  imgReasonApertureClipped: "Ellipse durch das ROI beschnitten",
  imgReasonCoverageInsufficient: "Blende teilweise ohne Daten",
  imgReasonAlphaInconsistent: "Alpha-Konsistenz-Gate",
  imgReasonMultiPeak: "mehrere Peaks",
  imgStatusConverged: "konvergiert",
  imgStatusMaxIterations: "Iterationslimit",
  imgStatusTimeBudget: "Zeitbudget überschritten",
  imgStatusSingular: "singuläre Normalgleichungen",
  imgStatusInvalidStart: "ungültiger Start",
  imgWidthLowSignal: "schwaches Signal",
  imgWidthNonpositivePeak: "nicht-positiver Peak",
  imgWidthGap: "Lücke im Profil",
  imgMomentNonfinite: "nicht-endliche Summe",
  imgMomentNonpositiveSum: "nicht-positive Summe",
  imgMomentBackgroundDominated: "untergrunddominiert",
  imgMomentIndefinite: "indefinite Kovarianz",
  imgMomentZeroCovariance: "Null-Kovarianz",
  imgAmbiguous: "mehrdeutig",
  imgGauss2d: "Gauss 2D",
  imgSuperGauss2d: "Super-Gauss 2D",
  imgBgDarkFrame: "Dunkelbild",
  imgBgRectMedian: "Rechteck-Median",
  imgBgRobustPlane: "Robuste Ebene",
  imgRectAdd: "Rechteck hinzufügen",
  imgRectRemove: "Entfernen",
  imgRectCorners: "Ecken-Vorlage",
  imgRectEditor: "RECHTECKE",
  imgRectHint: "Rechtecke auf leeren Hintergrund legen, nicht auf den Strahl. Die Ecken-Vorlage füllt vier Randfelder.",
  imgRectX0: "x0",
  imgRectY0: "y0",
  imgRectW: "w",
  imgRectH: "h",
  imgBgPickDark: "Dunkelbild wählen",
  imgBgDarkLoaded: (name, width, height, dtype) => `Geladen: ${name} · ${width}×${height} · ${dtype}`,
  imgSuggestedRoi: "ROI-Vorschlag",
  imgApplySuggestion: "Vorschlag übernehmen",
  imgSuggestionClamped: "An den Bildrand angepasst.",
  imgSuggestionNoiseDominated:
    "Rauschdominiert: Die Maske bedeckt einen großen Teil des Bildes unter einer nicht gemessenen Rauschskala — vor Übernahme prüfen.",
  imgSettingsReset: "Analyse-Einstellungen wurden für das neue Bild zurückgesetzt (Anzeige-Einstellungen bleiben).",
  imgSettingsAdjusted: "Einstellungen wurden an die neue Bildgröße angepasst.",
  imgSettingsDarkDtypeChanged: "Das Dunkelbild wurde entfernt, weil sich der Bilddatentyp geändert hat.",
  imgBgAutoRobustPlane: "Automatischer Untergrund: robuste Ebene über Eckreferenzen.",
  imgBgAutoNone: "Automatischer Untergrund: keine Untergrundkorrektur wurde angewendet.",
  imgAutoRoi: (x0, y0, width, height) => `Automatische ROI: ${x0},${y0},${width} × ${height}`,
  imgAutoRoiNoSuggestion: "Automatische ROI: kein Vorschlag — gesamtes Bild wurde analysiert.",
  imgSymmetry: "SYMMETRIE",
  imgRotationAsymmetry: "Rotationsasymmetrie",
  imgAxialAsymmetryX: "axiale Asymmetrie X",
  imgAxialAsymmetryY: "axiale Asymmetrie Y",
  imgAlphaThreshold: "Alpha-Schwelle",
  imgMcRealizationCount: "MC-Realisierungen",
  imgMultiPeakThreshold: "Mehrfachpeak-Schwelle",
  imgProfilePlot: "PROFILSCHNITT",
  imgProfileMeasured: "gemessen",
  imgProfileGaussModel: "Gauss-Fit-Modell",
  imgProfileSuperModel: "Super-Gauss-Fit-Modell",
  imgProfileFwhmMark: "FWHM-Durchgänge",
  imgProfileE2Mark: "1/e²-Durchgänge",
  imgProfilePositionPx: "Position — px",
  imgProfilePositionUm: "Position — µm",
  imgProfileIntensity: "Intensität — Counts",
  imgProfileExportPng: "Plot-PNG",
  imgProfileResidualLane: "RESIDUENSPUR",
  imgProfileResidualIntensity: "Residuum — Zählwerte",
  imgProfileMissing: "Dieses Profil wurde für den aktuellen Lauf nicht freigegeben.",
  imgProfileNoModel: "Keine Modellkurve gezeichnet: Der Fit hat für diese Linie keine Parameter geliefert.",
  imgProfileProjectionNote:
    "Eine Projektion ist eine Summe über die ROI, deshalb ist die Modellkurve die analytische Randverteilung des angepassten 2D-Gauss (Sigma aus der Kovarianz) plus dem aufsummierten Untergrund.",
  imgProfileAxisNote: "Die Position ist der vorzeichenbehaftete Abstand vom Profilzentrum entlang der Profilrichtung.",
  imgSuggestionCalloutTighter: "Dieser Lauf schlägt ein engeres ROI vor — übernehmen und neu analysieren.",
  imgSuggestionCalloutWider: "Dieser Lauf schlägt ein weiteres ROI vor — übernehmen und neu analysieren.",
  imgSuggestionCalloutShifted: "Dieser Lauf schlägt ein anders platziertes ROI vor — übernehmen und neu analysieren.",
  imgSuggestionCalloutNumbers: (width, height, x0, y0, analyzedWidth, analyzedHeight, areaPercent) =>
    `Vorschlag ${width}×${height} px bei x0 ${x0}, y0 ${y0} · Fläche ${areaPercent} gegenüber dem analysierten ${analyzedWidth}×${analyzedHeight} px.`,
  imgSuggestionCalloutWhy:
    "Der Vorschlag ist iterativ — jeder Lauf berechnet ihn aus dem korrigierten Bild und der Rauschskala dieses Laufs neu; nach einer übernommenen Änderung kann er sich weiter verfeinern.",
  imgApplySuggestionRun: "Übernehmen und neu analysieren",
  imgRoiFitNotNarrowed: "Profil ist nicht gaußförmig — das ROI wird nicht weiter verengt.",
  imgDrawTargetRoi: "Mess-ROI",
  imgDrawTargetBgRect: "Hintergrund-Rechteck",
  imgLegendBgRect: "Hintergrund-Rechteck",
  imgBgDarkDimMismatch: (darkWidth, darkHeight, imageWidth, imageHeight) =>
    `Die Maße des Dunkelbildes ${darkWidth}×${darkHeight} passen nicht zu den Bildmaßen ${imageWidth}×${imageHeight}.`,
  imgBgDarkDecodeFailed: "Die Dunkelbild-Datei konnte nicht gelesen werden.",
  imgBgDarkDtypeMismatch: (darkDtype, imageDtype) =>
    `Der Datentyp des Dunkelbildes ${darkDtype} passt nicht zum Bilddatentyp ${imageDtype}.`,
};

export function strings(lang: Lang): Strings {
  return lang === "de" ? de : en;
}

export function loadLang(): Lang {
  try {
    return localStorage.getItem("modeforge-lang") === "de" ? "de" : "en";
  } catch {
    return "en";
  }
}

export function saveLang(lang: Lang): void {
  try {
    localStorage.setItem("modeforge-lang", lang);
  } catch {
    /* ignore */
  }
}
