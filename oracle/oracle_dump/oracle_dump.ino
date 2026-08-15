// オラクルハーネス（仕様 §13.1）。
//
// 実物の LovyanGFX（lang-ship:host コアでネイティブビルド）で
// 全内蔵フォント × 文字列 × 倍率 × datum を 1bpp 相当（透過・白文字）で描画し、
// JS 実装が完全一致すべき正解ビットマップを吐き出す。
//
// 出力（カレントディレクトリ）:
//   oracle-index.jsonl   1 ケース 1 行（パラメータ・計測値・bin 内オフセット）
//   oracle-bitmaps.bin   MSB first・行はバイト境界パディングの 1bpp を連結
//
// 実行: npm run oracle （ビルドと実行、fixture への配置まで行う）
#include <LovyanGFX.hpp>
#include <LGFX_AUTODETECT.hpp>
#include "fonts_table.h"

#include <stdio.h>
#include <stdint.h>
#include <string.h>
#include <stdlib.h>

static LGFX_Sprite canvas;
static const int kMaxW = 600;
static const int kMaxH = 320;

struct Config {
  float sx;
  float sy;
  int datum;
  bool alsoCjk; // この構成を CJK 文字列でも回すか
};

// datum: 0=top-left 16=baseline-left 5=middle-center 10=bottom-right
static const Config kConfigs[] = {
  { 1.0f, 1.0f,  0, true  },
  { 1.0f, 1.0f, 16, false },
  { 1.0f, 1.0f,  5, false },
  { 2.0f, 2.0f,  0, true  },
  { 2.0f, 1.0f,  0, false },
  { 1.5f, 1.5f,  0, true  },
  { 1.5f, 1.5f, 10, false },
};

// JS 側（test/oracle.test.js）の定数と一致させること。
static const char* kAscii = "Ag9 !~";
static const char* kCjk   = "日本語あア漢A9";

void setup()
{
  canvas.setColorDepth(16);
  canvas.setPsram(false);
  if (!canvas.createSprite(kMaxW, kMaxH)) {
    printf("FATAL createSprite failed\n");
    exit(1);
  }

  FILE* idx = fopen("oracle-index.jsonl", "wb");
  FILE* bin = fopen("oracle-bitmaps.bin", "wb");
  if (!idx || !bin) {
    printf("FATAL cannot open output files\n");
    exit(1);
  }

  long offset = 0;
  int cases = 0;

  for (size_t i = 0; i < kFontCount; ++i) {
    const FontEntry& e = kFonts[i];
    for (size_t c = 0; c < sizeof(kConfigs) / sizeof(kConfigs[0]); ++c) {
      const Config& cf = kConfigs[c];
      for (int t = 0; t < (cf.alsoCjk ? 2 : 1); ++t) {
        const char* text = (t == 0) ? kAscii : kCjk;

        canvas.setFont(e.font);
        canvas.setTextSize(cf.sx, cf.sy);
        canvas.setTextDatum((lgfx::v1::textdatum_t)cf.datum);
        canvas.setTextColor(TFT_WHITE); // fore == back → 透過モード

        int tw = canvas.textWidth(text);
        int fh = canvas.fontHeight();

        int w = tw + 16;
        if (w > kMaxW) w = kMaxW;
        if (w < 8) w = 8;
        int h = fh + 16;
        if (h > kMaxH) h = kMaxH;
        if (h < 8) h = 8;

        int x, y;
        switch (cf.datum) {
          case 16: x = 4;     y = (h * 2) / 3; break;
          case  5: x = w / 2; y = h / 2;       break;
          case 10: x = w - 4; y = h - 4;       break;
          default: x = 4;     y = 6;           break;
        }

        canvas.fillScreen(TFT_BLACK);
        int adv = (int)canvas.drawString(text, x, y);

        int stride = (w + 7) >> 3;
        uint8_t row[(kMaxW + 7) >> 3];
        for (int yy = 0; yy < h; ++yy) {
          memset(row, 0, stride);
          for (int xx = 0; xx < w; ++xx) {
            if (canvas.readPixel(xx, yy)) row[xx >> 3] |= 0x80 >> (xx & 7);
          }
          fwrite(row, 1, stride, bin);
        }
        long bytes = (long)stride * h;

        fprintf(idx,
                "{\"font\":\"%s\",\"text\":\"%s\",\"sizeX\":%g,\"sizeY\":%g,"
                "\"datum\":%d,\"x\":%d,\"y\":%d,\"w\":%d,\"h\":%d,"
                "\"textWidth\":%d,\"fontHeight\":%d,\"advance\":%d,"
                "\"offset\":%ld,\"bytes\":%ld}\n",
                e.name, (t == 0) ? "ascii" : "cjk", cf.sx, cf.sy,
                cf.datum, x, y, w, h, tw, fh, adv, offset, bytes);
        offset += bytes;
        ++cases;
      }
    }
    if ((i % 16) == 0) printf("PROGRESS %u/%u\n", (unsigned)i, (unsigned)kFontCount);
  }

  fclose(idx);
  fclose(bin);
  printf("DONE cases=%d bytes=%ld\n", cases, offset);
  exit(0);
}

void loop() {}
