function createDefaultTheme() {
  return {
    mode: 'system',
    palette: {
      primary: '#3b82f6',
      secondary: '#0ea5e9',
      accent: '#D3E3FE',
    },
  };
}

const STORAGE_KEY = 'sidestack_state_v1';
const TABS_CACHE_KEY = 'sidestack_tabs_cache_v1';

async function getState() {
  const { [STORAGE_KEY]: state } = await chrome.storage.local.get(STORAGE_KEY);
  if (!state) {
    const initial = {
      theme: createDefaultTheme(),
      suspendedTabs: [],
      savedTabGroups: [],
    };
    await chrome.storage.local.set({ [STORAGE_KEY]: initial });
    return initial;
  }
  return normalizeState(state);
}

async function setState(nextState) {
  await chrome.storage.local.set({ [STORAGE_KEY]: normalizeState(nextState) });
}

function normalizeState(state) {
  const theme = state.theme ? mergeTheme(state.theme) : createDefaultTheme();
  const suspendedTabs = (state.suspendedTabs ?? []).map((tab) => ({
    id: tab.id,
    url: tab.url ?? null,
    title: tab.title ?? null,
    favIconUrl: tab.favIconUrl ?? null,
    windowId: tab.windowId ?? null,
    index: tab.index ?? null,
  }));
  const legacySuspended = (state.suspendedTabIds ?? []).map((id) => ({ id }));

  return {
    theme,
    suspendedTabs: suspendedTabs.length ? suspendedTabs : legacySuspended,
    savedTabGroups: Array.isArray(state.savedTabGroups)
      ? state.savedTabGroups
      : [],
  };
}

function mergeTheme(theme) {
  const base = createDefaultTheme();
  return {
    ...base,
    ...theme,
    palette: {
      ...base.palette,
      ...(theme.palette ?? {}),
    },
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { type, payload } = message;

  switch (type) {
    case 'GET_STATE':
      getState()
        .then((state) => sendResponse({ ok: true, state }))
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;


    case 'SUSPEND_TAB':
      handleSuspendTab(payload)
        .then((state) => sendResponse({ ok: true, state }))
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;

    case 'RESTORE_SUSPENDED_TAB':
      handleRestoreSuspendedTab(payload)
        .then((state) => sendResponse({ ok: true, state }))
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;



    case 'GROUP_TABS_BY_DOMAIN':
      handleGroupTabsByDomain(payload)
        .then((state) => sendResponse({ ok: true, state }))
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;

    case 'UPDATE_THEME':
      handleUpdateTheme(payload)
        .then((state) => sendResponse({ ok: true, state }))
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;

    case 'MOVE_TAB':
      handleMoveTab(payload)
        .then((state) => sendResponse({ ok: true, state }))
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;

    case 'GET_CACHED_TABS':
      getCachedTabs()
        .then((cache) => sendResponse({ ok: true, cache }))
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;

    case 'CLEAR_TABS_CACHE':
      clearTabsCache()
        .then(() => sendResponse({ ok: true }))
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;

    default:
      break;
  }

  return false;
});

// Cache tabs when side panel is hidden
chrome.sidePanel?.onHidden?.addListener(async () => {
  try {
    await cacheCurrentTabs();
  } catch (error) {
    console.warn('Failed to cache tabs on side panel hide:', error);
  }
});

// Clear cache when side panel is shown (will be refreshed immediately)
chrome.sidePanel?.onShown?.addListener(async () => {
  // Cache will be cleared when popup requests fresh tabs
});

async function cacheCurrentTabs() {
  try {
    const currentWindow = await chrome.windows.getCurrent();
    const [tabs, groups] = await Promise.all([
      chrome.tabs.query({ windowId: currentWindow.id }),
      chrome.tabGroups.query({ windowId: currentWindow.id }),
    ]);

    const cache = {
      tabs: tabs.map(tab => ({
        id: tab.id,
        index: tab.index,
        windowId: tab.windowId,
        title: tab.title,
        url: tab.url,
        favIconUrl: tab.favIconUrl,
        pinned: tab.pinned,
        audible: tab.audible,
        mutedInfo: tab.mutedInfo,
        status: tab.status,
        discarded: tab.discarded,
        groupId: tab.groupId,
      })),
      groups: groups.map(group => ({
        id: group.id,
        title: group.title,
        color: group.color,
        collapsed: group.collapsed,
        windowId: group.windowId,
      })),
      timestamp: Date.now(),
      windowId: currentWindow.id,
    };

    await chrome.storage.local.set({ [TABS_CACHE_KEY]: cache });
  } catch (error) {
    console.warn('Failed to cache tabs:', error);
  }
}

async function getCachedTabs() {
  try {
    const { [TABS_CACHE_KEY]: cache } = await chrome.storage.local.get(TABS_CACHE_KEY);
    if (!cache) return null;

    // Check if cache is recent (within 30 seconds) and for current window
    const currentWindow = await chrome.windows.getCurrent();
    if (cache.windowId !== currentWindow.id ||
        Date.now() - cache.timestamp > 30000) {
      return null;
    }

    return cache;
  } catch (error) {
    console.warn('Failed to get cached tabs:', error);
    return null;
  }
}

async function clearTabsCache() {
  try {
    await chrome.storage.local.remove(TABS_CACHE_KEY);
  } catch (error) {
    console.warn('Failed to clear tabs cache:', error);
  }
}


// Note: Pin/unpin functionality removed as it was space-specific
// Chrome's built-in pinning is still available via context menu

async function handleSuspendTab({ tabId }) {
  const state = await getState();

  const tab = await chrome.tabs.get(tabId);
  await chrome.tabs.discard(tabId);

  const suspendedTab = {
    id: tabId,
    url: tab.url,
    title: tab.title,
    favIconUrl: tab.favIconUrl,
    windowId: tab.windowId,
    index: tab.index,
  };

  const nextState = {
    ...state,
    suspendedTabs: upsertSuspended(state.suspendedTabs ?? [], suspendedTab),
  };

  await setState(nextState);
  return nextState;
}

function upsertSuspended(list, suspendedTab) {
  const existingIndex = list.findIndex((tab) => tab.id === suspendedTab.id);
  if (existingIndex !== -1) {
    const next = list.slice();
    next[existingIndex] = suspendedTab;
    return next;
  }
  return [...list, suspendedTab];
}


async function handleRestoreSuspendedTab({ tabId }) {
  const state = await getState();

  await chrome.tabs.reload(tabId);

  const nextState = {
    ...state,
    suspendedTabs: (state.suspendedTabs ?? []).filter(
      (tab) => tab.id !== tabId,
    ),
  };

  await setState(nextState);
  return nextState;
}

// Note: Dedupe functionality removed as it was space-specific

function normalizeUrl(url) {
  try {
    const { origin, pathname } = new URL(url);
    return `${origin}${pathname}`;
  } catch {
    return null;
  }
}

// Note: Saved tab groups functionality removed as it was space-specific

async function handleGroupTabsByDomain({ }) {
  const state = await getState();
  const tabs = await chrome.tabs.query({ currentWindow: true });

  const domainMap = new Map();
  for (const tab of tabs) {
    const domain = getDomain(tab.url ?? '');
    if (!domain) {
      continue;
    }
    if (!domainMap.has(domain)) {
      domainMap.set(domain, []);
    }
    domainMap.get(domain).push(tab.id);
  }

  for (const [domain, tabIds] of domainMap.entries()) {
    if (tabIds.length < 2) {
      continue;
    }
    const groupId = await chrome.tabs.group({ tabIds });
    await chrome.tabGroups.update(groupId, {
      title: domain,
      color: pickColorForDomain(domain),
    });
  }

  return state;
}

function getDomain(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.hostname;
  } catch {
    return null;
  }
}

const TAB_GROUP_COLORS = [
  'grey',
  'blue',
  'red',
  'yellow',
  'green',
  'pink',
  'purple',
  'cyan',
  'orange',
];

function pickColorForDomain(domain) {
  let hash = 0;
  for (let i = 0; i < domain.length; i += 1) {
    hash = (hash << 5) - hash + domain.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % TAB_GROUP_COLORS.length;
  return TAB_GROUP_COLORS[index];
}

async function handleMoveTab({ tabId, newIndex }) {
  const state = await getState();

  // Move the tab to the new position using Chrome API
  await chrome.tabs.move(tabId, { index: newIndex });

  // Return the updated state (tabs will be refreshed on the frontend)
  return state;
}

async function handleUpdateTheme({ theme }) {
  const state = await getState();
  const nextState = {
    ...state,
    theme: { ...state.theme, ...theme },
  };
  await setState(nextState);
  return nextState;
}

chrome.runtime.onInstalled.addListener(async () => {
  const state = await getState();

  // Migration: Update old default accent color to new default
  if (state.theme?.palette?.accent === '#22d3ee') {
    await setState({
      ...state,
      theme: {
        ...state.theme,
        palette: {
          ...state.theme.palette,
          accent: '#D3E3FE',
        },
      },
    });
  }
  if (chrome.sidePanel?.setPanelBehavior) {
    try {
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    } catch (error) {
      console.warn('Failed to configure side panel behavior', error);
    }
  }
});

chrome.runtime.onStartup?.addListener(async () => {
  if (chrome.sidePanel?.setPanelBehavior) {
    try {
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    } catch (error) {
      console.warn('Failed to configure side panel behavior on startup', error);
    }
  }
});
