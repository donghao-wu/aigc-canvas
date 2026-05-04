/**
 * migrate.js — One-time migration: JSON project files + users.json → DB
 *
 * Run ONCE: node migrate.js
 * Safe to re-run: uses INSERT OR IGNORE / ON CONFLICT DO NOTHING.
 */

const fs   = require('fs');
const path = require('path');
const dbModule = require('./db');
const { db } = dbModule;

const PROJECTS_DIR = path.join(__dirname, 'projects');
const USERS_FILE   = path.join(__dirname, 'users.json');

let migrated = 0;
let skipped  = 0;
let errors   = 0;

// ── 1. Migrate users from users.json (legacy) ─────────────────────────────────
if (fs.existsSync(USERS_FILE)) {
  console.log('→ Migrating users.json…');
  try {
    const users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    const upsert = db.prepare(`
      INSERT OR IGNORE INTO users (id, username, passwordHash, isAdmin, createdAt)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const u of users) {
      upsert.run(u.id, u.username, u.passwordHash, u.isAdmin ? 1 : 0, u.createdAt || new Date().toISOString());
      console.log(`  ✓ user: ${u.username}`);
    }
  } catch (e) {
    console.warn('  ⚠ users.json parse error:', e.message);
  }
}

// ── 2. Find owner userId for each user folder ─────────────────────────────────
const userFolders = fs.readdirSync(PROJECTS_DIR).filter(f =>
  fs.statSync(path.join(PROJECTS_DIR, f)).isDirectory()
);

for (const folderName of userFolders) {
  // Resolve userId: folder is either userId or username
  let userId = null;
  const byId       = dbModule.findUserById(folderName);
  const byUsername = dbModule.findUserByUsername(folderName);
  if (byId)       userId = byId.id;
  else if (byUsername) userId = byUsername.id;
  else {
    // Create a placeholder user for this folder so FK constraint passes
    userId = folderName;
    try {
      db.prepare(`INSERT OR IGNORE INTO users (id, username, passwordHash, isAdmin, createdAt) VALUES (?, ?, ?, ?, ?)`)
        .run(userId, folderName, 'migrated', 0, new Date().toISOString());
      console.log(`  → Created placeholder user: ${folderName}`);
    } catch (e) {
      console.warn(`  ⚠ Could not create placeholder for ${folderName}:`, e.message);
    }
  }

  const folderPath = path.join(PROJECTS_DIR, folderName);
  const files = fs.readdirSync(folderPath).filter(f =>
    f.endsWith('.json') && !f.endsWith('_script.json') && !f.startsWith('undefined')
  );

  console.log(`\n→ Migrating ${files.length} project(s) from folder "${folderName}" (userId: ${userId})`);

  for (const file of files) {
    const filePath = path.join(folderPath, file);
    let project;
    try {
      project = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
      console.warn(`  ⚠ Could not parse ${file}:`, e.message);
      errors++;
      continue;
    }

    // Check if already migrated
    const existing = db.prepare('SELECT id FROM projects WHERE id = ?').get(project.id);
    if (existing) {
      console.log(`  ↩ skip (already exists): ${project.id}`);
      skipped++;
      continue;
    }

    // Load companion script file if it exists
    const scriptFile = path.join(folderPath, `${project.id}_script.json`);
    let scriptData = {};
    if (fs.existsSync(scriptFile)) {
      try { scriptData = JSON.parse(fs.readFileSync(scriptFile, 'utf8')); }
      catch (e) { console.warn(`  ⚠ Could not parse script file for ${project.id}`); }
    }

    // Merge canvas state + script data into the data JSON blob
    const data = {
      nodes:       project.nodes   || [],
      edges:       project.edges   || [],
      workbench:   project.workbench || {
        script: '',
        shots:  [],
        prompts: [],
        assets: [],
      },
      // Merge script fields into workbench
      ...(scriptData.storyBible    ? { storyBible:    scriptData.storyBible }    : {}),
      ...(scriptData.episodeMapText? { episodeMapText: scriptData.episodeMapText }: {}),
      ...(scriptData.episodeMap    ? { episodeMap:     scriptData.episodeMap }    : {}),
      ...(scriptData.characterBios ? { characterBios:  scriptData.characterBios } : {}),
      ...(scriptData.assetRegistry ? { assetRegistry:  scriptData.assetRegistry } : {}),
      ...(scriptData.params        ? { params:         scriptData.params }        : {}),
    };

    // Determine pipeline stage from what content exists
    let pipelineStage = 'story_bible';
    if (scriptData.assetRegistry)  pipelineStage = 'asset_registry';
    else if (scriptData.characterBios) pipelineStage = 'character_bios';
    else if (scriptData.storyBible)    pipelineStage = 'story_bible';

    try {
      const now = new Date().toISOString();
      db.prepare(`
        INSERT OR IGNORE INTO projects (id, name, ownerId, data, pipelineStage, styleConfig, createdAt, updatedAt, updatedBy)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        project.id,
        project.name || 'Untitled',
        userId,
        JSON.stringify(data),
        pipelineStage,
        JSON.stringify(project.styleConfig || {}),
        project.createdAt || now,
        project.updatedAt || now,
        userId,
      );

      // Add owner as member
      db.prepare(`INSERT OR IGNORE INTO project_members (projectId, userId, role, joinedAt) VALUES (?, ?, ?, ?)`)
        .run(project.id, userId, 'owner', project.createdAt || now);

      // Init stats row
      db.prepare(`
        INSERT OR IGNORE INTO project_stats (projectId, stagesCompleted, updatedAt)
        VALUES (?, '[]', ?)
      `).run(project.id, now);

      console.log(`  ✓ migrated: ${project.id} ("${project.name}")`);
      migrated++;
    } catch (e) {
      console.error(`  ✗ error migrating ${project.id}:`, e.message);
      errors++;
    }
  }
}

// ── 3. Summary ────────────────────────────────────────────────────────────────
console.log(`\n── Migration complete ──`);
console.log(`  Migrated : ${migrated}`);
console.log(`  Skipped  : ${skipped}`);
console.log(`  Errors   : ${errors}`);

// Verify
const count = db.prepare('SELECT COUNT(*) as c FROM projects').get();
console.log(`  Projects in DB: ${count.c}`);
