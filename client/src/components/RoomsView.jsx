import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Badge, Modal, Empty, fmtDateTimeShort } from './ui.jsx';

const STATE_COLORS = { available: '#059669', occupied: '#2563eb', blocked: '#dc2626' };

export default function RoomsView({ meta, onOpenTicket }) {
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState('');

  const load = () => {
    setLoading(true);
    api('/rooms').then(rs => { setRooms(rs); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const list = filter === 'all' ? rooms : rooms.filter(r => r.status === filter);
  const counts = {
    all: rooms.length,
    available: rooms.filter(r => r.status === 'available').length,
    occupied: rooms.filter(r => r.status === 'occupied').length,
    blocked: rooms.filter(r => r.status === 'blocked').length
  };

  if (loading) return <div className="loading">加载中…</div>;

  return (
    <div>
      {error && <div className="alert alert-error">{error}</div>}
      <div className="toolbar">
        <div className="filter-chips">
          {[['all', '全部'], ['available', '可售'], ['occupied', '在住'], ['blocked', '限制售卖']].map(([k, l]) => (
            <button key={k} className={`chip ${filter === k ? 'active' : ''}`} onClick={() => setFilter(k)}>
              {l} {counts[k]}
            </button>
          ))}
        </div>
        <div className="spacer" />
        <div className="legend">
          <span><i style={{ background: '#059669' }} />可售</span>
          <span><i style={{ background: '#2563eb' }} />在住</span>
          <span><i style={{ background: '#dc2626' }} />限制售卖</span>
          <span>● 角标 = 未完结工单数</span>
        </div>
      </div>

      <div className="room-grid">
        {list.map(r => (
          <div key={r.id} className={`room-card ${r.status}`} onClick={() => setDetail(r.id)}>
            {r.open_ticket_count > 0 && <span className="open-dot">{r.open_ticket_count}</span>}
            <div className="no">{r.room_no}</div>
            <div className="cat">{r.category} · {r.floor}F</div>
            <div className="state">
              <Badge color={STATE_COLORS[r.status]} label={meta.roomStatusLabel[r.status]} />
            </div>
            {r.status === 'blocked' && (
              <div style={{ fontSize: 11.5, color: '#991b1b', marginTop: 6, lineHeight: 1.35 }}>
                {r.block_reason?.slice(0, 22)}{r.block_reason?.length > 22 ? '…' : ''}
              </div>
            )}
          </div>
        ))}
      </div>

      {detail && (
        <RoomDetail id={detail} meta={meta}
          onClose={() => setDetail(null)} onChanged={load} onOpenTicket={onOpenTicket} />
      )}
    </div>
  );
}

function RoomDetail({ id, meta, onClose, onChanged, onOpenTicket }) {
  const [data, setData] = useState(null);
  const [mode, setMode] = useState(null);
  const [reason, setReason] = useState('');
  const [unblockRemark, setUnblockRemark] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => api(`/rooms/${id}`).then(setData).catch(e => setError(e.message));
  useEffect(() => { load(); }, [id]);

  if (error) return <Modal title="出错了" onClose={onClose}><div className="alert alert-error">{error}</div></Modal>;
  if (!data) return <Modal title="加载中…" onClose={onClose}>加载中…</Modal>;

  const { room, logs, tickets, permissions } = data;

  async function block() {
    if (!reason.trim()) return setError('请填写限制售卖原因');
    setBusy(true);
    try {
      await api(`/rooms/${id}/block`, { method: 'POST', body: { reason } });
      setMode(null); setReason('');
      await load(); onChanged();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function unblock() {
    if (!unblockRemark.trim()) return setError('请填写解除限制售卖的备注');
    setBusy(true);
    try {
      await api(`/rooms/${id}/unblock`, { method: 'POST', body: { remark: unblockRemark } });
      setMode(null);
      await load(); onChanged();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <Modal wide title={`房间 ${room.room_no} · ${room.category}`} onClose={onClose} footer={
      !mode && (permissions.canBlock || permissions.canUnblock) && (
        <>
          <button className="btn" onClick={onClose}>关闭</button>
          {room.status === 'blocked'
            ? permissions.canUnblock
              ? <button className="btn btn-success" onClick={() => { setError(''); setMode('unblock'); }}>🔓 解除限制售卖</button>
              : <button className="btn" disabled title={permissions.unblockReason || ''}>🔒 不可解除（{permissions.unblockReason}）</button>
            : permissions.canBlock
              ? <button className="btn btn-danger" onClick={() => { setError(''); setMode('block'); }}>⛔ 限制售卖</button>
              : null}
        </>
      )
    }>
      {error && <div className="alert alert-error">{error}</div>}

      <dl className="desc-grid">
        <dt>当前状态</dt><dd><Badge color={STATE_COLORS[room.status]} label={meta.roomStatusLabel[room.status]} /></dd>
        <dt>楼层 / 房型</dt><dd>{room.floor} 楼 · {room.category}</dd>
        {room.block_reason && <><dt>限制原因</dt><dd style={{ color: '#991b1b' }}>{room.block_reason}</dd></>}
        {room.blocked_at && <><dt>限制时间</dt><dd>{room.blocked_at}</dd></>}
      </dl>

      {room.status === 'blocked' && !permissions.canUnblock && permissions.unblockReason && (
        <div className="alert alert-warning" style={{ marginTop: 14 }}>
          🔒 {permissions.unblockReason}
        </div>
      )}
      {mode === 'block' && (
        <div className="callout block" style={{ marginTop: 14 }}>
          <div className="t">⛔ 设置房间为限制售卖</div>
          <div className="field" style={{ marginTop: 8 }}>
            <textarea rows={2} value={reason} onChange={e => setReason(e.target.value)}
              placeholder="限制售卖原因，如：卫生间漏水待修、等待配件等" />
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-sm" onClick={() => setMode(null)}>取消</button>
            <button className="btn btn-danger btn-sm" disabled={busy} onClick={block}>确认限制售卖</button>
          </div>
        </div>
      )}
      {mode === 'unblock' && (
        <div className="callout" style={{ marginTop: 14, background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#166534' }}>
          <div className="t">🔓 解除限制售卖</div>
          <div className="field" style={{ marginTop: 8 }}>
            <textarea rows={2} value={unblockRemark} onChange={e => setUnblockRemark(e.target.value)}
              placeholder="解除备注（必填），如：维修完成验收合格，恢复售卖" />
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-sm" onClick={() => setMode(null)}>取消</button>
            <button className="btn btn-success btn-sm" disabled={busy} onClick={unblock}>确认解除</button>
          </div>
        </div>
      )}

      <div className="section-label">该房间工单（{tickets.length}）</div>
      {tickets.length === 0 ? <Empty icon="🧾" text="暂无报修记录" /> : (
        <div className="table-wrap" style={{ boxShadow: 'none' }}>
          <table className="data">
            <tbody>
              {tickets.map(t => (
                <tr key={t.id} onClick={() => { onClose(); onOpenTicket?.(t.id); }}>
                  <td style={{ width: 130 }}><span className="ticket-code">{t.code}</span></td>
                  <td>{t.title}</td>
                  <td><Badge color={meta.statusColor[t.status]} label={meta.statusLabel[t.status]} /></td>
                  <td style={{ color: 'var(--text-muted)', fontSize: 12, whiteSpace: 'nowrap' }}>{fmtDateTimeShort(t.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="section-label">房间操作记录</div>
      <ul className="timeline">
        {logs.map(l => (
          <li key={l.id}>
            <div className="act">{
              l.action === 'room_blocked' ? '⛔ 限制售卖'
              : l.action === 'room_kept_blocked' ? '🔒 维持限制售卖'
              : '🔓 解除限制售卖'
            }</div>
            <div className="meta">{l.operator_name || '系统'}（{l.operator_role ? meta.roleLabel[l.operator_role] : ''}）· {l.created_at}</div>
            {l.remark && <div className="remark">{l.remark}</div>}
          </li>
        ))}
        {logs.length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>暂无记录</div>}
      </ul>
    </Modal>
  );
}
