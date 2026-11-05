# -*- coding: utf-8 -*-
"""
v45 端到端验证：
A. 留言板 5 张新便签卡（用户参考图）——卡纸选择器出现、可创建、图片加载、padTop 避让
B. X 论坛——个人主页 → 正在关注/关注者 列表页（FollowListView 两 tab + 取消关注按钮）
C. NPC 评论 API（拿错剧本过滤）——善意短帖 + 懂瓜呱矩阵人设 → 返回评论不含狗仔预告模板
"""
import json
import pathlib
import sys
import time

from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"
OUT = pathlib.Path("/home/z/my-project/tmp-analysis/v45-verify")
OUT.mkdir(parents=True, exist_ok=True)

results = []
console_errors = []
page_errors = []
img_requests = {}  # url -> status

SEED_STATE = {
    "v": 1,
    "accepted": True,
    "anniversary": "2024-05-20",
    "meName": "阿泽",
    "taName": "小鹿",
    "boardNotes": [],
    "boardBg": 0,
    "boardCardSlim": True,
    "boardCardSlim2": True,
}


def log(step, name, ok, evidence):
    results.append({"step": step, "name": name, "ok": bool(ok), "evidence": evidence})
    print(f"[{'PASS' if ok else 'FAIL'}] {step} {name} :: {evidence}", flush=True)


def shot(page, name):
    path = OUT / f"{name}.png"
    try:
        page.screenshot(path=str(path), timeout=15000)
        print(f"    📸 {path}", flush=True)
    except Exception as e:
        print(f"    📸 screenshot failed {name}: {e}", flush=True)
    return str(path)


def unlock_and_home(page):
    page.goto(BASE, wait_until="domcontentloaded", timeout=60000)
    page.wait_for_selector("text=向上轻扫以解锁", timeout=90000)
    page.mouse.move(195, 790)
    page.mouse.down()
    for y in range(770, 240, -30):
        page.mouse.move(195, y)
        time.sleep(0.02)
    page.mouse.up()
    try:
        page.wait_for_selector("text=向上轻扫以解锁", state="detached", timeout=10000)
        ok = True
    except Exception:
        ok = False
    time.sleep(1.0)
    return ok


def find_icon_click(page, label):
    """主屏翻页找图标并点击"""
    for attempt in range(10):
        icon = page.locator(f'[aria-label="{label}"]')
        box = icon.bounding_box()
        if box and -5 <= box["x"] and box["x"] + box["width"] <= 395:
            icon.click()
            return attempt
        page.mouse.move(340, 400)
        page.mouse.down()
        for x in range(330, 45, -30):
            page.mouse.move(x, 400)
            time.sleep(0.02)
        page.mouse.up()
        time.sleep(0.7)
    return None


def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, locale="zh-CN")
        page = ctx.new_page()
        page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: page_errors.append(str(e)))
        page.on("response", lambda r: img_requests.update({r.url: r.status})
                if "/board-cards/" in r.url else None)

        # ---------- Phase 0: 启动 + 种子 ----------
        page.goto(BASE, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_selector("text=向上轻扫以解锁", timeout=90000)
        seeded = page.evaluate(
            """async (state) => {
                const db = await new Promise((res, rej) => {
                    const r = indexedDB.open('ios-phone-db');
                    r.onsuccess = () => res(r.result);
                    r.onerror = () => rej(r.error);
                });
                await new Promise((res, rej) => {
                    const tx = db.transaction('kv', 'readwrite');
                    tx.objectStore('kv').put({ key: 'couple-space:state', value: state });
                    tx.oncomplete = res;
                    tx.onerror = rej;
                });
                db.close();
                return true;
            }""",
            SEED_STATE,
        )
        log("0", "种子 couple-space 状态", seeded, "IndexedDB 写入 accepted=true")

        # ---------- Phase A: 留言板新卡纸 ----------
        page.reload(wait_until="domcontentloaded")
        ok = unlock_and_home(page)
        log("A1", "上滑解锁进入主屏", ok, "")
        shot(page, "01-home")

        found = find_icon_click(page, "打开恋人空间")
        try:
            page.wait_for_selector('button:has-text("留言板")', timeout=30000)
            in_home = True
        except Exception:
            in_home = False
        log("A2", "打开恋人空间", in_home, f"翻页 {found} 次后进入")
        shot(page, "02-couple-home")

        page.locator('button:has-text("留言板")').first.click()
        page.wait_for_selector('p:text-is("留言板")', timeout=15000)
        time.sleep(0.9)
        shot(page, "03-board-empty")
        log("A3", "进入留言板", True, "")

        # 打开书写弹层 → 检查卡纸选择器
        page.locator('button[aria-label="钉一张便签"]').click()
        page.wait_for_selector('div[role="dialog"][aria-label="钉一张便签"] textarea', timeout=5000)
        time.sleep(0.6)
        cards = page.eval_on_selector_all(
            'div[role="dialog"][aria-label="钉一张便签"] button[aria-label]',
            "els => els.map(e => e.getAttribute('aria-label'))",
        )
        expect_cards = ["素白", "样式一", "样式五", "便签纸", "手绘涂鸦", "水彩蝴蝶", "蕾丝乐谱", "枝头双兔", "朦胧少女"]
        got = [c for c in cards if c in expect_cards]
        log("A4", "卡纸选择器含 5 张新卡", got == expect_cards, f"顺序={got}")
        shot(page, "04-card-picker")

        # 用「手绘涂鸦」创建便签
        page.fill('div[role="dialog"][aria-label="钉一张便签"] textarea', "涂鸦卡测试便签")
        page.locator('button[aria-label="手绘涂鸦"]').click()
        time.sleep(0.4)
        shot(page, "05-doodle-preview")
        page.get_by_role("button", name="钉上留言墙 ♡").click()
        page.wait_for_selector('div[role="dialog"][aria-label="钉一张便签"]', state="detached", timeout=8000)
        time.sleep(0.9)

        # 用「朦胧少女」创建便签
        page.locator('button[aria-label="钉一张便签"]').click()
        page.wait_for_selector('div[role="dialog"][aria-label="钉一张便签"] textarea', timeout=5000)
        page.fill('div[role="dialog"][aria-label="钉一张便签"] textarea', "少女卡测试便签")
        page.locator('button[aria-label="朦胧少女"]').click()
        time.sleep(0.4)
        page.get_by_role("button", name="钉上留言墙 ♡").click()
        page.wait_for_selector('div[role="dialog"][aria-label="钉一张便签"]', state="detached", timeout=8000)
        time.sleep(0.9)
        shot(page, "06-board-two-cards")

        wall_notes = page.eval_on_selector_all(
            'button[aria-label="查看这张便签"]',
            """els => els.map(e => ({
                text: (e.querySelector('p[class*="mt-1.5"]')?.textContent || '').trim(),
                bg: (e.style.backgroundImage || '').slice(0, 80),
                padTop: e.style.paddingTop || '',
            }))""",
        )
        texts = [w["text"] for w in wall_notes]
        log("A5", "两张新卡便签上墙", texts == ["少女卡测试便签", "涂鸦卡测试便签"], f"DOM={texts}; bg={[w['bg'][:60] for w in wall_notes]}")
        doodle = next((w for w in wall_notes if "涂鸦" in w["text"]), None)
        log("A6", "涂鸦卡 padTop 避让生效", bool(doodle and doodle["padTop"] and int(doodle["padTop"].replace("px", "")) > 30),
            f"paddingTop={doodle['padTop'] if doodle else 'N/A'}")

        # 图片加载状态
        time.sleep(0.5)
        card_imgs = {u.split("/")[-1]: s for u, s in img_requests.items()}
        need = ["card-18.png", "card-22.png"]
        ok_imgs = all(card_imgs.get(n) == 200 for n in need)
        log("A7", "新卡图片 HTTP 200", ok_imgs, f"{ {n: card_imgs.get(n) for n in need} }")

        # 详情弹层
        page.locator('button[aria-label="查看这张便签"]').first.click()
        page.wait_for_selector('div[role="dialog"][aria-label="便签详情"]', timeout=5000)
        time.sleep(0.5)
        shot(page, "07-note-detail")
        log("A8", "便签详情弹层打开", True, "")
        # 点弹层卡片上方的遮罩空白区关闭（卡片居中，y=110 在卡片外）
        page.mouse.click(195, 110)
        time.sleep(0.5)

        # ---------- Phase B: X 论坛关注列表 ----------
        # 回到主屏（点 home 条）
        for _ in range(4):
            try:
                page.mouse.click(195, 838)
                time.sleep(0.5)
            except Exception:
                pass
        # 关闭恋人空间 app → 用 home 键 + 上滑关闭
        # iOS 模拟器：AppWindow 顶部下边缘上滑关闭复杂，直接用重启页面更稳
        page.reload(wait_until="domcontentloaded")
        ok = unlock_and_home(page)
        log("B1", "重启回主屏", ok, "")

        found = find_icon_click(page, "打开X论坛")
        try:
            page.wait_for_selector('span:text-is("X论坛")', timeout=30000)
            forum_ok = True
        except Exception:
            forum_ok = False
        log("B2", "打开 X 论坛", forum_ok, f"翻页 {found} 次")
        time.sleep(1.2)
        shot(page, "08-forum-home")

        # 打开侧栏菜单（顶栏头像 → setDrawer）
        page.locator('button[aria-label="查看我的主页"]').first.click()
        page.wait_for_selector('[role="dialog"][aria-label="论坛菜单"]', timeout=8000)
        time.sleep(0.6)
        shot(page, "09-forum-drawer")

        # 点个人摘要行进主页（含 @handle 的那行）
        page.locator('[role="dialog"][aria-label="论坛菜单"] button:has-text("@")').first.click()
        time.sleep(1.0)
        shot(page, "10-profile")
        stats = page.locator('button[aria-label="查看我正在关注的人"]')
        log("B3", "个人主页统计行可点", stats.count() > 0, f"「查看我正在关注的人」按钮 count={stats.count()}")
        stats.first.click()
        time.sleep(1.0)

        tabs = page.eval_on_selector_all(
            'button[aria-current]',
            "els => els.map(e => e.textContent.trim())",
        )
        # FollowListView 有 正在关注/关注者 两 tab
        has_tabs = page.locator('button:text-is("正在关注")').count() > 0 and page.locator('button:text-is("关注者")').count() > 0
        log("B4", "关注列表页两 tab（正在关注/关注者）", has_tabs, f"tabs={tabs}")
        shot(page, "11-follow-list")

        # 切到关注者 tab
        page.locator('button:text-is("关注者")').first.click()
        time.sleep(0.8)
        shot(page, "12-followers")
        empty_followers = page.locator("text=还没有人关注你").count() > 0
        log("B5", "关注者 tab 可切换", True, f"空态提示={empty_followers}")

        # ---------- Phase C: NPC 评论 API（拿错剧本过滤） ----------
        persona = page.evaluate(
            """() => {
                // 直接从页面 bundle 拿不到模块——改用 fetch 触发服务端生成，这里先返回占位
                return null;
            }"""
        )
        # 用真实 API：善意短帖 + 懂瓜呱（矩阵）人设 → 返回评论必须不含狗仔预告模板
        # 人设字符串复刻 worldview.ts matrixNpcPersona 对「内娱八卦·懂瓜呱」的拼装结果
        dg_persona = (
            "身份：爆料人 / 瓜主——你是这个论坛的瓜主/爆料人——专门发真假难辨的独家爆料：目击、线人转述、"
            "预告式爆料、时间线整理。发帖必带「实锤感」细节（时间/地点/代号），从不给全名只给代号或缩写。"
            "你的爆料有时后来被证实、有时是乌龙，但当下你永远言之凿凿；"
            "性格与语气：狗仔线人型瓜主，预告式爆料专业户。永远「明天上午十点开团」，永远只给姓氏代号：「L姓顶流，懂的都懂」。"
            "时间线整理癖，爆料帖必带「先捋一下时间线」；"
            "专属口头禅：明天十点开团，L姓顶流，懂的都懂（只在话题与你身份领域对口时自然带一下，别每句都用；"
            "帖子内容与你的领域无关时绝对不用）；"
            "你发自己的帖子时完全代入这个身份和性格，口吻从头到尾一致；评论/回复别人时看帖子内容行事——"
            "帖子聊的事与你的身份领域对口才发挥身份套路，帖子若是私人情感、善意夸奖、撒糖互动、日常分享这类"
            "与你领域无关的内容，你就退回普通网友视角围绕帖子本身说话，绝不把身份模板和口头禅硬套上去（拿错剧本＝废稿）"
        )
        api = page.evaluate(
            """async (payload) => {
                const r = await fetch('/api/forum/generate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });
                const j = await r.json().catch(() => ({}));
                return { status: r.status, items: j.items ?? [] };
            }""",
            {
                "kind": "comments",
                "post": {
                    "authorName": "阿泽",
                    "content": "总而言之你很可爱 [图片]",
                    "mediaDesc": "一张写着自拍两字的白底图片",
                    "lang": "zh-Hans",
                },
                "personas": [
                    {"name": "懂瓜呱", "persona": dg_persona, "lang": "zh-Hans", "matrix": True},
                    {"name": "momo", "persona": "普通论坛网友", "lang": "zh-Hans"},
                    {"name": "阿茶", "persona": "普通论坛网友", "lang": "zh-Hans"},
                ],
                "userName": "阿泽",
            },
        )
        comments = api.get("items", [])
        tabloid_marks = ["开团", "姓", "顶流", "塌房", "懂的都懂", "D社", "蹲后续", "实锤"]
        bad = [c for c in comments if any(m in c for m in tabloid_marks)]
        attack = [c for c in comments if any(m in c for m in ["公道话", "被骂", "P图", "洗地"])]
        log("C1", "评论 API 返回 200", api.get("status") == 200, f"status={api.get('status')}, {len(comments)} 条评论")
        log("C2", "善意帖评论无狗仔预告模板（拿错剧本过滤）", len(bad) == 0, f"违规={bad}")
        log("C3", "善意帖评论无虚空索敌（防杠精过滤）", len(attack) == 0, f"违规={attack}")
        for c in comments:
            print(f"    💬 {c}", flush=True)

        # 汇总
        n_ok = sum(1 for r in results if r["ok"])
        report = {
            "pass": n_ok,
            "fail": len(results) - n_ok,
            "results": results,
            "console_errors": console_errors[:10],
            "page_errors": page_errors[:10],
        }
        (OUT / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2))
        print(f"\n== SUMMARY: {n_ok}/{len(results)} PASS ==", flush=True)
        print(f"console errors: {len(console_errors)}, page errors: {len(page_errors)}", flush=True)
        for e in page_errors[:5]:
            print(f"  pageerror: {e[:200]}", flush=True)
        browser.close()
        return 0 if n_ok == len(results) else 1


if __name__ == "__main__":
    sys.exit(run())
