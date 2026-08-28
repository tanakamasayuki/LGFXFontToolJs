// @ts-check
/**
 * Public lgfx-font-tool API (spec §4.2).
 */

// Model
export { createFont, getGlyph } from './model/font.js';
export {
  createBitmap,
  getPixel,
  setPixel,
  fillRect,
  bitmapEquals,
  bitmapToText,
} from './model/bitmap.js';
export { subset, merge } from './model/subset.js';
export { serializeFont, deserializeFont } from './model/serialize.js';

// Decode / encode / formats
export { decode, detect, listFormats, canEncode, encode } from './format/registry.js';
export { decodeU8g2, encodeU8g2, canEncodeU8g2 } from './format/u8g2.js';
export {
  decodeGfx,
  encodeGfx,
  canEncodeGfx,
  packGfxContainer,
  unpackGfxContainer,
} from './format/gfxfont.js';
export { decodeBdf, encodeBdf, canEncodeBdf } from './format/bdf.js';
export { decodeVlw, encodeVlw, canEncodeVlw } from './format/vlw.js';
export { decodeBff, encodeBff, canEncodeBff } from './format/bff.js';
export {
  decodeFontx2,
  encodeFontx2,
  canEncodeFontx2,
  sjisToUnicode,
  unicodeToSjis,
} from './format/fontx2.js';
export {
  encodeCSource,
  decodeCSource,
  sanitizeIdent,
  licenseNotice,
  summarizeRanges,
} from './format/csource.js';
export { decodeGlcd } from './format/glcd.js';
export { decodeFixedBmp } from './format/fixedbmp.js';
export { decodeBmpFont } from './format/bmpfont.js';
export { decodeRleFont } from './format/rlefont.js';
export { packLegacyContainer, unpackLegacyContainer } from './format/legacy.js';

// Drawing / measurement
export { drawString, drawChar } from './render/draw.js';
export { textWidth, fontHeight, measureText, codepointsOf } from './render/measure.js';
export { DATUM, resolveDatum } from './render/datum.js';

// Inspection
export { inspect, coverage, codepointRanges } from './inspect/inspect.js';
export { estimateSize, estimateSizes } from './inspect/estimate.js';

// Character sets
export {
  parseRanges,
  codepointsOfSet,
  resolveCharset,
  toggleSet,
  splitBmp,
  countOf,
  tierSiblings,
  AXES,
  TEMPLATES,
  templateById,
  ALL_SET_IDS,
} from './charsets/charsets.js';

// Generation (browser-only; calling from Node throws CapabilityError)
export { generateFont } from './gen/generate.js';
export { loadTtf, unloadTtf, rasterizeSet, ensureRasterizer } from './gen/rasterize.js';

// Bundled font collection
export { fontCatalog, collectionInfo } from './fonts/catalog.js';
export { loadFont, configureFontData, fontDataCandidates } from './fonts/loader.js';

// Errors
export {
  FontToolError,
  FormatError,
  TruncatedDataError,
  DetectFailedError,
  UnsupportedFeatureError,
  EncodeConstraintError,
  CapabilityError,
  CollectionError,
} from './util/errors.js';

// Updated by scripts/sync-version.js during npm version.
export const VERSION = '3.0.0';
