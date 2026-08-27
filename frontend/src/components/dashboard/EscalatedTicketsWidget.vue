<template>
  <v-card data-testid="escalated-tickets-widget">
    <v-card-title>{{ $t('dashboard.escalatedTickets') }}</v-card-title>
    <v-card-text>
      <v-list v-if="tickets.length" density="compact">
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

onMounted(async () => {
  tickets.value = await fetchTickets({ escalated: true });
});
</script>
