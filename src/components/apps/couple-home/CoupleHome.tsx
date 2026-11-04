'use client';

/**
 * 情侣小家 3D v4 —— 主组件（白色系·客厅篇）
 *
 * - 生活模式：摇杆/WASD 操控小人、镜头跟随、滑动全方位旋转视角、点家具交互、点窗户开合；
 * - 编辑模式：上帝视角、拖拽移动（0.25m 吸附）、移动方式双轨：四向按钮微调 + 按住拖动/移动模式搬运、
 *   四宫格旋转（左转/右转 + 上仰/下俯）、每件家具调色盘、地板/墙壁自定义颜色、画面缩放、家具商店、昼夜切换；
 * - 金币系统已移除；
 * - 持久化：IndexedDB 即时缓存 + Prisma 服务端（rev 乐观并发，409 采纳服务端）。
 * - v7.0 小屋 HUD 精简：全屏按钮移除；相机按钮移到左上返回键下方；
 *   宠物状态面板改为右上角头像唤出的毛玻璃卡片；抚摸/喂食/喂水/洗澡/抱抱/召唤六枚互动按钮独立到底部。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Armchair,
  Bath,
  BedDouble,
  BookOpen,
  Camera,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronsDown,
  ChevronsUp,
  Circle,
  Clock,
  Coffee,
  CupSoda,
  Droplet,
  Eye,
  Feather, // v11 I1 互动轮盘：挠痒痒
  Flame,
  Gamepad2,
  Heart,
  HeartHandshake,
  History,
  Radio,
  Hand,
  ImagePlus,
  MessageCircle,
  Mic,
  SendHorizontal,
  ArrowDownToLine, // v7.2 抱抱→放下 图标
  Laptop,
  Loader2,
  Moon,
  MoreVertical,
  Move,
  Music,
  Paintbrush,
  PawPrint,
  Pencil,
  Puzzle,
  RefreshCw, // v8.3 宠物转圈把戏
  RotateCcw,
  RotateCw,
  Undo2,
  Redo2,
  Shirt,
  ShowerHead,
  Sparkles,
  Store,
  Sun,
  Trash2,
  Tv,
  Utensils,
  UtensilsCrossed,
  Users,
  Volume2,
  VolumeX,
  Waves, // v11 G2 环境音效
  X,
  Zap,
  ZoomIn,
  ZoomOut,
  Dog, // v8.3 第二只宠物
  Rabbit, // v8.3 第二只宠物
  Lock, // v8.3 未解锁把戏
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import Joystick from './Joystick';
import InstrumentOverlay from './InstrumentOverlay';
import { SongSheet } from './SongSheet';
import { useMusic } from '@/lib/ios/music-store';
import { useMiniPlayer } from '@/components/ios/MusicGlobalMini';
import { localDB, genId } from '@/lib/ios/db';
import { useWeatherSnapshot } from '../weather-core';
import { addAlbum } from '@/lib/ios/album-store';
import { readInviteMeta } from '@/lib/ios/couple-invite';
import {
  BATH_X1,
  CATALOG,
  DOORS,
  FURN_SETS,
  PLAY_COOLDOWN,
  ROOM_SPANS,
  ROOM_NAMES,
  SEASONAL,
  SHOP_TABS,
  SNAP,
  TILT_LIMIT,
  WALL_H,
  WALL_SLOTS,
  WINS,
  WIN_NAMES,
  clampFurnToRooms,
  defaultHome,
  fetchRemote,
  footprintOf,
  loadCache,
  pushRemote,
  resetRemote,
  resolveDoorPos,
  resolveWinPos,
  roomAt,
  saveCache,
  saveCacheNow,
  snapToWallSlot,
  type HomePersist,
} from './catalog';
import { sfx } from './sfx';
import { getCachedThumb } from './scene/ShopThumbs';
import { useSettings } from '@/lib/ios/store';
import { type ContactRecord } from '@/lib/contacts';
import { listContacts, ownerRealName } from '@/lib/ios/contacts-store';
import { startWebSpeechSession, isWebSpeechSupported, type WebSpeechSession } from '@/lib/ios/web-speech';
import { createVoiceSegmenter, startManualRecording, transcribeBlob, type ManualRecording, type VoiceSegmenter } from '@/lib/ios/cabin-voice';
import { speakUserTts, stopSpeaking } from '@/lib/ios/tts-client';
import { type MemConvoTurn } from '@/lib/memory';
import { buildCabinSystem, cabinChatTurn, extractSongIntent, parseAiReply, type CabinContext } from './companion-brain';
import {
  buildDreamText,
  dayStr,
  loadDream,
  loadGreet,
  saveDream,
  saveGreet,
  loadMind,
  saveMind,
  tickMind,
  noteInteraction,
  applyNeedEffect,
  reinforceActivity,
  reinforceWeight,
  captureSpecialDay,
  todaySpecial,
  affinityLevelOf,
  buildDecisionPrompt,
  parseDecision,
  decideLocally,
  type CabinMind,
  type DecisionCtx,
  type DecisionResult,
} from './cabin-mind';
import { search as ncmSearch, songUrl as ncmSongUrl } from '@/lib/ios/music-api';
import CabinHistorySheet from './CabinHistorySheet';
import { prefetchSong, playRequestedSong, stopAiSong, AI_SONG_NAMES } from './ai-song';
import {
  cabinAfterChatTurn,
  cabinBehaviorMemoryOncePerDay,
  cabinEventMemory,
  cabinMemoryBlock,
  cabinRecentInteractions,
  setMemScopeForApp,
} from './companion-memory';
import { ensureTodayDiary } from './ta-diary';
import TaDiarySheet from './TaDiarySheet';
import type { CompanionCmd, CompanionEvent } from './scene/companion-rt';
import type { BubbleCmd } from './scene/HomeScene';
import type { BoyWear, CharAction, CharPose, CharRT, FurnitureItem, FurnitureKind, GirlWear, HomeMode, HomeState, HomeWeather, LayoutSnap, NoteEntry, Pet2State, PetCareKind, PetCoat, PetState, PetWear, RoomId } from './types';
import { sanitizeBoyWear, sanitizeWear } from './types';
import {
  addPetDiary,
  bumpCabinStats,
  loadCabinConvo,
  loadCabinStats,
  loadPetDiary,
  saveCabinConvo,
  sfxAmbient,
  type CabinStats,
} from './lib/cabin-storage';
import AdoptDialog from './panels/AdoptDialog';
import ChatBar from './panels/ChatBar';
import CompanionPicker from './panels/CompanionPicker';
import { BedColorPop, EditToolDock, EditZoomButtons, FurnSelBar, WallSelBar } from './panels/EditBars';
import PetActionBar from './panels/PetActionBar';
import PetDiarySheet from './panels/PetDiarySheet';
import { PartnerMenu, PartnerRing, RequestDialog, type CabinRequest } from './panels/PartnerOverlays';
import { PalettePanel, RoomStylePanel } from './panels/StylePanels';
import { CupBar, FurnActionBar, TvBar } from './panels/QuickBars';
import { HeartPanel, PetPanel, StatsPanel } from './panels/StatusPanels';
import TopBar from './panels/TopBar';
import {
  ACT_LABELS,
  anchorOf,
  AUTO_ACTS,
  CatFaceIcon,
  compressPhoto,
  ColorRow,
  DogFaceIcon,
  dirToHeading,
  decayPet,
  EDIT_GLASS,
  editDirBtn,
  editDirBtnBlue,
  editDirBtnAmber,
  FACE_ACTS,
  headingToDir,
  HIST_COALESCE,
  HIST_MAX,
  LIGHT_SWATCHES,
  LIFT_MAX,
  LIFT_STEP,
  normAngle,
  PET_ACTIONS,
  PET_BED_COLORS,
  petLevelGap,
  petLevelOf,
  PET_TRICK_DEFS,
  PetActionButton,
  PHOTO_ASPECTS,
  POSE_OF_ACT,
  RabbitFaceIcon,
  sanitizePet,
  sanitizePet2,
  sanitizePets2,
  SET_FALLBACK,
  SWATCHES,
  TILT_STEP,
  toolBtn,
  WASH_SECONDS,
  YAW_STEP,
  type EditSnap,
  type Toast,
} from './lib/home-core';
import Wardrobe from './Wardrobe';

/** 做饭小游戏（选菜谱→切菜/翻炒/装盘→上桌，v5.7 F5） */
const CookingGame = dynamic(() => import('./CookingGame'), { ssr: false });
/** 五子棋对弈（棋盘桌，v5.7 J7） */
const ChessOverlay = dynamic(() => import('./ChessOverlay'), { ssr: false });
/** 软木留言板（G8 共享留言板） */
const NotesOverlay = dynamic(() => import('./NotesOverlay'), { ssr: false });
/** 抓娃娃机（G10） */
const ClawMachineGame = dynamic(() => import('./games/ClawMachineGame'), { ssr: false });
/** 咖啡拉花（G10） */
const LatteArtGame = dynamic(() => import('./games/LatteArtGame'), { ssr: false });
/** 照片拼图（G10） */
const PuzzleGame = dynamic(() => import('./games/PuzzleGame'), { ssr: false });

const HomeScene = dynamic(() => import('./scene/HomeScene'), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 flex items-center justify-center bg-[#f3f0e8]">
      <div className="flex items-center gap-2 rounded-full bg-white/80 px-4 py-2 text-[13px] text-[#6b6b6b] shadow-sm">
        <Loader2 className="h-4 w-4 animate-spin text-[#e8a3b3]" />
        小家布置中…
      </div>
    </div>
  ),
});

/** 商城缩略图工作室（隐藏离屏画布，商品 1:1 快照） */
const ShopThumbStudio = dynamic(() => import('./scene/ShopThumbs'), { ssr: false });

let uid = 0;
/** 购买序号（同毫秒连点也保证 id 唯一 —— 商城无限添加不串档） */
let buySeq = 0;

// ---------------- 共享常量/纯函数/小型 UI 件（宠物状态、动作锚点、调色盘、编辑样式等） ----------------
// —— 已原样搬移到 ./lib/home-core.tsx（行为零变化） ----------------


// v11 I2 里程碑统计（在一起天数/聊天/做饭/拥抱/牵手/照顾宠物）与每角色会话存档
// —— 已原样搬移到 ./lib/cabin-storage.ts（行为零变化） ----------------

export default function CoupleHome({ close }: { close: () => void }) {
  // ---------------- 持久化状态 ----------------
  const [pack] = useState<HomePersist>(() => loadCache() ?? { home: defaultHome(), rev: 0 });
  const [items, setItems] = useState<FurnitureItem[]>(pack.home.furniture);
  const [night, setNight] = useState<boolean>(pack.home.night);
  const [rev, setRev] = useState<number>(pack.rev);
  const [win, setWin] = useState<boolean[]>([0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => !!pack.home.win?.[i]));
  const [floorCol, setFloorCol] = useState<string | undefined>(pack.home.floorCol);
  const [wallCol, setWallCol] = useState<string | undefined>(pack.home.wallCol);
  const [floorColBed, setFloorColBed] = useState<string | undefined>(pack.home.floorColBed);
  const [wallColBed, setWallColBed] = useState<string | undefined>(pack.home.wallColBed);
  const [doorOpen, setDoorOpen] = useState<boolean>(!!pack.home.doorOpen);
  const [kitchenDoorOpen, setKitchenDoorOpen] = useState<boolean>(!!pack.home.kitchenDoorOpen);
  const [doorCol, setDoorCol] = useState<string | undefined>(pack.home.doorCol);
  const [winCol, setWinCol] = useState<string | undefined>(pack.home.winCol);
  const [floorColK, setFloorColK] = useState<string | undefined>(pack.home.floorColK);
  const [wallColK, setWallColK] = useState<string | undefined>(pack.home.wallColK);
  const [floorColB, setFloorColB] = useState<string | undefined>(pack.home.floorColB);
  const [wallColB, setWallColB] = useState<string | undefined>(pack.home.wallColB);
  const [ceilCol, setCeilCol] = useState<string | undefined>(pack.home.ceilCol);
  const [ceilColBed, setCeilColBed] = useState<string | undefined>(pack.home.ceilColBed);
  const [ceilColK, setCeilColK] = useState<string | undefined>(pack.home.ceilColK);
  const [ceilColB, setCeilColB] = useState<string | undefined>(pack.home.ceilColB);
  const [bathDoorOpen, setBathDoorOpen] = useState<boolean>(!!pack.home.bathDoorOpen);
  const [winPos, setWinPos] = useState<number[] | undefined>(pack.home.winPos);
  const [doorPos, setDoorPos] = useState<{ bed: number; kt: number; bath: number; bal?: number } | undefined>(pack.home.doorPos);
  const [fp, setFp] = useState<boolean>(!!pack.home.fp);
  const [nightAuto, setNightAuto] = useState<boolean>(pack.home.nightAuto !== false);
  // v5.6：做饭一桌菜 / 地板墙面纹理；v6.2：衣柜穿搭（发型+连衣裙/分体+鞋）；v6.3 男生穿搭
  const [wear, setWear] = useState<GirlWear>(() => sanitizeWear(pack.home.wear));
  const [wear2, setWear2] = useState<BoyWear>(() => sanitizeBoyWear(pack.home.wear2));
  /** 衣柜弹窗（走到衣柜前弹出） */
  const [wardrobeOpen, setWardrobeOpen] = useState(false);
  /** 九扇窗是否存在（false = 已被收起；编辑模式可收起，商店可装回） */
  const [winExist, setWinExist] = useState<boolean[]>(() =>
    [0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => pack.home.winExist?.[i] !== false),
  );
  const [mealReady, setMealReady] = useState<boolean>(!!pack.home.mealReady);
  const [floorTex, setFloorTex] = useState<'plain' | 'wood' | 'check'>(pack.home.floorTex ?? 'wood');
  const [wallTex, setWallTex] = useState<'plain' | 'dot' | 'stripe'>(pack.home.wallTex ?? 'plain');
  // v5.7 拾光扩展：阳台门/色 + 好菜名 + 宠物
  const [balconyDoorOpen, setBalconyDoorOpen] = useState<boolean>(!!pack.home.balconyDoorOpen);
  // v10 扩建：书房门 / 花园栅栏门
  const [studyDoorOpen, setStudyDoorOpen] = useState<boolean>(!!pack.home.studyDoorOpen);
  const [gardenGateOpen, setGardenGateOpen] = useState<boolean>(!!pack.home.gardenGateOpen);
  const [floorColBal, setFloorColBal] = useState<string | undefined>(pack.home.floorColBal);
  const [wallColBal, setWallColBal] = useState<string | undefined>(pack.home.wallColBal);
  const [mealName, setMealName] = useState<string | undefined>(pack.home.mealName);

  // ---------------- UI 状态 ----------------
  const [mode, setMode] = useState<HomeMode>('live');
  const [selId, setSelId] = useState<string | null>(null);
  const [moveOn, setMoveOn] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [roomStyleOpen, setRoomStyleOpen] = useState(false);
  const [shopOpen, setShopOpen] = useState(false);
  const [shopTab, setShopTab] = useState<string>('all');
  const [thumbMap, setThumbMap] = useState<Record<string, string>>({});
  const [toasts, setToasts] = useState<Toast[]>([]);
  /** v5.7 拾光扩展面板：点歌 / 五子棋 / 做饭小游戏 / 拍照模式 */
  const [musicSheet, setMusicSheet] = useState(false);
  /** 右上角 ⋮ 更多菜单：时间变化 / 声音开关 / 视角 */
  const [moreOpen, setMoreOpen] = useState(false);
  const [chess, setChess] = useState<{ itemId: string } | null>(null);
  const [cookingGame, setCookingGame] = useState(false);
  // —— v6.1 G 系列：装修方案 / 留言板 / 三连小游戏 ——
  /** G1 装修方案（最多 3 套整屋快照） */
  const [layouts, setLayouts] = useState<LayoutSnap[]>(pack.home.layouts ?? []);
  /** G8 留言板便签 */
  const [notes, setNotes] = useState<NoteEntry[]>(pack.home.notes ?? []);
  const [noteOpen, setNoteOpen] = useState(false);
  /** G8 各自未读提醒只弹一次 */
  const notesRemindRef = useRef(false);
  /** G8 我方已读时间戳（打开面板时刷新） */
  const notesSeenRef = useRef<{ me?: number; partner?: number }>(pack.home.notesSeen ?? {});
  /** G10 娃娃机：正在玩的机器家具 id */
  const [clawFor, setClawFor] = useState<string | null>(null);
  /** G10 咖啡拉花小游戏 */
  const [latteOpen, setLatteOpen] = useState(false);
  /** G10 相框菜单（换照片/拼图）与拼图会话 */
  const [photoMenuFor, setPhotoMenuFor] = useState<string | null>(null);
  const [puzzleFor, setPuzzleFor] = useState<{ photo?: string } | null>(null);
  const [photoMode, setPhotoMode] = useState(false);
  /** E3 音效开关（持久化在 sfx 模块内 localStorage，挂载时读回） */
  const [sfxOn, setSfxOn] = useState(true);
  /** 天气（与天气 App 共享缓存）：v9 五档天气驱动室外世界（晴/多云/阴/雨/雪）+ 夜晚自动开灯 */
  const weather = useWeatherSnapshot();
  const weatherFx: HomeWeather = useMemo(() => {
    const c = weather?.current.code ?? 0;
    if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82) || (c >= 95 && c <= 99)) return 'rain';
    if ((c >= 71 && c <= 77) || c === 85 || c === 86) return 'snow';
    if (c === 0) {
      // 万里无云 → 晴天；每 3 小时按时间块轮换一朵云，外面看起来是活的天
      const blk = Math.floor(Date.now() / (3 * 3_600_000)) % 4;
      return blk === 1 ? 'cloudy' : 'sunny';
    }
    if (c === 1 || c === 2) return 'cloudy'; // 少云/多云
    if (c === 3 || c === 45 || c === 48) return 'overcast'; // 阴/雾
    return 'cloudy';
  }, [weather]);
  /** 音乐 App 正在放歌（音箱飘音符 + 黑胶/八音盒跟播联动） */
  const musicPlaying = useMusic((s) => s.playing);
  // 黑胶唱片机 / 八音盒随音乐播放自动转/停、开/合盖（v5.9 起跟播放态联动，八音盒 v6.0 加入）
  useEffect(() => {
    setItems((prev) => {
      let changed = false;
      const next = prev.map((f) => {
        if (f.kind !== 'vinyl' && f.kind !== 'musicBox') return f;
        if (!!f.st?.on === musicPlaying) return f;
        changed = true;
        return { ...f, st: { ...f.st, on: musicPlaying } };
      });
      return changed ? next : prev;
    });
  }, [musicPlaying]);
  /** 家具互动（生活模式）：点击可坐/睡/泡/淋浴/看电视/上网的家具后弹出确认按钮 */
  const [charAction, setCharAction] = useState<{
    type: CharAction['type'];
    itemId: string;
    active: boolean;
  } | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const photoTargetRef = useRef<string | null>(null);

  // ---------------- 小人运行时（ref 高频更新，不走 React） ----------------
  const meRT = useRef<CharRT>({
    x: pack.home.chars.me.x,
    z: pack.home.chars.me.z,
    heading: dirToHeading[pack.home.chars.me.dir] ?? 0,
    moving: false,
    target: null,
    nextWander: 3,
  });
  const taRT = useRef<CharRT>({
    x: pack.home.chars.partner.x,
    z: pack.home.chars.partner.z,
    heading: dirToHeading[pack.home.chars.partner.dir] ?? 0,
    moving: false,
    target: null,
    nextWander: 5,
  });
  const joyRef = useRef({ dx: 0, dy: 0 });
  /** 小人姿势（stand/sit/lie/bath + 支撑面高度）：GameLoop / Char3D 每帧读取 */
  const poseRef = useRef<{ pose: CharPose; y: number }>({ pose: 'stand', y: 0 });
  /** 正在执行的家具动作（走向家具 → 摆姿势） */
  const actRef = useRef<CharAction | null>(null);
  /** 自动结束型动作的定时器（做饭/喝东西/换装） */
  const actTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 乐器弹奏特写（吉他/钢琴：镜头推近 + 可弹奏覆盖层；ref 给 GameLoop 高频读） */
  const instRef = useRef<{ kind: 'piano' | 'guitar'; itemId: string } | null>(null);
  const [inst, setInst] = useState<{ kind: 'piano' | 'guitar'; itemId: string } | null>(null);
  // 音乐家具（唱片机/八音盒/音箱点歌 + 钢琴/吉他弹奏）放歌时：压制全局迷你播放器（退出小屋自动复位）
  useEffect(() => {
    useMiniPlayer.getState().setSuppress(musicPlaying || !!inst);
    return () => useMiniPlayer.getState().setSuppress(false);
  }, [musicPlaying, inst]);
  /** 手持物（拿饮料/咖啡后杯子握在右手，可以端着到处逛；coffee = 咖啡冒热气款；pet = 怀里抱着小猫） */
  const carryRef = useRef({ cup: false, coffee: false, pet: false });
  const [carryCup, setCarryCup] = useState(false);
  /** 编辑模式缩放指令（HUD 按钮 → Canvas 内相机） */
  const zoomCmd = useRef({ v: 0, dir: 0 });
  /** 四向微调指令（HUD 方向按钮 → Canvas 内按视角方位换算） */
  const moveCmd = useRef({ v: 0, dir: 'up' as 'up' | 'down' | 'left' | 'right' });

  // ---------------- 宠物「团子」（v6.9：体力/清洁/心情 + 改名，持久化在 HomeState.pet） ----------------
  const [pet, setPet] = useState<PetState>(() => sanitizePet(pack.home.pet));
  const petRef = useRef(pet);
  /** v9 领养宠物全家福（小狗/小兔子，可领养无数只；兼容旧单只 pet2 存档） */
  const [pets2, setPets2] = useState<Pet2State[]>(() => sanitizePets2(pack.home.pets2 ?? pack.home.pet2));
  const pets2Ref = useRef(pets2);
  useEffect(() => {
    pets2Ref.current = pets2;
  }, [pets2]);
  /** 兼容镜像：第一只领养宠物（旧存档/远端同步字段） */
  const pet2 = pets2[0];
  /** v9 当前互动宠物：'cat' = 团子；'p2:<i>' = 第 i 只领养宠物（头像点击依次轮换） */
  const [activePet, setActivePet] = useState<string>('cat');
  const activePetRef = useRef(activePet);
  useEffect(() => {
    activePetRef.current = activePet;
  }, [activePet]);
  /** 当前宠物序号（-1 = 猫） */
  const activePetIdx = activePet.startsWith('p2:') ? Math.max(0, Number(activePet.slice(3)) || 0) : -1;
  /** 当前互动宠物对象（统一成 PetState 形态：猫直接用；领养宠物补默认值） */
  const activePetObj: PetState =
    activePetIdx < 0
      ? pet
      : (() => {
          const p = pets2[activePetIdx];
          return p ? ({ st: 88, cl: 88, mo: 90, ts: Date.now(), ...p } as PetState) : pet;
        })();
  /** 当前宠物默认名 */
  const activePetName = activePetObj.name ?? (activePetIdx < 0 ? '团子' : activePetObj.kind === 'dog' ? '旺财' : '雪球');
  /** v8.3 领养弹窗 + 衣柜预设「宠物」栏 */
  const [adoptOpen, setAdoptOpen] = useState(false);
  const [wardrobeChar, setWardrobeChar] = useState<'girl' | 'boy' | 'pet'>('girl');
  petRef.current = pet;
  /** 宠物照顾指令（面板按钮 → PetBuddy/PetBuddy2；seq 递增触发新指令；carry=true 抱起模式；target 路由到对应宠物） */
  const petCmdRef = useRef<{ kind: PetCareKind; seq: number; carry?: boolean; target?: string } | null>(null);
  const petSeq = useRef(0);
  /** 状态面板开关 / 正在进行的照顾动作 / 改名弹层 */
  const [petPanel, setPetPanel] = useState(false);
  /** v7.1 宠物互动竖条开关：点击宠物才出现，点击别处（地面/家具）或照顾完成后自动收起 */
  const [petBarOpen, setPetBarOpen] = useState(false);
  /** 最近一次点宠物的时刻（ms）：down 命中宠物后，同一次点击的 up 射线会落到地板/家具上，用它区分「真点别处」 */
  const petTapAtRef = useRef(0);
  /** v8.0 同款守卫：down 命中陪伴小人后，同一次点击的 up 射线不能当作「点别处」关菜单 */
  const partnerTapAtRef = useRef(0);
  const [petCare, setPetCare] = useState<PetCareKind | null>(null);
  /** 照顾中镜像（供 beginAction 等旧回调读取，不引入重依赖） */
  const petCareRef = useRef<PetCareKind | null>(null);
  useEffect(() => {
    petCareRef.current = petCare;
  }, [petCare]);
  // —— v7.2 抱抱 = 抱起/放下：抱着时可随意走动，按钮变「放下」 ——
  /** 正抱着宠物（UI 态：抱抱按钮变「放下」） */
  const [carrying, setCarrying] = useState(false);
  /** 抱着镜像（供旧回调同步读取，免 useEffect 延迟） */
  const carryPetRef = useRef(false);
  /** 抱抱指令通道（on=true 抱起 / on=false 放下；seq 递增触发；target 路由） */
  const petCarryCmdRef = useRef({ on: false, seq: 0, target: undefined as string | undefined });
  const petCarrySeq = useRef(0);
  /** v8.3 玩具球扔球指令（seq 递增 = 扔一次；target 路由） */
  const petBallCmdRef = useRef({ seq: 0, target: undefined as string | undefined });
  const petBallSeq = useRef(0);
  const [petRenaming, setPetRenaming] = useState(false);
  const [petNameDraft, setPetNameDraft] = useState('');
  /** 宠物在线缓慢衰减（每 30s 结算一次；离线衰减在 sanitizePet 一次性追算；v9 领养宠物同频衰减） */
  useEffect(() => {
    const iv = setInterval(() => {
      setPet((p) => {
        const next = decayPet(p);
        return next.st === p.st && next.cl === p.cl && next.mo === p.mo ? p : next;
      });
      setPets2((prev) => {
        let changed = false;
        const next = prev.map((p) => {
          const cur = { st: 88, cl: 88, mo: 90, ts: Date.now(), ...p } as PetState;
          const d = decayPet(cur);
          if (d.st !== cur.st || d.cl !== cur.cl || d.mo !== cur.mo) {
            changed = true;
            return { ...p, st: d.st, cl: d.cl, mo: d.mo, ts: d.ts };
          }
          return p;
        });
        return changed ? next : prev;
      });
    }, 30000);
    return () => clearInterval(iv);
  }, []);

  // ---------------- 同步 refs（快照用） ----------------
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const nightRef = useRef(night);
  nightRef.current = night;
  const revRef = useRef(rev);
  revRef.current = rev;
  const winRef = useRef(win);
  winRef.current = win;
  const floorColRef = useRef(floorCol);
  floorColRef.current = floorCol;
  const wallColRef = useRef(wallCol);
  wallColRef.current = wallCol;
  const floorColBedRef = useRef(floorColBed);
  floorColBedRef.current = floorColBed;
  const wallColBedRef = useRef(wallColBed);
  wallColBedRef.current = wallColBed;
  const doorOpenRef = useRef(doorOpen);
  doorOpenRef.current = doorOpen;
  const kitchenDoorOpenRef = useRef(kitchenDoorOpen);
  kitchenDoorOpenRef.current = kitchenDoorOpen;
  const doorColRef = useRef(doorCol);
  doorColRef.current = doorCol;
  const winColRef = useRef(winCol);
  winColRef.current = winCol;
  const floorColKRef = useRef(floorColK);
  floorColKRef.current = floorColK;
  const wallColKRef = useRef(wallColK);
  wallColKRef.current = wallColK;
  const floorColBRef = useRef(floorColB);
  floorColBRef.current = floorColB;
  const wallColBRef = useRef(wallColB);
  wallColBRef.current = wallColB;
  const ceilColRef = useRef(ceilCol);
  ceilColRef.current = ceilCol;
  const ceilColBedRef = useRef(ceilColBed);
  ceilColBedRef.current = ceilColBed;
  const ceilColKRef = useRef(ceilColK);
  ceilColKRef.current = ceilColK;
  const ceilColBRef = useRef(ceilColB);
  ceilColBRef.current = ceilColB;
  const bathDoorOpenRef = useRef(bathDoorOpen);
  bathDoorOpenRef.current = bathDoorOpen;
  const winPosRef = useRef(winPos);
  winPosRef.current = winPos;
  const doorPosRef = useRef(doorPos);
  doorPosRef.current = doorPos;
  const fpRef = useRef({ on: fp });
  useEffect(() => {
    fpRef.current.on = fp;
  }, [fp]);
  const nightAutoRef = useRef(nightAuto);
  nightAutoRef.current = nightAuto;
  const wearRef = useRef(wear);
  wearRef.current = wear;
  const wear2Ref = useRef(wear2);
  wear2Ref.current = wear2;
  const winExistRef = useRef(winExist);
  winExistRef.current = winExist;
  const mealReadyRef = useRef(mealReady);
  mealReadyRef.current = mealReady;
  const floorTexRef = useRef(floorTex);
  floorTexRef.current = floorTex;
  const wallTexRef = useRef(wallTex);
  wallTexRef.current = wallTex;
  const balconyDoorOpenRef = useRef(balconyDoorOpen);
  balconyDoorOpenRef.current = balconyDoorOpen;
  const studyDoorOpenRef = useRef(studyDoorOpen);
  studyDoorOpenRef.current = studyDoorOpen;
  const gardenGateOpenRef = useRef(gardenGateOpen);
  gardenGateOpenRef.current = gardenGateOpen;
  const floorColBalRef = useRef(floorColBal);
  floorColBalRef.current = floorColBal;
  const wallColBalRef = useRef(wallColBal);
  wallColBalRef.current = wallColBal;
  const mealNameRef = useRef(mealName);
  mealNameRef.current = mealName;
  const layoutsRef = useRef(layouts);
  layoutsRef.current = layouts;
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const sfxOnRef = useRef(sfxOn);
  sfxOnRef.current = sfxOn;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  /** F1 节日限定：用户收起过的节日 kind（当月不再自动补） */
  const seasonalDismissed = useRef<Set<string>>(new Set());
  // ---------------- 装修历史：撤销/重做快照栈 ----------------
  const undoStack = useRef<EditSnap[]>([]);
  const redoStack = useRef<EditSnap[]>([]);
  /** 连续手势合并标记（拖拽帧/快速连点在时间窗内并入栈顶同一步） */
  const histTagRef = useRef<{ tag: string | null; at: number }>({ tag: null, at: 0 });
  /** 栈长度（驱动撤销/重做按钮禁用态） */
  const [histLen, setHistLen] = useState({ u: 0, r: 0 });

  /** 抓取当前可编辑状态快照（浅拷贝，防后续原地修改串档） */
  const takeSnap = useCallback(
    (): EditSnap => ({
      items: itemsRef.current.map((f) => ({ ...f, st: { ...f.st } })),
      winExist: winExistRef.current.slice(),
      winPos: winPosRef.current ? winPosRef.current.slice() : undefined,
      doorPos: doorPosRef.current ? { ...doorPosRef.current } : undefined,
      winCol: winColRef.current,
      doorCol: doorColRef.current,
      floorCol: floorColRef.current,
      wallCol: wallColRef.current,
      floorColBed: floorColBedRef.current,
      wallColBed: wallColBedRef.current,
      floorColK: floorColKRef.current,
      wallColK: wallColKRef.current,
      floorColB: floorColBRef.current,
      wallColB: wallColBRef.current,
      ceilCol: ceilColRef.current,
      ceilColBed: ceilColBedRef.current,
      ceilColK: ceilColKRef.current,
      ceilColB: ceilColBRef.current,
      floorColBal: floorColBalRef.current,
      wallColBal: wallColBalRef.current,
      floorTex: floorTexRef.current,
      wallTex: wallTexRef.current,
    }),
    [],
  );

  /** 每次装修操作前调用：当前状态入撤销栈、清空重做栈（tag = 连续手势标记） */
  const pushHistory = useCallback(
    (tag?: string) => {
      const now = Date.now();
      if (tag && histTagRef.current.tag === tag && now - histTagRef.current.at < HIST_COALESCE) {
        histTagRef.current.at = now; // 同一连续手势：栈顶快照已是手势起点，不重复入栈
        return;
      }
      histTagRef.current = { tag: tag ?? null, at: now };
      undoStack.current.push(takeSnap());
      if (undoStack.current.length > HIST_MAX) undoStack.current.shift();
      redoStack.current = [];
      setHistLen({ u: undoStack.current.length, r: 0 });
    },
    [takeSnap],
  );

  /** 重置/采纳对方布置后清空历史（快照已失效） */
  const clearHistory = useCallback(() => {
    undoStack.current = [];
    redoStack.current = [];
    histTagRef.current = { tag: null, at: 0 };
    setHistLen({ u: 0, r: 0 });
  }, []);

  // ---------------- 提示 ----------------
  const toast = useCallback((msg: string) => {
    const id = ++uid;
    setToasts((t) => [...t.slice(-2), { id, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2200);
  }, []);

  // ---------------- 快照与推送 ----------------
  const snap = useCallback((): HomePersist => {
    const home: HomeState = {
      v: 5,
      furniture: itemsRef.current,
      night: nightRef.current,
      win: winRef.current,
      winExist: winExistRef.current,
      winPos: winPosRef.current,
      doorPos: doorPosRef.current,
      floorCol: floorColRef.current,
      wallCol: wallColRef.current,
      floorColBed: floorColBedRef.current,
      wallColBed: wallColBedRef.current,
      floorColK: floorColKRef.current,
      wallColK: wallColKRef.current,
      floorColB: floorColBRef.current,
      wallColB: wallColBRef.current,
      ceilCol: ceilColRef.current,
      ceilColBed: ceilColBedRef.current,
      ceilColK: ceilColKRef.current,
      ceilColB: ceilColBRef.current,
      doorOpen: doorOpenRef.current,
      kitchenDoorOpen: kitchenDoorOpenRef.current,
      bathDoorOpen: bathDoorOpenRef.current,
      doorCol: doorColRef.current,
      winCol: winColRef.current,
      fp: fpRef.current.on,
      nightAuto: nightAutoRef.current,
      wear: wearRef.current,
      wear2: wear2Ref.current,
      mealReady: mealReadyRef.current,
      floorTex: floorTexRef.current,
      wallTex: wallTexRef.current,
      balconyDoorOpen: balconyDoorOpenRef.current,
      studyDoorOpen: studyDoorOpenRef.current,
      gardenGateOpen: gardenGateOpenRef.current,
      floorColBal: floorColBalRef.current,
      wallColBal: wallColBalRef.current,
      mealName: mealNameRef.current,
      layouts: layoutsRef.current,
      notes: notesRef.current,
      notesSeen: notesSeenRef.current,
      // 宠物状态（v6.9：名字 + 体力/清洁/心情，跨会话延续）
      pet: { ...petRef.current, ts: Date.now() },
      // v9 领养宠物全家福（pet2 为首只的兼容镜像）
      pets2: pets2Ref.current.map((p) => ({ ...p })),
      pet2: pets2Ref.current[0] ? { ...pets2Ref.current[0] } : undefined,
      // 正在进行的家具动作（已摆好姿势才存，重进页面接着坐/睡/泡/淋浴/看电视/上网；
      // 自动结束型不存 —— 重进后重新发起即可）
      act: (() => {
        const a = actRef.current;
        return a?.arrived && !AUTO_ACTS.has(a.type) ? { type: a.type, itemId: a.itemId } : undefined;
      })(),
      chars: {
        me: {
          x: Math.round(meRT.current.x * 100) / 100,
          z: Math.round(meRT.current.z * 100) / 100,
          dir: headingToDir(meRT.current.heading),
        },
        partner: {
          x: Math.round(taRT.current.x * 100) / 100,
          z: Math.round(taRT.current.z * 100) / 100,
          dir: headingToDir(taRT.current.heading),
        },
      },
    };
    return { home, rev: revRef.current };
  }, []);

  /** 采纳一份完整档案（远端冲突 / 初始化 / 重置共用） */
  const adoptHome = useCallback((h: HomeState) => {
    setItems(h.furniture);
    setNight(h.night);
    setWin([0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => !!h.win?.[i]));
    setFloorCol(h.floorCol);
    setWallCol(h.wallCol);
    setFloorColBed(h.floorColBed);
    setWallColBed(h.wallColBed);
    setFloorColK(h.floorColK);
    setWallColK(h.wallColK);
    setFloorColB(h.floorColB);
    setWallColB(h.wallColB);
    setCeilCol(h.ceilCol);
    setCeilColBed(h.ceilColBed);
    setCeilColK(h.ceilColK);
    setCeilColB(h.ceilColB);
    setDoorOpen(!!h.doorOpen);
    setKitchenDoorOpen(!!h.kitchenDoorOpen);
    setBathDoorOpen(!!h.bathDoorOpen);
    setDoorCol(h.doorCol);
    setWinCol(h.winCol);
    setWinPos(h.winPos);
    setDoorPos(h.doorPos);
    setFp(!!h.fp);
    setNightAuto(h.nightAuto !== false);
    setWear(sanitizeWear(h.wear));
    setWear2(sanitizeBoyWear(h.wear2));
    setWinExist([0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => h.winExist?.[i] !== false));
    // 宠物状态合并（v6.9）：照顾加成只增不减，取两侧较高值 ——
    // 避免在途旧档案的冲突采纳/延迟回滚把刚喂完的体力「弹回」旧值
    setPet((prev) => {
      const inc = sanitizePet(h.pet);
      return {
        name: prev.name && prev.name !== '团子' ? prev.name : inc.name || prev.name,
        st: Math.max(prev.st, inc.st),
        cl: Math.max(prev.cl, inc.cl),
        mo: Math.max(prev.mo, inc.mo),
        ts: Date.now(),
        // v8.3 成长/毛色/装扮：收养时间取更早（陪伴天数只多不少），照顾次数取较多，装扮/毛色远端有就用远端
        since: Math.min(prev.since ?? Date.now(), inc.since ?? Date.now()),
        care: Math.max(prev.care ?? 0, inc.care ?? 0),
        coat: inc.coat ?? prev.coat,
        wear: inc.wear ?? prev.wear,
      };
    });
    // v9 领养宠物全家福（远端有就用远端；兼容旧单只）
    setPets2(sanitizePets2(h.pets2 ?? h.pet2));
    setMealReady(!!h.mealReady);
    setFloorTex(h.floorTex ?? 'wood');
    setWallTex(h.wallTex ?? 'plain');
    setBalconyDoorOpen(!!h.balconyDoorOpen);
    setStudyDoorOpen(!!h.studyDoorOpen);
    setGardenGateOpen(!!h.gardenGateOpen);
    setFloorColBal(h.floorColBal);
    setWallColBal(h.wallColBal);
    setMealName(h.mealName);
    setLayouts(h.layouts ?? []);
    setNotes(h.notes ?? []);
    notesSeenRef.current = h.notesSeen ?? {};
    clearHistory();
    // 恢复「我」正在进行的家具动作（仅在当前没有进行中动作时：
    // 初始化/重置/409 采纳互不打架；家具已被删或自动结束型动作则忽略）
    if (!actRef.current && poseRef.current.pose === 'stand' && h.act && !AUTO_ACTS.has(h.act.type)) {
      const a = h.act;
      const it = h.furniture.find((f) => f.id === a.itemId);
      const full = it ? anchorOf(a.type, it) : null;
      if (full) {
        full.arrived = true;
        actRef.current = full;
        poseRef.current.pose = full.pose ?? POSE_OF_ACT[a.type];
        poseRef.current.y = full.y;
        setCharAction({ type: a.type, itemId: a.itemId, active: true });
      }
    }
  }, [clearHistory]);

  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pushTick = useRef(0);
  const doPush = useCallback(
    async (p: HomePersist) => {
      const res = await pushRemote(p);
      if (res === 'offline') return; // 网络失败：保持本地，稍后重试
      if ('conflict' in res) {
        // 采纳服务端最新
        const s = res.conflict;
        adoptHome(s.home);
        setRev(s.rev);
        meRT.current.x = s.home.chars.me.x;
        meRT.current.z = s.home.chars.me.z;
        taRT.current.x = s.home.chars.partner.x;
        taRT.current.z = s.home.chars.partner.z;
        saveCacheNow(s);
        toast('已同步对方的最新布置');
        return;
      }
      setRev(res.rev);
    },
    [toast, adoptHome],
  );

  const schedulePush = useCallback(
    (_p?: HomePersist) => {
      // ⚑ 快照在推送定时器触发时才生成（ref 渲染后已最新）：
      //   旧版在 schedulePush 调用瞬间抓快照 —— 门刚点开时 ref 还是旧值，
      //   且 2.5s 内若有一笔在途旧 rev 推送落到服务端，409 采纳会把刚开
      //   的门「回滚关闭」。现在统一在触发时取最新 ref + 最新 rev。
      if (pushTimer.current) clearTimeout(pushTimer.current);
      pushTimer.current = setTimeout(() => {
        const data = snap();
        saveCache(data); // idb 节流写
        void doPush(data);
      }, 2500);
      // 快速本地落盘（setState 渲染完成后 ref 已最新，~60ms 足够）
      setTimeout(() => saveCache(snap()), 60);
    },
    [snap, doPush],
  );

  const saveSoon = useCallback(() => schedulePush(), [schedulePush]);

  /** v9 领养新伙伴（小狗/小兔子；可以领养无数只，弹窗不关接着领） */
  const adoptPet2 = useCallback(
    (kind: 'dog' | 'rabbit') => {
      setPets2((prev) => {
        if (prev.length >= 24) {
          toast('家里已经热热闹闹啦，先照顾好眼前的小家伙们吧～');
          return prev;
        }
        const nm = kind === 'dog' ? '旺财' : '雪球';
        return [...prev, sanitizePet2({ kind, name: nm, since: Date.now() })!];
      });
      setActivePet(`p2:${Math.max(0, pets2Ref.current.length)}`);
      sfx.pop();
      toast(kind === 'dog' ? '小狗摇着尾巴进家门啦，快去摸摸它～' : '小兔子一蹦一蹦地住进来啦，软软的～');
      saveSoon();
    },
    [toast, saveSoon],
  );
  /** v9 衣柜改宠物毛色/装扮（宠物栏；改当前选中的那只） */
  const changePetLook = useCallback(
    (patch: { coat?: PetCoat; wear?: PetWear }) => {
      if (activePetRef.current === 'cat') {
        setPet((p) => ({ ...p, coat: patch.coat ?? p.coat, wear: patch.wear ?? p.wear }));
      } else {
        const i = Number(activePetRef.current.slice(3)) || 0;
        setPets2((prev) => prev.map((p, j) => (j === i ? { ...p, coat: patch.coat ?? p.coat, wear: patch.wear ?? p.wear } : p)));
      }
      saveSoon();
    },
    [saveSoon],
  );

  // ================================================================
  // v8.0 陪伴交互系统（拾光小屋 × AI 角色）：
  // 入口联系人选择 → 对话（头顶气泡 + TTS + 麦克风）→ 物理指令（A* 寻路）→
  // 拥抱/牵手 → 主动请求 → 自主行动 → 全事件记忆入库（见 companion-memory/brain）
  // ================================================================

  /** 选定的陪伴角色（联系人；null = 尚未选择 → 弹选择列表） */
  const [companion, setCompanion] = useState<ContactRecord | null>(null);
  /** 联系人列表（选择弹窗数据） */
  const [contacts, setContacts] = useState<ContactRecord[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  /** 机主真实名字（人设/记忆视角统一用） */
  const ownerNameRef = useRef('');
  /** 陪伴指令通道（UI → HomeScene 状态机；seq 递增触发） */
  const companionCmdRef = useRef<CompanionCmd | null>(null);
  const companionSeq = useRef(0);
  /** 多步动作队列（AI 输出 goto+sit 等序列：上一个 arrive 后接续下发） */
  const companionQueueRef = useRef<Omit<CompanionCmd, 'seq'>[]>([]);
  /** 陪伴小人当前状态（context/交互守卫用） */
  const companionStateRef = useRef<
    'idle' | 'walking' | 'near' | 'sitting' | 'lying' | 'watching' | 'hug' | 'hold' | 'playing' | 'cooking' | 'singing' | 'eating' | 'sleeping'
  >('idle');
  /** v8.1 陪伴小人正在弹奏的乐器（Furn3D 音符联动；null = 没在弹） */
  const [partnerPlaying, setPartnerPlaying] = useState<string | null>(null);
  /** 牵手进入的最近房间（空间记忆去重） */
  const holdRoomRef = useRef<RoomId | null>(null);
  /** 3D 头顶气泡队列（HomeScene.HeadBubbles 消费） */
  const bubbleRef = useRef<BubbleCmd[]>([]);
  /** 聊天输入框开合 / 文本 / 发送中 */
  const [chatOpen, setChatOpen] = useState(false);
  const [chatText, setChatText] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  /** 麦克风（Web Speech 实时识别：开 = 说话中，再点 = 停止并自动发送） */
  const [micOn, setMicOn] = useState(false);
  const micSessionRef = useRef<WebSpeechSession | null>(null);
  /** 小人声音开关（⋮ 菜单；持久化 localStorage；关 = 只显示气泡不说话） */
  const [voiceOn, setVoiceOn] = useState(() => {
    try {
      return typeof window !== 'undefined' && window.localStorage.getItem('cabin-voice-on') === '1';
    } catch {
      return false;
    }
  });
  const voiceOnRef = useRef(voiceOn);
  useEffect(() => {
    voiceOnRef.current = voiceOn;
  }, [voiceOn]);
  /** 待发送照片（识图描述注入本轮情境） */
  const pendingPhotoRef = useRef<string | null>(null);
  const [photoChip, setPhotoChip] = useState(false);
  const chatPhotoInputRef = useRef<HTMLInputElement>(null);
  /** 会话上下文（LLM 消息）与记忆提取轮次 */
  const convoRef = useRef<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const convoTurnsRef = useRef<MemConvoTurn[]>([]);
  /** 点陪伴小人弹出的环形菜单（拥抱/牵手/松开） */
  const [partnerMenuOpen, setPartnerMenuOpen] = useState(false);
  /** 牵手中（UI 态：菜单变「松开」） */
  const [holdingUI, setHoldingUI] = useState(false);
  /** AI 主动请求弹窗（想要拥抱/牵手）；类型抽到 panels/PartnerOverlays.tsx 共用 */
  const [request, setRequest] = useState<CabinRequest | null>(null);
  /** 请求弹窗文案（v10 主动聊天/喊你吃饭/想你） */
  /** 上次主动请求处置时刻（冷却） */
  const requestCooldownRef = useRef(0);
  /** 自主行动调度（上次触发时刻） */
  const autoNextAtRef = useRef(Date.now() + 50_000);
  /** v8.2 优化D「一起做动作」：AI 回复带 watch/eat/play 且用户说了「一起/陪」→ 到位后招呼用户同步入座 */
  const togetherRef = useRef<'watch' | 'eat' | 'play' | null>(null);
  /** v8.2 优化C：陪伴小人夜里睡着（UI 态，驱动梦境气泡） */
  const [sleepingUi, setSleepingUi] = useState(false);
  // ---------------- v11：互动轮盘 / 日记 / 里程碑 / 环境音 / 猫窝换色 ----------------
  /** v11 I1 长按 TA 弹出的互动轮盘（摸头/喂食/挠痒痒；短按仍是拥抱/牵手菜单） */
  const [ringOpen, setRingOpen] = useState(false);
  /** v11 F2 TA 的日记抽屉 */
  const [taDiaryOpen, setTaDiaryOpen] = useState(false);
  /** v11 I2 里程碑面板 */
  const [statsOpen, setStatsOpen] = useState(false);
  /** v11 I2 打开面板那一刻的快照（事件处理器里从 statsRef 拷入，避免渲染期读 ref） */
  const [statsSnap, setStatsSnap] = useState<CabinStats | null>(null);
  /** v11 I2 里程碑数据（since = 首次记录时间；事件处累加，面板打开时拷成快照展示） */
  const statsRef = useRef<CabinStats | null>(null);
  useEffect(() => {
    statsRef.current = companion ? loadCabinStats(companion.id) : null;
  }, [companion?.id, companion]);
  /** v11 F2 日记素材：今天 TA 做过的事（跨天自动重置，同一天去重） */
  const taDayActionsRef = useRef<{ date: string; items: string[] }>({ date: '', items: [] });
  /** v11 F2 日记素材：今天和主人聊的句数（日记落盘后清零） */
  const taChatCountRef = useRef(0);
  /** v11 G2 环境白噪音开关（⋮ 菜单；默认开；sfx.ambient 防御式调用，未实现时 no-op） */
  const [ambientOn, setAmbientOn] = useState(() => {
    try {
      return typeof window === 'undefined' || window.localStorage.getItem('cabin-ambient-on') !== '0';
    } catch {
      return true;
    }
  });
  const ambientOnRef = useRef(ambientOn);
  useEffect(() => {
    ambientOnRef.current = ambientOn;
  }, [ambientOn]);
  /** v11 H3 猫窝换色小色板（装修模式选中猫窝时弹出） */
  const [bedColorOpen, setBedColorOpen] = useState(false);
  // ---------------- v10 决策大脑：内心状态 / 强化 / 真歌 / 对讲 / 历史面板 ----------------
  /** TA 的内心状态（需求/情绪/甜度/闹脾气/强化/纪念日；按角色分档持久化） */
  const mindRef = useRef<CabinMind | null>(null);
  useEffect(() => {
    mindRef.current = companion ? loadMind(companion.id) : null;
  }, [companion?.id, companion]);
  /** 最近一次自主活动（行为强化归因：被夸/被嫌弃记在它头上） */
  const lastActRef = useRef<string>('');
  /** 最近一次弹/放的歌名（B1：被夸时记到歌维度，TA 自主弹琴时优先挑「上次你说好听的那首」） */
  const lastSongTitleRef = useRef<string>('');
  /** 下次决策时间 */
  const decideNextAtRef = useRef(Date.now() + 60_000);
  /** 决策连续失败次数（A3 修复：连续失败指数拉长决策间隔，恢复即回正常节奏） */
  const decideFailRef = useRef(0);
  /** B1 真歌播放器（网易云直链；null = 没在放） */
  const realAudioRef = useRef<HTMLAudioElement | null>(null);
  /** v10 E1 聊天记录回看面板 */
  const [chatHistOpen, setChatHistOpen] = useState(false);
  /** v10 C4 宠物日记面板 */
  const [petDiaryOpen, setPetDiaryOpen] = useState(false);
  /** v10 E2 连续语音对讲 */
  const [intercomOn, setIntercomOn] = useState(false);
  const intercomAliveRef = useRef(false);
  /** v10.3 语音输入兜底：录音（Web Speech 没结果时走服务端 ASR）/ 对讲分段器 */
  const micRecRef = useRef<{ rec: ManualRecording | null; stream: MediaStream } | null>(null);
  const intercomSegRef = useRef<VoiceSegmenter | null>(null);
  const intercomStreamRef = useRef<MediaStream | null>(null);
  const intercomPreviewRef = useRef<WebSpeechSession | null>(null);
  /** v10.3 TA 的心独立面板（顶栏爱心按钮） */
  const [heartOpen, setHeartOpen] = useState(false);
  /** 上一次室外天气（变化沿触发联动） */
  const prevWeatherRef = useRef<string>('');
  /** 特殊日子当日已主动过（防重复） */
  const specialDoneRef = useRef('');
  /** ⋮ 菜单甜度刷新（决策心跳顺带触发） */
  const [, setMindTick] = useState(0);
  /** beginAction 桥（定义在后文，事件回调先定义 → 用 ref 转发） */
  const beginActionRef = useRef<(type: CharAction['type'], item: FurnitureItem) => void>(() => {});

  /** 下发陪伴指令（seq 递增；状态机在 HomeScene.GameLoop 消费） */
  const issueCompanionCmd = useCallback((cmd: Omit<CompanionCmd, 'seq'>) => {
    companionSeq.current += 1;
    companionCmdRef.current = { ...cmd, seq: companionSeq.current };
    if (cmd.kind !== 'free') companionStateRef.current = 'walking';
    else companionStateRef.current = 'idle';
    setSleepingUi(false); // 任何新指令都会把睡着的小人叫醒
    // v10 A2 点歌预取：TA 还在走向乐器/音箱的路上就开始记谱（曲库命中的零开销），
    // 到位时谱子大概率已就绪 → 即刻开弹，LLM 记谱延迟被走路时间吃掉
    if ((cmd.kind === 'play' || cmd.kind === 'music') && cmd.song?.trim()) prefetchSong(cmd.song);
  }, []);

  /** v11 F2 日记素材：记一件 TA 今天做的事（跨天自动重置，同一天去重防刷屏） */
  const noteTaAction = useCallback((text: string) => {
    const day = dayStr();
    const cur = taDayActionsRef.current;
    if (cur.date !== day) taDayActionsRef.current = { date: day, items: [text] };
    else if (!cur.items.includes(text) && cur.items.length < 12) cur.items.push(text);
  }, []);

  // ---------------- v10 决策大脑：气泡/结算/真歌 帮手 ----------------

  /** 头顶气泡（kind='thought' 渲染成想法气泡） */
  const say = useCallback((text: string, hold?: number, kind?: 'thought') => {
    bubbleRef.current.push({ who: 'ta', text, hold, ...(kind ? { kind } : {}) });
  }, []);

  /** v11 TA 主动开口（讲梦/早安晚安）：头顶气泡 + 聊天面板插入一条 + 会话存档落盘 */
  const taProactiveSay = useCallback(
    (text: string) => {
      say(text, 7);
      convoTurnsRef.current = [...convoTurnsRef.current, { role: 'peer' as const, text }].slice(-40);
      convoRef.current = [...convoRef.current, { role: 'assistant' as const, content: text }].slice(-40);
      if (companion) saveCabinConvo(companion.id, convoRef.current, convoTurnsRef.current);
    },
    [companion, say],
  );

  /** 停掉真歌（B1） */
  const stopRealSong = useCallback(() => {
    const a = realAudioRef.current;
    realAudioRef.current = null;
    if (a) {
      try {
        a.pause();
        a.src = '';
      } catch {
        /* 已释放 */
      }
    }
  }, []);

  /** B1 音箱放真歌：点歌名 → 网易云搜歌 → 直链播放；失败自动重试一次（换下一首候选/关键词降级），
   *  两次都失败返回 false（调用方回落八音盒合成旋律 —— v10 C3） */
  const playRealSong = useCallback(
    async (song?: string): Promise<boolean> => {
      stopRealSong();
      /** 单次尝试：candidateIdx = 用搜到的第几首；kwSuffix = 关键词降级后缀 */
      const tryOnce = async (candidateIdx: number, kwSuffix = ''): Promise<boolean> => {
        try {
          const kw = `${(song ?? '').trim() || '轻音乐 纯音乐'}${kwSuffix}`;
          const res = await ncmSearch(kw, 1, 6);
          const pick = res.songs?.[candidateIdx] ?? res.songs?.[0];
          if (!pick) return false;
          const u = await ncmSongUrl(pick.id, 'standard');
          if (!u.url) return false;
          const audio = new Audio(u.url);
          audio.volume = 0.5;
          audio.loop = true;
          realAudioRef.current = audio;
          await audio.play();
          return true;
        } catch {
          return false;
        }
      };
      if (await tryOnce(0)) return true;
      // C3 重试：第一次失败（搜不到/直链 403/播放被网络掐断）→ 换第二首候选再试一次
      return tryOnce(1, (song ?? '').trim() && !(song ?? '').includes('纯音乐') ? ' 轻音乐' : '');
    },
    [stopRealSong],
  );

  /** 需求结算快捷方式（伴随活动） */
  const settleMind = useCallback(
    (effect: Partial<{ food: number; energy: number; mood: number; social: number }>, act?: string) => {
      const m = mindRef.current;
      if (!m || !companion) return;
      applyNeedEffect(companion.id, m, effect);
      if (act) lastActRef.current = act;
    },
    [companion],
  );

  /** 陪伴事件（状态机 → 宿主）：状态镜像 + 多步队列接续 + 全事件记忆入库 */
  const onCompanionEvent = useCallback(
    (e: CompanionEvent) => {
      if (e.ev === 'arrive') {
        if (e.kind === 'sit') companionStateRef.current = 'sitting';
        else if (e.kind === 'lie') {
          companionStateRef.current = e.memo === 'auto-night' ? 'sleeping' : 'lying';
          if (e.memo === 'auto-night') {
            setSleepingUi(true);
            noteTaAction('早早钻进了被窝');
          }
        }
        else if (e.kind === 'watch') { companionStateRef.current = 'watching'; settleMind({ mood: 7 }, 'watch'); noteTaAction('看了一会儿电视'); }
        else if (e.kind === 'play') {
          companionStateRef.current = 'playing';
          setPartnerPlaying(e.itemId ?? null);
          settleMind({ mood: 14, energy: -3 }, 'play');
          noteTaAction('弹了一首曲子');
          // v10 点歌出声：真实乐器音色弹奏（钢琴 grand / 吉他拨弦），音符可视化由 partnerPlayingId 联动；
          // 谱子三层取（曲库 → 记谱缓存 → LLM 现记，走路时已预取）——via 决定 toast 文案
          const inst = itemsRef.current.find((f) => f.id === e.itemId);
          const playKind = inst?.kind === 'guitar' ? 'guitar' : 'piano';
          void playRequestedSong(playKind, e.song).then((r) => {
            const name = companion?.name ?? 'TA';
            if (r.via !== 'improv') lastSongTitleRef.current = r.title; // B1：歌维度强化归因（即兴不算真歌）
            if (r.via === 'llm') toast(`${name}现记了《${r.title}》的谱子，弹给你听～`);
            else if (r.via === 'improv') toast(e.song?.trim() ? `《${e.song}》的谱没想起来，${name}即兴弹了一段～` : `${name}即兴弹了一段小曲～`);
            else toast(`${name}弹起了《${r.title}》～`);
          });
        } else if (e.kind === 'cook') { companionStateRef.current = 'cooking'; settleMind({}, 'cook'); }
        else if (e.kind === 'eat') { companionStateRef.current = 'eating'; settleMind({ food: 42, energy: 6, mood: 6 }, 'eat'); noteTaAction('吃了一顿饭'); }
        else if (e.kind === 'read') { companionStateRef.current = 'sitting'; settleMind({ mood: 6 }, 'read'); noteTaAction('看了会儿书'); }
        else if (e.kind === 'dance') { companionStateRef.current = 'playing'; settleMind({ mood: 14, energy: -4 }, 'dance'); noteTaAction('跳了一段舞'); }
        else if (e.kind === 'stretch') { companionStateRef.current = 'near'; settleMind({ mood: 4, energy: 2 }, 'stretch'); }
        else if (e.kind === 'water') { companionStateRef.current = 'playing'; settleMind({ mood: 6 }, 'water'); noteTaAction('浇了浇花'); }
        else if (e.kind === 'lamp') {
          // 指令「打开灯」：小人走到灯旁 → 宿主点亮最近的落地灯/台灯
          const lamp = itemsRef.current.find((f) => CATALOG[f.kind]?.light && (f.y ?? 0) < 0.5 && !f.st?.on);
          if (lamp) {
            setItems((prev) => prev.map((f) => (f.id === lamp.id ? { ...f, st: { ...f.st, on: true } } : f)));
            toast('灯亮起来啦，暖暖的～');
            saveSoon();
          }
          companionStateRef.current = 'near';
        } else if (e.kind === 'door') {
          // 指令「开门」或走路被关着的门挡住（memo=auto-open 自救开门）→ 宿主把那扇门打开
          const did = e.itemId;
          if (did === 'bed') setDoorOpen(true);
          else if (did === 'kt') setKitchenDoorOpen(true);
          else if (did === 'bath') setBathDoorOpen(true);
          else if (did === 'bal') setBalconyDoorOpen(true);
          if (did) {
            sfx.door();
            if (e.memo === 'auto-open') {
              toast(`${companion?.name ?? 'TA'}把门推开，自己走进去了～`);
            } else {
              toast('门开啦～');
              saveSoon();
            }
          }
          // 自动开门发生在走路途中：不改变状态镜像（还是 walking）
          if (e.memo !== 'auto-open') companionStateRef.current = 'near';
        } else if (e.kind === 'music') {
          // 指令「放歌」：走到音箱/唱片机前 → 打开它（音符飘出）+ 真歌播放（网易云直链，失败回落轻声八音盒）
          companionStateRef.current = 'singing';
          settleMind({ mood: 12 }, 'music');
          noteTaAction('放了首歌');
          const box = itemsRef.current.find((f) => f.id === e.itemId);
          if (box && !box.st?.on) {
            setItems((prev) => prev.map((f) => (f.id === box.id ? { ...f, st: { ...f.st, on: true } } : f)));
            saveSoon();
          }
          void playRealSong(e.song).then((ok) => {
            if (!ok) {
              // C3 两次都连不上真歌源 → 八音盒轻声循环（谱子同样三层取：曲库/缓存/现记）
              void playRequestedSong('musicbox', e.song, { loop: true, vol: 0.3 }).then((r) => {
                if (r.via !== 'improv') lastSongTitleRef.current = r.title; // B1：歌维度强化归因
                toast(
                  r.via === 'improv' && e.song?.trim()
                    ? `真歌源连不上，《${e.song}》的谱也没想起，用八音盒放了首轻音乐～`
                    : `放了首《${r.title}》～（真歌源连不上，用八音盒代替啦）`,
                );
              });
            } else {
              if (e.song?.trim()) lastSongTitleRef.current = e.song.trim(); // B1：歌维度强化归因
              toast(`音箱里放起了《${e.song ?? '一首好听的歌'}》，真的能听到哦～`);
            }
          });
          sfx.tap();
        } else if (e.kind === 'window') {
          // v10 B3 天气联动：TA 走到窗边开/关窗（memo = 'open' | 'close'；缺省关上开着的窗）
          const open = e.memo === 'open';
          const room = e.room ?? roomAt(taRT.current.x, taRT.current.z);
          const IDX: Partial<Record<RoomId, number[]>> = { lr: [0, 1, 2], br: [3, 4], kt: [5, 6], ba: [7, 8] };
          const targets = IDX[room] ?? [0, 1, 2];
          setWin((prev) => prev.map((v, i) => (targets.includes(i) ? open : v)));
          saveSoon();
          toast(open ? '窗户打开，风进来啦～' : '窗户关上啦，雨淋不进来～');
          companionStateRef.current = 'near';
        } else companionStateRef.current = 'near';
        // —— 记忆入库：用户指令成功执行（「用户让我去沙发上坐下」） ——
        if (companion && typeof e.memo === 'string' && e.memo.startsWith('cmd:')) {
          cabinEventMemory(companion.id, `${ownerNameRef.current || '主人'}让${companion.name}${e.memo.slice(4)}，TA 照做了。`, 'cabin-cmd', { dedupeSeconds: 120 });
        }
        // —— 自主行为记忆（同类一天只记一次，防刷屏） ——
        if (companion && e.memo === 'auto') {
          const room = roomAt(taRT.current.x, taRT.current.z);
          if (e.kind === 'sit') {
            cabinBehaviorMemoryOncePerDay(companion.id, 'sit', `${companion.name}自己在${ROOM_NAMES[room]}的椅子上坐了一会儿，放空休息。`);
          } else if (e.kind === 'watch') {
            cabinBehaviorMemoryOncePerDay(companion.id, 'watch', `${companion.name}打开电视，坐在电视前看了会儿节目。`);
          } else if (e.kind === 'play') {
            cabinBehaviorMemoryOncePerDay(companion.id, 'play', `${companion.name}走到乐器前，认认真真弹了一首曲子，屋里飘着音符。`);
          } else if (e.kind === 'cook') {
            cabinBehaviorMemoryOncePerDay(companion.id, 'cook', `${companion.name}系上围裙在灶台前忙活了一阵，给${ownerNameRef.current || '主人'}做了一顿饭。`);
          } else if (e.kind === 'music') {
            cabinBehaviorMemoryOncePerDay(companion.id, 'music', `${companion.name}打开音箱放了一首歌，跟着旋律轻轻哼了起来。`);
          } else if (e.kind === 'goto' && e.room) {
            cabinBehaviorMemoryOncePerDay(companion.id, `goto:${e.room}`, `${companion.name}自己溜达到了${ROOM_NAMES[e.room]}，看了看窗外的风景。`);
          }
        }
        // AI 多步动作队列：上一个到位 → 接续下发下一个
        const next = companionQueueRef.current.shift();
        if (next) setTimeout(() => issueCompanionCmd(next), 400);
        // —— v8.2 优化D「一起做动作」：AI 回应了「一起看电视/吃饭/弹琴」 → TA 到位后招呼用户同步入座 ——
        if (
          togetherRef.current &&
          (e.kind === togetherRef.current || (togetherRef.current === 'play' && e.kind === 'play')) &&
          (e.kind === 'watch' || e.kind === 'eat' || e.kind === 'play') &&
          e.itemId
        ) {
          const tk = togetherRef.current;
          togetherRef.current = null;
          const item = itemsRef.current.find((f) => f.id === e.itemId);
          if (item) {
            if (tk === 'eat' && !mealReadyRef.current) {
              toast('菜还没上桌，等做好了再一起吃呀～');
            } else if (tk === 'play') {
              // 弹琴：用户用「另一件」乐器（同一张琴凳坐不下）
              const other = itemsRef.current.find(
                (f) => f.id !== item.id && CATALOG[f.kind]?.acts?.play && (f.y ?? 0) < 0.45,
              );
              if (other && poseRef.current.pose === 'stand' && !actRef.current && !carryPetRef.current) {
                setTimeout(() => beginActionRef.current('play', other), 900);
              } else {
                toast(`${companion?.name ?? 'TA'}先为你弹一首，听完再点另一件乐器合奏吧～`);
              }
            } else if (poseRef.current.pose === 'stand' && !actRef.current && !carryPetRef.current) {
              setTimeout(() => {
                const it = itemsRef.current.find((f) => f.id === item.id);
                if (it) beginActionRef.current(tk, it);
              }, 900);
            } else {
              toast(`${companion?.name ?? 'TA'}已经入座啦，点同款家具加入 TA 吧～`);
            }
          }
        }
      } else if (e.ev === 'hugStart') {
        companionStateRef.current = 'hug';
        setHoldingUI(false);
        // —— v10 内心结算：拥抱 = 甜甜的互动 ——
        if (mindRef.current && companion) noteInteraction(companion.id, mindRef.current, { sweet: 5, social: 16, mood: 10 });
        // —— v11 I2 里程碑 + F2 日记素材 ——
        if (companion) {
          statsRef.current = bumpCabinStats(companion.id, { hugs: 1 });
          noteTaAction('和主人抱抱了');
        }
        // —— 物理动作记忆（关键）：拥抱成功 ——
        if (companion && e.memo === 'user-hug') {
          cabinEventMemory(companion.id, `${ownerNameRef.current || '主人'}在拾光小屋里主动拥抱了${companion.name}，TA 感觉很温暖。`, 'cabin-hug-user', { dedupeSeconds: 120 });
        } else if (companion && e.memo === 'ai-hug-yes') {
          cabinEventMemory(companion.id, `${companion.name}主动求抱抱，${ownerNameRef.current || '主人'}答应了，TA 开心极了。`, 'cabin-hug-ai', { dedupeSeconds: 120 });
        }
        sfx.kiss();
      } else if (e.ev === 'holdStart') {
        companionStateRef.current = 'hold';
        setHoldingUI(true);
        holdRoomRef.current = roomAt(taRT.current.x, taRT.current.z);
        // —— v10 内心结算：牵手 = 亲密互动 ——
        if (mindRef.current && companion) noteInteraction(companion.id, mindRef.current, { sweet: 4, social: 12, mood: 8 });
        // —— v11 I2 里程碑 + F2 日记素材 ——
        if (companion) {
          statsRef.current = bumpCabinStats(companion.id, { holds: 1 });
          noteTaAction('和主人牵手散步了');
        }
        // —— 物理动作记忆：牵手成功 ——
        if (companion && e.memo === 'user-hold') {
          cabinEventMemory(companion.id, `${ownerNameRef.current || '主人'}在拾光小屋里牵起了${companion.name}的手，十指相扣。`, 'cabin-hold-user', { dedupeSeconds: 120 });
        } else if (companion && e.memo === 'ai-hold-yes') {
          cabinEventMemory(companion.id, `${companion.name}主动想牵手，${ownerNameRef.current || '主人'}答应了。`, 'cabin-hold-ai', { dedupeSeconds: 120 });
        }
        sfx.tap();
      } else if (e.ev === 'release' || e.ev === 'giveup') {
        stopAiSong(); // v9：弹奏/放歌结束或中断 → 停掉旋律（新动作不会和旧旋律叠在一起）
        stopRealSong(); // v10：真歌也一并停掉
        // —— v8.1 完成时结算：做饭 → 一桌好菜上桌；放歌 → 关音箱；弹奏 → 清音符 ——
        if (e.ev === 'release' && e.memo === 'finish') {
          if (e.kind === 'cook') {
            setMealReady(true);
            toast(`${companion?.name ?? 'TA'}做好了饭，一桌好菜上桌啦，去餐桌「开饭」吧～`);
            if (companion) {
              cabinEventMemory(companion.id, `${companion.name}在灶台前做了一顿饭，把菜端上了餐桌。`, 'cabin-cook', { dedupeSeconds: 300 });
              statsRef.current = bumpCabinStats(companion.id, { meals: 1 }); // v11 I2 里程碑
            }
            noteTaAction('做了一顿饭'); // v11 F2 日记素材
            // —— v10 A5 任务链：做完饭 → 喊你吃饭（用户不在旁/没在吃时弹主动请求） ——
            const meRoom = roomAt(meRT.current.x, meRT.current.z);
            const taRoom = roomAt(taRT.current.x, taRT.current.z);
            if (Date.now() >= requestCooldownRef.current && !request) {
              setRequest({ kind: 'meal', text: '饭好啦，快来趁热吃呀！', at: Date.now() });
              say('饭好啦，快来趁热吃呀～', 5);
              requestCooldownRef.current = Date.now() + 4 * 60_000;
            } else if (meRoom !== taRoom) {
              say('饭好啦，我在餐桌这边等你～', 5);
            }
          } else if (e.kind === 'music') {
            setItems((prev) =>
              prev.map((f) => ((f.kind === 'speaker' || f.kind === 'radio') && f.st?.on ? { ...f, st: { ...f.st, on: false } } : f)),
            );
            saveSoon();
          } else if (e.kind === 'lie' && e.memo === 'finish') {
            if (companion) {
              cabinBehaviorMemoryOncePerDay(companion.id, 'sleep-wake', `${companion.name}睡了一觉醒来，伸了个懒腰。`);
            }
            // —— v10 需求结算：睡饱了 ——
            settleMind({ energy: 70, mood: 8 });
          }
        }
        setPartnerPlaying(null);
        companionStateRef.current = 'idle';
        setHoldingUI(false);
        togetherRef.current = null;
        setSleepingUi(false);
        if (companionQueueRef.current.length > 0) companionQueueRef.current = [];
      } else if (e.ev === 'room') {
        // —— 空间记忆：用户牵着我的手，带我去了×× ——
        holdRoomRef.current = e.room ?? null;
        if (companion && e.room) {
          cabinEventMemory(companion.id, `${ownerNameRef.current || '主人'}牵着${companion.name}的手，把 TA 带到了${ROOM_NAMES[e.room]}。`, `cabin-hold-room:${e.room}`, { dedupeSeconds: 600 });
        }
      }
    },
    [issueCompanionCmd, toast, saveSoon, companion, settleMind, playRealSong, stopRealSong, say, noteTaAction],
  );

  /** 进入小屋：拉联系人 + 恢复上次选定的陪伴角色（没有则弹选择列表） */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [all, myName] = await Promise.all([listContacts(), ownerRealName()]);
        if (!alive) return;
        setContacts(all);
        ownerNameRef.current = myName || useSettings.getState().profile.name || '主人';
        let savedId = '';
        try {
          savedId = window.localStorage.getItem('cabin-companion-id') ?? '';
        } catch {
          /* ignore */
        }
        const saved = savedId ? all.find((c) => c.id === savedId) : null;
        if (saved && saved.kind === 'char') {
          setCompanion(saved);
        } else {
          setPickerOpen(true);
        }
      } catch {
        if (alive) setPickerOpen(true);
      } finally {
        if (alive) setContacts((list) => list);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  /** 选定陪伴角色（记忆作用域按小屋账号落位） */
  const chooseCompanion = useCallback(
    (c: ContactRecord) => {
      setCompanion(c);
      setPickerOpen(false);
      // v8.2 优化A 聊天记录持久化：换人先封存上一任，再载入 TA 的历史会话（退出重进上下文不丢）
      if (companion) saveCabinConvo(companion.id, convoRef.current, convoTurnsRef.current);
      const saved = loadCabinConvo(c.id);
      convoRef.current = saved.convo;
      convoTurnsRef.current = saved.turns;
      try {
        window.localStorage.setItem('cabin-companion-id', c.id);
      } catch {
        /* ignore */
      }
      setMemScopeForApp('cabin');
      toast(
        saved.convo.length > 0
          ? `${c.name}回来了，还记得上次聊到哪儿～ 点击右上角 💬 继续聊`
          : `${c.name}走进了你搭的小家，点击右上角 💬 和 TA 说话吧～`,
      );
    },
    [toast, companion],
  );

  /** 切换角色（⋮ 菜单）：弹回选择列表并挂断当前语音 */
  const openPicker = useCallback(() => {
    stopSpeaking();
    setPickerOpen(true);
    setMoreOpen(false);
  }, []);

  /** 小人声音开关（⋮ 菜单） */
  const toggleVoice = useCallback(() => {
    setVoiceOn((on) => {
      const next = !on;
      voiceOnRef.current = next;
      try {
        window.localStorage.setItem('cabin-voice-on', next ? '1' : '0');
      } catch {
        /* ignore */
      }
      if (!next) stopSpeaking();
      toast(next ? '小人声音已开，TA 会开口说话啦～' : '小人声音已关，只显示文字气泡');
      return next;
    });
  }, [toast]);

  /** v11 G2 环境音效开关（⋮ 菜单；开 = 跟天气/壁炉智能联动；防御式调 sfx.ambient，未实现时静默 no-op） */
  const toggleAmbient = useCallback(() => {
    setAmbientOn((on) => {
      const next = !on;
      ambientOnRef.current = next;
      try {
        window.localStorage.setItem('cabin-ambient-on', next ? '1' : '0');
      } catch {
        /* ignore */
      }
      if (!next) sfxAmbient.ambient?.(null); // 关 = 恒静
      toast(next ? '环境音效已开：雨声/风雪/炉火会跟着天气走～' : '环境音效已关，屋子安静下来了');
      return next;
    });
  }, [toast]);

  /** 小人正在做的事（情境注入；pose/act/carry 镜像） */
  const myActivityText = useCallback((): string => {
    if (carryPetRef.current) return '怀里抱着小猫';
    const pose = poseRef.current.pose;
    if (actRef.current?.arrived) {
      const t = actRef.current.type;
      const label: Partial<Record<CharAction['type'], string>> = {
        sit: '坐着休息',
        lie: '躺在床上睡觉',
        bath: '在浴缸里泡澡',
        shower: '在淋浴',
        watch: '坐在电视前看电视',
        work: '用电脑上网',
        cook: '在灶台前做饭',
        eat: '在餐桌边吃饭',
        drink: '端着一杯冰饮',
        coffee: '端着一杯热咖啡',
        read: '坐着看书',
        play: actRef.current.pose === 'guitar' ? '抱着吉他弹奏' : '在弹钢琴',
        makeup: '在梳妆台前化妆',
        mirror: '在照镜子',
        game: '在打游戏',
        hotpot: '在吃火锅',
        dress: '在衣柜前换衣服',
      };
      if (label[t]) return label[t] as string;
    }
    if (meRT.current.moving) return '在屋里走来走去';
    if (pose === 'sit') return '坐着';
    return '站着放空';
  }, [meRT, poseRef, actRef]);

  /** 陪伴小人正在做的事（事件镜像 companionStateRef） */
  const charActivityText = useCallback((): string => {
    const s = companionStateRef.current;
    if (s === 'hug') return '正拥抱着你';
    if (s === 'hold') return '牵着你的手';
    if (s === 'sitting') return '坐在椅子上';
    if (s === 'sleeping') return '躺在床上睡得正香（做梦呢）';
    if (s === 'lying') return '躺在床上休息';
    if (s === 'watching') return '坐在电视前看电视';
    if (s === 'playing') return '正在弹奏乐器';
    if (s === 'cooking') return '正在灶台前做饭';
    if (s === 'singing') return '正在放歌听';
    if (s === 'eating') return '坐在餐桌边吃饭';
    if (s === 'walking') return '正在走路';
    if (s === 'near') return '站在你身边';
    return '在家里溜达';
  }, []);

  /** 采集实时情境（每轮对话现场组装 → AI 知道「我现在在干嘛」） */
  const collectContext = useCallback(
    (photoDesc?: string): CabinContext => {
      const meRoom = ROOM_NAMES[roomAt(meRT.current.x, meRT.current.z)];
      const taRoom = ROOM_NAMES[roomAt(taRT.current.x, taRT.current.z)];
      const nearby = itemsRef.current
        .filter((f) => (f.y ?? 0) < 0.9 && Math.hypot(f.x - taRT.current.x, f.z - taRT.current.z) < 1.35)
        .slice(0, 5)
        .map((f) => CATALOG[f.kind]?.name ?? f.kind);
      const now = new Date();
      return {
        userName: ownerNameRef.current || '主人',
        charName: companion?.name ?? 'TA',
        myRoom: meRoom,
        charRoom: taRoom,
        myActivity: myActivityText(),
        charActivity: charActivityText(),
        holdingHands: companionStateRef.current === 'hold',
        hugging: companionStateRef.current === 'hug',
        night: nightRef.current,
        weather: weatherFx === 'rain' ? '下雨' : weatherFx === 'snow' ? '下雪' : weatherFx === 'overcast' ? '阴天' : weatherFx === 'cloudy' ? '多云' : '晴（有太阳）',
        timeStr: now.toLocaleString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long', hour: '2-digit', minute: '2-digit' }),
        nearby,
        photoDesc,
      };
    },
    [companion, meRT, taRT, myActivityText, charActivityText, weatherFx],
  );

  /** 发送聊天（文字 / 麦克风转写 / 附照片 / 对讲机转写）→ 气泡 + TTS + 动作执行 + 记忆入库 */
  const sendChat = useCallback(async (override?: string) => {
    const text = (override ?? chatText).trim();
    if (!text || chatBusy || !companion) return;
    setChatText('');
    setChatBusy(true);
    // —— v11 I2 里程碑：聊天句数 +1；F2 日记素材 ——
    statsRef.current = bumpCabinStats(companion.id, { chatLines: 1 });
    taChatCountRef.current += 1;
    noteTaAction('和主人聊了会儿天');
    // —— v10 内心结算：聊天 = 互动（甜度+社交+想你衰减） ——
    const m0 = mindRef.current;
    if (m0 && companion) {
      noteInteraction(companion.id, m0, { sweet: 1, social: 14, mood: 4 });
      const dayLabel = captureSpecialDay(companion.id, m0, text);
      if (dayLabel) {
        toast(`TA 悄悄记下了：${dayLabel}`);
        say('（在心里默默记下了这个日子）', 4, 'thought');
      }
      // —— v10 A9 闹脾气：好话哄一哄就和好 ——
      if (m0.sulk.on && /对不起|别生气|不要生气|哄哄|原谅|爱你|想你|抱抱|我的错/.test(text)) {
        noteInteraction(companion.id, m0, { sweet: 6, social: 20, mood: 14 });
        say('……哼，这次就原谅你。下次不许再这么久不理我啦。', 6);
        cabinEventMemory(companion.id, `${ownerNameRef.current || '主人'}哄了闹脾气的${companion.name}，TA 心软和好了。`, 'cabin-reconcile', { dedupeSeconds: 600 });
      }
    }
    const photoDesc = pendingPhotoRef.current;
    pendingPhotoRef.current = null;
    setPhotoChip(false);
    // ① 用户消息 → 我的小人头顶气泡（10 秒淡出）
    bubbleRef.current.push({ who: 'me', text, hold: 10 });
    try {
      // ② 记忆召回 + 情境 + 人设 → system
      const memCtx = [text, ...convoRef.current.slice(-4).map((m) => m.content)].join(' ');
      const memoryBlock = cabinMemoryBlock(companion.id, memCtx, {
        user: ownerNameRef.current || null,
        peer: companion.name || null,
      });
      const ctx = collectContext(photoDesc ?? undefined);
      const system = buildCabinSystem(companion, memoryBlock, ctx);
      // ③ 会话上下文（最近 12 条）
      const history = convoRef.current.slice(-12);
      const userContent = photoDesc ? `${text}\n（随消息发来一张照片：${photoDesc}）` : text;
      // ④ 请求 AI
      const reply = await cabinChatTurn([{ role: 'system', content: system }, ...history, { role: 'user', content: userContent }], useSettings.getState().apiConfig);
      const parsed = parseAiReply(reply);
      // v8.2 优化D：用户说了「一起/陪」且回复带 看电视/吃饭/弹琴 → TA 到位后同步招呼
      if (/一起|陪我|陪我一起/.test(text) && parsed.actions.some((a) => ['watch', 'eat', 'play'].includes(a.type))) {
        const first = parsed.actions.find((a) => ['watch', 'eat', 'play'].includes(a.type));
        togetherRef.current = first?.type as 'watch' | 'eat' | 'play';
      }
      // ⑤ 记录会话（LLM 上下文 + 记忆提取轮次）
      convoRef.current.push({ role: 'user', content: userContent }, { role: 'assistant', content: parsed.raw });
      convoRef.current = convoRef.current.slice(-40);
      convoTurnsRef.current.push(
        { role: 'me', text },
        ...(parsed.msgs.length > 0 ? [{ role: 'peer' as const, text: parsed.msgs.join(' / ') }] : [{ role: 'peer' as const, text: parsed.raw.replace(/<<[\s\S]*?>>/g, '').trim() || '（笑了笑）' }]),
      );
      convoTurnsRef.current = convoTurnsRef.current.slice(-40);
      // ⑥ AI 消息逐条：头顶气泡 + （开声音时）TTS 播报
      const msgs = parsed.msgs.length > 0 ? parsed.msgs : ['……'];
      for (const m of msgs) {
        const est = Math.min(14, 2.6 + m.replace(/\s/g, '').length / 3.2);
        bubbleRef.current.push({ who: 'ta', text: m, hold: voiceOnRef.current ? est + 1.2 : est });
        if (voiceOnRef.current) {
          try {
            await speakUserTts({ text: m, contactId: companion.id, volume: 1, speed: 1.02 });
          } catch {
            // TTS 失败静默（文字气泡已展示）
          }
        } else {
          await new Promise((r) => setTimeout(r, Math.min(3600, 900 + m.length * 70)));
        }
      }
      // ⑦ 拦截动作块 → 寻路执行（多步排队；song/inst 参数透传点歌与乐器偏好）
      if (parsed.actions.length > 0) {
        const acts = parsed.actions.slice(0, 3);
        // v10 意图增强：模型发了 play/music 但 song/inst 没带全（参数遵循度不稳定），
        // 用户话里点名的歌与乐器本地补上 —— 「我说什么歌就弹什么歌」不依赖模型记参数
        const intent = extractSongIntent(text);
        if (intent) {
          for (const a of acts) {
            if (a.type !== 'play' && a.type !== 'music') continue;
            if (!a.song && intent.song) a.song = intent.song;
            if (a.type === 'play' && !a.inst && intent.inst) a.inst = intent.inst;
          }
        }
        const instIdOf = (inst?: 'piano' | 'guitar') =>
          inst ? itemsRef.current.find((f) => f.kind === inst && (f.y ?? 0) < 0.45)?.id : undefined;
        companionQueueRef.current = acts.slice(1).map((a) => ({
          kind: a.type as CompanionCmd['kind'],
          room: a.room,
          song: a.song,
          open: a.open,
          ...(a.type === 'play' && a.inst ? { itemId: instIdOf(a.inst) } : {}),
          memo: 'ai-act',
        }));
        issueCompanionCmd({
          kind: acts[0].type as CompanionCmd['kind'],
          room: acts[0].room,
          song: acts[0].song,
          open: acts[0].open,
          ...(acts[0].type === 'play' && acts[0].inst ? { itemId: instIdOf(acts[0].inst) } : {}),
          memo: 'ai-act',
        });
      } else {
        // v10 意图兜底：模型没发动作块（内置兜底模型偶尔偷懒，只回一句「我这就去弹」），
        // 但用户话里是明确的弹琴/放歌指令 → 本地补发动作，让 TA 说到做到
        const intent = extractSongIntent(text);
        if (intent) {
          const instItem =
            intent.type === 'play' && intent.inst
              ? itemsRef.current.find((f) => f.kind === intent.inst && (f.y ?? 0) < 0.45)
              : undefined;
          issueCompanionCmd({
            kind: intent.type,
            ...(intent.song ? { song: intent.song } : {}),
            ...(instItem ? { itemId: instItem.id } : {}),
            memo: 'intent-fallback',
          });
        }
      }
      // —— v10 A10 行为强化：刚做完的事被夸/被嫌弃 → 记下来影响以后 ——
      // v10.x：移出「AI 带动作块」分支——夸奖/嫌弃往往不带指令，AI 纯文字回应时也要结算归因；
      // B1：弹琴/放歌被夸除了记活动维度，还记歌维度（song:曲名）——TA 自主决策弹琴时优先挑「上次你说好听的那首」
      const m2 = mindRef.current;
      if (m2 && companion && ['play', 'cook', 'music', 'eat', 'dance'].includes(lastActRef.current)) {
        const lastSong = lastSongTitleRef.current;
        const songKey = (lastActRef.current === 'play' || lastActRef.current === 'music') && lastSong ? `song:${lastSong}` : '';
        if (/好听|真好听|弹得|唱得|真棒|好厉害|好棒|好喜欢|喜欢你|谢谢你|真好吃|好香/.test(text)) {
          if (songKey) reinforceActivity(companion.id, m2, songKey, true);
          reinforceActivity(companion.id, m2, lastActRef.current, true);
        } else if (/难听|不好听|难吃|太吵|不好吃|吵死了/.test(text)) {
          if (songKey) reinforceActivity(companion.id, m2, songKey, false);
          reinforceActivity(companion.id, m2, lastActRef.current, false);
        }
      }
      // ⑧ 对话记忆入库（标准管线：碎片 → 核心 → 长期；scene=拾光小屋）
      cabinAfterChatTurn(companion.id, useSettings.getState().apiConfig, convoTurnsRef.current.slice(-12), {
        user: ownerNameRef.current || null,
        peer: companion.name || null,
      });
      // v8.2 优化A：会话存档落盘（退出重进接着聊）
      saveCabinConvo(companion.id, convoRef.current, convoTurnsRef.current);
    } catch (err) {
      toast(err instanceof Error && err.message ? `TA 没能回话：${err.message}` : 'TA 没能回话，稍后再试试');
    } finally {
      setChatBusy(false);
    }
  }, [chatText, chatBusy, companion, collectContext, issueCompanionCmd, noteTaAction, toast]);

  /** 麦克风开关：开 = 录音 +（支持的浏览器）Web Speech 实时预览；再点 = 停止并自动发送。
   *  v10.3：Web Speech 没结果（国产安卓无识别引擎）时自动回退录音 → 服务端 ASR，两头都不空转 */
  const toggleMic = useCallback(() => {
    if (micOn) {
      const s = micSessionRef.current;
      micSessionRef.current = null;
      const recInfo = micRecRef.current;
      micRecRef.current = null;
      setMicOn(false);
      void (async () => {
        let text = '';
        // ① 先收 Web Speech（有的话零等待）
        try {
          if (s) text = (await s.stop()).trim();
        } catch {
          /* 实时识别失败 → 走录音兜底 */
        }
        // ② 没有结果 → 录音送服务端识别（内置 z-ai ASR，免配置）
        if (!text && recInfo?.rec) {
          try {
            const blob = await recInfo.rec.stop();
            text = await transcribeBlob(blob);
          } catch (e) {
            recInfo.stream.getTracks().forEach((t) => t.stop());
            toast(e instanceof Error ? e.message : '语音识别失败，再试一次～');
            return;
          }
        }
        recInfo?.stream.getTracks().forEach((t) => t.stop());
        if (text) {
          setChatText(text);
          // 复用 sendChat（override 转写文本），单一管线
          setTimeout(() => {
            setChatText('');
            void sendChat(text);
          }, 350);
        }
      })();
      return;
    }
    void (async () => {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        toast('拿不到麦克风权限，检查一下浏览器设置～');
        return;
      }
      // 录音兜底（Web Speech 不可用/无结果时的保底通道）+ 实时预览（支持才有）
      const rec = startManualRecording(stream);
      const wss = isWebSpeechSupported() ? startWebSpeechSession({ onPartial: (t) => setChatText(t) }) : null;
      if (!rec && !wss) {
        stream.getTracks().forEach((t) => t.stop());
        toast('这台设备不支持语音输入，打字告诉 TA 吧～');
        return;
      }
      micRecRef.current = { rec, stream };
      micSessionRef.current = wss;
      setMicOn(true);
      setChatText('');
      toast('在听…说完再点一下就发送');
    })();
  }, [micOn, sendChat, toast]);

  // ---------------- v10 E2 连续语音对讲：逐句自动发送 + 语音回复，免打字对讲机 ----------------

  /** 对讲机开关：开 = 持续监听（v10.3：录音自动分段 + 服务端识别，国产浏览器也能用；
   *  支持 Web Speech 的浏览器同时挂实时预览）；再点 = 关闭 */
  const toggleIntercom = useCallback(() => {
    if (intercomOn) {
      intercomAliveRef.current = false;
      const seg = intercomSegRef.current;
      intercomSegRef.current = null;
      const stream = intercomStreamRef.current;
      intercomStreamRef.current = null;
      const preview = intercomPreviewRef.current;
      intercomPreviewRef.current = null;
      setIntercomOn(false);
      setChatText('');
      if (preview) preview.abort();
      if (seg) void seg.stop();
      if (stream) stream.getTracks().forEach((t) => t.stop());
      toast('对讲模式已关');
      return;
    }
    if (micOn) {
      // 与单次麦克风互斥：先关掉它
      const ms = micSessionRef.current;
      micSessionRef.current = null;
      const mr = micRecRef.current;
      micRecRef.current = null;
      setMicOn(false);
      if (ms) ms.abort();
      if (mr) {
        mr.rec?.abort();
        mr.stream.getTracks().forEach((t) => t.stop());
      }
    }
    void (async () => {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        toast('拿不到麦克风权限，检查一下浏览器设置～');
        return;
      }
      const seg = createVoiceSegmenter({
        stream,
        onSegment: (blob) => {
          void (async () => {
            try {
              const t = await transcribeBlob(blob);
              if (t) {
                setChatText('');
                void sendChat(t);
              }
            } catch (e) {
              toast(e instanceof Error ? e.message : '没听清，再试一次～');
            }
          })();
        },
      });
      intercomPreviewRef.current = isWebSpeechSupported()
        ? startWebSpeechSession({ onPartial: (t) => setChatText(t) })
        : null;
      intercomSegRef.current = seg;
      intercomStreamRef.current = stream;
      intercomAliveRef.current = true;
      setIntercomOn(true);
      setChatText('');
      toast('对讲模式已开：直接说话就好，TA 会听到的～');
    })();
  }, [intercomOn, micOn, sendChat, toast]);

  /** v10.3 卸载时释放麦克风/分段器（对讲开着退出小屋不漏占用） */
  useEffect(
    () => () => {
      micRecRef.current?.stream.getTracks().forEach((t) => t.stop());
      intercomStreamRef.current?.getTracks().forEach((t) => t.stop());
      intercomPreviewRef.current?.abort();
      if (intercomSegRef.current) void intercomSegRef.current.stop();
    },
    [],
  );

  /** 聊天输入附照片 → 识图模型转文字（「我现在在干嘛」的摄像头通道） */
  const onChatPhoto = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      e.target.value = '';
      if (!f) return;
      const vc = useSettings.getState().visionConfig;
      if (!vc.baseUrl.trim()) {
        toast('先到「设置 › 识图模型」配好，TA 才能看懂照片～');
        return;
      }
      try {
        const dataUrl = await compressPhoto(f, 1, 640, 0.72);
        const res = await fetch('/api/vision', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ images: [dataUrl], config: { baseUrl: vc.baseUrl, apiKey: vc.apiKey, model: vc.model } }),
          signal: AbortSignal.timeout(45_000),
        });
        if (!res.ok) throw new Error('识图失败');
        const j = (await res.json()) as { desc?: string };
        if (j.desc) {
          pendingPhotoRef.current = j.desc.trim().slice(0, 300);
          setPhotoChip(true);
          toast('照片看懂啦，发送消息时 TA 就知道了～');
        } else throw new Error('没看出内容');
      } catch {
        toast('照片没看懂，再试一次？');
      }
    },
    [toast],
  );

  // ---------------- v8.0 模块四：点击交互（拥抱 / 牵手 / 松开） ----------------

  /** 点陪伴小人 → 环形菜单（生活模式） */
  const openPartnerMenu = useCallback(() => {
    partnerTapAtRef.current = Date.now(); // 守卫：同一次点击的 up 射线会落到地板/家具上，不能当作「点别处」
    if (modeRef.current !== 'live' || !companion) return;
    setPartnerMenuOpen((v) => !v);
    setPetBarOpen(false);
    setPetPanel(false);
    sfx.tap();
  }, [companion]);

  /** 拥抱：小人走过来 → 双方拥抱（v10：TA 闹脾气时会先扭过头去，要哄） */
  const startHug = useCallback(() => {
    setPartnerMenuOpen(false);
    if (!companion) return;
    if (poseRef.current.pose !== 'stand' || actRef.current) {
      toast('先站起来，才能好好抱抱呀～');
      return;
    }
    if (carryPetRef.current) {
      toast('怀里还抱着小家伙呢，先放它下来吧～');
      return;
    }
    const m = mindRef.current;
    if (m?.sulk.on && !m.sulk.refusedOnce) {
      m.sulk.refusedOnce = true;
      saveMind(companion.id, m);
      say('哼……谁让你这么久都不理我。', 5);
      toast('TA 在闹小脾气呢，说句好听的哄哄 TA 吧～');
      return;
    }
    issueCompanionCmd({ kind: 'hug', memo: 'user-hug' });
  }, [companion, issueCompanionCmd, say, toast]);

  /** 牵手：小人走过来牵起手 → 之后 0.5m 跟随移动 */
  const startHoldHand = useCallback(() => {
    setPartnerMenuOpen(false);
    if (!companion) return;
    if (poseRef.current.pose !== 'stand' || actRef.current) {
      toast('先站起来，才好牵手去散步呀～');
      return;
    }
    if (carryPetRef.current) {
      toast('先把小家伙放下来，再牵手吧～');
      return;
    }
    issueCompanionCmd({ kind: 'holdhand', memo: 'user-hold' });
  }, [companion, issueCompanionCmd, toast]);

  /** 松开手：解除跟随（环形菜单 / 牵手按钮） */
  const releaseHold = useCallback(() => {
    setPartnerMenuOpen(false);
    issueCompanionCmd({ kind: 'free', memo: 'release' });
    toast('松开了手，TA 又可以自由溜达啦～');
  }, [issueCompanionCmd, toast]);

  // ---------------- v11 I1 长按互动轮盘（摸头 / 喂食 / 挠痒痒；场景层区分短按=拥抱牵手菜单 / 长按=轮盘） ----------------

  /** TA 是否空闲（轮盘互动守卫：走路/做事/睡觉/照顾宠物中都算忙） */
  const taIdleForRing = useCallback(() => {
    const s = companionStateRef.current;
    return (s === 'idle' || s === 'near') && !petCareRef.current && !carryPetRef.current;
  }, []);

  /** 长按 TA → 弹轮盘（HomeScene onPartnerLongPress） */
  const openPartnerRing = useCallback(() => {
    partnerTapAtRef.current = Date.now(); // 同款守卫：同一次点击的 up 射线不当成「点别处」
    if (modeRef.current !== 'live' || !companion) return;
    setPartnerMenuOpen(false);
    setRingOpen(true);
    sfx.tap();
  }, [companion]);

  /** 摸头：空闲 → love 气泡 + 甜度/心情 + 记忆；忙碌 → toast */
  const ringPat = useCallback(() => {
    setRingOpen(false);
    if (!companion) return;
    if (!taIdleForRing()) {
      toast('TA 正忙着呢，等 TA 一下～');
      return;
    }
    bubbleRef.current.push({ who: 'ta', text: '最喜欢摸摸头了～', kind: 'love' });
    if (mindRef.current) noteInteraction(companion.id, mindRef.current, { sweet: 3, social: 0, mood: 6 });
    cabinEventMemory(companion.id, `${ownerNameRef.current || '主人'}摸了摸${companion.name}的头，TA 眯起眼睛很享受。`, 'cabin-ring-pat', { dedupeSeconds: 120 });
    noteTaAction('被主人摸了摸头');
    sfx.tap();
  }, [companion, taIdleForRing, toast, noteTaAction]);

  /** 喂食：TA 走到餐桌吃饭（饱腹 +42 由 eat 到位的既有结算统一给，不重复加） */
  const ringFeed = useCallback(() => {
    setRingOpen(false);
    if (!companion) return;
    const table = itemsRef.current.find((f) => CATALOG[f.kind]?.acts?.eat && (f.y ?? 0) < 0.45);
    if (!table) {
      toast('家里还没有餐桌呢，先去商店买一张吧～');
      return;
    }
    bubbleRef.current.push({ who: 'ta', text: '谢谢投喂！', kind: 'love' });
    issueCompanionCmd({ kind: 'eat', itemId: table.id, memo: 'user-feed' });
    cabinEventMemory(companion.id, `${ownerNameRef.current || '主人'}投喂了${companion.name}，TA 吃得津津有味。`, 'cabin-ring-feed', { dedupeSeconds: 120 });
    noteTaAction('被主人投喂了一顿');
  }, [companion, issueCompanionCmd, noteTaAction]);

  /** 挠痒痒：空闲 → 笑作一团 + 心情 +10 + 记忆；忙碌 → toast */
  const ringTickle = useCallback(() => {
    setRingOpen(false);
    if (!companion) return;
    if (!taIdleForRing()) {
      toast('TA 正忙着呢，等 TA 一下～');
      return;
    }
    bubbleRef.current.push({ who: 'ta', text: '哈哈哈…好痒～哈哈哈', kind: 'love' });
    if (mindRef.current) applyNeedEffect(companion.id, mindRef.current, { mood: 10 });
    cabinEventMemory(companion.id, `${ownerNameRef.current || '主人'}挠了挠${companion.name}的痒痒，TA 笑得直不起腰。`, 'cabin-ring-tickle', { dedupeSeconds: 120 });
    noteTaAction('被主人挠了痒痒');
    sfx.tap();
  }, [companion, taIdleForRing, toast, noteTaAction]);

  // ---------------- v8.0 模块五：AI 主动请求 + 自主行动 ----------------

  /** 同意 TA 的请求 → 拥抱/牵手/来身边/去吃饭（记忆在 hugStart/holdStart 事件里写） */
  const acceptRequest = useCallback(() => {
    if (!request || !companion) return;
    const kind = request.kind;
    setRequest(null);
    requestCooldownRef.current = Date.now() + 8 * 60_000;
    if (kind === 'meal') {
      say('那快去餐桌吧，凉了就不好吃啦！', 5);
      toast('去点餐桌上的「开饭」吧～');
      return;
    }
    if (kind === 'chat' || kind === 'miss') {
      // 想你/有话想说 → TA 走到你身边开口
      if (mindRef.current) noteInteraction(companion.id, mindRef.current, { sweet: 3, social: 16, mood: 6 });
      issueCompanionCmd({ kind: 'come', memo: 'ai-miss-yes' });
      return;
    }
    if (kind === 'hug') {
      // v9 拥抱不再因「坐着/躺着/在做事」而静默拒绝：TA 会走过来抱（坐着也抱得到）；只有抱着宠物时需要先放下
      if (carryPetRef.current) {
        toast('怀里还抱着小家伙呢，先放它下来再抱抱吧～');
        return;
      }
      issueCompanionCmd({ kind: 'hug', memo: 'ai-hug-yes' });
      return;
    }
    // 牵手需要一起走路：站不起来就温和提示（不记拒绝）
    if (poseRef.current.pose !== 'stand' || actRef.current || carryPetRef.current) {
      toast('先站起来，才好牵手去散步呀～');
      return;
    }
    issueCompanionCmd({ kind: 'holdhand', memo: 'ai-hold-yes' });
  }, [request, companion, issueCompanionCmd, toast]);

  /** 拒绝 TA 的请求 → 记忆「有点失落」 + 头顶小情绪（A3：心情/社交也会受伤） */
  const rejectRequest = useCallback(() => {
    if (!request || !companion) return;
    setRequest(null);
    requestCooldownRef.current = Date.now() + 8 * 60_000;
    if (mindRef.current) {
      applyNeedEffect(companion.id, mindRef.current, { mood: -8, social: -6 });
    }
    if (request.kind === 'hug') {
      cabinEventMemory(companion.id, `${companion.name}想求个抱抱，但被${ownerNameRef.current || '主人'}拒绝了，有点失落。`, 'cabin-hug-reject', { dedupeSeconds: 600 });
      bubbleRef.current.push({ who: 'ta', text: '呜……那好吧。', hold: 4.5 });
    } else if (request.kind === 'holdhand') {
      cabinEventMemory(companion.id, `${companion.name}想牵${ownerNameRef.current || '主人'}的手，但被拒绝了，有点小委屈。`, 'cabin-hold-reject', { dedupeSeconds: 600 });
      bubbleRef.current.push({ who: 'ta', text: '哦…那算了。', hold: 4.5 });
    } else if (request.kind === 'meal') {
      bubbleRef.current.push({ who: 'ta', text: '那我先帮你收着…饿了随时叫我哦。', hold: 5 });
    } else {
      bubbleRef.current.push({ who: 'ta', text: '……嗯，那你想聊的时候再叫我。', hold: 5 });
    }
  }, [request, companion]);

  /** 主动请求调度：不操作时每 30s 评估一次（45% 机会，8 分钟冷却，45s 自动消失） */
  useEffect(() => {
    const iv = setInterval(() => {
      if (!companion || modeRef.current !== 'live' || pickerOpen) return;
      if (request || partnerMenuOpen || chatBusy) return;
      if (Date.now() < requestCooldownRef.current) return;
      const s = companionStateRef.current;
      // v8.3 修正：只有 TA 真的空闲（站着/刚走到身边）才会撒娇；弹琴/做饭/吃饭/睡觉/走路中不打扰
      if (s !== 'idle' && s !== 'near') return;
      if (petCareRef.current || carryPetRef.current) return;
      if (Math.random() < 0.45) {
        requestCooldownRef.current = Date.now() + 5 * 60_000;
        setRequest({ kind: Math.random() < 0.62 ? 'hug' : 'holdhand', at: Date.now() });
      }
    }, 30_000);
    return () => clearInterval(iv);
  }, [companion, request, partnerMenuOpen, chatBusy, pickerOpen]);

  /** 请求弹窗 45s 自动消失（不表态 → 不记拒绝，TA 自己收回） */
  useEffect(() => {
    if (!request) return;
    const t = setTimeout(() => setRequest(null), 45_000);
    return () => clearTimeout(t);
  }, [request]);

  // ---------------- v10 A1/A2/A6/A7/A8 决策循环：TA 自己决定接下来做什么 ----------------

  /** 决策可用动作白名单（与 ACT 协议一致） */
  const MIND_ACTS = 'come|goto|sit|lie|watch|lamp|hug|holdhand|free|play|cook|music|door|eat|dance|stretch|water|read|window';

  useEffect(() => {
    const iv = setInterval(() => {
      const m = mindRef.current;
      if (!m || !companion) return;
      tickMind(companion.id, m); // 心跳：需求衰减 + 情绪推进（每 30s）
      setMindTick((t) => t + 1); // ⋮ 菜单甜度刷新

      // —— v11 F1/F2/I3 每日心跳：梦境生成 · TA 日记 · 早安晚安（不占决策节拍，每 30s 巡检各自「当天是否已完成」） ——
      const nowH = new Date();
      const today = dayStr(nowH);
      const hour = nowH.getHours();
      const stNow = companionStateRef.current;
      const taAsleep = stNow === 'sleeping' || stNow === 'lying';
      const dreamNow = loadDream(companion.id);
      // F1 ① 长睡中且今天还没生成梦 → 从记忆素材拼一条梦存起来（夜里 lie 长睡两种镜像都算；白天补睡不算）
      const taLongSleep = stNow === 'sleeping' || (stNow === 'lying' && nightRef.current);
      if (taLongSleep && (!dreamNow || dreamNow.date !== today)) {
        saveDream(companion.id, {
          date: today,
          text: buildDreamText({
            owner: ownerNameRef.current || '主人',
            recent: cabinRecentInteractions(companion.id, 5),
            petName: petRef.current.name ?? '小家伙',
          }),
          told: false,
        });
      }
      // F1 ② 早上 6~10 点 TA 醒着 → 主动讲梦（好感/甜度 +1，讲过标记 told）
      if (!taAsleep && hour >= 6 && hour < 10 && dreamNow && !dreamNow.told) {
        const dreamGap = (Date.parse(today) - Date.parse(dreamNow.date)) / 86_400_000;
        if (dreamGap >= 0 && dreamGap <= 1) {
          saveDream(companion.id, { ...dreamNow, told: true });
          taProactiveSay(`我做了一个梦！${dreamNow.text}`);
          noteInteraction(companion.id, m, { sweet: 1, social: 0, mood: 4 });
          cabinEventMemory(companion.id, `${companion.name}把昨晚的梦讲给${ownerNameRef.current || '主人'}听。`, 'cabin-dream-told', { dedupeSeconds: 300 });
          toast(`${companion.name}跟你讲了 TA 昨晚的梦～`);
        }
      }
      // F2 日记：每天首次心跳写一篇（当天没写过才写；actions = 截至此刻的事）
      const wroteDiary = ensureTodayDiary(companion.id, {
        name: companion.name,
        actions: taDayActionsRef.current.date === today ? [...taDayActionsRef.current.items] : [],
        weather: weatherFx === 'rain' ? '下雨' : weatherFx === 'snow' ? '下雪' : weatherFx === 'overcast' ? '阴天' : weatherFx === 'cloudy' ? '多云' : '晴',
        mood: m.mood,
        chatLines: taChatCountRef.current,
      });
      if (wroteDiary) taChatCountRef.current = 0;
      // I3 早安晚安：每天各一次（早安 6~10 点 / 晚安 23~01 点，都在 TA 醒着时）
      const g = loadGreet(companion.id);
      const gToday = g.date === today ? g : { date: today, morning: false, night: false };
      if (hour >= 6 && hour < 10 && !gToday.morning && !taAsleep) {
        gToday.morning = true;
        saveGreet(companion.id, gToday);
        taProactiveSay(`早上好呀，${ownerNameRef.current || '主人'}…昨晚睡得好吗？我可是梦见你了哦。`);
        cabinEventMemory(companion.id, `${companion.name}早上主动和${ownerNameRef.current || '主人'}道了早安。`, 'cabin-greet-morning', { dedupeSeconds: 300 });
        noteInteraction(companion.id, m, { sweet: 1, social: 0, mood: 3 });
      } else if ((hour >= 23 || hour < 1) && !gToday.night && !taAsleep) {
        gToday.night = true;
        saveGreet(companion.id, gToday);
        taProactiveSay('夜深了哦…要不要早点休息？我会看着屋子等你上床的。');
        cabinEventMemory(companion.id, `${companion.name}夜里提醒${ownerNameRef.current || '主人'}早点休息。`, 'cabin-greet-night', { dedupeSeconds: 300 });
      }

      if (Date.now() < decideNextAtRef.current) return;
      decideNextAtRef.current = Date.now() + 95_000 + Math.random() * 60_000;
      if (modeRef.current !== 'live' || pickerOpen) return;
      if (request || partnerMenuOpen || chatBusy) return;
      const s = companionStateRef.current;
      if ((s !== 'idle' && s !== 'near') || petCareRef.current || carryPetRef.current) return;
      // —— A6 想你了：太长时间没互动 + 心情 missing → 主动撒娇弹窗（不占用决策） ——
      if (m.mood === 'missing' && Date.now() >= requestCooldownRef.current && Math.random() < 0.6) {
        requestCooldownRef.current = Date.now() + 6 * 60_000;
        setRequest({ kind: 'miss', text: `有 ${Math.round(100 - m.needs.social)} 分想你`, at: Date.now() });
        return;
      }
      void (async () => {
        // —— A8 特别日子：当天第一次撞上 → 主动庆祝 ——
        const special = todaySpecial(m);
        if (special && specialDoneRef.current !== special) {
          specialDoneRef.current = special;
          say(`${special}！我一直记着呢，${special.includes('认识') ? '谢谢有你陪着我呀。' : '今天要开开心心的～'}`, 6);
          cabinEventMemory(companion.id, `今天是${special}，${companion.name}主动提起并为${ownerNameRef.current || '主人'}庆祝。`, 'cabin-special-day', { dedupeSeconds: 3600 });
          noteInteraction(companion.id, m, { sweet: 3, mood: 6 });
        }
        // —— A1 决策：大模型优先（贴人设、有想法），失败规则兜底（永远有得做） ——
        const now = new Date();
        const ctx: DecisionCtx = {
          userName: ownerNameRef.current || '主人',
          charName: companion.name,
          myRoom: ROOM_NAMES[roomAt(meRT.current.x, meRT.current.z)],
          charRoom: ROOM_NAMES[roomAt(taRT.current.x, taRT.current.z)],
          charActivity: charActivityText(),
          night: nightRef.current,
          weather: weatherFx === 'rain' ? '下雨' : weatherFx === 'snow' ? '下雪' : weatherFx === 'overcast' ? '阴天' : weatherFx === 'cloudy' ? '多云' : '晴',
          timeStr: now.toLocaleString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long', hour: '2-digit', minute: '2-digit' }),
          minsSinceInteract: (Date.now() - m.lastInteract) / 60_000,
        };
        let result: DecisionResult | null = null;
        try {
          const reply = await cabinChatTurn([{ role: 'system', content: buildDecisionPrompt(m, ctx, { songs: AI_SONG_NAMES }) }], useSettings.getState().apiConfig);
          result = parseDecision(reply);
        } catch {
          /* 网络/模型失败 → 规则兜底 */
        }
        if (result) {
          decideFailRef.current = 0; // 恢复即回正常节奏（95~155s）
        } else {
          // A3 修复：连续失败指数拉长决策间隔（2→5→10 分钟）——限流期不再每 95~155s 烧 2 次必败调用，
          // 反过来加剧限流（聊天+决策+朋友圈+记忆提取互相踩）；本地决策照常兜底，行为不中断
          decideFailRef.current += 1;
          const backoff = decideFailRef.current >= 3 ? 10 * 60_000 : decideFailRef.current === 2 ? 5 * 60_000 : 2 * 60_000;
          decideNextAtRef.current = Math.max(decideNextAtRef.current, Date.now() + backoff);
        }
        if (!result) result = decideLocally(m, nightRef.current);
        // —— A7 想法气泡：决策透明（TA 为什么做这件事） ——
        if (result.thought) say(result.thought, 4, 'thought');
        for (const t of result.say) say(t, 5);
        // —— 执行动作（闹脾气时过滤亲近动作） ——
        const acts = result.actions
          .filter((a) => new RegExp(`^(${MIND_ACTS})$`).test(a.type))
          .filter((a) => !(m.sulk.on && (a.type === 'come' || a.type === 'hug' || a.type === 'holdhand')))
          .slice(0, 3)
          .map((a) => ({ kind: a.type as CompanionCmd['kind'], room: a.room as RoomId | undefined, song: a.song, dur: a.dur, memo: 'mind' }));
        if (acts.length > 0) {
          companionQueueRef.current = acts.slice(1);
          issueCompanionCmd(acts[0]);
        }
        m.lastDecide = Date.now();
        saveMind(companion.id, m);
      })();
    }, 30_000);
    return () => clearInterval(iv);
  }, [companion, request, partnerMenuOpen, chatBusy, pickerOpen, issueCompanionCmd, say, charActivityText, weatherFx, taProactiveSay, toast]);

  // ---------------- v10 B3 天气联动：下雨关窗 / 下雪点壁炉 / 雨停开窗 ----------------

  useEffect(() => {
    const prev = prevWeatherRef.current;
    prevWeatherRef.current = weatherFx;
    if (!prev || prev === weatherFx || !companion) return;
    if (modeRef.current !== 'live') return;
    const s = companionStateRef.current;
    if ((s !== 'idle' && s !== 'near') || petCareRef.current || carryPetRef.current) return;
    if (weatherFx === 'rain') {
      say('下雨了！我去把窗关上。', 4.5, 'thought');
      issueCompanionCmd({ kind: 'window', open: false, memo: 'close' });
      cabinBehaviorMemoryOncePerDay(companion.id, 'rain-window', `下雨了，${companion.name}赶紧去把窗户关上，不让雨飘进屋里。`);
    } else if (weatherFx === 'snow') {
      const fp = itemsRef.current.find((f) => f.kind === 'fireplace' && !f.st?.on);
      if (fp) {
        setItems((p) => p.map((f) => (f.id === fp.id ? { ...f, st: { ...f.st, on: true } } : f)));
        saveSoon();
        say('下雪啦，把壁炉点上，屋里暖暖的～', 5);
        cabinBehaviorMemoryOncePerDay(companion.id, 'snow-fire', `下雪了，${companion.name}点上了壁炉，屋里暖融融的。`);
      }
    } else if (prev === 'rain' && weatherFx === 'sunny') {
      say('雨停啦，开窗透透气～', 4.5, 'thought');
      issueCompanionCmd({ kind: 'window', open: true, memo: 'open' });
    }
  }, [weatherFx, companion, issueCompanionCmd, say, saveSoon]);

  // ---------------- v11 G2 环境白噪音：雨声/风雪/炉火 智能联动（⋮ 菜单开关；sfx.ambient 防御式调用） ----------------

  /** 壁炉开着（联动 'fire'；天气沿与壁炉开关沿两处都靠本 effect 的依赖变化触发） */
  const fireOn = items.some((f) => f.kind === 'fireplace' && f.st?.on);
  useEffect(() => {
    if (!ambientOnRef.current) return; // 关 = 恒静（toggle 时已显式置 null）
    if (weatherFx === 'rain') sfxAmbient.ambient?.('rain');
    else if (weatherFx === 'snow') sfxAmbient.ambient?.('wind');
    else if (fireOn) sfxAmbient.ambient?.('fire');
    else sfxAmbient.ambient?.(null);
  }, [weatherFx, fireOn, ambientOn]);
  useEffect(() => () => sfxAmbient.ambient?.(null), []); // 卸载必停

  /** 自主行动调度：空闲时按人设记忆走动/坐下/看电视/弹琴/做饭/放歌，夜里上床睡觉（已有 roam 漫游兜底） */
  useEffect(() => {
    const iv = setInterval(() => {
      const now = Date.now();
      if (now < autoNextAtRef.current) return;
      autoNextAtRef.current = now + 40_000 + Math.random() * 40_000;
      if (!companion || modeRef.current !== 'live' || pickerOpen) return;
      if (request || partnerMenuOpen || chatBusy) return;
      const s = companionStateRef.current;
      if (s !== 'idle' || petCareRef.current || carryPetRef.current) return;
      const r = Math.random();
      if (nightRef.current) {
        // —— v8.1 夜深了：没有别的事就回床上睡觉（dur=0 一直睡到天亮/被叫起） ——
        if (r < 0.55) {
          // v12 双人同床：宿主已经睡在某张床上 → TA 优先去同一张床（上床后自动两侧睡），
          // 不再各睡各的；宿主没睡才按原来的方式挑第一张床
          const meLying = poseRef.current?.pose === 'lie';
          const bed =
            (meLying &&
              itemsRef.current.find(
                (f) =>
                  CATALOG[f.kind]?.acts?.sleep &&
                  (f.y ?? 0) < 0.45 &&
                  Math.hypot(meRT.current.x - f.x, meRT.current.z - f.z) < 1.6,
              )) ||
            itemsRef.current.find((f) => CATALOG[f.kind]?.acts?.sleep && (f.y ?? 0) < 0.45) ||
            null;
          if (bed) {
            issueCompanionCmd({ kind: 'lie', itemId: bed.id, memo: 'auto-night', dur: 0 });
            cabinBehaviorMemoryOncePerDay(companion.id, 'night-sleep', `夜深了，${companion.name}洗漱完上床睡觉，被子盖得严严实实的。`);
          }
        }
        return;
      }
      if (r < 0.24) {
        issueCompanionCmd({ kind: 'sit', memo: 'auto' });
      } else if (r < 0.38) {
        // 打开电视 + 坐到电视前（有电视才演这一出）
        const tv = itemsRef.current.find((f) => f.kind === 'tv');
        if (tv && !tv.st?.on) {
          setItems((prev) => prev.map((f) => (f.kind === 'tv' ? { ...f, st: { ...f.st, on: true } } : f)));
          saveSoon();
        }
        issueCompanionCmd({ kind: 'watch', memo: 'auto' });
      } else if (r < 0.52) {
        // v8.1 家里有乐器 → 兴致来了弹一曲
        const inst = itemsRef.current.find((f) => CATALOG[f.kind]?.acts?.play && (f.y ?? 0) < 0.45);
        if (inst) issueCompanionCmd({ kind: 'play', memo: 'auto' });
      } else if (r < 0.62) {
        // v8.1 还没做好的时候 → 主动做饭（做完菜上桌，记忆里会记一笔）
        if (!mealReadyRef.current && itemsRef.current.some((f) => CATALOG[f.kind]?.acts?.cook)) {
          issueCompanionCmd({ kind: 'cook', memo: 'auto' });
        }
      } else if (r < 0.7) {
        // v8.1 想听歌了 → 去音箱/唱片机前放歌
        if (itemsRef.current.some((f) => ['speaker', 'radio', 'vinyl', 'musicBox'].includes(f.kind))) {
          issueCompanionCmd({ kind: 'music', memo: 'auto' });
        }
      } else if (r < 0.84) {
        const rooms: RoomId[] = ['lr', 'br', 'kt', 'ba', 'bal', 'sr', 'yd'];
        issueCompanionCmd({ kind: 'goto', room: rooms[Math.floor(Math.random() * rooms.length)], memo: 'auto' });
      }
      // 其余：交给既有 roam 漫游（跨房间溜达）
    }, 5000);
    return () => clearInterval(iv);
  }, [companion, request, partnerMenuOpen, chatBusy, pickerOpen, issueCompanionCmd, saveSoon]);

  /** v8.1 天亮了：夜里长睡（dur=0）的陪伴小人自己醒来伸懒腰（切白天/昼夜自动都会触发） */
  useEffect(() => {
    if (night) return;
    if (companionStateRef.current !== 'sleeping') return;
    const t = setTimeout(() => {
      if (companionStateRef.current === 'sleeping') issueCompanionCmd({ kind: 'free', memo: 'wake-up' });
    }, 2200);
    return () => clearTimeout(t);
  }, [night, issueCompanionCmd]);

  /** v8.2 优化C 小人睡觉做梦：夜里 TA 睡着后，头顶隔一会儿冒一句梦话（点击 💬 回话，TA 会梦呓着接下去） */
  useEffect(() => {
    if (!sleepingUi || !companion) return;
    const dreams = [
      '唔……梦到我们一起去看海了，浪花凉凉的……',
      '（咂咂嘴）唔嘿嘿……这个梦里的蛋糕好好吃……',
      '（抱着被子蹭了蹭）唔……别走嘛，再陪我玩一会儿……',
      '（咿咿呀呀）梦到捡到一只小猫，它冲我喵喵叫……',
      '（翻了个身）明天……明天要一起去放风筝的……',
      '（嘴角上扬）唔……梦里你牵着我的手，走过好长一条街……',
      '（小声）枕头软软的……像云朵一样……',
    ];
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const dreamOnce = () => {
      if (!alive) return;
      bubbleRef.current.push({ who: 'ta', text: dreams[Math.floor(Math.random() * dreams.length)], hold: 6.5 });
      timer = setTimeout(dreamOnce, 24_000 + Math.random() * 26_000);
    };
    timer = setTimeout(dreamOnce, 9_000 + Math.random() * 8_000);
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [sleepingUi, companion]);

  // ---------------- 初始化：拉远端（远端 rev 更新则采纳） ----------------
  useEffect(() => {
    let alive = true;
    (async () => {
      const remote = await fetchRemote();
      if (!alive) return;
      if (remote && remote.rev > pack.rev) {
        adoptHome(remote.home);
        setRev(remote.rev);
        meRT.current.x = remote.home.chars.me.x;
        meRT.current.z = remote.home.chars.me.z;
        taRT.current.x = remote.home.chars.partner.x;
        taRT.current.z = remote.home.chars.partner.z;
        saveCacheNow(remote);
      } else {
        // 无远端或本地更新：播种服务端
        schedulePush();
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // 首屏恢复：上次退出时正在进行的家具动作（坐/睡/泡/淋浴/看电视/上网/吃饭等；
  // 自动结束型（做饭/喝东西/换装）不恢复；远端采纳会走 adoptHome 内的同名恢复，这里兜本地缓存路径）
  useEffect(() => {
    const a = pack.home.act;
    if (!a || actRef.current || poseRef.current.pose !== 'stand' || AUTO_ACTS.has(a.type)) return;
    const it = pack.home.furniture.find((f) => f.id === a.itemId);
    const full = it ? anchorOf(a.type, it) : null;
    if (!full) return;
    full.arrived = true;
    actRef.current = full;
    poseRef.current.pose = full.pose ?? POSE_OF_ACT[a.type];
    poseRef.current.y = full.y;
    setCharAction({ type: a.type, itemId: a.itemId, active: true });
    // 上次正在弹琴/弹吉他 → 直接回到弹奏特写模式
    if (a.type === 'play' && it) {
      const kind = it.kind === 'piano' ? 'piano' : 'guitar';
      instRef.current = { kind, itemId: a.itemId };
      setInst({ kind, itemId: a.itemId });
    }
  }, []);

  // 定期推送 + 卸载兜底
  useEffect(() => {
    const t = setInterval(() => {
      if (++pushTick.current % 12 === 0) schedulePush();
    }, 5000);
    const onHide = () => saveCacheNow(snap());
    window.addEventListener('pagehide', onHide);
    return () => {
      clearInterval(t);
      window.removeEventListener('pagehide', onHide);
      saveCacheNow(snap());
    };
  }, []);

  // ---------------- 洗衣机倒计时（无事可做时不 setState，避免每秒重渲染打断手势） ----------------
  useEffect(() => {
    const t = setInterval(() => {
      const now = Date.now();
      const finishing = itemsRef.current.some(
        (it) => it.st?.washing && it.st.washStart && now - it.st.washStart > WASH_SECONDS * 1000,
      );
      if (!finishing) return; // 没有到点的洗衣机 → 不触发渲染
      setItems((prev) =>
        prev.map((it) => {
          if (it.st?.washing && it.st.washStart && Date.now() - it.st.washStart > WASH_SECONDS * 1000) {
            return { ...it, st: { ...it.st, washing: false, washDone: true } };
          }
          return it;
        }),
      );
      toast('洗衣机：衣物洗好了');
      saveSoon();
    }, 1000);
    return () => clearInterval(t);
  }, [toast, saveSoon]);

  // ---------------- 宠物照顾流程（v6.9） ----------------
  /** 发起照顾：宠物走向小人 → 到位后互动（v7.2：抱抱 = 抱起怀抱随意走动，再点变「放下」；v8.3：扔球/小把戏） */
  const startPetCare = useCallback(
    (kind: PetCareKind) => {
      if (petCare) return; // 正在照顾中
      // v9 目标 = 当前选中的宠物（猫 or 领养宠物）；指令带 target 路由，只有它会响应
      const target = activePetRef.current;
      const nm = activePetName;
      // —— 抱着态：抱抱按钮 = 放下；其他照顾动作先放下（扔球也不行，怀里的它够不着地上的球） ——
      if (carryPetRef.current) {
        if (kind === 'hug') {
          petCarrySeq.current += 1;
          petCarryCmdRef.current = { on: false, seq: petCarrySeq.current, target };
          carryPetRef.current = false;
          carryRef.current.pet = false;
          setCarrying(false);
          toast(`${nm}乖乖落地，又要去溜达啦～`);
        } else {
          toast(`先把${nm}放下来，再照顾它吧～`);
        }
        return;
      }
      // —— v8.3 扔球（A）：独立指令通道（不走 care 走位管线；球出手后它自己去追去叼） ——
      if (kind === 'ball') {
        petBallSeq.current += 1;
        petBallCmdRef.current = { seq: petBallSeq.current, target };
        toast(`把球扔出去啦，看${nm}冲鸭～`);
        return;
      }
      if (actRef.current) {
        toast('先把手头的事做完，再来照顾它吧');
        return;
      }
      if (kind === 'hug') {
        // 抱起流程：抱指令直接带 carry 标志 —— 宠物走到身边后纵身一跃进怀里（arrive 时正式抱起）
        petSeq.current += 1;
        petCmdRef.current = { kind, seq: petSeq.current, carry: true, target };
        setPetCare(kind);
        setPetPanel(false);
        toast(`${nm}张开小爪爪要抱抱举高高啦～`);
        return;
      }
      petSeq.current += 1;
      petCmdRef.current = { kind, seq: petSeq.current, target };
      setPetCare(kind);
      setPetPanel(false);
      const startMsg: Record<PetCareKind, string> = {
        pat: `${nm}屁颠屁颠跑过来了～`,
        feed: `盛好粮食，等${nm}过来吃啦～`,
        water: `倒好清水，叫${nm}来喝咯～`,
        bath: `烧好洗澡水，给${nm}搓个泡泡浴～`,
        hug: `${nm}张开小爪爪要抱抱举高高啦～`,
        summon: `一声哨响，${nm}飞奔过来咯～`,
        shake: `伸手示意，${nm}跑过来要和你握手啦～`,
        spin: `打个转转的手势，${nm}准备表演啦～`,
        roll: `拍拍地板，${nm}跑来给你打个滚～`,
        dead: `喊一声「砰！」，看${nm}会不会装死～`,
        tickle: `伸出手指逗${nm}，准备挠痒痒啦～`,
        ball: '',
      };
      toast(startMsg[kind]);
    },
    [petCare, toast, activePetName],
  );

/** 宠物事件：arrive 到位 / done 完成结算 / cancel 中断还原 / dropped 放下完成；v9 带宠物 id 路由（猫 or 领养宠物） */
  const onPetEvent = useCallback(
    (ev: 'arrive' | 'done' | 'cancel' | 'dropped', kind: PetCareKind, petId?: string) => {
      // —— v9 目标宠物路由：'cat' / 'p2:<i>' ——
      const isCat = !petId || petId === 'cat';
      const idx = isCat ? -1 : Number(petId.slice(3)) || 0;
      const targetName = isCat ? (petRef.current.name ?? '团子') : (pets2Ref.current[idx]?.name ?? '小伙伴');
      /** 把一次状态变化写到正确的宠物身上 */
      const applyStats = (delta: { mo?: number; st?: number; cl?: number }, extraCare = false) => {
        if (isCat) {
          setPet((p) => ({
            ...p,
            mo: delta.mo ? Math.min(100, Math.max(0, p.mo + delta.mo)) : p.mo,
            st: delta.st ? Math.min(100, Math.max(0, p.st + delta.st)) : p.st,
            cl: delta.cl ? Math.min(100, Math.max(0, p.cl + delta.cl)) : p.cl,
            care: extraCare ? (p.care ?? 0) + 1 : p.care,
            ts: Date.now(),
          }));
        } else {
          setPets2((prev) =>
            prev.map((p, j) => {
              if (j !== idx) return p;
              const cur = { st: 88, cl: 88, mo: 90, ts: Date.now(), ...p } as PetState;
              return {
                ...p,
                mo: delta.mo ? Math.min(100, Math.max(0, cur.mo + delta.mo)) : cur.mo,
                st: delta.st ? Math.min(100, Math.max(0, cur.st + delta.st)) : cur.st,
                cl: delta.cl ? Math.min(100, Math.max(0, cur.cl + delta.cl)) : cur.cl,
                care: extraCare ? (cur.care ?? 0) + 1 : (cur.care ?? 0),
                ts: Date.now(),
              };
            }),
          );
        }
      };
      if (ev === 'arrive') {
        if (kind === 'hug') {
          // v7.2 抱起完成（抱抱 = 抱起模式）：站姿环抱（双臂收拢）+ 按钮解锁（抱抱变「放下」）+ 结算
          poseRef.current.pose = 'stand';
          poseRef.current.y = 0;
          carryRef.current.pet = true;
          carryPetRef.current = true;
          setCarrying(true);
          setPetCare(null);
          applyStats({ mo: 16, st: 2 });
          toast(`${targetName}抱在怀里啦，想去哪就去哪；再点一下「放下」把它放下来～`);
          saveSoon();
          return;
        }
        poseRef.current.pose = 'petcare';
        poseRef.current.y = 0;
        return;
      }
      if (ev === 'dropped') {
        // 放下完成：复位照顾锁（抱着态的 UI 在 startPetCare 里已提前复位）
        setPetCare(null);
        return;
      }
      if (poseRef.current.pose === 'petcare') poseRef.current.pose = 'stand';
      setPetCare(null);
      setPetBarOpen(false); // v7.1：照顾完成/中断后互动竖条自动收起
      if (ev === 'cancel') {
        // 中断时若还处于抱着态（切装修等）→ 复位抱抱 UI
        carryPetRef.current = false;
        carryRef.current.pet = false;
        setCarrying(false);
      }
      if (ev !== 'done') return;
      // —— v11 I2 里程碑：照顾宠物 +1；F2 日记素材 ——
      if (companion) {
        statsRef.current = bumpCabinStats(companion.id, { petCares: 1 });
        noteTaAction('照顾了小家伙们');
      }
      // v8.3 成长系统：每次照顾/互动 +1 经验（v9 按宠物各自计）；升级时弹解锁提示
      const before: PetState = isCat
        ? petRef.current
        : ({ st: 88, cl: 88, mo: 90, ts: Date.now(), ...pets2Ref.current[idx] } as PetState);
      const lvlBefore = petLevelOf(before);
      if (kind === 'pat') applyStats({ mo: 12 }, true);
      else if (kind === 'feed') applyStats({ st: 22, mo: 4 }, true);
      else if (kind === 'bath') applyStats({ cl: 26, mo: 6 }, true);
      else if (kind === 'hug') applyStats({ mo: 16, st: 2 }, true);
      else if (kind === 'summon') applyStats({ mo: 4 }, true);
      else if (kind === 'tickle') applyStats({ mo: 12 }, true); // v11 types.ts 新增 tickle：心情向结算
      else if (kind === 'ball') applyStats({ mo: 8 }, true);
      else if (kind === 'shake' || kind === 'spin' || kind === 'roll' || kind === 'dead') applyStats({ mo: 9 }, true);
      else applyStats({ cl: 18, st: 4 }, true);
      const lvlAfter = petLevelOf({ ...before, care: (before.care ?? 0) + 1 });
      if (lvlAfter > lvlBefore) {
        sfx.whistle();
        const unlocked = PET_TRICK_DEFS.filter((t) => t.lvl === lvlAfter).map((t) => t.label);
        toast(
          unlocked.length > 0
            ? `${targetName}升到 Lv.${lvlAfter} 啦！解锁新动作：${unlocked.join('、')}～`
            : `${targetName}升到 Lv.${lvlAfter} 啦，越来越有默契了～`,
        );
      }
      const doneMsg: Record<PetCareKind, string> = {
        pat: `摸得${targetName}咕噜咕噜，尾巴都要摇飞啦～`,
        feed: `${targetName}吃得肚皮圆滚滚，心满意足～`,
        water: `${targetName}咕咚咕咚喝饱水，精神满满～`,
        bath: '洗得香喷喷，毛茸茸亮晶晶～',
        hug: '抱在怀里蹭蹭，它开心得直打呼噜～',
        summon: `一叫就到，真是乖${targetName}～`,
        shake: '伸出小爪爪和你握手，太乖啦～',
        spin: '原地转了个圈圈，毛都转晕乎了～',
        roll: '咕噜噜打了个滚，露出软软的肚皮～',
        dead: '「砰」的一声直接躺平装死，演技满分！',
        tickle: '被挠得咯咯直叫，尾巴乱甩停不下来～',
        ball: '追着球跑了一圈又叼回来，玩得可开心啦～',
      };
      toast(doneMsg[kind]);
      // —— v10 C2 训练系统：把戏每练一次熟练度 +1（记在宠物身上，跨会话累积） ——
      if (kind === 'shake' || kind === 'spin' || kind === 'roll' || kind === 'dead') {
        const bump = (tr: Record<string, number> | undefined): Record<string, number> => {
          const t = { ...(tr ?? {}) };
          t[kind] = (t[kind] ?? 0) + 1;
          return t;
        };
        if (isCat) setPet((p) => ({ ...p, train: bump(p.train) }));
        else setPets2((prev) => prev.map((p, j) => (j === idx ? { ...p, train: bump(p.train) } : p)));
        const n = ((isCat ? petRef.current.train?.[kind] : pets2Ref.current[idx]?.train?.[kind]) ?? 0) + 1;
        if (n % 5 === 0) toast(`${targetName}的「${doneMsg[kind] ? { shake: '握手', spin: '转圈', roll: '打滚', dead: '装死' }[kind] : ''}」熟练度 +1（已练 ${n} 次）～`);
        // —— v10 C2 学会了会自己表演：熟练度够了，练完偶发自己再来一段 ——
        if (n >= 3 && Math.random() < 0.4 && !petCareRef.current) {
          const lvlNow = petLevelOf(before);
          const pool = PET_TRICK_DEFS.filter((t) => t.kind !== kind && lvlNow >= t.lvl);
          if (pool.length > 0) {
            const pick = pool[Math.floor(Math.random() * pool.length)];
            const tgt = activePetRef.current;
            setTimeout(() => {
              if (petCareRef.current || carryPetRef.current) return;
              petSeq.current += 1;
              petCmdRef.current = { kind: pick.kind, seq: petSeq.current, target: tgt };
              toast(`${targetName}自己表演了一段${pick.label}！`);
            }, 1600);
          }
        }
      }
      // —— v10 C4 宠物日记：照顾/把戏完成自动记一篇 ——
      addPetDiary(`${targetName}：${doneMsg[kind]}`);
      saveSoon();
    },
    [toast, saveSoon, companion, noteTaAction],
  );

  /** 点宠物（v7.1）：开/关底部互动竖条；v9 带宠物 id —— 点领养宠物自动把互动目标切到它 */
  const onPetTap = useCallback((petId?: string) => {
    petTapAtRef.current = Date.now(); // 守卫：同一次点击的 up 阶段射线会落到地板/家具上，不能当作「点别处」关掉竖条
    const target = petId ?? 'cat';
    if (target !== activePetRef.current) {
      // 切到点中的那只（竖条按钮/面板结算都路由到它）
      setActivePet(target);
      activePetRef.current = target;
      setPetBarOpen(true);
    } else {
      setPetBarOpen((v) => !v);
    }
    setPetPanel(false); // 点宠物出竖条，状态面板同时收起（互不叠影）
  }, []);


  /** 确认改名（最长 8 字；v9 改的是当前选中的那只） */
  const commitPetName = useCallback(() => {
    const name = petNameDraft.trim().slice(0, 8);
    if (name) {
      if (activePetRef.current === 'cat') setPet((p) => ({ ...p, name }));
      else {
        const i = Number(activePetRef.current.slice(3)) || 0;
        setPets2((prev) => prev.map((p, j) => (j === i ? { ...p, name } : p)));
      }
      toast(`它以后就叫「${name}」啦！`);
      saveSoon();
    }
    setPetRenaming(false);
  }, [petNameDraft, toast, saveSoon]);

  // ---------------- 家具交互（生活模式） ----------------

  /**
   * 结束当前动作：起身走下家具（落到预留的起身落点）；
   * 淋浴自动关花洒、看电视自动关电视、上网自动合电脑、泡澡自动关水（全部穿衣恢复原状）；
   * 吃饱收盘、做饭半途而废不端桌。
   */
  const endAction = useCallback(() => {
    const act = actRef.current;
    actRef.current = null;
    poseRef.current.pose = 'stand';
    poseRef.current.y = 0;
    setCharAction(null);
    if (actTimerRef.current) {
      clearTimeout(actTimerRef.current);
      actTimerRef.current = null;
    }
    if (!act) return;
    // 已摆好姿势才挪到起身落点（走到半路被替换时保持原地，由新动作接着寻路）
    if (act.arrived && act.ox != null && act.oz != null) {
      meRT.current.x = act.ox;
      meRT.current.z = act.oz;
    }
    const off = (id: string, patch: FurnitureItem['st']) =>
      setItems((prev) => prev.map((f) => (f.id === id ? { ...f, st: { ...f.st, ...patch } } : f)));
    if (act.type === 'bath') {
      const it = itemsRef.current.find((f) => f.id === act.itemId);
      if (it?.st?.bathWater) off(act.itemId, { bathWater: false });
      toast('洗得香香的，穿好衣服啦');
    } else if (act.type === 'shower') {
      off(act.itemId, { on: false });
      toast('冲干净啦，穿好衣服出来咯～');
    } else if (act.type === 'watch') {
      off(act.itemId, { on: false });
      toast('电视关掉啦，让眼睛歇一歇～');
    } else if (act.type === 'work') {
      off(act.itemId, { on: false });
      toast('合上电脑，起来走走～');
    } else if (act.type === 'eat') {
      setMealReady(false);
      setMealName(undefined);
      toast('吃饱啦，一桌好菜吃光光～');
    } else if (act.type === 'hotpot') {
      // 吃完火锅：炉火顺手关掉
      off(act.itemId, { on: false });
      toast('火锅吃到撑，满足～');
    } else if (act.type === 'game') {
      // 不玩啦：主机与电视一起关
      off(act.itemId, { on: false });
      setItems((prev) =>
        prev.map((f) => (f.kind === 'tv' && f.st?.on ? { ...f, st: { ...f.st, on: false } } : f)),
      );
      toast('手柄一放，眼睛休息一下～');
    } else if (act.type === 'dress') {
      // 换装结束：衣柜门关上
      off(act.itemId, { open: false });
    } else if (act.type === 'cook') {
      toast('好，先不做了～');
    } else if (act.type === 'play') {
      toast('演奏结束，掌声响起来～');
    } else if (act.type === 'read') {
      toast('合上书，回味一下～');
    } else if (act.type === 'makeup') {
      toast('化好啦，气色满满～');
    } else if (act.type === 'mirror') {
      toast('嗯，今天也是好看的一天～');
    }
    saveSoon();
  }, [meRT, saveSoon, toast]);

  /** 开始动作：小人走向家具落点 → 摆姿势（GameLoop 驱动）；
   *  淋浴/看电视/上网自动开水开机；躺床自动关灯；做饭/喝东西/换装定时自动完成。 */
  const beginAction = useCallback(
    (type: CharAction['type'], item: FurnitureItem) => {
      // 宠物照顾中：不接新动作（避免抱起的小猫悬空去坐沙发的穿帮）
      if (petCareRef.current) {
        toast('正陪着小家伙呢，先照顾完它吧～');
        return;
      }
      // v7.2 怀里还抱着小猫：先放下再干别的（坐下/躺床/泡澡都会穿帮）
      if (carryPetRef.current) {
        toast(`怀里还抱着${petRef.current.name ?? '团子'}呢，先把它放下来吧～`);
        return;
      }
      // B3 阅读：锚点不在书架本身（书架没有 seat），先找最近可坐家具再入座
      if (type === 'read') {
        const seats = itemsRef.current.filter((f) => {
          const e = CATALOG[f.kind];
          return !!e?.acts.seat && (f.y ?? 0) < 0.45;
        });
        if (seats.length === 0) {
          actRef.current = null;
          setCharAction(null);
          toast('先买张沙发或椅子，才能坐着看书呀');
          return;
        }
        const seat = seats.reduce((best, f) => {
          const db = Math.hypot(best.x - meRT.current.x, best.z - meRT.current.z);
          const df = Math.hypot(f.x - meRT.current.x, f.z - meRT.current.z);
          return df < db ? f : best;
        });
        const a = anchorOf('read', seat);
        if (!a) return;
        actRef.current = a;
        setCharAction((prev) => (prev ? { ...prev, active: true } : { type, itemId: seat.id, active: true }));
        toast(`抽了本书，坐到${CATALOG[seat.kind]?.name ?? '沙发'}上慢慢看～`);
        saveSoon();
        return;
      }
      const act = anchorOf(type, item);
      if (!act) return;
      // v12 双人床两侧睡：TA 已经躺在这张床上 → 我上床时横移到另一侧（局部 X ±0.45），
      // 肩并肩同床头，不再吸附到同一个锚点上把 TA 整个压住（或被 TA 压住）
      if (type === 'lie') {
        const st = companionStateRef.current;
        if (st === 'sleeping' || st === 'lying') {
          const c = Math.cos(item.ry ?? 0);
          const s = Math.sin(item.ry ?? 0);
          const dxw = taRT.current.x - item.x;
          const dzw = taRT.current.z - item.z;
          if (Math.hypot(dxw, dzw) < 1.6) {
            const lxTa = dxw * c - dzw * s; // TA 在床局部坐标的横向位置
            const off = lxTa >= 0 ? -0.45 : 0.45; // TA 居中/偏 +X → 我睡 -X 侧；反之 +X 侧
            act.tx += off * c;
            act.tz += off * -s;
            if (act.ox !== undefined) act.ox += off * c; // 外围走位点同步横移（从床头侧绕进来落点一致）
            if (act.oz !== undefined) act.oz += off * -s;
          }
        }
      }
      actRef.current = act;
      setCharAction((prev) => (prev ? { ...prev, active: true } : { type, itemId: item.id, active: true }));
      const turnOn = (patch: FurnitureItem['st']) =>
        setItems((prev) => prev.map((f) => (f.id === item.id ? { ...f, st: { ...f.st, ...patch } } : f)));
      /** 自动结束定时（只保留最新一个） */
      const auto = (ms: number, fn: () => void) => {
        if (actTimerRef.current) clearTimeout(actTimerRef.current);
        actTimerRef.current = setTimeout(fn, ms);
      };
      if (type === 'sit') toast('走过去坐下咯～');
      else if (type === 'lie') {
        // C6 睡觉联动灯：全屋主灯自动关闭（小夜灯由场景侧亮起）
        setItems((prev) =>
          prev.map((f) => (CATALOG[f.kind]?.light && f.st?.on ? { ...f, st: { ...f.st, on: false } } : f)),
        );
        toast('关灯睡觉，晚安好梦～');
      } else if (type === 'bath') toast('脱掉衣服，泡澡泡起来～');
      else if (type === 'shower') {
        turnOn({ on: true });
        toast('打开花洒，冲个热水澡～');
      } else if (type === 'watch') {
        turnOn({ on: true });
        toast('打开电视，窝着看一会儿～');
      } else if (type === 'work') {
        turnOn({ on: true });
        toast('打开电脑，上网冲一下浪～');
      } else if (type === 'hotpot') {
        // 开涮火锅：炉火自动开（红汤翻滚），吃到饱手动起身
        turnOn({ on: true });
        toast('炉火开啦，今天的火锅局走起～');
      } else if (type === 'game') {
        // 打游戏：主机自动开机 + 电视自动亮（手柄已握在手里）
        turnOn({ on: true });
        setItems((prev) =>
          prev.map((f) => (f.kind === 'tv' && !f.st?.on ? { ...f, st: { ...f.st, on: true } } : f)),
        );
        toast('主机开机，电视亮啦，开玩～');
      } else if (type === 'cook') {
        // C2 做饭：站位煓勺 5 秒 → 一桌好菜自动上餐桌
        auto(5000, () => {
          setMealReady(true);
          toast('饭菜好啦，上桌开饭吧～');
          if (actRef.current?.type === 'cook') endAction();
        });
        toast('系上围裙，认真做饭中…');
      } else if (type === 'drink') {
        // 拿一杯冰饮：走到冰箱 → 自动开门 → 咕哚咕哚喝一口 → 杯子握在手里，
        // 之后小人完全自由（走动/坐下都可以），随时按「放下杯子」结束
        turnOn({ open: true });
        act.onArrive = () => {
          carryRef.current.cup = true;
          carryRef.current.coffee = false;
          setCarryCup(true);
          auto(900, () => {
            turnOn({ open: false });
            if (actRef.current?.type === 'drink') endAction();
            toast('拿好冰饮，端着慢慢逛～');
          });
        };
        toast('走到冰箱拿杯冰饮…');
      } else if (type === 'coffee') {
        // A3 端一杯咖啡：走到咖啡机 → 唌哚喏煮一杯（蒸汽升腾）→ 热咖啡握在手里端着逛
        turnOn({ on: true });
        act.onArrive = () => {
          carryRef.current.cup = true;
          carryRef.current.coffee = true;
          setCarryCup(true);
          auto(2000, () => {
            turnOn({ on: false });
            if (actRef.current?.type === 'coffee') endAction();
            toast('热咖啡到手，暖暖的～');
          });
        };
        toast('咖啡机喌哚喌哚煮咖啡…');
      } else if (type === 'dress') {
        turnOn({ open: true });
        auto(900, () => {
          if (actRef.current?.type === 'dress') setWardrobeOpen(true);
        });
        toast('衣柜门开啦，挑一身好看的～');
      } else if (type === 'eat') toast('开饭开饭，自己做的最香～');
      else if (type === 'play') {
        // 乐器弹奏：小人走向乐器摆姿势 + 镜头推近 + 可弹奏覆盖层（点弦/点键真实发声）
        const kind = item.kind === 'piano' ? 'piano' : 'guitar';
        instRef.current = { kind, itemId: item.id };
        setInst({ kind, itemId: item.id });
        toast(item.kind === 'piano' ? '坐上琴凳，弹一首小曲～' : '抱起吉他，来一段扫弦～');
      } else if (type === 'makeup') toast('坐下来补个妆，今天也要美美的～');
      else if (type === 'mirror') toast('照照镜子，今天状态不错嘛～');
      saveSoon();
    },
    [toast, saveSoon, endAction],
  );
  // v8.2 beginAction 桥赋值（onCompanionEvent 等先定义的回调经 beginActionRef 转发）
  beginActionRef.current = beginAction;

  /** v8.2 优化D「一起做动作」反向版：用户开始 看电视/开饭 时，空闲的 TA 过来一起（演奏是单人乐器，不凑） */
  useEffect(() => {
    if (!charAction || charAction.active) return;
    const type = charAction.type;
    if (type !== 'watch' && type !== 'eat') return;
    if (type === 'eat' && !mealReady) return;
    if (!companion || petCare || carrying || holdingUI) return;
    if (companionStateRef.current !== 'idle') return;
    const t = setTimeout(() => {
      if (companionStateRef.current !== 'idle') return;
      const it = itemsRef.current.find((f) => f.id === charAction.itemId);
      if (!it) return;
      if (type === 'eat') {
        const table = itemsRef.current.find((f) => f.kind === 'diningTable' && CATALOG[f.kind]?.acts?.eat);
        if (table) issueCompanionCmd({ kind: 'eat', itemId: table.id, memo: 'join' });
      } else {
        issueCompanionCmd({ kind: type, itemId: it.id, memo: 'join' });
      }
      toast(`${companion?.name ?? 'TA'}也凑过来一起啦～`);
    }, 1400);
    return () => clearTimeout(t);
  }, [charAction, companion, petCare, carrying, holdingUI, mealReady, issueCompanionCmd, toast]);

  /** 好菜所在餐桌（做饭完成后第一张餐桌；无餐桌则不上桌） */
  const mealTableId = useMemo(() => {
    if (!mealReady) return null;
    return items.find((f) => f.kind === 'diningTable')?.id ?? null;
  }, [mealReady, items]);

  // —— G8 留言板：打开并记已读（onFurnTap 之前声明） ——
  const openNotes = useCallback(() => {
    notesSeenRef.current = { ...notesSeenRef.current, me: Date.now() };
    setNoteOpen(true);
    sfx.tap();
    saveSoon();
  }, [saveSoon]);

  const onFurnTap = useCallback(
    (item: FurnitureItem) => {
      sfx.tap(); // E3：所有家具点按轻响（函数最前面，提前 return 分支也有声）
      const justPet = Date.now() - petTapAtRef.current < 450; // 刚点过宠物（up 配对落到家具上）
      const justPartner = Date.now() - partnerTapAtRef.current < 450; // v8.0：刚点过陪伴小人
      if (mode === 'live' && !justPet && !justPartner) {
        setPetBarOpen(false); // v7.1：点别处（家具）互动竖条消失
        setPetPanel(false); // v7.2：点别处状态面板也收起
        setPartnerMenuOpen(false); // v8.0：陪伴菜单也收起
      }
      const entry = CATALOG[item.kind];
      if (!entry) return;

      if (mode === 'edit') {
        // 选中（正在逛商店时点家具 → 收起抽屉露出操作栏）
        setShopOpen(false);
        setPaletteOpen(false);
        setBedColorOpen(false); // v11：猫窝换色小色板也一并收起
        setSelId((s) => (s === item.id ? null : item.id));
        return;
      }

      // 电视：点击 = 开/关机（打开后小人自由走动，随时坐沙发上看看 —— 不再锁在电视前）
      if (entry.acts?.toggle && entry.acts?.watch) {
        const on = !item.st?.on;
        setItems((prev) => prev.map((f) => (f.id === item.id ? { ...f, st: { ...f.st, on } } : f)));
        toast(on ? '打开电视咯，随便逛，随时坐下看～' : '电视关掉啦，让眼睛歇一歇～');
        saveSoon();
        return;
      }

      // 游戏主机：点击 = 开/关机（开机自动亮电视，小人自由走动 —— v5.8 不再锁在主机前）
      if (item.kind === 'gameConsole') {
        const on = !item.st?.on;
        setItems((prev) =>
          prev.map((f) => {
            if (f.id === item.id) return { ...f, st: { ...f.st, on } };
            if (f.kind === 'tv') return { ...f, st: { ...f.st, on } }; // 电视跟主机同开同关
            return f;
          }),
        );
        toast(on ? '主机开机，电视亮啦，随便逛～' : '主机关掉啦，去干点别的吧～');
        saveSoon();
        return;
      }

      // 黑胶唱片机 / 八音盒：点击 = 弹出点歌面板（搜歌/我的歌单/队列；全屋响起，随播放自动旋转/开盖 —— v6.0）
      if (item.kind === 'vinyl' || item.kind === 'musicBox') {
        setMusicSheet(true);
        return;
      }

      // 弹奏中点别的家具/门窗：先收起乐器界面（动作由下方统一接管）
      if (instRef.current) {
        instRef.current = null;
        setInst(null);
      }

      // —— v5.7 拾光扩展特殊交互（优先于通用动作链） ——
      // 棋盘桌：开一局五子棋（不再走 playful 弹跳）
      if (item.kind === 'chessTable') {
        setChess({ itemId: item.id });
        return;
      }
      // 灶台：开做饭小游戏（选菜谱→切菜/翻炒/装盘→上桌）
      if (item.kind === 'stove' && entry.acts?.cook) {
        setCookingGame(true);
        return;
      }
      // G10 娃娃机：开一局抓娃娃（30 秒冷却）
      if (item.kind === 'clawMachine') {
        if (Date.now() - (item.st?.lastClaw ?? 0) < 30_000) {
          toast('娃娃机补货中，歇一会儿再来抓～');
          return;
        }
        setClawFor(item.id);
        return;
      }
      // G8 软木留言板：打开留言面板（顺便记已读）
      if (item.kind === 'noteBoard') {
        openNotes();
        return;
      }
      // G10 咖啡机：先玩拉花小游戏，拉好了再端走
      if (item.kind === 'coffeeMaker') {
        setLatteOpen(true);
        return;
      }
      // G10 立式相框：换照片 / 拼一拼 二选一
      if (item.kind === 'photoFrame' && entry.acts?.photo) {
        setPhotoMenuFor(item.id);
        return;
      }
      // 音箱：打开「小屋点歌」（用音乐 App 的歌，全屋响起）
      if (item.kind === 'speaker') {
        setMusicSheet(true);
        return;
      }
      // 幕布：点击 = 开关任意一台投影仪（联动幕布）
      if (item.kind === 'screen') {
        const proj = itemsRef.current.find((f) => f.kind === 'projector');
        const turningOn = !proj?.st?.on;
        setItems((prev) =>
          prev.map((f) =>
            f.kind === 'projector' ? { ...f, st: { ...f.st, on: turningOn } } : f,
          ),
        );
        toast(turningOn ? '投影仪开机，幕布放下咯～' : '投影仪关机，幕布收起啦');
        saveSoon();
        return;
      }

      // 生活模式：可互动的家具 → 弹出确认按钮（先结束当前姿势，
      //   小人自动从当前家具上下来，再走向新目标 —— 同一时刻只做一个动作）
      //   eat 仅在饭菜上桌时出现（否则落到 playful 弹跳）
      const acts = entry.acts;
      const actType: CharAction['type'] | null = acts?.bath
        ? acts.bath.stand
          ? 'shower'
          : 'bath'
        : acts?.sleep
          ? 'lie'
          : acts?.eat && mealReady
            ? 'eat'
            : acts?.cook
              ? 'cook'
              : acts?.drink
                ? 'drink'
                : acts?.coffee
                  ? 'coffee'
                  : acts?.read
                    ? 'read'
                    : acts?.dress
                      ? 'dress'
                      : acts?.play
                        ? 'play'
                        : acts?.makeup
                          ? 'makeup'
                          : acts?.mirror
                            ? 'mirror'
                            : acts?.seat
                              ? 'sit'
                              : acts?.watch
                                ? 'watch'
                                : acts?.work
                                  ? 'work'
                                  : acts?.hotpot
                                    ? 'hotpot'
                                    : null;
      if (actType) {
        if (poseRef.current.pose !== 'stand' || actRef.current) endAction();
        setCharAction({ type: actType, itemId: item.id, active: false });
        return;
      }

      // 生活模式：按能力交互
      const st = item.st ?? {};
      const patch = (next: FurnitureItem['st']) => {
        setItems((prev) => prev.map((f) => (f.id === item.id ? { ...f, st: { ...f.st, ...next } } : f)));
        saveSoon();
      };

      if (entry.acts?.washer) {
        if (st.washDone) {
          patch({ washDone: false, open: false });
          toast('衣物收好啦');
        } else if (st.washing) {
          const left = Math.max(1, Math.ceil(WASH_SECONDS - (Date.now() - (st.washStart ?? 0)) / 1000));
          toast(`洗衣机运转中…约 ${left} 秒`);
        } else {
          const now = Date.now();
          patch({ washing: true, washStart: now, open: false });
          toast('开始洗衣，去忙别的吧～');
        }
        return;
      }
      if (entry.acts?.feed) {
        // 鱼缸投喂：撒鱼食，6 秒鱼群聚食（Cozy3D 按 fedAt 判定）
        patch({ fedAt: Date.now() });
        toast('撒鱼食咯，鱼鱼冲鸭！');
        return;
      }
      if (entry.acts?.toggle) {
        patch({ on: !st.on });
        return;
      }
      if (entry.acts?.photo) {
        // 相框：唤起系统相册/相机选照片（生活模式）
        photoTargetRef.current = item.id;
        fileInputRef.current?.click();
        return;
      }
      if (entry.acts?.door) {
        patch({ open: !st.open });
        return;
      }
      if (entry.acts?.playful) {
        const now = Date.now();
        if (now - (st.lastTouch ?? 0) < PLAY_COOLDOWN * 1000) return;
        patch({ lastTouch: now });
        // 体重秤：踩上去称一称（随机可爱数字）
        if (item.kind === 'scale') {
          const w = (47 + Math.random() * 6).toFixed(1);
          toast(`叮——${w}kg，完美的数字～`);
        }
      }
    },
    [mode, saveSoon, toast, endAction, mealReady, openNotes],
  );

  /** 浴缸水龙头：放水 / 关水 */
  const onFaucetTap = useCallback(
    (item: FurnitureItem) => {
      const on = !item.st?.bathWater;
      setItems((prev) => prev.map((f) => (f.id === item.id ? { ...f, st: { ...f.st, bathWater: on } } : f)));
      toast(on ? '哗啦啦～热水放好咯' : '水龙头关上啦');
      saveSoon();
    },
    [saveSoon, toast],
  );

  /** 泡澡时的放水/关水按钮（浴缸 = 当前动作的家具） */
  const toggleBathWater = useCallback(() => {
    const id = charAction?.itemId;
    if (!id) return;
    setItems((prev) =>
      prev.map((f) => (f.id === id ? { ...f, st: { ...f.st, bathWater: !f.st?.bathWater } } : f)),
    );
    const on = !itemsRef.current.find((f) => f.id === id)?.st?.bathWater;
    toast(on ? '哗啦啦～热水放好咯' : '水龙头关上啦');
    saveSoon();
  }, [charAction, saveSoon, toast]);

  /** C1 换台（电视开着随时可按，不再依附「看电视」动作；频道 1→…→6 循环，v10 新增天气/相册/喵喵台） */
  const cycleChannel = useCallback(() => {
    const tv = itemsRef.current.find((f) => f.kind === 'tv' && f.st?.on);
    if (!tv) return;
    const next = (((tv.st?.channel ?? 1) % 6) + 1) as 1 | 2 | 3 | 4 | 5 | 6;
    setItems((prev) =>
      prev.map((f) => (f.id === tv.id ? { ...f, st: { ...f.st, on: true, channel: next } } : f)),
    );
    const NAMES = ['流光频道', '啵啵新闻台', '拾光音乐台', '天气台', '风景相册台', '喵喵台'] as const;
    toast(`换到${NAMES[next - 1]}～`);
    saveSoon();
  }, [saveSoon, toast]);

  /** 结束乐器弹奏（覆盖层「结束演奏」按钮）：收特写镜头 + 起身 */
  const closeInst = useCallback(() => {
    instRef.current = null;
    setInst(null);
    endAction();
  }, [endAction]);

  /** 放下杯子（端着饮料/咖啡逛时）：收杯子 */
  const dropCup = useCallback(() => {
    carryRef.current.cup = false;
    carryRef.current.coffee = false;
    setCarryCup(false);
    toast('放下杯子，满足～');
    saveSoon();
  }, [saveSoon, toast]);

  // ==================== v5.7 拾光扩展功能 ====================

  // —— F6 拍照模式：快门 → 存进情侣相册 ——
  const photoBusy = useRef(false);
  const takePhoto = useCallback(async () => {
    if (photoBusy.current) return;
    const canvas = rootRef.current?.querySelector('canvas');
    if (!canvas) {
      toast('找不到画面，稍后再试');
      return;
    }
    photoBusy.current = true;
    try {
      const raw = canvas.toDataURL('image/jpeg', 0.92);
      // 压缩到最长边 1280（相册同款压缩规格）
      const data = await new Promise<string>((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          try {
            const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
            const cv = document.createElement('canvas');
            cv.width = Math.max(1, Math.round(img.width * scale));
            cv.height = Math.max(1, Math.round(img.height * scale));
            cv.getContext('2d')!.drawImage(img, 0, 0, cv.width, cv.height);
            resolve(cv.toDataURL('image/jpeg', 0.85));
          } catch (e) {
            reject(e instanceof Error ? e : new Error('compress-fail'));
          }
        };
        img.onerror = () => reject(new Error('img-load-fail'));
        img.src = raw;
      });
      const b64 = data.split(',')[1] ?? '';
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: 'image/jpeg' });
      const partnerId = readInviteMeta().partnerContactId;
      if (!partnerId) {
        // 没有恋人档案：落到手机「照片」相机胶卷（不丢照）
        await localDB.put('photos', { id: genId(), blob, name: `拾光小屋 ${new Date().toLocaleDateString('zh-CN')}.jpg`, createdAt: Date.now() });
        toast('📸 已存进照片 App');
        return;
      }
      await addAlbum(partnerId, data, {
        origin: 'user',
        name: `拾光小屋 · ${new Date().toLocaleDateString('zh-CN')}`,
      });
      toast('📸 已存进情侣相册');
    } catch {
      toast('拍照失败了，再试一次');
    } finally {
      photoBusy.current = false;
    }
  }, [toast]);

  // —— F5 做饭小游戏：完成 → 一桌好菜上桌 ——
  const onCookingDone = useCallback(
    (dish: string) => {
      setCookingGame(false);
      setMealReady(true);
      setMealName(dish);
      toast(`「${dish}」出锅啦，上桌开饭吧～`);
      saveSoon();
    },
    [saveSoon, toast],
  );

  // —— G8 进门未读便签提醒（首份带便签的档案到达时只弹一次） ——
  useEffect(() => {
    if (notesRemindRef.current || notes.length === 0) return;
    notesRemindRef.current = true;
    const seen = notesSeenRef.current.me ?? 0;
    const unread = notes.filter((n) => n.by === 'partner' && n.ts > seen).length;
    if (unread > 0) toast(`TA给你留了 ${unread} 条便签，点留言板看看～`);
  }, [notes, toast]);

  // —— G10 咖啡拉花：ok/perfect 才开煮（走既有「端一杯」动作链） ——
  const onLatteResult = useCallback(
    (r: 'miss' | 'ok' | 'perfect') => {
      setLatteOpen(false);
      if (r === 'miss') {
        toast('奶泡洒了…擦擦台面，再试一次？');
        return;
      }
      const machine = itemsRef.current.find((f) => f.kind === 'coffeeMaker');
      if (!machine) return;
      if (poseRef.current.pose !== 'stand' || actRef.current) endAction();
      setCharAction({ type: 'coffee', itemId: machine.id, active: false });
      toast(r === 'perfect' ? '完美爱心拉花！咖啡机喌哚喌哚煮咖啡…' : '不错的拉花！咖啡机喌哚喌哚煮咖啡…');
    },
    [toast, endAction],
  );

  // —— G1 装修方案：保存当前整屋快照到槽位（照片不随方案备份） ——
  const saveLayout = useCallback(
    (slot: number) => {
      const s = takeSnap();
      const strip = (f: FurnitureItem): FurnitureItem => {
        const clone = { ...f, st: { ...f.st } };
        delete clone.st.photo;
        return clone;
      };
      const snap: LayoutSnap = {
        name: `方案${['A', 'B', 'C'][slot]}`,
        ts: Date.now(),
        furniture: s.items.map(strip),
        floorCol: s.floorCol,
        wallCol: s.wallCol,
        floorColBed: s.floorColBed,
        wallColBed: s.wallColBed,
        floorColK: s.floorColK,
        wallColK: s.wallColK,
        floorColB: s.floorColB,
        wallColB: s.wallColB,
        floorColBal: s.floorColBal,
        wallColBal: s.wallColBal,
      };
      setLayouts((prev) => {
        const next = prev.slice();
        next[slot] = snap;
        return next;
      });
      sfx.tap();
      toast(`已存入${snap.name}（${snap.furniture.length} 件，不含照片）`);
      saveSoon();
    },
    [takeSnap, toast, saveSoon],
  );

  // —— G1 装修方案：整屋切换（一步入栈，撤销即回旧布置） ——
  const applyLayout = useCallback(
    (slot: number) => {
      const snap = layoutsRef.current[slot];
      if (!snap) return;
      pushHistory('layout');
      setItems(snap.furniture.map((f) => ({ ...f, st: { ...f.st } })));
      setFloorCol(snap.floorCol);
      setWallCol(snap.wallCol);
      setFloorColBed(snap.floorColBed);
      setWallColBed(snap.wallColBed);
      setFloorColK(snap.floorColK);
      setWallColK(snap.wallColK);
      setFloorColB(snap.floorColB);
      setWallColB(snap.wallColB);
      setFloorColBal(snap.floorColBal);
      setWallColBal(snap.wallColBal);
      setSelId(null);
      setMoveOn(false);
      setPaletteOpen(false);
      sfx.place();
      toast(`切换到${snap.name}，整屋 ${snap.furniture.length} 件（撤销可回旧布置）`);
      saveSoon();
    },
    [pushHistory, toast, saveSoon],
  );

  // —— F4 天气联动：雨声白噪音 + 夜晚自动开灯 ——
  const rainAudioRef = useRef<{ ctx: AudioContext; gain: GainNode } | null>(null);
  useEffect(() => {
    const raining = weatherFx === 'rain';
    if (raining && !rainAudioRef.current) {
      try {
        const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (Ctx) {
          const ctx = new Ctx();
          const len = ctx.sampleRate * 2;
          const buf = ctx.createBuffer(1, len, ctx.sampleRate);
          const ch = buf.getChannelData(0);
          for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * 0.55;
          const src = ctx.createBufferSource();
          src.buffer = buf;
          src.loop = true;
          const filter = ctx.createBiquadFilter();
          filter.type = 'lowpass';
          filter.frequency.value = 900;
          const gain = ctx.createGain();
          gain.gain.value = 0.045;
          src.connect(filter).connect(gain).connect(ctx.destination);
          src.start();
          rainAudioRef.current = { ctx, gain };
        }
      } catch {
        /* 音频不可用静默忽略 */
      }
    } else if (!raining && rainAudioRef.current) {
      const { ctx, gain } = rainAudioRef.current;
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.6);
      setTimeout(() => {
        void ctx.close().catch(() => {});
      }, 800);
      rainAudioRef.current = null;
    }
    return () => {
      if (rainAudioRef.current) {
        void rainAudioRef.current.ctx.close().catch(() => {});
        rainAudioRef.current = null;
      }
    };
  }, [weatherFx]);

  // 卸载时停雨声
  useEffect(
    () => () => {
      if (rainAudioRef.current) {
        void rainAudioRef.current.ctx.close().catch(() => {});
        rainAudioRef.current = null;
      }
    },
    [],
  );

  /** 夜晚自动开灯：真实夜晚（19~6 点）第一次进入小屋 → 客厅/卧室主灯自动亮起 */
  const autoLightsDone = useRef(false);
  useEffect(() => {
    if (autoLightsDone.current || !nightAuto || !night) return;
    autoLightsDone.current = true;
    const hour = new Date().getHours();
    if (hour < 19 && hour >= 6) return; // 只在真实夜间生效
    const hadOn = itemsRef.current.some((f) => CATALOG[f.kind]?.light && f.st?.on);
    if (hadOn) return;
    setItems((prev) =>
      prev.map((f) => {
        const e = CATALOG[f.kind];
        if (!e?.light) return f;
        const room = roomAt(f.x, f.z);
        return room === 'lr' || room === 'br' ? { ...f, st: { ...f.st, on: true } } : f;
      }),
    );
    toast('天黑了，帮你把灯打开啦～');
  }, [night, nightAuto, toast]);

  // ==================== 编辑操作 ====================
  const rotateY = useCallback(
    (dir: 1 | -1) => {
      if (!selId) return;
      pushHistory(`rot-${selId}`);
      setItems((prev) => prev.map((f) => (f.id === selId ? { ...f, ry: normAngle((f.ry ?? 0) + dir * YAW_STEP) } : f)));
      saveSoon();
    },
    [selId, pushHistory, saveSoon],
  );

  const tilt = useCallback(
    (dir: 1 | -1) => {
      if (!selId) return;
      pushHistory(`tilt-${selId}`);
      setItems((prev) =>
        prev.map((f) =>
          f.id === selId
            ? { ...f, rx: Math.max(-TILT_LIMIT, Math.min(TILT_LIMIT, (f.rx ?? 0) + dir * TILT_STEP)) }
            : f,
        ),
      );
      saveSoon();
    },
    [selId, pushHistory, saveSoon],
  );

  const removeSel = useCallback(() => {
    if (!selId) return;
    const victim = itemsRef.current.find((f) => f.id === selId);
    pushHistory();
    // F1：用户亲手收起的节日家具当月不再自动补（下月/来年再见面）
    if (victim) seasonalDismissed.current.add(victim.kind);
    setItems((prev) => prev.filter((f) => f.id !== selId));
    sfx.remove(); // E3：收起 swoosh
    setSelId(null);
    setMoveOn(false);
    setPaletteOpen(false);
    saveSoon();
    toast(victim ? `已收起「${CATALOG[victim.kind]?.name ?? victim.kind}」，撤销可找回` : '已收起家具');
  }, [selId, pushHistory, saveSoon, toast]);

  /** 收起选中的窗户（编辑模式·门窗操作条；撤销可装回，商店「窗户」tab 也能再安装） */
  const removeWinSel = useCallback(() => {
    if (!selId?.startsWith('win-')) return;
    const i = Number(selId.slice(4));
    if (!Number.isInteger(i) || i < 0 || i >= WINS.length) return;
    pushHistory(`win-del-${i}`);
    setWinExist((prev) => {
      const next = prev.slice();
      next[i] = false;
      return next;
    });
    sfx.remove();
    setSelId(null);
    setPaletteOpen(false);
    saveSoon();
    toast(`已收起${WIN_NAMES[i] ?? '窗户'}，商店「窗户」可装回来`);
  }, [selId, pushHistory, saveSoon, toast]);

  /** 商店「窗户」tab：把收起的窗装回默认位（一步可撤销） */
  const installWin = useCallback(
    (i: number) => {
      if (i < 0 || i >= WINS.length) return;
      pushHistory(`win-add-${i}`);
      setWinExist((prev) => {
        const next = prev.slice();
        next[i] = true;
        return next;
      });
      // 装回默认位（旧滑行位可能已被别的门窗占用）
      setWinPos((prev) => {
        const next = prev ? prev.slice() : WINS.map((ww) => ww.def);
        next[i] = WINS[i].def;
        return next;
      });
      sfx.place();
      toast(`已安装${WIN_NAMES[i] ?? '窗户'}`);
    },
    [pushHistory, toast],
  );

  /** 应用一份快照（撤销/重做共用）：整体回滚可编辑状态并清选择 */
  const applySnap = useCallback(
    (s: EditSnap) => {
      setItems(s.items);
      setWinExist(s.winExist ? s.winExist.slice() : [0, 1, 2, 3, 4, 5, 6, 7, 8].map(() => true));
      setWinPos(s.winPos);
      setDoorPos(s.doorPos);
      setWinCol(s.winCol);
      setDoorCol(s.doorCol);
      setFloorCol(s.floorCol);
      setWallCol(s.wallCol);
      setFloorColBed(s.floorColBed);
      setWallColBed(s.wallColBed);
      setFloorColK(s.floorColK);
      setWallColK(s.wallColK);
      setFloorColB(s.floorColB);
      setWallColB(s.wallColB);
      setCeilCol(s.ceilCol);
      setCeilColBed(s.ceilColBed);
      setCeilColK(s.ceilColK);
      setCeilColB(s.ceilColB);
      setFloorColBal(s.floorColBal);
      setWallColBal(s.wallColBal);
      setFloorTex(s.floorTex);
      setWallTex(s.wallTex);
      setSelId(null);
      setMoveOn(false);
      setPaletteOpen(false);
      saveSoon();
    },
    [saveSoon],
  );

  /** 撤销上一步装修操作（Ctrl+Z / 撤销按钮）：覆盖放置/收起/移动/旋转/升降/换色/门窗调整 */
  const undo = useCallback(() => {
    const prev = undoStack.current.pop();
    if (!prev) {
      toast('没有可撤销的操作啦');
      return;
    }
    redoStack.current.push(takeSnap());
    histTagRef.current = { tag: null, at: 0 };
    setHistLen({ u: undoStack.current.length, r: redoStack.current.length });
    applySnap(prev);
  }, [applySnap, takeSnap, toast]);

  /** 重做（取消上一次撤销）：Ctrl+Shift+Z / Ctrl+Y / 重做按钮 */
  const redo = useCallback(() => {
    const next = redoStack.current.pop();
    if (!next) {
      toast('没有可重做的操作啦');
      return;
    }
    undoStack.current.push(takeSnap());
    histTagRef.current = { tag: null, at: 0 };
    setHistLen({ u: undoStack.current.length, r: redoStack.current.length });
    applySnap(next);
  }, [applySnap, takeSnap, toast]);

  // Ctrl+Z 撤销 / Ctrl+Shift+Z 或 Ctrl+Y 重做（输入框聚焦时不抢）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k !== 'z' && k !== 'y') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      if (k === 'z' && !e.shiftKey) undo();
      else redo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  /** 四向微调：沿屏幕视觉方向移动选中目标（家具 = 一格；门窗 = 沿墙滑行） */
  const nudgeSel = useCallback(
    (dx: number, dz: number) => {
      if (!selId) return;
      // —— 门窗：沿墙滑行（只取切向分量） ——
      if (selId.startsWith('win-') || selId.startsWith('door-')) {
        const step = 0.25;
        if (selId.startsWith('win-')) {
          const i = Number(selId.slice(4));
          const w = WINS[i];
          if (!w) return;
          if (w.axis === 'z' && dx === 0) return;
          if (w.axis === 'x' && dz === 0) return;
          pushHistory(`move-${selId}`);
          const cur = winPosRef.current?.[i] ?? w.def;
          const along = cur + (w.axis === 'z' ? Math.sign(dx) : Math.sign(dz)) * step;
          const r = resolveWinPos(i, along, winPosRef.current, doorPosRef.current);
          setWinPos((prev) => {
            const next = prev ? prev.slice() : WINS.map((ww) => ww.def);
            next[i] = r.along;
            return next;
          });
        } else {
          const did = selId.slice(5) as 'bed' | 'kt' | 'bath' | 'bal';
          const d = DOORS.find((dd) => dd.id === did);
          if (!d) return;
          if (d.axis === 'z' && dx === 0) return;
          if (d.axis === 'x' && dz === 0) return;
          pushHistory(`move-${selId}`);
          const cur = doorPosRef.current?.[did] ?? d.def;
          const along = cur + (d.axis === 'z' ? Math.sign(dx) : Math.sign(dz)) * step;
          const r = resolveDoorPos(did, along, winPosRef.current, doorPosRef.current);
          setDoorPos((prev) => ({ bed: DOORS[0].def, kt: DOORS[1].def, bath: DOORS[2].def, bal: DOORS[3].def, ...prev, [did]: r.along }));
        }
        saveSoon();
        return;
      }
      // —— 家具：四房间钳位 + 吸附 ——
      pushHistory(`move-${selId}`);
      setItems((prev) =>
        prev.map((f) => {
          if (f.id !== selId) return f;
          const e = CATALOG[f.kind];
          const [w, d] = e ? footprintOf(e, f.ry ?? 0) : [0.5, 0.5];
          const hw = Math.max(w / 2, 0.18);
          const hd = Math.max(d / 2, 0.18);
          const [x, z] = clampFurnToRooms(f.x + dx * SNAP, f.z + dz * SNAP, hw, hd);
          return { ...f, x, z };
        }),
      );
      saveSoon();
    },
    [selId, pushHistory, saveSoon],
  );

  /** 升降选中家具：抬上桌面 / 放回地面（相框、小盆栽、书堆…） */
  const liftSel = useCallback(
    (dir: 1 | -1) => {
      if (!selId) return;
      pushHistory(`lift-${selId}`);
      setItems((prev) =>
        prev.map((f) => {
          if (f.id !== selId) return f;
          const y = Math.round(Math.min(LIFT_MAX, Math.max(0, (f.y ?? 0) + dir * LIFT_STEP)) * 100) / 100;
          return { ...f, y };
        }),
      );
      saveSoon();
    },
    [selId, pushHistory, saveSoon],
  );

  /** HUD 方向按钮 → 微调指令（Canvas 内按当前视角方位换算世界轴） */
  const issueMoveCmd = useCallback((dir: 'up' | 'down' | 'left' | 'right') => {
    moveCmd.current = { v: moveCmd.current.v + 1, dir };
  }, []);

  /** 调色盘：选中目标上色 / 恢复默认（门窗选中时改全屋门窗色） */
  const applyColor = useCallback(
    (hex: string | null) => {
      if (!selId) return;
      pushHistory();
      if (selId.startsWith('win-')) {
        setWinCol(hex ?? undefined);
        saveSoon();
        return;
      }
      if (selId.startsWith('door-')) {
        setDoorCol(hex ?? undefined);
        saveSoon();
        return;
      }
      setItems((prev) =>
        prev.map((f) => (f.id === selId ? { ...f, col: hex ?? undefined } : f)),
      );
      saveSoon();
    },
    [selId, pushHistory, saveSoon],
  );

  /** E7 灯光颜色：只改选中灯具的自选光色（null = 恢复目录默认暖光，不动其它状态） */
  const applyLightColor = useCallback(
    (hex: string | null) => {
      if (!selId) return;
      setItems((prev) =>
        prev.map((f) => (f.id === selId ? { ...f, st: { ...f.st, lc: hex ?? undefined } } : f)),
      );
      saveSoon();
    },
    [selId, saveSoon],
  );

  /** v11 H3 猫窝换色：写 item.st.bedColor（场景层 Furn3D 猫窝渲染消费该字段），带撤销快照 */
  const applyBedColor = useCallback(
    (hex: string) => {
      if (!selId) return;
      pushHistory();
      setItems((prev) => prev.map((f) => (f.id === selId ? { ...f, st: { ...f.st, bedColor: hex } } : f)));
      sfx.tap();
      toast('窝的颜色换好啦，小家伙可喜欢了～');
      saveSoon();
    },
    [selId, pushHistory, toast, saveSoon],
  );

  const toggleMove = useCallback(() => {
    setMoveOn((m) => {
      const next = !m;
      if (next) toast('移动模式：按住画面拖动搬运，或点方向按钮微调');
      return next;
    });
  }, [toast]);

  /** 窗户开合（生活/编辑模式均可点） */
  const toggleWin = useCallback(
    (i: number) => {
      setWin((prev) => {
        const next = prev.slice();
        next[i] = !next[i];
        return next;
      });
      saveSoon();
    },
    [saveSoon],
  );

  /** 地板/墙壁自定义色（null = 恢复默认） */
  const applyFloorCol = useCallback(
    (hex: string | null) => {
      pushHistory();
      setFloorCol(hex ?? undefined);
      saveSoon();
    },
    [pushHistory, saveSoon],
  );

  const applyWallCol = useCallback(
    (hex: string | null) => {
      pushHistory();
      setWallCol(hex ?? undefined);
      saveSoon();
    },
    [pushHistory, saveSoon],
  );

  /** 卧室地板/墙壁自定义色（客厅卧室分开换色） */
  const applyFloorColBed = useCallback(
    (hex: string | null) => {
      pushHistory();
      setFloorColBed(hex ?? undefined);
      saveSoon();
    },
    [pushHistory, saveSoon],
  );

  const applyWallColBed = useCallback(
    (hex: string | null) => {
      pushHistory();
      setWallColBed(hex ?? undefined);
      saveSoon();
    },
    [pushHistory, saveSoon],
  );

  /** 厨房地板/墙壁自定义色（三房间分开换色） */
  const applyFloorColK = useCallback(
    (hex: string | null) => {
      pushHistory();
      setFloorColK(hex ?? undefined);
      saveSoon();
    },
    [pushHistory, saveSoon],
  );

  const applyWallColK = useCallback(
    (hex: string | null) => {
      pushHistory();
      setWallColK(hex ?? undefined);
      saveSoon();
    },
    [pushHistory, saveSoon],
  );

  /** 卫生间地板/墙壁自定义色（四房间分开换色） */
  const applyFloorColB = useCallback(
    (hex: string | null) => {
      pushHistory();
      setFloorColB(hex ?? undefined);
      saveSoon();
    },
    [pushHistory, saveSoon],
  );

  const applyWallColB = useCallback(
    (hex: string | null) => {
      pushHistory();
      setWallColB(hex ?? undefined);
      saveSoon();
    },
    [pushHistory, saveSoon],
  );

  const applyFloorColBal = useCallback(
    (hex: string | null) => {
      pushHistory();
      setFloorColBal(hex ?? undefined);
      saveSoon();
    },
    [pushHistory, saveSoon],
  );

  const applyWallColBal = useCallback(
    (hex: string | null) => {
      pushHistory();
      setWallColBal(hex ?? undefined);
      saveSoon();
    },
    [pushHistory, saveSoon],
  );

  /** 天花板自定义色（四房间分开） */
  const applyCeilCol = useCallback(
    (hex: string | null) => {
      pushHistory();
      setCeilCol(hex ?? undefined);
      saveSoon();
    },
    [pushHistory, saveSoon],
  );

  const applyCeilColBed = useCallback(
    (hex: string | null) => {
      pushHistory();
      setCeilColBed(hex ?? undefined);
      saveSoon();
    },
    [pushHistory, saveSoon],
  );

  const applyCeilColK = useCallback(
    (hex: string | null) => {
      pushHistory();
      setCeilColK(hex ?? undefined);
      saveSoon();
    },
    [pushHistory, saveSoon],
  );

  const applyCeilColB = useCallback(
    (hex: string | null) => {
      pushHistory();
      setCeilColB(hex ?? undefined);
      saveSoon();
    },
    [pushHistory, saveSoon],
  );

  const applyDoorCol = useCallback(
    (hex: string | null) => {
      pushHistory();
      setDoorCol(hex ?? undefined);
      saveSoon();
    },
    [pushHistory, saveSoon],
  );

  const applyWinCol = useCallback(
    (hex: string | null) => {
      pushHistory();
      setWinCol(hex ?? undefined);
      saveSoon();
    },
    [pushHistory, saveSoon],
  );

  /** 卧室门开合（点击门本体） */
  const toggleDoor = useCallback(() => {
    sfx.door(); // E3：门轴轻响
    setDoorOpen((o) => {
      const next = !o;
      toast(next ? '门开啦，走进去就是卧室～' : '卧室门已关上');
      return next;
    });
    saveSoon();
  }, [saveSoon, toast]);

  /** 厨房门开合（点击门本体） */
  const toggleKitchenDoor = useCallback(() => {
    sfx.door();
    setKitchenDoorOpen((o) => {
      const next = !o;
      toast(next ? '厨房门开啦，里面香喷喷～' : '厨房门已关上');
      return next;
    });
    saveSoon();
  }, [saveSoon, toast]);

  /** 卫生间门开合（点击门本体） */
  const toggleBathDoor = useCallback(() => {
    sfx.door();
    setBathDoorOpen((o) => {
      const next = !o;
      toast(next ? '浴室门开啦，泡泡浴准备～' : '卫生间门已关上');
      return next;
    });
    saveSoon();
  }, [saveSoon, toast]);

  const toggleBalconyDoor = useCallback(() => {
    sfx.door();
    setBalconyDoorOpen((o) => {
      const next = !o;
      toast(next ? '阳台门开啦，出去晒晒太阳～' : '阳台门已关上');
      return next;
    });
    saveSoon();
  }, [saveSoon, toast]);

  /** v10 书房门：客厅西墙 → 书房 annex */
  const toggleStudyDoor = useCallback(() => {
    sfx.door();
    setStudyDoorOpen((o) => {
      const next = !o;
      toast(next ? '书房门开啦，进去看会儿书～' : '书房门已关上');
      return next;
    });
    saveSoon();
  }, [saveSoon, toast]);

  /** v10 花园栅栏门：厨房南墙外 → 露天花园 */
  const toggleGardenGateDoor = useCallback(() => {
    sfx.door();
    setGardenGateOpen((o) => {
      const next = !o;
      toast(next ? '花园门开啦，去院子里透透气～' : '花园门已关上');
      return next;
    });
    saveSoon();
  }, [saveSoon, toast]);

  /** 编辑模式点选门窗（选中而非开合） */
  const onWallTap = useCallback(
    (id: string) => {
      setShopOpen(false);
      setPaletteOpen(false);
      setSelId((s) => (s === id ? null : id));
    },
    [],
  );

  /** 第一/第三人称切换 */
  const toggleFp = useCallback(() => {
    setFp((v) => {
      const next = !v;
      toast(next ? '第一人称：你就是小人本人啦～' : '第三人称：跟随视角');
      return next;
    });
    saveSoon();
  }, [saveSoon, toast]);

  /** E3 音效开关（生活/编辑模式两处按钮共用；持久化在 sfx 模块内） */
  const toggleSfx = useCallback(() => {
    setSfxOn((on) => {
      const next = !on;
      sfx.setEnabled(next);
      toast(next ? '音效已开' : '音效已关');
      return next;
    });
  }, [toast]);

  /** 相框选照片完成：按框型裁剪 → 压缩 → 写入家具状态（永久保存） */
  const onPickPhoto = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      e.target.value = ''; // 允许重复选同一张
      const id = photoTargetRef.current;
      photoTargetRef.current = null;
      if (!f || !id) return;
      const kind = itemsRef.current.find((it) => it.id === id)?.kind ?? 'photoFrame';
      try {
        const data = await compressPhoto(f, PHOTO_ASPECTS[kind] ?? 0.714);
        setItems((prev) => prev.map((it) => (it.id === id ? { ...it, st: { ...it.st, photo: data } } : it)));
        saveSoon();
        toast('照片装进相框啦，永久保存～');
      } catch {
        toast('照片读取失败，换一张试试？');
      }
    },
    [saveSoon, toast],
  );

  /** 编辑模式画面缩放 */
  const zoom = useCallback(
    (dir: 1 | -1) => {
      zoomCmd.current = { v: zoomCmd.current.v + 1, dir };
    },
    [],
  );

  const onDragMove = useCallback((id: string, x: number, z: number) => {
    // 门窗：沿墙滑行（写入 winPos/doorPos）
    if (id.startsWith('win-')) {
      const i = Number(id.slice(4));
      const w = WINS[i];
      if (!w) return;
      pushHistory(`drag-win-${i}`); // 首帧入栈，后续帧合入同一步
      const along = w.axis === 'z' ? x : z;
      setWinPos((prev) => {
        const next = prev ? prev.slice() : WINS.map((ww) => ww.def);
        next[i] = along;
        return next;
      });
      return;
    }
    if (id.startsWith('door-')) {
      const did = id.slice(5) as 'bed' | 'kt' | 'bath';
      const d = DOORS.find((dd) => dd.id === did);
      if (!d) return;
      pushHistory(`drag-door-${did}`);
      const along = d.axis === 'z' ? x : z;
      setDoorPos((prev) => ({ bed: DOORS[0].def, kt: DOORS[1].def, bath: DOORS[2].def, bal: DOORS[3].def, ...prev, [did]: along }));
      return;
    }
    pushHistory(`drag-${id}`); // 拖拽首帧入栈：整段拖拽合为一步
    // E2 拖拽吸附：x/z 先落到 0.25m 网格再写入（门窗分支有自己的沿墙吸附，不在此处理）
    const sx = Math.round(x * 4) / 4;
    const sz = Math.round(z * 4) / 4;
    setItems((prev) => prev.map((f) => (f.id === id ? { ...f, x: sx, z: sz } : f)));
  }, [pushHistory]);

  const onDragSelect = useCallback((id: string) => {
    setSelId(id);
  }, []);

  /** 拖拽结束：家具挂墙件自动贴墙；门窗吸附到 0.05m 网格 */
  const onDragEnd = useCallback(
    (id: string) => {
      if (id.startsWith('win-')) {
        const i = Number(id.slice(4));
        const w = WINS[i];
        if (w) {
          const cur = winPosRef.current?.[i] ?? w.def;
          const r = resolveWinPos(i, Math.round(cur * 20) / 20, winPosRef.current, doorPosRef.current);
          setWinPos((prev) => {
            const next = prev ? prev.slice() : WINS.map((ww) => ww.def);
            next[i] = r.along;
            return next;
          });
        }
        saveSoon();
        return;
      }
      if (id.startsWith('door-')) {
        const did = id.slice(5) as 'bed' | 'kt' | 'bath';
        const d = DOORS.find((dd) => dd.id === did);
        if (d) {
          const cur = doorPosRef.current?.[did] ?? d.def;
          const r = resolveDoorPos(did, Math.round(cur * 20) / 20, winPosRef.current, doorPosRef.current);
          setDoorPos((prev) => ({ bed: DOORS[0].def, kt: DOORS[1].def, bath: DOORS[2].def, bal: DOORS[3].def, ...prev, [did]: r.along }));
        }
        saveSoon();
        return;
      }
      const it = itemsRef.current.find((f) => f.id === id);
      if (it && CATALOG[it.kind]?.wallMount) {
        const s = snapToWallSlot(it.x, it.z);
        const nx = s.x + Math.sin(s.slot.ry) * 0.06;
        const nz = s.z + Math.cos(s.slot.ry) * 0.06;
        setItems((prev) => prev.map((f) => (f.id === id ? { ...f, x: nx, z: nz, ry: s.slot.ry } : f)));
      }
      saveSoon();
    },
    [saveSoon],
  );

  const onFloorTap = useCallback(() => {
    if (Date.now() - petTapAtRef.current < 450) return; // 刚点过宠物（up 配对落地），不算「点别处」
    if (Date.now() - partnerTapAtRef.current < 450) return; // v8.0：刚点过陪伴小人（up 配对落地），不算「点别处」
    setSelId(null);
    setMoveOn(false);
    setPaletteOpen(false);
    setPetBarOpen(false); // v7.1：点别处（地面）互动竖条消失
    setPetPanel(false); // v7.2：点别处状态面板也收起
    setPartnerMenuOpen(false); // v8.0：点别处陪伴菜单也收起
  }, []);

  // ---------------- 商店 ----------------
  const shopItems = useMemo(() => {
    const list = Object.values(CATALOG).filter(
      (e) => !e.hidden && (shopTab === 'all' ? true : e.cat === shopTab),
    );
    return list;
  }, [shopTab]);

  /** 缩略图待生成队列（undefined = 还没处理过；空串 = 失败已跳过；稳定引用，避免工作室重复重启）；套装 tab 追加 `set:${id}` 整组合成目标 */
  const thumbQueue = useMemo(() => {
    const kindQ = shopItems
      .filter((e) => thumbMap[e.kind] === undefined && !getCachedThumb(e.kind))
      .map((e) => e.kind);
    const setQ =
      shopTab === 'set'
        ? FURN_SETS.filter((s) => thumbMap[`set:${s.id}`] === undefined && !getCachedThumb(`set:${s.id}`)).map((s) => `set:${s.id}`)
        : [];
    return [...kindQ, ...setQ];
  }, [shopItems, thumbMap, shopTab]);

  /** 找个不太挤的落点（小人当前所在房间内） */
  const findSpot = useCallback((kind: FurnitureKind, room: RoomId): { x: number; z: number } => {
    const e = CATALOG[kind];
    const [w, d] = e.fp;
    const [x0, x1, z0, z1] = ROOM_SPANS[room];
    for (let i = 0; i < 40; i++) {
      const x = x0 + Math.random() * (x1 - x0);
      const z = z0 + Math.random() * (z1 - z0);
      const ok = itemsRef.current.every((it) => {
        const ce = CATALOG[it.kind];
        if (!ce || (it.y ?? 0) > 0.45) return true;
        const [cw, cd] = ce.fp;
        return Math.abs(it.x - x) > (w + cw) / 2 + 0.15 || Math.abs(it.z - z) > (d + cd) / 2 + 0.15;
      });
      if (ok) return { x: Math.round(x * 4) / 4, z: Math.round(z * 4) / 4 };
    }
    return { x: Math.round(((x0 + x1) / 2) * 4) / 4, z: Math.round(((z0 + z1) / 2) * 4) / 4 };
  }, []);

  // —— G10 娃娃机：抓中的毛绒直接摆进房间（一步可撤销；依赖 findSpot，故在其后声明） ——
  const onClawWin = useCallback(
    (plush: 'plushBunny' | 'plushDuck' | 'plushPanda' | 'plushPig' | 'plushCat' | 'bear') => {
      const machineId = clawFor;
      setClawFor(null);
      if (!machineId) return;
      pushHistory('claw');
      const room = roomAt(meRT.current.x, meRT.current.z);
      const spot = findSpot(plush, room);
      const id = `${plush}-${Date.now().toString(36)}-${++buySeq}`;
      const now = Date.now();
      setItems((prev) => [
        ...prev.map((f) => (f.id === machineId ? { ...f, st: { ...f.st, lastClaw: now } } : f)),
        { id, kind: plush, x: spot.x, z: spot.z, st: {} } as FurnitureItem,
      ]);
      sfx.place();
      toast(`抓到啦！${CATALOG[plush]?.name ?? '毛绒'}搬进了${ROOM_NAMES[room]}～`);
      saveSoon();
    },
    [clawFor, pushHistory, findSpot, toast, saveSoon],
  );

  // —— v7.1 宠物小窝：旧存档没有猫窝时自动补一个；已有的窝若被家具/墙夹住（缝隙太窄猫会卡死出不来）则挪到开阔点 ——
  useEffect(() => {
    const beds = itemsRef.current.filter((f) => f.kind === 'petBed' && (f.y ?? 0) < 0.45);
    /** 猫窝需要周围 0.35m 的「起身空间」，贴缝会导致宠物醒来后被钳制卡死 */
    const badSpot = (x: number, z: number, selfId: string | null) =>
      itemsRef.current.some((it) => {
        if (it.id === selfId || (it.y ?? 0) > 0.45) return false;
        const ce = CATALOG[it.kind];
        if (!ce) return false;
        const [w, d] = CATALOG['petBed'].fp;
        const [cw, cd] = footprintOf(ce, it.ry ?? 0);
        return Math.abs(it.x - x) < w / 2 + cw / 2 + 0.35 && Math.abs(it.z - z) < d / 2 + cd / 2 + 0.35;
      });
    /** 在客厅挑一个四周开阔的落点（随机重试，失败退回西北角固定点） */
    const pickSafe = (): { x: number; z: number } => {
      const [x0, x1, z0, z1] = ROOM_SPANS.lr;
      for (let i = 0; i < 60; i++) {
        const x = Math.round((x0 + Math.random() * (x1 - x0)) * 4) / 4;
        const z = Math.round((z0 + Math.random() * (z1 - z0)) * 4) / 4;
        if (!badSpot(x, z, null)) return { x, z };
      }
      return { x: -3.42, z: -1.42 };
    };
    const bed = beds[0];
    if (bed) {
      // 已有窝：夹缝里的窝 → 搬到开阔处（一次性迁移，保存后不再触发）
      if (badSpot(bed.x, bed.z, bed.id)) {
        const spot = pickSafe();
        setItems((prev) => prev.map((f) => (f.id === bed.id ? { ...f, x: spot.x, z: spot.z } : f)));
        saveSoon();
      }
      return;
    }
    // 没有窝：补植一个
    const spot = pickSafe();
    setItems((prev) => [
      ...prev,
      { id: `petBed-auto-${Date.now().toString(36)}-${++buySeq}`, kind: 'petBed', x: spot.x, z: spot.z, ry: 0.5, st: {} } as FurnitureItem,
    ]);
    saveSoon();
    // 仅挂载时检查一次（刻意不依赖外层状态，避免随 items 变化重复触发）
  }, []);

  /** 在指定房间找一段空墙面（避开已挂件/高家具/窗户门洞；返回贴墙坐标与朝向） */
  const findWallSpot = useCallback(
    (room: RoomId, kind: FurnitureKind): { x: number; z: number; ry: number } => {
      const e = CATALOG[kind];
      const w = e.fp[0];
      const high = (e.wallY ?? 1.45) > 0.9; // 高挂件（相框/电视）需要避让窗户/门洞
      const slots = WALL_SLOTS.filter((s) => s.room === room);
      outer: for (const s of slots.length ? slots : WALL_SLOTS) {
        for (let a = s.from + w / 2 + 0.15; a <= s.to - w / 2 - 0.15 + 0.001; a += 0.45) {
          if (high && s.avoid?.some(([a0, a1]) => a > a0 - w / 2 && a < a1 + w / 2)) continue;
          const px = s.axis === 'z' ? a : s.at;
          const pz = s.axis === 'z' ? s.at : a;
          const free = itemsRef.current.every((it) => {
            const ce = CATALOG[it.kind];
            if (!ce) return true;
            const ialong = s.axis === 'z' ? it.x : it.z;
            const idist = s.axis === 'z' ? Math.abs(it.z - s.at) : Math.abs(it.x - s.at);
            // 已挂件/高家具占位：同墙面且沿墙距离不够 → 避让
            const tallBlock = (ce.h ?? 0) > 1.05 && (it.y ?? 0) < 0.45 && idist < 0.9;
            const wallBlock = (it.y ?? 0) > 0.9 && idist < 0.55;
            if (!tallBlock && !wallBlock) return true;
            const [ow] = footprintOf(ce, it.ry ?? 0);
            return Math.abs(ialong - a) > (ow + w) / 2 + 0.25;
          });
          if (free) {
            return { x: px + Math.sin(s.ry) * 0.06, z: pz + Math.cos(s.ry) * 0.06, ry: s.ry };
          }
        }
      }
      const s = slots[0] ?? WALL_SLOTS[0];
      const a = (s.from + s.to) / 2;
      return {
        x: (s.axis === 'z' ? a : s.at) + Math.sin(s.ry) * 0.06,
        z: (s.axis === 'z' ? s.at : a) + Math.cos(s.ry) * 0.06,
        ry: s.ry,
      };
    },
    [],
  );

  /** 小人在哪个房间，新家具就添加到哪个房间（商城可无限重复购买） */
  const buy = useCallback(
    (kind: FurnitureKind) => {
      const e = CATALOG[kind];
      if (!e) return;
      pushHistory();
      const id = `${kind}-${Date.now().toString(36)}-${++buySeq}`;
      const room: RoomId = roomAt(meRT.current.x, meRT.current.z);

      if (kind === 'chandelier') {
        // 吊灯：挂当前房间天花板中央附近
        const spot = findSpot(kind, room);
        setItems((prev) => [...prev, { id, kind, x: spot.x, z: spot.z, y: WALL_H - 0.04, st: {} }]);
        toast(`吊灯挂到${ROOM_NAMES[room]}天花板啦`);
      } else if (e.wallMount || kind === 'tv') {
        // 挂墙件（相框/插座/电视）：挂到当前房间的空墙面
        const spot = findWallSpot(room, kind);
        const y = kind === 'tv' ? 1.19 : (e.wallY ?? 1.45);
        setItems((prev) => [...prev, { id, kind, x: spot.x, z: spot.z, y, ry: spot.ry, st: {} }]);
        toast(`已挂到${ROOM_NAMES[room]}墙上`);
      } else if (kind === 'aircon') {
        // 壁挂空调：挂当前房间东墙（1.85m 高，面朝西）
        const pos =
          room === 'lr'
            ? { x: 4.34, z: -1.6 }
            : room === 'br'
              ? { x: 1.39, z: 5.6 }
              : room === 'kt'
                ? { x: 7.38, z: 4.1 }
                : { x: BATH_X1 - 0.16, z: -0.8 };
        setItems((prev) => [...prev, { id, kind, x: pos.x, z: pos.z, y: 1.85, ry: -Math.PI / 2, st: {} }]);
        toast(`已挂到${ROOM_NAMES[room]}东墙`);
      } else {
        const spot = findSpot(kind, room);
        setItems((prev) => [...prev, { id, kind, x: spot.x, z: spot.z, ry: 0, st: {} }]);
        toast(`已添加「${e.name}」到${ROOM_NAMES[room]}`);
      }
      setSelId(id);
      sfx.place(); // E3：可爱 pop（在 setSelId 前后皆可，这里放成功路径末尾）
      saveSoon();
    },
    [findSpot, findWallSpot, pushHistory, saveSoon, toast],
  );

  /** F3 成套举放：锚点找位后整组落位（一次 pushHistory，整组一步撤销；不 setSelId 以免误导单件拖拽） */
  const placeSet = useCallback(
    (id: string) => {
      const set = FURN_SETS.find((s) => s.id === id);
      if (!set) return;
      pushHistory();
      const anchor = findSpot(set.anchor, roomAt(meRT.current.x, meRT.current.z));
      const newItems: FurnitureItem[] = set.items.map((it) => {
        const e = CATALOG[it.kind];
        const [w, d] = e ? footprintOf(e, it.ry ?? 0) : [0.5, 0.5];
        const hw = Math.max(w / 2, 0.18);
        const hd = Math.max(d / 2, 0.18);
        const [x, z] = clampFurnToRooms(anchor.x + it.dx, anchor.z + it.dz, hw, hd);
        const item: FurnitureItem = {
          id: `${it.kind}-${Date.now().toString(36)}-${++buySeq}`,
          kind: it.kind,
          x,
          z,
          st: {},
        };
        if (it.y != null) item.y = it.y;
        if (it.ry != null) item.ry = it.ry;
        return item;
      });
      setItems((prev) => [...prev, ...newItems]);
      toast(`已摆好「${set.name}」，共 ${newItems.length} 件`);
      sfx.place();
      saveSoon();
    },
    [findSpot, pushHistory, saveSoon, toast],
  );

  // F1 节日限定：当月节日家具自动悄悄出现在客厅（不 pushHistory —— 不算用户操作；
  // 用户收起过的 kind 记入 seasonalDismissed，当月不再补）
  useEffect(() => {
    const month = new Date().getMonth() + 1;
    const kinds = SEASONAL[month];
    if (!kinds || kinds.length === 0) return;
    const additions: FurnitureItem[] = [];
    for (const k of kinds) {
      if (seasonalDismissed.current.has(k)) continue;
      if (items.some((f) => f.kind === k)) continue;
      if (!CATALOG[k]) continue;
      const spot = findSpot(k, 'lr');
      additions.push({ id: `${k}-${Date.now().toString(36)}-${++buySeq}`, kind: k, x: spot.x, z: spot.z, st: {} });
    }
    if (additions.length === 0) return;
    setItems((prev) => [...prev, ...additions]);
    for (const it of additions) {
      toast(`${month} 月啦，${CATALOG[it.kind].name}悄悄出现在客厅～`);
    }
  }, [items, findSpot, toast]);

  const resetHome = useCallback(async () => {
    const fresh = await resetRemote();
    adoptHome(fresh.home);
    setRev(fresh.rev);
    meRT.current.x = fresh.home.chars.me.x;
    meRT.current.z = fresh.home.chars.me.z;
    taRT.current.x = fresh.home.chars.partner.x;
    taRT.current.z = fresh.home.chars.partner.z;
    setSelId(null);
    setMoveOn(false);
    setPaletteOpen(false);
    setRoomStyleOpen(false);
    toast('小家已重置');
  }, [toast, adoptHome]);

  // ---------------- 模式 / 昼夜 / 全屏 ----------------
  const switchMode = useCallback(
    (m: HomeMode) => {
      setMode(m);
      if (m === 'edit') {
        setShopOpen(true);
        // 进装修模式：结束进行中的坐/睡/泡动作（含自动结束型定时器）
        if (actRef.current || poseRef.current.pose !== 'stand') {
          actRef.current = null;
          poseRef.current.pose = 'stand';
          setCharAction(null);
        }
        if (actTimerRef.current) {
          clearTimeout(actTimerRef.current);
          actTimerRef.current = null;
        }
      } else {
        setShopOpen(false);
        setSelId(null);
        setMoveOn(false);
        setPaletteOpen(false);
        setRoomStyleOpen(false);
      }
      saveCacheNow(snap());
      schedulePush();
    },
    [snap, schedulePush],
  );

  const toggleNight = useCallback(() => {
    // 手动切换 → 脱离真实时间自动模式
    setNightAuto(false);
    setNight((n) => !n);
    saveSoon();
  }, [saveSoon]);

  /** 昼夜跟随真实时间（19:00~6:00 算夜晚，每 30s 校对） */
  const enableAutoNight = useCallback(() => {
    setNightAuto(true);
    saveSoon();
    toast('昼夜已跟随真实时间～');
  }, [saveSoon, toast]);

  useEffect(() => {
    if (!nightAuto) return;
    const compute = () => {
      const h = new Date().getHours();
      return h >= 19 || h < 6;
    };
    setNight(compute());
    const t = setInterval(() => setNight(compute()), 30000);
    return () => clearInterval(t);
  }, [nightAuto]);

  // 模式切换时收起右上角 ⋮ 菜单 / 宠物面板
  useEffect(() => {
    setMoreOpen(false);
    setPetPanel(false);
    setPetRenaming(false);
  }, [mode]);

  // 离开生活模式（进装修/商店全屏遮挡等）时收起乐器弹奏界面
  useEffect(() => {
    if (mode !== 'live' && instRef.current) {
      instRef.current = null;
      setInst(null);
    }
  }, [mode]);

  // E3 音效开关初始化：读 localStorage（缺省开）
  useEffect(() => {
    setSfxOn(sfx.isEnabled());
  }, []);

  // E3 脚步声：生活模式小人走动时每 380ms 一步（状态走 ref 读，interval 不重挂）
  useEffect(() => {
    const t = setInterval(() => {
      if (meRT.current.moving === true && modeRef.current === 'live' && sfxOnRef.current) sfx.step();
    }, 380);
    return () => clearInterval(t);
  }, []);

  // ---------------- 渲染 ----------------
  const selItem = selId && !selId.startsWith('win-') && !selId.startsWith('door-') ? items.find((f) => f.id === selId) : null;
  const selEntry = selItem ? CATALOG[selItem.kind] : null;
  const isWallSel = !!selId && (selId.startsWith('win-') || selId.startsWith('door-'));
  const selWallName = selId?.startsWith('win-')
    ? '窗户'
    : DOORS.find((d) => selId === `door-${d.id}`)?.name ?? '';
  /** 调色盘当前值（门窗选中时对应全局门窗色） */
  const paletteVal = selId?.startsWith('win-') ? winCol : selId?.startsWith('door-') ? doorCol : selItem?.col;

  // 操作按钮通用样式 toolBtn —— 已下沉到 ./lib/home-core.tsx

  /** 电视开着（生活模式随时换台，看电视不再锁人） */
  const tvOn = items.some((f) => f.kind === 'tv' && f.st?.on);
  // v8.3 成长系统：等级 + 升级进度（面板徽章 / 把戏按钮解锁门控）
  const petLv = petLevelOf(pet);
  const petGap = petLevelGap(pet);
  // v9 当前选中宠物的等级/进度（面板与把戏门控跟它走）
  const actLv = petLevelOf(activePetObj);
  const actGap = petLevelGap(activePetObj);
  /** E7 点亮的灯具数（传给场景侧做环境光加成，灯越多屋里越暖） */
  const litLampCount = useMemo(
    () => items.reduce((n, f) => n + (CATALOG[f.kind]?.light && f.st?.on ? 1 : 0), 0),
    [items],
  );
  // 底部按钮堆叠位置：与动作栏/端杯按钮错开（v7.0 底部互动条常驻 → 各条整体上移 76px）
  const cupBarCls = charAction ? 'bottom-[330px]' : 'bottom-[272px]';

  // —— v6.8 进屋过场：白光过渡（遮住 Canvas 首帧 → 与场景内推镜同步淡出） ——
  const [whiteOn, setWhiteOn] = useState(true);
  const [whiteGone, setWhiteGone] = useState(false);
  useEffect(() => {
    const t1 = setTimeout(() => setWhiteOn(false), 450);
    const t2 = setTimeout(() => setWhiteGone(true), 2200);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);
  const tvBarCls = charAction
    ? carryCup
      ? 'bottom-[388px]'
      : 'bottom-[330px]'
    : carryCup
      ? 'bottom-[330px]'
      : 'bottom-[272px]';

  return (
    <div ref={rootRef} className="absolute inset-0 select-none overflow-hidden bg-[#efece4]">
      {/* 照片选择（相框用；隐藏） */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onPickPhoto}
      />

      {/* 3D 场景 */}
      <HomeScene
        items={items}
        mode={mode}
        night={night}
        selId={selId}
        moveOn={moveOn}
        meRT={meRT.current}
        taRT={taRT.current}
        joyRef={joyRef}
        zoomCmd={zoomCmd}
        moveCmd={moveCmd}
        onNudge={nudgeSel}
        fp={fp}
        fpRef={fpRef}
        poseRef={poseRef}
        actRef={actRef}
        carryRef={carryRef}
        instRef={instRef}
        onFaucetTap={onFaucetTap}
        wear={wear}
        wear2={wear2}
        activeAct={charAction}
        mealTableId={mealTableId}
        floorTex={floorTex}
        wallTex={wallTex}
        win={win}
        winExist={winExist}
        onToggleWin={toggleWin}
        winPos={winPos}
        doorPos={doorPos}
        floorCol={floorCol}
        wallCol={wallCol}
        doorCol={doorCol}
        winCol={winCol}
        floorColBed={floorColBed}
        wallColBed={wallColBed}
        floorColK={floorColK}
        wallColK={wallColK}
        floorColB={floorColB}
        wallColB={wallColB}
        floorColBal={floorColBal}
        wallColBal={wallColBal}
        ceilCol={ceilCol}
        ceilColBed={ceilColBed}
        ceilColK={ceilColK}
        ceilColB={ceilColB}
        doorOpen={doorOpen}
        kitchenDoorOpen={kitchenDoorOpen}
        bathDoorOpen={bathDoorOpen}
        balconyDoorOpen={balconyDoorOpen}
        onToggleDoor={toggleDoor}
        onToggleKitchenDoor={toggleKitchenDoor}
        onToggleBathDoor={toggleBathDoor}
        onToggleBalconyDoor={toggleBalconyDoor}
        studyDoorOpen={studyDoorOpen}
        gardenGateOpen={gardenGateOpen}
        onToggleStudyDoor={toggleStudyDoor}
        onToggleGardenGateDoor={toggleGardenGateDoor}
        musicPlaying={musicPlaying}
        weatherFx={weatherFx}
        litLamps={litLampCount}
        petCmdRef={petCmdRef}
        petCarryCmdRef={petCarryCmdRef}
        onPetTap={onPetTap}
        onPetEvent={onPetEvent}
        petState={pet}
        onFloorTap={onFloorTap}
        onFurnTap={onFurnTap}
        companionCmdRef={companionCmdRef}
        onCompanionEvent={onCompanionEvent}
        onPartnerTap={openPartnerMenu}
        onPartnerLongPress={openPartnerRing}
        petGrowLv={actLv}
        bubbleRef={bubbleRef}
        partnerPlayingId={partnerPlaying}
        petCoat={activePetObj.coat}
        petWear={activePetObj.wear}
        pets2={pets2}
        petBallCmdRef={petBallCmdRef}
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
        onDragSelect={onDragSelect}
        onWallTap={onWallTap}
      />

      {/* ===== v9 领养弹窗（小狗 / 小兔子；可以领养无数只，领完弹窗不关接着挑）—— 已抽到 panels/AdoptDialog.tsx ===== */}
      <AdoptDialog
        open={adoptOpen}
        pets2={pets2}
        onClose={() => setAdoptOpen(false)}
        onPickExisting={(i) => {
          setActivePet(`p2:${i}`);
          activePetRef.current = `p2:${i}`;
          setAdoptOpen(false);
          setPetPanel(true);
          sfx.tap();
        }}
        onAdopt={adoptPet2}
      />

      {/* ===== v8.0 陪伴角色选择（进入小屋弹联系人列表；⋮ 菜单「换个TA」再弹）—— 已抽到 panels/CompanionPicker.tsx ===== */}
      <CompanionPicker open={pickerOpen} contacts={contacts} companion={companion} onChoose={chooseCompanion} onClose={() => setPickerOpen(false)} />

      {/* ===== v8.0 聊天附照（识图）隐藏文件选择 ===== */}
      <input ref={chatPhotoInputRef} type="file" accept="image/*" className="hidden" onChange={onChatPhoto} />

      {/* Toast（含拍照模式 —— 拍照时 HUD 隐藏，toast 仍需可见） */}
      <div className="pointer-events-none absolute left-1/2 top-24 z-40 flex -translate-x-1/2 flex-col items-center gap-1.5">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: -8, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.95 }}
              className="rounded-full bg-[#3a3a3e]/85 px-3.5 py-1.5 text-[12px] text-white shadow-lg backdrop-blur-sm"
            >
              {t.msg}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* ===== HUD ===== */}
      {!photoMode && (
      <div className="pointer-events-none absolute inset-0 flex flex-col justify-between">
        {/* ⋮ 菜单打开时的空白关闭层（点菜单以外任意处收起） */}
        {moreOpen && (
          <div className="pointer-events-auto absolute inset-0 z-10" onClick={() => setMoreOpen(false)} aria-hidden="true" />
        )}

        {/* v9 信息图标（💬）移到右下角：点击弹出/收起下方聊天输入框（对话进头顶气泡 + TTS） */}
        {mode === 'live' && companion && !pickerOpen && (
          <button
            onClick={() => {
              setChatOpen((v) => !v);
              if (chatOpen && micOn) toggleMic();
            }}
            aria-label="和TA聊天"
            aria-expanded={chatOpen}
            title="和TA聊天"
            className={`pointer-events-auto absolute bottom-[74px] right-4 z-30 flex h-12 w-12 items-center justify-center rounded-full shadow-lg backdrop-blur transition active:scale-95 ${
              chatOpen ? 'bg-[#3a3a3e]/85 text-white' : 'bg-white/80 text-[#5a5a5e]'
            }`}
          >
            <MessageCircle className="h-5 w-5" />
            {chatOpen && (
              <span aria-hidden="true" className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-[#e46a6a] text-[9px] font-bold text-white ring-2 ring-white/80">
                <X className="h-2.5 w-2.5" />
              </span>
            )}
          </button>
        )}

        {/* ===== 宠物状态面板（v7.0：右上角头像唤出 · 毛玻璃胶囊风）—— 已抽到 panels/StatusPanels.tsx ===== */}
        <PetPanel
          mode={mode}
          open={petPanel}
          activePetName={activePetName}
          activePetIdx={activePetIdx}
          activePetObj={activePetObj}
          actLv={actLv}
          actGap={actGap}
          carrying={carrying}
          petCare={petCare}
          renaming={petRenaming}
          nameDraft={petNameDraft}
          onNameDraft={setPetNameDraft}
          onCommitName={commitPetName}
          onCancelRename={() => setPetRenaming(false)}
          onClose={() => setPetPanel(false)}
          onDressUp={() => {
            setWardrobeChar('pet');
            setWardrobeOpen(true);
            setPetPanel(false);
            sfx.tap();
          }}
          onStartRename={() => {
            setPetNameDraft(activePetObj.name ?? activePetName);
            setPetRenaming(true);
          }}
          onOpenAdopt={() => setAdoptOpen(true)}
          onOpenDiary={() => {
            setPetDiaryOpen(true);
            sfx.tap();
          }}
          onCare={startPetCare}
        />

        {/* ===== v10.3 TA 的心面板（顶栏爱心按钮唤出 · 毛玻璃胶囊风 · 与宠物面板同槽互斥）—— 已抽到 panels/StatusPanels.tsx ===== */}
        <HeartPanel
          mode={mode}
          open={heartOpen}
          mind={mindRef.current}
          onClose={() => setHeartOpen(false)}
          onOpenDiary={() => {
            setHeartOpen(false);
            setTaDiaryOpen(true);
            sfx.tap();
          }}
        />

        {/* ===== v11 I2 我们的里程碑面板（⋮ 菜单唤出 · 毛玻璃胶囊风 · 与心面板同款）—— 已抽到 panels/StatusPanels.tsx ===== */}
        <StatsPanel mode={mode} open={statsOpen} stats={statsSnap} onClose={() => setStatsOpen(false)} />

        {/* ===== 宠物互动竖条（v7.1：点宠物才出现 · 点别处消失 · 右侧竖排 · 白玻璃圆钮无彩色底）—— 已抽到 panels/PetActionBar.tsx ===== */}
        <PetActionBar mode={mode} wardrobeOpen={wardrobeOpen} open={petBarOpen} activePetName={activePetName} actLv={actLv} carrying={carrying} petCare={petCare} onCare={startPetCare} />

        {/* 顶栏 —— 已抽到 panels/TopBar.tsx */}
        <TopBar
          mode={mode}
          night={night}
          nightAuto={nightAuto}
          sfxOn={sfxOn}
          voiceOn={voiceOn}
          ambientOn={ambientOn}
          fp={fp}
          moreOpen={moreOpen}
          heartOpen={heartOpen}
          petPanel={petPanel}
          companion={companion}
          activePetName={activePetName}
          activePetIdx={activePetIdx}
          activePetObj={activePetObj}
          petsCount={pets2.length}
          onClose={close}
          onPhotoMode={() => setPhotoMode(true)}
          onSwitchMode={() => switchMode(mode === 'live' ? 'edit' : 'live')}
          onToggleHeart={() => {
            setHeartOpen((o) => !o);
            setPetPanel(false);
            setMoreOpen(false);
            sfx.tap();
          }}
          onRotatePet={() => {
            // v9 依次轮换：cat → p2:0 → p2:1 → … → cat（多只宠物循环切换）
            const total = pets2.length;
            const cur = activePetRef.current;
            if (total === 0) {
              setActivePet('cat');
              activePetRef.current = 'cat';
            } else if (cur === 'cat') {
              setActivePet('p2:0');
              activePetRef.current = 'p2:0';
            } else {
              const i = Number(cur.slice(3)) || 0;
              const next = i + 1 >= total ? 'cat' : `p2:${i + 1}`;
              setActivePet(next);
              activePetRef.current = next;
            }
            setPetPanel(true);
            setHeartOpen(false); // v10.3 与心面板互斥，不叠影
            setPetBarOpen(false); // 面板与互动竖条互斥，不叠影
            sfx.tap();
          }}
          onToggleMore={() => {
            setMoreOpen((o) => !o);
            setHeartOpen(false);
          }}
          onToggleNight={() => {
            toggleNight();
            setMoreOpen(false);
          }}
          onEnableAutoNight={() => {
            enableAutoNight();
            setMoreOpen(false);
          }}
          onToggleSfx={() => {
            toggleSfx();
            setMoreOpen(false);
          }}
          onToggleFp={() => {
            toggleFp();
            setMoreOpen(false);
          }}
          onToggleVoice={() => {
            toggleVoice();
            setMoreOpen(false);
          }}
          onToggleAmbient={() => {
            toggleAmbient();
            setMoreOpen(false);
          }}
          onOpenTaDiary={() => {
            setTaDiaryOpen(true);
            setMoreOpen(false);
            sfx.tap();
          }}
          onOpenStats={() => {
            setStatsSnap(companion ? { ...(statsRef.current ?? loadCabinStats(companion.id)) } : null);
            setStatsOpen(true);
            setMoreOpen(false);
            sfx.tap();
          }}
          onOpenHeart={() => {
            setHeartOpen(true);
            setMoreOpen(false);
            sfx.tap();
          }}
          onOpenPicker={openPicker}
        />

        {/* 家具互动按钮（生活模式）：坐下/睡觉/泡澡 → 站起来/起床/出来；衣柜弹窗打开时隐藏避免压住抽屉 —— 已抽到 panels/QuickBars.tsx */}
        <FurnActionBar
          mode={mode}
          charAction={charAction}
          wardrobeOpen={wardrobeOpen}
          instOpen={!!inst}
          onPrimary={() => {
            if (charAction && !charAction.active) {
              const it = itemsRef.current.find((f) => f.id === charAction.itemId);
              if (it) beginAction(charAction.type, it);
            } else {
              endAction();
            }
          }}
          onToggleWater={toggleBathWater}
        />

        {/* 电视开着：随时换台（看电视不再是动作，小人自由走动） —— 已抽到 panels/QuickBars.tsx */}
        <TvBar mode={mode} tvOn={tvOn} instOpen={!!inst} tvBarCls={tvBarCls} onCycle={cycleChannel} />

        {/* 端着饮料：随时放下（拿饮料不再锁人，杯子握在手里到处逛） —— 已抽到 panels/QuickBars.tsx */}
        <CupBar mode={mode} carryCup={carryCup} cupBarCls={cupBarCls} onDrop={dropCup} />

        {/* ===== v10.3 聊天输入条（文字胶囊 + 独立功能按钮排；消息进头顶气泡）—— 已抽到 panels/ChatBar.tsx ===== */}
        <ChatBar
          mode={mode}
          open={chatOpen}
          companion={companion}
          pickerOpen={pickerOpen}
          photoChip={photoChip}
          chatText={chatText}
          chatBusy={chatBusy}
          micOn={micOn}
          intercomOn={intercomOn}
          onChatText={setChatText}
          onSend={sendChat}
          onMic={toggleMic}
          onIntercom={toggleIntercom}
          onOpenHistory={() => {
            setChatHistOpen(true);
            sfx.tap();
          }}
          onPickPhoto={() => chatPhotoInputRef.current?.click()}
        />

        {/* ===== v8.0 陪伴小人环形菜单（点小人弹出：拥抱 / 牵手（牵手中=松开））—— 已抽到 panels/PartnerOverlays.tsx ===== */}
        <PartnerMenu
          mode={mode}
          open={partnerMenuOpen}
          companion={companion}
          holdingUI={holdingUI}
          onHug={startHug}
          onHold={startHoldHand}
          onRelease={releaseHold}
          onClose={() => setPartnerMenuOpen(false)}
        />

        {/* ===== v11 I1 长按 TA 的互动轮盘（屏幕中下方半圆弧 · 白玻璃圆钮 · spring 弹入；点其他区域关闭）—— 已抽到 panels/PartnerOverlays.tsx ===== */}
        <PartnerRing
          mode={mode}
          open={ringOpen}
          companion={companion}
          onPat={ringPat}
          onFeed={ringFeed}
          onTickle={ringTickle}
          onClose={() => setRingOpen(false)}
        />

        {/* ===== v8.0 AI 主动请求弹窗（「××想要拥抱你」：同意 / 拒绝）—— 已抽到 panels/PartnerOverlays.tsx ===== */}
        <RequestDialog request={request} companion={companion} onAccept={acceptRequest} onReject={rejectRequest} />

        {/* 乐器弹奏覆盖层（吉他弦/钢琴键，点按真实发声） */}
        {inst && <InstrumentOverlay kind={inst.kind} onClose={closeInst} />}

        {/* v10 E1 聊天记录回看面板 */}
        <CabinHistorySheet open={chatHistOpen} onClose={() => setChatHistOpen(false)} charId={companion?.id ?? 'x'} charName={companion?.name ?? 'TA'} />

        {/* v11 F2 TA 的日记面板（毛玻璃抽屉，读 cabin-ta-diary-<charId>） */}
        <TaDiarySheet open={taDiaryOpen} onClose={() => setTaDiaryOpen(false)} charId={companion?.id ?? 'x'} charName={companion?.name ?? 'TA'} />

        {/* v10 C4 宠物日记面板（毛玻璃抽屉，读 cabin-pet-diary）—— 已抽到 panels/PetDiarySheet.tsx */}
        <PetDiarySheet open={petDiaryOpen} activePetName={activePetName} onClose={() => setPetDiaryOpen(false)} />

        {/* 编辑模式：缩放按钮（右缘中部）—— 已抽到 panels/EditBars.tsx */}
        <EditZoomButtons mode={mode} onZoom={zoom} />

        {/* 底部区 */}
        <div className="p-4 pb-6">
          {/* 选中操作条（编辑模式·门窗：毛玻璃胶囊 · 移动/换色/收起窗户，门不可收起）—— 已抽到 panels/EditBars.tsx */}
          <WallSelBar
            mode={mode}
            isWallSel={isWallSel}
            shopOpen={shopOpen}
            paletteOpen={paletteOpen}
            selId={selId}
            selWallName={selWallName}
            onMove={issueMoveCmd}
            onOpenPalette={() => setPaletteOpen(true)}
            onRemoveWin={removeWinSel}
            onCancel={() => setSelId(null)}
          />

          {/* v11 H3 猫窝换色小色板（12 精选色横排 · 选中猫窝时弹出）—— 已抽到 panels/EditBars.tsx */}
          <BedColorPop
            mode={mode}
            open={bedColorOpen}
            isBed={selItem?.kind === 'petBed'}
            shopOpen={shopOpen}
            paletteOpen={paletteOpen}
            currentColor={selItem?.st?.bedColor}
            onPick={applyBedColor}
          />
          {/* 选中操作条（编辑模式·家具：毛玻璃胶囊 · 移动/升降/旋转/调色/收起；猫窝额外有「换窝色」小色板）—— 已抽到 panels/EditBars.tsx */}
          <FurnSelBar
            mode={mode}
            selItem={selItem ?? null}
            selName={selEntry ? selEntry.name : ''}
            shopOpen={shopOpen}
            paletteOpen={paletteOpen}
            moveOn={moveOn}
            onMove={issueMoveCmd}
            onToggleMove={toggleMove}
            onLift={liftSel}
            onRotate={rotateY}
            onTilt={tilt}
            onOpenPalette={() => setPaletteOpen(true)}
            onToggleBedColor={() => setBedColorOpen((o) => !o)}
            onRemove={removeSel}
            onCancel={() => setSelId(null)}
          />

          <div className="flex items-end justify-between">
            {/* 摇杆（生活模式） */}
            <div className={mode === 'live' ? 'pointer-events-auto' : 'hidden'}>
              <Joystick onVec={(dx, dy) => (joyRef.current = { dx, dy })} size={124} />
            </div>
            <div className={mode === 'live' ? 'hidden' : 'flex-1'} />

            {/* 编辑工具（装修模式）：撤销 / 重做 / 地板墙色 / 商店 —— 已抽到 panels/EditBars.tsx */}
            <EditToolDock
              mode={mode}
              histLen={histLen}
              roomStyleOpen={roomStyleOpen}
              shopOpen={shopOpen}
              onUndo={undo}
              onRedo={redo}
              onToggleRoomStyle={() => setRoomStyleOpen((o) => !o)}
              onToggleShop={() => setShopOpen((o) => !o)}
            />
          </div>
        </div>
      </div>
      )}

      {/* ===== 拍照模式（F6）：隐藏全部 UI，快门存情侣相册 ===== */}
      <AnimatePresence>
        {photoMode && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pointer-events-none absolute inset-0 z-30">
            <button
              onClick={() => setPhotoMode(false)}
              aria-label="退出拍照模式"
              className="pointer-events-auto absolute left-3 top-11 flex h-10 w-10 items-center justify-center rounded-full bg-black/35 text-white shadow backdrop-blur transition active:scale-95"
            >
              <X className="h-5 w-5" />
            </button>
            <span className="absolute left-1/2 top-12 -translate-x-1/2 rounded-full bg-black/30 px-3 py-1 text-[11px] text-white/90 backdrop-blur">
              拍照模式 · 画面随你摆
            </span>
            <button
              onClick={takePhoto}
              aria-label="拍照"
              className="pointer-events-auto absolute bottom-8 left-1/2 flex h-16 w-16 -translate-x-1/2 items-center justify-center rounded-full border-4 border-white/90 bg-white/25 shadow-xl backdrop-blur transition active:scale-90"
            >
              <Camera className="h-7 w-7 text-white" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ===== 我的衣柜（走到衣柜前弹出；上半屏透出小人实时试穿；女生/男生都可换装） ===== */}
      <Wardrobe
        open={wardrobeOpen}
        wear={wear}
        wear2={wear2}
        initialChar={wardrobeChar}
        petKind={activePetIdx < 0 ? 'cat' : activePetObj.kind}
        petCoat={activePetObj.coat}
        petWear={activePetObj.wear}
        onPetChange={changePetLook}
        onChange={(w) => {
          setWear(w);
          saveSoon();
        }}
        onChange2={(w) => {
          setWear2(w);
          saveSoon();
        }}
        onClose={() => {
          setWardrobeOpen(false);
          sfx.tap();
          if (actRef.current?.type === 'dress') endAction();
        }}
      />

      {/* ===== 五子棋对弈（棋盘桌 J7） ===== */}
      <AnimatePresence>
        {chess && <ChessOverlay onClose={() => setChess(null)} />}
      </AnimatePresence>

      {/* ===== 做饭小游戏（灶台 F5） ===== */}
      <AnimatePresence>
        {cookingGame && <CookingGame onComplete={onCookingDone} onClose={() => setCookingGame(false)} />}
      </AnimatePresence>

      {/* ===== G10 相框菜单：换照片 / 拼一拼 ===== */}
      <AnimatePresence>
        {photoMenuFor && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-30 flex items-end justify-center bg-black/25 p-6 pb-10"
            onClick={() => setPhotoMenuFor(null)}
          >
            <motion.div
              initial={{ y: 60, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 40, opacity: 0 }}
              transition={{ type: 'spring', damping: 28, stiffness: 340 }}
              className="pointer-events-auto w-full max-w-[260px] overflow-hidden rounded-3xl bg-white/95 shadow-2xl backdrop-blur-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <p className="pt-3.5 text-center text-[12px] text-[#9a9a96]">立式相框</p>
              <button
                onClick={() => {
                  photoTargetRef.current = photoMenuFor;
                  fileInputRef.current?.click();
                  setPhotoMenuFor(null);
                }}
                className="flex w-full items-center justify-center gap-1.5 px-5 py-3 text-[13.5px] font-medium text-[#4a4a4e] transition active:bg-black/5"
              >
                <ImagePlus className="h-4 w-4 text-[#e8a3b3]" /> 换一张照片
              </button>
              <div className="mx-5 h-px bg-[#f0eeea]" />
              <button
                onClick={() => {
                  const it = itemsRef.current.find((f) => f.id === photoMenuFor);
                  setPuzzleFor({ photo: it?.st?.photo });
                  setPhotoMenuFor(null);
                }}
                className="flex w-full items-center justify-center gap-1.5 px-5 py-3 text-[13.5px] font-medium text-[#4a4a4e] transition active:bg-black/5"
              >
                <Puzzle className="h-4 w-4 text-[#e8a3b3]" /> 用照片拼一拼
              </button>
              <div className="mx-5 h-px bg-[#f0eeea]" />
              <button
                onClick={() => setPhotoMenuFor(null)}
                className="w-full px-5 py-3 text-[13.5px] font-medium text-[#b8b4ae] transition active:bg-black/5"
              >
                取消
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ===== G8 软木留言板面板 ===== */}
      <AnimatePresence>
        {noteOpen && (
          <NotesOverlay
            notes={notes}
            onClose={() => setNoteOpen(false)}
            onPost={(text) => {
              setNotes((prev) => [
                ...prev.slice(-49),
                {
                  id: `note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
                  text,
                  ts: Date.now(),
                  by: 'me',
                },
              ]);
              sfx.tap();
              saveSoon();
            }}
            onDelete={(id) => {
              setNotes((prev) => prev.filter((n) => n.id !== id));
              saveSoon();
            }}
          />
        )}
      </AnimatePresence>

      {/* ===== G10 抓娃娃 / 咖啡拉花 / 照片拼图 ===== */}
      <ClawMachineGame open={!!clawFor} onClose={() => setClawFor(null)} onWin={onClawWin} />
      <LatteArtGame open={latteOpen} onClose={() => setLatteOpen(false)} onResult={onLatteResult} />
      <PuzzleGame open={!!puzzleFor} onClose={() => setPuzzleFor(null)} photo={puzzleFor?.photo} />

      {/* ===== 小屋点歌（F3：音箱/黑胶/八音盒共用；搜歌 · 我的歌单 · 队列 —— v6.0 重构） ===== */}
      <SongSheet open={musicSheet} onClose={() => setMusicSheet(false)} onToast={toast} />

      {/* ===== 调色盘面板（编辑模式：家具 / 门窗）—— 已抽到 panels/StylePanels.tsx ===== */}
      <PalettePanel
        mode={mode}
        open={paletteOpen}
        isWallSel={isWallSel}
        selWallName={selWallName}
        selName={selEntry ? selEntry.name : ''}
        paletteVal={paletteVal}
        selLc={selItem?.st?.lc}
        selIsLight={!!selEntry?.light}
        onClose={() => setPaletteOpen(false)}
        onPick={applyColor}
        onPickLight={applyLightColor}
      />

      {/* ===== 装修面板：地板 / 墙壁 / 门 / 窗 自定义颜色 —— 已抽到 panels/StylePanels.tsx ===== */}
      <RoomStylePanel
        mode={mode}
        open={roomStyleOpen}
        floorCol={floorCol}
        wallCol={wallCol}
        ceilCol={ceilCol}
        floorColBed={floorColBed}
        wallColBed={wallColBed}
        ceilColBed={ceilColBed}
        floorColK={floorColK}
        wallColK={wallColK}
        ceilColK={ceilColK}
        floorColB={floorColB}
        wallColB={wallColB}
        ceilColB={ceilColB}
        floorColBal={floorColBal}
        wallColBal={wallColBal}
        doorCol={doorCol}
        winCol={winCol}
        floorTex={floorTex}
        wallTex={wallTex}
        layouts={layouts}
        onClose={() => setRoomStyleOpen(false)}
        applyFloorCol={applyFloorCol}
        applyWallCol={applyWallCol}
        applyCeilCol={applyCeilCol}
        applyFloorColBed={applyFloorColBed}
        applyWallColBed={applyWallColBed}
        applyCeilColBed={applyCeilColBed}
        applyFloorColK={applyFloorColK}
        applyWallColK={applyWallColK}
        applyCeilColK={applyCeilColK}
        applyFloorColB={applyFloorColB}
        applyWallColB={applyWallColB}
        applyCeilColB={applyCeilColB}
        applyFloorColBal={applyFloorColBal}
        applyWallColBal={applyWallColBal}
        applyDoorCol={applyDoorCol}
        applyWinCol={applyWinCol}
        onFloorTex={(v) => {
          pushHistory();
          setFloorTex(v);
          saveSoon();
        }}
        onWallTex={(v) => {
          pushHistory();
          setWallTex(v);
          saveSoon();
        }}
        onApplyLayout={applyLayout}
        onSaveLayout={saveLayout}
      />

      {/* ===== 商店抽屉（编辑模式） ===== */}
      <AnimatePresence>
        {mode === 'edit' && shopOpen && (
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="absolute inset-x-0 bottom-0 z-10 flex max-h-[52%] flex-col rounded-t-3xl bg-white/95 shadow-[0_-8px_30px_rgba(0,0,0,0.12)] backdrop-blur-xl"
          >
            <div className="flex items-center justify-between px-4 pb-1 pt-3">
              <span className="text-[15px] font-semibold text-[#3a3a3e]">家具商店</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={resetHome}
                  className="rounded-full bg-[#f6eded] px-3 py-1 text-[11px] font-medium text-[#c26a6a] transition active:scale-95"
                >
                  重置
                </button>
                <button
                  onClick={() => setShopOpen(false)}
                  aria-label="关闭商店"
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f0eff1] text-[#8a8a90] transition active:scale-95"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* 分类 tab（纯文字；首个 = 窗户专项 tab，收起的窗在这里装回） */}
            <div className="scrollbar-none flex gap-2 overflow-x-auto px-4 pb-2 pt-1">
              <button
                onClick={() => setShopTab('win')}
                className={
                  shopTab === 'win'
                    ? 'shrink-0 rounded-full bg-[#8fbfa8] px-3 py-1 text-[12px] font-medium text-white'
                    : 'shrink-0 rounded-full bg-[#f1efe9] px-3 py-1 text-[12px] text-[#8a8a86] transition active:scale-95'
                }
              >
                窗户
              </button>
              {SHOP_TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setShopTab(t.key)}
                  className={
                    shopTab === t.key
                      ? 'shrink-0 rounded-full bg-[#f4b3c2] px-3 py-1 text-[12px] font-medium text-white'
                      : 'shrink-0 rounded-full bg-[#f1efe9] px-3 py-1 text-[12px] text-[#8a8a86] transition active:scale-95'
                  }
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* 窗户 tab：九扇窗安装位（收起的窗可装回；编辑模式点窗也能收起） */}
            {shopTab === 'win' && (
              <div className="grid max-h-72 grid-cols-3 gap-2 overflow-y-auto px-4 pb-5 pt-1">
                {WINS.map((w, i) => {
                  const here = winExist[i] !== false;
                  return (
                    <div
                      key={i}
                      className="relative flex flex-col items-start gap-1 rounded-2xl bg-[#faf8f3] p-2 text-left shadow-sm ring-1 ring-[#efece2]"
                    >
                      {here && (
                        <span className="absolute right-1.5 top-1.5 flex items-center gap-0.5 rounded-full bg-[#dff0e2] px-1.5 py-0.5 text-[9px] font-semibold leading-none text-[#3f9a58]">
                          <Check className="h-2.5 w-2.5" strokeWidth={3} />
                          已装
                        </span>
                      )}
                      {/* 窗户示意图标 */}
                      <div
                        className="flex h-16 w-full items-center justify-center rounded-xl"
                        style={{ background: 'linear-gradient(180deg,#dff0f4 0%,#f2f7f4 100%)' }}
                      >
                        <svg viewBox="0 0 48 40" className="h-12 w-12" aria-hidden>
                          <rect x="4" y="4" width="40" height="32" rx="2.5" fill="none" stroke={winCol ?? '#f0e7d4'} strokeWidth="4" />
                          <rect x="8" y="8" width="32" height="24" rx="1.5" fill="#cde8f0" opacity={here ? 0.9 : 0.35} />
                          <line x1="24" y1="8" x2="24" y2="32" stroke={winCol ?? '#f0e7d4'} strokeWidth="2.5" />
                          <line x1="8" y1="20" x2="40" y2="20" stroke={winCol ?? '#f0e7d4'} strokeWidth="2.5" />
                        </svg>
                      </div>
                      <span className="w-full truncate text-[11.5px] font-medium leading-tight text-[#4a4a4e]">
                        {WIN_NAMES[i] ?? `窗户 ${i + 1}`}
                      </span>
                      {here ? (
                        <span className="w-full rounded-full bg-[#f1efe9] py-1 text-center text-[11px] text-[#a8a8a4]">
                          安装中
                        </span>
                      ) : (
                        <button
                          onClick={() => installWin(i)}
                          className="w-full rounded-full bg-[#8fbfa8] py-1 text-[12px] font-semibold text-white shadow-sm transition active:scale-95"
                        >
                          + 安装
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* 套装 tab（F3 成套举放） / 商品网格（1:1 实物缩略图 + 已有数量角标；无限购买） */}
            {shopTab === 'set' ? (
              <div className="grid max-h-72 grid-cols-2 gap-2 overflow-y-auto px-4 pb-5 pt-1">
                {FURN_SETS.map((s) => {
                  const setThumb = thumbMap[`set:${s.id}`] ?? getCachedThumb(`set:${s.id}`);
                  const Fallback = SET_FALLBACK[s.id] ?? Armchair;
                  return (
                    <div
                      key={s.id}
                      className="flex flex-col rounded-2xl bg-[#faf8f3] p-2.5 text-left shadow-sm ring-1 ring-[#efece2]"
                    >
                      {setThumb ? (
                        <img
                          src={setThumb}
                          alt={s.name}
                          draggable={false}
                          className="h-20 w-full rounded-xl object-contain"
                        />
                      ) : (
                        <span className="flex h-20 w-full animate-pulse items-center justify-center rounded-xl bg-gradient-to-br from-[#f6cdd6] to-[#dcd2ec]">
                          <Fallback className="h-7 w-7 text-white/90" strokeWidth={1.75} aria-hidden />
                        </span>
                      )}
                      <div className="mt-1.5 flex items-center justify-between gap-1.5">
                        <span className="min-w-0 truncate text-[12.5px] font-semibold text-[#3a3a3e]">
                          {s.name}
                        </span>
                        <span className="shrink-0 rounded-full bg-[#f1efe9] px-1.5 py-0.5 text-[9.5px] leading-none text-[#8a8a86]">
                          {s.items.length} 件
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] leading-snug text-[#8a8a86]">{s.desc}</p>
                      <p className="mt-0.5 text-[10px] text-[#a8a8a4]">整组一步撤销</p>
                      <button
                        onClick={() => placeSet(s.id)}
                        className="mt-2 rounded-full bg-[#f4b3c2] py-1.5 text-[12px] font-semibold text-white shadow-sm transition active:scale-95"
                      >
                        一键举放
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="grid max-h-72 grid-cols-3 gap-2 overflow-y-auto px-4 pb-5 pt-1">
                {shopItems.map((e) => {
                  const owned = items.filter((it) => it.kind === e.kind).length;
                  const thumb = thumbMap[e.kind] || getCachedThumb(e.kind);
                  return (
                    <button
                      key={e.kind}
                      onClick={() => buy(e.kind)}
                      className="relative flex flex-col items-start gap-1 rounded-2xl bg-[#faf8f3] p-2 text-left shadow-sm ring-1 ring-[#efece2] transition active:scale-95"
                    >
                      {owned > 0 && (
                        <span className="absolute right-1.5 top-1.5 rounded-full bg-[#f4b3c2] px-1.5 py-0.5 text-[9px] font-semibold leading-none text-white shadow-sm">
                          ×{owned}
                        </span>
                      )}
                      {thumb ? (
                        <img
                          src={thumb}
                          alt={e.name}
                          draggable={false}
                          className="h-16 w-full rounded-xl object-contain"
                        />
                      ) : (
                        <span
                          className="h-16 w-full animate-pulse rounded-xl shadow-inner"
                          style={{ background: `linear-gradient(135deg, ${catColor(e.cat)}, ${shade(e.cat)})` }}
                        />
                      )}
                      <span className="w-full truncate text-[11.5px] font-medium leading-tight text-[#4a4a4e]">
                        {e.name}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* 商城 1:1 缩略图工作室（隐藏离屏画布，逐件快照） */}
      {shopOpen && thumbQueue[0] && (
        <ShopThumbStudio
          kind={thumbQueue[0]}
          onThumb={(kind, url) => {
            // 失败（空串）也标记，避免死循环重试
            setThumbMap((m) => (m[kind] === url ? m : { ...m, [kind]: url }));
          }}
        />
      )}

      {/* 进屋白光过渡（v6.8）：白屏遮首帧 → 淡出与开门推镜同步，纯视觉不拦截点击 */}
      {!whiteGone && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-[90] bg-white transition-opacity duration-[1600ms] ease-out"
          style={{ opacity: whiteOn ? 1 : 0 }}
        />
      )}
    </div>
  );
}

// ---------------- 商店色卡 ----------------

const CAT_COLORS: Record<string, [string, string]> = {
  sofa: ['#f6cdd6', '#f0b3c2'],
  table: ['#efdbb2', '#e5c894'],
  bed: ['#f9e4ea', '#f2ccd8'],
  lamp: ['#ffefc0', '#ffe49a'],
  plant: ['#c3e5cf', '#a8d8bb'],
  appliance: ['#e8e9e6', '#dcdcd8'],
  bathroom: ['#e3e9e6', '#d5e0da'],
  kitchen: ['#fdeccd', '#f8dfae'],
  decor: ['#e6cfae', '#dbaf87'],
};

function catColor(cat: string): string {
  return (CAT_COLORS[cat] ?? CAT_COLORS.decor)[0];
}
function shade(cat: string): string {
  return (CAT_COLORS[cat] ?? CAT_COLORS.decor)[1];
}

