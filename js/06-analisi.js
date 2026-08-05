// 06-analisi.js — Tab Analisi: filtri Andamento, filtri condivisi, Andamento gerarchico, confronto YoY, ISO week, tab KPI
// Estratto da index.html (split del 2026-07-07). Script classici:
// tutti i file js/ condividono lo scope globale; ordine di caricamento 01→08.
// ── FILTRI TAB ANDAMENTO (v2: multi-select chip dropdown) ──
// Apre/chiude il pannello del filtro indicato (brand o store), chiudendo
// l'altro se aperto. Click esterno → chiude tutti (gestito dal listener
// globale qui sotto).
function toggleAmPanel(name){
  document.querySelectorAll('.am-filter-panel').forEach(p => {
    if(p.id === 'am-panel-' + name) p.classList.toggle('open');
    else p.classList.remove('open');
  });
  document.querySelectorAll('.am-filter-btn').forEach(b => {
    if(b.id === 'am-btn-' + name) b.classList.toggle('open');
    else b.classList.remove('open');
  });
  // Quando apro il pannello store, lo (ri)popolo dinamicamente in base ai
  // brand attualmente attivi: così se l'utente ha cambiato brand poco prima,
  // vede subito la lista negozi giusta.
  if(name === 'store'){
    const panel = document.getElementById('am-panel-store');
    if(panel.classList.contains('open')) renderAmStorePanel();
  }
}
// Click fuori dai pannelli → chiusura. Registrato in fondo allo script.
function _onAmDocClick(e){
  if(e.target.closest('.am-filter-btn') || e.target.closest('.am-filter-panel')) return;
  document.querySelectorAll('.am-filter-panel').forEach(p => p.classList.remove('open'));
  document.querySelectorAll('.am-filter-btn').forEach(b => b.classList.remove('open'));
}
// Spunta o de-spunta tutto in un pannello. Solo UI: l'utente conferma con Applica.
function setAmAll(name, checked){
  document.querySelectorAll('#am-panel-' + name + '-list input[type=checkbox]').forEach(cb => cb.checked = checked);
  // Aggiorno il counter del button per dare feedback immediato.
  updAmCounter(name);
}
// Conferma la selezione del pannello (chiude il dropdown e ricalcola la
// gerarchia di Andamento). Lettura del DOM: legge tutti i checkbox spuntati.
function applyAmFilter(name){
  const checked = Array.from(
    document.querySelectorAll('#am-panel-' + name + '-list input[type=checkbox]:checked')
  ).map(cb => cb.value);
  if(name === 'brand'){
    tempoBrands = checked;
    // Reset store: i negozi disponibili dipendono dai brand attivi.
    // Se l'utente aveva spuntato negozi di un brand che ora non è più attivo,
    // li rimuovo per coerenza.
    if(tempoBrands.length > 0){
      const allowed = new Set(
        ALL_STORES.filter(s => tempoBrands.includes(s.brand))
                  .map(s => s.location.toLowerCase())
      );
      tempoStores = tempoStores.filter(loc => allowed.has(loc.toLowerCase()));
    }
    // Ri-render del pannello store così riflette i nuovi brand attivi.
    renderAmStorePanel();
  } else if(name === 'store'){
    tempoStores = checked;
  }
  // Chiudo il pannello e ricalcolo lo zucchero (counter + render).
  document.getElementById('am-panel-' + name).classList.remove('open');
  document.getElementById('am-btn-' + name).classList.remove('open');
  updAmCounter('brand');
  updAmCounter('store');
  // Allinea la vista KPI (stessa tab Analisi) e salva per la prossima sessione
  syncAnalisiFiltersFromTempo();
  saveAnalisiFilters();
  renderTempo();
}
// Aggiorna il counter dentro il pulsante in base alle spunte attuali.
// Mostra "tutti" se tutto è spuntato (o nessuno è spuntato → equivalente).
function updAmCounter(name){
  const list = document.querySelectorAll('#am-panel-' + name + '-list input[type=checkbox]');
  const checked = Array.from(list).filter(cb => cb.checked).length;
  const total = list.length;
  const cnt = document.getElementById('am-cnt-' + name);
  const btn = document.getElementById('am-btn-' + name);
  if(!cnt || !btn) return;
  if(checked === 0 || checked === total){
    cnt.textContent = 'tutti';
    btn.classList.remove('has-sel');
  } else {
    cnt.textContent = String(checked);
    btn.classList.add('has-sel');
  }
}
// Costruisce la lista checkbox dei brand. Spunta SOLO i brand già in
// tempoBrands, altrimenti tutti (= "tutti i brand attivi" = nessun filtro).
function renderAmBrandPanel(){
  const list = document.getElementById('am-panel-brand-list');
  if(!list) return;
  const brands = [...new Set(ALL_STORES.map(s => s.brand))].sort((a,b)=>a.localeCompare(b,'it'));
  const sel = new Set(tempoBrands);
  const allOn = sel.size === 0; // 0 selezioni = "tutti i brand"
  list.innerHTML = brands.map(b => {
    const checked = (allOn || sel.has(b)) ? 'checked' : '';
    const c = brandColor(b);
    return `<label class="am-filter-opt">
      <input type="checkbox" value="${attrEsc(b)}" ${checked} onchange="updAmCounter('brand')">
      <span class="am-bcolor" style="background:${c.strong}"></span>${attrEsc(b)}
    </label>`;
  }).join('');
  updAmCounter('brand');
}
// Costruisce la lista checkbox degli store. Mostra solo gli store dei brand
// attualmente attivi. Raggruppa per brand con header. Spunta solo i tempoStores
// (vuoto = "tutti").
function renderAmStorePanel(){
  const list = document.getElementById('am-panel-store-list');
  if(!list) return;
  const activeBrands = (tempoBrands.length === 0)
    ? new Set(ALL_STORES.map(s => s.brand))
    : new Set(tempoBrands);
  const sel = new Set(tempoStores.map(s => s.toLowerCase()));
  const allOn = sel.size === 0;
  // Raggruppo per brand mantenendo l'ordine dei brand attivi
  const grouped = {};
  for(const s of ALL_STORES){
    if(!activeBrands.has(s.brand)) continue;
    if(!grouped[s.brand]) grouped[s.brand] = [];
    grouped[s.brand].push(s.location);
  }
  let html = '';
  const brandKeys = Object.keys(grouped).sort((a,b)=>a.localeCompare(b,'it'));
  brandKeys.forEach((b, i) => {
    if(i > 0) html += '<div class="am-filter-divider"></div>';
    html += `<div class="am-filter-grouphead">${attrEsc(b)}</div>`;
    const stores = grouped[b].slice().sort((a,b)=>a.localeCompare(b,'it'));
    for(const loc of stores){
      const checked = (allOn || sel.has(loc.toLowerCase())) ? 'checked' : '';
      html += `<label class="am-filter-opt">
        <input type="checkbox" value="${attrEsc(loc)}" ${checked} onchange="updAmCounter('store')">
        ${attrEsc(loc)}
      </label>`;
    }
  });
  list.innerHTML = html;
  updAmCounter('store');
}
// Espande/collassa una riga della gerarchia (anno o mese). Persiste su
// amExpanded così il render successivo ricorda lo stato.
function toggleAmRow(key){
  if(amExpanded.has(key)) amExpanded.delete(key);
  else amExpanded.add(key);
  renderTempo();
}
// Toggle multi-select dei confronti. Ogni bottone è indipendente:
// l'utente può attivarne nessuno, uno o entrambi. Quando entrambi sono
// disattivati le card mostrano solo i totali assoluti, niente badge.
function toggleCompare(which, el){
  if(which==='tgt') compareTgt = !compareTgt;
  else if(which==='py') comparePy = !comparePy;
  if(el) el.classList.toggle('on');
  renderTempo();
}

// ── FILTRI ANALISI CONDIVISI E PERSISTENTI ──────────────────────────────
// Andamento (tempo) e KPI vivono sotto la stessa tab "Analisi": quando
// l'utente filtra Brand/Punto vendita in una vista, l'altra si allinea.
// I filtri sopravvivono anche al riavvio dell'app (localStorage).
function syncAnalisiFiltersFromTempo(){
  kpiState.brands=new Set(tempoBrands);
  const ks=new Set();
  const locSet=new Set(tempoStores.map(s=>s.toLowerCase()));
  if(locSet.size){
    for(const s of ALL_STORES){
      if(tempoBrands.length && !tempoBrands.includes(s.brand)) continue;
      if(locSet.has(s.location.toLowerCase())) ks.add(`${s.brand}|${s.location}`);
    }
  }
  kpiState.stores=ks;
  kpiUpdateFilterUI();
}
function syncAnalisiFiltersFromKpi(){
  tempoBrands=[...kpiState.brands];
  tempoStores=[...new Set([...kpiState.stores].map(k=>k.split('|')[1]))];
}
function saveAnalisiFilters(){
  try{
    localStorage.setItem('rp_analisi_filters', JSON.stringify({brands:tempoBrands, stores:tempoStores}));
  }catch(_){}
}
function restoreAnalisiFilters(){
  try{
    const d=JSON.parse(localStorage.getItem('rp_analisi_filters')||'null');
    if(d && Array.isArray(d.brands) && Array.isArray(d.stores)){
      tempoBrands=d.brands;
      tempoStores=d.stores;
      syncAnalisiFiltersFromTempo();
    }
  }catch(_){}
}

// ── TAB ANDAMENTO (ex Periodo) ──
// Modalità di breakdown dentro ogni card-periodo, in base ai filtri attivi:
//  - Nessun filtro → breakdown per BRAND (default storico)
//  - Brand filtrato, store vuoto → breakdown per NEGOZIO (solo quelli del brand)
//  - Brand + store specifici → nessun breakdown, solo totali del periodo
//
// I record qui non sono solo le chiusure parsate dai PDF: sono UNION di
// chiusure (allData, dal 23/04/2026 in avanti) + storico (historicalByKey,
// per coprire 2025 completo + 2026 Jan-Apr pre-GoAudits). Così la timeline
// 2026 è completa, e la vista "Anno" mostra anche 2025 per il confronto YoY.
function buildAndamentoRecords(){
  const out = [];
  const seen = new Set(); // (storeKey|date) già coperti da una chiusura
  // 1) Tutte le chiusure parsate (sorgente preferita: hanno qa/anomaly/etc.)
  for(const r of allData){
    if(!r.dateISO) continue;
    const k = storeKey(r.brand, r.location) + '|' + r.dateISO;
    seen.add(k);
    out.push({
      brand: r.brand,
      location: r.location,
      dateISO: r.dateISO,
      netSales: (+r.netSales) || ((+r.corrispettivo||0)/1.22),
    });
  }
  // 2) Storico dove non c'è già una chiusura (la chiusura vince sempre).
  // Filtriamo per ALL_STORES (30 = monitorati + non-monitorati):
  // in Andamento entrano sia i 20 GoAudits sia i 10 con solo dati storici.
  const allKeys = new Set(ALL_STORES.map(s => storeKey(s.brand, s.location)));
  for(const k in historicalByKey){
    if(seen.has(k)) continue;
    const parts = k.split('|');
    if(parts.length !== 3) continue;
    const sk = parts[0]+'|'+parts[1];
    if(!allKeys.has(sk)) continue;
    const v = +historicalByKey[k] || 0;
    if(v <= 0) continue; // saltiamo zero (festività, chiusi, dati mancanti)
    const proper = ALL_STORES.find(s => storeKey(s.brand, s.location) === sk);
    if(!proper) continue;
    out.push({
      brand: proper.brand,
      location: proper.location,
      dateISO: parts[2],
      netSales: v,
    });
  }
  return out;
}
// Sposta una data ISO indietro di N anni, gestendo il caso 29 feb sull'anno
// non bisestile (mappa a 28 feb). Restituisce stringa ISO YYYY-MM-DD.
function shiftYearBack(dateISO, years){
  if(!dateISO) return null;
  years = years || 1;
  const [y, m, d] = dateISO.split('-').map(Number);
  let py = y - years, pm = m, pd = d;
  if(pm===2 && pd===29){
    const isLeap = (py%4===0 && py%100!==0) || py%400===0;
    if(!isLeap) pd = 28;
  }
  return `${py}-${String(pm).padStart(2,'0')}-${String(pd).padStart(2,'0')}`;
}
// Shift di una data ISO di N giorni (N può essere negativo). TZ-safe: ancoro a
// mezzogiorno locale così l'ora legale non fa mai slittare il giorno, e formatto
// dai componenti locali invece di toISOString() (che userebbe UTC).
function shiftDaysISO(iso, days){
  if(!iso) return null;
  const x = new Date(iso + 'T12:00:00');
  x.setDate(x.getDate() + days);
  return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`;
}
// ── CONFRONTO ANNO-SU-ANNO ALLINEATO AL GIORNO DELLA SETTIMANA ──────────
// Nel retail confrontare il 1° giugno col 1° giugno è fuorviante quando cadono
// in giorni diversi della settimana (un sabato di punta non è paragonabile a un
// mercoledì fiacco). Lo standard è lo shift di 52 settimane ESATTE = 364 giorni
// (364 = 52×7): preserva SEMPRE il giorno della settimana. Esempio richiesto
// dall'utente: domenica 01/06/2025 + 364gg = domenica 31/05/2026; quindi per una
// data di quest'anno il "pari" dell'anno scorso è la stessa data − 364 giorni,
// che cade nello stesso giorno della settimana. Lunedì↔Lunedì, Martedì↔Martedì.
function pyDateISO(iso){ return shiftDaysISO(iso, -364); }
// Data del consuntivo più recente caricato = data massima presente nello
// storico incassi (historicalByKey, dove finiscono i "Consuntivi nuovi"
// caricati da Excel). Dice "fino a che giorno i numeri sono aggiornati".
// Ritorna 'YYYY-MM-DD' o null se non c'è alcun consuntivo.
function lastConsuntivoISO(){
  let max=null;
  for(const k in historicalByKey){
    const iso=k.slice(k.lastIndexOf('|')+1);
    if(/^\d{4}-\d{2}-\d{2}$/.test(iso) && (max===null || iso>max)) max=iso;
  }
  return max;
}
// Aggiorna la riga "Consuntivi aggiornati al…" in cima alla sezione Analisi
// (presente sia nella vista Vendite sia in KPI).
function updateConsuntivoLabel(){
  const iso=lastConsuntivoISO();
  const cls=iso?'analisi-asof ok':'analisi-asof none';
  // Bottone import da Drive DENTRO il banner (solo admin): pesca l'ultimo .xlsx
  // dalla cartella Drive dei consuntivi (riempita da Power Automate) e aggiorna.
  const isAdmin=auth&&auth.user&&auth.user.role==='admin';
  const btn=isAdmin?` <button class="asof-import-btn" onclick="importConsuntiviFromDriveManual()" title="Importa l'ultimo file consuntivi dalla cartella Google Drive">📥 Importa</button>`:'';
  const html=(iso
    ? `📅 Consuntivi aggiornati al <b>${iso.split('-').reverse().join('/')}</b>`
    : `⚠️ Nessun consuntivo caricato`)+btn;
  ['asof-tempo','asof-kpi'].forEach(id=>{
    const el=document.getElementById(id);
    if(el){ el.className=cls; el.innerHTML=html; }
  });
}
// Aggregato anno-su-anno per un gruppo di record.
// Restituisce {pct, totCur, totPy} oppure null se nessun record ha un PY
// disponibile. pct è il RAPPORTO percentuale (totCur/totPy*100): 100% = stesso
// dell'anno scorso, >100% = meglio, <100% = peggio. Stessa convenzione del
// badge target così i due confronti sono visivamente coerenti (richiesta utente).
function periodPyData(records){
  let totCur=0, totPy=0;
  for(const r of records){
    if(!r.dateISO) continue;
    // Pari anno-scorso allineato al giorno della settimana (vedi pyDateISO).
    const pyKey = storeKey(r.brand, r.location) + '|' + pyDateISO(r.dateISO);
    const py = +historicalByKey[pyKey] || 0;
    if(py > 0){
      totCur += (+r.netSales) || ((+r.corrispettivo||0)/1.22);
      totPy  += py;
    }
  }
  if(totPy <= 0) return null;
  return {pct: totCur/totPy*100, totCur, totPy};
}
function periodPyBadgeHTML(records){
  const d = periodPyData(records);
  if(!d) return '';
  // Tab Andamento: formato DELTA (+/- vs anno scorso), stesse soglie del badge
  // target accanto per coerenza visiva.
  //   ≥ -5%   → verde (uguale o meglio del PY, con tolleranza 5%)
  //   -30% a -5% → giallo (calo 5-30% rispetto al PY)
  //   < -30%  → rosso (calo significativo >30%)
  const delta = d.pct - 100;
  let cls='red';
  if(delta >= -5)  cls='green';
  else if(delta >= -30) cls='yellow';
  const sign = delta >= 0 ? '+' : '';
  const pctStr = sign + delta.toLocaleString('it-IT',{minimumFractionDigits:2,maximumFractionDigits:2}) + '%';
  return `<div class="card-target ${cls}" title="${fmt(d.totCur)} vs ${fmt(d.totPy)} anno scorso · ${records.length} chiusur${records.length===1?'a':'e'}">${pctStr} vs PY</div>`;
}
// Aggregati di UN giorno con la stessa gerarchia di priorità di Andamento:
// NET = consuntivo Excel (storico) dove c'è, altrimenti PDF; target = somma dei
// target di tutti i negozi a budget quel giorno; py = NET consuntivo dello
// stesso giorno-settimana dell'anno scorso. Serve alla home ("Riepilogo") per
// mostrare gli stessi numeri di Analisi (net/target) quando arrivano i consuntivi.
// Nessun filtro brand/negozio: la home mostra sempre il totale.
function dayAggregates(dateISO){
  let net=0, tgt=0, py=0;
  const inAll = sk => ALL_STORES.some(s => storeKey(s.brand,s.location)===sk);
  const covered=new Set();
  for(const k in historicalByKey){
    const i=k.lastIndexOf('|'); if(i<0||k.slice(i+1)!==dateISO) continue;
    const sk=k.slice(0,i); if(!inAll(sk)) continue;
    net += +historicalByKey[k]||0; covered.add(sk);
  }
  for(const r of allData){
    if(!r||r.dateISO!==dateISO) continue;
    const sk=storeKey(r.brand,r.location);
    if(covered.has(sk)) continue;
    net += (+r.netSales)||((+r.corrispettivo||0)/1.22);
  }
  for(const k in targetsByKey){
    const i=k.lastIndexOf('|'); if(i<0||k.slice(i+1)!==dateISO) continue;
    const sk=k.slice(0,i); if(!inAll(sk)) continue;
    tgt += +targetsByKey[k]||0;
  }
  const pd=pyDateISO(dateISO);
  for(const k in historicalByKey){
    const i=k.lastIndexOf('|'); if(i<0||k.slice(i+1)!==pd) continue;
    const sk=k.slice(0,i); if(!inAll(sk)) continue;
    py += +historicalByKey[k]||0;
  }
  return {net, tgt, py};
}
// ── RENDER TAB ANDAMENTO (v2: gerarchica anno → mese → giorno) ──────────
// Costruisce un albero anno → mese → giorno includendo tutti i giorni per
// cui c'è almeno un dato (NET o target). I giorni futuri (con solo target)
// appaiono in grigio con label "target € X".
//   - Anno/mese passato → NET reale + delta vs TGT (verde/giallo/rosso)
//   - Anno/mese in corso → "NET parziale / target totale" + delta vs TGT
//                          calcolato sui soli giorni passati
//   - Anno/mese futuro  → "target € X" in grigio, niente badge
//   - Giorno passato    → NET + delta vs TGT
//   - Giorno corrente   → "NET parziale / target totale" + badge "in corso"
//   - Giorno futuro     → "target € X" in grigio, niente badge
// I giorni NON sono espandibili (foglie). Espansione gestita da amExpanded.
function renderTempo(){
  const targetEl = document.getElementById('tempo-content');
  if(!targetEl) return;
  updateConsuntivoLabel();

  // 0) Aggiorna i pannelli filtri (in caso siano cambiate le brand/store mappate
  //    o sia il primo render dopo il login). Il render è idempotente.
  renderAmBrandPanel();
  renderAmStorePanel();

  // 1) Risolvi filtri attivi
  const activeBrands = (tempoBrands.length === 0)
    ? new Set(ALL_STORES.map(s => s.brand))
    : new Set(tempoBrands);
  const activeStoresLow = (tempoStores.length === 0)
    ? null
    : new Set(tempoStores.map(s => s.toLowerCase()));
  const matches = (brand, location) => {
    if(!activeBrands.has(brand)) return false;
    if(activeStoresLow && !activeStoresLow.has(String(location||'').toLowerCase())) return false;
    return true;
  };

  // 2) "Oggi" come stringa ISO YYYY-MM-DD (locale, no UTC drift)
  const _t = new Date();
  const todayISO = `${_t.getFullYear()}-${String(_t.getMonth()+1).padStart(2,'0')}-${String(_t.getDate()).padStart(2,'0')}`;

  // 3) Costruisci dailySums = { dateISO: { net, tgt } }
  // GERARCHIA DI PRIORITÀ in Andamento (decisa dall'utente):
  //   1. Storico Excel (`Incassato YYYY.xlsx`) — è "la bibbia"
  //   2. PDF GoAudits con override applicati (`allData`) — fallback
  // Implementazione: itero prima lo storico, memorizzo le chiavi (store, data)
  // coperte; poi itero allData skippando le chiavi già viste.
  // NOTA: la sezione Chiusure conserva la sua logica (override > PDF, mai
  // storico) perché lì lavoriamo su singole chiusure GoAudits, non aggregati.
  const dailySums = {};
  const bucket = (d) => {
    if(!dailySums[d]) dailySums[d] = { net: 0, tgt: 0 };
    return dailySums[d];
  };
  // 3a) NET dallo storico Excel — priorità massima.
  //     Chiave in historicalByKey: "brand|location|date" già normalizzata.
  const historicalKeys = new Set();
  for(const k in historicalByKey){
    const lastSep = k.lastIndexOf('|');
    if(lastSep < 0) continue;
    const sk = k.slice(0, lastSep);
    const dateISO = k.slice(lastSep + 1);
    const def = ALL_STORES.find(s => storeKey(s.brand, s.location) === sk);
    if(!def) continue;
    if(!matches(def.brand, def.location)) continue;
    bucket(dateISO).net += +historicalByKey[k] || 0;
    historicalKeys.add(sk + '|' + dateISO);
  }
  // 3b) NET dai PDF GoAudits (con override già applicati lato allData).
  //     Skip se lo storico ha già coperto la stessa (store, data) → evita
  //     il doppio conteggio nei giorni di overlap. Per i negozi non
  //     monitorati o per giorni non presenti nell'Excel, restano solo i PDF.
  for(const r of allData){
    if(!r || !r.dateISO) continue;
    if(!matches(r.brand, r.location)) continue;
    const sk = storeKey(r.brand, r.location);
    if(historicalKeys.has(sk + '|' + r.dateISO)) continue;
    const net = (+r.netSales) || ((+r.corrispettivo||0)/1.22);
    bucket(r.dateISO).net += net;
  }
  // 3c) Target dai targets giornalieri (targetsByKey). Stessa convenzione di chiave.
  for(const k in targetsByKey){
    const lastSep = k.lastIndexOf('|');
    if(lastSep < 0) continue;
    const sk = k.slice(0, lastSep);
    const dateISO = k.slice(lastSep + 1);
    const def = ALL_STORES.find(s => storeKey(s.brand, s.location) === sk);
    if(!def) continue;
    if(!matches(def.brand, def.location)) continue;
    bucket(dateISO).tgt += +targetsByKey[k] || 0;
  }

  // 4) Empty state: nessun giorno con dati nei filtri scelti
  const allDates = Object.keys(dailySums);
  if(allDates.length === 0){
    targetEl.innerHTML = `<div class="empty-state"><div class="empty-icon">📭</div><div class="empty-text">Nessun dato per i filtri selezionati</div></div>`;
    _azTempoHero({});   // svuota il titolo nero: senza dati non ha nulla da dire
    return;
  }

  // 5) Aggrega per anno → mese → giorno. Ogni livello tiene NET passato,
  //    target passato, target totale (per mostrare "in corso / totale").
  const years = {};
  for(const dateISO of allDates.sort()){
    const yr = dateISO.slice(0,4);
    const mo = dateISO.slice(0,7);
    if(!years[yr]) years[yr] = { yr, months:{}, netPast:0, tgtPast:0, tgtAll:0, daysPast:0, daysFuture:0, daysPending:0 };
    if(!years[yr].months[mo]) years[yr].months[mo] = { mo, days:[], netPast:0, tgtPast:0, tgtAll:0, daysPast:0, daysFuture:0, daysPending:0 };
    const d = dailySums[dateISO];
    const isFuture = dateISO > todayISO;
    const isToday  = dateISO === todayISO;
    const dayObj = { dateISO, isFuture, isToday, net: d.net, tgt: d.tgt };
    const m = years[yr].months[mo];
    m.days.push(dayObj);
    m.tgtAll += d.tgt;
    years[yr].tgtAll += d.tgt;
    if(!isFuture){
      // Un giorno trascorso entra nei CONFRONTI (vs TGT / vs PY) solo se ha
      // consuntivi (net > 0). Oggi prima delle chiusure serali — o un giorno
      // con dati mancanti — resta "in corso": senza questo filtro il suo
      // target pieno finiva nel denominatore contro un incasso vuoto,
      // schiacciando artificialmente i badge del periodo corrente.
      if(d.net > 0){
        m.netPast += d.net;
        m.tgtPast += d.tgt;
        m.daysPast++;
        years[yr].netPast += d.net;
        years[yr].tgtPast += d.tgt;
        years[yr].daysPast++;
      } else {
        m.daysPending++;
        years[yr].daysPending++;
      }
    } else {
      m.daysFuture++;
      years[yr].daysFuture++;
    }
  }

  // 6) Helper di rendering
  const fmtPctSign = (delta) => {
    const sign = delta >= 0 ? '+' : '';
    return sign + delta.toLocaleString('it-IT', {minimumFractionDigits: 1, maximumFractionDigits: 1}) + '%';
  };
  // Soglie: ≥ −5% verde, da −5 a −30 giallo, sotto −30 rosso.
  const badgeCls = (delta) => delta >= -5 ? 'green' : (delta >= -30 ? 'yellow' : 'red');
  // Stato del periodo: "past" (tutti i giorni passati), "future" (tutti
  // futuri), "current" (mix → contiene oggi o spans il presente).
  const periodStatus = (daysPast, daysFuture) => {
    if(daysPast > 0 && daysFuture === 0) return 'past';
    if(daysPast === 0 && daysFuture > 0) return 'future';
    return 'current';
  };
  const DAYS_IT = ['Dom','Lun','Mar','Mer','Gio','Ven','Sab'];

  // 6b) Badge PY ALLINEATO AL GIORNO DELLA SETTIMANA.
  // Per ogni giorno del periodo (non futuro) prende il valore dell'anno scorso
  // allo STESSO giorno della settimana (data − 364 giorni, vedi pyDateISO),
  // leggendolo da dailySums (aggregato dei negozi filtrati). Confronta solo i
  // giorni che hanno un pari valido (>0): numeratore e denominatore coprono lo
  // stesso insieme di giorni → confronto equo, parziale-vs-parziale automatico.
  // `days` = array di dayObj {dateISO, isFuture, net}. `partial` → suffisso label.
  const pyAlignedBadge = (days, partial) => {
    let cur = 0, py = 0, n = 0;
    for(const d of days){
      if(d.isFuture) continue;            // i giorni futuri non hanno consuntivo
      if(!(d.net > 0)) continue;          // giorno senza consuntivi (es. oggi
                                          // prima delle chiusure serali): fuori
                                          // dal confronto, entrerà quando i
                                          // dati arrivano
      const pv = dailySums[pyDateISO(d.dateISO)];
      const pyNet = pv ? pv.net : 0;
      if(pyNet > 0){ cur += d.net; py += pyNet; n++; }
    }
    if(py <= 0) return '';
    const dlt = (cur - py) / py * 100;
    const label = partial ? 'vs PY (parziale)' : 'vs PY';
    return `<span class="am-badge ${badgeCls(dlt)}" title="${n} giorni confrontati con lo stesso giorno della settimana di un anno fa · ${fmt(cur)} vs ${fmt(py)}">${fmtPctSign(dlt)} ${label}</span>`;
  };
  const curYearISO = todayISO.slice(0,4);
  const curMonthISO = todayISO.slice(0,7);

  // 7) Render
  let html = '';
  // Anni in ordine decrescente: anno corrente prima
  const yrSorted = Object.keys(years).sort().reverse();
  for(const yr of yrSorted){
    const y = years[yr];
    const yStatus = periodStatus(y.daysPast, y.daysFuture);
    const yKey = 'y' + yr;
    const yOpen = amExpanded.has(yKey);

    // Cifra principale + badge per l'anno
    let yMain = '', yBadge = '', ySub = '';
    if(yStatus === 'past'){
      yMain = `<div class="am-row-net">${fmt(y.netPast)}&nbsp;NET</div>`;
      if(compareTgt && y.tgtPast > 0){
        const dlt = (y.netPast - y.tgtPast) / y.tgtPast * 100;
        yBadge += `<span class="am-badge ${badgeCls(dlt)}">${fmtPctSign(dlt)} vs TGT</span>`;
      }
      if(comparePy){
        const yDays = Object.values(y.months).flatMap(mo => mo.days);
        yBadge += pyAlignedBadge(yDays, yr >= curYearISO);
      }
    } else if(yStatus === 'future'){
      yMain = `<div class="am-row-net future">target ${fmt(y.tgtAll)}</div>`;
    } else {
      yMain = `<div class="am-row-net partial">${fmt(y.netPast)} / ${fmt(y.tgtAll)}&nbsp;NET</div>`;
      ySub = 'consuntivo + previsionale';
      if(compareTgt && y.tgtPast > 0){
        const dlt = (y.netPast - y.tgtPast) / y.tgtPast * 100;
        yBadge += `<span class="am-badge ${badgeCls(dlt)}">${fmtPctSign(dlt)} vs TGT (parziale)</span>`;
      }
      // PY anno-in-corso: ogni giorno passato di quest'anno confrontato con lo
      // stesso giorno della settimana di un anno fa (pyAlignedBadge gestisce
      // l'allineamento e il parziale-vs-parziale).
      if(comparePy){
        const yDays = Object.values(y.months).flatMap(mo => mo.days);
        yBadge += pyAlignedBadge(yDays, true);
      }
    }
    // Marker "IN CORSO": fuori dal titolo, su riga propria allineato a sinistra
    // sotto la cifra dell'anno. È più ordinato del marker inline (che andava
    // a capo con margine sinistro fuori asse).
    const yMarker = yStatus === 'current' ? '<div class="am-today-marker block">in corso</div>' : '';
    html += `<div class="am-card">
      <div class="am-card-row" onclick="toggleAmRow('${yKey}')">
        <span class="am-chev ${yOpen ? 'open' : ''}">▶</span>
        <div>
          <div class="am-row-title">${yr}</div>
          ${yMarker}
          ${ySub ? `<div class="am-row-sub">${ySub}</div>` : ''}
        </div>
        <div class="am-row-right">${yMain}${yBadge}</div>
      </div>
      <div class="am-children ${yOpen ? 'open' : ''}">`;

    // Mesi in ordine crescente: gennaio → dicembre
    const moSorted = Object.keys(y.months).sort();
    for(const mk of moSorted){
      const m = y.months[mk];
      const mStatus = periodStatus(m.daysPast, m.daysFuture);
      const mKey = 'm' + mk;
      const mOpen = amExpanded.has(mKey);
      const monthName = MESI[parseInt(mk.slice(5,7), 10) - 1];

      let mMain = '', mBadge = '', mSub = `${m.days.length} giorni`;
      if(mStatus === 'past'){
        mMain = `<div class="am-row-net">${fmt(m.netPast)}&nbsp;NET</div>`;
        if(compareTgt && m.tgtPast > 0){
          const dlt = (m.netPast - m.tgtPast) / m.tgtPast * 100;
          mBadge += `<span class="am-badge ${badgeCls(dlt)}">${fmtPctSign(dlt)} vs TGT</span>`;
        }
        if(comparePy){
          // Ogni giorno del mese confrontato con lo stesso giorno della settimana
          // di un anno fa. Se il mese è quello in corso (o successivo, con dati
          // ancora parziali), la label diventa "(parziale)".
          mBadge += pyAlignedBadge(m.days, mk >= curMonthISO);
        }
      } else if(mStatus === 'future'){
        mMain = `<div class="am-row-net future">target ${fmt(m.tgtAll)}</div>`;
        mSub = `${m.days.length} giorni · solo previsionale`;
      } else {
        mMain = `<div class="am-row-net partial">${fmt(m.netPast)} / ${fmt(m.tgtAll)}&nbsp;NET</div>`;
        mSub = `${m.days.length} giorni · ${m.daysPast} consuntivati${m.daysPending?` · ${m.daysPending} in corso`:''} · ${m.daysFuture} previsionali`;
        if(compareTgt && m.tgtPast > 0){
          const dlt = (m.netPast - m.tgtPast) / m.tgtPast * 100;
          mBadge += `<span class="am-badge ${badgeCls(dlt)}">${fmtPctSign(dlt)} vs TGT (parziale)</span>`;
        }
        // PY mese-in-corso: ogni giorno passato del mese confrontato con lo
        // stesso giorno della settimana di un anno fa (allineamento in pyAlignedBadge).
        if(comparePy){
          mBadge += pyAlignedBadge(m.days, true);
        }
      }
      const mMarker = mStatus === 'current' ? '<div class="am-today-marker block">in corso</div>' : '';
      html += `<div class="am-child-row ${mStatus === 'future' ? 'future' : ''}" onclick="toggleAmRow('${mKey}')">
        <span class="am-chev ${mOpen ? 'open' : ''}">▶</span>
        <div>
          <div class="am-row-title">${monthName}</div>
          ${mMarker}
          <div class="am-row-sub">${mSub}</div>
        </div>
        <div class="am-row-right">${mMain}${mBadge}</div>
      </div>`;

      // Giorni del mese (foglie, non espandibili). Renderizzati solo se
      // il mese è espanso, per non gonfiare il DOM con migliaia di nodi
      // per anni interi non guardati.
      if(mOpen){
        html += `<div class="am-children open">`;
        // Ordine cronologico crescente all'interno del mese
        const days = m.days.slice().sort((a,b)=>a.dateISO.localeCompare(b.dateISO));
        for(const d of days){
          // Costruisco la Date senza incappare in problemi di timezone:
          // 'YYYY-MM-DDT12:00:00' è interpretato come locale → giorno corretto.
          const jsDate = new Date(d.dateISO + 'T12:00:00');
          const dayLabel = `${DAYS_IT[jsDate.getDay()]} ${d.dateISO.slice(8,10)}/${d.dateISO.slice(5,7)}`;
          let dMain = '', dBadge = '';
          if(d.isFuture){
            dMain = `<div class="am-row-net future-only">target ${fmt(d.tgt)}</div>`;
          } else if(d.isToday){
            dMain = `<div class="am-row-net partial">${fmt(d.net)} / ${fmt(d.tgt)}&nbsp;NET</div>`;
            dBadge = `<span class="am-badge muted">in corso</span>`;
          } else {
            dMain = `<div class="am-row-net">${fmt(d.net)}&nbsp;NET</div>`;
            if(compareTgt && d.tgt > 0){
              const dlt = (d.net - d.tgt) / d.tgt * 100;
              dBadge += `<span class="am-badge ${badgeCls(dlt)}">${fmtPctSign(dlt)} vs TGT</span>`;
            }
            if(comparePy) dBadge += pyAlignedBadge([d], false);
          }
          const dMarker = d.isToday ? ' <span class="am-today-marker">oggi</span>' : '';
          html += `<div class="am-day-row ${d.isFuture ? 'future' : ''}">
            <span></span>
            <div><div class="am-row-title">${dayLabel}${dMarker}</div></div>
            <div class="am-row-right">${dMain}${dBadge}</div>
          </div>`;
        }
        html += `</div>`;
      }
    }

    html += `</div></div>`;
  }
  targetEl.innerHTML = html;
  _azTempoHero(years);
}

// Intestazione nera della tab Analisi (sezione 1c del restyle) + pannello
// bianco che le sale sopra con Net YTD e scostamento dal target.
// Prende l'anno più recente fra quelli aggregati da renderTempo, che è quello
// di cui il titolo parla ("ANDAMENTO 2026").
function _azTempoHero(years){
  if(!AZ) return;
  const box = document.getElementById('tempo-hero');
  if(!box) return;
  const yr = Object.keys(years||{}).sort().pop();
  if(!yr){ box.innerHTML=''; return; }
  const y = years[yr];
  const inCorso = y.daysFuture > 0 || y.daysPending > 0;
  const delta = y.tgtPast > 0 ? (y.netPast / y.tgtPast * 100 - 100) : null;
  const dTxt = delta === null ? '—'
    : (delta >= 0 ? '+' : '') + delta.toLocaleString('it-IT',{minimumFractionDigits:1,maximumFractionDigits:1}) + '%';
  box.innerHTML = azHero({
    kicker: inCorso ? 'Anno in corso' : 'Anno chiuso',
    h1: 'Andamento',
    accent: yr,
    claim: `${y.daysPast} giorni consuntivati${y.daysPending?` · ${y.daysPending} in corso`:''}`
  }) + `<div class="az-lift az-duo">
    <div><div class="az-duo-l">Net ${inCorso?'YTD':yr}</div><div class="az-duo-v">${fmt(y.netPast)}</div></div>
    <div><div class="az-duo-l">vs target</div><div class="az-duo-v${delta!==null&&delta<0?' down':''}">${dTxt}</div></div>
  </div>`;
}

// ── HELPER ISO WEEK ──
// Numero di settimana ISO 8601: lunedì primo giorno, settimana 1 contiene il
// primo giovedì dell'anno (e quindi sempre il 4 gennaio). Implementazione
// classica con conversione UTC per evitare drift legati al fuso orario.
function isoWeek(dateISO){
  const [y,m,d]=dateISO.split('-').map(Number);
  const dt=new Date(Date.UTC(y,m-1,d));
  // Sposto al giovedì della stessa settimana ISO
  dt.setUTCDate(dt.getUTCDate()+4-(dt.getUTCDay()||7));
  const yearStart=new Date(Date.UTC(dt.getUTCFullYear(),0,1));
  const weekNo=Math.ceil((((dt-yearStart)/86400000)+1)/7);
  return {year:dt.getUTCFullYear(), week:weekNo};
}
// Restituisce [lunedì, domenica] della settimana ISO indicata
function isoWeekRange(year, week){
  const jan4=new Date(Date.UTC(year,0,4));
  const dow=jan4.getUTCDay()||7; // domenica=7
  const w1Mon=new Date(jan4);
  w1Mon.setUTCDate(jan4.getUTCDate()-(dow-1));
  const mon=new Date(w1Mon);
  mon.setUTCDate(w1Mon.getUTCDate()+(week-1)*7);
  const sun=new Date(mon);
  sun.setUTCDate(mon.getUTCDate()+6);
  return [mon,sun];
}
// Etichetta range "20–26 apr 2026", "27 apr – 3 mag 2026", "29 dic 2025 – 4 gen 2026"
function fmtWeekRange(d1, d2){
  const months=['gen','feb','mar','apr','mag','giu','lug','ago','set','ott','nov','dic'];
  const sameMonth = d1.getUTCMonth()===d2.getUTCMonth() && d1.getUTCFullYear()===d2.getUTCFullYear();
  const sameYear  = d1.getUTCFullYear()===d2.getUTCFullYear();
  if(sameMonth)
    return `${d1.getUTCDate()}–${d2.getUTCDate()} ${months[d2.getUTCMonth()]} ${d2.getUTCFullYear()}`;
  if(sameYear)
    return `${d1.getUTCDate()} ${months[d1.getUTCMonth()]} – ${d2.getUTCDate()} ${months[d2.getUTCMonth()]} ${d2.getUTCFullYear()}`;
  return `${d1.getUTCDate()} ${months[d1.getUTCMonth()]} ${d1.getUTCFullYear()} – ${d2.getUTCDate()} ${months[d2.getUTCMonth()]} ${d2.getUTCFullYear()}`;
}

// Toggle espansione di una settimana collassata (chiamato da onclick inline)
function toggleWeek(key){
  const days=document.querySelector(`.week-days[data-wk="${key}"]`);
  if(!days) return;
  const isHidden=days.style.display==='none';
  days.style.display = isHidden ? '' : 'none';
  const row=document.querySelector(`.week-row[data-wk="${key}"]`);
  if(row) row.classList.toggle('expanded', isHidden);
}

// Costruisce il markup per una singola riga giornaliera (riusato sia per la
// settimana corrente sia per le settimane espanse)
function _buildDayRow(r){
  const dv=r.daVersare||0, v=r.versato||0, delta=dv-v;
  const dCls = delta>0.01 ? 'r' : (delta<-0.01 ? 'g' : 'n');
  const dPrefix = delta>0.01 ? '+' : '';
  const idx=allData.indexOf(r);
  return `<div class="saldo-row" onclick="openSheet(${idx})">
    <div>
      <div class="saldo-row-date">${r.dateDisplay}</div>
      <div class="saldo-row-detail">Da versare ${fmt(dv)} · Versato ${fmt(v)}</div>
    </div>
    <div class="saldo-row-delta ${dCls}">${dPrefix}${fmt(delta)}</div>
  </div>`;
}

// ════════════════════════════════════════════════════════════════════
// ── TAB KPI ──
// Visualizzazione interattiva dei KPI Q25 Ingressi · Q26 CR · Q27 UPT
// estratti dai PDF GoAudits (campo r.qa). Layout focus singolo KPI,
// filtri Brand/Store multi-select, granularità giorno/mese/anno,
// confronti vs PY / Media brand / Periodo precedente, vista alternativa
// heatmap, ranking con sparkline e drill-down per negozio.
// ════════════════════════════════════════════════════════════════════
const kpiState = {
  kpi: 'ingressi',          // 'ingressi' | 'cr' | 'upt'
  gran: 'month',            // 'day' | 'month' | 'year'
  range: 'last',            // 'last'(default=ultimo giorno) | 'custom' | 'wtd' | 'mtd' | 'ytd'
  customStart: null,        // ISO YYYY-MM-DD, usati quando range==='custom'
  customEnd: null,
  view: 'chart',            // 'chart' | 'heatmap'
  brands: new Set(),        // empty = tutti
  stores: new Set(),        // keys = `${brand}|${location}` ; empty = tutti
  compare: new Set(['py']), // 'py' | 'brand' | 'prev'
  sort: 'val'               // 'val' | 'name'
};
// Tavolozza dei grafici. Chart.js disegna su canvas: il CSS non lo raggiunge,
// quindi i colori vanno qui. Condizionata su AZ, così a tema spento tornano
// esattamente quelli di prima.
const AZC = AZ
  ? {main:'#1e88d1', py:'#8a8782', brand:'#0d0d0d', prev:'#a8620f',
     grid:'#eceae6', font:'AdihausDIN', fill:'#1e88d120'}
  : {main:'#4f5bd5', py:'#8b93a1', brand:'#1f9d55', prev:'#c26a1c',
     grid:'#eef1f4', font:'Nunito',    fill:'#4f5bd520'};

let kpiChart = null;
let kpiDrillCharts = [];

// Parser di una singola risposta Q25/26/27 → number | null.
// Accetta numeri in formato italiano ("1.234,56", "10,55%"), inglese
// ("1234.56"), con/senza simboli €/%. Se la risposta contiene testo
// (es. "Shopper track non carica") restituisce null così non distorce
// le medie/somme.
function kpiParseValue(raw){
  if(raw == null) return null;
  let s = String(raw).trim();
  if(!s) return null;
  s = s.replace(/[€%]/g,'').trim();
  if(!s) return null;
  // Se contiene lettere è testo, non un numero → ignorato
  if(/[a-zA-Z]/.test(s)) return null;
  const hasDot = s.includes('.'), hasComma = s.includes(',');
  let norm;
  if(hasDot && hasComma) norm = s.replace(/\./g,'').replace(',','.');
  else if(hasComma)      norm = s.replace(',','.');
  else                   norm = s;
  const n = parseFloat(norm);
  return isFinite(n) ? n : null;
}
// Estrae il valore numerico del KPI richiesto da un record. Cascata:
//   1) historicalKpiByKey[storeKey|date] — dati dall'Excel storico/consuntivi
//      (la "bibbia" quando è valorizzato)
//   2) r.qa[25/26/27] — dato dal PDF GoAudits (fallback)
//   3) null — nessun dato disponibile (escluso dalle medie/somme nella tab KPI)
//
// CR: convenzione di scala diversa tra le due fonti.
//   - Excel: decimale puro (0.1747 = 17,47%)
//   - GoAudits PDF: testo tipo "10,55%" che kpiParseValue strippa a → 10.55 (numero %)
// Per uniformare allo standard del rendering (kpiFmt('cr') fa v.toFixed(2)+'%'),
// moltiplico per 100 quando leggo dall'Excel. Così downstream tutto si comporta uguale.
function kpiValFromRecord(r, kpi){
  if(!r) return null;
  // (1) Excel bibbia. Costruisco la chiave con la stessa logica di storeKey()
  // (lowercase + trim + spazi compattati), poi pipe-join con la data ISO.
  // I record sintetici "shiftati" per il confronto PY hanno _origDateISO
  // valorizzato col vero anno del dato (es. 2025): in quel caso uso quello
  // per il lookup, altrimenti r.dateISO normale.
  // Difensivo su r.brand/r.location mancanti (record malformati).
  const lookupDate = r._origDateISO || r.dateISO;
  if(r.brand && r.location && lookupDate){
    const key = storeKey(r.brand, r.location) + '|' + lookupDate;
    const hkpi = historicalKpiByKey[key];
    if(hkpi){
      const field = {ingressi:'walkIn', cr:'cr', upt:'upt'}[kpi];
      const v = hkpi[field];
      if(v != null && isFinite(v)){
        // Conversione di scala CR: Excel 0.1747 → 17.47 per uniformare con GoAudits
        if(kpi === 'cr') return v * 100;
        return v;
      }
    }
  }
  // (2) Fallback GoAudits PDF: trovo la domanda per ETICHETTA, non per numero.
  // Il numero delle domande KPI è cambiato nel tempo: inserite "Incasso/Storico/
  // Target" prima, Ingressi/CR/UPT sono passate da 25/26/27 a 27/28/29. Cercarle
  // per testo è robusto a questi spostamenti (prima leggeva il Target come CR →
  // valori assurdi tipo 3138%). CR nel PDF è già in percentuale ("11,74%"), UPT un
  // decimale ("2,53"), Ingressi un intero ("545"): kpiParseValue li normalizza,
  // senza ×100 (a differenza del consuntivo dove CR è una frazione).
  if(!r.qa) return null;
  const labelRe = {ingressi:/^ingressi\b/i, cr:/^cr\b/i, upt:/^upt\b/i}[kpi];
  const item = r.qa.find(x => x && labelRe.test(String(x.q||'').trim()));
  if(!item) return null;
  return kpiParseValue(item.a);
}
// Helper: genera "pseudo-record" sintetici dai dati Excel storici per coprire
// i giorni che non hanno PDF GoAudits. Necessario per:
//   - Confronto PY in tab KPI: il 2025 non ha PDF GoAudits, quindi senza
//     questa funzione la linea grigia "anno scorso" è sempre vuota
//   - Mesi pre-23/04/2026 in tab KPI: prima di GoAudits c'era solo l'Excel,
//     quindi senza questa funzione la timeline 2026 della tab KPI inizia ad
//     aprile invece che a gennaio
//
// Parametri:
//   sIso, eIso  : range date (inclusive, formato YYYY-MM-DD) da coprire
//   brandF      : Set<string> brand selezionati (o null = tutti)
//   storeF      : Set<string> "brand|location" selezionati (o null = tutti)
//   shiftYears  : numero di anni di cui shiftare avanti la dateISO (0 = no shift).
//                 Se shiftYears != 0, la data ORIGINALE viene preservata in
//                 _origDateISO così kpiValFromRecord può fare lookup corretto
//                 nell'indice historicalKpiByKey.
//
// Dedup: i record sintetici NON sono generati per i giorni-negozio che hanno
// già un PDF GoAudits in quel range — per evitare di contarli due volte.
function kpiSyntheticFromHistorical(sIso, eIso, brandF, storeF, shiftYears){
  shiftYears = shiftYears || 0;
  // Set delle chiavi (brand|location|date) già presenti in allData nel range:
  // su questi non genero sintetico (sarebbe doppia contabilità).
  const allDataKeys = new Set();
  for(const r of allData){
    if(!r.dateISO || r.dateISO < sIso || r.dateISO > eIso) continue;
    allDataKeys.add(storeKey(r.brand, r.location) + '|' + r.dateISO);
  }
  const out = [];
  for(const fullKey in historicalKpiByKey){
    // fullKey è "brand_norm|location_norm|YYYY-MM-DD" → split sull'ultimo |
    const lastPipe = fullKey.lastIndexOf('|');
    if(lastPipe < 0) continue;
    const date = fullKey.slice(lastPipe+1);
    if(date < sIso || date > eIso) continue;
    if(allDataKeys.has(fullKey)) continue;
    const blKey = fullKey.slice(0, lastPipe);
    // Risali al casing originale del negozio da ALL_STORES (la chiave è
    // normalizzata, ma kpiState.brands/stores usa il casing originale).
    const matching = ALL_STORES.find(s => storeKey(s.brand, s.location) === blKey);
    if(!matching) continue;
    if(brandF && !brandF.has(matching.brand)) continue;
    if(storeF && !storeF.has(`${matching.brand}|${matching.location}`)) continue;
    const rec = {
      brand: matching.brand,
      location: matching.location,
      dateISO: date,
      qa: [],  // niente PDF GoAudits per questo record (è sintetico)
      _synthetic: true,
    };
    if(shiftYears){
      rec._origDateISO = date;
      // Shift weekday-aligned: 52 settimane esatte per "anno" (364gg), così il
      // dato dell'anno scorso finisce nel bucket dello stesso giorno settimana.
      rec.dateISO = shiftDaysISO(date, shiftYears * 364);
    }
    out.push(rec);
  }
  return out;
}
function kpiLabel(k){
  return {ingressi:'Ingressi', cr:'CR (Conversion Rate)', upt:'UPT (Units/Trans)'}[k];
}
// Formattazione human-readable del valore (per badge, tooltip, ranking)
function kpiFmt(v, kpi){
  if(v == null || !isFinite(v)) return '—';
  if(kpi === 'ingressi') return Math.round(v).toLocaleString('it-IT');
  if(kpi === 'cr') return v.toFixed(2).replace('.',',') + '%';
  return v.toFixed(2).replace('.',',');
}
// Delta percentuale tra due valori; restituisce {cls, text} per UI
function kpiDelta(curr, base){
  if(curr == null || base == null || !isFinite(base) || base === 0) return {cls:'flat', text:'—'};
  const pct = (curr - base) / Math.abs(base) * 100;
  const cls = Math.abs(pct) < 0.5 ? 'flat' : (pct > 0 ? 'up' : 'dn');
  const arrow = cls === 'up' ? '▲' : (cls === 'dn' ? '▼' : '•');
  return {cls, text: `${arrow} ${Math.abs(pct).toFixed(1)}%`};
}

// Date helpers - based on today (dynamic, NOT hardcoded)
function kpiToday(){ return new Date(); }
function kpiFmtDateISO(d){ return d.toISOString().slice(0,10); }
function kpiShiftYear(d, n){ const x = new Date(d); x.setFullYear(x.getFullYear()+n); return x; }
// Ancoro le date a mezzogiorno UTC così kpiFmtDateISO (toISOString) restituisce
// ESATTAMENTE la data voluta anche per il singolo giorno (niente slittamento TZ).
function _isoAnchor(iso){ return new Date(iso + 'T12:00:00Z'); }
function _todayIso(){ const t=kpiToday(); return `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`; }
// Ultimo giorno per cui esistono KPI (consuntivo o chiusura). Default all'apertura.
function _kpiLatestDay(){
  let max='';
  for(const k in historicalKpiByKey){ const d=k.slice(k.lastIndexOf('|')+1); if(d>max) max=d; }
  for(const r of allData){ if(r.dateISO && r.dateISO>max) max=r.dateISO; }
  return max || _todayIso();
}
function kpiDateRange(rangeKey){
  const today=_todayIso();
  if(rangeKey === 'ytd') return [_isoAnchor(today.slice(0,4)+'-01-01'), _isoAnchor(today)];
  if(rangeKey === 'mtd') return [_isoAnchor(today.slice(0,7)+'-01'),   _isoAnchor(today)];
  if(rangeKey === 'wtd'){ // da lunedì (ISO) a oggi
    const s=_isoAnchor(today); s.setUTCDate(s.getUTCDate()-((s.getUTCDay()+6)%7));
    return [s, _isoAnchor(today)];
  }
  if(rangeKey === 'custom'){
    const a=kpiState.customStart||_kpiLatestDay(), b=kpiState.customEnd||a;
    return a<=b ? [_isoAnchor(a),_isoAnchor(b)] : [_isoAnchor(b),_isoAnchor(a)];
  }
  if(rangeKey === 'last'){ const d=_kpiLatestDay(); return [_isoAnchor(d), _isoAnchor(d)]; }
  // fallback numerico (ultimi N giorni) — non più esposto da bottoni
  const n=+rangeKey||30, e=_isoAnchor(today), s=new Date(e); s.setUTCDate(s.getUTCDate()-n+1);
  return [s, e];
}
function kpiBucketKey(dateISO, gran){
  if(gran === 'day') return dateISO;
  if(gran === 'month') return dateISO.slice(0,7);
  return dateISO.slice(0,4);
}
function kpiBucketLabel(key, gran){
  if(gran === 'day'){
    const d = new Date(key + 'T00:00:00');
    return d.toLocaleDateString('it-IT',{day:'2-digit',month:'short'});
  }
  if(gran === 'month'){
    const [y,m] = key.split('-');
    const names = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'];
    return `${names[+m-1]} ${y.slice(2)}`;
  }
  return key;
}

// Restituisce i record di allData che (a) hanno una data nel range e
// (b) rispettano i filtri brand/store. Non filtra ancora per KPI null:
// quello lo gestisce l'aggregatore in modo che CR/UPT con ingressi=null
// non vengano usati come peso.
function kpiFiltered(){
  const [s, e] = kpiDateRange(kpiState.range);
  const sIso = kpiFmtDateISO(s), eIso = kpiFmtDateISO(e);
  const brandF = kpiState.brands.size ? kpiState.brands : null;
  const storeF = kpiState.stores.size ? kpiState.stores : null;
  // Record GoAudits nel range (sorgente primaria post 23/04/2026)
  const goRecs = allData.filter(r => {
    if(!r.dateISO) return false;
    if(r.dateISO < sIso || r.dateISO > eIso) return false;
    if(brandF && !brandF.has(r.brand)) return false;
    if(storeF && !storeF.has(`${r.brand}|${r.location}`)) return false;
    return true;
  });
  // Sintetici da Excel storico/consuntivi per coprire i giorni senza GoAudits
  // (es. 2026 pre-23/04, oppure tutto il 2025 se l'utente seleziona YTD su 2026
  // ma ha caricato anche i dati 2025 — non succede di solito ma è coerente).
  // Dedup è già gestito da kpiSyntheticFromHistorical.
  const synthRecs = kpiSyntheticFromHistorical(sIso, eIso, brandF, storeF, 0);
  return goRecs.concat(synthRecs);
}
// Aggregazione per bucket di tempo:
//   ingressi → somma
//   cr/upt   → media pesata per ingressi (se disponibili) o semplice
function kpiAggregateByBucket(records, kpi, gran){
  const map = new Map();
  for(const r of records){
    const v = kpiValFromRecord(r, kpi);
    if(v == null) continue;
    const k = kpiBucketKey(r.dateISO, gran);
    let b = map.get(k);
    if(!b){ b = {sum:0, weightSum:0, count:0}; map.set(k, b); }
    if(kpi === 'ingressi'){ b.sum += v; b.count++; }
    else {
      const w = kpiValFromRecord(r, 'ingressi') || 1;
      b.sum += v * w; b.weightSum += w; b.count++;
    }
  }
  const out = [];
  for(const [k,b] of map){
    const value = kpi === 'ingressi' ? b.sum : (b.weightSum ? b.sum / b.weightSum : 0);
    out.push({key:k, value});
  }
  out.sort((a,b) => a.key < b.key ? -1 : 1);
  return out;
}
// Singolo numero totale del periodo (per le hero card)
function kpiAggregateTotal(records, kpi){
  let sum = 0, weightSum = 0, count = 0;
  for(const r of records){
    const v = kpiValFromRecord(r, kpi); if(v == null) continue;
    if(kpi === 'ingressi'){ sum += v; count++; }
    else {
      const w = kpiValFromRecord(r, 'ingressi') || 1;
      sum += v * w; weightSum += w; count++;
    }
  }
  if(count === 0) return null;
  return kpi === 'ingressi' ? sum : sum / (weightSum || 1);
}
// Aggregazione per negozio (per ranking + heatmap)
function kpiAggregateByStore(records, kpi){
  const map = new Map();
  for(const r of records){
    const v = kpiValFromRecord(r, kpi); if(v == null) continue;
    const k = `${r.brand}|${r.location}`;
    let b = map.get(k);
    if(!b){ b = {brand:r.brand, location:r.location, sum:0, weightSum:0, count:0, daily:[]}; map.set(k, b); }
    if(kpi === 'ingressi'){ b.sum += v; b.count++; }
    else {
      const w = kpiValFromRecord(r, 'ingressi') || 1;
      b.sum += v*w; b.weightSum += w; b.count++;
    }
    b.daily.push({date:r.dateISO, v});
  }
  const out = [];
  for(const [,b] of map){
    const value = kpi === 'ingressi' ? b.sum : (b.weightSum ? b.sum / b.weightSum : 0);
    b.daily.sort((a,b) => a.date < b.date ? -1 : 1);
    out.push({...b, value});
  }
  return out;
}

// Render hero (3 card in alto) — valore + delta "prima metà vs seconda metà"
function kpiRenderHero(){
  const recs = kpiFiltered();
  const [s,e] = kpiDateRange(kpiState.range);
  const halfMs = (e - s) / 2;
  const midIso = kpiFmtDateISO(new Date(s.getTime() + halfMs));
  const firstHalf = recs.filter(r => r.dateISO < midIso);
  const secondHalf = recs.filter(r => r.dateISO >= midIso);
  ['ingressi','cr','upt'].forEach(kpi => {
    const tot = kpiAggregateTotal(recs, kpi);
    const t1 = kpiAggregateTotal(firstHalf, kpi);
    const t2 = kpiAggregateTotal(secondHalf, kpi);
    const d = kpiDelta(t2, t1);
    const vEl = document.getElementById('hero-v-'+kpi);
    const dEl = document.getElementById('hero-d-'+kpi);
    if(vEl) vEl.textContent = kpiFmt(tot, kpi);
    if(dEl){ dEl.textContent = d.text; dEl.className = 'kt-d ' + d.cls; }
  });
}

// Costruisce i record PY (anno scorso) per il confronto, shiftando avanti
// la data di 1 anno così bucketKey li mette negli stessi bucket del periodo
// corrente.
// Due sorgenti:
//   1) Record GoAudits dell'anno scorso (allData) — esistono solo se PDF era
//      attivo a quel tempo (in pratica non c'è nulla nel 2025)
//   2) Sintetici da historicalKpiByKey (Excel storico) — coprono tutto il 2025
//      quando l'admin ha caricato il file con le nuove colonne KPI
// Senza la sorgente 2, la linea grigia "vs PY" era sempre vuota per il 2026
// (perché nel 2025 non c'era GoAudits). Dedup gestito da kpiSyntheticFromHistorical.
function kpiPyShiftedFiltered(){
  const [s,e] = kpiDateRange(kpiState.range);
  // Finestra PY = finestra corrente spostata indietro di 52 settimane esatte
  // (364gg), così copre gli STESSI giorni della settimana di un anno fa.
  // Derivo i limiti dagli ISO correnti (coerenti con kpiFiltered) e poi
  // ri-allineo in avanti dello stesso 364gg → bucket combaciano lun↔lun.
  const sIso = shiftDaysISO(kpiFmtDateISO(s), -364), eIso = shiftDaysISO(kpiFmtDateISO(e), -364);
  const brandF = kpiState.brands.size ? kpiState.brands : null;
  const storeF = kpiState.stores.size ? kpiState.stores : null;
  const shifted = allData.filter(r => {
    if(!r.dateISO) return false;
    if(r.dateISO < sIso || r.dateISO > eIso) return false;
    if(brandF && !brandF.has(r.brand)) return false;
    if(storeF && !storeF.has(`${r.brand}|${r.location}`)) return false;
    return true;
  }).map(r => ({
    ...r,
    // Avanti di 364gg per allineare i bucket allo stesso giorno della settimana
    _origDateISO: r.dateISO,
    dateISO: shiftDaysISO(r.dateISO, 364)
  }));
  // Sintetici dall'Excel storico per i giorni del PY range che non hanno
  // GoAudits. shiftYears=1 → dateISO traslato a 2026, _origDateISO=2025 così
  // kpiValFromRecord recupera il valore corretto da historicalKpiByKey.
  const synthetic = kpiSyntheticFromHistorical(sIso, eIso, brandF, storeF, 1);
  return shifted.concat(synthetic);
}

function kpiRenderChart(){
  const recs = kpiFiltered();
  const kpi = kpiState.kpi;
  const series = kpiAggregateByBucket(recs, kpi, kpiState.gran);
  const labels = series.map(s => kpiBucketLabel(s.key, kpiState.gran));
  const values = series.map(s => +s.value.toFixed(2));

  const datasets = [{
    label: kpiLabel(kpi),
    data: values,
    backgroundColor: AZC.main,
    borderColor: AZC.main,
    borderWidth: 2,
    tension: 0.3,
    fill: false,
    type: kpiState.gran === 'day' ? 'line' : 'bar',
    borderRadius: 4,
    pointRadius: kpiState.gran === 'day' ? 2 : 0
  }];

  // vs Anno scorso
  if(kpiState.compare.has('py')){
    const pyRecs = kpiPyShiftedFiltered();
    const pySeries = kpiAggregateByBucket(pyRecs, kpi, kpiState.gran);
    const pyMap = new Map(pySeries.map(p => [p.key, p.value]));
    const pyData = series.map(s => {
      const v = pyMap.get(s.key);
      return v == null ? null : +v.toFixed(2);
    });
    datasets.push({
      label: 'Anno scorso',
      data: pyData,
      type: 'line',
      borderColor: AZC.py,
      backgroundColor: AZC.py,
      borderDash: [4,4],
      borderWidth: 2,
      tension: 0.3,
      fill: false,
      pointRadius: 3
    });
  }

  // vs Media brand: per ogni bucket, calcolo la media degli store dei brand
  // di interesse (se filtro su store specifici, prendo i brand di quegli store;
  // altrimenti i brand filtrati; altrimenti tutti i brand).
  if(kpiState.compare.has('brand')){
    const brandsToShow = new Set();
    if(kpiState.stores.size){
      for(const k of kpiState.stores) brandsToShow.add(k.split('|')[0]);
    } else if(kpiState.brands.size){
      kpiState.brands.forEach(b => brandsToShow.add(b));
    } else {
      [...new Set(ALL_STORES.map(s => s.brand))].forEach(b => brandsToShow.add(b));
    }
    const [s,e] = kpiDateRange(kpiState.range);
    const sIso = kpiFmtDateISO(s), eIso = kpiFmtDateISO(e);
    const brandRecs = allData.filter(r => r.dateISO && r.dateISO>=sIso && r.dateISO<=eIso && brandsToShow.has(r.brand));
    const byBucket = new Map();
    for(const r of brandRecs){
      const v = kpiValFromRecord(r, kpi); if(v == null) continue;
      const bk = kpiBucketKey(r.dateISO, kpiState.gran);
      const sk = `${r.brand}|${r.location}`;
      let m = byBucket.get(bk);
      if(!m){ m = new Map(); byBucket.set(bk, m); }
      let a = m.get(sk);
      if(!a){ a = {sum:0, w:0, cnt:0}; m.set(sk, a); }
      if(kpi === 'ingressi'){ a.sum += v; a.cnt++; }
      else {
        const w = kpiValFromRecord(r, 'ingressi') || 1;
        a.sum += v*w; a.w += w; a.cnt++;
      }
    }
    const brandData = series.map(s => {
      const m = byBucket.get(s.key);
      if(!m) return null;
      const vals = [];
      for(const [,a] of m){
        const v = kpi === 'ingressi' ? a.sum : (a.w ? a.sum/a.w : 0);
        vals.push(v);
      }
      if(!vals.length) return null;
      const avg = vals.reduce((x,y)=>x+y,0)/vals.length;
      return +avg.toFixed(2);
    });
    datasets.push({
      label: 'Media brand',
      data: brandData,
      type: 'line',
      borderColor: AZC.brand,
      backgroundColor: AZC.brand,
      borderDash: [2,3],
      borderWidth: 2,
      tension: 0.3,
      fill: false,
      pointRadius: 3
    });
  }

  // vs Periodo precedente: stesso filtro brand/store ma range shiftato indietro
  if(kpiState.compare.has('prev')){
    const [s,e] = kpiDateRange(kpiState.range);
    const span = e - s;
    const prevStart = new Date(s.getTime() - span - 24*3600*1000);
    const prevEnd = new Date(s.getTime() - 24*3600*1000);
    const psIso = kpiFmtDateISO(prevStart), peIso = kpiFmtDateISO(prevEnd);
    const brandF = kpiState.brands.size ? kpiState.brands : null;
    const storeF = kpiState.stores.size ? kpiState.stores : null;
    const prevRecs = allData.filter(r => {
      if(!r.dateISO) return false;
      if(r.dateISO < psIso || r.dateISO > peIso) return false;
      if(brandF && !brandF.has(r.brand)) return false;
      if(storeF && !storeF.has(`${r.brand}|${r.location}`)) return false;
      return true;
    });
    const prevSeries = kpiAggregateByBucket(prevRecs, kpi, kpiState.gran);
    const prevData = series.map((_,i) => prevSeries[i] ? +prevSeries[i].value.toFixed(2) : null);
    datasets.push({
      label: 'Periodo prec.',
      data: prevData,
      type: 'line',
      borderColor: AZC.prev,
      backgroundColor: AZC.prev,
      borderDash: [6,3],
      borderWidth: 2,
      tension: 0.3,
      fill: false,
      pointRadius: 3
    });
  }

  // Titolo + sintesi sempre prima, così se Chart fallisce vedi i numeri
  document.getElementById('kpi-chart-title-l').textContent = kpiLabel(kpi);
  const tot = kpiAggregateTotal(recs, kpi);
  document.getElementById('kpi-chart-title-sum').textContent =
    (kpi === 'ingressi' ? 'Totale: ' : 'Media: ') + kpiFmt(tot, kpi);

  const box = document.querySelector('#kpi-view-chart .kpi-chart-box');
  if(typeof Chart === 'undefined'){
    box.innerHTML = '<div style="padding:30px 16px;color:var(--red);font-size:12px;text-align:center;line-height:1.5">⚠️ Libreria grafici non caricata.<br>Controlla la connessione e ricarica la pagina.</div>';
    return;
  }
  if(!series.length){
    box.innerHTML = '<div style="padding:30px 16px;color:var(--t3);font-size:12px;text-align:center">Nessun dato KPI nel periodo selezionato</div>';
    return;
  }

  try {
    if(kpiChart) kpiChart.destroy();
    // Se il canvas era stato sostituito da un messaggio, lo ricreo
    if(!document.getElementById('kpiMainChart')){
      box.innerHTML = '<canvas id="kpiMainChart"></canvas>';
    }
    const ctx = document.getElementById('kpiMainChart').getContext('2d');
    kpiChart = new Chart(ctx, {
      type: 'bar',
      data: {labels, datasets},
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {mode:'index', intersect:false},
        plugins: {
          legend: {display:true, position:'bottom', labels:{font:{family:AZC.font,size:10}, boxWidth:10, boxHeight:10, padding:8}},
          tooltip: {
            callbacks: {
              label: function(ctx){
                const v = ctx.parsed.y;
                return ctx.dataset.label + ': ' + (v == null ? '—' : kpiFmt(v, kpi));
              }
            }
          }
        },
        scales: {
          x: {ticks:{font:{family:AZC.font,size:10}}, grid:{display:false}},
          y: {ticks:{font:{family:AZC.font,size:10}, callback:v => kpiFmt(v, kpi)}, grid:{color:AZC.grid}}
        }
      }
    });
  } catch(e){
    console.error('kpiRenderChart failed', e);
    box.innerHTML = '<div style="padding:30px 16px;color:var(--red);font-size:12px;text-align:center;line-height:1.5">⚠️ Errore nel rendering del grafico:<br>'+attrEsc(e.message)+'</div>';
  }
}

function kpiRenderRanking(){
  const recs = kpiFiltered();
  const stores = kpiAggregateByStore(recs, kpiState.kpi);
  // Media brand per il delta di ogni riga
  const brandAvg = new Map();
  const brandAgg = new Map();
  for(const s of stores){
    let b = brandAgg.get(s.brand);
    if(!b){ b = {vals:[]}; brandAgg.set(s.brand, b); }
    b.vals.push(s.value);
  }
  for(const [k,b] of brandAgg){
    brandAvg.set(k, b.vals.reduce((x,y)=>x+y,0)/b.vals.length);
  }
  stores.sort((a,b) => kpiState.sort === 'name'
    ? (a.brand+a.location).localeCompare(b.brand+b.location,'it')
    : b.value - a.value);
  const list = document.getElementById('kpi-rank-list');
  if(!list) return;
  if(!stores.length){
    list.innerHTML = '<div class="kpi-rank-empty">Nessun dato per i filtri selezionati</div>';
    return;
  }
  list.innerHTML = stores.map((s,i) => {
    const brandM = brandAvg.get(s.brand);
    const d = kpiDelta(s.value, brandM);
    const spark = kpiSparkline(s.daily.map(x => x.v), 56, 24);
    const payload = JSON.stringify({brand:s.brand, location:s.location});
    return `<div class="kpi-rank-row" onclick='openKpiDrill(${JSON.stringify(payload)})'>
      <div class="kpi-rank-pos">${i+1}</div>
      <div class="kpi-rank-name">
        <div class="kpi-rank-brand">${attrEsc(s.brand)}</div>
        <div class="kpi-rank-loc">${attrEsc(s.location)}</div>
      </div>
      <div class="kpi-rank-spark">${spark}</div>
      <div class="kpi-rank-val">${kpiFmt(s.value, kpiState.kpi)}</div>
      <div class="kpi-rank-delta ${d.cls}">${d.text}</div>
    </div>`;
  }).join('');
}

function kpiSparkline(vals, w, h){
  const clean = vals.filter(v => v != null);
  if(clean.length < 2) return `<svg width="${w}" height="${h}"></svg>`;
  const min = Math.min(...clean), max = Math.max(...clean);
  const range = max - min || 1;
  const step = w / (clean.length - 1);
  const pts = clean.map((v,i) => `${(i*step).toFixed(1)},${(h - (v-min)/range*h).toFixed(1)}`).join(' ');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline points="${pts}" fill="none" stroke="#4f5bd5" stroke-width="1.5"/></svg>`;
}

function kpiRenderHeatmap(){
  const recs = kpiFiltered();
  const stores = kpiAggregateByStore(recs, kpiState.kpi);
  const cont = document.getElementById('kpi-hm-content');
  if(!cont) return;
  if(!stores.length){ cont.innerHTML = '<div class="kpi-rank-empty">Nessun dato KPI nel periodo selezionato</div>'; return; }

  const buckets = new Set();
  for(const s of stores) for(const d of s.daily) buckets.add(kpiBucketKey(d.date, kpiState.gran));
  const bucketArr = [...buckets].sort();

  // Per ogni cella store|bucket calcolo il valore aggregato
  const cell = new Map();
  for(const s of stores){
    const acc = new Map();
    for(const d of s.daily){
      const bk = kpiBucketKey(d.date, kpiState.gran);
      let a = acc.get(bk);
      if(!a){ a = {sum:0, w:0, cnt:0}; acc.set(bk, a); }
      if(kpiState.kpi === 'ingressi'){ a.sum += d.v; a.cnt++; }
      else { a.sum += d.v; a.w++; a.cnt++; }
    }
    for(const [bk,a] of acc){
      const v = kpiState.kpi === 'ingressi' ? a.sum : (a.w ? a.sum/a.w : 0);
      cell.set(`${s.brand}|${s.location}|${bk}`, v);
    }
  }

  // Range per scala colore globale
  let gMin = Infinity, gMax = -Infinity;
  for(const v of cell.values()){ if(v < gMin) gMin = v; if(v > gMax) gMax = v; }
  // Scala della heatmap. Col tema azzurro va da ROSSO (valore piu' basso) ad
  // AZZURRO (piu' alto) passando per un grigio scuro.
  // Il grigio in mezzo non e' un vezzo: le celle hanno color:#fff, e la scala
  // di prima partiva da rgb(254,226,226), quasi bianco — il numero dentro le
  // celle basse era invisibile. Tenendo scuri tutti e tre i capi, il bianco si
  // legge sempre.
  const _ramp = AZ
    ? [[216,50,42], [87,84,79], [30,136,209]]      // #d8322a -> #57544f -> #1e88d1
    : [[254,226,226], [254,243,199], [22,163,74]]; // la scala precedente
  function color(v){
    if(v == null) return 'var(--s3)';
    const t = (v - gMin) / ((gMax - gMin) || 1);
    const [a,b] = t < 0.5 ? [_ramp[0], _ramp[1]] : [_ramp[1], _ramp[2]];
    const k = t < 0.5 ? t*2 : (t-0.5)*2;
    const c = a.map((x,i) => Math.round(x + (b[i]-x)*k));
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  }

  // Limito a ultimi 14 bucket per mobile
  const showBuckets = bucketArr.slice(-14);
  stores.sort((a,b) => b.value - a.value);

  let html = '<table class="kpi-hm-table"><thead><tr><th class="row-h"></th>';
  for(const bk of showBuckets) html += `<th>${kpiBucketLabel(bk, kpiState.gran)}</th>`;
  html += '</tr></thead><tbody>';
  for(const s of stores){
    html += `<tr><th class="row-h">${attrEsc(s.brand)} · ${attrEsc(s.location)}</th>`;
    for(const bk of showBuckets){
      const v = cell.get(`${s.brand}|${s.location}|${bk}`);
      if(v == null){ html += '<td class="na">·</td>'; }
      else {
        const txt = kpiState.kpi === 'ingressi' ? Math.round(v) : v.toFixed(1);
        const title = `${s.brand} ${s.location} · ${kpiBucketLabel(bk, kpiState.gran)}: ${kpiFmt(v, kpiState.kpi)}`;
        html += `<td style="background:${color(v)}" title="${attrEsc(title)}">${txt}</td>`;
      }
    }
    html += '</tr>';
  }
  html += '</tbody></table>';
  cont.innerHTML = html;
}

// Drill-down: bottom sheet con 3 mini-chart per il singolo negozio
function openKpiDrill(payload){
  const o = typeof payload === 'string' ? JSON.parse(payload) : payload;
  const sheet = document.getElementById('kpi-drill-sheet');
  const [s,e] = kpiDateRange(kpiState.range);
  const sIso = kpiFmtDateISO(s), eIso = kpiFmtDateISO(e);
  const recs = allData.filter(r => r.brand === o.brand && r.location === o.location && r.dateISO >= sIso && r.dateISO <= eIso);

  let html = `<div class="kpi-drill-grip"></div>
    <div class="kpi-drill-h">
      <div class="kpi-drill-name">${attrEsc(o.location)}</div>
      <div class="kpi-drill-brand">${attrEsc(o.brand)}</div>
    </div>`;
  ['ingressi','cr','upt'].forEach((kpi, idx) => {
    const tot = kpiAggregateTotal(recs, kpi);
    // Finestra PY allineata al giorno della settimana: −364gg (52 settimane).
    const sPyI = shiftDaysISO(sIso, -364), ePyI = shiftDaysISO(eIso, -364);
    const pyRecs = allData.filter(r => r.brand === o.brand && r.location === o.location && r.dateISO >= sPyI && r.dateISO <= ePyI);
    const totPy = kpiAggregateTotal(pyRecs, kpi);
    const d = kpiDelta(tot, totPy);
    html += `<div class="kpi-drill-mini">
      <div class="kpi-drill-mini-h">
        <span class="kpi-drill-mini-l">${kpiLabel(kpi)}</span>
        <span class="kpi-drill-mini-v">${kpiFmt(tot, kpi)}<span class="dm-delta kpi-rank-delta ${d.cls}">${d.text}</span></span>
      </div>
      <div class="kpi-drill-mini-box"><canvas id="kpi-dchart-${idx}"></canvas></div>
    </div>`;
  });
  html += `<button class="kpi-drill-close" onclick="closeKpiDrill()">Chiudi</button>`;
  sheet.innerHTML = html;
  document.getElementById('kpi-drill-overlay').classList.add('open');

  kpiDrillCharts.forEach(c => c.destroy()); kpiDrillCharts = [];
  if(typeof Chart === 'undefined') return;
  ['ingressi','cr','upt'].forEach((kpi, idx) => {
    const series = kpiAggregateByBucket(recs, kpi, kpiState.gran);
    const canvas = document.getElementById('kpi-dchart-'+idx);
    if(!canvas) return;
    const ctx = canvas.getContext('2d');
    const c = new Chart(ctx, {
      type: 'line',
      data: {labels:series.map(s=>kpiBucketLabel(s.key,kpiState.gran)), datasets:[{
        data: series.map(s => +s.value.toFixed(2)),
        borderColor:AZC.main, backgroundColor:AZC.fill,
        borderWidth:2, tension:0.3, fill:true, pointRadius:0
      }]},
      options: {
        responsive:true, maintainAspectRatio:false,
        plugins:{legend:{display:false}, tooltip:{callbacks:{label:c => kpiFmt(c.parsed.y, kpi)}}},
        scales:{x:{display:false}, y:{display:false}}
      }
    });
    kpiDrillCharts.push(c);
  });
}
function closeKpiDrill(){
  document.getElementById('kpi-drill-overlay').classList.remove('open');
  kpiDrillCharts.forEach(c => c.destroy()); kpiDrillCharts = [];
}

// Filtri (panelli multi-select Brand / Store)
function kpiBuildPanel(type){
  const panel = document.getElementById('kfp-'+type);
  if(!panel) return;
  let items;
  if(type === 'brand'){
    const brands = [...new Set(ALL_STORES.map(s => s.brand))].sort((a,b) => a.localeCompare(b,'it'));
    items = brands.map(b => ({key:b, label:b, checked: kpiState.brands.has(b)}));
  } else {
    const visible = kpiState.brands.size
      ? ALL_STORES.filter(s => kpiState.brands.has(s.brand))
      : ALL_STORES;
    items = visible.map(s => {
      const k = `${s.brand}|${s.location}`;
      return {key:k, label:`${s.brand} · ${s.location}`, checked: kpiState.stores.has(k)};
    });
  }
  let html = items.map(it => `<label class="kfrow">
    <input type="checkbox" data-key="${attrEsc(it.key)}" ${it.checked?'checked':''}/>
    <span>${attrEsc(it.label)}</span>
  </label>`).join('');
  html += `<div class="kfactions">
    <button onclick="kpiSetAll('${type}', true)">Tutti</button>
    <button onclick="kpiSetAll('${type}', false)">Nessuno</button>
    <button class="primary" onclick="kpiApplyPanel('${type}')">Applica</button>
  </div>`;
  panel.innerHTML = html;
}
function toggleKpiPanel(type){
  const panel = document.getElementById('kfp-'+type);
  const wasOpen = panel.classList.contains('open');
  document.querySelectorAll('.kfpanel').forEach(p => p.classList.remove('open'));
  if(!wasOpen){ kpiBuildPanel(type); panel.classList.add('open'); }
}
function kpiSetAll(type, val){
  const panel = document.getElementById('kfp-'+type);
  panel.querySelectorAll('input[type=checkbox]').forEach(cb => cb.checked = val);
}
function kpiApplyPanel(type){
  const panel = document.getElementById('kfp-'+type);
  const set = new Set();
  panel.querySelectorAll('input[type=checkbox]:checked').forEach(cb => set.add(cb.dataset.key));
  if(type === 'brand'){
    kpiState.brands = set;
    // Pulisci store non più coerenti coi nuovi brand
    if(kpiState.stores.size){
      const valid = new Set();
      for(const k of kpiState.stores){
        const b = k.split('|')[0];
        if(!set.size || set.has(b)) valid.add(k);
      }
      kpiState.stores = valid;
    }
  } else {
    kpiState.stores = set;
  }
  panel.classList.remove('open');
  kpiUpdateFilterUI();
  // Allinea la vista Vendite (stessa tab Analisi) e salva per la prossima sessione
  syncAnalisiFiltersFromKpi();
  saveAnalisiFilters();
  renderKpiAll();
}
function kpiUpdateFilterUI(){
  const bs = kpiState.brands.size, ss = kpiState.stores.size;
  const bb = document.getElementById('kfb-brand');
  const sb = document.getElementById('kfb-store');
  if(!bb || !sb) return;
  document.getElementById('kfcnt-brand').textContent = bs ? bs : 'tutti';
  document.getElementById('kfcnt-store').textContent = ss ? ss : 'tutti';
  bb.classList.toggle('has-sel', bs > 0);
  sb.classList.toggle('has-sel', ss > 0);
}

// Master render — chiamato sia entrando in tab, sia al cambio di filtri/state
function renderKpiAll(){
  updateConsuntivoLabel();
  kpiRenderHero();
  if(kpiState.view === 'chart'){
    kpiRenderChart();
    kpiRenderRanking();
  } else {
    kpiRenderHeatmap();
  }
}

// Event bindings (registrati una volta sola al primo accesso alla tab)
let kpiBound = false;
function kpiBindEvents(){
  if(kpiBound) return;
  document.querySelectorAll('#kpi-tabs .kpi-tab').forEach(b => {
    b.onclick = () => {
      document.querySelectorAll('#kpi-tabs .kpi-tab').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      kpiState.kpi = b.dataset.kpi;
      renderKpiAll();
    };
  });
  document.querySelectorAll('#tab-kpi .kpi-pill[data-gran]').forEach(b => {
    b.onclick = () => {
      document.querySelectorAll('#tab-kpi .kpi-pill[data-gran]').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      kpiState.gran = b.dataset.gran;
      renderKpiAll();
    };
  });
  document.querySelectorAll('#tab-kpi .kpi-pill[data-range]').forEach(b => {
    b.onclick = () => {
      document.querySelectorAll('#tab-kpi .kpi-pill[data-range]').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      kpiState.range = b.dataset.range;
      const cust = document.getElementById('kpi-custom-dates');
      if(kpiState.range === 'custom'){
        const df=document.getElementById('kpi-date-from'), dt=document.getElementById('kpi-date-to');
        if(!df.value){ const d=_kpiLatestDay(); df.value=d; dt.value=d; }
        kpiState.customStart=df.value; kpiState.customEnd=dt.value||df.value;
        if(cust) cust.style.display='';
      } else if(cust){ cust.style.display='none'; }
      renderKpiAll();
    };
  });
  // Campi data del range personalizzato: ri-renderizzo appena cambiano.
  const _df=document.getElementById('kpi-date-from'), _dt=document.getElementById('kpi-date-to');
  if(_df && _dt){
    const onDate=()=>{ if(!_df.value) return; kpiState.customStart=_df.value; kpiState.customEnd=_dt.value||_df.value; kpiState.range='custom'; renderKpiAll(); };
    _df.onchange=onDate; _dt.onchange=onDate;
  }
  document.querySelectorAll('#tab-kpi .kpi-cmp').forEach(b => {
    b.onclick = () => {
      const k = b.dataset.cmp;
      if(kpiState.compare.has(k)) kpiState.compare.delete(k);
      else kpiState.compare.add(k);
      b.classList.toggle('on');
      // Solo il grafico cambia: niente bisogno di ricalcolare hero/heatmap
      if(kpiState.view === 'chart') kpiRenderChart();
    };
  });
  document.querySelectorAll('#tab-kpi .kpi-vtab').forEach(b => {
    b.onclick = () => {
      document.querySelectorAll('#tab-kpi .kpi-vtab').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      kpiState.view = b.dataset.view;
      document.getElementById('kpi-view-chart').style.display = kpiState.view === 'chart' ? '' : 'none';
      document.getElementById('kpi-view-heatmap').style.display = kpiState.view === 'heatmap' ? '' : 'none';
      renderKpiAll();
    };
  });
  const sortEl = document.getElementById('kpi-rank-sort');
  if(sortEl) sortEl.onclick = () => {
    kpiState.sort = kpiState.sort === 'val' ? 'name' : 'val';
    sortEl.textContent = kpiState.sort === 'val' ? '▾ Valore' : '▾ Nome';
    kpiRenderRanking();
  };
  // Click fuori chiude i panelli filtro KPI
  document.addEventListener('click', (e) => {
    if(e.target.closest('.kfbtn') || e.target.closest('.kfpanel')) return;
    document.querySelectorAll('.kfpanel').forEach(p => p.classList.remove('open'));
  });
  kpiBound = true;
}
// Override di renderKpiAll per assicurare il bind degli eventi al primo accesso
const _renderKpiAllOriginal = renderKpiAll;
renderKpiAll = function(){
  kpiBindEvents();
  kpiUpdateFilterUI();
  _renderKpiAllOriginal();
  _azKpiHero();
};

// Intestazione nera della tab KPI negozio. La tab non era fra le sei del
// documento di design, quindi era rimasta senza: aggiunta il 05/08/2026 per
// allinearla alle altre (segnalato dall'utente).
function _azKpiHero(){
  if(!AZ) return;
  const box = document.getElementById('kpi-hero');
  if(!box) return;
  const PERIODO = {last:'Ultimo periodo', custom:'Periodo scelto',
                   wtd:'Settimana in corso', mtd:'Mese in corso', ytd:'Anno in corso'};
  const nStore = kpiState.stores.size || ALL_STORES.length;
  box.innerHTML = azHero({
    kicker: PERIODO[kpiState.range] || 'Periodo',
    h1: 'KPI',
    accent: 'negozio',
    inline: true,
    claim: `${kpiLabel(kpiState.kpi)} · ${nStore} negoz${nStore===1?'io':'i'}`
  });
}


// ── EXPORT XLS (Andamento vendite / KPI negozio) ────────────────────────────
// Due pulsanti (uno per sezione) aprono un dialog: brand → punti vendita →
// confronti (vs Target solo Andamento, vs Anno scorso). Genera un .xlsx con 6
// fogli, uno per granularità temporale, una riga per negozio×periodo su tutto
// lo storico disponibile. SheetJS (XLSX) è già caricato in pagina.
const _EXP_MONTHS=['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'];
const _EXP_GRANS=[['giorno','Giornaliero'],['settimana','Settimanale'],['mese','Mensile'],
                  ['trimestre','Trimestrale'],['semestre','Semestrale'],['anno','Annuale']];
const _r2=n=>Math.round(n*100)/100, _r1=n=>Math.round(n*10)/10;
// Bucket temporale da una data ISO. Ritorna {k:chiave ordinabile, l:etichetta}.
function _expBucket(iso, gran){
  const [y,m,d]=iso.split('-').map(Number);
  if(gran==='giorno')     return {k:iso, l:`${String(d).padStart(2,'0')}/${String(m).padStart(2,'0')}/${y}`};
  if(gran==='mese')       return {k:`${y}-${String(m).padStart(2,'0')}`, l:`${_EXP_MONTHS[m-1]} ${y}`};
  if(gran==='trimestre'){ const q=Math.floor((m-1)/3)+1; return {k:`${y}-Q${q}`, l:`T${q} ${y}`}; }
  if(gran==='semestre'){  const s=m<=6?1:2; return {k:`${y}-S${s}`, l:`S${s} ${y}`}; }
  if(gran==='anno')       return {k:`${y}`, l:`${y}`};
  // settimana ISO (lun–dom): algoritmo standard basato sul giovedì della settimana
  const dt=new Date(Date.UTC(y,m-1,d));
  const dayNum=(dt.getUTCDay()+6)%7;            // lun=0 … dom=6
  dt.setUTCDate(dt.getUTCDate()-dayNum+3);      // giovedì di questa settimana
  const wy=dt.getUTCFullYear();
  const jan4=new Date(Date.UTC(wy,0,4));
  const wk=1+Math.round(((dt-jan4)/86400000 - 3 + ((jan4.getUTCDay()+6)%7))/7);
  return {k:`${wy}-W${String(wk).padStart(2,'0')}`, l:`Sett. ${String(wk).padStart(2,'0')} ${wy}`};
}
// Componenti KPI grezzi per negozio×giorno: consuntivo (historicalKpi) preferito,
// altrimenti derivati dal PDF di chiusura (qa). scontrini/pezzi derivati da CR/UPT
// dove il consuntivo non li ha, così l'aggregazione per periodo è sempre corretta
// (CR=Σscontrini/Σingressi, UPT=Σpezzi/Σscontrini).
function _expKpiRaw(brand, location, dateISO){
  const sk=storeKey(brand,location);
  const h=historicalKpiByKey[sk+'|'+dateISO];
  if(h){
    const walk=(h.walkIn!=null&&isFinite(h.walkIn))?+h.walkIn:null;
    let scont=(h.scontrini!=null&&isFinite(h.scontrini))?+h.scontrini:null;
    let qty=(h.quantity!=null&&isFinite(h.quantity))?+h.quantity:null;
    if(scont==null && h.cr!=null && walk!=null) scont=h.cr*walk;   // cr consuntivo = frazione
    if(qty==null && h.upt!=null && scont!=null) qty=h.upt*scont;
    if(walk!=null||scont!=null||qty!=null) return {walk,scont,qty};
  }
  const rec=allData.find(r=>r.brand===brand&&r.location===location&&r.dateISO===dateISO&&r.qa);
  if(rec){
    const g=lbl=>{const it=rec.qa.find(x=>x&&new RegExp('^'+lbl+'\\b','i').test(String(x.q||'').trim()));return it?kpiParseValue(it.a):null;};
    const walk=g('ingressi'), cr=g('cr'), upt=g('upt');
    const scont=(cr!=null&&walk!=null)?cr/100*walk:null;   // cr PDF = percentuale
    const qty=(upt!=null&&scont!=null)?upt*scont:null;
    if(walk!=null||scont!=null||qty!=null) return {walk,scont,qty};
  }
  return null;
}
// Elenco (b,l,date) distinti con KPI: consuntivo + chiusure, filtrati sui negozi scelti.
function _expKpiDays(storeSet){
  const seen=new Set(), out=[];
  for(const k in historicalKpiByKey){
    const i=k.lastIndexOf('|'); const st=ALL_STORES.find(s=>storeKey(s.brand,s.location)===k.slice(0,i));
    if(!st || !storeSet.has(st.brand+'|'+st.location)) continue;
    const date=k.slice(i+1), id=st.brand+'|'+st.location+'|'+date;
    if(seen.has(id))continue; seen.add(id); out.push({b:st.brand,l:st.location,date});
  }
  for(const r of allData){
    if(!r.dateISO||!storeSet.has(r.brand+'|'+r.location))continue;
    const id=r.brand+'|'+r.location+'|'+r.dateISO;
    if(seen.has(id))continue; seen.add(id); out.push({b:r.brand,l:r.location,date:r.dateISO});
  }
  return out;
}
function _expHeader(kind,sel){
  if(kind==='andamento'){
    const h=['Brand','Negozio','Periodo','Net Sales'];
    if(sel.vsTgt)h.push('Target','Δ% vs Target');
    if(sel.vsPy) h.push('Anno scorso','Δ% vs Anno scorso');
    return h;
  }
  const h=['Brand','Negozio','Periodo','Ingressi','CR %','UPT','Scontrini','Quantità'];
  if(sel.vsPy)h.push('Ingressi A-1','CR % A-1','UPT A-1','Scontrini A-1','Quantità A-1');
  return h;
}
function _expRow(kind,sel,a){
  if(kind==='andamento'){
    const row=[a.b,a.l,a.bl,_r2(a.net)];
    if(sel.vsTgt)row.push(a.tgt?_r2(a.tgt):'', a.tgt?_r1(a.net/a.tgt*100-100):'');
    if(sel.vsPy) row.push(a.py?_r2(a.py):'',  a.py?_r1(a.net/a.py*100-100):'');
    return row;
  }
  const cr =a.walk>0?_r1(a.scont/a.walk*100):'';
  const upt=a.scont>0?_r2(a.qty/a.scont):'';
  const row=[a.b,a.l,a.bl, a.walk>0?Math.round(a.walk):'', cr, upt,
             a.scont>0?Math.round(a.scont):'', a.qty>0?Math.round(a.qty):''];
  if(sel.vsPy){
    const pcr =a.pwalk>0?_r1(a.pscont/a.pwalk*100):'';
    const pupt=a.pscont>0?_r2(a.pqty/a.pscont):'';
    row.push(a.pwalk>0?Math.round(a.pwalk):'', pcr, pupt,
             a.pscont>0?Math.round(a.pscont):'', a.pqty>0?Math.round(a.pqty):'');
  }
  return row;
}
function _expGenerate(kind, sel){
  const wb=XLSX.utils.book_new();
  // Base per-giorno calcolata UNA volta, poi ri-aggregata per ogni granularità.
  let base=[];
  if(kind==='andamento'){
    for(const r of buildAndamentoRecords()){
      if(!sel.stores.has(r.brand+'|'+r.location))continue;
      if(!sel.years.has(r.dateISO.slice(0,4)))continue;
      const sk=storeKey(r.brand,r.location);
      base.push({b:r.brand,l:r.location,date:r.dateISO,
        net:r.netSales||0,
        tgt:+targetsByKey[sk+'|'+r.dateISO]||0,
        py:+historicalByKey[sk+'|'+shiftYearBack(r.dateISO,1)]||0});
    }
  }else{
    for(const {b,l,date} of _expKpiDays(sel.stores)){
      if(!sel.years.has(date.slice(0,4)))continue;
      const raw=_expKpiRaw(b,l,date)||{};
      const p=sel.vsPy?(_expKpiRaw(b,l,shiftYearBack(date,1))||{}):{};
      base.push({b,l,date,walk:raw.walk||0,scont:raw.scont||0,qty:raw.qty||0,
                 pwalk:p.walk||0,pscont:p.scont||0,pqty:p.qty||0});
    }
  }
  for(const [gran,sheet] of _EXP_GRANS){
    const agg=new Map();
    for(const r of base){
      const bu=_expBucket(r.date,gran), key=r.b+'|'+r.l+'|'+bu.k;
      let a=agg.get(key);
      if(!a){a={b:r.b,l:r.l,bk:bu.k,bl:bu.l,net:0,tgt:0,py:0,walk:0,scont:0,qty:0,pwalk:0,pscont:0,pqty:0};agg.set(key,a);}
      if(kind==='andamento'){a.net+=r.net;a.tgt+=r.tgt;a.py+=r.py;}
      else{a.walk+=r.walk;a.scont+=r.scont;a.qty+=r.qty;a.pwalk+=r.pwalk;a.pscont+=r.pscont;a.pqty+=r.pqty;}
    }
    const rows=[...agg.values()].sort((x,y)=>x.b.localeCompare(y.b)||x.l.localeCompare(y.l)||x.bk.localeCompare(y.bk));
    const aoa=[_expHeader(kind,sel)];
    for(const a of rows) aoa.push(_expRow(kind,sel,a));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sheet);
  }
  const ytag=[...sel.years].sort().join('-');
  XLSX.writeFile(wb, `${kind==='andamento'?'Andamento':'KPI'}_${ytag}.xlsx`);
}
// Anni presenti nei dati (per il selettore Anno), più recenti prima.
function _expAvailableYears(kind){
  const ys=new Set();
  if(kind==='andamento'){ for(const r of buildAndamentoRecords()) if(r.dateISO) ys.add(r.dateISO.slice(0,4)); }
  else{
    for(const k in historicalKpiByKey){ const i=k.lastIndexOf('|'); ys.add(k.slice(i+1,i+5)); }
    for(const r of allData) if(r.dateISO) ys.add(r.dateISO.slice(0,4));
  }
  return [...ys].filter(y=>/^\d{4}$/.test(y)).sort().reverse();
}
// Dialog: anno → brand → punti vendita (filtrati sui brand) → confronti → genera.
function openExportDialog(kind){
  const years=_expAvailableYears(kind);
  const brands=[...new Set(ALL_STORES.map(s=>s.brand))].sort((a,b)=>a.localeCompare(b));
  const ov=document.createElement('div');
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:400;display:flex;align-items:center;justify-content:center;padding:16px';
  ov.innerHTML=`<div style="background:#fff;border-radius:14px;max-width:440px;width:100%;max-height:88vh;overflow:auto;padding:18px;font-family:Nunito">
    <div style="font-weight:800;font-size:16px">Esporta ${kind==='andamento'?'Andamento vendite':'KPI negozio'}</div>
    <div style="color:#64748b;font-size:12px;margin:2px 0 14px">6 fogli (giornaliero → annuale), una riga per negozio×periodo.</div>
    <div style="font-weight:700;font-size:12px;margin-bottom:6px">Anno</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px">
      ${years.map((y,idx)=>`<label style="display:flex;align-items:center;gap:5px;font-size:13px;background:#f1f5f9;border-radius:8px;padding:5px 9px;cursor:pointer"><input type="checkbox" class="exp-year" value="${y}" ${idx===0?'checked':''}>${y}</label>`).join('')||'<div style="color:#94a3b8;font-size:12px">Nessun anno con dati</div>'}
    </div>
    <div style="font-weight:700;font-size:12px;margin-bottom:6px">Brand</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px">
      ${brands.map(b=>`<label style="display:flex;align-items:center;gap:5px;font-size:13px;background:#f1f5f9;border-radius:8px;padding:5px 9px;cursor:pointer"><input type="checkbox" class="exp-brand" value="${attrEsc(b)}" checked>${attrEsc(b)}</label>`).join('')}
    </div>
    <div style="font-weight:700;font-size:12px;margin-bottom:6px">Punti vendita</div>
    <div id="exp-stores" style="max-height:200px;overflow:auto;border:1px solid #e2e8f0;border-radius:8px;padding:8px;margin-bottom:14px"></div>
    <div style="font-weight:700;font-size:12px;margin-bottom:6px">Confronti</div>
    <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:16px">
      ${kind==='andamento'?`<label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer"><input type="checkbox" id="exp-tgt" checked> vs Target</label>`:''}
      <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer"><input type="checkbox" id="exp-py" checked> vs Anno scorso</label>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button id="exp-cancel" style="background:#f1f5f9;border:0;border-radius:8px;padding:9px 14px;font:600 13px Nunito;cursor:pointer">Annulla</button>
      <button id="exp-go" style="background:#2563eb;color:#fff;border:0;border-radius:8px;padding:9px 16px;font:700 13px Nunito;cursor:pointer">⬇ Genera XLS</button>
    </div>
  </div>`;
  document.body.appendChild(ov);
  const box=ov.querySelector('#exp-stores');
  const renderStores=()=>{
    const bs=new Set([...ov.querySelectorAll('.exp-brand:checked')].map(c=>c.value));
    const list=ALL_STORES.filter(s=>bs.has(s.brand)).sort((a,b)=>a.brand.localeCompare(b.brand)||a.location.localeCompare(b.location));
    box.innerHTML=list.length?list.map(s=>`<label style="display:flex;align-items:center;gap:6px;font-size:13px;padding:3px 0;cursor:pointer"><input type="checkbox" class="exp-store" value="${attrEsc(s.brand+'|'+s.location)}" checked> ${attrEsc(s.brand)} · ${attrEsc(s.location)}</label>`).join(''):'<div style="color:#94a3b8;font-size:12px">Nessun brand selezionato</div>';
  };
  renderStores();
  ov.querySelectorAll('.exp-brand').forEach(c=>c.onchange=renderStores);
  const close=()=>ov.remove();
  ov.onclick=e=>{if(e.target===ov)close();};
  ov.querySelector('#exp-cancel').onclick=close;
  ov.querySelector('#exp-go').onclick=()=>{
    const stores=new Set([...ov.querySelectorAll('.exp-store:checked')].map(c=>c.value));
    if(!stores.size){alert('Seleziona almeno un punto vendita.');return;}
    const yset=new Set([...ov.querySelectorAll('.exp-year:checked')].map(c=>c.value));
    if(!yset.size){alert('Seleziona almeno un anno.');return;}
    const sel={stores, years:yset, vsTgt:kind==='andamento'&&ov.querySelector('#exp-tgt')?.checked, vsPy:!!ov.querySelector('#exp-py')?.checked};
    try{ _expGenerate(kind, sel); close(); }
    catch(e){ alert('Errore export: '+(e.message||e)); }
  };
}
