// 配件预计到货状态计算（前端与后端 listAlerts 口径一致：按本地日期比较）
export function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 返回 { level: 'overdue'|'today'|'upcoming'|'unknown', days, label, color }
export function partsEtaStatus(eta, today = todayStr()) {
  if (!eta) return { level: 'unknown', days: null, label: '未登记到货日期', color: '#6b7280' };
  const day = eta.slice(0, 10);
  const days = Math.floor((new Date(`${today}T00:00`) - new Date(`${day}T00:00`)) / 86400000);
  if (days > 0) return { level: 'overdue', days, label: `已逾期 ${days} 天`, color: '#dc2626' };
  if (days === 0) return { level: 'today', days: 0, label: '今日到货', color: '#d97706' };
  return { level: 'upcoming', days, label: `${-days} 天后到货`, color: '#2563eb' };
}

export function overdueHoursLabel(mins) {
  if (mins == null) return '';
  if (mins < 60) return `${mins} 分钟`;
  const h = Math.floor(mins / 60);
  return h < 48 ? `${h} 小时` : `${Math.floor(h / 24)} 天`;
}
