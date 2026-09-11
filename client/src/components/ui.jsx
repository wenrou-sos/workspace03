// 通用展示组件
export function Badge({ color, label }) {
  return (
    <span className="badge" style={{ color, backgroundColor: `${color}1a` }}>
      {label}
    </span>
  );
}

export function PriorityTag({ priority, labels }) {
  const cls = priority === 'high' ? 'priority-high'
    : priority === 'low' ? 'priority-low' : 'priority-normal';
  return <span className={`badge ${cls}`}>{labels[priority] || priority}</span>;
}

export function Empty({ icon = '📭', text = '暂无数据' }) {
  return <div className="empty"><div className="icon">{icon}</div><div>{text}</div></div>;
}

export function Loading() {
  return <div className="loading">加载中…</div>;
}

export function Modal({ title, onClose, children, footer, wide }) {
  return (
    <div className="modal-mask" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' lg' : ''}`}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function fmtTime(s) {
  if (!s) return '—';
  // 后端返回 'YYYY-MM-DD HH:MM:SS'
  return s;
}

export function fmtDateTimeShort(s) {
  if (!s) return '—';
  const d = new Date(s.replace(' ', 'T'));
  if (isNaN(d)) return s;
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (sameDay) return `今天 ${hm}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

// 距当前已耗时（分钟 -> 人类可读）
export function elapsed(createdAt) {
  if (!createdAt) return '';
  const d = new Date(createdAt.replace(' ', 'T'));
  const mins = Math.floor((Date.now() - d) / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

export function durationLabel(minutes) {
  if (minutes == null) return '—';
  if (minutes < 60) return `${minutes} 分钟`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} 小时 ${m} 分` : `${h} 小时`;
}
