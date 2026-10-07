/* Media lifecycle is independent of transcript and vocabulary requests. */
(() => {
  "use strict";
  const MAX_BYTES = 64 * 1024 * 1024;
  // Re-encode decoded samples, never splice EBML headers or guess seek indexes.
  async function toWav(blob) {
    if (blob.size > MAX_BYTES)
      throw new Error("音频超过 64 MB，请下载原文件播放。");
    const context = new OfflineAudioContext(1, 1, 16000);
    const audio = await context.decodeAudioData(await blob.arrayBuffer());
    if (audio.duration > 1800)
      throw new Error("兼容播放支持 30 分钟以内的音频。");
    const buffer = new ArrayBuffer(44 + audio.length * 2);
    const view = new DataView(buffer);
    const write = (at, text) =>
      [...text].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
    write(0, "RIFF");
    view.setUint32(4, buffer.byteLength - 8, true);
    write(8, "WAVEfmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, audio.sampleRate, true);
    view.setUint32(28, audio.sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    write(36, "data");
    view.setUint32(40, audio.length * 2, true);
    const channels = Array.from({ length: audio.numberOfChannels }, (_, i) =>
      audio.getChannelData(i),
    );
    let peak = 0;
    for (let i = 0; i < audio.length; i++) {
      const sample = Math.max(
        -1,
        Math.min(
          1,
          channels.reduce((sum, c) => sum + c[i], 0) / channels.length,
        ),
      );
      peak = Math.max(peak, Math.abs(sample));
      view.setInt16(44 + i * 2, sample * (sample < 0 ? 32768 : 32767), true);
    }
    return {
      blob: new Blob([buffer], { type: "audio/wav" }),
      duration: audio.duration,
      peak,
    };
  }
  async function boundedBlob(url, signal) {
    const response = await fetch(url, { signal, credentials: "omit" });
    if (!response.ok)
      throw new Error(`音频读取失败（HTTP ${response.status}）`);
    if (Number(response.headers.get("content-length")) > MAX_BYTES)
      throw new Error("音频超过 64 MB。");
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_BYTES) throw new Error("音频超过 64 MB。");
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    return new Blob(chunks);
  }
  function mount({
    slot,
    video,
    getURL,
    legacyRecording = false,
    sourceLabel = "原始媒体",
    onUnsupported,
    onTime,
  }) {
    const shell = document.createElement("section");
    shell.className = "media-card";
    shell.innerHTML = `<div class="media-heading"><span class="eyebrow">${video ? "VIDEO" : "AUDIO"} / 回听</span><span class="media-format">${sourceLabel}</span></div>
      <div class="stage${video ? "" : " audio"}"><${video ? "video" : "audio"} controls preload="${video ? "metadata" : "auto"}" playsinline aria-label="转写原始媒体"></${video ? "video" : "audio"}><div class="cap" hidden></div></div>
      <div class="caption-words" aria-label="当前句生词" hidden></div>
      <div class="media-tools"><button type="button" data-skip="-10" aria-label="后退 10 秒">↶ 10s</button><button type="button" data-skip="10" aria-label="前进 10 秒">10s ↷</button><label>倍速 <select aria-label="播放速度"><option value="0.75">0.75×</option><option value="1" selected>1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2×</option></select></label><button type="button" class="media-unmute" hidden>开启声音</button></div>
      <div class="media-feedback"><span role="status" class="media-status">正在获取音频…</span><button type="button" class="media-retry" hidden>重新加载</button>${video ? "" : '<button type="button" class="media-compatible" title="完整读取音频并转换为可定位的 WAV，支持 64 MB / 30 分钟以内音频">兼容播放</button>'}</div>`;
    slot.replaceChildren(shell);
    const player = shell.querySelector("audio,video");
    const caption = shell.querySelector(".cap");
    const captionWords = shell.querySelector(".caption-words");
    const status = shell.querySelector(".media-status");
    const retry = shell.querySelector(".media-retry");
    const compatible = shell.querySelector(".media-compatible");
    const unmute = shell.querySelector(".media-unmute");
    let disposed = false,
      serial = 0,
      playSerial = 0,
      pending = null,
      wantPlay = false;
    let objectURL = "",
      controller = null,
      watchdog = null,
      automaticRetries = 0,
      loading = false;
    const setStatus = (text, error = false, canRetry = false) => {
      if (disposed) return;
      status.textContent = text;
      shell.dataset.state = error ? "error" : "ready";
      retry.hidden = !canRetry;
    };
    const stopWatch = () => clearTimeout(watchdog);
    const watch = () => {
      stopWatch();
      watchdog = setTimeout(
        () => setStatus("加载时间较长，可以重试或稍后播放。", false, true),
        15000,
      );
    };
    function applySeek() {
      if (pending === null || player.readyState < 1) return;
      const target = Number.isFinite(player.duration)
        ? Math.min(pending, Math.max(0, player.duration - 0.05))
        : pending;
      pending = null; // clear before currentTime can dispatch any new events
      try {
        player.currentTime = target;
      } catch {
        pending = target;
      }
    }
    async function play() {
      wantPlay = true;
      if (disposed || loading || !player.getAttribute("src")) return;
      const attempt = ++playSerial;
      try {
        applySeek();
        await player.play();
      } catch (e) {
        if (disposed || attempt !== playSerial || e.name === "AbortError")
          return;
        if (e.name === "NotAllowedError") {
          wantPlay = false;
          setStatus("浏览器需要一次点击，请按播放器的播放键。");
        } else {
          setStatus(
            "暂时无法播放，请重新加载；音频也可尝试兼容播放。",
            true,
            true,
          );
        }
      }
    }
    async function load(normalize = false) {
      const version = ++serial;
      ++playSerial;
      controller?.abort();
      controller = new AbortController();
      const signal = controller.signal;
      loading = true;
      if (pending === null && player.currentTime > 0)
        pending = player.currentTime;
      player.pause();
      player.removeAttribute("src");
      player.load();
      if (objectURL) URL.revokeObjectURL(objectURL);
      objectURL = "";
      setStatus(normalize ? "正在准备可跳转的音频，请稍候…" : "正在加载媒体…");
      watch();
      if (compatible) compatible.disabled = true;
      const currentController = controller;
      const timeout = setTimeout(() => currentController.abort(), 45000);
      try {
        let url = await getURL();
        if (disposed || version !== serial) return;
        if (normalize) {
          const result = await toWav(await boundedBlob(url, signal));
          if (disposed || version !== serial) return;
          objectURL = URL.createObjectURL(result.blob);
          url = objectURL;
          shell.querySelector(".media-format").textContent = "兼容音频";
        }
        if (signal.aborted) throw new Error("加载超时，请重新加载。");
        loading = false;
        player.src = url;
        player.load();
        // Preserve user intent across a refreshed URL; autoplay policies are handled above.
        if (wantPlay) play();
      } catch (e) {
        if (disposed || version !== serial) return;
        loading = false;
        stopWatch();
        setStatus(
          e.name === "AbortError"
            ? "加载超时，请重新加载。"
            : `加载失败：${e.message}`,
          true,
          true,
        );
      } finally {
        clearTimeout(timeout);
        if (!disposed && version === serial && compatible)
          compatible.disabled = false;
      }
    }
    function seek(seconds) {
      if (disposed || !Number.isFinite(seconds)) return;
      pending = Math.max(0, seconds);
      applySeek();
      play();
    }
    player.addEventListener("loadedmetadata", () => {
      applySeek();
      if (!Number.isFinite(player.duration))
        setStatus(
          "此文件未提供完整时长；跳转异常时可尝试兼容播放。",
          false,
          true,
        );
    });
    player.addEventListener("canplay", () => {
      stopWatch();
      applySeek();
      setStatus(
        player.paused ? "准备就绪 · 点击播放，或点选下方字幕回听" : "正在播放",
      );
    });
    player.addEventListener("playing", () => {
      wantPlay = true;
      stopWatch();
      setStatus("正在播放");
    });
    player.addEventListener("pause", () => {
      if (loading || disposed || player.error) return;
      wantPlay = false;
      ++playSerial;
      stopWatch();
      setStatus(player.ended ? "播放结束" : "已暂停");
    });
    player.addEventListener("ended", () => {
      wantPlay = false;
      setStatus("播放结束 · 可以选择任意一句再次回听");
    });
    for (const ev of ["waiting", "stalled", "seeking"])
      player.addEventListener(ev, () => {
        if (loading || disposed || player.error) return;
        setStatus(ev === "seeking" ? "正在定位…" : "正在缓冲…");
        watch();
      });
    for (const ev of ["timeupdate", "seeked", "ended"])
      player.addEventListener(ev, () => {
        if (!disposed) onTime(player.currentTime, player.ended);
        if (ev === "seeked") {
          stopWatch();
          setStatus(player.paused ? "已定位 · 点击播放开始回听" : "正在播放");
        }
      });
    player.addEventListener("error", () => {
      if (disposed || loading || !player.getAttribute("src")) return;
      stopWatch();
      if (!objectURL && automaticRetries++ === 0) {
        load(); // A presigned URL may expire while the page is open.
        return;
      }
      const code = player.error?.code;
      if ((code === 3 || code === 4) && onUnsupported) {
        onUnsupported({
          position: pending ?? player.currentTime,
          resume: wantPlay,
        });
        return;
      }
      wantPlay = false;
      setStatus(
        code === 3 || code === 4
          ? "浏览器无法解码此媒体，可下载原文件播放。"
          : "媒体连接失败，请检查网络后重新加载。",
        true,
        true,
      );
    });
    player.addEventListener("volumechange", () => {
      unmute.hidden = !player.muted && player.volume > 0;
    });
    unmute.onclick = () => {
      player.muted = false;
      player.volume = 1;
    };
    shell.querySelectorAll("[data-skip]").forEach((b) => {
      b.onclick = () =>
        seek((pending ?? player.currentTime) + Number(b.dataset.skip));
    });
    shell.querySelector("select").onchange = (e) => {
      player.playbackRate = Number(e.target.value);
    };
    retry.onclick = () => {
      automaticRetries = 0;
      load(false);
    };
    if (compatible) compatible.onclick = () => load(true);
    if (video) {
      const full = document.createElement("button");
      full.className = "media-full";
      full.textContent = "⛶ 全屏";
      full.onclick = async () => {
        try {
          if (document.fullscreenElement) await document.exitFullscreen();
          else if (shell.querySelector(".stage").requestFullscreen)
            await shell.querySelector(".stage").requestFullscreen();
          else player.webkitEnterFullscreen?.();
        } catch {
          setStatus("当前浏览器暂不支持全屏播放。");
        }
      };
      // Keep our fullscreen action out of the browser's native video control area.
      shell.querySelector(".media-tools").append(full);
      const exit = document.createElement("button");
      exit.className = "stage-exit";
      exit.textContent = "退出全屏";
      exit.onclick = full.onclick;
      shell.querySelector(".stage").append(exit);
    }
    load(legacyRecording);
    return {
      player,
      caption,
      captionWords,
      seek,
      destroy() {
        disposed = true;
        ++serial;
        ++playSerial;
        controller?.abort();
        stopWatch();
        player.pause();
        player.removeAttribute("src");
        player.load();
        if (objectURL) URL.revokeObjectURL(objectURL);
      },
    };
  }
  window.VoxMedia = { mount, toWav };
})();
