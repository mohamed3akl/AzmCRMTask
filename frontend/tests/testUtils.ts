import { mount, type ComponentMountingOptions } from '@vue/test-utils';
import { createVuetify } from 'vuetify';
import * as components from 'vuetify/components';
import * as directives from 'vuetify/directives';
import { createPinia } from 'pinia';
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
  });
  const pinia = createPinia();
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
