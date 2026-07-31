// 09-bestseller.js — Modulo Best Seller: report sell-out settimanali dei negozi Adidas.
// Estratti dal portale adidas in Excel, importati dall'admin e consultabili dai negozi.
// Script classico come gli altri file js/: scope globale, caricato dopo 08-boot.js.
// Il rendering è lazy (parte da switchTab('bestseller')), quindi non serve che
// le funzioni esistano già al boot.
//
// Divisione dei compiti, dettata da un vincolo esterno:
//   • L'Excel viene letto nel BROWSER con SheetJS (stesso schema dei consuntivi).
//   • Anche le foto prodotto si recuperano dal browser: l'API prodotti di adidas
//     risponde 403 a qualunque chiamata server-side (verificato). Il backend fa
//     solo da cache. Se anche il browser viene bloccato, c'è la via manuale
//     (snippet da eseguire su adidas.it, risultato incollato nel pannello admin).

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
const BS_I_UNITS = 13, BS_I_ST = 25;

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
    // Selezione iniziale: la settimana più recente del primo negozio disponibile.
    if(BS.index.length && !BS.cur){
      const f = BS.index[0];
      BS.cur = {brand:f.brand, location:f.location, period_start:f.period_start};
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
      (admin ? bsAdminPanel() : '') +
      bsState('Nessun report caricato',
              admin ? 'Carica il primo Excel dal pannello qui sopra.'
                    : 'I best seller compariranno qui appena caricati.') +
      bsFooter();
    bsBind();
    return;
  }
  if(BS.data && BS.data.error){
    root.innerHTML = bsStrip() + bsHeader(null) + (admin?bsAdminPanel():'') +
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
          <div style="text-align:right"><div class="bs-pnet">${bsEur(p.net)}</div><div class="bs-plab">Valore</div></div>
        </div>
      </div>
    </button>`).join('');

  const rows = list.map((p,i)=>{
    const st = Number((p.all||[])[BS_I_ST]);
    const stOk = isFinite(st) && (p.all||[])[BS_I_ST]!=null;
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
  ${bsIsAdmin()?bsAdminPanel():''}
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

function bsImg(p){
  return p.img
    ? `<img src="${bsEsc(p.img)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`
    : '';
}

function bsStrip(){
  return `<div class="bs-strip"><span class="bs-dim">Report interno</span>
    <span class="bs-dot"></span><span>Best Seller settimanali di negozio</span></div>`;
}

// Selettore combinato negozio+settimana: una voce per report disponibile,
// più la voce aggregata per ciascuna settimana con almeno due negozi.
function bsHeader(d){
  const weeks = {};
  (BS.index||[]).forEach(w => { (weeks[w.period_start] = weeks[w.period_start] || []).push(w); });
  const keys = Object.keys(weeks).sort().reverse();
  let opts = '';
  keys.forEach(ps => {
    const label = weeks[ps][0].period || bsPeriodLabel(ps);
    opts += `<optgroup label="${bsEsc(label)}">`;
    if(weeks[ps].length > 1){
      const val = 'AGG|'+ps;
      const sel = BS.cur && BS.cur.aggregate && BS.cur.period_start===ps;
      opts += `<option value="${bsEsc(val)}"${sel?' selected':''}>★ Tutti i negozi (${weeks[ps].length})</option>`;
    }
    weeks[ps].forEach(w => {
      const val = [w.brand,w.location,w.period_start].join('|');
      const sel = BS.cur && !BS.cur.aggregate && BS.cur.brand===w.brand
                  && BS.cur.location===w.location && BS.cur.period_start===ps;
      opts += `<option value="${bsEsc(val)}"${sel?' selected':''}>${bsEsc(w.brand+' · '+w.location)}</option>`;
    });
    opts += `</optgroup>`;
  });
  const title = d ? (d.aggregate ? 'Tutti i negozi' : d.location) : '';
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
        <div class="bs-sellabel">Negozio${title?' · '+bsEsc(title):''}</div>
        <select class="bs-storesel" id="bs-store">${opts||'<option>—</option>'}</select>
      </div>
      <div class="bs-chips">
        ${d&&d.period?`<span class="bs-chip">${bsEsc(d.period)}</span>`:''}
        ${d&&d.season?`<span class="bs-chip">${bsEsc(d.season)}</span>`:''}
      </div>
    </div>
  </div></header>`;
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

// ── Pannello admin: import Excel, foto, corrispondenze ──────────────────
function bsAdminPanel(){
  const logHtml = BS.log.length
    ? `<div class="bs-log">${BS.log.map(l=>l).join('<br>')}</div>` : '';
  const cur = BS.cur && !BS.cur.aggregate && BS.data && !BS.data.error;
  return `
  <div class="bs-admin"><div class="bs-admin-box">
    <div class="bs-admin-h">
      <h4>Gestione report</h4>
      <span class="bs-note">solo admin</span>
      <div style="flex:1"></div>
      <input type="file" id="bs-file" accept=".xlsx,.xls" multiple style="display:none">
      <button class="bs-btn" id="bs-import"${BS.busy?' disabled':''}>📥 Importa Excel</button>
      <button class="bs-btn bs-ghost" id="bs-photos"${BS.busy?' disabled':''}>🖼 Recupera foto</button>
      ${cur?`<button class="bs-btn bs-ghost" id="bs-del">🗑 Elimina settimana</button>`:''}
    </div>
    <div class="bs-note">Un file per negozio: negozio, periodo e stagione vengono letti dal file stesso.
      Ricaricare la stessa settimana la sostituisce; le altre restano nello storico.</div>
    ${logHtml}
    <details style="margin-top:14px">
      <summary class="bs-note" style="cursor:pointer">Foto bloccate da adidas? Via manuale</summary>
      <div class="bs-note" style="margin-top:10px">
        1. Apri <b>adidas.it</b> in un'altra scheda · 2. Console (F12) · 3. incolla lo snippet che trovi
        col pulsante qui sotto · 4. incolla qui il risultato.
      </div>
      <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
        <button class="bs-btn bs-ghost" id="bs-snippet">📋 Copia snippet</button>
        <button class="bs-btn bs-ghost" id="bs-paste-save">💾 Salva incollato</button>
      </div>
      <textarea class="bs-ta" id="bs-paste" placeholder='{"JY5212":"https://assets.adidas.com/..."}'></textarea>
    </details>
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
  for(let i=head+1;i<rows.length;i++){
    const r = rows[i]; if(!r) continue;
    const code = r[1];
    if(!code || String(code).trim()==='Product Code') continue;
    if(String(r[2]||'').trim().toUpperCase()==='TOTAL') continue;
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
  return {storeRaw, period:periodLabel, period_start, period_end, season, products};
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
      bsLog(`<b>${bsEsc(store.location)}</b> · ${parsed.products.length} prodotti · ${parsed.period} — salvato`);
    }catch(e){
      ko++; bsLog(`${f.name}: ${e.message||e}`, true);
    }
  }
  // Ricarico indice e corrispondenze, poi riparto dalla settimana appena caricata.
  BS.index = null; BS.data = null; BS.cur = null; BS.busy = false;
  await renderBestSeller();
  bsLog(`Import concluso: ${ok} ok${ko?`, ${ko} con errori`:''}. Ora recupera le foto.`);
}

// ── Foto prodotto ───────────────────────────────────────────────────────
// L'API adidas concede i CORS ma può rispondere 403 alle richieste che non
// arrivano da una sessione reale sul suo sito: se accade, il pannello indica
// la via manuale invece di fallire silenziosamente.
async function bsFetchPhotos(){
  BS.busy = true; bsPaint();
  try{
    const rm = await api('/bestseller/images/missing');
    if(!rm.ok) throw new Error('Errore '+rm.status);
    const codes = (await rm.json()).codes || [];
    if(!codes.length){ bsLog('Nessuna foto mancante.'); BS.busy=false; bsPaint(); return; }
    bsLog(`Cerco ${codes.length} foto su adidas…`);
    const found = {}; let blocked = 0, idx = 0;
    async function worker(){
      while(idx < codes.length){
        const c = codes[idx++];
        try{
          const r = await fetch('https://www.adidas.it/api/products/'+encodeURIComponent(c));
          if(!r.ok){ blocked++; continue; }
          const j = await r.json();
          let u = j.image_url || (j.view_list||[]).map(v=>v.image_url).find(Boolean);
          if(u) found[c] = u.replace(/w_\d+/,'w_300').replace(/h_\d+/,'h_300');
        }catch(_){ blocked++; }
      }
    }
    await Promise.all(Array.from({length:6}, worker));
    const n = Object.keys(found).length;
    if(n) await bsSaveImages(found);
    if(!n && blocked) bsLog(`adidas ha bloccato le richieste (${blocked}). Usa la via manuale qui sotto.`, true);
    else bsLog(`Foto trovate: ${n} su ${codes.length}${blocked?` (${blocked} non disponibili)`:''}.`);
  }catch(e){
    bsLog('Recupero foto fallito: '+(e.message||e), true);
  }
  BS.busy = false; BS.data = null; await bsLoadCurrent();
}

async function bsSaveImages(map){
  const images = Object.entries(map).map(([code,url])=>({code,url}));
  const r = await api('/bestseller/images', {method:'POST', body: JSON.stringify({images})});
  if(!r.ok) throw new Error('Salvataggio foto: errore '+r.status);
  const j = await r.json();
  bsLog(`Foto salvate in cache: ${j.saved}.`);
}

const BS_SNIPPET = `// Incolla nella console di adidas.it, poi copia il risultato e incollalo nella dashboard.
(async () => {
  const codes = CODICI;
  const out = {}; let i = 0;
  async function w(){ while(i < codes.length){ const c = codes[i++];
    try { const r = await fetch('/api/products/'+c); if(!r.ok) continue; const j = await r.json();
      let u = j.image_url || (j.view_list||[]).map(v=>v.image_url).find(Boolean);
      if(u) out[c] = u.replace(/w_\\d+/,'w_300').replace(/h_\\d+/,'h_300');
    } catch(e){} } }
  await Promise.all(Array.from({length:6}, w));
  console.log('Trovate', Object.keys(out).length, 'foto — copia la riga qui sotto:');
  console.log(JSON.stringify(out));
})();`;

async function bsCopySnippet(){
  try{
    const r = await api('/bestseller/images/missing');
    const codes = r.ok ? ((await r.json()).codes || []) : [];
    if(!codes.length){ bsLog('Nessuna foto mancante: snippet non necessario.'); return; }
    const txt = BS_SNIPPET.replace('CODICI', JSON.stringify(codes));
    await navigator.clipboard.writeText(txt);
    bsLog(`Snippet copiato (${codes.length} codici). Incollalo nella console di adidas.it.`);
  }catch(e){
    bsLog('Copia snippet fallita: '+(e.message||e), true);
  }
}

async function bsSavePasted(){
  const ta = document.getElementById('bs-paste');
  const raw = (ta && ta.value || '').trim();
  if(!raw){ bsLog('Incolla prima il risultato dello snippet.', true); return; }
  try{
    const map = JSON.parse(raw);
    const clean = {};
    Object.entries(map).forEach(([k,v])=>{ if(k && typeof v==='string' && v.startsWith('http')) clean[k]=v; });
    if(!Object.keys(clean).length) throw new Error('Nessun link valido trovato.');
    await bsSaveImages(clean);
    if(ta) ta.value = '';
    BS.data = null; await bsLoadCurrent();
  }catch(e){
    bsLog('Testo incollato non valido: '+(e.message||e), true);
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

  on('bs-store','change', async e => {
    const v = e.target.value.split('|');
    BS.cur = v[0]==='AGG' ? {aggregate:true, period_start:v[1]}
                          : {brand:v[0], location:v[1], period_start:v[2]};
    BS.query=''; BS.fDiv=''; BS.fGen=''; BS.fCat=''; BS.detail=null;
    await bsLoadCurrent();
  });

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
  on('bs-photos','click', bsFetchPhotos);
  on('bs-snippet','click', bsCopySnippet);
  on('bs-paste-save','click', bsSavePasted);
  on('bs-del','click', bsDeleteWeek);
}

// Esc chiude la scheda prodotto (registrato una volta sola).
document.addEventListener('keydown', e => {
  if(e.key==='Escape' && BS.detail){ BS.detail=null; bsPaint(); }
});
