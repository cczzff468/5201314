'use client';

/**
 * X论坛 · 数据层（v1）。
 *
 * - 数据整体存 IndexedDB kv 单键 `forum-data-v1`（ios-phone-db，经 idb-kv 同步读/异步写）；
 * - 作者三类：user（机主）/ char:<联系人id>（AI 角色）/ npc:<id>（内置论坛网友，给广场人气）；
 * - NPC 帖子/回复：LLM 生成（/api/forum/generate），失败时落 NPC 内置文案池兜底——论坛永远不空；
 * - 订阅：轻量 rev 计数 + window 事件，组件用 useForumData()（useSyncExternalStore）取快照。
 */

import { kvGet, kvSet } from '@/lib/ios/idb-kv';
import { listContacts, ownerRealName } from '@/lib/ios/contacts-store';
import type { ContactRecord } from '@/lib/contacts';

// ---------------- 常量 ----------------

export const FORUM_KEY = 'forum-data-v1';
/** 生成引擎内容风格版本（升级拟真度时 bump：旧 AI 帖子/评论清除重播种，
 *  用户自己发的帖子与回复保留）。v3 = 真实网民口吻 + 防刷屏 + 热度分级 + 首刷连带评论
 *  + 评论主题匹配（版块定领域）+ 评论时间戳自然铺开；
 *  v4 = 网名改为 LLM 生成（不再用内置池子名，用户要求）+ 动态网友占比提升
 *  + 点赞/浏览数字缩写改为 w/k 风格；
 *  v5 = 网名与帖子领域彻底解绑（用户反馈：不要按帖子分类自动匹配网名前缀——
 *  删除全部人设原型网名池，改为 LLM 名字库随取随用）+ 内置 NPC 也由 LLM 起名
 *  （「电影院常驻嘉宾」「是小柔本人呀」这类内置描述型网名全部下岗）
 *  v6 = 互动量合理化（用户反馈：主帖 180 赞、单条评论却几万赞太假）——
 *  评论/楼中楼/AI 回复的点赞浏览改为按父帖比例缩放（评论赞 << 主帖赞，像推特）；
 *  旧数据整体重播种，离谱热度一并清除；
 *  v7 = 信息流生成管线改为严格 JSON（用户反馈：网名漏进正文、正文与评论
 *  粘连成一大段、不同帖子装同样的乱码文本）——旧版「每条一行」松散格式
 *  的历史脏帖一并清除重播种；生成帖配图改为文字图片（canvas 直出）
 *  v8 = 头像全面图片化（用户反馈：评论区不要彩底首字头像——偶然没头像/加载
 *  失败的网友改用 flat 纯色系池轮换：默认灰人形/灰圆/纯黑/纯白/灰渐变）+
 *  网名池扩容 + 回访率下调（网名不要老用那几个）+ 楼中楼文案去重修复
 *  （同一帖两人发一模一样的话）；旧评论一并重播种清掉重复文案 */
export const GEN_VERSION = 8;
/** 首次播种的 NPC 帖子目标条数（feed 一屏半左右） */
export const SEED_POST_TARGET = 14;
/** 补新帖：feed 最新帖子超过该毫秒数视为「凉了」，打开时补 2~4 条 */
export const STALE_MS = 2 * 60 * 60 * 1000;
/** 单帖正文字数上限（用户要求「生成的字数不限」：从一句话短吐到几百字长帖叙事都可以，
 *  仅保留一个宽松的安全上限防失控） */
export const POST_MAX = 2000;
/** 回复字数上限（同上，宽松上限） */
export const REPLY_MAX = 1000;

// ---------------- 数据模型 ----------------

export type AuthorKey = string; // 'user' | 'char:<contactId>' | 'npc:<id>' | 'official'

export interface ForumAuthor {
  key: AuthorKey;
  name: string;
  handle: string; // 不带 @
  avatar: string | null; // dataURL（user/char）；NPC = 头像库图片（加载失败/未分配时 XAvatar 用纯色系 flat 池兑底）
  /** 彩底首字头像（仅官方账号「助」字徽章还在用；网友已全部改用图片头像） */
  npcAvatar?: { bg: string; ch: string };
  /** 认证蓝 V（大 V NPC / 官方账号） */
  verified?: boolean;
  /** 一句话简介（个人页展示） */
  bio?: string;
  /** 粉丝数（NPC 基础值；user/char 动态算） */
  baseFollowers?: number;
  /** 生成用人设（NPC 发帖/回复的 LLM prompt；char 用联系人 persona） */
  persona?: string;
  /** 惯用发帖语言（动态虚拟用户：zh-Hans/zh-Hant/en/ja/ko；缺省 = 简体中文） */
  lang?: string;
  /** IP 属地（评论区展示：北京/广东/日本…；user/官方无） */
  ip?: string;
}

export interface ForumPost {
  id: string;
  authorKey: AuthorKey;
  content: string;
  /** 版块 id（null = 今日热议广场） */
  community: string | null;
  createdAt: number;
  /** 点过赞的作者 key 列表（含 'user'） */
  likes: AuthorKey[];
  /** 转推数（模拟增长） */
  reposts: number;
  views: number;
  /** 合成点赞基数（AI 帖子按热度分层生成：十几/几十/几百/几千/几万/几十万/几百万；
   *  展示数 = likes.length + likeBoost，用户点赞仍写 likes 数组） */
  likeBoost?: number;
  /** 我是否转推过（X 转推可撤销；true 时绿高亮） */
  reposted?: boolean;
  /** 回复链：回复某帖时同时是一条帖（X 语义：回复即发帖） */
  replyTo: string | null;
  replyToName: string | null;
  /** 精确被回复对象的帖子 id（多轮对话定位用）。
   *  replyTo 是分组锚点（顶层评论/主帖 id，决定显示在哪一层）；
   *  replyToPost 记录实际回复的那条（子回复/主帖），AI 据此接话（无限多轮）。 */
  replyToPost?: string;
  /** 帖子附图（dataURL 或 http URL，最多 4 张；发布界面相册/GIF 上传） */
  media?: string[];
  /** 投票（发布界面发起） */
  poll?: PostPoll;
  /** 位置名（发布界面添加，帖子卡展示 📍） */
  location?: string;
  /** 定时发布：到该时刻才出现在列表（undefined = 立即可见；createdAt 同步取该值） */
  visibleAt?: number;
}

/** 帖子投票：选项文本 + 每项票数 + 我投的选项 index（null = 未投） */
export interface PostPoll {
  options: string[];
  votes: number[];
  voted?: number | null;
}

export interface ForumCommunity {
  id: string;
  name: string;
  desc: string;
  /** 头部封面底色（X Communities 卡片风格） */
  coverBg: string;
  /** 成员数（展示值） */
  members: number;
  joined: boolean;
}

export interface ForumNotification {
  id: string;
  type: 'like' | 'reply' | 'repost' | 'follow' | 'system';
  fromKey: AuthorKey;
  /** type=like/repost 时指向被互动的帖子；reply 时指向回复帖 */
  postId: string | null;
  /** 通知正文（system 用；like/reply 由前端拼） */
  text?: string;
  createdAt: number;
  read: boolean;
}

export interface ForumDm {
  /** 对话作者 key */
  peerKey: AuthorKey;
  messages: { id: string; from: AuthorKey; text: string; at: number }[];
}

/** 动态虚拟网友（用户要求：网名不要重复、要像真实网友昵称——
 *  内置 14 个 NPC 之外，生成帖子/评论时动态创建新网友；人设从 30+ 领域原型取
 *  （打工人/饭圈女孩/数码极客/宝妈/搞笑女…），网名优先原型候选（强个人风格：
 *  纯路人拔萝卜/今天也不想上班/Zzzz_ 这类），全局防重；池子耗尽后生成变体名，无限不重名） */
export interface ForumDynNpc {
  /** 真实感网名 */
  name: string;
  /** 一句话简介 */
  bio: string;
  /** 彩底头像底色 */
  bg: string;
  /** 惯用发帖语言（zh-Hans / zh-Hant / en / ja / ko） */
  lang: string;
  /** IP 属地（随语言：中文→国内省份 / 日→日本 / 韩→韩国 / 英→欧美 / 繁→港台） */
  ip: string;
  /** 人设原型 id（PERSONA_ARCHETYPES；信息流大杂烩轮换的依据） */
  archetype?: string;
  /** 少数大 V 带蓝 V */
  verified?: boolean;
  /** 粉丝基础值 */
  followers: number;
  /** 生成用人设 */
  persona: string;
  /** 最近发过的帖子/评论摘要（人设连通性：同一个人换个帖子接上之前的话茬，
   *  如上一条抱怨试驾没车、下一条晒提车；只保留最近 3 条） */
  recent?: string[];
  /** 网名是否已由 LLM 生成（用户要求：网名不要内置池子，让 AI 起）：
   *  createDynNpc 从 LLM 名字库（nameBank）取名时直接置 true；
   *  名字库空时用通用真实感池占位置 false（限流期创建的网友），后续批次回填换名 */
  named?: boolean;
}

export interface ForumData {
  v: 1;
  posts: ForumPost[];
  communities: ForumCommunity[];
  notifications: ForumNotification[];
  dms: ForumDm[];
  following: AuthorKey[];
  likesByMe: Record<string, true>;
  /** 主页顶部分类标签（版块 id 列表，显示为「为你推荐|关注」后的附加 tab） */
  pinnedTags?: string[];
  /** 「不感兴趣 / 举报」后从列表隐藏的帖子 id（数据保留，仅列表不展示） */
  hiddenPosts?: string[];
  /** 论坛内自定义资料（编辑资料后生效；未编辑字段跟随全局机主资料） */
  profile?: ForumProfile;
  /** 动态虚拟网友池（key = dynNpcs 内部 id，authorKey = `dyn:<id>`） */
  dynNpcs?: Record<string, ForumDynNpc>;
  /** 已用网名（全局防重；初始化时合并内置 NPC 名） */
  usedNames?: string[];
  /** 内置 NPC 的 LLM 网名覆盖（id → AI 起的名；v5：内置 NPC 不再永久用内置描述型网名） */
  npcNames?: Record<string, string>;
  /** 内置 NPC 是否已换上 LLM 名（false/缺省 = 还在用同步池子覆盖名，待 LLM 回填换名） */
  npcLlmNamed?: Record<string, boolean>;
  /** LLM 网名库（预生成的备用名，与帖子领域无关；createDynNpc 优先从这里取） */
  nameBank?: string[];
  /** 生成引擎版本（升级内容风格时 bump：旧 AI 帖子清除重播种，用户自己的帖子保留） */
  genVersion?: number;
  seeded: boolean;
  lastGenAt: number;
  joinedAt: number;
}

/** 论坛个人资料自定义（槽位隔离语义，与微信/QQ 头像三入口同口径）：
 *  每个字段未设置（undefined/null/空串）→ 跟随全局（设置›个人信息/联系人机主）；
 *  设置过后 → 论坛内优先使用这里的值，不再随全局变化。
 *  「正在关注/关注者」展示数已按用户要求改为始终跟随真实数据，不再提供自定义。 */
export interface ForumProfile {
  /** 自定义名字（空 = 跟随全局机主名） */
  name?: string;
  /** 自定义账号 handle（不带 @；空 = 默认 qvq12345678） */
  handle?: string;
  /** 自定义头像 dataURL（空 = 跟随全局头像；全局也没有 → XAvatar 默认头像图） */
  avatar?: string | null;
  /** 自定义简介（空 = 「X论坛用户」） */
  bio?: string;
  /** 主页背景图 dataURL（从手机上传，居中裁剪 3:1） */
  banner?: string | null;
}

// ---------------- 内置数据（NPC / 版块 / 官方账号） ----------------

/** NPC 论坛网友：真实网名风格（用户要求：不要「理财X/读书人X/生活X」这类名字，要像真实网友昵称）
 *  + 主题化人设与文案池（八卦/明星/吐槽/车/影视/娱乐/吃瓜，用户指定的内容方向）。
 *  粉丝数/蓝 V/头像色按真实感配置。 */
export const NPC_DEFS: {
  id: string;
  name: string;
  handle: string;
  bg: string;
  bio: string;
  followers: number;
  verified?: boolean;
  persona: string;
  pool: string[];
  replies: string[];
}[] = [
  {
    id: 'wang',
    name: '瓜田里的猹',
    handle: 'melon_field',
    bg: '#2f855a',
    bio: '吃瓜第一线｜瓜保熟｜只搬运不造谣',
    followers: 152300,
    verified: true,
    persona: '资深吃瓜网友「瓜田里的猹」，热点八卦永远第一个到场，消息灵通，口头禅「蹲一个后续」「瓜保熟」，理性吃瓜不带节奏，不指名道姓，习惯用「某顶流」「某剧组」这类称呼。',
    pool: [
      '一觉醒来热搜前十占了仨，这瓜的分量懂的都懂。先不站队，蹲一个后续。#吃瓜现场#',
      '某顶流被拍到深夜同框，双方工作室到现在都没回应。按惯例，48小时内必有声明。#吃瓜现场#',
      '瓜田提醒：今天传的那个聊天记录截图，字体都不统一，P图痕迹明显，先别急着信。#吃瓜现场#',
      '这瓜越吃越大，中午还只是辟谣，晚上就直接实锤了，反转速度比我点外卖还快。#热搜围观#',
      '吃瓜三原则：不站队、不扒素人、等官方。与君共勉。#吃瓜现场#',
      '热搜挂了一下午，词条阅读量破亿了，但点进去全是营销号在复读，真正有用的信息一条没有。#热搜围观#',
      '前排提醒：那个「知情人士」的爆料，翻译一下就是「我编的」。让子弹再飞一会儿。#吃瓜现场#',
    ],
    replies: [
      '蹲一个后续，别断更啊',
      '理性吃瓜，先让子弹飞',
      '瓜田常客表示这个瓜有点大',
      '先马后看，下班慢慢吃',
    ],
  },
  {
    id: 'canteen',
    name: '娱乐圈搬运工',
    handle: 'ent_mover',
    bg: '#d18700',
    bio: '今日份娱乐圈资讯已送达',
    followers: 268900,
    verified: true,
    persona: '娱乐资讯搬运工，每天泡在各大娱乐版块，明星动态、综艺看点、官宣代言第一时间搬运，语气像群里冲浪最快的那个，爱说「搬运一下」「今日份」。',
    pool: [
      '今日份娱乐速报：某综艺官宣了新常驻，评论区已经吵起来了，一方说请对了，一方说糊了。搬完收工。#明星动态#',
      '搬运一下：某顶流的新代言图出来了，大牌排面拉满，粉丝已经开始晒单。理性消费啊朋友们。#明星动态#',
      '颁奖礼红毯图出炉，今晚的造型师有人要加鸡腿，有人要挨打。搬运了几张，评论区自己感受。#明星动态#',
      '剧组官宣阵容了，男主是意难平的那位，女主是新晋小花，这对CP我先锁了。#明星动态#',
      '综艺下期预告放出，飞行嘉宾名单有点意外，这段位请得动也是没想到。搬运完毕，坐等正片。#明星动态#',
      '某歌手巡演开票，三秒售罄。黄牛加价三倍，官方发声明抵制。抢到票的兄弟评论区吱一声，让我酸一下。#明星动态#',
    ],
    replies: [
      '搬运用心，前排学习了',
      '这波资讯很及时，已转我姐妹',
      '搬运工辛苦了，蹲后续',
      '今日份已阅，谢谢老哥',
    ],
  },
  {
    id: 'kitty',
    name: '吐槽能量满格',
    handle: 'tucao_full',
    bg: '#7b4fe0',
    bio: '万物皆可吐槽｜说了就舒服了',
    followers: 96700,
    persona: '吐槽能量满格的网友，看什么都想吐两句，毒舌但讲道理，吐槽完自己先笑，主打一个「说出来就好了」。',
    pool: [
      '吐槽一下现在的预告片：两分半的预告，一分半是上季回顾，剩下一分钟全是「即将播出」。即将了个寂寞。#吐槽大会#',
      '某些剧的滤镜磨皮，把演员脸磨得跟剥壳鸡蛋似的，连打戏都看不清谁打谁。我是来看剧的不是来看雾的。#吐槽大会#',
      '停车场入口排队二十分钟，保安挨个问「找谁」，到我这直接抬杆了。合着我这脸就是通行证呗。#吐槽大会#',
      '看电影旁边哥们全程解说，他朋友没来他自己讲，讲到一半还给自己剧透。大哥你一个人看的啊？#吐槽大会#',
      '新车发布会说了四十分钟智能座舱，动力参数一页带过。我买车是开的，不是住进去的。#吐槽大会#',
      '吐槽大会今日结案：热搜词条越长，有用信息越少，建议平台按字数收费。#吐槽大会#',
    ],
    replies: [
      '哈哈哈哈笑死，真实',
      '这条吐槽到位，句句在理',
      '说出来就好了，我懂你',
      '槽点精准，建议加更',
    ],
  },
  {
    id: 'iron',
    name: '秋名山下打车',
    handle: 'qd_hill',
    bg: '#0f7d9c',
    bio: '攒钱提车中｜键盘车神一等奖',
    followers: 64100,
    persona: '攒钱买车的年轻车迷「秋名山下打车」，键盘车神但理论扎实，对各款车如数家珍，梦想是开上自己的车跑一次山，爱自嘲「先懂原理再谈速度」。',
    pool: [
      '今天又去4S店蹭了一次试驾，销售小哥已经认识我了。摸完方向盘再挤地铁，这个落差谁懂。#提车日记#',
      '看了三年的车，从轿车看到SUV再看到瓦罐，预算一分没涨，快乐倒是持续了三年。#汽车俱乐部#',
      '帮朋友参考了两个月，他提车那天我比他还激动，围着车拍了五十张照片，像是我提的一样。#提车日记#',
      '堵在早高峰上突发奇想：如果油耗按心情算，我今天已经烧掉一个油箱了。#老司机日常#',
      '新手司机提问：侧方停车场库要几次才不算丢人？我今天第三次才进去，隔壁大爷看不下去了。#汽车俱乐部#',
      '跑了趟山路，下山的时候胎压都高了一截。弯道虽然慢，但每一把方向都是我自己打的，值了。#汽车俱乐部#',
    ],
    replies: [
      '键盘车神的理论我服',
      '试驾蹭到销售都认识，绝了',
      '同款攒钱经历，握手',
      '这描述太有画面了哈哈',
    ],
  },
  {
    id: 'boat',
    name: '追剧上头患者',
    handle: 'drama_up',
    bg: '#e0528f',
    bio: '一生追剧无数｜烂尾预警员',
    followers: 187400,
    verified: true,
    persona: '剧集重度用户「追剧上头患者」，开播必追，追完必发帖，上头时连发三条，被烂尾伤过的心比追过的剧还多，爱写「发疯文学」式观后感。',
    pool: [
      '昨晚一口气看了六集，凌晨两点告诉自己看完这集就睡，结果天亮了。这剧有毒，但我不戒。#追剧日常#',
      '第八集封神！！那段长镜头我倒回去看了五遍，编剧是懂怎么拿捏我的。还没看的赶紧上车。#追剧日常#',
      '预警：这剧从第十集开始注水，回忆杀能占半集，我在此立帖为证，烂尾概不负责。#追剧日常#',
      '为了这部剧开了三个会员，平台是懂绑架的。看在大结局面上，忍了。#追剧日常#',
      '今天剧荒，把三年前那部意难平又翻出来看，看到第十二集还是不忍心看结局。有同款经历的举个手。#剧荒互助#',
      '编剧刀我请用剧情，别用台词。昨晚那句台词出来，我一个成年人抱着枕头缓了十分钟。#追剧日常#',
    ],
    replies: [
      '同款上头，昨晚也熬夜了',
      '烂尾预警员辛苦了',
      '十二集我也停在那，握手',
      '这段长镜头我也倒回去看了',
    ],
  },
  {
    id: 'abacus',
    name: '电影院常驻嘉宾',
    handle: 'cinema_vip',
    bg: '#3a5f9c',
    bio: '年观影200部｜短评毒辣但准',
    followers: 220100,
    verified: true,
    persona: '影院常驻嘉宾，一年观影两百部，写短评毒辣但公允，相信好电影值得一张电影票，烂片退钱。',
    pool: [
      '本周新片观后一句话：预告片是全片最好的十五分钟。省下的两小时谢谢我自己。#电影短评#',
      '好电影的特征：看完走出影厅，半天不想说话。今天这部，我沉默了一路。值回票价。#电影短评#',
      '年度十佳提前预定一个席位。散场时全场自发的掌声，是影院久违的东西。#电影短评#',
      '二刷发现了三处伏笔，导演是懂埋线的。好片就该二刷，票钱翻倍也乐意。#电影短评#',
      '提醒：这部片别看解说版，两分钟的解说会毁掉两小时的体验。有的电影必须亲自看。#电影短评#',
      '烂片也有一席之地：陪朋友看的喜剧，烂得很欢乐，我们笑得比看佳作还大声。快乐不分高低。#电影短评#',
    ],
    replies: [
      '短评毒辣但准，服气',
      '被你安利到了，周末去',
      '二刷伏笔那部我也打算再去',
      '「值回票价」就是最高评价了吧',
    ],
  },
  {
    id: 'kai',
    name: '老司机阿伟',
    handle: 'driver_wei',
    bg: '#b35c00',
    bio: '十年老司机｜聊车聊路聊人生',
    followers: 143800,
    verified: true,
    persona: '开了十年车的老司机阿伟，聊车讲实用，堵车讲心态，见惯马路众生相，句句都是路上悟出来的道理。',
    pool: [
      '开了十年车悟了：路上最可怕的不是新手，是觉得自己不是新手的老手。#老司机日常#',
      '早高峰观察：变道加塞省下的两分钟，够他骂一路的。何必呢，油门和血压总得省一个。#老司机日常#',
      '加油站偶遇一台老车，漆面亮得能照人。车主大叔说开了十八年，这车跟他儿子岁数一样大。#汽车俱乐部#',
      '雨天开车提醒：视线模糊先减速，别急着开双闪狂奔。安全到家才是老司机。#老司机日常#',
      '帮人挪了下车，一把入库，围观小伙问我开多少年了。我说十年，前九年都在练这一把。#老司机日常#',
      '车这东西，买的时候看参数，开久了看感情。我的老伙计虽然肉，但每次都能把我带回家。#汽车俱乐部#',
    ],
    replies: [
      '老司机名言，收藏了',
      '这话有年头了，真实',
      '十八年老车那条看泪目了',
      '一把入库的功力羡慕了',
    ],
  },
  {
    id: 'candy',
    name: '是小柔本人呀',
    handle: 'rou_rou',
    bg: '#f0729a',
    bio: '理智追星｜他好我也好',
    followers: 78900,
    persona: '追星女孩小柔，语气活泼带波浪号，前线资讯快人一步，但坚决理智追星：不代拍不私生不超额消费，主张「喜欢是成为更好的自己」。',
    pool: [
      '今天的演唱会安可环节，他把话筒转向观众的那一秒，全场大合唱，我在人群里哭得妆都花了～#明星动态#',
      '理智追星三件套再念一遍：不买代拍、不蹲行程、不为爱氪超过预算。喜欢是让我变好，不是让我吃土～#明星动态#',
      '新歌上线第一小时，我拉了室友一起听，她现在比我还上头。这算不算白嫖了一个同担～#明星动态#',
      '线下活动排队七小时，见到本人的三十秒里我全程大脑空白。回来的地铁上笑出声，值得～#明星动态#',
      '有人问追星图什么。图他站在光里的同时，我也在把自己的日子过亮呀～#明星动态#',
    ],
    replies: [
      '理智追星标杆，学到了～',
      '安可那段我也哭了呜呜',
      '白嫖同担笑死我了～',
      '他在变好你也在变好，真好',
    ],
  },
  {
    id: 'liang',
    name: '柠檬精本精',
    handle: 'lemon_jing',
    bg: '#6b8e23',
    bio: '酸但是真实｜自嘲式生存',
    followers: 52300,
    persona: '柠檬精本精，看什么都先酸一句再认真想，自嘲成瘾，酸完不忘给自己打气，主打「酸是过程，过得好是结果」。',
    pool: [
      '同事新提的车今天到楼下了，我在工位看着窗外酸了整整一上午。下午想通了：他加油，我加鸡腿，各自幸福。#今日吐槽#',
      '朋友圈有人晒演唱会内场票，我看了看自己手里的山顶票，瞬间悟了：山顶也有山顶的风景（和更便宜的价）。#今日吐槽#',
      '朋友的新家精装修交付，我的出租屋灯泡坏了一周。酸完了，明天自己换个灯泡，也算改善住房条件了。#今日吐槽#',
      '看到同龄人晒年终奖，我酸得像颗话梅。酸完认真算了下，今年比去年多存了两万，行吧，我原谅自己了。#今日吐槽#',
      '柠檬精的自我修养：酸可以，酸完得接着干活。今天酸完，方案改完了，我可真是又酸又能干。#今日吐槽#',
    ],
    replies: [
      '酸得清新脱俗，服了',
      '酸完接着干，这就是生活',
      '山顶的风景也不错哈哈',
      '换灯泡那条笑死我了',
    ],
  },
  {
    id: 'sunny',
    name: '今天也在认真吃瓜',
    handle: 'eat_melon2',
    bg: '#e8930c',
    bio: '前排围观｜瓜子花生矿泉水',
    followers: 41200,
    persona: '认真吃瓜的围观群众「今天也在认真吃瓜」，永远前排，永远冷静，瓜子花生矿泉水一应俱全，信奉「让子弹飞一会儿」。',
    pool: [
      '今天的瓜有点大，我把瓜切好摆盘了，理性围观，理性发言。#吃瓜现场#',
      '前排出售瓜子花生矿泉水，要的举手。本摊位只提供零食，不提供立场。#吃瓜现场#',
      '围观一下午的结论：两边都有理，两边都没证据，我先撤了，明天再来看进度条。#吃瓜现场#',
      '吃瓜群众守则第一条：瓜没熟透别急着啃，小心崩了牙。等官方，等后续。#吃瓜现场#',
      '热搜词条一分钟换一个，我瓜子都来不及嗑。建议平台出个「今日瓜况汇总」，方便我们上班族。#热搜围观#',
    ],
    replies: [
      '瓜子给我来一份',
      '理性围观，理性发言，好',
      '等明天进度条+1',
      '瓜况汇总建议采纳哈哈',
    ],
  },
  {
    id: 'gua',
    name: '蹲一个后续',
    handle: 'wait_next',
    bg: '#c4396b',
    bio: '只蹲后续｜不站队不吵架',
    followers: 67800,
    persona: '热搜冲浪选手「蹲一个后续」，看到爆料第一反应是「等一个后续」，见惯反转，从不提前站队，账号简介就是人生态度。',
    pool: [
      '又是「知情人士透露」开头的一天。行，我蹲一个后续，蹲到了回来更新。#热搜围观#',
      '这个瓜上午还是「疑似」，中午变「回应了」，晚上已经「反转了」。一天三集，比连载还准时。#热搜围观#',
      '蹲后续大师提醒：从爆料到实锤平均三天，从实锤到道歉平均一周。别急，时间会更新一切。#热搜围观#',
      '每次都想提前站队，每次都被反转打脸。现在我学乖了：先蹲着，蹲稳了再说话。#吃瓜现场#',
      '今晚的瓜田格外热闹，我搬了个小马扎，备好热水，慢慢蹲。#吃瓜现场#',
    ],
    replies: [
      '蹲一个后续+10086',
      '反转被打脸的我也学乖了',
      '小马扎借我一个',
      '时间会更新一切，说得好',
    ],
  },
  {
    id: 'ju',
    name: '剧荒星人',
    handle: 'ju_hungry',
    bg: '#5f4b8b',
    bio: '求剧｜荐剧｜片单永动机',
    followers: 89400,
    persona: '剧荒星人，剧荒和上头反复横跳，求剧荐剧两不误，片单收藏了一堆，看的速度永远赶不上收藏的速度。',
    pool: [
      '又剧荒了，兄弟姐妹们把最近看完的好剧砸过来，要求就一个：别烂尾。在线等，挺急的。#剧荒互助#',
      '片单收藏了三百部，看完的三部。这个比例，像极了我和我的年度计划。#剧荒互助#',
      '安利一部小众悬疑，前三集平平无奇，第四集开始直接起飞。撑过前三集，你会回来谢我的。#剧荒互助#',
      '求下饭剧！要求：不烧脑、不虐心、一集一个故事。本干饭人跪谢。#剧荒互助#',
      '根据网友推荐连刷两部，一部封神一部劝退。这就是开盲盒的快乐与代价。#剧荒互助#',
    ],
    replies: [
      '前三集定律真实，已收藏',
      '下饭剧我推那个美食综艺',
      '开盲盒的快乐我懂',
      '片单三百看完三部，笑死',
    ],
  },
  {
    id: 'che',
    name: '油门踩到底',
    handle: 'full_throttle',
    bg: '#8b4513',
    bio: '性能控｜赛道日梦想家',
    followers: 112500,
    verified: true,
    persona: '性能车迷「油门踩到底」，聊动力必提零百，看车先看引擎，梦想攒钱下一次赛道日，信奉「直线快是娱乐，弯道快才是技术」。',
    pool: [
      '今天路过改装店，那台车的排气声浪让我原地回头三次。理性告诉我别看钱包，钱包告诉我想都别想。#汽车俱乐部#',
      '看了场本地赛道日，过弯最稳的不是最贵的车，是那位开了十年的老哥。技术和车，一半一半。#汽车俱乐部#',
      '试驾了心心念念的那台，零百的推背感是真的，销售的眼神也是真的（看我像看提不起车的人）。#汽车俱乐部#',
      '科普贴：看车别光看零百，刹得住比跑得快重要。安全配置才是真性能。#汽车俱乐部#',
      '梦想清单新增一条：开自己的车下一次赛道日。为此我戒了一个月的奶茶，加油费有了。#汽车俱乐部#',
    ],
    replies: [
      '声浪回头三次，画面感有了',
      '刹得住比跑得快重要，正解',
      '戒奶茶攒油费，真车迷',
      '老哥过弯那条说到点上了',
    ],
  },
  {
    id: 'bao',
    name: '热搜课代表',
    handle: 'hot_monitor',
    bg: '#2f6d4f',
    bio: '热搜课代表｜每日总结按时交',
    followers: 131600,
    verified: true,
    persona: '热搜课代表，每天把热搜大事总结成条，交作业式发帖，条理清晰爱列「一句话总结」，被网友催更是日常。',
    pool: [
      '今日热搜课代表总结：某剧大结局意难平、某综艺名场面刷屏、某顶流新歌空降榜首。一句话总结：今天也没白冲浪。#热搜围观#',
      '上午三个瓜，下午两个反转，晚上一个道歉。今日总结：热搜的速度，永远比真相快。#热搜围观#',
      '热搜观察日记：娱乐词条占七成，剩下一半在吵架。建议增设「今日好新闻」词条，我第一个去点。#热搜围观#',
      '课代表划重点：这次的热搜词条长达二十三字，信息量约等于「某人有事」。省流大师还得看我。#热搜围观#',
      '被催更了，来了来了。今日份总结已交，评论区补充的瓜我一并谢过，明天见。#热搜围观#',
    ],
    replies: [
      '课代表辛苦，每日必看',
      '省流大师名不虚传',
      '总结得比词条清楚多了',
      '催更成功，明天见',
    ],
  },
];

/** 官方账号（私信里的「论坛小助手」） */
export const OFFICIAL_AUTHOR: ForumAuthor = {
  key: 'official',
  name: '论坛小助手',
  handle: 'forum_helper',
  avatar: null,
  npcAvatar: { bg: '#1d9bf0', ch: '助' },
  verified: true,
  bio: 'X论坛官方助手｜使用问题请私信',
};

/** 版块（X Communities 风格） */
export const COMMUNITY_DEFS: { id: string; name: string; desc: string; coverBg: string; members: number }[] = [
  { id: 'hot', name: '今日热议', desc: '每天大家都在聊的新鲜事', coverBg: '#1d9bf0', members: 1286000 },
  { id: 'gossip', name: '娱乐八卦', desc: '吃瓜第一线，明星动态都在这', coverBg: '#e0528f', members: 892400 },
  { id: 'movie', name: '影视片单', desc: '追剧观影，安利避雷都在这', coverBg: '#8c3aa8', members: 634500 },
  { id: 'car', name: '汽车俱乐部', desc: '聊车、试驾、提车和堵车', coverBg: '#b35c00', members: 421800 },
  { id: 'rant', name: '吐槽大会', desc: '万物皆可吐槽，说了就舒服了', coverBg: '#c4392f', members: 557600 },
  { id: 'digital', name: '数码圈', desc: '新机、老机、一切和数码有关的讨论', coverBg: '#0f7d9c', members: 214300 },
  { id: 'food', name: '吃货联盟', desc: '今天吃了什么？晒出来馋大家', coverBg: '#c4392f', members: 356800 },
  { id: 'work', name: '职场摸鱼', desc: '打工人的互助树洞，不聊 KPI', coverBg: '#7b4fe0', members: 482100 },
  { id: 'game', name: '游戏玩家', desc: '好游戏值得被聊起，氪金与否都欢迎', coverBg: '#8c3aa8', members: 520700 },
  { id: 'fit', name: '健身打卡', desc: '今天练了吗？互相监督的地方', coverBg: '#0f9c6e', members: 98400 },
  { id: 'travel', name: '旅行摄影', desc: '在路上的人和你分享世界', coverBg: '#d18700', members: 176500 },
  { id: 'night', name: '深夜树洞', desc: '睡不着的人，进来坐坐', coverBg: '#3a4a5f', members: 267200 },
];

// ---------------- 动态虚拟网友（真实感网名池 + 语言 + 防重） ----------------

/** 真实感网名池（用户要求：网名不要「理财XX/读书人XX」这类人机模板名，要像真实网友昵称；
 *  覆盖中文互联网真实取名风格：小名系/状态系/食物系/动物系/文艺系/玩梗系/字母系/日系/韩系/繁体风） */
export const REAL_NAME_POOL: string[] = [
  // 小名 / 阿X 系
  '阿茶', '阿蛮爱吃鱼', '小鹿乱撞', '小张有话说', '小王今天不加班', '小李飞叨', '小陈碎碎念', '小赵想吃火锅',
  '阿呆不呆', '阿泽的日常', '小满不发疯', '小北看世界', '小柔不吃辣', '阿杰在冲浪',
  // 状态 / 情绪系
  '在逃打工人', '已退役熬夜选手', '今天也想退休', '精神状态领先', '正在加载中', '冒个泡就跑',
  '在线但不想理人', '退网失败者', '已读乱回', '间歇性努力', '持续性摆烂', '今天也没瘦',
  '疯感很稳定', '情绪稳定大人', '早八幸存者', '加班到天明', '周一综合征本人', '不想上班第108天',
  '干饭第一名', '早睡失败冠军', '起床困难户', '拖延症晚期', '选择困难本难', '在人间凑数的日子',
  '正在装大人', '今天也是废物的一天', '假装在努力', '随时想下班', '人生低谷观光团',
  // 食物系
  '芋泥啵啵', '脆皮烤鸭腿', '半糖去冰', '椰果少糖', '麻辣香锅不放香菜', '蛋黄酥刺客',
  '冰美式续命', '奶茶三分甜', '炸鸡不吃皮', '薯条蘸冰淇淋', '柠檬味气泡水', '草莓大福今天吃了吗',
  '螺蛳粉狂热分子', '火锅底料本料', '不吃香菜星人', '奶茶戒断失败', '深夜食堂干饭人',
  '碳水快乐星人', '西瓜最中间一口', '溏心蛋爱好者', '可乐要加冰', '饺子蘸醋不蘸酱油',
  // 动物系
  '一只废柴猫', '卡皮巴拉本人', '水豚本豚', '不想上班的仓鼠', '巷口的橘猫', '柯基屁股圆',
  '会飞的企鹅', '公园鸽子护卫队', '楼下小狗粉丝会会长', '动物园园长', '柴犬笑容收藏家',
  '猫毛过敏但养猫', '流浪猫投喂员', '熊猫眼本人', '夜猫子成精', '早起的鸟儿起不来',
  // 文艺系
  '北纬三十度', '晚风电台', '山雾邮局', '月亮执行官', '银河修理员', '落日收藏家',
  '云朵搬运工', '深海打字员', '夏夜晚风', '口袋里的星星', '便利店之光', '末班车站台',
  '凌晨四点的海', '二手玫瑰花园', '废片摄影师', '光圈开最大', '十八度灰', '未命名文件夹',
  '春天储备粮', '风的形状', '路灯下的小诗人', '晚霞样品间', '海盐味晚风', '收集日落的人',
  // 玩梗 / 网感系
  '互联网嘴替', '发疯文学部部长', '已老实求放过', '主打一个陪伴', '格局打开', '纯路人围观',
  '蹲后续专业户', '前排出售瓜子', '让子弹再飞会儿', '课代表候补', '省流助手', '退退退大王',
  '拴Q了家人们', '尊嘟假嘟', '那咋了', '包的兄弟', '听劝改造中', '已黑化但没完全',
  '摆烂大师兄', '躺平任嘲', '脆皮大学生', '脆皮打工人', '大厂女孩日记', '乙方嘴替',
  '甲方劝退师', 'PPT纺织工', '会议绝缘体', '周报编不下去', '工位植物人', '精神离职中',
  '低电量人类', '充电五分钟通话两小时', '重启人生失败', '已加入干饭豪华套餐',
  // 字母 / 中英混合系
  'momo', 'momo酱', 'Kiko不睡觉', 'Luna在摸鱼', 'Rita今天不上班', 'Doris的日常',
  'Vivi要暴富', 'YoYo不是悠悠球', 'Nana想吃火锅', 'Coco不想上班', 'Kiwi很酸',
  '一只momo', 'Amy不想努力', 'Sam的深夜食堂', '大鹏DayDay', 'Leo慢慢来',
  'Tina的碎碎念', 'Vera在放空', 'Mia随便记记', 'JoJo的奇妙日常', 'Yuki还没睡', 'Momo是也',
  // 日系（中文平台上的日语 ID 网友）
  '桜ちやん', 'たまご', '抹茶大福', '深夜三点の猫', '雨の日好き', 'ごはんlover',
  '本日の気分', 'カフェオレ', '夏の終わり', '読書中', '猫のかたまり', '月見うどん',
  // 韩系
  '하늘별', '치즈볼', '서울야행', '오늘도수고', '달빛러버', '泡菜加满',
  '首尔在逃实习生', '汉江公园常客', '便利店三角饭团',
  // 繁体风（港台网友）
  '不吃香菜的傑森', '台北小美', '在香港的Amy', '高雄看海人', '台南吃透透', '澳門夜遊人',
  '東區逛街狂', '基隆雨都人',
  // 饭圈吃瓜型（用户指定风格：纯路人拔萝卜/吃瓜不吐籽_/内娱判官/别惹我_会发疯）
  '瓜田里上蹿下跳', '前排围观不发言', '瓜子已备好', '热搜挂钩钉子户', '板凳已搬好',
  '瓜农直销不议价', '这个瓜保熟吗', '今天内娱塌房了吗', '嗑到了就是真的', '本命只有我知道',
  '顶流观察员', '站姐背后的女人', '应援色收藏家', '数据女工今天下班了吗', '白嫖演唱会门票',
  '追星不花钱联盟', '代拍劝退大使', '饭圈嘴替', '娱乐圈在逃纪委', '塌房预备役',
  // 日常吐槽型（今天也不想上班/睡不醒的猫/月底必吃土）
  '上班如上坟本坟', '周一受害者', '早八幸存者', '老板画的饼真香', '工位摸鱼冠军',
  '带薪如厕大师', '通勤两小时选手', '工资三分钟热度', '辞职口号月更', '班味洗不掉',
  '精神离职中', '周报编不下去', '这个月又不月光', '花呗还完了吗', '攒钱失败专员',
  '空调续命中', '外卖红包猎人', '快递比人先到家', '地铁人形立牌', '起床失败十连',
  // 极简英文/拼音型（Asdfgh/Zzzz_/Momo/不瘦十斤不改名）
  // v7：删掉 plmm在线冲浪（用户反馈：这个名字出现在回复对象里像写死的变量，太假）
  'Asdfgh', 'Zzzz_', 'Momo', 'momo酱', 'dddd', 'xswl本wsl', 'yyds本人',
  'nsdd', 'u1s1', 'dbq我错了', 'awsl', 'szd', 'kdl', 'bhs', '不瘦十斤不改名', 'qwe123',
  'hhh别骂了', 'pyq不见不散', 'bili干杯', 'auoh', 'Lynn不在线', 'Cici今天很困',
  // v8 扩容（用户反馈：网名老用那几个——LLM 限流期兜底池更大，评论区面孔更丰富）
  '黄油曲奇不加糖', '乌龙去冰三分甜', '深夜泡面学家', '冰箱里有半个西瓜', '饺子就蒜',
  '烤红薯要流蜜的', '关东煮最后一块', '薯片碎渣收藏家', '奶茶加珍珠不加糖', '汤圆黑芝麻馅',
  '周末爬山选手', '公园暴走团', '夜跑半途而废', '瑜伽垫晾衣服', '跳绳三天放弃',
  '健身卡吃灰中', '操场散步观察员', '羽毛球捡球手', '游泳换气失败', '拉伸两分钟结束',
  '存款为零的快乐', '记账三天放弃', '工资到账三分钟', '购物车清空大师', '优惠券过期达人',
  '双十一吃土', '快递站常客', '退货流程熟练工', '直播间蹲优惠', '九块九包邮学家',
  '月亮邮递员', '晚风便利店', '凌晨的自习室', '雨天窗户边', '云的收藏夹',
  '路灯收集者', '末班车乘客', '清晨六点の海', '午后三点的猫', '风把窗帘吹起来',
  '被窝考古学家', '枕头翻面主义者', '午睡超时冠军', '闹钟按掉五次', '床以外都是远方',
  'WiFi满格才会出门', '手机电量焦虑症', '充电器随身带', '消息免打扰常开', '已读不回艺术家',
  '表情包库存充足', '斗图从不输', '标点符号省略者', '打字全靠语音', '错字连篇不改',
  '地铁座位侦察兵', '公交车站牌背下来了', '堵车时听广播', '共享单车月卡用户', '步行二十五分钟',
  '书签永远在第十二页', '买书如山倒', '电子书吃灰中', '播客二倍速', '歌单循环到腻',
  '猫片云吸户', '狗子握手失败', '鹦鹉学舌中', '鱼缸藻类培育师', '乌龟叫壮壮',
  '绿萝养死三盆', '多肉浇水过多', '仙人掌苟活着', '阳台种葱失败', '窗台薄荷还活着',
];

/** 真实感简介池（随机分配给动态网友） */
const BIO_POOL: string[] = [
  '日常碎碎念，想到什么说什么', '在人间凑数的日子', '退网了但没完全退', '网络冲浪十级选手',
  '只看不发星人（偶尔发）', '深夜emo，白天装正常人', '吃瓜第一名，发言看心情', '我的主页我做主',
  '碎碎念专用号', '今天也是热爱生活的一天', '评论区常驻，主页常年荒芜', '生活不易，猫猫叹气',
  '攒钱买小岛计划进行中', '打工是不可能打工的（在打工）', '追星理智粉，偶尔失控', '已读不回专业户',
  '点赞之交也欢迎', '随手记录，欢迎围观', '间歇性崩溃，习惯性自愈', '不吵架，只吃瓜',
  '转发这只锦鲤', '白天搞笑，晚上emo', '随便看看，随便聊聊', '干饭睡觉打豆豆',
  '碎嘴但心善', '略', '这个人很懒，什么都没留下', '永远十七岁', '在逃迪士尼公主',
  '宇宙无敌可爱（自封）', '瓜田里的普通猹', '蹲一个后续', '今日份快乐已送达',
  '在线冲浪，慢回勿念', '本人比文案有趣', '主页是精神状况展示区', '记录美好生活（偶尔）',
];

// ---------------- 人设原型（虚拟网友池 · 30+ 领域大杂烩） ----------------

/** 人设原型：每个动态网友落一个原型（打工人/饭圈女孩/数码极客/宝妈/搞笑女…），
 *  决定 persona prompt、常聊话题、网名候选（强个人风格）。信息流按原型轮换 →
 *  每隔几条就有完全不同领域和语气的人出现（用户要求的「大杂烩」）。 */
export interface PersonaArchetype {
  id: string;
  /** 领域名（内部标识） */
  label: string;
  /** 生成 prompt 用人设描述（口吻/话题/口头禅） */
  persona: string;
  /** 常聊话题方向（喂给 LLM 的 topic） */
  topics: string[];
}

export const PERSONA_ARCHETYPES: PersonaArchetype[] = [
  {
    id: 'dagong', label: '打工人',
    persona: '互联网公司打工人，天天嘴上辞职月月满勤，聊通勤、老板画饼、摸鱼技巧、工资和房租。语气疲惫带自嘲，爱说「谁懂啊」「真的会谢」「已老实」，偶尔爆发的怨气很真实。',
    topics: ['打工日常', '通勤挤地铁', '老板画饼', '工位摸鱼'],
  },
  {
    id: 'fanquan', label: '饭圈女孩',
    persona: '追星女孩，前线消息快人一步，聊爱豆行程、演唱会、代拍乱象、塌房预警。语气活泼波浪号打不停，理智追星但偶尔上头，见到「某某真人比屏幕帅」这类帖子必回。',
    topics: ['追星日常', '演唱会现场', '内娱八卦', '塌房预警'],
  },
  {
    id: 'shuma', label: '数码极客',
    persona: '数码极客，新机发布会必看直播，聊芯片跑分、屏幕素质、性价比。等等党代言人，爱说「一步到位」「再战三年」「买新不买旧」，对厂商刀法精准程度如数家珍。',
    topics: ['数码新机', '发布会看点', '性价比', '等等党'],
  },
  {
    id: 'baoma', label: '宝妈',
    persona: '二胎宝妈，日常聊娃的辅食、学区房、辅导作业崩溃瞬间和婆媳过招。琐碎但真实，偶尔崩溃大多温暖，爱用省略号和叹气。',
    topics: ['育儿日常', '辅食大战', '学区房', '辅导作业'],
  },
  {
    id: 'gaoxiao', label: '搞笑女',
    persona: '搞笑女，万物皆可整活，自嘲式幽默，讲自己的社死现场比谁都起劲，评论区永远哈哈哈。语气夸张，善用「救命」「笑死」「家人们谁懂」。',
    topics: ['社死现场', '整活日常', '搞笑段子'],
  },
  {
    id: 'chigua', label: '吃瓜群众',
    persona: '资深吃瓜群众，热搜常驻前排，瓜子花生矿泉水一应俱全。从不提前站队，信奉让子弹再飞一会儿，遇到爆料帖必问「有实锤吗」。',
    topics: ['内娱八卦', '热搜围观', '吃瓜现场'],
  },
  {
    id: 'gangjing', label: '杠精',
    persona: '论坛杠精，看什么都要杠一句，擅长「只有我觉得」「不是我说」「有一说一」开头，语气阴阳怪气但逻辑偶尔在线。回帖必唱反调，热度高的帖子他杠得越起劲。',
    topics: ['万物皆可杠'],
  },
  {
    id: 'kebiao', label: '课代表',
    persona: '课代表体质，看帖必总结，条理清晰爱划重点，「课代表来了」「省流版」是口头禅，被网友催更是日常。',
    topics: ['热搜总结', '省流吃瓜'],
  },
  {
    id: 'zhuiju', label: '追剧狂魔',
    persona: '追剧狂魔，一部剧一晚上刷完，烂尾预警员，发疯文学十级。被刀过的心比追过的剧还多，爱说「编剧出来挨打」「这剧有毒我不戒」。',
    topics: ['追剧吐槽', '烂尾预警', '新剧安利'],
  },
  {
    id: 'laosiji', label: '老司机',
    persona: '十年驾龄老司机，聊车讲实用，堵车讲心态，见惯马路众生相，句句都是路上悟出来的道理，爱说「安全到家才是老司机」。',
    topics: ['提车养车', '堵车日常', '开车见闻'],
  },
  {
    id: 'xinshou', label: '新手司机',
    persona: '刚拿本的新手司机，侧方停车要来三把，被滴滴就手心冒汗，攒钱看车蹭试驾，销售都认识他了。语气又菜又爱问。',
    topics: ['新手开车', '攒钱买车', '蹭试驾'],
  },
  {
    id: 'daxuesheng', label: '大学生',
    persona: '普通大学生，早八靠闹钟续命，期末靠图书馆通宵，宿舍夜谈、食堂测评、恋爱脑一个不少。语气年轻，爱用缩写和梗。',
    topics: ['校园日常', '期末周', '食堂测评'],
  },
  {
    id: 'kaoyan', label: '考研党',
    persona: '考研人，图书馆-食堂-出租屋三点一线，政治英语专业课轮着背，焦虑但嘴硬，爱说「一战成硕」「求求了」。',
    topics: ['考研日常', '图书馆占座', '背书崩溃'],
  },
  {
    id: 'chanshou', label: '铲屎官',
    persona: '铲屎官，猫毛沾满全身也开心，聊猫粮测评、疫苗、拆家现场，相册全是宠物照，爱说「主子」「毛孩子」。',
    topics: ['猫猫狗狗', '宠物日常', '拆家现场'],
  },
  {
    id: 'jianshen', label: '健身咖',
    persona: '健身咖，三分化训练雷打不动，鸡胸肉西兰花就是命，爱聊体脂率和补剂，对「三天打鱼式健身」选手恨铁不成钢。',
    topics: ['健身打卡', '减脂日常', '体脂率'],
  },
  {
    id: 'youxi', label: '游戏宅',
    persona: '游戏宅，新游必买首发，开黑上分两不误，聊版本更新、装备掉率、外挂骂战。凌晨排位是日常，语气冲但讲道理。',
    topics: ['游戏开黑', '新游测评', '上分日常'],
  },
  {
    id: 'shengqian', label: '省钱达人',
    persona: '省钱达人，优惠券之王，羊毛见就薅，钱包和快乐都省出来。对一切营销套路免疫，爱说「这钱不花就是赚」。',
    topics: ['省钱薅羊毛', '优惠券', '平替好物'],
  },
  {
    id: 'chihuo', label: '吃货',
    persona: '干饭人，美食雷达全开，新店必打卡，聊探店、外卖测评、深夜放毒。爱说「看饿了」「这也太香了」。',
    topics: ['美食探店', '外卖测评', '深夜放毒'],
  },
  {
    id: 'lvxing', label: '旅行者',
    persona: '旅行特种兵，周末也要闪现外地，穷游攻略大师，聊踩坑、机酒比价、出片机位。爱说「来都来了」。',
    topics: ['旅行踩坑', '穷游攻略', '特种兵旅游'],
  },
  {
    id: 'sheying', label: '摄影党',
    persona: '摄影党，器材吃灰，废片一堆，聊出片返图、构图玄学、修图两小时。爱说「直出是不可能直出的」。',
    topics: ['摄影日常', '器材吃灰', '废片收藏'],
  },
  {
    id: 'yemao', label: '夜猫子',
    persona: '夜猫子，凌晨三点精神最好，深夜 emo 与快乐交替，聊失眠、夜宵、凌晨的世界。凌晨发的帖子情绪浓度最高。',
    topics: ['深夜emo', '失眠互助', '夜宵时间'],
  },
  {
    id: 'kafei', label: '咖啡控',
    persona: '咖啡续命，一天三杯起步，瑞幸库迪测评员，聊豆子、拉花、打工人的咖啡因。爱说「不喝咖啡等于没醒」。',
    topics: ['咖啡日常', '打工人续命水'],
  },
  {
    id: 'qiumi', label: '球迷',
    persona: '球迷，足球篮球都看，凌晨的球赛一场不落，聊转会、战术、VAR争议。主队输球当天不发帖心里堵得慌。',
    topics: ['看球日常', '转会窗', '比赛复盘'],
  },
  {
    id: 'yinyue', label: '音乐节常客',
    persona: 'livehouse 钉子户，音乐节全勤，聊阵容、抢票、现场偶遇。爱说「现场的震撼是耳机给不了的」。',
    topics: ['音乐节', 'livehouse', '抢票大战'],
  },
  {
    id: 'erciyuan', label: '二次元',
    persona: '二次元，追番补番两不误，聊新番、谷子、漫展，偶尔痛包出门。爱说「这就是青春」「补番补到天亮」。',
    topics: ['追番日常', '漫展', '吃谷日常'],
  },
  {
    id: 'hanfu', label: '汉服lo娘',
    persona: '汉服 lo 娘，出片返图，聊工期、形制、马面裙搭配。为了一件工期半年的袄裙愿意吃土三个月。',
    topics: ['汉服日常', '出片返图', '马面裙'],
  },
  {
    id: 'xiaozhen', label: '小镇青年',
    persona: '县城生活观察家，聊小城的慢节奏、人情世故、返乡见闻。语气平和带点幽默，爱说「镇上就这么大点事」。',
    topics: ['县城生活', '返乡见闻', '小城日常'],
  },
  {
    id: 'beipiao', label: '北漂',
    persona: '北漂青年，合租隔断间，通勤跨半城，聊房租、搬家、和这座城市若即若离的关系。语气疲惫但不服输。',
    topics: ['北漂日常', '合租隔断', '搬家血泪'],
  },
  {
    id: 'dongbei', label: '东北老铁',
    persona: '东北老铁，唠嗑式发言，自来熟，聊啥都像唠家常，爱说「咋地」「老铁」「整挺好」。看啥都想整两句。',
    topics: ['唠嗑日常', '东北生活'],
  },
  {
    id: 'yue', label: '粤圈靓仔',
    persona: '粤圈靓仔，煲汤叹茶，粤语口头禅「係咁先」「饮茶先啦」，聊早茶、糖水、广东天气。语气淡定看透一切。',
    topics: ['广东生活', '早茶', '煲汤'],
  },
  {
    id: 'liuxue', label: '海外留学生',
    persona: '海外留学生，时差党，半夜想家想外卖，聊 due、中超、汇率。爱说「国内的朋友请我吃一口」。',
    topics: ['留学生活', '时差党', '想家瞬间'],
  },
  {
    id: 'ningmeng', label: '柠檬精',
    persona: '柠檬精，看啥都先酸一句，酸完不忘给自己打气，自嘲成瘾。爱说「酸了酸了」「我不配」。',
    topics: ['酸言酸语', '日常羡慕'],
  },
];

// ---------------- IP 属地 ----------------

/** 中文网友 IP 属地池（人口大省/一线城市权重更高，贴近真实评论区分布） */
const IP_ZH_WEIGHTED: string[] = [
  '北京', '北京', '北京', '广东', '广东', '广东', '江苏', '江苏', '上海', '上海',
  '浙江', '浙江', '山东', '四川', '湖北', '湖南', '河南', '福建', '重庆', '陕西',
  '辽宁', '云南', '天津', '安徽', '河北', '江西', '广西', '黑龙江', '山西', '贵州',
  '甘肃', '内蒙古', '新疆', '海南',
];
/** 外语/繁体网友 IP 属地（与惯用语言一致） */
const IP_BY_LANG: Record<string, string[]> = {
  'zh-Hant': ['台湾', '台湾', '香港', '香港', '澳门'],
  ja: ['日本'],
  ko: ['韩国'],
  en: ['美国', '美国', '英国', '加拿大', '澳大利亚', '新加坡'],
};

/** 随机 IP 属地（中文 → 国内省份加权；外语 → 对应国家） */
export function rollIp(lang: string): string {
  const pool = IP_BY_LANG[lang] ?? IP_ZH_WEIGHTED;
  return pool[Math.floor(Math.random() * pool.length)];
}

/** 内置 NPC 的 IP 属地（固定，人物一致） */
export const NPC_IPS: Record<string, string> = {
  wang: '北京', canteen: '上海', kitty: '广东', iron: '浙江', boat: '江苏',
  abacus: '四川', kai: '山东', candy: '湖南', liang: '湖北', sunny: '河南',
  gua: '陕西', ju: '福建', che: '辽宁', bao: '北京',
};

/** 彩底头像底色板（动态网友随机） */
const AVATAR_BGS: string[] = [
  '#e0528f', '#f0729a', '#d18700', '#e8930c', '#2f855a', '#0f9c6e', '#3a5f9c', '#0f7d9c',
  '#7b4fe0', '#8c3aa8', '#c4396b', '#b35c00', '#8b4513', '#6b8e23', '#5f4b8b', '#2f6d4f',
  '#c4392f', '#536471', '#a0522d', '#483d8b', '#2e8b57', '#cd853f', '#db7093', '#556b2f',
];

/** 动态网友上限（防数据无限膨胀：超限后不再新建，复用已有网友——真实论坛也是老面孔发新帖） */
export const DYN_NPC_CAP = 2600;

/** 语言代码 → 中文名（生成 prompt 用） */
export const FORUM_LANG_LABELS: Record<string, string> = {
  'zh-Hans': '简体中文',
  'zh-Hant': '繁体中文',
  en: '英语',
  ja: '日语',
  ko: '韩语',
};

/** 随机惯用语言（用户要求：帖子/评论可以生成英语、韩语、日语、繁体字等——
 *  多数简体中文（中文平台），自然混入繁体/英/日/韩网友，像真实的国际化评论区） */
function rollLang(): string {
  const r = Math.random();
  if (r < 0.68) return 'zh-Hans';
  if (r < 0.78) return 'zh-Hant';
  if (r < 0.86) return 'en';
  if (r < 0.93) return 'ja';
  return 'ko';
}

/** 池子耗尽后的真实感变体名（像真实平台的重名用户：momo → momo_0321 / momo本人 / 不是momo） */
function makeNameVariant(base: string, used: Set<string>): string {
  for (let i = 0; i < 60; i++) {
    const n = Math.floor(Math.random() * 9000 + 1000);
    const styles = [
      `${base}_${n}`,
      `${base}${Math.floor(Math.random() * 90 + 10)}`,
      `${base}本人`,
      `不是${base}`,
      `${base}分身`,
      `${base}的日常`,
      `今天${base}上线`,
      `${base}二号机`,
    ];
    const cand = styles[Math.floor(Math.random() * styles.length)];
    if (!used.has(cand)) return cand;
  }
  return `${base}_${Date.now().toString(36).slice(-4)}`;
}

/** 初始化已用名集合（首次使用时合并内置 NPC 名，防动态网友撞内置名；
 *  v5：内置 NPC 的 LLM 覆盖名也一并占用） */
function ensureUsedNames(d: ForumData): string[] {
  if (!Array.isArray(d.usedNames)) d.usedNames = [];
  if (!d.usedNames.length) {
    d.usedNames = NPC_DEFS.map((n) => n.name);
    d.usedNames.push(OFFICIAL_AUTHOR.name);
  }
  for (const v of Object.values(d.npcNames ?? {})) {
    if (!d.usedNames.includes(v)) d.usedNames.push(v);
  }
  return d.usedNames;
}

/** 还没换上 LLM 网名的内置 NPC id（起名回填目标；v5：内置 NPC 也由 LLM 起名）。
 *  同步池子覆盖名（限流期保底）不算完成——只有 npcLlmNamed 标记过的才算。 */
export function unnamedNpcIds(): string[] {
  const d = forumData();
  return NPC_DEFS.map((n) => n.id).filter((id) => !d.npcLlmNamed?.[id]);
}

/** 播种时同步给内置 NPC 分配真实感池子覆盖名（不依赖 LLM：限流期也不露出
 *  「电影院常驻嘉宾」「是小柔本人呀」这类内置描述型网名；后续 LLM 回填再换 AI 名）。
 *  只处理还没覆盖名的；防重（usedNames）；池子耗尽用变体名。返回分配数。 */
export function seedBuiltinNpcFallbackNames(): number {
  const d = forumData();
  const used = new Set(ensureUsedNames(d));
  let n = 0;
  for (const def of NPC_DEFS) {
    if (d.npcNames?.[def.id]) continue;
    const avail = REAL_NAME_POOL.filter((x) => !used.has(x));
    const name = avail.length
      ? avail[Math.floor(Math.random() * avail.length)]
      : makeNameVariant(REAL_NAME_POOL[Math.floor(Math.random() * REAL_NAME_POOL.length)], used);
    d.npcNames = d.npcNames ?? {};
    d.npcNames[def.id] = name;
    d.npcLlmNamed = d.npcLlmNamed ?? {};
    d.npcLlmNamed[def.id] = false; // 池子覆盖名：LLM 回填目标
    used.add(name);
    d.usedNames!.push(name);
    n += 1;
  }
  return n;
}

/** 给内置 NPC 换 LLM 起的网名（v5：内置 NPC 不再永久用内置描述型名。
 *  名字存 npcNames 覆盖表并标记 npcLlmNamed；resolveAuthor 动态读取；不动帖子数据。
 *  不触发 save——由调用方统一落盘广播。返回是否实际改名。 */
export function renameBuiltinNpc(id: string, newName: string): boolean {
  const def = NPC_DEFS.find((n) => n.id === id);
  const next = newName.trim().slice(0, 20);
  if (!def || !next) return false;
  const d = forumData();
  d.npcNames = d.npcNames ?? {};
  d.npcLlmNamed = d.npcLlmNamed ?? {};
  // 与内置名相同也标记完成（避免无限重试）；已挂同一个名也直接标记
  if (next !== def.name && d.npcNames[id] !== next) {
    d.npcNames[id] = next;
    const names = ensureUsedNames(d);
    if (!names.includes(next)) names.push(next);
  }
  if (!d.npcLlmNamed[id]) d.npcLlmNamed[id] = true;
  return true;
}

/** 重命名动态网友（LLM 生成网名落地：用户要求网名由 AI 生成、不走内置池子；
 *  createDynNpc 先用池子名占位（同步保底），LLM 起好名后调这里换掉）。
 *  同步换 usedNames（旧名释放、新名占用）+ persona 里的「旧名」一并替换；
 *  不触发 save——由调用方统一落盘广播。返回是否实际改名。 */
export function renameDynNpc(key: AuthorKey, newName: string): boolean {
  if (!key.startsWith('dyn:')) return false;
  const d = forumData();
  const npc = d.dynNpcs?.[key.slice(4)];
  if (!npc) return false;
  const old = npc.name;
  const next = newName.trim().slice(0, 20);
  if (!old || !next || old === next) return false;
  npc.name = next;
  npc.named = true; // 已用 LLM 名（后续批次不再回填这个网友）
  // persona 里的名字同步替换（「瓜田里的猹」→ 新名，生成口吻跟着新身份走）
  if (npc.persona.includes(`「${old}」`)) {
    npc.persona = npc.persona.replaceAll(`「${old}」`, `「${next}」`);
  } else if (npc.persona.includes(old)) {
    npc.persona = npc.persona.replaceAll(old, next);
  }
  const names = ensureUsedNames(d);
  const i = names.indexOf(old);
  if (i !== -1) names.splice(i, 1);
  if (!names.includes(next)) names.push(next);
  return true;
}

/** 还是池子占位名的动态网友（限流期创建、LLM 起名失败落下的）：
 *  renameDynNpcsViaLlm 每次额外带回填它们，直到全部换成 LLM 名。 */
export function unnamedDynKeys(limit: number): AuthorKey[] {
  const d = forumData();
  const out: AuthorKey[] = [];
  for (const [id, npc] of Object.entries(d.dynNpcs ?? {})) {
    if (npc && !npc.named) out.push(`dyn:${id}`);
    if (out.length >= limit) break;
  }
  return out;
}

/** 动态创建一个虚拟网友（同步、原位写入 forumData，由调用方随后 saveForum 落盘广播）。
 *  - 人设原型（32 领域）决定 persona/话题/网名风格；未指定时随机（大杂烩）；
 *  - 网名优先原型候选（强个人风格）→ 通用真实感池 → 变体名，全局防重永不重名；
 *  - IP 属地随惯用语言（中文→国内省份加权 / 日→日本 / 韩→韩国 / 英→欧美 / 繁→港台）；
 *  - langBias 传入时大概率跟随偏置（如英语帖评论区英语网友更多）；
 *  - 池满（> DYN_NPC_CAP）返回已有随机网友 key（不再新建）。
 *  返回 authorKey（`dyn:<id>`）。 */
export function createDynNpc(opts?: { archetypeId?: string; langBias?: string }): AuthorKey {
  const d = forumData();
  if (!d.dynNpcs) d.dynNpcs = {};
  const ids = Object.keys(d.dynNpcs);
  if (ids.length >= DYN_NPC_CAP) {
    return `dyn:${ids[Math.floor(Math.random() * ids.length)]}`;
  }
  const used = new Set(ensureUsedNames(d));
  const arch = opts?.archetypeId
    ? PERSONA_ARCHETYPES.find((x) => x.id === opts.archetypeId)
    : PERSONA_ARCHETYPES[Math.floor(Math.random() * PERSONA_ARCHETYPES.length)];
  // 网名（v5）：LLM 名字库优先（与帖子领域无关——原型只决定口吻，不决定网名）；
  // 库空（LLM 一直没连上/限流）时才用通用真实感池占位，后续批次回填换名。
  // 用户要求：不要按帖子分类自动匹配网名前缀，叫 momo 的人照样聊车。
  let name = '';
  let named = false;
  const bank = Array.isArray(d.nameBank) ? d.nameBank : (d.nameBank = []);
  while (bank.length) {
    const cand = bank.pop() as string;
    if (!used.has(cand)) {
      name = cand;
      named = true; // 名字库里的都是 LLM 起的名
      break;
    }
  }
  if (!name) {
    const avail = REAL_NAME_POOL.filter((n) => !used.has(n));
    name = avail.length
      ? avail[Math.floor(Math.random() * avail.length)]
      : makeNameVariant(REAL_NAME_POOL[Math.floor(Math.random() * REAL_NAME_POOL.length)], used);
  }
  d.usedNames!.push(name);
  const lang = opts?.langBias && Math.random() < 0.55 ? opts.langBias : rollLang();
  const bio = BIO_POOL[Math.floor(Math.random() * BIO_POOL.length)];
  const bg = AVATAR_BGS[Math.floor(Math.random() * AVATAR_BGS.length)];
  const followers = Math.random() < 0.06
    ? 80_000 + Math.floor(Math.random() * 900_000) // 少数大 V
    : 20 + Math.floor(Math.random() * 90_000);
  const id = uid('d');
  const persona = arch
    ? `${arch.persona}你的网名是「${name}」，说话保持这个人的口吻和用语习惯。`
    : `论坛网友「${name}」，简介：${bio}。说话像真实网友，有自己的语气习惯，偶尔跑题，偶尔玩梗。`;
  d.dynNpcs[id] = {
    name,
    bio,
    bg,
    lang,
    ip: rollIp(lang),
    archetype: arch?.id,
    verified: Math.random() < 0.07,
    followers,
    persona,
    recent: [],
    named,
  };
  return `dyn:${id}`;
}

// ---------------- 存取 + 订阅 ----------------

const CHANGED_EVENT = 'forum-data-changed';

let cache: ForumData | null = null;
let rev = 0;
/** 联系人快照（char 作者解析用；App 挂载时 refreshForumAuthors 填充） */
let contactsSnap: ContactRecord[] = [];
let ownerName = '我';
let ownerAvatar: string | null = null;

function blank(): ForumData {
  return {
    v: 1,
    posts: [],
    communities: COMMUNITY_DEFS.map((c) => ({ ...c, joined: c.id === 'hot' })),
    notifications: [],
    dms: [],
    following: [],
    likesByMe: {},
    pinnedTags: [],
    seeded: false,
    lastGenAt: 0,
    joinedAt: Date.now(),
  };
}

/** 同步读（kv 内存缓存；未初始化时给空白） */
export function forumData(): ForumData {
  if (!cache) {
    const raw = kvGet(FORUM_KEY);
    if (raw && typeof raw === 'object' && Array.isArray((raw as ForumData).posts)) {
      cache = raw as ForumData;
    } else {
      cache = blank();
    }
  }
  return cache;
}

/** 写穿（内存 + 异步落盘）+ 广播 */
export function saveForum(next: ForumData): void {
  cache = next;
  rev += 1;
  void kvSet(FORUM_KEY, next);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(CHANGED_EVENT));
}

export function subscribeForum(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener(CHANGED_EVENT, cb);
  return () => window.removeEventListener(CHANGED_EVENT, cb);
}

/** useSyncExternalStore 快照（对象缓存：rev 不变时返回同一引用——
 *  getSnapshot 必须稳定，每次新建对象会触发无限重渲循环） */
let snapCache: { data: ForumData; rev: number } | null = null;
let snapRev = -1;
export function forumSnapshot(): { data: ForumData; rev: number } {
  const d = forumData();
  if (!snapCache || snapRev !== rev) {
    snapCache = { data: d, rev };
    snapRev = rev;
  }
  return snapCache;
}

export function forumRev(): number {
  return rev;
}

// ---------------- 作者解析 ----------------

/** 模块级缓存填充：读联系人 + 机主名/头像（App 挂载时调一次；联系人变化时可重调）
 *  头像优先级（与微信/QQ 同源）：论坛内自定义 › 机主联系人头像 › 设置›个人信息头像。
 *  修复：此前只读 settings.profile.avatar，机主头像存在联系人记录上（微信用的就是它），
 *  导致个人主页/发帖等全部显示灰色默认头像。 */
export async function refreshForumAuthors(): Promise<void> {
  try {
    const list = await listContacts();
    contactsSnap = list;
    // 机主联系人（kind='user' 且非小号档案）的头像：微信/视频通话等所有 App 的「我」头像同源
    const me = list.find((c) => c.kind === 'user' && !c.altOf);
    if (me?.avatar) ownerAvatar = me.avatar;
  } catch {
    contactsSnap = [];
  }
  try {
    ownerName = (await ownerRealName()) || '我';
  } catch {
    /* 保持默认 */
  }
  try {
    const { useSettings } = await import('@/lib/ios/store');
    const prof = useSettings.getState().profile;
    // 联系人头像优先；联系人也未设置时回退设置›个人信息的头像
    if (!ownerAvatar) ownerAvatar = prof?.avatar || null;
    if (prof?.name) ownerName = prof.name;
  } catch {
    /* 保持默认 */
  }
}

export function forumContactsSnap(): ContactRecord[] {
  return contactsSnap;
}

/** 清洗账号输入：去 @ 前缀/空格，仅保留字母数字下划线中文等安全字符，限 20 字 */
function sanitizeHandle(raw: string): string {
  return raw.replace(/@+/g, '').replace(/\s+/g, '').slice(0, 20);
}

/** 机主默认账号（用户指定）：未自定义时始终显示 @qvq12345678 */
export const DEFAULT_USER_HANDLE = 'qvq12345678';

/** 由作者 key 确定性生成「字母+数字」随机账号（同 key 永远同值，刷新不变）。
 *  用户要求：除机主外其他作者的账号随机来（字母+数字，形如 kiko4820）。 */
export function randomHandle(key: string): string {
  // FNV-1a 播种 + LCG 伪随机（纯函数：同一 key 每次算出同一 handle）
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = (h ^ key.charCodeAt(i)) * 16777619;
  h = h >>> 0;
  const next = () => {
    h = (Math.imul(h, 1103515245) + 12345) >>> 0;
    return h / 4294967296;
  };
  const letters = 'abcdefghijkmnpqrstuvwxyz';
  const L = 4 + Math.floor(next() * 3); // 4~6 位字母
  let s = '';
  for (let i = 0; i < L; i++) s += letters[Math.floor(next() * letters.length)];
  const D = 3 + Math.floor(next() * 4); // 3~6 位数字
  const num = String(Math.floor(next() * Math.pow(10, D))).padStart(D, '0');
  return s + num.slice(0, D);
}

// ---------------- NPC 头像库接入（avatar-library 随机分配） ----------------

/** 头像库基址：项目内置静态资源（public/avatar-library，与 GitHub 仓库 cczzff468/avatar-library 同步）。
 *  用本地静态文件而非 jsdelivr CDN：沙箱/部分网络环境下 CDN 会 301 到被墙的 raw.githubusercontent，
 *  本地直出零外部依赖、秒开；GitHub 仓库仍是规范图库源（批量更新时同步拷回 public）。 */
const AVATAR_LIBRARY_BASE = '/avatar-library';
/** 每类张数（与仓库保持同步）。flat = 用户上传的「默认+纯色系」头像（灰人形/灰圆/纯黑/纯白/灰渐变）
 *  ——分配给偶然没头像的网友 + 图片加载失败时的兑底，轮换使用不重样。 */
const AVATAR_LIBRARY_COUNTS: Record<string, number> = {
  anime: 100,
  catdog: 100,
  abstract: 100,
  male: 100,
  female: 100,
  real: 100,
  flat: 5,
};
/** flat 池张数 */
export const FLAT_AVATAR_COUNT = 5;

/** FNV-1a 播种 + LCG 伪随机（与 randomHandle 同款；纯函数保证同一 NPC 每次渲染拿到同一头像） */
function avatarRng(key: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = (h ^ key.charCodeAt(i)) * 16777619;
  h = h >>> 0;
  return () => {
    h = (Math.imul(h, 1103515245) + 12345) >>> 0;
    return h / 4294967296;
  };
}

/** 男女倾向关键词（从网名 + 人设里推断，用于真人头像分性别配图） */
const FEMALE_HINTS = ['她', '女', '姐', '妹', '闺蜜', '化妆', '口红', '美甲', '裙子', '穿搭', '美妆', '追星', '追剧', '甜妹', '女孩', '妈咪', '宝宝', '减肥', '奶茶', '粉', '老婆口中的', '小仙女'];
const MALE_HINTS = ['他', '男', '哥', '弟', '兄弟', '哥们', '哥们儿', '健身', '篮球', '足球', '游戏', '键盘', '数码', '装机', '显卡', '打球', '抽烟', '喝酒', '搬砖', '程序员', '打工', '糙汉', '大兄弟', '男孩', '老哥'];

/** flat 池头像（用户上传：X 默认灰人形/灰底灰圆/纯黑/纯白/灰渐变）。
 *  按 key 确定性轮换——加载失败/未分配头像的作者稳定拿到其中一张，
 *  不同人拿到不同的，不再千篇一律同一张默认图（用户要求：轮换使用，不要老用那一个）。 */
export function flatAvatarFor(key: string): string {
  const next = avatarRng(`${key}::flat`);
  const idx = 1 + Math.floor(next() * FLAT_AVATAR_COUNT); // 1..5
  return `${AVATAR_LIBRARY_BASE}/flat/flat_${String(idx).padStart(3, '0')}.jpg`;
}

/** 给 NPC 分配头像库图片（随机但稳定：同一 key 永远同一张）。
 *  分布参考真实论坛生态：真人系 48%（按人设性别分男女池）、动漫 22%、猫狗 14%、抽象 10%、
 *  6% 纯色系 flat（默认头像/纯色头像——像真实平台里不设头像的那批人，用户指定）。 */
export function assignNpcAvatar(key: string, name: string, persona?: string): string {
  const next = avatarRng(key);
  const roll = next();
  let cls: string;
  if (roll < 0.06) cls = 'flat'; // 偶然有些人用默认头像和纯色头像（不再彩底首字）
  else if (roll < 0.28) cls = 'anime';
  else if (roll < 0.42) cls = 'catdog';
  else if (roll < 0.52) cls = 'abstract';
  else cls = 'real-photo'; // 真人系，下面再分性别

  if (cls === 'real-photo') {
    const text = `${name} ${persona ?? ''}`;
    const fem = FEMALE_HINTS.some((w) => text.includes(w));
    const mal = MALE_HINTS.some((w) => text.includes(w));
    // 都命中/都没命中 → 伪随机分性别；只有一类命中 → 用命中的
    if (fem && !mal) cls = 'female';
    else if (mal && !fem) cls = 'male';
    else if (next() < 0.5) cls = 'female';
    else cls = 'male';
    // 少部分真人系用混合 real 池（更丰富）
    if (next() < 0.18) cls = 'real';
  }
  const idx = 1 + Math.floor(next() * (AVATAR_LIBRARY_COUNTS[cls] ?? 100)); // 1..N（按类容量）
  const file = `${cls}_${String(idx).padStart(3, '0')}.jpg`;
  return `${AVATAR_LIBRARY_BASE}/${cls}/${file}`;
}

/** 按 key 解析作者（含 user/official/NPC/char）；未知 key 给占位。
 *  user：论坛内自定义资料（name/handle/avatar/bio）优先，未自定义跟随全局机主资料。 */
export function resolveAuthor(key: AuthorKey): ForumAuthor {
  if (key === 'user') {
    const fp = forumData().profile;
    const name = fp?.name?.trim() || ownerName || '我';
    // 账号默认 @qvq12345678（用户指定）；自定义后用自定义值
    const handle = sanitizeHandle(fp?.handle ?? '') || DEFAULT_USER_HANDLE;
    return {
      key,
      name,
      handle,
      avatar: fp?.avatar ?? ownerAvatar,
      bio: fp?.bio?.trim() || 'X论坛用户',
    };
  }
  if (key === 'official') {
    // 官方小助手也用随机字母+数字账号（用户要求：除机主外其他账号都随机）
    return { ...OFFICIAL_AUTHOR, handle: randomHandle('official') };
  }
  if (key.startsWith('npc:')) {
    const def = NPC_DEFS.find((n) => `npc:${n.id}` === key);
    if (def) {
      // v5：LLM 起的覆盖名优先（内置描述型名「电影院常驻嘉宾」等不再直接露出）；
      // persona 里的旧名同步替换，LLM 生成口吻跟着新身份走
      const ov = forumData().npcNames?.[def.id];
      const name = ov ?? def.name;
      const persona = ov
        ? def.persona.includes(def.name)
          ? def.persona.replaceAll(def.name, ov)
          : `${def.persona}你的网名叫「${ov}」，说话保持这个人的口吻和用语习惯。`
        : def.persona;
      return {
        key,
        name,
        // 随机字母+数字账号（用户要求；不再用固定英文 handle）
        handle: randomHandle(key),
        // 头像库随机分配（同一 NPC 永远同一张；加载失败 XAvatar 兜底 flat 纯色系池）
        avatar: assignNpcAvatar(key, name, persona),
        verified: def.verified,
        bio: def.bio,
        baseFollowers: def.followers,
        persona,
        ip: NPC_IPS[key.slice(4)],
      };
    }
  }
  if (key.startsWith('dyn:')) {
    // 动态虚拟网友（真实感网名池生成；resolveAuthor 直读数据层，无需缓存）
    const def = forumData().dynNpcs?.[key.slice(4)];
    if (def) {
      return {
        key,
        name: def.name,
        handle: randomHandle(key),
        // 头像库随机分配（同一网友永远同一张；加载失败 XAvatar 兜底 flat 纯色系池）
        avatar: assignNpcAvatar(key, def.name, def.persona),
        verified: def.verified,
        bio: def.bio,
        baseFollowers: def.followers,
        persona: def.persona,
        lang: def.lang,
        ip: def.ip,
      };
    }
  }
  if (key.startsWith('char:')) {
    const id = key.slice(5);
    const c = contactsSnap.find((x) => x.id === id);
    if (c) {
      const name = c.nickname || c.name;
      return {
        key,
        name,
        handle: randomHandle(key),
        avatar: c.avatar || null,
        bio: [c.occupation, c.region, c.persona].filter(Boolean).join(' · ').slice(0, 60) || 'X论坛用户',
        persona: [c.persona, c.background, c.expressStyle].filter(Boolean).join('；'),
      };
    }
  }
  return { key, name: '论坛用户', handle: randomHandle(key || 'unknown'), avatar: null };
}

/** 粉丝数展示值（v7 用户要求：正在关注/关注者默认 0）。
 *  机主/联系人/动态网友一律真实 0（不再造 320+联系人×180 这种公式假数）；
 *  仅保留内置认证大 V 的粉丝基数（蓝 V 人设的一部分）。 */
export function followersOf(key: AuthorKey): number {
  if (key.startsWith('npc:')) {
    const a = resolveAuthor(key);
    if (typeof a.baseFollowers === 'number') return a.baseFollowers;
  }
  return 0;
}

/** 我的「正在关注」展示数（始终跟随真实关注数，用户要求移除自定义） */
export function myFollowingCount(d: ForumData): number {
  return d.following.length;
}

// ---------------- 评论树（v7 楼中楼结构修复） ----------------

/** 帖子的精确父对象（parentId 语义）：replyToPost 优先（精确被回复的那条），
 *  旧数据/未落 replyToPost 的回退 replyTo（分组锚点）。null = 不是回复（独立帖）。 */
export function parentPostOf(p: ForumPost): ForumPost | undefined {
  const pid = p.replyToPost ?? p.replyTo;
  if (!pid) return undefined;
  return forumData().posts.find((x) => x.id === pid);
}

/** 回复对象显示名（动态）：始终从父帖作者取当前昵称——
 *  v7 修复：旧数据存死的 replyToName 在 NPC 被 LLM 改名后变成「从没出现过的人」
 *  （如占位名 plmm在线冲浪），一律改为动态解析。 */
export function replyTargetNameOf(p: ForumPost): string | null {
  if (p.replyTo === null && !p.replyToPost) return null;
  const parent = parentPostOf(p);
  if (parent) return resolveAuthor(parent.authorKey).name;
  return p.replyToName;
}

/** 评论树子节点：postId 的直属回复（一级评论或某条评论的直接回复）。
 *  v7 语义：parentId = replyToPost（缺省回退 replyTo）；直接回复主帖 → 挂在主帖下（一级）。 */
export function childRepliesOf(d: ForumData, postId: string): ForumPost[] {
  return d.posts
    .filter((p) => p.id !== postId && (p.replyToPost ?? p.replyTo) === postId)
    .sort((a, b) => a.createdAt - b.createdAt);
}

/** 帖子的全部子孙回复数（含多层楼中楼；操作行计数用） */
export function descendantCountOf(d: ForumData, postId: string, depth = 0): number {
  if (depth > 8) return 0; // 防环
  const kids = childRepliesOf(d, postId);
  return kids.reduce((n, k) => n + 1 + descendantCountOf(d, k.id, depth + 1), 0);
}

/** 保存论坛内自定义资料（局部合并；某字段传 undefined 即清除该字段、恢复跟随全局）。
 *  兼容清理：旧版本存过的「正在关注/关注者」自定义数一并移除（已改为跟随真实数据）。 */
export function saveForumProfile(patch: Partial<ForumProfile>): void {
  const d = forumData();
  const merged: Record<string, unknown> = { ...(d.profile ?? {}), ...patch };
  delete merged.followingCount;
  delete merged.followersCount;
  d.profile = merged as ForumProfile;
  saveForum({ ...d });
}

/** 全局机主资料快照（编辑资料页 placeholder/预览用：展示「未自定义时」的取值） */
export function ownerGlobalProfile(): { name: string; avatar: string | null } {
  return { name: ownerName || '我', avatar: ownerAvatar };
}

// ---------------- 工具 ----------------

let seq = 0;
export function uid(prefix: string): string {
  seq = (seq + 1) % 10000;
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}${seq}`;
}

/** X 风格相对时间：刚刚 / N分钟 / N小时 / 10月31日 / 2025年10月31日 */
export function relTime(at: number, now = Date.now()): string {
  const diff = Math.max(0, now - at);
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}分钟`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}小时`;
  const d = new Date(at);
  const md = `${d.getMonth() + 1}月${d.getDate()}日`;
  return d.getFullYear() === new Date(now).getFullYear() ? md : `${d.getFullYear()}年${md}`;
}

/** 数字缩写（用户要求：万→w、千→k，像真实网民写数据：3400 → 3.4k、
 *  1.2万 → 1.2w；小于 1000 原样；亿级保留亿） */
export function countShort(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) {
    const k = n / 1000;
    return `${k >= 10 ? Math.round(k) : Math.round(k * 10) / 10}k`;
  }
  if (n < 100_000_000) {
    const w = n / 10000;
    return `${w >= 100 ? Math.round(w) : Math.round(w * 10) / 10}w`;
  }
  return `${Math.round((n / 100_000_000) * 10) / 10}亿`;
}

/** 帖子展示点赞数（likes 数组 + 合成热度基数；用户要求：十几/几十/几百/几千/几万/几十万/几百万） */
export function likesOf(post: ForumPost): number {
  return post.likes.length + (post.likeBoost ?? 0);
}

/** 版块名（null = 今日热议） */
export function communityName(id: string | null): string {
  if (!id) return '今日热议';
  return COMMUNITY_DEFS.find((c) => c.id === id)?.name ?? '今日热议';
}

/** 某作者的帖子（按时间倒序） */
export function postsOf(d: ForumData, key: AuthorKey): ForumPost[] {
  return d.posts
    .filter((p) => p.authorKey === key)
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** 帖子的直接回复（按时间正序，thread 页用） */
export function repliesOf(d: ForumData, postId: string): ForumPost[] {
  return d.posts.filter((p) => p.replyTo === postId).sort((a, b) => a.createdAt - b.createdAt);
}

/** 列表可见性：被「不感兴趣/举报」隐藏 或 定时未到时间 → 不在 feed/主页/版块列表展示。
 *  thread 详情页不受影响（帖子数据仍保留）。 */
export function isPostVisible(p: ForumPost, now = Date.now()): boolean {
  if ((forumData().hiddenPosts ?? []).includes(p.id)) return false;
  if (typeof p.visibleAt === 'number' && p.visibleAt > now) return false;
  return true;
}

// ---------------- 热度分级（用户要求：点赞/浏览 十几/几十/几百/几千/几万/几十万/几百万） ----------------

/** 互动量档位（重尾分布：多数帖子冷清、少数爆款冲到几百万，像真实信息流）
 *  35% 十几~几十 / 28% 几百~几千 / 22% 几万 / 12% 几十万 / 3% 几百万 */
export function rollEngagement(): { likeBoost: number; views: number; reposts: number } {
  const r = Math.random();
  let likes: number;
  if (r < 0.35) likes = 10 + Math.floor(Math.random() * 85);          // 十几~几十
  else if (r < 0.63) likes = 100 + Math.floor(Math.random() * 9000);   // 几百~几千
  else if (r < 0.85) likes = 10_000 + Math.floor(Math.random() * 80_000); // 几万
  else if (r < 0.97) likes = 100_000 + Math.floor(Math.random() * 800_000); // 几十万
  else likes = 1_000_000 + Math.floor(Math.random() * 4_000_000);      // 几百万
  // 浏览量与点赞正相关（真实平台浏览 ≈ 点赞的 5~80 倍；小帖子也给个底量）
  const views = Math.max(80, Math.floor(likes * (5 + Math.random() * 75)));
  // 转推 ≈ 点赞的 2%~15%
  const reposts = Math.max(0, Math.floor(likes * (0.02 + Math.random() * 0.13)));
  return { likeBoost: likes, views, reposts };
}

// ---------------- dyn NPC 记忆（人设连通性） ----------------

/** 记录虚拟网友最近发过的内容（跨帖子连通：同一个人换个帖子能接上之前的话疸，
 *  如上一条抱怨试驾没车、下一条晒提车；只保留最近 3 条） */
export function recordDynNpcRecent(key: AuthorKey, text: string): void {
  if (!key.startsWith('dyn:')) return;
  const d = forumData();
  const npc = d.dynNpcs?.[key.slice(4)];
  if (!npc) return;
  npc.recent = [...(npc.recent ?? []), text.slice(0, 80)].slice(-3);
}

/** 把帖子加入隐藏名单（不感兴趣/举报）；幂等 */
export function hidePost(postId: string): void {
  const d = forumData();
  d.hiddenPosts = d.hiddenPosts ?? [];
  if (!d.hiddenPosts.includes(postId)) d.hiddenPosts.push(postId);
  saveForum({ ...d });
}

/** 投票：user 点选某选项（重复点同一项不叠加；换选项则迁移计数） */
export function castVote(postId: string, optionIndex: number): void {
  const d = forumData();
  const p = d.posts.find((x) => x.id === postId);
  if (!p?.poll) return;
  const poll = p.poll;
  while (poll.votes.length < poll.options.length) poll.votes.push(0);
  if (poll.voted === optionIndex) return; // 已投同项，忽略
  if (typeof poll.voted === 'number' && poll.voted >= 0) {
    poll.votes[poll.voted] = Math.max(0, poll.votes[poll.voted] - 1);
  }
  poll.votes[optionIndex] = (poll.votes[optionIndex] ?? 0) + 1;
  poll.voted = optionIndex;
  saveForum({ ...d });
}

/** 热门话题（#话题# 统计 + 兜底；X 搜索页风格） */
export function trendingTopics(d: ForumData): { tag: string; count: number }[] {
  const map = new Map<string, number>();
  for (const p of d.posts) {
    for (const m of p.content.matchAll(/#([^#\s]{1,12})#/g)) {
      const tag = m[1];
      map.set(tag, (map.get(tag) ?? 0) + 1);
    }
  }
  const list = [...map.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
  if (list.length >= 3) return list;
  const fallback = [
    { tag: '吃瓜现场', count: 12 },
    { tag: '明星动态', count: 9 },
    { tag: '追剧日常', count: 7 },
    { tag: '汽车俱乐部', count: 6 },
    { tag: '吐槽大会', count: 5 },
  ];
  return list.length ? list : fallback;
}
