import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Modal, Badge, PriorityTag, fmtDateTimeShort, elapsed } from './ui.jsx';
import { partsEtaStatus, overdueHoursLabel, todayStr } from '../utils/parts.js';

const ACTION_ICONS = {
  created: '📝', accepted: '🔧', waiting_parts: '📦', parts_arrived: '📥',
  submitted: '🔍', rejected: '↩️', completed: '✅', cancelled: '🚫',
  room_blocked: '⛔', room_unblocked: '🔓', room_kept_blocked: '🔒', flagged: '⚠️'
};

export default function TicketDetail({ ticketId, meta, onClose, onChanged }) {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState(null); // 当前展开的操作表单
  const [form, setForm] = useState({});

  const load = () => {
    api(`/tickets/${ticketId}`).then(setData).catch(e => setError(e.message));
  };
  useEffect(load, [ticketId]);

  if (error) {
    return (
      <Modal title="出错了" onClose={onClose}>
        <div className="alert alert-error">{error}</div>
      </Modal>
    );
  }
  if (!data) return <Modal title="加载中…" onClose={onClose}>加载工单详情中…</Modal>;

  const { ticket: t, logs } = data;
  const isMine = t.assigned_to === user.id;
  const isCreator = t.created_by === user.id;
  const closed = ['completed', 'cancelled'].includes(t.status);

  async function act(path, payload, successMsg) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const d = await api(path, { method: 'POST', body: payload });
      setData(d);
      setMode(null);
      setForm({});
      if (d.autoUnblocked === false && Array.isArray(d.remainingOpenTickets) && d.remainingOpenTickets.length > 0) {
        setNotice(`工单已验收通过，但该房间还有 ${d.remainingOpenTickets.length} 笔未完结工单，房间继续限制售卖。`);
      }
      onChanged?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  // 各角色可执行的动作按钮
  const actions = [];
  if (user.role === 'maintenance') {
    if ((t.status === 'pending' || t.status === 'rejected') && (t.assigned_to == null || isMine)) {
      actions.push({ key: 'accept', label: t.assigned_to == null ? '🛠 接单处理' : '🛠 重新接单', cls: 'btn-primary' });
    }
    if (isMine && ['accepted', 'rejected'].includes(t.status)) {
      actions.push({ key: 'parts', label: '📦 等待配件', cls: 'btn-warning' });
    }
    if (isMine && t.status === 'waiting_parts') {
      actions.push({ key: 'eta', label: '📅 调整到货日期', cls: 'btn-warning' });
      actions.push({ key: 'resume', label: '📥 配件到位，恢复维修', cls: 'btn-primary' });
    }
    if (isMine && ['accepted', 'waiting_parts', 'rejected'].includes(t.status)) {
      actions.push({ key: 'submit', label: '🔍 提交验收', cls: 'btn-success' });
    }
  }
  if (user.role === 'supervisor' && t.status === 'submitted') {
    actions.push({ key: 'approve', label: '✅ 验收通过', cls: 'btn-success' });
    actions.push({ key: 'reject', label: '↩️ 验收不通过', cls: 'btn-danger' });
  }
  if (['front_desk', 'supervisor'].includes(user.role) && !closed) {
    if (user.role === 'supervisor' || isCreator) {
      actions.push({ key: 'cancel', label: '🚫 取消工单', cls: 'btn-danger' });
    }
  }

  const renderForm = () => {
    if (!mode) return null;
    const f = mode;
    const close = (
      <button className="btn btn-sm" onClick={() => setMode(null)} disabled={busy}>收起</button>
    );
    if (f === 'accept') {
      return (
        <ActionBox icon="🔧" title="确认接单" footer={
          <>{close}<button className="btn btn-primary btn-sm" disabled={busy}
            onClick={() => act(`/tickets/${t.id}/accept`, { remark: form.remark })}>
            {busy ? '提交中…' : '确认接单'}</button></>
        }>
          <textarea rows={2} placeholder="可备注到场计划（选填）"
            value={form.remark || ''} onChange={e => setForm({ ...form, remark: e.target.value })} />
        </ActionBox>
      );
    }
    if (f === 'parts') {
      return (
        <ActionBox icon="📦" title="申请等待配件" footer={
          <>{close}<button className="btn btn-warning btn-sm" disabled={busy}
            onClick={() => {
              if (!form.parts_note?.trim()) return setError('请填写配件信息');
              if (!form.parts_expected_at) return setError('请选择预计到货日期');
              act(`/tickets/${t.id}/waiting-parts`, {
                parts_note: form.parts_note,
                parts_expected_at: form.parts_expected_at
              });
            }}>提交申请</button></>
        }>
          <textarea rows={2} placeholder="所需配件名称、型号、申购渠道，例如：风机马达 YJF-61"
            value={form.parts_note || ''} onChange={e => setForm({ ...form, parts_note: e.target.value })} />
          <label style={{ fontSize: 13, color: 'var(--text-muted)', display: 'block', margin: '8px 0 4px' }}>
            预计到货日期 *
          </label>
          <input type="date" min={todayStr()} style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6 }}
            value={form.parts_expected_at || ''}
            onChange={e => setForm({ ...form, parts_expected_at: e.target.value })} />
        </ActionBox>
      );
    }
    if (f === 'eta') {
      const ps = partsEtaStatus(t.parts_expected_at, meta.today);
      return (
        <ActionBox icon="📅" title="调整配件预计到货日期" footer={
          <>{close}<button className="btn btn-warning btn-sm" disabled={busy}
            onClick={() => {
              if (!form.parts_expected_at) return setError('请选择新的预计到货日期');
              act(`/tickets/${t.id}/parts-eta`, {
                parts_expected_at: form.parts_expected_at,
                reason: form.reason
              });
            }}>保存调整</button></>
        }>
          <div className="alert alert-warning" style={{ marginBottom: 8 }}>
            当前预计到货：{t.parts_expected_at || '未登记'}（{ps.label}）
          </div>
          <input type="date" min={todayStr()} style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6 }}
            value={form.parts_expected_at || ''}
            onChange={e => setForm({ ...form, parts_expected_at: e.target.value })} />
          <textarea rows={2} style={{ marginTop: 8 }} placeholder="调整原因（选填），如：厂家缺货改期、物流延误"
            value={form.reason || ''} onChange={e => setForm({ ...form, reason: e.target.value })} />
        </ActionBox>
      );
    }
    if (f === 'resume') {
      return (
        <ActionBox icon="📥" title="配件到位" footer={
          <>{close}<button className="btn btn-primary btn-sm" disabled={busy}
            onClick={() => act(`/tickets/${t.id}/resume`, { remark: form.remark })}>
            确认恢复维修</button></>
        }>
          <textarea rows={2} placeholder="备注配件到位情况（选填）"
            value={form.remark || ''} onChange={e => setForm({ ...form, remark: e.target.value })} />
        </ActionBox>
      );
    }
    if (f === 'submit') {
      return (
        <ActionBox icon="🔍" title="提交验收" footer={
          <>{close}<button className="btn btn-success btn-sm" disabled={busy}
            onClick={() => {
              if (!form.resolution?.trim()) return setError('请填写维修处理说明');
              act(`/tickets/${t.id}/submit`, { resolution: form.resolution });
            }}>提交主管验收</button></>
        }>
          <textarea rows={3} placeholder="说明故障原因与维修措施"
            defaultValue={t.resolution || ''}
            onChange={e => setForm({ ...form, resolution: e.target.value })} />
        </ActionBox>
      );
    }
    if (f === 'approve') {
      return (
        <ActionBox icon="✅" title="验收通过" footer={
          <>{close}<button className="btn btn-success btn-sm" disabled={busy}
            onClick={() => act(`/tickets/${t.id}/complete`, { remark: form.remark })}>
            确认验收通过</button></>
        }>
          <div className="alert alert-info" style={{ marginBottom: 8 }}>
            验收通过后工单关闭；若该房间为「限制售卖」且无其他未完结工单，将自动解除。
          </div>
          <textarea rows={2} placeholder="验收意见（选填）"
            value={form.remark || ''} onChange={e => setForm({ ...form, remark: e.target.value })} />
        </ActionBox>
      );
    }
    if (f === 'reject') {
      return (
        <ActionBox icon="↩️" title="验收不通过，退回维修" footer={
          <>{close}<button className="btn btn-danger btn-sm" disabled={busy}
            onClick={() => {
              if (!form.reject_reason?.trim()) return setError('请填写不通过原因');
              act(`/tickets/${t.id}/reject`, { reject_reason: form.reject_reason });
            }}>退回维修人员</button></>
        }>
          <textarea rows={3} placeholder="请说明问题所在，便于维修人员返工"
            value={form.reject_reason || ''} onChange={e => setForm({ ...form, reject_reason: e.target.value })} />
        </ActionBox>
      );
    }
    if (f === 'cancel') {
      return (
        <ActionBox icon="🚫" title="取消工单" footer={
          <>{close}<button className="btn btn-danger btn-sm" disabled={busy}
            onClick={() => {
              if (!form.remark?.trim()) return setError('请填写取消原因');
              act(`/tickets/${t.id}/cancel`, { remark: form.remark });
            }}>确认取消</button></>
        }>
          <textarea rows={2} placeholder="取消原因"
            value={form.remark || ''} onChange={e => setForm({ ...form, remark: e.target.value })} />
        </ActionBox>
      );
    }
    return null;
  };

  return (
    <Modal wide onClose={onClose} title={
      <span>
        <span className="ticket-code">{t.code}</span>
        {' '}{t.title}
      </span>
    } footer={
      !mode && actions.length > 0 ? (
        <>
          <button className="btn" onClick={onClose}>关闭</button>
          {actions.map(a => (
            <button key={a.key} className={`btn ${a.cls}`} onClick={() => { setError(''); setMode(a.key); }}>
              {a.label}
            </button>
          ))}
        </>
      ) : <button className="btn" onClick={onClose}>关闭</button>
    }>
      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-warning">{notice}</div>}

      {t.is_repeat === 1 && (
        <div className="callout repeat">
          <div className="t">⚠️ 重复报修</div>
          该工单被标记为重复报修{t.linked_ticket_id ? `（关联工单 #${t.linked_ticket_id}）` : ''}，请优先安排原维修人员跟进。
        </div>
      )}
      {t.status === 'waiting_parts' && (() => {
        const ps = partsEtaStatus(t.parts_expected_at, meta.today);
        const overdue = ps.level === 'overdue';
        return (
          <div className={`callout ${overdue ? 'reject' : 'parts'}`}>
            <div className="t">📦 等待配件中{overdue ? ' · 已超预计到货日期' : ''}</div>
            <div>{t.parts_note}</div>
            <div style={{ marginTop: 6, fontWeight: 700, color: ps.color }}>
              预计到货：{t.parts_expected_at || '未登记'}（{ps.label}）
            </div>
          </div>
        );
      })()}
      {t.status === 'rejected' && (
        <div className="callout reject">
          <div className="t">↩️ 验收不通过，已退回维修</div>
          {t.reject_reason}
        </div>
      )}
      {t.room_status === 'blocked' && (
        <div className="callout block">
          <div className="t">⛔ 房间 {t.room_no} 当前限制售卖</div>
          {t.block_reason}
        </div>
      )}

      <dl className="desc-grid">
        <dt>房间</dt><dd><span className="room-no">{t.room_no}</span> · {t.room_category}（{t.room_floor} 楼）</dd>
        <dt>故障类别</dt><dd>{t.category}</dd>
        <dt>优先级</dt><dd><PriorityTag priority={t.priority} labels={meta.priorityLabel} /></dd>
        <dt>当前状态</dt><dd>
          <Badge color={meta.statusColor[t.status]} label={meta.statusLabel[t.status]} />
        </dd>
        <dt>报修人</dt><dd>{t.created_by_name}（{meta.roleLabel[t.created_by_role]}）</dd>
        <dt>维修人员</dt><dd>{t.assigned_name || <span style={{ color: '#94a3b8' }}>待分配</span>}</dd>
        {t.status === 'waiting_parts' && (
          <>
            <dt>预计到货</dt>
            <dd>
              {t.parts_expected_at || <span style={{ color: '#dc2626' }}>未登记</span>}
              {t.parts_expected_at && (
                <span style={{ marginLeft: 8, color: partsEtaStatus(t.parts_expected_at, meta.today).color, fontWeight: 700 }}>
                  {partsEtaStatus(t.parts_expected_at, meta.today).label}
                </span>
              )}
            </dd>
          </>
        )}
        <dt>报修时间</dt><dd>{fmtDateTimeShort(t.created_at)}（{elapsed(t.created_at)}）</dd>
        <dt>接单时间</dt><dd>{fmtDateTimeShort(t.accepted_at)}</dd>
        {t.completed_at && <><dt>完成时间</dt><dd>{fmtDateTimeShort(t.completed_at)}</dd></>}
      </dl>

      <div className="section-label">故障描述</div>
      <div style={{ fontSize: 13.5, whiteSpace: 'pre-wrap' }}>{t.description}</div>

      {t.resolution && (
        <>
          <div className="section-label">维修处理说明</div>
          <div style={{ fontSize: 13.5, whiteSpace: 'pre-wrap' }}>{t.resolution}</div>
        </>
      )}

      {renderForm()}

      <div className="section-label">处理记录（{logs.length}）</div>
      <ul className="timeline">
        {logs.map(l => (
          <li key={l.id}>
            <div className="act">{ACTION_ICONS[l.action] || '•'} {meta.actionLabel[l.action] || l.action}</div>
            <div className="meta">
              {l.operator_name || '系统'} · {l.created_at}
            </div>
            {l.remark && <div className="remark">{l.remark}</div>}
          </li>
        ))}
      </ul>
    </Modal>
  );
}

function ActionBox({ icon, title, children, footer }) {
  return (
    <div style={{
      marginTop: 16, border: '1px solid var(--border)', borderRadius: 8,
      padding: '12px 14px', background: '#fbfdff'
    }}>
      <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 13.5 }}>{icon} {title}</div>
      <div className="field" style={{ marginBottom: 10 }}>{children}</div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>{footer}</div>
    </div>
  );
}
