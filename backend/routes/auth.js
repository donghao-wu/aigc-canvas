const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const fs       = require('fs');
const path     = require('path');
const db       = require('../db');

const router     = express.Router();
function requireSecretEnv(name) {
  const value = process.env[name];
  if (!value || value.startsWith('your-') || value.startsWith('changeme-')) {
    throw new Error(`${name} must be set in backend/.env with a strong random value`);
  }
  return value;
}

const JWT_SECRET   = requireSecretEnv('JWT_SECRET');
const ADMIN_SECRET = requireSecretEnv('ADMIN_SECRET');
const PROJECTS_ROOT = path.join(__dirname, '..', 'projects');

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: '用户名和密码不能为空' });

  const user = db.findUserByUsername(username);
  if (!user) return res.status(401).json({ error: '用户名或密码错误' });

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: '用户名或密码错误' });

  const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, username: user.username });
});

// POST /api/admin/create-user  (mounted at /api/admin → /create-user)
router.post('/create-user', async (req, res) => {
  if (req.headers['x-admin-secret'] !== ADMIN_SECRET) {
    return res.status(403).json({ error: '无权限' });
  }
  const { username, password, isAdmin = false } = req.body;
  if (!username || !password) return res.status(400).json({ error: '用户名和密码不能为空' });

  if (db.findUserByUsername(username)) return res.status(409).json({ error: '用户名已存在' });

  const passwordHash = await bcrypt.hash(password, 10);
  const id = `user_${Date.now()}`;
  db.createUser(id, username, passwordHash, isAdmin);

  // create per-user project directory
  const dir = path.join(PROJECTS_ROOT, id);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  res.json({ ok: true, id, username });
});

// GET /api/admin/users
router.get('/users', (req, res) => {
  if (req.headers['x-admin-secret'] !== ADMIN_SECRET) {
    return res.status(403).json({ error: '无权限' });
  }
  res.json(db.listUsers());
});

module.exports = router;
