'use client';

/**
 * 聊天端音乐遥控（第三十八轮扩展）：微信/QQ 私聊 × 音乐播放器的播放联动。
 *
 * 第三十七轮只覆盖「一起听进行中」的会话；第三十八轮起扩展到全部私聊（用户需求：
 * 「不跟 ai 一起听，ai 可以给我播放音乐」）——两种情境，同一套注入/剥离/执行管线：
 *
 * 1. togetherLiveBlock(cid, userLabel)：发消息时现场构建的实时音乐情境块（非缓存）：
 *    - 一起听进行中（该角色）→「一起听」块：正在一起听的歌/歌手/进度/歌词 + 播控指令；
 *    - 其余私聊 →「音乐点播」块：播放器此刻在放什么（歌名/歌手/进度/歌词窗口，没放就说没放）
 *      + 主动放歌引导（用户点名就放；用户没点名时按对他的了解自己挑）+ 播控指令说明。
 *    注入聊天 system（wechat.tsx / qq.tsx 的 systemFull，位置在跨 App 块之后）。
 * 2. takeMusicRemote(raw)：从 AI 回复里抽出播放控制指令并从正文剔除
 *    （语法与音乐 App 一起听完全一致：[切歌]/[上一首]/[暂停]/[继续]/[放歌:歌名:歌手]/[快进:秒]/[快退:秒]）。
 *    闸门变化（第三十八轮）：不再要求一起听会话——所有私聊的 system 都注入了音乐块（AI 才被授予
 *    指令能力），回复里出现指令即剥离执行；群聊管线不经过本模块，天然不受影响。
 * 3. cutUnfinishedMusicTag(text)：流式分段防撕裂——尾部未闭合的半截指令括号留住（下次拼回），
 *    防止「[快进:」被分段器切开、一半进了气泡一半丢了指令。
 * 4. runMusicRemote(controls)：把指令真实作用到播放器（useMusic store，用户随时可手动覆盖）。
 * 5. playControlCommonLines(opts)（【100-d】播控教学收敛单一来源）：三处调用点
 *    （本模块的一起听/日常点播两情境 + music-ai 的音乐 App 一起听聊天）共用的指令教学行，
 *    语法行以更完整的一份为准统一；[红心] 只有音乐 App 一起听链路解析（music-ai.extractTgControls），
 *    本模块不解析也不教（redHeart 仅 music-ai 传 true）——只教真实可执行的，消除能力漂移。
 *
 * 安全边界：
 * - 指令最多执行 3 条/条回复；搜不到歌静默失败（不弹兑底消息，音乐 App 侧才有回复链路）——
 *   AI 用的是意图式说法（"我切一下歌"），没放成也不显得说谎；
 * - 提示词层约束误触发：正常聊天没提听歌就不要动播放器、用户问"怎么切歌"这类操作问题用文字
 *   解释不要真输出指令（正文里聊到方括号的场景概率极低，且指令词表只有 7 个，误吞后果轻）；
 * - 本模块不写消息、不写记忆，只动播放器。
 */

import { kvGet } from './idb-kv';
import { musicUid, songArtistText } from './music-api';
import { useMusic } from './music-store';
import { searchSongMatched } from './music-ai';

// ---------------- 类型 ----------------

export interface MusicRemoteControl {
  type: 'next' | 'prev' | 'pause' | 'resume' | 'play' | 'seek';
  /** type='play' 时：歌名（必填）/歌手（可选） */
  name?: string;
  artist?: string;
  /** type='seek' 时：快进/快退秒数（正=快进，负=快退，绝对值最多 600） */
  delta?: number;
}

/** 进行中的一起听会话快照（music-ai.ts 落盘的形状，鸭子读取防耦合） */
interface TgActiveSnapshot {
  contactId?: unknown;
  name?: unknown;
}

/** 是否有进行中的一起听会话（读 kv 而非 store：页面刷新后没开过音乐 App 时 store 可能还没恢复，
 *  kv 经 ensureKvReady 注水后同步可读，判定可靠；有则返回会话快照） */
function activeTogether(): TgActiveSnapshot | null {
  try {
    const t = kvGet<TgActiveSnapshot>(`music-together-active:${musicUid()}`);
    return t && typeof t === 'object' ? t : null;
  } catch {
    return null;
  }
}

// ---------------- 指令抽取 ----------------

/** 从 AI 原文里抽出播放控制指令并从正文剔除（与 music-ai.extractTgControls 同一套语法）。
 *  第三十八轮起全部私聊生效：微信/QQ 的私聊 system 已注入音乐情境块（AI 被授予指令能力），
 *  回复里出现指令即剥离执行；群聊管线（wx-group/qq-group）不经过本模块，正文里的方括号不受影响。 */
export function takeMusicRemote(raw: string): { text: string; controls: MusicRemoteControl[] } {
  const src = raw ?? '';
  const controls: MusicRemoteControl[] = [];
  let text = src;
  text = text.replace(/\[(?:放歌|播放|来一首|来首)[:：]([^:：\][]*)(?:[:：]([^:：\][]*))?\]/g, (_m, name, artist) => {
    const n = String(name ?? '').trim();
    if (n) controls.push({ type: 'play', name: n, artist: String(artist ?? '').trim() });
    return '';
  });
  text = text.replace(/\[(切歌|下一首|上一首|暂停|继续|停下|关音乐)\]/g, (_m, k) => {
    const key = String(k);
    if (key === '切歌' || key === '下一首') controls.push({ type: 'next' });
    else if (key === '上一首') controls.push({ type: 'prev' });
    else if (key === '暂停' || key === '停下' || key === '关音乐') controls.push({ type: 'pause' });
    else controls.push({ type: 'resume' });
    return '';
  });
  text = text.replace(/\[(快进|快退)[:：]\s*(\d{1,3})\s*(?:秒|s)?\]/g, (_m, kind, sec) => {
    const n = parseInt(String(sec), 10);
    if (Number.isFinite(n) && n > 0) {
      controls.push({ type: 'seek', delta: (String(kind) === '快退' ? -1 : 1) * Math.min(n, 600) });
    }
    return '';
  });
  // 放歌意图兜底（第三十八轮）：实测模型常「说放不给指令」（正文「放首《晴天》给你」但漏掉 [放歌:…] 标记，
  // few-shot 也压不住）——正文带明确放歌意图（放/播/来 + 书名号歌名紧邻）时，客户端直接解析歌名/歌手
  // 真实放歌；气泡文字原样保留（AI 的话本身自然，播放由系统完成），每条回复至多兜底 1 条
  if (controls.length === 0) {
    const intent = /(?:放|播|来)\s*(?:一首|一首歌|首|个)?[《「『]([^\n《》「」『』]{1,30})[》」』]/.exec(text);
    if (intent) {
      const name = intent[1].trim();
      // 歌手从「X的歌」提取（如「周杰伦的歌」）；「原唱」标注不算歌手意图
      const artistM = /([\u4e00-\u9fa5A-Za-z0-9·]{2,14})的歌/.exec(text);
      const artist = artistM && !artistM[1].includes('原唱') ? artistM[1].trim() : '';
      if (name) controls.push({ type: 'play', name, artist });
    }
  }
  return { text: text.replace(/[ \t]+$/gm, '').trim(), controls };
}

/** 流式分段防撕裂：文本尾部未闭合的半截指令括号（如「…[快进:」）留住并从本段剔除，
 *  下一段到达后拼回开头再处理（wechat.tsx / qq.tsx 的 deliverSegment 与照片标签 carry 同款机制）。
 *  括号内容超过 24 字视为普通正文里的方括号（不是指令），不吞。 */
export function cutUnfinishedMusicTag(text: string): { text: string; held: string } {
  const src = text ?? '';
  const m = src.match(/\[[^\][]*$/);
  if (!m || m.index === undefined) return { text: src, held: '' };
  if (m[0].length > 24) return { text: src, held: '' };
  return { text: src.slice(0, m.index), held: m[0] };
}

// ---------------- 指令执行 ----------------

/** 把指令真实作用到播放器（直接调 useMusic action；用户随时可手动覆盖，store 层以最后操作为准）。
 *  单条回复最多执行 3 条；搜不到歌静默（不弹兑底消息，与音乐 App 侧不同——那边有消息链路）。 */
export async function runMusicRemote(controls: MusicRemoteControl[]): Promise<void> {
  if (!controls.length) return;
  for (const c of controls.slice(0, 3)) {
    try {
      const st = useMusic.getState();
      if (c.type === 'next') await st.next(false);
      else if (c.type === 'prev') await st.prev();
      else if (c.type === 'pause') {
        if (st.playing) st.toggle();
      } else if (c.type === 'resume') {
        if (!st.playing && st.current) st.toggle();
      } else if (c.type === 'seek') {
        if (st.current && st.duration > 0 && c.delta) {
          st.seek(Math.min(st.duration - 1, Math.max(0, st.position + c.delta)));
        }
      } else if (c.type === 'play' && c.name) {
        const hit = await searchSongMatched(c.name, c.artist ?? '');
        if (hit) await st.playSong(hit, [hit]);
      }
    } catch {
      // 单条指令失败不影响其余
    }
  }
}

// ---------------- 实时音乐情境块（发消息时现场构建） ----------------

function fmtClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}分${String(s % 60).padStart(2, '0')}秒`;
}

/** 正在唱到的歌词窗口（前 2 句 + 当前 + 后 1 句），歌词没加载出来时返回空串 */
function lyricWindowBlock(): string {
  const st = useMusic.getState();
  if (!st.current || st.lyricFor !== st.current.id || st.lyricLines.length === 0) return '';
  const lines = st.lyricLines;
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].t <= st.position + 0.2) idx = i;
    else break;
  }
  if (idx < 0) return '';
  const at = (i: number): string => {
    const l = lines[i];
    if (!l) return '';
    return l.tr ? `${l.text}（${l.tr}）` : l.text;
  };
  const parts: string[] = [];
  const from = Math.max(0, idx - 2);
  const to = Math.min(lines.length - 1, idx + 1);
  for (let i = from; i <= to; i++) {
    const tag = i === idx ? '▶ 正在唱' : i < idx ? `前 ${idx - i} 句` : `后 ${i - idx} 句`;
    parts.push(`${tag}：${at(i)}`);
  }
  return `正在唱到的歌词：\n${parts.join('\n')}`;
}

/** 播放器此刻的播放状态描述（有歌：歌名/歌手/进度/播放状态；没歌：提示未放歌） */
function nowPlayingLines(lines: string[]): void {
  // 冷启动兜底（幂等）：页面刷新后没开过音乐 App 时，从播放器快照恢复队列/当前歌/歌词（同步完成）
  void useMusic.getState().boot();
  const st = useMusic.getState();
  if (st.current) {
    lines.push(`正在放的歌：《${st.current.name}》${songArtistText(st.current)}`);
    if (st.duration > 0) {
      lines.push(
        `播放进度：${fmtClock(st.position)} / ${fmtClock(st.duration)}（${st.playing ? '正在播放' : '已暂停'}）`,
      );
    }
    if (st.freeTrial) lines.push('（这是 VIP 歌曲，当前只播放试听片段）');
  } else {
    lines.push('播放器现在没放歌。');
  }
}

// ---------------- 播控教学 · 共享生成器（【100-d】单一来源） ----------------

/**
 * 播控指令教学的共用行（三处调用点共享，杜绝文案各自漂移）：
 * - music-remote.togetherLiveBlock 的一起听情境 / 日常点播情境；
 * - music-ai.playingBlock（音乐 App 一起听聊天）。
 * 语法行以更完整的一份（音乐 App 侧）为准统一；标记拼写必须与 takeMusicRemote（微信/QQ 私聊）
 * 和 music-ai.extractTgControls（音乐 App 一起听）的解析正则一一对应——改任何一边都要三处同步核对
 * （聊天功能红线：标记拼写零变化）。
 * redHeart：[红心] 只有音乐 App 一起听链路解析并执行（music-ai），微信/QQ 私聊管线（takeMusicRemote）
 * 不解析——只教真实可执行的，本模块侧不传 redHeart。
 * who：机主称呼（「XX 随时会手动操作播放器」句用到；空串回退「机主」）。
 */
export function playControlCommonLines(opts: { who: string; redHeart?: boolean }): string[] {
  const who = (opts.who ?? '').trim().slice(0, 20) || '机主';
  return [
    '- 指令写在回复末尾，系统会真实执行并从气泡里剔除，不要在正文里描述指令本身，不要加引号/代码块；',
    '- 无论执行什么指令，正文都必须至少带一句自然的话——绝对不要只发指令不带文字；',
    '- 想切下一首：[切歌]；想回上一首：[上一首]；想暂停：[暂停]；想继续放：[继续]；',
    '- 想放一首具体的歌（选歌/换到你们聊到的歌）：[放歌:歌名:歌手]（写真实存在的歌，如 [放歌:晴天:周杰伦]）；',
    ...(opts.redHeart ? ['- 觉得这首歌好听、想帮对方收藏：[红心]（把当前歌加进对方红心，同一首歌别重复发）；'] : []),
    '- 想跳过前奏/直接听副歌：[快进:秒数]（如 [快进:30]）；想倒回去重听：[快退:秒数]（如 [快退:45]）；最多 600 秒；',
    `- 选什么歌、什么时候切，按你的人设、你们的聊天内容和这首歌的氛围来；${who}随时会手动操作播放器，别抢节奏，不要每条消息都带指令。`,
  ];
}

/**
 * 音乐实时情境块：发给某角色消息时，返回注入聊天 system 的实时数据块（发消息瞬间构建，非缓存）：
 * - 与该角色的一起听进行中 →「一起听」块（歌名/歌手/进度/歌词 + 播控指令，陪伴式说法）；
 * - 其余私聊 →「音乐点播」块（播放器此刻状态 + 主动放歌引导 + 播控指令）——
 *   用户需求：不一起听时也能让 AI 放歌（点名放 / 按喜好推荐放），并且 AI 知道正在放什么、
 *   放到哪里了、唱到哪句歌词，能切歌/前进/后退/暂停。
 * 与 cross-app-context 的「听歌动态」不同：那个走跨 App 缓存（可能滞后一轮），本块是实时进度。
 */
export function togetherLiveBlock(contactId: string, userLabel: string): string {
  try {
    const who = (userLabel ?? '').trim().slice(0, 20) || '机主';
    const t = activeTogether();
    const lines: string[] = [];
    if (t && typeof t.contactId === 'string' && t.contactId === contactId) {
      // —— 一起听情境（第三十七轮原样保留）——
      lines.push(`【一起听 · 实时音乐情境（你正和${who}在音乐 App 里一起听歌，以下是此刻的实时数据）】`);
      nowPlayingLines(lines);
      const lw = lyricWindowBlock();
      if (lw) lines.push(lw);
      lines.push(
        '',
        `【一起听播放控制（真实生效）】你陪着${who}听歌，可以控制播放：`,
        ...playControlCommonLines({ who }),
        `- 完整示例：${who}说"放首稻香"，你回复：好呀，放首《稻香》～[放歌:稻香:周杰伦]；`,
      );
    } else {
      // —— 日常点播情境（第三十八轮新增）：不在一起听也能放歌/播控 ——
      lines.push(`【音乐播放器 · 实时情境（你有一个真实可控的音乐播放器，可以给${who}放歌）】`);
      nowPlayingLines(lines);
      const lw = lyricWindowBlock();
      if (lw) lines.push(lw);
      lines.push(
        '',
        `【播放控制（真实生效）】你可以在聊天里直接操控这个播放器：`,
        ...playControlCommonLines({ who }),
        `- 完整示例一：${who}说"来一首周杰伦的歌"，你回复：来啦，来首周杰伦的《晴天》～[放歌:晴天:周杰伦]；`,
        `- 完整示例二：${who}说"放首歌"（没点名），你按对他的了解挑一首：给你放首你上次说喜欢的《xxx》～[放歌:xxx:歌手]；`,
        `- 时机自然：不要每条消息都动播放器——正常聊天没提到听歌就不要放歌；${who}问"怎么切歌"这类操作问题时用文字解释，不要真的输出指令；`,
        '- 正文用意图式说法（"我放一首""切了哦"），不要用完成时说"已经切好了"——万一没放成也不显得说谎。',
      );
    }
    return lines.join('\n');
  } catch {
    return ''; // 任何意外都不阻断消息发送
  }
}
