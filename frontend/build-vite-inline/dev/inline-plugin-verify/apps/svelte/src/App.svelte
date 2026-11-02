<script>
let n = $state((() => { try { return +localStorage.getItem('n') || 0 } catch (e) { return 0 } })());
$effect(() => { try { localStorage.setItem('n', n) } catch (e) {} document.title = 'Tugas ' + n });
</script>
<div class="card"><h1>Tugas — 日本語 🌱</h1><p id="count">{n}</p><button id="inc" onclick={() => n++}>Tambah</button></div>
<style>.b{margin:0}.card{padding:24px;width:400px;background:#fff;font:16px/1.4 system-ui}button{padding:8px 16px}</style>