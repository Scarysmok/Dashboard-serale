// 05-chiusure.js — Tab Chiusure: card, vista aperture, navigazione giorni, target badge, sheet dettaglio, visualizzatore allegati
// Estratto da index.html (split del 2026-07-07). Script classici:
// tutti i file js/ condividono lo scope globale; ordine di caricamento 01→08.
// ── VISTA APERTURE (dentro la tab Chiusure, toggle segmented) ──────────
let vistaNegozi='chiusure';   // 'chiusure' | 'aperture'
let aperturaDate=null;        // giorno mostrato nella vista Aperture (ISO)

function setVistaNegozi(v){
  vistaNegozi=v;
  const ap=v==='aperture';
  const bC=document.getElementById('segn-chiusure');
  const bA=document.getElementById('segn-aperture');
  if(bC) bC.classList.toggle('on',!ap);
  if(bA) bA.classList.toggle('on',ap);
  for(const id of ['kpi-scroll','chiusure-filterbar','chiusure-searchrow','cards-list']){
    const el=document.getElementById(id);
    if(el) el.style.display=ap?'none':'';
  }
  const av=document.getElementById('aperture-view');
  if(av) av.style.display=ap?'':'none';
  if(ap) renderAperture();
}

function _aperturaDays(){
  return [...new Set(allAperture.map(a=>a.dateISO).filter(Boolean))].sort();
}
function shiftAperturaDate(delta){
  const days=_aperturaDays();
  if(!days.length) return;
  let i=days.indexOf(aperturaDate);
  if(i<0) i=days.length-1;
  i=Math.max(0,Math.min(days.length-1,i+delta));
  aperturaDate=days[i];
  renderAperture();
}
// Escape HTML per testo libero (le note dei negozi finiscono in innerHTML).
function _escHtml(s){
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
// Ultima chiusura del negozio PRIMA del giorno dato (lookback 14gg): è il
// termine di confronto del fondo cassa. Non per forza ieri: regge i giorni
// di chiusura settimanale.
function _prevClosureFor(k, dayISO){
  const minISO=shiftDaysISO(dayISO,-14);
  let prev=null;
  for(const r of allData){
    if(!r.dateISO || r.dateISO>=dayISO || r.dateISO<minISO) continue;
    if(storeKey(r.brand,r.location)!==k) continue;
    if(!prev || r.dateISO>prev.dateISO) prev=r;
  }
  return prev;
}
// Ora di invio dall'ISO nel nome file GoAudits ("...2026-07-06T13:12:04+00:00.pdf")
function _aperturaTimeHHMM(a){
  const m=String(a.fname||'').match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:[+-]\d{2}:\d{2}|Z)?)/);
  if(!m) return '';
  const d=new Date(m[1]);
  if(isNaN(d)) return '';
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}
// Badge di stato fondo cassa per un record apertura. Ritorna {html, anomaly}.
function _fondoBadge(a){
  if(a.fondoCassa==null)
    return {html:'<span class="ap-badge muted">💶 fondo non indicato</span>', anomaly:false};
  const prev=_prevClosureFor(storeKey(a.brand,a.location), a.dateISO);
  if(!prev || !isFinite(+prev.fondo) || +prev.fondo===0)
    return {html:'<span class="ap-badge muted">💶 nessuna chiusura di confronto</span>', anomaly:false};
  const diff=a.fondoCassa-(+prev.fondo);
  const pd=`${prev.dateISO.slice(8,10)}/${prev.dateISO.slice(5,7)}`;
  if(Math.abs(diff)>0.005)
    return {html:`<span class="ap-badge ko">💶 ANOMALIA FONDO CASSA · chiusura ${pd} ${fmt(+prev.fondo)} · Δ ${fmt(diff)}</span>`, anomaly:true};
  return {html:`<span class="ap-badge ok">💶 fondo allineato alla chiusura ${pd}</span>`, anomaly:false};
}

function renderAperture(){
  const list=document.getElementById('aperture-list');
  const chip=document.getElementById('apertura-date-chip');
  if(!list) return;
  const days=_aperturaDays();
  if(!days.length){
    if(chip) chip.textContent='📅 —';
    list.innerHTML='<div style="padding:40px 24px;text-align:center;color:var(--t3)"><div style="font-size:32px;margin-bottom:10px">☀️</div><div style="font-size:13px">Nessuna checklist di apertura ancora ricevuta.</div></div>';
    return;
  }
  if(!aperturaDate || !days.includes(aperturaDate)) aperturaDate=days[days.length-1];
  if(chip) chip.textContent='📅 '+aperturaDate.split('-').reverse().join('/');

  const recs=allAperture.filter(a=>a.dateISO===aperturaDate);
  // Stesso negozio con più PDF nello stesso giorno (es. checklist corretta e
  // ricaricata): vince la più recente, non l'ultima in ordine di lista.
  const got=new Map();
  for(const a of recs){
    const k=storeKey(a.brand,a.location);
    const prev=got.get(k);
    if(!prev || String(a.modifiedTime||'')>String(prev.modifiedTime||'')) got.set(k,a);
  }
  // Unione: negozi attesi quel giorno + eventuali aperture da negozi non attesi
  // (es. punti vendita non monitorati che comunque inviano la checklist).
  const items=[];
  const seen=new Set();
  for(const s of ALL_STORES){
    if(!isStoreMonitoredOn(s.brand,s.location,aperturaDate)) continue;
    const k=storeKey(s.brand,s.location);
    seen.add(k);
    items.push({brand:s.brand,location:s.location,rec:got.get(k)||null});
  }
  for(const a of recs){
    const k=storeKey(a.brand,a.location);
    if(!seen.has(k)) items.push({brand:a.brand,location:a.location,rec:a});
  }
  items.sort((x,y)=>(x.brand+x.location).localeCompare(y.brand+y.location));

  const received=items.filter(i=>i.rec).length;
  let html=`<div style="margin:2px 16px 10px;font-size:12.5px;color:var(--t2);font-weight:600">${received} su ${items.length} aperture ricevute</div>`;
  for(const it of items){
    const bc=brandColor(it.brand);
    if(!it.rec){
      html+=`<div class="ap-card ap-missing">
        <div class="ap-head">
          <div><span class="ap-brand" style="color:${bc.text}">${it.brand}</span><span class="ap-store">${it.location}</span></div>
          <span class="ap-time">📭 mancante</span>
        </div>
      </div>`;
      continue;
    }
    const a=it.rec;
    const i=allAperture.indexOf(a);
    const fondo=_fondoBadge(a);
    const time=_aperturaTimeHHMM(a);
    const badges=[fondo.html];
    // Le note scritte dai negozi (es. "Condizionatore non funzionante")
    // compaiono direttamente nel badge, troncate per non rompere il layout.
    const noteTxt=n=>n?` · ${_escHtml(n.length>60?n.slice(0,57)+'…':n)}`:'';
    if(a.puliziaOk===false)      badges.push(`<span class="ap-badge warn">🧹 non pulito${noteTxt(a.puliziaNote)}</span>`);
    else if(a.puliziaOk===true)  badges.push('<span class="ap-badge ok">🧹 pulito</span>');
    if(a.insegnaOk===false)      badges.push(`<span class="ap-badge warn">💡 guasto${noteTxt(a.insegnaNote)}</span>`);
    else if(a.insegnaOk===true)  badges.push('<span class="ap-badge ok">💡 tutto funziona</span>');
    html+=`<div class="ap-card" onclick="openAperturaSheet(${i})">
      <div class="ap-head">
        <div><span class="ap-brand" style="color:${bc.text}">${it.brand}</span><span class="ap-store">${it.location}</span></div>
        <div style="text-align:right"><div class="ap-fondo">${a.fondoCassa!=null?fmt(a.fondoCassa):'—'}</div>${time?`<div class="ap-time">inviata ${time}</div>`:''}</div>
      </div>
      <div class="ap-badges">${badges.join('')}</div>
    </div>`;
  }
  list.innerHTML=html;
}

// Scheda dettaglio apertura nel bottom sheet (stesso contenitore delle chiusure)
function openAperturaSheet(i){
  const a=allAperture[i];
  if(!a) return;
  document.getElementById('sheet-title').textContent=a.location;
  document.getElementById('sheet-sub').textContent=`${a.brand} · Apertura · ${a.dateISO?a.dateISO.split('-').reverse().join('/'):'—'}`;
  const siNoTxt=v=>v==null?'—':(v?'✓ SI':'✗ NO');
  const siNoCls=v=>v===false?'r':(v===true?'g':'');
  const prev=a.fondoCassa!=null?_prevClosureFor(storeKey(a.brand,a.location),a.dateISO):null;
  const parts=[
    dividerRow('Apertura'),
    staticRow('Data', a.dateISO?a.dateISO.split('-').reverse().join('/'):'—',''),
    staticRow('Fondo cassa dichiarato', a.fondoCassa!=null?fmt(a.fondoCassa):'—','b'),
  ];
  if(prev && isFinite(+prev.fondo) && +prev.fondo!==0){
    const diff=a.fondoCassa-(+prev.fondo);
    const pd=prev.dateISO.split('-').reverse().join('/');
    parts.push(staticRow(`Fondo alla chiusura del ${pd}`, fmt(+prev.fondo),''));
    parts.push(`<div class="row-cash-result ${Math.abs(diff)>0.005?'ko':'ok'}"><span>Verifica fondo cassa</span><span class="delta">${Math.abs(diff)>0.005?`⚠ Δ ${fmt(diff)}`:'✓ Allineato'}</span></div>`);
  }else{
    parts.push(staticRow('Confronto con chiusura precedente','nessuna chiusura nei 14 giorni precedenti',''));
  }
  parts.push(dividerRow('Controlli'));
  parts.push(staticRow('Check pulizia', siNoTxt(a.puliziaOk), siNoCls(a.puliziaOk)));
  if(a.puliziaNote) parts.push(staticRow('Nota pulizia', _escHtml(a.puliziaNote), 'r'));
  parts.push(staticRow('Insegna, luci e apparecchiature', siNoTxt(a.insegnaOk), siNoCls(a.insegnaOk)));
  if(a.insegnaNote) parts.push(staticRow('Nota guasto', _escHtml(a.insegnaNote), 'r'));
  if(a.inventarioOk!=null) parts.push(staticRow('Inventario a campione', siNoTxt(a.inventarioOk), siNoCls(a.inventarioOk)));
  const attachBtn=a.fileId
    ? `<div style="padding:16px"><button class="settings-btn" onclick="openAttachments(${i},'ap')">📎 Vedi foto allegate</button></div>`
    : '';
  document.getElementById('sheet-rows').innerHTML=parts.join('')+attachBtn;
  document.getElementById('sheet').classList.add('show');
}

// ── NAVIGAZIONE GIORNI (frecce ‹ › nella tab Chiusure) ──
// Lista ordinata delle date disponibili nelle chiusure caricate.
function availableDates(){
  const s=new Set();
  for(const r of allData) if(r.dateISO) s.add(r.dateISO);
  return [...s].sort();
}
// dir = -1 (giorno precedente) | +1 (successivo). Se non c'è un filtro data
// attivo, parte dall'ultima giornata disponibile.
function shiftFilterDate(dir){
  const dates=availableDates();
  if(!dates.length) return;
  if(!filterDate){
    setDateFilter(dates[dates.length-1]);
    return;
  }
  // Indice della data attuale (o della più vicina precedente se non esatta)
  let i=dates.indexOf(filterDate);
  if(i<0){
    i=dates.findIndex(d=>d>filterDate);
    i=(i<0?dates.length:i)-(dir>0?1:0);
  }
  const next=i+dir;
  if(next<0 || next>=dates.length) return;
  setDateFilter(dates[next]);
}
// Abilita/disabilita le frecce in base alla posizione nel range date.
function updateDateNav(){
  const prev=document.getElementById('date-prev');
  const next=document.getElementById('date-next');
  if(!prev||!next) return;
  const dates=availableDates();
  if(!dates.length){prev.disabled=true;next.disabled=true;return;}
  if(!filterDate){
    // "Tutte le date": ‹ porta all'ultima giornata, › non ha senso
    prev.disabled=false;
    next.disabled=true;
    return;
  }
  prev.disabled = filterDate<=dates[0];
  next.disabled = filterDate>=dates[dates.length-1];
}
// Cambia il criterio di ordinamento delle card e ridisegna.
function setSortMode(v){
  sortMode=v||'default';
  renderCards();
}
// Espandi/collassa un gruppo brand nella tab Chiusure.
function toggleBrandGroup(brand){
  if(collapsedBrands.has(brand)) collapsedBrands.delete(brand);
  else collapsedBrands.add(brand);
  renderCards();
}
const setPip=(s,t)=>{
  const p=document.getElementById('pip');
  p.className='pip'+(s?' '+s:'');
  document.getElementById('sync-txt').textContent=t;
};
function setChip(el,f){
  // Guard: il chip Mancanti richiede una data filtrata
  if(f==='mancanti' && !filterDate) return;
  filter=f;
  // Reset solo dei chip-filtro, non del chip-date (che ha vita propria)
  document.querySelectorAll('.chip').forEach(c=>{
    if(c.id!=='chip-date')c.classList.remove('on');
  });
  el.classList.add('on');renderCards();
}
function switchTab(t){
  ['oggi','negozi','stores','tempo','kpi','settings','account','template'].forEach(n=>{
    const el=document.getElementById('tab-'+n);
    if(el)el.style.display=n===t?'block':'none';
  });
  // Mappa tab → voce della bottom nav da evidenziare. Andamento (tempo) e KPI
  // vivono entrambe sotto "Analisi"; gestione utenti (account) e template
  // segnalazioni (template) sotto "Altro".
  const navMap={oggi:'oggi',negozi:'negozi',stores:'stores',tempo:'analisi',kpi:'analisi',settings:'settings',account:'settings',template:'settings'};
  const activeNav=navMap[t]||t;
  ['oggi','negozi','analisi','stores','settings'].forEach(n=>{
    const nav=document.getElementById('nav-'+n);
    if(nav)nav.classList.toggle('active',n===activeNav);
  });
  const titles={oggi:'Dashboard',negozi:'Aperture / Chiusure',stores:'Negozi',tempo:'Analisi · Vendite',kpi:'Analisi · KPI negozio',settings:'Altro',account:'Gestione utenti',template:'Template segnalazioni'};
  const titleEl=document.getElementById('app-title');
  if(titleEl)titleEl.textContent=titles[t]||'Chiusure';
  if(t==='oggi')renderOggi();
  if(t==='tempo')renderTempo();
  if(t==='stores')renderStores();
  if(t==='account')renderAccount();
  if(t==='kpi')renderKpiAll();
  if(t==='template')renderTemplateEditor();
}
function closeSheet(e){
  if(!e||e.target===document.getElementById('sheet'))
    document.getElementById('sheet').classList.remove('show');
}
// ── TARGET BADGE ──
// Restituisce il markup del badge "delta vs target" per una chiusura singola
// (usato nelle card della tab CHIUSURE). Il target è espresso al NETTO IVA,
// quindi va confrontato con netSales (corrispettivo / 1.22).
// Formato: DELTA percentuale firmato (+/- vs target), uguale a quello della
// tab Andamento per coerenza visiva su tutta la dashboard.
//   delta = (netSales - target) / target * 100
// Soglie colore (equivalenti a 95%/70% in formato ratio):
//   ≥ -5%        → verde   (target raggiunto a meno del 5%)
//   -30% a -5%   → giallo  (calo 5-30% sotto target)
//   < -30%       → rosso   (calo significativo sotto target)
// Casi speciali:
//   target=0 (festività, negozio chiuso) → badge "TGT=0" grigio
//   target non trovato (record incompleto) → stesso "TGT=0" grigio
function targetBadgeHTML(r){
  const key = storeKey(r.brand, r.location) + '|' + (r.dateISO||'');
  const tgt = +targetsByKey[key] || 0;
  if(!tgt){
    return `<div class="card-target zero">TGT=0</div>`;
  }
  const net = (+r.netSales) || ((+r.corrispettivo||0) / 1.22);
  const delta = (net - tgt) / tgt * 100;
  let cls='red';
  if(delta >= -5)  cls='green';
  else if(delta >= -30) cls='yellow';
  const sign = delta >= 0 ? '+' : '';
  const pctStr = sign + delta.toLocaleString('it-IT',{minimumFractionDigits:2,maximumFractionDigits:2}) + '%';
  return `<div class="card-target ${cls}" title="Target NET ${fmt(tgt)} · Net sales ${fmt(net)}">${pctStr} vs TGT</div>`;
}
// Versione aggregata: calcola la % di realizzazione target su un GRUPPO di
// chiusure (un giorno con più negozi, un mese intero, un anno intero, ecc.).
// "Dinamica" perché la somma dei target include SOLO i giorni-negozio per cui
// abbiamo una chiusura ricevuta. Quindi nel mese in corso o nell'anno in corso
// la % evolve giorno dopo giorno: man mano che arrivano nuove chiusure, sia il
// numeratore (net sales) sia il denominatore (sum target) crescono.
// Restituisce {pct, totNet, totTgt} oppure null se nessun target è disponibile
// per i record passati (es. mesi/anni interamente festivi o senza target caricati).
function periodTargetData(records){
  let totNet=0, totTgt=0;
  for(const r of records){
    const key = storeKey(r.brand, r.location) + '|' + (r.dateISO||'');
    const tgt = +targetsByKey[key] || 0;
    if(tgt > 0){
      totTgt += tgt;
      totNet += (+r.netSales) || ((+r.corrispettivo||0) / 1.22);
    }
  }
  if(totTgt <= 0) return null;
  return {pct: totNet/totTgt*100, totNet, totTgt};
}
function periodTargetBadgeHTML(records){
  const d = periodTargetData(records);
  if(!d) return `<div class="card-target zero">TGT=0</div>`;
  // Tab Andamento: formato DELTA (+/- vs target). Rispetto alla tab Chiusure
  // (ratio "85,95%") qui mostriamo "+8,50%" o "-14,05%". Stessa convenzione
  // del badge PY accanto, così i due confronti si leggono uguali.
  const delta = d.pct - 100; // d.pct è il ratio: delta = ratio - 100
  let cls='red';
  if(delta >= -5)  cls='green';
  else if(delta >= -30) cls='yellow';
  const sign = delta >= 0 ? '+' : '';
  const pctStr = sign + delta.toLocaleString('it-IT',{minimumFractionDigits:2,maximumFractionDigits:2}) + '%';
  return `<div class="card-target ${cls}" title="Target NET ${fmt(d.totTgt)} · Net sales ${fmt(d.totNet)} · ${records.length} chiusur${records.length===1?'a':'e'}">${pctStr} vs TGT</div>`;
}
// ── CARDS (TAB CHIUSURE) ──
// Card v2: corrispettivo come valore primario grande, barra di avanzamento
// sul target, badge vs anno scorso, gruppi brand collassabili e ordinamento.
// Costruisce l'HTML di una singola card chiusura.
// flat=true → modalità ordinata senza raggruppamento brand: il nome include
// anche il brand (piccolo, sopra la location).
function _closureCardHTML(r, flat){
  const bc=brandColor(r.brand);
  const net=(+r.netSales)||((+r.corrispettivo||0)/1.22);
  // Barra avanzamento target (target NET vs net sales del giorno)
  const tKey=storeKey(r.brand,r.location)+'|'+(r.dateISO||'');
  const tgt=+targetsByKey[tKey]||0;
  let tgtBar='';
  if(tgt>0){
    const ratio=net/tgt*100;
    const delta=ratio-100;
    const cls=delta>=-5?'green':(delta>=-30?'yellow':'red');
    const w=Math.max(2,Math.min(100,ratio));
    tgtBar=`<div class="tgt-bar-wrap"><div class="tgt-bar ${cls}" style="width:${w}%"></div></div>
      <div class="tgt-bar-lbl"><span>Target ${fmt(tgt)}</span><span>${ratio.toLocaleString('it-IT',{maximumFractionDigits:0})}% raggiunto</span></div>`;
  }else{
    tgtBar=`<div class="tgt-bar-lbl" style="margin-top:8px"><span>Nessun target per questa giornata</span></div>`;
  }
  // vs anno scorso: stesso negozio, STESSO GIORNO DELLA SETTIMANA dell'anno
  // precedente (shift 364gg, vedi pyDateISO). Sorgente: storico Excel.
  const pyIso=pyDateISO(r.dateISO);
  const py=+historicalByKey[storeKey(r.brand,r.location)+'|'+pyIso]||0;
  let pyCell='<div class="card-cell-v" style="color:var(--t3)">—</div>';
  if(py>0){
    const d=(net-py)/py*100;
    const c=d>=-5?'g':(d>=-30?'':'r');
    const sign=d>=0?'+':'';
    const pyDisp=pyIso?pyIso.split('-').reverse().join('/'):'';
    pyCell=`<div class="card-cell-v ${c}" title="Stesso giorno della settimana 1 anno fa (${pyDisp}): ${fmt(py)} NET">${sign}${d.toLocaleString('it-IT',{maximumFractionDigits:1})}%</div>`;
  }
  const nameHtml=flat
    ? `<div class="card-name"><span style="display:block;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:${bc.text}">${r.brand}</span>${r.location}</div>`
    : `<div class="card-name">${r.location}</div>`;
  return `<div class="store-card${r.anomaly?' anomaly':''}" style="border-left:3px solid ${bc.strong}" onclick="openSheet(${allData.indexOf(r)})">
    <div class="card-head" style="grid-template-columns:1fr auto">
      ${nameHtml}
      <div class="card-date">${r.dateDisplay}</div>
    </div>
    <div class="card-main">
      <div class="card-main-l">Corrispettivo</div>
      <div class="card-main-v">${fmt(r.corrispettivo)}</div>
      ${tgtBar}
    </div>
    <div class="card-sec">
      <div class="card-cell"><div class="card-cell-l">Net Sales</div><div class="card-cell-v b">${fmt(net)}</div></div>
      <div class="card-cell"><div class="card-cell-l">Contanti</div><div class="card-cell-v">${fmt(r.contanti)}</div></div>
      <div class="card-cell"><div class="card-cell-l">vs anno prec.</div>${pyCell}</div>
    </div>
    <div class="card-footer">
      ${r.sconti?'<span class="tag tag-warn">Sconti</span>':''}
      ${r.annull?'<span class="tag tag-warn">Annullamenti</span>':''}
      ${r.anomaly?`<span class="verify-bad">⚠ Cassa Δ ${fmt(r.diff)}</span>`:'<span class="verify-ok">✓ cassa ok</span>'}
    </div>
  </div>`;
}
// Ratio % vs target di un record (per l'ordinamento "% Target"). -1 = senza target.
function _tgtRatio(r){
  const tgt=+targetsByKey[storeKey(r.brand,r.location)+'|'+(r.dateISO||'')]||0;
  if(tgt<=0) return -1;
  const net=(+r.netSales)||((+r.corrispettivo||0)/1.22);
  return net/tgt*100;
}
function renderCards(){
  const q=document.getElementById('search').value.toLowerCase();
  // Applica prima il filtro data (se attivo), poi i filtri chip, poi la ricerca
  let rows=[...getFilteredData()];
  if(filter==='anomalie')rows=rows.filter(r=>r.anomaly||r.annull);
  if(filter==='sconti')  rows=rows.filter(r=>r.sconti);
  if(filter==='annull')  rows=rows.filter(r=>r.annull);
  if(filter==='mancanti')rows=[]; // mostro solo le card grigie sotto
  if(q)rows=rows.filter(r=>r.store.toLowerCase().includes(q)||r.location.toLowerCase().includes(q)||r.brand.toLowerCase().includes(q));

  // Card "mancanti": solo se è selezionata una data e il filtro lo consente.
  // Con 'all' compaiono in linea con gli altri; con 'mancanti' sono le uniche.
  let missingRows=[];
  if(filterDate && (filter==='all'||filter==='mancanti')){
    missingRows=getMissingStores(filterDate);
    if(q)missingRows=missingRows.filter(s=>s.brand.toLowerCase().includes(q)||s.location.toLowerCase().includes(q));
  }

  const cl=document.getElementById('cards-list');
  if(!rows.length && !missingRows.length){
    const msg=filter==='mancanti' && !filterDate
      ? 'Seleziona una data per vedere i negozi mancanti'
      : 'Nessun dato';
    cl.innerHTML=`<div class="empty-state"><div class="empty-icon">📭</div><div class="empty-text">${msg}</div></div>`;
    return;
  }

  const totCorr=rows.reduce((a,r)=>a+r.corrispettivo,0);
  const totNet=totCorr/1.22;
  const totCash=rows.reduce((a,r)=>a+r.contanti,0);
  const totPOS=rows.reduce((a,r)=>a+r.pos,0);
  // Etichetta data per le card mancanti (formato dd/mm/yyyy)
  let missDateDisp='';
  if(filterDate){const [yy,mm,dd]=filterDate.split('-');missDateDisp=`${dd}/${mm}/${yy}`;}
  let html='';

  if(sortMode!=='default'){
    // ── MODALITÀ ORDINATA: lista piatta senza raggruppamento brand ──
    const sorted=[...rows];
    if(sortMode==='corr')      sorted.sort((a,b)=>b.corrispettivo-a.corrispettivo);
    else if(sortMode==='tgt')  sorted.sort((a,b)=>_tgtRatio(b)-_tgtRatio(a));
    else if(sortMode==='anom') sorted.sort((a,b)=>(b.anomaly?1:0)-(a.anomaly?1:0)||b.corrispettivo-a.corrispettivo);
    else if(sortMode==='name') sorted.sort((a,b)=>(a.location+a.brand).localeCompare(b.location+b.brand,'it'));
    for(const r of sorted) html+=_closureCardHTML(r,true);
    for(const s of missingRows){
      const bc=brandColor(s.brand);
      html+=`<div class="store-card missing" style="border-left:3px dashed ${bc.strong}">
        <div class="card-head" style="grid-template-columns:1fr auto">
          <div class="card-name">${s.brand} · ${s.location}</div>
          <div class="card-date">${missDateDisp}</div>
        </div>
        <div class="missing-body">
          <span class="missing-dot" style="background:${bc.strong}"></span>
          <span class="missing-label">Nessuna chiusura ricevuta</span>
        </div>
      </div>`;
    }
  }else{
    // ── MODALITÀ DEFAULT: gruppi per brand, collassabili dal titolo ──
    const brands={};
    for(const r of rows){
      if(!brands[r.brand])brands[r.brand]={real:[],miss:[]};
      brands[r.brand].real.push(r);
    }
    for(const s of missingRows){
      if(!brands[s.brand])brands[s.brand]={real:[],miss:[]};
      brands[s.brand].miss.push(s);
    }

    for(const [brand,group] of Object.entries(brands)){
      const stores=group.real;
      const miss=group.miss;
      const bCorr=stores.reduce((a,r)=>a+r.corrispettivo,0);
      const bNet=bCorr/1.22;
      const bCash=stores.reduce((a,r)=>a+r.contanti,0);
      const bPOS=stores.reduce((a,r)=>a+r.pos,0);
      const bc=brandColor(brand);
      const totCount=stores.length+miss.length;
      const collapsed=collapsedBrands.has(brand);
      const missLabel=miss.length?` · <span style="color:var(--warn)">${miss.length} mancante${miss.length>1?'i':''}</span>`:'';
      const tBrand=brand.replace(/'/g,"\\'");
      html+=`<div class="brand-header clickable${collapsed?' collapsed':''}" style="background:${bc.tint};border-radius:8px;padding:8px 12px" onclick="toggleBrandGroup('${tBrand}')">
        <span class="brand-label" style="color:${bc.text}"><span class="brand-chev">▼</span>${brand}</span>
        <span class="brand-count" style="color:${bc.text};opacity:.7">${totCount} negoz${totCount===1?'io':'i'}${missLabel}${collapsed?` · ${fmt(bCorr)}`:''}</span>
      </div>`;
      if(!collapsed){
        for(const r of stores) html+=_closureCardHTML(r,false);
        // Card grigie tratteggiate per i negozi che non hanno inviato la chiusura
        for(const s of miss){
          html+=`<div class="store-card missing" style="border-left:3px dashed ${bc.strong}">
            <div class="card-head" style="grid-template-columns:1fr auto">
              <div class="card-name">${s.location}</div>
              <div class="card-date">${missDateDisp}</div>
            </div>
            <div class="missing-body">
              <span class="missing-dot" style="background:${bc.strong}"></span>
              <span class="missing-label">Nessuna chiusura ricevuta</span>
            </div>
          </div>`;
        }
      }
      // Subtotale: sempre visibile (anche a gruppo collassato) se ci sono dati
      if(stores.length){
        html+=`<div class="subtotal-card" style="border-color:${bc.strong}40;background:${bc.tint}80">
          <div>
            <div class="sub-cell-l" style="color:${bc.text}">Sub-totale ${brand}</div>
            <div class="sub-cell-v" style="color:var(--green)">${fmt(bCorr)}</div>
            <div class="sub-cell-net">NET ${fmt(bNet)}</div>
          </div>
          <div>
            <div class="sub-cell-l" style="color:${bc.text}">Contanti + POS</div>
            <div class="sub-cell-v">${fmt(bCash)}</div>
            <div class="sub-cell-net">POS ${fmt(bPOS)}</div>
          </div>
        </div>`;
      }
    }
  }

  if(rows.length>1){
    const totMiss=missingRows.length;
    const grandLabel=totMiss
      ? `Totale · ${rows.length} negozi inviati · ${totMiss} mancante${totMiss>1?'i':''}`
      : `Totale · ${rows.length} negozi`;
    html+=`<div class="grand-total">
      <div class="grand-label">${grandLabel}</div>
      <div class="grand-row"><span class="grand-row-l">Corrispettivo totale</span><span class="grand-row-v g">${fmt(totCorr)}</span></div>
      <div class="grand-row"><span class="grand-row-l">Net Sales totali</span><span class="grand-row-v b">${fmt(totNet)}</span></div>
      <div class="grand-row"><span class="grand-row-l">Totale contanti</span><span class="grand-row-v">${fmt(totCash)}</span></div>
      <div class="grand-row"><span class="grand-row-l">Totale POS</span><span class="grand-row-v">${fmt(totPOS)}</span></div>
    </div>`;
  }
  cl.innerHTML=html;
}

// ── SHEET DETTAGLIO ──
// Helper per costruire una riga nello sheet. Tre tipi:
//  - divider:    intestazione di sezione
//  - read-only:  label + valore formattato (no input)
//  - editable:   label + input numerico modificabile, salva su backend con
//                badge "modificato" quando l'utente ha sovrascritto il valore
//                originale parsato dal PDF.
function staticRow(label, valueStr, cls){
  cls=cls||'';
  return `<div class="sheet-row"><span class="row-l">${label}</span><span class="row-v ${cls}">${valueStr}</span></div>`;
}
function dividerRow(label){
  return `<div class="sheet-row divider"><span>${label}</span></div>`;
}
function editRow(label, field, r){
  // Campo editabile: input + (eventuale) badge "modificato" + reset.
  const v=+r[field]||0;
  const isMod=!!(r._overridden && r._overridden[field]);
  let badge='', reset='';
  if(isMod){
    const meta=r._overridden[field]||{};
    const orig=(r._original && r._original[field]!=null) ? +r._original[field] : 0;
    const tip=`Originale: ${fmt(orig)}`+
              (meta.by?` · modificato da ${meta.by}`:'')+
              (meta.at?` il ${fmtDateTime(meta.at)}`:'');
    badge=` <span class="ovr-badge" title="${attrEsc(tip)}">modificato</span>`;
    reset=` <button class="ovr-reset" data-reset-field="${field}" title="Ripristina valore originale (${fmt(orig)})">ripristina</button>`;
  }
  return `<div class="sheet-row">
    <span class="row-l">${label}</span>
    <span class="row-v-edit">
      <input class="row-input${isMod?' modified':''}" type="text" inputmode="decimal"
             data-field="${field}" value="${fmtNumIt(v)}" />
      ${badge}${reset}
    </span>
  </div>`;
}

// Riga read-only di un campo "potenzialmente modificabile". Mostra il badge
// "modificato" (se applicabile) per trasparenza, ma senza input né reset.
// Usata per gli utenti con role=user (sola lettura).
function viewRow(label, field, r){
  const v=+r[field]||0;
  const isMod=!!(r._overridden && r._overridden[field]);
  let badge='';
  if(isMod){
    const meta=r._overridden[field]||{};
    const orig=(r._original && r._original[field]!=null) ? +r._original[field] : 0;
    const tip=`Originale: ${fmt(orig)}`+
              (meta.by?` · modificato da ${meta.by}`:'')+
              (meta.at?` il ${fmtDateTime(meta.at)}`:'');
    badge=` <span class="ovr-badge" title="${attrEsc(tip)}">modificato</span>`;
  }
  return `<div class="sheet-row">
    <span class="row-l">${label}</span>
    <span class="row-v-edit"><span class="row-v${isMod?' modified-ro':''}">${fmt(v)}</span>${badge}</span>
  </div>`;
}

// Riga "valore" che sceglie automaticamente edit vs view in base ai permessi
function valueRow(label, field, r){
  return canEdit() ? editRow(label, field, r) : viewRow(label, field, r);
}

function openSheet(idx){
  const r=allData[idx];
  document.getElementById('sheet-title').textContent=r.location;
  document.getElementById('sheet-sub').textContent=r.brand+' · '+r.dateDisplay;

  // Ordine richiesto: Data → Corrispettivo → Net Sales → CASSA (Contanti, POS,
  // Giftcard, Cambi, Annullamenti, Buono emesso, Buono ritirato, Sconti su
  // vendite, Importo da versare, Importo versato) → Verifica cassa.
  // Editabili (con override): Corrispettivo, Contanti, POS, Giftcard, Cambi,
  // Annullamenti, Buono emesso, Buono ritirato.
  const parts=[
    dividerRow('Dati giornata'),
    staticRow('Data incasso', r.dateDisplay, ''),
    valueRow('Corrispettivo (lordo)','corrispettivo', r),
    staticRow('Net Sales (÷1.22)', fmt((+r.corrispettivo||0)/1.22), 'b'),
    dividerRow('Cassa'),
    valueRow('Contanti','contanti', r),
    valueRow('POS totale','pos', r),
    valueRow('Giftcard','giftcard', r),
    valueRow('Cambi','cambi', r),
    valueRow('Annullamenti','annull', r),
    valueRow('Buono emesso','buonoE', r),
    valueRow('Buono ritirato','buonoR', r),
    staticRow('Sconti su vendite', fmt(r.sconti), ''),
    staticRow('Importo da versare', fmt(r.daVersare), ''),
    staticRow('Importo versato', fmt(r.versato), ''),
    // Verifica cassa: risultato della formula sul record corrente. Si aggiorna
    // automaticamente ogni volta che l'utente modifica un valore editabile.
    // Mango usa una formula semplificata (no cambi/giftcard/annull): segnaliamo
    // con un piccolo badge a fianco del label così è chiaro perché non sottrae.
    `<div id="cash-result" class="row-cash-result ${r.anomaly?'ko':'ok'}"><span>Verifica cassa${isMangoBrand(r.brand)?' <span class="ovr-badge" style="background:#ffedd5;border-color:#f97316;color:#c2410c" title="In Mango cambi, giftcard e annullamenti sono già nel corrispettivo: la formula è (contanti+POS) − buoni emessi + buoni ritirati">formula Mango</span>':''}</span><span class="delta">${r.anomaly?`⚠ Δ ${fmt(r.diff)}`:'✓ Quadra'}</span></div>`,
  ];

  const attachBtn=r.fileId
    ? `<div style="padding:16px"><button class="settings-btn" onclick="openAttachments(${idx})">📎 Vedi foto allegate</button></div>`
    : '';
  const sheetEl=document.getElementById('sheet-rows');
  sheetEl.innerHTML=parts.join('')+attachBtn;
  document.getElementById('sheet').classList.add('show');

  // ── Wiring eventi (delegation per sopravvivere al rerender) ──
  // Click su "ripristina" → cancella l'override del singolo campo
  sheetEl.querySelectorAll('button[data-reset-field]').forEach(btn=>{
    btn.addEventListener('click', async(e)=>{
      e.preventDefault();
      const field=btn.getAttribute('data-reset-field');
      await applyEditToRecord(r, field, null, idx);
    });
  });
  // Input editabili: salva su Enter o blur (se cambiato)
  sheetEl.querySelectorAll('input.row-input[data-field]').forEach(inp=>{
    inp.addEventListener('focus', ()=>inp.select());
    inp.addEventListener('keydown', (e)=>{
      if(e.key==='Enter'){ e.preventDefault(); inp.blur(); }
      else if(e.key==='Escape'){
        // ripristina la visualizzazione corrente senza salvare
        const f=inp.getAttribute('data-field');
        inp.value=fmtNumIt(+r[f]||0);
        inp.blur();
      }
    });
    inp.addEventListener('blur', async()=>{
      const field=inp.getAttribute('data-field');
      const newVal=parseNumIt(inp.value);
      const cur=+r[field]||0;
      // Se non è cambiato, non chiamiamo il backend
      if(Math.abs(newVal - cur) < 0.005){
        inp.value=fmtNumIt(cur);
        return;
      }
      // Se l'utente reimposta esattamente il valore originale, rimuovo l'override
      const orig=(r._original && r._original[field]!=null) ? +r._original[field] : 0;
      const isReset = Math.abs(newVal - orig) < 0.005;
      await applyEditToRecord(r, field, isReset ? null : newVal, idx);
    });
  });
}

// Applica una modifica (o un reset) a un record: chiama il backend, aggiorna
// lo stato locale, ricalcola la verifica cassa e ridisegna le viste correlate.
async function applyEditToRecord(r, field, newVal, idx){
  if(!r.fileId){
    alert('Questo record non ha un fileId Drive: impossibile salvare la correzione.');
    return;
  }
  // UX: marco l'input come "saving"
  const inputs=document.querySelectorAll(`#sheet-rows input.row-input[data-field="${field}"]`);
  inputs.forEach(i=>i.classList.add('saving'));
  try{
    // newVal=null → reset (PUT con null), altrimenti upsert
    await saveOverride(r.fileId, field, newVal);
    if(newVal==null){
      // Ripristina il valore originale e rimuovi marker
      const orig=(r._original && r._original[field]!=null) ? +r._original[field] : 0;
      r[field]=orig;
      if(r._overridden) delete r._overridden[field];
    }else{
      r[field]=+newVal;
      r._overridden = r._overridden || {};
      // Username corrente se conosciuto, altrimenti generico
      const me=(auth && auth.user && (auth.user.username||auth.user.email)) || 'tu';
      r._overridden[field]={by:me, at:new Date().toISOString()};
    }
    recomputeCash(r);
    showToast(newVal==null?'✓ Valore originale ripristinato':'✓ Correzione salvata','ok');
    // Ridisegna lo sheet (semplifica la coerenza badge/colori) ma riapri
    // mantenendo lo stato corrente.
    openSheet(idx);
    // Aggiorna anche le viste a monte: la card del negozio potrebbe perdere
    // il marker di anomalia, i contatori delle anomalie cambiano, etc.
    if(typeof renderAll==='function') renderAll();
  }catch(e){
    console.error('saveOverride',e);
    alert('Errore salvataggio correzione: '+(e.message||e));
    inputs.forEach(i=>i.classList.remove('saving'));
  }
}

// ── VISUALIZZATORE ALLEGATI ──
// Strategia:
//  1) Prima scansione: cerca LINK ANNOTATIONS nel PDF. GoAudits incorpora le
//     thumbnail in bassa risoluzione nel PDF ma salva gli originali ad alta
//     risoluzione sul proprio CDN. Le annotazioni contengono l'URL originale.
//     Se troviamo link → li serviamo via backend /drive/image (CORS-safe + auth).
//  2) Fallback: se non ci sono link annotations (PDF non-GoAudits), estrae
//     le immagini embedded dal PDF direttamente.
// src: undefined → chiusura (allData); 'ap' → apertura (allAperture). Il flusso
// (link annotations GoAudits → galleria originali, fallback immagini embedded)
// è IDENTICO per entrambe: cambia solo il record sorgente e il bottone "torna".
async function openAttachments(idx, src){
  const r=src==='ap'?allAperture[idx]:allData[idx];
  const backCall=src==='ap'?`openAperturaSheet(${idx})`:`openSheet(${idx})`;
  if(!r||!r.fileId){alert('File ID non disponibile per questo record.');return;}
  document.getElementById('sheet-title').textContent=r.location+' · Allegati';
  document.getElementById('sheet-sub').textContent=r.brand+' · '+(r.dateDisplay||(r.dateISO?r.dateISO.split('-').reverse().join('/'):''));
  const rowsEl=document.getElementById('sheet-rows');
  const setStatus=(msg)=>{
    rowsEl.innerHTML=`<div style="padding:40px 20px;text-align:center;color:var(--t2)">
      <div class="spinner" style="margin:0 auto 14px"></div>
      <div class="loading-msg">${msg}</div>
    </div>`;
  };
  setStatus('Carico il PDF…');
  try{
    const resp=await api(`/drive/file/${encodeURIComponent(r.fileId)}`);
    if(!resp.ok)throw new Error('Download '+resp.status);
    const ab=await resp.arrayBuffer();
    const pdf=await pdfjsLib.getDocument({data:ab}).promise;

    // Strategia 1: link annotations (foto originali alta risoluzione)
    setStatus('Cerco foto originali nel PDF…');
    const linkUrls=[];
    const seenLinks=new Set();
    for(let p=1;p<=pdf.numPages;p++){
      try{
        const page=await pdf.getPage(p);
        const annots=await page.getAnnotations();
        for(const a of annots){
          if(a.subtype==='Link' && a.url){
            const isImg=/\.(jpe?g|png|webp)(\?|$|\/)/i.test(a.url) ||
                        /assets\.goaudits\.com/i.test(a.url);
            if(isImg && !seenLinks.has(a.url)){
              seenLinks.add(a.url);
              linkUrls.push({url:a.url,page:p});
            }
          }
        }
      }catch(e){console.warn('Annotations pagina',p,e);}
    }

    if(linkUrls.length>0){
      renderLinkGallery(linkUrls,idx,r,src);
      return;
    }

    // Strategia 2: fallback a estrazione immagini embedded
    setStatus('Estraggo foto incorporate (fallback)…');
    const OPS=pdfjsLib.OPS;
    const imgOps=[OPS.paintImageXObject,OPS.paintJpegXObject,OPS.paintInlineImageXObject].filter(x=>x!==undefined);
    const found=[]; const seen=new Set();

    for(let p=1;p<=pdf.numPages;p++){
      setStatus(`Cerco foto (pagina ${p}/${pdf.numPages})…`);
      const page=await pdf.getPage(p);
      // Pre-render a bassa risoluzione CON timeout hard di 4s: pdf.js può
      // incagliarsi a decodificare certe immagini (es. JPEG2000). Se la
      // render non termina in tempo, la cancelliamo e proseguiamo lo stesso
      // — objs.get() con il suo timeout gestirà le immagini irrecuperabili.
      try{
        const tinyVp=page.getViewport({scale:0.3});
        const tinyCv=document.createElement('canvas');
        tinyCv.width=tinyVp.width;tinyCv.height=tinyVp.height;
        const renderTask=page.render({canvasContext:tinyCv.getContext('2d'),viewport:tinyVp});
        await Promise.race([
          renderTask.promise,
          new Promise((_,rej)=>setTimeout(()=>{try{renderTask.cancel();}catch(_){}rej(new Error('Render timeout'));},4000))
        ]);
      }catch(e){console.warn('Pre-render pagina',p,'skip:',e.message||e);}

      const ops=await page.getOperatorList();
      for(let i=0;i<ops.fnArray.length;i++){
        if(!imgOps.includes(ops.fnArray[i]))continue;
        const name=ops.argsArray[i][0];
        if(!name||seen.has(name))continue;
        seen.add(name);
        // Dopo il pre-render l'oggetto è quasi sempre già pronto (sync).
        // Fallback async con timeout 2s per evitare hang su immagini non
        // decodificabili (JPEG2000, JBIG2, ecc.).
        let obj=null;
        try{obj=page.objs.get(name);}
        catch(_){
          obj=await Promise.race([
            new Promise(res=>{try{page.objs.get(name,res);}catch(_){res(null);}}),
            new Promise(res=>setTimeout(()=>res(null),2000))
          ]);
        }
        if(!obj||!obj.width||!obj.height){console.warn('Skip immagine',name);continue;}
        if(Math.min(obj.width,obj.height)<ATTACH_MIN_SIDE)continue;
        try{
          const cv=document.createElement('canvas');
          cv.width=obj.width;cv.height=obj.height;
          const ctx=cv.getContext('2d');
          if(obj.bitmap){
            ctx.drawImage(obj.bitmap,0,0);
          }else if(obj.data){
            const id=ctx.createImageData(obj.width,obj.height);
            const src=obj.data, dst=id.data, pix=obj.width*obj.height;
            if(src.length===pix*4){dst.set(src);}
            else if(src.length===pix*3){for(let a=0,b=0;a<src.length;a+=3,b+=4){dst[b]=src[a];dst[b+1]=src[a+1];dst[b+2]=src[a+2];dst[b+3]=255;}}
            else if(src.length===pix){for(let a=0,b=0;a<pix;a++,b+=4){dst[b]=dst[b+1]=dst[b+2]=src[a];dst[b+3]=255;}}
            else continue;
            ctx.putImageData(id,0,0);
          }else continue;
          // PNG lossless: evita la doppia compressione JPEG che degrada leggibilità
          // delle scritte piccole (scontrini, codici, timbri). Peso maggiore ma
          // le foto sono temporanee in memoria e il browser mobile le gestisce bene.
          found.push({page:p,width:obj.width,height:obj.height,dataUrl:cv.toDataURL('image/png')});
        }catch(e){console.warn('Image decode fail',name,e);}
      }
    }

    if(!found.length){
      rowsEl.innerHTML=`<div style="padding:40px 24px;text-align:center;color:var(--t3)">
        <div style="font-size:32px;margin-bottom:10px">📭</div>
        <div style="font-size:13px">Nessun allegato immagine trovato in questo PDF</div>
        <button class="settings-btn" style="margin-top:16px" onclick="${backCall}">← Torna ai dati</button>
      </div>`;
      return;
    }

    const container=document.createElement('div');
    container.style.cssText='padding:14px 14px 20px';
    const grid=document.createElement('div');
    grid.style.cssText='display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px';
    // Sanifica parti del nome file (niente slash, due punti, ecc.)
    const safe=s=>String(s||'').replace(/[^\w\-]+/g,'_').replace(/_+/g,'_').replace(/^_|_$/g,'');
    const fileBase=`${safe(r.brand)}_${safe(r.location)}_${r.dateISO||'senza-data'}`;

    found.forEach((im,k)=>{
      const cell=document.createElement('div');
      cell.style.cssText='display:flex;flex-direction:column;gap:6px';
      const cap=document.createElement('div');
      cap.style.cssText='font-size:11px;color:var(--t3);text-transform:uppercase;letter-spacing:.5px;display:flex;justify-content:space-between;align-items:center';
      cap.innerHTML=`<span>Allegato ${k+1} · ${im.width}×${im.height}</span>`;
      const img=document.createElement('img');
      img.src=im.dataUrl;
      img.style.cssText='width:100%;border-radius:10px;background:#fff;box-shadow:0 2px 10px rgba(0,0,0,.3);cursor:zoom-in';
      img.loading='lazy';img.alt=`Allegato ${k+1}`;
      img.onclick=()=>zoomImage(im.dataUrl);

      // Bottone download PNG lossless
      const dl=document.createElement('a');
      dl.href=im.dataUrl;
      dl.download=`${fileBase}_allegato_${k+1}.png`;
      dl.textContent='↓ Scarica PNG';
      dl.style.cssText='display:inline-flex;align-items:center;justify-content:center;padding:8px 12px;background:var(--s2);border:1px solid var(--bd2);border-radius:8px;color:var(--t1);font-family:var(--font);font-size:12px;font-weight:500;text-decoration:none;cursor:pointer;transition:background .15s';
      dl.onmouseover=()=>dl.style.background='var(--s3)';
      dl.onmouseout=()=>dl.style.background='var(--s2)';

      cell.appendChild(cap);cell.appendChild(img);cell.appendChild(dl);
      grid.appendChild(cell);
    });
    container.appendChild(grid);
    const backBtn=document.createElement('button');
    backBtn.className='settings-btn';
    backBtn.style.marginTop='14px';
    backBtn.textContent='← Torna ai dati';
    backBtn.onclick=()=>src==='ap'?openAperturaSheet(idx):openSheet(idx);
    container.appendChild(backBtn);
    rowsEl.innerHTML='';
    rowsEl.appendChild(container);
  }catch(e){
    console.error(e);
    rowsEl.innerHTML=`<div style="padding:40px 24px;text-align:center;color:var(--red)">
      <div style="font-size:32px;margin-bottom:10px">⚠</div>
      <div style="font-size:13px">Errore nel caricamento delle foto<br/><span style="color:var(--t3)">${e.message}</span></div>
      <button class="settings-btn" style="margin-top:16px" onclick="${backCall}">← Torna ai dati</button>
    </div>`;
  }
}

// Galleria con le foto originali dal CDN GoAudits (via backend autenticato).
// src='ap' → il bottone "torna" riapre la scheda apertura invece della chiusura.
function renderLinkGallery(links,idx,r,src){
  const rowsEl=document.getElementById('sheet-rows');
  const safe=s=>String(s||'').replace(/[^\w\-]+/g,'_').replace(/_+/g,'_').replace(/^_|_$/g,'');
  const fileBase=`${safe(r.brand)}_${safe(r.location)}_${r.dateISO||'senza-data'}`;

  const container=document.createElement('div');
  container.style.cssText='padding:14px 14px 20px';

  const banner=document.createElement('div');
  banner.style.cssText='padding:10px 12px;margin-bottom:14px;background:#4ade8012;border:1px solid #4ade8030;border-radius:8px;font-size:11px;color:var(--green);line-height:1.5';
  banner.innerHTML=`✓ <strong>${links.length}</strong> foto originali ad alta risoluzione`;
  container.appendChild(banner);

  const grid=document.createElement('div');
  grid.style.cssText='display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px';

  links.forEach((link,k)=>{
    const cell=document.createElement('div');
    cell.style.cssText='display:flex;flex-direction:column;gap:6px';
    const cap=document.createElement('div');
    cap.style.cssText='font-size:11px;color:var(--t3);text-transform:uppercase;letter-spacing:.5px';
    cap.textContent=`Allegato ${k+1} · originale`;

    // L'<img> non può mandare Authorization Bearer, quindi scarico l'immagine
    // via fetch (col token) e la mostro come blob URL. Più affidabile dei cookie
    // cross-site che alcuni browser bloccano (Safari iOS).
    const extMatch=link.url.match(/\.(jpe?g|png|webp)(?:\?|$|\/)/i);
    const ext=extMatch?extMatch[1].toLowerCase():'jpg';
    const fname=`${fileBase}_allegato_${k+1}.${ext}`;

    const img=document.createElement('img');
    img.style.cssText='width:100%;border-radius:10px;background:#fff;box-shadow:0 2px 10px rgba(0,0,0,.3);cursor:zoom-in;min-height:140px';
    img.loading='lazy';img.alt=`Allegato ${k+1}`;
    img.onerror=()=>{img.alt='Errore caricamento';img.style.minHeight='60px';cap.textContent+=' · errore';};

    // Scarica l'immagine via API autenticata e crea blob URL
    let blobUrl=null;
    api(`/drive/image?url=${encodeURIComponent(link.url)}`).then(async r=>{
      if(!r.ok)throw new Error('HTTP '+r.status);
      const blob=await r.blob();
      blobUrl=URL.createObjectURL(blob);
      img.src=blobUrl;
      img.onclick=()=>zoomImage(blobUrl);
    }).catch(e=>{img.onerror();console.warn('Image load failed',e);});

    // Per il download uso lo stesso blob, salvato con un nome custom
    const dl=document.createElement('button');
    dl.textContent='↓ Scarica originale';
    dl.style.cssText='display:inline-flex;align-items:center;justify-content:center;padding:8px 12px;background:var(--s2);border:1px solid var(--bd2);border-radius:8px;color:var(--t1);font-family:var(--font);font-size:12px;font-weight:500;text-decoration:none;cursor:pointer;transition:background .15s';
    dl.onmouseover=()=>dl.style.background='var(--s3)';
    dl.onmouseout=()=>dl.style.background='var(--s2)';
    dl.onclick=async()=>{
      try{
        if(!blobUrl){
          const r=await api(`/drive/image?url=${encodeURIComponent(link.url)}`);
          if(!r.ok)throw new Error('HTTP '+r.status);
          blobUrl=URL.createObjectURL(await r.blob());
        }
        const a=document.createElement('a');
        a.href=blobUrl; a.download=fname;
        document.body.appendChild(a); a.click(); a.remove();
      }catch(e){alert('Download fallito: '+e.message);}
    };

    cell.appendChild(cap);cell.appendChild(img);cell.appendChild(dl);
    grid.appendChild(cell);
  });
  container.appendChild(grid);

  const backBtn=document.createElement('button');
  backBtn.className='settings-btn';
  backBtn.style.marginTop='14px';
  backBtn.textContent='← Torna ai dati';
  backBtn.onclick=()=>src==='ap'?openAperturaSheet(idx):openSheet(idx);
  container.appendChild(backBtn);

  rowsEl.innerHTML='';
  rowsEl.appendChild(container);
}

// Overlay fullscreen per leggere i dettagli degli scontrini.
// Livelli di zoom:
//  · Livello 1 (default): fit-to-width — la foto occupa tutta la larghezza
//    dello schermo, si scrolla verticalmente se è più alta. Ottimo per leggere.
//  · Livello 2 (actual): risoluzione nativa — per zoomare ulteriormente su
//    dettagli molto piccoli. Si scrolla in entrambe le direzioni.
// Tap sulla foto o sul bottone +/−: toggle. X o tap fuori: chiudi.
function zoomImage(dataUrl){
  const overlay=document.createElement('div');
  overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.95);z-index:500;overflow:auto;-webkit-overflow-scrolling:touch';
  overlay.onclick=(e)=>{if(e.target===overlay)overlay.remove();};

  const img=document.createElement('img');
  img.src=dataUrl;
  let zoomed=false;
  const applyStyle=()=>{
    if(zoomed){
      // Risoluzione nativa: scroll in 2D
      img.style.cssText='display:block;margin:0;max-width:none;max-height:none;cursor:zoom-out;user-select:none;-webkit-user-drag:none';
    }else{
      // Fit-to-width: usa tutta la larghezza, scroll solo verticale
      img.style.cssText='display:block;margin:0 auto;width:100%;max-width:100%;height:auto;cursor:zoom-in;user-select:none;-webkit-user-drag:none';
    }
  };
  applyStyle();
  const toggleZoom=(e)=>{
    if(e){e.stopPropagation();e.preventDefault();}
    zoomed=!zoomed;
    applyStyle();
    zoomBtn.textContent=zoomed?'−':'+';
    if(zoomed){overlay.scrollTop=0;overlay.scrollLeft=0;}
  };
  img.onclick=toggleZoom;

  // Bottone X in alto a destra
  const closeBtn=document.createElement('div');
  closeBtn.textContent='×';
  closeBtn.style.cssText='position:fixed;top:10px;right:10px;width:40px;height:40px;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.75);border-radius:50%;color:#fff;font-size:26px;cursor:pointer;z-index:501;border:1px solid rgba(255,255,255,.2)';
  closeBtn.onclick=(e)=>{e.stopPropagation();overlay.remove();};

  // Bottone +/− in basso a destra
  const zoomBtn=document.createElement('div');
  zoomBtn.textContent='+';
  zoomBtn.style.cssText='position:fixed;bottom:20px;right:20px;width:48px;height:48px;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.8);border-radius:50%;color:#fff;font-size:24px;font-weight:600;cursor:pointer;z-index:501;border:1px solid rgba(255,255,255,.2);user-select:none';
  zoomBtn.onclick=toggleZoom;

  overlay.appendChild(img);
  overlay.appendChild(closeBtn);
  overlay.appendChild(zoomBtn);
  document.body.appendChild(overlay);
}

