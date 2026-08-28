/* Controllo del conteggio delle aperture (js/05-chiusure.js, _apConteggi).
 *
 * Perché esiste: gli stessi numeri compaiono in due posti — l'intestazione nera
 * ("N aperture non ricevute · M negozi chiusi") e la riga sopra la lista
 * ("X su Y aperture ricevute") — ed erano calcolati due volte. Due conti
 * separati sulla stessa schermata possono dire cose diverse, e chi guarda non
 * ha modo di sapere quale credere. Ora la funzione è una sola: questo file
 * verifica che dica la cosa giusta.
 *
 * La regola che protegge: DA UN NEGOZIO CHIUSO NON SI ASPETTA L'APERTURA.
 * Esce dal denominatore e si conta a parte. Contandolo fra gli attesi, ogni
 * domenica sembrerebbe che manchi una checklist.
 *
 *     osascript -l JavaScript test-aperture.js
 */
ObjC.import('Foundation');

const SRC = 'js/05-chiusure.js';
const src = $.NSString.stringWithContentsOfFileEncodingError(SRC, $.NSUTF8StringEncoding, null).js;
if(!src) throw new Error('non leggo ' + SRC + ' — lanciami dalla cartella Dashboard-serale');

const i = src.indexOf('function _apConteggi(');
if(i < 0) throw new Error('non trovo _apConteggi in ' + SRC);
let g = 0, visto = false, fine = -1;
for(let k = i; k < src.length; k++){
  if(src[k] === '{'){ g++; visto = true; }
  else if(src[k] === '}'){ g--; if(visto && !g){ fine = k+1; break; } }
}
eval(src.slice(i, fine));

// ── Il mondo attorno alla funzione, ridotto all'essenziale ──────────────
const GIORNO = '2026-08-28';
var ALL_STORES = [
  {brand:'Adidas',   location:'Bariblu'},
  {brand:'Adidas',   location:'Taranto'},
  {brand:'Yamamay',  location:'Monopoli'},
  {brand:'Yamamay',  location:'Trani'},
  {brand:'Carpisa',  location:'Lecce'},     // non monitorato: fuori da tutto
];
var chiusiOggi = new Set();
var nonMonitorati = new Set(['Carpisa|Lecce']);
var allAperture = [];

function storeKey(b, l){ return b + '|' + l; }
function isStoreMonitoredOn(b, l){ return !nonMonitorati.has(storeKey(b,l)); }
function isStoreClosedOn(b, l){ return chiusiOggi.has(storeKey(b,l)); }

let ko = 0;
function check(cosa, atteso, ottenuto){
  const a = JSON.stringify(atteso), o = JSON.stringify(ottenuto);
  if(a !== o){ ko++; console.log('  X ' + cosa + ': atteso ' + a + ', ottenuto ' + o); }
  else console.log('  ok ' + cosa + ' = ' + o);
}
const apertura = (b, l, quando) => ({brand:b, location:l, dateISO:GIORNO, modifiedTime:quando||'2026-08-28T07:00:00Z'});

// ── 1. Giornata normale ─────────────────────────────────────────────────
console.log('Quattro negozi attesi, due hanno inviato:');
chiusiOggi = new Set();
allAperture = [apertura('Adidas','Bariblu'), apertura('Yamamay','Monopoli')];
check('attesi (il non monitorato resta fuori)', 4, _apConteggi(GIORNO).attesi);
check('ricevute', 2, _apConteggi(GIORNO).ricevute);
check('mancanti', 2, _apConteggi(GIORNO).mancanti);
check('chiusi', 0, _apConteggi(GIORNO).chiusi);

// ── 2. Un negozio chiuso ────────────────────────────────────────────────
// Esce dal denominatore: 2 su 3, non 2 su 4 con un mancante in più.
console.log('\nUno dei quattro è chiuso quel giorno:');
chiusiOggi = new Set(['Yamamay|Trani']);
let c = _apConteggi(GIORNO);
check('attesi scendono a 3', 3, c.attesi);
check('ricevute', 2, c.ricevute);
check('mancanti: solo Taranto, non anche Trani', 1, c.mancanti);
check('chiusi contati a parte', 1, c.chiusi);
check('la somma torna: attesi = ricevute + mancanti', c.attesi, c.ricevute + c.mancanti);

// ── 3. Chiuso ma ha inviato lo stesso ───────────────────────────────────
// Se la checklist è arrivata il negozio era aperto, comunque dica il calendario
// dei target: vale come ricevuta, non come chiuso.
console.log('\nNegozio segnato chiuso che invia comunque:');
chiusiOggi = new Set(['Yamamay|Trani']);
allAperture = [apertura('Adidas','Bariblu'), apertura('Yamamay','Trani')];
c = _apConteggi(GIORNO);
check('conta come ricevuta', 2, c.ricevute);
check('e NON come chiuso', 0, c.chiusi);
check('attesi tornano quattro', 4, c.attesi);

// ── 4. Stessa checklist caricata due volte ──────────────────────────────
// Sono PDF, non negozi: senza dedup il banner contava i file e usciva
// incoerente ("24 su 25 ricevute · 2 mancanti", visto l'08/07/2026).
console.log('\nStesso negozio con due PDF nello stesso giorno:');
chiusiOggi = new Set();
allAperture = [apertura('Adidas','Bariblu','2026-08-28T07:00:00Z'),
               apertura('Adidas','Bariblu','2026-08-28T09:30:00Z')];
c = _apConteggi(GIORNO);
check('vale una volta sola', 1, c.ricevute);
check('mancanti', 3, c.mancanti);

// ── 5. Casi limite ──────────────────────────────────────────────────────
console.log('\nCasi limite:');
allAperture = [];
c = _apConteggi(GIORNO);
check('nessuna apertura: tutte mancanti', [4, 0, 4], [c.attesi, c.ricevute, c.mancanti]);
chiusiOggi = new Set(['Adidas|Bariblu','Adidas|Taranto','Yamamay|Monopoli','Yamamay|Trani']);
c = _apConteggi(GIORNO);
check('tutti chiusi: nessun atteso, nessun mancante', [0, 0, 0, 4],
      [c.attesi, c.ricevute, c.mancanti, c.chiusi]);
chiusiOggi = new Set();
allAperture = [apertura('Adidas','Bariblu')];
check('aperture di un altro giorno non contano', 0, _apConteggi('2026-08-27').ricevute);

console.log(ko ? '\nFALLITI: ' + ko : '\nTutto a posto.');
