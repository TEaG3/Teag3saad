"use strict";
(function(){
 const ID=/^[A-Z]{4}_\d{3}\.\d{2}$/;
 function normalizeId(value){
  const v=String(value||"").trim().toUpperCase().replace(/-/g,"_");
  return ID.test(v)?v:null;
 }
 function normalizeGameId(value){
  const ps2=normalizeId(value);if(ps2)return ps2;
  const ps1=String(value||"").trim().toUpperCase().replace(/_/g,"-");
  return /^[A-Z]{4}-\d{5}$/.test(ps1)?ps1:null;
 }
 function regionFromId(value){
  const id=normalizeGameId(value);if(!id)return {code:"UNKNOWN",label:"غير محددة",confidence:"none"};
  const p=id.slice(0,4);
  if(["SLES","SCES","SCED","SLED"].includes(p))return {code:"PAL",label:"PAL",confidence:"high"};
  if(["SLUS","SCUS"].includes(p))return {code:"NTSC-U",label:"NTSC-U",confidence:"high"};
  if(["SLPM","SCPS","SLPS"].includes(p))return {code:"NTSC-J",label:"NTSC-J",confidence:"medium"};
  if(["SLKA"].includes(p))return {code:"NTSC-K",label:"NTSC-K",confidence:"medium"};
  if(["SCAJ","SLAJ"].includes(p))return {code:"ASIA",label:"Asia",confidence:"medium"};
  return {code:"UNKNOWN",label:"غير محددة",confidence:"none"};
 }
 function classifyPlatform(serial,format){
  const id=String(serial||"").trim().toUpperCase();
  if(/^[A-Z]{4}-\d{5}$/.test(id.replace(/_/g,"-")))return "PS1";
  if(/^[A-Z]{4}_\d{3}\.\d{2}$/.test(id.replace(/-/g,"_")))return "PS2";
  // File extensions identify a container format, not the console generation.
  // Without a validated serial or catalog match, keep the platform unknown.
  return "UNKNOWN";
 }
 function inspectLibrary(games){
  const list=Array.isArray(games)?games:[];
  const byId=new Map(),bySource=new Map(),issues=[];
  for(const g of list){
   const id=normalizeGameId(g.oplGameId||g.gameId);
   if(id){if(!byId.has(id))byId.set(id,[]);byId.get(id).push(g);}
   const src=String(g.source||"").toLowerCase();
   if(src){if(!bySource.has(src))bySource.set(src,[]);bySource.get(src).push(g);}
   if(!id)issues.push({type:"missing-id",title:g.title||g.source||"لعبة غير معرّفة",message:"لا يوجد Game ID صالح؛ يلزم التحقق يدوياً."});
   if(!["ISO","ZSO","UL","VCD","BIN","CUE","IMG","CHD","PBP"].includes(String(g.format||"").toUpperCase()))issues.push({type:"format",title:g.title||"ملف",message:"صيغة غير معروفة في سجل المكتبة."});
   if(g.format!=="UL"&&(!Number.isFinite(Number(g.size))||Number(g.size)<=0))issues.push({type:"size",title:g.title||"ملف",message:"حجم الملف غير صالح أو صفر."});
   if(g.format==="UL"&&!g.ulPartsComplete)issues.push({type:"ul-incomplete",title:g.title||"UL",message:"أجزاء USBExtreme غير مكتملة أو لا يمكن التحقق منها."});
  }
  for(const [id,rows] of byId)if(rows.length>1)issues.push({type:"duplicate-id",title:id,message:"المعرّف مرتبط بـ "+rows.length+" سجلات؛ تحقق من النسخ أو المناطق."});
  for(const [src,rows] of bySource)if(rows.length>1)issues.push({type:"duplicate-source",title:src,message:"مصدر الملف مكرر في الفهرس."});
  return {total:list.length,identified:[...list].filter(g=>normalizeGameId(g.oplGameId||g.gameId)).length,missingId:list.filter(g=>!normalizeGameId(g.oplGameId||g.gameId)).length,duplicateIds:[...byId].filter(([,v])=>v.length>1).length,incompleteUl:list.filter(g=>g.format==="UL"&&!g.ulPartsComplete).length,issues,regions:list.reduce((o,g)=>{const r=regionFromId(g.oplGameId||g.gameId);o[r.code]=(o[r.code]||0)+1;return o;},{})};
 }
 async function inspectArt(root){
  const report={files:0,covers:0,icons:0,legacyIcons:0,valid:[],invalid:[],missing:[]};
  const folders=[];
  for(const folderName of ["ART","ICONS"]){
   try{folders.push({name:folderName,handle:await root.getDirectoryHandle(folderName)});}
   catch(e){report.missing.push("مجلد "+folderName+" غير موجود");}
  }
  for(const folder of folders){
   for await(const entry of folder.handle.values()){
    if(entry.kind!=="file")continue;
    const name=entry.name.toUpperCase();report.files++;
    const isCover=folder.name==="ART"&&/_COV\.(JPG|PNG)$/i.test(name);
    const isIcon=folder.name==="ICONS"&&/_ICO\.PNG$/i.test(name);
    if(folder.name==="ART"&&/_ICO\.PNG$/i.test(name)){report.legacyIcons++;continue;}
    if(!isCover&&!isIcon)continue;
    try{
     const file=await entry.getFile();
     if(!file.size)throw new Error("ملف فارغ");
     const bitmap=await createImageBitmap(file);
     const expected=isCover?[140,200]:[64,64],actual=bitmap.width+"×"+bitmap.height;
     const dimensions=bitmap.width===expected[0]&&bitmap.height===expected[1];
     bitmap.close();
     if(!dimensions){report.invalid.push({name:folder.name+"/"+name,actual,expected:expected.join("×")});continue;}
     report.valid.push(folder.name+"/"+name);
     if(isCover)report.covers++;
     if(isIcon)report.icons++;
    }catch(e){report.invalid.push({name:folder.name+"/"+name,actual:e.message||"ملف صورة غير قابل للقراءة",expected:isCover?"140×200":"64×64"});}
   }
  }
  return report;
 }
 function storageCapabilities(){
  const picker=typeof window.showDirectoryPicker==="function";
  const secure=!!window.isSecureContext;
  const ua=navigator.userAgent||"";
  const ios=/iPad|iPhone|iPod/.test(ua)||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1);
  return {picker,write:picker&&secure,secure,ios,mode:picker&&secure?"direct":"limited",message:!secure?"يلزم HTTPS أو localhost للوصول المباشر إلى المجلدات.":picker?"يمكن للموقع القراءة والكتابة على وحدة مركّبة يتعرف عليها نظام التشغيل بعد منح الإذن؛ المتصفح لا يهيئ نظام الملفات ولا يقرأ القرص الخام.":ios?"Safari على iPad/iPhone لا يوفر هنا وصولاً عاماً مضموناً للقراءة والكتابة إلى USB.":"هذا المتصفح لا يوفر واجهة اختيار مجلد مع صلاحية الكتابة؛ يلزم متصفح متوافق أو تطبيق أصلي.",oplUsbFilesystems:"يعتمد التعرف على FAT/FAT32/exFAT على نظام التشغيل والمتصفح؛ توافق تشغيل USB داخل OPL مستقل ويتوقف على إصدار OPL وإعداداته. لا يمكن للموقع ضمان تشغيل كل نظام ملفات."};
 }
 window.PS2Database={normalizeId,normalizeGameId,regionFromId,classifyPlatform,inspectLibrary,inspectArt,storageCapabilities};
})();