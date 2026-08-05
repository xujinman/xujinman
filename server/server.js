const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const express = require('express');
const helmet = require('helmet');
const db = process.env.DATABASE_URL ? require('./database-postgres') : require('./database');
const storage = require('./storage');

const scrypt = promisify(crypto.scrypt);
const app = express();
const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '127.0.0.1';
const isProduction = process.env.NODE_ENV === 'production';
const registrationInviteCode = String(process.env.REGISTRATION_INVITE_CODE || '');
const sessionCookieName = 'yantu_session';
const sessionMaxAgeSeconds = 7 * 24 * 60 * 60;
const loginAttempts = new Map();
const registrationAttempts = new Map();

app.disable('x-powered-by');
if (isProduction) app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-origin' } }));
app.use((req, res, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('sec-fetch-site') === 'cross-site') {
    return res.status(403).json({ error: '拒绝跨站请求' });
  }
  next();
});
app.use(express.json({ limit: '12mb' }));

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map(item => item.trim()).filter(Boolean).map(item => {
    const separator = item.indexOf('=');
    return [decodeURIComponent(item.slice(0, separator)), decodeURIComponent(item.slice(separator + 1))];
  }));
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function secretsMatch(actual, expected) {
  const actualBuffer = Buffer.from(String(actual));
  const expectedBuffer = Buffer.from(String(expected));
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

async function passwordCredential(password, saltHex = null) {
  const salt = saltHex ? Buffer.from(saltHex, 'hex') : crypto.randomBytes(16);
  const derivedKey = await scrypt(password, salt, 32, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
  return { salt: salt.toString('hex'), hash: Buffer.from(derivedKey).toString('hex') };
}

async function passwordMatches(password, user) {
  const credential = await passwordCredential(password, user.password_salt);
  const actual = Buffer.from(credential.hash, 'hex');
  const expected = Buffer.from(user.password_hash, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function setSessionCookie(res, rawToken) {
  const parts = [
    `${sessionCookieName}=${encodeURIComponent(rawToken)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${sessionMaxAgeSeconds}`
  ];
  if (isProduction) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res) {
  const parts = [`${sessionCookieName}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (isProduction) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

async function startSession(res, userId) {
  const rawToken = crypto.randomBytes(32).toString('base64url');
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + sessionMaxAgeSeconds * 1000);
  await db.createSession({ tokenHash: tokenHash(rawToken), userId, createdAt: createdAt.toISOString(), expiresAt: expiresAt.toISOString() });
  setSessionCookie(res, rawToken);
}

async function authFromRequest(req) {
  const rawToken = parseCookies(req.headers.cookie)[sessionCookieName];
  if (!rawToken) return null;
  const session = await db.findSession(tokenHash(rawToken));
  if (!session) return null;
  return { rawToken, user: db.publicUser(session), databaseUser: session };
}

function requireAuth(req, res, next) {
  authFromRequest(req).then(auth => {
    if (!auth) return res.status(401).json({ error: '请先登录' });
    req.auth = auth;
    next();
  }).catch(next);
}

function attemptKey(req, username) {
  return `${req.ip}:${String(username).toLowerCase()}`;
}

function isRateLimited(key) {
  const item = loginAttempts.get(key);
  if (!item || item.resetAt <= Date.now()) {
    loginAttempts.delete(key);
    return false;
  }
  return item.count >= 6;
}

function recordFailedLogin(key) {
  const current = loginAttempts.get(key);
  if (!current || current.resetAt <= Date.now()) {
    loginAttempts.set(key, { count: 1, resetAt: Date.now() + 15 * 60 * 1000 });
  } else {
    current.count += 1;
  }
}

function recordRegistrationAttempt(ip) {
  const current = registrationAttempts.get(ip);
  if (!current || current.resetAt <= Date.now()) {
    registrationAttempts.set(ip, { count: 1, resetAt: Date.now() + 60 * 60 * 1000 });
  } else {
    current.count += 1;
  }
}

function isRegistrationRateLimited(ip) {
  const item = registrationAttempts.get(ip);
  if (!item || item.resetAt <= Date.now()) {
    registrationAttempts.delete(ip);
    return false;
  }
  return item.count >= 10;
}

app.get('/api/health', (req, res) => res.json({
  ok: true,
  database: db.kind,
  storage: storage.kind,
  version: process.env.RENDER_GIT_COMMIT || 'local',
  time: new Date().toISOString()
}));

app.post('/api/auth/register', async (req, res, next) => {
  try {
    if (isRegistrationRateLimited(req.ip)) return res.status(429).json({ error: '注册尝试次数过多，请稍后再试' });
    recordRegistrationAttempt(req.ip);
    const username = String(req.body?.username || '').trim().toLowerCase();
    const displayName = String(req.body?.displayName || '').trim();
    const password = String(req.body?.password || '');
    const inviteCode = String(req.body?.inviteCode || '');
    if (registrationInviteCode && !secretsMatch(inviteCode, registrationInviteCode)) return res.status(403).json({ error: '注册邀请码不正确' });
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) return res.status(400).json({ error: '账号只能使用 3-20 位字母、数字或下划线' });
    if (!displayName || displayName.length > 20) return res.status(400).json({ error: '昵称长度应为 1-20 位' });
    if (password.length < 8 || password.length > 128) return res.status(400).json({ error: '密码长度应为 8-128 位' });
    if (await db.findUserByUsername(username)) return res.status(409).json({ error: '该账号已存在' });

    const credential = await passwordCredential(password);
    const user = await db.createUser({
      id: crypto.randomUUID(),
      username,
      displayName,
      passwordSalt: credential.salt,
      passwordHash: credential.hash,
      createdAt: new Date().toISOString()
    });
    await startSession(res, user.id);
    res.status(201).json({ user });
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const username = String(req.body?.username || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const key = attemptKey(req, username);
    if (isRateLimited(key)) return res.status(429).json({ error: '尝试次数过多，请 15 分钟后再试' });
    const databaseUser = await db.findUserByUsername(username);
    if (!databaseUser || !await passwordMatches(password, databaseUser)) {
      recordFailedLogin(key);
      return res.status(401).json({ error: '账号或密码不正确' });
    }
    loginAttempts.delete(key);
    await startSession(res, databaseUser.id);
    res.json({ user: db.publicUser(databaseUser) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/logout', requireAuth, async (req, res, next) => {
  try {
    await db.deleteSession(tokenHash(req.auth.rawToken));
    clearSessionCookie(res);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.get('/api/auth/me', async (req, res, next) => {
  try {
    const auth = await authFromRequest(req);
    if (!auth) return res.status(401).json({ error: '未登录' });
    res.json({ user: auth.user });
  } catch (error) {
    next(error);
  }
});

app.put('/api/profile', requireAuth, async (req, res, next) => {
  try {
    const displayName = String(req.body?.displayName || '').trim();
    if (!displayName || displayName.length > 20) return res.status(400).json({ error: '昵称长度应为 1-20 位' });
    res.json({ user: await db.updateUserProfile(req.auth.user.id, displayName) });
  } catch (error) {
    next(error);
  }
});

app.put('/api/password', requireAuth, async (req, res, next) => {
  try {
    const currentPassword = String(req.body?.currentPassword || '');
    const newPassword = String(req.body?.newPassword || '');
    if (!await passwordMatches(currentPassword, req.auth.databaseUser)) return res.status(400).json({ error: '当前密码不正确' });
    if (newPassword.length < 8 || newPassword.length > 128) return res.status(400).json({ error: '新密码长度应为 8-128 位' });
    const credential = await passwordCredential(newPassword);
    await db.updateUserPassword(req.auth.user.id, credential.salt, credential.hash);
    await db.deleteUserSessions(req.auth.user.id);
    await startSession(res, req.auth.user.id);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.get('/api/bootstrap', requireAuth, async (req, res, next) => {
  try {
    res.json({ user: req.auth.user, data: await db.getBootstrap(req.auth.user.id) });
  } catch (error) {
    next(error);
  }
});

app.put('/api/data/:type', requireAuth, async (req, res, next) => {
  try {
    if (!['tasks', 'school', 'progress', 'scores', 'notes', 'focus'].includes(req.params.type)) return res.status(404).json({ error: '未知数据类型' });
    await db.replaceUserData(req.auth.user.id, req.params.type, req.body);
    res.status(204).end();
  } catch (error) {
    if (error.message.startsWith('INVALID_DATA')) return res.status(400).json({ error: '数据格式不正确' });
    next(error);
  }
});

const allowedImageTypes = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['image/gif', '.gif']
]);

app.post('/api/uploads', requireAuth, express.raw({ type: [...allowedImageTypes.keys()], limit: '8mb' }), async (req, res, next) => {
  try {
    const contentType = String(req.get('content-type') || '').split(';')[0];
    const extension = allowedImageTypes.get(contentType);
    if (!extension || !Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: '请选择有效图片' });
    const filename = `${crypto.randomUUID()}${extension}`;
    await storage.saveImage({ userId: req.auth.user.id, filename, body: req.body, contentType });
    res.status(201).json({ url: `/uploads/${req.auth.user.id}/${filename}` });
  } catch (error) {
    next(error);
  }
});

app.get('/uploads/:userId/:filename', requireAuth, async (req, res, next) => {
  try {
    if (req.params.userId !== req.auth.user.id) return res.status(403).json({ error: '无权访问该图片' });
    if (!/^[0-9a-f-]{36}\.(?:jpg|png|webp|gif)$/.test(req.params.filename)) return res.status(404).json({ error: '图片不存在' });
    const image = await storage.readImage({ userId: req.params.userId, filename: req.params.filename });
    res.setHeader('Cache-Control', 'private, max-age=2592000, immutable');
    res.type(image.contentType).send(image.body);
  } catch (error) {
    if (error.code === 'ENOENT') return res.status(404).json({ error: '图片不存在' });
    next(error);
  }
});
app.get('/', (req, res) => res.sendFile(path.join(db.projectRoot, 'index.html')));
app.get('/index.html', (req, res) => res.sendFile(path.join(db.projectRoot, 'index.html')));
app.get('/app.js', (req, res) => res.sendFile(path.join(db.projectRoot, 'app.js')));
app.get('/styles.css', (req, res) => res.sendFile(path.join(db.projectRoot, 'styles.css')));

app.use((req, res) => res.status(404).json({ error: '接口不存在' }));
app.use((error, req, res, next) => {
  console.error(error);
  if (error.type === 'entity.too.large') return res.status(413).json({ error: '上传内容过大' });
  res.status(500).json({ error: '服务器内部错误' });
});

let server;

async function startServer() {
  if (process.env.RENDER === 'true' && (db.kind !== 'postgres' || storage.kind !== 'supabase')) {
    throw new Error('Render 免费部署缺少 DATABASE_URL、SUPABASE_URL 或 SUPABASE_SECRET_KEY');
  }
  await Promise.all([db.initialize(), storage.initialize()]);
  server = app.listen(port, host, () => {
    console.log(`研途服务已启动：http://${host}:${port}（${db.kind} + ${storage.kind}）`);
  });
}

function shutdown(signal) {
  console.log(`收到 ${signal}，正在安全停止服务...`);
  if (!server) return process.exit(0);
  server.close(async () => {
    await db.closeDatabase();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));

startServer().catch(error => {
  console.error('服务启动失败：', error);
  process.exit(1);
});
