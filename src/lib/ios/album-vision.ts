'use client';

/**
 * 相册图片自动描述（第二十九轮「让 AI 知道相册里的图片长什么样」）：
 *
 * 相册条目（AlbumRecord）的 desc 字段是 AI 分享照片的依据——【相册清单】把 desc 注进 system，
 * AI 才知道每张图是什么、该不该发/怎么聊。此前 desc 只有用户手动编辑或 AI 存图时才有，
 * 用户自己上传的图 desc 为空 → AI 看到的清单全是「图片」，等于瞎子。
 *
 * 本模块三件事：
 * ① describeAlbumEntry：单张识图 + 回写 desc（上传后 fire-and-forget 调用）；
 * ② ensureAlbumDescs：把相册里没有描述的条目懒补（每轮 AI 回合开头调用，每轮最多补 2 张，不刷请求）；
 * ③ 全部走 describeImagesAuto——未配置识图模型自动用内置识图兜底，用户零配置 AI 也能看懂相册。
 */

import { listAlbums, updateAlbum } from './album-store';
import { useSettings } from './store';
import { describeImagesAuto } from '@/lib/vision-client';

/** 正在描述中的条目（防同一条目并发重复识图） */
const pending = new Set<string>();

/** 单张相册图识图并回写 desc；成功返回描述文本，失败/空返回 null */
export async function describeAlbumEntry(albumId: string, src: string): Promise<string | null> {
  if (!albumId || typeof src !== 'string' || !src.startsWith('data:image/')) return null;
  if (pending.has(albumId)) return null;
  pending.add(albumId);
  try {
    const desc = await describeImagesAuto(useSettings.getState().visionConfig, {
      images: [src],
      text: '用一句话客观描述这张照片的内容（人物/动物/景物/场景/可见文字），60字以内，只输出描述本身。',
    });
    if (!desc) return null;
    try {
      await updateAlbum(albumId, { desc });
    } catch {
      /* 回写失败不影响聊天（下次再补） */
    }
    return desc;
  } catch {
    return null;
  } finally {
    pending.delete(albumId);
  }
}

/**
 * 相册描述懒补：找出没有 desc 的条目，逐张识图回写（每轮最多 limit 张，控制请求量；
 * 描述是渐进到位的——本轮补不齐的下轮接着补，AI 清单随对话越来越完整）。
 * 返回本轮新补出的描述数（调用方一般 fire-and-forget 不用返回值）。
 */
export async function ensureAlbumDescs(contactId: string, limit = 2): Promise<number> {
  let list;
  try {
    list = await listAlbums(contactId);
  } catch {
    return 0;
  }
  const targets = list.filter((a) => !a.desc && a.src.startsWith('data:image/')).slice(-limit);
  let done = 0;
  for (const t of targets) {
    const desc = await describeAlbumEntry(t.id, t.src);
    if (desc) done += 1;
  }
  return done;
}
