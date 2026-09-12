// 端到端冒烟测试：登录 -> 报修 -> 重复检测 -> 接单 -> 等配件 -> 验收驳回/通过 -> 房间限制
const BASE = 'http://localhost:4000/api';
let pass = 0, fail = 0;

function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
}

async function req(method, path, token, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  let data = null;
  const text = await res.text();
  if (text) { try { data = JSON.parse(text); } catch {} }
  return { status: res.status, data };
}

const login = async (u, p) => (await req('POST', '/users/login', null, { username: u, password: p })).data;

// 与前端 utils/parts.js 同口径：按本地日期比较
function partsEtaLevel(eta) {
  if (!eta) return 'unknown';
  const today = new Date();
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const d = new Date(`${eta.slice(0, 10)}T00:00:00`);
  const days = Math.round((t0 - d) / 86400000);
  return days > 0 ? 'overdue' : days === 0 ? 'today' : 'upcoming';
}

console.log('\n=== 1. 登录与鉴权 ===');
const front = await login('front', 'front123');
const repair = await login('repair', 'repair123');
const repair2 = await login('repair2', 'repair123');
const admin = await login('admin', 'admin123');
ok('前台登录', front?.token);
ok('维修员登录', repair?.token);
ok('主管登录', admin?.token);
ok('错误密码被拒', (await req('POST', '/users/login', null, { username: 'front', password: 'x' })).status === 401);
ok('无 token 访问被拒', (await req('GET', '/tickets')).status === 401);

console.log('\n=== 2. 样例数据 ===');
const tickets = (await req('GET', '/tickets', admin.token)).data;
ok('样例工单 >= 10 笔', tickets.length >= 10, `实际 ${tickets.length}`);
const rooms = (await req('GET', '/rooms', front.token)).data;
ok('样例房间 16 间', rooms.length === 16, `实际 ${rooms.length}`);
ok('有 3 间限制售卖房', rooms.filter(r => r.status === 'blocked').length === 3);
ok('存在重复报修样例', tickets.some(t => t.is_repeat === 1));
ok('存在等待配件样例', tickets.some(t => t.status === 'waiting_parts'));
ok('存在验收不通过样例', tickets.some(t => t.status === 'rejected'));

console.log('\n=== 3. 权限控制 ===');
ok('维修员不能创建报修', (await req('POST', '/tickets', repair.token, { room_id: 1, category: '水电', title: 'x', description: 'y' })).status === 403);
const completeAsFront = await req('POST', `/tickets/${tickets.find(t => t.status === 'submitted').id}/complete`, front.token, {});
ok('前台不能验收通过(403)', completeAsFront.status === 403, `实际 ${completeAsFront.status}`);

console.log('\n=== 4. 完整工单生命周期 ===');
// 前台选 701 可售房报修
const room701 = rooms.find(r => r.room_no === '701');
const create = await req('POST', '/tickets', front.token, {
  room_id: room701.id, category: '空调', title: '测试-空调不制冷', description: '冒烟测试用工单', priority: 'high'
});
ok('创建报修成功', create.status === 201, create.data?.error);
const tid = create.data.ticket.id;
ok('初始状态为待接单', create.data.ticket.status === 'pending');

// 接单
const accept = await req('POST', `/tickets/${tid}/accept`, repair.token, {});
ok('维修员接单', accept.status === 200 && accept.data.ticket.status === 'accepted', accept.data?.error);
ok('已分配维修员', accept.data.ticket.assigned_to === repair.user.id);

// 等配件：缺少备注或日期都被拒
const wpBad1 = await req('POST', `/tickets/${tid}/waiting-parts`, repair.token, { parts_note: '压缩机 X-1' });
ok('等配件缺日期被拒', wpBad1.status === 400, `实际 ${wpBad1.status}`);
const wpBad2 = await req('POST', `/tickets/${tid}/waiting-parts`, repair.token, { parts_note: '', parts_expected_at: '2099-01-01' });
ok('等配件缺备注被拒', wpBad2.status === 400, `实际 ${wpBad2.status}`);
const wpBad3 = await req('POST', `/tickets/${tid}/waiting-parts`, repair.token, { parts_note: 'x', parts_expected_at: '2000-01-01' });
ok('到货日期早于今天被拒', wpBad3.status === 400, `实际 ${wpBad3.status}`);
const future = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
const wp = await req('POST', `/tickets/${tid}/waiting-parts`, repair.token, { parts_note: '压缩机 X-1，预计 3 天', parts_expected_at: future });
ok('申请等待配件(含日期)', wp.data.ticket.status === 'waiting_parts' && wp.data.ticket.parts_expected_at === future);

// 调整预计到货日期：留痕、非法值拒绝、非等待配件状态拒绝
const newEta = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
const etaChange = await req('POST', `/tickets/${tid}/parts-eta`, repair.token, { parts_expected_at: newEta, reason: '厂家改期' });
ok('调整到货日期成功', etaChange.status === 200 && etaChange.data.ticket.parts_expected_at === newEta, etaChange.data?.error);
const etaLog = etaChange.data.logs.some(l => l.action === 'parts_eta_changed');
ok('日期调整写入时间线', etaLog);
const etaSame = await req('POST', `/tickets/${tid}/parts-eta`, repair.token, { parts_expected_at: newEta });
ok('相同日期调整被拒', etaSame.status === 400);
const etaOther = await req('POST', `/tickets/${tid}/parts-eta`, repair2.token, { parts_expected_at: newEta });
ok('他人不能调整到货日期', etaOther.status === 403);

// 非本人工单不能操作
const wrongUser = await req('POST', `/tickets/${tid}/resume`, (await login('repair2', 'repair123')).token, {});
ok('他人不能操作该工单', wrongUser.status === 403, `实际 ${wrongUser.status}`);

// 配件到位
const resume = await req('POST', `/tickets/${tid}/resume`, repair.token, {});
ok('配件到位恢复维修', resume.data.ticket.status === 'accepted');

// 提交验收缺说明
const noRes = await req('POST', `/tickets/${tid}/submit`, repair.token, {});
ok('提交验收缺说明被拒', noRes.status === 400);
const submit = await req('POST', `/tickets/${tid}/submit`, repair.token, { resolution: '更换压缩机，试机正常' });
ok('提交验收', submit.data.ticket.status === 'submitted');

// 主管驳回
const reject = await req('POST', `/tickets/${tid}/reject`, admin.token, { reject_reason: '复测仍不制冷' });
ok('验收不通过退回', reject.data.ticket.status === 'rejected' && reject.data.ticket.reject_reason);

// 维修员重新接单 -> 再提交 -> 通过
await req('POST', `/tickets/${tid}/accept`, repair.token, {});
await req('POST', `/tickets/${tid}/submit`, repair.token, { resolution: '重新抽真空加氟，出风口 10 度' });
const complete = await req('POST', `/tickets/${tid}/complete`, admin.token, { remark: '现场复测合格' });
ok('验收通过完成', complete.data.ticket.status === 'completed' && complete.data.ticket.completed_at);
ok('终态不可再操作', (await req('POST', `/tickets/${tid}/accept`, repair.token)).status === 400);

console.log('\n=== 5. 重复报修检测 ===');
// 刚完成的 701 同类故障再报
const dup1 = await req('POST', '/tickets', front.token, {
  room_id: room701.id, category: '空调', title: '测试-又不凉了', description: '复发'
});
ok('7 日内同类复发返回 409 冲突', dup1.status === 409, `实际 ${dup1.status}`);
const dupForce = await req('POST', '/tickets', front.token, {
  room_id: room701.id, category: '空调', title: '测试-确认重复报修', description: '复发确认', forceRepeat: true
});
ok('确认后可作为重复报修提交', dupForce.status === 201 && dupForce.data.ticket.is_repeat === 1);

// 803 有未完结工单
const room803 = rooms.find(r => r.room_no === '803');
const dupOpen = await req('POST', '/tickets', front.token, {
  room_id: room803.id, category: '水电', title: '测试-同房再报', description: '未完结冲突'
});
ok('同房有未完结工单返回冲突', dupOpen.status === 409, `实际 ${dupOpen.status}`);
const checkApi = await req('GET', `/tickets/check-repeat?room_id=${room803.id}&category=${encodeURIComponent('水电')}`, front.token);
ok('冲突预判接口返回 conflict', checkApi.data.conflict !== null);

console.log('\n=== 6. 房间限制售卖：维修员解除权限 ===');
// 清理第 5 节残留在 701 上的重复报修工单，避免干扰本节判定
for (const tk of (await req('GET', `/tickets?room_id=${room701.id}`, front.token)).data
  .filter(x => !['completed', 'cancelled'].includes(x.status))) {
  await req('POST', `/tickets/${tk.id}/cancel`, admin.token, { remark: '测试清理：取消残留工单' });
}
// 701 当前可售
ok('701 当前可售', (await req('GET', `/rooms/${room701.id}`, front.token)).data.room.status === 'available');
const noReason = await req('POST', `/rooms/${room701.id}/block`, front.token, { reason: '' });
ok('无原因限制售卖被拒', noReason.status === 400);
const blocked = await req('POST', `/rooms/${room701.id}/block`, front.token, { reason: '冒烟测试：维修停售' });
ok('限制售卖成功', blocked.data.room.status === 'blocked');

// 6.1 解除备注必填（所有角色）
const unblockNoRemark = await req('POST', `/rooms/${room701.id}/unblock`, repair.token, { remark: '' });
ok('维修员无备注解除被拒', unblockNoRemark.status === 400, `实际 ${unblockNoRemark.status}`);
const unblockNoRemarkAdmin = await req('POST', `/rooms/${room701.id}/unblock`, admin.token, { remark: '' });
ok('主管无备注解除也被拒', unblockNoRemarkAdmin.status === 400, `实际 ${unblockNoRemarkAdmin.status}`);

// 6.2 与该房间无任何工单关系的维修员不能解除
const strangerUnblock = await req('POST', `/rooms/${room701.id}/unblock`, repair2.token, { remark: '我来解封' });
ok('无关维修员解除被拒(403)', strangerUnblock.status === 403, `实际 ${strangerUnblock.status}`);

// 6.3 在该房间创建工单并由 repair 接单：维修中/等待配件期间不能解除
const authTk = await req('POST', '/tickets', front.token, {
  room_id: room701.id, category: '门锁', title: '测试-解除权限', description: '验证维修员解除停售权限',
  priority: 'high', forceRepeat: true
});
const authTid = authTk.data.ticket.id;
await req('POST', `/tickets/${authTid}/accept`, repair.token, {});
const activeUnblock = await req('POST', `/rooms/${room701.id}/unblock`, repair.token, { remark: '还在修' });
ok('维修中本人解除被拒(403)', activeUnblock.status === 403, `实际 ${activeUnblock.status}`);
await req('POST', `/tickets/${authTid}/waiting-parts`, repair.token, { parts_note: '锁芯，1 天', parts_expected_at: newEta });
const waitingUnblock = await req('POST', `/rooms/${room701.id}/unblock`, repair.token, { remark: '等配件先解封' });
ok('等待配件期间解除被拒(403)', waitingUnblock.status === 403, `实际 ${waitingUnblock.status}`);

// 6.4 提交验收后，本人可解除
await req('POST', `/tickets/${authTid}/resume`, repair.token, {});
await req('POST', `/tickets/${authTid}/submit`, repair.token, { resolution: '更换锁芯，刷卡正常' });
const ownUnblock = await req('POST', `/rooms/${room701.id}/unblock`, repair.token, { remark: '已提交验收，恢复售卖' });
ok('本人待验收工单可解除', ownUnblock.status === 200 && ownUnblock.data.room.status === 'available', ownUnblock.data?.error);

// 6.5 前台/主管不受工单关系限制（但需备注）
await req('POST', `/rooms/${room701.id}/block`, front.token, { reason: '复测再次停售' });
const frontUnblock = await req('POST', `/rooms/${room701.id}/unblock`, front.token, { remark: '前台确认恢复' });
ok('前台可直接解除', frontUnblock.status === 200 && frontUnblock.data.room.status === 'available');

// 6.6 房间详情的权限标记与角色一致
const permMaint = (await req('GET', `/rooms/${room701.id}`, repair2.token)).data.permissions;
ok('无关维修员详情标记不可解除', permMaint.canBlock === false && permMaint.canUnblock === false);
const permFront = (await req('GET', `/rooms/${room701.id}`, front.token)).data.permissions;
ok('前台详情标记可解除/可停售', permFront.canBlock === true && permFront.canUnblock === true);

console.log('\n=== 7. 验收通过自动解除：单工单与多工单 ===');
// 7a. 单笔待验收工单（样例 806），验收后应自动解封
const room806 = rooms.find(r => r.room_no === '806');
const t806 = tickets.find(t => t.room_no === '806' && t.status === 'submitted');
ok('806 验收前为限制售卖', room806.status === 'blocked');
const c1 = await req('POST', `/tickets/${t806.id}/complete`, admin.token, {});
const room806After = (await req('GET', `/rooms/${room806.id}`, admin.token)).data.room;
ok('单笔工单验收后自动解封', room806After.status === 'available' && c1.data.autoUnblocked === true, `实际 ${room806After.status}`);

// 7b. 同房间两笔未完结工单，只验收其中一笔：不得解封
//     使用样例中 blocked 且无已完成单冲突的房间 803（accepted），再造一笔 pending
const room803b = rooms.find(r => r.room_no === '803');
const t803b = tickets.find(t => t.room_no === '803' && t.status === 'accepted');
ok('803 验收前为限制售卖', room803b.status === 'blocked');
// 第二笔工单：另一故障类别，forceRepeat 绕过冲突拦截
const second = await req('POST', '/tickets', front.token, {
  room_id: room803b.id, category: '电器', title: '测试-同房第二笔故障', description: '验证多工单不自动解封',
  forceRepeat: true
});
ok('第二笔工单创建为待接单', second.data.ticket.status === 'pending');
// repair 完成手头工单的流程 -> submit -> complete
await req('POST', `/tickets/${t803b.id}/waiting-parts`, repair.token, { parts_note: '下水管件，当天到', parts_expected_at: new Date(Date.now() + 86400000).toISOString().slice(0, 10) });
await req('POST', `/tickets/${t803b.id}/resume`, repair.token, {});
await req('POST', `/tickets/${t803b.id}/submit`, repair.token, { resolution: '更换下水管组件，渗漏消除' });
const c2 = await req('POST', `/tickets/${t803b.id}/complete`, admin.token, { remark: '第一项验收合格' });
const room803After = (await req('GET', `/rooms/${room803b.id}`, admin.token)).data.room;
ok('仍有待接单工单时保持限制售卖', room803After.status === 'blocked', `实际 ${room803After.status}`);
ok('接口返回未解封及剩余工单', c2.data.autoUnblocked === false && c2.data.remainingOpenTickets.length === 1,
  `autoUnblocked=${c2.data.autoUnblocked} remaining=${c2.data?.remainingOpenTickets?.length}`);
const detail803 = (await req('GET', `/rooms/${room803b.id}`, admin.token)).data;
ok('房间日志记录了维持停售原因', detail803.logs.some(l => l.action === 'room_kept_blocked'));

// 第二笔走完流程后再验收，才自动解封
const t2id = second.data.ticket.id;
await req('POST', `/tickets/${t2id}/accept`, repair2.token, {});
// repair2 此时在维修中，不能解除停售
const maintWhileActive = await req('POST', `/rooms/${room803b.id}/unblock`, repair2.token, { remark: '先解封' });
ok('第二笔维修中解除仍被拒', maintWhileActive.status === 403, `实际 ${maintWhileActive.status}`);
await req('POST', `/tickets/${t2id}/submit`, repair2.token, { resolution: '电器故障修复' });
const c3 = await req('POST', `/tickets/${t2id}/complete`, admin.token, {});
const room803Final = (await req('GET', `/rooms/${room803b.id}`, admin.token)).data.room;
ok('最后一笔验收后自动解封', room803Final.status === 'available' && c3.data.autoUnblocked === true, `实际 ${room803Final.status}`);

console.log('\n=== 8. 取消工单（前台只能取消自己的）===');
async function front2Login() { return (await login('front2', 'front123')).token; }
const t2token = await front2Login();
const mine2 = await req('POST', '/tickets', t2token, {
  room_id: rooms.find(r => r.room_no === '703').id, category: '其他', title: '测试-取消2', description: '误报'
});
const cancelOther = await req('POST', `/tickets/${mine2.data.ticket.id}/cancel`, front.token, { remark: 'x' });
ok('前台不能取消他人工单', cancelOther.status === 403, `实际 ${cancelOther.status}`);
const cancelMine = await req('POST', `/tickets/${mine2.data.ticket.id}/cancel`, t2token, { remark: '客人自行解决' });
ok('本人可取消工单', cancelMine.data.ticket.status === 'cancelled');

console.log('\n=== 9. 主管看板 ===');
const stats = (await req('GET', '/stats/overview', admin.token)).data;
ok('看板状态统计', stats.statusCounts && typeof stats.blockedRooms === 'number');
ok('有维修人员工作量数据', stats.workload.length === 2);
ok('有 7 天趋势', Array.isArray(stats.trend));
ok('平均维修时长可计算', stats.avgMinutes !== null);
ok('维修员不能看看板', (await req('GET', '/stats/overview', repair.token)).status === 403);

console.log('\n=== 10. 超时预警：数量与明细同口径 ===');
// 数量取自 overview.alertsSummary，明细取自 /stats/alerts，两者必须一致
const alerts = (await req('GET', '/stats/alerts', admin.token)).data.alerts;
const cnt = k => alerts.filter(a => a.severity_key === k).length;
ok('待接单超时: 数量=明细', stats.alertsSummary.pendingOverdue === cnt('pending_overdue'),
  `${stats.alertsSummary.pendingOverdue} vs ${cnt('pending_overdue')}`);
ok('维修超时: 数量=明细', stats.alertsSummary.activeOverdue === cnt('active_overdue'));
ok('配件逾期: 数量=明细', stats.alertsSummary.partsOverdue === cnt('parts_overdue'));
ok('配件今日到货: 数量=明细', stats.alertsSummary.partsToday === cnt('parts_today'));
ok('返工: 数量=明细', stats.alertsSummary.rejected === cnt('rejected'));

// 样例数据应覆盖全部预警类型（808 配件逾期 / 812 今日到货 / 706+802 待接单超时 / 708 维修超时 / 810 返工）
ok('样例存在配件逾期预警', cnt('parts_overdue') >= 1);
ok('样例存在今日到货预警', cnt('parts_today') >= 1);
ok('样例存在待接单超时预警', cnt('pending_overdue') >= 2);
ok('样例存在维修超时预警', cnt('active_overdue') >= 1);
ok('预警含房间/维修员/超时时长字段', alerts.every(a => a.room_no && (a.assigned_name !== undefined)));

// 严重程度排序：逾期类在前
const rank = { pending_overdue: 0, parts_overdue: 1, rejected: 2, active_overdue: 3, parts_today: 4, parts_upcoming: 5 };
let sorted = true;
for (let i = 1; i < alerts.length; i++) {
  if ((rank[alerts[i - 1].severity_key] ?? 9) > (rank[alerts[i].severity_key] ?? 9)) sorted = false;
}
ok('预警按严重程度排序', sorted);

// 角色隔离：维修员只看到本人工单；前台无权访问
const myAlerts = (await req('GET', '/stats/alerts', repair.token)).data.alerts;
ok('维修员预警仅含本人工单', myAlerts.every(a => a.assigned_name === '张建国'),
  `实际涉及: ${[...new Set(myAlerts.map(a => a.assigned_name))].join(',')}`);
ok('维修员看不到未分配的待接单预警', !myAlerts.some(a => a.alert_type === 'pending_overdue'));
ok('前台不能看预警明细', (await req('GET', '/stats/alerts', front.token)).status === 403);

// 维修员角标口径 = 对应页签列表口径（assignee=me），他人逾期配件不得计入
const myWaiting = (await req('GET', '/tickets?status=waiting_parts&assignee=me', repair.token)).data;
const shopWaiting = (await req('GET', '/tickets?status=waiting_parts', repair.token)).data;
const myOverdueParts = myWaiting.filter(
  t => partsEtaLevel(t.parts_expected_at) === 'overdue'
).length;
const shopOverdueParts = shopWaiting.filter(
  t => partsEtaLevel(t.parts_expected_at) === 'overdue'
).length;
ok('本人配件逾期数与本人列表一致',
  myAlerts.filter(a => a.severity_key === 'parts_overdue').length === myOverdueParts,
  `预警 ${myAlerts.filter(a => a.severity_key === 'parts_overdue').length} vs 列表 ${myOverdueParts}`);
ok('全店配件逾期数大于本人时角标不得借用全店口径',
  shopOverdueParts >= myOverdueParts,
  `全店 ${shopOverdueParts} / 本人 ${myOverdueParts}`);
// 同样验证待验收/返工的本人筛选
const mySubmitted = (await req('GET', '/tickets?status=submitted&assignee=me', repair.token)).data;
const myRejected = (await req('GET', '/tickets?status=rejected&assignee=me', repair.token)).data;
ok('维修员待验收列表仅含本人', mySubmitted.every(t => t.assigned_name === '张建国'));
ok('维修员返工列表仅含本人', myRejected.every(t => t.assigned_name === '张建国'));

console.log('\n=== 11. 状态变化后预警自动移除、配件到位不计逾期 ===');
// 主管接单处理掉一笔待接单超时预警前，先记录数量
const before = (await req('GET', '/stats/alerts', admin.token)).data.alerts;
const aPending = before.find(a => a.severity_key === 'pending_overdue');
const beforePending = before.filter(a => a.severity_key === 'pending_overdue').length;
// 维修员接单 -> 立即不再是 pending_overdue，且 overview 汇总与明细同步
const ovBefore = (await req('GET', '/stats/overview', admin.token)).data.alertsSummary;
ok('变更前 overview 待接单超时数与明细一致', ovBefore.pendingOverdue === beforePending,
  `${ovBefore.pendingOverdue} vs ${beforePending}`);
await req('POST', `/tickets/${aPending.id}/accept`, repair.token, {});
const afterAccept = (await req('GET', '/stats/alerts', admin.token)).data.alerts;
const afterPending = afterAccept.filter(a => a.severity_key === 'pending_overdue').length;
ok('接单后从待接单超时预警移除', afterPending === beforePending - 1, `${beforePending} -> ${afterPending}`);
const ovAfter = (await req('GET', '/stats/overview', admin.token)).data.alertsSummary;
ok('接单后 overview 汇总同步减少', ovAfter.pendingOverdue === afterPending,
  `${ovAfter.pendingOverdue} vs ${afterPending}`);

// 808 配件逾期工单：配件到位恢复维修后，不再计入逾期
const partsTicket = afterAccept.find(a => a.severity_key === 'parts_overdue');
ok('存在可操作的配件逾期工单', !!partsTicket);
if (partsTicket) {
  const beforeParts = afterAccept.filter(a => a.severity_key === 'parts_overdue').length;
  const tk = (await req('GET', `/tickets/${partsTicket.id}`, repair2.token)).data;
  // 808 归属 repair2
  const owner = tk.ticket.assigned_name === '赵伟' ? repair2 : repair;
  await req('POST', `/tickets/${partsTicket.id}/resume`, owner.token, { remark: '配件已到货' });
  const afterParts = (await req('GET', '/stats/alerts', admin.token)).data.alerts;
  const gone = !afterParts.some(a => a.id === partsTicket.id && a.severity_key === 'parts_overdue');
  ok('配件到位后不再计入逾期预警', gone && afterParts.filter(a => a.severity_key === 'parts_overdue').length === beforeParts - 1);
}

console.log(`\n================ 结果: ${pass} 通过, ${fail} 失败 ================`);
process.exit(fail ? 1 : 0);
