const fs = require('fs');
const snap = () => {
  const m = {};
  for (const d of fs.readdirSync('/proc').filter(x => /^\d+$/.test(x))) {
    try {
      const st = fs.readFileSync('/proc/' + d + '/stat', 'utf8');
      const rp = st.lastIndexOf(')');
      const parts = st.slice(rp + 2).split(' ');
      const name = st.slice(st.indexOf('(') + 1, rp).slice(0, 30);
      const utime = parseInt(parts[11]), stime = parseInt(parts[12]);
      m[d] = { name, cpu: utime + stime };
    } catch (e) {}
  }
  return m;
};
const s1 = snap();
setTimeout(() => {
  const s2 = snap();
  const rows = [];
  for (const pid in s2) {
    if (s1[pid]) {
      const delta = (s2[pid].cpu - s1[pid].cpu) / 100;   // jiffies→秒(100Hz)
      if (delta > 0.5) rows.push({ name: s2[pid].name, sec: delta.toFixed(1) });
    }
  }
  rows.sort((a, b) => b.sec - a.sec);
  const out = rows.slice(0, 6).map(r => r.name.padEnd(28) + r.sec + 's/' + '10s窗口').join('\n');
  fs.writeFileSync('/tmp/proc.txt', out || '无显著进程');
}, 10000);
console.log('采样中(10s)...');
