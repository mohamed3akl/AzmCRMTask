<template>
  <v-container>
    <h1 class="mb-4">{{ $t('tickets.create') }}</h1>
    <form @submit.prevent="submit">
      <v-autocomplete
        v-if="!creatingNewCustomer"
        v-model="selectedCustomerId"
        v-model:search="customerQuery"
        :items="customerOptions"
        item-title="fullName"
        item-value="id"
        :label="$t('tickets.customer')"
        @update:search="onCustomerSearch"
      />
      <v-btn data-testid="toggle-new-customer" variant="text" class="mb-4" @click="toggleNewCustomer">
        {{ creatingNewCustomer ? $t('tickets.pickExistingCustomer') : $t('tickets.newCustomer') }}
      </v-btn>

      <template v-if="creatingNewCustomer">
        <v-text-field
          v-model="newCustomer.fullName"
          data-testid="new-customer-name"
          :label="$t('tickets.customerFullName')"
        />
        <v-text-field v-model="newCustomer.email" :label="$t('tickets.customerEmail')" />
        <v-text-field v-model="newCustomer.phone" :label="$t('tickets.customerPhone')" />
      </template>

      <v-text-field v-model="form.subject" data-testid="ticket-subject" :label="$t('tickets.subject')" />
      <v-textarea v-model="form.description" data-testid="ticket-description" :label="$t('tickets.description')" />
      <v-select v-model="form.priority" :items="priorityOptions" :label="$t('tickets.priority')" />
      <v-select
        v-model="form.categoryId"
        :items="categories"
        item-title="nameEn"
        item-value="id"
        :label="$t('tickets.category')"
        clearable
      />
      <v-select
        v-model="form.departmentId"
        :items="departments"
        item-title="nameEn"
        item-value="id"
        :label="$t('tickets.department')"
        clearable
      />
      <v-btn type="submit" color="primary">{{ $t('tickets.create') }}</v-btn>
    </form>
  </v-container>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { createTicket, type TicketPriority } from '../../api/tickets';
import { searchCustomers, type ApiCustomer } from '../../api/customers';
import { fetchTicketCategories, type ApiTicketCategory } from '../../api/ticketCategories';
import { fetchDepartments, type ApiDepartment } from '../../api/departments';

const router = useRouter();

const creatingNewCustomer = ref(false);
const selectedCustomerId = ref<string | null>(null);
const customerQuery = ref('');
const customerOptions = ref<ApiCustomer[]>([]);
const newCustomer = reactive({ fullName: '', email: '', phone: '' });

const categories = ref<ApiTicketCategory[]>([]);
const departments = ref<ApiDepartment[]>([]);
const priorityOptions: TicketPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];

const form = reactive({
  subject: '',
  description: '',
  priority: 'MEDIUM' as TicketPriority,
  categoryId: null as string | null,
  departmentId: null as string | null,
});

function toggleNewCustomer() {
  creatingNewCustomer.value = !creatingNewCustomer.value;
  selectedCustomerId.value = null;
}

async function onCustomerSearch(query: string) {
  customerOptions.value = await searchCustomers(query);
}

async function submit() {
  let customerId: string | undefined;
  let newCustomerPayload: { fullName: string; email?: string; phone?: string } | undefined;

  if (creatingNewCustomer.value) {
    newCustomerPayload = {
      fullName: newCustomer.fullName,
      email: newCustomer.email || undefined,
      phone: newCustomer.phone || undefined,
    };
  } else {
    customerId = selectedCustomerId.value ?? undefined;
  }

  const ticket = await createTicket({
    subject: form.subject,
    description: form.description,
    customerId,
    newCustomer: newCustomerPayload,
    priority: form.priority,
    categoryId: form.categoryId,
    departmentId: form.departmentId,
  });

  router.push({ name: 'ticket-detail', params: { id: ticket.id } });
}

onMounted(async () => {
  categories.value = await fetchTicketCategories();
  departments.value = await fetchDepartments();
});
</script>
