import bcrypt from 'bcryptjs';
import { db } from './db.js';
import { STATUS } from './constants.js';

// 生成相对当前时间的本地时间字符串，供样例数据使用
function t(offset) {
  // offset 如 '-2 hours'、'-1 days'
  return db.prepare(`SELECT datetime('now','localtime', ?) AS v`).get(offset).v;
}

export function resetAndSeed() {
  const tx = db.transaction(() => {
    db.exec(`
      DELETE FROM ticket_logs;
      DELETE FROM room_logs;
      DELETE FROM tickets;
      DELETE FROM rooms;
      DELETE FROM users;
      DELETE FROM sqlite_sequence;
    `);

    const hash = (pwd) => bcrypt.hashSync(pwd, 10);
    const insertUser = db.prepare(
      `INSERT INTO users (username, password_hash, name, role) VALUES (?,?,?,?)`
    );
    const users = {
      front:   insertUser.run('front',  hash('front123'),  '王晓', 'front_desk').lastInsertRowid,
      front2:  insertUser.run('front2', hash('front123'),  '李婷', 'front_desk').lastInsertRowid,
      repair:  insertUser.run('repair', hash('repair123'), '张建国', 'maintenance').lastInsertRowid,
      repair2: insertUser.run('repair2', hash('repair123'), '赵伟', 'maintenance').lastInsertRowid,
      admin:   insertUser.run('admin',  hash('admin123'),  '陈主管', 'supervisor').lastInsertRowid
    };

    // ---------- 客房（7、8 两层，共 16 间） ----------
    const insertRoom = db.prepare(
      `INSERT INTO rooms (room_no, floor, category, status, block_reason, blocked_by, blocked_at)
       VALUES (?,?,?,?,?,?,?)`
    );
    const roomNos = [];
    const cats = { S: '标准间', D: '大床房', T: '双床房', X: '行政套房' };
    const layout = [
      ['701',7,'S'],['702',7,'D'],['703',7,'S'],['705',7,'T'],
      ['706',7,'D'],['708',7,'S'],['710',7,'X'],['712',7,'T'],
      ['801',8,'D'],['802',8,'S'],['803',8,'T'],['805',8,'D'],
      ['806',8,'S'],['808',8,'X'],['810',8,'D'],['812',8,'T']
    ];
    // 默认入住情况
    const occupied = new Set(['702','705','710','802','805','810']);
    const blocked = {
      '803': { reason: '卫生间水管漏水，待维修后复检', at: '-5 hours' },
      '808': { reason: '中央空调异响，等待厂家配件', at: '-1 days' },
      '806': { reason: '电视信号故障，待工程部验收', at: '-3 hours' }
    };
    const roomIds = {};
    for (const [no, floor, ck] of layout) {
      let status = 'available';
      let reason = null, by = null, at = null;
      if (blocked[no]) {
        status = 'blocked';
        reason = blocked[no].reason;
        by = users.front;
        at = t(blocked[no].at);
      } else if (occupied.has(no)) {
        status = 'occupied';
      }
      roomIds[no] = insertRoom.run(no, floor, cats[ck], status, reason, by, at).lastInsertRowid;
      roomNos.push(no);
    }

    // ---------- 工单 ----------
    const insTicket = db.prepare(`
      INSERT INTO tickets
      (code, room_id, category, title, description, priority, status,
       created_by, assigned_to, is_repeat, linked_ticket_id, parts_note,
       parts_expected_at, reject_reason, resolution, created_at, accepted_at, completed_at)
      VALUES (@code,@room_id,@category,@title,@description,@priority,@status,
              @created_by,@assigned_to,@is_repeat,@linked_ticket_id,@parts_note,
              @parts_expected_at,@reject_reason,@resolution,@created_at,@accepted_at,@completed_at)
    `);
    const insLog = db.prepare(
      `INSERT INTO ticket_logs (ticket_id, action, remark, operator_id, created_at)
       VALUES (?,?,?,?,?)`
    );
    const insRoomLog = db.prepare(
      `INSERT INTO room_logs (room_id, action, remark, operator_id, created_at)
       VALUES (?,?,?,?,?)`
    );

    let seq = 1;
    const code = () => `BX${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(seq++).padStart(3, '0')}`;

    const tickets = [];
    function add(tk, logs) {
      const id = insTicket.run({
        assigned_to: null, is_repeat: 0, linked_ticket_id: null, parts_note: null,
        parts_expected_at: null,
        reject_reason: null, resolution: null,
        accepted_at: null, completed_at: null,
        ...tk
      }).lastInsertRowid;
      for (const [action, remark, op, at] of logs) {
        insLog.run(id, action, remark, op, at);
      }
      tickets.push(id);
      return id;
    }

    // 1. 已完成（昨天）
    const tk1 = add({
      code: code(), room_id: roomIds['802'], category: '空调',
      title: '空调不制冷', description: '客人反映空调开了一晚上只有自然风，室温降不下来。',
      priority: 'high', status: STATUS.COMPLETED,
      created_by: users.front, assigned_to: users.repair,
      created_at: t('-1 days'), accepted_at: t('-1 days'), completed_at: t('-23 hours'),
      resolution: '补充制冷剂 R410A，清洗滤网，试机 30 分钟制冷正常。'
    }, [
      ['created', '住客投诉室温 29℃，请尽快处理。', users.front, t('-1 days')],
      ['accepted', null, users.repair, t('-1 days')],
      ['submitted', '已加氟并清洗滤网。', users.repair, t('-24 hours')],
      ['completed', '现场复测出风口 12℃，客人确认满意。', users.admin, t('-23 hours')]
    ]);

    // 2. 待接单
    add({
      code: code(), room_id: roomIds['705'], category: '卫浴',
      title: '马桶底部渗水', description: '卫生间地面有积水，怀疑马桶法兰圈老化渗水。',
      priority: 'high', status: STATUS.PENDING,
      created_by: users.front2, created_at: t('-40 minutes')
    }, [
      ['created', '客人刚反馈，已摆放防滑提示牌。', users.front2, t('-40 minutes')]
    ]);

    // 3. 维修中 + 房间限制售卖
    add({
      code: code(), room_id: roomIds['803'], category: '水电',
      title: '卫生间洗手台下水管漏水', description: '柜内积水，下水管接口处滴水，已关闭角阀。',
      priority: 'high', status: STATUS.ACCEPTED,
      created_by: users.front, assigned_to: users.repair,
      created_at: t('-5 hours'), accepted_at: t('-4 hours')
    }, [
      ['created', '客人已换房至 805，803 暂停售卖。', users.front, t('-5 hours')],
      ['room_blocked', '漏水影响楼下房间，限制售卖待修复。', users.front, t('-5 hours')],
      ['accepted', '已到场查看，需拆卸下水管检查。', users.repair, t('-4 hours')]
    ]);

    // 4. 等待配件（预计到货日期已过 —— 逾期）
    add({
      code: code(), room_id: roomIds['808'], category: '空调',
      title: '中央空调出风口异响', description: '高档位时出风口有明显"哒哒"声，影响客人休息。',
      priority: 'normal', status: STATUS.WAITING_PARTS,
      created_by: users.front, assigned_to: users.repair2,
      parts_note: '风机马达轴承损坏，型号 YJF-61，已向厂家申购。',
      parts_expected_at: t('-1 days').slice(0, 10),
      created_at: t('-1 days'), accepted_at: t('-1 days')
    }, [
      ['created', '行政套房客人投诉，已致歉并换房。', users.front, t('-1 days')],
      ['room_blocked', '套房停售，等配件维修。', users.front, t('-1 days')],
      ['accepted', '拆机检查，确认风机马达轴承磨损。', users.repair2, t('-20 hours')],
      ['waiting_parts', '风机马达 YJF-61 申购中（预计到货：' + t('-3 days').slice(0, 10) + '）。', users.repair2, t('-19 hours')],
      ['parts_eta_changed', t('-3 days').slice(0, 10) + ' → ' + t('-1 days').slice(0, 10) + '；原因：厂家缺货改期。', users.repair2, t('-10 hours')]
    ]);

    // 5. 待验收
    add({
      code: code(), room_id: roomIds['806'], category: '网络',
      title: '电视无信号', description: '开机显示"无信号"，机顶盒指示灯不亮。',
      priority: 'normal', status: STATUS.SUBMITTED,
      created_by: users.front2, assigned_to: users.repair,
      created_at: t('-3 hours'), accepted_at: t('-3 hours'),
      resolution: '更换机顶盒电源适配器，重新搜台后 60 个频道正常。'
    }, [
      ['created', '客人晚上要看球赛，比较着急。', users.front2, t('-3 hours')],
      ['room_blocked', '维修期间暂停售卖。', users.front2, t('-3 hours')],
      ['accepted', null, users.repair, t('-2 hours')],
      ['submitted', '更换电源适配器，频道测试正常，请主管验收。', users.repair, t('-50 minutes')]
    ]);

    // 6. 验收不通过，退回维修
    add({
      code: code(), room_id: roomIds['810'], category: '门锁',
      title: '房门刷卡偶尔无反应', description: '客人反馈刷卡 3 次只有 1 次能开门，指示灯不亮。',
      priority: 'high', status: STATUS.REJECTED,
      created_by: users.front, assigned_to: users.repair2,
      reject_reason: '现场复测 10 次仍有 2 次失败，电池触点可能松动，请彻底排查后再提交。',
      created_at: t('-2 days'), accepted_at: t('-2 days')
    }, [
      ['created', '住客晚间被锁门外，投诉强烈。', users.front, t('-2 days')],
      ['accepted', null, users.repair2, t('-2 days')],
      ['submitted', '已更换门锁电池。', users.repair2, t('-1 days')],
      ['rejected', '复测仍偶发失灵，未彻底解决。', users.admin, t('-6 hours')]
    ]);

    // 7. 重复报修（802 空调修好后客人再次反映不凉）
    add({
      code: code(), room_id: roomIds['802'], category: '空调',
      title: '空调制冷效果仍不好', description: '昨天维修后客人今晚再次反馈房间不凉快，出风口风量小。',
      priority: 'high', status: STATUS.PENDING,
      created_by: users.front, is_repeat: 1, linked_ticket_id: tk1,
      created_at: t('-2 hours')
    }, [
      ['created', '同一房间第二次报修，请优先安排原维修人员跟进。', users.front, t('-2 hours')],
      ['flagged', '系统识别为 7 日内重复报修。', users.admin, t('-2 hours')]
    ]);

    // 8. 已取消（重复报/误报）
    add({
      code: code(), room_id: roomIds['701'], category: '电器',
      title: '电吹风不工作', description: '客人称电吹风按开关没反应。',
      priority: 'low', status: STATUS.CANCELLED,
      created_by: users.front2, assigned_to: null,
      created_at: t('-6 hours')
    }, [
      ['created', null, users.front2, t('-6 hours')],
      ['cancelled', '电话指导客人按下机身复位键后恢复，无需上门。', users.front2, t('-5 hours')]
    ]);

    // 9. 维修中（普通）
    add({
      code: code(), room_id: roomIds['712'], category: '家具',
      title: '书桌抽屉滑轨脱落', description: '抽屉拉出来推不回去，滑轨一侧脱落。',
      priority: 'low', status: STATUS.ACCEPTED,
      created_by: users.front2, assigned_to: users.repair2,
      created_at: t('-8 hours'), accepted_at: t('-7 hours')
    }, [
      ['created', null, users.front2, t('-8 hours')],
      ['accepted', '带工具与备用滑轨上楼处理。', users.repair2, t('-7 hours')]
    ]);

    // 10. 待接单（超时：5 小时未接单）
    add({
      code: code(), room_id: roomIds['706'], category: '网络',
      title: 'Wi-Fi 频繁掉线', description: '客人反馈视频会议时网络每几分钟断一次。',
      priority: 'high', status: STATUS.PENDING,
      created_by: users.front, created_at: t('-5 hours')
    }, [
      ['created', '商务客人，要求今天务必解决。', users.front, t('-5 hours')]
    ]);

    // 11. 等待配件（今日预计到货）
    add({
      code: code(), room_id: roomIds['812'], category: '家具',
      title: '衣柜推拉门轨道损坏', description: '推拉门脱轨无法闭合，轨道连接件断裂。',
      priority: 'normal', status: STATUS.WAITING_PARTS,
      created_by: users.front2, assigned_to: users.repair2,
      parts_note: '推拉门轨道连接件一套，库房今日调拨。',
      parts_expected_at: t('0 days').slice(0, 10),
      created_at: t('-1 days'), accepted_at: t('-1 days')
    }, [
      ['created', '客人反映衣柜门无法关闭。', users.front2, t('-1 days')],
      ['accepted', null, users.repair2, t('-22 hours')],
      ['waiting_parts', '轨道连接件断裂，库房调拨（预计到货：' + t('0 days').slice(0, 10) + '）。', users.repair2, t('-20 hours')]
    ]);

    // 12. 维修中超时（超过 24 小时未完成）
    add({
      code: code(), room_id: roomIds['708'], category: '水电',
      title: '淋浴花洒水量过小', description: '客人反映淋浴出水很小，怀疑管路堵塞。',
      priority: 'normal', status: STATUS.ACCEPTED,
      created_by: users.front, assigned_to: users.repair,
      created_at: t('-2 days'), accepted_at: t('-2 days')
    }, [
      ['created', null, users.front, t('-2 days')],
      ['accepted', '先拆喷头检查滤网，怀疑墙内管路也要疏通。', users.repair, t('-2 days')]
    ]);

    // 13. 已完成（前天，配件更换）
    add({
      code: code(), room_id: roomIds['703'], category: '电器',
      title: '电热水壶不通电', description: '底座指示灯不亮，无法烧水。',
      priority: 'low', status: STATUS.COMPLETED,
      created_by: users.front2, assigned_to: users.repair,
      created_at: t('-3 days'), accepted_at: t('-3 days'), completed_at: t('-2 days'),
      resolution: '壶底座温控开关损坏，更换备用热水壶，旧壶报损。'
    }, [
      ['created', null, users.front2, t('-3 days')],
      ['accepted', null, users.repair, t('-3 days')],
      ['waiting_parts', '仓库无同型号温控器，改为整体更换。', users.repair, t('-3 days')],
      ['parts_arrived', '从库房领到备用热水壶。', users.repair, t('-2 days')],
      ['submitted', '已更换新壶并试烧两壶水正常。', users.repair, t('-2 days')],
      ['completed', '验收通过。', users.admin, t('-2 days')]
    ]);

    // ---------- 房间日志（限制售卖记录） ----------
    insRoomLog.run(roomIds['803'], 'room_blocked', '漏水影响楼下房间，限制售卖待修复。', users.front, t('-5 hours'));
    insRoomLog.run(roomIds['808'], 'room_blocked', '套房停售，等配件维修。', users.front, t('-1 days'));
    insRoomLog.run(roomIds['806'], 'room_blocked', '维修期间暂停售卖。', users.front2, t('-3 hours'));
  });

  tx();
}

// 仅在空库时播种（首次启动）
export function ensureSeed() {
  const { c } = db.prepare(`SELECT COUNT(*) AS c FROM users`).get();
  if (c === 0) resetAndSeed();
}

// 可直接执行：node src/seed.js --force
if (import.meta.url === `file://${process.argv[1]}`) {
  const force = process.argv.includes('--force');
  if (force) {
    resetAndSeed();
    console.log('✅ 数据库已重置并写入样例数据');
  } else {
    ensureSeed();
    console.log('✅ 已确保样例数据存在（使用 --force 可重置）');
  }
}
