// Waline-compatible Comment API
// Uses Neon HTTP SQL API (no npm dependencies needed)

const CONN_STRING = process.env.NEON_CONN_STRING || '';
const NEON_SQL_URL = 'https://ep-super-mountain-aob5ntii-pooler.c-2.ap-southeast-1.aws.neon.tech/sql';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function sqlHeaders() {
  return {
    'neon-connection-string': CONN_STRING,
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };
}

async function sql(query) {
  const r = await fetch(NEON_SQL_URL, {
    method: 'POST',
    headers: sqlHeaders(),
    body: JSON.stringify({ query })
  });
  if (!r.ok) throw new Error(`SQL error: ${r.status}`);
  return r.json();
}

function ok(data) {
  return new Response(JSON.stringify({ errno: 0, errmsg: '', data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders }
  });
}

// GET: list comments or pageview count
async function handleGet(urlStr) {
  const u = new URL(urlStr);
  const type = u.searchParams.get('type') || 'comment';
  const path = u.searchParams.get('path') || '/';
  const pageSize = Math.min(parseInt(u.searchParams.get('pageSize') || '100'), 200);
  const sortBy = u.searchParams.get('sortBy') || 'inserted_at';
  const order = (u.searchParams.get('order') || 'desc').toUpperCase();

  if (type === 'pageview') {
    try {
      // 从 waline_comment 统计该路径的记录数（兼容前端点赞 POST 写入 comment 表的机制）
      const r = await sql(`SELECT COUNT(*)::int AS cnt FROM waline_comment WHERE url = '${path.replace(/'/g, "''")}'`);
      const count = r.rows.length > 0 ? r.rows[0].cnt : 0;
      return ok(count);
    } catch (e) {
      return ok(0);
    }
  }

  // List comments
  const safeOrder = (['ASC', 'DESC'].includes(order)) ? order : 'DESC';
  const safeSort = /^[a-z_]+$/.test(sortBy) ? sortBy : 'inserted_at';
  try {
    const r = await sql(`SELECT object_id, nick, mail, link, comment, url, inserted_at, ip, ua, created_at, updated_at, status, rid, is_spam, parent_id FROM waline_comment WHERE url = '${path.replace(/'/g, "''")}' ORDER BY ${safeSort} ${safeOrder} NULLS LAST LIMIT ${pageSize} OFFSET ${(parseInt(u.searchParams.get('page') || '1') - 1) * pageSize}`);
    // Map column names to camelCase for Waline compatibility
    const data = r.rows.map(row => ({
      objectId: row.object_id,
      nick: row.nick || '',
      mail: row.mail || '',
      link: row.link || '',
      comment: row.comment || '',
      url: row.url || '/',
      insertedAt: row.inserted_at,
      ip: row.ip || '',
      ua: row.ua || '',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      status: row.status || 0,
      rid: row.rid || 0,
      isSpam: row.is_spam || false,
      parentId: row.parent_id || ''
    }));
    return ok(data);
  } catch (e) {
    return ok([]);
  }
}

// POST: create comment
async function handlePost(body) {
  const ptype = (body.type || '').replace(/'/g, "''");
  const nick = (body.nick || body.author || '').replace(/'/g, "''");
  const comment = (body.comment || body.text || '').replace(/'/g, "''");
  const url = (body.url || body.path || '/').replace(/'/g, "''");
  const mail = (body.mail || '').replace(/'/g, "''");
  const link = (body.link || '').replace(/'/g, "''");
  const ip = (body.ip || '').replace(/'/g, "''");
  const ua = (body.ua || '').replace(/'/g, "''");
  const objectId = body.objectId || ('c_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6));

  // Pageview: UPSERT count in waline_pageview table
  if (ptype === 'pageview') {
    try {
      await sql(`INSERT INTO waline_pageview (path, count, updated_at) VALUES ('${url}', 1, NOW()) ON CONFLICT (path) DO UPDATE SET count = waline_pageview.count + 1, updated_at = NOW()`);
    } catch (e) {}
    return ok({ path: url });
  }

  try {
    const r = await sql(`INSERT INTO waline_comment (object_id, nick, mail, link, comment, url, ip, ua) VALUES ('${objectId}', '${nick}', '${mail}', '${link}', '${comment}', '${url}', '${ip}', '${ua}') RETURNING object_id, nick, comment, url, inserted_at`);
    if (r.rows.length > 0) {
      return ok({
        objectId: r.rows[0].object_id,
        nick: r.rows[0].nick,
        comment: r.rows[0].comment,
        url: r.rows[0].url,
        insertedAt: r.rows[0].inserted_at
      });
    }
    return ok({ id: objectId });
  } catch (e) {
    return ok({ id: objectId });
  }
}

// DELETE: delete comment
async function handleDelete(id) {
  const safeId = id.replace(/'/g, "''");
  try {
    await sql(`DELETE FROM waline_comment WHERE object_id = '${safeId}'`);
  } catch (e) {}
  return new Response(JSON.stringify({ errno: 0, errmsg: '' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders }
  });
}

// PUT: update comment
async function handlePut(id, body) {
  const safeId = id.replace(/'/g, "''");
  const comment = (body.comment || body.text || '').replace(/'/g, "''");
  try {
    await sql(`UPDATE waline_comment SET comment = '${comment}', updated_at = NOW() WHERE object_id = '${safeId}'`);
  } catch (e) {}
  return new Response(JSON.stringify({ errno: 0, errmsg: '' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders }
  });
}

// Main handler
export default async function handler(request) {
  const url = new URL(request.url);
  const method = request.method;

  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    if (method === 'GET') return await handleGet(url.href);

    const parts = url.pathname.split('/').filter(Boolean);
    const id = parts.length >= 3 ? parts[2] : '';

    if (method === 'POST') {
      let body = {};
      const ct = request.headers.get('content-type') || '';
      if (ct.includes('form-urlencoded')) {
        const text = await request.text();
        body = Object.fromEntries(new URLSearchParams(text));
      } else if (ct.includes('json')) {
        body = await request.json();
      } else {
        const text = await request.text();
        body = Object.fromEntries(new URLSearchParams(text));
      }
      return await handlePost(body);
    }

    if (method === 'DELETE' && id) return await handleDelete(id);
    if (method === 'PUT' && id) {
      let body = {};
      try { body = await request.json(); } catch (e) {}
      return await handlePut(id, body);
    }

    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ errno: 1, errmsg: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }
}
