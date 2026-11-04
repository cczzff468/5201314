'use client';

/**
 * 聊天 App 界面皮肤上下文（第五十六轮）
 * ---------------------------------------------------------------------------
 *  古早（retro）/ 液态玻璃（liquid）主题此前只靠 data-rt-theme / data-liquid-theme
 *  根属性 + globals.css 批量接管页面底与白卡，但聊天设置的二级子页（查找聊天记录 /
 *  世界书挂载 / 他的声音 / 翻译 / 回复条数 / 聊天背景 / 主动发消息）与微信主搜索页
 *  的顶栏/搜索框/按钮铬件仍是现代语言——用户指定「有的界面还没有应用」。
 *  此上下文由 WeChatApp / QQApp 根部下发，共享子页（chat-settings.tsx 等）消费，
 *  按主题切换铬件类：古早 = 银灰拟物导航条（rt-bar）+ 白底内凹搜索框（rt-search）；
 *  液态 = 玻璃卡（lg-panel）。信息 App（chat.tsx）不下发 = 永远默认皮肤。
 */

import { createContext, useContext, type ReactNode } from 'react';

export interface ChatSkin {
  /** 古早主题（仅微信/QQ 会为 true） */
  retro: boolean;
  /** 液态玻璃主题（仅微信/QQ 会为 true） */
  liquid: boolean;
}

const DEFAULT_SKIN: ChatSkin = { retro: false, liquid: false };

const ChatSkinCtx = createContext<ChatSkin>(DEFAULT_SKIN);

export function ChatSkinProvider({
  retro = false,
  liquid = false,
  children,
}: {
  retro?: boolean;
  liquid?: boolean;
  children: ReactNode;
}) {
  return <ChatSkinCtx.Provider value={{ retro, liquid }}>{children}</ChatSkinCtx.Provider>;
}

/** 共享子页读取当前宿主 App 的界面皮肤（信息 App / 未包裹时 = 默认） */
export function useChatSkin(): ChatSkin {
  return useContext(ChatSkinCtx);
}
