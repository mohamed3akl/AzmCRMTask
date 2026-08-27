<template>
  <v-container>
    <div class="d-flex justify-space-between align-center mb-4">
      <h1>{{ $t('tickets.title') }}</h1>
      <v-btn color="primary" :to="{ name: 'ticket-new' }">{{ $t('tickets.create') }}</v-btn>
    </div>

    <v-select
      v-model="statusFilter"
      :items="statusOptions"
      :label="$t('tickets.filterStatus')"
      clearable
      class="mb-4"
      style="max-width: 240px"
      @update:model-value="load"
    />

    <v-data-table :items="tickets" :headers="headers" @click:row="goToTicket">
      <template #item.customer="{ item }">{{ item.customer.fullName }}</template>
      <template #item.assignee="{ item }">{{ item.assignee?.fullName ?? '-' }}</template>
      <template #item.isEscalated="{ item }">
        <v-chip v-if="item.isEscalated" color="error" size="small">{{ $t('tickets.escalated') }}</v-chip>
      </template>
    </v-data-table>
  </v-container>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { fetchTickets, type ApiTicketSummary, type TicketStatus } from '../../api/tickets';

const router = useRouter();
const tickets = ref<ApiTicketSummary[]>([]);
const statusFilter = ref<TicketStatus | null>(null);

const statusOptions: TicketStatus[] = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];

const headers = [
  { title: 'Subject', key: 'subject' },
  { title: 'Customer', key: 'customer' },
  { title: 'Status', key: 'status' },
  { title: 'Priority', key: 'priority' },
  { title: 'Assignee', key: 'assignee' },
  { title: '', key: 'isEscalated', sortable: false },
];

async function load() {
  tickets.value = await fetchTickets(statusFilter.value ? { status: statusFilter.value } : {});
}

function goToTicket(_event: Event, row: { item: ApiTicketSummary }) {
  router.push({ name: 'ticket-detail', params: { id: row.item.id } });
}

onMounted(load);
</script>
