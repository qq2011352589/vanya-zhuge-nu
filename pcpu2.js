const fs = require('fs');
const snap = () => {
  const m = {};
  for (const d of fs.readdirSync('/proc').filter(x => /^\d+$/.test(x))) {
    try {
      const st = fs.readFileSync('/proc/' + d + '/stat', 'utf8');
      const rp = st.lastIndexOf(')');
      const parts = st.slice(rp + 2).split(' ');
      const utime = parseInt(parts[11]), stime = parseInt(parts[12]);
      let cmd = '';
      try { cmd = fs.readFileSync('/proc/' + d + '/cmdline', 'utf8').replace(/\0/g, ' '); } catch (e) {}
      let type = 'browser(主进程)';
      const tm = cmd.match(/--type=(\S+)/);
      if (tm) type = tm[1];
      if (/server\.mjs/.test(cmd)) type = 'node(server)';
      m[d] = { type, cpu: utime + stime };
    } catch (e) {}
  }
  return m;
};
const s1 = snap();
setTimeout(() => {
  const s2 = snap();
  const agg = {};
  for (const pid in s2) {
    if (s1[pid]) {
      const delta = (s2[pid].cpu - s1[pid].cpu) / 100;
      agg[s2[pid].type] = (agg[s2[pid].type] || 0) + delta;
    }
  }
  const out = Object.entries(agg).sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([t, v]) => t.padEnd(22) + v.toFixed(1) + 's/10s窗口 (≈' + Math.round(v * 10) + '%)').join('\n');
  fs.writeFileSync('/tmp/proc2.txt', out || '无');
}, 10000);
console.log('采样中(10s)...');
