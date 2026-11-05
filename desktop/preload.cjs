"use strict";
const { contextBridge, ipcRenderer } = require("electron");

// Narrow, serial-validated artwork API only. Do not expose raw IPC or Node APIs.
contextBridge.exposeInMainWorld("saadDesktop", Object.freeze({
  isDesktop: true,
  getArtwork: (request) => ipcRenderer.invoke("artwork:get", request),
  downloadArtwork: (request) => ipcRenderer.invoke("artwork:download", request)
}));
