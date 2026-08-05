const fs = require('node:fs/promises');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const localRoot = process.env.UPLOAD_ROOT ? path.resolve(process.env.UPLOAD_ROOT) : path.join(projectRoot, 'uploads');
const supabaseUrl = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const supabaseSecretKey = String(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const bucket = String(process.env.SUPABASE_STORAGE_BUCKET || 'yantu-uploads');
const cloudEnabled = Boolean(supabaseUrl && supabaseSecretKey);
const mimeByExtension = new Map([
  ['.jpg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif']
]);

let supabase;

async function initialize() {
  if (!cloudEnabled) {
    await fs.mkdir(localRoot, { recursive: true });
    return;
  }
  const { createClient } = require('@supabase/supabase-js');
  supabase = createClient(supabaseUrl, supabaseSecretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  const { data: buckets, error: listError } = await supabase.storage.listBuckets();
  if (listError) throw listError;
  if (!buckets.some(item => item.name === bucket)) {
    const { error } = await supabase.storage.createBucket(bucket, {
      public: false,
      allowedMimeTypes: [...mimeByExtension.values()],
      fileSizeLimit: '8MB'
    });
    if (error) throw error;
  }
}

function objectPath(userId, filename) {
  return `${userId}/${filename}`;
}

async function saveImage({ userId, filename, body, contentType }) {
  if (cloudEnabled) {
    const arrayBuffer = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
    const { error } = await supabase.storage.from(bucket).upload(objectPath(userId, filename), arrayBuffer, {
      contentType,
      cacheControl: '2592000',
      upsert: false
    });
    if (error) throw error;
    return;
  }
  const directory = path.join(localRoot, userId);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, filename), body, { flag: 'wx' });
}

async function readImage({ userId, filename }) {
  if (cloudEnabled) {
    const { data, error } = await supabase.storage.from(bucket).download(objectPath(userId, filename));
    if (error) {
      if (Number(error.statusCode || error.status) === 404) {
        const notFound = new Error('IMAGE_NOT_FOUND');
        notFound.code = 'ENOENT';
        throw notFound;
      }
      throw error;
    }
    return {
      body: Buffer.from(await data.arrayBuffer()),
      contentType: data.type || mimeByExtension.get(path.extname(filename)) || 'application/octet-stream'
    };
  }
  return {
    body: await fs.readFile(path.join(localRoot, userId, filename)),
    contentType: mimeByExtension.get(path.extname(filename)) || 'application/octet-stream'
  };
}

module.exports = {
  kind: cloudEnabled ? 'supabase' : 'local',
  initialize,
  saveImage,
  readImage
};
