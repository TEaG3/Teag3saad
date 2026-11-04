"use strict";
const $=id=>document.getElementById(id);
const S={root:null,offline:null,games:[],filter:"all",query:"",logs:[],busy:false,db:null,activeGame:null};
const coverUrls=id=>[
"https://raw.githubusercontent.com/xlenore/ps2-covers/main/covers/default/"+id.replace("_","-")+".jpg",
"https://raw.githubusercontent.com/xlenore/ps2-covers/main/covers/default/"+id+".jpg",
"https://art.gametdb.com/ps2/cover/US/"+id.replace("_","-")+".jpg"];
function msg(t,error=false){const e=$("toast");e.textContent=t;e.className="toast show"+(error?" error":"");clearTimeout(msg.timer);msg.timer=setTimeout(()=>e.className="toast",4000);}
function log(t){S.logs.unshift({t,at:new Date().toLocaleString("ar-IQ")});$("logs").innerHTML=S.logs.map(x=>'<div class="log-entry">'+esc(x.t)+' <small>— '+esc(x.at)+'</small></div>').join("");}
function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function valid(id){return /^[A-Z]{4}_\d{3}\.\d{2}$/.test(String(id||"").toUpperCase().replace("-","_"));}
function validRecordKey(id){return valid(id)||/^UL_[A-F0-9]{8}$/.test(String(id||""));}
function effectiveId(g){const id=g?.oplGameId||(valid(g?.gameId)?g.gameId:"");return valid(id)?String(id).toUpperCase().replace("-","_"):"";}
function idFromName(name){const m=String(name||"").toUpperCase().match(/\b([A-Z]{4}[_-]\d{3}\.\d{2})\b/);return m?m[1].replace("-","_"):null;}
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
    out.push({title:e.name.replace(/\.(iso|zso)$/i,""),gameId:id||"UNKNOWN",oplGameId:id||null,format:isIso?"ISO":"ZSO",size:f.size,hasCover:false,hasIcon:false,source:name+"/"+e.name});
   }catch(err){log("تعذر قراءة "+e.name);}
  }
 }catch(e){}
 return out;
}
async function parseUl(root,h){
 const f=await h.getFile(),b=new Uint8Array(await f.arrayBuffer()),out=[],rootFiles=[];
 for await(const e of root.values())if(e.kind==="file")rootFiles.push(e);
 const dec=new TextDecoder("ascii");
 for(let o=0,index=0;o+64<=b.length;o+=64,index++){
  const name=dec.decode(b.slice(o,o+32)).split("\0")[0].trim();
  const image=dec.decode(b.slice(o+32,o+47)).split("\0")[0].trim();
  const parts=b[o+47],media=b[o+48];
  if(!name||!image)continue;
  const fullId=idFromName(image);
  const crcMatch=image.match(/^ul\.([0-9a-f]{8})/i);
  if(!fullId&&!crcMatch)continue;
  const crc=crcMatch?crcMatch[1].toUpperCase():String(index+1).padStart(8,"0");
  const key=fullId||("UL_"+crc);
  const partPrefix=crcMatch?("ul."+crcMatch[1]).toLowerCase():null;
  const related=partPrefix?rootFiles.filter(e=>e.name.toLowerCase().startsWith(partPrefix+".")&&/^ul\.[0-9a-f]{8}\..+\.\d{2}$/i.test(e.name)):[];
  let size=0;
  for(const e of related){try{size+=(await e.getFile()).size;}catch(err){}}
  let suffix="";
  for(const e of related){const m=e.name.match(/^ul\.[0-9a-f]{8}\.([a-z]_\d{3}\.\d{2})\.\d{2}$/i);if(m){suffix=m[1].toUpperCase();break;}}
  out.push({title:name,gameId:key,oplGameId:fullId||null,format:"UL",size,hasCover:false,hasIcon:false,source:"ul.cfg",ulImage:image,ulCrc:crc,ulParts:parts,ulMedia:media===0x12?"CD":media===0x14?"DVD":"UNKNOWN",ulAvailableParts:related.length,ulSerialSuffix:suffix});
 }
 return out;
}
async function inspect(){
 const artNames=new Set();
 try{for await(const e of (await S.root.getDirectoryHandle("ART")).values())if(e.kind==="file")artNames.add(e.name.toUpperCase());}catch(e){}
 S.games.forEach(g=>{
  const id=effectiveId(g);
  g.hasCover=!!id&&(artNames.has(id+"_COV.JPG")||artNames.has(id+"_COV.PNG"));
  g.hasIcon=!!id&&artNames.has(id+"_ICO.PNG");
 });
}
async function scan(){
 if(!("showDirectoryPicker"in window)){msg("اختيار المجلد غير مدعوم هنا. استخدم Chrome أو Edge على الحاسوب.",true);return;}
 try{
  S.root=await showDirectoryPicker({mode:"readwrite"});
  $("driveName").textContent=S.root.name;$("driveDot").classList.add("on");$("driveInfo").textContent="تم اختيار مجلد التخزين";
  $("games").innerHTML='<tr><td colspan="8" class="empty">جارٍ الفحص...</td></tr>';
  S.games=[...(await scanFolder(S.root,"DVD")),...(await scanFolder(S.root,"CD"))];
  try{S.games.push(...await parseUl(S.root,await S.root.getFileHandle("ul.cfg")));}catch(e){}
  await hydrateMetadata();await inspect();render();
  const unknownUl=S.games.filter(g=>g.format==="UL"&&!effectiveId(g)).length;
  log("اكتمل الفحص: "+S.games.length+" لعبة.");
  msg("اكتمل الفحص: "+S.games.length+" لعبة."+ (unknownUl?" · عيّن Game ID لألعاب UL من التفاصيل.":""));
 }catch(e){if(e.name!=="AbortError")msg("تعذر فحص المجلد: "+e.message,true);}
}
function render(){
 const iso=S.games.filter(g=>g.format==="ISO").length,zso=S.games.filter(g=>g.format==="ZSO").length,ul=S.games.filter(g=>g.format==="UL").length,cov=S.games.filter(g=>g.hasCover).length;
 const miss=S.games.filter(g=>!effectiveId(g)||!g.hasCover||!g.hasIcon).length;
 $("total").textContent=S.games.length;$("iso").textContent=iso+zso;$("ul").textContent=ul;$("covers").textContent=cov;
 $("allCount").textContent=S.games.length;$("missingCount").textContent=miss;
 $("sGames").textContent=S.games.length;$("sIso").textContent=iso+zso;$("sUl").textContent=ul;$("sSize").textContent=fmt(S.games.reduce((a,g)=>a+g.size,0));
 $("csv").disabled=!S.games.length;$("rescan").disabled=!S.root;$("missing").disabled=!S.games.length;$("all").disabled=!S.games.length;
 const rows=S.games.filter(g=>(!S.query||(((g.meta?.title||g.title)+" "+(effectiveId(g)||g.gameId)).toLowerCase().includes(S.query)))&&(S.filter==="all"||(S.filter==="missing"&&(!effectiveId(g)||!g.hasCover||!g.hasIcon))||S.filter===g.format));
 $("games").innerHTML=rows.length?rows.map(g=>{
  const id=effectiveId(g),displayId=id||g.gameId,cover=id?coverUrls(id)[0]:"";
  return '<tr><td>'+(cover?'<img class="cover" src="'+cover+'" onerror="this.style.visibility=\'hidden\'" alt="">':'—')+'</td><td>'+esc(g.meta?.title||g.title)+'</td><td class="id">'+esc(displayId)+'</td><td>'+g.format+'</td><td>'+fmt(g.size)+'</td><td><span class="tag '+(g.hasCover?"ok":"bad")+'">'+(g.hasCover?"متوفر":"ناقص")+'</span></td><td><span class="tag '+(g.hasIcon?"ok":"bad")+'">'+(g.hasIcon?"متوفر":"ناقص")+'</span></td><td><button class="row-action" data-game="'+esc(g.gameId)+'">تفاصيل</button></td></tr>';
 }).join(""):'<tr><td colspan="8" class="empty">لا توجد نتائج.</td></tr>';
}
async function fetchArt(id){if(S.offline){for(const n of [id+".jpg",id+".png",id+"_COV.jpg",id+"_COV.png",id.replace("_","-")+".jpg"]){try{return await(await S.offline.getFileHandle(n)).getFile();}catch(e){}}}for(const url of coverUrls(id)){try{const r=await fetch(url);if(r.ok&&r.headers.get("content-type")?.startsWith("image/"))return await r.blob();}catch(e){}}return null;}
async function save(dir,name,blob){const w=await(await dir.getFileHandle(name,{create:true})).createWritable();await w.write(blob);await w.close();}
async function convertArt(blob,type,width,height,cropSquare=false){
 const bmp=await createImageBitmap(blob),canvas=document.createElement("canvas");
 canvas.width=width;canvas.height=height;
 const ctx=canvas.getContext("2d");
 if(!ctx){bmp.close();throw new Error("تعذر تجهيز الصورة");}
 if(cropSquare){
  const side=Math.min(bmp.width,bmp.height),sx=(bmp.width-side)/2,sy=(bmp.height-side)/2;
  ctx.drawImage(bmp,sx,sy,side,side,0,0,width,height);
 }else{ctx.drawImage(bmp,0,0,width,height);}
 bmp.close();
 const converted=await new Promise(resolve=>canvas.toBlob(resolve,type,type==="image/jpeg"?0.9:undefined));
 if(!converted)throw new Error("تعذر تحويل الصورة إلى "+type);
 return converted;
}
async function toJpeg(blob){return convertArt(blob,"image/jpeg",140,200,false);}
async function toPng(blob){return convertArt(blob,"image/png",64,64,true);}
async function download(onlyMissing){
 if(!S.root){msg("اختر وحدة التخزين أولاً.",true);return;}
 const list=S.games.filter(g=>valid(effectiveId(g))&&(!onlyMissing||!g.hasCover||!g.hasIcon));
 if(!list.length){msg("لا توجد صور قابلة للحفظ. لألعاب UL أدخل Game ID الصحيح من تفاصيل اللعبة أولاً.",true);return;}
 const art=await S.root.getDirectoryHandle("ART",{create:true});
 $("progress").hidden=false;let ok=0,fail=0;
 for(let i=0;i<list.length;i++){
  const g=list[i],id=effectiveId(g);
  $("progressText").textContent="تحميل "+g.title;$("progressCount").textContent=(i+1)+" / "+list.length;
  $("progressBar").style.width=((i+1)/list.length*100)+"%";$("progressDetail").textContent=id;
  try{
   const blob=await fetchArt(id);if(!blob){fail++;continue;}
   const cover=await toJpeg(blob),icon=await toPng(blob);
   await save(art,id+"_COV.jpg",cover);await save(art,id+"_ICO.png",icon);
   g.hasCover=true;g.hasIcon=true;ok++;
  }catch(e){fail++;log("تعذر تجهيز صور "+id+": "+e.message);}
 }
 render();log("اكتمل تحميل الصور داخل ART. نجاح "+ok+"، تعذر "+fail+".");
 $("progressText").textContent="اكتملت العملية";$("progressDetail").textContent="نجح "+ok+" · تعذر "+fail;
 msg("انتهى التحميل: "+ok+" ناجح، "+fail+" غير متاح.");
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
$("scan").onclick=scan;$("rescan").onclick=scan;$("csv").onclick=csv;$("missing").onclick=()=>download(true);$("all").onclick=()=>download(false);$("search").oninput=e=>{S.query=e.target.value.toLowerCase();render();};$("menu").onclick=()=>$("sidebar").classList.toggle("open");
$("offline").onclick=async()=>{if(!("showDirectoryPicker"in window)){msg("اختيار المجلد غير مدعوم في هذا المتصفح.",true);return;}try{S.offline=await showDirectoryPicker({mode:"read"});$("offlineName").textContent=S.offline.name;msg("تم اختيار مجلد الصور.");}catch(e){}};
if("serviceWorker"in navigator&&location.protocol.startsWith("http"))navigator.serviceWorker.register("./sw.js").catch(()=>{});

function openDb(){return new Promise((resolve,reject)=>{const req=indexedDB.open("saad-ps2-db",1);req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains("games"))req.result.createObjectStore("games",{keyPath:"gameId"});};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
async function getDb(){if(!S.db)S.db=await openDb();return S.db;}
async function allMetadata(){const d=await getDb();return new Promise((resolve,reject)=>{const r=d.transaction("games","readonly").objectStore("games").getAll();r.onsuccess=()=>resolve(r.result||[]);r.onerror=()=>reject(r.error);});}
async function putMetadata(v){const d=await getDb();return new Promise((resolve,reject)=>{const tx=d.transaction("games","readwrite");tx.objectStore("games").put(v);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}
async function removeMetadata(id){const d=await getDb();return new Promise((resolve,reject)=>{const tx=d.transaction("games","readwrite");tx.objectStore("games").delete(id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}
async function hydrateMetadata(){
 try{
  const rows=await allMetadata(),map=new Map(rows.map(v=>[v.gameId,v]));
  S.games.forEach(g=>{g.meta=map.get(g.gameId)||null;g.oplGameId=g.meta?.oplGameId||(valid(g.gameId)?g.gameId:null);});
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
 const oplGameId=$("metaGameId").value.trim().toUpperCase().replace("-","_");
 if(oplGameId&&!valid(oplGameId)){msg("صيغة Game ID غير صحيحة. مثال: SLUS_203.12",true);return;}
 if(year&&!/^\d{4}$/.test(year)){msg("أدخل سنة صحيحة من أربعة أرقام.",true);return;}
 if(rating&&(!Number.isFinite(Number(rating))||Number(rating)<0||Number(rating)>10)){msg("التقييم يجب أن يكون بين 0 و10.",true);return;}
 const row={gameId:g.gameId,oplGameId:oplGameId||null,title:$("metaTitle").value.trim().slice(0,120),genre:$("metaGenre").value.trim().slice(0,60),region:$("metaRegion").value.trim().slice(0,30),year,rating,notes:$("metaNotes").value.trim().slice(0,1000),updatedAt:new Date().toISOString()};
 try{await putMetadata(row);g.meta=row;g.oplGameId=row.oplGameId||(valid(g.gameId)?g.gameId:null);$("gameDialog").hidden=true;render();log("حُفظت بيانات "+g.gameId+" محلياً.");msg("تم حفظ بيانات اللعبة.");}
 catch(e){msg("فشل الحفظ: "+e.message,true);}
}
async function backupDb(){try{const payload={app:"Saad PS2 Ultimate",schema:1,exportedAt:new Date().toISOString(),games:await allMetadata()},url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:"application/json"})),a=document.createElement("a");a.href=url;a.download="saad-ps2-database-backup.json";a.click();setTimeout(()=>URL.revokeObjectURL(url),1200);msg("تم إنشاء النسخة الاحتياطية.");}catch(e){msg("تعذر إنشاء النسخة: "+e.message,true);}}
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
  await hydrateMetadata();await inspect();render();log("تم استيراد "+count+" سجل.");msg("تم استيراد "+count+" سجل.");
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