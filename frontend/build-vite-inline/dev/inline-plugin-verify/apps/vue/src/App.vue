<script setup>
import { ref, watch } from 'vue';
const read = () => { try { return +localStorage.getItem('n') || 0 } catch (e) { return 0 } };
const n = ref(read());
watch(n, (v) => { try { localStorage.setItem('n', v) } catch (e) {} document.title = 'Tugas ' + v }, { immediate: true });
</script>
<template><div class="card"><h1>Tugas — 日本語 🌱</h1><p id="count">{{ n }}</p><button id="inc" @click="n++">Tambah</button></div></template>
<style>.b{margin:0}.card{padding:24px;width:400px;background:#fff;font:16px/1.4 system-ui}button{padding:8px 16px}</style>