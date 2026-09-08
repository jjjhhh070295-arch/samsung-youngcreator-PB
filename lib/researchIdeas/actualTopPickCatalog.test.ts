import test from 'node:test';
import assert from 'node:assert/strict';
import { AS_OF, WINDOW_START, REPORTS, PICKS } from './actualTopPickCatalog';
import { actualCounts, buildActualTopPickView, filterActualTopPicks, parseActualTopPickQuery, getActualSourceHref } from './actualTopPickView';

const view = buildActualTopPickView(REPORTS, PICKS, { start: WINDOW_START, end: AS_OF });
test('actual catalog contains only ten attributed originals in the fixed month', () => {
  assert.equal(REPORTS.length, 10); assert.equal(view.withheld.length, 0);
  assert.equal(AS_OF, '2026-09-08'); assert.equal(WINDOW_START, '2026-08-08');
  for (const r of REPORTS) {
    assert.ok(r.publishedOn >= WINDOW_START && r.publishedOn <= AS_OF);
    assert.match(r.sourceHash ?? '', /^[a-f0-9]{64}$/);
    assert.equal(r.rightsStatus, 'unconfirmed');
    assert.ok(getActualSourceHref(r));
  }
});
test('record counts are not duplicated into unique security counts', () => {
  assert.deepEqual(actualCounts(view.rows), { records: 76, securities: 71, reports: 10 });
  assert.equal(view.rows.filter(r => r.pick.kind === 'stock').length, 75);
  assert.equal(actualCounts(view.rows.filter(r => r.pick.kind === 'stock')).securities, 70);
});
test('domestic authors of overseas-stock research remain domestic', () => {
  const rows = filterActualTopPicks(view, parseActualTopPickQuery('institutionGroup=domestic_other', view.sectors));
  assert.equal(actualCounts(rows).securities, 24);
  assert.equal(rows.filter(r => r.pick.kind === 'stock').length, 23);
  assert.ok(rows.filter(r => r.pick.reportId.startsWith('shinhan')).every(r => r.report.institutionGroup === 'domestic_other'));
});
test('foreign historical records include repeats and explicit adverse follow-up', () => {
  const rows = filterActualTopPicks(view, parseActualTopPickQuery('institutionGroup=foreign', view.sectors));
  assert.equal(rows.length, 42); assert.equal(actualCounts(rows).securities, 39);
  assert.equal(rows.filter(r => r.pick.status === 'withdrawn_later').length, 1);
  assert.equal(rows.filter(r => r.pick.status === 'conflicting').length, 2);
});
test('horizons include explicit basket context; short and ETF shortages are not filled by inference', () => {
  assert.equal(filterActualTopPicks(view, parseActualTopPickQuery('horizon=short', view.sectors)).length, 1);
  assert.equal(filterActualTopPicks(view, parseActualTopPickQuery('horizon=medium-long', view.sectors)).length, 26);
  assert.equal(filterActualTopPicks(view, parseActualTopPickQuery('kind=etf', view.sectors)).length, 1);
  assert.ok(PICKS.filter(p => p.reportId.startsWith('kgi-')).every(p => p.horizons.join() === 'unknown'));
  assert.ok(PICKS.filter(p => p.securityMarket === 'KR').every(p => p.code === null));
});
test('PDF evidence targets actual source pages; HTML source buttons do not invent pages', () => {
  for (const {report, pick} of view.rows) {
    const href = getActualSourceHref(report, pick.page);
    assert.ok(href);
    if (report.sourceKind === 'pdf') assert.ok(href.endsWith('#page=' + pick.page));
    else assert.equal(href, report.sourceUrl);
  }
  const samsung = view.rows.filter(r => r.report.institutionGroup === 'samsung');
  assert.equal(samsung.length, 10); assert.ok(samsung.every(r => r.pick.page === 17));
});
test('catalog is not approved for publication, DB ingestion or automatic collection', () => {
  assert.equal(view.publicRelease, false); assert.equal(view.databaseConnected, false);
  assert.equal(view.automatedCollection, false);
  assert.ok(PICKS.every(p => p.selectionEvidence === 'explicit_top_pick'));
});

test('reviewed source fingerprints, desks, dates and selection identities remain stable', () => {
  const expected = [
  {
    "id": "samsung-20260831-strategy",
    "sourceHash": "b26ece7e1a09ab9bf94d7f5b98d07a880843e7751dd94c6f787b3bbabf2ebaf7",
    "publishedOn": "2026-08-31",
    "desk": "글로벌투자전략팀",
    "names": [
      "삼성전자",
      "SK하이닉스",
      "삼성전기",
      "HD현대중공업",
      "두산에너빌리티",
      "SK텔레콤",
      "NH투자증권",
      "삼성E&A",
      "HD건설기계",
      "신세계"
    ]
  },
  {
    "id": "shinhan-20260828-top-picks",
    "sourceHash": "a370028627fc98a5b529488f8d61173ee082fb6a39b52575094093c433544605",
    "publishedOn": "2026-08-28",
    "desk": "해외주식팀",
    "names": [
      "스페이스X",
      "델 테크놀로지스",
      "샌디스크",
      "마벨 테크놀로지",
      "블룸에너지",
      "네비우스",
      "템퍼스 AI",
      "로빈후드",
      "쇼피파이",
      "과창판 AI 반도체 ETF"
    ]
  },
  {
    "id": "kb-20260814-semiconductors",
    "sourceHash": "8d7f7e947cd813d877080c2cea4e95a5aa99cf3bfc8d377b3f41a9914477457b",
    "publishedOn": "2026-08-14",
    "desk": "반도체/전기전자",
    "names": [
      "삼성전자",
      "SK하이닉스"
    ]
  },
  {
    "id": "hana-20260901-bio",
    "sourceHash": "2f4ea30ca094346f9138031e81fea766ac0a34ea236fcc876ed11ea0c0b31e1a",
    "publishedOn": "2026-09-01",
    "desk": "제약/바이오",
    "names": [
      "삼성바이오로직스",
      "SK바이오팜",
      "알테오젠",
      "리가켐바이오"
    ]
  },
  {
    "id": "hana-20260901-construction",
    "sourceHash": "d86c7f07411ed4d1c958be0644b5838d0cca675db8ecc826fc73e4ff289b2504",
    "publishedOn": "2026-09-01",
    "desk": "건설",
    "names": [
      "GS건설"
    ]
  },
  {
    "id": "hana-20260907-energy-chemicals",
    "sourceHash": "7885d9cd646be6614b51b213f4eeacdf5991e1fa1f8ed6351edb4c35e1dd6ef0",
    "publishedOn": "2026-09-07",
    "desk": "에너지/화학",
    "names": [
      "S-Oil",
      "SK이노베이션",
      "OCI홀딩스",
      "한화솔루션",
      "코오롱인더",
      "KCC",
      "효성티앤씨"
    ]
  },
  {
    "id": "kgi-20260814",
    "sourceHash": "64240b6f11c1c8f312a9b4c2951219596aa0cedd0de499628c1176845d43371c",
    "publishedOn": "2026-08-14",
    "desk": "KGI Research / Daily Trading Ideas",
    "names": [
      "Singapore Exchange Ltd",
      "Sembcorp Industries",
      "Xiaomi Corporation",
      "Montage Technology",
      "Coherent Corp",
      "Chevron Corporation"
    ]
  },
  {
    "id": "kgi-20260817",
    "sourceHash": "48040c7955de02eb3979923a33e0f03213cc367eded36c9da6c797ca480e51dc",
    "publishedOn": "2026-08-17",
    "desk": "KGI Research / Daily Trading Ideas",
    "names": [
      "The Assembly Place Holdings",
      "Singapore Exchange Ltd",
      "Lenovo Group",
      "Xiaomi Corporation",
      "Lumentum Holdings",
      "Coherent Corp"
    ]
  },
  {
    "id": "kgi-20260826",
    "sourceHash": "8b821c565422ddc3280abbb998155bc11a271c45771e51faa9f4087824ccf8d5",
    "publishedOn": "2026-08-26",
    "desk": "KGI Research / Daily Trading Ideas",
    "names": [
      "City Developments Limited",
      "Food Empire Holdings",
      "MTR Corporation",
      "Hong Kong Exchanges and Clearing",
      "Palo Alto Networks",
      "CrowdStrike"
    ]
  },
  {
    "id": "axis-20260907-prime",
    "sourceHash": "ff1edf18d08192946b2f70a646b784e3aae746599f377e0276ad8dfad5ae2c2b",
    "publishedOn": "2026-09-07",
    "desk": "Private Client Group",
    "names": [
      "Bharti Airtel Ltd",
      "Ultratech Cement Ltd",
      "ICICI Bank Ltd",
      "APL Apollo Tubes Ltd",
      "Sansera Engineering Ltd",
      "The Indian Hotels Company Ltd",
      "Healthcare Global Enterprises Ltd",
      "Coforge Ltd",
      "Larsen & Toubro Ltd",
      "City Union Bank Ltd",
      "Affle 3i Ltd",
      "CIE Automotive India Ltd",
      "Bajaj Finance Ltd",
      "LG Electronics India Ltd",
      "Indus Towers Ltd",
      "Bharat Electronics Ltd.",
      "Rainbow Children's Medicare Ltd",
      "Jubilant FoodWorks Ltd",
      "IDFC First Bank Ltd.",
      "Trent Ltd",
      "HDFC Bank Ltd",
      "Elecon Engineering Company Ltd",
      "Cera Sanitaryware Ltd.",
      "Kesoram Industries Ltd"
    ]
  }
];
  assert.deepEqual(REPORTS.map(r => ({
    id:r.id, sourceHash:r.sourceHash, publishedOn:r.publishedOn, desk:r.desk,
    names:PICKS.filter(p => p.reportId === r.id).map(p => p.name)
  })), expected);
  for (const p of PICKS.filter(p => p.reportId === 'hana-20260901-bio')) {
    assert.equal(p.selectionLabel, ['삼성바이오로직스','SK바이오팜'].includes(p.name) ? '9월 코스피 Top pick' : '9월 코스닥 Top pick');
  }
});
