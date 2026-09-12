import { Badge, PriorityTag, Empty, fmtDateTimeShort } from './ui.jsx';
import { partsEtaStatus } from '../utils/parts.js';

// 状态快捷筛选
export const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'pending', label: '待接单' },
  { key: 'active', label: '处理中' },
  { key: 'waiting_parts', label: '等待配件' },
  { key: 'submitted', label: '待验收' },
  { key: 'rejected', label: '验收不通过' },
  { key: 'completed', label: '已完成' },
  { key: 'cancelled', label: '已取消' }
];

export default function TicketList({ tickets, meta, loading, onOpen, showCreator = true, showAssignee = true }) {
  if (loading) return <div className="loading">加载中…</div>;
  if (!tickets.length) return <Empty icon="🧾" text="没有符合条件的工单" />;

  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th>工单号</th>
            <th>房间</th>
            <th>故障</th>
            <th>优先级</th>
            <th>状态</th>
            {showCreator && <th>报修人</th>}
            {showAssignee && <th>维修员</th>}
            <th>时间</th>
          </tr>
        </thead>
        <tbody>
          {tickets.map(t => {
            const parts = t.status === 'waiting_parts' ? partsEtaStatus(t.parts_expected_at, meta.today) : null;
            return (
              <tr key={t.id} onClick={() => onOpen(t.id)}
                style={parts?.level === 'overdue' ? { background: '#fff7f7' } : undefined}>
                <td>
                  <span className="ticket-code">{t.code}</span>
                  {t.is_repeat === 1 && <span className="repeat-tag" title="重复报修">重复</span>}
                </td>
                <td>
                  <span className="room-no">{t.room_no}</span>
                  {t.room_status === 'blocked' && <span title="限制售卖"> ⛔</span>}
                </td>
                <td>
                  <div className="ticket-title">
                    {t.title}
                    <div className="sub">[{t.category}] {t.description.slice(0, 30)}{t.description.length > 30 ? '…' : ''}</div>
                  </div>
                </td>
                <td><PriorityTag priority={t.priority} labels={meta.priorityLabel} /></td>
                <td>
                  <Badge color={meta.statusColor[t.status]} label={meta.statusLabel[t.status]} />
                  {parts && (
                    <div className="sub" style={{
                      fontSize: 11, marginTop: 3,
                      color: parts.color, fontWeight: parts.level === 'overdue' ? 700 : 500
                    }}>
                      📦 {t.parts_expected_at || '日期未登记'} · {parts.label}
                    </div>
                  )}
                </td>
                {showCreator && <td>{t.created_by_name}</td>}
                {showAssignee && <td>{t.assigned_name || <span style={{ color: '#94a3b8' }}>未接单</span>}</td>}
                <td style={{ whiteSpace: 'nowrap', color: 'var(--text-muted)', fontSize: 12.5 }}>
                  {fmtDateTimeShort(t.created_at)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
