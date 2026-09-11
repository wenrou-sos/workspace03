import { useState } from 'react';
import { useAuth } from '../auth.jsx';

const DEMOS = [
  { role: '前台接待', acct: 'front', pwd: 'front123', icon: '🛎️' },
  { role: '维修人员', acct: 'repair', pwd: 'repair123', icon: '🔧' },
  { role: '主管', acct: 'admin', pwd: 'admin123', icon: '👔' }
];

export default function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(u, p) {
    setError('');
    setBusy(true);
    try {
      await login(u, p);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const fill = d => {
    setUsername(d.acct);
    setPassword(d.pwd);
    submit(d.acct, d.pwd);
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-logo">🏨</div>
        <h1>酒店客房报修系统</h1>
        <div className="sub">Hotel Room Maintenance System</div>

        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={e => { e.preventDefault(); submit(username, password); }}>
          <div className="field">
            <label>账号</label>
            <input value={username} onChange={e => setUsername(e.target.value)}
              placeholder="请输入账号" autoFocus />
          </div>
          <div className="field">
            <label>密码</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder="请输入密码" />
          </div>
          <button className="btn btn-primary btn-block" disabled={busy}>
            {busy ? '登录中…' : '登 录'}
          </button>
        </form>

        <div className="demo-accounts">
          <h3>样例账号（点击快速登录）</h3>
          <div className="demo-grid">
            {DEMOS.map(d => (
              <div key={d.acct} className="demo-item" onClick={() => fill(d)}>
                <div style={{ fontSize: 20 }}>{d.icon}</div>
                <div className="role">{d.role}</div>
                <div className="acct">{d.acct} / {d.pwd}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
