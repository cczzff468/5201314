'use client';

/**
 * Hugging Face Spaces 部署（浏览器直连 huggingface.co —— @huggingface/hub 官方支持浏览器端，
 * 走用户自己的网络与 token；沙箱服务器无法代劳，大陆网络不通时给出手动指引兜底）。
 *
 * 形态：公共 Docker Space（密钥不放文件里，走 Space 的 Settings → Secrets：
 * SUPA_URL / SUPA_KEY 从用户 Supabase 读取运行包）。容器 7860 端口自带状态页
 * （GET / 返回心跳 JSON），cron-job.org 免费定时 ping 该地址即可防 48 小时休眠。
 */

import { commit, createRepo, whoAmI } from '@huggingface/hub';
import { useWxCloud, wxCloudSnapshot } from './store';
import { ASSISTANT_MJS, hfDockerfile } from './sources';
import { syncRunPackage } from './supabase';

export const HF_REPO_NAME = 'wx-assistant';

/** whoami：校验 token 并拿用户名 */
export async function hfWhoami(token: string): Promise<string> {
  const info = await whoAmI({ accessToken: token }).catch(() => null);
  const name = info && typeof info.name === 'string' ? info.name : '';
  if (!name) throw new Error('Token 无效或无法连接 huggingface.co（大陆网络可能需要代理）');
  return name;
}

/** Space 状态页地址（公共 Space 可匿名访问，保活 ping 也打这里） */
export function hfStatusUrl(user: string): string {
  return `https://${user}-${HF_REPO_NAME}.hf.space/`;
}

export interface HfDeployResult {
  ok: boolean;
  msg: string;
  spaceUrl?: string;
  statusUrl?: string;
}

/** 一键部署到 HF Space（浏览器直连；先同步运行包到 Supabase 再建 Space 传文件） */
export async function deployHf(token: string): Promise<HfDeployResult> {
  token = token.trim();
  if (!token.startsWith('hf_')) return { ok: false, msg: 'HF Token 以 hf_ 开头，请到 huggingface.co → Settings → Access Tokens 生成（write 权限）' };

  // 运行包必须先就位（HF 容器从用户 Supabase 读配置）
  const sync = await syncRunPackage();
  if (!sync.ok) return { ok: false, msg: sync.msg };

  let user: string;
  try {
    user = await hfWhoami(token);
  } catch (e) {
    return { ok: false, msg: e instanceof Error ? e.message : String(e) };
  }

  // 建 Space（已存在则复用）
  try {
    await createRepo({
      repo: { type: 'space', name: HF_REPO_NAME },
      credentials: { accessToken: token },
      sdk: 'docker',
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // 409 = 已存在，直接复用；其它错误（网络/CORS）给手动指引
    if (!/already exist|409/i.test(msg)) {
      return {
        ok: false,
        msg: `连不上 HF 或建仓失败：${msg.slice(0, 120)}。大陆网络可能需要代理；也可手动建 Space 后用「下载部署包」上传`,
      };
    }
  }

  // 传文件（Dockerfile + assistant.mjs + silk 语音条组件；密钥不进文件）
  try {
    // silk-wasm 编码器（QQ 原生语音条用；从本站 public/silk 读取，随 Space 一起部署）
    const [silkMjs, silkWasm] = await Promise.all([
      fetch('/silk/silk-wasm.mjs').then((r) => {
        if (!r.ok) throw new Error('读取 silk-wasm.mjs 失败');
        return r.blob();
      }),
      fetch('/silk/silk.wasm').then((r) => {
        if (!r.ok) throw new Error('读取 silk.wasm 失败');
        return r.blob();
      }),
    ]);
    await commit({
      repo: { type: 'space', name: HF_REPO_NAME },
      credentials: { accessToken: token },
      title: 'wx-assistant deploy',
      operations: [
        { operation: 'addOrUpdate', path: 'Dockerfile', content: new Blob([hfDockerfile()], { type: 'text/plain' }) },
        { operation: 'addOrUpdate', path: 'assistant.mjs', content: new Blob([ASSISTANT_MJS], { type: 'text/javascript' }) },
        { operation: 'addOrUpdate', path: 'silk-wasm.mjs', content: silkMjs },
        { operation: 'addOrUpdate', path: 'silk.wasm', content: silkWasm },
      ],
    });
  } catch (e) {
    return { ok: false, msg: `上传文件失败：${(e instanceof Error ? e.message : String(e)).slice(0, 120)}` };
  }

  useWxCloud.getState().saveHf({ token, user, repo: HF_REPO_NAME, deployedAt: Date.now() });
  useWxCloud.getState().setPlatform('hf');
  return {
    ok: true,
    msg: `已部署到你的 HF Space。还差两步：① Space 的 Settings → Secrets 里添加 SUPA_URL 和 SUPA_KEY（值见下方「ClawCloud 部署参数」同款）② 用 cron-job.org 免费定时 ping 状态页防休眠${sync.note ?? ''}`,
    spaceUrl: `https://huggingface.co/spaces/${user}/${HF_REPO_NAME}`,
    statusUrl: hfStatusUrl(user),
  };
}

/** 测试 HF：访问状态页拿心跳（公共 Space；大陆网络可能直连失败，提示用代理或稍后再试） */
export async function pingHf(): Promise<{ ok: boolean; msg: string }> {
  const hf = wxCloudSnapshot().hf;
  if (!hf) return { ok: false, msg: '还没部署：先完成 HF 一键部署' };
  const url = hfStatusUrl(hf.user);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    const j = (await res.json().catch(() => null)) as { ok?: boolean; lastRunAt?: number; lastError?: string } | null;
    if (res.ok && j?.ok) {
      const at = j.lastRunAt ? new Date(j.lastRunAt).toLocaleString() : '刚启动';
      const r = { ok: true, msg: `HF 容器在线，上次轮询 ${at}${j.lastError ? '；最近错误：' + j.lastError : ''}` };
      useWxCloud.getState().setLastPing(r);
      return r;
    }
    const r = { ok: false, msg: `状态页返回 ${res.status}${j?.lastError ? '：' + j.lastError : ''}` };
    useWxCloud.getState().setLastPing(r);
    return r;
  } catch (e) {
    const r = { ok: false, msg: `访问不了 ${url}（${e instanceof Error ? e.message.slice(0, 80) : '网络不通'}）——大陆网络对 hf.space 不稳，容器可能其实正常` };
    useWxCloud.getState().setLastPing(r);
    return r;
  }
}
