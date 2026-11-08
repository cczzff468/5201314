#!/usr/bin/env bash
# AI Phone APK 一键重打脚本（沙箱重建后 public/AI-Phone.apk 丢失时使用）
#
# 背景：APK（4MB，debug 签名可直接安装）不进 git（.gitignore 排除），
# 沙箱每次重建后文件消失 → 网页端「设置 › APP 更新」显示打包中、无法下载。
# 本脚本完整重走工具链：JDK → Android SDK → Capacitor 依赖 → cap sync → gradle 打包。
# 首次全量约 5~8 分钟（含下载 ~350MB 工具链）；SDK/JDK 已在位时约 3 分钟。
#
# 用法：bash scripts/build-apk.sh
set -euo pipefail

MY_PROJECT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SHELL_DIR="$MY_PROJECT/android-shell"
SDK_HOME="$HOME/android-sdk"
JDK_HOME="$HOME/jdk"
APK_SRC="$SHELL_DIR/android/app/build/outputs/apk/debug/app-debug.apk"
APK_DST="$MY_PROJECT/public/AI-Phone.apk"

log() { echo -e "\033[1;32m[build-apk]\033[0m $*"; }

# ---------- 1) JDK（系统 java 是 JRE 无 javac，需免安装 Temurin/OpenJDK） ----------
if [ ! -x "$JDK_HOME/bin/javac" ]; then
  log "下载 OpenJDK 21（华为云镜像）..."
  curl -sL -o /tmp/jdk21.tar.gz \
    "https://mirrors.huaweicloud.com/openjdk/21.0.2/openjdk-21.0.2_linux-x64_bin.tar.gz"
  mkdir -p "$JDK_HOME"
  tar -xzf /tmp/jdk21.tar.gz -C "$JDK_HOME" --strip-components=1
  rm -f /tmp/jdk21.tar.gz
fi
log "JDK 就位：$($JDK_HOME/bin/javac -version 2>&1)"

# ---------- 2) Android SDK（cmdline-tools + platform/build-tools 36） ----------
if [ ! -d "$SDK_HOME/platforms/android-36" ]; then
  log "下载 Android cmdline-tools（dl.google.com）..."
  mkdir -p "$SDK_HOME"
  curl -sL -o "$SDK_HOME/cmdtools.zip" \
    "https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip"
  unzip -qo "$SDK_HOME/cmdtools.zip" -d "$SDK_HOME"
  mkdir -p "$SDK_HOME/cmdline-tools/latest"
  # 11076708 解压出 cmdline-tools/bin 等目录，挪到 latest/ 下（sdkmanager 规范布局）
  for d in bin lib NOTICE.txt source.properties; do
    [ -e "$SDK_HOME/cmdline-tools/$d" ] && mv "$SDK_HOME/cmdline-tools/$d" "$SDK_HOME/cmdline-tools/latest/" || true
  done
  rm -f "$SDK_HOME/cmdtools.zip"
  export ANDROID_HOME="$SDK_HOME"
  log "接受许可并安装 platform-tools / android-36 / build-tools 36.0.0 ..."
  yes | "$SDK_HOME/cmdline-tools/latest/bin/sdkmanager" --licenses >/dev/null 2>&1 || true
  "$SDK_HOME/cmdline-tools/latest/bin/sdkmanager" \
    "platform-tools" "platforms;android-36" "build-tools;36.0.0" >/dev/null
fi
log "Android SDK 就位：$(ls "$SDK_HOME/platforms/")"

# ---------- 3) Capacitor 依赖 + www 同步 ----------
log "安装 android-shell 依赖（bun）..."
(cd "$SHELL_DIR" && bun install --silent)
log "cap sync android（www → assets）..."
(cd "$SHELL_DIR" && bunx cap sync android)

# ---------- 4) Gradle 打包（debug 签名，可直接安装/覆盖安装） ----------
log "gradle assembleDebug（腾讯镜像发行版，约 3 分钟）..."
export JAVA_HOME="$JDK_HOME"
export ANDROID_HOME="$SDK_HOME"
export PATH="$JAVA_HOME/bin:$PATH"
(cd "$SHELL_DIR/android" && ./gradlew assembleDebug --no-daemon)

# ---------- 5) 部署 ----------
cp "$APK_SRC" "$APK_DST"
SIZE=$(ls -lh "$APK_DST" | awk '{print $5}')
log "完成：public/AI-Phone.apk（$SIZE）——网页端「设置 › APP 更新」即可下载"
