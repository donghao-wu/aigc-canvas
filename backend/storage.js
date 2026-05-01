/**
 * Storage abstraction: local filesystem (dev) or Aliyun OSS (production).
 * Switch via env: STORAGE_DRIVER=local (default) | oss
 *
 * OSS env vars (required when STORAGE_DRIVER=oss):
 *   OSS_REGION, OSS_BUCKET, OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET
 *   OSS_BASE_URL  (optional custom CDN domain, e.g. https://cdn.example.com)
 */

const fs   = require('fs');
const path = require('path');

const DRIVER = process.env.STORAGE_DRIVER || 'local';

// ── Local driver ──────────────────────────────────────────────

const GENERATED_DIR = path.join(__dirname, 'generated');
if (!fs.existsSync(GENERATED_DIR)) fs.mkdirSync(GENERATED_DIR, { recursive: true });

function localUpload(buffer, filename) {
  fs.writeFileSync(path.join(GENERATED_DIR, filename), buffer);
  return `/generated/${filename}`;
}

function localDelete(filename) {
  const fp = path.join(GENERATED_DIR, filename);
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
}

// ── OSS driver ────────────────────────────────────────────────

let ossClient = null;

function getOSSClient() {
  if (ossClient) return ossClient;
  const OSS = require('ali-oss');
  ossClient = new OSS({
    region:          process.env.OSS_REGION,
    bucket:          process.env.OSS_BUCKET,
    accessKeyId:     process.env.OSS_ACCESS_KEY_ID,
    accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
  });
  return ossClient;
}

async function ossUpload(buffer, filename) {
  const client = getOSSClient();
  const key    = `aigc-canvas/${filename}`;
  await client.put(key, buffer);
  const baseUrl = process.env.OSS_BASE_URL
    || `https://${process.env.OSS_BUCKET}.${process.env.OSS_REGION}.aliyuncs.com`;
  return `${baseUrl}/${key}`;
}

async function ossDelete(filename) {
  const client = getOSSClient();
  await client.delete(`aigc-canvas/${filename}`);
}

// ── Public API ────────────────────────────────────────────────

/**
 * Upload image from base64 string.
 * Returns the public URL (local path or OSS https://).
 */
async function uploadImageBase64(base64, mimeType, id) {
  const ext      = mimeType.includes('png') ? 'png' : 'jpg';
  const filename = `${id}.${ext}`;
  const buffer   = Buffer.from(base64, 'base64');

  if (DRIVER === 'oss') {
    return ossUpload(buffer, filename);
  }
  return localUpload(buffer, filename);
}

/**
 * Delete image by its storage id (the bare filename without path).
 */
async function deleteImage(filename) {
  if (DRIVER === 'oss') {
    return ossDelete(filename);
  }
  localDelete(filename);
}

module.exports = { uploadImageBase64, deleteImage, GENERATED_DIR };
