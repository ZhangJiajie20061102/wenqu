'use strict';

/**
 * 数据层：node:sqlite（Node 22 内置，无需编译原生模块）
 * 所有时间戳统一存毫秒整数，前端自己算「几分钟前」。
 */

const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data.db');

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL UNIQUE,
  email         TEXT    NOT NULL UNIQUE,
  password      TEXT    NOT NULL,
  bio           TEXT    NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS questions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title         TEXT    NOT NULL,
  body          TEXT    NOT NULL DEFAULT '',
  views         INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tags (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS question_tags (
  question_id   INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  tag_id        INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (question_id, tag_id)
);

CREATE TABLE IF NOT EXISTS answers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id   INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body          TEXT    NOT NULL,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS comments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  answer_id     INTEGER NOT NULL REFERENCES answers(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body          TEXT    NOT NULL,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS votes (
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type   TEXT    NOT NULL CHECK (target_type IN ('question', 'answer')),
  target_id     INTEGER NOT NULL,
  value         INTEGER NOT NULL CHECK (value IN (-1, 1)),
  PRIMARY KEY (user_id, target_type, target_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT    PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_answers_question   ON answers(question_id);
CREATE INDEX IF NOT EXISTS idx_comments_answer    ON comments(answer_id);
CREATE INDEX IF NOT EXISTS idx_votes_target       ON votes(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_questions_created  ON questions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_expires   ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_qt_tag             ON question_tags(tag_id);
`;

function init() {
  db.exec(SCHEMA);
  // 清掉过期会话，免得 sessions 表越堆越大
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
}

const all = (sql, ...params) => db.prepare(sql).all(...params);
const get = (sql, ...params) => db.prepare(sql).get(...params);
const run = (sql, ...params) => db.prepare(sql).run(...params);

/** 简单事务包装：出错自动回滚 */
function tx(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = { db, init, all, get, run, tx, DB_PATH };
