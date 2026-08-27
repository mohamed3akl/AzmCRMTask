<template>
  <v-card data-testid="my-tasks-widget">
    <v-card-title>{{ $t('dashboard.myTasks') }}</v-card-title>
    <v-card-text>
      <v-alert v-if="error" type="error" density="compact" data-testid="widget-error" class="mb-4">
        {{ $t('dashboard.loadError') }}
      </v-alert>
      <form data-testid="add-task-form" class="mb-4" @submit.prevent="addTask">
        <div class="d-flex">
          <v-text-field
            v-model="newTitle"
            data-testid="new-task-title"
            :label="$t('tasks.newTask')"
            density="compact"
            hide-details
            class="mr-2"
          />
          <v-btn type="submit" color="primary">{{ $t('tasks.add') }}</v-btn>
        </div>
        <v-text-field
          v-model="newDueAt"
          data-testid="new-task-due-at"
          type="datetime-local"
          :label="$t('tasks.dueDate')"
          density="compact"
          hide-details
          class="mt-2"
        />
        <v-autocomplete
          v-model="newTicketId"
          data-testid="new-task-ticket"
          :items="ticketOptions"
          item-title="subject"
          item-value="id"
          :label="$t('tasks.linkTicket')"
          density="compact"
          hide-details
          clearable
          class="mt-2"
        />
      </form>
      <v-list v-if="tasks.length" density="compact">
        <v-list-item v-for="task in tasks" :key="task.id" :title="task.title" :subtitle="taskSubtitle(task)">
          <template #append>
            <v-btn size="small" :data-testid="`task-done-${task.id}`" @click="toggleDone(task)">
              {{ $t('tasks.markDone') }}
            </v-btn>
          </template>
        </v-list-item>
      </v-list>
      <p v-else-if="!error" class="text-medium-emphasis">{{ $t('dashboard.noTasks') }}</p>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { fetchTasks, createTask, updateTask, type ApiTask } from '../../api/tasks';
import { fetchTickets, type ApiTicketSummary } from '../../api/tickets';

const tasks = ref<ApiTask[]>([]);
const newTitle = ref('');
const newDueAt = ref('');
const newTicketId = ref<string | null>(null);
const ticketOptions = ref<ApiTicketSummary[]>([]);
const error = ref(false);

const ticketSubjectById = computed(() => {
  const map = new Map<string, string>();
  for (const ticket of ticketOptions.value) {
    map.set(ticket.id, ticket.subject);
  }
  return map;
});

function taskSubtitle(task: ApiTask): string {
  const parts: string[] = [];
  if (task.dueAt) parts.push(new Date(task.dueAt).toLocaleString());
  if (task.ticketId) parts.push(ticketSubjectById.value.get(task.ticketId) ?? task.ticketId);
  return parts.join(' · ');
}

async function load() {
  tasks.value = await fetchTasks({ done: false });
}

async function addTask() {
  if (!newTitle.value.trim()) return;
  try {
    await createTask({
      title: newTitle.value,
      dueAt: newDueAt.value ? new Date(newDueAt.value).toISOString() : null,
      ticketId: newTicketId.value,
    });
    newTitle.value = '';
    newDueAt.value = '';
    newTicketId.value = null;
    await load();
  } catch {
    error.value = true;
  }
}

async function toggleDone(task: ApiTask) {
  try {
    await updateTask(task.id, { isDone: !task.isDone });
    await load();
  } catch {
    error.value = true;
  }
}

onMounted(async () => {
  try {
    await load();
  } catch {
    error.value = true;
  }
  try {
    ticketOptions.value = await fetchTickets({});
  } catch {
    // Non-fatal: ticket picker options may be empty if unavailable.
  }
});
</script>
