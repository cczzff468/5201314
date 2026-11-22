'use client';

/**
 * pay-pwd-box —— 支付密码 AES-GCM 加密落盘共享层（v1.9.2，与 music-api 配置持久化节同模式）。
 *
 * 【背景】微信（wx-pay-pwd）/ QQ（qq-pay-pwd）/ 美团（mt-pay-pwd:<uid>）三处的支付密码
 * 原先都是明文对象直接 kvSet 落 IndexedDB；本版起统一走本模块：内存里始终是明文对象
 * （业务同步读签名零变化），kv 里落 `enc:v1:<iv>:<cipher>` 密文串（secret-box AES-GCM，
 * IndexedDB 不再存明文）。加解密环境不可用时 encryptSecret/decryptSecret 原样返回
 * （secret-box 降级语义），本模块行为自动退化为旧版明文落盘，绝不抛错。
 *
 * 【同步读为什么必须靠内存缓存】kvGet 是内存 Map 同步读，但密文解密是异步（WebCrypto），
 * 同步函数签名（wxLoadPayPwd 等）不允许改 async。方案 = 明文内存缓存 + 开机异步注水：
 * - ensurePayPwdBoxesHydrated() 在 PhoneShell 开机门控（await ensureKvReady() 之后）执行，
 *   把 kv 里的密文解密进缓存——开机屏结束前所有同步读必命中缓存，不存在「读到密文返回
 *   null 被当成未设置」的窗口（设了密码的用户升级后无需重设）；
 * - 注水前（理论上仅极早期渲染）与注水失败时，同步读返回 null，与旧版「kv 无键」行为一致。
 *
 * 【缓存为什么按账号作用域分槽】idb-kv 对 `wx-*`/`qq-*` 键自动按当前账号加 `--{id}` 后缀
 * （大号原键），且**切换账号不刷新网页**（switchAccountFor 派发 ACCOUNT_CHANGED_EVENT，
 * 各组件重读数据）——若缓存只有单槽，切号后会返回上一个账号的支付密码（旧版是现读现映射，
 * 天然隔离）。故明文缓存按「原样存储键」分槽：开机把语义键的各大号/小号变体全部注水，
 * 切号后同步读直接命中新账号的槽位，与旧版逐次现读语义完全一致，无需监听切号事件。
 * 槽位标识用 accounts.ts 的 scopedKvKey 官方助手计算（与 idb-kv 内部 effKey 同源同规则）；
 * 存储读写仍只传语义键（kvGet/kvSet 自己做映射），本模块不手工拼后缀键落库。
 *
 * 【写入两步走：先保命后加密】save() 先 kvSet 明文对象（立即持久，与旧版一致），再异步
 * encryptSecret 后用密文覆盖。为什么明文在前：加密是异步的，若等密文就绪才落库，写后立刻
 * 关页/断电会整条丢数据；先明文保证任一时刻 kv 里都有完整可解析数据——只有明文 → 下次
 * load/注水读到后自愈回写升级为密文；只有密文 → 正常。最终收敛为密文，中断不丢数据。
 *
 * 【自愈升级】读到旧形态（明文对象 / 明文 JSON 串，如备份导入的明文）时进缓存并
 * fire-and-forget 加密回写，旧数据「被读到一次就升密文」，无需批量迁移脚本。
 *
 * 【脏标记防竞态】对齐 music-api：注水/自愈的异步写完成前若该作用域发生新 save/remove
 * （脏标记置位），旧值相关写一律放弃——防止「旧明文自愈密文」覆盖「新 save 的明文」、
 * 以及 remove 后在途写把已删数据复活。save 自身的密文覆盖写另用每作用域 writeSeq 序号
 * 守卫，防御连续两次 save 时密文乱序落库（正常微任务序不会乱序，此处保底）。
 */

import { accountAppOfKey, scopedKvKey } from './accounts';
import { ensureKvReady, kvDel, kvGet, kvGetRaw, kvKeysByPrefix, kvSet, kvSetRaw } from './idb-kv';
import { decryptSecret, encryptSecret, isEncrypted } from './secret-box';

// ---------------- 三站点 kv 键（唯一事实来源；站点文件从此处引用，防两处字面量漂移） ----------------

/** 微信支付密码（wechat-wallet.tsx 的 WX_LS_PAY_PWD = 此值；idb-kv 迁移清单同名） */
export const WX_PAY_PWD_KEY = 'wx-pay-pwd';
/** QQ 支付密码（qq.tsx 的 LS_PAY_PWD = 此值） */
export const QQ_PAY_PWD_KEY = 'qq-pay-pwd';
/** 美团支付密码按登录账号多份：`mt-pay-pwd:<uid>`（无 wx-/qq- 前缀 → idb-kv 不加账号后缀，键即原样） */
export const MT_PAY_PWD_KEY_PREFIX = 'mt-pay-pwd:';

// ---------------- box 类型与工厂 ----------------

/** 单条支付密码的加密落库 box：同步读 + 同步签名写 + 异步注水/自愈 */
export interface PwdBox<T extends object> {
  /** kv 语义键（诊断用；kvGet/kvSet 内部自动处理账号后缀，调用方不要手工加后缀落库） */
  readonly key: string;
  /** 同步读（当前账号作用域缓存命中直接返回；kv 有旧明文形态时顺带自愈升级为密文） */
  load(): T | null;
  /** 同步签名保存（写当前账号作用域）：内存槽位立即生效 → 明文落库保命 → 异步加密覆盖 */
  save(d: T): void;
  /** 清当前作用域缓存 + 删 kv 记录（并作废在途的旧值加密写，防复活） */
  remove(): void;
  /** 异步注水：ensureKvReady 后把语义键的全部账号作用域变体解密进各槽位（幂等，可重复调） */
  ensureHydrated(): Promise<void>;
}

/** 按 key 共享的 box 实例池：同 key 恒定同一实例（缓存与脏标记才不会分裂）。
 *  值用 PwdBox<object> 非 PwdBox<never>：方法参数双变，PwdBox<T> 可直接收窄，无需双重断言。 */
const boxCache = new Map<string, PwdBox<object>>();

/**
 * 创建（或取回）支付密码 box。同一 semanticKey 重复调用返回同一实例——
 * 静态键（wx/qq）站点文件与开机注水各调一次天然共享；美团按 uid 动态键
 * （`mt-pay-pwd:<uid>`）也由此去重，无需站点侧自管 Map。
 */
export function createPwdBox<T extends object>(semanticKey: string): PwdBox<T> {
  const cached = boxCache.get(semanticKey);
  if (cached) return cached as PwdBox<T>;

  /** 各账号作用域的明文槽位：键 = 原样存储键（语义键本体或 `语义键--账号id`），见模块头 */
  const slots = new Map<string, T>();
  /** 每作用域脏标记：该作用域会话内发生过本地 save/remove（槽位新于 kv 注水快照） */
  const dirty = new Map<string, boolean>();
  /** 每作用域 save 序号：密文覆盖写完成时序号不一致 = 过期写，放弃 */
  const writeSeq = new Map<string, number>();
  /** load 兜底触发注水只做一次：防密文损坏时每次渲染反复解密（正常开机门控下走不到） */
  let autoTried = false;
  /** 在途注水（并发调用共享同一 Promise，天然去重） */
  let hydrating: Promise<void> | null = null;

  /** 当前账号作用域的原样存储键。仅作缓存槽位标识与变体注水的定点写；
   *  业务存储读写一律传语义键由 idb-kv 映射（与该计算同源同规则，不会漂移）。 */
  function currentRawKey(): string {
    const app = accountAppOfKey(semanticKey);
    return app ? scopedKvKey(semanticKey, app) : semanticKey;
  }

  /** 本语义键在 kv 内存层已有的全部原样键（大号原键 + 各小号 `--{id}` 后缀变体）。
   *  精确匹配 + `--` 后缀匹配：防语义键是别的键前缀时的误收（如 mt 的 uid1/uid10）。 */
  function allRawKeys(): string[] {
    return kvKeysByPrefix(semanticKey).filter(
      (k) => k === semanticKey || k.startsWith(`${semanticKey}--`)
    );
  }

  /** 自愈回写：把某作用域槽位的明文加密后定点覆盖该 kv 记录（fire-and-forget）。
   *  用 kvSetRaw 直写原样键——注水会覆盖非当前账号的变体，走 kvSet 语义键会写错账号。
   *  加密期间该作用域发生新 save/remove（脏标记置位）则放弃：新值由 save 自己的写链落库，
   *  防旧值密文覆盖新数据/删后复活。 */
  function selfHeal(rawKey: string): void {
    const snapshot = slots.get(rawKey);
    if (!snapshot) return;
    void encryptSecret(JSON.stringify(snapshot)).then((enc) => {
      if (!dirty.get(rawKey)) kvSetRaw(rawKey, enc);
    });
  }

  /** 注水单个原样键：密文解密 / 旧明文直读 → 进对应槽位（+旧形态自愈） */
  async function hydrateOne(rawKey: string): Promise<void> {
    const raw = kvGetRaw<unknown>(rawKey);
    if (raw == null) return;
    let value: T | null = null;
    let legacy = false; // 记录存在且为明文形态 → 注水后自愈回写为密文
    if (typeof raw === 'string') {
      if (isEncrypted(raw)) {
        // 密文损坏/换设备种子：decryptSecret 原样退回密文串 → JSON.parse 必失败 → 按无数据处理
        const plain = await decryptSecret(raw);
        try {
          const parsed: unknown = JSON.parse(plain);
          if (parsed && typeof parsed === 'object') value = parsed as T;
        } catch {
          return;
        }
      } else {
        // 明文 JSON 串（备份导出/导入链路落回的形态）：解析 + 自愈升级
        try {
          const parsed: unknown = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') {
            value = parsed as T;
            legacy = true;
          }
        } catch {
          return;
        }
      }
    } else if (typeof raw === 'object') {
      // 旧明文对象（历史版本落盘形态）：直接用 + 自愈
      value = raw as T;
      legacy = true;
    }
    if (!value) return;
    // 注水 await 期间该作用域发生过 save/remove：槽位已是更新值（或已清），放弃旧值防覆盖
    if (dirty.get(rawKey)) return;
    slots.set(rawKey, value);
    if (legacy) selfHeal(rawKey);
  }

  async function doHydrate(): Promise<void> {
    try {
      await ensureKvReady(); // 幂等：开机门控已跑过则立即返回；未跑过则等它（读全量内存层）
      const rawKeys = allRawKeys();
      if (rawKeys.length === 0) return;
      await Promise.all(rawKeys.map((rawKey) => hydrateOne(rawKey)));
    } catch {
      // 注水失败按无数据处理（与旧版 kv 无键时一致），不阻塞调用方
    }
  }

  /** load 里的兜底注水触发：正常流程开机门控已完成注水走不到这里；触发一次即可 */
  function triggerHydrateOnce(): void {
    if (autoTried) return;
    autoTried = true;
    void hydratingBox.ensureHydrated();
  }

  const hydratingBox: PwdBox<T> = {
    key: semanticKey,
    load(): T | null {
      // ① 当前账号作用域槽位命中（开机注水后所有同步读都走这条快路径；切号换槽，语义与旧版现读一致）
      const rawKey = currentRawKey();
      const hit = slots.get(rawKey);
      if (hit) return hit;
      // ② kv 内存写穿层同步读（Map 读，零 IO；传语义键，作用域映射由 idb-kv 负责）
      const raw = kvGet<unknown>(semanticKey);
      if (raw == null) return null;
      if (typeof raw === 'object') {
        // 旧明文对象（历史版本/备份导入）：进槽位 + fire-and-forget 自愈升级为密文
        slots.set(rawKey, raw as T);
        selfHeal(rawKey);
        return raw as T;
      }
      if (typeof raw === 'string') {
        if (isEncrypted(raw)) {
          // enc:v1 密文：同步上下文解不了（WebCrypto 异步）→ 本次返回 null 等注水
          //（开机门控保证注水先于一切 UI 读；此处兜底再触发一次，幂等去重）
          triggerHydrateOnce();
          return null;
        }
        // 未加密字符串（备份导入的明文 JSON 串）：解析进槽位 + 自愈升级
        try {
          const parsed: unknown = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') {
            slots.set(rawKey, parsed as T);
            selfHeal(rawKey);
            return parsed as T;
          }
        } catch {
          // 非法字符串按无数据处理（与旧版 kv 无键时行为一致）
        }
        return null;
      }
      return null; // 其他形态不该出现，防御性兜底
    },
    save(d: T): void {
      const rawKey = currentRawKey();
      slots.set(rawKey, d); // 内存同步生效：save 后紧接着的同步读立即拿到新值
      dirty.set(rawKey, true);
      const seq = (writeSeq.get(rawKey) ?? 0) + 1;
      writeSeq.set(rawKey, seq);
      // 第一步·保命：明文立即落库（语义键 → idb-kv 按当前账号作用域；与旧版持久性打平）
      kvSet(semanticKey, d);
      // 第二步·加密：密文就绪后覆盖为 enc:v1 串；序号守卫防连续 save 的密文乱序覆盖
      void encryptSecret(JSON.stringify(d)).then((enc) => {
        if (writeSeq.get(rawKey) === seq) kvSet(semanticKey, enc);
      });
    },
    remove(): void {
      const rawKey = currentRawKey();
      slots.delete(rawKey);
      dirty.set(rawKey, true); // 作废该作用域在途的旧值自愈写，防已删数据被写回复活
      writeSeq.set(rawKey, (writeSeq.get(rawKey) ?? 0) + 1); // 作废在途 save 的密文覆盖写
      kvDel(semanticKey);
    },
    ensureHydrated(): Promise<void> {
      if (!hydrating) {
        hydrating = doHydrate().finally(() => {
          hydrating = null; // 允许后续再次注水（幂等，重复执行只是多读一次 kv）
        });
      }
      return hydrating;
    },
  };

  boxCache.set(semanticKey, hydratingBox);
  return hydratingBox;
}

// ---------------- 开机注水挂点 ----------------

/**
 * 三个站点的支付密码 box 全量注水（PhoneShell 开机门控在 await ensureKvReady() 后调用）。
 * 幂等可重复调。wx/qq 的 box 自身会扫出语义键的全部账号作用域变体（大号 + 各小号）注水，
 * 切号后同步读直接命中槽位；美团键按登录 uid 多份且开机时无法预知 uid → 扫 kv 里已有的
 * `mt-pay-pwd:*` 键逐个建 box（createPwdBox 按 key 去重，站点后续取到的是同一实例）注水。
 * 记录数 = 已设过支付密码的账号/账户数，个位数，开销可忽略。
 */
export async function ensurePayPwdBoxesHydrated(): Promise<void> {
  await ensureKvReady();
  const tasks: Promise<void>[] = [
    createPwdBox<Record<string, unknown>>(WX_PAY_PWD_KEY).ensureHydrated(),
    createPwdBox<Record<string, unknown>>(QQ_PAY_PWD_KEY).ensureHydrated(),
  ];
  // memStore 里的键是原样键；mt-* 无账号后缀映射，扫到的即语义键本身
  for (const rawKey of kvKeysByPrefix(MT_PAY_PWD_KEY_PREFIX)) {
    tasks.push(createPwdBox<Record<string, unknown>>(rawKey).ensureHydrated());
  }
  await Promise.all(tasks);
}
