import { SettingsView } from './settings/controller.js';

const root = document.querySelector('#options-root');

const view = new SettingsView({
  container: root,
  variant: 'standalone',
});

view.init();
