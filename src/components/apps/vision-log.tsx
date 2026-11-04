'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Bookmark,
  ChevronLeft,
  Image as ImageIcon,
  ImageOff,
  Loader2,
  Send,
  Smile,
  Sparkles,
  Trash2,
  UserCircle,
  X,
  type LucideIcon,
} from 'lucide-react';
import { IOSNavBar, IOSScreen } from '@/components/ios/IOSNavBar';
import { deleteVisionDecisionsByContact, listVisionDecisions } from '@/lib/ios/album-store';
import type { VisionDecisionRecord } from '@/lib/ios/db';

/**
 * AI 视觉决策日志页：
 * - 按 contactId 隔离展示某角色（或「我自己」）的全部视觉决策记录
 * - 数据来源 visionDecisions 表（46-a 实现），listVisionDecisions 已按 createdAt 倒序
 * - 行内卡片：缩略图 + 动作中文描述 + 相对时间 + App 来源标签 + 动作图标
 * - 点击行内卡片弹详情面板（大图 + 动作 + 时间 + reason + targetId）
 * - NavBar 右上「清空」按钮：window.confirm → deleteVisionDecisionsByContact → reload
 *
 * 数据层属审计/历史信息，本组件只读不写，写入由各聊天 App 在执行视觉动作时调 addVisionDecision 完成。
 */
interface VisionLogPageProps {
  contactId: string; // 角色隔离
  title: string; // "${peerName}的视觉决策日志" / "我的视觉决策日志"
  onClose: () => void;
}

/** 6 种视觉决策动作的中文文案 / 图标 / 主色（与 chat-rich 46-b ACTION_LABELS 同语义保持一致） */
const ACTION_LABELS: Record<VisionDecisionRecord['action'], { label: string; icon: LucideIcon; color: string }> = {
  'change-avatar': { label: '换了头像', icon: UserCircle, color: '#0A84FF' },
  'change-moments-bg': { label: '换了朋友圈背景', icon: ImageIcon, color: '#34C759' },
  'save-to-album': { label: '存入相册', icon: Bookmark, color: '#FF9500' },
  'pick-album-avatar': { label: '从相册选图设头像', icon: UserCircle, color: '#5856D6' },
  'pick-album-bg': { label: '从相册选图设背景', icon: ImageIcon, color: '#AF52DE' },
  'pick-album-send': { label: '从相册选图发送', icon: Send, color: '#FF3B30' },
  imggen: { label: '生成照片', icon: Sparkles, color: '#FF2D55' },
  'gen-avatar': { label: '主动换新头像', icon: Smile, color: '#FF9500' },
};

/** App 来源中文标签（与 db.ts VisionDecisionRecord.app union 对齐） */
const APP_LABELS: Record<'wx' | 'qq' | 'sms', string> = {
  wx: '微信',
  qq: 'QQ',
  sms: '信息',
};

/** 简版相对时间格式化（与 src/lib/ios/groups.ts groupEventAgo 同语义，无项目级共用 helper 故本组件内联） */
function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diff = now.getTime() - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}分钟前`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}小时前`;
  if (diff < 7 * 86400_000) return `${Math.floor(diff / 86400_000)}天前`;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function VisionLogPage({ contactId, title, onClose }: VisionLogPageProps) {
  const [items, setItems] = useState<VisionDecisionRecord[] | null>(null);
  const [detail, setDetail] = useState<VisionDecisionRecord | null>(null);

  const reload = useCallback(async () => {
    const list = await listVisionDecisions(contactId);
    // 微任务内 setState 规避 react-hooks/set-state-in-effect（与 qq.tsx 同模式）
    void Promise.resolve().then(() => setItems(list));
  }, [contactId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleClear = async () => {
    if (!window.confirm('确定清空所有视觉决策记录？此操作不可撤销。')) return;
    await deleteVisionDecisionsByContact(contactId);
    setDetail(null);
    await reload();
  };

  return (
    <IOSScreen className="relative">
      <IOSNavBar
        title={title}
        large={false}
        left={
          <button
            type="button"
            aria-label="返回"
            onClick={onClose}
            className="-ml-1 flex h-11 w-11 items-center justify-center text-foreground transition-opacity active:opacity-50"
          >
            <ChevronLeft className="h-6 w-6" strokeWidth={2.4} />
          </button>
        }
        right={
          items && items.length > 0 ? (
            <button
              type="button"
              aria-label="清空视觉决策记录"
              onClick={() => void handleClear()}
              className="flex h-11 w-11 items-center justify-center text-foreground transition-opacity active:opacity-50"
            >
              <Trash2 className="h-5 w-5" strokeWidth={2} />
            </button>
          ) : null
        }
      />

      <div className="flex-1 overflow-y-auto overscroll-contain px-4 pb-8 pt-2">
        {items === null ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" strokeWidth={2} />
          </div>
        ) : items.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
            <ImageOff className="h-12 w-12 opacity-50" strokeWidth={1.5} />
            <p className="text-[15px]">暂无视觉决策记录</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((it) => {
              const meta = ACTION_LABELS[it.action];
              const Icon = meta.icon;
              const appLabel = APP_LABELS[it.app];
              return (
                <li key={it.id}>
                  <button
                    type="button"
                    onClick={() => setDetail(it)}
                    className="flex w-full items-center gap-3 rounded-2xl bg-foreground/[0.04] p-3 text-left transition-opacity active:opacity-70"
                  >
                    {/* 缩略图（imgSrc 缺失时占位） */}
                    <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-foreground/10">
                      {it.imgSrc ? (
                        <img src={it.imgSrc} alt={meta.label} className="h-full w-full object-cover" draggable={false} />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                          <ImageIcon className="h-6 w-6 opacity-60" strokeWidth={1.5} />
                        </div>
                      )}
                    </div>

                    {/* 中：动作描述 + 时间 + App 标签 */}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-medium text-foreground">{meta.label}</p>
                      <p className="mt-0.5 text-[12px] text-muted-foreground">{formatTime(it.createdAt)}</p>
                      <span
                        className="mt-1 inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium"
                        style={{ backgroundColor: `${meta.color}1A`, color: meta.color }}
                      >
                        {appLabel}
                      </span>
                    </div>

                    {/* 右：动作图标 */}
                    <div
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                      style={{ backgroundColor: `${meta.color}1A`, color: meta.color }}
                    >
                      <Icon className="h-4 w-4" strokeWidth={2.2} />
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* 详情面板（居中弹窗 + 背景模糊遮罩；点遮罩或 X 关闭） */}
      {detail && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 px-6 backdrop-blur-sm"
          onClick={() => setDetail(null)}
        >
          <div
            className="relative w-full max-w-[340px] rounded-3xl bg-background p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              aria-label="关闭"
              onClick={() => setDetail(null)}
              className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-foreground/10 text-foreground transition-opacity active:opacity-60"
            >
              <X className="h-4 w-4" strokeWidth={2.4} />
            </button>

            {/* 大图预览（imgSrc 缺失时占位） */}
            <div className="mt-2 aspect-square w-full overflow-hidden rounded-2xl bg-foreground/10">
              {detail.imgSrc ? (
                <img
                  src={detail.imgSrc}
                  alt={ACTION_LABELS[detail.action].label}
                  className="h-full w-full object-cover"
                  draggable={false}
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                  <ImageIcon className="h-12 w-12 opacity-60" strokeWidth={1.5} />
                </div>
              )}
            </div>

            <div className="mt-4 flex items-center gap-2">
              {(() => {
                const meta = ACTION_LABELS[detail.action];
                const Icon = meta.icon;
                return (
                  <div
                    className="flex h-8 w-8 items-center justify-center rounded-full"
                    style={{ backgroundColor: `${meta.color}1A`, color: meta.color }}
                  >
                    <Icon className="h-4 w-4" strokeWidth={2.2} />
                  </div>
                );
              })()}
              <p className="text-[16px] font-semibold text-foreground">{ACTION_LABELS[detail.action].label}</p>
            </div>

            <div className="mt-3 flex items-center gap-2 text-[12px] text-muted-foreground">
              <span className="inline-flex items-center rounded-md bg-foreground/10 px-1.5 py-0.5 font-medium">
                {APP_LABELS[detail.app]}
              </span>
              <span>{formatTime(detail.createdAt)}</span>
            </div>

            {detail.reason && (
              <div className="mt-3 rounded-xl bg-foreground/[0.04] p-3">
                <p className="text-[12px] font-medium text-muted-foreground">理由</p>
                <p className="mt-1 text-[14px] leading-relaxed text-foreground">{detail.reason}</p>
              </div>
            )}

            {detail.targetId && (
              <p className="mt-3 break-all text-[11px] text-muted-foreground/70">targetId: {detail.targetId}</p>
            )}
          </div>
        </div>
      )}
    </IOSScreen>
  );
}
