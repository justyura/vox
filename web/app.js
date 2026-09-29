(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const API = "/api/v1";
  const STEPS = ["上传", "转码", "转写", "完成"];
  const WORD = /[A-Za-z]+(?:['’][A-Za-z]+)*/g;

  // localStorage can throw (private mode, blocked site data); the app must still work.
  const store = {
    get: (k) => {
      try {
        return localStorage.getItem(k) || "";
      } catch {
        return "";
      }
    },
    set: (k, v) => {
      try {
        if (v) localStorage.setItem(k, v);
        else localStorage.removeItem(k);
      } catch {
        /* optional */
      }
    },
  };

  const state = {
    token: store.get("vox_token"),
    user: null,
    // Bumped on logout; any response that arrives for an older epoch is dropped.
    epoch: 0,
    mode: "login",
    tasks: [],
    files: [],
    loaded: false,
    uploads: [], // uploads still in the browser, before a task exists
    filters: { tasks: "all", files: "all" },
    search: { tasks: "", files: "" },
    pages: { tasks: 1, files: 1 },
    taskStatus: "all",
    listError: "",
    timer: null,
    controllers: new Set(),
    xhrs: new Set(),
    rec: {
      phase: "idle",
      version: 0,
      recorder: null,
      stream: null,
      timer: null,
    },
    reader: null,
    readVersion: 0,
  };

  /* ---------- helpers ---------- */
  const escape = (v) =>
    String(v ?? "").replace(
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
  const timeValue = (v) => {
    if (!v) return 0;
    const n =
      typeof v === "object"
        ? Number(v.seconds || 0) * 1000 + Number(v.nanos || 0) / 1e6
        : Date.parse(v);
    return Number.isFinite(n) ? n : 0;
  };
  const shortDate = (v) => {
    const t = timeValue(v);
    if (!t) return "";
    const d = new Date(t);
    return new Date().toDateString() === d.toDateString()
      ? `今天 ${d.toTimeString().slice(0, 5)}`
      : `${d.getMonth() + 1}月${d.getDate()}日`;
  };
  const bytes = (v) => {
    const n = Number(v || 0);
    if (!Number.isFinite(n) || n <= 0) return "";
    if (n < 1024) return `${n} B`;
    const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), 4);
    return `${(n / 1024 ** i).toFixed(1)} ${["B", "KB", "MB", "GB", "TB"][i]}`;
  };
  const clock = (sec) =>
    `${Math.floor(sec / 60)}:${String(Math.floor(sec) % 60).padStart(2, "0")}`;
  const fileOf = (id) => state.files.find((f) => f.file_id === id);
  const nameOf = (id) => fileOf(id)?.file_name || "未命名文件";
  // Browser recordings are saved as webm but hold audio only.
  const isVideo = (name) =>
    /\.(mp4|mov|mkv|avi|m4v|webm)$/i.test(name) && !/^recording-/i.test(name);
  const kindLabel = (name) =>
    /^recording-/i.test(name)
      ? "REC"
      : (name.split(".").pop() || "").slice(0, 4).toUpperCase() || "FILE";
  const isSource = (f) =>
    state.tasks.some((t) => t.input_file_id === f.file_id) ||
    (!state.tasks.some((t) => t.output_file_id === f.file_id) &&
      !/^(result-|transcoded-)/.test(f.file_name || ""));

  let toastTimer = null;
  function toast(text) {
    $("toast").textContent = text;
    $("toast").hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ($("toast").hidden = true), 4000);
  }
  function msg(id, text, error = false) {
    $(id).textContent = text;
    $(id).classList.toggle("error", error);
  }
  const stale = () => new DOMException("请求已取消", "AbortError");

  /* ---------- network ---------- */
  async function request(path, options = {}, authenticated = true) {
    const epoch = state.epoch;
    const controller = new AbortController();
    state.controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const headers = new Headers(options.headers);
      if (authenticated) headers.set("Authorization", `Bearer ${state.token}`);
      const res = await fetch(API + path, {
        ...options,
        headers,
        signal: controller.signal,
      });
      const raw = await res.text();
      if (epoch !== state.epoch) throw stale();
      // 204 and friends carry no body; anything else must be JSON.
      let data = {};
      if (raw !== "") {
        try {
          data = JSON.parse(raw);
        } catch {
          throw new Error(`接口没有返回有效数据（HTTP ${res.status}）。`);
        }
      }
      if (res.status === 401 && authenticated) {
        logout();
        msg("auth-msg", "登录已过期，请重新登录。", true);
        throw stale();
      }
      if (!res.ok)
        throw new Error(`${data.error || "请求失败"}（HTTP ${res.status}）`);
      return data;
    } catch (e) {
      if (controller.signal.aborted && epoch === state.epoch)
        throw new Error("请求超时，请重试。");
      throw e;
    } finally {
      clearTimeout(timeout);
      state.controllers.delete(controller);
    }
  }
  function safeURL(value) {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol))
      throw new Error("文件地址无效。");
    return url.href;
  }
  // Object storage must never receive the API bearer token.
  async function storageText(url, signal) {
    const epoch = state.epoch;
    const res = await fetch(safeURL(url), {
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(30000)])
        : AbortSignal.timeout(30000),
    });
    if (epoch !== state.epoch) throw stale();
    if (!res.ok) throw new Error(`读取文件失败（HTTP ${res.status}）`);
    return res.text();
  }
  // fetch cannot report upload progress, XMLHttpRequest can.
  function putFile(url, file, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      state.xhrs.add(xhr);
      xhr.open("PUT", safeURL(url));
      xhr.timeout = 15 * 60 * 1000;
      xhr.ontimeout = () => {
        state.xhrs.delete(xhr);
        reject(new Error("上传超时，请检查网络后重试。"));
      };
      xhr.upload.onprogress = (e) =>
        e.lengthComputable && onProgress(e.loaded / e.total);
      xhr.onload = () => {
        state.xhrs.delete(xhr);
        xhr.status >= 200 && xhr.status < 300
          ? resolve()
          : reject(new Error(`上传失败（HTTP ${xhr.status}）`));
      };
      xhr.onerror = () => {
        state.xhrs.delete(xhr);
        reject(new Error("上传失败，请检查网络后重试。"));
      };
      xhr.onabort = () => {
        state.xhrs.delete(xhr);
        reject(stale());
      };
      // A typeless Blob sends no Content-Type, which the presigned signature does not cover.
      xhr.send(new Blob([file]));
    });
  }
  function saveBlob(name, text, type = "text/plain;charset=utf-8") {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ---------- auth ---------- */
  function setMode(mode) {
    state.mode = mode;
    const login = mode === "login";
    $("auth-title").textContent = login ? "登录" : "创建账号";
    $("auth-submit").textContent = login ? "登录" : "注册并进入";
    $("auth-switch-text").textContent = login ? "还没有账号？" : "已经有账号？";
    $("auth-switch").textContent = login ? "注册" : "登录";
    $("auth-form").elements.password.autocomplete = login
      ? "current-password"
      : "new-password";
    msg("auth-msg", "");
  }
  function signedIn(user) {
    state.user = user;
    $("account").textContent = user.email;
    $("auth").hidden = true;
    render();
    $("app").hidden = false;
    route();
    refresh();
  }
  function logout(clearToken = true) {
    stopRecording(true);
    leaveReader();
    state.epoch++;
    inflight = null;
    for (const c of state.controllers) c.abort();
    for (const x of state.xhrs) x.abort();
    clearTimeout(state.timer);
    Object.assign(state, {
      token: "",
      user: null,
      tasks: [],
      files: [],
      loaded: false,
      uploads: [],
      listError: "",
    });
    if (clearToken) store.set("vox_token", "");
    $("auth-form").reset();
    $("app").hidden = true;
    $("auth").hidden = false;
  }
  async function verify() {
    const epoch = state.epoch;
    if (!state.token) {
      $("auth").hidden = false;
      return;
    }
    try {
      signedIn(await request("/whoami"));
    } catch (e) {
      if (epoch !== state.epoch) return;
      $("auth").hidden = false;
      if (e.name !== "AbortError")
        msg("auth-msg", `连接失败：${e.message}`, true);
    }
  }
  $("auth-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    $("auth-submit").disabled = true;
    msg("auth-msg", "正在连接…");
    try {
      const data = await request(
        `/${state.mode}`,
        {
          method: "POST",
          body: new URLSearchParams({
            email: String(form.get("email")).trim(),
            password: String(form.get("password")),
          }),
        },
        false,
      );
      if (!data.token) throw new Error("登录响应缺少凭证。");
      state.token = data.token;
      store.set("vox_token", data.token);
      signedIn(await request("/whoami"));
      msg("auth-msg", "");
    } catch (e) {
      if (e.name !== "AbortError") msg("auth-msg", e.message, true);
    } finally {
      $("auth-submit").disabled = false;
    }
  });
  $("auth-switch").onclick = () =>
    setMode(state.mode === "login" ? "signup" : "login");
  $("logout").onclick = () => logout();

  /* ---------- routing ---------- */
  function route() {
    if (!state.user) return;
    const [, view = "", id = ""] = location.hash.split("/");
    const name = ["files", "about", "faq", "read"].includes(view)
      ? view
      : "home";
    leaveReader();
    if (name !== "home") {
      if (state.rec.phase === "recording") stopRecording(false);
      else if (state.rec.phase === "requesting") {
        stopRecording(true);
        msg("upload-msg", "录音已取消。");
      }
      $("rec-preview").pause();
    }
    for (const v of ["home", "files", "about", "faq", "read"])
      $(`view-${v}`).hidden = v !== name;
    const nav = name === "read" ? "home" : name;
    document.querySelectorAll("[data-nav]").forEach((a) => {
      if (a.dataset.nav === nav) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    if (name === "read") {
      try {
        openReader(decodeURIComponent(id));
      } catch {
        location.hash = "#/";
      }
    }
    window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", route);

  /* ---------- lists ---------- */
  // Callers share one in-flight load instead of starting a second one.
  let inflight = null;
  function refresh() {
    if (!state.user) return Promise.resolve();
    if (inflight) return inflight;
    const epoch = state.epoch;
    clearTimeout(state.timer);
    inflight = (async () => {
      try {
        const [t, f] = await Promise.allSettled([
          request("/tasks"),
          request("/listfiles"),
        ]);
        if (epoch !== state.epoch) return;
        if (t.status === "fulfilled")
          state.tasks = (t.value.tasks || []).sort(
            (a, b) => timeValue(b.created_at) - timeValue(a.created_at),
          );
        if (f.status === "fulfilled")
          state.files = (f.value.files || []).sort(
            (a, b) => timeValue(b.created_at) - timeValue(a.created_at),
          );
        state.listError = [t, f]
          .filter((x) => x.status === "rejected")
          .map((x) => x.reason.message)
          .join("；");
        state.loaded = true;
        render();
      } catch (e) {
        if (epoch === state.epoch && e.name !== "AbortError")
          toast(`列表刷新失败：${e.message}`);
      } finally {
        if (epoch === state.epoch) {
          inflight = null;
          schedule();
        }
      }
    })();
    return inflight;
  }
  async function refreshAfterChange() {
    const epoch = state.epoch;
    if (inflight) await inflight;
    if (epoch === state.epoch) await refresh();
  }
  // Poll fast only while something is moving; otherwise just keep the list fresh.
  function schedule() {
    clearTimeout(state.timer);
    if (!state.user || document.hidden) return;
    const busy =
      state.uploads.some((u) => !u.error) || state.tasks.some(isActive);
    state.timer = setTimeout(refresh, busy ? 3000 : 30000);
  }
  document.addEventListener("visibilitychange", () =>
    document.hidden ? clearTimeout(state.timer) : refresh(),
  );

  // Age alone cannot prove that a queued task has failed.
  const isActive = (t) => !["completed", "failed"].includes(t.status);
  function progressOf(t) {
    if (t.status === "completed") return { step: 3, sub: "done" };
    const step = String(t.stage || "").startsWith("transcribe") ? 2 : 1;
    if (t.status === "failed") return { step, sub: "failed" };
    return { step, sub: t.status === "processing" ? "running" : "queued" };
  }
  const engineOf = (stage) =>
    ({
      "transcribe-short": "ElevenLabs · 短音频",
      "transcribe-long": "本地 whisper · 长音频",
    })[stage] || "";
  function stepper(step, sub, pct) {
    return `<div class="steps" role="img" aria-label="进度：${STEPS[step]}${sub === "queued" ? "排队中" : sub === "failed" ? "失败" : sub === "done" ? "已完成" : "进行中"}">${STEPS.map(
      (n, i) => {
        let c = "";
        if (i < step) c = "done";
        else if (i === step)
          c =
            sub === "running"
              ? step === 0
                ? "running"
                : "running indet"
              : sub;
        const p = i === step && step === 0 ? ` style="--p:${pct}%"` : "";
        return `<div class="step ${c}"${p}><i></i><span>${n}</span></div>`;
      },
    ).join("")}</div>`;
  }
  function statusLine(step, sub, stage) {
    const name = STEPS[step];
    if (sub === "failed")
      return `<b style="color:var(--danger)">${name}失败</b>可以点右边重试`;
    const text =
      sub === "queued"
        ? `<b>${name} · 排队中</b>任务已进入处理队列`
        : `<b>${name} · 处理中</b>${step === 1 ? "正在准备可识别的音频" : "识别语音、按句子对齐时间"}`;
    const engine = engineOf(stage);
    return text + (engine ? ` <span class="engine">${engine}</span>` : "");
  }
  function filterBar(list, rows, typeOf) {
    const n = {
      all: rows.length,
      video: rows.filter((r) => typeOf(r) === "video").length,
      audio: rows.filter((r) => typeOf(r) === "audio").length,
    };
    return `<div class="filter" role="group" aria-label="按类型筛选">${[
      ["all", "全部"],
      ["video", "视频"],
      ["audio", "音频"],
    ]
      .map(
        ([k, l]) =>
          `<button data-filter="${list}:${k}" aria-pressed="${state.filters[list] === k}">${l}<span class="c">${n[k]}</span></button>`,
      )
      .join("")}</div>`;
  }
  const pick = (list, rows, typeOf) =>
    state.filters[list] === "all"
      ? rows
      : rows.filter((r) => typeOf(r) === state.filters[list]);

  function pageRows(list, rows) {
    const total = Math.max(1, Math.ceil(rows.length / 12));
    state.pages[list] = Math.min(total, state.pages[list]);
    const page = state.pages[list];
    $(`${list}-pages`).innerHTML =
      `<span>共 ${rows.length} 条</span><div><button data-page="${list}:-1" ${page === 1 ? "disabled" : ""} aria-label="上一页">←</button><span>${page} / ${total}</span><button data-page="${list}:1" ${page === total ? "disabled" : ""} aria-label="下一页">→</button></div>`;
    return rows.slice((page - 1) * 12, page * 12);
  }
  for (const list of ["tasks", "files"])
    $(`${list}-search`).oninput = (e) => {
      state.search[list] = e.target.value.trim().toLowerCase();
      state.pages[list] = 1;
      render();
    };
  $("task-status").onchange = (e) => {
    state.taskStatus = e.target.value;
    state.pages.tasks = 1;
    renderHome();
  };
  $("refresh").onclick = () => refresh();
  $("list-retry").onclick = () => refresh();

  function render() {
    $("list-error").hidden = !state.listError;
    $("list-error-text").textContent =
      `列表更新失败，已保留上次内容。${state.listError}`;
    $("sync-label").textContent = state.listError ? "更新中断" : "已同步";
    renderHome();
    renderFiles();
  }
  function renderHome() {
    const taskType = (t) =>
      isVideo(nameOf(t.input_file_id)) ? "video" : "audio";
    const uploadType = (u) => (isVideo(u.name) ? "video" : "audio");
    const busy = state.uploads.length + state.tasks.filter(isActive).length;
    $("count-tasks").textContent = state.tasks.length || "";
    const all = [
      ...state.uploads.map((u) => ({ u, type: uploadType(u) })),
      ...state.tasks.map((t) => ({ t, type: taskType(t) })),
    ];
    const matched = all.filter(
      (r) =>
        (state.filters.tasks === "all" || r.type === state.filters.tasks) &&
        (state.taskStatus === "all" ||
          (r.t
            ? state.taskStatus === "active"
              ? isActive(r.t)
              : r.t.status === state.taskStatus
            : state.taskStatus === "active")) &&
        `${r.u?.name || nameOf(r.t?.input_file_id)} ${r.t?.task_id || ""}`
          .toLowerCase()
          .includes(state.search.tasks),
    );
    const shown = pageRows("tasks", matched);
    $("stat-total").textContent = state.tasks.length;
    $("stat-complete").textContent = state.tasks.filter(
      (t) => t.status === "completed",
    ).length;
    $("stat-active").textContent = busy;
    const head = `<div class="list-head"><span>${busy ? `${busy} 条处理中` : "最新在前"}</span>${filterBar("tasks", all, (r) => r.type)}</div>`;
    if (!state.loaded && !state.uploads.length) {
      $("task-list").innerHTML = `${head}<div class="empty">正在加载…</div>`;
      return;
    }
    if (!shown.length) {
      $("task-list").innerHTML =
        `${head}<div class="empty">${all.length ? "没有这一类的转写" : "还没有转写。把第一段音频放进上面的框里吧。"}</div>`;
      return;
    }
    $("task-list").innerHTML =
      head +
      shown
        .map(({ u, t }) => {
          if (u) {
            const sub = u.error ? "failed" : "running";
            return `<div class="item">
              <div class="thumb">${escape(kindLabel(u.name))}</div>
              <div style="min-width:0"><div class="name">${escape(u.name)}</div>${stepper(0, sub, u.pct)}
                <div class="now">${u.error ? `<b style="color:var(--danger)">上传失败</b>${escape(u.error)}` : `<b>上传中</b>${bytes(u.file.size)} · 已传 ${u.pct}%`}</div></div>
              ${u.error ? `<button data-retry-upload="${u.key}">重试</button>` : `<span class="chip run">上传 ${u.pct}%</span>`}<span></span><span></span></div>`;
          }
          const name = nameOf(t.input_file_id);
          const { step, sub } = progressOf(t);
          const done = sub === "done";
          const chip = done
            ? '<span class="chip ok">已完成</span>'
            : sub === "failed"
              ? `<button data-retry-task="${escape(t.input_file_id)}">重试</button>`
              : `<span class="chip ${sub === "queued" ? "idle" : "run"}">${sub === "queued" ? "排队中" : "处理中"}</span>`;
          const size = bytes(fileOf(t.input_file_id)?.size);
          return `<div class="item${done ? " link" : ""}"${done ? ` data-read="${escape(t.task_id)}" tabindex="0" role="link"` : ""}>
            <div class="thumb">${escape(kindLabel(name))}</div>
            <div style="min-width:0"><div class="name">${escape(name)}</div>
              ${done ? `<div class="meta">${[size, shortDate(t.finished_at || t.created_at)].filter(Boolean).join(" · ")}</div>` : stepper(step, sub) + `<div class="now">${statusLine(step, sub, t.stage)}</div>`}
            </div>${chip}<span></span><span class="chev" aria-hidden="true">${done ? "›" : ""}</span></div>`;
        })
        .join("");
  }
  function renderFiles() {
    const sources = state.files.filter(isSource);
    const typeOf = (f) => (isVideo(f.file_name || "") ? "video" : "audio");
    $("count-files").textContent = sources.length || "";
    const hidden = state.files.length - sources.length;
    const shown = pageRows(
      "files",
      pick("files", sources, typeOf).filter((f) =>
        `${f.file_name} ${f.file_id}`
          .toLowerCase()
          .includes(state.search.files),
      ),
    );
    const head = `<div class="list-head"><span>${hidden ? `已隐藏 ${hidden} 个中间文件` : "原始文件"}</span>${filterBar("files", sources, typeOf)}</div>`;
    if (!shown.length) {
      $("file-list").innerHTML =
        `${head}<div class="empty">${sources.length ? "没有这一类的文件" : "还没有上传过文件。"}</div>`;
      return;
    }
    $("file-list").innerHTML =
      head +
      shown
        .map((f) => {
          const related = state.tasks.filter(
            (t) => t.input_file_id === f.file_id,
          );
          const done = related.find((t) => t.status === "completed");
          const running = related.some(isActive);
          const right = done
            ? '<span class="chip ok">已转写</span>'
            : running
              ? '<span class="chip run">处理中…</span>'
              : f.status !== "ready"
                ? '<span class="chip idle">上传未完成</span>'
                : `<button class="primary" data-transcribe="${escape(f.file_id)}">转写</button>`;
          return `<div class="item${done ? " link" : ""}"${done ? ` data-read="${escape(done.task_id)}" tabindex="0" role="link"` : ""}>
            <div class="thumb">${escape(kindLabel(f.file_name || ""))}</div>
            <div style="min-width:0"><div class="name">${escape(f.file_name || "未命名文件")}</div>
              <div class="meta">${[bytes(f.size), shortDate(f.created_at)].filter(Boolean).join(" · ")}</div></div>
            ${right}<button class="trash" data-delete="${escape(f.file_id)}" aria-label="删除 ${escape(f.file_name || "")}" title="删除">🗑</button>
            <span class="chev" aria-hidden="true">${done ? "›" : ""}</span></div>`;
        })
        .join("");
  }

  /* ---------- upload: dropping a file is the whole action ---------- */
  async function createTask(fileID, language = $("language").value) {
    const task = await request("/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input_file_id: fileID,
        type: "transcribe",
        language,
      }),
    });
    if (!task.task_id) throw new Error("创建任务的响应缺少任务 ID。");
    return task.task_id;
  }
  async function runUpload(u) {
    if (u.running) return;
    u.running = true;
    const epoch = state.epoch;
    u.error = "";
    renderHome();
    try {
      if (!u.fileID) {
        const up = await request("/upload", {
          method: "POST",
          body: new URLSearchParams({ filename: u.name }),
        });
        if (!up.file_id) throw new Error("上传响应缺少文件 ID。");
        await putFile(up.upload_url, u.file, (p) => {
          const pct = Math.round(p * 100);
          if (pct !== u.pct) {
            u.pct = pct;
            renderHome();
          }
        });
        await request(`/files/${idPath(up.file_id)}/complete`, {
          method: "POST",
        });
        // From here a retry must not upload the file again.
        u.fileID = up.file_id;
      }
      await createTask(u.fileID, u.language);
      state.uploads = state.uploads.filter((x) => x !== u);
      await refreshAfterChange();
    } catch (e) {
      if (epoch !== state.epoch || e.name === "AbortError") return;
      u.error = e.message;
      renderHome();
    } finally {
      u.running = false;
    }
  }
  // Deletes one upload with everything it produced: transcripts, the WAV, and the file itself.
  async function deleteFile(fileID) {
    const name = nameOf(fileID);
    if (!confirm(`删除「${name}」？\n\n它的转写结果也会一起删除，无法恢复。`))
      return false;
    try {
      await request(`/files/${idPath(fileID)}`, { method: "DELETE" });
      state.tasks = state.tasks.filter((t) => t.input_file_id !== fileID);
      state.files = state.files.filter((f) => f.file_id !== fileID);
      render();
      toast(`已删除「${name}」`);
      refreshAfterChange();
      return true;
    } catch (e) {
      if (e.name !== "AbortError") toast(e.message);
      return false;
    }
  }
  function startUpload(file) {
    if (!file || !state.user) return;
    if (!file.size)
      return msg("upload-msg", "文件为空，请选择包含声音的文件。", true);
    const u = {
      key: `${Date.now()}-${Math.random()}`,
      name: file.name,
      file,
      pct: 0,
      error: "",
      fileID: "",
      language: $("language").value,
    };
    msg("upload-msg", "文件已加入转写队列。");
    state.uploads.unshift(u);
    if (location.hash.split("/")[1]) location.hash = "#/";
    runUpload(u);
  }
  $("pick").onclick = () => $("file-input").click();
  $("file-input").onchange = (e) => {
    startUpload(e.target.files[0]);
    e.target.value = "";
  };
  for (const name of ["dragover", "dragleave", "drop"])
    $("drop").addEventListener(name, (e) => {
      e.preventDefault();
      $("drop").classList.toggle("over", name === "dragover");
      if (name === "drop") startUpload(e.dataTransfer.files[0]);
    });

  /* ---------- recording ---------- */
  const RECORD_LIMIT = 30 * 60;
  function releaseMic() {
    const r = state.rec;
    clearInterval(r.timer);
    r.timer = null;
    r.stream?.getTracks().forEach((track) => track.stop());
    r.stream = null;
    r.context?.close().catch(() => {});
    r.context = null;
  }
  function showRecording() {
    const phase = state.rec.phase;
    $("rec").hidden = !["requesting", "recording", "processing"].includes(
      phase,
    );
    $("rec-start").hidden = phase !== "idle";
    $("rec-draft").hidden = phase !== "ready";
    $("rec-stop").disabled = phase !== "recording";
    $("rec-label").textContent =
      {
        requesting: "等待麦克风授权",
        recording: "正在录音",
        processing: "正在准备试听",
      }[phase] || "";
  }
  function clearDraft() {
    const r = state.rec;
    $("rec-preview").pause();
    $("rec-preview").removeAttribute("src");
    $("rec-preview").load();
    if (r.url) URL.revokeObjectURL(r.url);
    r.url = "";
    r.file = null;
  }
  function stopRecording(discard = false) {
    const r = state.rec;
    if (discard) ++r.version;
    if (r.recorder && r.recorder.state !== "inactive") {
      r.phase = "processing";
      r.recorder.stop();
    }
    releaseMic();
    if (discard) {
      r.recorder = null;
      r.phase = "idle";
      clearDraft();
    }
    showRecording();
  }
  async function startRecording() {
    const r = state.rec;
    if (r.phase !== "idle") return;
    if (
      !window.isSecureContext ||
      !navigator.mediaDevices?.getUserMedia ||
      !window.MediaRecorder
    ) {
      msg(
        "upload-msg",
        "录音需要 HTTPS 或 localhost，以及支持麦克风的浏览器。",
        true,
      );
      return;
    }
    const version = ++r.version;
    r.phase = "requesting";
    $("rec-time").textContent = "0:00";
    $("rec-meter").value = 0;
    showRecording();
    msg("upload-msg", "请允许浏览器使用麦克风。");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (version !== r.version) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      r.stream = stream;
      const mime = [
        "audio/webm;codecs=opus",
        "audio/mp4",
        "audio/ogg;codecs=opus",
        "audio/webm",
      ].find((t) => MediaRecorder.isTypeSupported(t));
      const recorder = new MediaRecorder(
        stream,
        mime ? { mimeType: mime } : {},
      );
      r.recorder = recorder;
      const chunks = [];
      recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      recorder.onerror = () => {
        msg("upload-msg", "录音设备中断，正在保存已录制的内容。", true);
        stopRecording(false);
      };
      recorder.onstop = async () => {
        if (version !== r.version) return;
        releaseMic();
        r.recorder = null;
        r.phase = "processing";
        showRecording();
        const type = recorder.mimeType || chunks[0]?.type || "audio/webm";
        let blob = new Blob(chunks, { type });
        let ext = type.includes("mp4")
          ? "m4a"
          : type.includes("ogg")
            ? "ogg"
            : "webm";
        let notice = "录音已保存到本页。试听确认后，再开始转写。";
        if (!blob.size) {
          r.phase = "idle";
          showRecording();
          msg("upload-msg", "没有录到声音，请再试一次。", true);
          return;
        }
        try {
          const result = await VoxMedia.toWav(blob);
          blob = result.blob;
          ext = "wav";
          if (result.peak < 0.005)
            notice = "这段录音的音量很低，请先试听，或检查麦克风后重新录制。";
        } catch {
          notice =
            "已保留原始录音，请先试听；若跳转异常，转写后可使用兼容播放。";
        }
        if (version !== r.version) return;
        r.file = new File(
          [blob],
          `recording-${new Date().toISOString().replace(/[:.]/g, "-")}.${ext}`,
          { type: blob.type },
        );
        r.url = URL.createObjectURL(blob);
        $("rec-preview").src = r.url;
        r.phase = "ready";
        showRecording();
        msg("upload-msg", notice);
      };
      recorder.start(1000);
      r.phase = "recording";
      showRecording();
      msg("upload-msg", "录音仅保存在当前页面，停止后可以试听。最长 30 分钟。");
      stream.getAudioTracks().forEach((track) =>
        track.addEventListener("ended", () => {
          if (version === r.version && r.phase === "recording")
            stopRecording(false);
        }),
      );
      let analyser, samples;
      try {
        r.context = new AudioContext();
        r.context.resume().catch(() => {});
        analyser = r.context.createAnalyser();
        analyser.fftSize = 256;
        r.context.createMediaStreamSource(stream).connect(analyser);
        samples = new Uint8Array(analyser.fftSize);
      } catch {
        /* Recording works even if metering is unavailable. */
      }
      const started = performance.now();
      const tick = () => {
        const sec = (performance.now() - started) / 1000;
        $("rec-time").textContent = clock(sec);
        if (analyser) {
          analyser.getByteTimeDomainData(samples);
          const level = Math.min(
            100,
            Math.sqrt(
              samples.reduce((sum, n) => sum + ((n - 128) / 128) ** 2, 0) /
                samples.length,
            ) * 400,
          );
          $("rec-meter").value = level;
        }
        if (sec >= RECORD_LIMIT) stopRecording(false);
      };
      tick();
      r.timer = setInterval(tick, 100);
    } catch (e) {
      if (version !== r.version) return;
      releaseMic();
      r.recorder = null;
      r.phase = "idle";
      showRecording();
      const reasons = {
        NotAllowedError: "麦克风权限被拒绝，请在浏览器的站点设置里允许后重试。",
        NotFoundError: "没有找到麦克风。",
        NotReadableError: "麦克风被其他应用占用。",
      };
      msg("upload-msg", reasons[e.name] || `无法开始录音：${e.message}`, true);
    }
  }
  $("rec-start").onclick = startRecording;
  $("rec-stop").onclick = () => stopRecording(false);
  $("rec-cancel").onclick = () => {
    stopRecording(true);
    msg("upload-msg", "已放弃这段录音。");
  };
  $("rec-redo").onclick = () => {
    stopRecording(true);
    startRecording();
  };
  $("rec-clear").onclick = () => {
    stopRecording(true);
    msg("upload-msg", "已删除本地录音。");
  };
  $("rec-submit").onclick = () => {
    if (state.rec.phase !== "ready" || !state.rec.file) return;
    const file = state.rec.file;
    stopRecording(true);
    msg("upload-msg", "录音已加入转写队列。");
    startUpload(file);
  };
  window.addEventListener("pagehide", () => {
    stopRecording(true);
    leaveReader();
  });
  window.addEventListener("pageshow", (e) => {
    if (e.persisted) route();
  });
  window.addEventListener("beforeunload", (e) => {
    if (
      ["recording", "processing", "ready"].includes(state.rec.phase) ||
      state.uploads.length
    ) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  /* ---------- reader ---------- */
  function leaveReader() {
    const r = state.reader;
    state.readVersion++;
    if (!r) return;
    r.media?.destroy();
    r.controller?.abort();
    clearTimeout(r.followTimer);
    $("menu").hidden = true;
    state.reader = null;
  }
  const vocabKey = (w) => w.toLowerCase().replace(/’/g, "'");
  function highlight(line) {
    const vocab = state.reader?.vocab;
    if (!vocab?.size) return escape(line);
    let html = "",
      last = 0;
    for (const m of line.matchAll(WORD)) {
      const tr = vocab.get(vocabKey(m[0]));
      if (tr === undefined) continue;
      html += `${escape(line.slice(last, m.index))}<mark class="vocab-mark" title="${escape(tr)}">${escape(m[0])}</mark>`;
      last = m.index + m[0].length;
    }
    return html + escape(line.slice(last));
  }
  function renderTranscript() {
    const r = state.reader;
    if (!r.segments.length) {
      $("tscript").innerHTML =
        `<div class="plain">${highlight(r.text) || "结果为空。"}</div>`;
      return;
    }
    $("tscript").innerHTML = r.segments
      .map(
        (s, i) =>
          `<button type="button" class="seg" data-i="${i}"><time>${clock(s.start)}</time><span>${highlight(s.text)}</span></button>`,
      )
      .join("");
  }
  function renderCaption(index, force = false) {
    const r = state.reader;
    if (!r?.caption || (index === r.current && !force)) return;
    r.current = index;
    document
      .querySelectorAll("#tscript .seg")
      .forEach((el) =>
        el.classList.toggle("on", Number(el.dataset.i) === index),
      );
    const line = index === null ? "" : r.segments[index].text.trim();
    const words = [
      ...new Set(
        [...line.matchAll(WORD)]
          .map((m) => vocabKey(m[0]))
          .filter((w) => r.vocab.has(w)),
      ),
    ];
    document
      .querySelectorAll("#words-list li")
      .forEach((li) =>
        li.classList.toggle("here", words.includes(li.dataset.w)),
      );
    r.caption.hidden = !line;
    r.caption.innerHTML = line ? `<p>${highlight(line)}</p>` : "";
    r.captionWords.hidden = words.length === 0;
    r.captionWords.innerHTML = words.length
      ? `<span class="caption-words-label">当前句生词</span><ul>${words.map((w) => `<li><b>${escape(w)}</b><span>${escape(r.vocab.get(w))}</span></li>`).join("")}</ul>`
      : "";
    if (index !== null && r.following) {
      const el = document.querySelector(`#tscript .seg[data-i="${index}"]`);
      const box = $("tscript");
      if (el)
        box.scrollTo({
          top:
            box.scrollTop +
            el.getBoundingClientRect().top -
            box.getBoundingClientRect().top -
            box.clientHeight / 2 +
            el.offsetHeight / 2,
        });
    }
  }
  // Scrolling the transcript pauses following; it resumes after 5 idle seconds.
  function pauseFollow() {
    const r = state.reader;
    if (!r?.segments.length) return;
    r.following = false;
    $("backnow").hidden = false;
    clearTimeout(r.followTimer);
    r.followTimer = setTimeout(resumeFollow, 5000);
  }
  function resumeFollow() {
    const r = state.reader;
    if (!r) return;
    r.following = true;
    $("backnow").hidden = true;
    renderCaption(r.current, true);
  }
  for (const ev of ["wheel", "touchmove", "pointerdown"])
    $("tscript").addEventListener(ev, pauseFollow, { passive: true });
  $("backnow").onclick = resumeFollow;

  async function openReader(id) {
    const version = state.readVersion;
    $("read-title").textContent = "正在打开…";
    $("read-meta").textContent = "正在读取任务";
    $("segment-count").textContent = "";
    $("more").disabled = true;
    $("track-switch").hidden = true;
    $("stage-slot").replaceChildren();
    $("tscript").innerHTML = '<div class="empty">正在读取转写结果…</div>';
    $("words-list").innerHTML = "";
    $("words-count").textContent = "";
    $("backnow").hidden = true;
    try {
      if (!state.loaded) await refresh();
      if (version !== state.readVersion) return;
      const { task } = await request(`/tasks/${idPath(id)}`);
      if (version !== state.readVersion) return;
      if (!task) throw new Error("没有找到这个转写。");
      const r = {
        task,
        text: "",
        segments: [],
        vocab: new Map(),
        player: null,
        caption: null,
        current: null,
        following: true,
        followTimer: null,
        controller: new AbortController(),
      };
      state.reader = r;
      $("read-title").textContent = nameOf(task.input_file_id);
      $("read-meta").textContent = [
        bytes(fileOf(task.input_file_id)?.size),
        shortDate(task.created_at),
        "点击字幕定位声音",
      ]
        .filter(Boolean)
        .join(" · ");
      $("more").disabled = false;
      // The existing task service names its normalized WAV result-<task ID>.
      // Resolve an actual file ID from the authorized list; never construct storage URLs.
      r.audioFile = state.files.find(
        (f) =>
          f.file_name === `result-${task.task_id}` &&
          f.file_id !== task.output_file_id &&
          f.status === "ready",
      );
      $("track-switch").hidden = !r.audioFile;
      $("media-source").value =
        r.audioFile &&
        /^recording-.*\.(webm|ogg|m4a)$/i.test(nameOf(task.input_file_id))
          ? "processed"
          : "original";
      loadMedia(version);
      if (task.status !== "completed" || !task.output_file_id) {
        $("tscript").innerHTML =
          '<div class="empty">这个任务还没有完成，完成后就能在这里阅读。</div>';
        return;
      }
      const data = await request(`/download/${idPath(task.output_file_id)}`);
      const raw = await storageText(data.download_url, r.controller.signal);
      if (version !== state.readVersion) return;
      r.text = raw;
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed.text === "string") {
          r.text = parsed.text;
          const segs = (Array.isArray(parsed.segments) ? parsed.segments : [])
            .filter(
              (s) =>
                s &&
                Number.isFinite(Number(s.start_ms)) &&
                Number(s.start_ms) >= 0 &&
                typeof s.text === "string",
            )
            .sort((a, b) => Number(a.start_ms) - Number(b.start_ms));
          r.segments = segs.map((s, i) => {
            const start = Number(s.start_ms) / 1000;
            const end = Number(s.end_ms) / 1000;
            const next = Number(segs[i + 1]?.start_ms) / 1000;
            return {
              start,
              end: end > start ? end : next > start ? next : Infinity,
              text: s.text,
            };
          });
        }
      } catch {
        /* plain-text results are shown as they are */
      }
      renderTranscript();
      $("segment-count").textContent = `${r.segments.length} 段`;
      loadVocab(version);
    } catch (e) {
      if (version === state.readVersion && e.name !== "AbortError")
        $("tscript").innerHTML =
          `<div class="empty">无法读取结果：${escape(e.message)}<br><button data-reader-retry>重新读取</button></div>`;
    }
  }
  async function loadVocab(version) {
    const r = state.reader;
    $("words-count").textContent = "提取中…";
    try {
      // Same origin as the page; nginx forwards /vocab/ to the vocabulary service.
      const res = await fetch("/vocab/v1/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: r.text }),
        signal: AbortSignal.any([
          r.controller.signal,
          AbortSignal.timeout(30000),
        ]),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const words = Array.isArray(data.words) ? data.words : [];
      if (version !== state.readVersion) return;
      for (const w of words) r.vocab.set(vocabKey(w.word), w.translation);
      $("words-count").textContent = `${words.length} 个`;
      $("words-list").innerHTML = words.length
        ? words
            .map(
              (w) =>
                `<li data-w="${escape(vocabKey(w.word))}"><span class="w">${escape(w.word)}</span><span class="n">×${w.count}</span><span class="t">${escape(w.translation)}</span></li>`,
            )
            .join("")
        : '<li class="t">没有找到生词。</li>';
      renderTranscript();
      renderCaption(r.current, true);
    } catch (e) {
      if (version === state.readVersion)
        $("words-count").textContent = `提取失败：${e.message}`;
    }
  }
  function loadMedia(version) {
    const r = state.reader;
    const name = nameOf(r.task.input_file_id);
    const processed = $("media-source").value === "processed" && r.audioFile;
    r.media?.destroy();
    r.media = VoxMedia.mount({
      slot: $("stage-slot"),
      video: !processed && isVideo(name),
      sourceLabel: processed ? "转写音轨" : "原始媒体",
      legacyRecording:
        !processed && /^recording-.*\.(webm|ogg|m4a)$/i.test(name),
      getURL: async () => {
        const data = await request(
          `/download/${idPath(processed ? r.audioFile.file_id : r.task.input_file_id)}`,
        );
        return safeURL(data.download_url);
      },
      onUnsupported:
        !processed && r.audioFile
          ? ({ position, resume }) => {
              if (version !== state.readVersion) return;
              $("media-source").value = "processed";
              loadMedia(version);
              if (resume) r.media.seek(position);
              toast("原始媒体无法解码，已切换到转写音轨。");
            }
          : null,
      onTime: (time, ended) => {
        if (version !== state.readVersion) return;
        const i = ended
          ? -1
          : r.segments.findIndex((s) => time >= s.start && time < s.end);
        renderCaption(i < 0 ? null : i);
      },
    });
    r.player = r.media.player;
    r.caption = r.media.caption;
    r.captionWords = r.media.captionWords;
  }
  $("media-source").onchange = () => {
    if (!state.reader) return;
    const position = state.reader.player?.currentTime || 0;
    const resume = state.reader.player && !state.reader.player.paused;
    loadMedia(state.readVersion);
    if (resume) state.reader.media.seek(position);
  };
  $("tscript").addEventListener("click", (e) => {
    const seg = e.target.closest(".seg");
    const r = state.reader;
    if (!seg || !r?.media) return;
    const target = r.segments[seg.dataset.i]?.start;
    r.following = true;
    $("backnow").hidden = true;
    r.media.seek(target);
  });

  /* ---------- ⋯ menu: exports are built on demand, nothing is stored ---------- */
  const srtTime = (s) => {
    const ms = Math.round(s * 1000);
    const p = (n, w = 2) => String(n).padStart(w, "0");
    return `${p(Math.floor(ms / 3600000))}:${p(Math.floor((ms % 3600000) / 60000))}:${p(Math.floor((ms % 60000) / 1000))},${p(ms % 1000, 3)}`;
  };
  const baseName = () =>
    nameOf(state.reader.task.input_file_id).replace(/\.[^.]+$/, "");
  $("more").onclick = (e) => {
    e.stopPropagation();
    $("menu").hidden = !$("menu").hidden;
    $("more").setAttribute("aria-expanded", String(!$("menu").hidden));
  };
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".menu")) {
      $("menu").hidden = true;
      $("more").setAttribute("aria-expanded", "false");
    }
  });
  $("menu").addEventListener("click", async (e) => {
    const action = e.target.closest("[data-menu]")?.dataset.menu;
    const r = state.reader;
    if (!action || !r) return;
    $("menu").hidden = true;
    try {
      if (action === "srt") {
        if (!r.segments.length)
          return toast("这份结果没有时间戳，无法生成字幕。");
        const end = (s) => (Number.isFinite(s.end) ? s.end : s.start + 3);
        saveBlob(
          `${baseName()}.srt`,
          r.segments
            .map(
              (s, i) =>
                `${i + 1}\n${srtTime(s.start)} --> ${srtTime(end(s))}\n${s.text.trim()}\n`,
            )
            .join("\n"),
        );
      }
      if (action === "txt") saveBlob(`${baseName()}.txt`, r.text);
      if (action === "copy") {
        await navigator.clipboard.writeText(r.text);
        toast("已复制全文");
      }
      if (action === "source") {
        const media = await request(
          `/download/${idPath(r.task.input_file_id)}`,
        );
        window.open(safeURL(media.download_url), "_blank", "noopener");
      }
      if (action === "tech") {
        $("tech-body").textContent = JSON.stringify(r.task, null, 2);
        $("tech").showModal();
      }
      if (action === "delete" && (await deleteFile(r.task.input_file_id)))
        location.hash = "#/";
    } catch (err) {
      if (err.name !== "AbortError") toast(err.message);
    }
  });
  $("tech-close").onclick = () => $("tech").close();

  /* ---------- list actions ---------- */
  document.addEventListener("click", async (e) => {
    const t = e.target;
    if (t.closest("[data-reader-retry]")) {
      route();
      return;
    }
    const pager = t.closest("[data-page]");
    if (pager) {
      const [list, diff] = pager.dataset.page.split(":");
      state.pages[list] += Number(diff);
      render();
      return;
    }
    const filter = t.closest("[data-filter]");
    if (filter) {
      const [list, k] = filter.dataset.filter.split(":");
      state.filters[list] = k;
      state.pages[list] = 1;
      render();
      return;
    }
    const retryUpload = t.closest("[data-retry-upload]");
    if (retryUpload) {
      const u = state.uploads.find(
        (x) => x.key === retryUpload.dataset.retryUpload,
      );
      if (u) runUpload(u);
      return;
    }
    const again = t.closest("[data-retry-task], [data-transcribe]");
    if (again) {
      again.disabled = true;
      try {
        await createTask(again.dataset.retryTask || again.dataset.transcribe);
        toast("已开始转写");
        await refreshAfterChange();
        if (location.hash.startsWith("#/files")) location.hash = "#/";
      } catch (err) {
        if (err.name !== "AbortError") toast(err.message);
        again.disabled = false;
      }
      return;
    }
    const del = t.closest("[data-delete]");
    if (del) {
      e.stopPropagation(); // the row underneath opens the reader
      del.disabled = true;
      await deleteFile(del.dataset.delete);
      del.disabled = false;
      return;
    }
    const read = t.closest("[data-read]");
    if (read) location.hash = `#/read/${encodeURIComponent(read.dataset.read)}`;
  });
  document.addEventListener("keydown", (e) => {
    const read = e.target.closest?.("[data-read]");
    if (read && e.target === read && e.key === "Enter")
      location.hash = `#/read/${encodeURIComponent(read.dataset.read)}`;
  });

  // Another tab signed in or out: follow it, never clear its token.
  window.addEventListener("storage", (e) => {
    if (e.key !== "vox_token" || e.newValue === state.token) return;
    if (!e.newValue) {
      logout();
      msg("auth-msg", "已在其他页面退出登录。");
      return;
    }
    logout(false);
    state.token = e.newValue;
    verify();
  });

  setMode("login");
  verify();
})();
