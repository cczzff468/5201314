// agent-browser eval 载体脚本（第四十四轮）：微信+QQ 双液态主题种子（联系人+消息+未读+置顶+登录态）
(async () => {
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('ios-phone-db');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const now = Date.now();
  const mk = (over) => ({
    kind: 'char', ownerId: null, name: '', nickname: null, gender: '女', age: '22', height: null, weight: null,
    persona: null, background: null, occupation: null, company: null, region: null, relation: '朋友', relationToUser: '朋友',
    phone: null, wechatId: null, wechatPassword: null, qqId: null, qqPassword: null,
    avatar: null, isFriend: true, friendWx: true, friendQq: true, createdAt: new Date(now - 86400000 * 30).toISOString(),
    ...over
  });
  const owner = {
    id: 'u-e2e-owner', kind: 'user', ownerId: null, name: '小柚', nickname: null, gender: '女', age: '22', height: null, weight: null,
    persona: null, background: null, occupation: null, company: null, region: null, relation: null,
    phone: '88888888', wechatId: 'xiaoyou888', wechatPassword: '123456', qqId: '10000', qqPassword: '123456',
    avatar: null, isFriend: true, friendWx: true, friendQq: true, createdAt: new Date(now - 86400000 * 90).toISOString()
  };
  const fanfan = mk({ id: 'c-fanfan', name: '凡凡', age: '21', relation: '恋人', relationToUser: '恋人', occupation: '插画师', region: '杭州', persona: '你是凡凡，机主小柚的恋人。性格温柔黏人爱撒娇，说话简短口语化。', phone: '13900001111', wechatId: 'fanfan-wx', qqId: '20001', qqPassword: '123456' });
  const momo = mk({ id: 'c-momo', gender: '男', age: '24', occupation: '程序员', company: '字节跳动', region: '北京', relation: '同事', relationToUser: '同事', persona: '你是墨墨，小柚的同事程序员，理性冷静爱聊技术。', phone: '13900002222', wechatId: 'momo-wx', qqId: '20002', qqPassword: '123456' });
  const lin = mk({ id: 'c-lin', name: '林阿姨', gender: '女', age: '48', occupation: null, company: null, region: '杭州', relation: '家人', relationToUser: '妈妈', persona: '你是林阿姨，小柚的妈妈，关心女儿生活。', phone: '13900003333', wechatId: 'lin-wx', qqId: '20003', qqPassword: '123456' });
  const contacts = [owner, fanfan, momo, lin];
  await new Promise((res, rej) => {
    const tx = db.transaction('contacts', 'readwrite');
    contacts.forEach(c => tx.objectStore('contacts').put(c));
    tx.oncomplete = () => res(null);
    tx.onerror = () => rej(tx.error);
  });
  const msgsOf = (list) => list.map((m) => ({ id: m.id, role: m.role, content: m.text, time: now - m.ago }));
  const chatData = {
    'wx-chat-msgs:c-fanfan': msgsOf([
      { id: 'f1', role: 'peer', text: '宝宝早呀～今天也要元气满满哦', ago: 3600000 * 6 },
      { id: 'f2', role: 'me', text: '早上好呀凡凡！昨晚睡得好吗', ago: 3600000 * 6 - 60000 },
      { id: 'f3', role: 'peer', text: '睡得超好的！梦见你了嘿嘿', ago: 3600000 * 5 },
      { id: 'f4', role: 'me', text: '哈哈那你今天打算干嘛呀', ago: 3600000 * 4 },
      { id: 'f5', role: 'peer', text: '要画完那张稿子，然后想你了就找你聊天～', ago: 3600000 * 3 },
    ]),
    'wx-chat-msgs:c-momo': msgsOf([
      { id: 'm1', role: 'peer', text: '那个需求评审改到明天了', ago: 3600000 * 9 },
      { id: 'm2', role: 'me', text: '好，那今天可以早点下班了哈哈', ago: 3600000 * 8 },
    ]),
    'wx-chat-msgs:c-lin': msgsOf([
      { id: 'l1', role: 'peer', text: '柚柚，这周回家吃饭吗？妈妈炖了汤', ago: 3600000 * 26 },
      { id: 'l2', role: 'me', text: '回！周六就回去～', ago: 3600000 * 25 },
    ]),
    'qq-chat-msgs:c-fanfan': msgsOf([
      { id: 'q1', role: 'peer', text: 'QQ 也来陪你聊天啦～', ago: 3600000 * 3 },
      { id: 'q2', role: 'me', text: '哈哈好呀', ago: 3600000 * 3 - 60000 },
    ]),
    'qq-chat-msgs:c-momo': msgsOf([
      { id: 'q3', role: 'peer', text: '代码写完了吗，兄弟', ago: 3600000 * 10 },
    ]),
  };
  await new Promise((res, rej) => {
    const tx = db.transaction('kv', 'readwrite');
    Object.entries(chatData).forEach(([key, value]) => tx.objectStore('kv').put({ key, value }));
    tx.oncomplete = () => res(null);
    tx.onerror = () => rej(tx.error);
  });
  await new Promise((res, rej) => {
    const tx = db.transaction('settings', 'readwrite');
    tx.objectStore('settings').put({
      key: 'bubbleStyle',
      value: { wx: { kind: 'liquid', theme: 'liquid' }, qq: { kind: 'liquid', theme: 'liquid' }, sms: { kind: 'default' } }
    });
    tx.oncomplete = () => res(null);
    tx.onerror = () => rej(tx.error);
  });
  window.localStorage.setItem('wx-session-user-id', 'u-e2e-owner');
  window.localStorage.setItem('qq-session-user-id', 'u-e2e-owner');
  window.localStorage.setItem('wx-chat-unreads', JSON.stringify({ 'c-fanfan': 2, 'c-momo': 1 }));
  window.localStorage.setItem('qq-chat-unreads', JSON.stringify({ 'c-fanfan': 1 }));
  // 置顶：微信凡凡置顶 / QQ 墨墨置顶 → 验证置顶/非置顶各一张白色面板
  window.localStorage.setItem('wx-chat-flags', JSON.stringify({ 'c-fanfan': { pinned: true } }));
  window.localStorage.setItem('qq-chat-flags', JSON.stringify({ 'c-momo': { pinned: true } }));
  return 'seeded-v45: 4 contacts + wx/qq chats + both liquid + pinned + logins';
})()
