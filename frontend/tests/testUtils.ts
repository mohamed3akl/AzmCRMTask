import { mount, type ComponentMountingOptions } from '@vue/test-utils';
import { createVuetify } from 'vuetify';
import * as components from 'vuetify/components';
import * as directives from 'vuetify/directives';
import { createPinia, getActivePinia } from 'pinia';
import { createI18n } from 'vue-i18n';
import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import en from '../src/locales/en.json';
import ar from '../src/locales/ar.json';

export function mountWithPlugins<T>(
  component: T,
  options: ComponentMountingOptions<T> = {},
  routes: RouteRecordRaw[] = [{ path: '/', component: { template: '<div />' } }]
) {
  const vuetify = createVuetify({
    components,
    directives,
    locale: { locale: 'en', fallback: 'en', rtl: { en: false, ar: true } },
    // Render overlay-based components (VMenu, VDialog, VSelect, ...) inline
    // instead of teleporting to document.body, so @vue/test-utils' wrapper.find()
    // can locate their content. See vuetify's useTeleport composable: attach
    // truthy => teleportTarget is undefined => the internal <Teleport> is disabled.
    defaults: {
      VMenu: { attach: true },
      VDialog: { attach: true },
      VOverlay: { attach: true },
      VSelect: { attach: true },
      VAutocomplete: { attach: true },
      VTooltip: { attach: true },
    },
  });
  // Reuse the pinia set up by the test via `setActivePinia` (so a store
  // instantiated in the test body, e.g. `useAuthStore()`, is the same
  // instance the mounted component resolves), falling back to a fresh
  // one for tests that don't set one up explicitly.
  const pinia = getActivePinia() ?? createPinia();
  const i18n = createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages: { en, ar } });
  const router = createRouter({ history: createWebHistory(), routes });

  return mount(component, {
    ...options,
    global: {
      plugins: [vuetify, pinia, i18n, router],
      ...(options.global ?? {}),
    },
  });
}
