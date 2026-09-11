import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { ensureSeed } from './seed.js';
import usersRouter from './routes/users.js';
import ticketsRouter from './routes/tickets.js';
import roomsRouter from './routes/rooms.js';
import statsRouter from './routes/stats.js';
import { CATEGORIES, STATUS_LABEL, PRIORITY_LABEL, ROLE_LABEL, ACTION_LABEL, STATUS_COLOR, ROOM_STATUS_LABEL } from './constants.js';

ensureSeed();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));
app.get('/api/meta', (req, res) => {
  res.json({
    categories: CATEGORIES,
    statusLabel: STATUS_LABEL,
    statusColor: STATUS_COLOR,
    priorityLabel: PRIORITY_LABEL,
    roleLabel: ROLE_LABEL,
    actionLabel: ACTION_LABEL,
    roomStatusLabel: ROOM_STATUS_LABEL
  });
});

app.use('/api/users', usersRouter);
app.use('/api/tickets', ticketsRouter);
app.use('/api/rooms', roomsRouter);
app.use('/api/stats', statsRouter);

// 统一错误处理
app.use('/api', (err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || '服务器内部错误' });
});

// 生产环境托管前端构建产物
const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
app.use(express.static(clientDist));
app.get(/^\/(?!api).*/, (req, res, next) => {
  res.sendFile(path.join(clientDist, 'index.html'), err => err && next());
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`🏨 酒店报修系统服务已启动: http://localhost:${PORT}`);
});
