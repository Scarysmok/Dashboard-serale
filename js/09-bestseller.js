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
  // Selezione corrente: DUE elenchi, le settimane e i negozi, e la classifica
  // è la somma del loro incrocio.
  //   periods  elenco ordinato delle settimane scelte (almeno una)
  //   stores   elenco ordinato di "marchio|negozio"; VUOTO = tutti quelli
  //            disponibili, che è anche come si normalizza "li ho spuntati tutti"
  // Da questi due si ricavano i campi che mezzo modulo legge ancora e che
  // vanno tenuti in accordo — period_start (l'ultima settimana), brand/location
  // (solo con un negozio solo) e aggregate. Ci pensa bsSetCur: è l'unico posto
  // da cui si scrive BS.cur.
  cur: null,
  data: null,       // report caricato
  photos: null,     // elenco file della cartella Drive foto; null = non ancora chiesto
  flags: null,      // {codice:{salePct,carry}} dal file saldi; null = non ancora chiesto
  public: false,     // true in bs.html: sola lettura, senza selettori né valore
  query: '', sort: 'units',
  // Filtri della barra: un ELENCO di valori ciascuno, vuoto = nessun filtro.
  // Sono a spunta come i due selettori in alto, quindi "Calzature e Accessori"
  // o "Uomo e Donna" si possono tenere insieme. Per sconto e carry over i valori
  // sono 'si' e 'no': spuntarli entrambi equivale a non filtrare.
  f: {div: [], gen: [], cat: [], sea: [], sale: [], carry: []},
  detail: null,     // prodotto aperto nella scheda
  busy: false,
  log: [],
  // Selezione a spunta: `pending` = ci sono spunte non ancora applicate (si
  // applicano chiudendo il pannello), `committed` = l'ultimo clic ha fatto
  // partire quel caricamento, `reopen` = pannello da riaprire dopo il ridisegno.
  // `draft` = le spunte in corso, un asse per volta, null quando su quell'asse
  // non se ne stanno facendo. Serve perché in BS.cur l'elenco applicato non può
  // essere vuoto — senza settimane non c'è niente da mostrare, e un elenco
  // negozi vuoto significa "tutti" — mentre a pannello aperto si deve poter
  // arrivare a "nessuno spuntato": è il passaggio obbligato per svuotare e
  // ripartire da capo. Vedi bsCommitSel.
  pending: false, committed: false, reopen: null,
  draft: {periods: null, stores: null},
  // true = il prossimo recupero dell'elenco foto salta la copia locale.
  // Lo accende il tasto ↻ (vedi bsFetchPhotoList).
  photosForce: false,
  loadedKey: null,  // chiave della selezione che sta a schermo (vedi bsCommitSel)
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

// ── File saldi e carry over (nostro, non di adidas) ─────────────────────
// Colonne cercate per NOME, perché nel file c'è una colonna nascosta fra la D e
// la F: le lettere non sono affidabili. Regole date dall'utente il 04/08:
// percentuale presente = va a sconto, assente = no; carry over dalla sua colonna.
const BS_FLAG_CODE  = ['codice','code','product code','sportcode'];
const BS_FLAG_PCT   = ['%','percentuale','sconto','sconto %','saldo %'];
const BS_FLAG_CARRY = ['carry over','carryover','carry'];

// Il 30% può arrivare come numero 0,3 (formato percentuale di Excel), come
// numero 30, o come testo "30%". Fuori da 1..100 → nessuno sconto.
function bsPct(v){
  if(v===null || v===undefined || v==='') return null;
  let n = typeof v === 'number' ? v : parseFloat(String(v).replace('%','').replace(',','.').trim());
  if(!isFinite(n) || n <= 0) return null;
  if(n <= 1) n = n * 100;              // 0,3 → 30
  n = Math.round(n);
  return (n >= 1 && n <= 100) ? n : null;
}
const bsIsSi = v => /^(si|sì|s|yes|y|true|1|x)$/i.test(String(v==null?'':v).trim());

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
    // Settimana più recente, tutti i negozi. Se quella settimana ha un solo
    // negozio ci pensa bsSetCur a capire che l'aggregato non ha senso.
    if(BS.index.length && !BS.cur)
      bsSetCur({periods:[BS.index.map(w=>w.period_start).sort().reverse()[0]], stores:[]});
  }
  if(BS.cur && !BS.data) { await bsLoadCurrent(); return; }
  bsPaint();
}

async function bsLoadCurrent(){
  if(!BS.cur){ bsPaint(); return; }   // nessuna settimana selezionata: mostro lo stato vuoto
  const root = document.getElementById('bs-root');
  if(root) root.innerHTML = bsState('Carico il report…','');
  BS.data = null;
  // Quale selezione sta a schermo: bsCommitSel ci si confronta per non
  // richiedere al server dati che ha già.
  BS.loadedKey = bsCacheKey(BS.cur);
  try{
    const c = BS.cur;
    if(BS.public){
      // Link pubblico: nessun login, nessuna cache locale (bs.html non carica
      // 02-sync.js). Il token decide cosa si può chiedere: se apre tutta la
      // settimana il destinatario cambia negozio, altrimenti resta sul suo.
      BS.data = await bsFetchPublic(c.aggregate ? '' : c.brand+'|'+c.location);
      // BS.photos è già in memoria dal primo caricamento: riagganciarle non
      // costa una richiesta, ma senza questa riga il cambio negozio le perde.
      if(!BS.data.error){ await bsAttachPhotos(BS.data.products); await bsLoadFlags(); }
      bsPaint();
      return;
    }
    const ps = bsPeriodsOf(c);
    const st = c.stores || [];
    // Più settimane o un sottoinsieme di negozi: la somma la fa il server e
    // torna un payload solo. Farla qui vorrebbe dire scaricare e tenere in
    // memoria un aggregato per settimana (~550 kB l'uno) per poi buttarne via la
    // gran parte — su un telefono è proprio il lavoro che non regge.
    const path = (ps.length > 1 || st.length > 1)
      ? '/bestseller/range?periods='+encodeURIComponent(ps.join(','))
        + st.map(s => '&stores='+encodeURIComponent(s)).join('')
      : c.aggregate
        ? '/bestseller/aggregate?period_start='+encodeURIComponent(c.period_start)
        : '/bestseller/week?brand='+encodeURIComponent(c.brand)
          +'&location='+encodeURIComponent(c.location)
          +'&period_start='+encodeURIComponent(c.period_start);
    // Stessa cache degli altri insiemi pesanti: IndexedDB + versione da
    // /datasets/version. L'aggregato è ~550 kB che il backend ricalcola a ogni
    // richiesta (misurato il 03/08) e la versione cambia solo quando si importa.
    BS.data = await fetchCached(bsCacheKey(c), path, _dsVersions.bestseller);
    if(!BS.data || !BS.data.products) BS.data = {error: 'Report non disponibile'};
    else { await bsAttachPhotos(BS.data.products); await bsLoadFlags(); }
  }catch(e){
    BS.data = {error: String(e.message||e)};
  }
  bsPaint();
}

// ── Filtri e ordinamento (stessa logica del design) ─────────────────────
// Un articolo passa un filtro se non è stato spuntato niente (nessun filtro) o
// se il suo valore è fra quelli spuntati.
function bsPassa(campo, valore){
  const sel = BS.f[campo] || [];
  return !sel.length || sel.indexOf(String(valore==null?'':valore)) > -1;
}

// Definizione dei sei filtri: chiave, etichetta del pulsante quando non è
// spuntato niente, e come si ricavano i valori possibili dai prodotti caricati.
// `fissi` sono quelli che non dipendono dai dati (sconto, carry over).
const BS_FILTRI = [
  {k:'div',   lab:'Divisione', da: all => bsUniq(all.map(p=>p.div))},
  {k:'gen',   lab:'Genere',    da: all => bsUniq(all.map(p=>p.gender))},
  {k:'cat',   lab:'Categoria', da: all => bsUniq(all.map(p=>p.cat))},
  {k:'sea',   lab:'Stagione',  da: all => bsUniq(all.map(bsSeason)).sort(bsSeasonCmp)},
  {k:'sale',  lab:'Sconto',    fissi: [{v:'si', t:'A sconto'}, {v:'no', t:'Non a sconto'}]},
  {k:'carry', lab:'Carry over',fissi: [{v:'si', t:'Carry over'}, {v:'no', t:'Non carry over'}]},
];

function bsFiltered(){
  const q = BS.query.trim().toLowerCase();
  const list = (BS.data.products||[]).filter(p =>
    bsPassa('div', p.div) && bsPassa('gen', p.gender) && bsPassa('cat', p.cat) &&
    bsPassa('sea', bsSeason(p)) &&
    bsPassa('sale',  bsFlag(p).salePct ? 'si' : 'no') &&
    bsPassa('carry', bsFlag(p).carry   ? 'si' : 'no') &&
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
      bsLogBox() +
      bsState('Nessun report caricato',
              admin ? 'Usa “Importa Excel” qui sopra per caricare il primo report.'
                    : 'I best seller compariranno qui appena caricati.') +
      bsFooter();
    bsBind();
    return;
  }
  if(BS.data && BS.data.error){
    root.innerHTML = bsStrip() + bsHeader(BS.data) + bsLogBox() +
      bsState('Report non disponibile', BS.data.error) + bsFooter();
    bsBind();
    return;
  }
  if(!BS.data){ root.innerHTML = bsState('Carico il report…',''); return; }

  const d = BS.data;
  const all = d.products || [];
  const list = bsFiltered();
  // C'è qualcosa che restringe la classifica? Serve alle tessere qui sotto e al
  // pulsante Azzera, quindi si calcola una volta sola e prima di tutti e due.
  const hasF = !!BS.query || BS_FILTRI.some(f => (BS.f[f.k]||[]).length);
  const max = list.length ? Math.max(...list.map(p=>p.units)) || 1 : 1;
  // Le tessere contano quello che si sta guardando: con un filtro attivo
  // (es. Bambino) dicono i pezzi e il valore DI QUEL filtrato, non del report
  // intero — altrimenti sotto ci sarebbe una classifica di bambino e sopra un
  // totale di tutti, e i due numeri non parlerebbero della stessa cosa.
  const somma = (arr, campo) => arr.reduce((s,x)=>s+(x[campo]||0),0);
  const totUnits = somma(list, 'units'), totNet = somma(list, 'net');
  // Il n° 1 è quello della classifica corrente: cambia con l'ordinamento
  // (pezzi/valore) e con i filtri, non è il primo dell'array come arriva.
  const first = list[0];
  // Con un filtro attivo la riga sotto il numero dice su quanto: serve a non
  // scambiare un totale parziale per quello di tutto il periodo.
  const su = (n, tot) => hasF ? 'su '+n+' in tutto' : tot;

  const kpis = [
    {l:'Prodotti venduti', v:String(list.length),
     s:su(all.length, 'referenze attive'), size:'clamp(28px,3vw,40px)'},
    {l:'Pezzi totali', v:totUnits.toLocaleString('it-IT'),
     s:su(somma(all,'units').toLocaleString('it-IT'), 'unità sell-out'), size:'clamp(28px,3vw,40px)'},
    {l:'Valore netto', v:bsEur(totNet),
     s:su(bsEur(somma(all,'net')), 'vendite nette periodo'), size:'clamp(24px,2.5vw,34px)'},
    {l:'Best seller n°1', v:first?first.name:'—', s:first?first.code:'', size:'clamp(15px,1.6vw,20px)'},
  ];

  const podium = list.slice(0,3).map((p,i)=>`
    <button class="bs-pcard" data-open="${bsEsc(p.code)}">
      <div class="bs-ptop">
        <div class="bs-prank${i===0?' bs-first':''}">${i+1}</div>
        <div class="bs-pbadge">${i===0?'Best seller':'Top '+(i+1)}</div>
      </div>
      <div class="bs-pimg">${bsImg(p)}</div>
      <div class="bs-pbody">
        <div class="bs-pname">${bsEsc(p.name)}${bsBadges(p)}</div>
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
        <div class="bs-rname"><span class="bs-rn-t">${bsEsc(p.name)}</span>${bsBadges(p)}</div>
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


  root.innerHTML = bsStrip() + bsHeader(d) + `
  <div class="bs-kpiwrap"><div class="bs-kpis">
    ${kpis.map(k=>`<div class="bs-kpi">
      <div class="bs-kpi-l">${bsEsc(k.l)}</div>
      <div class="bs-kpi-v" style="font-size:${k.size}">${bsEsc(k.v)}</div>
      <div class="bs-kpi-s">${bsEsc(k.s)}</div></div>`).join('')}
  </div></div>
  ${bsLogBox()}
  ${list.length>=3?`<section class="bs-section">
    <div class="bs-sechead"><h3>Podio</h3><div class="bs-rule"></div>
      <span class="bs-secmeta">Top 3 · ${BS.sort==='units'?'per pezzi venduti':'per valore netto'}</span></div>
    <div class="bs-podium">${podium}</div>
  </section>`:''}
  <div class="bs-tools"><div class="bs-tools-in">
    <div class="bs-search"><span>⌕</span>
      <input id="bs-q" value="${bsEsc(BS.query)}" placeholder="Cerca nome o codice"></div>
    ${BS_FILTRI.map(f => bsFilterPicker(f, all)).join('')}
    <div class="bs-sortgrp">
      <button class="bs-sortbtn${BS.sort==='units'?' bs-on':''}" data-sort="units">Pezzi</button>
      <button class="bs-sortbtn${BS.sort==='net'?' bs-on':''}" data-sort="net">Valore</button>
    </div>
    ${hasF?'<button class="bs-reset" id="bs-reset">Azzera ✕</button>':''}
  </div></div>
  <section class="bs-section bs-list">
    <div class="bs-sechead bs-tight"><h3>Classifica</h3><div class="bs-rule"></div>
      <span class="bs-secmeta">${list.length} prodotti · ${list.reduce((s,x)=>s+(x.units||0),0)} pz${
        bsPeriodsOf(d).length > 1 ? ' · giacenza a fine periodo' : ''}</span></div>
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

// Un filtro della barra, con la stessa grafica e la stessa logica a spunta dei
// selettori settimana e negozio in testata. Prima era un <select> nativo: la
// tendina la disegnava il sistema operativo (fondo blu, spunta di sistema) e non
// si poteva né portare nello stile del modulo né rendere a scelta multipla.
//
// Il pulsante è una pillola come le altre della barra. Quando non c'è niente di
// spuntato mostra il nome del filtro ("Divisione"); con un valore mostra quello,
// con più di uno "Divisione · 3", perché elencarli non ci starebbe.
function bsFilterPicker(f, all){
  const sel = BS.f[f.k] || [];
  const voci = f.fissi || (f.da(all) || []).map(v => ({v, t: v}));
  if(!voci.length) return '';
  const testa = !sel.length ? f.lab
    : (sel.length === 1
        ? ((voci.find(o => o.v === sel[0]) || {t: sel[0]}).t)
        : f.lab + ' · ' + sel.length);
  return `<div class="bs-picker bs-multi bs-fpick" data-picker="f-${f.k}">
    <button class="bs-picker-btn bs-fbtn${sel.length?' bs-on':''}" aria-haspopup="listbox"
      aria-expanded="false">
      <span class="bs-picker-cur">${bsEsc(testa)}</span>
      <span class="bs-picker-chev">▼</span>
    </button>
    <div class="bs-picker-panel" role="listbox" aria-multiselectable="true">
      ${voci.map(o => {
        const on = sel.indexOf(o.v) > -1;
        return `<button class="bs-picker-opt${on?' bs-sel':''}" role="option"
          aria-selected="${on}" data-f="${bsEsc(f.k)}" data-fv="${bsEsc(o.v)}">
          <span class="bs-picker-mark"></span>
          <span class="bs-picker-lab">${bsEsc(o.t)}</span></button>`;
      }).join('')}
    </div>
  </div>`;
}

// Giacenza residua dell'articolo (colonna OHQ dell'export).
// Nell'aggregato è la somma delle giacenze dei negozi di quella settimana.
// Con più settimane selezionate è la giacenza dell'ULTIMA: è una fotografia
// dello stock, non un flusso, e sommarla settimana su settimana conterebbe più
// volte la stessa merce invenduta (la somma la fa il backend, _bs_sum_docs).
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
// Immagine dell'articolo, col segnaposto sempre sotto.
//
// Il segnaposto c'è sempre e la foto ci si appoggia sopra: se l'articolo non ha
// foto non viene disegnata, se ce l'ha ma non si carica `onerror` la toglie, e
// in entrambi i casi resta scoperto quello che sta sotto. Prima erano due
// strade diverse — stringa vuota da una parte, immagine nascosta dall'altra —
// che finivano nello stesso riquadro grigio vuoto: una sola strada è più
// difficile da rompere per metà.
//
// L'icona è disegnata qui e non è un file: nessuna richiesta di rete in più,
// niente da caricare su Vercel, e il link pubblico se la prende da solo.
function bsImg(p){
  const cod = bsEsc(p.code || '');
  const ph = `<span class="bs-ph" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"
      stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="4.5" width="18" height="15" rx="2.5"/>
      <circle cx="8.5" cy="10" r="1.5"/>
      <path d="M3.8 17.5 8.4 13a1.9 1.9 0 0 1 2.7 0l3.4 3.4"/>
      <path d="M14 15.2 15.7 13.5a1.9 1.9 0 0 1 2.7 0l1.8 1.8"/>
    </svg>${cod?`<i>${cod}</i>`:''}</span>`;
  // `onload` nasconde il segnaposto, `onerror` toglie l'immagine e lo lascia.
  // Nasconderlo serve: le foto dell'export adidas sono PNG TRASPARENTI e per
  // giunta in mix-blend-mode multiply, quindi un segnaposto lasciato sotto si
  // vede attraverso la scarpa. Va nascosto al caricamento e non prima, così
  // finché l'immagine sta arrivando il riquadro non è vuoto.
  return ph + (p.img
    ? `<img src="${bsEsc(bsPhotoSrc(p.img))}" alt="" loading="lazy"
        onload="if(this.previousElementSibling)this.previousElementSibling.style.display='none'"
        onerror="this.remove()">`
    : '');
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

// Legge il file saldi/carry over. Trova la riga di intestazione cercando una
// colonna che somigli a "Codice": nel file c'è del preambolo sopra, e comunque
// non si può contare sulla riga fissa.
function bsParseFlags(ab, fileName){
  const wb = XLSX.read(ab, {type:'array', cellDates:true});
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, {header:1, raw:true, defval:null});
  const trova = (riga, nomi) => riga.findIndex(c => nomi.includes(bsNormCol(c)));

  let head = -1, iCode = -1;
  for(let i=0; i<Math.min(rows.length, 30); i++){
    const k = trova(rows[i]||[], BS_FLAG_CODE);
    if(k > -1){ head = i; iCode = k; break; }
  }
  if(head < 0) throw new Error(`${fileName}: non trovo la colonna "Codice".`);
  const iPct = trova(rows[head], BS_FLAG_PCT);
  const iCarry = trova(rows[head], BS_FLAG_CARRY);
  if(iPct < 0 && iCarry < 0)
    throw new Error(`${fileName}: non trovo né la colonna "%" né "Carry Over".`);

  const items = [];
  const visti = new Set();
  for(let i=head+1; i<rows.length; i++){
    const r = rows[i]; if(!r) continue;
    const code = String(r[iCode]==null?'':r[iCode]).trim().toUpperCase();
    if(!code || visti.has(code)) continue;
    visti.add(code);
    items.push({code,
      salePct: iPct   < 0 ? null : bsPct(r[iPct]),
      carry:   iCarry < 0 ? false : bsIsSi(r[iCarry])});
  }
  if(!items.length) throw new Error(`${fileName}: nessun codice articolo trovato.`);
  return {items, colonne: {codice: iCode, percentuale: iPct, carry: iCarry}};
}

// Import del file: sostituisce l'insieme sul server e ricarica i badge.
async function bsImportFlags(file){
  BS.busy = true; bsPaint();
  try{
    bsLog(`Leggo ${bsEsc(file.name)}…`);
    const {items} = bsParseFlags(await file.arrayBuffer(), file.name);
    const r = await api('/bestseller/flags', {method:'PUT', body: JSON.stringify({items})});
    if(!r.ok) throw new Error('errore '+r.status);
    const e = await r.json();
    bsLog(`Importati <b>${e.articoli}</b> articoli · <b>${e.aSconto}</b> a sconto · `
      + `<b>${e.carryOver}</b> carry over`
      + (e.duplicati ? ` · ${e.duplicati} codici ripetuti ignorati` : ''), true);
    BS.flags = null;                 // la prossima pittura li richiede
    await bsLoadFlags();
  }catch(err){
    bsLog('Import saldi fallito: '+bsEsc(err.message||err), true);
  }
  BS.busy = false;
  bsPaint();
}

// {codice: {salePct, carry}}. Nel link pubblico arrivano col payload.
async function bsLoadFlags(){
  if(BS.flags) return BS.flags;
  if(BS.public){ BS.flags = (BS.data||{}).flags || {}; return BS.flags; }
  try{
    BS.flags = await fetchCached('bs:flags', '/bestseller/flags', _dsVersions.bsflags);
  }catch(e){ console.debug('bsLoadFlags', e); BS.flags = {}; }
  return BS.flags;
}

// Flag di un articolo, sempre un oggetto: così chi lo usa non deve controllare.
const bsFlag = p => (BS.flags || {})[String(p.code||'').toUpperCase()] || {};

// I due badge accanto al nome. Il chip rosso dice solo SALES: la percentuale
// resta memorizzata (è il criterio con cui il file marca l'articolo, e regge il
// filtro) ma non si mostra più, scelta dell'utente del 04/08.
function bsBadges(p){
  const f = bsFlag(p);
  return (f.carry ? '<span class="bs-co" title="Carry over">CO</span>' : '')
       + (f.salePct ? '<span class="bs-sale" title="Va a sconto">Sales</span>' : '');
}

// Unico punto da cui la pagina pubblica prende i dati: niente api(), niente
// cache, solo il token. `store` vuoto = aggregato. Se il token è di un singolo
// negozio il server ignora `store`, quindi da qui non si esce dal permesso.
async function bsFetchPublic(store){
  const q = store ? '&store='+encodeURIComponent(store) : '';
  const r = await fetch(API_BASE+'/public/bestseller?t='+encodeURIComponent(BS.token||'')+q);
  if(r.status === 404) return {error:'Link non più valido: chiedi al tuo area manager un link aggiornato'};
  if(!r.ok) return {error:'Errore '+r.status};
  return await r.json();
}

// Chiave della copia locale. Deve distinguere ogni selezione, altrimenti una
// settimana servirebbe i dati di un'altra.
// Con una settimana sola la chiave è identica a quella di sempre: le copie già
// sui dispositivi restano valide e nessuno si ritrova a riscaricare 550 kB solo
// perché abbiamo aggiunto la selezione multipla.
function bsCacheKey(c){
  const ps = bsPeriodsOf(c);
  const st = (c.stores || []);
  // Sottoinsieme di negozi, o più settimane: chiave nuova, che li elenca
  // entrambi. Altrimenti (una settimana × un negozio, o × tutti) resta quella
  // di sempre.
  if(ps.length > 1 || st.length > 1)
    return 'bs:' + (st.length ? st.join('+') : 'agg') + '|' + ps.join(',');
  return 'bs:' + (c.aggregate ? 'agg|'+c.period_start
                              : [c.brand, c.location, c.period_start].join('|'));
}

// Settimane di una selezione, sempre come elenco ordinato. Regge anche le
// selezioni "vecchia forma" (solo period_start), che arrivano dalla pagina
// pubblica e dai punti che non sono ancora passati da bsSetCur.
function bsPeriodsOf(c){
  if(!c) return [];
  const ps = (c.periods && c.periods.length) ? c.periods.slice() : [c.period_start];
  return ps.filter(Boolean).sort();
}
const bsCurPeriods = () => bsPeriodsOf(BS.cur);

// Chiave di un negozio, la stessa forma che viaggia verso il backend.
const bsStoreKey = w => w.brand+'|'+w.location;

// Negozi scelti, sempre come elenco esplicito di voci dell'indice: BS.cur.stores
// vuoto significa "tutti", e qui diventa l'elenco vero di quelli disponibili
// nelle settimane spuntate. Chi disegna e chi carica non deve ricordarsi la
// convenzione dell'elenco vuoto.
function bsCurStores(){
  const disp = bsStoresIn(bsCurPeriods());
  const sel = (BS.cur && BS.cur.stores) || [];
  if(!sel.length) return disp;
  const dentro = disp.filter(w => sel.indexOf(bsStoreKey(w)) > -1);
  return dentro.length ? dentro : disp;   // selezione ormai vuota → tutti
}

// Spuntati IN QUESTO MOMENTO: le spunte in corso se il pannello è aperto,
// altrimenti la selezione applicata. È quello che si disegna; quello che si
// carica sono bsCurPeriods/bsCurStores, che non conoscono l'elenco vuoto.
function bsDraftStores(){
  const d = BS.draft.stores;
  return d !== null ? d.slice() : bsCurStores().map(bsStoreKey);
}
function bsDraftPeriods(){
  const d = BS.draft.periods;
  return d !== null ? d.slice() : bsCurPeriods();
}

// Unico punto in cui si scrive BS.cur: normalizza i due elenchi e ricava da
// essi period_start, brand/location e aggregate. Scriverli a mano altrove
// significa prima o poi lasciarli in disaccordo fra loro.
function bsSetCur(sel){
  if(!sel){ BS.cur = null; return null; }
  const ps = bsPeriodsOf(sel);
  const disp = bsStoresIn(ps).map(bsStoreKey);
  let st = (sel.stores || []).slice().filter(k => disp.indexOf(k) > -1).sort();
  // Spuntati tutti = nessun filtro: una sola forma per la stessa cosa, così la
  // chiave di cache e quella del link non si sdoppiano.
  if(st.length === disp.length) st = [];
  const eff = st.length ? st : disp;          // quelli davvero inclusi
  const uno = eff.length === 1 ? eff[0].split('|') : null;
  BS.cur = Object.assign({}, sel, {
    periods: ps, period_start: ps[ps.length-1] || '', stores: st,
    brand: uno ? uno[0] : '', location: uno ? uno[1] : '',
    aggregate: !uno,
  });
  return BS.cur;
}

// Report disponibili raggruppati per settimana: {period_start: [voci indice]}.
function bsWeeks(){
  const weeks = {};
  (BS.index||[]).forEach(w => { (weeks[w.period_start] = weeks[w.period_start] || []).push(w); });
  return weeks;
}

// Negozi presenti in TUTTE le settimane indicate. Con più settimane è
// l'intersezione e non l'unione: un negozio che ha caricato 3 file su 4 darebbe
// un totale su un periodo più corto degli altri, e nella classifica accanto
// sembrerebbe semplicemente che ha venduto meno.
function bsStoresIn(periods){
  const weeks = bsWeeks();
  const conta = new Map();
  periods.forEach(ps => (weeks[ps]||[]).forEach(w => {
    const k = w.brand+'|'+w.location;
    if(!conta.has(k)) conta.set(k, {w, n:0});
    conta.get(k).n++;
  }));
  return [...conta.values()].filter(x => x.n === periods.length).map(x => x.w);
}

// Etichetta della selezione per il pulsante: "W31" con una sola settimana,
// "W29–W32 · 4 sett." se sono consecutive, "4 settimane" se ci sono buchi
// (dire "W29–W34" quando due settimane in mezzo non ci sono sarebbe falso).
function bsWeeksLabel(periods){
  if(!periods.length) return '—';
  if(periods.length === 1) return bsWeekLabel(periods[0]);
  const keys = Object.keys(bsWeeks()).sort();
  const i = keys.indexOf(periods[0]), j = keys.indexOf(periods[periods.length-1]);
  const contigue = i > -1 && j - i + 1 === periods.length;
  const n = periods.length + ' sett.';
  return contigue
    ? 'W'+bsWeekNum(periods[0])+'–W'+bsWeekNum(periods[periods.length-1])+' · '+n
    : periods.length + ' settimane';
}

// "2026-07-06", "2026-08-02" → "06/07 – 02/08".
function bsRangeTxt(a, b){
  const short = t => bsPeriodLabel(t).replace(/\/\d{4}$/,'');
  if(!a) return '';
  return b ? short(a)+' – '+short(b) : short(a);
}

// Etichetta del selettore negozi: il nome se è uno solo, "★ Tutti i negozi" se
// ci sono tutti, altrimenti quanti sono — con un sottoinsieme scrivere "tutti"
// sarebbe una bugia, ed elencarne quattro non ci sta nel pulsante.
function bsStoresLabel(disponibili, scelti){
  if(!scelti.length) return '—';
  if(scelti.length === 1) return scelti[0].replace('|', ' · ');
  return scelti.length === disponibili.length
    ? '★ Tutti i negozi' : scelti.length + ' negozi';
}

// Periodo coperto dalla selezione, in chiaro: "06/07 – 02/08".
function bsSpanLabel(periods){
  const weeks = bsWeeks();
  const a = (weeks[periods[0]]||[])[0], b = (weeks[periods[periods.length-1]]||[])[0];
  if(!a) return '';
  return bsRangeTxt(a.period_start, (b && b.period_end) || periods[periods.length-1]);
}

// Due selettori distinti, SETTIMANA e NEGOZIO. La settimana comanda: la lista
// negozi contiene solo chi ha caricato quella settimana, così non si può
// scegliere una combinazione senza dati (deciso il 03/08).
// Sono listbox costruiti a mano perché la tendina di un <select> nativo la
// disegna il sistema operativo e non si può portare nello stile del modulo.
function bsHeader(d){
  const weeks = bsWeeks();
  const keys = Object.keys(weeks).sort().reverse();
  // Spunte da disegnare = quelle in corso; l'elenco dei negozi si rifà invece
  // dalle settimane APPLICATE, che a differenza delle prime non è mai vuoto.
  const curPeriods = bsDraftPeriods();
  const basePeriods = bsCurPeriods();
  const inSel = ps => curPeriods.indexOf(ps) > -1;

  // ── Selettore settimana: a spunta, si possono sceglierne più d'una e la
  // classifica mostra la somma. Il pannello resta aperto mentre si spunta.
  let curWeek = bsWeeksLabel(curPeriods);
  let weekOpts = '';
  // Scorciatoia per prendere tutto l'archivio in un clic invece di spuntare
  // sette caselle. Ricliccandola le toglie tutte, per ripartire da capo.
  if(keys.length > 1){
    const tutte = curPeriods.length === keys.length;
    weekOpts += `<button class="bs-picker-opt bs-agg${tutte?' bs-sel':''}" role="option"
      aria-selected="${tutte}" data-weekall="1">
      <span class="bs-picker-mark"></span>
      <span class="bs-picker-lab">★ Tutte le week</span>
      <span class="bs-picker-n">${keys.length} sett.</span></button>`;
  }
  keys.forEach(ps => {
    const sel = inSel(ps);
    weekOpts += `<button class="bs-picker-opt${sel?' bs-sel':''}" role="option"
      aria-selected="${sel}" data-week="${bsEsc(ps)}">
      <span class="bs-picker-mark"></span>
      <span class="bs-picker-lab">${bsEsc(bsWeekLabel(ps))}</span>
      <span class="bs-picker-n">${bsEsc(bsWeekRange(weeks[ps][0]))}</span></button>`;
  });

  // ── Selettore negozio: anche questo a spunta, sui negozi presenti in tutte
  // le settimane spuntate. Se ne possono prendere quanti si vuole e la
  // classifica somma quelli.
  const inWeek = bsStoresIn(basePeriods);
  const scelti = bsDraftStores();
  const curStore = bsStoresLabel(inWeek, scelti);
  let storeOpts = '';
  if(inWeek.length > 1){
    const tutti = scelti.length === inWeek.length;
    storeOpts += `<button class="bs-picker-opt bs-agg${tutti?' bs-sel':''}" role="option"
      aria-selected="${tutti}" data-storeall="1">
      <span class="bs-picker-mark"></span>
      <span class="bs-picker-lab">★ Tutti i negozi</span>
      <span class="bs-picker-n">${inWeek.length} negozi</span></button>`;
  }
  inWeek.forEach(w => {
    const k = bsStoreKey(w);
    const sel = scelti.indexOf(k) > -1;
    storeOpts += `<button class="bs-picker-opt${sel?' bs-sel':''}" role="option"
      aria-selected="${sel}" data-val="${bsEsc(k)}">
      <span class="bs-picker-mark"></span>
      <span class="bs-picker-lab">${bsEsc(w.brand+' · '+w.location)}</span></button>`;
  });

  // Link pubblico: le settimane le ha decise chi ha copiato il link e non si
  // cambiano da qui, quindi quel selettore resta inerte (senza voci il pulsante
  // nasce già disabilitato) e l'etichetta viene dal report. Il selettore negozio
  // invece resta vivo se il token apre tutta la settimana: BS.index contiene i
  // negozi che il link permette di vedere.
  if(BS.public){
    curWeek = d ? bsWeeksLabel(bsPeriodsOf(d)) : '—';
    weekOpts = '';
    if(inWeek.length < 2) storeOpts = '';
  }
  // Sotto il pulsante: da quando a quando. Con una settimana sola l'etichetta
  // ("W31") non dice le date, con quattro non dice nemmeno quali.
  const span = BS.public
    ? (d ? bsRangeTxt(d.period_start, d.period_end) : '')
    : (curPeriods.length ? bsSpanLabel(curPeriods) : '');

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
          <div class="bs-sellabel">${curPeriods.length>1?'Settimane':'Settimana'}${
            span?`<span class="bs-selspan">${bsEsc(span)}</span>`:''}</div>
          <div class="bs-picker bs-multi" data-picker="week">
            <button class="bs-picker-btn" aria-haspopup="listbox"
              aria-expanded="false"${weekOpts?'':' disabled'}>
              <span class="bs-picker-cur">${bsEsc(curWeek)}</span>
              <span class="bs-picker-chev">▼</span>
            </button>
            <div class="bs-picker-panel" role="listbox" aria-multiselectable="true">
              <div class="bs-picker-hint">Spunta le settimane · chiudi per aggiornare</div>
              ${weekOpts}</div>
          </div>
        </div>
        <div class="bs-selfield">
          <div class="bs-sellabel">${scelti.length>1?'Negozi':'Negozio'}</div>
          <div class="bs-picker${BS.public?'':' bs-multi'}" data-picker="store">
            <button class="bs-picker-btn" aria-haspopup="listbox"
              aria-expanded="false"${storeOpts?'':' disabled'}>
              <span class="bs-picker-cur">${bsEsc(curStore)}</span>
              <span class="bs-picker-chev">▼</span>
            </button>
            <div class="bs-picker-panel" role="listbox"${BS.public?'':' aria-multiselectable="true"'}>
              ${(!BS.public && inWeek.length>1)?'<div class="bs-picker-hint">Spunta i negozi · chiudi per aggiornare</div>':''}
              ${storeOpts}</div>
          </div>
        </div>
      </div>
      <div class="bs-chips">
        ${bsShareChip(d)}
        ${bsAdminChips(d)}
      </div>
    </div>
  </div></header>`;
}

// Copiare il link lo può fare qualunque utente collegato: serve agli area
// manager per mandarlo ai negozi senza passare da un admin. Spegnerlo no, resta
// fra le azioni admin: un link vale per negozio+settimana e potrebbe essere già
// in mano a tutto il gruppo.
function bsShareChip(d){
  if(BS.public || !BS.cur || (d && d.error)) return '';
  return `<button class="bs-chip-btn" id="bs-link">🔗 Copia link</button>`;
}

// Azioni admin come pillole accanto al periodo: l'import è l'operazione più
// frequente e sta dove si guarda la settimana di riferimento.
function bsAdminChips(d){
  if(!bsIsAdmin()) return '';
  // Eliminare vale per un report — un negozio, una settimana. Con più settimane
  // spuntate non si saprebbe quale, quindi il pulsante non compare.
  const canDelete = !!(BS.cur && !BS.cur.aggregate && d && !d.error
                       && bsCurPeriods().length === 1);
  return `
    <input type="file" id="bs-file" accept=".xlsx,.xls" multiple style="display:none">
    <button class="bs-chip-btn" id="bs-import"${BS.busy?' disabled':''}>
      ${BS.busy?'⏳ Importo…':'📥 Importa Excel'}</button>
    <input type="file" id="bs-flagfile" accept=".xlsx,.xls" style="display:none">
    <button class="bs-chip-btn" id="bs-flags"${BS.busy?' disabled':''}>🏷 Importa saldi e CO</button>
    <button class="bs-chip-btn" id="bs-xls"${BS.busy?' disabled':''}>📊 Scarica Excel</button>
    <button class="bs-chip-btn" id="bs-photos"${BS.busy?' disabled':''}>🖼 Aggiorna foto</button>
    <button class="bs-chip-btn" id="bs-codes"${BS.busy?' disabled':''}>⬇ Codici senza foto</button>
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

// ── Dettaglio taglie nella scheda prodotto ──────────────────────────────
// Le taglie arrivano dal venduto del gestionale (dal 26/08/2026). Le settimane
// più vecchie, importate dall'export adidas, non ce l'hanno: lì il riquadro
// dice perché manca invece di sparire, altrimenti sembra rotto.
//
// Qui l'ordine è quello NATURALE (38, 39, 40… / XS, S, M, L), non quello per
// pezzi che usa il backend: serve a leggere la curva delle taglie, cioè se a
// mancare sono le centrali o le estreme. Un elenco ordinato per volume non lo
// farebbe vedere.
const BS_TG_LETTERE = ['XXS','XS','S','M','L','XL','XXL','XXXL','3XL','4XL'];
function bsTgOrd(t){
  const s = String(t||'').trim().toUpperCase();
  const num = s.replace(',', '.').match(/^(\d+(?:\.\d+)?)$/);
  if(num) return [1, +num[1], s];
  const mesi = s.match(/^(\d+)\s*-\s*(\d+)\s*M$/);      // 3-6M, 6-9M…
  if(mesi) return [0, +mesi[1], s];
  const anni = s.match(/^(\d+)\s*-\s*(\d+)\s*[AY]$/);   // 3-4A, 5-6Y…
  if(anni) return [0, 100 + (+anni[1]), s];
  const i = BS_TG_LETTERE.indexOf(s);
  if(i > -1) return [2, i, s];
  return [3, 0, s];                                     // NS, UN, — : in fondo
}
function bsTgCmp(a, b){
  const x = bsTgOrd(a), y = bsTgOrd(b);
  return x[0]-y[0] || x[1]-y[1] || x[2].localeCompare(y[2]);
}

function bsTaglie(p){
  const tg = (p.sizes || []).slice();
  // Testo neutro di proposito: manca sulle settimane importate dall'export
  // adidas, ma anche sul link pubblico, dove le taglie non escono dal backend.
  // Scrivere una sola delle due ragioni vorrebbe dire mentire nell'altro caso.
  if(!tg.length) return `<div class="bs-tg-no">Dettaglio taglie non disponibile per questa selezione.</div>`;
  tg.sort((a,b) => bsTgCmp(a[0], b[0]));
  const max = Math.max(...tg.map(t => Math.abs(t[1])), 1);
  const tot = tg.reduce((s,t) => s + t[1], 0) || 1;
  return `<div class="bs-tg">
    <div class="bs-tg-h">Taglie · ${tg.length} su ${bsFmt(p.units,'i')} pezzi</div>
    <div class="bs-tg-list">${tg.map(t => {
      const neg = t[1] < 0;
      const h = Math.max(3, Math.round(Math.abs(t[1]) / max * 100));
      return `<div class="bs-tg-i${neg?' bs-tg-neg':''}" title="${bsEsc(t[0])}: ${t[1]} pezzi, ${bsEur(t[2])}">
        <div class="bs-tg-bar"><i style="height:${h}%"></i></div>
        <div class="bs-tg-n">${bsFmt(t[1],'i')}</div>
        <div class="bs-tg-t">${bsEsc(t[0])}</div>
        <div class="bs-tg-p">${Math.round(t[1]/tot*100)}%</div>
      </div>`;
    }).join('')}</div></div>`;
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
        <div class="bs-mname">${bsEsc(p.name)}${bsBadges(p)}</div>
        <div class="bs-mmeta">${bsEsc(p.code)} · ${bsEsc(p.div)} · ${bsEsc(p.gender)} · ${bsEsc(p.cat)}</div>
        <div class="bs-hero">${hero.map(h=>`<div>
          <div class="bs-hero-v">${bsEsc(h.v)}</div>
          <div class="bs-hero-l">${bsEsc(h.l)}</div></div>`).join('')}</div>
        ${bsTaglie(p)}
      </div>
    </div>
    <div class="bs-groups">${groups}</div>
  </div></div>`;
}

// ── Registro operazioni admin ───────────────────────────────────────────
// I pulsanti stanno nell'header (vedi bsAdminChips): qui resta solo l'esito
// degli import, mostrato finché ci sono righe da leggere.
// Riquadro dei messaggi: import per gli admin, link copiato per tutti. Non è
// più admin-only, altrimenti chi non è admin premerebbe "Copia link" senza
// vedere nulla e senza l'URL di riserva se gli appunti non funzionano.
function bsLogBox(){
  if(!BS.log.length) return '';
  return `
  <div class="bs-admin"><div class="bs-admin-box">
    <div class="bs-admin-h">
      <h4>Messaggi</h4>
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

// ── Lettura dei file (nel browser, con SheetJS) ─────────────────────────
// Le righe grezze del primo foglio. Separata dai due lettori perché il file si
// apre UNA volta sola e poi si prova a riconoscerlo: aprirlo due volte
// raddoppierebbe la memoria su file da 30.000 righe.
// Torna anche il NOME del foglio: nel file della giacenza è l'unico posto dove
// sta la data della fotografia (stockmanadaily__20260817020132).
function bsRows(ab){
  const wb = XLSX.read(ab, {type:'array', cellDates:true});
  const nome = wb.SheetNames[0];
  const ws = wb.Sheets[nome];
  return {rows: XLSX.utils.sheet_to_json(ws, {header:1, raw:true, defval:null}), foglio: nome};
}

const bsTit = s => { const t=String(s||'').trim(); return t? t.charAt(0)+t.slice(1).toLowerCase() : ''; };

// Numeri all'italiana: "361.061,45" → 361061.45.
// Il punto è separatore di migliaia SOLO se c'è anche la virgola: da solo è un
// decimale, perché il file stock scrive i prezzi come "4.96". Sbagliare qui
// vuol dire un prezzo fattura di 4.960 euro invece di 4,96.
function bsNumIt(v){
  if(v===null || v===undefined || v==='') return 0;
  if(typeof v === 'number') return v;
  const s = String(v).trim().replace(/\s/g,'');
  const n = Number(s.includes(',') ? s.replace(/\./g,'').replace(',','.') : s);
  return isFinite(n) ? n : 0;
}

const bsPad2 = n => String(n).padStart(2,'0');
// La data di una cella: SheetJS può restituirla come testo "gg/mm/aaaa" o come
// Date. Nel secondo caso si leggono i campi locali e non toISOString(), che
// sposta di fuso e può far scivolare la riga al giorno prima — e quindi alla
// settimana prima, se capita di lunedì.
function bsCellDate(v){
  if(v instanceof Date && !isNaN(v))
    return `${v.getFullYear()}-${bsPad2(v.getMonth()+1)}-${bsPad2(v.getDate())}`;
  return bsIsoDate(v);
}

// Lunedì e domenica della settimana di una data ISO. Le settimane del modulo
// vanno da lunedì a domenica, come l'export adidas che c'era prima: così le
// settimane nuove si affiancano allo storico senza disallinearsi.
function bsSettimanaDi(iso){
  const d = new Date(iso+'T00:00:00');
  if(isNaN(d)) return null;
  d.setDate(d.getDate() - ((d.getDay()+6) % 7));
  const lun = `${d.getFullYear()}-${bsPad2(d.getMonth()+1)}-${bsPad2(d.getDate())}`;
  d.setDate(d.getDate()+6);
  return [lun, `${d.getFullYear()}-${bsPad2(d.getMonth()+1)}-${bsPad2(d.getDate())}`];
}

// "26F" → "FW2026", "26S" → "SS2026".
// Il gestionale scrive la stagione in codice, l'export adidas per esteso. Senza
// questa traduzione il filtro Stagione mostrerebbe due voci per la stessa
// stagione, una per sorgente, e nessuna delle due completa.
function bsStg(v){
  const m = String(v||'').trim().toUpperCase().match(/^(\d{2})([FS])$/);
  return m ? (m[2]==='F' ? 'FW' : 'SS') + (2000 + (+m[1])) : String(v||'').trim();
}

// ── Venduto del gestionale (una riga per riga di scontrino) ─────────────
// Sorgente nuova dal 26/08/2026, al posto dell'export adidas. Cosa cambia:
//  · una riga per riga di scontrino, non un aggregato → si conosce la TAGLIA
//  · tutti i negozi in un file solo, riconosciuti dal codice FILIALE
//  · un file può coprire più settimane (i mensili) → ne escono più report
//  · i resi ci sono, con QTA negativa: il venduto è netto davvero
//  · NIENTE GIACENZA: quella arriva dal file stock, che è un'altra cosa
//
// Il codice articolo del gestionale è "AD" + codice adidas (ADIH9762 → IH9762),
// e così torna a essere la stessa chiave dello storico, delle foto e dei flag.
// L'underwear non segue quella regola (UW4…, che nello stock è 4A0193-202):
// resta col suo codice interno, e la giacenza gli si aggancia per EAN.
const BS_VEN_REQ = ['FILIALE','GIORNO','ARTICOLO','QTA','REALIZZO'];

// L'accumulatore condiviso da TUTTI i file di una stessa importazione.
//
// Perché non si salva un file per volta: gli export sono mensili, e una
// settimana a cavallo di due mesi sta metà in un file e metà nell'altro (la
// 29/06-05/07 sta in giugno e in luglio). Siccome salvare una settimana la
// SOSTITUISCE, caricando prima giugno e poi luglio quella settimana resterebbe
// con i soli 5 giorni di luglio, senza un errore a schermo. Capita una decina
// di volte l'anno. Quindi: si leggono tutti i file, si somma, e ogni settimana
// si scrive una volta sola.
//
// `ana` tiene l'anagrafica UNA volta per codice invece che per ogni coppia
// settimana-negozio: su otto mesi le coppie sono ~120.000 e ripetere nomi e
// categorie in ognuna costerebbe decine di megabyte al browser per niente.
function bsVenAcc(){
  return {ana: new Map(), sett: new Map(), escluse:0, totali:0, senzaData:0, righe:0};
}

function bsParseVenduto(rows, fileName, acc){
  // La riga dei titoli si cerca, non si dà per scontata: negli export grezzi
  // sopra ci possono essere righe di intestazione del gestionale.
  let head = -1;
  for(let i=0;i<Math.min(rows.length,30);i++){
    const nomi = (rows[i]||[]).map(h => String(h==null?'':h).trim().toUpperCase());
    if(BS_VEN_REQ.every(n => nomi.indexOf(n) > -1)){ head = i; break; }
  }
  if(head < 0) return null;     // non è un file di venduto: ci pensa l'altro lettore

  const pos = {};
  (rows[head]||[]).forEach((h,i) => {
    const k = String(h==null?'':h).trim().toUpperCase();
    if(k && !(k in pos)) pos[k] = i;
  });
  const at = (r,n) => { const i = pos[n]; return i===undefined ? null : r[i]; };
  const txt = (r,n) => String(at(r,n)==null?'':at(r,n)).trim();

  for(let i=head+1;i<rows.length;i++){
    const r = rows[i]; if(!r) continue;
    // Filiale vuota = la riga dei totali in fondo al file. Senza questo scarto
    // il primo posto della classifica sarebbe "TOTALE" con 6.882 pezzi.
    const fil = txt(r,'FILIALE');
    if(!fil){ acc.totali++; continue; }
    const art = txt(r,'ARTICOLO').toUpperCase();
    if(!art) continue;
    // Fuori le buste e il materiale di consumo. L'UNDERWEAR (UW) resta: è merce
    // che si vende, e senza di lei mancherebbe un pezzo dell'assortimento.
    if(BS_EXCLUDE.has(art) || /^(LAB|PRA)/.test(art)){ acc.escluse++; continue; }
    if(txt(r,'DIVISION').toUpperCase()==='SERVICE'){ acc.escluse++; continue; }

    const iso = bsCellDate(at(r,'GIORNO'));
    const sett = iso ? bsSettimanaDi(iso) : null;
    if(!sett){ acc.senzaData++; continue; }

    const code = art.startsWith('AD') ? art.slice(2) : art;
    if(!acc.ana.has(code)){
      const cat = txt(r,'SPORTODE'), gen = txt(r,'TARGET_GROUP'), div = txt(r,'DIVISION');
      // Le 28 posizioni dell'export adidas: si riempie quello che il gestionale
      // sa, il resto resta null e in scheda prodotto compare "—". Giacenza,
      // sell-through e WOS (22..27) restano vuote di proposito: le riempie il
      // file stock, che è una fotografia e non un dato di settimana.
      const all = new Array(28).fill(null);
      all[0] = code;
      all[1] = txt(r,'DESCRIZIONE');
      all[2] = cat.toUpperCase();
      all[3] = all[4] = gen.toUpperCase();
      all[5] = bsStg(at(r,'STG'));
      all[6] = txt(r,'MARKETING');
      all[8] = div.toUpperCase();
      acc.ana.set(code, {
        all, name: all[1],
        cat:    BS_CAT[cat.toUpperCase()] || bsTit(cat),
        gender: BS_GEN[gen.toUpperCase()] || bsTit(gen),
        div:    BS_DIV[div.toUpperCase()] || bsTit(div),
      });
    }

    const k = sett[0] + '|' + fil + '|' + code;
    let v = acc.sett.get(k);
    if(!v){ v = {units:0, net:0, lordo:0, sconto:0, tg:new Map()}; acc.sett.set(k, v); }
    const q = Math.round(bsNumIt(at(r,'QTA')));
    const val = bsNumIt(at(r,'REALIZZO'));
    v.units  += q;
    v.net    += val;
    v.lordo  += bsNumIt(at(r,'VAL_LORDO'));
    v.sconto += bsNumIt(at(r,'SCONTOVAL'));
    const tg = txt(r,'TAGLIA') || '—';
    const cur = v.tg.get(tg) || [0,0];
    cur[0] += q; cur[1] += val;
    v.tg.set(tg, cur);
    acc.righe++;
  }
  return true;
}

// Chiude l'accumulatore: da (settimana, filiale, codice) ai report da salvare,
// uno per coppia settimana-negozio.
function bsVenReport(acc){
  const per = new Map();     // "settimana|filiale" → elenco prodotti
  for(const [k, v] of acc.sett){
    // Un articolo che nella settimana ha solo resi non è un best seller.
    if(!(v.units > 0)) continue;
    const taglio = k.lastIndexOf('|');
    const chiave = k.slice(0, taglio);
    const code = k.slice(taglio+1);
    const a = acc.ana.get(code);
    if(!a) continue;
    // Centesimi, non euro interi. Qui i mezzi euro sono ovunque (saldi al 50%:
    // 27,50 · 16,50 · 7,50) e Math.round manda sempre lo 0,5 verso l'alto:
    // l'errore non si compensa, si somma sempre dallo stesso lato. Misurato sul
    // file del 10-16/08: 355 € di troppo in una settimana sola.
    const net = +v.net.toFixed(2);
    const all = a.all.slice();
    all[12] = net;
    all[13] = v.units;
    all[19] = +v.sconto.toFixed(2);
    all[20] = v.lordo ? +(v.sconto / v.lordo).toFixed(4) : null;
    all[21] = +(net / v.units).toFixed(2);
    // Si tolgono solo le taglie a saldo esattamente zero (venduta e resa nella
    // stessa settimana: non dicono niente e contano zero). Le NEGATIVE restano,
    // per quanto strane da leggere: se un articolo ha venduto 3 M e avuto un
    // reso in L, togliere la L farebbe sballare la somma delle taglie rispetto
    // ai pezzi venduti — ed è proprio quella somma che dice se il dettaglio
    // taglie è affidabile.
    const sizes = [...v.tg.entries()]
      .filter(([,t]) => t[0] !== 0)
      .map(([t,x]) => [t, x[0], +x[1].toFixed(2)])
      .sort((x,y) => y[1]-x[1] || String(x[0]).localeCompare(String(y[0])));
    let lista = per.get(chiave);
    if(!lista){ lista = []; per.set(chiave, lista); }
    lista.push({code, name: a.name, cat: a.cat, gender: a.gender, div: a.div,
                units: v.units, net, all, sizes});
  }
  const report = [];
  for(const [chiave, lista] of per){
    const [lun, fil] = chiave.split('|');
    lista.sort((a,b) => b.units - a.units);
    const dom = bsSettimanaDi(lun)[1];
    report.push({
      filiale: fil, period_start: lun, period_end: dom,
      period: `${bsPeriodLabel(lun)} - ${bsPeriodLabel(dom)}`,
      season: '', products: lista,
    });
  }
  report.sort((a,b) => a.period_start.localeCompare(b.period_start)
                    || a.filiale.localeCompare(b.filiale));
  return report;
}

// ── Giacenza: la fotografia del gestionale ──────────────────────────────
// Una riga per negozio × articolo × taglia. NON è una serie storica: è un solo
// giorno, e ricaricarla sostituisce quella precedente.
// Qui il codice articolo è già quello adidas (COD ARTICOLO = IF6490), lo stesso
// che il venduto ricava togliendo il prefisso AD. L'underwear no, e per quello
// l'aggancio vero è l'EAN, che c'è su ogni riga.
const BS_STOCK_REQ = ['FILIALE','EAN','QTA_STOCK','COD ARTICOLO'];
// Nell'ordine di _BS_STOCK_COLS e _BS_STOCK_ART del backend: se cambia uno,
// va cambiato anche l'altro.
const BS_STOCK_ART = ['DESCRIZIONE','MARCHIO','DIVISION','GENDER','SPORTCODE',
                      'MARKETING','STG','CARRYOVER','COLORE','MATERIALE'];

// La data della fotografia. Il file non ha una colonna con la data: sta nel
// nome del foglio (stockmanadaily__20260817020132) e, in seconda battuta, nel
// nome del file ("stock 17.08.2026.xlsx"). Se non si trova né l'una né l'altra
// è meglio fermarsi che scrivere la data di oggi: una giacenza datata male è
// peggio di una giacenza assente, perché non si vede.
function bsStockData(foglio, fileName){
  const f = String(foglio||'').match(/(20\d{2})(\d{2})(\d{2})/);
  if(f) return `${f[1]}-${f[2]}-${f[3]}`;
  const n = String(fileName||'').match(/(\d{1,2})[.\-_/](\d{1,2})[.\-_/](20\d{2})/);
  if(n) return `${n[3]}-${n[2].padStart(2,'0')}-${n[1].padStart(2,'0')}`;
  return '';
}

function bsParseStock(rows, foglio, fileName){
  let head = -1;
  for(let i=0;i<Math.min(rows.length,30);i++){
    const nomi = (rows[i]||[]).map(h => String(h==null?'':h).trim().toUpperCase());
    if(BS_STOCK_REQ.every(n => nomi.indexOf(n) > -1)){ head = i; break; }
  }
  if(head < 0) return null;      // non è il file della giacenza

  const snapshot = bsStockData(foglio, fileName);
  if(!snapshot) throw new Error(
    `${fileName}: non capisco a che data è questa giacenza. Serve la data nel `
    + `nome del file (es. "stock 24.08.2026.xlsx") o nel nome del foglio.`);

  const pos = {};
  (rows[head]||[]).forEach((h,i) => {
    const k = String(h==null?'':h).trim().toUpperCase();
    if(k && !(k in pos)) pos[k] = i;
  });
  const at = (r,n) => { const i = pos[n]; return i===undefined ? null : r[i]; };
  const txt = (r,n) => String(at(r,n)==null?'':at(r,n)).trim();

  const negozi = new Map();      // filiale → {rows, articoli}
  let escluse = 0, pezzi = 0, ordinati = 0;

  for(let i=head+1;i<rows.length;i++){
    const r = rows[i]; if(!r) continue;
    const fil = txt(r,'FILIALE');
    const cod = txt(r,'COD ARTICOLO');
    if(!fil || !cod) continue;
    // Le shopping bag non sono giacenza: non vengono mai caricate a magazzino e
    // vendute sì, quindi vanno a -42.342 pezzi e da sole ribalterebbero il
    // totale di due negozi sotto zero.
    if(txt(r,'DIVISION').toUpperCase()==='SERVICE'){ escluse++; continue; }

    let n = negozi.get(fil);
    if(!n){ n = {rows: [], articoli: {}}; negozi.set(fil, n); }
    const q = Math.round(bsNumIt(at(r,'QTA_STOCK')));
    const o = Math.round(bsNumIt(at(r,'QTA_ORDINATA')));
    // Le righe a zero si TENGONO: "la 42 è finita" è esattamente ciò che serve
    // sapere quando la 43 ne ha ancora cinque.
    n.rows.push([cod, txt(r,'EAN'), txt(r,'TG UK'), txt(r,'TGL__EU'), q, o,
                 bsNumIt(at(r,'PREZZOVENDITA')), bsNumIt(at(r,'PREZZOFATTURA')),
                 bsNumIt(at(r,'ALIQUOTA'))]);
    if(!(cod in n.articoli))
      n.articoli[cod] = BS_STOCK_ART.map(c => txt(r,c));
    pezzi += q; ordinati += o;
  }
  return {snapshot, negozi, escluse, pezzi, ordinati};
}

async function bsSalvaStock(st, fileName){
  let ok=0, ko=0;
  bsLog(`<b>${bsEsc(fileName)}</b>: giacenza al ${bsEsc(bsPeriodLabel(st.snapshot))}`
        + ` · ${st.negozi.size} negozi · ${st.pezzi.toLocaleString('it-IT')} pezzi`
        + ` · ${st.ordinati.toLocaleString('it-IT')} in arrivo`
        + (st.escluse ? ` · ${st.escluse} righe di servizio escluse` : ''));
  for(const [fil, n] of st.negozi){
    const store = bsResolveStore(fil);
    if(!store){
      bsLog(`Giacenza: filiale ${bsEsc(fil)} sconosciuta, saltata.`, true);
      ko++; continue;
    }
    try{
      // Un negozio per chiamata: il file intero è ~50.000 righe e mandarlo in
      // un colpo solo vuol dire tenerlo tutto in memoria da entrambe le parti.
      const r = await api('/bestseller/stock', {method:'POST', body: JSON.stringify({
        brand: store.brand, location: store.location, filiale: fil,
        snapshot: st.snapshot, rows: n.rows, articoli: n.articoli,
      })});
      if(!r.ok){
        let detail = 'Errore '+r.status;
        try{ const e = await r.json(); if(e.detail) detail = typeof e.detail==='string'?e.detail:JSON.stringify(e.detail); }catch(_){}
        throw new Error(detail);
      }
      ok++;
      bsLog(`<b>${bsEsc(store.location)}</b> · ${n.rows.length.toLocaleString('it-IT')} righe di giacenza — salvate`);
    }catch(e){
      ko++; bsLog(`Giacenza ${bsEsc(store.location)}: ${bsEsc(e.message||e)}`, true);
    }
  }
  return [ok, ko];
}

// ── Parsing dell'Excel adidas (nel browser, con SheetJS) ────────────────
// Struttura del file: righe di intestazione con "Date:", "Store:", "Season - new:",
// poi la riga colonne con 'Product Code' in colonna B, poi i prodotti, poi TOTAL.
// Resta in servizio per lo storico e per chi ha ancora file vecchi da caricare.
function bsParseWorkbook(rows, fileName){
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

// Salva i report ricavati da un file di venduto: una chiamata per ogni coppia
// settimana-negozio. Un mensile ne produce una quarantina (≈4,5 settimane × 8
// negozi), e vanno mandati uno alla volta: il documento di una settimana pesa
// centinaia di kB e spedirli tutti insieme vuol dire tenerli tutti in memoria.
async function bsSalvaVenduto(acc, quantiFile){
  let ok=0, ko=0;
  const ignote = new Set();
  const report = bsVenReport(acc);
  const sett = new Set(report.map(r => r.period_start));
  bsLog(`<b>${quantiFile} file di venduto</b>: ${acc.righe.toLocaleString('it-IT')} righe`
        + ` · ${sett.size} settimane · ${report.length} report da salvare`
        + (acc.escluse ? ` · ${acc.escluse.toLocaleString('it-IT')} righe escluse (buste e servizi)` : '')
        + (acc.senzaData ? ` · ${acc.senzaData} senza data valida` : ''));
  let fatti = 0;
  for(const rep of report){
    const store = bsResolveStore(rep.filiale);
    if(!store){
      if(!ignote.has(rep.filiale)){
        ignote.add(rep.filiale);
        bsLog(`Filiale ${bsEsc(rep.filiale)} sconosciuta: salto le sue settimane.`, true);
      }
      ko++; continue;
    }
    // Un cenno ogni venti: 272 salvataggi sono minuti di silenzio, e un
    // riquadro fermo non si distingue da un riquadro bloccato.
    if(++fatti % 20 === 0)
      bsLog(`…${fatti} di ${report.length} (${bsEsc(rep.period)})`);
    try{
      const r = await api('/bestseller/week', {method:'POST', body: JSON.stringify({
        brand: store.brand, location: store.location, store_raw: rep.filiale,
        period: rep.period, period_start: rep.period_start,
        period_end: rep.period_end, season: rep.season, products: rep.products,
      })});
      if(!r.ok){
        let detail = 'Errore '+r.status;
        try{ const e = await r.json(); if(e.detail) detail = typeof e.detail==='string'?e.detail:JSON.stringify(e.detail); }catch(_){}
        throw new Error(detail);
      }
      ok++;
    }catch(e){
      ko++;
      bsLog(`${bsEsc(store.location)} · ${bsEsc(rep.period)}: ${bsEsc(e.message||e)}`, true);
    }
  }
  bsLog(`<b>Venduto</b> — ${ok} report salvati${ko?`, ${ko} falliti`:''}.`);
  return [ok, ko];
}

async function bsImportFiles(files){
  BS.busy = true; bsPaint();
  let ok=0, ko=0;
  // I file di venduto NON si salvano man mano: si sommano tutti qui e si
  // scrivono alla fine, una volta per settimana. Il motivo sta su bsVenAcc —
  // le settimane a cavallo di due mesi stanno in due file diversi.
  const acc = bsVenAcc();
  let venFile = 0;
  for(const f of files){
    try{
      bsLog(`Leggo ${bsEsc(f.name)}…`);
      const {rows, foglio} = bsRows(await f.arrayBuffer());
      // Il file si riconosce da solo, dalle sue colonne: venduto del gestionale
      // (uno o più mesi, tutti i negozi), giacenza, o export adidas.
      if(bsParseVenduto(rows, f.name, acc)){ venFile++; continue; }
      const st = bsParseStock(rows, foglio, f.name);
      if(st){
        const [o, k] = await bsSalvaStock(st, f.name);
        ok += o; ko += k;
        continue;
      }
      const parsed = bsParseWorkbook(rows, f.name);
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
  if(venFile){
    try{
      const [o, k] = await bsSalvaVenduto(acc, venFile);
      ok += o; ko += k;
    }catch(e){
      ko++; bsLog(`Salvataggio del venduto: ${bsEsc(e.message||e)}`, true);
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

// Elenco dei file nella cartella Drive delle foto.
//
// Drive non dichiara una versione, quindi la cache locale usa la data: l'elenco
// si rinfresca da solo una volta al giorno. Ma le foto si caricano a mano, e chi
// ne carica 1285 vuole vederle subito, non domani — `force` salta la copia
// salvata e la riscrive, così anche i giri successivi vedono quella nuova.
async function bsFetchPhotoList(force){
  const oggi = new Date().toISOString().slice(0,10);
  if(!force) return (await fetchCached('bs:photos', '/bestseller/photos', oggi)).files || [];
  const r = await bsApi('/bestseller/photos');
  if(!r.ok) throw new Error('errore '+r.status);
  const files = (await r.json()).files || [];
  if(typeof dcachePut === 'function'){
    try{ dcachePut('bs:photos', oggi, {files}); }catch(_){}
  }
  return files;
}

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
        list = await bsFetchPhotoList(BS.photosForce);
        BS.photosForce = false;
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

// Rilegge la cartella Drive delle foto, adesso.
//
// L'elenco è in cache nel browser con la data come versione: una volta aperto
// il modulo, per il resto della giornata fetchCached serve la copia salvata e
// le foto caricate nel frattempo non compaiono — nemmeno ricaricando la pagina,
// perché quella copia sta in IndexedDB. Con le foto che si caricano a mano su
// Drive non c'è niente che possa accorgersene da solo: serve un comando.
async function bsRefreshPhotos(){
  if(BS.busy) return;
  BS.busy = true; bsPaint();
  try{
    bsLog('Rileggo la cartella delle foto…');
    const files = await bsFetchPhotoList(true);
    // Stesso ordinamento di bsAttachPhotos: a parità di codice vince la vista _1_.
    BS.photos = files.sort((a,b) => String(a.name||'').localeCompare(String(b.name||'')));
    // Riaggancio ai prodotti a schermo. Le vecchie associazioni vanno tolte
    // prima: bsAttachPhotos scrive `img` solo dove trova un abbinamento, e un
    // articolo la cui foto è stata rimossa da Drive resterebbe con la sua.
    const prod = (BS.data && BS.data.products) || [];
    prod.forEach(p => { delete p.img; });
    await bsAttachPhotos(prod);
    const conFoto = prod.filter(p => p.img).length;
    bsLog(`Elenco foto aggiornato: <b>${files.length}</b> file nella cartella`
      + (prod.length ? ` · <b>${conFoto}</b> articoli su ${prod.length} hanno la foto` : ''), true);
  }catch(e){
    bsLog('Non riesco a rileggere le foto: '+bsEsc(bsIsAbort(e)
      ? 'il server non ha risposto in tempo' : (e.message||e)), true);
  }
  BS.busy = false;
  bsPaint();
}

// ── Link pubblico da mandare ai negozi ──────────────────────────────────
// I ragazzi non hanno credenziali: il link apre bs.html, che legge la classifica
// da /public/bestseller senza login. Il token vale per la selezione corrente e
// si spegne cancellandolo. Dal link non passano valore, margine, sconti e ASP:
// li esclude il backend, non la pagina.
// Il link porta con sé TUTTE le settimane spuntate: chi lo apre vede la stessa
// somma che vede chi l'ha copiato. `period_start` resta nella richiesta perché i
// link a settimana singola conservano la forma di prima, e quelli già in mano ai
// negozi continuano a valere.
function bsLinkSel(){
  const c = BS.cur || {};
  return {period_start: c.period_start || '', brand: c.brand || '',
          location: c.location || '', aggregate: !!c.aggregate,
          periods: bsCurPeriods(), stores: (c.stores || []).slice()};
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
          + `&location=${encodeURIComponent(s.location)}&aggregate=${s.aggregate}`
          + `&periods=${encodeURIComponent(s.periods.join(','))}`
          + `&stores=${encodeURIComponent(s.stores.join(','))}`;
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


// ── Esportazione Excel completa ─────────────────────────────────────────
// Tutte le 28 colonne dell'export adidas, una riga per articolo × negozio ×
// settimana. La classifica a schermo mostra i totali: qui c'è il dettaglio, da
// cui in Excel si ricava qualsiasi taglio (una settimana, un negozio, entrambi).
//
// Il file lo costruisce il SERVER perché il dettaglio qui non c'è: il browser
// riceve già sommato. Vedi /bestseller/export.
//
// Descrizione dei filtri attivi, per il foglio Leggimi del file: fra un mese il
// file deve poter dire da solo cosa contiene.
function bsFiltriLabel(){
  const p = [];
  BS_FILTRI.forEach(f => {
    const sel = BS.f[f.k] || [];
    if(!sel.length) return;
    const voci = f.fissi || [];
    const testo = v => (voci.find(o => o.v === v) || {t: v}).t;
    p.push(`${f.lab}: ${sel.map(testo).join(', ')}`);
  });
  if(BS.query.trim()) p.push(`Ricerca: "${BS.query.trim()}"`);
  return p.join(' · ');
}

async function bsDownloadXls(){
  if(BS.busy || !BS.cur) return;
  BS.busy = true; bsPaint();
  try{
    const filtri = bsFiltriLabel();
    // I filtri sono tutti attributi dell'articolo, mai della coppia
    // negozio-settimana: mando i codici che li passano e il server si limita a
    // tenerli. Senza filtri non mando niente e prende tutto, così una selezione
    // ampia non viaggia con seimila codici appresso.
    const codes = filtri ? bsFiltered().map(p => p.code) : [];
    bsLog('Preparo l\'Excel…');
    const r = await bsApi('/bestseller/export', {method:'POST', body: JSON.stringify({
      periods: bsCurPeriods(),
      stores: (BS.cur.stores || []),
      codes, filtri,
    })});
    if(!r.ok) throw new Error(r.status === 404
      ? 'endpoint non disponibile: il backend va aggiornato' : 'errore '+r.status);
    const blob = await r.blob();
    const ps = bsCurPeriods();
    const nome = `best-seller-${ps[0]}_${ps[ps.length-1]}.xlsx`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nome;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    const mb = (blob.size/1048576).toFixed(1).replace('.', ',');
    bsLog(`Scaricato <b>${bsEsc(nome)}</b> (${mb} MB)`
      + (filtri ? ` · filtri: ${bsEsc(filtri)}` : ' · senza filtri'), true);
  }catch(e){
    bsLog('Esportazione fallita: '+bsEsc(bsIsAbort(e)
      ? 'il server non ha risposto in tempo' : (e.message||e)), true);
  }
  BS.busy = false;
  bsPaint();
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

    // Scorrendo dentro un pannello, il gesto non deve passare alla pagina sotto
    // e portarsela via mentre si sta ancora scegliendo. Per i pannelli lunghi
    // (settimane, negozi, Categoria) ci pensa `overscroll-behavior: contain` nel
    // CSS. Per quelli corti no: se la lista ci sta tutta, il browser non li
    // considera scorribili, non applica overscroll-behavior e gira il gesto alla
    // pagina — e la tendina si comporterebbe in un modo o nell'altro a seconda
    // di quante voci ha, che è peggio di entrambi. Qui si ferma comunque.
    const pan = p.querySelector('.bs-picker-panel');
    if(pan) pan.addEventListener('wheel', e => {
      if(pan.scrollHeight <= pan.clientHeight) e.preventDefault();
    }, {passive: false});

    btn.addEventListener('click', e => {
      e.stopPropagation();
      BS.committed = false;
      bsClosePickers(p);            // un solo pannello aperto per volta
      const open = p.classList.toggle('bs-open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      if(open){
        const sel = p.querySelector('.bs-picker-opt.bs-sel');
        if(sel) sel.scrollIntoView({block:'nearest'});
        bsAlignPanel(p);
        // Se aprendo questo pannello ho fatto partire il caricamento della
        // selezione appena spuntata, fra poco bsPaint rigenera il markup e se lo
        // porterebbe via: chiedo di riaprirlo dopo, così il pannello non
        // sparisce sotto le dita mentre lo si sta usando.
        if(BS.committed) BS.reopen = p.dataset.picker;
      }else{
        bsCommitSel();            // chiuso ricliccando il pulsante
      }
    });
  });

  // Riapertura richiesta prima del ridisegno (vedi sopra, e i filtri della barra
  // che ridisegnano a ogni spunta).
  if(BS.reopen){
    const p = document.querySelector(`#bs-root .bs-picker[data-picker="${BS.reopen}"]`);
    BS.reopen = null;
    if(p){
      p.classList.add('bs-open');
      p.querySelector('.bs-picker-btn')?.setAttribute('aria-expanded','true');
      bsAlignPanel(p);
    }
  }

  // Settimana: la spunta aggiunge o toglie, e la classifica mostra la somma
  // delle settimane rimaste. L'ultima non si può togliere — senza settimane non
  // ci sarebbe niente da mostrare — e per "cambiare" settimana si spunta la
  // nuova e si toglie la vecchia.
  //
  // Qui NON si carica: si aggiorna solo la spunta a schermo, e il caricamento
  // parte alla chiusura del pannello (bsCommitSel). Chiamare bsLoadCurrent a
  // ogni clic vorrebbe dire quattro richieste da mezzo mega per scegliere
  // quattro settimane, e un pannello che si richiude a ogni spunta perché
  // bsPaint rigenera il markup.
  const settimane = (chiavi) => { BS.draft.periods = chiavi; BS.pending = true; bsSyncMarks(); };

  document.querySelectorAll('#bs-root [data-week]').forEach(b =>
    b.addEventListener('click', e => {
      e.stopPropagation();
      const ps = b.dataset.week;
      const now = bsDraftPeriods();
      // Anche l'ultima spuntata si può togliere: serve per liberare la scelta e
      // passare a un'altra settimana senza dover prima spuntare quella nuova.
      // Restare a zero va bene solo mentre si sceglie: chiudendo così,
      // bsCommitSel tiene la selezione di prima.
      settimane(now.indexOf(ps) > -1 ? now.filter(x => x !== ps) : now.concat(ps).sort());
    }));

  // "★ Tutte le week" fa da interruttore, come "Tutti i negozi": se ci sono già
  // tutte le toglie tutte, altrimenti le prende tutte.
  document.querySelectorAll('#bs-root [data-weekall]').forEach(b =>
    b.addEventListener('click', e => {
      e.stopPropagation();
      const keys = Object.keys(bsWeeks()).sort();
      if(!keys.length) return;
      settimane(bsDraftPeriods().length === keys.length ? [] : keys);
    }));

  // Negozio: a spunta come le settimane, e la classifica somma quelli scelti.
  // L'ultimo rimasto non si può togliere, per lo stesso motivo delle settimane.
  // Dal link pubblico la scelta resta singola: /public/bestseller accetta un
  // negozio (?store=) o l'insieme che il token apre, non un sottoinsieme
  // qualsiasi. Lì quindi si cambia negozio e si carica subito, come prima.
  const negozi = (chiavi) => {
    if(BS.public){
      BS.pending = false;
      bsSetCur(Object.assign({}, BS.cur, {stores: chiavi}));
      bsResetView();
      bsLoadCurrent();
      return;
    }
    BS.draft.stores = chiavi;
    BS.pending = true;
    bsSyncMarks();
  };

  document.querySelectorAll('#bs-root [data-val]').forEach(b =>
    b.addEventListener('click', e => {
      e.stopPropagation();
      const k = b.dataset.val;
      if(BS.public) return negozi([k]);
      const now = bsDraftStores();
      negozi(now.indexOf(k) > -1 ? now.filter(x => x !== k) : now.concat(k));
    }));

  // "★ Tutti i negozi" fa da interruttore: se ci sono già tutti li toglie tutti,
  // altrimenti li prende tutti. Svuotare in un clic serve per riprenderne due o
  // tre senza dover togliere la spunta agli altri sei.
  // Restare senza nessuno spuntato va bene solo mentre si sceglie: chiudendo
  // così, bsCommitSel tiene la selezione di prima invece di caricare il vuoto.
  document.querySelectorAll('#bs-root [data-storeall]').forEach(b =>
    b.addEventListener('click', e => {
      e.stopPropagation();
      const disp = bsStoresIn(bsCurPeriods()).map(bsStoreKey);
      negozi(bsDraftStores().length === disp.length ? [] : disp);
    }));

  const q = document.getElementById('bs-q');
  if(q) q.addEventListener('input', e => {
    BS.query = e.target.value;
    const pos = e.target.selectionStart;
    bsPaint();
    const nq = document.getElementById('bs-q');
    if(nq){ nq.focus(); try{ nq.setSelectionRange(pos,pos); }catch(_){} }
  });
  // Filtri della barra: a spunta, e si applicano subito. Qui il ridisegno non
  // costa niente (il filtro è locale, i dati ci sono già), quindi non c'è motivo
  // di aspettare la chiusura come per settimane e negozi. bsPaint rigenererebbe
  // il markup portandosi via il pannello aperto: BS.reopen lo rimette com'era.
  document.querySelectorAll('#bs-root [data-f]').forEach(b =>
    b.addEventListener('click', e => {
      e.stopPropagation();
      const k = b.dataset.f, v = b.dataset.fv;
      const now = BS.f[k] || [];
      BS.f[k] = now.indexOf(v) > -1 ? now.filter(x => x !== v) : now.concat(v);
      BS.reopen = 'f-'+k;
      BS.detail = null;
      bsPaint();
    }));
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
  on('bs-flags','click', () => { const f=document.getElementById('bs-flagfile'); if(f) f.click(); });
  on('bs-flagfile','change', e => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if(f) bsImportFlags(f);
  });
  on('bs-xls','click', bsDownloadXls);
  on('bs-photos','click', bsRefreshPhotos);
  on('bs-codes','click', bsDownloadCodes);
  on('bs-link','click', bsMakeLink);
  on('bs-unlink','click', bsKillLink);
  on('bs-del','click', bsDeleteWeek);
  on('bs-log-clear','click', () => { BS.log = []; bsPaint(); });
  // Ricarica tutto, elenco foto compreso: da un tasto di ricarica ci si aspetta
  // che rilegga davvero tutto, e le foto erano l'unica cosa che restava ferma.
  on('bs-reload','click', () => {
    BS.index = null; BS.data = null; BS.photos = null; BS.photosForce = true;
    renderBestSeller();
  });
}

// Azzera vista e filtri quando cambia la selezione: i filtri di una settimana
// non hanno senso su un'altra (una divisione può non esserci nemmeno).
function bsResetView(){
  BS.query = '';
  BS.f = {div: [], gen: [], cat: [], sea: [], sale: [], carry: []};
  BS.detail = null;
}

// Rispecchia a schermo le spunte di entrambi i selettori senza ridisegnare: i
// pannelli sono aperti e bsPaint se li porterebbe via. Aggiorna anche le due
// voci "★ Tutte…", che risultano spuntate quando lo sono tutte le righe,
// comunque ci si sia arrivati.
function bsSyncMarks(){
  const marca = (el, on) => {
    el.classList.toggle('bs-sel', on);
    el.setAttribute('aria-selected', String(on));
  };
  const ps = bsDraftPeriods();
  document.querySelectorAll('#bs-root [data-week]').forEach(o =>
    marca(o, ps.indexOf(o.dataset.week) > -1));
  const nSett = Object.keys(bsWeeks()).length;
  const tutte = document.querySelector('#bs-root [data-weekall]');
  if(tutte) marca(tutte, nSett > 0 && ps.length === nSett);

  const st = bsDraftStores();
  document.querySelectorAll('#bs-root [data-val]').forEach(o =>
    marca(o, st.indexOf(o.dataset.val) > -1));
  // L'elenco dei negozi disponibili si rifà dalle settimane APPLICATE, non da
  // quelle in corso di spunta: mentre si sceglie non deve cambiargli sotto, e a
  // zero settimane sparirebbero tutti.
  const nNeg = bsStoresIn(bsCurPeriods()).length;
  const tutti = document.querySelector('#bs-root [data-storeall]');
  if(tutti) marca(tutti, nNeg > 0 && st.length === nNeg);

  bsRefreshBtns();
}

// Aggiorna a mano i due pulsanti mentre i pannelli restano aperti: etichetta
// ("W29–W32 · 4 sett.", "3 negozi"), intestazione singolare/plurale e periodo
// coperto. Sono le cose che bsPaint rifarebbe, ma bsPaint rigenera tutto il
// markup e chiuderebbe il pannello sotto le dita.
function bsRefreshBtns(){
  const ps = bsDraftPeriods();
  const testo = (picker, cur, lab) => {
    const p = document.querySelector(`#bs-root .bs-picker[data-picker="${picker}"]`);
    if(!p) return;
    const c = p.querySelector('.bs-picker-cur');
    if(c) c.textContent = cur;
    const l = p.closest('.bs-selfield')?.querySelector('.bs-sellabel');
    if(l) l.innerHTML = lab;
  };
  testo('week', bsWeeksLabel(ps), (ps.length>1?'Settimane':'Settimana')
    + `<span class="bs-selspan">${bsEsc(bsSpanLabel(ps))}</span>`);
  const st = bsDraftStores();
  testo('store', bsStoresLabel(bsStoresIn(bsCurPeriods()), st),
        st.length>1 ? 'Negozi' : 'Negozio');
}

// Applica la selezione fatta a spunte — settimane e negozi insieme. Chiamata
// quando un pannello si chiude: è il momento in cui l'utente ha finito di
// scegliere. bsSetCur rinormalizza i due elenchi l'uno sull'altro, perché i
// negozi disponibili dipendono dalle settimane spuntate e quelli scelti prima
// potrebbero non esserci più.
function bsCommitSel(){
  if(!BS.pending) return;
  BS.pending = false;
  BS.committed = true;
  // Le spunte lasciate a zero non sono una selezione: chi ha svuotato per
  // ripartire da capo e poi ha chiuso senza scegliere niente si tiene quella di
  // prima, che è meno peggio di una classifica vuota. Vale su tutti e due gli
  // assi, e i due si applicano insieme perché i negozi disponibili dipendono
  // dalle settimane scelte.
  const sel = {};
  if(BS.draft.periods && BS.draft.periods.length) sel.periods = BS.draft.periods;
  if(BS.draft.stores  && BS.draft.stores.length)  sel.stores  = BS.draft.stores;
  BS.draft = {periods: null, stores: null};
  bsSetCur(Object.assign({}, BS.cur, sel));
  // Nessun negozio presente in tutte le settimane scelte: non c'è un totale
  // onesto da mostrare. Torno all'ultima settimana e lo dico, invece di lasciare
  // le spunte a schermo su una classifica che non è quella.
  if(!bsCurStores().length){
    const ps = bsCurPeriods();
    bsSetCur({periods:[ps[ps.length-1]], stores:[]});
    bsLog('Nessun negozio ha caricato tutte le settimane scelte: torno all\'ultima.', true);
    if(!bsCurStores().length) return;
  }
  // Il confronto è con quello che è A SCHERMO (BS.loadedKey), non con com'era
  // BS.cur all'inizio di questa funzione: le spunte delle settimane hanno già
  // modificato BS.cur mentre il pannello era aperto, quindi confrontarlo con sé
  // stesso dava sempre "non è cambiato niente" e la classifica non si aggiornava
  // mai al cambio di settimana.
  if(bsCacheKey(BS.cur) === BS.loadedKey){ bsPaint(); return; }
  bsResetView();
  bsLoadCurrent();
}

// Filtri della barra: il pannello è più largo della pillola che lo apre, e su
// quelli di destra uscirebbe dallo schermo. Lo misuro adesso che è visibile e,
// se sborda, lo aggancio al bordo destro invece che al sinistro.
function bsAlignPanel(p){
  if(!p.classList.contains('bs-fpick')) return;
  p.classList.remove('bs-right');
  const pan = p.querySelector('.bs-picker-panel');
  if(pan && pan.getBoundingClientRect().right > document.documentElement.clientWidth - 8)
    p.classList.add('bs-right');
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
  if(n) bsCommitSel();          // non fa nulla se non c'erano spunte in sospeso
  return n;
}

// Chiude i selettori cliccando fuori. Registrato una volta sola: i pannelli
// vengono ricreati a ogni paint, quindi si cercano al momento del clic.
document.addEventListener('click', e => {
  const inside = e.target && e.target.closest && e.target.closest('#bs-root .bs-picker');
  if(inside) return;
  bsClosePickers(null);
  // Anche se il pannello non risultava più aperto: chi ha spuntato delle
  // settimane e poi ha cliccato su un prodotto ha comunque finito di scegliere,
  // e quel clic può aver già rigenerato il markup (bsClosePickers non trova più
  // nulla da chiudere e da solo non applicherebbe niente).
  bsCommitSel();
});

// Esc: prima chiude i selettori, altrimenti la scheda prodotto.
document.addEventListener('keydown', e => {
  if(e.key !== 'Escape') return;
  if(bsClosePickers(null)) return;
  if(BS.detail){ BS.detail=null; bsPaint(); }
});
