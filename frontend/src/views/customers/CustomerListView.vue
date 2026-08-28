<template>
  <v-container fluid>
    <div class="d-flex justify-space-between align-center mb-4">
      <h1>{{ $t('customers.title') }}</h1>
      <v-btn color="primary" data-testid="customer-create-button" @click="openCreate">{{ $t('customers.create') }}</v-btn>
    </div>

    <v-text-field
      v-model="query"
      data-testid="customer-search"
      :label="$t('customers.search')"
      clearable
      class="mb-4"
      style="max-width: 320px"
      @update:model-value="onSearch"
    />

    <v-data-table :items="customers" :headers="headers" @click:row="goToCustomer">
      <template #item.email="{ item }">{{ item.email ?? '-' }}</template>
      <template #item.phone="{ item }">{{ item.phone ?? '-' }}</template>
    </v-data-table>

    <v-dialog v-model="dialogOpen" max-width="480">
      <v-card :title="$t('customers.create')">
        <v-card-text>
          <form @submit.prevent="submit">
            <v-text-field v-model="form.fullName" data-testid="customer-fullname" :label="$t('customers.fullName')" />
            <v-text-field v-model="form.email" data-testid="customer-email" :label="$t('customers.email')" />
            <v-text-field v-model="form.phone" data-testid="customer-phone" :label="$t('customers.phone')" />
            <p v-if="error" data-testid="customer-error" class="text-error mb-2">
              {{ error }}
              <router-link
                v-if="conflictId"
                :to="{ name: 'customer-detail', params: { id: conflictId } }"
                data-testid="customer-conflict-link"
              >
                {{ $t('customers.viewExisting') }}
              </router-link>
            </p>
            <v-btn type="submit" color="primary" data-testid="customer-save-button" :disabled="!form.fullName">
              {{ $t('customers.save') }}
            </v-btn>
          </form>
        </v-card-text>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import axios from 'axios';
import { searchCustomers, createCustomer, type ApiCustomer } from '../../api/customers';

const router = useRouter();
const { t } = useI18n();

const customers = ref<ApiCustomer[]>([]);
const query = ref('');
const dialogOpen = ref(false);
const error = ref('');
const conflictId = ref<string | null>(null);

const headers = [
  { title: 'Name', key: 'fullName' },
  { title: 'Email', key: 'email' },
  { title: 'Phone', key: 'phone' },
];

const form = reactive({ fullName: '', email: '', phone: '' });

function extractBackendErrorMessage(err: unknown): string | undefined {
  if (axios.isAxiosError(err)) {
    return err.response?.data?.error?.message;
  }
  return undefined;
}

function extractExistingCustomerId(err: unknown): string | undefined {
  if (axios.isAxiosError(err)) {
    return err.response?.data?.existingCustomerId;
  }
  return undefined;
}

async function load() {
  customers.value = await searchCustomers(query.value);
}

function onSearch() {
  load();
}

function openCreate() {
  Object.assign(form, { fullName: '', email: '', phone: '' });
  error.value = '';
  conflictId.value = null;
  dialogOpen.value = true;
}

async function submit() {
  error.value = '';
  conflictId.value = null;
  try {
    await createCustomer({
      fullName: form.fullName,
      email: form.email || undefined,
      phone: form.phone || undefined,
    });
    dialogOpen.value = false;
    await load();
  } catch (err) {
    conflictId.value = extractExistingCustomerId(err) ?? null;
    error.value = extractBackendErrorMessage(err) ?? t('customers.saveError');
  }
}

function goToCustomer(_event: Event, row: { item: ApiCustomer }) {
  router.push({ name: 'customer-detail', params: { id: row.item.id } });
}

onMounted(load);
</script>
