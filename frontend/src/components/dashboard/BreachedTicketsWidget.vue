<template>
  <v-card data-testid="breached-tickets-widget">
    <v-card-title>{{ $t('dashboard.breachedTickets') }}</v-card-title>
    <v-card-text>
      <v-alert v-if="error" type="error" density="compact" data-testid="widget-error">
        {{ $t('dashboard.loadError') }}
      </v-alert>
      <v-list v-else-if="tickets.length" density="compact">
        <v-list-item
          v-for="ticket in tickets"
          :key="ticket.id"
          :title="ticket.subject"
          :subtitle="ticket.customer.fullName"
          :to="{ name: 'ticket-detail', params: { id: ticket.id } }"
        />
      </v-list>
      <p v-else class="text-medium-emphasis">{{ $t('dashboard.noBreached') }}</p>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { fetchTickets, type ApiTicketSummary } from '../../api/tickets';

const tickets = ref<ApiTicketSummary[]>([]);
const error = ref(false);

function isBreached(ticket: ApiTicketSummary): boolean {
  return ticket.sla?.response.status === 'BREACHED' || ticket.sla?.resolution.status === 'BREACHED';
}

onMounted(async () => {
  try {
    const all = await fetchTickets({});
    tickets.value = all.filter(isBreached);
  } catch {
    error.value = true;
  }
});
</script>
