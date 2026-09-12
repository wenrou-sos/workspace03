// 工单状态机
export const STATUS = {
  PENDING: 'pending',          // 待接单
  ACCEPTED: 'accepted',        // 维修中（已接单）
  WAITING_PARTS: 'waiting_parts', // 等待配件
  SUBMITTED: 'submitted',      // 待验收
  REJECTED: 'rejected',        // 验收不通过（退回维修）
  COMPLETED: 'completed',      // 已完成
  CANCELLED: 'cancelled'       // 已取消
};

export const STATUS_FLOW = {
  pending:        ['accepted', 'cancelled'],
  accepted:       ['waiting_parts', 'submitted', 'cancelled'],
  waiting_parts:  ['accepted', 'submitted', 'cancelled'],
  submitted:      ['completed', 'rejected'],
  rejected:       ['accepted', 'waiting_parts', 'submitted', 'cancelled'],
  completed:      [],
  cancelled:      []
};

// 终态
export const FINAL_STATUS = [STATUS.COMPLETED, STATUS.CANCELLED];
// 维修人员"我的工单"包含的进行中状态
export const ACTIVE_STATUS = ['accepted', 'waiting_parts', 'submitted', 'rejected'];

export const STATUS_LABEL = {
  pending: '待接单',
  accepted: '维修中',
  waiting_parts: '等待配件',
  submitted: '待验收',
  rejected: '验收不通过',
  completed: '已完成',
  cancelled: '已取消'
};

// 状态徽标配色（前端复用）
export const STATUS_COLOR = {
  pending: '#9ca3af',
  accepted: '#2563eb',
  waiting_parts: '#d97706',
  submitted: '#7c3aed',
  rejected: '#dc2626',
  completed: '#059669',
  cancelled: '#6b7280'
};

export const PRIORITY_LABEL = {
  low: '低',
  normal: '普通',
  high: '紧急'
};

export const ROLE_LABEL = {
  front_desk: '前台',
  maintenance: '维修员',
  supervisor: '主管'
};

// 日志动作
export const ACTION_LABEL = {
  created: '提交报修',
  accepted: '接单处理',
  waiting_parts: '申请等待配件',
  parts_arrived: '配件到位，恢复维修',
  submitted: '提交验收',
  rejected: '验收不通过',
  completed: '验收通过，工单完成',
  cancelled: '取消工单',
  room_blocked: '房间限制售卖',
  room_unblocked: '解除限制售卖',
  room_kept_blocked: '仍有未完结工单，维持限制售卖',
  flagged: '标记为重复报修'
};

export const CATEGORIES = [
  '水电', '空调', '电器', '卫浴', '家具', '门锁', '网络', '其他'
];

export const ROOM_STATUS_LABEL = {
  available: '可售',
  occupied: '在住',
  blocked: '限制售卖'
};
