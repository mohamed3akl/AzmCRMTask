<template>
  <v-container>
    <div class="d-flex justify-space-between align-center mb-4">
      <h1>{{ $t('departments.title') }}</h1>
      <v-btn color="primary" @click="openCreate">{{ $t('departments.create') }}</v-btn>
    </div>

    <v-data-table :items="departments" :headers="headers">
      <template #item.actions="{ item }">
        <v-btn size="small" variant="text" @click="openEdit(item)">Edit</v-btn>
      </template>
    </v-data-table>

    <v-dialog v-model="dialogOpen" max-width="480">
      <v-card :title="editingId ? 'Edit department' : $t('departments.create')">
        <v-card-text>
          <form @submit.prevent="submit">
            <v-text-field v-model="form.nameEn" :label="$t('departments.nameEn')" />
            <v-text-field v-model="form.nameAr" :label="$t('departments.nameAr')" />
            <v-btn type="submit" color="primary">Save</v-btn>
          </form>
        </v-card-text>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { fetchDepartments, createDepartment, updateDepartment, type ApiDepartment } from '../../api/departments';

const departments = ref<ApiDepartment[]>([]);
const dialogOpen = ref(false);
const editingId = ref<string | null>(null);

const headers = [
  { title: 'Name (EN)', key: 'nameEn' },
  { title: 'Name (AR)', key: 'nameAr' },
  { title: '', key: 'actions', sortable: false },
];

const form = reactive({ nameEn: '', nameAr: '' });

async function load() {
  departments.value = await fetchDepartments();
}

function openCreate() {
  editingId.value = null;
  Object.assign(form, { nameEn: '', nameAr: '' });
  dialogOpen.value = true;
}

function openEdit(item: ApiDepartment) {
  editingId.value = item.id;
  Object.assign(form, { nameEn: item.nameEn, nameAr: item.nameAr });
  dialogOpen.value = true;
}

async function submit() {
  if (editingId.value) {
    await updateDepartment(editingId.value, { nameEn: form.nameEn, nameAr: form.nameAr });
  } else {
    await createDepartment({ nameEn: form.nameEn, nameAr: form.nameAr });
  }
  dialogOpen.value = false;
  await load();
}

onMounted(load);
</script>
