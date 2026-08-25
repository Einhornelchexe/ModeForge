// Converts decoded source pixels to the Float32 representation accepted by
// the analysis engine. Keeping this conversion shared makes main-image and
// dark-frame inputs follow exactly the same IEEE-754 rounding path.
export function toAnalysisFloat32(pixels: ArrayLike<number>): Float32Array {
  return Float32Array.from(pixels);
}
