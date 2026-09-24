/**
 * Frozen host-facing task contract for the Chrome DevTools MCP path (slice 0).
 * Production and test code import these exports; do not widen without updating contract tests.
 */

/** Exact pin for slice 2 lockfile; the npm "latest" dist-tag is not a pin. */
export const CHROME_DEVTOOLS_MCP_PIN = {
  packageName: 'chrome-devtools-mcp',
  version: '1.9.0',
  spec: 'chrome-devtools-mcp@1.9.0',
  /**
   * Owned isolated profile inside the VM (default for tests and first release).
   * Verified against chrome-devtools-mcp@1.9.0 CLI --help.
   */
  launchArgv: [
    'chrome-devtools-mcp@1.9.0',
    '--isolated',
    '--headless',
    '--no-usage-statistics',
  ],
  launchCommand: 'npx chrome-devtools-mcp@1.9.0 --isolated --headless --no-usage-statistics',
  /** engines.node from chrome-devtools-mcp@1.9.0 package.json */
  chromeDevtoolsMcpNodeRange: '^20.19.0 || ^22.12.0 || >=23',
  /** engines.node from jev-browser-use package.json */
  jevNodeRange: '>=22',
  /**
   * chrome-devtools-mcp@1.9.0 README: Google Chrome current stable or newer.
   * autoConnect requires Chrome 144+ (CLI help); isolated launch uses Puppeteer-bundled or system Chrome.
   */
  chromeRequirement:
    'Google Chrome current stable or newer (chrome-devtools-mcp@1.9.0 README); Chrome 144+ for --autoConnect only',
};

/**
 * Tool names confirmed by reading build/src/tools/*.js in the installed
 * chrome-devtools-mcp@1.9.0 package (npm pack 1.9.0 on this VM, 2026-09-24).
 * Not verified via live MCP tools/list in slice 0 (no child spawn in this slice).
 */
export const CHROME_DEVTOOLS_MCP_1_9_0_ALL_TOOL_NAMES = [
  'click',
  'click_at',
  'close_page',
  'close_heapsnapshot',
  'compare_heapsnapshots',
  'drag',
  'emulate',
  'evaluate_script',
  'execute_3p_developer_tool',
  'execute_webmcp_tool',
  'fill',
  'fill_form',
  'get_console_message',
  'get_heapsnapshot_class_nodes',
  'get_heapsnapshot_details',
  'get_heapsnapshot_dominators',
  'get_heapsnapshot_duplicate_strings',
  'get_heapsnapshot_edges',
  'get_heapsnapshot_object_details',
  'get_heapsnapshot_retainers',
  'get_heapsnapshot_retaining_paths',
  'get_heapsnapshot_summary',
  'get_network_request',
  'get_os_app_state',
  'get_tab_id',
  'handle_dialog',
  'hover',
  'install_extension',
  'install_pwa',
  'launch_pwa',
  'lighthouse_audit',
  'list_3p_developer_tools',
  'list_extensions',
  'list_network_requests',
  'list_pages',
  'list_webmcp_tools',
  'navigate_page',
  'new_page',
  'performance_analyze_insight',
  'performance_start_trace',
  'performance_stop_trace',
  'press_key',
  'query_heapsnapshot_objects',
  'reload_extension',
  'resize_page',
  'screencast_start',
  'screencast_stop',
  'select_page',
  'take_heapsnapshot',
  'take_screenshot',
  'take_snapshot',
  'trigger_extension_action',
  'type_text',
  'uninstall_extension',
  'uninstall_pwa',
  'upload_file',
  'wait_for',
];

/** Initial allowlisted Chrome DevTools MCP tools for the Jev product loop. */
export const ALLOWLISTED_CHROME_DEVTOOLS_TOOLS = [
  'list_pages',
  'select_page',
  'take_snapshot',
  'click',
  'navigate_page',
];

export const HOST_TOOL_NAME = 'run_browser_task';

export const TASK_REQUEST_FIELDS = [
  'goal',
  'allowedOrigins',
  'page',
  'maxActions',
  'maxDurationMs',
  'allowedMechanicalActions',
];

export const TASK_STATUSES = [
  'completed',
  'handoff',
  'stale_state',
  'policy_denied',
  'timeout',
  'error',
];

/** Conservative server-side caps; page content cannot raise these. */
export const SERVER_CAPS = {
  defaultMaxActions: 12,
  maxMaxActions: 20,
  defaultMaxDurationMs: 90_000,
  maxMaxDurationMs: 120_000,
  maxRetries: 2,
  minConfidence: 0.55,
};

/** Default mechanical-action set for slice 0+ (semantic click, bounded navigation). */
export const DEFAULT_MECHANICAL_ACTIONS = ['semantic_click', 'navigate'];

export const NON_GOALS = [
  'second_browser_adapter',
  'generic_BrowserAdapter_public_interface',
  'routine_evaluate_script',
  'coordinate_click_click_at',
  'network_inspection_tools',
  'arbitrary_cdp',
  'silent_autoConnect',
  'gui_computer_use_as_browser',
  ['mcp__', 'cua', '_repl_as_chrome_path'].join(''),
];

const LOOPBACK_HTTP_ORIGIN_RE =
  /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;

export function assertPinIsExact(pin = CHROME_DEVTOOLS_MCP_PIN) {
  if (!pin?.version || !/^\d+\.\d+\.\d+$/.test(pin.version)) {
    throw new Error('Pin must be an exact semver version');
  }
  const latestTag = '@' + 'latest';
  if (new RegExp(`${latestTag}\\b`, 'i').test(pin.spec ?? '') || new RegExp(`${latestTag}\\b`, 'i').test(pin.launchCommand ?? '')) {
    throw new Error(`Pin must not use ${latestTag}`);
  }
  if (pin.version !== '1.9.0') {
    throw new Error(`Unexpected pin version ${pin.version}`);
  }
}

export function validateTaskStatus(status) {
  if (!TASK_STATUSES.includes(status)) {
    throw new Error(`Invalid task status: ${status}`);
  }
}

export function validateAllowedOrigin(origin) {
  if (typeof origin !== 'string' || !origin) {
    throw new Error('Origin must be a non-empty string');
  }
  if (LOOPBACK_HTTP_ORIGIN_RE.test(origin)) {
    return;
  }
  let url;
  try {
    url = new URL(origin);
  } catch {
    throw new Error(`Invalid origin URL: ${origin}`);
  }
  if (url.protocol !== 'https:') {
    throw new Error(`Origin must be HTTPS or loopback HTTP for tests: ${origin}`);
  }
  if (url.username || url.password) {
    throw new Error('Origin must not embed credentials');
  }
}

export function validateAllowedOrigins(allowedOrigins) {
  if (!Array.isArray(allowedOrigins) || allowedOrigins.length === 0) {
    throw new Error('allowedOrigins must be a non-empty array');
  }
  for (const origin of allowedOrigins) {
    validateAllowedOrigin(origin);
  }
}

export function effectiveMaxActions(requested) {
  const n = Number(requested ?? SERVER_CAPS.defaultMaxActions);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error('maxActions must be a positive integer');
  }
  return Math.min(n, SERVER_CAPS.maxMaxActions);
}

export function effectiveMaxDurationMs(requested) {
  const n = Number(requested ?? SERVER_CAPS.defaultMaxDurationMs);
  if (!Number.isFinite(n) || n < 1) {
    throw new Error('maxDurationMs must be a positive number');
  }
  return Math.min(n, SERVER_CAPS.maxMaxDurationMs);
}

/**
 * `completed` means the bounded mechanical goal appears satisfied — not final user-task verification.
 */
export function validateTaskResultSemantics(result) {
  validateTaskStatus(result.status);
  if (result.status === 'completed') {
    if (result.finalUserVerification === true) {
      throw new Error('completed is not final user-task verification');
    }
    if (result.mechanicalGoalSatisfied !== true) {
      throw new Error('completed requires mechanicalGoalSatisfied');
    }
  }
  if (result.rawAccessibilityTree || result.pageText || result.secrets) {
    throw new Error('Public result must not include raw trees, page text, or secrets');
  }
}

export function validateRunBrowserTaskRequest(request) {
  if (!request || typeof request !== 'object') {
    throw new Error('Request must be an object');
  }
  if (typeof request.goal !== 'string' || !request.goal.trim()) {
    throw new Error('goal must be a non-empty host-approved bounded task');
  }
  if (/\bbrowse freely\b/i.test(request.goal)) {
    throw new Error('goal must not be a general browse-freely mandate');
  }
  validateAllowedOrigins(request.allowedOrigins);
  if (request.page !== undefined && typeof request.page !== 'string') {
    throw new Error('page must be a string pageId when provided');
  }
  effectiveMaxActions(request.maxActions);
  effectiveMaxDurationMs(request.maxDurationMs);
  const actions = request.allowedMechanicalActions ?? DEFAULT_MECHANICAL_ACTIONS;
  if (!Array.isArray(actions) || actions.length === 0) {
    throw new Error('allowedMechanicalActions must be a non-empty array');
  }
  for (const action of actions) {
    if (!DEFAULT_MECHANICAL_ACTIONS.includes(action)) {
      throw new Error(`Mechanical action not in default allowlist: ${action}`);
    }
  }
}

export function assertMechanicalActionNonGoals(actionId) {
  const forbidden = new Set([
    'evaluate_script',
    'click_at',
    'list_network_requests',
    'get_network_request',
    'arbitrary_cdp',
  ]);
  if (forbidden.has(actionId)) {
    throw new Error(`Non-goal action: ${actionId}`);
  }
}

export function originFromPageUrl(urlString) {
  try {
    return new URL(urlString).origin;
  } catch {
    return null;
  }
}
