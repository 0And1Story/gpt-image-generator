const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");
const express = require("express");
const dotenv = require("dotenv");
const OpenAI = require("openai");

dotenv.config();

const envPath = path.join(__dirname, ".env");
const envFileConfig = fs.existsSync(envPath) ? dotenv.parse(fs.readFileSync(envPath, "utf8")) : {};

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }
  return undefined;
}

const app = express();
const port = Number(String(firstDefined(envFileConfig.PORT, process.env.PORT, 3000)).trim());
const apiKey = firstDefined(
  envFileConfig.OPENAI_API_KEY,
  envFileConfig.API_KEY,
  process.env.OPENAI_API_KEY,
  process.env.API_KEY
);
const apiKeySource = firstDefined(envFileConfig.OPENAI_API_KEY, envFileConfig.API_KEY)
  ? ".env"
  : firstDefined(process.env.OPENAI_API_KEY, process.env.API_KEY)
    ? "process.env"
    : "missing";
const apiBaseURL = String(firstDefined(envFileConfig.API_BASE_URL, process.env.API_BASE_URL, "") || "").trim();
const apiBaseURLSource = firstDefined(envFileConfig.API_BASE_URL, process.env.API_BASE_URL)
  ? envFileConfig.API_BASE_URL
    ? ".env"
    : "process.env"
  : "default";
const client = apiKey
  ? new OpenAI({
      apiKey,
      baseURL: apiBaseURL || undefined
    })
  : null;

const DATA_DIR = path.join(__dirname, "data");
const IMAGE_DIR = path.join(DATA_DIR, "images");
const REQUEST_DIR = path.join(DATA_DIR, "requests");
const HISTORY_FILE = path.join(DATA_DIR, "history.json");

const SIZE_PRESETS = [
  { value: "1024x1024", label: "方形 1024x1024" },
  { value: "1536x1024", label: "横图 1536x1024" },
  { value: "1024x1536", label: "竖图 1024x1536" },
  { value: "2048x2048", label: "2K方形 2048x2048" },
  { value: "2048x1152", label: "2K横图 2048x1152" },
  { value: "1152x2048", label: "2K竖图 1152x2048" },
  { value: "3840x3840", label: "4K方形 3840x3840" },
  { value: "3840x2160", label: "4K横图 3840x2160" },
  { value: "2160x3840", label: "4K竖图 2160x3840" },
  { value: "auto", label: "自动" },
  { value: "custom", label: "自定义尺寸" }
];

const SIZE_OPTIONS = new Set(SIZE_PRESETS.map((item) => item.value).filter((value) => value !== "custom"));
const QUALITY_OPTIONS = new Set(["auto", "low", "medium", "high"]);
const FORMAT_OPTIONS = new Set(["png", "jpeg", "webp"]);
const BACKGROUND_OPTIONS = new Set(["auto", "opaque"]);
const MODERATION_OPTIONS = new Set(["auto", "low"]);
let historyWriteQueue = Promise.resolve();

app.use(express.json({ limit: "2mb" }));
app.use("/images", express.static(IMAGE_DIR));
app.use(express.static(path.join(__dirname, "public")));

function createId() {
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, "");
  const random = Math.random().toString(36).slice(2, 8);
  return `${timestamp}-${random}`;
}

function sanitizePrompt(prompt) {
  return String(prompt || "").trim();
}

function sanitizeHeaders(headers) {
  if (!headers || typeof headers.forEach !== "function") {
    return headers || null;
  }

  const collected = {};
  headers.forEach((value, key) => {
    collected[key] = value;
  });
  return collected;
}

function getRequestIdFromResponse(response) {
  if (!response || typeof response !== "object") {
    return null;
  }

  return response._request_id || response.request_id || null;
}

function simplifyStreamEvent(event) {
  if (!event || typeof event !== "object") {
    return event;
  }

  return {
    type: event.type || null,
    created_at: event.created_at || null,
    partial_image_index: event.partial_image_index ?? null,
    background: event.background || null,
    size: event.size || null,
    quality: event.quality || null,
    output_format: event.output_format || null,
    has_b64_json: Boolean(event.b64_json),
    has_url: Boolean(event.url),
    url: event.url || null,
    usage: event.usage || null,
    rawKeys: Object.keys(event)
  };
}

function simplifyImageObject(image) {
  if (!image || typeof image !== "object") {
    return image;
  }

  return {
    has_b64_json: Boolean(image.b64_json),
    has_url: Boolean(image.url),
    url: image.url || null,
    revised_prompt: image.revised_prompt || null,
    rawKeys: Object.keys(image)
  };
}

function logGenerationError({ id, createdAt, requestPayload, recordRequest, responseDebug, error }) {
  const baseLog = {
    id,
    createdAt,
    requestPayload,
    recordRequest,
    responseDebug: responseDebug || null,
    message: error && error.message ? error.message : "Unknown error",
    name: error && error.name ? error.name : "Error"
  };

  if (error instanceof OpenAI.APIError) {
    console.error(
      "[gpt-image-2] OpenAI API request failed",
      JSON.stringify(
        {
          ...baseLog,
          status: error.status || null,
          requestID: error.requestID || error.request_id || null,
          code: error.code || null,
          param: error.param || null,
          type: error.type || null,
          headers: sanitizeHeaders(error.headers),
          errorBody: error.error || null,
          stack: error.stack || null
        },
        null,
        2
      )
    );
    return;
  }

  console.error(
    "[gpt-image-2] Image generation failed",
    JSON.stringify(
      {
        ...baseLog,
        stack: error && error.stack ? error.stack : null
      },
      null,
      2
    )
  );
}

function parseInteger(value) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (Number.isInteger(value)) {
    return value;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function parseBoolean(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }

    if (normalized === "false") {
      return false;
    }
  }

  return fallback;
}

function normalizeSize(input) {
  const selectedSize = String(input.size || "").trim();
  const customSize = String(input.customSize || "").trim().toLowerCase();

  if (selectedSize === "custom") {
    if (!/^\d+x\d+$/.test(customSize)) {
      throw new Error("customSize must use WIDTHxHEIGHT format, e.g. 1536x864.");
    }

    const [widthRaw, heightRaw] = customSize.split("x");
    const width = Number.parseInt(widthRaw, 10);
    const height = Number.parseInt(heightRaw, 10);

    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      throw new Error("customSize width and height must be positive integers.");
    }

    if (width % 16 !== 0 || height % 16 !== 0) {
      throw new Error("customSize width and height must both be divisible by 16.");
    }

    const ratio = width / height;
    if (ratio < 1 / 3 || ratio > 3) {
      throw new Error("customSize aspect ratio must stay between 1:3 and 3:1.");
    }

    if (width > 3840 || height > 3840) {
      throw new Error("customSize width and height must not exceed 3840.");
    }

    return {
      size: `${width}x${height}`,
      customSize: `${width}x${height}`
    };
  }

  return {
    size: SIZE_OPTIONS.has(selectedSize) ? selectedSize : "1024x1024",
    customSize: null
  };
}

function normalizeSettings(input) {
  const prompt = sanitizePrompt(input.prompt);
  const { size, customSize } = normalizeSize(input);
  const quality = QUALITY_OPTIONS.has(String(input.quality || "").trim())
    ? String(input.quality).trim()
    : "auto";
  const outputFormat = FORMAT_OPTIONS.has(String(input.outputFormat || "").trim())
    ? String(input.outputFormat).trim()
    : "png";
  const background = BACKGROUND_OPTIONS.has(String(input.background || "").trim())
    ? String(input.background).trim()
    : "auto";
  const moderation = MODERATION_OPTIONS.has(String(input.moderation || "").trim())
    ? String(input.moderation).trim()
    : "auto";
  const outputCompression = parseInteger(input.outputCompression);
  const n = parseInteger(input.n) ?? 1;
  const partialImages = parseInteger(input.partialImages);
  const stream = parseBoolean(input.stream, false);
  const user = String(input.user || "").trim() || undefined;

  if (!prompt) {
    throw new Error("Prompt is required.");
  }

  if (n < 1 || n > 10) {
    throw new Error("n must be between 1 and 10.");
  }

  if (outputFormat !== "png") {
    if (!Number.isFinite(outputCompression) || outputCompression < 0 || outputCompression > 100) {
      throw new Error("outputCompression must be between 0 and 100.");
    }
  }

  if (stream) {
    if (partialImages === undefined) {
      throw new Error("partialImages is required when stream is enabled.");
    }

    if (partialImages < 0 || partialImages > 3) {
      throw new Error("partialImages must be between 0 and 3.");
    }
  }

  if (!stream && partialImages !== undefined) {
    throw new Error("partialImages can only be used when stream is enabled.");
  }

  return {
    prompt,
    size,
    customSize,
    quality,
    outputFormat,
    background,
    moderation,
    outputCompression: outputFormat === "png" ? undefined : outputCompression,
    n,
    stream,
    partialImages,
    user
  };
}

async function ensureStorage() {
  await fsp.mkdir(IMAGE_DIR, { recursive: true });
  await fsp.mkdir(REQUEST_DIR, { recursive: true });

  try {
    await fsp.access(HISTORY_FILE, fs.constants.F_OK);
  } catch {
    await fsp.writeFile(HISTORY_FILE, "[]\n", "utf8");
  }
}

async function readHistory() {
  try {
    const content = await fsp.readFile(HISTORY_FILE, "utf8");
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function appendHistory(entry) {
  historyWriteQueue = historyWriteQueue.then(async () => {
    const history = await readHistory();
    history.unshift(entry);
    await fsp.writeFile(HISTORY_FILE, JSON.stringify(history, null, 2), "utf8");
  });

  await historyWriteQueue;
}

async function saveRecord(record) {
  const requestRecordPath = path.join(REQUEST_DIR, `${record.id}.json`);
  await fsp.writeFile(requestRecordPath, JSON.stringify(record, null, 2), "utf8");
  await appendHistory(record);
}

async function saveRecordSafely(record) {
  try {
    await saveRecord(record);
  } catch (error) {
    console.error("Failed to persist request record.", error);
  }
}

async function downloadImageFromUrl(url, filePath) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download image from URL: ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  await fsp.writeFile(filePath, buffer);
}

async function persistGeneratedImages(id, images, outputFormat) {
  const extension = outputFormat === "jpeg" ? "jpg" : outputFormat;
  const savedImages = [];

  for (let index = 0; index < images.length; index += 1) {
    const image = images[index];
    if (!image) {
      continue;
    }

    let imageUrl = null;
    let imagePath = null;
    let sourceType = null;

    if (image.b64_json) {
      const suffix = images.length > 1 ? `-${index + 1}` : "";
      const fileName = `${id}${suffix}.${extension}`;
      const filePath = path.join(IMAGE_DIR, fileName);
      const imageBuffer = Buffer.from(image.b64_json, "base64");

      await fsp.writeFile(filePath, imageBuffer);
      imageUrl = `/images/${fileName}`;
      imagePath = path.relative(__dirname, filePath).replace(/\\/g, "/");
      sourceType = "b64_json";
    } else if (image.url) {
      const suffix = images.length > 1 ? `-${index + 1}` : "";
      const fileName = `${id}${suffix}.${extension}`;
      const filePath = path.join(IMAGE_DIR, fileName);

      try {
        await downloadImageFromUrl(image.url, filePath);
        imageUrl = `/images/${fileName}`;
        imagePath = path.relative(__dirname, filePath).replace(/\\/g, "/");
        sourceType = "url_downloaded";
      } catch (error) {
        console.error(
          "[gpt-image-2] Failed to download image URL, falling back to remote URL",
          JSON.stringify(
            {
              id,
              index,
              url: image.url,
              message: error && error.message ? error.message : "Unknown download error",
              stack: error && error.stack ? error.stack : null
            },
            null,
            2
          )
        );
        imageUrl = image.url;
        imagePath = null;
        sourceType = "url_remote_fallback";
      }
    } else {
      continue;
    }

    savedImages.push({
      index,
      imageUrl,
      imagePath,
      sourceType,
      revisedPrompt: image.revised_prompt || null
    });
  }

  return savedImages;
}

async function collectStreamedImages(stream) {
  const finalImages = [];
  const partialEvents = [];
  let completedEvent = null;
  const allEvents = [];

  for await (const event of stream) {
    allEvents.push(simplifyStreamEvent(event));

    if (event.type === "image_generation.partial_image") {
      partialEvents.push({
        partialImageIndex: event.partial_image_index,
        createdAt: event.created_at,
        size: event.size,
        quality: event.quality,
        outputFormat: event.output_format
      });
      continue;
    }

    if (event.type === "image_generation.completed") {
      completedEvent = event;
      finalImages.push({
        b64_json: event.b64_json,
        url: event.url || null
      });
    }
  }

  return {
    images: finalImages,
    partialEvents,
    completedEvent,
    allEvents
  };
}

function buildRequestPayload(settings) {
  const payload = {
    model: "gpt-image-2",
    prompt: settings.prompt,
    size: settings.size,
    quality: settings.quality,
    output_format: settings.outputFormat,
    background: settings.background,
    moderation: settings.moderation,
    n: settings.n
  };

  if (settings.outputCompression !== undefined) {
    payload.output_compression = settings.outputCompression;
  }

  if (settings.user) {
    payload.user = settings.user;
  }

  if (settings.stream) {
    payload.stream = true;
    payload.partial_images = settings.partialImages;
  }

  return payload;
}

function buildRecordRequest(settings) {
  return {
    model: "gpt-image-2",
    apiBaseUrl: apiBaseURL || null,
    prompt: settings.prompt,
    size: settings.size,
    customSize: settings.customSize,
    quality: settings.quality,
    outputFormat: settings.outputFormat,
    outputCompression: settings.outputCompression ?? null,
    background: settings.background,
    moderation: settings.moderation,
    n: settings.n,
    stream: settings.stream,
    partialImages: settings.partialImages ?? null,
    user: settings.user || null
  };
}

function buildSuccessResponseRecord({
  mode,
  requestId,
  settings,
  rawResponse,
  streamMeta,
  responseDebug,
  savedImages
}) {
  if (mode === "stream") {
    const events = Array.isArray(responseDebug && responseDebug.events) ? responseDebug.events : [];
    const partialEvents = streamMeta && Array.isArray(streamMeta.partialEvents) ? streamMeta.partialEvents : [];

    return {
      mode: "stream",
      requestId: requestId || null,
      status: 200,
      created: streamMeta && streamMeta.completedEvent ? streamMeta.completedEvent.createdAt : null,
      size: streamMeta && streamMeta.completedEvent ? streamMeta.completedEvent.size : settings.size,
      quality: streamMeta && streamMeta.completedEvent ? streamMeta.completedEvent.quality : settings.quality,
      outputFormat:
        streamMeta && streamMeta.completedEvent ? streamMeta.completedEvent.outputFormat : settings.outputFormat,
      background:
        streamMeta && streamMeta.completedEvent ? streamMeta.completedEvent.background : settings.background,
      stream: true,
      imageCount: savedImages.length,
      imageSources: savedImages.map((image) => image.sourceType),
      eventCount: events.length,
      eventTypes: events.map((event) => event.type || "unknown"),
      partialEventCount: partialEvents.length,
      partialEvents,
      usage: streamMeta && streamMeta.completedEvent ? streamMeta.completedEvent.usage : null,
      debug: responseDebug || null
    };
  }

  const images = rawResponse && Array.isArray(rawResponse.data) ? rawResponse.data : [];
  return {
    mode: "non-stream",
    requestId: requestId || null,
    status: 200,
    created: rawResponse && rawResponse.created ? rawResponse.created : null,
    size: rawResponse && rawResponse.size ? rawResponse.size : settings.size,
    quality: rawResponse && rawResponse.quality ? rawResponse.quality : settings.quality,
    outputFormat: rawResponse && rawResponse.output_format ? rawResponse.output_format : settings.outputFormat,
    background: rawResponse && rawResponse.background ? rawResponse.background : settings.background,
    stream: false,
    imageCount: savedImages.length,
    imageSources: savedImages.map((image) => image.sourceType),
    usage: rawResponse && rawResponse.usage ? rawResponse.usage : null,
    images: images.map((image) => simplifyImageObject(image)),
    debug: responseDebug || null
  };
}

function buildErrorResponseRecord({ requestId, responseDebug, error }) {
  return {
    mode: responseDebug && responseDebug.mode ? responseDebug.mode : null,
    requestId:
      (responseDebug && responseDebug.requestId) ||
      (error instanceof OpenAI.APIError ? error.requestID || error.request_id || null : null),
    status: error instanceof OpenAI.APIError ? error.status || null : null,
    errorType: error instanceof OpenAI.APIError ? error.type || null : null,
    code: error instanceof OpenAI.APIError ? error.code || null : null,
    param: error instanceof OpenAI.APIError ? error.param || null : null,
    headers: error instanceof OpenAI.APIError ? sanitizeHeaders(error.headers) : null,
    body: error instanceof OpenAI.APIError ? error.error || null : null,
    debug: responseDebug || null
  };
}

app.get("/api/config", (_req, res) => {
  res.json({
    sizeOptions: SIZE_PRESETS,
    qualityOptions: ["auto", "low", "medium", "high"],
    formatOptions: ["png", "jpeg", "webp"],
    backgroundOptions: ["auto", "opaque"],
    moderationOptions: ["auto", "low"],
    nOptions: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    partialImageOptions: [0, 1, 2, 3],
    apiKeyConfigured: Boolean(apiKey),
    apiBaseUrlConfigured: Boolean(apiBaseURL),
    apiBaseUrl: apiBaseURL || null
  });
});

app.get("/api/history", async (_req, res) => {
  const history = await readHistory();
  res.json(history);
});

app.post("/api/generate", async (req, res) => {
  const id = createId();
  const createdAt = new Date().toISOString();
  let requestPayload = null;
  let recordRequest = null;
  let responseDebug = null;

  try {
    const settings = normalizeSettings(req.body || {});
    if (!client) {
      throw new Error("Missing OPENAI_API_KEY in environment.");
    }

    requestPayload = buildRequestPayload(settings);
    recordRequest = buildRecordRequest(settings);

    let rawResponse = null;
    let savedImages = [];
    let streamMeta = null;
    let requestId = null;

    if (settings.stream) {
      const streamedResponse = await client.images.generate(requestPayload).withResponse();
      const stream = streamedResponse.data;
      requestId = streamedResponse.request_id || null;
      const streamed = await collectStreamedImages(stream);
      responseDebug = {
        mode: "stream",
        requestId,
        events: streamed.allEvents
      };

      if (!streamed.images.length) {
        throw new Error("The API did not return an image.");
      }

      savedImages = await persistGeneratedImages(id, streamed.images, settings.outputFormat);
      streamMeta = {
        partialEvents: streamed.partialEvents,
        completedEvent: streamed.completedEvent
          ? {
            createdAt: streamed.completedEvent.created_at,
            background: streamed.completedEvent.background,
            size: streamed.completedEvent.size,
            quality: streamed.completedEvent.quality,
            outputFormat: streamed.completedEvent.output_format,
            usage: streamed.completedEvent.usage || null
          }
          : null
      };
    } else {
      rawResponse = await client.images.generate(requestPayload);
      requestId = getRequestIdFromResponse(rawResponse);
      const images = Array.isArray(rawResponse.data) ? rawResponse.data : [];
      responseDebug = {
        mode: "non-stream",
        requestId,
        rawResponse: {
          created: rawResponse && rawResponse.created ? rawResponse.created : null,
          background: rawResponse && rawResponse.background ? rawResponse.background : null,
          size: rawResponse && rawResponse.size ? rawResponse.size : null,
          quality: rawResponse && rawResponse.quality ? rawResponse.quality : null,
          output_format: rawResponse && rawResponse.output_format ? rawResponse.output_format : null,
          data: images.map((image) => simplifyImageObject(image))
        }
      };

      if (!images.length) {
        throw new Error("The API did not return an image.");
      }

      savedImages = await persistGeneratedImages(id, images, settings.outputFormat);
    }

    const firstImage = savedImages[0] || null;
    const responseRecord = buildSuccessResponseRecord({
      mode: settings.stream ? "stream" : "non-stream",
      requestId,
      settings,
      rawResponse,
      streamMeta,
      responseDebug,
      savedImages
    });
    const record = {
      id,
      createdAt,
      status: "success",
      request: recordRequest,
      result: {
        imageUrl: firstImage ? firstImage.imageUrl : null,
        imagePath: firstImage ? firstImage.imagePath : null,
        revisedPrompt: firstImage ? firstImage.revisedPrompt : null,
        images: savedImages,
        imageCount: savedImages.length
      },
      response: responseRecord,
      apiResponse: responseRecord,
      requestId
    };

    await saveRecord(record);
    res.json(record);
  } catch (error) {
    const message = error.message || "Image generation failed.";
    logGenerationError({
      id,
      createdAt,
      requestPayload,
      recordRequest,
      responseDebug,
      error
    });

    const record = {
      id,
      createdAt,
      status: "error",
      request: recordRequest || {
        model: "gpt-image-2",
        apiBaseUrl: apiBaseURL || null,
        prompt: sanitizePrompt(req.body && req.body.prompt),
        size: String((req.body && req.body.size) || ""),
        customSize: String((req.body && req.body.customSize) || ""),
        quality: String((req.body && req.body.quality) || ""),
        outputFormat: String((req.body && req.body.outputFormat) || ""),
        outputCompression:
          req.body && req.body.outputCompression !== undefined ? req.body.outputCompression : null,
        background: String((req.body && req.body.background) || ""),
        moderation: String((req.body && req.body.moderation) || ""),
        n: req.body && req.body.n !== undefined ? req.body.n : null,
        stream: req.body && req.body.stream !== undefined ? req.body.stream : null,
        partialImages: req.body && req.body.partialImages !== undefined ? req.body.partialImages : null,
        user: String((req.body && req.body.user) || "")
      },
      response: buildErrorResponseRecord({
        requestId: responseDebug && responseDebug.requestId ? responseDebug.requestId : null,
        responseDebug,
        error
      }),
      result: null,
      error: {
        message,
        name: error && error.name ? error.name : "Error",
        status: error instanceof OpenAI.APIError ? error.status || null : null,
        requestID: error instanceof OpenAI.APIError ? error.requestID || error.request_id || null : null,
        code: error instanceof OpenAI.APIError ? error.code || null : null,
        param: error instanceof OpenAI.APIError ? error.param || null : null,
        type: error instanceof OpenAI.APIError ? error.type || null : null
      }
    };

    await saveRecordSafely(record);

    const statusCode = /required|between 0 and 100|WIDTHxHEIGHT|divisible by 16|aspect ratio|must not exceed 3840|n must be between 1 and 10|partialImages/i.test(
      message
    )
      ? 400
      : /missing openai_api_key/i.test(message)
        ? 503
        : 500;

    res.status(statusCode).json({
      error: message,
      id,
      createdAt
    });
  }
});

app.use((req, res) => {
  if (req.path.startsWith("/api/")) {
    res.status(404).json({ error: "Not found." });
    return;
  }

  res.sendFile(path.join(__dirname, "public", "index.html"));
});

ensureStorage()
  .then(() => {
    app.listen(port, () => {
      console.log(
        `Config loaded: apiKeySource=${apiKeySource}, apiBaseURLSource=${apiBaseURLSource}, apiBaseURL=${apiBaseURL || "<default>"}`
      );
      console.log(`Server listening on http://localhost:${port}`);
    });
  })
  .catch((error) => {
    console.error("Failed to initialize storage.", error);
    process.exit(1);
  });
