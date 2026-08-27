<template>
  <v-card data-testid="escalated-tickets-widget">
    <v-card-title>{{ $t('dashboard.escalatedTickets') }}</v-card-title>
    <v-card-text>
      <v-alert v-if="error" type="error" density="compact" data-testid="widget-error">
        {{ $t('dashboard.loadError') }}
      </v-alert>
      <v-list v-else-if="tickets.length" density="compact">
        <v-list-item
          v-for="ticket in tickets"
          :key="ticket.id"
          :title="ticket.subject"
          :subtitle="ticket.assignee?.fullName ?? '-'"
          :to="{ name: 'ticket-detail', params: { id: ticket.id } }"
        />
      </v-list>
      <p v-else class="text-medium-emphasis">{{ $t('dashboard.noEscalated') }}</p>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { fetchTickets, type ApiTicketSummary } from '../../api/tickets';

const tickets = ref<ApiTicketSummary[]>([]);
const error = ref(false);

onMounted(async () => {
  try {
    tickets.value = await fetchTickets({ escalated: true });
  } catch {
    error.value = true;
  }
});
</script>
