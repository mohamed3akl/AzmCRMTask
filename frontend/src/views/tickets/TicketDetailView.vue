<template>
  <v-container v-if="ticket">
    <div class="d-flex justify-space-between align-center mb-4">
      <h1>{{ ticket.subject }}</h1>
      <v-chip v-if="ticket.isEscalated" color="error">{{ $t('tickets.escalated') }}</v-chip>
    </div>

    <v-row>
      <v-col cols="12" md="8">
        <p class="mb-4">{{ ticket.description }}</p>

        <h2 class="text-h6 mb-2">{{ $t('tickets.timeline') }}</h2>
        <v-timeline density="compact" side="end">
          <v-timeline-item v-for="event in ticket.events" :key="event.id" size="small">
            <div>{{ describeEvent(event) }}</div>
            <div class="text-caption">{{ event.author.fullName }} — {{ new Date(event.createdAt).toLocaleString() }}</div>
          </v-timeline-item>
        </v-timeline>
      </v-col>

      <v-col cols="12" md="4">
        <v-list density="compact">
          <v-list-item :title="$t('tickets.customer')" :subtitle="ticket.customer.fullName" />
          <v-list-item :title="$t('tickets.status')" :subtitle="ticket.status" />
          <v-list-item :title="$t('tickets.priority')" :subtitle="ticket.priority" />
          <v-list-item :title="$t('tickets.assignee')" :subtitle="ticket.assignee?.fullName ?? '-'" />
          <v-list-item :title="$t('tickets.category')" :subtitle="ticket.category?.nameEn ?? '-'" />
          <v-list-item :title="$t('tickets.department')" :subtitle="ticket.department?.nameEn ?? '-'" />
          <v-list-item :title="$t('tickets.createdBy')" :subtitle="ticket.createdBy.fullName" />
        </v-list>
      </v-col>
    </v-row>
  </v-container>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { fetchTicket, type ApiTicketDetail, type ApiTicketEvent } from '../../api/tickets';

const route = useRoute();
const ticket = ref<ApiTicketDetail | null>(null);

const eventDescriptions: Record<string, (event: ApiTicketEvent) => string> = {
  STATUS_CHANGED: (e) => `Status changed from ${e.oldValue} to ${e.newValue}`,
  PRIORITY_CHANGED: (e) => `Priority changed from ${e.oldValue} to ${e.newValue}`,
  CATEGORY_CHANGED: () => 'Category changed',
  DEPARTMENT_CHANGED: () => 'Department changed',
  ASSIGNEE_CHANGED: () => 'Assignee changed',
  ESCALATED: (e) => `Escalated${e.note ? `: ${e.note}` : ''}`,
  UNESCALATED: () => 'Unescalated',
  NOTE_ADDED: (e) => e.note ?? '',
};

function describeEvent(event: ApiTicketEvent): string {
  return eventDescriptions[event.type]?.(event) ?? event.type;
}

async function load() {
  ticket.value = await fetchTicket(route.params.id as string);
}

onMounted(load);
</script>
