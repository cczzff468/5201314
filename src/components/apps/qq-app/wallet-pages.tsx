'use client';

/** QQ钱包页面（主页/余额/小金库/银行卡/提现/充值/账单） —— v1.9.27 任务10 从 qq.tsx 按功能域拆分；顶层声明全部导出供兄弟模块与入口桶引用。 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeftRight, Banknote, BellRing, Bus, Cat, Check, ChevronLeft, ChevronRight, ClipboardList, CreditCard, Eye, EyeOff, Feather, Flower2, Gamepad2, Gem, Gift, GraduationCap, Inbox, Landmark, MoreHorizontal, Download, PiggyBank, QrCode, Settings, ShieldCheck, Smartphone, Sparkles, TrendingUp, Undo2, Volume2, X } from 'lucide-react';
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
// 深度思考：指令注入 + [思考]块剥离 + 开关（IndexedDB 按联系人隔离，渲染订阅版随设置页切换即时刷新）
// 多账号 v2（Task 40-2b）：kv 裸键自动按 qq 当前账号作用域；purge 限账号用 kvKeysByPrefix+kvDelRaw
// 多账号（Task 40 v2）：注册表/切换/创建走 per-app accounts API；QQ 登录态等 LS 键每次经 accLs(key,'qq')
// 现算（大号原键，小号 --{id} 后缀）；切换账号不刷新网页，根组件监听 ACCOUNT_CHANGED_EVENT 重读
// 头像按 App 隔离：QQ 端读取/写入一律走 qq 槽位（listContactsFor 投影读取，updateContact 的 avatars 合并写入），不再共享联系人 App 的全局默认头像
// 古早主题（retro）：复古 Tab 图标 + 拟物图标底座 + 配色表（QQ 版）
// 生图（锁脸）：照片标签（[图片:描述]/[照片:描述]）提取/生成/规则构建（与微信端共用同一逻辑层，未配置/失败降级文字图片卡片）；
// 手动「文字图片」为卡片版（autoCardText），不走生图
// 【20-d】补充流式分段 carry-over 工具（splitUnfinishedPhotoTag/stripUnfinishedPhotoTag）：
// 流式把 [图片:xxx] 标签切成两段时跨段拼接还原 + 尾部半截标签兜底剥除（与微信/信息端同口径）

import { PayPwdGate, PaySettingsPage } from './cards';
import { QQUser, localDateKey, uid } from './core';
import { BANK_FALLBACK, BANK_META, BankCard, MoneyDigits, VAULT_DAILY_RATE, VAULT_RATE, VaultEarnData, WalletBill, WalletData, fmtMoney, formatCardNo, genCardNo, loadBankCards, loadPayPwd, loadWallet, loadWalletBills, round2, sanitizeAmount, saveBankCards, saveWallet, saveWalletBills, settleVaultEarn } from './wallet';

/** 钱包子页导航头（tone 决定配色：plain 白底黑字 / blue 蓝底白字 / gold 金底白字） */
export function WalletNavHeader({ title, tone = 'plain', onBack, right }: { title: string; tone?: 'plain' | 'blue' | 'gold'; onBack: () => void; right?: React.ReactNode }) {
  const toneCls =
    tone === 'blue' ? 'text-white' : tone === 'gold' ? 'text-white' : 'text-[#1F2329] dark:text-white';
  const btnCls = tone === 'plain' ? 'text-black/45 active:bg-black/5 dark:text-white/50 dark:active:bg-white/10' : 'text-white/90 active:bg-white/15';
  return (
    <div className={`relative flex h-11 shrink-0 items-center px-2 ${toneCls}`}>
      <button type="button" aria-label="返回" data-testid="qq-wallet-back" onClick={onBack} className={`grid h-9 w-9 place-items-center rounded-full ${btnCls}`}>
        <ChevronLeft className="h-[22px] w-[22px]" strokeWidth={2.4} />
      </button>
      <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 text-[17px] font-medium">{title}</span>
      {right ?? null}
    </div>
  );
}

/** 钱包主页（对照截图①：蓝色头部四宫格 + 金融理财/游戏娱乐/生活服务三分区宫格；右上齿轮进支付设置） */
export function WalletHomePage({
  wallet,
  onBack,
  onToast,
  onOpenBalance,
  onOpenVault,
  onOpenPaySettings,
}: {
  wallet: WalletData;
  onBack: () => void;
  onToast: (m: string) => void;
  onOpenBalance: () => void;
  onOpenVault: () => void;
  onOpenPaySettings: () => void;
}) {
  const topCells: { key: string; label: string; dot?: boolean; node: React.ReactNode; onClick: () => void }[] = [
    {
      key: 'balance',
      label: '余额',
      node: <MoneyDigits value={wallet.balance} className="text-[28px] font-bold leading-none" fracClassName="text-[15px] font-bold" />,
      onClick: onOpenBalance,
    },
    {
      key: 'qb',
      label: 'Q币',
      node: <MoneyDigits value={wallet.qb} className="text-[28px] font-bold leading-none" fracClassName="text-[15px] font-bold" />,
      onClick: () => onToast('Q币充值暂未开放'),
    },
    { key: 'gift', label: '领福利', dot: true, node: <Gift className="h-8 w-8" strokeWidth={1.7} />, onClick: () => onToast('领福利暂未开放') },
    { key: 'loan', label: '微粒贷', dot: true, node: <CreditCard className="h-8 w-8" strokeWidth={1.7} />, onClick: () => onToast('微粒贷暂未开放') },
  ];

  const groups: { label: string; items: { label: string; color: string; icon: React.ReactNode; onClick: () => void }[] }[] = [
    {
      label: '金融理财',
      items: [
        { label: '小金库', color: '#F5A623', icon: <PiggyBank className="h-[26px] w-[26px]" strokeWidth={1.8} />, onClick: onOpenVault },
        { label: '申信用卡', color: '#F0605C', icon: <CreditCard className="h-[26px] w-[26px]" strokeWidth={1.8} />, onClick: () => onToast('申信用卡暂未开放') },
        { label: '还信用卡', color: '#2FBF71', icon: <Landmark className="h-[26px] w-[26px]" strokeWidth={1.8} />, onClick: () => onToast('还信用卡暂未开放') },
      ],
    },
    {
      label: '游戏娱乐',
      items: [
        { label: '游戏充值', color: '#2FBF71', icon: <Gamepad2 className="h-[26px] w-[26px]" strokeWidth={1.8} />, onClick: () => onToast('游戏充值暂未开放') },
        { label: '会员充值', color: '#F5A623', icon: <Gem className="h-[26px] w-[26px]" strokeWidth={1.8} />, onClick: () => onToast('会员充值暂未开放') },
        { label: '鹅毛市集', color: '#3BA0FF', icon: <Feather className="h-[26px] w-[26px]" strokeWidth={1.8} />, onClick: () => onToast('鹅毛市集暂未开放') },
        { label: '游戏赚Q币', color: '#F5A623', icon: <BellRing className="h-[26px] w-[26px]" strokeWidth={1.8} />, onClick: () => onToast('游戏赚Q币暂未开放') },
      ],
    },
    {
      label: '生活服务',
      items: [
        { label: '手机充值', color: '#F5A623', icon: <Smartphone className="h-[26px] w-[26px]" strokeWidth={1.8} />, onClick: () => onToast('手机充值暂未开放') },
        { label: '高校权益', color: '#3BA0FF', icon: <GraduationCap className="h-[26px] w-[26px]" strokeWidth={1.8} />, onClick: () => onToast('高校权益暂未开放') },
        { label: '火车票机票', color: '#2FBF71', icon: <Bus className="h-[26px] w-[26px]" strokeWidth={1.8} />, onClick: () => onToast('火车票机票暂未开放') },
        { label: '猫眼电影', color: '#F0605C', icon: <Cat className="h-[26px] w-[26px]" strokeWidth={1.8} />, onClick: () => onToast('猫眼电影暂未开放') },
        { label: '腾讯公益', color: '#F0605C', icon: <Flower2 className="h-[26px] w-[26px]" strokeWidth={1.8} />, onClick: () => onToast('腾讯公益暂未开放') },
      ],
    },
  ];

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[#F5F6F8] dark:bg-[#16171A]">
      {/* 蓝色头部：导航 + 四宫格（余额/Q币 数字、领福利/微粒贷 图标带红点） */}
      <div className="shrink-0 bg-gradient-to-b from-[#2CB3F8] to-[#1B9FF0] px-4 pb-8 pt-[54px]">
        <div className="relative flex h-10 items-center text-white">
          <button type="button" aria-label="返回" data-testid="qq-wallet-back" onClick={onBack} className="grid h-9 w-9 place-items-center rounded-full text-white/95 active:bg-white/15">
            <ChevronLeft className="h-[22px] w-[22px]" strokeWidth={2.4} />
          </button>
          <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 text-[18px] font-medium">QQ钱包</span>
          <div className="ml-auto flex items-center gap-1">
            <button type="button" aria-label="收付款" onClick={() => onToast('收付款暂未开放')} className="grid h-9 w-9 place-items-center rounded-full text-white/95 active:bg-white/15">
              <QrCode className="h-[21px] w-[21px]" strokeWidth={1.9} />
            </button>
            <button type="button" aria-label="支付设置" onClick={onOpenPaySettings} className="grid h-9 w-9 place-items-center rounded-full text-white/95 active:bg-white/15">
              <Settings className="h-[21px] w-[21px]" strokeWidth={1.9} />
            </button>
          </div>
        </div>
        <div className="grid grid-cols-4 pt-7">
          {topCells.map((c) => (
            <button key={c.key} type="button" data-testid={`qq-wallet-cell-${c.key}`} onClick={c.onClick} className="flex flex-col items-center gap-2.5 text-white active:opacity-70">
              {c.key === 'gift' || c.key === 'loan' ? (
                <span className="relative grid h-9 place-items-center">
                  {c.node}
                  {c.dot && <span className="absolute -right-1.5 -top-1 h-2.5 w-2.5 rounded-full bg-[#F5455C]" aria-hidden="true" />}
                </span>
              ) : (
                <span className="grid h-9 place-items-center">{c.node}</span>
              )}
              <span className="text-[15px]">{c.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 白色圆角主区（叠压蓝底）：三分区彩色描边宫格 */}
      <div className="relative -mt-5 flex-1 overflow-y-auto rounded-t-[20px] bg-white px-4 pb-8 dark:bg-[#1B1C1F]">
        {groups.map((g) => (
          <section key={g.label}>
            <p className="px-1 pb-1 pt-5 text-[13px] text-black/40 dark:text-white/40">{g.label}</p>
            <div className="grid grid-cols-4 gap-y-6 pt-3">
              {g.items.map((item) => (
                <button key={item.label} type="button" onClick={item.onClick} className="flex flex-col items-center gap-2 active:opacity-60">
                  <span className="grid h-11 w-11 place-items-center" style={{ color: item.color }} aria-hidden="true">
                    {item.icon}
                  </span>
                  <span className="text-[14px] text-[#1F2329] dark:text-white">{item.label}</span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

/** 余额页（对照截图②：蓝渐变 + 大白卡余额 + 转到微信/微信转入 + 充值/提现/银行卡列表 + 支付设置/财付通页脚） */
export function BalancePage({
  wallet,
  cards,
  onBack,
  onToast,
  onOpenTopUp,
  onOpenWithdraw,
  onOpenCards,
  onOpenBills,
  onOpenPaySettings,
}: {
  wallet: WalletData;
  cards: BankCard[];
  onBack: () => void;
  onToast: (m: string) => void;
  onOpenTopUp: () => void;
  onOpenWithdraw: () => void;
  onOpenCards: () => void;
  onOpenBills: () => void;
  onOpenPaySettings: () => void;
}) {
  const rows = [
    { key: 'topup', label: '充值', sub: undefined as string | undefined, icon: <PiggyBank className="h-[22px] w-[22px]" strokeWidth={1.8} />, color: '#F5A623', onClick: onOpenTopUp },
    { key: 'withdraw', label: '提现', sub: undefined as string | undefined, icon: <Banknote className="h-[22px] w-[22px]" strokeWidth={1.8} />, color: '#1F2329', onClick: onOpenWithdraw },
    { key: 'cards', label: '银行卡', sub: cards.length > 0 ? `已绑定 ${cards.length} 张` : '添加银行卡', icon: <Landmark className="h-[22px] w-[22px]" strokeWidth={1.8} />, color: '#1F2329', onClick: onOpenCards },
  ];
  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-gradient-to-b from-[#1B9FF0] via-[#9FD4F8] to-[#F5F6F8] pt-[54px] dark:from-[#0F5E97] dark:via-[#14486E] dark:to-[#16171A]">
      <WalletNavHeader title="余额" tone="blue" onBack={onBack} right={
        <button type="button" data-testid="qq-wallet-bills" onClick={onOpenBills} className="ml-auto mr-1 text-[16px] text-white active:opacity-60">账单</button>
      } />
      <div className="flex-1 overflow-y-auto px-4 pb-8">
        <div className="mt-2 rounded-[16px] bg-white px-6 pb-8 pt-8 dark:bg-[#232529]">
          <p className="text-center text-[15px] text-black/55 dark:text-white/55">可用余额 (元)</p>
          <div className="mt-2 text-center text-[#1F2329] dark:text-white">
            <MoneyDigits value={wallet.balance} className="text-[54px] font-semibold leading-tight tracking-tight" fracClassName="text-[28px] font-semibold" />
          </div>
          <div className="mt-8 flex flex-col items-center gap-3">
            <button type="button" data-testid="qq-wallet-to-wx" onClick={() => onToast('请先安装微信')} className="h-11 w-[210px] rounded-full bg-[#1B9FF0] text-[16px] font-medium text-white active:opacity-85">转到微信</button>
            <button type="button" onClick={() => onToast('微信转入暂未开放')} className="h-11 w-[210px] rounded-full border border-black/15 text-[16px] text-[#1F2329] active:opacity-60 dark:border-white/20 dark:text-white">微信转入</button>
          </div>
        </div>

        <div className="mt-4 overflow-hidden rounded-[16px] bg-white dark:bg-[#232529]">
          {rows.map((r, i) => (
            <button key={r.key} type="button" data-testid={`qq-wallet-row-${r.key}`} onClick={r.onClick} className={`flex h-14 w-full items-center gap-3 px-4 text-left active:bg-black/[0.03] dark:active:bg-white/[0.05] ${i > 0 ? 'border-t border-black/[0.04] dark:border-white/[0.05]' : ''}`}>
              <span className="grid h-6 w-6 shrink-0 place-items-center" style={{ color: r.color }} aria-hidden="true">
                {r.icon}
              </span>
              <span className="flex-1 text-[16px] text-[#1F2329] dark:text-white">
                {r.label}
                {r.sub ? <span className="ml-2 text-[12px] text-black/35 dark:text-white/35">{r.sub}</span> : null}
              </span>
              <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
            </button>
          ))}
        </div>

        <div className="mt-9 text-center">
          <p className="text-[14px] text-[#1B9FF0]">
            <button type="button" onClick={() => onToast('身份信息暂未开放')}>身份信息</button>
            <span className="mx-2 text-black/20 dark:text-white/25" aria-hidden="true">|</span>
            <button type="button" data-testid="qq-pay-settings" onClick={onOpenPaySettings}>支付设置</button>
          </p>
          <p className="mt-2.5 text-[12px] text-black/35 dark:text-white/35">本服务由财付通提供</p>
        </div>
      </div>
    </div>
  );
}

/** 小金库转入/转出金额弹层（半屏底部面板） */
export function VaultAmountSheet({ mode, max, onClose, onConfirm }: { mode: 'in' | 'out'; max: number; onClose: () => void; onConfirm: (n: number) => void }) {
  const [val, setVal] = useState('');
  const num = Math.round((parseFloat(val) || 0) * 100) / 100;
  const ok = num > 0 && num <= max;
  return (
    <div className="absolute inset-0 z-50 flex flex-col justify-end bg-black/45" role="dialog" aria-label={mode === 'in' ? '转入小金库' : '转出小金库'} onClick={onClose}>
      <div className="rounded-t-[18px] bg-white px-5 pb-9 pt-5 dark:bg-[#1B1C1F]" onClick={(e) => e.stopPropagation()}>
        <p className="text-[17px] font-semibold text-[#1F2329] dark:text-white">{mode === 'in' ? '转入小金库' : '转出小金库'}</p>
        <div className="mt-4 flex items-center gap-2 border-b border-black/10 pb-3 dark:border-white/15">
          <span className="text-[28px] font-medium text-[#1F2329] dark:text-white" aria-hidden="true">¥</span>
          <input
            value={val}
            autoFocus
            inputMode="decimal"
            onChange={(e) => setVal(sanitizeAmount(e.target.value))}
            placeholder="0.00"
            aria-label="金额"
            data-testid="qq-vault-amount-input"
            className="w-full bg-transparent text-[28px] font-medium text-[#1F2329] outline-none placeholder:text-black/25 dark:text-white dark:placeholder:text-white/25"
          />
        </div>
        <p className="mt-3 text-[13px] text-black/45 dark:text-white/45">
          {mode === 'in' ? `余额可用 ${fmtMoney(max)} 元` : `小金库可用 ${fmtMoney(max)} 元`}
          <button type="button" className="ml-2 text-[#B8803F]" onClick={() => setVal(max.toFixed(2))}>
            {mode === 'in' ? '全部转入' : '全部转出'}
          </button>
        </p>
        <button
          type="button"
          disabled={!ok}
          data-testid="qq-vault-amount-ok"
          onClick={() => ok && onConfirm(num)}
          className={`mt-6 h-12 w-full rounded-[12px] text-[16px] font-medium text-white ${ok ? 'bg-gradient-to-r from-[#C99B58] to-[#D9B27C] active:opacity-85' : 'bg-[#E4CEA4]'}`}
        >
          确定
        </button>
      </div>
    </div>
  );
}

/** 小金库收益详情页（金色渐变累计收益卡 + 产品利率 + 近7日柱状图 + 每日收益记录） */
export function VaultEarnPage({ earn, onBack }: { earn: VaultEarnData; onBack: () => void }) {
  const todayKey = localDateKey();
  const entries = [...earn.log].sort((a, b) => (a.date < b.date ? 1 : -1));
  const total = round2(earn.log.reduce((s, e) => s + e.amount, 0));
  const today = earn.log.find((e) => e.date === todayKey)?.amount ?? 0;
  const yesterday = entries.find((e) => e.date !== todayKey)?.amount ?? 0;
  const last7 = earn.log.slice(-7);
  const max = Math.max(...last7.map((e) => e.amount), 0.0001);
  const dayLabel = (d: string): string => {
    const parts = d.split('-');
    return `${parts[1] ?? d}/${parts[2] ?? ''}`;
  };
  return (
    <div className="absolute inset-0 z-50 flex flex-col overflow-hidden bg-[#F6F4EF] pt-[54px] dark:bg-[#1B1A15]" data-testid="qq-vault-earn-page">
      <WalletNavHeader title="收益详情" onBack={onBack} />
      <div className="flex-1 overflow-y-auto px-4 pb-8">
        {/* 累计收益金卡 */}
        <div className="mt-3 rounded-[16px] bg-gradient-to-br from-[#C99B58] to-[#D9B27C] px-5 pb-5 pt-5 text-white shadow-md shadow-black/10">
          <div className="flex items-center gap-1.5 text-[14px] text-white/90">
            <TrendingUp className="h-4 w-4" aria-hidden="true" />
            累计收益 (元)
          </div>
          <p className="mt-1.5 text-[40px] font-bold leading-none tracking-tight" data-testid="qq-vault-earn-total">{fmtMoney(total)}</p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-[10px] bg-white/15 px-3 py-2.5">
              <p className="text-[12px] text-white/85">昨日收益</p>
              <p className="mt-1 text-[18px] font-semibold leading-none">{fmtMoney(yesterday)}</p>
            </div>
            <div className="rounded-[10px] bg-white/15 px-3 py-2.5">
              <p className="text-[12px] text-white/85">今日收益</p>
              <p className="mt-1 text-[18px] font-semibold leading-none">{fmtMoney(today)}</p>
            </div>
          </div>
        </div>
        {/* 产品与利率 */}
        <div className="mt-4 rounded-[16px] bg-white px-4 py-4 dark:bg-[#232529]">
          <div className="flex items-center justify-between">
            <p className="text-[15px] font-medium text-[#1F2329] dark:text-white">农银汇理红利日结货币A</p>
            <span className="rounded-full bg-[#C99B58]/15 px-2 py-1 text-[11px] text-[#B8803F] dark:bg-[#C99B58]/25 dark:text-[#D9AC6C]">货币基金 · 低风险</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="rounded-[10px] bg-black/[0.03] px-3 py-2.5 dark:bg-white/[0.06]">
              <p className="text-[12px] text-black/45 dark:text-white/45">最高七日年化</p>
              <p className="mt-1 text-[18px] font-semibold leading-none text-[#B8803F] dark:text-[#D9AC6C]">+{(VAULT_RATE * 100).toFixed(4)}%</p>
            </div>
            <div className="rounded-[10px] bg-black/[0.03] px-3 py-2.5 dark:bg-white/[0.06]">
              <p className="text-[12px] text-black/45 dark:text-white/45">万份收益(元)</p>
              <p className="mt-1 text-[18px] font-semibold leading-none text-[#1F2329] dark:text-white">{(10000 * VAULT_DAILY_RATE).toFixed(4)}</p>
            </div>
          </div>
          <p className="mt-3 text-[12px] leading-relaxed text-black/40 dark:text-white/40">收益 = 前一日小金库余额 × 七日年化利率 ÷ 365，每日自动结算发放。</p>
        </div>
        {/* 近7日柱状图 */}
        {last7.length > 0 ? (
          <div className="mt-4 rounded-[16px] bg-white px-4 py-4 dark:bg-[#232529]">
            <p className="text-[15px] font-medium text-[#1F2329] dark:text-white">近7日收益</p>
            <div className="mt-4 flex h-[110px] items-end gap-2.5">
              {last7.map((e) => (
                <div key={e.date} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                  <span className="text-[10px] text-black/45 dark:text-white/45">{e.amount > 0 ? e.amount.toFixed(2) : ''}</span>
                  <span className="w-full max-w-[26px] rounded-t-[6px] bg-gradient-to-t from-[#C99B58] to-[#EBCB96]" style={{ height: `${Math.max(6, (e.amount / max) * 82)}px` }} aria-hidden="true" />
                  <span className="text-[10px] text-black/40 dark:text-white/40">{dayLabel(e.date)}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {/* 每日收益记录 */}
        <div className="mt-4 rounded-[16px] bg-white px-4 py-2 dark:bg-[#232529]">
          <p className="border-b border-black/[0.04] py-2.5 text-[15px] font-medium text-[#1F2329] dark:border-white/[0.06] dark:text-white">收益记录</p>
          {entries.length === 0 ? (
            <p className="py-8 text-center text-[14px] text-black/35 dark:text-white/35">暂无收益，转入小金库后开始产生收益</p>
          ) : (
            entries.map((e, i) => (
              <div key={e.date} className={`flex h-[52px] items-center justify-between ${i > 0 ? 'border-t border-black/[0.04] dark:border-white/[0.06]' : ''}`}>
                <span className="text-[14px] text-black/55 dark:text-white/55">{e.date} 收益</span>
                <span className="text-[15px] font-medium text-[#B8803F] dark:text-[#D9AC6C]">+{fmtMoney(e.amount)}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/** 小金库页（对照截图③：金色渐变 + 攒钱还能享收益 + 余额/七日年化/累计收益 + 转入/转出 + 收益详情） */
export function VaultPage({
  wallet,
  onBack,
  onToast,
  onMove,
}: {
  wallet: WalletData;
  onBack: () => void;
  onToast: (m: string) => void;
  onMove: (mode: 'in' | 'out', n: number) => void;
}) {
  const [hidden, setHidden] = useState(false);
  const [sheet, setSheet] = useState<'in' | 'out' | null>(null);
  // 收益：每次进入小金库页时结算（同日幂返回缓存），累计/昨日收益持久化在 localStorage
  const [earn] = useState(() => settleVaultEarn(wallet.vault));
  const [earnOpen, setEarnOpen] = useState(false);
  const earnTotal = round2(earn.log.reduce((s, e) => s + e.amount, 0));
  const earnYesterday = earn.log.length >= 2 ? earn.log[earn.log.length - 2].amount : 0;
  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-gradient-to-b from-[#EDD8B9] via-[#F4E8D5] to-[#F5F6F8] pt-[54px] dark:from-[#3A3222] dark:via-[#2C271D] dark:to-[#16171A]">
      {/* 整页滚动：小金库导航头部随内容一起滚动，不再固定 */}
      <div className="flex-1 overflow-y-auto">
      <WalletNavHeader
        title="小金库"
        tone="gold"
        onBack={onBack}
        right={
          <button type="button" aria-label="更多" onClick={() => onToast('更多暂未开放')} className="ml-auto mr-1 grid h-9 w-9 place-items-center rounded-full text-white/95 active:bg-white/15">
            <MoreHorizontal className="h-[22px] w-[22px]" strokeWidth={2} />
          </button>
        }
      />
      <div className="px-4 pb-8">
        <h1 className="mt-4 flex items-start text-[32px] font-black leading-tight">
          <span className="bg-gradient-to-r from-[#A9702E] via-[#D6A45E] to-[#B8803F] bg-clip-text text-transparent dark:from-[#D9AC6C] dark:via-[#EBCB96] dark:to-[#D2A365]">攒钱还能享收益</span>
          <Sparkles className="ml-1 mt-0.5 h-4 w-4 shrink-0 text-white/90 dark:text-[#EBCB96]" aria-hidden="true" />
        </h1>
        <div className="mt-3.5 flex h-9 items-center gap-1.5 rounded-full bg-[#8A6A3F]/15 px-3 text-[13px] text-[#7A5C30] dark:bg-[#8A6A3F]/25 dark:text-[#E3C893]">
          <Volume2 className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="truncate">利率下行，闲钱躺卡每日贬值，试试理财享收益</span>
        </div>

        <div className="mt-4 rounded-[16px] bg-white px-6 pb-6 pt-7 dark:bg-[#232529]">
          <div className="flex items-center justify-center gap-1.5 text-[15px] text-black/55 dark:text-white/55">
            账户余额(元)
            <button type="button" aria-label={hidden ? '显示余额' : '隐藏余额'} data-testid="qq-vault-eye" onClick={() => setHidden(!hidden)} className="active:opacity-60">
              {hidden ? <EyeOff className="h-4.5 w-4.5" strokeWidth={1.8} /> : <Eye className="h-4.5 w-4.5" strokeWidth={1.8} />}
            </button>
          </div>
          <p className="mt-2 text-center text-[48px] font-semibold leading-tight text-[#1F2329] dark:text-white" data-testid="qq-vault-balance">
            {hidden ? '****' : fmtMoney(wallet.vault)}
          </p>
          <p className="mt-1 flex items-center justify-center gap-1 text-[13px] text-[#B8803F] dark:text-[#D9AC6C]">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            资金安全保障中
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          </p>

          <div className="mt-8 grid grid-cols-2 gap-4 text-[#1F2329] dark:text-white">
            <div>
              <button type="button" onClick={() => onToast('产品详情暂未开放')} className="flex items-center text-[14px] text-black/50 dark:text-white/50">
                最高七日年化
                <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <p className="mt-2 text-[24px] font-semibold leading-none">+1.5120%</p>
              <span className="mt-2.5 inline-block max-w-full truncate rounded bg-black/[0.04] px-1.5 py-1 text-[11px] text-black/45 dark:bg-white/[0.08] dark:text-white/45">农银汇理红利日结货币A</span>
            </div>
            <div>
              <button type="button" data-testid="qq-vault-earn-total" onClick={() => setEarnOpen(true)} className="flex items-center text-[14px] text-black/50 dark:text-white/50">
                累计收益(元)
                <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <p className="mt-2 text-[24px] font-semibold leading-none">{fmtMoney(earnTotal)}</p>
              <span className="mt-2.5 inline-block rounded bg-black/[0.04] px-1.5 py-1 text-[11px] text-black/45 dark:bg-white/[0.08] dark:text-white/45">昨日: {fmtMoney(earnYesterday)}</span>
            </div>
          </div>

          <div className="mt-8 flex flex-col gap-3.5">
            <button type="button" data-testid="qq-vault-in" onClick={() => setSheet('in')} className="h-12 w-full rounded-[12px] bg-gradient-to-r from-[#C99B58] to-[#D9B27C] text-[16px] font-medium text-white active:opacity-85">转入</button>
            <button type="button" data-testid="qq-vault-out" onClick={() => setSheet('out')} className="h-12 w-full rounded-[12px] border border-[#C9A063] text-[16px] font-medium text-[#B8803F] active:opacity-60 dark:text-[#D9AC6C]">转出</button>
          </div>

          <div className="mt-7 flex items-center gap-2 border-t border-black/[0.06] pt-4 text-[13px] text-black/45 dark:border-white/[0.08] dark:text-white/45">
            了解更多
            <span className="rounded bg-black/[0.04] px-2 py-1.5 text-[12px] dark:bg-white/[0.08]">资金安全有保障吗?</span>
            <button type="button" onClick={() => onToast('更多暂未开放')} className="ml-auto flex items-center text-[#B8803F] dark:text-[#D9AC6C]">
              更多
              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>

        <p className="mt-5 text-center text-[12px] text-black/35 dark:text-white/35">基金销售服务由腾安基金销售（深圳）有限公司提供</p>
      </div>
      </div>

      {sheet && (
        <VaultAmountSheet
          mode={sheet}
          max={sheet === 'in' ? wallet.balance : wallet.vault}
          onClose={() => setSheet(null)}
          onConfirm={(n) => {
            onMove(sheet, n);
            setSheet(null);
          }}
        />
      )}
      {/* 收益详情（全屏浮层） */}
      {earnOpen ? <VaultEarnPage earn={earn} onBack={() => setEarnOpen(false)} /> : null}
    </div>
  );
}

/** 银行卡视觉组件（列表/详情复用：真实银行卡 85.6:54 比例 + 银行品牌渐变 + 圆标 + 金色芯片 + 闪付波纹） */
export function BankCardVisual({ card, className = '' }: { card: BankCard; className?: string }) {
  const meta = BANK_META[card.bank] ?? BANK_FALLBACK;
  return (
    <div
      className={`relative overflow-hidden rounded-[16px] shadow-lg shadow-black/15 ${className}`}
      style={{ backgroundImage: `linear-gradient(135deg, ${meta.from}, ${meta.to})` }}
    >
      {/* 高光装饰 */}
      <span className="pointer-events-none absolute -right-10 -top-16 h-40 w-40 rounded-full bg-white/10" aria-hidden="true" />
      <span className="pointer-events-none absolute -right-20 top-10 h-28 w-28 rounded-full bg-white/[0.07]" aria-hidden="true" />
      <div className="relative flex h-full flex-col justify-between p-4">
        {/* 银行圆标 + 名称 + 卡类型 */}
        <div className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/25 text-[15px] font-semibold text-white backdrop-blur-sm" aria-hidden="true">
            {card.bank.slice(0, 1)}
          </span>
          <span className="truncate text-[16px] font-semibold text-white">{card.bank}</span>
          <span className="ml-auto shrink-0 rounded-full bg-white/20 px-2.5 py-0.5 text-[11px] leading-4 text-white/95">{card.type ?? '储蓄卡'}</span>
        </div>
        {/* 金色芯片 + 闪付波纹 */}
        <div className="mt-2 flex items-center gap-2.5">
          <span className="relative h-7 w-10 shrink-0 overflow-hidden rounded-[5px] bg-gradient-to-br from-[#F3D47C] to-[#C9962E]" aria-hidden="true">
            <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-black/15" />
            <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-black/15" />
          </span>
          <svg viewBox="0 0 24 24" className="h-6 w-6 text-white/80" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
            <path d="M7 9a7.5 7.5 0 0 1 0 6" />
            <path d="M11 6.8a11.5 11.5 0 0 1 0 10.4" />
            <path d="M15 4.6a15.5 15.5 0 0 1 0 14.8" />
          </svg>
        </div>
        {/* 卡号 + 持卡人 + 卡内金额 */}
        <div>
          <p className="text-[17px] font-medium tracking-[0.1em] text-white [font-variant-numeric:tabular-nums]">{formatCardNo(card)}</p>
          <div className="mt-2 flex items-end justify-between gap-2">
            <p className="truncate text-[12px] text-white/85">持卡人 {card.holder}</p>
            {typeof card.balance === 'number' ? <p className="shrink-0 text-[12px] font-medium text-white/95">¥{fmtMoney(card.balance)}</p> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/** 我的银行卡页（空状态收纳盒 + 添加按钮；有卡时品牌渐变卡列表，点击卡片进详情） */
export function BankCardsPage({ cards, onBack, onToast, onAdd, onOpenCard }: { cards: BankCard[]; onBack: () => void; onToast: (m: string) => void; onAdd: () => void; onOpenCard: (c: BankCard) => void }) {
  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[#F5F6F8] pt-[54px] dark:bg-[#16171A]">
      <WalletNavHeader
        title="我的银行卡"
        onBack={onBack}
        right={
          <button type="button" aria-label="更多" onClick={() => onToast('更多暂未开放')} className="ml-auto mr-1 grid h-9 w-9 place-items-center rounded-full text-black/45 active:bg-black/5 dark:text-white/50 dark:active:bg-white/10">
            <MoreHorizontal className="h-[22px] w-[22px]" strokeWidth={2} />
          </button>
        }
      />
      <div className="relative flex-1 overflow-y-auto px-4 pb-4">
        {cards.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-6 pb-10">
            <span className="grid h-[118px] w-[118px] place-items-center rounded-full border-[3px] border-black/65 dark:border-white/65" aria-hidden="true">
              <Inbox className="h-12 w-12" strokeWidth={1.5} />
            </span>
            <p className="text-[19px] text-[#1F2329] dark:text-white">暂未绑定银行卡</p>
          </div>
        ) : (
          <div className="mt-4 flex flex-col gap-4">
            {cards.map((c) => (
              <button key={c.id} type="button" data-testid="qq-bank-card-item" onClick={() => onOpenCard(c)} className="block w-full text-left transition-transform active:scale-[0.985]">
                <BankCardVisual card={c} className="aspect-[85.6/54] w-full" />
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="shrink-0 px-4 pb-[30px] pt-2">
        <button type="button" data-testid="qq-wallet-addcard" onClick={onAdd} className="h-12 w-full rounded-full bg-[#1B9FF0] text-[16px] font-medium text-white active:opacity-85">添加银行卡</button>
      </div>
    </div>
  );
}

/** 添加银行卡（持卡人预填 QQ 昵称 + 卡号一键生成[Luhn 校验，BIN 跟随银行] + 自定义卡内金额 + 卡类型；仅存本机 localStorage） */
export function AddCardPage({ defaultHolder, onBack, onSave }: { defaultHolder: string; onBack: () => void; onSave: (c: Omit<BankCard, 'id'>) => void }) {
  const [holder, setHolder] = useState(defaultHolder);
  const [no, setNo] = useState('');
  const [amt, setAmt] = useState('');
  const [bank, setBank] = useState('工商银行');
  const [type, setType] = useState('储蓄卡');
  const noDigits = no.replace(/\s/g, '');
  const balance = Math.round((parseFloat(amt) || 0) * 100) / 100;
  const ok = holder.trim().length > 0 && /^\d{15,19}$/.test(noDigits);
  const banks = Object.keys(BANK_META);
  const gen = () => {
    const raw = genCardNo(bank, type);
    setNo(raw.replace(/(\d{4})(?=\d)/g, '$1 '));
  };
  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[#F5F6F8] pt-[54px] dark:bg-[#16171A]">
      <WalletNavHeader title="添加银行卡" onBack={onBack} />
      <div className="flex-1 overflow-y-auto px-4 pt-3">
        <div className="overflow-hidden rounded-[14px] bg-white dark:bg-[#232529]">
          <div className="border-b border-black/[0.04] px-4 py-3 dark:border-white/[0.06]">
            <p className="text-[12px] text-black/40 dark:text-white/40">持卡人</p>
            <input value={holder} onChange={(e) => setHolder(e.target.value.slice(0, 20))} placeholder="请输入持卡人姓名" aria-label="持卡人姓名" data-testid="qq-card-holder" className="mt-1 h-7 w-full bg-transparent text-[16px] text-[#1F2329] outline-none placeholder:text-black/25 dark:text-white dark:placeholder:text-white/25" />
          </div>
          <div className="border-b border-black/[0.04] px-4 py-3 dark:border-white/[0.06]">
            <p className="text-[12px] text-black/40 dark:text-white/40">银行卡号</p>
            <div className="mt-1 flex items-center gap-2">
              <input
                value={no}
                inputMode="numeric"
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, '').slice(0, 19);
                  setNo(digits.replace(/(\d{4})(?=\d)/g, '$1 ').trim());
                }}
                placeholder="请输入或点击生成"
                aria-label="银行卡号"
                data-testid="qq-card-no"
                className="h-7 min-w-0 flex-1 bg-transparent text-[16px] tracking-wider text-[#1F2329] outline-none placeholder:text-black/25 dark:text-white dark:placeholder:text-white/25"
              />
              <button type="button" data-testid="qq-card-gen" onClick={gen} className="h-8 shrink-0 rounded-full bg-[#E8F6FF] px-3.5 text-[13px] font-medium text-[#1B9FF0] active:opacity-60 dark:bg-[#17324A]">
                生成卡号
              </button>
            </div>
          </div>
          <div className="px-4 py-3">
            <p className="text-[12px] text-black/40 dark:text-white/40">卡内金额（元）</p>
            <div className="mt-1 flex items-center gap-1">
              <span className="text-[16px] font-medium text-[#1F2329] dark:text-white" aria-hidden="true">¥</span>
              <input
                value={amt}
                inputMode="decimal"
                onChange={(e) => setAmt(sanitizeAmount(e.target.value))}
                placeholder="0.00"
                aria-label="卡内金额"
                data-testid="qq-card-amt"
                className="h-7 w-full bg-transparent text-[16px] text-[#1F2329] outline-none placeholder:text-black/25 dark:text-white dark:placeholder:text-white/25"
              />
            </div>
          </div>
        </div>
        <p className="px-1 pt-4 text-[13px] text-black/40 dark:text-white/40">卡类型</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {['储蓄卡', '信用卡'].map((t) => (
            <button key={t} type="button" data-testid={`qq-card-type-${t}`} onClick={() => setType(t)} className={`h-9 rounded-full px-4 text-[13px] ${type === t ? 'bg-[#1B9FF0] text-white' : 'bg-white text-[#1F2329] active:opacity-60 dark:bg-[#232529] dark:text-white'}`}>
              {t}
            </button>
          ))}
        </div>
        <p className="px-1 pt-4 text-[13px] text-black/40 dark:text-white/40">选择银行</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {banks.map((b) => (
            <button key={b} type="button" onClick={() => setBank(b)} className={`h-9 rounded-full px-3.5 text-[13px] ${bank === b ? 'bg-[#1B9FF0] text-white' : 'bg-white text-[#1F2329] active:opacity-60 dark:bg-[#232529] dark:text-white'}`}>
              {b}
            </button>
          ))}
        </div>
        <p className="px-1 pt-4 text-[12px] leading-relaxed text-black/35 dark:text-white/35">卡号由本机随机生成（符合 Luhn 校验），金额自定义；银行卡信息仅保存在本机浏览器（localStorage），不会上传到任何服务器。</p>
      </div>
      <div className="px-4 pb-[30px] pt-3">
        <button
          type="button"
          disabled={!ok}
          data-testid="qq-card-save"
          onClick={() => {
            if (!ok) return;
            onSave({ holder: holder.trim(), last4: noDigits.slice(-4), bank, no: noDigits, balance, type, createdAt: Date.now() });
          }}
          className={`h-12 w-full rounded-full text-[16px] font-medium text-white ${ok ? 'bg-[#1B9FF0] active:opacity-85' : 'bg-[#9FD6FA]'}`}
        >
          确定
        </button>
      </div>
    </div>
  );
}

/** 银行卡详情页（点击列表卡片进入：大卡视觉 + 卡内余额 + 持卡人/卡号/银行/类型/时间信息 + 解除绑定） */
export function CardDetailPage({ card, onBack, onToast, onUnbind }: { card: BankCard; onBack: () => void; onToast: (m: string) => void; onUnbind: () => void }) {
  // 两步确认解绑：第一次点击变红提示，3 秒内再点确认（避免误触）
  const [armed, setArmed] = useState(false);
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (armTimer.current) clearTimeout(armTimer.current);
    },
    []
  );
  const tapUnbind = () => {
    if (armed) {
      onUnbind();
      return;
    }
    setArmed(true);
    if (armTimer.current) clearTimeout(armTimer.current);
    armTimer.current = setTimeout(() => setArmed(false), 3000);
  };
  const rows: Array<{ k: string; v: React.ReactNode }> = [
    { k: '卡类型', v: card.type ?? '储蓄卡' },
    { k: '持卡人', v: card.holder },
    { k: '所属银行', v: card.bank },
    { k: '银行卡号', v: <span className="tracking-wider">{formatCardNo(card)}</span> },
  ];
  const fmtTime = (ts: number): string => new Date(ts).toLocaleString('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[#F5F6F8] pt-[54px] dark:bg-[#16171A]">
      <WalletNavHeader title="银行卡详情" onBack={onBack} />
      <div className="flex-1 overflow-y-auto px-4 pb-6 pt-4">
        <BankCardVisual card={card} className="aspect-[85.6/54] w-full" />
        <div className="mt-4 overflow-hidden rounded-[14px] bg-white dark:bg-[#232529]">
          <div className="border-b border-black/[0.04] px-4 pb-4 pt-5 text-center dark:border-white/[0.06]">
            <p className="text-[13px] text-black/40 dark:text-white/40">卡内余额 (元)</p>
            <div className="mt-1 text-[#1F2329] dark:text-white">
              <MoneyDigits value={card.balance ?? 0} className="text-[36px] font-semibold leading-tight tracking-tight" fracClassName="text-[19px] font-semibold" />
            </div>
          </div>
          {rows.map((r) => (
            <div key={r.k} className="flex min-h-[52px] items-center justify-between gap-3 border-b border-black/[0.04] px-4 py-2.5 last:border-b-0 dark:border-white/[0.06]">
              <span className="shrink-0 text-[15px] text-black/45 dark:text-white/45">{r.k}</span>
              <span className="min-w-0 truncate text-right text-[15px] text-[#1F2329] dark:text-white">{r.v}</span>
            </div>
          ))}
          {typeof card.createdAt === 'number' ? (
            <div className="flex min-h-[52px] items-center justify-between gap-3 px-4 py-2.5">
              <span className="shrink-0 text-[15px] text-black/45 dark:text-white/45">添加时间</span>
              <span className="text-right text-[15px] text-[#1F2329] dark:text-white">{fmtTime(card.createdAt)}</span>
            </div>
          ) : null}
        </div>
        <button
          type="button"
          data-testid="qq-card-unbind"
          onClick={tapUnbind}
          className={`mt-5 h-12 w-full rounded-full text-[16px] font-medium text-white active:opacity-85 ${armed ? 'bg-[#D6453C]' : 'bg-[#FA5151]/85'}`}
        >
          {armed ? '再点一次确认解除绑定' : '解除绑定'}
        </button>
        <p className="px-1 pt-4 text-[12px] leading-relaxed text-black/35 dark:text-white/35">银行卡信息仅保存在本机浏览器（localStorage），不会上传到任何服务器。</p>
      </div>
    </div>
  );
}

/** 提现页：余额转到银行卡（可选到账卡，扣钱包余额入卡） */
export function WithdrawPage({ wallet, cards, onBack, onToast, onSubmit }: { wallet: WalletData; cards: BankCard[]; onBack: () => void; onToast: (m: string) => void; onSubmit: (cardId: string, n: number) => void }) {
  const [val, setVal] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [cardId, setCardId] = useState<string | null>(cards[0]?.id ?? null);
  const card = cards.find((c) => c.id === cardId) ?? null;
  const num = Math.round((parseFloat(val) || 0) * 100) / 100;
  const ok = num > 0 && num <= wallet.balance && card !== null;
  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-[#F5F6F8] pt-[54px] dark:bg-[#16171A]">
      <WalletNavHeader
        title="提现"
        onBack={onBack}
        right={
          <button type="button" aria-label="更多" onClick={() => onToast('更多暂未开放')} className="ml-auto mr-1 grid h-9 w-9 place-items-center rounded-full text-black/45 active:bg-black/5 dark:text-white/50 dark:active:bg-white/10">
            <MoreHorizontal className="h-[22px] w-[22px]" strokeWidth={2} />
          </button>
        }
      />
      <div className="flex-1 overflow-y-auto px-4 pt-3">
        <button
          type="button"
          data-testid="qq-withdraw-card"
          className="flex w-full items-center px-1 py-2.5 text-[#1F2329] active:opacity-60 dark:text-white"
          onClick={() => (cards.length > 0 ? setPickerOpen(true) : onToast('请先在银行卡页添加银行卡'))}
        >
          <span className="text-[16px]">到账银行卡</span>
          {card ? (
            <span className="ml-9 flex items-center gap-2 text-[16px] font-semibold">
              {card.bank}
              <span className="text-[14px] font-normal text-black/40 dark:text-white/40">（尾号{card.last4}）</span>
            </span>
          ) : (
            <span className="ml-9 text-[16px] font-semibold">请先添加银行卡</span>
          )}
          <ChevronRight className="ml-auto h-5 w-5 shrink-0 text-black/30 dark:text-white/30" aria-hidden="true" />
        </button>
        <div className="mt-1.5 rounded-[14px] bg-white px-5 pb-5 pt-4 dark:bg-[#232529]">
          <p className="text-[17px] text-[#1F2329] dark:text-white">提现金额</p>
          <div className="mt-3 flex items-center gap-2 border-b border-black/[0.08] pb-4 dark:border-white/10">
            <span className="text-[30px] font-medium text-[#1F2329] dark:text-white" aria-hidden="true">¥</span>
            <input
              value={val}
              inputMode="decimal"
              onChange={(e) => setVal(sanitizeAmount(e.target.value))}
              placeholder=""
              aria-label="提现金额"
              data-testid="qq-withdraw-amount"
              className="w-full bg-transparent text-[30px] font-medium text-[#1F2329] outline-none dark:text-white"
            />
          </div>
          <p className="mt-3.5 text-[14px] text-black/40 dark:text-white/40">
            当前钱包余额{fmtMoney(wallet.balance)}元，
            <button type="button" data-testid="qq-withdraw-all" onClick={() => setVal(wallet.balance.toFixed(2))} className="text-[#1B9FF0]">
              全部提现
            </button>
          </p>
        </div>
      </div>
      <div className="px-4 pb-[30px] pt-3">
        <button
          type="button"
          disabled={!ok}
          data-testid="qq-withdraw-ok"
          onClick={() => {
            if (!ok || !card) return;
            onSubmit(card.id, num);
          }}
          className={`mx-auto block h-12 w-[220px] rounded-full text-[16px] font-medium text-white ${ok ? 'bg-[#1B9FF0] active:opacity-85' : 'bg-[#9FD6FA]'}`}
        >
          确定
        </button>
      </div>
      {pickerOpen ? (
        <CardPickerSheet
          title="选择到账银行卡"
          cards={cards}
          selectedId={cardId}
          onClose={() => setPickerOpen(false)}
          onPick={(c) => {
            setCardId(c.id);
            setPickerOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

/** 银行卡选择底部弹层（充值选付款卡 / 提现选到账卡） */
export function CardPickerSheet({ title, cards, selectedId, onClose, onPick }: { title: string; cards: BankCard[]; selectedId: string | null; onClose: () => void; onPick: (c: BankCard) => void }) {
  return (
    <div className="absolute inset-0 z-50 flex flex-col justify-end bg-black/45" role="dialog" aria-label={title} onClick={onClose}>
      <div className="rounded-t-[18px] bg-white px-4 pb-8 pt-3 dark:bg-[#232529]" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-black/15 dark:bg-white/20" aria-hidden="true" />
        <p className="py-1 text-center text-[16px] font-medium text-[#1F2329] dark:text-white">{title}</p>
        <div className="mt-1 max-h-[320px] overflow-y-auto">
          {cards.map((c) => {
            const meta = BANK_META[c.bank] ?? BANK_FALLBACK;
            return (
              <button key={c.id} type="button" data-testid={`qq-card-pick-${c.last4}`} onClick={() => onPick(c)} className="flex w-full items-center gap-3 rounded-[12px] px-2 py-3 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[15px] font-semibold text-white" style={{ backgroundImage: `linear-gradient(135deg, ${meta.from}, ${meta.to})` }} aria-hidden="true">
                  {c.bank.slice(0, 1)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] text-[#1F2329] dark:text-white">{c.bank} {c.type ?? '储蓄卡'}</span>
                  <span className="block text-[12px] text-black/40 dark:text-white/40">尾号{c.last4} · 余额 {fmtMoney(c.balance ?? 0)} 元</span>
                </span>
                {selectedId === c.id ? <Check className="h-5 w-5 shrink-0 text-[#1B9FF0]" strokeWidth={2.5} aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>
        <button type="button" onClick={onClose} className="mt-2 h-11 w-full rounded-full bg-black/[0.05] text-[15px] text-[#1F2329] active:opacity-70 dark:bg-white/10 dark:text-white">
          取消
        </button>
      </div>
    </div>
  );
}

/** 充值页：从银行卡转入余额（可选付款卡，扣卡内金额入钱包余额） */
export function TopUpPage({ cards, onBack, onToast, onCharge }: { cards: BankCard[]; onBack: () => void; onToast: (m: string) => void; onCharge: (cardId: string, n: number) => void }) {
  const [val, setVal] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [cardId, setCardId] = useState<string | null>(cards[0]?.id ?? null);
  const card = cards.find((c) => c.id === cardId) ?? null;
  const num = Math.round((parseFloat(val) || 0) * 100) / 100;
  const ok = num > 0 && card !== null;
  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-[#F5F6F8] pt-[54px] dark:bg-[#16171A]">
      <WalletNavHeader title="充值" onBack={onBack} />
      <div className="flex-1 overflow-y-auto px-4 pt-3">
        <button
          type="button"
          data-testid="qq-topup-card"
          className="flex w-full items-center px-1 py-2.5 text-[#1F2329] active:opacity-60 dark:text-white"
          onClick={() => (cards.length > 0 ? setPickerOpen(true) : onToast('请先在银行卡页添加银行卡'))}
        >
          <span className="text-[16px]">充值方式</span>
          {card ? (
            <span className="ml-9 flex items-center gap-2 text-[16px] font-semibold">
              {card.bank}
              <span className="text-[14px] font-normal text-black/40 dark:text-white/40">（尾号{card.last4} · {fmtMoney(card.balance ?? 0)}元）</span>
            </span>
          ) : (
            <span className="ml-9 text-[16px] font-semibold">请先添加银行卡</span>
          )}
          <ChevronRight className="ml-auto h-5 w-5 shrink-0 text-black/30 dark:text-white/30" aria-hidden="true" />
        </button>
        <div className="mt-1.5 rounded-[14px] bg-white px-5 pb-6 pt-4 dark:bg-[#232529]">
          <p className="text-[17px] text-[#1F2329] dark:text-white">充值金额</p>
          <div className="mt-3 flex items-center gap-2">
            <span className="text-[30px] font-medium text-[#1F2329] dark:text-white" aria-hidden="true">¥</span>
            <input
              value={val}
              inputMode="decimal"
              onChange={(e) => setVal(sanitizeAmount(e.target.value))}
              placeholder=""
              aria-label="充值金额"
              data-testid="qq-topup-amount"
              className="w-full bg-transparent text-[30px] font-medium text-[#1F2329] outline-none dark:text-white"
            />
          </div>
          {card ? <p className="mt-2 text-[13px] text-black/35 dark:text-white/35">从 {card.bank} 尾号{card.last4} 转入，卡内余额 {fmtMoney(card.balance ?? 0)} 元</p> : null}
        </div>
      </div>
      <div className="px-4 pb-[30px] pt-3">
        <button
          type="button"
          disabled={!ok}
          data-testid="qq-topup-ok"
          onClick={() => {
            if (!ok || !card) return;
            if (num > (card.balance ?? 0)) {
              onToast('卡内余额不足');
              return;
            }
            onCharge(card.id, num);
          }}
          className={`mx-auto block h-12 w-[220px] rounded-full text-[16px] font-medium text-white ${ok ? 'bg-[#1B9FF0] active:opacity-85' : 'bg-[#9FD6FA]'}`}
        >
          确定
        </button>
      </div>
      {pickerOpen ? (
        <CardPickerSheet
          title="选择付款银行卡"
          cards={cards}
          selectedId={cardId}
          onClose={() => setPickerOpen(false)}
          onPick={(c) => {
            setCardId(c.id);
            setPickerOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

/** 账单类型筛选（「选择账单类型」弹层 chips；消费/群收款/理财/代付/自动代付本机无数据源，选中即空） */
export const QQ_BILL_TYPES = ['全部', '红包', '转账', '消费', '充值', '提现', '群收款', '退款', '理财', '代付', '自动代付'] as const;
export type QQBillType = (typeof QQ_BILL_TYPES)[number];

/** 账单条目左侧圆形图标：红包=红色红包封；转账=对方头像（缺省蓝色箭头）；退款=绿色；充值/提现/小金库=各色 */
export function QQBillEntryIcon({ b }: { b: WalletBill }) {
  const kind = b.kind ?? (b.title.includes('红包') ? 'redpacket' : b.title.includes('转账') ? 'transfer' : b.title.includes('提现') ? 'withdraw' : b.title.includes('充值') || b.title.includes('Q币') ? 'topup' : b.title.includes('小金库') ? 'vault' : undefined);
  if (kind === 'redpacket') {
    return (
      <span className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-full bg-[#F25543]" aria-hidden="true">
        <svg viewBox="0 0 24 24" className="h-[24px] w-[24px]">
          <rect x="4.5" y="3" width="15" height="18" rx="2.4" fill="#fff" />
          <path d="M4.5 7.2c4.4 3.6 10.6 3.6 15 0" stroke="#F25543" strokeWidth="1.6" fill="none" strokeLinecap="round" />
          <circle cx="12" cy="11.6" r="1.8" fill="#F25543" />
        </svg>
      </span>
    );
  }
  if (kind === 'transfer' && b.avatar) {
    return b.avatar ? (
      <img src={b.avatar} alt="对方头像" className="h-[46px] w-[46px] shrink-0 rounded-full bg-black/[0.06] object-cover dark:bg-white/[0.08]" />
    ) : null;
  }
  const tone: Record<string, string> = { transfer: '#4D9CF8', topup: '#F7B500', withdraw: '#4D9CF8', vault: '#F7B500', refund: '#2FBF71' };
  const color = kind ? tone[kind] ?? '#8E8E93' : '#8E8E93';
  return (
    <span className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: `${color}22`, color }} aria-hidden="true">
      {kind === 'topup' || kind === 'vault' ? <QbGlyph /> : kind === 'refund' ? <Undo2 className="h-[20px] w-[20px]" strokeWidth={2} /> : <ArrowLeftRight className="h-[20px] w-[20px]" strokeWidth={2} />}
    </span>
  );
}

/** Q币小图标（黄色圆底白色 Q 币袋） */
export function QbGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-[22px] w-[22px]" aria-hidden="true">
      <path d="M7 4h10l2.2 4.4a7.6 7.6 0 1 1-14.4 0L7 4z" fill="#fff" />
      <text x="12" y="16.2" textAnchor="middle" fontSize="9" fontWeight="700" fill="#F7B500">
        Q
      </text>
    </svg>
  );
}

/** 账单明细页（余额页「账单」入口；对齐真机：月份/类型过滤栏 + 下载 + 按月分组列表 + 选择账单类型弹层） */
export function BillsPage({ bills, onBack, onToast }: { bills: WalletBill[]; onBack: () => void; onToast: (m: string) => void }) {
  const fmtTime = (ts: number): string => {
    const d = new Date(ts);
    return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  /** 类型过滤（点过滤栏「全部 ▾」弹出选择账单类型） */
  const [billType, setBillType] = useState<QQBillType>('全部');
  const [typeSheet, setTypeSheet] = useState(false);
  /** 月份过滤（'all'=全部；默认全部，下拉可切换，文案对齐真机显示最新月份） */
  const monthKeys = Array.from(new Set(bills.map((b) => `${new Date(b.ts).getFullYear()}-${new Date(b.ts).getMonth()}`))).sort((a, b) => b.localeCompare(a));
  const [month, setMonth] = useState<string>('all');
  const [monthSheet, setMonthSheet] = useState(false);

  const typeFilter = (b: WalletBill): boolean => {
    switch (billType) {
      case '全部':
        return true;
      case '红包':
        return b.kind === 'redpacket' || (!b.kind && b.title.includes('红包'));
      case '转账':
        return b.kind === 'transfer' || (!b.kind && b.title.includes('转账'));
      case '退款':
        return b.refund !== undefined || b.kind === 'refund' || (!b.kind && b.title.includes('退回'));
      case '充值':
        return b.kind === 'topup' || (!b.kind && (b.title.includes('充值') || b.title.includes('Q币')));
      case '提现':
        return b.kind === 'withdraw' || (!b.kind && b.title.includes('提现'));
      default:
        return false; // 消费/群收款/理财/代付/自动代付：本机无此数据源
    }
  };
  const monthFilter = (b: WalletBill): boolean => month === 'all' || `${new Date(b.ts).getFullYear()}-${new Date(b.ts).getMonth()}` === month;

  const shown = bills.filter((b) => typeFilter(b) && monthFilter(b));
  /** 按月分组（倒序：组头「9月 2026年」） */
  const groups = (() => {
    const map = new Map<string, WalletBill[]>();
    for (const b of shown) {
      const d = new Date(b.ts);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      const arr = map.get(key) ?? [];
      arr.push(b);
      map.set(key, arr);
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  })();

  /** 过滤栏年月文案（对齐真机截图：「2026年9月」带年份；全部=最新有账单月份） */
  const monthCaret =
    month === 'all'
      ? monthKeys.length > 0
        ? `${monthKeys[0].split('-')[0]}年${Number(monthKeys[0].split('-')[1]) + 1}月`
        : '全部'
      : `${month.split('-')[0]}年${Number(month.split('-')[1]) + 1}月`;
  const monthOptions = ['全部', ...monthKeys.map((k) => `${k.split('-')[0]}年${Number(k.split('-')[1]) + 1}月`)];

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[#F5F6F8] pt-[54px] dark:bg-[#16171A]">
      <WalletNavHeader
        title="账单明细"
        onBack={onBack}
        right={
          <button
            type="button"
            data-testid="qq-bills-qb-detail"
            onClick={() => onToast('Q币明细暂未开放')}
            className="absolute right-3 text-[15.5px] text-[#1F2329] active:opacity-50 dark:text-white"
          >
            Q币明细
          </button>
        }
      />
      {/* 过滤栏：年月 ▾ + 类型 ▾ + 下载 */}
      <div className="flex h-[54px] shrink-0 items-center gap-6 bg-[#EFEFF4] px-4 dark:bg-[#1D1E22]">
        <button type="button" data-testid="qq-bills-month" onClick={() => setMonthSheet(true)} className="flex items-center gap-1.5 text-[16px] text-black/55 dark:text-white/60">
          {monthCaret}
          <svg viewBox="0 0 12 8" className="h-2 w-3" aria-hidden="true">
            <path d="M1 1.5 6 6.5 11 1.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
        <button type="button" data-testid="qq-bills-type" onClick={() => setTypeSheet(true)} className="flex items-center gap-1.5 text-[16px] text-black/55 dark:text-white/60">
          {billType}
          <svg viewBox="0 0 12 8" className="h-2 w-3" aria-hidden="true">
            <path d="M1 1.5 6 6.5 11 1.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
        <span className="flex-1" />
        <button type="button" data-testid="qq-bills-download" onClick={() => onToast('账单已保存')} className="flex items-center gap-1 text-[16px] text-black/55 dark:text-white/60">
          下载
          <Download className="h-[18px] w-[18px]" strokeWidth={2} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-6">
        {shown.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-black/35 dark:text-white/35">
            <ClipboardList className="h-12 w-12" strokeWidth={1.5} aria-hidden="true" />
            <p className="text-[15px]">暂无账单</p>
          </div>
        ) : (
          groups.map(([key, list]) => {
            const [y, m] = key.split('-');
            return (
              <div key={key}>
                {/* 月分隔带 + 组头 */}
                <div className="h-[10px] bg-[#EFEFF4] dark:bg-[#1D1E22]" aria-hidden="true" />
                <div className="flex items-baseline gap-2 bg-white px-4 pb-1 pt-4 dark:bg-[#232529]">
                  <span className="text-[26px] font-semibold leading-none text-[#1F2329] dark:text-white">{Number(m) + 1}月</span>
                  <span className="text-[14px] text-black/40 dark:text-white/45">{y}年</span>
                </div>
                <div className="bg-white dark:bg-[#232529]">
                  {list.map((b, i) => (
                    <div
                      key={b.id}
                      data-testid="qq-bill-item"
                      className={`relative ml-[74px] flex items-center gap-3 py-[13px] pr-4 ${i > 0 ? 'border-t border-black/[0.05] dark:border-white/[0.06]' : ''}`}
                    >
                      {/* 左侧圆形图标（头像/红包/Q币），绝对定位在缩进区（与真机一致：分隔线不穿过图标） */}
                      <span className="absolute -left-[74px] top-1/2 flex h-[46px] w-[74px] -translate-y-1/2 items-center justify-center pl-4" aria-hidden="true">
                        <QQBillEntryIcon b={b} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[16.5px] text-[#1F2329] dark:text-white">{b.title}</p>
                        <p className="mt-1 text-[13.5px] text-black/35 dark:text-white/40">{fmtTime(b.ts)}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className={`text-[16.5px] font-semibold ${b.amount >= 0 ? 'text-[#2FBF71]' : 'text-[#1F2329] dark:text-white'}`}>
                          {b.amount >= 0 ? '+' : '-'}
                          {fmtMoney(Math.abs(b.amount))}元
                        </p>
                        {b.refund !== undefined && <p className="mt-0.5 text-[12.5px] leading-none text-[#F5544D]">已退款{fmtMoney(b.refund)}元</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 选择账单类型底部弹层 */}
      {typeSheet && (
        <div className="absolute inset-0 z-50 flex flex-col justify-end bg-black/45" role="dialog" aria-label="选择账单类型" onClick={() => setTypeSheet(false)}>
          <div className="rounded-t-[16px] bg-white px-4 pb-8 pt-4 dark:bg-[#232529]" onClick={(e) => e.stopPropagation()} data-testid="qq-bills-type-sheet">
            <div className="relative flex items-center justify-center">
              <button
                type="button"
                aria-label="关闭"
                onClick={() => setTypeSheet(false)}
                className="absolute left-1 grid h-8 w-8 place-items-center rounded-full bg-black/[0.05] dark:bg-white/[0.08]"
              >
                <X className="h-4 w-4" strokeWidth={2.2} />
              </button>
              <p className="text-[18px] font-medium">选择账单类型</p>
            </div>
            <div className="mt-5 grid grid-cols-3 gap-3">
              {QQ_BILL_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  data-testid={`qq-bills-type-${t}`}
                  onClick={() => {
                    setBillType(t);
                    setTypeSheet(false);
                  }}
                  className={`grid h-[54px] place-items-center rounded-[14px] border text-[16px] ${
                    billType === t ? 'border-[#1B9FF0] bg-[#1B9FF0] text-white' : 'border-black/[0.08] bg-white text-[#1F2329] dark:border-white/[0.1] dark:bg-[#2A2C31] dark:text-white'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 月份选择底部弹层 */}
      {monthSheet && (
        <div className="absolute inset-0 z-50 flex flex-col justify-end bg-black/45" role="dialog" aria-label="选择月份" onClick={() => setMonthSheet(false)}>
          <div className="max-h-[55%] overflow-y-auto rounded-t-[16px] bg-white px-3 pb-8 pt-4 dark:bg-[#232529]" onClick={(e) => e.stopPropagation()}>
            <p className="pb-2 text-center text-[17px] font-medium">选择月份</p>
            {monthOptions.map((label) => {
              const key = label === '全部' ? 'all' : (monthKeys.find((k) => `${k.split('-')[0]}年${Number(k.split('-')[1]) + 1}月` === label) ?? 'all');
              const selected = (month === 'all' && label === '全部') || month === key;
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => {
                    setMonth(key);
                    setMonthSheet(false);
                  }}
                  className={`flex h-12 w-full items-center justify-between rounded-[8px] px-4 text-[16px] active:bg-black/[0.05] ${selected ? 'text-[#1B9FF0]' : 'text-[#1F2329] dark:text-white'}`}
                >
                  {label}
                  {selected && <Check className="h-5 w-5" strokeWidth={2.2} />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/** 钱包容器（内部子路由；数据 localStorage 持久化，入口：个人中心抽屉「钱包」；开启支付密码后资金操作先验证） */
export function WalletPage({ me, onBack, onToast }: { me: QQUser; onBack: () => void; onToast: (m: string) => void }) {
  const [wallet, setWallet] = useState<WalletData>(() => loadWallet());
  const [cards, setCards] = useState<BankCard[]>(() => loadBankCards());
  const [bills, setBills] = useState<WalletBill[]>(() => loadWalletBills());
  const [route, setRoute] = useState<'home' | 'balance' | 'vault' | 'cards' | 'addcard' | 'carddetail' | 'withdraw' | 'topup' | 'bills' | 'paysettings'>('home');
  const [payFrom, setPayFrom] = useState<'home' | 'balance'>('balance');
  const [detailCardId, setDetailCardId] = useState<string | null>(null);
  // 支付密码验证浮层（开启后充值/提现/小金库转入转出先验证再执行）
  const [pendingPay, setPendingPay] = useState<null | { label: string; fn: () => void }>(null);
  const requirePay = useCallback((label: string, fn: () => void) => {
    const pp = loadPayPwd();
    if (pp.enabled && pp.pwd) setPendingPay({ label, fn });
    else fn();
  }, []);
  const openPaySettings = useCallback((from: 'home' | 'balance') => {
    setPayFrom(from);
    setRoute('paysettings');
  }, []);

  const patchWallet = useCallback((patch: Partial<WalletData>) => {
    setWallet((prev) => {
      const next = { ...prev, ...patch };
      saveWallet(next);
      return next;
    });
  }, []);

  const appendBill = useCallback((title: string, amount: number) => {
    setBills((prev) => {
      const next = [{ id: uid(), title, amount, ts: Date.now() }, ...prev].slice(0, 100);
      saveWalletBills(next);
      return next;
    });
  }, []);

  const moveVault = useCallback(
    (mode: 'in' | 'out', n: number) => {
      setWallet((prev) => {
        const next =
          mode === 'in'
            ? { ...prev, balance: round2(prev.balance - n), vault: round2(prev.vault + n) }
            : { ...prev, balance: round2(prev.balance + n), vault: round2(prev.vault - n) };
        saveWallet(next);
        return next;
      });
      appendBill(mode === 'in' ? '转入小金库' : '小金库转出', mode === 'in' ? -n : n);
      onToast(mode === 'in' ? `已转入小金库 ${fmtMoney(n)} 元` : `已从金库转出 ${fmtMoney(n)} 元`);
    },
    [appendBill, onToast]
  );

  let page: React.ReactNode;
  switch (route) {
    case 'balance':
      page = (
        <BalancePage
          wallet={wallet}
          cards={cards}
          onBack={() => setRoute('home')}
          onToast={onToast}
          onOpenTopUp={() => setRoute('topup')}
          onOpenWithdraw={() => setRoute('withdraw')}
          onOpenCards={() => setRoute('cards')}
          onOpenBills={() => setRoute('bills')}
          onOpenPaySettings={() => openPaySettings('balance')}
        />
      );
      break;
    case 'vault':
      page = (
        <VaultPage
          wallet={wallet}
          onBack={() => setRoute('home')}
          onToast={onToast}
          onMove={(mode, n) => requirePay(`${mode === 'in' ? '转入' : '转出'}小金库 ${fmtMoney(n)} 元`, () => moveVault(mode, n))}
        />
      );
      break;
    case 'cards':
      page = <BankCardsPage cards={cards} onBack={() => setRoute('balance')} onToast={onToast} onAdd={() => setRoute('addcard')} onOpenCard={(c) => { setDetailCardId(c.id); setRoute('carddetail'); }} />;
      break;
    case 'carddetail': {
      const detailCard = cards.find((c) => c.id === detailCardId);
      page = detailCard ? (
        <CardDetailPage
          card={detailCard}
          onBack={() => setRoute('cards')}
          onToast={onToast}
          onUnbind={() => {
            setCards((prev) => {
              const next = prev.filter((c) => c.id !== detailCardId);
              saveBankCards(next);
              return next;
            });
            onToast('已解除绑定');
            setRoute('cards');
          }}
        />
      ) : (
        <BankCardsPage cards={cards} onBack={() => setRoute('balance')} onToast={onToast} onAdd={() => setRoute('addcard')} onOpenCard={(c) => { setDetailCardId(c.id); setRoute('carddetail'); }} />
      );
      break;
    }
    case 'addcard':
      page = (
        <AddCardPage
          defaultHolder={me.name || '持卡人'}
          onBack={() => setRoute('cards')}
          onSave={(c) => {
            setCards((prev) => {
              const next = [{ ...c, id: uid() }, ...prev];
              saveBankCards(next);
              return next;
            });
            onToast('银行卡添加成功');
            setRoute('cards');
          }}
        />
      );
      break;
    case 'withdraw':
      page = (
        <WithdrawPage
          wallet={wallet}
          cards={cards}
          onBack={() => setRoute('balance')}
          onToast={onToast}
          onSubmit={(cardId, n) =>
            requirePay(`提现 ${fmtMoney(n)} 元 · 到账${cards.find((c) => c.id === cardId)?.bank ?? '银行卡'}`, () => {
              setCards((prev) => {
                const next = prev.map((c) => (c.id === cardId ? { ...c, balance: round2((c.balance ?? 0) + n) } : c));
                saveBankCards(next);
                return next;
              });
              patchWallet({ balance: round2(wallet.balance - n) });
              appendBill('提现', -n);
              onToast(`已提现 ${fmtMoney(n)} 元到银行卡`);
              setRoute('balance');
            })
          }
        />
      );
      break;
    case 'topup':
      page = (
        <TopUpPage
          cards={cards}
          onBack={() => setRoute('balance')}
          onToast={onToast}
          onCharge={(cardId, n) =>
            requirePay(`充值 ${fmtMoney(n)} 元 · 从${cards.find((c) => c.id === cardId)?.bank ?? '银行卡'}`, () => {
              setCards((prev) => {
                const next = prev.map((c) => (c.id === cardId ? { ...c, balance: round2((c.balance ?? 0) - n) } : c));
                saveBankCards(next);
                return next;
              });
              patchWallet({ balance: round2(wallet.balance + n) });
              appendBill('充值', n);
              onToast(`充值成功 ${fmtMoney(n)} 元`);
              setRoute('balance');
            })
          }
        />
      );
      break;
    case 'bills':
      page = <BillsPage bills={bills} onBack={() => setRoute('balance')} onToast={onToast} />;
      break;
    case 'paysettings':
      page = <PaySettingsPage onBack={() => setRoute(payFrom)} onToast={onToast} />;
      break;
    case 'home':
    default:
      page = <WalletHomePage wallet={wallet} onBack={onBack} onToast={onToast} onOpenBalance={() => setRoute('balance')} onOpenVault={() => setRoute('vault')} onOpenPaySettings={() => openPaySettings('home')} />;
  }

  return (
    <>
      {page}
      {pendingPay ? (
        <PayPwdGate
          label={pendingPay.label}
          onOk={() => {
            const fn = pendingPay.fn;
            setPendingPay(null);
            fn();
          }}
          onClose={() => setPendingPay(null)}
        />
      ) : null}
    </>
  );
}
