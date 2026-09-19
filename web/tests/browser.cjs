/* Run with NODE_PATH pointing to an installed playwright package, or install
   playwright locally. CHROME_PATH optionally selects an installed browser. */
const { chromium } = require("playwright");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

(async () => {
  const root = path.resolve(__dirname, "..");
  const server = http.createServer((req, res) => {
    const name = req.url === "/" ? "index.html" : req.url.slice(1);
    if (!["index.html", "app.js", "styles.css"].includes(name)) {
      res.writeHead(404).end();
      return;
    }
    res.setHeader(
      "Content-Type",
      {
        "index.html": "text/html",
        "app.js": "text/javascript",
        "styles.css": "text/css",
      }[name],
    );
    res.end(fs.readFileSync(path.join(root, name)));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
      ],
      ...(process.env.CHROME_PATH
        ? { executablePath: process.env.CHROME_PATH }
        : {}),
    });
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const requests = [];
    let failFiles = false,
      expired = false;
    const tasks = Array.from({ length: 47 }, (_, i) => ({
      task_id: `task-${i}`,
      input_file_id: `file-${i}`,
      output_file_id: `result-${i}`,
      type: "transcribe",
      status: i % 3 === 0 ? "completed" : i % 3 === 1 ? "dispatched" : "failed",
      user_id: "user-1",
      created_at: { seconds: 1750000000 + i * 100 },
      ...(i % 3 === 0
        ? { finished_at: { seconds: 1750000010 + i * 100 } }
        : {}),
    }));
    const files = Array.from({ length: 65 }, (_, i) => ({
      file_id: `file-${i}`,
      file_name: i === 0 ? "<img src=x onerror=alert(1)>.wav" : `录音 ${i}.wav`,
      owner: "user-1",
      size: 2048,
      status: "ready",
      created_at: "2026-09-16T10:00:00Z",
    }));
    await page.route("**/api/v1/**", async (route) => {
      const request = route.request(),
        url = new URL(request.url()),
        p = url.pathname.replace("/api/v1", "");
      requests.push([request.method(), p, request.postData()]);
      const fulfill = (data, status = 200) =>
        route.fulfill({ status, json: data });
      if (p === "/login" || p === "/signup")
        return fulfill({ token: "test-token" });
      if (expired) return fulfill({ error: "invalid token" }, 401);
      assert.equal(request.headers().authorization, "Bearer test-token");
      if (p === "/whoami")
        return fulfill({ user_id: "user-1", email: "test@example.com" });
      if (p === "/listfiles")
        return fulfill(
          failFiles ? { error: "files list failed" } : { files },
          failFiles ? 500 : 200,
        );
      if (p === "/tasks" && request.method() === "GET")
        return fulfill({ tasks });
      if (p === "/tasks") {
        const input = request.postDataJSON();
        const task = {
          ...tasks[0],
          task_id: "new-task",
          input_file_id: input.input_file_id,
          status: "pending",
        };
        tasks.unshift(task);
        return fulfill({ task_id: task.task_id });
      }
      if (p.startsWith("/tasks/"))
        return fulfill({ task: tasks.find((t) => t.task_id === p.slice(7)) });
      if (p.startsWith("/download/"))
        return fulfill({ download_url: `https://storage.test/${p.slice(10)}` });
      if (p === "/upload") {
        files.push({ ...files[1], file_id: "new-file", file_name: "new.wav" });
        return fulfill({
          file_id: "new-file",
          upload_url: "https://storage.test/new-file",
        });
      }
      if (p.endsWith("/complete")) return fulfill({ size: 3 });
      return fulfill({ error: "unexpected endpoint" }, 404);
    });
    files[3].file_name = "视频.webm";
    const wav = Buffer.alloc(44 + 16000 * 2 * 8);
    wav.write("RIFF");
    wav.writeUInt32LE(wav.length - 8, 4);
    wav.write("WAVEfmt ", 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(16000, 24);
    wav.writeUInt32LE(32000, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write("data", 36);
    wav.writeUInt32LE(wav.length - 44, 40);
    await page.route("https://storage.test/**", async (route) => {
      assert.equal(route.request().headers().authorization, undefined);
      const id = new URL(route.request().url()).pathname.slice(1);
      if (id.startsWith("file-")) {
        // Exercise clicking before media metadata has arrived.
        await new Promise((resolve) => setTimeout(resolve, 700));
        const data =
          id === "file-3"
            ? fs.readFileSync(path.join(__dirname, "fixtures/seek.webm"))
            : wav;
        const range = /bytes=(\d+)-(\d*)/.exec(
          route.request().headers().range || "",
        );
        const start = range ? Number(range[1]) : 0;
        const end =
          range && range[2]
            ? Math.min(Number(range[2]), data.length - 1)
            : data.length - 1;
        return route.fulfill({
          status: range ? 206 : 200,
          contentType: id === "file-3" ? "video/webm" : "audio/wav",
          headers: {
            "Accept-Ranges": "bytes",
            ...(range
              ? { "Content-Range": `bytes ${start}-${end}/${data.length}` }
              : {}),
          },
          body: data.subarray(start, end + 1),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "text/plain",
        body: JSON.stringify({
          text: "测试转写内容",
          segments: [
            { start_ms: 0, end_ms: 2000, text: "测试转写内容" },
            { start_ms: 3000, end_ms: 6000, text: "点击这段文字跳转" },
            ...Array.from({ length: 30 }, (_, i) => ({
              start_ms: 6000 + i * 50,
              end_ms: 6050 + i * 50,
              text: `跟随测试字幕 ${i}`,
            })),
          ],
        }),
      });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.locator("[name=email]").fill("test@example.com");
    await page.locator("[name=password]").fill("password");
    await page.locator("#auth-submit").click();
    await page.waitForFunction(
      () => document.querySelector("#stat-tasks").textContent === "47",
    );
    await page.locator("#auto-refresh").uncheck();
    assert.equal(await page.locator("#table-body tr").count(), 20);
    await page.locator("#next").click();
    await page.locator("#next").click();
    assert.equal(await page.locator("#table-body tr").count(), 7);
    assert.match(await page.locator("#list-count").innerText(), /47/);
    await page.locator("#search").fill("task-0");
    assert.equal(await page.locator("#table-body tr").count(), 1);
    assert.equal(await page.locator("#table-body img").count(), 0);
    // The task name opens the transcript in one click, with metadata collapsed.
    await page.locator('.name-link[data-action="read"]').click();
    await page.locator("#result-body .transcript").waitFor();
    assert.match(
      await page.locator("#result-body .transcript").innerText(),
      /测试转写内容/,
    );
    assert.equal(
      await page.locator(".reader-metadata").getAttribute("open"),
      null,
    );
    assert.equal(
      await page.locator("#detail-title").innerText(),
      files[0].file_name,
    );
    await page.locator("#result-player").waitFor();
    assert.equal(
      await page.locator("#result-player").evaluate((el) => el.tagName),
      "AUDIO",
    );
    await page.getByText("点击这段文字跳转", { exact: true }).click();
    await page.waitForFunction(() => {
      const p = document.querySelector("#result-player");
      return p && !p.paused && p.currentTime >= 3 && p.currentTime < 6;
    });
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-seek="3"]')
          .getAttribute("aria-current") === "true",
    );
    assert.equal(
      await page.locator('[data-seek="3"]').getAttribute("aria-current"),
      "true",
    );
    await page.locator("#result-player").evaluate((el) => el.pause());
    await page.locator('[data-seek="0"]').focus();
    await page.keyboard.press("Enter");
    await page.waitForFunction(
      () =>
        document.querySelector("#result-player").currentTime < 2 &&
        !document.querySelector("#result-player").paused,
    );
    // Follow scrolls only the transcript; manual browsing suspends it until idle.
    await page.locator("#result-player").evaluate((el) => {
      el.pause();
      el.currentTime = 7.02;
    });

    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-seek="7"]')
          .getAttribute("aria-current") === "true",
    );
    assert.equal(await page.locator("#follow-delay").inputValue(), "5");
    await page.locator("#follow-now").click();
    await page.waitForFunction(
      () => document.querySelector(".transcript").scrollTop > 100,
    );
    const outerScroll = await page
      .locator("#detail")
      .evaluate((el) => el.scrollTop);
    await page.locator("#follow-delay").selectOption("3");
    await page.locator(".transcript").hover();
    await page.mouse.wheel(0, -2000);
    await page.waitForFunction(() =>
      document.querySelector("#follow-status").textContent.includes("浏览中"),
    );
    await page.waitForFunction(
      () => document.querySelector(".transcript").scrollTop < 5,
    );
    await page.waitForTimeout(1600);
    await page.mouse.wheel(0, -100);
    await page.waitForTimeout(1800);
    assert.match(await page.locator("#follow-status").innerText(), /浏览中/);
    assert.ok(
      await page.locator(".transcript").evaluate((el) => el.scrollTop < 5),
    );
    await page.waitForFunction(
      () => document.querySelector("#follow-status").textContent === "正在跟随",
    );
    assert.ok(
      await page.locator(".transcript").evaluate((el) => el.scrollTop > 100),
    );
    assert.equal(
      await page.locator("#detail").evaluate((el) => el.scrollTop),
      outerScroll,
    );
    // Explicit off stays off; immediate follow restores the active line.
    await page.locator("#follow-enabled").uncheck();
    await page.locator(".transcript").evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.waitForTimeout(3200);
    assert.equal(
      await page.locator("#follow-status").innerText(),
      "跟随已关闭",
    );
    assert.equal(
      await page.locator(".transcript").evaluate((el) => el.scrollTop),
      0,
    );
    await page.locator("#follow-now").click();
    assert.ok(
      await page.locator(".transcript").evaluate((el) => el.scrollTop > 100),
    );
    // Leave a pending resume timer when closing, to exercise disposal.
    await page.locator(".transcript").hover();
    await page.mouse.wheel(0, -100);
    await page.locator("#close-detail").click();
    await page.locator("#search").fill("task-3");
    await page
      .locator('.table-actions [data-action="read"][data-id="task-3"]')
      .first()
      .click();
    await page.locator("#result-player").waitFor();
    assert.equal(
      await page.locator("#result-player").evaluate((el) => el.tagName),
      "VIDEO",
    );
    await page.getByText("点击这段文字跳转", { exact: true }).click();
    await page.waitForFunction(() => {
      const p = document.querySelector("#result-player");
      return (
        p &&
        p.videoWidth === 160 &&
        !p.paused &&
        p.currentTime >= 3 &&
        p.currentTime < 6
      );
    });
    assert.equal(await page.locator("#follow-delay").inputValue(), "3");
    const video = await page.locator("#result-player").elementHandle();
    await page.locator("#close-detail").click();
    await page.waitForFunction((el) => el.paused, video);
    assert.equal(await video.evaluate((el) => el.paused), true);
    // Closing preserves the search, and the explicit details entry still works.
    assert.equal(await page.locator("#search").inputValue(), "task-3");
    await page.locator('[data-action="task"][data-id="task-3"]').click();
    await page.locator('[data-action="result"]').waitFor();
    assert.equal(await page.locator("#detail-title").innerText(), "任务详情");
    await page.locator('[data-action="result"]').click();
    await page.locator("#result-player").waitFor();
    await page.locator("#close-detail").click();
    await page.locator("[data-view=files]").click();
    await page.waitForFunction(() =>
      document.querySelector("#list-count").textContent.includes("65"),
    );
    await page.locator("#search").fill("file-64");
    assert.equal(await page.locator("#table-body tr").count(), 1);
    await page.locator("[data-action=file]").first().click();
    assert.match(await page.locator("#detail-content").innerText(), /录音 64/);
    await page.locator("[data-action=reuse]").click();
    await page.waitForFunction(() => location.hash === "#create");
    assert.equal(await page.locator("#existing-file").inputValue(), "file-64");
    await page.locator("#language").selectOption("zh");
    await page.locator("#create-submit").click();
    await page.waitForFunction(() =>
      document
        .querySelector("#detail-content")
        .textContent.includes("new-task"),
    );
    assert.deepEqual(
      JSON.parse(
        requests.find(([method, p]) => method === "POST" && p === "/tasks")[2],
      ),
      { input_file_id: "file-64", type: "transcribe", language: "zh" },
    );
    await page.locator("#close-detail").click();
    await page.locator("[data-view=create]").click();
    await page.locator('[data-source="upload"]').click();
    await page.locator("#file-input").setInputFiles({
      name: "new.wav",
      mimeType: "audio/wav",
      buffer: Buffer.from("wav"),
    });
    await page.locator("#create-submit").click();
    await page.waitForFunction(() =>
      document
        .querySelector("#detail-content")
        .textContent.includes("new-file"),
    );
    assert.ok(
      requests.some(
        ([method, p]) => method === "POST" && p === "/files/new-file/complete",
      ),
    );
    await page.locator("#close-detail").click();
    await page.locator("[data-view=files]").click();
    // The visible shortcut exposes recording without opening a dropdown.
    await page.locator("#record-entry").click();
    await page.locator("#record-start").waitFor({ state: "visible" });
    assert.equal(
      await page.locator('[data-source="record"]').getAttribute("aria-pressed"),
      "true",
    );
    assert.equal(await page.locator("#record-label").innerText(), "准备录音");
    // Real MediaRecorder encoding with Chromium's synthetic microphone only.
    assert.equal(await page.locator("#create-submit").isDisabled(), true);
    await page.evaluate(() => {
      const original = navigator.mediaDevices.getUserMedia.bind(
        navigator.mediaDevices,
      );
      window.testMicStreams = [];
      window.testDenyMic = true;
      navigator.mediaDevices.getUserMedia = async (constraints) => {
        if (window.testDenyMic) {
          window.testDenyMic = false;
          throw new DOMException("denied", "NotAllowedError");
        }
        const stream = await original(constraints);
        window.testMicStreams.push(stream);
        return stream;
      };
    });
    await page.locator("#record-start").click();
    await page.waitForFunction(() =>
      document
        .querySelector("#record-message")
        .textContent.includes("权限被拒绝"),
    );
    await page.locator("#record-start").click();
    await page.waitForFunction(
      () => document.querySelector("#record-label").textContent === "正在录音",
    );
    assert.equal(await page.locator("#create-submit").isDisabled(), true);
    await page.waitForTimeout(1200);
    await page.locator("#record-stop").click();
    await page.waitForFunction(
      () =>
        document.querySelector("#record-label").textContent === "录音已就绪",
    );
    assert.equal(
      await page.evaluate(() =>
        window.testMicStreams.every((s) =>
          s.getTracks().every((t) => t.readyState === "ended"),
        ),
      ),
      true,
    );
    await page.locator("#record-preview").evaluate((el) => el.play());
    await page.waitForFunction(
      () => document.querySelector("#record-preview").currentTime > 0,
    );
    await page.locator("#record-preview").evaluate((el) => el.pause());
    await page.locator("#record-start").click();
    await page.waitForFunction(
      () => document.querySelector("#record-label").textContent === "正在录音",
    );
    await page.waitForTimeout(1100);
    await page.locator('[data-view="tasks"]').click();
    await page.waitForFunction(
      () =>
        document.querySelector("#record-label").textContent === "录音已就绪",
    );
    assert.equal(
      await page.evaluate(() =>
        window.testMicStreams.every((s) =>
          s.getTracks().every((t) => t.readyState === "ended"),
        ),
      ),
      true,
    );
    await page.locator('[data-view="create"]').click();
    await page.locator("#create-submit").click();
    await page.waitForFunction(() =>
      document
        .querySelector("#detail-content")
        .textContent.includes("new-task"),
    );
    const recordingUpload = requests
      .filter(([method, p]) => method === "POST" && p === "/upload")
      .at(-1);
    assert.match(
      new URLSearchParams(recordingUpload[2]).get("filename"),
      /^recording-.*\.(webm|m4a|ogg)$/,
    );
    assert.equal(
      JSON.parse(
        requests
          .filter(([method, p]) => method === "POST" && p === "/tasks")
          .at(-1)[2],
      ).input_file_id,
      "new-file",
    );
    await page.locator("#close-detail").click();
    await page.locator('[data-view="create"]').click();
    await page.locator('[data-source="record"]').click();
    await page.locator("#record-clear").click();
    assert.equal(await page.locator("#record-preview").isHidden(), true);
    assert.equal(await page.locator("#create-submit").isDisabled(), true);
    await page.locator('[data-view="files"]').click();
    failFiles = true;
    await page.locator("#refresh").click();
    await page.waitForFunction(
      () => !document.querySelector("#refresh").disabled,
    );
    assert.match(await page.locator("#list-error").innerText(), /文件加载失败/);
    assert.equal(await page.locator("#table-body tr").count(), 20);
    failFiles = false;
    await page.locator("#refresh").click();
    await page.waitForFunction(
      () => document.querySelector("#list-error").hidden,
    );
    await page.screenshot({ path: "/tmp/vox-desktop.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await page.screenshot({ path: "/tmp/vox-mobile.png", fullPage: true });
    expired = true;
    await page.locator("#refresh").click();
    await page.locator("#auth").waitFor({ state: "visible" });
    assert.equal(await page.locator("#workspace").isVisible(), false);
    assert.equal(
      await page.evaluate(() => localStorage.getItem("vox_token")),
      null,
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS: login, full lists (47 tasks / 65 files), pagination, search, XSS escaping, details, transcript, file reuse, language, upload/complete/create, partial failure, recovery, responsive layout, session expiration; audio/video decoding and text/keyboard seeking before metadata, active highlighting, close stops playback; microphone recording, denial, preview, re-record, navigation cleanup, upload/task submission and deletion; no browser exceptions.",
    );
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
