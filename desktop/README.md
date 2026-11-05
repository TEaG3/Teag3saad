# Saad PS2 Ultimate — Windows desktop build

This isolated Electron project builds one Windows x64 deliverable:

- **Setup EXE** — standard per-user Windows installer with desktop and Start Menu shortcuts.

The Portable EXE target has been removed. The build stages the current web files from the repository root. Electron runs with `nodeIntegration: false`, `contextIsolation: true`, sandboxing enabled, and no Node filesystem API exposed to the renderer. The app continues to use the browser File System Access API for user-authorized folders.

Build locally on Windows with Node.js 22:

```powershell
cd desktop
npm install
npm run dist:setup
```

Output is written to `desktop/release/Saad-PS2-Setup-1.0.0.exe`. GitHub Actions performs this build automatically when desktop or web application files change, and also supports manual runs. This binary is not code-signed; Windows SmartScreen may show an unknown-publisher warning until a trusted code-signing certificate is configured.
