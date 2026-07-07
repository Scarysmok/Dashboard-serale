// 07-negozi-altro.js — Tab Negozi (saldi, lista, popup, scheda 360, calendario, storico saldo) + account admin + export CSV
// Estratto da index.html (split del 2026-07-07). Script classici:
// tutti i file js/ condividono lo scope globale; ordine di caricamento 01→08.
// ── TAB NEGOZI (saldi cumulati per i 30 punti vendita) ──
// Mostra TUTTI i 30 negozi mappati (ALL_STORES), non solo i 20 attivi.
// Per ognuno:
//   - Se ATTIVO  → card normale: fondocassa + da-versare cumulato (calcolati
//                   dalle chiusure GoAudits ricevute) + toggle "ATTIVO"
//   - Se NON ATTIVO → card più tenue, senza valori, + toggle "NON ATTIVO"
// ── TAB NEGOZI: lista semplice negozi ──────────────────────────────────
// Mostra solo il nome del negozio per brand. Click → popup centrato con
// le 4 metriche per il range di date selezionato.
function renderStores(){
  const isAdmin = auth && auth.user && auth.user.role === 'admin';
  const grouped={};
  for(const s of ALL_STORES){
    if(!grouped[s.brand]) grouped[s.brand]=[];
    grouped[s.brand].push(s);
  }
  let html='';
  for(const [brand, stores] of Object.entries(grouped)){
    const bc=brandColor(brand);
    const tBrand=brand.replace(/'/g,"\\'");
    html+=`<div class="stores-brand-block">
      <div class="stores-brand-hd" style="background:${bc.tint}">
        <span class="stores-brand-hd-label" style="color:${bc.text}">${brand}</span>
        <span class="stores-brand-hd-count" style="color:${bc.text};opacity:.7">${stores.length} negoz${stores.length===1?'io':'i'}</span>
      </div>`;
    for(const s of stores){
      const monitored=isStoreMonitored(s.brand,s.location);
      const tLoc=s.location.replace(/'/g,"\\'");

      // Badge toggle: cliccabile solo dagli admin
      const toggleCls=`srt ${monitored?'on':'off'}${isAdmin?'':' readonly'}`;
      const toggleLabel=monitored?'Attivo':'Non attivo';
      const toggleOnClick=isAdmin
        ?`onclick="event.stopPropagation();toggleStoreActive('${tBrand}','${tLoc}')"`
        :`title="Solo admin"`;
      const toggleHtml=`<button class="${toggleCls}" ${toggleOnClick}>${toggleLabel}</button>`;

      if(monitored){
        html+=`<div class="store-row" onclick="openStorePopup('${tBrand}','${tLoc}')">
          <div class="store-row-left"><span class="store-row-name">${s.location}</span></div>
          <div class="store-row-right">${toggleHtml}<span class="store-row-arrow">›</span></div>
        </div>`;
      }else{
        // Non attivo: riga non apre popup (nessun dato), ma il toggle è accessibile
        html+=`<div class="store-row inactive-row">
          <div class="store-row-left"><span class="store-row-name dimmed">${s.location}</span></div>
          <div class="store-row-right">${toggleHtml}</div>
        </div>`;
      }
    }
    html+=`</div>`;
  }
  document.getElementById('stores-list').innerHTML=html;
}

// Mantengo il vecchio renderStores per compatibilità con il resto del codice
// (es. renderAll chiama renderStores). La funzione sopra è la nuova versione.


// Toggle attivo/non-attivo per un punto vendita (tab Negozi → click sul badge).
// Permesso: solo admin (gli editor NON possono attivare/disattivare negozi).
// Conferma esplicita prima di scrivere a backend.
//   1. Mostra confirm() con il nuovo stato target
//   2. PATCH /stores/flags { brand, location, monitored: !current }
//   3. Aggiorna lo stato locale (storeFlagsByKey) col valore restituito
//      dal backend (incluso il nuovo activeFrom alla prima attivazione)
//   4. recomputeExpected() + renderAll() — KPI / chip Mancanti / Chiusure
//      attese rispecchiano subito il nuovo stato senza bisogno di reload.
async function toggleStoreActive(brand, location){
  if(!auth || !auth.user || auth.user.role !== 'admin'){
    alert('Solo gli admin possono attivare o disattivare un negozio.');
    return;
  }
  const current = isStoreMonitored(brand, location);
  const next    = !current;
  const action  = next ? 'ATTIVARE' : 'DISATTIVARE';
  const desc    = next
    ? `Il negozio ${brand} ${location} sarà considerato attivo a partire DA OGGI: comparirà tra le chiusure attese e nei mancanti solo per le date a partire da oggi (le date precedenti restano invariate).`
    : `Il negozio ${brand} ${location} non comparirà più tra le chiusure attese giornaliere e non comparirà più tra i mancanti.`;
  if(!confirm(`Vuoi ${action} il negozio ${brand} — ${location}?\n\n${desc}`)) return;

  try{
    const r = await api('/stores/flags', {
      method:'POST',
      body: JSON.stringify({ brand, location, monitored: next }),
    });
    if(!r.ok){
      const err = await r.text();
      throw new Error(err.slice(0,200));
    }
    const data = await r.json();  // { ok, brand, location, monitored, active_from }
    // Aggiorno la mappa locale con la chiave normalizzata che usa anche il
    // backend (storeKey: brand+location lowercased + spazi compattati).
    // Salvo entrambe le info (monitored + activeFrom) dal payload del backend
    // così il frontend riflette esattamente lo stato persistito.
    const k = storeKey(brand, location);
    storeFlagsByKey[k] = {
      monitored: !!data.monitored,
      activeFrom: data.active_from || null,
    };
    recomputeExpected();
    renderAll();
    showToast(`✓ ${brand} ${location} ${data.monitored?'attivato':'disattivato'}`,'ok');
  }catch(e){
    console.error('toggleStoreActive', e);
    alert('Errore aggiornamento stato negozio: ' + (e.message||'sconosciuto'));
  }
}

// ── TAB ACCOUNT (admin only) ──
// Lista degli utenti registrati. Tre sezioni: pending (in attesa di approvazione),
// attivi (abilitati), separati per leggibilità. L'admin può: approvare/disabilitare,
// promuovere a admin / demote, eliminare. Si protegge da auto-degradazione.
async function renderAccount(){
  const wrap=document.getElementById('account-list-wrap');
  wrap.innerHTML=`<div class="empty-state"><div class="spinner" style="margin:0 auto 14px"></div><div class="empty-text">Carico utenti…</div></div>`;
  try{
    const r=await api('/admin/users');
    if(!r.ok){
      let detail='Errore '+r.status;
      try{const e=await r.json(); if(e.detail) detail=e.detail;}catch(_){}
      wrap.innerHTML=`<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-text">${detail}</div></div>`;
      return;
    }
    const users=await r.json();
    const pending=users.filter(u=>!u.enabled);
    const active=users.filter(u=>u.enabled);

    const formatDate=iso=>{try{const d=new Date(iso);return d.toLocaleDateString('it-IT',{day:'2-digit',month:'short',year:'numeric'})+' '+d.toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'});}catch(e){return iso;}};
    const buildRow=(u)=>{
      const isMe=auth.user && u.id===auth.user.id;
      const meTag=isMe?' <span class="account-badge admin">Tu</span>':'';
      // Tag ruolo: admin (viola), editor (azzurro), user (nessun tag = sola lettura)
      let roleTag='';
      if(u.role==='admin')      roleTag='<span class="account-badge admin">Admin</span>';
      else if(u.role==='editor')roleTag='<span class="account-badge editor">Editor</span>';
      const stateTag=u.enabled?'<span class="account-badge active">Attivo</span>':'<span class="account-badge pending">In attesa</span>';
      let actions='';
      if(!u.enabled){
        actions += `<button class="acct-btn approve" onclick="approveUser('${u.id}')">✓ Approva</button>`;
        actions += `<button class="acct-btn deny" onclick="deleteAccount('${u.id}','${u.username.replace(/'/g,"\\'")}')">✕ Rifiuta</button>`;
      }else if(!isMe){
        // Transizioni di ruolo possibili dallo stato corrente:
        if(u.role==='admin'){
          actions += `<button class="acct-btn" onclick="demoteAdmin('${u.id}')">Rimuovi admin</button>`;
        }else if(u.role==='editor'){
          actions += `<button class="acct-btn promote" onclick="promoteAdmin('${u.id}')">Promuovi admin</button>`;
          actions += `<button class="acct-btn" onclick="demoteToUser('${u.id}')">Rimuovi editor</button>`;
        }else{
          // role === 'user' (sola lettura)
          actions += `<button class="acct-btn promote" onclick="promoteEditor('${u.id}')">Promuovi a editor</button>`;
          actions += `<button class="acct-btn promote" onclick="promoteAdmin('${u.id}')">Promuovi admin</button>`;
        }
        actions += `<button class="acct-btn deny" onclick="disableUser('${u.id}')">Disabilita</button>`;
        actions += `<button class="acct-btn deny" onclick="deleteAccount('${u.id}','${u.username.replace(/'/g,"\\'")}')">Elimina</button>`;
      }
      return `<div class="account-row">
        <div class="account-info">
          <div class="account-name">${u.username}${meTag} ${roleTag} ${stateTag}</div>
          <div class="account-email">${u.email}</div>
          <div class="account-meta">Registrato il ${formatDate(u.created_at)}</div>
        </div>
        <div class="account-actions">${actions}</div>
      </div>`;
    };

    let html='';
    if(pending.length){
      html+=`<div class="account-section"><div class="account-section-title">In attesa di approvazione<span>${pending.length}</span></div>${pending.map(buildRow).join('')}</div>`;
    }
    if(active.length){
      html+=`<div class="account-section"><div class="account-section-title">Utenti attivi<span>${active.length}</span></div>${active.map(buildRow).join('')}</div>`;
    }
    if(!users.length){
      html=`<div class="empty-state"><div class="empty-icon">👥</div><div class="empty-text">Nessun utente registrato</div></div>`;
    }
    wrap.innerHTML=html;
  }catch(e){
    wrap.innerHTML=`<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-text">Errore di rete: ${e.message||e}</div></div>`;
  }
}

// Estrae un messaggio leggibile dal body di una risposta di errore FastAPI.
// detail può essere:
//  - stringa: HTTPException(detail="...")
//  - array di oggetti: errori di validazione pydantic (422), uno per campo
//  - oggetto: form atipici → fallback a JSON.stringify
async function readErrorDetail(res){
  try{
    const e=await res.json();
    if(e==null) return 'Errore '+res.status;
    if(typeof e.detail === 'string') return e.detail;
    if(Array.isArray(e.detail)){
      // [{loc:[...], msg:"...", type:"..."}, ...]
      return e.detail.map(it=>{
        const loc = Array.isArray(it.loc) ? it.loc.slice(-1)[0] : '';
        return (loc?loc+': ':'') + (it.msg || JSON.stringify(it));
      }).join(' · ');
    }
    if(e.detail) return JSON.stringify(e.detail);
    return JSON.stringify(e).slice(0, 300);
  }catch(_){
    return 'Errore '+res.status;
  }
}

async function _updateUser(userId, payload, label){
  const r=await api(`/admin/users/${userId}`,{method:'PUT',body:JSON.stringify(payload)});
  if(!r.ok){
    const detail=await readErrorDetail(r);
    alert((label||'Aggiornamento')+' fallito: '+detail);
    return false;
  }
  await renderAccount();
  return true;
}
async function approveUser(id){await _updateUser(id,{enabled:true},'Approvazione');}
async function disableUser(id){
  if(!confirm('Disabilitare questo utente? Non potrà più accedere finché non lo riapprovi.'))return;
  await _updateUser(id,{enabled:false},'Disabilitazione');
}
async function promoteAdmin(id){
  if(!confirm('Promuovere questo utente ad admin? Avrà accesso a questa stessa tab e potrà gestire altri utenti.'))return;
  await _updateUser(id,{role:'admin'},'Promozione admin');
}
async function demoteAdmin(id){
  if(!confirm('Rimuovere i privilegi admin a questo utente? Tornerà a essere un utente in sola lettura.'))return;
  await _updateUser(id,{role:'user'},'Rimozione admin');
}
async function promoteEditor(id){
  if(!confirm('Promuovere questo utente a editor? Potrà modificare i valori cassa (correzioni manuali).'))return;
  await _updateUser(id,{role:'editor'},'Promozione editor');
}
async function demoteToUser(id){
  if(!confirm('Rimuovere i privilegi editor? L\'utente potrà solo leggere i dati.'))return;
  await _updateUser(id,{role:'user'},'Rimozione editor');
}
async function deleteAccount(id, username){
  if(!confirm(`Eliminare definitivamente l'account "${username}"?\nL'azione non può essere annullata.`))return;
  const r=await api(`/admin/users/${id}`,{method:'DELETE'});
  if(!r.ok){
    let detail='Errore '+r.status;
    try{const e=await r.json();if(e.detail)detail=e.detail;}catch(_){}
    alert('Eliminazione fallita: '+detail);
    return;
  }
  await renderAccount();
}

// ── POPUP NEGOZIO + CALENDARIO DATE RANGE ──────────────────────────────

// ── SCHEDA NEGOZIO 360° ──
// Sostituisce il vecchio popup a bottoni: un'unica vista scrollabile nel
// bottom-sheet con metriche del range, trend NET 30 giorni, saldo versamenti
// e ultime chiusure. Tap su una metrica → storico giornaliero di quel valore.
function openStorePopup(brand, location){
  const k=storeKey(brand,location);
  let records=allData.filter(r=>storeKey(r.brand,r.location)===k && r.dateISO);

  // Filtra per range se selezionato
  if(storeRange.from){
    const f=storeRange.from, t=storeRange.to||storeRange.from;
    records=records.filter(r=>r.dateISO>=f && r.dateISO<=t);
  }

  // Fondo cassa = ultimo disponibile nel range
  const sorted=[...records].sort((a,b)=>b.dateISO.localeCompare(a.dateISO));
  const latestFondo=sorted.length ? (sorted[0].fondo||0) : null;
  const sumCorr=records.reduce((a,r)=>a+(r.corrispettivo||0),0);
  const sumPOS=records.reduce((a,r)=>a+(r.pos||0),0);
  const sumCash=records.reduce((a,r)=>a+(r.contanti||0),0);
  const noData=records.length===0;

  const subLabel=storeRange.from
    ? (storeRange.from===storeRange.to
        ? storeRange.from.split('-').reverse().join('/')
        : `${storeRange.from.split('-').reverse().join('/')} → ${storeRange.to.split('-').reverse().join('/')}`)
    : (records.length ? `${records.length} chiusur${records.length===1?'a':'e'} totali` : 'Nessuna chiusura');

  // Versamenti: sempre su tutto lo storico disponibile (come la vista saldo)
  const allRecs=allData.filter(r=>storeKey(r.brand,r.location)===k && r.dateISO);
  const sumDV=allRecs.reduce((s,r)=>s+(r.daVersare||0),0);
  const sumV=allRecs.reduce((s,r)=>s+(r.versato||0),0);
  const saldo=sumDV-sumV;
  const saldoCls=saldo>0.01?'r':(saldo<-0.01?'g':'');

  document.getElementById('sheet-title').textContent=location;
  document.getElementById('sheet-sub').textContent=brand+' · '+subLabel;

  const mB=brand.replace(/'/g,"\\'"), mL=location.replace(/'/g,"\\'");
  const metric=(icon,label,value)=>{
    const v=(value===null)
      ?`<div class="s360-metric-v nodata">—</div>`
      :`<div class="s360-metric-v">${fmt(value)}</div>`;
    return `<button class="s360-metric" onclick="openStoreMetricSheet('${mB}','${mL}','${label}')">
      <div class="s360-metric-l">${icon} ${label}</div>${v}
    </button>`;
  };

  // Ultime chiusure (max 7 nel range selezionato) → tap apre il dettaglio
  let recent='';
  for(const r of sorted.slice(0,7)){
    const idx=allData.indexOf(r);
    recent+=`<div class="saldo-row" onclick="openSheet(${idx})">
      <div>
        <div class="saldo-row-date">${r.dateDisplay}${r.anomaly?' <span style="color:var(--red)">⚠</span>':''}</div>
        <div class="saldo-row-detail">Contanti ${fmt(r.contanti)} · POS ${fmt(r.pos)}</div>
      </div>
      <div class="saldo-row-delta n">${fmt(r.corrispettivo)}</div>
    </div>`;
  }

  document.getElementById('sheet-rows').innerHTML=`
    <div class="s360-metrics">
      ${metric('🏦','Fondo cassa',latestFondo)}
      ${metric('🧾','Corrispettivo',noData?null:sumCorr)}
      ${metric('💳','Incassato POS',noData?null:sumPOS)}
      ${metric('💵','Incassato contanti',noData?null:sumCash)}
    </div>
    <div class="s360-chart-wrap">
      <div class="s360-chart-title"><span>Ultimi 30 giorni</span><span>NET giornaliero</span></div>
      <div class="s360-chart-box"><canvas id="s360-canvas"></canvas></div>
    </div>
    <div class="s360-saldo">
      <div class="s360-saldo-cell"><div class="saldo-summary-l">Da versare</div><div class="saldo-summary-v w">${fmt(sumDV)}</div></div>
      <div class="s360-saldo-cell"><div class="saldo-summary-l">Versato</div><div class="saldo-summary-v b">${fmt(sumV)}</div></div>
      <div class="s360-saldo-cell"><div class="saldo-summary-l">Saldo</div><div class="saldo-summary-v ${saldoCls}">${fmt(saldo)}</div></div>
    </div>
    <button class="s360-row-btn" onclick="openStoreSheet('${mB}','${mL}')"><span>🏦 Storico versamenti per settimana</span><span>›</span></button>
    ${recent?`<div class="sheet-row divider"><span>Ultime chiusure</span></div>${recent}`:''}
  `;
  document.getElementById('sheet').classList.add('show');
  _renderS360Chart(k);
}

// Trend NET ultimi 30 giorni del negozio: unione storico Excel + PDF GoAudits
// (l'Excel vince sul giorno in overlap, stessa regola della tab Analisi).
let _s360Chart=null;
function _renderS360Chart(k){
  const cv=document.getElementById('s360-canvas');
  if(!cv) return;
  if(_s360Chart){ try{_s360Chart.destroy();}catch(_){} _s360Chart=null; }
  const noChartMsg=(msg)=>{ cv.parentElement.innerHTML=`<div style="padding:20px;font-size:12px;color:var(--t3);text-align:center">${msg}</div>`; };
  if(typeof Chart==='undefined'){ noChartMsg('Grafico non disponibile'); return; }
  const days=[];
  for(let i=29;i>=0;i--){
    const d=new Date(); d.setDate(d.getDate()-i);
    days.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`);
  }
  const byDay={};
  for(const day of days){
    const hv=+historicalByKey[k+'|'+day]||0;
    if(hv>0) byDay[day]=hv;
  }
  for(const r of allData){
    if(!r.dateISO || storeKey(r.brand,r.location)!==k) continue;
    if(byDay[r.dateISO]!=null) continue;
    if(r.dateISO<days[0] || r.dateISO>days[days.length-1]) continue;
    byDay[r.dateISO]=(+r.netSales)||((+r.corrispettivo||0)/1.22);
  }
  const labels=days.map(d=>d.slice(8,10)+'/'+d.slice(5,7));
  const data=days.map(d=>byDay[d]!=null?+byDay[d].toFixed(2):null);
  if(!data.some(v=>v!=null)){ noChartMsg('Nessun dato negli ultimi 30 giorni'); return; }
  _s360Chart=new Chart(cv.getContext('2d'),{
    type:'bar',
    data:{labels,datasets:[{data,backgroundColor:'#2563eb',borderRadius:3}]},
    options:{
      responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>fmt(c.parsed.y)}}},
      scales:{
        x:{ticks:{font:{family:'Nunito',size:8},maxTicksLimit:8},grid:{display:false}},
        y:{ticks:{font:{family:'Nunito',size:9},callback:v=>v>=1000?'€'+(v/1000).toFixed(0)+'k':'€'+v},grid:{color:'#eaecef'}}
      }
    }
  });
}

function closeStorePopup(){
  document.getElementById('store-popup-overlay').classList.remove('show');
}

// Tap su un pulsante metrica → chiude popup e apre storico giornaliero
function openStoreMetricSheet(brand, location, metric){
  closeStorePopup();

  const k=storeKey(brand,location);
  let records=allData
    .filter(r=>storeKey(r.brand,r.location)===k && r.dateISO)
    .sort((a,b)=>b.dateISO.localeCompare(a.dateISO));

  // Applica filtro range date se attivo
  if(storeRange.from){
    const f=storeRange.from, t=storeRange.to||storeRange.from;
    records=records.filter(r=>r.dateISO>=f && r.dateISO<=t);
  }

  // Configurazione per ogni metrica
  const METRICS={
    'Fondo cassa':       {field:'fondo',       isSum:false, color:'',  label:'Fondo cassa',       note:'Valore nel cassetto a fine giornata'},
    'Corrispettivo':     {field:'corrispettivo',isSum:true,  color:'g', label:'Corrispettivo',     note:'Lordo IVA 22%'},
    'Incassato POS':     {field:'pos',          isSum:true,  color:'b', label:'Incassato POS',     note:''},
    'Incassato contanti':{field:'contanti',     isSum:true,  color:'g', label:'Incassato contanti',note:''},
  };
  const cfg=METRICS[metric]||{field:metric,isSum:true,color:'',label:metric,note:''};

  document.getElementById('sheet-title').textContent=`${cfg.label} · ${location}`;
  document.getElementById('sheet-sub').textContent=brand
    +(storeRange.from
      ? ` · ${storeRange.from.split('-').reverse().join('/')}${storeRange.from!==storeRange.to?' → '+storeRange.to.split('-').reverse().join('/') : ''}`
      : '');

  if(!records.length){
    document.getElementById('sheet-rows').innerHTML=`<div class="empty-state"><div class="empty-icon">📭</div><div class="empty-text">Nessun dato nel periodo selezionato</div></div>`;
    document.getElementById('sheet').classList.add('show');
    return;
  }

  // Totale o ultimo valore
  const total = cfg.isSum
    ? records.reduce((a,r)=>a+(r[cfg.field]||0),0)
    : (records[0][cfg.field]||0); // primo = più recente
  const totalLabel = cfg.isSum ? 'Totale periodo' : 'Ultimo valore';

  const GIORNI=['Dom','Lun','Mar','Mer','Gio','Ven','Sab'];
  let html=`
    <div class="sheet-row" style="background:var(--s2);padding:10px 20px 8px">
      <span style="font-size:11px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.5px">${totalLabel}</span>
      <span class="row-v ${cfg.color}" style="font-size:18px">${fmt(total)}</span>
    </div>
    ${cfg.note?`<div style="padding:6px 20px 2px;font-size:11px;color:var(--t3)">${cfg.note}</div>`:''}
    <div class="sheet-row" style="background:var(--s2);padding:7px 20px">
      <span style="font-size:11px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.5px">Storico giornaliero</span>
    </div>`;

  for(const r of records){
    const val=r[cfg.field]||0;
    const d=new Date(r.dateISO+'T12:00:00');
    const dow=GIORNI[d.getDay()];
    html+=`<div class="sheet-row">
      <div>
        <div style="font-size:13px;font-weight:600">${r.dateDisplay}</div>
        <div style="font-size:11px;color:var(--t3)">${dow}</div>
      </div>
      <span class="row-v ${cfg.color}">${fmt(val)}</span>
    </div>`;
  }

  const bB=brand.replace(/'/g,"\\'"), bL=location.replace(/'/g,"\\'");
  html+=`<div style="padding:16px"><button class="settings-btn" onclick="openStorePopup('${bB}','${bL}')">← Torna alla scheda negozio</button></div>`;

  document.getElementById('sheet-rows').innerHTML=html;
  document.getElementById('sheet').classList.add('show');
}

// Versamenti → apre lo sheet storico Da versare / Versato / Saldo
function openStoreVersamenti(){
  const overlay=document.getElementById('store-popup-overlay');
  const brand=overlay.dataset.brand||'';
  const location=overlay.dataset.location||'';
  closeStorePopup();
  openStoreSheet(brand, location);
}

// ── CALENDARIO DATE RANGE ────────────────────────────────────────────────

function openCalendar(){
  const now=new Date();
  calState.year=now.getFullYear();
  calState.month=now.getMonth();
  calState.from=storeRange.from;
  calState.to=storeRange.to;
  _renderCal();
  document.getElementById('cal-overlay').classList.add('show');
}
function closeCalendar(){
  document.getElementById('cal-overlay').classList.remove('show');
}
function calNav(dir){
  calState.month+=dir;
  if(calState.month<0){calState.month=11;calState.year--;}
  if(calState.month>11){calState.month=0;calState.year++;}
  _renderCal();
}
function calReset(){
  calState.from=null; calState.to=null;
  _renderCal();
}
function _renderCal(){
  const {year,month,from,to}=calState;
  const MESI=['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
  document.getElementById('cal-month-title').textContent=`${MESI[month]} ${year}`;

  const hint=document.getElementById('cal-hint');
  if(!from) hint.textContent='Tocca un giorno per selezionare';
  else if(!to) hint.textContent='Tocca un secondo giorno per il range, o lo stesso per un singolo giorno';
  else{
    const fd=from.split('-'), td=to.split('-');
    hint.textContent=from===to
      ?`Giorno: ${fd[2]}/${fd[1]}/${fd[0]}`
      :`${fd[2]}/${fd[1]}/${fd[0]} → ${td[2]}/${td[1]}/${td[0]}`;
  }

  const applyBtn=document.getElementById('cal-btn-apply');
  applyBtn.disabled=!from;

  const tod=_isoToday();
  const firstDow=new Date(year,month,1).getDay();
  const startOffset=firstDow===0?6:firstDow-1;
  const daysInMonth=new Date(year,month+1,0).getDate();

  // Intestazioni giorni (stessa griglia dei numeri = allineamento garantito)
  const DOW=['L','M','M','G','V','S','D'];
  let html=DOW.map(l=>`<div class="cal-dow-cell">${l}</div>`).join('');

  // Celle vuote prima del primo giorno del mese
  for(let i=0;i<startOffset;i++) html+=`<button class="cal-day other-month" disabled></button>`;

  for(let d=1;d<=daysInMonth;d++){
    const iso=`${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    let cls='cal-day';
    if(iso===tod) cls+=' today';
    if(from&&to){
      if(iso===from&&iso===to) cls+=' sel-start sel-end sel-single';
      else if(iso===from)      cls+=' sel-start';
      else if(iso===to)        cls+=' sel-end';
      else if(iso>from&&iso<to) cls+=' in-range';
    } else if(from&&iso===from){
      cls+=' sel-start sel-single';
    }
    html+=`<button class="${cls}" onclick="calPickDay('${iso}')">${d}</button>`;
  }
  document.getElementById('cal-main-grid').innerHTML=html;
}

function calPickDay(iso){
  const {from,to}=calState;
  if(!from||(from&&to)){
    // Primo tap: imposta inizio, azzera fine
    calState.from=iso; calState.to=null;
    _renderCal();
  } else {
    // Secondo tap: completa il range
    if(iso===from)       { calState.to=iso; }
    else if(iso<from)    { calState.to=from; calState.from=iso; }
    else                 { calState.to=iso; }
    _renderCal();
    // Auto-applica dopo breve pausa (l'utente vede la selezione prima che chiuda)
    setTimeout(applyCalendar, 220);
  }
}

function applyCalendar(){
  if(!calState.from) return;
  storeRange.from=calState.from;
  storeRange.to=calState.to||calState.from;
  _updateDatePill();
  closeCalendar();
  renderStores();
}

function resetStoreRange(){
  storeRange={from:null,to:null};
  _updateDatePill();
  renderStores();
}

function _updateDatePill(){
  const pill=document.getElementById('date-range-pill');
  const txt=document.getElementById('drp-text');
  const rst=document.getElementById('drp-reset');
  if(!storeRange.from){
    txt.textContent='Tutte le date';
    pill.classList.remove('rng-active');
    rst.classList.remove('show');
  } else {
    const f=storeRange.from.split('-'), t=storeRange.to.split('-');
    txt.textContent=storeRange.from===storeRange.to
      ?`${f[2]}/${f[1]}/${f[0]}`
      :`${f[2]}/${f[1]} → ${t[2]}/${t[1]}`;
    pill.classList.add('rng-active');
    rst.classList.add('show');
    document.getElementById('drp-reset').style.color='#e2231a';
  }
}

function _isoToday(){
  const n=new Date();
  return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`;
}

// ── SHEET STORICO SALDO (cliccando una card della tab Negozi) ──
// Layout:
//   [Riepilogo: DV totale | V totale | Saldo]
//   [Settimana corrente (in corso) — sempre espansa con righe giornaliere]
//   [Settimana N — collassata, cliccabile per espandere le righe giornaliere]
//   [...altre settimane collassate, anche vuote]
function openStoreSheet(brand, location){
  const k=storeKey(brand,location);
  const records=allData
    .filter(r=>storeKey(r.brand,r.location)===k && r.dateISO)
    .sort((a,b)=>b.dateISO.localeCompare(a.dateISO));

  const sumDV=records.reduce((s,r)=>s+(r.daVersare||0),0);
  const sumV=records.reduce((s,r)=>s+(r.versato||0),0);
  const saldo=sumDV-sumV;
  const bc=brandColor(brand);

  document.getElementById('sheet-title').textContent=`${brand} ${location}`;
  document.getElementById('sheet-sub').textContent=records.length
    ? `${records.length} chiusur${records.length===1?'a':'e'} ricevut${records.length===1?'a':'e'}`
    : 'Nessuna chiusura ricevuta ancora';

  const saldoCls = saldo>0.01 ? 'r' : (saldo<-0.01 ? 'g' : '');
  let html = `<div class="saldo-summary">
    <div class="saldo-summary-cell">
      <div class="saldo-summary-l">Da versare</div>
      <div class="saldo-summary-v w">${fmt(sumDV)}</div>
    </div>
    <div class="saldo-summary-cell">
      <div class="saldo-summary-l">Versato</div>
      <div class="saldo-summary-v b">${fmt(sumV)}</div>
    </div>
    <div class="saldo-summary-cell" style="background:${bc.tint}">
      <div class="saldo-summary-l" style="color:${bc.text}">Saldo</div>
      <div class="saldo-summary-v ${saldoCls}">${fmt(saldo)}</div>
    </div>
  </div>`;

  if(!records.length){
    html += `<div class="empty-state"><div class="empty-icon">📭</div>
      <div class="empty-text">Nessun movimento da mostrare</div></div>`;
    document.getElementById('sheet-rows').innerHTML=html;
    document.getElementById('sheet').classList.add('show');
    return;
  }

  // 1) Raggruppa i record per settimana ISO (chiave "YYYY-WW")
  const byWeek=new Map();
  for(const r of records){
    const {year,week}=isoWeek(r.dateISO);
    const key=`${year}-${String(week).padStart(2,'0')}`;
    if(!byWeek.has(key)){
      const [mon,sun]=isoWeekRange(year,week);
      byWeek.set(key,{key,year,week,mon,sun,records:[],sumDV:0,sumV:0});
    }
    const w=byWeek.get(key);
    w.records.push(r);
    w.sumDV+=r.daVersare||0;
    w.sumV +=r.versato||0;
  }

  // 2) Determina range completo di settimane da mostrare:
  //    da quella della chiusura più vecchia, fino a max(settimana ultima chiusura, settimana corrente)
  const todayISO=(()=>{
    const t=new Date();
    return `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`;
  })();
  const curW=isoWeek(todayISO);
  const oldestISO=records[records.length-1].dateISO;
  const newestISO=records[0].dateISO;
  const oldestW=isoWeek(oldestISO);
  const newestW=isoWeek(newestISO);
  // End = la più recente tra newestW e curW
  const endW = (curW.year>newestW.year || (curW.year===newestW.year && curW.week>newestW.week)) ? curW : newestW;

  // Itero a ritroso dalla settimana finale a quella più vecchia (incluse vuote)
  const [endMon]=isoWeekRange(endW.year,endW.week);
  const [startMon]=isoWeekRange(oldestW.year,oldestW.week);
  const allWeeks=[];
  for(let cur=new Date(endMon); cur>=startMon; cur.setUTCDate(cur.getUTCDate()-7)){
    const iso=`${cur.getUTCFullYear()}-${String(cur.getUTCMonth()+1).padStart(2,'0')}-${String(cur.getUTCDate()).padStart(2,'0')}`;
    const {year,week}=isoWeek(iso);
    const key=`${year}-${String(week).padStart(2,'0')}`;
    const isCurrent = year===curW.year && week===curW.week;
    if(byWeek.has(key)){
      allWeeks.push({...byWeek.get(key), isCurrent});
    }else{
      const [mon,sun]=isoWeekRange(year,week);
      allWeeks.push({key,year,week,mon,sun,records:[],sumDV:0,sumV:0,isCurrent});
    }
  }

  // 3) Render: settimana corrente con righe giornaliere espanse, le passate collassate
  for(const w of allWeeks){
    const wDelta = w.sumDV - w.sumV;
    const wCls = wDelta>0.01 ? 'r' : (wDelta<-0.01 ? 'g' : 'n');
    const wPref = wDelta>0.01 ? '+' : '';
    const range = fmtWeekRange(w.mon, w.sun);
    const isEmpty = w.records.length===0;

    if(w.isCurrent){
      // Settimana corrente: sempre espansa, no clic per collassare
      const subtitle = isEmpty ? 'in corso · nessuna chiusura ancora' : `in corso · ${w.records.length} chiusur${w.records.length===1?'a':'e'}`;
      html += `<div class="sheet-row divider"><span>Settimana ${w.week} · ${range} · ${subtitle}</span></div>`;
      for(const r of w.records) html += _buildDayRow(r);
    }else{
      // Settimana passata: riga collassata
      const detail = isEmpty
        ? 'Nessuna chiusura'
        : `Da versare ${fmt(w.sumDV)} · Versato ${fmt(w.sumV)} · ${w.records.length} giorn${w.records.length===1?'o':'i'}`;
      html += `<div class="week-row${isEmpty?' empty':''}" data-wk="${w.key}"${isEmpty?'':` onclick="toggleWeek('${w.key}')"`}>
        <div>
          <div class="week-label">Settimana ${w.week} · ${range}</div>
          <div class="week-detail">${detail}</div>
        </div>
        <div class="week-delta-wrap">
          ${isEmpty?'':'<span class="week-chev">▶</span>'}
          <span class="week-delta-val ${wCls}">${wPref}${fmt(wDelta)}</span>
        </div>
      </div>`;
      if(!isEmpty){
        html += `<div class="week-days" data-wk="${w.key}" style="display:none">`;
        for(const r of w.records) html += _buildDayRow(r);
        html += `</div>`;
      }
    }
  }

  const vB=brand.replace(/'/g,"\\'"), vL=location.replace(/'/g,"\\'");
  html+=`<div style="padding:16px"><button class="settings-btn" onclick="openStorePopup('${vB}','${vL}')">← Torna alla scheda negozio</button></div>`;

  document.getElementById('sheet-rows').innerHTML=html;
  document.getElementById('sheet').classList.add('show');
}

// ── EXPORT CSV ──
// Formato "wide": una riga per negozio+data, una colonna per ogni domanda
// della checklist (28 in totale). Le colonne Q&A vengono ricavate dall'unione
// delle domande viste in tutti i record, ordinate per numero (1..28).
function exportCSV(){
  if(!allData.length){alert('Nessun dato.');return;}

  // 1) Costruisci elenco unione delle domande, prendendo il testo della
  //    domanda dal primo record che la contiene. Così se un PDF è incompleto
  //    o ha varianti minori, prevale comunque la versione "canonica" trovata.
  const qMap=new Map(); // n -> "N. Testo domanda"
  for(const r of allData){
    if(!r.qa) continue;
    for(const item of r.qa){
      if(!qMap.has(item.n)) qMap.set(item.n, `${item.n}. ${item.q}`);
    }
  }
  const ns=[...qMap.keys()].sort((a,b)=>a-b);
  const qaHeaders=ns.map(n=>qMap.get(n));

  // 2) Header completo: identificativi + KPI riassuntivi + tutte le Q&A
  const H=['Brand','Location','Data Incasso',
           'Corrispettivo','Net Sales','Contanti','POS','Versato','Fondo Cassa',
           'Cambi','Giftcard','Annullamenti','Buono Emesso','Buono Ritirato',
           'Sconti su Vendite','Anomalia','Delta Cassa',
           ...qaHeaders];

  // 3) Una riga per record, valori Q&A presi dal map per numero
  const rows=allData.map(r=>{
    const aMap={};
    if(r.qa){for(const item of r.qa) aMap[item.n]=item.a;}
    const num=v=>(+v||0).toFixed(2);
    const base=[
      r.brand, r.location, r.dateDisplay,
      num(r.corrispettivo), num((+r.corrispettivo||0)/1.22),
      num(r.contanti), num(r.pos), num(r.versato), num(r.fondo),
      num(r.cambi), num(r.giftcard), num(r.annull),
      num(r.buonoE), num(r.buonoR), num(r.sconti),
      r.anomaly?'Sì':'No', num(r.diff)
    ];
    const qaVals=ns.map(n=>aMap[n]||'');
    return [...base, ...qaVals];
  });

  // 4) Escape CSV: virgolette doppie + rimozione newline interni alle risposte
  const esc=v=>`"${String(v==null?'':v).replace(/"/g,'""').replace(/[\r\n]+/g,' ')}"`;
  const csv=[H,...rows].map(r=>r.map(esc).join(';')).join('\n');

  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'}));
  a.download=`chiusure_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  showToast('✓ CSV esportato','ok');
}
