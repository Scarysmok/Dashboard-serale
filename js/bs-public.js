// bs-public.js — avvio della pagina pubblica bs.html.
// Riusa il rendering di 09-bestseller.js: qui si definiscono solo i pochi
// globali che quel file si aspetta dall'app (e che qui non esistono, perché non
// c'è login), si chiede la classifica al link e si disegna.
// Niente selettori e niente pillole admin: bsAdminChips esce vuoto perché
// auth.user è null, e bsHeader rende i selettori inerti quando BS.public è true.
var auth = {user: null};      // letto da bsIsAdmin()
var API_BASE = 'https://dashboard-backend-ur63.onrender.com';   // come in 01-config.js
var ALL_STORES = [];          // usato solo dall'import, che qui non c'è

(async () => {
  const root = document.getElementById('bs-root');
  const t = new URLSearchParams(location.search).get('t') || '';
  BS.public = true;
  if(!t){ root.innerHTML = bsState('Link non valido', 'manca il codice nell\'indirizzo'); return; }

  root.innerHTML = bsState('Carico la classifica…', 'il server si sta svegliando, può richiedere qualche secondo');
  try{
    const r = await fetch(API_BASE + '/public/bestseller?t=' + encodeURIComponent(t));
    if(r.status === 404){
      root.innerHTML = bsState('Link non più valido', 'chiedi al tuo area manager un link aggiornato');
      return;
    }
    if(!r.ok) throw new Error('errore ' + r.status);
    BS.data = await r.json();
  }catch(e){
    root.innerHTML = bsState('Non riesco a caricare la classifica', String(e.message||e));
    return;
  }
  BS.cur = {brand: BS.data.brand, location: BS.data.location,
            period_start: BS.data.period_start, aggregate: !!BS.data.aggregate};
  // bsPaint mostra "Nessun report caricato" se l'archivio è vuoto: qui l'unico
  // report disponibile è questo, quindi l'indice contiene solo lui. Le etichette
  // dei selettori le rende comunque bsHeader dal report (BS.public).
  BS.index = [{brand: BS.data.brand, location: BS.data.location,
               period_start: BS.data.period_start, period: BS.data.period,
               period_end: BS.data.period_end}];
  await bsAttachPhotos(BS.data.products);
  bsPaint();
  bsBind();
})();
