/**
 * Codex API client.
 *
 * Extracted from background.js (architecture-review Candidate 1). This module
 * owns everything about talking to the ChatGPT/Codex backend: prompt-instruction
 * policy, request-body assembly, the model-fallback retry loop, and SSE/JSON
 * response parsing.
 *
 * It is deliberately free of any `chrome.*` API: the caller (background.js)
 * resolves the access token and account id up front and injects them, so the
 * whole module is unit-testable with only a fake `fetch`. The single side
 * effect anywhere in here is `fetch`.
 *
 * Behavior is a verbatim port of the previous inline implementation — no
 * behavior changes were made during extraction.
 */

const CHATGPT_API_URL = 'https://chatgpt.com/backend-api/codex/responses';

// Ordered list: the first entry is preferred, later entries are fallbacks used
// when the ChatGPT/Codex backend rejects a slug (e.g., after model retirement).
// See https://developers.openai.com/codex/models — gpt-5.4 retired 2026-08-31,
// with the mapping gpt-5.4 → gpt-5.6-terra and gpt-5.4-mini → gpt-5.6-luna.
const OPENAI_MODEL_CANDIDATES = ['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.5'];

/**
 * Pure. Classifies a non-ok response into a small enum the orchestrator uses to
 * decide how to react. Absorbs the previous `isModelUnsupportedError` heuristic
 * plus the `"Unsupported parameter"` 400 detection.
 *
 * @returns {'unsupported-param' | 'unsupported-model' | 'auth' | 'other'}
 */
function classifyResponseError(status, errText) {
  const t = (errText || '').toLowerCase();

  if (status === 400 && t.includes('unsupported parameter')) {
    return 'unsupported-param';
  }

  if (status === 400 && (
    t.includes('model_not_found') ||
    (t.includes('model') && (t.includes('is not supported') || t.includes('not available') || t.includes('not supported')))
  )) {
    return 'unsupported-model';
  }

  if (status === 401 || status === 403) {
    return 'auth';
  }

  return 'other';
}

/**
 * Pure. Builds the instruction string sent as the `instructions` field.
 * Verbatim port of the previous inline langInstruction + noiseFilter +
 * levelInstructions matrix.
 */
function buildInstructions(language = 'English', summaryLevel = 'short', tabCount = 1) {
  const langInstruction = `Output must be in ${language}.`;
  const noiseFilter = 'The text below is raw text extracted from a webpage. It may contain navigation, headers, footers, sidebars, ads, and other non-content elements. Identify the actual main content and summarize only that — ignore UI chrome, menus, links, and boilerplate.';
  const levelInstructions = {
    short: tabCount <= 1
      ? 'Summarize the page content in ONE very concise paragraph (max 80 words). Focus only on the core message. Return only the paragraph — no headings, no bullets, no extra text.'
      : 'For each page section marked "=== PAGE N ===", write ONE very concise paragraph (max 60 words) summarizing that page. Focus only on the core message. Separate each summary with "=== PAGE N ===" matching the input. No headings, no bullets, no extra text. Return only the summaries.',
    medium: tabCount <= 1
      ? 'Summarize the page content in ONE paragraph (max 120 words). Cover the main points and key takeaways. Return only the paragraph — no headings, no bullets, no extra text.'
      : 'For each page section marked "=== PAGE N ===", write ONE paragraph (max 100 words) summarizing that page. Cover the main points and key takeaways. Separate each summary with "=== PAGE N ===" matching the input. No headings, no bullets, no extra text. Return only the summaries.',
    detailed: tabCount <= 1
      ? 'Provide a detailed summary of the page content (max 300 words). Cover all important points, key details, and notable context. You may use multiple paragraphs. Return only the summary — no headings, no bullets, no extra text.'
      : 'For each page section marked "=== PAGE N ===", provide a detailed summary (max 250 words) covering all important points and key details. You may use multiple paragraphs per section. Separate each summary with "=== PAGE N ===" matching the input. No headings, no bullets, no extra text. Return only the summaries.'
  };
  return `${langInstruction} ${noiseFilter} ${levelInstructions[summaryLevel] || levelInstructions.short}`;
}

/**
 * Pure. Builds the JSON request-body string. Verbatim port of the previous
 * `buildBody` closure.
 */
function buildRequestBody(model, instructions, message, includeReasoning) {
  return JSON.stringify({
    model,
    instructions,
    input: [{
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: message }]
    }],
    ...(includeReasoning ? { reasoning: { effort: 'low' } } : {}),
    store: false,
    stream: true
  });
}

/**
 * Pure. Parses a single raw SSE line into an event object, or null when the
 * line carries no event (blank line, `:` comment, non-`data:` line, or a
 * `data:` payload that isn't valid JSON).
 *
 * Malformed `data:` payloads are tolerated: any JSON syntax error is swallowed
 * and the line is skipped. This matches how streaming SSE can deliver partial
 * or malformed chunks mid-stream. The check is on the error *type* (SyntaxError),
 * not the error *message*, so it's engine/version independent — earlier code
 * keyed on the substring "Unexpected token", which V8 stopped emitting for some
 * malformed inputs (e.g. Node 26 says "Expected property name or '}'"), causing
 * those lines to wrongly abort the whole stream. Non-syntax errors still throw.
 */
function parseSSEEvent(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(':')) return null;
  if (!trimmed.startsWith('data:')) return null;

  const dataStr = trimmed.substring(5).trim();
  try {
    return JSON.parse(dataStr);
  } catch (e) {
    if (e instanceof SyntaxError) {
      return null;
    }
    throw e;
  }
}

/**
 * Applies a parsed SSE event to the running accumulator. Shared inner logic of
 * the previous parseSSEStream / parseSSEText twins (verbatim).
 *
 * @param {object} event  event object from parseSSEEvent
 * @param {{ fullText: string, completed: boolean, receivedDeltas: boolean }} acc
 */
function applySSEEvent(event, acc) {
  const eventType = event.type;

  if (eventType === 'response.output_text.delta' && event.delta) {
    acc.fullText += event.delta;
    acc.receivedDeltas = true;
  } else if (eventType === 'response.output_item.done') {
    // Only use output_item.done text if we didn't receive deltas
    if (!acc.receivedDeltas) {
      const item = event.item;
      if (item && item.content) {
        for (const c of item.content) {
          if (c.text) acc.fullText += c.text;
        }
      }
    }
  } else if (eventType === 'response.completed') {
    acc.completed = true;
  } else if (eventType === 'response.error') {
    throw new Error(event.error?.message || 'Stream error');
  }
}

/**
 * Unified SSE reader. Accepts either a ReadableStream (response.body) or a
 * string (a full SSE payload). Replaces the previous parseSSEStream +
 * parseSSEText pair — same event handling, same fallback strings.
 */
async function parseSSEResponse(bodyOrText) {
  const acc = { fullText: '', completed: false, receivedDeltas: false };

  const handleLine = (line) => {
    const event = parseSSEEvent(line);
    if (event) applySSEEvent(event, acc);
  };

  if (typeof bodyOrText === 'string') {
    const lines = bodyOrText.split('\n');
    for (const line of lines) {
      handleLine(line);
    }
  } else {
    const reader = bodyOrText.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          handleLine(line);
        }

        if (acc.completed) break;
      }
    } finally {
      reader.releaseLock();
    }
  }

  if (!acc.fullText && !acc.completed) {
    return '[No content received from stream]';
  }

  return acc.fullText || '[Stream completed with no content]';
}

/**
 * Orchestrator. Builds the request, walks the model-fallback candidates, and
 * parses the response into summary text.
 *
 * The client is chrome.*-free: `accessToken` and `accountId` are resolved by
 * the caller and injected. The only side effect is `fetch`.
 *
 * @param {object}            params
 * @param {string}            params.message        the user message (page contents)
 * @param {number}            params.tabCount       number of tabs (affects prompt)
 * @param {string}            params.accessToken    ChatGPT OAuth access token
 * @param {string|null}       params.accountId      ChatGPT-Account-ID, or null
 * @param {string}            [params.language]     output language
 * @param {string}            [params.summaryLevel] short | medium | detailed
 * @param {AbortSignal|null}  [params.signal]       abort signal
 * @param {string[]}          [params.modelCandidates] override model list (tests)
 * @param {string}            [params.apiUrl]       override endpoint (tests)
 * @returns {Promise<string>} the summary text
 */
async function summarizeViaCodex({
  message,
  tabCount,
  accessToken,
  accountId,
  language = 'English',
  summaryLevel = 'short',
  signal = null,
  modelCandidates = OPENAI_MODEL_CANDIDATES,
  apiUrl = CHATGPT_API_URL
}) {
  console.log('[API] Using account_id:', accountId);

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${accessToken}`
  };

  // Add ChatGPT-Account-ID header if we have it
  if (accountId) {
    headers['ChatGPT-Account-ID'] = accountId;
  }

  const instructions = buildInstructions(language, summaryLevel, tabCount);

  let response = null;
  let lastErrText = '';
  let lastStatus = 0;

  for (let i = 0; i < modelCandidates.length; i++) {
    const model = modelCandidates[i];
    console.log(`[API] Requesting with model: ${model}`);
    response = await fetch(apiUrl, {
      method: 'POST',
      headers,
      body: buildRequestBody(model, instructions, message, true),
      signal
    });

    if (response.ok) break;

    let errText = await response.text();
    lastErrText = errText;
    lastStatus = response.status;

    // Retry the same model without optional params (existing behavior).
    if (classifyResponseError(response.status, errText) === 'unsupported-param') {
      console.log('[API] Retrying without optional params...');
      response = await fetch(apiUrl, {
        method: 'POST',
        headers,
        body: buildRequestBody(model, instructions, message, false),
        signal
      });
      if (response.ok) break;
      lastErrText = await response.text();
      lastStatus = response.status;
    }

    // If the backend rejected the slug itself, try the next candidate.
    if (classifyResponseError(lastStatus, lastErrText) === 'unsupported-model' && i < modelCandidates.length - 1) {
      console.log(`[API] Model ${model} rejected, trying ${modelCandidates[i + 1]}`);
      continue;
    }

    // Not a recoverable model-slug error — surface it to the caller.
    console.error('[API] Error response:', lastStatus, lastErrText.substring(0, 500));
    if (lastStatus === 401 || lastStatus === 403) {
      throw new Error('Authentication failed. Please reconnect to ChatGPT.');
    }
    throw new Error(`API error (${lastStatus}): ${lastErrText.substring(0, 200)}`);
  }

  if (!response || !response.ok) {
    console.error('[API] Error response:', lastStatus, lastErrText.substring(0, 500));
    if (lastStatus === 401 || lastStatus === 403) {
      throw new Error('Authentication failed. Please reconnect to ChatGPT.');
    }
    throw new Error(`API error (${lastStatus}): ${lastErrText.substring(0, 200)}`);
  }

  // Check if response is SSE (streaming)
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('text/event-stream')) {
    console.log('[API] Detected SSE content-type, using stream parser');
    return parseSSEResponse(response.body);
  }

  // Try JSON first, but fall back to SSE if body starts with "event:" or "data:"
  const rawText = await response.text();
  console.log('[API] Response text preview:', rawText.substring(0, 100));

  if (rawText.startsWith('event:') || rawText.startsWith('data:')) {
    console.log('[API] Response is SSE format despite JSON content-type, using stream parser');
    return parseSSEResponse(rawText);
  }

  try {
    const data = JSON.parse(rawText);
    console.log('[API] Response keys:', Object.keys(data));

    if (data.output_text) {
      return data.output_text;
    }

    if (data.output && Array.isArray(data.output)) {
      for (const item of data.output) {
        if (item.content && Array.isArray(item.content)) {
          for (const content of item.content) {
            if (content.text) {
              return content.text;
            }
          }
        }
      }
    }

    return JSON.stringify(data, null, 2);
  } catch (e) {
    console.error('[API] JSON parse error:', e.message);
    throw new Error(`Failed to parse API response: ${e.message}`);
  }
}

export {
  CHATGPT_API_URL,
  OPENAI_MODEL_CANDIDATES,
  summarizeViaCodex,
  buildInstructions,
  buildRequestBody,
  parseSSEEvent,
  parseSSEResponse,
  classifyResponseError
};
