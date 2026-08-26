# リリース手順

[English](./release.en.md)

npm への公開は**手元のマシンから**行います(トークンをリポジトリに置かない。仕様 §16)。

## 毎回のリリース(これをコピペ)

main がクリーン(コミット漏れなし)で、[CHANGELOG.md](../CHANGELOG.md) の
`Unreleased` に英日両方の変更内容が書けていることを確認してから:

```sh
npm version patch              # fix なら patch / 機能追加なら minor / 破壊的変更なら major
npm publish --access public    # 2FA のコードを聞かれたら入力
git push --follow-tags
```

これだけです。各コマンドが自動でやること:

| コマンド | 自動で走るもの |
| --- | --- |
| `npm version <ver>` | ①`preversion` = `npm run check` + 変更履歴の空チェック(**失敗するとバージョンは作られない**) ②`VERSION`、CDN の固定バージョン、変更履歴の版見出しを同期 ③コミット + `v*` タグ作成 |
| `npm publish` | `prepack` = `npm run build` + `npm run types`(dist と型定義を作ってから梱包) |
| `git push --follow-tags` | コミットとタグを push。Pages が自動デプロイ。release.yml は発火しない(手動実行専用の予備) |

バージョンの選び方:

| 変更内容 | コマンド |
| --- | --- |
| バグ修正・ドキュメントのみ | `npm version patch` |
| 後方互換の機能追加 | `npm version minor` |
| 破壊的変更(API の変更・削除) | `npm version major` |

変更履歴は英日1ファイルです。各項目を `- (EN)` と `- (JA)` の2行で
`## Unreleased` の下に追加します。`npm version` が新しい版の見出しへ移すため、
日付は持ちません。README とガイドにある `lgfx-font-tool@<version>` も同時に更新されます。

## 公開後の確認

```sh
npm view lgfx-font-tool version
```

- CDN(反映まで数分かかることがある): <https://cdn.jsdelivr.net/npm/lgfx-font-tool@1.1.0/dist/lgfx-font-tool.min.js>
- npm ページ: <https://www.npmjs.com/package/lgfx-font-tool>

## 困ったとき

**`403 Two-factor authentication ... is required`**
2FA のワンタイムコードが渡っていません。コードを明示して再実行します
(`npm version` は済んでいるので publish だけやり直せば OK):

```sh
npm publish --access public --otp=123456   # 6桁は認証アプリの現在値
```

**publish する前にバージョンを取り消したい**

```sh
git reset --hard HEAD~1      # npm version が作ったコミットを取り消す
git tag -d v0.1.1            # タグも消す(番号は読み替え)
```

**publish してしまった版を直したい**
`npm unpublish` は原則使わず(72 時間制限・再利用不可の縛りがある)、
修正を入れて `npm version patch` で次の版を出します。

## 初回だけの準備(設定済み)

記録として残します。2 回目以降は不要です。

1. `npm view lgfx-font-tool` が 404(名前が空いている)ことを確認
2. `npm login` でこのマシンを npm アカウントに紐付け
3. npm アカウントの 2FA(認証アプリ)を有効化 — 現在の npm は
   「2FA または 2FA バイパス付きトークン」なしでは publish できない
4. 初回のみ `npm version 0.1.0` から上の 3 行を実行(v0.1.0 として公開済み)

CI から公開したくなった場合は、npmjs.com のパッケージ設定で
Trusted Publishing(GitHub Actions / このリポジトリ / `release.yml`)を
登録すると、トークンなしで Actions タブから
[release.yml](../.github/workflows/release.yml) を手動実行できます。
