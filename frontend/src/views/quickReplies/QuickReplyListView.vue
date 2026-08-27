<template>
  <v-container fluid>
    <div class="d-flex justify-space-between align-center mb-4">
      <h1>{{ $t('quickReplies.title') }}</h1>
      <v-btn color="primary" @click="openCreate">{{ $t('quickReplies.create') }}</v-btn>
    </div>

    <v-data-table :items="replies" :headers="headers">
      <template #item.actions="{ item }">
        <v-btn size="small" variant="text" @click="openEdit(item)">Edit</v-btn>
      </template>
    </v-data-table>

    <v-dialog v-model="dialogOpen" max-width="480">
      <v-card :title="editingId ? 'Edit quick reply' : $t('quickReplies.create')">
        <v-card-text>
          <form @submit.prevent="submit">
            <v-text-field v-model="form.titleEn" :label="$t('quickReplies.titleEn')" />
            <v-text-field v-model="form.titleAr" :label="$t('quickReplies.titleAr')" />
            <v-textarea v-model="form.bodyEn" :label="$t('quickReplies.bodyEn')" />
            <v-textarea v-model="form.bodyAr" :label="$t('quickReplies.bodyAr')" />
            <v-btn type="submit" color="primary">Save</v-btn>
          </form>
        </v-card-text>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import {
  fetchQuickReplies,
  createQuickReply,
  updateQuickReply,
  type ApiQuickReply,
} from '../../api/quickReplies';

const replies = ref<ApiQuickReply[]>([]);
const dialogOpen = ref(false);
const editingId = ref<string | null>(null);

const headers = [
  { title: 'Title (EN)', key: 'titleEn' },
  { title: 'Title (AR)', key: 'titleAr' },
  { title: '', key: 'actions', sortable: false },
];

const form = reactive({ titleEn: '', titleAr: '', bodyEn: '', bodyAr: '' });

async function load() {
  replies.value = await fetchQuickReplies();
}

function openCreate() {
  editingId.value = null;
  Object.assign(form, { titleEn: '', titleAr: '', bodyEn: '', bodyAr: '' });
  dialogOpen.value = true;
}

function openEdit(item: ApiQuickReply) {
  editingId.value = item.id;
  Object.assign(form, { titleEn: item.titleEn, titleAr: item.titleAr, bodyEn: item.bodyEn, bodyAr: item.bodyAr });
  dialogOpen.value = true;
}

async function submit() {
  if (editingId.value) {
    await updateQuickReply(editingId.value, { ...form });
  } else {
    await createQuickReply({ ...form });
  }
  dialogOpen.value = false;
  await load();
}

onMounted(load);
</script>
