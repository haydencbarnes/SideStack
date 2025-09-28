import { nanoid } from './vendor/nanoid.js';

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

const DEFAULT_SPACE = (name = 'Default') => ({
  id: nanoid(),
  name,
  theme: createDefaultTheme(),
  pinnedTabIds: [],
  suspendedTabs: [],
  savedTabGroups: [],
  createdAt: Date.now(),
});

const STORAGE_KEY = 'sidestack_state_v1';
const TABS_CACHE_KEY = 'sidestack_tabs_cache_v1';

async function getState() {
  const { [STORAGE_KEY]: state } = await chrome.storage.local.get(STORAGE_KEY);
  if (!state) {
    const initial = {
      spaces: [DEFAULT_SPACE()],
      activeSpaceId: null,
    };
    await chrome.storage.local.set({ [STORAGE_KEY]: initial });
    return initial;
  }
  return normalizeState(state);
}

async function setState(nextState) {
  await chrome.storage.local.set({ [STORAGE_KEY]: normalizeState(nextState) });
}

async function ensureActiveSpace(state) {
  if (
    state.activeSpaceId &&
    state.spaces.some((s) => s.id === state.activeSpaceId)
  ) {
    return state;
  }
  const first = state.spaces[0];
  const withActive = { ...state, activeSpaceId: first?.id ?? null };
  await setState(withActive);
  return withActive;
}

function normalizeState(state) {
  const spaces = (state.spaces ?? []).map(normalizeSpace);
  return {
    ...state,
    spaces,
  };
}

function normalizeSpace(space) {
  const theme = space.theme ? mergeTheme(space.theme) : createDefaultTheme();
  const suspendedTabs = (space.suspendedTabs ?? []).map((tab) => ({
    id: tab.id,
    url: tab.url ?? null,
    title: tab.title ?? null,
    favIconUrl: tab.favIconUrl ?? null,
    windowId: tab.windowId ?? null,
    index: tab.index ?? null,
  }));
  const legacySuspended = (space.suspendedTabIds ?? []).map((id) => ({ id }));

  return {
    id: space.id ?? nanoid(),
    name: space.name ?? 'Untitled',
    theme,
    pinnedTabIds: Array.isArray(space.pinnedTabIds) ? space.pinnedTabIds : [],
    suspendedTabs: suspendedTabs.length ? suspendedTabs : legacySuspended,
    savedTabGroups: Array.isArray(space.savedTabGroups)
      ? space.savedTabGroups
      : [],
    createdAt: space.createdAt ?? Date.now(),
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
        .then(ensureActiveSpace)
        .then((state) => sendResponse({ ok: true, state }))
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;

    case 'CREATE_SPACE':
      handleCreateSpace(payload)
        .then((state) => sendResponse({ ok: true, state }))
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;

    case 'RENAME_SPACE':
      handleRenameSpace(payload)
        .then((state) => sendResponse({ ok: true, state }))
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;

    case 'DELETE_SPACE':
      handleDeleteSpace(payload)
        .then((state) => sendResponse({ ok: true, state }))
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;

    case 'SET_ACTIVE_SPACE':
      handleSetActiveSpace(payload)
        .then((state) => sendResponse({ ok: true, state }))
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;

    case 'PIN_TAB':
      handlePinTab(payload)
        .then((state) => sendResponse({ ok: true, state }))
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;

    case 'UNPIN_TAB':
      handleUnpinTab(payload)
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

    case 'DEDUPE_TABS':
      handleDedupeTabs(payload)
        .then((state) => sendResponse({ ok: true, state }))
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;

    case 'SAVE_TAB_GROUP':
      handleSaveTabGroup(payload)
        .then((state) => sendResponse({ ok: true, state }))
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;

    case 'RESTORE_TAB_GROUP':
      handleRestoreTabGroup(payload)
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

async function handleCreateSpace({ name }) {
  const state = await getState();
  const newSpace = DEFAULT_SPACE(name);
  const nextState = {
    ...state,
    spaces: [...state.spaces, newSpace],
    activeSpaceId: newSpace.id,
  };
  await setState(nextState);
  return nextState;
}

async function handleRenameSpace({ id, name }) {
  const state = await getState();
  const spaces = state.spaces.map((space) =>
    space.id === id ? { ...space, name } : space,
  );
  const nextState = { ...state, spaces };
  await setState(nextState);
  return nextState;
}

async function handleDeleteSpace({ id }) {
  const state = await getState();
  const spaces = state.spaces.filter((space) => space.id !== id);
  const nextState = {
    spaces,
    activeSpaceId: spaces[0]?.id ?? null,
  };
  await setState(nextState);
  return nextState;
}

async function handleSetActiveSpace({ id }) {
  const state = await getState();
  if (!state.spaces.some((space) => space.id === id)) {
    throw new Error('Space not found');
  }
  const nextState = { ...state, activeSpaceId: id };
  await setState(nextState);
  return nextState;
}

async function handlePinTab({ tabId }) {
  const state = await ensureActiveSpace(await getState());
  const activeSpace = state.spaces.find(
    (space) => space.id === state.activeSpaceId,
  );
  if (!activeSpace) {
    throw new Error('No active space');
  }
  await chrome.tabs.update(tabId, { pinned: true });
  const space = {
    ...activeSpace,
    pinnedTabIds: dedupe([...activeSpace.pinnedTabIds, tabId]),
  };
  const spaces = state.spaces.map((s) => (s.id === space.id ? space : s));
  const nextState = { ...state, spaces };
  await setState(nextState);
  return nextState;
}

async function handleUnpinTab({ tabId }) {
  const state = await ensureActiveSpace(await getState());
  const activeSpace = state.spaces.find(
    (space) => space.id === state.activeSpaceId,
  );
  if (!activeSpace) {
    throw new Error('No active space');
  }
  await chrome.tabs.update(tabId, { pinned: false });
  const space = {
    ...activeSpace,
    pinnedTabIds: activeSpace.pinnedTabIds.filter((id) => id !== tabId),
  };
  const spaces = state.spaces.map((s) => (s.id === space.id ? space : s));
  const nextState = { ...state, spaces };
  await setState(nextState);
  return nextState;
}

async function handleSuspendTab({ tabId }) {
  const state = await ensureActiveSpace(await getState());
  const activeSpace = state.spaces.find(
    (space) => space.id === state.activeSpaceId,
  );
  if (!activeSpace) {
    throw new Error('No active space');
  }

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

  const space = {
    ...activeSpace,
    suspendedTabs: upsertSuspended(
      activeSpace.suspendedTabs ?? [],
      suspendedTab,
    ),
  };

  const spaces = state.spaces.map((s) => (s.id === space.id ? space : s));
  const nextState = { ...state, spaces };
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

function dedupe(items) {
  return [...new Set(items)];
}

async function handleRestoreSuspendedTab({ tabId }) {
  const state = await ensureActiveSpace(await getState());
  const activeSpace = state.spaces.find(
    (space) => space.id === state.activeSpaceId,
  );
  if (!activeSpace) {
    throw new Error('No active space');
  }

  await chrome.tabs.reload(tabId);

  const space = {
    ...activeSpace,
    suspendedTabs: (activeSpace.suspendedTabs ?? []).filter(
      (tab) => tab.id !== tabId,
    ),
  };

  const spaces = state.spaces.map((s) => (s.id === space.id ? space : s));
  const nextState = { ...state, spaces };
  await setState(nextState);
  return nextState;
}

async function handleDedupeTabs({ spaceId }) {
  const state = await getState();
  const space = state.spaces.find((s) => s.id === spaceId);
  if (!space) {
    throw new Error('Space not found');
  }

  const tabs = await chrome.tabs.query({});
  const seen = new Map();
  const duplicates = [];

  for (const tab of tabs) {
    const key = normalizeUrl(tab.url ?? '');
    if (!key) {
      continue;
    }
    if (seen.has(key)) {
      duplicates.push(tab.id);
    } else {
      seen.set(key, tab.id);
    }
  }

  await Promise.all(
    duplicates.map((id) =>
      chrome.tabs.remove(id).catch(() => {
        // ignore if already closed
      }),
    ),
  );

  return state;
}

function normalizeUrl(url) {
  try {
    const { origin, pathname } = new URL(url);
    return `${origin}${pathname}`;
  } catch {
    return null;
  }
}

async function handleSaveTabGroup({ name }) {
  const state = await ensureActiveSpace(await getState());
  const activeSpace = state.spaces.find(
    (space) => space.id === state.activeSpaceId,
  );
  if (!activeSpace) {
    throw new Error('No active space');
  }

  const tabs = await chrome.tabs.query({ currentWindow: true });
  const groups = await chrome.tabGroups.query({});

  const tabsByGroup = new Map();
  for (const tab of tabs) {
    if (!tabsByGroup.has(tab.groupId)) {
      tabsByGroup.set(tab.groupId, []);
    }
    tabsByGroup.get(tab.groupId).push(tab);
  }

  const savedGroupTabs = [];
  for (const group of groups) {
    if (!tabsByGroup.has(group.id)) {
      continue;
    }
    savedGroupTabs.push({
      groupId: group.id,
      id: nanoid(),
      name: group.title ?? name ?? 'Untitled Group',
      color: group.color,
      collapsed: group.collapsed,
      tabs: tabsByGroup.get(group.id).map((tab) => ({
        id: tab.id,
        url: tab.url,
        title: tab.title,
        favIconUrl: tab.favIconUrl,
      })),
    });
  }

  const space = {
    ...activeSpace,
    savedTabGroups: savedGroupTabs,
  };

  const spaces = state.spaces.map((s) => (s.id === space.id ? space : s));
  const nextState = { ...state, spaces };
  await setState(nextState);
  return nextState;
}

async function handleRestoreTabGroup({ groupId }) {
  const state = await ensureActiveSpace(await getState());
  const activeSpace = state.spaces.find(
    (space) => space.id === state.activeSpaceId,
  );
  if (!activeSpace) {
    throw new Error('No active space');
  }

  const savedGroup = activeSpace.savedTabGroups.find(
    (group) => group.id === groupId,
  );
  if (!savedGroup) {
    throw new Error('Saved group not found');
  }

  const tabIds = [];
  for (const tab of savedGroup.tabs) {
    const created = await chrome.tabs.create({ url: tab.url, pinned: false });
    tabIds.push(created.id);
  }

  const newGroupId = await chrome.tabs.group({ tabIds });
  await chrome.tabGroups.update(newGroupId, {
    title: savedGroup.name,
    color: savedGroup.color,
    collapsed: savedGroup.collapsed,
  });

  return state;
}

async function handleGroupTabsByDomain({ _spaceId }) {
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
  const state = await ensureActiveSpace(await getState());

  // Move the tab to the new position using Chrome API
  await chrome.tabs.move(tabId, { index: newIndex });

  // Return the updated state (tabs will be refreshed on the frontend)
  return state;
}

async function handleUpdateTheme({ spaceId, theme }) {
  const state = await getState();
  const spaces = state.spaces.map((space) =>
    space.id === spaceId
      ? { ...space, theme: { ...space.theme, ...theme } }
      : space,
  );
  const nextState = { ...state, spaces };
  await setState(nextState);
  return nextState;
}

chrome.runtime.onInstalled.addListener(async () => {
  const state = await getState();

  // Migration: Update old default accent color to new default
  const migratedSpaces = state.spaces.map((space) => {
    if (space.theme?.palette?.accent === '#22d3ee') {
      return {
        ...space,
        theme: {
          ...space.theme,
          palette: {
            ...space.theme.palette,
            accent: '#D3E3FE',
          },
        },
      };
    }
    return space;
  });

  if (migratedSpaces.some((space, index) => space !== state.spaces[index])) {
    await setState({ ...state, spaces: migratedSpaces });
  }

  await ensureActiveSpace(state);
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
