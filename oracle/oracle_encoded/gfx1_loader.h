// GFX1 コンテナのローダ（.ino の自動プロトタイプ生成を避けるため分離）。
#pragma once
#include <LovyanGFX.hpp>
#include <stdint.h>
#include <string.h>
#include <vector>

// 'GFX1' コンテナ（本ライブラリ定義。src/format/gfxfont.js 参照）を
// LovyanGFX の GFXfont 構造体へ実行時に組み立てる。
struct LoadedGfx {
  std::vector<uint8_t> bitmap;
  std::vector<lgfx::v1::GFXglyph> glyphs;
  std::vector<lgfx::v1::EncodeRange> ranges;
  lgfx::v1::GFXfont* font = nullptr;
};

static uint16_t rd16(const uint8_t* p) { return (uint16_t)(p[0] | (p[1] << 8)); }
static uint32_t rd32(const uint8_t* p)
{
  return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}

static bool loadGfx1(const uint8_t* data, size_t size, LoadedGfx* out)
{
  if (size < 15 || memcmp(data, "GFX1", 4) != 0) return false;
  size_t pos = 4;
  uint16_t first = rd16(&data[pos]); pos += 2;
  uint16_t last  = rd16(&data[pos]); pos += 2;
  uint8_t yAdvance = data[pos]; pos += 1;
  uint16_t rangeCount = rd16(&data[pos]); pos += 2;
  out->ranges.resize(rangeCount);
  for (uint16_t i = 0; i < rangeCount; ++i) {
    out->ranges[i].start = rd16(&data[pos]); pos += 2;
    out->ranges[i].end   = rd16(&data[pos]); pos += 2;
    out->ranges[i].base  = rd16(&data[pos]); pos += 2;
  }
  uint32_t glyphCount = rd32(&data[pos]); pos += 4;
  out->glyphs.resize(glyphCount);
  for (uint32_t i = 0; i < glyphCount; ++i) {
    out->glyphs[i].bitmapOffset = rd32(&data[pos]); pos += 4;
    out->glyphs[i].width    = data[pos++];
    out->glyphs[i].height   = data[pos++];
    out->glyphs[i].xAdvance = data[pos++];
    out->glyphs[i].xOffset  = (int8_t)data[pos++];
    out->glyphs[i].yOffset  = (int8_t)data[pos++];
  }
  uint32_t bitmapLen = rd32(&data[pos]); pos += 4;
  if (pos + bitmapLen > size) return false;
  out->bitmap.assign(&data[pos], &data[pos + bitmapLen]);
  out->font = new lgfx::v1::GFXfont(
      out->bitmap.data(), out->glyphs.data(), first, last, yAdvance,
      rangeCount, rangeCount ? out->ranges.data() : nullptr);
  return true;
}
