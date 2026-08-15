// @ts-check
/**
 * オラクルハーネスの実行ランチャー。
 *
 * lang-ship:host の実行ファイルはランチャーとして起動し、子プロセスが
 * 最初の TCP クライアント接続を待ってから setup() に入る。
 * このスクリプトが起動→接続→完了待ちまでを面倒みる。
 *
 * 使い方: node oracle/run-oracle.js <実行ファイル> [出力ディレクトリ]
 * 出力: 指定ディレクトリ（既定 test/fixtures/oracle/）に
 *       oracle-index.jsonl と oracle-bitmaps.bin
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { connect } from 'node:net';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const exe = process.argv[2];
if (!exe) {
  console.error('usage: node oracle/run-oracle.js <harness.out> [out-dir]');
  process.exit(1);
}

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.argv[3]
  ? resolve(process.argv[3])
  : join(repoRoot, 'test', 'fixtures', 'oracle');
mkdirSync(outDir, { recursive: true });

const launcher = spawn(exe, [], { cwd: outDir });

/** @type {string} */
let stdout = '';
launcher.stdout.on('data', (d) => {
  stdout += String(d);
});

launcher.on('exit', () => {
  const m = /HOST_ARDUINO_PORT=(\d+)/.exec(stdout);
  if (!m) {
    console.error('launcher did not print HOST_ARDUINO_PORT:\n' + stdout);
    process.exit(1);
  }
  const port = Number(m[1]);
  console.log(`connecting to child on port ${port} ...`);
  const sock = connect(port, '127.0.0.1');
  let buf = '';
  const timer = setTimeout(() => {
    console.error('timeout waiting for DONE');
    sock.destroy();
    process.exit(1);
  }, 600000);
  sock.on('data', (d) => {
    buf += String(d);
    process.stdout.write(String(d));
    if (buf.includes('DONE') || buf.includes('FATAL')) {
      clearTimeout(timer);
      sock.destroy();
      process.exit(buf.includes('FATAL') ? 1 : 0);
    }
  });
  const finish = (/** @type {string} */ why) => {
    clearTimeout(timer);
    // スケッチは完了時に exit(0) するため、DONE の受信前に接続が切れることがある。
    // 出力ファイルの検証はテスト側が行うので、切断は成功として扱う。
    console.log(`\nchild ${why}`);
    process.exit(0);
  };
  sock.on('error', (err) => finish(`disconnected (${err.message})`));
  sock.on('close', () => finish('closed'));
});
