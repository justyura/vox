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
    timer: null,
    controllers: new Set(),
    xhrs: new Set(),
    rec: { phase: "idle", version: 0, recorder: null, stream: null, timer: null },
    reader: null,
    readVersion: 0,
  };

  /* ---------- helpers ---------- */
  const escape = (v) =>
    String(v ?? "").replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
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
  const isSource = (f) => !String(f.file_name || "").startsWith("result-");

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
      const res = await fetch(API + path, { ...options, headers, signal: controller.signal });
      const raw = await res.text();
      if (epoch !== state.epoch) throw stale();
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        throw new Error(`接口没有返回有效数据（HTTP ${res.status}）。`);
      }
      if (res.status === 401 && authenticated) {
        logout();
        msg("auth-msg", "登录已过期，请重新登录。", true);
        throw stale();
      }
      if (!res.ok) throw new Error(`${data.error || "请求失败"}（HTTP ${res.status}）`);
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
    if (!["https:", "http:"].includes(url.protocol)) throw new Error("文件地址无效。");
    return url.href;
  }
  // Object storage must never receive the API bearer token.
  async function storageText(url) {
    const epoch = state.epoch;
    const res = await fetch(safeURL(url));
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
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
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
    $("auth-form").elements.password.autocomplete = login ? "current-password" : "new-password";
    msg("auth-msg", "");
  }
  function signedIn(user) {
    state.user = user;
    $("account").textContent = user.email;
    $("auth").hidden = true;
    $("app").hidden = false;
    route();
    refresh();
  }
  function logout() {
    stopRecording(true);
    leaveReader();
    state.epoch++;
    for (const c of state.controllers) c.abort();
    for (const x of state.xhrs) x.abort();
    clearTimeout(state.timer);
    Object.assign(state, { token: "", user: null, tasks: [], files: [], loaded: false, uploads: [] });
    store.set("vox_token", "");
    $("auth-form").reset();
    $("app").hidden = true;
    $("auth").hidden = false;
  }
  async function verify() {
    if (!state.token) {
      $("auth").hidden = false;
      return;
    }
    try {
      signedIn(await request("/whoami"));
    } catch (e) {
      $("auth").hidden = false;
      if (e.name !== "AbortError") msg("auth-msg", `连接失败：${e.message}`, true);
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
  $("auth-switch").onclick = () => setMode(state.mode === "login" ? "signup" : "login");
  $("logout").onclick = logout;

  /* ---------- routing ---------- */
  function route() {
    if (!state.user) return;
    const [, view = "", id = ""] = location.hash.split("/");
    const name = ["files", "about", "faq", "read"].includes(view) ? view : "home";
    leaveReader();
    for (const v of ["home", "files", "about", "faq", "read"]) $(`view-${v}`).hidden = v !== name;
    const nav = name === "read" ? "home" : name;
    document.querySelectorAll("[data-nav]").forEach((a) => {
      if (a.dataset.nav === nav) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    if (name === "read") openReader(decodeURIComponent(id));
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
        const [t, f] = await Promise.all([request("/tasks"), request("/listfiles")]);
        if (epoch !== state.epoch) return;
        state.tasks = (t.tasks || []).sort((a, b) => timeValue(b.created_at) - timeValue(a.created_at));
        state.files = (f.files || []).sort((a, b) => timeValue(b.created_at) - timeValue(a.created_at));
        state.loaded = true;
        render();
      } catch (e) {
        if (epoch === state.epoch && e.name !== "AbortError") toast(`列表刷新失败：${e.message}`);
      } finally {
        inflight = null;
        if (epoch === state.epoch) schedule();
      }
    })();
    return inflight;
  }
  // Poll fast only while something is moving; otherwise just keep the list fresh.
  function schedule() {
    clearTimeout(state.timer);
    if (!state.user || document.hidden) return;
    const busy = state.uploads.length || state.tasks.some(isActive);
    state.timer = setTimeout(refresh, busy ? 3000 : 30000);
  }
  document.addEventListener("visibilitychange", () => (document.hidden ? clearTimeout(state.timer) : refresh()));

  // A task still unfinished after this long will not finish on its own (lost message, old data).
  const STALLED_MS = 6 * 3600 * 1000;
  const isActive = (t) =>
    !["completed", "failed"].includes(t.status) && Date.now() - timeValue(t.created_at) < STALLED_MS;
  function progressOf(t) {
    if (t.status === "completed") return { step: 3, sub: "done" };
    const step = String(t.stage || "").startsWith("transcribe") ? 2 : 1;
    if (t.status === "failed" || !isActive(t)) return { step, sub: "failed" };
    return { step, sub: t.status === "processing" ? "running" : "queued" };
  }
  const engineOf = (stage) =>
    ({ "transcribe-short": "ElevenLabs · 短音频", "transcribe-long": "本地 whisper · 长音频" })[stage] || "";
  function stepper(step, sub, pct) {
    return `<div class="steps" role="img" aria-label="进度：${STEPS[step]}${sub === "queued" ? "排队中" : sub === "failed" ? "失败" : "进行中"}">${STEPS.map((n, i) => {
      let c = "";
      if (i < step) c = "done";
      else if (i === step) c = sub === "running" ? (step === 0 ? "running" : "running indet") : sub;
      const p = i === step && step === 0 ? ` style="--p:${pct}%"` : "";
      return `<div class="step ${c}"${p}><i></i><span>${n}</span></div>`;
    }).join("")}</div>`;
  }
  function statusLine(step, sub, stage) {
    const name = STEPS[step];
    if (sub === "failed") return `<b style="color:var(--danger)">${name}失败</b>可以点右边重试`;
    const text =
      sub === "queued"
        ? `<b>${name} · 排队中</b>等待空闲的${step === 1 ? "转码" : "转写"} worker`
        : `<b>${name} · 处理中</b>${step === 1 ? "提取音轨、统一成 16kHz" : "识别语音、按句子对齐时间"}`;
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
    state.filters[list] === "all" ? rows : rows.filter((r) => typeOf(r) === state.filters[list]);

  function render() {
    renderHome();
    renderFiles();
  }
  function renderHome() {
    const taskType = (t) => (isVideo(nameOf(t.input_file_id)) ? "video" : "audio");
    const uploadType = (u) => (isVideo(u.name) ? "video" : "audio");
    const busy =
      state.uploads.length + state.tasks.filter(isActive).length;
    $("count-tasks").textContent = state.tasks.length || "";
    const all = [...state.uploads.map((u) => ({ u, type: uploadType(u) })), ...state.tasks.map((t) => ({ t, type: taskType(t) }))];
    const shown = state.filters.tasks === "all" ? all : all.filter((r) => r.type === state.filters.tasks);
    const head = `<div class="list-head"><span>${busy ? `${busy} 条处理中` : "最新在前"}</span>${filterBar("tasks", all, (r) => r.type)}</div>`;
    if (!state.loaded && !state.uploads.length) {
      $("task-list").innerHTML = `${head}<div class="empty">正在加载…</div>`;
      return;
    }
    if (!shown.length) {
      $("task-list").innerHTML = `${head}<div class="empty">${all.length ? "没有这一类的转写" : "还没有转写。把第一段音频放进上面的框里吧。"}</div>`;
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
              ${u.error ? `<button data-retry-upload="${u.key}">重试</button>` : `<span class="chip run">上传 ${u.pct}%</span>`}<span></span></div>`;
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
            </div>${chip}<span class="chev" aria-hidden="true">${done ? "›" : ""}</span></div>`;
        })
        .join("");
  }
  function renderFiles() {
    const sources = state.files.filter(isSource);
    const typeOf = (f) => (isVideo(f.file_name || "") ? "video" : "audio");
    $("count-files").textContent = sources.length || "";
    const hidden = state.files.length - sources.length;
    const shown = pick("files", sources, typeOf);
    const head = `<div class="list-head"><span>${hidden ? `已隐藏 ${hidden} 个中间文件` : "原始文件"}</span>${filterBar("files", sources, typeOf)}</div>`;
    if (!shown.length) {
      $("file-list").innerHTML = `${head}<div class="empty">${sources.length ? "没有这一类的文件" : "还没有上传过文件。"}</div>`;
      return;
    }
    $("file-list").innerHTML =
      head +
      shown
        .map((f) => {
          const related = state.tasks.filter((t) => t.input_file_id === f.file_id);
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
            ${right}<span class="chev" aria-hidden="true">${done ? "›" : ""}</span></div>`;
        })
        .join("");
  }

  /* ---------- upload: dropping a file is the whole action ---------- */
  async function createTask(fileID) {
    const task = await request("/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input_file_id: fileID, type: "transcribe", language: $("language").value }),
    });
    if (!task.task_id) throw new Error("创建任务的响应缺少任务 ID。");
    return task.task_id;
  }
  async function runUpload(u) {
    const epoch = state.epoch;
    u.error = "";
    renderHome();
    try {
      if (!u.fileID) {
        const up = await request("/upload", { method: "POST", body: new URLSearchParams({ filename: u.name }) });
        if (!up.file_id) throw new Error("上传响应缺少文件 ID。");
        await putFile(up.upload_url, u.file, (p) => {
          const pct = Math.round(p * 100);
          if (pct !== u.pct) {
            u.pct = pct;
            renderHome();
          }
        });
        await request(`/files/${idPath(up.file_id)}/complete`, { method: "POST" });
        // From here a retry must not upload the file again.
        u.fileID = up.file_id;
      }
      await createTask(u.fileID);
      state.uploads = state.uploads.filter((x) => x !== u);
      await refresh();
    } catch (e) {
      if (epoch !== state.epoch || e.name === "AbortError") return;
      u.error = e.message;
      renderHome();
    }
  }
  function startUpload(file) {
    if (!file || !state.user) return;
    const u = { key: `${Date.now()}-${Math.random()}`, name: file.name, file, pct: 0, error: "", fileID: "" };
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
  function releaseMic() {
    const r = state.rec;
    clearInterval(r.timer);
    r.timer = null;
    r.stream?.getTracks().forEach((track) => track.stop());
    r.stream = null;
  }
  function showRecording(on) {
    $("rec").hidden = !on;
    $("pick-row").hidden = on;
  }
  // discard=true throws the audio away; otherwise the recording is uploaded.
  function stopRecording(discard = false) {
    const r = state.rec;
    if (discard) r.version++;
    if (r.recorder && r.recorder.state !== "inactive") r.recorder.stop();
    releaseMic();
    if (discard) {
      r.recorder = null;
      r.phase = "idle";
      showRecording(false);
    }
  }
  async function startRecording() {
    const r = state.rec;
    if (r.phase !== "idle") return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      msg("upload-msg", "当前环境无法录音：需要支持录音的浏览器，并通过 HTTPS 或 localhost 打开。", true);
      return;
    }
    const version = ++r.version;
    r.phase = "requesting";
    msg("upload-msg", "请允许浏览器使用麦克风。");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (version !== r.version) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      r.stream = stream;
      const mime = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus", "audio/webm"].find((t) =>
        MediaRecorder.isTypeSupported(t),
      );
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
      r.recorder = recorder;
      const chunks = [];
      recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      recorder.onstop = () => {
        if (version !== r.version) return;
        r.recorder = null;
        r.phase = "idle";
        showRecording(false);
        const type = recorder.mimeType || chunks[0]?.type || "audio/webm";
        const blob = new Blob(chunks, { type });
        if (!blob.size) return msg("upload-msg", "没有录到声音，请重试。", true);
        const ext = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
        msg("upload-msg", "");
        startUpload(new File([blob], `recording-${new Date().toISOString().replace(/[:.]/g, "-")}.${ext}`, { type }));
      };
      recorder.start(1000);
      r.phase = "recording";
      showRecording(true);
      msg("upload-msg", "录音中。点“停止并转写”后会自动上传。");
      const start = performance.now();
      const tick = () => {
        const s = Math.floor((performance.now() - start) / 1000);
        $("rec-time").textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
      };
      tick();
      r.timer = setInterval(tick, 250);
    } catch (e) {
      if (version !== r.version) return;
      releaseMic();
      r.phase = "idle";
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
  window.addEventListener("pagehide", () => stopRecording(true));

  /* ---------- reader ---------- */
  function leaveReader() {
    const r = state.reader;
    state.readVersion++;
    if (!r) return;
    r.player?.pause();
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
      $("tscript").innerHTML = `<div class="plain">${highlight(r.text) || "结果为空。"}</div>`;
      return;
    }
    $("tscript").innerHTML = r.segments
      .map((s, i) => `<button type="button" class="seg" data-i="${i}"><time>${clock(s.start)}</time><span>${highlight(s.text)}</span></button>`)
      .join("");
  }
  function renderCaption(index, force = false) {
    const r = state.reader;
    if (!r?.caption || (index === r.current && !force)) return;
    r.current = index;
    document.querySelectorAll("#tscript .seg").forEach((el) => el.classList.toggle("on", Number(el.dataset.i) === index));
    const line = index === null ? "" : r.segments[index].text.trim();
    const words = [...new Set([...line.matchAll(WORD)].map((m) => vocabKey(m[0])).filter((w) => r.vocab.has(w)))];
    document.querySelectorAll("#words-list li").forEach((li) => li.classList.toggle("here", words.includes(li.dataset.w)));
    r.caption.hidden = !line;
    r.caption.innerHTML = line
      ? `<p>${highlight(line)}</p>${words.length ? `<ul>${words.map((w) => `<li><b>${escape(w)}</b>${escape(r.vocab.get(w))}</li>`).join("")}</ul>` : ""}`
      : "";
    if (index !== null && r.following) {
      const el = document.querySelector(`#tscript .seg[data-i="${index}"]`);
      const box = $("tscript");
      if (el) box.scrollTo({ top: el.offsetTop - box.offsetTop - box.clientHeight / 2 + el.offsetHeight / 2 });
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
  for (const ev of ["wheel", "touchmove", "pointerdown"]) $("tscript").addEventListener(ev, pauseFollow, { passive: true });
  $("backnow").onclick = resumeFollow;

  async function openReader(id) {
    const version = state.readVersion;
    $("read-title").textContent = "正在打开…";
    $("stage-slot").replaceChildren();
    $("tscript").innerHTML = '<div class="empty">正在读取转写结果…</div>';
    $("words-list").innerHTML = "";
    $("words-count").textContent = "";
    $("backnow").hidden = true;
    try {
      if (!state.loaded) await refresh();
      const { task } = await request(`/tasks/${idPath(id)}`);
      if (version !== state.readVersion) return;
      if (!task) throw new Error("没有找到这个转写。");
      const r = { task, text: "", segments: [], vocab: new Map(), player: null, caption: null, current: null, following: true, followTimer: null };
      state.reader = r;
      $("read-title").textContent = nameOf(task.input_file_id);
      if (task.status !== "completed" || !task.output_file_id) {
        $("tscript").innerHTML = '<div class="empty">这个任务还没有完成，完成后就能在这里阅读。</div>';
        return;
      }
      const data = await request(`/download/${idPath(task.output_file_id)}`);
      const raw = await storageText(data.download_url);
      if (version !== state.readVersion) return;
      r.text = raw;
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed.text === "string") {
          r.text = parsed.text;
          const segs = (parsed.segments || []).filter((s) => Number.isFinite(Number(s.start_ms)) && typeof s.text === "string");
          r.segments = segs.map((s, i) => {
            const start = Number(s.start_ms) / 1000;
            const end = Number(s.end_ms) / 1000;
            const next = Number(segs[i + 1]?.start_ms) / 1000;
            return { start, end: end > start ? end : next > start ? next : Infinity, text: s.text };
          });
        }
      } catch {
        /* plain-text results are shown as they are */
      }
      renderTranscript();
      loadVocab(version);
      loadMedia(version);
    } catch (e) {
      if (version === state.readVersion && e.name !== "AbortError")
        $("tscript").innerHTML = `<div class="empty">无法读取结果：${escape(e.message)}</div>`;
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
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { words } = await res.json();
      if (version !== state.readVersion) return;
      for (const w of words) r.vocab.set(vocabKey(w.word), w.translation);
      $("words-count").textContent = `${words.length} 个`;
      $("words-list").innerHTML = words.length
        ? words
            .map((w) => `<li data-w="${escape(vocabKey(w.word))}"><span class="w">${escape(w.word)}</span><span class="n">×${w.count}</span><span class="t">${escape(w.translation)}</span></li>`)
            .join("")
        : '<li class="t">没有找到生词。</li>';
      renderTranscript();
      renderCaption(r.current, true);
    } catch (e) {
      if (version === state.readVersion) $("words-count").textContent = `提取失败：${e.message}`;
    }
  }
  async function loadMedia(version) {
    const r = state.reader;
    try {
      const media = await request(`/download/${idPath(r.task.input_file_id)}`);
      if (version !== state.readVersion) return;
      const audioOnly = !isVideo(nameOf(r.task.input_file_id));
      const player = document.createElement(audioOnly ? "audio" : "video");
      player.controls = true;
      player.preload = "metadata";
      player.setAttribute("playsinline", "");
      player.src = safeURL(media.download_url);
      const stage = document.createElement("div");
      stage.className = audioOnly ? "stage audio" : "stage";
      const caption = document.createElement("div");
      caption.className = "cap";
      caption.hidden = true;
      stage.append(player, caption);
      if (!audioOnly) {
        // Native fullscreen would show the bare video without the caption.
        player.setAttribute("controlslist", "nofullscreen");
        const full = document.createElement("button");
        full.type = "button";
        full.className = "stage-full";
        full.textContent = "⛶ 全屏";
        full.onclick = () => {
          if (document.fullscreenElement) document.exitFullscreen();
          else if (stage.requestFullscreen) stage.requestFullscreen();
          else if (stage.webkitRequestFullscreen) stage.webkitRequestFullscreen();
          else player.webkitEnterFullscreen?.(); // iPhone only fullscreens the video element
        };
        stage.addEventListener("fullscreenchange", () => {
          full.textContent = document.fullscreenElement === stage ? "✕ 退出全屏" : "⛶ 全屏";
        });
        player.addEventListener("dblclick", () => full.click());
        stage.append(full);
      }
      r.player = player;
      r.caption = caption;
      const sync = () => {
        if (version !== state.readVersion) return;
        if (player.readyState >= 1 && player.dataset.pendingSeek !== undefined) {
          player.currentTime = Number(player.dataset.pendingSeek);
          delete player.dataset.pendingSeek;
        }
        const t = player.currentTime;
        const i = player.ended ? -1 : r.segments.findIndex((s) => t >= s.start && t < s.end);
        if (r.segments.length) renderCaption(i < 0 ? null : i);
      };
      for (const ev of ["loadedmetadata", "timeupdate", "seeking", "ended"]) player.addEventListener(ev, sync);
      player.onerror = () => {
        if (version === state.readVersion)
          $("stage-slot").innerHTML = '<div class="empty">浏览器无法播放这个文件（比如 MKV 格式），文字和生词不受影响。</div>';
      };
      $("stage-slot").replaceChildren(stage);
    } catch (e) {
      if (version === state.readVersion && e.name !== "AbortError")
        $("stage-slot").innerHTML = `<div class="empty">原始文件加载失败：${escape(e.message)}</div>`;
    }
  }
  $("tscript").addEventListener("click", async (e) => {
    const seg = e.target.closest(".seg");
    const r = state.reader;
    if (!seg || !r) return;
    const target = r.segments[seg.dataset.i].start;
    r.following = true;
    $("backnow").hidden = true;
    if (!r.player) return toast("音视频还在加载，请稍后再点。");
    try {
      // Before metadata arrives the seek is kept and applied later.
      if (r.player.readyState >= 1) r.player.currentTime = target;
      else r.player.dataset.pendingSeek = String(target);
      await r.player.play();
    } catch {
      toast("无法播放这个文件。");
    }
  });

  /* ---------- ⋯ menu: exports are built on demand, nothing is stored ---------- */
  const srtTime = (s) => {
    const ms = Math.round(s * 1000);
    const p = (n, w = 2) => String(n).padStart(w, "0");
    return `${p(Math.floor(ms / 3600000))}:${p(Math.floor((ms % 3600000) / 60000))}:${p(Math.floor((ms % 60000) / 1000))},${p(ms % 1000, 3)}`;
  };
  const baseName = () => nameOf(state.reader.task.input_file_id).replace(/\.[^.]+$/, "");
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
        if (!r.segments.length) return toast("这份结果没有时间戳，无法生成字幕。");
        const end = (s) => (Number.isFinite(s.end) ? s.end : s.start + 3);
        saveBlob(`${baseName()}.srt`, r.segments.map((s, i) => `${i + 1}\n${srtTime(s.start)} --> ${srtTime(end(s))}\n${s.text.trim()}\n`).join("\n"));
      }
      if (action === "txt") saveBlob(`${baseName()}.txt`, r.text);
      if (action === "copy") {
        await navigator.clipboard.writeText(r.text);
        toast("已复制全文");
      }
      if (action === "source") {
        const media = await request(`/download/${idPath(r.task.input_file_id)}`);
        window.open(safeURL(media.download_url), "_blank", "noopener");
      }
      if (action === "tech") {
        $("tech-body").textContent = JSON.stringify(r.task, null, 2);
        $("tech").showModal();
      }
    } catch (err) {
      if (err.name !== "AbortError") toast(err.message);
    }
  });
  $("tech-close").onclick = () => $("tech").close();

  /* ---------- list actions ---------- */
  document.addEventListener("click", async (e) => {
    const t = e.target;
    const filter = t.closest("[data-filter]");
    if (filter) {
      const [list, k] = filter.dataset.filter.split(":");
      state.filters[list] = k;
      render();
      return;
    }
    const retryUpload = t.closest("[data-retry-upload]");
    if (retryUpload) {
      const u = state.uploads.find((x) => x.key === retryUpload.dataset.retryUpload);
      if (u) runUpload(u);
      return;
    }
    const again = t.closest("[data-retry-task], [data-transcribe]");
    if (again) {
      again.disabled = true;
      try {
        await createTask(again.dataset.retryTask || again.dataset.transcribe);
        toast("已开始转写");
        await refresh();
        if (location.hash.startsWith("#/files")) location.hash = "#/";
      } catch (err) {
        if (err.name !== "AbortError") toast(err.message);
        again.disabled = false;
      }
      return;
    }
    const read = t.closest("[data-read]");
    if (read) location.hash = `#/read/${encodeURIComponent(read.dataset.read)}`;
  });
  document.addEventListener("keydown", (e) => {
    const read = e.target.closest?.("[data-read]");
    if (read && e.key === "Enter") location.hash = `#/read/${encodeURIComponent(read.dataset.read)}`;
  });

  // Another tab signed in or out: follow it rather than act on a stale token.
  window.addEventListener("storage", (e) => {
    if (e.key === "vox_token" && e.newValue !== state.token) {
      logout();
      msg("auth-msg", "账号在其他页面发生了变化，请重新登录。");
    }
  });

  setMode("login");
  verify();
})();
