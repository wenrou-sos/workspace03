import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { durationLabel } from '../components/ui.jsx';

export default function Dashboard({ meta, onOpenTicket, pendingCount, submittedCount }) {
  const [s, setS] = useState(null);
  const [recent, setRecent] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/stats/overview').then(setS).catch(e => setError(e.message));
    Promise.all([api('/tickets?status=active'), api('/tickets?status=pending')])
      .then(([active, pending]) => setRecent([...pending, ...active]));
  }, []);

  if (error) return <div className="alert alert-error">{error}</div>;
  if (!s) return <div className="loading">加载看板数据…</div>;

  const sc = s.statusCounts;
  const maxTrend = Math.max(1, ...s.trend.map(t => t.total));
  const days = s.trend.map(t => t.day.slice(5));
  const maxCat = Math.max(1, ...s.categories.map(c => c.count));

  return (
    <div>
      <div className="stat-grid">
        <StatCard label="待接单" value={sc.pending || 0} cls={pendingCount > 0 ? 'warn' : ''} />
        <StatCard label="等待配件" value={sc.waiting_parts || 0} cls="warn" />
        <StatCard label="待我验收" value={sc.submitted || 0} cls={submittedCount > 0 ? 'danger' : ''} />
        <StatCard label="验收不通过" value={sc.rejected || 0} cls="danger" />
        <StatCard label="处理中" value={(sc.accepted || 0) + (sc.waiting_parts || 0) + (sc.rejected || 0)} />
        <StatCard label="已完成" value={sc.completed || 0} cls="ok" />
        <StatCard label="限制售卖房间" value={`${s.blockedRooms}/${s.totalRooms}`} cls={s.blockedRooms ? 'danger' : 'ok'} />
        <StatCard label="重复报修" value={s.repeatCount} cls={s.repeatCount ? 'warn' : 'ok'} />
      </div>

      {(s.overduePending > 0 || s.overdueActive > 0) && (
        <div className="alert alert-warning">
          ⏰ 预警：{s.overduePending} 笔待接单工单已超过 2 小时；{s.overdueActive} 笔处理中工单已超过 24 小时，请关注。
          平均维修时长 {durationLabel(s.avgMinutes)}。
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }} className="dash-cols">
        <div className="panel">
          <div className="panel-title">📈 近 7 天报修趋势</div>
          <div className="panel-body">
            <div className="barchart">
              {s.trend.map((t, i) => (
                <div className="bar-col" key={i}>
                  <div className="bar" style={{ height: `${(t.total / maxTrend) * 100}px` }}>
                    <span className="n">{t.total}</span>
                  </div>
                  <div className="d">{days[i]}</div>
                </div>
              ))}
              {s.trend.length === 0 && <div style={{ color: 'var(--text-muted)' }}>暂无数据</div>}
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-title">🔧 维修人员工作量</div>
          <div className="panel-body">
            {s.workload.map(w => {
              const total = (w.active || 0) + (w.done || 0);
              return (
                <div className="workload-row" key={w.id}>
                  <span className="name">{w.name}</span>
                  <div className="workload-bar">
                    <span style={{ width: `${Math.min(100, (w.active || 0) * 25)}%` }} />
                    <small>处理中 {w.active || 0} · 累计完成 {w.done || 0}</small>
                  </div>
                  {(w.rejected_now > 0) && <span title="有验收不通过工单" style={{ color: '#dc2626' }}>↩️{w.rejected_now}</span>}
                </div>
              );
            })}
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10 }}>
              团队共完成 {s.workload.reduce((a, w) => a + (w.done || 0), 0)} 笔工单，
              平均维修时长 {durationLabel(s.avgMinutes)}
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-title">🏷️ 故障类别分布</div>
          <div className="panel-body">
            {s.categories.map(c => (
              <div className="workload-row" key={c.category}>
                <span className="name">{c.category}</span>
                <div className="workload-bar">
                  <span style={{ width: `${(c.count / maxCat) * 100}%`, background: 'linear-gradient(90deg,#d97706,#b8860b)' }} />
                  <small>{c.count} 笔</small>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel-title">⏳ 超时 / 待关注工单</div>
          <div className="panel-body" style={{ padding: 0 }}>
            <table className="data">
              <tbody>
                {recent.filter(t =>
                  t.status === 'pending' || t.status === 'rejected' || t.is_repeat === 1
                ).slice(0, 6).map(t => (
                  <tr key={t.id} onClick={() => onOpenTicket(t.id)}>
                    <td style={{ width: 70 }}><span className="room-no">{t.room_no}</span></td>
                    <td>
                      {t.title}
                      {t.is_repeat === 1 && <span className="repeat-tag">重复</span>}
                    </td>
                    <td style={{ width: 80 }}>
                      <span className="badge" style={{
                        color: meta.statusColor[t.status], background: `${meta.statusColor[t.status]}1a`
                      }}>{meta.statusLabel[t.status]}</span>
                    </td>
                  </tr>
                ))}
                {recent.filter(t => t.status === 'pending' || t.status === 'rejected' || t.is_repeat === 1).length === 0 && (
                  <tr><td><div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>暂无重点关注工单 ✅</div></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, cls }) {
  return (
    <div className={`stat-card ${cls || ''}`}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  );
}
