// 02-sync.js — syncNow, overrides, cache backend condivisa, import consuntivi Drive, upload Excel (target/storico) + lettori celle
// Estratto da index.html (split del 2026-07-07). Script classici:
// tutti i file js/ condividono lo scope globale; ordine di caricamento 01→08.
// ── SYNC (parallelo + cache locale + cache backend condivisa + render incrementale) ──
async function syncNow(){
  setPip('spin','Sincronizzazione…');
  load(true,'Lettura Google Drive…');
  renderSkeletons();
  lastErrors=[];
  // Sezione Aperture visibile da subito con i dati dell'ultima sessione
  // (cache locale), senza aspettare il giro completo: si aggiorna a fine sync.
  preloadApertureFromCache();
  if(allAperture.length){ try{ renderOggi(); if(vistaNegozi==='aperture') renderAperture(); }catch(_){} }
  try{
    // Import automatico dei consuntivi da Drive PRIMA di leggere lo storico, così
    // fetchHistorical() qui sotto vede subito i dati aggiornati. È idempotente
    // (se il file su Drive non è cambiato non fa nulla) e non-bloccante: eventuali
    // errori sono silenziati e non fermano la sincronizzazione della dashboard.
    await syncConsuntiviFromDrive({silent:true});
    // Lista file da Drive + cache backend + overrides + target + storico in
    // parallelo (latenza coperta dal request più lento). Tutti questi dati
    // servono per le viste della dashboard: pdf cache per le chiusure,
    // overrides per le correzioni manuali, targets per il badge %
    // realizzazione, historical per il confronto anno-su-anno e per la
    // timeline pre-GoAudits del 2026.
    const [files, backendCache, overrides, targets, historical, historicalKpi, storeFlags, segnalazioni, segnCfg, malfResolved, scMailCfg] = await Promise.all([
      listFiles(),
      fetchPdfCache(),
      fetchOverrides(),
      fetchTargets(),
      fetchHistorical(),
      fetchHistoricalKpi(),
      fetchStoreFlags(),
      fetchSegnalazioni(),
      fetchSegnalazioniConfig(),
      fetchMalfResolved(),
      fetchStoreCheckMailConfig(),
    ]);
    _coldRetry=false;   // Promise.all riuscito → rete ok, riarmo il retry cold-start
    targetsByKey = targets;
    segnalazioniByKey = segnalazioni;
    segnalazioniConfig = segnCfg;
    malfResolvedByKey = malfResolved;
    storeCheckMailConfig = scMailCfg;
    historicalByKey = historical;
    historicalKpiByKey = historicalKpi;
    // Applico override dei flag monitored PRIMA di calcolare missing/KPI così
    // tutta la pipeline di rendering parte con la lista negozi attesi corretta.
    storeFlagsByKey = storeFlags;
    recomputeExpected();
    // Aperture: sync in parallelo SENZA await (non deve rallentare le chiusure).
    // Al termine ridisegna solo la home Oggi, unica vista che le mostra.
    syncAperture(backendCache).then(()=>{ try{ renderOggi(); if(vistaNegozi==='aperture') renderAperture(); }catch(_){} });
    // Store check: idem, ridisegna la sua sezione se aperta al termine.
    syncStoreCheck(backendCache).then(()=>{ try{ if(typeof renderStoreCheck==='function' && document.getElementById('tab-storecheck')?.style.display!=='none') renderStoreCheck(); }catch(_){} });
    if(!files.length){setPip('','Nessun PDF');load(false);allData=[];renderAll();return;}

    const localCache=loadCache();
    const results=new Array(files.length);
    const toFetch=[];
    let fromBackend=0, fromLocal=0;

    // Per ogni file scegliere la sorgente: cache backend > cache locale > download
    files.forEach((f,i)=>{
      const key=f.id+'_'+f.modifiedTime;
      if(backendCache[key]){
        results[i]=backendCache[key];
        // Aggiorno anche la cache locale così se vai offline funzioni
        localCache[key]=backendCache[key];
        fromBackend++;
      }else if(localCache[key]){
        results[i]=localCache[key];
        fromLocal++;
      }else{
        toFetch.push({i,f,key});
      }
    });

    const cachedTotal = fromBackend + fromLocal;
    load(true, toFetch.length===0
      ? `${cachedTotal} file dalla cache (${fromBackend} condivisi)…`
      : `Cache: ${cachedTotal}/${files.length} (${fromBackend} dal backend) · scarico ${toFetch.length}…`);

    // RENDER INCREMENTALE: rendo subito quello che ho dalla cache così l'utente
    // vede i numeri immediatamente, mentre i nuovi PDF si caricano in background.
    // Una guard temporale evita di ridisegnare 30 volte al secondo (throttle 400ms).
    let lastRender=0;
    const maybeRender=(force=false)=>{
      const now=Date.now();
      if(!force && now-lastRender<400) return;
      lastRender=now;
      allData=dedupClosures(results.filter(Boolean));
      // Applico le correzioni manuali ANCHE durante il caricamento incrementale,
      // altrimenti il render mostrerebbe i valori parsati senza override.
      applyOverrides(allData, overrides);
      try{ renderAll(); }catch(_){}
    };
    if(cachedTotal>0) maybeRender(true);  // primo render immediato con la cache

    // Workers paralleli per scaricare e parsare i PDF mancanti
    let done=cachedTotal, cursor=0;
    const worker=async()=>{
      while(cursor<toFetch.length){
        const job=toFetch[cursor++];
        try{
          const d=await fetchAndParse(job.f);
          if(d){
            results[job.i]=d;
            localCache[job.key]=d;
            // Upload alla cache backend per gli altri utenti (best-effort, non blocca)
            pushPdfCache(job.key, d).catch(e=>console.warn('pushPdfCache',e));
          }
        }catch(e){
          console.warn(job.f.name,e);
          lastErrors.push({name:job.f.name,msg:e.message||String(e)});
        }
        done++;
        load(true,`PDF ${done}/${files.length}…`);
        maybeRender();  // render incrementale ad ogni nuovo PDF (throttled)
      }
    };
    await Promise.all(Array.from({length:Math.min(CONCURRENCY,toFetch.length)},worker));

    // Pulizia cache locale: chiavi non più valide vanno via per non gonfiare localStorage
    const validKeys=new Set(files.map(f=>f.id+'_'+f.modifiedTime));
    for(const k of Object.keys(localCache)) if(!validKeys.has(k)) delete localCache[k];
    saveCache(localCache);

    // Render finale forzato (ignora throttle) per garantire stato coerente
    allData=dedupClosures(results.filter(Boolean));
    applyOverrides(allData, overrides);
    const t=new Date().toLocaleTimeString('it-IT');
    document.getElementById('last-sync-disp').textContent=t;
    document.getElementById('pdf-count-disp').textContent=allData.length+' file';
    const errEl=document.getElementById('err-count-disp');
    if(errEl)errEl.textContent=lastErrors.length;
    setPip('live',`${allData.length} pdf${lastErrors.length?` · ${lastErrors.length} errori`:''}`);
    renderAll();
  }catch(e){
    console.error(e);
    // "Failed to fetch" = errore di rete (tipico cold start di Render, che dorme
    // dopo 15 min di inattività). Non è un guasto: niente popup, mostro solo lo
    // stato nel pill e ritento UNA volta in silenzio; il resto lo copre l'auto-sync.
    const netErr=/failed to fetch|networkerror|load failed/i.test(e.message||'');
    if(netErr){
      if(!_coldRetry){ _coldRetry=true; setPip('spin','Riconnessione…'); setTimeout(syncNow, 7000); }
      else setPip('','Offline');
    }else{
      setPip('','Errore');
      alert('Errore Google Drive:\n'+e.message);
    }
  }
  load(false);
}
// Guard: un solo retry silenzioso per fallimento di rete (evita loop).
let _coldRetry=false;

async function listFiles(){
  // Il backend conosce folder ID e API key Google (env vars), il browser no
  const r=await api('/drive/list');
  if(!r.ok){
    let msg='API '+r.status;
    try{const e=await r.json();if(e.detail)msg=e.detail;}catch(_){}
    throw new Error(msg);
  }
  return await r.json();
}
async function fetchAndParse(file){
  const r=await api(`/drive/file/${encodeURIComponent(file.id)}`);
  if(!r.ok){
    let msg='Download '+r.status;
    try{const e=await r.json();if(e.detail)msg=e.detail;}catch(_){}
    throw new Error(msg);
  }
  return parsePDF(await r.arrayBuffer(),file.name,file.modifiedTime,file.id);
}

// ── OVERRIDES (correzioni manuali persistite sul backend) ──
// Whitelist dei campi modificabili. Deve corrispondere a ALLOWED_OVERRIDE_FIELDS
// nel backend (main.py). Aggiungere campi qui senza aggiornare il backend
// causerà errori 400 al primo PUT.
const OVR_FIELDS=['corrispettivo','contanti','pos','cambi','giftcard','annull','buonoE','buonoR',
                  'sconti','versato','daVersare'];

// Snapshot dei valori parsati dal PDF (prima delle correzioni manuali).
// Necessario per: (1) mostrare il "valore originale" nel tooltip del badge,
// (2) auto-rimuovere l'override quando l'utente reimposta il valore originale.
function setOriginal(r){
  if(r._original) return;
  r._original={};
  for(const k of OVR_FIELDS) r._original[k]=+r[k]||0;
}

// Aggiorna r.diff/r.anomaly dopo una modifica ai valori. Da chiamare ogni
// volta che cambia uno qualsiasi degli importi che entrano nella formula.
function recomputeCash(r){
  const c=computeCash(r);
  r.diff=c.diff;
  r.anomaly=c.anomaly;
  // netSales è un campo DERIVATO dal corrispettivo (÷1.22, vedi parse): va
  // riallineato qui, perché quando una correzione manuale cambia il
  // corrispettivo tutte le viste aggregate (Analisi, Oggi, KPI, card) leggono
  // r.netSales — senza questo ricalcolo continuerebbero a mostrare il valore
  // originale del PDF anche dopo l'override (bug segnalato il 06/07).
  r.netSales=(+r.corrispettivo||0)/1.22;
  return c;
}

async function fetchOverrides(){
  // Restituisce array di {fileId, fields, updatedBy, updatedAt}. Non-fatale:
  // se il backend è giù la dashboard mostra comunque i valori parsati.
  try{
    const r=await api('/overrides');
    if(!r.ok) return [];
    return await r.json();
  }catch(e){console.warn('fetchOverrides',e);return[];}
}

// Dedup chiusure: un negozio chiude una sola volta al giorno. Se lo stesso
// negozio ha più PDF per la stessa data (PDF ricaricato/corretto mentre
// l'originale resta su Drive), tengo solo quello con modifiedTime più recente.
// Le aperture lo fanno già; senza questo, il doppione gonfiava sia i CONTEGGI
// sia i TOTALI (incasso, contanti, saldo cumulato) in home, tab Chiusure,
// Analisi e Negozi. Chiave: storeKey|dateISO. Record senza brand/location/data
// (parse parziale) restano intatti — non deduplicabili in sicurezza.
function dedupClosures(records){
  const byKey=new Map();
  const out=[];
  for(const r of records){
    if(!r) continue;
    if(!r.brand || !r.location || !r.dateISO){ out.push(r); continue; }
    const k=storeKey(r.brand,r.location)+'|'+r.dateISO;
    const prev=byKey.get(k);
    if(!prev){ byKey.set(k,r); out.push(r); }
    else if(String(r.modifiedTime||'')>String(prev.modifiedTime||'')){
      const idx=out.indexOf(prev);
      if(idx>=0) out[idx]=r;      // sostituisco il vecchio con questo più recente
      byKey.set(k,r);
    }
    // else: r è più vecchio del già tenuto → scarto il doppione
  }
  return out;
}

function applyOverrides(records, overrides){
  // Indicizza per fileId e applica i campi consentiti. Mutazione in-place
  // perché allData è la fonte di verità per tutti i render.
  const byId=new Map();
  for(const o of overrides) if(o&&o.fileId) byId.set(o.fileId,o);
  for(const r of records){
    setOriginal(r);
    r._overridden={};  // reset ogni sync
    const o=r.fileId ? byId.get(r.fileId) : null;
    if(o && o.fields){
      for(const k of OVR_FIELDS){
        if(o.fields[k]==null) continue;
        const v=+o.fields[k];
        if(!isFinite(v)) continue;
        r[k]=v;
        r._overridden[k]={by:o.updatedBy||'',at:o.updatedAt||''};
      }
    }
    recomputeCash(r);
  }
}

// ── CACHE BACKEND CONDIVISA (PDF parsati) ──
// Il primo utente che parsa un PDF lo deposita qui; tutti gli altri lo
// recuperano in millisecondi senza doverlo scaricare e riparsare. Funzioni
// non-fatali: se il backend non risponde la dashboard funziona comunque
// (cade sulla cache locale + parsing).
async function fetchPdfCache(){
  try{
    const r=await api('/pdfcache');
    if(!r.ok) return {};
    const data=await r.json();
    return (data && typeof data==='object') ? data : {};
  }catch(e){console.warn('fetchPdfCache',e);return {};}
}
// Target giornalieri per negozio (caricati periodicamente da Excel via /targets/bulk).
// Il backend restituisce un dict {storeKey|date: target} con la chiave già
// normalizzata (lowercase + spazi compattati) per fare lookup diretto.
// Non-fatale: se il backend non risponde o non ha target, le card mostrano
// "TGT=0" come da richiesta utente.
async function fetchTargets(){
  try{
    const r=await api('/targets');
    if(!r.ok) return {};
    const data=await r.json();
    return (data && typeof data==='object') ? data : {};
  }catch(e){console.warn('fetchTargets',e);return {};}
}
// Incassi storici (2025 + Jan-Apr 2026). Stessa struttura dei target ma il
// valore è il net sales effettivamente incassato. Usato in tab Andamento per:
//   1) Riempire i giorni del 2026 prima del 23/04 (pre-GoAudits)
//   2) Confronto anno-su-anno quando il toggle "vs Anno scorso" è attivo
async function fetchHistorical(){
  try{
    const r=await api('/historical');
    if(!r.ok) return {};
    const data=await r.json();
    return (data && typeof data==='object') ? data : {};
  }catch(e){console.warn('fetchHistorical',e);return {};}
}
// KPI storici dal backend. Endpoint introdotto col deploy v1.2: ritorna
// {storeKey|date: {walkIn?, quantity?, scontrini?, cr?, upt?}} solo per i
// record che hanno almeno un campo KPI valorizzato.
// Graceful degrade: se il backend è una versione precedente o l'endpoint
// risponde 404/500, ritorno {} e la tab KPI continua a leggere solo dai PDF
// GoAudits (comportamento pre-v1.2).
async function fetchHistoricalKpi(){
  try{
    const r=await api('/historical/kpi');
    if(!r.ok) return {};
    const data=await r.json();
    return (data && typeof data==='object') ? data : {};
  }catch(e){console.warn('fetchHistoricalKpi',e);return {};}
}
// ── IMPORT AUTOMATICO CONSUNTIVI DA GOOGLE DRIVE ──
// Chiede al backend di pescare l'ultimo .xlsx dalla cartella Drive dedicata
// (riempita da Power Automate con l'allegato email) e importarlo. È idempotente
// lato backend: se il file non è cambiato dall'ultima volta non fa nulla.
//   silent=true  → usato nella sync automatica: non deve MAI bloccare o disturbare.
//                  Il 503 "cartella non configurata" è normale finché non imposti
//                  l'env var DRIVE_CONSUNTIVI_FOLDER_ID → lo ignoro in silenzio.
//   silent=false → usato dal pulsante manuale: propago gli errori al chiamante.
// Ritorna l'oggetto risposta (o null se silent e qualcosa è andato storto).
async function syncConsuntiviFromDrive({silent=true, force=false}={}){
  try{
    const r=await api('/historical/sync-drive'+(force?'?force=true':''),{method:'POST'});
    if(!r.ok){
      if(r.status===503) return null; // cartella non configurata: normale, silenzio
      let detail='Errore '+r.status;
      try{const e=await r.json(); if(e.detail) detail=typeof e.detail==='string'?e.detail:JSON.stringify(e.detail);}catch(_){}
      throw new Error(detail);
    }
    return await r.json();
  }catch(e){
    if(silent){console.warn('syncConsuntiviFromDrive',e);return null;}
    throw e;
  }
}
// Pulsante "📥 Importa" nel banner consuntivi della tab Analisi (admin).
// NON forza: se l'ultimo .xlsx su Drive è lo stesso già importato (stessa firma
// id+modifiedTime sul backend), non riscrive nulla e mostra solo un avviso —
// richiesta utente 03/07: niente re-import né date che cambiano a vuoto.
// I bottoni sono 2 (banner Vendite + banner KPI, stessa classe): li disabilito
// tutti durante l'import. Al termine renderAll() rigenera i banner via
// updateConsuntivoLabel, quindi non serve ripristinare il testo a mano.
async function importConsuntiviFromDriveManual(){
  const btns=[...document.querySelectorAll('.asof-import-btn')];
  btns.forEach(b=>{b.disabled=true;b.textContent='⏳ Importo…';});
  try{
    const res=await syncConsuntiviFromDrive({silent:false});
    if(res && res.imported){
      historicalByKey=await fetchHistorical();
      historicalKpiByKey=await fetchHistoricalKpi();
      renderAll();
      let msg=`✓ Consuntivi importati da Drive.\n\nFile: ${res.file}\nAnno ${res.year} · ${res.records} record (nuovi ${res.upserted}, aggiornati ${res.modified})`;
      if(res.unrecognized && res.unrecognized.length) msg+=`\n\nNegozi non riconosciuti ignorati: ${res.unrecognized.slice(0,5).join(', ')}`;
      alert(msg);
    }else if(res && res.imported===false){
      // Due esiti "niente da fare": cartella vuota vs file già importato.
      if(res.reason && res.reason.startsWith('Nessun file')){
        alert('⚠️ '+res.reason);
      }else{
        alert('ℹ️ Il file più recente su Drive è già stato caricato.\n\nNessuna modifica ai dati.'+(res.file?`\nFile: ${res.file}`:''));
      }
    }else{
      alert('Import non riuscito: la cartella Drive dei consuntivi non è configurata sul backend (DRIVE_CONSUNTIVI_FOLDER_ID).');
    }
  }catch(e){
    console.error('importConsuntiviFromDriveManual',e);
    alert('Errore import consuntivi da Drive:\n'+(e.message||e));
  }finally{
    // Rigenera i banner (e quindi i bottoni, ri-abilitati) in ogni caso,
    // anche negli esiti di errore dove renderAll() non è stato chiamato.
    updateConsuntivoLabel();
  }
}
// Override del flag monitored per i 30 negozi (vedi commento globale storeFlagsByKey).
// Non-fatale: se la GET fallisce torno {} e i default di ALL_STORES restano
// sovrani. Il backend deve essere ridepoyato con l'endpoint /stores/flags;
// finché non lo è, la chiamata torna 404 e silenziamo il warning.
//
// Lo shape del payload è {key: {monitored, active_from}}. Se per caso il
// backend ne ritorna uno vecchio (boolean diretto, da una build precedente),
// lo convertiamo qui in {monitored: bool, activeFrom: null} per evitare
// di rompere il frontend durante un rolling deploy.
// Template segnalazioni personalizzato dagli admin. Non-fatale: null =
// endpoint assente/mai salvato/errore → si usano i default in 01-config.js.
async function fetchSegnalazioniConfig(){
  try{
    const r=await api('/segnalazioni/config');
    if(!r.ok) return null;
    const data=await r.json();
    return (data && data.base && Array.isArray(data.tipi)) ? data : null;
  }catch(e){ return null; }
}
// Template email store check. null = endpoint assente/mai salvato → default.
async function fetchStoreCheckMailConfig(){
  try{
    const r=await api('/storecheck/mail-config');
    if(!r.ok) return null;
    const data=await r.json();
    return (data && (data.subject||data.to||data.cc)) ? data : null;
  }catch(e){ return null; }
}
// Stato "risolto" dei malfunzionamenti. Non-fatale: {} se endpoint assente.
async function fetchMalfResolved(){
  try{
    const r=await api('/malfunzionamenti/resolved');
    if(!r.ok) return {};
    const data=await r.json();
    return (data && typeof data==='object') ? data : {};
  }catch(e){ return {}; }
}
// Segnalazioni guasti già inviate. Non-fatale: se il backend non ha ancora
// l'endpoint (404 pre-redeploy) o fallisce, torno {} e le icone restano ✉️.
async function fetchSegnalazioni(){
  try{
    const r=await api('/segnalazioni');
    if(!r.ok) return {};
    const data=await r.json();
    return (data && typeof data==='object') ? data : {};
  }catch(e){ return {}; }
}
async function fetchStoreFlags(){
  try{
    const r=await api('/stores/flags');
    if(!r.ok) return {};
    const data=await r.json();
    if(!data || typeof data !== 'object') return {};
    const out = {};
    for(const k in data){
      const v = data[k];
      if(v && typeof v === 'object'){
        out[k] = { monitored: !!v.monitored, activeFrom: v.active_from || null };
      }else{
        // shape vecchio: bool puro
        out[k] = { monitored: !!v, activeFrom: null };
      }
    }
    return out;
  }catch(e){console.warn('fetchStoreFlags',e);return {};}
}
// ── UPLOAD TARGET EXCEL (admin only) ──
// Mapping per-NOME (non per posizione): per ogni nome di negozio così com'è
// scritto nell'header dell'Excel, indica a quale (brand, location) della
// dashboard corrisponde. Le chiavi sono normalizzate (lowercase + spazi
// compattati) per essere tolleranti a maiuscole/spazi extra.
//
// Vantaggio rispetto al matching per posizione: se domani l'Excel cambia
// l'ordine delle colonne, aggiunge colonne in mezzo, o rimuove negozi non
// monitorati, lo script si adatta da solo cercando i nomi nell'header.
//
// Per aggiungere un nuovo negozio: aggiungi una riga qui con il nome ESATTO
// dell'header Excel (in minuscolo, spazi compattati) come chiave, e
// [brand, location] come valore. Aggiungi anche il negozio a EXPECTED_STORES.
const TARGETS_HEADER_MAP = {
  // 20 negozi monitorati GoAudits (i target c'erano già)
  'adidas bari bariblu':              ['Adidas',  'Bariblu'],
  'adidas brindisi city (umberto)':   ['Adidas',  'Brindisi City'],
  'adidas brindisi colonne':          ['Adidas',  'Brindisi Colonne'],
  'adidas foggia grandapulia':        ['Adidas',  'Foggia'],
  'adidas lecce city (trinchese)':    ['Adidas',  'Lecce City'],
  'adidas rende metropolis':          ['Adidas',  'Rende'],
  'adidas taranto mongolfiera':       ['Adidas',  'Taranto'],
  'adidas teramo gran sasso':         ['Adidas',  'Teramo'],
  'carpisa brindisi colonne':         ['Carpisa', 'Brindisi Colonne'],
  'carpisa gallipoli city (roma)':    ['Carpisa', 'Gallipoli'],
  'carpisa lecce city (mazzini)':     ['Carpisa', 'Lecce'],
  'carpisa ostuni city (pola)':       ['Carpisa', 'Ostuni'],
  'carpisa surbo mongolfiera':        ['Carpisa', 'Surbo'],
  'mango bari bariblu':               ['Mango',   'Bariblu'],
  'mango foggia grandapulia':         ['Mango',   'Foggia'],
  'mango molfetta gran shopping':     ['Mango',   'Molfetta'],
  'mango taranto porte dello jonio':  ['Mango',   'Taranto'],
  'mango teramo gran sasso':          ['Mango',   'Teramo'],
  'mango treviso city (calmaggiore)': ['Mango',   'Treviso'],
  // Nuovo negozio aperto 20/06/2026. Più varianti d'intestazione per tolleranza:
  // se l'Excel target usa un nome diverso, aggiungere qui la chiave esatta (minuscola).
  'mango ascoli piceno':              ['Mango',   'Ascoli Piceno'],
  'mango ascoli piceno city':         ['Mango',   'Ascoli Piceno'],
  'mango ascoli':                     ['Mango',   'Ascoli Piceno'],
  'yamamay lecce city (sauro)':       ['Yamamay', 'Lecce'],
  'yamamay monopoli':                 ['Yamamay', 'Monopoli'],
  'yamamay monopoli city':            ['Yamamay', 'Monopoli'],
  'yamamay monopoli city (magenta)':  ['Yamamay', 'Monopoli'],
  'yamamay polignano city (a. moro)': ['Yamamay', 'Polignano'],
  // 10 negozi NON-GoAudits (target c'erano nell'Excel ma non venivano letti
  // perché le colonne non sono verdi). Gli header del target hanno nomi più
  // estesi del file storico (es. "carpisa Bari City (Sparano)" anziché solo
  // "Carpisa Sparano"), per quello servono entrambe le mappature.
  'carpisa bari bariblu':                       ['Carpisa', 'Bariblu'],
  'carpisa bari city (sparano)':                ['Carpisa', 'Sparano'],
  'carpisa bari santa caterina mongolfiera':    ['Carpisa', 'S. Caterina'],
  'carpisa casamassima parco commerciale':      ['Carpisa', 'Casamassima'],
  'yamamay bari aeroporto':                     ['Yamamay', 'Aeroporto'],
  'yamamay bari city (sparano)':                ['Yamamay', 'Sparano'],
  'yamamay bari santa caterina mongolfiera':    ['Yamamay', 'S. Caterina'],
  'yamamay casamassima parco commerciale':      ['Yamamay', 'Casamassima'],
  'yamamay molfetta puglia village':            ['Yamamay', 'Molfetta'],
  'yamamay putignano city (umberto)':           ['Yamamay', 'Putignano'],
};
// ── LETTORE ROBUSTO DI CELLE "DATA" EXCEL ──
// In passato l'upload accettava SOLO date in formato data "vero" (cellDates:true
// le converte in oggetti Date). Ma un Excel rigenerato/esportato spesso salva le
// date come TESTO ("01/06/2026") o come numero seriale: in quei casi venivano
// scartate tutte → "Nessun dato valido estratto dal file".
// Questa funzione interpreta i 3 casi e ritorna un oggetto Date (mezzogiorno
// locale, niente drift di fuso) oppure null se davvero non è una data.
//   1) Date vera        → ritorna così com'è
//   2) numero seriale   → giorni dal 30/12/1899 (epoca Excel)
//   3) testo            → "gg/mm/aaaa", "gg-mm-aaaa", "gg.mm.aaaa" o "aaaa-mm-gg"
function parseExcelDateCell(v){
  if(v == null || v === '') return null;
  if(v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if(typeof v === 'number' && isFinite(v)){
    // 25569 = giorni tra l'epoca Excel (1899-12-30) e l'epoca Unix (1970-01-01)
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return isNaN(d.getTime()) ? null : new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12);
  }
  const s = String(v).trim();
  if(!s) return null;
  let m;
  // ISO: aaaa-mm-gg (anche con / o .)
  if((m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/))){
    const d = new Date(+m[1], +m[2]-1, +m[3], 12);
    return isNaN(d.getTime()) ? null : d;
  }
  // Italiano: gg/mm/aaaa (anche con - o .); anno a 2 cifre → 20xx
  if((m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})$/))){
    let y = +m[3]; if(y < 100) y += 2000;
    const d = new Date(y, +m[2]-1, +m[1], 12);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}
// ── LETTORE ROBUSTO DI CELLE NUMERICHE EXCEL ──
// I file esportati in locale italiano scrivono i numeri come TESTO con la
// VIRGOLA come decimale e il PUNTO come separatore delle migliaia
// (es. "1.205,74", "0,14"). Il classico `+valore` su queste stringhe dà NaN e
// faceva scartare le righe. Questa funzione interpreta entrambe le convenzioni:
//   - numero già numerico            → ritorna così com'è
//   - "1.205,74" / "801,80" / "0,14" → virgola=decimale, punti=migliaia → IT
//   - "1.234" (solo punti, gruppi di 3) → migliaia → 1234
//   - "801.80" / "0.14" (punto decimale EN, non a gruppi di 3) → decimale EN
// Ritorna Number, oppure null se la cella è vuota o non numerica.
function parseExcelNumberCell(v){
  if(v == null || v === '') return null;
  if(typeof v === 'number') return isFinite(v) ? v : null;
  let s = String(v).trim().replace(/[€\s ]/g, '');
  if(!s) return null;
  if(s.includes(',')){
    // Formato italiano: i punti sono migliaia, la virgola è il decimale.
    s = s.replace(/\./g, '').replace(',', '.');
  } else if(/^-?\d{1,3}(\.\d{3})+$/.test(s)){
    // Solo punti a gruppi di 3 → separatori di migliaia (es. 1.234.567).
    s = s.replace(/\./g, '');
  }
  // altrimenti il punto (se c'è) è già un decimale in stile inglese.
  const n = parseFloat(s);
  return isFinite(n) ? n : null;
}
// Parsa l'Excel selezionato dall'utente e POSTa i target a /targets/bulk con
// replace_all=true (sostituisce tutto il dataset esistente in MongoDB).
// Il parsing avviene 100% client-side via SheetJS, niente backend coinvolto
// per la lettura del file. Solo l'admin vede questo bottone.
async function uploadTargetsExcel(event){
  const file = event.target.files && event.target.files[0];
  if(!file) return;
  const btn = document.getElementById('btn-targets-upload');
  const orig = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ Leggo Excel…';
  try{
    if(typeof XLSX === 'undefined') throw new Error('Libreria XLSX non caricata. Ricarica la pagina e riprova.');
    const ab = await file.arrayBuffer();
    const wb = XLSX.read(ab, {type:'array', cellDates:true});
    if(!wb.SheetNames.includes('TGT Giornaliero')){
      throw new Error(`Foglio "TGT Giornaliero" non trovato. Fogli presenti: ${wb.SheetNames.join(', ')}`);
    }
    const ws = wb.Sheets['TGT Giornaliero'];
    const range = XLSX.utils.decode_range(ws['!ref']);
    // Helper: normalizza un testo (lowercase, spazi multipli compattati, trim).
    // Tollerante a piccole differenze tipografiche (case, spazi extra).
    const norm = s => String(s==null?'':s).toLowerCase().replace(/\s+/g,' ').trim();
    // 1) Trova la riga di header e la colonna "Data" cercando una cella che
    // contiene esattamente "Data" nelle prime 5 righe del foglio. Tutto il
    // resto è relativo a questa posizione, così l'Excel può avere righe di
    // intestazione vuote o un titolo in cima senza rompere il parsing.
    let headerRowIdx = -1, dateColIdx = -1;
    outer: for(let r = 0; r <= Math.min(range.e.r, 5); r++){
      for(let c = 0; c <= range.e.c; c++){
        const cell = ws[XLSX.utils.encode_cell({r, c})];
        if(cell && norm(cell.v) === 'data'){
          headerRowIdx = r;
          dateColIdx = c;
          break outer;
        }
      }
    }
    if(headerRowIdx < 0) throw new Error('Cella "Data" non trovata nelle prime 5 righe del foglio. Controlla la struttura del file.');
    // 2) Per ogni colonna nella riga header, normalizza il testo e cerca il
    // mapping. Le colonne non riconosciute vengono ignorate (es. negozi non
    // monitorati, colonna TOTALE, ecc.).
    const colToStore = {}; // colIdx → [brand, location]
    const seen = new Set();
    for(let c = 0; c <= range.e.c; c++){
      const cell = ws[XLSX.utils.encode_cell({r: headerRowIdx, c})];
      if(!cell || !cell.v) continue;
      const key = norm(cell.v);
      const mapped = TARGETS_HEADER_MAP[key];
      if(mapped){
        colToStore[c] = mapped;
        seen.add(key);
      }
    }
    const matchedCount = Object.keys(colToStore).length;
    // expectedCount conta negozi unici (non chiavi — più alias puntano allo stesso negozio)
    const expectedCount = new Set(Object.values(TARGETS_HEADER_MAP).map(v=>v.join('|'))).size;
    if(!matchedCount){
      throw new Error('Nessun negozio riconosciuto negli header Excel. Verifica che i nomi corrispondano a quelli attesi (es. "yamamay Polignano City (A. Moro)").');
    }
    // Lista negozi attesi che mancano nell'Excel (per warning informativo).
    // Usa un Set per evitare duplicati quando più alias puntano allo stesso negozio.
    const missingSet = new Set();
    for(const k of Object.keys(TARGETS_HEADER_MAP)){
      if(!seen.has(k)) missingSet.add(TARGETS_HEADER_MAP[k].join(' '));
    }
    // Rimuovi dal set i negozi che sono stati trovati tramite un altro alias
    for(const [c, [b,l]] of Object.entries(colToStore)) missingSet.delete(`${b} ${l}`);
    const missing = [...missingSet];
    // 3) Itera sulle righe dati (da headerRowIdx+1 in poi). Per ogni riga,
    // legge la data dalla colonna "Data" trovata sopra, poi i target dalle
    // colonne riconosciute. Righe senza data valida vengono saltate (gestisce
    // automaticamente eventuali righe vuote, totali, note in fondo al foglio).
    const targets = [];
    for(let r = headerRowIdx + 1; r <= range.e.r; r++){
      const dateCell = ws[XLSX.utils.encode_cell({r, c: dateColIdx})];
      if(!dateCell || dateCell.v == null) continue;
      // Lettore robusto: accetta date vere, numeri seriali Excel e date-testo.
      const d = parseExcelDateCell(dateCell.v);
      if(!d) continue;
      // ISO dai componenti locali per evitare drift di timezone.
      const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      for(const colStr of Object.keys(colToStore)){
        const c = +colStr;
        const [brand, location] = colToStore[c];
        const cell = ws[XLSX.utils.encode_cell({r, c})];
        let val = 0;
        if(cell && cell.v != null){
          // parseExcelNumberCell: gestisce target in formato italiano-testo (1.551,03).
          const n = parseExcelNumberCell(cell.v);
          if(n!==null) val = Math.round(n*100)/100;
        }
        targets.push({brand, location, date: dateStr, target: val});
      }
    }
    if(!targets.length) throw new Error('Nessun target estratto. Verifica che il foglio contenga date e numeri.');
    btn.textContent = `📤 Carico ${targets.length} target…`;
    const r = await api('/targets/bulk', {
      method: 'POST',
      body: JSON.stringify({targets, replace_all: true}),
    });
    if(!r.ok){
      let detail = 'Errore '+r.status;
      try{const e=await r.json(); if(e.detail) detail = typeof e.detail==='string'?e.detail:JSON.stringify(e.detail);}catch(_){}
      throw new Error(detail);
    }
    const res = await r.json();
    let msg = `✓ Target caricati con successo.\n\n`;
    msg += `Negozi riconosciuti: ${matchedCount}/${expectedCount}\n`;
    msg += `Righe inviate: ${targets.length}\n`;
    msg += `Nuovi: ${res.upserted} · Aggiornati: ${res.modified}`;
    if(missing.length){
      msg += `\n\n⚠ Attenzione: ${missing.length} negozi attesi non trovati nell'Excel:\n• ${missing.join('\n• ')}`;
    }
    alert(msg);
    // Ricarica i target nella memoria locale e ridisegna le card per
    // riflettere subito le nuove percentuali, senza aspettare il prossimo sync.
    targetsByKey = await fetchTargets();
    renderAll();
  }catch(e){
    console.error('uploadTargetsExcel', e);
    alert('Errore upload Excel target:\n'+(e.message||e));
  }finally{
    btn.disabled = false;
    btn.textContent = orig;
    // Reset dell'input così se ricarichi lo stesso file il change scatta di nuovo
    event.target.value = '';
  }
}
// ── UPLOAD STORICO INCASSI EXCEL (admin only) ──
// Format atteso (long): tre colonne nell'ordine "Nome store in Dashboard",
// "Data", "Net Sales". Una riga per ogni (negozio, data). I 30 negozi presenti
// nei file dell'utente includono anche punti vendita non monitorati (Putignano,
// Casamassima, S. Caterina, ecc.): vengono ignorati silenziosamente.
//
// MATCHER FUZZY DEL NOME NEGOZIO (Excel storico/consuntivi).
// I file Excel reali hanno nomi più estesi e variabili rispetto ai nomi
// canonici della dashboard (ALL_STORES). Esempi visti in produzione:
//   "adidas Rende Metropolis"                  → Adidas / Rende
//   "carpisa Bari Santa Caterina Mongolfiera"  → Carpisa / S. Caterina
//   "yamamay Lecce City (Sauro)"               → Yamamay / Lecce
//   "carpisa Bari City (Sparano)"              → Carpisa / Sparano
// Strategia: invece di una mappa hardcoded fragile (basta un trattino o uno
// spazio in più per saltare un negozio intero, come successo per Adidas Rende),
// uso un match per token. Estraggo le parole significative del nome nel file
// e cerco lo store ALL_STORES che ha più token in comune (brand obbligatorio,
// almeno un token location). Funziona anche con nomi futuri non previsti, finché
// il brand e la "parola identificante" della location sono presenti.
//
// Caso "due punti vendita stessa città stesso brand": oggi NON c'è (Brindisi
// ha 2 Adidas ma con location distinte "City" e "Colonne", ed entrambi i nomi
// nel file hanno il discriminatore). Quando in futuro succederà — l'utente
// l'ha già anticipato come scenario — basterà aggiungere un override esplicito
// in STORE_TOKEN_OVERRIDES sotto, per forzare token aggiuntivi obbligatori
// (es. 'adidas|taranto centro' richiede la presenza della parola "centro"
// nel nome del file, distinguendolo da "adidas Taranto Mongolfiera").
const STORE_TOKEN_OVERRIDES = {
  // Chiave: 'brand|location' lowercase. Valore: array di token aggiuntivi
  // (oltre a quelli derivati automaticamente dalla location).
  // Esempi (non attivi, ipotetici futuri):
  // 'adidas|taranto':        ['mongolfiera'],
  // 'adidas|taranto centro': ['centro'],
};

// Tokenizza una stringa estraendone le "parole significative" per il match:
// lowercase, punteggiatura → spazi, spazi compressi, scartati token ≤ 1
// carattere (così "S. Caterina" → ['caterina'] e non ['s', 'caterina'] che
// matcherebbe qualsiasi cosa contenga 's' o 'caterina').
function _tokenizeStoreName(str){
  return String(str||'')
    .toLowerCase()
    .replace(/[.,()\-\/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(t => t.length >= 2);
}

// Costruisce per ogni store di ALL_STORES la sua firma di token (brand + loc + override).
// Chiamata una volta all'inizio di ogni upload (ALL_STORES ha 30 entries, costo trascurabile).
function buildStoreTokens(){
  return ALL_STORES.map(s => {
    const overrideKey = `${s.brand.toLowerCase()}|${s.location.toLowerCase()}`;
    const extra = (STORE_TOKEN_OVERRIDES[overrideKey] || []).map(t => t.toLowerCase());
    return {
      brand: s.brand,
      location: s.location,
      brandToken: s.brand.toLowerCase(),
      locTokens: _tokenizeStoreName(s.location).concat(extra),
    };
  });
}

// Dato un nome dal file Excel, trova lo store ALL_STORES più probabile.
// Ritorna [brand, location] oppure null. Casi null:
//   - brand non presente nel nome
//   - nessun token location combacia
//   - più store hanno lo stesso score (tie ambiguo → meglio segnalare che indovinare)
function matchStoreFromName(rawName, storeTokens){
  const toks = new Set(_tokenizeStoreName(rawName));
  if(!toks.size) return null;
  let best = null, bestScore = 0, tied = false;
  for(const s of storeTokens){
    if(!toks.has(s.brandToken)) continue;
    let score = 0;
    for(const lt of s.locTokens){
      if(toks.has(lt)) score++;
    }
    if(score === 0) continue;
    if(score > bestScore){
      bestScore = score;
      best = s;
      tied = false;
    } else if(score === bestScore && best && (s.brand !== best.brand || s.location !== best.location)){
      tied = true;
    }
  }
  if(tied) return null;
  return best ? [best.brand, best.location] : null;
}
// mode: 'py'         → "Storico anno scorso" (file di riferimento, caricato una volta l'anno).
//                       Cancella e ricarica TUTTO l'anno currentYear-1 dal file.
// mode: 'consuntivi'  → "Consuntivi nuovi" (incassi anno corrente, aggiornati periodicamente).
//                       Cancella e ricarica TUTTO l'anno currentYear dal file.
// In entrambi i casi il file caricato è LA fonte di verità per il suo anno target: prima di
// inserire, il backend cancella tutti i record con date in quell'anno. Così se sbagli a inserire
// un negozio in un mese precedente, ti basta correggerlo nel file e ricaricare — i vecchi valori
// spariscono. Gli anni non toccati restano intatti, e i PDF GoAudits restano fallback per i
// giorni non coperti dall'Excel (regola "Excel è la bibbia, PDF è il fallback" in renderTempo).
async function uploadHistoricalExcel(event, mode){
  const file = event.target.files && event.target.files[0];
  if(!file) return;
  // L'anno target dipende dal pulsante usato: PY = anno scorso, Consuntivi = anno corrente.
  // Calcolato sul client per evitare drift se il backend è in un altro fuso orario.
  const currentYear = new Date().getFullYear();
  const targetYear = mode === 'py' ? currentYear - 1 : currentYear;
  const btnId = mode === 'py' ? 'btn-historical-py-upload' : 'btn-historical-cur-upload';
  const labelHuman = mode === 'py' ? `Storico ${targetYear}` : `Consuntivi ${targetYear}`;
  const btn = document.getElementById(btnId);
  const orig = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ Leggo Excel…';
  try{
    if(typeof XLSX === 'undefined') throw new Error('Libreria XLSX non caricata. Ricarica la pagina e riprova.');
    const ab = await file.arrayBuffer();
    const wb = XLSX.read(ab, {type:'array', cellDates:true});
    if(!wb.SheetNames.length) throw new Error('File Excel vuoto.');
    // Uso il primo foglio (i file di esempio dell'utente hanno "Foglio1").
    // Se in futuro il file ha più fogli con la stessa struttura, posso
    // iterare tutti i fogli — ma per ora KISS.
    const ws = wb.Sheets[wb.SheetNames[0]];
    const range = XLSX.utils.decode_range(ws['!ref']);
    const norm = s => String(s==null?'':s).toLowerCase().replace(/\s+/g,' ').trim();
    // 1) Identifica le colonne. Le prime 3 sono OBBLIGATORIE (nome, data, net
    // sales); le 5 KPI sono OPZIONALI — se assenti, il file viene caricato come
    // prima (solo netSales) e i KPI restano null sul backend.
    // Header tipico nuovo file: Store | Data | Net Sales AC | Quantity | Walk-in | Nr. Scontrini | CR | UPT
    // Header tipico vecchio file: Nome store in Dashboard | Data | Net Sales
    // Tollerante a varianti: matching con substring + nomi alternativi.
    let nameCol=-1, dateCol=-1, valueCol=-1;
    let walkInCol=-1, quantityCol=-1, scontriniCol=-1, crCol=-1, uptCol=-1;
    for(let c=0; c<=range.e.c; c++){
      const h=norm(ws[XLSX.utils.encode_cell({r:0,c})]?.v);
      if(!h) continue;
      if(h.includes('nome store') || h==='store' || h==='negozio') nameCol=c;
      else if(h==='data' || h==='date') dateCol=c;
      else if(h.includes('net sales') || h.includes('netto') || h.includes('incasso') || h.includes('vendite')) valueCol=c;
      // ── NUOVI CAMPI KPI (opzionali) ──
      // Walk-in = Ingressi (foot traffic). Header può essere "Walk-in", "Walk in", "Ingressi", "Footfall".
      else if(h==='walk-in' || h==='walk in' || h==='walkin' || h==='ingressi' || h==='footfall') walkInCol=c;
      // Quantity = Unità vendute / pezzi.
      else if(h==='quantity' || h==='quantità' || h==='unità' || h==='pezzi' || h.includes('unità vendute')) quantityCol=c;
      // Nr. Scontrini = numero transazioni. Header può avere "n.", "nr.", "num.", "numero".
      else if(h.includes('scontrini') || h.includes('transazioni') || h.includes('receipts')) scontriniCol=c;
      // CR = Conversion Rate. Header esatto "cr" o variante "conversion rate".
      else if(h==='cr' || h==='cr%' || h.includes('conversion rate') || h.includes('tasso conv')) crCol=c;
      // UPT = Units per Transaction. Header esatto "upt" o "units per transaction".
      else if(h==='upt' || h.includes('units per transaction') || h.includes('unità per')) uptCol=c;
    }
    if(nameCol<0) throw new Error('Colonna "Store" / "Nome store in Dashboard" non trovata nella riga 1.');
    if(dateCol<0) throw new Error('Colonna "Data" non trovata nella riga 1.');
    if(valueCol<0) throw new Error('Colonna "Net Sales" / "Net Sales AC" non trovata nella riga 1.');
    // Diagnostica: quante colonne KPI ho trovato. Utile per dare feedback nell'alert finale.
    const kpiColsFound = [walkInCol,quantityCol,scontriniCol,crCol,uptCol].filter(c=>c>=0).length;
    // 2) Itera sulle righe dati. Conta riconosciuti vs non riconosciuti, date
    // non valide (testo invece di Date Excel!) e righe dell'anno sbagliato.
    // I conteggi vanno nell'alert finale per dare feedback chiaro all'utente.
    // Il matcher fuzzy (matchStoreFromName) sostituisce il vecchio mapping
    // hardcoded: tollera varianti come "adidas Rende Metropolis" o
    // "carpisa Bari Santa Caterina Mongolfiera".
    const storeTokens = buildStoreTokens();
    const entries = [];
    const unrecognized = new Set();
    const wrongYearCounts = {}; // {YYYY: count} → diagnostica se ho sbagliato pulsante
    let nullSkipped = 0;
    let invalidDateSkipped = 0;
    for(let r=1; r<=range.e.r; r++){
      const nameV = ws[XLSX.utils.encode_cell({r,c:nameCol})]?.v;
      if(nameV==null) continue;
      const mapped = matchStoreFromName(nameV, storeTokens);
      if(!mapped){
        unrecognized.add(String(nameV));
        continue;
      }
      // Lettore robusto: accetta date vere, numeri seriali Excel e date-testo.
      const dateV = parseExcelDateCell(ws[XLSX.utils.encode_cell({r,c:dateCol})]?.v);
      if(!dateV){ invalidDateSkipped++; continue; }
      const dateStr = `${dateV.getFullYear()}-${String(dateV.getMonth()+1).padStart(2,'0')}-${String(dateV.getDate()).padStart(2,'0')}`;
      // Validazione anno: se la riga è di un anno diverso da quello target del
      // pulsante, NON la includo. Tengo conto per fail-safe (vedi sotto).
      const rowYear = dateV.getFullYear();
      if(rowYear !== targetYear){
        wrongYearCounts[rowYear] = (wrongYearCounts[rowYear] || 0) + 1;
        continue;
      }
      const valueV = ws[XLSX.utils.encode_cell({r,c:valueCol})]?.v;
      // Salto le righe con valore null/vuoto: significa "nessun dato per
      // quel giorno-negozio", non vogliamo memorizzare 0 fittizi che
      // poi inquinerebbero il confronto anno-su-anno.
      if(valueV==null || valueV===''){ nullSkipped++; continue; }
      // parseExcelNumberCell: gestisce numeri in formato italiano-testo (1.205,74).
      const n = parseExcelNumberCell(valueV);
      if(n===null) continue;
      // Helper interno: legge una cella KPI opzionale e ritorna number o null.
      // Tratta null/'' come "non pervenuto" (→ null al backend, esclude dal $set).
      // Tratta lo 0 esplicito come dato valido (il negozio non ha venduto nulla).
      const readKpi = (col) => {
        if(col < 0) return null;
        const v = ws[XLSX.utils.encode_cell({r,c:col})]?.v;
        if(v==null || v==='') return null;
        return parseExcelNumberCell(v);
      };
      const entry = {
        brand: mapped[0],
        location: mapped[1],
        date: dateStr,
        netSales: Math.round(n*100)/100,
      };
      // KPI opzionali: aggiunti all'entry solo se valorizzati nel file. Il
      // backend (HistoricalEntry) li accetta come Optional[float]=None.
      // walkIn/quantity/scontrini sono interi attesi: arrotondo per pulizia.
      // cr/upt sono decimali puri (es 0.1747): NON arrotondo, mantengo precisione.
      const wi = readKpi(walkInCol);   if(wi!==null) entry.walkIn   = Math.round(wi);
      const qt = readKpi(quantityCol); if(qt!==null) entry.quantity = Math.round(qt);
      const sc = readKpi(scontriniCol);if(sc!==null) entry.scontrini= Math.round(sc);
      const cr = readKpi(crCol);       if(cr!==null) entry.cr       = cr;
      const up = readKpi(uptCol);      if(up!==null) entry.upt      = up;
      entries.push(entry);
    }
    // 3) Validazione difensiva: se il file contiene SOLO righe di un anno
    // diverso (es. ho cliccato "Consuntivi nuovi" ma ho caricato il file 2025),
    // blocco PRIMA di cancellare l'anno target (che sarebbe vuoto → wipe!).
    // L'utente conferma esplicitamente se è davvero ciò che vuole.
    if(!entries.length){
      const wrongYears = Object.keys(wrongYearCounts);
      if(wrongYears.length){
        const detail = wrongYears.map(y => `${y}: ${wrongYearCounts[y]} righe`).join(', ');
        throw new Error(
          `Hai cliccato "${labelHuman}" ma il file contiene solo dati di anni diversi (${detail}).\n\n`+
          `Verifica di aver scelto il pulsante giusto, oppure controlla che le celle Data siano in formato Data (non testo).`
        );
      }
      // Messaggio diagnostico: dice ESATTAMENTE perché nessuna riga è passata.
      const diag = [];
      if(invalidDateSkipped) diag.push(`${invalidDateSkipped} righe con data non leggibile`);
      if(unrecognized.size)  diag.push(`${unrecognized.size} negozi non riconosciuti (es. "${[...unrecognized][0]}")`);
      if(nullSkipped)        diag.push(`${nullSkipped} righe senza valore Net Sales`);
      const why = diag.length ? `\n\nDettaglio: ${diag.join(' · ')}.` : '';
      throw new Error('Nessun dato valido estratto dal file.'+why+'\n\nControlla che la colonna Data contenga date e la colonna Net Sales numeri.');
    }
    btn.textContent = `📤 Carico ${entries.length} record…`;
    // replace_years=[targetYear]: il backend cancella TUTTI i record di
    // quell'anno prima dell'upsert. Il nuovo file è la fonte unica di verità
    // per il suo anno. Gli altri anni restano intatti.
    const r = await api('/historical/bulk', {
      method: 'POST',
      body: JSON.stringify({entries, replace_all: false, replace_years: [targetYear]}),
    });
    if(!r.ok){
      let detail = 'Errore '+r.status;
      try{const e=await r.json(); if(e.detail) detail = typeof e.detail==='string'?e.detail:JSON.stringify(e.detail);}catch(_){}
      throw new Error(detail);
    }
    const res = await r.json();
    let msg = `✓ ${labelHuman} caricati (anno ${targetYear} sostituito).\n\n`;
    msg += `Record inseriti: ${entries.length}\n`;
    msg += `Nuovi: ${res.upserted} · Aggiornati: ${res.modified}`;
    // Feedback sulle nuove colonne KPI: utile per capire se il file è "nuovo"
    // (con le colonne KPI) o "vecchio" (solo netSales).
    if(kpiColsFound > 0){
      const kpiNames = [];
      if(walkInCol   >= 0) kpiNames.push('Ingressi');
      if(quantityCol >= 0) kpiNames.push('Quantity');
      if(scontriniCol>= 0) kpiNames.push('Scontrini');
      if(crCol       >= 0) kpiNames.push('CR');
      if(uptCol      >= 0) kpiNames.push('UPT');
      msg += `\n📊 Anche KPI caricati: ${kpiNames.join(', ')}`;
    }
    if(nullSkipped) msg += `\nSaltati (valore vuoto): ${nullSkipped}`;
    if(invalidDateSkipped) msg += `\n⚠️ Saltati (cella Data non valida): ${invalidDateSkipped}`;
    const wrongYears = Object.keys(wrongYearCounts);
    if(wrongYears.length){
      const detail = wrongYears.map(y => `${y}: ${wrongYearCounts[y]}`).join(', ');
      msg += `\n⚠️ Ignorate righe di altri anni (${detail}). Usa l'altro pulsante per caricarli.`;
    }
    if(unrecognized.size){
      const list = [...unrecognized].slice(0,5).join(', ');
      msg += `\n\nNegozi non in mapping ignorati (${unrecognized.size}): ${list}`;
      if(unrecognized.size>5) msg += '…';
    }
    alert(msg);
    // Ricarico entrambi gli indici dal backend: netSales (per tab Andamento)
    // e KPI storici (per tab KPI). Sono indipendenti: anche se /historical/kpi
    // fallisce (backend non ancora aggiornato), historicalByKey si ricarica
    // comunque e la tab Andamento continua a funzionare.
    historicalByKey = await fetchHistorical();
    historicalKpiByKey = await fetchHistoricalKpi();
    renderAll();
  }catch(e){
    console.error('uploadHistoricalExcel', e);
    alert(`Errore upload ${labelHuman}:\n`+(e.message||e));
  }finally{
    btn.disabled = false;
    btn.textContent = orig;
    event.target.value = '';
  }
}
async function pushPdfCache(key, data){
  // Best-effort upload. Errori loggati ma non propagati: la cache backend è
  // un'ottimizzazione, non un requisito per il funzionamento.
  try{
    const r=await api('/pdfcache',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({key, data}),
    });
    if(!r.ok){
      let msg='HTTP '+r.status;
      try{const e=await r.json();if(e.detail)msg=typeof e.detail==='string'?e.detail:JSON.stringify(e.detail);}catch(_){}
      console.warn('pushPdfCache failed for',key,msg);
    }
  }catch(e){console.warn('pushPdfCache',e);}
}

async function saveOverride(fileId, field, value){
  // value=null → rimuove l'override per quel singolo campo. value numerico → upsert.
  const body={fields:{[field]: value==null ? null : +value}};
  const r=await api(`/overrides/${encodeURIComponent(fileId)}`,{
    method:'PUT',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(body),
  });
  if(!r.ok){
    let msg='Errore '+r.status;
    try{const e=await r.json();if(e.detail)msg=e.detail;}catch(_){}
    throw new Error(msg);
  }
  return await r.json();
}

// Permessi: solo editor e admin possono modificare i valori cassa. I 'user'
// base hanno sola lettura. Centralizzato qui per coerenza tra backend e UI.
function canEdit(){
  const role = auth && auth.user && auth.user.role;
  return role === 'editor' || role === 'admin';
}

