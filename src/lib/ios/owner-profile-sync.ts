/**
 * 机主名字双向同步（联系人 ↔ 设置›个人信息）：
 *
 * 背景：联系人 App 里的机主 USER 联系人（kind='user' 且非小号档案）是微信/QQ「我」、
 * 通话界面、AI 人设/记忆称谓的消费源；设置 › 个人信息（useSettings.profile）是锁屏
 * 「XXX的iPhone」/ App Store 等的消费源。名字在一边改了另一边停留旧值——名字继续双向镜像。
 *
 * 头像已改为「三入口各自隔离」（用户要求）：
 * - 微信个人资料页 → contacts.avatars.wx 槽位（avatarFor(owner,'wx') 槽位优先、回退全局）；
 * - QQ 个人资料页 → contacts.avatars.qq 槽位；
 * - 设置个人信息页 → useSettings.profile.avatar（设置自己的独立头像）；
 * - 全局头像 = 联系人 App 机主 avatar，其余界面（聊天气泡/信息/电话/淘宝美团等）继续跟随；
 * - 任一入口未单独设置过就跟随全局（avatarFor 槽位回退语义天然满足）。
 * 因此本模块不再镜像头像（双向都去掉），避免「设置里换头像污染全局 / 联系人换头像覆盖设置」。
 *
 * 同步规则（仅名字，双向镜像）：
 * - 联系人 → profile：机主联系人编辑保存（'contact-updated'）且 name 实变后镜像到 profile；
 * - profile → 联系人：设置›个人信息改名字后镜像回机主联系人（updateContact 自动广播，
 *   微信/QQ/电话/信息等全端即时刷新）；
 * - 双向都先 diff 再写（值相同不落库）：回声必然 diff 为空，自然收敛、无死循环；
 * - 一次性迁移（owner-avatar-isolation-v1）：历史上头像曾被双向镜像，profile.avatar 与
 *   机主全局头像一致 = 未在设置里自主设置过 → 清空 profile.avatar 回归「跟随全局」；
 *   不一致则视为用户在设置里自选的头像，保留为设置侧独立头像。
 *
 * 挂载点：PhoneShell 开机流程，常驻监听。
 */

import { getContact, listContacts, updateContact } from './contacts-store';
import { useSettings, type Profile } from './store';

let started = false;

/** 一次性迁移标记（头像隔离上线：清除历史镜像出的一致 profile 头像） */
const AVATAR_ISOLATION_FLAG = 'owner-avatar-isolation-v1';

/** 机主 USER 联系人（kind='user' 且非小号/匿名号档案）；不存在返回 null */
async function mainOwnerContact(): Promise<Awaited<ReturnType<typeof listContacts>>[number] | null> {
  const all = await listContacts();
  return all.find((c) => c.kind === 'user' && !c.altOf) ?? null;
}

/** 两边共有字段的 diff（名字取 trim 后比较；头像隔离后只同步名字） */
function profilePatchFromContact(ownerName: string, profile: Profile): Partial<Profile> {
  const patch: Partial<Profile> = {};
  const name = ownerName.trim();
  if (name && name !== profile.name.trim()) patch.name = name;
  return patch;
}

/** ① 联系人 → 设置 profile：机主联系人编辑保存后镜像名字。
 *  changed = updateContact 传来的本次实变字段；传 name 才镜像（头像槽位/其他字段不碰设置侧） */
async function mirrorContactToProfile(contactId: string | null, changed?: string[]): Promise<void> {
  try {
    const owner = contactId ? await getContact(contactId) : await mainOwnerContact();
    if (!owner || owner.kind !== 'user' || owner.altOf) return;
    if (changed && !changed.includes('name')) return;
    const { profile, setProfile } = useSettings.getState();
    const patch = profilePatchFromContact(owner.name ?? '', profile);
    if (Object.keys(patch).length > 0) setProfile(patch);
  } catch {
    // 同步失败静默（下次编辑会再对账）
  }
}

/** ② 设置 profile → 机主联系人：设置›个人信息改名字后镜像回联系人（updateContact 自动全端广播）。
 *  头像不再镜像——设置侧头像自持（跟随全局由显示层 profile.avatar 为空时回退实现） */
async function mirrorProfileToContact(): Promise<void> {
  try {
    const owner = await mainOwnerContact();
    if (!owner) return;
    const { profile } = useSettings.getState();
    const name = profile.name.trim();
    if (!name || name === (owner.name ?? '').trim()) return;
    await updateContact(owner.id, { name });
  } catch {
    // 同步失败静默（下次编辑会再对账）
  }
}

/**
 * 一次性迁移：头像隔离上线前 profile.avatar 由双向镜像维护（恒等于全局头像）。
 * 与全局一致 = 用户未在设置里自主设置 → 清空回归「跟随全局」；不一致 = 自选头像，保留。
 */
async function migrateAvatarIsolation(): Promise<void> {
  try {
    if (typeof window === 'undefined') return;
    if (window.localStorage.getItem(AVATAR_ISOLATION_FLAG)) return;
    window.localStorage.setItem(AVATAR_ISOLATION_FLAG, '1');
    const owner = await mainOwnerContact();
    if (!owner) return;
    const { profile, setProfile } = useSettings.getState();
    if (profile.avatar && profile.avatar === owner.avatar) setProfile({ avatar: '' });
  } catch {
    // 迁移失败静默（下次启动重试——flag 未写时）
  }
}

/** 开机初始对账：只补空——profile 名字为空时机主联系人名字补位（头像不再补，跟随全局由显示层兜底） */
async function initialReconcile(): Promise<void> {
  try {
    const owner = await mainOwnerContact();
    if (!owner) return;
    const { profile, setProfile } = useSettings.getState();
    const name = (owner.name ?? '').trim();
    if (!profile.name.trim() && name) setProfile({ name });
  } catch {
    // 静默
  }
}

/** 启动同步（幂等；PhoneShell 开机调用一次） */
export function startOwnerProfileSync(): void {
  if (started || typeof window === 'undefined') return;
  started = true;

  // 任意联系人编辑保存后：是机主本人且名字实变 → 镜像到 profile（detail 缺失时按机主扫描兜底）
  window.addEventListener('contact-updated', (e) => {
    const detail = (e as CustomEvent<{ contactId?: string; changed?: string[] }>).detail;
    void mirrorContactToProfile(detail?.contactId ?? null, detail?.changed);
  });

  // 设置›个人信息改名字后：镜像回机主联系人（头像变化到此为止，不再写联系人）
  useSettings.subscribe((state, prev) => {
    if (state.profile.name === prev.profile.name) return;
    void mirrorProfileToContact();
  });

  void initialReconcile();
  void migrateAvatarIsolation();
}
