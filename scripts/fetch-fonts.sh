#!/usr/bin/env bash
# 第二十八轮：下载自托管中文字体（修复"点击字体没反应"= 系统字体栈回退渲染一致的问题）
# 每个 family：拉取 css2（woff2 UA）→ 解析全部 woff2 子集下载到 /public/fonts/<dir>/ → 重写为本地相对路径
set -e
cd /home/z/my-project
mkdir -p public/fonts
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"

fetch_family() {
  local family="$1" dir="$2"
  local out="public/fonts/${dir}"
  mkdir -p "$out"
  echo "==== $family -> $out"
  curl -s --max-time 30 -A "$UA" "https://fonts.googleapis.com/css2?family=${family// /+}&display=swap" -o "$out/font.css"
  local n=0
  grep -o 'https://fonts.gstatic.com/[^)]*' "$out/font.css" | sort -u | while read -r u; do
    f="$(basename "$u")"
    curl -s --max-time 30 -A "$UA" "$u" -o "$out/$f" || echo "FAIL $u"
    n=$((n+1))
  done
  # 重写 CSS 里的 URL 为本地相对路径
  sed -i 's#https://fonts.gstatic.com/s/[a-z0-9]*/v[0-9]*/[A-Za-z0-9_-]*/#./#g' "$out/font.css"
  echo "$family done: $(ls "$out" | wc -l) files"
}

fetch_family "Ma Shan Zheng" "mashanzheng"
fetch_family "Zhi Mang Xing" "zhimangxing"
fetch_family "Liu Jian Mao Cao" "liujianmaocao"
fetch_family "Long Cang" "longcang"
fetch_family "ZCOOL XiaoWei" "zcoolxiaowei"
fetch_family "ZCOOL KuaiLe" "zcoolkuaile"
fetch_family "ZCOOL QingKe HuangYou" "zcoolhuangyou"
echo "ALL DONE"
du -sh public/fonts
