// Workbench UI strings, transcribed verbatim from the Claude Design source.

export type Lang = "en" | "de";

export type Strings = {
  tabBeamline: string;
  tabOptimizer: string;
  tabImport: string;
  tabFit: string;
  tabField: string;
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
};

const en: Strings = {
  tabBeamline: "Beamline",
  tabOptimizer: "Optimizer",
  tabImport: "Import",
  tabFit: "Beam fit",
  tabField: "Field",
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
};

const de: Strings = {
  tabBeamline: "Strahlengang",
  tabOptimizer: "Optimierer",
  tabImport: "Import",
  tabFit: "Strahl-Fit",
  tabField: "Feld",
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
