/**
 * Free TCP port before `node --watch` starts.
 * Avoids EADDRINUSE when a previous assesshub-api process was left running.
 */
import { execSync } from 'child_process';

const port = String(process.env.PORT || 4000);

function pidsOnPort(p) {
  try {
    if (process.platform === 'win32') {
      const out = execSync(`netstat -ano`, { encoding: 'utf8' });
      const pids = new Set();
      for (const line of out.split(/\r?\n/)) {
        if (!line.includes(`:${p}`) || !line.includes('LISTENING')) continue;
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (/^\d+$/.test(pid) && pid !== '0') pids.add(pid);
      }
      return [...pids];
    }
    const out = execSync(`lsof -tiTCP:${p} -sTCP:LISTEN`, { encoding: 'utf8' }).trim();
    return out ? out.split(/\s+/).filter(Boolean) : [];
  } catch {
    return [];
  }
}

const pids = pidsOnPort(port);
for (const pid of pids) {
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /PID ${pid} /F /T`, { stdio: 'ignore' });
    } else {
      process.kill(Number(pid), 'SIGTERM');
    }
    console.log(`Freed port ${port} (killed PID ${pid})`);
  } catch {
    // already gone
  }
}
