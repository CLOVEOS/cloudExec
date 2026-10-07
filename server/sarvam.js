// Minimal Sarvam AI client (https://docs.sarvam.ai).
// - Chat:      POST /v1/chat/completions   (model: sarvam-105b, OpenAI-style body)
// - Translate: POST /translate             (sarvam-translate:v1, 22 Indian languages)
// Auth header: `api-subscription-key`.
const config = require("./config");

// Languages offered in the UI (BCP-47 codes as Sarvam expects them).
const UI_LANGUAGES = {
  "en-IN": "English",
  "hi-IN": "Hindi",
  "bn-IN": "Bengali",
  "ta-IN": "Tamil",
  "te-IN": "Telugu",
  "kn-IN": "Kannada",
  "ml-IN": "Malayalam",
  "mr-IN": "Marathi",
  "gu-IN": "Gujarati",
  "pa-IN": "Punjabi",
  "od-IN": "Odia",
};

class SarvamError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function isConfigured() {
  return Boolean(config.sarvam.apiKey);
}

async function post(path, body, fetchImpl = globalThis.fetch) {
  if (!isConfigured()) throw new SarvamError("SARVAM_API_KEY is not set", 503);
  const res = await fetchImpl(`${config.sarvam.baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-subscription-key": config.sarvam.apiKey,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(config.sarvam.timeoutMs),
  });
  const text = await res.text();
  if (!res.ok) throw new SarvamError(`Sarvam ${path} failed (${res.status}): ${text.slice(0, 300)}`, res.status);
  return JSON.parse(text);
}

/** Extract the first JSON object from a model reply (tolerates ```json fences / stray prose). */
function parseJsonReply(content) {
  if (!content) throw new Error("Empty model reply");
  const cleaned = content.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/```(?:json)?/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end <= start) throw new Error("Model reply contained no JSON object");
    return JSON.parse(cleaned.slice(start, end + 1));
  }
}

/** One chat call; returns parsed JSON or throws with finish_reason for diagnosis. */
async function chatOnce(body, fetchImpl) {
  const res = await post("/v1/chat/completions", body, fetchImpl);
  const choice = res.choices?.[0] || {};
  const msg = choice.message || {};
  try {
    // Some replies leave `content` empty and put everything in reasoning_content.
    return { data: parseJsonReply(msg.content || msg.reasoning_content), usage: res.usage || {}, model: res.model || body.model };
  } catch (e) {
    const err = new Error(
      `${e.message} (finish_reason=${choice.finish_reason}, completion_tokens=${res.usage?.completion_tokens ?? "?"})`
    );
    err.truncated = choice.finish_reason === "length";
    throw err;
  }
}

/**
 * Chat completion that must return a JSON object.
 *
 * sarvam-105b reasons before answering and those tokens count against
 * max_tokens. Reasoning is set to SARVAM_REASONING_EFFORT (default "low");
 * if the model still runs out of budget before writing the answer, or the
 * API rejects the setting, we retry once with reasoning disabled.
 * @returns {Promise<{data: object, usage: object, model: string}>}
 */
async function chatJson({ system, user, maxTokens = config.sarvam.maxTokens, temperature = 0.2 }, fetchImpl) {
  const body = {
    model: config.sarvam.chatModel,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature,
    max_tokens: maxTokens,
    response_format: { type: "json_object" },
  };
  const effort = config.sarvam.reasoningEffort;
  if (effort !== "default") body.reasoning_effort = effort === "none" ? null : effort;

  try {
    return await chatOnce(body, fetchImpl);
  } catch (e) {
    const retryable = e.truncated || (e instanceof SarvamError && e.status === 400);
    if (!retryable || body.reasoning_effort === null) throw e;
    console.warn(`Sarvam: retrying with reasoning disabled (${e.message.slice(0, 120)})`);
    return chatOnce({ ...body, reasoning_effort: null }, fetchImpl);
  }
}

/** Translate text, chunking on paragraph boundaries to respect the 2000-char limit. */
async function translate(text, targetLanguage, { sourceLanguage = "en-IN", fetchImpl } = {}) {
  if (!text || targetLanguage === "en-IN") return text;
  const limit = 1900;
  const chunks = [];
  let current = "";
  for (const para of text.split(/\n/)) {
    if ((current + "\n" + para).length > limit && current) {
      chunks.push(current);
      current = para;
    } else {
      current = current ? current + "\n" + para : para;
    }
  }
  if (current) chunks.push(current);

  const out = [];
  for (const chunk of chunks) {
    const res = await post(
      "/translate",
      {
        input: chunk.slice(0, 2000),
        source_language_code: sourceLanguage,
        target_language_code: targetLanguage,
        model: config.sarvam.translateModel,
      },
      fetchImpl
    );
    out.push(res.translated_text ?? "");
  }
  return out.join("\n");
}

module.exports = { UI_LANGUAGES, SarvamError, isConfigured, chatJson, translate, parseJsonReply };
