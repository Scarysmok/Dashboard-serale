// bs-public.js — avvio della pagina pubblica bs.html.
// Riusa il rendering di 09-bestseller.js: qui si definiscono solo i pochi
// globali che quel file si aspetta dall'app (e che qui non esistono, perché non
// c'è login), si chiede la classifica al link e si disegna.
// Niente pillole admin: bsAdminChips esce vuoto perché auth.user è null.
// Il selettore settimana è inerte (c'è una sola settimana); quello dei negozi
// resta vivo se il token apre tutta la settimana, e in quel caso il cambio
// negozio passa da bsLoadCurrent → bsFetchPublic.
var auth = {user: null};      // letto da bsIsAdmin()
var API_BASE = 'https://dashboard-backend-ur63.onrender.com';   // come in 01-config.js
var ALL_STORES = [];          // usato solo dall'import, che qui non c'è

(async () => {
  const root = document.getElementById('bs-root');
  BS.public = true;
  BS.token = new URLSearchParams(location.search).get('t') || '';
  if(!BS.token){ root.innerHTML = bsState('Link non valido', 'manca il codice nell\'indirizzo'); return; }

  root.innerHTML = bsState('Carico la classifica…', 'il server si sta svegliando, può richiedere qualche secondo');
  BS.data = await bsFetchPublic('');
  if(BS.data.error){ root.innerHTML = bsState('Classifica non disponibile', BS.data.error); return; }

  BS.cur = {brand: BS.data.brand, location: BS.data.location,
            period_start: BS.data.period_start, aggregate: !!BS.data.aggregate};
  // bsPaint mostra "Nessun report caricato" se l'archivio è vuoto. Qui l'indice
  // contiene ciò che il link permette di vedere: i negozi della settimana se il
  // token è "tutti i negozi", altrimenti solo il proprio.
  const uno = {brand: BS.data.brand, location: BS.data.location,
               period_start: BS.data.period_start, period: BS.data.period,
               period_end: BS.data.period_end};
  BS.index = (BS.data.stores || []).length
    ? BS.data.stores.map(s => Object.assign({}, uno, s))
    : [uno];
  await bsAttachPhotos(BS.data.products);
  bsPaint();
  bsBind();
})();
