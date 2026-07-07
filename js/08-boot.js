// 08-boot.js — Boot: listener globale filtri Andamento + auto-login all'avvio (era inline dopo la sezione INIT)
// Estratto da index.html (split del 2026-07-07). Script classici:
// tutti i file js/ condividono lo scope globale; ordine di caricamento 01→08.
// Listener globale: chiude i pannelli filtri Andamento se si clicca fuori.
// Registrato qui (non dentro l'IIFE) così è attivo dal primo paint, non
// dipende dal completamento del login.
document.addEventListener('click', _onAmDocClick);

(async function(){
  // Fire-and-forget warm-up. Non await, non blocca, errori loggati e basta.
  fetch(API_BASE+'/', {credentials:'include'}).catch(e=>console.debug('warmup',e));

  auth.accessToken=localStorage.getItem('access_token');
  auth.refreshToken=localStorage.getItem('refresh_token');
  if(auth.accessToken){
    load(true,'Verifico sessione…',true);
    try{
      const r=await api('/auth/me');
      if(r.ok){
        auth.user=await r.json();
        load(false);
        showDash();
        return;
      }
    }catch(e){console.warn('Auth check failed',e);}
    load(false);
  }
  showLogin();
})();
