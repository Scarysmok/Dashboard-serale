// 04-dashboard.js — renderAll + home Oggi + pull-to-refresh + KPI header
// Estratto da index.html (split del 2026-07-07). Script classici:
// tutti i file js/ condividono lo scope globale; ordine di caricamento 01→08.
// ── RENDER ALL ──
function renderAll(){
  // Default intelligente: alla prima sincronizzazione con dati, la tab
  // Chiusure parte dall'ultima giornata disponibile invece di "Tutte le date"
  // (i totali cumulati di tutto lo storico non rispondono alla domanda
  // quotidiana "com'è andata?"). Applicato una sola volta: dopo, l'utente
  // può scegliere "Tutte le date" senza che il sync glielo re-imposti.
  if(!_dateAutoDone && allData.length){
    _dateAutoDone=true;
    if(!filterDate){
      const dates=availableDates();
      filterDate=dates[dates.length-1]||null;
      const chip=document.getElementById('chip-date');
      if(chip && filterDate){
        const [y,m,dd]=filterDate.split('-');
        chip.textContent=`📅 ${dd}/${m}/${y}`;
        chip.classList.add('on');
      }
    }
  }
  updateMissingChip();renderKPI();renderCards();updateDateNav();
  // Vista Aperture: se attiva, ridisegna (i dati possono cambiare a ogni sync)
  if(vistaNegozi==='aperture'){ try{ renderAperture(); }catch(_){} }
  // La home "Oggi" si aggiorna se visibile (è la tab di default)
  const oggiTab=document.getElementById('tab-oggi');
  if(oggiTab && oggiTab.style.display!=='none') renderOggi();
  // Se la tab "Negozi" (saldi) è attiva, ricalcola i totali con i nuovi dati
  const storesTab=document.getElementById('tab-stores');
  if(storesTab && storesTab.style.display==='block') renderStores();
  // Se la tab "Andamento" è attiva, ridisegna pure (può cambiare il dataset
  // con nuovo storico o nuove chiusure parsate)
  const tempoTab=document.getElementById('tab-tempo');
  if(tempoTab && tempoTab.style.display==='block') renderTempo();
  // Se la tab "KPI" è attiva, ricarica anche quella (i nuovi PDF possono
  // portare nuovi valori per Q25/26/27).
  const kpiTab=document.getElementById('tab-kpi');
  if(kpiTab && kpiTab.style.display==='block') renderKpiAll();
}

// Restituisce i record filtrati per la data selezionata (o tutti)
function getFilteredData(){
  return filterDate ? allData.filter(r=>r.dateISO===filterDate) : allData;
}

// ── TAB OGGI (home: riepilogo della giornata) ───────────────────────────
// Giornata di riferimento: oggi se ci sono già chiusure odierne, altrimenti
// l'ultima giornata con dati (tipicamente ieri, finché le chiusure della sera
// non arrivano). Tutte le informazioni rispondono alla domanda "com'è andata?"
// senza dover toccare filtri.
let _oggiRefDate=null;
function renderOggi(){
  const el=document.getElementById('oggi-content');
  if(!el) return;
  if(!allData.length){
    // Chiusure non ancora arrivate (cold start Render): mostro comunque la
    // sezione Aperture se ho dati (preload dalla cache locale o syncAperture
    // già completato), così non "sparisce" a ogni avvio. Il riepilogo chiusure
    // arriva col primo renderAll. Con allData vuoto il confronto fondo cassa
    // non ha termine di paragone: le eventuali anomalie fondo compaiono dopo.
    const ap=_aperturaSectionHTML();
    if(ap) el.innerHTML=ap+'<div style="padding:14px 16px;font-size:12.5px;color:var(--t3)">Riepilogo chiusure in caricamento…</div>';
    return;
  }
  const dates=availableDates();
  const todayISO=_isoToday();
  const refDate=dates.includes(todayISO)?todayISO:dates[dates.length-1];
  _oggiRefDate=refDate;
  const recs=allData.filter(r=>r.dateISO===refDate);
  const missing=getMissingStores(refDate);
  const expectedCount=recs.length+missing.length;
  const totCorr=recs.reduce((a,r)=>a+r.corrispettivo,0);
  const totNet=totCorr/1.22;
  const totCash=recs.reduce((a,r)=>a+r.contanti,0);
  const anomalie=recs.filter(r=>r.anomaly);

  // Badge vs target / vs anno scorso (stessa logica e soglie delle altre tab)
  const tgtD=periodTargetData(recs);
  const pyD=periodPyData(recs);
  const badge=(delta,label)=>{
    const cls=delta>=-5?'green':(delta>=-30?'yellow':'red');
    const sign=delta>=0?'+':'';
    return `<span class="am-badge ${cls}">${sign}${delta.toLocaleString('it-IT',{minimumFractionDigits:1,maximumFractionDigits:1})}% ${label}</span>`;
  };
  let badges='';
  if(tgtD) badges+=badge(tgtD.pct-100,'vs target');
  if(pyD)  badges+=badge(pyD.pct-100,'vs anno scorso');
  if(!badges) badges='<span class="am-badge muted">nessun confronto disponibile</span>';

  const GG=['domenica','lunedì','martedì','mercoledì','giovedì','venerdì','sabato'];
  const jd=new Date(refDate+'T12:00:00');
  const dateLabel=`${GG[jd.getDay()]} ${jd.getDate()} ${MESI[jd.getMonth()].toLowerCase()}`;
  // Titolo dinamico del riepilogo chiusure: di norma la giornata mostrata è
  // ieri (le chiusure arrivano la sera), ma può essere oggi o più indietro.
  const yestISO=shiftDaysISO(todayISO,-1);
  const riepTitle=refDate===todayISO?'Riepilogo di oggi'
    :(refDate===yestISO?'Riepilogo di ieri':'Riepilogo ultima giornata');

  const banner = missing.length
    ? `<div class="oggi-banner warn" onclick="oggiGoChiusure(true)">
        <span class="ob-icon">📭</span>
        <span class="ob-text">${recs.length} su ${expectedCount} chiusure ricevute · ${missing.length} mancant${missing.length===1?'e':'i'}</span>
        <span class="ob-arrow">›</span>
      </div>`
    : `<div class="oggi-banner ok" onclick="oggiGoChiusure(false)">
        <span class="ob-icon">✅</span>
        <span class="ob-text">Tutte le ${recs.length} chiusure ricevute</span>
        <span class="ob-arrow">›</span>
      </div>`;

  // "Da controllare": anomalie di cassa + chiusure mancanti, cliccabili
  let checkRows='';
  for(const r of anomalie){
    const idx=allData.indexOf(r);
    checkRows+=`<div class="oggi-row" onclick="openSheet(${idx})">
      <span class="oggi-row-icon">⚠️</span>
      <span class="oggi-row-name"><span class="orn-brand">${r.brand}</span>${r.location}</span>
      <span class="oggi-row-val bad">Δ ${fmt(r.diff)}</span>
    </div>`;
  }
  for(const s of missing){
    checkRows+=`<div class="oggi-row" onclick="oggiGoChiusure(true)">
      <span class="oggi-row-icon">📭</span>
      <span class="oggi-row-name"><span class="orn-brand">${s.brand}</span>${s.location}</span>
      <span class="oggi-row-val warn">mancante</span>
    </div>`;
  }
  const checkList = checkRows
    ? `<div class="oggi-sec-title">Da controllare</div><div class="oggi-list">${checkRows}</div>`
    : `<div class="oggi-list"><div class="oggi-empty-ok">✓ Tutto in ordine: nessuna anomalia, nessuna chiusura mancante</div></div>`;

  // Composizione del corrispettivo per brand (barre proporzionali)
  const byBrand={};
  for(const r of recs){ byBrand[r.brand]=(byBrand[r.brand]||0)+r.corrispettivo; }
  const brandEntries=Object.entries(byBrand).sort((a,b)=>b[1]-a[1]);
  const maxBrand=brandEntries.length?brandEntries[0][1]:0;
  let brandBars='';
  for(const [b,v] of brandEntries){
    const bc=brandColor(b);
    const w=maxBrand?Math.max(4,v/maxBrand*100):0;
    brandBars+=`<div class="oggi-bb-row">
      <span class="oggi-bb-name" style="color:${bc.text}">${b}</span>
      <div class="oggi-bb-track"><div class="oggi-bb-fill" style="width:${w}%;background:${bc.strong}"></div></div>
      <span class="oggi-bb-val">${fmt(v)}</span>
    </div>`;
  }
  const brandSection=brandEntries.length>1
    ? `<div class="oggi-sec-title">Per brand</div><div class="oggi-hero oggi-brandbar" style="padding:14px 16px">${brandBars}</div>`
    : '';

  const aperturaSection=_aperturaSectionHTML();

  el.innerHTML=`
    ${aperturaSection}
    <div class="oggi-date-row">
      <div>
        <div class="oggi-date-title">${riepTitle}</div>
        <div class="oggi-date-sub">🌙 ${dateLabel}</div>
      </div>
    </div>
    ${banner}
    <div class="oggi-hero">
      <div class="oggi-hero-l">Corrispettivo della giornata</div>
      <div class="oggi-hero-v">${fmt(totCorr)}</div>
      <div class="oggi-hero-badges">${badges}</div>
    </div>
    <div class="oggi-grid">
      <div class="oggi-mini"><div class="oggi-mini-l">Net sales</div><div class="oggi-mini-v">${fmt(totNet)}</div></div>
      <div class="oggi-mini"><div class="oggi-mini-l">Contanti</div><div class="oggi-mini-v">${fmt(totCash)}</div></div>
      <div class="oggi-mini${anomalie.length?' alert':''}"><div class="oggi-mini-l">Anomalie</div><div class="oggi-mini-v">${anomalie.length}</div></div>
    </div>
    ${checkList}
    ${brandSection}
  `;
}
// Sezione "Aperture" della Dashboard: SEMPRE compatta. Banner ricevute/mancanti
// + CONTATORI di anomalia (fondo cassa / pulizia / guasti) visibili solo se >0.
// Click sul contatore → espande l'elenco dei negozi coinvolti; click sul
// negozio → salta alla vista Aperture con la scheda di dettaglio già aperta.
// Il controllo principe è il FONDO CASSA: quello dichiarato all'apertura deve
// coincidere col "Fondo cassa" dell'ultima chiusura precedente del negozio
// (lookback 14 giorni, vedi _prevClosureFor).
let _apIssuesOpen=new Set();   // contatori espansi (persiste tra i re-render)
function toggleApIssue(key){
  if(_apIssuesOpen.has(key)) _apIssuesOpen.delete(key);
  else _apIssuesOpen.add(key);
  renderOggi();
}
// Naviga alla vista Aperture (tab Chiusure → ☀️). Con i (indice in allAperture)
// apre anche la scheda di dettaglio di quel negozio, sul giorno giusto.
function oggiGoAperture(i){
  switchTab('negozi');
  setVistaNegozi('aperture');
  if(i!=null && allAperture[i]){
    aperturaDate=allAperture[i].dateISO;
    renderAperture();
    openAperturaSheet(i);
  }
}
// ── SEGNALAZIONE GUASTI VIA EMAIL (icona ✉️ sulle righe guasti della home) ──
// Chiave segnalazione: negozio + giorno dell'apertura. Un guasto nuovo il
// giorno dopo ripresenta l'icona ✉️ da zero.
function _segnalazioneKey(a){
  return storeKey(a.brand,a.location)+'|'+a.dateISO;
}
// Icona per la riga guasto: ✉️ da segnalare (click → mailto) oppure ✅ già
// segnalato (tooltip con data/ora e utente). stopPropagation: il click
// sull'icona non deve aprire la scheda del negozio come il resto della riga.
function _segnalaIconHTML(a,i){
  const s=segnalazioniByKey[_segnalazioneKey(a)];
  if(s){
    const d=new Date(s.sent_at);
    const when=isNaN(d)?'—':`${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()} alle ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    const tip=_escHtml(`Segnalata il ${when} da ${s.user||'—'}`);
    return `<span class="segnala-icon done" title="${tip}" onclick="event.stopPropagation()">✅</span>`;
  }
  return `<span class="segnala-icon" title="Segnala via e-mail il guasto" onclick="event.stopPropagation();segnalaGuasto(${i})">✉️</span>`;
}
// Config template effettiva: quella salvata dagli admin sul backend, o i default.
// Se ai DEFAULT vengono aggiunti tipi di danno DOPO che un admin ha già salvato
// una config (che sovrascrive tutto), li integro qui per id — così i tipi nuovi
// compaiono comunque in editor ed email senza toccare il DB. Il generico resta
// in fondo: è il fallback del riconoscimento e va valutato per ultimo.
function _segnalazioniCfg(){
  const cfg=segnalazioniConfig;
  if(!cfg) return SEGNALAZIONI_DEFAULT;
  const have=new Set(cfg.tipi.map(t=>t.id));
  const missing=SEGNALAZIONI_DEFAULT.tipi.filter(t=>!have.has(t.id));
  if(!missing.length) return cfg;
  const gen=t=>t.id==='generico';
  const tipi=[...cfg.tipi.filter(t=>!gen(t)), ...missing.filter(t=>!gen(t)),
              ...cfg.tipi.filter(gen), ...missing.filter(gen)];
  return {...cfg, tipi};
}
// Riconoscimento automatico del tipo di danno dalla nota del negozio: vince il
// primo tipo (nell'ordine della config) con una parola chiave contenuta nella
// nota. Nessun match o nota assente → 'generico' (ultimo della lista).
function detectTipoGuasto(note){
  const cfg=_segnalazioniCfg();
  const n=String(note||'').toLowerCase();
  if(n){
    for(const t of cfg.tipi){
      const kws=String(t.keywords||'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
      if(kws.some(k=>n.includes(k))) return t;
    }
  }
  return cfg.tipi.find(t=>t.id==='generico')||cfg.tipi[cfg.tipi.length-1];
}
// Apre il client di posta predefinito (Outlook) con l'email di segnalazione
// già compilata dal template (base + tipo di danno auto-riconosciuto): oggetto,
// corpo e destinatario arrivano dalla config modificabile in Altro → Template
// segnalazioni. Il mailto: non dice all'app se l'email è stata davvero spedita,
// quindi chiediamo conferma all'utente e solo allora registriamo la
// segnalazione sul backend (visibile a tutti).
function segnalaGuasto(i){
  const a=allAperture[i];
  if(!a) return;
  const dd=a.dateISO?a.dateISO.split('-').reverse().join('/'):'—';
  const cfg=_segnalazioniCfg();
  const tipo=detectTipoGuasto(a.insegnaNote);
  const fill=s=>String(s||'')
    .replace(/{BRAND}/g,a.brand).replace(/{NEGOZIO}/g,a.location)
    .replace(/{DATA}/g,dd).replace(/{NOTA}/g,a.insegnaNote||'nessuna nota dal negozio')
    .replace(/{TIPO}/g,tipo.label||'').replace(/{FRASE}/g,tipo.frase||'');
  const dest=String(tipo.dest||'').trim();
  const subject=encodeURIComponent(fill(cfg.base.subject));
  const body=encodeURIComponent(fill(cfg.base.body));
  window.location.href=`mailto:${encodeURIComponent(dest)}?subject=${subject}&body=${body}`;
  // Piccolo respiro per lasciare aprire Outlook prima del dialogo di conferma.
  setTimeout(async()=>{
    if(!confirm(`Outlook aperto per ${a.brand} ${a.location}.\n\nConfermi che l'email di segnalazione è stata inviata?`)) return;
    const key=_segnalazioneKey(a);
    try{
      const r=await api('/segnalazioni',{method:'POST',body:JSON.stringify({
        key, brand:a.brand, location:a.location, date:a.dateISO})});
      if(!r.ok) throw new Error('Errore '+r.status);
      const data=await r.json();
      segnalazioniByKey[key]={user:data.user, sent_at:data.sent_at};
      renderOggi();
      showToast('✓ Segnalazione registrata','ok');
    }catch(e){
      console.error('segnalaGuasto',e);
      alert('Email ok, ma non sono riuscito a registrare la segnalazione sul server:\n'
        +(e.message||e)+'\n\nRiprova al prossimo sync per marcare l\'icona.');
    }
  },400);
}

function _aperturaSectionHTML(){
  if(!allAperture.length) return '';
  const days=[...new Set(allAperture.map(a=>a.dateISO).filter(Boolean))].sort();
  if(!days.length) return '';
  const day=days[days.length-1];
  const recs=allAperture.filter(a=>a.dateISO===day);
  const expected=ALL_STORES.filter(s=>isStoreMonitoredOn(s.brand,s.location,day));
  const gotKeys=new Set(recs.map(a=>storeKey(a.brand,a.location)));
  const missing=expected.filter(s=>!gotKeys.has(storeKey(s.brand,s.location)));

  // Tre liste di anomalie, con l'indice in allAperture per il salto alla scheda
  const fondi=[],puliti=[],guasti=[];
  for(const a of recs){
    const i=allAperture.indexOf(a);
    if(a.fondoCassa!=null){
      const prev=_prevClosureFor(storeKey(a.brand,a.location),a.dateISO);
      if(prev && isFinite(+prev.fondo) && +prev.fondo!==0){
        const diff=a.fondoCassa-(+prev.fondo);
        if(Math.abs(diff)>0.005) fondi.push({a,i,diff});
      }
    }
    if(a.puliziaOk===false) puliti.push({a,i});
    if(a.insegnaOk===false) guasti.push({a,i});
  }

  const storeRow=(a,i,extra)=>`<div class="oggi-row" onclick="oggiGoAperture(${i})" style="padding-left:34px">
      <span class="oggi-row-icon">›</span>
      <span class="oggi-row-name"><span class="orn-brand">${a.brand}</span>${a.location}</span>
      ${extra||''}
    </div>`;
  const counter=(key,icon,label,arr,rowFn)=>{
    if(!arr.length) return '';
    const open=_apIssuesOpen.has(key);
    let h=`<div class="oggi-row" onclick="toggleApIssue('${key}')">
      <span class="oggi-row-icon">${icon}</span>
      <span class="oggi-row-name"><b>${arr.length}</b>&nbsp;${label}</span>
      <span class="oggi-row-val warn">${open?'▴':'▾'}</span>
    </div>`;
    if(open) h+=arr.map(rowFn).join('');
    return h;
  };

  let counters='';
  counters+=counter('fondo','💶',
    fondi.length===1?'fondo cassa non allineato':'fondi cassa non allineati',
    fondi,({a,i,diff})=>storeRow(a,i,`<span class="oggi-row-val bad">Δ ${fmt(diff)}</span>`));
  // Se il negozio ha scritto una nota (es. "Condizionatore non funzionante"),
  // la mostro al posto dell'etichetta generica, troncata.
  const noteVal=(note,fallback)=>`<span class="oggi-row-val warn">${note?_escHtml(note.length>40?note.slice(0,37)+'…':note):fallback}</span>`;
  counters+=counter('pulizia','🧹',
    puliti.length===1?'segnalazione pulizia':'segnalazioni pulizia',
    puliti,({a,i})=>storeRow(a,i,noteVal(a.puliziaNote,'non pulito')));
  counters+=counter('guasti','💡',
    guasti.length===1?'guasto apparecchiature':'guasti apparecchiature',
    guasti,({a,i})=>storeRow(a,i,noteVal(a.insegnaNote,'guasto')+_segnalaIconHTML(a,i)));

  const dayLabel=`${day.slice(8,10)}/${day.slice(5,7)}`;
  const banner = missing.length
    ? `<div class="oggi-banner warn" onclick="oggiGoAperture()"><span class="ob-icon">☀️</span><span class="ob-text">${recs.length} su ${expected.length} aperture ricevute · ${missing.length} mancant${missing.length===1?'e':'i'}</span><span class="ob-arrow">›</span></div>`
    : `<div class="oggi-banner ok" onclick="oggiGoAperture()"><span class="ob-icon">☀️</span><span class="ob-text">Tutte le ${recs.length} aperture ricevute</span><span class="ob-arrow">›</span></div>`;
  const list = counters
    ? `<div class="oggi-list">${counters}</div>`
    : `<div class="oggi-list"><div class="oggi-empty-ok">✓ Fondi cassa allineati, nessuna segnalazione pulizia o guasti</div></div>`;
  return `<div class="oggi-sec-title">Aperture · ${dayLabel}</div>${banner}${list}`;
}
// Dal riepilogo alla tab Chiusure, con la stessa giornata già filtrata.
// showMissing=true → attiva anche il chip "Mancanti".
function oggiGoChiusure(showMissing){
  if(_oggiRefDate && filterDate!==_oggiRefDate) setDateFilter(_oggiRefDate);
  switchTab('negozi');
  if(showMissing && filterDate){
    const chip=document.getElementById('chip-mancanti');
    if(chip) setChip(chip,'mancanti');
  }
}

// ── PULL-TO-REFRESH (tab Oggi e Chiusure) ───────────────────────────────
// Trascinando verso il basso dalla cima della lista parte una sincronizzazione.
function initPullToRefresh(){
  if(window._ptrBound) return;
  window._ptrBound=true;
  ['tab-oggi','tab-negozi'].forEach(id=>{
    const area=document.getElementById(id);
    if(!area) return;
    let ind=area.querySelector('.ptr-indicator');
    if(!ind){
      ind=document.createElement('div');
      ind.className='ptr-indicator';
      ind.innerHTML='<div class="spinner"></div><span>Aggiorno…</span>';
      area.insertBefore(ind, area.firstChild);
    }
    let startY=null, pulling=false;
    area.addEventListener('touchstart',e=>{
      if(area.scrollTop<=0){ startY=e.touches[0].clientY; pulling=true; }
      else pulling=false;
    },{passive:true});
    area.addEventListener('touchmove',e=>{
      if(!pulling||startY==null) return;
      const dy=e.touches[0].clientY-startY;
      if(dy<=0){ ind.style.height='0px'; ind.classList.remove('armed'); return; }
      const h=Math.min(dy/2.2, 60);
      ind.style.height=h+'px';
      ind.classList.toggle('armed', h>=52);
    },{passive:true});
    area.addEventListener('touchend',()=>{
      if(!pulling) return;
      const armed=ind.classList.contains('armed');
      ind.style.height='0px';
      ind.classList.remove('armed');
      pulling=false; startY=null;
      if(armed) syncNow();
    });
  });
}

// Apre il filtro data come calendario interattivo. Mostra il mese di default
// più recente con dati (o quello del filtro corrente se attivo). I giorni
// senza dati sono disabilitati e in grigio; quello selezionato ha sfondo
// accent; "oggi" è in rosso. Indicatore di quanti negozi per giorno
// (numerino sotto la cifra). Bottone "Mostra tutte le date" per il reset.
function openDateFilter(){
  // Pre-calcolo: set di date disponibili + count per data
  const dates=new Set(), counts={};
  for(const r of allData){
    if(!r.dateISO) continue;
    dates.add(r.dateISO);
    counts[r.dateISO]=(counts[r.dateISO]||0)+1;
  }
  if(!dates.size){
    alert('Nessuna data disponibile: carica prima qualche chiusura.');
    return;
  }
  const sorted=[...dates].sort();
  const earliestISO=sorted[0];
  const latestISO=sorted[sorted.length-1];

  // Mese visualizzato all'apertura: quello del filtro attivo, altrimenti il
  // più recente con dati (= quasi sempre quello che l'utente vuole vedere).
  const initISO=filterDate || latestISO;
  let [yr,mo]=initISO.split('-').map(Number);

  const overlay=document.createElement('div');
  overlay.className='cal-overlay';
  overlay.onclick=(e)=>{if(e.target===overlay)overlay.remove();};

  const panel=document.createElement('div');
  panel.className='cal-panel';
  overlay.appendChild(panel);

  const monthNames=['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno',
                    'Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];

  const todayD=new Date();
  const todayISO=`${todayD.getFullYear()}-${String(todayD.getMonth()+1).padStart(2,'0')}-${String(todayD.getDate()).padStart(2,'0')}`;

  // Helper per limitare la navigazione al range delle date disponibili.
  // Evita che l'utente perda tempo su mesi vuoti molto lontani.
  const earliest=earliestISO.split('-').map(Number);  // [y,m,d]
  const latest=latestISO.split('-').map(Number);
  const canPrev=()=> (yr>earliest[0]) || (yr===earliest[0] && mo>earliest[1]);
  const canNext=()=> (yr<latest[0])   || (yr===latest[0]   && mo<latest[1]);

  function render(){
    // Costruzione griglia: prima riga lunedì-domenica, poi 6 righe da 7 celle
    const firstWeekday=new Date(yr,mo-1,1).getDay();   // Sun=0 .. Sat=6
    const leadingBlanks=(firstWeekday+6)%7;            // shift a Lun=0 .. Dom=6
    const daysInMonth=new Date(yr,mo,0).getDate();

    let cells='';
    for(let i=0;i<leadingBlanks;i++) cells+='<button class="cal-day blank" tabindex="-1"></button>';
    for(let d=1;d<=daysInMonth;d++){
      const iso=`${yr}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const has=dates.has(iso);
      const sel=filterDate===iso;
      const isToday=iso===todayISO;
      const cnt=counts[iso]||0;
      const cls=['cal-day'];
      if(!has) cls.push('empty');
      if(sel) cls.push('selected');
      if(isToday) cls.push('today');
      const attrs=has ? `data-iso="${iso}"` : 'disabled';
      const badge=has && cnt ? `<span class="cal-count">${cnt}</span>` : '';
      cells+=`<button class="${cls.join(' ')}" ${attrs}>${d}${badge}</button>`;
    }

    const allActive=!filterDate;

    panel.innerHTML=`
      <div class="cal-header">
        <button class="cal-nav" data-nav="prev" aria-label="Mese precedente"${canPrev()?'':' disabled'}>‹</button>
        <div class="cal-title">${monthNames[mo-1]} ${yr}</div>
        <button class="cal-nav" data-nav="next" aria-label="Mese successivo"${canNext()?'':' disabled'}>›</button>
      </div>
      <div class="cal-grid-head">
        <div>L</div><div>M</div><div>M</div><div>G</div><div>V</div><div>S</div><div>D</div>
      </div>
      <div class="cal-grid">${cells}</div>
      <div class="cal-footer">
        <button class="cal-all${allActive?' active':''}" data-action="all">📅 Mostra tutte le date · ${allData.length} negozi totali</button>
      </div>
    `;

    // Wiring eventi (delegation locale al panel: si rinfresca a ogni render)
    const prevBtn=panel.querySelector('[data-nav="prev"]');
    const nextBtn=panel.querySelector('[data-nav="next"]');
    if(prevBtn) prevBtn.onclick=()=>{ if(canPrev()){ mo--; if(mo<1){mo=12;yr--;} render(); } };
    if(nextBtn) nextBtn.onclick=()=>{ if(canNext()){ mo++; if(mo>12){mo=1;yr++;} render(); } };
    panel.querySelector('[data-action="all"]').onclick=()=>{ setDateFilter(null); overlay.remove(); };
    panel.querySelectorAll('button[data-iso]').forEach(el=>{
      el.onclick=()=>{ setDateFilter(el.dataset.iso); overlay.remove(); };
    });
  }

  render();
  document.body.appendChild(overlay);
}

function setDateFilter(date){
  filterDate=date;
  const chip=document.getElementById('chip-date');
  if(date){
    const [y,m,dd]=date.split('-');
    chip.textContent=`📅 ${dd}/${m}/${y}`;
    chip.classList.add('on');
  }else{
    chip.textContent='📅 Tutte le date';
    chip.classList.remove('on');
  }
  renderAll();
}

// ── KPI ──
function renderKPI(){
  const d=getFilteredData();
  const totCorr=d.reduce((a,r)=>a+r.corrispettivo,0);
  const totNet=totCorr/1.22;
  // expectedCount:
  //  - SENZA data filtrata → stato attuale dei negozi attivi (EXPECTED_STORES),
  //    così ogni toggle attivo/non-attivo si riflette subito.
  //  - CON data filtrata → negozi attivi IN QUELLA DATA (date-aware), coerente
  //    con il chip "Mancanti" (getMissingStores). Necessario per i negozi con
  //    data di apertura (activeFrom): es. Ascoli Piceno aperto il 20/06 non deve
  //    risultare "mancante" il 18/06.
  const expectedCount = filterDate
    ? ALL_STORES.filter(s => isStoreMonitoredOn(s.brand, s.location, filterDate)).length
    : EXPECTED_STORES.length;
  // Il numero di mancanti viene dalla STESSA fonte del chip, così card e chip
  // non possono mai discordare.
  const missCount = filterDate ? getMissingStores(filterDate).length : 0;
  const negSub=filterDate
    ? `inviate · ${missCount} mancanti su ${expectedCount}`
    : 'PDF caricati';
  document.getElementById('kpi-scroll').innerHTML=[
    {l:'Negozi',v:filterDate?`${Math.max(0,expectedCount-missCount)}/${expectedCount}`:d.length,cls:'y',s:negSub},
    {l:'Corrispettivo',v:fmt(totCorr),cls:'g',s:'lordo IVA 22%'},
    {l:'Net Sales',v:fmt(totNet),cls:'b',s:'al netto IVA'},
    {l:'Contanti',v:fmt(d.reduce((a,r)=>a+r.contanti,0)),cls:'',s:'incassato'},
    {l:'Anomalie',v:d.filter(r=>r.anomaly||r.annull).length,cls:'r',s:'da verificare'},
  ].map(k=>`<div class="kpi-card${k.cls==='y'?' acc':''}">
    <div class="kpi-l">${k.l}</div>
    <div class="kpi-v ${k.cls}">${k.v}</div>
    <div class="kpi-s">${k.s}</div>
  </div>`).join('');
}

