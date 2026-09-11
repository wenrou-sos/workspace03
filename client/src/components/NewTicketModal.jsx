import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Modal } from './ui.jsx';

export default function NewTicketModal({ meta, onClose, onCreated }) {
  const [rooms, setRooms] = useState([]);
  const [form, setForm] = useState({
    room_id: '', category: '', title: '', description: '', priority: 'normal', forceRepeat: false
  });
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/rooms').then(setRooms).catch(e => setError(e.message));
  }, []);

  const selectedRoom = rooms.find(r => r.id === Number(form.room_id));

  // 选择房间或类别变化时，预判重复报修
  useEffect(() => {
    if (!form.room_id || !form.category) { setConflict(null); return; }
    api(`/tickets/check-repeat?room_id=${form.room_id}&category=${encodeURIComponent(form.category)}`)
      .then(d => setConflict(d.conflict))
      .catch(() => setConflict(null));
  }, [form.room_id, form.category]);

  async function submit() {
    setError('');
    if (!form.room_id) return setError('请选择房间');
    if (!form.category) return setError('请选择故障类别');
    if (!form.title.trim()) return setError('请填写故障标题');
    if (!form.description.trim()) return setError('请填写故障描述');

    setBusy(true);
    try {
      const d = await api('/tickets', { method: 'POST', body: form });
      onCreated?.(d);
      onClose();
    } catch (e) {
      if (e.status === 409 && e.data?.conflict) {
        setConflict(e.data.conflict);
        setError(e.message);
      } else {
        setError(e.message);
      }
    } finally {
      setBusy(false);
    }
  }

  const upd = k => e => setForm({ ...form, [k]: e.target.value, forceRepeat: k === 'forceRepeat' ? e.target.checked : false });

  return (
    <Modal title="📝 新建客房报修" onClose={onClose} footer={
      <>
        <button className="btn" onClick={onClose}>取消</button>
        <button className="btn btn-primary" onClick={submit} disabled={busy}>
          {busy ? '提交中…' : '提交报修'}
        </button>
      </>
    }>
      {error && <div className="alert alert-error">{error}</div>}

      {selectedRoom?.status === 'blocked' && (
        <div className="callout block">
          <div className="t">⛔ 该房间当前为限制售卖状态</div>
          {selectedRoom.block_reason}
        </div>
      )}
      {selectedRoom?.open_ticket_count > 0 && (
        <div className="alert alert-warning">
          该房间有 {selectedRoom.open_ticket_count} 笔未完结工单。
        </div>
      )}

      <div className="form-row">
        <div className="field">
          <label>客房 *</label>
          <select value={form.room_id} onChange={upd('room_id')}>
            <option value="">请选择房间</option>
            {rooms.map(r => (
              <option key={r.id} value={r.id}>
                {r.room_no} · {r.category}
                {r.status === 'blocked' ? '（限制售卖）' : r.status === 'occupied' ? '（在住）' : '（可售）'}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>故障类别 *</label>
          <select value={form.category} onChange={upd('category')}>
            <option value="">请选择</option>
            {meta.categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      <div className="form-row">
        <div className="field">
          <label>优先级 *</label>
          <select value={form.priority} onChange={upd('priority')}>
            <option value="low">低</option>
            <option value="normal">普通</option>
            <option value="high">紧急</option>
          </select>
        </div>
        <div className="field" />
      </div>

      <div className="field">
        <label>故障标题 *</label>
        <input value={form.title} onChange={upd('title')} placeholder="例如：空调不制冷" maxLength={50} />
      </div>
      <div className="field">
        <label>详细描述 *</label>
        <textarea rows={4} value={form.description} onChange={upd('description')}
          placeholder="描述故障现象、客人反馈、房间现场情况等" />
      </div>

      {conflict && (
        <div className="callout repeat">
          <div className="t">⚠️ 系统检测到{conflict.reason === 'recur' ? '可能重复报修' : '该房间已有未完结工单'}</div>
          <div style={{ fontSize: 12.5, marginBottom: 8 }}>
            关联工单 <span className="ticket-code">{conflict.code}</span>：{conflict.title}
            （{meta.statusLabel[conflict.status]}，{conflict.created_at}）
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
            <input type="checkbox" checked={form.forceRepeat} onChange={upd('forceRepeat')} />
            我已知晓，仍要作为重复报修提交
          </label>
        </div>
      )}
    </Modal>
  );
}
