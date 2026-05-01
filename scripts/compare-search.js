// Paste this in DevTools Console while the app is running.
// Compares 3 paths for the same keyword.

(async () => {
  const KEYWORD = '爱的鼓励王力宏';

  // Pull the API call out of the bundle — these are exported from kugouSession.
  // Easiest: import the running module via dynamic import on the dev server.
  const { call, searchKuGouTopHit, searchKuGouPreferredHit, listenHistoryMap } =
    await import('/src/kugouSession.ts');
  const { loadKugouSession } = await import('/src/db.ts');

  const session = await loadKugouSession();
  if (!session?.token) {
    console.error('not logged in');
    return;
  }

  // ===== Path 1: raw /search (what debug panel does) =====
  const cookie = `kg_mid=${session.dfid};kg_dfid=${session.dfid};token=${session.token};userid=${session.userid};`;
  const raw = await call('GET', `/search?keywords=${encodeURIComponent(KEYWORD)}&pagesize=5`, cookie);
  const list = raw?.body?.data?.lists ?? [];
  console.log('=== Path 1: Debug 面板 (raw /search lists[0]) ===');
  console.table(
    list.slice(0, 5).map((x) => ({
      FileName: x.FileName,
      OwnerCount: x.OwnerCount,
      grp_count: Array.isArray(x.Grp) ? x.Grp.length : 0,
    })),
  );

  // ===== Path 2: searchKuGouTopHit (开关 OFF) =====
  const top = await searchKuGouTopHit(KEYWORD);
  console.log('=== Path 2: searchKuGouTopHit (开关 OFF) ===');
  console.log(top);

  // ===== Path 3: searchKuGouPreferredHit (开关 ON) =====
  const preferred = await searchKuGouPreferredHit(KEYWORD);
  console.log('=== Path 3: searchKuGouPreferredHit (开关 ON) ===');
  console.log(preferred);

  // ===== Bonus: 展示 PreferredHit 的候选池 =====
  const playMap = await listenHistoryMap();
  const candidates = [];
  const visit = (item) => {
    const hash = String(item?.FileHash ?? '').toUpperCase();
    if (!hash) return;
    candidates.push({
      filename: String(item.FileName ?? ''),
      hash: hash.slice(0, 8),
      OwnerCount: Number(item.OwnerCount ?? 0),
      plays: playMap.get(hash) ?? 0,
    });
    if (Array.isArray(item.Grp)) for (const g of item.Grp) visit(g);
  };
  for (const item of list) visit(item);
  candidates.sort((a, b) => {
    if (a.plays !== b.plays) return b.plays - a.plays;
    return b.OwnerCount - a.OwnerCount;
  });
  console.log('=== PreferredHit 候选池排序后 ===');
  console.table(candidates);
})();
