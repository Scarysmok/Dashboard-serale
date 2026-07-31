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
  query: '', fDiv: '', fGen: '', fCat: '', sort: 'units',
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

// ── Ingresso: chiamato da switchTab('bestseller') ───────────────────────
async function renderBestSeller(){
  const root = document.getElementById('bs-root');
  if(!root) return;
  if(BS.index === null){
    root.innerHTML = bsState('Carico i report…','');
    try{
      const [ri, rm] = await Promise.all([api('/bestseller/index'), api('/bestseller/map')]);
      BS.index = ri.ok ? await ri.json() : [];
      BS.map = rm.ok ? await rm.json() : [];
    }catch(e){
      BS.index = [];
      console.warn('[bestseller] caricamento indice fallito', e);
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
    const r = c.aggregate
      ? await api('/bestseller/aggregate?period_start='+encodeURIComponent(c.period_start))
      : await api('/bestseller/week?brand='+encodeURIComponent(c.brand)
                 +'&location='+encodeURIComponent(c.location)
                 +'&period_start='+encodeURIComponent(c.period_start));
    if(r.ok) BS.data = await r.json();
    else BS.data = {error: 'Errore '+r.status};
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
    (!q || (p.name||'').toLowerCase().includes(q) || (p.code||'').toLowerCase().includes(q)));
  return list.slice().sort((a,b)=> BS.sort==='units' ? b.units-a.units : b.net-a.net);
}

// ── Rendering ───────────────────────────────────────────────────────────
function bsState(title, sub){
  return `<div class="bs-state"><div class="bs-state-t">${bsEsc(title)}</div>`+
         (sub?`<div class="bs-state-s">${bsEsc(sub)}</div>`:'')+`</div>`;
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
    {l:'Valore netto', v:bsEur(totNet), s:'vendite nette periodo', size:'clamp(24px,2.5vw,34px)'},
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

  const hasF = !!(BS.query||BS.fDiv||BS.fGen||BS.fCat);
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

// Selettore combinato negozio+settimana: una voce per report disponibile,
// più la voce aggregata per ciascuna settimana con almeno due negozi.
// È un listbox costruito a mano perché la tendina di un <select> nativo la
// disegna il sistema operativo e non si può portare nello stile del modulo.
function bsHeader(d){
  const weeks = {};
  (BS.index||[]).forEach(w => { (weeks[w.period_start] = weeks[w.period_start] || []).push(w); });
  const keys = Object.keys(weeks).sort().reverse();

  let cur = '—';
  let opts = '';
  keys.forEach(ps => {
    const label = weeks[ps][0].period || bsPeriodLabel(ps);
    opts += `<div class="bs-picker-group">${bsEsc(label)}</div>`;
    if(weeks[ps].length > 1){
      const sel = !!(BS.cur && BS.cur.aggregate && BS.cur.period_start===ps);
      const txt = '★ Tutti i negozi';
      if(sel) cur = txt;
      opts += `<button class="bs-picker-opt bs-agg${sel?' bs-sel':''}" role="option"
        aria-selected="${sel}" data-val="AGG|${bsEsc(ps)}">
        <span class="bs-picker-mark"></span>
        <span class="bs-picker-lab">${txt}</span>
        <span class="bs-picker-n">${weeks[ps].length} negozi</span></button>`;
    }
    weeks[ps].forEach(w => {
      const sel = !!(BS.cur && !BS.cur.aggregate && BS.cur.brand===w.brand
                     && BS.cur.location===w.location && BS.cur.period_start===ps);
      const txt = w.brand+' · '+w.location;
      if(sel) cur = txt;
      opts += `<button class="bs-picker-opt${sel?' bs-sel':''}" role="option"
        aria-selected="${sel}" data-val="${bsEsc([w.brand,w.location,w.period_start].join('|'))}">
        <span class="bs-picker-mark"></span>
        <span class="bs-picker-lab">${bsEsc(txt)}</span></button>`;
    });
  });

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
      <div>
        <div class="bs-sellabel">Negozio</div>
        <div class="bs-picker" id="bs-picker">
          <button class="bs-picker-btn" id="bs-picker-btn" aria-haspopup="listbox"
            aria-expanded="false"${opts?'':' disabled'}>
            <span class="bs-picker-cur">${bsEsc(cur)}</span>
            <span class="bs-picker-chev">▼</span>
          </button>
          <div class="bs-picker-panel" id="bs-picker-panel" role="listbox">${opts}</div>
        </div>
      </div>
      <div class="bs-chips">
        ${d&&d.period?`<span class="bs-chip">${bsEsc(d.period)}</span>`:''}
        ${d&&d.season?`<span class="bs-chip">${bsEsc(d.season)}</span>`:''}
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
    <input type="file" id="bs-photofile" accept=".zip,image/*" multiple style="display:none">
    <button class="bs-chip-btn" id="bs-photos"${BS.busy?' disabled':''}>🖼 Carica foto</button>
    <button class="bs-chip-btn" id="bs-codes"${BS.busy?' disabled':''}>⬇ Codici senza foto</button>
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

function bsLog(msg, err){
  BS.log.unshift(err?`<span class="bs-err">${bsEsc(msg)}</span>`:bsEsc(msg));
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

  const products = [];
  let excluded = 0;
  for(let i=head+1;i<rows.length;i++){
    const r = rows[i]; if(!r) continue;
    const code = r[1];
    if(!code || String(code).trim()==='Product Code') continue;
    if(String(r[2]||'').trim().toUpperCase()==='TOTAL') continue;
    if(BS_EXCLUDE.has(String(code).trim().toUpperCase())){ excluded++; continue; }
    const units = Number(r[14]||0);
    if(!(units > 0)) continue;              // solo venduto reale: no resi, no zeri
    const all = [];
    for(let c=1;c<=28;c++) all.push(cell(r[c]));
    const up = s => String(s||'').trim().toUpperCase();
    const tit = s => { const t=String(s||'').trim(); return t? t.charAt(0)+t.slice(1).toLowerCase() : ''; };
    products.push({
      code: String(code).trim(),
      name: String(r[2]||'').trim(),
      cat:  BS_CAT[up(r[3])] || tit(r[3]),
      gender: BS_GEN[up(r[4])] || tit(r[4]),
      div:  BS_DIV[up(r[9])] || tit(r[9]),
      units: Math.round(units),
      net: Math.round(Number(r[13]||0)),
      all,
    });
  }
  if(!products.length) throw new Error(`${fileName}: nessun prodotto con vendite maggiori di zero.`);
  products.sort((a,b)=>b.units-a.units);
  return {storeRaw, period:periodLabel, period_start, period_end, season, products, excluded};
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
      bsLog(`Leggo ${f.name}…`);
      const parsed = bsParseWorkbook(await f.arrayBuffer(), f.name);
      const store = bsResolveStore(parsed.storeRaw);
      if(!store){ bsLog(`${f.name}: salto (nessun negozio scelto).`); continue; }
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
      ko++; bsLog(`${f.name}: ${e.message||e}`, true);
    }
  }
  // Ricarico indice e corrispondenze, poi riparto dalla settimana appena caricata.
  BS.index = null; BS.data = null; BS.cur = null; BS.busy = false;
  await renderBestSeller();
  bsLog(`Import concluso: ${ok} ok${ko?`, ${ko} con errori`:''}.`);
}

// ── Caricamento foto prodotto ───────────────────────────────────────────
// Si accetta uno ZIP (o una selezione di immagini) con i file rinominati col
// codice articolo: JY5212.png. Il riconoscimento è tollerante: basta che il
// nome contenga un codice noto, così vanno bene anche "JY5212_HM1.png" o
// "foto/JY5212 copia.png".
//
// Ogni immagine viene ridotta e compressa QUI, nel browser, prima di partire:
// il server archivia miniature da poche decine di KB invece dei PNG originali.
// Lo sfondo viene riempito di bianco perché la vista usa mix-blend-mode
// multiply (come fa adidas), che sul bianco si fonde col riquadro chiaro.
const BS_PHOTO_MAX = 400;      // lato lungo della miniatura, in pixel
const BS_PHOTO_Q = 0.85;       // qualità JPEG
const BS_PHOTO_BATCH = 15;     // foto per richiesta, per non fare pacchetti enormi

async function bsPickPhotos(files){
  BS.busy = true; bsPaint();
  try{
    // Serve l'elenco dei codici noti per abbinare i nomi dei file.
    const rc = await api('/bestseller/codes');
    if(!rc.ok) throw new Error(rc.status===404
      ? 'endpoint non disponibile: il backend va aggiornato'
      : 'errore '+rc.status);
    const known = ((await rc.json()).items || []).map(i => i.code);
    if(!known.length) throw new Error('nessun report caricato: importa prima gli Excel');
    const byCode = new Map(known.map(c => [c.toUpperCase(), c]));

    // Raccolgo le immagini: dallo ZIP oppure dai file scelti direttamente.
    const imgs = [];   // {name, blob}
    for(const f of files){
      if(/\.zip$/i.test(f.name)){
        if(typeof JSZip === 'undefined') throw new Error('JSZip non caricato: ricarica la pagina');
        bsLog(`Apro ${f.name}…`);
        const zip = await JSZip.loadAsync(await f.arrayBuffer());
        const entries = [];
        zip.forEach((path, e) => { if(!e.dir && /\.(png|jpe?g|webp)$/i.test(path)) entries.push(e); });
        for(const e of entries) imgs.push({name: e.name, blob: await e.async('blob')});
      }else if(/\.(png|jpe?g|webp)$/i.test(f.name)){
        imgs.push({name: f.name, blob: f});
      }
    }
    if(!imgs.length) throw new Error('nessuna immagine trovata (attesi .png, .jpg o .webp)');
    bsLog(`Trovate ${imgs.length} immagini, le preparo…`);

    // Abbinamento nome file → codice articolo.
    let noMatch = 0, done = 0, saved = 0;
    let batch = [];
    for(const im of imgs){
      const code = bsMatchCode(im.name, byCode);
      if(!code){ noMatch++; continue; }
      let dataUrl;
      try{
        dataUrl = await bsShrink(im.blob);
      }catch(_){ noMatch++; continue; }
      batch.push({code, data_url: dataUrl});
      done++;
      if(batch.length >= BS_PHOTO_BATCH){
        saved += await bsSendPhotos(batch); batch = [];
        bsLog(`Caricate ${saved} foto su ${imgs.length - noMatch}…`);
      }
    }
    if(batch.length) saved += await bsSendPhotos(batch);

    bsLog(`Foto salvate: <b>${saved}</b>`
      + (noMatch ? ` · ${noMatch} file senza codice riconoscibile` : '')
      + `. Articoli ancora senza foto: ${known.length - done < 0 ? 0 : known.length - done}.`);
  }catch(e){
    bsLog('Caricamento foto fallito: '+(e.message||e), true);
  }
  BS.busy = false;
  BS.data = null;
  await bsLoadCurrent();
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

// Ridimensiona e comprime nel browser. Sfondo bianco: la vista usa
// mix-blend-mode multiply, quindi il bianco si fonde col riquadro chiaro.
function bsShrink(blob){
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      try{
        const s = Math.min(1, BS_PHOTO_MAX / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * s));
        const h = Math.max(1, Math.round(img.height * s));
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        const cx = cv.getContext('2d');
        cx.fillStyle = '#fff';
        cx.fillRect(0, 0, w, h);
        cx.drawImage(img, 0, 0, w, h);
        resolve(cv.toDataURL('image/jpeg', BS_PHOTO_Q));
      }catch(e){ reject(e); }
      finally{ URL.revokeObjectURL(url); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('immagine illeggibile')); };
    img.src = url;
  });
}

async function bsSendPhotos(photos){
  const r = await api('/bestseller/photos', {method:'POST', body: JSON.stringify({photos})});
  if(!r.ok) throw new Error('salvataggio foto: errore '+r.status);
  const j = await r.json();
  return j.saved || 0;
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
    const items = all.filter(i => !i.has_photo);
    if(!all.length){ bsLog('Nessun report caricato: niente da esportare.', true); return; }
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
    bsLog('Esportazione codici fallita: '+(e.message||e), true);
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
  on('bs-picker-btn','click', e => {
    e.stopPropagation();
    const p = document.getElementById('bs-picker');
    if(!p) return;
    const open = p.classList.toggle('bs-open');
    e.currentTarget.setAttribute('aria-expanded', open ? 'true' : 'false');
    if(open){
      const sel = p.querySelector('.bs-picker-opt.bs-sel');
      if(sel) sel.scrollIntoView({block:'nearest'});
    }
  });
  document.querySelectorAll('#bs-picker-panel .bs-picker-opt').forEach(b =>
    b.addEventListener('click', async () => {
      const v = b.dataset.val.split('|');
      BS.cur = v[0]==='AGG' ? {aggregate:true, period_start:v[1]}
                            : {brand:v[0], location:v[1], period_start:v[2]};
      BS.query=''; BS.fDiv=''; BS.fGen=''; BS.fCat=''; BS.detail=null;
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
  on('bs-reset','click', () => { BS.query=''; BS.fDiv=''; BS.fGen=''; BS.fCat=''; bsPaint(); });

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
  on('bs-photos','click', () => { const f=document.getElementById('bs-photofile'); if(f) f.click(); });
  on('bs-photofile','change', e => {
    const files = [...(e.target.files||[])];
    e.target.value = '';
    if(files.length) bsPickPhotos(files);
  });
  on('bs-codes','click', bsDownloadCodes);
  on('bs-del','click', bsDeleteWeek);
  on('bs-log-clear','click', () => { BS.log = []; bsPaint(); });
}

// Chiude il selettore negozio cliccando fuori. Registrato una volta sola:
// il pannello viene ricreato a ogni paint, quindi si cerca al momento del clic.
document.addEventListener('click', e => {
  const p = document.getElementById('bs-picker');
  if(p && p.classList.contains('bs-open') && !p.contains(e.target)){
    p.classList.remove('bs-open');
    const b = document.getElementById('bs-picker-btn');
    if(b) b.setAttribute('aria-expanded','false');
  }
});

// Esc: prima chiude il selettore, altrimenti la scheda prodotto.
document.addEventListener('keydown', e => {
  if(e.key !== 'Escape') return;
  const p = document.getElementById('bs-picker');
  if(p && p.classList.contains('bs-open')){
    p.classList.remove('bs-open');
    const b = document.getElementById('bs-picker-btn');
    if(b){ b.setAttribute('aria-expanded','false'); b.focus(); }
    return;
  }
  if(BS.detail){ BS.detail=null; bsPaint(); }
});
