# Fast Mode Theory Notes

Fast Mode uses paraxial ABCD matrices and Gaussian q-parameter propagation.

The ray vector convention is:

```text
[ y, theta ]^T
```

Sequential components compose as:

```text
M_total = M_n ... M_2 M_1
```

The Gaussian q parameter transforms as:

```text
q_out = (A q_in + B) / (C q_in + D)
```

The current implementation covers free space, thin lenses, slabs, thick spherical lenses, and ordered spherical surface stacks in the paraxial approximation. Aberrations, coating phase, diffraction, and non-paraxial effects are out of scope for Fast Mode.

For a plane-parallel slab in air, the physical component length remains `thicknessMm`, while the ABCD propagation term uses the reduced thickness `thicknessMm / refractiveIndex`.


## Sampling and Sign Notes (S16)

1. `zGridMm`/`envelope` sample at COMPONENT BOUNDARIES only. A waist inside a long free-space span does not appear as an array entry; the analytic exit-space waist is reported in `waists[]`, and plotting consumers should subdivide free-space spans (the web app densifies them before calling the core). This keeps the core result exact and small.
2. The aperture-margin check uses the larger of the entry and exit beam radius of a component, so entry-side clipping of a beam that focuses inside the component is caught.
3. `frontFocalLengthMm` and `backFocalLengthMm` are z-COORDINATES of the focal points relative to the front/back vertex (matrix convention D/C and -A/C): for a positive lens the front focal length is NEGATIVE (focus lies before the front vertex). Consumers expecting unsigned "focal distances" must take the absolute value.
