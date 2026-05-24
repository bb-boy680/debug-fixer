/**
 * Debugger Server - Receives frontend instrumentation POST requests and writes to log files
 * pwd is passed via HTTP request body, not CLI args. One server serves any project.
 * Directory structure: {pwd}/.debug/logs/{sessionId}.log
 * Port: fixed 9220
 *
 * Usage: node debugger-server.js
 * Health check: curl http://localhost:9220/health
 */

import http from "http";
import path from "path";
import fs from "fs";

const PORT = 9220;

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
function get(obj, pathStr, defaultValue = null) {
  return pathStr.split(".").reduce((acc, key) => acc?.[key], obj) ?? defaultValue;
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

  if (!sessionId) {
    res.writeHead(400, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "Missing session_id parameter" }));
  }

  try {
    const logData = await parseBody(req);
    const pwd = logData.pwd;

    if (!pwd) {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "Missing pwd field in request body" }));
    }

    const logsDir = path.join(pwd, ".debug", "logs");
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    if (!logData.timestamp) {
      logData.timestamp = Date.now();
    }

    // Strip pwd from the logged entry — only needed for file path resolution
    delete logData.pwd;

    const logFile = path.join(logsDir, `${sessionId}.log`);
    fs.appendFileSync(logFile, JSON.stringify(logData) + "\n");

    // Print key instrumentation to terminal
    const loc = logData.location || "";
    const msg = logData.message || "";
    if (loc) {
      console.log(`[debugger:${sessionId}] ${loc} ${msg}`);
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
  res.end(JSON.stringify({ status: "ok", service: "debugger-log", port: PORT }));
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
const server = http.createServer(routeRequest);

// Graceful shutdown
function shutdown(signal) {
  console.log(`\n[debugger] ${signal} received, shutting down...`);
  server.close(() => {
    console.log("[debugger] HTTP server closed");
    process.exit(0);
  });
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

server.listen(PORT, () => {
  console.log(`[debugger] Server started on port ${PORT}`);
  console.log("[debugger] pwd is received per-request (no project binding at startup)");
});
