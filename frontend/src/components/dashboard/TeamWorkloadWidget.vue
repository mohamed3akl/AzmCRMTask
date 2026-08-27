<template>
  <v-card data-testid="team-workload-widget">
    <v-card-title>{{ $t('dashboard.teamWorkload') }}</v-card-title>
    <v-card-text>
      <v-alert v-if="error" type="error" density="compact" data-testid="widget-error">
        {{ $t('dashboard.loadError') }}
      </v-alert>
      <v-list v-else-if="workload.length" density="compact">
        <v-list-item
          v-for="row in workload"
          :key="row.assigneeId ?? 'unassigned'"
          :data-testid="`workload-row-${row.assigneeId ?? 'unassigned'}`"
          :title="row.name"
          :subtitle="String(row.count)"
        />
      </v-list>
      <p v-else class="text-medium-emphasis">{{ $t('dashboard.noWorkload') }}</p>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { fetchTickets } from '../../api/tickets';

interface WorkloadRow {
  assigneeId: string | null;
  name: string;
  count: number;
}

const { t } = useI18n();
const workload = ref<WorkloadRow[]>([]);
const error = ref(false);

onMounted(async () => {
  try {
    const [open, inProgress] = await Promise.all([
      fetchTickets({ status: 'OPEN' }),
      fetchTickets({ status: 'IN_PROGRESS' }),
    ]);
    const rows = new Map<string, WorkloadRow>();
    for (const ticket of [...open, ...inProgress]) {
      const key = ticket.assignee?.id ?? '__unassigned__';
      const existing = rows.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        rows.set(key, {
          assigneeId: ticket.assignee?.id ?? null,
          name: ticket.assignee?.fullName ?? t('dashboard.unassignedLabel'),
          count: 1,
        });
      }
    }
    workload.value = [...rows.values()];
  } catch {
    error.value = true;
  }
});
</script>
