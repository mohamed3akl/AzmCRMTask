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
            <p v-if="error" data-testid="sla-target-error" class="text-error mb-2">{{ error }}</p>
            <v-btn type="submit" color="primary" :disabled="!isFormValid">Save</v-btn>
          </form>
        </v-card-text>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import axios from 'axios';
import { fetchSlaTargets, updateSlaTarget, type ApiSlaTarget, type TicketPriority } from '../../api/slaTargets';

const { t } = useI18n();

const targets = ref<ApiSlaTarget[]>([]);
const dialogOpen = ref(false);
const editingPriority = ref<TicketPriority | null>(null);
const error = ref('');

const headers = [
  { title: 'Priority', key: 'priority' },
  { title: 'Response target (min)', key: 'responseMinutes' },
  { title: 'Resolution target (min)', key: 'resolutionMinutes' },
  { title: '', key: 'actions', sortable: false },
];

const form = reactive({ responseMinutes: 0, resolutionMinutes: 0 });

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

const isFormValid = computed(
  () => isPositiveInteger(form.responseMinutes) && isPositiveInteger(form.resolutionMinutes)
);

function extractBackendErrorMessage(err: unknown): string | undefined {
  if (axios.isAxiosError(err)) {
    return err.response?.data?.error?.message;
  }
  return undefined;
}

async function load() {
  targets.value = await fetchSlaTargets();
}

function openEdit(item: ApiSlaTarget) {
  editingPriority.value = item.priority;
  Object.assign(form, { responseMinutes: item.responseMinutes, resolutionMinutes: item.resolutionMinutes });
  error.value = '';
  dialogOpen.value = true;
}

async function submit() {
  error.value = '';
  if (!editingPriority.value || !isFormValid.value) return;
  try {
    await updateSlaTarget(editingPriority.value, { ...form });
    dialogOpen.value = false;
    await load();
  } catch (err) {
    error.value = extractBackendErrorMessage(err) ?? t('slaTargets.saveError');
  }
}

onMounted(load);
</script>
