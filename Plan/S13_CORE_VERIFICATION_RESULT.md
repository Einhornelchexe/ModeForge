# S13 Teil A - Unabhaengige Core-Verifikation via Multi-Agent-Debatten: Ergebnis

**Datum:** 2026-07-04.
**Status:** abgeschlossen; Verifikations-Verdikt **PASS** fuer alle 5 Domaenen.
**Auftrag:** Alle rechnungswichtigen Core-Bereiche per `Debatten-Lauf` unabhaengig kontrollieren lassen (Betreiber-Auftrag vom 2026-07-04; Modell-/Aufbauwahl an Manager delegiert).

---

## 0. Verdikt zuerst

**In keiner der fuenf Domaenen wurde ein Rechenfehler im Core gefunden.** Fuenf autonome DeepSeek-Debatten (je 2 unabhaengige Proposer, pro/max) haben die Formeln gegen eigenstaendige Lehrbuch-Herleitungen auditiert (**0x WRONG**, 3x SUSPECT — allesamt Doku-/Konventionspunkte, keine Rechenfehler) und unabhaengig berechnete Referenzfaelle geliefert. Der Manager-Cross-Check dieser Faelle gegen den echten Core ergab nach Triage: **52/52 PASS** (`npm run verify:cases`). Jede anfaengliche Abweichung liess sich durch unabhaengige Manager-Nachrechnung eindeutig auf Worker-Rundungs- oder Konventionsfehler zurueckfuehren — in jedem nachgerechneten Fall lieferte der Core den mathematisch exakten Wert.

---

## 1. Aufbau

- 5 Domaenen-Debatten via `Debatten-Lauf`: Gauss-Optik/ABCD, Dicklinsen/Flaechenstapel/Materialien, Puls-Energetik, Strahlbreiten/M2/Fit, Feldpropagation.
- `deepseek-v4-pro @ max` (Empfehlung von `select_worker_model` fuer review/high/high), autonomer Moderator, `Proposer-Zahl=2` (zwei unabhaengige Herleitungen als Kreuzprobe), `Rundenlimit=3`, je Debatte 0.25 USD Cap.
- **Bewusst ohne Test-Gate** (Lint-Gate=false, kein test_command): Ein rotes Gate haette die Debatten auf die Werte der eigenen Implementierung konvergieren lassen — das Gegenteil unabhaengiger Verifikation. Der objektive Zahlenvergleich lief stattdessen manager-seitig: `scripts/verify-reference-cases.mjs` fuehrt jede Case gegen die echten Physik-Pakete aus.
- Deliverables je Domaene: Claim-Tabelle (`*_verification.md`, VERIFIED/SUSPECT/WRONG) + numerische Referenzfaelle (`*_cases.json`) unter `agents/verification/`.

## 2. Ergebnis je Domaene

| Domaene | Claims | Referenzfaelle (nach Triage) | Verdikt |
|---|---|---|---|
| Gauss-Optik/ABCD (zR, Divergenz, q, w(z), Matrizen, Slab t/n) | alle VERIFIED | 10/10 PASS | **PASS** |
| Dicklinsen/Stapel/Materialien (EFL/BFL/FFL, Sellmeier, GVD) | 11 VERIFIED, 3 SUSPECT (Doku) | 10/10 PASS | **PASS** |
| Puls-Energetik (Formfaktoren, Fluenz, Intensitaet, Units) | alle VERIFIED (Faktoren auf 12+ Stellen) | 12/12 PASS | **PASS** |
| Strahlbreiten/M2/Fit (FWHM/D4sigma/rms, HG/LG, ISO-M2, Kaustik-Fit) | alle VERIFIED | 11/11 PASS (2 Faelle manager-ergaenzt) | **PASS** |
| Feldpropagation (Fresnel/AS, Unitaritaet, Blende, Sampling) | alle VERIFIED | 9/9 PASS | **PASS** |

Highlights: Bikonvex-Dicklinse EFL/BFL/FFL exakt 3000/59 mm gegen Lensmaker-Herleitung (Toleranz 1e-10); DFT-Leistungserhaltung beider Methoden bei 1e-12; Feld-Momenten-Radius trifft das analytische w(z) exakt; Kaustik-Fit rekonstruiert w0/z0/M2 aus synthetischen Punkten.

## 3. SUSPECT-Punkte (Doku-Follow-ups, keine Rechenfehler)

1. `paraxialCard.frontFocalLengthMm` ist eine **signierte** Distanz (negativ bei Sammellinse) — Konvention dokumentieren.
2. `paraxialCard` EFL nutzt `-1/C`, gilt exakt nur bei **Endmedium Luft** — Einschraenkung dokumentieren (alle aktuellen Nutzungen enden in Luft).
3. `dnDlambda` nutzt zentrale Differenzen statt analytischer Sellmeier-Ableitung — fuer aktuelle Genauigkeit ausreichend, Verbesserung optional.

## 4. Triage der anfaenglichen Abweichungen (alle zugunsten des Cores entschieden)

| Fall | Abweichung | Befund (Manager-Nachrechnung) |
|---|---|---|
| 3x Sellmeier-n (BK7/FS) | <4e-6 rel | Referenz war 6-stellig gerundeter Datenblattwert bei Toleranz 1e-6; Core rundet exakt auf Datenblatt. Toleranz -> 5e-6. |
| Elliptische Fluenz | 2e-8 | Worker-Rundungsfehler ab 8. Stelle; exakt 2E/(pi wx wy)=17.68388256576615 = Core. |
| Intensitaets-Kette | 8.5e-5 | Worker-Handrechnungsfehler; exakt 2.3922573861e12 = Core. |
| transformQ / waistFromQ | 2e-6 / 5e-5 | Worker auf 6 Stellen gerundet (einmal falsch gerundet); komplexe Rechnung nachvollzogen, Core exakt. |
| Feld-Momentenradius + Zylinderfall | Faktor sqrt(2) | Worker sigma/w-Konventionsfehler; nach /sqrt(2) Uebereinstimmung <3e-5. Core = analytisches w(z). |
| Blenden-Transmission a/w=0.5 | 0.49 % | Diskretisierung harter Blende; Verfeinerung dx 0.02->0.005 konvergiert monoton gegen analytisch 0.3934693. Toleranz -> 0.006. |
| Sampling-Warnings | — | Nur JSON-Schluessel-Reihenfolge; Inhalt identisch. |

Alle Korrekturen sind in den `*_cases.json` als `triage`-Felder mit Original-Worker-Wert und Begruendung dokumentiert.

## 5. Dauerhafte Absicherung

- Neues Gate **`npm run verify:cases`**: fuehrt alle 52 kuratierten Referenzfaelle gegen die Physik-Pakete aus (haerter und breiter als die bisherigen Unit-Tests allein; ergaenzt `verify:headless`).
- Die Faelle bleiben mit Herleitungs-Strings (`derivation`) und Triage-Notizen audit-faehig.

## 6. Orchestrierung-/Routing-Trail (ehrlich)

- Kosten: 5 Debatten gesamt **~0.72 USD** (0.05/0.10/0.16/0.17/0.24) + ~0.003 USD Proben; Hard-Budget 1.50 USD eingehalten, Soft-Schwelle 0.60 USD ueberschritten (bewusst akzeptiert, max-Effort-Herleitungen).
- Der fehlgeschlagene Erstanlauf kostete 0 USD (kein Provider-Call).

## 7. Handoff

Teil A ist geschlossen: Die Rechenbasis ist extern auditiert und dauerhaft regressionsgesichert. **Teil B (Beamline-gekoppelter Field-Tab mit Auswerteposition) kann starten** — Spezifikation mit dem Betreiber abgestimmt (Umschalter im Field-Tab, Default synchronisiert, freie z-Eingabe + Komponenten-Chips, bestehender Stil, N-Cap 128 nutzerseitig mit ehrlichem Kostenhinweis).
