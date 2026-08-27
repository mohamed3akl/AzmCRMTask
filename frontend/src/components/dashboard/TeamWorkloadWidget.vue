<template>
  <v-card data-testid="team-workload-widget">
    <v-card-title>{{ $t('dashboard.teamWorkload') }}</v-card-title>
    <v-card-text>
      <v-list v-if="workload.length" density="compact">
        <v-list-item v-for="row in workload" :key="row.name" :title="row.name" :subtitle="String(row.count)" />
      </v-list>
      <p v-else class="text-medium-emphasis">{{ $t('dashboard.noWorkload') }}</p>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { fetchTickets } from '../../api/tickets';

const workload = ref<{ name: string; count: number }[]>([]);

onMounted(async () => {
  const [open, inProgress] = await Promise.all([
    fetchTickets({ status: 'OPEN' }),
    fetchTickets({ status: 'IN_PROGRESS' }),
  ]);
  const counts = new Map<string, number>();
  for (const ticket of [...open, ...inProgress]) {
    const name = ticket.assignee?.fullName ?? 'Unassigned';
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  workload.value = [...counts.entries()].map(([name, count]) => ({ name, count }));
});
</script>
