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
    if(ap) el.innerHTML=ap+_malfMemoriaSectionHTML()+'<div style="padding:14px 16px;font-size:12.5px;color:var(--t3)">Riepilogo chiusure in caricamento…</div>';
    return;
  }
  const dates=availableDates();
  const todayISO=_isoToday();
  const refDate=dates.includes(todayISO)?todayISO:dates[dates.length-1];
  _oggiRefDate=refDate;
  const recs=allData.filter(r=>r.dateISO===refDate);
  const missing=getMissingStores(refDate);
  const expectedCount=recs.length+missing.length;
  // Chiusure arrivate da negozi NON attivi in quella data (non attesi): sono
  // quelle che gonfiano "N su M". Le elenco così l'utente vede quali sono.
  const unexpected=recs.filter(r=>!isStoreMonitoredOn(r.brand,r.location,refDate));
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

  // Riga "chiusure da negozi non attesi" (non attivi in quella data): cliccabile,
  // espande l'elenco. Ogni riga apre la chiusura del negozio.
  const unexpOpen=_apIssuesOpen.has('chiusure-inattese');
  const unexpectedLine = unexpected.length ? `<div class="oggi-unexpected">
    <div class="oggi-row" onclick="toggleApIssue('chiusure-inattese')">
      <span class="oggi-row-icon">❓</span>
      <span class="oggi-row-name"><b>${unexpected.length}</b>&nbsp;da negozi non attesi</span>
      <span class="oggi-row-val warn">${unexpOpen?'▴':'▾'}</span>
    </div>
    ${unexpOpen ? unexpected.map(r=>{const idx=allData.indexOf(r);return `<div class="oggi-row" onclick="openSheet(${idx})" style="padding-left:34px">
      <span class="oggi-row-icon">›</span>
      <span class="oggi-row-name"><span class="orn-brand">${r.brand}</span>${r.location}</span>
      <span class="oggi-row-val">${fmt(r.corrispettivo)}</span>
    </div>`}).join('') : ''}
  </div>` : '';

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

  const malfSection=_malfMemoriaSectionHTML();
  const apD=_aperturaData();

  // Hero incasso (mockup 1a): numero grande + chip delta vs target, poi split
  // "vs target | vs anno scorso" sotto un divisore.
  const pctStr=p=>`${p>=0?'+':''}${p.toLocaleString('it-IT',{minimumFractionDigits:1,maximumFractionDigits:1})}%`;
  const heroDelta = tgtD ? `<span class="oggi-hero-delta ${tgtD.pct-100>=0?'up':'down'}">${pctStr(tgtD.pct-100)}</span>` : '';
  const splitCell=(d,label)=> d
    ? `<div class="ohs-cell"><div class="ohs-l">${label}</div><div class="ohs-v ${d.pct-100>=0?'up':'down'}">${pctStr(d.pct-100)}</div></div>`
    : `<div class="ohs-cell"><div class="ohs-l">${label}</div><div class="ohs-v muted">—</div></div>`;
  const hero = `<div class="oggi-hero">
    <div class="oggi-hero-l">${riepTitle} · 🌙 ${dateLabel}</div>
    <div class="oggi-hero-top"><span class="oggi-hero-v">${fmt(totCorr)}</span>${heroDelta}</div>
    <div class="oggi-hero-split">${splitCell(tgtD,'vs target')}${splitCell(pyD,'vs anno scorso')}</div>
  </div>`;

  // Due card affiancate: Aperture (barra verde) · Chiusure (barra indaco).
  const pct=(n,d)=>d?Math.round(n/d*100):0;
  const apCard = apD ? `<div class="oggi-duo-card">
      <div class="odc-l">Aperture</div>
      <div class="odc-v">${apD.received}<span class="odc-tot"> / ${apD.expected}</span></div>
      <div class="oggi-prog"><div class="oggi-prog-fill green" style="width:${pct(apD.received,apD.expected)}%"></div></div>
      ${apD.missing.length?`<div class="odc-miss" onclick="toggleApIssue('mancanti')">${apD.missing.length} mancant${apD.missing.length===1?'e':'i'} ${apD.missOpen?'▴':'›'}</div>`:`<div class="odc-ok">✓ tutte ricevute</div>`}
    </div>` : '';
  const chCard = `<div class="oggi-duo-card">
      <div class="odc-l">Chiusure</div>
      <div class="odc-v">${recs.length}<span class="odc-tot"> / ${expectedCount}</span></div>
      <div class="oggi-prog"><div class="oggi-prog-fill acc" style="width:${pct(recs.length,expectedCount)}%"></div></div>
      ${missing.length?`<div class="odc-miss" onclick="oggiGoChiusure(true)">${missing.length} mancant${missing.length===1?'e':'i'} ›</div>`:`<div class="odc-ok">✓ tutte ricevute</div>`}
    </div>`;
  const duo = `<div class="oggi-duo">${apCard}${chCard}</div>`;

  // Recap giornata (testo a regole) + tasto voce. Salvo il testo in globale così
  // speakRecap() lo legge senza ricalcolare.
  _dailyRecapText=_composeRecap({refDate,recs,missing,expectedCount,totNet,tgtD,pyD,anomalie,dateLabel,apD});
  const recapCard=`<div class="recap-card${_recapOpen?' open':''}" onclick="toggleRecap()">
    <div class="recap-head">
      <span class="recap-title">🗒️ Recap giornata <span class="recap-caret">${_recapOpen?'▴':'▾'}</span></span>
      <button class="recap-btn" id="recap-btn" onclick="event.stopPropagation();speakRecap()">🔊 Ascolta</button>
    </div>
    ${_recapOpen?`<div class="recap-text">${_escHtml(_dailyRecapText)}</div>`:''}
  </div>`;

  el.innerHTML=`
    <div class="oggi-top-row">${hero}${recapCard}</div>
    <div class="oggi-grid">
      <div class="oggi-mini"><div class="oggi-mini-l">Net sales</div><div class="oggi-mini-v">${fmt(totNet)}</div></div>
      <div class="oggi-mini"><div class="oggi-mini-l">Contanti</div><div class="oggi-mini-v">${fmt(totCash)}</div></div>
      <div class="oggi-mini${anomalie.length?' alert':''}"><div class="oggi-mini-l">Anomalie</div><div class="oggi-mini-v">${anomalie.length}</div></div>
    </div>
    ${duo}
    ${apD?apD.missingListHTML:''}
    ${apD?apD.countersListHTML:''}
    ${malfSection}
    ${unexpectedLine}
    ${checkList}
    ${brandSection}
  `;
}
// ── RECAP GIORNATA (testo a regole + lettura vocale nativa) ──
let _dailyRecapText='', _recapSpeaking=false, _recapOpen=false;
// Apre/chiude la card recap (chiusa = solo titolo + tasto Ascolta).
function toggleRecap(){ _recapOpen=!_recapOpen; renderOggi(); }
// Compone il racconto della giornata dai dati già calcolati in renderOggi +
// malfMemoria()/allStoreChecks. Frasi in italiano naturale, pronte anche per
// la sintesi vocale (importi in "euro", scostamenti come "sopra/sotto").
function _composeRecap(o){
  const {refDate,recs,missing,expectedCount,totNet,tgtD,pyD,anomalie,dateLabel,apD}=o;
  const P=[];
  const eur=n=>Math.round(n).toLocaleString('it-IT')+' euro';
  const names=(arr,max=3)=>arr.slice(0,max).map(s=>`${s.brand} ${s.location}`).join(', ')+(arr.length>max?` e altri ${arr.length-max}`:'');
  const scost=(d,label)=>`${Math.abs(d).toFixed(1).replace('.',',')}% ${d>=0?'sopra':'sotto'} ${label}`;
  // Aperture
  if(apD){
    if(!apD.missing.length) P.push(`Oggi sono arrivate tutte le ${apD.expected} aperture.`);
    else P.push(`Aperture: ${apD.received} su ${apD.expected}, manca${apD.missing.length>1?'no':''} ${names(apD.missing)}.`);
  }
  // Chiusure della giornata di riferimento
  if(!missing.length) P.push(`Le chiusure di ${dateLabel} sono arrivate da tutti i ${expectedCount} negozi.`);
  else P.push(`Le chiusure di ${dateLabel} sono arrivate da ${recs.length} negozi su ${expectedCount}: manca${missing.length>1?'no':''} ${names(missing)}.`);
  // Corrispettivo netto + scostamenti
  let c=`Il corrispettivo netto di giornata è ${eur(totNet)}`;
  const b=[];
  if(tgtD) b.push(scost(tgtD.pct-100,'il target'));
  if(pyD)  b.push(scost(pyD.pct-100,"l'anno scorso"));
  if(b.length) c+=`, ${b.join(' e ')}`;
  P.push(c+'.');
  // Anomalie cassa + malfunzionamenti aperti
  const an=anomalie.length;
  if(an) P.push(`${an>1?'Ci sono':"C'è"} ${an} anomali${an>1?'e':'a'} di cassa da verificare.`);
  const mo=(typeof malfMemoria==='function')?malfMemoria().open.length:0;
  if(mo) P.push(`Malfunzionamenti aperti da risolvere: ${mo}.`);
  // Store check: criticità sull'ultima check di ogni negozio
  if(typeof allStoreChecks!=='undefined' && allStoreChecks.length){
    const sorted=[...allStoreChecks].filter(x=>x.dateISO).sort((a,b)=>b.dateISO.localeCompare(a.dateISO));
    const latest=new Map(); for(const x of sorted){const k=storeKey(x.brand,x.location); if(!latest.has(k))latest.set(k,x);}
    const prob=[...latest.values()].filter(x=>x.noCount>0);
    if(prob.length){
      const t=prob.slice(0,3).map(x=>`${x.brand} ${x.location}`).join(', ');
      P.push(`Store check con criticità: ${t}${prob.length>3?` e altri ${prob.length-3}`:''}.`);
    }else P.push(`Le store check ricevute non evidenziano criticità.`);
  }
  return P.join(' ');
}
function _setRecapBtn(on){ const b=document.getElementById('recap-btn'); if(b) b.textContent=on?'⏹ Ferma':'🔊 Ascolta'; }
// Legge il recap ad alta voce. Prova prima Piper TTS (voce italiana naturale
// generata dal backend, endpoint /tts, audio in cache per testo). Se il backend
// non produce l'audio (Piper non disponibile, rete, ecc.) ripiega SENZA errore
// sulla voce di sistema del browser: la lettura funziona comunque.
// Toggle play/stop; il tap dell'utente è il gesto richiesto da iOS per l'audio.
let _recapAudioCache={text:null,url:null};
let _recapAudioEl=null;
// Fallback: voce nativa del browser (speechSynthesis).
function _speakBrowser(text){
  const synth=window.speechSynthesis;
  if(!synth){ alert('Lettura vocale non disponibile su questo dispositivo.'); return; }
  const u=new SpeechSynthesisUtterance(text); u.lang='it-IT';
  const v=(synth.getVoices()||[]).find(x=>/^it(-|_)/i.test(x.lang)); if(v) u.voice=v;
  u.onend=()=>{ _recapSpeaking=false; _setRecapBtn(false); };
  u.onerror=()=>{ _recapSpeaking=false; _setRecapBtn(false); };
  synth.cancel(); synth.speak(u); _recapSpeaking=true; _setRecapBtn(true);
}
async function speakRecap(){
  // Se sta già leggendo (Piper o browser), ferma tutto.
  if(_recapSpeaking){
    if(_recapAudioEl && !_recapAudioEl.paused) _recapAudioEl.pause();
    if(window.speechSynthesis) window.speechSynthesis.cancel();
    _recapSpeaking=false; _setRecapBtn(false); return;
  }
  const text=_dailyRecapText||'Nessun dato disponibile.';
  try{
    if(_recapAudioCache.text!==text){
      const r=await api('/tts',{method:'POST',body:JSON.stringify({text})});
      if(!r.ok) throw new Error('TTS non disponibile');
      const blob=await r.blob();
      if(_recapAudioCache.url) URL.revokeObjectURL(_recapAudioCache.url);
      _recapAudioCache={text,url:URL.createObjectURL(blob)};
    }
    if(!_recapAudioEl){
      _recapAudioEl=new Audio();
      _recapAudioEl.onended=()=>{_recapSpeaking=false;_setRecapBtn(false);};
      _recapAudioEl.onerror=()=>{_recapSpeaking=false;_setRecapBtn(false);};
    }
    _recapAudioEl.src=_recapAudioCache.url;
    await _recapAudioEl.play();
    _recapSpeaking=true; _setRecapBtn(true);
  }catch(e){
    // Piper non ha prodotto l'audio → uso la voce del browser, senza errore.
    console.warn('Piper TTS non disponibile, uso voce di sistema:', e && e.message);
    _speakBrowser(text);
  }
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

// ── MEMORIA MALFUNZIONAMENTI (recap guasti nei vari giorni + stato risolto) ──
// Derivata da allAperture: raggruppo i guasti (insegnaOk===false) per negozio
// + tipo riconosciuto. Segnalazioni ripetute in giorni diversi NON creano voci
// nuove: contano come "solleciti". Un gruppo è APERTO se ha almeno una
// segnalazione con data > resolved_up_to (o mai risolto); dopo la risoluzione,
// una segnalazione più recente lo riapre in automatico.
function malfMemoria(){
  const byKey=new Map();
  for(const a of allAperture){
    if(a.insegnaOk!==false || !a.dateISO) continue;
    const tipo=detectTipoGuasto(a.insegnaNote);
    const key=storeKey(a.brand,a.location)+'|'+tipo.id;
    let g=byKey.get(key);
    if(!g){ g={key,brand:a.brand,location:a.location,tipoLabel:tipo.label,dates:new Set(),lastNote:'',lastDate:''}; byKey.set(key,g); }
    g.dates.add(a.dateISO);
    if(a.dateISO>=g.lastDate){ g.lastDate=a.dateISO; g.lastNote=a.insegnaNote||''; }
  }
  const open=[], resolved=[];
  for(const g of byKey.values()){
    const dates=[...g.dates].sort();
    const res=malfResolvedByKey[g.key];
    const episode=res&&res.resolved_up_to ? dates.filter(d=>d>res.resolved_up_to) : dates;
    if(episode.length) open.push({...g,dates,firstDate:episode[0],count:episode.length,res});
    else               resolved.push({...g,dates,firstDate:dates[0],count:dates.length,res});
  }
  open.sort((a,b)=>a.firstDate.localeCompare(b.firstDate));           // più vecchi in cima
  resolved.sort((a,b)=>((b.res&&b.res.at)||'').localeCompare((a.res&&a.res.at)||''));
  return {open,resolved};
}
function _malfMemoriaSectionHTML(){
  if(!allAperture.length) return '';
  const {open,resolved}=malfMemoria();
  if(!open.length && !resolved.length) return '';
  const dd=iso=>iso?iso.split('-').reverse().slice(0,2).join('/'):'—';
  const jsq=s=>String(s).replace(/'/g,"\\'");
  const row=(e,isOpen)=>{
    const sollec=e.count>1
      ? `<span class="malf-sollecito" title="Segnalato: ${e.dates.map(dd).join(', ')}">sollecitato ${e.count-1}×</span>` : '';
    const note=e.lastNote?_escHtml(e.lastNote.length>60?e.lastNote.slice(0,57)+'…':e.lastNote):'';
    const meta=isOpen
      ? `dal ${dd(e.firstDate)}${e.count>1?` → ${dd(e.lastDate)}`:''}`
      : `risolto${e.res&&e.res.by?` da ${_escHtml(e.res.by)}`:''}${e.res&&e.res.at?` il ${fmtDateTime(e.res.at)}`:''}`;
    const btn=isOpen
      ? `<button class="malf-btn ok" onclick="malfResolve('${jsq(e.key)}','${e.lastDate}')">✓ Risolto</button>`
      : `<button class="malf-btn reopen" onclick="malfReopen('${jsq(e.key)}')">↺ Riapri</button>`;
    return `<div class="malf-row${isOpen?'':' done'}">
      <div class="malf-main">
        <div class="malf-title"><span class="orn-brand">${e.brand}</span>${e.location} · ${_escHtml(e.tipoLabel)} ${sollec}</div>
        <div class="malf-sub">${note?note+' · ':''}${meta}</div>
      </div>${btn}
    </div>`;
  };
  let h=`<div class="oggi-sec-title">Malfunzionamenti</div>`;
  if(open.length){
    // Riga singola prominente: cliccandola si espande l'elenco completo.
    const oOpen=_apIssuesOpen.has('malf-aperti');
    h+=`<div class="malf-head${oOpen?' open':''}" onclick="toggleApIssue('malf-aperti')">
        <span class="malf-head-icon">🛠️</span>
        <span class="malf-head-txt"><b>${open.length}</b> malfunzionament${open.length===1?'o aperto':'i aperti'}</span>
        <span class="malf-head-arrow">${oOpen?'▴':'▾'}</span>
      </div>`;
    if(oOpen) h+=`<div class="oggi-list">${open.map(e=>row(e,true)).join('')}</div>`;
  }else{
    h+=`<div class="oggi-list"><div class="oggi-empty-ok">✓ Nessun malfunzionamento aperto</div></div>`;
  }
  if(resolved.length){
    const rOpen=_apIssuesOpen.has('malf-risolti');
    h+=`<div class="oggi-list"><div class="oggi-row" onclick="toggleApIssue('malf-risolti')">
        <span class="oggi-row-icon">✅</span>
        <span class="oggi-row-name"><b>${resolved.length}</b>&nbsp;risolt${resolved.length===1?'o':'i'}</span>
        <span class="oggi-row-val">${rOpen?'▴':'▾'}</span>
      </div>${rOpen?resolved.map(e=>row(e,false)).join(''):''}</div>`;
  }
  return h;
}
async function malfResolve(key,upTo){
  try{
    const r=await api('/malfunzionamenti/resolved',{method:'POST',body:JSON.stringify({key,resolved_up_to:upTo,resolved:true})});
    if(!r.ok) throw new Error('Errore '+r.status);
    const d=await r.json();
    malfResolvedByKey[key]={resolved_up_to:upTo,by:d.by,at:d.at};
    renderOggi();
    showToast('✓ Malfunzionamento risolto','ok');
  }catch(e){ console.error('malfResolve',e); alert('Errore: '+(e.message||e)); }
}
async function malfReopen(key){
  try{
    const r=await api('/malfunzionamenti/resolved',{method:'POST',body:JSON.stringify({key,resolved_up_to:'',resolved:false})});
    if(!r.ok) throw new Error('Errore '+r.status);
    delete malfResolvedByKey[key];
    renderOggi();
    showToast('↺ Riaperto','ok');
  }catch(e){ console.error('malfReopen',e); alert('Errore: '+(e.message||e)); }
}

// Dati aperture del giorno più recente: numeri (ricevute/attese/mancanti) +
// HTML dei contatori (fondo/pulizia/guasti) e della lista mancanti. Usato sia
// dal wrapper _aperturaSectionHTML (ramo cold-start) sia dalle 2 card della home.
function _aperturaData(){
  if(!allAperture.length) return null;
  const days=[...new Set(allAperture.map(a=>a.dateISO).filter(Boolean))].sort();
  if(!days.length) return null;
  const day=days[days.length-1];
  // Un record per NEGOZIO, non per PDF: se lo stesso negozio ha più checklist
  // nello stesso giorno (es. PDF corretto e ricaricato, l'originale resta su
  // Drive) tengo la più recente. Senza dedup il banner contava i PDF e usciva
  // incoerente ("24 su 25 ricevute · 2 mancanti", visto l'08/07/2026).
  const _byStore=new Map();
  for(const a of allAperture){
    if(a.dateISO!==day) continue;
    const k=storeKey(a.brand,a.location);
    const prev=_byStore.get(k);
    if(!prev || String(a.modifiedTime||'')>String(prev.modifiedTime||'')) _byStore.set(k,a);
  }
  const recs=[..._byStore.values()];
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
  // Ricevute = attesi - mancanti: così i due numeri tornano sempre, anche se un
  // negozio non monitorato invia comunque la checklist.
  const receivedCount=expected.length-missing.length;
  const missOpen=_apIssuesOpen.has('mancanti');
  const missingListHTML = (missing.length && missOpen)
    ? `<div class="oggi-list">${missing.map(s=>`<div class="oggi-row" style="cursor:default">
        <span class="oggi-row-icon">📭</span>
        <span class="oggi-row-name"><span class="orn-brand">${s.brand}</span>${s.location}</span>
        <span class="oggi-row-val warn">mancante</span>
      </div>`).join('')}</div>`
    : '';
  const countersListHTML = counters
    ? `<div class="oggi-list">${counters}</div>`
    : `<div class="oggi-list"><div class="oggi-empty-ok">✓ Fondi cassa allineati, nessuna segnalazione pulizia o guasti</div></div>`;
  return {day,dayLabel,received:receivedCount,expected:expected.length,missing,missOpen,missingListHTML,countersListHTML};
}
// Wrapper legacy (ramo cold-start di renderOggi): banner classico full-width.
function _aperturaSectionHTML(){
  const d=_aperturaData();
  if(!d) return '';
  const missLabel=`${d.missing.length} mancant${d.missing.length===1?'e':'i'} ${d.missOpen?'▴':'▾'}`;
  const banner = d.missing.length
    ? `<div class="oggi-banner warn" onclick="oggiGoAperture()"><span class="ob-icon">☀️</span><span class="ob-text">${d.received} su ${d.expected} aperture ricevute · <span class="ob-missing" onclick="event.stopPropagation();toggleApIssue('mancanti')">${missLabel}</span></span><span class="ob-arrow">›</span></div>`
    : `<div class="oggi-banner ok" onclick="oggiGoAperture()"><span class="ob-icon">☀️</span><span class="ob-text">Tutte le ${d.expected} aperture ricevute</span><span class="ob-arrow">›</span></div>`;
  return `<div class="oggi-sec-title">Aperture · ${d.dayLabel}</div>${banner}${d.missingListHTML}${d.countersListHTML}`;
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

