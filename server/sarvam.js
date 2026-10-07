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

/**
 * Chat completion that must return a JSON object.
 * @returns {Promise<{data: object, usage: object, model: string}>}
 */
// sarvam-105b is a reasoning model: its thinking tokens count against max_tokens,
// so the budget must leave room for the final JSON answer after the reasoning.
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
  const res = await post("/v1/chat/completions", body, fetchImpl);
  const choice = res.choices?.[0] || {};
  const msg = choice.message || {};
  let data;
  try {
    // Some replies leave `content` empty and put everything in reasoning_content.
    data = parseJsonReply(msg.content || msg.reasoning_content);
  } catch (e) {
    throw new Error(
      `${e.message} (finish_reason=${choice.finish_reason}, completion_tokens=${res.usage?.completion_tokens ?? "?"})`
    );
  }
  return { data, usage: res.usage || {}, model: res.model || body.model };
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
