// ModeForge landing page — production port of the "ModeForge Index" design.
// Static marketing content only; no physics, no external requests.

import { loadLang, saveLang, type Lang } from "./i18n.ts";
import "./base.css";
import "./landing.css";

type LandingStrings = {
  openWorkbench: string;
  heroBadge: string;
  heroTitle1: string;
  heroTitle2: string;
  heroSub: string;
  ctaLaunch: string;
  ctaPhysics: string;
  heroNote: string;
  heroPlotLabel: string;
  featuresTitle: string;
  principlesTitle: string;
  docs: string;
  guide: string;
  support: string;
  impressum: string;
  privacy: string;
  validation: string;
  footTagline: string;
  footToolsTitle: string;
  footResourcesTitle: string;
  footStatusTitle: string;
  footDate: string;
  footDisclaimer: string;
  footTools: Array<{ k: string; v: string }>;
  features: Array<{ tag: string; title: string; desc: string }>;
  principles: Array<{ n: string; title: string; desc: string }>;
};

const de: LandingStrings = {
  openWorkbench: "Workbench öffnen",
  heroBadge: "LÄUFT KOMPLETT IM BROWSER",
  heroTitle1: "Laser-Strahlengänge entwerfen —",
  heroTitle2: "mit ehrlicher Physik.",
  heroSub:
    "ModeForge propagiert reale Laserstrahlen — Gauß, elliptisch/astigmatisch oder als gemessener M²-Strahl — durch Linsen, Fenster und Blenden. Dazu Puls-Fluenz, Beugung im Feld-Modus und Warnungen, die nichts beschönigen. Kostenlos, quelloffen, ohne Installation.",
  ctaLaunch: "Workbench starten",
  ctaPhysics: "Wie es rechnet",
  heroNote: "Keine Anmeldung · keine Server-Berechnung · Projekte als JSON-Dateien",
  heroPlotLabel: "ZWEILINSEN-TELESKOP · LIVE",
  featuresTitle: "WERKZEUGE",
  principlesTitle: "PHYSIK-PRINZIPIEN",
  docs: "Doku",
  guide: "Anleitung",
  support: "Unterstützen ☕",
  impressum: "Impressum",
  privacy: "Datenschutz",
  validation: "Validierung",
  footTagline: "Open-Source-Laser-Beamline-Designer",
  footToolsTitle: "Werkzeuge",
  footResourcesTitle: "Ressourcen",
  footStatusTitle: "Stand",
  footDate: "Juli 2026",
  footDisclaimer: "Paraxiale Näherung — kein Ersatz für volle Wellenoptik oder ein Sicherheitsgutachten.",
  footTools: [
    { k: "FAST", v: "paraxiale ABCD-Envelope" },
    { k: "OPT", v: "Zweilinsen-Optimierer" },
    { k: "IMP", v: "ZMX/AGF-Import" },
    { k: "FIT", v: "Messstrahl-Fit (M²)" },
    { k: "FLD", v: "skalare Feldpropagation" },
  ],
  features: [
    { tag: "FAST MODE", title: "Paraxiale ABCD-Propagation", desc: "Envelope-Plot über z mit Taillen, Rayleigh-Längen und Divergenz — für Gauß-, elliptische und Momenten-Strahlen." },
    { tag: "PULSE", title: "Puls- & Fluenz-Rechner", desc: "Pulsenergie, Spitzenleistung, Fluenz und Intensität an jeder Ebene — Gauß, sech² oder Rechteck." },
    { tag: "OPTIMIZER", title: "Zweilinsen-Optimierer", desc: "Gittersuche über Linsenpaare mit Apertur-, Abstands- und Fluenz-Randbedingungen plus Sensitivitätsanalyse." },
    { tag: "IMPORT", title: "ZMX- & AGF-Import", desc: "Zemax-Sequenzdateien und Glaskataloge einlesen; unbekannte Gläser blockieren ehrlich statt still zu raten." },
    { tag: "FIT", title: "Messstrahl-Fit", desc: "Kaustik-Messungen einfügen, M² und Taille per Least-Squares zurückgewinnen, direkt als Strahlquelle übernehmen." },
    { tag: "FIELD", title: "Skalare Feldpropagation", desc: "Fresnel- und Winkelspektrum-Methoden zeigen Beugung an harten Blenden — mit Kreuzcheck gegen die paraxiale Envelope." },
  ],
  principles: [
    { n: "01", title: "Warnungen zuerst", desc: "Jedes Ergebnis trägt maschinenlesbare Warnungen — Apertur-Reserven, Sampling-Grenzen, Gültigkeitsbereiche. Nichts scheitert still." },
    { n: "02", title: "Gegen Referenzen validiert", desc: "Jede Formel ist gegen Lehrbuch- und Referenzfälle getestet; die Validierungssuite ist Teil des Repos." },
    { n: "03", title: "Headless-Core", desc: "UI und Physik sind strikt getrennt: derselbe Core läuft im Browser, in der CLI und im CI — identische Zahlen überall." },
    { n: "04", title: "Offene Projektdateien", desc: "Projekte sind versionierte JSON-Dateien — diff-bar, skriptbar, archivierbar. Kein Lock-in." },
  ],
};

const en: LandingStrings = {
  openWorkbench: "Open Workbench",
  heroBadge: "RUNS ENTIRELY IN YOUR BROWSER",
  heroTitle1: "Design laser beamlines —",
  heroTitle2: "with honest physics.",
  heroSub:
    "ModeForge propagates real laser beams — Gaussian, elliptical/astigmatic or measured M² beams — through lenses, windows and apertures. Plus pulse fluence, field-mode diffraction and warnings that never sugar-coat. Free, open source, nothing to install.",
  ctaLaunch: "Launch Workbench",
  ctaPhysics: "How it computes",
  heroNote: "No sign-up · no server compute · projects are plain JSON files",
  heroPlotLabel: "TWO-LENS TELESCOPE · LIVE",
  featuresTitle: "TOOLKIT",
  principlesTitle: "PHYSICS PRINCIPLES",
  docs: "Docs",
  guide: "Guide",
  support: "Support ☕",
  impressum: "Legal notice",
  privacy: "Privacy",
  validation: "Validation",
  footTagline: "Open-source laser beamline designer",
  footToolsTitle: "Toolkit",
  footResourcesTitle: "Resources",
  footStatusTitle: "Status",
  footDate: "July 2026",
  footDisclaimer: "Paraxial approximation — not a substitute for full wave optics or a safety assessment.",
  footTools: [
    { k: "FAST", v: "paraxial ABCD envelope" },
    { k: "OPT", v: "two-lens optimizer" },
    { k: "IMP", v: "ZMX/AGF import" },
    { k: "FIT", v: "measured-beam fit (M²)" },
    { k: "FLD", v: "scalar field propagation" },
  ],
  features: [
    { tag: "FAST MODE", title: "Paraxial ABCD propagation", desc: "Envelope plot along z with waists, Rayleigh ranges and divergence — for Gaussian, elliptical and moment-based beams." },
    { tag: "PULSE", title: "Pulse & fluence calculator", desc: "Pulse energy, peak power, fluence and intensity at any plane — Gaussian, sech² or rectangular shapes." },
    { tag: "OPTIMIZER", title: "Two-lens optimizer", desc: "Grid search over lens pairs with aperture, separation and fluence constraints, plus sensitivity analysis." },
    { tag: "IMPORT", title: "ZMX & AGF import", desc: "Read Zemax sequential files and glass catalogs; unknown glasses block honestly instead of guessing silently." },
    { tag: "FIT", title: "Measured-beam fit", desc: "Paste caustic scans, recover M² and waist by least squares, and adopt the fit as your beam source." },
    { tag: "FIELD", title: "Scalar field propagation", desc: "Fresnel and angular-spectrum methods reveal diffraction at hard apertures — cross-checked against the paraxial envelope." },
  ],
  principles: [
    { n: "01", title: "Warnings first", desc: "Every result carries machine-readable warnings — aperture margins, sampling limits, validity ranges. Nothing fails silently." },
    { n: "02", title: "Validated against references", desc: "Every formula is tested against textbook and reference cases; the validation suite ships with the repo." },
    { n: "03", title: "Headless core", desc: "UI and physics are strictly separated: the same core runs in the browser, the CLI and CI — identical numbers everywhere." },
    { n: "04", title: "Open project files", desc: "Projects are versioned JSON documents — diffable, scriptable, archivable. No lock-in." },
  ],
};

const appRoot = document.querySelector<HTMLDivElement>("#app");
if (!appRoot) throw new Error("ModeForge landing root is missing");
const app = appRoot;

let lang: Lang = loadLang();

function esc(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const logo = (w: number, h: number) => `
  <svg width="${w}" height="${h}" viewBox="0 0 26 18" fill="none">
    <path d="M1 3 C 10 3, 10.5 9, 13 9 C 15.5 9, 16 3, 25 3" stroke="#5CE1A0" stroke-width="1.6" fill="none"></path>
    <path d="M1 15 C 10 15, 10.5 9, 13 9 C 15.5 9, 16 15, 25 15" stroke="#5CE1A0" stroke-width="1.6" fill="none" opacity="0.55"></path>
    <circle cx="13" cy="9" r="1.8" fill="#F2B33D"></circle>
  </svg>`;

function render(): void {
  const T = lang === "de" ? de : en;
  app.innerHTML = `
  <div class="ld-page">

    <div class="ld-wrap" style="padding-top: 22px; padding-bottom: 22px; display: flex; align-items: center; gap: 14px;">
      <div style="display: flex; align-items: center; gap: 11px;">
        <div style="width: 36px; height: 36px; border-radius: 10px; background: linear-gradient(180deg, #17222E 0%, #0F151E 100%); border: 1px solid #26313F; box-shadow: inset 0 1px 0 rgba(255,255,255,0.07); display: flex; align-items: center; justify-content: center;">
          ${logo(25, 18)}
        </div>
        <div style="display: flex; align-items: baseline; gap: 8px;">
          <span style="font-weight: 700; font-size: 17px;">ModeForge</span>
          <span style="font: 500 10px 'IBM Plex Mono'; color: #8B94A3; border: 1px solid #232B37; border-radius: 4px; padding: 2px 6px; letter-spacing: 0.06em;">v1.0</span>
        </div>
      </div>
      <div style="flex: 1;"></div>
      <div style="display: flex; background: rgba(6,9,13,0.55); border: 1px solid #1B2330; border-radius: 8px; padding: 2px; gap: 2px; box-shadow: inset 0 1.5px 4px rgba(0,0,0,0.4);">
        <button data-lang="en" class="ld-lang-btn${lang === "en" ? " active" : ""}">EN</button>
        <button data-lang="de" class="ld-lang-btn${lang === "de" ? " active" : ""}">DE</button>
      </div>
      <a href="guide.html" class="ld-nav-link">${esc(T.guide)}</a>
          <a href="https://github.com/Einhornelchexe/ModeForge" target="_blank" rel="noopener noreferrer" class="ld-nav-link">GitHub</a>
      <a href="workbench.html" class="ld-cta">${esc(T.openWorkbench)}</a>
    </div>

    <div class="ld-wrap" style="padding-top: 48px; padding-bottom: 34px; display: grid; grid-template-columns: repeat(auto-fit, minmax(420px, 1fr)); gap: 44px; align-items: center;">
      <div style="display: flex; flex-direction: column; gap: 18px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font: 500 10.5px 'IBM Plex Mono'; letter-spacing: 0.1em; white-space: nowrap; color: #5CE1A0; border: 1px solid rgba(92,225,160,0.3); background: rgba(92,225,160,0.06); border-radius: 5px; padding: 4px 8px;">OPEN SOURCE · MIT</span>
          <span style="font: 500 10.5px 'IBM Plex Mono'; letter-spacing: 0.1em; white-space: nowrap; color: #8B94A3; border: 1px solid #232B37; border-radius: 5px; padding: 4px 8px;">${esc(T.heroBadge)}</span>
        </div>
        <h1 style="margin: 0; font-size: 44px; line-height: 1.12; letter-spacing: -0.02em; font-weight: 700; text-wrap: balance;">${esc(T.heroTitle1)} <span style="color: #5CE1A0;">${esc(T.heroTitle2)}</span></h1>
        <p style="margin: 0; font-size: 16.5px; line-height: 1.6; color: #A8B2C2; max-width: 46ch; text-wrap: pretty;">${esc(T.heroSub)}</p>
        <div style="display: flex; gap: 10px; margin-top: 6px; flex-wrap: wrap;">
          <a href="workbench.html" class="ld-cta big">${esc(T.ctaLaunch)}</a>
          <a href="#physics" class="ld-cta-secondary">${esc(T.ctaPhysics)}</a>
        </div>
        <div style="font: 400 11px 'IBM Plex Mono'; color: #5C6675;">${esc(T.heroNote)}</div>
      </div>

      <div style="background: radial-gradient(120% 130% at 50% 0%, #0B111A 0%, #070A0F 100%); border: 1px solid #18202C; border-radius: 14px; box-shadow: inset 0 2px 16px rgba(0,0,0,0.5), 0 24px 48px -32px rgba(0,0,0,0.9); padding: 18px;">
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px;">
          <span style="width: 6px; height: 6px; border-radius: 50%; background: #5CE1A0;"></span>
          <span style="font: 500 10px 'IBM Plex Mono'; letter-spacing: 0.1em; color: #8B94A3;">${esc(T.heroPlotLabel)}</span>
          <div style="flex: 1;"></div>
          <span style="font: 500 10px 'IBM Plex Mono'; color: #5C6675;">λ 1.064 µm · M² 1.0</span>
        </div>
        <svg viewBox="0 0 520 240" style="width: 100%; height: auto; display: block;">
          <path d="M40 20 V14 H48 M472 14 H480 V20 M40 220 V226 H48 M472 226 H480 V220" stroke="#2A3442" stroke-width="1.2" fill="none"></path>
          <line x1="40" y1="60" x2="480" y2="60" stroke="#141B26" stroke-width="1"></line>
          <line x1="40" y1="120" x2="480" y2="120" stroke="#232B37" stroke-width="1" stroke-dasharray="2 4"></line>
          <line x1="40" y1="180" x2="480" y2="180" stroke="#141B26" stroke-width="1"></line>
          <line x1="150" y1="14" x2="150" y2="226" stroke="#232B37" stroke-width="1" stroke-dasharray="3 3"></line>
          <line x1="330" y1="14" x2="330" y2="226" stroke="#232B37" stroke-width="1" stroke-dasharray="3 3"></line>
          <path d="M40 70 C 120 70, 140 96, 150 96 C 220 96, 300 30, 330 30 C 380 30, 450 108, 480 114 M40 170 C 120 170, 140 144, 150 144 C 220 144, 300 210, 330 210 C 380 210, 450 132, 480 126" stroke="#5CE1A0" stroke-width="5" fill="none" opacity="0.12"></path>
          <path d="M40 70 C 120 70, 140 96, 150 96 C 220 96, 300 30, 330 30 C 380 30, 450 108, 480 114 M40 170 C 120 170, 140 144, 150 144 C 220 144, 300 210, 330 210 C 380 210, 450 132, 480 126" stroke="#5CE1A0" stroke-width="1.7" fill="none" stroke-dasharray="40 6" style="animation: mfBeamDrift 2.6s linear infinite;"></path>
          <path d="M145 70 Q 136 120 145 170 L 155 170 Q 164 120 155 70 Z" fill="rgba(140,180,235,0.1)" stroke="#8FB4E3" stroke-width="1.2"></path>
          <path d="M323 40 Q 315 120 323 200 L 337 200 Q 345 120 337 40 Z" fill="rgba(140,180,235,0.1)" stroke="#8FB4E3" stroke-width="1.2"></path>
          <circle cx="437" cy="120" r="2.6" fill="#F2B33D"></circle>
          <text x="437" y="106" fill="#F2B33D" font-size="10" font-family="IBM Plex Mono" text-anchor="middle">w0</text>
          <text x="150" y="240" fill="#5C6675" font-size="10" font-family="IBM Plex Mono" text-anchor="middle">L1</text>
          <text x="330" y="240" fill="#5C6675" font-size="10" font-family="IBM Plex Mono" text-anchor="middle">L2</text>
        </svg>
      </div>
    </div>

    <div class="ld-wrap" style="padding-top: 26px; padding-bottom: 26px;">
      <div style="font: 600 11px 'IBM Plex Mono'; letter-spacing: 0.14em; color: #5C6675; margin-bottom: 14px;">${esc(T.featuresTitle)}</div>
      <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px;">
        ${T.features
          .map(
            (f) => `
          <div style="background: linear-gradient(180deg, #131926 0%, #0E141D 100%); border: 1px solid #1D2634; border-radius: 12px; box-shadow: inset 0 1px 0 rgba(255,255,255,0.035); padding: 16px;">
            <div style="font: 600 10.5px 'IBM Plex Mono'; letter-spacing: 0.08em; color: #5CE1A0; margin-bottom: 8px;">${esc(f.tag)}</div>
            <div style="font: 600 14.5px 'Space Grotesk'; margin-bottom: 6px;">${esc(f.title)}</div>
            <div style="font: 400 12.5px 'Space Grotesk'; color: #97A1B2; line-height: 1.55;">${esc(f.desc)}</div>
          </div>`,
          )
          .join("")}
      </div>
    </div>

    <div id="physics" class="ld-wrap" style="padding-top: 26px; padding-bottom: 40px;">
      <div style="font: 600 11px 'IBM Plex Mono'; letter-spacing: 0.14em; color: #5C6675; margin-bottom: 14px;">${esc(T.principlesTitle)}</div>
      <div style="background: linear-gradient(180deg, #131926 0%, #0E141D 100%); border: 1px solid #1D2634; border-radius: 12px; box-shadow: inset 0 1px 0 rgba(255,255,255,0.035); padding: 8px 16px;">
        ${T.principles
          .map(
            (p) => `
          <div style="display: flex; gap: 12px; align-items: baseline; padding: 11px 0; border-bottom: 1px solid #161D28;">
            <span style="font: 600 11px 'IBM Plex Mono'; color: #F2B33D; flex: none; width: 26px;">${esc(p.n)}</span>
            <span style="font: 600 13.5px 'Space Grotesk'; flex: none; min-width: 240px;">${esc(p.title)}</span>
            <span style="font: 400 12.5px 'Space Grotesk'; color: #97A1B2; line-height: 1.5;">${esc(p.desc)}</span>
          </div>`,
          )
          .join("")}
      </div>
    </div>

    <div style="border-top: 1px solid #161D28; background: rgba(8,11,16,0.6);">
      <div class="ld-wrap" style="padding-top: 32px; padding-bottom: 20px; display: grid; grid-template-columns: 1.5fr 1fr 1fr 1fr; gap: 28px;">
        <div style="display: flex; flex-direction: column; gap: 7px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            ${logo(20, 14)}
            <span style="font: 700 13.5px 'Space Grotesk'; color: #E7ECF4;">ModeForge</span>
          </div>
          <div style="font: 600 12.5px 'Space Grotesk'; color: #C7CFDB;">${esc(T.footTagline)}</div>
          <div style="font: 400 12px 'Space Grotesk'; color: #97A1B2;">Rho-Labs · Patrick Feix</div>
          <div style="font: 400 11px 'IBM Plex Mono'; color: #5C6675;">modeforge.rholabs.de</div>
        </div>
        <div style="display: flex; flex-direction: column; gap: 6px;">
          <div style="font: 600 10.5px 'IBM Plex Mono'; letter-spacing: 0.1em; color: #5C6675; margin-bottom: 3px;">${esc(T.footToolsTitle)}</div>
          ${T.footTools
            .map(
              (t) =>
                `<div style="font: 400 12px 'Space Grotesk'; color: #97A1B2;"><span style="font: 600 11px 'IBM Plex Mono'; color: #8B94A3;">${esc(t.k)}</span> · ${esc(t.v)}</div>`,
            )
            .join("")}
        </div>
        <div style="display: flex; flex-direction: column; gap: 6px;">
          <div style="font: 600 10.5px 'IBM Plex Mono'; letter-spacing: 0.1em; color: #5C6675; margin-bottom: 3px;">${esc(T.footResourcesTitle)}</div>
          <a href="https://github.com/Einhornelchexe/ModeForge" target="_blank" rel="noopener noreferrer" class="ld-foot-link">GitHub</a>
          <a href="guide.html" class="ld-foot-link">${esc(T.guide)}</a>
          <a href="https://github.com/Einhornelchexe/ModeForge/tree/main/docs/theory" target="_blank" rel="noopener noreferrer" class="ld-foot-link">${esc(T.docs)}</a>
          <a href="https://github.com/Einhornelchexe/ModeForge/tree/main/agents/verification" target="_blank" rel="noopener noreferrer" class="ld-foot-link">${esc(T.validation)}</a>
          <a href="workbench.html" class="ld-foot-link">${esc(T.openWorkbench)}</a>
          <a href="https://paypal.me/ModeForge" target="_blank" rel="noopener noreferrer" class="ld-foot-link">${esc(T.support)}</a>
        </div>
        <div style="display: flex; flex-direction: column; gap: 6px;">
          <div style="font: 600 10.5px 'IBM Plex Mono'; letter-spacing: 0.1em; color: #5C6675; margin-bottom: 3px;">${esc(T.footStatusTitle)}</div>
          <div style="font: 400 12px 'IBM Plex Mono'; color: #97A1B2;">v 1.0 · ${esc(T.footDate)}</div>
          <div style="font: 400 12px 'IBM Plex Mono'; color: #97A1B2;">MIT License</div>
          <div style="font: 400 11.5px 'Space Grotesk'; color: #5C6675; line-height: 1.5; margin-top: 4px;">◇ ${esc(T.footDisclaimer)}</div>
        </div>
      </div>
      <div style="border-top: 1px solid #12181F;">
        <div class="ld-wrap" style="padding-top: 14px; padding-bottom: 14px; display: flex; align-items: center; gap: 18px; flex-wrap: wrap;">
          <span style="font: 400 11px 'IBM Plex Mono'; color: #384252;">© 2026 Rho-Labs</span>
          <div style="flex: 1;"></div>
          <a href="impressum.html" class="ld-legal-link">${esc(T.impressum)}</a>
          <a href="datenschutz.html" class="ld-legal-link">${esc(T.privacy)}</a>
        </div>
      </div>
    </div>
  </div>`;
}

app.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-lang]") : null;
  if (!target) return;
  lang = (target.dataset.lang as Lang) ?? "en";
  saveLang(lang);
  render();
});

render();
