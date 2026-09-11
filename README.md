# 🏨 酒店客房报修系统

面向酒店客房故障报修全流程的管理系统：**前台**提交报修 → **维修人员**接单处理 → **主管**验收与进度监控。覆盖等待配件、验收不通过返工、重复报修识别、房间限制售卖等实际业务场景。

## 技术栈

- **前端**：React 18 + Vite（纯函数组件/Hooks，无额外 UI 库）
- **后端**：Express 4 + JWT 鉴权 + bcrypt 密码哈希
- **数据库**：SQLite（better-sqlite3，零配置，文件位于 `server/data.db`）

## 快速开始

```bash
npm install        # 安装全部依赖
npm run dev        # 同时启动后端(4000) 与前端(5173)
```

打开 http://localhost:5173 ，使用下面的样例账号登录。

生产模式（单端口）：

```bash
npm run build      # 构建前端到 client/dist
npm start          # Express 同时提供 API 与静态页面 → http://localhost:4000
```

重置样例数据：

```bash
npm run seed               # 空库时自动播种
npm run seed -- --force    # 强制清空并重写样例数据
```

## 样例账号

| 角色 | 账号 | 密码 | 说明 |
|------|------|------|------|
| 前台 | `front` | `front123` | 王晓 |
| 前台 | `front2` | `front123` | 李婷 |
| 维修员 | `repair` | `repair123` | 张建国 |
| 维修员 | `repair2` | `repair123` | 赵伟 |
| 主管 | `admin` | `admin123` | 陈主管 |

样例数据包含 16 间客房（7/8 两层，含在住、可售、限制售卖）与 11 笔覆盖全部状态的工单。

## 工单状态机

```
                 ┌──────────────┐
   前台报修  ──▶ │   pending    │ 待接单
                 └──────┬───────┘
                        │ 维修员接单
                        ▼
                 ┌──────────────┐  等待配件   ┌──────────────┐
                 │   accepted   │ ─────────▶ │ waiting_parts│
                 │   维修中     │ ◀───────── │  等待配件     │
                 └──────┬───────┘  配件到位   └──────┬───────┘
                        │ 提交验收                  │ 也可直接提交
                        ▼                           ▼
                 ┌──────────────┐
                 │  submitted   │ 待验收
                 └──┬───────┬───┘
          验收通过  │       │ 验收不通过（填原因）
                    ▼       ▼
            ┌──────────┐ ┌──────────────┐
            │ completed│ │   rejected   │ ──▶ 维修员重新接单/等配件/提交
            │ 已完成   │ │ 验收不通过    │
            └──────────┘ └──────────────┘
   任意非终态可由创建前台或主管取消 ──▶ cancelled
```

## 核心业务规则

- **等待配件**：只有接单维修员本人可申请，必须填写配件与预计到货时间；配件到位后一键恢复维修，全程写入工单时间线。
- **验收不通过**：主管驳回必须填写原因，工单退回维修员（保留维修说明与驳回原因），维修员可重新接单处理后再次提交。
- **重复报修**：
  - 同房间已有**未完结工单** → 前台提交时提示冲突，勾选确认后作为重复报修提交；
  - 同房间**同类故障 7 天内修过** → 判定疑似复发，同样需确认；
  - 重复工单带「重复」标记并记录关联工单号，主管视图有专门筛选页。
- **房间限制售卖**：
  - 前台/主管可对房间设置「限制售卖」，必须填写原因；房间卡片红色标识，详情可查操作记录；
  - 工单列表中标注 ⛔，工单详情展示停售原因；
  - 主管**验收通过时若房间仍停售，自动解除限制售卖**并双写工单/房间日志；
  - 维修完成时维修员也可手动申请解除。
- **权限**：JWT + 角色中间件，维修员只能操作自己接的单；前台只能取消自己提交的单；看板统计仅主管可见。

## 角色视图

- **前台**：新建报修（带重复预判）、我的报修进度、全部工单、客房限制/解除售卖
- **维修员**：待接工单池（带角标）、我的工单、返工单、等待配件→恢复→提交验收
- **主管**：进度看板（状态统计、7 天趋势、人员工作量、类别分布、超时预警）、验收通过/驳回、重复报修与停售房专项筛选

## 接口一览

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| POST | `/api/users/login` | - | 登录获取 JWT |
| GET | `/api/tickets` | 登录 | 列表，支持 `status/room_id/assignee=me/mine=1/search` |
| GET | `/api/tickets/check-repeat` | 登录 | 重复报修预判 |
| POST | `/api/tickets` | 前台/主管 | 创建报修（冲突时需 `forceRepeat`） |
| POST | `/api/tickets/:id/accept` | 维修员 | 接单 |
| POST | `/api/tickets/:id/waiting-parts` | 接单人 | 等待配件 |
| POST | `/api/tickets/:id/resume` | 接单人 | 配件到位恢复 |
| POST | `/api/tickets/:id/submit` | 接单人 | 提交验收（需维修说明） |
| POST | `/api/tickets/:id/complete` | 主管 | 验收通过（自动解封房间） |
| POST | `/api/tickets/:id/reject` | 主管 | 验收不通过（需原因） |
| POST | `/api/tickets/:id/cancel` | 创建前台/主管 | 取消（需原因） |
| GET/POST | `/api/rooms[/:id/(un)block]` | 按角色 | 客房与限制售卖 |
| GET | `/api/stats/overview` | 主管 | 看板统计 |

## 目录结构

```
server/
  src/
    index.js          # Express 入口（含生产静态托管）
    constants.js      # 状态机/标签/颜色等常量
    db.js             # SQLite 建表与查询
    seed.js           # 样例数据（可重复执行）
    middleware/auth.js
    routes/           # users / tickets / rooms / stats
  test-e2e.mjs        # 43 项端到端接口测试
client/
  src/
    App.jsx           # 角色工作台与 Tab 路由
    api.js auth.jsx
    pages/            # Login / Dashboard
    components/       # TicketList / TicketDetail / NewTicketModal / RoomsView / ui
```

## 测试

```bash
# 需要服务运行在 4000 端口
node server/test-e2e.mjs
```

覆盖鉴权、角色权限、完整生命周期（接单→等配件→恢复→驳回→返工→通过）、重复报修冲突、限制售卖/自动解封、看板统计等 43 个断言。
