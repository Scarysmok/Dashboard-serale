/* Ogni nome usato nel modulo Best Seller esiste davvero.
 *
 * Perché serve. js/09-bestseller.js è un file da 2.500 righe di script
 * classico: tutto vive nello stesso ambito globale e nessuno controlla i nomi
 * prima che il browser ci arrivi. `node --check` e il controllo di sintassi
 * vedono solo le parentesi.
 *
 * Il 07/09 ho riscritto il blocco dell'Excel sostituendo un intervallo di
 * testo — dall'inizio di una funzione all'inizio di un'altra — e in mezzo c'era
 * bsCalcolaRiass, che è sparita. Il file compilava, la pagina si apriva, il
 * pulsante Calcola si agganciava a una variabile inesistente, e l'errore
 * arrivava all'utente travestito: "File di disponibilità non leggibile".
 *
 * Questo test cerca ogni `bsQualcosa` e `BS_QUALCOSA` usato nel file e verifica
 * che sia dichiarato da qualche parte. Non sostituisce i test di
 * comportamento — dice solo che i nomi esistono — ma è l'unica rete sotto le
 * modifiche fatte per intervalli di testo.
 *
 *     osascript -l JavaScript test-funzioni.js
 */
ObjC.import('Foundation');

const FILE = 'js/09-bestseller.js';
const src = $.NSString.stringWithContentsOfFileEncodingError(FILE, $.NSUTF8StringEncoding, null).js;
if(!src) throw new Error('non leggo ' + FILE + ' — lanciami dalla cartella Dashboard-serale');

// Fuori dai commenti: un nome citato in un commento non è un uso, e i commenti
// di questo file parlano molto delle sue funzioni.
const codice = src
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');

const dichiarati = new Set();
{
  let m;
  const fn = /(?:async\s+)?function\s+(bs[A-Za-z0-9_]*)\s*\(/g;
  while((m = fn.exec(codice))) dichiarati.add(m[1]);
  // Le dichiarazioni con più nomi in una riga vanno lette tutte:
  // `const BS_I_UNITS = 13, BS_I_ST = 25, BS_I_OHQ = 22;` dichiara TRE nomi, e
  // fermarsi al primo faceva sembrare inesistenti gli altri due.
  const dec = /\b(?:const|let|var)\s+([^;\n]*)/g;
  while((m = dec.exec(codice))){
    const nomi = /(?:^|,)\s*(bs[A-Za-z0-9_]*|BS[A-Za-z0-9_]*)\s*=/g;
    let k;
    while((k = nomi.exec(m[1]))) dichiarati.add(k[1]);
  }
}

// Usati: bsQualcosa e BS_QUALCOSA, escludendo gli accessi a proprietà (`.bsX`)
// che non sono nomi globali.
const usati = new Map();
const re = /(^|[^A-Za-z0-9_$.])((?:bs[A-Z][A-Za-z0-9_]*)|(?:BS_[A-Z0-9_]+))/g;
let m;
while((m = re.exec(codice))){
  const nome = m[2];
  if(!usati.has(nome)) usati.set(nome, codice.slice(0, m.index).split('\n').length);
}

const mancanti = [...usati.keys()].filter(n => !dichiarati.has(n)).sort();

console.log(`Nomi dichiarati: ${dichiarati.size} · usati: ${usati.size}`);
if(mancanti.length){
  console.log('\nUSATI MA MAI DICHIARATI:');
  for(const n of mancanti) console.log(`  X ${n} (prima volta alla riga ~${usati.get(n)})`);
  console.log('\nFALLITI: ' + mancanti.length);
}else{
  console.log('  ok ogni nome usato è dichiarato');
  console.log('\nTutto a posto.');
}
