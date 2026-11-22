// E2E 种子：注入吃醋锁测试角色（v1.9.19）
// - contacts store：AI 女友「林小满」（kind=char，sms 好友）
// - kv store：一条她的消息（会话列表可见）
window.__seedDone = (async () => {
  const now = Date.now();
  const rec = {
    id: 'c_jeal',
    kind: 'char',
    ownerId: null,
    name: '林小满',
    nickname: null,
    gender: '女',
    age: '23',
    height: '163cm',
    weight: '48kg',
    persona: '你是林小满，我的女朋友，恋爱两年。你温柔但爱吃醋、粘人，特别在意我有没有冷落你。我刷抖音、打游戏不理你的时候，你会委屈、会撒娇、偶尔会真的生气。你说话软软的，喜欢用叠词，生气时会说「哼」，但心特别软，我一哄就好。',
    background: '大学毕业后在一家设计公司做插画师，养了一只橘猫叫团子。我们异地，每天靠微信联系，你最期待晚上和我视频。',
    expressStyle: '软萌粘人，爱撒娇，吃醋时赌气但一哄就好，偶尔傲娇',
    customRules: null,
    occupation: '插画师',
    company: null,
    region: '杭州',
    birthday: '6月18日',
    relation: '女朋友',
    relationToUser: '男朋友',
    phone: '13800138000',
    wechatId: 'wxid_xiaoman001',
    wechatPassword: null,
    qqId: '123456789',
    qqPassword: null,
    avatar: null,
    avatars: null,
    remark: null,
    remarks: null,
    voiceId: null,
    altOf: null,
    isFriend: true,
    friendSms: true,
    createdAt: new Date(now - 86400000 * 30).toISOString(),
  };
  const msgs = [
    { id: 'm_seed_1', role: 'assistant', content: '宝宝~今晚想我了没呀？团子都睡了，就我还在等你消息呢', time: now - 3600_000 },
  ];
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('ios-phone-db');
    req.onsuccess = () => {
      const db = req.result;
      try {
        const tx = db.transaction(['contacts', 'kv'], 'readwrite');
        tx.objectStore('contacts').put(rec);
        tx.objectStore('kv').put({ key: 'ios-chat-msgs:c:c_jeal', value: msgs });
        tx.oncomplete = () => { db.close(); resolve('seeded'); };
        tx.onerror = () => reject(tx.error);
      } catch (e) { reject(e); }
    };
    req.onerror = () => reject(req.error);
  });
})().then(
  (v) => { window.__seedResult = v; },
  (e) => { window.__seedResult = 'ERR:' + (e && e.message ? e.message : e); },
);
