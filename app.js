const REFRESH_MS = 10_000;
const STATE_URL = 'https://critical-mass-lab-production.up.railway.app/state';

const state = {
  raw: null,
  timer: null,
  lastSuccess: null,
};

const els = {};

document.addEventListener('DOMContentLoaded', () => {
  els.overallBadge = document.getElementById('overallBadge');
  els.lastRefresh = document.getElementById('lastRefresh');
  els.errorBanner = document.getElementById('errorBanner');
  els.missionControlList = document.getElementById('missionControlList');
  els.engineStatusList = document.getElementById('engineStatusList');
  els.signalList = document.getElementById('signalList');
  els.executionArea = document.getElementById('executionArea');
  els.rawState = document.getElementById('rawState');

  refreshState();
  state.timer = window.setInterval(refreshState, REFRESH_MS);
});

async function refreshState() {
  try {
    const response = await fetch(`${STATE_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    state.raw = data;
    state.lastSuccess = new Date();

    renderDashboard(data);
    setError('');
  } catch (error) {
    setError(`Failed to load state.json: ${error.message}`);
    if (!state.raw) {
      renderDashboard({});
    }
  }
}

function renderDashboard(data) {
  const system = pickObject(data, ['system_status', 'systemStatus']);
  const health = pickObject(data, ['health']);
  const control = pickObject(data, ['control_state', 'controlState']);
  const signal = pickObject(data, ['signal_latest', 'signalLatest']);
  const executions = pickExecutions(data);

  const tradingAllowed = asBool(firstDefined(
    system.trading_allowed,
    system.tradingAllowed,
    health.tradingAllowed,
    control.tradingAllowed,
    control.trading_allowed,
  ), false);

  const engineRunning = asBool(firstDefined(
    system.running,
    health.running,
    health.engineRunning,
    data.running,
  ), false);

  const emergencyStop = asBool(firstDefined(
    control.emergencyStopActive,
    control.emergency_stop_active,
    data.emergencyStopActive,
  ), false);

  const requestedStop = asBool(firstDefined(
    control.requested,
    control.stopRequested,
    control.requested_stop,
  ), false);

  const overallGo = tradingAllowed && engineRunning && !emergencyStop && !requestedStop;
  setBadge(els.overallBadge, overallGo ? 'GO' : 'NO-GO', overallGo ? 'badge-go' : 'badge-nogo');
  els.lastRefresh.textContent = state.lastSuccess ? formatDateTime(state.lastSuccess) : 'Never';

  renderKeyValues(els.missionControlList, [
    ['Overall status', overallGo ? 'GO' : 'NO-GO'],
    ['Trading allowed', boolLabel(tradingAllowed)],
    ['Engine running', boolLabel(engineRunning)],
    ['Mode', textOr(system.mode, 'Unknown')],
    ['Risk level', textOr(system.risk_level ?? system.riskLevel, 'Unknown')],
    ['Last update time', formatDateTime(firstDefined(system.updated_at, system.updatedAt, data.updated_at, data.timestamp_utc, data.timestamp), true)],
  ]);

  renderKeyValues(els.engineStatusList, [
    ['Running / stopped', engineRunning ? 'Running' : 'Stopped'],
    ['Broker connected', boolLabel(firstDefined(health.brokerConnected, health.broker_connected, false), false)],
    ['Emergency stop active', boolLabel(emergencyStop)],
    ['Requested stop', boolLabel(requestedStop)],
    ['Stop source', textOr(firstDefined(control.stopSource, control.stop_source), 'Unknown')],
  ]);

  renderKeyValues(els.signalList, [
    ['Symbol', textOr(signal.symbol, 'Unknown')],
    ['Action', textOr(signal.action, 'Unknown')],
    ['Market bias', textOr(signal.market_bias ?? signal.marketBias, 'Unknown')],
    ['Volatility state', textOr(signal.volatility_state ?? signal.volatilityState, 'Unknown')],
    ['Bullish score', textOr(formatNumberish(signal.bullish_score ?? signal.bullishScore), 'N/A')],
    ['Bearish score', textOr(formatNumberish(signal.bearish_score ?? signal.bearishScore), 'N/A')],
    ['Net score', textOr(formatNumberish(signal.net_score ?? signal.netScore), 'N/A')],
    ['Signal timestamp', formatDateTime(firstDefined(signal.timestamp_utc, signal.timestampUtc, signal.timestamp), true)],
  ]);

  renderExecutions(els.executionArea, executions);
  els.rawState.textContent = safeStringify(data);
}

function renderExecutions(container, executions) {
  container.innerHTML = '';

  if (!executions.length) {
    const empty = document.createElement('div');
    empty.className = 'execution-empty';
    empty.textContent = 'No recent executions';
    container.appendChild(empty);
    return;
  }

  const latest = executions[0];
  const wrapper = document.createElement('div');
  wrapper.className = 'execution-summary';

  const summary = latest.summary || latest.message || latest.note || latest.description || 'Latest execution';
  wrapper.appendChild(kvItem('Summary', textOr(summary, 'No recent executions')));
  wrapper.appendChild(kvItem('Status', textOr(latest.status, 'Unknown')));
  wrapper.appendChild(kvItem('Symbol', textOr(latest.symbol ?? latest.ticker, 'Unknown')));
  wrapper.appendChild(kvItem('Side', textOr(latest.side ?? latest.action, 'Unknown')));
  wrapper.appendChild(kvItem('Quantity', textOr(formatNumberish(latest.qty ?? latest.quantity ?? latest.size), 'N/A')));
  wrapper.appendChild(kvItem('PnL', textOr(formatNumberish(latest.pnl_abs ?? latest.pnlAbs ?? latest.pnl), 'N/A')));
  wrapper.appendChild(kvItem('Timestamp', formatDateTime(firstDefined(latest.timestamp_utc, latest.timestampUtc, latest.timestamp, latest.exit_timestamp_utc), true)));

  container.appendChild(wrapper);
}

function renderKeyValues(container, rows) {
  container.innerHTML = '';
  for (const [label, value] of rows) {
    container.appendChild(kvItem(label, value));
  }
}

function kvItem(label, value) {
  const wrap = document.createElement('div');
  wrap.className = 'kv';
  const dt = document.createElement('dt');
  dt.textContent = label;
  const dd = document.createElement('dd');
  dd.textContent = textOr(value, 'N/A');
  wrap.append(dt, dd);
  return wrap;
}

function pickExecutions(data) {
  const source = firstDefined(data.executions_recent, data.executionsRecent, data.execution_latest, data.executionLatest, []);
  if (Array.isArray(source)) {
    return source;
  }
  if (source && typeof source === 'object') {
    return [source];
  }
  return [];
}

function pickObject(data, keys) {
  for (const key of keys) {
    const value = data?.[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value;
    }
  }
  return {};
}

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }
  return undefined;
}

function asBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'on', 'running', 'go'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n', 'off', 'stopped', 'stop', 'no-go'].includes(normalized)) return false;
  }
  return fallback;
}

function boolLabel(value, fallback = true) {
  const resolved = asBool(value, fallback);
  return resolved ? 'true' : 'false';
}

function textOr(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'object') return safeStringify(value);
  return String(value);
}

function formatNumberish(value) {
  if (value === undefined || value === null || value === '') return 'N/A';
  if (typeof value === 'number' && Number.isFinite(value)) return Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  const parsed = Number(value);
  if (Number.isFinite(parsed)) return Number.isInteger(parsed) ? String(parsed) : parsed.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  return String(value);
}

function formatDateTime(value, fallbackToUnknown = false) {
  if (!value) return fallbackToUnknown ? 'Unknown' : 'N/A';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return fallbackToUnknown ? 'Unknown' : 'N/A';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(date);
}

function safeStringify(value) {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return '{}';
  }
}

function setBadge(element, text, className) {
  element.textContent = text;
  element.className = `badge ${className}`;
}

function setError(message) {
  if (!message) {
    els.errorBanner.hidden = true;
    els.errorBanner.textContent = '';
    return;
  }
  els.errorBanner.hidden = false;
  els.errorBanner.textContent = message;
}
