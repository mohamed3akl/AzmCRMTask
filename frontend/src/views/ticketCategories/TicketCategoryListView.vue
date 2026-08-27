<template>
  <v-container fluid>
    <div class="d-flex justify-space-between align-center mb-4">
      <h1>{{ $t('ticketCategories.title') }}</h1>
      <v-btn color="primary" @click="openCreate">{{ $t('ticketCategories.create') }}</v-btn>
    </div>

    <v-data-table :items="categories" :headers="headers">
      <template #item.actions="{ item }">
        <v-btn size="small" variant="text" @click="openEdit(item)">Edit</v-btn>
      </template>
    </v-data-table>

    <v-dialog v-model="dialogOpen" max-width="480">
      <v-card :title="editingId ? 'Edit category' : $t('ticketCategories.create')">
        <v-card-text>
          <form @submit.prevent="submit">
            <v-text-field v-model="form.nameEn" :label="$t('ticketCategories.nameEn')" />
            <v-text-field v-model="form.nameAr" :label="$t('ticketCategories.nameAr')" />
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
  fetchTicketCategories,
  createTicketCategory,
  updateTicketCategory,
  type ApiTicketCategory,
} from '../../api/ticketCategories';

const categories = ref<ApiTicketCategory[]>([]);
const dialogOpen = ref(false);
const editingId = ref<string | null>(null);

const headers = [
  { title: 'Name (EN)', key: 'nameEn' },
  { title: 'Name (AR)', key: 'nameAr' },
  { title: '', key: 'actions', sortable: false },
];

const form = reactive({ nameEn: '', nameAr: '' });

async function load() {
  categories.value = await fetchTicketCategories();
}

function openCreate() {
  editingId.value = null;
  Object.assign(form, { nameEn: '', nameAr: '' });
  dialogOpen.value = true;
}

function openEdit(item: ApiTicketCategory) {
  editingId.value = item.id;
  Object.assign(form, { nameEn: item.nameEn, nameAr: item.nameAr });
  dialogOpen.value = true;
}

async function submit() {
  if (editingId.value) {
    await updateTicketCategory(editingId.value, { nameEn: form.nameEn, nameAr: form.nameAr });
  } else {
    await createTicketCategory({ nameEn: form.nameEn, nameAr: form.nameAr });
  }
  dialogOpen.value = false;
  await load();
}

onMounted(load);
</script>
