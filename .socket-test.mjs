/** Ad-hoc Socket.IO console streaming check. */
import { io } from 'socket.io-client';
import fs from 'node:fs';

const token = fs.readFileSync('/tmp/kilo/token.txt', 'utf8').trim();
const serverId = process.argv[2];

const socket = io('http://localhost:6767', { auth: { token }, transports: ['websocket'] });

let logChunks = 0;
let historyBytes = 0;

socket.on('connect', () => {
  console.log('CONNECT: ok', socket.id);
  socket.emit('joinServer', serverId);
});

socket.on('ready', (payload) => console.log('READY: user =', payload.user?.username));
socket.on('logHistory', (payload) => {
  historyBytes = payload.data.length;
  console.log('LOG HISTORY:', historyBytes, 'bytes');
  // Now trigger fresh output through the socket command channel.
  socket.emit('command', { serverId, command: 'say websocket streaming works' });
});
socket.on('status', (payload) => console.log('STATUS:', payload.status));
socket.on('log', (payload) => {
  logChunks += 1;
  const text = payload.data.trim().split('\n').pop();
  if (logChunks <= 6) console.log('LIVE LOG:', text?.slice(0, 110));
});
socket.on('serverError', (payload) => console.log('SERVER ERROR:', payload.error));
socket.on('connect_error', (err) => {
  console.error('CONNECT ERROR:', err.message);
  process.exit(1);
});

setTimeout(() => {
  console.log(`RESULT: history=${historyBytes > 0 ? 'yes' : 'no'} liveChunks=${logChunks}`);
  socket.emit('leaveServer', serverId);
  socket.close();
  process.exit(logChunks > 0 && historyBytes > 0 ? 0 : 1);
}, 8000);

// Unauthenticated connections must be rejected.
const anon = io('http://localhost:6767', { auth: {}, transports: ['websocket'] });
anon.on('connect', () => {
  console.log('AUTH GUARD: FAILED — anonymous socket connected');
  anon.close();
});
anon.on('connect_error', (err) => {
  console.log('AUTH GUARD: rejected anonymous socket →', err.message);
  anon.close();
});
