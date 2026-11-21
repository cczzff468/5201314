import { openDB, type DBSchema, type IDBPDatabase, type IndexNames } from 'idb';
import type { ContactRecord } from '@/lib/contacts';

/**
 * 本地优先架构：所有用户数据(照片/录音/音乐/备忘/日程/聊天/联系人/设置)均存于浏览器 IndexedDB。
 * 关闭浏览器、重启设备后数据不丢失；服务端不再存任何用户数据。
 */

// ---------------- 记录类型 ----------------

export interface PhotoRecord {
  id: string;
  blob: Blob;
  name: string;
  createdAt: number;
}

export interface RecordingRecord {
  id: string;
  blob: Blob;
  name: string;
  /** 秒 */
  duration: number;
  createdAt: number;
}

export interface MusicRecord {
  id: string;
  blob: Blob;
  /** 原始文件名 */
  name: string;
  title: string;
  artist: string;
  album: string;
  /** 专辑封面图片 Blob（可为 null） */
  cover: Blob | null;
  /** 秒 */
  duration: number;
  createdAt: number;
  /**
   * 歌词文本（可选，LRC 格式带 [mm:ss.xx] 时间戳，或纯文本）。
   * 由用户在音乐 App 内手工编辑或导入时填入；旧记录无此字段 = 无歌词。
   * IndexedDB 新增可选字段无需升版本，向后兼容。
   */
  lyrics?: string;
}

/** 备忘录结构化清单项（金色重构版）：勾选圆列表，与正文 HTML 相互独立存储 */
export interface NoteChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

export interface NoteRecord {
  id: string;
  title: string;
  content: string;
  createdAt: number;
  updatedAt: number;
  /** 置顶（金色版备忘录新增可选字段，IndexedDB 无需升版本） */
  pinned?: boolean;
  /** 分类：''=无分类（旧版字段，保留兼容；新版按 folder 归档，旧数据的 category 仅存不展示） */
  category?: '' | 'personal' | 'work';
  /**
   * 所属文件夹 id（金色重构版）：'default'=内置「备忘录」默认夹，自定义文件夹为生成 id。
   * 缺省 = 归入「备忘录」默认夹（旧数据向后兼容）；「全部备忘录」为聚合视图不落该字段。
   */
  folder?: string;
  /** 锁定标记：列表隐藏摘要并显示锁图标，编辑器需先解锁查看（iOS 语义的轻量实现） */
  locked?: boolean;
  /** 最近删除：进入回收站的时间戳；有此字段 = 已删除，仅出现在「最近删除」，恢复时清除 */
  deletedAt?: number;
  /** 结构化清单（编辑器「今天的重点」勾选列表）；缺省/空数组 = 无清单 */
  checklist?: NoteChecklistItem[];
  /**
   * 关联日历日程 id（events 表记录 id，与日历代理对齐的同名字段）；
   * 与 linkDate 同存，日程被删后按 linkDate 兜底显示。
   */
  linkedEventId?: string;
  /** 关联日期 'YYYY-MM-DD'（与日历代理对齐的同名字段）；编辑器显示金色日期胶囊，点按跳日历 App */
  linkDate?: string;
}

export interface CalendarEventRecord {
  id: string;
  title: string;
  /** YYYY-MM-DD */
  date: string;
  /** HH:mm，空字符串表示全天 */
  startTime: string;
  /** HH:mm */
  endTime: string;
  note: string;
  createdAt: number;
  /**
   * 重复的星期，0=周日..6=周六（[]/undefined=不重复，与 AlarmRecord/ReminderRecord 同语义）。
   * 旧记录无此字段 = 不重复；IndexedDB 新增可选字段无需升版本。
   */
  repeat?: number[];
  /**
   * 地点（Task 16-b 珊瑚红重构可选字段；旧数据无此字段视为未填写）。
   */
  location?: string;
  /**
   * 日程颜色 key（可选）：purple/blue/yellow/orange/teal/green/red/lime/olive/brown/pink，
   * 缺省 = purple（紫色）。色值表见 calendar/shared.tsx。
   */
  color?: string;
  /** 结束日期 YYYY-MM-DD（可选，跨天日程；缺省 = 同 date 单日） */
  endDate?: string;
  /**
   * 重复规则（可选）：none/daily/weekly/monthly/yearly；
   * 旧数据无此字段时按 repeat 数组推导（7 天=每天、单 weekday=每周，其余按 weekday 展开兼容）。
   */
  repeatRule?: 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';
  /** 提醒（可选）：none/atStart/m5/m15/m30/h1/d1，缺省 = m15（提前 15 分钟） */
  alert?: 'none' | 'atStart' | 'm5' | 'm15' | 'm30' | 'h1' | 'd1';
}

export interface ChatSessionRecord {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** 是否置顶（可选字段，旧数据无此字段视为未置顶） */
  pinned?: boolean;
}

export interface ChatMessageRecord {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
}

export interface AlarmRecord {
  id: string;
  /** HH:mm 24小时制 */
  time: string;
  label: string;
  enabled: boolean;
  /** 重复的星期，0=周日；空数组表示仅一次 */
  repeat: number[];
  createdAt: number;
}

export interface WorldCityRecord {
  id: string;
  name: string;
  /** IANA 时区名，如 Asia/Shanghai */
  timezone: string;
}

export interface ReminderRecord {
  id: string;
  title: string;
  notes: string;
  completed: boolean;
  flagged: boolean;
  /** YYYY-MM-DD，空字符串表示无日期 */
  dueDate: string;
  /** HH:mm，空字符串表示无时间 */
  dueTime: string;
  createdAt: number;
  completedAt: number | null;
  /**
   * 重复的星期，0=周日..6=周六（[]/undefined=不重复，与 AlarmRecord 同语义）。
   * 用于「每天/工作日/周末/自定义 weekday 多选」重复提醒：到期判定时按 repeat
   * 字段计算下一次触发（若当日 weekday 不在 repeat 中则跳过当日提醒）。
   * 旧记录无此字段 = 不重复；IndexedDB 新增可选字段无需升版本，向后兼容。
   */
  repeat?: number[];
}

export interface CallLogRecord {
  id: string;
  /** 对端号码（未知号码展示用） */
  number: string;
  /** 对端联系人 id（联系人删除后日志仍保留，头像/名字用快照） */
  contactId: string | null;
  /** 对端名字快照（联系人在时实时取，不在时用快照） */
  displayName: string;
  /** 对端类型：'char' | 'npc' | 'user' | 'unknown' */
  peerKind: 'char' | 'npc' | 'user' | 'unknown';
  /** 对端头像快照（data URL，可空） */
  avatar: string | null;
  /** 'out' 去电 | 'in' 来电 | 'missed' 未接 */
  direction: 'out' | 'in' | 'missed';
  /** 通话秒数（未接通为 0） */
  duration: number;
  /**
   * 通话引擎上报的挂断原因（#27 三态展示用）：'cancel'=拨号中取消 / 'hangup'=接通后用户挂断 /
   * 'ai-hangup'=AI 主动挂断 / 'reject'=被拒接 / 'no-answer'·'missed-in'=响铃无人接；
   * 旧记录无此字段 → 渲染端按 callOutcomeOf('', duration>0) 兜底（接通=ended / 未接通=missed），
   * IndexedDB 新增可选字段直接存、无需迁移
   */
  endReason?: string;
  /** 通话媒体（Task 22 视频通话）：video=视频通话（记录行显示视频图标与「视频通话」文案）；缺省语音 */
  media?: 'voice' | 'video';
  /**
   * 多账号（Task 40 v2）：该通电话发生时电话 App 的当前账号 id（'main' = 大号）。
   * 旧记录无此字段视为大号；读取时按电话 App 当前账号过滤，实现通话记录随账号切换。
   */
  account?: string;
  createdAt: number;
}

/** 语音留言记录：呼叫未接通（拨号中挂断）时对端"转接语音信箱"自动生成，text 供 TTS 播报 */
export interface VoicemailRecord {
  id: string;
  /** 对端号码 */
  number: string;
  /** 对端联系人 id（联系人在时可实时取头像/名字） */
  contactId: string | null;
  /** 对端名字快照 */
  displayName: string;
  /** 对端类型：'char' | 'npc' | 'user' | 'unknown' */
  peerKind: 'char' | 'npc' | 'user' | 'unknown';
  /** 对端头像快照（data URL，可空） */
  avatar: string | null;
  /** 留言内容（TTS 播报文本）；kind='call' 时为整通电话的对话内容（我：…／对方：…），永久保存 */
  text: string;
  /** 记录来源：'voicemail'=对方未接听的语音留言（默认）；'call'=已接通电话的对话内容存档 */
  kind?: 'voicemail' | 'call';
  /** 预估时长（秒，按文本长度估算）；kind='call' 时为实际通话时长 */
  duration: number;
  /** 是否已读（播放过即已读） */
  read: boolean;
  /** 多账号（Task 40 v2）：该留言所属的电话 App 当前账号 id（缺省视为大号） */
  account?: string;
  createdAt: number;
}

export interface AppSettingRecord {
  key: string;
  value: unknown;
}

/** 通用 KV 记录（从 localStorage 迁移的中大容量模块用；key = 原 localStorage 键名） */
export interface KvRecord {
  key: string;
  value: unknown;
}

/** 通知自定义铃声（设置 › 通知 · 声音与铃声上传；IndexedDB 永久保存） */
export interface RingtoneRecord {
  id: string;
  /** 展示名（去扩展名，≤40 字） */
  name: string;
  mime: string;
  /** 音频本体（任意浏览器可播格式） */
  blob: Blob;
  /** 秒（元数据解析失败为 0） */
  duration: number;
  createdAt: number;
}

/** 联系人记录：CHAR（AI 角色）/ USER（我自己）/ NPC（配角），四 App 共享（存本地 IndexedDB） */
export type { ContactRecord };

/** 相册条目：按联系人（AI 角色）隔离的图片库，可被 AI 视觉决策引用作头像/朋友圈背景/聊天图等 */
export interface AlbumRecord {
  id: string;            // 条目 ID（genId()）
  contactId: string;     // 拥有者联系人 ID（按角色隔离）
  src: string;           // 图片本体 data URL
  desc?: string;         // 识图描述（可选）
  name?: string;         // 备注/文件名（可选）
  origin: 'user' | 'ai';  // 来源：用户手动 / AI 存入
  createdAt: number;
}

/** 视觉决策日志：AI 调用视觉理解后选择的目标操作（换头像/换朋友圈背景/存入相册/挑相册作头像/背景/发送） */
export interface VisionDecisionRecord {
  id: string;
  contactId: string;
  app: 'wx' | 'qq' | 'sms';
  action: 'change-avatar' | 'change-moments-bg' | 'save-to-album' | 'pick-album-avatar' | 'pick-album-bg' | 'pick-album-send' | 'imggen' | 'gen-avatar';
  targetId: string;     // album 条目 id 或图片消息 id
  imgSrc?: string;      // 涉及图片 src（小图存档）
  reason?: string;      // AI 理由（可选）
  createdAt: number;
}

// ---------------- Schema ----------------

interface IOSDB extends DBSchema {
  photos: { key: string; value: PhotoRecord; indexes: { createdAt: number } };
  recordings: { key: string; value: RecordingRecord; indexes: { createdAt: number } };
  music: { key: string; value: MusicRecord; indexes: { createdAt: number } };
  notes: { key: string; value: NoteRecord; indexes: { updatedAt: number } };
  events: { key: string; value: CalendarEventRecord; indexes: { date: string } };
  'chat-sessions': { key: string; value: ChatSessionRecord; indexes: { updatedAt: number } };
  'chat-messages': { key: string; value: ChatMessageRecord; indexes: { sessionId: string } };
  alarms: { key: string; value: AlarmRecord };
  cities: { key: string; value: WorldCityRecord };
  reminders: { key: string; value: ReminderRecord };
  'call-logs': { key: string; value: CallLogRecord; indexes: { createdAt: number } };
  voicemails: { key: string; value: VoicemailRecord; indexes: { createdAt: number } };
  contacts: { key: string; value: ContactRecord };
  albums: { key: string; value: AlbumRecord; indexes: { contactId: string; createdAt: number } };
  visionDecisions: { key: string; value: VisionDecisionRecord; indexes: { contactId: string; createdAt: number } };
  settings: { key: string; value: AppSettingRecord };
  kv: { key: string; value: KvRecord };
  ringtones: { key: string; value: RingtoneRecord; indexes: { createdAt: number } };
}

export type IOSStoreName =
  | 'photos'
  | 'recordings'
  | 'music'
  | 'notes'
  | 'events'
  | 'chat-sessions'
  | 'chat-messages'
  | 'alarms'
  | 'cities'
  | 'reminders'
  | 'call-logs'
  | 'voicemails'
  | 'contacts'
  | 'albums'
  | 'visionDecisions'
  | 'settings'
  | 'kv'
  | 'ringtones';

const DB_VERSION = 8;

/**
 * 库名恒定（Task 40 v2）：单库 + 键作用域的多账号模型——所有账号共用 ios-phone-db，
 * 微信/QQ/信息/电话的数据在 kv 层与记录字段按账号隔离（accounts.ts / idb-kv.ts）。
 */
export const DB_NAME = 'ios-phone-db';

let dbPromise: Promise<IDBPDatabase<IOSDB>> | null = null;

function getDB(): Promise<IDBPDatabase<IOSDB>> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) {
    return Promise.reject(new Error('IndexedDB 仅在浏览器环境可用'));
  }
  if (!dbPromise) {
    dbPromise = openDB<IOSDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
        const photos = db.createObjectStore('photos', { keyPath: 'id' });
        photos.createIndex('createdAt', 'createdAt');
        const recordings = db.createObjectStore('recordings', { keyPath: 'id' });
        recordings.createIndex('createdAt', 'createdAt');
        const music = db.createObjectStore('music', { keyPath: 'id' });
        music.createIndex('createdAt', 'createdAt');
        const notes = db.createObjectStore('notes', { keyPath: 'id' });
        notes.createIndex('updatedAt', 'updatedAt');
        const events = db.createObjectStore('events', { keyPath: 'id' });
        events.createIndex('date', 'date');
        const sessions = db.createObjectStore('chat-sessions', { keyPath: 'id' });
        sessions.createIndex('updatedAt', 'updatedAt');
        const messages = db.createObjectStore('chat-messages', { keyPath: 'id' });
        messages.createIndex('sessionId', 'sessionId');
        db.createObjectStore('alarms', { keyPath: 'id' });
        db.createObjectStore('cities', { keyPath: 'id' });
        db.createObjectStore('settings', { keyPath: 'key' });
        }
        if (oldVersion < 2 && !db.objectStoreNames.contains('reminders')) {
          db.createObjectStore('reminders', { keyPath: 'id' });
        }
        if (oldVersion < 3 && !db.objectStoreNames.contains('call-logs')) {
          const callLogs = db.createObjectStore('call-logs', { keyPath: 'id' });
          callLogs.createIndex('createdAt', 'createdAt');
        }
        if (oldVersion < 4 && !db.objectStoreNames.contains('voicemails')) {
          const voicemails = db.createObjectStore('voicemails', { keyPath: 'id' });
          voicemails.createIndex('createdAt', 'createdAt');
        }
        if (oldVersion < 5 && !db.objectStoreNames.contains('contacts')) {
          // 联系人本地化（原服务端 SQLite → IndexedDB）：首次升版后由 migrateFromServer() 灌入旧数据
          db.createObjectStore('contacts', { keyPath: 'id' });
        }
        if (oldVersion < 6 && !db.objectStoreNames.contains('kv')) {
          // localStorage → IndexedDB 迁移目标（聊天消息/记忆/表情包/钱包等中大容量模块）
          db.createObjectStore('kv', { keyPath: 'key' });
        }
        if (oldVersion < 7) {
          // AI 视觉相册（按联系人隔离）+ 视觉决策日志：头像/朋友圈背景/聊天图等场景的图片本体与决策历史
          if (!db.objectStoreNames.contains('albums')) {
            const albums = db.createObjectStore('albums', { keyPath: 'id' });
            albums.createIndex('contactId', 'contactId');
            albums.createIndex('createdAt', 'createdAt');
          }
          if (!db.objectStoreNames.contains('visionDecisions')) {
            const vds = db.createObjectStore('visionDecisions', { keyPath: 'id' });
            vds.createIndex('contactId', 'contactId');
            vds.createIndex('createdAt', 'createdAt');
          }
        }
        if (oldVersion < 8 && !db.objectStoreNames.contains('ringtones')) {
          // 通知自定义铃声（设置 › 通知上传；永久保存，删除即移除记录）
          const ringtones = db.createObjectStore('ringtones', { keyPath: 'id' });
          ringtones.createIndex('createdAt', 'createdAt');
        }
      },
    });
  }
  return dbPromise;
}

// ---------------- 通用 CRUD ----------------

export const localDB = {
  async getAll<K extends IOSStoreName>(store: K): Promise<IOSDB[K]['value'][]> {
    const db = await getDB();
    return db.getAll(store);
  },

  async get<K extends IOSStoreName>(store: K, key: string): Promise<IOSDB[K]['value'] | undefined> {
    const db = await getDB();
    return db.get(store, key);
  },

  async put<K extends IOSStoreName>(store: K, value: IOSDB[K]['value']): Promise<void> {
    const db = await getDB();
    await db.put(store, value);
  },

  async delete<K extends IOSStoreName>(store: K, key: string): Promise<void> {
    const db = await getDB();
    await db.delete(store, key);
  },

  async clear<K extends IOSStoreName>(store: K): Promise<void> {
    const db = await getDB();
    await db.clear(store);
  },

  async count<K extends IOSStoreName>(store: K): Promise<number> {
    const db = await getDB();
    return db.count(store);
  },

  /**
   * 按 index 取全部条目（idb getAllFromIndex 封装）：用于按 contactId 查某联系人的所有相册/视觉决策。
   * 返回值按索引顺序（非按 createdAt 排序），调用方需自行排序。
   * query 类型 idb 限定为该 index 对应的 value 类型（string/number 等），这里放宽到 IDBValidKey
   *（string/number/Date 等），运行时由 IndexedDB 原生 API 校验，调用方需保证 query 类型与 index 匹配。
   */
  async getAllFromIndex<K extends IOSStoreName>(
    store: K,
    index: IndexNames<IOSDB, K>,
    query: IDBValidKey,
  ): Promise<IOSDB[K]['value'][]> {
    const db = await getDB();
    return db.getAllFromIndex(store, index, query as unknown as IDBKeyRange);
  },
};

// ---------------- 工具 ----------------

export function genId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}

/** 秒 → "3:25" */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}
