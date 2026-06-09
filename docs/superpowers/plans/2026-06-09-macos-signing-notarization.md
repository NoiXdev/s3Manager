# macOS Code Signing + Notarization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make CI produce a signed, notarized, stapled macOS `.dmg` so the app opens with no Gatekeeper "damaged" warning and no user action.

**Architecture:** Electron Forge drives signing natively — `@electron/packager` signs the `.app` (`osxSign`) with the Developer ID cert from the keychain, notarizes + staples it (`osxNotarize`) via an App Store Connect API key, then `MakerDMG` packages the result. Signing only activates when credentials are in the environment, so local builds remain unsigned and unaffected. The `release.yml` macOS job imports the cert and materializes the API key before `npm run make`.

**Tech Stack:** Electron Forge 7.11 (Vite plugin), `@electron-forge/maker-dmg`, `@electron/osx-sign`, `@electron/notarize`, GitHub Actions, `apple-actions/import-codesign-certs`.

**Note on testing:** This is build/CI infrastructure — there is no unit-test harness for Forge config or signing (signing requires secrets only present in CI). Verification is done by running the real build locally (unsigned path) and by inspecting workflow/config correctness. Each task ends with a concrete verification command and a commit.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `package.json` | Declare the `@electron-forge/maker-dmg` dev dependency | Modify |
| `build/entitlements.plist` | Hardened-runtime entitlements for the signed app | Create |
| `forge.config.ts` | Bundle ID, conditional `osxSign`/`osxNotarize`, DMG maker | Modify |
| `.github/workflows/release.yml` | Import cert, materialize API key, build, upload `.dmg`; remove stale workaround note | Modify |
| `docs/macos-signing.md` | How to generate the 5 GitHub secrets | Create |

---

## Task 1: Add the DMG maker dependency

**Files:**
- Modify: `package.json` (devDependencies)

- [ ] **Step 1: Install the maker as a dev dependency**

Run:
```bash
npm install --save-dev @electron-forge/maker-dmg@^7.11.2
```
Expected: `package.json` gains `"@electron-forge/maker-dmg": "^7.11.2"` under `devDependencies`, and `package-lock.json` updates. No errors.

- [ ] **Step 2: Verify it resolves**

Run:
```bash
node -e "require('@electron-forge/maker-dmg'); console.log('ok')"
```
Expected: prints `ok`.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: add @electron-forge/maker-dmg dependency"
```

---

## Task 2: Create the entitlements file

**Files:**
- Create: `build/entitlements.plist`

- [ ] **Step 1: Create `build/entitlements.plist`**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>com.apple.security.cs.allow-jit</key>
    <true/>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
    <key>com.apple.security.cs.disable-library-validation</key>
    <true/>
  </dict>
</plist>
```

Rationale: `allow-jit` and `allow-unsigned-executable-memory` are required by V8/Electron under the hardened runtime; `disable-library-validation` is required because `node-sqlite3-wasm` is copied in as an external module (see the `packageAfterCopy` hook in `forge.config.ts`) and is not signed by our Team ID.

- [ ] **Step 2: Verify the plist is well-formed**

Run:
```bash
plutil -lint build/entitlements.plist
```
Expected: `build/entitlements.plist: OK`

(If not on macOS, skip — the file is plain XML and will be validated by codesign in CI.)

- [ ] **Step 3: Commit**

```bash
git add build/entitlements.plist
git commit -m "build: add hardened-runtime entitlements for macOS signing"
```

---

## Task 3: Wire signing + DMG into forge.config.ts

**Files:**
- Modify: `forge.config.ts`

- [ ] **Step 1: Swap the maker import**

Replace this line:
```ts
import { MakerZIP } from '@electron-forge/maker-zip';
```
with:
```ts
import { MakerDMG } from '@electron-forge/maker-dmg';
```

- [ ] **Step 2: Add the signing gate above the config object**

Immediately before `const config: ForgeConfig = {`, add:
```ts
// Signing/notarization only runs when credentials are present (i.e. in CI with
// secrets). Local `npm run make` produces an unsigned build and is unaffected.
const isSigning = !!process.env.APPLE_API_KEY_ID;
```

- [ ] **Step 3: Extend `packagerConfig`**

Replace:
```ts
  packagerConfig: {
    asar: true,
  },
```
with:
```ts
  packagerConfig: {
    asar: true,
    appBundleId: 'de.dginx.s3manager',
    osxSign: isSigning
      ? {
          optionsForFile: () => ({ entitlements: 'build/entitlements.plist' }),
        }
      : undefined,
    osxNotarize: isSigning
      ? {
          appleApiKey: process.env.APPLE_API_KEY as string,
          appleApiKeyId: process.env.APPLE_API_KEY_ID as string,
          appleApiIssuer: process.env.APPLE_API_ISSUER as string,
        }
      : undefined,
  },
```

- [ ] **Step 4: Swap the macOS maker**

In the `makers` array, replace:
```ts
    new MakerZIP({}, ['darwin']),
```
with:
```ts
    new MakerDMG({}),
```

- [ ] **Step 5: Type-check the config**

Run:
```bash
npx tsc --noEmit -p tsconfig.json
```
Expected: no errors. (If `tsconfig.json` is not set up for standalone check, run `npm run lint` instead and confirm `forge.config.ts` has no errors.)

- [ ] **Step 6: Commit**

```bash
git add forge.config.ts
git commit -m "build: sign/notarize macOS app and build DMG via Electron Forge"
```

---

## Task 4: Verify the unsigned local build still works

**Files:** none (verification only)

- [ ] **Step 1: Run a full local make with no signing credentials**

Run (on macOS):
```bash
unset APPLE_API_KEY_ID APPLE_API_KEY APPLE_API_ISSUER
npm run make
```
Expected: build completes, no attempt to notarize, and a `.dmg` is produced.

- [ ] **Step 2: Confirm the DMG artifact exists**

Run:
```bash
ls out/make/**/*.dmg
```
Expected: at least one `.dmg` path is listed (e.g. `out/make/s3manager-1.0.0-arm64.dmg`).

- [ ] **Step 3: No commit** (verification only — nothing changed).

---

## Task 5: Add signing steps to the release workflow

**Files:**
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: Update the macOS artifact glob**

In the `build` job `matrix.include`, change the macOS entry from:
```yaml
          - name: macOS (Apple Silicon)
            os: macos-latest
            artifact: out/make/**/*.zip
```
to:
```yaml
          - name: macOS (Apple Silicon)
            os: macos-latest
            artifact: out/make/**/*.dmg
```

- [ ] **Step 2: Insert cert + credential steps before "Build distributables"**

In the `build` job `steps`, immediately **before** the `- name: Build distributables` step, insert:
```yaml
      - name: Import signing certificate (macOS)
        if: matrix.os == 'macos-latest'
        uses: apple-actions/import-codesign-certs@v3
        with:
          p12-file-base64: ${{ secrets.MACOS_CERTIFICATE }}
          p12-password: ${{ secrets.MACOS_CERTIFICATE_PASSWORD }}

      - name: Prepare notarization credentials (macOS)
        if: matrix.os == 'macos-latest'
        run: |
          echo "${{ secrets.APPLE_API_KEY }}" | base64 --decode > "$RUNNER_TEMP/apple_api_key.p8"
          echo "APPLE_API_KEY=$RUNNER_TEMP/apple_api_key.p8" >> "$GITHUB_ENV"
          echo "APPLE_API_KEY_ID=${{ secrets.APPLE_API_KEY_ID }}" >> "$GITHUB_ENV"
          echo "APPLE_API_ISSUER=${{ secrets.APPLE_API_ISSUER }}" >> "$GITHUB_ENV"
```

These run only on the macOS runner. The exported env vars cause `forge.config.ts`'s `isSigning` to be `true`, activating sign + notarize.

- [ ] **Step 3: Verify the workflow YAML parses**

Run:
```bash
python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/release.yml')); print('yaml ok')"
```
Expected: `yaml ok`

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: sign and notarize the macOS build in release workflow"
```

---

## Task 6: Remove the stale "app is damaged" workaround note

**Files:**
- Modify: `.github/workflows/release.yml` (the `changelog` job's "Assemble release body" step)

- [ ] **Step 1: Replace the "Assemble release body" step**

Replace the entire step:
```yaml
      - name: Assemble release body
        run: |
          cat RELEASE_NOTES.md > release_body.md
          cat >> release_body.md <<'EOF'

          ---
          > **macOS users:** if you see *"the app is damaged and can't be opened"*, run this once in Terminal after moving the app to Applications:
          > ```
          > xattr -cr /Applications/dginxNotes.app
          > ```
          EOF
```
with:
```yaml
      - name: Assemble release body
        run: cp RELEASE_NOTES.md release_body.md
```

Rationale: the macOS build is now notarized, so the workaround is obsolete. (It also referenced the wrong app name, `dginxNotes.app`.)

- [ ] **Step 2: Verify the workflow YAML still parses**

Run:
```bash
python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/release.yml')); print('yaml ok')"
```
Expected: `yaml ok`

- [ ] **Step 3: Confirm the stale name is gone**

Run:
```bash
grep -c "dginxNotes" .github/workflows/release.yml || echo "0 matches"
```
Expected: `0 matches`

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: drop obsolete macOS xattr workaround from release notes"
```

---

## Task 7: Document the required secrets

**Files:**
- Create: `docs/macos-signing.md`

- [ ] **Step 1: Create `docs/macos-signing.md`**

```markdown
# macOS Code Signing & Notarization

CI signs and notarizes the macOS build automatically. It needs five GitHub
repository secrets (Settings → Secrets and variables → Actions).

## 1. Developer ID Application certificate

In **Keychain Access** on a Mac where the cert is installed:

1. Find **Developer ID Application: <Your Name/Team>** under *My Certificates*.
2. Right-click → **Export** → save as `cert.p12`, set a password.
3. Base64-encode it:
   ```bash
   base64 -i cert.p12 | pbcopy
   ```

- `MACOS_CERTIFICATE` — the base64 string from above.
- `MACOS_CERTIFICATE_PASSWORD` — the password you set during export.

## 2. App Store Connect API key

In **App Store Connect → Users and Access → Integrations → App Store Connect API**:

1. Create a key with the **Developer** role (or higher). Download the
   `AuthKey_XXXXXXXXXX.p8` (downloadable only once).
2. Base64-encode it:
   ```bash
   base64 -i AuthKey_XXXXXXXXXX.p8 | pbcopy
   ```

- `APPLE_API_KEY` — the base64 string from above.
- `APPLE_API_KEY_ID` — the 10-character Key ID shown next to the key.
- `APPLE_API_ISSUER` — the Issuer ID (UUID) shown above the keys list.

## Verifying a release

After a tagged release builds, download the `.dmg`, install the app, then:

```bash
spctl -a -vvv -t install /Applications/s3manager.app   # => accepted, source=Notarized Developer ID
xcrun stapler validate /Applications/s3manager.app     # => The validate action worked!
```

## Local builds

`npm run make` with none of the above env vars set produces an **unsigned**
build (no signing attempted). Signing activates only when `APPLE_API_KEY_ID`
is present in the environment.
```

- [ ] **Step 2: Commit**

```bash
git add docs/macos-signing.md
git commit -m "docs: document macOS signing secrets and verification"
```

---

## Final verification (after merge + first signed release)

These cannot be checked locally — they require the secrets and a tagged release:

1. Push a `v*.*.*` tag (or run the workflow via `workflow_dispatch`).
2. Confirm the macOS build job runs the "Import signing certificate" and
   "Prepare notarization credentials" steps and that `npm run make` logs a
   notarization submission that succeeds.
3. Download the released `.dmg`, install on a clean Mac, and confirm it opens
   with **no** Gatekeeper warning.
4. Run the `spctl` / `stapler` checks from `docs/macos-signing.md`.
