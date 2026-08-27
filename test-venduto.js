/* Controllo del lettore del venduto del gestionale (js/09-bestseller.js).
 *
 * Le regole che questo file protegge, tutte già costate un errore vero durante
 * la scrittura:
 *
 *  1. La riga dei TOTALI in fondo al file non è un articolo. Ha la filiale
 *     vuota: se entrasse, il primo posto della classifica sarebbe "TOTALE".
 *  2. La somma delle taglie deve fare i pezzi venduti. Scartare le taglie a
 *     saldo negativo (un reso) rompe questa uguaglianza in silenzio.
 *  3. Il valore si tiene in CENTESIMI. Arrotondando all'euro, con i saldi al
 *     50% (27,50 · 16,50 · 7,50) lo 0,5 va sempre verso l'alto e l'errore si
 *     accumula: 355 € di troppo in una settimana sola, misurati sul file vero.
 *  4. DUE FILE CHE SI SPARTISCONO UNA SETTIMANA DEVONO DARE LO STESSO
 *     RISULTATO DI UN FILE SOLO. Gli export sono mensili e la settimana a
 *     cavallo di due mesi sta metà in uno e metà nell'altro; siccome salvare
 *     una settimana la SOSTITUISCE, senza la somma preventiva si perderebbero
 *     i giorni del primo file, senza un errore a schermo.
 *  5. Le buste (LAB) e i servizi escono, l'UNDERWEAR (UW) resta: è merce.
 *
 * Non apre nessun Excel e non serve un browser: ritaglia dal sorgente le
 * funzioni che servono e le esegue su righe finte con la stessa forma di
 * quelle vere (numeri all'italiana, date come testo gg/mm/aaaa).
 *
 *     osascript -l JavaScript test-venduto.js
 */
ObjC.import('Foundation');

const SRC = 'js/09-bestseller.js';
const src = $.NSString.stringWithContentsOfFileEncodingError(SRC, $.NSUTF8StringEncoding, null).js;
if(!src) throw new Error('non leggo ' + SRC + ' — lanciami dalla cartella Dashboard-serale');

// Ritaglia una dichiarazione dal sorgente, bilanciando le parentesi.
function ritaglia(nome, tipo){
  let inizio = tipo === 'const' ? src.indexOf('const ' + nome) : src.indexOf('function ' + nome + '(');
  if(inizio < 0) throw new Error('non trovo ' + nome + ' in ' + SRC);
  // Se la funzione è async il prefisso va tenuto, altrimenti gli await dentro
  // diventano errori di sintassi.
  if(tipo !== 'const' && src.slice(inizio-6, inizio) === 'async ') inizio -= 6;
  let g = 0, q = 0, t = 0, visto = false;
  for(let i = inizio; i < src.length; i++){
    const c = src[i];
    if(c === '{'){ g++; visto = true; }
    else if(c === '}'){ g--; if(tipo !== 'const' && visto && !g) return src.slice(inizio, i+1); }
    else if(c === '['){ q++; } else if(c === ']'){ q--; }
    else if(c === '('){ t++; } else if(c === ')'){ t--; }
    else if(tipo === 'const' && !g && !q && !t){
      if(c === ';') return src.slice(inizio, i+1);
      if(c === '\n' && src[i-1] !== ',' && src[i-1] !== '=') return src.slice(inizio, i);
    }
  }
  throw new Error('blocco non chiuso: ' + nome);
}

eval([
  ['BS_EXCLUDE','const'], ['BS_DIV','const'], ['BS_GEN','const'], ['BS_CAT','const'],
  ['BS_VEN_REQ','const'], ['bsTit','const'], ['bsPad2','const'],
  ['bsIsoDate','fn'], ['bsPeriodLabel','fn'], ['bsNumIt','fn'], ['bsCellDate','fn'],
  ['bsSettimanaDi','fn'], ['bsStg','fn'], ['bsVenAcc','fn'],
  ['bsParseVenduto','fn'], ['bsVenReport','fn'],
].map(([n,t]) => ritaglia(n, t)).join('\n'));

let ko = 0;
function check(cosa, atteso, ottenuto){
  const a = JSON.stringify(atteso), o = JSON.stringify(ottenuto);
  if(a !== o){ ko++; console.log('  X ' + cosa + ': atteso ' + a + ', ottenuto ' + o); }
  else console.log('  ok ' + cosa + ' = ' + o);
}

// ── Righe finte, nella forma esatta del file del gestionale ─────────────
const COLONNE = ['ENTE','FILIALE','GIORNO','CASSA','SCONTRINO','ORA','VENDITORE',
  'CASSIERA','NOME','BARCODE','TAGLIA','ARTICOLO','DESCRIZIONE','QTA','VAL_LORDO',
  'PRZVENDITA','SCONTOMERCE','SCONTOVAL','SCONTOCLIVAL','BONIFICO','REALIZZO',
  'CLASSIF7','DIVISION','CLASSIF8','MARKETING','STG','CLASSIF11','PRODOTTO',
  'CLASSIF9','SPORTODE','CLASSIF10','TARGET_GROUP','CARD'];

// giorno, filiale, articolo, taglia, qta, lordo, sconto, realizzo, divisione
function riga(g, fil, art, tg, qta, lordo, sconto, realizzo, div){
  const r = new Array(COLONNE.length).fill('');
  r[0]='930'; r[1]=fil; r[2]=g; r[9]='40688'+art; r[10]=tg; r[11]=art;
  r[12]='ARTICOLO '+art; r[13]=String(qta); r[14]=lordo; r[17]=sconto; r[20]=realizzo;
  r[22]=div||'Apparel'; r[24]='ORIGINALS & PARTNERSHIP'; r[25]='26F';
  r[27]='T-SHIRTS'; r[29]='ORIGINALS'; r[31]='MEN';
  return r;
}
function totali(){                       // la riga in fondo: nessuna filiale
  const r = new Array(COLONNE.length).fill('');
  r[13]='6.882,00'; r[14]='361.061,45';
  return r;
}

// Lunedì 29/06/2026 → domenica 05/07: la settimana che negli export mensili
// sta a cavallo fra il file di giugno e quello di luglio.
const GIUGNO = [COLONNE,
  riga('29/06/2026','905','ADIF6490','42','1','110','55','55'),
  riga('30/06/2026','905','ADIF6490','43','2','220','110','110'),
  riga('30/06/2026','905','ADKE1677','M','1','60','30','30'),
  riga('30/06/2026','355','ADIF6490','42','1','110','55','55'),
  riga('30/06/2026','905','LAB33290','S','1','0,3','0','0,3','Service'),
  riga('30/06/2026','905','UW40001','M','2','30','0','30'),
  totali()];

const LUGLIO = [COLONNE,
  riga('01/07/2026','905','ADIF6490','42','3','330','165','165'),
  riga('02/07/2026','905','ADIF6490','43','-1','-110','-55','-55'),
  riga('02/07/2026','905','ADKE1677','L','1','60','30','30'),
  // Reso di una taglia che in questa settimana non era mai stata venduta: il
  // suo saldo resta negativo, ed è il caso che tiene in piedi la quadratura.
  riga('05/07/2026','905','ADKE1677','S','-1','-60','-30','-30'),
  // 06/07 è il lunedì dopo: deve finire in un'altra settimana
  riga('06/07/2026','905','ADIF6490','42','1','110','55','55'),
  totali()];

function leggi(files){
  const acc = bsVenAcc();
  files.forEach((f,i) => bsParseVenduto(f, 'file'+i+'.xlsx', acc));
  return {acc, report: bsVenReport(acc)};
}
const trova = (rep, fil, ps) => rep.find(r => r.filiale===fil && r.period_start===ps);
const art = (r, code) => r && r.products.find(p => p.code===code);

// ── 1. Struttura, settimane, esclusioni ─────────────────────────────────
console.log('Un file solo (giugno):');
let g = leggi([GIUGNO]);
check('riga dei totali scartata', 1, g.acc.totali);
check('righe escluse (busta LAB)', 1, g.acc.escluse);
check('due negozi', 2, g.report.length);
check('settimana dal lunedì', '2026-06-29', g.report[0].period_start);
check('domenica di chiusura', '2026-07-05', g.report[0].period_end);
check('periodo leggibile', '29/06/2026 - 05/07/2026', g.report[0].period);

const g905 = trova(g.report, '905', '2026-06-29');
check('nessuna busta fra i codici', false, !!art(g905, 'LAB33290'));
check('prefisso AD tolto dai codici adidas', true, !!art(g905, 'IF6490'));
// Il gestionale antepone due lettere al codice del fornitore: AD per adidas,
// UW per l'underwear. Vanno tolte entrambe, perché il codice che resta è quello
// del file stock — cioè la chiave con cui si aggancia la giacenza. Tenendo
// "UW" l'underwear risulterebbe sempre a giacenza zero.
check('underwear conservato, ma anche lui senza prefisso',
      true, !!art(g905, '40001') && !art(g905, 'UW40001'));
check('pezzi sommati sui giorni', 3, art(g905,'IF6490').units);
check('valore in centesimi, non arrotondato', 165, art(g905,'IF6490').net);
check('taglie del codice', [['43',2,110],['42',1,55]], art(g905,'IF6490').sizes);
check('stagione tradotta come lo storico', 'FW2026', art(g905,'IF6490').all[5]);
check('giacenza lasciata vuota (viene dal file stock)', null, art(g905,'IF6490').all[22]);

// ── 2. La settimana spezzata fra due file ───────────────────────────────
// È il punto per cui i file non si salvano uno per volta.
console.log('\nDue file che si spartiscono la settimana 29/06-05/07:');
const due = leggi([GIUGNO, LUGLIO]);
const inv = leggi([LUGLIO, GIUGNO]);      // l'ordine non deve contare
const d905 = trova(due.report, '905', '2026-06-29');

check('la settimana a cavallo esiste una volta sola', 1,
      due.report.filter(r => r.filiale==='905' && r.period_start==='2026-06-29').length);
check('pezzi dei DUE file sommati (1+2+3-1)', 5, art(d905,'IF6490').units);
check('valore dei due file sommato', 275, art(d905,'IF6490').net);
check('i giorni di giugno non sono andati persi', true, art(d905,'IF6490').units > 3);
// Confronto per lunghezza e non per contenuto: stampare due report interi
// renderebbe illeggibile l'esito degli altri controlli.
check('caricare i file in ordine inverso non cambia nulla', true,
      JSON.stringify(due.report) === JSON.stringify(inv.report));

// Il lunedì successivo è un'altra settimana, non deve confluire.
check('06/07 finisce nella settimana dopo', true,
      !!trova(due.report, '905', '2026-07-06'));
check('e porta il suo unico pezzo', 1, art(trova(due.report,'905','2026-07-06'),'IF6490').units);

// ── 3. Resi e quadratura delle taglie ───────────────────────────────────
console.log('\nResi e quadratura:');
const ke = art(d905, 'KE1677');
check('articolo con un venduto e un reso: resta 1 pezzo netto', 1, ke.units);
check('la somma delle taglie fa i pezzi venduti', ke.units,
      ke.sizes.reduce((s,t) => s+t[1], 0));
check('la taglia resa resta, col segno', true, ke.sizes.some(t => t[1] < 0));

let quadra = true;
for(const r of due.report) for(const p of r.products)
  if(p.sizes.reduce((s,t)=>s+t[1],0) !== p.units) quadra = false;
check('quadratura taglie-pezzi su TUTTI i report', true, quadra);

// ── 4. Numeri all'italiana ──────────────────────────────────────────────
console.log('\nLettura dei numeri:');
check('"361.061,45" (punto = migliaia, virgola = decimali)', 361061.45, bsNumIt('361.061,45'));
check('"27,5"', 27.5, bsNumIt('27,5'));
check('"4.96" senza virgola = decimale (così scrive il file stock)', 4.96, bsNumIt('4.96'));
check('vuoto', 0, bsNumIt(''));
check('numero già numero', 12.5, bsNumIt(12.5));
check('testo non numerico', 0, bsNumIt('n.d.'));

// ── 4c. Ordine naturale delle taglie ────────────────────────────────────
// L'ordine della striscia serve a leggere la CURVA delle taglie: se a mancare
// sono le centrali è un problema di riassortimento, se sono le estreme è
// normale. Un ordine sbagliato rende la striscia inutile.
// Il vocabolario è quello vero del file stock, 177 valori diversi.
console.log('\nOrdine delle taglie:');
// Un eval solo: con eval separati le const finiscono ognuna nel proprio
// ambito e bsTgOrd non vedrebbe la scala delle lettere.
eval([ritaglia('BS_TG_LETTERE','const'), ritaglia('bsTgOrd','fn'),
      ritaglia('bsTgCmp','fn'), ritaglia('bsTgLabel','fn')].join('\n'));
const ord = a => a.slice().sort(bsTgCmp);

// Le mezze misure hanno il trattino DAVANTI e stanno fra la loro misura e la
// successiva: "-10" dopo il 10, prima dell'11.
check('mezze misure al posto giusto',
      ['9','-9','10','-10','11','-11','12'],
      ord(['12','-10','10','-11','9','11','-9']));
check('scarpe bambino, numeri interi', ['28','30','33','35'],
      ord(['35','28','33','30']));
check('"19." è 19, il punto in coda è rumore', ['18','19.','20'],
      ord(['20','18','19.']));
check('lettere in scala, non in ordine alfabetico',
      ['XS','S','M','L','XL','XXL'], ord(['XL','S','XXL','M','XS','L']));
check('2XL e XXL sono vicine, non agli antipodi',
      ['L','XL','XXL','2XL'], ord(['2XL','XXL','L','XL']));
check('giro vita in pollici', ['28"','30"','32"','34"'],
      ord(['34"','30"','28"','32"']));
check('mesi e anni prima delle taglie adulto',
      ['0-3M','3-6M','2-3A','3-4A'], ord(['3-4A','3-6M','2-3A','0-3M']));
check('taglie ignote in fondo', ['S','M','L','NS','UN'],
      ord(['UN','M','NS','L','S']));

// A schermo il trattino della mezza misura va DOPO il numero: "-10" letto di
// sfuggita sembra una quantità negativa.
check('etichetta della mezza misura', '10-', bsTgLabel('-10'));
check('le taglie intere non si toccano', '10', bsTgLabel('10'));
check('le lettere non si toccano', 'XL', bsTgLabel('XL'));
check('i mesi col trattino in mezzo restano', '3-6M', bsTgLabel('3-6M'));

console.log('\nSettimane e stagioni:');
check('lunedì di un lunedì è se stesso', ['2026-06-29','2026-07-05'], bsSettimanaDi('2026-06-29'));
check('lunedì di una domenica è sei giorni prima', ['2026-06-29','2026-07-05'], bsSettimanaDi('2026-07-05'));
check('26F', 'FW2026', bsStg('26F'));
check('26S', 'SS2026', bsStg('26S'));
check('sigla non riconosciuta resta com\'è', 'CON', bsStg('CON'));

// ── 4b. Taglie riscritte nella scala della giacenza ─────────────────────
// Il gestionale esporta il venduto in scala EU (42) e lo stock in scala UK (8):
// sono la stessa taglia scritta in due modi, e affiancarle senza convertirle
// renderebbe le due strisce della scheda prodotto illeggibili insieme.
// L'EAN è il ponte, e viene dai dati — non da una tabella EU→UK inventata, che
// sbaglierebbe sulle mezze misure.
console.log('\nConversione delle taglie sulla scala della giacenza:');
const MAPPA = {};
MAPPA['40688ADIF6490'] = '8';        // l'EAN finto delle righe di prova
const accC = bsVenAcc(MAPPA);
bsParseVenduto(GIUGNO, 'giugno.xlsx', accC);
const cRep = bsVenReport(accC);
const cArt = art(trova(cRep, '905', '2026-06-29'), 'IF6490');
check('le taglie note passano alla scala della giacenza',
      ['8', 3, 165], cArt.sizes[0]);
check('una sola taglia dopo la conversione (42 e 43 erano lo stesso EAN)',
      1, cArt.sizes.length);
check('i pezzi restano quelli', 3, cArt.units);
check('quante righe sono state convertite', 3, accC.convertite);

// Un EAN che nella fotografia non c'è (articolo esaurito ovunque) tiene la sua
// taglia originale: meglio quella che niente.
const kArt = art(trova(cRep, '905', '2026-06-29'), 'KE1677');
check('taglia non convertita se l\'EAN è sconosciuto', 'M', kArt.sizes[0][0]);

// Senza fotografia caricata l'import va avanti lo stesso, senza convertire.
const accS = bsVenAcc(null);
bsParseVenduto(GIUGNO, 'giugno.xlsx', accS);
check('senza mappa non converte niente', 0, accS.convertite);
// Restano separate come le scrive il gestionale (43 prima perché ha più pezzi).
check('e le taglie restano quelle del gestionale', [['43',2,110],['42',1,55]],
      art(trova(bsVenReport(accS), '905', '2026-06-29'), 'IF6490').sizes);

// ── 6. Filtro "Giacenza" della classifica ───────────────────────────────
// Serve soprattutto ordinando per copertura: copertura 0 vuol dire giacenza 0,
// quindi in cima finiscono gli ESAURITI, che non stanno per finire ma sono già
// finiti. La spunta "Disponibile" li toglie; quella opposta dà la lista del
// riassortimento.
console.log('\nFiltro Giacenza:');
// BS_I_OHQ è dichiarato insieme ad altri sulla stessa riga, quindi si ritaglia
// per il primo nome della riga: viene su tutta la dichiarazione.
eval([ritaglia('BS_I_UNITS','const'), ritaglia('bsOhq','fn'),
      ritaglia('bsStockStato','fn'), ritaglia('bsPassa','fn'),
      // `const` dentro eval resta confinato lì: `var` invece esce, ed è l'unico
      // modo di usare l'indice anche nelle righe qui sotto.
      'var I_OHQ = BS_I_OHQ;'].join('\n'));
var BS = {f: {stock: []}};

const conGiac = n => { const a = new Array(28); a[I_OHQ] = n; return {all: a}; };
check('giacenza positiva → disponibile', 'si', bsStockStato(conGiac(12)));
check('giacenza zero → esaurito', 'no', bsStockStato(conGiac(0)));
// Le giacenze negative sono errori di inventario, non merce: valgono esaurito.
check('giacenza negativa → esaurito', 'no', bsStockStato(conGiac(-3)));
// Terzo stato: senza fotografia caricata la giacenza NON si sa, e "non si sa"
// non è "esaurito". Dirlo esaurito farebbe sparire l'articolo dalla lista dei
// disponibili e comparire in quella del riassortimento, tutte e due sbagliate.
check('giacenza sconosciuta → nessuno dei due', '', bsStockStato({all: new Array(28)}));

BS.f.stock = [];
check('senza spunte passano tutti', [true, true, true],
      [conGiac(12), conGiac(0), {all: new Array(28)}].map(p => bsPassa('stock', bsStockStato(p))));
BS.f.stock = ['si'];
check('"Disponibile": passa solo chi ne ha', [true, false, false],
      [conGiac(12), conGiac(0), {all: new Array(28)}].map(p => bsPassa('stock', bsStockStato(p))));
BS.f.stock = ['no'];
check('"Esaurito": passa solo chi è a zero', [false, true, false],
      [conGiac(12), conGiac(0), {all: new Array(28)}].map(p => bsPassa('stock', bsStockStato(p))));
BS.f.stock = ['si', 'no'];
check('spuntati tutti e due: come nessuno, tranne gli sconosciuti', [true, true, false],
      [conGiac(12), conGiac(0), {all: new Array(28)}].map(p => bsPassa('stock', bsStockStato(p))));

// ── 5. Il salvataggio ───────────────────────────────────────────────────
// Questa parte esiste per un motivo preciso: il 26/08 il lettore era giusto e
// il salvataggio si è rotto lo stesso, su una variabile rimasta in una riga di
// log dopo un cambio di firma ("Can't find variable: fileName"). Il messaggio
// arrivava DOPO il ciclo, quindi i 272 report erano già stati scritti ma il
// conteggio andava perso e a schermo compariva "0 ok, 1 con errori".
// Controllare solo il lettore non basta: qui si esegue anche il salvataggio,
// col server finto.
console.log('\nSalvataggio (server finto):');
eval(ritaglia('bsSalvaVenduto', 'fn'));

const inviati = [];
function api(path, opts){                       // finto: registra e dice ok
  inviati.push([path, JSON.parse(opts.body)]);
  return Promise.resolve({ok:true, status:200, json:() => Promise.resolve({ok:true})});
}
function bsEsc(s){ return String(s==null?'':s); }
const messaggi = [];
function bsLog(m, err){ messaggi.push((err?'! ':'') + m); }
function bsResolveStore(fil){
  const m = {'905':'Rende', '355':'Lecce City'};
  return m[fil] ? {brand:'Adidas', location:m[fil]} : null;
}

const salvataggio = leggi([GIUGNO, LUGLIO]);

// I controlli stanno DENTRO la promessa: in JavaScriptCore le microtask si
// svuotano solo a fine script, quindi fuori di qui il salvataggio risulterebbe
// fermo al primo await e i conteggi sarebbero tutti a uno.
bsSalvaVenduto(salvataggio.acc, 2).then(function(){
  check('nessun errore durante il salvataggio', [], messaggi.filter(m => m[0]==='!'));
  check('una chiamata per ogni report', salvataggio.report.length, inviati.length);
  check('tutte a /bestseller/week', true, inviati.every(x => x[0]==='/bestseller/week'));
  check('ogni settimana-negozio scritta una volta sola',
        inviati.length,
        new Set(inviati.map(x => x[1].location + '|' + x[1].period_start)).size);
  check('i prodotti viaggiano con le taglie', true,
        inviati.every(x => x[1].products.every(p => Array.isArray(p.sizes))));
  check('il riepilogo finale non esplode (era qui il bug del 26/08)', true,
        messaggi.some(m => m.indexOf('report salvati') > -1));
  console.log(ko ? '\nFALLITI: ' + ko : '\nTutto a posto.');
}, function(e){
  ko++;
  console.log('  X il salvataggio ha lanciato: ' + (e && e.message || e));
  console.log('\nFALLITI: ' + ko);
});
'(esito sopra)';
