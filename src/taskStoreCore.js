const fs = require("node:fs");
const path = require("node:path");

const TIME_ZONE = "Asia/Shanghai";
const STATUSES = ["待办", "进行中", "阻塞", "完成", "取消"];
const ACTIVE_STATUSES = ["待办", "进行中", "阻塞"];
const PRIORITIES = ["紧急", "高", "中", "低"];
const TERMINAL_STATUSES = ["完成", "取消"];
const RECURRENCE_TYPES = ["daily", "weekdays", "weekly", "monthlyDate", "monthlyLastWeekday"];

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
    recurringTasks: Array.isArray(data.recurringTasks) ? data.recurringTasks : [],
    worklogs: data.worklogs && typeof data.worklogs === "object" ? data.worklogs : {}
  };
}

function taskSort(a, b) {
  const orderA = Number.isFinite(a.order) ? a.order : 0;
  const orderB = Number.isFinite(b.order) ? b.order : 0;
  if (orderA !== orderB) return orderA - orderB;
  return String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
}

function parseDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function isoDayOfWeek(dateString) {
  const day = parseDate(dateString).getUTCDay();
  return day === 0 ? 7 : day;
}

function dayOfMonth(dateString) {
  return Number(dateString.slice(8, 10));
}

function daysInMonth(dateString) {
  const year = Number(dateString.slice(0, 4));
  const month = Number(dateString.slice(5, 7));
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function isLastWeekdayOfMonth(dateString) {
  const currentDay = isoDayOfWeek(dateString);
  if (currentDay > 5) return false;

  const date = parseDate(dateString);
  for (let offset = 1; offset <= 3; offset += 1) {
    const next = new Date(date);
    next.setUTCDate(date.getUTCDate() + offset);
    if (next.getUTCMonth() !== date.getUTCMonth()) return true;
    const nextIsoDay = next.getUTCDay() === 0 ? 7 : next.getUTCDay();
    if (nextIsoDay <= 5) return false;
  }
  return true;
}

function normalizeRecurrence(input = {}) {
  const type = RECURRENCE_TYPES.includes(input.type) ? input.type : "weekdays";
  const daysOfWeek = Array.isArray(input.daysOfWeek)
    ? input.daysOfWeek.map(Number).filter((day) => day >= 1 && day <= 7)
    : [];
  const dayOfMonthValue = Number(input.dayOfMonth);

  return {
    type,
    daysOfWeek: daysOfWeek.length > 0 ? [...new Set(daysOfWeek)].sort((a, b) => a - b) : [isoDayOfWeek(formatDateInZone())],
    dayOfMonth: Number.isInteger(dayOfMonthValue) && dayOfMonthValue >= 1 && dayOfMonthValue <= 31 ? dayOfMonthValue : 1
  };
}

function recurrenceLabel(template) {
  const recurrence = normalizeRecurrence(template.recurrence);
  const weekLabels = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  if (recurrence.type === "daily") return "每天";
  if (recurrence.type === "weekdays") return "工作日";
  if (recurrence.type === "weekly") return `每周 ${recurrence.daysOfWeek.map((day) => weekLabels[day]).join("、")}`;
  if (recurrence.type === "monthlyDate") return `每月 ${recurrence.dayOfMonth} 日`;
  if (recurrence.type === "monthlyLastWeekday") return "每月最后一个工作日";
  return "定时";
}

function isTemplateDue(template, date) {
  if (template.active === false) return false;
  if (template.startDate && compareDateStrings(date, template.startDate) < 0) return false;
  if (template.endDate && compareDateStrings(date, template.endDate) > 0) return false;

  const recurrence = normalizeRecurrence(template.recurrence);
  const isoDay = isoDayOfWeek(date);
  if (recurrence.type === "daily") return true;
  if (recurrence.type === "weekdays") return isoDay >= 1 && isoDay <= 5;
  if (recurrence.type === "weekly") return recurrence.daysOfWeek.includes(isoDay);
  if (recurrence.type === "monthlyDate") return dayOfMonth(date) === Math.min(recurrence.dayOfMonth, daysInMonth(date));
  if (recurrence.type === "monthlyLastWeekday") return isLastWeekdayOfMonth(date);
  return false;
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
      this.save({ tasks: [], recurringTasks: [], worklogs: {} });
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
    this.materializeRecurringForDate(targetDate);
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
      recurringTaskId: input.recurringTaskId || null,
      occurrenceDate: isDateString(input.occurrenceDate) ? input.occurrenceDate : null,
      recurringLabel: asText(input.recurringLabel),
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

    if (Object.prototype.hasOwnProperty.call(patch, "description")) task.description = asText(patch.description);

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

    if (Object.prototype.hasOwnProperty.call(patch, "notes")) task.notes = asText(patch.notes);
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

  listRecurringTasks() {
    return this.load().recurringTasks
      .slice()
      .sort((a, b) => String(a.title || "").localeCompare(String(b.title || ""), "zh-Hans-CN"));
  }

  createRecurringTask(input = {}) {
    const data = this.load();
    const title = asText(input.title);
    if (!title) {
      const error = new Error("定时任务标题不能为空");
      error.statusCode = 400;
      throw error;
    }

    const priority = PRIORITIES.includes(input.priority) ? input.priority : "中";
    const plannedTime = asText(input.plannedTime);
    if (!isTimeString(plannedTime)) {
      const error = new Error("计划时间必须是 HH:mm 格式");
      error.statusCode = 400;
      throw error;
    }

    const now = new Date().toISOString();
    const template = {
      id: makeId(),
      title,
      description: asText(input.description),
      priority,
      plannedTime,
      recurrence: normalizeRecurrence(input.recurrence),
      startDate: isDateString(input.startDate) ? input.startDate : this.today(),
      endDate: isDateString(input.endDate) ? input.endDate : "",
      active: input.active !== false,
      createdAt: now,
      updatedAt: now
    };

    data.recurringTasks.push(template);
    this.save(data);
    this.materializeRecurringForDate(template.startDate);
    return template;
  }

  updateRecurringTask(id, patch = {}) {
    const data = this.load();
    const template = data.recurringTasks.find((item) => item.id === id);
    if (!template) {
      const error = new Error("定时任务不存在");
      error.statusCode = 404;
      throw error;
    }

    if (Object.prototype.hasOwnProperty.call(patch, "title")) {
      const title = asText(patch.title);
      if (!title) {
        const error = new Error("定时任务标题不能为空");
        error.statusCode = 400;
        throw error;
      }
      template.title = title;
    }
    if (Object.prototype.hasOwnProperty.call(patch, "description")) template.description = asText(patch.description);
    if (Object.prototype.hasOwnProperty.call(patch, "priority")) {
      if (!PRIORITIES.includes(patch.priority)) {
        const error = new Error("优先级无效");
        error.statusCode = 400;
        throw error;
      }
      template.priority = patch.priority;
    }
    if (Object.prototype.hasOwnProperty.call(patch, "plannedTime")) {
      const plannedTime = asText(patch.plannedTime);
      if (!isTimeString(plannedTime)) {
        const error = new Error("计划时间必须是 HH:mm 格式");
        error.statusCode = 400;
        throw error;
      }
      template.plannedTime = plannedTime;
    }
    if (Object.prototype.hasOwnProperty.call(patch, "recurrence")) template.recurrence = normalizeRecurrence(patch.recurrence);
    if (Object.prototype.hasOwnProperty.call(patch, "startDate")) {
      if (!isDateString(patch.startDate)) {
        const error = new Error("开始日期必须是 YYYY-MM-DD 格式");
        error.statusCode = 400;
        throw error;
      }
      template.startDate = patch.startDate;
    }
    if (Object.prototype.hasOwnProperty.call(patch, "endDate")) {
      if (patch.endDate && !isDateString(patch.endDate)) {
        const error = new Error("结束日期必须是 YYYY-MM-DD 格式");
        error.statusCode = 400;
        throw error;
      }
      template.endDate = patch.endDate || "";
    }
    if (Object.prototype.hasOwnProperty.call(patch, "active")) template.active = patch.active !== false;

    template.updatedAt = new Date().toISOString();
    this.save(data);
    this.materializeRecurringForDate(this.today());
    return template;
  }

  materializeRecurringForDate(date = this.today()) {
    if (!isDateString(date)) {
      const error = new Error("任务日期必须是 YYYY-MM-DD 格式");
      error.statusCode = 400;
      throw error;
    }

    const data = this.load();
    const dueTemplates = data.recurringTasks.filter((template) => isTemplateDue(template, date));
    if (dueTemplates.length === 0) return { created: [], tasks: data.tasks.filter((task) => task.date === date).sort(taskSort) };

    const created = [];
    for (const template of dueTemplates) {
      const exists = data.tasks.some((task) => task.recurringTaskId === template.id && task.occurrenceDate === date);
      if (exists) continue;

      const task = {
        id: makeId(),
        title: template.title,
        description: template.description || "",
        date,
        sourceDate: null,
        priority: template.priority || "中",
        plannedTime: template.plannedTime || "",
        status: "待办",
        notes: "",
        order: this.nextOrder(data.tasks, date, template.priority || "中", "待办"),
        recurringTaskId: template.id,
        occurrenceDate: date,
        recurringLabel: recurrenceLabel(template),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      data.tasks.push(task);
      created.push(task);
    }

    if (created.length > 0) {
      this.compactOrders(data.tasks, date);
      this.save(data);
    }
    return { created, tasks: data.tasks.filter((task) => task.date === date).sort(taskSort) };
  }

  rolloverTo(date = this.today()) {
    if (!isDateString(date)) {
      const error = new Error("任务日期必须是 YYYY-MM-DD 格式");
      error.statusCode = 400;
      throw error;
    }

    this.materializeRecurringForDate(date);
    const data = this.load();
    const moving = data.tasks
      .filter((task) =>
        compareDateStrings(task.date, date) < 0 &&
        !TERMINAL_STATUSES.includes(task.status) &&
        !task.recurringTaskId
      )
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
    if (targetDate === this.today()) this.rolloverTo(targetDate);

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
          const recurring = task.recurringLabel ? `（${task.recurringLabel}）` : "";
          const notes = task.notes ? ` - ${task.notes}` : "";
          lines.push(`- ${time}${priority} ${task.title}${source}${recurring}${notes}`.replace("-  ", "- "));
        }
      }
      lines.push("");
    }

    const canceled = tasks.filter((task) => task.status === "取消");
    if (canceled.length > 0) {
      lines.push("取消：");
      for (const task of canceled) lines.push(`- ${task.title}`);
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
    const recurring = tasks.filter((task) => task.recurringTaskId && ACTIVE_STATUSES.includes(task.status));
    const blocked = tasks.filter((task) => task.status === "阻塞");
    const done = tasks.filter((task) => task.status === "完成");

    const formatTask = (task) => {
      const time = task.plannedTime ? `${task.plannedTime} ` : "";
      const source = task.sourceDate && task.sourceDate !== task.date ? `（来自 ${task.sourceDate}）` : "";
      const tag = task.recurringLabel ? `（定时：${task.recurringLabel}）` : "";
      return `- ${time}[${task.priority}] ${task.title}${source}${tag}`;
    };

    const lines = [
      "早上好，今天的任务摘要如下。",
      "",
      `面板入口：${dashboardUrl}`,
      "",
      "今日紧急任务：",
      ...(urgent.length > 0 ? urgent.map(formatTask) : ["- 无"]),
      "",
      "今日定时任务：",
      ...(recurring.length > 0 ? recurring.map(formatTask) : ["- 无"]),
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
  RECURRENCE_TYPES,
  TIME_ZONE,
  formatDateInZone,
  isTemplateDue,
  recurrenceLabel
};
