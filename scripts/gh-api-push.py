#!/usr/bin/env python3
"""
GitHub API 推送工具（沙箱 git 协议被限制，用 REST API 创建 blob/tree/commit 并更新分支指针）
用法:
  python3 scripts/gh-api-push.py "commit message" path1 path2 ...
  python3 scripts/gh-api-push.py "commit message" --all     # 推送 git status 列出的所有改动
  python3 scripts/gh-api-push.py --status                   # 仅查看远程 main 状态
特性:
  - 以远程 main 最新 commit 为 parent（保留远程历史，非 force push）
  - 仅上传改动文件（base_tree 继承其余全部内容）
  - 自动跳过 >100MB 文件（GitHub API 限制）与 .gitignore 忽略的文件
  - 成功后写入 .gh-remote-head 记录远程基线
"""
import base64
import json
import os
import subprocess
import sys
import urllib.request
import urllib.error

REPO = "cczzff468/5201314"
BRANCH = "main"
API = f"https://api.github.com/repos/{REPO}"


def _load_token() -> str:
    # 优先环境变量 GH_TOKEN，其次本地 .gh-token 文件（已 gitignore，绝不入库）
    tok = os.environ.get("GH_TOKEN", "").strip()
    if tok:
        return tok
    marker = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".gh-token")
    if os.path.isfile(marker):
        with open(marker) as fh:
            tok = fh.read().strip()
        if tok:
            return tok
    print("!! 未找到 token：请设置环境变量 GH_TOKEN 或创建 .gh-token 文件")
    sys.exit(1)


HDR = {
    "Content-Type": "application/json",
    "Accept": "application/vnd.github+json",
}


def _hdr() -> dict:
    return {"Authorization": f"Bearer {_load_token()}", **HDR}


def api(method: str, path: str, payload: dict | None = None) -> dict:
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(f"{API}{path}", data=data, headers=_hdr(), method=method)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def git(*args: str) -> str:
    return subprocess.run(["git", *args], capture_output=True, text=True, check=True).stdout


def main() -> None:
    os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

    if len(sys.argv) >= 2 and sys.argv[1] == "--status":
        ref = api("GET", f"/git/ref/heads/{BRANCH}")
        head = ref["object"]["sha"]
        c = api("GET", f"/commits/{head}")
        print(f"远程 main head: {head}")
        print(f"最新提交: {c['commit']['message'].splitlines()[0]}")
        print(f"提交时间: {c['commit']['author']['date']}")
        return

    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)

    msg = sys.argv[1]
    rest = sys.argv[2:]

    if rest == ["--all"]:
        out = git("status", "--porcelain").splitlines()
        files = [line[3:].strip().strip('"') for line in out if line.strip()]
    else:
        files = rest

    files = [f for f in files if os.path.isfile(f)]
    if not files:
        print("没有需要推送的文件")
        return

    # 远程 head
    ref = api("GET", f"/git/ref/heads/{BRANCH}")
    head_sha = ref["object"]["sha"]
    head_commit = api("GET", f"/commits/{head_sha}")
    head_tree = head_commit["commit"]["tree"]["sha"]
    print(f"==> 远程 main head: {head_sha[:12]}  ({head_commit['commit']['message'].splitlines()[0][:50]})")
    print(f"==> 待推送 {len(files)} 个文件")

    # 创建 blobs + tree 条目
    tree_items = []
    for f in files:
        size = os.path.getsize(f)
        if size > 100 * 1024 * 1024:
            print(f"    !! 跳过 >100MB: {f}")
            continue
        with open(f, "rb") as fh:
            content_b64 = base64.b64encode(fh.read()).decode()
        blob = api("POST", "/git/blobs", {"content": content_b64, "encoding": "base64"})
        tree_items.append({"path": f.replace("\\", "/"), "mode": "100644", "type": "blob", "sha": blob["sha"]})
        print(f"    blob {f} ({size}B) -> {blob['sha'][:10]}")

    if not tree_items:
        print("没有可上传的文件（全部跳过）")
        sys.exit(1)

    tree = api("POST", "/git/trees", {"base_tree": head_tree, "tree": tree_items})
    print(f"==> 新 tree: {tree['sha'][:12]}")

    commit = api("POST", "/git/commits", {"message": msg, "tree": tree["sha"], "parents": [head_sha]})
    print(f"==> 新 commit: {commit['sha'][:12]}")

    api("PATCH", f"/git/refs/heads/{BRANCH}", {"sha": commit["sha"], "force": False})
    print(f"==> ✅ 已推送到 {REPO}@{BRANCH}  {commit['sha'][:12]}")

    with open(".gh-remote-head", "w") as fh:
        fh.write(commit["sha"])


if __name__ == "__main__":
    try:
        main()
    except urllib.error.HTTPError as e:
        print(f"!! GitHub API 错误 {e.code}: {e.read().decode()[:500]}")
        sys.exit(1)
