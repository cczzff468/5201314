'use client';

/**
 * 微信 App：
 * - 登录：账号数据来自「联系人 App」中 kind = user 的联系人
 *   ① 手机号 + 微信密码 ② 微信号 / QQ 号 + 对应密码（本地 IndexedDB 联系人校验，不调服务端）
 * - 登录后：微信 / 通讯录 / 发现 / 我 四个 tab + 好友 AI 聊天 + 朋友圈（发布/点赞/评论）+ 好友朋友圈 + 添加朋友 + 设置（退出登录）
 * - 通讯录与「信息」App 一致：只有添加过的微信好友（friendWx，独立于 QQ/信息）才显示；首次登录只有「我」自己
 * - char / npc 账号暂不支持登录（本地校验拦截）
 */


// v1.9.27 任务10 超大文件拆分：本文件收敛为 App 入口 WeChatApp + 桶（barrel）——实现按功能域拆至 ./wx-app/*，
// 对外导入路径与导出面不变（registry 动态导入 / 群聊页 / 美团 / 淘宝等外部消费方零改动）。
export * from './wx-app/core';
export * from './wx-app/widgets';
export * from './wx-app/login';
export * from './wx-app/cards';
export * from './wx-app/stickers';
export * from './wx-app/chat-page';
export * from './wx-app/moments';
export * from './wx-app/pages';
export * from './wx-app/main';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSettings, useUI } from '@/lib/ios/store';
// v1.9.12 聊天滚动重做（全端共享）：进入即到底/发送必到底/贴底跟随/看历史时「有新消息」轻提示
import { ScanOverlayWhen } from './mt-scan';
import { purgeDeliveryQueueByPrefix } from '@/lib/ios/ai-delivery';
// Task 40 错误提示优化 + 草稿箱：错误分类与连续失败冷却、会话草稿持久化、失败灰字提示行组件
import { abortStreamsByPrefix } from '@/lib/chat-stream-store';
// 美团×AI 联动（外卖参与/双向代付）：动作执行、上下文块、历史序列化
// 深度思考：指令注入 + [思考]块剥离 + 开关（IndexedDB 按联系人隔离，渲染订阅版随设置页切换即时刷新）
// v1.3 Shizuku 自主权：[手机操作:命令] 标记的执行器 + 按开关动态注入的教学规则（设置 APP → AI 动手）
// 第十六轮：AI 动态状态（情绪+作息）注入 + 送礼物情绪事件
// v33【AI 真人社交】：X论坛近况感知块（TA 发的帖/我发的帖/评论互动 → 私聊能自然提起）
import { isLiquidTheme, isRetroTheme } from '@/lib/ios/bubble-style';
import { ChatSkinProvider } from '@/lib/ios/chat-skin';
// 多账号 v2（Task 40-2a）：per-app 账号 API——accLs 键作用域调用时现算；switchAccountFor 切换只写标记+派发事件（不刷新网页）
// 第三十四轮：添加账号弹层（AccountAddSheet）删除——「添加账号」改为直接用账号密码登录（LoginScreen）
import { ACCOUNT_CHANGED_EVENT, MAIN_ACCOUNT_ID, accLs, clearForceLoginWall, getActiveAccountFor, isForceLoginWallActive, markAccountLoginHistory, requestForceLoginWall, switchAccountFor } from '@/lib/ios/accounts';
import { listContactsFor, ownerRealNameFor } from '@/lib/ios/contacts-store';
import { addressNameOf, displayNameOf, liveAvatarOf, withDisplayNames, socialNameOf } from '@/lib/contacts';
import type { ContactRecord } from '@/lib/contacts';
import { runFriendReqCatchUp, FRIEND_STATE_APPLIED_EVENT } from '@/lib/ios/friend-state';
// v73 AI 聊天悬浮小窗：顶栏「小窗模式」按钮入口（打开全局小窗并退出全屏聊天）

import { LS_SESSION, WxUser, wxQueueReload } from './wx-app/core';
import { LoginScreen } from './wx-app/login';
import { MainScreen } from './wx-app/main';

// ---------------- App 入口 ----------------

export default function WeChatApp() {
  const closeApp = useUI((s) => s.closeApp);
  // 第五十五轮（用户指定「所有界面都变化」）：主题作用域挂到 App 根 wrapper——
  // data-rt-theme / data-liquid-theme 触发 globals.css 里的 scoped 批量接管，
  // 覆盖主界面/聊天页/全部子页与弹层（页面底/白色卡/按钮/菜单），子页无需逐个改 JSX
  const bubbleStyleRoot = useSettings((s) => s.bubbleStyle);
  const retroRoot = isRetroTheme(bubbleStyleRoot, 'wx');
  const liquidRoot = isLiquidTheme(bubbleStyleRoot, 'wx');
  const [booting, setBooting] = useState(true);
  const [user, setUser] = useState<WxUser | null>(null);
  const [contacts, setContacts] = useState<ContactRecord[]>([]);
  /** id → 真实名字（钱包持卡人用；微信内显示的是昵称，昵称不是真实名字） */
  const [realNameById, setRealNameById] = useState<Record<string, string>>({});

  const toWxUser = useCallback((c: ContactRecord): WxUser => {
    return {
      id: c.id,
      name: displayNameOf(c),
      // 真名/昵称随会话携带：AI 称呼（persona/group prompt）与群成员解析要用，展示仍用 name。
      // contacts 是 withDisplayNames 后的展示副本（name 已被昵称替换）→ 真名必须取 realName 字段
      realName: c.realName ?? c.name,
      nickname: c.nickname ?? null,
      avatar: c.avatar,
      wechatId: c.wechatId,
      phone: c.phone,
      qqId: c.qqId,
      // 2025（小号加好友 AI 决策）：会话恢复也必须带 altOf——登录时 handleLogin 存入的
      // altOf 会被账号切换事件触发的 boot 重跑（此处）覆盖，丢失后小号加好友会走错「发送即通过」旧链路
      altOf: c.altOf ?? null,
    };
  }, []);

  /** NPC 归属者名字（聊天人设用） */
  const ownerName = useMemo(() => {
    const byId = new Map(contacts.map((c) => [c.id, c.name]));
    const npcOwner = (c: ContactRecord): string | null => {
      if (c.kind !== 'npc' || !c.ownerId) return null;
      return byId.get(c.ownerId) ?? null;
    };
    return npcOwner;
  }, [contacts]);

  const loadContacts = useCallback(async (): Promise<ContactRecord[]> => {
    // 微信内显示昵称（昵称优先于真实名字，机主本人同规则——社交展示名 socialNameOf；副本 realName 存真名，
    // AI 链路统一走 addressNameOf/ownerRealNameFor 取真名，永不接触机主昵称）。
    // 头像按 App 隔离：读 wx 投影（App 槽位优先、回退全局 avatar），微信里看到的头像独立于 QQ/信息/电话。
    // 备注按 App 隔离（第四十八轮）：微信里设置的备注只写 remarks.wx——微信显示它，QQ/信息不受影响
    const raw = await listContactsFor('wx');
    setRealNameById(Object.fromEntries(raw.map((c) => [c.id, c.name])));
    return withDisplayNames(raw, { social: true, app: 'wx' });
  }, []);

  /** 重新拉取联系人（添加好友后调用，列表即时生效）；返回新列表供「我」快照同步复用 */
  const reloadContacts = useCallback(async (): Promise<ContactRecord[]> => {
    const list = await loadContacts().catch(() => [] as ContactRecord[]);
    setContacts(list);
    return list;
  }, [loadContacts]);

  // 换头像跨 App 即时生效（引用式架构）：头像只在联系人资料存一份，渲染端 liveAvatarOf 实时解析；
  // 其他 App（联系人/信息/电话/QQ）改了头像时刷新本端联系人缓存，打开中的朋友圈/聊天页立刻显示新头像。
  // contact-updated：任意资料字段（名字/手机号/昵称/人设…）变更也刷新——编辑联系人不换头像时
  // 微信端不再持旧快照（会话列表/资料页/登录解析保持最新）。
  // 「我」快照同步（编辑自己修复）：user 是开机/登录时 from 联系人的快照——机主在联系人 App
  // 改了自己头像/名字后，朋友圈发帖署名、聊天气泡我的头像等仍持旧值；这里随重载按最新联系人重派生
  useEffect(() => {
    const fn = () =>
      void reloadContacts().then((list) => {
        setUser((prev) => {
          if (!prev) return prev;
          const hit = list.find((c) => c.id === prev.id && c.kind === 'user');
          return hit ? toWxUser(hit) : prev;
        });
      });
    window.addEventListener('contact-avatar-changed', fn);
    window.addEventListener('contact-updated', fn);
    return () => {
      window.removeEventListener('contact-avatar-changed', fn);
      window.removeEventListener('contact-updated', fn);
    };
  }, [reloadContacts, toWxUser]);

  // 小号加好友 AI 决策落盘（2025）：同意 = 好友标记变化 → 刷新联系人（通讯录/会话列表即时出现）；
  // 拒绝/先回复不改变好友标记，刷新无副作用
  useEffect(() => {
    const fn = () => void reloadContacts();
    window.addEventListener(FRIEND_STATE_APPLIED_EVENT, fn);
    return () => window.removeEventListener(FRIEND_STATE_APPLIED_EVENT, fn);
  }, [reloadContacts]);

  // 删好友后 AI 主动申请加回：定时器不跨刷新，微信挂载时扫描删除状态按冷却补跑
  useEffect(() => {
    runFriendReqCatchUp();
  }, []);

  // 多账号 v2（Task 40-2a）：微信账号切换不刷新网页——监听切换事件：①中断 wx 在途流（已收尾不再落盘）
  // ②清理 wx 投递队列 ③排队补跑内存队列换仓到新账号快照；④bump reloadKey → 启动加载 effect 重跑
  //（联系人重读 + 按新账号作用域恢复登录态，无登录态 → 登录墙）。列表数据的复位与重读在 MainScreen 内监听同一事件。
  const [accReloadKey, setAccReloadKey] = useState(0);
  useEffect(() => {
    const fn = (e: Event) => {
      const d = (e as CustomEvent<{ app?: string; id?: string }>).detail;
      if (!d || d.app !== 'wx') return;
      abortStreamsByPrefix('wx:');
      purgeDeliveryQueueByPrefix('wx:');
      wxQueueReload();
      setAccReloadKey((k) => k + 1);
    };
    window.addEventListener(ACCOUNT_CHANGED_EVENT, fn);
    return () => window.removeEventListener(ACCOUNT_CHANGED_EVENT, fn);
  }, []);

  // 启动 / 账号切换重跑：拉联系人 + 恢复登录态（联系人被删则自动登出）。
  // 登录态键按微信当前账号作用域（Task 40-2a：accLs 调用时现算，大号=原键旧登录态不丢）；
  // 切换账号（accReloadKey 变化）重跑时：无登录态/联系人缺失 → 显式回登录墙，杜绝上一账号的界面残留。
  useEffect(() => {
    let alive = true;
    (async () => {
      // 匿名号只属于电话/信息（Task 40-S）：历史遗留的微信匿名号槽位开机自愈切回大号
      //（switchAccountFor 派发事件 → 下方监听器 bump accReloadKey 重跑本 effect）
      if (getActiveAccountFor('wx').kind === 'anon') {
        switchAccountFor('wx', MAIN_ACCOUNT_ID);
        return;
      }
      // 多账号 Task 41：退出登录后的自由登录墙——本次启动不恢复任何会话，
      // 直接进自由登录（不显示/不锁定「当前账号」，想登哪个登哪个）。
      // 2025 补充（登录态保持）：只检查不消费——标记持续到下一次登录成功（handleLogin 清除），
      // 「退出 → 关掉 App → 再打开」仍是自由登录墙；登录过一次后所有账号免登录切换。
      if (isForceLoginWallActive('wx')) {
        if (!alive) return;
        setUser(null);
        setBooting(false);
        return;
      }
      const list = await loadContacts().catch(() => [] as ContactRecord[]);
      if (!alive) return;
      setContacts(list);
      try {
        const sKey = accLs(LS_SESSION, 'wx');
        const savedId = window.localStorage.getItem(sKey);
        // Task 40 修正：小号/匿名号槽位的会话必须指向本槽位档案联系人——
        // 历史串槽登录态（在 A 小号槽位登了 B 的账密）在此自愈清除，避免切号页显示错账号
        const acc = getActiveAccountFor('wx');
        // Task 41 补强：大号作用域的会话指向了小号/匿名号档案（历史串槽残留）→ 清除回自由登录
        if (savedId && acc.kind === 'main') {
          const saved = list.find((c) => c.id === savedId && c.kind === 'user');
          if (saved?.altOf) {
            window.localStorage.removeItem(sKey);
            setUser(null);
            setBooting(false);
            return;
          }
        }
        const slotProfile =
          acc.kind !== 'main' && savedId
            ? list.find((c) => c.kind === 'user' && (c.altOf === acc.id || c.id === acc.ownerContactId))
            : null;
        if (savedId && acc.kind !== 'main' && (!slotProfile || slotProfile.id !== savedId)) {
          window.localStorage.removeItem(sKey);
          setUser(null);
        } else if (savedId) {
          const u = list.find((c) => c.id === savedId && c.kind === 'user');
          if (u) setUser(toWxUser(u));
          else {
            window.localStorage.removeItem(sKey);
            setUser(null);
          }
        } else {
          setUser(null);
        }
      } catch {
        setUser(null);
      }
      setBooting(false);
    })();
    return () => {
      alive = false;
    };
  }, [loadContacts, toWxUser, accReloadKey]);

  const handleLogin = useCallback((u: WxUser) => {
    // 多账号 Task 41：登录身份落到对应账号作用域——自由登录可能是某个小号（档案 altOf），
    // 槽位登录已是本槽位（switchAccountFor 同 id no-op）；大号机主档案回 main。
    // 必须在写会话前切：事件驱动 boot 重跑时读到的已是新作用域的会话键。
    const accId = u.altOf || MAIN_ACCOUNT_ID;
    switchAccountFor('wx', accId);
    try {
      // 登录历史：切换账号列表只显示登录过的账号（Task 41）
      markAccountLoginHistory('wx', accId);
      // 登录成功 = 退出后的自由登录墙使命完成（标记在下次退出前不再出现）
      clearForceLoginWall('wx');
      window.localStorage.setItem(accLs(LS_SESSION, 'wx'), u.id);
    } catch {
      // 忽略
    }
    setUser(u);
  }, []);

  const handleLogout = useCallback(() => {
    setUser(null);
    // 登录态保持（2025）：退出只退「当前身份」，不删任何账号的会话键——
    // 其他已登录账号（含刚退出的这个）在切换账号页点击仍直接进入，无需重新输密码；
    // 退出后的自由登录墙持续到下一次登录成功（isForceLoginWallActive + handleLogin 清除）。
    // 多账号 Task 41：退出后回大号身份 + 自由登录墙——不显示「当前账号」、不锁定登录身份。
    requestForceLoginWall('wx');
    switchAccountFor('wx', MAIN_ACCOUNT_ID);
  }, []);

  if (booting) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center bg-[#EDEDED] dark:bg-[#111111]">
        <svg viewBox="0 0 40 40" className="h-16 w-16 opacity-90" aria-hidden="true">
          <path
            d="M15.5 6.5C9.1 6.5 4 10.8 4 16.1c0 3 1.7 5.7 4.4 7.5l-1.1 3.9 4.3-2.3c1.2.3 2.5.5 3.9.5h.8c-.2-.9-.3-1.8-.3-2.7 0-5.6 5.2-10.1 11.7-10.1.3 0 .5 0 .8.1C26.9 9.2 21.6 6.5 15.5 6.5z"
            fill="#3ECB5C"
          />
          <path
            d="M27.5 14.5c-5.6 0-10.2 3.9-10.2 8.7s4.6 8.7 10.2 8.7c1.1 0 2.2-.2 3.2-.4l3.8 2-1-3.5c2.2-1.6 3.6-4 3.6-6.8 0-4.8-4.6-8.7-9.6-8.7z"
            fill="#07C160"
          />
        </svg>
        <p className="mt-4 text-[13px] text-black/40 dark:text-white/40">微信</p>
      </div>
    );
  }

  if (!user) {
    // 小号/匿名号槽位：登录墙绑定当前槽位（显示账号名/预填账号/只认本槽位账密）；大号保持原自由登录
    const acc = getActiveAccountFor('wx');
    return <LoginScreen onLogin={handleLogin} slot={acc.kind === 'main' ? null : acc} />;
  }

  return (
    <div
      className="relative h-full w-full"
      data-rt-theme={retroRoot ? 'true' : 'false'}
      data-liquid-theme={liquidRoot ? 'true' : 'false'}
    >
      {/* 第五十六轮：古早/液态皮肤下发到共享子页（chat-settings 二级页 / 主动发消息 / 搜索页等） */}
      <ChatSkinProvider retro={retroRoot} liquid={liquidRoot}>
      <MainScreen
        me={user}
        contacts={contacts}
        myRealName={realNameById[user.id] ?? user.name}
        ownerName={ownerName}
        reloadContacts={reloadContacts}
        onLogout={handleLogout}
        onExit={closeApp}
        onLoginAccount={handleLogin}
      />
      {/* 扫一扫（+菜单 / 发现页入口；识别网页/文本/名片，演示语义） */}
      <ScanOverlayWhen flavor="wechat" />
      </ChatSkinProvider>
    </div>
  );
}
