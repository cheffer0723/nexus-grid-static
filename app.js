let API_BASE = window.NEXUS_API_BASE || localStorage.getItem("NEXUS_API_BASE") || "http://127.0.0.1:8080";
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

function syncApiBaseUi() {
  const input = document.getElementById("apiBaseInput");
  const pill = document.getElementById("backendStatusPill");
  const hint = document.getElementById("backendBaseText");
  if (input) input.value = API_BASE;
  if (pill) {
    pill.className = "pill neutral";
    pill.textContent = `Backend: ${API_BASE}`;
  }
  if (hint) hint.textContent = API_BASE;
}

function updateApiBase(nextBase) {
  const normalized = normalizeApiBase(nextBase);
  if (!normalized) return false;
  API_BASE = normalized;
  localStorage.setItem("NEXUS_API_BASE", API_BASE);
  syncApiBaseUi();
  return true;
}

function dashboardEndpoint() {
  return `${API_BASE}/api/nexus/dashboard`;
}

function initBackendControls() {
  const input = document.getElementById("apiBaseInput");
  const saveButton = document.getElementById("saveApiBaseButton");
  if (input) input.value = API_BASE;
  if (saveButton) {
    saveButton.addEventListener("click", async () => {
      if (!updateApiBase(input?.value)) return;
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
  syncApiBaseUi();
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
  const res = await fetch(`${API_BASE}/api/processes/${encodeURIComponent(service)}/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Process ${action} failed for ${service}: ${res.status}`);
  }
  await refreshDashboard();
}

function renderProcessCards(payload) {
  const services = payload.services && payload.services.length ? payload.services : DEFAULT_PROCESS_SERVICES;
  setText("processCountStamp", `${services.length} managed services`);

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
      const stopDisabled = status !== "running" && status !== "starting" && status !== "stopping";
      const startDisabled = status === "running" || status === "starting";
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
          <div class="process-tail"><span class="kv-label">Recent output</span><pre>${escapeHtml(combinedTail || "No output yet.")}</pre></div>
        </div>
      `;
    })
    .join("");
}

async function loadProcesses() {
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
  const payload = await res.json();
  renderDashboard(payload);
}

async function refreshDashboard() {
  let ok = true;
  try {
    await loadDashboard();
  } catch (error) {
    ok = false;
    console.error(error);
  }

  try {
    await loadProcesses();
  } catch (error) {
    ok = false;
    console.error(error);
  }

  document.body.dataset.status = ok ? "ok" : "error";
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
