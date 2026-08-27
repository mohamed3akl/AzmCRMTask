<template>
  <v-container>
    <div class="d-flex justify-space-between align-center mb-4">
      <h1>{{ $t('users.title') }}</h1>
      <v-btn color="primary" @click="openCreate">{{ $t('users.create') }}</v-btn>
    </div>

    <v-data-table :items="users" :headers="headers">
      <template #item.isActive="{ item }">
        <v-chip :color="item.isActive ? 'success' : undefined">
          {{ item.isActive ? $t('users.active') : $t('users.deactivate') }}
        </v-chip>
      </template>
      <template #item.actions="{ item }">
        <v-btn size="small" variant="text" @click="openEdit(item)">Edit</v-btn>
        <v-btn v-if="item.isActive" size="small" variant="text" @click="handleDeactivate(item.id)">
          {{ $t('users.deactivate') }}
        </v-btn>
      </template>
    </v-data-table>

    <v-dialog v-model="dialogOpen" max-width="480">
      <v-card :title="editingId ? 'Edit user' : $t('users.create')">
        <v-card-text>
          <form @submit.prevent="submit">
            <v-text-field v-model="form.email" :label="$t('users.email')" :disabled="!!editingId" />
            <v-text-field v-if="!editingId" v-model="form.password" label="Password" type="password" />
            <v-text-field v-model="form.fullName" :label="$t('users.fullName')" />
            <v-select v-model="form.role" :items="roles" :label="$t('users.role')" />
            <v-select
              v-model="form.departmentId"
              :items="departments"
              item-title="nameEn"
              item-value="id"
              :label="$t('users.department')"
              clearable
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
import { fetchUsers, createUser, updateUser, deactivateUser, type ApiUser } from '../../api/users';
import { fetchDepartments, type ApiDepartment } from '../../api/departments';

const users = ref<ApiUser[]>([]);
const departments = ref<ApiDepartment[]>([]);
const dialogOpen = ref(false);
const editingId = ref<string | null>(null);
const roles: ApiUser['role'][] = ['AGENT', 'SUPERVISOR', 'ADMIN'];

const headers = [
  { title: 'Email', key: 'email' },
  { title: 'Name', key: 'fullName' },
  { title: 'Role', key: 'role' },
  { title: 'Status', key: 'isActive' },
  { title: '', key: 'actions', sortable: false },
];

const form = reactive({
  email: '',
  password: '',
  fullName: '',
  role: 'AGENT' as ApiUser['role'],
  departmentId: null as string | null,
});

async function load() {
  [users.value, departments.value] = await Promise.all([fetchUsers(), fetchDepartments()]);
}

function openCreate() {
  editingId.value = null;
  Object.assign(form, { email: '', password: '', fullName: '', role: 'AGENT', departmentId: null });
  dialogOpen.value = true;
}

function openEdit(item: ApiUser) {
  editingId.value = item.id;
  Object.assign(form, { email: item.email, password: '', fullName: item.fullName, role: item.role, departmentId: item.departmentId });
  dialogOpen.value = true;
}

async function submit() {
  if (editingId.value) {
    await updateUser(editingId.value, { fullName: form.fullName, role: form.role, departmentId: form.departmentId });
  } else {
    await createUser({ email: form.email, password: form.password, fullName: form.fullName, role: form.role, departmentId: form.departmentId });
  }
  dialogOpen.value = false;
  await load();
}

async function handleDeactivate(id: string) {
  await deactivateUser(id);
  await load();
}

onMounted(load);
</script>
