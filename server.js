'use strict';

/**
 * 墨问 · 一个可运行的问答社区
 * Node + Express + node:sqlite，无原生依赖、无 ORM、无前端构建。
 */

const path = require('node:path');
const express = require('express');

const { init, all, get, run, tx } = require('./db');
const {
  hashPassword, verifyPassword, createSession, destroySession,
  attachUser, setSessionCookie, clearSessionCookie, requireAuth
} = require('./auth');

init();

const app = express();
const PORT = process.env.PORT || 3000;

app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));
app.use(attachUser);
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

/* ---------------------------------------------------------------- 工具 */

const TITLE_MAX = 120;
const BODY_MAX = 20000;
const COMMENT_MAX = 500;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const fail = (status, message) => { throw new HttpError(status, message); };

function text(value, { field, max, min = 1, required = true }) {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s) {
    if (required) fail(400, `${field}不能为空`);
    return '';
  }
  if (s.length < min) fail(400, `${field}至少要 ${min} 个字`);
  if (s.length > max) fail(400, `${field}最多 ${max} 个字`);
  return s;
}

/** 把 "node.js、sqlite, 学习" 这类输入拆成干净的标签数组 */
function parseTags(input) {
  const raw = Array.isArray(input) ? input : String(input || '').split(/[,，、\s]+/);
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    const name = String(item).trim().replace(/^#/, '').slice(0, 20);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= 5) break;
  }
  return out;
}

/** 热榜打分：票数、回答数、浏览量、评论数加权后按时间衰减 */
function hotScore(row, now = Date.now()) {
  const hours = Math.max(0, (now - row.created_at) / 3600000);
  const raw = row.vote_score * 3 + row.answer_count * 5 + row.views * 0.2 + row.comment_count * 1.5 + 1;
  return raw / Math.pow(hours + 2, 1.5);
}

function tagsOf(questionIds) {
  if (!questionIds.length) return new Map();
  const placeholders = questionIds.map(() => '?').join(',');
  const rows = all(
    `SELECT qt.question_id, t.name
       FROM question_tags qt JOIN tags t ON t.id = qt.tag_id
      WHERE qt.question_id IN (${placeholders})
      ORDER BY t.name`,
    ...questionIds
  );
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.question_id)) map.set(r.question_id, []);
    map.get(r.question_id).push(r.name);
  }
  return map;
}

function attachTags(rows) {
  const map = tagsOf(rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, tags: map.get(r.id) || [] }));
}

function shapeQuestion(r) {
  return {
    id: r.id,
    title: r.title,
    excerpt: (r.body || '').replace(/\s+/g, ' ').slice(0, 140),
    views: r.views,
    created_at: r.created_at,
    author: { id: r.author_id, name: r.author_name },
    answer_count: r.answer_count,
    comment_count: r.comment_count,
    vote_score: r.vote_score,
    tags: r.tags || []
  };
}

const LIST_COLUMNS = `
  q.id, q.title, q.body, q.views, q.created_at,
  u.id AS author_id, u.name AS author_name,
  (SELECT COUNT(*) FROM answers a WHERE a.question_id = q.id) AS answer_count,
  COALESCE((SELECT SUM(v.value) FROM votes v
             WHERE v.target_type = 'question' AND v.target_id = q.id), 0) AS vote_score,
  (SELECT COUNT(*) FROM comments c
     JOIN answers a2 ON a2.id = c.answer_id
    WHERE a2.question_id = q.id) AS comment_count
`;

/* ---------------------------------------------------------------- 列表 */

app.get('/api/questions', (req, res) => {
  const sort = ['hot', 'new', 'unanswered'].includes(req.query.sort) ? req.query.sort : 'new';
  const keyword = String(req.query.q || '').trim().slice(0, 60);
  const tag = String(req.query.tag || '').trim().slice(0, 20);
  const authorId = Number(req.query.author) || null;
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
  const offset = Math.max(Number(req.query.offset) || 0, 0);

  const where = [];
  const params = [];

  if (keyword) {
    where.push('(q.title LIKE ? OR q.body LIKE ?)');
    params.push(`%${keyword}%`, `%${keyword}%`);
  }
  if (tag) {
    where.push(`q.id IN (SELECT qt.question_id FROM question_tags qt
                          JOIN tags t ON t.id = qt.tag_id WHERE t.name = ?)`);
    params.push(tag);
  }
  if (authorId) {
    where.push('q.user_id = ?');
    params.push(authorId);
  }
  if (sort === 'unanswered') {
    where.push('(SELECT COUNT(*) FROM answers a WHERE a.question_id = q.id) = 0');
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const base = `FROM questions q JOIN users u ON u.id = q.user_id ${whereSql}`;

  let rows;
  let total;

  if (sort === 'hot') {
    // 热榜需要整体排序后分页，先取轻量字段在内存里算分
    const candidates = all(`SELECT ${LIST_COLUMNS} ${base}`, ...params);
    const now = Date.now();
    candidates.sort((a, b) => hotScore(b, now) - hotScore(a, now));
    total = candidates.length;
    rows = candidates.slice(offset, offset + limit);
  } else {
    total = get(`SELECT COUNT(*) AS c ${base}`, ...params).c;
    rows = all(
      `SELECT ${LIST_COLUMNS} ${base} ORDER BY q.created_at DESC LIMIT ? OFFSET ?`,
      ...params, limit, offset
    );
  }

  const items = attachTags(rows).map(shapeQuestion);

  // 登录用户：标出自己投过票的问题
  if (req.user && items.length) {
    const placeholders = items.map(() => '?').join(',');
    const votes = all(
      `SELECT target_id, value FROM votes
        WHERE target_type = 'question' AND user_id = ? AND target_id IN (${placeholders})`,
      req.user.id, ...items.map((i) => i.id)
    );
    const mine = new Map(votes.map((v) => [v.target_id, v.value]));
    for (const item of items) item.my_vote = mine.get(item.id) || 0;
  }

  res.json({ items, total, sort, limit, offset });
});

/* ---------------------------------------------------------------- 详情 */

app.get('/api/questions/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!id) fail(400, '问题不存在');

  const q = get(
    `SELECT q.*, u.name AS author_name, u.bio AS author_bio
       FROM questions q JOIN users u ON u.id = q.user_id WHERE q.id = ?`,
    id
  );
  if (!q) fail(404, '问题不存在或已被删除');

  run('UPDATE questions SET views = views + 1 WHERE id = ?', id);

  const tags = all(
    `SELECT t.name FROM question_tags qt JOIN tags t ON t.id = qt.tag_id
      WHERE qt.question_id = ? ORDER BY t.name`,
    id
  ).map((r) => r.name);

  const answers = all(
    `SELECT a.id, a.body, a.created_at, u.id AS author_id, u.name AS author_name,
            COALESCE((SELECT SUM(v.value) FROM votes v
                       WHERE v.target_type = 'answer' AND v.target_id = a.id), 0) AS vote_score
       FROM answers a JOIN users u ON u.id = a.user_id
      WHERE a.question_id = ?
      ORDER BY vote_score DESC, a.created_at ASC`,
    id
  );

  const commentsByAnswer = new Map();
  if (answers.length) {
    const placeholders = answers.map(() => '?').join(',');
    const rows = all(
      `SELECT c.id, c.answer_id, c.body, c.created_at, u.id AS author_id, u.name AS author_name
         FROM comments c JOIN users u ON u.id = c.user_id
        WHERE c.answer_id IN (${placeholders}) ORDER BY c.created_at ASC`,
      ...answers.map((a) => a.id)
    );
    for (const r of rows) {
      if (!commentsByAnswer.has(r.answer_id)) commentsByAnswer.set(r.answer_id, []);
      commentsByAnswer.get(r.answer_id).push({
        id: r.id,
        body: r.body,
        created_at: r.created_at,
        author: { id: r.author_id, name: r.author_name }
      });
    }
  }

  // 当前用户的投票状态
  let myQuestionVote = 0;
  const myAnswerVotes = new Map();
  if (req.user) {
    myQuestionVote = get(
      `SELECT value FROM votes WHERE user_id = ? AND target_type = 'question' AND target_id = ?`,
      req.user.id, id
    )?.value || 0;
    if (answers.length) {
      const placeholders = answers.map(() => '?').join(',');
      const rows = all(
        `SELECT target_id, value FROM votes
          WHERE user_id = ? AND target_type = 'answer' AND target_id IN (${placeholders})`,
        req.user.id, ...answers.map((a) => a.id)
      );
      for (const r of rows) myAnswerVotes.set(r.target_id, r.value);
    }
  }

  const questionVoteScore = get(
    `SELECT COALESCE(SUM(value), 0) AS s FROM votes
      WHERE target_type = 'question' AND target_id = ?`,
    id
  ).s;

  res.json({
    id: q.id,
    title: q.title,
    body: q.body,
    views: q.views + 1,
    created_at: q.created_at,
    tags,
    vote_score: questionVoteScore,
    my_vote: myQuestionVote,
    author: { id: q.user_id, name: q.author_name, bio: q.author_bio },
    answers: answers.map((a) => ({
      id: a.id,
      body: a.body,
      created_at: a.created_at,
      vote_score: a.vote_score,
      my_vote: myAnswerVotes.get(a.id) || 0,
      author: { id: a.author_id, name: a.author_name },
      comments: commentsByAnswer.get(a.id) || []
    }))
  });
});

/* ---------------------------------------------------------------- 提问 */

app.post('/api/questions', requireAuth, (req, res) => {
  const title = text(req.body.title, { field: '问题标题', max: TITLE_MAX, min: 5 });
  const body = text(req.body.body, { field: '问题描述', max: BODY_MAX, required: false });
  const tags = parseTags(req.body.tags);

  const now = Date.now();
  const id = tx(() => {
    const r = run(
      'INSERT INTO questions (user_id, title, body, created_at) VALUES (?, ?, ?, ?)',
      req.user.id, title, body, now
    );
    const qid = Number(r.lastInsertRowid);
    for (const name of tags) {
      run('INSERT OR IGNORE INTO tags (name) VALUES (?)', name);
      const tagRow = get('SELECT id FROM tags WHERE name = ?', name);
      run('INSERT OR IGNORE INTO question_tags (question_id, tag_id) VALUES (?, ?)', qid, tagRow.id);
    }
    return qid;
  });

  res.status(201).json({ id });
});

/* ---------------------------------------------------------------- 回答 */

app.post('/api/questions/:id/answers', requireAuth, (req, res) => {
  const qid = Number(req.params.id);
  const body = text(req.body.body, { field: '回答内容', max: BODY_MAX, min: 2 });

  const question = get('SELECT id FROM questions WHERE id = ?', qid);
  if (!question) fail(404, '问题不存在');

  const r = run(
    'INSERT INTO answers (question_id, user_id, body, created_at) VALUES (?, ?, ?, ?)',
    qid, req.user.id, body, Date.now()
  );

  res.status(201).json({ id: Number(r.lastInsertRowid) });
});

/* ---------------------------------------------------------------- 评论 */

app.post('/api/answers/:id/comments', requireAuth, (req, res) => {
  const aid = Number(req.params.id);
  const body = text(req.body.body, { field: '评论内容', max: COMMENT_MAX });

  const answer = get('SELECT id FROM answers WHERE id = ?', aid);
  if (!answer) fail(404, '回答不存在');

  const r = run(
    'INSERT INTO comments (answer_id, user_id, body, created_at) VALUES (?, ?, ?, ?)',
    aid, req.user.id, body, Date.now()
  );

  res.status(201).json({ id: Number(r.lastInsertRowid) });
});

/* ---------------------------------------------------------------- 投票 */

app.post('/api/vote', requireAuth, (req, res) => {
  const targetType = req.body.targetType;
  const targetId = Number(req.body.targetId);
  const value = Number(req.body.value);

  if (!['question', 'answer'].includes(targetType)) fail(400, '投票对象不合法');
  if (!targetId) fail(400, '投票对象不合法');
  if (![1, -1, 0].includes(value)) fail(400, '投票值只能是 1、-1 或 0');

  const table = targetType === 'question' ? 'questions' : 'answers';
  const exists = get(`SELECT user_id FROM ${table} WHERE id = ?`, targetId);
  if (!exists) fail(404, '投票对象不存在');
  if (targetType === 'answer' && exists.user_id === req.user.id) {
    fail(400, '不能给自己的回答投票');
  }

  if (value === 0) {
    run('DELETE FROM votes WHERE user_id = ? AND target_type = ? AND target_id = ?',
      req.user.id, targetType, targetId);
  } else {
    run(
      `INSERT INTO votes (user_id, target_type, target_id, value) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, target_type, target_id) DO UPDATE SET value = excluded.value`,
      req.user.id, targetType, targetId, value
    );
  }

  const score = get(
    'SELECT COALESCE(SUM(value), 0) AS s FROM votes WHERE target_type = ? AND target_id = ?',
    targetType, targetId
  ).s;

  res.json({ score, my_vote: value });
});

/* ---------------------------------------------------------------- 用户 */

app.get('/api/users/:id', (req, res) => {
  const id = Number(req.params.id);
  const user = get('SELECT id, name, bio, created_at FROM users WHERE id = ?', id);
  if (!user) fail(404, '用户不存在');

  const stats = {
    questions: get('SELECT COUNT(*) AS c FROM questions WHERE user_id = ?', id).c,
    answers: get('SELECT COUNT(*) AS c FROM answers WHERE user_id = ?', id).c,
    upvotes: get(
      `SELECT COALESCE(SUM(v.value), 0) AS s FROM votes v
         JOIN answers a ON a.id = v.target_id
        WHERE v.target_type = 'answer' AND v.value = 1 AND a.user_id = ?`, id
    ).s
  };

  const questions = attachTags(all(
    `SELECT ${LIST_COLUMNS} FROM questions q JOIN users u ON u.id = q.user_id
      WHERE q.user_id = ? ORDER BY q.created_at DESC LIMIT 10`, id
  )).map(shapeQuestion);

  const answers = all(
    `SELECT a.id, a.body, a.created_at, a.question_id, q.title AS question_title,
            COALESCE((SELECT SUM(v.value) FROM votes v
                       WHERE v.target_type = 'answer' AND v.target_id = a.id), 0) AS vote_score
       FROM answers a JOIN questions q ON q.id = a.question_id
      WHERE a.user_id = ? ORDER BY a.created_at DESC LIMIT 10`, id
  ).map((a) => ({
    id: a.id,
    question_id: a.question_id,
    question_title: a.question_title,
    excerpt: a.body.replace(/\s+/g, ' ').slice(0, 120),
    vote_score: a.vote_score,
    created_at: a.created_at
  }));

  res.json({ user, stats, questions, answers });
});

/* ---------------------------------------------------------------- 侧栏 */

app.get('/api/overview', (req, res) => {
  const tags = all(
    `SELECT t.name, COUNT(qt.question_id) AS count
       FROM tags t LEFT JOIN question_tags qt ON qt.tag_id = t.id
      GROUP BY t.id ORDER BY count DESC, t.name LIMIT 12`
  );
  const users = all(
    `SELECT u.id, u.name, COUNT(a.id) AS answers
       FROM users u LEFT JOIN answers a ON a.user_id = u.id
      GROUP BY u.id ORDER BY answers DESC, u.id LIMIT 6`
  );
  const totals = {
    questions: get('SELECT COUNT(*) AS c FROM questions').c,
    answers: get('SELECT COUNT(*) AS c FROM answers').c,
    users: get('SELECT COUNT(*) AS c FROM users').c
  };
  res.json({ tags, users, totals });
});

/* ---------------------------------------------------------------- 账号 */

app.post('/api/register', (req, res) => {
  const name = text(req.body.name, { field: '昵称', max: 20, min: 2 });
  const email = text(req.body.email, { field: '邮箱', max: 120 }).toLowerCase();
  const password = text(req.body.password, { field: '密码', max: 72, min: 6 });

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, '邮箱格式不对');
  if (get('SELECT id FROM users WHERE name = ?', name)) fail(409, '这个昵称已经被用了');
  if (get('SELECT id FROM users WHERE email = ?', email)) fail(409, '这个邮箱已经注册过了');

  const r = run(
    'INSERT INTO users (name, email, password, bio, created_at) VALUES (?, ?, ?, ?, ?)',
    name, email, hashPassword(password), '', Date.now()
  );
  const userId = Number(r.lastInsertRowid);
  setSessionCookie(res, createSession(userId));
  res.status(201).json({ user: { id: userId, name, email, bio: '' } });
});

app.post('/api/login', (req, res) => {
  const account = text(req.body.account, { field: '账号' }).toLowerCase();
  const password = text(req.body.password, { field: '密码' });

  const user = get(
    'SELECT id, name, email, bio, password FROM users WHERE lower(email) = ? OR lower(name) = ?',
    account, account
  );
  if (!user || !verifyPassword(password, user.password)) fail(401, '账号或密码不对');

  setSessionCookie(res, createSession(user.id));
  res.json({ user: { id: user.id, name: user.name, email: user.email, bio: user.bio } });
});

app.post('/api/logout', (req, res) => {
  destroySession(req.sessionId);
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  res.json({ user: req.user });
});

/* ---------------------------------------------------------------- 兜底 */

app.use('/api', (req, res) => {
  res.status(404).json({ error: '接口不存在' });
});

app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: '请求体不是合法 JSON' });
  }
  console.error('[error]', err);
  res.status(500).json({ error: '服务器出错了' });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`墨问已启动 → http://localhost:${PORT}`);
  });
}

module.exports = app;
