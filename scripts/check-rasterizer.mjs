// @ts-check
/**
 * Reports whether the optional rasterizer resolves on this platform.
 *
 * The rasterizer is a native optional dependency, so "it works" is a per-platform
 * fact rather than something the source can establish. CI runs this on every
 * runner in the matrix; run it yourself when a platform misbehaves.
 *
 *   node scripts/check-rasterizer.mjs
 *
 * Exit 0 when the binding loads, 1 when it does not. A failure prints the
 * underlying message, which is what tells apart "the package is missing" from
 * "there is no prebuilt binary for this platform".
 */
console.log(`platform : ${process.platform}/${process.arch}`);
console.log(`node     : ${process.version}`);

try {
  const canvas = await import('@napi-rs/canvas');
  // Registering and drawing is the part that actually needs the native binding;
  // importing alone can succeed while the binding is absent.
  const cv = canvas.createCanvas(8, 8);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 8, 8);
  const { data } = ctx.getImageData(0, 0, 8, 8);
  if (data[3] !== 255) throw new Error('canvas produced no ink');
  console.log('binding  : ok');
} catch (e) {
  const err = /** @type {any} */ (e);
  const kind =
    err?.code === 'ERR_MODULE_NOT_FOUND'
      ? '@napi-rs/canvas is not installed'
      : 'no prebuilt binary for this platform';
  console.log(`binding  : FAILED — ${kind}`);
  console.log(`           ${String(err?.message ?? err).split('\n')[0]}`);
  process.exitCode = 1;
}
