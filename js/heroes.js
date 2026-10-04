/* ============================================================
 * 王者荣耀 KPL 全局BP模拟器 —— 英雄数据库
 * ============================================================
 * 每个英雄字段说明：
 *   name  英雄名称
 *   role  职业（战士/坦克/刺客/法师/射手/辅助）
 *   pos   分路（对抗路/打野/中路/发育路/游走）
 *
 *   重要：数组中的一条记录 = 「英雄 × 分路」一个可用条目。
 *   同一个英雄可有多条记录（如李信=对抗路+发育路），引擎以
 *   name@pos 作为内部 key，使不同分路拥有独立的 wr/pr（分路
 *   胜率/登场倾向）；禁用率 ban 仍是英雄级属性。
 *   tier  强度档位 S=4 / A=3 / B=2 / C=1（用于强度评分）
 *   wr    基础胜率（种子数据，0~1，可被录入的比赛记录覆盖）
 *   pr    基础出场率（种子数据，0~1）
 *   ban   基础禁用率（种子数据，0~1）
 *
 * 提示：这里的 wr/pr/ban 为"内置参考数据"，用于在没有录入比赛时给出
 *       初始胜率；录入真实比赛后，分析引擎会综合两者计算更真实的结果。
 *
 * 「分路补全」段落 = 腾讯官方英雄名录（herolist.json）的推荐分路 ∪ 冷门分路，
 *   只补齐本地缺的分路，绝不覆盖/删除已有条目（草稿库里的人工分路知识优先）；
 *   这些条目带 referenceOnly，tier/wr/ban 沿用英雄本体参考值，pr 取最低值 0.01。
 * ============================================================ */

window.HEROES = [
  /* ------------------- 对抗路 ------------------- */
  { name: "吕布",     role: "战士", pos: "对抗路", tier: 2, wr: 0.49, pr: 0.12, ban: 0.05 },
  { name: "关羽",     role: "战士", pos: "对抗路", tier: 3, wr: 0.51, pr: 0.08, ban: 0.02 },
  { name: "花木兰",   role: "战士", pos: "对抗路", tier: 3, wr: 0.50, pr: 0.07, ban: 0.02 },
  { name: "程咬金",   role: "坦克", pos: "对抗路", tier: 2, wr: 0.49, pr: 0.04, ban: 0.01 },
  { name: "白起",     role: "坦克", pos: "对抗路", tier: 3, wr: 0.52, pr: 0.06, ban: 0.01 },
  { name: "项羽",     role: "坦克", pos: "对抗路", tier: 2, wr: 0.50, pr: 0.04, ban: 0.01 },
  { name: "廉颇",     role: "坦克", pos: "对抗路", tier: 2, wr: 0.49, pr: 0.05, ban: 0.01 },
  { name: "刘邦",     role: "坦克", pos: "对抗路", tier: 3, wr: 0.52, pr: 0.06, ban: 0.02 },
  { name: "猪八戒",   role: "坦克", pos: "对抗路", tier: 3, wr: 0.51, pr: 0.07, ban: 0.03 },
  { name: "曜",       role: "战士", pos: "对抗路", tier: 3, wr: 0.50, pr: 0.08, ban: 0.02 },
  { name: "老夫子",   role: "战士", pos: "对抗路", tier: 2, wr: 0.49, pr: 0.05, ban: 0.01 },
  { name: "芈月",     role: "法师", pos: "对抗路", tier: 2, wr: 0.50, pr: 0.04, ban: 0.01 },
  { name: "狂铁",     role: "战士", pos: "对抗路", tier: 2, wr: 0.49, pr: 0.05, ban: 0.01 },
  { name: "李信",     role: "战士", pos: "对抗路", tier: 2, wr: 0.50, pr: 0.055, ban: 0.02 },
  { name: "蒙恬",     role: "坦克", pos: "对抗路", tier: 3, wr: 0.51, pr: 0.05, ban: 0.02 },
  { name: "夏洛特",   role: "战士", pos: "对抗路", tier: 3, wr: 0.51, pr: 0.06, ban: 0.01 },
  { name: "司空震",   role: "战士", pos: "对抗路", tier: 2, wr: 0.50, pr: 0.05, ban: 0.01 },
  { name: "亚瑟",     role: "战士", pos: "对抗路", tier: 1, wr: 0.48, pr: 0.03, ban: 0.00 },
  { name: "夏侯惇",   role: "坦克", pos: "对抗路", tier: 3, wr: 0.51, pr: 0.07, ban: 0.02 },
  { name: "哪吒",     role: "战士", pos: "对抗路", tier: 2, wr: 0.50, pr: 0.04, ban: 0.01 },
  { name: "达摩",     role: "战士", pos: "对抗路", tier: 2, wr: 0.50, pr: 0.05, ban: 0.01 },
  { name: "梦奇",     role: "战士", pos: "对抗路", tier: 2, wr: 0.49, pr: 0.04, ban: 0.01 },
  { name: "赵怀真",   role: "战士", pos: "对抗路", tier: 2, wr: 0.49, pr: 0.04, ban: 0.01 },
  { name: "姬小满",   role: "战士", pos: "对抗路", tier: 3, wr: 0.51, pr: 0.06, ban: 0.03 },
  { name: "曹操",     role: "战士", pos: "对抗路", tier: 3, wr: 0.51, pr: 0.06, ban: 0.02 },
  { name: "孙策",     role: "战士", pos: "对抗路", tier: 3, wr: 0.51, pr: 0.06, ban: 0.02 },
  { name: "橘右京",   role: "刺客", pos: "打野",   tier: 2, wr: 0.49, pr: 0.05, ban: 0.01 },
  { name: "马超",     role: "刺客", pos: "对抗路", tier: 4, wr: 0.53, pr: 0.10, ban: 0.06 },
  { name: "大司命",   role: "战士", pos: "打野",   tier: 4, wr: 0.53, pr: 0.12, ban: 0.08 },

  /* ------------------- 打野 ------------------- */
  { name: "韩信",     role: "刺客", pos: "打野", tier: 2, wr: 0.49, pr: 0.05, ban: 0.01 },
  { name: "李白",     role: "刺客", pos: "打野", tier: 2, wr: 0.48, pr: 0.04, ban: 0.01 },
  { name: "兰陵王",   role: "刺客", pos: "打野", tier: 2, wr: 0.49, pr: 0.04, ban: 0.01 },
  { name: "孙悟空",   role: "战士", pos: "打野", tier: 2, wr: 0.49, pr: 0.05, ban: 0.01 },
  { name: "阿轲",     role: "刺客", pos: "打野", tier: 2, wr: 0.48, pr: 0.04, ban: 0.01 },
  { name: "赵云",     role: "战士", pos: "打野", tier: 2, wr: 0.49, pr: 0.05, ban: 0.01 },
  { name: "娜可露露", role: "刺客", pos: "打野", tier: 2, wr: 0.49, pr: 0.04, ban: 0.01 },
  { name: "裴擒虎",   role: "刺客", pos: "打野", tier: 3, wr: 0.50, pr: 0.07, ban: 0.02 },
  { name: "云中君",   role: "刺客", pos: "打野", tier: 2, wr: 0.48, pr: 0.03, ban: 0.01 },
  { name: "镜",       role: "刺客", pos: "打野", tier: 4, wr: 0.53, pr: 0.11, ban: 0.07 },
  { name: "澜",       role: "刺客", pos: "打野", tier: 3, wr: 0.50, pr: 0.08, ban: 0.04 },
  { name: "司马懿",   role: "刺客", pos: "打野", tier: 2, wr: 0.49, pr: 0.04, ban: 0.01 },
  { name: "百里玄策", role: "刺客", pos: "打野", tier: 2, wr: 0.48, pr: 0.03, ban: 0.01 },
  { name: "暃",       role: "刺客", pos: "打野", tier: 3, wr: 0.50, pr: 0.06, ban: 0.02 },
  { name: "宫本武藏", role: "战士", pos: "打野", tier: 3, wr: 0.51, pr: 0.07, ban: 0.03 },
  { name: "阿古朵",   role: "坦克", pos: "打野", tier: 3, wr: 0.50, pr: 0.06, ban: 0.02 },
  { name: "元歌",     role: "刺客", pos: "打野", tier: 2, wr: 0.48, pr: 0.03, ban: 0.01 },
  { name: "露娜",     role: "法师", pos: "打野", tier: 3, wr: 0.51, pr: 0.07, ban: 0.03 },
  { name: "云缨",     role: "战士", pos: "打野", tier: 2, wr: 0.49, pr: 0.05, ban: 0.01 },
  { name: "典韦",     role: "战士", pos: "打野", tier: 1, wr: 0.48, pr: 0.03, ban: 0.00 },
  { name: "铠",       role: "战士", pos: "打野", tier: 2, wr: 0.50, pr: 0.06, ban: 0.01 },
  /* ------------------- 中路 ------------------- */
  { name: "妲己",     role: "法师", pos: "中路", tier: 2, wr: 0.50, pr: 0.08, ban: 0.02 },
  { name: "安琪拉",   role: "法师", pos: "中路", tier: 2, wr: 0.49, pr: 0.06, ban: 0.01 },
  { name: "王昭君",   role: "法师", pos: "中路", tier: 3, wr: 0.51, pr: 0.07, ban: 0.02 },
  { name: "小乔",     role: "法师", pos: "中路", tier: 2, wr: 0.49, pr: 0.05, ban: 0.01 },
  { name: "甄姬",     role: "法师", pos: "中路", tier: 2, wr: 0.49, pr: 0.05, ban: 0.01 },
  { name: "貂蝉",     role: "法师", pos: "中路", tier: 3, wr: 0.50, pr: 0.07, ban: 0.03 },
  { name: "周瑜",     role: "法师", pos: "中路", tier: 2, wr: 0.49, pr: 0.04, ban: 0.01 },
  { name: "诸葛亮",   role: "法师", pos: "中路", tier: 2, wr: 0.49, pr: 0.05, ban: 0.01 },
  { name: "武则天",   role: "法师", pos: "中路", tier: 2, wr: 0.49, pr: 0.04, ban: 0.01 },
  { name: "嬴政",     role: "法师", pos: "中路", tier: 3, wr: 0.51, pr: 0.06, ban: 0.02 },
  { name: "张良",     role: "法师", pos: "中路", tier: 3, wr: 0.50, pr: 0.05, ban: 0.02 },
  { name: "姜子牙",   role: "法师", pos: "中路", tier: 2, wr: 0.49, pr: 0.05, ban: 0.01 },
  { name: "扁鹊",     role: "法师", pos: "中路", tier: 2, wr: 0.49, pr: 0.04, ban: 0.01 },
  { name: "墨子",     role: "法师", pos: "中路", tier: 2, wr: 0.50, pr: 0.06, ban: 0.02 },
  { name: "不知火舞", role: "法师", pos: "中路", tier: 3, wr: 0.52, pr: 0.08, ban: 0.04 },
  { name: "上官婉儿", role: "法师", pos: "中路", tier: 3, wr: 0.51, pr: 0.07, ban: 0.03 },
  { name: "干将莫邪", role: "法师", pos: "中路", tier: 2, wr: 0.50, pr: 0.05, ban: 0.01 },
  { name: "女娲",     role: "法师", pos: "中路", tier: 3, wr: 0.51, pr: 0.06, ban: 0.02 },
  { name: "海月",     role: "法师", pos: "中路", tier: 3, wr: 0.51, pr: 0.07, ban: 0.03 },
  { name: "弈星",     role: "法师", pos: "中路", tier: 2, wr: 0.50, pr: 0.05, ban: 0.01 },
  { name: "沈梦溪",   role: "法师", pos: "中路", tier: 3, wr: 0.51, pr: 0.06, ban: 0.02 },
  { name: "米莱狄",   role: "法师", pos: "中路", tier: 2, wr: 0.49, pr: 0.04, ban: 0.01 },
  { name: "嫦娥",     role: "法师", pos: "中路", tier: 2, wr: 0.50, pr: 0.05, ban: 0.02 },
  { name: "金蝉",     role: "法师", pos: "中路", tier: 2, wr: 0.49, pr: 0.04, ban: 0.01 },

  /* ------------------- 发育路 ------------------- */
  { name: "鲁班七号", role: "射手", pos: "发育路", tier: 2, wr: 0.49, pr: 0.06, ban: 0.01 },
  { name: "后羿",     role: "射手", pos: "发育路", tier: 2, wr: 0.49, pr: 0.05, ban: 0.01 },
  { name: "黄忠",     role: "射手", pos: "发育路", tier: 2, wr: 0.49, pr: 0.05, ban: 0.01 },
  { name: "孙尚香",   role: "射手", pos: "发育路", tier: 3, wr: 0.51, pr: 0.08, ban: 0.02 },
  { name: "狄仁杰",   role: "射手", pos: "发育路", tier: 2, wr: 0.50, pr: 0.05, ban: 0.01 },
  { name: "公孙离",   role: "射手", pos: "发育路", tier: 4, wr: 0.53, pr: 0.10, ban: 0.06 },
  { name: "马可波罗", role: "射手", pos: "发育路", tier: 3, wr: 0.50, pr: 0.08, ban: 0.03 },
  { name: "虞姬",     role: "射手", pos: "发育路", tier: 2, wr: 0.50, pr: 0.05, ban: 0.01 },
  { name: "伽罗",     role: "射手", pos: "发育路", tier: 2, wr: 0.49, pr: 0.05, ban: 0.01 },
  { name: "百里守约", role: "射手", pos: "发育路", tier: 3, wr: 0.50, pr: 0.06, ban: 0.03 },
  { name: "苍",       role: "射手", pos: "发育路", tier: 4, wr: 0.53, pr: 0.10, ban: 0.06 },
  { name: "艾琳",     role: "射手", pos: "发育路", tier: 2, wr: 0.50, pr: 0.04, ban: 0.01 },
  { name: "蒙犽",     role: "射手", pos: "发育路", tier: 3, wr: 0.51, pr: 0.06, ban: 0.02 },
  { name: "李元芳",   role: "射手", pos: "发育路", tier: 2, wr: 0.50, pr: 0.05, ban: 0.01 },
  { name: "敖隐",     role: "射手", pos: "发育路", tier: 4, wr: 0.53, pr: 0.11, ban: 0.07 },
  { name: "莱西奥",   role: "射手", pos: "发育路", tier: 3, wr: 0.50, pr: 0.06, ban: 0.02 },
  { name: "戈娅",     role: "射手", pos: "发育路", tier: 3, wr: 0.51, pr: 0.07, ban: 0.02 },
  { name: "李信",     role: "战士", pos: "发育路", tier: 2, wr: 0.47, pr: 0.025, ban: 0.02 },
  /* ------------------- 游走 ------------------- */
  { name: "张飞",     role: "辅助", pos: "游走", tier: 3, wr: 0.51, pr: 0.08, ban: 0.02 },
  { name: "牛魔",     role: "辅助", pos: "游走", tier: 2, wr: 0.50, pr: 0.05, ban: 0.01 },
  { name: "太乙真人", role: "辅助", pos: "游走", tier: 3, wr: 0.51, pr: 0.06, ban: 0.02 },
  { name: "孙膑",     role: "辅助", pos: "游走", tier: 3, wr: 0.52, pr: 0.07, ban: 0.02 },
  { name: "大乔",     role: "辅助", pos: "游走", tier: 4, wr: 0.53, pr: 0.11, ban: 0.09 },
  { name: "蔡文姬",   role: "辅助", pos: "游走", tier: 2, wr: 0.50, pr: 0.06, ban: 0.01 },
  { name: "东皇太一", role: "辅助", pos: "游走", tier: 2, wr: 0.50, pr: 0.06, ban: 0.03 },
  { name: "鬼谷子",   role: "辅助", pos: "游走", tier: 3, wr: 0.51, pr: 0.05, ban: 0.02 },
  { name: "盾山",     role: "辅助", pos: "游走", tier: 2, wr: 0.49, pr: 0.04, ban: 0.01 },
  { name: "瑶",       role: "辅助", pos: "游走", tier: 2, wr: 0.50, pr: 0.06, ban: 0.02 },
  { name: "明世隐",   role: "辅助", pos: "游走", tier: 2, wr: 0.49, pr: 0.04, ban: 0.01 },
  { name: "鲁班大师", role: "辅助", pos: "游走", tier: 3, wr: 0.51, pr: 0.07, ban: 0.04 },
  { name: "钟馗",     role: "辅助", pos: "游走", tier: 2, wr: 0.49, pr: 0.05, ban: 0.01 },
  { name: "刘禅",     role: "辅助", pos: "游走", tier: 2, wr: 0.49, pr: 0.04, ban: 0.01 },
  { name: "苏烈",     role: "辅助", pos: "游走", tier: 2, wr: 0.50, pr: 0.05, ban: 0.01 },
  { name: "桑启",     role: "辅助", pos: "游走", tier: 3, wr: 0.51, pr: 0.06, ban: 0.02 },
  { name: "朵莉亚",   role: "辅助", pos: "游走", tier: 4, wr: 0.53, pr: 0.11, ban: 0.08 },
  { name: "少司缘",   role: "辅助", pos: "游走", tier: 3, wr: 0.51, pr: 0.07, ban: 0.03 },
  { name: "张良",     role: "法师", pos: "游走", tier: 3, wr: 0.50, pr: 0.05, ban: 0.02 },
  /* ------------------- 补充英雄（经典遗漏 + 2024-2025新英雄） ------------------- */
  { name: "杨戬",         role: "战士", pos: "对抗路", tier: 3, wr: 0.51, pr: 0.06, ban: 0.02 },
  { name: "杨玉环",       role: "法师", pos: "中路",   tier: 2, wr: 0.49, pr: 0.04, ban: 0.01 },
  { name: "西施",         role: "法师", pos: "中路",   tier: 2, wr: 0.49, pr: 0.04, ban: 0.01 },
  { name: "庄周",         role: "辅助", pos: "游走",   tier: 3, wr: 0.51, pr: 0.06, ban: 0.02 },
  { name: "海诺",         role: "法师", pos: "中路",   tier: 3, wr: 0.51, pr: 0.06, ban: 0.02 },
  { name: "影",           role: "刺客", pos: "打野",   tier: 3, wr: 0.50, pr: 0.06, ban: 0.03 },
  { name: "空空儿",       role: "辅助", pos: "游走",   tier: 3, wr: 0.50, pr: 0.06, ban: 0.02 },
  { name: "蚩奼",         role: "战士", pos: "打野",   tier: 4, wr: 0.53, pr: 0.10, ban: 0.06 },
  { name: "孙权",         role: "射手", pos: "发育路", tier: 3, wr: 0.51, pr: 0.08, ban: 0.03 },
  { name: "元流之子(坦克)", role: "坦克", pos: "对抗路", tier: 3, wr: 0.51, pr: 0.07, ban: 0.03 },
  { name: "元流之子(射手)", role: "射手", pos: "发育路", tier: 3, wr: 0.51, pr: 0.07, ban: 0.03 },
  { name: "元流之子(法师)", role: "法师", pos: "中路",   tier: 3, wr: 0.51, pr: 0.06, ban: 0.02 },
  { name: "元流之子(辅助)", role: "辅助", pos: "游走",   tier: 3, wr: 0.51, pr: 0.06, ban: 0.02 },
  { name: "元流之子(刺客)", role: "刺客", pos: "打野",   tier: 3, wr: 0.51, pr: 0.07, ban: 0.03 },

  /* ------------------- 补充遗漏英雄（官方列表全量核对） ------------------- */
  { name: "高渐离",   role: "法师", pos: "中路",   tier: 2, wr: 0.49, pr: 0.04, ban: 0.01 },
  { name: "钟无艳",   role: "战士", pos: "对抗路", tier: 2, wr: 0.49, pr: 0.05, ban: 0.01 },
  { name: "刘备",     role: "战士", pos: "打野",   tier: 2, wr: 0.49, pr: 0.05, ban: 0.01 },
  { name: "雅典娜",   role: "战士", pos: "打野",   tier: 2, wr: 0.49, pr: 0.04, ban: 0.01 },
  { name: "盘古",     role: "战士", pos: "打野",   tier: 2, wr: 0.49, pr: 0.04, ban: 0.01 },
  { name: "亚连",     role: "战士", pos: "对抗路", tier: 3, wr: 0.51, pr: 0.06, ban: 0.02 },
  { name: "心魔六耳", role: "刺客", pos: "打野",   tier: 3, wr: 0.51, pr: 0.07, ban: 0.03 },
  { name: "大禹",     role: "辅助", pos: "游走",   tier: 3, wr: 0.50, pr: 0.05, ban: 0.02 },
  { name: "卢雅那",   role: "射手", pos: "发育路",   tier: 4, wr: 0.53, pr: 0.10, ban: 0.06 },
  { name: "王维",     role: "法师", pos: "打野",     tier: 2, wr: 0.50, pr: 0.02, ban: 0.01, referenceOnly: true },

  /* ------------------- 分路补全（官方名录 roles ∪ 冷门分路） ------------------- */
  { name: "嫦娥",            role: "法师", pos: "对抗路",  tier: 2, wr: 0.50, pr: 0.01, ban: 0.02, referenceOnly: true },  // 官方分路
  { name: "蚩奼",            role: "战士", pos: "对抗路",  tier: 4, wr: 0.53, pr: 0.01, ban: 0.06, referenceOnly: true },  // 官方分路
  { name: "大司命",          role: "战士", pos: "对抗路",  tier: 4, wr: 0.53, pr: 0.01, ban: 0.08, referenceOnly: true },  // 官方分路
  { name: "貂蝉",            role: "法师", pos: "对抗路",  tier: 3, wr: 0.50, pr: 0.01, ban: 0.03, referenceOnly: true },  // 官方分路
  { name: "东皇太一",        role: "辅助", pos: "对抗路",  tier: 2, wr: 0.50, pr: 0.01, ban: 0.03, referenceOnly: true },  // 官方分路
  { name: "海诺",            role: "法师", pos: "对抗路",  tier: 3, wr: 0.51, pr: 0.01, ban: 0.02, referenceOnly: true },  // 官方分路
  { name: "橘右京",          role: "刺客", pos: "对抗路",  tier: 2, wr: 0.49, pr: 0.01, ban: 0.01, referenceOnly: true },  // 官方分路
  { name: "铠",              role: "战士", pos: "对抗路",  tier: 2, wr: 0.50, pr: 0.01, ban: 0.01, referenceOnly: true },  // 官方分路
  { name: "盘古",            role: "战士", pos: "对抗路",  tier: 2, wr: 0.49, pr: 0.01, ban: 0.01, referenceOnly: true },  // 官方分路
  { name: "苏烈",            role: "辅助", pos: "对抗路",  tier: 2, wr: 0.50, pr: 0.01, ban: 0.01, referenceOnly: true },  // 官方分路
  { name: "心魔六耳",        role: "刺客", pos: "对抗路",  tier: 3, wr: 0.51, pr: 0.01, ban: 0.03, referenceOnly: true },  // 官方分路
  { name: "影",              role: "刺客", pos: "对抗路",  tier: 3, wr: 0.50, pr: 0.01, ban: 0.03, referenceOnly: true },  // 官方分路
  { name: "元歌",            role: "刺客", pos: "对抗路",  tier: 2, wr: 0.48, pr: 0.01, ban: 0.01, referenceOnly: true },  // 官方分路
  { name: "赵云",            role: "战士", pos: "对抗路",  tier: 2, wr: 0.49, pr: 0.01, ban: 0.01, referenceOnly: true },  // 冷门分路
  { name: "庄周",            role: "辅助", pos: "对抗路",  tier: 3, wr: 0.51, pr: 0.01, ban: 0.02, referenceOnly: true },  // 冷门分路
  { name: "白起",            role: "坦克", pos: "打野",    tier: 3, wr: 0.52, pr: 0.01, ban: 0.01, referenceOnly: true },  // 冷门分路
  { name: "苍",              role: "射手", pos: "打野",    tier: 4, wr: 0.53, pr: 0.01, ban: 0.06, referenceOnly: true },  // 官方分路
  { name: "曹操",            role: "战士", pos: "打野",    tier: 3, wr: 0.51, pr: 0.01, ban: 0.02, referenceOnly: true },  // 官方分路
  { name: "嫦娥",            role: "法师", pos: "打野",    tier: 2, wr: 0.50, pr: 0.01, ban: 0.02, referenceOnly: true },  // 官方分路
  { name: "程咬金",          role: "坦克", pos: "打野",    tier: 2, wr: 0.49, pr: 0.01, ban: 0.01, referenceOnly: true },  // 冷门分路
  { name: "李元芳",          role: "射手", pos: "打野",    tier: 2, wr: 0.50, pr: 0.01, ban: 0.01, referenceOnly: true },  // 官方分路
  { name: "马超",            role: "刺客", pos: "打野",    tier: 4, wr: 0.53, pr: 0.01, ban: 0.06, referenceOnly: true },  // 官方分路
  { name: "梦奇",            role: "战士", pos: "打野",    tier: 2, wr: 0.49, pr: 0.01, ban: 0.01, referenceOnly: true },  // 官方分路
  { name: "芈月",            role: "法师", pos: "打野",    tier: 2, wr: 0.50, pr: 0.01, ban: 0.01, referenceOnly: true },  // 官方分路
  { name: "哪吒",            role: "战士", pos: "打野",    tier: 2, wr: 0.50, pr: 0.01, ban: 0.01, referenceOnly: true },  // 官方分路
  { name: "司空震",          role: "战士", pos: "打野",    tier: 2, wr: 0.50, pr: 0.01, ban: 0.01, referenceOnly: true },  // 官方分路
  { name: "孙策",            role: "战士", pos: "打野",    tier: 3, wr: 0.51, pr: 0.01, ban: 0.02, referenceOnly: true },  // 官方分路
  { name: "夏侯惇",          role: "坦克", pos: "打野",    tier: 3, wr: 0.51, pr: 0.01, ban: 0.02, referenceOnly: true },  // 官方分路
  { name: "亚瑟",            role: "战士", pos: "打野",    tier: 1, wr: 0.48, pr: 0.01, ban: 0.00, referenceOnly: true },  // 冷门分路
  { name: "杨戬",            role: "战士", pos: "打野",    tier: 3, wr: 0.51, pr: 0.01, ban: 0.02, referenceOnly: true },  // 官方分路
  { name: "杨玉环",          role: "法师", pos: "打野",    tier: 2, wr: 0.49, pr: 0.01, ban: 0.01, referenceOnly: true },  // 官方分路
  { name: "曜",              role: "战士", pos: "打野",    tier: 3, wr: 0.50, pr: 0.01, ban: 0.02, referenceOnly: true },  // 官方分路
  { name: "元流之子(坦克)",  role: "坦克", pos: "打野",    tier: 3, wr: 0.51, pr: 0.01, ban: 0.03, referenceOnly: true },  // 官方分路
  { name: "赵怀真",          role: "战士", pos: "打野",    tier: 2, wr: 0.49, pr: 0.01, ban: 0.01, referenceOnly: true },  // 官方分路
  { name: "钟无艳",          role: "战士", pos: "打野",    tier: 2, wr: 0.49, pr: 0.01, ban: 0.01, referenceOnly: true },  // 官方分路
  { name: "诸葛亮",          role: "法师", pos: "打野",    tier: 2, wr: 0.49, pr: 0.01, ban: 0.01, referenceOnly: true },  // 官方分路
  { name: "猪八戒",          role: "坦克", pos: "打野",    tier: 3, wr: 0.51, pr: 0.01, ban: 0.03, referenceOnly: true },  // 官方分路
  { name: "大乔",            role: "辅助", pos: "中路",    tier: 4, wr: 0.53, pr: 0.01, ban: 0.09, referenceOnly: true },  // 官方分路
  { name: "司马懿",          role: "刺客", pos: "中路",    tier: 2, wr: 0.49, pr: 0.01, ban: 0.01, referenceOnly: true },  // 冷门分路
  { name: "太乙真人",        role: "辅助", pos: "中路",    tier: 3, wr: 0.51, pr: 0.01, ban: 0.02, referenceOnly: true },  // 冷门分路
  { name: "阿古朵",          role: "坦克", pos: "发育路",  tier: 3, wr: 0.50, pr: 0.01, ban: 0.02, referenceOnly: true },  // 官方分路
  { name: "扁鹊",            role: "法师", pos: "发育路",  tier: 2, wr: 0.49, pr: 0.01, ban: 0.01, referenceOnly: true },  // 冷门分路
  { name: "蚩奼",            role: "战士", pos: "发育路",  tier: 4, wr: 0.53, pr: 0.01, ban: 0.06, referenceOnly: true },  // 冷门分路
  { name: "司空震",          role: "战士", pos: "发育路",  tier: 2, wr: 0.50, pr: 0.01, ban: 0.01, referenceOnly: true },  // 冷门分路
  { name: "元歌",            role: "刺客", pos: "发育路",  tier: 2, wr: 0.48, pr: 0.01, ban: 0.01, referenceOnly: true },  // 冷门分路
  { name: "扁鹊",            role: "法师", pos: "游走",    tier: 2, wr: 0.49, pr: 0.01, ban: 0.01, referenceOnly: true },  // 冷门分路
  { name: "关羽",            role: "战士", pos: "游走",    tier: 3, wr: 0.51, pr: 0.01, ban: 0.02, referenceOnly: true },  // 冷门分路
  { name: "姜子牙",          role: "法师", pos: "游走",    tier: 2, wr: 0.49, pr: 0.01, ban: 0.01, referenceOnly: true },  // 官方分路
  { name: "金蝉",            role: "法师", pos: "游走",    tier: 2, wr: 0.49, pr: 0.01, ban: 0.01, referenceOnly: true },  // 官方分路
  { name: "廉颇",            role: "坦克", pos: "游走",    tier: 2, wr: 0.49, pr: 0.01, ban: 0.01, referenceOnly: true },  // 官方分路
  { name: "刘邦",            role: "坦克", pos: "游走",    tier: 3, wr: 0.52, pr: 0.01, ban: 0.02, referenceOnly: true },  // 官方分路
  { name: "卢雅那",          role: "射手", pos: "游走",    tier: 4, wr: 0.53, pr: 0.01, ban: 0.06, referenceOnly: true },  // 官方分路
  { name: "墨子",            role: "法师", pos: "游走",    tier: 2, wr: 0.50, pr: 0.01, ban: 0.02, referenceOnly: true },  // 官方分路
  { name: "王昭君",          role: "法师", pos: "游走",    tier: 3, wr: 0.51, pr: 0.01, ban: 0.02, referenceOnly: true },  // 官方分路
  { name: "西施",            role: "法师", pos: "游走",    tier: 2, wr: 0.49, pr: 0.01, ban: 0.01, referenceOnly: true },  // 冷门分路
  { name: "夏侯惇",          role: "坦克", pos: "游走",    tier: 3, wr: 0.51, pr: 0.01, ban: 0.02, referenceOnly: true },  // 官方分路
  { name: "项羽",            role: "坦克", pos: "游走",    tier: 2, wr: 0.50, pr: 0.01, ban: 0.01, referenceOnly: true },  // 官方分路
  { name: "杨玉环",          role: "法师", pos: "游走",    tier: 2, wr: 0.49, pr: 0.01, ban: 0.01, referenceOnly: true },  // 官方分路
  { name: "元流之子(坦克)",  role: "坦克", pos: "游走",    tier: 3, wr: 0.51, pr: 0.01, ban: 0.03, referenceOnly: true },  // 冷门分路
  { name: "赵怀真",          role: "战士", pos: "游走",    tier: 2, wr: 0.49, pr: 0.01, ban: 0.01, referenceOnly: true },  // 官方分路
];

/* 分路列表与职业列表（供筛选与展示） */
window.POSITIONS = ["对抗路", "打野", "中路", "发育路", "游走"];
window.ROLES = ["战士", "坦克", "刺客", "法师", "射手", "辅助"];
