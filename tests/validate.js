"use strict";
const fs=require("fs");
const vm=require("vm");
const assert=require("assert");
const html=fs.readFileSync("index.html","utf8");
const app=fs.readFileSync("app.js","utf8");
const css=fs.readFileSync("styles.css","utf8");
const sw=fs.readFileSync("sw.js","utf8");
const manifest=JSON.parse(fs.readFileSync("manifest.webmanifest","utf8"));
const engine=fs.readFileSync("ps2-database.js","utf8");
new Function(app);
new Function(sw);
new Function(engine);
assert(html.includes('src="./ps2-database.js"'),"database engine must load before app");
assert(html.includes('id="runDiagnostics"'),"diagnostics button missing");
assert(sw.includes("./ps2-database.js"),"service worker must cache database engine");
assert(sw.match(/saad-ps2-v\d+/),"cache version missing");
assert(manifest.name==="Saad PS2 Ultimate","manifest identity mismatch");
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]);
assert.equal(new Set(ids).size,ids.length,"duplicate HTML IDs");
const refs=[...app.matchAll(/\$\("([^"]+)"\)/g)].map(x=>x[1]);
const missing=[...new Set(refs.filter(x=>!ids.includes(x)))];
assert.deepEqual(missing,[],"app references missing HTML IDs: "+missing.join(", "));
const sandbox={window:{},navigator:{userAgent:"test",platform:"",maxTouchPoints:0}};
vm.runInNewContext(engine,sandbox);
const db=sandbox.window.PS2Database;
assert.equal(db.normalizeId("slus-203.12"),"SLUS_203.12");
assert.equal(db.normalizeId("NOT_A_GAME"),null);
assert.equal(db.regionFromId("SLES_123.45").code,"PAL");
assert.equal(db.regionFromId("SLUS_203.12").code,"NTSC-U");
const report=db.inspectLibrary([
 {gameId:"SLUS_203.12",format:"ISO",size:100,source:"DVD/a.iso"},
 {gameId:"SLUS_203.12",format:"ISO",size:100,source:"DVD/b.iso"},
 {gameId:"FILE_12345678",format:"UL",size:0,source:"ul.cfg",ulPartsComplete:false}
]);
assert.equal(report.total,3);
assert.equal(report.duplicateIds,1);
assert.equal(report.missingId,1);
assert.equal(report.incompleteUl,1);
assert(css.includes("#diagnosticResults"),"diagnostics styles missing");
assert(!app.includes("\\nif("),"literal escaped newline broke app.js syntax");
assert((app.match(/fallbackFiles.*addEventListener\("change"/g)||[]).length===1,"fallback handlers must be unique");
assert(sw.includes("saad-ps2-v9"),"service worker cache must be bumped");
assert(html.includes("توافق أنظمة Windows"),"Windows compatibility note missing");
assert(app.includes("xlenore/psx-covers/main/covers/default/"),"PS1 cover source missing");
assert(app.includes("function valid(id){const value=String(id||\"\").toUpperCase();return /^[A-Z]{4}_\\d{3}\\.\\d{2}$/.test(value.replace(\"-\",\"_\"))||isPs1Id(value);}"),"PS1 serial validation missing");
assert(app.includes("normalizePs1Id"),"PS1 serial normalization missing");
assert(html.includes("SLUS-00896"),"PS1 serial format hint missing");

assert(app.includes("webkitRelativePath"),"selected-file path normalization must handle Windows separators");
assert(app.includes('return /\\\\.(iso|zso)$/i.test(f.name);')||app.includes('return /\\.(iso|zso)$/i.test(f.name);'),"selected ISO/ZSO extension matcher missing");
assert(app.includes('split("\\0")'),"UL config must split null-terminated fields");
assert(sw.includes("saad-ps2-v9"),"service worker cache must be bumped after PS1/PS2 scanning changes");
assert(app.includes("scanGameTree"),"recursive game scanner missing");
assert(app.includes("extractDiscId"),"disc serial extractor missing");
assert(app.includes("await download(true)"),"automatic missing-art download missing");
assert(html.includes('id="ps1Count"'),"PS1 count display missing");

console.log("PASS: JS syntax, manifest, static DOM references, database ID/region checks, duplicate and UL diagnostics.");
