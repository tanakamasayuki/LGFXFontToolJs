# Release Procedure

[日本語版](./release.ja.md)

Publishing to npm is done **from a local machine** (no token stored in the repository; spec §16).

## Every release (copy-paste this)

Make sure main is clean (nothing uncommitted), then:

```sh
npm version patch              # patch for fixes / minor for features / major for breaking changes
npm publish --access public    # enter the 2FA code when prompted
git push --follow-tags
```

That's all. What each command runs automatically:

| Command | What runs automatically |
| --- | --- |
| `npm version <ver>` | (1) `preversion` = `npm run check` (tests, types, layer & locale lint — **the version is not created if it fails**), (2) syncs the `VERSION` constant in `src/index.js`, (3) commits and creates the `v*` tag |
| `npm publish` | `prepack` = `npm run build` + `npm run types` (builds dist and type definitions before packing) |
| `git push --follow-tags` | Pushes the commit and tag. Pages deploys automatically. release.yml does not fire (it is a manual-dispatch backup only) |

Choosing the version:

| Change | Command |
| --- | --- |
| Bug fixes / docs only | `npm version patch` |
| Backward-compatible features | `npm version minor` |
| Breaking changes (API changed/removed) | `npm version major` |

## After publishing

```sh
npm view lgfx-font-tool version
```

- CDN (may take a few minutes to propagate): <https://cdn.jsdelivr.net/npm/lgfx-font-tool/dist/lgfx-font-tool.min.js>
- npm page: <https://www.npmjs.com/package/lgfx-font-tool>

## Troubleshooting

**`403 Two-factor authentication ... is required`**
The one-time 2FA code did not reach npm. Retry with the code passed explicitly
(`npm version` already succeeded, so only the publish needs redoing):

```sh
npm publish --access public --otp=123456   # the 6 digits from your authenticator app
```

**Undo a version bump before publishing**

```sh
git reset --hard HEAD~1      # undo the commit created by npm version
git tag -d v0.1.1            # delete the tag too (adjust the number)
```

**Fix an already-published version**
Avoid `npm unpublish` (72-hour limit, version numbers cannot be reused);
land the fix and release the next version with `npm version patch`.

## One-time setup (already done)

Kept for the record; not needed again.

1. Confirmed `npm view lgfx-font-tool` returned 404 (name available)
2. `npm login` to tie this machine to the npm account
3. Enabled 2FA (authenticator app) on the npm account — current npm refuses
   to publish without 2FA or a bypass-2FA token
4. First release ran the three lines above starting from `npm version 0.1.0`
   (published as v0.1.0)

If CI-based publishing is ever wanted, register Trusted Publishing on
npmjs.com (GitHub Actions / this repository / `release.yml`) and run
[release.yml](../.github/workflows/release.yml) manually from the Actions
tab — no token required.
