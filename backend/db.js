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

// ── Core tables ───────────────────────────────────────────────────────────────

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

  -- ── Projects (shared ownership, replaces per-user JSON files) ──────────────
  CREATE TABLE IF NOT EXISTS projects (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    ownerId       TEXT NOT NULL REFERENCES users(id),
    data          TEXT NOT NULL DEFAULT '{}',
    pipelineStage TEXT NOT NULL DEFAULT 'story_bible',
    styleConfig   TEXT NOT NULL DEFAULT '{}',
    createdAt     TEXT NOT NULL,
    updatedAt     TEXT NOT NULL,
    updatedBy     TEXT REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(ownerId);

  -- ── Collaboration: project membership ─────────────────────────────────────
  CREATE TABLE IF NOT EXISTS project_members (
    projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    userId    TEXT NOT NULL REFERENCES users(id),
    role      TEXT NOT NULL DEFAULT 'editor' CHECK(role IN ('owner','editor','viewer')),
    joinedAt  TEXT NOT NULL,
    PRIMARY KEY (projectId, userId)
  );

  CREATE INDEX IF NOT EXISTS idx_members_user ON project_members(userId);

  -- ── Tracking: per-project rolling stats ───────────────────────────────────
  CREATE TABLE IF NOT EXISTS project_stats (
    projectId       TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    agentCallCount  INTEGER NOT NULL DEFAULT 0,
    imageGenCount   INTEGER NOT NULL DEFAULT 0,
    tokenUsed       INTEGER NOT NULL DEFAULT 0,
    estimatedCost   REAL    NOT NULL DEFAULT 0.0,
    stagesCompleted TEXT    NOT NULL DEFAULT '[]',
    updatedAt       TEXT    NOT NULL
  );

  -- ── Tracking: append-only event log ───────────────────────────────────────
  CREATE TABLE IF NOT EXISTS events (
    id        TEXT    PRIMARY KEY,
    projectId TEXT    REFERENCES projects(id),
    userId    TEXT    REFERENCES users(id),
    type      TEXT    NOT NULL CHECK(type IN ('agent_call','image_gen','asset_save','stage_complete')),
    meta      TEXT    NOT NULL DEFAULT '{}',
    createdAt INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_events_project ON events(projectId, createdAt DESC);
  CREATE INDEX IF NOT EXISTS idx_events_created ON events(createdAt DESC);

  -- ── Assets (extended schema) ───────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS assets (
    id             TEXT PRIMARY KEY,
    projectId      TEXT NOT NULL,
    userId         TEXT NOT NULL,
    type           TEXT NOT NULL CHECK(type IN ('CHARACTER','SCENE','PROP')),
    name           TEXT NOT NULL,
    description    TEXT NOT NULL DEFAULT '',
    prompt         TEXT NOT NULL DEFAULT '',
    dna            TEXT NOT NULL DEFAULT '',
    fields         TEXT NOT NULL DEFAULT '{}',
    styleConfig    TEXT NOT NULL DEFAULT '{}',
    imageUrl       TEXT,
    savedId        TEXT,
    tags           TEXT NOT NULL DEFAULT '[]',
    createdAt      TEXT NOT NULL,
    usedInProjects TEXT NOT NULL DEFAULT '[]'
  );

  CREATE INDEX IF NOT EXISTS idx_assets_project ON assets(projectId);
  CREATE INDEX IF NOT EXISTS idx_assets_user    ON assets(userId);

  -- ── Asset prompts: one row per angle/variant ───────────────────────────────
  CREATE TABLE IF NOT EXISTS asset_prompts (
    id          TEXT PRIMARY KEY,
    assetId     TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    label       TEXT NOT NULL,
    prompt      TEXT NOT NULL,
    imageUrl    TEXT,
    generatedAt TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_asset_prompts_asset ON asset_prompts(assetId);
  CREATE INDEX IF NOT EXISTS idx_images_created      ON images(createdAt DESC);
`);

// ── Migrations: add new columns to existing assets table ─────────────────────
// better-sqlite3 doesn't support ALTER TABLE IF NOT EXISTS — check manually.
(function migrateAssets() {
  const cols = db.pragma('table_info(assets)').map(c => c.name);
  const toAdd = [
    ['dna',         "TEXT NOT NULL DEFAULT ''"],
    ['fields',      "TEXT NOT NULL DEFAULT '{}'"],
    ['styleConfig', "TEXT NOT NULL DEFAULT '{}'"],
  ];
  for (const [col, def] of toAdd) {
    if (!cols.includes(col)) {
      db.exec(`ALTER TABLE assets ADD COLUMN ${col} ${def}`);
    }
  }
})();

// ── Prepared statements ───────────────────────────────────────────────────────

const stmts = {
  // users
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
  listImages:  db.prepare('SELECT * FROM images ORDER BY createdAt DESC LIMIT 500'),
  findImage:   db.prepare('SELECT * FROM images WHERE id = ?'),
  deleteImage: db.prepare('DELETE FROM images WHERE id = ?'),

  // projects
  insertProject: db.prepare(`
    INSERT INTO projects (id, name, ownerId, data, pipelineStage, styleConfig, createdAt, updatedAt, updatedBy)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  findProject:       db.prepare('SELECT * FROM projects WHERE id = ?'),
  updateProjectData: db.prepare(`
    UPDATE projects SET data = ?, updatedAt = ?, updatedBy = ? WHERE id = ?
  `),
  updateProjectMeta: db.prepare(`
    UPDATE projects SET name = ?, pipelineStage = ?, styleConfig = ?, updatedAt = ?, updatedBy = ? WHERE id = ?
  `),
  deleteProject: db.prepare('DELETE FROM projects WHERE id = ?'),
  listProjectsByUser: db.prepare(`
    SELECT p.* FROM projects p
    INNER JOIN project_members pm ON pm.projectId = p.id AND pm.userId = ?
    ORDER BY p.updatedAt DESC
  `),
  listProjectsByOwner: db.prepare(
    'SELECT * FROM projects WHERE ownerId = ? ORDER BY updatedAt DESC'
  ),

  // project_members
  insertMember:        db.prepare('INSERT OR IGNORE INTO project_members (projectId, userId, role, joinedAt) VALUES (?, ?, ?, ?)'),
  deleteMember:        db.prepare('DELETE FROM project_members WHERE projectId = ? AND userId = ?'),
  listMembers:         db.prepare(`
    SELECT pm.*, u.username FROM project_members pm
    INNER JOIN users u ON u.id = pm.userId
    WHERE pm.projectId = ?
  `),
  findMembership:      db.prepare('SELECT * FROM project_members WHERE projectId = ? AND userId = ?'),

  // project_stats
  upsertStats: db.prepare(`
    INSERT INTO project_stats (projectId, agentCallCount, imageGenCount, tokenUsed, estimatedCost, stagesCompleted, updatedAt)
    VALUES (?, 0, 0, 0, 0.0, '[]', ?)
    ON CONFLICT(projectId) DO NOTHING
  `),
  incrementAgentCall: db.prepare(`
    UPDATE project_stats
    SET agentCallCount = agentCallCount + 1,
        tokenUsed = tokenUsed + ?,
        estimatedCost = estimatedCost + ?,
        updatedAt = ?
    WHERE projectId = ?
  `),
  incrementImageGen: db.prepare(`
    UPDATE project_stats
    SET imageGenCount = imageGenCount + 1, updatedAt = ?
    WHERE projectId = ?
  `),
  markStageComplete: db.prepare(`
    UPDATE project_stats
    SET stagesCompleted = json_insert(stagesCompleted, '$[#]', ?),
        updatedAt = ?
    WHERE projectId = ? AND stagesCompleted NOT LIKE '%' || ? || '%'
  `),
  findStats:      db.prepare('SELECT * FROM project_stats WHERE projectId = ?'),
  globalStats:    db.prepare(`
    SELECT
      COUNT(DISTINCT p.id)      AS projectCount,
      COUNT(DISTINCT a.id)      AS assetCount,
      SUM(ps.imageGenCount)     AS imageCount,
      SUM(ps.tokenUsed)         AS tokenTotal,
      SUM(ps.estimatedCost)     AS costTotal
    FROM projects p
    LEFT JOIN project_stats ps ON ps.projectId = p.id
    LEFT JOIN assets a         ON a.projectId = p.id
  `),

  // events
  insertEvent: db.prepare(
    'INSERT INTO events (id, projectId, userId, type, meta, createdAt) VALUES (?, ?, ?, ?, ?, ?)'
  ),
  listEventsByProject: db.prepare(
    'SELECT * FROM events WHERE projectId = ? ORDER BY createdAt DESC LIMIT 200'
  ),

  // assets
  insertAsset: db.prepare(`
    INSERT INTO assets (id, projectId, userId, type, name, description, prompt, dna, fields, styleConfig, imageUrl, savedId, tags, createdAt, usedInProjects)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  updateAssetImage:    db.prepare('UPDATE assets SET imageUrl = ?, savedId = ? WHERE id = ?'),
  updateAssetDna:      db.prepare('UPDATE assets SET dna = ? WHERE id = ?'),
  listAssetsByProject: db.prepare('SELECT * FROM assets WHERE projectId = ? ORDER BY createdAt DESC'),
  listGlobalAssets:    db.prepare("SELECT * FROM assets WHERE projectId = '__global__' ORDER BY createdAt DESC"),
  findAsset:           db.prepare('SELECT * FROM assets WHERE id = ?'),
  deleteAsset:         db.prepare('DELETE FROM assets WHERE id = ?'),
  addProjectToAsset:   db.prepare(`
    UPDATE assets
    SET usedInProjects = json_insert(usedInProjects, '$[#]', ?)
    WHERE id = ? AND json_extract(usedInProjects, '$') NOT LIKE '%' || ? || '%'
  `),

  // asset_prompts
  insertAssetPrompt: db.prepare(
    'INSERT INTO asset_prompts (id, assetId, label, prompt, imageUrl, generatedAt) VALUES (?, ?, ?, ?, ?, ?)'
  ),
  listPromptsByAsset:  db.prepare('SELECT * FROM asset_prompts WHERE assetId = ? ORDER BY rowid'),
  updatePromptImage:   db.prepare('UPDATE asset_prompts SET imageUrl = ?, generatedAt = ? WHERE id = ?'),
  deletePromptsByAsset: db.prepare('DELETE FROM asset_prompts WHERE assetId = ?'),
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseAsset(row) {
  if (!row) return null;
  return {
    ...row,
    tags:           JSON.parse(row.tags   || '[]'),
    usedInProjects: JSON.parse(row.usedInProjects || '[]'),
    fields:         JSON.parse(row.fields || '{}'),
    styleConfig:    JSON.parse(row.styleConfig || '{}'),
  };
}

function parseProject(row) {
  if (!row) return null;
  return {
    ...row,
    data:        JSON.parse(row.data        || '{}'),
    styleConfig: JSON.parse(row.styleConfig || '{}'),
  };
}

// Dual-write helper: insert event + update project_stats in one transaction.
const trackAgentCall = db.transaction((projectId, userId, agent, tokensIn, tokensOut) => {
  const cost = ((tokensIn + tokensOut) / 1_000_000) * 0.8; // rough ¥ estimate
  const now  = new Date().toISOString();
  const id   = `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  stmts.upsertStats.run(projectId, now);
  stmts.insertEvent.run(id, projectId, userId, 'agent_call',
    JSON.stringify({ agent, tokensIn, tokensOut, cost }), Date.now());
  stmts.incrementAgentCall.run(tokensIn + tokensOut, cost, now, projectId);
});

const trackImageGen = db.transaction((projectId, userId, assetId, label) => {
  const now = new Date().toISOString();
  const id  = `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  stmts.upsertStats.run(projectId, now);
  stmts.insertEvent.run(id, projectId, userId, 'image_gen',
    JSON.stringify({ assetId, label }), Date.now());
  stmts.incrementImageGen.run(now, projectId);
});

const trackStageComplete = db.transaction((projectId, userId, stageName) => {
  const now = new Date().toISOString();
  const id  = `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  stmts.upsertStats.run(projectId, now);
  stmts.insertEvent.run(id, projectId, userId, 'stage_complete',
    JSON.stringify({ stageName }), Date.now());
  stmts.markStageComplete.run(stageName, now, projectId, stageName);
  db.prepare("UPDATE projects SET pipelineStage = ?, updatedAt = ? WHERE id = ?")
    .run(stageName, now, projectId);
});

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  db,

  // ── user ops ──────────────────────────────────────────────────────────────
  findUserByUsername: (username) => stmts.findUserByUsername.get(username),
  findUserById:       (id)       => stmts.findUserById.get(id),
  listUsers:          ()         => stmts.listUsers.all(),
  createUser(id, username, passwordHash, isAdmin = 0) {
    stmts.insertUser.run(id, username, passwordHash, isAdmin ? 1 : 0, new Date().toISOString());
  },

  // ── image ops ─────────────────────────────────────────────────────────────
  persistImageRecord(id, filename, mimeType, prompt, model, imageUrl) {
    stmts.insertImage.run(id, filename, mimeType, prompt, model, 0, imageUrl, Date.now());
  },
  listImages:  () => stmts.listImages.all(),
  findImage:   (id) => stmts.findImage.get(id),
  deleteImage: (id) => stmts.deleteImage.run(id),

  // ── project ops ───────────────────────────────────────────────────────────
  createProject(project) {
    const now = new Date().toISOString();
    stmts.insertProject.run(
      project.id,
      project.name,
      project.ownerId,
      typeof project.data === 'string' ? project.data : JSON.stringify(project.data || {}),
      project.pipelineStage || 'story_bible',
      typeof project.styleConfig === 'string' ? project.styleConfig : JSON.stringify(project.styleConfig || {}),
      project.createdAt || now,
      project.updatedAt || now,
      project.ownerId,
    );
    // owner is always a member
    stmts.insertMember.run(project.id, project.ownerId, 'owner', now);
    // init stats row
    stmts.upsertStats.run(project.id, now);
    return this.findProject(project.id);
  },
  findProject(id) {
    return parseProject(stmts.findProject.get(id));
  },
  updateProjectData(id, data, userId) {
    const now = new Date().toISOString();
    stmts.updateProjectData.run(
      typeof data === 'string' ? data : JSON.stringify(data),
      now, userId, id,
    );
  },
  updateProjectMeta(id, { name, pipelineStage, styleConfig }, userId) {
    const now = new Date().toISOString();
    const existing = stmts.findProject.get(id) || {};
    stmts.updateProjectMeta.run(
      name          ?? existing.name,
      pipelineStage ?? existing.pipelineStage,
      typeof styleConfig === 'string' ? styleConfig : JSON.stringify(styleConfig ?? JSON.parse(existing.styleConfig || '{}')),
      now, userId, id,
    );
  },
  deleteProject: (id) => stmts.deleteProject.run(id),
  listProjectsForUser(userId) {
    return stmts.listProjectsByUser.all(userId).map(parseProject);
  },

  // project status (for polling)
  getProjectStatus(id) {
    const p = stmts.findProject.get(id);
    if (!p) return null;
    const members = stmts.listMembers.all(id);
    const stats   = stmts.findStats.get(id);
    return {
      updatedAt:     p.updatedAt,
      updatedBy:     p.updatedBy,
      pipelineStage: p.pipelineStage,
      members:       members.map(m => ({ userId: m.userId, username: m.username, role: m.role })),
      stagesCompleted: JSON.parse(stats?.stagesCompleted || '[]'),
    };
  },

  // ── member ops ────────────────────────────────────────────────────────────
  addMember(projectId, userId, role = 'editor') {
    stmts.insertMember.run(projectId, userId, role, new Date().toISOString());
  },
  removeMember:   (projectId, userId) => stmts.deleteMember.run(projectId, userId),
  listMembers:    (projectId)         => stmts.listMembers.all(projectId),
  findMembership: (projectId, userId) => stmts.findMembership.get(projectId, userId),

  // ── tracking ops ──────────────────────────────────────────────────────────
  trackAgentCall,
  trackImageGen,
  trackStageComplete,
  getProjectStats:  (projectId) => stmts.findStats.get(projectId),
  getGlobalStats:   ()          => stmts.globalStats.get(),
  listProjectEvents:(projectId) => stmts.listEventsByProject.all(projectId),

  // ── asset ops ─────────────────────────────────────────────────────────────
  createAsset(asset) {
    stmts.insertAsset.run(
      asset.id,
      asset.projectId,
      asset.userId,
      asset.type,
      asset.name,
      asset.description  || '',
      asset.prompt       || '',
      asset.dna          || '',
      typeof asset.fields      === 'string' ? asset.fields      : JSON.stringify(asset.fields      || {}),
      typeof asset.styleConfig === 'string' ? asset.styleConfig : JSON.stringify(asset.styleConfig || {}),
      asset.imageUrl     || null,
      asset.savedId      || null,
      JSON.stringify(asset.tags            || []),
      asset.createdAt    || new Date().toISOString(),
      JSON.stringify(asset.usedInProjects  || []),
    );
  },
  updateAssetImage(id, imageUrl, savedId) {
    stmts.updateAssetImage.run(imageUrl, savedId, id);
  },
  updateAssetDna(id, dna) {
    stmts.updateAssetDna.run(dna, id);
  },
  listAssetsByProject: (projectId) => stmts.listAssetsByProject.all(projectId).map(parseAsset),
  listGlobalAssets:    ()          => stmts.listGlobalAssets.all().map(parseAsset),
  findAsset:           (id)        => parseAsset(stmts.findAsset.get(id)),
  deleteAsset:         (id)        => stmts.deleteAsset.run(id),

  // asset with its prompts
  findAssetWithPrompts(id) {
    const asset   = parseAsset(stmts.findAsset.get(id));
    if (!asset) return null;
    asset.prompts = stmts.listPromptsByAsset.all(id);
    return asset;
  },
  listAssetsWithPrompts(projectId) {
    return stmts.listAssetsByProject.all(projectId).map(row => {
      const asset   = parseAsset(row);
      asset.prompts = stmts.listPromptsByAsset.all(asset.id);
      return asset;
    });
  },

  // ── asset_prompt ops ──────────────────────────────────────────────────────
  createAssetPrompt(prompt) {
    stmts.insertAssetPrompt.run(
      prompt.id,
      prompt.assetId,
      prompt.label,
      prompt.prompt,
      prompt.imageUrl    || null,
      prompt.generatedAt || null,
    );
  },
  updatePromptImage(id, imageUrl) {
    stmts.updatePromptImage.run(imageUrl, new Date().toISOString(), id);
  },
  listPromptsByAsset:  (assetId) => stmts.listPromptsByAsset.all(assetId),
  deletePromptsByAsset:(assetId) => stmts.deletePromptsByAsset.run(assetId),
};
