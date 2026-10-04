/* All Flowborn forms share one draft identity; peak exemptions stay in the caller. */
(function (root) {
  function name(ref) {
    return String(ref || '').split('@')[0].replace(/（/g,'(').replace(/）/g,')').replace(/^元流之子[·・-](.+)$/, '元流之子($1)');
  }
  function identity(ref) {
    const n = name(ref);
    return n.startsWith('元流之子') ? '元流之子' : n;
  }
  const api = {identity};
  if (typeof module !== 'undefined') module.exports = api;
  else root.DraftRules = api;
})(typeof window !== 'undefined' ? window : globalThis);
