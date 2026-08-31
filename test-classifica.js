/* Colonne degli scostamenti nella classifica KPI (js/06-analisi.js).
 *
 * Cosa protegge:
 *
 * 1. Le colonne devono essere quelle ACCESE con i tre pulsanti sopra il
 *    grafico. Prima la classifica mostrava sempre e solo la media brand, anche
 *    a pulsante spento — un pezzo di schermata che non dava retta ai suoi
 *    comandi, e nessuno se ne accorgeva perché il numero c'era e sembrava
 *    sensato.
 *
 * 2. Ogni negozio va confrontato con il PROPRIO valore dell'anno scorso (e del
 *    periodo precedente), non con quello di un altro. Le tabelle arrivano da
 *    due funzioni diverse e si incrociano per chiave brand|negozio: se
 *    l'incrocio saltasse, ogni riga mostrerebbe il numero del vicino — sempre
 *    plausibile, mai giusto.
 *
 * 3. Con un negozio solo la media del suo brand è il negozio stesso: lo
 *    scostamento sarebbe zero per forza. Deve uscire un trattino, non "0,0%",
 *    che sembra un'informazione e non lo è.
 *
 *     osascript -l JavaScript test-classifica.js
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
eval(estrai('kpiRenderRanking'));
eval(estrai('kpiAggregateByStore'));
eval(estrai('kpiDelta'));

// ── Il mondo attorno alla funzione, ridotto all'essenziale ──────────────
var kpiState = { kpi:'ingressi', sort:'val', compare:new Set() };
var _uscita = '';
var document = { getElementById: () => ({ set innerHTML(v){ _uscita = v; } }) };
function kpiValFromRecord(r){ return r.v; }
function kpiSparkline(){ return '<svg></svg>'; }
function kpiFmt(v){ return String(Math.round(v)); }
function attrEsc(s){ return String(s); }
function kpiLabel(k){ return {ingressi:'Ingressi'}[k]; }

const rec = (b,l,v) => ({brand:b, location:l, dateISO:'2026-08-20', v});
// Oggi: Bariblu 100, Taranto 60 (media Adidas 80). Yamamay Trani 40, da solo.
var _ora  = [rec('Adidas','Bariblu',100), rec('Adidas','Taranto',60), rec('Yamamay','Trani',40)];
// Anno scorso: Bariblu 80 (+25%), Taranto 60 (0%), Trani 50 (−20%)
var _py   = [rec('Adidas','Bariblu',80),  rec('Adidas','Taranto',60), rec('Yamamay','Trani',50)];
// Periodo precedente: solo Bariblu, 50 (+100%). Gli altri non hanno un pari.
var _prev = [rec('Adidas','Bariblu',50)];
function kpiFiltered(){ return _ora; }
function kpiPyShiftedFiltered(){ return _py; }
function kpiPrevFiltered(){ return _prev; }

let ko = 0;
function check(cosa, atteso, ottenuto){
  const a = JSON.stringify(atteso), o = JSON.stringify(ottenuto);
  if(a !== o){ ko++; console.log('  X ' + cosa + ': atteso ' + a + ', ottenuto ' + o); }
  else console.log('  ok ' + cosa + ' = ' + o);
}
// Gli scostamenti di una riga, nell'ordine in cui compaiono.
function scostamenti(negozio){
  const righe = _uscita.split('kpi-rank-row').filter(r => r.includes(negozio));
  if(!righe.length) return ['RIGA ASSENTE'];
  const m = righe[0].match(/kpi-rank-delta [a-z]+"[^>]*>([^<]*)</g) || [];
  return m.map(x => x.replace(/.*>/, '').replace(/<$/, '').trim());
}
function intestazioni(){
  const i = _uscita.indexOf('kpi-rank-head');
  if(i < 0) return [];
  const testa = _uscita.slice(i, _uscita.indexOf('kpi-rank-row'));
  return (testa.match(/kpi-rank-delta">([^<]*)</g) || []).map(x => x.replace(/.*>/, '').replace('<',''));
}

// ── 1. Nessun confronto acceso ──────────────────────────────────────────
console.log('Tutti e tre i pulsanti spenti:');
kpiState.compare = new Set();
kpiRenderRanking();
check('nessuna colonna di scostamento', [], scostamenti('Bariblu'));
check('e nessuna intestazione', false, _uscita.includes('kpi-rank-head'));

// ── 2. Solo "vs anno scorso" ────────────────────────────────────────────
console.log('\nSolo vs anno scorso:');
kpiState.compare = new Set(['py']);
kpiRenderRanking();
check('una colonna sola', ['A-1'], intestazioni());
check('Bariblu 100 contro i suoi 80', ['▲ 25.0%'], scostamenti('Bariblu'));
check('Taranto 60 contro i suoi 60: in pari', ['• 0.0%'], scostamenti('Taranto'));
check('Trani 40 contro i suoi 50', ['▼ 20.0%'], scostamenti('Trani'));

// ── 3. Tutti e tre ──────────────────────────────────────────────────────
// L'ordine delle colonne è fisso e non dipende da quale si accende prima.
console.log('\nTutti e tre accesi:');
kpiState.compare = new Set(['prev','brand','py']);   // accesi in ordine sparso
kpiRenderRanking();
check('ordine fisso A-1 · Brand · Prec.', ['A-1','Brand','Prec.'], intestazioni());
check('Bariblu: +25% py, +25% brand (100 su 80), +100% prec (100 su 50)',
      ['▲ 25.0%', '▲ 25.0%', '▲ 100.0%'], scostamenti('Bariblu'));
// Taranto non ha un periodo precedente: trattino, non zero.
check('Taranto senza periodo precedente: trattino', ['• 0.0%', '▼ 25.0%', '—'],
      scostamenti('Taranto'));

// ── 4. Un negozio solo nel suo brand ────────────────────────────────────
// Trani è l'unico Yamamay: la "media del brand" sarebbe lui stesso.
console.log('\nBrand con un negozio solo:');
check('media brand: trattino, non 0,0%', '—', scostamenti('Trani')[1]);

// ── 5. Un solo negozio selezionato in tutto ─────────────────────────────
console.log('\nUn solo negozio selezionato:');
_ora = [rec('Adidas','Bariblu',100)];
kpiState.compare = new Set(['brand']);
kpiRenderRanking();
check('niente confronto con sé stesso', ['—'], scostamenti('Bariblu'));

console.log(ko ? '\nFALLITI: ' + ko : '\nTutto a posto.');
