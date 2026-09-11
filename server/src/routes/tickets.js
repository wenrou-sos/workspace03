import { Router } from 'express';
import {
  db, findTicketById, listTickets, listLogs,
  getRoomById, findOpenTicketForRoom
} from '../db.js';
import { auth, requireRole } from '../middleware/auth.js';
import { STATUS, CATEGORIES } from '../constants.js';

const router = Router();
router.use(auth);

function nextCode() {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const row = db.prepare(
    `SELECT COUNT(*) AS c FROM tickets WHERE code LIKE ?`
  ).get(`BX${day}-%`);
  return `BX${day}-${String(row.c + 1).padStart(3, '0')}`;
}

// 写工单操作日志
function addLog(ticketId, action, remark, operatorId) {
  db.prepare(`INSERT INTO ticket_logs (ticket_id, action, remark, operator_id) VALUES (?,?,?,?)`)
    .run(ticketId, action, remark ?? null, operatorId);
}

// ---------- 重复报修预判 ----------
router.get('/check-repeat', (req, res) => {
  const roomId = Number(req.query.room_id);
  if (!roomId) return res.json({ conflict: null });
  const open = findOpenTicketForRoom(roomId);
  if (open) {
    return res.json({
      conflict: { ...findTicketById(open.id), reason: 'open' },
      message: '该房间已有未完结工单，是否仍要重复报修？'
    });
  }
  // 7 天内同房间、同类别已完成工单
  const recent = db.prepare(`
    SELECT * FROM tickets
    WHERE room_id = ? AND status = 'completed'
      AND completed_at >= datetime('now','localtime','-7 days')
      AND category = ?
    ORDER BY completed_at DESC LIMIT 1
  `).get(roomId, req.query.category || '');
  if (recent) {
    return res.json({
      conflict: { ...findTicketById(recent.id), reason: 'recur' },
      message: '该房间同类故障 7 天内维修过，可能复发，是否继续报修？'
    });
  }
  res.json({ conflict: null });
});

// ---------- 工单列表 ----------
router.get('/', (req, res) => {
  const { status, room_id, assignee, mine, search } = req.query;
  const filter = {};
  if (status) filter.status = status;
  if (room_id) filter.roomId = Number(room_id);
  if (search) filter.search = search;
  if (assignee === 'me') filter.assigneeId = req.user.id;
  if (mine === '1') filter.creatorId = req.user.id;
  res.json(listTickets(filter));
});

// ---------- 工单详情 ----------
router.get('/:id', (req, res) => {
  const tk = findTicketById(req.params.id);
  if (!tk) return res.status(404).json({ error: '工单不存在' });
  res.json({ ticket: tk, logs: listLogs(tk.id) });
});

// ---------- 创建报修 ----------
router.post('/', requireRole('front_desk', 'supervisor'), (req, res) => {
  const { room_id, room_no, category, title, description, priority, forceRepeat } = req.body || {};
  let room;
  if (room_id) room = getRoomById(Number(room_id));
  else if (room_no) room = db.prepare(`SELECT * FROM rooms WHERE room_no = ?`).get(String(room_no).trim());
  if (!room) return res.status(400).json({ error: '请选择有效的客房' });
  if (!CATEGORIES.includes(category)) return res.status(400).json({ error: '请选择故障类别' });
  if (!title?.trim()) return res.status(400).json({ error: '请填写故障标题' });
  if (!description?.trim()) return res.status(400).json({ error: '请填写故障描述' });
  const pri = ['low', 'normal', 'high'].includes(priority) ? priority : 'normal';

  // 重复报修判定
  let linked = null;
  const open = findOpenTicketForRoom(room.id);
  if (open) linked = open;
  if (!linked) {
    linked = db.prepare(`
      SELECT * FROM tickets WHERE room_id = ? AND status = 'completed'
        AND completed_at >= datetime('now','localtime','-7 days') AND category = ?
      ORDER BY completed_at DESC LIMIT 1
    `).get(room.id, category);
  }
  if (linked && !forceRepeat) {
    return res.status(409).json({
      error: linked.status === 'completed'
        ? '该房间同类故障 7 天内维修过，确认复发请再次提交'
        : '该房间已有未完结工单，确认重复报修请再次提交',
      conflict: { ...findTicketById(linked.id), reason: linked.status === 'completed' ? 'recur' : 'open' },
      conflictType: linked.status === 'completed' ? 'recur' : 'open'
    });
  }

  const code = nextCode();
  const result = db.transaction(() => {
    const id = db.prepare(`
      INSERT INTO tickets (code, room_id, category, title, description, priority, created_by, is_repeat, linked_ticket_id)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(code, room.id, category, title.trim(), description.trim(), pri, req.user.id, linked ? 1 : 0, linked?.id ?? null)
      .lastInsertRowid;
    addLog(id, 'created', null, req.user.id);
    if (linked) addLog(id, 'flagged',
      linked.status === 'completed' ? '7 日内同类故障复发，系统标记为重复报修。' : '该房间存在未完结工单，系统标记为重复报修。',
      req.user.id);
    return id;
  })();

  res.status(201).json({ ticket: findTicketById(result), logs: listLogs(result) });
});

// ---------- 接单 ----------
router.post('/:id/accept', requireRole('maintenance'), (req, res) => {
  const tk = findTicketById(req.params.id);
  if (!tk) return res.status(404).json({ error: '工单不存在' });
  if (![STATUS.PENDING, STATUS.REJECTED].includes(tk.status)) {
    return res.status(400).json({ error: '当前工单状态不可接单' });
  }
  const out = db.transaction(() => {
    db.prepare(`UPDATE tickets SET status = 'accepted', assigned_to = ?,
       accepted_at = COALESCE(accepted_at, datetime('now','localtime')) WHERE id = ?`)
      .run(req.user.id, tk.id);
    addLog(tk.id, 'accepted', req.body?.remark?.trim() || null, req.user.id);
    return findTicketById(tk.id);
  })();
  res.json({ ticket: out, logs: listLogs(tk.id) });
});

// ---------- 等待配件 ----------
router.post('/:id/waiting-parts', requireRole('maintenance'), (req, res) => {
  const tk = findTicketById(req.params.id);
  if (!tk) return res.status(404).json({ error: '工单不存在' });
  if (tk.assigned_to !== req.user.id) return res.status(403).json({ error: '只能操作自己接的工单' });
  if (![STATUS.ACCEPTED, STATUS.REJECTED].includes(tk.status)) {
    return res.status(400).json({ error: '仅维修中的工单可申请等待配件' });
  }
  const note = (req.body?.parts_note || '').trim();
  if (!note) return res.status(400).json({ error: '请填写所需配件及预计到货时间' });
  db.transaction(() => {
    db.prepare(`UPDATE tickets SET status = 'waiting_parts', parts_note = ? WHERE id = ?`).run(note, tk.id);
    addLog(tk.id, 'waiting_parts', note, req.user.id);
  })();
  res.json({ ticket: findTicketById(tk.id), logs: listLogs(tk.id) });
});

// ---------- 配件到位，恢复维修 ----------
router.post('/:id/resume', requireRole('maintenance'), (req, res) => {
  const tk = findTicketById(req.params.id);
  if (!tk) return res.status(404).json({ error: '工单不存在' });
  if (tk.assigned_to !== req.user.id) return res.status(403).json({ error: '只能操作自己接的工单' });
  if (tk.status !== STATUS.WAITING_PARTS) return res.status(400).json({ error: '仅等待配件中的工单可恢复' });
  db.transaction(() => {
    db.prepare(`UPDATE tickets SET status = 'accepted' WHERE id = ?`).run(tk.id);
    addLog(tk.id, 'parts_arrived', req.body?.remark?.trim() || '配件已到位，恢复维修。', req.user.id);
  })();
  res.json({ ticket: findTicketById(tk.id), logs: listLogs(tk.id) });
});

// ---------- 提交验收 ----------
router.post('/:id/submit', requireRole('maintenance'), (req, res) => {
  const tk = findTicketById(req.params.id);
  if (!tk) return res.status(404).json({ error: '工单不存在' });
  if (tk.assigned_to !== req.user.id) return res.status(403).json({ error: '只能操作自己接的工单' });
  if (![STATUS.ACCEPTED, STATUS.WAITING_PARTS, STATUS.REJECTED].includes(tk.status)) {
    return res.status(400).json({ error: '当前状态不能提交验收' });
  }
  const resolution = (req.body?.resolution || '').trim() || tk.resolution;
  if (!resolution) return res.status(400).json({ error: '请填写维修处理说明' });
  db.transaction(() => {
    db.prepare(`UPDATE tickets SET status = 'submitted', resolution = ?, reject_reason = NULL WHERE id = ?`)
      .run(resolution, tk.id);
    addLog(tk.id, 'submitted', resolution, req.user.id);
  })();
  res.json({ ticket: findTicketById(tk.id), logs: listLogs(tk.id) });
});

// ---------- 主管验收通过 ----------
router.post('/:id/complete', requireRole('supervisor'), (req, res) => {
  const tk = findTicketById(req.params.id);
  if (!tk) return res.status(404).json({ error: '工单不存在' });
  if (tk.status !== STATUS.SUBMITTED) return res.status(400).json({ error: '仅待验收工单可验收通过' });
  db.transaction(() => {
    db.prepare(`UPDATE tickets SET status = 'completed', completed_at = datetime('now','localtime') WHERE id = ?`)
      .run(tk.id);
    addLog(tk.id, 'completed', req.body?.remark?.trim() || null, req.user.id);
    // 验收通过后若房间仍被限制，自动解除售卖
    const room = getRoomById(tk.room_id);
    if (room.status === 'blocked') {
      db.prepare(`UPDATE rooms SET status = 'available', block_reason = NULL, blocked_by = NULL, blocked_at = NULL WHERE id = ?`)
        .run(room.id);
      db.prepare(`INSERT INTO room_logs (room_id, action, remark, operator_id) VALUES (?, 'room_unblocked', '验收通过自动解除限制售卖', ?)`)
        .run(room.id, req.user.id);
      addLog(tk.id, 'room_unblocked', '验收通过，房间自动解除限制售卖。', req.user.id);
    }
  })();
  res.json({ ticket: findTicketById(tk.id), logs: listLogs(tk.id) });
});

// ---------- 主管验收不通过 ----------
router.post('/:id/reject', requireRole('supervisor'), (req, res) => {
  const tk = findTicketById(req.params.id);
  if (!tk) return res.status(404).json({ error: '工单不存在' });
  if (tk.status !== STATUS.SUBMITTED) return res.status(400).json({ error: '仅待验收工单可驳回' });
  const reason = (req.body?.reject_reason || '').trim();
  if (!reason) return res.status(400).json({ error: '请填写不通过原因' });
  db.transaction(() => {
    db.prepare(`UPDATE tickets SET status = 'rejected', reject_reason = ? WHERE id = ?`).run(reason, tk.id);
    addLog(tk.id, 'rejected', reason, req.user.id);
  })();
  res.json({ ticket: findTicketById(tk.id), logs: listLogs(tk.id) });
});

// ---------- 取消 ----------
router.post('/:id/cancel', requireRole('front_desk', 'supervisor'), (req, res) => {
  const tk = findTicketById(req.params.id);
  if (!tk) return res.status(404).json({ error: '工单不存在' });
  if (req.user.role === 'front_desk' && tk.created_by !== req.user.id) {
    return res.status(403).json({ error: '只能取消本人提交的工单' });
  }
  if ([STATUS.COMPLETED, STATUS.CANCELLED].includes(tk.status)) {
    return res.status(400).json({ error: '该工单已完结，不能取消' });
  }
  const remark = (req.body?.remark || '').trim();
  if (!remark) return res.status(400).json({ error: '请填写取消原因' });
  db.transaction(() => {
    db.prepare(`UPDATE tickets SET status = 'cancelled' WHERE id = ?`).run(tk.id);
    addLog(tk.id, 'cancelled', remark, req.user.id);
  })();
  res.json({ ticket: findTicketById(tk.id), logs: listLogs(tk.id) });
});

export default router;
