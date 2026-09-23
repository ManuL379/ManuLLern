
const ML = {
  starter: null,
  lessons: [],
  lessonMap: new Map(),
  deferredInstall: null,
  currentLesson: null,
  progressKey: "manullern_progress_v1",
  settingsKey: "manullern_settings_v1",
};

const $ = (q, root=document) => root.querySelector(q);
const $$ = (q, root=document) => [...root.querySelectorAll(q)];
const app = $("#app");
const homeBtn = $("#homeBtn");
const settingsBtn = $("#settingsBtn");

homeBtn.addEventListener("click", () => showHome());
settingsBtn.addEventListener("click", () => showSettings());

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  ML.deferredInstall = e;
});

window.addEventListener("appinstalled", () => {
  ML.deferredInstall = null;
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(()=>{}));
}

function cloneTemplate(id){
  return document.getElementById(id).content.cloneNode(true);
}

function loadProgress(){
  try{
    return JSON.parse(localStorage.getItem(ML.progressKey) || "{}");
  }catch{ return {}; }
}
function saveProgress(p){ localStorage.setItem(ML.progressKey, JSON.stringify(p)); }

function getLessonProgress(id){
  const p = loadProgress();
  return p[id] || {opened:0, completed:0, repeats:0, lastOpened:null};
}
function patchLessonProgress(id, patch){
  const p = loadProgress();
  const cur = p[id] || {opened:0, completed:0, repeats:0, lastOpened:null};
  p[id] = {...cur, ...patch};
  saveProgress(p);
  return p[id];
}

function formatStatus(id){
  const p = getLessonProgress(id);
  if (!p.opened) return "не начат";
  if (p.completed) return p.repeats ? `пройден · повторов ${p.repeats}` : "пройден";
  return "начат";
}

function safeText(s){ return String(s ?? ""); }
function escapeHtml(s){
  return String(s ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[ch]));
}

function speakDE(text){
  if (!("speechSynthesis" in window)){
    alert("Озвучивание не поддерживается этим браузером.");
    return;
  }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "de-DE";
  u.rate = 0.92;
  const voices = speechSynthesis.getVoices();
  const de = voices.find(v => (v.lang||"").toLowerCase().startsWith("de"));
  if (de) u.voice = de;
  speechSynthesis.speak(u);
}

function normalizedBasic(s){
  return String(s||"")
    .normalize("NFC")
    .replace(/[„“”"'.!,?;:()[\]{}\-–—]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function lowerBasic(s){ return normalizedBasic(s).toLocaleLowerCase("de-DE"); }
function foldGerman(s){
  return lowerBasic(s)
    .replaceAll("ä","a").replaceAll("ö","o").replaceAll("ü","u")
    .replaceAll("ß","ss");
}
function levenshtein(a,b){
  a = lowerBasic(a); b = lowerBasic(b);
  const prev = Array(b.length+1).fill(0).map((_,i)=>i);
  for (let i=1;i<=a.length;i++){
    let cur=[i];
    for (let j=1;j<=b.length;j++){
      cur[j]=Math.min(cur[j-1]+1, prev[j]+1, prev[j-1]+(a[i-1]===b[j-1]?0:1));
    }
    for (let j=0;j<cur.length;j++) prev[j]=cur[j];
  }
  return prev[b.length];
}

function evaluateAnswer(value, accepted){
  const raw = normalizedBasic(value);
  if (!raw) return {kind:"empty"};
  // Exact including capitalization, ignoring punctuation.
  for (const a of accepted){
    if (raw === normalizedBasic(a)) return {kind:"good", nearest:a};
  }
  // Same content, capitalization differs.
  for (const a of accepted){
    if (lowerBasic(value) === lowerBasic(a)) return {kind:"case", nearest:a};
  }
  // Umlaut/ß issue only.
  for (const a of accepted){
    if (foldGerman(value) === foldGerman(a)) return {kind:"diacritic", nearest:a};
  }
  const ranked = accepted.map(a => ({a,d:levenshtein(value,a)})).sort((x,y)=>x.d-y.d);
  const best = ranked[0];
  const limit = Math.max(2, Math.round(lowerBasic(best.a).length * 0.10));
  if (best.d <= limit) return {kind:"near", nearest:best.a};
  return {kind:"wrong", nearest:best.a};
}

function renderSentence(de, ru, prefix=""){
  const wrap = document.createElement("div");
  wrap.className = "sentence";
  wrap.dataset.lang = "de";
  const txt = document.createElement("div");
  txt.className = "txt";
  txt.textContent = prefix + de;
  const speak = document.createElement("button");
  speak.className = "speaker";
  speak.textContent = "🔊";
  speak.type = "button";
  speak.addEventListener("click", e => { e.stopPropagation(); speakDE(de); });
  wrap.append(txt, speak);
  wrap.addEventListener("click", () => {
    if (wrap.dataset.lang === "de"){
      txt.textContent = ru;
      wrap.dataset.lang = "ru";
      wrap.classList.add("translation");
    } else {
      txt.textContent = prefix + de;
      wrap.dataset.lang = "de";
      wrap.classList.remove("translation");
    }
  });
  return wrap;
}

function clearApp(){
  window.speechSynthesis?.cancel?.();
  app.innerHTML = "";
}

async function init(){
  ML.starter = await fetch("data/starter_pack.json").then(r=>r.json());
  await refreshLessons();
  showHome();
}

async function openDb(){
  return new Promise((resolve,reject)=>{
    const req = indexedDB.open("manullern_db_v1", 1);
    req.onupgradeneeded = () => {
      const db=req.result;
      if(!db.objectStoreNames.contains("packs")) db.createObjectStore("packs",{keyPath:"packageId"});
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
}
async function listImportedPacks(){
  try{
    const db=await openDb();
    return await new Promise((resolve,reject)=>{
      const tx=db.transaction("packs","readonly");
      const req=tx.objectStore("packs").getAll();
      req.onsuccess=()=>resolve(req.result||[]);
      req.onerror=()=>reject(req.error);
    });
  }catch{return [];}
}
async function savePack(pack){
  const db=await openDb();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction("packs","readwrite");
    tx.objectStore("packs").put(pack);
    tx.oncomplete=()=>resolve();
    tx.onerror=()=>reject(tx.error);
  });
}
function assertShortString(v, label, max=1000){
  if(typeof v!=="string" || v.length>max) throw new Error(`${label}: неверный текст.`);
}
function validatePairList(arr, label, maxItems=100, maxText=1200){
  if(!Array.isArray(arr) || arr.length>maxItems) throw new Error(`${label}: неверный список.`);
  for(const row of arr){
    if(!Array.isArray(row) || row.length<2 || row.length>3) throw new Error(`${label}: неверная строка.`);
    row.forEach((v,i)=>assertShortString(v, `${label}[${i}]`, maxText));
  }
}
function validatePack(pack){
  if(!pack || typeof pack!=="object" || Array.isArray(pack) || pack.formatVersion!==1 || typeof pack.packageId!=="string" || !pack.packageId.trim() || pack.packageId.length>120 || !Array.isArray(pack.lessons)) throw new Error("Неверный формат пакета.");
  if(pack.lessons.length<1 || pack.lessons.length>100) throw new Error("В одном пакете допускается от 1 до 100 уроков.");
  const ids=new Set();
  for(const L of pack.lessons){
    if(!L || typeof L!=="object" || Array.isArray(L)) throw new Error("Неверный урок.");
    if(!Number.isInteger(L.id) || L.id<1 || L.id>100000 || ids.has(L.id)) throw new Error("Ошибка ID уроков.");
    ids.add(L.id);
    assertShortString(L.title, `Урок ${L.id}: название`, 200);
    if(!Array.isArray(L.anki) || L.anki.length!==2 || !L.anki.every(Number.isInteger) || L.anki[0]<1 || L.anki[1]<L.anki[0]) throw new Error(`Урок ${L.id}: неверный диапазон Anki.`);
    if(!L.micro || typeof L.micro!=="object") throw new Error(`Урок ${L.id}: нет микромодели.`);
    assertShortString(L.micro.pattern, `Урок ${L.id}: микромодель`, 500);
    assertShortString(L.micro.note ?? "", `Урок ${L.id}: пояснение`, 1000);
    validatePairList(L.micro.examples ?? [], `Урок ${L.id}: примеры микромодели`, 10, 800);
    validatePairList(L.text, `Урок ${L.id}: текст`, 100, 2000);
    validatePairList(L.dialogue, `Урок ${L.id}: диалог`, 100, 1500);
    validatePairList(L.phrases, `Урок ${L.id}: фразы`, 30, 1200);
    if(!Array.isArray(L.questions) || L.questions.length>30) throw new Error(`Урок ${L.id}: неверные вопросы.`);
    if(!Array.isArray(L.words) || L.words.length<1 || L.words.length>100) throw new Error(`Урок ${L.id}: нет списка слов.`);
    for(const w of L.words){
      if(!w || typeof w!=="object" || !Number.isInteger(w.rank) || w.rank<1) throw new Error(`Урок ${L.id}: неверное слово.`);
      assertShortString(w.de, `Урок ${L.id}: немецкое слово`, 200);
      assertShortString(w.ru, `Урок ${L.id}: перевод слова`, 600);
    }
    for(const q of L.questions){
      if(!q || typeof q!=="object") throw new Error(`Урок ${L.id}: неверный вопрос.`);
      assertShortString(q.q, `Урок ${L.id}: вопрос`, 1200);
      assertShortString(q.hint ?? "", `Урок ${L.id}: подсказка`, 1200);
      if(!Array.isArray(q.accepted) || q.accepted.length<1 || q.accepted.length>5) throw new Error(`Урок ${L.id}: неверный вопрос.`);
      q.accepted.forEach(a=>assertShortString(a, `Урок ${L.id}: вариант ответа`, 1500));
    }
  }
  return true;
}
async function refreshLessons(){
  const packs=[ML.starter, ...(await listImportedPacks())];
  const map=new Map();
  for(const p of packs){
    for(const L of p.lessons) map.set(L.id, L);
  }
  ML.lessons=[...map.values()].sort((a,b)=>a.id-b.id);
  ML.lessonMap=new Map(ML.lessons.map(L=>[L.id,L]));
}

function showHome(){
  clearApp();
  homeBtn.style.visibility="hidden";
  settingsBtn.style.visibility="visible";
  app.append(cloneTemplate("homeTemplate"));
  $("#offlineBadge").textContent = navigator.onLine ? "можно офлайн" : "офлайн";
  window.addEventListener("online", updateOnlineBadge, {once:true});
  window.addEventListener("offline", updateOnlineBadge, {once:true});

  const list=$("#lessonList");
  for(const L of ML.lessons){
    const card=document.createElement("div");
    card.className="lesson-card";
    const left=document.createElement("div");
    left.innerHTML = `<div class="lesson-title">${L.id}. ${escapeHtml(L.title)}</div>
      <div class="lesson-meta">Anki ${L.anki[0]}–${L.anki[1]} · 10 слов</div>`;
    const st=document.createElement("div");
    st.className="lesson-status";
    st.textContent=formatStatus(L.id);
    card.append(left,st);
    card.addEventListener("click",()=>showLesson(L.id));
    list.append(card);
  }
}
function updateOnlineBadge(){
  const b=$("#offlineBadge");
  if(b) b.textContent=navigator.onLine?"можно офлайн":"офлайн";
}

async function showSettings(){
  clearApp();
  homeBtn.style.visibility="visible";
  settingsBtn.style.visibility="hidden";
  app.append(cloneTemplate("settingsTemplate"));

  const installBtn=$("#installBtn"), hint=$("#installHint");
  installBtn.addEventListener("click", async ()=>{
    if(ML.deferredInstall){
      ML.deferredInstall.prompt();
      await ML.deferredInstall.userChoice;
      ML.deferredInstall=null;
      hint.textContent="Если иконка не появилась: меню Brave → «Добавить на главный экран».";
    }else{
      hint.textContent="В Brave: меню ⋮ → «Добавить на главный экран» / «Установить приложение».";
    }
  });

  $("#exportProgressBtn").addEventListener("click", exportProgress);
  $("#importProgressInput").addEventListener("change", importProgress);
  $("#importPackInput").addEventListener("change", importLessonPack);

  const packs=await listImportedPacks();
  $("#packInfo").textContent = packs.length ? `Импортировано пакетов: ${packs.length}` : "Дополнительных пакетов пока нет.";
}

function exportProgress(){
  const payload={
    formatVersion:1,
    app:"ManuLLern",
    exportedAt:new Date().toISOString(),
    progress:loadProgress()
  };
  downloadJson(`ManuLLern_progress_${new Date().toISOString().slice(0,10)}.json`,payload);
}
async function importProgress(e){
  const file=e.target.files?.[0]; if(!file)return;
  try{
    if(file.size > 1024*1024) throw new Error();
    const data=JSON.parse(await file.text());
    if(data.formatVersion!==1 || data.app!=="ManuLLern" || !data.progress || typeof data.progress!=="object" || Array.isArray(data.progress)) throw new Error();
    const clean={};
    for(const [k,v] of Object.entries(data.progress)){
      if(!/^\d+$/.test(k) || !v || typeof v!=="object" || Array.isArray(v)) continue;
      clean[k]={
        opened:Math.max(0,Math.min(100000,Number(v.opened)||0)),
        completed:Math.max(0,Math.min(100000,Number(v.completed)||0)),
        repeats:Math.max(0,Math.min(100000,Number(v.repeats)||0)),
        lastOpened:typeof v.lastOpened==="string" ? v.lastOpened.slice(0,80) : null
      };
    }
    saveProgress(clean);
    alert("Прогресс импортирован.");
  }catch{ alert("Не удалось импортировать файл прогресса."); }
  e.target.value="";
}
async function importLessonPack(e){
  const file=e.target.files?.[0]; if(!file)return;
  try{
    if(file.size > 5*1024*1024) throw new Error("Пакет слишком большой (максимум 5 МБ).");
    const pack=JSON.parse(await file.text());
    validatePack(pack);
    const existingIds=new Set(ML.lessons.map(x=>x.id));
    const collisions=pack.lessons.filter(x=>existingIds.has(x.id)).map(x=>x.id);
    if(collisions.length) throw new Error(`Уроки с ID ${collisions.slice(0,10).join(", ")} уже существуют. Импорт не заменяет существующие уроки.`);
    await savePack(pack);
    await refreshLessons();
    $("#packInfo").textContent=`Пакет «${pack.title || pack.packageId}» импортирован. Уроков: ${pack.lessons.length}.`;
    alert("Новые уроки добавлены локально.");
  }catch(err){
    alert("Не удалось импортировать пакет: "+(err.message||"ошибка"));
  }
  e.target.value="";
}
function downloadJson(name,obj){
  const blob=new Blob([JSON.stringify(obj,null,2)],{type:"application/json"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a"); a.href=url;a.download=name;document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),500);
}

function showLesson(id){
  const L=ML.lessonMap.get(id); if(!L)return;
  ML.currentLesson=L;
  clearApp();
  homeBtn.style.visibility="visible";
  settingsBtn.style.visibility="visible";
  app.append(cloneTemplate("lessonTemplate"));

  const prev=getLessonProgress(id);
  patchLessonProgress(id,{opened:(prev.opened||0)+1,lastOpened:new Date().toISOString()});

  $("#lessonHead").innerHTML = `<span class="eyebrow">Урок ${L.id} · Anki ${L.anki[0]}–${L.anki[1]}</span>
    <h1>${escapeHtml(L.title)}</h1>
    <p class="muted">Сначала слова в Anki, затем этот урок. Новая лексика возвращается в следующих текстах.</p>`;

  $("#microPattern").textContent=L.micro.pattern;
  $("#microNote").textContent=L.micro.note;
  for(const [de,ru] of L.micro.examples) $("#microExamples").append(renderSentence(de,ru));

  renderText(L);
  renderWords(L);
  renderQuestions(L);
  renderDialogue(L);
  renderPhrases(L);
  updateRepeatInfo(id);

  $("#speakTextBtn").addEventListener("click",()=>speakDE(L.text.map(x=>x[0]).join(" ")));
  $("#speakDialogueBtn").addEventListener("click",()=>speakDE(L.dialogue.map(x=>x[1]).join(" ")));

  let listenHidden=false;
  $("#listenModeBtn").addEventListener("click",()=>{
    listenHidden=!listenHidden;
    $("#textBlock").classList.toggle("listen-hidden",listenHidden);
    $("#listenModeBtn").textContent=listenHidden?"👁 Показать текст":"👂 Скрыть текст";
  });

  let allTranslated=false;
  $("#toggleAllTranslationBtn").addEventListener("click",()=>{
    allTranslated=!allTranslated;
    $$(".sentence",$("#textBlock")).forEach((s,i)=>{
      const txt=$(".txt",s), [de,ru]=L.text[i];
      txt.textContent=allTranslated?ru:de;
      s.dataset.lang=allTranslated?"ru":"de";
      s.classList.toggle("translation",allTranslated);
    });
  });

  $("#completeLessonBtn").addEventListener("click",()=>{
    const p=getLessonProgress(id);
    patchLessonProgress(id,{completed:(p.completed||0)+1});
    updateRepeatInfo(id);
    $("#completeLessonBtn").textContent="✓ Пройден";
  });

  $("#restartLessonBtn").addEventListener("click",()=>{
    const p=getLessonProgress(id);
    patchLessonProgress(id,{repeats:(p.repeats||0)+1});
    showLesson(id);
    window.scrollTo({top:0,behavior:"smooth"});
  });
}
function renderText(L){
  const block=$("#textBlock");
  L.text.forEach(([de,ru])=>block.append(renderSentence(de,ru)));
}
function renderWords(L){
  const list=$("#wordList");
  for(const w of L.words){
    const d=document.createElement("div");d.className="word-item";
    d.innerHTML=`<div class="word-rank">#${w.rank}</div><div class="word-de">${escapeHtml(w.de)}</div><div class="word-ru">${escapeHtml(w.ru)}</div>`;
    list.append(d);
  }
}
function renderQuestions(L){
  const block=$("#questionBlock");
  L.questions.forEach((q,idx)=>{
    const t=document.createElement("div");t.className="task";
    const head=document.createElement("div");head.className="task-q";
    const qtxt=document.createElement("span");qtxt.textContent=q.q;
    const sp=document.createElement("button");sp.className="speaker";sp.textContent="🔊";sp.addEventListener("click",()=>speakDE(q.q));
    head.append(qtxt,sp);
    const ta=document.createElement("textarea");
    ta.placeholder="Твой немецкий ответ…";
    ta.autocapitalize="sentences";ta.autocomplete="off";ta.spellcheck=true;
    const row=document.createElement("div");row.className="button-row";
    const check=document.createElement("button");check.textContent="Проверить";
    const hint=document.createElement("button");hint.textContent="Подсказка";
    const voice=document.createElement("button");voice.textContent="🎤 Голосовой набор";
    voice.addEventListener("click",()=>{
      ta.focus();
      alert("Нажми микрофон на клавиатуре Android и продиктуй по-немецки. Перед проверкой текст можно исправить.");
    });
    row.append(check,hint,voice);
    const fb=document.createElement("div");fb.className="feedback";

    hint.addEventListener("click",()=>{
      fb.className="feedback good";
      fb.style.display="block";
      fb.innerHTML=`<strong>Подсказка:</strong> ${escapeHtml(q.hint)}`;
    });
    check.addEventListener("click",()=>{
      const r=evaluateAnswer(ta.value,q.accepted);
      fb.style.display="block";
      if(r.kind==="empty"){
        fb.className="feedback wrong";fb.textContent="Сначала попробуй ответить сам.";return;
      }
      if(r.kind==="good"){
        fb.className="feedback good";
        fb.innerHTML="<strong>✓ Правильно.</strong> Написание совпадает с одним из подготовленных вариантов.";
        return;
      }
      let title="";
      if(r.kind==="case") title="Почти. Проверь заглавные буквы.";
      else if(r.kind==="diacritic") title="Почти. Проверь ä / ö / ü / ß.";
      else if(r.kind==="near") title="Почти. Проверь правописание.";
      else title="Ответ не совпал с тремя подготовленными вариантами.";
      fb.className="feedback "+(r.kind==="wrong"?"wrong":"near");
      const safeNearest=document.createElement("div");
      safeNearest.innerHTML=`<strong>${title}</strong><br>Ближайший вариант: <strong>${escapeHtml(r.nearest)}</strong>`;
      const speak=document.createElement("button");speak.className="speaker";speak.textContent="🔊";speak.addEventListener("click",()=>speakDE(r.nearest));
      safeNearest.append(" ",speak);
      const det=document.createElement("details");
      const sum=document.createElement("summary");sum.textContent="Показать все 3 допустимых ответа";
      det.append(sum);
      q.accepted.forEach(a=>{const p=document.createElement("div");p.textContent="• "+a;det.append(p);});
      fb.replaceChildren(safeNearest,det);
    });
    t.append(head,ta,row,fb);block.append(t);
  });
}
function renderDialogue(L){
  const block=$("#dialogueBlock");
  for(const [who,de,ru] of L.dialogue){
    const s=renderSentence(de,ru,who+": ");
    const txt=$(".txt",s);
    txt.innerHTML=`<span class="who">${escapeHtml(who)}:</span> ${escapeHtml(de)}`;
    s.addEventListener("click",()=>{
      // renderSentence already toggles; restore speaker prefix visuals on German after event bubbling
      setTimeout(()=>{
        if(s.dataset.lang==="de") txt.innerHTML=`<span class="who">${escapeHtml(who)}:</span> ${escapeHtml(de)}`;
      },0);
    });
    block.append(s);
  }
}
function renderPhrases(L){
  const block=$("#phraseBlock");
  for(const [de,ru] of L.phrases){
    const p=document.createElement("div");p.className="phrase";
    const deLine=document.createElement("div");deLine.className="phrase-de";deLine.textContent=de;
    const sp=document.createElement("button");sp.className="speaker";sp.textContent="🔊";sp.addEventListener("click",()=>speakDE(de));
    deLine.append(" ",sp);
    const ruLine=document.createElement("div");ruLine.className="muted small";ruLine.textContent=ru;
    p.append(deLine,ruLine);block.append(p);
  }
}
function updateRepeatInfo(id){
  const p=getLessonProgress(id);
  $("#repeatInfo").textContent=`Открытий: ${p.opened||0} · завершений: ${p.completed||0} · повторов: ${p.repeats||0}. Повторять можно без ограничений.`;
}

init().catch(err=>{
  console.error(err);
  app.innerHTML=`<section class="panel"><h1>Не удалось открыть ManuLLern</h1><p>Попробуй перезагрузить страницу. Если приложение открыто как локальный файл, запусти его через HTTPS/локальный веб-сервер.</p></section>`;
});
