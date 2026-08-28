<template>
  <v-container fluid>
    <h1 class="mb-4">{{ $t('slaTargets.title') }}</h1>

    <v-data-table :items="targets" :headers="headers">
      <template #item.actions="{ item }">
        <v-btn size="small" variant="text" @click="openEdit(item)">Edit</v-btn>
      </template>
    </v-data-table>

    <v-dialog v-model="dialogOpen" max-width="480">
      <v-card :title="$t('slaTargets.editTitle', { priority: editingPriority })">
        <v-card-text>
          <form @submit.prevent="submit">
            <v-text-field
              v-model.number="form.responseMinutes"
              type="number"
              :label="$t('slaTargets.responseMinutes')"
            />
            <v-text-field
              v-model.number="form.resolutionMinutes"
              type="number"
              :label="$t('slaTargets.resolutionMinutes')"
            />
            <v-btn type="submit" color="primary">Save</v-btn>
          </form>
        </v-card-text>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { fetchSlaTargets, updateSlaTarget, type ApiSlaTarget, type TicketPriority } from '../../api/slaTargets';

const targets = ref<ApiSlaTarget[]>([]);
const dialogOpen = ref(false);
const editingPriority = ref<TicketPriority | null>(null);

const headers = [
  { title: 'Priority', key: 'priority' },
  { title: 'Response target (min)', key: 'responseMinutes' },
  { title: 'Resolution target (min)', key: 'resolutionMinutes' },
  { title: '', key: 'actions', sortable: false },
];

const form = reactive({ responseMinutes: 0, resolutionMinutes: 0 });

async function load() {
  targets.value = await fetchSlaTargets();
}

function openEdit(item: ApiSlaTarget) {
  editingPriority.value = item.priority;
  Object.assign(form, { responseMinutes: item.responseMinutes, resolutionMinutes: item.resolutionMinutes });
  dialogOpen.value = true;
}

async function submit() {
  if (!editingPriority.value) return;
  await updateSlaTarget(editingPriority.value, { ...form });
  dialogOpen.value = false;
  await load();
}

onMounted(load);
</script>
