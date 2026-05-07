const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { TaskStore } = require("../src/taskStoreCore");

function makeStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "task-automation-"));
  return new TaskStore(path.join(dir, "tasks.json"));
}

test("urgent tasks enter the top of today's active list", () => {
  const store = makeStore();
  store.createTask({ title: "普通任务", date: "2026-05-06", priority: "中" });
  store.createTask({ title: "紧急任务", date: "2026-05-06", priority: "紧急" });

  const tasks = store.listTasks("2026-05-06", { rollover: false });
  assert.equal(tasks.length, 2);
  assert.equal(tasks[0].title, "紧急任务");
  assert.equal(tasks[1].title, "普通任务");
});

test("status changes persist after reloading the store", () => {
  const store = makeStore();
  const task = store.createTask({ title: "推进接口", date: "2026-05-06" });
  store.updateTask(task.id, { status: "进行中" });

  const reloaded = new TaskStore(store.filePath);
  const tasks = reloaded.listTasks("2026-05-06", { rollover: false });
  assert.equal(tasks[0].status, "进行中");
});

test("urgent insertion keeps existing same-day tasks", () => {
  const store = makeStore();
  store.createTask({ title: "上午任务", date: "2026-05-06" });
  store.createTask({ title: "下午任务", date: "2026-05-06" });
  store.createTask({ title: "线上故障", date: "2026-05-06", priority: "紧急" });

  const titles = store.listTasks("2026-05-06", { rollover: false }).map((task) => task.title);
  assert.deepEqual(titles, ["线上故障", "上午任务", "下午任务"]);
});

test("unfinished tasks roll into the target date with source date preserved", () => {
  const store = makeStore();
  store.createTask({ title: "昨天继续", date: "2026-05-05" });
  store.createTask({ title: "昨天完成", date: "2026-05-05", status: "完成" });

  const result = store.rolloverTo("2026-05-06");
  assert.equal(result.moved.length, 1);
  assert.equal(result.moved[0].title, "昨天继续");
  assert.equal(result.moved[0].date, "2026-05-06");
  assert.equal(result.moved[0].sourceDate, "2026-05-05");

  const yesterday = store.listTasks("2026-05-05", { rollover: false });
  assert.equal(yesterday.length, 1);
  assert.equal(yesterday[0].title, "昨天完成");
});

test("worklog draft groups completed, active, blocked and todo tasks", () => {
  const store = makeStore();
  store.createTask({ title: "写完日报", date: "2026-05-06", status: "完成" });
  store.createTask({ title: "接入页面", date: "2026-05-06", status: "进行中" });
  store.createTask({ title: "等待权限", date: "2026-05-06", status: "阻塞" });
  store.createTask({ title: "整理清单", date: "2026-05-06", status: "待办" });

  const draft = store.buildWorklogDraft("2026-05-06");
  assert.match(draft, /完成：\n- \[中\] 写完日报/);
  assert.match(draft, /进行中：\n- \[中\] 接入页面/);
  assert.match(draft, /阻塞：\n- \[中\] 等待权限/);
  assert.match(draft, /待办：\n- \[中\] 整理清单/);
});

test("email summary contains urgent items, blocked items, dashboard link and start hint", () => {
  const store = makeStore();
  store.createTask({ title: "紧急修复", date: "2026-05-06", priority: "紧急" });
  store.createTask({ title: "等待确认", date: "2026-05-06", status: "阻塞" });

  const summary = store.buildEmailSummary("2026-05-06", "http://localhost:8787/");
  assert.equal(summary.subject, "今日任务摘要 - 2026-05-06");
  assert.match(summary.body, /紧急修复/);
  assert.match(summary.body, /等待确认/);
  assert.match(summary.body, /http:\/\/localhost:8787\//);
  assert.match(summary.body, /npm start/);
});

test("recurring weekday tasks materialize once for a due date", () => {
  const store = makeStore();
  const template = store.createRecurringTask({
    title: "每日巡检",
    startDate: "2026-05-04",
    recurrence: { type: "weekdays" },
    plannedTime: "09:30"
  });

  store.materializeRecurringForDate("2026-05-06");
  store.materializeRecurringForDate("2026-05-06");

  const tasks = store.listTasks("2026-05-06", { rollover: false });
  const generated = tasks.filter((task) => task.recurringTaskId === template.id);
  assert.equal(generated.length, 1);
  assert.equal(generated[0].title, "每日巡检");
  assert.equal(generated[0].plannedTime, "09:30");
  assert.equal(generated[0].recurringLabel, "工作日");
});

test("inactive recurring tasks do not materialize", () => {
  const store = makeStore();
  store.createRecurringTask({
    title: "暂停任务",
    startDate: "2026-05-04",
    active: false,
    recurrence: { type: "daily" }
  });

  const result = store.materializeRecurringForDate("2026-05-06");
  assert.equal(result.created.length, 0);
  assert.equal(store.listTasks("2026-05-06", { rollover: false }).length, 0);
});

test("unfinished recurring occurrences do not roll into the next day", () => {
  const store = makeStore();
  store.createRecurringTask({
    title: "日报提醒",
    startDate: "2026-05-05",
    recurrence: { type: "daily" }
  });

  store.materializeRecurringForDate("2026-05-05");
  const result = store.rolloverTo("2026-05-06");
  const todayTasks = store.listTasks("2026-05-06", { rollover: false }).filter((task) => task.title === "日报提醒");

  assert.equal(result.moved.length, 0);
  assert.equal(todayTasks.length, 1);
  assert.equal(todayTasks[0].occurrenceDate, "2026-05-06");
});

test("email summary includes recurring task section", () => {
  const store = makeStore();
  store.createRecurringTask({
    title: "工作日同步",
    startDate: "2026-05-04",
    recurrence: { type: "weekdays" }
  });

  const summary = store.buildEmailSummary("2026-05-06", "http://localhost:8787/");
  assert.match(summary.body, /今日定时任务/);
  assert.match(summary.body, /工作日同步/);
  assert.match(summary.body, /定时：工作日/);
});
