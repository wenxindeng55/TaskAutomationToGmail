const STATUS_OPTIONS = ["待办", "进行中", "阻塞", "完成", "取消"];
const PRIORITY_OPTIONS = ["紧急", "高", "中", "低"];
const ACTIVE_STATUSES = ["待办", "进行中", "阻塞"];
const RECURRENCE_LABELS = {
  daily: "每天",
  weekdays: "工作日",
  weekly: "每周",
  monthlyDate: "每月",
  monthlyLastWeekday: "每月最后工作日"
};

const state = {
  date: todayString(),
  tasks: [],
  recurringTasks: [],
  worklog: null
};

const dateInput = document.querySelector("#dateInput");
const taskForm = document.querySelector("#taskForm");
const recurringForm = document.querySelector("#recurringForm");
const taskList = document.querySelector("#taskList");
const doneList = document.querySelector("#doneList");
const recurringList = document.querySelector("#recurringList");
const summaryLine = document.querySelector("#summaryLine");
const activeCount = document.querySelector("#activeCount");
const doneCount = document.querySelector("#doneCount");
const worklogDraft = document.querySelector("#worklogDraft");
const worklogNotes = document.querySelector("#worklogNotes");
const toast = document.querySelector("#toast");

function todayString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "请求失败");
  return data;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 2200);
}

function optionHtml(options, selected) {
  return options
    .map((option) => `<option value="${escapeHtml(option)}" ${option === selected ? "selected" : ""}>${escapeHtml(option)}</option>`)
    .join("");
}

function recurrenceText(template) {
  const recurrence = template.recurrence || {};
  const weekLabels = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  if (recurrence.type === "weekly") {
    const days = (recurrence.daysOfWeek || []).map((day) => weekLabels[day]).join("、");
    return `每周 ${days || "指定日"}`;
  }
  if (recurrence.type === "monthlyDate") return `每月 ${recurrence.dayOfMonth || 1} 日`;
  return RECURRENCE_LABELS[recurrence.type] || "定时";
}

function taskClass(task) {
  const classes = ["task-item"];
  if (task.priority === "紧急") classes.push("priority-urgent");
  if (task.status === "阻塞") classes.push("status-blocked");
  if (task.status === "完成") classes.push("status-done");
  if (task.recurringTaskId) classes.push("status-recurring");
  return classes.join(" ");
}

function chipHtml(task) {
  const chips = [];
  if (task.priority === "紧急") chips.push('<span class="chip urgent">紧急</span>');
  if (task.status === "阻塞") chips.push('<span class="chip blocked">阻塞</span>');
  if (task.recurringLabel) chips.push(`<span class="chip recurring">定时 ${escapeHtml(task.recurringLabel)}</span>`);
  if (task.sourceDate && task.sourceDate !== task.date) chips.push(`<span class="chip">来自 ${escapeHtml(task.sourceDate)}</span>`);
  if (task.updatedAt) chips.push(`<span class="chip">更新 ${escapeHtml(task.updatedAt.slice(11, 16))}</span>`);
  return chips.join("");
}

function renderTask(task, index, activeTasks) {
  const canMove = ACTIVE_STATUSES.includes(task.status);
  const upDisabled = !canMove || index === 0 ? "disabled" : "";
  const downDisabled = !canMove || index === activeTasks.length - 1 ? "disabled" : "";
  const detailText = [task.description, task.notes].filter(Boolean).join(" / ");

  return `
    <article class="${taskClass(task)}" data-id="${escapeHtml(task.id)}">
      <div class="task-main compact-task-main">
        <div class="task-title-row compact-row">
          <input data-field="title" value="${escapeHtml(task.title)}" aria-label="任务标题">
          <select data-field="status" aria-label="状态">${optionHtml(STATUS_OPTIONS, task.status)}</select>
          <select data-field="priority" aria-label="优先级">${optionHtml(PRIORITY_OPTIONS, task.priority)}</select>
          <input data-field="plannedTime" type="time" value="${escapeHtml(task.plannedTime || "")}" aria-label="计划时间">
        </div>
        <div class="task-meta">
          ${chipHtml(task)}
          <details class="task-details">
            <summary>${detailText ? escapeHtml(detailText.slice(0, 48)) : "详情"}</summary>
            <div class="task-textareas">
              <label>
                说明
                <textarea data-field="description" rows="3" aria-label="说明">${escapeHtml(task.description || "")}</textarea>
              </label>
              <label>
                备注
                <textarea data-field="notes" rows="3" aria-label="备注">${escapeHtml(task.notes || "")}</textarea>
              </label>
            </div>
          </details>
        </div>
      </div>
      <div class="task-actions">
        <button type="button" data-action="up" aria-label="上移" ${upDisabled}>↑</button>
        <button type="button" data-action="down" aria-label="下移" ${downDisabled}>↓</button>
      </div>
    </article>
  `;
}

function renderRecurringList() {
  if (!state.recurringTasks.length) {
    recurringList.innerHTML = '<div class="mini-empty">还没有长期定时任务</div>';
    return;
  }

  recurringList.innerHTML = state.recurringTasks.map((item) => `
    <article class="recurring-item ${item.active === false ? "inactive" : ""}" data-id="${escapeHtml(item.id)}">
      <div>
        <strong>${escapeHtml(item.title)}</strong>
        <span>${escapeHtml(recurrenceText(item))}${item.plannedTime ? ` · ${escapeHtml(item.plannedTime)}` : ""}</span>
      </div>
      <button type="button" data-action="toggle-recurring">${item.active === false ? "启用" : "停用"}</button>
    </article>
  `).join("");
}

function render() {
  const activeTasks = state.tasks.filter((task) => ACTIVE_STATUSES.includes(task.status));
  const finishedTasks = state.tasks.filter((task) => !ACTIVE_STATUSES.includes(task.status));
  const urgentCount = activeTasks.filter((task) => task.priority === "紧急").length;
  const recurringCount = activeTasks.filter((task) => task.recurringTaskId).length;

  summaryLine.textContent = `${state.date} · 未完成 ${activeTasks.length} · 紧急 ${urgentCount} · 定时 ${recurringCount}`;
  activeCount.textContent = activeTasks.length;
  doneCount.textContent = finishedTasks.length;

  taskList.innerHTML = activeTasks.length
    ? activeTasks.map((task, index) => renderTask(task, index, activeTasks)).join("")
    : '<div class="empty-state">今天还没有未完成任务</div>';

  doneList.innerHTML = finishedTasks.length
    ? finishedTasks.map((task, index) => renderTask(task, index, finishedTasks)).join("")
    : '<div class="empty-state">完成和取消的任务会显示在这里</div>';

  renderRecurringList();
  if (state.worklog) {
    worklogDraft.textContent = state.worklog.draft || "";
    worklogNotes.value = state.worklog.notes || "";
  }
}

async function loadAll() {
  const [taskData, recurringData, worklogData] = await Promise.all([
    api(`/api/tasks?date=${encodeURIComponent(state.date)}`),
    api("/api/recurring-tasks"),
    api(`/api/worklog?date=${encodeURIComponent(state.date)}`)
  ]);
  state.tasks = taskData.tasks || [];
  state.recurringTasks = recurringData.recurringTasks || [];
  state.worklog = worklogData;
  render();
}

async function reloadWorklog() {
  state.worklog = await api(`/api/worklog?date=${encodeURIComponent(state.date)}`);
  render();
}

async function updateTask(id, patch) {
  const result = await api(`/api/tasks/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch)
  });
  state.tasks = result.tasks || state.tasks.map((task) => (task.id === id ? result.task : task));
  render();
  await reloadWorklog();
}

function findTaskId(element) {
  return element.closest(".task-item")?.dataset.id;
}

function buildRecurrence(formData) {
  const type = formData.get("recurrenceType") || "weekdays";
  return {
    type,
    daysOfWeek: type === "weekly" ? [Number(formData.get("dayOfWeek") || 1)] : [],
    dayOfMonth: Number(formData.get("dayOfMonth") || 1)
  };
}

taskForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(taskForm);
  try {
    const result = await api("/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        title: formData.get("title"),
        priority: formData.get("priority"),
        plannedTime: formData.get("plannedTime"),
        description: formData.get("description"),
        date: state.date
      })
    });
    state.tasks = result.tasks || [...state.tasks, result.task];
    taskForm.reset();
    taskForm.priority.value = "中";
    render();
    await reloadWorklog();
    showToast("任务已新增");
  } catch (error) {
    showToast(error.message);
  }
});

recurringForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(recurringForm);
  try {
    const result = await api(`/api/recurring-tasks?date=${encodeURIComponent(state.date)}`, {
      method: "POST",
      body: JSON.stringify({
        title: formData.get("title"),
        priority: formData.get("priority"),
        plannedTime: formData.get("plannedTime"),
        description: formData.get("description"),
        recurrence: buildRecurrence(formData),
        startDate: formData.get("startDate") || state.date,
        endDate: formData.get("endDate") || ""
      })
    });
    state.recurringTasks = result.recurringTasks || state.recurringTasks;
    state.tasks = result.tasks || state.tasks;
    recurringForm.reset();
    recurringForm.priority.value = "中";
    document.querySelector("#recurringStartDate").value = state.date;
    render();
    await reloadWorklog();
    showToast("长期定时任务已新增");
  } catch (error) {
    showToast(error.message);
  }
});

document.querySelector("#refreshButton").addEventListener("click", async () => {
  await loadAll();
  showToast("已刷新");
});

document.querySelector("#rolloverButton").addEventListener("click", async () => {
  try {
    const result = await api(`/api/rollover?date=${encodeURIComponent(state.date)}`, { method: "POST" });
    state.tasks = result.tasks || [];
    render();
    await reloadWorklog();
    showToast(`已带入 ${result.moved?.length || 0} 项`);
  } catch (error) {
    showToast(error.message);
  }
});

dateInput.addEventListener("change", async () => {
  state.date = dateInput.value || todayString();
  document.querySelector("#recurringStartDate").value = state.date;
  await loadAll();
});

taskList.addEventListener("change", handleTaskChange);
taskList.addEventListener("focusout", handleTextCommit);
taskList.addEventListener("click", handleTaskAction);
doneList.addEventListener("change", handleTaskChange);
doneList.addEventListener("focusout", handleTextCommit);
recurringList.addEventListener("click", handleRecurringAction);

async function handleTaskChange(event) {
  const field = event.target.dataset.field;
  if (!field || event.target.tagName === "TEXTAREA" || (event.target.tagName === "INPUT" && event.target.type === "text")) return;
  const id = findTaskId(event.target);
  if (!id) return;

  try {
    await updateTask(id, { [field]: event.target.value });
    showToast("任务已更新");
  } catch (error) {
    showToast(error.message);
    await loadAll();
  }
}

async function handleTextCommit(event) {
  const field = event.target.dataset.field;
  if (!field || !["title", "description", "notes"].includes(field)) return;
  const id = findTaskId(event.target);
  const task = state.tasks.find((item) => item.id === id);
  if (!task || (task[field] || "") === event.target.value.trim()) return;

  try {
    await updateTask(id, { [field]: event.target.value });
    showToast("任务已更新");
  } catch (error) {
    showToast(error.message);
    await loadAll();
  }
}

async function handleTaskAction(event) {
  const action = event.target.dataset.action;
  if (!action) return;

  const id = findTaskId(event.target);
  const activeIds = state.tasks.filter((task) => ACTIVE_STATUSES.includes(task.status)).map((task) => task.id);
  const index = activeIds.indexOf(id);
  if (index < 0) return;

  const swapWith = action === "up" ? index - 1 : index + 1;
  if (swapWith < 0 || swapWith >= activeIds.length) return;

  const nextIds = [...activeIds];
  [nextIds[index], nextIds[swapWith]] = [nextIds[swapWith], nextIds[index]];

  try {
    const result = await api("/api/tasks/reorder", {
      method: "POST",
      body: JSON.stringify({ date: state.date, ids: nextIds })
    });
    state.tasks = result.tasks || state.tasks;
    render();
    await reloadWorklog();
    showToast("顺序已更新");
  } catch (error) {
    showToast(error.message);
    await loadAll();
  }
}

async function handleRecurringAction(event) {
  if (event.target.dataset.action !== "toggle-recurring") return;
  const id = event.target.closest(".recurring-item")?.dataset.id;
  const item = state.recurringTasks.find((task) => task.id === id);
  if (!item) return;

  try {
    const result = await api(`/api/recurring-tasks/${encodeURIComponent(id)}?date=${encodeURIComponent(state.date)}`, {
      method: "PATCH",
      body: JSON.stringify({ active: item.active === false })
    });
    state.recurringTasks = result.recurringTasks || state.recurringTasks;
    state.tasks = result.tasks || state.tasks;
    render();
    await reloadWorklog();
    showToast(item.active === false ? "已启用" : "已停用");
  } catch (error) {
    showToast(error.message);
  }
}

document.querySelector("#saveWorklogButton").addEventListener("click", async () => {
  try {
    state.worklog = await api(`/api/worklog?date=${encodeURIComponent(state.date)}`, {
      method: "PUT",
      body: JSON.stringify({ notes: worklogNotes.value })
    });
    render();
    showToast("记录已保存");
  } catch (error) {
    showToast(error.message);
  }
});

document.querySelector("#copyDraftButton").addEventListener("click", async () => {
  const text = [worklogDraft.textContent, worklogNotes.value.trim()].filter(Boolean).join("\n\n补充备注：\n");
  try {
    await navigator.clipboard.writeText(text);
    showToast("草稿已复制");
  } catch {
    showToast("当前浏览器不允许复制");
  }
});

dateInput.value = state.date;
document.querySelector("#recurringStartDate").value = state.date;
loadAll().catch((error) => showToast(error.message));
