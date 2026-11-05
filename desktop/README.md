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


## Online artwork library

The Windows app can retrieve PS1 and PS2 cover images by validated game serial and save them persistently in Electron's per-user `userData/artwork-cache` directory. The artwork cache belongs to the Windows user profile, not the installation directory or USB drive.

Use **تنزيل الأغلفة إلى البرنامج** to populate the app library and keep covers available after disconnecting USB. Use **تحميل الناقص إلى ART** separately to convert and copy covers/icons to an OPL USB drive. Internet cover repositories do not guarantee that every regional release has an image.

The renderer receives only two narrow preload methods for artwork lookup/download. Raw IPC and Node filesystem APIs are not exposed to page scripts.
