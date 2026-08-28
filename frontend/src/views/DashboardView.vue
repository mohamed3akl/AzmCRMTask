<template>
  <v-container fluid>
    <h1 class="mb-4">{{ $t('dashboard.title') }}</h1>
    <v-row>
      <v-col cols="12" md="6">
        <MyTicketsWidget />
      </v-col>
      <v-col cols="12" md="6">
        <MyTasksWidget />
      </v-col>
    </v-row>
    <v-row>
      <v-col cols="12">
        <TeamActivityWidget />
      </v-col>
    </v-row>
    <v-row v-if="isSupervisorOrAdmin">
      <v-col cols="12" md="4">
        <UnassignedQueueWidget />
      </v-col>
      <v-col cols="12" md="4">
        <EscalatedTicketsWidget />
      </v-col>
      <v-col cols="12" md="4">
        <TeamWorkloadWidget />
      </v-col>
    </v-row>
    <v-row v-if="isSupervisorOrAdmin">
      <v-col cols="12">
        <BreachedTicketsWidget />
      </v-col>
    </v-row>
  </v-container>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import MyTicketsWidget from '../components/dashboard/MyTicketsWidget.vue';
import MyTasksWidget from '../components/dashboard/MyTasksWidget.vue';
import TeamActivityWidget from '../components/dashboard/TeamActivityWidget.vue';
import UnassignedQueueWidget from '../components/dashboard/UnassignedQueueWidget.vue';
import EscalatedTicketsWidget from '../components/dashboard/EscalatedTicketsWidget.vue';
import TeamWorkloadWidget from '../components/dashboard/TeamWorkloadWidget.vue';
import BreachedTicketsWidget from '../components/dashboard/BreachedTicketsWidget.vue';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
const isSupervisorOrAdmin = computed(
  () => auth.currentUser?.role === 'ADMIN' || auth.currentUser?.role === 'SUPERVISOR'
);
</script>
