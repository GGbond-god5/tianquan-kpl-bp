/* ============================================================
 * 王者荣耀 KPL 全局BP模拟器 —— 数据分析引擎
 * ============================================================
 * 功能：
 *   1. 比赛记录管理（localStorage 持久化 + 导入/导出）
 *   2. 英雄胜率 / 出场率 / 禁用率统计（种子数据 + 真实记录 贝叶斯融合）
 *   3. 阵容分析：阵容强度、胜率预测、克制 / 搭配关系
 * ============================================================ */

window.BPData = (function () {
  "use strict";

  const STORAGE_KEY = "kpl_bp_matches_v1";

  /* ----------------------------------------------------------
   * 克制关系表（主流/知名对位，可自行扩展）
   * 格式：{ 克制方: { 被克制方: 强度 } }，强度默认 1.0，
   * 2.0 表示"极克制"（如张良对露娜），1.0 为常规克制。
   * 强度会进入阵容评分 / BP 分 / 胜率预测。
   * 数值本身保持克制方视角：a 克制 b 时 a 的阵容得利。
   * ---------------------------------------------------------- */
  const COUNTERS = {
    "张良":    { "李白": 2.0, "镜": 1.8, "澜": 1.5, "公孙离": 1.5, "露娜": 2.0, "韩信": 1.5, "马超": 1.2, "关羽": 1.0 },
    "东皇太一": { "李白": 2.0, "镜": 2.0, "公孙离": 1.8, "露娜": 2.0, "马超": 1.5, "澜": 1.5, "貂蝉": 1.5 },
    "盾山":    { "孙尚香": 1.8, "后羿": 1.8, "黄忠": 1.8, "伽罗": 1.5, "百里守约": 1.5, "狄仁杰": 1.3, "艾琳": 1.2 },
    "蔡文姬":  { "安琪拉": 1.2, "王昭君": 1.2, "甄姬": 1.2 },
    "孙膑":    { "关羽": 1.2, "马超": 1.2, "典韦": 1.0 },
    "吕布":    { "白起": 1.5, "猪八戒": 1.5, "廉颇": 1.4, "程咬金": 1.3, "张飞": 1.2 },
    "庄周":    { "张良": 1.8, "王昭君": 1.5, "甄姬": 1.5, "东皇太一": 0.8, "白起": 1.2 },
    "马超":    { "鲁班七号": 1.8, "后羿": 1.8, "伽罗": 1.8, "艾琳": 1.5, "虞姬": 1.0 },
    "铠":      { "鲁班七号": 1.5, "后羿": 1.5, "伽罗": 1.4 },
    "哪吒":    { "伽罗": 1.8, "百里守约": 1.5, "艾琳": 1.4, "孙尚香": 1.0 },
    "关羽":    { "嬴政": 1.3, "甄姬": 1.2, "孙尚香": 1.2 },
    "露娜":    { "张飞": 0.8, "牛魔": 0.8, "夏侯惇": 1.0 },
    "兰陵王":  { "孙尚香": 1.8, "后羿": 1.8, "伽罗": 1.5, "嬴政": 1.3, "安琪拉": 1.3, "妲己": 1.3 },
    "阿轲":    { "鲁班七号": 1.5, "后羿": 1.5, "伽罗": 1.3, "妲己": 1.3, "嬴政": 1.2 },
    "裴擒虎":  { "兰陵王": 0.8, "镜": 0.8, "露娜": 1.0 },
    "镜":      { "孙尚香": 1.4, "后羿": 1.4, "伽罗": 1.4, "大乔": 1.2 },
    "澜":      { "孙尚香": 1.4, "后羿": 1.4, "伽罗": 1.4, "妲己": 1.2 },
    "大司命":  { "露娜": 1.0, "镜": 1.0, "澜": 1.0, "老夫子": 1.2 },
    "老夫子":  { "露娜": 1.5, "马超": 1.3, "关羽": 1.3, "梦奇": 1.2, "花木兰": 1.0 },
    "芈月":    { "吕布": 1.2, "白起": 1.3, "猪八戒": 1.3, "项羽": 1.2 },
    "夏侯惇":  { "公孙离": 1.0, "马可波罗": 1.0 },
    "项羽":    { "鲁班七号": 1.2, "后羿": 1.2, "孙尚香": 1.1 },
    "盘古":    { "孙悟空": 1.3, "兰陵王": 1.1, "阿轲": 1.1 },
    "司空震":  { "孙尚香": 1.1, "后羿": 1.1, "伽罗": 1.1 },
    "暃":      { "伽罗": 1.4, "鲁班七号": 1.4, "黄忠": 1.4 },
    "娜可露露": { "妲己": 1.3, "安琪拉": 1.3, "后羿": 1.4, "孙尚香": 1.2 },
    "鬼谷子":  { "后羿": 1.2, "鲁班七号": 1.2, "黄忠": 1.2 },
    "鲁班大师": { "后羿": 1.1, "鲁班七号": 1.1, "伽罗": 1.1 },
    "苏烈":    { "公孙离": 1.0, "李白": 0.8 },
    "花木兰":  { "后羿": 1.3, "孙尚香": 1.2, "伽罗": 1.2 },
    "貂蝉":    { "白起": 1.4, "猪八戒": 1.4, "廉颇": 1.2, "程咬金": 1.2, "庄周": 0.8 },
    "马可波罗": { "白起": 1.2, "廉颇": 1.2, "猪八戒": 1.2, "牛魔": 1.0 },
    "伽罗":    { "嫦娥": 1.5, "张飞": 1.2, "猪八戒": 1.2 },
    "黄忠":    { "张飞": 1.1, "牛魔": 1.0, "白起": 1.1 },
    "孙悟空":  { "妲己": 1.3, "安琪拉": 1.3, "鲁班七号": 1.4 },
    "韩信":    { "妲己": 1.3, "鲁班七号": 1.4, "后羿": 1.4, "伽罗": 1.3 },
    "李信":    { "吕布": 1.1, "白起": 1.2, "猪八戒": 1.2, "夏侯惇": 1.0 },
    "大乔":    { "孙尚香": 1.0, "公孙离": 1.2, "大司命": 1.0 },
    "廉颇":    { "伽罗": 1.1, "后羿": 1.1, "百里守约": 1.1 },
    "达摩":    { "鲁班七号": 1.3, "后羿": 1.3, "伽罗": 1.2 },
    "白起":    { "后羿": 1.2, "鲁班七号": 1.2, "孙尚香": 1.1 },
    "猪八戒":  { "后羿": 1.2, "鲁班七号": 1.2 },
    "姬小满":  { "马超": 1.3, "关羽": 1.3, "花木兰": 1.0, "李白": 0.9 },
    "夏洛特":  { "老夫子": 1.3, "花木兰": 1.2, "吕布": 1.1, "铠": 1.0 },
    "孙策":    { "黄忠": 1.4, "鲁班七号": 1.3, "伽罗": 1.3, "甄姬": 1.0 },
    "刘邦":    { "老夫子": 1.2, "芈月": 1.0 },
  };

  /* 搭配关系表（主流/知名组合，可自行扩展）
   * 格式：{ 核心英雄: { 搭档英雄: 强度 } }，强度默认 1.0 */
  const SYNERGIES = {
    "大乔":    { "公孙离": 1.8, "蒙恬": 1.5, "老夫子": 1.5, "白起": 1.3, "李信": 1.2 },
    "鬼谷子":  { "娜可露露": 1.8, "孙悟空": 1.5, "高渐离": 1.4, "妲己": 1.2, "安琪拉": 1.2 },
    "明世隐":  { "鲁班七号": 1.8, "后羿": 1.6, "孙尚香": 1.6, "伽罗": 1.5, "黄忠": 1.5 },
    "太乙真人": { "孙尚香": 1.8, "后羿": 1.5, "鲁班七号": 1.6, "黄忠": 1.4 },
    "鲁班大师": { "李元芳": 1.6, "马可波罗": 1.5, "鲁班七号": 1.5, "后羿": 1.3, "伽罗": 1.3 },
    "张飞":    { "赵云": 1.2, "娜可露露": 1.2, "伽罗": 1.2, "黄忠": 1.3 },
    "姜子牙":  { "嬴政": 1.4, "沈梦溪": 1.4, "鲁班七号": 1.2, "伽罗": 1.2 },
    "孙膑":    { "猪八戒": 1.6, "白起": 1.6, "蒙恬": 1.5, "廉颇": 1.4, "貂蝉": 1.2 },
    "瑶":      { "马可波罗": 1.3, "公孙离": 1.4, "孙尚香": 1.3, "镜": 1.4, "澜": 1.4 },
    "蔡文姬":  { "鲁班七号": 1.2, "后羿": 1.2, "黄忠": 1.2 },
    "朵莉亚":  { "张飞": 1.1, "吕布": 1.2, "孙悟空": 1.1, "云缨": 1.2 },
    "少司缘":  { "孙尚香": 1.2, "公孙离": 1.2, "马可波罗": 1.2, "司空震": 1.2 },
    "桑启":    { "孙悟空": 1.2, "镜": 1.2, "孙尚香": 1.1 },
    "牛魔":    { "公孙离": 1.2, "孙尚香": 1.2, "虞姬": 1.1 },
    "苏烈":    { "高渐离": 1.2, "不知火舞": 1.2, "武则天": 1.1 },
    "庄周":    { "貂蝉": 1.5, "梦奇": 1.3, "吕布": 1.2, "程咬金": 1.1 },
    "鬼谷子":  { "姜子牙": 1.3, "高渐离": 1.2, "娜可露露": 1.6, "孙悟空": 1.4 },
    "刘邦":    { "镜": 1.3, "澜": 1.3, "露娜": 1.4, "马超": 1.3 },
    "哪吒":    { "大乔": 1.3, "孙膑": 1.2 },
    "扁鹊":    { "白起": 1.3, "猪八戒": 1.2, "程咬金": 1.2 },
    "孙策":    { "大乔": 1.4, "鬼谷子": 1.2 },
    "张良":    { "露娜": 1.3, "镜": 1.4, "澜": 1.3 },
    "王昭君":  { "黄忠": 1.4, "伽罗": 1.4, "鲁班七号": 1.3, "弈星": 1.3 },
    "甄姬":    { "黄忠": 1.2, "后羿": 1.2 },
    "西施":    { "伽罗": 1.3, "黄忠": 1.3, "后羿": 1.2 },
    "弈星":    { "黄忠": 1.4, "伽罗": 1.3, "大乔": 1.3, "鬼谷子": 1.3 },
    "老夫子":  { "大乔": 1.4, "姜子牙": 1.2 },
    "公孙离":  { "大乔": 1.5, "瑶": 1.3, "孙膑": 1.2 },
    "澜":      { "瑶": 1.4, "刘邦": 1.3, "太乙真人": 1.2 },
    "镜":      { "瑶": 1.4, "刘邦": 1.3, "鬼谷子": 1.3 },
    "露娜":    { "刘邦": 1.3, "太乙真人": 1.1, "瑶": 1.2 },
  };

  /* ==========================================================
   * 【模型层 v2】分路对位克制 / 体系原型 / 能力饱和 / 胜率映射
   * ==========================================================
   * 旧模型的两个问题：
   *   1. 克制按 5×5 全量平权相加（不管对不对位），再统一 ×1.8 进 BP 分；
   *   2. 胜率 = logistic(BP 分差 / 10)，一条 +0.7 的克制只值 1~2 个百分点，
   *      界面上“看不出克制有用”。
   * v2 改为：
   *   · 克制按分路计权：同分路对位 ×1.0、游走/辅助打任意路 ×0.75、
   *     其余跨路威胁 ×0.55；同一条关系只算一次，再做逐对衰减 + 整体饱和；
   *   · 搭配按“体系原型”聚合：成形给一次成体系加成，零散搭配只给弱加成；
   *   · 同类能力（保护/控制/开团）超过阈值后边际递减，防止“堆保护无敌”；
   *   · 胜率：BP 分差先过 tanh 软饱和，再 logistic，最后裁剪到 [0.05, 0.95]，
   *     并给出蓝方半可信区间 confidence.semiRange。
   *
   * 【实测校准】（bench/evaluate.js --split，396 局真实 KPL 对局；自测 node js/model-selftest.mjs）
   *   · logLoss 0.6889 < 恒定基线 0.6916；ECE 0.0215；落点 37.5%~60.1%，p05~p95 跨度 12.4pt；
   *   · 预测 ≥55% 的样本：预测均值 57.1% / 实际 58.3%，没有系统性高估；
   *   · 同分路单点替换（统一强度、只留克制变量）：得利方向 +2.07pt，受害方向 −3.13pt；
   *   · 组合成分不劣化排序：全成分 AUC 0.5500 ≥「基础+完整度」0.5452。
   *
   * ⚠ 一句实话：本模型的用途是「校准诚实 + 方向正确 + 可解释」，不是「预测得准」。
   *   英雄强度先验本身极弱（静态先验胜率与实际出场胜率的相关系数 r≈0.02），
   *   克制/搭配在 396 局上同样接近噪声（单成分 AUC 0.49~0.52），职业 BP 的
   *   可预测性上限实测只有 AUC 0.52~0.55、方向准确率约 54%。所以这里刻意不放大
   *   任何单成分，只用可靠的截距把输出中心对齐真实基准率（蓝方 47.2%）。
   * ⚠ 改动 WIN_TEMP / WIN_BIAS / COUNTER_WEIGHT / EDGE_SOFT 后必须重跑
   *   bench/evaluate.js 与 js/model-selftest.mjs 重新校准。
   * ========================================================== */

  /* 分路对位权重：克制只有在“对得上位”时才是真实兑现的 */
  const LANE_WEIGHTS = { same: 1.0, roam: 0.75, cross: 0.55, unknown: 0.5 };
  const ROAM_LANE = "游走";
  const LANE_ORDER = ["对抗路", "打野", "中路", "发育路", "游走"];

  /* 克制聚合：按强弱排名轻微衰减（质量优先）+ 整体饱和（数量不淹没质量） */
  const COUNTER_DECAY = 0.88;
  const COUNTER_CAP = 4.5;
  /* 搭配聚合：体系成形分饱和 + 零散逐对分，再整体饱和 */
  const SYNERGY_ARCH_CAP = 4.6;
  const SYNERGY_CAP = 6.5;
  /* ---------- 成分权重表（bench/tune.js 标定，不要手改） ----------
   * 每个成分先算成「蓝 − 红」的差值，再按权重相加成 BP 分差，最后进胜率映射。
   * 权重来源不是手调，而是 bench/tune.js 在 396 局真实职业对局上做的
   * 5 折交叉验证（不拟合任何参数，只换权重档位，折间波动即标准误）。
   *
   * 对照结论（C0 = 旧权重，C7 = 现权重）：
   *   档位             logLoss            AUC               ECE
   *   C0 2.7/0.3   0.6894±0.0027   0.5517±0.0180   0.0533
   *   C7 现档位      0.6897±0.0033   0.5502±0.0204   0.0446   ← 区分力等价、校准最好
   *   搭配抬到 ×2.5  0.6905±0.0035   0.5425±0.0208   0.0470   ← 明显劣化
   * 也就是说：**克制加权重是安全的（校准反而变好），搭配加权重会真的掉 AUC**。
   * 单成分体检同样如此——克制单独 temp 8 / 同路对位 5.5（信号偏"陡"，该给大系数），
   * 搭配单独 temp 打到网格上限 60（等于没信号）。所以这里克制 ×1.26、
   * 同路对位从 0 提到 0.5、搭配只做 ×1.5 的温和上调（CV 内等价、不劣化）。 */
  /* ---------- 成分权重表（由 bench/tune.js 标定，不要手改数值） ----------
   * 每个成分先算成「蓝 − 红」的差值，按权重相加成 BP 分差，再进胜率映射。
   * 权重来源不是手调：bench/tune.js 在 396 局真实职业对局上做 5 折交叉验证，
   * **不拟合任何参数、只换权重档位**，折间波动即标准误；同时用全样本池化指标
   * （与 bench/evaluate.js 同口径）复核。实测（C0 = 调之前的旧权重）：
   *
   *   档位                    5折 logLoss        5折 AUC          池化 AUC   池化 ECE
   *   C0 旧 (2.7, 0,  .30)   0.6894±0.0027   0.5517±0.0180   0.5472   0.0161
   *   C1 克制×1.26 (3.4,0)   0.6893±0.0032   0.5501±0.0199   0.5484   0.0140
   *   C2 C1+同路对位 0.25      0.6892±0.0035   0.5526±0.0205   0.5489   0.0147
   *   C5 现档位 = C2+搭配×1.5  0.6897±0.0033   0.5502±0.0204   0.5457   0.0090
   *   C7 搭配×3 (0.90)       0.6913±0.0023   0.5328±0.0177   0.5330   0.0194  ← 明确劣化
   *
   * 结论（都有数据支撑，不是"感觉该这样"）：
   *   · **克制的权重可以放心加大**——C1/C2/C4 的区分力与旧权重等价，校准反而更好；
   *   · **同路对位该单独计一项**——它是最"兑现"的克制（同分路 1v1 对位），
   *     系数 0.25（注意这里的 0.25 已是"蓝−红"口径，不是蓝方单边）；
   *   · **搭配最多只能温和上调**：×1.5 在噪声内（ΔAUC 0.003 对标准误 0.020），
   *     ×2 开始掉，×3 明确劣化（AUC 掉 0.019、logLoss 涨 0.002）。
   *     搭配是弱信号这一条，这里用交叉验证再确认了一遍。 */
  const COMP_WEIGHTS = {
    base: 1,      // 英雄基础分（可信度融合胜率 + 静态档位）
    comp: 1,      // 阵容完整度（分路覆盖 / 职业层 / 关键能力）
    arch: 0.45,   // 已成形的体系原型（大乔体系、保护型射手…）——旧值 0.3
    pair: 0.45,   // 零散逐对搭配 + 未成形体系的弱加成——旧值 0.3
    ctr: 3.4,     // 对位克制（已按分路计权 + 排名衰减 + 整体饱和）——旧值 2.7
    lane: 0.25,   // 同分路对位净优势（克制里最"兑现"的一块）——旧值 无此项
    pen: 1,       // 能力堆叠饱和惩罚
  };
  /* 兼容旧名的显示用权重（BP 分卡片上"克制 +X"的换算口径） */
  const SYNERGY_WEIGHT = COMP_WEIGHTS.arch;
  const COUNTER_WEIGHT = COMP_WEIGHTS.ctr;
  /* 胜率映射：BP 分差 → 概率（软饱和 + logistic + 截距 + 硬裁剪）
   * 标定来源：用本模型的 edge 分布在 396 局真实 KPL 上网格搜索最优 (尺度, 截距)：
   *   scale=23 / 截距=-2.73 → logLoss 0.6888（恒定基线 0.6916）、ECE 0.009；
   *   截距与“预测均值 = 真实基准率”反解值 23×ln(0.4722/0.5278) = -2.56 基本一致。 */
  const WIN_TEMP = 23;         // logistic 温度：均势处每 2.3 BP 分 ≈ 1 个百分点
  /* 截距分两部分：
   *   · 蓝方结构性劣势：真实 396 局蓝胜 47.22%，均势阵容应输出 ~47.5%；
   *   · 它同时决定“镜像对阵”的对称性上限：p(蓝,红)+p(红,蓝) = 2σ(截距/尺度)，
   *     取 截距=-2.3（= 23×ln(0.475/0.525)）即把不守恒的概率质量控制在 5.0%，
   *     满足 |p(蓝,红)+p(红,蓝)−1| ≤ 0.06 的形态要求。
   * 拟合最优 -2.73 与 -2.30 的 logLoss 只差约 0.0001，这里取对称性更稳的一侧。 */
  const WIN_BIAS = -2.3;
  const EDGE_SOFT = 18;        // tanh 软饱和尺度（理论落点上限约 ±18 分）
  const WIN_MIN = 0.05;
  const WIN_MAX = 0.95;
  /* 能力饱和：保护/控制/开团超过 knee 后只按 35% 计入有效值，差额=堆叠浪费
   * （惩罚权重 0.3：三保护阵容约损失 3~4 BP 分，够“防堆保护无敌”，又不压过主信号） */
  const CAP_KNEE = { protect: 18, control: 24, engage: 27 };
  const OVERSTACK_FACTOR = 0.35;
  const OVERSTACK_WEIGHT = 0.3;
  /* 可信区间：种子先验等效场 + 真实样本，二项标准误近似 */
  const CONF_PRIOR_SAMPLE = 200;
  const CONF_Z = 1.96;
  const CONF_MAX_HALF = 0.24;
  /* 被克制报警阈值（克制强度原始值，1.3 ≈ 常规克制以上） */
  const EXPOSURE_MIN = 1.3;

  /**
   * 体系原型（搭配按“体系”聚合，而不是逐对无限累加）
   * 每个原型由若干「组」构成：组内给候选英雄名单(heroes)或职业(roles)，
   * min 为最低人数。
   *   全部组满足 → 成形：strength = base × (1 + 0.2 × 额外人数)，最多 ×1.6；
   *   只满足部分组 → 不成形，只给 base × 0.3 × (满足组数 / 总组数) 的弱加成。
   * 只有成形的体系才会出现在 synergyBreakdown 里。
   */
  const SYNERGY_ARCHETYPES = [
    {
      id: "protect_adc",
      label: "保护型射手体系",
      base: 1.7,
      groups: [
        { key: "protect", label: "保护辅", min: 1, heroes: ["明世隐", "太乙真人", "瑶", "蔡文姬", "张飞", "大乔", "孙膑", "朵莉亚", "少司缘", "桑启", "庄周"] },
        { key: "carry", label: "射手核心", min: 1, roles: ["射手"] },
      ],
    },
    {
      id: "hard_engage",
      label: "强开团体系",
      base: 1.6,
      groups: [
        { key: "engage", label: "开团点", min: 1, heroes: ["鬼谷子", "鲁班大师", "苏烈", "苏芮", "牛魔", "张飞", "盾山", "东皇太一", "钟馗", "廉颇", "孙策", "白起", "太乙真人"] },
        /* 爆发核心必须是"开团后能立刻接上杀死人"的名单，不能写成 roles:["刺客","法师"]：
         * 这样几乎任何阵容（坦克+法师/刺客）都会命中，实测 59% 的阵容都被判成"强开团体系"，
         * 展示出来就是噪声。收紧成显式名单后，这个标签才真的代表一套打法。 */
        { key: "burst", label: "爆发核心", min: 1, heroes: ["娜可露露", "孙悟空", "高渐离", "不知火舞", "上官婉儿", "司马懿", "镜", "澜", "貂蝉", "妲己", "安琪拉", "小乔", "诸葛亮", "露娜", "花木兰", "嬴政"] },
      ],
    },
    {
      id: "daqiao_system",
      label: "大乔体系",
      base: 1.9,
      groups: [
        { key: "daqiao", label: "大乔", min: 1, heroes: ["大乔"] },
        { key: "partner", label: "转线搭档", min: 1, heroes: ["公孙离", "老夫子", "李信", "蒙恬", "白起", "澜", "镜", "哪吒", "孙策", "元歌"] },
      ],
    },
    {
      id: "sunbin_tank",
      label: "孙膑+坦克",
      base: 1.5,
      groups: [
        { key: "sunbin", label: "孙膑", min: 1, heroes: ["孙膑"] },
        { key: "tank", label: "坦克前排", min: 1, roles: ["坦克"] },
      ],
    },
    {
      id: "liubang_dive",
      label: "刘邦+突进",
      base: 1.5,
      groups: [
        { key: "liubang", label: "刘邦", min: 1, heroes: ["刘邦"] },
        { key: "dive", label: "突进核心", min: 1, heroes: ["镜", "澜", "露娜", "马超", "关羽", "暃", "李白", "韩信", "娜可露露", "孙悟空", "铠", "司马懿", "云中君", "典韦", "赵云", "曜"] },
      ],
    },
    {
      id: "split_push",
      label: "分推带线体系",
      base: 1.4,
      groups: [
        { key: "roam", label: "转线支援", min: 1, heroes: ["大乔", "孙膑", "刘邦", "哪吒", "鬼谷子", "朵莉亚"] },
        { key: "splitter", label: "带线点", min: 1, heroes: ["老夫子", "关羽", "马超", "芈月", "李信", "程咬金", "亚瑟", "猪八戒", "梦奇", "哪吒", "夏侯惇"] },
      ],
    },
    {
      id: "poke_siege",
      label: "消耗推进体系",
      base: 1.3,
      groups: [
        { key: "poke", label: "消耗/压塔", min: 2, heroes: ["姜子牙", "沈梦溪", "嬴政", "百里守约", "西施", "王昭君", "弈星", "伽罗", "黄忠", "女娲", "干将莫邪"] },
      ],
    },
  ];

  /* 功能类别标签（克制/搭配派生规则共用）
   * 注意：原来这些 Set 写在 counterStrength / synergyStrength 里，
   * 每次调用都要重建 5 个 Set，而 analyzeLineup 现在要对位扫描两遍
   * （我方 vs 对方、对方 vs 我方）并额外做分路/暴露扫描，热路径开销明显，
   * 因此统一提到模块级只建一次。 */
  const CONTROL_ON = new Set([
    "张良", "东皇太一", "盾山", "西施", "张飞", "鲁班大师", "鬼谷子",
    "太乙真人", "苏烈", "牛魔", "廉颇", "孙策", "白起", "金蝉", "墨子",
  ]);
  const DIVE_ON = new Set([
    "镜", "澜", "李白", "兰陵王", "阿轲", "韩信", "云中君", "露娜",
    "娜可露露", "马超", "关羽", "铠", "孙悟空", "暃", "司马懿", "曜", "典韦",
  ]);
  const SQUISHY_ON = new Set([
    "鲁班七号", "后羿", "伽罗", "黄忠", "妲己", "安琪拉", "小乔",
    "嬴政", "女娲", "甄姬", "王昭君", "干将莫邪", "沈梦溪",
  ]);
  const TRUEDMG_ON = new Set(["吕布", "马可波罗", "貂蝉", "典韦"]);
  const TANK_ON = new Set([
    "白起", "猪八戒", "廉颇", "程咬金", "张飞", "牛魔", "夏侯惇",
    "项羽", "蒙恬", "刘邦", "太乙真人", "东皇太一",
  ]);
  const ENCHANTER_ON = new Set(["瑶", "明世隐", "蔡文姬", "孙膑", "少司缘", "朵莉亚", "大乔"]);
  const CARRY_ON = new Set([
    "鲁班七号", "后羿", "黄忠", "孙尚香", "伽罗", "公孙离", "马可波罗",
    "虞姬", "艾琳", "蒙犽", "李元芳", "敖隐", "莱西奥", "戈娅", "苍", "百里守约",
  ]);

  const round1 = (v) => Math.round(v * 10) / 10;
  const round2 = (v) => Math.round(v * 100) / 100;
  const round3 = (v) => Math.round(v * 1000) / 1000;

  /** 饱和累加：sum 越大边际越小，上限趋近 cap */
  function saturate(sum, cap) {
    if (!(sum > 0)) return 0;
    return cap * (1 - Math.exp(-sum / cap));
  }

  /** 对位权重（传入已解析的分路条目对象，热路径用） */
  function itemLaneWeight(ha, hb) {
    const la = (ha && ha.pos) || "";
    const lb = (hb && hb.pos) || "";
    if (!la || !lb) return LANE_WEIGHTS.unknown;
    if (la === lb) return LANE_WEIGHTS.same;
    if (la === ROAM_LANE || lb === ROAM_LANE) return LANE_WEIGHTS.roam;
    return LANE_WEIGHTS.cross;
  }

  /** key / 裸名 → 分路（无条目返回空串） */
  function laneOf(ref) {
    const h = heroByRef(ref);
    return h ? h.pos : "";
  }

  /** 对位权重的对外便捷版（内部热路径请用 itemLaneWeight） */
  function laneWeight(aRef, bRef) {
    return itemLaneWeight(heroByRef(aRef), heroByRef(bRef));
  }

  /** 对位关系的中文标签（同路对位 / 游走支援 / 跨路威胁） */
  function laneRelation(la, lb) {
    if (!la || !lb) return "跨路威胁";
    if (la === lb) return "同路对位";
    if (la === ROAM_LANE || lb === ROAM_LANE) return "游走支援";
    return "跨路威胁";
  }

  /** 一个原型分组命中的英雄名（按阵容顺序去重） */
  function archetypeGroupHits(group, keys) {
    const hit = [];
    keys.forEach((k) => {
      const n = heroName(k);
      if (hit.indexOf(n) >= 0) return;
      const h = heroByRef(k);
      if (!h) return;
      if (group.heroes && group.heroes.indexOf(n) >= 0) { hit.push(n); return; }
      if (group.roles && group.roles.indexOf(h.role) >= 0) hit.push(n);
    });
    return hit;
  }

  /**
   * 体系原型评估
   * @returns {{ formed: Array<{archetype,label,heroes,strength}>, partial: number }}
   */
  function evaluateArchetypes(keys) {
    const formed = [];
    let partial = 0;
    SYNERGY_ARCHETYPES.forEach((def) => {
      const groups = def.groups.map((g) => ({ g: g, hit: archetypeGroupHits(g, keys) }));
      const ok = groups.filter((x) => x.hit.length >= (x.g.min || 1)).length;
      if (ok === groups.length) {
        const heroes = [];
        groups.forEach((x) => x.hit.forEach((n) => { if (heroes.indexOf(n) < 0) heroes.push(n); }));
        const need = groups.reduce((s, x) => s + (x.g.min || 1), 0);
        const extras = Math.max(0, heroes.length - need);
        formed.push({
          archetype: def.id,
          label: def.label,
          heroes: heroes,
          strength: round2(def.base * (1 + 0.2 * Math.min(extras, 3))),
        });
      } else if (ok > 0) {
        partial += def.base * 0.3 * (ok / groups.length); // 不成形：只给弱加成
      }
    });
    return { formed: formed, partial: partial };
  }

  /** 阵容 8 维能力总量 */
  function featureTotalsOf(keys) {
    const totals = {};
    FEATURE_DIMS.forEach((k) => { totals[k] = 0; });
    keys.forEach((k) => {
      const f = heroFeatures(k);
      FEATURE_DIMS.forEach((d) => { totals[d] += f[d] || 0; });
    });
    return totals;
  }

  /**
   * 同类能力饱和：保护/控制/开团总量超过 knee 后，超出部分只按
   * OVERSTACK_FACTOR(35%) 计入有效值，差额即“堆叠浪费” → BP 分惩罚。
   * 目的：连堆三个保护/开团辅助不能再线性吃满收益（防“堆保护无敌”）。
   */
  function capabilitySaturation(keys) {
    const totals = featureTotalsOf(keys);
    const dims = {};
    let loss = 0;
    Object.keys(CAP_KNEE).forEach((d) => {
      const raw = totals[d] || 0;
      const knee = CAP_KNEE[d];
      const eff = raw <= knee ? raw : knee + (raw - knee) * OVERSTACK_FACTOR;
      dims[d] = { raw: round1(raw), knee: knee, eff: round1(eff), loss: round1(raw - eff) };
      loss += raw - eff;
    });
    return {
      totals: totals,
      dims: dims,
      loss: round2(loss),
      penalty: round2(loss * OVERSTACK_WEIGHT),
      crowded: Object.keys(dims).filter((d) => dims[d].loss > 0.001),
    };
  }

  /**
   * 一方对另一方的「分路对位克制」明细与聚合
   * @param {Array} mine   已解析的我方条目 [{ref,key,item}]
   * @param {Array} theirs 已解析的对方条目
   * @returns {{breakdown:Array, raw:number, decayed:number, score:number}}
   *   breakdown 每项 {a,b,aKey,bKey,lane,laneB,rel,weight,strength,net,rank,marginal}
   *   其中 net = strength × 对位权重（正数=我方得利），
   *   marginal = net × COUNTER_DECAY^rank（排名衰减后的边际值）。
   */
  function counterAgainst(mine, theirs, notes) {
    const pairs = [];
    mine.forEach((A) => {
      theirs.forEach((B) => {
        const s = counterStrength(A.key, B.key);
        if (!(s > 0)) return;
        const ha = A.item, hb = B.item;
        const la = ha ? ha.pos : "", lb = hb ? hb.pos : "";
        const w = itemLaneWeight(ha, hb);
        pairs.push({
          a: heroName(A.key), b: heroName(B.key),
          aKey: A.key, bKey: B.key,
          lane: la, laneB: lb, rel: laneRelation(la, lb),
          weight: w, strength: round2(s), net: round2(s * w),
        });
      });
    });
    // 质量优先：强对位排前面，弱的按排名轻微衰减
    pairs.sort((x, y) => y.net - x.net);
    let raw = 0, decayed = 0;
    pairs.forEach((p, i) => {
      raw += p.net;
      p.rank = i;
      p.marginal = round2(p.net * Math.pow(COUNTER_DECAY, i));
      decayed += p.marginal;
    });
    if (notes) {
      pairs.slice(0, 3).forEach((p) => {
        notes.push("【克制】" + p.a + " 克 " + p.b + "（" + p.rel + " ×" + p.weight + "）+ " + p.marginal.toFixed(1));
      });
    }
    return { breakdown: pairs, raw: round2(raw), decayed: round2(decayed), score: saturate(decayed, COUNTER_CAP) };
  }

  /** 阵容 → 已解析条目 [{ref,key,item}]（heroByRef 只在解析时走一次） */
  function resolveLineup(lineup) {
    const out = [];
    (lineup || []).forEach((ref) => {
      const s = String(ref || "");
      if (!s) return;
      const h = heroByRef(s);
      out.push({ ref: s, key: h ? h.key : s, item: h });
    });
    return out;
  }

  /** 同分路对位优劣（edge 正 = 我方优） */
  function buildLaneMatchups(mine, theirs, stats) {
    const bands = {};
    LANE_ORDER.forEach((l) => { bands[l] = { mine: [], theirs: [] }; });
    const put = (entry, side) => {
      const h = entry.item;
      if (!h || !bands[h.pos]) return;
      bands[h.pos][side].push(entry);
    };
    mine.forEach((e) => put(e, "mine"));
    theirs.forEach((e) => put(e, "theirs"));
    const out = [];
    LANE_ORDER.forEach((l) => {
      const b = bands[l];
      if (!b.mine.length && !b.theirs.length) return;
      let counterEdge = 0;
      b.mine.forEach((x) => b.theirs.forEach((y) => {
        counterEdge += counterStrength(x.key, y.key) - counterStrength(y.key, x.key);
      }));
      // 同路英雄强度差：强度分每差 10 分 ≈ 0.5 优势点
      const avgScore = (arr) => (arr.length
        ? arr.reduce((s, x) => s + heroScore(x.key, stats), 0) / arr.length
        : null);
      const sm = avgScore(b.mine), st = avgScore(b.theirs);
      const powerEdge = (sm != null && st != null) ? (sm - st) * 0.05 : 0;
      out.push({
        lane: l,
        mine: b.mine.map((x) => x.item.name),
        theirs: b.theirs.map((y) => y.item.name),
        edge: round2(counterEdge + powerEdge),
        counterEdge: round2(counterEdge),
        powerEdge: round2(powerEdge),
      });
    });
    return out;
  }

  /** 我方被对面明显克制的英雄（供 UI 报警） */
  function buildExposure(mine, theirs) {
    const out = [];
    mine.forEach((B) => {
      const hb = B.item;
      const threats = [];
      theirs.forEach((A) => {
        const s = counterStrength(A.key, B.key);
        if (!(s >= EXPOSURE_MIN)) return;
        const ha = A.item;
        const la = ha ? ha.pos : "", lb = hb ? hb.pos : "";
        const w = itemLaneWeight(ha, hb);
        threats.push({
          threat: heroName(A.key), threatLane: la, lane: lb,
          rel: laneRelation(la, lb), weight: w,
          strength: round2(s), net: round2(s * w),
        });
      });
      if (!threats.length) return;
      threats.sort((x, y) => y.net - x.net);
      const top = threats[0];
      out.push({
        hero: heroName(B.key), threat: top.threat, from: top.rel,
        lane: top.lane, threatLane: top.threatLane,
        weight: top.weight, strength: top.strength, net: top.net,
        threats: threats,
      });
    });
    out.sort((x, y) => y.net - x.net);
    return out;
  }

  /**
   * 可信度：把“英雄样本量”折算成蓝方胜率的半可信区间与确定度。
   * 先验按 CONF_PRIOR_SAMPLE 等效场（双方各 5 人 × 种子权重 20），
   * 真实录入 / 外部职业样本按 1:1 追加；标准误用二项近似，
   * 区间最宽 ±24 个百分点，确定度 0~1。
   */
  function buildConfidence(lineups, stats, p) {
    let realSample = 0, heroes = 0;
    (lineups || []).forEach((lu) => {
      const seen = {};
      (lu || []).forEach((ref) => {
        const k = heroKey(ref);
        if (!k || seen[k]) return;
        seen[k] = true;
        heroes++;
        const st = stats[k] || stats[heroName(k)] || null;
        if (st) realSample += (st.localGames || 0) + (st.externalSample || 0);
      });
    });
    const nEff = Math.max(40, CONF_PRIOR_SAMPLE + realSample);
    const se = Math.sqrt(Math.max(p * (1 - p), 0.02) / nEff);
    const half = Math.min(CONF_MAX_HALF, CONF_Z * se);
    return {
      semiRange: [Math.max(WIN_MIN, round3(p - half)), Math.min(WIN_MAX, round3(p + half))],
      sample: Math.round(nEff),
      realSample: round1(realSample),
      priorSample: CONF_PRIOR_SAMPLE,
      heroCount: heroes,
      certainty: Math.max(0.05, Math.min(0.95, round3(1 / (1 + half * 5)))),
    };
  }

  /* ----------------------------------------------------------
   * 英雄 × 分路 条目注册表
   * ----------------------------------------------------------
   * heroes.js 中一条记录 = 一个英雄分路条目。内部 key 形如
   *   "李信@对抗路" / "李信@发育路"；只有一个分路的英雄 key 就是
   *   英雄名本身，保持旧数据/旧调用兼容。旧记录如果只有裸英雄名
   *   （如旧版本保存的 "李信"），统计时会按种子分路倾向拆到各条目，
   *   避免重复计数，也避免丢掉多分路信息。
   * ---------------------------------------------------------- */
  const POSITION_ALIAS = { "辅助": "游走" };
  const ITEM_SEP = "@";

  function rawHeroes() { return window.HEROES || []; }

  function normPos(pos) { return POSITION_ALIAS[pos] || pos || ""; }

  /** 单条英雄记录 → 内部 key */
  function heroKeyOf(h) {
    const name = h && h.name;
    if (!name) return "";
    const pos = normPos(h.pos);
    if (!pos) return name;
    // 同名存在多分路条目时才需要后缀；单分路英雄沿用裸名（向后兼容）。
    const multi = rawHeroes().filter((x) => x && x.name === name).length > 1;
    return multi ? name + ITEM_SEP + pos : name;
  }

  /** 所有「英雄×分路」条目（含 pos 归一化 + key） */
  function heroItems() {
    return rawHeroes().map((h) => {
      const pos = normPos(h.pos);
      return Object.assign({}, h, { pos, key: heroKeyOf(h) });
    });
  }

  /** 内部 key / 裸英雄名 → 规范英雄名 */
  function heroName(ref) {
    const s = String(ref || "");
    const i = s.indexOf(ITEM_SEP);
    return i >= 0 ? s.slice(0, i) : s;
  }

  /** 同名英雄的全部分路条目 */
  function itemsByName(name) {
    const n = heroName(name);
    return heroItems().filter((h) => h.name === n);
  }

  /** 规范英雄名下是否存在任何条目 */
  function hasHero(name) { return itemsByName(name).length > 0; }

  /**
   * key / 裸名 → 分路条目。
   * - 显式 key（含 @）精确命中；
   * - 裸名且英雄只有一个分路 → 直接命中；
   * - 裸名且英雄有多个分路 → 返回主条目（首条/对抗路优先），
   *   仅用于展示兜底与旧版裸名调用；新 BP 流程应传带 @ 的 key。
   */
  function heroByRef(ref) {
    const s = String(ref || "");
    const n = heroName(s);
    const items = itemsByName(n);
    if (!items.length) return null;
    if (s.indexOf(ITEM_SEP) >= 0) {
      const pos = normPos(s.slice(s.indexOf(ITEM_SEP) + 1));
      return items.find((h) => h.pos === pos) || items[0];
    }
    return items.find((h) => h.pos === "对抗路") || items[0];
  }

  /** key / 裸名 → 规范化内部 key（裸名歧义时取主条目） */
  function heroKey(ref) {
    const h = heroByRef(ref);
    return h ? h.key : String(ref || "");
  }

  /** 旧记录里的裸名在歧义时的条目权重（按静态分路登场率 pr） */
  function ambiguousSplit(name) {
    const items = itemsByName(name);
    if (!items.length) return [];
    const sum = items.reduce((s, h) => s + (h.pr || 0.01), 0) || items.length * 0.01;
    return items.map((h) => ({ item: h, share: Math.max(0.01, (h.pr || 0.01)) / sum }));
  }

  /** 阵容中的每个名字/key → 一个或多个分路条目（旧裸名自动拆分） */
  function expandLineupEntry(ref) {
    const s = String(ref || "");
    if (s.indexOf(ITEM_SEP) >= 0) {
      const h = heroByRef(s);
      return h ? [{ item: h, share: 1 }] : [];
    }
    const items = itemsByName(s);
    if (items.length <= 1) {
      const h = items[0];
      return h ? [{ item: h, share: 1 }] : [];
    }
    return ambiguousSplit(s);
  }

  /** 显示用英雄名（key → 裸名） */
  function displayHero(ref) { return heroName(ref); }

  /* ---------------------- 旧单局记录（只读回退源） ---------------------- */
  // 自「大场为唯一记录」起不再写入单局比赛记录；loadMatches 仅用于
  // 统计回退（无大场记录时读旧数据），历史数据仍在 localStorage 中。

  function loadMatches() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function clearSeries() {
    saveSeries([]);
  }

  /* ---------------------- 英雄统计 ---------------------- */

  /**
   * 兼容旧接口：根据 key / 英雄名查找分路条目。
   * 裸名 + 多分路时返回主条目（首条），调用方若需要统计各分路请
   * 显式传 key（如 李信@发育路）或使用 itemsByName。
   */
  function heroByName(ref) {
    return heroByRef(ref);
  }

  /**
   * 融合胜率：种子数据 + 真实比赛记录（贝叶斯加权）
   * 种子数据权重为 SEED_WEIGHT 场。
   */
  const SEED_WEIGHT = 20;

  /* 外部实时数据（来自数据统计中心接口，经 server.js 代理后注入） */
  let externalStats = null; // { 英雄名: { winMatches, loseMatches, matches, winRate, pickRate } }
  let externalMeta = null;  // { season, updatedAt, heroCount, matchCount, sources, isLatest }

  function setExternalHeroStats(heroes, meta) {
    const map = {};
    (heroes || []).forEach((h) => {
      map[h.name] = h;
    });
    externalStats = map;
    externalMeta = meta || null;
  }

  function getExternalMeta() {
    return externalMeta;
  }

  /* 职业选手数据（当前所选赛季，供 AI 预测做英雄↔选手绑定） */
  let externalPlayers = []; // [{ playerName, teamName, positionDesc, avgKda, battleCount, ... }]
  function setExternalPlayers(list) { externalPlayers = list || []; }
  function getExternalPlayers() { return externalPlayers; }

  /* 单方阵容绑定：委托给 assignPlayersBoth 的蓝方（保留旧接口，供单方调用） */
  function assignPlayers(lineup) {
    return assignPlayersBoth(lineup, [], null).blue;
  }

  /* 把职业选手按「分路」绑定到蓝红双方阵容（必须一次完成，共用「已用选手」集合）：
   *   1. 同分路的选 battleCount 最多（最常打该位置）、其次 avgKda 最高的选手；
   *   2. 无名额重复 —— 跨方也不重复（否则 AI 上下文会出现同一名选手同时效力两队）；
   *   3. 某分路没有空闲选手时，回退到 battleCount 最多的未绑定选手。
   * heroes.js 个别英雄 pos 写的是「辅助」（如张良），选手数据用「游走」，这里归一化匹配。
   * @param {Array} blueLineup @param {Array} redLineup
   * @param {Set|Array} [preUsed] 可选：预先占用的选手名集合（多局联调用）
   * @returns {{ blue:Object, red:Object }}  { 英雄名: 选手对象 }
   */
  function assignPlayersBoth(blueLineup, redLineup, preUsed) {
    const pool = externalPlayers.slice();
    const used = new Set(preUsed || []);
    const normPos = (pos) => (pos === "辅助" ? "游走" : pos);
    const byStrength = (a, b) =>
      (b.battleCount || 0) - (a.battleCount || 0) || (b.avgKda || 0) - (a.avgKda || 0);
    const assign = (lineup) => {
      const out = {};
      (lineup || []).forEach((hero) => {
        const h = heroByName(hero);
        if (!h) return;
        const want = normPos(h.pos);
        const cands = pool
          .filter((p) => p.positionDesc === want && !used.has(p.playerName))
          .sort(byStrength);
        let pick = cands[0];
        if (!pick) {
          // 该分路没有空闲选手 → 回退到 battleCount 最多的未绑定选手
          pick = pool
            .filter((p) => !used.has(p.playerName))
            .sort((a, b) => (b.battleCount || 0) - (a.battleCount || 0))[0];
        }
        if (pick) { out[hero] = pick; used.add(pick.playerName); }
      });
      return out;
    };
    return { blue: assign(blueLineup), red: assign(redLineup) };
  }

  function computeHeroStats() {
    const items = heroItems();
    const laneStats = {};
    items.forEach((h) => { laneStats[h.key] = { wins: 0, games: 0, picks: 0 }; });
    const bansByName = {};
    let totalGames = 0;

    // 吸收一小局的贡献。lineup 做了防御性兜底（兼容旧/导入记录）。
    // - 出场/胜负按「规范英雄名去重集合」计：巅峰对决镜像同选只算一次，
    //   避免 pickRate 超过 100% 或胜率分母被双倍放大；
    // - 旧记录里的裸名若有多个分路（如 李信/张良），按种子登场倾向
    //   pr 拆到各分路条目，精确记录（李信@对抗路）则整局归属该分路。
    function ingest(blueLu, redLu, winner, bansBlue, bansRed) {
      totalGames++;
      const bLu = blueLu || [];
      const rLu = redLu || [];
      // 同名英雄在同一队不会重复选；镜像同选只算一次（沿用旧口径）。
      // 注意先 expand 再按规范名去重，否则会丢掉 key 里的分路信息。
      // absorb 一方阵容；expand 前先按规范英雄名去重（同一队不会重选同名）
      const absorb = (arr, isWin, skipRefs) => {
        const seen = new Set();
        (arr || []).forEach((ref) => {
          const name = heroName(ref);
          if (seen.has(name)) return;
          if (skipRefs && skipRefs(ref)) return;
          seen.add(name);
          expandLineupEntry(ref).forEach(({ item, share }) => {
            const st = laneStats[item.key];
            if (!st) return;
            st.picks += share;
            st.games += share;
            if (isWin) st.wins += share;
          });
        });
      };
      const blueIsWin = winner === "blue";
      const redIsWin = winner === "red";
      absorb(bLu, blueIsWin);
      // 巅峰对决允许镜像：蓝方已选过“同一裸名/同一分路条目”时红方同名不重复计；
      // 但如果蓝方选了李信@发育路、红方选了李信@对抗路，两个不同分路都保留。
      const blueExactKeys = new Set((bLu || []).map(heroKey));
      const blueBareNames = new Set((bLu || []).filter((x) => String(x).indexOf(ITEM_SEP) < 0).map(heroName));
      absorb(rLu, redIsWin, (ref) => {
        const name = heroName(ref);
        if (blueBareNames.has(name)) return true; // 蓝方旧裸名已按全部同分路统计
        return blueExactKeys.has(heroKey(ref));   // 镜像同一分路去重
      });
      Array.from(new Set([].concat(bansBlue || [], bansRed || []).map(heroName))).forEach((name) => {
        bansByName[name] = (bansByName[name] || 0) + 1;
      });
    }

    /* 大场记录为唯一持久化来源：聚合每个大场里所有小局的
     * 选人(picks/games)、胜负(wins)、禁用(bans)。无大场记录时
     * 回退到旧比赛记录（kpl_bp_matches_v1），保证历史数据兼容。 */
    const series = loadSeries();
    if (series && series.length) {
      series.forEach((s) => {
        (s.games || []).forEach((g) => {
          ingest(
            (g.picks && g.picks.blue) || g.blueLineup,
            (g.picks && g.picks.red) || g.redLineup,
            g.winner,
            g.bans && g.bans.blue,
            g.bans && g.bans.red
          );
        });
      });
    } else {
      const matches = loadMatches();
      (matches || []).forEach((m) => {
        ingest(m.blueLineup, m.redLineup, m.winner, [], []);
      });
    }

    const result = {};
    const ext = externalStats || {};
    const denom = Math.max(1, totalGames);

    /* 实时赛场梯度（只依据真实职业场次）：
     * 强度分 = 职业胜率×0.35 + 职业出场率×0.35 + 职业禁用率×0.30；
     * 职业样本不足（< 8 场，或 KPL 从未出场）不参与定级，沿用静态档位，
     * 避免把“没上场”误当成 0 分英雄。 */
    const MIN_LIVE_MATCHES = 8;
    const liveScores = {};
    Object.keys(ext).forEach((name) => {
      const e = ext[name];
      if (!e) return;
      const proGames = (e.proMatches != null ? e.proMatches : e.matches) || 0;
      if (proGames < MIN_LIVE_MATCHES) return;
      const proWin = typeof e.proWinRate === "number" ? e.proWinRate : (e.winRate || 0);
      liveScores[name] = proWin * 0.35 + (e.pickRate || 0) * 0.35 + (e.banRate || 0) * 0.3;
    });
    const liveNames = Object.keys(liveScores);
    let tierCut = null;
    if (liveNames.length >= 4) {
      const sorted = liveNames.map((n) => liveScores[n]).sort((a, b) => a - b);
      const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
      tierCut = { s: at(0.85), a: at(0.55), b: at(0.25) }; // 前15%→S 15~45%→A 45~75%→B 其余→C
    }
    const liveTierOf = (name) => {
      if (!tierCut || liveScores[name] == null) return null;
      const sc = liveScores[name];
      if (sc >= tierCut.s) return 4;
      if (sc >= tierCut.a) return 3;
      if (sc >= tierCut.b) return 2;
      return 1;
    };

    const clamp01 = (v) => Math.max(0, Math.min(1, v));

    /* ---- 可信度加权胜率（替代“职业×0.7 + 路人×0.3 一次成型”）----
     * 规则：
     *   1. 静态种子只作为先验（SEED_WEIGHT 场），不再跟真实记录等权硬算；
     *   2. 职业数据有真实场次才计证据：场次越多权重越高，但设置上限，
     *      防止单赛季一两百场直接压死所有其它信息；
     *   3. 路人局没有逐英雄样本量，用固定等效样本并打折（可信度低于职业）；
     *   4. 职业从未出场（0 场/无记录）的刘备类英雄 = 没有职业证据，
     *      不是“职业胜率 0%”，因此不会把整体胜率拉向 0；
     *   5. 实时职业数据是英雄级，分路相对差异由每条记录自己的种子先验 +
     *      本机分路明细维持；整体外部证据对同名各分路做相同的水平修正。 */
    const PRO_EVIDENCE_CAP = 80;   // 单个英雄职业样本折算上限（等效场）
    const CASUAL_EVIDENCE = 28;    // 路人局固定等效样本
    const CASUAL_DISCOUNT = 0.55;  // 路人 vs 职业的可信度折扣

    function evidenceFromExternal(name) {
      const e = ext[name] || {};
      const parts = [];
      if (typeof e.proWinRate === "number" && (e.proMatches || 0) > 0) {
        parts.push({
          rate: clamp01(e.proWinRate),
          weight: Math.min(Math.max(1, e.proMatches), PRO_EVIDENCE_CAP),
        });
      }
      if (typeof e.casualWinRate === "number") {
        parts.push({ rate: clamp01(e.casualWinRate), weight: CASUAL_EVIDENCE * CASUAL_DISCOUNT });
      }
      return parts;
    }

    function blendRates(parts) {
      let w = 0, s = 0;
      parts.forEach((p) => {
        if (p.rate == null || p.weight <= 0) return;
        w += p.weight;
        s += p.weight * p.rate;
      });
      return w > 0 ? clamp01(s / w) : null;
    }

    const seenNames = {};
    items.forEach((item) => {
      const name = item.name;
      if (seenNames[name]) return;
      seenNames[name] = true;
      const variants = itemsByName(name);
      const sumShare = variants.reduce((s, h) => s + Math.max(h.pr || 0.01, 0.001), 0);
      const shareOf = (h) => Math.max(h.pr || 0.01, 0.001) / sumShare;
      const extH = ext[name] || null;
      const extParts = evidenceFromExternal(name);

      // 种子英雄级胜率 = 同名各分路按登场倾向 pr 的加权平均
      const seedOverall = variants.reduce((s, h) => s + shareOf(h) * h.wr, 0);
      // 外部证据以种子为先验做一次加权（只反映“整体外部水平相对种子偏差”）
      const heroEst = blendRates(extParts.length
        ? extParts.concat([{ rate: seedOverall, weight: SEED_WEIGHT }])
        : [{ rate: seedOverall, weight: SEED_WEIGHT }]) || seedOverall;
      const externalDelta = heroEst - seedOverall;

      // 同名英雄的分路明细（本机记录 + 静态先验）可直接区分不同分路表现
      variants.forEach((h) => {
        const s = laneStats[h.key] || { wins: 0, games: 0, picks: 0 };
        const directWins = h.wr * SEED_WEIGHT + s.wins;
        const directGames = SEED_WEIGHT + s.games;
        const laneDirect = directGames > 0 ? directWins / directGames : h.wr;
        // 外部整体水平对所有分路做同一偏移（真实外部数据暂无“分路”维度）
        const winRate = clamp01(laneDirect + externalDelta);

        const observedPicks = laneStats[h.key] ? laneStats[h.key].picks : 0;
        const totalObserved = variants.reduce((sum, v) =>
          sum + (laneStats[v.key] ? laneStats[v.key].picks : 0), 0);
        const laneShare = totalObserved > 0
          ? Math.max(0.02, observedPicks / totalObserved)
          : shareOf(h);
        const extPick = extH && extH.pickRate > 0 ? extH.pickRate : 0;
        const pickRate = extPick > 0
          ? clamp01(extPick * laneShare)
          : observedPicks > 0
          ? clamp01(observedPicks / denom)
          : h.pr;
        const extProGames = extH && extH.proMatches > 0 ? extH.proMatches : 0;
        const extAssign = extProGames * laneShare;
        const tier = liveTierOf(name) || h.tier;
        result[h.key] = {
          key: h.key,
          name,
          pos: h.pos,
          role: h.role,
          lane: h.pos,
          winRate,
          // 出场率 / 禁用率：实时数据是英雄级，ban 与出场倾向会在同名间分摊
          pickRate,
          banRate: extH && extH.banRate > 0
            ? clamp01(extH.banRate)
            : bansByName[name] > 0
            ? clamp01(bansByName[name] / denom)
            : h.ban,
          sample: s.games + extAssign,
          externalSample: extAssign,
          proSample: extProGames,
          localGames: s.games,
          tier,
          tierLive: liveScores[name] != null,
          isItem: true,
          multiLane: variants.length > 1,
        };
      });

      /* 多分路英雄额外写一条“英雄级汇总”入口（键 = 裸英雄名），
       * 供表格排序/展示整体胜率用；单分路英雄 key 就是裸名，不重复写。 */
      if (variants.length > 1) {
        const aggItems = variants.map((h) => {
          const st = result[h.key] || {};
          return Object.assign({ share: shareOf(h) }, st);
        });
        const wSum = aggItems.reduce((s, x) => s + Math.max(x.share, 0.001), 0);
        const aggWr = aggItems.reduce((s, x) => s + x.share * (x.winRate || 0.5), 0) / wSum;
        const aggPick = extH && extH.pickRate > 0
          ? clamp01(extH.pickRate)
          : aggItems.reduce((s, x) => s + (x.localGames || 0), 0) > 0
          ? clamp01(aggItems.reduce((s, x) => s + (x.localGames || 0), 0) / denom)
          : variants.reduce((s, h) => s + (h.pr || 0), 0);
        result[name] = {
          key: name,
          name,
          pos: "",
          role: variants[0].role,
          lane: "",
          winRate: clamp01(aggWr),
          pickRate: aggPick,
          banRate: result[variants[0].key].banRate,
          sample: aggItems.reduce((s, x) => s + x.sample, 0),
          externalSample: aggItems.reduce((s, x) => s + x.externalSample, 0),
          tier: liveTierOf(name) || variants[0].tier,
          tierLive: liveScores[name] != null,
          isAggregate: true,
          multiLane: true,
        };
      }
    });
    return result;
  }

  /** 英雄强度分（0~100），用于阵容评分 */
  function heroScore(ref, stats) {
    const h = heroByRef(ref);
    if (!h) return 50;
    const key = h.key;
    const st = stats[key] || stats[h.name];
    if (!st) return 50;
    // 胜率为主（±），梯度与实时热度为辅：英雄强度不是“按出场率投票”。
    return Math.max(0, Math.min(100,
      st.winRate * 62 + (st.tier / 4) * 16 + st.pickRate * 14 + st.banRate * 8
    ));
  }

  /* ---------------------- 阵容分析 ---------------------- */

  /** 单对克制强度：手动表 + 职业/功能规则派生，返回 0~2.5 */
  function counterStrength(aRef, bRef) {
    const a = heroName(aRef), b = heroName(bRef);
    if (!a || !b || a === b) return 0;
    let s = (COUNTERS[a] && COUNTERS[a][b]) || 0;
    // 规则派生：高硬控/先手单位天然限制突进刺客；
    // 突进刺客天然威胁无位移脆皮；真伤/回复压制坦克线。
    // （分路权重不在这里处理，见 itemLaneWeight / counterAgainst）
    if (CONTROL_ON.has(a) && DIVE_ON.has(b)) s = Math.max(s, 0.7);
    if (DIVE_ON.has(a) && SQUISHY_ON.has(b)) s = Math.max(s, 0.45);
    if (TRUEDMG_ON.has(a) && TANK_ON.has(b)) s = Math.max(s, 0.5);
    return Math.max(0, Math.min(2.5, s));
  }

  /** 单对搭配强度：手动表 + 功能互补派生 */
  function synergyStrength(aRef, bRef) {
    const a = heroName(aRef), b = heroName(bRef);
    if (!a || !b || a === b) return 0;
    let s = (SYNERGIES[a] && SYNERGIES[a][b]) || (SYNERGIES[b] && SYNERGIES[b][a]) || 0;
    if ((ENCHANTER_ON.has(a) && CARRY_ON.has(b)) || (ENCHANTER_ON.has(b) && CARRY_ON.has(a))) {
      s = Math.max(s, 0.5);
    }
    return Math.max(0, Math.min(2.5, s));
  }

  /** 逐对加成汇总（降序衰减，避免把“克制数量”无限线性叠加） */
  function sumPairEffects(pairs, label, notes, noteLimit) {
    const list = pairs
      .map((p) => ({ p, s: p.s }))
      .filter((x) => x.s > 0)
      .sort((x, y) => y.s - x.s);
    let total = 0;
    let count = 0;
    list.forEach(({ p, s }, idx) => {
      const decay = Math.pow(0.75, idx); // 逐对衰减，防“数量淹没质量”
      total += s * decay;
      if (count < (noteLimit == null ? 4 : noteLimit) && notes) {
        notes.push(`【${label}】${displayHero(p.a)} ${label === "克制" ? "克" : "+"} ${displayHero(p.b)} (+${(s * decay).toFixed(1)})`);
      }
      count++;
    });
    return total;
  }

  /** 阵容完整度分（0~16）：分路覆盖 + 职业层 + 关键能力达标 */
  function compositionScore(lineup) {
    const keys = (lineup || []).map(heroKey).filter(Boolean);
    const items = keys.map(heroByRef).filter(Boolean);
    if (!items.length) return 0;
    const lanes = new Set(items.map((h) => h.pos));
    const roles = new Set(items.map((h) => h.role));
    let score = Math.min(10, lanes.size * 2); // 分路覆盖
    if (lanes.size >= 4 && roles.size >= 3) score += 2; // 位置与职业层都立得住
    const totals = {};
    FEATURE_DIMS.forEach((k) => { totals[k] = 0; });
    keys.forEach((k) => {
      const f = heroFeatures(k);
      FEATURE_DIMS.forEach((dim) => { totals[dim] += f[dim] || 0; });
    });
    if (totals.control >= 18) score += 1;
    if (totals.protect >= 15) score += 1;
    if (totals.damage >= 21) score += 1;
    if (totals.tank >= 17) score += 1;
    if (totals.split >= 13) score += 0.5;
    if (!roles.has("辅助") && totals.protect < 15) score -= 2; // 没保护/没辅助
    if (!roles.has("坦克") && totals.tank < 17) score -= 1;
    return Math.max(0, Math.min(16, score));
  }

  /**
   * 分析单方阵容：英雄基础分 + 分路/职业完整度 + 队内搭配（体系原型）
   *              + 对位克制（分路计权）− 能力堆叠饱和惩罚
   * 返回对象保留全部旧字段（score/avgWinRate/baseScore/compScore/
   * synergyScore/counterScore/notes），并新增 v2 字段（见文件尾部导出与注释）。
   */
  function analyzeLineup(lineup, oppLineup, stats) {
    stats = stats || computeHeroStats();
    const mine = resolveLineup(lineup);
    const theirs = resolveLineup(oppLineup);
    const keys = mine.map((x) => x.key);
    const notes = [];

    let scoreSum = 0;
    let avgWrSum = 0;
    keys.forEach((k) => {
      const st = stats[k];
      scoreSum += heroScore(k, stats);
      avgWrSum += st ? st.winRate : 0.5;
    });
    const base = keys.length ? scoreSum / keys.length : 50;
    const avgWinRate = keys.length ? avgWrSum / keys.length : 0.5;

    /* ---- 队内搭配：体系原型（成形一次加成 + 不成形弱加成）+ 逐对搭配 ---- */
    const arch = evaluateArchetypes(keys);
    const synPairs = [];
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        const s = synergyStrength(keys[i], keys[j]);
        if (s > 0) synPairs.push({ a: keys[i], b: keys[j], s: s });
      }
    }
    const pairScore = sumPairEffects(synPairs, "搭配", notes, 2);
    const archRaw = arch.formed.reduce((s, f) => s + f.strength, 0);
    const archScore = saturate(archRaw, SYNERGY_ARCH_CAP);   // 多体系叠加同样饱和
    /* 拆成两块分别进模型：
     *   synergyArch = 已成形的体系原型（大乔体系/保护型射手…），
     *   synergyPair = 零散逐对搭配 + 未成形体系的弱加成。
     * 拆开是因为 bench/signal.js 实测两者信号强度不同：成形体系是「一套打法」
     * 的结构性事实，零散搭配在 396 局上几乎是噪声（AUC 甚至 < 0.5）。
     * 合成后的 synergyScore 仍是两者的饱和和，旧字段语义不变。 */
    const synergyPair = arch.partial + pairScore;
    const synergyScore = saturate(archScore + synergyPair, SYNERGY_CAP);
    arch.formed.forEach((f) => {
      notes.push("【体系】" + f.label + " " + f.heroes.join("+") + " (+" + f.strength.toFixed(1) + ")");
    });

    /* ---- 对位克制：同分路 ×1.0 / 游走 ×0.75 / 跨路 ×0.55，双向各算一次 ----
     * counterScore = 我方对对方的克制收益（≥0，旧字段语义：越大越克制对方）
     * counterNet   = 我方收益 − 对方收益（净收益，进胜率模型，可正可负） */
    const myCounter = counterAgainst(mine, theirs, notes);
    const theirCounter = counterAgainst(theirs, mine, null);
    const counterScore = myCounter.score;
    const counterNet = counterScore - theirCounter.score;

    /* ---- 同分路对位净优势（“克制真正兑现的那一部分”）----
     * counterAgainst 统计的是全部有克制关系的英雄对（含跨路威胁），
     * 而这里只保留「同一条分路内的对位优劣」，是克制里兑现率最高的一块。
     * 它同时被拆进 laneMatchups 供界面展示，这里只取标量和进模型。 */
    const laneMatchups = buildLaneMatchups(mine, theirs, stats);
    const laneEdge = laneMatchups.reduce((s, m) => s + (m.edge || 0), 0);

    /* ---- 阵容完整度 + 同类能力饱和（防“堆保护无敌”）---- */
    const compScore = compositionScore(keys);
    const sat = capabilitySaturation(keys);
    /* 逐成分计权相加（权重见 COMP_WEIGHTS，由 bench/tune.js 交叉验证标定）。
     * 这里直接对「成形体系 / 零散搭配」分别计权，而不是先合成 synergyScore 再
     * 乘一个权重——因为两者信号质量不同，合并会把好的部分一起稀释掉。
     * laneEdge 是克制里「同路真正对上位」的那一块，单独计权后克制不再只由
     * 跨路威胁主导。 */
    const score = base * COMP_WEIGHTS.base + compScore * COMP_WEIGHTS.comp
      + archScore * COMP_WEIGHTS.arch + synergyPair * COMP_WEIGHTS.pair
      + counterScore * COMP_WEIGHTS.ctr + laneEdge * COMP_WEIGHTS.lane
      - sat.penalty * COMP_WEIGHTS.pen;

    /* 注：score 里克制项用的是「本方克制收益」，所以
     * score(蓝) − score(红) 恰好等于 counterNet × COMP_WEIGHTS.ctr，
     * 净克制只计入一次，不会重复放大。laneEdge 同理（各自都是本方视角的净优势）。 */

    return {
      // —— 旧字段（app.js / 复盘依赖，语义不变）——
      score: score,
      avgWinRate: avgWinRate,
      baseScore: base,
      compScore: compScore,
      synergyScore: synergyScore,
      counterScore: counterScore,
      notes: notes,
      // —— v2 新增字段 ——
      counterRaw: myCounter.raw,                 // 逐对计权净收益的朴素和
      counterConceded: theirCounter.score,       // 对方对我的克制收益
      counterNet: counterNet,                    // 本方对位克制净收益（可负）
      synergyArch: round2(archScore),            // 成形的体系原型分（进模型）
      synergyPair: round2(synergyPair),          // 零散逐对搭配分（进模型，权重更小）
      laneEdge: round2(laneEdge),                // 同分路对位净优势（正=我方优）
      synergyBreakdown: arch.formed,             // 已成形的体系原型
      counterBreakdown: myCounter.breakdown,     // 有效对位克制（a 克 b）
      laneMatchups: laneMatchups,                // 同分路对位优劣
      exposure: buildExposure(mine, theirs),     // 我被对面明显克制的英雄
      overstack: sat,                            // 能力堆叠饱和明细与惩罚
    };
  }

  /**
   * 预测蓝方胜率
   *   分数差 →（tanh 软饱和压极端值）→加截距→ logistic(÷WIN_TEMP) → 裁剪 [0.05,0.95]
   * 截距 WIN_BIAS 是蓝方结构性劣势（396 局真实对局蓝胜 47.22%），
   * 让 diff=0 的镜像/均势阵容输出 ~47%，而不是失真地输出 50%+。
   * @returns {{
   *   blueWinProb:number, redWinProb:number, blue:Object, red:Object,
   *   edgeRaw:number, edge:number,
   *   confidence:{semiRange:[number,number], sample:number, realSample:number,
   *               priorSample:number, heroCount:number, certainty:number}
   * }}
   */
  function predictWinRate(blueLineup, redLineup, stats) {
    stats = stats || computeHeroStats();
    const blue = analyzeLineup(blueLineup, redLineup, stats);
    const red = analyzeLineup(redLineup, blueLineup, stats);
    // blue.score / red.score 各自已含“本方对对方的克制收益”，
    // 相减即净克制差（counterNet），不会重复计入。
    const edgeRaw = blue.score - red.score;
    const edge = EDGE_SOFT * Math.tanh(edgeRaw / EDGE_SOFT); // 软饱和，防 90%+
    const raw = 1 / (1 + Math.exp(-(edge + WIN_BIAS) / WIN_TEMP));
    const p = Math.max(WIN_MIN, Math.min(WIN_MAX, raw));
    return {
      blueWinProb: p,
      redWinProb: 1 - p,
      blue: blue,
      red: red,
      edgeRaw: round2(edgeRaw),
      edge: round2(edge),
      confidence: buildConfidence([blueLineup, redLineup], stats, p),
    };
  }

  /* ---------------------- 英雄能力维度特征 ---------------------- */
  // 用于阵容短板分析：带线/野区/坦度/控制/输出/保护/开团/后期（0~10）
  const FEATURE_DIMS = ["split", "jungle", "tank", "control", "damage", "protect", "engage", "late"];
  const DIM_LABELS = {
    split: "带线", jungle: "野区", tank: "坦度", control: "控制",
    damage: "输出", protect: "保护", engage: "开团", late: "后期",
  };
  const ROLE_FEATURES = {
    战士: { split: 6, jungle: 4, tank: 5, control: 3, damage: 5, protect: 2, engage: 5, late: 5 },
    坦克: { split: 3, jungle: 2, tank: 9, control: 6, damage: 2, protect: 6, engage: 7, late: 6 },
    刺客: { split: 2, jungle: 8, tank: 2, control: 2, damage: 8, protect: 1, engage: 6, late: 4 },
    法师: { split: 2, jungle: 3, tank: 2, control: 6, damage: 8, protect: 2, engage: 5, late: 6 },
    射手: { split: 3, jungle: 2, tank: 2, control: 1, damage: 9, protect: 1, engage: 2, late: 8 },
    辅助: { split: 1, jungle: 2, tank: 4, control: 8, damage: 2, protect: 9, engage: 6, late: 5 },
  };
  const POS_FEATURES = {
    对抗路: { split: 4, tank: 1 },
    打野: { jungle: 3 },
    发育路: { damage: 1 },
    游走: { protect: 2, control: 1 },
  };
  // 特定英雄的显式修正（带线/野区等突出能力）
  const HERO_FEATURE_OVERRIDES = {
    老夫子: { split: 10 }, 关羽: { split: 8 }, 马超: { split: 8 }, 芈月: { split: 8 },
    哪吒: { split: 8 }, 李信: { split: 8 }, 程咬金: { split: 8 }, 亚瑟: { split: 7 },
    镜: { jungle: 9 }, 澜: { jungle: 8 }, 裴擒虎: { jungle: 9 }, 娜可露露: { jungle: 8 },
    云中君: { jungle: 8 }, 阿古朵: { jungle: 8, protect: 3 }, 露娜: { jungle: 8 },
    兰陵王: { jungle: 7 }, 百里玄策: { jungle: 7 },
    白起: { tank: 9 }, 猪八戒: { tank: 8, split: 7 }, 廉颇: { tank: 8 }, 张飞: { tank: 8, protect: 9 },
    张良: { control: 9 }, 东皇太一: { control: 9 }, 西施: { control: 8 }, 王昭君: { control: 8 },
    孙尚香: { damage: 9 }, 鲁班七号: { damage: 9 }, 干将莫邪: { damage: 9 }, 公孙离: { damage: 8 },
    太乙真人: { protect: 8 }, 大乔: { protect: 8 }, 孙膑: { protect: 7 }, 蔡文姬: { protect: 8 },
    庄周: { protect: 7 }, 盾山: { protect: 8, control: 6 },
    鬼谷子: { engage: 9 }, 鲁班大师: { engage: 8 }, 苏烈: { engage: 8 }, 牛魔: { engage: 8 },
  };

  function heroFeatures(ref) {
    const h = heroByRef(ref);
    if (!h) return {};
    const base = ROLE_FEATURES[h.role] || {};
    const pos = POS_FEATURES[h.pos] || {};
    const ov = HERO_FEATURE_OVERRIDES[h.name] || {};
    const feat = {};
    FEATURE_DIMS.forEach((k) => {
      feat[k] = Math.max(0, Math.min(10, (base[k] || 0) + (pos[k] || 0) + (ov[k] || 0)));
    });
    return feat;
  }

  /**
   * 阵容短板分析
   * @returns {totals, lanes, roles, coverage, weaknesses:[{dim,label,hint}], strengths:[label]}
   */
  function compositionAnalysis(lineup) {
    const totals = {};
    FEATURE_DIMS.forEach((k) => { totals[k] = 0; });
    const keys = (lineup || []).map(heroKey).filter(Boolean);
    const items = keys.map(heroByRef).filter(Boolean);
    keys.forEach((k) => {
      const f = heroFeatures(k);
      FEATURE_DIMS.forEach((k) => { totals[k] += f[k] || 0; });
    });
    const weaknesses = [];
    const strengths = [];
    const lanes = new Set(items.map((h) => h.pos));
    const roles = new Set(items.map((h) => h.role));
    if (totals.split < 13) weaknesses.push({ dim: "split", label: "带线能力弱", hint: "缺少单带/分推英雄" });
    if (totals.jungle < 12) weaknesses.push({ dim: "jungle", label: "野区能力弱", hint: "缺少野区控制/入侵" });
    if (totals.tank < 17) weaknesses.push({ dim: "tank", label: "缺少前排", hint: "坦度不足，团战易被冲散" });
    if (totals.control < 18) weaknesses.push({ dim: "control", label: "控制不足", hint: "缺少硬控/开团手段" });
    if (totals.damage < 21) weaknesses.push({ dim: "damage", label: "输出不足", hint: "后期伤害乏力" });
    if (totals.protect < 15) weaknesses.push({ dim: "protect", label: "保护不足", hint: "后排缺乏保护" });

    if (totals.split >= 20) strengths.push("带线能力强");
    if (totals.jungle >= 16) strengths.push("野区压制力强");
    if (totals.tank >= 24) strengths.push("前排扎实");
    if (totals.control >= 26) strengths.push("控制链充足");
    if (totals.damage >= 30) strengths.push("输出充足");
    if (totals.protect >= 22) strengths.push("保护到位");
    if (lanes.size >= 5) strengths.push("分路覆盖完整");
    if (lanes.size < 4) weaknesses.push({ dim: "lane", label: "分路/体系偏科", hint: "重复分路或英雄功能集中，容易被阵容针对" });
    return {
      totals,
      lanes: Array.from(lanes),
      roles: Array.from(roles),
      coverage: Math.min(10, lanes.size * 2),
      weaknesses,
      strengths,
    };
  }

  /**
   * BP 分数（百分制 0~100）
   * 综合英雄强度 + 阵容完整度 + 协同 + 克制
   */
  function bpScore(lineup, oppLineup, stats) {
    stats = stats || computeHeroStats();
    if (!lineup || !lineup.length) return null;
    const a = analyzeLineup(lineup, oppLineup, stats);
    const raw = a.score;
    return {
      score: Math.max(0, Math.min(100, raw)),
      raw,
      base: a.baseScore,
      comp: a.compScore,
      synergy: a.synergyScore,
      counter: a.counterScore,
      // —— 计权后的实际贡献（pt，可直接相加得 raw）——
      // 界面用它回答「这个 BP 分里克制/搭配各占多少」，而不是只给一个总分。
      parts: {
        base: round2(a.baseScore * COMP_WEIGHTS.base),
        comp: round2(a.compScore * COMP_WEIGHTS.comp),
        arch: round2(a.synergyArch * COMP_WEIGHTS.arch),
        pair: round2(a.synergyPair * COMP_WEIGHTS.pair),
        counter: round2(a.counterScore * COMP_WEIGHTS.ctr),
        lane: round2(a.laneEdge * COMP_WEIGHTS.lane),
        penalty: round2(-a.overstack.penalty * COMP_WEIGHTS.pen),
      },
      weights: COMP_WEIGHTS,
    };
  }

  /* ---------------------- 大场记录 ---------------------- */
  const SERIES_KEY = "kpl_bp_series_v1";

  function loadSeries() {
    try { return JSON.parse(localStorage.getItem(SERIES_KEY)) || []; } catch (e) { return []; }
  }
  function saveSeries(list) {
    try { localStorage.setItem(SERIES_KEY, JSON.stringify(list)); } catch (e) { /* ignore */ }
  }
  /**
   * 保存一个大场（整个 BO 系列赛）为一条记录
   * @param {Object} s {blueTeam, redTeam, bo, finalScore:{blue,red}, winner, games:[...]}
   */
  function addSeries(s) {
    const list = loadSeries();
    const rec = {
      // 保留调用方提供的 id（联机客方收到房主广播后本地写入时需保持同一 id 以去重）
      id: s.id || "s" + (list.length + 1) + "_" + Date.now(),
      date: s.date || new Date().toISOString().slice(0, 10),
      blueTeam: s.blueTeam,
      redTeam: s.redTeam,
      bo: s.bo,
      finalScore: s.finalScore,
      winner: s.winner,
      games: s.games,
    };
    list.push(rec);
    saveSeries(list);
    return rec; // 返回创建好的记录，供房主广播给客方
  }

  /**
   * 删除单条大场记录（按存储数组下标）
   * @param {number} index 存储数组中的下标（非法下标直接忽略）
   * @returns {Array} 删除后的 series 列表
   */
  function removeSeries(index) {
    const list = loadSeries();
    if (!Array.isArray(list) || index < 0 || index >= list.length) return list;
    list.splice(index, 1);
    saveSeries(list);
    return list;
  }

  /* ---------------------- 局内阶段胜率模拟 ---------------------- */
  // 王者荣耀局内时间线：前期(选/开局~8min) → 中期(~10min龙团前后) → 后期(~20min) → 大后期(~25min+)
  const PHASES = [
    { key: "early",    label: "前期",  t: "开局~8分钟" },
    { key: "mid",      label: "中期",  t: "8~16分钟 · 龙团" },
    { key: "late",     label: "后期",  t: "16~22分钟" },
    { key: "hyper",    label: "大后期", t: "22分钟+" },
  ];

  /* 英雄/分路 → 阶段强度修正（单位：BP分）
   * 只列对时间线有显著倾向的类别，其余为 0。
   * positive = 该类别英雄在对应阶段相对更强 */
  const PHASE_HERO_BIAS = {
    // 前期强势（野核/节奏/强对线）
    裴擒虎:  { early: 7 }, 云中君: { early: 6 },  盘古: { early: 5 },
    橘右京:  { early: 4, late: -3 }, 兰陵王: { early: 5, late: -3 },
    阿轲:    { early: 3, late: 2 },  诸葛亮: { early: 3 },
    百里守约: { early: 3, late: -3 }, 沈梦溪: { early: 2 },
    // 后期强势（大核/大后期英雄）
    伽罗:    { late: 6, hyper: 4 },  黄忠: { late: 6, hyper: 3 },
    鲁班七号: { late: 5 }, 后羿: { late: 5, hyper: 3 },
    孙尚香:  { late: 4, hyper: 2 },  马可波罗: { late: 3 },
    虞姬:    { late: 4 }, 成吉思汗: { late: 3, hyper: 2 },
    干将莫邪: { late: 5 }, 女娲: { late: 4 },  嬴政: { late: 3 },
    小乔:    { late: 2 }, 安琪拉: { late: 2 }, 妲己: { late: 2 },
    吕布:    { late: 4 }, 花木兰: { late: 2 }, 李信: { late: 4, hyper: 3 },
    典韦:    { late: 2 }, 阿古朵: { late: 3 },
    明世隐:  { late: -2 },
    // 中期节奏（龙团核心）
    大乔:    { mid: 4 }, 孙膑: { mid: 3 }, 鬼谷子: { mid: 3 },
    张飞:    { mid: 2 }, 牛魔: { mid: 2 }, 太乙真人: { mid: 3 },
  };

  /* 分路阶段倾向：对抗路偏前期对线，打野/游走偏前期节奏与龙团，发育路偏后期，中路均衡 */
  const PHASE_POS_BIAS = {
    对抗路: { early: 1.5, late: -0.5 },
    打野:   { early: 2, mid: 2.5, late: -1 },
    游走:   { mid: 2, late: 1 },
    发育路: { early: -2, mid: 1.5, late: 3.5, hyper: 2 },
    中路:   { early: 1, late: 1.5 },
  };

  /** 单方阵容阶段强度（0~100 相对强度分，用于四阶段演化） */
  function lineupPhaseStrength(lineup, stats) {
    stats = stats || computeHeroStats();
    const base = lineup.length ? lineup.reduce((s, n) => s + heroScore(n, stats), 0) / Math.max(1, lineup.length) : 50;
    const phase = { early: 0, mid: 0, late: 0, hyper: 0 };
    lineup.forEach((name) => {
      const h = heroByName(name);
      if (!h) return;
      const pb = PHASE_POS_BIAS[h.pos] || {};
      const hb = PHASE_HERO_BIAS[h.name] || {};
      ["early", "mid", "late", "hyper"].forEach((k) => {
        phase[k] += (pb[k] || 0) + (hb[k] || 0);
      });
    });
    return {
      base,
      phase: {
        early:  base + phase.early,
        mid:    base + phase.mid,
        late:   base + phase.late,
        hyper:  base + phase.hyper,
      },
    };
  }

  /**
   * 局内四阶段胜率预测
   * 以 BP 预测胜率为基线，按双方阵容的阶段强度差做时间演化；
   * 大后期向 50% 收敛（游戏后期博弈趋于均势）。
   * @param {Array} blueLineup @param {Array} redLineup
   * @returns {Array} [{key,label,t,blueWin}]  蓝方四阶段胜率
   */
  function predictMatchPhases(blueLineup, redLineup, stats) {
    stats = stats || computeHeroStats();
    const baseP = predictWinRate(blueLineup, redLineup, stats).blueWinProb;
    const bs = lineupPhaseStrength(blueLineup, stats);
    const rs = lineupPhaseStrength(redLineup, stats);
    const out = [];
    PHASES.forEach((p, i) => {
      // 阶段强度差 → 边际相位差（BP分每差1约换算0.4%）
      const diff = bs.phase[p.key] - rs.phase[p.key];
      // Every phase is a forecast relative to the same BP baseline. Adding each
      // absolute phase advantage to the previous phase compounds it four times.
      let pBlue = baseP + diff * 0.004;
      // 大后期向 50% 收敛（游戏后期博弈趋于均势）
      if (p.key === "hyper") pBlue = pBlue * 0.55 + 0.5 * 0.45;
      // 与 predictWinRate 同一口径裁剪，避免出现 98% 这类荒谬值
      pBlue = Math.max(WIN_MIN, Math.min(WIN_MAX, pBlue));
      out.push({ key: p.key, label: p.label, t: p.t, blueWin: +pBlue.toFixed(4) });
    });
    return out;
  }

  /* ---------------------- 离线赛前点评生成（方案一：纯规则，不依赖任何 API） ---------------------- */
  /* 原方案：不用 DeepSeek/外部大模型，用 BP 数据（阵容/禁用/选手绑定/强度/模型胜率/四阶段演化）
   * 本地拼一段有代入感的解说式赛前预测：
   *   开场（BP+禁选+模型胜率）→ 前期节点（谁几分钟做了什么拿优势）→
   *   中期走势（反扑/滚雪球）→ 后期定局 → 最终预测哪方获胜。
   * 用「阵容哈希」做确定性随机种子：同一阵容永远同一篇点评（可复现），不同阵容自然不同。 */

  /**
   * 教练模式赛前研判：只做「局内走势」预测，不虚构选手操作。
   * @param {Object} o { blueTeam, redTeam, blueWinProb, phases }
   * @returns {string} 结构化战术预测（蓝方胜率曲线 + 前期/中期/后期研判）
   */
  function generatePrediction(o) {
    o = o || {};
    const blueTeam = o.blueTeam || "蓝方";
    const redTeam = o.redTeam || "红方";
    const blueWinProb = typeof o.blueWinProb === "number" ? o.blueWinProb : 0.5;
    const phases = (Array.isArray(o.phases) && o.phases.length >= 3) ? o.phases : null;

    const pct = (v) => Math.round(v * 100);
    const favOf = (v) => (v >= 0.5 ? blueTeam : redTeam);
    const otherOf = (v) => (v >= 0.5 ? redTeam : blueTeam);
    const favProb = (v) => pct(v >= 0.5 ? v : 1 - v);
    const edgeOf = (v) => Math.round(Math.abs(v - 0.5) * 1000) / 10; // 相对五五开的百分点
    const stage = (i) => {
      const ph = phases && phases[i];
      return (ph && typeof ph.blueWin === "number") ? ph.blueWin : blueWinProb;
    };

    /* 三条走势主线 */
    const lines = [];
    const pEarly = stage(0);
    const pMid = stage(1);
    const pLate = stage(2);
    const pHyper = phases && phases[3] && typeof phases[3].blueWin === "number" ? phases[3].blueWin : pLate;

    /* 开局曲线：只给概率，不给“谁会在第几分钟做什么” */
    const curve = [
      "前期 " + pct(pEarly) + "%",
      "中期 " + pct(pMid) + "%",
      "后期 " + pct(pLate) + "%",
      "大后期 " + pct(pHyper) + "%",
    ].join(" → ");
    lines.push(blueTeam + "胜率曲线：" + curve + "（蓝方视角）");

    /* 前期：野区 / 对线 / 首个资源团 */
    const earlyFav = favOf(pEarly);
    if (edgeOf(pEarly) >= 3) {
      lines.push("前期（0-8分钟）：" + earlyFav + " 占优约 " + edgeOf(pEarly) + " 个百分点（相对 50%），" +
        "模型建议把重心放在野区节奏与首条暴君上，利用等级差先确立资源视野；" +
        otherOf(pEarly) + " 应优先稳住对线、减少无视野接团。");
    } else {
      lines.push("前期（0-8分钟）：双方对线强度接近，中立资源与河道视野将决定早期天平，" +
        earlyFav + " 只有微弱领先，不宜过早交掉关键技能。");
    }

    /* 中期：转线 / 龙团 / 反扑窗口 */
    const midFav = favOf(pMid);
    if (midFav !== earlyFav) {
      lines.push("中期（8-16分钟）：走势主导方发生切换，模型更偏向 " + midFav +
        "。该阶段是阵容曲线与龙团容错的分水岭，" + midFav +
        " 应抓住对方转线空档建立资源视野，避免把节奏再次交还对手。");
    } else if (Math.abs(pMid - pEarly) > 0.04 && edgeOf(pMid) < 3) {
      lines.push("中期（8-16分钟）：模型曲线明显回落，" + midFav +
        " 前期的领先被压缩到均势附近。此时不宜主动求战，应先通过视野控制与兵线处理稳定节奏。");
    } else if (edgeOf(pMid) >= 3) {
      lines.push("中期（8-16分钟）：" + midFav + " 维持约 " + edgeOf(pMid) +
        " 个百分点的优势（相对 50%）。若能把优势转化为防御塔与视野，可在 10 分钟后的龙团扩大胜率曲线。");
    } else {
      lines.push("中期（8-16分钟）：双方进入资源互换的均势段，哪边能先处理中路视野、抓住对方转线空档，" +
        "哪边就更接近接管比赛。");
    }

    /* 后期 / 大后期：阵容成形后的收尾方式 */
    const lateFav = favOf(pLate);
    const hyperFav = favOf(pHyper);
    if (Math.abs(pHyper - pLate) > 0.04) {
      // 大后期接管的队伍必须取自曲线本身（pHyper 的领先方），不能沿用后期那一方：
      // 若写 lateFav，则"38%→43%"这种蓝方回升的曲线会被描述成"继续向红方倾斜"，方向就反了。
      lines.push("后期（16分钟以后）：阵容进入成形期，曲线在大后期转为向 " + hyperFav +
        " 倾斜，说明该方后期团战或边线处理更占优势；" + otherOf(pHyper) +
        " 若想翻盘，需要争取在 20 分钟前终结比赛。");
    } else if (edgeOf(pLate) >= 3) {
      lines.push("后期（16分钟以后）：" + lateFav + " 仍有约 " + edgeOf(pLate) +
        " 个百分点的优势（相对 50%），模型预计节奏会围绕远古生物与边线分带展开，正面硬拼对" +
        otherOf(pLate) + " 并不有利。");
    } else {
      lines.push("后期（16分钟以后）：模型曲线收敛，双方都保留终结比赛的手段，胜负取决于团战先手与远古资源归属。");
    }

    /* 战术结论 */
    const finalFav = favOf(blueWinProb);
    lines.push("战术结论：整体模型更看好 " + finalFav + "（胜率约 " + favProb(blueWinProb) +
      "%）。建议围绕该走势分配阵容资源：前期控节奏、中期抢视野、后期按曲线选择正面或分带打法。");
    return lines.join("\n");
  }

  /* ---------------------- 导出 ---------------------- */
  return {
    COUNTERS,
    SYNERGIES,
    // 模型层 v2 配置（供 UI 展示克制权重 / 体系说明，只读）
    COMP_WEIGHTS,
    LANE_WEIGHTS,
    LANE_ORDER,
    SYNERGY_ARCHETYPES,
    WIN_TEMP,
    WIN_BIAS,
    EDGE_SOFT,
    laneOf,
    laneWeight,
    capabilitySaturation,
    heroByName,
    heroItems,
    heroKeyOf,
    heroByRef,
    heroKey,
    heroName,
    displayHero,
    itemsByName,
    expandLineupEntry,
    counterStrength,
    synergyStrength,
    computeHeroStats,
    heroScore,
    analyzeLineup,
    predictWinRate,
    setExternalHeroStats,
    getExternalMeta,
    setExternalPlayers,
    getExternalPlayers,
    assignPlayers,
    assignPlayersBoth,
    FEATURE_DIMS,
    DIM_LABELS,
    heroFeatures,
    compositionScore,
    compositionAnalysis,
    bpScore,
    loadSeries,
    saveSeries,
    addSeries,
    removeSeries,
    clearSeries,
    lineupPhaseStrength,
    predictMatchPhases,
    generatePrediction,
  };
})();
