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

// デコード / 形式
export { decode, detect, listFormats } from './format/registry.js';
export { decodeU8g2 } from './format/u8g2.js';
export { decodeGfx, packGfxContainer, unpackGfxContainer } from './format/gfxfont.js';
export { decodeGlcd } from './format/glcd.js';
export { decodeFixedBmp } from './format/fixedbmp.js';
export { decodeBmpFont } from './format/bmpfont.js';
export { decodeRleFont } from './format/rlefont.js';
export { packLegacyContainer, unpackLegacyContainer } from './format/legacy.js';

// 描画・計測
export { drawString, drawChar } from './render/draw.js';
export { textWidth, fontHeight, measureText, codepointsOf } from './render/measure.js';
export { DATUM, resolveDatum } from './render/datum.js';

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
