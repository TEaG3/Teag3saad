"use strict";
const { app, BrowserWindow, shell, protocol, net } = require("electron");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

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

app.whenReady().then(() => {
  const siteRoot = path.resolve(process.resourcesPath, "app-site");
  protocol.handle("app", (request) => {
    const pathname = decodeURIComponent(new URL(request.url).pathname);
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
