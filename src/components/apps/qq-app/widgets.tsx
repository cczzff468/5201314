'use client';

/** 通用小部件（头像/元信息/头部/打卡/搜索/资料徽章） —— v1.9.27 任务10 从 qq.tsx 按功能域拆分；顶层声明全部导出供兄弟模块与入口桶引用。 */

import { useState } from 'react';
import { CalendarDays, ChevronRight, Flame, Search, SmilePlus } from 'lucide-react';
// v1.9.12 聊天滚动重做（全端共享）：进入即到底/发送必到底/贴底跟随/看历史时「有新消息」轻提示
// 美团×AI 联动：QQ 私聊与微信同构接入（规则注入+动作执行），历史里的代付/分享/代点卡片序列化为 AI 可读文本
// Task 40 错误提示优化：错误分类文案 + 连续失败冷却 + 错误详情（居中灰字提示行用，原始报错不直接展示）
// Task 40 草稿箱：输入框文本按会话隔离持久化（刷新/切会话回来不丢，发送成功清空；不进 AI 上下文）
// Task 40 错误提示行：失败消息位置渲染的居中灰字（点击重试/长按菜单）
// 第十六轮：AI 动态状态（情绪+作息）注入
import { // 【fix3-d-4】引擎统一动态视图：转发弹层用显式 author 判定原作者（不再按名字猜）
  listMomentPosts, // 【20-d】升级图重新生成（A2）：长按/右键升级过的真图打开弹层重绘（预填上次描述）
  regenerateMomentImage } from '@/lib/moments';
// v33【AI 真人社交】：X论坛近况感知块（TA 发的帖/我发的帖/评论互动 → 私聊能自然提起）
import { fmtMsgTime, readTextOf, type ChatDisplayConfig } from '@/lib/ios/chat-display';
import { StackFitText } from '../shrink-text';
// 深度思考：指令注入 + [思考]块剥离 + 开关（IndexedDB 按联系人隔离，渲染订阅版随设置页切换即时刷新）
// 多账号 v2（Task 40-2b）：kv 裸键自动按 qq 当前账号作用域；purge 限账号用 kvKeysByPrefix+kvDelRaw
import { kvGet, kvSet } from '@/lib/ios/idb-kv';
// 多账号（Task 40 v2）：注册表/切换/创建走 per-app accounts API；QQ 登录态等 LS 键每次经 accLs(key,'qq')
// 现算（大号原键，小号 --{id} 后缀）；切换账号不刷新网页，根组件监听 ACCOUNT_CHANGED_EVENT 重读
// 头像按 App 隔离：QQ 端读取/写入一律走 qq 槽位（listContactsFor 投影读取，updateContact 的 avatars 合并写入），不再共享联系人 App 的全局默认头像
// 古早主题（retro）：复古 Tab 图标 + 拟物图标底座 + 配色表（QQ 版）
// 生图（锁脸）：照片标签（[图片:描述]/[照片:描述]）提取/生成/规则构建（与微信端共用同一逻辑层，未配置/失败降级文字图片卡片）；
// 手动「文字图片」为卡片版（autoCardText），不走生图
// 【20-d】补充流式分段 carry-over 工具（splitUnfinishedPhotoTag/stripUnfinishedPhotoTag）：
// 流式把 [图片:xxx] 标签切成两段时跨段拼接还原 + 尾部半截标签兜底剥除（与微信/信息端同口径）

import { LS_QQ_CHECKIN, QQMsg, QQUser, localDateKey } from './core';

// ---------------- 通用小部件 ----------------

/** QQ 头像：默认圆形（有图用图，无图蓝底「Q」字兜底）；shape='rounded' = 圆角方形
 *  （显示设置 › 头像样式，仅聊天页传入；其余调用点保持 QQ 原生圆形） */
export function QqAvatar({
  src,
  alt,
  size = 44,
  shape,
}: {
  src: string | null;
  alt: string;
  size?: number;
  shape?: 'rounded' | 'circle';
}) {
  const radius = shape === 'rounded' ? Math.max(4, Math.round(size * 0.11)) : size / 2;
  const style: React.CSSProperties = { width: size, height: size, borderRadius: radius };
  if (src) {
    // draggable=false：防止按住头像拖动触发原生图片拖拽，避免打断聊天页右滑手势
    return <img src={src} alt={alt} draggable={false} className="shrink-0 bg-muted object-cover" style={style} />;
  }
  return (
    <div
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center bg-[#B9D9F3] font-semibold text-white"
      style={{ ...style, fontSize: Math.round(size * 0.42) }}
    >
      Q
    </div>
  );
}

/** 显示设置元信息适用性：系统类胶囊（sys/notice/拉黑申请）与已撤回消息不参与已读/时间显示 */
export const qqMetaOk = (m: QQMsg) => !m.recalled && m.kind !== 'sys' && m.kind !== 'notice' && m.kind !== 'blockreq';

/** 显示设置 › 已读回执：我发消息 = 我读了 TA 的全部未读消息（append 前统一走这里，纯函数） */
export const qqMarkPeerRead = (list: QQMsg[]): QQMsg[] =>
  list.map((x) => (x.role === 'peer' && x.unread ? { ...x, unread: false } : x));

/** 元信息小字统一样式（已读未读 / 时间）；已读浅灰 / 未读深灰（用户指定：未读弃品牌色），
 *  时间同样灰色（用户指定：弃继承正文黑）——与已读同浅灰，深色模式自适应。
 *  气泡下：nowrap 单行永不内部折行；头像下用 avatar 版（无 nowrap——StackFitText 兜底换行需要），
 *  超宽先缩字、放不下按空格/自然断点堆叠（日期一行、时间一行），绝不裁字 */
export const qqMetaText = 'whitespace-nowrap text-[10px] leading-[1.35]';
export const qqMetaAvatarText = 'text-[10px] leading-[1.35]';
export const qqMetaReadCls = 'text-black/35 dark:text-white/40';
export const qqMetaUnreadCls = 'text-black/60 dark:text-white/75';
export const qqMetaTimeCls = 'text-black/35 dark:text-white/40';

/** 显示设置 › 已读未读 + 时间：头像下方上下两行（已读未读在上、时间在下）。
 *  用户指定：文字超宽时字号自动变小、不向屏幕内侧延伸；对齐沿袭原锚定边（我的右对齐、TA 的左对齐）。
 *  长日期模板（yyyy/MM/dd HH:mm 等）缩到下限仍放不下时按空格/自然断点拆行堆叠，绝不裁字 */
export function QqMetaUnderAvatar({ m, cfg }: { m: QQMsg; cfg: ChatDisplayConfig }) {
  const showRead = cfg.readEnabled && cfg.readPosition === 'avatar' && qqMetaOk(m);
  const showTime = cfg.timeEnabled && cfg.timePosition === 'avatar' && qqMetaOk(m);
  if (!showRead && !showTime) return null;
  return (
    <span
      className={`mt-[3px] flex flex-col gap-y-[1px] leading-none self-stretch ${
        m.role === 'me' ? 'text-right' : 'text-left'
      }`}
    >
      {showRead && (
        <StackFitText
          testId={`qq-read-${m.id}`}
          className={`block w-full ${qqMetaAvatarText} ${m.unread ? qqMetaUnreadCls : qqMetaReadCls}`}
        >
          {readTextOf(cfg, m.unread === true)}
        </StackFitText>
      )}
      {showTime && (
        <StackFitText
          testId={`qq-time-${m.id}`}
          className={`block w-full ${qqMetaAvatarText} ${qqMetaTimeCls}`}
        >
          {fmtMsgTime(m.time, cfg.timeFormat)}
        </StackFitText>
      )}
    </span>
  );
}

/** 显示设置 › 已读未读 + 时间：气泡下方上下两行——靠气泡末尾（远离头像的一侧：我的=左下、TA的=右下，
 *  原生样式）；同显时上下堆叠（用户指定：已读未读在上、时间在下）。
 *  子项 nowrap：日期模板（yyyy/MM/dd HH:mm）等长格式也不内部折行。
 *  仅挂在文本气泡列（最常见消息形态） */
export function QqMetaUnderBubble({ m, cfg }: { m: QQMsg; cfg: ChatDisplayConfig }) {
  const showRead = cfg.readEnabled && cfg.readPosition === 'bubble' && qqMetaOk(m);
  const showTime = cfg.timeEnabled && cfg.timePosition === 'bubble' && qqMetaOk(m);
  if (!showRead && !showTime) return null;
  return (
    <span
      className={`mt-[3px] flex flex-col self-stretch gap-y-[1px] leading-none ${
        m.role === 'me' ? 'items-start' : 'items-end'
      }`}
    >
      {showRead && (
        <span
          data-testid={`qq-read-${m.id}`}
          className={`${qqMetaText} ${m.unread ? qqMetaUnreadCls : qqMetaReadCls}`}
        >
          {readTextOf(cfg, m.unread === true)}
        </span>
      )}
      {showTime && (
        <span data-testid={`qq-time-${m.id}`} className={`${qqMetaText} ${qqMetaTimeCls}`}>
          {fmtMsgTime(m.time, cfg.timeFormat)}
        </span>
      )}
    </span>
  );
}

/** 引用卡迷你缩略图（Task 30）：被引用的图片/表情在 QQ 引用卡里显示 36px 小图——
 *  加载失败自动隐藏（引用卡退回纯文字行，quote.content 兜底可读） */
export function QqQuoteThumb({ src, mine }: { src: string; mine: boolean }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <img
      src={src}
      alt="引用图片"
      data-testid="qq-quote-thumb"
      draggable={false}
      className={`h-9 w-9 shrink-0 rounded-[6px] object-cover ${mine ? 'bg-white/15' : 'bg-black/[0.06] dark:bg-white/10'}`}
      onError={() => setFailed(true)}
    />
  );
}

/** 居中 Toast（自动消失） */
export function QqToast({ text }: { text: string }) {
  return (
    <div className="pointer-events-none absolute left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-[8px] bg-black/75 px-4 py-2.5 text-[14px] text-white">
      {text}
    </div>
  );
}

/** 页头（消息/联系人/动态共用）：左圆头像 + 标题（消息页带在线状态），右侧动作 */
export function QqHeader({
  user,
  title,
  subtitle,
  onAvatar,
  action,
  retro = false,
}: {
  user: QQUser;
  title: string;
  subtitle?: React.ReactNode;
  onAvatar: () => void;
  action?: React.ReactNode;
  /** 古早主题（MainScreen 下发）：头部容器换银灰拟物导航条（rt-bar） */
  retro?: boolean;
}) {
  return (
    /* qq-head：QQ 页面头部（头像+大标题+右上按钮）锚点 */
    <div className={`qq-head flex items-center gap-3 px-4 pb-2 pt-1 ${retro ? 'rt-bar' : ''}`}>
      <button type="button" aria-label="个人资料" onClick={onAvatar} className="rounded-full active:opacity-70">
        <QqAvatar src={user.avatar} alt={user.name} size={44} />
      </button>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[20px] font-semibold leading-tight">{title}</div>
        {subtitle ?? null}
      </div>
      {action ?? null}
    </div>
  );
}

/** 打卡 + 状态 pills（深色半透明玻璃、白字、缩小版；个人中心抽屉与联系人页封面共用，打卡状态 localStorage 共享） */
export function QqCheckinPills({ testidPrefix, onToast }: { testidPrefix: string; onToast: (m: string) => void }) {
  const [checkin, setCheckin] = useState<{ last: string; streak: number }>(() => {
    try {
      const p: unknown = kvGet(LS_QQ_CHECKIN);
      if (p && typeof p === 'object') {
        const rec = p as { last?: unknown; streak?: unknown };
        if (typeof rec.last === 'string' && typeof rec.streak === 'number') return { last: rec.last, streak: rec.streak };
      }
    } catch {
      // 忽略
    }
    return { last: '', streak: 0 };
  });
  const checkedToday = checkin.last === localDateKey();
  // 当天首次点击记为已打卡并累计连续天数；断签重新从 1 开始
  const doCheckin = () => {
    if (checkedToday) {
      onToast('今天已经打过卡啦');
      return;
    }
    const yest = new Date();
    yest.setDate(yest.getDate() - 1);
    const streak = checkin.last === localDateKey(yest) ? checkin.streak + 1 : 1;
    const next = { last: localDateKey(), streak };
    setCheckin(next);
    try {
      kvSet(LS_QQ_CHECKIN, next);
    } catch {
      // 忽略
    }
    onToast(`打卡成功，已连续 ${streak} 天`);
  };
  return (
    <div className="flex items-center justify-between" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        data-testid={`${testidPrefix}-checkin`}
        onClick={doCheckin}
        className="flex h-8 items-center gap-1.5 rounded-full bg-black/40 px-3.5 text-[13px] font-medium text-white backdrop-blur-md transition-transform active:scale-95"
      >
        {checkedToday ? (
          <Flame className="h-[15px] w-[15px]" strokeWidth={2.2} aria-hidden="true" />
        ) : (
          <CalendarDays className="h-[15px] w-[15px]" strokeWidth={2.2} aria-hidden="true" />
        )}
        {checkedToday ? `已打卡 ${checkin.streak}天` : '打卡'}
      </button>
      <button
        type="button"
        data-testid={`${testidPrefix}-status`}
        onClick={() => onToast('状态暂未开放')}
        className="flex h-8 items-center gap-1.5 rounded-full bg-black/40 px-3.5 text-[13px] font-medium text-white backdrop-blur-md transition-transform active:scale-95"
      >
        <SmilePlus className="h-[15px] w-[15px]" strokeWidth={2.2} aria-hidden="true" />
        状态
      </button>
    </div>
  );
}

/** 在线状态行（消息页头像旁：绿点 + 在线 - WiFi） */
export function OnlineBadge() {
  return (
    <div className="mt-0.5 flex items-center gap-1 text-[12px] text-black/45 dark:text-white/45">
      <span className="inline-block h-[10px] w-[10px] rounded-full bg-[#26C84D]" aria-hidden="true" />
      在线 - WiFi
    </div>
  );
}

/** 搜索框（QQ 灰色胶囊） */
export function QqSearch({
  value,
  onChange,
  placeholder = '搜索',
  liquid = false,
  retro = false,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  /** 液态玻璃主题：搜索胶囊换 .lg-search 玻璃质感（tabs 页传入；设置页等不传保持原样） */
  liquid?: boolean;
  /** 古早主题：搜索胶囊换 .rt-search 白底内凹（6px 圆角） */
  retro?: boolean;
}) {
  return (
    /* qq-search：QQ 搜索框锚点（自定义 CSS 示例模板可改胶囊底色/圆角） */
    <div
      className={
        liquid
          ? 'qq-search flex h-[36px] items-center gap-1.5 rounded-full lg-search px-3'
          : retro
          ? 'qq-search flex h-[36px] items-center gap-1.5 rt-search px-3'
          : 'qq-search flex h-[36px] items-center gap-1.5 rounded-full bg-black/[0.05] px-3 dark:bg-white/[0.08]'
      }
    >
      <Search className="h-4 w-4 shrink-0 text-black/35 dark:text-white/35" strokeWidth={2.2} aria-hidden="true" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-full w-full bg-transparent text-[15px] outline-none placeholder:text-black/30 dark:placeholder:text-white/30"
      />
    </div>
  );
}


// ---------------- 资料页徽章（SVIP8 / QQ等级图标 / 勋章 / LV，对照真机截图） ----------------

/** 公用 defs（同页多个 SVG 引用同一渐变，路由互斥无 id 冲突） */
export function QqGoldDefs() {
  return (
    <svg width="0" height="0" className="absolute" aria-hidden="true">
      <defs>
        <linearGradient id="qq-gold-g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFE08A" />
          <stop offset="1" stopColor="#F0A711" />
        </linearGradient>
        <linearGradient id="qq-gold-deep" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFD76A" />
          <stop offset="1" stopColor="#DE8F0A" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/** QQ 等级图标组：皇冠（三顶珠+三红宝石）+ 太阳（三角光芒）+ 月亮（金系简约新月，共用金色渐变靠剪影区分）+ 星星×3，对照 QQ 真机 */
export function QqLevelIcons() {
  return (
    <span className="inline-flex items-center gap-[3px]" aria-hidden="true">
      <svg viewBox="0 0 24 24" className="h-[23px] w-[23px]">
        <circle cx="4.2" cy="6.8" r="1.7" fill="url(#qq-gold-deep)" stroke="#C8880A" strokeWidth="0.5" />
        <circle cx="12" cy="4.2" r="1.7" fill="url(#qq-gold-deep)" stroke="#C8880A" strokeWidth="0.5" />
        <circle cx="19.8" cy="6.8" r="1.7" fill="url(#qq-gold-deep)" stroke="#C8880A" strokeWidth="0.5" />
        <path
          d="M4.2 8.6l4.3 3.3 3.5-5.2 3.5 5.2 4.3-3.3-1.7 8.9H5.9z"
          fill="url(#qq-gold-g)"
          stroke="#C8880A"
          strokeWidth="0.7"
          strokeLinejoin="round"
        />
        <rect x="5.4" y="17.7" width="13.2" height="2.6" rx="1.3" fill="url(#qq-gold-deep)" stroke="#C8880A" strokeWidth="0.5" />
        <circle cx="12" cy="13.6" r="1.4" fill="#F5455C" stroke="#C43A4C" strokeWidth="0.4" />
        <circle cx="7.6" cy="15" r="0.85" fill="#F5455C" opacity="0.9" />
        <circle cx="16.4" cy="15" r="0.85" fill="#F5455C" opacity="0.9" />
      </svg>
      <svg viewBox="0 0 24 24" className="h-[23px] w-[23px]">
        <g fill="url(#qq-gold-deep)">
          {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
            <path key={a} d="M12 1.2l1.7 3.8h-3.4z" transform={`rotate(${a} 12 12)`} />
          ))}
        </g>
        <circle cx="12" cy="12" r="5.4" fill="url(#qq-gold-g)" stroke="#C8880A" strokeWidth="0.8" />
        <circle cx="12" cy="12" r="3.2" fill="#FFE9A8" opacity="0.55" />
      </svg>
      <svg viewBox="0 0 24 24" className="h-[20px] w-[20px]">
        {/* 月亮：金系简约新月——与皇冠/太阳/星星共用同一金色渐变（qq-gold-g），仅靠月牙剪影区分；无月晕/星芒/圆底等繁饰；尺寸略小（20px，用户要求月亮小一点） */}
        <path
          d="M20.8 13A9 9 0 1 1 11 3.2A7 7 0 0 0 20.8 13z"
          fill="url(#qq-gold-g)"
          stroke="#C8880A"
          strokeWidth="0.8"
          strokeLinejoin="round"
        />
        {/* 内缘一道柔光，呼应太阳内圈细节 */}
        <path d="M11 3.2A7 7 0 0 0 20.8 13" fill="none" stroke="#FFE9A8" strokeWidth="1" strokeLinecap="round" opacity="0.8" />
      </svg>
      {[0, 1, 2].map((i) => (
        <svg key={i} viewBox="0 0 24 24" className="h-[21px] w-[21px]">
          <path
            d="M12 2.8l2.6 5.6 6.1.7-4.5 4.1 1.2 6-5.4-3-5.4 3 1.2-6-4.5-4.1 6.1-.7z"
            fill="url(#qq-gold-g)"
            stroke="#C8880A"
            strokeWidth="0.7"
            strokeLinejoin="round"
          />
        </svg>
      ))}
    </span>
  );
}

/** 资料页徽章行（QQ 等级图标：皇冠+太阳+月亮+星星×3；SVIP8/勋章/LV8/LV3 徽章已按需求删除；padClass 控制左缩进） */
export function QqBadgeWall({ onOpen, mtClass, testid, padClass = '' }: { onOpen: () => void; mtClass: string; testid: string; padClass?: string }) {
  return (
    <div className={mtClass} data-testid={testid}>
      <QqGoldDefs />
      <button type="button" onClick={onOpen} className={`flex w-full items-center text-left active:opacity-70 ${padClass}`}>
        <span className="flex min-w-0 flex-1 items-center">
          <QqLevelIcons />
        </span>
        <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
      </button>
    </div>
  );
}
