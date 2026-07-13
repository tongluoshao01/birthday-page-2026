// Cloudflare Pages Function - proxy SQL queries to Neon
const NEON_URL = 'https://ep-super-mountain-aob5ntii-pooler.c-2.ap-southeast-1.aws.neon.tech/sql';

export async function onRequestPost(context) {
  try {
    const NEON_CONN = context.env.NEON_CONN;
    if (!NEON_CONN) {
      return new Response(JSON.stringify({ error: 'NEON_CONN not configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

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
