export type Model = {
  id: string;
  owned_by?: string;
  object?: string;
};

export type ModelsResponse = {
  data?: Model[];
};

export type CheckResponse = {
  available: true;
  firstTokenLatencyMs: number | null;
};

export type JsonHandlerResult = {
  status: number;
  body: {
    error?: string;
    data?: Model[];
    available?: true;
    firstTokenLatencyMs?: number | null;
  };
};

const REQUEST_TIMEOUT_MS = 30_000;

class ValidationError extends Error {}

function normalizeBaseUrl(url: string) {
  return url.trim().replace(/\/+$/, "");
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function createTimeoutSignal(timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timer)
  };
}

async function parseJsonSafe(response: Response) {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    if (error.name === "AbortError") {
      return `上游请求超时，超过 ${REQUEST_TIMEOUT_MS}ms 还没返回。`;
    }

    return error.message;
  }

  return "未知错误";
}

function getErrorStatus(error: unknown, fallbackStatus: number) {
  if (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number"
  ) {
    return error.status;
  }

  return fallbackStatus;
}

function requireString(value: unknown, fieldName: string) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ValidationError(`${fieldName} 不能为空。`);
  }

  return value.trim();
}

function parseRequestBody(body: unknown) {
  if (typeof body === "string") {
    try {
      return parseRequestBody(JSON.parse(body) as unknown);
    } catch {
      throw new ValidationError("请求体不是合法的 JSON。");
    }
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ValidationError("请求体必须是 JSON 对象。");
  }

  return body as Record<string, unknown>;
}

async function requestUpstream(pathname: string, init: RequestInit) {
  const { signal, cleanup } = createTimeoutSignal(REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(pathname, {
      ...init,
      signal
    });

    const payload = await parseJsonSafe(response);

    if (!response.ok) {
      const errorMessage =
        typeof payload === "string"
          ? payload
          : `上游接口返回 HTTP ${response.status}${payload ? `: ${JSON.stringify(payload)}` : ""}`;

      return {
        ok: false as const,
        status: response.status,
        error: errorMessage
      };
    }

    return {
      ok: true as const,
      status: response.status,
      payload
    };
  } finally {
    cleanup();
  }
}

function hasTextContent(value: unknown) {
  if (typeof value === "string") {
    return value.length > 0;
  }

  if (!Array.isArray(value)) {
    return false;
  }

  return value.some((item) => {
    if (typeof item === "string") {
      return item.length > 0;
    }

    if (typeof item !== "object" || item === null) {
      return false;
    }

    if ("text" in item && typeof item.text === "string") {
      return item.text.length > 0;
    }

    return false;
  });
}

function hasFirstToken(payload: unknown) {
  if (typeof payload !== "object" || payload === null || !("choices" in payload)) {
    return false;
  }

  const { choices } = payload as { choices?: unknown };

  if (!Array.isArray(choices)) {
    return false;
  }

  return choices.some((choice) => {
    if (typeof choice !== "object" || choice === null) {
      return false;
    }

    const candidate = choice as {
      delta?: { content?: unknown };
      message?: { content?: unknown };
      text?: unknown;
    };

    return (
      hasTextContent(candidate.delta?.content) ||
      hasTextContent(candidate.message?.content) ||
      hasTextContent(candidate.text)
    );
  });
}

async function checkModelAvailability(
  pathname: string,
  init: RequestInit
): Promise<CheckResponse> {
  const { signal, cleanup } = createTimeoutSignal(REQUEST_TIMEOUT_MS);
  const startedAt = performance.now();

  try {
    const response = await fetch(pathname, {
      ...init,
      signal
    });

    if (!response.ok) {
      const payload = await parseJsonSafe(response);
      const errorMessage =
        typeof payload === "string"
          ? payload
          : `上游接口返回 HTTP ${response.status}${payload ? `: ${JSON.stringify(payload)}` : ""}`;

      throw Object.assign(new Error(errorMessage), { status: response.status });
    }

    if (!response.body) {
      return {
        available: true,
        firstTokenLatencyMs: null
      };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let firstTokenLatencyMs: number | null = null;
    const getEventBoundary = (value: string) => {
      const lfIndex = value.indexOf("\n\n");
      const crlfIndex = value.indexOf("\r\n\r\n");

      if (lfIndex === -1) {
        return crlfIndex === -1 ? null : { index: crlfIndex, length: 4 };
      }

      if (crlfIndex === -1 || lfIndex < crlfIndex) {
        return { index: lfIndex, length: 2 };
      }

      return { index: crlfIndex, length: 4 };
    };

    const consumeEvent = (rawEvent: string) => {
      for (const rawLine of rawEvent.split(/\r?\n/)) {
        const line = rawLine.trim();

        if (!line.startsWith("data:")) {
          continue;
        }

        const data = line.slice(5).trim();

        if (!data || data === "[DONE]") {
          continue;
        }

        try {
          const payload = JSON.parse(data) as unknown;

          if (hasFirstToken(payload)) {
            firstTokenLatencyMs = Math.round(performance.now() - startedAt);
            return true;
          }
        } catch {
          continue;
        }
      }

      return false;
    };

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        buffer += decoder.decode();
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      let boundary = getEventBoundary(buffer);

      while (boundary) {
        const rawEvent = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary.length);

        if (consumeEvent(rawEvent)) {
          await reader.cancel();

          return {
            available: true,
            firstTokenLatencyMs
          };
        }

        boundary = getEventBoundary(buffer);
      }
    }

    if (buffer && consumeEvent(buffer)) {
      return {
        available: true,
        firstTokenLatencyMs
      };
    }

    return {
      available: true,
      firstTokenLatencyMs
    };
  } finally {
    cleanup();
  }
}

export async function handleModelsRequest(body: unknown): Promise<JsonHandlerResult> {
  try {
    const requestBody = parseRequestBody(body);
    const baseUrl = normalizeBaseUrl(requireString(requestBody.baseUrl, "baseUrl"));
    const apiKey = requireString(requestBody.apiKey, "apiKey");

    if (!isHttpUrl(baseUrl)) {
      return {
        status: 400,
        body: {
          error: "baseUrl 必须是合法的 http/https 地址。"
        }
      };
    }

    const upstream = await requestUpstream(`${baseUrl}/models`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      }
    });

    if (!upstream.ok) {
      return {
        status: upstream.status,
        body: {
          error: upstream.error
        }
      };
    }

    const payload = upstream.payload as ModelsResponse | null;

    return {
      status: 200,
      body: {
        data: Array.isArray(payload?.data)
          ? payload.data.filter((item): item is Model => typeof item?.id === "string")
          : []
      }
    };
  } catch (error) {
    return {
      status: error instanceof ValidationError ? 400 : 502,
      body: {
        error: getErrorMessage(error)
      }
    };
  }
}

export async function handleCheckRequest(body: unknown): Promise<JsonHandlerResult> {
  try {
    const requestBody = parseRequestBody(body);
    const baseUrl = normalizeBaseUrl(requireString(requestBody.baseUrl, "baseUrl"));
    const apiKey = requireString(requestBody.apiKey, "apiKey");
    const model = requireString(requestBody.model, "model");
    const prompt = requireString(requestBody.prompt, "prompt");

    if (!isHttpUrl(baseUrl)) {
      return {
        status: 400,
        body: {
          error: "baseUrl 必须是合法的 http/https 地址。"
        }
      };
    }

    const result = await checkModelAvailability(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: prompt
          }
        ],
        stream: true,
        temperature: 0,
        max_tokens: 64
      })
    });

    return {
      status: 200,
      body: result
    };
  } catch (error) {
    return {
      status:
        error instanceof ValidationError
          ? 400
          : getErrorStatus(error, 502),
      body: {
        error: getErrorMessage(error)
      }
    };
  }
}
