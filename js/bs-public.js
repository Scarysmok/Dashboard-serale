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
  // Il velo col logo è già a schermo (sta nell'HTML): la dissolvenza parte nel
  // finally, così scopre anche i messaggi di errore invece di restare sopra.
  try{
    if(!BS.token){ root.innerHTML = bsState('Link non valido', 'manca il codice nell\'indirizzo'); return; }

    BS.data = await bsFetchPublic('');
    if(BS.data.error){ root.innerHTML = bsState('Classifica non disponibile', BS.data.error); return; }

    // Le settimane le ha decise chi ha copiato il link: il token se le porta
    // dietro e da qui non si cambiano (il selettore settimana resta inerte).
    const periods = (BS.data.periods && BS.data.periods.length)
      ? BS.data.periods.slice().sort()
      : [BS.data.period_start];
    // bsPaint mostra "Nessun report caricato" se l'archivio è vuoto. Qui l'indice
    // contiene ciò che il link permette di vedere: i negozi che il token apre,
    // uno solo se è un link di negozio. Una voce per negozio E per settimana,
    // perché il selettore elenca chi è presente in tutte (bsStoresIn conta le
    // presenze). Va riempito PRIMA di bsSetCur, che ci si appoggia.
    const negozi = (BS.data.stores || []).length
      ? BS.data.stores
      : [{brand: BS.data.brand, location: BS.data.location}];
    BS.index = [];
    periods.forEach((ps, i) => negozi.forEach(s => BS.index.push(Object.assign({
      period_start: ps, period: BS.data.period,
      // Solo l'ultima settimana conosce la propria fine: dal link arriva la fine
      // del periodo intero, non quella di ognuna. Serve a bsSpanLabel, che legge
      // l'inizio della prima e la fine dell'ultima.
      period_end: i === periods.length-1 ? BS.data.period_end : '',
    }, s))));
    // Negozi inclusi nel totale mostrato: tutti quelli che il token apre se sta
    // mostrando l'aggregato, altrimenti quello solo su cui è sceso.
    bsSetCur({periods, stores: BS.data.aggregate
      ? [] : [BS.data.brand+'|'+BS.data.location]});
    await bsAttachPhotos(BS.data.products);
    // Anche i badge CO/SALES: i flag arrivano col payload ma senza questa riga
    // BS.flags resta vuoto e alla prima apertura i badge non compaiono.
    await bsLoadFlags();
    // Solo bsPaint: aggancia già gli eventi in coda. Chiamare anche bsBind()
    // metteva un secondo listener identico su ogni pulsante, e sul selettore i due
    // si annullavano — il primo apriva il pannello, il secondo lo richiudeva nello
    // stesso clic. Era il motivo per cui i negozi non si potevano cambiare.
    bsPaint();
  }finally{
    document.querySelector('.bsload')?.classList.add('bsload-off');
  }
})();
