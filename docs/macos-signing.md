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
