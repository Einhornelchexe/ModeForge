// User guide page — static content in both languages with the shared lang
// toggle. Styling reuses the legal-page classes; no physics, no requests.

import { loadLang, saveLang, type Lang } from "./i18n.ts";
import "./base.css";
import "./legal.css";

type Section = { title: string; body: string };

const de: { kicker: string; title: string; sub: string; sections: Section[] } = {
  kicker: "ANLEITUNG",
  title: "ModeForge benutzen",
  sub: "Die Werkzeuge in Kurzform — und die ehrlichen Grenzen. Für die Theorie und alle Konventionen siehe docs/theory im Repository.",
  sections: [
    {
      title: "In 60 Sekunden",
      body: `<p>Links eine <strong>Vorlage</strong> wählen (z.&nbsp;B. Dicklinsen-Fokus), dann Strahl- und Bauteilwerte ändern — jede Eingabe rechnet sofort neu. Der Plot zeigt die 1/e²-Envelope über z, rechts stehen Ausgangs-Taille, Puls-Kennzahlen und pro Bauteil die <strong>Apertur-Reserve</strong>. Gelbe/rote Hinweise unten sind keine Deko: ModeForge meldet ehrlich, wenn etwas klemmt oder eine Näherung ihre Grenze erreicht.</p>`,
    },
    {
      title: "Strahlengang (Fast Mode)",
      body: `<p><strong>Quelle:</strong> Gauß (w0, z0, M²), elliptisch/astigmatisch (x/y getrennt) oder Momenten-Strahl (D4σ + M²). Der Moden-Helfer rechnet HG/LG-Ordnungen in ein Envelope-M² um („Als Strahl-M² übernehmen").
      <strong>Puls:</strong> Energie oder P̄+Rate plus FWHM-Dauer und Form — rechts erscheinen Spitzenleistung, Fluenz und Intensität an der Austrittsebene.
      <strong>Bauteile:</strong> über die +-Buttons anfügen, per Klick auswählen und editieren, mit ←/→ verschieben. Position z verschiebt die vorgelagerte Freistrecke. Die Rechnung ist paraxiale ABCD-Matrixoptik — exakt im Rahmen dieser Näherung, ohne Aberrationen.</p>`,
    },
    {
      title: "Optimierer",
      body: `<p>Zweilinsen-Gittersuche: Linsenkandidaten (f, Apertur) und Positionsraster definieren, Ziel setzen (Radius an Ebene z oder Ziel-Taille), Randbedingungen wie Mindestabstand und Apertur-Reserve wählen. Die Trefferliste zeigt Abweichung und optional die <strong>Sensitivität</strong> gegen Positions-/Brennweiten-/M²-Fehler — „In Strahlengang übernehmen" baut die Lösung direkt ein.</p>`,
    },
    {
      title: "Import (ZMX & AGF)",
      body: `<p>Zemax-Sequenzdateien per <strong>DATEI LADEN</strong>, Drag&nbsp;&&nbsp;Drop oder Einfügen laden (UTF-16-Exporte werden erkannt), λ für die Brechzahl setzen, parsen. Objekt-/Bildebenen echter Exporte werden automatisch abgetrennt. Einfache Singlets landen als Dicklinse, komplexere Verschreibungen (Kittglieder, Mehrlinser) als <strong>Flächenstapel</strong> im Strahlengang — inklusive Glas-Glas-Kittflächen.
      <strong>Warum blockiert mein Import?</strong> Unbekannte Gläser (erst AGF-Katalog laden und „übernehmen"), Asphären/Spiegel/Tilts (CONI, XDAT, GLAS MIRROR …), unbekannte Einheiten oder Brechzahlen außerhalb des Sellmeier-Gültigkeitsbereichs. Das ist Absicht: lieber ein ehrliches Nein als eine falsche Linse.</p>`,
    },
    {
      title: "Strahl-Fit (M²)",
      body: `<p>Kaustik-Messungen als CSV einfügen: eine Zeile pro Messpunkt <code>z_mm, breite</code>, Breitenbasis oben wählen (1/e²-Radius, FWHM-/D4σ-Durchmesser, rms). Der Least-Squares-Fit liefert w0, z0, M² und Residuen; „Als Strahl übernehmen" macht den Fit zur Projektquelle.</p>`,
    },
    {
      title: "Feld-Modus (Beugung)",
      body: `<p>Propagiert das skalare Feld durch den echten Strahlengang und liest es an einer frei wählbaren <strong>Auswerte-Ebene</strong> aus. Gitter N und dx bestimmen Auflösung und Ausdehnung — <strong>AUTO dx</strong> ist der richtige Start.
      <strong>Feld-Quelle:</strong> Gauß oder echte HG/LG-Moden (m,n bzw. p,l) — die Taille gilt als gemessene Second-Moment-Taille; fürs konsistente Kreuzchecken das Strahl-M² passend setzen (Hinweis erscheint).
      <strong>Flächen-Phase:</strong> „Ideal" = paraxiale Phasenmaske; „Echte Flächen (TEA)" prägt die exakte sphärische Flächenphase auf — sag-getriebene sphärische Aberration wird sichtbar.
      <strong>Ergebnisse lesen:</strong> Der Kreuzcheck vergleicht das Feld mit der paraxialen Envelope. Blau = Abweichung durch Beugung erwartbar (harte Blende). Amber „SAMPLING-GRENZE" = das Gitter kann das Ergebnis nicht auflösen (z.&nbsp;B. Fokus kleiner als eine Gitterzelle) — dann ist die Abweichung ein Gitter-Artefakt, keine Physik. Die Warnung nennt das nötige N.</p>`,
    },
    {
      title: "Grenzen — ehrlich",
      body: `<ul>
        <li><strong>Paraxial:</strong> Fast Mode ist ABCD-Optik — keine Aberrationen, keine großen Winkel (hohe NA ≫ 0.1–0.2 ist außerhalb).</li>
        <li><strong>TEA:</strong> „Echte Flächen" ist eine Thin-Element-Näherung: Sag-Aberration ja, Einfallswinkel-Aberrationen nein.</li>
        <li><strong>Eine Wellenlänge pro Rechnung:</strong> Dispersion nur über n(λ); Chromatik durch λ-Wechsel vergleichen.</li>
        <li><strong>Gitter:</strong> Der Feld-Modus kann nur darstellen, was N·dx fasst und dx auflöst — die Sampling-Warnungen ernst nehmen.</li>
        <li><strong>Nicht unterstützt:</strong> Asphären, Spiegel/Faltungen, Tilts/Dezentrierungen, Vektorfelder/Polarisation.</li>
        <li><strong>Kein Laserschutz-Nachweis:</strong> Ergebnisse sind Näherungen für Design und Lehre, keine sicherheitstechnische Bewertung.</li>
      </ul>`,
    },
    {
      title: "Projektdateien",
      body: `<p>„JSON exportieren" sichert das komplette Projekt als versionierte, diff-bare Datei; „JSON importieren" (auch per Datei/Drag&nbsp;&&nbsp;Drop) lädt sie zurück. Ideal für Versionskontrolle, Teilen und Reproduzierbarkeit.</p>`,
    },
  ],
};

const en: typeof de = {
  kicker: "GUIDE",
  title: "Using ModeForge",
  sub: "The tools in short — and the honest limits. For theory and all conventions see docs/theory in the repository.",
  sections: [
    {
      title: "In 60 seconds",
      body: `<p>Pick a <strong>preset</strong> on the left (e.g. thick-lens focus), then change beam and component values — everything recomputes instantly. The plot shows the 1/e² envelope along z; on the right you get the output waist, pulse numbers and each component's <strong>aperture margin</strong>. The amber/red notes at the bottom are not decoration: ModeForge tells you honestly when something clips or an approximation reaches its limit.</p>`,
    },
    {
      title: "Beamline (fast mode)",
      body: `<p><strong>Source:</strong> Gaussian (w0, z0, M²), elliptical/astigmatic (separate x/y) or a moment beam (D4σ + M²). The mode helper converts HG/LG orders into an envelope M² ("Apply as beam M²").
      <strong>Pulse:</strong> energy or average power + rate plus FWHM duration and shape — peak power, fluence and intensity at the exit plane appear on the right.
      <strong>Components:</strong> add via the + buttons, click to select and edit, reorder with ←/→. Position z adjusts the preceding free space. The computation is paraxial ABCD matrix optics — exact within that approximation, no aberrations.</p>`,
    },
    {
      title: "Optimizer",
      body: `<p>Two-lens grid search: define lens candidates (f, aperture) and position grids, set a target (radius at plane z or a target waist), choose constraints such as minimum separation and aperture margin. The result list shows the mismatch and optionally the <strong>sensitivity</strong> to position/focal/M² errors — "Send to beamline" installs a solution directly.</p>`,
    },
    {
      title: "Import (ZMX & AGF)",
      body: `<p>Load Zemax sequential files via <strong>LOAD FILE</strong>, drag &amp; drop or paste (UTF-16 exports are detected), set λ for the refractive index, parse. Object/image planes of real exports are trimmed automatically. Simple singlets become a thick lens; more complex prescriptions (cemented doublets, multi-element) become a <strong>surface stack</strong> in the beamline — glass-glass interfaces included.
      <strong>Why is my import blocked?</strong> Unknown glasses (load and adopt an AGF catalog first), aspheres/mirrors/tilts (CONI, XDAT, GLAS MIRROR …), unknown lens units, or indices outside the Sellmeier validity range. That is deliberate: an honest no beats a wrong lens.</p>`,
    },
    {
      title: "Beam fit (M²)",
      body: `<p>Paste caustic measurements as CSV: one row per point <code>z_mm, width</code>, pick the width basis (1/e² radius, FWHM/D4σ diameter, rms). The least-squares fit returns w0, z0, M² and residuals; "Use as beam" makes the fit your project source.</p>`,
    },
    {
      title: "Field mode (diffraction)",
      body: `<p>Propagates the scalar field through the actual beamline and reads it out at a freely chosen <strong>probe plane</strong>. Grid N and dx set resolution and extent — <strong>AUTO dx</strong> is the right starting point.
      <strong>Field source:</strong> Gaussian or true HG/LG modes (m,n or p,l) — the waist is read as the measured second-moment waist; set the beam M² to match for a consistent cross-check (a note reminds you).
      <strong>Surface phase:</strong> "Ideal" = paraxial phase mask; "Real sag (TEA)" imprints the exact spherical surface phase — sag-driven spherical aberration becomes visible.
      <strong>Reading results:</strong> the cross-check compares the field against the paraxial envelope. Blue = deviation expected from diffraction (hard aperture). Amber "SAMPLING LIMIT" = the grid cannot resolve the result (e.g. a focus smaller than one grid cell) — the deviation is then a grid artifact, not physics. The warning states the N you would need.</p>`,
    },
    {
      title: "Limits — honestly",
      body: `<ul>
        <li><strong>Paraxial:</strong> fast mode is ABCD optics — no aberrations, no large angles (high NA ≫ 0.1–0.2 is out of scope).</li>
        <li><strong>TEA:</strong> "real sag" is a thin-element approximation: sag aberration yes, incidence-angle aberrations no.</li>
        <li><strong>One wavelength per run:</strong> dispersion enters only via n(λ); compare chromatic behavior by switching λ.</li>
        <li><strong>Grid:</strong> the field mode can only represent what N·dx holds and dx resolves — take the sampling warnings seriously.</li>
        <li><strong>Not supported:</strong> aspheres, mirrors/folds, tilts/decenters, vector fields/polarization.</li>
        <li><strong>No laser-safety proof:</strong> results are approximations for design and teaching, not a safety assessment.</li>
      </ul>`,
    },
    {
      title: "Project files",
      body: `<p>"Export JSON" saves the whole project as a versioned, diffable file; "Import JSON" (also via file/drag &amp; drop) loads it back. Ideal for version control, sharing and reproducibility.</p>`,
    },
  ],
};

const appRoot = document.querySelector<HTMLDivElement>("#app");
if (!appRoot) throw new Error("ModeForge guide root is missing");
const app = appRoot;

let lang: Lang = loadLang();

function render(): void {
  const T = lang === "de" ? de : en;
  document.documentElement.lang = lang;
  app.innerHTML = `
    <div class="lg-page">
      <div class="lg-wrap lg-nav">
        <a href="./" class="lg-brand">
          <div class="lg-logo-box">
            <svg width="22" height="16" viewBox="0 0 26 18" fill="none">
              <path d="M1 3 C 10 3, 10.5 9, 13 9 C 15.5 9, 16 3, 25 3" stroke="#5CE1A0" stroke-width="1.6" fill="none"></path>
              <path d="M1 15 C 10 15, 10.5 9, 13 9 C 15.5 9, 16 15, 25 15" stroke="#5CE1A0" stroke-width="1.6" fill="none" opacity="0.55"></path>
              <circle cx="13" cy="9" r="1.8" fill="#F2B33D"></circle>
            </svg>
          </div>
          <span style="font-weight: 700; font-size: 15.5px;">ModeForge</span>
        </a>
        <div style="flex: 1;"></div>
        <button data-lang="en" class="lg-nav-link" style="background: none; border: none; cursor: pointer; ${lang === "en" ? "color: #E7ECF4;" : ""}">EN</button>
        <button data-lang="de" class="lg-nav-link" style="background: none; border: none; cursor: pointer; ${lang === "de" ? "color: #E7ECF4;" : ""}">DE</button>
        <a href="workbench.html" class="lg-nav-link">Workbench →</a>
      </div>

      <div class="lg-wrap lg-content">
        <div class="lg-kicker">${T.kicker}</div>
        <h1>${T.title}</h1>
        <div class="lg-sub">${T.sub}</div>
        <div class="lg-sections">
          ${T.sections.map((section) => `<div><h2>${section.title}</h2><div class="lg-body">${section.body}</div></div>`).join("")}
          <div class="lg-stand">ModeForge v1.0 · <a class="lg-link" href="https://github.com/Einhornelchexe/ModeForge" target="_blank" rel="noopener noreferrer">GitHub</a> · <a class="lg-link" href="https://github.com/Einhornelchexe/ModeForge/tree/main/docs/theory" target="_blank" rel="noopener noreferrer">docs/theory</a></div>
        </div>
      </div>

      <div class="lg-footer">
        <div class="lg-wrap lg-footer-inner">
          <span class="lg-copyright">© 2026 Rho-Labs · Patrick Feix</span>
          <div style="flex: 1;"></div>
          <a href="./" class="lg-foot-link">${lang === "de" ? "Übersicht" : "Overview"}</a>
          <a href="impressum.html" class="lg-foot-link">Impressum</a>
          <a href="datenschutz.html" class="lg-foot-link">${lang === "de" ? "Datenschutz" : "Privacy"}</a>
        </div>
      </div>
    </div>`;
}

app.addEventListener("click", (event) => {
  const target = event.target instanceof HTMLElement ? event.target.closest("[data-lang]") : null;
  if (!target) return;
  lang = target.getAttribute("data-lang") === "de" ? "de" : "en";
  saveLang(lang);
  render();
});

render();
