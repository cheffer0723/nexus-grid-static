const DEFAULT_MODE = (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") ? "local" : "remoteControl";
const MODE_STORAGE_KEY = "NEXUS_DASHBOARD_MODE";
const BUILD_COMMIT = document.currentScript?.dataset.commit || localStorage.getItem("NEXUS_BUILD_SHA") || "unknown";
const MODE_CONFIG = {
  remote: { label: "Remote, read-only (Railway)", apiBase: "https://critical-mass-lab-production.up.railway.app" },
  remoteControl: { label: "Remote control", apiBase: localStorage.getItem("NEXUS_REMOTE_CONTROL_BASE") || "http://165.227.84.11:8896" },
  local: { label: "Local, control enabled", apiBase: "http://127.0.0.1:8080" },
};
let DASHBOARD_MODE = localStorage.getItem(MODE_STORAGE_KEY) || DEFAULT_MODE;
if (!MODE_CONFIG[DASHBOARD_MODE]) DASHBOARD_MODE = DEFAULT_MODE;
let API_BASE = MODE_CONFIG[DASHBOARD_MODE].apiBase;
const REFRESH_MS = 45000;
const PROCESS_REFRESH_MS = 5000;
const DEFAULT_PROCESS_SERVICES = [
  { key: "engine", label: "Nexus engine" },
  { key: "bridge", label: "Bridge" },
  { key: "outcomes_tracker", label: "Outcomes tracker" },
  { key: "morning_bias", label: "Morning bias loop" },
];

function normalizeApiBase(value) {
  return String(value ?? "").trim().replace(/\/$/, "");
}

function apiBaseKeyForMode(mode) {
  if (mode === "remoteControl") return "NEXUS_REMOTE_CONTROL_BASE";
  if (mode === "local") return "NEXUS_LOCAL_API_BASE";
  return "NEXUS_REMOTE_READONLY_BASE";
}

function syncApiBaseUi() {
  const input = document.getElementById("apiBaseInput");
  const modeSelect = document.getElementById("modeSelect");
  const tokenInput = document.getElementById("controlTokenInput");
  const pill = document.getElementById("backendStatusPill");
  const hint = document.getElementById("backendBaseText");
  const build = document.getElementById("frontendCommitText");
  if (input) input.value = API_BASE;
  if (modeSelect) modeSelect.value = DASHBOARD_MODE;
  if (tokenInput) tokenInput.value = localStorage.getItem("NEXUS_CONTROL_TOKEN") || "";
  if (pill) {
    const className = DASHBOARD_MODE === "remoteControl" || DASHBOARD_MODE === "local" ? "ok" : "warn";
    pill.className = `pill ${className}`;
    pill.textContent = `Mode: ${MODE_CONFIG[DASHBOARD_MODE].label}`;
  }
  if (hint) hint.textContent = API_BASE;
  if (build) build.textContent = `Build: ${localStorage.getItem("NEXUS_BUILD_SHA") || BUILD_COMMIT}`;
}

async function syncBuildCommit() {
  const build = document.getElementById("frontendCommitText");
  if (build) build.textContent = `Build: loading...`;
  try {
    const res = await fetch("https://api.github.com/repos/cheffer0723/nexus-grid-static/commits/main", { cache: "no-store", headers: { Accept: "application/vnd.github+json" } });
    if (!res.ok) return;
    const data = await res.json();
    const sha = String(data?.sha || "").slice(0, 7);
    if (sha) {
      localStorage.setItem("NEXUS_BUILD_SHA", sha);
      if (build) build.textContent = `Build: ${sha}`;
    }
  } catch {
    if (build) build.textContent = `Build: ${localStorage.getItem("NEXUS_BUILD_SHA") || BUILD_COMMIT}`;
  }
}

function updateApiBase(nextBase) {
  const normalized = normalizeApiBase(nextBase);
  if (!normalized) return false;
  API_BASE = normalized;
  localStorage.setItem(apiBaseKeyForMode(DASHBOARD_MODE), API_BASE);
  syncApiBaseUi();
  return true;
}

function updateControlToken(nextToken) {
  const token = String(nextToken ?? "").trim();
  if (!token) return false;
  localStorage.setItem("NEXUS_CONTROL_TOKEN", token);
  syncApiBaseUi();
  return true;
}

function setMode(nextMode) {
  const normalized = nextMode === "local" || nextMode === "remoteControl" ? nextMode : "remote";
  DASHBOARD_MODE = normalized;
  API_BASE = MODE_CONFIG[DASHBOARD_MODE].apiBase || localStorage.getItem(apiBaseKeyForMode(DASHBOARD_MODE)) || "";
  localStorage.setItem(MODE_STORAGE_KEY, DASHBOARD_MODE);
  syncApiBaseUi();
}

function dashboardEndpoint() {
  if (DASHBOARD_MODE === "remote") return `${API_BASE}/state`;
  if (DASHBOARD_MODE === "remoteControl") return `${API_BASE}/api/remote/state`;
  return `${API_BASE}/api/nexus/dashboard`;
}

function buildRemoteDashboardPayload(raw) {
  const data = raw?.data && typeof raw.data === "object" ? raw.data : raw;
  return {
    generated_at_utc: raw?.received_at_utc || raw?.generated_at_utc || new Date().toISOString(),
    engine_state: data || {},
    recent_trades: [],
    disagreements: [],
    regime_summary: { deterministic: [], ml: [], meta: { trade_count: 0 } },
    processes: [],
  };
}

function initBackendControls() {
  const input = document.getElementById("apiBaseInput");
  const modeSelect = document.getElementById("modeSelect");
  const tokenInput = document.getElementById("controlTokenInput");
  const saveButton = document.getElementById("saveApiBaseButton");
  const saveTokenButton = document.getElementById("saveControlTokenButton");
  if (input) input.value = API_BASE;
  if (modeSelect) modeSelect.value = DASHBOARD_MODE;
  if (modeSelect) {
    modeSelect.addEventListener("change", async () => {
      setMode(modeSelect.value);
      await refreshDashboard();
    });
  }
  if (saveButton) {
    saveButton.addEventListener("click", async () => {
      if (!updateApiBase(input?.value)) return;
      await refreshDashboard();
    });
  }
  if (saveTokenButton) {
    saveTokenButton.addEventListener("click", async () => {
      if (!updateControlToken(tokenInput?.value)) return;
      await refreshDashboard();
    });
  }
  if (input) {
    input.addEventListener("keydown", async (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        if (!updateApiBase(input.value)) return;
        await refreshDashboard();
      }
    });
  }
  if (tokenInput) {
    tokenInput.addEventListener("keydown", async (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        if (!updateControlToken(tokenInput.value)) return;
        await refreshDashboard();
      }
    });
  }
  syncApiBaseUi();
  syncBuildCommit().catch(() => {});
}

const fmt = {
  int(value) {
    const n = Number(value);
    return Number.isFinite(n) ? new Intl.NumberFormat().format(Math.round(n)) : "—";
  },
  num(value, digits = 4) {
    const n = Number(value);
    return Number.isFinite(n) ? n.toFixed(digits) : "—";
  },
  pct(value, digits = 2) {
    const n = Number(value);
    return Number.isFinite(n) ? `${(n * 100).toFixed(digits)}%` : "—";
  },
  price(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";
  },
  text(value, fallback = "—") {
    return value === null || value === undefined || value === "" ? fallback : String(value);
  },
};

function escapeHtml(value) {
  return fmt.text(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function badgeClass(value) {
  const normalized = String(value ?? "").toLowerCase();
  if (normalized.includes("match") || normalized.includes("true") || normalized.includes("good") || normalized.includes("ok")) return "badge ok";
  if (normalized.includes("mismatch") || normalized.includes("false") || normalized.includes("error") || normalized.includes("bad")) return "badge bad";
  if (normalized.includes("warn") || normalized.includes("unknown") || normalized.includes("null") || normalized.includes("shadow") || normalized.includes("stress")) return "badge warn";
  return "badge neutral";
}

function actionClass(value) {
  const normalized = String(value ?? "").toUpperCase();
  if (normalized.includes("LONG") || normalized.includes("EXPANDING") || normalized.includes("GOOD")) return "badge ok";
  if (normalized.includes("SHORT") || normalized.includes("CONTRACTING") || normalized.includes("BAD")) return "badge bad";
  if (normalized.includes("WAIT") || normalized.includes("NEUTRAL") || normalized.includes("STRESS")) return "badge warn";
  return "badge neutral";
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = fmt.text(value);
}

function setBadge(id, label, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = `pill ${badgeClass(value)}`;
  el.textContent = `${label}: ${fmt.text(value, "unknown")}`;
}

function renderEmpty(container, message) {
  container.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
}

function renderKeyValues(container, entries) {
  if (!entries.length) {
    renderEmpty(container, "No engine data available.");
    return;
  }
  container.innerHTML = entries
    .map(
      (entry) => `
        <div class="kv-item">
          <span class="kv-label">${escapeHtml(entry.label)}</span>
          <span class="kv-value ${entry.className || ""}">${escapeHtml(entry.value)}</span>
        </div>
      `,
    )
    .join("");
}

function rowBadge(value, fallback = "neutral") {
  return `<span class="badge ${badgeClass(value) || fallback}">${escapeHtml(fmt.text(value))}</span>`;
}

function renderTable(container, columns, rows, emptyMessage) {
  if (!rows.length) {
    renderEmpty(container, emptyMessage);
    return;
  }

  const head = columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("");
  const body = rows
    .map((row) => {
      const cells = columns
        .map((column) => {
          const raw = typeof column.value === "function" ? column.value(row) : row[column.key];
          const className = column.className ? column.className(row) : "";
          return `<td class="${className}">${raw ?? "—"}</td>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");

  container.innerHTML = `
    <table>
      <thead><tr>${head}</tr></thead>
      <tbody>${body}</tbody>
    </table>
  `;
}

function summarizeOutcomes(map) {
  const entries = Object.entries(map || {});
  if (!entries.length) return "—";
  return entries.map(([key, value]) => `${key}: ${value}`).join(", ");
}

function processStatusClass(value) {
  const normalized = String(value ?? "").toLowerCase();
  if (normalized.includes("running") || normalized.includes("healthy")) return "badge ok";
  if (normalized.includes("error")) return "badge bad";
  if (normalized.includes("stopping") || normalized.includes("starting") || normalized.includes("degraded")) return "badge warn";
  if (normalized.includes("stopped")) return "badge neutral";
  return "badge neutral";
}

function commandText(value) {
  if (Array.isArray(value)) return value.join(" ");
  return fmt.text(value);
}

async function processAction(service, action) {
  if (DASHBOARD_MODE === "remote") {
    setText("lastErrorText", "Process control is disabled in read-only remote mode.");
    return;
  }
  const headers = { "Content-Type": "application/json" };
  const token = localStorage.getItem("NEXUS_CONTROL_TOKEN") || "";
  if (DASHBOARD_MODE === "remoteControl" && token) headers["x-nexus-remote-token"] = token;
  const targetUrl = DASHBOARD_MODE === "remoteControl"
    ? `${API_BASE}/api/remote/commands`
    : `${API_BASE}/api/processes/${encodeURIComponent(service)}/${action}`;
  const body = DASHBOARD_MODE === "remoteControl"
    ? JSON.stringify({ service, action, requested_by: "dashboard", source: "nexus-grid-static" })
    : undefined;
  const res = await fetch(targetUrl, {
    method: "POST",
    headers,
    body,
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Process ${action} failed for ${service}: ${res.status}`);
  }
  await refreshDashboard();
}

function renderProcessCards(payload) {
  const services = payload.services && payload.services.length ? payload.services : DEFAULT_PROCESS_SERVICES;
  const controlMode = DASHBOARD_MODE === "local" || DASHBOARD_MODE === "remoteControl";
  const remoteControlMode = DASHBOARD_MODE === "remoteControl";
  setText("processCountStamp", controlMode ? `${services.length} managed services` : `Remote mode, process control disabled`);

  const container = document.getElementById("processCards");
  if (!container) return;

  if (!services.length) {
    renderEmpty(container, "No managed services found.");
    return;
  }

  container.innerHTML = services
    .map((service) => {
      const status = String(service.status || "stopped").toLowerCase();
      const statusLabel = status.toUpperCase();
      const stdoutTail = (service.last_stdout_tail || []).join("\n");
      const stderrTail = (service.last_stderr_tail || []).join("\n");
      const combinedTail = [stdoutTail, stderrTail].filter(Boolean).join(stdoutTail && stderrTail ? "\n" : "");
      const commandDisplay = commandText(service.command_display || service.launch_command);
      const scriptPath = fmt.text(service.script_path);
      const launchCommand = commandText(service.launch_command);
      const monitoredPaths = (service.monitored_paths || []).map((p) => `<div class="mono">${escapeHtml(fmt.text(p))}</div>`).join("");
      const stopDisabled = !controlMode || (status !== "running" && status !== "starting" && status !== "stopping");
      const startDisabled = !controlMode || status === "running" || status === "starting";
      return `
        <div class="process-card status-${escapeHtml(status)}">
          <div class="process-card-header">
            <div>
              <h3>${escapeHtml(service.label || service.key)}</h3>
              <div class="badge ${processStatusClass(status)}">${escapeHtml(statusLabel)}</div>
            </div>
            <div class="process-actions">
              <button type="button" onclick="processAction('${escapeHtml(service.key)}','start')" ${startDisabled ? "disabled" : ""}>Start</button>
              <button type="button" onclick="processAction('${escapeHtml(service.key)}','stop')" ${stopDisabled ? "disabled" : ""}>Stop</button>
              <button type="button" onclick="processAction('${escapeHtml(service.key)}','restart')">Restart</button>
            </div>
          </div>

          <div class="process-meta">
            <div class="kv-item"><span class="kv-label">PID</span><span class="kv-value mono">${escapeHtml(fmt.text(service.pid))}</span></div>
            <div class="kv-item"><span class="kv-label">Start time</span><span class="kv-value mono">${escapeHtml(fmt.text(service.start_time_utc))}</span></div>
            <div class="kv-item"><span class="kv-label">Last heartbeat</span><span class="kv-value mono">${escapeHtml(fmt.text(service.last_heartbeat_at_utc))}</span></div>
            <div class="kv-item"><span class="kv-label">Last file update</span><span class="kv-value mono">${escapeHtml(fmt.text(service.last_file_update_at_utc))}</span></div>
            <div class="kv-item"><span class="kv-label">Last error</span><span class="kv-value mono">${escapeHtml(fmt.text(service.last_error))}</span></div>
            <div class="kv-item"><span class="kv-label">Exit code</span><span class="kv-value mono">${escapeHtml(fmt.text(service.exit_code))}</span></div>
          </div>

          <div class="process-command"><span class="kv-label">Exact launch command</span><div class="mono">${escapeHtml(launchCommand)}</div></div>
          <div class="process-command"><span class="kv-label">Exact script path</span><div class="mono">${escapeHtml(scriptPath)}</div></div>
          <div class="process-command"><span class="kv-label">Command executed inside runner</span><div class="mono">${escapeHtml(commandDisplay)}</div></div>
          <div class="process-paths"><span class="kv-label">Monitored live files</span>${monitoredPaths || "<div class='empty-state'>No monitored files configured.</div>"}</div>
          ${controlMode ? "" : "<div class='empty-state'>Remote mode is read-only. Switch to local mode on a desktop on the host machine to use process controls.</div>"}
          <div class="process-tail"><span class="kv-label">Recent output</span><pre>${escapeHtml(combinedTail || "No output yet.")}</pre></div>
        </div>
      `;
    })
    .join("");
}

async function loadProcesses() {
  if (DASHBOARD_MODE === "remoteControl") {
    const res = await fetch(`${API_BASE}/api/remote/state`, {
      cache: "no-store",
      headers: localStorage.getItem("NEXUS_CONTROL_TOKEN") ? { "x-nexus-remote-token": localStorage.getItem("NEXUS_CONTROL_TOKEN") } : {},
    });
    if (!res.ok) throw new Error(`Remote command state fetch failed: ${res.status}`);
    const raw = await res.json();
    const services = (raw.services || []).map((row) => {
      let statusData = {};
      try { statusData = JSON.parse(row.status_json || "{}"); } catch { statusData = {}; }
      return {
        key: row.service,
        label: row.service,
        status: statusData.status || "unknown",
        pid: statusData.pid ?? null,
        start_time_utc: statusData.start_time_utc || null,
        stop_time_utc: statusData.stop_time_utc || null,
        exit_code: statusData.exit_code ?? null,
        last_error: statusData.last_error || row.last_error || null,
        last_output_at_utc: statusData.last_output_at_utc || null,
        last_file_update_at_utc: statusData.last_file_update_at_utc || null,
        last_heartbeat_at_utc: statusData.last_heartbeat_at_utc || row.last_heartbeat_at_utc || null,
        last_stdout_tail: [],
        last_stderr_tail: [],
        script_path: null,
        command_display: null,
        launch_command: null,
        monitored_paths: [],
      };
    });
    renderProcessCards({ services });
    return { ok: true, mode: "remoteControl" };
  }
  if (DASHBOARD_MODE !== "local") {
    renderProcessCards({ services: DEFAULT_PROCESS_SERVICES.map((service) => ({
      ...service,
      status: "stopped",
      pid: null,
      start_time_utc: null,
      stop_time_utc: null,
      exit_code: null,
      last_error: null,
      last_output_at_utc: null,
      last_file_update_at_utc: null,
      last_heartbeat_at_utc: null,
      last_stdout_tail: [],
      last_stderr_tail: [],
      script_path: null,
      command_display: null,
      launch_command: null,
      monitored_paths: [],
    })) });
    return { ok: true, mode: "remote" };
  }
  const res = await fetch(`${API_BASE}/api/processes`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Process fetch failed: ${res.status}`);
  }
  const payload = await res.json();
  renderProcessCards(payload);
}

function renderSummary(container, rows, emptyMessage) {
  const columns = [
    { label: "Group", key: "group", value: (row) => `<span class="badge neutral">${escapeHtml(row.group)}</span>` },
    { label: "Trades", key: "trade_count", value: (row) => fmt.int(row.trade_count) },
    { label: "Wins", key: "win_count", value: (row) => fmt.int(row.win_count) },
    { label: "Win rate", key: "win_rate", value: (row) => fmt.pct(row.win_rate) },
    { label: "Avg PnL", key: "avg_pnl_abs", value: (row) => fmt.num(row.avg_pnl_abs, 6) },
    { label: "Total PnL", key: "total_pnl_abs", value: (row) => fmt.num(row.total_pnl_abs, 6) },
    { label: "Outcomes", key: "outcome_distribution", value: (row) => escapeHtml(summarizeOutcomes(row.outcome_distribution)) },
  ];
  renderTable(container, columns, rows, emptyMessage);
}

function renderEngineState(payload) {
  const state = payload.engine_state || {};
  const system = state.system_status || {};
  const health = state.health || {};
  const control = state.control_state || {};
  const paper = state.paper_summary || {};
  const signal = state.signal_latest || {};

  const engineMode = system.mode || state.market_bias || signal.market_bias || "unknown";
  const mlMatch = signal.ml_vs_deterministic_match;
  const mlState = signal.ml_regime_pred ? `${signal.ml_regime_pred} (${fmt.pct(signal.ml_regime_confidence)})` : "unavailable";

  setBadge("engineModePill", "Engine", engineMode);
  setBadge("mlPill", "ML", mlMatch === false ? "mismatch" : mlMatch === true ? "match" : signal.shadow_eod_only ? "shadow" : "unknown");
  setText("freshnessPill", `Updated: ${fmt.text(payload.generated_at_utc)}`);
  setText("dashboardUpdated", `Last updated: ${fmt.text(payload.generated_at_utc)}`);
  setText("dashboardSource", `Source: ${fmt.text(state.source_file)}`);
  setText("engineSourceStamp", `Source: ${fmt.text(state.source_mtime_utc || state.source_file)}`);

  const entries = [
    { label: "timestamp", value: fmt.text(signal.timestamp_utc), className: "mono" },
    { label: "symbol", value: fmt.text(signal.symbol), className: "mono" },
    { label: "action", value: fmt.text(signal.action), className: actionClass(signal.action) },
    { label: "market bias", value: fmt.text(signal.market_bias), className: actionClass(signal.market_bias) },
    { label: "deterministic regime", value: fmt.text(signal.deterministic_regime), className: actionClass(signal.deterministic_regime) },
    { label: "ML shadow regime", value: fmt.text(signal.ml_regime_pred), className: actionClass(signal.ml_regime_pred) },
    { label: "ML confidence", value: fmt.pct(signal.ml_regime_confidence), className: "mono" },
    { label: "ML vs deterministic", value: fmt.text(signal.ml_vs_deterministic_match === null || signal.ml_vs_deterministic_match === undefined ? "unknown" : signal.ml_vs_deterministic_match ? "match" : "mismatch"), className: badgeClass(signal.ml_vs_deterministic_match) },
    { label: "shadow_eod_only", value: fmt.text(signal.shadow_eod_only), className: badgeClass(signal.shadow_eod_only) },
    { label: "confidence", value: fmt.num(signal.confidence, 2), className: "mono" },
    { label: "current price", value: fmt.price(signal.current_price), className: "mono" },
    { label: "confidence adjusted", value: fmt.num(signal.confidence_adjusted, 2), className: "mono" },
    { label: "broker connected", value: fmt.text(system.brokerConnected), className: badgeClass(system.brokerConnected) },
    { label: "engine running", value: fmt.text(system.running), className: badgeClass(system.running) },
    { label: "mode", value: fmt.text(system.mode), className: actionClass(system.mode) },
    { label: "risk state", value: fmt.text(system.riskState), className: actionClass(system.riskState) },
    { label: "loop alive", value: fmt.text(health.loopAlive), className: badgeClass(health.loopAlive) },
    { label: "emergency stop", value: fmt.text(control.emergencyStopActive), className: badgeClass(control.emergencyStopActive) },
    { label: "open positions", value: fmt.int(paper.open_position_count), className: "mono" },
    { label: "realized pnl", value: fmt.num(paper.realized_pnl_abs, 6), className: "mono" },
  ];

  renderKeyValues(document.getElementById("engineStateGrid"), entries);
}

function renderDashboard(payload) {
  renderEngineState(payload);

  const trades = payload.recent_trades || [];
  const disagreements = payload.disagreements || [];
  const summary = payload.regime_summary || {};

  setText("tradeCountStamp", `${trades.length} recent trades`);
  setText("disagreementCountStamp", `${disagreements.length} mismatches`);
  setText("summaryMetaStamp", `${summary.meta?.trade_count ?? 0} closed trades`);

  renderTable(
    document.getElementById("recentTradesWrap"),
    [
      { label: "Time", key: "timestamp_utc", value: (row) => `<span class="mono">${escapeHtml(fmt.text(row.timestamp_utc))}</span>` },
      { label: "Symbol", key: "symbol", value: (row) => escapeHtml(fmt.text(row.symbol)) },
      { label: "Side / Action", key: "side", value: (row) => `<span class="badge ${actionClass(row.action || row.side)}">${escapeHtml(fmt.text(row.side || row.action))}</span>` },
      { label: "Entry", key: "entry_price", value: (row) => fmt.price(row.entry_price) },
      { label: "Exit", key: "exit_price", value: (row) => fmt.price(row.exit_price) },
      { label: "PnL USD", key: "pnl_abs", value: (row) => fmt.num(row.pnl_abs, 6) },
      { label: "PnL %", key: "pnl_pct", value: (row) => fmt.pct(row.pnl_pct) },
      { label: "Outcome", key: "outcome_label", value: (row) => `<span class="badge ${actionClass(row.outcome_label)}">${escapeHtml(fmt.text(row.outcome_label))}</span>` },
      { label: "Deterministic", key: "deterministic_regime", value: (row) => `<span class="badge ${actionClass(row.deterministic_regime)}">${escapeHtml(fmt.text(row.deterministic_regime))}</span>` },
      { label: "ML regime", key: "ml_regime", value: (row) => row.ml_regime ? `<span class="badge ${actionClass(row.ml_regime)}">${escapeHtml(fmt.text(row.ml_regime))}</span>` : "<span class='badge neutral'>—</span>" },
    ],
    trades,
    "No closed trades found yet.",
  );

  renderTable(
    document.getElementById("disagreementWrap"),
    [
      { label: "Time", key: "timestamp_utc", value: (row) => `<span class="mono">${escapeHtml(fmt.text(row.timestamp_utc))}</span>` },
      { label: "Symbol", key: "symbol", value: (row) => escapeHtml(fmt.text(row.symbol)) },
      { label: "Deterministic", key: "deterministic_regime", value: (row) => `<span class="badge ${actionClass(row.deterministic_regime)}">${escapeHtml(fmt.text(row.deterministic_regime))}</span>` },
      { label: "ML regime", key: "ml_regime", value: (row) => `<span class="badge ${actionClass(row.ml_regime)}">${escapeHtml(fmt.text(row.ml_regime))}</span>` },
      { label: "Confidence", key: "ml_confidence", value: (row) => fmt.pct(row.ml_confidence) },
      { label: "Mismatch", key: "mismatch_text", value: (row) => `<span class="badge bad">${escapeHtml(fmt.text(row.mismatch_text))}</span>` },
      { label: "Outcome", key: "outcome_label", value: (row) => `<span class="badge neutral">${escapeHtml(fmt.text(row.outcome_label))}</span>` },
    ],
    disagreements,
    "No ML disagreements found in the current log window.",
  );

  renderSummary(
    document.getElementById("deterministicSummaryWrap"),
    summary.deterministic || [],
    "No deterministic summary available.",
  );

  renderSummary(
    document.getElementById("mlSummaryWrap"),
    summary.ml || [],
    "No ML summary available.",
  );
}

async function loadDashboard() {
  const res = await fetch(dashboardEndpoint(), { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Dashboard fetch failed: ${res.status}`);
  }
  const raw = await res.json();
  const payload = (DASHBOARD_MODE === "remote" || DASHBOARD_MODE === "remoteControl") ? buildRemoteDashboardPayload(raw) : raw;
  renderDashboard(payload);
  return payload;
}

async function refreshDashboard() {
  let ok = true;
  const now = new Date();
  try {
    await loadDashboard();
  } catch (error) {
    ok = false;
    console.error(error);
    const lastError = document.getElementById("lastErrorText");
    if (lastError) lastError.textContent = `Last error: ${error.message}`;
  }

  try {
    await loadProcesses();
  } catch (error) {
    ok = false;
    console.error(error);
    const lastError = document.getElementById("lastErrorText");
    if (lastError) lastError.textContent = `Last error: ${error.message}`;
  }

  document.body.dataset.status = ok ? "ok" : "error";
  const successText = document.getElementById("lastSuccessText");
  const reachabilityText = document.getElementById("backendReachabilityText");
  if (successText && ok) successText.textContent = `Last successful fetch: ${now.toLocaleString()}`;
  if (reachabilityText) reachabilityText.textContent = `Backend reachable: ${ok ? "yes" : "no"}`;
  if (!ok) {
    const footer = document.getElementById("dashboardUpdated");
    if (footer) footer.textContent = "Last updated: unavailable";
  }
}

initBackendControls();

renderProcessCards({ services: DEFAULT_PROCESS_SERVICES.map((service) => ({
  ...service,
  status: "stopped",
  pid: null,
  start_time_utc: null,
  stop_time_utc: null,
  exit_code: null,
  last_error: null,
  last_output_at_utc: null,
  last_file_update_at_utc: null,
  last_heartbeat_at_utc: null,
  last_stdout_tail: [],
  last_stderr_tail: [],
  script_path: null,
  command_display: null,
  launch_command: null,
  monitored_paths: [],
})) });

refreshDashboard();
setInterval(refreshDashboard, REFRESH_MS);
setInterval(() => loadProcesses().catch((error) => console.error(error)), PROCESS_REFRESH_MS);
