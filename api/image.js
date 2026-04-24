// Vercel Edge Function: proxy per immagini originali GoAudits.
//
// Le "foto documentazione" sono effettivamente conservate ad alta risoluzione
// sul CDN di GoAudits; il PDF contiene solo le thumbnail + un link annotation
// all'originale. Questo proxy permette di mostrare e scaricare la foto
// originale aggirando eventuali restrizioni CORS del CDN di GoAudits e
// aggiungendo il Content-Disposition per il download corretto.
//
// Uso:
//   /api/image?url=ENCODED_URL                     → serve l'immagine inline
//   /api/image?url=ENCODED_URL&download=NAME.jpg   → forza il download con nome
//
// Sicurezza: whitelist degli host per non diventare un proxy generico per
// qualunque URL internet.

export const config = { runtime: 'edge' };

const ALLOWED_HOSTS = new Set([
  'assets.goaudits.com',
]);

export default async function handler(request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');
  const download = searchParams.get('download');

  if (!url) return json({ error: 'Missing url parameter' }, 400);

  let parsed;
  try { parsed = new URL(url); }
  catch { return json({ error: 'Invalid url' }, 400); }

  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    return json({ error: 'Host not allowed: ' + parsed.hostname, allowed: [...ALLOWED_HOSTS] }, 403);
  }

  try {
    const upstream = await fetch(url);
    if (!upstream.ok) {
      return json({ error: 'Upstream ' + upstream.status + ' ' + upstream.statusText }, upstream.status);
    }

    const headers = {
      'Content-Type': upstream.headers.get('content-type') || 'image/jpeg',
      // Cache breve lato edge + breve lato browser
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
      'Access-Control-Allow-Origin': '*',
    };

    if (download) {
      // Sanifica il filename (niente quote, niente caratteri problematici)
      const safeName = download.replace(/["\\\r\n]/g, '').slice(0, 200) || 'download.jpg';
      headers['Content-Disposition'] = `attachment; filename="${safeName}"`;
    }

    return new Response(upstream.body, { status: 200, headers });
  } catch (e) {
    return json({ error: e.message || 'Fetch failed' }, 500);
  }
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}
