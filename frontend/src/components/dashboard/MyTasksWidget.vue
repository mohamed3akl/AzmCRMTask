<template>
  <v-card data-testid="my-tasks-widget">
    <v-card-title>{{ $t('dashboard.myTasks') }}</v-card-title>
    <v-card-text>
      <form data-testid="add-task-form" class="d-flex mb-4" @submit.prevent="addTask">
        <v-text-field
          v-model="newTitle"
          data-testid="new-task-title"
          :label="$t('tasks.newTask')"
          density="compact"
          hide-details
          class="mr-2"
        />
        <v-btn type="submit" color="primary">{{ $t('tasks.add') }}</v-btn>
      </form>
      <v-list v-if="tasks.length" density="compact">
        <v-list-item v-for="task in tasks" :key="task.id" :title="task.title">
          <template #append>
            <v-btn size="small" :data-testid="`task-done-${task.id}`" @click="toggleDone(task)">
              {{ $t('tasks.markDone') }}
            </v-btn>
          </template>
        </v-list-item>
      </v-list>
      <p v-else class="text-medium-emphasis">{{ $t('dashboard.noTasks') }}</p>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { fetchTasks, createTask, updateTask, type ApiTask } from '../../api/tasks';

const tasks = ref<ApiTask[]>([]);
const newTitle = ref('');

async function load() {
  tasks.value = await fetchTasks({ done: false });
}

async function addTask() {
  if (!newTitle.value.trim()) return;
  await createTask({ title: newTitle.value });
  newTitle.value = '';
  await load();
}

async function toggleDone(task: ApiTask) {
  await updateTask(task.id, { isDone: !task.isDone });
  await load();
}

onMounted(load);
</script>
