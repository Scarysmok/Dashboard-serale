// 09-bestseller.js — Modulo Best Seller: report sell-out settimanali dei negozi Adidas.
// Estratti dal portale adidas in Excel, importati dall'admin e consultabili dai negozi.
// Script classico come gli altri file js/: scope globale, caricato dopo 08-boot.js.
// Il rendering è lazy (parte da switchTab('bestseller')), quindi non serve che
// le funzioni esistano già al boot.
//
// L'Excel viene letto nel BROWSER con SheetJS (stesso schema dei consuntivi):
// al server arriva già il JSON dei prodotti.
//
// Foto prodotto: il recupero automatico da adidas è stato rimosso perché il
// loro sito risponde 403 alle richieste che non arrivano da una sessione reale.
// Il modulo mostra la foto se il prodotto ha il campo `img`, altrimenti lascia
// il riquadro vuoto: il popolamento delle immagini avverrà per altra via.

// ── Stato del modulo ────────────────────────────────────────────────────
const BS = {
  index: null,      // elenco settimane disponibili (dal backend)
  map: [],          // corrispondenze nome-negozio adidas → brand|location
  cur: null,        // selezione: {brand, location, period_start} | {aggregate:true, period_start}
  data: null,       // report caricato
  photos: null,     // elenco file della cartella Drive foto; null = non ancora chiesto
  public: false,     // true in bs.html: sola lettura, senza selettori né valore
  query: '', fDiv: '', fGen: '', fCat: '', fSea: '', sort: 'units',
  detail: null,     // prodotto aperto nella scheda
  busy: false,
  log: [],
};

// Le 28 colonne dell'export adidas, nell'ordine del file. `t` è il formato:
// e = euro, i = intero, p = percentuale (il file usa 0.28 per 28%).
const BS_FIELDS = [
  {l:'Codice'},{l:'Nome prodotto'},{l:'Categoria sport'},{l:'Genere'},{l:'Genere (dettaglio)'},
  {l:'Stagione'},{l:'Segmento business'},{l:'Carry over'},{l:'Divisione'},{l:'Class ID'},
  {l:'Prima tracciatura'},{l:'Classe ABC'},{l:'Vendite nette',t:'e'},{l:'Pezzi venduti',t:'i'},
  {l:'Gross Sales FP %',t:'p'},{l:'Net Sales FP',t:'e'},{l:'Net Sales WSP',t:'e'},
  {l:'Margine',t:'e'},{l:'Margine %',t:'p'},{l:'Sconto',t:'e'},{l:'Sconto %',t:'p'},
  {l:'ASP · prezzo medio',t:'e'},{l:'OHQ · giacenza',t:'i'},{l:'OHQ WSP',t:'e'},
  {l:'Unit WSP',t:'e'},{l:'Sell through %',t:'p'},{l:'Sell through WSP %',t:'p'},
  {l:'WOS · sett. copertura',t:'i'},
];
const BS_GROUPS = [
  {title:'Anagrafica',        idx:[0,1,2,4,5,6,7,8,9,10,11]},
  {title:'Performance',       idx:[12,13,21,17,18,19,20,14,15,16]},
  {title:'Stock & rotazione', idx:[22,23,24,25,26,27]},
];
const BS_I_UNITS = 13, BS_I_ST = 25, BS_I_OHQ = 22;   // OHQ = giacenza residua
const BS_I_SEASON = 5;   // colonna G dell'export: la stagione è un dato per articolo

// Ordina le stagioni dalla più recente: FW2026, SS2026, FW2025… L'ordine
// alfabetico metterebbe tutte le FW prima di tutte le SS, che non serve a nulla.
// Una sigla non riconosciuta finisce in fondo, in ordine alfabetico.
function bsSeasonCmp(a,b){
  const p = s => { const m = String(s||'').match(/^(SS|FW)\s*(\d{4})$/i);
    return m ? [+m[2], m[1].toUpperCase()==='FW' ? 1 : 0] : null; };
  const pa = p(a), pb = p(b);
  if(!pa && !pb) return String(a).localeCompare(String(b));
  if(!pa) return 1;
  if(!pb) return -1;
  return pb[0]-pa[0] || pb[1]-pa[1];
}
const bsSeason = p => String((p.all||[])[BS_I_SEASON] || '').trim();

// Nomi delle colonne nell'export adidas, nell'ordine di BS_FIELDS. Servono a
// riconoscere le colonne PER NOME e non per posizione.
// Perché: il portale esporta con insiemi di colonne diversi. Il file del 30/07
// ha "Gross Sales FP %" e "Net Sales FP" fra SQ e Net Sales WSP, altri export ne
// sono privi: tutto ciò che segue slitta di due e la giacenza finisce a leggere
// Unit WSP, cioè euro. È così che in classifica sono comparse giacenze con i
// decimali (03/08). Una colonna assente resta null e in scheda mostra "—".
const BS_COLNAMES = [
  'Product Code','Product Name','Sports Category','Gender','Gender 2','Season',
  'Business Segment','Carry overs','Product Division','Class ID','First Trace','ABC',
  'Net Sales','SQ','Gross Sales FP %','Net Sales FP','Net Sales WSP',
  'Margin','Margin %','Discount','Discount %','ASP','OHQ','OHQ WSP',
  'Unit WSP','Sell through %','Sell through WSP %','WOS',
];
// Senza queste non si può costruire una classifica affidabile.
const BS_COL_REQUIRED = ['Product Code','Net Sales','SQ','OHQ'];
const bsNormCol = s => String(s==null?'':s).replace(/\s+/g,' ').trim().toLowerCase();

// Codici da escludere dai report: materiale di consumo che nell'export adidas
// compare come articolo venduto ma non è un prodotto da classifica (buste).
// Per aggiungerne altri basta inserire il codice in questa lista.
const BS_EXCLUDE = new Set(['LAB33290', 'LAB33291', 'LAB33292']);

// Traduzioni delle categorie dell'export (in inglese) per la vista negozio.
const BS_DIV = {FOOTWEAR:'Calzature', APPAREL:'Abbigliamento', HARDWARE:'Accessori'};
const BS_GEN = {MEN:'Uomo', WOMEN:'Donna', KIDS:'Bambino', INFANTS:'Neonato'};
const BS_CAT = {
  'FOOTBALL/SOCCER':'Calcio', RUNNING:'Running', ORIGINALS:'Originals',
  'NOT SPORTS SPECIFIC':'Non specifico', SWIM:'Nuoto', SPORTSWEAR:'Sportswear',
  TRAINING:'Training', BASKETBALL:'Basket', SKATEBOARDING:'Skate', OUTDOOR:'Outdoor',
  'OLYMPIC SPORTS':'Sport olimpici',
};

// ── Utility ─────────────────────────────────────────────────────────────
function bsEsc(s){
  return String(s==null?'':s).replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function bsFmt(v,t){
  if(v===null||v===undefined||v==='') return '—';
  if(t==='e') return '€ '+Number(v).toLocaleString('it-IT',{maximumFractionDigits:2});
  if(t==='p') return (Number(v)*100).toLocaleString('it-IT',{maximumFractionDigits:1})+'%';
  if(t==='i') return Number(v).toLocaleString('it-IT');
  return String(v);
}
const bsEur = n => '€ '+Number(n||0).toLocaleString('it-IT',{maximumFractionDigits:0});
const bsUniq = a => [...new Set(a.filter(Boolean))].sort((x,y)=>x.localeCompare(y,'it'));
const bsIsAdmin = () => (auth.user||{}).role === 'admin';
function bsNorm(s){ return String(s||'').split(/\s+/).filter(Boolean).join(' ').toLowerCase(); }
// "06/07/2026" → "2026-07-06". Serve come chiave dello storico.
function bsIsoDate(s){
  const m = String(s||'').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if(!m) return '';
  return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
}
function bsPeriodLabel(iso){
  const m = String(iso||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

// Chiamata con limite di attesa. Il backend sta su Render: dopo un periodo di
// inattività o subito dopo un deploy la prima risposta può richiedere quasi un
// minuto (cold start). Senza un limite l'attesa resterebbe muta a schermo.
const BS_TIMEOUT = 50000;
async function bsApi(path, opts){
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), BS_TIMEOUT);
  try{
    return await api(path, Object.assign({}, opts, {signal: ac.signal}));
  }finally{
    clearTimeout(t);
  }
}
const bsIsAbort = e => e && (e.name === 'AbortError' || /abort/i.test(e.message||''));

// ── Ingresso: chiamato da switchTab('bestseller') ───────────────────────
async function renderBestSeller(){
  const root = document.getElementById('bs-root');
  if(!root) return;
  if(BS.index === null){
    root.innerHTML = bsState('Carico i report…','il server si sta svegliando, può richiedere qualche secondo');
    try{
      const [ri, rm] = await Promise.all([bsApi('/bestseller/index'), bsApi('/bestseller/map')]);
      BS.index = ri.ok ? await ri.json() : [];
      BS.map = rm.ok ? await rm.json() : [];
    }catch(e){
      console.warn('[bestseller] caricamento indice fallito', e);
      root.innerHTML = bsStrip() + bsHeader(null) + bsRetry(bsIsAbort(e)
        ? 'Il server non ha risposto in tempo'
        : 'Non riesco a contattare il server') + bsFooter();
      bsBind();
      return;   // BS.index resta null: al prossimo tentativo si riprova davvero
    }
    // Selezione iniziale: settimana più recente, vista "tutti i negozi".
    // Se quella settimana ha un solo negozio l'aggregato non ha senso, quindi
    // si apre direttamente su quel negozio.
    if(BS.index.length && !BS.cur){
      const last = BS.index.map(w=>w.period_start).sort().reverse()[0];
      const inWeek = BS.index.filter(w => w.period_start === last);
      BS.cur = inWeek.length > 1
        ? {aggregate:true, period_start:last}
        : {brand:inWeek[0].brand, location:inWeek[0].location, period_start:last};
    }
  }
  if(BS.cur && !BS.data) { await bsLoadCurrent(); return; }
  bsPaint();
}

async function bsLoadCurrent(){
  if(!BS.cur){ bsPaint(); return; }   // nessuna settimana selezionata: mostro lo stato vuoto
  const root = document.getElementById('bs-root');
  if(root) root.innerHTML = bsState('Carico il report…','');
  BS.data = null;
  try{
    const c = BS.cur;
    const path = c.aggregate
      ? '/bestseller/aggregate?period_start='+encodeURIComponent(c.period_start)
      : '/bestseller/week?brand='+encodeURIComponent(c.brand)
        +'&location='+encodeURIComponent(c.location)
        +'&period_start='+encodeURIComponent(c.period_start);
    // Stessa cache degli altri insiemi pesanti: IndexedDB + versione da
    // /datasets/version. L'aggregato è ~550 kB che il backend ricalcola a ogni
    // richiesta (misurato il 03/08) e la versione cambia solo quando si importa.
    BS.data = await fetchCached(bsCacheKey(c), path, _dsVersions.bestseller);
    if(!BS.data || !BS.data.products) BS.data = {error: 'Report non disponibile'};
    else await bsAttachPhotos(BS.data.products);
  }catch(e){
    BS.data = {error: String(e.message||e)};
  }
  bsPaint();
}

// ── Filtri e ordinamento (stessa logica del design) ─────────────────────
function bsFiltered(){
  const q = BS.query.trim().toLowerCase();
  const list = (BS.data.products||[]).filter(p =>
    (!BS.fDiv || p.div===BS.fDiv) && (!BS.fGen || p.gender===BS.fGen) && (!BS.fCat || p.cat===BS.fCat) &&
    (!BS.fSea || bsSeason(p)===BS.fSea) &&
    (!q || (p.name||'').toLowerCase().includes(q) || (p.code||'').toLowerCase().includes(q)));
  return list.slice().sort((a,b)=> BS.sort==='units' ? b.units-a.units : b.net-a.net);
}

// ── Rendering ───────────────────────────────────────────────────────────
function bsState(title, sub){
  return `<div class="bs-state"><div class="bs-state-t">${bsEsc(title)}</div>`+
         (sub?`<div class="bs-state-s">${bsEsc(sub)}</div>`:'')+`</div>`;
}

// Stato di errore con possibilità di riprovare, invece di un'attesa infinita.
function bsRetry(msg){
  return `<div class="bs-state">
    <div class="bs-state-t">${bsEsc(msg)}</div>
    <div class="bs-state-s">Il servizio va in pausa quando non è usato: il primo
      risveglio può richiedere fino a un minuto.</div>
    <div style="margin-top:22px"><button class="bs-btn" id="bs-reload">↻ Riprova</button></div>
  </div>`;
}

function bsPaint(){
  const root = document.getElementById('bs-root');
  if(!root) return;
  const admin = bsIsAdmin();

  if(!BS.index || !BS.index.length){
    root.innerHTML = bsStrip() + bsHeader(null) +
      bsAdminLog() +
      bsState('Nessun report caricato',
              admin ? 'Usa “Importa Excel” qui sopra per caricare il primo report.'
                    : 'I best seller compariranno qui appena caricati.') +
      bsFooter();
    bsBind();
    return;
  }
  if(BS.data && BS.data.error){
    root.innerHTML = bsStrip() + bsHeader(BS.data) + bsAdminLog() +
      bsState('Report non disponibile', BS.data.error) + bsFooter();
    bsBind();
    return;
  }
  if(!BS.data){ root.innerHTML = bsState('Carico il report…',''); return; }

  const d = BS.data;
  const all = d.products || [];
  const list = bsFiltered();
  const max = list.length ? Math.max(...list.map(p=>p.units)) || 1 : 1;
  const totUnits = all.reduce((s,x)=>s+(x.units||0),0);
  const totNet = all.reduce((s,x)=>s+(x.net||0),0);
  const first = all[0];

  const kpis = [
    {l:'Prodotti venduti', v:String(all.length), s:'referenze attive', size:'clamp(28px,3vw,40px)'},
    {l:'Pezzi totali', v:totUnits.toLocaleString('it-IT'), s:'unità sell-out', size:'clamp(28px,3vw,40px)'},
    // Nel link pubblico il valore non arriva nemmeno dal backend.
    ...(BS.public ? [] : [{l:'Valore netto', v:bsEur(totNet), s:'vendite nette periodo', size:'clamp(24px,2.5vw,34px)'}]),
    d.aggregate
      ? {l:'Negozi inclusi', v:String(d.store_count||0), s:'report aggregato', size:'clamp(28px,3vw,40px)'}
      : {l:'Best seller n°1', v:first?first.name:'—', s:first?first.code:'', size:'clamp(15px,1.6vw,20px)'},
  ];

  const podium = list.slice(0,3).map((p,i)=>`
    <button class="bs-pcard" data-open="${bsEsc(p.code)}">
      <div class="bs-ptop">
        <div class="bs-prank${i===0?' bs-first':''}">${i+1}</div>
        <div class="bs-pbadge">${i===0?'Best seller':'Top '+(i+1)}</div>
      </div>
      <div class="bs-pimg">${bsImg(p)}</div>
      <div class="bs-pbody">
        <div class="bs-pname">${bsEsc(p.name)}</div>
        <div class="bs-pmeta">${bsEsc(p.code)} · ${bsEsc(p.gender)} · ${bsEsc(p.cat)}</div>
        <div class="bs-pfoot">
          <div><div class="bs-pnum">${p.units}</div><div class="bs-plab">Pezzi</div></div>
          <div style="text-align:center">
            <div class="bs-pohq${bsOhqZero(p)?' bs-zero':''}">${bsOhqTxt(p)}</div>
            <div class="bs-plab">Giacenza</div></div>
          <div style="text-align:right"><div class="bs-pnet">${bsEur(p.net)}</div><div class="bs-plab">Valore</div></div>
        </div>
      </div>
    </button>`).join('');

  const rows = list.map((p,i)=>{
    const st = Number((p.all||[])[BS_I_ST]);
    const stOk = isFinite(st) && (p.all||[])[BS_I_ST]!=null;
    const ohqRaw = (p.all||[])[BS_I_OHQ];
    const ohq = Number(ohqRaw);
    const ohqOk = ohqRaw!=null && isFinite(ohq);
    return `
    <button class="bs-row" data-open="${bsEsc(p.code)}">
      <div class="bs-c-rank">${i+1}</div>
      <div class="bs-c-img">${bsImg(p)}</div>
      <div class="bs-c-main">
        <div class="bs-rname">${bsEsc(p.name)}</div>
        <div class="bs-rmeta"><b>${bsEsc(p.code)}</b><span class="bs-minidot"></span>
          <span>${bsEsc(p.div)} · ${bsEsc(p.gender)} · ${bsEsc(p.cat)}</span></div>
      </div>
      <div class="bs-c-units">
        <div class="bs-runits">${p.units}</div>
        <div class="bs-bar"><i style="width:${Math.max(6,Math.round((p.units/max)*100))}%"></i></div>
      </div>
      <div class="bs-c-ohq">
        <div class="bs-rohq${ohqOk && ohq<=0 ? ' bs-zero':''}">${ohqOk?bsFmt(ohq,'i'):'—'}</div>
        ${ohqOk && ohq<=0 ? '<div class="bs-ohq-note">esaurito</div>' : ''}
      </div>
      <div class="bs-c-net">${bsEur(p.net)}</div>
      <div class="bs-c-st${stOk && st<0.5 ? ' bs-low':''}">${stOk?bsFmt(st,'p'):'—'}</div>
      <div class="bs-c-chev">›</div>
    </button>`;
  }).join('');

  const hasF = !!(BS.query||BS.fDiv||BS.fGen||BS.fCat||BS.fSea);
  const opt = (v,cur)=>`<option value="${bsEsc(v)}"${v===cur?' selected':''}>${bsEsc(v)}</option>`;

  root.innerHTML = bsStrip() + bsHeader(d) + `
  <div class="bs-kpiwrap"><div class="bs-kpis">
    ${kpis.map(k=>`<div class="bs-kpi">
      <div class="bs-kpi-l">${bsEsc(k.l)}</div>
      <div class="bs-kpi-v" style="font-size:${k.size}">${bsEsc(k.v)}</div>
      <div class="bs-kpi-s">${bsEsc(k.s)}</div></div>`).join('')}
  </div></div>
  ${bsAdminLog()}
  ${list.length>=3?`<section class="bs-section">
    <div class="bs-sechead"><h3>Podio</h3><div class="bs-rule"></div>
      <span class="bs-secmeta">Top 3 · ${BS.sort==='units'?'per pezzi venduti':'per valore netto'}</span></div>
    <div class="bs-podium">${podium}</div>
  </section>`:''}
  <div class="bs-tools"><div class="bs-tools-in">
    <div class="bs-search"><span>⌕</span>
      <input id="bs-q" value="${bsEsc(BS.query)}" placeholder="Cerca nome o codice"></div>
    <select class="bs-fsel" id="bs-fdiv"><option value="">Divisione</option>
      ${bsUniq(all.map(p=>p.div)).map(v=>opt(v,BS.fDiv)).join('')}</select>
    <select class="bs-fsel" id="bs-fgen"><option value="">Genere</option>
      ${bsUniq(all.map(p=>p.gender)).map(v=>opt(v,BS.fGen)).join('')}</select>
    <select class="bs-fsel" id="bs-fcat"><option value="">Categoria</option>
      ${bsUniq(all.map(p=>p.cat)).map(v=>opt(v,BS.fCat)).join('')}</select>
    <select class="bs-fsel" id="bs-fsea"><option value="">Stagione</option>
      ${bsUniq(all.map(bsSeason)).sort(bsSeasonCmp).map(v=>opt(v,BS.fSea)).join('')}</select>
    <div class="bs-sortgrp">
      <button class="bs-sortbtn${BS.sort==='units'?' bs-on':''}" data-sort="units">Pezzi</button>
      <button class="bs-sortbtn${BS.sort==='net'?' bs-on':''}" data-sort="net">Valore</button>
    </div>
    ${hasF?'<button class="bs-reset" id="bs-reset">Azzera ✕</button>':''}
  </div></div>
  <section class="bs-section bs-list">
    <div class="bs-sechead bs-tight"><h3>Classifica</h3><div class="bs-rule"></div>
      <span class="bs-secmeta">${list.length} prodotti · ${list.reduce((s,x)=>s+(x.units||0),0)} pz</span></div>
    <div class="bs-thead">
      <div style="flex:0 0 34px">#</div>
      <div style="flex:0 0 clamp(48px,5vw,64px)">Art.</div>
      <div style="flex:1 1 auto">Prodotto</div>
      <div class="bs-c-units">Pezzi</div>
      <div class="bs-c-ohq">Giacenza</div>
      <div class="bs-c-net">Valore</div>
      <div class="bs-c-st">Sell-thru</div>
      <div style="flex:0 0 14px"></div>
    </div>
    <div class="bs-rows">${rows || `<div class="bs-empty">
      <div class="bs-empty-t">Nessun prodotto</div>
      <div class="bs-empty-s">Prova ad azzerare i filtri</div></div>`}</div>
  </section>
  ${bsFooter()}
  ${BS.detail?bsModal(BS.detail):''}`;
  bsBind();
}

// Giacenza residua dell'articolo (colonna OHQ dell'export).
// Nell'aggregato è la somma delle giacenze dei negozi di quella settimana.
function bsOhq(p){
  const v = (p.all||[])[BS_I_OHQ];
  const n = Number(v);
  return (v==null || !isFinite(n)) ? null : n;
}
function bsOhqTxt(p){ const n = bsOhq(p); return n==null ? '—' : bsFmt(n,'i'); }
function bsOhqZero(p){ const n = bsOhq(p); return n!=null && n<=0; }

// Le foto caricate arrivano come percorso del backend ("/bestseller/photo/…"),
// quindi va anteposto API_BASE: il frontend sta su un dominio diverso.
// Un eventuale link esterno (http…) viene invece usato così com'è.
function bsPhotoSrc(img){
  return String(img||'').startsWith('/') ? API_BASE + img : img;
}
function bsImg(p){
  return p.img
    ? `<img src="${bsEsc(bsPhotoSrc(p.img))}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`
    : '';
}

function bsStrip(){
  return `<div class="bs-strip"><span class="bs-dim">Report interno</span>
    <span class="bs-dot"></span><span>Best Seller settimanali di negozio</span></div>`;
}

// Numero di settimana ISO 8601 dalla data di inizio periodo. Verificato contro
// il calendario sui casi limite: 28/12/2026 → W53, 29/12/2025 → W1 (del 2026),
// 04/01/2027 → W1. Regola ISO: decide il giovedì della stessa settimana.
function bsWeekNum(iso){
  const m = String(iso||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2]-1, +m[3]));
  const day = (d.getUTCDay() + 6) % 7;             // lun=0 … dom=6
  d.setUTCDate(d.getUTCDate() - day + 3);          // giovedì di questa settimana
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const f = (firstThu.getUTCDay() + 6) % 7;
  firstThu.setUTCDate(firstThu.getUTCDate() - f + 3);
  return 1 + Math.round((d - firstThu) / 604800000);
}

// Lunedì della settimana precedente a oggi, in ISO. Il confronto si fa per
// DATA e non per numero di settimana: a cavallo d'anno "numero - 1" sbaglia,
// perché prima della W1 non c'è la W0 ma la W52 (o la W53) dell'anno prima.
function bsLastWeekStart(){
  const d = new Date();
  d.setHours(0,0,0,0);
  const day = (d.getDay() + 6) % 7;                // lun=0 … dom=6
  d.setDate(d.getDate() - day - 7);                // lunedì di sette giorni prima
  const p = n => String(n).padStart(2,'0');
  return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());
}

// Etichetta della settimana: "LAST WEEK" solo se è davvero quella precedente al
// giorno in cui si guarda, altrimenti il numero ISO (richiesta del 03/08).
// Se il periodo non inizia di lunedì il confronto non scatta e resta il numero.
function bsWeekLabel(ps){
  if(ps && ps === bsLastWeekStart()) return 'LAST WEEK';
  const n = bsWeekNum(ps);
  return n ? 'W'+n : bsPeriodLabel(ps);
}

// Periodo in forma breve per la riga secondaria: "20/07 – 26/07".
function bsWeekRange(w){
  const short = t => bsPeriodLabel(t).replace(/\/\d{4}$/,'');
  return w.period_end ? short(w.period_start)+' – '+short(w.period_end)
                      : bsPeriodLabel(w.period_start);
}

// Chiave della copia locale. Deve distinguere ogni selezione, altrimenti una
// settimana servirebbe i dati di un'altra.
function bsCacheKey(c){
  return 'bs:' + (c.aggregate ? 'agg|'+c.period_start
                              : [c.brand, c.location, c.period_start].join('|'));
}

// Report disponibili raggruppati per settimana: {period_start: [voci indice]}.
function bsWeeks(){
  const weeks = {};
  (BS.index||[]).forEach(w => { (weeks[w.period_start] = weeks[w.period_start] || []).push(w); });
  return weeks;
}

// Due selettori distinti, SETTIMANA e NEGOZIO. La settimana comanda: la lista
// negozi contiene solo chi ha caricato quella settimana, così non si può
// scegliere una combinazione senza dati (deciso il 03/08).
// Sono listbox costruiti a mano perché la tendina di un <select> nativo la
// disegna il sistema operativo e non si può portare nello stile del modulo.
function bsHeader(d){
  const weeks = bsWeeks();
  const keys = Object.keys(weeks).sort().reverse();
  const curPs = BS.cur ? BS.cur.period_start : null;

  // ── Selettore settimana: tutte le settimane presenti in archivio.
  let curWeek = '—';
  let weekOpts = '';
  keys.forEach(ps => {
    const label = bsWeekLabel(ps);
    const sel = ps === curPs;
    if(sel) curWeek = label;
    weekOpts += `<button class="bs-picker-opt${sel?' bs-sel':''}" role="option"
      aria-selected="${sel}" data-week="${bsEsc(ps)}">
      <span class="bs-picker-mark"></span>
      <span class="bs-picker-lab">${bsEsc(label)}</span>
      <span class="bs-picker-n">${bsEsc(bsWeekRange(weeks[ps][0]))}</span></button>`;
  });

  // ── Selettore negozio: solo i negozi della settimana selezionata.
  const inWeek = curPs ? (weeks[curPs] || []) : [];
  let curStore = '—';
  let storeOpts = '';
  if(inWeek.length > 1){
    const sel = !!(BS.cur && BS.cur.aggregate);
    const txt = '★ Tutti i negozi';
    if(sel) curStore = txt;
    storeOpts += `<button class="bs-picker-opt bs-agg${sel?' bs-sel':''}" role="option"
      aria-selected="${sel}" data-val="AGG|${bsEsc(curPs)}">
      <span class="bs-picker-mark"></span>
      <span class="bs-picker-lab">${txt}</span>
      <span class="bs-picker-n">${inWeek.length} negozi</span></button>`;
  }
  inWeek.forEach(w => {
    const sel = !!(BS.cur && !BS.cur.aggregate && BS.cur.brand===w.brand
                   && BS.cur.location===w.location);
    const txt = w.brand+' · '+w.location;
    if(sel) curStore = txt;
    storeOpts += `<button class="bs-picker-opt${sel?' bs-sel':''}" role="option"
      aria-selected="${sel}" data-val="${bsEsc([w.brand,w.location,w.period_start].join('|'))}">
      <span class="bs-picker-mark"></span>
      <span class="bs-picker-lab">${bsEsc(txt)}</span></button>`;
  });

  // Link pubblico: il destinatario non ha l'archivio, quindi le etichette
  // vengono dal report stesso e i due selettori restano inerti (senza voci il
  // pulsante nasce già disabilitato).
  if(BS.public){
    curWeek = d ? bsWeekLabel(d.period_start) : '—';
    curStore = d ? (d.brand+' · '+d.location) : '—';
    weekOpts = storeOpts = '';
  }

  return `
  <header class="bs-header"><div class="bs-header-in">
    <div class="bs-brandcol">
      <div class="bs-logorow">
        <img src="icons/adidas-logo.png" alt="adidas">
        <span class="bs-vr"></span>
        <span class="bs-kicker">Sell-out weekly</span>
      </div>
      <h1 class="bs-h1">Best<br>Seller<span>.</span></h1>
      <div class="bs-claim">Impossible is nothing</div>
    </div>
    <div class="bs-selcol">
      <div class="bs-selrow">
        <div class="bs-selfield">
          <div class="bs-sellabel">Settimana</div>
          <div class="bs-picker" data-picker="week">
            <button class="bs-picker-btn" aria-haspopup="listbox"
              aria-expanded="false"${weekOpts?'':' disabled'}>
              <span class="bs-picker-cur">${bsEsc(curWeek)}</span>
              <span class="bs-picker-chev">▼</span>
            </button>
            <div class="bs-picker-panel" role="listbox">${weekOpts}</div>
          </div>
        </div>
        <div class="bs-selfield">
          <div class="bs-sellabel">Negozio</div>
          <div class="bs-picker" data-picker="store">
            <button class="bs-picker-btn" aria-haspopup="listbox"
              aria-expanded="false"${storeOpts?'':' disabled'}>
              <span class="bs-picker-cur">${bsEsc(curStore)}</span>
              <span class="bs-picker-chev">▼</span>
            </button>
            <div class="bs-picker-panel" role="listbox">${storeOpts}</div>
          </div>
        </div>
      </div>
      <div class="bs-chips">
        ${bsAdminChips(d)}
      </div>
    </div>
  </div></header>`;
}

// Azioni admin come pillole accanto al periodo: l'import è l'operazione più
// frequente e sta dove si guarda la settimana di riferimento.
function bsAdminChips(d){
  if(!bsIsAdmin()) return '';
  const canDelete = !!(BS.cur && !BS.cur.aggregate && d && !d.error);
  return `
    <input type="file" id="bs-file" accept=".xlsx,.xls" multiple style="display:none">
    <button class="bs-chip-btn" id="bs-import"${BS.busy?' disabled':''}>
      ${BS.busy?'⏳ Importo…':'📥 Importa Excel'}</button>
    <button class="bs-chip-btn" id="bs-codes"${BS.busy?' disabled':''}>⬇ Codici senza foto</button>
    <button class="bs-chip-btn" id="bs-link"${BS.cur?'':' disabled'}>🔗 Copia link</button>
    <button class="bs-chip-btn" id="bs-unlink"${BS.cur?'':' disabled'}>🔒 Spegni link</button>
    ${canDelete?`<button class="bs-chip-btn" id="bs-del">🗑 Elimina settimana</button>`:''}`;
}

function bsFooter(){
  return `<footer class="bs-footer"><div class="bs-footer-in">
    <div style="display:flex;align-items:center;gap:16px">
      <img src="icons/adidas-logo.png" alt="adidas">
      <span class="bs-fclaim">Impossible is nothing</span></div>
    <div class="bs-fnote">Best Seller Report<br>Uso interno negozio</div>
  </div></footer>`;
}

function bsModal(p){
  // Posizione riferita alla classifica che l'utente sta guardando (filtri e
  // ordinamento attivi), non all'ordine originale del file.
  const rank = bsFiltered().findIndex(x=>x.code===p.code) + 1;
  const hero = [
    {l:'Pezzi venduti', v:String(p.units)},
    {l:'Vendite nette', v:bsEur(p.net)},
    {l:'Sell through', v:bsFmt((p.all||[])[BS_I_ST],'p')},
  ];
  const groups = BS_GROUPS.map(g=>`
    <div><div class="bs-gtitle">${bsEsc(g.title)}</div>
      ${g.idx.map(i=>`<div class="bs-fld">
        <span class="bs-fld-l">${bsEsc(BS_FIELDS[i].l)}</span>
        <span class="bs-fld-v">${bsEsc(bsFmt((p.all||[])[i], BS_FIELDS[i].t))}</span></div>`).join('')}
    </div>`).join('');
  return `<div class="bs-backdrop" id="bs-backdrop"><div class="bs-modal">
    <button class="bs-x" id="bs-close">✕</button>
    <div class="bs-mtop">
      <div class="bs-mimg">${bsImg(p)}</div>
      <div class="bs-mbody">
        <div class="bs-mrank">${rank>0?'Posizione n° '+rank+' in classifica':'Scheda prodotto'}</div>
        <div class="bs-mname">${bsEsc(p.name)}</div>
        <div class="bs-mmeta">${bsEsc(p.code)} · ${bsEsc(p.div)} · ${bsEsc(p.gender)} · ${bsEsc(p.cat)}</div>
        <div class="bs-hero">${hero.map(h=>`<div>
          <div class="bs-hero-v">${bsEsc(h.v)}</div>
          <div class="bs-hero-l">${bsEsc(h.l)}</div></div>`).join('')}</div>
      </div>
    </div>
    <div class="bs-groups">${groups}</div>
  </div></div>`;
}

// ── Registro operazioni admin ───────────────────────────────────────────
// I pulsanti stanno nell'header (vedi bsAdminChips): qui resta solo l'esito
// degli import, mostrato finché ci sono righe da leggere.
function bsAdminLog(){
  if(!bsIsAdmin() || !BS.log.length) return '';
  return `
  <div class="bs-admin"><div class="bs-admin-box">
    <div class="bs-admin-h">
      <h4>Esito import</h4>
      <div style="flex:1"></div>
      <button class="bs-btn bs-ghost" id="bs-log-clear">Nascondi</button>
    </div>
    <div class="bs-log">${BS.log.join('<br>')}</div>
  </div></div>`;
}

// Il messaggio è HTML: chi chiama passa i valori variabili già ripuliti con
// bsEsc, così restano leggibili le parti in grassetto volute.
function bsLog(msg, err){
  BS.log.unshift(err?`<span class="bs-err">${msg}</span>`:String(msg));
  BS.log = BS.log.slice(0,40);
  const el = document.querySelector('.bs-log');
  if(el) el.innerHTML = BS.log.join('<br>');
  else bsPaint();
}

// ── Parsing dell'Excel adidas (nel browser, con SheetJS) ────────────────
// Struttura del file: righe di intestazione con "Date:", "Store:", "Season - new:",
// poi la riga colonne con 'Product Code' in colonna B, poi i prodotti, poi TOTAL.
function bsParseWorkbook(ab, fileName){
  const wb = XLSX.read(ab, {type:'array', cellDates:true});
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, {header:1, raw:true, defval:null});

  let storeRaw='', periodLabel='', season='', head=-1;
  for(let i=0;i<rows.length;i++){
    const c0 = rows[i] && rows[i][0];
    if(typeof c0 === 'string'){
      if(/^\s*Date:/i.test(c0))            periodLabel = c0.replace(/^\s*Date:\s*/i,'').trim();
      else if(/Store:/i.test(c0))          storeRaw = c0.split(/Store:/i)[1].trim();
      else if(/Season/i.test(c0) && c0.includes(':')) season = c0.split(':').pop().trim();
    }
    if(rows[i] && String(rows[i][1]||'').trim() === 'Product Code'){ head = i; break; }
  }
  if(head < 0) throw new Error(`${fileName}: non trovo la riga colonne ("Product Code" in colonna B).`);
  if(!storeRaw) throw new Error(`${fileName}: non trovo il negozio (riga "Store:").`);

  const parts = periodLabel.split('-').map(s=>s.trim());
  const period_start = bsIsoDate(parts[0]);
  const period_end   = bsIsoDate(parts[1]||'');
  if(!period_start) throw new Error(`${fileName}: periodo non riconosciuto ("${periodLabel}").`);

  const cell = v => (v instanceof Date)
    ? v.toISOString().slice(0,10)
    : (v===undefined ? null : v);

  // Colonne riconosciute per NOME dalla riga di intestazione, non per posizione:
  // il portale esporta con insiemi di colonne diversi (vedi BS_COLNAMES).
  // `col[k]` = posizione nel file della k-esima colonna canonica, -1 se assente.
  const pos = {};
  (rows[head]||[]).forEach((h,i) => { const k = bsNormCol(h); if(k && !(k in pos)) pos[k] = i; });
  const col = BS_COLNAMES.map(n => { const i = pos[bsNormCol(n)]; return i===undefined ? -1 : i; });
  const mancanti = BS_COL_REQUIRED.filter(n => col[BS_COLNAMES.indexOf(n)] < 0);
  if(mancanti.length) throw new Error(`${fileName}: colonne mancanti nell'export (${mancanti.join(', ')}).`);
  const ignorate = BS_COLNAMES.filter(n => col[BS_COLNAMES.indexOf(n)] < 0);
  const at = (r, k) => col[k] < 0 ? null : r[col[k]];

  const I_CODE=0, I_NAME=1, I_CAT=2, I_GEN=3, I_DIV=8, I_NET=12, I_SQ=13;
  const products = [];
  let excluded = 0;
  for(let i=head+1;i<rows.length;i++){
    const r = rows[i]; if(!r) continue;
    const code = at(r, I_CODE);
    if(!code || String(code).trim()==='Product Code') continue;
    if(String(at(r, I_NAME)||'').trim().toUpperCase()==='TOTAL') continue;
    if(BS_EXCLUDE.has(String(code).trim().toUpperCase())){ excluded++; continue; }
    const units = Number(at(r, I_SQ)||0);
    if(!(units > 0)) continue;              // solo venduto reale: no resi, no zeri
    const all = BS_COLNAMES.map((_,k) => cell(at(r, k)));
    const up = s => String(s||'').trim().toUpperCase();
    const tit = s => { const t=String(s||'').trim(); return t? t.charAt(0)+t.slice(1).toLowerCase() : ''; };
    products.push({
      code: String(code).trim(),
      name: String(at(r, I_NAME)||'').trim(),
      cat:  BS_CAT[up(at(r, I_CAT))] || tit(at(r, I_CAT)),
      gender: BS_GEN[up(at(r, I_GEN))] || tit(at(r, I_GEN)),
      div:  BS_DIV[up(at(r, I_DIV))] || tit(at(r, I_DIV)),
      units: Math.round(units),
      net: Math.round(Number(at(r, I_NET)||0)),
      all,
    });
  }
  if(!products.length) throw new Error(`${fileName}: nessun prodotto con vendite maggiori di zero.`);
  products.sort((a,b)=>b.units-a.units);
  return {storeRaw, period:periodLabel, period_start, period_end, season, products, excluded,
          missingCols: ignorate};
}

// Corrispondenza nome-negozio adidas → brand|location della dashboard.
// Se sconosciuta, la chiede una volta e resta salvata sul server.
function bsResolveStore(storeRaw){
  const hit = (BS.map||[]).find(m => m.raw === bsNorm(storeRaw));
  if(hit) return {brand:hit.brand, location:hit.location};
  const adidas = (typeof ALL_STORES!=='undefined'?ALL_STORES:[]).filter(s=>s.brand==='Adidas');
  const list = adidas.map((s,i)=>`${i+1}. ${s.location}`).join('\n');
  const ans = prompt(
    `Negozio adidas non riconosciuto:\n"${storeRaw}"\n\n`+
    `A quale negozio corrisponde? Scrivi il numero:\n\n${list}`, '');
  if(ans===null) return null;
  const idx = parseInt(String(ans).trim(),10) - 1;
  if(!(idx>=0 && idx<adidas.length)) throw new Error('Numero negozio non valido.');
  return {brand:'Adidas', location:adidas[idx].location};
}

async function bsImportFiles(files){
  BS.busy = true; bsPaint();
  let ok=0, ko=0;
  for(const f of files){
    try{
      bsLog(`Leggo ${bsEsc(f.name)}…`);
      const parsed = bsParseWorkbook(await f.arrayBuffer(), f.name);
      if(parsed.missingCols && parsed.missingCols.length)
        bsLog(`${bsEsc(f.name)}: in questo export mancano ${bsEsc(parsed.missingCols.join(', '))}`
          + ` — restano vuote in scheda, il resto è allineato per nome di colonna.`);
      const store = bsResolveStore(parsed.storeRaw);
      if(!store){ bsLog(`${bsEsc(f.name)}: salto (nessun negozio scelto).`); continue; }
      const r = await api('/bestseller/week', {method:'POST', body: JSON.stringify({
        brand: store.brand, location: store.location, store_raw: parsed.storeRaw,
        period: parsed.period, period_start: parsed.period_start,
        period_end: parsed.period_end, season: parsed.season, products: parsed.products,
      })});
      if(!r.ok){
        let detail = 'Errore '+r.status;
        try{ const e = await r.json(); if(e.detail) detail = typeof e.detail==='string'?e.detail:JSON.stringify(e.detail); }catch(_){}
        throw new Error(detail);
      }
      ok++;
      // La corrispondenza appena confermata entra subito nella cache locale:
      // caricando più settimane dello stesso negozio non la richiede di nuovo.
      if(!(BS.map||[]).some(m => m.raw === bsNorm(parsed.storeRaw))){
        (BS.map = BS.map || []).push({
          raw: bsNorm(parsed.storeRaw), label: parsed.storeRaw,
          brand: store.brand, location: store.location,
        });
      }
      bsLog(`<b>${bsEsc(store.location)}</b> · ${parsed.products.length} prodotti · ${parsed.period} — salvato`
            + (parsed.excluded ? ` (${parsed.excluded} buste escluse)` : ''));
    }catch(e){
      ko++; bsLog(`${bsEsc(f.name)}: ${bsEsc(e.message||e)}`, true);
    }
  }
  // Ricarico indice e corrispondenze, poi riparto dalla settimana appena caricata.
  BS.index = null; BS.data = null; BS.cur = null; BS.busy = false;
  await renderBestSeller();
  bsLog(`Import concluso: ${ok} ok${ko?`, ${ko} con errori`:''}.`);
}

// ── Foto prodotto ───────────────────────────────────────────────────────
// Le foto stanno in una cartella Drive condivisa, caricate a mano dall'admin e
// rinominate col codice articolo (JY5212.png). Il backend elenca solo nome e id
// dei file (/bestseller/photos); l'abbinamento nome-file → codice lo facciamo
// qui con bsMatchCode, e l'immagine la chiede il browser DIRETTAMENTE a Google.
//
// Questo è il punto: le foto non passano né da Mongo né da Render. Tenerle in
// database è ciò che ha mandato il backend in OOM il 31/07 (app offline), e il
// caricamento dall'app con ZIP e ridimensionamento è stato rimosso il 03/08.
//
// L'elenco si chiede una volta per sessione: se aggiungi foto su Drive mentre
// la pagina è aperta, ricaricala per vederle.

// Miniatura del file. Si usa `thumb` (thumbnailLink di Drive): è già generata e
// servita dalla CDN googleusercontent, quindi il browser la mette in cache e i
// cambi di vista non ricaricano nulla.
// Il ripiego drive.google.com/thumbnail vale solo per i file la cui miniatura
// non è ancora pronta: genera l'immagine al momento e rimbalza su un URL con
// token sempre diverso, quindi non è mai in cache (~10 s per foto, misurato il
// 03/08). Se compaiono lentezze, il colpevole è questo ramo.
const bsThumb = f => f.thumb || ('https://drive.google.com/thumbnail?id='+encodeURIComponent(f.id)+'&sz=w400');

// Aggancia ai prodotti il campo `img`. Non solleva mai: senza foto il modulo
// funziona identico, con i riquadri vuoti (bsImg torna stringa vuota).
async function bsAttachPhotos(products){
  try{
    if(!products || !products.length) return;
    if(BS.photos === null){
      // Nel link pubblico l'elenco arriva col payload: bs.html non carica
      // 02-sync.js, quindi lì fetchCached non esiste e non va nemmeno valutata.
      let list = BS.public ? ((BS.data||{}).photos || []) : null;
      if(!list){
        // Drive non dichiara una versione: uso la data, così l'elenco si
        // rinfresca una volta al giorno. Le foto le carichi a mano e il tasto ↻
        // forza comunque il giro completo.
        list = (await fetchCached('bs:photos', '/bestseller/photos',
                                  new Date().toISOString().slice(0,10))).files || [];
      }
      // Ordino per nome: dell'export adidas arrivano più viste per articolo
      // (IA5379_1_…, IA5379_2_…) e sotto si tiene la prima che abbina. Senza
      // ordinamento vincerebbe quella che Drive restituisce per prima, cioè a
      // caso; così vince sempre la vista _1_, quella standard.
      BS.photos = list.sort((a,b) => String(a.name||'').localeCompare(String(b.name||'')));
    }
    if(!BS.photos.length) return;
    const byCode = new Map(products.map(p => [String(p.code||'').toUpperCase(), p.code]));
    const srcByCode = new Map();
    for(const f of BS.photos){
      const code = bsMatchCode(f.name, byCode);
      if(code && !srcByCode.has(code)) srcByCode.set(code, bsThumb(f));
    }
    for(const p of products){
      const src = srcByCode.get(p.code);
      if(src) p.img = src;
    }
  }catch(e){ console.debug('bsAttachPhotos', e); }
}

// ── Link pubblico da mandare ai negozi ──────────────────────────────────
// I ragazzi non hanno credenziali: il link apre bs.html, che legge la classifica
// da /public/bestseller senza login. Il token vale per la selezione corrente e
// si spegne cancellandolo. Dal link non passano valore, margine, sconti e ASP:
// li esclude il backend, non la pagina.
function bsLinkSel(){
  const c = BS.cur || {};
  return {period_start: c.period_start || '', brand: c.brand || '',
          location: c.location || '', aggregate: !!c.aggregate};
}

async function bsMakeLink(){
  if(!BS.cur) return;
  try{
    const r = await api('/bestseller/link', {method:'POST', body: JSON.stringify(bsLinkSel())});
    if(!r.ok) throw new Error('errore '+r.status);
    const url = location.origin + '/bs.html?t=' + encodeURIComponent((await r.json()).token);
    try{ await navigator.clipboard.writeText(url); bsLog('Link copiato negli appunti:', true); }
    catch(_){ bsLog('Link pronto (copialo da qui):', true); }
    bsLog(`<b>${bsEsc(url)}</b>`, true);
  }catch(e){ bsLog('Non riesco a creare il link: '+bsEsc(e.message||e), true); }
}

async function bsKillLink(){
  if(!BS.cur) return;
  const s = bsLinkSel();
  const q = `?period_start=${encodeURIComponent(s.period_start)}&brand=${encodeURIComponent(s.brand)}`
          + `&location=${encodeURIComponent(s.location)}&aggregate=${s.aggregate}`;
  try{
    const r = await api('/bestseller/link'+q, {method:'DELETE'});
    if(!r.ok) throw new Error('errore '+r.status);
    const n = (await r.json()).deleted || 0;
    bsLog(n ? 'Link spento: chi ce l\'ha non vede più questa classifica.'
            : 'Nessun link attivo per questa selezione.', true);
  }catch(e){ bsLog('Non riesco a spegnere il link: '+bsEsc(e.message||e), true); }
}

// Cerca un codice noto nel nome del file. Prima prova il nome esatto senza
// estensione (il caso normale), poi lo cerca come sottostringa.
function bsMatchCode(path, byCode){
  const base = String(path).split('/').pop().replace(/\.(png|jpe?g|webp)$/i,'').trim().toUpperCase();
  if(byCode.has(base)) return byCode.get(base);
  const tokens = base.split(/[^A-Z0-9]+/).filter(Boolean);
  for(const t of tokens) if(byCode.has(t)) return byCode.get(t);
  for(const [up, orig] of byCode) if(base.includes(up)) return orig;
  return null;
}


// ── Esportazione codici articolo ────────────────────────────────────────
// Scarica i codici degli articoli PRIVI di foto, presi da tutti i report (ogni
// negozio, ogni settimana). È la lista di lavoro per procurarsi le immagini
// mancanti: mano a mano che le carichi, l'elenco si accorcia.
// CSV con separatore ';' e BOM, così Excel italiano lo apre già in colonne.
async function bsDownloadCodes(){
  try{
    bsLog('Preparo l\'elenco dei codici senza foto…');
    const r = await api('/bestseller/codes');
    if(!r.ok) throw new Error(r.status===404
      ? 'endpoint non disponibile: il backend va aggiornato'
      : 'errore '+r.status);
    const all = (await r.json()).items || [];
    if(!all.length){ bsLog('Nessun report caricato: niente da esportare.', true); return; }
    // Chi ha già la foto non lo sa il backend (che non guarda la cartella
    // Drive): lo decide bsAttachPhotos, che mette `img` a chi ha un file
    // abbinato. Stessa logica della vista, un solo posto dove sbagliare.
    await bsAttachPhotos(all);
    const items = all.filter(i => !i.img);
    if(!items.length){ bsLog('Tutti gli articoli hanno già la foto: niente da scaricare.'); return; }

    const esc = v => {
      const s = String(v==null?'':v);
      return /[;"\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s;
    };
    const rows = [['codice','nome','divisione','genere','categoria']];
    items.forEach(i => rows.push([i.code, i.name, i.div, i.gender, i.cat]));
    const csv = '﻿' + rows.map(r => r.map(esc).join(';')).join('\r\n');

    const today = new Date().toISOString().slice(0,10);
    const url = URL.createObjectURL(new Blob([csv], {type:'text/csv;charset=utf-8'}));
    const a = document.createElement('a');
    a.href = url;
    a.download = `codici-senza-foto-${today}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    bsLog(`Scaricati <b>${items.length}</b> codici senza foto (su ${all.length} totali).`);
  }catch(e){
    bsLog('Esportazione codici fallita: '+bsEsc(e.message||e), true);
  }
}

async function bsDeleteWeek(){
  const c = BS.cur;
  if(!c || c.aggregate) return;
  if(!confirm(`Elimino il report di ${c.location} del ${bsPeriodLabel(c.period_start)}?`)) return;
  const r = await api('/bestseller/week?brand='+encodeURIComponent(c.brand)
            +'&location='+encodeURIComponent(c.location)
            +'&period_start='+encodeURIComponent(c.period_start), {method:'DELETE'});
  if(!r.ok){ bsLog('Eliminazione fallita: errore '+r.status, true); return; }
  BS.index = null; BS.data = null; BS.cur = null;
  await renderBestSeller();
  bsLog('Report eliminato.');
}

// ── Collegamento eventi (il markup viene rigenerato a ogni paint) ───────
function bsBind(){
  const on = (id, ev, fn) => { const el = document.getElementById(id); if(el) el.addEventListener(ev, fn); };

  // Selettore negozio: apre/chiude senza ridisegnare tutto il modulo, così
  // resta fluido. Scegliendo una voce parte il caricamento, che ridisegna
  // (e quindi chiude il pannello) da solo.
  document.querySelectorAll('#bs-root .bs-picker').forEach(p => {
    const btn = p.querySelector('.bs-picker-btn');
    if(!btn) return;
    btn.addEventListener('click', e => {
      e.stopPropagation();
      bsClosePickers(p);            // un solo pannello aperto per volta
      const open = p.classList.toggle('bs-open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      if(open){
        const sel = p.querySelector('.bs-picker-opt.bs-sel');
        if(sel) sel.scrollIntoView({block:'nearest'});
      }
    });
  });

  // Settimana: tengo il negozio selezionato se ha caricato anche la settimana
  // nuova, altrimenti ricado sull'aggregato (o sull'unico negozio presente).
  document.querySelectorAll('#bs-root [data-week]').forEach(b =>
    b.addEventListener('click', async () => {
      const ps = b.dataset.week;
      const inWeek = bsWeeks()[ps] || [];
      if(!inWeek.length) return;
      const keep = BS.cur && !BS.cur.aggregate
        && inWeek.find(w => w.brand===BS.cur.brand && w.location===BS.cur.location);
      BS.cur = keep ? {brand:keep.brand, location:keep.location, period_start:ps}
        : (inWeek.length > 1
            ? {aggregate:true, period_start:ps}
            : {brand:inWeek[0].brand, location:inWeek[0].location, period_start:ps});
      bsResetView();
      await bsLoadCurrent();
    }));

  document.querySelectorAll('#bs-root [data-val]').forEach(b =>
    b.addEventListener('click', async () => {
      const v = b.dataset.val.split('|');
      BS.cur = v[0]==='AGG' ? {aggregate:true, period_start:v[1]}
                            : {brand:v[0], location:v[1], period_start:v[2]};
      bsResetView();
      await bsLoadCurrent();
    }));

  const q = document.getElementById('bs-q');
  if(q) q.addEventListener('input', e => {
    BS.query = e.target.value;
    const pos = e.target.selectionStart;
    bsPaint();
    const nq = document.getElementById('bs-q');
    if(nq){ nq.focus(); try{ nq.setSelectionRange(pos,pos); }catch(_){} }
  });
  on('bs-fdiv','change', e => { BS.fDiv = e.target.value; bsPaint(); });
  on('bs-fgen','change', e => { BS.fGen = e.target.value; bsPaint(); });
  on('bs-fcat','change', e => { BS.fCat = e.target.value; bsPaint(); });
  on('bs-fsea','change', e => { BS.fSea = e.target.value; bsPaint(); });
  on('bs-reset','click', () => { bsResetView(); bsPaint(); });

  document.querySelectorAll('#bs-root [data-sort]').forEach(b =>
    b.addEventListener('click', () => { BS.sort = b.dataset.sort; bsPaint(); }));

  document.querySelectorAll('#bs-root [data-open]').forEach(b =>
    b.addEventListener('click', () => {
      BS.detail = (BS.data.products||[]).find(p => p.code === b.dataset.open) || null;
      bsPaint();
    }));

  on('bs-close','click', () => { BS.detail=null; bsPaint(); });
  const bd = document.getElementById('bs-backdrop');
  if(bd) bd.addEventListener('click', e => { if(e.target===bd){ BS.detail=null; bsPaint(); } });

  // Admin
  on('bs-import','click', () => { const f=document.getElementById('bs-file'); if(f) f.click(); });
  on('bs-file','change', e => {
    const files = [...(e.target.files||[])];
    e.target.value = '';
    if(files.length) bsImportFiles(files);
  });
  on('bs-codes','click', bsDownloadCodes);
  on('bs-link','click', bsMakeLink);
  on('bs-unlink','click', bsKillLink);
  on('bs-del','click', bsDeleteWeek);
  on('bs-log-clear','click', () => { BS.log = []; bsPaint(); });
  on('bs-reload','click', () => { BS.index = null; BS.data = null; renderBestSeller(); });
}

// Azzera vista e filtri quando cambia la selezione: i filtri di una settimana
// non hanno senso su un'altra (una divisione può non esserci nemmeno).
function bsResetView(){
  BS.query=''; BS.fDiv=''; BS.fGen=''; BS.fCat=''; BS.fSea=''; BS.detail=null;
}

// Chiude i pannelli aperti, tranne `keep`. Restituisce quanti ne ha chiusi.
function bsClosePickers(keep){
  let n = 0;
  document.querySelectorAll('#bs-root .bs-picker.bs-open').forEach(p => {
    if(p === keep) return;
    p.classList.remove('bs-open');
    const b = p.querySelector('.bs-picker-btn');
    if(b) b.setAttribute('aria-expanded','false');
    n++;
  });
  return n;
}

// Chiude i selettori cliccando fuori. Registrato una volta sola: i pannelli
// vengono ricreati a ogni paint, quindi si cercano al momento del clic.
document.addEventListener('click', e => {
  const inside = e.target && e.target.closest && e.target.closest('#bs-root .bs-picker');
  if(!inside) bsClosePickers(null);
});

// Esc: prima chiude i selettori, altrimenti la scheda prodotto.
document.addEventListener('keydown', e => {
  if(e.key !== 'Escape') return;
  if(bsClosePickers(null)) return;
  if(BS.detail){ BS.detail=null; bsPaint(); }
});
