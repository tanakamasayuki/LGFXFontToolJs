# LGFX Font Tool JS

**JavaScript toolkit for embedded bitmap fonts — decode, encode, convert, render and generate.**

[日本語 README](./README.ja.md) · [Specification (ja)](./docs/spec.ja.md)

Decoders and encoders for u8g2 / GFXfont (Adafruit GFX) / BDF / VLW / LovyanGFX internal
formats, a text rendering engine that matches LovyanGFX pixel-for-pixel, and a bundled
collection of all 186 fonts built into LovyanGFX v1.2.26.

**Status: Phase 1 under construction.** See [docs/spec.ja.md](./docs/spec.ja.md) for the
specification (Japanese; English version will follow once it stabilizes).

## Development

```sh
npm install
npm run check          # tests + typecheck + layer lint
npm test               # node:test (includes the oracle exact-match suite)
npm run serve          # Viewer at http://localhost:8080/web/, samples at /examples/
npm run build:site     # site/ (what GitHub Pages serves)
npm run extract-fonts  # re-extract bundled fonts from LovyanGFX sources
npm run oracle         # regenerate oracle fixtures with a native LovyanGFX build
```

Rendering correctness is guaranteed by byte-exact comparison against 1,860 cases
drawn by the real LovyanGFX (built natively with the lang-ship:host core) —
see [oracle/](./oracle/README.ja.md).

## License

MIT. See [LICENSE](./LICENSE).
Attribution for bundled font data lives in [NOTICE](./NOTICE).
