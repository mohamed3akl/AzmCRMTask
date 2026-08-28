<template>
  <v-container fluid v-if="customer">
    <h1 class="mb-4">{{ customer.fullName }}</h1>

    <v-row>
      <v-col cols="12" md="4">
        <v-list density="compact">
          <v-list-item :title="$t('customers.email')" :subtitle="customer.email ?? '-'" />
          <v-list-item :title="$t('customers.phone')" :subtitle="customer.phone ?? '-'" />
        </v-list>
        <v-btn data-testid="customer-edit-button" class="mt-2" @click="openEdit">{{ $t('customers.edit') }}</v-btn>
      </v-col>

      <v-col cols="12" md="8">
        <h2 class="text-h6 mb-2">{{ $t('customers.ticketHistory') }}</h2>
        <v-data-table
          v-if="customer.tickets.length"
          :items="customer.tickets"
          :headers="ticketHeaders"
          @click:row="goToTicket"
        />
        <p v-else class="text-medium-emphasis">{{ $t('customers.noTickets') }}</p>
      </v-col>
    </v-row>

    <v-dialog v-model="dialogOpen" max-width="480">
      <v-card :title="$t('customers.edit')">
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
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import axios from 'axios';
import { fetchCustomer, updateCustomer, type ApiCustomerDetail, type ApiCustomerTicket } from '../../api/customers';

const route = useRoute();
const router = useRouter();
const { t } = useI18n();

const customer = ref<ApiCustomerDetail | null>(null);
const dialogOpen = ref(false);
const error = ref('');
const conflictId = ref<string | null>(null);

const ticketHeaders = [
  { title: 'Subject', key: 'subject' },
  { title: 'Status', key: 'status' },
  { title: 'Priority', key: 'priority' },
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
  customer.value = await fetchCustomer(route.params.id as string);
}

function openEdit() {
  if (!customer.value) return;
  Object.assign(form, {
    fullName: customer.value.fullName,
    email: customer.value.email ?? '',
    phone: customer.value.phone ?? '',
  });
  error.value = '';
  conflictId.value = null;
  dialogOpen.value = true;
}

async function submit() {
  if (!customer.value) return;
  error.value = '';
  conflictId.value = null;
  try {
    const updated = await updateCustomer(customer.value.id, {
      fullName: form.fullName,
      email: form.email || undefined,
      phone: form.phone || undefined,
    });
    customer.value = { ...updated, tickets: customer.value.tickets };
    dialogOpen.value = false;
  } catch (err) {
    conflictId.value = extractExistingCustomerId(err) ?? null;
    error.value = extractBackendErrorMessage(err) ?? t('customers.saveError');
  }
}

function goToTicket(_event: Event, row: { item: ApiCustomerTicket }) {
  router.push({ name: 'ticket-detail', params: { id: row.item.id } });
}

onMounted(load);
</script>
