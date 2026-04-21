import { FormEvent, useEffect, useMemo, useState } from "react";

type Model = {
  id: string;
  owned_by?: string;
  object?: string;
};

type ModelsResponse = {
  data?: Model[];
};

type CheckStatus = "idle" | "checking" | "available" | "unavailable";

type CheckResult = {
  modelId: string;
  status: CheckStatus;
  firstTokenLatencyMs: number | null;
};

type CheckResponse = {
  available: true;
  firstTokenLatencyMs: number | null;
};

const STORAGE_KEY = "check-your-api-form";
const PROXY_ERROR_MESSAGE =
  "连不上当前站点的 API 服务。开发环境先运行 `npm run dev`，生产环境确认服务已经正常部署。";

const defaultForm = {
  baseUrl: "",
  apiKey: "",
  concurrency: "5",
  prompt: "Hi"
};

function loadStoredForm() {
  const stored = localStorage.getItem(STORAGE_KEY);

  if (!stored) {
    return defaultForm;
  }

  try {
    const parsed = JSON.parse(stored) as Partial<typeof defaultForm>;

    return {
      baseUrl: parsed.baseUrl ?? "",
      apiKey: parsed.apiKey ?? "",
      concurrency: parsed.concurrency ?? "5",
      prompt: parsed.prompt ?? "Hi"
    };
  } catch {
    return defaultForm;
  }
}

function normalizeBaseUrl(url: string) {
  return url.trim().replace(/\/+$/, "");
}

function parseConcurrency(value: string) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "未知错误";
}

function isModelsResponse(payload: unknown): payload is ModelsResponse {
  return typeof payload === "object" && payload !== null && "data" in payload;
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

async function requestProxy<T>(path: string, body: Record<string, unknown>) {
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    const payload = await parseJsonSafe(response);

    if (!response.ok) {
      if (
        typeof payload === "object" &&
        payload !== null &&
        "error" in payload &&
        typeof (payload as { error?: unknown }).error === "string"
      ) {
        throw new Error((payload as { error: string }).error);
      }

      throw new Error(
        typeof payload === "string" ? payload : `本地代理请求失败，HTTP ${response.status}`
      );
    }

    return payload as T;
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(PROXY_ERROR_MESSAGE);
    }

    throw error;
  }
}

export default function App() {
  const [form, setForm] = useState(loadStoredForm);
  const [models, setModels] = useState<Model[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [checkingModels, setCheckingModels] = useState(false);
  const [fetchError, setFetchError] = useState("");
  const [checkResults, setCheckResults] = useState<Record<string, CheckResult>>({});

  const resolvedBaseUrl = useMemo(() => normalizeBaseUrl(form.baseUrl), [form.baseUrl]);

  const availableCount = useMemo(
    () =>
      Object.values(checkResults).filter((item) => item.status === "available").length,
    [checkResults]
  );

  const unavailableCount = useMemo(
    () =>
      Object.values(checkResults).filter((item) => item.status === "unavailable").length,
    [checkResults]
  );

  useEffect(() => {
    const root = document.documentElement;
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frameId = 0;

    const target = { x: 0, y: 0 };
    const current = { x: 0, y: 0 };

    const syncBackground = () => {
      current.x += (target.x - current.x) * 0.08;
      current.y += (target.y - current.y) * 0.08;

      root.style.setProperty("--pointer-x", current.x.toFixed(4));
      root.style.setProperty("--pointer-y", current.y.toFixed(4));

      if (
        Math.abs(target.x - current.x) > 0.001 ||
        Math.abs(target.y - current.y) > 0.001
      ) {
        frameId = window.requestAnimationFrame(syncBackground);
      } else {
        frameId = 0;
      }
    };

    const queueSync = () => {
      if (frameId === 0) {
        frameId = window.requestAnimationFrame(syncBackground);
      }
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (mediaQuery.matches) {
        return;
      }

      const nextX = event.clientX / window.innerWidth - 0.5;
      const nextY = event.clientY / window.innerHeight - 0.5;

      target.x = nextX;
      target.y = nextY;
      queueSync();
    };

    const handlePointerLeave = () => {
      target.x = 0;
      target.y = 0;
      queueSync();
    };

    const handleReducedMotionChange = (event: MediaQueryListEvent) => {
      if (!event.matches) {
        return;
      }

      target.x = 0;
      target.y = 0;
      current.x = 0;
      current.y = 0;
      root.style.setProperty("--pointer-x", "0");
      root.style.setProperty("--pointer-y", "0");

      if (frameId !== 0) {
        window.cancelAnimationFrame(frameId);
        frameId = 0;
      }
    };

    root.style.setProperty("--pointer-x", "0");
    root.style.setProperty("--pointer-y", "0");

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerleave", handlePointerLeave);
    mediaQuery.addEventListener("change", handleReducedMotionChange);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerleave", handlePointerLeave);
      mediaQuery.removeEventListener("change", handleReducedMotionChange);

      if (frameId !== 0) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, []);

  const persistForm = (nextForm: typeof form) => {
    setForm(nextForm);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextForm));
  };

  const updateCheckResult = (
    modelId: string,
    patch: Partial<CheckResult> & Pick<CheckResult, "status">
  ) => {
    setCheckResults((current) => ({
      ...current,
      [modelId]: {
        ...current[modelId],
        modelId,
        firstTokenLatencyMs: null,
        ...patch
      }
    }));
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
  };

  const fetchModels = async () => {
    if (!resolvedBaseUrl || !form.apiKey.trim()) {
      setFetchError("先填 base url 和 key。");
      return;
    }

    setFetchingModels(true);
    setFetchError("");
    setCheckResults({});

    try {
      const payload = await requestProxy<ModelsResponse>("/api/models", {
        baseUrl: resolvedBaseUrl,
        apiKey: form.apiKey.trim()
      });

      const nextModels = isModelsResponse(payload) && Array.isArray(payload.data)
        ? payload.data.filter((item: Model): item is Model => typeof item?.id === "string")
        : [];

      setModels(nextModels);

      if (nextModels.length === 0) {
        setFetchError("接口返回成功，但没拿到任何模型。");
      }
    } catch (error) {
      setModels([]);
      setFetchError(getErrorMessage(error));
    } finally {
      setFetchingModels(false);
    }
  };

  const checkOneModel = async (modelId: string) => {
    return requestProxy<CheckResponse>("/api/check", {
      baseUrl: resolvedBaseUrl,
      apiKey: form.apiKey.trim(),
      model: modelId,
      prompt: form.prompt.trim()
    });
  };

  const batchCheckModels = async () => {
    if (models.length === 0 || checkingModels) {
      return;
    }

    const concurrency = parseConcurrency(form.concurrency);

    if (!concurrency) {
      setFetchError("并发数必须是大于 0 的整数。");
      return;
    }

    if (!form.prompt.trim()) {
      setFetchError("请求内容不能为空。");
      return;
    }

    setCheckingModels(true);
    setFetchError("");
    setCheckResults(
      Object.fromEntries(
        models.map((model) => [
          model.id,
          {
            modelId: model.id,
            status: "idle",
            firstTokenLatencyMs: null
          }
        ])
      )
    );

    try {
      const queue = [...models];
      const workerCount = Math.min(concurrency, queue.length);

      await Promise.all(
        Array.from({ length: workerCount }, async () => {
          while (queue.length > 0) {
            const model = queue.shift();

            if (!model) {
              return;
            }

            updateCheckResult(model.id, {
              status: "checking",
              firstTokenLatencyMs: null
            });

            try {
              const result = await checkOneModel(model.id);
              updateCheckResult(model.id, {
                status: "available",
                firstTokenLatencyMs: result.firstTokenLatencyMs
              });
            } catch {
              updateCheckResult(model.id, {
                status: "unavailable",
                firstTokenLatencyMs: null
              });
            }
          }
        })
      );
    } finally {
      setCheckingModels(false);
    }
  };

  return (
    <main className="shell">
      <div className="backdrop backdrop-a" />
      <div className="backdrop backdrop-b" />

      <section className="hero">
        <p className="eyebrow">check-your-api</p>
        <h1>批量测活面板</h1>
        <p className="subtitle">
          面向 OpenAI 兼容 API 的批量检测。
        </p>
      </section>

      <section className="panel">
        <form className="form" onSubmit={handleSubmit}>
          <label className="field">
            <span>API Base URL</span>
            <input
              placeholder="https://example.com/v1"
              value={form.baseUrl}
              onChange={(event) =>
                persistForm({
                  ...form,
                  baseUrl: event.target.value
                })
              }
            />
          </label>

          <label className="field">
            <span>API Key</span>
            <input
              type="password"
              placeholder="sk-..."
              value={form.apiKey}
              onChange={(event) =>
                persistForm({
                  ...form,
                  apiKey: event.target.value
                })
              }
            />
          </label>

          <div className="control-row">
            <label className="field field-compact">
              <span>并发数</span>
              <input
                type="number"
                min="1"
                step="1"
                inputMode="numeric"
                placeholder="5"
                value={form.concurrency}
                onChange={(event) =>
                  persistForm({
                    ...form,
                    concurrency: event.target.value.replace(/[^\d]/g, "")
                  })
                }
              />
            </label>

            <div className="actions actions-inline">
              <button
                type="button"
                onClick={fetchModels}
                disabled={fetchingModels || checkingModels}
              >
                {fetchingModels ? "获取中..." : "获取可用模型"}
              </button>

              <button
                type="button"
                className="secondary"
                onClick={batchCheckModels}
                disabled={fetchingModels || checkingModels || models.length === 0}
              >
                {checkingModels ? "检测中..." : "批量检测"}
              </button>
            </div>
          </div>

          <label className="field">
            <span>请求内容</span>
            <input
              placeholder="Hi"
              value={form.prompt}
              onChange={(event) =>
                persistForm({
                  ...form,
                  prompt: event.target.value
                })
              }
            />
          </label>
        </form>

        <div className="stats">
          <div className="stat-card">
            <span>模型总数</span>
            <strong>{models.length}</strong>
          </div>
          <div className="stat-card">
            <span>可用</span>
            <strong>{availableCount}</strong>
          </div>
          <div className="stat-card">
            <span>不可用</span>
            <strong>{unavailableCount}</strong>
          </div>
        </div>
      </section>

      {fetchError ? <section className="notice error">{fetchError}</section> : null}

      <section className="panel">
        <div className="section-head">
          <h2>模型列表</h2>
          <p>按当前并发数批量测活</p>
        </div>

        {models.length === 0 ? (
          <div className="empty">还没有模型。先点“获取可用模型”。</div>
        ) : (
          <div className="model-grid">
            {models.map((model, index) => {
              const result = checkResults[model.id];

              return (
                <article className="model-card" key={model.id}>
                  <div className="model-card-top">
                    <span className="model-index">{String(index + 1).padStart(2, "0")}</span>
                    <span className={`badge badge-${result?.status ?? "idle"}`}>
                      {result?.status === "checking"
                        ? "检测中"
                        : result?.status === "available"
                          ? "可用"
                          : result?.status === "unavailable"
                            ? "不可用"
                            : "未检测"}
                    </span>
                  </div>

                  <h3>{model.id}</h3>
                  <p className="meta">
                    {model.owned_by ? `owned by ${model.owned_by}` : "未提供所有者信息"}
                  </p>
                  {result?.status === "available" ? (
                    <p className="latency">
                      首字延迟{" "}
                      {typeof result.firstTokenLatencyMs === "number"
                        ? `${result.firstTokenLatencyMs} ms`
                        : "未获取到"}
                    </p>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
