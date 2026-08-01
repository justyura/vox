(() => {
  "use strict";

  const state = {
    authMode: "login",
    token: window.localStorage.getItem("vox_token") || "",
    user: null,
    selectedFile: null,
    audioURL: "",
    audioDuration: 0,
    taskID: "",
    resultText: "",
    startedAt: 0,
    elapsedTimer: null,
    pollTimer: null,
    toastTimer: null,
  };

  const elements = {
    accountButton: document.querySelector("#account-button"),
    accountLabel: document.querySelector("#account-label"),
    logoutButton: document.querySelector("#logout-button"),
    authCard: document.querySelector("#auth-card"),
    loginTab: document.querySelector("#login-tab"),
    signupTab: document.querySelector("#signup-tab"),
    authForm: document.querySelector("#auth-form"),
    email: document.querySelector("#email"),
    password: document.querySelector("#password"),
    authSubmit: document.querySelector("#auth-submit"),
    authMessage: document.querySelector("#auth-message"),
    workbench: document.querySelector("#workbench"),
    dropZone: document.querySelector("#drop-zone"),
    browseButton: document.querySelector("#browse-button"),
    fileInput: document.querySelector("#file-input"),
    selectedFile: document.querySelector("#selected-file"),
    selectedFileName: document.querySelector("#selected-file-name"),
    selectedFileMeta: document.querySelector("#selected-file-meta"),
    removeFile: document.querySelector("#remove-file"),
    audioPreview: document.querySelector("#audio-preview"),
    transcribeButton: document.querySelector("#transcribe-button"),
    taskID: document.querySelector("#task-id"),
    taskSteps: Array.from(document.querySelectorAll("#task-steps li")),
    currentStatus: document.querySelector("#current-status"),
    elapsedTime: document.querySelector("#elapsed-time"),
    resultCard: document.querySelector("#result-card"),
    transcriptText: document.querySelector("#transcript-text"),
    resultDuration: document.querySelector("#result-duration"),
    audioDuration: document.querySelector("#audio-duration"),
    copyResult: document.querySelector("#copy-result"),
    downloadResult: document.querySelector("#download-result"),
    historyCard: document.querySelector("#history-card"),
    taskList: document.querySelector("#task-list"),
    refreshTasks: document.querySelector("#refresh-tasks"),
    toast: document.querySelector("#toast"),
  };

  const statusLabels = {
    pending: "等待调度",
    dispatched: "正在转写",
    completed: "已完成",
    failed: "失败",
  };

  function setAuthMode(mode) {
    state.authMode = mode;
    const isLogin = mode === "login";
    elements.loginTab.classList.toggle("is-active", isLogin);
    elements.signupTab.classList.toggle("is-active", !isLogin);
    elements.loginTab.setAttribute("aria-selected", String(isLogin));
    elements.signupTab.setAttribute("aria-selected", String(!isLogin));
    elements.password.autocomplete = isLogin ? "current-password" : "new-password";
    elements.password.placeholder = isLogin ? "输入密码" : "至少输入 6 位密码";
    elements.password.minLength = isLogin ? 1 : 6;
    elements.authSubmit.querySelector("span").textContent = isLogin
      ? "登录并进入工作台"
      : "创建账号并进入工作台";
    elements.authMessage.textContent = "";
  }

  function setToken(token) {
    state.token = token;
    if (token) {
      window.localStorage.setItem("vox_token", token);
    } else {
      window.localStorage.removeItem("vox_token");
    }
  }

  function authHeaders(extra = {}) {
    return {
      ...extra,
      Authorization: `Bearer ${state.token}`,
    };
  }

  async function parseResponse(response) {
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      return response.json();
    }
    return { error: await response.text() };
  }

  function messageFrom(data, fallback) {
    if (data && typeof data.error === "string" && data.error) {
      return data.error;
    }
    return fallback;
  }

  async function verifySession() {
    if (!state.token) {
      showSignedOut();
      return;
    }

    try {
      const response = await fetch("/whoami", {
        headers: authHeaders(),
      });
      if (!response.ok) {
        throw new Error("session expired");
      }
      state.user = await response.json();
      showSignedIn();
    } catch {
      setToken("");
      state.user = null;
      showSignedOut();
    }
  }

  function showSignedOut() {
    elements.authCard.hidden = false;
    elements.workbench.hidden = true;
    elements.historyCard.hidden = true;
    elements.resultCard.hidden = true;
    elements.logoutButton.hidden = true;
    elements.accountButton.classList.remove("is-authenticated");
    elements.accountLabel.textContent = "登录体验";
  }

  function showSignedIn() {
    elements.authCard.hidden = true;
    elements.workbench.hidden = false;
    elements.historyCard.hidden = false;
    elements.logoutButton.hidden = false;
    elements.accountButton.classList.add("is-authenticated");
    elements.accountLabel.textContent = state.user?.email || "已登录";
    loadTasks();
  }

  async function handleAuthSubmit(event) {
    event.preventDefault();
    elements.authMessage.textContent = "";
    elements.authSubmit.disabled = true;

    const endpoint = state.authMode === "login" ? "/login" : "/signup";
    const form = new URLSearchParams({
      email: elements.email.value.trim(),
      password: elements.password.value,
    });

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        body: form,
      });
      const data = await parseResponse(response);
      if (!response.ok) {
        throw new Error(messageFrom(data, state.authMode === "login" ? "登录失败" : "注册失败"));
      }
      setToken(data.token);
      await verifySession();
      elements.authForm.reset();
      showToast(state.authMode === "login" ? "登录成功，工作台已就绪。" : "账号已创建，欢迎使用 Vox。");
      elements.workbench.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      elements.authMessage.textContent = error.message;
    } finally {
      elements.authSubmit.disabled = false;
    }
  }

  function logout() {
    stopPolling();
    setToken("");
    state.user = null;
    resetTask();
    clearSelectedFile();
    showSignedOut();
    setAuthMode("login");
    showToast("已安全退出当前工作空间。");
    elements.authCard.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function openLogin() {
    if (state.user) {
      elements.workbench.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    elements.authCard.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => elements.email.focus(), 400);
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
  }

  function formatDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return "—";
    if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
    const minutes = Math.floor(seconds / 60);
    const rest = Math.round(seconds % 60);
    return `${minutes}m ${rest}s`;
  }

  function chooseFile(file) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".wav")) {
      showToast("当前版本只支持 WAV 文件。", true);
      return;
    }

    clearSelectedFile();
    state.selectedFile = file;
    state.audioURL = URL.createObjectURL(file);
    elements.selectedFileName.textContent = file.name;
    elements.selectedFileMeta.textContent = `${formatBytes(file.size)} · audio/wav`;
    elements.selectedFile.hidden = false;
    elements.audioPreview.src = state.audioURL;
    elements.audioPreview.hidden = false;
    elements.transcribeButton.disabled = false;
    elements.dropZone.hidden = true;
    elements.resultCard.hidden = true;
    resetTask();
  }

  function clearSelectedFile() {
    if (state.audioURL) {
      URL.revokeObjectURL(state.audioURL);
    }
    state.selectedFile = null;
    state.audioURL = "";
    state.audioDuration = 0;
    elements.fileInput.value = "";
    elements.audioPreview.removeAttribute("src");
    elements.audioPreview.load();
    elements.audioPreview.hidden = true;
    elements.selectedFile.hidden = true;
    elements.dropZone.hidden = false;
    elements.transcribeButton.disabled = true;
  }

  function setStep(name, status) {
    const item = elements.taskSteps.find((step) => step.dataset.step === name);
    if (!item) return;
    item.classList.remove("is-active", "is-complete", "is-error");
    if (status === "active") item.classList.add("is-active");
    if (status === "complete") item.classList.add("is-complete");
    if (status === "error") item.classList.add("is-error");
    const labels = {
      waiting: "等待",
      active: "进行中",
      complete: "完成",
      error: "失败",
    };
    item.querySelector(".step-status").textContent = labels[status] || "等待";
  }

  function resetTask() {
    stopPolling();
    state.taskID = "";
    state.resultText = "";
    state.startedAt = 0;
    elements.taskID.textContent = "等待任务";
    elements.currentStatus.textContent = "等待音频";
    elements.elapsedTime.textContent = "—";
    for (const step of elements.taskSteps) {
      setStep(step.dataset.step, "waiting");
    }
  }

  function startElapsedTimer() {
    window.clearInterval(state.elapsedTimer);
    state.startedAt = Date.now();
    elements.elapsedTime.textContent = "0.0s";
    state.elapsedTimer = window.setInterval(() => {
      elements.elapsedTime.textContent = formatDuration((Date.now() - state.startedAt) / 1000);
    }, 250);
  }

  function stopElapsedTimer() {
    window.clearInterval(state.elapsedTimer);
    state.elapsedTimer = null;
    if (state.startedAt) {
      elements.elapsedTime.textContent = formatDuration((Date.now() - state.startedAt) / 1000);
    }
  }

  function stopPolling() {
    window.clearTimeout(state.pollTimer);
    state.pollTimer = null;
    window.clearInterval(state.elapsedTimer);
    state.elapsedTimer = null;
  }

  async function startTranscription() {
    if (!state.token || !state.selectedFile) return;

    elements.transcribeButton.disabled = true;
    elements.resultCard.hidden = true;
    resetTask();
    startElapsedTimer();
    setStep("upload", "active");
    elements.currentStatus.textContent = "正在申请上传地址";

    try {
      const uploadResponse = await fetch("/upload", {
        method: "POST",
        headers: authHeaders(),
        body: new URLSearchParams({ filename: state.selectedFile.name }),
      });
      const uploadData = await parseResponse(uploadResponse);
      if (!uploadResponse.ok) {
        throw new Error(messageFrom(uploadData, "无法创建上传请求"));
      }

      elements.currentStatus.textContent = "正在直传对象存储";
      const putResponse = await fetch(uploadData.upload_url, {
        method: "PUT",
        body: state.selectedFile,
      });
      if (!putResponse.ok) {
        throw new Error(`对象存储返回 ${putResponse.status}`);
      }

      setStep("upload", "complete");
      setStep("queue", "active");
      elements.currentStatus.textContent = "正在创建异步任务";

      const taskResponse = await fetch("/tasks", {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          input_file_id: uploadData.file_id,
          type: "transcribe",
        }),
      });
      const taskData = await parseResponse(taskResponse);
      if (!taskResponse.ok) {
        throw new Error(messageFrom(taskData, "无法创建转写任务"));
      }

      state.taskID = taskData.task_id;
      elements.taskID.textContent = `TASK ${state.taskID.slice(0, 8).toUpperCase()}`;
      setStep("queue", "complete");
      setStep("transcribe", "active");
      elements.currentStatus.textContent = "Worker 正在执行本地推理";
      pollTask();
      loadTasks();
    } catch (error) {
      markCurrentStepFailed();
      stopElapsedTimer();
      elements.currentStatus.textContent = "任务未完成";
      elements.transcribeButton.disabled = false;
      showToast(error.message || "转写流程发生错误。", true);
    }
  }

  function markCurrentStepFailed() {
    const active = elements.taskSteps.find((step) => step.classList.contains("is-active"));
    if (active) setStep(active.dataset.step, "error");
  }

  async function pollTask() {
    if (!state.taskID) return;

    try {
      const response = await fetch(`/tasks/${encodeURIComponent(state.taskID)}`, {
        headers: authHeaders(),
      });
      const data = await parseResponse(response);
      if (!response.ok || !data.task) {
        throw new Error(messageFrom(data, "无法读取任务状态"));
      }

      const task = data.task;
      if (task.status === "completed") {
        setStep("transcribe", "complete");
        setStep("result", "active");
        elements.currentStatus.textContent = "正在读取转写结果";
        await loadTranscript(task.output_file_id);
        setStep("result", "complete");
        elements.currentStatus.textContent = "转写已完成";
        stopElapsedTimer();
        elements.transcribeButton.disabled = false;
        loadTasks();
        showToast("转写完成，结果已安全返回。");
        return;
      }

      if (task.status === "failed") {
        setStep("transcribe", "error");
        elements.currentStatus.textContent = "模型处理失败";
        stopElapsedTimer();
        elements.transcribeButton.disabled = false;
        loadTasks();
        showToast("Worker 未能完成这次转写，请检查音频格式后重试。", true);
        return;
      }

      state.pollTimer = window.setTimeout(pollTask, 1800);
    } catch (error) {
      state.pollTimer = window.setTimeout(pollTask, 2800);
      showToast(`${error.message}，正在重试。`, true, 2200);
    }
  }

  async function loadTranscript(outputID, options = {}) {
    if (!outputID) {
      throw new Error("任务缺少结果文件");
    }

    const response = await fetch(`/download/${encodeURIComponent(outputID)}`, {
      headers: authHeaders(),
    });
    const data = await parseResponse(response);
    if (!response.ok || !data.download_url) {
      throw new Error(messageFrom(data, "无法获取转写结果"));
    }

    const resultResponse = await fetch(data.download_url);
    if (!resultResponse.ok) {
      throw new Error(`结果存储返回 ${resultResponse.status}`);
    }

    state.resultText = await resultResponse.text();
    elements.transcriptText.textContent = state.resultText || "转写结果为空。";
    const totalSeconds = state.startedAt ? (Date.now() - state.startedAt) / 1000 : null;
    elements.resultDuration.textContent = totalSeconds ? formatDuration(totalSeconds) : "历史任务";
    elements.audioDuration.textContent = formatDuration(state.audioDuration);
    elements.resultCard.hidden = false;
    if (options.scroll !== false) {
      elements.resultCard.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  function copyTranscript() {
    if (!state.resultText) return;
    navigator.clipboard
      .writeText(state.resultText)
      .then(() => showToast("转写文本已复制。"))
      .catch(() => showToast("浏览器未允许复制，请手动选择文本。", true));
  }

  function downloadTranscript() {
    if (!state.resultText) return;
    const blob = new Blob([state.resultText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `vox-${state.taskID || "transcript"}.txt`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  async function loadTasks() {
    if (!state.token) return;
    try {
      const response = await fetch("/tasks", { headers: authHeaders() });
      const data = await parseResponse(response);
      if (!response.ok) throw new Error(messageFrom(data, "无法读取最近任务"));
      renderTasks(Array.isArray(data.tasks) ? data.tasks : []);
    } catch (error) {
      elements.taskList.innerHTML = `<p class="empty-state">${escapeHTML(error.message)}</p>`;
    }
  }

  function renderTasks(tasks) {
    if (!tasks.length) {
      elements.taskList.innerHTML = '<p class="empty-state">还没有任务，上传第一段音频开始体验。</p>';
      return;
    }

    elements.taskList.innerHTML = tasks
      .slice()
      .reverse()
      .slice(0, 6)
      .map((task) => {
        const taskID = task.task_id || "";
        const status = task.status || "pending";
        const outputID = task.output_file_id || "";
        const action =
          status === "completed" && outputID
            ? `<button type="button" data-result-id="${escapeHTML(outputID)}" data-task-id="${escapeHTML(taskID)}">查看结果</button>`
            : "<span></span>";
        return `
          <div class="task-row">
            <div>
              <small>TASK ID</small>
              <strong>${escapeHTML(taskID || "—")}</strong>
            </div>
            <div>
              <small>TYPE</small>
              <strong>${escapeHTML(task.type || "transcribe")}</strong>
            </div>
            <div>
              <small>STATUS</small>
              <span class="status-pill ${escapeHTML(status)}">${escapeHTML(statusLabels[status] || status)}</span>
            </div>
            ${action}
          </div>
        `;
      })
      .join("");
  }

  function escapeHTML(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function showToast(message, isError = false, duration = 3600) {
    window.clearTimeout(state.toastTimer);
    elements.toast.textContent = message;
    elements.toast.classList.toggle("is-error", isError);
    elements.toast.hidden = false;
    state.toastTimer = window.setTimeout(() => {
      elements.toast.hidden = true;
    }, duration);
  }

  elements.loginTab.addEventListener("click", () => setAuthMode("login"));
  elements.signupTab.addEventListener("click", () => setAuthMode("signup"));
  elements.authForm.addEventListener("submit", handleAuthSubmit);
  elements.accountButton.addEventListener("click", openLogin);
  elements.logoutButton.addEventListener("click", logout);

  elements.dropZone.addEventListener("click", () => elements.fileInput.click());
  elements.dropZone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      elements.fileInput.click();
    }
  });
  elements.browseButton.addEventListener("click", (event) => {
    event.stopPropagation();
    elements.fileInput.click();
  });
  elements.fileInput.addEventListener("change", () => chooseFile(elements.fileInput.files[0]));
  elements.removeFile.addEventListener("click", clearSelectedFile);
  elements.audioPreview.addEventListener("loadedmetadata", () => {
    state.audioDuration = elements.audioPreview.duration || 0;
    elements.selectedFileMeta.textContent = `${formatBytes(state.selectedFile?.size || 0)} · ${formatDuration(state.audioDuration)}`;
  });

  for (const eventName of ["dragenter", "dragover"]) {
    elements.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      elements.dropZone.classList.add("is-dragging");
    });
  }
  for (const eventName of ["dragleave", "drop"]) {
    elements.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      elements.dropZone.classList.remove("is-dragging");
    });
  }
  elements.dropZone.addEventListener("drop", (event) => {
    chooseFile(event.dataTransfer.files[0]);
  });

  elements.transcribeButton.addEventListener("click", startTranscription);
  elements.copyResult.addEventListener("click", copyTranscript);
  elements.downloadResult.addEventListener("click", downloadTranscript);
  elements.refreshTasks.addEventListener("click", loadTasks);
  elements.taskList.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-result-id]");
    if (!button) return;
    state.taskID = button.dataset.taskId || "";
    try {
      await loadTranscript(button.dataset.resultId);
    } catch (error) {
      showToast(error.message, true);
    }
  });

  window.addEventListener("beforeunload", () => {
    stopPolling();
    if (state.audioURL) URL.revokeObjectURL(state.audioURL);
  });

  setAuthMode("login");
  verifySession();
})();
