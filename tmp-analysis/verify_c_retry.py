# -*- coding: utf-8 -*-
"""C 阶段重试：善意短帖 + 懂瓜呱矩阵人设 → 评论不得含狗仔预告模板（拿错剧本过滤）"""
import json
import pathlib
import time

from playwright.sync_api import sync_playwright

OUT = pathlib.Path("/home/z/my-project/tmp-analysis/v45-verify")
OUT.mkdir(parents=True, exist_ok=True)

DG_PERSONA = (
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

TABLOID_MARKS = ["开团", "顶流", "塌房", "懂的都懂", "D社", "蹲后续", "实锤了", "姓顶", "姓小", "姓男", "姓女", "L姓", "W姓", "K姓", "Z姓"]
ATTACK_MARKS = ["公道话", "被骂", "P图", "洗地", "被喷", "照骗"]


def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 390, "height": 844}, locale="zh-CN")
        page = ctx.new_page()
        page.goto("http://localhost:3000", wait_until="domcontentloaded", timeout=60000)

        payload = {
            "kind": "comments",
            "post": {
                "authorName": "阿泽",
                "content": "总而言之你很可爱 [图片]",
                "mediaDesc": "一张写着自拍两字的白底图片",
                "lang": "zh-Hans",
            },
            "personas": [
                {"name": "懂瓜呱", "persona": DG_PERSONA, "lang": "zh-Hans", "matrix": True},
                {"name": "momo", "persona": "普通论坛网友", "lang": "zh-Hans"},
                {"name": "阿茶", "persona": "普通论坛网友", "lang": "zh-Hans"},
            ],
            "userName": "阿泽",
        }
        api = page.evaluate(
            """async (payload) => {
                const r = await fetch('/api/forum/generate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });
                const j = await r.json().catch(() => ({}));
                return { status: r.status, items: j.items ?? [], error: j.error ?? '' };
            }""",
            payload,
        )
        comments = api.get("items", [])
        bad = [c for c in comments if any(m in c for m in TABLOID_MARKS)]
        attack = [c for c in comments if any(m in c for m in ATTACK_MARKS)]
        result = {
            "status": api.get("status"),
            "error": api.get("error", "")[:200],
            "comments": comments,
            "tabloid_violations": bad,
            "attack_violations": attack,
            "pass": api.get("status") == 200 and not bad and not attack,
        }
        (OUT / "c-retry.json").write_text(json.dumps(result, ensure_ascii=False, indent=2))
        print(json.dumps(result, ensure_ascii=False, indent=2))
        browser.close()
        return 0 if result["pass"] else 1


if __name__ == "__main__":
    import sys
    sys.exit(run())
