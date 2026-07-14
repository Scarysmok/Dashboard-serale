// 03-parser-pdf.js — Parser PDF chiusure (GoAudits) + checklist apertura + verifica cassa
// Estratto da index.html (split del 2026-07-07). Script classici:
// tutti i file js/ condividono lo scope globale; ordine di caricamento 01→08.
// ── PDF PARSER ──
async function parsePDF(ab,fname,modifiedTime,fileId){
  const loadingTask=pdfjsLib.getDocument({data:ab});
  const pdf=await loadingTask.promise;
  let txt='';
  try{
    for(let i=1;i<=pdf.numPages;i++){
      const pg=await pdf.getPage(i);
      const items=(await pg.getTextContent()).items;
      // Raggruppa per riga fisica (coordinata Y) per non confondere Q# con valori
      const lineMap={};
      for(const it of items){
        if(!it.str.trim())continue;
        const y=Math.round(it.transform[5]/2)*2;
        if(!lineMap[y])lineMap[y]=[];
        lineMap[y].push({x:it.transform[4],str:it.str});
      }
      const ys=Object.keys(lineMap).map(Number).sort((a,b)=>b-a);
      for(const y of ys){
        const line=lineMap[y].sort((a,b)=>a.x-b.x).map(i=>i.str).join(' ').trim();
        if(line) txt+=line+'\n';
      }
      // Libera subito i dati della pagina (font cache, image cache, structured tree)
      try{ pg.cleanup(); }catch(_){}
    }
  } finally {
    // CRITICO su mobile: senza destroy() PDF.js tiene aperto il worker, font
    // cache e structured tree per ogni documento → con 200+ PDF iOS Safari
    // esaurisce la memoria e ricarica la scheda (loop di reload da 0).
    try{ await pdf.cleanup(); }catch(_){}
    try{ await pdf.destroy(); }catch(_){}
    try{ await loadingTask.destroy(); }catch(_){}
  }
  // Aiuta il GC: rimuovi il riferimento all'ArrayBuffer (può essere 1-5 MB)
  ab=null;
  // Ricostruisce numeri decimali spezzati su righe diverse
  txt=txt.replace(/(\d)\n\.(\d)/g,'$1.$2');
  txt=txt.replace(/(\d)\n,(\d)/g,'$1,$2');

  const toNum=s=>{
    if(s==null||s==='')return 0;
    const str=String(s).trim();
    const hasDot=str.includes('.'),hasComma=str.includes(',');
    let norm;
    if(hasDot&&hasComma) norm=str.replace(/\./g,'').replace(',','.');
    else if(hasComma)    norm=str.replace(',','.');
    else                 norm=str;
    const n=parseFloat(norm);
    return isNaN(n)?0:n;
  };
  const gn=(p,d=0)=>{const m=txt.match(p);return m?toNum(m[1]):d;};

  // ── BRAND & LOCATION ──
  const sm=txt.match(/([A-Za-z0-9 &']+?)\s*[-–]\s*([^\|]+)\|/);
  const brand=sm?sm[1].trim():'Sconosciuto';
  const location=sm?sm[2].trim().replace(/\s+/g,' '):'—';
  const store=brand+' - '+location;

  // ── DATA INCASSO ── estratta dal PDF (non dalla data file)
  const monthMap={
    january:1,february:2,march:3,april:4,may:5,june:6,
    july:7,august:8,september:9,october:10,november:11,december:12,
    gennaio:1,febbraio:2,marzo:3,aprile:4,maggio:5,giugno:6,
    luglio:7,agosto:8,settembre:9,ottobre:10,novembre:11,dicembre:12
  };
  let dateISO=''; // YYYY-MM-DD
  let dateDisplay='—';
  // Formato: "14TH APRIL 2026" oppure "14 April 2026"
  const dm=txt.match(/(\d{1,2})(?:ST|ND|RD|TH)?\s+(January|February|March|April|May|June|July|August|September|October|November|December|Gennaio|Febbraio|Marzo|Aprile|Maggio|Giugno|Luglio|Agosto|Settembre|Ottobre|Novembre|Dicembre)\s+(\d{2,4})/i);
  if(dm){
    const day=dm[1].padStart(2,'0');
    const mo=String(monthMap[dm[2].toLowerCase()]).padStart(2,'0');
    const yr=dm[3].length===2?'20'+dm[3]:dm[3];
    dateISO=`${yr}-${mo}-${day}`;
    dateDisplay=`${day}/${mo}/${yr}`;
  }

  // ── VALORI CASSA ──
  // annull e giftcard sono importi numerici (€). sconti resta booleano (Sì/No)
  // perché non entra nella formula di verifica cassa.
  let corrispettivo,contanti,posTml1,posTml2,posTml3,posTml4,cambi,giftcard,buonoE,buonoR,annull,sconti;
  const isFormatoA=/RESPONSE/i.test(txt);

  // Helper label-based usato sia nel ramo non-RESPONSE sia come fallback per
  // RESPONSE quando la posizione fissa nel vettore vals non è affidabile.
  const NUM='\\d+(?:\\.\\d{3})*(?:,\\d+)?';
  const gfLabel=(label,def=0)=>{
    const esc=label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const re=new RegExp(esc+'(?![A-Za-z])[^\\d\\n]{0,30}\\n?\\s*(?:€|EUR)?\\s*('+NUM+')','i');
    const m=txt.match(re);
    return m?toNum(m[1]):def;
  };

  if(isFormatoA){
    const respMatch=txt.match(/RESPONSE\s*([\s\S]*?)(?:FATTURE|DISTINTA)/i);
    const vals=respMatch
      ?(respMatch[1].match(/\d+(?:\.\d{3})*(?:,\d+)?|\d+|Non utilizzato|S[iì]|No\b/gi)||[]).map(t=>t.trim())
      :[];
    const rv=i=>vals[i]||'';
    const rvn=i=>toNum(rv(i));
    // Mappa posizionale del formato RESPONSE (ordine fisso nelle chiusure):
    //  0 corrispettivo · 1 contanti · 2-5 POS TML 1-4 · 6 giftcard · 7 cambi
    //  8 annullamenti  · 9 buono emesso · 10 buono ritirato · 11 sconti
    corrispettivo=rvn(0);contanti=rvn(1);
    posTml1=/non utilizzato/i.test(rv(2))?0:rvn(2);
    posTml2=/non utilizzato/i.test(rv(3))?0:rvn(3);
    posTml3=/non utilizzato/i.test(rv(4))?0:rvn(4);
    posTml4=/non utilizzato/i.test(rv(5))?0:rvn(5);
    giftcard=/non utilizzato/i.test(rv(6))?0:rvn(6);
    cambi=/non utilizzato/i.test(rv(7))?0:rvn(7);
    annull=/non utilizzato|s[iì]|^no$/i.test(rv(8))?0:rvn(8);
    buonoE=/non utilizzato/i.test(rv(9))?0:rvn(9);
    buonoR=/non utilizzato/i.test(rv(10))?0:rvn(10);
    sconti=/non utilizzato|s[iì]|^no$/i.test(rv(11))?0:rvn(11);
    // Fallback label: se per qualunque motivo il valore posizionale è 0 ma
    // l'etichetta esiste con un importo, preferiamo il label match.
    if(!giftcard) giftcard=gfLabel('Giftcard');
    if(!annull)   annull  =gfLabel('Annullamenti');
    if(!sconti)   sconti  =gfLabel('Sconti su vendite');
  }else{
    corrispettivo=gfLabel('Corrispettivo');
    contanti=gfLabel('Contanti');
    posTml1=gfLabel('POS TML 1');posTml2=gfLabel('POS TML 2');
    posTml3=gfLabel('POS TML 3');posTml4=gfLabel('POS TML 4');
    giftcard=gfLabel('Giftcard');
    cambi=gfLabel('Cambi');buonoE=gfLabel('Buono Emesso');buonoR=gfLabel('Buono ritirato');
    annull=gfLabel('Annullamenti');
    sconti=gfLabel('Sconti su vendite');
  }

  const pos=posTml1+posTml2+posTml3+posTml4;
  const fondo=gn(/Fondo cassa[^\d\n]{0,30}\n?\s*(?:€|EUR)?\s*(\d+(?:\.\d{3})*(?:,\d+)?)/i);
  const versato=gn(/Importo [Vv]ersato[^\d\n]{0,30}\n?\s*(?:€|EUR)?\s*(\d+(?:\.\d{3})*(?:,\d+)?)/i);
  // "Importo da versare": il valore che il negozio doveva depositare quel giorno.
  // Cumulato per negozio (sum daVersare - sum versato) dà il saldo aperto residuo.
  const daVersare=gn(/Importo da versare[^\d\n]{0,30}\n?\s*(?:€|EUR)?\s*(\d+(?:\.\d{3})*(?:,\d+)?)/i);
  const netSales=corrispettivo/1.22;
  // Verifica cassa: corrispettivo deve uguagliare (contanti+POS) al netto di
  // movimenti che non rappresentano corrispettivo: cambi (rimborsi/cambi merce),
  // giftcard vendute, annullamenti, e buoni emessi (vendite differite); va
  // invece sommato quanto incassato in buoni ritirati (riscatto buoni emessi
  // in chiusure precedenti che ora generano corrispettivo monetario).
  const cash=computeCash({corrispettivo,contanti,pos,cambi,giftcard,annull,buonoE,buonoR});
  const diff=cash.diff;
  const anomaly=cash.anomaly;

  // ── ESTRAZIONE COMPLETA Q&A (28 domande della checklist GoAudits) ──
  // Le domande hanno il formato "N. Testo domanda" su una riga, seguita
  // dalla risposta su una o più righe successive. La risposta termina alla
  // prossima domanda numerata o a un boundary (Q# QUESTION, Page X of Y,
  // intestazioni di pagina, sezioni in maiuscolo).
  const qa=[];
  const isBoundary=(s)=>{
    const t=s.trim();
    if(!t) return false;
    if(/^(Q#\s*QUESTION|Page\s+\d+\s+of\s+\d+|Powered By|Auditor|Location Map|D\s*E\s*C\s*L\s*A\s*R\s*A\s*T\s*I\s*O\s*N|S\s*U\s*M\s*M\s*A\s*R\s*Y)/i.test(t)) return true;
    if(/RINO PETINO SPA|CHECKLIST CHIUSURA/i.test(t)) return true;
    // Intestazione di sezione: tutta in maiuscolo, niente cifre, almeno 4 char
    if(/^[A-Z][A-Z\s\-]{3,}$/.test(t) && !/\d/.test(t)) return true;
    return false;
  };
  let cur=null;
  for(const line of txt.split('\n')){
    const m=line.match(/^(\d{1,2})\.\s+(.+?)\s*$/);
    // Match solo se è una vera intestazione di domanda: numero 1-30 e il testo
    // dopo il punto NON contiene cifre evidenti (tipo "23/04/2026"), così non
    // confondiamo righe di data/risposta con nuove domande.
    if(m && +m[1]>=1 && +m[1]<=30 && !/\d{2}[\/\-]\d{2}/.test(m[2])){
      if(cur) qa.push(cur);
      cur={n:+m[1], q:m[2].trim(), a:''};
    }else if(cur){
      if(isBoundary(line)){
        qa.push(cur); cur=null;
      }else if(line.trim()){
        cur.a=(cur.a?cur.a+' ':'')+line.trim();
      }
    }
  }
  if(cur) qa.push(cur);

  return{fileId,store,brand,location,dateISO,dateDisplay,
    corrispettivo,netSales,contanti,pos,fondo,versato,daVersare,
    cambi,giftcard,buonoE,buonoR,sconti,annull,anomaly,diff,qa};
}

// ── CHECKLIST APERTURA (GoAudits, dal 07/2026) ──
// PDF con 4 domande: Fondo cassa (importo), Check pulizia (SI/NO), Stato
// negozio (foto), Controllo insegna/luci/apparecchiature (SI/NO). Una quinta
// domanda "Inventario a campione" esiste solo nei primissimi PDF: opzionale.
// ATTENZIONE data: l'intestazione GoAudits può riportare il giorno SBAGLIATO
// (visto un PDF compilato lunedì 06/07 con header "SUNDAY 5TH JULY"), quindi
// la data di apertura si prende dal timestamp di generazione del report
// ("Ref:NNN : 06,July 2026 09:06:36") e in fallback dal modifiedTime del file.
async function parseAperturaPDF(ab,fname,modifiedTime,fileId){
  const loadingTask=pdfjsLib.getDocument({data:ab});
  const pdf=await loadingTask.promise;
  let txt='';
  try{
    for(let i=1;i<=pdf.numPages;i++){
      const pg=await pdf.getPage(i);
      const items=(await pg.getTextContent()).items;
      const lineMap={};
      for(const it of items){
        if(!it.str.trim())continue;
        const y=Math.round(it.transform[5]/2)*2;
        if(!lineMap[y])lineMap[y]=[];
        lineMap[y].push({x:it.transform[4],str:it.str});
      }
      const ys=Object.keys(lineMap).map(Number).sort((a,b)=>b-a);
      for(const y of ys){
        const line=lineMap[y].sort((a,b)=>a.x-b.x).map(i=>i.str).join(' ').trim();
        if(line) txt+=line+'\n';
      }
      try{ pg.cleanup(); }catch(_){}
    }
  } finally {
    try{ await pdf.cleanup(); }catch(_){}
    try{ await pdf.destroy(); }catch(_){}
    try{ await loadingTask.destroy(); }catch(_){}
  }
  ab=null;
  txt=txt.replace(/(\d)\n\.(\d)/g,'$1.$2').replace(/(\d)\n,(\d)/g,'$1,$2');

  // Brand/location: stesso header delle chiusure ("Carpisa - Casamassima | Via …")
  const sm=txt.match(/([A-Za-z0-9 &']+?)\s*[-–]\s*([^\|]+)\|/);
  const brand=sm?sm[1].trim():'Sconosciuto';
  const location=sm?sm[2].trim().replace(/\s+/g,' '):'—';

  // Data apertura: timestamp del report, NON l'header (inaffidabile, vedi sopra)
  const monthMapEn={january:1,february:2,march:3,april:4,may:5,june:6,
    july:7,august:8,september:9,october:10,november:11,december:12};
  let dateISO='';
  const rm=txt.match(/Ref:\s*\d+\s*:\s*(\d{1,2})\s*,\s*([A-Za-z]+)\s+(\d{4})/i);
  if(rm && monthMapEn[rm[2].toLowerCase()]){
    dateISO=`${rm[3]}-${String(monthMapEn[rm[2].toLowerCase()]).padStart(2,'0')}-${rm[1].padStart(2,'0')}`;
  }
  if(!dateISO && modifiedTime) dateISO=String(modifiedTime).slice(0,10);

  // Risposte: cerco la riga della domanda per parola chiave e il valore nelle
  // righe subito successive. Tollerante all'ordine "1. Domanda" / "Domanda 1."
  // e alla presenza di timestamp foto tra domanda e risposta.
  const lines=txt.split('\n');
  const answerNear=(kwRe,valRe,maxLook=6)=>{
    for(let i=0;i<lines.length;i++){
      if(!kwRe.test(lines[i])) continue;
      for(let j=i+1;j<=Math.min(i+maxLook,lines.length-1);j++){
        const m=lines[j].match(valRe);
        if(m) return m[1]!==undefined?m[1]:m[0];
      }
      return null;
    }
    return null;
  };
  // NOTA dopo la risposta SI/NO: i negozi scrivono il motivo su una riga a sé
  // (es. "NO" → "Condizionatore non funzionante"). Quando alla risposta sono
  // allegate foto, GoAudits mette la nota DOPO le foto — anche nella pagina
  // successiva (visto l'08/07/2026: NO a fine pagina 1, nota a pagina 2 dopo
  // 3 foto). Quindi: scorro avanti SALTANDO il rumore del template (timestamp
  // foto, piè/testata di pagina) e mi fermo solo ai confini veri di sezione
  // (altra domanda, DECLARATION, Auditor). La prima sequenza di righe di testo
  // libero è la nota; una volta iniziata, qualunque rumore la chiude.
  const NOTE_SKIP=/^(Page\s+\d+\s+of|Powered By|Ref\s*:|CHECKLIST APERTURA|RINO PETINO)/i;
  const NOTE_STOP=/^(Q#\s*QUESTION|Location Map|Auditor|D\s*E\s*C\s*L)/i;
  // Timestamp foto, anche RIPETUTI sulla stessa riga ("08 Jul 26 09:32 AM 08 Jul 26 09:32 AM")
  const NOTE_TS=/^(\d{1,2}\s+[A-Za-z]{3}\s+\d{2}\s+\d{1,2}:\d{2}(\s*(AM|PM))?\s*)+$/i;
  const NOTE_Q=/(fondo\s+cassa|check\s+pulizia|stato\s+negozio|controllo\s+insegna|inventario)/i;
  const NOTE_HDR=/^[A-Z0-9 &'.\-]+\d{2}\s+[A-Z]{3}\s+\d{2}$/;  // "CARPISA - CASAMASSIMA 05 JUL 26"
  const SINO_LINE=/^\s*(SI|SÌ|NO)\s*$/i;
  const noteAfter=(kwRe,maxLook=8)=>{
    for(let i=0;i<lines.length;i++){
      if(!kwRe.test(lines[i])) continue;
      // trovo prima la riga SI/NO della domanda, poi raccolgo le note
      let j=i+1;
      while(j<lines.length && j<=i+maxLook && !SINO_LINE.test(lines[j])) j++;
      if(j>=lines.length || !SINO_LINE.test(lines[j])) return null;
      const notes=[];
      for(let k=j+1;k<lines.length && k<=j+25;k++){
        const l=lines[k].trim();
        if(!l) continue;
        if(NOTE_STOP.test(l)||NOTE_Q.test(l)||SINO_LINE.test(l)) break;
        if(NOTE_SKIP.test(l)||NOTE_TS.test(l)||NOTE_HDR.test(l)){
          if(notes.length) break; // nota già iniziata: il rumore la chiude
          continue;               // nota non ancora trovata: salto il rumore
        }
        notes.push(l);
      }
      return notes.length?notes.join(' ').slice(0,300):null;
    }
    return null;
  };
  // Riga solo-numero, con € opzionale PRIMA o DOPO: i negozi scrivono il fondo
  // in formati liberi ("304,61", "294,20€", "€ 300", "1.234,56").
  const NUMLINE=/^\s*€?\s*(\d[\d.,]*?)\s*€?\s*$/;
  const SINO=/^\s*(SI|SÌ|NO)\s*$/i;
  // Interpreta sia il formato italiano (virgola decimale, punti migliaia) sia
  // quello inglese (punto decimale). Stessa logica di parseExcelNumberCell.
  const toNumIt=s=>{
    if(s==null)return null;
    let str=String(s).trim();
    if(str.includes(',')) str=str.replace(/\./g,'').replace(',','.');
    else if(/^\d{1,3}(\.\d{3})+$/.test(str)) str=str.replace(/\./g,'');
    const n=parseFloat(str);
    return isFinite(n)?n:null;
  };
  const siNo=s=>s==null?null:!/^no$/i.test(String(s).trim());
  const fondoCassa  = toNumIt(answerNear(/fondo\s+cassa/i, NUMLINE));
  const puliziaOk   = siNo(answerNear(/check\s+pulizia/i, SINO));
  const insegnaOk   = siNo(answerNear(/controllo\s+insegna/i, SINO, 8));
  const inventarioOk= siNo(answerNear(/inventario.*campione/i, SINO)); // opzionale, sparirà
  const puliziaNote = noteAfter(/check\s+pulizia/i);
  const insegnaNote = noteAfter(/controllo\s+insegna/i);

  // pv = versione del parser: syncAperture rilegge i PDF in cache con pv più
  // vecchio, così le nuove estrazioni (es. note) arrivano senza svuotare tutto.
  // pv3 (08/07/2026): note cercate anche oltre il cambio pagina / foto allegate.
  return {type:'apertura',pv:3,fileId,fname,modifiedTime,brand,location,dateISO,
          fondoCassa,puliziaOk,insegnaOk,inventarioOk,puliziaNote,insegnaNote};
}

// Lista PDF aperture dal backend. [] se la cartella non è configurata (503/404)
// o in caso d'errore: la sezione Aperture semplicemente non compare.
async function fetchApertureList(){
  try{
    const r=await api('/drive/list-aperture');
    if(!r.ok) return [];
    const d=await r.json();
    return Array.isArray(d)?d:[];
  }catch(e){return [];}
}

// All'avvio la sezione Aperture spariva per minuti: allAperture vive solo in
// memoria e si riempie solo a fine syncAperture, che parte dietro cold start
// Render + import consuntivi + fetch paralleli. Qui la ripopolo SUBITO con i
// record apertura già salvati nella cache locale dall'ultima sessione: la home
// mostra lo stato precedente finché il sync vero non consegna i dati freschi.
// Accetto anche record con pv vecchio: meglio un dato leggermente stale del
// vuoto (syncAperture li rimpiazza comunque). Dedup per fileId tenendo il
// modifiedTime più recente (lo stesso file può stare in cache con due chiavi).
function preloadApertureFromCache(){
  if(allAperture.length) return;
  try{
    const byId={};
    for(const rec of Object.values(loadCache())){
      if(!rec || rec.type!=='apertura') continue;
      const k=rec.fileId||rec.fname;
      if(!byId[k] || String(rec.modifiedTime||'')>String(byId[k].modifiedTime||'')) byId[k]=rec;
    }
    const recs=Object.values(byId);
    if(recs.length) allAperture=recs;
  }catch(e){ console.warn('preloadApertureFromCache', e); }
}

// Sync aperture: NON bloccante rispetto alla pipeline chiusure (chiamata senza
// await da syncNow). Riusa la stessa cache dei PDF (chiave fileId_modifiedTime,
// locale + backend condivisa): ogni PDF si scarica e parsa una volta sola.
async function syncAperture(backendCache){
  try{
    const files=await fetchApertureList();
    if(!files.length){ allAperture=[]; return; }
    const localCache=loadCache();
    const out=[];
    let dirty=false;
    for(const f of files){
      const key=f.id+'_'+f.modifiedTime;
      let rec=(backendCache&&backendCache[key])||localCache[key];
      // Cache valida solo se il parser non è cambiato: pv vecchio → rileggo il
      // PDF (una volta sola, poi la cache si aggiorna con la nuova versione).
      if(rec && rec.type==='apertura' && rec.pv!==3) rec=null;
      if(!rec){
        try{
          const r=await api(`/drive/file/${encodeURIComponent(f.id)}`);
          if(!r.ok) continue;
          rec=await parseAperturaPDF(await r.arrayBuffer(), f.name, f.modifiedTime, f.id);
          localCache[key]=rec; dirty=true;
          pushPdfCache(key, rec); // best-effort, condivisa con gli altri utenti
        }catch(e){ console.warn('parseAperturaPDF', f.name, e); continue; }
      }
      if(rec && rec.type==='apertura') out.push(rec);
    }
    if(dirty) saveCache(localCache);
    allAperture=out;
  }catch(e){ console.warn('syncAperture', e); }
}

// ── STORE CHECK (checklist area manager, stesso impianto GoAudits) ──
// Estrae il testo del PDF come righe (stessa tecnica del parser aperture).
async function _pdfToText(ab){
  const loadingTask=pdfjsLib.getDocument({data:ab});
  const pdf=await loadingTask.promise;
  let txt='';
  try{
    for(let i=1;i<=pdf.numPages;i++){
      const pg=await pdf.getPage(i);
      const items=(await pg.getTextContent()).items;
      const lineMap={};
      for(const it of items){
        if(!it.str.trim())continue;
        const y=Math.round(it.transform[5]/2)*2;
        (lineMap[y]=lineMap[y]||[]).push({x:it.transform[4],str:it.str});
      }
      for(const y of Object.keys(lineMap).map(Number).sort((a,b)=>b-a)){
        const line=lineMap[y].sort((a,b)=>a.x-b.x).map(i=>i.str).join(' ').trim();
        if(line) txt+=line+'\n';
      }
      try{ pg.cleanup(); }catch(_){}
    }
  } finally {
    try{ await pdf.cleanup(); }catch(_){}
    try{ await pdf.destroy(); }catch(_){}
    try{ await loadingTask.destroy(); }catch(_){}
  }
  return txt;
}
async function parseStoreCheckPDF(ab,fname,modifiedTime,fileId){
  const txt=await _pdfToText(ab);
  ab=null;
  const lines=txt.split('\n');

  const sm=txt.match(/([A-Za-z0-9 &']+?)\s*[-–]\s*([^\|]+)\|/);
  const brand=sm?sm[1].trim():'Sconosciuto';
  const location=sm?sm[2].trim().replace(/\s+/g,' '):'—';

  const monthMapEn={january:1,february:2,march:3,april:4,may:5,june:6,
    july:7,august:8,september:9,october:10,november:11,december:12};
  let dateISO='';
  const rm=txt.match(/Ref:\s*\d+\s*:\s*(\d{1,2})\s*,\s*([A-Za-z]+)\s+(\d{4})/i);
  if(rm && monthMapEn[rm[2].toLowerCase()])
    dateISO=`${rm[3]}-${String(monthMapEn[rm[2].toLowerCase()]).padStart(2,'0')}-${rm[1].padStart(2,'0')}`;
  if(!dateISO && modifiedTime) dateISO=String(modifiedTime).slice(0,10);

  // Punteggio complessivo: preferisco "(24.0/24.0) 100.00 %", fallback primo "N %".
  let score='';
  const scm=txt.match(/\(\s*[\d.,]+\s*\/\s*[\d.,]+\s*\)\s*([\d.,]+)\s*%/);
  if(scm) score=scm[1].replace(',','.').replace(/\.0+$/,'')+'%';
  else { const p=txt.match(/(\d{1,3}(?:[.,]\d+)?)\s*%/); if(p) score=p[1]+'%'; }

  // Area manager: nel blocco DECLARATION. Prendo il nome fra parentesi (account
  // GoAudits) se c'è, altrimenti la prima riga-nome dopo DECLARATION.
  let areaManager='';
  const di=lines.findIndex(l=>/^D\s*E\s*C\s*L|^DECLARATION/i.test(l.trim()));
  if(di>=0){
    for(let j=di+1;j<lines.length && j<=di+6;j++){
      const l=lines[j].trim();
      if(!l || /^(Page\s+\d+\s+of|Ref\s*:|Powered By|Map data|Google)/i.test(l)) continue;
      const par=l.match(/^\(([^)]+)\)$/);
      if(par){ areaManager=par[1].trim(); break; }
      if(!areaManager) areaManager=l;  // firma: tengo come fallback, continuo a cercare l'account
    }
  }

  // Domande: la risposta CORRENTE è il token MAIUSCOLO (YES/NO/N/A) subito dopo
  // il punteggio "(x/y)". Le colonne 23.Jun/01.Jul (title-case) sono lo storico
  // e vanno ignorate. issues = risposte NO (non conformità).
  const RESP=/\(\s*[\d.]+\s*\/\s*[\d.]+\s*\)\s*(YES|NO|N\/A)\b/;
  const NOISE=/^(Page\s+\d+\s+of|Ref\s*:|Powered By|RINO PETINO|STORE CHECK|Q#|UNTITLED|Verificare ciascun|\d{1,2}\s+[A-Za-z]{3}\s+\d{2}\s+\d{1,2}:\d{2})/i;
  const issues=[]; let qCount=0;
  for(let i=0;i<lines.length;i++){
    const m=lines[i].match(RESP);
    if(!m) continue;
    qCount++;
    if(m[1].toUpperCase()!=='NO') continue;
    // testo domanda: sulla stessa riga fra "N." e "(x/y)", o riga precedente utile
    let q='', nn='';
    const same=lines[i].match(/^(\d{1,2})\.\s*(.*?)\s*\(\s*[\d.]+\s*\//);
    if(same){ nn=same[1]; q=same[2].trim(); }
    if(!q){
      for(let k=i-1;k>=0 && k>=i-3;k--){
        const l=lines[k].trim();
        if(!l||NOISE.test(l)) continue;
        q=l.replace(/^\d{1,2}\.\s*/,''); break;
      }
    }
    issues.push({n:nn, q:q||'(domanda)'});
  }

  return {type:'storecheck',pv:1,fileId,fname,modifiedTime,brand,location,dateISO,
          score,areaManager,issues,noCount:issues.length,qCount};
}
async function fetchStoreCheckList(){
  try{
    const r=await api('/drive/list-storecheck');
    if(!r.ok) return [];
    const d=await r.json();
    return Array.isArray(d)?d:[];
  }catch(e){return [];}
}
// Sync store check: gemello di syncAperture (stessa cache PDF condivisa).
async function syncStoreCheck(backendCache){
  try{
    const files=await fetchStoreCheckList();
    if(!files.length){ allStoreChecks=[]; return; }
    const localCache=loadCache();
    const out=[]; let dirty=false;
    for(const f of files){
      const key=f.id+'_'+f.modifiedTime;
      let rec=(backendCache&&backendCache[key])||localCache[key];
      if(rec && rec.type==='storecheck' && rec.pv!==1) rec=null;
      if(!rec){
        try{
          const r=await api(`/drive/file/${encodeURIComponent(f.id)}`);
          if(!r.ok) continue;
          rec=await parseStoreCheckPDF(await r.arrayBuffer(), f.name, f.modifiedTime, f.id);
          localCache[key]=rec; dirty=true;
          pushPdfCache(key, rec);
        }catch(e){ console.warn('parseStoreCheckPDF', f.name, e); continue; }
      }
      if(rec && rec.type==='storecheck') out.push(rec);
    }
    if(dirty) saveCache(localCache);
    allStoreChecks=out;
  }catch(e){ console.warn('syncStoreCheck', e); }
}

// ── VERIFICA CASSA ──
// Formula standard:
//   corrispettivo == (contanti + POS) - cambi - giftcard - annull
//                     - buoniEmessi + buoniRitirati
// Formula Mango (eccezione richiesta dal cliente):
//   corrispettivo == (contanti + POS) - buoniEmessi + buoniRitirati
//   (cambi, giftcard e annullamenti NON vanno sottratti perché in Mango quei
//    movimenti sono già conteggiati nel corrispettivo lordo del registratore)
// Restituisce {expected, diff, anomaly}. diff segnato: + = eccedenza, - = ammanco.
// anomaly = scarto > 1€ (tolleranza arrotondamenti).
// È function-declaration (non const) per essere hoistata: viene chiamata
// dentro parse() che esegue prima della sua riga di dichiarazione.
function isMangoBrand(brand){
  // Match case-insensitive con piccola tolleranza per varianti tipo "MANGO" o
  // "mango ". Usato anche fuori da computeCash (es. per badge informativi).
  return /^\s*mango\b/i.test(String(brand||''));
}
function computeCash(r){
  const contanti=+r.contanti||0, pos=+r.pos||0;
  const cambi=+r.cambi||0, giftcard=+r.giftcard||0, annull=+r.annull||0;
  const bE=+r.buonoE||0, bR=+r.buonoR||0;
  const corrispettivo=+r.corrispettivo||0;
  const mango=isMangoBrand(r.brand);
  const expected = mango
    ? (contanti + pos - bE + bR)
    : (contanti + pos - cambi - giftcard - annull - bE + bR);
  const diff = corrispettivo - expected;
  const anomaly = Math.abs(diff) > 1 && corrispettivo > 0;
  return {expected, diff, anomaly, formula: mango ? 'mango' : 'std'};
}

