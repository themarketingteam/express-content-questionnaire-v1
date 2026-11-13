import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url));
const directory = path.join(root, '.local-preview'); fs.mkdirSync(directory, { recursive: true });
const pidFile = path.join(directory, 'server.pid');
const logFile = path.join(directory, 'server.log');
const command = process.argv[2] || 'status';
const pid = fs.existsSync(pidFile) ? Number(fs.readFileSync(pidFile, 'utf8')) : 0;
const alive = () => { try { if (!pid) return false; process.kill(pid, 0); return true; } catch { return false; } };
if (command === 'stop') {
  if (alive()) process.kill(pid, 'SIGTERM');
  if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile);
  console.log('Local Express questionnaire server stopped.');
} else if (command === 'start') {
  if (alive()) console.log(`Local Express questionnaire is running: http://localhost:5174 (PID ${pid})`);
  else {
    const log = fs.openSync(logFile, 'a');
    const child = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--config', 'vite.local.config.js'], { cwd: root, detached: true, stdio: ['ignore', log, log], env: { ...process.env, VITE_LOCAL_PREVIEW: 'true' } });
    fs.writeFileSync(pidFile, String(child.pid)); child.unref(); fs.closeSync(log);
    console.log(`Local Express questionnaire starting at http://localhost:5174 (PID ${child.pid}). Log: ${logFile}`);
  }
} else console.log(alive() ? `Running: http://localhost:5174 (PID ${pid})` : 'Stopped. Run npm run local:start.');
