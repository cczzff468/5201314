// 注入恋人空间测试状态（含旧卡索引，验证迁移）
window.__seedDone = (async () => {
  const st = {
    v: 1,
    accepted: true,
    anniversary: '2024-05-20',
    meName: '阿泽',
    taName: '小柔',
    signature: '余生请多指教',
    gender: '男',
    coupleNo: 'CP5201314',
    boardNotes: [
      { id: 'tA1', from: 'me', text: '旧样式一（card=1）→ 保持样式一', at: 1730000000000, card: 1, comments: [] },
      { id: 'tB2', from: 'ta', text: '旧样式五（card=5）→ 迁移成新的样式二位置，横幅缩小居中', at: 1730000001000, card: 5, comments: [] },
      { id: 'tC3', from: 'me', text: '旧样式三（card=3）已删除 → 归一到样式一', at: 1730000002000, card: 3, comments: [] },
      { id: 'tD7', from: 'ta', text: '旧奶油小熊（card=7）已删除 → 归一到样式一', at: 1730000003000, card: 7, comments: [] },
      { id: 'tE0', from: 'me', text: '素白卡默认色', at: 1730000004000, color: 0, comments: [] },
    ],
    boardBg: 1,
  };
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('ios-phone-db');
    req.onsuccess = () => {
      const db = req.result;
      try {
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put({ key: 'couple-space:state', value: st });
        tx.oncomplete = () => { db.close(); resolve('seeded'); };
        tx.onerror = () => reject(tx.error);
      } catch (e) { reject(e); }
    };
    req.onerror = () => reject(req.error);
  });
})();
