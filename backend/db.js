const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'aigc.db');

// ensure data dir exists
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

// WAL mode: much better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id          TEXT PRIMARY KEY,
    username    TEXT UNIQUE NOT NULL,
    passwordHash TEXT NOT NULL,
    isAdmin     INTEGER DEFAULT 0,
    createdAt   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS images (
    id        TEXT PRIMARY KEY,
    filename  TEXT NOT NULL,
    mimeType  TEXT NOT NULL,
    prompt    TEXT NOT NULL,
    model     TEXT NOT NULL,
    refCount  INTEGER DEFAULT 0,
    imageUrl  TEXT,
    createdAt INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS assets (
    id             TEXT PRIMARY KEY,
    projectId      TEXT NOT NULL,
    userId         TEXT NOT NULL,
    type           TEXT NOT NULL CHECK(type IN ('CHARACTER','SCENE','PROP')),
    name           TEXT NOT NULL,
    description    TEXT NOT NULL DEFAULT '',
    prompt         TEXT NOT NULL DEFAULT '',
    imageUrl       TEXT,
    savedId        TEXT,
    tags           TEXT NOT NULL DEFAULT '[]',
    createdAt      TEXT NOT NULL,
    usedInProjects TEXT NOT NULL DEFAULT '[]'
  );

  CREATE INDEX IF NOT EXISTS idx_assets_project ON assets(projectId);
  CREATE INDEX IF NOT EXISTS idx_assets_user    ON assets(userId);
  CREATE INDEX IF NOT EXISTS idx_images_created ON images(createdAt DESC);
`);

// ── Users ─────────────────────────────────────────────────────

const stmts = {
  findUserByUsername: db.prepare('SELECT * FROM users WHERE username = ?'),
  findUserById:       db.prepare('SELECT * FROM users WHERE id = ?'),
  insertUser:         db.prepare(
    'INSERT INTO users (id, username, passwordHash, isAdmin, createdAt) VALUES (?, ?, ?, ?, ?)'
  ),
  listUsers: db.prepare('SELECT id, username, isAdmin, createdAt FROM users ORDER BY createdAt'),

  // images
  insertImage: db.prepare(
    'INSERT INTO images (id, filename, mimeType, prompt, model, refCount, imageUrl, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ),
  listImages:   db.prepare('SELECT * FROM images ORDER BY createdAt DESC LIMIT 500'),
  findImage:    db.prepare('SELECT * FROM images WHERE id = ?'),
  deleteImage:  db.prepare('DELETE FROM images WHERE id = ?'),

  // assets
  insertAsset: db.prepare(`
    INSERT INTO assets (id, projectId, userId, type, name, description, prompt, imageUrl, savedId, tags, createdAt, usedInProjects)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  updateAssetImage: db.prepare('UPDATE assets SET imageUrl = ?, savedId = ? WHERE id = ?'),
  listAssetsByProject: db.prepare('SELECT * FROM assets WHERE projectId = ? ORDER BY createdAt DESC'),
  listGlobalAssets:    db.prepare("SELECT * FROM assets WHERE projectId = '__global__' ORDER BY createdAt DESC"),
  findAsset:           db.prepare('SELECT * FROM assets WHERE id = ?'),
  deleteAsset:         db.prepare('DELETE FROM assets WHERE id = ?'),
  addProjectToAsset:   db.prepare(`
    UPDATE assets
    SET usedInProjects = json_insert(usedInProjects, '$[#]', ?)
    WHERE id = ? AND json_extract(usedInProjects, '$') NOT LIKE '%' || ? || '%'
  `),
};

function parseAsset(row) {
  if (!row) return null;
  return {
    ...row,
    tags:           JSON.parse(row.tags || '[]'),
    usedInProjects: JSON.parse(row.usedInProjects || '[]'),
  };
}

module.exports = {
  db,

  // ── user ops ──────────────────────────────────────────────
  findUserByUsername: (username) => stmts.findUserByUsername.get(username),
  findUserById:       (id)       => stmts.findUserById.get(id),
  listUsers:          ()         => stmts.listUsers.all(),
  createUser(id, username, passwordHash, isAdmin = 0) {
    stmts.insertUser.run(id, username, passwordHash, isAdmin ? 1 : 0, new Date().toISOString());
  },

  // ── image ops ─────────────────────────────────────────────
  persistImageRecord(id, filename, mimeType, prompt, model, imageUrl) {
    stmts.insertImage.run(id, filename, mimeType, prompt, model, 0, imageUrl, Date.now());
  },
  listImages:  () => stmts.listImages.all(),
  findImage:   (id) => stmts.findImage.get(id),
  deleteImage: (id) => stmts.deleteImage.run(id),

  // ── asset ops ─────────────────────────────────────────────
  createAsset(asset) {
    stmts.insertAsset.run(
      asset.id,
      asset.projectId,
      asset.userId,
      asset.type,
      asset.name,
      asset.description || '',
      asset.prompt || '',
      asset.imageUrl || null,
      asset.savedId || null,
      JSON.stringify(asset.tags || []),
      asset.createdAt || new Date().toISOString(),
      JSON.stringify(asset.usedInProjects || []),
    );
  },
  updateAssetImage(id, imageUrl, savedId) {
    stmts.updateAssetImage.run(imageUrl, savedId, id);
  },
  listAssetsByProject: (projectId) => stmts.listAssetsByProject.all(projectId).map(parseAsset),
  listGlobalAssets:    ()          => stmts.listGlobalAssets.all().map(parseAsset),
  findAsset:           (id)        => parseAsset(stmts.findAsset.get(id)),
  deleteAsset:         (id)        => stmts.deleteAsset.run(id),
};
