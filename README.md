<p align="center">
  <img src="docs/assets/s3manager-logo.svg" alt="s3Manager" width="420">
</p>

<p align="center">
  A cross-platform desktop app for managing S3-compatible object storage.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Electron-42-47848F?logo=electron&logoColor=white" alt="Electron 42">
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white" alt="React 19">
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white" alt="TypeScript 5">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT License">
</p>

---

**s3Manager** is a native-feeling desktop client for browsing and managing buckets and
objects across Amazon S3, Hetzner Object Storage, and any S3-compatible provider. It
keeps your access keys in the operating-system keychain and stores everything else in a
local SQLite database — no cloud account, no telemetry.

## Features

- **Multiple accounts & providers** — Amazon S3, Hetzner Object Storage, or any custom
  S3-compatible endpoint, each with its own credentials and region.
- **File browsing** — navigate buckets, prefixes, and objects with breadcrumbs.
- **Object operations** — upload, download, delete, copy a presigned URL, move, rename,
  and create folders.
- **Presigned upload links** — generate time-limited PUT URLs for handing off uploads.
- **Metadata editor** — edit `Content-Type`, `Cache-Control`, `Content-Disposition`, and
  custom `x-amz-meta-*` headers.
- **CORS editor** — view and edit a bucket's CORS configuration as JSON.
- **Object Lock** — bucket default retention plus per-object retention and legal hold.
- **Visibility & ACLs** — toggle objects public/private and edit per-grantee ACLs.
- **Create bucket** — with Object Lock and versioning options, in the account's region.
- **Sync** — bucket ↔ bucket and local ↔ bucket, with a global status indicator.
- **Dashboard** — a scan-free, click-through overview of your accounts and buckets.

See [`docs/ROADMAP.md`](docs/ROADMAP.md) for what's shipped and what's planned.

## Tech stack

- **[Electron](https://www.electronjs.org/)** + **[Electron Forge](https://www.electronforge.io/)** (Vite plugin)
- **[React 19](https://react.dev/)** + **TypeScript** + **[Tailwind CSS 4](https://tailwindcss.com/)**
- **[TanStack Query](https://tanstack.com/query)** for data fetching/caching
- **[AWS SDK for JavaScript v3](https://github.com/aws/aws-sdk-js-v3)** (`@aws-sdk/client-s3`)
- **[node-sqlite3-wasm](https://github.com/tndrle/node-sqlite3-wasm)** for local storage
- Credentials stored in the OS keychain

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org/) 22 or newer
- npm

### Install & run

```bash
git clone https://github.com/NoiXdev/s3Manager.git
cd s3Manager
npm install
npm start
```

`npm start` launches the app in development mode with hot-reload for the renderer.

> **Note:** changes to main-process IPC handlers require a full restart of `npm start` —
> Vite only hot-reloads the renderer.

## Scripts

| Command | Description |
| --- | --- |
| `npm start` | Run the app in development mode |
| `npm test` | Run the test suite (Vitest) once |
| `npm run test:watch` | Run tests in watch mode |
| `npm run lint` | Lint with ESLint |
| `npm run package` | Package the app without creating installers |
| `npm run make` | Build distributable installers for the current platform |
| `npm run generate:icons` | Regenerate app/DMG icons from source |
| `npm run generate:licenses` | Regenerate the bundled third-party license list |

## Building

```bash
npm run make
```

Electron Forge produces platform-specific artifacts:

- **macOS** — DMG
- **Windows** — Squirrel installer
- **Linux** — `.deb` and `.rpm`

macOS code signing and notarization run automatically when the relevant Apple
credentials are present (e.g. in CI); a local `npm run make` produces an unsigned build.
See [`docs/macos-signing.md`](docs/macos-signing.md) for details.

## Project structure

```
src/
├── main/              # Electron main process
│   ├── s3/            # S3 operations (buckets, objects, sync, CORS, object lock, …)
│   ├── storage/       # SQLite database & repositories
│   ├── settings/      # App settings
│   ├── ipc/           # IPC channel definitions & handler registration
│   └── shared/        # Code shared between main and renderer
└── renderer/          # React UI
    ├── components/     # Feature components (accounts, buckets, files, sync, …)
    ├── hooks/          # TanStack Query hooks
    ├── lib/            # Renderer utilities
    └── types/          # Shared types
```

## License

[MIT](LICENSE) © NoiX
