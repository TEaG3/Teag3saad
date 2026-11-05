"use strict";
const $=id=>document.getElementById(id);
const S={root:null,offline:null,games:[],filter:"all",query:"",logs:[],busy:false,db:null,activeGame:null,catalog:[],catalogStatus:"جارٍ تحميل القاعدة"};
// Hide the website installer link only inside the Electron desktop application.
if(window.saadDesktop?.isDesktop)document.getElementById("downloadWindowsApp")?.remove();
const isPs1Id=id=>/^[A-Z]{4}-\d{5}$/.test(String(id||"").toUpperCase().replace("_","-"));
const normalizePs1Id=id=>String(id||"").toUpperCase().replace("_","-");
function artworkIdentity(id,platformHint){
 const value=String(id||"").trim().toUpperCase(),hint=String(platformHint||"").toLowerCase();
 if(hint==="ps1"||isPs1Id(value)){const serial=catalogSerial(value);return serial?{platform:"ps1",serial}:null;}
 if(hint==="ps2"||/^[A-Z]{4}[_-]\d{3}\.\d{2}$/.test(value)){const serial=catalogSerial(value);return serial?{platform:"ps2",serial}:null;}
 return null;
}
function coverUrls(id,platformHint){
 const identity=artworkIdentity(id,platformHint);
 if(!identity)return [];
 const repository=identity.platform==="ps1"?"psx-covers":"ps2-covers";
 return ["https://raw.githubusercontent.com/xlenore/"+repository+"/main/covers/default/"+identity.serial+".jpg"];
}
function msg(t,error=false){const e=$("toast");e.textContent=t;e.className="toast show"+(error?" error":"");clearTimeout(msg.timer);msg.timer=setTimeout(()=>e.className="toast",4000);}
function log(t){S.logs.unshift({t,at:new Date().toLocaleString("ar-IQ")});$("logs").innerHTML=S.logs.map(x=>'<div class="log-entry">'+esc(x.t)+' <small>— '+esc(x.at)+'</small></div>').join("");}
function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function valid(id){const value=String(id||"").toUpperCase();return /^[A-Z]{4}_\d{3}\.\d{2}$/.test(value.replace("-","_"))||isPs1Id(value);}
function validRecordKey(id){return valid(id)||/^(UL|FILE)_[A-F0-9]{8}$/.test(String(id||""));}
function localKey(prefix,value){let h=2166136261;for(const c of String(value)){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return prefix+"_"+(h>>>0).toString(16).toUpperCase().padStart(8,"0");}
function effectiveId(g){
 const id=g?.oplGameId||(valid(g?.gameId)?g.gameId:"");
 if(g?.platform==="PS1"||g?.catalog?.platform==="PS1")return catalogSerial(id)||"";
 if(isPs1Id(id))return normalizePs1Id(id);
 return valid(id)?String(id).toUpperCase().replace("-","_"):"";
}
function idFromName(name){const value=String(name||"").toUpperCase(),ps1=value.match(/\b([A-Z]{4}[-_]\d{5})\b/);if(ps1)return normalizePs1Id(ps1[1]);const m=value.match(/\b([A-Z]{4}[_-]\d{3}\.\d{2})\b/);return m?m[1].replace("-","_"):null;}
function fmt(n){if(!n)return "—";let u=["B","KB","MB","GB"],i=0;while(n>=1024&&i<3){n/=1024;i++;}return n.toFixed(i?1:0)+" "+u[i];}
async function gameId(file){
 if(!/\.iso$/i.test(file.name))return idFromName(file.name);
 const txt=new TextDecoder("ascii").decode(await file.slice(0,8*1024*1024).arrayBuffer());
 const m=txt.match(/BOOT2\s*=\s*cdrom0:\\?([A-Z]{4}[_-]\d{3}\.\d{2})/i)||txt.match(/\b([A-Z]{4}[_-]\d{3}\.\d{2})\b/i);
 return m?m[1].toUpperCase().replace("-","_"):idFromName(file.name);
}
async function scanFolder(root,name){
 let out=[];
 try{
  const d=await root.getDirectoryHandle(name);
  for await(const e of d.values()){
   if(e.kind!=="file"||!/\.(iso|zso)$/i.test(e.name))continue;
   try{
    const f=await e.getFile(),isIso=/\.iso$/i.test(e.name);
    const id=isIso?await gameId(f):idFromName(e.name);
    out.push({title:e.name.replace(/\.(iso|zso)$/i,""),recordKey:localKey("LIB",name+"/"+e.name.toLowerCase()),gameId:id||localKey("FILE",name+"/"+e.name.toLowerCase()),oplGameId:id||null,format:isIso?"ISO":"ZSO",size:f.size,hasCover:false,hasIcon:false,source:name+"/"+e.name});
   }catch(err){log("تعذر قراءة "+e.name);}
  }
 }catch(e){}
 return out;
}
async function parseUl(root,h){
 const f=await h.getFile(),b=new Uint8Array(await f.arrayBuffer()),out=[],rootFiles=[];
 for await(const entry of root.values())if(entry.kind==='file')rootFiles.push(entry);
 const dec=new TextDecoder('ascii'),recordSize=64;
 if(b.length%recordSize)log('تحذير: حجم ul.cfg ليس مضاعفاً لـ 64 بايت؛ قد توجد سجلات غير مكتملة.');
 for(let o=0,index=0;o+recordSize<=b.length;o+=recordSize,index++){
  const name=dec.decode(b.slice(o,o+32)).split('\0')[0].trim();
  const magic=dec.decode(b.slice(o+32,o+35));
  const startup=dec.decode(b.slice(o+35,o+47)).split('\0')[0].trim().toUpperCase();
  const parts=b[o+47],media=b[o+48];
  if(!name||magic!=='ul.')continue;
  const fullId=idFromName(startup);
  const key=fullId||localKey('UL',startup+'|'+name+'|'+index);
  const escaped=startup.replaceAll('.', '\\.');
  const partPattern=new RegExp('^ul\\.[0-9a-f]{8}\\.'+escaped+'\\.([0-9a-f]{2})$','i');
  const availableParts=[],seen=new Set();let size=0,crc='';
  if(startup){
   for(const entry of rootFiles){
    const match=entry.name.match(partPattern);if(!match)continue;
    const partNumber=parseInt(match[1],16);if(!Number.isFinite(partNumber)||seen.has(partNumber))continue;
    seen.add(partNumber);availableParts.push(partNumber);
    if(!crc){const prefix=entry.name.match(/^ul\\.([0-9a-f]{8})\\./i);if(prefix)crc=prefix[1].toUpperCase();}
    try{size+=(await entry.getFile()).size;}catch(err){}
   }
  }
  availableParts.sort((x,y)=>x-y);
  const missingPartNumbers=[];for(let part=0;part<parts;part++)if(!seen.has(part))missingPartNumbers.push(part);
  const complete=parts>0&&missingPartNumbers.length===0&&availableParts.length===parts;
  out.push({recordKey:localKey("LIB","UL|"+startup+"|"+name+"|"+index),title:name,gameId:key,oplGameId:fullId||null,format:'UL',size,hasCover:false,hasIcon:false,source:'ul.cfg',ulStartup:startup,ulCrc:crc,ulParts:parts,ulAvailableParts:availableParts.length,ulMissingParts:missingPartNumbers.length,ulMissingPartNumbers:missingPartNumbers,ulPartsComplete:complete,ulPartNumbers:availableParts,ulMedia:media===0x12?'CD':media===0x14?'DVD':'UNKNOWN'});
 }
 return out;
}
async function inspect(){
 if(!S.root)return null;
 const report=await window.PS2Database.inspectArt(S.root);
 const verified=new Set((report.valid||[]).map(name=>String(name).toUpperCase()));
 S.games.forEach(g=>{
  const id=effectiveId(g);
  g.hasCover=!!id&&(verified.has(id+"_COV.JPG")||verified.has(id+"_COV.PNG"));
  g.hasIcon=!!id&&verified.has(id+"_ICO.PNG");
 });
 S.artReport=report;
 return report;
}
async function scan(){
 if(!("showDirectoryPicker"in window)){ $("fallbackPick").hidden=false; $("fallbackFilesPick").hidden=false; msg("هذا المتصفح لا يدعم الكتابة المباشرة إلى USB. اختر الملفات يدوياً؛ تنزيل الأغلفة إلى الفلاش يتطلب متصفح Chromium يدعم اختيار المجلدات."); return; }
 try{
  S.root=await showDirectoryPicker({mode:"readwrite"});
  $("fallbackPick").hidden=true;
  $("driveName").textContent=S.root.name;$("driveDot").classList.add("on");$("driveInfo").textContent="فحص PS1 وPS2...";
  $("games").innerHTML='<tr><td colspan="9" class="empty">جارٍ فحص جميع المجلدات...</td></tr>';
  S.games=await scanGameTree(S.root,"");
  try{S.games.push(...await parseUl(S.root,await S.root.getFileHandle("ul.cfg")));}catch(e){}
  if(S.catalogReady)await S.catalogReady;
  await hydrateMetadata();await inspect();
  try{await saveLibrary(S.games);}catch(e){log("تعذر حفظ الفهرس: "+e.message);}
  await restoreCachedArtwork();
  render();
  const ps1=S.games.filter(g=>g.platform==="PS1").length,ps2=S.games.filter(g=>g.platform==="PS2").length;
  log("اكتمل الفحص: PS1 "+ps1+"، PS2 "+ps2+"، الإجمالي "+S.games.length+".");
  msg("اكتشف الموقع "+S.games.length+" لعبة؛ بدأ تنزيل الأغلفة الناقصة.");
  await download(true);
 }catch(e){if(e.name!=="AbortError")msg("تعذر فحص المجلد: "+e.message,true);}
}
async function extractDiscId(file){
 const byName=idFromName(file.name);if(byName)return byName;
 const ext=(file.name.split(".").pop()||"").toLowerCase();
 if(ext==="cue"){
  try{const text=await file.slice(0,1048576).text();const m=text.toUpperCase().match(/([A-Z]{4}[-_]\d{5})|([A-Z]{4}[_-]\d{3}\.\d{2})/);if(m)return m[1]?normalizePs1Id(m[1]):m[2].replace("-","_");}catch(e){}
  return null;
 }
 if(["iso","bin","img","zso","chd","pbp","vcd"].indexOf(ext)<0)return null;
 try{
  const bytes=await file.slice(0,33554432).arrayBuffer(),txt=new TextDecoder("ascii").decode(bytes);
  const ps2=txt.match(/\b([A-Z]{4}[_-]\d{3}\.\d{2})\b/i);if(ps2)return ps2[1].toUpperCase().replace("-","_");
  const ps1=txt.match(/\b([A-Z]{4}[-_]\d{5})\b/i);if(ps1)return normalizePs1Id(ps1[1]);
 }catch(e){}
 return null;
}
async function buildCueGame(cueEntry,entries,pathOf){
 const cueFile=cueEntry.getFile?await cueEntry.getFile():cueEntry;
 const cueName=cueEntry.name||cueFile.name;
 const cuePath=pathOf?pathOf(cueEntry):cueName;
 const cueText=await cueFile.slice(0,1048576).text();
 const refs=[];
 for(const match of cueText.matchAll(/^\s*FILE\s+(?:"([^"]+)"|(\S+))\s+/gim)){
  const raw=(match[1]||match[2]||"").replace(/\\/g,"/");
  const base=raw.split("/").pop().toLowerCase();
  const found=entries.find(e=>(e.name||"").toLowerCase()===base);
  if(found&&!refs.includes(found))refs.push(found);
 }
 const title=cueName.replace(/\.cue$/i,"").replace(/\s*\(track\s*\d+\)\s*$/i,"").trim();
 if(!refs.length){
  const stem=title.toLowerCase();
  for(const entry of entries){
   if(entry===cueEntry||entry.kind==="directory"||!/\.bin$/i.test(entry.name||""))continue;
   const binStem=entry.name.replace(/\.bin$/i,"").replace(/\s*\(track\s*\d+\)\s*$/i,"").trim().toLowerCase();
   if(binStem===stem)refs.push(entry);
  }
 }
 let id=await extractDiscId(cueFile);
 const referencedPaths=[cuePath],seen=new Set([cueEntry]);
 let size=cueFile.size||0;
 for(const entry of refs){
  if(seen.has(entry))continue;
  seen.add(entry);
  const file=entry.getFile?await entry.getFile():entry;
  size+=file.size||0;
  referencedPaths.push(pathOf?pathOf(entry):entry.name);
  if(!id)id=await extractDiscId(file);
 }
 if(!id)id=idFromName(title);
 const platform=resolvePlatform(id,"CUE",title);
 return {title,recordKey:localKey("LIB",cuePath.toLowerCase()),gameId:id||localKey("FILE",cuePath.toLowerCase()),oplGameId:id||null,format:"CUE",platform,size,hasCover:false,hasIcon:false,source:referencedPaths.join(" | "),discFiles:referencedPaths};
}
async function scanGameTree(dir,prefix){
 const out=[],entries=[];for await(const ent of dir.values())entries.push(ent);
 const cueEntries=entries.filter(e=>e.kind==="file"&&/\.cue$/i.test(e.name));
 const consumedBins=new Set();
 for(const cue of cueEntries){
  try{
   const game=await buildCueGame(cue,entries,e=>(prefix?prefix+"/":"")+e.name);
   for(const entry of entries){
    if(entry.kind!=="file"||!/\.bin$/i.test(entry.name))continue;
    const stem=entry.name.replace(/\.bin$/i,"").replace(/\s*\(track\s*\d+\)\s*$/i,"").trim().toLowerCase();
    const cueStem=cue.name.replace(/\.cue$/i,"").replace(/\s*\(track\s*\d+\)\s*$/i,"").trim().toLowerCase();
    if(stem===cueStem||(game.discFiles||[]).some(p=>p.toLowerCase().endsWith("/"+entry.name.toLowerCase())||p.toLowerCase()===entry.name.toLowerCase()))consumedBins.add(entry);
   }
   out.push(game);
  }catch(e){log("تعذر تحليل ملف CUE "+cue.name+": "+e.message);}
 }
 for(const ent of entries){
  if(ent.kind==="directory"){
   if(ent.name.toUpperCase()==="ART")continue;
   out.push(...await scanGameTree(ent,prefix?prefix+"/"+ent.name:ent.name));continue;
  }
  if(ent.kind!=="file"||!/\\.(iso|zso|bin|img|chd|pbp|vcd)$/i.test(ent.name))continue;
  if(consumedBins.has(ent))continue;
  if(/\.bin$/i.test(ent.name)){
   const stem=ent.name.replace(/\.bin$/i,"").replace(/\s*\(track\s*\d+\)\s*$/i,"").trim().toLowerCase();
   if(cueEntries.some(c=>c.name.replace(/\.cue$/i,"").replace(/\s*\(track\s*\d+\)\s*$/i,"").trim().toLowerCase()===stem))continue;
  }
  try{
   const file=await ent.getFile(),id=await extractDiscId(file),ext=ent.name.split(".").pop().toLowerCase();
   const title=ent.name.replace(/\.[^.]+$/,"");
   const platform=resolvePlatform(id,ext,title);
   const path=(prefix?prefix+"/":"")+ent.name;
   out.push({title,recordKey:localKey("LIB",path.toLowerCase()),gameId:id||localKey("FILE",path.toLowerCase()),oplGameId:id||null,format:ext.toUpperCase(),platform,size:file.size,hasCover:false,hasIcon:false,source:path});
  }catch(e){log("تعذر قراءة "+ent.name+": "+e.message);}
 }
 return out;
}
async function scanSelectedFiles(fileList){
 const files=Array.prototype.slice.call(fileList||[]);
 const pathOf=function(f){return String(f.webkitRelativePath||f.name||"").replace(/\\/g,"/");};
 S.root=null;S.games=[];
 $("driveName").textContent="جارٍ فحص الملفات المختارة";
 $("driveInfo").textContent="قراءة الملفات وتحليلها...";
 $("games").innerHTML='<tr><td colspan="9" class="empty">جارٍ تحليل الملفات...</td></tr>';
  const gameFiles=files.filter(function(f){return /\.(iso|zso|bin|cue|img|chd|pbp|vcd)$/i.test(f.name);});
 const cueFiles=gameFiles.filter(function(f){return /\.cue$/i.test(f.name);});
 const consumed=new Set();
 for(const cue of cueFiles){
  try{
   const game=await buildCueGame(cue,gameFiles,pathOf);
   S.games.push(Object.assign(game,{folder:(pathOf(cue).split("/").slice(-2,-1)[0]||"ROOT")}));
   const discPaths=new Set((game.discFiles||[]).map(p=>p.toLowerCase()));
   gameFiles.forEach(function(f){
    if(f===cue)return;
    const path=pathOf(f).toLowerCase();
    const stem=f.name.replace(/\.bin$/i,"").replace(/\s*\(track\s*\d+\)\s*$/i,"").trim().toLowerCase();
    const cueStem=cue.name.replace(/\.cue$/i,"").replace(/\s*\(track\s*\d+\)\s*$/i,"").trim().toLowerCase();
    if(discPaths.has(path)||discPaths.has(f.name.toLowerCase())||(/\.bin$/i.test(f.name)&&stem===cueStem))consumed.add(f);
   });
  }catch(e){log("تعذر تحليل ملف CUE "+cue.name+": "+e.message);}
 }
 for(let i=0;i<gameFiles.length;i++){
  const f=gameFiles[i];
  if(/\.cue$/i.test(f.name)||consumed.has(f))continue;
  try{
   const path=pathOf(f),parts=path.split("/"),id=await extractDiscId(f),ext=f.name.split(".").pop().toUpperCase(),title=f.name.replace(/\.[^.]+$/,""),platform=resolvePlatform(id,ext,title);
   S.games.push({title,recordKey:localKey("LIB",path.toLowerCase()),gameId:id||localKey("FILE",path.toLowerCase()),oplGameId:id||null,format:ext,platform,size:f.size,hasCover:false,hasIcon:false,source:path,folder:parts.length>1?parts[parts.length-2]:"ROOT"});
  }catch(e){log("تعذر تحليل "+f.name+": "+e.message);}
 }
 const ul=files.find(function(f){return f.name.toLowerCase()==="ul.cfg";});
 if(ul){
  try{
   const b=new Uint8Array(await ul.arrayBuffer()),dec=new TextDecoder("ascii");
   const ulFiles=files.filter(function(f){return /^ul\.[0-9a-f]{8}\..+\.[0-9a-f]{2}$/i.test(f.name);});
   for(let o=0,index=0;o+64<=b.length;o+=64,index++){
    const name=dec.decode(b.slice(o,o+32)).split("\0")[0].trim();
    const magic=dec.decode(b.slice(o+32,o+35));
    const startup=dec.decode(b.slice(o+35,o+47)).split("\0")[0].trim().toUpperCase();
    const parts=b[o+47],media=b[o+48];
    if(!name||magic!=="ul.")continue;
    const id=idFromName(startup),escaped=startup.replace(/\./g,"\\.");
    const pattern=new RegExp("^ul\\.[0-9a-f]{8}\\."+escaped+"\\.([0-9a-f]{2})$","i");
    const found=ulFiles.filter(function(f){return pattern.test(f.name);});
    const nums=found.map(function(f){const m=f.name.match(pattern);return m?parseInt(m[1],16):-1;}).filter(function(n){return n>=0;});
    const missing=[];for(let p=0;p<parts;p++)if(nums.indexOf(p)<0)missing.push(p);
    S.games.push({recordKey:localKey("LIB","UL|"+startup+"|"+name+"|"+index),title:name,gameId:id||localKey("UL",startup+"|"+name+"|"+index),oplGameId:id||null,format:"UL",size:found.reduce(function(n,f){return n+f.size;},0),hasCover:false,hasIcon:false,source:"ul.cfg",ulStartup:startup,ulParts:parts,ulAvailableParts:found.length,ulMissingParts:missing.length,ulMissingPartNumbers:missing,ulPartsComplete:parts>0&&missing.length===0&&found.length===parts,ulPartNumbers:nums,ulMedia:media===0x12?"CD":media===0x14?"DVD":"UNKNOWN"});
   }
  }catch(e){log("تعذر تحليل ul.cfg: "+e.message);}
 }
 if(S.catalogReady)await S.catalogReady;
 await hydrateMetadata();
 try{await saveLibrary(S.games);}catch(e){log("تعذر حفظ الفهرس: "+e.message);}
 await restoreCachedArtwork();
 render();
 const folders=[];gameFiles.forEach(function(f){const p=pathOf(f).split("/"),name=p.length>1?p[p.length-2]:"الجذر";if(folders.indexOf(name)<0)folders.push(name);});
 $("driveName").textContent="مصدر ملفات مختار";$("driveDot").classList.add("on");
 $("driveInfo").textContent="قراءة فقط · "+files.length+" ملفاً · مجلدات الألعاب: "+folders.join("، ");
 log("اكتمل فحص الملفات المختارة: "+S.games.length+" لعبة من "+files.length+" ملفاً.");
 msg(S.games.length?"تم العثور على "+S.games.length+" لعبة.":"لم يتم العثور على ISO أو ZSO أو إدخالات UL. اختر مجلد OPL أو مجلد الألعاب.");
}
function render(){
 const iso=S.games.filter(g=>g.format==='ISO').length,zso=S.games.filter(g=>g.format==='ZSO').length,ul=S.games.filter(g=>g.format==='UL').length,cov=S.games.filter(g=>g.hasCover).length;
 const miss=S.games.filter(g=>!effectiveId(g)||!g.hasCover||!g.hasIcon).length;
 $('total').textContent=S.games.length;$('iso').textContent=iso+zso;$('ul').textContent=ul;$('covers').textContent=cov;if($('ps1Count'))$('ps1Count').textContent=S.games.filter(g=>g.platform==='PS1').length;
 $('allCount').textContent=S.games.length;$('missingCount').textContent=miss;
 $('sGames').textContent=S.games.length;$('sIso').textContent=iso+zso;$('sUl').textContent=ul;$('sSize').textContent=fmt(S.games.reduce((a,g)=>a+g.size,0));
 $('csv').disabled=!S.games.length;$('rescan').disabled=!S.root;$('missing').disabled=!S.games.length;$('all').disabled=!S.games.length;if($('downloadToApp'))$('downloadToApp').disabled=!S.games.length||!S.root;
 const rows=S.games.filter(g=>(!S.query||(((g.meta?.title||g.title)+' '+(effectiveId(g)||g.gameId)).toLowerCase().includes(S.query)))&&(S.filter==='all'||(S.filter==='missing'&&(!effectiveId(g)||!g.hasCover||!g.hasIcon))||S.filter===g.format));
 $('games').innerHTML=rows.length?rows.map(g=>{
  const id=effectiveId(g),displayId=id||g.gameId,cover=g.artworkDataUrl||(id?coverUrls(id,g.platform||g.catalog?.platform)[0]:'');
  const partsCell=g.format==='UL'?('<span class="tag '+(g.ulPartsComplete?'ok':'bad')+'">'+g.ulAvailableParts+'/'+g.ulParts+'</span>'):'—';
  return '<tr><td>'+(cover?'<img class="cover" src="'+cover+'" onerror="this.style.visibility=\'hidden\'" alt="">':'—')+'</td><td>'+esc(g.meta?.title||g.title)+'</td><td class="id">'+esc(displayId)+'</td><td>'+g.format+'</td><td>'+fmt(g.size)+'</td><td>'+partsCell+'</td><td><span class="tag '+(g.hasCover?'ok':'bad')+'">'+(g.hasCover?'متوفر':'ناقص')+'</span></td><td><span class="tag '+(g.hasIcon?'ok':'bad')+'">'+(g.hasIcon?'متوفر':'ناقص')+'</span></td><td><button class="row-action" data-game="'+esc(g.gameId)+'">تفاصيل</button></td></tr>';
 }).join(''):'<tr><td colspan="9" class="empty">لا توجد نتائج.</td></tr>';
}
async function fetchArt(id,platformHint){
 const identity=artworkIdentity(id,platformHint);
 if(!identity)throw new Error("Game ID غير صالح لمصدر الأغلفة.");
 if(window.saadDesktop?.downloadArtwork){
  const result=await window.saadDesktop.downloadArtwork(identity);
  if(!result?.ok||!result.dataUrl)throw new Error(result?.error||"تعذر تنزيل الغلاف من الإنترنت.");
  const response=await fetch(result.dataUrl);
  if(!response.ok)throw new Error("تعذر فتح الغلاف المخزن داخل التطبيق.");
  return await response.blob();
 }
 if(S.offline){
  for(const n of [id+".jpg",id+".png",id+"_COV.jpg",id+"_COV.png",identity.serial+".jpg"]){
   try{const file=await(await S.offline.getFileHandle(n)).getFile();if(file.size)return file;}catch(e){}
  }
 }
 let lastError="الصورة غير موجودة في مصدر الأغلفة.";
 for(const url of coverUrls(id,platformHint)){
  try{
   const response=await fetch(url,{cache:"no-store"});
   if(!response.ok){lastError="مصدر الأغلفة أعاد HTTP "+response.status+".";continue;}
   const type=(response.headers.get("content-type")||"").toLowerCase();
   if(!type.startsWith("image/")){lastError="المصدر لم يُرجع صورة.";continue;}
   const blob=await response.blob();
   if(blob.size)return blob;
  }catch(error){lastError=error.message||String(error);}
 }
 throw new Error(lastError);
}
async function restoreCachedArtwork(){
 if(!window.saadDesktop?.getArtwork)return;
 for(const game of S.games){
  const identity=artworkIdentity(effectiveId(game),game.platform||game.catalog?.platform);
  if(!identity)continue;
  try{
   const result=await window.saadDesktop.getArtwork(identity);
   if(result?.ok&&result.dataUrl){game.artworkDataUrl=result.dataUrl;game.hasLocalCover=true;}
  }catch(error){log("تعذر قراءة الغلاف المحلي "+identity.serial+": "+error.message);}
 }
}
async function downloadArtworkToApp(){
 if(!S.root){msg("اختر وحدة USB أولاً؛ سيتم الحفظ داخل ART ليقرأها OPL.",true);return;}
 // The native Windows downloader caches the original online cover.
 // download(false) then creates and verifies OPL _COV/_ICO files on USB:/ART.
 await download(false);
}
async function ensureWritePermission(){
 if(!S.root)throw new Error("لم يتم اختيار وحدة التخزين.");
 if(typeof S.root.queryPermission==="function"){
  let permission=await S.root.queryPermission({mode:"readwrite"});
  if(permission!=="granted"&&typeof S.root.requestPermission==="function")permission=await S.root.requestPermission({mode:"readwrite"});
  if(permission!=="granted")throw new Error("لم تمنح صلاحية الكتابة والقراءة.");
 }
}
async function save(dir,name,blob){
 const handle=await dir.getFileHandle(name,{create:true});
 const writer=await handle.createWritable({keepExistingData:false});
 try{await writer.write(blob);await writer.close();}
 catch(error){try{await writer.abort();}catch(e){}throw error;}
}
async function verifySavedArt(dir,name,width,height){
 const file=await(await dir.getFileHandle(name)).getFile();
 if(!file.size)throw new Error(name+" ملف فارغ بعد الحفظ.");
 const bitmap=await createImageBitmap(file);
 const actual=bitmap.width+"×"+bitmap.height;
 bitmap.close();
 if(actual!==width+"×"+height)throw new Error(name+" أبعاده "+actual+" بدلاً من "+width+"×"+height+".");
 return {size:file.size,type:file.type,dimensions:actual};
}
async function convertArt(blob,type,width,height,cropSquare=false){
 const bmp=await createImageBitmap(blob),canvas=document.createElement("canvas");
 canvas.width=width;canvas.height=height;
 const ctx=canvas.getContext("2d");
 if(!ctx){bmp.close();throw new Error("تعذر تجهيز الصورة");}
 if(type==="image/jpeg"){ctx.fillStyle="#ffffff";ctx.fillRect(0,0,width,height);}
 if(cropSquare){
  const side=Math.min(bmp.width,bmp.height),sx=(bmp.width-side)/2,sy=(bmp.height-side)/2;
  ctx.drawImage(bmp,sx,sy,side,side,0,0,width,height);
 }else{
  const scale=Math.min(width/bmp.width,height/bmp.height);
  const drawWidth=Math.max(1,Math.round(bmp.width*scale)),drawHeight=Math.max(1,Math.round(bmp.height*scale));
  ctx.drawImage(bmp,Math.round((width-drawWidth)/2),Math.round((height-drawHeight)/2),drawWidth,drawHeight);
 }
 bmp.close();
 const converted=await new Promise(resolve=>canvas.toBlob(resolve,type,type==="image/jpeg"?0.9:undefined));
 if(!converted)throw new Error("تعذر تحويل الصورة إلى "+type);
 return converted;
}
async function toJpeg(blob){return convertArt(blob,"image/jpeg",140,200,false);}
async function toPng(blob){return convertArt(blob,"image/png",64,64,true);}
async function download(onlyMissing){
 if(!S.root){msg("اختر وحدة التخزين أولاً.",true);return;}
 try{await ensureWritePermission();}catch(e){msg("تعذرت صلاحية الكتابة: "+e.message,true);return;}
 const list=S.games.filter(g=>valid(effectiveId(g))&&!!artworkIdentity(effectiveId(g),g.platform||g.catalog?.platform)&&(!onlyMissing||!g.hasCover||!g.hasIcon));
 if(!list.length){msg("لا توجد صور قابلة للحفظ. لألعاب UL أدخل Game ID الصحيح من تفاصيل اللعبة أولاً.",true);return;}
 const art=await S.root.getDirectoryHandle("ART",{create:true});
 $("progress").hidden=false;
 let ok=0,partial=0,fail=0,verifiedCovers=0,verifiedIcons=0;
 for(let i=0;i<list.length;i++){
  const g=list[i],id=effectiveId(g);
  $("progressText").textContent="تنزيل وحفظ والتحقق: "+g.title;
  $("progressCount").textContent=(i+1)+" / "+list.length;
  $("progressBar").style.width=((i+1)/list.length*100)+"%";
  $("progressDetail").textContent="Game ID: "+id;
  let coverOk=false,iconOk=false;
  try{
   const blob=await fetchArt(id,g.platform||g.catalog?.platform);
   if(!blob)throw new Error("مصدر الغلاف لم يرجع صورة قابلة للتنزيل.");
   const cover=await toJpeg(blob),icon=await toPng(blob);
   const coverName=id+"_COV.jpg",iconName=id+"_ICO.png";
   await save(art,coverName,cover);
   await verifySavedArt(art,coverName,140,200);
   coverOk=true;verifiedCovers++;
   await save(art,iconName,icon);
   await verifySavedArt(art,iconName,64,64);
   iconOk=true;verifiedIcons++;
   if(coverOk&&iconOk)ok++;
   else partial++;
  }catch(e){
   if(coverOk||iconOk)partial++;else fail++;
   log("فشل التحقق من صور "+id+": "+e.message);
  }
 }
 try{await inspect();}catch(e){log("تعذر إعادة فحص ملفات ART بعد الحفظ: "+e.message);}
 try{await saveLibrary(S.games);}catch(e){log("تعذر تحديث فهرس المكتبة المحفوظ: "+e.message);}
 render();
 const summary="اكتمل تنزيل الصور والتحقق بعد إعادة قراءتها. ألعاب مكتملة: "+ok+"، جزئية: "+partial+"، فاشلة: "+fail+"، أغلفة تحققت: "+verifiedCovers+"، أيقونات تحققت: "+verifiedIcons+".";
 log(summary);
 $("progressText").textContent="اكتمل التنزيل والتحقق";
 $("progressDetail").textContent="مكتملة "+ok+" · جزئية "+partial+" · فاشلة "+fail+" — تم فتح الملفات المحفوظة وقراءة الصورة والتحقق من أبعادها.";
 msg("اكتمل التحقق: "+ok+" لعبة بصورها كاملة، "+partial+" جزئية، "+fail+" فاشلة.");
}
function csv(){
 const rows=[["Title","Game ID","Format","Size Bytes","Cover","Icon"],...S.games.map(g=>[g.meta?.title||g.title,effectiveId(g)||g.gameId,g.format,g.size,g.hasCover,g.hasIcon])];
 const data="\uFEFF"+rows.map(r=>r.map(v=>'"'+String(v??"").replace(/"/g,'""')+'"').join(",")).join("\r\n");
 const url=URL.createObjectURL(new Blob([data],{type:"text/csv;charset=utf-8"})),a=document.createElement("a");
 a.href=url;a.download="saad-ps2-library.csv";a.click();URL.revokeObjectURL(url);
}
function view(name){document.querySelectorAll(".view").forEach(x=>x.classList.remove("active"));$(name).classList.add("active");document.querySelectorAll(".nav").forEach(x=>x.classList.toggle("active",x.dataset.view===name));$("viewTitle").textContent=({library:"مكتبة الألعاب",artwork:"إدارة الأغلفة",storage:"تحليل التخزين",reports:"التقارير والسجل"})[name];$("sidebar").classList.remove("open");}
document.querySelectorAll(".nav").forEach(b=>b.addEventListener("click",()=>view(b.dataset.view)));
document.querySelectorAll(".filter").forEach(b=>b.addEventListener("click",()=>{S.filter=b.dataset.filter;document.querySelectorAll(".filter").forEach(x=>x.classList.toggle("active",x===b));render();}));
$("scan").onclick=scan;$("rescan").onclick=scan;$("csv").onclick=csv;if($("downloadToApp"))$("downloadToApp").onclick=downloadArtworkToApp;$("missing").onclick=()=>download(true);$("all").onclick=()=>download(false);$("search").oninput=e=>{S.query=e.target.value.toLowerCase();render();};$("menu").onclick=()=>$("sidebar").classList.toggle("open");
$("offline").onclick=async()=>{if(!("showDirectoryPicker"in window)){msg("اختيار مجلد الصور المحلي غير مدعوم في هذا المتصفح؛ يمكنك استخدام الصور المتاحة عبر الإنترنت.",true);return;}try{S.offline=await showDirectoryPicker({mode:"read"});$("offlineName").textContent=S.offline.name;msg("تم اختيار مجلد الصور.");}catch(e){}};
if("serviceWorker"in navigator&&location.protocol.startsWith("http"))navigator.serviceWorker.register("./sw.js").catch(()=>{});

function openDb(){return new Promise((resolve,reject)=>{const req=indexedDB.open("saad-ps2-db",3);req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains("games"))db.createObjectStore("games",{keyPath:"gameId"});if(!db.objectStoreNames.contains("library"))db.createObjectStore("library",{keyPath:"recordKey"});if(!db.objectStoreNames.contains("catalog"))db.createObjectStore("catalog",{keyPath:"id"});};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);req.onblocked=()=>reject(new Error("أغلق النسخ القديمة من الموقع لإكمال تحديث قاعدة البيانات."));});}
async function getDb(){if(!S.db)S.db=await openDb();return S.db;}
async function allMetadata(){const d=await getDb();return new Promise((resolve,reject)=>{const r=d.transaction("games","readonly").objectStore("games").getAll();r.onsuccess=()=>resolve(r.result||[]);r.onerror=()=>reject(r.error);});}
async function allLibrary(){const d=await getDb();return new Promise((resolve,reject)=>{const r=d.transaction("library","readonly").objectStore("library").getAll();r.onsuccess=()=>resolve(r.result||[]);r.onerror=()=>reject(r.error);});}
async function saveLibrary(rows){const d=await getDb();return new Promise((resolve,reject)=>{const tx=d.transaction("library","readwrite"),store=tx.objectStore("library");store.clear();for(const game of rows){const row={...game};delete row.meta;store.put(row);}tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error("تم إلغاء حفظ المكتبة."));});}
async function restoreLastScan(){try{const rows=await allLibrary();if(!rows.length)return;S.games=rows;await hydrateMetadata();render();$("driveName").textContent="آخر مكتبة محفوظة";$("driveInfo").textContent=rows.length+" لعبة محفوظة محلياً؛ أعد اختيار USB لتحديث الصور";log("تم استعادة آخر فهرس ألعاب محفوظ من قاعدة البيانات المحلية.");}catch(e){log("تعذر استعادة فهرس الألعاب: "+e.message);}}
async function putMetadata(v){const d=await getDb();return new Promise((resolve,reject)=>{const tx=d.transaction("games","readwrite");tx.objectStore("games").put(v);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}
async function removeMetadata(id){const d=await getDb();return new Promise((resolve,reject)=>{const tx=d.transaction("games","readwrite");tx.objectStore("games").delete(id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}
async function readCatalogCache(){const d=await getDb();return new Promise((resolve,reject)=>{const q=d.transaction("catalog","readonly").objectStore("catalog").get("snapshot");q.onsuccess=()=>resolve(q.result?.data||null);q.onerror=()=>reject(q.error);});}
async function writeCatalogCache(data){const d=await getDb();return new Promise((resolve,reject)=>{const tx=d.transaction("catalog","readwrite");tx.objectStore("catalog").put({id:"snapshot",data,savedAt:new Date().toISOString()});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}
function catalogSerial(value){
 const id=String(value||"").trim().toUpperCase().replace(/_/g,"-");
 const dotted=id.match(/^([A-Z]{4})-(\d{3})\.(\d{2})$/);
 if(dotted)return dotted[1]+"-"+dotted[2]+dotted[3];
 const flat=id.match(/^([A-Z]{4})-(\d{5})$/);
 return flat?flat[1]+"-"+flat[2]:null;
}
function catalogOplId(record){
 if(!record)return null;
 const serial=catalogSerial(record.serial);if(!serial)return null;
 if(record.platform==="PS1")return serial;
 const match=serial.match(/^([A-Z]{4})-(\d{5})$/);
 return match?match[1]+"_"+match[2].slice(0,3)+"."+match[2].slice(3):null;
}
function normalizeCatalogTitle(value){
 return String(value||"").replace(/\.[^.]+$/,"").replace(/\((?:USA|U|NTSC-U|EUROPE|EU|PAL|JAPAN|JAP|ASIA|WORLD|NTSC-J)\)/gi," ").replace(/\b(?:track|disc|disk)\s*\d+\b/gi," ").toLowerCase().replace(/[^a-z0-9]+/g," ").trim().replace(/\s+/g," ");
}
function findCatalogRecord(id,title){
 const key=catalogSerial(id);if(!key)return null;
 const matches=S.catalog.filter(v=>catalogSerial(v.serial)===key&&["PS1","PS2"].includes(v.platform));
 if(matches.length===1)return matches[0];
 if(matches.length>1&&title){
  const wanted=normalizeCatalogTitle(title);
  const exact=matches.filter(v=>normalizeCatalogTitle(v.title)===wanted);
  if(exact.length===1)return exact[0];
 }
 return null;
}
function resolvePlatform(id,format,title){
 const record=findCatalogRecord(id,title);
 if(record)return record.platform;
 const key=catalogSerial(id);
 if(key){
  const matches=S.catalog.filter(v=>catalogSerial(v.serial)===key&&["PS1","PS2"].includes(v.platform));
  if(matches.length>1)return "UNKNOWN";
 }
 // Dotted IDs can represent either console generation. Never guess without a catalog match.
 if(/^[A-Z]{4}[_-]\d{3}\.\d{2}$/.test(String(id||"").toUpperCase()))return "UNKNOWN";
 return window.PS2Database.classifyPlatform(id,format);
}
async function syncCentralCatalog(){
 const validData=v=>v&&v.schemaVersion===1&&Array.isArray(v.games)&&v.games.length>=1000&&v.games.some(g=>g.platform==="PS1")&&v.games.some(g=>g.platform==="PS2");
 try{const response=await fetch("./data/game-catalog.json",{cache:"no-store"});if(!response.ok)throw new Error("HTTP "+response.status);const data=await response.json();if(!validData(data))throw new Error("invalid catalog schema");S.catalog=data.games;await writeCatalogCache(data);S.catalogStatus="متصل · "+S.catalog.length+" سجل مركزي";}
 catch(e){try{const cached=await readCatalogCache();if(validData(cached)){S.catalog=cached.games;S.catalogStatus="دون إنترنت · نسخة محلية · "+S.catalog.length+" سجل";}else S.catalogStatus="القاعدة غير متاحة";}catch(err){S.catalogStatus="القاعدة غير متاحة";}}
 await hydrateMetadata();if(S.games.length)render();const el=$("catalogStatus");if(el)el.textContent=S.catalogStatus;log("قاعدة الألعاب: "+S.catalogStatus+".");
}
async function hydrateMetadata(){
 try{
  const rows=await allMetadata(),map=new Map(rows.map(v=>[v.gameId,v]));
  S.games.forEach(g=>{
   const local=map.get(g.gameId)||null,rawId=g.oplGameId||g.gameId,central=findCatalogRecord(rawId,g.title);
   g.catalog=central;if(central)g.platform=central.platform;
   g.meta=local||(central?{title:central.title||g.title,genre:central.genre||"",region:central.region||"",year:central.year||"",publisher:central.publisher||"",developer:central.developer||""}:null);
   g.oplGameId=local?.oplGameId||catalogOplId(central)||(valid(g.gameId)?g.gameId:null);
  });
 }catch(e){log("تعذر تحميل قاعدة البيانات المحلية: "+e.message);}
}
function showGame(id){
 const g=S.games.find(v=>v.gameId===id);if(!g)return;S.activeGame=g;const m=g.meta||{};
 $("dialogTitle").textContent=m.title||g.title;$("dialogId").textContent=(effectiveId(g)||g.gameId)+" · "+g.format;
 $("metaTitle").value=m.title||g.title;$("metaGameId").value=m.oplGameId||effectiveId(g);
 $("metaGenre").value=m.genre||"";$("metaRegion").value=m.region||"";
 $("metaYear").value=m.year||"";$("metaRating").value=m.rating||"";$("metaNotes").value=m.notes||"";
 $("gameDialog").hidden=false;
}
async function saveGameMeta(){
 const g=S.activeGame;if(!g)return;
 const year=$("metaYear").value.trim(),rating=$("metaRating").value.trim();
 const rawId=$("metaGameId").value.trim().toUpperCase(),oplGameId=isPs1Id(rawId)?normalizePs1Id(rawId):rawId.replace("-","_");
 if(oplGameId&&!valid(oplGameId)){msg("صيغة المعرّف غير صحيحة. PS2: SLUS_203.12 · PS1: SLUS-00896",true);return;}
 if(year&&!/^\d{4}$/.test(year)){msg("أدخل سنة صحيحة من أربعة أرقام.",true);return;}
 if(rating&&(!Number.isFinite(Number(rating))||Number(rating)<0||Number(rating)>10)){msg("التقييم يجب أن يكون بين 0 و10.",true);return;}
 const row={gameId:g.gameId,oplGameId:oplGameId||null,title:$("metaTitle").value.trim().slice(0,120),genre:$("metaGenre").value.trim().slice(0,60),region:$("metaRegion").value.trim().slice(0,30),year,rating,notes:$("metaNotes").value.trim().slice(0,1000),updatedAt:new Date().toISOString()};
 try{await putMetadata(row);g.meta=row;g.oplGameId=row.oplGameId||(valid(g.gameId)?g.gameId:null);await inspect();$("gameDialog").hidden=true;render();log("حُفظت بيانات "+g.gameId+" محلياً.");msg("تم حفظ بيانات اللعبة.");}
 catch(e){msg("فشل الحفظ: "+e.message,true);}
}
async function backupDb(){try{const payload={app:"Saad PS2 Ultimate",schema:2,exportedAt:new Date().toISOString(),games:await allMetadata(),library:await allLibrary()},url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:"application/json"})),a=document.createElement("a");a.href=url;a.download="saad-ps2-database-backup.json";a.click();setTimeout(()=>URL.revokeObjectURL(url),1200);msg("تم إنشاء النسخة الاحتياطية.");}catch(e){msg("تعذر إنشاء النسخة: "+e.message,true);}}
async function restoreDb(file){
 try{
  const data=JSON.parse(await file.text());
  if(data.app!=="Saad PS2 Ultimate"||!Array.isArray(data.games))throw new Error("ملف النسخة الاحتياطية غير صالح");
  let count=0;
  for(const v of data.games){
   if(!v||!validRecordKey(v.gameId))continue;
   const oplGameId=valid(v.oplGameId)?String(v.oplGameId).toUpperCase().replace("-","_"):(valid(v.gameId)?v.gameId:null);
   await putMetadata({gameId:v.gameId,oplGameId,title:String(v.title||"").slice(0,120),genre:String(v.genre||"").slice(0,60),region:String(v.region||"").slice(0,30),year:String(v.year||"").slice(0,4),rating:String(v.rating||"").slice(0,4),notes:String(v.notes||"").slice(0,1000),updatedAt:v.updatedAt||new Date().toISOString()});
   count++;
  }
  if(Array.isArray(data.library)){
   const inventory=[];
   for(const v of data.library){
    if(!v||!["ISO","ZSO","UL","BIN","CUE","IMG","CHD","PBP","VCD"].includes(v.format))continue;
    const source=String(v.source||v.title||"restored");
    const gameId=validRecordKey(v.gameId)?v.gameId:localKey("FILE",source);
    const recordKey=/^LIB_[A-F0-9]{8}$/.test(String(v.recordKey||""))?v.recordKey:localKey("LIB",source+"|"+gameId);
    inventory.push({recordKey,gameId,oplGameId:valid(v.oplGameId)?(isPs1Id(v.oplGameId)?normalizePs1Id(v.oplGameId):String(v.oplGameId).toUpperCase().replace("-","_")):(valid(gameId)?gameId:null),title:String(v.title||"").slice(0,180),format:v.format,size:Number.isFinite(Number(v.size))?Math.max(0,Number(v.size)):0,source,hasCover:!!v.hasCover,hasIcon:!!v.hasIcon,ulStartup:String(v.ulStartup||"").slice(0,12),ulParts:Number(v.ulParts)||0,ulAvailableParts:Number(v.ulAvailableParts)||0,ulMissingParts:Number(v.ulMissingParts)||0,ulPartsComplete:!!v.ulPartsComplete,ulPartNumbers:Array.isArray(v.ulPartNumbers)?v.ulPartNumbers.filter(n=>Number.isInteger(n)&&n>=0&&n<256):[],ulMedia:String(v.ulMedia||"UNKNOWN")});
   }
   await saveLibrary(inventory);S.games=inventory;
  }
  await hydrateMetadata();if(S.root)await inspect();render();
  if(!S.root&&S.games.length){$("driveName").textContent="مكتبة مستعادة";$("driveInfo").textContent=S.games.length+" لعبة؛ اختر USB لتحديث بياناته";}
  log("تم استيراد "+count+" سجل بيانات و"+S.games.length+" لعبة في الفهرس.");msg("تم استيراد "+count+" سجل بيانات و"+S.games.length+" لعبة.");
 }catch(e){msg("تعذر استيراد النسخة: "+e.message,true);}
}
document.addEventListener("click",e=>{const b=e.target.closest("[data-game]");if(b)showGame(b.dataset.game);});
$("closeDialog").onclick=()=>$("gameDialog").hidden=true;
$("gameDialog").addEventListener("click",e=>{if(e.target===$("gameDialog"))$("gameDialog").hidden=true;});
$("saveMeta").onclick=saveGameMeta;
$("deleteMeta").onclick=async()=>{if(!S.activeGame)return;await removeMetadata(S.activeGame.gameId);S.activeGame.meta=null;S.activeGame.oplGameId=valid(S.activeGame.gameId)?S.activeGame.gameId:null;await inspect();$("gameDialog").hidden=true;render();msg("تم مسح البيانات الإضافية.");};
$("backup").onclick=backupDb;
$("restore").onclick=()=>$("restoreFile").click();
$("restoreFile").onchange=e=>{if(e.target.files[0])restoreDb(e.target.files[0]);e.target.value="";};

render();
S.catalogReady=syncCentralCatalog();
function renderStorageCapabilities(){
 const c=window.PS2Database?.storageCapabilities();if(!c)return;
 const e=$("storageSupport");e.innerHTML="<b>دعم وحدات التخزين على الجهاز:</b> "+esc(c.message)+"<br><b>صلاحية الموقع:</b> "+(c.write?"قراءة وكتابة بعد موافقة المستخدم":"الوصول المباشر للكتابة غير متاح")+(c.ios?" · جهاز iPad/iPhone":"")+"<br><b>توافق OPL USB:</b> "+esc(c.oplUsbFilesystems);
}
async function runDiagnostics(){
 const out=$("diagnosticResults");out.hidden=false;out.textContent="جارٍ فحص محتوى ملفات ART ومكتبة الألعاب...";
 const report=window.PS2Database.inspectLibrary(S.games);
 let art={files:0,covers:0,icons:0,valid:[],invalid:[],missing:[]};
 if(S.root){try{art=await window.PS2Database.inspectArt(S.root);}catch(e){art.missing.push("تعذر فحص ART: "+e.message);}}
 const lines=["عدد سجلات الألعاب: "+report.total,"سجلات بمعرّف صالح: "+report.identified,"سجلات بلا Game ID: "+report.missingId,"معرّفات مكررة: "+report.duplicateIds,"ألعاب UL غير المكتملة: "+report.incompleteUl,"كل ملفات ART: "+art.files,"أغلفة تم فتحها والتحقق من أبعادها (140×200): "+art.covers,"أيقونات تم فتحها والتحقق من أبعادها (64×64): "+art.icons,"صور تالفة أو بأبعاد غير مطابقة: "+art.invalid.length];
 if(art.missing.length)lines.push(...art.missing);
 if(art.invalid.length)lines.push(...art.invalid.slice(0,30).map(x=>x.name+": "+x.actual+" (المطلوب "+x.expected+")"));
 if(report.issues.length)lines.push(...report.issues.slice(0,50).map(x=>x.title+": "+x.message));
 if(!S.root)lines.push("لم يتم اختيار وحدة USB؛ فحص المحتوى غير ممكن قبل اختيارها.");
 out.textContent=lines.join("\n");
 log("التحقق الفعلي من الصور: أغلفة سليمة "+art.covers+"، أيقونات سليمة "+art.icons+"، صور تالفة "+art.invalid.length+".");
}
async function testUsbDrive(){
 const out=$("usbTestResults");
 out.hidden=false;
 out.textContent="جارٍ تجهيز اختبار كتابة وقراءة غير هدّام...";
 if(!S.root){out.textContent="لم يتم اختيار وحدة USB. اختر وحدة التخزين أولاً ثم أعد الاختبار.";return;}
 const cryptoApi=window.crypto;
 if(!cryptoApi||typeof cryptoApi.getRandomValues!=="function"){out.textContent="هذا المتصفح لا يوفر مولد بيانات عشوائية آمناً؛ تعذر بدء الاختبار.";return;}
 let name="",handle=null,passed=false,cleanup=true,errorMessage="",mismatch=-1;
 const bytes=4*1024*1024,payload=new Uint8Array(bytes),started=performance.now();
 try{
  await ensureWritePermission();
  const token=new Uint8Array(12);
  cryptoApi.getRandomValues(token);
  name=".__saad_usb_probe_"+Array.from(token,x=>x.toString(16).padStart(2,"0")).join("")+".tmp";
  for(let offset=0;offset<payload.length;offset+=65536)cryptoApi.getRandomValues(payload.subarray(offset,Math.min(offset+65536,payload.length)));
  handle=await S.root.getFileHandle(name,{create:true});
  const writer=await handle.createWritable({keepExistingData:false});
  try{await writer.write(payload);await writer.close();}
  catch(writeError){try{await writer.abort();}catch(e){}throw writeError;}
  const saved=await handle.getFile();
  if(saved.size!==bytes)throw new Error("الحجم بعد الكتابة لا يطابق الحجم المرسل: "+saved.size+" / "+bytes+" بايت.");
  const readBack=new Uint8Array(await saved.arrayBuffer());
  if(readBack.length!==payload.length)throw new Error("حجم القراءة الراجعة غير مطابق.");
  for(let i=0;i<payload.length;i++){if(readBack[i]!==payload[i]){mismatch=i;break;}}
  if(mismatch!==-1)throw new Error("اختلاف بيانات عند البايت رقم "+mismatch+".");
  passed=true;
 }catch(e){errorMessage=e.message||String(e);}
 finally{
  if(name){try{await S.root.removeEntry(name);}catch(e){cleanup=false;}}
 }
 const elapsed=((performance.now()-started)/1000).toFixed(2);
 const lines=[
  "نتيجة اختبار الكتابة والقراءة: "+(passed?"نجح":"فشل"),
  "حجم الاختبار: 4 MiB ("+bytes.toLocaleString("en-US")+" بايت)",
  "التحقق: "+(passed?"تمت مطابقة جميع البايتات بعد إغلاق الملف وإعادة فتحه":"لم تكتمل مطابقة البيانات"),
  "حذف ملف الاختبار المؤقت: "+(cleanup?"تم":"تعذر الحذف؛ احذف الملف "+name+" يدوياً"),
  "المدة: "+elapsed+" ثانية"
 ];
 if(errorMessage)lines.push("السبب: "+errorMessage);
 lines.push("حدود الاختبار: هذا يثبت أن مسار الكتابة والقراءة الحالي يعمل لهذا الحجم فقط؛ ولا يقيس صحة شرائح NAND أو كامل سعة الفلاش ولا يغني عن فحص قطاعات شامل.");
 out.textContent=lines.join("\n");
 log("اختبار USB: "+(passed?"نجح":"فشل")+"؛ تنظيف الملف المؤقت: "+(cleanup?"نجح":"تعذر")+".");
 msg(passed?"نجح اختبار الكتابة والقراءة للفلاش.":"فشل اختبار الفلاش أو لم تكتمل الكتابة والقراءة.",!passed||!cleanup);
}
if($("runDiagnostics"))$("runDiagnostics").onclick=runDiagnostics;
if($("runUsbTest"))$("runUsbTest").onclick=testUsbDrive;
if($("fallbackPick"))$("fallbackPick").onclick=()=>$("fallbackFiles").click();
if($("fallbackFilesPick"))$("fallbackFilesPick").onclick=()=>$("fallbackSingleFiles").click();
if($("fallbackFiles"))$("fallbackFiles").addEventListener("change",e=>{if(e.target.files?.length)scanSelectedFiles(e.target.files);e.target.value="";});
if($("fallbackSingleFiles"))$("fallbackSingleFiles").addEventListener("change",e=>{if(e.target.files?.length)scanSelectedFiles(e.target.files);e.target.value="";});

renderStorageCapabilities();
