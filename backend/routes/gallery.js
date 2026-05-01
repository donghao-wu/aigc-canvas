const express = require('express');
const fs      = require('fs');
const path    = require('path');
const db      = require('../db');
const storage = require('../storage');

const router = express.Router();
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

// GET /api/gallery
router.get('/', (req, res) => {
  const rows = db.listImages();
  const generated = rows.map(m => ({
    id:        m.id,
    url:       m.imageUrl || `/generated/${m.filename}`,
    prompt:    m.prompt,
    model:     m.model,
    refCount:  m.refCount || 0,
    createdAt: m.createdAt,
    source:    'generated',
  }));

  let uploaded = [];
  try {
    uploaded = fs.readdirSync(UPLOADS_DIR)
      .filter(f => /\.(jpg|jpeg|png|webp|gif)$/i.test(f))
      .map(filename => {
        const match     = filename.match(/^upload-(\d+)-/);
        const createdAt = match ? parseInt(match[1], 10) : 0;
        return { id: `upload_${filename}`, url: `/uploads/${filename}`, prompt: '', model: '', refCount: 0, createdAt, source: 'uploaded' };
      });
  } catch { /* uploads dir may not exist */ }

  const all = [...generated, ...uploaded].sort((a, b) => b.createdAt - a.createdAt);
  res.json(all);
});

// DELETE /api/gallery/:id
router.delete('/:id', async (req, res) => {
  try {
    const item = db.findImage(req.params.id);
    if (item) {
      await storage.deleteImage(item.filename);
      db.deleteImage(item.id);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('Gallery delete error:', err);
    res.status(500).json({ error: 'Delete failed' });
  }
});

module.exports = router;
