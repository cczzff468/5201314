/**
 * 浏览器工作区 ID（旧版「服务端存联系人 + 按浏览器隔离」时期的遗留）：
 * 联系人已全部改为浏览器 IndexedDB 本地存储，服务端不再保管用户数据。
 * 本模块仅保留 ID 生成/读取，供**一次性迁移**（/api/contacts/migrate）识别
 * 「本浏览器旧时工作区」，把当年存在服务端的联系人搬回本地后即完成使命。
 */

const WS_KEY = 'ios-workspace-id';

/** localStorage 完全不可用（如旧版隐私模式）时的会话级兜底 ID：整个页面生命周期内保持一致 */
let ephemeralId: string | null = null;
function makeId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `ws-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 读取（或首次创建）当前浏览器的工作区 ID */
export function getWorkspaceId(): string {
  if (typeof window === 'undefined') return 'default';
  try {
    let id = window.localStorage.getItem(WS_KEY);
    if (!id) {
      id = makeId();
      window.localStorage.setItem(WS_KEY, id);
    }
    return id;
  } catch {
    // localStorage 不可用（隐私模式极端情况）：退化为会话级随机 ID。
    // 必须缓存到模块变量——否则每次调用都生成新 ID，同页面不同请求会互相看不到数据
    if (!ephemeralId) ephemeralId = makeId();
    return ephemeralId;
  }
}

/** 携带工作区 ID 的请求头（迁移请求用） */
export function wsHeaders(): Record<string, string> {
  return { 'X-Workspace-Id': getWorkspaceId() };
}
