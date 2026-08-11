// 00-az.js — primitive del tema azzurro (restyle 04/08/2026).
//
// Il tema è quasi tutto in css/theme-azzurro.css, che riveste le classi già
// presenti nel markup. Qui c'è la sola parte che il CSS non può inventarsi: le
// intestazioni nere col titolo gigante, che sono blocchi di HTML in più.
//
// INTERRUTTORE UNICO
// Tutto è appeso a `class="az"` sul tag <html>. Se la classe non c'è, AZ è false
// e queste funzioni restituiscono stringa vuota: i renderer le concatenano
// comunque, ma non aggiungono nulla e l'app torna identica a prima. È lo stesso
// interruttore che disattiva il foglio di stile, quindi non esistono stati
// intermedi (tema spento con le intestazioni accese, o viceversa).
//
// Nota sull'ordine di caricamento: questo file sta prima di 01-config.js, ma
// definisce solo funzioni e una costante, non legge nulla degli altri moduli.
// _escHtml() vive in 05-chiusure.js ed è una function declaration globale:
// al momento della chiamata (render) esiste, qualunque sia l'ordine dei tag.

var AZ = document.documentElement.classList.contains('az');

// Intestazione nera di sezione.
//   kicker  etichettina spaziata sopra il titolo   ("Riepilogo di ieri")
//   h1      prima riga del titolo, nera            ("Chiusure")
//   accent  seconda riga, colorata                 ("2 agosto")
//   bad     true → l'accento è rosso invece che azzurro (il titolo dice un
//           problema: "3 DA SISTEMARE"). Il rosso resta riservato a questo.
//   claim   riga di contesto sotto il titolo   ("28 chiusure su 30 · 30 aperture")
//   alert   la parte che segnala un problema, in rosso, in coda al claim
//           ("1 chiusura non arrivata"). È separata dal claim di proposito:
//           colorare tutta la riga faceva sembrare un problema anche la parte
//           che va bene, e così il rosso non indicava più nulla. Va scritta per
//           esteso — "1 mancante" non dice di cosa, se nella stessa riga si
//           contano sia chiusure sia aperture.
//   note    coda grigia dopo l'avviso, per i fatti che NON sono un problema
//           ("1 negozio chiuso"). Sta dopo l'alert e non dentro il claim
//           perché l'ordine di lettura voluto è: quanto è arrivato, cosa manca
//           davvero, e solo alla fine quello che non doveva arrivare.
//   alertGo espressione JS da eseguire al clic sull'avviso: lo rende cliccabile
//           e ci aggiunge una freccia, così dall'avviso si va a vedere cosa
//           manca invece di doverlo cercare a mano. Deve essere una stringa
//           letterale scritta qui nel codice, NON un dato: finisce dentro un
//           attributo onclick e non viene filtrata.
//   inline  true → accento sulla stessa riga del titolo, non a capo
//           (serve per "28 CHIUSURE", dove il numero è il titolo)
//
// I testi passano da _escHtml: arrivano da nomi di negozio e date, non da
// stringhe letterali, quindi meglio non fidarsi.
function azHero(o){
  if(!AZ) return '';
  const esc = s => _escHtml(String(s==null?'':s));
  const h1  = o.h1 ? esc(o.h1) : '';
  const acc = o.accent ? `<em class="${o.bad?'bad':''}">${esc(o.accent)}</em>` : '';
  const sep = (h1 && acc) ? (o.inline ? ' ' : '<br/>') : '';
  return `<div class="az-hero">
    <div class="az-hero-top">
      ${o.kicker?`<div class="az-hero-kicker">${esc(o.kicker)}</div>`:'<span></span>'}
    </div>
    <h1 class="az-h1">${h1}${sep}${acc}</h1>
    ${(o.claim||o.alert||o.note)?`<div class="az-hero-claim">${o.claim?esc(o.claim):''}${
      o.alert?`${o.claim?'<i class="az-claim-sep"></i>':''}<b class="bad${
        o.alertGo?' az-go':''}"${o.alertGo?` onclick="${o.alertGo}"`:''}>${esc(o.alert)}${
        o.alertGo?' &rarr;':''}</b>`:''
    }${
      o.note?`${(o.claim||o.alert)?'<i class="az-claim-sep"></i>':''}<span>${esc(o.note)}</span>`:''
    }</div>`:''}
  </div>`;
}

// Intestazione di blocco: titoletto maiuscolo, filo orizzontale, nota a destra.
// Le sezioni che hanno già .oggi-sec-title nel markup non ne hanno bisogno: il
// CSS del tema le trasforma da sole. Questa serve dove il titolo non c'era.
function azSec(title, meta){
  if(!AZ) return '';
  const esc = s => _escHtml(String(s==null?'':s));
  return `<div class="az-sec"><span>${esc(title)}</span><span class="az-sec-rule"></span>${
    meta?`<span class="az-sec-meta">${esc(meta)}</span>`:''}</div>`;
}
