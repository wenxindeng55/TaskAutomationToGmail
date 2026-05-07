const fs = require("node:fs");
const path = require("node:path");

const TIME_ZONE = "Asia/Shanghai";
const STATUSES = ["待办", "进行中", "阻塞", "完成", "取消"];
const ACTIVE_STATUSES = ["待办", "进行中", "阻塞"];
const PRIORITIES = ["紧急", "高", "中", "低"];
const TERMINAL_STATUSES = ["完成", "取消"];

function formatDateInZone(date = new Date(), timeZone = TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function isDateString(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isTimeString(value) {
  return value === "" || (typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value));
}

function compareDateStrings(a, b) {
  return a.localeCompare(b);
}

function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function asText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeData(raw) {
  const data = raw && typeof raw === "object" ? raw : {};
  return {
    tasks: Array.isArray(data.tasks) ? data.tasks : [],
    worklogs: data.worklogs && typeof data.worklogs === "object" ? data.worklogs : {}
  };
}

function taskSort(a, b) {
  const orderA = Number.isFinite(a.order) ? a.order : 0;
  const orderB = Number.isFinite(b.order) ? b.order : 0;
  if (orderA !== orderB) return orderA - orderB;
  return String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
}

class TaskStore {
  constructor(filePath, options = {}) {
    this.filePath = filePath;
    this.timeZone = options.timeZone || TIME_ZONE;
  }

  today() {
    return formatDateInZone(new Date(), this.timeZone);
  }

  load() {
    if (!fs.existsSync(this.filePath)) {
      this.save({ tasks: [], worklogs: {} });
    }

    const raw = fs.readFileSync(this.filePath, "utf8");
    return normalizeData(raw ? JSON.parse(raw) : {});
  }

  save(data) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const normalized = normalizeData(data);
    fs.writeFileSync(this.filePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
    return normalized;
  }

  listTasks(date = this.today(), options = {}) {
    const targetDate = isDateString(date) ? date : this.today();
    if (options.rollover !== false && targetDate === this.today()) {
      this.rolloverTo(targetDate);
    }

    const data = this.load();
    return data.tasks
      .filter((task) => task.date === targetDate)
      .sort(taskSort);
  }

  createTask(input = {}) {
    const data = this.load();
    const now = new Date().toISOString();
    const date = isDateString(input.date) ? input.date : this.today();
    const title = asText(input.title);

    if (!title) {
      const error = new Error("任务标题不能为空");
      error.statusCode = 400;
      throw error;
    }

    const status = STATUSES.includes(input.status) ? input.status : "待办";
    const priority = PRIORITIES.includes(input.priority) ? input.priority : "中";
    const plannedTime = asText(input.plannedTime);
    if (!isTimeString(plannedTime)) {
      const error = new Error("计划时间必须是 HH:mm 格式");
      error.statusCode = 400;
      throw error;
    }

    const task = {
      id: makeId(),
      title,
      description: asText(input.description),
      date,
      sourceDate: isDateString(input.sourceDate) ? input.sourceDate : null,
      priority,
      plannedTime,
      status,
      notes: asText(input.notes),
      order: this.nextOrder(data.tasks, date, priority, status),
      createdAt: now,
      updatedAt: now
    };

    data.tasks.push(task);
    this.compactOrders(data.tasks, date);
    this.save(data);
    return task;
  }

  updateTask(id, patch = {}) {
    const data = this.load();
    const task = data.tasks.find((item) => item.id === id);
    if (!task) {
      const error = new Error("任务不存在");
      error.statusCode = 404;
      throw error;
    }

    const beforeDate = task.date;
    const beforePriority = task.priority;
    const beforeStatus = task.status;

    if (Object.prototype.hasOwnProperty.call(patch, "title")) {
      const title = asText(patch.title);
      if (!title) {
        const error = new Error("任务标题不能为空");
        error.statusCode = 400;
        throw error;
      }
      task.title = title;
    }

    if (Object.prototype.hasOwnProperty.call(patch, "description")) {
      task.description = asText(patch.description);
    }

    if (Object.prototype.hasOwnProperty.call(patch, "date")) {
      if (!isDateString(patch.date)) {
        const error = new Error("任务日期必须是 YYYY-MM-DD 格式");
        error.statusCode = 400;
        throw error;
      }
      task.date = patch.date;
    }

    if (Object.prototype.hasOwnProperty.call(patch, "priority")) {
      if (!PRIORITIES.includes(patch.priority)) {
        const error = new Error("优先级无效");
        error.statusCode = 400;
        throw error;
      }
      task.priority = patch.priority;
    }

    if (Object.prototype.hasOwnProperty.call(patch, "plannedTime")) {
      const plannedTime = asText(patch.plannedTime);
      if (!isTimeString(plannedTime)) {
        const error = new Error("计划时间必须是 HH:mm 格式");
        error.statusCode = 400;
        throw error;
      }
      task.plannedTime = plannedTime;
    }

    if (Object.prototype.hasOwnProperty.call(patch, "status")) {
      if (!STATUSES.includes(patch.status)) {
        const error = new Error("状态无效");
        error.statusCode = 400;
        throw error;
      }
      task.status = patch.status;
    }

    if (Object.prototype.hasOwnProperty.call(patch, "notes")) {
      task.notes = asText(patch.notes);
    }

    task.updatedAt = new Date().toISOString();

    const movedToNewDate = beforeDate !== task.date;
    const becameUrgent =
      beforePriority !== "紧急" &&
      task.priority === "紧急" &&
      ACTIVE_STATUSES.includes(task.status);
    const reactivated = TERMINAL_STATUSES.includes(beforeStatus) && ACTIVE_STATUSES.includes(task.status);

    if (movedToNewDate || becameUrgent || reactivated) {
      task.order = this.nextOrder(data.tasks.filter((item) => item.id !== id), task.date, task.priority, task.status);
    }

    this.compactOrders(data.tasks, beforeDate);
    this.compactOrders(data.tasks, task.date);
    this.save(data);
    return task;
  }

  reorderTasks(date, ids = []) {
    if (!isDateString(date)) {
      const error = new Error("任务日期必须是 YYYY-MM-DD 格式");
      error.statusCode = 400;
      throw error;
    }

    const data = this.load();
    const idSet = new Set(ids);
    const activeTasks = data.tasks
      .filter((task) => task.date === date && ACTIVE_STATUSES.includes(task.status))
      .sort(taskSort);

    const activeIds = activeTasks.map((task) => task.id);
    if (ids.length !== activeIds.length || activeIds.some((id) => !idSet.has(id))) {
      const error = new Error("排序列表必须包含当天所有未完成任务");
      error.statusCode = 400;
      throw error;
    }

    const byId = new Map(activeTasks.map((task) => [task.id, task]));
    ids.forEach((id, index) => {
      byId.get(id).order = index;
      byId.get(id).updatedAt = new Date().toISOString();
    });

    this.save(data);
    return this.listTasks(date, { rollover: false });
  }

  rolloverTo(date = this.today()) {
    if (!isDateString(date)) {
      const error = new Error("任务日期必须是 YYYY-MM-DD 格式");
      error.statusCode = 400;
      throw error;
    }

    const data = this.load();
    const moving = data.tasks
      .filter((task) => compareDateStrings(task.date, date) < 0 && !TERMINAL_STATUSES.includes(task.status))
      .sort(taskSort);

    if (moving.length === 0) {
      return {
        moved: [],
        tasks: data.tasks.filter((task) => task.date === date).sort(taskSort)
      };
    }

    let order = this.maxOrder(data.tasks, date) + 1;
    const now = new Date().toISOString();
    for (const task of moving) {
      task.sourceDate = task.sourceDate || task.date;
      task.date = date;
      task.order = order;
      task.updatedAt = now;
      order += 1;
    }

    this.compactOrders(data.tasks, date);
    this.save(data);
    return {
      moved: moving,
      tasks: data.tasks.filter((task) => task.date === date).sort(taskSort)
    };
  }

  getWorklog(date = this.today()) {
    const targetDate = isDateString(date) ? date : this.today();
    if (targetDate === this.today()) {
      this.rolloverTo(targetDate);
    }

    const data = this.load();
    const saved = data.worklogs[targetDate] || { date: targetDate, notes: "", updatedAt: null };

    return {
      date: targetDate,
      notes: saved.notes || "",
      updatedAt: saved.updatedAt || null,
      draft: this.buildWorklogDraft(targetDate)
    };
  }

  saveWorklog(date = this.today(), notes = "") {
    if (!isDateString(date)) {
      const error = new Error("任务日期必须是 YYYY-MM-DD 格式");
      error.statusCode = 400;
      throw error;
    }

    const data = this.load();
    data.worklogs[date] = {
      date,
      notes: asText(notes),
      updatedAt: new Date().toISOString()
    };
    this.save(data);
    return this.getWorklog(date);
  }

  buildWorklogDraft(date = this.today()) {
    const tasks = this.listTasks(date, { rollover: false });
    const sections = ["完成", "进行中", "阻塞", "待办"];
    const lines = [`${date} 工作记录草稿`, ""];

    for (const status of sections) {
      const items = tasks.filter((task) => task.status === status);
      lines.push(`${status}：`);
      if (items.length === 0) {
        lines.push("- 无");
      } else {
        for (const task of items) {
          const time = task.plannedTime ? ` ${task.plannedTime}` : "";
          const priority = task.priority ? ` [${task.priority}]` : "";
          const source = task.sourceDate && task.sourceDate !== task.date ? `（来自 ${task.sourceDate}）` : "";
          const notes = task.notes ? ` - ${task.notes}` : "";
          lines.push(`- ${time}${priority} ${task.title}${source}${notes}`.replace("-  ", "- "));
        }
      }
      lines.push("");
    }

    const canceled = tasks.filter((task) => task.status === "取消");
    if (canceled.length > 0) {
      lines.push("取消：");
      for (const task of canceled) {
        lines.push(`- ${task.title}`);
      }
      lines.push("");
    }

    return lines.join("\n").trimEnd();
  }

  buildEmailSummary(date = this.today(), dashboardUrl = "http://localhost:8787/") {
    const targetDate = isDateString(date) ? date : this.today();
    this.rolloverTo(targetDate);
    const tasks = this.listTasks(targetDate, { rollover: false });
    const urgent = tasks.filter((task) => task.priority === "紧急" && !TERMINAL_STATUSES.includes(task.status));
    const active = tasks.filter((task) => ACTIVE_STATUSES.includes(task.status));
    const blocked = tasks.filter((task) => task.status === "阻塞");
    const done = tasks.filter((task) => task.status === "完成");

    const formatTask = (task) => {
      const time = task.plannedTime ? `${task.plannedTime} ` : "";
      const source = task.sourceDate && task.sourceDate !== task.date ? `（来自 ${task.sourceDate}）` : "";
      return `- ${time}[${task.priority}] ${task.title}${source}`;
    };

    const lines = [
      "早上好，今天的任务摘要如下。",
      "",
      `面板入口：${dashboardUrl}`,
      "",
      "今日紧急任务：",
      ...(urgent.length > 0 ? urgent.map(formatTask) : ["- 无"]),
      "",
      "今日待办摘要：",
      ...(active.length > 0 ? active.map(formatTask) : ["- 当前没有未完成任务"]),
      "",
      "阻塞项：",
      ...(blocked.length > 0 ? blocked.map(formatTask) : ["- 无"]),
      "",
      `已完成：${done.length} 项`,
      "",
      "如果本地页面打不开，请先在 D:\\200\\TaskAutomation 执行 npm start，然后再打开 http://localhost:8787/。"
    ];

    return {
      subject: `今日任务摘要 - ${targetDate}`,
      body: lines.join("\n")
    };
  }

  nextOrder(tasks, date, priority, status) {
    const sameDate = tasks.filter((task) => task.date === date);
    if (priority === "紧急" && ACTIVE_STATUSES.includes(status)) {
      const activeOrders = sameDate
        .filter((task) => ACTIVE_STATUSES.includes(task.status))
        .map((task) => (Number.isFinite(task.order) ? task.order : 0));
      return activeOrders.length > 0 ? Math.min(...activeOrders) - 1 : 0;
    }
    return this.maxOrder(tasks, date) + 1;
  }

  maxOrder(tasks, date) {
    const orders = tasks
      .filter((task) => task.date === date)
      .map((task) => (Number.isFinite(task.order) ? task.order : -1));
    return orders.length > 0 ? Math.max(...orders) : -1;
  }

  compactOrders(tasks, date) {
    const sameDate = tasks.filter((task) => task.date === date).sort(taskSort);
    sameDate.forEach((task, index) => {
      task.order = index;
    });
  }
}

module.exports = {
  TaskStore,
  STATUSES,
  ACTIVE_STATUSES,
  PRIORITIES,
  TERMINAL_STATUSES,
  TIME_ZONE,
  formatDateInZone
};
