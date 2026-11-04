'use client';

/**
 * 淘宝频道页（第九轮需求开发）：
 * - SubsidyPage 百亿补贴（红：疯狂加补周/国家补贴四宫格/频道惊喜权益/补贴商品流）；
 * - SeckillPage 淘宝秒杀（橙：超级88换季/9块9疯抢/整点抢红包/正在秒杀倒计时商品流）；
 * - SignInPage 红包签到·领现金（签到日历/赚元宝/连续打卡/任务栏/客户案例，localStorage 按 uid 持久化）；
 * - MoviePage 淘票票（首页→影院列表→选座，粉：热映/新人福利/场次/座位图）；
 * - FliggyPage 飞猪旅行（黄：酒店搜索→酒店列表，机票超低价/特惠酒店/爆款榜单）；
 * - BillPage 淘宝账单（我的消费明细：真实订单月账单/年累计/省钱统计）。
 * 图标一律 SVG/lucide（禁 emoji）；数据 tb-* 键按 uid 隔离。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  BedDouble,
  Bell,
  CarTaxiFront,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clapperboard,
  Crosshair,
  Flame,
  Info,
  MapPin,
  Mic,
  Minus,
  MoreHorizontal,
  Pencil,
  Phone,
  Plane,
  Play,
  Plus,
  ScanLine,
  Search,
  Share2,
  ShoppingBag,
  ShoppingCart,
  Stamp,
  Ticket,
  TrainFront,
  User,
  Wallet,
  X,
  Zap,
} from 'lucide-react';
import {
  TB_BEST_ZONE,
  TB_CINEMAS,
  TB_COMEDY_SHOWS,
  TB_CONCERTS,
  TB_FLIGGY,
  TB_MERCH,
  TB_MOVIES,
  TB_MOVIE_SESSIONS,
  TB_MOVIES_SOON,
  TB_SEAT_LAYOUT,
  TB_SECKILL,
  TB_SIGN_GOAL,
  TB_SIGN_SLOTS,
  TB_SUBSIDY,
  tbLoadSign,
  tbRealDate,
  tbSaveSign,
  tbSeatSold,
  tbSessionStarted,
  tbSessionTime,
  tbSignToday,
  type TbConcert,
  type TbMerch,
  type TbMovie,
  type TbShow,
  type TbSubsidyItem,
} from '@/lib/ios/taobao-channels-data';
import { productById, tbImg, tbSalesText, type TbProduct } from '@/lib/ios/taobao-data';
import { TbImg } from './tb-img';
import { useSettings } from '@/lib/ios/store';
import { tbFetchAiBatch, tbFeedAuxLoad, tbFeedAuxSave, tbFeedLoad, tbFeedSave, type TbFeedRaw, type TbFeedTop } from '@/lib/ios/tb-ai-store';
import { tbClaimCoupon, tbConfirmReceive, tbCreateMerchOrder, tbCreateTicketOrder, tbLoadCoupons, tbLoadOrders, tbMarkRefund, tbPushMsg, tbTickOrders, type TbSession, type TbTicketInfo } from '@/lib/ios/taobao-store';
import { tbRefundToOrigin } from '@/lib/ios/taobao-pay';
import { TbPullIndicator, useTbPullRefresh } from './tb-pull-refresh';

const fmtMoney = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''));

/** 字符串稳定哈希（AI 电影渐变色/评分派生用） */
function tbStrHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** AI 电影海报渐变色板（按标题确定性取色，风格与种子电影一致） */
const MOVIE_PALETTES: Array<[string, string]> = [
  ['#33424D', '#8B2F1F'],
  ['#4E4237', '#2B2B2B'],
  ['#F5A623', '#E8452C'],
  ['#8ED3F5', '#F48FB1'],
  ['#5B4A8A', '#C4456F'],
  ['#1F5E4B', '#86C232'],
  ['#3A5FA0', '#7692C4'],
  ['#6B3FA0', '#C45A9C'],
];

/** 通用页头圆钮（返回/更多） */
function HeadBtn({ onClick, label, children, dark }: { onClick: () => void; label: string; children: React.ReactNode; dark?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={`grid h-9 w-9 shrink-0 place-items-center rounded-full active:opacity-70 ${dark ? 'bg-black/25' : 'bg-white/25'}`}
    >
      {children}
    </button>
  );
}

// ---------------- 频道页 AI 刷新共享逻辑（Task 41） ----------------
// 「更新用设置 App 里配置的 API 模型」：刷新时调 /api/tb-feed 生成新内容前插（服务端内置模型兜底）；
// 「刷新保存原来更新的内容」：AI 前插（pid 引用经 productById 解析含 AI 注册表）+ 本地确定性批次
// 全部持久化（IndexedDB kv，按 uid 隔离）——页面刷新/重开 App 后原样恢复，旧内容与历史批次永不消失。

interface TbChannelFeedState {
  /** 本地确定性批次（AI 失败兜底，批次号列表，最新在前） */
  batches: number[];
  /** 批次号序列（持久化，刷新页面后批次内容仍可确定性重算） */
  batchSeq: number;
  /** AI 前插条目（pid 引用，最新批在最前） */
  aiTops: TbFeedTop[];
  /** AI 底部追加条目（pid 引用，最新批在最后；滑到底部拉一拉产生，Task 45） */
  aiTails: TbFeedTop[];
  /** 本地确定性兜底批次（追加到列表末尾，最新批在最后） */
  tailBatches: number[];
}

/** 频道页 feed 状态（恢复 + 刷新：AI 优先、本地批次兜底、全量持久化；dir 分流前插/底部追加） */
function useTbChannelFeed(
  uid: string,
  surface: 'subsidy' | 'seckill' | 'fliggy',
  maxBatches: number,
  onToast: (m: string) => void,
  toastDown: string,
  toastUp: string,
  seedTitles: string[],
) {
  const [state, setState] = useState<TbChannelFeedState>({ batches: [], batchSeq: 1, aiTops: [], aiTails: [], tailBatches: [] });
  const stateRef = useRef(state);
  stateRef.current = state;
  const apiConfig = useSettings((s) => s.apiConfig);
  const apiCfgRef = useRef(apiConfig);
  apiCfgRef.current = apiConfig;
  const seq = useRef(0);

  // 挂载恢复：持久化的 AI 前插/底部追加 + 确定性批次（旧内容永不消失）
  useEffect(() => {
    const aux = tbFeedAuxLoad<{ list?: unknown; seq?: unknown }>(uid, surface, 'batches');
    const tailAux = tbFeedAuxLoad<{ list?: unknown }>(uid, surface, 'tailBatches');
    const feed = tbFeedLoad(uid, surface);
    setState({
      batches: aux && Array.isArray(aux.list) ? (aux.list as number[]).filter((b) => typeof b === 'number').slice(0, maxBatches) : [],
      batchSeq: aux && typeof aux.seq === 'number' && aux.seq > 0 ? aux.seq : 1,
      aiTops: feed?.tops ?? [],
      aiTails: feed?.tails ?? [],
      tailBatches: tailAux && Array.isArray(tailAux.list) ? (tailAux.list as number[]).filter((b) => typeof b === 'number').slice(0, 6) : [],
    });
  }, [uid, surface, maxBatches]);

  const persist = (s: TbChannelFeedState) => {
    tbFeedAuxSave(uid, surface, 'batches', { list: s.batches, seq: s.batchSeq });
    tbFeedAuxSave(uid, surface, 'tailBatches', { list: s.tailBatches });
    tbFeedSave(uid, surface, { tops: s.aiTops, tails: s.aiTails });
  };

  /** 刷新（dir 分流，Task 45）：顶部下拉 → AI 新内容前插（旧内容原位保留）；
   *  底部上拉 → AI 新内容追加到列表底部（上方内容不变，画面不跳）；
   *  AI 失败回退本地确定性批次（down 前插批 / up 尾部追加批）；返回 Promise 供刷新指示器等待 */
  const refresh = (count: number, dir: 'down' | 'up' = 'down'): Promise<void> => {
    const s0 = stateRef.current;
    const mySeq = ++seq.current;
    return (async () => {
      // 排除名单：种子池（常驻展示，重复感最强）+ AI 前插 + AI 底部追加（保证每次都是新内容）
      const exclude = [
        ...seedTitles,
        ...s0.aiTops.map((t) => productById(t.pid)?.title ?? ''),
        ...s0.aiTails.map((t) => productById(t.pid)?.title ?? ''),
      ]
        .filter((x) => x.length > 0)
        .slice(0, 60);
      const ai = await tbFetchAiBatch({ uid, surface, exclude, count, config: apiCfgRef.current });
      if (seq.current !== mySeq) return; // 过期批次丢弃
      const ks = `ai${Date.now().toString(36)}`;
      let next: TbChannelFeedState;
      if (dir === 'down') {
        if (ai) {
          next = {
            ...s0,
            aiTops: [...ai.products.map((p, i) => ({ pid: p.id, v: i % 4, k: `${ks}-${i}` })), ...s0.aiTops],
          };
        } else {
          next = { ...s0, batches: [s0.batchSeq, ...s0.batches].slice(0, maxBatches), batchSeq: s0.batchSeq + 1 };
        }
        onToast(toastDown);
      } else {
        if (ai) {
          const start = s0.aiTails.length;
          next = {
            ...s0,
            aiTails: [...s0.aiTails, ...ai.products.map((p, i) => ({ pid: p.id, v: (i + start) % 4, k: `tl${ks}-${start + i}` }))],
          };
        } else {
          // 本地兜底：批次号追加到尾部（渲染在列表最后，旧内容原位保留）
          next = { ...s0, tailBatches: [...s0.tailBatches, s0.batchSeq].slice(-6), batchSeq: s0.batchSeq + 1 };
        }
        onToast(toastUp);
      }
      setState(next);
      persist(next);
    })();
  };

  return { state, refresh };
}

/** AI 商品 → 百亿补贴条目（点击经 pid 进商品详情全链路） */
function aiToSubsidy(p: TbProduct): TbSubsidyItem {
  return {
    id: p.id,
    title: p.title,
    price: fmtMoney(p.price),
    unit: '/补贴价',
    foot: `已售${tbSalesText(p.sales)}`,
    sub: p.tags[0] ?? '正品发货 假一赔十',
    tag: p.tag,
    pid: p.id,
  };
}

/** AI 商品 → 秒杀条目 */
function aiToSeckill(p: TbProduct): (typeof TB_SECKILL.items)[number] {
  const h = tbStrHash(p.id);
  const orig = p.originPrice ?? Math.round(p.price * 1.8 * 100) / 100;
  return {
    id: p.id,
    title: p.title,
    grab: 30 + (h % 60),
    sold: `已售${tbSalesText(p.sales)}`,
    foot: [`直降${fmtMoney(Math.max(1, orig - p.price))}元`, '全网低价'],
    price: fmtMoney(p.price),
    orig: fmtMoney(orig),
    tag: p.tag,
    pid: p.id,
  };
}

/** AI 商品 → 飞猪酒店卡（name/price/reviews/tag） */
function aiToHotel(p: TbProduct): (typeof TB_FLIGGY.hotels)[number] {
  return {
    name: p.title,
    price: fmtMoney(p.price),
    reviews: `${300 + (tbStrHash(p.id) % 700)}+条点评`,
    tag: p.tag,
  };
}

// ---------------- 淘票票 AI 条目转换（Task 44：喜剧脱口秀/演唱会/周边/即将上映） ----------------

/** 宽松收窄：非空字符串截断，否则 undefined */
function strField(v: unknown, maxLen: number): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, maxLen) : undefined;
}

/** 喜剧脱口秀暖色渐变（与种子演出橙红调一致） */
const SHOW_PALETTES: Array<[string, string]> = [
  ['#FF8A00', '#E84A1F'],
  ['#FFB03A', '#F0641E'],
  ['#FF7A3C', '#E8452C'],
  ['#FFA04A', '#D93A1F'],
  ['#FF9A3C', '#C9401E'],
];
/** 演唱会紫蓝渐变（与种子演唱会一致） */
const CONCERT_PALETTES: Array<[string, string]> = [
  ['#7C5CFF', '#3B2A8C'],
  ['#9F7BFF', '#4A2F9C'],
  ['#6B4FE0', '#2B1F6E'],
  ['#8A6CFF', '#5A3AA0'],
  ['#5C4AD8', '#33267A'],
];
/** standup 兜底池（route 已兜底一层，此处防御模型漏字段+旧持久化数据） */
const SHOW_TAG_POOL = ['脱口秀', '漫才', '开放麦', '舞台剧', '即兴喜剧'];
const CONCERT_STATUS_LEFT = ['充足', '紧张', '少量余票'];

/** 即将上映：档期按标题哈希派生（未来 3~21 天，周X） */
function soonDateLabel(seed: number): string {
  const d = new Date();
  d.setDate(d.getDate() + 3 + (seed % 19));
  return `${d.getMonth() + 1}月${d.getDate()}日 ${['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()]}`;
}

/** AI 原始条目 → 即将上映新片（wantTo 万人想看） */
function aiToMovieUp(r: TbFeedRaw & { title: string; tag: string }, i: number): TbMovie {
  const h = tbStrHash(r.title);
  const pal = MOVIE_PALETTES[(h + i) % MOVIE_PALETTES.length];
  const want = typeof r.wantTo === 'number' && Number.isFinite(r.wantTo) && r.wantTo > 0 ? r.wantTo : Math.round((30 + (h % 300)) / 3) / 10;
  return {
    id: `ai-up-${r.title}`,
    title: r.title,
    want: `${want}万人想看`,
    badge: strField(r.badge, 8) ?? '2D',
    c1: pal[0],
    c2: pal[1],
  };
}

/** AI 原始条目 → 喜剧脱口秀演出 */
function aiToShow(r: TbFeedRaw & { title: string; tag: string }, i: number): TbShow {
  const h = tbStrHash(r.title);
  const pal = SHOW_PALETTES[(h + i) % SHOW_PALETTES.length];
  const price = typeof r.price === 'number' && Number.isFinite(r.price) && r.price >= 80 ? Math.round(r.price) : 80 + (h % 200);
  return {
    id: `ai-c-${r.title}`,
    title: r.title,
    sub: strField(r.sub, 24) ?? '平行喜剧厂牌 · 卡司盲盒',
    venue: strField(r.venue, 24) ?? '濮阳文化艺术中心小剧场',
    city: strField(r.city, 8) ?? '濮阳',
    dateRange: strField(r.dateRange, 28) ?? '11.08 周六 19:30',
    price: `${price}-${Math.round((price * 2.4) / 10) * 10}`,
    tag: typeof r.tag === 'string' && SHOW_TAG_POOL.includes(r.tag) ? r.tag : '脱口秀',
    c1: pal[0],
    c2: pal[1],
    hot: strField(r.hot, 12) ?? `已售${300 + (h % 900)}`,
  };
}

/** AI 原始条目 → 演唱会（票档由最低价确定性派生：内场VIP/看台A/看台B，末档=起价） */
function aiToConcert(r: TbFeedRaw & { title: string; tag: string }, i: number): TbConcert {
  const h = tbStrHash(r.title);
  const pal = CONCERT_PALETTES[(h + i) % CONCERT_PALETTES.length];
  const base = typeof r.price === 'number' && Number.isFinite(r.price) && r.price >= 180 ? Math.round(r.price) : 180 + (h % 900);
  const city = strField(r.city, 8) ?? '郑州';
  return {
    id: `ai-cc-${r.title}`,
    artist: strField(r.artist, 8) ?? '林晚风',
    tour: strField(r.tour, 20) ?? '星野世界巡回演唱会',
    city,
    venue: strField(r.venue, 24) ?? `${city}奥林匹克体育中心`,
    dateRange: strField(r.dateRange, 28) ?? '11.21-11.22 周五六 19:00',
    status: h % 4 === 0 ? 'soon' : 'on',
    c1: pal[0],
    c2: pal[1],
    hot: strField(r.hot, 12) ?? '已售1.2万',
    tiers: [
      { name: '内场VIP', price: Math.round((base * 2.6) / 10) * 10, left: h % 3 === 0 ? '紧张' : '充足' },
      { name: '看台A', price: Math.round((base * 1.6) / 10) * 10, left: h % 4 === 0 ? '紧张' : '充足' },
      { name: '看台B', price: base, left: CONCERT_STATUS_LEFT[h % CONCERT_STATUS_LEFT.length] },
    ],
  };
}

/** AI 原始条目 → 周边商品 */
function aiToMerch(r: TbFeedRaw & { title: string; tag: string }): TbMerch {
  const h = tbStrHash(r.title);
  const price = typeof r.price === 'number' && Number.isFinite(r.price) && r.price >= 19 ? Math.round(r.price) : 39 + (h % 200);
  const orig = typeof r.origPrice === 'number' && Number.isFinite(r.origPrice) && r.origPrice > price ? Math.round(r.origPrice) : undefined;
  return {
    id: `ai-pm-${r.title}`,
    title: r.title,
    from: strField(r.from, 30) ?? '《群星闪耀时》官方周边',
    price,
    orig,
    tag: r.tag,
    hot: strField(r.hot, 12) ?? `已售${500 + (h % 3000)}`,
    kind: strField(r.kind, 6) ?? '手办',
  };
}

// ============================== 百亿补贴 ==============================

/** 百亿补贴（截图1：红底 频道页——疯狂加补周/国家补贴四宫格/频道惊喜权益/补贴商品流） */
export function SubsidyPage({
  uid,
  onBack,
  onToast,
  onOpenProduct,
}: {
  uid: string;
  onBack: () => void;
  onToast: (m: string) => void;
  onOpenProduct: (pid: string) => void;
}) {
  const [, setTick] = useState(0);
  const [tab, setTab] = useState('精选');
  const [packetsOpen, setPacketsOpen] = useState(true);
  // 双向刷新（Task 40/41/45）：顶部下拉 → AI 新补贴商品前插（旧内容原位保留）；
  // 底部上拉 → AI 新补贴商品追加到列表底部（上方内容不变、不跳屏）；
  // 全部持久化 —— 刷新页面/重开 App 后原样恢复（useTbChannelFeed）
  const { state: feedState, refresh } = useTbChannelFeed(
    uid,
    'subsidy',
    3,
    onToast,
    '已刷新，最新补贴商品已更新到顶部',
    '已加载新的补贴商品在下方，上方内容不变',
    TB_SUBSIDY.items.map((i) => i.title),
  );
  const pull = useTbPullRefresh((dir) => refresh(4, dir));
  // AI 前插（经 productById 解析含 AI 注册表 → 转补贴条目，点击可进商品详情）+ 本地确定性批次
  const aiItems = useMemo(() => {
    return feedState.aiTops.flatMap((t) => {
      const p = productById(t.pid);
      return p ? [aiToSubsidy(p)] : [];
    });
  }, [feedState.aiTops]);
  const batchItems = useMemo(() => {
    return feedState.batches.flatMap((b) =>
      Array.from({ length: 2 }, (_, i) => {
        const src = TB_SUBSIDY.items[(b * 2 + i) % TB_SUBSIDY.items.length];
        return { ...src, id: `${src.id}·r${b}-${i}` };
      }),
    );
  }, [feedState.batches]);
  const freshItems = useMemo(() => [...aiItems, ...batchItems], [aiItems, batchItems]);
  // 底部追加（Task 45）：AI 追加条目 + 本地兜底批次，渲染在列表最后（上方内容原位不变）
  const aiTailItems = useMemo(() => {
    return feedState.aiTails.flatMap((t) => {
      const p = productById(t.pid);
      return p ? [aiToSubsidy(p)] : [];
    });
  }, [feedState.aiTails]);
  const tailBatchItems = useMemo(() => {
    return feedState.tailBatches.flatMap((b) =>
      Array.from({ length: 2 }, (_, i) => {
        const src = TB_SUBSIDY.items[(b * 2 + i + 5) % TB_SUBSIDY.items.length];
        return { ...src, id: `${src.id}·t${b}-${i}` };
      }),
    );
  }, [feedState.tailBatches]);
  const coupons = tbLoadCoupons(uid);
  const claim = (name: string, amount: number, min: number) => {
    if (tbClaimCoupon(uid, { name, amount, min, pids: [] })) {
      setTick((n) => n + 1);
      onToast(`领取成功：${name} ¥${amount}`);
    } else onToast('已领取过该红包');
  };
  return (
    <div className="flex h-full flex-col bg-[#E42323]">
      {/* 顶栏（红底：返回 + 百亿补贴 + 搜索 + 更多） */}
      <div className="relative z-30 shrink-0 bg-gradient-to-b from-[#C41820] to-[#E42323] px-3 pb-3 pt-[56px]">
        <div className="flex items-center gap-2">
          <HeadBtn onClick={onBack} label="返回" dark>
            <ArrowLeft className="h-[20px] w-[20px] text-white" strokeWidth={2.4} />
          </HeadBtn>
          <span className="text-[24px] font-black italic leading-none tracking-tight text-white">百亿补贴</span>
          <div className="ml-auto flex h-[38px] min-w-0 flex-1 max-w-[190px] items-center gap-1.5 rounded-full bg-white pl-3 pr-1">
            <Search className="h-[16px] w-[16px] shrink-0 text-[#E42323]" strokeWidth={2.4} />
            <span className="min-w-0 flex-1 truncate text-[13.5px] text-black/75">提亮高光粉</span>
            <span className="grid h-[30px] shrink-0 place-items-center rounded-full bg-[#E42323] px-3 text-[13px] font-semibold text-white">搜索</span>
          </div>
          <HeadBtn onClick={() => onToast('更多（演示）')} label="更多" dark>
            <MoreHorizontal className="h-[19px] w-[19px] text-white" strokeWidth={2.2} />
          </HeadBtn>
        </div>
        {/* 疯狂加补周横幅 */}
        <button type="button" onClick={() => onToast('疯狂加补周（演示）')} className="mt-3 flex w-full items-center justify-between px-1 text-left active:opacity-85">
          <span className="text-[30px] font-black italic leading-none tracking-tight text-white drop-shadow-[0_2px_0_rgba(0,0,0,0.15)]">疯狂加补周</span>
          <span className="flex flex-col items-center">
            <TbImg src={tbImg('toy', 120, 90, 8)} alt="加补周好物" className="h-[46px] w-[68px] rounded-lg" />
            <span className="mt-0.5 flex items-center rounded-full bg-[#FFD100] px-2 py-px text-[11px] font-bold text-[#C41820]">
              立即抢
              <ChevronRight className="h-3 w-3" strokeWidth={3} />
            </span>
          </span>
          <span className="text-[21px] font-black italic leading-none tracking-tight text-white drop-shadow-[0_2px_0_rgba(0,0,0,0.15)]">7折抢小米电视</span>
        </button>
      </div>

      <div className="relative min-h-0 flex-1">
        <div ref={pull.scrollRef} {...pull.bind} className="h-full overflow-y-auto px-2 pb-8">
        {/* 四图横滑卡 */}
        <div className="grid grid-cols-4 gap-1.5 rounded-2xl bg-white p-2">
          {TB_SUBSIDY.hero.map((h, i) => (
            <div key={i} className="relative">
              <TbImg src={tbImg(h.tag, 160, 160, i)} alt={h.label} className="h-[86px] w-full rounded-lg" />
              <span className="absolute bottom-1 left-1 rounded-[4px] bg-[#E42323] px-1 py-px text-[9.5px] font-bold leading-[13px] text-white">{h.label}</span>
            </div>
          ))}
        </div>
        {/* 国家补贴 / 补上加补 / 多人团 / 水蛋奶 */}
        <div className="mt-2 grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-black/[0.06]">
          {TB_SUBSIDY.grid.map((g) => (
            <button key={g.name} type="button" onClick={() => onToast(`${g.name}（演示）`)} className="flex items-center justify-between bg-white p-3 text-left active:opacity-80">
              <div className="min-w-0">
                <div className="flex items-center gap-1">
                  {g.kind === 'nation' ? (
                    <span className="grid h-[18px] w-[18px] place-items-center rounded-full bg-[#00A860]">
                      <Check className="h-2.5 w-2.5 text-white" strokeWidth={3.4} />
                    </span>
                  ) : g.kind === 'boost' ? (
                    <span className="grid h-[18px] w-[18px] place-items-center rounded-[5px] bg-[#FF3B30]">
                      <Zap className="h-2.5 w-2.5 fill-white text-white" />
                    </span>
                  ) : g.kind === 'team' ? (
                    <span className="grid h-[18px] w-[18px] place-items-center rounded-full bg-[#FF3B30]">
                      <span className="text-[10px] font-bold text-white">团</span>
                    </span>
                  ) : (
                    <span className="grid h-[18px] w-[18px] place-items-center rounded-full bg-[#FF3B30]">
                      <span className="text-[9px] font-bold text-[#FFD100]">奶</span>
                    </span>
                  )}
                  <span className="text-[15px] font-bold text-black/90">{g.name}</span>
                  <ChevronRight className="h-3.5 w-3.5 text-black/25" />
                </div>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="text-[22px] font-black leading-none text-[#FF0036]">
                    <span className="text-[13px] font-bold">¥</span>
                    {g.price}
                  </span>
                  {g.extra ? <span className="text-[11.5px] font-semibold text-[#FF0036]">{g.extra}</span> : null}
                </div>
              </div>
              <TbImg src={tbImg(g.tag, 120, 140, 2)} alt={g.name} className="h-[72px] w-[58px] shrink-0 rounded-lg" />
            </button>
          ))}
        </div>
        {/* 频道惊喜权益（红包领取入账） */}
        <div className="mt-2 rounded-2xl bg-white p-3">
          <div className="flex items-center">
            <span className="text-[16px] font-bold text-black/90">频道惊喜权益</span>
            <button type="button" onClick={() => setPacketsOpen((v) => !v)} className="ml-auto flex items-center text-[13px] text-black/35 active:opacity-70">
              {packetsOpen ? '收起' : '展开'}
              {packetsOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          </div>
          {packetsOpen ? (
            <div className="mt-2.5 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {TB_SUBSIDY.redpackets.map((p) => {
                const claimed = coupons.some((x) => x.name === p.name && !x.usedAt);
                return (
                  <div key={p.name} className={`w-[128px] shrink-0 rounded-xl bg-gradient-to-b from-[#FF4A38] to-[#F01E1E] p-2.5 ${claimed ? 'opacity-60' : ''}`}>
                    <div className="flex items-baseline gap-0.5 text-white">
                      <span className="text-[26px] font-black leading-none">
                        {p.amount}
                        <span className="text-[12px] font-bold">元</span>
                      </span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-white/85">满{p.min}可用</div>
                    <div className="mt-1 text-[12.5px] font-bold text-white">惊喜红包</div>
                    <button
                      type="button"
                      onClick={() => (claimed ? onToast('已领取过该红包') : claim(p.name, p.amount, p.min))}
                      className="mt-1.5 h-[26px] w-full rounded-full bg-white text-[12px] font-bold text-[#F01E1E] active:opacity-80"
                    >
                      {claimed ? '已领取' : '立即领用'}
                    </button>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
        {/* 频道 tab（吸顶：滚动时固定，商品流跟随滚动） */}
        <div className="sticky top-0 z-20 -mx-2 flex items-center gap-5 overflow-x-auto bg-[#E42323] px-3 py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {TB_SUBSIDY.tabs.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`shrink-0 whitespace-nowrap text-[17px] font-bold transition-colors ${tab === t ? 'text-white' : t === '补上加补' ? 'text-[#F5C86B]' : t === '苹果专区' ? 'text-[#FFB3B3]' : 'text-white/75'}`}
            >
              {t}
            </button>
          ))}
        </div>
        {/* 补贴商品流（下拉新商品前插在顶部、底部拉一拉新商品追加在末尾，旧商品原位保留） */}
        <div className="flex flex-col gap-2">
          {[...freshItems, ...TB_SUBSIDY.items, ...aiTailItems, ...tailBatchItems].map((it) => (
            <div key={it.id} className="flex gap-2.5 rounded-2xl bg-white p-2">
              <div className="relative w-[122px] shrink-0">
                <TbImg src={tbImg(it.tag, 240, 240, it.id.length)} alt={it.title} className={`h-[122px] w-full rounded-xl ${it.soldOut ? 'opacity-80' : ''}`} />
                {it.soldOut ? (
                  <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rotate-[-14deg] rounded-lg border-[2.5px] border-[#5c6b80]/80 px-2 py-1 text-center text-[15px] font-black leading-[18px] tracking-[3px] text-[#42506380]">
                    已抢光
                    <span className="block text-[8px] font-bold leading-[10px] tracking-[1px]">SOLD OUT</span>
                  </span>
                ) : (
                  <span className="absolute bottom-1.5 left-1.5 flex items-center gap-0.5 rounded-full bg-[#FFDCE4] px-1.5 py-px text-[10px] font-bold text-[#FF2D6B]">
                    180天最低
                    <Zap className="h-2.5 w-2.5 fill-[#FF2D6B]" />
                  </span>
                )}
              </div>
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex items-center gap-1">
                  <span className="shrink-0 rounded-[4px] bg-gradient-to-r from-[#FF7A45] to-[#FF2D55] px-1 py-px text-[10px] font-bold text-white">百亿补贴|超级88</span>
                  <span className="shrink-0 rounded-[4px] bg-black/80 px-1 py-px text-[10px] font-bold text-white">品牌</span>
                  <span className="shrink-0 rounded-[4px] bg-[#F7E6C3] px-1 py-px text-[10px] font-bold text-[#8a6300]">买贵必赔</span>
                </div>
                <div className="mt-1 line-clamp-2 text-[15px] font-bold leading-[20px] text-black/90">{it.title}</div>
                <div className="mt-0.5 text-[12px] text-black/45">{it.sub}</div>
                {it.specs ? (
                  <div className="mt-1.5 flex items-center">
                    {it.specs.map((s, i) => (
                      <span key={s} className={`flex-1 ${i > 0 ? 'border-l border-black/[0.08] pl-2 ml-2' : ''}`}>
                        <span className="block truncate text-[12px] text-black/75">{s}</span>
                        <span className="block text-[10.5px] text-black/35">{it.specLabels?.[i]}</span>
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="mt-0.5 truncate text-[12.5px] font-semibold text-[#8a6300]">{it.foot}</div>
                )}
                <div className="mt-auto flex items-end">
                  <span className="rounded-l-lg bg-gradient-to-r from-[#FFE3E8] to-[#FFE9E2] py-1 pl-1.5 pr-2 text-[#FF0036]">
                    <span className="text-[13px] font-bold">¥</span>
                    <span className="text-[26px] font-black leading-none">{it.price}</span>
                    <span className="text-[11px] text-black/45">{it.unit}</span>
                    {it.orig ? <span className="ml-1 text-[11px] text-black/35 line-through">{it.orig}</span> : null}
                  </span>
                  <button
                    type="button"
                    onClick={() => (it.pid ? onOpenProduct(it.pid) : onToast('抢购成功（演示）'))}
                    className="ml-auto grid h-[38px] w-[46px] shrink-0 place-items-center rounded-lg bg-gradient-to-b from-[#FF6E9C] to-[#FF2D6B] text-[17px] font-bold text-white active:opacity-85"
                  >
                    抢
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
        </div>
        <TbPullIndicator h={pull} />
      </div>
    </div>
  );
}

// ============================== 淘宝秒杀 ==============================

/** 淘宝秒杀（截图2：橙底——超级88换季/9块9疯抢/整点抢红包/正在秒杀倒计时商品流） */
export function SeckillPage({
  uid,
  onBack,
  onToast,
  onOpenProduct,
}: {
  uid: string;
  onBack: () => void;
  onToast: (m: string) => void;
  onOpenProduct: (pid: string) => void;
}) {
  const [tab, setTab] = useState('精选');
  // 双向刷新（Task 40/41/45）：顶部下拉 → AI 新秒杀商品前插（旧内容原位保留，就在场次标签下方可见）；
  // 底部上拉 → AI 新秒杀商品追加到列表末尾（上方内容不变、不跳屏——修复「刷新后看不到变化」）；
  // 全部持久化 —— 刷新页面/重开 App 后原样恢复（useTbChannelFeed）
  const { state: feedState, refresh } = useTbChannelFeed(
    uid,
    'seckill',
    3,
    onToast,
    '已刷新，最新秒杀商品已更新到顶部',
    '已加载新的秒杀商品在下方，上方内容不变',
    TB_SECKILL.items.map((i) => i.title),
  );
  const pull = useTbPullRefresh((dir) => refresh(4, dir));
  const aiItems = useMemo(() => {
    return feedState.aiTops.flatMap((t) => {
      const p = productById(t.pid);
      return p ? [aiToSeckill(p)] : [];
    });
  }, [feedState.aiTops]);
  const batchItems = useMemo(() => {
    return feedState.batches.flatMap((b) =>
      Array.from({ length: 2 }, (_, i) => {
        const src = TB_SECKILL.items[(b * 2 + i) % TB_SECKILL.items.length];
        return { ...src, id: `${src.id}·r${b}-${i}` };
      }),
    );
  }, [feedState.batches]);
  const freshItems = useMemo(() => [...aiItems, ...batchItems], [aiItems, batchItems]);
  // 底部追加（Task 45）：AI 追加秒杀商品 + 本地兜底批次，渲染在列表最后（上方内容原位不变）
  const aiTailItems = useMemo(() => {
    return feedState.aiTails.flatMap((t) => {
      const p = productById(t.pid);
      return p ? [aiToSeckill(p)] : [];
    });
  }, [feedState.aiTails]);
  const tailBatchItems = useMemo(() => {
    return feedState.tailBatches.flatMap((b) =>
      Array.from({ length: 2 }, (_, i) => {
        const src = TB_SECKILL.items[(b * 2 + i + 5) % TB_SECKILL.items.length];
        return { ...src, id: `${src.id}·t${b}-${i}` };
      }),
    );
  }, [feedState.tailBatches]);
  // 正在秒杀倒计时（23:54:08.6 起跳，0.1s 步进）
  const [left, setLeft] = useState(23 * 3600 + 54 * 60 + 8.6);
  useEffect(() => {
    const t = setInterval(() => setLeft((n) => (n > 0 ? Math.round((n - 0.1) * 10) / 10 : 0)), 100);
    return () => clearInterval(t);
  }, []);
  const cd = `${String(Math.floor(left / 3600)).padStart(2, '0')}:${String(Math.floor((left % 3600) / 60)).padStart(2, '0')}:${String(Math.floor(left % 60)).padStart(2, '0')}.${Math.floor((left % 1) * 10)}`;
  const topGroups = [TB_SECKILL.top.slice(0, 2), TB_SECKILL.top.slice(2, 4)];
  return (
    <div className="relative flex h-full flex-col bg-[#FF5000]">
      {/* 返回悬浮钮（用户需求：顶栏/横幅等全部跟随滚动，仅场次标签吸顶——返回键常驻避免滚走后被困） */}
      <button type="button" aria-label="返回" onClick={onBack} className="absolute left-2 top-[64px] z-40 grid h-9 w-9 place-items-center rounded-full bg-black/25 backdrop-blur-sm active:opacity-70">
        <ArrowLeft className="h-[20px] w-[20px] text-white" strokeWidth={2.4} />
      </button>
      {/* 状态栏安全区（唯一固定区，仅占高度）——用户需求：除场次标签吸顶外其余全部跟随滚动 */}
      <div className="relative z-30 h-[56px] shrink-0 bg-[#FF6A1E]" />
      <div className="relative min-h-0 flex-1">
        <div ref={pull.scrollRef} {...pull.bind} className="h-full overflow-y-auto px-2 pb-8">
        {/* 顶栏（跟随滚动：-mx-2 拉通全宽渐变底；返回键已提为悬浮钮） */}
        <div className="relative z-30 -mx-2 bg-gradient-to-b from-[#FF6A1E] to-[#FF5000] px-3 pb-3">
          <div className="flex items-center gap-2 pl-11">
            <span className="text-[23px] font-black italic leading-none tracking-tight text-[#FFE84D]">淘宝秒杀</span>
            <div className="ml-auto flex h-[38px] min-w-0 flex-1 max-w-[190px] items-center gap-1.5 rounded-full bg-white/95 pl-3">
              <Search className="h-[16px] w-[16px] shrink-0 text-black/40" />
              <span className="min-w-0 flex-1 truncate text-[13.5px] text-black/70">备用手机</span>
              <span className="grid h-[30px] shrink-0 place-items-center rounded-full bg-[#FF3B30] px-2.5 text-[13px] font-semibold text-white">搜低价</span>
            </div>
            <HeadBtn onClick={() => onToast('更多（演示）')} label="更多" dark>
              <MoreHorizontal className="h-[19px] w-[19px] text-white" strokeWidth={2.2} />
            </HeadBtn>
          </div>
          {/* 超级88换季必备横幅 */}
          <button type="button" onClick={() => onToast('超级88换季必备（演示）')} className="relative mt-2 flex h-[104px] w-full items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-r from-[#FF7A21] via-[#FF5A10] to-[#FF7A21] active:opacity-90">
            <span className="text-[40px] font-black italic leading-none tracking-tight text-[#FFE84D] drop-shadow-[0_2px_0_rgba(0,0,0,0.18)]">超级88</span>
            <TbImg src={tbImg('toy', 120, 120, 3)} alt="换季好物" className="mx-2 h-[76px] w-[76px] rounded-xl" />
            <span className="text-[40px] font-black italic leading-none tracking-tight text-white drop-shadow-[0_2px_0_rgba(0,0,0,0.18)]">换季必备</span>
            <span className="absolute bottom-2 right-2 rounded-md bg-black/30 px-1.5 py-px text-[11px] font-semibold text-white">1/4</span>
          </button>
        </div>
        {/* 9块9品牌疯抢 / 0.99产地直发 */}
        <div className="rounded-2xl bg-white p-3">
          <div className="grid grid-cols-2 gap-3">
            {topGroups.map((g, gi) => (
              <div key={gi}>
                <div className="text-[19px] font-black italic leading-none text-[#FF0036]">
                  {gi === 0 ? '9块9' : '0.99'}
                  <span className="text-[13px] font-bold text-black/85">{gi === 0 ? '品牌疯抢' : '产地直发'}</span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-1.5">
                  {g.map((it, i) => (
                    <button key={i} type="button" onClick={() => onToast('秒杀价已锁定（演示）')} className="text-left active:opacity-80">
                      <div className="relative">
                        <TbImg src={tbImg(it.tag, 160, 160, i + 4)} alt={it.label} className="h-[84px] w-full rounded-lg" />
                        <span className="absolute bottom-0.5 left-0.5 rounded-[4px] bg-[#FF3B30] px-1 py-px text-[9px] font-bold text-white">{it.label}</span>
                      </div>
                      <div className="mt-1 text-[15px] font-black text-[#FF0036]">
                        <span className="text-[11px] font-bold">¥</span>
                        {it.price}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          {/* 一分领商品 + 整点抢红包 */}
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => onToast('一分领商品（演示）')} className="flex h-[42px] flex-1 items-center gap-2 rounded-lg bg-[#FFF3C2] px-2.5 text-left active:opacity-80">
              <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full bg-[#FFD100] text-[13px] font-black text-[#8a6300]">1分</span>
              <span className="text-[14px] font-bold text-black/85">一分领商品</span>
              <ChevronRight className="h-4 w-4 text-black/30" />
            </button>
            <button type="button" onClick={() => onToast('整点抢红包（演示）')} className="flex h-[42px] flex-1 items-center gap-1.5 rounded-lg bg-[#FF3B30] px-2.5 text-left active:opacity-85">
              <span className="text-[17px] font-black text-[#FFE84D]">¥5</span>
              <span className="text-[14px] font-bold text-white">整点抢红包</span>
              <span className="ml-auto text-[16px] font-black text-white">抢</span>
            </button>
          </div>
        </div>
        {/* 正在秒杀（白面板 + 倒计时） */}
        <div className="mt-2.5 rounded-t-2xl bg-white px-3 pt-3">
          <div className="flex items-center">
            <span className="text-[21px] font-black italic leading-none text-[#FF0036]">正在秒杀</span>
            <span className="ml-2 flex items-center gap-0.5 font-mono text-[14px] font-bold text-white">
              <span className="rounded-[4px] bg-[#FF3B30] px-1 py-px">{cd.slice(0, 2)}</span>
              <span className="text-[#FF3B30]">:</span>
              <span className="rounded-[4px] bg-[#FF3B30] px-1 py-px">{cd.slice(3, 5)}</span>
              <span className="text-[#FF3B30]">:</span>
              <span className="rounded-[4px] bg-[#FF3B30] px-1 py-px">{cd.slice(6)}</span>
            </span>
            <button type="button" onClick={() => onToast('明天20点场（演示）')} className="ml-auto text-[14px] font-semibold text-black/60 active:opacity-70">明天20点抢</button>
            <span className="mx-1.5 h-3 w-px bg-black/10" />
            <button type="button" onClick={() => onToast('后天20点场（演示）')} className="text-[14px] font-semibold text-black/60 active:opacity-70">后天20点抢</button>
          </div>
        </div>
        {/* 场次 tab（吸顶：滚动时固定，商品流跟随滚动） */}
        <div className="sticky top-0 z-20 -mx-2 flex items-center gap-5 overflow-x-auto bg-white px-5 pb-2.5 pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {TB_SECKILL.tabs.map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)} className={`shrink-0 whitespace-nowrap text-[16.5px] font-bold transition-colors ${tab === t ? 'text-[#FF0036]' : 'text-black/65'}`}>
              {t}
            </button>
          ))}
        </div>
        {/* 秒杀商品流（下拉新商品前插在顶部、底部拉一拉新商品追加在末尾，旧商品原位保留） */}
        <div className="rounded-b-2xl bg-white px-2 pb-3 pt-1">
          {[...freshItems, ...TB_SECKILL.items, ...aiTailItems, ...tailBatchItems].map((it) => (
            <div key={it.id} className="flex gap-2.5 border-t border-black/[0.05] px-0.5 py-3 first:border-t-0">
              <TbImg src={tbImg(it.tag, 220, 220, it.id.length + 2)} alt={it.title} className="h-[112px] w-[112px] shrink-0 rounded-xl" />
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="truncate text-[15.5px] font-bold text-black/90">{it.title}</div>
                <div className="mt-1.5 flex items-center gap-1.5">
                  <span className="flex h-[12px] w-[110px] overflow-hidden rounded-full bg-black/[0.08]">
                    <span className="h-full rounded-full bg-gradient-to-r from-[#FFD100] to-[#FF9A00]" style={{ width: `${it.grab}%` }} />
                  </span>
                  <span className="text-[11px] font-semibold text-[#FF6A1E]">已抢{it.grab}%</span>
                  <span className="ml-auto text-[12px] text-black/45">{it.sold}</span>
                </div>
                <div className="mt-1.5 flex items-center gap-2 text-[12px]">
                  {it.foot.map((f) => (
                    <span key={f} className="flex items-center gap-0.5 font-semibold text-[#FF0036]">
                      {f.startsWith('直降') ? <Zap className="h-3 w-3 fill-[#FF0036]" /> : null}
                      {f}
                    </span>
                  ))}
                </div>
                <div className="mt-auto flex items-end">
                  <span className="rounded-l-lg bg-gradient-to-r from-[#FFE3E8] to-[#FFE9E2] py-1 pl-1.5 pr-2">
                    <span className="text-[13px] font-bold text-[#FF0036]">¥</span>
                    <span className="text-[25px] font-black leading-none text-[#FF0036]">{it.price}</span>
                    <span className="ml-0.5 text-[11px] font-semibold text-[#FF0036]">秒杀价</span>
                    <span className="ml-1 text-[11px] text-black/35 line-through">优惠前{it.orig}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => (it.pid ? onOpenProduct(it.pid) : onToast('抢购成功（演示）'))}
                    className="ml-auto grid h-[38px] w-[46px] shrink-0 place-items-center rounded-lg bg-gradient-to-b from-[#FF4A2A] to-[#FF2600] text-[17px] font-bold text-white active:opacity-85"
                  >
                    抢
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
        </div>
        <TbPullIndicator h={pull} />
      </div>
    </div>
  );
}

// ============================== 红包签到 ==============================

/** 红包签到·领现金（截图3：橙红——签到日历/赚元宝/点击领取/连续打卡/任务栏/客户案例） */
export function SignInPage({ uid, onBack, onToast }: { uid: string; onBack: () => void; onToast: (m: string) => void }) {
  const [sign, setSign] = useState(() => tbLoadSign(uid));
  const today = tbSignToday();
  const doneToday = sign.last === today;
  // 连签槽位数（已签今天 = 连签第 n 天；未签 = 已连续 n 天）
  const filled = doneToday ? ((sign.streak - 1) % 5) + 1 : sign.streak % 5;
  const pct = Math.min(100, (sign.coins / TB_SIGN_GOAL) * 100);
  const cash = (sign.coins / TB_SIGN_GOAL).toFixed(2);
  const [cdLeft, setCdLeft] = useState(3 * 3600 + 54 * 60 + 49);
  useEffect(() => {
    const t = setInterval(() => setCdLeft((n) => (n > 0 ? n - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, []);
  const cdText = `${String(Math.floor(cdLeft / 3600)).padStart(2, '0')}:${String(Math.floor((cdLeft % 3600) / 60)).padStart(2, '0')}:${String(cdLeft % 60).padStart(2, '0')}`;

  const doSign = () => {
    if (doneToday) {
      onToast('今日已签到，明天再来领现金');
      return;
    }
    const next = { ...sign, last: today, streak: sign.streak + 1, coins: sign.coins + 7200 };
    tbSaveSign(uid, next);
    setSign(next);
    onToast('签到成功，元宝+7200');
  };
  const takeBonus = (amount: number, label: string) => {
    if (sign.bonusDay === today && sign.last === today) {
      onToast('今日已领取，明天再来');
      return;
    }
    const next = { ...sign, coins: sign.coins + amount, bonusDay: today, last: sign.last };
    tbSaveSign(uid, next);
    setSign(next);
    onToast(`${label}，元宝+${amount}`);
  };
  const coinIcon = (size = 34) => (
    <svg width={size} height={size * 0.72} viewBox="0 0 40 29" aria-hidden="true">
      <ellipse cx="20" cy="18" rx="17" ry="10" fill="#FFD100" />
      <ellipse cx="20" cy="14" rx="15" ry="9" fill="#FFE14D" />
      <path d="M8 10c3-4 8-6 12-6s9 2 12 6" stroke="#FFC300" strokeWidth="2.4" fill="none" strokeLinecap="round" />
    </svg>
  );
  const tasks = [
    { icon: <Wallet className="h-[22px] w-[22px] text-white" strokeWidth={2} />, bg: 'from-[#4A9BFF] to-[#2E7BE8]', label: '天天提现', badge: '' },
    { icon: <span className="grid h-[22px] w-[22px] place-items-center rounded-full bg-white/25"><svg width="14" height="16" viewBox="0 0 14 16" aria-hidden="true"><path d="M7 4c2-2 4.5-2.6 6-2-.4 2-1.6 3.4-3 4 1.8.6 3 2 3 4.2 0 2.8-2.4 5-6 5s-6-2.2-6-5C1 8 2.2 6.6 4 6 2.6 5.4 1.4 4 1 2c1.5-.6 4 0 6 2Z" fill="#fff"/></svg></span>, bg: 'from-[#FFB03A] to-[#FF8A00]', label: '抽iphone', badge: '' },
    { icon: <span className="text-[11px] font-black leading-[12px] text-white">40元</span>, bg: 'from-[#FF5A4A] to-[#F01E1E]', label: '折扣红包', badge: '' },
    { icon: <span className="text-[15px] font-black text-[#8a6300]">¥</span>, bg: 'from-[#FFE14D] to-[#FFC300]', label: '点击领取', badge: '+40' },
    { icon: <Play className="h-[20px] w-[20px] fill-white text-white" />, bg: 'from-[#FFB03A] to-[#FF8A00]', label: '看小说短剧', badge: '+500' },
    { icon: <span className="text-[13px] font-black text-white">蚁</span>, bg: 'from-[#3BC46A] to-[#1E9E4E]', label: '去蚂蚁', badge: '' },
  ];
  return (
    <div className="flex h-full flex-col bg-gradient-to-b from-[#FF7A2E] via-[#FF5A28] to-[#FF3B30]">
      {/* 顶栏 */}
      <div className="relative z-30 shrink-0 px-3 pt-[56px]">
        <div className="flex items-center gap-2">
          <HeadBtn onClick={onBack} label="返回" dark>
            <ArrowLeft className="h-[20px] w-[20px] text-white" strokeWidth={2.4} />
          </HeadBtn>
          <span className="text-[21px] font-black leading-none text-white">
            红包签到·<span className="text-[#FFE84D]">领现金</span>
          </span>
          <button type="button" onClick={() => onToast('规则：签到得元宝，攒满可提现')} className="ml-auto rounded-md bg-black/25 px-2.5 py-1 text-[13px] font-medium text-white active:opacity-70">规则</button>
          <HeadBtn onClick={() => onToast('更多（演示）')} label="更多" dark>
            <MoreHorizontal className="h-[19px] w-[19px] text-white" strokeWidth={2.2} />
          </HeadBtn>
        </div>
        {/* 提现进度 + 10元提现卡 */}
        <div className="mt-2 flex items-start justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1 text-[15px] font-bold text-white/95">
              再攒
              {coinIcon(26)}
              100000提现
            </div>
            <div className="mt-0.5 font-black leading-none text-white">
              <span className="text-[56px] tracking-tight">{cash.split('.')[0]}</span>
              <span className="text-[30px]">.{cash.split('.')[1]}</span>
              <span className="text-[20px] font-bold">元</span>
            </div>
            <div className="mt-2 h-[9px] w-[86%] overflow-hidden rounded-full bg-black/20">
              <span className="block h-full rounded-full bg-gradient-to-r from-[#FFD100] to-[#FFAA00]" style={{ width: `${Math.max(1.5, pct)}%` }} />
            </div>
            <div className="mt-1 text-[11px] text-white/70">{Math.floor(pct)}%</div>
          </div>
          <button type="button" onClick={() => onToast('攒满10元即可提现（演示）')} className="mt-1 w-[128px] shrink-0 rotate-[2deg] rounded-2xl bg-[#2E9BFF] p-1.5 shadow-lg ring-2 ring-white/50 active:opacity-85">
            <div className="rounded-xl bg-white px-2 py-2 text-center">
              <div className="text-[27px] font-black leading-none text-[#1E5FD8]">
                10<span className="text-[13px]">元</span>
              </div>
              <div className="mt-0.5 text-[11px] font-medium text-[#1E5FD8]/70">攒满提现 &gt;</div>
              <div className="mt-1 flex justify-center gap-1">
                <span className="grid h-[16px] w-[16px] place-items-center rounded-full bg-[#1677FF] text-[9px] font-bold text-white">支</span>
                <span className="grid h-[16px] w-[16px] place-items-center rounded-full bg-[#22C55E] text-[9px] font-bold text-white">微</span>
              </div>
            </div>
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-8">
        {/* 连续签到奖励卡 */}
        <div className="mt-2 rounded-2xl bg-white p-3">
          <div className="flex items-center gap-2">
            <span className="text-[17px] font-black text-black/90">
              连续签到奖励 <span className="text-[15px]">({filled}/5)</span>
            </span>
            <span className="min-w-0 flex-1 truncate text-[12px] text-black/40">t*k提现100元，推荐您参与</span>
            <button type="button" onClick={() => onToast('已开启签到提醒')} className="flex shrink-0 items-center gap-1 rounded-full bg-black/[0.06] px-2.5 py-1.5 text-[12px] font-medium text-black/70 active:opacity-70">
              <Bell className="h-3.5 w-3.5" />
              开启提醒
            </button>
          </div>
          {/* 五日槽 */}
          <div className="mt-2.5 grid grid-cols-5 gap-1.5">
            {TB_SIGN_SLOTS.map((s, i) => {
              const got = doneToday && i < filled;
              return (
                <div
                  key={i}
                  className={`relative flex flex-col items-center justify-center rounded-xl px-1 py-2 ${s.kind === 'today' ? 'bg-[#FFF3C2]' : s.kind === 'extra' ? 'bg-[#E8F3FF] ring-1 ring-[#8FC4FF]' : 'bg-black/[0.045]'}`}
                >
                  {got ? (
                    <span className="absolute right-0.5 top-0.5 grid h-[14px] w-[14px] place-items-center rounded-full bg-[#FF3B30]">
                      <Check className="h-2 w-2 text-white" strokeWidth={4} />
                    </span>
                  ) : null}
                  {coinIcon(30)}
                  {s.kind === 'today' ? (
                    <>
                      <span className="mt-1 text-[14px] font-black leading-none text-[#FF3B30]">{s.coins}</span>
                      <span className="mt-0.5 text-[10px] font-semibold text-[#c2482f]">{got ? '已完成' : s.label}</span>
                    </>
                  ) : s.kind === 'extra' ? (
                    <>
                      <span className="mt-1 text-[12px] font-black leading-[13px] text-[#1E7FE8]">额外提现</span>
                      <span className="mt-0.5 text-center text-[9.5px] leading-[11px] text-[#1E7FE8]/70">{s.label}</span>
                    </>
                  ) : (
                    <>
                      <span className="mt-1 text-[12.5px] font-bold leading-none text-black/75">领现金</span>
                      <span className="mt-0.5 text-[10px] text-black/40">{s.label}</span>
                    </>
                  )}
                </div>
              );
            })}
          </div>
          {/* 赚元宝 / 立即签到 / 点击领取 */}
          <div className="mt-2 flex items-stretch gap-2">
            <button type="button" onClick={() => takeBonus(8490, '看视频赚元宝')} className="relative flex w-[78px] shrink-0 flex-col items-center justify-center rounded-xl bg-gradient-to-b from-[#FFB25A] to-[#FF8A3C] py-2 active:opacity-85">
              <span className="absolute -top-1.5 left-1 rounded-full bg-[#FF3B30] px-1.5 py-px text-[10px] font-bold text-white">+8490</span>
              {coinIcon(32)}
              <span className="mt-1 text-[13px] font-bold text-white">赚元宝</span>
            </button>
            <button
              type="button"
              onClick={doSign}
              className={`h-[68px] min-w-0 flex-1 rounded-xl text-[23px] font-black tracking-[6px] text-white active:opacity-90 ${doneToday ? 'bg-black/20' : 'bg-gradient-to-r from-[#FF4A2A] to-[#F5222D]'}`}
            >
              {doneToday ? '已签到' : '立即签到'}
            </button>
            <button type="button" onClick={() => takeBonus(1280, '点击领取')} className="relative flex w-[78px] shrink-0 flex-col items-center justify-center rounded-xl bg-gradient-to-b from-[#FFB25A] to-[#FF8A3C] py-2 active:opacity-85">
              <span className="absolute -top-1.5 right-1 rounded-full bg-[#FF3B30] px-1.5 py-px text-[10px] font-bold text-white">+1280</span>
              {coinIcon(32)}
              <span className="mt-1 text-[13px] font-bold text-white">点击领取</span>
            </button>
          </div>
        </div>
        {/* 66元连续打卡卡 */}
        <div className="mt-2 flex items-center gap-3 rounded-2xl bg-white p-3">
          <div className="w-[88px] shrink-0 rounded-xl bg-gradient-to-b from-[#2ECC71] to-[#1E9E4E] p-2 text-center">
            <div className="text-[21px] font-black leading-none text-white">
              66<span className="text-[12px]">元</span>
            </div>
            <div className="mt-1 flex justify-center gap-1">
              <span className="grid h-[14px] w-[14px] place-items-center rounded-full bg-white text-[8px] font-bold text-[#1677FF]">支</span>
              <span className="grid h-[14px] w-[14px] place-items-center rounded-full bg-white text-[8px] font-bold text-[#22C55E]">微</span>
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[16.5px] font-black text-black/90">
              连续打卡<span className="text-[#FF3B30]">免费</span>领奖
            </div>
            <div className="mt-0.5 flex items-center gap-1 text-[12px] font-semibold text-[#FF3B30]">
              <Flame className="h-3.5 w-3.5 fill-[#FF3B30]" />
              3497056 人已领到
            </div>
          </div>
          <button type="button" onClick={() => onToast('连续打卡活动（演示）')} className="h-[40px] shrink-0 rounded-lg bg-[#FF3B30] px-4 text-[14.5px] font-bold text-white active:opacity-85">
            去参与
          </button>
        </div>
        {/* 任务栏（橙底） */}
        <div className="mt-3 grid grid-cols-6 gap-1 px-1">
          {tasks.map((t) => (
            <button key={t.label} type="button" onClick={() => onToast(`${t.label}（演示）`)} className="relative flex flex-col items-center gap-1 active:opacity-75">
              <span className={`relative grid h-[44px] w-[44px] place-items-center rounded-[12px] bg-gradient-to-b ${t.bg}`}>
                {t.icon}
                {t.badge ? <span className="absolute -right-2 -top-2 rounded-full bg-[#FF3B30] px-1 py-px text-[9px] font-bold text-white">{t.badge}</span> : null}
              </span>
              <span className="text-[10.5px] font-medium text-white/95">{t.label}</span>
            </button>
          ))}
        </div>
        {/* 搜索条 */}
        <div className="mt-3 flex h-[46px] items-center gap-2 rounded-xl bg-white px-2.5">
          <Search className="h-[19px] w-[19px] shrink-0 text-[#FF6A1E]" />
          <span className="min-w-0 flex-1 truncate text-[14.5px] text-black/80">备用手机</span>
          <span className="shrink-0 rounded-[4px] bg-[#FF3B30] px-1.5 py-px text-[10.5px] font-bold text-white">猜你想搜</span>
          <button type="button" onClick={() => onToast('搜索（演示）')} className="grid h-[34px] shrink-0 place-items-center rounded-lg bg-gradient-to-r from-[#FF7A21] to-[#FF4400] px-4 text-[14px] font-semibold text-white active:opacity-85">
            搜索
          </button>
        </div>
        {/* 客户案例分享 */}
        <div className="mt-3 text-[15px] font-black text-white">客户案例分享</div>
        <div className="mt-2 grid grid-cols-2 gap-2 pb-2">
          <button type="button" onClick={() => onToast('拍报机案例（演示）')} className="rounded-xl bg-white p-2 text-left active:opacity-80">
            <div className="grid grid-cols-2 gap-0.5 overflow-hidden rounded-lg">
              {[0, 1, 2, 3].map((i) => (
                <TbImg key={i} src={tbImg('kiosk', 160, 120, i)} alt="拍报机案例" className="h-[52px] w-full" />
              ))}
            </div>
            <div className="mt-1.5 line-clamp-2 text-[13px] font-bold leading-[17px] text-black/85">头条拍报机大头贴机器网红打卡</div>
            <div className="mt-0.5 text-[11px] text-[#FF3B30]">红包省2.74元 包邮</div>
            <div className="mt-0.5 flex items-baseline gap-1">
              <span className="text-[16px] font-black text-[#FF3B30]">
                <span className="text-[10px]">¥</span>407.26
              </span>
              <span className="text-[10px] font-semibold text-[#FF3B30]">红包价</span>
              <span className="ml-auto text-[10px] text-black/40">已售58件</span>
            </div>
          </button>
          <button type="button" onClick={() => onToast('浮球杯案例（演示）')} className="relative rounded-xl bg-white p-2 text-left active:opacity-80">
            <TbImg src={tbImg('mug', 320, 240, 6)} alt="卡通动物浮球杯" className="h-[110px] w-full rounded-lg" />
            <div className="mt-1.5 flex items-center gap-1">
              <span className="shrink-0 rounded-[3px] bg-[#FF3B30] px-1 py-px text-[9.5px] font-bold text-white">天天特价</span>
              <span className="truncate text-[13px] font-bold text-black/85">2026新款浮球杯</span>
            </div>
            <div className="mt-0.5 text-[11px] text-[#FF3B30]">红包省2.74元 包邮 满29</div>
            <div className="mt-0.5 flex items-baseline gap-1">
              <span className="text-[16px] font-black text-[#FF3B30]">
                <span className="text-[10px]">¥</span>7.27
              </span>
              <span className="text-[10px] font-semibold text-[#FF3B30]">红包价</span>
              <span className="ml-auto text-[10px] text-black/40">爆卖1万+件</span>
            </div>
            <span className="absolute bottom-9 right-1.5 rounded-lg bg-[#FF3B30] px-1.5 py-1 text-center text-white shadow-lg">
              <span className="block text-[13px] font-black leading-[15px]">
                2.74<span className="text-[9px]">元</span>
              </span>
              <span className="block font-mono text-[10px] leading-[12px]">{cdText}</span>
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================== 淘票票 ==============================

/** 电影海报（渐变 + 片名叠字，免图片依赖） */
function MoviePoster({ m, h = 146, onOpen }: { m: TbMovie; h?: number; onOpen?: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="relative block w-full overflow-hidden rounded-lg text-left active:opacity-85" style={{ height: h, background: `linear-gradient(160deg, ${m.c1} 0%, ${m.c2} 100%)` }}>
      <span className="absolute left-1.5 top-1.5 rounded-[3px] bg-black/45 px-1 py-px text-[9.5px] font-bold text-white">{m.badge}</span>
      <span className="absolute inset-x-1.5 top-7 text-[16px] font-black leading-[21px] tracking-wide text-white/95 drop-shadow-[0_1px_2px_rgba(0,0,0,0.4)]">{m.title}</span>
      {m.rating != null ? (
        <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/65 to-transparent px-1.5 pb-1 pt-4 text-[12.5px] font-bold text-white">评分 {m.rating}</span>
      ) : m.want ? (
        <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/65 to-transparent px-1.5 pb-1 pt-4 text-[11.5px] font-bold text-white">{m.want}</span>
      ) : null}
    </button>
  );
}

/** 淘票票（第十三轮重构：顶部四大频道 tab（电影/喜剧脱口秀/演唱会/周边商城），
 *  仅顶部标签固定、其余内容全部跟随滚动，底部上拉刷新；
 *  电影保留 首页→影院列表→选座 链路，出票写真实票务订单（全部订单·待收货）） */
type TpTab = 'movie' | 'comedy' | 'concert' | 'merch';
const TP_TABS: { id: TpTab; label: string }[] = [
  { id: 'movie', label: '电影' },
  { id: 'comedy', label: '喜剧脱口秀' },
  { id: 'concert', label: '演唱会' },
  { id: 'merch', label: '周边商城' },
];

/** 喜剧脱口秀固定场次时刻（Task 2-b：与今天/明天/后天真实日期绑定，索引 = 场次偏移天数） */
const COMEDY_SESSION_TIMES = [
  { start: '19:30', end: '21:30', price: 120 },
  { start: '19:30', end: '21:40', price: 120 },
  { start: '14:30', end: '16:40', price: 100 },
];

export function MoviePage({
  uid,
  initialTab = 'movie',
  onBack,
  onToast,
  onOpenCouponCenter,
  onPayOrder,
}: {
  uid: string;
  initialTab?: TpTab;
  onBack: () => void;
  onToast: (m: string) => void;
  onOpenCouponCenter: () => void;
  /** 周边下单/票务下单（待付款）→ 根组件唤起收银台（用户点支付才扣款出票） */
  onPayOrder: (orderId: string) => void;
}) {
  const [tab, setTab] = useState<TpTab>(initialTab);
  const [view, setView] = useState<'tabs' | 'cinemas' | 'seats' | 'comedyVenue' | 'comedySeats' | 'concertBuy'>('tabs');
  // 电影频道子频道（Task 44：热映影片 / 即将上映 两个独立界面，双向刷新+持久化）
  const [movieSub, setMovieSub] = useState<'hot' | 'soon'>('hot');
  const [movie, setMovie] = useState<TbMovie>(TB_MOVIES[3]);
  const [day, setDay] = useState(0);
  const [sel, setSel] = useState<Set<string>>(new Set());
  // 喜剧脱口秀
  const [show, setShow] = useState<TbShow>(TB_COMEDY_SHOWS[0]);
  const [showDay, setShowDay] = useState(0);
  // 演唱会
  const [concert, setConcert] = useState<TbConcert>(TB_CONCERTS[0]);
  const [tierIdx, setTierIdx] = useState(0);
  const [cQty, setCQty] = useState(2);
  /** 演唱会所选场次（0=今天/1=明天/2=后天，真实日期场次） */
  const [concertDay, setConcertDay] = useState(0);
  // 周边商城
  const [buyMerch, setBuyMerch] = useState<TbMerch | null>(null);
  const [mQty, setMQty] = useState(1);
  // 双向刷新（Task 40：顶部下拉、底部上拉都触发）——前插新内容、旧内容原位保留、不回顶；
  // Task 41：AI 生成热映新片前插（用户配置模型，服务端内置模型兜底）+ 批次全部持久化
  // （刷新页面/重开 App 后旧内容与历史批次原样恢复）
  const [batches, setBatches] = useState<number[]>([]);
  const batchSeq = useRef(1);
  const [aiMovies, setAiMovies] = useState<TbMovie[]>([]);
  // Task 44：三频道 AI 内容 + 本地兜底批次（前插保旧 + 全量持久化，与热映同构）
  const [aiSoon, setAiSoon] = useState<TbMovie[]>([]);
  const [soonBatches, setSoonBatches] = useState<number[]>([]);
  const soonSeqRef = useRef(1);
  const [aiShows, setAiShows] = useState<TbShow[]>([]);
  const [showBatches, setShowBatches] = useState<number[]>([]);
  const showSeqRef = useRef(1);
  const [aiConcerts, setAiConcerts] = useState<TbConcert[]>([]);
  const [concertBatches, setConcertBatches] = useState<number[]>([]);
  const concertSeqRef = useRef(1);
  const [aiMerchs, setAiMerchs] = useState<TbMerch[]>([]);
  const [merchBatches, setMerchBatches] = useState<number[]>([]);
  const merchSeqRef = useRef(1);
  // Task 45：底部追加条目（滑到底部拉一拉 → 新内容追加到各频道列表最后，上方内容原位不变）
  const [aiTails, setAiTails] = useState<{ movie: TbMovie[]; movieUp: TbMovie[]; comedy: TbShow[]; concert: TbConcert[]; merch: TbMerch[] }>({
    movie: [],
    movieUp: [],
    comedy: [],
    concert: [],
    merch: [],
  });
  const apiConfig = useSettings((s) => s.apiConfig);
  const apiCfgRef = useRef(apiConfig);
  apiCfgRef.current = apiConfig;
  const mSeq = useRef(0);
  const batchesRef = useRef(batches);
  batchesRef.current = batches;
  const aiMoviesRef = useRef(aiMovies);
  aiMoviesRef.current = aiMovies;
  const aiSoonRef = useRef(aiSoon);
  aiSoonRef.current = aiSoon;
  const soonBatchesRef = useRef(soonBatches);
  soonBatchesRef.current = soonBatches;
  const aiShowsRef = useRef(aiShows);
  aiShowsRef.current = aiShows;
  const showBatchesRef = useRef(showBatches);
  showBatchesRef.current = showBatches;
  const aiConcertsRef = useRef(aiConcerts);
  aiConcertsRef.current = aiConcerts;
  const concertBatchesRef = useRef(concertBatches);
  concertBatchesRef.current = concertBatches;
  const aiMerchsRef = useRef(aiMerchs);
  aiMerchsRef.current = aiMerchs;
  const merchBatchesRef = useRef(merchBatches);
  merchBatchesRef.current = merchBatches;
  const aiTailsRef = useRef(aiTails);
  aiTailsRef.current = aiTails;
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const movieSubRef = useRef(movieSub);
  movieSubRef.current = movieSub;

  // 挂载恢复：持久化的批次 + AI 内容（热映/即将上映/喜剧/演唱会/周边——旧内容永不消失）
  useEffect(() => {
    const aux = tbFeedAuxLoad<{ list?: unknown; seq?: unknown }>(uid, 'movie', 'batches');
    if (aux && Array.isArray(aux.list)) {
      const list = (aux.list as number[]).filter((b) => typeof b === 'number').slice(0, 4);
      setBatches(list);
      batchSeq.current = typeof aux.seq === 'number' && aux.seq > 0 ? aux.seq : 1;
    }
    const saved = tbFeedAuxLoad<TbMovie[]>(uid, 'movie', 'aiMovies');
    if (saved && Array.isArray(saved)) {
      setAiMovies(saved.filter((m) => m && typeof m.id === 'string' && typeof m.title === 'string').slice(0, 12));
    }
    // Task 44：即将上映
    const soonAux = tbFeedAuxLoad<{ list?: unknown; seq?: unknown }>(uid, 'movieUp', 'batches');
    if (soonAux && Array.isArray(soonAux.list)) {
      setSoonBatches((soonAux.list as number[]).filter((b) => typeof b === 'number').slice(0, 3));
      soonSeqRef.current = typeof soonAux.seq === 'number' && soonAux.seq > 0 ? soonAux.seq : 1;
    }
    const soonAi = tbFeedAuxLoad<TbMovie[]>(uid, 'movieUp', 'aiMovies');
    if (soonAi && Array.isArray(soonAi)) {
      setAiSoon(soonAi.filter((m) => m && typeof m.id === 'string' && typeof m.title === 'string').slice(0, 12));
    }
    // 喜剧脱口秀
    const showAux = tbFeedAuxLoad<{ list?: unknown; seq?: unknown }>(uid, 'comedy', 'batches');
    if (showAux && Array.isArray(showAux.list)) {
      setShowBatches((showAux.list as number[]).filter((b) => typeof b === 'number').slice(0, 3));
      showSeqRef.current = typeof showAux.seq === 'number' && showAux.seq > 0 ? showAux.seq : 1;
    }
    const showAi = tbFeedAuxLoad<TbShow[]>(uid, 'comedy', 'aiShows');
    if (showAi && Array.isArray(showAi)) {
      setAiShows(showAi.filter((s) => s && typeof s.id === 'string' && typeof s.title === 'string').slice(0, 12));
    }
    // 演唱会
    const concertAux = tbFeedAuxLoad<{ list?: unknown; seq?: unknown }>(uid, 'concert', 'batches');
    if (concertAux && Array.isArray(concertAux.list)) {
      setConcertBatches((concertAux.list as number[]).filter((b) => typeof b === 'number').slice(0, 3));
      concertSeqRef.current = typeof concertAux.seq === 'number' && concertAux.seq > 0 ? concertAux.seq : 1;
    }
    const concertAi = tbFeedAuxLoad<TbConcert[]>(uid, 'concert', 'aiConcerts');
    if (concertAi && Array.isArray(concertAi)) {
      setAiConcerts(concertAi.filter((c) => c && typeof c.id === 'string' && typeof c.artist === 'string' && Array.isArray(c.tiers)).slice(0, 12));
    }
    // 周边商城
    const merchAux = tbFeedAuxLoad<{ list?: unknown; seq?: unknown }>(uid, 'merch', 'batches');
    if (merchAux && Array.isArray(merchAux.list)) {
      setMerchBatches((merchAux.list as number[]).filter((b) => typeof b === 'number').slice(0, 3));
      merchSeqRef.current = typeof merchAux.seq === 'number' && merchAux.seq > 0 ? merchAux.seq : 1;
    }
    const merchAi = tbFeedAuxLoad<TbMerch[]>(uid, 'merch', 'aiMerchs');
    if (merchAi && Array.isArray(merchAi)) {
      setAiMerchs(merchAi.filter((m) => m && typeof m.id === 'string' && typeof m.title === 'string').slice(0, 12));
    }
    // Task 45：底部追加条目恢复（各频道独立持久化，旧内容永不消失）
    const vMovieT = (x: unknown): x is TbMovie => !!x && typeof x === 'object' && typeof (x as TbMovie).id === 'string' && typeof (x as TbMovie).title === 'string';
    const vShowT = (x: unknown): x is TbShow => !!x && typeof x === 'object' && typeof (x as TbShow).id === 'string' && typeof (x as TbShow).title === 'string';
    const vConcertT = (x: unknown): x is TbConcert => !!x && typeof x === 'object' && typeof (x as TbConcert).artist === 'string' && Array.isArray((x as TbConcert).tiers);
    const vMerchT = (x: unknown): x is TbMerch => !!x && typeof x === 'object' && typeof (x as TbMerch).id === 'string' && typeof (x as TbMerch).title === 'string';
    const tailOf = <T,>(s: string, v: (x: unknown) => x is T): T[] => {
      const list = tbFeedAuxLoad<unknown[]>(uid, s, 'aiTails');
      return list && Array.isArray(list) ? list.filter(v).slice(0, 12) : [];
    };
    setAiTails({
      movie: tailOf('movie', vMovieT),
      movieUp: tailOf('movieUp', vMovieT),
      comedy: tailOf('comedy', vShowT),
      concert: tailOf('concert', vConcertT),
      merch: tailOf('merch', vMerchT),
    });
  }, [uid]);

  /** 通用兜底批次推进（本地确定性批次前插，同构热映逻辑） */
  const fallbackBatch = (
    surface: 'movieUp' | 'comedy' | 'concert' | 'merch',
    seqRef: { current: number },
    setB: (bs: number[]) => void,
    bs0: number[],
  ) => {
    const nextB = [seqRef.current, ...bs0].slice(0, 3);
    seqRef.current += 1;
    setB(nextB);
    tbFeedAuxSave(uid, surface, 'batches', { list: nextB, seq: seqRef.current });
  };

  /** 底部追加（Task 45）：新条目接在频道列表最后（上方内容原位不变），全量持久化 */
  const appendTails = (surface: 'movie' | 'movieUp' | 'comedy' | 'concert' | 'merch', items: TbMovie[] | TbShow[] | TbConcert[] | TbMerch[]) => {
    const cur = aiTailsRef.current[surface];
    const nextList = [...cur, ...(items as unknown[])].slice(-12) as typeof cur;
    setAiTails({ ...aiTailsRef.current, [surface]: nextList });
    tbFeedAuxSave(uid, surface, 'aiTails', nextList);
  };
  /** 兑底尾部条目（本地确定性选取，与顶部前插批错位，id 加尾部后缀避免 key 冲突） */
  const freshTail = <T extends { id: string }>(arr: T[], n: number, seed: number): T[] =>
    Array.from({ length: n }, (_, i) => {
      const src = arr[(seed * 2 + i + 3) % arr.length];
      return { ...src, id: `${src.id}·t${seed}-${i}` };
    });

  /** 电影频道刷新分流（Task 44）：按当前频道/子频道生成对应内容——
   *  此前固定生成热映电影，喜剧/演唱会/周边刷新内容不变（用户反馈） */
  const pull = useTbPullRefresh((dir) => {
    const t = tabRef.current;
    if (t === 'movie') return movieSubRef.current === 'soon' ? refreshSoon(dir) : refreshHot(dir);
    if (t === 'comedy') return refreshComedy(dir);
    if (t === 'concert') return refreshConcert(dir);
    return refreshMerch(dir);
  });

  /** 热映：顶部下拉 → AI 新片前插；底部上拉 → AI 新片追加到列表末尾（上方内容不变）；批次持久化 */
  const refreshHot = (dir: 'down' | 'up') => {
    const mySeq = ++mSeq.current;
    const bs0 = batchesRef.current;
    const seq0 = batchSeq.current;
    return (async () => {
      const ai = await tbFetchAiBatch({
        uid,
        surface: 'movie',
        exclude: [...TB_MOVIES.map((m) => m.title), ...aiMoviesRef.current.map((m) => m.title), ...aiTailsRef.current.movie.map((m) => m.title)].slice(0, 60),
        count: 3,
        config: apiCfgRef.current,
      });
      if (mSeq.current !== mySeq) return; // 过期批次丢弃
      if (ai && ai.raws.length > 0) {
        // AI 新片：标题/制式/主演来自模型，渐变色/评分按标题确定性派生
        const movies: TbMovie[] = ai.raws.map((r, i) => {
          const pal = MOVIE_PALETTES[(tbStrHash(r.title) + i) % MOVIE_PALETTES.length];
          const h = tbStrHash(r.title);
          return {
            id: ai!.products[i].id,
            title: r.title,
            rating: Math.round(70 + (h % 25)) / 10,
            want: `${2 + (h % 8)}.${h % 9}万人想看`,
            badge: typeof r.badge === 'string' && r.badge.trim() ? r.badge.trim().slice(0, 8) : '2D',
            c1: pal[0],
            c2: pal[1],
          };
        });
        tbFeedAuxSave(uid, 'movie', 'batches', { list: bs0, seq: seq0 });
        if (dir === 'down') {
          const next = [...movies, ...aiMoviesRef.current].slice(0, 12);
          setAiMovies(next);
          tbFeedAuxSave(uid, 'movie', 'aiMovies', next);
          onToast('已刷新，最新热映影片已更新到顶部');
        } else {
          // 底部追加（Task 45）：新片接在列表最后，上方内容原位不变
          appendTails('movie', movies);
          onToast('已加载新片在下方，上方内容不变');
        }
      } else if (dir === 'down') {
        // 本地兜底：确定性批次前插（同样持久化）
        const nextB = [seq0, ...bs0].slice(0, 4);
        batchSeq.current = seq0 + 1;
        setBatches(nextB);
        tbFeedAuxSave(uid, 'movie', 'batches', { list: nextB, seq: seq0 + 1 });
        tbFeedAuxSave(uid, 'movie', 'aiMovies', aiMoviesRef.current);
        onToast('已刷新，最新热映影片已更新到顶部');
      } else {
        // 本地兜底：追加种子新片到列表末尾（同样持久化）
        appendTails('movie', freshTail(TB_MOVIES, 3, seq0));
        batchSeq.current = seq0 + 1;
        onToast('已加载新片在下方，上方内容不变');
      }
    })();
  };

  /** 即将上映：顶部下拉 → AI 待映新片前插；底部上拉 → AI 待映新片追加到末尾；批次持久化 */
  const refreshSoon = (dir: 'down' | 'up') => {
    const mySeq = ++mSeq.current;
    const bs0 = soonBatchesRef.current;
    const seq0 = soonSeqRef.current;
    return (async () => {
      const ai = await tbFetchAiBatch({
        uid,
        surface: 'movieUp',
        exclude: [...TB_MOVIES_SOON.map((m) => m.title), ...aiSoonRef.current.map((m) => m.title), ...aiTailsRef.current.movieUp.map((m) => m.title)].slice(0, 60),
        count: 3,
        config: apiCfgRef.current,
      });
      if (mSeq.current !== mySeq) return;
      if (ai && ai.raws.length > 0) {
        const movies = ai.raws.map((r, i) => aiToMovieUp(r, i));
        tbFeedAuxSave(uid, 'movieUp', 'batches', { list: bs0, seq: seq0 });
        if (dir === 'down') {
          const next = [...movies, ...aiSoonRef.current].slice(0, 12);
          setAiSoon(next);
          tbFeedAuxSave(uid, 'movieUp', 'aiMovies', next);
          onToast('已刷新，最新待映新片已更新到顶部');
        } else {
          appendTails('movieUp', movies);
          onToast('已加载待映新片在下方，上方内容不变');
        }
      } else if (dir === 'down') {
        fallbackBatch('movieUp', soonSeqRef, setSoonBatches, bs0);
        onToast('已刷新，最新待映新片已更新到顶部');
      } else {
        appendTails('movieUp', freshTail(TB_MOVIES_SOON, 3, seq0));
        soonSeqRef.current = seq0 + 1;
        onToast('已加载待映新片在下方，上方内容不变');
      }
    })();
  };

  /** 喜剧脱口秀：顶部下拉 → AI 演出前插；底部上拉 → AI 演出追加到末尾；批次持久化 */
  const refreshComedy = (dir: 'down' | 'up') => {
    const mySeq = ++mSeq.current;
    const bs0 = showBatchesRef.current;
    const seq0 = showSeqRef.current;
    return (async () => {
      const ai = await tbFetchAiBatch({
        uid,
        surface: 'standup',
        exclude: [...TB_COMEDY_SHOWS.map((s) => s.title), ...aiShowsRef.current.map((s) => s.title), ...aiTailsRef.current.comedy.map((s) => s.title)].slice(0, 60),
        count: 3,
        config: apiCfgRef.current,
      });
      if (mSeq.current !== mySeq) return;
      if (ai && ai.raws.length > 0) {
        const shows = ai.raws.map((r, i) => aiToShow(r, i));
        tbFeedAuxSave(uid, 'comedy', 'batches', { list: bs0, seq: seq0 });
        if (dir === 'down') {
          const next = [...shows, ...aiShowsRef.current].slice(0, 12);
          setAiShows(next);
          tbFeedAuxSave(uid, 'comedy', 'aiShows', next);
          onToast('已刷新，最新喜剧演出已更新到顶部');
        } else {
          appendTails('comedy', shows);
          onToast('已加载新演出在下方，上方内容不变');
        }
      } else if (dir === 'down') {
        fallbackBatch('comedy', showSeqRef, setShowBatches, bs0);
        onToast('已刷新，最新喜剧演出已更新到顶部');
      } else {
        appendTails('comedy', freshTail(TB_COMEDY_SHOWS, 2, seq0));
        showSeqRef.current = seq0 + 1;
        onToast('已加载新演出在下方，上方内容不变');
      }
    })();
  };

  /** 演唱会：顶部下拉 → AI 演出前插；底部上拉 → AI 演出追加到末尾；批次持久化 */
  const refreshConcert = (dir: 'down' | 'up') => {
    const mySeq = ++mSeq.current;
    const bs0 = concertBatchesRef.current;
    const seq0 = concertSeqRef.current;
    return (async () => {
      const ai = await tbFetchAiBatch({
        uid,
        surface: 'concert',
        exclude: [...TB_CONCERTS.map((c) => `${c.artist}·${c.tour}`), ...aiConcertsRef.current.map((c) => `${c.artist}·${c.tour}`), ...aiTailsRef.current.concert.map((c) => `${c.artist}·${c.tour}`)].slice(0, 60),
        count: 3,
        config: apiCfgRef.current,
      });
      if (mSeq.current !== mySeq) return;
      if (ai && ai.raws.length > 0) {
        const list = ai.raws.map((r, i) => aiToConcert(r, i));
        tbFeedAuxSave(uid, 'concert', 'batches', { list: bs0, seq: seq0 });
        if (dir === 'down') {
          const next = [...list, ...aiConcertsRef.current].slice(0, 12);
          setAiConcerts(next);
          tbFeedAuxSave(uid, 'concert', 'aiConcerts', next);
          onToast('已刷新，最新演唱会已更新到顶部');
        } else {
          appendTails('concert', list);
          onToast('已加载新演唱会在下方，上方内容不变');
        }
      } else if (dir === 'down') {
        fallbackBatch('concert', concertSeqRef, setConcertBatches, bs0);
        onToast('已刷新，最新演唱会已更新到顶部');
      } else {
        appendTails('concert', freshTail(TB_CONCERTS, 2, seq0));
        concertSeqRef.current = seq0 + 1;
        onToast('已加载新演唱会在下方，上方内容不变');
      }
    })();
  };

  /** 周边商城：顶部下拉 → AI 周边前插；底部上拉 → AI 周边追加到末尾；批次持久化 */
  const refreshMerch = (dir: 'down' | 'up') => {
    const mySeq = ++mSeq.current;
    const bs0 = merchBatchesRef.current;
    const seq0 = merchSeqRef.current;
    return (async () => {
      const ai = await tbFetchAiBatch({
        uid,
        surface: 'merch',
        exclude: [...TB_MERCH.map((m) => m.title), ...aiMerchsRef.current.map((m) => m.title), ...aiTailsRef.current.merch.map((m) => m.title)].slice(0, 60),
        count: 4,
        config: apiCfgRef.current,
      });
      if (mSeq.current !== mySeq) return;
      if (ai && ai.raws.length > 0) {
        const list = ai.raws.map((r) => aiToMerch(r));
        tbFeedAuxSave(uid, 'merch', 'batches', { list: bs0, seq: seq0 });
        if (dir === 'down') {
          const next = [...list, ...aiMerchsRef.current].slice(0, 12);
          setAiMerchs(next);
          tbFeedAuxSave(uid, 'merch', 'aiMerchs', next);
          onToast('已刷新，最新周边已上架到顶部');
        } else {
          appendTails('merch', list);
          onToast('已加载新周边在下方，上方内容不变');
        }
      } else if (dir === 'down') {
        fallbackBatch('merch', merchSeqRef, setMerchBatches, bs0);
        onToast('已刷新，最新周边已上架到顶部');
      } else {
        appendTails('merch', freshTail(TB_MERCH, 3, seq0));
        merchSeqRef.current = seq0 + 1;
        onToast('已加载新周边在下方，上方内容不变');
      }
    })();
  };

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  const dateLabels = useMemo(() => {
    const fmt = (d: Date) => `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return ['今天', '明天', '后天'].map((l, i) => {
      const d = new Date();
      d.setDate(d.getDate() + i);
      return { label: l, date: fmt(d) };
    });
  }, []);
  /** 未来三天 ISO 日期（出票写真实日期 → 票详情倒计时/已放映判定） */
  const isoDates = useMemo(
    () =>
      [0, 1, 2].map((i) => {
        const d = new Date();
        d.setDate(d.getDate() + i);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      }),
    []
  );
  /** 演唱会真实场次（未来 3 天，开场时刻取 dateRange 文案里的 HH:MM，缺省 19:00，演出约 3 小时） */
  const concertSessions = useMemo(() => {
    const sm = concert.dateRange.match(/(\d{1,2}:\d{2})/);
    const start = sm ? sm[1] : '19:00';
    return [0, 1, 2].map((i) => {
      const s = tbSessionTime(i, start, { hours: 3 });
      return { ...s, started: tbSessionStarted(s.isoDate, start) };
    });
  }, [concert]);
  /** 打开演唱会购票页时默认选中第一个未开演的场次 */
  const openConcertBuy = (cc: TbConcert) => {
    const sm = cc.dateRange.match(/(\d{1,2}:\d{2})/);
    const start = sm ? sm[1] : '19:00';
    let first = 2;
    for (let i = 0; i < 3; i++) {
      if (!tbSessionStarted(tbRealDate(i).isoDate, start)) {
        first = i;
        break;
      }
    }
    setConcert(cc);
    setTierIdx(0);
    setCQty(2);
    setConcertDay(first);
    setView('concertBuy');
  };
  /** 刷新批次：往列表顶部插入「新内容」（最新批在最上），旧条目与历史批次原位保留
   *  （不重排、不清空、不跳顶）；id 加批次后缀避免 key 冲突（字段全量拷贝，点击/出票行为不变）；
   *  Task 44：批次列表按频道传入（热映/即将上映/喜剧/演唱会/周边各自独立持久化） */
  const fresh = <T extends { id: string }>(arr: T[], n: number, bs: number[] = batches): T[] =>
    bs.flatMap((b) =>
      Array.from({ length: n }, (_, i) => {
        const src = arr[(b * 2 + i) % arr.length];
        return { ...src, id: `${src.id}·r${b}-${i}` };
      })
    );

  const toggleSeat = (r: number, k: number) => {
    const key = `${r}-${k}`;
    setSel((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else {
        if (next.size >= 5) {
          onToast('一次最多选5个座位');
          return prev;
        }
        next.add(key);
      }
      return next;
    });
  };
  const pickRecommend = (n: number) => {
    for (let r = TB_BEST_ZONE.r1; r <= TB_BEST_ZONE.r2; r++) {
      const row = TB_SEAT_LAYOUT[r];
      let run = 0;
      for (let c = 0; c < row.length; c++) {
        if (!row[c] || tbSeatSold(r, c)) {
          run = 0;
          continue;
        }
        run++;
        if (run === n) {
          const next = new Set<string>();
          for (let x = c - n + 1; x <= c; x++) next.add(`${r}-${x}`);
          setSel(next);
          return;
        }
      }
    }
    onToast('最佳观影区暂无连座');
  };
  /** 座位 key → 座位文案（2排4座） */
  const seatTexts = (keys: Set<string>): string[] =>
    [...keys].map((k) => {
      const [r, c] = k.split('-').map(Number);
      return `${r + 1}排${c + 1}座`;
    });

  /** 电影选座确认：创建待付款票务订单 → 拉起收银台（用户点支付才扣款出票）；今天场次已开场时拦截 */
  const confirmSeats = () => {
    if (sel.size === 0) return;
    const sess = TB_MOVIE_SESSIONS[day];
    if (tbSessionStarted(isoDates[day], sess.start)) {
      onToast('该场次已开场，请选择明后天的场次');
      return;
    }
    const order = tbCreateTicketOrder(uid, {
      kind: 'movie',
      title: movie.title,
      posterC1: movie.c1,
      posterC2: movie.c2,
      badge: `国语 ${movie.badge}`,
      qty: sel.size,
      venue: TB_CINEMAS[0].name,
      hall: '2号厅',
      date: isoDates[day],
      dateLabel: `${dateLabels[day].label} ${dateLabels[day].date}`,
      start: sess.start,
      end: sess.end,
      seats: seatTexts(sel),
      unitPrice: 38,
    });
    onToast('已提交订单，请完成支付');
    setSel(new Set());
    setView('tabs');
    onPayOrder(order.id);
  };

  /** 喜剧脱口秀选座确认：场次绑定真实今天/明天/后天（已开演拦截）→ 待付款订单 → 收银台 */
  const confirmComedy = () => {
    if (sel.size === 0) return;
    const sess = COMEDY_SESSION_TIMES[showDay];
    const real = tbRealDate(showDay);
    if (tbSessionStarted(real.isoDate, sess.start)) {
      onToast('该场次已开演，请选择其他场次');
      return;
    }
    const order = tbCreateTicketOrder(uid, {
      kind: 'comedy',
      title: show.title,
      posterC1: show.c1,
      posterC2: show.c2,
      badge: show.tag,
      qty: sel.size,
      venue: show.venue,
      hall: '小剧场',
      date: real.isoDate,
      dateLabel: `${real.label} ${real.md}`,
      start: sess.start,
      end: sess.end,
      seats: seatTexts(sel),
      unitPrice: sess.price,
    });
    onToast('已提交订单，请完成支付');
    setSel(new Set());
    setView('tabs');
    onPayOrder(order.id);
  };

  /** 演唱会选票确认：出真实未来 3 天场次（dateRange 文案仅作展示，修写死年份日期已过的 bug）
   *  → 待付款订单 → 收银台 */
  const confirmConcert = () => {
    const tier = concert.tiers[tierIdx];
    if (!tier || tier.left === '已售罄') return;
    const sess = concertSessions[concertDay];
    if (!sess || sess.started) {
      onToast('该场次已开演，请选择其他场次');
      return;
    }
    const order = tbCreateTicketOrder(
      uid,
      {
        kind: 'concert',
        title: `${concert.artist}「${concert.tour}」`,
        posterC1: concert.c1,
        posterC2: concert.c2,
        badge: '演唱会',
        qty: cQty,
        venue: concert.venue,
        hall: tier.name,
        date: sess.isoDate,
        dateLabel: `${sess.label} ${sess.md}`,
        start: sess.start,
        end: sess.end,
        seats: [`${tier.name}×${cQty}`],
        unitPrice: tier.price,
      },
      { total: Math.round(tier.price * cQty * 100) / 100 }
    );
    onToast('已提交订单，请完成支付');
    setView('tabs');
    onPayOrder(order.id);
  };

  /** 周边下单：待付款订单 → 根组件唤起支付（支付后走正常发货/物流链路） */
  const buyMerchNow = () => {
    if (!buyMerch) return;
    const order = tbCreateMerchOrder(uid, buyMerch, mQty);
    setBuyMerch(null);
    setMQty(1);
    onToast('已提交订单，请完成支付');
    onPayOrder(order.id);
  };



  // ---------- 选座 ----------
  if (view === 'seats') {
    return (
      <div className="flex h-full flex-col bg-white">
        {/* 顶栏 */}
        <div className="flex shrink-0 items-center gap-2 px-3 pb-2 pt-[56px]">
          <button type="button" aria-label="返回" onClick={() => setView('cinemas')} className="grid h-9 w-9 shrink-0 place-items-center rounded-full active:opacity-60">
            <ArrowLeft className="h-[22px] w-[22px] text-black/85" strokeWidth={2.2} />
          </button>
          <span className="min-w-0 flex-1 truncate text-center text-[18px] font-bold text-black/90">{movie.id.startsWith('m4') ? '台前县中影时光…' : `${movie.title}·附近影城`}</span>
          <button type="button" aria-label="更多" onClick={() => onToast('更多（演示）')} className="grid h-8 w-[52px] shrink-0 place-items-center rounded-full bg-black/[0.05]">
            <MoreHorizontal className="h-[17px] w-[17px] text-black/70" />
          </button>
        </div>
        {/* 图例 */}
        <div className="flex shrink-0 items-center justify-center gap-7 pb-2 pt-1 text-[13px] text-black/60">
          <span className="flex items-center gap-1.5">
            <span className="h-[15px] w-[15px] rounded-[4px] border border-black/20 bg-white" />
            可选
          </span>
          <span className="flex items-center gap-1.5">
            <span className="grid h-[15px] w-[15px] place-items-center rounded-[4px] bg-[#F03E3E]">
              <span className="h-[3px] w-[3px] rounded-full bg-white/90 shadow-[3px_0_0_0_rgba(255,255,255,0.9)]" />
            </span>
            已售
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-[15px] w-[15px] rounded-[4px] border border-dashed border-[#F03E8C]" />
            最佳观影区
          </span>
        </div>
        {/* 银幕 */}
        <div className="shrink-0 px-8">
          <svg viewBox="0 0 300 14" className="h-[14px] w-full" aria-hidden="true">
            <path d="M4 12 Q150 -8 296 12" stroke="#F03E8C" strokeWidth="3" fill="none" strokeLinecap="round" />
            <path d="M4 12 Q150 -8 296 12" stroke="#F03E8C" strokeWidth="9" fill="none" opacity="0.18" />
          </svg>
          <div className="pb-1 pt-0.5 text-center text-[12px] text-black/35">三号激光影厅 银幕</div>
        </div>
        {/* 座位图 */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4">
          <div className="relative mx-auto w-fit py-2">
            {TB_SEAT_LAYOUT.map((row, r) => {
              let k = -1;
              return (
                <div key={r} className="flex items-center gap-[6px] pb-[10px] last:pb-0">
                  <span className="grid h-[20px] w-[20px] shrink-0 place-items-center rounded bg-black/[0.06] text-[11px] text-black/45">{r + 1}</span>
                  {row.map((v, ci) => {
                    if (!v) return <span key={ci} className="h-[20px] w-[6px]" />;
                    k++;
                    const key = `${r}-${k}`;
                    const sold = tbSeatSold(r, k);
                    const picked = sel.has(key);
                    return (
                      <button
                        key={ci}
                        type="button"
                        aria-label={`${r + 1}排${k + 1}列`}
                        onClick={() => toggleSeat(r, k)}
                        disabled={sold}
                        className={`h-[20px] w-[24px] rounded-[5px] transition-colors ${sold ? 'bg-[#F03E3E]' : picked ? 'grid place-items-center bg-[#12B76A]' : 'border border-black/15 bg-white'}`}
                      >
                        {picked ? <Check className="h-3 w-3 text-white" strokeWidth={3.4} /> : null}
                      </button>
                    );
                  })}
                </div>
              );
            })}
            {/* 最佳观影区虚线框（行3-5 × 座位序3-7，座位宽24+间距6=30/格） */}
            <span
              className="pointer-events-none absolute rounded-md border-[1.5px] border-dashed border-[#F03E8C]"
              style={{ left: 26 + TB_BEST_ZONE.c1 * 30 - 5, top: TB_BEST_ZONE.r1 * 30 - 4, width: (TB_BEST_ZONE.c2 - TB_BEST_ZONE.c1 + 1) * 30 - 8, height: (TB_BEST_ZONE.r2 - TB_BEST_ZONE.r1 + 1) * 30 - 12 }}
            />
            {/* 中央走道虚线 */}
            <span className="pointer-events-none absolute bottom-1 left-1/2 top-1 border-l border-dashed border-black/15" />
          </div>
          <div className="pb-2 pt-3 text-center text-[15px] font-bold text-[#C6CBD4]">淘票票</div>
        </div>
        {/* 底部信息与确认 */}
        <div className="shrink-0 bg-[#F4F5F7] px-3 pb-5 pt-2">
          <button type="button" onClick={() => onToast('观影须知：1.2米以下免票（演示）')} className="flex w-full items-center gap-2 rounded-xl bg-white px-3 py-2.5 text-left active:opacity-80">
            <span className="shrink-0 rounded-[4px] border border-[#FF8A00]/50 px-1 py-px text-[10.5px] font-bold text-[#FF8A00]">儿童须知</span>
            <span className="min-w-0 flex-1 truncate text-[13.5px] text-black/75">1.2米以下免票</span>
            <span className="shrink-0 text-[13px] text-black/35">共1条 &gt;</span>
          </button>
          <div className="mt-2 rounded-xl bg-white p-3">
            <div className="flex items-center">
              <span className="truncate text-[15px] font-bold text-black/90">{movie.title}</span>
              <button type="button" onClick={() => setView('cinemas')} className="ml-auto shrink-0 text-[13.5px] font-medium text-[#3B82F6] active:opacity-70">切换场次</button>
            </div>
            <div className="mt-0.5 text-[13.5px] text-black/75">
              <span className="font-semibold text-[#FF3676]">{dateLabels[day].label}</span> {tbRealDate(day).long} {TB_MOVIE_SESSIONS[day].start}-{TB_MOVIE_SESSIONS[day].end} 国语 2D
            </div>
            <span className="mt-2 inline-block rounded-lg border-[1.5px] border-[#FF3676] bg-[#FFF0F5] px-3 py-1.5">
              <span className="text-[13.5px] font-bold text-black/90">{TB_MOVIE_SESSIONS[day].start}</span>
              <span className="ml-1.5 text-[11px] text-black/50">国语 2D</span>
              <span className="ml-1.5 text-[13px] font-bold text-[#FF3676]">¥38</span>
            </span>
            <div className="mt-3 flex items-center gap-2">
              <span className="text-[13px] text-black/55">推荐座位</span>
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" onClick={() => pickRecommend(n)} className="rounded-lg bg-black/[0.045] px-3 py-1.5 text-[13.5px] text-black/80 active:opacity-70">
                  {n}人
                </button>
              ))}
            </div>
            {sel.size > 0 ? (
              <div className="mt-2.5 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {[...sel].map((key) => {
                  const [r, k] = key.split('-').map(Number);
                  return (
                    <span key={key} className="relative shrink-0 rounded-lg bg-white px-3 py-1.5 text-center shadow-sm">
                      <button type="button" aria-label="移除座位" onClick={() => toggleSeat(r, k)} className="absolute right-0.5 top-0.5 grid h-3.5 w-3.5 place-items-center">
                        <X className="h-2.5 w-2.5 text-black/30" strokeWidth={3} />
                      </button>
                      <span className="block text-[13.5px] font-bold leading-[16px] text-black/85">
                        {r + 1}排{k + 1}列
                      </span>
                      <span className="block text-[10.5px] leading-[13px] text-[#FF3676]">新人价¥38</span>
                    </span>
                  );
                })}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={confirmSeats}
            className={`mt-2.5 h-[52px] w-full rounded-full text-[17px] font-bold text-white active:opacity-90 ${sel.size === 0 ? 'bg-[#F3B7CC]/70' : 'bg-gradient-to-r from-[#FF5C8A] to-[#FF2D6B]'}`}
          >
            {sel.size === 0 ? '请先选座' : `${sel.size * 38}元 确认选座`}
          </button>
        </div>
      </div>
    );
  }

  // ---------- 影院列表 ----------
  if (view === 'cinemas') {
    const first = TB_CINEMAS[0];
    const rest = TB_CINEMAS.slice(1);
    return (
      <div className="flex h-full flex-col bg-[#F4F5F7]">
        <div className="shrink-0 bg-white">
          <div className="flex items-center gap-2 px-3 pb-2 pt-[56px]">
            <button type="button" aria-label="返回" onClick={() => setView('tabs')} className="grid h-9 w-9 shrink-0 place-items-center rounded-full active:opacity-60">
              <ArrowLeft className="h-[22px] w-[22px] text-black/85" strokeWidth={2.2} />
            </button>
            <span className="min-w-0 flex-1 truncate text-center text-[18px] font-bold text-black/90">{movie.title}</span>
            <button type="button" aria-label="更多" onClick={() => onToast('更多（演示）')} className="grid h-8 w-[52px] shrink-0 place-items-center rounded-full bg-black/[0.05]">
              <MoreHorizontal className="h-[17px] w-[17px] text-black/70" />
            </button>
          </div>
          {/* 日期 tab */}
          <div className="flex items-center gap-7 px-4 pt-1">
            {dateLabels.map((d, i) => (
              <button key={d.label} type="button" onClick={() => setDay(i)} className={`relative pb-2 text-[16px] ${day === i ? 'font-bold text-black/90' : 'text-black/45'}`}>
                {d.label} {d.date}
                {day === i ? <span className="absolute bottom-0 left-1/2 h-[3px] w-[26px] -translate-x-1/2 rounded-full bg-[#FF3676]" /> : null}
              </button>
            ))}
          </div>
          {/* 筛选行（nowrap：窄屏不竖排换行，挤不下时横向滑） */}
          <div className="flex items-center gap-4 overflow-x-auto px-4 py-2.5 text-[15px] text-black/85 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {['濮阳全域', '筛选', '品牌'].map((f) => (
              <button key={f} type="button" onClick={() => onToast(`${f}（演示）`)} className="flex shrink-0 items-center gap-0.5 whitespace-nowrap active:opacity-70">
                {f}
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-black/40" />
              </button>
            ))}
            <button type="button" onClick={() => onToast('综合排序（演示）')} className="ml-auto flex shrink-0 items-center gap-1 whitespace-nowrap active:opacity-70">
              <Info className="h-3.5 w-3.5 shrink-0 text-black/35" />
              综合排序
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-black/40" />
            </button>
            <Search className="h-[18px] w-[18px] shrink-0 text-black/70" />
          </div>
          {/* 影厅筛选 chips */}
          <div className="flex gap-2 overflow-x-auto px-4 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {['杜比全景声厅', '4K厅', 'realD厅', '大麦VIP印花票根'].map((c) => (
              <button key={c} type="button" onClick={() => onToast(`${c}筛选（演示）`)} className="shrink-0 rounded-lg bg-black/[0.045] px-3 py-1.5 text-[13.5px] text-black/70 active:opacity-70">
                {c}
              </button>
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-8">
          {/* 可购票影院 */}
          <div className="mt-1 rounded-2xl bg-white p-3.5">
            <div className="flex items-center">
              <span className="min-w-0 flex-1 truncate text-[17px] font-black text-black/90">{first.name}</span>
              {first.hot ? (
                <span className="ml-2 shrink-0 text-[#FF3676]">
                  <span className="text-[12px] font-semibold">新人</span>
                  <span className="text-[20px] font-black leading-none">¥38</span>
                  <span className="text-[12px]">起</span>
                </span>
              ) : null}
            </div>
            <div className="mt-1 flex items-center gap-3">
              <span className="min-w-0 flex-1 truncate text-[13px] text-black/45">{first.addr}</span>
              <span className="shrink-0 text-[13px] text-black/45">{first.dist}</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {first.tags.map((t) => (
                <span
                  key={t}
                  className={`rounded-[4px] border px-1.5 py-px text-[11px] ${t === '影城卡' || t.startsWith('券包') ? 'border-[#FF3676]/45 text-[#FF3676]' : t === '退票' || t === '改签' ? 'border-[#3B82F6]/40 text-[#3B82F6]' : 'border-black/12 text-black/40'}`}
                >
                  {t}
                </span>
              ))}
            </div>
            <button type="button" onClick={() => setView('seats')} className="mt-2.5 flex w-full items-center gap-2 text-left active:opacity-75">
              <span className="text-[13.5px] text-black/60">近期场次：</span>
              <span className="text-[14px] font-medium text-[#3B82F6]">{first.session}</span>
              <ChevronRight className="h-4 w-4 text-[#3B82F6]" />
            </button>
          </div>
          {/* 已放映完 */}
          <div className="px-2 pb-1 pt-4 text-[15px] text-black/40">今天已放映完</div>
          {rest.map((c) => (
            <button key={c.name} type="button" onClick={() => onToast('今天已放映完，看看明天的场次吧')} className="mt-2 block w-full rounded-2xl bg-white p-3.5 text-left active:opacity-80">
              <div className="flex items-center">
                <span className="min-w-0 flex-1 truncate text-[17px] font-black text-black/90">{c.name}</span>
                <span className="ml-2 shrink-0 text-[13.5px] text-black/40">暂无场次</span>
              </div>
              <div className="mt-1 flex items-center gap-3">
                <span className="min-w-0 flex-1 truncate text-[13px] text-black/45">{c.addr}</span>
                <span className="shrink-0 text-[13px] text-black/45">{c.dist}</span>
              </div>
              {c.tags.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {c.tags.map((t) => (
                    <span
                      key={t}
                      className={`rounded-[4px] border px-1.5 py-px text-[11px] ${t === '影城卡' || t.startsWith('券包') ? 'border-[#FF3676]/45 text-[#FF3676]' : t === '退票' || t === '改签' ? 'border-[#3B82F6]/40 text-[#3B82F6]' : 'border-black/12 text-black/40'}`}
                    >
                      {t}
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="mt-2 text-[13.5px] text-black/40">今天已放映完</div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ---------- 喜剧脱口秀·剧场场次列表 ----------
  if (view === 'comedyVenue' && show) {
    // 场次真实化：固定时刻绑定今天/明天/后天真实日期；今天场次已过开场时刻 → 「已开演」禁选
    const cSess = COMEDY_SESSION_TIMES.map((s, i) => ({
      ...s,
      real: tbRealDate(i),
      started: tbSessionStarted(tbRealDate(i).isoDate, s.start),
    }));
    return (
      <div className="flex h-full flex-col bg-[#F4F5F7]">
        <div className="shrink-0 bg-white">
          <div className="flex items-center gap-2 px-3 pb-2 pt-[56px]">
            <button type="button" aria-label="返回" onClick={() => setView('tabs')} className="grid h-9 w-9 shrink-0 place-items-center rounded-full active:opacity-60">
              <ArrowLeft className="h-[22px] w-[22px] text-black/85" strokeWidth={2.2} />
            </button>
            <span className="min-w-0 flex-1 truncate text-center text-[18px] font-bold text-black/90">{show.title}</span>
            <button type="button" aria-label="更多" onClick={() => onToast('更多（演示）')} className="grid h-8 w-[52px] shrink-0 place-items-center rounded-full bg-black/[0.05]">
              <MoreHorizontal className="h-[17px] w-[17px] text-black/70" />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-8">
          {/* 剧场卡 */}
          <div className="mt-1 rounded-2xl bg-white p-3.5">
            <div className="flex items-center">
              <span className="min-w-0 flex-1 truncate text-[17px] font-black text-black/90">{show.venue}</span>
              <span className="ml-2 shrink-0 text-[#FF7A00]">
                <span className="text-[12px] font-semibold">¥</span>
                <span className="text-[20px] font-black leading-none">{show.price.split('-')[0]}</span>
                <span className="text-[12px]">起</span>
              </span>
            </div>
            <div className="mt-1 truncate text-[13px] text-black/45">
              {show.city} · {show.sub}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {[show.tag, '可选座', '退票', '改签'].map((tg) => (
                <span key={tg} className={`rounded-[4px] border px-1.5 py-px text-[11px] ${tg === show.tag ? 'border-[#FF7A00]/50 text-[#FF7A00]' : tg === '退票' || tg === '改签' ? 'border-[#3B82F6]/40 text-[#3B82F6]' : 'border-black/12 text-black/40'}`}>
                  {tg}
                </span>
              ))}
            </div>
          </div>
          <div className="px-2 pb-1 pt-4 text-[15px] text-black/40">近期场次</div>
          {cSess.map((s, i) => (
            <button
              key={i}
              type="button"
              disabled={s.started}
              onClick={() => { setShowDay(i); setSel(new Set()); setView('comedySeats'); }}
              className={`mt-2 flex w-full items-center rounded-2xl bg-white p-3.5 text-left active:opacity-80 ${s.started ? 'opacity-55' : ''}`}
            >
              <div className="min-w-0 flex-1">
                <div className="text-[16px] font-bold text-black/90">
                  {s.real.label} {s.real.md} {s.start}
                </div>
                <div className="mt-0.5 text-[13px] text-black/45">
                  {show.venue} · 小剧场 {s.start}-{s.end}
                </div>
              </div>
              {!s.started ? (
                <div className="mr-3 shrink-0 text-[#FF7A00]">
                  <span className="text-[11px]">¥</span>
                  <span className="text-[17px] font-black">{s.price}</span>
                  <span className="text-[11px] text-black/40">起</span>
                </div>
              ) : null}
              {s.started ? (
                <span className="shrink-0 rounded-full bg-black/[0.06] px-4 py-1.5 text-[13px] font-bold text-black/35">已开演</span>
              ) : (
                <span className="shrink-0 rounded-full bg-gradient-to-r from-[#FFB03A] to-[#FF7A00] px-4 py-1.5 text-[13px] font-bold text-white">选座购票</span>
              )}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ---------- 喜剧脱口秀·选座（橙主题） ----------
  if (view === 'comedySeats' && show) {
    const cSess = COMEDY_SESSION_TIMES[showDay];
    const cReal = tbRealDate(showDay);
    return (
      <div className="flex h-full flex-col bg-white">
        <div className="flex shrink-0 items-center gap-2 px-3 pb-2 pt-[56px]">
          <button type="button" aria-label="返回" onClick={() => setView('comedyVenue')} className="grid h-9 w-9 shrink-0 place-items-center rounded-full active:opacity-60">
            <ArrowLeft className="h-[22px] w-[22px] text-black/85" strokeWidth={2.2} />
          </button>
          <span className="min-w-0 flex-1 truncate text-center text-[18px] font-bold text-black/90">{show.title}·选座</span>
          <button type="button" aria-label="更多" onClick={() => onToast('更多（演示）')} className="grid h-8 w-[52px] shrink-0 place-items-center rounded-full bg-black/[0.05]">
            <MoreHorizontal className="h-[17px] w-[17px] text-black/70" />
          </button>
        </div>
        <div className="flex shrink-0 items-center justify-center gap-7 pb-2 pt-1 text-[13px] text-black/60">
          <span className="flex items-center gap-1.5">
            <span className="h-[15px] w-[15px] rounded-[4px] border border-black/20 bg-white" />
            可选
          </span>
          <span className="flex items-center gap-1.5">
            <span className="grid h-[15px] w-[15px] place-items-center rounded-[4px] bg-[#F03E3E]">
              <span className="h-[3px] w-[3px] rounded-full bg-white/90 shadow-[3px_0_0_0_rgba(255,255,255,0.9)]" />
            </span>
            已售
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-[15px] w-[15px] rounded-[4px] border border-dashed border-[#FF7A00]" />
            最佳观演区
          </span>
        </div>
        <div className="shrink-0 px-8">
          <svg viewBox="0 0 300 14" className="h-[14px] w-full" aria-hidden="true">
            <path d="M4 12 Q150 -8 296 12" stroke="#FF7A00" strokeWidth="3" fill="none" strokeLinecap="round" />
            <path d="M4 12 Q150 -8 296 12" stroke="#FF7A00" strokeWidth="9" fill="none" opacity="0.18" />
          </svg>
          <div className="pb-1 pt-0.5 text-center text-[12px] text-black/35">小剧场 舞台</div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4">
          <div className="relative mx-auto w-fit py-2">
            {TB_SEAT_LAYOUT.map((row, r) => {
              let k = -1;
              return (
                <div key={r} className="flex items-center gap-[6px] pb-[10px] last:pb-0">
                  <span className="grid h-[20px] w-[20px] shrink-0 place-items-center rounded bg-black/[0.06] text-[11px] text-black/45">{r + 1}</span>
                  {row.map((v, ci) => {
                    if (!v) return <span key={ci} className="h-[20px] w-[6px]" />;
                    k++;
                    const key = `${r}-${k}`;
                    const sold = tbSeatSold(r, k);
                    const picked = sel.has(key);
                    return (
                      <button
                        key={ci}
                        type="button"
                        aria-label={`${r + 1}排${k + 1}列`}
                        onClick={() => toggleSeat(r, k)}
                        disabled={sold}
                        className={`h-[20px] w-[24px] rounded-[5px] transition-colors ${sold ? 'bg-[#F03E3E]' : picked ? 'grid place-items-center bg-[#FF7A00]' : 'border border-black/15 bg-white'}`}
                      >
                        {picked ? <Check className="h-3 w-3 text-white" strokeWidth={3.4} /> : null}
                      </button>
                    );
                  })}
                </div>
              );
            })}
            <span
              className="pointer-events-none absolute rounded-md border-[1.5px] border-dashed border-[#FF7A00]"
              style={{ left: 26 + TB_BEST_ZONE.c1 * 30 - 5, top: TB_BEST_ZONE.r1 * 30 - 4, width: (TB_BEST_ZONE.c2 - TB_BEST_ZONE.c1 + 1) * 30 - 8, height: (TB_BEST_ZONE.r2 - TB_BEST_ZONE.r1 + 1) * 30 - 12 }}
            />
            <span className="pointer-events-none absolute bottom-1 left-1/2 top-1 border-l border-dashed border-black/15" />
          </div>
          <div className="pb-2 pt-3 text-center text-[15px] font-bold text-[#C6CBD4]">淘票票·喜剧</div>
        </div>
        <div className="shrink-0 bg-[#F4F5F7] px-3 pb-5 pt-2">
          <div className="rounded-xl bg-white p-3">
            <div className="flex items-center">
              <span className="truncate text-[15px] font-bold text-black/90">{show.title}</span>
              <button type="button" onClick={() => setView('comedyVenue')} className="ml-auto shrink-0 text-[13.5px] font-medium text-[#3B82F6] active:opacity-70">切换场次</button>
            </div>
            <div className="mt-0.5 text-[13.5px] text-black/75">
              <span className="font-semibold text-[#FF7A00]">{cReal.label}</span> {cReal.long} {cSess.start}-{cSess.end} {show.tag}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <span className="text-[13px] text-black/55">推荐座位</span>
              {[1, 2, 3, 4].map((n) => (
                <button key={n} type="button" onClick={() => pickRecommend(n)} className="rounded-lg bg-black/[0.045] px-3 py-1.5 text-[13.5px] text-black/80 active:opacity-70">
                  {n}人
                </button>
              ))}
            </div>
            {sel.size > 0 ? (
              <div className="mt-2.5 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {[...sel].map((key) => {
                  const [r, k] = key.split('-').map(Number);
                  return (
                    <span key={key} className="relative shrink-0 rounded-lg bg-white px-3 py-1.5 text-center shadow-sm">
                      <button type="button" aria-label="移除座位" onClick={() => toggleSeat(r, k)} className="absolute right-0.5 top-0.5 grid h-3.5 w-3.5 place-items-center">
                        <X className="h-2.5 w-2.5 text-black/30" strokeWidth={3} />
                      </button>
                      <span className="block text-[13.5px] font-bold leading-[16px] text-black/85">{r + 1}排{k + 1}列</span>
                      <span className="block text-[10.5px] leading-[13px] text-[#FF7A00]">票价¥120</span>
                    </span>
                  );
                })}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={confirmComedy}
            className={`mt-2.5 h-[52px] w-full rounded-full text-[17px] font-bold text-white active:opacity-90 ${sel.size === 0 ? 'bg-[#F5C9A0]/70' : 'bg-gradient-to-r from-[#FFB03A] to-[#FF7A00]'}`}
          >
            {sel.size === 0 ? '请先选座' : `${sel.size * 120}元 确认选座`}
          </button>
        </div>
      </div>
    );
  }

  // ---------- 演唱会·票档选择 ----------
  if (view === 'concertBuy' && concert) {
    const tier = concert.tiers[tierIdx];
    const isSoon = concert.status === 'soon';
    return (
      <div className="flex h-full flex-col bg-[#F4F5F7]">
        <div className="relative shrink-0 overflow-hidden px-3 pb-4 pt-[56px]" style={{ background: `linear-gradient(150deg, ${concert.c1} 0%, ${concert.c2} 100%)` }}>
          <div className="flex items-center gap-2">
            <HeadBtn onClick={() => setView('tabs')} label="返回">
              <ArrowLeft className="h-[20px] w-[20px] text-white" strokeWidth={2.4} />
            </HeadBtn>
            <span className="text-[19px] font-bold leading-none text-white">演出详情</span>
          </div>
          <div className="mt-3 text-[26px] font-black leading-tight text-white">{concert.artist}</div>
          <div className="mt-1 truncate text-[15px] font-medium text-white/90">「{concert.tour}」</div>
          <div className="mt-2 flex items-center gap-1 text-[13.5px] text-white/85">
            <MapPin className="h-4 w-4 fill-white/90 text-white" />
            {concert.city}·{concert.venue}
          </div>
          <div className="mt-1 text-[13.5px] text-white/85">{concert.dateRange}</div>
          {concert.hot ? <div className="mt-2 inline-block rounded-full bg-white/20 px-2.5 py-0.5 text-[11.5px] font-semibold text-white">{concert.hot}</div> : null}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          {/* 近期场次（Task 2-b：未来 3 天真实日期 × 固定时刻；dateRange 文案仅作展示） */}
          <div className="mt-2 rounded-2xl bg-white p-3">
            <div className="text-[17px] font-black text-black/90">选择场次</div>
            <div className="mt-2.5 space-y-2">
              {concertSessions.map((s, i) => (
                <button
                  key={i}
                  type="button"
                  disabled={s.started}
                  onClick={() => setConcertDay(i)}
                  className={`flex w-full items-center rounded-xl border px-3.5 py-3 text-left ${s.started ? 'border-black/[0.06] bg-black/[0.02] opacity-55' : i === concertDay ? 'border-[#7C5CFF] bg-[#F4F0FF]' : 'border-black/[0.08] bg-white'}`}
                >
                  <span className={`grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border-2 ${!s.started && i === concertDay ? 'border-[#7C5CFF]' : 'border-black/20'}`}>
                    {!s.started && i === concertDay ? <span className="h-2 w-2 rounded-full bg-[#7C5CFF]" /> : null}
                  </span>
                  <span className="ml-3 min-w-0 flex-1">
                    <span className="block text-[15px] font-bold text-black/90">{s.label} {s.md} {s.start}</span>
                    <span className="mt-0.5 block truncate text-[12px] text-black/40">{concert.venue} · {s.start}-{s.end}</span>
                  </span>
                  <span className={`shrink-0 text-[12px] font-medium ${s.started ? 'text-black/35' : 'text-[#12B76A]'}`}>{s.started ? '已开演' : '可购'}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="mt-2 rounded-2xl bg-white p-3">
            <div className="text-[17px] font-black text-black/90">选择票档</div>
            <div className="mt-2.5 space-y-2">
              {concert.tiers.map((tr, i) => (
                <button key={tr.name} type="button" disabled={isSoon} onClick={() => setTierIdx(i)} className={`flex w-full items-center rounded-xl border px-3.5 py-3 text-left ${i === tierIdx && !isSoon ? 'border-[#7C5CFF] bg-[#F4F0FF]' : 'border-black/[0.08] bg-white'}`}>
                  <span className={`grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border-2 ${i === tierIdx && !isSoon ? 'border-[#7C5CFF]' : 'border-black/20'}`}>{i === tierIdx && !isSoon ? <span className="h-2 w-2 rounded-full bg-[#7C5CFF]" /> : null}</span>
                  <span className="ml-3 min-w-0 flex-1">
                    <span className="block text-[15px] font-bold text-black/90">{tr.name}</span>
                    <span className="mt-0.5 block text-[12px] text-black/40">电子票 · 凭取票码入场</span>
                  </span>
                  <span className={`mr-3 shrink-0 text-[12px] font-medium ${tr.left === '紧张' ? 'text-[#FF7A00]' : tr.left === '预售' ? 'text-[#3B82F6]' : 'text-[#12B76A]'}`}>{tr.left}</span>
                  <span className="shrink-0 text-[17px] font-black text-[#FF3B30]">
                    <span className="text-[11px]">¥</span>
                    {tr.price}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div className="mt-2 rounded-2xl bg-white p-3 text-[13px] leading-6 text-black/55">
            <div className="text-[15px] font-bold text-black/85">购票须知</div>
            <div>· 一人一票，凭电子取票码入场；</div>
            <div>· 演出票支持开演前48小时退票/改签；</div>
            <div>· 请提前60分钟到场安检取票。</div>
          </div>
        </div>
        <div className="shrink-0 bg-white px-3 pb-5 pt-2.5">
          <div className="pb-1 text-[12px] text-black/45">场次：{concertSessions[concertDay]?.label} {concertSessions[concertDay]?.md} {concertSessions[concertDay]?.start} · {concert.venue}</div>
          <div className="flex items-center gap-3">
            <span className="text-[14px] text-black/70">数量</span>
            <div className="flex items-center gap-3 rounded-full bg-black/[0.04] px-2 py-1">
              <button type="button" aria-label="减少数量" onClick={() => setCQty((n) => Math.max(1, n - 1))} className="grid h-7 w-7 place-items-center rounded-full bg-white shadow-sm active:opacity-70">
                <Minus className="h-4 w-4 text-black/70" />
              </button>
              <span className="min-w-[20px] text-center text-[15px] font-bold text-black/85">{cQty}</span>
              <button type="button" aria-label="增加数量" onClick={() => setCQty((n) => Math.min(4, n + 1))} className="grid h-7 w-7 place-items-center rounded-full bg-white shadow-sm active:opacity-70">
                <Plus className="h-4 w-4 text-black/70" />
              </button>
            </div>
            <span className="ml-auto text-[13px] text-black/45">合计</span>
            <span className="text-[19px] font-black text-[#FF3B30]">
              <span className="text-[12px]">¥</span>
              {tier ? fmtMoney(tier.price * cQty) : 0}
            </span>
          </div>
          <button
            type="button"
            onClick={isSoon ? () => onToast(`已预约提醒：${concert.dateRange} 10:00 正式开抢`) : confirmConcert}
            className={`mt-2.5 h-[52px] w-full rounded-full text-[17px] font-bold text-white active:opacity-90 ${isSoon ? 'bg-[#C9B8F5]' : 'bg-gradient-to-r from-[#7C5CFF] to-[#5A3BD8]'}`}
          >
            {isSoon ? '预售中·点击预约提醒' : `确认选票 · ${tier?.name ?? ''}`}
          </button>
        </div>
      </div>
    );
  }

  // ---------- 淘票票主界面（顶部四频道 tab 固定，其余内容全部跟随滚动；顶部下拉=前插新内容，底部上拉=末尾追加，前插/追加保旧不跳顶） ----------
  const movies = [...aiMovies, ...fresh(TB_MOVIES, 2), ...TB_MOVIES, ...aiTails.movie];
  // Task 44：三频道 + 即将上映均接入 AI 前插与独立兜底批次（刷新内容真正更新且永不消失）
  // Task 45：各频道底部追加条目接在列表最后（上方内容原位不变）
  const soonMovies = [...aiSoon, ...fresh(TB_MOVIES_SOON, 2, soonBatches), ...TB_MOVIES_SOON, ...aiTails.movieUp];
  const shows = [...aiShows, ...fresh(TB_COMEDY_SHOWS, 1, showBatches), ...TB_COMEDY_SHOWS, ...aiTails.comedy];
  const concerts = [...aiConcerts, ...fresh(TB_CONCERTS, 1, concertBatches), ...TB_CONCERTS, ...aiTails.concert];
  const merchs = [...aiMerchs, ...fresh(TB_MERCH, 2, merchBatches), ...TB_MERCH, ...aiTails.merch];
  return (
    <div className="relative flex h-full flex-col bg-[#F4F5F7]">
      {/* 顶栏（粉底）+ 频道 tab（唯一固定区） */}
      <div className="relative z-30 shrink-0 bg-gradient-to-b from-[#FF5C8A] to-[#FF3676] px-3 pb-0 pt-[56px]">
        <div className="flex items-center gap-2">
          <HeadBtn onClick={onBack} label="返回">
            <ArrowLeft className="h-[20px] w-[20px] text-white" strokeWidth={2.4} />
          </HeadBtn>
          <span className="text-[21px] font-bold leading-none text-white">淘票票</span>
          <span className="ml-2 flex items-center gap-0.5 text-[15px] font-medium text-white/95">
            <MapPin className="h-[15px] w-[15px] fill-white/90 text-white" />
            濮阳
          </span>
          <div className="ml-auto flex items-center gap-2">
            <HeadBtn onClick={() => onToast('更多（演示）')} label="更多">
              <MoreHorizontal className="h-[19px] w-[19px] text-white" strokeWidth={2.2} />
            </HeadBtn>
            <HeadBtn onClick={() => onToast('拍摄（演示）')} label="拍摄">
              <span className="grid h-[15px] w-[15px] place-items-center rounded-full border-2 border-white" />
            </HeadBtn>
          </div>
        </div>
        {/* 四大频道 tab */}
        <div className="mt-1.5 flex items-center gap-5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {TP_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setTab(t.id);
                pull.scrollRef.current?.scrollTo({ top: 0 });
              }}
              className={`relative shrink-0 pb-2 text-[16px] ${tab === t.id ? 'font-bold text-white' : 'text-white/70'}`}
            >
              {t.label}
              {tab === t.id ? <span className="absolute inset-x-1 bottom-0 h-[3px] rounded-full bg-white" /> : null}
            </button>
          ))}
        </div>
      </div>
      {/* 内容区（全部跟随滚动；双向刷新胶囊悬浮于此） */}
      <div className="relative min-h-0 flex-1">
        <div ref={pull.scrollRef} {...pull.bind} className="h-full overflow-y-auto pb-8">
        {/* ===== 电影 ===== */}
        {tab === 'movie' ? (
          <>
            {/* 光影故事横幅（跟随滚动） */}
            <div className="px-3 pt-2">
              <button type="button" onClick={() => onToast('惠民观影活动（演示）')} className="relative block h-[132px] w-full overflow-hidden rounded-2xl bg-gradient-to-r from-[#8EC9F0] via-[#F6CBD8] to-[#FFE29A] text-left active:opacity-90">
                <span className="absolute left-0 right-0 top-5 text-center text-[28px] font-black italic leading-[36px] tracking-wide text-[#2B3A67] drop-shadow-[0_1px_0_rgba(255,255,255,0.6)]">
                  光影故事 美好生活
                </span>
                <span className="absolute left-1/2 top-[80px] -translate-x-1/2 rotate-[-3deg] rounded-full bg-[#5C6BC0]/90 px-3.5 py-1 text-[12px] font-medium text-white">2026年河南省惠民观影活动</span>
                <span className="absolute bottom-2 right-3 grid h-[36px] w-[36px] place-items-center rounded-full bg-[#FF8A00] shadow-md">
                  <Clapperboard className="h-[19px] w-[19px] text-white" strokeWidth={2} />
                </span>
                <span className="absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-1">
                  <span className="h-[4px] w-[10px] rounded-full bg-white" />
                  <span className="h-[4px] w-[4px] rounded-full bg-white/50" />
                </span>
              </button>
            </div>
            {/* 新人限时福利 */}
            <div className="mx-2 mt-2 rounded-2xl bg-white p-3">
              <div className="text-[17px] font-black text-[#FF3676]">新人限时福利</div>
              <div className="mt-2.5 grid grid-cols-2 gap-2">
                <button type="button" onClick={onOpenCouponCenter} className="flex items-center justify-between rounded-xl bg-gradient-to-br from-[#FFE1EC] to-[#FFD0E0] p-3 text-left active:opacity-85">
                  <span>
                    <span className="block text-[15px] font-bold text-black/90">观影权益</span>
                    <span className="mt-0.5 block text-[12px] text-black/45">月月领</span>
                    <span className="mt-2 inline-block rounded-full bg-gradient-to-r from-[#FF5C8A] to-[#FF2D6B] px-3 py-1 text-[12.5px] font-semibold text-white">去领券</span>
                  </span>
                  <Ticket className="h-9 w-9 rotate-[-12deg] text-white/80" strokeWidth={1.6} />
                </button>
                <button type="button" onClick={() => onToast('抽免单卡（演示）')} className="flex items-center justify-between rounded-xl bg-[#FFF3DC] p-3 text-left active:opacity-85">
                  <span>
                    <span className="block text-[15px] font-bold text-black/90">抽免单卡</span>
                    <span className="mt-0.5 block text-[12px] text-black/45">0.01元喝</span>
                    <span className="mt-2 inline-block rounded-full bg-gradient-to-r from-[#FFB03A] to-[#FF8A00] px-3 py-1 text-[12.5px] font-semibold text-white">去看看</span>
                  </span>
                  <span className="grid h-9 w-9 place-items-center rounded-lg bg-[#FFD100]/70 text-[12px] font-black text-[#8a6300]">免18元</span>
                </button>
              </div>
            </div>
            {/* 热映影片 / 即将上映 子频道（Task 44：独立界面化，子标签吸顶，双向刷新+持久化） */}
            <div className="sticky top-0 z-20 mx-2 mt-2 flex items-center gap-6 rounded-t-2xl bg-white px-4 pt-3">
              {([
                { id: 'hot' as const, label: '热映影片' },
                { id: 'soon' as const, label: '即将上映' },
              ]).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    setMovieSub(s.id);
                    pull.scrollRef.current?.scrollTo({ top: 0 });
                  }}
                  className={`relative pb-2 text-[18px] leading-none transition-colors ${movieSub === s.id ? 'font-black text-black/90' : 'font-medium text-black/40'}`}
                >
                  {s.label}
                  {movieSub === s.id ? <span className="absolute inset-x-1 bottom-0 h-[3px] rounded-full bg-[#FF3676]" /> : null}
                </button>
              ))}
              <span className="ml-auto pb-2 text-[12px] text-black/35">{movieSub === 'hot' ? '新热预告' : '新片想看榜'}</span>
            </div>
            {movieSub === 'hot' ? (
              <div className="mx-2 mb-1 rounded-b-2xl bg-white px-3 pb-3">
                {movies.map((m, mi) => (
                  <div key={m.id} className={`flex gap-3 py-3 ${mi < movies.length - 1 ? 'border-b border-black/[0.05]' : ''}`}>
                    <span className="block w-[92px] shrink-0">
                      <MoviePoster m={m} h={124} onOpen={() => { setMovie(m); setDay(0); setSel(new Set()); setView('cinemas'); }} />
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col">
                      <div className="truncate text-[16.5px] font-bold text-black/90">{m.title}</div>
                      <div className="mt-1 flex items-center gap-1.5 text-[13px]">
                        {m.rating != null ? (
                          <span className="font-bold text-[#FF9500]">
                            <span className="text-[10px]">★</span> {m.rating}分
                          </span>
                        ) : (
                          <span className="font-semibold text-[#FF3676]">{m.want}</span>
                        )}
                        <span className="rounded-[3px] bg-black/[0.06] px-1 py-px text-[10.5px] text-black/55">{m.badge}</span>
                      </div>
                      <div className="mt-0.5 truncate text-[12px] text-black/40">台前县中影时光国际影城 · 今日21:00</div>
                      <div className="mt-auto flex items-center">
                        <button
                          type="button"
                          onClick={() => { setMovie(m); setDay(0); setSel(new Set()); setView('cinemas'); }}
                          className="rounded-full bg-gradient-to-r from-[#FF5C8A] to-[#FF2D6B] px-5 py-1.5 text-[13.5px] font-bold text-white active:opacity-85"
                        >
                          购票
                        </button>
                        <span className="ml-2 text-[11px] font-semibold text-[#FF3676]">特惠</span>
                        <span className="ml-auto text-[11px] text-black/35">改签/退票</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mx-2 mb-1 rounded-b-2xl bg-white px-3 pb-3">
                {soonMovies.map((m, mi) => (
                  <div key={m.id} className={`flex gap-3 py-3 ${mi < soonMovies.length - 1 ? 'border-b border-black/[0.05]' : ''}`}>
                    <span className="block w-[92px] shrink-0">
                      <MoviePoster m={m} h={124} onOpen={() => onToast(`已预约《${m.title}》上映提醒`)} />
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col">
                      <div className="truncate text-[16.5px] font-bold text-black/90">{m.title}</div>
                      <div className="mt-1 flex items-center gap-1.5 text-[13px]">
                        {m.want ? (
                          <span className="font-semibold text-[#FF3676]">{m.want}</span>
                        ) : m.rating != null ? (
                          <span className="font-bold text-[#FF9500]">
                            <span className="text-[10px]">★</span> {m.rating}分
                          </span>
                        ) : null}
                        <span className="rounded-[3px] bg-black/[0.06] px-1 py-px text-[10.5px] text-black/55">{m.badge}</span>
                      </div>
                      <div className="mt-0.5 text-[12px] text-black/40">{soonDateLabel(tbStrHash(m.id))} 上映</div>
                      <div className="mt-auto flex items-center">
                        <button
                          type="button"
                          onClick={() => onToast(`已预约《${m.title}》上映提醒`)}
                          className="rounded-full border border-[#FF5C8A] px-5 py-1.5 text-[13.5px] font-bold text-[#FF3676] active:opacity-75"
                        >
                          想看
                        </button>
                        <span className="ml-2 text-[11px] text-black/35">上映前提醒</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : null}
        {/* ===== 喜剧脱口秀 ===== */}
        {tab === 'comedy' ? (
          <>
            <div className="px-3 pt-2">
              <button type="button" onClick={() => onToast('开心喜剧节（演示）')} className="relative block h-[118px] w-full overflow-hidden rounded-2xl bg-gradient-to-r from-[#FF9A3C] via-[#FF7A3C] to-[#FF5A2A] text-left active:opacity-90">
                <span className="absolute left-4 top-5 text-[24px] font-black italic tracking-wide text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.25)]">开心喜剧节</span>
                <span className="absolute left-4 top-[52px] text-[13px] font-medium text-white/95">笑到打鸣 · 全城开麦</span>
                <span className="absolute bottom-3 left-4 rounded-full bg-white/25 px-3 py-1 text-[12px] font-semibold text-white">领30元演出券</span>
                <span className="absolute bottom-2 right-3 grid h-[38px] w-[38px] place-items-center rounded-full bg-white/20">
                  <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M3 10c2.5-3.5 7-5 9-5s6.5 1.5 9 5c-1 4-4.5 8-9 8s-8-4-9-8Z" fill="#fff" opacity="0.9" />
                    <path d="M8 9.5c.8-1.2 2-2 3.5-2M13 14.5c1 .3 2.2.2 3.2-.4" stroke="#FF7A3C" strokeWidth="1.4" fill="none" strokeLinecap="round" />
                  </svg>
                </span>
              </button>
            </div>
            <div className="mx-2 mt-2 space-y-2 pb-1">
              {shows.map((s) => (
                <div key={s.id} className="flex gap-3 rounded-2xl bg-white p-3">
                  <button
                    type="button"
                    aria-label={`打开${s.title}`}
                    onClick={() => { setShow(s); setShowDay(0); setSel(new Set()); setView('comedyVenue'); }}
                    className="relative h-[104px] w-[84px] shrink-0 overflow-hidden rounded-xl text-left active:opacity-85"
                    style={{ background: `linear-gradient(160deg, ${s.c1}, ${s.c2})` }}
                  >
                    <span className="absolute left-1 top-1 rounded-[3px] bg-black/40 px-1 py-px text-[9px] font-bold text-white">{s.tag}</span>
                    <span className="absolute inset-x-1.5 top-6 line-clamp-3 text-[13px] font-black leading-[17px] text-white">{s.title}</span>
                  </button>
                  <div className="min-w-0 flex-1">
                    <button type="button" onClick={() => { setShow(s); setShowDay(0); setSel(new Set()); setView('comedyVenue'); }} className="block w-full text-left active:opacity-80">
                      <div className="truncate text-[15px] font-bold text-black/90">{s.title}</div>
                      <div className="mt-0.5 truncate text-[12px] text-black/45">{s.sub}</div>
                      <div className="mt-0.5 flex items-center gap-0.5 text-[12px] text-black/45">
                        <MapPin className="h-3 w-3 shrink-0" />
                        <span className="truncate">{s.venue}</span>
                      </div>
                      <div className="mt-0.5 truncate text-[12px] text-black/45">{s.dateRange}</div>
                    </button>
                    <div className="mt-1.5 flex items-center">
                      <span className="text-[15px] font-black text-[#FF3B30]">
                        <span className="text-[10px]">¥</span>
                        {s.price}
                      </span>
                      {s.hot ? <span className="ml-2 text-[11px] text-black/35">{s.hot}</span> : null}
                      <button type="button" onClick={() => { setShow(s); setShowDay(0); setSel(new Set()); setView('comedyVenue'); }} className="ml-auto shrink-0 rounded-full bg-gradient-to-r from-[#FFB03A] to-[#FF7A00] px-4 py-1.5 text-[13px] font-bold text-white active:opacity-85">
                        选座购票
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : null}
        {/* ===== 演唱会 ===== */}
        {tab === 'concert' ? (
          <>
            <div className="px-3 pt-2">
              <div className="relative h-[112px] overflow-hidden rounded-2xl bg-gradient-to-r from-[#7C5CFF] via-[#9F7BFF] to-[#C9A8FF] p-4 text-left">
                <div className="text-[22px] font-black italic tracking-wide text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.25)]">演唱会 · 重启现场</div>
                <div className="mt-1 text-[13px] text-white/95">炸场阵容陆续官宣中</div>
                <div className="mt-2 inline-block rounded-full bg-white/25 px-3 py-1 text-[12px] font-semibold text-white">大麦VIP印花票根</div>
                <Mic className="absolute bottom-3 right-3 h-10 w-10 text-white/40" strokeWidth={1.6} />
              </div>
            </div>
            <div className="mx-2 mt-2 space-y-2 pb-1">
              {concerts.map((cc) => (
                <button
                  key={cc.id}
                  type="button"
                  onClick={() => openConcertBuy(cc)}
                  className="block w-full overflow-hidden rounded-2xl text-left active:opacity-90"
                  style={{ background: `linear-gradient(140deg, ${cc.c1}, ${cc.c2})` }}
                >
                  <div className="p-4">
                    <div className="flex items-center gap-2">
                      <span className="text-[20px] font-black text-white">{cc.artist}</span>
                      {cc.status === 'soon' ? (
                        <span className="rounded-full bg-white/25 px-2 py-0.5 text-[11px] font-bold text-white">预售</span>
                      ) : (
                        <span className="rounded-full bg-[#FFD100] px-2 py-0.5 text-[11px] font-black text-black/80">开售中</span>
                      )}
                      {cc.hot ? <span className="ml-auto text-[11.5px] text-white/80">{cc.hot}</span> : null}
                    </div>
                    <div className="mt-1 truncate text-[14px] font-medium text-white/95">「{cc.tour}」</div>
                    <div className="mt-2 flex items-center gap-1 text-[12.5px] text-white/85">
                      <MapPin className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{cc.city}·{cc.venue}</span>
                    </div>
                    <div className="mt-0.5 text-[12.5px] text-white/85">{cc.dateRange}</div>
                    <div className="mt-2 flex items-center">
                      <span className="text-[16px] font-black text-[#FFD100]">
                        <span className="text-[10px]">¥</span>
                        {cc.tiers[cc.tiers.length - 1].price}
                        <span className="text-[11px]">起</span>
                      </span>
                      <span className="ml-auto rounded-full bg-white px-4 py-1.5 text-[13px] font-bold text-black/85">{cc.status === 'soon' ? '预约提醒' : '立即选票'}</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </>
        ) : null}
        {/* ===== 周边商城 ===== */}
        {tab === 'merch' ? (
          <>
            <div className="px-3 pt-2">
              <div className="relative h-[112px] overflow-hidden rounded-2xl bg-gradient-to-r from-[#FF8A9E] via-[#FF6A8A] to-[#FF4A6A] p-4 text-left">
                <div className="text-[22px] font-black italic tracking-wide text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.25)]">电影周边商城</div>
                <div className="mt-1 text-[13px] text-white/95">官方授权 · 正品保障</div>
                <div className="mt-2 inline-block rounded-full bg-white/25 px-3 py-1 text-[12px] font-semibold text-white">全场满69包邮</div>
                <ShoppingBag className="absolute bottom-3 right-3 h-10 w-10 text-white/40" strokeWidth={1.6} />
              </div>
            </div>
            <div className="mx-2 mt-2 grid grid-cols-2 gap-2 pb-1">
              {merchs.map((m) => (
                <button key={m.id} type="button" onClick={() => { setBuyMerch(m); setMQty(1); }} className="overflow-hidden rounded-2xl bg-white text-left active:opacity-85">
                  <TbImg src={tbImg(m.tag, 300, 300)} alt={m.title} className="h-[142px] w-full" />
                  <div className="p-2.5">
                    <div className="line-clamp-2 text-[13.5px] font-semibold leading-[18px] text-black/85">{m.title}</div>
                    <div className="mt-1 truncate text-[11px] text-black/35">{m.from}</div>
                    <div className="mt-1.5 flex items-baseline">
                      <span className="text-[17px] font-black text-[#FF3B30]">
                        <span className="text-[10px]">¥</span>
                        {fmtMoney(m.price)}
                      </span>
                      {m.orig ? <span className="ml-1 text-[11px] text-black/30 line-through">¥{fmtMoney(m.orig)}</span> : null}
                    </div>
                    <div className="mt-0.5 text-[11px] text-black/35">{m.hot}</div>
                  </div>
                </button>
              ))}
            </div>
            <div className="pb-1 pt-4 text-center text-[15px] font-bold text-[#C6CBD4]">淘票票·周边商城</div>
          </>
        ) : null}
        </div>
        <TbPullIndicator h={pull} />
      </div>
      {/* 周边购买弹层（数量步进 + 立即购买 → 待付款订单 → 支付面板） */}
      {buyMerch ? (
        <div className="absolute inset-0 z-40 flex flex-col justify-end bg-black/40" onClick={() => setBuyMerch(null)}>
          <div className="rounded-t-2xl bg-white p-4 pb-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex gap-3">
              <TbImg src={tbImg(buyMerch.tag, 200, 200)} alt={buyMerch.title} className="h-[84px] w-[84px] shrink-0 rounded-xl" />
              <div className="min-w-0 flex-1">
                <div className="line-clamp-2 text-[15px] font-bold leading-5 text-black/90">{buyMerch.title}</div>
                <div className="mt-1 truncate text-[12px] text-black/40">{buyMerch.from}</div>
                <div className="mt-1.5 text-[19px] font-black text-[#FF3B30]">
                  <span className="text-[12px]">¥</span>
                  {fmtMoney(buyMerch.price)}
                  {buyMerch.orig ? <span className="ml-1.5 text-[12px] font-normal text-black/35 line-through">¥{fmtMoney(buyMerch.orig)}</span> : null}
                </div>
              </div>
              <button type="button" aria-label="关闭" onClick={() => setBuyMerch(null)} className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-black/[0.05]">
                <X className="h-4 w-4 text-black/50" />
              </button>
            </div>
            <div className="mt-4 flex items-center">
              <span className="text-[14px] text-black/70">购买数量</span>
              <div className="ml-auto flex items-center gap-3 rounded-full bg-black/[0.04] px-2 py-1">
                <button type="button" aria-label="减少数量" onClick={() => setMQty((n) => Math.max(1, n - 1))} className="grid h-7 w-7 place-items-center rounded-full bg-white shadow-sm active:opacity-70">
                  <Minus className="h-4 w-4 text-black/70" />
                </button>
                <span className="min-w-[20px] text-center text-[15px] font-bold text-black/85">{mQty}</span>
                <button type="button" aria-label="增加数量" onClick={() => setMQty((n) => Math.min(4, n + 1))} className="grid h-7 w-7 place-items-center rounded-full bg-white shadow-sm active:opacity-70">
                  <Plus className="h-4 w-4 text-black/70" />
                </button>
              </div>
            </div>
            <button type="button" onClick={buyMerchNow} className="mt-4 h-[48px] w-full rounded-full bg-gradient-to-r from-[#FF5C8A] to-[#FF2D6B] text-[16px] font-bold text-white active:opacity-90">
              立即购买 · ¥{fmtMoney(buyMerch.price * mQty)}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ============================== 电影票详情（截图1/2/3：待开场/已放映/已退款 三态） ==============================

/** 伪二维码（21×21 + 三定位角，按取票号播种 → 同一票稳定同图；演示用） */
function tbQrGrid(seed: string): boolean[][] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const rnd = (): number => {
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h >>> 0) % 1000) / 1000;
  };
  const n = 21;
  const grid: boolean[][] = Array.from({ length: n }, () => Array.from({ length: n }, () => rnd() > 0.52));
  const finder = (r0: number, c0: number) => {
    for (let r = 0; r < 7; r++)
      for (let c = 0; c < 7; c++) {
        const edge = r === 0 || r === 6 || c === 0 || c === 6;
        const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        grid[r0 + r][c0 + c] = edge || core;
      }
    for (let i = -1; i < 8; i++) {
      if (r0 - 1 >= 0 && c0 + i >= 0 && c0 + i < n) grid[r0 - 1][c0 + i] = false;
      if (r0 + 7 < n && c0 + i >= 0 && c0 + i < n) grid[r0 + 7][c0 + i] = false;
      if (c0 - 1 >= 0 && r0 + i >= 0 && r0 + i < n) grid[r0 + i][c0 - 1] = false;
      if (c0 + 7 < n && r0 + i >= 0 && r0 + i < n) grid[r0 + i][c0 + 7] = false;
    }
  };
  finder(0, 0);
  finder(0, n - 7);
  finder(n - 7, 0);
  return grid;
}

/** 电影票详情（截图1/2/3 三态：
 *  待开场=紫底倒计时「N小时N分钟后开场」+黑色取票码+退改签(支持改签)；
 *  已放映=橙底「电影已放映」+评价影片/影院+灰码已放映章+本单权益+周边推广；
 *  已退款=靛蓝底「已退款」+退款时间金额+灰码已退款章+退改签(已退款)；
 *  Task 2-b 新增：已入场（扫码核销=确认收货）/交易关闭（待付款取消）态 +
 *  「扫码入场」主按钮（点击=核销）+ 头部「分享」按钮 */
export function TicketDetailPage({
  uid,
  orderId,
  onBack,
  onToast,
  onRate,
  onOpenMerch,
  onShare,
  onPayOrder,
}: {
  uid: string;
  orderId: string;
  onBack: () => void;
  onToast: (m: string) => void;
  /** 评价影片/影院（订单已完成且有评价入口时走 RateSheet） */
  onRate: (id: string) => void;
  /** 去周边商城（已放映态推广卡） */
  onOpenMerch: () => void;
  /** 分享（头部按钮）：打开 TbShareOrderSheet 分享给微信/QQ 好友 */
  onShare: (id: string) => void;
  /** 待付款（代付请求已发出等场景）打开收银台 */
  onPayOrder: (id: string) => void;
}) {
  const [, setTick] = useState(0);
  const [qrTab, setQrTab] = useState<'pick' | 'scan'>('pick');
  const [refundOpen, setRefundOpen] = useState(false);
  const [refunding, setRefunding] = useState(false);
  // 30s 心跳：倒计时走字 + 开场后自动切「已放映」
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  tbTickOrders(uid);
  const o = tbLoadOrders(uid).find((x) => x.id === orderId);
  if (!o || !o.ticket) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-white">
        <p className="text-[13px] text-black/40">票务订单不存在</p>
        <button type="button" onClick={onBack} className="rounded-full bg-gradient-to-r from-[#FF5C8A] to-[#FF2D6B] px-6 py-2 text-[13px] font-semibold text-white">
          返回
        </button>
      </div>
    );
  }
  const t = o.ticket;
  const startAt = new Date(`${t.date}T${t.start}:00`).getTime();
  const now = Date.now();
  const refunded = !!t.refunded;
  /** 交易关闭（待付款取消/超时，非退款） */
  const closed = o.status === 'cancelled' && !refunded;
  /** 待付款（确认选座/选票后未支付；代付请求已发出也会停留在此态） */
  const unpaid = o.status === 'pendingPay';
  /** 已入场（扫码核销=确认收货；优先于已放映） */
  const entered = !refunded && !closed && !!t.enteredAt;
  const screened = !refunded && !closed && !entered && Number.isFinite(startAt) && now >= startAt;
  const theme = refunded
    ? { from: '#3D4785', to: '#5A64A8' }
    : closed
      ? { from: '#5B6470', to: '#8A94A3' }
      : entered
        ? { from: '#0B8F5C', to: '#3BC46A' }
        : unpaid
          ? { from: '#FF5C3C', to: '#FF8A6B' }
          : screened
            ? { from: '#FF6A3C', to: '#FF9E75' }
            : { from: '#4A3A9C', to: '#6C5BD4' };
  // 开场倒计时（截图1口径：21小时48分钟后开场；跨天>N天N小时后开场）
  const countdown = (() => {
    if (refunded || closed || unpaid || entered || screened) return null;
    const diff = Math.max(0, startAt - now);
    const h = Math.floor(diff / 3_600_000);
    const m = Math.floor((diff % 3_600_000) / 60_000);
    if (h >= 48) {
      const d = Math.floor(h / 24);
      return `${d}天${h % 24}小时后开场`;
    }
    return h > 0 ? `${h}小时${m}分钟后开场` : `${Math.max(1, m)}分钟后开场`;
  })();
  const refundAtText = t.refunded
    ? `${new Date(t.refunded.at).getFullYear()}-${String(new Date(t.refunded.at).getMonth() + 1).padStart(2, '0')}-${String(new Date(t.refunded.at).getDate()).padStart(2, '0')} ${String(new Date(t.refunded.at).getHours()).padStart(2, '0')}:${String(new Date(t.refunded.at).getMinutes()).padStart(2, '0')}:${String(new Date(t.refunded.at).getSeconds()).padStart(2, '0')}`
    : '';
  const qrCells = tbQrGrid(t.ticketNo);
  const qrDead = refunded || closed || screened || entered;
  const qrStamp = refunded ? '已退款' : closed ? '已关闭' : entered ? '已入场' : '已放映';
  const pickLabel = t.kind === 'movie' ? '取电影票' : '取演出票';
  const canRate = o.status === 'completed' && !o.review;
  const doRate = () => {
    if (canRate) onRate(o.id);
    else onToast('散场后开放评价（演示）');
  };
  const fmtEnteredAt = t.enteredAt
    ? `${new Date(t.enteredAt).getMonth() + 1}月${new Date(t.enteredAt).getDate()}日 ${String(new Date(t.enteredAt).getHours()).padStart(2, '0')}:${String(new Date(t.enteredAt).getMinutes()).padStart(2, '0')}`
    : '';
  /** 扫码入场：核销 = 确认收货（shipped → completed + 写 enteredAt）；已开演未散场也可核销 */
  const doScanEnter = () => {
    if (!tbConfirmReceive(uid, o.id)) {
      onToast('当前状态不支持核销入场');
      return;
    }
    tbPushMsg(uid, { kind: 'logistics', title: '已入场', text: `《${t.title}》已核销，扫码入场成功，祝观演愉快`, orderId: o.id });
    setTick((n) => n + 1);
    onToast('核销成功，已入场');
  };
  /** 申请退款：原路退回 → 订单退款成功 → 详情切「已退款」态 */
  const doRefund = async () => {
    if (refunding) return;
    setRefunding(true);
    const okPay = await tbRefundToOrigin(o);
    setRefunding(false);
    if (!okPay) {
      onToast('退款失败，请稍后重试');
      return;
    }
    tbMarkRefund(uid, o.id, o.total, '观影计划有变，申请退票');
    tbPushMsg(uid, { kind: 'refund', title: '退票成功', text: `《${t.title}》退票 ¥${fmtMoney(o.total)} 已原路退回`, orderId: o.id });
    setRefundOpen(false);
    onToast('退票成功，退款已原路退回');
  };
  return (
    <div className="relative flex h-full flex-col bg-[#F4F5F7]">
      {/* 渐变头部：返回/标题 + 状态区 */}
      <div className="relative shrink-0 px-3 pb-10 pt-[56px]" style={{ background: `linear-gradient(165deg, ${theme.from} 0%, ${theme.to} 100%)` }}>
        <div className="relative z-10 flex items-center">
          <button type="button" aria-label="返回" onClick={onBack} className="grid h-9 w-9 place-items-center rounded-full active:opacity-70">
            <ArrowLeft className="h-[21px] w-[21px] text-white" strokeWidth={2.4} />
          </button>
          <span className="flex-1 text-center text-[18px] font-bold text-white">{t.kind === 'movie' ? '电影票详情' : '演出票详情'}</span>
          <button type="button" aria-label="分享" onClick={() => onShare(o.id)} className="grid h-9 w-9 place-items-center rounded-full active:opacity-70">
            <Share2 className="h-[19px] w-[19px] text-white" strokeWidth={2.2} />
          </button>
        </div>
        {/* 状态大区 */}
        <div className="relative z-10 pb-1 pt-3 text-center">
          {refunded ? (
            <>
              <div className="text-[24px] font-black text-white">已退款</div>
              <div className="mt-1.5 text-[13px] text-white/85">{refundAtText} 已退款，退款金额：{fmtMoney(t.refunded!.amount)}元</div>
              <button type="button" onClick={() => onToast('退款明细（演示）：已原路退回')} className="mt-2.5 rounded-full border border-white/80 px-5 py-1.5 text-[14px] font-medium text-white active:opacity-75">
                查看退款
              </button>
            </>
          ) : closed ? (
            <>
              <div className="text-[24px] font-black text-white">交易关闭</div>
              <div className="mt-1.5 text-[13px] text-white/85">{o.cancelReason ?? '订单已取消，未扣款'}</div>
            </>
          ) : unpaid ? (
            <>
              <div className="text-[24px] font-black text-white">待付款</div>
              <div className="mt-1.5 text-[13px] text-white/85">应付 ¥{fmtMoney(o.total)} · 支付后自动出票（30分钟内未付自动取消）</div>
              <button type="button" onClick={() => onPayOrder(o.id)} className="mt-2.5 rounded-full bg-white px-7 py-1.5 text-[14px] font-bold text-[#FF5000] active:opacity-80">
                去支付
              </button>
            </>
          ) : entered ? (
            <>
              <div className="text-[24px] font-black text-white">已入场</div>
              <div className="mt-1.5 text-[13px] text-white/85">{fmtEnteredAt} 已核销入场，祝观演愉快</div>
            </>
          ) : screened ? (
            <>
              <div className="text-[24px] font-black text-white">{t.kind === 'movie' ? '电影已放映' : '演出已放映'}</div>
              <div className="mt-2.5 flex items-center justify-center gap-3">
                <button type="button" onClick={doRate} className="rounded-full border border-white/80 px-5 py-1.5 text-[14px] font-medium text-white active:opacity-75">
                  评价影片
                </button>
                <button type="button" onClick={() => onToast('评价影院（演示）')} className="rounded-full border border-white/80 px-5 py-1.5 text-[14px] font-medium text-white active:opacity-75">
                  评价影院
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="text-[24px] font-black text-white">{countdown}</div>
              <div className="mt-1.5 text-[13px] text-white/85">是否购票成功以订单信息为准</div>
            </>
          )}
        </div>
        {/* 背景装饰（钻石切面感） */}
        <svg viewBox="0 0 430 160" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full opacity-25" aria-hidden="true">
          <path d="M0 0 L430 0 L430 90 L280 40 L120 110 L0 60 Z" fill="#fff" opacity="0.08" />
          <path d="M0 30 L180 130 L430 50 L430 160 L0 160 Z" fill="#fff" opacity="0.06" />
        </svg>
      </div>
      {/* 内容卡（整体上提覆盖头部下沿：负边距必须加在滚动容器本身，容器内首元素负边距会被 overflow 裁剪） */}
      <div className="min-h-0 flex-1 -mt-7 overflow-y-auto px-3 pb-8">
        {/* 影院/场馆卡 */}
        <button type="button" onClick={() => onToast('影院详情（演示）')} className="relative z-10 flex w-full items-center rounded-t-2xl bg-white px-4 py-3.5 text-left active:opacity-85">
          <span className="min-w-0 flex-1 truncate text-[17px] font-black text-black/90">{t.venue}</span>
          <ChevronRight className="h-4 w-4 shrink-0 text-black/30" />
          <span className="ml-3 flex shrink-0 items-center gap-3">
            <Phone className="h-[18px] w-[18px] text-black/75" strokeWidth={2} />
            <MapPin className="h-[18px] w-[18px] text-black/75" strokeWidth={2} />
          </span>
        </button>
        {/* 影片/演出信息卡 */}
        <div className="bg-white px-4 pb-4 pt-1">
          <div className="rounded-xl bg-white p-3 shadow-[0_2px_14px_rgba(0,0,0,0.08)]">
            <div className="flex gap-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[17px] font-bold text-black/90">{t.title}</div>
                <div className="mt-0.5 text-[14px] text-black/60">
                  {t.badge} {t.qty}张
                </div>
                <div className="mt-2.5 flex gap-4 text-[13px] leading-[22px] text-black/80">
                  <div>
                    <div className="text-black/45">{t.dateLabel}</div>
                    <div className="text-[15px] font-bold text-black/90">{t.start}~{t.end}</div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{t.hall}</div>
                    <div className="truncate">{t.seats.join('  ')}</div>
                  </div>
                </div>
              </div>
              {/* 渐变海报 */}
              <div className="relative h-[118px] w-[86px] shrink-0 overflow-hidden rounded-lg" style={{ background: `linear-gradient(160deg, ${t.posterC1} 0%, ${t.posterC2} 100%)` }}>
                <span className="absolute inset-x-1.5 top-2 line-clamp-3 text-[12.5px] font-black leading-[16px] text-white/95 drop-shadow-[0_1px_2px_rgba(0,0,0,0.4)]">{t.title}</span>
                <span className="absolute bottom-1.5 left-1.5 rounded-[3px] bg-black/45 px-1 py-px text-[9px] font-bold text-white">{t.kind === 'movie' ? '电影票' : t.kind === 'comedy' ? '演出票' : '演唱会'}</span>
              </div>
            </div>
          </div>
        </div>
        {/* 取电影票卡（tab + 二维码 + 取票号；待付款不展示取票码） */}
        {!unpaid ? (
        <div className="mt-2.5 rounded-2xl bg-white p-4">
          <div className="flex items-center">
            <button type="button" onClick={() => setQrTab('pick')} className={`relative pb-2 text-[17px] font-bold ${qrTab === 'pick' ? 'text-black/90' : 'text-black/35'}`}>
              {pickLabel}
              {qrTab === 'pick' ? <span className="absolute inset-x-1 bottom-0 h-[3px] rounded-full bg-[#FF3B5C]" /> : null}
            </button>
            <button type="button" onClick={() => setQrTab('scan')} className={`relative ml-6 pb-2 text-[17px] font-bold ${qrTab === 'scan' ? 'text-black/90' : 'text-black/35'}`}>
              扫码入场
              {qrTab === 'scan' ? <span className="absolute inset-x-1 bottom-0 h-[3px] rounded-full bg-[#FF3B5C]" /> : null}
            </button>
            {screened ? (
              <button type="button" onClick={() => onToast('如何取票（演示）')} className="ml-auto flex items-center pb-2 text-[14px] text-black/45 active:opacity-70">
                如何取票
                <ChevronRight className="h-4 w-4" />
              </button>
            ) : null}
          </div>
          <div className="relative mx-auto mt-4 w-fit">
            {/* 二维码（已放映/已退款灰化） */}
            <div className={`grid gap-[2px] rounded-lg p-2 ${qrDead ? 'opacity-25 grayscale' : ''}`} style={{ gridTemplateColumns: `repeat(21, 9px)` }}>
              {qrCells.map((row, r) =>
                row.map((v, c) => (
                  <span key={`${r}-${c}`} className={`h-[9px] w-[9px] ${v ? 'bg-black' : 'bg-white'}`} />
                ))
              )}
            </div>
            {/* 已放映/已退款/已入场 圆形红章 */}
            {qrDead ? (
              <span className={`absolute left-1/2 top-1/2 grid h-[92px] w-[92px] -translate-x-1/2 -translate-y-1/2 rotate-[-14deg] place-items-center rounded-full border-[3px] ${refunded ? 'border-[#E4237A] text-[#E4237A]' : 'border-[#E42323] text-[#E42323]'}`}>
                <span className="text-[19px] font-black tracking-widest">{qrStamp}</span>
                <span className="absolute inset-[6px] rounded-full border border-current opacity-70" />
              </span>
            ) : null}
          </div>
          <div className={`mt-2 text-center text-[13px] ${qrDead ? 'text-black/35' : 'text-black/55'}`}>{t.qty}张{t.kind === 'movie' ? '电影票' : '演出票'}</div>
          <div className="mx-auto mt-3 w-fit rounded-xl border border-black/[0.08] px-4 py-2.5">
            <span className={`text-[14px] ${qrDead ? 'text-black/35' : 'text-black/55'}`}>取票号：</span>
            <span className={`text-[17px] font-black tracking-wide ${qrDead ? 'text-black/30 line-through' : 'text-black/90'}`}>{t.ticketNo}</span>
          </div>
          {/* 扫码入场（Task 2-b）：点击 = 核销 = 确认收货；核销后变已入场禁用态；已退款/已关闭不显示 */}
          {qrTab === 'scan' && !refunded && !closed ? (
            o.status === 'shipped' && !entered ? (
              <button
                type="button"
                data-testid="tb-ticket-scan-enter"
                onClick={doScanEnter}
                className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#FF7A21] to-[#FF5000] text-[16px] font-bold text-white shadow-[0_6px_16px_rgba(255,80,0,0.28)] active:opacity-85"
              >
                <ScanLine className="h-5 w-5" strokeWidth={2.2} />
                扫码入场
              </button>
            ) : entered ? (
              <div className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[#E8F7F0] text-[15px] font-semibold text-[#0B8F5C]">
                <Check className="h-4.5 w-4.5" strokeWidth={2.6} />
                已入场
              </div>
            ) : (
              <div className="mt-4 flex h-12 w-full items-center justify-center rounded-full bg-black/[0.05] text-[15px] text-black/35">已散场</div>
            )
          ) : null}
        </div>
        ) : null}
        {/* 已放映：本单权益 + 周边推广 */}
        {screened ? (
          <>
            <div className="mt-2.5 rounded-2xl bg-white p-4">
              <div className="text-[16px] font-bold text-black/90">本单权益</div>
              <div className="mt-3 grid grid-cols-2 gap-2.5">
                <button type="button" onClick={() => onToast('66会员积分映后发放（演示）')} className="flex items-center justify-between rounded-xl bg-[#F6F7F8] px-3 py-3 text-left active:opacity-80">
                  <span>
                    <span className="block text-[14px] font-bold text-black/85">66会员积分</span>
                    <span className="mt-0.5 flex items-center text-[12px] text-black/40">
                      映后发放
                      <ChevronRight className="h-3 w-3" />
                    </span>
                  </span>
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#2B2B2B] text-[11px] font-black text-[#FFD100]">66</span>
                </button>
                <button type="button" onClick={() => onToast('电子纪念票（演示）')} className="flex items-center justify-between rounded-xl bg-[#F6F7F8] px-3 py-3 text-left active:opacity-80">
                  <span>
                    <span className="block text-[14px] font-bold text-black/85">电子纪念票</span>
                    <span className="mt-0.5 flex items-center text-[12px] text-black/40">
                      去看看
                      <ChevronRight className="h-3 w-3" />
                    </span>
                  </span>
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#2B2B2B]">
                    <Ticket className="h-4.5 w-4.5 text-[#FFD100]" strokeWidth={2} />
                  </span>
                </button>
              </div>
            </div>
            <button type="button" onClick={onOpenMerch} className="mt-2.5 flex w-full items-center rounded-2xl bg-white p-3.5 text-left active:opacity-85">
              <span className="relative h-[52px] w-[52px] shrink-0 overflow-hidden rounded-xl" style={{ background: `linear-gradient(160deg, ${t.posterC1}, ${t.posterC2})` }}>
                <span className="absolute inset-x-1 top-2 line-clamp-2 text-[9.5px] font-black leading-[12px] text-white">{t.title}</span>
              </span>
              <span className="ml-3 min-w-0 flex-1">
                <span className="block truncate text-[15px] font-bold text-black/90">《{t.title}》官方周边</span>
                <span className="mt-0.5 block text-[12px] text-black/40">热卖中</span>
              </span>
              <span className="mr-3 rounded-[3px] border border-[#FF3676]/50 px-1 py-px text-[10.5px] font-bold text-[#FF3676]">近期热卖</span>
              <span className="shrink-0 rounded-full border-[1.5px] border-[#FF3676] px-3.5 py-1.5 text-[13.5px] font-bold text-[#FF3676]">去看看</span>
            </button>
          </>
        ) : null}
        {/* 退改签卡（待付款不展示） */}
        {!unpaid ? (
        <div className="mt-2.5 rounded-2xl bg-white p-4">
          <div className="text-[16px] font-bold text-black/90">退改签</div>
          {refunded ? (
            <button type="button" onClick={() => onToast('退款明细（演示）')} className="mt-3 flex w-full items-center rounded-xl bg-[#F6F7F8] px-3 py-3 text-left active:opacity-80">
              <span className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full bg-[#12B76A]">
                <Check className="h-3 w-3 text-white" strokeWidth={3} />
              </span>
              <span className="ml-2.5 flex-1">
                <span className="block text-[14.5px] font-bold text-black/85">已退款</span>
                <span className="mt-0.5 block text-[12.5px] text-black/45">
                  退款金额<span className="font-bold text-[#FF3B5C]">{fmtMoney(t.refunded!.amount)}元</span>
                </span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-black/25" />
            </button>
          ) : closed ? (
            <div className="mt-3 flex w-full items-center rounded-xl bg-[#F6F7F8] px-3 py-3">
              <span className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full bg-black/25">
                <X className="h-3 w-3 text-white" strokeWidth={3} />
              </span>
              <span className="ml-2.5 min-w-0 flex-1">
                <span className="block text-[14.5px] font-bold text-black/85">交易关闭</span>
                <span className="mt-0.5 block text-[12.5px] text-black/45">{o.cancelReason ?? '订单已取消，未扣款'}</span>
              </span>
            </div>
          ) : (
            <>
              <div className="mt-3 flex w-full items-center rounded-xl bg-[#F6F7F8] px-3 py-3">
                <span className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full bg-[#12B76A]">
                  <Check className="h-3 w-3 text-white" strokeWidth={3} />
                </span>
                <span className="ml-2.5 min-w-0 flex-1">
                  <span className="block text-[14.5px] font-bold text-black/85">支持改签</span>
                  <span className="mt-0.5 block text-[12.5px] text-black/45">
                    未取票开场前1小时可改签，<span className="font-bold text-[#FF3B5C]">改签费5.0元/张</span>
                  </span>
                </span>
                <button type="button" onClick={() => onToast('已提交改签申请（改签费¥5.0/张，演示）')} className="shrink-0 rounded-full border-[1.5px] border-[#FF3B5C] px-4 py-1.5 text-[13.5px] font-bold text-[#FF3B5C] active:opacity-75">
                  改签
                </button>
              </div>
              <div className="mt-2 flex w-full items-center rounded-xl bg-[#F6F7F8] px-3 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block text-[14.5px] font-bold text-black/85">申请退票</span>
                  <span className="mt-0.5 block text-[12.5px] text-black/45">开场前可退，退款原路退回</span>
                </span>
                <button type="button" onClick={() => setRefundOpen(true)} className="shrink-0 rounded-full border border-black/12 px-4 py-1.5 text-[13.5px] font-medium text-black/65 active:opacity-75">
                  退款
                </button>
              </div>
            </>
          )}
        </div>
        ) : null}
      </div>
      {/* 退票确认弹层 */}
      {refundOpen ? (
        <div className="absolute inset-0 z-40 grid place-items-center bg-black/45 px-8" onClick={() => (refunding ? null : setRefundOpen(false))}>
          <div className="w-full rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <div className="text-center text-[17px] font-bold text-black/90">确认退票</div>
            <div className="mt-2 text-center text-[13.5px] leading-6 text-black/55">
              《{t.title}》{t.qty}张，实付 ¥{fmtMoney(o.total)}
              <br />
              退款将原路退回，确认退票吗？
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2.5">
              <button type="button" onClick={() => setRefundOpen(false)} className="h-11 rounded-full border border-black/12 text-[15px] text-black/65 active:opacity-75">
                再想想
              </button>
              <button type="button" onClick={doRefund} disabled={refunding} className="h-11 rounded-full bg-gradient-to-r from-[#FF3B5C] to-[#E42323] text-[15px] font-bold text-white active:opacity-85 disabled:opacity-60">
                {refunding ? '退款中…' : '确认退票'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ============================== 飞猪旅行 ==============================

/** 飞猪旅行（截图8/9：黄——酒店搜索首页→酒店列表；内部二级导航） */
export function FliggyPage({ uid, onBack, onToast }: { uid: string; onBack: () => void; onToast: (m: string) => void }) {
  const [view, setView] = useState<'home' | 'list'>('home');
  const [tab, setTab] = useState('国内');
  // 双向刷新（Task 40/41/45，列表页）：顶部下拉 → AI 新酒店前插（旧内容原位保留）；
  // 底部上拉 → AI 新酒店追加到列表末尾（上方内容不变、不跳屏）；
  // 全部持久化 —— 刷新页面/重开 App 后原样恢复（useTbChannelFeed）
  const { state: feedState, refresh } = useTbChannelFeed(
    uid,
    'fliggy',
    3,
    onToast,
    '已刷新，最新酒店已更新到顶部',
    '已加载新的酒店在下方，上方内容不变',
    TB_FLIGGY.hotels.map((h) => h.name),
  );
  const pull = useTbPullRefresh((dir) => refresh(4, dir));
  type FliggyHotel = (typeof TB_FLIGGY.hotels)[number] & { _k: string; _v: number };
  const aiHotels = useMemo<FliggyHotel[]>(() => {
    return feedState.aiTops.flatMap((t) => {
      const p = productById(t.pid);
      return p ? [{ ...aiToHotel(p), _k: t.k, _v: t.v }] : [];
    });
  }, [feedState.aiTops]);
  const freshHotels = useMemo<FliggyHotel[]>(() => {
    return feedState.batches.flatMap((b) =>
      Array.from({ length: 2 }, (_, i) => {
        const src = TB_FLIGGY.hotels[(b + i) % TB_FLIGGY.hotels.length];
        return { ...src, _k: `r${b}-${i}`, _v: (b * 2 + i) % 4 };
      }),
    );
  }, [feedState.batches]);
  // 底部追加（Task 45）：AI 追加酒店 + 本地兜底批次，渲染在列表最后（上方内容原位不变）
  const aiTailHotels = useMemo<FliggyHotel[]>(() => {
    return feedState.aiTails.flatMap((t) => {
      const p = productById(t.pid);
      return p ? [{ ...aiToHotel(p), _k: t.k, _v: t.v }] : [];
    });
  }, [feedState.aiTails]);
  const tailBatchHotels = useMemo<FliggyHotel[]>(() => {
    return feedState.tailBatches.flatMap((b) =>
      Array.from({ length: 2 }, (_, i) => {
        const src = TB_FLIGGY.hotels[(b + i + 3) % TB_FLIGGY.hotels.length];
        return { ...src, _k: `t${b}-${i}`, _v: (b * 2 + i) % 4 };
      }),
    );
  }, [feedState.tailBatches]);
  const hotelCards = useMemo<FliggyHotel[]>(
    () => [
      ...aiHotels,
      ...freshHotels,
      ...TB_FLIGGY.hotels.slice(0, 2).map((h) => ({ ...h, _k: h.name, _v: -1 })),
      ...aiTailHotels,
      ...tailBatchHotels,
    ],
    [aiHotels, freshHotels, aiTailHotels, tailBatchHotels],
  );
  const goSearch = () => {
    setView('list');
    setTab('猜你喜欢');
  };
  const icons = [
    { icon: <BedDouble className="h-[22px] w-[22px] text-white" strokeWidth={1.9} />, bg: 'from-[#9F7BFF] to-[#7C5CFF]', label: '酒店', badge: '立减50起' },
    { icon: <Plane className="h-[20px] w-[20px] text-white" strokeWidth={1.9} />, bg: 'from-[#5AA9FF] to-[#2E7BE8]', label: '机票', badge: '' },
    { icon: <TrainFront className="h-[21px] w-[21px] text-white" strokeWidth={1.9} />, bg: 'from-[#3BC46A] to-[#1E9E4E]', label: '火车/汽车', badge: '' },
    { icon: <Ticket className="h-[20px] w-[20px] text-white" strokeWidth={1.9} />, bg: 'from-[#FF6A5A] to-[#F03E3E]', label: '门票/跟团', badge: '' },
    { icon: <CarTaxiFront className="h-[21px] w-[21px] text-white" strokeWidth={1.9} />, bg: 'from-[#FFA23A] to-[#FF7A00]', label: '租车/打车', badge: '' },
    { icon: <Stamp className="h-[20px] w-[20px] text-white" strokeWidth={1.9} />, bg: 'from-[#FFC93A] to-[#E8A000]', label: '签证/通讯', badge: '' },
  ];
  if (view === 'list') {
    return (
      <div className="flex h-full flex-col bg-[#F4F5F9]">
        {/* 顶部频道 tab（酒店紫色胶囊选中）+ 返回 */}
        <div className="shrink-0 bg-white px-2 pb-2.5 pt-[56px]">
          <div className="flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <button type="button" aria-label="返回" onClick={() => setView('home')} className="grid h-8 w-8 shrink-0 place-items-center rounded-full active:opacity-60">
              <ArrowLeft className="h-[20px] w-[20px] text-black/80" strokeWidth={2.2} />
            </button>
            {icons.map((it) => (
              <button
                key={it.label}
                type="button"
                onClick={() => onToast(`${it.label}频道（演示）`)}
                className={`shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 text-[14px] ${it.label === '酒店' ? 'bg-[#7C5CFF] font-semibold text-white' : 'text-black/70'}`}
              >
                {it.label}
              </button>
            ))}
          </div>
        </div>
        <div className="relative min-h-0 flex-1">
          <div ref={pull.scrollRef} {...pull.bind} className="h-full overflow-y-auto px-2 pb-8">
          {/* 三卡横排：机票超低价 / 特惠酒店 / 爆款榜单 */}
          <div className="grid grid-cols-[1fr_1.1fr_0.95fr] gap-2">
            <button type="button" onClick={() => onToast('机票超低价（演示）')} className="rounded-xl bg-white p-2.5 text-left active:opacity-80">
              <div className="flex items-center gap-1">
                <span className="grid h-[18px] w-[18px] place-items-center rounded-full bg-[#2E7BE8]">
                  <Plane className="h-[11px] w-[11px] text-white" />
                </span>
                <span className="truncate text-[14px] font-black text-black/90">机票超低价</span>
              </div>
              <div className="mt-2 flex flex-col gap-1.5">
                {TB_FLIGGY.flights.map((f) => (
                  <div key={f.to}>
                    <div className="text-[13.5px] font-bold text-black/85">
                      {f.from} - {f.to}
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-[15px] font-black text-[#FF3B30]">
                        <span className="text-[10px]">¥</span>
                        {f.price}
                        <span className="text-[10px] font-medium">起</span>
                      </span>
                      <span className="rounded-[3px] bg-[#FFF3C2] px-1 py-px text-[10px] font-bold text-[#B8860B]">{f.off}</span>
                    </div>
                  </div>
                ))}
              </div>
            </button>
            <button type="button" onClick={() => onToast('特惠酒店（演示）')} className="rounded-xl bg-white p-2.5 text-left active:opacity-80">
              <div className="flex items-center gap-1">
                <span className="grid h-[18px] w-[18px] place-items-center rounded-[5px] bg-[#7C5CFF]">
                  <BedDouble className="h-[11px] w-[11px] text-white" />
                </span>
                <span className="truncate text-[14px] font-black text-black/90">特惠酒店</span>
                <ChevronRight className="ml-auto h-3.5 w-3.5 text-black/25" />
              </div>
              <TbImg src={tbImg('lamp', 320, 220, 2)} alt="海友酒店" className="mt-2 h-[92px] w-full rounded-lg" />
              <div className="mt-1.5 line-clamp-2 text-[12.5px] font-medium leading-[16px] text-black/80">{TB_FLIGGY.hotels[2].name}</div>
              <div className="mt-1 text-[15px] font-black text-[#FF3B30]">
                <span className="text-[10px]">¥</span>
                {TB_FLIGGY.hotels[2].price}
                <span className="text-[10px] font-medium">起</span>
              </div>
            </button>
            <button type="button" onClick={() => onToast('爆款榜单（演示）')} className="rounded-xl bg-white p-2.5 text-left active:opacity-80">
              <div className="flex items-center gap-1">
                <Flame className="h-[15px] w-[15px] fill-[#FF3B30] text-[#FF3B30]" />
                <span className="truncate text-[14px] font-black text-black/90">爆款榜单</span>
              </div>
              <div className="relative mt-2">
                <TbImg src={tbImg('temple', 320, 220, 1)} alt={TB_FLIGGY.deal.name} className="h-[92px] w-full rounded-lg" />
                <span className="absolute left-1 top-1 rounded-md bg-[#FFD100] px-1 py-px text-[9.5px] font-black text-black/80">TOP 1</span>
              </div>
              <div className="mt-1.5 truncate text-[12.5px] font-bold text-black/85">{TB_FLIGGY.deal.name}</div>
              <div className="mt-0.5 truncate text-[11px] text-black/45">{TB_FLIGGY.deal.sub}</div>
              <div className="mt-1 text-[15px] font-black text-[#FF3B30]">
                <span className="text-[10px]">¥</span>
                {TB_FLIGGY.deal.price}
                <span className="text-[10px] font-medium">起</span>
              </div>
            </button>
          </div>
          {/* 猜你喜欢 tab（吸顶：滚动时固定，酒店瀑布跟随滚动） */}
          <div className="sticky top-0 z-20 -mx-2 mt-3 flex items-center gap-2 bg-[#F4F5F9] px-2 py-2">
            {['猜你喜欢', '濮阳周边', '机票次卡'].map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`shrink-0 whitespace-nowrap rounded-full px-4 py-1.5 text-[14px] ${tab === t ? 'bg-gradient-to-r from-[#FFE63E] to-[#FFD100] font-bold text-black/90' : 'bg-white text-black/65'}`}
              >
                {t}
              </button>
            ))}
          </div>
          {/* 酒店瀑布 */}
          <div className="mt-2.5 grid grid-cols-2 gap-2 pb-2">
            <button type="button" onClick={() => onToast('飞猪闪购酒店（演示）')} className="relative flex h-[196px] flex-col rounded-xl bg-gradient-to-b from-[#D97A2B] to-[#8C3D12] p-3 text-left active:opacity-90">
              <span className="flex items-center gap-1">
                <span className="grid h-[16px] w-[16px] place-items-center rounded-full bg-[#FFD100] text-[9px] font-black text-[#8a6300]">飞</span>
                <span className="text-[11px] font-medium text-white/90">飞猪旅行</span>
              </span>
              <span className="mt-2 text-[20px] font-black italic leading-none text-white">飞猪闪购酒店</span>
              <span className="mt-1.5 text-[11px] text-white/85">金秋出游 折上再享8元起立减 &gt;</span>
              <span className="mt-auto grid h-[52px] w-[52px] place-items-center self-end rounded-full bg-[#FFD100] shadow-md">
                <svg width="34" height="34" viewBox="0 0 48 48" aria-hidden="true">
                  <circle cx="24" cy="26" r="15" fill="#FFC300" />
                  <circle cx="19" cy="23" r="2.2" fill="#3b2b00" />
                  <circle cx="29" cy="23" r="2.2" fill="#3b2b00" />
                  <ellipse cx="24" cy="30" rx="5.4" ry="4.2" fill="#FFB800" />
                  <path d="M12 18c-1.6-3.4-.8-5.6.8-6.4 1.8-.8 4 .8 5.2 3A14 14 0 0 0 12 18Zm24 0c1.6-3.4.8-5.6-.8-6.4-1.8-.8-4 .8-5.2 3A14 14 0 0 1 36 18Z" fill="#FFC300" />
                </svg>
              </span>
            </button>
            {hotelCards.map((h, i) => (
              <button key={h._k} type="button" onClick={() => onToast(`${h.name}（演示）`)} className="overflow-hidden rounded-xl bg-white text-left active:opacity-80">
                <TbImg src={tbImg(h.tag, 320, 300, h._v >= 0 ? h._v : i - freshHotels.length)} alt={h.name} className="h-[150px] w-full" />
                <div className="p-2">
                  <div className="line-clamp-2 text-[13.5px] font-bold leading-[18px] text-black/90">{h.name}</div>
                  <div className="mt-1 flex items-baseline gap-1">
                    <span className="text-[17px] font-black text-[#FF3B30]">
                      <span className="text-[10px]">¥</span>
                      {h.price}
                      <span className="text-[10px] font-medium">起</span>
                    </span>
                    <span className="text-[10.5px] text-black/40">{h.reviews}</span>
                  </div>
                </div>
              </button>
            ))}
            <button type="button" onClick={() => onToast('海友濮阳体育场京开大道酒店（演示）')} className="overflow-hidden rounded-xl bg-white text-left active:opacity-80">
              <TbImg src={tbImg('bedding', 320, 300, 5)} alt="海友酒店" className="h-[150px] w-full" />
              <div className="p-2">
                <div className="line-clamp-2 text-[13.5px] font-bold leading-[18px] text-black/90">{TB_FLIGGY.hotels[2].name}</div>
                <div className="mt-1 flex items-baseline gap-1">
                  <span className="text-[17px] font-black text-[#FF3B30]">
                    <span className="text-[10px]">¥</span>
                    {TB_FLIGGY.hotels[2].price}
                    <span className="text-[10px] font-medium">起</span>
                  </span>
                  <span className="text-[10.5px] text-black/40">{TB_FLIGGY.hotels[2].reviews}</span>
                </div>
              </div>
            </button>
          </div>
          </div>
          <TbPullIndicator h={pull} />
        </div>
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col bg-gradient-to-b from-[#FFDD30] via-[#FFEC6E] to-[#F4F5F9]">
      {/* 顶栏 */}
      <div className="flex shrink-0 items-center gap-2 px-3 pt-[56px]">
        <button type="button" aria-label="返回" onClick={onBack} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/60 active:opacity-70">
          <ArrowLeft className="h-[20px] w-[20px] text-black/85" strokeWidth={2.4} />
        </button>
        <span className="text-[22px] font-black italic leading-none tracking-tight text-black/90">飞猪旅行</span>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" aria-label="更多" onClick={() => onToast('更多（演示）')} className="grid h-9 w-11 place-items-center rounded-full bg-white/60 active:opacity-70">
            <MoreHorizontal className="h-[19px] w-[19px] text-black/80" />
          </button>
          <button type="button" aria-label="拍摄" onClick={() => onToast('拍摄（演示）')} className="grid h-9 w-9 place-items-center rounded-full bg-white/60 active:opacity-70">
            <span className="grid h-[16px] w-[16px] place-items-center rounded-full border-2 border-black/75">
              <span className="h-[6px] w-[6px] rounded-full bg-black/75" />
            </span>
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* 搜索框 */}
        <div className="mt-2.5 px-3">
          <div className="flex h-[46px] items-center gap-2 rounded-full bg-white pl-4 pr-1.5">
            <Search className="h-[18px] w-[18px] shrink-0 text-black/35" />
            <span className="min-w-0 flex-1 truncate text-[14.5px] text-black/35">濮阳东北庄野生动物园</span>
            <button type="button" onClick={goSearch} className="h-[36px] shrink-0 rounded-full bg-gradient-to-r from-[#7C5CFF] to-[#5B3DE8] px-5 text-[14.5px] font-semibold text-white active:opacity-85">
              搜索
            </button>
          </div>
        </div>
        {/* 快捷 chips */}
        <div className="mt-2.5 flex gap-2 overflow-x-auto px-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {TB_FLIGGY.chips.map((c) => (
            <button key={c} type="button" onClick={() => onToast(`${c}（演示）`)} className="shrink-0 whitespace-nowrap rounded-full bg-white/55 px-3.5 py-1.5 text-[13.5px] text-black/75 active:opacity-75">
              {c}
            </button>
          ))}
        </div>
        {/* 六宫格图标 */}
        <div className="mt-3 grid grid-cols-6 px-2">
          {icons.map((it) => (
            <button key={it.label} type="button" onClick={() => onToast(`${it.label}（演示）`)} className="relative flex flex-col items-center gap-1 active:opacity-75">
              <span className={`relative grid h-[46px] w-[46px] place-items-center rounded-full bg-gradient-to-b ${it.bg}`}>
                {it.icon}
                {it.badge ? <span className="absolute -left-2 -top-2 whitespace-nowrap rounded-full bg-[#FF3B30] px-1.5 py-px text-[9px] font-bold text-white">{it.badge}</span> : null}
              </span>
              <span className="whitespace-nowrap text-[11.5px] text-black/80">{it.label}</span>
            </button>
          ))}
        </div>
        {/* 酒店搜索卡 */}
        <div className="mx-2 mt-3 rounded-2xl bg-white p-3.5">
          <div className="flex items-center gap-4 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {['国内', '国际', '酒店套餐', '民宿', '短租房'].map((t) => (
              <button key={t} type="button" onClick={() => setTab(t)} className={`relative shrink-0 whitespace-nowrap pb-1.5 text-[17px] ${tab === t ? 'font-bold text-black/90' : 'text-black/50'}`}>
                {t}
                {tab === t ? <span className="absolute bottom-0 left-1/2 h-[3px] w-[22px] -translate-x-1/2 rounded-full bg-black/85" /> : null}
              </button>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <span className="text-[19px] font-black text-black/90">我的附近</span>
            <ChevronDown className="h-4 w-4 text-black/60" />
            <span className="ml-1 flex min-w-0 flex-1 items-center gap-1.5">
              <Search className="h-[17px] w-[17px] shrink-0 text-black/30" />
              <span className="min-w-0 flex-1 truncate text-[15px] text-black/30">位置/品牌/酒店</span>
              <ChevronRight className="h-4 w-4 shrink-0 text-black/25" />
            </span>
            <Crosshair className="h-[19px] w-[19px] shrink-0 text-[#7C5CFF]" strokeWidth={2} />
          </div>
          <div className="mt-3 flex items-center gap-1.5 rounded-lg bg-[#EEEBFF] px-3 py-2">
            <MapPin className="h-4 w-4 shrink-0 fill-[#7C5CFF] text-[#7C5CFF]" />
            <span className="text-[13.5px] font-medium text-[#6A4DE8]">已定位到</span>
            <span className="min-w-0 flex-1 truncate text-[13.5px] text-black/70">濮阳县,老街村附近</span>
          </div>
          <div className="flex items-center justify-between border-b border-black/[0.06] py-4">
            <span className="flex shrink-0 items-baseline gap-1.5 whitespace-nowrap">
              <span className="whitespace-nowrap text-[24px] font-black leading-none text-black/90">10月9日</span>
              <span className="whitespace-nowrap text-[13px] text-black/40">今天</span>
            </span>
            <span className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-black/15 px-2.5 py-0.5 text-[12.5px] text-black/75">
              1晚
            </span>
            <span className="flex shrink-0 items-baseline gap-1.5 whitespace-nowrap">
              <span className="whitespace-nowrap text-[24px] font-black leading-none text-black/90">10月10日</span>
              <span className="whitespace-nowrap text-[13px] text-black/40">明天</span>
            </span>
            <ChevronRight className="h-4.5 w-4.5 shrink-0 text-black/30" />
          </div>
          <div className="flex items-center border-b border-black/[0.06] py-3.5">
            <span className="shrink-0 whitespace-nowrap text-[15.5px] font-bold text-black/90">1间房 2成人 0儿童</span>
            <ChevronDown className="ml-1 h-4 w-4 shrink-0 text-black/50" />
            <span className="ml-7 shrink-0 whitespace-nowrap text-[15px] text-black/30">价格/星级</span>
          </div>
          <div className="mt-3 flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {['首住特惠', '张挥公园', '濮阳县人民医院', '东环小区', '咸城遗址'].map((c, i) => (
              <button
                key={c}
                type="button"
                onClick={() => onToast(`${c}附近酒店（演示）`)}
                className={`shrink-0 whitespace-nowrap rounded-md px-2.5 py-1 text-[12.5px] ${i === 0 ? 'border border-[#FF3B30]/40 text-[#FF3B30]' : 'bg-black/[0.045] text-black/65'}`}
              >
                {c}
              </button>
            ))}
          </div>
          <div className="relative mt-5">
            <span className="absolute -top-3 right-2 rotate-[2deg] rounded-full bg-gradient-to-r from-[#FF5A3C] to-[#FF2D00] px-2.5 py-1 text-[11.5px] font-bold text-white shadow">旅游卡立省50元起</span>
            <button type="button" onClick={goSearch} className="h-[54px] w-full rounded-full bg-gradient-to-r from-[#FFE63E] to-[#FFC91E] text-[19px] font-black text-black/90 shadow-[0_6px_16px_rgba(255,180,0,0.35)] active:opacity-90">
              搜索酒店
            </button>
          </div>
          <div className="flex items-center justify-center gap-1 py-3.5 text-[12.5px] text-black/45">
            7x24小时服务 · 品牌直营 双重积分 · 信用住 先住后付
            <ChevronRight className="h-3.5 w-3.5" />
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================== 淘宝账单（我的消费明细） ==============================

/** 淘宝账单（截图10：真实订单数据——省钱统计/10月账单/2026年累计账单/分类） */
export function BillPage({ session, uid, onBack, onToast, onOpenOrder }: { session: TbSession; uid: string; onBack: () => void; onToast: (m: string) => void; onOpenOrder: (id: string) => void }) {
  const [, setTick] = useState(0);
  // 双向刷新（Task 40）：重读订单推进状态，账单数据原位更新（订单不消失、不跳顶）
  const pull = useTbPullRefresh(() => {
    tbTickOrders(uid);
    setTick((n) => n + 1);
    onToast('账单已更新');
  });
  const orders = tbLoadOrders(uid);
  const paid = orders.filter((o) => o.status !== 'cancelled' && o.paidAt);
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const inMonth = (t: number) => {
    const d = new Date(t);
    return d.getFullYear() === y && d.getMonth() === m;
  };
  const monthPaid = paid.filter((o) => inMonth(o.createdAt));
  const monthSum = Math.round(monthPaid.reduce((n, o) => n + o.total, 0) * 100) / 100;
  const yearPaid = paid.filter((o) => new Date(o.createdAt).getFullYear() === y);
  const yearSum = Math.round(yearPaid.reduce((n, o) => n + o.total, 0) * 100) / 100;
  const couponSave = Math.round(paid.reduce((n, o) => n + (o.couponAmount ?? 0), 0) * 100) / 100;
  const totalSave = Math.round(paid.reduce((n, o) => n + o.discount, 0) * 100) / 100;
  const otherSave = Math.max(0, Math.round((totalSave - couponSave) * 100) / 100);
  return (
    <div className="relative flex h-full flex-col bg-[#F2F3F7]">
      {/* 顶栏 */}
      <div className="flex shrink-0 items-center gap-2 px-3 pb-1 pt-[56px]">
        <button type="button" aria-label="返回" onClick={onBack} className="grid h-9 w-9 shrink-0 place-items-center rounded-full active:opacity-60">
          <ArrowLeft className="h-[22px] w-[22px] text-black/85" strokeWidth={2.2} />
        </button>
        <span className="text-[19px] font-black text-black/90">淘宝账单</span>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" aria-label="账户" onClick={() => onToast('切换账单账号（演示）')} className="grid h-9 w-10 place-items-center rounded-lg bg-black/[0.06] active:opacity-70">
            <User className="h-[18px] w-[18px] text-black/65" />
          </button>
          <button type="button" aria-label="更多" onClick={() => onToast('更多（演示）')} className="grid h-9 w-[62px] place-items-center rounded-lg bg-black/[0.06]">
            <MoreHorizontal className="h-[18px] w-[18px] text-black/65" />
          </button>
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        <div ref={pull.scrollRef} {...pull.bind} className="h-full overflow-y-auto pb-10">
        {/* 头像与省钱 */}
        <div className="flex items-center gap-3 px-4 pt-2">
          <span className="grid h-[58px] w-[58px] shrink-0 place-items-center overflow-hidden rounded-full bg-[#D8DCE3]">
            {session.avatar ? <img src={session.avatar} alt={session.name} className="h-full w-full object-cover" draggable={false} /> : <User className="h-7 w-7 text-white" />}
          </span>
          <div className="min-w-0">
            <div className="truncate text-[19px] font-bold text-black/90">{session.name}</div>
            <div className="mt-0.5 flex items-center gap-1">
              <span className="text-[16.5px] font-bold text-black/90">淘宝已为你省钱</span>
              <span className="text-[25px] font-black leading-none text-[#FF5000]">
                {fmtMoney(totalSave)}
                <span className="text-[14px]">元</span>
              </span>
              <Info className="h-3.5 w-3.5 shrink-0 text-black/30" />
            </div>
          </div>
        </div>
        {/* 三项省钱统计 */}
        <div className="mt-3 grid grid-cols-3 px-4">
          {[
            { label: '淘金币', value: 0, info: false },
            { label: '红包/券', value: couponSave, info: false },
            { label: '其他优惠', value: otherSave, info: true },
          ].map((s) => (
            <button key={s.label} type="button" onClick={() => onToast(`${s.label}：共省${fmtMoney(s.value)}元`)} className="flex flex-col items-start py-0.5 text-left active:opacity-70">
              <span className="flex items-center gap-0.5 text-[13.5px] text-black/55">
                {s.label}
                {s.info ? <Info className="h-3 w-3 text-black/25" /> : <ChevronRight className="h-3.5 w-3.5 text-black/30" />}
              </span>
              <span className="mt-0.5 text-[16px] font-black leading-none text-black/90">
                省{fmtMoney(s.value)}<span className="text-[12px] font-bold">元</span>
              </span>
            </button>
          ))}
        </div>
        {/* 10月账单 */}
        <div className="mx-2 mt-3 rounded-2xl bg-white p-4">
          <div className="flex items-center">
            <button type="button" onClick={() => onToast('切换账单月份（演示）')} className="flex items-center gap-1 active:opacity-70">
              <span className="text-[20px] font-black text-black/90">{m + 1}月账单</span>
              <ChevronDown className="h-4.5 w-4.5 text-black/50" />
            </button>
            <button type="button" onClick={() => onToast('已订阅月度账单，每月1日推送')} className="ml-auto flex items-center gap-1 rounded-lg border-[1.5px] border-[#FF5000] px-2.5 py-1.5 text-[13px] font-semibold text-[#FF5000] active:opacity-75">
              <Bell className="h-3.5 w-3.5" />
              订阅账单
            </button>
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-[30px] font-black leading-none text-black/90">
              {fmtMoney(monthSum)}
              <span className="text-[15px]">元</span>
            </span>
            <span className="text-[13.5px] text-black/45">共{monthPaid.length}单</span>
            <Info className="h-3.5 w-3.5 shrink-0 text-black/25" />
          </div>
          {/* 省钱机会 */}
          <div className="mt-3 flex items-center gap-2.5 rounded-xl bg-[#FFF3E8] p-3">
            <Flame className="h-[18px] w-[18px] shrink-0 fill-[#FF6A1E] text-[#FF6A1E]" />
            <div className="min-w-0 flex-1">
              <div className="text-[14.5px] font-bold text-black/90">你的省钱机会</div>
              <div className="mt-0.5 text-[12.5px] leading-[17px] text-black/60">
                你有10淘金币奖励未领取，累计可抵
                <span className="mx-0.5 text-[17px] font-black text-[#FF5000]">0.1</span>元，快去攒金币吧~
              </div>
            </div>
            <button type="button" onClick={() => onToast('快去首页「红包签到」领淘金币吧~')} className="h-[38px] shrink-0 rounded-lg bg-[#FF5000] px-3.5 text-[13.5px] font-semibold text-white active:opacity-85">
              去攒金币
            </button>
          </div>
          {/* 本月消费列表 / 空态 */}
          {monthPaid.length === 0 ? (
            <div className="flex flex-col items-center py-9">
              <span className="relative">
                <ShoppingCart className="h-[62px] w-[62px] text-[#E3E6EC]" strokeWidth={1.4} />
                <span className="absolute -right-2 top-0 grid h-6 w-6 place-items-center rounded-full bg-[#FF8A5C] text-[11px] font-bold text-white">空</span>
              </span>
              <span className="mt-3 text-[14px] text-black/35">本月暂无消费哦~</span>
            </div>
          ) : (
            <div className="mt-2 flex flex-col gap-2">
              {monthPaid.slice(0, 3).map((o) => (
                <button key={o.id} type="button" onClick={() => onOpenOrder(o.id)} className="flex items-center gap-2.5 rounded-xl bg-black/[0.025] p-2 text-left active:opacity-75">
                  <TbImg src={o.items[0]?.img} alt={o.items[0]?.title} cap={o.items[0]?.title} className="h-11 w-11 shrink-0 rounded-lg object-cover" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-medium text-black/80">{o.items[0]?.title}</span>
                    <span className="mt-0.5 block text-[11.5px] text-black/40">
                      {new Date(o.createdAt).getMonth() + 1}月{new Date(o.createdAt).getDate()}日 · {o.shopName}
                    </span>
                  </span>
                  <span className="shrink-0 text-[14.5px] font-bold text-black/85">¥{fmtMoney(o.total)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {/* 年累计账单 */}
        <div className="mx-2 mt-3 rounded-2xl bg-white p-4">
          <div className="flex items-center">
            <button type="button" onClick={() => onToast('切换年份（演示）')} className="flex items-center gap-1 active:opacity-70">
              <span className="text-[20px] font-black text-black/90">{y}年累计账单</span>
              <ChevronDown className="h-4.5 w-4.5 text-black/50" />
            </button>
          </div>
          <div className="mt-2 flex items-end justify-between">
            <div className="flex items-baseline gap-1.5">
              <span className="text-[26px] font-black leading-none text-black/90">
                {fmtMoney(yearSum)}
                <span className="text-[14px]">元</span>
              </span>
              <span className="text-[13px] text-black/45">共{yearPaid.length}单</span>
            </div>
            <button type="button" onClick={() => onToast('会员等级：人靠衣装LV.1（演示）')} className="flex items-center gap-1.5 active:opacity-75">
              <TbImg src={tbImg('gift', 96, 96, 1)} alt="等级礼盒" className="h-9 w-9 rounded-lg" />
              <span className="text-left">
                <span className="block text-[11.5px] text-black/55">再买5单 升级</span>
                <span className="block text-[12.5px] font-bold text-black/85">[人靠衣装LV.1] &gt;</span>
              </span>
            </button>
          </div>
          {/* 分类 */}
          <div className="mt-4 grid grid-cols-3">
            {[
              { label: '购物', value: yearSum, count: yearPaid.length },
              { label: '闪购·外卖', value: 0, count: 0 },
              { label: '飞猪·旅行', value: 0, count: 0 },
            ].map((c) => (
              <button key={c.label} type="button" onClick={() => onToast(`${c.label}账单（演示）`)} className="flex flex-col items-start py-0.5 text-left active:opacity-70">
                <span className="flex items-center gap-0.5 text-[14px] text-black/70">
                  {c.label}
                  <ChevronRight className="h-3.5 w-3.5 text-black/30" />
                </span>
                <span className="mt-1 text-[16px] font-black leading-none text-black/90">
                  {fmtMoney(c.value)}
                  <span className="text-[12px] font-bold">元</span>
                </span>
                <span className="mt-0.5 text-[11.5px] text-black/40">{c.count}单</span>
              </button>
            ))}
          </div>
        </div>
        </div>
        <TbPullIndicator h={pull} />
      </div>
      {/* 悬浮编辑 */}
      <button type="button" aria-label="编辑" onClick={() => onToast('编辑账单备注（演示）')} className="absolute bottom-9 right-4 z-30 grid h-12 w-12 place-items-center rounded-full bg-white shadow-[0_4px_14px_rgba(0,0,0,0.12)] ring-1 ring-black/5 active:opacity-80">
        <Pencil className="h-5 w-5 text-black/70" strokeWidth={1.9} />
      </button>
    </div>
  );
}
