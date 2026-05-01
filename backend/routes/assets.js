const express = require('express');
const crypto  = require('crypto');
const db      = require('../db');

const router = express.Router();

// GET /api/assets?projectId=xxx  (or projectId=__global__)
router.get('/', (req, res) => {
  const { projectId } = req.query;
  if (!projectId) return res.status(400).json({ error: 'projectId is required' });

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
  if (asset.userId !== req.userId) return res.status(403).json({ error: 'Forbidden' });

  db.updateAssetImage(req.params.id, imageUrl, savedId || null);
  res.json(db.findAsset(req.params.id));
});

// DELETE /api/assets/:id
router.delete('/:id', (req, res) => {
  const asset = db.findAsset(req.params.id);
  if (!asset) return res.status(404).json({ error: 'Asset not found' });
  if (asset.userId !== req.userId) return res.status(403).json({ error: 'Forbidden' });

  db.deleteAsset(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
