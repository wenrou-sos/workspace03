import { Router } from 'express';
import { db, listAlerts } from '../db.js';
import { auth, requireRole } from '../middleware/auth.js';

const router = Router();
router.use(auth);

// 预警明细（维修员仅看自己负责的工单；主管看全部）
router.get('/alerts', (req, res) => {
  if (req.user.role === 'maintenance') {
    return res.json({ alerts: listAlerts(req.user.id), scope: 'mine' });
  }
  if (req.user.role === 'supervisor') {
    return res.json({ alerts: listAlerts(null), scope: 'all' });
  }
  return res.status(403).json({ error: '无权限查看预警明细' });
});

// 主管看板总览 —— 超时预警数量统一取自 listAlerts，与明细同口径
router.get('/overview', requireRole('supervisor'), (req, res) => {
  const one = (sql, ...p) => db.prepare(sql).get(...p);

  const byStatus = db.prepare(`
    SELECT status, COUNT(*) AS count FROM tickets GROUP BY status
  `).all();
  const statusCounts = Object.fromEntries(byStatus.map(r => [r.status, r.count]));

  const blockedRooms = one(`SELECT COUNT(*) AS c FROM rooms WHERE status = 'blocked'`).c;
  const totalRooms = one(`SELECT COUNT(*) AS c FROM rooms`).c;

  const avg = one(`
    SELECT AVG((julianday(completed_at) - julianday(created_at)) * 24 * 60) AS v
    FROM tickets WHERE status = 'completed' AND completed_at IS NOT NULL
  `).v;

  const alerts = listAlerts(null);
  const alertsSummary = {
    pendingOverdue: alerts.filter(a => a.alert_type === 'pending_overdue').length,
    activeOverdue: alerts.filter(a => a.alert_type === 'active_overdue').length,
    rejected: alerts.filter(a => a.alert_type === 'rejected').length,
    rejectedOverdue: alerts.filter(a => a.alert_type === 'rejected' && a.overdue_minutes > 8 * 60).length,
    partsOverdue: alerts.filter(a => a.severity_key === 'parts_overdue').length,
    partsToday: alerts.filter(a => a.severity_key === 'parts_today').length,
    partsUpcoming: alerts.filter(a => a.severity_key === 'parts_upcoming').length
  };

  // 维修人员工作量
  const workload = db.prepare(`
    SELECT u.id, u.name,
      SUM(CASE WHEN t.status NOT IN ('completed','cancelled') THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) AS done,
      SUM(CASE WHEN t.status = 'rejected' THEN 1 ELSE 0 END) AS rejected_now,
      SUM(CASE WHEN t.status = 'waiting_parts' AND t.parts_expected_at IS NOT NULL
                    AND date(t.parts_expected_at) < date('now','localtime') THEN 1 ELSE 0 END) AS parts_overdue
    FROM users u LEFT JOIN tickets t ON t.assigned_to = u.id
    WHERE u.role = 'maintenance'
    GROUP BY u.id ORDER BY active DESC
  `).all();

  // 近 7 天报修趋势
  const trend = db.prepare(`
    SELECT date(created_at) AS day, COUNT(*) AS total,
      SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS done
    FROM tickets
    WHERE created_at >= datetime('now','localtime','-6 days','start of day')
    GROUP BY day ORDER BY day
  `).all();

  const categories = db.prepare(`
    SELECT category, COUNT(*) AS count FROM tickets GROUP BY category ORDER BY count DESC
  `).all();

  const repeatCount = one(`SELECT COUNT(*) AS c FROM tickets WHERE is_repeat = 1`).c;

  res.json({
    statusCounts,
    blockedRooms,
    totalRooms,
    avgMinutes: avg ? Math.round(avg) : null,
    alertsSummary,
    workload,
    trend,
    categories,
    repeatCount
  });
});

export default router;
