# macOS Code Signing + Notarization — Design

**Date:** 2026-06-09
**Status:** Approved (design)

## Problem

The macOS build is unsigned. Users see *"the app is damaged and can't be opened"*
(Gatekeeper) on first launch. The current `release.yml` works around this by
instructing users to run `xattr -cr`, but the instruction references the wrong
app name (`dginxNotes.app` instead of `s3manager.app`) and requires manual user
action regardless.

## Goal

Sign the `.app` with a Developer ID Application certificate, notarize it via
Apple's notary service, and staple the notarization ticket so macOS opens the
app with **no warning and no user action**, including fully offline.

## Decisions (locked)

| Decision | Choice |
|---|---|
| Apple account | Paid Apple Developer Program (available) |
| Notary auth | App Store Connect API key (`.p8`) |
| Architecture | arm64 only (Apple Silicon) |
| Distribution format | DMG (replaces macOS ZIP) |
| Bundle ID | `de.dginx.s3manager` |
| Product / display name | `s3manager` (unchanged) |

## Out of scope (YAGNI)

- Windows / Linux signing
- Auto-update
- Universal (arm64 + x64) or Intel builds

---

## Architecture

Electron Forge drives the entire signing pipeline natively. On `npm run make`
the order is:

1. `@electron/packager` builds the `.app`.
2. `packagerConfig.osxSign` signs the `.app` with the Developer ID Application
   cert from the keychain, using the hardened runtime + custom entitlements.
3. `packagerConfig.osxNotarize` uploads the signed `.app` to Apple's notary
   service, waits for the ticket, and **staples** it to the `.app`.
4. `MakerDMG` packages the already-signed-and-stapled `.app` into a `.dmg`.

Signing/notarization only runs when signing credentials are present in the
environment. Local `npm run make` without credentials still succeeds and
produces an unsigned build — so contributors are unaffected.

---

## Components

### 1. `forge.config.ts`

- Add `appBundleId: 'de.dginx.s3manager'` to `packagerConfig`.
- Gate signing on credentials:
  ```ts
  const isSigning = !!process.env.APPLE_API_KEY_ID;
  ```
- When `isSigning`, attach:
  ```ts
  osxSign: {
    optionsForFile: () => ({ entitlements: 'build/entitlements.plist' }),
  },
  osxNotarize: {
    appleApiKey: process.env.APPLE_API_KEY!,        // path to the .p8 file
    appleApiKeyId: process.env.APPLE_API_KEY_ID!,
    appleApiIssuer: process.env.APPLE_API_ISSUER!,
  },
  ```
  When not signing, both are `undefined`.
- Hardened runtime is the default in `@electron/osx-sign` v1+; no extra flag needed.
- Makers: replace `new MakerZIP({}, ['darwin'])` with `new MakerDMG({})`. The
  ZIP maker is currently scoped **only** to darwin, so this removes ZIP output
  entirely — macOS produces a `.dmg`, and Windows/Linux are unaffected
  (Squirrel/deb/rpm). No ZIP artifact remains.
- Add dev dependency `@electron-forge/maker-dmg` (matching the `^7.11.2` line).

### 2. `build/entitlements.plist` (new file)

Hardened-runtime entitlements required by Electron and the bundled native
module:

- `com.apple.security.cs.allow-jit`
- `com.apple.security.cs.allow-unsigned-executable-memory`
- `com.apple.security.cs.disable-library-validation` — required because
  `node-sqlite3-wasm` is copied in as an external module (see the
  `packageAfterCopy` hook in `forge.config.ts`).

### 3. `release.yml` — macOS build job

New steps, macOS-only (gated on `matrix.os == 'macos-latest'` or a dedicated
job condition):

1. **Import signing cert** via `apple-actions/import-codesign-certs@v3` with
   `p12-file-base64: ${{ secrets.MACOS_CERTIFICATE }}` and
   `p12-password: ${{ secrets.MACOS_CERTIFICATE_PASSWORD }}`. This creates a
   temporary keychain and imports the cert.
2. **Materialize the API key**: decode `${{ secrets.APPLE_API_KEY }}` (base64)
   to a temp `.p8` file; export env vars `APPLE_API_KEY` (path to that file),
   `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`.
3. Run `npm run make` (now signs + notarizes + staples).
4. Update the macOS matrix `artifact` glob from `*.zip` to
   `out/make/**/*.dmg`.

### 4. Release body cleanup (`release.yml` changelog job)

- Remove the `dginxNotes.app` / `xattr -cr` workaround block — macOS builds are
  now notarized and need no workaround. (If a generic note is still wanted for
  unsigned platforms, it must not reference the wrong app name.)

---

## Required GitHub repository secrets

| Secret | Description | How to obtain |
|---|---|---|
| `MACOS_CERTIFICATE` | base64 of the exported Developer ID Application `.p12` | Export cert from Keychain Access as `.p12`, then `base64 -i cert.p12 \| pbcopy` |
| `MACOS_CERTIFICATE_PASSWORD` | password set during the `.p12` export | Chosen at export time |
| `APPLE_API_KEY` | base64 of the App Store Connect `.p8` key | Create an API key in App Store Connect → Users and Access → Integrations → App Store Connect API; `base64 -i AuthKey_XXXX.p8 \| pbcopy` |
| `APPLE_API_KEY_ID` | the key's 10-char ID | Shown next to the key in App Store Connect |
| `APPLE_API_ISSUER` | issuer UUID | Shown above the keys list in App Store Connect |

A short companion doc (or README section) will capture the exact export/encode
commands.

---

## Testing / verification

- **Local unsigned build still works**: `npm run make` with no credentials
  produces a `.dmg` without attempting to sign (no failure).
- **CI signed build**: after the workflow runs, download the `.dmg`, install,
  and confirm the app opens with no Gatekeeper warning on a clean machine
  (or verify with `spctl -a -vvv -t install /Applications/s3manager.app` →
  `accepted` / `source=Notarized Developer ID`, and
  `xcrun stapler validate /Applications/s3manager.app` → `validated`).

## Risks

- **`disable-library-validation`** weakens one hardened-runtime protection; it
  is required for the externally-copied `node-sqlite3-wasm` module to load. This
  is the standard trade-off for Electron apps loading unsigned native deps.
- **Notarization latency**: Apple's notary service can take minutes; the build
  job waits synchronously. Acceptable for a tag-triggered release.
