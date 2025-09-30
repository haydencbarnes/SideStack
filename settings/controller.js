const STORAGE_KEY = 'sidestack_settings_v1';

export class SettingsView {
  constructor({ container, variant = 'standalone', onClose, onChanged } = {}) {
    this.container = container;
    this.variant = variant;
    this.onClose = typeof onClose === 'function' ? onClose : null;
    this.onChanged = typeof onChanged === 'function' ? onChanged : null;
    this.elements = {};
    this.settings = null;
  }

  async init() {
    if (!this.container) {
      return;
    }
    this.render();
    this.attachStaticHandlers();
    await this.refresh();
  }

  async refresh() {
    this.settings = await this.getSettings();
    this.syncSettings();
  }

  render() {
    const template = buildTemplate(this.variant, this.getVersion());
    this.container.innerHTML = template;
    this.collectElements();
  }

  collectElements() {
    this.elements.close = this.container.querySelector('[data-role=\'close\']');
    this.elements.themeMode = this.container.querySelector(
      '[data-role=\'theme-mode\']',
    );
    this.elements.saveTheme = this.container.querySelector(
      '[data-action=\'save-theme\']',
    );
    this.elements.compactMode = this.container.querySelector(
      '[data-role=\'compact-mode\']',
    );
    this.elements.duplicateDetection = this.container.querySelector(
      '[data-role=\'duplicate-detection\']',
    );
    this.elements.changePanelLocation = this.container.querySelector(
      '[data-action=\'change-panel-location\']',
    );
  }

  attachStaticHandlers() {
    this.elements.close?.addEventListener('click', () => this.handleClose());
    this.elements.saveTheme?.addEventListener('click', () =>
      this.handleSaveSettings(),
    );
    this.elements.changePanelLocation?.addEventListener('click', () =>
      this.handleChangePanelLocation(),
    );
  }

  handleClose() {
    if (this.onClose) {
      this.onClose();
    }
  }

  handleChangePanelLocation() {
    chrome.tabs.create({ url: 'chrome://settings/appearance' });
  }

  syncSettings() {
    if (!this.settings) {
      return;
    }
    const themeMode = this.settings.themeMode ?? 'system';
    if (this.elements.themeMode) {
      this.elements.themeMode.value = themeMode;
    }
    const compactMode = this.settings.compactMode ?? true;
    if (this.elements.compactMode) {
      this.elements.compactMode.checked = compactMode;
    }
    const duplicateDetection = this.settings.duplicateDetection ?? true;
    if (this.elements.duplicateDetection) {
      this.elements.duplicateDetection.checked = duplicateDetection;
    }
  }

  async handleSaveSettings() {
    const themeMode = this.elements.themeMode?.value ?? 'system';
    const compactMode = this.elements.compactMode?.checked ?? true;
    const duplicateDetection = this.elements.duplicateDetection?.checked ?? true;
    const nextSettings = {
      ...this.settings,
      themeMode,
      compactMode,
      duplicateDetection,
    };
    await this.setSettings(nextSettings);
    alert('Settings saved');
    await this.refresh();
    await this.notifyChanged();
  }

  async getSettings() {
    const response = await chrome.storage.local.get(STORAGE_KEY);
    const settings = response?.[STORAGE_KEY];
    if (settings) {
      return settings;
    }
    const fallback = {
      themeMode: 'system',
      compactMode: true,
      duplicateDetection: true,
    };
    await chrome.storage.local.set({ [STORAGE_KEY]: fallback });
    return fallback;
  }

  async setSettings(nextSettings) {
    await chrome.storage.local.set({ [STORAGE_KEY]: nextSettings });
  }

  async notifyChanged() {
    if (!this.onChanged) {
      return;
    }
    try {
      await this.onChanged();
    } catch (error) {
      console.error('Settings change listener failed', error);
    }
  }

  getVersion() {
    return chrome.runtime.getManifest().version;
  }
}

function buildTemplate(variant, version) {
  const inline = variant === 'inline';
  return `
    <div class="settings-view ${inline ? 'settings-view--inline' : 'settings-view--standalone'}">
      <header class="settings-header">
        <div class="settings-header__group">
          ${inline ? '<button type="button" class="settings-button settings-button--ghost" data-role="close">← Back</button>' : ''}
          <h1 class="settings-title">SideStack Settings</h1>
        </div>
      </header>
      <div class="settings-scroll">
        <section class="settings-section">
          <h2>About</h2>
          <p>SideStack organizes your tabs with smart grouping and suspension features.</p>
          <div class="settings-grid">
            <label class="settings-field">
              <span>Version</span>
              <input type="text" value="${version}" readonly class="settings-input--readonly">
            </label>
          </div>
        </section>
        <section class="settings-section">
          <h2>Appearance</h2>
          <div class="settings-grid">
            <label class="settings-field">
              <span>Theme mode</span>
              <select data-role="theme-mode">
                <option value="system">Follow system</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>
            <label class="settings-field settings-field--inline">
              <span>Compact mode</span>
              <input type="checkbox" data-role="compact-mode">
            </label>
          </div>
        </section>
        <section class="settings-section">
          <h2>Features</h2>
          <div class="settings-grid">
            <label class="settings-field settings-field--inline">
              <span>Duplicate tab detection</span>
              <input type="checkbox" data-role="duplicate-detection">
            </label>
          </div>
        </section>
        <section class="settings-section">
          <div class="settings-actions">
            <button type="button" class="settings-button settings-button--primary" data-action="save-theme">Save Settings</button>
            <button type="button" class="settings-button settings-button--secondary" data-action="change-panel-location">Change Panel Location</button>
          </div>
        </section>
      </div>
    </div>
  `;
}
