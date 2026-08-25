# Analyzer Guide Content (S18f)

Drop-in content for the bilingual in-app user guide (`apps/web/src/guide.ts`), matching that
file's existing `Section = { title: string; body: string }` pattern (one `de` object, one `en`
object, `body` is the literal HTML string used in the guide page). This file is documentation
content only; it is written here rather than merged into `guide.ts` directly because `guide.ts`
is an application source file outside this task's write scope (documentation files only, and the
S17 guide is a single bilingual file, not an index-of-guides file, so the "add a link to the
index" exception does not apply here). Integrating these two pieces into the `de.sections` /
`en.sections` arrays (and wiring the guide.html link mapping, which is already generic) is a
follow-up step for whoever owns `apps/web/src`.

Two pieces per language:

1. A new `Section` — title `"Bildanalyse"` / `"Analyzer"` — inserted after the existing "Feld-Modus
   (Beugung)" / "Field mode (diffraction)" section and before "Grenzen — ehrlich" / "Limits —
   honestly".
2. Three additional `<li>` bullets to append to the EXISTING "Grenzen — ehrlich" / "Limits —
   honestly" section's `<ul>` (that section is shared across all tools; these are the analyzer's
   entries for it, not a new section).

Terminology matches the shipped product exactly: tab labels `"Analyzer"` / `"Bildanalyse"`, mode
pill `IMG`, headline label `"D4sigma (ellipse)"` / `"D4sigma (Ellipse)"`, fit-width label
`"fit width 4sigma"` (EN) / `"Fit-Breite 4sigma"` (DE), suppressed-value prefix
`"suppressed"` / `"unterdrückt"` — all taken from `apps/web/src/i18n.ts`. The analyzer's own UI
labels spell out `sigma_B`, `D4sigma`, `theta` in plain text rather than Greek letters
(`imgSigmaB`, `imgD4Sigma`, `imgTheta` in `i18n.ts`), so this guide content does the same.

**Scope note (not part of the guide text, for whoever integrates it):** the shipped Analyzer
tab now wires all five background methods (`none`, `manual-offset`, `dark-frame` — including
native 16-bit camera image/dark pairs — `rect-median`, `robust-plane`), full ROI handling
(Full frame, typed Rectangle with clamping feedback, the suggested ROI with a one-click apply,
and an ROI derived from the released fit), and the in-image editing flows: the measurement ROI
is drag-editable on the full-frame view, and for the rectangle-based background methods a
draw-target toggle switches the same drag gestures over to the background rectangles, which
render in their own color with a legend entry, force the full-frame view while drawing, and are
carried into the PNG and JSON exports. The authoritative end-user wording lives in the in-app
guide (`apps/web/src/guide.ts`, EN/DE); the section bodies below predate the interactive
controls and describe the analysis pipeline, which is unchanged — when revising them, describe
the controls from the shipped UI rather than this note.

---

## DE — new Section (insert as `{ title: "Bildanalyse", body: ... }`)

```html
<p><strong>Datei laden:</strong> im Reiter <strong>Bildanalyse</strong> (Pill: IMG) eine .tif/.tiff/.png-Datei ablegen oder auswählen (bis 128&nbsp;MB, dekodierte Bilder bis 4096&nbsp;×&nbsp;4096&nbsp;px). Mehrseitige TIFFs und mehrkanalige PNGs blenden Seiten-/Kanalwahl ein; die Pixelteilung (µm/px, x und y) setzen, um neben den Pixelbreiten auch physische Breiten zu sehen.
<strong>Hintergrund:</strong> fünf Methoden stehen zur Wahl — „Keiner", ein manueller Offset (in Zählwerten), ein Dunkelbild gleicher Größe (auch native 16-Bit-Kamerapaare), der Median aus Hintergrund-Rechtecken und eine robuste geneigte Ebene über solchen Rechtecken; die Rechtecke lassen sich direkt im Bild zeichnen (Umschalter „Hintergrund-Rechteck" bei den Rechteck-Methoden). Unabhängig davon schätzt der Analyzer eine Rauschskala sigma_B — aus Ihren Hintergrund-Referenzrechtecken, falls vorhanden, sonst aus einem schmalen Randrahmen um die ROI. Negative Werte nach der Korrektur werden nie abgeschnitten — eine systematische negative Schieflage ist genau das, was die Warnungen unten prüfen.
<strong>ROI:</strong> Gesamtes Bild oder ein getipptes Rechteck (x0, y0, Breite, Höhe in Pixeln). Was beim Klick auf „Analyse starten" eingestellt ist, wird zur bestätigten ROI — dem festen Bereich, auf dem alle Freigabe-Kriterien und beide Momenten-Stufen für diesen Lauf rechnen.
<strong>Drei Zahlen, mit Absicht:</strong> die Hauptkachel zeigt <strong>D4sigma (Ellipse)</strong> — einen Durchmesser, gemessen innerhalb einer an den Strahl angepassten Blende; das ist die vertrauenswürdigste freigegebene Zahl des Analyzers. Daneben steht <strong>Fit-Breite 4sigma</strong>, die Breite, die das Gauß-Modell selbst vorhersagt — bei sauberen Strahlen schärfer, aber eine Modellzahl, keine Messung. Das Momente/Profile-Panel zeigt zusätzlich die rohen ROI-Momente — nützlich zum Nachsehen, aber nie als Hauptwert freigegeben.
<strong>Unterdrückt?</strong> Wenn D4sigma (Ellipse) nicht vertrauenswürdig ist, zeigt die Kachel statt einer Zahl einen Grund: <code>fit_not_converged</code> (die Modellanpassung ist nicht konvergiert), <code>nonpositive_amplitude</code> (der Fit fand keinen echten Peak), <code>residual_high</code> (der Fit passt gemessen am Rauschen nicht gut genug zu den Daten), <code>aperture_clipped</code> (die Prüfblende würde über die ROI hinausreichen), <code>alpha_inconsistent</code> (die Form ist nicht konsistent genug mit einem sauberen Gauß-Kern — Flügel, ein zweiter Lappen, ein flaches Plateau), <code>multi_peak</code> (mehr als ein signifikanter Peak wurde gefunden), <code>coverage_insufficient</code> (defekte oder maskierte Pixel in der Messblende würden die Breite nachweislich verfälschen). Keiner dieser Gründe ist ein Fehlerbericht — der Analyzer verweigert hier bewusst eine Zahl, der er nicht traut.
<strong>Warnungen, die sich zu lesen lohnen:</strong> <em>negative power</em> markiert eine Hintergrundkorrektur, die zu wenig (oder ungewöhnlich viel) negatives Signal für einen sauberen nullmittigen Hintergrund übrig lässt; <em>ROI sensitive</em> heißt, die freigegebene Breite reagiert stärker als erwartet auf kleine ROI-Verschiebungen; <em>residual high</em> und <em>multi peak</em> erklären, warum eine Freigabe unterdrückt wurde; <em>pedestal hint</em> warnt vor einem flachen Rest-Offset, der die Breite nach oben verzerrt; Hot-Pixel-, Sättigungs- und Float-Sonderwert-Warnungen beschreiben die Rohdatei selbst, bevor überhaupt etwas von alldem oben läuft. Jede Zahl hier stammt aus dem dokumentierten ModeForge-Auswerteweg (siehe docs/theory im Repository).</p>
<p><strong>Residuen-Diagnostik:</strong> unterhalb von Momenten/Profilen zeigt der Analyzer jetzt zwei Residuenkarten — Gauß und, sobald der Super-Gauß-Fit konvergiert ist, Super-Gauß — mit einer echten Zahlen-Farbskala; ein Umschalter wechselt zwischen Zählwerten, % Peak und sigma_B, und ein nicht verfügbarer Modus nennt seinen Grund, statt einfach zu verschwinden. Unter dem Profil-Plot läuft für den jeweils gewählten Schnitt eine Residuen-Spur mit. Eine Qualitäts-Box verdichtet die bestehenden Prüfungen — Sättigung, Clipping-Verdacht, Hot-Pixel-Kandidaten, Randberührung, lokale Maxima, ROI-Stabilität, Freigabestatus — auf einen Blick. Ein Histogramm mit Mittelwert, RMS, Sigma, Schiefe und Exzess-Kurtosis zeigt die Verteilungsform der Residuen. Der Modellvergleich stellt jetzt den gefitteten Exponenten n in den Mittelpunkt: nahe 1 liest sich wie ein sauberer Gauß-Kern, deutlich über 1 wie ein flacherer, plateauartiger Strahl.</p>
```

## EN — new Section (insert as `{ title: "Analyzer", body: ... }`)

```html
<p><strong>Load a file:</strong> in the <strong>Analyzer</strong> tab (pill: IMG), drop or pick a .tif/.tiff/.png file (up to 128&nbsp;MB, decoded images capped at 4096&nbsp;×&nbsp;4096&nbsp;px). Multi-page TIFF and multi-channel PNG add page/channel pickers; set the physical pixel pitch (µm/px, x and y) to see physical widths alongside pixel widths.
<strong>Background:</strong> five methods are available — None, a manual offset in counts, a dark frame of the same size (native 16-bit camera pairs included), the median of background rectangles, and a robust tilted plane over such rectangles; the rectangles can be drawn directly on the image (the "background rectangle" draw toggle appears with the rectangle-based methods). Either way the analyzer estimates a noise scale sigma_B — from your background reference rectangles if you gave any, otherwise from a thin rim frame around the ROI. Negative values after correction are never clipped — a systematic negative bias is exactly what the warnings below are watching for.
<strong>ROI:</strong> Full frame or a typed Rectangle (x0, y0, width, height in pixels). Whichever is set when you click "Run analysis" becomes the confirmed ROI — the fixed domain every release gate and both moment stages read for that run.
<strong>Three numbers, on purpose:</strong> the headline tile is <strong>D4sigma (ellipse)</strong> — a diameter measured inside an aperture fitted to the beam; it is the analyzer's most trustworthy released number. Next to it, <strong>fit width 4sigma</strong> is the width the Gaussian model itself predicts — sharper on clean beams, but a model number, not a measurement. The Moments/Profiles panel additionally shows the raw ROI moments — worth looking at, never released as the headline value.
<strong>Suppressed?</strong> When D4sigma (ellipse) cannot be trusted, the tile shows a reason instead of guessing: <code>fit_not_converged</code> (the model fit did not settle), <code>nonpositive_amplitude</code> (the fit found no real peak), <code>residual_high</code> (the fit does not match the data well enough, relative to the noise), <code>aperture_clipped</code> (the check aperture would reach outside your ROI), <code>alpha_inconsistent</code> (the shape is not consistent enough with a clean Gaussian core — wings, a second lobe, a flat top), <code>multi_peak</code> (more than one significant peak was found), <code>coverage_insufficient</code> (dead or masked pixels inside the measurement aperture would measurably distort the width). None of these is a bug report — the analyzer is deliberately refusing to hand you a number it does not trust.
<strong>Warnings worth reading:</strong> <em>negative power</em> flags a background correction that leaves too little (or unusually much) negative signal for a clean zero-mean background; <em>ROI sensitive</em> means the released width moves more than expected when the ROI is nudged; <em>residual high</em> and <em>multi peak</em> explain why a release was suppressed; <em>pedestal hint</em> warns of a flat residual offset biasing the width upward; hot-pixel, saturation and float-special warnings describe the raw file itself, before any of the analysis above runs. Every number here comes from the documented ModeForge analyzer method (see docs/theory in the repository).</p>
<p><strong>Residual diagnostics:</strong> below the moments/profile panel, the analyzer now shows two residual maps — Gaussian, and Super-Gaussian once that fit has converged — with a real numeric colorbar; a mode switch moves between counts, % peak and sigma_B, and whichever mode cannot be shown states its reason instead of just disappearing. A residual lane runs under the profile plot for whichever cut is currently selected. A quality box condenses the existing checks — saturation, clipping suspect, hot-pixel candidates, edge touch, local maxima, ROI stability, release status — into one glance. A histogram with mean, RMS, sigma, skewness and excess kurtosis shows the shape of the residual distribution. The model comparison now centers on the fitted exponent n: near 1 reads as a clean Gaussian core, clearly above 1 as a flatter, plateau-like beam.</p>
```

## DE — three bullets to append to the existing "Grenzen — ehrlich" `<ul>`

```html
<li><strong>Analyzer-Rauschen:</strong> hohes Rauschen weitet die selbstkalibrierte Freigabe-Schwelle auf — schwache Flügelstrukturen an einem Strahl werden bei SNR 20 statistisch unsichtbar.</li>
<li><strong>Analyzer-Satelliten:</strong> ein kleiner Zweitstrahl unter etwa einem Viertel des Hauptpeaks ist bei SNR 20 nicht zuverlässig nachweisbar.</li>
<li><strong>Analyzer-Determinismus:</strong> Ergebnisse sind pro Datei deterministisch — dieselbe Aufnahme mit denselben Einstellungen liefert immer dieselben freigegebenen Zahlen.</li>
```

## EN — three bullets to append to the existing "Limits — honestly" `<ul>`

```html
<li><strong>Analyzer noise:</strong> high noise widens the self-calibrated release ceiling — weak wing structure on a beam becomes statistically invisible around SNR 20.</li>
<li><strong>Analyzer satellites:</strong> a small second beam below roughly a quarter of the main peak is not reliably detectable at SNR 20.</li>
<li><strong>Analyzer determinism:</strong> results are deterministic per file — the same image with the same settings always releases the same numbers.</li>
```
