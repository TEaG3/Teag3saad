# Saad PS2 Ultimate — Windows desktop build

This isolated Electron project packages the existing web app into two Windows x64 deliverables:

- **Portable EXE** — runs without a conventional installation.
- **Setup EXE** — standard per-user Windows installer.

The build stages the current web files from the repository root. Electron runs with `nodeIntegration: false`, `contextIsolation: true`, sandboxing enabled, and no Node filesystem API exposed to the renderer. The app continues to use the browser File System Access API for user-authorized folders.

Build locally on Windows with Node.js 22:

```powershell
cd desktop
npm install
npm run dist:win
```

Outputs are written to `desktop/release/`. GitHub Actions performs this build automatically when desktop or web application files change, and also supports manual runs. These binaries are not code-signed; Windows SmartScreen may show an unknown-publisher warning until a trusted code-signing certificate is configured.
