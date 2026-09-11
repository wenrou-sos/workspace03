import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db, findUserByUsername, listUsers } from '../db.js';
import { signToken, auth, requireRole } from '../middleware/auth.js';
import { ROLE_LABEL } from '../constants.js';

const router = Router();

// 登录
router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: '请输入账号和密码' });
  }
  const user = findUserByUsername(username.trim());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: '账号或密码错误' });
  }
  const safe = { id: user.id, username: user.username, name: user.name, role: user.role };
  res.json({ token: signToken(safe), user: safe, roleLabel: ROLE_LABEL[user.role] });
});

// 当前用户
router.get('/me', auth, (req, res) => {
  res.json({ user: req.user, roleLabel: ROLE_LABEL[req.user.role] });
});

// 用户列表（主管可看，用于分派/筛选）
router.get('/', auth, requireRole('supervisor'), (req, res) => {
  res.json(listUsers(req.query.role));
});

// 修改密码（所有登录用户）
router.post('/change-password', auth, (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: '新密码至少 6 位' });
  }
  const full = findUserByUsername(req.user.username);
  if (!bcrypt.compareSync(oldPassword || '', full.password_hash)) {
    return res.status(400).json({ error: '原密码不正确' });
  }
  db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`)
    .run(bcrypt.hashSync(newPassword, 10), req.user.id);
  res.json({ ok: true });
});

export default router;
