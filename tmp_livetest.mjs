import { io } from 'socket.io-client';
import axios from 'axios';

const BASE = 'http://localhost:6767/api';
const user = 'testlive_' + Date.now();
const pass = 'Test1234!';

async function main() {
  await axios.post(`${BASE}/auth/register`, { username: user, password: pass, email: `${user}@x.io` }).catch(() => {});
  const { data } = await axios.post(`${BASE}/auth/login`, { username: user, password: pass });
  const token = data.token;
  if (!token) throw new Error('no token: ' + JSON.stringify(data));

  const socket = io('http://localhost:6767', { path: '/socket.io', auth: { token }, transports: ['websocket'] });

  let gotStats = false;
  let gotNodes = false;
  let gotServerStats = false;

  socket.on('systemStats', (p) => { gotStats = true; console.log('systemStats cpu%', p.cpuPercent); });
  socket.on('nodes', (p) => { gotNodes = true; console.log('nodes count', p.length); });

  // join a (likely non-existent) server room to confirm no crash
  socket.on('serverStats', () => { gotServerStats = true; });
  socket.on('connect', () => { socket.emit('joinServer', 'nonexistent-id'); });

  await new Promise((r) => setTimeout(r, 7000));
  socket.close();

  console.log('RESULT', { gotStats, gotNodes, gotServerStats });
  if (!gotStats || !gotNodes) process.exit(2);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
