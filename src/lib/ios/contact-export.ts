'use client';

/**
 * 联系人资料导出 / 导入（JSON 包，含头像 Base64）：
 *
 * 设计目标：
 * - 头像 avatar 已是 dataURL（Base64）格式，直接保留即可，换手机不失效；
 * - 导出形态 = 单 JSON 文件，含：联系人本体 + 关联数据（记忆 / 聊天记录 / 事件），按用户选的「范围」裁剪；
 * - 导入语义 = 新 id 创建（避免覆盖现有联系人）；关联数据按 kv 前缀批量写回。
 *
 * 数据范围：
 * - 「仅导出人设」：contact 本体（人设字段 + 头像 + 基础资料），不含记忆/聊天记录；
 * - 「导出全部资料」：contact 本体 + 全部关联数据（mem-* 记忆 + wx/qq/sms 聊天记录 + ai-events）。
 *
 * 关联数据 kv 前缀（含各账号后缀键，导出/导入时按前缀批量扫描）：
 * - 聊天记录：wx-chat-msgs: / qq-chat-msgs: / ios-chat-msgs:sms: / sms-chat-msgs: / wx-ai-events: / qq-ai-events:
 * - 记忆：mem-frag: / mem-ltm: / mem-long: / mem-habit: / mem-profile: / mem-settings: / mem-round: / mem-msgcount: / mem-anchor:
 *
 * 文件结构：
 * {
 *   app: 'ai-phone-contact',
 *   schema: 1,
 *   exportedAt: ISOString,
 *   mode: 'persona' | 'full',
 *   contact: ContactRecord,            // 联系人本体（avatar 字段即 Base64 dataURL）
 *   avatarBase64: string | null,       // 同 contact.avatar，冗余字段便于直接读取（换手机不失效）
 *   kv: Record<string, unknown>       // 关联数据键值对（仅 full 模式；persona 模式为空对象）
 * }
 *
 * 导入：解析 JSON → 校验 → 新建 contact（新 id）→ 把 kv 里带新 id 的键批量写回 → 派发刷新事件。
 */

import { kvGetRaw, kvKeysByPrefix, kvSetRaw } from './idb-kv';
import { createContact, listContacts, updateContact } from './contacts-store';
import { normalizeAvatar } from '../contacts';
import type { ContactRecord } from '../contacts';

export const CONTACT_EXPORT_APP = 'ai-phone-contact';
export const CONTACT_EXPORT_SCHEMA = 1;

/** 关联数据 kv 前缀清单（含各 App 聊天记录与记忆系统全部键前缀） */
const LINKED_KV_PREFIXES: string[] = [
  // 聊天记录
  'wx-chat-msgs:',
  'qq-chat-msgs:',
  'ios-chat-msgs:sms:',
  'sms-chat-msgs:',
  'ios-chat-msgs:c:',
  // AI 事件流
  'wx-ai-events:',
  'qq-ai-events:',
  // 记忆系统
  'mem-frag:',
  'mem-ltm:',
  'mem-long:',
  'mem-habit:',
  'mem-profile:',
  'mem-settings:',
  'mem-round:',
  'mem-msgcount:',
  'mem-anchor:',
];

export type ContactExportMode = 'persona' | 'full';

export interface ContactExportPayload {
  app: typeof CONTACT_EXPORT_APP;
  schema: number;
  exportedAt: string;
  mode: ContactExportMode;
  /** 联系人本体（avatar 字段即 Base64 dataURL，原样保留） */
  contact: ContactRecord;
  /** 头像 Base64 冗余字段：= contact.avatar；老设备/老版本可只读此字段恢复头像 */
  avatarBase64: string | null;
  /** 关联数据（仅 full 模式填充；persona 模式为空对象） */
  kv: Record<string, unknown>;
  /** 原 id（导入时用于映射 kv 键） */
  sourceId: string;
}

/** 把旧 contactId 替换为新 id（kv 键重写） */
function remapKey(oldKey: string, oldId: string, newId: string): string {
  return oldKey.replace(oldId, newId);
}

/** 收集某 contactId 的全部关联 kv 数据（跨账号后缀键一并扫描） */
function collectLinkedKv(contactId: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const prefix of LINKED_KV_PREFIXES) {
    // 每个前缀扫描可能命中本 contactId 的键（如 `wx-chat-msgs:${contactId}`、`wx-chat-msgs:${contactId}--alt1`）
    const keys = kvKeysByPrefix(prefix);
    for (const k of keys) {
      // 只收与本 contactId 直接相关的键（前缀后第一段必须等于 contactId 或带 contactId 后缀）
      const tail = k.slice(prefix.length);
      const seg = tail.split('--')[0];
      if (seg === contactId) {
        const v = kvGetRaw<unknown>(k);
        if (v !== null) out[k] = v;
      }
    }
  }
  return out;
}

/** 构造导出 payload（不触发下载，纯数据） */
export function buildContactExportPayload(
  contact: ContactRecord,
  mode: ContactExportMode,
): ContactExportPayload {
  const kv = mode === 'full' ? collectLinkedKv(contact.id) : {};
  return {
    app: CONTACT_EXPORT_APP,
    schema: CONTACT_EXPORT_SCHEMA,
    exportedAt: new Date().toISOString(),
    mode,
    contact,
    avatarBase64: contact.avatar ?? null,
    kv,
    sourceId: contact.id,
  };
}

/** 安全文件名：去掉特殊字符 */
function safeFileName(name: string): string {
  const trimmed = (name ?? '').trim();
  const cleaned = trimmed.replace(/[\\/:*?"<>|\n\r\t]+/g, '_');
  return cleaned || '未命名';
}

/** 当前日期 YYYYMMDD */
function dateStamp(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

/** 触发浏览器下载 .json 文件 */
export function downloadContactJSON(contact: ContactRecord, mode: ContactExportMode): void {
  const payload = buildContactExportPayload(contact, mode);
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const tag = mode === 'persona' ? '人设' : '全部资料';
  a.download = `Contact_${safeFileName(contact.name)}_${dateStamp()}_${tag}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** 解析上传的 JSON 文件 → ContactExportPayload（校验失败抛错） */
export async function parseContactExportFile(file: File): Promise<ContactExportPayload> {
  const text = await file.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('文件不是有效的 JSON');
  }
  if (!data || typeof data !== 'object') throw new Error('文件内容为空');
  const obj = data as Partial<ContactExportPayload>;
  if (obj.app !== CONTACT_EXPORT_APP) {
    throw new Error('文件不是联系人资料导出包（缺少 app 标识）');
  }
  if (!obj.contact || typeof obj.contact !== 'object') throw new Error('缺少 contact 字段');
  if (typeof obj.contact.name !== 'string' || !obj.contact.name.trim()) {
    throw new Error('联系人名字为空');
  }
  // 头像优先用 avatarBase64（冗余字段），其次用 contact.avatar
  const avatar = obj.avatarBase64 ?? obj.contact.avatar ?? null;
  const checked = normalizeAvatar(avatar);
  obj.contact.avatar = checked;
  return obj as ContactExportPayload;
}

/**
 * 导入联系人：新建一条 contact（createContact 自动生成新 id），并把关联 kv 数据按新 id 写回。
 * 返回新创建的 contact。
 */
export async function importContactFromPayload(payload: ContactExportPayload): Promise<ContactRecord> {
  const src = payload.contact;
  const oldId = payload.sourceId || src.id;

  // 头像优先 avatarBase64，其次 contact.avatar；再过一遍 normalizeAvatar 兜底
  const avatarRaw = payload.avatarBase64 ?? src.avatar ?? null;
  const avatar = normalizeAvatar(avatarRaw);

  // 创建新 contact（createContact 内部生成新 id，导入即好友）
  const created = await createContact({
    kind: src.kind === 'user' ? 'char' : src.kind, // USER 是机主自己，不允许导入为 USER
    ownerId: null, // NPC 归属在导入时无法自动匹配，留空（用户可在详情页重新绑定）
    name: src.name,
    nickname: src.nickname ?? null,
    gender: src.gender ?? null,
    age: src.age ?? null,
    height: src.height ?? null,
    weight: src.weight ?? null,
    occupation: src.occupation ?? null,
    company: src.company ?? null,
    region: src.region ?? null,
    birthday: src.birthday ?? null,
    relation: src.relation ?? null,
    relationToUser: src.relationToUser ?? null,
    phone: src.phone ?? null,
    wechatId: src.wechatId ?? null,
    wechatPassword: src.wechatPassword ?? null,
    qqId: src.qqId ?? null,
    qqPassword: src.qqPassword ?? null,
    persona: src.persona ?? null,
    background: src.background ?? null,
    expressStyle: src.expressStyle ?? null,
    customRules: src.customRules ?? null,
    avatar,
    isFriend: true, // 导入即好友
  }).catch((err) => {
    throw new Error(`创建联系人失败：${err instanceof Error ? err.message : String(err)}`);
  });

  // CHAR/NPC 默认 isFriend=false，补一次更新让它直接进主列表与信息 App
  if (created.kind !== 'user' && !created.isFriend) {
    const updated = await updateContact(created.id, { isFriend: true }).catch(() => null);
    if (updated) {
      // updateContact 返回更新后的 contact；继续用它的 id 做 kv 重映射
      Object.assign(created, updated);
    }
  }

  // 把 kv 数据按新 id 重写（如果 payload.mode === 'full' 才有关联数据）
  if (payload.kv && typeof payload.kv === 'object') {
    for (const [oldKey, value] of Object.entries(payload.kv)) {
      const newKey = remapKey(oldKey, oldId, created.id);
      kvSetRaw(newKey, value);
    }
  }

  return created;
}

/** 检查同名联系人是否已存在（导入前提示用） */
export async function hasContactWithName(name: string): Promise<boolean> {
  const all = await listContacts();
  return all.some((c) => c.name === name);
}

/** 用法：在 UI 里先 parseContactExportFile → importContactFromPayload → 刷新列表 */
