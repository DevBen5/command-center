<script setup lang="ts">
import { nope } from '#modules/does-not-exist/nope.js'
defineProps<{ error: any }>()
</script>

<template>
  <div class="container">
    <div class="title">Server Error</div>

    <span>{{ error.message }} {{ nope }}</span>
  </div>
</template>
