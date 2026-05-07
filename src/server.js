const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");
const { TaskStore } = require("./taskStoreCore");

const ROOT = path.resolve(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_FILE = path.join(ROOT, "data", "tasks.json");
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "127.0.0.1";

const store = new TaskStore(DATA_FILE);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".ico": "image/x-icon"
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function sendError(res, error) {
  const statusCode = error.statusCode || 500;
  sendJson(res, statusCode, {
    error: error.message || "服务器错误"
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        const error = new Error("请求内容过大");
        error.statusCode = 413;
        reject(error);
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        const error = new Error("JSON 格式无效");
        error.statusCode = 400;
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function getDateParam(url) {
  return url.searchParams.get("date") || store.today();
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/tasks") {
    sendJson(res, 200, { tasks: store.listTasks(getDateParam(url)) });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/recurring-tasks") {
    sendJson(res, 200, { recurringTasks: store.listRecurringTasks() });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/recurring-tasks") {
    const body = await readBody(req);
    const recurringTask = store.createRecurringTask(body);
    sendJson(res, 201, {
      recurringTask,
      recurringTasks: store.listRecurringTasks(),
      tasks: store.listTasks(getDateParam(url), { rollover: false })
    });
    return;
  }

  const recurringTaskMatch = url.pathname.match(/^\/api\/recurring-tasks\/([^/]+)$/);
  if (req.method === "PATCH" && recurringTaskMatch) {
    const body = await readBody(req);
    const recurringTask = store.updateRecurringTask(decodeURIComponent(recurringTaskMatch[1]), body);
    sendJson(res, 200, {
      recurringTask,
      recurringTasks: store.listRecurringTasks(),
      tasks: store.listTasks(getDateParam(url), { rollover: false })
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/recurring-tasks/materialize") {
    const result = store.materializeRecurringForDate(getDateParam(url));
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/tasks") {
    const body = await readBody(req);
    const task = store.createTask(body);
    sendJson(res, 201, { task, tasks: store.listTasks(task.date, { rollover: false }) });
    return;
  }

  const taskMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)$/);
  if (req.method === "PATCH" && taskMatch) {
    const body = await readBody(req);
    const task = store.updateTask(decodeURIComponent(taskMatch[1]), body);
    sendJson(res, 200, { task, tasks: store.listTasks(task.date, { rollover: false }) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/tasks/reorder") {
    const body = await readBody(req);
    const date = body.date || getDateParam(url);
    const tasks = store.reorderTasks(date, Array.isArray(body.ids) ? body.ids : []);
    sendJson(res, 200, { tasks });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/rollover") {
    const result = store.rolloverTo(getDateParam(url));
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/worklog") {
    sendJson(res, 200, store.getWorklog(getDateParam(url)));
    return;
  }

  if (req.method === "PUT" && url.pathname === "/api/worklog") {
    const body = await readBody(req);
    sendJson(res, 200, store.saveWorklog(getDateParam(url), body.notes || ""));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/email-summary") {
    sendJson(res, 200, store.buildEmailSummary(getDateParam(url)));
    return;
  }

  const error = new Error("接口不存在");
  error.statusCode = 404;
  throw error;
}

function serveStatic(req, res, url) {
  const requestPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const resolved = path.resolve(PUBLIC_DIR, `.${requestPath}`);

  if (!resolved.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(resolved, (error, content) => {
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    const extension = path.extname(resolved).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[extension] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    serveStatic(req, res, url);
  } catch (error) {
    sendError(res, error);
  }
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`TaskAutomation is running at http://${HOST}:${PORT}/`);
  });
}

module.exports = { server, store };
