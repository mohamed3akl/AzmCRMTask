<template>
  <v-card data-testid="my-tickets-widget">
    <v-card-title>{{ $t('dashboard.myTickets') }}</v-card-title>
    <v-card-text>
      <v-list v-if="tickets.length" density="compact">
        <v-list-item
          v-for="ticket in tickets"
          :key="ticket.id"
          :title="ticket.subject"
          :subtitle="`${ticket.customer.fullName} — ${ticket.status}`"
          :to="{ name: 'ticket-detail', params: { id: ticket.id } }"
        />
      </v-list>
      <p v-else class="text-medium-emphasis">{{ $t('dashboard.noTickets') }}</p>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { fetchTickets, type ApiTicketSummary } from '../../api/tickets';
import { useAuthStore } from '../../stores/auth';

const auth = useAuthStore();
const tickets = ref<ApiTicketSummary[]>([]);

onMounted(async () => {
  const all = await fetchTickets({ assigneeId: auth.currentUser!.id });
  tickets.value = all.filter((t) => t.status !== 'CLOSED');
});
</script>
