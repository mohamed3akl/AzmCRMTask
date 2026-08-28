<template>
  <v-container fluid>
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
      <template #item.sla="{ item }">
        <template v-for="chip in [slaChip(item)]" :key="item.id">
          <v-chip v-if="chip" :color="chip.color" size="small">{{ chip.label }}</v-chip>
        </template>
      </template>
    </v-data-table>
  </v-container>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { fetchTickets, type ApiTicketSummary, type TicketStatus, type SlaClockStatus } from '../../api/tickets';

const router = useRouter();
const { t } = useI18n();
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
  { title: 'SLA', key: 'sla', sortable: false },
];

interface WorstClock {
  status: SlaClockStatus;
  dueAt: string;
}

function worstSlaClock(ticket: ApiTicketSummary): WorstClock | null {
  if (!ticket.sla) return null;
  const { response, resolution } = ticket.sla;
  if (response.status === 'BREACHED') return { status: 'BREACHED', dueAt: response.dueAt };
  if (resolution.status === 'BREACHED') return { status: 'BREACHED', dueAt: resolution.dueAt };
  if (response.status === 'PENDING') return { status: 'PENDING', dueAt: response.dueAt };
  if (resolution.status === 'PENDING') return { status: 'PENDING', dueAt: resolution.dueAt };
  return { status: 'MET', dueAt: response.dueAt };
}

function slaChip(ticket: ApiTicketSummary): { label: string; color: string } | null {
  const worst = worstSlaClock(ticket);
  if (!worst) return null;
  if (worst.status === 'BREACHED') return { label: t('tickets.slaBreached'), color: 'error' };
  if (worst.status === 'MET') return { label: t('tickets.slaMet'), color: 'success' };
  const minutes = Math.round((new Date(worst.dueAt).getTime() - Date.now()) / 60000);
  if (minutes < 0) return { label: t('tickets.slaBreached'), color: 'error' };
  return { label: t('tickets.slaMinutesLeft', { minutes }), color: 'default' };
}

async function load() {
  tickets.value = await fetchTickets(statusFilter.value ? { status: statusFilter.value } : {});
}

function goToTicket(_event: Event, row: { item: ApiTicketSummary }) {
  router.push({ name: 'ticket-detail', params: { id: row.item.id } });
}

onMounted(load);
</script>
