/* Shared catalogue merger. Official metadata never fabricates match statistics. */
(function (root) {
  const roles = {1:'战士',2:'法师',3:'坦克',4:'刺客',5:'射手',6:'辅助'};
  const lanes = {1:'对抗路',2:'打野',3:'中路',4:'发育路',5:'游走'};
  function normalize(name) {
    return String(name || '').replace(/（/g, '(').replace(/）/g, ')').replace(/^元流之子[·・-](.+)$/, '元流之子($1)');
  }
  function merge(rows, heroes, images) {
    if (!Array.isArray(rows) || rows.length < 100) throw new Error('官方英雄列表不完整，保留原库');
    let added = 0, lanesFilled = 0;
    for (const row of rows) {
      const name = normalize(row.cname);
      if (!name || !Number.isInteger(Number(row.ename))) continue;
      images[name] = Number(row.ename);
      const form = name.match(/^元流之子\((.+)\)$/);
      const role = form && Object.values(roles).includes(form[1]) ? form[1] : roles[row.hero_type];
      // 推荐分路 ∪ 冷门分路：官方名录里两条都算这名英雄可打的路。
      const positions = [...new Set(
        [...String(row.roles || '').split('|'), ...String(row.extra_cold_lane || '').split('|')]
          .map(x => lanes[String(x).trim()]).filter(Boolean)
      )];
      const own = heroes.filter(h => h.name === name);
      for (const pos of positions) {
        if (heroes.some(h => h.name === name && h.pos === pos)) continue;
        if (!own.length) {
          // 名录里的全新英雄：没有人工数据，一律参考值。
          heroes.push({name, role:role || '战士', pos, tier:2, wr:.5, pr:0, ban:0, referenceOnly:true});
          added++;
        } else {
          // 已有英雄缺的分路：只补条目，沿用英雄本体的强度/胜率/禁用率参考值，
          // 登场率取最低档——常见分路的人工 prior 与历史裸名解析都不动。
          const base = own[0];
          heroes.push({
            name, role: base.role || role || '战士', pos,
            tier: base.tier, wr: base.wr, pr: 0.01,
            ban: (base.ban == null ? 0 : base.ban), referenceOnly: true
          });
          own.push(heroes[heroes.length - 1]);
          lanesFilled++;
        }
      }
    }
    if (typeof console !== 'undefined' && lanesFilled) {
      console.info(`[roster] 官方名录补全分路 ${lanesFilled} 条，新增英雄 ${added} 个`);
    }
    // 调用方（同步按钮）用它显示"新增 N 个分路条目"，补全的分路同样要算进去。
    return added + lanesFilled;
  }
  const api = {merge, normalize};
  if (typeof module !== 'undefined') module.exports = api;
  else {
    root.HeroRoster = api;
    if (root.OFFICIAL_ROSTER) merge(root.OFFICIAL_ROSTER.heroes, root.HEROES, root.HERO_IMAGE);
    try {
      const cached = JSON.parse(localStorage.getItem('kpl_official_roster_v1') || 'null');
      if (cached && Date.parse(cached.fetchedAt) > Date.parse(root.OFFICIAL_ROSTER?.fetchedAt || 0)) {
        merge(cached.heroes, root.HEROES, root.HERO_IMAGE);
        root.OFFICIAL_ROSTER = cached;
      }
    } catch (_) { /* Invalid or unavailable browser cache: use bundled official snapshot. */ }
  }
})(typeof window !== 'undefined' ? window : globalThis);
