"use strict";
(function(){
 const $=id=>document.getElementById(id);
 const results=[];
 let running=false;
 const now=()=>new Date().toISOString();
 function add(id,name,status,detail,extra){
  results.push({id,name,status,detail,...(extra||{}),at:now()});
  render();
 }
 function render(){
  const host=$("testCases");if(!host)return;
  host.textContent="";
  for(const r of results){
   const card=document.createElement("article");card.className="test-case "+(r.status==="نجح"?"pass":r.status==="فشل"?"fail":"warn");
   const badge=document.createElement("b");badge.textContent=r.status;
   const title=document.createElement("strong");title.textContent=r.name;
   const detail=document.createElement("small");detail.textContent=r.detail;
   card.append(badge,title,detail);host.append(card);
  }
  const passed=results.filter(x=>x.status==="نجح").length,failed=results.filter(x=>x.status==="فشل").length,other=results.length-passed-failed;
  $("testSummary").innerHTML="";
  const head=document.createElement("b");head.textContent=running?"الاختبارات قيد التنفيذ":failed?"اكتمل الاختبار مع وجود إخفاقات":"اكتمل تنفيذ الاختبارات المتاحة";
  const body=document.createElement("span");body.textContent="ناجح: "+passed+" · فاشل: "+failed+" · غير متاح/تحذير: "+other+" · إجمالي الحالات: "+results.length;
  $("testSummary").append(head,body);
  $("exportTestReport").disabled=!results.length;
 }
 async function testResources(){
  const paths=["./index.html","./app.js","./ps2-database.js","./styles.css","./test-lab.js","./data/game-catalog.json"];
  const checked=[];
  for(const path of paths){const response=await fetch(path,{cache:"no-store"});checked.push({path,ok:response.ok,status:response.status});if(!response.ok)throw new Error(path+" أعاد HTTP "+response.status);}
  return "تم تحميل "+checked.length+" موارد فعلية بنجاح: "+checked.map(x=>x.path).join("، ");
 }
 async function testDatabase(){
  if(!("indexedDB" in window))throw new Error("IndexedDB غير مدعوم في هذا المتصفح.");
  const db=await new Promise((resolve,reject)=>{
   const req=indexedDB.open("saad-ps2-db");
   req.onsuccess=()=>resolve(req.result);
   req.onerror=()=>reject(req.error||new Error("تعذر فتح IndexedDB."));
   req.onblocked=()=>reject(new Error("قاعدة البيانات محجوبة بواسطة نسخة أخرى من الموقع."));
  });
  const stores=Array.from(db.objectStoreNames);db.close();
  if(!stores.includes("games")||!stores.includes("library")||!stores.includes("catalog"))throw new Error("مخازن قاعدة البيانات غير مكتملة: "+stores.join(", "));
  return "تم فتح قاعدة saad-ps2-db فعلياً. المخازن: "+stores.join("، ");
 }
 async function testCatalog(){
  const response=await fetch("./data/game-catalog.json",{cache:"no-store"});
  if(!response.ok)throw new Error("تعذر تحميل الكتالوج: HTTP "+response.status);
  const data=await response.json(),games=Array.isArray(data.games)?data.games:[];
  const ps1=games.filter(g=>g.platform==="PS1").length,ps2=games.filter(g=>g.platform==="PS2").length;
  if(!games.length||ps1===0||ps2===0)throw new Error("الكتالوج فارغ أو يفتقد سجلات PS1/PS2. PS1="+ps1+"، PS2="+ps2);
  return "قراءة JSON ناجحة؛ إجمالي "+games.length+"، PS1: "+ps1+"، PS2: "+ps2+"، الإصدار: "+(data.catalogVersion||"غير محدد");
 }
 async function testLibrary(){
  const bridge=window.SaadPS2TestBridge,state=bridge?.getState?.();
  if(!state)throw new Error("لم يتم ربط محرك المكتبة بمختبر الاختبار.");
  const report=window.PS2Database.inspectLibrary(state.games||[]);
  if(!report.total)return {status:"تحذير",detail:"لم تُفحص مكتبة بعد. اختر USB أو مجلد ملفات الألعاب أولاً.",extra:{total:0}};
  const bad=report.issues.filter(x=>x.type==="ul-incomplete"||x.type==="duplicate-id"||x.type==="duplicate-source").length;
  const detail="سجلات: "+report.total+"؛ معرّفات صالحة: "+report.identified+"؛ بلا معرّف: "+report.missingId+"؛ تكرار: "+report.duplicateIds+"؛ UL غير مكتمل: "+report.incompleteUl+"؛ ملاحظات حرجة: "+bad;
  return {status:bad?"تحذير":"نجح",detail,extra:{total:report.total,identified:report.identified,missingId:report.missingId,duplicateIds:report.duplicateIds,incompleteUl:report.incompleteUl,issues:report.issues}};
 }
 async function testArtworkDownload(){
  const bridge=window.SaadPS2TestBridge,state=bridge?.getState?.(),games=state?.games||[];
  const game=games.find(g=>bridge.effectiveId(g));
  if(!game)return {status:"تحذير",detail:"لا توجد لعبة ذات Game ID صالح لاختبار مصدر الغلاف. افحص المكتبة أولاً."};
  const id=bridge.effectiveId(game),blob=await bridge.fetchArt(id,game.platform||game.catalog?.platform);
  if(!blob||!blob.size)throw new Error("مصدر الأغلفة لم يُرجع بيانات.");
  if(!/^image\//i.test(blob.type||""))throw new Error("نوع الاستجابة ليس صورة: "+(blob.type||"غير معروف"));
  const bitmap=await createImageBitmap(blob),dims=bitmap.width+"×"+bitmap.height;bitmap.close();
  return "تم تنزيل صورة فعلية للعبة "+(game.title||id)+" ("+id+")؛ الحجم "+blob.size+" بايت؛ الأبعاد الأصلية "+dims+". لم تُحفظ الصورة على USB في هذا الاختبار.";
 }
 async function testArtFolder(){
  const state=window.SaadPS2TestBridge?.getState?.();
  if(!state?.root)return {status:"تحذير",detail:"لم يتم اختيار وحدة USB؛ لا يمكن فحص مجلد ART الفعلي."};
  const report=await window.PS2Database.inspectArt(state.root);
  if(report.missing?.length)return {status:"تحذير",detail:"تعذر العثور على مجلد ART أو لا توجد صور قابلة للفحص: "+report.missing.join("، "),extra:report};
  if(report.invalid.length)return {status:"فشل",detail:"صور غير سليمة أو بأبعاد خاطئة: "+report.invalid.length+"؛ أغلفة سليمة: "+report.covers+"؛ أيقونات سليمة: "+report.icons,extra:report};
  return {status:"نجح",detail:"تم فتح الصور من USB والتحقق منها؛ أغلفة: "+report.covers+"؛ أيقونات: "+report.icons+"؛ ملفات ART المفحوصة: "+report.files,extra:report};
 }
 async function testUsb(){
  const bridge=window.SaadPS2TestBridge,state=bridge?.getState?.();
  if(!state?.root)return {status:"تحذير",detail:"لم يتم اختيار وحدة USB. اخترها من صفحة المكتبة ثم أعد تشغيل الاختبار."};
  const r=await bridge.runUsbTest();
  if(!r)return {status:"فشل",detail:"لم يرجع اختبار USB نتيجة قابلة للتحقق."};
  return {status:r.passed&&r.cleanup?"نجح":"فشل",detail:"كتابة/قراءة "+r.bytes+" بايت؛ مطابقة: "+(r.passed?"نعم":"لا")+"؛ حذف الملف المؤقت: "+(r.cleanup?"نجح":"فشل")+(r.error?"؛ السبب: "+r.error:"")+"؛ الزمن: "+r.elapsedSeconds+" ثانية.",extra:r};
 }
 async function run(){
  if(running)return;running=true;results.length=0;render();
  $("runAllTests").disabled=true;$("exportTestReport").disabled=true;
  $("testRunTime").textContent="بدأ: "+new Date().toLocaleString("ar-IQ");
  const cases=[
   ["resources","ملفات الموقع والموارد",testResources],
   ["database","قاعدة البيانات المحلية",testDatabase],
   ["catalog","قاعدة بيانات الألعاب المركزية",testCatalog],
   ["library","فحص مكتبة الألعاب ومعرّفاتها",testLibrary],
   ["artwork-download","الاتصال بمصدر الأغلفة",testArtworkDownload],
   ["art-folder","سلامة مجلد ART",testArtFolder],
   ["usb","اختبار USB الفعلي",testUsb],
   ["emulator","تشغيل PCSX2 وDuckStation",async()=>({status:"غير متاح",detail:"GitHub Pages والمتصفح لا يستطيعان تشغيل برامج Windows المحلية أو محاكاة PS1/PS2 أصلياً. يلزم جسر تطبيق سطح مكتب أو محاكي WebAssembly موثوق ومصرّح به؛ لم يتم تسجيل نجاح وهمي."})]
  ];
  for(const [id,name,fn] of cases){
   try{
    const value=await fn();
    if(typeof value==="string")add(id,name,"نجح",value);
    else add(id,name,value.status||"نجح",value.detail||"",value.extra?{data:value.extra}:{});
   }catch(error){add(id,name,"فشل",error?.message||String(error));}
  }
  running=false;$("runAllTests").disabled=false;$("testRunTime").textContent="انتهى: "+new Date().toLocaleString("ar-IQ");
  render();
 }
 function exportReport(){
  const report={application:"Saad PS2 Ultimate",suite:"Real Test Lab",generatedAt:now(),environment:{userAgent:navigator.userAgent,platform:navigator.platform,secureContext:!!window.isSecureContext},summary:{total:results.length,passed:results.filter(x=>x.status==="نجح").length,failed:results.filter(x=>x.status==="فشل").length,unavailable:results.filter(x=>x.status==="تحذير"||x.status==="غير متاح").length},tests:results};
  const blob=new Blob([JSON.stringify(report,null,2)],{type:"application/json"}),url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url;a.download="saad-ps2-test-report-"+new Date().toISOString().replace(/[:.]/g,"-")+".json";a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);
 }
 $("runAllTests")?.addEventListener("click",run);
 $("exportTestReport")?.addEventListener("click",exportReport);
})();
