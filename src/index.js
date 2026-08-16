// @ts-check
/**
 * lgfx-font-tool 公開 API（仕様 §4.2）。
 */

// モデル
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

// デコード / エンコード / 形式
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

// 描画・計測
export { drawString, drawChar } from './render/draw.js';
export { textWidth, fontHeight, measureText, codepointsOf } from './render/measure.js';
export { DATUM, resolveDatum } from './render/datum.js';

// 検査
export { inspect, coverage, codepointRanges } from './inspect/inspect.js';
export { estimateSize, estimateSizes } from './inspect/estimate.js';

// 文字集合
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

// 生成（ブラウザ専用。Node で呼ぶと CapabilityError）
export { generateFont } from './gen/generate.js';
export { loadTtf, unloadTtf, rasterizeSet, measureTtf, ensureRasterizer } from './gen/rasterize.js';

// 内蔵フォントコレクション
export { fontCatalog, collectionInfo } from './fonts/catalog.js';
export { loadFont } from './fonts/loader.js';

// エラー
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
