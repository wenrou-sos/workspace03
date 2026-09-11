import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data.db');

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('front_desk','maintenance','supervisor')),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS rooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_no TEXT UNIQUE NOT NULL,
  floor INTEGER NOT NULL,
  category TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available','occupied','blocked')),
  block_reason TEXT,
  blocked_by INTEGER REFERENCES users(id),
  blocked_at TEXT
);

CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  room_id INTEGER NOT NULL REFERENCES rooms(id),
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high')),
  status TEXT NOT NULL DEFAULT 'pending',
  created_by INTEGER NOT NULL REFERENCES users(id),
  assigned_to INTEGER REFERENCES users(id),
  is_repeat INTEGER NOT NULL DEFAULT 0,
  linked_ticket_id INTEGER REFERENCES tickets(id),
  parts_note TEXT,
  reject_reason TEXT,
  resolution TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  accepted_at TEXT,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_room ON tickets(room_id);
CREATE INDEX IF NOT EXISTS idx_tickets_assigned ON tickets(assigned_to);

CREATE TABLE IF NOT EXISTS ticket_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  remark TEXT,
  operator_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_logs_ticket ON ticket_logs(ticket_id);

CREATE TABLE IF NOT EXISTS room_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  remark TEXT,
  operator_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
`);

// ---------- 查询辅助 ----------

export function findUserByUsername(username) {
  return db.prepare(`SELECT * FROM users WHERE username = ?`).get(username);
}
export function getUserById(id) {
  return db.prepare(`SELECT id, username, name, role FROM users WHERE id = ?`).get(id);
}
export function listUsers(role) {
  return role
    ? db.prepare(`SELECT id, username, name, role FROM users WHERE role = ? ORDER BY id`).all(role)
    : db.prepare(`SELECT id, username, name, role FROM users ORDER BY id`).all();
}

// 工单 + 房间 + 创建人/维修人 名称
export function findTicketById(id) {
  return db.prepare(`
    SELECT t.*,
      r.room_no, r.floor AS room_floor, r.category AS room_category, r.status AS room_status, r.block_reason,
      cu.name AS created_by_name, cu.role AS created_by_role,
      au.name AS assigned_name
    FROM tickets t
    JOIN rooms r ON r.id = t.room_id
    JOIN users cu ON cu.id = t.created_by
    LEFT JOIN users au ON au.id = t.assigned_to
    WHERE t.id = ?
  `).get(id);
}

export function listTickets({ status, roomId, assigneeId, creatorId, search } = {}) {
  const where = [];
  const params = [];
  if (status) {
    if (status === 'active') {
      where.push(`t.status IN ('accepted','waiting_parts','submitted','rejected')`);
    } else {
      where.push(`t.status = ?`);
      params.push(status);
    }
  }
  if (roomId) { where.push(`t.room_id = ?`); params.push(roomId); }
  if (assigneeId) { where.push(`t.assigned_to = ?`); params.push(assigneeId); }
  if (creatorId) { where.push(`t.created_by = ?`); params.push(creatorId); }
  if (search) {
    where.push(`(t.code LIKE ? OR r.room_no LIKE ? OR t.title LIKE ?)`);
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  const sql = `
    SELECT t.*,
      r.room_no, r.floor AS room_floor, r.status AS room_status, r.block_reason,
      cu.name AS created_by_name,
      au.name AS assigned_name
    FROM tickets t
    JOIN rooms r ON r.id = t.room_id
    JOIN users cu ON cu.id = t.created_by
    LEFT JOIN users au ON au.id = t.assigned_to
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY
      CASE t.status WHEN 'pending' THEN 0 WHEN 'rejected' THEN 1
                    WHEN 'accepted' THEN 2 WHEN 'waiting_parts' THEN 3
                    WHEN 'submitted' THEN 4 ELSE 5 END,
      t.priority = 'high' DESC,
      t.created_at DESC
  `;
  return db.prepare(sql).all(...params);
}

export function listLogs(ticketId) {
  return db.prepare(`
    SELECT l.*, u.name AS operator_name, u.role AS operator_role
    FROM ticket_logs l
    LEFT JOIN users u ON u.id = l.operator_id
    WHERE l.ticket_id = ?
    ORDER BY l.created_at ASC, l.id ASC
  `).all(ticketId);
}

export function listRoomLogs(roomId) {
  return db.prepare(`
    SELECT l.*, u.name AS operator_name, u.role AS operator_role
    FROM room_logs l
    LEFT JOIN users u ON u.id = l.operator_id
    WHERE l.room_id = ?
    ORDER BY l.created_at DESC, l.id DESC
  `).all(roomId);
}

export function getRoomById(id) {
  return db.prepare(`SELECT * FROM rooms WHERE id = ?`).get(id);
}
export function getRoomByNo(roomNo) {
  return db.prepare(`SELECT * FROM rooms WHERE room_no = ?`).get(roomNo);
}
export function listRooms(status) {
  return status
    ? db.prepare(`SELECT * FROM rooms WHERE status = ? ORDER BY room_no`).all(status)
    : db.prepare(`SELECT * FROM rooms ORDER BY room_no`).all();
}

// 该房间最近一笔未完结工单（用于重复报修判定）
export function findOpenTicketForRoom(roomId) {
  return db.prepare(`
    SELECT * FROM tickets
    WHERE room_id = ? AND status NOT IN ('completed','cancelled')
    ORDER BY created_at DESC, id DESC LIMIT 1
  `).get(roomId);
}

// 近 N 天内同房间未完成工单
export function findRecentOpenTicket(roomId, days = 7) {
  return db.prepare(`
    SELECT * FROM tickets
    WHERE room_id = ? AND status NOT IN ('completed','cancelled')
      AND created_at >= datetime('now','localtime', ?)
    ORDER BY created_at DESC, id DESC LIMIT 1
  `).get(roomId, `-${days} days`);
}
