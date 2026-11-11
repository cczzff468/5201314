'use client';

/** 通用小部件（头像/元信息/菜单行/伪二维码/液态玻璃小组件） —— v1.9.27 任务10 从 wechat.tsx 按功能域拆分；顶层声明全部导出供兄弟模块与入口桶引用。 */

import { useMemo, useState } from 'react';
import { AudioLines, ChevronRight, Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { useSettings, useUI } from '@/lib/ios/store';
// v1.9.12 聊天滚动重做（全端共享）：进入即到底/发送必到底/贴底跟随/看历史时「有新消息」轻提示
// Task 40 错误提示优化 + 草稿箱：错误分类与连续失败冷却、会话草稿持久化、失败灰字提示行组件
import { songCover } from '@/lib/ios/music-api';
import { useMusic, mediaProxyUrl } from '@/lib/ios/music-store';
// 美团×AI 联动（外卖参与/双向代付）：动作执行、上下文块、历史序列化
// 深度思考：指令注入 + [思考]块剥离 + 开关（IndexedDB 按联系人隔离，渲染订阅版随设置页切换即时刷新）
// v1.3 Shizuku 自主权：[手机操作:命令] 标记的执行器 + 按开关动态注入的教学规则（设置 APP → AI 动手）
// 第十六轮：AI 动态状态（情绪+作息）注入 + 送礼物情绪事件
// v33【AI 真人社交】：X论坛近况感知块（TA 发的帖/我发的帖/评论互动 → 私聊能自然提起）
import { fmtMsgTime, readTextOf, type ChatDisplayConfig } from '@/lib/ios/chat-display';
import { StackFitText } from '../shrink-text';
// 多账号 v2（Task 40-2a）：per-app 账号 API——accLs 键作用域调用时现算；switchAccountFor 切换只写标记+派发事件（不刷新网页）
// 第三十四轮：添加账号弹层（AccountAddSheet）删除——「添加账号」改为直接用账号密码登录（LoginScreen）
// v73 AI 聊天悬浮小窗：顶栏「小窗模式」按钮入口（打开全局小窗并退出全屏聊天）

import { WxMsg, WxUser } from './core';

// ---------------- 通用小部件 ----------------

/** 微信行内图标方块（功能行用） */
export function WxTileIcon({ bg, children }: { bg: string; children: React.ReactNode }) {
  return (
    <div
      className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[8px] text-white shadow-sm"
      style={{ backgroundColor: bg }}
      aria-hidden="true"
    >
      {children}
    </div>
  );
}

/** 头像：默认微信风格「正方形圆角」（有图用图，无图用灰底剪影）；shape='circle' = 圆形
 *  （显示设置 › 头像样式，仅聊天页传入；其余调用点保持微信原生圆角方形） */
export function WxAvatar({
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
  const radius = shape === 'circle' ? size / 2 : Math.max(4, Math.round(size * 0.11));
  const style: React.CSSProperties = { width: size, height: size, borderRadius: radius };
  if (src) {
    return <img src={src} alt={alt} className="shrink-0 bg-muted object-cover" style={style} />;
  }
  return (
    <div
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center bg-[#C9C9CE] text-white dark:bg-[#3C3C42]"
      style={style}
    >
      <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: size * 0.6, height: size * 0.6 }}>
        <circle cx="12" cy="8.2" r="4.3" />
        <path d="M12 14.1c-4.7 0-8.1 2.7-8.1 6.3 0 .9.7 1.6 1.6 1.6h13c.9 0 1.6-.7 1.6-1.6 0-3.6-3.4-6.3-8.1-6.3z" />
      </svg>
    </div>
  );
}

/** 显示设置元信息适用性：系统类胶囊（sys/notice/拉黑申请）与已撤回消息不参与已读/时间显示 */
export const wxMetaOk = (m: WxMsg) => !m.recalled && m.kind !== 'sys' && m.kind !== 'notice' && m.kind !== 'blockreq';

/** 显示设置 › 已读回执：我发消息 = 我读了 TA 的全部未读消息（append 前统一走这里，纯函数） */
export const markPeerRead = (list: WxMsg[]): WxMsg[] =>
  list.map((x) => (x.role === 'peer' && x.unread ? { ...x, unread: false } : x));

/** 元信息小字统一样式（已读未读 / 时间；颜色由 style 覆盖未读态）。
 *  头像下：超宽先缩字、放不下按自然断点堆叠（StackFitText）；气泡下：nowrap 单行不内部折行 */
export const wxMetaText = 'text-[10px] leading-[1.35] text-black/40 dark:text-white/40';

/** 元信息小字：已读浅灰 / 未读深灰（用户指定：未读弃品牌色，灰色系双阶区分） */
export const wxMetaReadCls = 'text-black/35 dark:text-white/40';
export const wxMetaUnreadCls = 'text-black/60 dark:text-white/75';

/** 显示设置 › 已读未读 + 时间：头像下方上下两行（已读未读在上、时间在下）。
 *  用户指定：文字超宽时字号自动变小、不向屏幕内侧延伸；对齐沿袭原锚定边（我的右对齐、TA 的左对齐）。
 *  长日期模板（yyyy/MM/dd HH:mm 等）缩到下限仍放不下时改用 StackFitText——
 *  按空格/自然断点拆行堆叠（日期一行、时间一行），每行独立缩字，绝不裁字「显示不全」 */
export function WxMetaUnderAvatar({ m, cfg }: { m: WxMsg; cfg: ChatDisplayConfig }) {
  const showRead = cfg.readEnabled && cfg.readPosition === 'avatar' && wxMetaOk(m);
  const showTime = cfg.timeEnabled && cfg.timePosition === 'avatar' && wxMetaOk(m);
  if (!showRead && !showTime) return null;
  return (
    <span
      className={`mt-[3px] flex flex-col gap-y-[1px] leading-none self-stretch ${
        m.role === 'me' ? 'text-right' : 'text-left'
      }`}
    >
      {showRead && (
        <StackFitText
          testId={`wx-read-${m.id}`}
          className={`block w-full ${wxMetaText} ${m.unread ? wxMetaUnreadCls : wxMetaReadCls}`}
        >
          {readTextOf(cfg, m.unread === true)}
        </StackFitText>
      )}
      {showTime && (
        <StackFitText testId={`wx-time-${m.id}`} className={`block w-full ${wxMetaText}`}>
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
export function WxMetaUnderBubble({ m, cfg }: { m: WxMsg; cfg: ChatDisplayConfig }) {
  const showRead = cfg.readEnabled && cfg.readPosition === 'bubble' && wxMetaOk(m);
  const showTime = cfg.timeEnabled && cfg.timePosition === 'bubble' && wxMetaOk(m);
  if (!showRead && !showTime) return null;
  return (
    <span
      className={`mt-[3px] flex flex-col self-stretch gap-y-[1px] leading-none ${
        m.role === 'me' ? 'items-start' : 'items-end'
      }`}
    >
      {showRead && (
        <span
          data-testid={`wx-read-${m.id}`}
          className={`whitespace-nowrap ${wxMetaText} ${m.unread ? wxMetaUnreadCls : wxMetaReadCls}`}
        >
          {readTextOf(cfg, m.unread === true)}
        </span>
      )}
      {showTime && (
        <span data-testid={`wx-time-${m.id}`} className={`whitespace-nowrap ${wxMetaText}`}>
          {fmtMsgTime(m.time, cfg.timeFormat)}
        </span>
      )}
    </span>
  );
}

/** 引用块迷你缩略图（Task 30）：被引用的图片/表情在引用胶囊里显示 36px 小图——
 *  加载失败自动隐藏（引用块退回纯文字行，quote.content 兜底可读） */
export function WxQuoteThumb({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <img
      src={src}
      alt={alt}
      data-testid="wx-quote-thumb"
      className="h-9 w-9 shrink-0 rounded-[3px] bg-black/[0.05] object-cover dark:bg-white/10"
      onError={() => setFailed(true)}
    />
  );
}

/** 微信引用胶囊（Task 30；从文本气泡抽出复用）：挂在气泡下方「名字：内容」半透明胶囊——
 *  文字/语音/图片/表情各类气泡统一用它渲染 m.quote（语音条升级不吞引用块）；
 *  图片/表情源显示迷你缩略图、语音源显示语音图标+时长；源消息已删/撤回或图挂掉退回纯文字 */
export function WxQuoteBlock({ quote, srcMsg }: { quote: NonNullable<WxMsg['quote']>; srcMsg: WxMsg | null }) {
  const qThumb = srcMsg && !srcMsg.recalled ? ((srcMsg.kind === 'image' ? srcMsg.img?.src : srcMsg.kind === 'sticker' ? srcMsg.stk?.url : null) ?? null) : null;
  const qVoice = srcMsg && !srcMsg.recalled && srcMsg.kind === 'voice' ? (srcMsg.voice ?? null) : null;
  return (
    <div
      data-testid="wx-quote-block"
      className="mt-[3px] max-w-full overflow-hidden rounded-[4px] border border-black/15 bg-white/75 px-2 py-[3px] text-[12px] leading-[1.4] text-black/50 dark:border-white/15 dark:bg-white/[0.13] dark:text-white/60"
    >
      {qThumb ? (
        <div className="flex items-center gap-2" data-testid="wx-quote-thumb-row">
          <span className="min-w-0 flex-1 truncate">{quote.name}：{quote.content}</span>
          <WxQuoteThumb src={qThumb} alt="引用图片" />
        </div>
      ) : qVoice ? (
        <div className="flex items-center gap-1.5" data-testid="wx-quote-voice-row">
          <AudioLines className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
          <span className="min-w-0 flex-1 truncate">{quote.name}：[语音]{qVoice.duration ? ` ${qVoice.duration}"` : ''}</span>
        </div>
      ) : (
        <p className="line-clamp-2 whitespace-pre-wrap break-all">{quote.name}：{quote.content}</p>
      )}
    </div>
  );
}

/** 微信风格功能行：白色卡片内，分隔线与文字对齐（左缩进 66px） */
export function WxMenuRow({
  label,
  icon,
  onClick,
  first = false,
  right,
  redDot = false,
  badge,
  testId,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  first?: boolean;
  right?: React.ReactNode;
  redDot?: boolean;
  /** 未读数角标（红色圆点数字，紧随标题之后；同真机「发现→朋友圈 3」样式） */
  badge?: number;
  testId?: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      /* wx-menu-row：发现/我/通讯录的菜单行锚点（自定义 CSS 示例模板可改行底/分割线/文字） */
      className="wx-menu-row relative flex w-full items-center gap-3 px-4 py-[11px] text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
    >
      {!first && <span className="absolute left-[66px] right-0 top-0 h-px bg-black/[0.05] dark:bg-white/[0.08]" aria-hidden="true" />}
      {icon}
      <span className="min-w-0 flex-1 truncate text-[16px]">{label}</span>
      {typeof badge === 'number' && badge > 0 && (
        <span
          data-testid={testId ? `${testId}-badge` : undefined}
          aria-label={`${badge} 条新消息`}
          className="mr-0.5 flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-[#FA5151] px-[5px] text-[10.5px] font-semibold leading-none text-white"
        >
          {badge > 99 ? '99+' : badge}
        </span>
      )}
      {redDot && <span className="mr-0.5 h-2 w-2 shrink-0 rounded-full bg-[#FA5151]" aria-hidden="true" />}
      {right ?? <ChevronRight className="h-[18px] w-[18px] shrink-0 text-black/25 dark:text-white/25" strokeWidth={2} />}
    </button>
  );
}

/** 「···」更多图标（微信风格） */
export function EllipsisGlyph() {
  return (
    <span className="flex items-center gap-[3px]" aria-hidden="true">
      <span className="h-[4px] w-[4px] rounded-full bg-current opacity-70" />
      <span className="h-[4px] w-[4px] rounded-full bg-current opacity-70" />
      <span className="h-[4px] w-[4px] rounded-full bg-current opacity-70" />
    </span>
  );
}

/** 语音声波图标（聊天输入栏左侧圆钮用，单色细线：一个点 + 三道渐展声波弧，微信风格） */
export function VoiceWaveGlyph({ size = 19 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="6.2" cy="12" r="1.35" fill="currentColor" stroke="none" />
      {/* 三道弧 = 以圆点为圆心的同心圆弧段，半径渐增、张角渐收，弧线更流畅对称 */}
      <path d="M9.03 8.38A4.6 4.6 0 0 1 9.03 15.62" />
      <path d="M11.69 5.91A8.2 8.2 0 0 1 11.69 18.09" />
      <path d="M14.68 3.8A11.8 11.8 0 0 1 14.68 20.2" />
    </svg>
  );
}

/** 键盘图标（语音模式圆钮用：六枚圆角键 + 空格条，点按切回键盘输入） */
export function KeyboardGlyph({ size = 17 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      {[0, 1].map((row) =>
        [0, 1, 2].map((col) => (
          <rect key={`${row}-${col}`} x={3.4 + col * 6.9} y={4.8 + row * 6.4} width={4.5} height={4.5} rx={1.25} />
        )),
      )}
      <rect x={3.4} y={17.6} width={18.2} height={2.7} rx={1.35} />
    </svg>
  );
}

/** 伪二维码（确定性花纹，种子 = 微信号）：加我微信的名片码 */
export function PseudoQR({ seed, size = 176 }: { seed: string; size?: number }) {
  const { cells, n } = useMemo(() => {
    let h = 2166136261;
    for (let i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const rand = () => {
      h ^= h << 13;
      h ^= h >>> 17;
      h ^= h << 5;
      return (h >>> 0) / 4294967296;
    };
    const n = 25;
    const inFinder = (r: number, c: number) => (r < 8 && c < 8) || (r < 8 && c >= n - 8) || (r >= n - 8 && c < 8);
    const cells: boolean[][] = [];
    for (let r = 0; r < n; r++) {
      cells[r] = [];
      for (let c = 0; c < n; c++) cells[r][c] = !inFinder(r, c) && rand() > 0.52;
    }
    return { cells, n };
  }, [seed]);
  const s = size / n;
  const finder = (x: number, y: number, key: string) => (
    <g key={key}>
      <rect x={x * s} y={y * s} width={7 * s} height={7 * s} rx={s} fill="currentColor" />
      <rect x={(x + 1) * s} y={(y + 1) * s} width={5 * s} height={5 * s} rx={s * 0.55} fill="#fff" />
      <rect x={(x + 2) * s} y={(y + 2) * s} width={3 * s} height={3 * s} rx={s * 0.35} fill="currentColor" />
    </g>
  );
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="text-[#07C160]" aria-hidden="true">
      {cells.flatMap((row, r) =>
        row.map((on, c) =>
          on ? (
            <rect key={`${r}-${c}`} x={c * s + s * 0.12} y={r * s + s * 0.12} width={s * 0.76} height={s * 0.76} rx={s * 0.16} fill="currentColor" />
          ) : null
        )
      )}
      {finder(0, 0, 'tl')}
      {finder(n - 7, 0, 'tr')}
      {finder(0, n - 7, 'bl')}
    </svg>
  );
}


// ---------------- 液态玻璃主题 · 会话列表小组件（搜索框下面；设置见 主题页›液态玻璃设置） ----------------

/** 秒数 → mm:ss */
export function mmss(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** 网易云音乐小组件（连接音乐 App）：真实读取全局播放器状态（当前歌/进度/播放暂停），
 *  预览/切歌/暂停直接驱动音乐引擎，点歌曲区跳进音乐 App 播放页；
 *  顶部身份（头像+昵称）可跟随微信登录账号，也可在 主题›液态玻璃设置 里自定义。
 *  用户后续要求：右上角「网易云音乐」品牌角标与「正在听」呼吸标识已删除；
 *  无歌时保持与播放态同尺寸的占位版式（占位不缩水），控制键空队列时安全 no-op */
export function WxWidgetMusic({ me }: { me: WxUser }) {
  const skin = useSettings((s) => s.liquidSkin.wx);
  const switchToApp = useUI((s) => s.switchToApp);
  const current = useMusic((s) => s.current);
  const playing = useMusic((s) => s.playing);
  const buffering = useMusic((s) => s.buffering);
  const position = useMusic((s) => s.position);
  const duration = useMusic((s) => s.duration);
  const playError = useMusic((s) => s.playError);
  const toggle = useMusic((s) => s.toggle);
  const next = useMusic((s) => s.next);
  const prev = useMusic((s) => s.prev);
  const openPlayer = useMusic((s) => s.openPlayer);
  const setMusicTab = useMusic((s) => s.setTab);

  /* 顶部身份：跟随微信登录账号（me）或自定义（液态玻璃设置；头像空 = 灰底占位） */
  const follow = skin.musicFollowWx;
  const dispName = follow ? me.name : skin.musicName.trim() || '我';
  const dispAvatar = follow ? me.avatar : skin.musicAvatar || null;

  /* 时长：优先 audio 汇报，缺失时回退歌曲元数据（毫秒）；进度按真实 position 驱动 */
  const dur = duration > 0 ? duration : current?.duration ? current.duration / 1000 : 0;
  const pct = dur > 0 ? Math.min(100, (position / dur) * 100) : 0;

  /* 跳转音乐 App：有歌直进播放器页，没歌回首页 */
  const openMusic = () => {
    if (current) openPlayer();
    else setMusicTab('home');
    switchToApp('music');
  };

  /* 封面（http 直链过同源代理，防混合内容拦截；无封面用渐变示意） */
  const cover = current ? songCover(current) : '';
  const coverUrl = cover ? (cover.startsWith('http://') ? mediaProxyUrl(cover) : cover) : '';
  /* 歌手行：过长截断为前 2 位 + …（联名单曲一长串名字挤在小卡片里） */
  const artistLine = (() => {
    const names = (current?.artists ?? []).map((a) => a.name).filter(Boolean);
    if (!names.length) return '未知歌手';
    return names.length > 2 ? `${names.slice(0, 2).join('/')} 等` : names.join('/');
  })();

  return (
    <div data-testid="wx-widget-music" className="lg-card relative overflow-hidden rounded-[22px] p-3">
      {/* 顶部身份行：头像 + 昵称（跟随微信/自定义；品牌角标已按用户要求删除） */}
      <div className="flex items-center gap-2">
        <WxAvatar src={dispAvatar} alt={dispName} size={26} shape="circle" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-black/75 dark:text-white/80">{dispName}</span>
      </div>

      {current ? (
        <>
          {/* 歌曲区：左信息右旋转唱片；点按 → 音乐 App 播放页 */}
          <button
            type="button"
            data-testid="wx-widget-music-open"
            onClick={openMusic}
            className="mt-2.5 flex w-full items-center gap-3.5 text-left active:opacity-70"
          >
            <span className="min-w-0 flex-1">
              <span data-testid="wx-widget-music-song" className="block truncate text-[17px] font-bold leading-tight text-black/90 dark:text-white/95">
                {current.name}
              </span>
              <span className="mt-1 block truncate text-[12px] font-medium leading-tight text-black/45 dark:text-white/45">
                {buffering ? '缓冲中…' : playError || artistLine}
              </span>
            </span>
            {/* 黑胶唱片：播放中旋转，中心 = 真实封面 */}
            <span className="relative flex h-[78px] w-[78px] shrink-0 items-center justify-center" aria-hidden="true">
              <span
                className="relative block h-full w-full rounded-full shadow-[0_5px_16px_rgba(0,0,0,0.30)]"
                style={{
                  animation: playing ? 'wxWidgetSpin 7s linear infinite' : undefined,
                  background: 'repeating-radial-gradient(circle at center, #17171A 0px, #1F1F24 1.5px, #17171A 3px)',
                }}
              >
                {coverUrl ? (
                  <img
                    src={coverUrl}
                    alt=""
                    className="absolute left-1/2 top-1/2 h-[42px] w-[42px] -translate-x-1/2 -translate-y-1/2 rounded-full object-cover shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25)]"
                  />
                ) : (
                  <span className="absolute left-1/2 top-1/2 h-[42px] w-[42px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-br from-[#F6D9E5] via-[#DCC7EC] to-[#B9C7F2]" />
                )}
                <span className="absolute left-1/2 top-1/2 h-[8px] w-[8px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#0D0D0F] ring-1 ring-white/30" />
              </span>
              {/* 唱针（静态装饰） */}
              <span className="absolute -right-0.5 -top-1 h-[32px] w-[2px] origin-top rotate-[28deg] rounded-full bg-black/45 dark:bg-white/50" />
            </span>
          </button>

          {/* 进度条（真实 position/duration） */}
          <div className="mt-2">
            <div className="h-[4px] w-full overflow-hidden rounded-full bg-black/[0.08] dark:bg-white/[0.14]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#C20C0C] to-[#FF6B6B] transition-[width] duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="mt-1 flex justify-between text-[10px] tabular-nums text-black/35 dark:text-white/40">
              <span>{mmss(position)}</span>
              <span>{dur > 0 ? mmss(dur) : '--:--'}</span>
            </div>
          </div>

          {/* 控制行：上一首 / 播放暂停（玻璃圆钮） / 下一首（真实驱动音乐引擎） */}
          <div className="mt-1.5 flex items-center justify-center gap-8 text-black/80 dark:text-white/90">
            <button type="button" aria-label="上一首" onClick={() => void prev()} className="p-1 active:opacity-50">
              <SkipBack className="h-[19px] w-[19px]" strokeWidth={2.2} fill="currentColor" />
            </button>
            <button
              type="button"
              aria-label={playing ? '暂停' : '播放'}
              data-testid="wx-widget-music-toggle"
              onClick={toggle}
              className="grid h-[38px] w-[38px] place-items-center rounded-full bg-black/[0.06] ring-1 ring-black/[0.06] transition-transform active:scale-95 dark:bg-white/[0.12] dark:ring-white/[0.12]"
            >
              {playing ? (
                <Pause className="h-[18px] w-[18px]" strokeWidth={2.2} fill="currentColor" />
              ) : (
                <Play className="ml-[2px] h-[18px] w-[18px]" strokeWidth={2.2} fill="currentColor" />
              )}
            </button>
            <button type="button" aria-label="下一首" onClick={() => void next()} className="p-1 active:opacity-50">
              <SkipForward className="h-[19px] w-[19px]" strokeWidth={2.2} fill="currentColor" />
            </button>
          </div>
        </>
      ) : (
        /* 空态占位（用户要求：无歌时同样占位，不缩水）——与播放态同版式同尺寸：
           灰显占位歌名 + 引导副行 + 静态黑胶唱片 + 0% 进度条 + 三键控制行
           （控制键直连音乐引擎，空队列时安全 no-op） */
        <>
          <button
            type="button"
            data-testid="wx-widget-music-open"
            onClick={openMusic}
            className="mt-2.5 flex w-full items-center gap-3.5 text-left active:opacity-70"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[17px] font-bold leading-tight text-black/30 dark:text-white/30">还没有在听的歌</span>
              <span className="mt-1 block truncate text-[12px] font-medium leading-tight text-black/30 dark:text-white/30">
                去音乐 App 挑一首，这里同步显示
              </span>
            </span>
            {/* 黑胶唱片占位：静态渐变盘心 + 唱针（无歌不旋转） */}
            <span className="relative flex h-[78px] w-[78px] shrink-0 items-center justify-center" aria-hidden="true">
              <span
                className="relative block h-full w-full rounded-full opacity-50 shadow-[0_5px_16px_rgba(0,0,0,0.30)]"
                style={{ background: 'repeating-radial-gradient(circle at center, #17171A 0px, #1F1F24 1.5px, #17171A 3px)' }}
              >
                <span className="absolute left-1/2 top-1/2 h-[42px] w-[42px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-br from-[#F6D9E5] via-[#DCC7EC] to-[#B9C7F2]" />
                <span className="absolute left-1/2 top-1/2 h-[8px] w-[8px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#0D0D0F] ring-1 ring-white/30" />
              </span>
              {/* 唱针（静态装饰） */}
              <span className="absolute -right-0.5 -top-1 h-[32px] w-[2px] origin-top rotate-[28deg] rounded-full bg-black/45 dark:bg-white/50" />
            </span>
          </button>

          {/* 进度条占位：0% + --:-- */}
          <div className="mt-2">
            <div className="h-[4px] w-full overflow-hidden rounded-full bg-black/[0.08] dark:bg-white/[0.14]" />
            <div className="mt-1 flex justify-between text-[10px] tabular-nums text-black/35 dark:text-white/40">
              <span>--:--</span>
              <span>--:--</span>
            </div>
          </div>

          {/* 控制行占位：三键同款（真实驱动；空队列时安全 no-op） */}
          <div className="mt-1.5 flex items-center justify-center gap-8 text-black/80 dark:text-white/90">
            <button type="button" aria-label="上一首" onClick={() => void prev()} className="p-1 active:opacity-50">
              <SkipBack className="h-[19px] w-[19px]" strokeWidth={2.2} fill="currentColor" />
            </button>
            <button
              type="button"
              aria-label="播放"
              data-testid="wx-widget-music-toggle"
              onClick={toggle}
              className="grid h-[38px] w-[38px] place-items-center rounded-full bg-black/[0.06] ring-1 ring-black/[0.06] transition-transform active:scale-95 dark:bg-white/[0.12] dark:ring-white/[0.12]"
            >
              <Play className="ml-[2px] h-[18px] w-[18px]" strokeWidth={2.2} fill="currentColor" />
            </button>
            <button type="button" aria-label="下一首" onClick={() => void next()} className="p-1 active:opacity-50">
              <SkipForward className="h-[19px] w-[19px]" strokeWidth={2.2} fill="currentColor" />
            </button>
          </div>
        </>
      )}
      <style>{'@keyframes wxWidgetSpin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}'}</style>
    </div>
  );
}

/** 日历小组件：iOS 日历风——年月标题 + 真实当月网格（今天红圈、周末红字、前后月补齐灰显）；
 *  右上角「今天 N」胶囊已按用户要求删除（今天日期仍在网格里红圈标出） */
export function WxWidgetCalendar() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0 基
  const today = now.getDate();
  /* 当月天数 / 上月天数 / 一号是周几（周日 = 0） */
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevDays = new Date(year, month, 0).getDate();
  const firstDow = new Date(year, month, 1).getDay();
  /* 网格单元：前后月补齐成整周，其他月日期灰显 */
  const cells: { d: number; other: boolean }[] = [];
  for (let i = firstDow - 1; i >= 0; i--) cells.push({ d: prevDays - i, other: true });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ d, other: false });
  for (let n = 1; cells.length % 7 !== 0; n++) cells.push({ d: n, other: true });

  return (
    <div data-testid="wx-widget-calendar" className="lg-card overflow-hidden rounded-[22px] px-3.5 pb-2.5 pt-3">
      {/* 头部：年月标题（「今天 N」胶囊已按用户要求删除） */}
      <div className="flex items-center px-1">
        <p className="text-[14px] font-bold leading-none text-black/85 dark:text-white/90">
          {year}年{month + 1}月
        </p>
      </div>
      {/* 周标题行 */}
      <div className="mt-2.5 grid grid-cols-7 text-center" aria-hidden="true">
        {['日', '一', '二', '三', '四', '五', '六'].map((d, i) => (
          <span
            key={d}
            className={`text-[10px] font-semibold leading-none ${
              i === 0 || i === 6 ? 'text-[#FF453A]/75' : 'text-black/35 dark:text-white/35'
            }`}
          >
            {d}
          </span>
        ))}
      </div>
      {/* 日期网格：今天红圆白字，周末红字，其他月灰显 */}
      <div className="mt-1.5 grid grid-cols-7 text-center">
        {cells.map((c, i) => {
          const weekend = i % 7 === 0 || i % 7 === 6;
          const isToday = !c.other && c.d === today;
          return (
            <span key={i} className="flex h-[21px] items-center justify-center">
              <span
                className={`grid h-[19px] min-w-[19px] place-items-center rounded-full px-[2px] text-[11px] font-medium leading-none tabular-nums ${
                  isToday
                    ? 'bg-[#FF453A] font-bold text-white'
                    : c.other
                      ? 'text-black/20 dark:text-white/20'
                      : weekend
                        ? 'text-[#FF453A]/90 dark:text-[#FF6B6B]/90'
                        : 'text-black/70 dark:text-white/75'
                }`}
              >
                {c.d}
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

/** 自定义 CSS/HTML 小组件：渲染用户内容（内容里可带 <style>；纯本机自用） */
export function WxWidgetCustom({ html }: { html: string }) {
  if (!html.trim()) {
    return (
      <div
        data-testid="wx-widget-custom"
        className="lg-card rounded-[22px] px-4 py-5 text-center text-[12.5px] text-black/35 dark:text-white/35"
      >
        自定义小组件 · 去 主题 › 液态玻璃设置 写点内容，或点「插入示例」
      </div>
    );
  }
  return (
    <div
      data-testid="wx-widget-custom"
      className="wx-custom-widget overflow-hidden rounded-[22px]"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/** 小组件区（搜索框下、分类标签上）：按设置开关逐个渲染 */
export function WxLiquidWidgets({ me }: { me: WxUser }) {
  const skin = useSettings((s) => s.liquidSkin.wx);
  if (!skin.widgetMusic && !skin.widgetCalendar && !skin.widgetCustom) return null;
  return (
    <div className="mb-2.5 flex flex-col gap-2.5">
      {skin.widgetMusic && <WxWidgetMusic me={me} />}
      {skin.widgetCalendar && <WxWidgetCalendar />}
      {skin.widgetCustom && <WxWidgetCustom html={skin.customHtml} />}
    </div>
  );
}
