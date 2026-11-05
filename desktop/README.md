# Saad PS2 Ultimate — Windows desktop build

This isolated Electron project builds one Windows x64 deliverable:

- **Setup EXE** — standard per-user Windows installer with desktop and Start Menu shortcuts.

The Portable EXE target has been removed. The build stages the current web files from the repository root. Electron runs with `nodeIntegration: false`, `contextIsolation: true`, sandboxing enabled, and no Node filesystem API exposed to the renderer. The app continues to use the browser File System Access API for user-authorized folders.

Build locally on Windows with Node.js 24:

```powershell
cd desktop
npm ci
npm run dist:setup
```

Output is written to `desktop/release/Saad-PS2-Setup-1.1.0.exe`. GitHub Actions performs this build automatically when desktop or web application files change, and also supports manual runs. The workflow verifies Authenticode status. A trusted publisher certificate is optional and must be provided through repository secrets; the release states whether the published file is Valid or NotSigned.


## Online artwork library

The Windows app can retrieve PS1 and PS2 cover images by validated game serial and save them persistently in Electron's per-user `userData/artwork-cache` directory. The artwork cache belongs to the Windows user profile, not the installation directory or USB drive.

Use **تنزيل الأغلفة إلى البرنامج** to populate the app library and keep covers available after disconnecting USB. Use **تحميل الناقص إلى ART** separately to convert and copy covers/icons to an OPL USB drive. Internet cover repositories do not guarantee that every regional release has an image.

The renderer receives only two narrow preload methods for artwork lookup/download. Raw IPC and Node filesystem APIs are not exposed to page scripts.


## OPL USB artwork export

Use **تنزيل الكل وحفظه في ART** after selecting the USB game device. The Windows downloader retrieves the source cover online and caches the original under the current Windows user's profile. It then writes OPL files to the USB root's `ART/` directory (not inside `CD/` or `DVD/`): `<Game_ID>_COV.jpg` at 140×200 and `<Game_ID>_ICO.png` at 64×64. Each saved file is reopened and decoded before it is counted as successful. In OPL, enable **Display Settings → Enable Cover Art** and enable the device holding the games/art. For a multi-device setup, OPL requires the ART folder on each active device. A source repository may not have artwork for every regional game release.


## Automated smoke test
Run `npm run stage` then `npm run smoke` on Windows to launch Electron and verify the UI, preload bridge, database engine and essential controls. This does not test a physical USB device or a PS2 console.
