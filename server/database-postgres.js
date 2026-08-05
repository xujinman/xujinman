const path = require('node:path');
const { Pool } = require('pg');

const projectRoot = path.resolve(__dirname, '..');
const databaseUrl = new URL(process.env.DATABASE_URL);
// node-postgres 兼容 PostgreSQL 的 require 语义：连接始终加密，但不要求系统证书库验证 Pooler 证书链。
databaseUrl.searchParams.delete('sslmode');
databaseUrl.searchParams.delete('sslrootcert');

const pool = new Pool({
  connectionString: databaseUrl.toString(),
  ssl: { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 15000
});

let initialization;

function initialize() {
  if (!initialization) {
    initialization = pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        display_name TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_idx ON users (LOWER(username));

      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL
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
        updated_at TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT NOT NULL,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        subject TEXT NOT NULL,
        duration INTEGER NOT NULL,
        priority TEXT NOT NULL,
        task_date TEXT NOT NULL,
        done BOOLEAN NOT NULL DEFAULT FALSE,
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

      CREATE TABLE IF NOT EXISTS focus_sessions (
        id TEXT NOT NULL,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        subject TEXT NOT NULL DEFAULT '其他',
        timer_mode TEXT NOT NULL,
        started_at TIMESTAMPTZ NOT NULL,
        ended_at TIMESTAMPTZ NOT NULL,
        duration_seconds INTEGER NOT NULL,
        PRIMARY KEY (user_id, id)
      );
      CREATE INDEX IF NOT EXISTS focus_user_ended_idx ON focus_sessions(user_id, ended_at DESC);

      CREATE TABLE IF NOT EXISTS notes (
        id TEXT NOT NULL,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        subject TEXT NOT NULL,
        note_type TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        pinned BOOLEAN NOT NULL DEFAULT FALSE,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
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

      ALTER TABLE users ENABLE ROW LEVEL SECURITY;
      ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
      ALTER TABLE school_targets ENABLE ROW LEVEL SECURITY;
      ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
      ALTER TABLE subject_progress ENABLE ROW LEVEL SECURITY;
      ALTER TABLE score_records ENABLE ROW LEVEL SECURITY;
      ALTER TABLE focus_sessions ENABLE ROW LEVEL SECURITY;
      ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
      ALTER TABLE note_images ENABLE ROW LEVEL SECURITY;
    `).catch(error => {
      initialization = null;
      throw error;
    });
  }
  return initialization;
}

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    createdAt: new Date(row.created_at).toISOString()
  };
}

async function findUserByUsername(username) {
  const { rows } = await pool.query('SELECT * FROM users WHERE LOWER(username) = LOWER($1)', [username]);
  return rows[0];
}

async function findUserById(id) {
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  return rows[0];
}

async function createUser(user) {
  const { rows } = await pool.query(`
    INSERT INTO users (id, username, display_name, password_salt, password_hash, created_at)
    VALUES ($1, $2, $3, $4, $5, $6) RETURNING *
  `, [user.id, user.username, user.displayName, user.passwordSalt, user.passwordHash, user.createdAt]);
  return publicUser(rows[0]);
}

async function updateUserProfile(userId, displayName) {
  const { rows } = await pool.query('UPDATE users SET display_name = $1 WHERE id = $2 RETURNING *', [displayName, userId]);
  return publicUser(rows[0]);
}

async function updateUserPassword(userId, passwordSalt, passwordHash) {
  await pool.query('UPDATE users SET password_salt = $1, password_hash = $2 WHERE id = $3', [passwordSalt, passwordHash, userId]);
}

async function createSession(session) {
  await pool.query('DELETE FROM sessions WHERE expires_at <= NOW()');
  await pool.query('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES ($1, $2, $3, $4)',
    [session.tokenHash, session.userId, session.expiresAt, session.createdAt]);
}

async function findSession(tokenHash) {
  const { rows } = await pool.query(`
    SELECT sessions.token_hash, sessions.expires_at, users.*
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = $1 AND sessions.expires_at > NOW()
  `, [tokenHash]);
  return rows[0];
}

async function deleteSession(tokenHash) {
  await pool.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
}

async function deleteUserSessions(userId) {
  await pool.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
}

async function getBootstrap(userId) {
  const [schoolResult, tasksResult, progressResult, scoresResult, focusResult, notesResult, imagesResult] = await Promise.all([
    pool.query('SELECT * FROM school_targets WHERE user_id = $1', [userId]),
    pool.query('SELECT * FROM tasks WHERE user_id = $1 ORDER BY task_date DESC', [userId]),
    pool.query('SELECT * FROM subject_progress WHERE user_id = $1', [userId]),
    pool.query('SELECT * FROM score_records WHERE user_id = $1 ORDER BY exam_date DESC', [userId]),
    pool.query('SELECT * FROM focus_sessions WHERE user_id = $1 ORDER BY ended_at DESC', [userId]),
    pool.query('SELECT * FROM notes WHERE user_id = $1 ORDER BY pinned DESC, updated_at DESC', [userId]),
    pool.query('SELECT * FROM note_images WHERE user_id = $1 ORDER BY note_id, position', [userId])
  ]);
  const schoolRow = schoolResult.rows[0];
  const imagesByNote = new Map();
  imagesResult.rows.forEach(row => {
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
    tasks: tasksResult.rows.map(row => ({ id: row.id, title: row.title, subject: row.subject, duration: row.duration, priority: row.priority, date: row.task_date, done: Boolean(row.done) })),
    progress: Object.fromEntries(progressResult.rows.map(row => [row.subject, { percent: row.percent, stage: row.stage, note: row.note }])),
    scores: scoresResult.rows.map(row => ({ id: row.id, name: row.name, date: row.exam_date, subject: row.subject, score: row.score, review: row.review })),
    focus: focusResult.rows.map(row => ({ id: row.id, subject: row.subject, mode: row.timer_mode, startedAt: new Date(row.started_at).toISOString(), endedAt: new Date(row.ended_at).toISOString(), durationSeconds: row.duration_seconds })),
    notes: notesResult.rows.map(row => ({ id: row.id, title: row.title, subject: row.subject, type: row.note_type, content: row.content, pinned: Boolean(row.pinned), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at), images: imagesByNote.get(row.id) || [] }))
  };
}

async function withTransaction(action) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await action(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function replaceTasks(userId, tasks) {
  await withTransaction(async client => {
    await client.query('DELETE FROM tasks WHERE user_id = $1', [userId]);
    for (const task of tasks) {
      const title = String(task.title || '').trim();
      if (!title || title.length > 200) throw new Error('INVALID_DATA');
      await client.query(`INSERT INTO tasks (id, user_id, title, subject, duration, priority, task_date, done) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [String(task.id), userId, title, String(task.subject || ''), Math.max(0, Math.min(1440, Number(task.duration) || 0)), String(task.priority || '中'), String(task.date || ''), Boolean(task.done)]);
    }
  });
}

async function replaceSchool(userId, school) {
  await pool.query(`
    INSERT INTO school_targets (user_id, school_name, major_name, exam_date, politics_target, english_target, math_target, major_target, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
    ON CONFLICT(user_id) DO UPDATE SET school_name=EXCLUDED.school_name, major_name=EXCLUDED.major_name, exam_date=EXCLUDED.exam_date,
      politics_target=EXCLUDED.politics_target, english_target=EXCLUDED.english_target, math_target=EXCLUDED.math_target,
      major_target=EXCLUDED.major_target, updated_at=EXCLUDED.updated_at
  `, [userId, String(school.schoolName || '').slice(0, 100), String(school.majorName || '').slice(0, 100), String(school.examDate || ''), Number(school.scores?.['政治']) || 0, Number(school.scores?.['英语']) || 0, Number(school.scores?.['数学']) || 0, Number(school.scores?.['专业课']) || 0]);
}

async function replaceProgress(userId, progress) {
  await withTransaction(async client => {
    await client.query('DELETE FROM subject_progress WHERE user_id = $1', [userId]);
    for (const [subject, item] of Object.entries(progress)) {
      await client.query('INSERT INTO subject_progress (user_id, subject, percent, stage, note) VALUES ($1,$2,$3,$4,$5)',
        [userId, subject, Math.max(0, Math.min(100, Number(item.percent) || 0)), String(item.stage || '基础阶段'), String(item.note || '').slice(0, 500)]);
    }
  });
}

async function replaceScores(userId, scores) {
  const fullMarks = { '政治': 100, '英语': 100, '数学': 150, '专业课': 150 };
  await withTransaction(async client => {
    await client.query('DELETE FROM score_records WHERE user_id = $1', [userId]);
    for (const record of scores) {
      const subject = String(record.subject || '');
      const score = Number(record.score);
      if (!fullMarks[subject] || !Number.isFinite(score) || score < 0 || score > fullMarks[subject]) throw new Error('INVALID_DATA');
      await client.query('INSERT INTO score_records (id, user_id, name, exam_date, subject, score, review) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [String(record.id), userId, String(record.name || '').slice(0, 100), String(record.date || ''), subject, score, String(record.review || '').slice(0, 1000)]);
    }
  });
}

async function replaceFocus(userId, sessions) {
  await withTransaction(async client => {
    await client.query('DELETE FROM focus_sessions WHERE user_id = $1', [userId]);
    for (const session of sessions) {
      const mode = String(session.mode || '');
      const durationSeconds = Math.round(Number(session.durationSeconds));
      const startedAt = new Date(session.startedAt);
      const endedAt = new Date(session.endedAt);
      if (!['countdown', 'stopwatch'].includes(mode) || !Number.isFinite(durationSeconds) || durationSeconds < 1 || durationSeconds > 86400 || Number.isNaN(startedAt.getTime()) || Number.isNaN(endedAt.getTime())) throw new Error('INVALID_DATA');
      await client.query('INSERT INTO focus_sessions (id, user_id, subject, timer_mode, started_at, ended_at, duration_seconds) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [String(session.id), userId, String(session.subject || '其他').slice(0, 30), mode, startedAt.toISOString(), endedAt.toISOString(), durationSeconds]);
    }
  });
}

async function replaceNotes(userId, notes) {
  await withTransaction(async client => {
    await client.query('DELETE FROM notes WHERE user_id = $1', [userId]);
    for (const note of notes) {
      const noteId = String(note.id);
      await client.query('INSERT INTO notes (id, user_id, title, subject, note_type, content, pinned, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [noteId, userId, String(note.title || '').slice(0, 200), String(note.subject || ''), String(note.type || ''), String(note.content || '').slice(0, 10000), Boolean(note.pinned), Number(note.createdAt) || Date.now(), Number(note.updatedAt) || Date.now()]);
      const images = Array.isArray(note.images) ? note.images.slice(0, 4) : [];
      for (let index = 0; index < images.length; index += 1) {
        await client.query('INSERT INTO note_images (user_id, note_id, position, image_url) VALUES ($1,$2,$3,$4)', [userId, noteId, index, String(images[index])]);
      }
    }
  });
}

async function replaceUserData(userId, type, payload) {
  if (type === 'tasks' && Array.isArray(payload)) return replaceTasks(userId, payload);
  if (type === 'school' && payload && typeof payload === 'object') return replaceSchool(userId, payload);
  if (type === 'progress' && payload && typeof payload === 'object') return replaceProgress(userId, payload);
  if (type === 'scores' && Array.isArray(payload)) return replaceScores(userId, payload);
  if (type === 'focus' && Array.isArray(payload)) return replaceFocus(userId, payload);
  if (type === 'notes' && Array.isArray(payload)) return replaceNotes(userId, payload);
  throw new Error('INVALID_DATA_TYPE');
}

async function closeDatabase() {
  await pool.end();
}

module.exports = {
  kind: 'postgres',
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
