import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { durationLabel } from '../components/ui.jsx';
import { partsEtaStatus, overdueHoursLabel } from '../utils/parts.js';

// 预警分类（与后端 listAlerts severity_key 对应）
const FILTERS = [
  { key: 'all', label: '全部预警' },
  { key: 'pending_overdue', label: '待接单超时', tone: '#dc2626' },
  { key: 'parts_overdue', label: '配件已逾期', tone: '#dc2626' },
  { key: 'rejected', label: '返工未处理', tone: '#d97706' },
  { key: 'active_overdue', label: '维修超时', tone: '#d97706' },
  { key: 'parts_today', label: '配件今日到货', tone: '#2563eb' },
  { key: 'parts_upcoming', label: '配件待到货', tone: '#64748b' }
];

export default function Dashboard({ meta, onOpenTicket, refreshKey }) {
  const [s, setS] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [filter, setFilter] = useState('all');
  const [error, setError] = useState('');

  const loadOverview = useCallback(() => {
    api('/stats/overview').then(setS).catch(e => setError(e.message));
  }, []);
  const loadAlerts = useCallback(() => {
    api('/stats/alerts').then(d => setAlerts(d.alerts)).catch(() => {});
  }, []);

  // 工单操作弹窗关闭（refreshKey 变化）后重新加载
  useEffect(() => {
    loadOverview();
    loadAlerts();
  }, [refreshKey, loadOverview, loadAlerts]);

  // 定时轮询：其他用户改变工单状态时看板也能保持最新
  useEffect(() => {
    const h = setInterval(() => { loadOverview(); loadAlerts(); }, 20000);
    return () => clearInterval(h);
  }, [loadOverview, loadAlerts]);

  // 卡片数量直接由明细推导，与下方列表、筛选 chip 永远同源
  const counts = useMemo(() => {
    const m = { all: alerts.length };
    for (const a of alerts) m[a.severity_key] = (m[a.severity_key] || 0) + 1;
    return m;
  }, [alerts]);

  const sum = useMemo(() => ({
    pendingOverdue: counts.pending_overdue || 0,
    partsOverdue: counts.parts_overdue || 0,
    rejected: counts.rejected || 0,
    activeOverdue: counts.active_overdue || 0,
    partsToday: counts.parts_today || 0,
    partsUpcoming: counts.parts_upcoming || 0,
    rejectedOverdue: alerts.filter(a => a.severity_key === 'rejected' && a.overdue_minutes > 8 * 60).length
  }), [counts, alerts]);

  const shown = filter === 'all' ? alerts : alerts.filter(a => a.severity_key === filter);

  if (error) return <div className="alert alert-error">{error}</div>;
  if (!s) return <div className="loading">加载看板数据…</div>;

  const sc = s.statusCounts;
  const maxTrend = Math.max(1, ...s.trend.map(t => t.total));
  const maxCat = Math.max(1, ...s.categories.map(c => c.count));

  return (
    <div>
      <div className="stat-grid">
        <StatCard label="待接单超时（>2h）" value={sum.pendingOverdue} cls={sum.pendingOverdue ? 'danger' : 'ok'}
          onClick={() => setFilter('pending_overdue')} />
        <StatCard label="配件已逾期" value={sum.partsOverdue} cls={sum.partsOverdue ? 'danger' : 'ok'}
          onClick={() => setFilter('parts_overdue')} />
        <StatCard label="返工未处理" value={sum.rejected} cls={sum.rejected ? 'warn' : 'ok'}
          sub={sum.rejectedOverdue ? `其中 ${sum.rejectedOverdue} 笔超 8h` : ''}
          onClick={() => setFilter('rejected')} />
        <StatCard label="维修超时（>24h）" value={sum.activeOverdue} cls={sum.activeOverdue ? 'warn' : 'ok'}
          onClick={() => setFilter('active_overdue')} />
        <StatCard label="等待配件" value={sc.waiting_parts || 0}
          sub={[
            sum.partsOverdue ? `逾期 ${sum.partsOverdue}` : '',
            sum.partsToday ? `今日到货 ${sum.partsToday}` : ''
          ].filter(Boolean).join(' · ')} cls={sum.partsOverdue ? 'danger' : 'warn'} />
        <StatCard label="待我验收" value={sc.submitted || 0} />
        <StatCard label="限制售卖房间" value={`${s.blockedRooms}/${s.totalRooms}`} cls={s.blockedRooms ? 'danger' : 'ok'} />
        <StatCard label="重复报修" value={s.repeatCount} cls={s.repeatCount ? 'warn' : 'ok'} />
      </div>

      {(sum.pendingOverdue > 0 || sum.activeOverdue > 0 || sum.partsOverdue > 0 || sum.rejectedOverdue > 0) && (
        <div className="alert alert-warning">
          ⏰ 当前共 <b>{counts.all}</b> 条待办预警：待接单超时 {sum.pendingOverdue}、
          配件逾期 {sum.partsOverdue}、维修超时 {sum.activeOverdue}、
          返工超 8 小时 {sum.rejectedOverdue}。点击下方预警行可直接打开工单安排处理。
          平均维修时长 {durationLabel(s.avgMinutes)}。
        </div>
      )}

      <div className="panel">
        <div className="panel-title">
          🚨 超时与配件待办（与预警数量同一口径，共 {alerts.length} 条）
        </div>
        <div className="panel-body">
          <div className="filter-chips" style={{ marginBottom: 12 }}>
            {FILTERS.map(f => (
              <button key={f.key} className={`chip ${filter === f.key ? 'active' : ''}`}
                onClick={() => setFilter(f.key)}>
                {f.label}{counts[f.key] ? ` ${counts[f.key]}` : ''}
              </button>
            ))}
          </div>
          <AlertTable alerts={shown} meta={meta} onOpen={onOpenTicket} />
        </div>
      </div>

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
                  <div className="d">{t.day.slice(5)}</div>
                </div>
              ))}
              {s.trend.length === 0 && <div style={{ color: 'var(--text-muted)' }}>暂无数据</div>}
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-title">🔧 维修人员工作量</div>
          <div className="panel-body">
            {s.workload.map(w => (
              <div className="workload-row" key={w.id}>
                <span className="name">{w.name}</span>
                <div className="workload-bar">
                  <span style={{ width: `${Math.min(100, (w.active || 0) * 25)}%` }} />
                  <small>处理中 {w.active || 0}{w.parts_overdue ? ` · 配件逾期 ${w.parts_overdue}` : ''} · 累计完成 {w.done || 0}</small>
                </div>
                {(w.rejected_now > 0) && <span title="有验收不通过工单" style={{ color: '#dc2626' }}>↩️{w.rejected_now}</span>}
              </div>
            ))}
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
      </div>
    </div>
  );
}

function AlertTable({ alerts, meta, onOpen }) {
  if (!alerts.length) {
    return <div className="empty" style={{ padding: '28px 20px' }}>
      <div className="icon">✅</div><div>该分类暂无待办</div>
    </div>;
  }
  return (
    <div className="table-wrap" style={{ boxShadow: 'none' }}>
      <table className="data">
        <thead>
          <tr>
            <th style={{ width: 64 }}>房间</th>
            <th>工单</th>
            <th style={{ width: 90 }}>维修员</th>
            <th style={{ width: 110 }}>预警类型</th>
            <th style={{ width: 130 }}>超时时长 / 到货</th>
          </tr>
        </thead>
        <tbody>
          {alerts.map(a => {
            const tone = ALERT_META[a.severity_key] || { label: a.severity_key, color: '#64748b' };
            const ps = a.alert_type === 'waiting_parts' ? partsEtaStatus(a.parts_expected_at, meta.today) : null;
            return (
              <tr key={`${a.alert_type}-${a.id}`} onClick={() => onOpen(a.id)}
                style={['pending_overdue', 'parts_overdue'].includes(a.severity_key) ? { background: '#fff7f7' } : undefined}>
                <td><span className="room-no">{a.room_no}</span>{a.room_status === 'blocked' ? ' ⛔' : ''}</td>
                <td>
                  <div className="ticket-title">
                    <span className="ticket-code">{a.code}</span> {a.title}
                    {a.is_repeat === 1 && <span className="repeat-tag">重复</span>}
                    <div className="sub">[{a.category}]
                      {a.alert_type === 'waiting_parts' && a.parts_note ? ` ${a.parts_note.slice(0, 26)}` : ''}
                      {a.alert_type === 'rejected' && a.reject_reason ? ` 驳回原因：${a.reject_reason.slice(0, 30)}` : ''}
                    </div>
                  </div>
                </td>
                <td>{a.assigned_name || <span style={{ color: '#94a3b8' }}>未接单</span>}</td>
                <td>
                  <span className="badge" style={{ color: tone.color, background: `${tone.color}1a` }}>
                    {tone.label}
                  </span>
                </td>
                <td style={{ color: tone.color, fontWeight: 600, whiteSpace: 'nowrap' }}>
                  {ps ? (
                    <>
                      <div>{a.parts_expected_at || '未登记'}</div>
                      <div style={{ fontSize: 12 }}>{ps.label}</div>
                    </>
                  ) : a.alert_type === 'rejected' ? (
                    <>
                      <div>退回 {overdueHoursLabel(a.overdue_minutes)}</div>
                      {a.overdue_minutes > 8 * 60 && <div style={{ fontSize: 12 }}>已超 8h 未处理</div>}
                    </>
                  ) : (
                    <>已等待 {overdueHoursLabel(a.overdue_minutes)}</>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const ALERT_META = {
  pending_overdue: { label: '待接单超时', color: '#dc2626' },
  parts_overdue: { label: '配件逾期', color: '#dc2626' },
  rejected: { label: '返工待处理', color: '#d97706' },
  active_overdue: { label: '维修超时', color: '#d97706' },
  parts_today: { label: '配件今日到货', color: '#2563eb' },
  parts_upcoming: { label: '配件待到货', color: '#64748b' }
};

function StatCard({ label, value, cls, sub, onClick }) {
  return (
    <div className={`stat-card ${cls || ''}`}
      style={onClick ? { cursor: 'pointer' } : undefined}
      onClick={onClick}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}
