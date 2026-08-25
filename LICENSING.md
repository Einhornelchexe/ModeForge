# Licensing map

ModeForge uses two licenses, deliberately:

| Part | License | Why |
|---|---|---|
| Everything except `packages/image` — the web app, `packages/core`, the beamline/field/optimizer engines, the ZMX/AGF importers, docs, examples, tests outside the analyzer | **[MIT](./LICENSE)** | Solid, reusable optics tooling. Take it, keep the copyright notice. |
| `packages/image` — the single-frame beam-profile analyzer (decode, background statistics, release-gated second-moment pipeline, self-calibrating gates) | **[AGPL-3.0-or-later](./packages/image/LICENSE)**, commercial licenses available ([details](./packages/image/COMMERCIAL-LICENSE.md)) | The analyzer embodies the project's original measurement method. AGPL keeps every public derivative open; commercial terms exist for closed integration. |

Practical consequences:

- Using only the MIT parts (for example the lens/beamline engine) puts you under plain MIT.
- Building or hosting anything that includes `packages/image` puts that work under the
  AGPL — including the network-use clause — unless you obtain a commercial license.
- The ModeForge web application published by the author includes the analyzer; the
  author is the licensor, so the published site itself is simply the reference deployment.

Every file's governing license is the `LICENSE` file of the nearest enclosing directory
listed above. Contributions are accepted under the license of the part they touch.

© 2026 Patrick Feix (Rho-Labs)
