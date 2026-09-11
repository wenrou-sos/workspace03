import { useEffect, useMemo, useState, useCallback } from 'react';
import { api } from './api.js';
import { useAuth } from './auth.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import TicketList, { FILTERS } from './components/TicketList.jsx';
import TicketDetail from './components/TicketDetail.jsx';
import NewTicketModal from './components/NewTicketModal.jsx';
import RoomsView from './components/RoomsView.jsx';
import { Loading } from './components/ui.jsx';

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
        { key: 'submitted', label: '待验收', status: 'submitted' },
        { key: 'rooms', label: '客房管理' }
      ];
    }
    if (role === 'maintenance') {
      return [
        { key: 'pool', label: '待接工单池', status: 'pending' },
        { key: 'mine', label: '我的工单' },
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

  const currentTab = tabs.find(t => t.key === tab) || tabs[0];

  const buildQuery = useCallback(() => {
    const p = new URLSearchParams();
    if (currentTab.status) p.set('status', currentTab.status);
    if (tab === 'mine') {
      if (role === 'front_desk') p.set('mine', '1');
      else { p.set('assignee', 'me'); p.set('status', 'active'); }
    }
    if (tab === 'repeat') {
      // 重复报修在前端过滤
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

  const shown = tab === 'repeat' ? tickets.filter(t => t.is_repeat === 1) : tickets;

  const [badgeCounts, setBadgeCounts] = useState({});
  useEffect(() => {
    Promise.all([
      api('/tickets?status=pending').catch(() => []),
      api('/tickets?status=submitted').catch(() => []),
      api('/tickets?status=rejected').catch(() => [])
    ]).then(([p, s, r]) => setBadgeCounts({ pending: p.length, submitted: s.length, rejected: r.length }));
  }, [tickets]);

  const tabsNeedCount = { pending: badgeCounts.pending, submitted: badgeCounts.submitted, rejected: badgeCounts.rejected };

  const openTicket = id => setOpenId(id);

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
        {tabs.map(t => (
          <button key={t.key} className={`tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
            {tabsNeedCount[t.key] > 0 && (
              <span className={`count ${(t.key === 'submitted' && role === 'supervisor') || (t.key === 'rejected' && role === 'maintenance') ? 'danger' : ''}`}>
                {tabsNeedCount[t.key]}
              </span>
            )}
          </button>
        ))}
      </nav>

      <main className="page">
        {tab === 'dashboard' && (
          <Dashboard meta={meta}
            onOpenTicket={openTicket}
            pendingCount={badgeCounts.pending || 0}
            submittedCount={badgeCounts.submitted || 0} />
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
          onChanged={() => { loadTickets(); }} />
      )}
      {roomsViewTicket && (
        <TicketDetail ticketId={roomsViewTicket} meta={meta}
          onClose={() => setRoomsViewTicket(null)}
          onChanged={loadTickets} />
      )}
    </div>
  );
}
