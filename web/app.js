(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const API = "/api/v1";
  const state = {
    token: localStorage.getItem("vox_token") || "",
    user: null,
    epoch: 0,
    mode: "login",
    view: "tasks",
    tasks: null,
    files: null,
    errors: {},
    updated: {},
    page: 1,
    loading: false,
    timer: null,
    selectedFile: null,
    recording: {
      version: 0,
      phase: "idle",
      recorder: null,
      stream: null,
      timer: null,
      file: null,
      url: "",
    },
    busy: false,
    detail: null,
    detailVersion: 0,
    followCleanup: null,
    controllers: new Set(),
    toastTimer: null,
  };
  const labels = {
    pending: "等待处理",
    dispatched: "已调度",
    processing: "处理中",
    completed: "已完成",
    failed: "失败",
    ready: "可用",
    uploading: "待完成上传",
  };
  const escape = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const idPath = (id) => encodeURIComponent(id);
  const taskID = (t) => t.task_id;
  const canRead = (task) =>
    task.status === "completed" &&
    task.type === "transcribe" &&
    Boolean(task.output_file_id);
  const fileName = (id) =>
    state.files?.find((f) => f.file_id === id)?.file_name || id || "—";
  const taskType = (type) =>
    ({ transcribe: "语音转写", transcode: "音频转码" })[type] ||
    type ||
    "未返回";
  const timeValue = (v) => {
    if (!v) return 0;
    const n =
      typeof v === "object"
        ? Number(v.seconds || 0) * 1000 + Number(v.nanos || 0) / 1e6
        : Date.parse(v);
    return Number.isFinite(n) ? n : 0;
  };
  const date = (v) =>
    timeValue(v)
      ? new Date(timeValue(v)).toLocaleString("zh-CN", { hour12: false })
      : "—";
  const bytes = (v) => {
    const n = Number(v || 0);
    if (!Number.isFinite(n) || n < 0) return "—";
    if (n < 1024) return `${n} B`;
    const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), 4);
    return `${(n / 1024 ** i).toFixed(1)} ${["B", "KB", "MB", "GB", "TB"][i]}`;
  };
  const badge = (status) =>
    `<span class="badge ${Object.hasOwn(labels, status) ? status : ""}">${escape(labels[status] || status || "未返回")}</span>`;
  const button = (action, id, title) =>
    `<button class="text-action" data-action="${action}" data-id="${escape(id)}">${escape(title)}</button>`;
  function toast(message) {
    $("toast").textContent = message;
    $("toast").hidden = false;
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => {
      $("toast").hidden = true;
    }, 5000);
  }
  function message(id, text, error = false) {
    $(id).textContent = text;
    $(id).classList.toggle("error", error);
  }
  function stale() {
    return new DOMException("请求已取消", "AbortError");
  }
  async function request(path, options = {}, authenticated = true) {
    const epoch = state.epoch;
    const controller = new AbortController();
    state.controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const headers = new Headers(options.headers);
      if (authenticated) headers.set("Authorization", `Bearer ${state.token}`);
      const response = await fetch(API + path, {
        ...options,
        headers,
        signal: controller.signal,
      });
      const raw = await response.text();
      if (epoch !== state.epoch) throw stale();
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        throw new Error(
          `接口未返回有效 JSON（HTTP ${response.status}），请检查 API 连接。`,
        );
      }
      if (response.status === 401 && authenticated) {
        logout();
        message("auth-message", "登录已过期，请重新登录。", true);
        throw stale();
      }
      if (!response.ok)
        throw new Error(
          `${data.error || "请求失败"}（HTTP ${response.status}）`,
        );
      return data;
    } catch (error) {
      if (controller.signal.aborted && epoch === state.epoch)
        throw new Error("请求超时或已取消，请重试。");
      throw error;
    } finally {
      clearTimeout(timeout);
      state.controllers.delete(controller);
    }
  }
  function safeURL(value) {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol))
      throw new Error("接口返回了无效的文件地址。");
    return url.href;
  }
  async function storageFetch(url, options = {}) {
    const epoch = state.epoch;
    const controller = new AbortController();
    state.controllers.add(controller);
    const timeout = setTimeout(
      () => controller.abort(),
      options.method === "PUT" ? 30 * 60 * 1000 : 60000,
    );
    try {
      // Object storage must never receive the API bearer token.
      const response = await fetch(safeURL(url), {
        ...options,
        signal: controller.signal,
      });
      if (epoch !== state.epoch) throw stale();
      if (!response.ok)
        throw new Error(`对象存储请求失败（HTTP ${response.status}）`);
      if (options.method === "PUT") return;
      const text = await response.text();
      if (epoch !== state.epoch) throw stale();
      return text;
    } finally {
      clearTimeout(timeout);
      state.controllers.delete(controller);
    }
  }
  function setMode(mode) {
    state.mode = mode;
    for (const m of ["login", "signup"]) {
      $(`${m}-mode`).classList.toggle("active", m === mode);
      $(`${m}-mode`).setAttribute("aria-pressed", String(m === mode));
    }
    $("auth-title").textContent =
      mode === "login" ? "登录工作空间" : "创建你的账户";
    $("auth-submit").textContent = mode === "login" ? "登录" : "注册并进入";
    $("auth-form").elements.password.autocomplete =
      mode === "login" ? "current-password" : "new-password";
    message("auth-message", "");
  }
  function signedIn(user) {
    state.user = user;
    $("account").textContent = user.email;
    $("account").title = user.user_id;
    $("logout").hidden = false;
    $("auth").hidden = true;
    $("workspace").hidden = false;
    route();
    refresh();
  }
  function logout() {
    resetRecording();
    stopFollowing();
    state.epoch++;
    state.token = "";
    state.user = null;
    localStorage.removeItem("vox_token");
    for (const controller of state.controllers) controller.abort();
    clearTimeout(state.timer);
    state.loading = false;
    state.busy = false;
    state.tasks = null;
    state.files = null;
    state.errors = {};
    state.updated = {};
    state.selectedFile = null;
    state.detail = null;
    state.detailVersion++;
    $("detail").close();
    $("detail-content").replaceChildren();
    $("create-form").reset();
    $("source").value = "upload";
    $("auth-form").reset();
    setCreateBusy(false);
    updateSource();
    $("selected-file").textContent = "未选择文件";
    message("create-message", "");
    $("account").textContent = "尚未登录";
    $("account").removeAttribute("title");
    $("logout").hidden = true;
    $("workspace").hidden = true;
    $("auth").hidden = false;
    $("table-body").replaceChildren();
    renderStats();
  }
  async function verify() {
    if (!state.token) return;
    message("auth-message", "正在验证登录状态…");
    try {
      signedIn(await request("/whoami"));
      message("auth-message", "");
    } catch (e) {
      if (e.name !== "AbortError")
        message("auth-message", `连接失败，可重新登录重试：${e.message}`, true);
    }
  }
  $("auth-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    $("auth-submit").disabled = true;
    message("auth-message", "正在连接…");
    try {
      const form = new FormData(event.currentTarget);
      const data = await request(
        `/${state.mode}`,
        {
          method: "POST",
          body: new URLSearchParams({
            email: form.get("email").trim(),
            password: form.get("password"),
          }),
        },
        false,
      );
      if (!data.token) throw new Error("登录响应缺少 token。");
      state.token = data.token;
      localStorage.setItem("vox_token", data.token);
      const user = await request("/whoami");
      $("auth-form").reset();
      signedIn(user);
      message("auth-message", "");
    } catch (e) {
      if (e.name !== "AbortError") message("auth-message", e.message, true);
    } finally {
      $("auth-submit").disabled = false;
    }
  });
  function route() {
    const view = location.hash.slice(1);
    state.view = ["tasks", "files", "create"].includes(view) ? view : "tasks";
    if (state.view !== "create") {
      stopRecording();
      $("record-preview").pause();
    }
    state.page = 1;
    $("search").value = "";
    $("status-filter").value = "";
    $("kind-filter").value = "";
    const copy = {
      tasks: ["全部任务", "从上传到完成，查看每一次转写的来龙去脉。"],
      files: ["文件库", "源文件、转码产物与转写结果，都在这里。"],
      create: ["新建转写", "选择一段声音，开始下一份记录。"],
    }[state.view];
    $("page-title").textContent = $("breadcrumb").textContent = copy[0];
    $("page-description").textContent = copy[1];
    document.querySelectorAll("[data-view]").forEach((a) => {
      const active = a.dataset.view === state.view;
      a.classList.toggle("active", active);
      if (active) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    $("list-view").hidden = state.view === "create";
    $("create-view").hidden = state.view !== "create";
    render();
  }
  function schedule() {
    clearTimeout(state.timer);
    if (state.user && $("auto-refresh").checked && !document.hidden)
      state.timer = setTimeout(refresh, 10000);
  }
  async function refresh() {
    if (!state.user || state.loading) return;
    const epoch = state.epoch;
    state.loading = true;
    $("refresh").disabled = true;
    clearTimeout(state.timer);
    render();
    await Promise.all(
      ["tasks", "files"].map(async (kind) => {
        try {
          const data = await request(
            kind === "tasks" ? "/tasks" : "/listfiles",
          );
          if (epoch !== state.epoch) return;
          if (data[kind] != null && !Array.isArray(data[kind]))
            throw new Error("列表格式不正确。");
          if (!Object.hasOwn(data, kind))
            throw new Error("接口响应缺少列表字段。");
          state[kind] = data[kind] || [];
          state.errors[kind] = "";
          state.updated[kind] = new Date();
        } catch (e) {
          if (epoch === state.epoch && e.name !== "AbortError")
            state.errors[kind] = e.message;
        }
      }),
    );
    if (epoch !== state.epoch) return;
    state.loading = false;
    $("refresh").disabled = false;
    render();
    // Keep an open task's metadata current, without replacing an active result player.
    if (
      state.detail?.kind === "task" &&
      !state.detail.reading &&
      !$("detail").querySelector("#result-body")
    ) {
      const task = state.tasks?.find((t) => taskID(t) === state.detail.id);
      if (task) renderTaskDetail(task);
    }
    schedule();
  }
  function roleOf(file) {
    const input = state.tasks?.some((t) => t.input_file_id === file.file_id);
    const output = state.tasks?.some((t) => t.output_file_id === file.file_id);
    if (input && output) return "输入与结果";
    return output ? "任务结果" : input ? "任务输入" : "其他文件";
  }
  function renderStats() {
    $("stat-tasks").textContent = $("nav-tasks").textContent =
      state.tasks?.length ?? "—";
    $("stat-active").textContent = state.tasks
      ? state.tasks.filter((t) =>
          ["pending", "dispatched", "processing"].includes(t.status),
        ).length
      : "—";
    $("stat-completed").textContent = state.tasks
      ? state.tasks.filter((t) => t.status === "completed").length
      : "—";
    $("stat-files").textContent = $("nav-files").textContent =
      state.files?.length ?? "—";
    $("stat-size").textContent = state.files
      ? `合计 ${bytes(state.files.reduce((sum, f) => sum + Number(f.size || 0), 0))}`
      : "源文件与处理产物";
  }
  function options(id, values, title, label = (v) => v) {
    const selected = $(id).value;
    $(id).innerHTML =
      `<option value="">${title}</option>` +
      [...new Set(values.filter(Boolean))]
        .sort()
        .map((v) => `<option value="${escape(v)}">${escape(label(v))}</option>`)
        .join("");
    $(id).value = [...$(id).options].some((o) => o.value === selected)
      ? selected
      : "";
  }
  function render() {
    renderStats();
    const selected = $("existing-file").value;
    $("existing-file").innerHTML =
      '<option value="">请选择可用文件</option>' +
      (state.files || [])
        .filter((f) => f.status === "ready")
        .map(
          (f) =>
            `<option value="${escape(f.file_id)}">${escape(f.file_name)} · ${escape(f.file_id)}</option>`,
        )
        .join("");
    $("existing-file").value = selected;
    if (state.view === "create") return;
    const kind = state.view;
    const rows = state[kind] || [];
    const isTask = kind === "tasks";
    $("list-title").textContent = isTask ? "任务记录" : "全部文件";
    options(
      "status-filter",
      rows.map((r) => r.status),
      "全部状态",
      (s) => labels[s] || s,
    );
    options(
      "kind-filter",
      rows.map((r) => (isTask ? r.type : roleOf(r))),
      isTask ? "全部类型" : "全部用途",
      isTask ? taskType : (v) => v,
    );
    const error = Object.entries(state.errors)
      .filter(([, value]) => value)
      .map(
        ([key, value]) =>
          `${key === "tasks" ? "任务" : "文件"}加载失败：${value}`,
      )
      .join("；");
    $("list-error").hidden = !error;
    $("list-error").textContent = error
      ? `${error}。${state[kind] ? "当前保留上次成功数据；" : ""}点击“刷新”重试。`
      : "";
    $("sync-status").textContent = state.loading
      ? "正在同步…"
      : state.updated[kind]
        ? `上次同步 ${state.updated[kind].toLocaleTimeString("zh-CN", { hour12: false })}`
        : "尚未加载成功";
    const query = $("search").value.trim().toLowerCase();
    const filtered = rows
      .filter((r) => {
        const corpus = isTask
          ? [
              ...Object.values(r),
              fileName(r.input_file_id),
              fileName(r.output_file_id),
            ]
          : Object.values(r);
        return (
          (!query || corpus.join(" ").toLowerCase().includes(query)) &&
          (!$("status-filter").value ||
            r.status === $("status-filter").value) &&
          (!$("kind-filter").value ||
            (isTask ? r.type : roleOf(r)) === $("kind-filter").value)
        );
      })
      .sort(
        (a, b) =>
          ($("sort").value === "oldest" ? 1 : -1) *
            (timeValue(a.created_at) - timeValue(b.created_at)) ||
          String(isTask ? a.task_id : a.file_id).localeCompare(
            String(isTask ? b.task_id : b.file_id),
          ),
      );
    const size = Number($("page-size").value),
      pages = Math.max(1, Math.ceil(filtered.length / size));
    state.page = Math.max(1, Math.min(state.page, pages));
    $("table-head").innerHTML =
      `<tr>${(isTask ? ["任务 / 输入文件", "类型", "状态", "创建时间", "操作"] : ["文件名 / ID", "大小", "状态", "用途", "创建时间", "操作"]).map((h) => `<th scope="col">${h}</th>`).join("")}</tr>`;
    $("table-body").innerHTML = filtered
      .slice((state.page - 1) * size, state.page * size)
      .map((r) =>
        isTask
          ? `<tr><td><button class="name name-link" data-action="${canRead(r) ? "read" : "task"}" data-id="${escape(r.task_id)}" title="${escape(fileName(r.input_file_id))}">${escape(fileName(r.input_file_id))}</button><span class="mono">${escape(r.task_id)}</span></td><td>${escape(taskType(r.type))}</td><td>${badge(r.status)}</td><td>${date(r.created_at)}</td><td><div class="table-actions">${canRead(r) ? button("read", r.task_id, "阅读转写") : ""}${button("task", r.task_id, "详情 ↗")}</div></td></tr>`
          : `<tr><td><button class="name name-link" data-action="file" data-id="${escape(r.file_id)}" title="${escape(r.file_name)}">${escape(r.file_name || "未命名文件")}</button><span class="mono">${escape(r.file_id)}</span></td><td>${bytes(r.size)}</td><td>${badge(r.status)}</td><td>${roleOf(r)}</td><td>${date(r.created_at)}</td><td>${button("file", r.file_id, "查看详情 ↗")}</td></tr>`,
      )
      .join("");
    $("empty").hidden = filtered.length > 0;
    $("empty-title").textContent =
      state.loading && !state[kind]
        ? "正在加载…"
        : !state[kind]
          ? "暂时无法加载记录"
          : rows.length
            ? "没有匹配的记录"
            : isTask
              ? "还没有任务"
              : "文件库还是空的";
    $("empty-description").textContent = !state[kind]
      ? "请稍候，或点击刷新重新获取。"
      : rows.length
        ? "试试其他关键词，或清除筛选条件。"
        : "上传一段音频或视频，开始第一次转写。";
    $("list-count").textContent = state[kind]
      ? `共 ${rows.length} 条${filtered.length !== rows.length ? ` · 筛选后 ${filtered.length} 条` : ""} · 当前 ${filtered.length ? (state.page - 1) * size + 1 : 0}–${Math.min(state.page * size, filtered.length)}`
      : "尚无可用数据";
    $("page-number").textContent = `${state.page} / ${pages}`;
    $("previous").disabled = state.page <= 1;
    $("next").disabled = state.page >= pages;
  }
  const field = (name, value) =>
    `<div><dt>${escape(name)}</dt><dd>${escape(value || "—")}</dd></div>`;
  const rawDetails = (data) =>
    `<details class="detail-section"><summary>查看 API 返回的完整记录</summary><pre class="raw">${escape(JSON.stringify(data, null, 2))}</pre></details>`;
  function openDetail(kind, id) {
    stopFollowing();
    $("result-player")?.pause();
    state.detail = { kind, id };
    state.detailVersion++;
    $("detail-kind").textContent =
      kind === "task" ? "TASK DETAILS" : "FILE DETAILS";
    $("detail-title").textContent = kind === "task" ? "任务详情" : "文件详情";
    $("detail-content").textContent = "正在加载…";
    if (!$("detail").open) $("detail").showModal();
  }
  async function showTask(id, reading = false) {
    openDetail("task", id);
    state.detail.reading = reading;
    if (reading) {
      $("detail-kind").textContent = "TRANSCRIPT";
      $("detail-title").textContent = "正在打开转写…";
    }
    const version = state.detailVersion;
    try {
      const data = await request(`/tasks/${idPath(id)}`);
      if (version !== state.detailVersion) return;
      if (!data.task) throw new Error("任务响应为空。");
      if (reading && canRead(data.task)) {
        renderReader(data.task);
        await showResult();
      } else {
        state.detail.reading = false;
        $("detail-kind").textContent = "TASK DETAILS";
        $("detail-title").textContent = "任务详情";
        renderTaskDetail(data.task);
      }
    } catch (e) {
      if (version === state.detailVersion && e.name !== "AbortError")
        $("detail-content").innerHTML =
          `<p class="message error">${escape(e.message)}</p>${button(reading ? "read" : "task", id, "重新加载")}`;
    }
  }
  function renderTaskDetail(task) {
    const duration =
      timeValue(task.finished_at) && timeValue(task.created_at)
        ? `${Math.max(0, (timeValue(task.finished_at) - timeValue(task.created_at)) / 1000).toFixed(1)} 秒`
        : "—";
    $("detail-content").innerHTML =
      `<dl class="detail-grid">${field("任务 ID", task.task_id)}${field("任务类型", taskType(task.type))}<div><dt>状态</dt><dd>${badge(task.status)}</dd></div>${field("所属用户", task.user_id)}${field("创建时间", date(task.created_at))}${field("完成时间", date(task.finished_at))}${field("总耗时", duration)}</dl><div class="detail-section"><h3>关联文件</h3><dl class="detail-grid">${field("输入文件", fileName(task.input_file_id))}${field("输入文件 ID", task.input_file_id)}${field("结果文件", task.output_file_id ? fileName(task.output_file_id) : "尚无结果文件")}${field("结果文件 ID", task.output_file_id)}</dl><div class="detail-actions">${task.input_file_id ? button("file", task.input_file_id, "查看输入文件") : ""}${task.output_file_id ? button("file", task.output_file_id, "查看结果文件") : ""}${task.status === "completed" && task.type === "transcribe" && task.output_file_id ? button("result", task.task_id, "阅读转写结果") : ""}${button("task", task.task_id, "刷新详情")}</div></div>${task.status === "failed" ? '<p class="note">任务执行失败。当前 API 未返回失败原因；可从输入文件重新创建任务。</p>' : ""}<div id="result-slot"></div>${rawDetails(task)}`;
    state.detail.task = task;
  }
  function renderReader(task) {
    stopFollowing();
    $("result-player")?.pause();
    renderTaskDetail(task);
    state.detail.reading = true;
    $("detail-kind").textContent = "TRANSCRIPT";
    $("detail-title").textContent = fileName(task.input_file_id);
    // Reading comes first; metadata stays available without another navigation.
    $("result-slot").remove();
    const metadata = document.createElement("details");
    metadata.className = "reader-metadata";
    const summary = document.createElement("summary");
    summary.textContent = "任务与文件信息";
    metadata.append(summary, ...$("detail-content").childNodes);
    metadata.querySelector('[data-action="result"]')?.remove();
    const slot = document.createElement("div");
    slot.id = "result-slot";
    $("detail-content").replaceChildren(slot, metadata);
    $("detail").scrollTop = 0;
  }
  function showFile(id) {
    openDetail("file", id);
    const file = state.files?.find((f) => f.file_id === id);
    const related =
      state.tasks?.filter(
        (t) => t.input_file_id === id || t.output_file_id === id,
      ) || [];
    $("detail-content").innerHTML = file
      ? `<dl class="detail-grid">${field("文件名", file.file_name)}${field("文件 ID", file.file_id)}${field("所属用户", file.owner)}${field("文件大小", bytes(file.size))}<div><dt>状态</dt><dd>${badge(file.status)}</dd></div>${field("创建时间", date(file.created_at))}${field("文件用途", roleOf(file))}</dl>`
      : `<p class="note">文件列表中暂未找到这条记录，可刷新列表重试。</p><dl class="detail-grid">${field("文件 ID", id)}</dl>`;
    $("detail-content").innerHTML +=
      `<div class="detail-actions">${button("download", id, "打开 / 下载文件")}${file?.status === "ready" ? button("reuse", id, "用此文件新建转写") : ""}${file && file.status !== "ready" ? button("complete", id, "校验上传是否完成") : ""}</div><div class="detail-section"><h3>关联任务（${related.length}）</h3>${related.map((t) => `<p>${button("task", t.task_id, t.task_id)} ${badge(t.status)} ${canRead(t) ? button("read", t.task_id, "阅读转写") : ""}</p>`).join("") || `<p class="muted">${state.tasks ? "当前任务记录没有引用此文件。" : "任务列表尚未加载，暂无法确定关联关系。"}</p>`}</div>${file ? rawDetails(file) : ""}`;
  }
  async function download(id) {
    const epoch = state.epoch;
    const data = await request(`/download/${idPath(id)}`);
    if (epoch !== state.epoch) return;
    const a = document.createElement("a");
    a.href = safeURL(data.download_url);
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.click();
    toast("已打开文件地址；可在浏览器中保存文件。");
  }
  function stopFollowing() {
    state.followCleanup?.();
    state.followCleanup = null;
  }
  function setupFollowing(content) {
    const controls = document.createElement("div");
    controls.className = "follow-controls";
    controls.innerHTML = `<label class="checkbox"><input id="follow-enabled" type="checkbox" checked> 字幕跟随</label><span id="follow-status" class="muted" role="status">正在跟随</span><label class="follow-delay">停止操作 <select id="follow-delay" aria-label="自动恢复字幕跟随的等待秒数">${[3, 5, 10, 15, 30].map((n) => `<option value="${n}">${n} 秒</option>`).join("")}</select> 后恢复</label><button id="follow-now" type="button" hidden>立即跟随</button>`;
    content.before(controls);
    content.tabIndex = 0;
    content.setAttribute(
      "aria-label",
      "转写字幕，可滚动浏览；停止操作后恢复跟随",
    );
    const enabled = controls.querySelector("#follow-enabled");
    const delay = controls.querySelector("#follow-delay");
    const status = controls.querySelector("#follow-status");
    const now = controls.querySelector("#follow-now");
    let saved;
    try {
      saved = localStorage.getItem("vox_follow_delay");
    } catch {
      /* Optional preference. */
    }
    delay.value = ["3", "5", "10", "15", "30"].includes(saved) ? saved : "5";
    let following = true,
      timer = null,
      holding = false,
      last = null;
    const events = new AbortController();
    const listen = (element, event, handler, options = {}) =>
      element.addEventListener(event, handler, {
        ...options,
        signal: events.signal,
      });
    const update = () => {
      status.textContent = !enabled.checked
        ? "跟随已关闭"
        : following
          ? "正在跟随"
          : `浏览中 · ${delay.value} 秒无操作后恢复`;
      now.hidden = following && enabled.checked;
    };
    const follow = (force = false) => {
      if (!following || !enabled.checked || !content.isConnected) return;
      const active = content.querySelector('[aria-current="true"]');
      if (!active || (!force && active === last)) return;
      last = active;
      const box = content.getBoundingClientRect(),
        row = active.getBoundingClientRect();
      // Scroll only the transcript, never the containing dialog or page.
      content.scrollTo({
        top:
          content.scrollTop +
          row.top -
          box.top -
          (content.clientHeight - row.height) / 2,
        behavior: "instant",
      });
    };
    const resume = () => {
      clearTimeout(timer);
      following = true;
      last = null;
      update();
      follow(true);
    };
    const schedule = () => {
      clearTimeout(timer);
      if (enabled.checked && !holding)
        timer = setTimeout(resume, Number(delay.value) * 1000);
    };
    const pause = () => {
      if (!enabled.checked) return;
      following = false;
      update();
      schedule();
    };
    listen(content, "wheel", pause, { passive: true });
    listen(content, "touchmove", pause, { passive: true });
    listen(content, "pointerdown", () => {
      holding = true;
      pause();
    });
    for (const event of ["pointerup", "pointercancel"])
      listen(document, event, () => {
        if (holding) {
          holding = false;
          if (!following) schedule();
        }
      });
    listen(window, "blur", () => {
      holding = false;
      if (!following) schedule();
    });
    listen(content, "keydown", (event) => {
      if (
        [
          "ArrowUp",
          "ArrowDown",
          "PageUp",
          "PageDown",
          "Home",
          "End",
          " ",
          "Tab",
        ].includes(event.key)
      )
        pause();
    });
    // Inertia and dragging the scrollbar also extend the idle period.
    // Programmatic follow scrolls occur only while following, so cannot pause it.
    listen(
      content,
      "scroll",
      () => {
        if (!following) schedule();
      },
      { passive: true },
    );
    listen(enabled, "change", () => {
      clearTimeout(timer);
      following = enabled.checked;
      last = null;
      update();
      if (following) follow(true);
    });
    listen(now, "click", () => {
      enabled.checked = true;
      resume();
    });
    listen(delay, "change", () => {
      try {
        localStorage.setItem("vox_follow_delay", delay.value);
      } catch {
        /* Optional preference. */
      }
      update();
      if (!following) schedule();
    });
    state.followCleanup = () => {
      clearTimeout(timer);
      events.abort();
    };
    return follow;
  }
  async function showResult() {
    const task = state.detail?.task;
    if (!task?.output_file_id) return;
    const version = ++state.detailVersion;
    stopFollowing();
    $("result-player")?.pause();
    $("result-slot").innerHTML =
      '<section class="detail-section" id="result-body"><h3>转写结果</h3><p class="muted">正在读取结果…</p></section>';
    try {
      const data = await request(`/download/${idPath(task.output_file_id)}`);
      if (version !== state.detailVersion) return;
      const raw = await storageFetch(data.download_url);
      if (version !== state.detailVersion) return;
      let text = raw,
        segments = [];
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed.text === "string") {
          text = parsed.text;
          segments = (
            Array.isArray(parsed.segments) ? parsed.segments : []
          ).filter(
            (s) =>
              s.start_ms != null &&
              Number.isFinite(Number(s.start_ms)) &&
              Number(s.start_ms) >= 0 &&
              typeof s.text === "string",
          );
        }
      } catch {
        /* Plain-text transcripts are also supported. */
      }
      const body = $("result-body");
      body.innerHTML = `<h3>转写结果</h3><div class="detail-actions"><button id="copy-text">复制文本</button><button id="save-text">下载文本</button></div><div id="player-slot"></div><div class="transcript"></div>`;
      const content = body.querySelector(".transcript");
      if (segments.length)
        content.innerHTML = segments
          .map((s, index) => {
            const start = Number(s.start_ms) / 1000;
            const end = Number(s.end_ms) / 1000;
            const next = Number(segments[index + 1]?.start_ms) / 1000;
            return `<button type="button" class="segment" data-seek="${start}" data-end="${Number.isFinite(end) && end > start ? end : Number.isFinite(next) && next > start ? next : Infinity}"><span class="segment-time">${Math.floor(start / 60)}:${String(Math.floor(start) % 60).padStart(2, "0")}</span><span>${escape(s.text)}</span></button>`;
          })
          .join("");
      else content.textContent = text || "结果文件为空。";
      const follow = segments.length ? setupFollowing(content) : () => {};
      $("copy-text").onclick = async () => {
        try {
          await navigator.clipboard.writeText(text);
          toast("已复制转写文本");
        } catch {
          toast("复制失败，请手动选择文本复制。");
        }
      };
      $("save-text").onclick = () => {
        const url = URL.createObjectURL(
          new Blob([text], { type: "text/plain;charset=utf-8" }),
        );
        const a = document.createElement("a");
        a.href = url;
        a.download = `transcript-${task.task_id}.txt`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      };
      if (task.input_file_id) {
        try {
          const media = await request(
            `/download/${idPath(task.input_file_id)}`,
          );
          if (version !== state.detailVersion) return;
          const name = fileName(task.input_file_id);
          // Unknown extensions use video, which can also play audio-only sources.
          const audioOnly =
            /\.(wav|mp3|m4a|aac|flac|ogg|oga|opus|aiff|aif|wma)$/i.test(name) ||
            /^recording-.*\.webm$/i.test(name);
          const player = document.createElement(audioOnly ? "audio" : "video");
          player.setAttribute("playsinline", "");
          player.setAttribute("aria-label", "原始音视频播放器");
          player.controls = true;
          player.preload = "metadata";
          player.src = safeURL(media.download_url);
          player.id = "result-player";
          const sync = () => {
            if (version !== state.detailVersion) return;
            if (
              player.readyState >= 1 &&
              player.dataset.pendingSeek !== undefined
            ) {
              const target = Number(player.dataset.pendingSeek);
              delete player.dataset.pendingSeek;
              player.currentTime = Number.isFinite(player.duration)
                ? Math.min(target, player.duration)
                : target;
            }
            body.querySelectorAll("[data-seek]").forEach((segment) => {
              const active =
                !player.ended &&
                player.currentTime >= Number(segment.dataset.seek) &&
                player.currentTime < Number(segment.dataset.end);
              segment.classList.toggle("is-playing", active);
              if (active) segment.setAttribute("aria-current", "true");
              else segment.removeAttribute("aria-current");
            });
            follow();
          };
          for (const event of [
            "loadedmetadata",
            "timeupdate",
            "seeking",
            "ended",
          ])
            player.addEventListener(event, sync);
          player.onerror = () => {
            if (version === state.detailVersion)
              $("player-slot").textContent =
                "浏览器无法播放该源文件，可从文件详情下载。";
          };
          $("player-slot").append(player);
        } catch (e) {
          if (version === state.detailVersion && e.name !== "AbortError")
            $("player-slot").textContent = `音视频加载失败：${e.message}`;
        }
      }
    } catch (e) {
      if (version === state.detailVersion && e.name !== "AbortError")
        $("result-body").innerHTML =
          `<p class="message error">无法读取结果：${escape(e.message)}</p>${button("result", task.task_id, "重试读取结果")}`;
    }
  }
  function releaseMic() {
    const r = state.recording;
    clearInterval(r.timer);
    r.timer = null;
    r.stream?.getTracks().forEach((track) => track.stop());
    r.stream = null;
  }
  function renderRecording() {
    const r = state.recording;
    const active = ["requesting", "recording", "stopping"].includes(r.phase);
    $("record-start").disabled = state.busy || active;
    $("record-stop").disabled = state.busy || r.phase !== "recording";
    $("record-clear").hidden = !r.file;
    $("record-clear").disabled = state.busy || active;
    $("record-start").textContent = r.file ? "● 重新录音" : "● 开始录音";
    $("record-label").textContent =
      {
        requesting: "等待麦克风授权…",
        recording: "正在录音",
        stopping: "正在整理录音…",
      }[r.phase] || (r.file ? "录音已就绪" : "准备录音");
    $("record-fields").classList.toggle(
      "is-recording",
      r.phase === "recording",
    );
    $("create-submit").disabled =
      state.busy || active || ($("source").value === "record" && !r.file);
  }
  function clearRecordingFile() {
    const r = state.recording;
    $("record-preview").pause();
    $("record-preview").removeAttribute("src");
    $("record-preview").load();
    $("record-preview").hidden = true;
    if (r.url) URL.revokeObjectURL(r.url);
    r.url = "";
    r.file = null;
  }
  function resetRecording() {
    const r = state.recording;
    r.version++;
    if (r.recorder?.state !== "inactive" && r.recorder) r.recorder.stop();
    releaseMic();
    r.recorder = null;
    r.phase = "idle";
    clearRecordingFile();
    $("record-time").textContent = "00:00";
    message(
      "record-message",
      "录音仅保存在当前页面，提交后才会上传。请在 HTTPS 或 localhost 下使用麦克风。",
    );
    renderRecording();
  }
  function stopRecording() {
    const r = state.recording;
    if (r.phase === "requesting") {
      r.version++;
      r.phase = "idle";
      message("record-message", "已取消开始录音。");
      renderRecording();
    } else if (r.phase === "recording") {
      r.phase = "stopping";
      r.recorder.stop();
      releaseMic();
      renderRecording();
    }
  }
  async function startRecording() {
    const r = state.recording;
    if (state.busy || r.phase !== "idle" || !state.user) return;
    if (
      !window.isSecureContext ||
      !navigator.mediaDevices?.getUserMedia ||
      !window.MediaRecorder
    ) {
      message(
        "record-message",
        "当前环境无法录音，请使用支持录音的浏览器，并通过 HTTPS 或 localhost 打开页面。",
        true,
      );
      return;
    }
    const version = ++r.version;
    r.phase = "requesting";
    renderRecording();
    message("record-message", "请允许浏览器使用麦克风。");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (
        version !== r.version ||
        !state.user ||
        state.view !== "create" ||
        $("source").value !== "record"
      ) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      r.stream = stream;
      const mime = [
        "audio/webm;codecs=opus",
        "audio/mp4",
        "audio/ogg;codecs=opus",
        "audio/webm",
      ].find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(
        stream,
        mime ? { mimeType: mime } : {},
      );
      r.recorder = recorder;
      const chunks = [];
      let failed = false;
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onerror = () => {
        if (version !== r.version) return;
        failed = true;
        message(
          "record-message",
          "录音设备出现错误，请检查麦克风后重新录音。",
          true,
        );
        if (r.phase === "recording") stopRecording();
      };
      recorder.onstop = () => {
        if (version !== r.version) return;
        releaseMic();
        r.recorder = null;
        r.phase = "idle";
        const type =
          recorder.mimeType || chunks[0]?.type || mime || "audio/webm";
        const blob = new Blob(chunks, { type });
        if (!failed && blob.size) {
          const extension = type.includes("mp4")
            ? "m4a"
            : type.includes("ogg")
              ? "ogg"
              : "webm";
          r.file = new File(
            [blob],
            `recording-${new Date().toISOString().replace(/[:.]/g, "-")}.${extension}`,
            { type },
          );
          r.url = URL.createObjectURL(r.file);
          $("record-preview").src = r.url;
          $("record-preview").hidden = false;
          message(
            "record-message",
            `录音已保存到当前页面 · ${bytes(r.file.size)}。试听后点击“创建转写任务”上传。`,
          );
        } else if (!failed)
          message("record-message", "没有录到有效音频，请重新录音。", true);
        renderRecording();
      };
      stream.getAudioTracks().forEach((track) =>
        track.addEventListener(
          "ended",
          () => {
            if (version === r.version) stopRecording();
          },
          { once: true },
        ),
      );
      clearRecordingFile();
      recorder.start(1000);
      r.phase = "recording";
      const start = performance.now();
      const tick = () => {
        const seconds = Math.floor((performance.now() - start) / 1000);
        $("record-time").textContent =
          `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
      };
      tick();
      r.timer = setInterval(tick, 250);
      message(
        "record-message",
        "麦克风录音中，点击“停止录音”后可试听。离开新建转写页面会自动停止。",
      );
      renderRecording();
    } catch (error) {
      if (version !== r.version) return;
      releaseMic();
      r.recorder = null;
      r.phase = "idle";
      const reasons = {
        NotAllowedError:
          "麦克风权限被拒绝，请在浏览器的站点设置中允许麦克风后重试。",
        NotFoundError: "未找到麦克风，请连接录音设备后重试。",
        NotReadableError: "无法使用麦克风，设备可能被其他应用占用。",
      };
      message(
        "record-message",
        reasons[error.name] || `无法开始录音：${error.message}`,
        true,
      );
      renderRecording();
    }
  }
  function updateSource() {
    const source = $("source").value;
    document.querySelectorAll("[data-source]").forEach((button) => {
      const active = button.dataset.source === source;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    if (source !== "record") stopRecording();
    $("upload-fields").hidden = source !== "upload";
    $("existing-fields").hidden = source !== "existing";
    $("record-fields").hidden = source !== "record";
    if (source !== "record") $("record-preview").pause();
    renderRecording();
  }
  function chooseFile(file) {
    if (!file || state.busy) return;
    state.selectedFile = file;
    $("selected-file").textContent = `${file.name} · ${bytes(file.size)}`;
  }
  function setCreateBusy(busy) {
    state.busy = busy;
    $("create-form")
      .querySelectorAll("input, select, button")
      .forEach((el) => {
        el.disabled = busy;
      });
    renderRecording();
  }
  $("create-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (state.busy || !state.user) return;
    const epoch = state.epoch,
      language = $("language").value;
    let id = $("source").value === "existing" ? $("existing-file").value : "";
    if (state.recording.phase !== "idle") return;
    const file =
      $("source").value === "record"
        ? state.recording.file
        : state.selectedFile;
    if ($("source").value === "existing" ? !id : !file) {
      message("create-message", "请先选择一个文件。", true);
      return;
    }
    setCreateBusy(true);
    try {
      if (!id) {
        message("create-message", "1 / 4 · 正在申请上传地址…");
        const upload = await request("/upload", {
          method: "POST",
          body: new URLSearchParams({ filename: file.name }),
        });
        id = upload.file_id;
        if (!id) throw new Error("上传响应缺少文件 ID。");
        message("create-message", "2 / 4 · 正在上传文件，请保持此页面打开…");
        await storageFetch(upload.upload_url, {
          method: "PUT",
          body: new Blob([file]),
        });
        message("create-message", "3 / 4 · 正在校验上传结果…");
        await request(`/files/${idPath(id)}/complete`, { method: "POST" });
        // Preserve the completed file if creating the task fails; retry must not upload it again.
        await refresh();
        if (epoch !== state.epoch) return;
        $("source").value = "existing";
        updateSource();
        if (![...$("existing-file").options].some((o) => o.value === id))
          $("existing-file").add(new Option(file.name, id));
        $("existing-file").value = id;
      }
      message("create-message", "4 / 4 · 正在创建转写任务…");
      const task = await request("/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input_file_id: id,
          type: "transcribe",
          language,
        }),
      });
      if (!task.task_id)
        throw new Error("创建响应缺少任务 ID，请刷新任务列表确认。");
      message("create-message", `任务已创建：${task.task_id}`);
      toast("任务已提交，可以在任务列表中跟踪进度。");
      location.hash = "#tasks";
      await refresh();
      if (epoch === state.epoch) await showTask(task.task_id);
    } catch (e) {
      if (epoch === state.epoch && e.name !== "AbortError") {
        message(
          "create-message",
          `${e.message}${id ? ` 文件 ID：${id}。如提交结果不确定，请先刷新任务列表确认。` : ""}`,
          true,
        );
        refresh();
      }
    } finally {
      if (epoch === state.epoch) setCreateBusy(false);
    }
  });
  document.addEventListener("click", async (event) => {
    const target = event.target.closest("[data-action]");
    if (!target || target.disabled) return;
    const { action, id } = target.dataset;
    target.disabled = true;
    try {
      if (action === "task") await showTask(id);
      if (action === "read") await showTask(id, true);
      if (action === "file") showFile(id);
      if (action === "download") await download(id);
      if (action === "result" && state.detail?.task) {
        renderReader(state.detail.task);
        await showResult();
      }
      if (action === "complete") {
        await request(`/files/${idPath(id)}/complete`, { method: "POST" });
        toast("上传已校验完成");
        await refresh();
        if (state.detail?.id === id) showFile(id);
      }
      if (action === "reuse") {
        $("detail").close();
        location.hash = "#create";
        $("source").value = "existing";
        updateSource();
        $("existing-file").value = id;
        message("create-message", "已选择现有文件，请确认语言后创建任务。");
      }
    } catch (e) {
      if (e.name !== "AbortError") toast(e.message);
    } finally {
      target.disabled = false;
    }
  });
  $("detail").addEventListener("click", async (event) => {
    const seek = event.target.closest("[data-seek]");
    if (!seek) return;
    const player = $("result-player");
    if (!player) return toast("音视频尚不可用，请稍后重试。");
    try {
      const target = Number(seek.dataset.seek);
      if (player.readyState >= 1) {
        player.currentTime = Number.isFinite(player.duration)
          ? Math.min(target, player.duration)
          : target;
      } else {
        // Seek after metadata arrives; repeated clicks keep the most recent target.
        player.dataset.pendingSeek = String(target);
      }
      await player.play();
    } catch {
      toast("无法播放，请下载源文件后查看。");
    }
  });
  $("detail").addEventListener("close", () => {
    stopFollowing();
    $("result-player")?.pause();
    state.detail = null;
    state.detailVersion++;
    $("detail-content").replaceChildren();
  });
  $("close-detail").onclick = () => $("detail").close();
  $("login-mode").onclick = () => setMode("login");
  $("signup-mode").onclick = () => setMode("signup");
  $("logout").onclick = logout;
  $("refresh").onclick = refresh;
  $("auto-refresh").onchange = schedule;
  document.querySelectorAll("[data-source]").forEach((button) => {
    button.onclick = () => {
      $("source").value = button.dataset.source;
      updateSource();
    };
  });
  $("record-entry").onclick = () => {
    if (state.busy) return toast("请等待当前任务提交完成。");
    location.hash = "#create";
    route();
    $("source").value = "record";
    updateSource();
    $("record-fields").scrollIntoView({ block: "center" });
    $("record-start").focus({ preventScroll: true });
  };
  $("record-start").onclick = startRecording;
  $("record-stop").onclick = stopRecording;
  $("record-clear").onclick = resetRecording;
  window.addEventListener("pagehide", () => {
    resetRecording();
  });
  $("file-input").onchange = (e) => chooseFile(e.target.files[0]);
  for (const name of ["dragover", "dragleave", "drop"])
    $("drop-zone").addEventListener(name, (event) => {
      event.preventDefault();
      $("drop-zone").classList.toggle("dragging", name === "dragover");
      if (name === "drop") chooseFile(event.dataTransfer.files[0]);
    });
  for (const id of [
    "search",
    "status-filter",
    "kind-filter",
    "sort",
    "page-size",
  ])
    $(id).addEventListener(id === "search" ? "input" : "change", () => {
      state.page = 1;
      render();
    });
  $("previous").onclick = () => {
    state.page--;
    render();
  };
  $("next").onclick = () => {
    state.page++;
    render();
  };
  window.addEventListener("hashchange", route);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) clearTimeout(state.timer);
    else if ($("auto-refresh").checked) refresh();
  });
  window.addEventListener("storage", (event) => {
    if (event.key === "vox_token" && event.newValue !== state.token) {
      logout();
      message("auth-message", "账户状态已在其他页面更改，请重新登录。");
    }
  });
  route();
  verify();
})();
