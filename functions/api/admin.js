// Cloudflare Pages Function - Admin API with password protection
const NEON_URL = 'https://ep-super-mountain-aob5ntii-pooler.c-2.ap-southeast-1.aws.neon.tech/sql';
const ADMIN_PASS = 'birthday2026';

function checkAuth(request) {
  const auth = request.headers.get('X-Admin-Pass');
  return auth === ADMIN_PASS;
}

async function runSQL(query, env) {
  const NEON_CONN = env.NEON_CONN;
  if (!NEON_CONN) return { status: 500, data: { error: 'NEON_CONN not configured' } };
  const resp = await fetch(NEON_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'neon-connection-string': NEON_CONN,
    },
    body: JSON.stringify({ query }),
  });
  const data = await resp.json();
  return { status: resp.status, data };
}

export async function onRequestPost(context) {
  if (!checkAuth(context.request)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const { action, id, type } = await context.request.json();

    if (action === 'delete' && id) {
      const safeId = id.replace(/'/g, "''");
      const result = await runSQL(`DELETE FROM waline_comment WHERE object_id = '${safeId}'`, context.env);
      return new Response(JSON.stringify(result.data), {
        status: result.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (action === 'list') {
      const urlFilter = type ? `WHERE url = '${type.replace(/'/g, "''")}'` : '';
      const result = await runSQL(
        `SELECT object_id, nick, comment, url, inserted_at, ip, ua FROM waline_comment ${urlFilter} ORDER BY inserted_at DESC LIMIT 200`,
        context.env
      );
      return new Response(JSON.stringify(result.data), {
        status: result.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (action === 'stats') {
      const queries = [
        "SELECT 'messages' AS type, COUNT(*)::int AS cnt FROM waline_comment WHERE url='/birthday-messages'",
        "SELECT 'wishes' AS type, COUNT(*)::int AS cnt FROM waline_comment WHERE url='/birthday-wishes'",
        "SELECT 'likes' AS type, COUNT(*)::int AS cnt FROM waline_comment WHERE url='/birthday-page-like'",
        "SELECT 'pageviews' AS type, COUNT(*)::int AS cnt FROM waline_comment WHERE url='/birthday-pageview'",
        "SELECT 'total' AS type, COUNT(*)::int AS cnt FROM waline_comment",
      ];
      const results = [];
      for (const q of queries) {
        const r = await runSQL(q, context.env);
        if (r.data.rows && r.data.rows[0]) results.push(r.data.rows[0]);
      }
      return new Response(JSON.stringify({ rows: results }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (action === 'clear') {
      const sql = type ? `DELETE FROM waline_comment WHERE url = '${type.replace(/'/g, "''")}'` : 'DELETE FROM waline_comment WHERE object_id IS NOT NULL';
      const result = await runSQL(sql, context.env);
      return new Response(JSON.stringify(result.data), {
        status: result.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
