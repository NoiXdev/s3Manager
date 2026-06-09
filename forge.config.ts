import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

// `node-sqlite3-wasm` is left external in vite.main.config.ts (it resolves its
// .wasm asset relative to its own package dir at runtime). The Vite plugin
// bundles everything else and copies no node_modules into the package, so the
// external module must be copied in by hand or `require` fails at runtime.
const EXTERNAL_MODULES = ['node-sqlite3-wasm'];

// Signing/notarization only runs when credentials are present (i.e. in CI with
// secrets). Local `npm run make` produces an unsigned build and is unaffected.
const isSigning = !!process.env.APPLE_API_KEY_ID;

const config: ForgeConfig = {
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
  rebuildConfig: {},
  hooks: {
    packageAfterCopy: async (_forgeConfig, buildPath) => {
      for (const mod of EXTERNAL_MODULES) {
        const src = join(process.cwd(), 'node_modules', mod);
        const dest = join(buildPath, 'node_modules', mod);
        mkdirSync(dirname(dest), { recursive: true });
        cpSync(src, dest, { recursive: true });
      }
    },
  },
  makers: [
    new MakerSquirrel({}),
    new MakerDMG({}),
    new MakerRpm({}),
    new MakerDeb({}),
  ],
  plugins: [
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: 'src/main.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.mts',
        },
      ],
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
