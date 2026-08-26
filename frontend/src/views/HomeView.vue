<template>
  <v-container>
    <h1>{{ $t('home.welcome', { name: auth.currentUser?.fullName }) }}</h1>
  </v-container>
</template>

<script setup lang="ts">
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
</script>
