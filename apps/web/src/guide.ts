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
      title: "Bildanalyse",
      body: `<p><strong>Datei laden:</strong> im Reiter <strong>Bildanalyse</strong> (Pill: IMG) eine .tif/.tiff/.png-Datei ablegen oder auswählen (bis 128&nbsp;MB, dekodierte Bilder bis 4096&nbsp;×&nbsp;4096&nbsp;px). Mehrseitige TIFFs und mehrkanalige PNGs blenden Seiten-/Kanalwahl ein; die Pixelteilung (µm/px, x und y) setzen, um neben den Pixelbreiten auch physische Breiten zu sehen.
      <strong>Hintergrund:</strong> aktuell stehen „Keiner" und ein manueller Offset (in Zählwerten) zur Wahl; unabhängig davon schätzt der Analyzer eine Rauschskala sigma_B — aus euren Hintergrund-Referenzrechtecken, falls vorhanden, sonst aus einem schmalen Randrahmen um die ROI. Negative Werte nach der Korrektur werden nie abgeschnitten — eine systematische negative Schieflage ist genau das, was die Warnungen unten prüfen.
      <strong>ROI:</strong> Gesamtes Bild, ein auf dem Bild gezogenes Rechteck (innen verschieben, am Rand oder an einer Ecke die Größe ändern), getippte Pixelkoordinaten (x0, y0, Breite, Höhe) oder der gestrichelte ROI-Vorschlag mit „Vorschlag übernehmen“. Was beim Klick auf „Analyse starten" eingestellt ist, wird zur bestätigten ROI — dem festen Bereich, auf dem alle Freigabe-Kriterien und beide Momenten-Stufen für diesen Lauf rechnen.
      <strong>Vorschau lesen:</strong> ein kompakter Spot wird mit etwa dem Dreifachen des D4sigma-Durchmessers ausgeschnitten; die Umschaltung „gesamtes Bild“ zeigt den ganzen Sensor, damit das blaue ROI-Rechteck sichtbar ist. Die durchgezogene grüne Linie ist die freigegebene D4sigma-Ellipse; die gestrichelte orange Linie ist die Fit-Breiten-Ellipse — nie die ROI. Eine 4sigma-Ellipse umschließt etwa 86 Prozent der Leistung eines Gauß-Strahls, daher bleiben unter der Kontrastspreizung schwächere Flügel außerhalb sichtbar.
      <strong>Drei Zahlen, mit Absicht:</strong> die Hauptkachel zeigt <strong>D4sigma (Ellipse)</strong> — einen Durchmesser, gemessen innerhalb einer an den Strahl angepassten Blende; das ist die vertrauenswürdigste freigegebene Zahl des Analyzers. Daneben steht <strong>Fit-Breite 4sigma</strong>, die Breite, die das Gauß-Modell selbst vorhersagt — bei sauberen Strahlen schärfer, aber eine Modellzahl, keine Messung. Das Momente/Profile-Panel zeigt zusätzlich die rohen ROI-Momente — nützlich zum Nachsehen, aber nie als Hauptwert freigegeben.
      <strong>Unterdrückt?</strong> Wenn D4sigma (Ellipse) nicht vertrauenswürdig ist, zeigt die Kachel statt einer Zahl einen Grund: <code>fit_not_converged</code> (die Modellanpassung ist nicht konvergiert), <code>nonpositive_amplitude</code> (der Fit fand keinen echten Peak), <code>residual_high</code> (der Fit passt gemessen am Rauschen nicht gut genug zu den Daten), <code>aperture_clipped</code> (die Prüfblende würde über die ROI hinausreichen), <code>alpha_inconsistent</code> (die Form ist nicht konsistent genug mit einem sauberen Gauß-Kern — Flügel, ein zweiter Lappen, ein flaches Plateau), <code>multi_peak</code> (mehr als ein signifikanter Peak wurde gefunden). Keiner dieser Gründe ist ein Fehlerbericht — der Analyzer verweigert hier bewusst eine Zahl, der er nicht traut.
      <strong>Warnungen, die sich zu lesen lohnen:</strong> <em>negative power</em> markiert eine Hintergrundkorrektur, die zu wenig (oder ungewöhnlich viel) negatives Signal für einen sauberen nullmittigen Hintergrund übrig lässt; <em>ROI sensitive</em> heißt, die freigegebene Breite reagiert stärker als erwartet auf kleine ROI-Verschiebungen; <em>residual high</em> und <em>multi peak</em> erklären, warum eine Freigabe unterdrückt wurde; <em>pedestal hint</em> warnt vor einem flachen Rest-Offset, der die Breite nach oben verzerrt; <em>width scatter</em> beziffert, wie stark die freigegebene Breite unter dem Rauschen dieses einen Bildes streut, und warnt oberhalb von 5 Prozent; <em>absorbed power</em> markiert einen schwachen, breiten Flügel jenseits der Apertur, der sonst spurlos im Hintergrund-Fit verschwindet — bei sehr niedrigem Signal-Rausch-Verhältnis kann ein schwacher Flügel diese Prüfung dennoch unbemerkt passieren; <em>clipping suspect</em> markiert ein Plateau von Pixeln unterhalb der Sättigungsgrenze des Dateiformats, ein möglicher Hinweis auf Sensor-Clipping; Hot-Pixel-, Sättigungs- und Float-Sonderwert-Warnungen beschreiben die Rohdatei selbst, bevor überhaupt etwas von alldem oben läuft. Jede Zahl hier stammt aus dem dokumentierten ModeForge-Auswerteweg (siehe docs/theory im Repository).</p>`,
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
        <li><strong>Analyzer-Rauschen:</strong> hohes Rauschen weitet die selbstkalibrierte Freigabe-Schwelle auf — schwache Flügelstrukturen an einem Strahl werden bei SNR 20 statistisch unsichtbar.</li>
        <li><strong>Analyzer-Satelliten:</strong> ein kleiner Zweitstrahl unter etwa einem Viertel des Hauptpeaks ist bei SNR 20 nicht zuverlässig nachweisbar.</li>
        <li><strong>Analyzer-Breitenstreuung:</strong> die freigegebene Breite liefert inzwischen eine Rauschstreuung pro Bild mit und warnt oberhalb von 5 Prozent — ein einzelnes Bild pinnt die Breite nicht enger als das.</li>
        <li><strong>Analyzer-Flügel:</strong> ein schwacher, breiter Flügel jenseits der Apertur wird über die Absorbed-Power-Prüfung markiert; bei sehr niedrigem Signal-Rausch-Verhältnis kann ein schwacher Flügel diese Prüfung trotzdem unbemerkt passieren.</li>
        <li><strong>Sensor-Clipping:</strong> ein Plateau unterhalb der Sättigungsgrenze des Dateiformats wird jetzt als möglicher Clipping-Hinweis markiert.</li>
        <li><strong>Analyzer-Determinismus:</strong> Ergebnisse sind pro Datei deterministisch — dieselbe Aufnahme mit denselben Einstellungen liefert immer dieselben freigegebenen Zahlen.</li>
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
      title: "Analyzer",
      body: `<p><strong>Load a file:</strong> in the <strong>Analyzer</strong> tab (pill: IMG), drop or pick a .tif/.tiff/.png file (up to 128&nbsp;MB, decoded images capped at 4096&nbsp;×&nbsp;4096&nbsp;px). Multi-page TIFF and multi-channel PNG add page/channel pickers; set the physical pixel pitch (µm/px, x and y) to see physical widths alongside pixel widths.
      <strong>Background:</strong> today's choices are None or a manual offset in counts; either way the analyzer estimates a noise scale sigma_B — from your background reference rectangles if you gave any, otherwise from a thin rim frame around the ROI. Negative values after correction are never clipped — a systematic negative bias is exactly what the warnings below are watching for.
      <strong>ROI:</strong> Full frame, a rectangle dragged on the image (drag inside to move, drag an edge or corner to resize), typed pixel coordinates (x0, y0, width, height), or the dashed suggested ROI with "Apply suggestion". Whichever is set when you click "Run analysis" becomes the confirmed ROI — the fixed domain every release gate and both moment stages read for that run.
      <strong>Reading the preview:</strong> a compact spot is framed at about 3× the D4sigma diameter; switch the view to full frame to see the blue ROI rectangle on the whole sensor. The solid green overlay is the released D4sigma ellipse; the dashed orange overlay is the fit-width ellipse — never the ROI. A 4sigma ellipse encloses about 86 percent of a Gaussian's power, so the display stretch still shows fainter tails outside it.
      <strong>Three numbers, on purpose:</strong> the headline tile is <strong>D4sigma (ellipse)</strong> — a diameter measured inside an aperture fitted to the beam; it is the analyzer's most trustworthy released number. Next to it, <strong>fit width 4sigma</strong> is the width the Gaussian model itself predicts — sharper on clean beams, but a model number, not a measurement. The Moments/Profiles panel additionally shows the raw ROI moments — worth looking at, never released as the headline value.
      <strong>Suppressed?</strong> When D4sigma (ellipse) cannot be trusted, the tile shows a reason instead of guessing: <code>fit_not_converged</code> (the model fit did not settle), <code>nonpositive_amplitude</code> (the fit found no real peak), <code>residual_high</code> (the fit does not match the data well enough, relative to the noise), <code>aperture_clipped</code> (the check aperture would reach outside your ROI), <code>alpha_inconsistent</code> (the shape is not consistent enough with a clean Gaussian core — wings, a second lobe, a flat top), <code>multi_peak</code> (more than one significant peak was found). None of these is a bug report — the analyzer is deliberately refusing to hand you a number it does not trust.
      <strong>Warnings worth reading:</strong> <em>negative power</em> flags a background correction that leaves too little (or unusually much) negative signal for a clean zero-mean background; <em>ROI sensitive</em> means the released width moves more than expected when the ROI is nudged; <em>residual high</em> and <em>multi peak</em> explain why a release was suppressed; <em>pedestal hint</em> warns of a flat residual offset biasing the width upward; <em>width scatter</em> reports how much the released width itself moves under this image's own noise and warns above 5 percent; <em>absorbed power</em> flags a faint wide wing beyond the aperture that would otherwise vanish into the background fit — though a weak enough wing at very low signal-to-noise can still slip past it; <em>clipping suspect</em> flags a plateau of pixels sitting below the file format's saturation limit, a possible sign of sensor clipping; hot-pixel, saturation and float-special warnings describe the raw file itself, before any of the analysis above runs. Every number here comes from the documented ModeForge analyzer method (see docs/theory in the repository).</p>`,
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
        <li><strong>Analyzer noise:</strong> high noise widens the self-calibrated release ceiling — weak wing structure on a beam becomes statistically invisible around SNR 20.</li>
        <li><strong>Analyzer satellites:</strong> a small second beam below roughly a quarter of the main peak is not reliably detectable at SNR 20.</li>
        <li><strong>Analyzer width scatter:</strong> the released width now ships a per-image noise-scatter estimate and warns above 5 percent — a single frame does not pin the width tighter than that.</li>
        <li><strong>Analyzer wings:</strong> a faint wide wing beyond the aperture is flagged by the absorbed-power probe; a weak enough wing at very low signal-to-noise can still slip past it.</li>
        <li><strong>Sensor clipping:</strong> a plateau below the file format's saturation limit is now flagged as a possible sign of clipping.</li>
        <li><strong>Analyzer determinism:</strong> results are deterministic per file — the same image with the same settings always releases the same numbers.</li>
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
          <div class="lg-stand">ModeForge v2.1 · <a class="lg-link" href="https://github.com/Einhornelchexe/ModeForge" target="_blank" rel="noopener noreferrer">GitHub</a> · <a class="lg-link" href="https://github.com/Einhornelchexe/ModeForge/tree/main/docs/theory" target="_blank" rel="noopener noreferrer">docs/theory</a></div>
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
