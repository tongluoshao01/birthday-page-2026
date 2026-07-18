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
    const { action, id, type, nick, comment, replyTo, count, keyword, ids } = body;
    const env = context.env;

    // === Stats ===
    if (action === 'stats') {
      const queries = [
        "SELECT 'messages' AS type, COUNT(*) FILTER (WHERE status=1)::int AS cnt FROM waline_comment WHERE url='/birthday-messages'",
        "SELECT 'wishes' AS type, COUNT(*) FILTER (WHERE status=1)::int AS cnt FROM waline_comment WHERE url='/birthday-wishes'",
        "SELECT 'likes' AS type, COUNT(*)::int AS cnt FROM waline_comment WHERE url='/birthday-page-like'",
        "SELECT 'pageviews' AS type, COUNT(*)::int AS cnt FROM waline_comment WHERE url='/birthday-pageview'",
        "SELECT 'total' AS type, COUNT(*)::int AS cnt FROM waline_comment",
        "SELECT 'hidden' AS type, COUNT(*)::int AS cnt FROM waline_comment WHERE status=0",
        "SELECT 'pinned' AS type, COUNT(*)::int AS cnt FROM waline_comment WHERE pinned=true",
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
      const where = [];
      if (type) where.push(`url = '${safeStr(type)}'`);
      if (keyword) where.push(`(nick ILIKE '%${safeStr(keyword)}%' OR comment ILIKE '%${safeStr(keyword)}%')`);
      const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';
      const result = await runSQL(
        `SELECT object_id, nick, comment, url, inserted_at, ip, ua, parent_id, rid, status, pinned FROM waline_comment ${whereClause} ORDER BY pinned DESC, inserted_at DESC LIMIT 500`,
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

    // === Batch Delete ===
    if (action === 'batchDelete' && ids && ids.length) {
      const idList = ids.map(i => `'${safeStr(i)}'`).join(',');
      const result = await runSQL(
        `DELETE FROM waline_comment WHERE object_id IN (${idList})`,
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

    // === Edit ===
    if (action === 'edit' && id) {
      const sets = [];
      if (nick !== undefined) sets.push(`nick = '${safeStr(nick)}'`);
      if (comment !== undefined) sets.push(`comment = '${safeStr(comment)}'`);
      if (sets.length === 0) return jsonResp({ error: 'Nothing to update' }, 400);
      const result = await runSQL(
        `UPDATE waline_comment SET ${sets.join(', ')} WHERE object_id = '${safeStr(id)}' RETURNING object_id`,
        env
      );
      return jsonResp(result.data, result.status);
    }

    // === Toggle Pin ===
    if (action === 'togglePin' && id) {
      const result = await runSQL(
        `UPDATE waline_comment SET pinned = NOT pinned WHERE object_id = '${safeStr(id)}' RETURNING object_id, pinned`,
        env
      );
      return jsonResp(result.data, result.status);
    }

    // === Toggle Hide ===
    if (action === 'toggleHide' && id) {
      const result = await runSQL(
        `UPDATE waline_comment SET status = CASE WHEN status=1 THEN 0 ELSE 1 END WHERE object_id = '${safeStr(id)}' RETURNING object_id, status`,
        env
      );
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
      if (diff > 0) {
        await runSQL(
          `INSERT INTO waline_comment (object_id,url,comment) SELECT 'lk_admin_'||i, '/birthday-page-like', '\u2764' FROM generate_series(1,${diff}) AS i`,
          env
        );
      } else {
        await runSQL(
          `DELETE FROM waline_comment WHERE object_id IN (SELECT object_id FROM waline_comment WHERE url='/birthday-page-like' ORDER BY inserted_at ASC LIMIT ${Math.abs(diff)})`,
          env
        );
      }
      return jsonResp({ ok: true, count: target });
    }

    // === Post message ===
    if (action === 'postMessage') {
      const oid = 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
      const safeNick = safeStr(nick || '\u7ba1\u7406\u5458');
      const parent_id = replyTo ? `'${safeStr(replyTo)}'` : 'NULL';
      const result = await runSQL(
        `INSERT INTO waline_comment (object_id,nick,comment,url,parent_id,status) VALUES ('${oid}','${safeNick}','${safeStr(comment)}','/birthday-messages',${parent_id},1) RETURNING object_id`,
        env
      );
      return jsonResp(result.data, result.status);
    }

    // === Post wish ===
    if (action === 'postWish') {
      const oid = 'wish_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
      const result = await runSQL(
        `INSERT INTO waline_comment (object_id,comment,url,status) VALUES ('${oid}','${safeStr(comment)}','/birthday-wishes',1) RETURNING object_id`,
        env
      );
      return jsonResp(result.data, result.status);
    }

    // === Reply to comment ===
    if (action === 'reply' && id) {
      const oid = 'reply_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
      const safeNick = safeStr(nick || '\u7ba1\u7406\u5458');
      const result = await runSQL(
        `INSERT INTO waline_comment (object_id,nick,comment,url,parent_id,rid,status) VALUES ('${oid}','${safeNick}','${safeStr(comment)}','/birthday-messages','${safeStr(id)}',0,1) RETURNING object_id`,
        env
      );
      return jsonResp(result.data, result.status);
    }

    // === Like a comment ===
    if (action === 'likeComment' && id) {
      const oid = 'clike_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
      const result = await runSQL(
        `INSERT INTO waline_comment (object_id,comment,url,parent_id,status) VALUES ('${oid}','\u2764','/birthday-messages','${safeStr(id)}',1) RETURNING object_id`,
        env
      );
      return jsonResp(result.data, result.status);
    }

    // === Export CSV ===
    if (action === 'export') {
      const where = [];
      if (type) where.push(`url = '${safeStr(type)}'`);
      if (keyword) where.push(`(nick ILIKE '%${safeStr(keyword)}%' OR comment ILIKE '%${safeStr(keyword)}%')`);
      const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';
      const result = await runSQL(
        `SELECT object_id, nick, comment, url, inserted_at, ip, ua, status, pinned FROM waline_comment ${whereClause} ORDER BY pinned DESC, inserted_at DESC`,
        env
      );
      if (!result.data.rows) return jsonResp({ error: 'Query failed' }, result.status);
      const rows = result.data.rows;
      const headers = ['ID', '昵称', '内容', '类型', '时间', 'IP', '设备', '状态', '置顶'];
      const typeMap = { '/birthday-messages': '留言', '/birthday-wishes': '许愿', '/birthday-page-like': '点赞', '/birthday-pageview': '访问' };
      let csv = '\uFEFF' + headers.join(',') + '\n';
      for (const r of rows) {
        const line = [
          r.object_id || '',
          r.nick || '',
          '"' + (r.comment || '').replace(/"/g, '""') + '"',
          typeMap[r.url] || r.url || '',
          r.inserted_at || '',
          r.ip || '',
          '"' + (r.ua || '').replace(/"/g, '""') + '"',
          r.status === 0 ? '隐藏' : '显示',
          r.pinned ? '是' : '否',
        ];
        csv += line.join(',') + '\n';
      }
      return new Response(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename=admin_export.csv',
        },
      });
    }

    // === Pageview Trend ===
    if (action === 'pvTrend') {
      const days = parseInt(body.days) || 7;
      const result = await runSQL(
        `SELECT DATE(inserted_at) AS day, COUNT(*)::int AS cnt FROM waline_comment WHERE url='/birthday-pageview' AND inserted_at > NOW() - INTERVAL '${days} days' GROUP BY DATE(inserted_at) ORDER BY day`,
        env
      );
      const rows = result.data.rows || [];
      return jsonResp({ rows });
    }

    return jsonResp({ error: 'Unknown action' }, 400);
  } catch (err) {
    return jsonResp({ error: err.message }, 502);
  }
}
