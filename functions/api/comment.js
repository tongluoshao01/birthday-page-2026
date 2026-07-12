// Cloudflare Pages Function - proxy SQL queries to Neon
const NEON_URL = 'https://ep-super-mountain-aob5ntii-pooler.c-2.ap-southeast-1.aws.neon.tech/sql';
const NEON_CONN = 'postgresql://neondb_owner:npg_O1l9ifqKFcbz@ep-super-mountain-aob5ntii-pooler.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require';

export async function onRequestPost(context) {
  try {
    const { query } = await context.request.json();
    if (!query || typeof query !== 'string') {
      return new Response(JSON.stringify({ error: 'Missing query' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const resp = await fetch(NEON_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'neon-connection-string': NEON_CONN,
      },
      body: JSON.stringify({ query }),
    });

    const data = await resp.text();
    return new Response(data, {
      status: resp.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
