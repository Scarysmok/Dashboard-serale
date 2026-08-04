// 01-config.js — Costanti, stato globale, cache locale, auth/api, login/logout, UI screens
// Estratto da index.html (split del 2026-07-07). Script classici:
// tutti i file js/ condividono lo scope globale; ordine di caricamento 01→08.
pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// URL del backend FastAPI (Render). Hardcoded perché non cambia spesso.
const API_BASE='https://dashboard-backend-ur63.onrender.com';
// v4: aggiunta estrazione 'Importo da versare' per la tab Negozi → reset cache
// v5: aggiunto parsing giftcard + annullamenti/sconti come importi numerici.
// Bump della versione → invalida automaticamente le cache esistenti, così i
// vecchi record (senza giftcard, con annull/sconti booleani) non interferiscono
// con la nuova formula di verifica cassa.
const CACHE_KEY='rp_cache_v5';
// Quanti PDF scaricare/parsare in parallelo. Su desktop 12 va benone, ma su
// mobile (iOS Safari soprattutto) tenere 12 documenti PDF.js + ArrayBuffer
// vivi contemporaneamente esaurisce la memoria della scheda e iOS la ricarica
// → il caricamento riparte da zero in loop. Su mobile riduciamo a 4.
const IS_MOBILE = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
  || (navigator.maxTouchPoints>1 && /Macintosh/i.test(navigator.userAgent)); // iPad iPadOS si maschera da Mac
const CONCURRENCY = IS_MOBILE ? 4 : 12;
// Lato minimo per considerare un'immagine una "foto utente": scarta loghi
// a banner (GoAudits 572x82), mappe Google location (264x120), icone piccole.
// Le foto scontrino/documento da smartphone sono sempre >= 200px per lato
// anche dopo la compressione JPEG applicata dal generatore di PDF.
const ATTACH_MIN_SIDE=200;
let allData=[], filter='all', filterDate=null, syncTimer=null;
// Ordinamento card tab Chiusure: 'default' (per brand) | 'corr' | 'tgt' | 'anom' | 'name'
let sortMode='default';
// Brand collassati nella tab Chiusure (persistono nella sessione, non oltre)
let collapsedBrands=new Set();
// Flag: il default "ultima giornata disponibile" è stato già applicato una volta.
// Dopo il primo auto-set l'utente è libero di scegliere "Tutte le date" senza
// che il sync successivo glielo re-imposti.
let _dateAutoDone=false;
// Stato range date per la tab Negozi (null = tutte le date)
let storeRange={from:null,to:null};
// Stato interno del calendario
let calState={year:null,month:null,from:null,to:null};
// Filtri tab Andamento (v2 — gerarchica con multi-select):
//   - tempoBrands  : array di brand attivi. Vuoto = tutti i brand.
//   - tempoStores  : array di location attive. Vuoto = tutti gli store dei
//                    brand attivi.
//   - amExpanded   : Set di chiavi (es. "y2026", "m2026-05") attualmente
//                    espanse nell'albero. Persiste tra render così l'utente
//                    non perde lo stato quando cambia filtro.
// Default: tutto collassato. L'utente decide cosa aprire.
let tempoBrands=[], tempoStores=[];
// Checklist di APERTURA (GoAudits, dal 07/2026): record parsati dai PDF della
// cartella Drive dedicata. Popolato da syncAperture(), mostrato nella home Oggi.
let allAperture=[];
let amExpanded = new Set();
// Toggle confronti nella tab Andamento. Default: target ON (preserva il
// comportamento già esistente dopo l'introduzione del badge target),
// anno-scorso OFF (l'utente lo attiva quando vuole vedere il delta YoY).
let compareTgt=true, comparePy=false;
// Incassi storici (2025 completo + Jan-Apr 2026 per il pre-GoAudits):
// dict {storeKey|date: netSales}. Stesso formato di targetsByKey, lookup O(1).
// Sorgente di verità per il confronto anno-su-anno e per riempire la timeline
// 2026 nei mesi precedenti al 23/04/2026 (data di partenza GoAudits).
let historicalByKey={};
// KPI storici letti dalle nuove colonne dell'Excel storico/consuntivi
// (Walk-in, Quantity, Nr. Scontrini, CR, UPT). Dict separato da historicalByKey
// perché:
//   - non tutti i record hanno KPI (solo quelli con file nuovo)
//   - il formato è diverso: oggetto invece di numero
//   - viene servito da un endpoint separato (/historical/kpi) per
//     retrocompatibilità di /historical
// Forma: { "adidas|brindisi city|2025-01-02": {walkIn:103, quantity:8,
//                                              scontrini:18, cr:0.1747, upt:0.4444}, ... }
// Bibbia per la tab KPI: kpiValFromRecord controlla prima qui, poi fallback
// su r.qa[25/26/27] del PDF GoAudits, poi null.
let historicalKpiByKey={};
let lastErrors=[];
// Target di vendita giornalieri per (brand, location, dateISO). Caricati una
// volta a sync da /targets, poi indicizzati con la stessa chiave normalizzata
// di storeKey() per fare lookup O(1) durante il render delle card.
// Forma: { "adidas|foggia|2026-05-04": 1551.03, ... }
let targetsByKey={};
// Override del flag `monitored` per i 30 punti vendita. Caricato a sync da
// /stores/flags.
// Forma: {
//   "carpisa|bariblu": { monitored: true,  activeFrom: "2026-05-06" },
//   "yamamay|aeroporto": { monitored: false, activeFrom: null },
//   ...
// }
// Se un negozio NON è presente in questa mappa, vale il default in ALL_STORES.
// `activeFrom` è la data in cui è stato attivato (set dal backend alla
// transizione false→true). Serve a NON mostrare come "mancanti" date precedenti
// all'attivazione (es. attivo Bariblu il 06/05 → 05/05 e prima ignorano Bariblu).
// Quando l'admin clicca il toggle in tab Negozi, faccio una PATCH e poi
// rilancio recomputeExpected() + renderAll() così tutta la dashboard riflette
// il nuovo stato (chiusure attese, KPI, mancanti).
let storeFlagsByKey={};
// Segnalazioni guasti via email già inviate, da GET /segnalazioni.
// Forma: { "adidas|brindisi city|2026-07-07": {user:"l.colucci", sent_at:"2026-07-07T15:45:00+00:00"} }
let segnalazioniByKey={};
// Template email segnalazioni guasti: base comune + tipo di danno riconosciuto
// automaticamente dalle parole chiave nella nota del negozio (primo tipo che
// matcha vince, 'generico' è il fallback e va tenuto per ultimo).
// Segnaposto disponibili in subject/body: {BRAND} {NEGOZIO} {DATA} {NOTA} {TIPO} {FRASE}.
// dest vuoto = campo A: vuoto in Outlook, lo compila l'utente.
// Questi sono i DEFAULT: la versione modificata dagli admin (Altro → Template
// segnalazioni) vive sul backend e arriva in segnalazioniConfig a ogni sync.
const SEGNALAZIONI_DEFAULT={
  base:{
    subject:'Segnalazione guasto — {BRAND} {NEGOZIO} — {DATA}',
    body:'Ciao,\n\ndalla checklist di apertura del {DATA} il negozio {BRAND} {NEGOZIO} segnala {FRASE}.\n\nNota del negozio: "{NOTA}"\n\nSaluti',
  },
  tipi:[
    {id:'condizionatore',label:'Condizionatore',   frase:'un guasto al condizionatore',    dest:'', keywords:'condizionator, aria condizionata, clima'},
    {id:'cassa',         label:'Cassa',            frase:'un guasto alla cassa',           dest:'', keywords:'cassa, registratore, pos'},
    {id:'insegna',       label:'Insegna',          frase:"un guasto all'insegna",          dest:'', keywords:'insegna'},
    {id:'illuminazione', label:'Corpi illuminanti',frase:'un guasto ai corpi illuminanti', dest:'', keywords:'luce, luci, lampad, faro, faretti, illuminaz, neon'},
    {id:'computer',      label:'Computer',         frase:'un guasto al computer',          dest:'', keywords:'computer, pc, monitor'},
    {id:'stampante',     label:'Stampante',        frase:'un guasto alla stampante',       dest:'', keywords:'stampant, non stampa'},
    {id:'telefono',      label:'Telefono',         frase:'un guasto al telefono',          dest:'', keywords:'telefono, telefonic'},
    {id:'generico',      label:'Generico',         frase:'un guasto alle apparecchiature', dest:'', keywords:''},
  ],
};
// Config personalizzata dal backend (GET /segnalazioni/config). null = default.
let segnalazioniConfig=null;
// Stato "risolto" dei malfunzionamenti, da GET /malfunzionamenti/resolved.
// Forma: { "adidas|brindisi city|illuminazione": {resolved_up_to:"2026-07-08", by:"l.colucci", at:"..."} }
let malfResolvedByKey={};
// Store check parsate dai PDF (una cartella Drive dedicata, come le aperture).
let allStoreChecks=[];
// Template email store check (GET /storecheck/mail-config). null = default sotto.
let storeCheckMailConfig=null;
// Default del template email store check. to/cc vuoti: li compila l'admin in
// Altro → Template email store check. Segnaposto: {NEGOZIO} {AM} {DATA} {PUNTEGGIO} {NONCONF}.
const STORECHECK_MAIL_DEFAULT={
  to:'', cc:'',
  subject:'Store check {NEGOZIO} — {DATA}',
  body:'Ciao,\n\nin allegato/di seguito l\'esito dello store check del {DATA} per {NEGOZIO} (area manager: {AM}).\nPunteggio: {PUNTEGGIO}.\n\nPunti da sistemare:\n{NONCONF}\n\nSaluti',
};
// Stato autenticazione: user info + token cache. I token sono anche salvati
// in localStorage per sopravvivere ai refresh della pagina.
let auth={user:null, accessToken:null, refreshToken:null};

function loadCache(){try{return JSON.parse(localStorage.getItem(CACHE_KEY)||'{}');}catch(e){return {};}}
function saveCache(c){try{localStorage.setItem(CACHE_KEY,JSON.stringify(c));}catch(e){console.warn('Cache save fallita',e);}}
function clearCache(){localStorage.removeItem(CACHE_KEY);['rp_cache_v1','rp_cache_v2','rp_cache_v3','rp_cache_v4'].forEach(k=>localStorage.removeItem(k));}
function forceResync(){clearCache();syncNow(true);}   // chiesto dall'utente: salta il freno sui riavvii
function showErrors(){
  if(!lastErrors.length){alert('Nessun errore registrato nell\'ultimo sync.');return;}
  const sample=lastErrors.slice(0,10).map((e,i)=>`${i+1}. ${e.name}\n   → ${e.msg}`).join('\n\n');
  const more=lastErrors.length>10?`\n\n(…e altri ${lastErrors.length-10} errori simili)`:'';
  alert(`Errori ultimo sync (${lastErrors.length}):\n\n${sample}${more}`);
}

// ── MESI IT ──
const MESI=['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
const MESI_SHORT=['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'];

// ── AUTH: helper per chiamate API autenticate ──
// Usa cookie httponly se disponibili (cross-site con credentials:include) +
// fallback Authorization Bearer per browser che bloccano i cookie cross-site
// (es. Safari iOS). Su 401 prova auto-refresh una volta e ritenta.
async function api(path, opts={}){
  const url=API_BASE+path;
  const buildOpts=(token)=>({
    ...opts,
    credentials:'include',
    headers:{
      ...(opts.body?{'Content-Type':'application/json'}:{}),
      ...(opts.headers||{}),
      ...(token?{'Authorization':`Bearer ${token}`}:{}),
    },
  });
  let res=await fetch(url, buildOpts(auth.accessToken));
  // Se il token è scaduto e abbiamo un refresh, lo usiamo e ritentiamo
  if(res.status===401 && auth.refreshToken && path!=='/auth/refresh'){
    if(await tryRefresh()){
      res=await fetch(url, buildOpts(auth.accessToken));
    }
  }
  return res;
}
async function tryRefresh(){
  try{
    const r=await fetch(API_BASE+'/auth/refresh',{
      method:'POST',
      credentials:'include',
      headers:auth.refreshToken?{'Authorization':`Bearer ${auth.refreshToken}`}:{},
    });
    if(!r.ok)return false;
    const data=await r.json();
    setAuth(data.user, data.access_token, data.refresh_token);
    return true;
  }catch(e){return false;}
}
function setAuth(user, accessToken, refreshToken){
  auth.user=user;
  auth.accessToken=accessToken;
  auth.refreshToken=refreshToken;
  if(accessToken) localStorage.setItem('access_token', accessToken);
  if(refreshToken) localStorage.setItem('refresh_token', refreshToken);
}
function clearAuth(){
  auth.user=null; auth.accessToken=null; auth.refreshToken=null;
  localStorage.removeItem('access_token');
  localStorage.removeItem('refresh_token');
}

// ── INIT ──
// All'avvio: prova ad autenticarsi col token salvato. Se valido, mostra dash.
// Altrimenti mostra schermata login. Notifica spinner per cold start Render.
//
// PRE-WARM: il backend Render free tier va in sleep dopo 15 min di inattività
// e svegliarlo richiede 30-60 sec. Spariamo subito un ping all'endpoint pubblico
// '/' (zero auth, zero costo) per innescare il wake-up IN PARALLELO mentre
// l'utente legge il form di login e digita le credenziali. Quando poi clicca
// "Accedi", il backend è già caldo e la chiamata di login risponde subito.
// Per chi ha l'auto-login (token in localStorage), il ping gira in parallelo
// con /auth/me, quindi non aiuta ma non danneggia: i due request condividono
// lo stesso wake-up del backend.

// ── UI: switch fra login / register / pending / dashboard ──
function _hideAllScreens(){
  ['login-wrap','register-wrap','pending-wrap','dash-wrap'].forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.style.display='none';
  });
}
function showLogin(){
  _hideAllScreens();
  document.getElementById('login-wrap').style.display='';
  document.getElementById('login-error').style.display='none';
}
function showRegister(){
  _hideAllScreens();
  document.getElementById('register-wrap').style.display='';
  document.getElementById('reg-error').style.display='none';
}
function showPending(msg){
  _hideAllScreens();
  document.getElementById('pending-wrap').style.display='';
  if(msg) document.getElementById('pending-msg').textContent=msg;
}
function showDash(){
  _hideAllScreens();
  const d=document.getElementById('dash-wrap');
  d.style.display='flex';
  // Aggiorna badge admin / sezioni in base al ruolo
  applyRoleVisibility();
  // Riempi info utente in Config
  if(auth.user){
    const cu=document.getElementById('cfg-user-disp');
    if(cu) cu.textContent=auth.user.username+' · '+auth.user.role;
  }
  // Ripristina i filtri Analisi dell'ultima sessione (brand/punto vendita)
  restoreAnalisiFilters();
  // Pull-to-refresh sulle liste principali (registrato una sola volta)
  initPullToRefresh();
  // La home "Oggi" è la tab di partenza. switchTab chiude la sidebar (overlay),
  // così si parte a pagina intera; l'utente la apre con l'hamburger.
  switchTab('oggi');
  syncNow();
  syncTimer=setInterval(syncNow,5*60*1000);
}
function applyRoleVisibility(){
  // Gestione utenti + bottoni upload visibili solo agli admin
  const isAdmin = auth.user?.role==='admin';
  const headAdmin=document.getElementById('head-admin');
  if(headAdmin) headAdmin.style.display = isAdmin ? '' : 'none';
  const btnAccount=document.getElementById('btn-account-open');
  if(btnAccount) btnAccount.style.display = isAdmin ? 'flex' : 'none';
  const btnTemplate=document.getElementById('btn-template-open');
  if(btnTemplate) btnTemplate.style.display = isAdmin ? 'flex' : 'none';
  const btnScMail=document.getElementById('btn-scmail-open');
  if(btnScMail) btnScMail.style.display = isAdmin ? 'flex' : 'none';
  const btnTargets=document.getElementById('btn-targets-upload');
  if(btnTargets) btnTargets.style.display = isAdmin ? '' : 'none';
  const btnHistoricalPY=document.getElementById('btn-historical-py-upload');
  if(btnHistoricalPY) btnHistoricalPY.style.display = isAdmin ? '' : 'none';
  const btnHistoricalCur=document.getElementById('btn-historical-cur-upload');
  if(btnHistoricalCur) btnHistoricalCur.style.display = isAdmin ? '' : 'none';
  // Il bottone import-da-Drive è nel banner Analisi: la visibilità admin è
  // gestita direttamente da updateConsuntivoLabel a ogni render.
  updateConsuntivoLabel();
}

// ── LOGIN / REGISTER / LOGOUT ──
async function doLogin(){
  const email=document.getElementById('login-email').value.trim();
  const password=document.getElementById('login-password').value;
  const remember=document.getElementById('login-remember').checked;
  const errEl=document.getElementById('login-error');
  errEl.style.display='none';
  if(!email||!password){errEl.textContent='Inserisci email e password';errEl.style.display='block';return;}
  const btn=document.getElementById('login-btn');
  btn.disabled=true; btn.textContent='Accesso in corso…';
  load(true,'Accesso in corso…',true);
  try{
    const r=await fetch(API_BASE+'/auth/login',{
      method:'POST',credentials:'include',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({email,password,remember}),
    });
    const data=await r.json().catch(()=>({}));
    if(!r.ok){
      errEl.textContent=data.detail||'Login fallito';
      errEl.style.display='block';
      return;
    }
    setAuth(data.user, data.access_token, data.refresh_token);
    showDash();
  }catch(e){
    errEl.textContent='Errore di rete: '+(e.message||e);
    errEl.style.display='block';
  }finally{
    load(false);
    btn.disabled=false; btn.textContent='Accedi →';
  }
}
async function doRegister(){
  const username=document.getElementById('reg-username').value.trim();
  const email=document.getElementById('reg-email').value.trim();
  const password=document.getElementById('reg-password').value;
  const errEl=document.getElementById('reg-error');
  errEl.style.display='none';
  if(!username||!email||!password){errEl.textContent='Compila tutti i campi';errEl.style.display='block';return;}
  if(password.length<8){errEl.textContent='La password deve essere lunga almeno 8 caratteri';errEl.style.display='block';return;}
  const btn=document.getElementById('reg-btn');
  btn.disabled=true; btn.textContent='Registrazione…';
  load(true,'Registrazione in corso…',true);
  try{
    const r=await fetch(API_BASE+'/auth/register',{
      method:'POST',credentials:'include',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({username,email,password}),
    });
    const data=await r.json().catch(()=>({}));
    if(!r.ok){
      errEl.textContent=data.detail||'Registrazione fallita';
      errEl.style.display='block';
      return;
    }
    showPending(data.message||'Registrazione completata. Attendi che l\'admin approvi il tuo account.');
  }catch(e){
    errEl.textContent='Errore di rete: '+(e.message||e);
    errEl.style.display='block';
  }finally{
    load(false);
    btn.disabled=false; btn.textContent='Registrati →';
  }
}
async function doLogout(){
  if(!confirm('Disconnettersi?'))return;
  try{await api('/auth/logout',{method:'POST'});}catch(e){}
  clearAuth();
  clearInterval(syncTimer);
  allData=[];
  // Pulisci anche la cache PDF: utente diverso potrebbe non vedere gli stessi dati
  clearCache();
  showLogin();
}

// ── HELPERS ──
const fmt=n=>{
  if(!n&&n!==0)return'—';
  return'€\u00a0'+n.toLocaleString('it-IT',{minimumFractionDigits:2,maximumFractionDigits:2});
};
// Numero senza prefisso €, formato italiano (per gli input editabili)
const fmtNumIt=n=>{
  const v=+n;
  if(!isFinite(v)) return '0,00';
  return v.toLocaleString('it-IT',{minimumFractionDigits:2,maximumFractionDigits:2});
};
// Parse di una stringa numerica in formato IT/EN. Accetta "1.234,56", "1234,56",
// "1234.56", "1234". Restituisce 0 se non parsabile.
function parseNumIt(s){
  if(s==null) return 0;
  let str=String(s).trim();
  if(!str) return 0;
  const neg=str.startsWith('-'); if(neg) str=str.slice(1);
  str=str.replace(/[€\s ]/g,'');
  if(!str) return 0;
  const hasDot=str.includes('.'), hasComma=str.includes(',');
  let norm;
  if(hasDot&&hasComma) norm=str.replace(/\./g,'').replace(',','.');
  else if(hasComma)    norm=str.replace(',','.');
  else                 norm=str;
  const n=parseFloat(norm);
  return isFinite(n) ? (neg?-n:n) : 0;
}
function fmtDateTime(iso){
  if(!iso) return '';
  const d=new Date(iso);
  if(isNaN(d)) return '';
  return d.toLocaleString('it-IT',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
}
// Escape per attributi HTML/title (per i valori serializzati nel markup)
function attrEsc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
// coldHint=true → dopo 5 secondi di attesa mostra la nota "il server si sta
// riavviando". Usato solo per i flussi di autenticazione (login/registrazione/
// verifica sessione), dove un'attesa lunga è quasi sempre il cold start di
// Render free tier e non un problema dell'app.
// NOTA: `var` (non let) perché load() viene chiamata dall'IIFE di boot PRIMA
// che l'esecuzione del codice arrivi a questa riga: con let andrebbe in
// temporal dead zone → ReferenceError → app bloccata su "Verifico sessione…".
var _coldTimer=null;
function load(on,msg='',coldHint=false){
  document.getElementById('loading').classList.toggle('show',on);
  if(msg)document.getElementById('loading-msg').textContent=msg;
  if(!on) setLoadingCount(0,0);   // fine caricamento: azzero il contatore in alto
  const note=document.getElementById('coldstart-note');
  if(_coldTimer){clearTimeout(_coldTimer);_coldTimer=null;}
  if(note){
    if(on && coldHint){
      _coldTimer=setTimeout(()=>{note.classList.add('show');},5000);
      note.classList.remove('show');
    }else{
      note.classList.remove('show');
    }
  }
}

// Contatore PDF mostrato in alto SULL'overlay di caricamento (il logo resta).
// done<=0 o tot<=0 lo nasconde.
function setLoadingCount(done, tot){
  const el=document.getElementById('loading-count');
  if(!el) return;
  if(tot>0 && done>0 && done<tot){
    el.textContent=`${done} / ${tot} pdf`;
    el.classList.add('show');
  }else{
    el.textContent='';
    el.classList.remove('show');
  }
}

// ── TOAST DI CONFERMA ──
// Notifica leggera non bloccante in basso. type: '' | 'ok' | 'err'.
// Sostituisce gli alert() per le conferme positive (gli errori che richiedono
// attenzione restano alert).
function showToast(msg, type=''){
  const wrap=document.getElementById('toast-wrap');
  if(!wrap) return;
  const t=document.createElement('div');
  t.className='toast'+(type?' '+type:'');
  t.textContent=msg;
  wrap.appendChild(t);
  setTimeout(()=>{t.classList.add('out');setTimeout(()=>t.remove(),300);},2600);
}

// ── SKELETON (placeholder durante il primo caricamento) ──
function renderSkeletons(){
  const sk=`<div class="sk-card"><div class="sk-line w40"></div><div class="sk-line tall w60"></div><div class="sk-line w80"></div></div>`;
  const cl=document.getElementById('cards-list');
  if(cl && !cl.children.length) cl.innerHTML=sk.repeat(4);
}

// ── COLORI BRAND ──
// Ogni brand ha un colore distintivo per etichetta, bordo card e subtotale.
// Brand sconosciuti ricadono sul default grigio-blu neutro.
const BRAND_COLORS={
  adidas:  {text:'#1e40af', tint:'#dbeafe', strong:'#3b82f6'}, // blu
  mango:   {text:'#c2410c', tint:'#ffedd5', strong:'#f97316'}, // arancione
  carpisa: {text:'#be185d', tint:'#fce7f3', strong:'#ec4899'}, // rosa
  yamamay: {text:'#a16207', tint:'#fef3c7', strong:'#eab308'}, // giallo/ambra
};
const DEFAULT_BRAND_COLOR={text:'#475569', tint:'#f1f5f9', strong:'#64748b'};
function brandColor(name){
  return BRAND_COLORS[String(name||'').toLowerCase().trim()]||DEFAULT_BRAND_COLOR;
}

// ── ELENCO NEGOZI ──
// ALL_STORES = lista completa dei punti vendita di Rino Petino (31 in totale).
// Il flag `monitored` distingue:
//   true  → invia chiusura giornaliera tramite GoAudits (20 negozi)
//   false → non è ancora su GoAudits, esiste solo nei dati storici Excel
//           caricati a mano. Apparirà solo nella tab "Andamento".
//
// Quando un negozio "non monitorato" inizia ad usare GoAudits, basta cambiare
// il flag a true: comparirà automaticamente in Chiusure e Negozi (saldi) e
// la dashboard inizierà a tracciarlo come gli altri.
const ALL_STORES=[
  {brand:'Adidas',  location:'Foggia',           monitored:true},
  {brand:'Adidas',  location:'Teramo',           monitored:true},
  {brand:'Adidas',  location:'Bariblu',          monitored:true},
  {brand:'Adidas',  location:'Rende',            monitored:true},
  {brand:'Adidas',  location:'Brindisi City',    monitored:true},
  {brand:'Adidas',  location:'Brindisi Colonne', monitored:true},
  {brand:'Adidas',  location:'Lecce City',       monitored:true},
  {brand:'Adidas',  location:'Taranto',          monitored:true},
  {brand:'Carpisa', location:'Brindisi Colonne', monitored:true},
  {brand:'Carpisa', location:'Gallipoli',        monitored:true},
  {brand:'Carpisa', location:'Lecce',            monitored:true},
  {brand:'Carpisa', location:'Ostuni',           monitored:true},
  {brand:'Carpisa', location:'Surbo',            monitored:true},
  {brand:'Mango',   location:'Taranto',          monitored:true},
  {brand:'Mango',   location:'Foggia',           monitored:true},
  {brand:'Mango',   location:'Teramo',           monitored:true},
  {brand:'Mango',   location:'Bariblu',          monitored:true},
  {brand:'Mango',   location:'Molfetta',         monitored:true},
  {brand:'Mango',   location:'Treviso',          monitored:true},
  // Aperto il 20/06/2026 (prime chiusure GoAudits 20 e 21/06). `activeFrom`
  // evita che compaia come "mancante" per le date precedenti all'apertura.
  {brand:'Mango',   location:'Ascoli Piceno',    monitored:true, activeFrom:'2026-06-20'},
  {brand:'Yamamay', location:'Lecce',            monitored:true},
  {brand:'Yamamay', location:'Monopoli',         monitored:false},
  {brand:'Yamamay', location:'Polignano',        monitored:true},
  // ── Non ancora su GoAudits (dati solo storici, gestione manuale) ──
  // Stato di default: attivabili dalla tab Negozi (admin) tramite toggle.
  // L'override vivo è in MongoDB (collection store_flags), il valore qui sotto
  // è solo il default in caso un negozio non abbia mai avuto override.
  {brand:'Carpisa', location:'Bariblu',          monitored:false},
  {brand:'Carpisa', location:'Casamassima',      monitored:false},
  {brand:'Carpisa', location:'S. Caterina',      monitored:false},
  {brand:'Carpisa', location:'Sparano',          monitored:false},
  {brand:'Yamamay', location:'Aeroporto',        monitored:false},
  {brand:'Yamamay', location:'Casamassima',      monitored:false},
  {brand:'Yamamay', location:'Molfetta',         monitored:false},
  {brand:'Yamamay', location:'Putignano',        monitored:false},
  {brand:'Yamamay', location:'S. Caterina',      monitored:false},
  {brand:'Yamamay', location:'Sparano',          monitored:false},
];
// Negozi attivi (= "chiusure attese oggi"): usato in tab Chiusure (chip
// "Mancanti", filtro data), in tab Negozi (saldi) e ovunque serva sapere
// "chi dovrebbe mandare oggi".
// È DINAMICO: ricalcolato da recomputeExpected() che combina:
//   - il default in ALL_STORES (campo `monitored` hardcoded)
//   - l'override in storeFlagsByKey (caricato da /stores/flags al sync)
// Quando l'admin attiva/disattiva un negozio dal toggle in tab Negozi:
//   1. PATCH /stores/flags
//   2. aggiorno storeFlagsByKey
//   3. recomputeExpected()
//   4. renderAll() — tutta la dashboard si aggiorna (KPI, chip Mancanti, ecc.)
let EXPECTED_STORES = ALL_STORES.filter(s => s.monitored);
// Determina se un negozio (brand, location) era attivo IN UNA DATA SPECIFICA.
// `dateISO` è opzionale (formato 'YYYY-MM-DD'); se omesso, ritorna lo stato
// attuale (= "oggi"). Logica:
//   - Se c'è un override in storeFlagsByKey:
//       * monitored=false   → non attivo
//       * monitored=true e:
//           - nessun activeFrom o activeFrom <= dateISO → attivo
//           - activeFrom > dateISO                       → NON attivo (era stato
//             attivato dopo la data richiesta, retroattivamente non vale).
//   - Senza override: usa il default da ALL_STORES (il flag `monitored` hardcoded).
// Lo string-compare su date 'YYYY-MM-DD' funziona come confronto cronologico.
function isStoreMonitoredOn(brand, location, dateISO){
  const k = storeKey(brand, location);
  const flag = storeFlagsByKey[k];
  if(flag && typeof flag === 'object'){
    if(!flag.monitored) return false;
    if(dateISO && flag.activeFrom && flag.activeFrom > dateISO) return false;
    return true;
  }
  // Backcompat: vecchio shape boolean diretto. Non dovrebbe più esistere dopo
  // fetchStoreFlags ma copro il caso per robustezza.
  if(typeof flag === 'boolean') return flag;
  // Nessun override: default da ALL_STORES. I monitorati valgono "sempre attivi",
  // TRANNE quelli con un `activeFrom` hardcoded (negozi aperti in una data nota):
  // per le date precedenti all'apertura non sono attivi (niente "mancante" finto).
  const def = ALL_STORES.find(s => storeKey(s.brand, s.location) === k);
  if(!def || !def.monitored) return false;
  if(dateISO && def.activeFrom && def.activeFrom > dateISO) return false;
  return true;
}
// Wrapper "stato attuale" — usato ovunque ci si chieda "oggi è attivo?". È solo
// `isStoreMonitoredOn` senza data, mantenuto come API distinta per chiarezza.
function isStoreMonitored(brand, location){
  return isStoreMonitoredOn(brand, location);
}
// Data di attivazione effettiva (override backend o default ALL_STORES). null se
// nessuna. Usata per distinguere un negozio "programmato" (activeFrom futuro).
function storeActiveFrom(brand, location){
  const k = storeKey(brand, location);
  const flag = storeFlagsByKey[k];
  if(flag && typeof flag === 'object') return flag.activeFrom || null;
  const def = ALL_STORES.find(s => storeKey(s.brand, s.location) === k);
  return (def && def.activeFrom) || null;
}
// Ricalcola la lista EXPECTED_STORES applicando gli override caricati dal
// backend ai default di ALL_STORES. Da chiamare DOPO ogni mutazione di
// storeFlagsByKey (login, sync, toggle manuale).
function recomputeExpected(){
  EXPECTED_STORES = ALL_STORES.filter(s => isStoreMonitored(s.brand, s.location));
}
// Chiave normalizzata: case-insensitive, spazi compattati, niente trailing/leading.
// Serve a confrontare brand+location senza farsi fregare da differenze tipografiche.
const storeKey=(brand,location)=>
  String(brand||'').toLowerCase().trim()+'|'+String(location||'').toLowerCase().replace(/\s+/g,' ').trim();

// Restituisce l'elenco dei negozi attesi che NON hanno inviato la chiusura
// per la data passata. Se non c'è una data, ritorna [].
//
// IMPORTANTE: date-aware. Per la data `date` consideriamo solo i negozi che
// erano attivi IN QUELLA DATA (controllando l'`activeFrom`). Se attivi
// Carpisa Bariblu il 06/05/2026, il 05/05/2026 NON lo conta come mancante
// perché non era ancora attivo. Lo string-compare 'YYYY-MM-DD' funziona come
// confronto cronologico.
function getMissingStores(date){
  if(!date) return [];
  const present=new Set(allData.filter(r=>r.dateISO===date).map(r=>storeKey(r.brand,r.location)));
  return ALL_STORES
    .filter(s => isStoreMonitoredOn(s.brand, s.location, date))
    .filter(s => !present.has(storeKey(s.brand,s.location)));
}

// Aggiorna label e stato del chip "Mancanti" in base al filtro data attivo.
function updateMissingChip(){
  const chip=document.getElementById('chip-mancanti');
  if(!chip) return;
  if(!filterDate){
    chip.textContent=(AZ?'':'📭 ')+'Mancanti';
    chip.classList.add('disabled');
    if(filter==='mancanti'){
      // Se c'era il filtro mancanti attivo e si toglie la data, fallback su 'all'
      filter='all';
      document.querySelectorAll('.chip').forEach(c=>c.classList.remove('on'));
      const allChip=document.querySelector('.chip[onclick*="\'all\'"]');
      if(allChip)allChip.classList.add('on');
    }
  }else{
    const n=getMissingStores(filterDate).length;
    chip.textContent=`${AZ?'':'📭 '}Mancanti (${n})`;
    chip.classList.remove('disabled');
  }
}

