/**
 * X论坛 · 话题锚定共享模块（客户端 engine 与服务端 generate 路由共用）。
 *
 * v14（用户反馈「评论区串台 + AI 废话极其严重」）核心规则落地：
 * 1. 上下文绝对锚定：先从帖子提取「核心话题词」（话题标签 + 命中的领域关键词），
 *    评论必须包含或呼应这些词才放行；
 * 2. 跨领域劫持拦截：评论携带与帖子毫不相干领域的强关键词（楼主聊熬夜看剧、
 *    评论却冒出装机/打工/试驾）→ 直接判定违规丢弃；
 * 3. AI 废话黑名单：「楼主说的太对了，我也是这么想的」「只有我一个人觉得」
 *    「笑死，真的是这样」以及纯附和/纯笑声组成的空评 → 一律作废。
 *
 * v15（用户反馈「应援色吵架帖下大量考研/图书馆/代拍评论」）判定漏洞封堵：
 * 1. 强关键词频次加分：同一强词在帖里出现 ≥2 次 → +1（真领域话题会被反复提起；
 *    「应援色」帖里应援×3 把追星 domain 顶到 4 分，压过顺带提及）；
 * 2. 道具降级扩充：追星帖里「专业得像论文开题」这类比喻用法不再让学习领域入场；
 *    学习领域删掉「学/考/书」单字弱词（「学会了」「考虑」「说明书」全部误触）；
 * 3. 话题词只取头部领域（最高分 + 第二名目 ≥3 分）——不再把每个顺带提及
 *    领域的强词都当成「核心话题词」喂给模型；
 * 4. 通用呼应词降权：「姐妹/家人们/哭/尖叫」这类跨领域情绪词单独出现不算
 *    强呼应——只靠通用词「呼应」+携带外部领域强关键词（考研/装机）→ 判串台。
 *
 * v25（用户反馈「江屿评论芋头保研帖：屿哥你最近有在剧里看到…三杯特调心疼到发抖」
 *  ——评论者人设道具泄漏 + 称呼错乱）三层拦截落地：
 * 1. personaBleedIn：称呼/名称泄漏检测——评论里出现评论者自己的网名，或
 *    「评论者网名尾字＋哥/姐等称谓」拼出的称呼（屿＋哥＝屿哥）且主帖没有
 *    这个称呼 → 作废（把评论者自己的名字安到楼主头上，主语错乱）；
 * 2. offTopicIn：领域私货检测——评论携带 ≥2 个「上下文（主帖＋被回复评论）
 *    领域之外」的领域关键词（跨 2 个域，或同域 ≥2 词）→ 串线作废
 *    （保研帖里的「剧里」＋「三杯特调」在这里拦下）；
 * 3. isFlamePost：引战/三观争议帖检测（举报抢名额/我不是坏心/小三/彩礼…）
 *    → 评论生成时注入「骂声一片」风向指令（真实互联网不会顺着这种楼主说话）。
 */

/** 话题领域定义：strong = 强关键词（单个命中记 2 分，判领域用）；
 *  weak = 弱关键词（记 1 分，需叠加）；echo = 呼应词表（评论包含即算
 *  「呼应了该领域」——锚定校验放行依据）；subject = {t} 槽位兜底话题词；
 *  demote = 道具降级规则：关键词在帖子中只以「道具/背景」方式出现
 *  （如追星发疯帖里的「跪着看手机」）且无真领域语境时，降为弱词计分。 */
export interface TopicDomain {
  id: string;
  label: string;
  subject: string;
  strong: string[];
  weak: string[];
  echo: string[];
  demote?: { kw: string; prop: RegExp; real: RegExp }[];
}

/** 15 个话题领域（覆盖信息流绝大多数帖子） */
export const TOPIC_DOMAINS: TopicDomain[] = [
  {
    id: 'drama',
    label: '剧影综',
    subject: '这剧',
    strong: ['追剧', '看剧', '剧荒', '大结局', '烂尾', '编剧', '男主', '女主', '剧情', '倍速', '弹幕', '剧透', '综艺', '电影', '影院', '电视剧', '新剧', '预告', '片尾', '台词', '名场面', '豆瓣', '二刷', '追完', '刷完', '女二', '男二', '番外', '完结', '春节档', '暑期档', '追平', '弃剧', '烂片'],
    weak: ['剧', '影', '追', '片', '集'],
    echo: ['剧', '集', '影', '片', '追', '结局', '更新', '烂尾', '编剧', '男主', '女主', '剧情', '台词', '镜头', '名场面', '倍速', '弹幕', '二刷', '综艺', '熬', '夜', '凌晨', '通宵', '睡', '失眠', '黑眼圈', '困', '上头', '后劲', '磕', '哭', '意难平', '这段', '那段', '前面', '后面', '几集', '主演', '配角', '演技', '颜值', '戏', '看完', '循环', '安利', '入坑', '不敢', '尖叫', '病房'],
  },
  {
    id: 'gossip',
    label: '吃瓜爆料',
    subject: '这瓜',
    strong: ['热搜', '爆料', '塌房', '恋情', '官宣', '辟谣', '反转', '出轨', '分手', '离婚', '绯闻', '同框', '拍到', '吃瓜', '声明', '代拍', '实锤', '石锤', '锤了', '保熟', '隐婚', '复出', '解约', '内娱', '小三', '劈腿', '黑料', '公关', '对家'],
    weak: ['瓜', '爆', '蹲', '锤'],
    echo: ['瓜', '热搜', '塌', '反转', '爆料', '辟谣', '拍到', '明星', '顶流', '恋情', '同框', '吃瓜', '蹲', '后续', '声明', '官宣', '站姐', '粉丝', '粉', '黑料', '锤', '剧', '影', '拍', '爆', '内娱', '公关', '对家', '路人', '现场', '坐等', '等一个', '真的假的', '细说', '求锤', '让子弹', '子弹', '反转', '瓜田'],
    // v15：「代拍」从呼应词表移除（用户点名串台词）——帖子没提代拍时，聊代拍的评论
    // 不再算「呼应了吃瓜领域」；帖子真提了代拍时 salientOverlap 实词重叠照样放行
  },
  {
    id: 'star',
    label: '追星',
    subject: '追星',
    strong: ['明星', '偶像', '爱豆', '本命', '追星', '演唱会', '应援', '站姐', '周边', '签售', '安可', '主唱', '直拍', '打投', '控评', '反黑', '营业', '同担', '小卡', '专辑', '回归', '打歌', '物料', '生图', '路透'],
    weak: ['追', '粉'],
    echo: ['星', '粉', '爱豆', '偶像', '塌', '瓜', '演唱会', '应援', '本命', '追星', '小卡', '专辑', '直拍', '舞台', '签售', '同担', '哥哥', '姐姐', '崽', '磕', '上头', '营业', '物料', '出图', '生图', '路透', '热搜', '官宣', '恋情', '哭', '尖叫', '姐妹', '家人们', '妈粉', '女友粉', '白嫖', '氪金', '排面', '控评', '门票', '抢票', '黄牛', '周边', '官方店'],
    // v15：「代拍」从呼应词表移除（用户点名串台词）——理由同上
  },
  {
    id: 'work',
    label: '打工职场',
    subject: '打工',
    strong: ['老板', '工资', '加班', '通勤', '辞职', '摸鱼', '周报', '开会', '同事', '甲方', '乙方', '上班', '打工', '绩效', 'kpi', 'KPI', '裁员', '领导', '入职', '离职', '试用期', '五险一金', '年终奖', '调休', '画饼', 'PUA', '职场', '实习', '月薪', '报销', '述职', '背锅', '裸辞', '社畜', '牛马', '工位'],
    weak: ['班', '工'],
    echo: ['班', '工', '老板', '工资', '加班', '通勤', '辞职', '摸鱼', '周报', '开会', '同事', '甲方', '乙方', '上班', '打工', '绩效', '裁员', '领导', '入职', '离职', '实习', '月薪', '职场', '画饼', '卷', '躺平', '摆烂', '裸辞', '副业', '早起', '熬夜', '凌晨', '困', '累', '班味', '工位', '带薪', '社畜', '牛马', '调休', '假期', '周末', '双休', '通勤', '地铁', '早起'],
  },
  {
    id: 'car',
    label: '车',
    subject: '这车',
    strong: ['试驾', '提车', '油耗', '手动挡', '自动挡', '4s', '4S', '加塞', '变道', '停车场', '科目', '刹车', '引擎', '声浪', '高速', '高架', '油门', '轮胎', '后备箱', '副驾', '驾驶', '司机', '堵车', '违章', '落地价', '车贷', '保养', '剐蹭', '倒车', '侧方', '山路', '跑山', '弯道', '马力', '零百', '底盘', '变速箱', '贴膜', '油站', '加油站', '充电桩', '续航', '方向盘', '自动泊车', '后视镜', '泊车', '挪车', '入库', '智能座舱', '座舱', '氛围灯', '新车'],
    weak: ['车', '油', '驾', '胎'],
    echo: ['车', '驾', '油', '胎', '堵', '提车', '试驾', '油耗', '手动挡', '自动挡', '加塞', '变道', '停车场', '刹车', '油门', '高速', '高架', '副驾', '司机', '落地', '优惠', '保养', '剐蹭', '倒车', '侧方', '山路', '跑山', '弯道', '零百', '底盘', '变速箱', '马力', '引擎', '声浪', '驾照', '新手', '老司机', '教练', '科目', '销售', '月供', '加油', '充电', '续航', '电车', '油车', '摩托', '本本', '方向盘', '泊车', '后视镜', '入库', '挪车', '自动启停', '红灯', '保险'],
  },
  {
    id: 'digital',
    label: '数码装机',
    subject: '这机子',
    strong: ['手机', '芯片', '跑分', '新机', '发布会', '显卡', '装机', '主板', '内存', '固态', '散热', '处理器', '帧数', '帧率', '游戏本', '显示器', '键鼠', '蓝牙', '快充', '系统更新', '闪退', '死机', '官翻', '碎屏', '等等党', '保值', '首发价'],
    weak: ['屏幕', '数码', '键盘', '电脑', '笔电'],
    echo: ['手机', '芯片', '跑分', '新机', '发布会', '显卡', '装机', '主板', '内存', '固态', '散热', '处理器', '帧数', '显示器', '键盘', '耳机', '蓝牙', '续航', '快充', '系统', '闪退', '死机', '售后', '屏幕', '碎屏', '贴膜', '壳', '充电', '电池', '发烫', '烫', '等等党', '首发', '降价', '保值', '回收', '真机', '上手', '激活', '电脑', '笔记本', '机子', '存储', '容量', '系统更新'],
    // 手机降级：只在「看/玩/刷手机」里当道具提及（无换机/配件/故障等真语境）→ 弱词
    demote: [{
      kw: '手机',
      prop: /[看玩刷收掏递把]手机/,
      real: /手机(壳|膜|屏|没电|摔|丢|卡|烫|坏|续航|充电|拍照|系统|信号|内存|电池|到货|上手|激活)|换手机|买手机|新手机|选手机|手机评测/,
    }],
  },
  {
    id: 'game',
    label: '游戏',
    subject: '这游戏',
    strong: ['排位', '上分', '开黑', '外挂', '新游', '副本', '赛季', '匹配', '队友', '游戏', 'steam', 'Steam', '吃鸡', '王者', '原神', '抽卡', '氪金', '零氪', '微氪', '手游', '端游', '五杀', '超神', '段位', '掉分', '连跪', '连胜', '炸服', '团本'],
    weak: ['游', '排'],
    echo: ['游戏', '排位', '上分', '开黑', '外挂', '新游', '副本', '赛季', '匹配', '队友', '抽卡', '氪金', '零氪', '手游', '端游', '五杀', '超神', '段位', '掉分', '连跪', '连胜', '吃鸡', '王者', '原神', '启动', '登录', '服务器', '炸服', '更新', '版本', '削弱', '加强', '策划', '官方', '攻略', '团本', '公会', '组队', '带上我', '菜', '菜鸡', '大佬', '带带', '娱乐模式', '车队', '摇人', '定级赛'],
  },
  {
    id: 'food',
    label: '吃喝',
    subject: '这家店',
    strong: ['外卖', '火锅', '奶茶', '宵夜', '下饭', '探店', '美食', '好吃', '难吃', '零食', '甜品', '咖啡', '咖啡因', '特调', '浓缩', '美式', '拿铁', '生椰', '瑞幸', '库迪', '挂耳', '手冲', '拉花', '烧烤', '点单', '餐厅', '等位', '菜单', '轻食', '炸鸡', '螺蛳粉', '蛋糕', '面包', '烘焙', '做饭', '下厨', '菜谱', '米其林', '大排档', '夜市摊'],
    weak: ['吃', '喝', '饿', '馋', '店', '饭', '菜', '厨'],
    // v25：咖啡细词补表（特调/浓缩/美式…）——主帖聊咖啡时这些是亲缘词放行；
    // 保研帖等不沾咖啡的帖子里出现「三杯特调」则被 offTopicIn 判为外来领域私货
    echo: ['吃', '喝', '饿', '馋', '店', '饭', '菜', '厨', '外卖', '火锅', '奶茶', '宵夜', '美食', '好吃', '难吃', '零食', '甜品', '咖啡', '咖啡因', '特调', '浓缩', '美式', '拿铁', '生椰', '瑞幸', '库迪', '挂耳', '手冲', '拉花', '豆子', '咖啡店', '烧烤', '餐厅', '排队', '等位', '菜单', '炸鸡', '螺蛳粉', '蛋糕', '面包', '做饭', '下厨', '菜谱', '锅', '煮', '炒', '蒸', '烤', '加辣', '香菜', '葱', '蒜', '辣', '酸', '甜', '咸', '烫', '热量', '卡路里', '胖', '减肥', '瘦', '斤', '饱', '馋了', '口水', '咽', '垫肚子', '深夜食堂'],
  },
  {
    id: 'pet',
    label: '宠物',
    subject: '毛孩子',
    strong: ['宠物', '铲屎', '猫粮', '狗粮', '拆家', '撸猫', '遛狗', '疫苗', '绝育', '流浪猫', '流浪狗', '猫猫', '狗狗', '主子', '猫砂', '化毛', '驱虫', '宠物医院', '布偶', '橘猫', '英短', '金毛', '柯基', '哈士奇', '二哈', '泰迪', '边牧', '掉毛', '领养', '罐头', '冻干', '猫条', '逗猫棒'],
    weak: ['猫', '狗', '毛', '爪', '喵', '汪', '吐'],
    echo: ['猫', '狗', '毛', '爪', '喵', '汪', '宠物', '铲屎', '猫粮', '狗粮', '拆家', '撸猫', '遛狗', '疫苗', '绝育', '猫猫', '狗狗', '主子', '猫砂', '宠物医院', '橘猫', '英短', '金毛', '柯基', '哈士奇', '二哈', '泰迪', '边牧', '洗澡', '掉毛', '毛孩子', '尾巴', '蹭', '舔', '咬', '挠', '呼噜', '宠物店', '领养', '罐头', '冻干', '猫条', '逗猫棒', '兽医院', '跑酷', '驱虫'],
  },
  {
    id: 'night',
    label: '深夜失眠',
    subject: '深夜',
    strong: ['失眠', '熬夜', '睡不着', '凌晨', '通宵', '深夜', '做梦', '惊醒', '天亮', '褪黑素', '多梦', '浅眠', 'emo', 'EMO', '网抑云'],
    weak: ['夜', '睡', '累', '孤独', '焦虑', '崩溃', '难过'],
    echo: ['失眠', '熬夜', '睡不着', '凌晨', '通宵', '深夜', '做梦', '惊醒', '天亮', '褪黑素', '睡', '夜', '困', '累', '孤独', '焦虑', '崩溃', '难过', '眼泪', '哭', '心累', '烦', '睡不醒', '早点睡', '别熬夜', '身体', '头发', '掉头发', '黑眼圈', '眼睛', '酸', '撑', '刷手机', '天花板', '胡思乱想', '想太多', '放空', '安慰', '抱抱', '白天', '晚上', '熬', '闭眼'],
  },
  {
    id: 'love',
    label: '恋爱暧昧',
    subject: '这段感情',
    strong: ['暗恋', '表白', '对象', '男朋友', '女朋友', '异地恋', '前任', '相亲', '脱单', '情侣', '老婆', '老公', 'crush', '心动', '初恋', '暧昧', '告白', '求婚', '结婚', '彩礼', '恋爱脑', '单身', '母胎solo', '官宣恋情', '纪念日', '异地', '约会', '恋爱'],
    weak: ['恋', '喜欢', '爱', '酒局', '外套', '香水'],
    echo: ['恋', '爱', '喜欢', '暗恋', '表白', '对象', '男朋友', '女朋友', '异地恋', '前任', '分手', '相亲', '脱单', '情侣', '老婆', '老公', 'crush', '心动', '初恋', '暧昧', '告白', '求婚', '结婚', '彩礼', '单身', '上头', '下头', '撩', '吃醋', '粘人', '安全感', '仪式感', '纪念日', '礼物', '牵手', '拥抱', '甜', '酸', '意难平', '白月光', '舔狗', '海王', '绿茶', '渣', '聊骚', '感情', '忽冷忽热'],
  },
  {
    id: 'fitness',
    label: '健身',
    subject: '训练',
    strong: ['健身', '减脂', '体脂', '深蹲', '卧推', '跑步机', '增肌', '健身房', '无氧', '有氧', '蛋白粉', '硬拉', '椭圆机', '力量训练', '马甲线', '腹肌', '瘦腿', '拉伸', '私教', '体测', '增重', '减重', '基代', '减脂餐', '鸡胸肉', '水煮', '西兰花', '体重秤', '体重'],
    weak: ['练', '肌肉', '重训'],
    echo: ['健身', '减脂', '体脂', '深蹲', '卧推', '跑步机', '增肌', '教练', '健身房', '体重', '无氧', '有氧', '蛋白粉', '硬拉', '椭圆机', '力量', '肌肉', '马甲线', '腹肌', '瘦', '胖', '斤', '公斤', '卡', '热量', '拉伸', '私教', '体测', '酸', '疼', '痛', '练', '组', '蛋白质', '鸡胸肉', '水煮', '自律', '坚持', '打卡', '身材', '围度', '体态'],
  },
  {
    id: 'study',
    label: '学习考证',
    subject: '学习',
    strong: ['考研', '背书', '图书馆', '自习', '刷题', '模拟考', '上岸', '导师', '论文', '答辩', '期末', '高考', '中考', '四六级', '雅思', '托福', '公考', '考编', '考公', '绩点', '保研', '推免', '挂科', '补考', '复习', '考点', '错题', '真题', '占座', '研友', '错题本'],
    // v15：删掉「学/考/书」单字弱词——「学会了」「考虑」「说明书」这类日常用语
    // 会给学习领域虚增 1 分，正好凑够 3 分入场门槛（应援色帖串台根因之一）
    weak: [],
    echo: ['考研', '背书', '图书馆', '自习', '刷题', '模拟考', '上岸', '导师', '论文', '答辩', '期末', '高考', '四六级', '雅思', '托福', '公考', '考编', '绩点', '保研', '挂科', '补考', '复习', '考点', '错题', '刷', '背', '默', '真题', '笔记', '进度', '占座', '早起', '打卡', '研友', '同学', '室友'],
    // v15 道具降级：「专业得像论文开题」这类比喻用法不算学习领域——
    // 只有真在写论文/答辩/查重的语境才算
    demote: [{
      kw: '论文',
      prop: /像论文|跟论文|比论文|论文(?:开题|一样)似的|专业得像/,
      real: /写论文|论文(?:查重|答辩|修改|致谢|选题|降重|被拒|写完|改到)|毕业论文|硕士论文|博士论文|开题报告|导师|参考文献|学术不端/,
    }],
  },
  {
    id: 'travel',
    label: '旅行',
    subject: '这趟',
    strong: ['旅行', '旅游', '攻略', '景区', '门票', '民宿', '酒店', '青旅', '特种兵', '自由行', '跟团', '值机', '登机', '行李箱', '黄金周', '自由行', '夜市', '古镇', '海边', '雪山', '日出', '夜爬'],
    weak: ['玩', '景', '游'],
    echo: ['旅行', '旅游', '攻略', '景区', '门票', '民宿', '酒店', '青旅', '特种兵', '自由行', '跟团', '出发', '高铁', '机场', '登机', '值机', '行李箱', '假期', '玩', '景', '拍照', '照片', '出片', '人山人海', '排队', '值得', '后悔', '预算', '花销', '机票', '火车', '大巴', '迷路', '导航', '日出', '日落', '海边', '雪山', '古镇', '夜市', '特产', '纪念品', '明信片', '季节', '人少', '性价比'],
  },
  {
    id: 'weather',
    label: '天气日常',
    subject: '今天',
    strong: ['下雨', '降温', '升温', '天气', '暴雨', '台风', '下雪', '初雪', '梅雨', '回南天', '桑拿天', '秋老虎', '倒春寒', '晚霞', '彩虹', '打雷', '闪电', '雾霾', '桂花', '换季', '入冬', '入夏', '入秋', '开春'],
    weak: ['风', '雨', '雪', '热', '冷', '晴', '被子', '晒被子'],
    echo: ['天气', '雨', '雪', '风', '晴', '阴', '热', '冷', '凉', '暖', '温度', '降温', '升温', '出门', '带伞', '晒', '太阳', '云', '天空', '晚霞', '日落', '日出', '彩虹', '打雷', '闪电', '雾', '空气', '湿度', '干燥', '潮湿', '桂花', '香', '气味', '味道', '春天', '夏天', '秋天', '冬天', '换季', '季节', '今天', '舒服', '惬意', '好天气', '回南天', '秋裤', '台风', '暴雨', '下雨'],
  },
];

/** 领域亲缘（跨领域强关键词只在与帖子领域沾亲时容忍——真正的判定
 *  仍交给「呼应校验」：不呼应照样作废） */
const DOMAIN_KIN: Record<string, string[]> = {
  drama: ['gossip', 'star', 'night', 'weather'],
  gossip: ['drama', 'star', 'night'],
  star: ['drama', 'gossip', 'night'],
  night: ['drama', 'gossip', 'star', 'work', 'study', 'game', 'digital', 'love', 'night'],
  work: ['night', 'study'],
  study: ['work', 'night'],
  car: ['digital', 'game', 'night'],
  digital: ['car', 'game', 'night'],
  game: ['digital', 'car', 'night'],
  food: ['pet', 'travel', 'weather', 'fitness'],
  pet: ['food'],
  travel: ['food', 'weather'],
  weather: ['food', 'travel', 'love', 'drama'],
  fitness: ['food', 'study'],
  love: ['night', 'gossip', 'drama', 'weather'],
};

/** 单字停用表：n-gram 片段含这些字不算「实词呼应」（的了我你/时间泛词等） */
const STOP_CHARS = new Set(
  '的了呢吧吗啊呀哦嘛么咯嘞我你他她它祂们是在和与跟就也都还又把被让给对没个点很太最更真这那个哪些怎么为什么因为所以但是而且如果虽然然后已经能够可以需要想要觉得感觉知道好像似乎大约可能一定必须什么今天昨天明天前天上午下午中午早上现在刚刚直接真的一个一下一点一直最后开始出来起来东西事情时候'.split(''),
);
/** 多字泛词表：出现在帖子与评论两侧也不算呼应（时间/连接/万能词） */
const STOP_WORDS = new Set(['今天', '昨天', '明天', '前天', '上午', '下午', '中午', '早上', '晚上', '现在', '刚刚', '真的', '感觉', '觉得', '时候', '什么', '怎么', '这样', '那样', '而且', '但是', '然后', '直接', '一个', '一下', '一点', '所有', '一直', '已经', '最后', '开始', '出来', '起来', '知道', '看到', '东西', '事情', '有没有', '不了', '不了', '哈哈哈哈', '哈哈哈哈哈']);

/** v15 通用呼应词统计：每个 echo 词出现在几个领域的 echo 表里。
 *  出现在 ≥2 个领域 = 跨领域通用词（姐妹/家人们/哭/热搜/蹲这类情绪/泛用词），
 *  单独命中只算「弱呼应」——救不了携带外部领域强关键词的串台评论。 */
const ECHO_WORD_DOMAIN_COUNT: Map<string, number> = (() => {
  const m = new Map<string, number>();
  for (const d of TOPIC_DOMAINS) {
    for (const w of d.echo) m.set(w, (m.get(w) ?? 0) + 1);
  }
  return m;
})();

/** v15 全局通用词：不管出现在几个领域的 echo 表里都是纯情绪/泛用词
 *  （姐妹/家人们——真实网友哪都说明，跟领域无关），单独命中一律算弱呼应。 */
const UNIVERSAL_ECHO = new Set(['姐妹', '家人们', '谁懂', '救命', '呜呜', '泪目', '破防', '笑死', '离谱', '无语', '好家伙', '妈呀', '天呐', '麻了', '服了']);

/** 判断一个呼应词是否为通用词（跨领域出现 或 全局情绪词）→ 弱证据 */
function isGenericEchoWord(w: string): boolean {
  return UNIVERSAL_ECHO.has(w) || (ECHO_WORD_DOMAIN_COUNT.get(w) ?? 0) > 1;
}

/** 计算帖子命中的各领域得分（强词 ×2 + 弱词 ×1，按不同词去重；
 *  弱词若是已命中强词的子串【工资→工、上班→班、追剧→剧】不重复计分——
 *  否则顺带提一句「工资」的追剧帖会被虚增成打工话题，串台评论漏进评论区）。
 *  v15 频次加分：同一强词在帖里出现 ≥2 次 → 再 +1（真领域话题会被反复提起，
 *  「应援色」帖里应援×3 把追星顶到 4 分，压过「像论文开题」的顺带提及）。 */
export function domainScores(content: string): { id: string; score: number }[] {
  const out: { id: string; score: number }[] = [];
  for (const d of TOPIC_DOMAINS) {
    let s = 0;
    const strongHits: string[] = [];
    for (const k of d.strong) {
      if (!k || !content.includes(k)) continue;
      // 道具降级：只以背景方式提及（追星帖里的「跪着看手机」）且无真领域语境 → 记 1 分
      const dm = d.demote?.find((x) => x.kw === k);
      if (dm && dm.prop.test(content) && !dm.real.test(content)) {
        s += 1;
        continue;
      }
      s += 2;
      // v15 频次加分：同一强词出现 ≥2 次 → +1（出现次数 = 分割段数 - 1）
      if (content.split(k).length >= 3) s += 1;
      strongHits.push(k);
    }
    for (const k of d.weak) {
      if (!k || !content.includes(k)) continue;
      if (strongHits.some((st) => st.includes(k))) continue; // 强词子串不重复计分
      s += 1;
    }
    if (s > 0) out.push({ id: d.id, score: s });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** 帖子的主要话题领域（得分 ≥3——单个强词的顺带提及【如追剧帖里一句
 *  「我一个月工资不多」】不构成话题领域，杜绝打工评论漏进追剧帖；
 *  不足则取最高分领域——由调用方决定） */
export function postDomains(content: string): string[] {
  const scores = domainScores(content);
  const ok = scores.filter((x) => x.score >= 3).map((x) => x.id);
  return ok.length ? ok : scores.slice(0, 1).map((x) => x.id);
}

/** 无高分配领域时的主领域判定（v14.2）：得分并列时取「关键词在帖子中
 *  出现最早」的领域——话题通常开篇就点题：「公司电梯遇到前任」是恋爱帖，
 *  后文顺带一句「低头看手机」不该把数码池拉进评论区。 */
export function dominantDomainId(content: string): string | null {
  const scores = domainScores(content);
  if (!scores.length) return null;
  const top = scores[0].score;
  const cands = scores.filter((x) => x.score === top);
  if (cands.length === 1) return cands[0].id;
  let bestId = cands[0].id;
  let bestPos = Infinity;
  for (const { id } of cands) {
    const d = TOPIC_DOMAINS.find((x) => x.id === id);
    if (!d) continue;
    let pos = Infinity;
    for (const k of [...d.strong, ...d.weak]) {
      if (!k) continue;
      const i = content.indexOf(k);
      if (i >= 0 && i < pos) pos = i;
    }
    if (pos < bestPos) {
      bestPos = pos;
      bestId = id;
    }
  }
  return bestId;
}

/** 提取帖子核心话题词（用户要求：生成评论前必须先提取）。
 *  = 话题标签 + 头部领域命中的强/弱关键词（去重，最多 8 个）。
 *  v15：只取头部领域（最高分领域 + 得分 ≥3 的第二名）——旧版把每个
 *  顺带提及领域的强词都当话题词（应援色帖里的「论文」「热搜」），
 *  模型拿到后被带偏；现在只喂真正的主话题词。 */
export function extractTopicWords(content: string): string[] {
  const words: string[] = [];
  const seen = new Set<string>();
  const push = (w?: string) => {
    if (!w || seen.has(w) || w.length < 1) return;
    seen.add(w);
    words.push(w);
  };
  const tags = content.match(/#([^#\s]{1,14})#/g) ?? [];
  for (const t of tags) push(t.replace(/#/g, ''));
  const scores = domainScores(content);
  // v15：头部领域 = 最高分 + 第二名（目 ≥3 分才入场——单个强词的顺带提及不算）
  const top = scores.filter((x, i) => i === 0 || x.score >= 3).slice(0, 2);
  for (const { id } of top) {
    const d = TOPIC_DOMAINS.find((x) => x.id === id);
    if (!d) continue;
    for (const k of d.strong) if (content.includes(k)) push(k);
    for (const k of d.weak) if (content.includes(k) && k.length >= 2) push(k);
    if (words.length >= 8) break;
  }
  return words.slice(0, 8);
}

// ---------------- AI 废话黑名单 ----------------

/** 纯附和/纯笑声 token：整条评论只由这些组成 = 空评（废稿） */
const FILLER_TOKENS = /^(?:[哈呵嘿]+|xswl|XSWL|笑死|乐|乐死|太真实了?|真实|太对了|对|对对|确实|没错|是的?呢?|是滴|同意|同感|深有(同感|体会)|受教了?|学到了?|说得好|说得对|说得太对|有道理|支持|顶|赞|好文|好帖|牛皮|nb|NB|666|绝了|离谱|牛|哇哦|天呐|救命)+[。!！~～，,、\s]*$/;

/** 短语级违禁（评论里出现即废稿——用户点名拉黑 + 同族句式） */
const BANNED_PHRASES: RegExp[] = [
  /楼主?(说的?|讲得|写得)?太对[了啦]/,
  /太对[了啦][。!！~～，,\s]*哈+/,
  /哈+[。!！~～，,\s]*(太对[了啦]|我也是)/,
  /我也是这么想[的得]/,
  /我也是这么觉得[的得]/,
  /只有我(一个?人)?觉得/,
  /只有我(一个?人)?认为/,
  /笑死[，,。!！~～\s]*(真的)?是?这样/,
  /真的?是这样[。!！~～，,\s]*$/,
  /说出了?我(一直)?不敢说的/,
  /说(得)?(太)?进(我的)?心坎/,
  /一整个共鸣/,
  /说进心坎里/,
  /完全(说|讲)到?我?心里/,
  /^(太对了|确实如此|真的是这样|是这样的)[。!！~～，,\s]*$/,
  /^(支持|有道理|深有体会|受教了|学到了|说得好)[。!！~～，,\s]*$/,
  /^(哈{2,}|哈哈[哈呵嘿]+)[。!！~～，,\s]*$/,
];

/** AI 废话判定：纯附和空评 或 命中黑名单短语 → true（废稿） */
export function isBannedFiller(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (FILLER_TOKENS.test(t)) return true;
  for (const re of BANNED_PHRASES) if (re.test(t)) return true;
  return false;
}

// ---------------- 评论锚定校验 ----------------

/** 评论与帖子是否共享「实词片段」（2~4 字连续片段、不含停用字/泛词） */
function salientOverlap(comment: string, post: string): boolean {
  const c = comment.replace(/[\s~～|｜·•]+/g, '');
  const p = post;
  for (let i = 0; i + 2 <= c.length; i++) {
    for (let len = 4; len >= 2; len--) {
      if (i + len > c.length) continue;
      const seg = c.slice(i, i + len);
      if (STOP_WORDS.has(seg)) continue;
      let ok = true;
      for (const ch of seg) {
        if (STOP_CHARS.has(ch)) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      if (p.includes(seg)) return true;
    }
  }
  return false;
}

/** 求助/求推荐帖标记（帖子侧） */
const POST_REQUEST_RE = /求推荐|求推|推荐一下|有没有.{0,8}(推荐|好看|好听)|剧荒|书荒|歌荒|安利|求个|求助|跪求|在线等|求下饭|求剧|求歌|求攻略|怎么选|哪个好|求避雷/;
/** 求助帖的回答标记（评论侧：推荐/同求/避雷天然算呼应——求什么答什么） */
const REPLY_REQUEST_RE = /同求|蹲一个|蹲蹲|马克|收藏|避雷|安利|听我的|去搜|推荐「|先看「|别看「|冲「/;

// ---------------- 万能句式黑名单（v22，用户明令禁止） ----------------

/** 万能句式（用户点名 + 同族变体）：「蹲后续」「这瓜保熟吗」「等一个下文」
 *  这类放在任何帖子下面都「成立」的句子 = 模板评论，一律废稿。
 *  仅两类帖子豁免（见 postAllowsCatchall）：
 *  1. 求助/求推荐帖（「蹲一个」是真实网友的回答方式，求什么蹲什么）；
 *  2. 真正未完结的爆料八卦帖（帖子明示事情没讲完，追问后续是真实反应）。 */
const UNIVERSAL_PHRASES: string[] = [
  '蹲一个后续', '蹲后续', '蹲下文', '蹲一个下文', '蹲蹲后续',
  '这瓜保熟', '瓜保熟', '保熟吗', '保熟了',
  '等一个下文', '等下文', '等一个后续', '等后续',
  '让子弹飞', '先让子弹飞',
  '前排吃瓜', '前排围观', '瓜子已备好', '瓜子已经备好', '小板凳已就位', '小板凳已经就位', '拿好小板凳', '搬好小板凳', '拿小板凳',
  '关注了等更新', '收藏了回头考古', '收藏先，回头考古', '收藏了等更新',
];

/** 评论是否命中万能句式（命中后是否废稿由 postAllowsCatchall 决定） */
export function universalPhraseIn(text: string): boolean {
  const t = text.replace(/\s+/g, '');
  return UNIVERSAL_PHRASES.some((p) => t.includes(p));
}

/** 帖子是否豁免万能句式：求助/求推荐帖（蹲一个=真实回答）或
 *  未完结的爆料八卦帖（吃瓜域命中 + 帖子明示事情没讲完） */
export function postAllowsCatchall(postContent: string): boolean {
  if (POST_REQUEST_RE.test(postContent)) return true;
  const scores = domainScores(postContent);
  const gossipish = scores.some((x) => x.score >= 3 && (x.id === 'gossip' || x.id === 'star'));
  const unfinished = /爆料|未完|还没完|后续呢|断更|吃到一半|锤了一半|事情没完|没讲完|刚开头|下回分解|还没结果/.test(postContent);
  return gossipish && unfinished;
}

/** 评论锚定校验（串台判定核心，v14；v15 通用呼应词降权）：
 *  0. AI 废话（黑名单/纯附和空评）→ 违规；
 *  1. 求助帖的回答（推荐/同求/避雷）→ 放行（求什么答什么）；
 *  2. 呼应校验：评论包含帖子的话题标签 / 核心话题词 / 领域专属呼应词，
 *     或与帖子共享实词片段 → 强呼应；仅命中「跨领域通用词」（姐妹/家人们/
 *     哭/热搜——多个领域 echo 表里都有的情绪/泛用词）→ 弱呼应，
 *     弱呼应救不了串台评论（见 3b）；
 *  3. 强呼应但携带 ≥2 个无关领域强关键词（重度串台）→ 仍违规；
 *  3b. 无强呼应（含仅通用词弱呼应）：评论里出现任何一个「帖子领域之外」
 *     的强关键词（考研/装机/打工……）= 串台，直接违规——
 *     「姐妹们我考研政治还没背完」这种靠通用词混进来的评论在这里拦下；
 *  4. 帖子一个领域都没命中（无从判定话题）→ 从宽放行。
 *  返回 false = 串台/废话，必须重新生成（走追问式兜底）。 */
export function commentAnchored(comment: string, postContent: string): boolean {
  if (isBannedFiller(comment)) return false;
  const post = postContent ?? '';
  if (!post.trim()) return true;
  const scores = domainScores(post);
  const hit = scores.filter((x) => x.score >= 3).map((x) => x.id);
  const hasDomains = hit.length > 0;
  // 求助帖回答放行
  if (POST_REQUEST_RE.test(post) && REPLY_REQUEST_RE.test(comment)) return true;
  // 呼应校验：话题标签 / 核心话题词 / 领域呼应词 / 实词片段
  let echoed = false;
  const tags = post.match(/#([^#\s]{1,14})#/g) ?? [];
  for (const t of tags) {
    if (comment.includes(t.replace(/#/g, ''))) {
      echoed = true;
      break;
    }
  }
  if (!echoed) {
    const topicWords = extractTopicWords(post);
    for (const w of topicWords) {
      if (w.length >= 2 && comment.includes(w)) {
        echoed = true;
        break;
      }
    }
  }
  // v15 呼应分两档：专属词 = 强证据；跨领域通用词（姐妹/凌晨/热搜…）= 弱证据，
  // 弱呼应可以放行无串台风险的评论，但救不了携带外部领域强关键词的串台评论
  let genericEcho = false;
  if (!echoed) {
    for (const id of hit) {
      const d = TOPIC_DOMAINS.find((x) => x.id === id);
      if (!d) continue;
      for (const w of d.echo) {
        if (!comment.includes(w)) continue;
        if (isGenericEchoWord(w)) {
          genericEcho = true; // 通用词：弱证据，继续找专属词
        } else {
          echoed = true; // 领域专属呼应词：强证据
          break;
        }
      }
      if (echoed) break;
    }
  }
  if (!echoed && salientOverlap(comment, post)) echoed = true; // 实词片段 = 强呼应
  // 领域亲缘集合（帖子领域 + 沾亲领域；无高分领域时取「并列最高分的全部领域」
  // ——真并列（手机摔了+前任送的）两个领域都算数，道具降级后的残分不算）
  const kin = new Set<string>();
  const kinBase = hit.length ? hit : scores.filter((x) => x.score === scores[0].score).map((x) => x.id);
  for (const id of kinBase) {
    kin.add(id);
    for (const k of DOMAIN_KIN[id] ?? []) kin.add(k);
  }
  // 评论各领域强关键词命中数（跨领域劫持浓度）
  const foreignStrong = new Map<string, number>();
  for (const d of TOPIC_DOMAINS) {
    let n = 0;
    for (const k of d.strong) if (k && comment.includes(k)) n += 1;
    if (n > 0) foreignStrong.set(d.id, n);
  }
  if (echoed) {
    // 强呼应成功：仍拦截「重度串台」（无关领域强关键词 ≥2 个——蹭着话题硬聊别的）
    for (const [id, n] of foreignStrong) {
      if (n >= 2 && !kin.has(id)) return false;
    }
    return true;
  }
  if (genericEcho) {
    // 仅通用词弱呼应（凌晨/姐妹/热搜…）：评论至少在帖子的情绪/话题空间里——
    // 但只要携带任何一个外部领域强关键词（考研/装机…）就是串台，直接拦截
    //（「姐妹们我考研政治还没背完」在这里拦下）
    for (const [id] of foreignStrong) {
      if (!kin.has(id)) return false;
    }
    return true;
  }
  // 无任何呼应：带「帖子领域之外」强关键词 = 纯串台
  //（同领域/亲缘领域的强词不算——话题词表没覆盖到的帖型不能把自家领域的评论误杀）
  for (const [id] of foreignStrong) {
    if (!kin.has(id)) return false;
  }
  return !hasDomains;
}

/** 兜底话题词（给池子 {t} 槽位与追问式兜底评论用）：
 *  话题标签 → 最高分领域 subject → 帖子首个实词片段。 */
export function topicAnchorOf(content: string): string {
  // 与 extractTopicWords 同口径：标签最长 14 字（v15：应援色之争的学术级吵架现场=13 字，
  // 旧版 {1,12} 匹配不到 → 锚点退化成领域词，追问式兜底评论的话题词不够准）
  const tag = /#([^#\s]{1,14})#/.exec(content)?.[1];
  if (tag) {
    // v15.1：长标签（>7 字）截到首个停用字为止——「应援色之争的学术级吵架现场」
    // →「应援色」；整条标签塞进兜底模板会让 15 条评论全是同一个 13 字开头，太机械
    if (tag.length > 7) {
      // v20.1：首个停用字若在 index 0/1（「赛道日基金两千一戒奶茶一个月」的「道」
      // 来自「知道」），截出来是「赛道日基」这种残词——跳过太靠前的停用字，
      // 找 index ≥2 的首个停用字再截；整条都没有 → 取前 7 字
      const chars = tag.split('');
      let cut = -1;
      for (let i = 2; i < chars.length; i++) {
        if (STOP_CHARS.has(chars[i])) {
          cut = i;
          break;
        }
      }
      const frag = cut >= 2 ? tag.slice(0, cut) : tag.slice(0, Math.min(7, tag.length));
      if (frag.length >= 2) return frag;
    }
    return tag;
  }
  const scores = domainScores(content);
  if (scores.length) {
    const d = TOPIC_DOMAINS.find((x) => x.id === scores[0].id);
    if (d) return d.subject;
  }
  // 首个实词片段（2~6 字、不含停用字）
  const c = content.replace(/[\s~～|｜·•，,。!！？?、：:；;\n]+/g, '|');
  for (const seg of c.split('|')) {
    for (let len = Math.min(6, seg.length); len >= 2; len--) {
      const frag = seg.slice(0, len);
      let ok = true;
      for (const ch of frag) if (STOP_CHARS.has(ch)) {
        ok = false;
        break;
      }
      if (ok && !STOP_WORDS.has(frag)) return frag;
    }
  }
  return '这事儿';
}

// v22：anchorCandidatesOf（追问式兜底评论的话题锚点候选池）已删——
// FOLLOWUP 万能句式模板池整池删除（用户明令「绝对禁止蹲后续/这瓜保熟吗/
// 等一个下文这类万能句式」），评论 100% 由大模型按当前帖子实时生成。

// ---------------- v25 防角色串线（Persona Bleed） ----------------

/** 通用称呼豁免：这些「字+称谓」组合是大众称呼，不是拿网友网名拼的，
 *  不能因为某位评论者网名里恰好有这个字就误杀 */
const GENERIC_TITLES = new Set([
  '大哥', '小哥', '老哥', '表哥', '哥俩', '哥们', '空姐', '大姐', '老姐',
  '姐妹', '学姐', '学长', '宝子', '老铁', '老妹', '兄弟', '哥们儿',
]);

/** 称呼/名称泄漏检测（v25 用户反馈「屿哥」称呼错乱的直接拦截）。
 *  postAuthorName = 楼主网名；commenterNames = 本批评论者网名。
 *  命中以下任一 → true（作废）：
 *  1. 评论里出现某位评论者自己的完整网名（真人评论不会自称网名——名字由
 *     系统展示在头像旁；「江屿你最近…」= 把自己当被回复对象，主语错乱）；
 *  2. 评论里出现「评论者网名尾字/尾二字＋哥/姐/妹/宝/爷/叔/酱/大大」拼出的
 *     称呼（屿＋哥＝屿哥），且主帖里没有这个称呼——楼主真在聊这位网友时除外。 */
export function personaBleedIn(comment: string, postAuthorName: string, commenterNames: string[]): boolean {
  const t = (comment ?? '').replace(/\s+/g, '');
  if (!t) return false;
  const owner = (postAuthorName ?? '').replace(/\s+/g, '');
  const titles = ['哥', '姐', '妹', '宝', '爷', '叔', '酱', '大大'];
  for (const raw of commenterNames ?? []) {
    const n = (raw ?? '').replace(/\s+/g, '');
    if (n.length < 2 || n === owner || owner.includes(n) || n.includes(owner)) continue;
    // ① 自称网名（评论里出现自己的完整网名）
    if (t.includes(n)) return true;
    // ② 网名片段拼称呼：屿哥 / 江屿哥 / Nana姐 …
    //    （楼主名里也含该字时无法区分「屿哥」叫的是谁 → 放行不误杀）
    const tails = [...new Set([n.slice(-2), n.slice(-1)])].filter(Boolean);
    for (const tail of tails) {
      if (tail.length === 1 && owner.includes(tail)) continue;
      for (const ti of titles) {
        const combo = `${tail}${ti}`;
        if (GENERIC_TITLES.has(combo)) continue;
        if (t.includes(combo) && !owner.includes(combo)) return true;
      }
    }
  }
  return false;
}

/** 领域私货检测（v25 用户反馈「保研帖评论里冒出剧里+三杯特调」）。
 *  context = 主帖正文（楼中楼时 = 被回复评论 + 主帖）。
 *  评论携带 ≥2 个「context 领域（含亲缘）之外」的领域关键词
 *  （跨 2 个外来域，或单一外来域 ≥2 词）→ true（串线作废）。
 *  单字弱词只在 context 完全不含该字时才计（「剧」在保研帖没出现，
 *  「在剧里看到」的「剧」即外来；追剧帖里「剧」是本域不计）。
 *  context 一个领域都没命中 → 从宽放行（无从判定）。
 *  v41（A3 修复）：弱领域帖（最高领域分 ≤2——「今天好累啊，奶茶都没心情喝」
 *  这类闲聊帖只弱命中一个领域）不再执行本拦截：网友安慰「上班累了吧，你们
 *  老板真行」提打工词是自然接话，旧版整条作废导致随手帖经常零评论、角色互动
 *  空转。强领域帖（保研/装机/追星，分数 ≥3）照拦——那里串台仍是硬伤。 */
export function offTopicIn(comment: string, context: string): boolean {
  const t = comment ?? '';
  const ctx = context ?? '';
  if (!t.trim() || !ctx.trim()) return false;
  // context 命中的全部领域（含低分顺带提及）+ 亲缘域
  const ctxScores = domainScores(ctx);
  const ctxDomains = new Set<string>();
  for (const s of ctxScores) ctxDomains.add(s.id);
  if (!ctxDomains.size) return false;
  // v41（A3）：弱领域帖从宽放行——最高领域分 ≤2 说明帖子没有明确话题阵地
  if (ctxScores.length && ctxScores[0].score <= 2) return false;
  for (const id of [...ctxDomains]) {
    for (const k of DOMAIN_KIN[id] ?? []) ctxDomains.add(k);
  }
  // 评论命中的外来领域（strong 计 1；≥2 字 weak 计 1；单字 weak 仅当 ctx 不含该字）
  let foreignDomains = 0;
  let foreignHits = 0;
  for (const d of TOPIC_DOMAINS) {
    if (ctxDomains.has(d.id)) continue;
    let n = 0;
    for (const k of d.strong) if (k && t.includes(k)) n += 1;
    for (const k of d.weak) {
      if (!k) continue;
      if (k.length >= 2 && t.includes(k)) n += 1;
      else if (k.length === 1 && t.includes(k) && !ctx.includes(k)) n += 1;
    }
    if (n > 0) {
      foreignDomains += 1;
      foreignHits += n;
    }
  }
  return foreignDomains >= 2 || (foreignDomains === 1 && foreignHits >= 2);
}

/** 引战/三观争议帖检测（v25：这类帖子真实评论区一定骂声一片，
 *  评论生成需注入「至少一半直接批评楼主」的风向指令）。
 *  特征：理直气壮的自私诉求（举报抢名额）＋绿茶话术（我不是坏心/我只是觉得）
 *  ＋三观炸裂话题（小三/彩礼防备/偏心/该不该分）。 */
const FLAME_POST_RE =
  /我不是坏心|我不是那个意思|我只是觉得|跟我(?:可)?没关系|你们(?:说|评评理).{0,10}(?:算|对|错|吗)|我(?:错|过分|小气|坏)了吗|我是不是.{0,6}(?:小气|过分|太坏)|举报(?:她|他|了)|名额顺延|翘了?(?:团建|课|班)|当?小三|彩礼.{0,10}(?:防|留|退|给)|防着我|道德绑架|重男轻女|偏心(?:我|弟弟|妹妹|哥|姐)|该不该分(?:手|)?|要不要分(?:手|)?|(?:劝|要)我分(?:手|)?/;

export function isFlamePost(content: string): boolean {
  return FLAME_POST_RE.test(content ?? '');
}

/** ============ v28 文艺/深情/表白类主帖 · 语境适配（用户反馈「语境错乱」） ============
 *  病例（用户实锤）：楼主帖「於我而言 你比星璀璨」（繁体＋文艺＋自拍配图，
 *  一条深情表白），AI 评论「救命……甜得我当场去世哈哈哈！家人们谁懂啊……
 *  笑死我了，楼主你俩锁死别出来放毒了 xswl」——
 *  ① 语境错乱：楼主在走心，评论在发癫（聒噪烂梗一股脑全塞）；
 *  ② 「锁死」「放毒」在普通网友语境里是阴阳怪气（这俩人锁死别祸害别人/
 *  别出来秀恩爱恶心大家），跟夸人「甜」完全两个极端；
 *  ③ 语料模板过载：AI 抓了「自拍＋情话」标签就调「单身狗看别人秀恩爱」
 *  刻板模板，逻辑和情绪彻底崩塌。
 *  修复：真实网友在走心帖下的反应是感动/吃狗粮（酸一下但祝福）/祝福/文艺接梗，
 *  绝不是杠精式烂梗刷屏——本组正则负责判定「帖子是不是走心帖」，
 *  loudMemeIn 负责判定「评论是不是聒噪烂梗」，两者同时命中 → 评论作废。 */

/** 走心帖·浪漫意象词（多字词，单字「星/月/你」绝不单独判定——
 *  「星巴克」「月亮不睡我不睡」这类生活/玩梗帖不能全军覆没）。
 *  同时收简繁两体（繁体深情文案是典型载体：於我而言/你比星璀璨）。 */
const TENDER_IMAGERY_RE =
  /璀璨|星河|銀河|银河|晚風|晚风|月色|月光|星光|山海|心动|心動|餘生|余生|浪漫|深情|邂逅|偏偏|溫柔|温柔|白月光|朱砂痣|眼裡|眼里|歲月|岁月|人間|人间|塵埃|尘埃|晚霞|落日|黄昏|黃昏|与你|與你|怦然|悸动|悸動|溫柔了|温柔了/;

/** 走心帖·表白/深情句式（喜欢/爱/想见/情书/余生指教…）。
 *  「你比」只在后接星月光璀璨等意象时算表白（你比他考得好是攀比不是深情）。
 *  「喜欢上」三字起即算——「喜欢上她/他/你」远多于「喜欢上网」这类老派
 *  说法；即便偶发误伤，后果只是该帖评论区暂时收敛网感，方向不会错。 */
const TENDER_CONFESSION_RE =
  /你比.{0,10}(?:星|月|光|璀璨|耀眼|溫柔|温柔|浪漫)|喜歡你|喜欢你|愛你|爱你|想見你|想见你|表白|告白|情書|情书|餘生請多指教|余生请多指教|喜歡上|喜欢上|心動了|心动了|寫給|写给|暗戀|暗恋|心儀|心仪/;

/** 走心帖判定：正文命中「浪漫意象词」或「表白句式」其一即可；
 *  mediaDesc（帖子配图描述，可缺省）一并并入检测——「深情文案＋自拍」
 *  组合里配图基调（情侣自拍/浪漫氛围）也是走心信号。
 *  刻意不收：求助/吐槽/挂人帖（isFlamePost 另有「骂声一片」风向指令），
 *  情绪基调是「深情/文艺/浪漫」，不是「愤怒/求助」。 */
export function isTenderPost(content: string, mediaDesc?: string): boolean {
  const text = `${content ?? ''}\n${mediaDesc ?? ''}`;
  if (!text.trim()) return false;
  if (TENDER_IMAGERY_RE.test(text)) return true;
  if (TENDER_CONFESSION_RE.test(text)) return true;
  return false;
}

/** 聒噪烂梗检测（v28：仅对「走心帖下的评论」生效——别处「笑死/xswl」
 *  是正常网感，走心帖下就是杠精发言）。
 *  用户明令禁用的：锁死、放毒、笑死、家人们谁懂啊、xswl；
 *  同族扩收：笑不活了/笑拉了/当场去世（甜得我当场去世式聒噪起手）。
 *  「放毒」只在走心帖语义下拦（美食帖「深夜放毒」是合法好梗，且美食帖
 *  根本不会命中 isTenderPost，双条件天然不会误伤）。 */
const LOUD_MEME_RE =
  /锁死|鎖死|放毒|xswl|XSWL|笑死|笑不活了|笑拉了|家人们谁懂|家人们，谁懂|當場去世|当场去世|甜得我.{0,6}(?:去世|没了)/;

export function loudMemeIn(comment: string): boolean {
  return LOUD_MEME_RE.test(comment ?? '');
}

/** ============ v44【防杠精安全锁】善意短帖 · 虚空索敌检测（用户实锤反馈） ============
 *  病例：楼主帖「总而言之你很可爱」＋一张写着「自拍」的图——极度简单、
 *  充满善意和夸奖；AI 评论「路人说句公道话也要被骂？这图就俩字哪可爱了，
 *  纯纯的P图吧！」——① 强行加戏：没人骂过任何人，AI 凭空捏造「被骂」剧情；
 *  ② 攻击性错位：善意自拍帖换来无差别输出（P图指控/阴阳怪气）。
 *  修复双保险：isBenignPost 判定「帖子是不是善意短帖」（生成时注入「评论区
 *  必须同样友好」指令），imaginaryEnemyIn 判定「评论是不是虚空索敌/无端攻击」
 *  （运行时过滤直接作废）——两者同时命中 = 杠精发言，废稿。 */

/** 善意短帖·信号词（夸奖/晚安/感谢/自拍分享——这种帖子下真实评论区都是善意） */
const BENIGN_POST_RE =
  /可爱|晚安|早安|午安|加油|生日快乐|想你|喜欢你|爱你|么么|抱抱|开心|幸福|好甜|谢谢|感谢|辛苦啦|辛苦了|自拍|素颜|美照|好美|好看|治愈|温柔|祝我|祝大家|祝你们|打卡|记录一下|记录今天|分享|好可爱|真可爱|最可爱|超可爱/;

/** 冲突/负面信号词（出现即说明帖子有争议点/槽点，评论区可以自由发挥——
 *  吐槽帖被怼是正常生态，不能误伤；单字「骂/吵/杠/喷」保留：被老板骂/吵死了
 *  这类倾诉帖本就不该按善意帖处理） */
const BENIGN_CONFLICT_RE =
  /骂|吵|杠|喷|戾气|开撕|撕逼|黑幕|塌房|劈腿|出轨|分手|报警|举报|破防|发疯|气死|无语|离谱|吐槽|避雷|踩雷|难吃|差评|差劲|失望|上当|离大谱|有病|神经病|脑残|烦死|倒贴|捞女|普信|下头|前任|渣男|渣女|坑人|骗人|绿茶|白莲/;

/** 善意短帖判定：内容简短（≤60 字）＋善意信号词＋零冲突词＋非引战帖。
 *  mediaDesc 含「自拍/合照」也算（配图语境加强善意判定）。 */
export function isBenignPost(content: string, mediaDesc?: string): boolean {
  const text = (content ?? '').trim();
  if (!text || text.length > 60) return false; // 长帖信息量大，评论区正常自由
  if (BENIGN_CONFLICT_RE.test(text)) return false;
  if (isFlamePost(text)) return false;
  if (BENIGN_POST_RE.test(text)) return true;
  return /自拍|合照|大头贴|素颜/.test(mediaDesc ?? '');
}

/** 虚空索敌/无端攻击检测（v44 防杠精）：脑补不存在的骂战剧情（公道话/被骂/
 *  洗地/帮说话）＋对善意内容的无端质疑指控（P图/照骗/装）＋主动引战起手
 *  （你们这些人/戾气/对线）——出现在「善意短帖」评论区 = 直接废稿。 */
const IMAGINARY_ENEMY_RE =
  /公道话|說句公道话|说句公道话|被骂|被噴|被喷|被怼|洗地|帮.{0,4}(?:说话|辩护|开脱)|路人(?:也|就|都).{0,8}(?:说|讲|看|有意见)|P图|P的吧|修图|照骗|滤镜脸|装什么|装可爱|装纯|加戏|戏精|加戏精|网暴|被网暴|戾气|对线|开喷|喷子|杠精|来杠|一群杠|键盘侠|道德高地|你们这群|你们这些人|谁骂你|谁喷你|骂什么|喷什么/;

export function imaginaryEnemyIn(comment: string): boolean {
  return IMAGINARY_ENEMY_RE.test(comment ?? '');
}

/** ============ v45 拿错剧本检测（用户实锤反馈：「懂瓜呱」机械降神） ============
 *  病例：用户评论「mua宝宝」（善意互动）→ 矩阵 NPC「懂瓜呱」（狗仔线人瓜主，
 *  口头禅「明天十点开团，L姓顶流，懂的都懂」）回复「实锤可爱，明天十点开团，
 *  L姓顶流，懂的都懂🔥」——身份模板无条件凌驾于语境之上：私人情感帖被强行
 *  编造成明星八卦预告（指令串台 / 拿错剧本 / 跨频道机械降神）。
 *  修复：检测狗仔预告/爆料模板的标志话术，出现在「善意短帖/走心帖」的
 *  评论区（无论一级评论、楼中楼还是楼层回复）＝ NPC 把自己的身份模板硬套
 *  到了与自己领域无关的帖子上 → 直接作废。爆料帖/世界观八卦帖里这些词是
 *  正当表达（isBenignPost/isTenderPost 判定天然不会命中），不会误伤。 */
const TABLOID_SCRIPT_RES: RegExp[] = [
  // 预告式开团：「明天(上午)十点开团」「明晚8点开团」——D社式定时爆料模板
  /(?:明天|今晚|明晚|后天|下周)[^。！？!?\n]{0,10}(?:十点|十点半|\d{1,2}\s*[点时](?:半)?|\d{1,2}:\d{2})[^。！？!?\n]{0,10}开团/,
  // 姓氏代号：L姓顶流 / W姓小花 / K姓主舞——狗仔只给代号的标志性写法
  /[A-Za-z]\s*姓[^。！？!?\n]{0,8}(?:顶流|男星|女星|小生|小花|爱豆|艺人|主舞|门面)/,
  // 塌房预告：顶流塌房 / 某男团要塌
  /(?:顶流|男星|女星|小生|小花|爱豆|艺人|本尊|某男团|某女团)[^。！？!?\n]{0,6}塌房/,
  // 机构名：D社 / 狗仔预告
  /D社|狗仔[^。！？!?\n]{0,6}预告/,
];

/** 弱标志（单独出现不足以定罪，须叠加另一个瓜圈词才算拿错剧本） */
const TABLOID_WEAK_RE = /懂的都懂/;
const TABLOID_ACCENT_RE = /开团|实锤|塌房|姓|瓜|爆料|后续|预告|对家|通稿/;

export function tabloidScriptIn(comment: string): boolean {
  const s = comment ?? '';
  if (!s) return false;
  if (TABLOID_SCRIPT_RES.some((re) => re.test(s))) return true;
  return TABLOID_WEAK_RE.test(s) && TABLOID_ACCENT_RE.test(s);
}

/** ============ v35 四大出戏问题修复（用户实锤反馈） ============
 *  病例（用户截图实锤）：
 *  ①「半糖去冰」「凌晨四点」「Lynn不在线」的评论直接显示
 *    {"thought":"主帖讲述…","comment":"楼主观察得好细致啊…"} 原始 JSON——
 *    服务端 JSON 解析失败走行拆兜底，整串 JSON 被当纯文本评论存库上屏；
 *  ②「巷口的…」的评论正文 = 【本帖核心话题词（每条评论至少呼应其一，
 *    帖里没提的领域一个字不许出现）】恋情、代拍、美式——写给模型的指令
 *    原文被模型当评论输出（严重幻觉）；
 *  ③ @凌晨四点的海 楼中楼四人接力复读「代拍太可怕了」——生成楼中楼时
 *    没有防复读约束，模型只能顺着上一句的词语无限复读；
 *  ④ 偷感爆料贴（偶遇 B 姓小生疑似恋情、楼主不敢拍照怕代拍）下评论
 *    清一色「好甜啊」「B哥好稳」——爆料语境网友第一反应是求锤/猜身份/
 *    蹲后续/粉丝心态，不是磕糖。
 *  修复：本组检测器 + 服务端 generate 路由全分支过滤 + 客户端双保险。 */

// ---------------- ① JSON 残留检测 ----------------

/** 评论正文含 JSON 结构残迹 → true（作废）。
 *  特征：对象起手 {"/数组起手 ["、`"字段名":` 键值对记号（thought/comment/
 *  like/content/topic/has_image 等本管线专用字段名）、对象间分隔 } , {、
 *  字符串转义 \n 居多、整串只剩 JSON 标点。
 *  真实评论绝不会写出 "thought": 或 {"（中文网友不用半角引号包键名）。 */
const JSON_LEAK_RE =
  /"\s*(?:thought|comment|like|content|topic|has_image|image_description|postId|reply|text)\s*"\s*:|\{\s*"|\[\s*\{|(?:\}|")\s*,\s*(?:\{|\[)|"\s*\}\s*"?|\\n|\\u[0-9a-fA-F]{4}/;
const JSON_ONLY_PUNCT_RE = /^[\s'"{}\[\],:]*$/;

export function jsonLeakIn(text: string): boolean {
  const t = text ?? '';
  if (!t.trim()) return false;
  if (JSON_ONLY_PUNCT_RE.test(t)) return true;
  return JSON_LEAK_RE.test(t);
}

// ---------------- ② 系统指令泄露检测 ----------------

/** 指令泄露·强特征（单发命中即作废）：本管线 system/user 消息里的原文片段 */
const PROMPT_LEAK_STRONG_RE =
  /【本帖核心话题词|每条评论至少呼应|帖里没提的领域|一个字不许出现|【本帖判定|只输出一个严格合法|输出格式铁律|严格合法的\s*JSON|JSON\s*数组|口吻参考·只学语气|杜绝历史污染|称呼规范】|绝对红线|视角降级|内部思考机制|thought（|（thought|「thought」|\{\{\w+\}\}|# Role|# Task|系统指令|System Prompt/i;

/** 指令泄露·弱特征（两个以上同时出现才作废，防误杀正常评论） */
const PROMPT_LEAK_WEAK_RES: RegExp[] = [
  /废稿/, /内部思考/, /输出格式/, /楼主情绪[：:]/, /视角[：:]\s*[/【[]/, /核心话题词/, /评论视角/, /铁律/, /占位符/, /mermaid|```/,
];

export function promptLeakIn(text: string): boolean {
  const t = text ?? '';
  if (!t.trim()) return false;
  if (PROMPT_LEAK_STRONG_RE.test(t)) return true;
  let weak = 0;
  for (const re of PROMPT_LEAK_WEAK_RES) if (re.test(t)) weak += 1;
  return weak >= 2;
}

/** 结构化泄露总闸（JSON 残留 ∨ 指令泄露）：全部评论管线第一道过滤 */
export function structuredLeakIn(text: string): boolean {
  return jsonLeakIn(text) || promptLeakIn(text);
}

// ---------------- ③ 复读机检测 ----------------

/** 字符 bigram 集合（中文 2 字滑窗——词序无关的词面重合度量） */
function bigrams(text: string): Set<string> {
  const t = (text ?? '').replace(/\s+/g, '');
  const out = new Set<string>();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
}

/** 最长公共连续子串长度（「楼主能忍住不拍」式整句复读的度量） */
function longestCommonRun(a: string, b: string): number {
  const A = (a ?? '').replace(/\s+/g, '');
  const B = (b ?? '').replace(/\s+/g, '');
  if (!A.length || !B.length) return 0;
  let best = 0;
  let prev = new Array<number>(B.length + 1).fill(0);
  for (let i = 1; i <= A.length; i++) {
    const cur = new Array<number>(B.length + 1).fill(0);
    for (let j = 1; j <= B.length; j++) {
      if (A[i - 1] === B[j - 1]) {
        cur[j] = prev[j - 1] + 1;
        if (cur[j] > best) best = cur[j];
      }
    }
    prev = cur;
  }
  return best;
}

/** 复读相似度（0~1）：bigram 重合率（以较短一方的 bigram 数为分母）。 */
export function parrotScore(reply: string, prev: string): number {
  const r = bigrams(reply);
  const p = bigrams(prev);
  if (!r.size || !p.size) return 0;
  let hit = 0;
  for (const g of r) if (p.has(g)) hit += 1;
  return hit / Math.min(r.size, p.size);
}

/** 复读判定：与上一句连续重合 ≥6 字（整句照抄级），或 bigram 重合 ≥0.5
 *  （「代拍太可怕了」→「代拍真的太可怕了」重合率 0.8+，正常接话 <0.3）。 */
export function isParrotReply(reply: string, prev: string): boolean {
  const r = (reply ?? '').trim();
  const p = (prev ?? '').trim();
  if (r.length < 3 || p.length < 3) return false;
  if (longestCommonRun(r, p) >= 6) return true;
  return parrotScore(r, p) >= 0.5;
}

// ---------------- ④ 爆料帖检测 + 磕糖甜评检测 ----------------

/** 吃瓜爆料帖·特征词（偶遇/偷拍/代拍/疑似恋情/神秘女/B姓顶流…）。
 *  与走心帖（isTenderPost）互斥方向：爆料帖情绪基调是「偷感+求锤」，
 *  不是「浪漫深情」——命中走心帖的爆料文案（罕见）由调用方先判走心。 */
const SCOOP_POST_RE =
  /偶遇|目击|偷拍|被拍|拍到|代拍|蹲一个|蹲后续|爆料|疑似.{0,8}(?:恋情|在一起|交往|领证)|神秘(?:女|男)(?:生|人)?|[BWXZLHMC]姓(?:顶流|小生|影后|女星|男星|艺人)|某(?:男|女)(?:星|生|艺人)|顶流|小生|塌房|恋情|绯闻|同框|吃瓜|瓜保熟|热圈|次次蹲/;

export function isScoopPost(content: string, mediaDesc?: string): boolean {
  const text = `${content ?? ''}\n${mediaDesc ?? ''}`;
  if (!text.trim()) return false;
  return SCOOP_POST_RE.test(text);
}

/** 磕糖甜评检测（爆料帖下情绪错位的「好甜/B哥稳」式评论；每帖限 1 条）。 */
const SWEET_SHIP_RE =
  /好甜|真甜|太甜|确实甜|超甜|齁甜|甜到|甜得|甜了|甜度|这么甜|磕到|磕死|嗑到|嗑死|我磕|好稳|真稳|[哥姐]稳|稳得|好讲究|真讲究|好配|太配|锁死|鎖死|这糖|糖我|甜妹|天作之合|双向奔赴|官宣吧|在一起吧|祝99|99呀/;

export function sweetShipIn(text: string): boolean {
  return SWEET_SHIP_RE.test(text ?? '');
}
