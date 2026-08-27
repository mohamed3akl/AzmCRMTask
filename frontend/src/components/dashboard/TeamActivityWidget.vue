<template>
  <v-card data-testid="team-activity-widget">
    <v-card-title>{{ $t('dashboard.teamActivity') }}</v-card-title>
    <v-card-text>
      <v-list v-if="events.length" density="compact">
        <v-list-item v-for="event in events" :key="event.id" :title="describeEvent(event)" :subtitle="event.author.fullName" />
      </v-list>
      <p v-else class="text-medium-emphasis">{{ $t('dashboard.noActivity') }}</p>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { fetchRecentTicketEvents, type ApiRecentTicketEvent } from '../../api/tickets';

const events = ref<ApiRecentTicketEvent[]>([]);

const eventDescriptions: Record<string, (event: ApiRecentTicketEvent) => string> = {
  STATUS_CHANGED: (e) => `${e.ticket.subject}: status changed from ${e.oldValue} to ${e.newValue}`,
  PRIORITY_CHANGED: (e) => `${e.ticket.subject}: priority changed from ${e.oldValue} to ${e.newValue}`,
  CATEGORY_CHANGED: (e) => `${e.ticket.subject}: category changed`,
  DEPARTMENT_CHANGED: (e) => `${e.ticket.subject}: department changed`,
  ASSIGNEE_CHANGED: (e) => `${e.ticket.subject}: assignee changed`,
  ESCALATED: (e) => `${e.ticket.subject}: escalated`,
  UNESCALATED: (e) => `${e.ticket.subject}: unescalated`,
  NOTE_ADDED: (e) => `${e.ticket.subject}: note added`,
};

function describeEvent(event: ApiRecentTicketEvent): string {
  return eventDescriptions[event.type]?.(event) ?? event.type;
}

onMounted(async () => {
  events.value = await fetchRecentTicketEvents();
});
</script>
