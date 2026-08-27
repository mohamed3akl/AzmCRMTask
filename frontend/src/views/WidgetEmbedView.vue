<template>
  <v-container fluid class="pa-4">
    <template v-if="!submitted">
      <h1 class="text-h6 mb-4">{{ $t('widget.title') }}</h1>
      <form @submit.prevent="submit">
        <v-text-field v-model="form.fullName" data-testid="widget-full-name" :label="$t('widget.fullName')" />
        <v-text-field v-model="form.email" data-testid="widget-email" :label="$t('widget.email')" />
        <v-text-field v-model="form.phone" data-testid="widget-phone" :label="$t('widget.phone')" />
        <v-text-field v-model="form.subject" data-testid="widget-subject" :label="$t('widget.subject')" />
        <v-textarea v-model="form.description" data-testid="widget-description" :label="$t('widget.description')" />
        <p v-if="error" data-testid="widget-error" class="text-error mb-2">{{ $t('widget.contactRequired') }}</p>
        <p v-if="submitErrorMessage" data-testid="widget-submit-error" class="text-error mb-2">{{ submitErrorMessage }}</p>
        <v-btn
          type="submit"
          color="primary"
          data-testid="widget-submit"
          :loading="submitting"
          :disabled="submitting"
        >
          {{ $t('widget.submit') }}
        </v-btn>
      </form>
    </template>
    <template v-else>
      <div data-testid="widget-confirmation">
        <p class="text-h6 mb-2">{{ $t('widget.thanks', { name: form.fullName }) }}</p>
        <p>{{ $t('widget.received') }}</p>
        <p class="font-weight-bold">{{ $t('widget.reference', { reference }) }}</p>
      </div>
    </template>
  </v-container>
</template>

<script setup lang="ts">
import { reactive, ref, onMounted, nextTick } from 'vue';
import { useI18n } from 'vue-i18n';
import { useLocale } from 'vuetify';
import axios from 'axios';
import { submitPublicTicket } from '../api/publicTickets';

const { t, locale: i18nLocale } = useI18n();
const { current: vuetifyLocale } = useLocale();

const form = reactive({ fullName: '', email: '', phone: '', subject: '', description: '' });
const submitted = ref(false);
const submitting = ref(false);
const reference = ref('');
const error = ref(false);
const submitErrorMessage = ref('');

function postHeight() {
  window.parent.postMessage({ source: 'azmcrm-widget', height: document.documentElement.scrollHeight }, '*');
}

function extractBackendErrorMessage(err: unknown): string | undefined {
  if (axios.isAxiosError(err)) {
    return err.response?.data?.error?.message;
  }
  return undefined;
}

async function submit() {
  if (!form.email.trim() && !form.phone.trim()) {
    error.value = true;
    return;
  }
  error.value = false;
  submitErrorMessage.value = '';
  submitting.value = true;
  try {
    const result = await submitPublicTicket({
      fullName: form.fullName.trim(),
      email: form.email.trim() || undefined,
      phone: form.phone.trim() || undefined,
      subject: form.subject.trim(),
      description: form.description.trim(),
    });
    reference.value = result.reference;
    submitted.value = true;
    await nextTick();
    postHeight();
  } catch (err) {
    submitErrorMessage.value = extractBackendErrorMessage(err) ?? t('widget.submitError');
  } finally {
    submitting.value = false;
  }
}

onMounted(async () => {
  const requestedLocale = new URLSearchParams(window.location.search).get('locale') === 'ar' ? 'ar' : 'en';
  i18nLocale.value = requestedLocale;
  vuetifyLocale.value = requestedLocale;
  document.documentElement.dir = requestedLocale === 'ar' ? 'rtl' : 'ltr';
  document.documentElement.lang = requestedLocale;
  await nextTick();
  postHeight();
});
</script>
