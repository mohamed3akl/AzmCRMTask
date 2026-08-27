<template>
  <v-container fluid v-if="ticket">
    <div class="d-flex justify-space-between align-center mb-4">
      <h1>{{ ticket.subject }}</h1>
      <v-chip v-if="ticket.isEscalated" color="error">{{ $t('tickets.escalated') }}</v-chip>
    </div>

    <v-row>
      <v-col cols="12" md="8">
        <p class="mb-4">{{ ticket.description }}</p>

        <v-select
          data-testid="quick-reply-select"
          :items="quickReplyOptions"
          item-title="title"
          item-value="id"
          :item-props="(item: { id: string }) => ({ 'data-testid': `quick-reply-option-${item.id}` })"
          :label="$t('tickets.insertQuickReply')"
          clearable
          @update:model-value="insertQuickReply"
        />
        <v-text-field
          v-model="noteText"
          data-testid="note-input"
          :label="$t('tickets.addNote')"
          append-inner-icon="mdi-send"
          @click:append-inner="submitNote"
          @keyup.enter="submitNote"
        />
        <v-btn data-testid="add-note-button" class="d-none" @click="submitNote">{{ $t('tickets.addNote') }}</v-btn>

        <h2 class="text-h6 mb-2 mt-4">{{ $t('tickets.timeline') }}</h2>
        <v-timeline density="compact" side="end">
          <v-timeline-item v-for="event in ticket.events" :key="event.id" size="small">
            <div>{{ describeEvent(event) }}</div>
            <div class="text-caption">{{ event.author.fullName }} — {{ new Date(event.createdAt).toLocaleString() }}</div>
          </v-timeline-item>
        </v-timeline>
      </v-col>

      <v-col cols="12" md="4">
        <v-select
          :model-value="ticket.status"
          :items="statusOptions"
          :label="$t('tickets.status')"
          @update:model-value="onStatusChange"
        />
        <v-select
          :model-value="ticket.priority"
          :items="priorityOptions"
          :label="$t('tickets.priority')"
          @update:model-value="onPriorityChange"
        />
        <v-select
          :model-value="ticket.category?.id ?? null"
          :items="categories"
          item-title="nameEn"
          item-value="id"
          :label="$t('tickets.category')"
          clearable
          @update:model-value="onCategoryChange"
        />
        <v-select
          :model-value="ticket.department?.id ?? null"
          :items="departments"
          item-title="nameEn"
          item-value="id"
          :label="$t('tickets.department')"
          clearable
          @update:model-value="onDepartmentChange"
        />

        <v-select
          v-if="canReassignFreely"
          :model-value="ticket.assignee?.id ?? null"
          :items="agents"
          item-title="fullName"
          item-value="id"
          :label="$t('tickets.assignee')"
          clearable
          @update:model-value="onAssign"
        />
        <template v-else>
          <v-list-item :title="$t('tickets.assignee')" :subtitle="ticket.assignee?.fullName ?? '-'" />
          <v-btn v-if="!ticket.assignee" size="small" @click="claim">{{ $t('tickets.claim') }}</v-btn>
          <v-btn v-else-if="isAssignedToMe" size="small" @click="release">{{ $t('tickets.release') }}</v-btn>
        </template>

        <v-btn v-if="!ticket.isEscalated" class="mt-4" color="warning" block @click="escalateDialogOpen = true">
          {{ $t('tickets.escalate') }}
        </v-btn>
        <v-btn v-else class="mt-4" block @click="unescalate">{{ $t('tickets.unescalate') }}</v-btn>

        <v-list density="compact" class="mt-4">
          <v-list-item :title="$t('tickets.customer')" :subtitle="ticket.customer.fullName" />
          <v-list-item :title="$t('tickets.createdBy')" :subtitle="ticket.createdBy.fullName" />
        </v-list>
      </v-col>
    </v-row>

    <v-dialog v-model="escalateDialogOpen" max-width="480">
      <v-card :title="$t('tickets.escalate')">
        <v-card-text>
          <v-text-field v-model="escalateNote" :label="$t('tickets.escalateNote')" />
          <v-btn color="warning" @click="escalate">{{ $t('tickets.escalate') }}</v-btn>
        </v-card-text>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import {
  fetchTicket,
  updateTicket,
  assignTicket,
  escalateTicket,
  unescalateTicket,
  addTicketNote,
  type ApiTicketDetail,
  type ApiTicketEvent,
  type TicketStatus,
  type TicketPriority,
} from '../../api/tickets';
import { fetchTicketCategories, type ApiTicketCategory } from '../../api/ticketCategories';
import { fetchDepartments, type ApiDepartment } from '../../api/departments';
import { fetchUsers, type ApiUser } from '../../api/users';
import { fetchQuickReplies, type ApiQuickReply } from '../../api/quickReplies';
import { useAuthStore } from '../../stores/auth';

const route = useRoute();
const auth = useAuthStore();
const { locale } = useI18n();
const ticket = ref<ApiTicketDetail | null>(null);
const categories = ref<ApiTicketCategory[]>([]);
const departments = ref<ApiDepartment[]>([]);
const agents = ref<ApiUser[]>([]);
const quickReplies = ref<ApiQuickReply[]>([]);
const noteText = ref('');
const escalateDialogOpen = ref(false);
const escalateNote = ref('');

const statusOptions: TicketStatus[] = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
const priorityOptions: TicketPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];

const canReassignFreely = computed(
  () => auth.currentUser?.role === 'ADMIN' || auth.currentUser?.role === 'SUPERVISOR'
);
const isAssignedToMe = computed(() => ticket.value?.assignee?.id === auth.currentUser?.id);
const quickReplyOptions = computed(() =>
  quickReplies.value.map((r) => ({ id: r.id, title: r.titleEn }))
);

const eventDescriptions: Record<string, (event: ApiTicketEvent) => string> = {
  STATUS_CHANGED: (e) => `Status changed from ${e.oldValue} to ${e.newValue}`,
  PRIORITY_CHANGED: (e) => `Priority changed from ${e.oldValue} to ${e.newValue}`,
  CATEGORY_CHANGED: () => 'Category changed',
  DEPARTMENT_CHANGED: () => 'Department changed',
  ASSIGNEE_CHANGED: () => 'Assignee changed',
  ESCALATED: (e) => `Escalated${e.note ? `: ${e.note}` : ''}`,
  UNESCALATED: () => 'Unescalated',
  NOTE_ADDED: (e) => e.note ?? '',
};

function describeEvent(event: ApiTicketEvent): string {
  return eventDescriptions[event.type]?.(event) ?? event.type;
}

async function load() {
  ticket.value = await fetchTicket(route.params.id as string);
}

async function onStatusChange(value: TicketStatus) {
  ticket.value = await updateTicket(ticket.value!.id, { status: value });
}

async function onPriorityChange(value: TicketPriority) {
  ticket.value = await updateTicket(ticket.value!.id, { priority: value });
}

async function onCategoryChange(value: string | null) {
  ticket.value = await updateTicket(ticket.value!.id, { categoryId: value });
}

async function onDepartmentChange(value: string | null) {
  ticket.value = await updateTicket(ticket.value!.id, { departmentId: value });
}

async function onAssign(value: string | null) {
  ticket.value = await assignTicket(ticket.value!.id, value);
}

async function claim() {
  ticket.value = await assignTicket(ticket.value!.id, auth.currentUser!.id);
}

async function release() {
  ticket.value = await assignTicket(ticket.value!.id, null);
}

async function escalate() {
  ticket.value = await escalateTicket(ticket.value!.id, escalateNote.value || undefined);
  escalateDialogOpen.value = false;
  escalateNote.value = '';
}

async function unescalate() {
  ticket.value = await unescalateTicket(ticket.value!.id);
}

async function submitNote() {
  if (!noteText.value.trim()) return;
  ticket.value = await addTicketNote(ticket.value!.id, noteText.value);
  noteText.value = '';
}

function insertQuickReply(id: string | null) {
  if (!id) return;
  const reply = quickReplies.value.find((r) => r.id === id);
  if (!reply) return;
  const body = locale.value === 'ar' ? reply.bodyAr : reply.bodyEn;
  noteText.value = noteText.value ? `${noteText.value} ${body}` : body;
}

onMounted(async () => {
  await load();
  try {
    categories.value = await fetchTicketCategories();
  } catch {
    // Non-fatal: category list may be empty if unavailable; the select just stays empty.
  }
  try {
    departments.value = await fetchDepartments();
  } catch {
    // Non-fatal: department list may be empty if unavailable; the select just stays empty.
  }
  if (canReassignFreely.value) {
    try {
      agents.value = await fetchUsers();
    } catch {
      // Non-fatal: assignee list may be empty if unavailable.
    }
  }
  try {
    quickReplies.value = await fetchQuickReplies();
  } catch {
    // Non-fatal: quick reply list may be empty if unavailable.
  }
});
</script>
