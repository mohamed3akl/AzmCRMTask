<template>
  <v-container fluid>
    <h1 class="mb-4">{{ $t('dashboard.title') }}</h1>
    <v-row>
      <v-col cols="12" md="6">
        <MyTicketsWidget />
      </v-col>
    </v-row>
  </v-container>
</template>

<script setup lang="ts">
import MyTicketsWidget from '../components/dashboard/MyTicketsWidget.vue';
</script>
