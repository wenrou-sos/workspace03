import { Router } from 'express';
import { db } from '../db.js';
import { auth, requireRole } from '../middleware/auth.js';

const router = Router();
router.use(auth, requireRole('supervisor'));

router.get('/overview', (req, res) => {
  const one = (sql, ...p) => db.prepare(sql).get(...p);

  const byStatus = db.prepare(`
    SELECT status, COUNT(*) AS count FROM tickets GROUP BY status
  `).all();
  const statusCounts = Object.fromEntries(byStatus.map(r => [r.status, r.count]));

  const blockedRooms = one(`SELECT COUNT(*) AS c FROM rooms WHERE status = 'blocked'`).c;
  const totalRooms = one(`SELECT COUNT(*) AS c FROM rooms`).c;

  // 平均维修时长（分钟，创建 -> 完成）
  const avg = one(`
    SELECT AVG((julianday(completed_at) - julianday(created_at)) * 24 * 60) AS v
    FROM tickets WHERE status = 'completed' AND completed_at IS NOT NULL
  `).v;

  // 超时工单：待接单 > 2 小时，或进行中 > 24 小时
  const overduePending = one(`
    SELECT COUNT(*) AS c FROM tickets
    WHERE status = 'pending' AND created_at < datetime('now','localtime','-2 hours')
  `).c;
  const overdueActive = one(`
    SELECT COUNT(*) AS c FROM tickets
    WHERE status IN ('accepted','waiting_parts','rejected')
      AND created_at < datetime('now','localtime','-1 days')
  `).c;

  // 维修人员工作量
  const workload = db.prepare(`
    SELECT u.id, u.name,
      SUM(CASE WHEN t.status NOT IN ('completed','cancelled') THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) AS done,
      SUM(CASE WHEN t.status = 'rejected' THEN 1 ELSE 0 END) AS rejected_now
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

  // 类别分布
  const categories = db.prepare(`
    SELECT category, COUNT(*) AS count FROM tickets GROUP BY category ORDER BY count DESC
  `).all();

  const repeatCount = one(`SELECT COUNT(*) AS c FROM tickets WHERE is_repeat = 1`).c;

  res.json({
    statusCounts,
    blockedRooms,
    totalRooms,
    avgMinutes: avg ? Math.round(avg) : null,
    overduePending,
    overdueActive,
    workload,
    trend,
    categories,
    repeatCount
  });
});

export default router;
