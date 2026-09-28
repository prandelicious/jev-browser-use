import { ALLOWLISTED_CHROME_DEVTOOLS_TOOLS } from '../contract.mjs';
import { ChromeSessionError } from './session.mjs';

const ALLOWLIST = new Set(ALLOWLISTED_CHROME_DEVTOOLS_TOOLS);
const PAGE_SCOPED_TOOLS = new Set(['take_snapshot', 'click', 'navigate_page']);

export class ChromeActionPolicyError extends Error {
  constructor(message, { code = 'policy_denied' } = {}) {
    super(message);
    this.name = 'ChromeActionPolicyError';
    this.code = code;
  }
}

export function assertToolAllowlisted(toolName) {
  if (!ALLOWLIST.has(toolName)) {
    throw new ChromeActionPolicyError(`Tool is not allowlisted: ${toolName}`, {
      code: 'policy_denied',
    });
  }
}

export function isAllowlistedTool(toolName) {
  return ALLOWLIST.has(toolName);
}

export async function invokeChromeTool(session, toolName, args = {}, { allowedOrigins } = {}) {
  assertToolAllowlisted(toolName);
  const origins = allowedOrigins ?? session.allowedOrigins;
  if (toolName === 'list_pages') {
    return session.listPages();
  }
  if (toolName === 'select_page') {
    const pageId = args.pageId;
    if (typeof pageId !== 'string' || !pageId) {
      throw new ChromeActionPolicyError('select_page requires pageId', { code: 'policy_denied' });
    }
    return session.bindPage(pageId, origins);
  }
  if (PAGE_SCOPED_TOOLS.has(toolName)) {
    if (!session.binding) {
      throw new ChromeActionPolicyError('No page is bound', { code: 'unbound' });
    }
    await session.refreshBinding(origins);
    return session.callTool(toolName, args, { requireBinding: true, allowedOrigins: origins });
  }
  throw new ChromeActionPolicyError(`Unsupported allowlisted tool: ${toolName}`, {
    code: 'policy_denied',
  });
}

export async function listPages(session) {
  return invokeChromeTool(session, 'list_pages');
}

export async function bindPage(session, pageId, allowedOrigins) {
  try {
    return await invokeChromeTool(session, 'select_page', { pageId }, { allowedOrigins });
  } catch (error) {
    rethrowAsPolicy(error);
  }
}

export async function takeSnapshot(session, allowedOrigins) {
  try {
    return await invokeChromeTool(session, 'take_snapshot', {}, { allowedOrigins });
  } catch (error) {
    rethrowAsPolicy(error);
  }
}

export async function clickByUid(session, uid, allowedOrigins) {
  if (typeof uid !== 'string' || !uid) {
    throw new ChromeActionPolicyError('click requires uid', { code: 'policy_denied' });
  }
  try {
    return await invokeChromeTool(session, 'click', { uid }, { allowedOrigins });
  } catch (error) {
    rethrowAsPolicy(error);
  }
}

export async function navigatePage(session, url, allowedOrigins) {
  if (typeof url !== 'string' || !url) {
    throw new ChromeActionPolicyError('navigate_page requires url', { code: 'policy_denied' });
  }
  return invokeChromeTool(session, 'navigate_page', { url }, { allowedOrigins });
}

export function rethrowAsPolicy(error) {
  if (error instanceof ChromeActionPolicyError) throw error;
  if (
    error instanceof ChromeSessionError &&
    ['unbound', 'wrong_origin', 'wrong_page', 'page_closed'].includes(error.code)
  ) {
    throw new ChromeActionPolicyError(error.message, { code: error.code });
  }
  throw error;
}
