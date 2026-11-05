"use strict";
const fs = require("node:fs");
const path = require("node:path");

const SOURCES = [
  { platform: "PS1", repository: "niemasd/GameDB-PSX", assetName: "PSX.titles.json" },
  { platform: "PS2", repository: "niemasd/GameDB-PS2", assetName: "PS2.titles.json" }
];
const SUPPORTED_FORMATS = ["ISO","ZSO","UL","VCD","BIN","CUE","IMG","CHD","PBP"];

function normalizeSerial(value) {
  const raw = String(value || "").trim().toUpperCase().replace(/_/g, "-");
  const dotted = raw.match(/^([A-Z]{4})-(\d{3})\.(\d{2})$/);
  if (dotted) return dotted[1] + "-" + dotted[2] + dotted[3];
  const flat = raw.match(/^([A-Z]{4})-(\d{5})$/);
  return flat ? flat[1] + "-" + flat[2] : null;
}

function payloadPairs(payload) {
  if (Array.isArray(payload)) {
    return payload.map(row => [
      row?.serial || row?.id || row?.gameId || row?.game_id,
      row?.title || row?.name || row?.englishTitle || row?.title_en
    ]);
  }
  if (!payload || typeof payload !== "object") return [];
  const nested = payload.titles || payload.games || payload.data;
  if (nested && nested !== payload) return payloadPairs(nested);
  return Object.entries(payload).map(([serial, value]) => [
    serial,
    typeof value === "string" ? value :
      value?.title || value?.name || value?.englishTitle || value?.title_en
  ]);
}

function mapTitleMap(payload, platform) {
  if (!["PS1","PS2"].includes(platform)) throw new Error("Unsupported platform: " + platform);
  const bySerial = new Map();
  for (const [rawSerial, rawTitle] of payloadPairs(payload)) {
    const serial = normalizeSerial(rawSerial);
    const title = String(rawTitle || "").replace(/\s+/g, " ").trim();
    if (!serial || !title) continue;
    if (!bySerial.has(serial)) bySerial.set(serial, { platform, serial, title });
  }
  return [...bySerial.values()].sort((a,b) => a.serial.localeCompare(b.serial));
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      "Accept": "application/vnd.github+json",
      "User-Agent": "Saad-PS2-Ultimate-Catalog-Sync"
    },
    redirect: "follow"
  });
  if (!response.ok) throw new Error("HTTP " + response.status + " while fetching " + url);
  return response.json();
}

async function fetchSource(source) {
  const release = await fetchJson("https://api.github.com/repos/" + source.repository + "/releases/latest");
  const asset = (release.assets || []).find(item => item.name === source.assetName);
  if (!asset?.browser_download_url) throw new Error("Source release has no " + source.assetName);
  const payload = await fetchJson(asset.browser_download_url);
  const games = mapTitleMap(payload, source.platform);
  if (games.length < 100) throw new Error(source.platform + " title source returned only " + games.length + " valid records.");
  return { release: release.tag_name, asset: source.assetName, url: asset.browser_download_url, games };
}

async function updateCatalog(outputPath = path.resolve(__dirname, "../data/game-catalog.json")) {
  let previous = null;
  try { previous = JSON.parse(fs.readFileSync(outputPath, "utf8")); } catch (_) {}
  try {
    const results = await Promise.all(SOURCES.map(fetchSource));
    const games = results.flatMap(result => result.games)
      .sort((a,b) => a.platform.localeCompare(b.platform) || a.serial.localeCompare(b.serial));
    const counts = {
      PS1: games.filter(game => game.platform === "PS1").length,
      PS2: games.filter(game => game.platform === "PS2").length
    };
    if (counts.PS1 < 100 || counts.PS2 < 100 || games.length < 1000) {
      throw new Error("Catalog source validation failed: " + JSON.stringify(counts));
    }
    const catalog = {
      schemaVersion: 1,
      catalogVersion: results.map(result => result.release).join(" + "),
      generatedFrom: {
        PS1: { repository: SOURCES[0].repository, release: results[0].release, asset: results[0].asset, license: "GPL-3.0" },
        PS2: { repository: SOURCES[1].repository, release: results[1].release, asset: results[1].asset, license: "GPL-3.0" }
      },
      platforms: ["PS1","PS2"],
      supportedFormats: SUPPORTED_FORMATS,
      usbFilesystems: ["FAT","FAT32","exFAT"],
      counts,
      games
    };
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(catalog, null, 2) + "\n", "utf8");
    console.log("Catalog updated: PS1 " + counts.PS1 + ", PS2 " + counts.PS2 + ", total " + games.length);
    console.log("Source releases: " + catalog.catalogVersion);
    return catalog;
  } catch (error) {
    if (previous?.games?.length >= 1000 && previous?.counts?.PS1 >= 100 && previous?.counts?.PS2 >= 100) {
      console.warn("Catalog source unavailable; keeping previous validated catalog: " + error.message);
      return previous;
    }
    throw error;
  }
}

if (require.main === module) {
  updateCatalog().catch(error => {
    console.error("Catalog sync failed:", error);
    process.exitCode = 1;
  });
}
module.exports = { normalizeSerial, mapTitleMap, updateCatalog };
