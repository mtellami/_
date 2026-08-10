export interface SanitizeOptions {
  maxChars: number;
  maxDepth: number;
  maxArrayLength: number;
  maxStringLength: number;
}

export interface SanitizeResult {
  text: string;
  truncated: boolean;
}

const TRUNCATION_SUFFIX = "…[truncated]";

interface WalkState {
  truncated: boolean;
  budget: number;
}

/**
 * Compacts and truncates an API response body before it is handed to the
 * LLM. JSON documents are walked with depth, array-length, string-length and
 * total-character budgets; non-JSON payloads fall back to plain truncation.
 */
export function sanitizeResponse(raw: string, options: SanitizeOptions): SanitizeResult {
  const { maxChars, maxDepth, maxArrayLength, maxStringLength } = options;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return truncatePlain(raw, maxChars, maxStringLength);
  }

  const state: WalkState = { truncated: false, budget: maxChars };
  const compacted = compact(parsed, maxDepth, maxArrayLength, maxStringLength, state, 0);
  const text = JSON.stringify(compacted);
  return { text, truncated: state.truncated };
}

function compact(
  value: unknown,
  maxDepth: number,
  maxArrayLength: number,
  maxStringLength: number,
  state: WalkState,
  depth: number,
): unknown {
  if (depth > maxDepth) {
    state.truncated = true;
    return undefined;
  }

  if (typeof value === "string") {
    let text = value;
    if (text.length > maxStringLength) {
      state.truncated = true;
      text = text.slice(0, maxStringLength) + TRUNCATION_SUFFIX;
    }
    state.budget -= text.length;
    return text;
  }

  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return value;
  }

  if (Array.isArray(value)) {
    if (value.length > maxArrayLength) {
      state.truncated = true;
    }
    const sliced = value.slice(0, maxArrayLength);
    return sliced.map((item) =>
      compact(item, maxDepth, maxArrayLength, maxStringLength, state, depth + 1),
    );
  }

  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (state.budget <= 0) {
        state.truncated = true;
        break;
      }
      result[key] = compact(item, maxDepth, maxArrayLength, maxStringLength, state, depth + 1);
    }
    return result;
  }

  return value;
}

function truncatePlain(raw: string, maxChars: number, maxStringLength: number): SanitizeResult {
  let truncated = false;
  let text = raw;
  if (text.length > maxStringLength) {
    text = text.slice(0, maxStringLength) + TRUNCATION_SUFFIX;
    truncated = true;
  }
  if (text.length > maxChars) {
    text = text.slice(0, maxChars) + TRUNCATION_SUFFIX;
    truncated = true;
  }
  return { text, truncated };
}
