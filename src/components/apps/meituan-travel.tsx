'use client';

/**
 * 机票火车票频道（对齐真机美团「酒店/旅行」二级频道）：
 * - 顶部子频道：机票 / 火车票 / 酒店民宿（引导首页酒店旅行）/ 景点游玩 / 旅游度假（演示）
 * - 机票：单程/往返、城市对（可换/可改）、日期、舱等 → 找机票 → 航班列表
 *   （日期横条带价格、航班卡：起降时间/机场/航司/机型/价格/已优惠/神券包，青春省钱飞绿色专享卡，底部排序栏）
 * - 火车票：城市对 + 日期 + 只看高铁票 → 车次列表（坐席价格/有票/候补）
 * - 选航班/车次 → 订票弹层（乘机人/乘车人 + 价格明细）→ 建单 kind:'flight'|'train' → 收银台
 * - 数据为确定性伪随机（按城市对+日期播种），同一天列表稳定、换日换价
 */
import { useMemo, useState } from 'react';
import {
  ArrowLeftRight,
  Bell,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Eye,
  Filter,
  Plane,
  ShieldCheck,
  Star,
  TrainFront,
  X,
} from 'lucide-react';
import {
  mtLoadOrders,
  mtSaveOrders,
  mtUidOf,
  type MtOrder,
  type MtSession,
} from '@/lib/ios/meituan-store';
import { mtImg } from '@/lib/ios/meituan-data';

// ---------------- 城市与机场/车站数据 ----------------

const CITIES = ['北京', '上海', '广州', '深圳', '成都', '杭州', '西安', '重庆', '昆明', '三亚', '哈尔滨', '海拉尔', '武汉', '长沙', '南京', '厦门'];

const CITY_AIRPORTS: Record<string, string[]> = {
  北京: ['大兴', '首都 T2'],
  上海: ['浦东 T1', '浦东 T2', '虹桥 T2'],
  广州: ['白云 T2'],
  深圳: ['宝安 T3'],
  成都: ['天府 T2', '双流 T2'],
  杭州: ['萧山 T4'],
  西安: ['咸阳 T3'],
  重庆: ['江北 T3'],
  昆明: ['长水 T1'],
  三亚: ['凤凰 T1'],
  哈尔滨: ['太平 T2'],
  海拉尔: ['东山'],
  武汉: ['天河 T3'],
  长沙: ['黄花 T2'],
  南京: ['禄口 T2'],
  厦门: ['高崎 T4'],
};

const CITY_STATIONS: Record<string, string[]> = {
  北京: ['北京南', '北京西'],
  上海: ['上海虹桥', '上海'],
  广州: ['广州南'],
  深圳: ['深圳北'],
  成都: ['成都东'],
  杭州: ['杭州东'],
  西安: ['西安北'],
  重庆: ['重庆北'],
  昆明: ['昆明南'],
  武汉: ['武汉'],
  长沙: ['长沙南'],
  南京: ['南京南'],
};

const AIRLINES = ['吉祥', '中联航', '南航', '东航', '国航', '厦航', '川航'];
const AIRLINE_CODE: Record<string, string> = { 吉祥: 'HO', 中联航: 'KN', 南航: 'CZ', 东航: 'MU', 国航: 'CA', 厦航: 'MF', 川航: '3U' };
const PLANES = ['空客320neo(中)', '波音737(中)', '空客320(中)', '空客350(大)', '波音787(大)'];

// ---------------- 确定性伪随机 ----------------

function seeded(s: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h >>> 0) % 100000) / 100000;
  };
}

const pad2 = (n: number): string => String(n).padStart(2, '0');
const fmtMoney = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(0));

/** 距离基准价（按城市对哈希：286~790） */
function routeBase(from: string, to: string): number {
  const r = seeded(`base:${[from, to].sort().join('-')}`);
  return 286 + Math.floor(r() * 504);
}

interface DayItem { label: string; sub: string; date: string; price: number; }

function genDays(from: string, to: string): DayItem[] {
  const base = routeBase(from, to);
  const out: DayItem[] = [];
  const wd = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  for (let i = 0; i < 5; i++) {
    const d = new Date(Date.now() + i * 86_400_000);
    const r = seeded(`day:${from}-${to}-${d.toDateString()}`);
    const delta = Math.floor((r() - 0.45) * 160);
    out.push({
      label: i === 0 ? '今天' : i === 1 ? '明天' : wd[d.getDay()],
      sub: `${d.getMonth() + 1}.${d.getDate()}`,
      date: d.toDateString(),
      price: Math.max(168, base + delta),
    });
  }
  return out;
}

interface Flight {
  id: string;
  no: string;
  airline: string;
  plane: string;
  dep: string;
  arr: string;
  depAp: string;
  arrAp: string;
  price: number;
  orig: number;
  off: number;
  tag?: string;
  youth: boolean;
  shared: boolean;
}

function genFlights(from: string, to: string, date: string, cabin: 'eco' | 'biz', youthOnly: boolean): Flight[] {
  const base = genDays(from, to).find((d) => d.date === date)?.price ?? routeBase(from, to);
  const cabinMul = cabin === 'biz' ? 3.2 : 1;
  const r = seeded(`fl:${from}-${to}-${date}-${cabin}`);
  const list: Flight[] = [];
  let depMin = 6 * 60 + Math.floor(r() * 40);
  for (let i = 0; i < 9; i++) {
    depMin += 55 + Math.floor(r() * 85);
    if (depMin >= 22 * 60 + 40) depMin -= 16 * 60;
    const dur = 118 + Math.floor(r() * 55);
    const airline = AIRLINES[Math.floor(r() * AIRLINES.length)];
    const price = Math.round(((base + Math.floor((r() - 0.4) * 190)) * cabinMul) / 10) * 10 - 4;
    const off = Math.floor(r() * 5) === 0 ? 30 + Math.floor(r() * 4) * 10 : 0;
    list.push({
      id: `F${i}`,
      no: `${AIRLINE_CODE[airline]}${1000 + Math.floor(r() * 8999)}`,
      airline,
      plane: PLANES[Math.floor(r() * PLANES.length)],
      dep: `${pad2(Math.floor(depMin / 60))}:${pad2(depMin % 60)}`,
      arr: `${pad2(Math.floor(((depMin + dur) % 1440) / 60))}:${pad2((depMin + dur) % 60)}`,
      depAp: CITY_AIRPORTS[from]?.[Math.floor(r() * (CITY_AIRPORTS[from]?.length ?? 1))] ?? from,
      arrAp: CITY_AIRPORTS[to]?.[Math.floor(r() * (CITY_AIRPORTS[to]?.length ?? 1))] ?? to,
      price,
      orig: Math.round(price * (1.04 + r() * 0.12)),
      off,
      tag: off > 0 ? '家庭套票' : r() < 0.22 ? '票少' : undefined,
      youth: r() < 0.3,
      shared: r() < 0.4,
    });
  }
  return youthOnly ? list.filter((f) => f.youth) : list;
}

interface TrainSeat { name: string; price: number; state: string; }
interface Train {
  id: string;
  no: string;
  dep: string;
  arr: string;
  depSt: string;
  arrSt: string;
  dur: string;
  seats: TrainSeat[];
  green: boolean;
}

function genTrains(from: string, to: string, date: string, hsrOnly: boolean): Train[] {
  const base = routeBase(from, to);
  const r = seeded(`tr:${from}-${to}-${date}`);
  const list: Train[] = [];
  let depMin = 6 * 60 + 30 + Math.floor(r() * 50);
  const pool = hsrOnly ? ['G', 'G', 'G', 'D'] : ['G', 'D', 'G', 'C', 'G', 'D', 'G', 'K'];
  for (let i = 0; i < 8; i++) {
    depMin += 38 + Math.floor(r() * 66);
    if (depMin >= 21 * 60 + 30) depMin -= 14 * 60;
    const dur = 268 + Math.floor(r() * 95);
    const p = base + Math.floor((r() - 0.4) * 120);
    const no = `${pool[i % pool.length]}${Math.floor(r() * 899) + 1}`;
    list.push({
      id: `T${i}`,
      no,
      dep: `${pad2(Math.floor(depMin / 60))}:${pad2(depMin % 60)}`,
      arr: `${pad2(Math.floor(((depMin + dur) % 1440) / 60))}:${pad2((depMin + dur) % 60)}`,
      depSt: CITY_STATIONS[from]?.[Math.floor(r() * (CITY_STATIONS[from]?.length ?? 1))] ?? from,
      arrSt: CITY_STATIONS[to]?.[Math.floor(r() * (CITY_STATIONS[to]?.length ?? 1))] ?? to,
      dur: `${Math.floor(dur / 60)}小时${pad2(dur % 60)}分`,
      seats: [
        { name: '二等座', price: p, state: r() < 0.7 ? '有票' : `${Math.floor(r() * 18) + 2}张` },
        { name: '一等座', price: Math.round(p * 1.63), state: r() < 0.55 ? '有票' : '候补' },
        { name: '商务座', price: Math.round(p * 3.1), state: r() < 0.4 ? '有票' : '候补' },
      ],
      green: r() < 0.25,
    });
  }
  return list;
}

// ---------------- 订票弹层 ----------------

function BookingSheet({
  kind,
  title,
  spec,
  passengerLabel,
  price,
  fees,
  onClose,
  onSubmit,
}: {
  kind: 'flight' | 'train';
  title: string;
  spec: string;
  passengerLabel: string;
  price: number;
  fees: { name: string; amount: number }[];
  onClose: () => void;
  onSubmit: () => void;
}) {
  const total = price + fees.reduce((s, f) => s + f.amount, 0);
  return (
    <div className="absolute inset-0 z-40 flex items-end bg-black/45" onClick={onClose}>
      <div className="max-h-[82%] w-full overflow-y-auto rounded-t-2xl bg-white p-4 pb-[max(16px,env(safe-area-inset-bottom))]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[16px] font-bold text-black/90">{title}</p>
            <p className="mt-1 truncate text-[12px] text-black/45">{spec}</p>
          </div>
          <button type="button" aria-label="关闭" onClick={onClose} className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-black/[0.05]">
            <X className="h-4 w-4 text-black/50" />
          </button>
        </div>

        <div className="mt-3 flex items-center gap-2.5 rounded-xl bg-[#FFF7DB] p-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#FFE066]">
            {kind === 'flight' ? <Plane className="h-5 w-5 text-black/75" strokeWidth={1.9} /> : <TrainFront className="h-5 w-5 text-black/75" strokeWidth={1.9} />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold text-black/85">{passengerLabel}</p>
            <p className="text-[11px] text-black/40">身份证 1301***********0226（演示）</p>
          </div>
          <span className="shrink-0 rounded-full border border-black/10 px-2.5 py-1 text-[11px] text-black/60">已选 1 人</span>
        </div>

        <div className="mt-3 rounded-xl bg-[#F7F8FA] p-3 text-[12px]">
          <p className="text-[13px] font-semibold text-black/75">价格明细</p>
          <div className="mt-2 flex items-center justify-between text-black/60">
            <span>{kind === 'flight' ? '成人票价 ×1' : '坐席票价 ×1'}</span>
            <span>¥{fmtMoney(price)}</span>
          </div>
          {fees.map((f) => (
            <div key={f.name} className="mt-1 flex items-center justify-between text-black/60">
              <span>{f.name}</span>
              <span>¥{fmtMoney(f.amount)}</span>
            </div>
          ))}
          <div className="mt-2 flex items-center justify-between border-t border-black/[0.06] pt-2 text-[14px] font-bold text-black/90">
            <span>总计</span>
            <span className="text-[#FF4B33]">¥{fmtMoney(total)}</span>
          </div>
        </div>

        <p className="mt-2.5 flex items-center gap-1 text-[11px] text-black/40">
          <ShieldCheck className="h-3.5 w-3.5 text-[#12B76A]" />
          {kind === 'flight' ? '退改按航司规则执行 · 含延误取消保障' : '开车前均可退票 · 按铁路局规则收取手续费'}
        </p>

        <button type="button" onClick={onSubmit} className="mt-3 h-12 w-full rounded-full bg-gradient-to-r from-[#FFC300] to-[#FF9500] text-[16px] font-semibold text-black/90 active:opacity-85">
          提交订单
        </button>
      </div>
    </div>
  );
}

// ---------------- 城市选择弹层 ----------------

function CitySheet({ title, onPick, onClose }: { title: string; onPick: (c: string) => void; onClose: () => void }) {
  return (
    <div className="absolute inset-0 z-40 flex items-end bg-black/45" onClick={onClose}>
      <div className="max-h-[70%] w-full overflow-y-auto rounded-t-2xl bg-white p-4 pb-[max(16px,env(safe-area-inset-bottom))]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <p className="text-[15px] font-bold text-black/90">{title}</p>
          <button type="button" aria-label="关闭" onClick={onClose} className="grid h-7 w-7 place-items-center rounded-full bg-black/[0.05]">
            <X className="h-4 w-4 text-black/50" />
          </button>
        </div>
        <div className="mt-3 grid grid-cols-4 gap-2.5">
          {CITIES.map((c) => (
            <button key={c} type="button" onClick={() => onPick(c)} className="rounded-xl bg-[#F5F6F7] py-2.5 text-[13px] text-black/75 active:bg-[#FFE9A8]">
              {c}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------- 主组件 ----------------

const TRAVEL_TABS = ['机票', '火车票', '酒店民宿', '景点游玩', '旅游度假'];

export default function TravelChannelPage({
  session,
  onBack,
  onOpenPay,
  onToast,
}: {
  session: MtSession;
  onBack: () => void;
  onOpenPay: (o: MtOrder) => void;
  onToast: (m: string) => void;
}) {
  const [tab, setTab] = useState('机票');
  const [roundTrip, setRoundTrip] = useState(false);
  const [cabin, setCabin] = useState<'eco' | 'biz'>('eco');
  const [from, setFrom] = useState('北京');
  const [to, setTo] = useState('上海');
  const [dayIdx, setDayIdx] = useState(0);
  const [view, setView] = useState<'home' | 'list'>('home');
  const [sortMode, setSortMode] = useState<'rec' | 'price' | 'time'>('rec');
  const [hsrOnly, setHsrOnly] = useState(true);
  const [cityPick, setCityPick] = useState<null | 'from' | 'to' | 'swapFrom' | 'swapTo'>(null);
  const [book, setBook] = useState<null | { kind: 'flight' | 'train'; title: string; spec: string; passenger: string; price: number; fees: { name: string; amount: number }[] }>(null);

  const days = useMemo(() => genDays(from, to), [from, to]);
  const dateLabel = useMemo(() => {
    const d = new Date(Date.now() + dayIdx * 86_400_000);
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  }, [dayIdx]);
  const flights = useMemo(() => genFlights(from, to, days[dayIdx].date, cabin, false), [from, to, dayIdx, cabin, days]);
  const trains = useMemo(() => genTrains(from, to, days[dayIdx].date, hsrOnly), [from, to, dayIdx, hsrOnly]);

  const sortedFlights = useMemo(() => {
    const arr = [...flights];
    if (sortMode === 'price') arr.sort((a, b) => a.price - b.price);
    if (sortMode === 'time') arr.sort((a, b) => a.dep.localeCompare(b.dep));
    return arr;
  }, [flights, sortMode]);

  const createTripOrder = (kind: 'flight' | 'train', t: NonNullable<typeof book>): MtOrder => {
    const uid = mtUidOf(session);
    const now = Date.now();
    const order: MtOrder = {
      id: `mt${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      uid,
      merchantId: kind,
      merchantName: kind === 'flight' ? '美团机票' : '美团火车票',
      merchantEmoji: kind === 'flight' ? '✈️' : '🚄',
      merchantImg: mtImg(kind, 480, 360, 0, 'c'),
      kind,
      items: [{ dishId: `${kind}-${now}`, name: t.title, price: t.price, qty: 1, emoji: kind === 'flight' ? '✈️' : '🚄', img: mtImg(kind, 240, 240, 1, 'f'), spec: t.spec }],
      itemTotal: t.price + t.fees.reduce((s, f) => s + f.amount, 0),
      deliveryFee: 0,
      discount: 0,
      total: Math.max(0.01, t.price + t.fees.reduce((s, f) => s + f.amount, 0)),
      status: 'pendingPay',
      createdAt: now,
      statusLog: [{ status: 'pendingPay', at: now }],
    };
    mtSaveOrders(uid, [order, ...mtLoadOrders(uid)]);
    window.dispatchEvent(new CustomEvent('mt-orders-changed'));
    return order;
  };

  const submit = () => {
    if (!book) return;
    const order = createTripOrder(book.kind, book);
    setBook(null);
    onToast('提交成功，请完成支付');
    onOpenPay(order);
  };

  const cityRow = (
    <div className="flex items-center justify-between px-6 py-5">
      <button type="button" onClick={() => setCityPick('from')} className="min-w-0 text-left text-[26px] font-semibold text-black/90 active:opacity-70">
        {from}
      </button>
      <button
        type="button"
        aria-label="交换出发到达"
        onClick={() => {
          setFrom(to);
          setTo(from);
        }}
        className="mx-3 grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#FFF3C4] active:bg-[#FFE9A8]"
      >
        <ArrowLeftRight className="h-5 w-5 text-[#B77900]" strokeWidth={2} />
      </button>
      <button type="button" onClick={() => setCityPick('to')} className="min-w-0 text-right text-[26px] font-semibold text-black/90 active:opacity-70">
        {to}
      </button>
    </div>
  );

  const dateRow = (
    <button type="button" onClick={() => onToast('暂只支持近 5 天日期（顶部日期条可选）')} className="flex w-full items-center gap-1.5 border-t border-black/[0.06] px-6 py-4 text-left active:opacity-70">
      <CalendarDays className="h-[18px] w-[18px] text-black/70" strokeWidth={2} />
      <span className="text-[17px] font-semibold text-black/90">{dateLabel}</span>
      <span className="text-[13px] text-black/50">{dayIdx === 0 ? '今天' : days[dayIdx].label}</span>
      <ChevronRight className="ml-auto h-4 w-4 text-black/30" />
    </button>
  );

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-[#F4F5F7]">
      {/* 顶部（浅黄） */}
      <div className="shrink-0 bg-gradient-to-b from-[#FFE066] to-[#FFE99A] pb-3 pt-[54px]">
        <div className="flex items-center gap-2 px-4">
          <button type="button" aria-label="返回" onClick={onBack} className="grid h-9 w-9 shrink-0 place-items-center rounded-full active:bg-black/5">
            <ChevronLeft className="h-6 w-6 text-black/75" />
          </button>
          <p className="text-[19px] font-bold text-black/90">酒店 / 旅行</p>
          <span className="rounded-[4px] border border-black/15 px-1.5 py-px text-[10px] text-black/55">资质规则</span>
        </div>
        {/* 子频道 tabs */}
        <div className="mt-3 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {TRAVEL_TABS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                if (t === '酒店民宿') onToast('酒店民宿请用首页「酒店旅行」频道');
                else if (t === '景点游玩' || t === '旅游度假') onToast(`「${t}」频道即将上线`);
                setTab(t);
              }}
              className={`flex shrink-0 flex-col items-center gap-1 rounded-2xl px-3.5 pb-1.5 pt-2 ${tab === t ? 'bg-[#FFD100] shadow-sm' : 'bg-white/85'}`}
            >
              {t === '机票' ? (
                <Plane className="h-[22px] w-[22px] text-[#2B7BD3]" strokeWidth={1.9} />
              ) : t === '火车票' ? (
                <TrainFront className="h-[22px] w-[22px] text-[#2B7BD3]" strokeWidth={1.9} />
              ) : t === '酒店民宿' ? (
                <span className="grid h-[22px] w-[22px] place-items-center text-[15px]">🏨</span>
              ) : t === '景点游玩' ? (
                <span className="grid h-[22px] w-[22px] place-items-center text-[15px]">🏰</span>
              ) : (
                <span className="grid h-[22px] w-[22px] place-items-center text-[15px]">🏖️</span>
              )}
              <span className={`whitespace-nowrap text-[11px] ${tab === t ? 'font-semibold text-black/90' : 'text-black/65'}`}>{t}</span>
            </button>
          ))}
        </div>
      </div>

      {tab === '机票' && view === 'home' && (
        <div className="flex-1 overflow-y-auto overscroll-contain">
          <div className="rounded-b-2xl bg-white pb-4">
            {/* 单程 / 往返 */}
            <div className="flex items-center justify-around pt-4">
              {['单程', '往返'].map((t, i) => (
                <button key={t} type="button" onClick={() => setRoundTrip(i === 1)} className="flex flex-col items-center gap-1.5">
                  <span className={`text-[19px] ${roundTrip === (i === 1) ? 'font-bold text-black/90' : 'text-black/45'}`}>{t}</span>
                  <span className={`h-[3px] w-8 rounded-full ${roundTrip === (i === 1) ? 'bg-[#FFC300]' : 'bg-transparent'}`} />
                </button>
              ))}
            </div>
            {cityRow}
            {dateRow}
            {/* 历史路线 chips */}
            <div className="flex flex-wrap gap-2 px-6 pt-2">
              <span className="rounded-full bg-[#F5F6F7] px-3 py-1.5 text-[12px] text-black/60">{from}-{to}</span>
              <button
                type="button"
                onClick={() => {
                  setFrom('北京');
                  setTo('上海');
                  onToast('已恢复默认路线');
                }}
                className="rounded-full bg-[#F5F6F7] px-3 py-1.5 text-[12px] text-black/60 active:opacity-70"
              >
                清除
              </button>
            </div>
            {/* 舱等 */}
            <div className="flex items-center justify-between px-6 pt-3">
              <div className="flex rounded-full bg-[#F5F6F7] p-1">
                {(['eco', 'biz'] as const).map((c) => (
                  <button key={c} type="button" onClick={() => setCabin(c)} className={`rounded-full px-4 py-1.5 text-[13px] ${cabin === c ? 'bg-white font-semibold text-black/85 shadow-sm' : 'text-black/50'}`}>
                    {c === 'eco' ? '经济舱' : '公务/头等舱'}
                  </button>
                ))}
              </div>
              <button type="button" onClick={() => onToast('低价票提醒已开启（演示）')} className="text-[13px] text-[#FF8A00]">
                添加乘机人 找到低价票
                <ChevronRight className="ml-0.5 inline h-3.5 w-3.5" />
              </button>
            </div>
            {/* 找机票 */}
            <div className="px-6 pt-4">
              <button type="button" onClick={() => setView('list')} className="h-[52px] w-full rounded-full bg-gradient-to-r from-[#FFC300] via-[#FFA51E] to-[#FF8A00] text-[18px] font-bold tracking-[6px] text-black/90 active:opacity-85">
                找机票
              </button>
              <button type="button" onClick={() => onToast('单单返现金·内测模式（演示）')} className="mt-3 w-full text-center text-[12px] text-black/55">
                <span className="font-semibold text-[#2A7BF6]">单单返现金</span> 内测模式邀请您进入，出差返百元
                <ChevronRight className="inline h-3 w-3" />
              </button>
            </div>
          </div>

          {/* 特价机票 + 权益卡 */}
          <div className="mt-3 grid grid-cols-2 gap-3 px-4">
            <div className="rounded-2xl bg-gradient-to-br from-[#FFEFE6] to-white p-3.5">
              <p className="text-[15px] font-bold text-black/90">
                特价<span className="text-[#FF6000]">机票</span>
              </p>
              <p className="mt-0.5 text-[11px] text-black/45">捡漏机票 低至百元</p>
              {[
                { c: `${from} → ${to}`, p: days[0].price },
                { c: `${from} → 海拉尔`, p: 141 },
              ].map((x) => (
                <button key={x.c} type="button" onClick={() => { setTo(x.c.split(' → ')[1]); setView('list'); }} className="mt-2 flex w-full items-center justify-between rounded-xl bg-white px-3 py-2.5 active:opacity-80">
                  <span className="truncate text-[13px] text-black/75">{x.c}</span>
                  <span className="shrink-0 text-[15px] font-bold text-[#FF4B33]">
                    ¥{fmtMoney(x.p)}
                    <span className="text-[10px] font-normal text-black/40"> 起</span>
                  </span>
                </button>
              ))}
            </div>
            <div className="rounded-2xl bg-gradient-to-br from-[#FFF7DB] to-white p-3.5">
              <p className="text-[15px] font-bold text-black/90">
                权<span className="text-[#FF8A00]">益</span>卡
              </p>
              <p className="mt-0.5 text-[11px] text-black/45">吃喝玩乐行一卡全包</p>
              <button type="button" onClick={() => onToast('机票免单·组队赢免单（演示）')} className="mt-2 block h-[74px] w-full rounded-xl bg-gradient-to-br from-[#2B5DA8] to-[#1E3F75] p-2 text-left active:opacity-85">
                <span className="text-[12px] font-bold text-white">「组队赢免单」</span>
                <span className="mt-1 block text-[10px] text-white/70">最高999元</span>
              </button>
              <button type="button" onClick={() => onToast('青年权益卡·青春特惠（演示）')} className="mt-2 block h-[74px] w-full rounded-xl bg-gradient-to-br from-[#E8FFE0] to-[#B8F0A8] p-2 text-left active:opacity-85">
                <span className="text-[13px] font-bold text-[#1D5B2C]">青春省钱飞</span>
                <span className="mt-1 block text-[10px] text-[#1D5B2C]/70">青春特惠</span>
              </button>
            </div>
          </div>
          <div className="mx-4 mt-3 overflow-hidden rounded-2xl bg-gradient-to-r from-[#20304F] to-[#33456B] p-4">
            <p className="text-[15px] font-bold text-[#FFE066]">观演专享，领出行好礼</p>
            <p className="mt-1 text-[11px] text-white/60">演出观演用户专享机票火车票立减券（演示）</p>
          </div>
        </div>
      )}

      {/* 机票航班列表 */}
      {tab === '机票' && view === 'list' && (
        <>
          <div className="flex shrink-0 items-center gap-2 bg-white px-3 pb-2.5 pt-3">
            <button type="button" aria-label="返回" onClick={() => setView('home')} className="grid h-8 w-8 shrink-0 place-items-center rounded-full active:bg-black/5">
              <ChevronLeft className="h-5 w-5 text-black/70" />
            </button>
            <p className="min-w-0 flex-1 truncate text-center text-[17px] font-bold text-black/90">
              {from} → {to}
            </p>
            <button type="button" aria-label="低价提醒" onClick={() => onToast('已开启低价提醒（演示）')} className="flex w-10 shrink-0 flex-col items-center">
              <Bell className="h-5 w-5 text-black/60" />
              <span className="text-[9px] text-black/45">低价提醒</span>
            </button>
          </div>
          {/* 日期条 */}
          <div className="flex shrink-0 gap-1.5 overflow-x-auto bg-white px-3 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {days.map((d, i) => (
              <button key={d.date} type="button" onClick={() => setDayIdx(i)} className={`w-[72px] shrink-0 rounded-xl py-1.5 text-center ${i === dayIdx ? 'bg-[#FFD100]' : 'bg-[#F5F6F7]'}`}>
                <span className={`block text-[11px] ${i === dayIdx ? 'text-black/75' : 'text-black/45'}`}>{d.label}</span>
                <span className={`block text-[15px] font-semibold ${i === dayIdx ? 'text-black/90' : 'text-black/70'}`}>{d.sub.split('.')[1]}</span>
                <span className={`block text-[10px] ${i === dayIdx ? 'text-black/70' : 'text-black/45'}`}>¥{fmtMoney(d.price)}</span>
              </button>
            ))}
          </div>
          {/* 筛选 chips */}
          <div className="flex shrink-0 items-center gap-2 overflow-x-auto bg-white px-3 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <button type="button" onClick={() => onToast('已按起降机场筛选（演示）')} className="shrink-0 rounded-full bg-[#F5F6F7] px-3 py-1.5 text-[12px] text-black/65">{from}机场</button>
            <button type="button" onClick={() => onToast('已按到达机场筛选（演示）')} className="shrink-0 rounded-full bg-[#F5F6F7] px-3 py-1.5 text-[12px] text-black/65">{to}机场</button>
            <button type="button" onClick={() => onToast('青春省钱飞已在列表中标出')} className="shrink-0 rounded-full bg-[#EAF9E4] px-3 py-1.5 text-[12px] font-semibold text-[#1D7A3C]">青春省钱飞</button>
            <button type="button" onClick={() => onToast('乘机人：微信用户（演示）')} className="shrink-0 rounded-full bg-[#F5F6F7] px-3 py-1.5 text-[12px] text-black/65">选乘机人</button>
          </div>

          <div className="flex-1 overflow-y-auto overscroll-contain px-3 pb-24 pt-3">
            <div className="space-y-3">
              {sortedFlights.slice(0, 3).map((f) => (
                <FlightCard key={f.id} f={f} onBook={() => setBook({ kind: 'flight', title: `${f.airline}${f.no} ${from}→${to}`, spec: `${f.dep} ${f.depAp} → ${f.arr} ${f.arrAp} · ${f.plane}${f.shared ? ' · 含共享' : ''}`, passenger: `乘机人：${session.name}`, price: f.price, fees: [{ name: '机建+燃油', amount: 50 }] })} />
              ))}
              {/* 青春省钱飞专享卡 */}
              {sortedFlights.some((f) => f.youth) && (
                <div className="rounded-2xl bg-gradient-to-b from-[#E9FBDF] to-white p-3">
                  <div className="flex items-center gap-2">
                    <p className="text-[16px] font-bold text-[#1D7A3C]">青春省钱飞</p>
                    <Check className="h-4 w-4 text-[#1D7A3C]" strokeWidth={3} />
                    <span className="text-[12px] text-[#1D7A3C]/80">限时福利 专享低价</span>
                  </div>
                  {sortedFlights.filter((f) => f.youth).slice(0, 1).map((f) => (
                    <FlightCard key={`y-${f.id}`} f={{ ...f, tag: '青春价' }} youth onBook={() => setBook({ kind: 'flight', title: `${f.airline}${f.no} ${from}→${to}`, spec: `${f.dep} ${f.depAp} → ${f.arr} ${f.arrAp} · ${f.plane} · 青春价`, passenger: `乘机人：${session.name}`, price: f.price, fees: [{ name: '机建+燃油', amount: 50 }] })} />
                  ))}
                </div>
              )}
              {sortedFlights.slice(3).map((f) => (
                <FlightCard key={`s-${f.id}`} f={f} onBook={() => setBook({ kind: 'flight', title: `${f.airline}${f.no} ${from}→${to}`, spec: `${f.dep} ${f.depAp} → ${f.arr} ${f.arrAp} · ${f.plane}${f.shared ? ' · 含共享' : ''}`, passenger: `乘机人：${session.name}`, price: f.price, fees: [{ name: '机建+燃油', amount: 50 }] })} />
              ))}
            </div>
          </div>

          {/* 底部排序栏 */}
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-around border-t border-black/[0.06] bg-white pb-[max(10px,env(safe-area-inset-bottom))] pt-2">
            {[
              { k: 'rec', label: '推荐排序', icon: Eye },
              { k: 'price', label: '价格低-高', icon: ChevronRight },
              { k: 'time', label: '时间排序', icon: Clock3 },
            ].map((s) => (
              <button key={s.k} type="button" onClick={() => setSortMode(s.k as typeof sortMode)} className={`flex flex-col items-center gap-0.5 px-2 ${sortMode === s.k ? 'text-[#FF8A00]' : 'text-black/55'}`}>
                <s.icon className="h-5 w-5" strokeWidth={1.9} />
                <span className="text-[10px]">{s.label}</span>
              </button>
            ))}
            <button type="button" onClick={() => onToast('高级筛选（演示）')} className="flex flex-col items-center gap-0.5 px-2 text-black/55">
              <Filter className="h-5 w-5" strokeWidth={1.9} />
              <span className="text-[10px]">高级筛选</span>
            </button>
            <button type="button" onClick={() => onToast('我的收藏（演示）')} className="flex flex-col items-center gap-0.5 px-2 text-black/55">
              <Star className="h-5 w-5" strokeWidth={1.9} />
              <span className="text-[10px]">我的收藏</span>
            </button>
          </div>
        </>
      )}

      {/* 火车票 */}
      {tab === '火车票' && (
        <>
          {view === 'home' && (
            <div className="flex-1 overflow-y-auto overscroll-contain">
              <div className="rounded-b-2xl bg-white pb-4">
                {cityRow}
                {dateRow}
                <div className="flex items-center justify-between border-t border-black/[0.06] px-6 py-4">
                  <button type="button" onClick={() => setHsrOnly((v) => !v)} className="flex items-center gap-2">
                    <span className={`grid h-5 w-5 place-items-center rounded-md ${hsrOnly ? 'bg-[#FFC300]' : 'border border-black/25'}`}>{hsrOnly && <Check className="h-3.5 w-3.5 text-black/80" strokeWidth={3} />}</span>
                    <span className="text-[14px] text-black/75">只看高铁票</span>
                  </button>
                  <button type="button" onClick={() => onToast('学生票资质（演示）')} className="text-[13px] text-black/55">
                    学生票 <ChevronRight className="inline h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="px-6 pt-2">
                  <button type="button" onClick={() => setView('list')} className="h-[52px] w-full rounded-full bg-gradient-to-r from-[#FFC300] via-[#FFA51E] to-[#FF8A00] text-[18px] font-bold tracking-[6px] text-black/90 active:opacity-85">
                    查询车票
                  </button>
                </div>
              </div>
              <div className="mx-4 mt-3 rounded-2xl bg-white p-4">
                <p className="text-[14px] font-bold text-black/85">出行贴士</p>
                <p className="mt-1.5 text-[12px] leading-relaxed text-black/50">铁路候补购票成功率高，发车前均可退改；节假日出行请提前购票。</p>
              </div>
            </div>
          )}
          {view === 'list' && (
            <>
              <div className="flex shrink-0 items-center gap-2 bg-white px-3 pb-2.5 pt-3">
                <button type="button" aria-label="返回" onClick={() => setView('home')} className="grid h-8 w-8 shrink-0 place-items-center rounded-full active:bg-black/5">
                  <ChevronLeft className="h-5 w-5 text-black/70" />
                </button>
                <p className="min-w-0 flex-1 truncate text-center text-[17px] font-bold text-black/90">
                  {from} → {to}
                </p>
                <span className="w-10 shrink-0" />
              </div>
              <div className="flex shrink-0 gap-1.5 overflow-x-auto bg-white px-3 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {days.map((d, i) => (
                  <button key={d.date} type="button" onClick={() => setDayIdx(i)} className={`w-[72px] shrink-0 rounded-xl py-1.5 text-center ${i === dayIdx ? 'bg-[#FFD100]' : 'bg-[#F5F6F7]'}`}>
                    <span className={`block text-[11px] ${i === dayIdx ? 'text-black/75' : 'text-black/45'}`}>{d.label}</span>
                    <span className={`block text-[15px] font-semibold ${i === dayIdx ? 'text-black/90' : 'text-black/70'}`}>{d.sub.split('.')[1]}</span>
                  </button>
                ))}
              </div>
              <div className="flex-1 space-y-3 overflow-y-auto overscroll-contain px-3 pb-8 pt-3">
                {trains.map((t) => (
                  <div key={t.id} className="rounded-2xl bg-white p-3.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[15px] font-bold text-black/90">{t.no}</span>
                      {t.green && <span className="rounded-[4px] bg-[#EAF9E4] px-1.5 py-px text-[10px] text-[#1D7A3C]">绿色出行</span>}
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <div className="w-[64px] shrink-0">
                        <p className="text-[20px] font-bold leading-none text-black/90">{t.dep}</p>
                        <p className="mt-1 truncate text-[11px] text-black/45">{t.depSt}</p>
                      </div>
                      <div className="min-w-0 flex-1 text-center">
                        <p className="text-[10px] text-black/35">{t.dur}</p>
                        <div className="mx-2 my-1 border-t border-dashed border-black/20" />
                        <p className="text-[10px] text-black/35">准点率高</p>
                      </div>
                      <div className="w-[64px] shrink-0 text-right">
                        <p className="text-[20px] font-bold leading-none text-black/90">{t.arr}</p>
                        <p className="mt-1 truncate text-[11px] text-black/45">{t.arrSt}</p>
                      </div>
                    </div>
                    <div className="mt-2.5 space-y-1.5">
                      {t.seats.map((s) => (
                        <button key={s.name} type="button" onClick={() => setBook({ kind: 'train', title: `${t.no}次 ${from}→${to}`, spec: `${t.dep} ${t.depSt} → ${t.arr} ${t.arrSt} · ${s.name}`, passenger: `乘车人：${session.name}`, price: s.price, fees: [] })} disabled={s.state === '候补'} className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left ${s.state === '候补' ? 'bg-[#FAFAFA]' : 'bg-[#F7F8FA] active:bg-[#FFF3C4]'}`}>
                          <span className="text-[13px] text-black/75">
                            {s.name}
                            <span className={`ml-2 text-[11px] ${s.state === '候补' ? 'text-black/35' : s.state === '有票' ? 'text-[#1D7A3C]' : 'text-[#FF8A00]'}`}>{s.state}</span>
                          </span>
                          <span className="text-[15px] font-bold text-[#FF4B33]">
                            ¥{fmtMoney(s.price)}
                            {s.state !== '候补' && <ChevronRight className="ml-1 inline h-3.5 w-3.5 text-black/25" />}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* 其他子频道占位 */}
      {(tab === '酒店民宿' || tab === '景点游玩' || tab === '旅游度假') && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-10 text-center">
          <span className="grid h-16 w-16 place-items-center rounded-full bg-white text-[30px] shadow-sm">{tab === '酒店民宿' ? '🏨' : tab === '景点游玩' ? '🏰' : '🏖️'}</span>
          <p className="text-[15px] font-semibold text-black/70">{tab}频道即将上线</p>
          <p className="text-[12px] text-black/40">{tab === '酒店民宿' ? '酒店民宿可先使用首页「酒店旅行」频道预订' : '敬请期待'}</p>
          <button type="button" onClick={onBack} className="mt-2 rounded-full bg-[#FFD100] px-6 py-2.5 text-[14px] font-semibold text-black/85 active:opacity-85">
            返回首页
          </button>
        </div>
      )}

      {/* 弹层 */}
      {cityPick && (
        <CitySheet
          title={cityPick === 'from' || cityPick === 'swapFrom' ? '出发城市' : '到达城市'}
          onPick={(c) => {
            if (cityPick === 'from') setFrom(c);
            if (cityPick === 'to') setTo(c);
            setCityPick(null);
          }}
          onClose={() => setCityPick(null)}
        />
      )}
      {book && <BookingSheet kind={book.kind} title={book.title} spec={book.spec} passengerLabel={book.passenger} price={book.price} fees={book.fees} onClose={() => setBook(null)} onSubmit={submit} />}
    </div>
  );
}

/** 航班卡（对齐真机：大时间 + 机场 + 航司/机型 + 价格 + 已优惠 + 神券包行） */
function FlightCard({ f, youth = false, onBook }: { f: Flight; youth?: boolean; onBook: () => void }) {
  return (
    <div className={`rounded-2xl bg-white p-3.5 ${youth ? 'border border-[#BFE9AC]' : ''}`}>
      <button type="button" onClick={onBook} className="w-full text-left active:opacity-80">
        <div className="flex items-start justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-[24px] font-bold leading-none text-black/90">{f.dep}</span>
              <span className="mx-1 mt-1 h-px w-8 shrink-0 border-t border-black/25" />
              <span className="text-[24px] font-bold leading-none text-black/90">{f.arr}</span>
            </div>
            <div className="mt-1.5 flex items-center gap-2 text-[12px]">
              <span className="text-[#FF8A00]">{f.depAp}</span>
              <span className="text-black/30">→</span>
              <span className="text-[#FF8A00]">{f.arrAp}</span>
            </div>
            <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-black/45">
              <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-black/[0.06] text-[8px] font-bold text-black/60">{f.airline.slice(0, 1)}</span>
              <span>{f.airline}{f.no}</span>
              <span>｜{f.plane}</span>
              {f.shared && <span>｜含共享</span>}
            </div>
          </div>
          <div className="shrink-0 pl-2 text-right">
            <p className="text-[20px] font-bold leading-none text-[#FF4B33]">
              <span className="text-[12px]">¥</span>
              {fmtMoney(f.price)}
            </p>
            {f.off > 0 && <p className="mt-1 inline-block rounded-[4px] bg-[#FFECE6] px-1 text-[10px] text-[#FF4B33]">已优惠 ¥{f.off}</p>}
            {f.tag && <p className={`mt-1 inline-block rounded-[4px] px-1 text-[10px] ${youth || f.tag === '青春价' ? 'bg-[#EAF9E4] text-[#1D7A3C]' : 'bg-[#FFF1C0] text-[#B77900]'}`}>{f.tag}</p>}
            <p className="mt-1 text-[10px] text-black/35">普通价 ¥{fmtMoney(f.orig)}</p>
          </div>
        </div>
      </button>
      <div className="mt-2.5 rounded-xl bg-[#FFF7F2] px-2.5 py-2 text-[11px]">
        <span className="font-semibold text-[#FF2D7E]">赠 神券包</span>
        <span className="text-black/50"> ｜ 赠 5 元 × 6 张吃喝玩乐神券 膨胀最高减 300 元</span>
      </div>
    </div>
  );
}
