const STATUS_OPTIONS = ["待办", "进行中", "阻塞", "完成", "取消"];
const PRIORITY_OPTIONS = ["紧急", "高", "中", "低"];
const ACTIVE_STATUSES = ["待办", "进行中", "阻塞"];

const state = {
  date: todayString(),
  tasks: [],
  worklog: null
};

const dateInput = document.querySelector("#dateInput");
const taskForm = document.querySelector("#taskForm");
const taskList = document.querySelector("#taskList");
const doneList = document.querySelector("#doneList");
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
  if (!response.ok) {
    throw new Error(data.error || "请求失败");
  }
  return data;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    toast.classList.remove("show");
  }, 2200);
}

function optionHtml(options, selected) {
  return options
    .map((option) => `<option value="${escapeHtml(option)}" ${option === selected ? "selected" : ""}>${escapeHtml(option)}</option>`)
    .join("");
}

function taskClass(task) {
  const classes = ["task-item"];
  if (task.priority === "紧急") classes.push("priority-urgent");
  if (task.status === "阻塞") classes.push("status-blocked");
  if (task.status === "完成") classes.push("status-done");
  return classes.join(" ");
}

function chipHtml(task) {
  const chips = [];
  if (task.priority === "紧急") chips.push('<span class="chip urgent">紧急</span>');
  if (task.status === "阻塞") chips.push('<span class="chip blocked">阻塞</span>');
  if (task.sourceDate && task.sourceDate !== task.date) {
    chips.push(`<span class="chip">来自 ${escapeHtml(task.sourceDate)}</span>`);
  }
  if (task.updatedAt) {
    chips.push(`<span class="chip">更新 ${escapeHtml(task.updatedAt.slice(11, 16))}</span>`);
  }
  return chips.join("");
}

function renderTask(task, index, activeTasks) {
  const canMove = ACTIVE_STATUSES.includes(task.status);
  const upDisabled = !canMove || index === 0 ? "disabled" : "";
  const downDisabled = !canMove || index === activeTasks.length - 1 ? "disabled" : "";

  return `
    <article class="${taskClass(task)}" data-id="${escapeHtml(task.id)}">
      <div class="task-main">
        <div class="task-title-row">
          <input data-field="title" value="${escapeHtml(task.title)}" aria-label="任务标题">
          <select data-field="status" aria-label="状态">${optionHtml(STATUS_OPTIONS, task.status)}</select>
          <select data-field="priority" aria-label="优先级">${optionHtml(PRIORITY_OPTIONS, task.priority)}</select>
          <input data-field="plannedTime" type="time" value="${escapeHtml(task.plannedTime || "")}" aria-label="计划时间">
        </div>
        <div class="task-meta">${chipHtml(task)}</div>
        <div class="task-textareas">
          <textarea data-field="description" rows="3" aria-label="说明">${escapeHtml(task.description || "")}</textarea>
          <textarea data-field="notes" rows="3" aria-label="备注">${escapeHtml(task.notes || "")}</textarea>
        </div>
      </div>
      <div class="task-actions">
        <button type="button" data-action="up" aria-label="上移" ${upDisabled}>↑</button>
        <button type="button" data-action="down" aria-label="下移" ${downDisabled}>↓</button>
      </div>
    </article>
  `;
}

function render() {
  const activeTasks = state.tasks.filter((task) => ACTIVE_STATUSES.includes(task.status));
  const finishedTasks = state.tasks.filter((task) => !ACTIVE_STATUSES.includes(task.status));
  const urgentCount = activeTasks.filter((task) => task.priority === "紧急").length;

  summaryLine.textContent = `${state.date} · 未完成 ${activeTasks.length} · 紧急 ${urgentCount}`;
  activeCount.textContent = activeTasks.length;
  doneCount.textContent = finishedTasks.length;

  taskList.innerHTML = activeTasks.length
    ? activeTasks.map((task, index) => renderTask(task, index, activeTasks)).join("")
    : '<div class="empty-state">今天还没有未完成任务</div>';

  doneList.innerHTML = finishedTasks.length
    ? finishedTasks.map((task, index) => renderTask(task, index, finishedTasks)).join("")
    : '<div class="empty-state">完成和取消的任务会显示在这里</div>';

  if (state.worklog) {
    worklogDraft.textContent = state.worklog.draft || "";
    worklogNotes.value = state.worklog.notes || "";
  }
}

async function loadAll() {
  const [taskData, worklogData] = await Promise.all([
    api(`/api/tasks?date=${encodeURIComponent(state.date)}`),
    api(`/api/worklog?date=${encodeURIComponent(state.date)}`)
  ]);
  state.tasks = taskData.tasks || [];
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
  await loadAll();
});

taskList.addEventListener("change", handleTaskChange);
taskList.addEventListener("focusout", handleTextCommit);
taskList.addEventListener("click", handleTaskAction);
doneList.addEventListener("change", handleTaskChange);
doneList.addEventListener("focusout", handleTextCommit);

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
  const activeIds = state.tasks
    .filter((task) => ACTIVE_STATUSES.includes(task.status))
    .map((task) => task.id);
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
loadAll().catch((error) => showToast(error.message));
