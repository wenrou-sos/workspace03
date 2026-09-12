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

console.log('\n=== 1. 登录与鉴权 ===');
const front = await login('front', 'front123');
const repair = await login('repair', 'repair123');
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

// 状态机：未接单不能直接等配件 —— 用别人/错误状态验证
const wrongParts = await req('POST', `/tickets/${tid}/waiting-parts`, repair.token, {});
ok('等配件缺少备注被拒', wrongParts.status === 400);

// 等待配件
const wp = await req('POST', `/tickets/${tid}/waiting-parts`, repair.token, { parts_note: '压缩机 X-1，预计 3 天' });
ok('申请等待配件', wp.data.ticket.status === 'waiting_parts' && wp.data.ticket.parts_note);

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
const repair2 = await login('repair2', 'repair123');
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
await req('POST', `/tickets/${authTid}/waiting-parts`, repair.token, { parts_note: '锁芯，1 天' });
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
await req('POST', `/tickets/${t803b.id}/waiting-parts`, repair.token, { parts_note: '下水管件，当天到' });
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

console.log(`\n================ 结果: ${pass} 通过, ${fail} 失败 ================`);
process.exit(fail ? 1 : 0);
