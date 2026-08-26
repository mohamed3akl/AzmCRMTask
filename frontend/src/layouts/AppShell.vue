<template>
  <v-app>
    <v-navigation-drawer permanent>
      <v-list>
        <v-list-item :title="$t('nav.home')" :to="{ name: 'home' }" />
        <v-list-item v-if="isAdmin && router.hasRoute('users')" :title="$t('nav.users')" :to="{ name: 'users' }" />
        <v-list-item
          v-if="isAdmin && router.hasRoute('departments')"
          :title="$t('nav.departments')"
          :to="{ name: 'departments' }"
        />
      </v-list>
    </v-navigation-drawer>

    <v-app-bar>
      <v-app-bar-title>AzmCRM</v-app-bar-title>
      <v-spacer />
      <v-btn-toggle :model-value="currentLocale" mandatory density="compact" class="mr-4">
        <v-btn value="en" @click="setLocale('en')">EN</v-btn>
        <v-btn value="ar" @click="setLocale('ar')">AR</v-btn>
      </v-btn-toggle>
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
import { computed, ref } from 'vue';
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

function handleLogout() {
  auth.logout();
  router.push({ name: 'login' });
}
</script>
