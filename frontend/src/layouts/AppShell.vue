<template>
  <v-app>
    <v-navigation-drawer permanent>
      <div class="d-flex align-center px-4 py-5" style="border-bottom: 1px solid rgba(0, 0, 0, 0.12)">
        <span class="text-h6 font-weight-black text-primary" style="letter-spacing: 0.5px;">AzmCRM</span>
      </div>
      <v-list>
        <v-list-item :title="$t('nav.home')" :to="{ name: 'home' }" />
        <v-list-item :title="$t('nav.tickets')" :to="{ name: 'tickets' }" />
        <v-list-item v-if="isAdmin" :title="$t('nav.users')" :to="{ name: 'users' }" />
        <v-list-item v-if="isAdmin" :title="$t('nav.departments')" :to="{ name: 'departments' }" />
        <v-list-item v-if="isAdmin" :title="$t('nav.ticketCategories')" :to="{ name: 'ticket-categories' }" />
      </v-list>
    </v-navigation-drawer>

    <v-app-bar>
      <v-spacer />
      <v-menu>
        <template #activator="{ props }">
          <v-btn icon v-bind="props" class="mr-4" data-testid="language-menu-activator">
            <v-icon>mdi-translate</v-icon>
          </v-btn>
        </template>
        <v-list>
          <v-list-item @click="setLocale('en')" data-testid="lang-en-item">
            <v-list-item-title>EN</v-list-item-title>
          </v-list-item>
          <v-list-item @click="setLocale('ar')" data-testid="lang-ar-item">
            <v-list-item-title>AR</v-list-item-title>
          </v-list-item>
        </v-list>
      </v-menu>
      <v-menu>
        <template #activator="{ props }">
          <v-btn v-bind="props" data-testid="user-menu-activator">{{ auth.currentUser?.fullName }}</v-btn>
        </template>
        <v-list>
          <v-list-item :title="$t('nav.logout')" data-testid="logout-item" @click="handleLogout" />
        </v-list>
      </v-menu>
    </v-app-bar>

    <v-main>
      <router-view />
    </v-main>
  </v-app>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useLocale } from 'vuetify';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
const router = useRouter();
const { locale: i18nLocale } = useI18n();
const { current: vuetifyLocale } = useLocale();

const isAdmin = computed(() => auth.currentUser?.role === 'ADMIN');

const currentLocale = ref(auth.currentUser?.locale === 'ar' ? 'ar' : 'en');

function setLocale(value: 'en' | 'ar') {
  currentLocale.value = value;
  i18nLocale.value = value;
  vuetifyLocale.value = value;
  document.documentElement.dir = value === 'ar' ? 'rtl' : 'ltr';
  document.documentElement.lang = value;
}

onMounted(() => {
  setLocale(auth.currentUser?.locale === 'ar' ? 'ar' : 'en');
});

function handleLogout() {
  auth.logout();
  router.push({ name: 'login' });
}
</script>
