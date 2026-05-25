const form = document.getElementById("generate-form");
const promptInput = document.getElementById("prompt");
const sizeInput = document.getElementById("size");
const qualityInput = document.getElementById("quality");
const outputFormatInput = document.getElementById("outputFormat");
const outputCompressionInput = document.getElementById("outputCompression");
const customSizeInput = document.getElementById("customSize");
const customSizeWrap = document.getElementById("custom-size-wrap");
const backgroundInput = document.getElementById("background");
const moderationInput = document.getElementById("moderation");
const nInput = document.getElementById("n");
const streamInput = document.getElementById("stream");
const partialImagesInput = document.getElementById("partialImages");
const partialImagesWrap = document.getElementById("partial-images-wrap");
const userInput = document.getElementById("user");
const submitButton = document.getElementById("submit-button");
const statusBox = document.getElementById("status");
const envStatusBox = document.getElementById("env-status");
const latestResult = document.getElementById("latest-result");
const historyList = document.getElementById("history-list");
const refreshHistoryButton = document.getElementById("refresh-history");

function setStatus(message, isError = false) {
  statusBox.textContent = message;
  statusBox.classList.toggle("error", isError);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDate(value) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }

  if (typeof value === "number") {
    return new Date(value * 1000).toLocaleString("zh-CN");
  }

  try {
    return new Date(value).toLocaleString("zh-CN");
  } catch {
    return String(value);
  }
}

function buildImagesHtml(images) {
  if (!Array.isArray(images) || !images.length) {
    return "";
  }

  return `
    <div class="image-list">
      ${images
        .map(
          (image, index) => `
            <figure class="image-item">
              <img src="${image.imageUrl}" alt="Generated image ${index + 1}" />
              <figcaption>第 ${index + 1} 张</figcaption>
            </figure>
          `
        )
        .join("")}
    </div>
  `;
}

function buildResponseSummary(item) {
  const response = item.response || item.apiResponse || null;
  if (!response) {
    return '<div><strong>响应摘要：</strong><code>-</code></div>';
  }

  const usage = response.usage
    ? `input=${response.usage.input_tokens ?? "-"}, output=${response.usage.output_tokens ?? "-"}, total=${response.usage.total_tokens ?? "-"}`
    : "-";
  const eventTypes = Array.isArray(response.eventTypes) && response.eventTypes.length
    ? response.eventTypes.join(", ")
    : "-";
  const imageSources = Array.isArray(response.imageSources) && response.imageSources.length
    ? response.imageSources
        .map((source) => {
          if (source === "b64_json") {
            return "base64本地保存";
          }
          if (source === "url_downloaded") {
            return "远程URL已下载";
          }
          if (source === "url_remote_fallback") {
            return "远程URL未落盘";
          }
          return source;
        })
        .join(", ")
    : "-";

  return `
    <div><strong>响应模式：</strong><code>${escapeHtml(response.mode || "-")}</code></div>
    <div><strong>响应状态：</strong><code>${escapeHtml(String(response.status ?? "-"))}</code></div>
    <div><strong>请求 ID：</strong><code>${escapeHtml(response.requestId || "-")}</code></div>
    <div><strong>返回尺寸：</strong><code>${escapeHtml(response.size || "-")}</code></div>
    <div><strong>返回质量：</strong><code>${escapeHtml(response.quality || "-")}</code></div>
    <div><strong>返回格式：</strong><code>${escapeHtml(response.outputFormat || "-")}</code></div>
    <div><strong>图片来源：</strong><code>${escapeHtml(imageSources)}</code></div>
    <div><strong>事件数量：</strong><code>${escapeHtml(String(response.eventCount ?? "-"))}</code></div>
    <div><strong>事件类型：</strong><code>${escapeHtml(eventTypes)}</code></div>
    <div><strong>Usage：</strong><code>${escapeHtml(usage)}</code></div>
  `;
}

function renderCard(item, { compact = false } = {}) {
  if (item.status === "error") {
    const responseSummary = buildResponseSummary(item);
    return `
      <article class="${compact ? "history-card" : "result-card"} error-card">
        <div class="meta">
          <div><strong>时间：</strong>${escapeHtml(formatDate(item.createdAt))}</div>
          <div><strong>状态：</strong><code>error</code></div>
          <div><strong>提示词：</strong><span class="prompt-text">${escapeHtml(item.request.prompt || "-")}</span></div>
          <div><strong>尺寸：</strong><code>${escapeHtml(item.request.customSize || item.request.size || "-")}</code></div>
          <div><strong>错误：</strong><span class="prompt-text">${escapeHtml(item.error?.message || "未知错误")}</span></div>
          ${responseSummary}
        </div>
      </article>
    `;
  }

  const images = item.result?.images || [];
  const sizeText = item.request.customSize || item.request.size;
  const revisedPrompts = images
    .filter((image) => image.revisedPrompt)
    .map(
      (image, index) =>
        `<div><strong>修订提示词 ${index + 1}：</strong><span class="prompt-text">${escapeHtml(image.revisedPrompt)}</span></div>`
    )
    .join("");
  const streamText = item.request.stream ? `已启用，partial_images=${item.request.partialImages}` : "未启用";
  const responseSummary = buildResponseSummary(item);

  return `
    <article class="${compact ? "history-card" : "result-card"}">
      ${buildImagesHtml(images)}
      <div class="meta">
        <div><strong>时间：</strong>${escapeHtml(formatDate(item.createdAt))}</div>
        <div><strong>尺寸：</strong><code>${escapeHtml(sizeText)}</code></div>
        <div><strong>质量：</strong><code>${escapeHtml(item.request.quality)}</code></div>
        <div><strong>格式：</strong><code>${escapeHtml(item.request.outputFormat)}</code></div>
        <div><strong>背景：</strong><code>${escapeHtml(item.request.background)}</code></div>
        <div><strong>审核：</strong><code>${escapeHtml(item.request.moderation)}</code></div>
        <div><strong>张数：</strong><code>${escapeHtml(String(item.request.n))}</code></div>
        <div><strong>流式：</strong><code>${escapeHtml(streamText)}</code></div>
        <div><strong>压缩：</strong><code>${escapeHtml(String(item.request.outputCompression ?? "-"))}</code></div>
        <div><strong>用户标识：</strong><code>${escapeHtml(item.request.user || "-")}</code></div>
        <div><strong>API_BASE_URL：</strong><code>${escapeHtml(item.request.apiBaseUrl || "-")}</code></div>
        <div><strong>提示词：</strong><span class="prompt-text">${escapeHtml(item.request.prompt)}</span></div>
        ${responseSummary}
        ${revisedPrompts}
      </div>
    </article>
  `;
}

function renderLatest(item) {
  latestResult.innerHTML = item ? renderCard(item) : '<div class="empty-state">还没有生成记录。</div>';
}

function renderHistory(items) {
  if (!items.length) {
    historyList.innerHTML = '<div class="empty-state">还没有历史记录。</div>';
    return;
  }

  historyList.innerHTML = items.map((item) => renderCard(item, { compact: true })).join("");
}

function fillSelect(select, options, fallbackValue) {
  select.innerHTML = options
    .map((option) => {
      const value = typeof option === "string" || typeof option === "number" ? option : option.value;
      const label = typeof option === "string" || typeof option === "number" ? option : option.label;
      return `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`;
    })
    .join("");

  const values = options.map((option) =>
    typeof option === "string" || typeof option === "number" ? String(option) : String(option.value)
  );

  if (fallbackValue !== undefined && values.includes(String(fallbackValue))) {
    select.value = String(fallbackValue);
  }
}

function syncCompressionState() {
  const disabled = outputFormatInput.value === "png";
  outputCompressionInput.disabled = disabled;
}

function syncCustomSizeState() {
  const enabled = sizeInput.value === "custom";
  customSizeWrap.classList.toggle("hidden", !enabled);
}

function syncStreamState() {
  const enabled = streamInput.checked;
  partialImagesWrap.classList.toggle("hidden", !enabled);
}

async function loadConfig() {
  const response = await fetch("/api/config");
  const config = await response.json();

  fillSelect(sizeInput, config.sizeOptions, "1024x1024");
  fillSelect(qualityInput, config.qualityOptions, "auto");
  fillSelect(outputFormatInput, config.formatOptions, "png");
  fillSelect(backgroundInput, config.backgroundOptions, "auto");
  fillSelect(moderationInput, config.moderationOptions, "auto");
  fillSelect(nInput, config.nOptions, 1);
  fillSelect(partialImagesInput, config.partialImageOptions, 1);

  syncCompressionState();
  syncCustomSizeState();
  syncStreamState();

  envStatusBox.textContent = config.apiKeyConfigured
    ? `OPENAI_API_KEY 已配置。${config.apiBaseUrlConfigured ? ` 当前 API_BASE_URL：${config.apiBaseUrl}` : " 当前使用官方默认地址。"}`
    : "OPENAI_API_KEY 尚未配置，页面可打开，但生成请求会失败。";
  envStatusBox.classList.toggle("error", !config.apiKeyConfigured);
}

async function loadHistory() {
  const response = await fetch("/api/history");
  const items = await response.json();
  renderLatest(items[0]);
  renderHistory(items);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const payload = {
    prompt: promptInput.value,
    size: sizeInput.value,
    customSize: customSizeInput.value,
    quality: qualityInput.value,
    outputFormat: outputFormatInput.value,
    outputCompression: Number.parseInt(outputCompressionInput.value, 10),
    background: backgroundInput.value,
    moderation: moderationInput.value,
    n: Number.parseInt(nInput.value, 10),
    stream: streamInput.checked,
    partialImages: streamInput.checked ? Number.parseInt(partialImagesInput.value, 10) : undefined,
    user: userInput.value
  };

  submitButton.disabled = true;
  setStatus("图片生成中，请稍候...");

  try {
    const response = await fetch("/api/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || "生成失败");
    }

    renderLatest(result);
    await loadHistory();
    setStatus(`图片已生成并保存到本地，共 ${result.result?.imageCount || 0} 张。`);
  } catch (error) {
    setStatus(error.message || "生成失败", true);
  } finally {
    submitButton.disabled = false;
  }
});

refreshHistoryButton.addEventListener("click", async () => {
  setStatus("正在刷新历史记录...");

  try {
    await loadHistory();
    setStatus("历史记录已刷新。");
  } catch (error) {
    setStatus(error.message || "刷新失败", true);
  }
});

outputFormatInput.addEventListener("change", syncCompressionState);
sizeInput.addEventListener("change", syncCustomSizeState);
streamInput.addEventListener("change", syncStreamState);

Promise.all([loadConfig(), loadHistory()]).catch((error) => {
  setStatus(error.message || "页面初始化失败", true);
});
