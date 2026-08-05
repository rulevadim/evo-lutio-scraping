<script setup lang="ts">
useHead({ title: 'Вход — Эволюция' })

const { isAdmin, login, logout, handleLoginError } = useAdmin()
const password = ref('')
const busy = ref(false)
const error = ref('')

async function submit() {
  if (busy.value || !password.value) return
  busy.value = true
  error.value = ''
  try {
    await login(password.value)
    password.value = ''
    await navigateTo('/')
  } catch (err) {
    error.value = handleLoginError(err)
  } finally {
    busy.value = false
  }
}

async function signOut() {
  busy.value = true
  try {
    await logout()
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-sm">
    <h1 class="mb-4 text-xl font-semibold">Администрирование</h1>

    <div v-if="isAdmin" class="space-y-3">
      <p class="text-sm text-neutral-600">Вы вошли. Кнопки скрейпинга видны на главной.</p>
      <div class="flex gap-2">
        <NuxtLink
          to="/"
          class="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm hover:border-neutral-500"
        >
          На главную
        </NuxtLink>
        <button
          type="button"
          class="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm hover:border-neutral-500 disabled:opacity-50"
          :disabled="busy"
          @click="signOut"
        >
          Выйти
        </button>
      </div>
    </div>

    <form v-else class="space-y-3" @submit.prevent="submit">
      <p class="text-sm text-neutral-500">
        Скрейпинг доступен только администратору. Чтение и поиск открыты всем.
      </p>
      <input
        v-model="password"
        type="password"
        autocomplete="current-password"
        placeholder="Пароль"
        :disabled="busy"
        class="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-500 disabled:opacity-50"
      >
      <button
        type="submit"
        class="w-full rounded-lg border border-neutral-800 bg-neutral-800 px-4 py-2 text-sm text-white hover:bg-neutral-700 disabled:opacity-50"
        :disabled="busy || !password"
      >
        {{ busy ? 'Проверяем…' : 'Войти' }}
      </button>
      <p v-if="error" class="text-sm text-red-600">{{ error }}</p>
    </form>
  </div>
</template>
