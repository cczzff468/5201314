'use client';

/**
 * 位置消息 → AI 上下文（微信单聊 / QQ 单聊 / 微信群 / QQ 群 / 语音通话共用一套）：
 *
 * 背景：位置卡片消息 content 为空串，历史上单聊两端的 AI 历史过滤把整条丢弃、
 * 群聊两端只给「[位置] 名称」，AI 从来拿不到「用户在哪」——用户问"你知道我在哪吗"
 * 时 AI 只能装糊涂。本模块把位置消息统一升级为：
 *
 * 1. 数据完整：地点名称 + 详细地址 + 经纬度（lat/lng）+ 发送时间（消息自身 time 字段）；
 * 2. 历史可读：locationAiText 生成「[位置]「公园」（地址）（经纬度 121.4,31.2），发送于 10:34」
 *    进对话历史，AI 像读一条普通消息一样读到位置内容；
 * 3. system 注入：buildLocationBlock 扫描最近消息里最新的一条位置，生成【位置消息】块注入
 *    system——AI 被明确告知"这就是用户所在位置，问起时直接说出地点名，不要假装记不清"；
 * 4. 解析失败不编造：地点名缺失/空白时历史文本为「[位置]（无法识别该位置）」，
 *    system 块明确要求 AI 诚实告知无法识别，禁止编造地名；
 * 5. 记忆参与：位置消息以「发送了位置「公园」」形态进入记忆提取（memory.ts memConvoFromRaw），
 *    后续聊天可被召回引用；
 * 6. 文字回复与语音通话回复共用：单聊/群聊 runAiTurn 与通话 openVoiceCall → phone/turn
 *    的 locBlock 全部走本模块，注入口径一致。
 */

/** 位置数据规范形态（兼容各端 loc 字段差异：wx 用 address，qq 用 addr） */
export interface ChatLocData {
  name: string;
  address: string;
  lat?: number;
  lng?: number;
}

/** 「lat,lng」形态的地址串（旧数据/AI 标记把坐标塞在地址字段里，也能解析回经纬度） */
const COORDS_RE = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*[,，]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;

/** 任意端的 loc 字段 → 规范形态（name/address/addr/lat/lng 宽松读取，坐标串兜底解析） */
export function locDataOf(loc: unknown): ChatLocData {
  if (!loc || typeof loc !== 'object') return { name: '', address: '' };
  const o = loc as { name?: unknown; address?: unknown; addr?: unknown; lat?: unknown; lng?: unknown };
  const name = typeof o.name === 'string' ? o.name.trim() : '';
  const rawAddr = typeof o.address === 'string' ? o.address.trim() : typeof o.addr === 'string' ? o.addr.trim() : '';
  let lat = typeof o.lat === 'number' && Number.isFinite(o.lat) ? o.lat : undefined;
  let lng = typeof o.lng === 'number' && Number.isFinite(o.lng) ? o.lng : undefined;
  let address = rawAddr;
  if ((lat == null || lng == null) && rawAddr) {
    const m = COORDS_RE.exec(rawAddr);
    if (m) {
      lat = lat ?? Number(m[1]);
      lng = lng ?? Number(m[2]);
      address = ''; // 坐标串不是人类可读地址，已解析为经纬度就不重复展示
    }
  }
  return { name, address, lat: lat ?? undefined, lng: lng ?? undefined };
}

/** 经纬度展示文本（保留 4 位小数，足够定位语义） */
function coordsText(lat?: number, lng?: number): string {
  return lat != null && lng != null ? `（经纬度 ${lat.toFixed(4)},${lng.toFixed(4)}）` : '';
}

/** 位置消息的时间展示（当天 HH:mm；跨天 M月d日 HH:mm） */
export function locTimeText(time: number): string {
  try {
    const d = new Date(time);
    if (Number.isNaN(d.getTime())) return '';
    const now = new Date();
    const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const sameDay =
      d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    return sameDay ? hm : `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
  } catch {
    return '';
  }
}

/** 位置消息进 AI 对话历史的可读文本；地点名解析失败 → 明确的「无法识别」占位（AI 不能编造） */
export function locationAiText(loc: unknown, time: number): string {
  const d = locDataOf(loc);
  if (!d.name) return '[位置]（无法识别该位置）';
  const at = locTimeText(time);
  return `[位置]「${d.name}」${d.address && d.address !== d.name ? `（${d.address}）` : ''}${coordsText(d.lat, d.lng)}${at ? `，发送于 ${at}` : ''}`;
}

/** 位置块扫描用的消息最小形状（各端消息的公共子集；loc 任意端形态均可） */
export interface ChatLocScanMsg {
  role: 'me' | 'peer';
  time: number;
  kind?: string;
  loc?: unknown;
  senderName?: string;
  recalled?: boolean;
}

export interface BuildLocationBlockOpts {
  /** 机主称呼（单聊传角色对用户的称呼/真名均可；缺省用「用户」） */
  userLabel?: string;
  /** fix3-5 AI 角色称呼（peer 行 who 的第一优先；缺省按 senderName/「对方」） */
  peerLabel?: string;
  /** fix3-5 群聊模式：who 恒用发送者名（me 行也用 userLabel 名），尾句按「位置属于发送者本人」口径 */
  groupMode?: boolean;
}

/**
 * 【位置消息】system 注入块：从消息末尾向前找最近一条位置消息（撤回剔除，最多回看 40 条）。
 * 命中 → 告知 AI 谁在何时发了哪个位置（名称/地址/经纬度），并明确"问我在哪直接说地点名"；
 * 地点名称由发送者身份决定能不能说（fix3-5：AI 自己发的位置≠机主的位置，群聊里只归发送者本人）；
 * 地点名无法识别 → 明确要求 AI 诚实说无法识别、禁止编造；没找到位置消息 → 返回空串不注入。
 */
export function buildLocationBlock(msgs: ChatLocScanMsg[], opts?: BuildLocationBlockOpts): string {
  try {
    const userLabel = (opts?.userLabel ?? '').trim();
    const peerLabel = (opts?.peerLabel ?? '').trim();
    const groupMode = opts?.groupMode === true;
    for (let i = msgs.length - 1, seen = 0; i >= 0 && seen < 40; i--, seen++) {
      const m = msgs[i];
      if (!m || m.recalled || m.kind !== 'location' || !m.loc) continue;
      const d = locDataOf(m.loc);
      const at = locTimeText(m.time);
      const senderName = (m.senderName ?? '').trim();
      // who（发送者身份表述）与尾句按 me/peer × 单聊/群聊分支（fix3-5 原先 peer 写死「对方」，主语不明）
      let who: string;
      let tail: string;
      if (groupMode) {
        // 群聊：位置只属于发送者本人——谁发的只有问「我在哪」的人就是 TA 时才能引用
        who = m.role === 'me' ? userLabel || '机主' : senderName || peerLabel || '对方';
        tail = `这是${who}发的位置，属于${who}本人——只有当问"我在哪"的人就是${who}时才能说出这个地点，绝不能把别人的位置安到机主或其他人头上`;
      } else if (m.role === 'me') {
        // 机主发的位置：这是机主自己的位置，问「我在哪」直接说（现文案保留，主语换成 userLabel）
        const asker = userLabel || '用户';
        who = userLabel ? `${userLabel}（用户本人）` : '用户';
        tail = `这就是${asker}告诉你的当前所在位置——${asker}问"你知道我在哪吗/我在哪"之类问题时，直接说出这个地点名，不要假装记不清；没有新的位置消息时不要编造${asker}的位置`;
      } else {
        // AI 角色发的位置：是 AI 自己的位置，绝不是机主的位置——机主问「我在哪」绝不能引用
        who = peerLabel || (senderName ? `「${senderName}」` : '对方');
        tail = `这是${who}（AI角色本人，就是你自己）发给TA的你自己所在的位置，不是机主的位置——机主问"你在哪/我在哪"时绝不能引用这条位置，也绝不能把这个地点说成机主的位置`;
      }
      if (!d.name) {
        const asker = groupMode ? who : m.role === 'me' ? userLabel || '用户' : '对方';
        return `【位置消息】${who}${at ? `在 ${at}` : ''}发来了一条位置消息，但地点名称无法识别（消息里没有有效的地点名）。如果${asker}问"你知道我在哪吗/我在哪"，诚实说无法识别该位置，绝不能编造或猜测地名。`;
      }
      const parts = [`地点「${d.name}」`];
      if (d.address && d.address !== d.name) parts.push(`地址 ${d.address}`);
      const ct = coordsText(d.lat, d.lng);
      if (ct) parts.push(ct.replace(/^（|）$/g, ''));
      return `【位置消息】${who}${at ? `在 ${at}` : ''}发来了位置消息：${parts.join('，')}。${tail}。`;
    }
    return '';
  } catch {
    return ''; // 位置注入任何意外都不阻断发送
  }
}

/** AI 富标记 [位置:名称:坐标或地址] → 位置数据（「lat,lng」解析为经纬度；其余文本留作地址展示） */
export function locFromRich(name: string, coords: string): ChatLocData {
  return locDataOf({ name, address: coords });
}
