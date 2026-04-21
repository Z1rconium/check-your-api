import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

type Model = {
  id: string;
  owned_by?: string;
  object?: string;
};

type ModelsResponse = {
  data?: Model[];
};

type CheckStatus = "idle" | "checking" | "available" | "unavailable";
type ResultFilter = "all" | "available" | "unavailable" | "pending";
type FieldName = keyof typeof defaultForm;
type FieldErrors = Partial<Record<FieldName, string>>;
type InputElement = HTMLInputElement | HTMLTextAreaElement;

type CheckResult = {
  modelId: string;
  status: CheckStatus;
  firstTokenLatencyMs: number | null;
  errorMessage: string | null;
};

type CheckResponse = {
  available: true;
  firstTokenLatencyMs: number | null;
};

type LatencyLevel = "fast" | "medium" | "slow" | "unknown";

const STORAGE_KEY = "check-your-api-form";
const PROXY_ERROR_MESSAGE =
  "连不上当前站点的 API 服务。开发环境先运行 `npm run dev`，生产环境确认服务已经正常部署。";
const FAST_FIRST_TOKEN_MS = 800;
const MEDIUM_FIRST_TOKEN_MS = 2000;
const fieldOrder: FieldName[] = ["baseUrl", "apiKey", "concurrency", "prompt"];

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

function fuzzyMatch(value: string, query: string) {
  const source = value.trim().toLowerCase();
  const keyword = query.trim().toLowerCase();

  if (!keyword) {
    return true;
  }

  if (source.includes(keyword)) {
    return true;
  }

  let keywordIndex = 0;

  for (const char of source) {
    if (char === keyword[keywordIndex]) {
      keywordIndex += 1;
    }

    if (keywordIndex === keyword.length) {
      return true;
    }
  }

  return false;
}

function getLatencyLevel(latencyMs: number | null): LatencyLevel {
  if (typeof latencyMs !== "number") {
    return "unknown";
  }

  if (latencyMs <= FAST_FIRST_TOKEN_MS) {
    return "fast";
  }

  if (latencyMs <= MEDIUM_FIRST_TOKEN_MS) {
    return "medium";
  }

  return "slow";
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

function isValidUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function getStatusLabel(status?: CheckStatus) {
  if (status === "checking") {
    return "检测中";
  }

  if (status === "available") {
    return "可用";
  }

  if (status === "unavailable") {
    return "不可用";
  }

  return "未检测";
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
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [checkingModels, setCheckingModels] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [modelSearchQuery, setModelSearchQuery] = useState("");
  const [fetchError, setFetchError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [resultFilter, setResultFilter] = useState<ResultFilter>("all");
  const [checkResults, setCheckResults] = useState<Record<string, CheckResult>>({});
  const fieldRefs = useRef<Record<FieldName, InputElement | null>>({
    baseUrl: null,
    apiKey: null,
    concurrency: null,
    prompt: null
  });

  const resolvedBaseUrl = useMemo(() => normalizeBaseUrl(form.baseUrl), [form.baseUrl]);
  const selectedModelIdSet = useMemo(() => new Set(selectedModelIds), [selectedModelIds]);
  const visibleModels = useMemo(
    () => models.filter((model) => selectedModelIdSet.has(model.id)),
    [models, selectedModelIdSet]
  );
  const filteredPickerModels = useMemo(
    () =>
      models.filter(
        (model) =>
          fuzzyMatch(model.id, modelSearchQuery) ||
          fuzzyMatch(model.owned_by ?? "", modelSearchQuery)
      ),
    [models, modelSearchQuery]
  );

  const availableCount = useMemo(
    () =>
      visibleModels.filter((model) => checkResults[model.id]?.status === "available").length,
    [checkResults, visibleModels]
  );

  const unavailableCount = useMemo(
    () =>
      visibleModels.filter((model) => checkResults[model.id]?.status === "unavailable").length,
    [checkResults, visibleModels]
  );

  const checkingCount = useMemo(
    () =>
      visibleModels.filter((model) => checkResults[model.id]?.status === "checking").length,
    [checkResults, visibleModels]
  );

  const pendingCount = useMemo(
    () =>
      visibleModels.filter((model) => {
        const status = checkResults[model.id]?.status;
        return !status || status === "idle" || status === "checking";
      }).length,
    [checkResults, visibleModels]
  );

  const checkedCount = availableCount + unavailableCount;
  const progressValue = visibleModels.length > 0 ? checkedCount / visibleModels.length : 0;

  const displayedModels = useMemo(() => {
    if (resultFilter === "all") {
      return visibleModels;
    }

    if (resultFilter === "pending") {
      return visibleModels.filter((model) => {
        const status = checkResults[model.id]?.status;
        return !status || status === "idle" || status === "checking";
      });
    }

    return visibleModels.filter((model) => checkResults[model.id]?.status === resultFilter);
  }, [checkResults, resultFilter, visibleModels]);

  const statusHeadline = useMemo(() => {
    if (checkingModels) {
      return `正在检测 ${checkedCount}/${visibleModels.length || 0}`;
    }

    if (models.length === 0) {
      return "等待连接 API";
    }

    if (checkedCount > 0) {
      return `${availableCount} 可用 / ${unavailableCount} 不可用`;
    }

    return `已拉取 ${models.length} 个模型`;
  }, [
    availableCount,
    checkedCount,
    checkingModels,
    models.length,
    unavailableCount,
    visibleModels.length
  ]);

  const statusDescription = useMemo(() => {
    if (resolvedBaseUrl) {
      return `当前 endpoint：${resolvedBaseUrl}`;
    }

    return "填好 Base URL 和 API Key 后就能开始。";
  }, [resolvedBaseUrl]);

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

      target.x = event.clientX / window.innerWidth - 0.5;
      target.y = event.clientY / window.innerHeight - 0.5;
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

  useEffect(() => {
    if (!showModelPicker) {
      return;
    }

    const previousOverflow = document.body.style.overflow;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowModelPicker(false);
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [showModelPicker]);

  const persistForm = (nextForm: typeof form) => {
    setForm(nextForm);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextForm));
  };

  const clearFieldError = (field: FieldName) => {
    setFieldErrors((current) => {
      if (!current[field]) {
        return current;
      }

      const next = { ...current };
      delete next[field];
      return next;
    });
  };

  const updateFormField = (field: FieldName, value: string) => {
    persistForm({
      ...form,
      [field]: value
    });
    clearFieldError(field);
    setFetchError("");
  };

  const focusFirstFieldError = (errors: FieldErrors) => {
    const firstField = fieldOrder.find((field) => errors[field]);

    if (!firstField) {
      return;
    }

    window.requestAnimationFrame(() => {
      fieldRefs.current[firstField]?.focus();
    });
  };

  const validateConnectionFields = () => {
    const nextErrors: FieldErrors = {};

    if (!resolvedBaseUrl) {
      nextErrors.baseUrl = "Base URL 不能为空。";
    } else if (!isValidUrl(resolvedBaseUrl)) {
      nextErrors.baseUrl = "Base URL 格式不对，示例：https://example.com/v1";
    }

    if (!form.apiKey.trim()) {
      nextErrors.apiKey = "API Key 不能为空。";
    }

    return nextErrors;
  };

  const validateCheckFields = () => {
    const nextErrors: FieldErrors = {};

    if (!parseConcurrency(form.concurrency)) {
      nextErrors.concurrency = "并发数必须是大于 0 的整数。";
    }

    if (!form.prompt.trim()) {
      nextErrors.prompt = "请求内容不能为空。";
    }

    return nextErrors;
  };

  const syncValidationErrors = (nextErrors: FieldErrors, message: string) => {
    setFieldErrors(nextErrors);
    setFetchError(message);
    focusFirstFieldError(nextErrors);
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
        errorMessage: null,
        ...patch
      }
    }));
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void fetchModels();
  };

  const fetchModels = async () => {
    const connectionErrors = validateConnectionFields();

    if (Object.keys(connectionErrors).length > 0) {
      syncValidationErrors(connectionErrors, "先把连接信息填完整。");
      return;
    }

    setFetchingModels(true);
    setFetchError("");
    setFieldErrors({});
    setCheckResults({});
    setResultFilter("all");

    try {
      const payload = await requestProxy<ModelsResponse>("/api/models", {
        baseUrl: resolvedBaseUrl,
        apiKey: form.apiKey.trim()
      });

      const nextModels = isModelsResponse(payload) && Array.isArray(payload.data)
        ? payload.data.filter((item: Model): item is Model => typeof item?.id === "string")
        : [];

      setModels(nextModels);
      setSelectedModelIds(nextModels.map((model) => model.id));
      setShowModelPicker(false);
      setModelSearchQuery("");

      if (nextModels.length === 0) {
        setFetchError("接口返回成功，但没拿到任何模型。");
      }
    } catch (error) {
      setModels([]);
      setSelectedModelIds([]);
      setShowModelPicker(false);
      setModelSearchQuery("");
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

    const nextErrors = {
      ...validateConnectionFields(),
      ...validateCheckFields()
    };

    if (Object.keys(nextErrors).length > 0) {
      syncValidationErrors(nextErrors, "先修正表单里的问题。");
      return;
    }

    if (visibleModels.length === 0) {
      setFetchError("至少选择一个要测活的模型。");
      return;
    }

    setCheckingModels(true);
    setFetchError("");
    setFieldErrors({});
    setCheckResults(
      Object.fromEntries(
        visibleModels.map((model) => [
          model.id,
          {
            modelId: model.id,
            status: "idle",
            firstTokenLatencyMs: null,
            errorMessage: null
          }
        ])
      )
    );

    try {
      const queue = [...visibleModels];
      const workerCount = Math.min(parseConcurrency(form.concurrency) ?? 1, queue.length);

      await Promise.all(
        Array.from({ length: workerCount }, async () => {
          while (queue.length > 0) {
            const model = queue.shift();

            if (!model) {
              return;
            }

            updateCheckResult(model.id, {
              status: "checking",
              firstTokenLatencyMs: null,
              errorMessage: null
            });

            try {
              const result = await checkOneModel(model.id);
              updateCheckResult(model.id, {
                status: "available",
                firstTokenLatencyMs: result.firstTokenLatencyMs,
                errorMessage: null
              });
            } catch (error) {
              updateCheckResult(model.id, {
                status: "unavailable",
                firstTokenLatencyMs: null,
                errorMessage: getErrorMessage(error)
              });
            }
          }
        })
      );
    } finally {
      setCheckingModels(false);
    }
  };

  const toggleModelSelection = (modelId: string) => {
    setSelectedModelIds((current) =>
      current.includes(modelId)
        ? current.filter((id) => id !== modelId)
        : [...current, modelId]
    );
  };

  const filterCounts: Record<ResultFilter, number> = {
    all: visibleModels.length,
    available: availableCount,
    unavailable: unavailableCount,
    pending: pendingCount
  };

  return (
    <div className="shell">
      <a className="skip-link" href="#main-content">
        跳到主内容
      </a>
      <div className="backdrop backdrop-a" />
      <div className="backdrop backdrop-b" />

      <header className="hero">
        <div className="hero-copy">
          <p className="eyebrow">check-your-api</p>
          <h1>批量测活面板</h1>
          <p className="subtitle">
            面向 OpenAI 兼容 API 的批量检测，拉模型、选范围、看延迟，全都在一个界面里完成。
          </p>
        </div>

        <aside className="hero-status" aria-live="polite">
          <span className="summary-label">当前状态</span>
          <strong>{statusHeadline}</strong>
          <p>{statusDescription}</p>
          <div className="hero-meta">
            <span>已选 {selectedModelIds.length}</span>
            <span>进行中 {checkingCount}</span>
          </div>
        </aside>
      </header>

      <main className="content" id="main-content">
        <section className="panel panel-grid">
          <div className="config-column">
            <div className="section-head section-head-tight">
              <div>
                <h2>连接配置</h2>
                <p>先拉取模型，再决定检测范围。</p>
              </div>
            </div>

            <form className="form" onSubmit={handleSubmit} noValidate>
              <label className="field" htmlFor="base-url">
                <span>API Base URL</span>
                <input
                  ref={(node) => {
                    fieldRefs.current.baseUrl = node;
                  }}
                  id="base-url"
                  name="baseUrl"
                  type="url"
                  inputMode="url"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  aria-invalid={Boolean(fieldErrors.baseUrl)}
                  aria-describedby="base-url-help base-url-error"
                  placeholder="例如 https://example.com/v1…"
                  value={form.baseUrl}
                  onChange={(event) => updateFormField("baseUrl", event.target.value)}
                />
                <small className="field-help" id="base-url-help">
                  OpenAI 兼容地址，通常以 `/v1` 结尾。
                </small>
                {fieldErrors.baseUrl ? (
                  <small className="field-error" id="base-url-error" role="alert">
                    {fieldErrors.baseUrl}
                  </small>
                ) : null}
              </label>

              <label className="field" htmlFor="api-key">
                <span>API Key</span>
                <input
                  ref={(node) => {
                    fieldRefs.current.apiKey = node;
                  }}
                  id="api-key"
                  name="apiKey"
                  type="password"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  aria-invalid={Boolean(fieldErrors.apiKey)}
                  aria-describedby="api-key-help api-key-error"
                  placeholder="例如 sk-abc123…"
                  value={form.apiKey}
                  onChange={(event) => updateFormField("apiKey", event.target.value)}
                />
                <small className="field-help" id="api-key-help">
                  只保存在当前浏览器的本地缓存里，不会自动上传到别处。
                </small>
                {fieldErrors.apiKey ? (
                  <small className="field-error" id="api-key-error" role="alert">
                    {fieldErrors.apiKey}
                  </small>
                ) : null}
              </label>

              <div className="control-row">
                <label className="field field-compact" htmlFor="concurrency">
                  <span>并发数</span>
                  <input
                    ref={(node) => {
                      fieldRefs.current.concurrency = node;
                    }}
                    id="concurrency"
                    name="concurrency"
                    type="number"
                    min="1"
                    step="1"
                    inputMode="numeric"
                    autoComplete="off"
                    aria-invalid={Boolean(fieldErrors.concurrency)}
                    aria-describedby="concurrency-help concurrency-error"
                    placeholder="例如 5…"
                    value={form.concurrency}
                    onChange={(event) =>
                      updateFormField("concurrency", event.target.value.replace(/[^\d]/g, ""))
                    }
                  />
                  <small className="field-help" id="concurrency-help">
                    建议先从 3 到 5 开始，别一上来把上游打爆。
                  </small>
                  {fieldErrors.concurrency ? (
                    <small className="field-error" id="concurrency-error" role="alert">
                      {fieldErrors.concurrency}
                    </small>
                  ) : null}
                </label>

                <div className="actions actions-inline">
                  <button type="submit" disabled={fetchingModels || checkingModels}>
                    {fetchingModels ? "获取中…" : "获取可用模型"}
                  </button>

                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setShowModelPicker(true)}
                    disabled={fetchingModels || checkingModels || models.length === 0}
                  >
                    选择检测模型 ({selectedModelIds.length}/{models.length})
                  </button>

                  <button
                    type="button"
                    className="secondary"
                    onClick={() => void batchCheckModels()}
                    disabled={fetchingModels || checkingModels || visibleModels.length === 0}
                  >
                    {checkingModels ? "检测中…" : "批量检测"}
                  </button>
                </div>
              </div>
            </form>
          </div>

          <aside className="summary-column" aria-live="polite">
            <section className="prompt-panel" aria-labelledby="prompt-title">
              <div className="section-head section-head-tight prompt-head">
                <div>
                  <h2 id="prompt-title">请求内容</h2>
                  <p>用固定 prompt 做活性检查，结果更可比。</p>
                </div>
              </div>

              <label className="field" htmlFor="prompt">
                <span className="sr-only">请求内容</span>
                <textarea
                  ref={(node) => {
                    fieldRefs.current.prompt = node;
                  }}
                  id="prompt"
                  name="prompt"
                  rows={6}
                  autoComplete="off"
                  aria-invalid={Boolean(fieldErrors.prompt)}
                  aria-describedby="prompt-help prompt-error"
                  placeholder="例如 Say hello in one sentence…"
                  value={form.prompt}
                  onChange={(event) => updateFormField("prompt", event.target.value)}
                />
                <small className="field-help" id="prompt-help">
                  用一段稳定、低成本的提示词做活性检查，结果会更可比。
                </small>
                {fieldErrors.prompt ? (
                  <small className="field-error" id="prompt-error" role="alert">
                    {fieldErrors.prompt}
                  </small>
                ) : null}
              </label>
            </section>

            <dl className="stats-strip" aria-label="检测统计">
              <div className="stat-pill">
                <dt>已选模型</dt>
                <dd>{selectedModelIds.length}</dd>
              </div>
              <div className="stat-pill">
                <dt>可用</dt>
                <dd>{availableCount}</dd>
              </div>
              <div className="stat-pill">
                <dt>不可用</dt>
                <dd>{unavailableCount}</dd>
              </div>
            </dl>

            <div className="workflow">
              <div className="workflow-item">
                <span>01</span>
                <p>填 Base URL、Key 和并发数。</p>
              </div>
              <div className="workflow-item">
                <span>02</span>
                <p>拉取模型后按需筛选检测范围。</p>
              </div>
              <div className="workflow-item">
                <span>03</span>
                <p>看可用性、首字延迟和失败原因。</p>
              </div>
            </div>
          </aside>
        </section>

        {fetchError ? (
          <section className="notice error" role="alert" aria-live="assertive">
            {fetchError}
          </section>
        ) : null}

        <section className="panel" aria-busy={checkingModels}>
          <div className="section-head results-head">
            <div>
              <h2>模型结果</h2>
              <p>仅展示当前选中的模型，可按状态快速过滤。</p>
            </div>

            <div className="filter-group" role="tablist" aria-label="结果过滤">
              {(
                [
                  ["all", "全部"],
                  ["available", "可用"],
                  ["unavailable", "不可用"],
                  ["pending", "待完成"]
                ] as const satisfies ReadonlyArray<readonly [ResultFilter, string]>
              ).map(([filter, label]) => (
                <button
                  key={filter}
                  type="button"
                  role="tab"
                  aria-selected={resultFilter === filter}
                  className={`filter-chip${resultFilter === filter ? " is-active" : ""}`}
                  onClick={() => setResultFilter(filter)}
                >
                  {label}
                  <span>{filterCounts[filter]}</span>
                </button>
              ))}
            </div>
          </div>

          {visibleModels.length > 0 ? (
            <div className="progress-card" aria-live="polite">
              <div className="progress-copy">
                <strong>{checkingModels ? "检测进行中" : "检测概览"}</strong>
                <span>
                  已完成 {checkedCount} / {visibleModels.length}，待完成 {pendingCount}
                </span>
              </div>
              <div
                className="progress-track"
                aria-hidden="true"
                style={{ "--progress": `${Math.round(progressValue * 100)}%` } as React.CSSProperties}
              />
            </div>
          ) : null}

          {models.length === 0 ? (
            <div className="empty">还没有模型。先点“获取可用模型”。</div>
          ) : visibleModels.length === 0 ? (
            <div className="empty">当前没有选中任何模型。</div>
          ) : displayedModels.length === 0 ? (
            <div className="empty">这个筛选条件下没有结果。</div>
          ) : (
            <div className="model-grid">
              {displayedModels.map((model, index) => {
                const result = checkResults[model.id];
                const latencyLevel = getLatencyLevel(result?.firstTokenLatencyMs ?? null);

                return (
                  <article className="model-card" key={model.id}>
                    <div className="model-card-top">
                      <span className="model-index">{String(index + 1).padStart(2, "0")}</span>
                      <span className={`badge badge-${result?.status ?? "idle"}`}>
                        {getStatusLabel(result?.status)}
                      </span>
                    </div>

                    <h3 translate="no">{model.id}</h3>
                    <p className="meta">{model.owned_by ? `owned by ${model.owned_by}` : "未提供所有者信息"}</p>

                    {result?.status === "available" ? (
                      <p className={`latency latency-${latencyLevel}`}>
                        首字延迟{" "}
                        {typeof result.firstTokenLatencyMs === "number"
                          ? `${result.firstTokenLatencyMs} ms`
                          : "未获取到"}
                      </p>
                    ) : null}

                    {result?.status === "unavailable" && result.errorMessage ? (
                      <p className="failure-reason">{result.errorMessage}</p>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </main>

      {showModelPicker ? (
        <div
          className="modal-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setShowModelPicker(false);
            }
          }}
        >
          <section
            className="modal panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="model-picker-title"
            aria-describedby="model-picker-description"
          >
            <div className="section-head modal-head">
              <div>
                <h2 id="model-picker-title">选择检测模型</h2>
                <p id="model-picker-description">支持搜索、全选、取消全选，按需缩小检测范围。</p>
              </div>
              <button
                type="button"
                className="secondary"
                onClick={() => setShowModelPicker(false)}
              >
                完成
              </button>
            </div>

            <div className="picker-toolbar">
              <span>
                已选 {selectedModelIds.length} / {models.length}
              </span>
              <div className="picker-actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setSelectedModelIds([])}
                >
                  取消全选
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setSelectedModelIds(models.map((model) => model.id))}
                >
                  全选
                </button>
              </div>
            </div>

            <label className="field picker-search" htmlFor="model-search">
              <span>搜索模型</span>
              <input
                id="model-search"
                name="modelSearch"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                placeholder="输入模型名或 owned by…"
                value={modelSearchQuery}
                onChange={(event) => setModelSearchQuery(event.target.value)}
              />
            </label>

            <div className="picker-list">
              {filteredPickerModels.length === 0 ? (
                <div className="empty">没有匹配到模型。</div>
              ) : (
                filteredPickerModels.map((model) => {
                  const selected = selectedModelIdSet.has(model.id);

                  return (
                    <button
                      key={model.id}
                      type="button"
                      className={`picker-item${selected ? " is-selected" : ""}`}
                      onClick={() => toggleModelSelection(model.id)}
                    >
                      <span className="picker-check" aria-hidden="true">
                        {selected ? "✓" : ""}
                      </span>
                      <span className="picker-copy">
                        <strong translate="no">{model.id}</strong>
                        <small>
                          {model.owned_by ? `owned by ${model.owned_by}` : "未提供所有者信息"}
                        </small>
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
