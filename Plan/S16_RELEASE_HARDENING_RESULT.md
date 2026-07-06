# S16 - Release Hardening: Ergebnis

**Datum:** 2026-07-05.
**Status:** abgeschlossen; alle Aenderungen auf main/origin (9693231, 790dd6e, 850f2f3 + Abschluss-Commit). Oeffentlicher Mirror bereit. Livegang wartet auf Betreiber-Schalter.
**Auftrag:** "S16 go, MIT, Trail oeffentlich, How-this-was-built mit rein" + "nirgends private Infos" + "abschliessender Top Tier AI check (externes KI-Review, GPT-5.5)" + optionale Abschluss-Debatte + "Funktionsweise und Codes der Orchestrierungsschicht sowie Skills bleiben geheim".

---

## 0. Verdikt zuerst

**Release-Gate bestanden.** Zwei unabhaengige Abschluss-Pruefungen — eine Multi-Agent-Debatte ueber den neuesten Code und ein GPT-5.5-Tiefenreview ueber den gesamten Physik-Core — fanden zusammen **einen echten Ablauf-Defekt und vier Import-Ehrlichkeits-Raender, aber keinen einzigen Formel- oder Konventionsfehler**. Alle Funde wurden reproduziert, gefixt, regressionsgetestet und von einer zweiten unabhaengigen GPT-5.5-Session mit **PASS** gegengeprueft. Endstand der Gates: **85/85 Tests, 60/60 Referenzfaelle, Headless-Baselines bitidentisch, Scope, Build, Firefox-Smoke.**

## 1. Abschluss-Verifikation (der Kern von S16)

### 1a. Finale Debatten-Runde (2 unabhaengige Worker-Herleitungen, ~0.08 USD)
17 Claims VERIFIED, 1 WRONG: **Probe exakt auf der Ebene eines Null-Laengen-Elements wurde VOR dessen Transform gesampelt** (Konvention verlangt NACH). Ehrlicher Trail: der erste Manager-Gegenbeweis war selbst fehlerhaft (Peak-1-Normierung uebersehen — pi*w^2/2 als "geclippte" Leistung fehlgedeutet); der instrumentierte Zweitlauf bestaetigte den Worker. Mit Phasenmasken unbeobachtbar (deshalb von S13B-Tests nie gefangen), mit Blenden ein falsches Ergebnis. Fix in `propagateSpan` (Span-Ende strikt; equal-z-Probes nach den Transforms), Regressionstest gegen die analytische Transmission 0.5888, Baselines unveraendert. Die 8 Zahlen-Orakel der Debatte laufen als permanente Handler in `verify:cases` (52 -> 60).

### 1b. GPT-5.5-Review R1 (externes KI-Review, xhigh, ~9 min)
Wortlaut: *"no formula/convention error in the reviewed core paths"* ueber q/M²-Propagation, ABCD-Reihenfolge, EFL/BFL/FFL-Vorzeichen, Fresnel-/Angular-Spectrum-Vorzeichen, Sag-Phase, GVD/GDD-Einheitenkette, Fluenz-/Intensitaets-Faktoren, nx/ny-FFT-Indizierung, Plansflaechen-Neutralitaet, Kaustik-Fit. Verdikt NEEDS-FIXES wegen 6 Vertrags-/Import-Raendern — **alle 6 reproduziert (0 Halluzinationen)**:

| # | Severity | Fund | Fix |
|---|---|---|---|
| H1 | HIGH | ZMX ok:true mit n=NaN ausserhalb Sellmeier-Range, keine Warnung | materialWarnings durchgereicht; nicht-endliches n blockiert |
| H2 | HIGH | UNIT INCH still als mm gelesen | Unit-Prescan, CM/METER/IN -> mm-Konversion mit Info; unbekannte Units blockieren |
| H3 | HIGH | MIRR still geschluckt; GLAS MIRROR lief irrefuehrend in "unbekanntes Glas" | beide Schreibweisen blockieren als Geometrie |
| M1 | MEDIUM | free-space.refractiveIndex validiert aber ignoriert (B=30 statt 20) | reduzierter Weg L/n in Fast- UND Feld-Modus; Densifier reichte n schon durch |
| L1 | LOW | 1e-9-mm-Toleranzfenster strenger als Doku-Wortlaut | Konvention praezisiert |
| L2 | LOW | Alttext "sqrt(2)*w" in S13-Verifikationsnotiz (Code/Cases immer korrekt 2 sigma = w) | Text mit Korrekturvermerk berichtigt |

### 1c. GPT-5.5-Review R2 (frische Session): **PASS**
Alle 6 Fixes FIXED, keine neuen Findings; Zusatzchecks bestanden (UNIT nach SURF skaliert korrekt, WAVM/Wellenlaengen unskaliert; componentLength/zGrid bleiben physisch; Probe-Mapping physisch vs optisch konsistent). Gates von R2 eigenstaendig nachgefahren.

### 1d. Nachtrag: Gemini-Cross-Runde + GPT-5.5-R3 (auf Betreiber-Wunsch)

Un-geankerte Gemini-3.1-Pro-Peer-Runde (einen Zweit-Reviewer-Kanal) nach den beiden Codex-Detailrunden. Ergebnis: **1 echter HIGH-Physikfehler**, strukturell unsichtbar fuer alle 85 Tests und beide Codex-Runden — das Startphasen-Vorzeichen in createGaussianFieldAtPlane war gegen die Kernel-Konvention invertiert (Strahlen mit Taille vor der Startebene KONVERGIERTEN im Feld-Modus; jeder bisherige Test startete an der Taille, R wurde nie exerziert). Empirisch doppelt bewiesen (Probe lief auf exakt w(20) statt w(80)); Fix +k r^2/(2R), Orakel beidseitig auf 1e-9 an der analytischen Envelope, permanenter Regressionstest. Dazu 3 weitere valide Funde (reale Zemax-Exporte: OBJ/IMA-Ebenen im Bauteil + DISZ-INFINITY-Fehlverhalten -> Trim-Regel mit Iris-Schutz; Apertur-Margin nur am Austritt -> max(Eintritt, Austritt)), 1 Halluzination (Radius-im-Medium: Codepfad per Vertrag unerreichbar), Rest Konvention/Info -> dokumentiert. GPT-5.5-R3 bestaetigte den Vorzeichen-Fix mit eigener Herleitungskette (CONFIRMED inkl. wavefrontRadiusFromQ), fand den Iris-Randfall der Trim-Regel (fuehrende Plan-Luft-Flaeche mit DIAM wurde gefressen) — gefixt: Iris mit endlichem Abstand bleibt erhalten, Objektebene im Unendlichen wird trotz Bookkeeping-DIAM getrimmt, Bildebenen-Halbmesser wird mit expliziter Notiz verworfen. Endstand: **90/90 Tests, 60/60 Referenzfaelle, Baselines unveraendert.**

Lehre fuer die Methodik-Story: Die Detail-Reviews pruefen Bausteine, der un-geankerte Cross-Blick prueft Konsistenz ZWISCHEN Bausteinen — beide Ebenen waren noetig.

## 2. Release-Vorbereitung (im Repo)

- **LICENSE MIT** (Copyright 2026 Patrick Feix / Rho-Labs) — loest den Landing-Claim ein.
- **README fuer Fremde**: Pitch, die 5 Alltagsfragen, Verified-Physics-Story, Quickstart, ehrliche Grenzen, **"How this was built"** auf Methodik-Ebene (human-directed, AI-orchestrated, adversariale Verifikation, Gates) — ohne Interna der privaten Orchestrierungsschicht.
- **Wild-ZMX-Ehrlichkeit**: Asphaeren/Tilts/Spiegel/unbekannte Units blockieren mit klarer Meldung; unbekannte Keywords einmalige Info-Liste; nichts wird still zur Sphaere/zu mm.
- **Landing-Links echt** (GitHub/Docs/Validation); CNAME `modeforge.rholabs.de`; **GitHub-Pages-Workflow** (alle Gates + Build; Deploy erst bei Repo-Variable `DEPLOY_PAGES=true`).
- **Firefox-Smoke** gruen (Landing, Envelope, Field-Worker, Import); Chromium ohnehin laufend genutzt.
- `.mcp.json` untracked (lokales Tooling).

## 3. Oeffentlicher Mirror (Orchestrierung-Geheimhaltung)

`..\ModeForge-public`: frische Ein-Commit-History, alle getrackten Dateien AUSSER Tooling-Feedback-Interna; Plan-/Verifikations-Trail bleibt oeffentlich, aber **sanitisiert** (Tool-Signaturen, Parameter-Namen und Skill-Bezeichnungen der privaten Orchestrierungsschicht durch generische Begriffe ersetzt). Maschineller Verbots-Sweep (Interna-Begriffe, lokale Pfade, private Mail, Key-Muster mit Wortgrenze) laeuft clean und bricht den Build bei Treffern. **Mirror eigenstaendig verifiziert**: npm install -> 85/85 Tests, 60/60 Referenzfaelle im Mirror selbst.

## 4. Was der Betreiber fuer den Livegang tut (bewusst nicht automatisiert)

1. Neues GitHub-Repo `ModeForge` (public) anlegen; das bisherige private ggf. umbenennen (z. B. `ModeForge-lab`). Mirror pushen: `cd ..\ModeForge-public && git remote add origin <url> && git push -u origin main`.
2. Repo-Variable `DEPLOY_PAGES=true` setzen, Pages auf "GitHub Actions" stellen; DNS `modeforge.rholabs.de` -> Pages.
3. **Impressum pruefen: Steuernummer entfernen?** (rechtlich nicht gefordert, unueblich zu veroeffentlichen; W-IdNr genuegt). Rechtsreview Impressum/Datenschutz final.
4. LinkedIn/Posting nach der vereinbarten Dramaturgie: Tool -> Verifikation -> "How it was built".

## 5. Grenzen / Notizen

- Der oeffentliche Mirror wird bei jedem Release-Stand per Skript neu erzeugt (Ein-Commit-History); Dev-Historie bleibt privat.
- ZMX-Unit-Konversion deckt MM/CM/METER/IN ab; exotische Tokens blockieren ehrlich.
- free-space.refractiveIndex ist jetzt semantisch belegt (Medium-Immersion); UI-Editor exponiert das Feld bewusst nicht (JSON-Feature).
