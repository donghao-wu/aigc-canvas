const express = require('express');
const crypto  = require('crypto');
const db      = require('../db');

const router = express.Router();

function canReadProjectAssets(projectId, userId) {
  if (projectId === '__global__') return true;
  return !!db.findMembership(projectId, userId);
}

function canEditProjectAssets(projectId, userId) {
  if (projectId === '__global__') return true;
  const membership = db.findMembership(projectId, userId);
  return !!membership && ['owner', 'editor'].includes(membership.role);
}

function canReadAsset(asset, userId) {
  if (!asset) return false;
  if (asset.projectId === '__global__') return true;
  return canReadProjectAssets(asset.projectId, userId);
}

function canEditAsset(asset, userId) {
  if (!asset) return false;
  if (asset.userId === userId) return true;
  return canEditProjectAssets(asset.projectId, userId);
}

// GET /api/assets?projectId=xxx  (or projectId=__global__)
router.get('/', (req, res) => {
  const { projectId } = req.query;
  if (!projectId) return res.status(400).json({ error: 'projectId is required' });
  if (!canReadProjectAssets(projectId, req.userId)) return res.status(403).json({ error: 'Forbidden' });

  const assets = projectId === '__global__'
    ? db.listGlobalAssets()
    : db.listAssetsByProject(projectId);

  res.json(assets);
});

// POST /api/assets  — create asset record (image may be generated separately)
router.post('/', (req, res) => {
  const { projectId, type, name, description, prompt, tags = [], imageUrl, savedId } = req.body;
  if (!projectId || !type || !name) {
    return res.status(400).json({ error: 'projectId, type, name are required' });
  }
  if (!['CHARACTER', 'SCENE', 'PROP'].includes(type)) {
    return res.status(400).json({ error: 'type must be CHARACTER, SCENE, or PROP' });
  }
  if (!canEditProjectAssets(projectId, req.userId)) return res.status(403).json({ error: 'Forbidden' });

  const id = crypto.randomUUID();
  db.createAsset({
    id,
    projectId,
    userId: req.userId,
    type,
    name,
    description: description || '',
    prompt:      prompt || '',
    imageUrl:    imageUrl || null,
    savedId:     savedId || null,
    tags,
    createdAt:      new Date().toISOString(),
    usedInProjects: projectId !== '__global__' ? [projectId] : [],
  });

  res.json(db.findAsset(id));
});

// PATCH /api/assets/:id/image  — update imageUrl after generation
router.patch('/:id/image', (req, res) => {
  const { imageUrl, savedId } = req.body;
  if (!imageUrl) return res.status(400).json({ error: 'imageUrl is required' });

  const asset = db.findAsset(req.params.id);
  if (!asset) return res.status(404).json({ error: 'Asset not found' });
  if (!canEditAsset(asset, req.userId)) return res.status(403).json({ error: 'Forbidden' });

  db.updateAssetImage(req.params.id, imageUrl, savedId || null);
  res.json(db.findAsset(req.params.id));
});

// PATCH /api/assets/:id/dna  — update DNA + fields
router.patch('/:id/dna', (req, res) => {
  const asset = db.findAsset(req.params.id);
  if (!asset) return res.status(404).json({ error: 'Asset not found' });
  if (!canEditAsset(asset, req.userId)) return res.status(403).json({ error: 'Forbidden' });

  const { dna, fields } = req.body;
  db.updateAssetText(req.params.id, {
    dna: dna ?? asset.dna ?? '',
    fields: fields ?? asset.fields ?? {},
  });
  res.json(db.findAsset(req.params.id));
});

// DELETE /api/assets/:id
router.delete('/:id', (req, res) => {
  const asset = db.findAsset(req.params.id);
  if (!asset) return res.status(404).json({ error: 'Asset not found' });
  if (!canEditAsset(asset, req.userId)) return res.status(403).json({ error: 'Forbidden' });

  db.deleteAsset(req.params.id);
  db.deletePromptsByAsset(req.params.id);
  res.json({ ok: true });
});

// ── asset_prompts sub-resource ─────────────────────────────────

// GET /api/assets/:id/prompts
router.get('/:id/prompts', (req, res) => {
  const asset = db.findAsset(req.params.id);
  if (!asset) return res.status(404).json({ error: 'Asset not found' });
  if (!canReadAsset(asset, req.userId)) return res.status(403).json({ error: 'Forbidden' });
  res.json(db.listPromptsByAsset(req.params.id));
});

// POST /api/assets/:id/prompts  — add a multi-angle prompt row
router.post('/:id/prompts', (req, res) => {
  const asset = db.findAsset(req.params.id);
  if (!asset) return res.status(404).json({ error: 'Asset not found' });
  if (!canEditAsset(asset, req.userId)) return res.status(403).json({ error: 'Forbidden' });

  const { label, prompt, imageUrl } = req.body;
  if (!label || !prompt) return res.status(400).json({ error: 'label and prompt are required' });

  const id = crypto.randomUUID();
  db.createAssetPrompt({ id, assetId: req.params.id, label, prompt, imageUrl: imageUrl || null });
  res.json(db.listPromptsByAsset(req.params.id));
});

// PATCH /api/assets/:id/prompts/:promptId/image  — update image after generation
router.patch('/:id/prompts/:promptId/image', (req, res) => {
  const asset = db.findAsset(req.params.id);
  if (!asset) return res.status(404).json({ error: 'Asset not found' });
  if (!canEditAsset(asset, req.userId)) return res.status(403).json({ error: 'Forbidden' });

  const { imageUrl } = req.body;
  if (!imageUrl) return res.status(400).json({ error: 'imageUrl is required' });

  db.updatePromptImage(req.params.promptId, imageUrl);
  res.json(db.listPromptsByAsset(req.params.id));
});

// DELETE /api/assets/:id/prompts/:promptId
router.delete('/:id/prompts/:promptId', (req, res) => {
  const asset = db.findAsset(req.params.id);
  if (!asset) return res.status(404).json({ error: 'Asset not found' });
  if (!canEditAsset(asset, req.userId)) return res.status(403).json({ error: 'Forbidden' });

  db.db.prepare('DELETE FROM asset_prompts WHERE id = ? AND assetId = ?').run(req.params.promptId, req.params.id);
  res.json(db.listPromptsByAsset(req.params.id));
});

// GET /api/assets/:id  — full asset with prompts
router.get('/:id', (req, res) => {
  const asset = db.findAssetWithPrompts(req.params.id);
  if (!asset) return res.status(404).json({ error: 'Asset not found' });
  if (!canReadAsset(asset, req.userId)) return res.status(403).json({ error: 'Forbidden' });
  res.json(asset);
});

module.exports = router;
