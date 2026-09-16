import axios from 'axios';
const calls = [];
const t0 = Date.now();
axios.interceptors.request.use(c => { c.__t = Date.now(); return c; });
axios.interceptors.response.use(r => {
  const url = (r.config.baseURL || '') + r.config.url;
  calls.push({ url, ms: Date.now() - r.config.__t, bytes: JSON.stringify(r.data).length });
  return r;
});
process.on('exit', () => {
  const total = Date.now() - t0;
  const by = new Map();
  for (const c of calls) {
    // normalise ids so repeats group together
    const key = c.url.replace(/\/\d{6,}/g, '/<id>').split('?')[0];
    const e = by.get(key) || { n: 0, ms: 0, bytes: 0 };
    e.n++; e.ms += c.ms; e.bytes += c.bytes; by.set(key, e);
  }
  console.error('\n===== HTTP PROFILE =====');
  console.error(`total requests: ${calls.length}   wall: ${(total/1000).toFixed(1)}s   payload: ${(calls.reduce((s,c)=>s+c.bytes,0)/1048576).toFixed(1)} MB`);
  console.error('');
  [...by.entries()].sort((a,b)=>b[1].bytes-a[1].bytes).forEach(([k,v])=>{
    console.error(`${String(v.n).padStart(3)}x  ${(v.bytes/1048576).toFixed(2).padStart(6)} MB  ${String(v.ms).padStart(6)}ms  ${k}`);
  });
});
await import('./src/index.js');
