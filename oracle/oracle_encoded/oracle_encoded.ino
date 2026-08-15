// 実物一致ハーネス（仕様 §13.3）。
//
// 本ライブラリのエンコーダが出力した u8g2 / GFXfont バイナリを
// 実物の LovyanGFX に読み込ませて描画し、正解ビットマップを吐き出す。
// 往復テスト（§13.2）では検出できない「書き方の解釈ずれ」——たとえば
// u8g2 のジャンプ表は本ライブラリのデコーダが使わないため、ここが唯一の検証——を落とす。
//
// 入力: ./fonts/*.u8g2 ／ *.gfx1（oracle/gen-encoded-fonts.js が生成）
// 出力: ./oracle-index.jsonl ＋ ./oracle-bitmaps.bin（oracle_dump と同じ形式）
#include <LovyanGFX.hpp>
#include <LGFX_AUTODETECT.hpp>

#include <stdio.h>
#include <stdint.h>
#include <string.h>
#include <stdlib.h>
#include <vector>

static LGFX_Sprite canvas;
static const int kMaxW = 600;
static const int kMaxH = 320;

// JS 側（test/oracle-encoded.test.js）の定数と一致させること。
static const char* kAscii = "Ag9 !~";
static const char* kCjk   = "日本語あア漢A9";

struct Case { const char* file; };
static const Case kCases[] = {
  { "fonts/gothic16-full.u8g2" },
  { "fonts/gothic16-subset.u8g2" },
  { "fonts/font8.u8g2" },
  { "fonts/freesans12-re.gfx1" },
  { "fonts/gothic12-cjk.gfx1" },
};

static uint8_t* readAll(const char* path, size_t* outSize)
{
  FILE* fp = fopen(path, "rb");
  if (!fp) return nullptr;
  fseek(fp, 0, SEEK_END);
  long size = ftell(fp);
  fseek(fp, 0, SEEK_SET);
  auto buf = (uint8_t*)malloc(size);
  bool ok = buf && fread(buf, 1, size, fp) == (size_t)size;
  fclose(fp);
  if (!ok) { free(buf); return nullptr; }
  *outSize = (size_t)size;
  return buf;
}

#include "gfx1_loader.h"

void setup()
{
  canvas.setColorDepth(16);
  canvas.setPsram(false);
  if (!canvas.createSprite(kMaxW, kMaxH)) { printf("FATAL createSprite failed\n"); exit(1); }

  FILE* idx = fopen("oracle-index.jsonl", "wb");
  FILE* bin = fopen("oracle-bitmaps.bin", "wb");
  if (!idx || !bin) { printf("FATAL cannot open output files\n"); exit(1); }

  long offset = 0;
  int cases = 0;

  for (size_t i = 0; i < sizeof(kCases) / sizeof(kCases[0]); ++i) {
    const char* file = kCases[i].file;
    size_t size = 0;
    uint8_t* data = readAll(file, &size);
    if (!data) { printf("FATAL cannot read %s\n", file); exit(1); }

    const lgfx::v1::IFont* font = nullptr;
    LoadedGfx gfx;
    lgfx::v1::U8g2font* u8g2 = nullptr;
    if (strstr(file, ".u8g2")) {
      u8g2 = new lgfx::v1::U8g2font(data);
      font = u8g2;
    } else {
      if (!loadGfx1(data, size, &gfx)) { printf("FATAL bad gfx1 %s\n", file); exit(1); }
      font = gfx.font;
    }

    static const float kSizes[] = { 1.0f, 1.5f };
    for (int t = 0; t < 2; ++t) {
      const char* text = (t == 0) ? kAscii : kCjk;
      for (size_t s = 0; s < sizeof(kSizes) / sizeof(kSizes[0]); ++s) {
        canvas.setFont(font);
        canvas.setTextSize(kSizes[s], kSizes[s]);
        canvas.setTextDatum((lgfx::v1::textdatum_t)0);
        canvas.setTextColor(TFT_WHITE);

        int tw = canvas.textWidth(text);
        int fh = canvas.fontHeight();
        int w = tw + 16; if (w > kMaxW) w = kMaxW; if (w < 8) w = 8;
        int h = fh + 16; if (h > kMaxH) h = kMaxH; if (h < 8) h = 8;
        int x = 4, y = 6;

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
                "{\"file\":\"%s\",\"text\":\"%s\",\"sizeX\":%g,\"sizeY\":%g,"
                "\"x\":%d,\"y\":%d,\"w\":%d,\"h\":%d,"
                "\"textWidth\":%d,\"fontHeight\":%d,\"advance\":%d,"
                "\"offset\":%ld,\"bytes\":%ld}\n",
                file, (t == 0) ? "ascii" : "cjk", kSizes[s], kSizes[s],
                x, y, w, h, tw, fh, adv, offset, bytes);
        offset += bytes;
        ++cases;
      }
    }
  }

  fclose(idx);
  fclose(bin);
  printf("DONE cases=%d bytes=%ld\n", cases, offset);
  exit(0);
}

void loop() {}
