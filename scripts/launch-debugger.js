/**
 * Cross-platform debugger server launcher
 * Opens a new terminal window with Node.js to run debugger-server.js
 */

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const scriptPath = path.join(__dirname, 'debugger-server.js');
const cwd = process.cwd();

const isWindows = process.platform === 'win32';
const isMac = process.platform === 'darwin';

function launchWindows() {
  // Windows: use `start` command to open new cmd window
  spawn('cmd', ['/c', 'start', '', 'node', scriptPath], {
    cwd,
    detached: true,
    stdio: 'ignore'
  });
  console.log('[launcher] Debugger server launched in new window (Windows)');
}

function launchMac() {
  // macOS: use AppleScript to open new Terminal window
  const cmd = `cd "${cwd}" && node "${scriptPath}"`;
  spawn('osascript', ['-e', `tell application "Terminal" to do script "${cmd}"`], {
    detached: true,
    stdio: 'ignore'
  });
  console.log('[launcher] Debugger server launched in new window (macOS)');
}

function launchLinux() {
  // Linux: try multiple terminal emulators
  const terminals = [
    { name: 'gnome-terminal', args: ['--', 'bash', '-c', `cd "${cwd}" && node "${scriptPath}"; exec bash`] },
    { name: 'konsole', args: ['-e', 'bash', '-c', `cd "${cwd}" && node "${scriptPath}"; exec bash`] },
    { name: 'xfce4-terminal', args: ['-e', `bash -c "cd '${cwd}' && node '${scriptPath}'; exec bash"`] },
    { name: 'x-terminal-emulator', args: ['-e', `bash -c "cd '${cwd}' && node '${scriptPath}'; exec bash"`] },
    { name: 'alacritty', args: ['-e', 'bash', '-c', `cd "${cwd}" && node "${scriptPath}"; exec bash`] },
  ];

  for (const term of terminals) {
    try {
      spawn(term.name, term.args, {
        cwd,
        detached: true,
        stdio: 'ignore'
      });
      console.log(`[launcher] Debugger server launched in new window (${term.name})`);
      return;
    } catch {
      // Try next terminal.
    }
  }

  // Fallback: run in background without new window
  console.log('[launcher] No terminal emulator found, running in background');
  spawn('node', [scriptPath], {
    cwd,
    detached: true,
    stdio: 'ignore'
  });
}

// Launch based on platform
if (isWindows) {
  launchWindows();
} else if (isMac) {
  launchMac();
} else {
  launchLinux();
}
