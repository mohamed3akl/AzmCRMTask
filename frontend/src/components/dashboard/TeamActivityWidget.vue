<template>
  <v-card data-testid="team-activity-widget">
    <v-card-title>{{ $t('dashboard.teamActivity') }}</v-card-title>
    <v-card-text>
      <v-alert v-if="error" type="error" density="compact" data-testid="widget-error">
        {{ $t('dashboard.loadError') }}
      </v-alert>
      <v-list v-else-if="events.length" density="compact">
        <v-list-item v-for="event in events" :key="event.id" :title="describeEvent(event)" :subtitle="event.author.fullName" />
      </v-list>
      <p v-else class="text-medium-emphasis">{{ $t('dashboard.noActivity') }}</p>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { fetchRecentTicketEvents, type ApiRecentTicketEvent } from '../../api/tickets';
import { describeTicketEvent } from '../../utils/ticketEventDescriptions';

const { t } = useI18n();
const events = ref<ApiRecentTicketEvent[]>([]);
const error = ref(false);

function describeEvent(event: ApiRecentTicketEvent): string {
  return `${event.ticket.subject}: ${describeTicketEvent(event, t)}`;
}

onMounted(async () => {
  try {
    events.value = await fetchRecentTicketEvents();
  } catch {
    error.value = true;
  }
});
</script>
