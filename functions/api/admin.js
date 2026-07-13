// Cloudflare Pages Function - Admin API with password protection
const NEON_URL = 'https://ep-super-mountain-aob5ntii-pooler.c-2.ap-southeast-1.aws.neon.tech/sql';
const ADMIN_PASS = 'birthday2026';

function checkAuth(request) {
  const auth = request.headers.get('X-Admin-Pass');
  return auth === ADMIN_PASS;
}

function safeStr(s) {
  return (s || '').replace(/'/g, "''");
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

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestPost(context) {
  if (!checkAuth(context.request)) {
    return jsonResp({ error: 'Unauthorized' }, 401);
  }

  try {
    const body = await context.request.json();
    const { action, id, type, nick, comment, replyTo, count } = body;
    const env = context.env;

    // === Stats ===
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
        const r = await runSQL(q, env);
        if (r.data.rows && r.data.rows[0]) results.push(r.data.rows[0]);
      }
      return jsonResp({ rows: results });
    }

    // === List ===
    if (action === 'list') {
      const urlFilter = type ? `WHERE url = '${safeStr(type)}'` : '';
      const result = await runSQL(
        `SELECT object_id, nick, comment, url, inserted_at, ip, ua, pid, rid FROM waline_comment ${urlFilter} ORDER BY inserted_at DESC LIMIT 200`,
        env
      );
      return jsonResp(result.data, result.status);
    }

    // === Delete ===
    if (action === 'delete' && id) {
      const result = await runSQL(
        `DELETE FROM waline_comment WHERE object_id = '${safeStr(id)}'`,
        env
      );
      return jsonResp(result.data, result.status);
    }

    // === Clear ===
    if (action === 'clear') {
      const sql = type
        ? `DELETE FROM waline_comment WHERE url = '${safeStr(type)}'`
        : 'DELETE FROM waline_comment WHERE object_id IS NOT NULL';
      const result = await runSQL(sql, env);
      return jsonResp(result.data, result.status);
    }

    // === Set like count ===
    if (action === 'setLikes') {
      const target = Math.max(0, parseInt(count) || 0);
      const current = await runSQL(
        `SELECT COUNT(*)::int AS cnt FROM waline_comment WHERE url='/birthday-page-like'`,
        env
      );
      const cur = current.data.rows?.[0]?.cnt || 0;
      const diff = target - cur;
      if (diff === 0) return jsonResp({ ok: true, count: target });
      const r = await runSQL(
        diff > 0
          ? `INSERT INTO waline_comment (object_id,url,comment) SELECT 'lk_admin_'||i, '/birthday-page-like', '\u2764' FROM generate_series(1,${diff}) AS i`
          : `DELETE FROM waline_comment WHERE url='/birthday-page-like' ORDER BY inserted_at ASC LIMIT ${Math.abs(diff)}`,
        env
      );
      return jsonResp({ ok: true, count: target, deleted: r.data.rowCount });
    }

    // === Post message ===
    if (action === 'postMessage') {
      const oid = 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
      const safeNick = safeStr(nick || '管理员');
      const safeComment = safeStr(comment);
      const pid = replyTo ? `'${safeStr(replyTo)}'` : 'NULL';
      const result = await runSQL(
        `INSERT INTO waline_comment (object_id,nick,comment,url,pid) VALUES ('${oid}','${safeNick}','${safeComment}','/birthday-messages',${pid}) RETURNING object_id`,
        env
      );
      return jsonResp(result.data, result.status);
    }

    // === Post wish ===
    if (action === 'postWish') {
      const oid = 'wish_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
      const result = await runSQL(
        `INSERT INTO waline_comment (object_id,comment,url) VALUES ('${oid}','${safeStr(comment)}','/birthday-wishes') RETURNING object_id`,
        env
      );
      return jsonResp(result.data, result.status);
    }

    // === Reply to comment ===
    if (action === 'reply' && id) {
      const oid = 'reply_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
      const safeNick = safeStr(nick || '管理员');
      const result = await runSQL(
        `INSERT INTO waline_comment (object_id,nick,comment,url,pid,rid) VALUES ('${oid}','${safeNick}','${safeStr(comment)}','/birthday-messages','${safeStr(id)}','${safeStr(id)}') RETURNING object_id`,
        env
      );
      return jsonResp(result.data, result.status);
    }

    // === Like a comment ===
    if (action === 'likeComment' && id) {
      const oid = 'clike_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
      const result = await runSQL(
        `INSERT INTO waline_comment (object_id,comment,url,pid) VALUES ('${oid}','\u2764','/birthday-messages','${safeStr(id)}') RETURNING object_id`,
        env
      );
      return jsonResp(result.data, result.status);
    }

    return jsonResp({ error: 'Unknown action' }, 400);
  } catch (err) {
    return jsonResp({ error: err.message }, 502);
  }
}
