import { useEffect, useMemo, useState, useCallback } from 'react';
import { api } from './api.js';
import { useAuth } from './auth.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import TicketList from './components/TicketList.jsx';
import TicketDetail from './components/TicketDetail.jsx';
import NewTicketModal from './components/NewTicketModal.jsx';
import RoomsView from './components/RoomsView.jsx';
import { Loading } from './components/ui.jsx';
import { partsEtaStatus } from './utils/parts.js';

const FALLBACK_META = {
  categories: ['水电', '空调', '电器', '卫浴', '家具', '门锁', '网络', '其他'],
  statusLabel: {}, statusColor: {}, priorityLabel: {}, roleLabel: {}, actionLabel: {}, roomStatusLabel: {}
};

export default function App() {
  const { user, loading, logout } = useAuth();
  const [meta, setMeta] = useState(FALLBACK_META);

  useEffect(() => {
    api('/meta').then(setMeta).catch(() => {});
  }, []);

  if (loading) return <Loading />;
  if (!user) return <Login />;

  return <Shell meta={meta} user={user} logout={logout} />;
}

function Shell({ meta, user, logout }) {
  const role = user.role;
  const tabs = useMemo(() => {
    if (role === 'front_desk') {
      return [
        { key: 'all', label: '全部工单' },
        { key: 'mine', label: '我的报修' },
        { key: 'pending', label: '待接单', status: 'pending' },
        { key: 'active', label: '处理中', status: 'active' },
        { key: 'waiting_parts', label: '等待配件', status: 'waiting_parts' },
        { key: 'submitted', label: '待验收', status: 'submitted' },
        { key: 'rooms', label: '客房管理' }
      ];
    }
    if (role === 'maintenance') {
      return [
        { key: 'pool', label: '待接工单池', status: 'pending' },
        { key: 'mine', label: '我的工单' },
        { key: 'parts', label: '📦 配件跟进', status: 'waiting_parts', assignee: 'me' },
        { key: 'submitted', label: '待验收', status: 'submitted' },
        { key: 'rejected', label: '返工单', status: 'rejected' },
        { key: 'all', label: '全部工单' },
        { key: 'rooms', label: '客房' }
      ];
    }
    return [
      { key: 'dashboard', label: '📊 进度看板' },
      { key: 'all', label: '全部工单' },
      { key: 'pending', label: '待接单', status: 'pending' },
      { key: 'submitted', label: '待验收', status: 'submitted' },
      { key: 'rejected', label: '返工单', status: 'rejected' },
      { key: 'waiting_parts', label: '等待配件', status: 'waiting_parts' },
      { key: 'repeat', label: '重复报修' },
      { key: 'blocked', label: '限制售卖房' },
      { key: 'rooms', label: '客房管理' }
    ];
  }, [role]);

  const [tab, setTab] = useState(tabs[0].key);
  useEffect(() => { setTab(t => tabs.find(x => x.key === t) ? t : tabs[0].key); }, [role]);

  const [tickets, setTickets] = useState([]);
  const [listLoading, setListLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [roomsViewTicket, setRoomsViewTicket] = useState(null);
  const [refreshSeq, setRefreshSeq] = useState(0);

  const currentTab = tabs.find(t => t.key === tab) || tabs[0];

  const buildQuery = useCallback(() => {
    const p = new URLSearchParams();
    if (currentTab.status) p.set('status', currentTab.status);
    if (currentTab.assignee === 'me') p.set('assignee', 'me');
    if (tab === 'mine') {
      if (role === 'front_desk') p.set('mine', '1');
      else { p.set('assignee', 'me'); p.set('status', 'active'); }
    }
    if (search.trim()) p.set('search', search.trim());
    return p.toString();
  }, [currentTab, tab, role, search]);

  const loadTickets = useCallback(() => {
    if (tab === 'rooms' || tab === 'dashboard') return;
    setListLoading(true);
    api(`/tickets?${buildQuery()}`)
      .then(ts => setTickets(ts))
      .finally(() => setListLoading(false));
  }, [tab, buildQuery]);

  useEffect(loadTickets, [loadTickets]);

  // 轮询刷新（每 20 秒）
  useEffect(() => {
    const h = setInterval(loadTickets, 20000);
    return () => clearInterval(h);
  }, [loadTickets]);

  // 等待配件列表：逾期在前、今日到货次之，按预计到货日期升序
  const sortedTickets = useMemo(() => {
    if (currentTab.status !== 'waiting_parts') return tickets;
    const rank = { overdue: 0, today: 1, upcoming: 2, unknown: 3 };
    return [...tickets].sort((a, b) => {
      const pa = partsEtaStatus(a.parts_expected_at, meta.today);
      const pb = partsEtaStatus(b.parts_expected_at, meta.today);
      if (rank[pa.level] !== rank[pb.level]) return rank[pa.level] - rank[pb.level];
      return (a.parts_expected_at || '9999') < (b.parts_expected_at || '9999') ? -1 : 1;
    });
  }, [tickets, currentTab, meta.today]);

  const shown = tab === 'repeat'
    ? tickets.filter(t => t.is_repeat === 1)
    : sortedTickets;

  const [badgeCounts, setBadgeCounts] = useState({});
  useEffect(() => {
    Promise.all([
      api('/tickets?status=pending').catch(() => []),
      api('/tickets?status=submitted').catch(() => []),
      api('/tickets?status=rejected').catch(() => []),
      api('/tickets?status=waiting_parts').catch(() => [])
    ]).then(([p, s, r, w]) => setBadgeCounts({
      pending: p.length, submitted: s.length, rejected: r.length,
      partsOverdue: w.filter(t => partsEtaStatus(t.parts_expected_at, meta.today).level === 'overdue').length
    }));
  }, [tickets, meta.today]);

  const tabsNeedCount = {
    pending: badgeCounts.pending,
    submitted: badgeCounts.submitted,
    rejected: badgeCounts.rejected
  };

  const openTicket = id => setOpenId(id);
  const bumpAll = () => { loadTickets(); setRefreshSeq(x => x + 1); };

  return (
    <div className="app-layout">
      <header className="topbar">
        <div className="brand">
          <span className="logo">🏨</span>
          <span>酒店客房报修系统</span>
        </div>
        <div className="user-area">
          <span>{user.name}</span>
          <span className="role-tag">{meta.roleLabel[role] || role}</span>
          <button className="btn logout btn-sm" onClick={logout}>退出</button>
        </div>
      </header>

      <nav className="tabs">
        {tabs.map(t => {
          const count = tabsNeedCount[t.key];
          const partsDanger = t.key === 'parts' ? badgeCounts.partsOverdue : 0;
          const danger =
            (t.key === 'submitted' && role === 'supervisor') ||
            (t.key === 'rejected' && role === 'maintenance') ||
            partsDanger > 0;
          return (
            <button key={t.key} className={`tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
              {t.label}
              {partsDanger > 0
                ? <span className="count danger">{partsDanger}</span>
                : count > 0 && <span className={`count ${danger ? 'danger' : ''}`}>{count}</span>}
            </button>
          );
        })}
      </nav>

      <main className="page">
        {tab === 'dashboard' && (
          <Dashboard meta={meta} onOpenTicket={openTicket} refreshKey={refreshSeq} />
        )}

        {tab === 'rooms' && (
          <RoomsView meta={meta} onOpenTicket={id => setRoomsViewTicket(id)} />
        )}

        {tab !== 'dashboard' && tab !== 'rooms' && (
          <>
            <div className="page-head">
              <h2>{currentTab.label}</h2>
              {role === 'front_desk' && (
                <button className="btn btn-primary" onClick={() => setShowNew(true)}>＋ 新建报修</button>
              )}
            </div>

            {currentTab.status === 'waiting_parts' && (
              <div className="alert alert-info">
                列表按配件逾期程度排序：<b>已逾期</b>排最前，随后为今日到货、未来到货。点击工单可调整预计到货日期或登记配件到位。
              </div>
            )}

            <div className="toolbar">
              <input className="search" placeholder="搜索工单号 / 房间号 / 标题"
                value={search} onChange={e => setSearch(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && loadTickets()} />
              <button className="btn" onClick={loadTickets}>🔄 刷新</button>
            </div>

            <TicketList
              tickets={shown}
              meta={meta}
              loading={listLoading}
              onOpen={openTicket}
              showCreator={role !== 'front_desk'}
              showAssignee={true}
            />
          </>
        )}
      </main>

      {showNew && (
        <NewTicketModal meta={meta} onClose={() => setShowNew(false)}
          onCreated={() => { loadTickets(); setTab(role === 'front_desk' ? 'mine' : 'all'); }} />
      )}
      {openId && (
        <TicketDetail ticketId={openId} meta={meta}
          onClose={() => setOpenId(null)}
          onChanged={bumpAll} />
      )}
      {roomsViewTicket && (
        <TicketDetail ticketId={roomsViewTicket} meta={meta}
          onClose={() => setRoomsViewTicket(null)}
          onChanged={bumpAll} />
      )}
    </div>
  );
}
