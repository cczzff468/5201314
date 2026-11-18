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
  const momo = mk({ id: 'c-momo', name: '墨墨', gender: '男', age: '24', occupation: '程序员', company: '字节跳动', region: '北京', relation: '同事', relationToUser: '同事', persona: '你是墨墨，小柚的同事程序员，理性冷静爱聊技术。', phone: '13900002222', wechatId: 'momo-wx', qqId: '20002', qqPassword: '123456' });
  const contacts = [owner, fanfan, momo];
  await new Promise((res, rej) => {
    const tx = db.transaction('contacts', 'readwrite');
    contacts.forEach(c => tx.objectStore('contacts').put(c));
    tx.oncomplete = () => res(null);
    tx.onerror = () => rej(tx.error);
  });
  // 语音消息（带长转写文本——验证转文字面板限宽）+ 普通文本
  const wave = [0.5,0.8,0.4,0.9,0.6,0.75,0.45,0.85,0.55,0.7,0.5,0.8,0.62,0.88,0.5];
  const msgsOf = (list) => list.map((m) => ({
    id: m.id, role: m.role, content: '', time: now - m.ago,
    ...(m.voice ? { voice: { url: '', duration: m.voice.dur, wave, localText: m.voice.text, transcript: m.voice.text, stt: 'done' } } : { content: m.text })
  }));
  const longText = '今天在画室待了一整天，那幅委托的插画终于快要收尾了，配色改了好几版，现在这版是暖暖的橘色系，我觉得特别有秋天的感觉，你一定会喜欢的，等我画完第一时间给你看好不好呀？';
  const chatData = {
    'wx-chat-msgs:c-fanfan': msgsOf([
      { id: 'f1', role: 'peer', text: '宝宝早呀～今天也要元气满满哦', ago: 3600000 * 6 },
      { id: 'f2', role: 'me', text: '早上好呀凡凡！昨晚睡得好吗', ago: 3600000 * 6 - 60000 },
      { id: 'f3', role: 'peer', voice: { dur: 6, text: longText }, ago: 3600000 * 5 },
      { id: 'f4', role: 'me', voice: { dur: 4, text: '好好好，那我等着看！你画画的时候也要记得休息眼睛呀，别一坐就是一整天。' }, ago: 3600000 * 4 },
      { id: 'f5', role: 'peer', text: '要画完那张稿子，然后想你了就找你聊天～', ago: 3600000 * 3 },
    ]),
    'qq-chat-msgs:c-fanfan': msgsOf([
      { id: 'q1', role: 'peer', text: 'QQ 也来陪你聊天啦～', ago: 3600000 * 3 },
      { id: 'q2', role: 'peer', voice: { dur: 8, text: longText }, ago: 3600000 * 3 - 60000 },
      { id: 'q3', role: 'me', text: '哈哈好呀', ago: 3600000 * 2 },
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
  window.localStorage.setItem('wx-chat-unreads', JSON.stringify({ 'c-fanfan': 1 }));
  window.localStorage.setItem('qq-chat-unreads', JSON.stringify({ 'c-fanfan': 1 }));
  window.localStorage.setItem('wx-chat-flags', JSON.stringify({ 'c-fanfan': { pinned: true } }));
  window.localStorage.setItem('qq-chat-flags', JSON.stringify({}));
  return 'seeded-v47: contacts + voice msgs w/ long transcripts + both liquid';
})()
