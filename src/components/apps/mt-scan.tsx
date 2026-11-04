'use client';

/**
 * 扫一扫（美团 / 微信 / QQ 三端共用）：
 * - useScanOverlay：全局开关（flavor = 发起端），各端根组件挂 <ScanOverlayWhen flavor=.../>；
 *   入口处一行 openScan('wechat') 即可呼出（微信：+菜单/发现页；QQ：+菜单/加好友页；美团：首页顶部）；
 * - 扫描页：拟真相机底（深色 + 模糊光斑）+ 四角取景框 + 激光线动画，约 1.8s 「识别」出结果卡；
 * - 美团端结果（真实语义）：我的店铺码（点击直达店铺页）/ 美团神券（真实发放进红包卡券包）/ 网页链接；
 * - 微信/QQ 端结果：网页链接 / 文本消息（可复制）/ 名片·群二维码（演示提示）；
 * - PseudoQr：确定性伪二维码（店铺管理页「商家」页签「店铺码」弹窗展示，美团扫一扫可「扫到」这家店）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { create } from 'zustand';
import {
  Copy,
  Flashlight,
  Image as ImageIcon,
  Link2,
  QrCode,
  RefreshCw,
  Store,
  Ticket,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react';
import { mtClaimGodCoupons, mtGetSession, mtLoadShops, mtUidOf } from '@/lib/ios/meituan-store';
import { ShopImg } from './mt-merchant-ui';

export type ScanFlavor = 'meituan' | 'wechat' | 'qq';

// ---------------- 全局开关 ----------------

interface ScanOverlayState {
  flavor: ScanFlavor | null;
  open: (f: ScanFlavor) => void;
  close: () => void;
}

export const useScanOverlay = create<ScanOverlayState>((set) => ({
  flavor: null,
  open: (flavor) => set({ flavor }),
  close: () => set({ flavor: null }),
}));

/** 各端扫一扫入口统一调用（无需 setState 透传） */
export function openScan(flavor: ScanFlavor): void {
  useScanOverlay.getState().open(flavor);
}

/** 按端挂载的宿主（各端根组件无条件放一个即可；开关走全局 store，自带进出场动画） */
export function ScanOverlayWhen({
  flavor,
  onOpenShop,
  onOpenCoupons,
}: {
  flavor: ScanFlavor;
  /** 美团端：扫到自家店铺码 → 直达店铺页 */
  onOpenShop?: (shopId: string) => void;
  /** 美团端：神券结果「去用券」→ 跳红包卡券页 */
  onOpenCoupons?: () => void;
}) {
  const f = useScanOverlay((s) => s.flavor);
  return (
    <AnimatePresence>{f === flavor && <ScanOverlay key="scan-overlay" flavor={flavor} onOpenShop={onOpenShop} onOpenCoupons={onOpenCoupons} />}</AnimatePresence>
  );
}

// ---------------- 识别结果模型 ----------------

type ScanResult =
  | { kind: 'shop'; shopId: string; name: string; cover?: string }
  | { kind: 'coupon'; count: number }
  | { kind: 'link'; url: string }
  | { kind: 'text'; text: string }
  | { kind: 'vcard'; title: string; group?: boolean };

const MT_LINKS = ['https://waimai.meituan.com/h5/2025shenquan', 'https://www.meituan.com/f/xiaozhen-meishi'];
const WX_LINKS = ['https://mp.weixin.qq.com/s/zhineng-shenghuo-2025', 'https://weixin.qq.com/r/2025chunjie'];
const QQ_LINKS = ['https://act.qq.com/2025nianyehui'];

const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

function buildMeituanResult(): ScanResult {
  const s = mtGetSession();
  const uid = s ? mtUidOf(s) : '';
  const shops = uid ? mtLoadShops(uid) : [];
  const r = Math.random();
  // 优先识别自家店铺码（入驻了店铺 → 扫一扫直达，形成「店铺码」闭环）
  if (shops.length > 0 && r < 0.62) {
    const shop = pick(shops);
    return { kind: 'shop', shopId: shop.id, name: shop.name, cover: shop.cover };
  }
  if (uid && r < 0.88) return { kind: 'coupon', count: mtClaimGodCoupons(uid) };
  return { kind: 'link', url: pick(MT_LINKS) };
}

function buildSocialResult(flavor: 'wechat' | 'qq'): ScanResult {
  const r = Math.random();
  if (r < 0.45) return { kind: 'link', url: pick(flavor === 'wechat' ? WX_LINKS : QQ_LINKS) };
  if (r < 0.78)
    return {
      kind: 'text',
      text: pick(
        flavor === 'wechat'
          ? ['微信支付有优惠：今日金币已可领取（演示环境）', '您好，我是琳琳，这是我的微信二维码名片~']
          : ['QQ会员限时8折，续费立省12元（演示环境）', '欢迎加入干饭人联盟，群号 52005200'],
      ),
    };
  return {
    kind: 'vcard',
    title: flavor === 'wechat' ? '个人名片 · 二维码' : 'QQ群二维码 · 干饭人联盟',
    group: flavor === 'qq',
  };
}

// ---------------- 取景框 + 扫描动画 ----------------

const ACCENT: Record<ScanFlavor, string> = { meituan: '#FFD100', wechat: '#3ECB5C', qq: '#12B7F5' };
const SCAN_TIP: Record<ScanFlavor, string> = {
  meituan: '对准二维码 / 店铺码，自动识别',
  wechat: '将二维码 / 条码放入框内，即可自动扫描',
  qq: '对准二维码图片，即可自动识别',
};

function Corner({ pos }: { pos: 'tl' | 'tr' | 'bl' | 'br' }) {
  const cls = {
    tl: 'left-0 top-0 border-l-2 border-t-2 rounded-tl-xl',
    tr: 'right-0 top-0 border-r-2 border-t-2 rounded-tr-xl',
    bl: 'left-0 bottom-0 border-l-2 border-b-2 rounded-bl-xl',
    br: 'right-0 bottom-0 border-r-2 border-b-2 rounded-br-xl',
  }[pos];
  return <span aria-hidden="true" className={`absolute h-8 w-8 border-white/90 ${cls}`} />;
}

// ---------------- 主组件 ----------------

function ScanOverlay({
  flavor,
  onOpenShop,
  onOpenCoupons,
}: {
  flavor: ScanFlavor;
  onOpenShop?: (shopId: string) => void;
  onOpenCoupons?: () => void;
}) {
  const close = useCallback(() => useScanOverlay.getState().close(), []);
  const [phase, setPhase] = useState<'scan' | 'result'>('scan');
  const [result, setResult] = useState<ScanResult | null>(null);
  const [hint, setHint] = useState('');
  const hintTimer = useRef<number | null>(null);

  const showHint = useCallback((m: string) => {
    setHint(m);
    if (hintTimer.current) window.clearTimeout(hintTimer.current);
    hintTimer.current = window.setTimeout(() => setHint(''), 1800);
  }, []);
  useEffect(() => () => { if (hintTimer.current) window.clearTimeout(hintTimer.current); }, []);

  const rescan = useCallback(() => {
    setResult(null);
    setPhase('scan');
  }, []);

  // 扫描节奏：约 1.8s 后「识别」出结果
  useEffect(() => {
    if (phase !== 'scan') return;
    const t = window.setTimeout(() => {
      setResult(flavor === 'meituan' ? buildMeituanResult() : buildSocialResult(flavor));
      setPhase('result');
    }, 1700 + Math.random() * 700);
    return () => window.clearTimeout(t);
  }, [phase, flavor]);

  const copy = (text: string) => {
    try {
      void navigator.clipboard?.writeText(text);
      showHint('已复制');
    } catch {
      showHint('复制失败');
    }
  };

  const accent = ACCENT[flavor];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-[69] flex flex-col overflow-hidden bg-[#0B0D12]"
    >
      {/* 拟真相机底：模糊光斑 + 细噪点渐变 */}
      <span aria-hidden="true" className="absolute -left-16 top-24 h-64 w-64 rounded-full bg-[#1E3A5F]/50 blur-3xl" />
      <span aria-hidden="true" className="absolute -right-10 bottom-32 h-72 w-72 rounded-full blur-3xl" style={{ background: `${accent}22` }} />
      <span aria-hidden="true" className="absolute left-10 top-1/2 h-40 w-40 rounded-full bg-white/[0.05] blur-2xl" />

      {/* 顶栏 */}
      <div className="relative z-10 flex shrink-0 items-center gap-2 px-3 pb-3 pt-[54px]">
        <button type="button" aria-label="关闭扫一扫" onClick={close} className="grid h-9 w-9 place-items-center rounded-full bg-white/10 text-white backdrop-blur-md active:opacity-70">
          <X className="h-5 w-5" />
        </button>
        <p className="min-w-0 flex-1 text-center text-[16px] font-medium text-white/95">{flavor === 'meituan' ? '扫一扫' : '二维码 / 条码'}</p>
        <button type="button" aria-label="手电筒" onClick={() => showHint('当前环境光线充足')} className="grid h-9 w-9 place-items-center rounded-full bg-white/10 text-white backdrop-blur-md active:opacity-70">
          <Flashlight className="h-[18px] w-[18px]" strokeWidth={1.9} />
        </button>
        <button type="button" aria-label="相册" onClick={() => showHint('演示环境，暂不支持从相册识别')} className="grid h-9 w-9 place-items-center rounded-full bg-white/10 text-white backdrop-blur-md active:opacity-70">
          <ImageIcon className="h-[18px] w-[18px]" strokeWidth={1.9} />
        </button>
      </div>

      {/* 取景框 + 激光线 */}
      <div className="relative z-10 flex min-h-0 flex-1 items-center justify-center px-10">
        <div className="relative h-[230px] w-[230px]">
          <Corner pos="tl" />
          <Corner pos="tr" />
          <Corner pos="bl" />
          <Corner pos="br" />
          {phase === 'scan' && (
            <motion.span
              aria-hidden="true"
              className="absolute left-2 right-2 top-0 h-[2.5px] rounded-full"
              style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)`, boxShadow: `0 0 12px ${accent}99` }}
              animate={{ y: [6, 218, 6] }}
              transition={{ duration: 2.1, repeat: Infinity, ease: 'easeInOut' }}
            />
          )}
          {phase === 'result' && (
            <motion.span
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              className="absolute inset-0 grid place-items-center"
            >
              <span className="grid h-16 w-16 place-items-center rounded-full" style={{ background: `${accent}2E`, boxShadow: `0 0 0 8px ${accent}14` }}>
                <QrCode className="h-8 w-8" style={{ color: accent }} strokeWidth={1.8} />
              </span>
            </motion.span>
          )}
        </div>
      </div>

      {/* 底部提示 */}
      <p className="relative z-10 shrink-0 pb-12 text-center text-[12px] text-white/45">{phase === 'scan' ? SCAN_TIP[flavor] : '识别完成'}</p>

      {/* 识别结果卡（底部推出，毛玻璃） */}
      <AnimatePresence>
        {phase === 'result' && result && (
          <motion.div
            key="scan-result"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'tween', duration: 0.26, ease: [0.32, 0.72, 0, 1] }}
            className="absolute inset-x-3 bottom-3 z-20 overflow-hidden rounded-3xl bg-white/92 px-5 pb-6 pt-5 shadow-[0_18px_50px_rgba(0,0,0,0.4)] backdrop-blur-2xl ring-1 ring-white/60"
            data-testid="mt-scan-result"
          >
            <span aria-hidden="true" className="mx-auto mb-3.5 block h-1 w-9 rounded-full bg-black/10" />
            {result.kind === 'shop' && (
              <>
                <p className="text-center text-[11px] font-medium uppercase tracking-widest" style={{ color: accent }}>识别到店铺码</p>
                <div className="mt-2.5 flex items-center gap-3">
                  <span className="h-14 w-14 shrink-0 overflow-hidden rounded-xl ring-1 ring-black/5">
                    <ShopImg name={result.name} cover={result.cover} className="h-full w-full" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[16px] font-bold text-black/85">{result.name}</p>
                    <p className="mt-0.5 text-[11px] text-black/40">扫码直达店铺 · 点菜下单一步到位</p>
                  </div>
                </div>
                <div className="mt-4 flex gap-2.5">
                  <button type="button" onClick={rescan} className="h-11 flex-1 rounded-full bg-black/[0.05] text-[14px] font-medium text-black/65 active:bg-black/[0.1]">
                    再扫一次
                  </button>
                  <button
                    type="button"
                    data-testid="mt-scan-open-shop"
                    onClick={() => {
                      close();
                      onOpenShop?.(result.shopId);
                    }}
                    className="h-11 flex-[1.4] rounded-full text-[14px] font-bold text-black/85 shadow-[0_8px_22px_rgba(255,190,0,0.45)] active:opacity-85"
                    style={{ background: accent }}
                  >
                    进店逛逛
                  </button>
                </div>
              </>
            )}
            {result.kind === 'coupon' && (
              <>
                <p className="text-center text-[11px] font-medium uppercase tracking-widest" style={{ color: accent }}>识别到美团神券</p>
                <div className="mt-2.5 flex flex-col items-center gap-1.5 py-1.5">
                  <span className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-[#FFF3C4] to-[#FFD100]">
                    <Ticket className="h-7 w-7 text-[#8A4B00]" strokeWidth={1.8} />
                  </span>
                  {result.count > 0 ? (
                    <>
                      <p className="text-[16px] font-bold text-black/85">已领取 {result.count} 张神券</p>
                      <p className="text-[12px] text-black/45">已存入「红包卡券」，结算时自动可选</p>
                    </>
                  ) : (
                    <>
                      <p className="text-[16px] font-bold text-black/85">神券都已领过啦</p>
                      <p className="text-[12px] text-black/45">未使用的在「红包卡券」里，结算时可用</p>
                    </>
                  )}
                </div>
                <div className="mt-4 flex gap-2.5">
                  <button type="button" onClick={close} className="h-11 flex-1 rounded-full bg-black/[0.05] text-[14px] font-medium text-black/65 active:bg-black/[0.1]">
                    完成
                  </button>
                  {onOpenCoupons && (
                    <button
                      type="button"
                      onClick={() => {
                        close();
                        onOpenCoupons();
                      }}
                      className="h-11 flex-[1.4] rounded-full text-[14px] font-bold text-black/85 shadow-[0_8px_22px_rgba(255,190,0,0.45)] active:opacity-85"
                      style={{ background: accent }}
                    >
                      去用券
                    </button>
                  )}
                </div>
              </>
            )}
            {result.kind === 'link' && (
              <>
                <p className="text-center text-[11px] font-medium uppercase tracking-widest" style={{ color: accent }}>识别到网页链接</p>
                <div className="mt-3 flex items-start gap-2.5 rounded-2xl bg-black/[0.04] px-3.5 py-3">
                  <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-black/40" />
                  <p className="min-w-0 flex-1 break-all text-[13px] leading-relaxed text-black/75">{result.url}</p>
                </div>
                <div className="mt-4 flex gap-2.5">
                  <button type="button" onClick={() => copy(result.url)} className="h-11 flex-1 rounded-full bg-black/[0.05] text-[14px] font-medium text-black/65 active:bg-black/[0.1]">
                    复制链接
                  </button>
                  <button type="button" onClick={() => showHint('演示环境，暂不支持打开网页')} className="h-11 flex-1 rounded-full text-[14px] font-bold text-black/85 active:opacity-85" style={{ background: accent }}>
                    打开链接
                  </button>
                </div>
              </>
            )}
            {result.kind === 'text' && (
              <>
                <p className="text-center text-[11px] font-medium uppercase tracking-widest" style={{ color: accent }}>识别到文本</p>
                <p className="mt-3 rounded-2xl bg-black/[0.04] px-3.5 py-3 text-[14px] leading-relaxed text-black/80">{result.text}</p>
                <div className="mt-4 flex gap-2.5">
                  <button type="button" onClick={rescan} className="h-11 flex-1 rounded-full bg-black/[0.05] text-[14px] font-medium text-black/65 active:bg-black/[0.1]">
                    <RefreshCw className="mr-1 inline h-3.5 w-3.5" />
                    再扫一次
                  </button>
                  <button type="button" onClick={() => copy(result.text)} className="h-11 flex-1 rounded-full text-[14px] font-bold text-black/85 active:opacity-85" style={{ background: accent }}>
                    复制内容
                  </button>
                </div>
              </>
            )}
            {result.kind === 'vcard' && (
              <>
                <p className="text-center text-[11px] font-medium uppercase tracking-widest" style={{ color: accent }}>{result.group ? '识别到群二维码' : '识别到名片二维码'}</p>
                <div className="mt-2.5 flex flex-col items-center gap-1.5 py-1.5">
                  <span className="grid h-14 w-14 place-items-center rounded-2xl" style={{ background: `${accent}1F` }}>
                    {result.group ? <UsersRound className="h-7 w-7" style={{ color: accent }} strokeWidth={1.8} /> : <UserRound className="h-7 w-7" style={{ color: accent }} strokeWidth={1.8} />}
                  </span>
                  <p className="text-[16px] font-bold text-black/85">{result.title}</p>
                  <p className="text-[12px] text-black/40">扫描添加，和更多朋友一起玩</p>
                </div>
                <div className="mt-4 flex gap-2.5">
                  <button type="button" onClick={rescan} className="h-11 flex-1 rounded-full bg-black/[0.05] text-[14px] font-medium text-black/65 active:bg-black/[0.1]">
                    再扫一次
                  </button>
                  <button type="button" onClick={() => showHint('演示环境，暂不支持扫码添加')} className="h-11 flex-1 rounded-full text-[14px] font-bold text-black/85 active:opacity-85" style={{ background: accent }}>
                    扫码添加
                  </button>
                </div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* 轻提示 */}
      <AnimatePresence>
        {hint && (
          <motion.p
            key={hint}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="absolute bottom-28 left-1/2 z-30 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/75 px-4 py-2 text-[12px] text-white"
          >
            {hint}
          </motion.p>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ---------------- 伪二维码（店铺码展示用） ----------------

/**
 * 确定性伪二维码：21×21 模块，seed 哈希驱动 + 三个定位角 + 时序线——视觉上与真二维码一致，
 * 同一 seed 永远渲染同一图案（店铺码 = 店铺 id）。
 */
export function PseudoQr({ seed, className = '' }: { seed: string; className?: string }) {
  const N = 21;
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const rand = (i: number): number => {
    let x = (h ^ Math.imul(i + 1, 2654435761)) >>> 0;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return x >>> 0;
  };
  const finderAt = (r: number, c: number): boolean | null => {
    // 三个 7×7 定位角：黑外环 + 白环 + 黑中心
    const zones: [number, number][] = [[0, 0], [0, N - 7], [N - 7, 0]];
    for (const [zr, zc] of zones) {
      if (r >= zr && r < zr + 7 && c >= zc && c < zc + 7) {
        const ring = Math.max(Math.abs(r - (zr + 3)), Math.abs(c - (zc + 3)));
        return ring === 2 ? false : true; // ring 3/1/0 黑，ring 2 白
      }
    }
    return null;
  };
  const cells: { x: number; y: number }[] = [];
  for (let r = 0; r < N; r += 1) {
    for (let c = 0; c < N; c += 1) {
      const f = finderAt(r, c);
      if (f === true) {
        cells.push({ x: c, y: r });
        continue;
      }
      if (f === false) continue;
      // 时序线（第 6 行/列交替）+ 其余伪随机
      const timing = (r === 6 || c === 6) && (r + c) % 2 === 0;
      if (timing || rand(r * N + c) % 100 < 46) cells.push({ x: c, y: r });
    }
  }
  return (
    <span className={`inline-block bg-white p-2 ring-1 ring-black/10 ${className}`} aria-hidden="true">
      <svg viewBox={`0 0 ${N} ${N}`} className="h-full w-full" shapeRendering="crispEdges">
        {cells.map((cell) => (
          <rect key={`${cell.x}-${cell.y}`} x={cell.x} y={cell.y} width={1} height={1} fill="#17181C" />
        ))}
      </svg>
    </span>
  );
}
