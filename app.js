const STORAGE_KEY = "work-journal-state-v1";
const EXPORT_SCHEMA_VERSION = 1;
const CLOUD_SCHEMA_VERSION = 1;
const CLOUD_PUSH_DEBOUNCE_MS = 750;
const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };
const CATEGORY_OPTIONS = ["Deep Work", "Planning", "Review", "Personal"];

const views = {
  dashboard: document.getElementById("view-dashboard"),
  tasks: document.getElementById("view-tasks"),
  reflections: document.getElementById("view-reflections"),
  calendar: document.getElementById("view-calendar"),
};

const navButtons = Array.from(document.querySelectorAll(".nav-item"));
const searchInput = document.getElementById("search-input");
const newEntryButton = document.getElementById("new-entry-btn");
const resetDemoButton = document.getElementById("reset-demo-btn");
const exportJsonButton = document.getElementById("export-json-btn");
const importJsonButton = document.getElementById("import-json-btn");
const importJsonInput = document.getElementById("import-json-input");
const todayButton = document.getElementById("today-btn");
const autosaveIndicator = document.getElementById("autosave-indicator");

let state = hydrateState(loadState());
let activeView = "dashboard";
let selectedEntryId = state.entries[0]?.id ?? null;
let searchTerm = "";
let timerInterval = null;
const cloudSync = {
  enabled: false,
  ready: false,
  ref: null,
  pushTimeout: null,
  applyingRemote: false,
  lastRemoteUpdatedAt: 0,
};

init();

function init() {
  navButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setActiveView(button.dataset.view);
    });
  });

  searchInput.addEventListener("input", (event) => {
    searchTerm = event.target.value.trim().toLowerCase();
    renderActiveView();
  });

  newEntryButton.addEventListener("click", () => {
    createEntry();
    setActiveView("reflections");
  });

  resetDemoButton.addEventListener("click", () => {
    const approved = window.confirm(
      "Reset data ke sample bawaan? Semua data lokal yang sekarang akan diganti."
    );
    if (!approved) return;
    state = buildDefaultState();
    selectedEntryId = state.entries[0]?.id ?? null;
    searchTerm = "";
    searchInput.value = "";
    saveState();
    setActiveView("dashboard");
    setIndicator("Sample data di-reset");
  });

  exportJsonButton.addEventListener("click", () => {
    exportStateAsJson();
  });

  importJsonButton.addEventListener("click", () => {
    importJsonInput.click();
  });

  importJsonInput.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    await importStateFromFile(file);
  });

  todayButton.addEventListener("click", () => {
    state.calendarWeekOffset = 0;
    saveState(false);
    setActiveView("dashboard");
  });

  if (state.dashboard.timerRunning) startTimerTicker();
  setActiveView("dashboard");
  setIndicator("Siap dipakai");
  initFirebaseSync();
}

function setActiveView(viewName) {
  if (!views[viewName]) return;
  activeView = viewName;

  navButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === viewName);
  });

  Object.entries(views).forEach(([name, element]) => {
    element.classList.toggle("is-active", name === viewName);
  });

  renderActiveView();
}

function renderActiveView() {
  if (activeView === "dashboard") {
    renderDashboardView();
    return;
  }

  if (activeView === "tasks") {
    renderTasksView();
    return;
  }

  if (activeView === "reflections") {
    renderReflectionsView();
    return;
  }

  renderCalendarView();
}

function renderDashboardView() {
  const view = views.dashboard;
  const greeting = getGreeting();
  const today = todayISO();

  const openTasks = state.tasks
    .filter((task) => !task.done)
    .filter((task) => matchesTask(task, searchTerm))
    .sort(sortTasks)
    .slice(0, 5);

  const totalDone = state.tasks.filter((task) => task.done).length;
  const totalTasks = state.tasks.length;
  const doneToday = state.tasks.filter(
    (task) => task.done && task.doneDate === today
  ).length;
  const streak = getJournalStreak();
  const storageNote = cloudSync.ready
    ? "Data tersinkron realtime lewat Firebase."
    : "Data tersimpan lokal di browser Anda.";

  view.innerHTML = `
    <section class="hero-card">
      <div>
        <p class="hero-kicker">Daily Brief</p>
        <h2 class="hero-title">${escapeHtml(greeting)}</h2>
        <p class="hero-desc">Ready for a focused session. ${escapeHtml(storageNote)}</p>
      </div>
      <div class="hero-metrics">
        <article class="metric">
          <strong>${doneToday}</strong>
          <span>Selesai hari ini</span>
        </article>
        <article class="metric">
          <strong>${totalTasks === 0 ? 0 : Math.round((totalDone / totalTasks) * 100)}%</strong>
          <span>Completion rate</span>
        </article>
        <article class="metric">
          <strong>${streak}</strong>
          <span>Hari streak jurnal</span>
        </article>
      </div>
    </section>

    <div class="dashboard-grid">
      <div class="dashboard-stack">
        <article class="panel">
          <div class="panel-head">
            <div>
              <h3 class="panel-title">Today's Focus</h3>
              <p class="panel-sub">Catat target kerja paling penting untuk hari ini.</p>
            </div>
          </div>
          <textarea id="focus-input" class="focus-textarea" placeholder="Contoh: selesaikan proposal arsitektur dan hindari meeting sampai jam 14.00"></textarea>
          <div class="chip-row">
            <span class="chip">Deep Work</span>
            <span class="chip">No Meeting</span>
            <span class="chip">Personal Sprint</span>
          </div>
        </article>

        <article class="panel">
          <div class="panel-head">
            <div>
              <h3 class="panel-title">Priority Tasks</h3>
              <p class="panel-sub">${openTasks.length} task berikutnya</p>
            </div>
            <button id="jump-tasks-btn" class="btn btn-secondary btn-mini" type="button">Kelola Tasks</button>
          </div>
          <ul class="task-preview-list">
            ${renderTaskRows(openTasks, { compact: true })}
          </ul>
        </article>

        <article class="panel">
          <div class="panel-head">
            <div>
              <h3 class="panel-title">Quick Note</h3>
              <p class="panel-sub">Apa yang perlu diingat sebelum mulai?</p>
            </div>
          </div>
          <textarea id="quick-note-input" class="quicknote-textarea" placeholder="Tulis catatan singkat..."></textarea>
        </article>
      </div>

      <article class="panel timer-panel">
        <div class="panel-head">
          <div>
            <h3 class="panel-title">Deep Work Timer</h3>
            <p class="panel-sub">Sesi fokus tanpa distraksi</p>
          </div>
        </div>
        <div class="timer-clock" id="timer-display">${formatSeconds(
          state.dashboard.timerRemainingSeconds
        )}</div>
        <p class="timer-state" id="timer-state">${
          state.dashboard.timerRunning ? "Session berjalan" : "Belum dimulai"
        }</p>
        <div class="timer-actions">
          <button id="timer-toggle-btn" class="btn btn-primary" type="button">
            ${state.dashboard.timerRunning ? "Pause Session" : "Start Session"}
          </button>
          <button id="timer-plus-btn" class="btn btn-secondary" type="button">
            +5 Menit
          </button>
          <button id="timer-reset-btn" class="btn btn-ghost" type="button">
            Reset Timer
          </button>
        </div>
      </article>
    </div>
  `;

  const focusInput = document.getElementById("focus-input");
  const quickNoteInput = document.getElementById("quick-note-input");
  const jumpTasksBtn = document.getElementById("jump-tasks-btn");
  const timerToggleBtn = document.getElementById("timer-toggle-btn");
  const timerPlusBtn = document.getElementById("timer-plus-btn");
  const timerResetBtn = document.getElementById("timer-reset-btn");

  focusInput.value = state.dashboard.focus;
  quickNoteInput.value = state.dashboard.quickNote;

  focusInput.addEventListener("input", (event) => {
    state.dashboard.focus = event.target.value;
    saveState();
  });

  quickNoteInput.addEventListener("input", (event) => {
    state.dashboard.quickNote = event.target.value;
    saveState();
  });

  jumpTasksBtn.addEventListener("click", () => setActiveView("tasks"));

  timerToggleBtn.addEventListener("click", () => {
    if (state.dashboard.timerRunning) {
      pauseTimer();
    } else {
      startTimer();
    }
  });

  timerPlusBtn.addEventListener("click", () => {
    state.dashboard.timerRemainingSeconds += 5 * 60;
    saveState();
    syncTimerUi();
  });

  timerResetBtn.addEventListener("click", () => {
    state.dashboard.timerRunning = false;
    state.dashboard.timerRemainingSeconds = state.dashboard.timerDurationMinutes * 60;
    stopTimerTicker();
    saveState();
    syncTimerUi();
  });
}

function renderTasksView() {
  const view = views.tasks;
  const today = todayISO();
  const visibleTasks = state.tasks.filter((task) => matchesTask(task, searchTerm));

  const todayFocus = visibleTasks
    .filter((task) => !task.done && task.dueDate <= today)
    .sort(sortTasks);

  const upcoming = visibleTasks
    .filter((task) => !task.done && task.dueDate > today)
    .sort(sortTasks);

  const completed = visibleTasks
    .filter((task) => task.done)
    .sort((a, b) => {
      const dateSort = (b.doneDate ?? "").localeCompare(a.doneDate ?? "");
      if (dateSort !== 0) return dateSort;
      return b.createdAt - a.createdAt;
    });

  view.innerHTML = `
    <section class="section-title-row">
      <div>
        <h2 class="section-title">Task Log</h2>
        <p class="section-subtitle">Organize, prioritize, and execute your deep work.</p>
      </div>
      <p class="section-subtitle">${formatLongDate(today)}</p>
    </section>

    <article class="panel">
      <div class="panel-head">
        <div>
          <h3 class="panel-title">Tambah Task</h3>
          <p class="panel-sub">Satu baris cepat untuk mencatat pekerjaan berikutnya.</p>
        </div>
      </div>
      <form id="task-add-form" class="task-add-form">
        <input id="task-text-input" class="task-input" type="text" placeholder="Tulis task..." required />
        <select id="task-priority-input" class="task-select">
          <option value="high">High</option>
          <option value="medium" selected>Medium</option>
          <option value="low">Low</option>
        </select>
        <input id="task-minutes-input" class="task-number" type="number" min="5" step="5" value="45" />
        <input id="task-date-input" class="task-date" type="date" value="${today}" />
        <button class="btn btn-primary" type="submit">Add</button>
      </form>
    </article>

    <article class="panel task-block">
      <h3>Today's Focus</h3>
      <ul class="task-list">${renderTaskRows(todayFocus)}</ul>
    </article>

    <article class="panel task-block">
      <h3>Upcoming</h3>
      <ul class="task-list">${renderTaskRows(upcoming)}</ul>
    </article>

    <article class="panel task-block">
      <h3>Completed</h3>
      <ul class="task-list">${renderTaskRows(completed, { showDoneDate: true })}</ul>
    </article>
  `;

  const addForm = document.getElementById("task-add-form");
  addForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const textInput = document.getElementById("task-text-input");
    const priorityInput = document.getElementById("task-priority-input");
    const minutesInput = document.getElementById("task-minutes-input");
    const dateInput = document.getElementById("task-date-input");

    const text = textInput.value.trim();
    if (!text) return;

    const task = {
      id: createId("task"),
      text,
      priority: normalizePriority(priorityInput.value),
      minutes: sanitizeMinutes(minutesInput.value),
      dueDate: isValidISODate(dateInput.value) ? dateInput.value : todayISO(),
      done: false,
      doneDate: null,
      createdAt: Date.now(),
    };

    state.tasks.push(task);
    saveState();
    renderTasksView();
  });

  view.onchange = (event) => {
    const checkbox = event.target.closest('input[data-action="toggle-task"]');
    if (!checkbox) return;

    const taskId = checkbox.dataset.id;
    const task = state.tasks.find((item) => item.id === taskId);
    if (!task) return;

    task.done = checkbox.checked;
    task.doneDate = checkbox.checked ? todayISO() : null;
    saveState();
    renderTasksView();
  };

  view.onclick = (event) => {
    const deleteButton = event.target.closest('button[data-action="delete-task"]');
    if (!deleteButton) return;

    const taskId = deleteButton.dataset.id;
    state.tasks = state.tasks.filter((task) => task.id !== taskId);
    saveState();
    renderTasksView();
  };
}

function renderReflectionsView() {
  const view = views.reflections;
  if (!state.entries.length) createEntry(false);

  const filteredEntries = state.entries
    .filter((entry) => matchesEntry(entry, searchTerm))
    .sort((a, b) => {
      const dateSort = b.date.localeCompare(a.date);
      if (dateSort !== 0) return dateSort;
      return b.createdAt - a.createdAt;
    });

  if (!state.entries.some((entry) => entry.id === selectedEntryId)) {
    selectedEntryId = state.entries[0]?.id ?? null;
  }

  if (
    filteredEntries.length > 0 &&
    !filteredEntries.some((entry) => entry.id === selectedEntryId)
  ) {
    selectedEntryId = filteredEntries[0].id;
  }

  const selectedEntry = state.entries.find((entry) => entry.id === selectedEntryId);

  view.innerHTML = `
    <div class="section-title-row">
      <div>
        <h2 class="section-title">Reflections</h2>
        <p class="section-subtitle">Catat apa yang berjalan baik, tantangan, dan insight harian.</p>
      </div>
      <button id="entry-new-main-btn" class="btn btn-primary" type="button">+ New Reflection</button>
    </div>

    <div class="reflections-layout">
      <aside class="panel entry-list-panel">
        <div class="panel-head">
          <h3 class="panel-title">Entry List</h3>
          <span class="panel-sub">${filteredEntries.length} item</span>
        </div>
        <ul class="entry-list">
          ${
            filteredEntries.length === 0
              ? `<li class="empty">Tidak ada entry sesuai pencarian.</li>`
              : filteredEntries.map((entry) => renderEntryListItem(entry)).join("")
          }
        </ul>
      </aside>

      <section class="panel">
        ${
          selectedEntry
            ? renderEntryEditor()
            : `<p class="empty">Belum ada entry yang dipilih.</p>`
        }
      </section>
    </div>
  `;

  const newMainButton = document.getElementById("entry-new-main-btn");
  newMainButton.addEventListener("click", () => {
    createEntry();
    renderReflectionsView();
  });

  view.onclick = (event) => {
    const entryItem = event.target.closest("[data-entry-id]");
    if (!entryItem) return;
    selectedEntryId = entryItem.dataset.entryId;
    renderReflectionsView();
  };

  const entry = state.entries.find((item) => item.id === selectedEntryId);
  if (!entry) return;

  const dateInput = document.getElementById("entry-date-input");
  const categoryInput = document.getElementById("entry-category-input");
  const titleInput = document.getElementById("entry-title-input");
  const tagsInput = document.getElementById("entry-tags-input");
  const wellInput = document.getElementById("entry-well-input");
  const challengeInput = document.getElementById("entry-challenge-input");
  const notesInput = document.getElementById("entry-notes-input");
  const deleteBtn = document.getElementById("entry-delete-btn");

  dateInput.value = entry.date;
  categoryInput.value = entry.category;
  titleInput.value = entry.title;
  tagsInput.value = entry.tags.join(", ");
  wellInput.value = entry.wentWell;
  challengeInput.value = entry.challenges;
  notesInput.value = entry.notes;

  dateInput.addEventListener("input", (event) => {
    if (isValidISODate(event.target.value)) {
      entry.date = event.target.value;
      saveState();
      renderReflectionsView();
    }
  });

  categoryInput.addEventListener("change", (event) => {
    entry.category = event.target.value;
    saveState();
  });

  titleInput.addEventListener("input", (event) => {
    entry.title = event.target.value;
    saveState();
  });

  tagsInput.addEventListener("input", (event) => {
    entry.tags = event.target.value
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    saveState();
  });

  wellInput.addEventListener("input", (event) => {
    entry.wentWell = event.target.value;
    saveState();
  });

  challengeInput.addEventListener("input", (event) => {
    entry.challenges = event.target.value;
    saveState();
  });

  notesInput.addEventListener("input", (event) => {
    entry.notes = event.target.value;
    saveState();
  });

  deleteBtn.addEventListener("click", () => {
    const approved = window.confirm("Hapus entry ini?");
    if (!approved) return;
    state.entries = state.entries.filter((item) => item.id !== entry.id);
    if (!state.entries.length) createEntry(false);
    selectedEntryId = state.entries[0]?.id ?? null;
    saveState();
    renderReflectionsView();
  });
}

function renderCalendarView() {
  const view = views.calendar;
  const weekStart = addDays(startOfWeek(new Date()), state.calendarWeekOffset * 7);
  const weekEnd = addDays(weekStart, 6);
  const weekDates = Array.from({ length: 7 }, (_, index) =>
    addDays(weekStart, index)
  );

  const weekIsoDates = weekDates.map((date) => toISODate(date));
  const doneTasks = state.tasks.filter(
    (task) => task.done && weekIsoDates.includes(task.doneDate)
  );
  const openTasks = state.tasks.filter(
    (task) => !task.done && weekIsoDates.includes(task.dueDate)
  );
  const entries = state.entries.filter((entry) => weekIsoDates.includes(entry.date));

  const totalWeekMinutes = doneTasks.reduce((sum, task) => sum + task.minutes, 0);
  const totalPlanned = doneTasks.length + openTasks.length;
  const progress = totalPlanned === 0 ? 0 : Math.round((doneTasks.length / totalPlanned) * 100);

  const trendValues = weekDates.map((date) => {
    const iso = toISODate(date);
    return state.tasks.filter((task) => task.doneDate === iso).length;
  });
  const trendMax = Math.max(1, ...trendValues);

  const visibleDays = weekDates.filter((date) => matchesDay(toISODate(date), searchTerm));

  view.innerHTML = `
    <section class="week-head">
      <div>
        <h2 class="week-title">Weekly Log</h2>
        <p class="section-subtitle">${formatDateRange(weekStart, weekEnd)}</p>
      </div>
      <div class="week-actions">
        <button id="prev-week-btn" class="btn btn-secondary" type="button">Prev</button>
        <button id="next-week-btn" class="btn btn-secondary" type="button">Next</button>
      </div>
    </section>

    <section class="week-cards">
      <article class="week-card">
        <p class="week-kicker">Weekly Focus Goal</p>
        <h3 class="panel-title">${escapeHtml(getWeeklyFocusTitle())}</h3>
        <div class="progress-wrap">
          <div class="progress-bar" style="width:${progress}%"></div>
        </div>
        <p class="panel-sub">${doneTasks.length}/${totalPlanned || 0} task selesai minggu ini</p>
      </article>

      <article class="week-card">
        <p class="week-kicker">Output Trend</p>
        <div class="trend-bars">
          ${trendValues
            .map((value) => {
              const height = Math.max(8, Math.round((value / trendMax) * 84));
              const strongClass = value === trendMax && value > 0 ? "is-strong" : "";
              return `<span class="trend-bar ${strongClass}" style="height:${height}px"></span>`;
            })
            .join("")}
        </div>
        <p class="panel-sub">${entries.length} reflections, ${Math.round(totalWeekMinutes / 60)} jam deep work</p>
      </article>
    </section>

    <section class="day-list">
      ${
        visibleDays.length === 0
          ? `<article class="panel"><p class="empty">Tidak ada data sesuai pencarian untuk minggu ini.</p></article>`
          : visibleDays.map((date) => renderCalendarDay(date)).join("")
      }
    </section>
  `;

  document.getElementById("prev-week-btn").addEventListener("click", () => {
    state.calendarWeekOffset -= 1;
    saveState(false);
    renderCalendarView();
  });

  document.getElementById("next-week-btn").addEventListener("click", () => {
    state.calendarWeekOffset += 1;
    saveState(false);
    renderCalendarView();
  });
}

function renderCalendarDay(date) {
  const iso = toISODate(date);
  const dayEntries = state.entries.filter((entry) => entry.date === iso);
  const dayDoneTasks = state.tasks.filter((task) => task.doneDate === iso);
  const dayPlannedTasks = state.tasks.filter(
    (task) => !task.done && task.dueDate === iso
  );

  const totalMinutes = dayDoneTasks.reduce((sum, task) => sum + task.minutes, 0);
  const summaryTitle =
    dayEntries[0]?.title || dayPlannedTasks[0]?.text || "Light day";
  const summaryText =
    dayEntries[0]?.notes ||
    (dayDoneTasks.length === 0 && dayPlannedTasks.length === 0
      ? "Tidak ada agenda besar. Gunakan hari ini untuk review atau planning."
      : `${dayDoneTasks.length} selesai, ${dayPlannedTasks.length} menunggu.`);

  const dayLabel = date.toLocaleDateString("en-US", { weekday: "short" });

  return `
    <article class="day-card">
      <div class="day-row">
        <div class="day-main">
          <div class="day-date">
            <span>${dayLabel}</span>
            <strong>${String(date.getDate()).padStart(2, "0")}</strong>
          </div>
          <div class="day-content">
            <h4>${escapeHtml(summaryTitle)}</h4>
            <p>${escapeHtml(truncate(summaryText, 150))}</p>
          </div>
        </div>
        <div class="day-facts">
          <div>${dayDoneTasks.length} done</div>
          <div>${dayPlannedTasks.length} queued</div>
          <div>${Math.round(totalMinutes / 60 * 10) / 10}h</div>
        </div>
      </div>
    </article>
  `;
}

function renderEntryListItem(entry) {
  const activeClass = entry.id === selectedEntryId ? "is-active" : "";
  return `
    <li class="entry-item ${activeClass}" data-entry-id="${entry.id}">
      <p class="entry-item-title">${escapeHtml(entry.title || "Untitled Entry")}</p>
      <p class="entry-item-meta">${escapeHtml(formatLongDate(entry.date))} - ${escapeHtml(entry.category)}</p>
    </li>
  `;
}

function renderEntryEditor() {
  return `
    <div class="entry-editor-head">
      <input id="entry-date-input" class="entry-date-input" type="date" />
      <select id="entry-category-input" class="entry-select">
        ${CATEGORY_OPTIONS.map((option) => `<option value="${option}">${option}</option>`).join("")}
      </select>
      <input id="entry-title-input" class="entry-input" type="text" placeholder="Judul refleksi..." />
      <input id="entry-tags-input" class="entry-input" type="text" placeholder="tag1, tag2, tag3" />
    </div>

    <div class="entry-grid">
      <article class="entry-card">
        <h3>What went well?</h3>
        <textarea id="entry-well-input" class="entry-textarea" placeholder="Apa yang berjalan baik hari ini?"></textarea>
      </article>
      <article class="entry-card">
        <h3>Challenges faced</h3>
        <textarea id="entry-challenge-input" class="entry-textarea" placeholder="Hambatan apa yang Anda hadapi?"></textarea>
      </article>
    </div>

    <article class="entry-card">
      <h3>Open Notes & Thoughts</h3>
      <textarea id="entry-notes-input" class="entry-notes" placeholder="Tuangkan pemikiran Anda di sini..."></textarea>
    </article>

    <div class="entry-footer-actions">
      <button id="entry-delete-btn" class="btn btn-danger" type="button">Delete Entry</button>
    </div>
  `;
}

function renderTaskRows(tasks, options = {}) {
  const { compact = false, showDoneDate = false } = options;
  if (tasks.length === 0) {
    return `<li class="empty">Belum ada data untuk bagian ini.</li>`;
  }

  return tasks
    .map((task) => {
      if (compact) {
        return `
          <li class="task-item">
            <div class="task-main">
              <span class="task-label">${escapeHtml(task.text)}</span>
            </div>
            <div class="task-meta">
              <span class="pill ${task.priority}">${priorityLabel(task.priority)}</span>
              <span>${task.minutes}m</span>
            </div>
          </li>
        `;
      }

      const dueLabel = showDoneDate
        ? `Done: ${formatShortDate(task.doneDate ?? task.dueDate)}`
        : `Due: ${formatShortDate(task.dueDate)}`;
      return `
        <li class="task-item ${task.done ? "is-done" : ""}">
          <label class="task-main">
            <input
              type="checkbox"
              data-action="toggle-task"
              data-id="${task.id}"
              ${task.done ? "checked" : ""}
            />
            <span class="task-label">${escapeHtml(task.text)}</span>
          </label>
          <div class="task-meta">
            <span class="pill ${task.priority}">${priorityLabel(task.priority)}</span>
            <span>${task.minutes}m</span>
            ${compact ? "" : `<span>${escapeHtml(dueLabel)}</span>`}
            <button class="icon-btn" data-action="delete-task" data-id="${
              task.id
            }" type="button" aria-label="Delete task">x</button>
          </div>
        </li>
      `;
    })
    .join("");
}

function createEntry(shouldSave = true) {
  const entry = {
    id: createId("entry"),
    date: todayISO(),
    title: "New Reflection",
    category: "Deep Work",
    wentWell: "",
    challenges: "",
    notes: "",
    tags: [],
    createdAt: Date.now(),
  };
  state.entries.unshift(entry);
  selectedEntryId = entry.id;
  if (shouldSave) saveState();
}

function startTimer() {
  state.dashboard.timerRunning = true;
  startTimerTicker();
  saveState();
  syncTimerUi();
}

function pauseTimer() {
  state.dashboard.timerRunning = false;
  stopTimerTicker();
  saveState();
  syncTimerUi();
}

function startTimerTicker() {
  stopTimerTicker();
  timerInterval = window.setInterval(() => {
    if (!state.dashboard.timerRunning) return;

    if (state.dashboard.timerRemainingSeconds <= 0) {
      state.dashboard.timerRunning = false;
      stopTimerTicker();
      saveState();
      syncTimerUi();
      return;
    }

    state.dashboard.timerRemainingSeconds -= 1;
    syncTimerUi();

    if (state.dashboard.timerRemainingSeconds % 15 === 0) {
      saveState(false);
    }
  }, 1000);
}

function stopTimerTicker() {
  if (!timerInterval) return;
  clearInterval(timerInterval);
  timerInterval = null;
}

function syncTimerUi() {
  const display = document.getElementById("timer-display");
  const stateLabel = document.getElementById("timer-state");
  const toggleButton = document.getElementById("timer-toggle-btn");

  if (display) display.textContent = formatSeconds(state.dashboard.timerRemainingSeconds);
  if (stateLabel) {
    stateLabel.textContent = state.dashboard.timerRunning
      ? "Session berjalan"
      : state.dashboard.timerRemainingSeconds === 0
        ? "Session selesai"
        : "Belum dimulai";
  }
  if (toggleButton) {
    toggleButton.textContent = state.dashboard.timerRunning
      ? "Pause Session"
      : state.dashboard.timerRemainingSeconds === 0
        ? "Start Ulang"
        : "Start Session";
  }
}

function getWeeklyFocusTitle() {
  const focusText = state.dashboard.focus.trim();
  if (!focusText) return "Ship your most important work";
  const firstSentence = focusText.split("\n")[0].trim();
  return truncate(firstSentence, 58);
}

function getJournalStreak() {
  const daySet = new Set(state.entries.map((entry) => entry.date));
  let streak = 0;
  let current = startOfDay(new Date());

  while (daySet.has(toISODate(current))) {
    streak += 1;
    current = addDays(current, -1);
  }
  return streak;
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 11) return "Good Morning.";
  if (hour < 15) return "Good Afternoon.";
  if (hour < 19) return "Good Evening.";
  return "Settle In.";
}

function matchesTask(task, term) {
  if (!term) return true;
  const content = [
    task.text,
    task.priority,
    task.dueDate,
    task.doneDate ?? "",
  ]
    .join(" ")
    .toLowerCase();
  return content.includes(term);
}

function matchesEntry(entry, term) {
  if (!term) return true;
  const content = [
    entry.title,
    entry.category,
    entry.wentWell,
    entry.challenges,
    entry.notes,
    entry.tags.join(" "),
    entry.date,
  ]
    .join(" ")
    .toLowerCase();
  return content.includes(term);
}

function matchesDay(isoDate, term) {
  if (!term) return true;
  const taskMatch = state.tasks.some(
    (task) =>
      (task.dueDate === isoDate || task.doneDate === isoDate) &&
      matchesTask(task, term)
  );
  const entryMatch = state.entries.some(
    (entry) => entry.date === isoDate && matchesEntry(entry, term)
  );
  return taskMatch || entryMatch;
}

function sortTasks(a, b) {
  const priorityDiff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
  if (priorityDiff !== 0) return priorityDiff;
  const dueDiff = a.dueDate.localeCompare(b.dueDate);
  if (dueDiff !== 0) return dueDiff;
  return b.createdAt - a.createdAt;
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (error) {
    console.warn("Failed to parse saved state.", error);
    return null;
  }
}

function hydrateState(savedState) {
  const defaults = buildDefaultState();
  if (!savedState) return defaults;

  const hydrated = {
    ...defaults,
    ...savedState,
    dashboard: {
      ...defaults.dashboard,
      ...(savedState.dashboard ?? {}),
    },
    tasks: Array.isArray(savedState.tasks) ? savedState.tasks : defaults.tasks,
    entries: Array.isArray(savedState.entries)
      ? savedState.entries
      : defaults.entries,
  };

  hydrated.tasks = hydrated.tasks.map((task) => ({
    id: typeof task.id === "string" ? task.id : createId("task"),
    text: typeof task.text === "string" ? task.text : "Untitled task",
    priority: normalizePriority(task.priority),
    minutes: sanitizeMinutes(task.minutes),
    dueDate: isValidISODate(task.dueDate) ? task.dueDate : todayISO(),
    done: Boolean(task.done),
    doneDate: isValidISODate(task.doneDate) ? task.doneDate : null,
    createdAt:
      typeof task.createdAt === "number" && Number.isFinite(task.createdAt)
        ? task.createdAt
        : Date.now(),
  }));

  hydrated.entries = hydrated.entries.map((entry) => ({
    id: typeof entry.id === "string" ? entry.id : createId("entry"),
    date: isValidISODate(entry.date) ? entry.date : todayISO(),
    title: typeof entry.title === "string" ? entry.title : "Untitled Entry",
    category:
      typeof entry.category === "string" && entry.category.trim() !== ""
        ? entry.category
        : "Deep Work",
    wentWell: typeof entry.wentWell === "string" ? entry.wentWell : "",
    challenges: typeof entry.challenges === "string" ? entry.challenges : "",
    notes: typeof entry.notes === "string" ? entry.notes : "",
    tags: Array.isArray(entry.tags)
      ? entry.tags
          .filter((tag) => typeof tag === "string")
          .map((tag) => tag.trim())
          .filter(Boolean)
      : [],
    createdAt:
      typeof entry.createdAt === "number" && Number.isFinite(entry.createdAt)
        ? entry.createdAt
        : Date.now(),
  }));

  hydrated.dashboard.timerDurationMinutes = sanitizeMinutes(
    hydrated.dashboard.timerDurationMinutes
  );
  const maxSeconds = Math.max(5 * 60, hydrated.dashboard.timerDurationMinutes * 60);
  hydrated.dashboard.timerRemainingSeconds = Number.isFinite(
    hydrated.dashboard.timerRemainingSeconds
  )
    ? Math.max(0, Math.min(hydrated.dashboard.timerRemainingSeconds, maxSeconds + 6 * 60 * 60))
    : hydrated.dashboard.timerDurationMinutes * 60;
  hydrated.dashboard.timerRunning = Boolean(hydrated.dashboard.timerRunning);
  hydrated.calendarWeekOffset = Number.isFinite(hydrated.calendarWeekOffset)
    ? hydrated.calendarWeekOffset
    : 0;
  hydrated.meta = {
    updatedAt:
      typeof savedState?.meta?.updatedAt === "number" &&
      Number.isFinite(savedState.meta.updatedAt)
        ? savedState.meta.updatedAt
        : Date.now(),
  };

  return hydrated;
}

function buildDefaultState() {
  const today = startOfDay(new Date());
  const yesterday = addDays(today, -1);
  const twoDaysAgo = addDays(today, -2);
  const tomorrow = addDays(today, 1);
  const dayAfterTomorrow = addDays(today, 2);

  return {
    meta: {
      updatedAt: Date.now(),
    },
    dashboard: {
      focus:
        "Finalisasi dokumentasi arsitektur kuartal ini dan lanjut prototyping navigasi baru. Hindari meeting sampai jam 14:00.",
      quickNote:
        "Mulai dari task tersulit dulu. Tutup chat selama 45 menit pertama supaya momentum kebangun.",
      timerDurationMinutes: 45,
      timerRemainingSeconds: 45 * 60,
      timerRunning: false,
    },
    tasks: [
      {
        id: createId("task"),
        text: "Draft architecture proposal untuk Project Nova",
        priority: "high",
        minutes: 120,
        dueDate: toISODate(today),
        done: false,
        doneDate: null,
        createdAt: Date.now() - 10_000,
      },
      {
        id: createId("task"),
        text: "Review Q3 analytics report",
        priority: "medium",
        minutes: 45,
        dueDate: toISODate(today),
        done: false,
        doneDate: null,
        createdAt: Date.now() - 9_000,
      },
      {
        id: createId("task"),
        text: "Sync dengan tim design untuk component library",
        priority: "low",
        minutes: 30,
        dueDate: toISODate(tomorrow),
        done: false,
        doneDate: null,
        createdAt: Date.now() - 8_000,
      },
      {
        id: createId("task"),
        text: "Morning standup preparation",
        priority: "medium",
        minutes: 15,
        dueDate: toISODate(yesterday),
        done: true,
        doneDate: toISODate(yesterday),
        createdAt: Date.now() - 7_000,
      },
      {
        id: createId("task"),
        text: "Inbox zero and triage",
        priority: "low",
        minutes: 20,
        dueDate: toISODate(twoDaysAgo),
        done: true,
        doneDate: toISODate(twoDaysAgo),
        createdAt: Date.now() - 6_000,
      },
      {
        id: createId("task"),
        text: "Update local development environment",
        priority: "medium",
        minutes: 35,
        dueDate: toISODate(dayAfterTomorrow),
        done: false,
        doneDate: null,
        createdAt: Date.now() - 5_000,
      },
    ],
    entries: [
      {
        id: createId("entry"),
        date: toISODate(today),
        title: "Finding Clarity in Architecture",
        category: "Deep Work",
        wentWell:
          "Refactor modul autentikasi berhasil tanpa merusak sesi lama. Struktur kode terasa lebih rapi.",
        challenges:
          "Sempat terhambat hampir dua jam karena konfigurasi CORS. Solusi akhirnya ada di proxy setting.",
        notes:
          "Saya ingin mempertahankan blok fokus 45 menit karena hasilnya jauh lebih konsisten. Besok, lanjutkan dengan validasi test untuk endpoint baru.",
        tags: ["Architecture", "Backend"],
        createdAt: Date.now() - 20_000,
      },
      {
        id: createId("entry"),
        date: toISODate(yesterday),
        title: "Building with Less Friction",
        category: "Planning",
        wentWell:
          "Task planning pagi membantu saya tidak kehilangan konteks saat pindah antar pekerjaan.",
        challenges:
          "Terlalu sering cek notifikasi chat sehingga momentum fokus sempat patah beberapa kali.",
        notes:
          "Perlu jadwalkan waktu cek komunikasi secara batch supaya deep work lebih aman.",
        tags: ["Process", "Focus"],
        createdAt: Date.now() - 19_000,
      },
      {
        id: createId("entry"),
        date: toISODate(twoDaysAgo),
        title: "Weekly Momentum Check",
        category: "Review",
        wentWell:
          "Output mingguan meningkat karena semua task besar dipecah jadi langkah kecil yang jelas.",
        challenges:
          "Dokumentasi masih tersebar di beberapa tempat sehingga review agak lama.",
        notes:
          "Minggu depan perlu satu source of truth untuk note dan keputusan arsitektur.",
        tags: ["Weekly", "Retrospective"],
        createdAt: Date.now() - 18_000,
      },
    ],
    calendarWeekOffset: 0,
  };
}

function saveState(showIndicator = true, options = {}) {
  const { preserveUpdatedAt = false, skipCloud = false } = options;

  if (!state.meta || typeof state.meta !== "object") {
    state.meta = { updatedAt: Date.now() };
  }
  if (!preserveUpdatedAt) {
    state.meta.updatedAt = Date.now();
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (!skipCloud) queueCloudPush();
  if (showIndicator) setIndicator(`Saved ${formatTime(new Date())}`);
}

function exportStateAsJson() {
  const payload = {
    app: "work-journal",
    version: EXPORT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    state,
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `work-journal-${todayISO()}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);

  setIndicator(`JSON exported ${formatTime(new Date())}`);
}

async function importStateFromFile(file) {
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const candidateState =
      parsed && typeof parsed === "object" && parsed.state ? parsed.state : parsed;

    state = hydrateState(candidateState);
    selectedEntryId = state.entries[0]?.id ?? null;
    searchTerm = "";
    searchInput.value = "";

    stopTimerTicker();
    if (state.dashboard.timerRunning) startTimerTicker();

    saveState(false);
    renderActiveView();
    setIndicator(`JSON imported ${formatTime(new Date())}`);
  } catch (error) {
    console.error("Import JSON gagal.", error);
    window.alert(
      "File JSON tidak valid atau formatnya tidak cocok. Pastikan Anda import dari file backup Work Journal."
    );
    setIndicator("Import gagal");
  } finally {
    importJsonInput.value = "";
  }
}

async function initFirebaseSync() {
  const settings = getFirebaseSettings();
  if (!settings.enabled) return;

  if (typeof window.firebase === "undefined") {
    setIndicator("Firebase script tidak termuat");
    return;
  }

  if (!isFirebaseConfigComplete(settings.firebaseConfig)) {
    setIndicator("Firebase config belum lengkap");
    return;
  }

  const workspaceId = sanitizeWorkspaceId(settings.workspaceId);
  if (!workspaceId) {
    setIndicator("Workspace Firebase belum diisi");
    return;
  }

  try {
    cloudSync.enabled = true;

    const appName = "work-journal-app";
    const firebaseApp =
      window.firebase.apps.find((app) => app.name === appName) ??
      window.firebase.initializeApp(settings.firebaseConfig, appName);

    await firebaseApp.auth().signInAnonymously();

    cloudSync.ref = firebaseApp.database().ref(`work-journal/${workspaceId}`);

    const firstSnapshot = await cloudSync.ref.once("value");
    const firstPayload = readCloudPayload(firstSnapshot);
    const localUpdatedAt = getStateUpdatedAt();

    if (!firstPayload) {
      await cloudSync.ref.set(buildCloudPayload(state));
      cloudSync.lastRemoteUpdatedAt = localUpdatedAt;
    } else if (firstPayload.updatedAt > localUpdatedAt) {
      await applyRemoteState(firstPayload.state, firstPayload.updatedAt);
    } else if (firstPayload.updatedAt < localUpdatedAt) {
      await cloudSync.ref.set(buildCloudPayload(state));
      cloudSync.lastRemoteUpdatedAt = localUpdatedAt;
    } else {
      cloudSync.lastRemoteUpdatedAt = firstPayload.updatedAt;
    }

    cloudSync.ready = true;
    cloudSync.ref.on(
      "value",
      (snapshot) => {
        void handleCloudSnapshot(snapshot);
      },
      (error) => {
        console.error("Firebase realtime listener error.", error);
        setIndicator("Realtime listener error");
      }
    );

    setIndicator("Firebase realtime aktif");
  } catch (error) {
    console.error("Firebase init gagal.", error);
    setIndicator("Gagal konek Firebase");
  }
}

function getFirebaseSettings() {
  const raw = window.WORK_JOURNAL_FIREBASE;
  if (!raw || typeof raw !== "object") {
    return { enabled: false, workspaceId: "", firebaseConfig: null };
  }
  return {
    enabled: Boolean(raw.enabled),
    workspaceId: typeof raw.workspaceId === "string" ? raw.workspaceId : "",
    firebaseConfig:
      raw.firebaseConfig && typeof raw.firebaseConfig === "object"
        ? raw.firebaseConfig
        : null,
  };
}

function isFirebaseConfigComplete(config) {
  if (!config) return false;
  const requiredKeys = [
    "apiKey",
    "authDomain",
    "databaseURL",
    "projectId",
    "storageBucket",
    "messagingSenderId",
    "appId",
  ];
  return requiredKeys.every(
    (key) => typeof config[key] === "string" && config[key].trim() !== ""
  );
}

function sanitizeWorkspaceId(value) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-");
}

function buildCloudPayload(currentState) {
  return {
    schemaVersion: CLOUD_SCHEMA_VERSION,
    updatedAt: getStateUpdatedAt(),
    state: JSON.parse(JSON.stringify(currentState)),
  };
}

function readCloudPayload(snapshot) {
  if (!snapshot.exists()) return null;
  const raw = snapshot.val();
  if (!raw || typeof raw !== "object") return null;
  const candidateState =
    raw.state && typeof raw.state === "object" ? raw.state : raw;
  const updatedAt =
    typeof raw.updatedAt === "number" && Number.isFinite(raw.updatedAt)
      ? raw.updatedAt
      : typeof candidateState.meta?.updatedAt === "number" &&
          Number.isFinite(candidateState.meta.updatedAt)
        ? candidateState.meta.updatedAt
        : Date.now();

  return { state: candidateState, updatedAt };
}

async function handleCloudSnapshot(snapshot) {
  if (!cloudSync.ready) return;
  const payload = readCloudPayload(snapshot);
  if (!payload) return;

  cloudSync.lastRemoteUpdatedAt = Math.max(
    cloudSync.lastRemoteUpdatedAt,
    payload.updatedAt
  );

  if (payload.updatedAt <= getStateUpdatedAt()) return;
  await applyRemoteState(payload.state, payload.updatedAt);
}

async function applyRemoteState(remoteState, remoteUpdatedAt) {
  if (cloudSync.applyingRemote) return;
  cloudSync.applyingRemote = true;

  try {
    state = hydrateState(remoteState);
    if (!state.meta || typeof state.meta !== "object") {
      state.meta = { updatedAt: remoteUpdatedAt };
    } else {
      state.meta.updatedAt = remoteUpdatedAt;
    }

    stopTimerTicker();
    if (state.dashboard.timerRunning) startTimerTicker();

    saveState(false, { preserveUpdatedAt: true, skipCloud: true });
    renderActiveView();
    cloudSync.lastRemoteUpdatedAt = remoteUpdatedAt;
    setIndicator(`Synced from Firebase ${formatTime(new Date(remoteUpdatedAt))}`);
  } finally {
    cloudSync.applyingRemote = false;
  }
}

function queueCloudPush() {
  if (!cloudSync.ready || !cloudSync.ref || cloudSync.applyingRemote) return;
  if (cloudSync.pushTimeout) clearTimeout(cloudSync.pushTimeout);

  cloudSync.pushTimeout = window.setTimeout(() => {
    void pushStateToCloud();
  }, CLOUD_PUSH_DEBOUNCE_MS);
}

async function pushStateToCloud() {
  if (!cloudSync.ready || !cloudSync.ref || cloudSync.applyingRemote) return;
  const localUpdatedAt = getStateUpdatedAt();
  if (localUpdatedAt <= cloudSync.lastRemoteUpdatedAt) return;

  try {
    await cloudSync.ref.set(buildCloudPayload(state));
    cloudSync.lastRemoteUpdatedAt = localUpdatedAt;
    setIndicator(`Synced to Firebase ${formatTime(new Date(localUpdatedAt))}`);
  } catch (error) {
    console.error("Push ke Firebase gagal.", error);
    setIndicator("Gagal sync ke Firebase");
  }
}

function getStateUpdatedAt() {
  return typeof state?.meta?.updatedAt === "number" &&
    Number.isFinite(state.meta.updatedAt)
    ? state.meta.updatedAt
    : 0;
}

function setIndicator(text) {
  autosaveIndicator.textContent = text;
}

function priorityLabel(priority) {
  if (priority === "high") return "High";
  if (priority === "low") return "Low";
  return "Medium";
}

function normalizePriority(value) {
  if (value === "high" || value === "low") return value;
  return "medium";
}

function sanitizeMinutes(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 30;
  return Math.max(5, Math.round(number));
}

function formatSeconds(totalSeconds) {
  const safeSeconds = Math.max(0, Number(totalSeconds) || 0);
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatLongDate(isoDate) {
  const date = fromISODate(isoDate);
  return date.toLocaleDateString("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatShortDate(isoDate) {
  const date = fromISODate(isoDate);
  return date.toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
  });
}

function formatDateRange(startDate, endDate) {
  const sameMonth =
    startDate.getMonth() === endDate.getMonth() &&
    startDate.getFullYear() === endDate.getFullYear();
  if (sameMonth) {
    const monthYear = endDate.toLocaleDateString("id-ID", {
      month: "long",
      year: "numeric",
    });
    return `${startDate.getDate()} - ${endDate.getDate()} ${monthYear}`;
  }
  const startText = startDate.toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const endText = endDate.toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return `${startText} - ${endText}`;
}

function formatTime(date) {
  return date.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
}

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function toISODate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function fromISODate(isoDate) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function isValidISODate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = fromISODate(value);
  return !Number.isNaN(parsed.getTime());
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, amount) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + amount);
  return startOfDay(copy);
}

function startOfWeek(date) {
  const day = date.getDay();
  const mondayOffset = (day + 6) % 7;
  return addDays(startOfDay(date), -mondayOffset);
}

function todayISO() {
  return toISODate(startOfDay(new Date()));
}

function truncate(text, limit) {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit).trim()}...`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
