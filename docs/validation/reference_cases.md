# ModeForge Validation Reference Cases

**Status:** active for S00-S11 headless phases.

## Required Cases

1. Free-space Gaussian propagation:
   - wavelength `1.064 um`
   - waist radius `0.5 mm`
   - radius at `z = 100 mm`
   - oracle: `w(z) = w0 * sqrt(1 + (z / zR)^2)`.

2. Thin-lens q transform:
   - matrix `[1, 0; -1/f, 1]`
   - oracle: `q_out = q / (1 - q/f)`.

3. Thick spherical lens:
   - biconvex `R1 = 50 mm`, `R2 = -50 mm`, `d = 5 mm`, `n = 1.5`
   - oracle: positive effective focal length near the lensmaker paraxial value.

4. Plane-parallel slab:
   - thickness `10 mm`, refractive index `1.5`
   - oracle: physical end position `10 mm`, ABCD `B = 10 / 1.5 mm`.

5. Material refractive index:
   - N-BK7 at the sodium d-line neighborhood.
   - oracle: Sellmeier value from built-in coefficients.

6. Pulse conversion:
   - pulse energy equals average power divided by repetition rate.
   - Gaussian peak power factor is `sqrt(4 ln 2 / pi)`.

7. S06 runtime invariants:
   - ABCD matrix entries must be finite.
   - thin-lens focal length must be finite and non-zero.
   - refractive media indices must be positive.
   - surface-stack thickness values must be finite and non-negative.
   - direct pulse helpers reject zero/negative energy, duration, repetition rate, and beam radii.
