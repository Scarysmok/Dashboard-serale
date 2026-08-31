/* Vista "Per negozio" della tab Andamento (js/06-analisi.js).
 *
 * Due cose da proteggere, e la seconda è quella che conta.
 *
 * 1. _amAlbero() è codice ESTRATTO da renderTempo(), che prima costruiva
 *    l'albero anno→mese→giorno una volta sola e inline. Ora lo costruisce una
 *    volta per l'aggregato e una per ogni negozio. L'estrazione non deve aver
 *    cambiato i conti della vista che c'era già.
 *
 * 2. Ogni colonna deve leggere l'anno scorso dalla PROPRIA tabella. Prima i
 *    negozi venivano sommati alla prima riga (`dailySums[data]`) e da lì in poi
 *    il negozio non esisteva più; il badge "vs anno scorso" pescava da lì. Se
 *    per distrazione si passasse quella tabella anche alle colonne dei singoli
 *    negozi, ognuno verrebbe confrontato con il TOTALE dell'anno scorso: un
 *    numero plausibile, grande, e completamente sbagliato. È un errore che non
 *    si vede guardando lo schermo, ed è per questo che lo controlla un test.
 *
 *     osascript -l JavaScript test-andamento.js
 */
ObjC.import('Foundation');

const SRC = 'js/06-analisi.js';
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
eval(estrai('_amAlbero'));
eval(estrai('_amTabellaHtml'));

var amExpanded = new Set();
var amRuotaVia = false;      // avviso "ruota il telefono" non ancora chiuso
function _escHtml(s){ return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

let ko = 0;
function check(cosa, atteso, ottenuto){
  const a = JSON.stringify(atteso), o = JSON.stringify(ottenuto);
  if(a !== o){ ko++; console.log('  X ' + cosa + ': atteso ' + a + ', ottenuto ' + o); }
  else console.log('  ok ' + cosa + ' = ' + o);
}

// ── 1. L'albero ─────────────────────────────────────────────────────────
// OGGI = 2026-08-28. Tre giorni passati con incasso, uno passato a zero
// (chiusura non ancora arrivata) e uno futuro (solo target).
const OGGI = '2026-08-28';
const date = ['2026-08-25','2026-08-26','2026-08-27','2026-08-28','2026-08-31'];
const sums = {
  '2026-08-25': {net:1000, tgt:900},
  '2026-08-26': {net:1200, tgt:1000},
  '2026-08-27': {net: 800, tgt:1100},
  '2026-08-28': {net:   0, tgt:1000},   // oggi, chiusure non arrivate
  '2026-08-31': {net:   0, tgt: 950},   // futuro
};
console.log('Albero di un mese con oggi e un giorno futuro:');
const alb = _amAlbero(sums, date, OGGI);
const y = alb['2026'], m = y.months['2026-08'];
check('net consuntivato (il giorno a zero non entra)', 3000, m.netPast);
check('target dei soli giorni consuntivati', 3000, m.tgtPast);
check('target di tutto il mese, futuro compreso', 4950, m.tgtAll);
check('giorni consuntivati', 3, m.daysPast);
check('giorni in corso (passati ma senza incasso)', 1, m.daysPending);
check('giorni futuri', 1, m.daysFuture);
check('l\'anno somma il mese', [3000, 4950], [y.netPast, y.tgtAll]);
check('tutti i giorni restano nell\'albero', 5, m.days.length);

// Un negozio senza dati in quelle date: struttura presente, numeri a zero.
// Serve perché le colonne devono avere le STESSE righe, altrimenti la
// tabella slitta e i confronti sulla riga non valgono più.
console.log('\nNegozio senza nessun dato, sulle stesse date:');
const vuoto = _amAlbero({}, date, OGGI);
check('l\'anno c\'è lo stesso', true, !!vuoto['2026']);
check('con gli stessi giorni', 5, vuoto['2026'].months['2026-08'].days.length);
check('ma a zero', [0, 0], [vuoto['2026'].netPast, vuoto['2026'].tgtAll]);

// ── 2. Ogni colonna col SUO anno scorso ─────────────────────────────────
// pyAlignedDelta finto: non calcola niente, registra solo quale tabella gli
// è stata passata. È esattamente ciò che va verificato.
console.log('\nQuale tabella riceve il confronto con l\'anno scorso:');
const sumsA = {'2026-08-25': {net:600, tgt:500}};
const sumsB = {'2026-08-25': {net:400, tgt:400}};
const visti = [];
const ctx = {
  colonne: [
    {sk:'Adidas|Bariblu', info:{brand:'Adidas', location:'Bariblu'}, sums:sumsA, years:_amAlbero(sumsA, date, OGGI)},
    {sk:'Adidas|Taranto', info:{brand:'Adidas', location:'Taranto'}, sums:sumsB, years:_amAlbero(sumsB, date, OGGI)},
  ],
  years: alb, todayISO: OGGI, curMonthISO: '2026-08',
  fmt: n => '€ ' + Math.round(n),
  fmtPctSign: d => (d>=0?'+':'') + d.toFixed(1) + '%',
  badgeCls: d => d >= -5 ? 'green' : (d >= -30 ? 'yellow' : 'red'),
  periodStatus: (p,f) => (p>0&&f===0) ? 'past' : (p===0&&f>0 ? 'future' : 'current'),
  pyAlignedDelta: (giorni, tab) => { visti.push(tab); return 10; },
  DAYS_IT: ['Dom','Lun','Mar','Mer','Gio','Ven','Sab'],
  compareTgt: true, comparePy: true,
};
amExpanded = new Set();          // tutto chiuso: una riga sola, l'anno
const html = _amTabellaHtml(ctx);
check('tre celle: totale + due negozi', 3, visti.length);
check('il totale riceve null (→ la tabella aggregata, per default)', null, visti[0]);
check('il primo negozio riceve la SUA tabella', true, visti[1] === sumsA);
check('il secondo negozio riceve la SUA', true, visti[2] === sumsB);
check('e non quella dell\'aggregato', false, visti[1] === sumsB || visti[2] === sumsA);

// ── 3. La tabella ───────────────────────────────────────────────────────
console.log('\nLa tabella:');
check('una colonna del totale per riga', 2,            // 1 nell'intestazione + 1 nella riga anno
      (html.match(/amc-tot/g) || []).length);
check('i nomi dei negozi in intestazione', true,
      html.includes('Bariblu') && html.includes('Taranto'));
check('la riga dell\'anno apre e chiude', true, html.includes("toggleAmRow('y2026')"));
check('i mesi non ci sono finché l\'anno è chiuso', false, html.includes("toggleAmRow('m2026-08')"));

amExpanded = new Set(['y2026']);
const aperto = _amTabellaHtml(ctx);
check('aperto l\'anno, compare il mese', true, aperto.includes("toggleAmRow('m2026-08')"));
check('i giorni no, il mese è chiuso', false, aperto.includes('Mar 25'));

amExpanded = new Set(['y2026', 'm2026-08']);
const tutto = _amTabellaHtml(ctx);
check('aperto il mese, compaiono i giorni', true, tutto.includes('Mar 25'));
// Il 26 e il 27 il negozio B non ha dati: cella vuota, non uno zero. Non aver
// venduto e non essere nei dati sono due cose diverse, e uno zero direbbe la
// prima quando è vera la seconda.
check('giorni senza dati: trattino, non zero', true, tutto.includes('amc-no'));

// ── 4. L'avviso "ruota il telefono" ─────────────────────────────────────
// Chi decide SE mostrarlo è il CSS (telefono, in verticale). Qui si controlla
// solo che una volta chiuso resti chiuso: la tabella si ridisegna a ogni mese
// che si apre, e senza la variabile l'avviso tornerebbe a ogni tocco.
console.log('\nAvviso "ruota il telefono":');
amRuotaVia = false;
check('c\'è', true, _amTabellaHtml(ctx).includes('class="amc-ruota"'));
amRuotaVia = true;
check('chiuso, resta chiuso anche dopo un nuovo disegno', true,
      _amTabellaHtml(ctx).includes('amc-ruota via'));
amRuotaVia = false;

console.log(ko ? '\nFALLITI: ' + ko : '\nTutto a posto.');
