'use strict';

/**
 * 账号与会话：scrypt 加盐哈希 + HttpOnly Cookie 会话表
 * 不引第三方鉴权库，只依赖 node:crypto。
 */

const crypto = require('node:crypto');
const { get, run } = require('./db');

const COOKIE_NAME = 'zw_sid';
const SESSION_MS = 14 * 24 * 60 * 60 * 1000; // 14 天

function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(plain, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(plain, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = crypto.scryptSync(plain, salt, 64);
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

function createSession(userId) {
  const id = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  run(
    'INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
    id, userId, now, now + SESSION_MS
  );
  return id;
}

function destroySession(id) {
  if (id) run('DELETE FROM sessions WHERE id = ?', id);
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  header.split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i < 0) return;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

/** Express 中间件：把当前登录用户挂到 req.user */
function attachUser(req, res, next) {
  const sid = parseCookies(req.headers.cookie)[COOKIE_NAME];
  req.user = null;
  req.sessionId = sid || null;

  if (sid) {
    const row = get(
      `SELECT u.id, u.name, u.email, u.bio, s.expires_at
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.id = ?`,
      sid
    );
    if (row) {
      if (row.expires_at > Date.now()) {
        req.user = { id: row.id, name: row.name, email: row.email, bio: row.bio };
      } else {
        destroySession(sid);
      }
    }
  }
  next();
}

function setSessionCookie(res, sid) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_MS / 1000)}${secure}`
  );
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

/** 需要登录的路由用这个包一层 */
function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: '请先登录' });
  next();
}

module.exports = {
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  attachUser,
  setSessionCookie,
  clearSessionCookie,
  requireAuth,
  COOKIE_NAME
};
