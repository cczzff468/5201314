// 对比备份分支与 main 的应用文件：找出备份里有而 main 缺失的特征中文字符串（功能丢失探测）
import { execSync } from 'child_process';

const files = ['wechat', 'qq', 'chat', 'contacts', 'settings', 'phone', 'chat-settings', 'themes', 'moments-shared', 'wx-group', 'qq-group', 'memory-bank', 'worldbook', 'notes', 'recorder', 'reminders', 'files', 'calculator', 'sticker-batch', 'forward-sheet', 'bubble-menu', 'page-toast', 'wx-icons', 'default-avatar', 'weather-core'];

const show = (ref, f) => {
  try { return execSync(`git show ${ref}:${f}`, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 }); } catch { return null; }
};

let anyMissing = false;
for (const name of files) {
  const f = `src/components/apps/${name}.tsx`;
  const b = show('origin/backup/remote-main-0923', f);
  const m = show('main', f);
  if (b === null || m === null) continue;
  // 提取备份文件里的中文字符串（长度2~24）
  // 剥离注释行（//、/*、* 开头）与注释块内容，只留代码与 JSX 文本
  const stripComments = (src) => {
    let out = '';
    for (const line of src.split('\n')) {
      const t = line.trim();
      if (t.startsWith('//') || t.startsWith('/*') || t.startsWith('*')) continue;
      out += line.replace(/\/\*[\s\S]*?\*\//g, '') + '\n';
    }
    return out;
  };
  const strs = new Set();
  const re = /[\u4e00-\u9fff][\u4e00-\u9fff\w：，。！？、·…（）]{1,23}/g;
  for (const s of stripComments(b).match(re) || []) strs.add(s);
  const missing = [];
  for (const s of strs) { if (!stripComments(m).includes(s)) missing.push(s); }
  if (missing.length) {
    anyMissing = true;
    console.log(`\n== ${name}.tsx  缺失 ${missing.length} 条:`);
    for (const s of missing.slice(0, 25)) console.log('  ' + s);
  }
}
if (!anyMissing) console.log('NO MISSING STRINGS');
