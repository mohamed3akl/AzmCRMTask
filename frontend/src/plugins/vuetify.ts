import 'vuetify/styles';
import '@mdi/font/css/materialdesignicons.css';
import { createVuetify } from 'vuetify';
import * as components from 'vuetify/components';
import * as directives from 'vuetify/directives';

export const vuetify = createVuetify({
  components,
  directives,
  theme: {
    defaultTheme: 'airbnbLight',
    themes: {
      airbnbLight: {
        dark: false,
        colors: {
          primary: '#ff385c',
          secondary: '#222222',
          background: '#ffffff',
          surface: '#ffffff',
          'surface-variant': '#f7f7f7',
          'on-surface-variant': '#222222',
          error: '#c13515',
          info: '#428bff',
        },
      },
    },
  },
  defaults: {
    VBtn: {
      elevation: 0,
    },
    VCard: {
      elevation: 0,
    },
    VTextField: {
      variant: 'outlined',
      color: 'primary',
    },
    VSelect: {
      variant: 'outlined',
      color: 'primary',
    },
    VTextarea: {
      variant: 'outlined',
      color: 'primary',
    },
  },
  locale: {
    locale: 'en',
    fallback: 'en',
    rtl: { en: false, ar: true },
  },
});
