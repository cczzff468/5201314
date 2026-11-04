/**
 * Web Push 服务端共享存储（/api/push 与 /api/chat/bg 共用）：
 * - VAPID 密钥三级来源：环境变量 VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY（Netlify 等只读
 *   文件系统部署的唯一稳定方式，密钥跨冷启动不变）→ .data/vapid.json（本地开发）→ 现场生成；
 * - 订阅表与密钥的双路径读写：process.cwd()/.data 优先，失败（只读 FS，如 Netlify Lambda）
 *   自动落到 os.tmpdir()/ai-phone-push-data —— Netlify 上 /tmp 可写，同实例内订阅不丢；
 * - 全部尽力而为：任何失败不抛出阻塞业务（推送是增强能力，页面内通知不受影响）。
 */

/**
 * 数据文件候选目录（按序尝试）：项目 .data 优先（本地可持久化），/tmp 兜底（只读 FS）。
 * 用字符串动态拼接路径，避免顶层导入依赖（路由打包兼容）。
 */
function dataDirs(): string[] {
  const dirs: string[] = [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require('node:path') as typeof import('node:path');
    dirs.push(path.join(process.cwd(), '.data'));
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const os = require('node:os') as typeof import('node:os');
    // /tmp 下带项目标识目录，避免同机多实例互踩；Lambda 每实例独立 /tmp 天然隔离
    dirs.push(path.join(os.tmpdir(), 'ai-phone-push-data'));
  } catch {
    // node 内置模块不可用（极端环境）：返回空 → 读写全部静默失败
  }
  return dirs;
}

/** 依次尝试各候选目录读 JSON：第一个能读到的地方生效 */
export async function readPushJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const { readFile } = await import('fs/promises');
    const path = await import('path');
    for (const dir of dataDirs()) {
      try {
        const raw = await readFile(path.join(dir, file), 'utf8');
        return JSON.parse(raw) as T;
      } catch {
        // 该目录无文件/不可读 → 试下一个
      }
    }
  } catch {
    // fs 不可用静默
  }
  return fallback;
}

/** 依次尝试各候选目录写 JSON：cwd/.data 失败（只读 FS）自动落 /tmp；全部失败静默 */
export async function writePushJson(file: string, value: unknown): Promise<void> {
  try {
    const { writeFile, mkdir } = await import('fs/promises');
    const path = await import('path');
    for (const dir of dataDirs()) {
      try {
        await mkdir(dir, { recursive: true });
        await writeFile(path.join(dir, file), JSON.stringify(value), 'utf8');
        return; // 第一个写成功的地方生效
      } catch {
        // 只读/不可写 → 试下一个目录
      }
    }
  } catch {
    // fs 不可用静默
  }
}

/** 环境变量里的 VAPID（Netlify 部署设置一次，跨冷启动稳定——只读 FS 场景的唯一可靠来源） */
function envVapid(): VapidKeys | null {
  const pub = process.env.VAPID_PUBLIC_KEY?.trim();
  const priv = process.env.VAPID_PRIVATE_KEY?.trim();
  if (pub && priv) return { publicKey: pub, privateKey: priv };
  return null;
}

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

let vapidInflight: Promise<VapidKeys | null> | null = null;

/**
 * VAPID 密钥获取（单飞）：环境变量 → .data/vapid.json（双路径）→ 现场生成并落盘。
 * 生成前先复查盘上已有密钥，防并发首个请求互相覆盖（覆盖后旧订阅全部 401/403 失效）。
 */
export function getVapidKeys(): Promise<VapidKeys | null> {
  if (!vapidInflight) {
    vapidInflight = (async () => {
      const env = envVapid();
      if (env) return env;
      const saved = await readPushJson<VapidKeys>('vapid.json', { publicKey: '', privateKey: '' });
      if (saved.publicKey && saved.privateKey) return saved;
      try {
        const webpush = (await import('web-push')).default;
        const keys = webpush.generateVAPIDKeys();
        await writePushJson('vapid.json', keys);
        return { publicKey: keys.publicKey, privateKey: keys.privateKey };
      } catch {
        return null;
      }
    })().catch(() => {
      vapidInflight = null; // 失败不缓存，下次请求重试
      return null;
    });
  }
  return vapidInflight;
}

export interface SubRec {
  endpoint: string;
  [k: string]: unknown;
}

/** 订阅表读-改-写串行链（防并发 POST/DELETE 互相覆盖丢订阅） */
let subsInflight: Promise<void> = Promise.resolve();

export function runSubsMutation<T>(task: () => Promise<T>): Promise<T> {
  const curr = subsInflight.then(task, task);
  subsInflight = curr.then(
    () => undefined,
    () => undefined,
  );
  return curr;
}
