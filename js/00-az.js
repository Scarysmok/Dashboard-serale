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
//   claim   riga di contesto sotto il titolo        ("28 negozi su 30")
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
    ${o.claim?`<div class="az-hero-claim">${esc(o.claim)}</div>`:''}
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
