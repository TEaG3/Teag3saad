"use strict";
const { app, BrowserWindow, shell, protocol, net, ipcMain } = require("electron");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
const fs = require("node:fs/promises");

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
  window.once("ready-to-show", () => window.show());
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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await net.fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Saad-PS2-Ultimate/1.2", "Accept": "image/jpeg,image/*;q=0.8" }
    });
    if (!response.ok) {
      return { ok: false, missing: response.status === 404, status: response.status, error: response.status === 404 ? "لا توجد صورة لهذا الرقم في قاعدة الصور." : "مصدر الصور أعاد HTTP " + response.status + "." };
    }
    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    if (!contentType.startsWith("image/")) return { ok: false, error: "مصدر الصور لم يُرجع ملف صورة." };
    const length = Number(response.headers.get("content-length") || 0);
    if (length > 10 * 1024 * 1024) return { ok: false, error: "حجم الغلاف يتجاوز الحد المسموح (10 MiB)." };
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > 10 * 1024 * 1024 || !isJpeg(bytes)) {
      return { ok: false, error: "الملف المستلم فارغ أو ليس صورة JPEG سليمة." };
    }
    const { folder, file } = artworkFile(platform, serial);
    await fs.mkdir(folder, { recursive: true });
    const temporary = file + ".tmp";
    await fs.writeFile(temporary, bytes);
    await fs.rename(temporary, file);
    return { ok: true, platform, serial, mimeType: "image/jpeg", size: bytes.length, dataUrl: "data:image/jpeg;base64," + bytes.toString("base64"), cached: false, source: "xlenore/" + (platform === "ps1" ? "psx-covers" : "ps2-covers") };
  } catch (error) {
    return { ok: false, error: error.name === "AbortError" ? "انتهت مهلة الاتصال بمصدر الصور." : "تعذر الاتصال بمصدر الصور: " + (error.message || String(error)) };
  } finally {
    clearTimeout(timeout);
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

  const siteRoot = path.resolve(process.resourcesPath, "app-site");
  protocol.handle("app", (request) => {
    const requestUrl = new URL(request.url);
    if (requestUrl.hostname === "artwork") {
      const name = path.basename(decodeURIComponent(requestUrl.pathname));
      if (!/^(PS1|PS2)-[A-Z0-9]{4}-[0-9]{5}\.jpg$/i.test(name)) return new Response("Not found", { status: 404 });
      const artwork = path.join(app.getPath("userData"), "artwork-cache", name);
      return net.fetch(pathToFileURL(artwork).toString());
    }
    const pathname = decodeURIComponent(requestUrl.pathname);
    const requested = path.resolve(siteRoot, "." + pathname);
    if (!requested.startsWith(siteRoot + path.sep) && requested !== path.join(siteRoot, "index.html")) {
      return new Response("Not found", { status: 404 });
    }
    return net.fetch(pathToFileURL(requested).toString());
  });
  app.setAppUserModelId("com.saadps2.ultimate");
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
