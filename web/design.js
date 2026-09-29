// Architecture explorer: local presentation state only, no API requests.
(() => {
  "use strict";
  const views = {
    all: {
      label: "整体架构",
      summary: "先看全局：业务请求、媒体文件和耗时任务各走自己的路径。",
      measure: "选择一个维度，再点图中编号，在右侧逐项查看设计。",
      notes: [
        {
          title: "一个工作台，连接输入与结果",
          text: "浏览器负责录音、上传、阅读、按句回听与导出；nginx 提供页面并转发业务请求。",
          evidence: "录音与字幕交互在前端；耗时处理在后台继续。",
          nodes: ["browser", "web"],
          edges: ["entry", "api-route", "vocab-route"],
          marks: [[20, 282]],
          source: "web/app.js",
        },
        {
          title: "三个业务服务，管理身份与归属",
          text: "API 网关处理登录与 JWT；文件服务管理文件元数据和签名地址；任务服务保存任务、编排阶段。",
          evidence: "userdb / filedb / taskdb 分别保存对应元数据。",
          nodes: ["api", "file", "task"],
          edges: ["api-route", "file-rpc", "task-rpc", "signed"],
          marks: [[402, 194]],
          source: "01_apiService/internal/handler/task.go",
        },
        {
          title: "队列衔接阶段，长短转写分开",
          text: "先进入转码队列；完成回报后，任务服务按音频时长派发到短转写或长转写队列。",
          evidence: "默认以 10 分钟分流，可通过配置调整。",
          nodes: ["task", "queue"],
          edges: [
            "dispatch",
            "transcode-route",
            "cloud-route",
            "local-route",
            "reports",
          ],
          marks: [[627, 477]],
          source: "03_taskService/internal/service/task.go",
        },
        {
          title: "三类 worker，可以分别扩展",
          text: "ffmpeg 统一音轨；短音频走云端转写实现，长音频走本地模型。每一类消费者可独立增加实例。",
          evidence:
            "图示是处理拓扑，不代表当前实例数；云端 worker 需单独部署启用。",
          nodes: ["transcode", "cloud", "local"],
          edges: ["transcode-route", "cloud-route", "local-route", "reports"],
          marks: [
            [966, 273],
            [966, 429],
            [966, 565],
          ],
          source: "04_transcriberService/cmd/main.go",
        },
        {
          title: "文件直达存储，结果持续保留",
          text: "原始媒体、标准音轨与转写结果写入对象存储。浏览器与 worker 按签名地址读写，文件字节不绕经 API 网关。",
          evidence: "文件服务校验归属与上传完成，元数据关联原始内容和结果。",
          nodes: ["file", "storage"],
          edges: ["direct", "storage-sign", "worker-storage"],
          marks: [[976, 80]],
          source: "02_fileService/internal/service/service.go",
        },
        {
          title: "生词服务，接上学习场景",
          text: "浏览器把英文转写交给词汇服务，通过 ECDICT 规则筛选生词候选并返回释义，在阅读时查看。",
          evidence: "与播放器、转写结果独立加载；当前不是个性化单词本。",
          nodes: ["browser", "vocab"],
          edges: ["entry", "vocab-route"],
          marks: [[402, 426]],
          source: "05_vocabularyService/cmd/main.go",
        },
      ],
    },
    accuracy: {
      label: "准确率",
      summary: "模型负责识别；标准音轨与原声核对，让结果更容易正确使用。",
      measure:
        "验证：固定样本、模型与语言，对照人工标注统计 WER / CER，并记录校对时间。",
      notes: [
        {
          title: "先准备模型可以处理的音轨",
          text: "转码 worker 将媒体统一为 16 kHz 单声道 WAV，供后续语音模型处理。",
          evidence: "格式标准化保证兼容，不会恢复原录音已经丢失的信息。",
          nodes: ["transcode"],
          edges: ["transcode-route"],
          marks: [[966, 273]],
          source: "06_transcodeService/internal/normalizer/ffmpeg.go",
        },
        {
          title: "识别能力来自语音模型",
          text: "云端实现接入 ElevenLabs Scribe v2，本地实现使用 whisper.cpp；统一 Transcriber 接口返回正文和时间戳。",
          evidence:
            "准确率依赖具体模型、语言与录音质量，需在同一批样本上验证。",
          nodes: ["cloud", "local"],
          edges: ["cloud-route", "local-route"],
          marks: [
            [966, 429],
            [966, 565],
          ],
          source: "04_transcriberService/internal/transcriber/whisper.go",
        },
        {
          title: "保留原始内容作为核对依据",
          text: "对象存储保存原声和转写结果，文件与任务记录保持来源关联，之后仍可读取和回听。",
          evidence: "持久保存提供可追溯来源；长期可靠性仍需备份与恢复保障。",
          nodes: ["file", "task", "storage"],
          edges: ["storage-sign", "signed", "worker-storage"],
          marks: [[976, 80]],
          source: "02_fileService/internal/service/service.go",
        },
        {
          title: "让每一段文字都能回到声音",
          text: "前端按时间戳同步字幕，点击段落定位原声，方便核对人名、术语与上下文。",
          evidence: "回听降低核对难度；它本身不改变模型识别率。",
          nodes: ["browser"],
          edges: ["direct"],
          marks: [[20, 282]],
          source: "04_transcriberService/internal/transcript/result.go",
        },
      ],
    },
    speed: {
      label: "速度",
      summary: "沿着传输、排队、计算和结果使用，减少等待与相互干扰。",
      measure:
        "验证：拆分上传、排队、转码与转写耗时，比较端到端 P50 / P95 和固定并发下的完成量。",
      notes: [
        {
          title: "文件直传，减少传输绕行",
          text: "媒体直接在浏览器、worker 与对象存储之间传输，API 网关主要处理身份和元数据。",
          evidence:
            "减少业务网关承载的大文件流量，实际速度仍取决于网络和存储。",
          nodes: ["file", "storage"],
          edges: ["direct", "storage-sign", "worker-storage"],
          marks: [[590, 44]],
          source: "02_fileService/internal/service/service.go",
        },
        {
          title: "异步排队，把长短任务分开",
          text: "短音频与长音频各用一条转写队列和独立消费者，短任务无需与长转写共用同一队列；默认以 10 分钟分流云端与本地。",
          evidence:
            "长音频使用本地引擎，减少长录音的云端调用量；转码与存储仍是共享环节，总成本也包含本地资源。",
          nodes: ["task", "queue"],
          edges: ["dispatch", "transcode-route", "cloud-route", "local-route"],
          marks: [[627, 477]],
          source: "03_taskService/internal/service/task.go",
        },
        {
          title: "模型常驻复用，worker 按需扩展",
          text: "本地模型在进程启动时加载，后续任务复用；镜像默认使用轻量 Tiny，也可配置其他模型。转码、短转写、长转写分别增加消费者。",
          evidence:
            "省去逐任务重新加载模型的步骤。模型选型与实例数仍需结合准确率、实际耗时和资源成本评估。",
          nodes: ["transcode", "cloud", "local"],
          edges: ["transcode-route", "cloud-route", "local-route", "reports"],
          marks: [
            [966, 273],
            [966, 429],
            [966, 565],
          ],
          source: "04_transcriberService/cmd/main.go",
        },
        {
          title: "结果独立加载，直接定位原声",
          text: "播放器、转写稿和生词各自加载，已就绪的内容可以先用；点击字幕跳到目标位置，减少反复拖动。",
          evidence: "把速度延伸到“找到并用上结果”，而不只关注模型推理。",
          nodes: ["browser", "vocab"],
          edges: ["direct", "entry", "vocab-route"],
          marks: [[20, 282]],
          source: "web/app.js",
        },
      ],
    },
    productivity: {
      label: "Productivity / 效率",
      summary:
        "Productivity = 有效产出 ÷ 用户投入。一次输入，连接阅读、回听、学习与复用。",
      measure:
        "验证：比较操作次数、主动操作与查找时间，以及真正完成的定位、导出和复用任务。",
      notes: [
        {
          title: "输入一次，少做重复操作",
          text: "录音先试听，确认后提交；文件上传后自动创建处理任务，减少手工转换与跨工具传递。",
          evidence: "用户投入集中在内容、确认和必要核对。",
          nodes: ["browser"],
          edges: ["entry", "api-route", "direct"],
          marks: [[20, 282]],
          source: "web/app.js",
        },
        {
          title: "让工作流接手中间步骤",
          text: "任务服务衔接转码、转写和结果关联；用户不需要自己在各个 worker 之间搬运文件。",
          evidence: "状态与结果可查询，后台处理无需一直停留在页面。",
          nodes: ["task"],
          edges: ["dispatch", "reports"],
          marks: [[627, 298]],
          source: "03_taskService/internal/service/task.go",
        },
        {
          title: "把一次产出留给下一次使用",
          text: "文件服务与对象存储保留原始内容和结果，通过历史列表找回，继续阅读、按句回听和导出。",
          evidence: "同一份内容服务更多后续任务，减少重复录制和重复处理。",
          nodes: ["file", "storage"],
          edges: ["direct", "storage-sign", "signed"],
          marks: [[976, 80]],
          source: "02_fileService/internal/service/service.go",
        },
        {
          title: "让同一份内容产生更多用途",
          text: "转写稿用于阅读，时间戳用于回听与 SRT，正文可导出 TXT；词汇服务再提供英文生词候选和释义。",
          evidence: "增加有实际用途的输出，才能提高投入产出比。",
          nodes: ["browser", "vocab"],
          edges: ["entry", "vocab-route"],
          marks: [[402, 426]],
          source: "05_vocabularyService/cmd/main.go",
        },
      ],
    },
  };
  const explorer = document.querySelector(".architecture-explorer");
  const workspace = document.querySelector(".architecture-workspace");
  const inspector = document.querySelector(".architecture-inspector");
  const dialog = document.getElementById("architecture-dialog");
  const svg = document.getElementById("architecture-map");
  const viewport = document.querySelector(".architecture-viewport");
  const notes = document.getElementById("architecture-details");
  const tabs = document.getElementById("note-tabs");
  const callouts = document.getElementById("map-callouts");
  const buttons = [...document.querySelectorAll("button[data-perspective]")];
  const ns = "http://www.w3.org/2000/svg";
  const fragments = {
    "accuracy-design": "accuracy",
    "productivity-design": "productivity",
    "efficiency-design": "productivity",
    "speed-design": "speed",
    engineering: "all",
  };
  const narrow = matchMedia("(max-width: 1000px)");
  let view = "all",
    active = 0;
  let returnFocus = null;
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }
  function highlight(index = null) {
    const selected =
      index === null ? views[view].notes : [views[view].notes[index]];
    const nodeKeys = new Set(selected.flatMap((n) => n.nodes)),
      edgeKeys = new Set(selected.flatMap((n) => n.edges));
    const filtered = view !== "all" || index !== null;
    explorer.classList.toggle("is-filtered", filtered);
    svg
      .querySelectorAll("[data-node]")
      .forEach((n) =>
        n.classList.toggle("is-relevant", nodeKeys.has(n.dataset.node)),
      );
    svg.querySelectorAll("[data-edge]").forEach((n) => {
      const relevant = edgeKeys.has(n.dataset.edge);
      n.classList.toggle("is-relevant", relevant);
      const kind =
        ["data", "queue"].find((k) => n.classList.contains(`map-edge-${k}`)) ||
        "control";
      const path = n.querySelector("path");
      for (const attr of ["marker-start", "marker-end"])
        if (path.hasAttribute(attr))
          path.setAttribute(
            attr,
            `url(#arrow-${filtered && relevant ? "active" : kind})`,
          );
    });
    callouts.querySelectorAll("a").forEach((n) => {
      n.classList.toggle(
        "is-secondary",
        index !== null && Number(n.dataset.note) !== index,
      );
      if (Number(n.dataset.note) === active)
        n.setAttribute("aria-current", "true");
      else n.removeAttribute("aria-current");
    });
  }
  function pan(index) {
    if (svg.getBoundingClientRect().width <= viewport.clientWidth) return;
    const target = svg
      .querySelector(`[data-node="${views[view].notes[index].nodes[0]}"]`)
      .getBoundingClientRect();
    const area = viewport.getBoundingClientRect();
    viewport.scrollLeft +=
      target.left - area.left - (viewport.clientWidth - target.width) / 2;
  }
  function openInspector() {
    if (!narrow.matches || dialog.open) return;
    returnFocus = document.activeElement;
    dialog.append(inspector);
    dialog.showModal();
    inspector.querySelector(".inspector-prompt").textContent =
      "点击编号或上一项、下一项，继续查看。";
    inspector.querySelector(".inspector-close").focus();
  }
  function showNote(index, { focusMap = true, modal = false } = {}) {
    active = Math.max(0, Math.min(index, views[view].notes.length - 1));
    const note = views[view].notes[active];
    notes.replaceChildren();
    const card = el("article", "inspector-note");
    card.id = `design-note-${active + 1}`;
    card.append(
      el("span", "inspector-number", String(active + 1).padStart(2, "0")),
      el("h3", "", note.title),
      el("p", "", note.text),
    );
    const evidence = el("div", "inspector-evidence");
    evidence.append(el("span", "", "设计说明"), el("p", "", note.evidence));
    const source = el("a", "inspector-source", "查看实现源码 ↗");
    source.href = "https://github.com/justyura/vox/blob/HEAD/" + note.source;
    source.target = "_blank";
    source.rel = "noopener";
    card.append(evidence, source);
    notes.append(card);
    tabs
      .querySelectorAll("button")
      .forEach((button, i) =>
        button.setAttribute("aria-pressed", String(i === active)),
      );
    document.getElementById("note-position").textContent =
      `${active + 1} / ${views[view].notes.length}`;
    document.getElementById("note-prev").disabled = active === 0;
    document.getElementById("note-next").disabled =
      active === views[view].notes.length - 1;
    highlight(focusMap ? active : null);
    if (focusMap) pan(active);
    if (modal) openInspector();
  }
  function render(next, write = false) {
    view = views[next] ? next : "all";
    const config = views[view];
    document.body.dataset.activePerspective = view;
    explorer.dataset.perspective = view;
    buttons.forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.perspective === view)),
    );
    document.getElementById("perspective-name").textContent = config.label;
    document.getElementById("perspective-summary").textContent = config.summary;
    document.getElementById("details-title").textContent = config.label;
    document.getElementById("perspective-measure").textContent = config.measure;
    document.getElementById("map-active-legend").textContent = narrow.matches
      ? "点击编号 → 浮窗说明"
      : "点击编号 → 右侧说明";
    tabs.replaceChildren();
    callouts.replaceChildren();
    config.notes.forEach((note, i) => {
      const button = el("button", "", String(i + 1).padStart(2, "0"));
      button.type = "button";
      button.setAttribute("aria-label", `说明 ${i + 1}：${note.title}`);
      button.setAttribute("aria-controls", "architecture-details");
      button.addEventListener("click", () => showNote(i));
      tabs.append(button);
      note.marks.forEach(([x, y]) => {
        const a = document.createElementNS(ns, "a");
        a.classList.add("map-callout");
        a.dataset.note = i;
        a.setAttribute("href", "#architecture-details");
        a.setAttribute("aria-controls", "architecture-details");
        a.setAttribute("aria-label", `查看说明 ${i + 1}：${note.title}`);
        const circle = document.createElementNS(ns, "circle");
        circle.setAttribute("cx", x);
        circle.setAttribute("cy", y);
        circle.setAttribute("r", "14");
        const text = document.createElementNS(ns, "text");
        text.setAttribute("x", x);
        text.setAttribute("y", y + 4);
        text.setAttribute("text-anchor", "middle");
        text.textContent = i + 1;
        a.append(circle, text);
        a.addEventListener("click", (event) => {
          event.preventDefault();
          showNote(i, { modal: true });
        });
        callouts.append(a);
      });
    });
    showNote(0, { focusMap: false });
    if (write)
      history.replaceState(
        null,
        "",
        view === "all" ? "#engineering" : `#${view}-design`,
      );
  }
  const navigation = el("div", "inspector-navigation");
  const previous = el("button", "", "← 上一项"),
    next = el("button", "", "下一项 →"),
    position = el("span");
  previous.type = next.type = "button";
  previous.id = "note-prev";
  next.id = "note-next";
  position.id = "note-position";
  previous.addEventListener("click", () => showNote(active - 1));
  next.addEventListener("click", () => showNote(active + 1));
  navigation.append(previous, position, next);
  notes.after(navigation);
  notes.setAttribute("aria-live", "polite");
  notes.setAttribute("aria-atomic", "true");
  buttons.forEach((b) =>
    b.addEventListener("click", () => render(b.dataset.perspective, true)),
  );
  document.getElementById("map-zoom").addEventListener("click", () => {
    svg.style.width = `${Math.min(svg.getBoundingClientRect().width * 1.3, 2400)}px`;
    svg.style.minWidth = "0";
  });
  document.getElementById("map-fit").addEventListener("click", () => {
    svg.style.width = "100%";
    svg.style.minWidth = "0";
    viewport.scrollLeft = 0;
  });
  inspector
    .querySelector(".inspector-close")
    .addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener("close", () => {
    workspace.append(inspector);
    inspector.querySelector(".inspector-prompt").textContent =
      "点击图中编号，在这里展开。";
    returnFocus?.focus({ preventScroll: true });
    returnFocus = null;
  });
  narrow.addEventListener("change", () => {
    if (!narrow.matches && dialog.open) dialog.close();
  });
  function fragment() {
    const hash = location.hash.slice(1);
    if (fragments[hash]) render(fragments[hash]);
    const detail = document.getElementById(hash)?.closest("details");
    if (detail) detail.open = true;
    const match = /^design-note-([1-6])$/.exec(hash);
    if (match) showNote(Number(match[1]) - 1);
  }
  const marker = document.createElementNS(ns, "marker");
  marker.id = "arrow-active";
  for (const [key, value] of Object.entries({
    viewBox: "0 0 10 10",
    refX: "9",
    refY: "5",
    markerWidth: "6",
    markerHeight: "6",
    orient: "auto-start-reverse",
  }))
    marker.setAttribute(key, value);
  const arrow = document.createElementNS(ns, "path");
  arrow.setAttribute("d", "M0 0 L10 5 L0 10Z");
  arrow.classList.add("arrow-active");
  marker.append(arrow);
  svg.querySelector("defs").append(marker);
  document.body.classList.add("architecture-ready");
  render(fragments[location.hash.slice(1)] || "all");
  fragment();
  window.addEventListener("hashchange", fragment);
})();
