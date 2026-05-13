/**
 * Debugger Server - Receives frontend instrumentation POST requests and writes to log files
 * Directory structure: .debug/logs/{sessionId}.log
 * Port strategy: Auto-detect starting from 9220, increment +1 if occupied
 */

import http from "http";
import path from "path";
import fs from "fs";

const ROOT_DIR = process.cwd();
const DEBUG_DIR = path.join(ROOT_DIR, ".debug");
const LOGS_DIR = path.join(ROOT_DIR, ".debug", "logs");

/**
 * Find available port: Increment from startPort until finding an unoccupied port
 */
function findAvailablePort(startPort, maxAttempts = 20) {
  return new Promise((resolve, reject) => {
    let currentPort = startPort;
    let attempts = 0;

    function tryPort(port) {
      if (attempts >= maxAttempts) {
        reject(
          new Error(`No available port found (tried ${startPort}-${startPort + maxAttempts - 1})`)
        );
        return;
      }
      attempts++;

      const server = http.createServer();
      server.listen(port, () => {
        server.close();
        resolve(port);
      });
      server.on("error", (err) => {
        if (err.code === "EADDRINUSE" || err.code === "EACCES") {
          tryPort(port + 1);
        } else {
          reject(err);
        }
      });
    }

    tryPort(currentPort);
  });
}

/**
 * Parse request body
 */
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk.toString()));
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

/**
 * Safely extract nested properties
 */
function get(obj, path, defaultValue = null) {
  return path.split(".").reduce((acc, key) => acc?.[key], obj) ?? defaultValue;
}

/**
 * Get client IP
 */
function getClientIp(req) {
  return (
    get(req, "headers.x-forwarded-for", "")?.split(",")[0] ||
    get(req, "socket.remoteAddress", "unknown")
  );
}

/**
 * Append log entry to the corresponding session's log file
 */
function appendLog(sessionId, logEntry) {
  if (!LOGS_DIR) return;
  const logFile = path.join(LOGS_DIR, `${sessionId}.log`);
  fs.appendFileSync(logFile, JSON.stringify(logEntry) + "\n");
}

/**
 * Set CORS headers for cross-origin requests
 */
function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

/**
 * Route: Receive instrumentation logs
 */
async function handleLogRequest(req, res) {
  setCorsHeaders(res);

  // Handle OPTIONS preflight request
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const sessionId = url.searchParams.get("session_id");
  const clientIp = getClientIp(req);

  if (!sessionId) {
    res.writeHead(400, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "Missing session_id parameter" }));
  }

  try {
    const logData = await parseBody(req);
    const timestamp = logData.timestamp || Date.now();

    const logEntry = {
      timestamp,
      level: get(logData, "level", "info"),
      session: sessionId,
      service: get(logData, "service", "debugger-log"),
      client_ip: clientIp,
      user_agent: get(req, "headers.user-agent", ""),
      file: get(logData, "location", get(logData, "file", "")),
      line: get(logData, "line", 0),
      message: get(logData, "message", ""),
      data: get(logData, "data", {}),
      raw: logData,
    };

    appendLog(sessionId, logEntry);

    // Print key instrumentation to terminal
    const info = logEntry;
    if (info.file) {
      console.log(`[debugger:${sessionId}] ${info.file}:${info.line} ${info.message}`);
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "logged" }));
  } catch (err) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `Bad request: ${err.message}` }));
  }
}

/**
 * Health check
 */
function handleHealthCheck(res) {
  setCorsHeaders(res);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ status: "ok", service: "debugger-log" }));
}

/**
 * Request routing
 */
async function routeRequest(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    switch (pathname) {
      case "/health":
        return handleHealthCheck(res);
      case "/debug/log":
        return await handleLogRequest(req, res);
      default:
        setCorsHeaders(res);
        res.writeHead(404, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: `Not found: ${pathname}` }));
    }
  } catch (err) {
    setCorsHeaders(res);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `Internal error: ${err.message}` }));
  }
}

// Start server
const DEFAULT_PORT = 9220;

async function start() {
  // Ensure log directory exists
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }

  const port = await findAvailablePort(DEFAULT_PORT);
  const server = http.createServer(routeRequest);

  // Graceful shutdown
  function shutdown(signal) {
    console.log(`\n[debugger] ${signal} received, shutting down...`);
    server.close(() => {
      console.log("[debugger] HTTP server closed");
      process.exit(0);
    });
    // Force exit
    setTimeout(() => {
      console.error("[debugger] Forced shutdown");
      process.exit(1);
    }, 3000);
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  server.on("error", (err) => {
    console.error(`[debugger] Server error: ${err.message}`);
  });

  server.listen(port, () => {
    console.log(`[debugger] Server started on port ${port}`);
    console.log(`[debugger] Logs directory: ${LOGS_DIR}`);
  });
}

start().catch((err) => {
  console.error(`[debugger] Fatal error: ${err.message}`);
  process.exit(1);
});