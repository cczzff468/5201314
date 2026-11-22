'use client';

/**
 * QQ 真机云端特性开关（localStorage 单键持久化；QQ 机器人按账号一台，全局一份即可）：
 * - 斗图模式（stickerBattle）：开启后对方发表情包/挑衅时 AI 连发多张表情包反击（上限
 *   3→5 张，云端核心按运行包字段放行）；提示词段随运行包上云。
 * （v16：定时主动消息 proactive 已按机主定调删除——主动发消息改为跟随网站各角色的
 *   「主动发消息」设置，经站内引擎触发 send-active 发到真机，不再单独配置。）
 * 开关随「重新同步运行包」上云（config.json 的 qq.stickerBattle）。
 */

const BATTLE_KEY = 'qq-sticker-battle';

function lsGet(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function lsSet(key: string, val: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, val);
  } catch {
    /* 持久化失败忽略（本次会话内存态仍然生效） */
  }
}

/** 读取斗图模式开关（默认关闭） */
export function getQqStickerBattle(): boolean {
  return lsGet(BATTLE_KEY) === '1';
}

/** 保存斗图模式开关（调用方负责重新同步运行包） */
export function saveQqStickerBattle(on: boolean): void {
  lsSet(BATTLE_KEY, on ? '1' : '0');
}
