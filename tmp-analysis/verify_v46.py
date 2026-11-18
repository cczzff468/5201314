# -*- coding: utf-8 -*-
"""
v46【楼主回复】端到端验证：
A. 服务端 API ownerReply（真实 LLM，需配额）：
   A1 废话评论全无视（target=-1）；A2 混合评论挑「值得回」的那条（提问）
M. 浏览器全链路（Playwright 路由拦截 mock 上游 LLM —— 引擎/UI/记忆全真实）：
   M0 种子：联系人 + 论坛数据 + 2 个 ownerReply pending 任务（ownPost/userPost）
   M1 ownPost 楼主回复落地（挂被选评论名下）；M2 已处理标记 ownerReplySeen
   M3 userPost 护短回复落地；M4 通知；M5 记忆碎片写入（记忆联动）
   M6 请求载荷人设注入断言（char.persona/post/comments/mode 上送正确）
D. UI 楼主徽章：D1 char 帖楼主回复带「楼主」徽章；D2 用户帖护短回复不带徽章
"""
import json
import pathlib
import sys
import time
import urllib.request

from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"
OUT = pathlib.Path("/home/z/my-project/tmp-analysis/v46-verify")
OUT.mkdir(parents=True, exist_ok=True)

results = []
console_errors = []
page_errors = []

P1 = "v46-p1"
C1 = "v46-c1"
C2 = "v46-c2"
P2 = "v46-p2"
C3 = "v46-c3"

FANFAN_PERSONA = (
    "你是凡凡，机主小柚的恋人。性格温柔黏人爱撒娇，说话软乎乎的简称口语化；"
    "但有人欺负小柚时会立刻护短怼回去，怼人毫不客气但从不爆粗口。"
)


def log(step, name, ok, evidence):
    results.append({"step": step, "name": name, "ok": bool(ok), "evidence": str(evidence)[:500]})
    print(f"[{'PASS' if ok else 'FAIL'}] {step} {name} :: {evidence}", flush=True)


def shot(page, name):
    path = OUT / f"{name}.png"
    try:
        page.screenshot(path=str(path), timeout=15000)
        print(f"    [shot] {path}", flush=True)
    except Exception as e:
        print(f"    [shot failed] {name}: {e}", flush=True)
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


# ---------------- Phase A：API 直测 ----------------


def api_owner_reply(mode, post, comments, persona=FANFAN_PERSONA, relation="恋人"):
    body = {
        "kind": "ownerReply",
        "mode": mode,
        "char": {"name": "凡凡", "persona": persona, "relation": relation, "mood": "", "memory": ""},
        "post": post,
        "comments": comments,
        "postLang": "zh-Hans",
        "avoid": [],
        "userName": "小柚",
    }
    req = urllib.request.Request(
        BASE + "/api/forum/generate",
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=200) as r:
        return json.loads(r.read().decode("utf-8"))


def probe_quota(timeout_s=480):
    """探测上游 LLM 配额（names 小请求）；恢复才继续，避免烧重试窗口"""
    deadline = time.time() + timeout_s
    n = 0
    while time.time() < deadline:
        n += 1
        try:
            req = urllib.request.Request(
                BASE + "/api/forum/generate",
                data=json.dumps({"kind": "names", "count": 2, "avoid": []}).encode("utf-8"),
                headers={"Content-Type": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=150) as r:
                json.loads(r.read().decode("utf-8"))
            print(f"    [probe] 配额可用（第 {n} 次探测）", flush=True)
            return True
        except Exception as e:
            print(f"    [probe] 第 {n} 次仍限流：{repr(e)[:120]}，等 60s…", flush=True)
            time.sleep(60)
    return False


def run_api_tests():
    print("== Phase A: API ownerReply ==", flush=True)
    # A1 废话评论全 → 期望 target=-1（无视）
    try:
        r = api_owner_reply(
            "ownPost",
            {"authorName": "凡凡", "content": "今天画了一下午的插画，终于把秋天的配色定下来了，累但开心", "mediaDesc": ""},
            [
                {"name": "momo", "persona": "普通网友", "content": "沙发"},
                {"name": "阿茶", "persona": "普通网友", "content": "支持支持"},
                {"name": "Nana", "persona": "普通网友", "content": "前排围观"},
            ],
        )
        target = r.get("target", -99)
        text = r.get("text", "")
        tabloid = any(k in text for k in ["开团", "顶流", "塌房", "懂的都懂", "D社"])
        ok = target == -1 or (isinstance(target, int) and 0 <= target < 3 and text and 8 <= len(text) <= 130 and not tabloid)
        log("A1", "废话评论：无视或合规回复", ok,
            f"target={target} text={text[:60]!r} tabloid={tabloid}（target=-1 = 无视 ✓）")
    except Exception as e:
        log("A1", "废话评论 API 调用", False, repr(e))

    time.sleep(8)
    # A2 混合评论（2 废话 + 1 提问）→ 期望挑提问那条（target=2）
    try:
        r = api_owner_reply(
            "ownPost",
            {"authorName": "凡凡", "content": "接的委托插画终于交稿啦！画的是橘色系的秋天小屋，改了四版配色才定下来", "mediaDesc": ""},
            [
                {"name": "momo", "persona": "普通网友", "content": "沙发"},
                {"name": "阿茶", "persona": "普通网友", "content": "哈哈哈支持"},
                {"name": "Kiko", "persona": "普通网友", "content": "画秋天小屋用的什么笔刷呀？求分享！我也想学"},
            ],
        )
        target = r.get("target", -99)
        text = r.get("text", "")
        anchored = any(k in text for k in ["笔刷", "秋天", "小屋", "配色", "学"])
        ok = target == 2 and text and 8 <= len(text) <= 130 and anchored
        log("A2", "混合评论挑「值得回」的那条", ok,
            f"target={target}（期望2=提问） text={text[:60]!r} anchored={anchored}")
    except Exception as e:
        log("A2", "混合评论 API 调用", False, repr(e))


# ---------------- Phase B/C/D：浏览器管线 ----------------

READ_JS = """
async () => {
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('ios-phone-db');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const get = (key) => new Promise((res) => {
    try {
      const tx = db.transaction('kv', 'readonly');
      const rq = tx.objectStore('kv').get(key);
      rq.onsuccess = () => res(rq.result ? rq.result.value : null);
      rq.onerror = () => res(null);
    } catch { res(null); }
  });
  const getAllKeys = () => new Promise((res) => {
    try {
      const tx = db.transaction('kv', 'readonly');
      const rq = tx.objectStore('kv').getAllKeys();
      rq.onsuccess = () => res(rq.result || []);
      rq.onerror = () => res([]);
    } catch { res([]); }
  });
  const data = await get('forum-data-v1');
  const keys = await getAllKeys();
  const memRaw = {};
  for (const k of keys) {
    if (typeof k === 'string' && k.startsWith('mem-frag:')) memRaw[k] = await get(k);
  }
  db.close();
  return { data, memRaw };
}
"""


def mkpost(pid, author_key, content, at, reply_to=None, reply_to_name=None):
    return {
        "id": pid,
        "authorKey": author_key,
        "content": content,
        "community": None,
        "createdAt": at,
        "likes": [],
        "reposts": 0,
        "views": 66,
        "likeBoost": 0,
        "replyTo": reply_to,
        "replyToName": reply_to_name,
    }


def run_browser():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, locale="zh-CN")
        page = ctx.new_page()
        page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: page_errors.append(str(e)))

        now = int(time.time() * 1000)
        forum_data = {
            "v": 1,
            "posts": [
                mkpost(P1, "char:c-fanfan",
                       "接的委托插画终于交稿啦！画的是橘色系的秋天小屋，改了四版配色才定下来，甲方居然一次就过了，开心到转圈圈～",
                       now - 3600000),
                mkpost(P2, "user", "今天第一次做提拉米苏，居然没有翻车，开心！", now - 1800000),
                mkpost(C1, "npc:wang", "沙发，前排围观", now - 1700000, P1, "凡凡"),
                mkpost(C2, "npc:kitty", "就这水平也好意思收钱？画得跟小学生似的，甲方审美堪忧", now - 1600000, P1, "凡凡"),
                mkpost(C3, "npc:liang", "第一次做不翻车？摆拍吧，一看就是买的现成的糊弄人", now - 1500000, P2, "小柚"),
            ],
            "communities": [],
            "notifications": [],
            "dms": [],
            "following": [],
            "likesByMe": {},
            "seeded": True,
            "genVersion": 35,
            "aiActivity": True,
            "postMemory": True,
            "charSocial": {"c-fanfan": {"lastPostAt": now - 3600000, "nextPostAt": now + 7200000}},
            "ownerReplySeen": {},
            "lastGenAt": now - 3600000,
            "joinedAt": now - 86400000 * 30,
        }
        pending = {
            "j-v46-a": {"id": "j-v46-a", "due": now - 3000, "kind": "ownerReply", "postKey": P1,
                        "meta": {"charKey": "char:c-fanfan", "mode": "ownPost"}},
            "j-v46-b": {"id": "j-v46-b", "due": now - 3000, "kind": "ownerReply", "postKey": P2,
                        "meta": {"charKey": "char:c-fanfan", "mode": "userPost"}},
        }
        owner_contact = {
            "id": "u-v46-owner", "kind": "user", "ownerId": None, "name": "小柚", "nickname": None,
            "gender": "女", "age": "22", "height": None, "weight": None,
            "persona": None, "background": None, "occupation": None, "company": None, "region": None,
            "relation": None, "phone": "88888888", "wechatId": "xiaoyou888", "wechatPassword": "123456",
            "qqId": "10000", "qqPassword": "123456", "avatar": None, "isFriend": True,
            "createdAt": "2024-01-01T00:00:00.000Z",
        }
        fanfan_contact = {
            "id": "c-fanfan", "kind": "char", "ownerId": None, "name": "凡凡", "nickname": None,
            "gender": "女", "age": "22", "height": None, "weight": None,
            "persona": FANFAN_PERSONA, "background": None, "occupation": "插画师", "company": None,
            "region": "杭州", "relation": "恋人", "phone": "13900001111", "wechatId": "fanfan-wx",
            "qqId": "20001", "qqPassword": "123456", "avatar": None, "isFriend": True,
            "createdAt": "2024-01-02T00:00:00.000Z",
        }

        print("== Phase M: 种子 + 管线（mock LLM 响应，引擎/UI 全真实） ==", flush=True)
        page.goto(BASE, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_selector("text=向上轻扫以解锁", timeout=90000)
        seeded = page.evaluate(
            """async (args) => {
                const db = await new Promise((res, rej) => {
                    const r = indexedDB.open('ios-phone-db');
                    r.onsuccess = () => res(r.result);
                    r.onerror = () => rej(r.error);
                });
                const put = (store, val) => new Promise((res, rej) => {
                    const tx = db.transaction(store, 'readwrite');
                    tx.objectStore(store).put(val);
                    tx.oncomplete = res;
                    tx.onerror = rej;
                });
                await put('contacts', args.owner);
                await put('contacts', args.fanfan);
                await put('kv', { key: 'forum-data-v1', value: args.forumData });
                await put('kv', { key: 'forum-pending-v1', value: args.pending });
                db.close();
                return true;
            }""",
            {"owner": owner_contact, "fanfan": fanfan_contact, "forumData": forum_data, "pending": pending},
        )
        log("M0", "种子（联系人 + 论坛数据 + 2 个 ownerReply 任务）", seeded, "IndexedDB 写入")

        # 路由拦截：mock 上游 LLM 的 ownerReply 决策（其余 kind 放行真请求）
        # 捕获请求载荷 → M6 断言人设注入
        captured = []

        def handle_route(route):
            try:
                body = json.loads(route.request.post_data or "{}")
            except Exception:
                body = {}
            captured.append(body)
            if body.get("kind") == "ownerReply" and body.get("mode") == "ownPost":
                # mock 决策：无视 C1 废话（index 0），回怼 C2 恶评（index 1）。
                # ⚠ 回复文本不得复读被怼评论的原文片段（≥6 字公共 run 会被
                # migrateV35PurgeLeaked 防复读迁移正确清除）；锨定词用主帖的「橘色系/小屋」
                route.fulfill(
                    status=200,
                    content_type="application/json",
                    body=json.dumps(
                        {"target": 1, "text": "评论区酸人谁不会，有本事你自己画一幅橘色系小屋试试？"},
                        ensure_ascii=False,
                    ),
                )
            elif body.get("kind") == "ownerReply" and body.get("mode") == "userPost":
                # mock 决策：护短回怼 C3（唯一评论，index 0）；锨定词用主帖「提拉米苏」
                route.fulfill(
                    status=200,
                    content_type="application/json",
                    body=json.dumps(
                        {"target": 0, "text": "摆拍？TA为了这提拉米苏打了半小时蛋白，跟你嘴里的现成货不一样"},
                        ensure_ascii=False,
                    ),
                )
            else:
                route.continue_()

        page.route("**/api/forum/generate", handle_route)

        page.reload(wait_until="domcontentloaded", timeout=60000)
        ok = unlock_and_home(page)
        log("M0b", "重载 + 上滑解锁（调度器随壳启动）", ok, "")
        shot(page, "01-home")

        # 轮询两条回复落地（mock 即时返回；调度器首拍 ~15s）
        own_reply = None
        guard_reply = None
        deadline = time.time() + 120
        last_snap = {}
        while time.time() < deadline:
            try:
                snap = page.evaluate(READ_JS)
            except Exception as e:
                print(f"    [poll error] {e}", flush=True)
                time.sleep(4)
                continue
            last_snap = snap
            d = snap.get("data") or {}
            posts = d.get("posts") or []
            own_reply = next(
                (x for x in posts if x.get("authorKey") == "char:c-fanfan" and x.get("replyTo") in (C1, C2)), None
            )
            guard_reply = next(
                (x for x in posts if x.get("authorKey") == "char:c-fanfan" and x.get("replyTo") == C3), None
            )
            if own_reply and guard_reply:
                break
            time.sleep(4)

        # M1 ownPost 楼主回复落地
        if own_reply:
            tgt = "C2恶评" if own_reply.get("replyTo") == C2 else ("C1废话" if own_reply.get("replyTo") == C1 else "?")
            ok_m1 = (
                own_reply.get("replyTo") == C2
                and own_reply.get("replyToPost") == C2
                and 8 <= len(own_reply.get("content", "")) <= 130
            )
            log("M1", "ownPost：楼主回复落地（挂被选评论名下）", ok_m1,
                f"选中={tgt} 内容={own_reply.get('content', '')[:60]!r} replyToPost={own_reply.get('replyToPost')}")
        else:
            log("M1", "ownPost：楼主回复落地", False, "120s 内未见 char:c-fanfan 在 P1 下的回复")
        # M2 已处理标记
        seen = ((last_snap.get("data") or {}).get("ownerReplySeen")) or {}
        p1_seen = set(seen.get(P1) or [])
        p2_seen = set(seen.get(P2) or [])
        ok_m2 = {C1, C2}.issubset(p1_seen) and {C3}.issubset(p2_seen)
        log("M2", "评论标记「已看过并决策过」（两帖）", ok_m2,
            f"P1 seen={sorted(p1_seen)}; P2 seen={sorted(p2_seen)}")

        # M3 userPost 护短回复落地
        if guard_reply:
            ok_m3 = guard_reply.get("replyToPost") == C3 and 8 <= len(guard_reply.get("content", "")) <= 130
            log("M3", "userPost：护短回复落地（挂恶评名下）", ok_m3,
                f"内容={guard_reply.get('content', '')[:60]!r} replyToPost={guard_reply.get('replyToPost')}")
        else:
            log("M3", "userPost：护短回复落地", False, "120s 内未见 char:c-fanfan 在 P2 下的回复")

        # M4 通知
        notifications = ((last_snap.get("data") or {}).get("notifications")) or []
        ok_m4 = any(n.get("fromKey") == "char:c-fanfan" and n.get("type") == "reply" for n in notifications)
        log("M4", "userPost：护短产生「回复」通知", ok_m4, f"notifications={len(notifications)} 条")

        # M5 记忆碎片（记忆联动）
        mem_raw = json.dumps(last_snap.get("memRaw") or {}, ensure_ascii=False)
        has_own_mem = "我回了TA" in mem_raw
        has_guard_mem = "帮TA回" in mem_raw
        ok_m5 = has_own_mem and has_guard_mem
        log("M5", "记忆联动：楼主回复+护短都写入记忆碎片", ok_m5,
            f"ownPost记忆={has_own_mem} 护短记忆={has_guard_mem}; 碎片键={[k for k in (last_snap.get('memRaw') or {}).keys()]}")

        # M6 请求载荷人设注入
        own_req = next((c for c in captured if c.get("kind") == "ownerReply" and c.get("mode") == "ownPost"), None)
        guard_req = next((c for c in captured if c.get("kind") == "ownerReply" and c.get("mode") == "userPost"), None)
        if own_req and guard_req:
            ch = own_req.get("char") or {}
            own_comments = own_req.get("comments") or []
            ok_m6 = (
                "凡凡" in str(ch.get("persona", ""))
                and "恋人" in str(ch.get("relation", ""))
                and "秋天小屋" in str((own_req.get("post") or {}).get("content", ""))
                and len(own_comments) == 2
                and any("好意思收钱" in str(c.get("content", "")) for c in own_comments)
                and "提拉米苏" in str((guard_req.get("post") or {}).get("content", ""))
                and any("摆拍" in str(c.get("content", "")) for c in guard_req.get("comments") or [])
            )
            log("M6", "请求载荷：人设/关系/主帖/评论清单注入正确", ok_m6,
                f"ownPost: persona含凡凡={'凡凡' in str(ch.get('persona', ''))}, relation={ch.get('relation')!r}, "
                f"评论数={len(own_comments)}, mood={bool(ch.get('mood'))}, memory={bool(ch.get('memory'))}")
        else:
            log("M6", "请求载荷断言", False, f"captured kinds={[c.get('kind') for c in captured]}")

        # ---------- Phase D：UI 楼主徽章 ----------
        print("== Phase D: UI 楼主徽章 ==", flush=True)
        page.unroute("**/api/forum/generate", handle_route)
        found = find_icon_click(page, "打开X论坛")
        try:
            page.wait_for_selector('text=橘色系的秋天小屋', timeout=30000)
            in_forum = True
        except Exception:
            in_forum = False
        log("D0", "打开 X 论坛（信息流可见种子帖）", in_forum, f"翻页 {found} 次后进入")
        shot(page, "02-forum-feed")

        # D1 打开 P1 帖子详情 → 楼主徽章（点正文区避开头像；等楼主回复文本渲染后再数徽章）
        try:
            page.locator('article:has-text("橘色系的秋天小屋")').first.click(position={"x": 200, "y": 120}, timeout=10000)
            page.wait_for_selector('text=沙发，前排围观', timeout=15000)
            page.wait_for_selector('text=评论区酸人谁不会', timeout=15000)
            time.sleep(1.2)
            badge_count = page.get_by_text("楼主", exact=True).count()
            log("D1", "char 帖：楼主回复带「楼主」徽章", badge_count >= 1,
                f"徽章数={badge_count}（凡凡作为楼主，其回复应带徽章）")
            shot(page, "03-thread-p1-badge")
        except Exception as e:
            log("D1", "char 帖楼主徽章检查", False, repr(e))

        # D2 返回信息流 → 打开 P2 帖子详情 → 凡凡不是楼主，不带徽章
        # （thread 顶栏返回按钮用 :near(帖子标题) 精确定位——信息流层的 X Logo 按钮
        #  同样叫 aria-label=返回 但在视图栈下面不可见；点不动就走重进兜底）
        try:
            try:
                page.locator('button[aria-label="返回"]:near(span:text-is("帖子"))').first.click(timeout=6000)
                time.sleep(1.0)
            except Exception:
                pass  # 返回按钮没点上：直接走重进兜底
            if not page.locator('article:has-text("提拉米苏")').count():
                # 兜底：重新进论坛
                page.reload(wait_until="domcontentloaded", timeout=60000)
                unlock_and_home(page)
                find_icon_click(page, "打开X论坛")
                page.wait_for_selector('text=提拉米苏', timeout=30000)
            page.locator('article:has-text("提拉米苏")').first.click(position={"x": 200, "y": 120}, timeout=10000)
            page.wait_for_selector('text=摆拍吧', timeout=15000)
            page.wait_for_selector('text=摆拍？TA为了这提拉米苏', timeout=15000)
            time.sleep(1.2)
            badge_count2 = page.get_by_text("楼主", exact=True).count()
            log("D2", "用户帖：护短回复不带「楼主」徽章", badge_count2 == 0,
                f"徽章数={badge_count2}（凡凡不是 P2 楼主，不应有徽章）")
            shot(page, "04-thread-p2-nobadge")
        except Exception as e:
            log("D2", "用户帖徽章检查", False, repr(e))

        # 控制台/页面错误（无关噪音过滤）
        def noisy(msg):
            return any(k in msg for k in ["favicon", "Download the React DevTools", "比如", "masthead"])

        real_console = [m for m in console_errors if not noisy(m)]
        log("E1", "无 console/page 错误", len(real_console) == 0 and len(page_errors) == 0,
            f"console={real_console[:3]} pageerror={page_errors[:3]}")

        browser.close()


def main():
    # 先跑 mock 全链路（不受配额影响：引擎/记忆/UI 全真实，仅 mock 上游 LLM 响应）
    run_browser()
    # 再跑真实 LLM 决策测试（配额恢复才执行；未恢复则报告 pending）
    if probe_quota(timeout_s=300):
        run_api_tests()
    else:
        print("== Phase A 跳过：上游 LLM 配额 5 分钟内未恢复（管线已由 mock 全链路验证）==", flush=True)
    n_pass = sum(1 for r in results if r["ok"])
    print(f"\n== SUMMARY {n_pass}/{len(results)} ==", flush=True)
    for r in results:
        print(f"  [{'PASS' if r['ok'] else 'FAIL'}] {r['step']} {r['name']}", flush=True)
    ok = all(r["ok"] for r in results)
    print("RESULT:" + ("ALL_PASS" if ok else "HAS_FAIL"), flush=True)
    (OUT / "report.json").write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
