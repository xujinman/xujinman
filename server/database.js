const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const projectRoot = path.resolve(__dirname, '..');
const databasePath = process.env.DATABASE_PATH ? path.resolve(process.env.DATABASE_PATH) : path.join(projectRoot, 'data', 'yantu.db');
const dataDirectory = path.dirname(databasePath);
fs.mkdirSync(dataDirectory, { recursive: true });

const database = new DatabaseSync(databasePath);
database.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
database.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);

  CREATE TABLE IF NOT EXISTS school_targets (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    school_name TEXT NOT NULL DEFAULT '',
    major_name TEXT NOT NULL DEFAULT '',
    exam_date TEXT NOT NULL DEFAULT '',
    politics_target INTEGER NOT NULL DEFAULT 0,
    english_target INTEGER NOT NULL DEFAULT 0,
    math_target INTEGER NOT NULL DEFAULT 0,
    major_target INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    subject TEXT NOT NULL,
    duration INTEGER NOT NULL,
    priority TEXT NOT NULL,
    task_date TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, id)
  );
  CREATE INDEX IF NOT EXISTS tasks_user_date_idx ON tasks(user_id, task_date);

  CREATE TABLE IF NOT EXISTS subject_progress (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject TEXT NOT NULL,
    percent INTEGER NOT NULL DEFAULT 0,
    stage TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (user_id, subject)
  );

  CREATE TABLE IF NOT EXISTS score_records (
    id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    exam_date TEXT NOT NULL,
    subject TEXT NOT NULL,
    score INTEGER NOT NULL,
    review TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (user_id, id)
  );
  CREATE INDEX IF NOT EXISTS scores_user_subject_date_idx ON score_records(user_id, subject, exam_date);

  CREATE TABLE IF NOT EXISTS notes (
    id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    subject TEXT NOT NULL,
    note_type TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    pinned INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, id)
  );

  CREATE TABLE IF NOT EXISTS note_images (
    user_id TEXT NOT NULL,
    note_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    image_url TEXT NOT NULL,
    PRIMARY KEY (user_id, note_id, position),
    FOREIGN KEY (user_id, note_id) REFERENCES notes(user_id, id) ON DELETE CASCADE
  );
`);

async function initialize() {}

function transaction(action) {
  database.exec('BEGIN IMMEDIATE');
  try {
    const result = action();
    database.exec('COMMIT');
    return result;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    createdAt: row.created_at
  };
}

function findUserByUsername(username) {
  return database.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username);
}

function findUserById(id) {
  return database.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function createUser(user) {
  database.prepare(`
    INSERT INTO users (id, username, display_name, password_salt, password_hash, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(user.id, user.username, user.displayName, user.passwordSalt, user.passwordHash, user.createdAt);
  return publicUser(findUserById(user.id));
}

function updateUserProfile(userId, displayName) {
  database.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(displayName, userId);
  return publicUser(findUserById(userId));
}

function updateUserPassword(userId, passwordSalt, passwordHash) {
  database.prepare('UPDATE users SET password_salt = ?, password_hash = ? WHERE id = ?').run(passwordSalt, passwordHash, userId);
}

function createSession(session) {
  database.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date().toISOString());
  database.prepare(`INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)`)
    .run(session.tokenHash, session.userId, session.expiresAt, session.createdAt);
}

function findSession(tokenHash) {
  return database.prepare(`
    SELECT sessions.token_hash, sessions.expires_at, users.*
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
  `).get(tokenHash, new Date().toISOString());
}

function deleteSession(tokenHash) {
  database.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
}

function deleteUserSessions(userId) {
  database.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

function getBootstrap(userId) {
  const schoolRow = database.prepare('SELECT * FROM school_targets WHERE user_id = ?').get(userId);
  const taskRows = database.prepare('SELECT * FROM tasks WHERE user_id = ? ORDER BY task_date DESC').all(userId);
  const progressRows = database.prepare('SELECT * FROM subject_progress WHERE user_id = ?').all(userId);
  const scoreRows = database.prepare('SELECT * FROM score_records WHERE user_id = ? ORDER BY exam_date DESC').all(userId);
  const noteRows = database.prepare('SELECT * FROM notes WHERE user_id = ? ORDER BY pinned DESC, updated_at DESC').all(userId);
  const imageRows = database.prepare('SELECT * FROM note_images WHERE user_id = ? ORDER BY note_id, position').all(userId);
  const imagesByNote = new Map();
  imageRows.forEach(row => {
    if (!imagesByNote.has(row.note_id)) imagesByNote.set(row.note_id, []);
    imagesByNote.get(row.note_id).push(row.image_url);
  });

  return {
    school: schoolRow ? {
      schoolName: schoolRow.school_name,
      majorName: schoolRow.major_name,
      examDate: schoolRow.exam_date,
      scores: { '政治': schoolRow.politics_target, '英语': schoolRow.english_target, '数学': schoolRow.math_target, '专业课': schoolRow.major_target }
    } : null,
    tasks: taskRows.map(row => ({ id: row.id, title: row.title, subject: row.subject, duration: row.duration, priority: row.priority, date: row.task_date, done: Boolean(row.done) })),
    progress: Object.fromEntries(progressRows.map(row => [row.subject, { percent: row.percent, stage: row.stage, note: row.note }])),
    scores: scoreRows.map(row => ({ id: row.id, name: row.name, date: row.exam_date, subject: row.subject, score: row.score, review: row.review })),
    notes: noteRows.map(row => ({ id: row.id, title: row.title, subject: row.subject, type: row.note_type, content: row.content, pinned: Boolean(row.pinned), createdAt: row.created_at, updatedAt: row.updated_at, images: imagesByNote.get(row.id) || [] }))
  };
}

function replaceTasks(userId, tasks) {
  transaction(() => {
    database.prepare('DELETE FROM tasks WHERE user_id = ?').run(userId);
    const insert = database.prepare(`INSERT INTO tasks (id, user_id, title, subject, duration, priority, task_date, done) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    tasks.forEach(task => {
      const title = String(task.title || '').trim();
      if (!title || title.length > 200) throw new Error('INVALID_DATA');
      insert.run(String(task.id), userId, title, String(task.subject || ''), Math.max(0, Math.min(1440, Number(task.duration) || 0)), String(task.priority || '中'), String(task.date || ''), task.done ? 1 : 0);
    });
  });
}

function replaceSchool(userId, school) {
  database.prepare(`
    INSERT INTO school_targets (user_id, school_name, major_name, exam_date, politics_target, english_target, math_target, major_target, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET school_name=excluded.school_name, major_name=excluded.major_name, exam_date=excluded.exam_date,
      politics_target=excluded.politics_target, english_target=excluded.english_target, math_target=excluded.math_target,
      major_target=excluded.major_target, updated_at=excluded.updated_at
  `).run(userId, String(school.schoolName || '').slice(0, 100), String(school.majorName || '').slice(0, 100), String(school.examDate || ''), Number(school.scores?.['政治']) || 0, Number(school.scores?.['英语']) || 0, Number(school.scores?.['数学']) || 0, Number(school.scores?.['专业课']) || 0, new Date().toISOString());
}

function replaceProgress(userId, progress) {
  transaction(() => {
    database.prepare('DELETE FROM subject_progress WHERE user_id = ?').run(userId);
    const insert = database.prepare('INSERT INTO subject_progress (user_id, subject, percent, stage, note) VALUES (?, ?, ?, ?, ?)');
    Object.entries(progress).forEach(([subject, item]) => insert.run(userId, subject, Math.max(0, Math.min(100, Number(item.percent) || 0)), String(item.stage || '基础阶段'), String(item.note || '').slice(0, 500)));
  });
}

function replaceScores(userId, scores) {
  transaction(() => {
    database.prepare('DELETE FROM score_records WHERE user_id = ?').run(userId);
    const insert = database.prepare('INSERT INTO score_records (id, user_id, name, exam_date, subject, score, review) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const fullMarks = { '政治': 100, '英语': 100, '数学': 150, '专业课': 150 };
    scores.forEach(record => {
      const subject = String(record.subject || '');
      const score = Number(record.score);
      if (!fullMarks[subject] || !Number.isFinite(score) || score < 0 || score > fullMarks[subject]) throw new Error('INVALID_DATA');
      insert.run(String(record.id), userId, String(record.name || '').slice(0, 100), String(record.date || ''), subject, score, String(record.review || '').slice(0, 1000));
    });
  });
}

function replaceNotes(userId, notes) {
  transaction(() => {
    database.prepare('DELETE FROM notes WHERE user_id = ?').run(userId);
    const insertNote = database.prepare('INSERT INTO notes (id, user_id, title, subject, note_type, content, pinned, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const insertImage = database.prepare('INSERT INTO note_images (user_id, note_id, position, image_url) VALUES (?, ?, ?, ?)');
    notes.forEach(note => {
      const noteId = String(note.id);
      insertNote.run(noteId, userId, String(note.title || '').slice(0, 200), String(note.subject || ''), String(note.type || ''), String(note.content || '').slice(0, 10000), note.pinned ? 1 : 0, Number(note.createdAt) || Date.now(), Number(note.updatedAt) || Date.now());
      (Array.isArray(note.images) ? note.images : []).slice(0, 4).forEach((url, index) => insertImage.run(userId, noteId, index, String(url)));
    });
  });
}

function replaceUserData(userId, type, payload) {
  if (type === 'tasks' && Array.isArray(payload)) return replaceTasks(userId, payload);
  if (type === 'school' && payload && typeof payload === 'object') return replaceSchool(userId, payload);
  if (type === 'progress' && payload && typeof payload === 'object') return replaceProgress(userId, payload);
  if (type === 'scores' && Array.isArray(payload)) return replaceScores(userId, payload);
  if (type === 'notes' && Array.isArray(payload)) return replaceNotes(userId, payload);
  throw new Error('INVALID_DATA_TYPE');
}

function closeDatabase() {
  database.close();
}

module.exports = {
  kind: 'sqlite',
  projectRoot,
  initialize,
  publicUser,
  findUserByUsername,
  findUserById,
  createUser,
  updateUserProfile,
  updateUserPassword,
  createSession,
  findSession,
  deleteSession,
  deleteUserSessions,
  getBootstrap,
  replaceUserData,
  closeDatabase
};
