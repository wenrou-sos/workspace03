import { Router } from 'express';
import { db, listRooms, getRoomById, listRoomLogs, listTickets } from '../db.js';
import { auth, requireRole } from '../middleware/auth.js';

const router = Router();
router.use(auth);

// 房间列表（附带未完结工单数）
router.get('/', (req, res) => {
  const rooms = listRooms(req.query.status);
  const counts = db.prepare(`
    SELECT room_id, COUNT(*) AS c FROM tickets
    WHERE status NOT IN ('completed','cancelled') GROUP BY room_id
  `).all();
  const map = Object.fromEntries(counts.map(x => [x.room_id, x.c]));
  res.json(rooms.map(r => ({ ...r, open_ticket_count: map[r.id] || 0 })));
});

// 房间详情：含日志与工单
router.get('/:id', (req, res) => {
  const room = getRoomById(req.params.id);
  if (!room) return res.status(404).json({ error: '房间不存在' });
  res.json({
    room,
    logs: listRoomLogs(room.id),
    tickets: listTickets({ roomId: room.id }).slice(0, 20)
  });
});

// 限制售卖：前台 / 主管
router.post('/:id/block', requireRole('front_desk', 'supervisor'), (req, res) => {
  const room = getRoomById(req.params.id);
  if (!room) return res.status(404).json({ error: '房间不存在' });
  const reason = (req.body?.reason || '').trim();
  if (!reason) return res.status(400).json({ error: '请填写限制售卖原因' });

  db.prepare(`
    UPDATE rooms SET status = 'blocked', block_reason = ?, blocked_by = ?, blocked_at = datetime('now','localtime')
    WHERE id = ?
  `).run(reason, req.user.id, room.id);
  db.prepare(`INSERT INTO room_logs (room_id, action, remark, operator_id) VALUES (?, 'room_blocked', ?, ?)`)
    .run(room.id, reason, req.user.id);

  // 若有关联进行中工单，同步写一条工单日志便于追溯
  const open = db.prepare(`
    SELECT id FROM tickets WHERE room_id = ? AND status NOT IN ('completed','cancelled')
  `).all(room.id);
  const ins = db.prepare(`INSERT INTO ticket_logs (ticket_id, action, remark, operator_id) VALUES (?, 'room_blocked', ?, ?)`);
  for (const t of open) ins.run(t.id, reason, req.user.id);

  res.json({ ok: true, room: getRoomById(room.id) });
});

// 解除限制：前台 / 主管 / 维修员（维修完成后可申请解除——这里直接允许，日志留痕）
router.post('/:id/unblock', requireRole('front_desk', 'maintenance', 'supervisor'), (req, res) => {
  const room = getRoomById(req.params.id);
  if (!room) return res.status(404).json({ error: '房间不存在' });
  if (room.status !== 'blocked') return res.status(400).json({ error: '该房间当前不是限制售卖状态' });

  const remark = (req.body?.remark || '').trim() || null;
  db.prepare(`UPDATE rooms SET status = 'available', block_reason = NULL, blocked_by = NULL, blocked_at = NULL WHERE id = ?`)
    .run(room.id);
  db.prepare(`INSERT INTO room_logs (room_id, action, remark, operator_id) VALUES (?, 'room_unblocked', ?, ?)`)
    .run(room.id, remark, req.user.id);
  const open = db.prepare(`SELECT id FROM tickets WHERE room_id = ? AND status NOT IN ('completed','cancelled')`).all(room.id);
  const ins = db.prepare(`INSERT INTO ticket_logs (ticket_id, action, remark, operator_id) VALUES (?, 'room_unblocked', ?, ?)`);
  for (const t of open) ins.run(t.id, remark, req.user.id);

  res.json({ ok: true, room: getRoomById(room.id) });
});

export default router;
