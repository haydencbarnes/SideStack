import { SettingsView } from '../settings/controller.js';

const SELECTORS = {
  app: '#app',
  tabsList: '#tabs',
  search: '#search',
  openSettings: '#open-settings',
  homeView: '#home-view',
  settingsView: '#settings-view',
  tabTemplate: '#tab-item-template',
  groupTemplate: '#group-item-template',
  contextMenu: '#context-menu',
  contextMenuOptions: '#context-menu-options',
};
const TAB_GROUP_ID_NONE = chrome.tabs?.TAB_GROUP_ID_NONE ?? -1;

const state = {
  tabs: [],
  tabGroups: [],
  context: {
    target: null,
    data: null,
    type: null,
  },
};

const refs = {};
const expandedGroupIds = new Set();
const newlyExpandedGroupIds = new Set();
let prefersColorSchemeMediaQuery = null;
let systemThemeListenerAttached = false;
let systemThemeChangeHandler = null;
let settingsViewInstance = null;
let activeView = 'home';

document.addEventListener('DOMContentLoaded', init);

async function init() {
  cacheRefs();
  attachEventHandlers();
  setupSystemThemeListener();
  await initSettingsPanel();
  await initialLoadState();
}

function cacheRefs() {
  Object.entries(SELECTORS).forEach(([key, selector]) => {
    if (selector.startsWith('#') || selector.startsWith('.')) {
      refs[key] = document.querySelector(selector);
    }
  });
}

function attachEventHandlers() {
  refs.search?.addEventListener('input', handleSearchInput);
  refs.openSettings?.addEventListener('click', handleOpenSettingsClick);
  refs.createTab?.addEventListener('click', handleCreateTab);
  document.addEventListener('click', handleGlobalClick);
  document.addEventListener('keydown', handleGlobalKeyDown);
  document.addEventListener('contextmenu', handleGlobalContextMenu);
  window.addEventListener('blur', closeContextMenu);

  // Listen for tab changes to keep the list updated
  chrome.tabs.onActivated.addListener(handleTabActivated);
  chrome.tabs.onUpdated.addListener(handleTabUpdated);
  chrome.tabs.onCreated.addListener(handleTabCreated);
  chrome.tabs.onRemoved.addListener(handleTabRemoved);

  // Listen for tab group changes
  chrome.tabGroups.onCreated.addListener(handleTabGroupCreated);
  chrome.tabGroups.onUpdated.addListener(handleTabGroupUpdated);
  chrome.tabGroups.onRemoved.addListener(handleTabGroupRemoved);
  if (chrome.tabGroups && chrome.tabGroups.onMoved) {
    chrome.tabGroups.onMoved.addListener(async () => {
      try {
        await refreshTabsView();
      } catch {}
    });
  }

  // Event delegation for group drops
  if (refs.tabsList) {
    refs.tabsList.addEventListener(
      'drop',
      async (event) => {
        event.preventDefault();
        const groupItem = event.target.closest('.group-item');
        if (groupItem) {
          const groupId = parseInt(groupItem.dataset.groupId);
          const group = state.tabGroups.find((g) => g.id === groupId);
          if (group) {
            const dragData = event.dataTransfer.getData('text/plain');
            if (dragData.startsWith('group:')) {
              handleGroupDrop(event, group);
            } else {
              const tabId = parseInt(dragData);
              if (!isNaN(tabId) && tabId > 0) {
                const tab = state.tabs.find((t) => t.id === tabId);
                if (tab && tab.groupId !== group.id) {
                  try {
                    await chrome.tabs.group({
                      tabIds: [tabId],
                      groupId: group.id,
                    });
                    await refreshTabsView();
                  } catch (error) {
                    console.error('Failed to move tab to group:', error);
                    notify('Failed to move tab to group');
                  }
                }
              }
            }
          }
        }
      },
      true,
    );

    refs.tabsList.addEventListener(
      'dragover',
      (event) => {
        const groupItem = event.target.closest('.group-item');
        if (groupItem) {
          const dragData = event.dataTransfer.getData('text/plain');
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          if (!dragData.startsWith('group:')) {
            // Tab drag over group
            groupItem.classList.add('tab-drop-target');
          } else {
            // Group drag over group, existing logic
            groupItem.classList.remove('tab-drop-target');
          }
        } else {
          // Clean up any tab-drop-target classes when not over a group
          document
            .querySelectorAll('.group-item.tab-drop-target')
            .forEach((item) => {
              item.classList.remove('tab-drop-target');
            });
        }
      },
      true,
    );

    // Also, add a dragleave listener to clean up the class
    refs.tabsList.addEventListener(
      'dragleave',
      (event) => {
        if (event.target.closest('.group-item')) {
          const groupItem = event.target.closest('.group-item');
          if (groupItem) {
            groupItem.classList.remove('tab-drop-target');
          }
        }
      },
      true,
    );
  }
}

async function initSettingsPanel() {
  if (!refs.settingsView) {
    return;
  }
  settingsViewInstance = new SettingsView({
    container: refs.settingsView,
    variant: 'inline',
    onClose: () => showView('home'),
    onChanged: () => refreshState(),
  });
  await settingsViewInstance.init();
}

function handleOpenSettingsClick() {
  showView('settings');
}

function showView(target) {
  if (activeView === target) {
    return;
  }
  const views = [
    { name: 'home', element: refs.homeView },
    { name: 'settings', element: refs.settingsView },
  ];
  views.forEach(({ name, element }) => {
    if (!element) {
      return;
    }
    const isActive = name === target;
    element.classList.toggle('view--active', isActive);
    if (isActive) {
      element.removeAttribute('hidden');
    } else {
      element.setAttribute('hidden', '');
    }
  });
  activeView = target;
  if (target === 'home') {
    refs.search?.focus({ preventScroll: true });
  }
}

async function initialLoadState() {
  refs.app?.classList.add('loading');
  try {
    await Promise.all([loadTabsWithCache(), renderAll()]);
  } catch (error) {
    console.error(error);
    notify(error.message);
  } finally {
    refs.app?.classList.remove('loading');
  }
}

async function refreshState() {
  refs.app?.classList.add('loading');
  try {
    await Promise.all([refreshTabsView(), renderAll()]);
  } catch (error) {
    console.error(error);
    notify(error.message);
  } finally {
    refs.app?.classList.remove('loading');
  }
}

async function loadTabsFromCache() {
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'GET_CACHED_TABS',
    });
    if (response.ok && response.cache) {
      state.tabs = response.cache.tabs.sort((a, b) => a.index - b.index);
      state.tabGroups = response.cache.groups;
      // Keep expanded group state local
      renderTabs();
      return true; // Successfully loaded from cache
    }
  } catch (error) {
    console.warn('Failed to load tabs from cache:', error);
  }
  return false; // No cache available
}

async function refreshTabsView() {
  const currentWindow = await chrome.windows.getCurrent();
  const [tabs, groups] = await Promise.all([
    chrome.tabs.query({ currentWindow: true }),
    chrome.tabGroups.query({ windowId: currentWindow.id }),
  ]);
  state.tabs = tabs.sort((a, b) => a.index - b.index);
  state.tabGroups = groups;
  // Keep expanded group state local
  renderTabs();
}

async function loadTabsWithCache() {
  // First try to load from cache for instant display
  const loadedFromCache = await loadTabsFromCache();

  // Always refresh immediately to get latest data
  await refreshTabsView();

  // Clear the cache since we've refreshed
  if (loadedFromCache) {
    try {
      await chrome.runtime.sendMessage({ type: 'CLEAR_TABS_CACHE' });
    } catch (error) {
      console.warn('Failed to clear tabs cache:', error);
    }
  }
}

async function handleTabActivated(activeInfo) {
  // Only refresh if this is for the current window
  const currentWindow = await chrome.windows.getCurrent();
  if (activeInfo.windowId === currentWindow.id) {
    await refreshTabsView();
  }
}

async function handleTabUpdated(tabId, changeInfo, tab) {
  // Only refresh if this is for the current window
  const currentWindow = await chrome.windows.getCurrent();
  if (tab.windowId === currentWindow.id) {
    await refreshTabsView();
  }
}

async function handleTabCreated(tab) {
  // Only refresh if this is for the current window
  const currentWindow = await chrome.windows.getCurrent();
  if (tab.windowId === currentWindow.id) {
    await refreshTabsView();
  }
}

async function handleTabRemoved(tabId, removeInfo) {
  // Only refresh if this is for the current window
  const currentWindow = await chrome.windows.getCurrent();
  if (removeInfo.windowId === currentWindow.id) {
    await refreshTabsView();
  }
}

async function handleTabGroupCreated(group) {
  // Only refresh if this is for the current window
  const currentWindow = await chrome.windows.getCurrent();
  if (group.windowId === currentWindow.id) {
    await refreshTabsView();
  }
}

async function handleTabGroupUpdated(group) {
  // Only refresh if this is for the current window
  const currentWindow = await chrome.windows.getCurrent();
  if (group.windowId === currentWindow.id) {
    await refreshTabsView();
  }
}

async function handleTabGroupRemoved(group) {
  // Only refresh if this is for the current window
  const currentWindow = await chrome.windows.getCurrent();
  if (group.windowId === currentWindow.id) {
    await refreshTabsView();
  }
}

async function renderAll() {
  await renderMode();
  renderTabs();
  applySearchFilter();
}

async function renderMode() {
  const body = document.body;
  const app = refs.app;
  const settings = await getSettings();

  // Apply theme settings
  const mode = settings?.themeMode ?? 'system';
  const prefersDark = getPrefersDarkMode();
  const useDark = mode === 'dark' || (mode === 'system' && prefersDark);

  body.classList.toggle('dark', useDark);
  body.classList.toggle('auto-dark', mode === 'system');

  // Apply compact mode settings
  const compactMode = settings?.compactMode ?? true;
  app?.classList.toggle('compact-mode', compactMode);

  // Remove any custom theme properties
  setCssCustomProperties({});
}

async function getSettings() {
  const response = await chrome.storage.local.get('sidestack_settings_v1');
  return (
    response?.sidestack_settings_v1 ?? {
      themeMode: 'system',
      compactMode: true,
    }
  );
}

function setupSystemThemeListener() {
  if (systemThemeListenerAttached) {
    return;
  }
  const mediaQuery = getPrefersColorSchemeMediaQuery();
  if (!mediaQuery) {
    return;
  }
  systemThemeChangeHandler = async () => {
    await renderMode();
  };
  if (typeof mediaQuery.addEventListener === 'function') {
    mediaQuery.addEventListener('change', systemThemeChangeHandler);
  } else if (typeof mediaQuery.addListener === 'function') {
    mediaQuery.addListener(systemThemeChangeHandler);
  }
  window.addEventListener('beforeunload', cleanupSystemThemeListener);
  systemThemeListenerAttached = true;
}

function cleanupSystemThemeListener() {
  if (
    !systemThemeListenerAttached ||
    !prefersColorSchemeMediaQuery ||
    !systemThemeChangeHandler
  ) {
    return;
  }
  const mediaQuery = prefersColorSchemeMediaQuery;
  if (typeof mediaQuery.removeEventListener === 'function') {
    mediaQuery.removeEventListener('change', systemThemeChangeHandler);
  } else if (typeof mediaQuery.removeListener === 'function') {
    mediaQuery.removeListener(systemThemeChangeHandler);
  }
  systemThemeListenerAttached = false;
  systemThemeChangeHandler = null;
}

function getPrefersColorSchemeMediaQuery() {
  if (
    !prefersColorSchemeMediaQuery &&
    typeof window !== 'undefined' &&
    window.matchMedia
  ) {
    prefersColorSchemeMediaQuery = window.matchMedia(
      '(prefers-color-scheme: dark)',
    );
  }
  return prefersColorSchemeMediaQuery;
}

function getPrefersDarkMode() {
  const mediaQuery = getPrefersColorSchemeMediaQuery();
  return !!mediaQuery?.matches;
}

function setCssCustomProperties(palette) {
  const root = document.documentElement;
  if (!palette) {
    return;
  }
  Object.entries(palette).forEach(([key, value]) => {
    root.style.setProperty(`--${key}`, value);
  });
}

function renderTabs() {
  const list = refs.tabsList;
  if (!list) {
    return;
  }
  list.innerHTML = '';
  const tabTemplate = document.querySelector(SELECTORS.tabTemplate);
  const groupTemplate = document.querySelector(SELECTORS.groupTemplate);
  if (!tabTemplate || !groupTemplate) {
    return;
  }
  const searchTerm = normalizedSearch();
  // Simplified: pinned tabs are handled at the top level
  const pinnedSet = new Set();
  const suspendedMap = new Map();

  // Create tabs by group mapping
  const tabsByGroup = new Map();
  for (const tab of state.tabs) {
    if (tab.groupId !== TAB_GROUP_ID_NONE) {
      if (!tabsByGroup.has(tab.groupId)) {
        tabsByGroup.set(tab.groupId, []);
      }
      tabsByGroup.get(tab.groupId).push(tab);
    }
  }

  // Separate pinned and unpinned tabs
  const pinnedTabs = [];
  const unpinnedTabs = [];

  // Add individual tabs (not in groups) - separate pinned/unpinned
  for (const tab of state.tabs) {
    if (tab.groupId === TAB_GROUP_ID_NONE) {
      const score = searchTerm
        ? fuzzyScore(searchTerm, `${tab.title ?? ''} ${tab.url ?? ''}`)
        : 1;
      if (score > 0) {
        const isPinned = tab.pinned || pinnedSet.has(tab.id);
        const tabItem = {
          type: 'tab',
          tab,
          position: tab.index,
          score,
          pinned: isPinned,
        };
        if (isPinned) {
          pinnedTabs.push(tabItem);
        } else {
          unpinnedTabs.push(tabItem);
        }
      }
    }
  }

  // Add groups (positioned by their first tab's index)
  const groupsToRender = [];
  for (const group of state.tabGroups) {
    const groupTabs = tabsByGroup.get(group.id) || [];
    if (groupTabs.length > 0) {
      const firstTab = groupTabs.reduce((earliest, tab) =>
        tab.index < earliest.index ? tab : earliest,
      );
      const score = searchTerm
        ? fuzzyScore(searchTerm, `${group.title ?? ''}`)
        : 1;
      if (score > 0) {
        groupsToRender.push({
          type: 'group',
          group,
          tabs: groupTabs,
          position: firstTab.index,
          score,
        });
      }
    }
  }

  // Sort all items by pinned status first, then by position/score
  const allItems = [...pinnedTabs, ...groupsToRender, ...unpinnedTabs];

  allItems.sort((a, b) => {
    // Pinned items come first
    const aIsPinned = a.type === 'tab' ? a.pinned : false;
    const bIsPinned = b.type === 'tab' ? b.pinned : false;

    if (aIsPinned && !bIsPinned) return -1;
    if (!aIsPinned && bIsPinned) return 1;

    // Within same pinned status, sort by score then position
    if (a.score !== b.score) return b.score - a.score;
    return a.position - b.position;
  });

  const itemsToRender = allItems;

  // Track if we've added the separator and new tab button
  let separatorAdded = false;
  let newTabButtonAdded = false;

  // Add new tab button at the beginning if no pinned tabs
  if (pinnedTabs.length === 0 && !newTabButtonAdded) {
    const newTabLi = document.createElement('li');
    newTabLi.className = 'new-tab-button';
    newTabLi.innerHTML =
      '<span class="material-symbols-outlined">add</span> New Tab';
    newTabLi.title = 'Open new tab';
    newTabLi.addEventListener('click', handleCreateTab);
    list.appendChild(newTabLi);
    newTabButtonAdded = true;
  }

  // Render items
  for (const item of itemsToRender) {
    // Add separator before first non-pinned item (either tab or group)
    const isItemPinned = item.type === 'tab' ? item.pinned : false;
    if (!isItemPinned && pinnedTabs.length > 0 && !separatorAdded) {
      const separator = document.createElement('div');
      separator.className = 'tabs-separator';
      list.appendChild(separator);
      separatorAdded = true;
    }

    // Add new tab button after separator
    if (
      !isItemPinned &&
      pinnedTabs.length > 0 &&
      separatorAdded &&
      !newTabButtonAdded
    ) {
      const newTabLi = document.createElement('li');
      newTabLi.className = 'new-tab-button';
      newTabLi.innerHTML =
        '<span class="material-symbols-outlined">add</span> New Tab';
      newTabLi.title = 'Open new tab';
      newTabLi.addEventListener('click', handleCreateTab);
      list.appendChild(newTabLi);
      newTabButtonAdded = true;
    }

    if (item.type === 'tab') {
      const clone = tabTemplate.content.firstElementChild.cloneNode(true);
      clone.dataset.tabId = item.tab.id;
      const favicon = clone.querySelector('.favicon');
      const title = clone.querySelector('.title');
      const audioIndicator = clone.querySelector('.audio-indicator');
      const badge = clone.querySelector('.badge');
      const suspended = suspendedMap.get(String(item.tab.id));
      if (favicon) {
        const iconSource = item.tab.favIconUrl ?? suspended?.favIconUrl;
        if (iconSource) {
          favicon.style.backgroundImage = `url(${iconSource})`;
          favicon.classList.remove('chrome-extensions');
        } else {
          // Use fallback for chrome:// URLs
          const fallbackIcon = getFallbackFavicon(item.tab.url);
          if (fallbackIcon) {
            const chromePageClass = getChromePageClass(item.tab.url);
            if (chromePageClass) {
              favicon.className = 'favicon chrome-icon ' + chromePageClass;
              favicon.style.backgroundImage = '';
            } else {
              favicon.style.backgroundImage = `url(${fallbackIcon})`;
              favicon.className = 'favicon';
            }
          }
        }
      }
      const displayTab = suspended ?? item.tab;
      if (title) {
        title.textContent = displayTab.title || displayTab.url || 'Untitled';
      }
      const isSuspendedByState = suspendedMap.has(String(item.tab.id));
      const isDiscarded = !!item.tab.discarded;
      const isSuspended = isSuspendedByState || isDiscarded;
      clone.classList.toggle('suspended', isSuspended);
      clone.classList.toggle('active', !!item.tab.active);
      clone.setAttribute('draggable', 'true');
      clone.addEventListener('dragstart', (event) =>
        handleTabDragStart(event, item.tab),
      );
      clone.addEventListener('dragend', (event) =>
        handleTabDragEnd(event, item.tab),
      );
      clone.addEventListener('dragover', (event) =>
        handleTabDragOver(event, item.tab),
      );
      clone.addEventListener('drop', (event) => handleTabDrop(event, item.tab));
      clone.addEventListener('click', () => {
        if (isSuspended) {
          restoreSuspendedTab(item.tab.id);
          return;
        }
        chrome.tabs.update(item.tab.id, { active: true });
      });
      const closeButton = clone.querySelector('.tab-close');
      if (closeButton) {
        closeButton.addEventListener('click', (event) => {
          event.stopPropagation();
          chrome.tabs.remove(item.tab.id).catch(() => {});
        });
      }
      clone.addEventListener('contextmenu', (event) =>
        openTabContextMenu(event, item.tab, isSuspended),
      );
      // Audio indicator - show when tab has audio playing
      if (audioIndicator) {
        audioIndicator.classList.toggle('show', item.tab.audible === true);
      }
      // Badge is no longer shown for individual tabs - pinned tabs are grouped at top
      if (badge) {
        badge.hidden = true;
      }
      list.appendChild(clone);
    } else if (item.type === 'group') {
      const clone = groupTemplate.content.firstElementChild.cloneNode(true);
      const toggleButton = clone.querySelector('.group-toggle');
      const title = clone.querySelector('.title');
      const tabsContainer = clone.querySelector('.group-tabs');
      clone.dataset.groupId = item.group.id;
      clone.setAttribute('draggable', 'true');

      const isExpanded = expandedGroupIds.has(item.group.id);
      clone.classList.toggle('expanded', isExpanded);
      toggleButton?.setAttribute('aria-expanded', String(isExpanded));

      // Update icon based on expanded state
      const iconElement = clone.querySelector('.group-icon');
      if (iconElement) {
        iconElement.textContent = isExpanded ? 'folder_open' : 'folder';
      }
      if (tabsContainer) {
        tabsContainer.innerHTML = '';
        // Let CSS handle visibility through height/opacity animations
      }

      if (item.group.color) {
        const colorHex = getGroupColorHex(item.group.color);
        clone.style.setProperty('--group-color', colorHex);
      }

      if (title) {
        const displayName =
          item.group.title && item.group.title.trim()
            ? item.group.title
            : 'Untitled Group';
        title.textContent = `${displayName} (${item.tabs.length})`;
      }

      if (tabsContainer && item.tabs.length && isExpanded) {
        item.tabs
          .map((tab) => ({
            tab,
            score: searchTerm
              ? fuzzyScore(searchTerm, `${tab.title ?? ''} ${tab.url ?? ''}`)
              : 1,
          }))
          .filter(({ score }) => score > 0)
          .sort((a, b) =>
            b.score === a.score ? a.tab.index - b.tab.index : b.score - a.score,
          )
          .forEach(({ tab }, index) => {
            const tabClone =
              tabTemplate.content.firstElementChild.cloneNode(true);
            tabClone.dataset.tabId = tab.id;
            // Add staggered animation only for newly expanded groups
            if (newlyExpandedGroupIds.has(item.group.id)) {
              tabClone.style.animation = `fadeInTab 0.28s cubic-bezier(0.4, 0, 0.2, 1) ${index * 50}ms forwards`;
            }
            const favicon = tabClone.querySelector('.favicon');
            const tabTitle = tabClone.querySelector('.title');
            const audioIndicator = tabClone.querySelector('.audio-indicator');
            const badge = tabClone.querySelector('.badge');
            if (favicon) {
              const iconSource = tab.favIconUrl;
              if (iconSource) {
                favicon.style.backgroundImage = `url(${iconSource})`;
                favicon.classList.remove('chrome-extensions');
              } else {
                // Use fallback for chrome:// URLs
                const fallbackIcon = getFallbackFavicon(tab.url);
                if (fallbackIcon) {
                  const chromePageClass = getChromePageClass(tab.url);
                  if (chromePageClass) {
                    favicon.className =
                      'favicon chrome-icon ' + chromePageClass;
                    favicon.style.backgroundImage = '';
                  } else {
                    favicon.style.backgroundImage = `url(${fallbackIcon})`;
                    favicon.className = 'favicon';
                  }
                }
              }
            }
            if (tabTitle) {
              tabTitle.textContent = tab.title || tab.url || 'Untitled';
            }
            // Audio indicator - show when tab has audio playing
            if (audioIndicator) {
              audioIndicator.classList.toggle('show', tab.audible === true);
            }
            // Badge is no longer shown for individual tabs - pinned tabs are grouped at top
            if (badge) {
              badge.hidden = true;
            }
            const isSuspended = !!tab.discarded;
            tabClone.classList.toggle('suspended', isSuspended);
            tabClone.classList.toggle('active', !!tab.active);
            tabClone.setAttribute('draggable', 'true');
            tabClone.addEventListener('dragstart', (event) =>
              handleTabDragStart(event, tab),
            );
            tabClone.addEventListener('dragend', (event) =>
              handleTabDragEnd(event, tab),
            );
            tabClone.addEventListener('dragover', (event) =>
              handleTabDragOver(event, tab),
            );
            tabClone.addEventListener('drop', (event) =>
              handleTabDrop(event, tab),
            );
            tabClone.addEventListener('click', () => {
              if (isSuspended) {
                restoreSuspendedTab(tab.id);
                return;
              }
              chrome.tabs.update(tab.id, { active: true });
            });
            const closeButton = tabClone.querySelector('.tab-close');
            if (closeButton) {
              closeButton.addEventListener('click', (event) => {
                event.stopPropagation();
                chrome.tabs.remove(tab.id).catch(() => {});
              });
            }
            tabClone.addEventListener('contextmenu', (event) =>
              openTabContextMenu(event, tab, isSuspended),
            );
            tabsContainer.appendChild(tabClone);
          });
      }

      toggleButton?.addEventListener('click', (event) => {
        event.stopPropagation();
        toggleGroupExpand(item.group.id);
      });

      clone.addEventListener('dragstart', (event) =>
        handleGroupDragStart(event, item.group),
      );
      clone.addEventListener('dragend', (event) =>
        handleGroupDragEnd(event, item.group),
      );
      clone.addEventListener('dragover', (event) =>
        handleGroupDragOver(event, item.group),
      );
      clone.addEventListener('contextmenu', (event) =>
        openGroupContextMenu(event, item.group),
      );
      list.appendChild(clone);
    }
  }

  // Clear newly expanded groups after rendering
  newlyExpandedGroupIds.clear();
}

function toggleGroupExpand(groupId) {
  const wasExpanded = expandedGroupIds.has(groupId);
  if (wasExpanded) {
    expandedGroupIds.delete(groupId);
  } else {
    expandedGroupIds.add(groupId);
    newlyExpandedGroupIds.add(groupId);
  }
  renderTabs();
}

async function handleCreateTab() {
  try {
    await chrome.tabs.create({});
  } catch (error) {
    console.error('Failed to create tab:', error);
    notify('Failed to create new tab');
  }
}

async function pinTab(tabId) {
  try {
    await chrome.tabs.update(tabId, { pinned: true });
    await refreshTabsView();
  } catch (error) {
    console.error('Failed to pin tab:', error);
    notify('Failed to pin tab');
  }
}

async function unpinTab(tabId) {
  try {
    await chrome.tabs.update(tabId, { pinned: false });
    await refreshTabsView();
  } catch (error) {
    console.error('Failed to unpin tab:', error);
    notify('Failed to unpin tab');
  }
}

async function suspendTab(tabId) {
  // Simplified: just discard the tab (Chrome's built-in suspension)
  try {
    await chrome.tabs.discard(tabId);
    await refreshTabsView();
  } catch (error) {
    console.error('Failed to suspend tab:', error);
    notify('Failed to suspend tab');
  }
}

async function restoreSuspendedTab(tabId) {
  // Simplified: just reload the tab
  try {
    await chrome.tabs.reload(tabId);
    await refreshTabsView();
  } catch (error) {
    console.error('Failed to restore tab:', error);
    notify('Failed to restore tab');
  }
}

function getGroupColorHex(color) {
  const colorMap = {
    grey: '#dadce0',
    blue: '#8ab4f8',
    red: '#f28b82',
    yellow: '#fdd663',
    green: '#81c995',
    pink: '#ff8bcb',
    purple: '#c58af9',
    cyan: '#78d9ec',
    orange: '#FDAE70',
  };
  return colorMap[color] || '#dadce0';
}

async function groupTabsByDomain() {
  // Simplified domain grouping
  const domainGroups = new Map();

  for (const tab of state.tabs) {
    if (tab.url && !tab.pinned) {
      try {
        const url = new URL(tab.url);
        const domain = url.hostname;
        if (!domainGroups.has(domain)) {
          domainGroups.set(domain, []);
        }
        domainGroups.get(domain).push(tab.id);
      } catch {
        // Skip invalid URLs
      }
    }
  }

  for (const [domain, tabIds] of domainGroups) {
    if (tabIds.length > 1) {
      try {
        const groupId = await chrome.tabs.group({ tabIds });
        await chrome.tabGroups.update(groupId, {
          title: domain,
        });
      } catch (error) {
        console.error(`Failed to group tabs for domain ${domain}:`, error);
      }
    }
  }

  await refreshTabsView();
}

function normalizedSearch() {
  const value = refs.search?.value?.trim().toLowerCase();
  return value ? value : '';
}

function handleSearchInput() {
  applySearchFilter();
}

function applySearchFilter() {
  renderTabs();
}

function notify(message) {
  if (!message) {
    return;
  }
  console.warn(message);
}

function getFallbackFavicon(url) {
  if (!url) return null;

  try {
    const urlObj = new URL(url);

    // Handle chrome:// URLs
    if (urlObj.protocol === 'chrome:') {
      const hostname = urlObj.hostname;
      const pathname = urlObj.pathname.replace(/^\//, ''); // Remove leading slash

      // Map common chrome:// pages to their favicon paths
      const chromeIconMap = {
        settings:
          'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTgiIGhlaWdodD0iMTgiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTE5IDEzaC02djZjMC0xLjEtLjktMi0yLTJIMTFjLTEuMSAwLTIgLjktMiAydjE2YzAgMS4xLjkgMiAyIDJoMnYySDR2LTJoMmgxYzEuMSAwIDItLjkgMi0ydi02YzAtMS4xLS45LTItMi0yaC02djYiIGZpbGw9IiM1RjYzNjgiLz4KPHBhdGggZD0iTTkgMTJINWMtMS4xIDAtMiAuOS0yIDJ2NmMwIDEuMS45IDIgMiAyaDI0YzEuMSAwIDItLjkgMi0ydi02YzAtMS4xLS45LTItMi0ySDl2LTZ6IiBmaWxsPSIjNUY2MzY4Ii8+Cjwvc3ZnPgo=',
        flags:
          'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTgiIGhlaWdodD0iMTgiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTQuNSA0SDN2MTZoMTRsLTMuNS01TDIxIDl2NmgtOGwxLjUtMnoiIGZpbGw9IiM1RjYzNjgiLz4KPHBhdGggZD0iTTQuNSA0SDN2MTZoMTRsLTMuNS01TDIxIDl2NmgtOGwxLjUtMnoiIGZpbGw9IiM1RjYzNjgiLz4KPC9zdmc+Cg==',
        bookmarks:
          'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTgiIGhlaWdodD0iMTgiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTE3IDNIN2EyIDIgMCAwMC0yIDJ2MTRhMiAyIDAgMDAyIDJoMTBhMiAyIDAgMDAyLTJOWg4VjN6bTAtNGg2YTIgMiAwIDAxMiAydjE0YTIgMiAwIDAxLTIgMkgxNWEyIDIgMCAwMS0yLTJOWg4VjN6IiBmaWxsPSIjNUY2MzY4Ii8+Cjwvc3ZnPgo=',
        history:
          'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTgiIGhlaWdodD0iMTgiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTEzIDN2NmgtM2YtNWMtMS4xIDAtMi0uOS0yLTJzLjktMiAyLTJoNnptMS0xMEgxMWEyIDIgMCAwMC0yIDJ2NmMwIDEuMS45IDIgMiAyaDI0YTIgMiAwIDAwMi0ydi02YzAtMS4xLS45LTItMi0yeiIgZmlsbD0iIzVGNjM2OCIvPgo8L3N2Zz4K',
        downloads:
          'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTgiIGhlaWdodD0iMTgiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTE5IDE5SDVhMiAyIDAgMDEtMi0yVjloMmEyIDIgMCAwMTIgMmgxNHYtNmgtNHYyaDEuNWMuNTIyIDAgMS4wMzYuMzQ3IDEuMzI1Ljg5NWwxLTNIMTdWMjJoMXYtM0g1YTIgMiAwIDAxLTIgLTJ6IiBmaWxsPSIjNUY2MzY4Ii8+Cjwvc3ZnPgo=',
        newtab:
          'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTgiIGhlaWdodD0iMTgiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTIyIDEyYzAgNS41Mi00LjQ4IDEwLTEwIDEwUzIgMTcuNTIgMiAxMlM2LjQ4IDIgMTIgMnMxMCA0LjQ4IDEwIDEwdi0ydi0ydi0ydi0yem0tMiAxMGMwIDMuODYtMy4xNCA3LTcgN3MtNy0zLjE0LTctN2gzVjEwaDV2NGg0djJINXYyem0tNSA3YzEuMSAwIDIgLjkgMiAyczLS45IDIyLTIgMnMtMi0uOS0yLTJ6IiBmaWxsPSIjNUY2MzY4Ii8+Cjwvc3ZnPgo=',
      };

      // Check for exact hostname matches first
      if (chromeIconMap[hostname]) {
        return chromeIconMap[hostname];
      }

      // Check for sub-path specific icons when on settings page
      if (hostname === 'settings') {
        const subPathMap = {
          passwords: 'chrome://settings/images/passwords_192.png',
          privacy: 'chrome://settings/images/privacy_192.png',
          accessibility: 'chrome://settings/images/accessibility_192.png',
        };

        for (const [key, icon] of Object.entries(subPathMap)) {
          if (pathname.includes(key)) {
            return icon;
          }
        }
      }

      // Default chrome icon for other chrome:// pages
      return 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTgiIGhlaWdodD0iMTgiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMTIiIGN5PSIxMiIgcj0iOSIgc3Ryb2tlPSIjNUY2MzY4IiBzdHJva2Utd2lkdGg9IjIiIGZpbGw9Im5vbmUiLz4KPHBhdGggZD0iTTEyIDJDMTMuMSAyIDE0IDIuOSAxNCA0VjhoNWMwIDEuMS0uOSAyLTIgMkg4Yy0xLjEgMC0yLS45LTItMnYyYzAtMS4xLjktMiAyLTJ6IiBmaWxsPSIjNUY2MzY4Ii8+Cjwvc3ZnPgo=';
    }

    // Handle other protocols (like chrome-extension://)
    if (urlObj.protocol === 'chrome-extension:') {
      return 'chrome://extension-icon/' + urlObj.host + '/128/0';
    }
  } catch {
    // Invalid URL, return null
    return null;
  }

  return null;
}

function getChromePageClass(url) {
  if (!url || !url.startsWith('chrome://')) return null;

  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;

    const chromePageMap = {
      extensions: 'chrome-extensions',
      settings: 'chrome-settings',
      flags: 'chrome-flags',
      bookmarks: 'chrome-bookmarks',
      history: 'chrome-history',
      downloads: 'chrome-downloads',
      newtab: 'chrome-newtab',
    };

    return chromePageMap[hostname] || null;
  } catch {
    return null;
  }
}

function fuzzyScore(query, text) {
  if (!query) {
    return 1;
  }
  if (!text) {
    return 0;
  }
  let score = 0;
  let textIndex = 0;
  const lowerQuery = query.toLowerCase();
  const lowerText = text.toLowerCase();
  for (let i = 0; i < lowerQuery.length; i += 1) {
    const char = lowerQuery[i];
    const found = lowerText.indexOf(char, textIndex);
    if (found === -1) {
      return 0;
    }
    score += 1;
    textIndex = found + 1;
  }
  return score;
}

// Expose selected helpers for debugging.
window.__SideStackDebug = {
  refreshState,
  refreshTabsView,
};

function handleGlobalClick(event) {
  // Only close if context menu is actually open
  if (!refs.contextMenu || !refs.contextMenu.classList.contains('open')) {
    return;
  }

  // Don't close if clicking inside the context menu
  if (refs.contextMenu.contains(event.target)) {
    return;
  }

  closeContextMenu();
}

function handleGlobalKeyDown(event) {
  // Close context menu on Escape key
  if (event.key === 'Escape' && refs.contextMenu?.classList.contains('open')) {
    closeContextMenu();
    event.preventDefault();
  }
}

function handleGlobalContextMenu(event) {
  if (
    !event.target.closest('.tab-item') &&
    !event.target.closest('.group-item')
  ) {
    closeContextMenu();
  }
}

function closeContextMenu() {
  if (!refs.contextMenu) {
    return;
  }

  // Remove visual highlighting from the context menu target
  if (state.context?.target) {
    state.context.target.classList.remove('context-menu-target');
  }

  refs.contextMenu.classList.remove('open');
  refs.contextMenu.setAttribute('aria-hidden', 'true');
  refs.contextMenuOptions.innerHTML = '';

  // Clear context state
  state.context = null;
}

function openTabContextMenu(event, tab, isSuspended = false) {
  event.preventDefault();
  openContextMenu(event, {
    type: 'tab',
    data: { tab, isSuspended },
  });
}

function openGroupContextMenu(event, group) {
  event.preventDefault();
  openContextMenu(event, {
    type: 'group',
    data: group,
  });
}

function openContextMenu(event, { type, data }) {
  if (!refs.contextMenu || !refs.contextMenuOptions) {
    return;
  }
  const { clientX, clientY } = event;
  state.context = { target: event.currentTarget, data, type };

  // Add visual highlighting to the context menu target
  if (state.context?.target) {
    state.context.target.classList.add('context-menu-target');
  }

  const options = buildContextMenuOptions(type, data);
  refs.contextMenuOptions.innerHTML = '';
  options.forEach((option) => {
    const li = document.createElement('li');
    li.textContent = option.label;
    li.setAttribute('role', 'menuitem');
    if (option.disabled) {
      li.setAttribute('aria-disabled', 'true');
      li.classList.add('disabled');
    }
    li.addEventListener('click', () => {
      if (option.disabled) {
        return;
      }
      option.onSelect();
      closeContextMenu();
    });
    refs.contextMenuOptions.appendChild(li);
  });

  // Position the menu with bounds checking
  positionContextMenu(clientX, clientY);

  refs.contextMenu.classList.add('open');
  refs.contextMenu.setAttribute('aria-hidden', 'false');
}

function positionContextMenu(x, y) {
  const menu = refs.contextMenu;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  // Temporarily position menu to measure its size
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  menu.style.visibility = 'hidden';
  menu.classList.add('open'); // Make it visible to measure

  const menuRect = menu.getBoundingClientRect();
  let left = x;
  let top = y;

  // Adjust horizontal position if menu would go off-screen
  if (left + menuRect.width > viewportWidth) {
    left = Math.max(10, viewportWidth - menuRect.width - 10);
  }

  // Adjust vertical position if menu would go off-screen
  if (top + menuRect.height > viewportHeight) {
    top = Math.max(10, viewportHeight - menuRect.height - 10);
  }

  // Ensure minimum distances from edges
  left = Math.max(10, left);
  top = Math.max(10, top);

  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  menu.style.visibility = 'visible';
}

function buildContextMenuOptions(type, data) {
  switch (type) {
    case 'tab':
      return buildTabOptions(data);
    case 'group':
      return buildGroupOptions(data);
    default:
      return [];
  }
}

// Define reusable operations that work on both individual tabs and groups
const TAB_OPERATIONS = {
  pin: {
    getLabel: (isPinned) => (isPinned ? 'Unpin' : 'Pin'),
    single: (tab) => (tab.pinned ? unpinTab(tab.id) : pinTab(tab.id)),
    group: async (group) => {
      const tabs = await getGroupTabs(group.id);
      const shouldPin = !tabs.every((tab) => tab.pinned); // Pin if not all are pinned
      await Promise.all(
        tabs.map((tab) => chrome.tabs.update(tab.id, { pinned: shouldPin })),
      );
      await refreshTabsView();
    },
    getGroupLabel: (group) => {
      // We could check if all tabs are pinned, but for simplicity, just use "Pin All Tabs"
      return 'Pin All Tabs';
    },
  },
  suspend: {
    getLabel: (isSuspended) => (isSuspended ? 'Restore' : 'Suspend'),
    single: (tab, isSuspended) =>
      isSuspended ? restoreSuspendedTab(tab.id) : suspendTab(tab.id),
    group: async (group) => {
      const tabs = await getGroupTabs(group.id);
      const suspendableTabs = tabs.filter((tab) => !tab.active);
      await Promise.all(
        suspendableTabs.map((tab) => chrome.tabs.discard(tab.id)),
      );
      await refreshTabsView();
    },
    groupLabel: 'Suspend All Tabs',
    singleDisabled: (tab, isSuspended) => !isSuspended && tab.active,
  },
  activate: {
    label: 'Activate',
    single: (tab) => chrome.tabs.update(tab.id, { active: true }),
    singleDisabled: (tab) => tab.active,
    tabsOnly: true, // Only available for individual tabs (not groups)
  },
  close: {
    label: 'Close Tab',
    single: async (tab) => {
      await chrome.tabs.remove(tab.id);
      await refreshTabsView();
    },
    group: async (group) => {
      const tabs = await getGroupTabs(group.id);
      await Promise.all(tabs.map((tab) => chrome.tabs.remove(tab.id)));
      await refreshTabsView();
    },
    groupLabel: 'Close All Tabs',
  },
  copyTitle: {
    label: 'Copy Title',
    single: (tab) => navigator.clipboard.writeText(tab.title || ''),
    tabsOnly: true,
  },
  copyUrl: {
    label: 'Copy URL',
    single: (tab) => navigator.clipboard.writeText(tab.url),
    tabsOnly: true,
  },
  duplicate: {
    label: 'Duplicate',
    single: async (tab) => {
      await chrome.tabs.duplicate(tab.id);
      await refreshTabsView();
    },
    group: async (group) => {
      const tabs = await getGroupTabs(group.id);
      await Promise.all(tabs.map((tab) => chrome.tabs.duplicate(tab.id)));
      await refreshTabsView();
    },
    groupLabel: 'Duplicate All Tabs',
  },
  moveToNewWindow: {
    label: 'Move to New Window',
    single: async (tab) => {
      await chrome.windows.create({ tabId: tab.id });
      await refreshTabsView();
    },
    group: async (group) => {
      const tabs = await getGroupTabs(group.id);
      if (tabs.length === 0) return;
      const newWindow = await chrome.windows.create({ tabId: tabs[0].id });
      if (tabs.length > 1) {
        await Promise.all(
          tabs
            .slice(1)
            .map((tab) =>
              chrome.tabs.move(tab.id, { windowId: newWindow.id, index: -1 }),
            ),
        );
      }
      await refreshTabsView();
    },
    groupLabel: 'Move Group to New Window',
  },
  reload: {
    label: 'Reload',
    single: (tab) => chrome.tabs.reload(tab.id),
    group: async (group) => {
      const tabs = await getGroupTabs(group.id);
      await Promise.all(tabs.map((tab) => chrome.tabs.reload(tab.id)));
    },
    groupLabel: 'Reload All Tabs',
  },
  groupByDomain: {
    label: 'Group Tabs by Domain',
    single: () => groupTabsByDomain,
    tabsOnly: true,
  },
};

function buildTabOptions({ tab, isSuspended }) {
  const options = [];

  // Add all operations that work on individual tabs (skip those marked tabsOnly)
  Object.entries(TAB_OPERATIONS).forEach(([key, operation]) => {
    // Skip operations that are only for tabs
    if (operation.tabsOnly) return;

    const option = {
      label: operation.label,
      onSelect: () => operation.single(tab, isSuspended),
    };

    if (operation.singleDisabled) {
      option.disabled = operation.singleDisabled(tab, isSuspended);
    }

    // Special case for activate - only show for suspended tabs
    if (key === 'activate' && !isSuspended) {
      return;
    }

    // Special case for pin - dynamic label
    if (key === 'pin') {
      option.label = operation.getLabel(tab.pinned);
    }

    // Special case for suspend - dynamic label and use isSuspended
    if (key === 'suspend') {
      option.label = operation.getLabel(isSuspended);
      option.disabled = operation.singleDisabled(tab, isSuspended);
    }

    options.push(option);
  });

  // Sort options alphabetically by label
  return options.sort((a, b) => a.label.localeCompare(b.label));
}

async function getGroupTabs(groupId) {
  return await chrome.tabs.query({ groupId: groupId });
}

function buildGroupOptions(group) {
  const options = [
    {
      label: group.collapsed ? 'Expand Group' : 'Collapse Group',
      onSelect: async () => {
        try {
          await chrome.tabGroups.update(group.id, {
            collapsed: !group.collapsed,
          });
          await refreshTabsView();
        } catch (error) {
          console.error('Failed to toggle group collapsed state:', error);
        }
      },
    },
    {
      label: 'Ungroup Tabs',
      onSelect: async () => {
        try {
          await chrome.tabs.ungroup(
            await chrome.tabs
              .query({ groupId: group.id })
              .then((tabs) => tabs.map((tab) => tab.id)),
          );
          await refreshTabsView();
        } catch (error) {
          console.error('Failed to ungroup tabs:', error);
        }
      },
    },
  ];

  // Add operations that work on groups (skip those marked tabsOnly)
  Object.entries(TAB_OPERATIONS).forEach(([key, operation]) => {
    // Skip operations that are only for individual tabs
    if (operation.tabsOnly) return;

    const option = {
      label: operation.groupLabel || operation.label,
      onSelect: () => operation.group(group),
    };

    // Special case for pin - use getGroupLabel if available
    if (key === 'pin' && operation.getGroupLabel) {
      option.label = operation.getGroupLabel(group);
    }

    options.push(option);
  });

  // Sort options alphabetically by label
  return options.sort((a, b) => a.label.localeCompare(b.label));
}

function handleTabDragStart(event, tab) {
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', tab.id.toString());
  event.currentTarget.classList.add('dragging');
}

function handleTabDragEnd(event, _tab) {
  event.currentTarget.classList.remove('dragging');

  // Remove drag-over classes from all items
  const tabItems = document.querySelectorAll('.tab-item');
  const groupItems = document.querySelectorAll('.group-item');
  tabItems.forEach((item) => {
    item.classList.remove('drag-over-above');
    item.classList.remove('drag-over-below');
  });
  groupItems.forEach((item) => {
    item.classList.remove('drag-over-above');
    item.classList.remove('drag-over-below');
    item.classList.remove('tab-drop-target');
  });
}

function handleTabDragOver(event, _tab) {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';

  const draggedElement = document.querySelector('.dragging');
  if (!draggedElement || draggedElement === event.currentTarget) {
    return;
  }

  // Check if we're dragging a tab (not a group)
  const dragData = event.dataTransfer.getData('text/plain');
  if (dragData.startsWith('group:')) {
    return; // Don't allow dropping groups on individual tabs
  }

  // Remove previous drag-over indicators
  const tabItems = document.querySelectorAll('.tab-item');
  tabItems.forEach((item) => {
    item.classList.remove('drag-over-above');
    item.classList.remove('drag-over-below');
  });

  // Determine if we're dropping above or below current item
  const rect = event.currentTarget.getBoundingClientRect();
  const midpoint = rect.top + rect.height / 2;
  const isAbove = event.clientY < midpoint;

  if (isAbove) {
    event.currentTarget.classList.add('drag-over-above');
  } else {
    event.currentTarget.classList.add('drag-over-below');
  }
}

async function handleTabDrop(event, targetTab) {
  event.preventDefault();

  const dragData = event.dataTransfer.getData('text/plain');

  // Handle group drops on individual tabs
  if (dragData.startsWith('group:')) {
    const draggedGroupId = parseInt(dragData.split(':')[1]);
    if (draggedGroupId > 0) {
      await handleGroupDropOnTab(event, targetTab, draggedGroupId);
      return;
    }
  }

  // Only handle tab drops, ignore group drops
  if (dragData.startsWith('group:')) {
    return;
  }

  const draggedTabId = parseInt(dragData);
  const targetTabId = targetTab.id;

  // Validate that we have valid tab IDs
  if (isNaN(draggedTabId) || draggedTabId <= 0) {
    console.error(
      'Invalid dragged tab ID:',
      draggedTabId,
      'from data:',
      dragData,
    );
    return;
  }

  if (draggedTabId === targetTabId) {
    return;
  }

  // Determine if we're inserting above or below the target
  const rect = event.currentTarget.getBoundingClientRect();
  const midpoint = rect.top + rect.height / 2;
  const insertAbove = event.clientY < midpoint;

  // Get fresh tab data to ensure we have current indices
  const currentWindow = await chrome.windows.getCurrent();
  const currentTabs = await chrome.tabs.query({ windowId: currentWindow.id });

  const targetTabData = currentTabs.find((tab) => tab.id === targetTabId);
  const draggedTabData = currentTabs.find((tab) => tab.id === draggedTabId);

  if (!targetTabData || !draggedTabData) {
    console.error('Could not find current tab data');
    return;
  }

  let newIndex;
  if (insertAbove) {
    newIndex = targetTabData.index;
  } else {
    newIndex = targetTabData.index + 1;
  }

  // Adjust for the dragged item being removed from its current position
  if (draggedTabData.index < newIndex) {
    newIndex -= 1;
  }

  // Ensure index is within valid bounds
  newIndex = Math.max(0, Math.min(newIndex, currentTabs.length - 1));

  try {
    await chrome.tabs.move(draggedTabId, { index: newIndex });
    await refreshTabsView();
  } catch (error) {
    console.error('Failed to move tab:', error, { draggedTabId, newIndex });
    notify('Failed to reorder tab: ' + error.message);
    await refreshTabsView(); // Refresh to reset UI state
  }
}

async function handleGroupDropOnTab(event, targetTab, draggedGroupId) {
  event.preventDefault();

  // Determine if we're inserting above or below the target tab
  const rect = event.currentTarget.getBoundingClientRect();
  const midpoint = rect.top + rect.height / 2;
  const insertAbove = event.clientY < midpoint;

  // Get fresh tab data
  const currentWindow = await chrome.windows.getCurrent();
  const currentTabs = await chrome.tabs.query({ windowId: currentWindow.id });

  // Get all tabs in the dragged group
  const draggedGroupTabs = currentTabs.filter(
    (tab) => tab.groupId === draggedGroupId,
  );
  if (draggedGroupTabs.length === 0) {
    return;
  }

  // Get the target tab's current index
  const targetTabData = currentTabs.find((tab) => tab.id === targetTab.id);
  if (!targetTabData) {
    return;
  }

  let targetIndex;
  if (insertAbove) {
    targetIndex = targetTabData.index;
  } else {
    targetIndex = targetTabData.index + 1;
  }

  // Adjust for the dragged group being removed from its current position
  const draggedFirstIndex = draggedGroupTabs.reduce((earliest, tab) =>
    tab.index < earliest.index ? tab : earliest,
  ).index;
  if (draggedFirstIndex < targetIndex) {
    targetIndex -= draggedGroupTabs.length;
  }

  // Ensure index is within valid bounds
  targetIndex = Math.max(
    0,
    Math.min(targetIndex, currentTabs.length - draggedGroupTabs.length),
  );

  console.log('Moving group to tab position:', {
    draggedGroupId,
    targetTabId: targetTab.id,
    targetIndex,
    insertAbove,
  });

  try {
    // Move all tabs in the dragged group to their new positions
    const tabIds = draggedGroupTabs.map((tab) => tab.id);
    await chrome.tabs.move(tabIds, { index: targetIndex });
    await refreshTabsView();
  } catch (error) {
    console.error('Failed to move group on tab:', error);
    notify('Failed to move group: ' + error.message);
    await refreshTabsView();
  }
}

function handleGroupDragStart(event, group) {
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', `group:${group.id}`);
  event.currentTarget.classList.add('dragging');
}

function handleGroupDragEnd(event, _group) {
  event.currentTarget.classList.remove('dragging');

  // Remove drag-over classes from all items
  const tabItems = document.querySelectorAll('.tab-item');
  const groupItems = document.querySelectorAll('.group-item');
  tabItems.forEach((item) => {
    item.classList.remove('drag-over-above');
    item.classList.remove('drag-over-below');
  });
  groupItems.forEach((item) => {
    item.classList.remove('drag-over-above');
    item.classList.remove('drag-over-below');
  });
}

function handleGroupDragOver(event, _group) {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';

  const draggedElement = document.querySelector('.dragging');
  if (!draggedElement || draggedElement === event.currentTarget) {
    return;
  }

  // Check if we're dragging a group (not a tab)
  const dragData = event.dataTransfer.getData('text/plain');
  if (!dragData.startsWith('group:')) {
    return; // Don't allow dropping tabs on groups
  }

  // Remove previous drag-over indicators
  const tabItems = document.querySelectorAll('.tab-item');
  const groupItems = document.querySelectorAll('.group-item');
  tabItems.forEach((item) => {
    item.classList.remove('drag-over-above');
    item.classList.remove('drag-over-below');
  });
  groupItems.forEach((item) => {
    item.classList.remove('drag-over-above');
    item.classList.remove('drag-over-below');
  });

  // Determine if we're dropping above or below current item
  const rect = event.currentTarget.getBoundingClientRect();
  const midpoint = rect.top + rect.height / 2;
  const isAbove = event.clientY < midpoint;

  if (isAbove) {
    event.currentTarget.classList.add('drag-over-above');
  } else {
    event.currentTarget.classList.add('drag-over-below');
  }
}

async function handleGroupDrop(event, targetGroup) {
  event.preventDefault();
  event.stopPropagation();

  const dragData = event.dataTransfer.getData('text/plain');

  if (!dragData.startsWith('group:')) {
    return; // Only handle group drops for now
  }

  const draggedGroupId = parseInt(dragData.split(':')[1]);
  const targetGroupId = targetGroup.id;

  if (draggedGroupId === targetGroupId) {
    return;
  }

  // Determine if we're inserting above or below the target
  const rect = event.currentTarget.getBoundingClientRect();
  const midpoint = rect.top + rect.height / 2;
  const insertAbove = event.clientY < midpoint;

  // Fetch fresh state to avoid stale indices
  const currentWindow = await chrome.windows.getCurrent();
  const [currentTabs, currentGroups] = await Promise.all([
    chrome.tabs.query({ windowId: currentWindow.id }),
    chrome.tabGroups.query({ windowId: currentWindow.id }),
  ]);

  const draggedGroupTabs = currentTabs
    .filter((tab) => tab.groupId === draggedGroupId)
    .sort((a, b) => a.index - b.index);
  if (draggedGroupTabs.length === 0) {
    return;
  }

  const sortedGroups = [...currentGroups].sort(
    (a, b) => a.position - b.position,
  );
  const draggedGroupMeta = sortedGroups.find(
    (group) => group.id === draggedGroupId,
  );
  if (!draggedGroupMeta) {
    return;
  }

  const remainingGroups = sortedGroups.filter(
    (group) => group.id !== draggedGroupId,
  );
  const targetGroupOrderIndex = remainingGroups.findIndex(
    (group) => group.id === targetGroupId,
  );
  if (targetGroupOrderIndex === -1) {
    return;
  }

  // Determine desired insertion point relative to remaining groups
  let desiredGroupOrderIndex = insertAbove
    ? targetGroupOrderIndex
    : targetGroupOrderIndex + 1;
  desiredGroupOrderIndex = Math.max(
    0,
    Math.min(desiredGroupOrderIndex, remainingGroups.length),
  );
  remainingGroups.splice(desiredGroupOrderIndex, 0, draggedGroupMeta);

  const finalGroupOrderIndex = remainingGroups.findIndex(
    (group) => group.id === draggedGroupId,
  );

  // Compute simple target index relative to the drop target group
  const targetGroupTabs = currentTabs
    .filter((tab) => tab.groupId === targetGroupId)
    .sort((a, b) => a.index - b.index);

  const draggedFirstIndex = draggedGroupTabs[0].index;
  const draggedGroupLength = draggedGroupTabs.length;

  let targetIndex;
  if (insertAbove) {
    targetIndex =
      targetGroupTabs[0]?.index ?? currentTabs.length - draggedGroupLength;
  } else {
    const last = targetGroupTabs[targetGroupTabs.length - 1];
    targetIndex = (last ? last.index + 1 : currentTabs.length) - 0;
  }

  if (draggedFirstIndex < targetIndex) {
    targetIndex -= draggedGroupLength;
  }

  const maxIndex = Math.max(0, currentTabs.length - draggedGroupLength);
  const fallbackTabIndex = Math.max(0, Math.min(targetIndex, maxIndex));

  try {
    // First try native group reorder
    if (chrome.tabGroups?.move) {
      await chrome.tabGroups.move(draggedGroupId, {
        index: finalGroupOrderIndex,
      });
      await refreshTabsView();
      return;
    }
    throw new Error('tabGroups.move unsupported');
  } catch {
    // Fallback 1: try block move preserving order
    try {
      const tabIds = draggedGroupTabs.map((t) => t.id);
      const currentWindow = await chrome.windows.getCurrent();
      await chrome.tabs.move(tabIds, {
        windowId: currentWindow.id,
        index: fallbackTabIndex,
      });
    } catch {
      // Fallback 2: move sequentially
      try {
        for (let i = 0; i < draggedGroupTabs.length; i++) {
          const tabId = draggedGroupTabs[i].id;
          await chrome.tabs.move(tabId, { index: fallbackTabIndex + i });
        }
      } catch (err2) {
        notify('Failed to reorder group: ' + (err2?.message || String(err2)));
      }
    } finally {
      await refreshTabsView();
    }
  }
}
