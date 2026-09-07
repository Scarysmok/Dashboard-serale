/* Lettura del file di disponibilità del fornitore
 * (js/09-bestseller.js: bsRiassCols, bsParseDisp).
 *
 * Perché non si può cercare un nome esatto: LO STESSO FILE è arrivato due
 * volte con la quantità scritta in due modi — `qty` nel file del 07/09,
 * `Giacenza al 07.09` nella versione annotata a mano. Un lettore che pretende
 * `qty` rifiuta il secondo; uno che pretende `giacenza` rifiuta il primo.
 * Quindi le intestazioni si riconoscono per parole chiave, e questo file
 * verifica che entrambe le scritture passino.
 *
 * La trappola: `Material Description` contiene "material" ma NON è il codice
 * articolo. Se le si dà la colonna del codice, ogni riga esce con
 * "XLG RUNNER DELUXE 2 …" come articolo e non incrocia niente — senza errori.
 *
 * Le righe di prova sono quelle vere del file del 07/09.
 *
 *     osascript -l JavaScript test-disponibilita.js
 */
ObjC.import('Foundation');

const SRC = 'js/09-bestseller.js';
const src = $.NSString.stringWithContentsOfFileEncodingError(SRC, $.NSUTF8StringEncoding, null).js;
if(!src) throw new Error('non leggo ' + SRC + ' — lanciami dalla cartella Dashboard-serale');

function estrai(nome){
  let i = src.indexOf('function ' + nome + '(');
  if(i < 0) throw new Error('non trovo ' + nome + ' in ' + SRC);
  if(src.slice(Math.max(0, i-6), i) === 'async ') i -= 6;
  let g = 0, visto = false;
  for(let k = i; k < src.length; k++){
    if(src[k] === '{'){ g++; visto = true; }
    else if(src[k] === '}'){ g--; if(visto && !g) return src.slice(i, k+1); }
  }
  throw new Error(nome + ': parentesi non bilanciate');
}
eval(estrai('bsRiassCols'));
eval(estrai('bsParseDisp'));

let ko = 0;
function check(cosa, atteso, ottenuto){
  const a = JSON.stringify(atteso), o = JSON.stringify(ottenuto);
  if(a !== o){ ko++; console.log('  X ' + cosa + ': atteso ' + a + ', ottenuto ' + o); }
  else console.log('  ok ' + cosa + ' = ' + o);
}

const DESCR = 'XLG RUNNER DELUXE 2 VAGRME/CRYWHT/SILVMT';
// Le righe del file vero, prime tre.
const VERE = [
  ['Material', 'Grid Value', 'Material Description', 'EAN', 'qty'],
  ['KZ7203', '5',  DESCR, '4068805227646', '1'],
  ['KZ7203', '6',  DESCR, '4068805227677', '1'],
  ['KZ7203', '6-', DESCR, '4068805227554', '1'],
];

// ── 1. Le colonne ───────────────────────────────────────────────────────
console.log('Riconoscimento delle colonne del file vero:');
let c = bsRiassCols(VERE[0]);
check('codice articolo: colonna A, non la descrizione', 0, c.code);
check('descrizione: colonna C', 2, c.nome);
check('taglia', 1, c.tg);
check('EAN', 3, c.ean);
check('quantità', 4, c.qty);

// La versione annotata a mano: la quantità si chiama "Giacenza al 07.09" e la
// descrizione non c'è.
console.log('\nStesso file con le intestazioni cambiate a mano:');
c = bsRiassCols(['Material', 'Grid Value', 'EAN', 'Giacenza al 07.09']);
check('codice', 0, c.code);
check('quantità riconosciuta comunque', 3, c.qty);
check('descrizione assente', -1, c.nome);

// Scritte in italiano, come potrebbe arrivare da un altro fornitore.
console.log('\nIntestazioni in italiano:');
c = bsRiassCols(['Codice', 'Taglia', 'Barcode', 'Quantità']);
check('codice', 0, c.code);
check('taglia', 1, c.tg);
check('ean', 2, c.ean);
check('quantità', 3, c.qty);

// ── 2. Le righe ─────────────────────────────────────────────────────────
console.log('\nLettura delle righe:');
let d = bsParseDisp(VERE, 'Foglio1');
check('intestazioni trovate', true, d.intestazioni);
check('tre righe', 3, d.righe.length);
check('la prima riga', {code:'KZ7203', nome:DESCR, taglia:'5',
                        ean:'4068805227646', qty:1}, d.righe[0]);
check('la mezza misura resta come la scrive il fornitore', '6-', d.righe[2].taglia);
check('niente scarti', 0, d.scartate);

// ── 3. Quello che si butta ──────────────────────────────────────────────
// La riga dei totali in fondo non ha codice articolo: cade da sola, senza
// bisogno di riconoscerla. È la riga che l'utente aveva già segnalato di
// dover togliere a mano dai file del venduto.
console.log('\nRiga di totali in fondo e quantità a zero:');
d = bsParseDisp([
  VERE[0],
  ['KZ7203', '5', DESCR, '4068805227646', '2'],
  ['KZ7203', '9', DESCR, '4068805227592', '0'],   // taglia senza disponibilità
  [null, null, null, null, '51'],                 // totali
  ['', '', '', '', ''],                           // riga vuota
], 'Foglio1');
check('resta solo la riga con disponibilità', 1, d.righe.length);
check('ed è quella giusta', 'KZ7203', d.righe[0].code);
// Una taglia a zero non è un errore da segnalare: è una taglia esaurita dal
// fornitore, e non c'è niente da distribuire.
check('la riga a zero è scartata', true, d.scartate >= 1);

// ── 4. Righe di titolo sopra la tabella ─────────────────────────────────
// Molti export mettono il nome del report nella prima riga. Le intestazioni si
// cercano riga per riga, quindi il file si apre comunque.
console.log('\nTitolo prima delle intestazioni:');
d = bsParseDisp([
  ['Disponibilità XLG da girare ai negozi'],
  [],
  VERE[0],
  ['KZ7205', '8-', 'XLG RUNNER DELUXE 2 WONWHI', '4068805231421', '5'],
], 'Foglio1');
check('trova le intestazioni più sotto', true, d.intestazioni);
check('e legge la riga', [{code:'KZ7205', nome:'XLG RUNNER DELUXE 2 WONWHI',
                           taglia:'8-', ean:'4068805231421', qty:5}], d.righe);

// ── 5. File che non è quello ────────────────────────────────────────────
// Meglio dire "non trovo le colonne" che leggere zero righe e far pensare a un
// file vuoto: sono due problemi diversi e si risolvono in due modi diversi.
console.log('\nFile sbagliato:');
d = bsParseDisp([['Negozio', 'Data', 'Incasso'], ['Bariblu', '01/09/2026', '1200']], 'Foglio1');
check('nessuna intestazione riconosciuta', false, d.intestazioni);
check('e nessuna riga', 0, d.righe.length);
d = bsParseDisp([], 'Foglio1');
check('file vuoto', [false, 0], [d.intestazioni, d.righe.length]);

// ── 6. Numeri scritti come capita ───────────────────────────────────────
console.log('\nQuantità scritte in modi diversi:');
d = bsParseDisp([
  VERE[0],
  ['KZ7203', '5', DESCR, '406', 3],       // numero, non testo
  ['KZ7203', '6', DESCR, '407', '2,0'],   // virgola decimale
  ['KZ7203', '7', DESCR, '408', ' 4 '],   // spazi
], 'Foglio1');
check('tre righe lette', [3, 2, 4], d.righe.map(r => r.qty));

console.log(ko ? '\nFALLITI: ' + ko : '\nTutto a posto.');
