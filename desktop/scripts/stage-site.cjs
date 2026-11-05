"use strict";
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "../..");
const destination = path.resolve(__dirname, "../app-site");
const files = ["index.html", "app.js", "styles.css", "ps2-database.js", "manifest.webmanifest", "sw.js", "data"];
fs.rmSync(destination, { recursive: true, force: true });
fs.mkdirSync(destination, { recursive: true });
for (const item of files) {
  const source = path.join(root, item);
  if (!fs.existsSync(source)) throw new Error(`Required web asset is missing: ${item}`);
  fs.cpSync(source, path.join(destination, item), { recursive: true });
}
console.log("Staged current Saad PS2 web app into desktop/app-site");
