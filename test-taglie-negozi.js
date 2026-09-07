/* Riquadro "chi ha venduto / chi ha in giacenza questa taglia"
 * (js/09-bestseller.js: bsTgNegServe, bsTgPopHtml).
 *
 * Due cose da tenere ferme:
 *
 * 1. bsTgNegServe() decide SE chiedere la ripartizione al server. Con un
 *    negozio solo deve dire no: il riquadro elencherebbe una riga con dentro
 *    il negozio che si sta già guardando, e ogni apertura di scheda farebbe
 *    una chiamata per non dire niente.
 *
 * 2. Nel riquadro va il nome del NEGOZIO, non la chiave interna. Le chiavi
 *    arrivano dal server come "Adidas|Bariblu" perché è così che il modulo
 *    identifica un negozio da sempre; a schermo quella barra verticale non
 *    deve mai comparire.
 *
 *     osascript -l JavaScript test-taglie-negozi.js
 */
ObjC.import('Foundation');

const SRC = 'js/09-bestseller.js';
const src = $.NSString.stringWithContentsOfFileEncodingError(SRC, $.NSUTF8StringEncoding, null).js;
if(!src) throw new Error('non leggo ' + SRC + ' — lanciami dalla cartella Dashboard-serale');

function estrai(nome){
  const i = src.indexOf('function ' + nome + '(');
  if(i < 0) throw new Error('non trovo ' + nome + ' in ' + SRC);
  let g = 0, visto = false;
  for(let k = i; k < src.length; k++){
    if(src[k] === '{'){ g++; visto = true; }
    else if(src[k] === '}'){ g--; if(visto && !g) return src.slice(i, k+1); }
  }
  throw new Error(nome + ': parentesi non bilanciate');
}
eval(estrai('bsTgNegServe'));
eval(estrai('bsTgPopHtml'));
eval(estrai('bsTgLabel'));

var BS = {public:false, cur:null, data:null, tgNeg:null};
function bsEsc(s){ return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function bsFmt(n){ return String(n); }

let ko = 0;
function check(cosa, atteso, ottenuto){
  const a = JSON.stringify(atteso), o = JSON.stringify(ottenuto);
  if(a !== o){ ko++; console.log('  X ' + cosa + ': atteso ' + a + ', ottenuto ' + o); }
  else console.log('  ok ' + cosa + ' = ' + o);
}

// ── 1. Quando serve chiedere la ripartizione ────────────────────────────
console.log('Serve chiedere i negozi?');
BS.public = false;
BS.cur = {aggregate:true};
check('in app, guardando tutti i negozi', true, bsTgNegServe());
BS.cur = {aggregate:false, brand:'Adidas', location:'Bariblu'};
check('in app, un negozio solo', false, bsTgNegServe());
BS.cur = null;
check('senza selezione', false, bsTgNegServe());

BS.public = true;
BS.data = {aggregate:true, store_count:8};
check('dal link, aggregato di 8 negozi', true, bsTgNegServe());
BS.data = {aggregate:true, store_count:1};
// Un link su un negozio solo: l'aggregato di uno non è un aggregato.
check('dal link, aggregato di uno', false, bsTgNegServe());
BS.data = {aggregate:false, store_count:8};
check('dal link, sceso su un negozio', false, bsTgNegServe());
BS.data = null;
check('dal link, senza dati', false, bsTgNegServe());

// ── 2. Il contenuto del riquadro ────────────────────────────────────────
console.log('\nContenuto del riquadro:');
BS.tgNeg = {
  venduto:  {'OSFM': [['Adidas|Bariblu', 9], ['Adidas|Lecce City', 3]]},
  giacenza: {'OSFM': [['Adidas|Taranto', 12]], '-10': [['Adidas|Bariblu', 4]]},
};
const h = bsTgPopHtml('OSFM', 'venduto');
check('c\'è il nome del negozio', true, h.includes('Bariblu') && h.includes('Lecce City'));
check('la chiave interna NON compare', false, h.includes('|') || h.includes('Adidas'));
check('i pezzi', true, h.includes('>9<') && h.includes('>3<'));
// 9 su 12 = 75%, 3 su 12 = 25%: la percentuale è sul totale della taglia, non
// sul totale dell'articolo — la domanda è "di questi 12 pezzi, dove stanno".
check('le percentuali sono sul totale della taglia', true,
      h.includes('75%') && h.includes('25%'));
check('l\'ordine arriva dal server e non si tocca', true,
      h.indexOf('Bariblu') < h.indexOf('Lecce City'));

console.log('\nCasi in cui il riquadro non c\'è:');
check('taglia senza righe', '', bsTgPopHtml('OSFY', 'venduto'));
check('striscia non chiesta', '', bsTgPopHtml('OSFM', ''));
BS.tgNeg = null;
check('ripartizione non ancora arrivata', '', bsTgPopHtml('OSFM', 'venduto'));

// Mezze misure: "-10" si scrive "10-" (deciso il 26/08). Il riquadro deve
// usare la stessa scrittura delle barre, altrimenti l'intestazione del
// riquadro e la taglia sotto la barra si leggono come due taglie diverse.
console.log('\nMezze misure:');
BS.tgNeg = {giacenza:{'-10': [['Adidas|Bariblu', 4]]}, venduto:{}};
check('l\'intestazione usa la scrittura delle barre', true,
      bsTgPopHtml('-10', 'giacenza').includes('10-'));

console.log(ko ? '\nFALLITI: ' + ko : '\nTutto a posto.');
