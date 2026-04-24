// Vercel Edge Function: proxy per download PDF da Google Drive.
//
// Motivazione: l'endpoint API `files/:id?alt=media&key=...` restituisce 403
// per API key anonime, anche quando il file è condiviso "Chiunque con il link".
// L'endpoint pubblico `drive.google.com/uc?export=download&id=...` invece
// funziona per file pubblici, ma non è utilizzabile direttamente dal browser
// per restrizioni CORS. Questa funzione gira su Edge di Vercel (server-side),
// quindi CORS non si applica, e rigira il PDF al client con gli header corretti.
//
// Uso lato client:  fetch('/api/drive?id=FILE_ID')
//
// Limiti:
// - File fino a ~25 MB. Oltre, Google mostra una pagina di conferma scan antivirus.
// - Cache condivisa 5 minuti (il modifiedTime è già gestito nel client).

export const config = { runtime: 'edge' };

export default async function handler(request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) {
    return json({ error: 'Missing or invalid file id' }, 400);
  }

  const driveUrl = `https://drive.google.com/uc?id=${encodeURIComponent(id)}&export=download`;

  try {
    const upstream = await fetch(driveUrl, { redirect: 'follow' });

    if (!upstream.ok) {
      return json({
        error: 'Drive returned ' + upstream.status,
        hint: 'Il file potrebbe non essere condiviso come "Chiunque con il link"'
      }, upstream.status);
    }

    const contentType = upstream.headers.get('content-type') || '';

    // Se Google restituisce HTML è la pagina di conferma per file grandi (>25MB)
    // oppure una pagina di errore. In entrambi i casi non è il PDF che vogliamo.
    if (contentType.includes('text/html')) {
      return json({
        error: 'Drive returned HTML instead of PDF',
        hint: 'File troppo grande (>25MB) o permessi insufficienti'
      }, 502);
    }

    // Streamma il PDF al client con cache breve
    return new Response(upstream.body, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Cache-Control': 'public, max-age=300, s-maxage=300',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (e) {
    return json({ error: e.message || 'Fetch failed' }, 500);
  }
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}
