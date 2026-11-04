#!/usr/bin/env bash
# 网易云 API 部署健康检查（沙箱内外的任何部署都适用）
# 用法：bash check.sh [baseUrl]
#   bash check.sh                          # 默认 http://localhost:3010
#   bash check.sh http://你的服务器:3010   # 检查远程实例
#   bash check.sh https://api.example.com  # 检查反代后的 https 域名

BASE="${1:-http://localhost:3010}"
PASS=0; FAIL=0

hit() { # $1=名称 $2=路径（可含 ?query） $3=期望片段（正则，宽松）
  local T; T=$(date +%s%3N)
  local SEP='?'
  case "$2" in *"?"*) SEP='&' ;; esac
  local R; R=$(curl -s --max-time 15 "$BASE/$2${SEP}timestamp=$T")
  if echo "$R" | grep -qE "$3"; then
    echo "✅ $1"
    PASS=$((PASS+1))
  else
    echo "❌ $1  →  $(echo "$R" | head -c 120)"
    FAIL=$((FAIL+1))
  fi
  sleep 1
}

echo "== 网易云 API 健康检查：$BASE =="
hit "扫码登录 key     " "login/qr/key"          '"unikey"'
hit "云搜索          " "cloudsearch?keywords=test&limit=1" '"code":200|"result"'
hit "热搜            " "search/hot/detail"     '"code":200'
hit "官方榜列表      " "toplist"               '"code":200'
hit "推荐歌单        " "personalized?limit=1"  '"code":200'
hit "每日推荐歌曲    " "recommend/songs"       '"dailySongs"|"code":200'
hit "歌曲详情        " "song/detail?ids=186016" '"songs"'
hit "歌词            " "lyric?id=186016"       '"lrc"'
hit "登录状态        " "login/status"          '"code"|"data"'

echo "== 结果：$PASS 通过 / $FAIL 失败 =="
if [ "$FAIL" -eq 0 ]; then
  echo "🎉 API 服务完全可用。若个别项偶发「参数错误/460」，为网易瞬时风控，隔几秒重试即可。"
fi
exit "$FAIL"
