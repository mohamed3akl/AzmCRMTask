<template>
  <v-container class="fill-height" fluid>
    <v-row justify="center" align="center">
      <v-col cols="12" sm="6" md="4">
        <v-card :title="$t('login.title')">
          <v-card-text>
            <form @submit.prevent="handleSubmit">
              <v-text-field v-model="email" :label="$t('login.email')" type="email" required />
              <v-text-field v-model="password" :label="$t('login.password')" type="password" required />
              <v-alert v-if="error" type="error" density="compact" class="mb-4">{{ $t('login.error') }}</v-alert>
              <v-btn type="submit" color="primary" block :loading="loading">{{ $t('login.submit') }}</v-btn>
            </form>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>
  </v-container>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';

const email = ref('');
const password = ref('');
const error = ref(false);
const loading = ref(false);
const auth = useAuthStore();
const router = useRouter();

async function handleSubmit() {
  error.value = false;
  loading.value = true;
  try {
    await auth.login(email.value, password.value);
    router.push({ name: 'home' });
  } catch {
    error.value = true;
  } finally {
    loading.value = false;
  }
}
</script>
