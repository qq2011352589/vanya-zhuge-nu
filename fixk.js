const fs = require('fs');
let s = fs.readFileSync('vanya_诸葛连弩.mjs', 'utf8');
let n = 0;

// 1. 英文属性改全局配对：支持 "Grants +55 magic skill and 40 defense" → magic:55, defense:40
const oldEn = s.match(/      \/\/ 英文「\+9 Defense」[\s\S]*?\n      \} else raw\.push\(t\);/);
if (oldEn) {
  const ne = `      // 英文「+9 Defense」「Grants +55 magic skill and 40 defense」——全局扫「数字+单词」配对
      let hitEn = false;
      const pairs = t.match(/([+-]?\\d+)\\s+([A-Za-z][A-Za-z ]{0,20})/g);
      if (pairs) {
        for (const pr of pairs) {
          const m2 = pr.match(/([+-]?\\d+)\\s+([A-Za-z][A-Za-z ]{0,20})/);
          if (!m2) continue;
          let key = String(m2[2]).trim().toLowerCase().replace(/\\s+/g, '_');
          key = key.replace(/_?skill_?/g, '').replace(/^_+|_+$/g, '');
          if (!key || key === 'and') continue;
          attrs[key] = parseInt(m2[1].replace('+', ''));
          hitEn = true;
        }
      }
      if (hitEn) continue;
      raw.push(t);`;
  s = s.replace(oldEn[0], ne);
  n++;
}

// 2. 套装加成：从标签结束后开始取，去掉 HTML 残渣
if (!s.includes("html.indexOf('>', pi)")) {
  s = s.replace("      const setBonus = pi < 0 ? [] : decodeEnt(html.slice(pi, pi + 2500).replace(/<[^>]+>/g, '\\n'))",
    "      const pg = pi < 0 ? -1 : html.indexOf('>', pi) + 1;   // 跳过标签本身，避免残留 \\"equipment-stats-panel\\">\\"\n      const setBonus = pg < 1 ? [] : decodeEnt(html.slice(pg, pg + 2500).replace(/<[^>]+>/g, '\\n'))");
  n++;
}

fs.writeFileSync('vanya_诸葛连弩.mjs', s);
console.log('英文属性解析与套装残渣修复（' + n + '/2）');
