'use client';

/**
 * QQ App：
 * - 登录（对照真实 QQ 登录页）：① 账号密码登录（QQ号/QID/邮箱 + QQ密码）② 手机号登录（+86 手机号 + QQ密码，
 *   实际校验密码仍用联系人 qqPassword 字段）；账号数据来自「联系人 App」本地 IndexedDB
 * - 仅 kind='user' 的联系人可登录；char / npc 账号一律拦截（「该账号类型暂不支持登录」），
 *   未注册账号 / 密码错误分别给出提示
 * - 登录后：消息 / 联系人 / 动态 三个 tab（对照 QQ 新版首页）
 *   ① 消息：会话列表（已加好友的联系人）+ AI 聊天（蓝/白气泡，流式回复）
 *   ② 联系人：新朋友 / 群通知 + 分组(特别关心/我的好友折叠) / 好友 / 群聊… 多 tab；右上人+ 进添加好友页（找人/找群 + 推荐）
 *   ③ 动态：空间动态（QQ空间信息流，可发帖/点赞）/ 游戏中心 / 小游戏 / QQ经典农场 / 结伴与附近 / 小说与动漫 / 意见反馈
 * - 左上头像 → 个人中心抽屉（顶部封面图与资料页同一张背景图，深色玻璃打卡/状态 pills 叠加封面；
 *   切换账号/个签/相册收藏…/设置入口；点击封面空白处关闭）
 *   抽屉头像 → 个人资料页（QQ号/可编辑个签/徽章/资料完成度/QQ空间/发消息；背景图可上传（IndexedDB 永久保存））
 *   抽屉「钱包」→ QQ钱包（对照真机：主页四宫格余额/Q币/领福利/微粒贷 + 金融理财/游戏娱乐/生活服务宫格；
 *   余额页（可用余额/转到微信/微信转入 + 充值/提现/银行卡 + 账单 + 支付设置）/小金库（金色渐变，转入转出联动余额；
 *   收益每日按七日年化 1.5120% 结算：累计收益/昨日收益/收益详情页[万份收益/近7日柱状图/每日收益记录]）/
 *   支付设置（支付密码开启/关闭/修改，微信风格 6 位自绘数字键盘；开启后红包/转账/充值/提现/小金库变动均先弹键盘验证）/
 *   我的银行卡（品牌渐变卡列表[芯片/闪付波纹/卡号分组] + 添加银行卡：持卡人预填 QQ 昵称、卡号一键生成
 *   [Luhn 校验、BIN 跟随银行]、金额自定义、卡类型/银行选择，仅存本机；点击卡片进银行卡详情：
 *   卡内余额/持卡人/卡号复制/银行/类型/添加时间）/提现（余额→可选到账银行卡）/充值（可选付款银行卡→余额，卡内余额校验）/账单流水；localStorage 持久化）
 *   设置 → 账号与安全（账号管理切换账号/账号关联/安全管理）；设置底部「退出当前账号」回登录页
 * - 聊天页对照 QQ 真机美化（名字+在线、蓝白圆气泡带头像、
 *   底部六图标工具栏：图片=相册选图、拍摄=input capture 直调手机原生相机（对齐微信，无自建取景）——
 *   选图先压缩进输入框下方待发预览条（最多 9 张可移除），点「发送」才真正发出并触发 AI 回复（发图先预览）；
 *   加号 → 底部弹出面板（语音通话/视频通话/红包/转账/位置），输入行跟随上浮；
 *   位置 → 发送位置页（内置常用地点 + 自定义位置表单，发送后聊天内出现位置卡片气泡）；
 *   红包 → 发红包页（普通/拼手气/专属 tab、祝福语、支付方式[余额/银行卡]、塞钱进红包）→ 聊天内红色 QQ红包卡片
 *   （企鹅+祝福语+開）→ 点击进红包详情（全屏沉浸红头直达状态栏+金色金额+手气最佳+领取列表）；
 *   转账 → 向好友转账页（头像/QQ号/金额/留言 0/12/支付方式）→ 蓝色转账卡片（已转入好友余额）→ 点击进交易详情
 *   （蓝圈对勾/金额/留言/时间）；开启支付密码后红包/转账/充值/提现/小金库变动先弹自绘数字键盘验证；
 *   红包/转账/位置消息随会话 localStorage 持久化，会话列表预览显示 [QQ红包]/[转账]/[图片]/[位置]）；
 *   页面任意位置水平左滑 → 好友标识页（成为好友N天/密友值/双头像心跳线/去绑定专属关系/我们的DNA：聊天小结/共同属性/友谊时间线三弹窗/幸运字符）；
 *   成为好友天数与密友值从 0 开始，按 QQ 规则增长：互发一条消息密友值 +2（每日上限 20），天数每日 +1
 * - 联系人点击 → 好友个人资料页（头像/QQ号/点赞/徽章/互动标识/他的QQ空间 + 音视频通话/送礼物/发消息）
 * - 添加好友页（找人/找群 + 七宫格 + 可能想认识的人）与「新朋友」页（同步通讯录/好友通知/可能想认识的人）
 *   为两个独立页面；搜索仅按 QQ 号匹配出联系人
 * - 空间动态全屏（顶部渐变区随页面滚动）；写说说页支持文字 + 照片（压缩后）发表
 * - 会话、空间帖子、评论、密友值、登录态 localStorage 持久化
 */


// v1.9.27 任务10 超大文件拆分：本文件收敛为 App 入口 QQApp + 桶（barrel）——实现按功能域拆至 ./qq-app/*，
// 对外导入路径与导出面不变（registry 动态导入 / 群聊页 / 美团 / 淘宝等外部消费方零改动）。
export * from './qq-app/core';
export * from './qq-app/widgets';
export * from './qq-app/login';
export * from './qq-app/stickers';
export * from './qq-app/chat-page';
export * from './qq-app/cards';
export * from './qq-app/pages';
export * from './qq-app/zone';
export * from './qq-app/wallet';
export * from './qq-app/wallet-pages';
export * from './qq-app/main';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSettings } from '@/lib/ios/store';
// v1.9.12 聊天滚动重做（全端共享）：进入即到底/发送必到底/贴底跟随/看历史时「有新消息」轻提示
import { ScanOverlayWhen } from './mt-scan';
import { purgeDeliveryQueueByPrefix } from '@/lib/ios/ai-delivery';
// 美团×AI 联动：QQ 私聊与微信同构接入（规则注入+动作执行），历史里的代付/分享/代点卡片序列化为 AI 可读文本
// Task 40 错误提示优化：错误分类文案 + 连续失败冷却 + 错误详情（居中灰字提示行用，原始报错不直接展示）
// Task 40 草稿箱：输入框文本按会话隔离持久化（刷新/切会话回来不丢，发送成功清空；不进 AI 上下文）
// Task 40 错误提示行：失败消息位置渲染的居中灰字（点击重试/长按菜单）
import { abortStreamsByPrefix } from '@/lib/chat-stream-store';
// 第十六轮：AI 动态状态（情绪+作息）注入
import { // 【fix3-d-4】引擎统一动态视图：转发弹层用显式 author 判定原作者（不再按名字猜）
  listMomentPosts, // 【20-d】升级图重新生成（A2）：长按/右键升级过的真图打开弹层重绘（预填上次描述）
  regenerateMomentImage } from '@/lib/moments';
// v33【AI 真人社交】：X论坛近况感知块（TA 发的帖/我发的帖/评论互动 → 私聊能自然提起）
import { isLiquidTheme, isRetroTheme } from '@/lib/ios/bubble-style';
import { ChatSkinProvider } from '@/lib/ios/chat-skin';
// 深度思考：指令注入 + [思考]块剥离 + 开关（IndexedDB 按联系人隔离，渲染订阅版随设置页切换即时刷新）
// 多账号 v2（Task 40-2b）：kv 裸键自动按 qq 当前账号作用域；purge 限账号用 kvKeysByPrefix+kvDelRaw
import { kvGet, kvSet } from '@/lib/ios/idb-kv';
// 多账号（Task 40 v2）：注册表/切换/创建走 per-app accounts API；QQ 登录态等 LS 键每次经 accLs(key,'qq')
// 现算（大号原键，小号 --{id} 后缀）；切换账号不刷新网页，根组件监听 ACCOUNT_CHANGED_EVENT 重读
import { ACCOUNT_CHANGED_EVENT, MAIN_ACCOUNT_ID, accLs, clearForceLoginWall, getActiveAccountFor, isForceLoginWallActive, markAccountLoginHistory, requestForceLoginWall, switchAccountFor } from '@/lib/ios/accounts';
// 头像按 App 隔离：QQ 端读取/写入一律走 qq 槽位（listContactsFor 投影读取，updateContact 的 avatars 合并写入），不再共享联系人 App 的全局默认头像
import { listContactsFor } from '@/lib/ios/contacts-store';
// 古早主题（retro）：复古 Tab 图标 + 拟物图标底座 + 配色表（QQ 版）
// 生图（锁脸）：照片标签（[图片:描述]/[照片:描述]）提取/生成/规则构建（与微信端共用同一逻辑层，未配置/失败降级文字图片卡片）；
// 手动「文字图片」为卡片版（autoCardText），不走生图
// 【20-d】补充流式分段 carry-over 工具（splitUnfinishedPhotoTag/stripUnfinishedPhotoTag）：
// 流式把 [图片:xxx] 标签切成两段时跨段拼接还原 + 尾部半截标签兜底剥除（与微信/信息端同口径）
import { displayNameOf, liveAvatarOf, withDisplayNames, socialNameOf } from '@/lib/contacts';
import type { ContactRecord } from '@/lib/contacts';
import { runFriendReqCatchUp, FRIEND_STATE_APPLIED_EVENT } from '@/lib/ios/friend-state';
import { setGroupSocialContacts } from '@/lib/ios/group-social';

import { LS_SESSION, QQUser, bumpQqSessionEpoch, consumedQqAiEvents, qqQueueReload } from './qq-app/core';
import { LoginScreen } from './qq-app/login';
import { MainScreen, QQ_LAST_LOGIN_ID_KEY, purgeQqSessionData } from './qq-app/main';
import { QqToast } from './qq-app/widgets';

// ---------------- App 入口 ----------------

export default function QQApp() {
  // 第五十五轮（用户指定「所有界面都变化」）：主题作用域挂到 App 根 wrapper——
  // data-rt-theme / data-liquid-theme 触发 globals.css 里的 scoped 批量接管，
  // 覆盖主界面/聊天页/全部子页与弹层（页面底/白色卡/按钮/菜单），子页无需逐个改 JSX
  const bubbleStyleRoot = useSettings((s) => s.bubbleStyle);
  const retroRoot = isRetroTheme(bubbleStyleRoot, 'qq');
  const liquidRoot = isLiquidTheme(bubbleStyleRoot, 'qq');
  const [booting, setBooting] = useState(true);
  const [user, setUser] = useState<QQUser | null>(null);
  const [contacts, setContacts] = useState<ContactRecord[]>([]);

  // 群社交：把联系人快照喂给 group-social（建群/拉人名单、被踢通知的宿主侧数据源）
  useEffect(() => {
    setGroupSocialContacts(contacts);
  }, [contacts]);

  // 删好友后 AI 主动申请加回：定时器不跨刷新，QQ 挂载时扫描删除状态按冷却补跑
  useEffect(() => {
    runFriendReqCatchUp();
  }, []);

  // 多账号 v2（Task 40-2b，不刷新的关键）：切换 QQ 账号不刷新网页——监听切换事件：
  // ① 会话纪元递增，旧账号已调度的延迟回调（来电定时器/通话尾巴/分段投递闭包）整体作废；
  // ② 中断 qq 在途流 + 清投递队列（旧账号回复不再落盘）；
  // ③（Task 42 起移除）未读/flags 总线已按账号作用域化并自带切换重载，无需再清
  // ④ 已消费转发事件登记清空（旧账号登记会吞新账号同文事件的回应）；
  // ⑤ 排队补跑内存队列重读新账号快照；
  // ⑥ bump accReloadKey → 启动加载 effect 重跑（联系人重读 + 按新账号作用域恢复登录态，无登录态 → 登录页）
  //   + remount 主界面回到消息列表主 tab（子页全关、各页挂载重读当前账号数据）。
  // wx/sms/phone 的账号切换与本 App 无关，忽略
  const [accReloadKey, setAccReloadKey] = useState(0);
  // 账号切换 toast（规则五.1：切换要有 UI 提示）：挂在根组件上，remount 后仍能看到
  const [switchToast, setSwitchToast] = useState<string | null>(null);
  const switchToastTimer = useRef<number | null>(null);
  useEffect(() => {
    const fn = (e: Event) => {
      const d = (e as CustomEvent<{ app?: string; id?: string }>).detail;
      if (!d || d.app !== 'qq') return;
      bumpQqSessionEpoch();
      abortStreamsByPrefix('qq:');
      purgeDeliveryQueueByPrefix('qq:');
      try {
        consumedQqAiEvents.clear();
      } catch {
        // 忽略
      }
      qqQueueReload();
      // 切换提示：档案展示名优先，大号回退「机主」（登录成功/删除自动切回也一并提示）
      try {
        const acc = getActiveAccountFor('qq');
        setSwitchToast(`已切换到 ${acc.id === MAIN_ACCOUNT_ID ? '机主' : acc.name || '新账号'}`);
        if (switchToastTimer.current) window.clearTimeout(switchToastTimer.current);
        switchToastTimer.current = window.setTimeout(() => setSwitchToast(null), 1800);
      } catch {
        // 忽略
      }
      setAccReloadKey((k) => k + 1);
    };
    window.addEventListener(ACCOUNT_CHANGED_EVENT, fn);
    return () => window.removeEventListener(ACCOUNT_CHANGED_EVENT, fn);
  }, []);

  // 启动 / 账号切换重跑：拉联系人 + 恢复登录态（联系人被删则自动登出；QQ 内显示昵称，昵称优先于真实名字）。
  // 登录态键按 QQ 当前账号作用域（Task 40-2b：accLs 调用时现算，大号=原键旧登录态不丢）；
  // 切换账号（accReloadKey 变化）重跑时：无登录态/联系人缺失 → 显式回登录页，杜绝上一账号的界面残留。
  useEffect(() => {
    let alive = true;
    (async () => {
      // 匿名号只属于电话/信息（Task 40-S）：历史遗留的 QQ 匿名号槽位开机自愈切回大号
      //（switchAccountFor 派发事件 → 上方监听器 bump accReloadKey 重跑本 effect）
      if (getActiveAccountFor('qq').kind === 'anon') {
        switchAccountFor('qq', MAIN_ACCOUNT_ID);
        return;
      }
      // 多账号 Task 41：退出登录后的自由登录墙——本次启动不恢复任何会话，
      // 直接进自由登录（不显示/不锁定「当前账号」，想登哪个登哪个）。
      // 2025 补充（登录态保持）：只检查不消费——标记持续到下一次登录成功（handleLogin 清除），
      // 「退出 → 关掉 App → 再打开」仍是自由登录墙；登录过一次后所有账号免登录切换。
      if (isForceLoginWallActive('qq')) {
        if (!alive) return;
        setUser(null);
        setBooting(false);
        return;
      }
      // 头像按 App 隔离：加载读 qq 槽位投影（登录恢复/账号信息展示均用该头像）
      const raw = await listContactsFor('qq').catch(() => [] as ContactRecord[]);
      if (!alive) return;
      // 备注按 App 隔离（第四十八轮）：QQ 里设置的备注只写 remarks.qq——展示名解析走 qq 槽位，微信/信息不受影响
      const list = withDisplayNames(raw, { social: true, app: 'qq' });
      setContacts(list);
      try {
        const savedId = window.localStorage.getItem(accLs(LS_SESSION, 'qq'));
        // Task 40 修正：小号/匿名号槽位的会话必须指向本槽位档案联系人——
        // 历史串槽登录态（在 A 小号槽位登了 B 的账密）在此自愈清除，避免切号页显示错账号
        const acc = getActiveAccountFor('qq');
        // Task 41 补强：大号作用域的会话指向了小号/匿名号档案（历史串槽残留）→ 清除回自由登录
        if (savedId && acc.kind === 'main') {
          const saved = raw.find((c) => c.id === savedId && c.kind === 'user');
          if (saved?.altOf) {
            window.localStorage.removeItem(accLs(LS_SESSION, 'qq'));
            setUser(null);
            setBooting(false);
            return;
          }
        }
        const slotProfile =
          acc.kind !== 'main' && savedId
            ? raw.find((c) => c.kind === 'user' && (c.altOf === acc.id || c.id === acc.ownerContactId))
            : null;
        if (savedId && acc.kind !== 'main' && (!slotProfile || slotProfile.id !== savedId)) {
          window.localStorage.removeItem(accLs(LS_SESSION, 'qq'));
          setUser(null);
        } else {
          const u = savedId ? raw.find((c) => c.id === savedId && c.kind === 'user') : undefined;
          if (u) {
            // 2025（小号加好友 AI 决策）：会话恢复必须带 altOf——登录时存入的 altOf 会被
            // 账号切换事件触发的 boot 重跑（此处）覆盖，丢失后小号加好友会走错「发送即通过」旧链路
            setUser({ id: u.id, name: displayNameOf(u), realName: u.name, nickname: u.nickname ?? null, avatar: u.avatar, qqId: u.qqId, phone: u.phone, persona: u.persona, altOf: u.altOf ?? null });
          } else {
            if (savedId) window.localStorage.removeItem(accLs(LS_SESSION, 'qq'));
            setUser(null);
          }
        }
      } catch {
        setUser(null);
      }
      setBooting(false);
    })();
    return () => {
      alive = false;
    };
  }, [accReloadKey]);

  const handleLogin = useCallback((u: QQUser) => {
    // 多账号 Task 41：登录身份先落到对应账号作用域——自由登录可能是某个小号（档案 altOf），
    // 槽位登录已是本槽位（no-op）；大号机主档案回 main。必须先切再 purge：
    // purgeQqSessionData 只清「当前作用域」的键，切号后正确落新账号（不会误清前一账号数据）。
    const accId = u.altOf || MAIN_ACCOUNT_ID;
    switchAccountFor('qq', accId);
    // #11 换账号登录防串号：当前作用域上次登录的是另一个账号时，先清掉该作用域的全部 QQ 会话态数据
    //（聊天记录/空间动态/钱包/未读角标等，见 purgeQqSessionData）再进入新身份；
    // 首次登录（无存储 id）只记录不清；同一账号重登不清（登出本就不删数据，重登应恢复）
    try {
      const lastId = kvGet<string>(QQ_LAST_LOGIN_ID_KEY);
      if (lastId && lastId !== u.id) purgeQqSessionData();
    } catch {
      // 忽略
    }
    try {
      kvSet(QQ_LAST_LOGIN_ID_KEY, u.id);
    } catch {
      // 忽略
    }
    setUser(u);
    try {
      // 登录历史：切换账号列表只显示登录过的账号（Task 41）
      markAccountLoginHistory('qq', accId);
      // 登录成功 = 退出后的自由登录墙使命完成（标记在下次退出前不再出现）
      clearForceLoginWall('qq');
      window.localStorage.setItem(accLs(LS_SESSION, 'qq'), u.id);
    } catch {
      // 忽略
    }
  }, []);

  const handleLogout = useCallback(() => {
    setUser(null);
    // 登录态保持（2025）：退出只退「当前身份」，不删任何账号的会话键——
    // 其他已登录账号（含刚退出的这个）在切换账号界面点击仍直接进入，无需重新输密码；
    // 退出后的自由登录墙持续到下一次登录成功（isForceLoginWallActive + handleLogin 清除）。
    // 多账号 Task 41：退出后回大号身份 + 自由登录墙——不显示「当前账号」、不锁定登录身份。
    requestForceLoginWall('qq');
    switchAccountFor('qq', MAIN_ACCOUNT_ID);
  }, []);

  // 添加好友后刷新联系人列表（同步换成昵称展示名——机主同规则 socialNameOf；头像按 App 隔离读 qq 槽位投影；
  // 备注按 App 隔离读 qq 槽位——第四十八轮）；返回投影列表供「我」快照同步复用
  const refreshContacts = useCallback(async (): Promise<ContactRecord[]> => {
    const raw = await listContactsFor('qq').catch(() => [] as ContactRecord[]);
    setContacts(withDisplayNames(raw, { social: true, app: 'qq' }));
    return raw;
  }, []);

  // 换头像跨 App 即时生效（引用式架构）：头像只在联系人资料存一份，渲染端 liveAvatarOf 实时解析；
  // 其他 App（联系人/微信/信息/电话）改了头像时刷新本端联系人缓存，打开中的空间/聊天页立刻显示新头像。
  // contact-updated：任意资料字段（名字/手机号/昵称/人设…）变更也刷新——编辑联系人不换头像时
  // QQ 端不再持旧快照（会话列表/资料页/登录解析保持最新）。
  // 「我」快照同步（编辑自己修复）：user 是开机/登录时 from 联系人的快照——机主在联系人 App
  // 改了自己头像/名字后，聊天/空间等处的「我」仍持旧值；这里随重载按最新联系人重派生
  useEffect(() => {
    const fn = () =>
      void refreshContacts().then((raw) => {
        setUser((prev) => {
          if (!prev) return prev;
          const u = raw.find((c) => c.id === prev.id && c.kind === 'user');
          return u
            ? { id: u.id, name: displayNameOf(u), realName: u.name, nickname: u.nickname ?? null, avatar: u.avatar, qqId: u.qqId, phone: u.phone, persona: u.persona, altOf: u.altOf ?? null }
            : prev;
        });
      });
    window.addEventListener('contact-avatar-changed', fn);
    window.addEventListener('contact-updated', fn);
    return () => {
      window.removeEventListener('contact-avatar-changed', fn);
      window.removeEventListener('contact-updated', fn);
    };
  }, [refreshContacts]);

  // 小号加好友 AI 决策落盘（2025）：同意 = 好友标记变化 → 刷新联系人（联系人列表即时出现）；
  // 拒绝/先回复不改变好友标记，刷新无副作用
  useEffect(() => {
    const fn = () => void refreshContacts();
    window.addEventListener(FRIEND_STATE_APPLIED_EVENT, fn);
    return () => window.removeEventListener(FRIEND_STATE_APPLIED_EVENT, fn);
  }, [refreshContacts]);

  // 个签等本地资料更新（同步到 QQUser，落库在调用方完成）
  const handlePatchUser = useCallback((patch: Partial<QQUser>) => {
    setUser((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  if (booting) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-b from-[#EAE6F6] via-[#E4EBF7] to-[#E7F0F9] dark:from-[#23253A] dark:via-[#20293A] dark:to-[#1E2A38]">
        <svg viewBox="0 0 40 40" className="h-16 w-16" aria-hidden="true">
          {/* 简化 QQ 企鹅（启动图） */}
          <ellipse cx="20" cy="17" rx="11" ry="12" fill="#2B2B33" />
          <ellipse cx="20" cy="22" rx="7.2" ry="7.6" fill="#fff" />
          <circle cx="15.8" cy="13.5" r="2.6" fill="#fff" />
          <circle cx="24.2" cy="13.5" r="2.6" fill="#fff" />
          <circle cx="16.3" cy="13.9" r="1.15" fill="#20242B" />
          <circle cx="23.7" cy="13.9" r="1.15" fill="#20242B" />
          <path d="M15.5 17.6c1.4 1.5 7.6 1.5 9 0 .9 1.4-1.6 4-4.5 4s-5.4-2.6-4.5-4z" fill="#FFA611" />
          <rect x="13" y="26.5" width="14" height="4" rx="2" fill="#F5455C" />
        </svg>
        <p className="mt-4 text-[13px] text-black/40 dark:text-white/40">QQ</p>
      </div>
    );
  }

  if (!user) {
    // 小号/匿名号槽位：登录墙绑定当前槽位（显示账号名/预填账号/只认本槽位账密）；大号保持原自由登录
    const acc = getActiveAccountFor('qq');
    return (
      <>
        <LoginScreen onLogin={handleLogin} slot={acc.kind === 'main' ? null : acc} />
        {switchToast && <QqToast text={switchToast} />}
      </>
    );
  }

  // key={accReloadKey}：切换 QQ 账号后 remount 主界面——route 归位消息 tab、子页全关、各页挂载重读当前账号数据
  return (
    <div
      className="relative h-full w-full"
      data-rt-theme={retroRoot ? 'true' : 'false'}
      data-liquid-theme={liquidRoot ? 'true' : 'false'}
    >
      {/* 第五十六轮：古早/液态皮肤下发到共享子页（chat-settings 二级页 / 主动发消息等） */}
      <ChatSkinProvider retro={retroRoot} liquid={liquidRoot}>
        <MainScreen key={accReloadKey} me={user} contacts={contacts} onLogout={handleLogout} onPatchUser={handlePatchUser} refreshContacts={refreshContacts} onLoginAccount={handleLogin} />
        {/* 账号切换提示（规则五.1）：挂在根组件，remount 后依然可见 */}
        {switchToast && <QqToast text={switchToast} />}
        {/* 扫一扫（+菜单 / 加好友页入口；识别网页/文本/群二维码，演示语义） */}
        <ScanOverlayWhen flavor="qq" />
      </ChatSkinProvider>
    </div>
  );
}
