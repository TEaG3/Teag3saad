"use strict";
const { app, BrowserWindow, shell, protocol, ipcMain } = require("electron");
const https = require("node:https");
const path = require("node:path");
const fs = require("node:fs/promises");
const smokeTest = process.argv.includes("--smoke-test");
const smokeErrors = [];

protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#080d18",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });
  window.webContents.on("console-message", (_event, details) => {
    if (smokeTest && Number(details?.level) >= 3) {
      smokeErrors.push(String(details.message || "Renderer console error"));
    }
  });
  window.webContents.once("did-fail-load", (_event, code, description) => {
    if (smokeTest) {
      console.error("SMOKE FAIL: page load", code, description);
      app.exit(1);
    }
  });
  window.once("ready-to-show", async () => {
    window.show();
    if (!smokeTest) return;
    try {
      const result = await window.webContents.executeJavaScript(
        '({title:document.title,database:!!window.PS2Database,desktop:window.saadDesktop?.isDesktop===true,downloadLinkHidden:!document.getElementById("downloadWindowsApp"),library:!!document.getElementById("library"),usbTest:!!document.getElementById("runUsbTest"),artwork:!!document.getElementById("downloadToApp")})'
      );
      const passed = result.title === "Saad PS2 Ultimate" &&
        result.database && result.desktop && result.downloadLinkHidden &&
        result.library && result.usbTest && result.artwork && smokeErrors.length === 0;
      console.log(passed ? "SMOKE PASS: desktop UI, preload, database and controls loaded." :
        "SMOKE FAIL: " + JSON.stringify({ result, consoleErrors: smokeErrors }));
      app.exit(passed ? 0 : 1);
    } catch (error) {
      console.error("SMOKE FAIL:", error);
      app.exit(1);
    }
  });
  if (smokeTest) setTimeout(() => {
    console.error("SMOKE FAIL: timed out while loading the desktop UI.");
    app.exit(1);
  }, 25000);
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) shell.openExternal(url);
    return { action: "deny" };
  });
  window.loadURL("app://saad/index.html");
}

function validateArtworkRequest(value) {
  if (!value || typeof value !== "object") throw new Error("طلب صورة غير صالح.");
  const platform = value.platform === "ps1" ? "ps1" : value.platform === "ps2" ? "ps2" : null;
  const serial = String(value.serial || "").toUpperCase();
  if (!platform || !/^[A-Z0-9]{4}-[0-9]{5}$/.test(serial)) {
    throw new Error("منصة اللعبة أو رقمها التسلسلي غير صالح.");
  }
  return { platform, serial };
}

function artworkFile(platform, serial) {
  const folder = path.join(app.getPath("userData"), "artwork-cache");
  return { folder, file: path.join(folder, platform.toUpperCase() + "-" + serial + ".jpg") };
}

function artworkUrl(platform, serial) {
  const repository = platform === "ps1" ? "psx-covers" : "ps2-covers";
  return "https://raw.githubusercontent.com/xlenore/" + repository + "/main/covers/default/" + encodeURIComponent(serial) + ".jpg";
}

function isJpeg(bytes) {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function fetchArtworkResponse(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 4) return reject(new Error("Too many redirects"));
    const target = new URL(url);
    if (target.protocol !== "https:") return reject(new Error("HTTPS required"));
    const request = https.get(target, {
      headers: { "User-Agent": "Saad-PS2-Ultimate/1.3", "Accept": "image/jpeg,image/*;q=0.8" },
      timeout: 15000
    }, (response) => {
      const status = Number(response.statusCode || 0);
      if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
        response.resume();
        return fetchArtworkResponse(new URL(response.headers.location, target).toString(), redirects + 1).then(resolve, reject);
      }
      const chunks = [];
      let size = 0;
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size > 10 * 1024 * 1024) {
          request.destroy(new Error("Artwork is too large"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => resolve({ status, headers: response.headers, bytes: Buffer.concat(chunks) }));
      response.on("error", reject);
    });
    request.on("timeout", () => request.destroy(new Error("Request timed out")));
    request.on("error", reject);
  });
}

async function readCachedArtwork(value) {
  const { platform, serial } = validateArtworkRequest(value);
  const { file } = artworkFile(platform, serial);
  try {
    const bytes = await fs.readFile(file);
    if (!isJpeg(bytes)) return { ok: false, error: "ملف الغلاف المخزن غير صالح." };
    return { ok: true, platform, serial, mimeType: "image/jpeg", size: bytes.length, dataUrl: "data:image/jpeg;base64," + bytes.toString("base64"), cached: true };
  } catch (error) {
    if (error.code === "ENOENT") return { ok: false, missing: true };
    throw error;
  }
}

async function downloadArtwork(value) {
  const { platform, serial } = validateArtworkRequest(value);
  const cached = await readCachedArtwork({ platform, serial });
  if (cached.ok) return cached;

  const url = artworkUrl(platform, serial);
  try {
    const response = await fetchArtworkResponse(url);
    if (response.status < 200 || response.status >= 300) {
      return { ok: false, missing: response.status === 404, status: response.status, error: response.status === 404 ? "لا توجد صورة لهذا الرقم في قاعدة الصور." : "تعذر تنزيل صورة اللعبة." };
    }
    const contentType = String(response.headers["content-type"] || "").toLowerCase();
    if (!contentType.startsWith("image/")) return { ok: false, error: "تعذر تنزيل صورة اللعبة." };
    const bytes = response.bytes;
    if (!bytes.length || bytes.length > 10 * 1024 * 1024 || !isJpeg(bytes)) return { ok: false, error: "تعذر تنزيل صورة اللعبة." };
    const { folder, file } = artworkFile(platform, serial);
    await fs.mkdir(folder, { recursive: true });
    const temporary = file + ".tmp";
    await fs.writeFile(temporary, bytes);
    await fs.rename(temporary, file);
    return { ok: true, platform, serial, mimeType: "image/jpeg", size: bytes.length, dataUrl: "data:image/jpeg;base64," + bytes.toString("base64"), cached: false, source: "xlenore/" + (platform === "ps1" ? "psx-covers" : "ps2-covers") };
  } catch (_error) {
    return { ok: false, error: "تعذر الاتصال بمصدر الصور حالياً." };
  }
}

app.whenReady().then(() => {
  ipcMain.handle("artwork:get", async (event, value) => {
    if (!event.senderFrame.url.startsWith("app://saad/")) throw new Error("مصدر الطلب غير مصرح.");
    return readCachedArtwork(value);
  });
  ipcMain.handle("artwork:download", async (event, value) => {
    if (!event.senderFrame.url.startsWith("app://saad/")) throw new Error("مصدر الطلب غير مصرح.");
    return downloadArtwork(value);
  });

  const siteRoot = app.isPackaged
    ? path.resolve(process.resourcesPath, "app-site")
    : path.resolve(__dirname, "app-site");
  protocol.registerFileProtocol("app", (request, callback) => {
    try {
      const requestUrl = new URL(request.url);
      if (requestUrl.hostname === "artwork") {
        const name = path.basename(decodeURIComponent(requestUrl.pathname));
        if (!/^(PS1|PS2)-[A-Z0-9]{4}-[0-9]{5}\\.jpg$/i.test(name)) return callback({ error: -6 });
        return callback({ path: path.join(app.getPath("userData"), "artwork-cache", name) });
      }
      const pathname = decodeURIComponent(requestUrl.pathname);
      const requested = path.resolve(siteRoot, "." + pathname);
      if (!requested.startsWith(siteRoot + path.sep) && requested !== path.join(siteRoot, "index.html")) return callback({ error: -6 });
      callback({ path: requested });
    } catch (_error) {
      callback({ error: -6 });
    }
  });
  app.setAppUserModelId("com.saadps2.ultimate");
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
