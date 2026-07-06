# ModeForge - Plan Review v1

**Datum:** 2026-07-02.
**Status:** Diagnose-only.
**Grundlage:** `Plan/PLAN v3.md`.
**Ziel:** Audit-Trail fuer die Masterplan-Synthese, DeepSeek-Agent-Ausarbeitung und Manager-Grounding.

---

## 0. Verdikt zuerst

**Die DeepSeek-Breadth war brauchbar fuer Phasenschnitt und Detailideen, aber der Manager musste mehrere Punkte korrigieren: Stage-1-Scope, M^2/D4sigma-Definitionen, Radius-Signatur, Validierungs-Oracles und die Tatsache, dass aktuell noch keine Codepfade existieren.** Deshalb ist der neue Plan `PLAN-v1`, nicht `PLAN-READY`.

---

## 1. Worker-Agent-Trail

Alle Worker-Calls liefen ueber Orchestrierung mit `provider=deepseek`, `model=deepseek-v4-pro`, `reasoning_effort=max`.

| Agent | Rolle | Status | Kosten ca. | Ergebnis |
|---|---|---:|---:|---|
| A | Masterplan-Schnitt und Reihenfolge | ok | $0.0067 | 10-Schritt-Schnitt; gute Reihenfolge, aber ZMX/AGF zu frueh und Pulse spaet. |
| B | Core, Contracts, Validation | ok | $0.0072 | Gute Core-/Validierungsfolge; Definitionen als fruehes Gate bestaetigt. |
| C | UI, Worker, Release | ok | $0.0067 | Gute UI/Worker-Gates; Release-Scope teilweise zu breit. |
| D | Risiko/Luecken | ok | $0.0065 | Unterlieferte zuerst Meta-Schritte statt Findings. |
| E | Konkrete Gap-Findings | ok | $0.0063 | Lief konkrete HIGH/MED/LOW Findings; in Masterplan eingearbeitet. |
| F | Finaler Plan-Review | ok | $0.0102 | Unterlieferte erneut Meta-Schritte statt Findings; nicht als Befundsbasis verwendet. |

Rohantworten liegen gitignoriert unter `(privates Orchestrierungs-Verzeichnis)/planning_drafts/20260702T141419Z/`.

---

## 2. Grounding-Ergebnis

| Behauptung | Pruefung | Ergebnis |
|---|---|---|
| `Plan/PLAN v3.md` ist Ausgangsbasis. | Datei gelesen; Outline geprueft. | Belegt. |
| `apps/web`, `packages/*`, `docs/*` existieren. | Repo-Dateiliste geprueft. | Nicht belegt; Zukunftspfade aus `Plan/PLAN v3.md:1052`. |
| Orchestrierung nutzt echten DeepSeek Worker. | Usage Ledger und vorheriger Connectivity-Test. | Belegt: `deepseek-v4-pro`, echte Token/Kosten. |
| PLAN v3 verlangt static-hosting. | `Plan/PLAN v3.md:1376`. | Belegt. |
| UI darf keine Physik implementieren. | `Plan/PLAN v3.md:999` und Layer Rules. | Belegt. |
| Stage 1 soll schon Field-Propagation koennen. | Roadmap und First Release verglichen. | Nicht belegt; Stage 1 nennt statische Profile, Field Mode ist Stage 4. |

---

## 3. Findings und Manager-Adjudikation

| ID | Sev | Befund | Manager-Entscheidung |
|---|---|---|---|
| F-1 | HIGH | M^2 propagation, D4sigma und Moment-Begriffe sind in PLAN v3 nicht formal genug fuer Implementierung. | S01 wird zwingendes Definitions-Gate; S02/S05 duerfen vorher nicht starten. |
| F-2 | HIGH | Surface-stack/thick-lens braucht explizite Radius-Signatur. | S01/S03 muessen Sign convention + Tests liefern. |
| F-3 | HIGH | Optimizer-Algorithmus und Constraint-Handling sind noch zu unbestimmt. | S09 bekommt eigenen Algorithmus-/Gate-Plan; nicht in Stage-1 vermischen. |
| F-4 | HIGH | Stage 1 nennt Super-Gaussian/Top-hat, Field Mode kommt aber erst Stage 4. | Stage 1 nur statische Profile/Approximation; echte Propagation erst S11. |
| F-5 | HIGH | Datenvertraege brauchen klare Unit-Regel. | Explicit unit suffixes und Unit-Hilfstypen in S01. |
| F-6 | MED | Material-Pack-Konvertierung ist underspecified. | S12 erhaelt runtime pack schema + validation gate. |
| F-7 | MED | UI-Beschreibung braucht harte Formel-Grenze. | S06 Gate: UI zeigt nur Core-/Worker-Resultate; Formel-Scan im Review. |
| F-8 | MED | Validation strategy hat noch keine konkrete Referenzliste. | S04 eigene Validierungsphase vor Release. |
| F-9 | MED | Worker-Lifecycle und Error-Contract fehlen. | S07 typed worker API mit Progress/Error-Codes. |
| F-10 | MED | Manuelle Materialkoeffizienten brauchen Plausibilitaetschecks. | S12 UI zeigt n(lambda)-Preview und blockt nichtphysikalische Eingaben. |
| F-11 | LOW | Lizenz ist nicht entschieden. | S08 muss Lizenz/SPDX vor Public Release entscheiden. |
| F-12 | LOW | AI-assisted code policy fehlt. | S08 README/CONVENTIONS muss Originalitaet/Attribution dokumentieren. |
| F-13 | LOW | PDF/Markdown Export fuer static site braucht clientseitige Loesung. | S08 fuehrt clientseitige Exportentscheidung. |
| F-14 | LOW | Share URLs koennen zu lang werden. | S08/S07: compression oder fallback to file export. |

---

## 4. Was verworfen wurde

| Vorschlag | Grund |
|---|---|
| Full ZMX/AGF/User Library frueh in Stage 1 bauen. | Zu hoher Scope; PLAN v3 macht Lab Library zu Stage 5. S08 darf nur ein klares Import-Skeleton oder experimental ZMX enthalten. |
| Full Optimizer als First-Release-Pflicht. | PLAN v3 trennt Stage 2 Optimizer von Stage 1; First Release kann einen einfachen calculator enthalten, aber full optimizer wird S09. |
| Field Mode als Grundlage fuer Top-hat/Super-Gaussian in Stage 1. | Field Mode ist Stage 4; Stage 1 darf nur statische Visualization/Approximation zeigen. |
| UI-Agenten direkt Formeln fuer Plotwerte schreiben lassen. | Widerspricht Architekturregel aus PLAN v3. |

---

## 5. Rest-Risiken

1. M^2- und Moment-Mode-Definitionen sind fachlich empfindlich; S01 sollte vor Implementierung gegebenenfalls nochmal physikalisch cross-reviewed werden.
2. Materialdaten-Lizenzen koennen spaeter mehr Arbeit verursachen als die Parser selbst.
3. Der First-Release-Scope bleibt gross; Manager muss S08 hart gegen Feature-Creep verteidigen.
4. Field Mode darf erst starten, wenn Sampling-/Energy-Oracles definiert sind.
5. Optional backend darf keine versteckte Pflichtabhaengigkeit werden.

---

## 6. Routing-Ehrlichkeit

Dieser Review nutzt:

- DeepSeek-V4-Pro/max fuer Plan-Breadth und Gap-Findings.
- Manager-Grounding gegen lokale Repo-Dateien und `PLAN v3.md`-Outline.
- Keine zweite unabhaengige Nicht-DeepSeek-Cross-Review.
- Der finale DeepSeek-Review-Agent F wurde versucht, lieferte aber nur eine Checkliste. Dieser Output wurde nicht als Review-Finding gewertet.

Konsequenz: `PLAN-v1`, nicht `PLAN-READY`.

---

## 7. Manager-Abschlusspruefung

| Check | Ergebnis |
|---|---|
| Neue Plan-Dateien sind ASCII und Markdown-lesbar. | PASS. |
| Status-Vokabular bleibt `PLAN-v1` / `Diagnose-only`, nicht `PLAN-READY`. | PASS. |
| Zukunftspfade sind als noch nicht existierend markiert. | PASS. |
| HIGH/MED Findings aus Agent E sind im Masterplan oder Subphasenplan adressiert. | PASS. |
| Bekannte Rest-Risiken bleiben sichtbar. | PASS, siehe Abschnitt 5. |

**Doc-Version:** 1.0, 2026-07-02.
