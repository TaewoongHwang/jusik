function scoreNewsBriefingDaily() {
  return withLogging_('news_score', function() {
    var today = amTodayString_();
    var newsRows = getNewsBriefingForDate_(today);
    deleteRowsByDate_(AM_CONFIG.SHEETS.NEWS_SCORE_DAILY, today);
    if (newsRows.length === 0) {
      logWarn_('news_score', 'No news briefing rows to score', { date: today });
      return [];
    }
    var rows = newsRows.map(function(row) {
      return buildNewsScoreRow_(today, row);
    });
    rows.forEach(function(row) {
      appendObjectRow_(AM_CONFIG.SHEETS.NEWS_SCORE_DAILY, row);
    });
    logInfo_('news_score', 'News score built', { date: today, count: rows.length });
    return rows;
  });
}

function buildNewsScoreRow_(today, row) {
  var riskOnScore = 0;
  var riskOffScore = 0;
  var sectorScore = 0;
  var sectors = {};
  var keyNews = ((row.summary || {}).key_news || []);
  keyNews.forEach(function(item) {
    var impact = String(item.impact || 'neutral').toLowerCase();
    var score = Number(item.impact_score || inferNewsImpactScore_(impact, item.comment || item.topic || ''));
    score = Math.max(1, Math.min(5, score));
    var durationBoost = String(item.duration || '').toLowerCase() === 'long' ? 1 : 0;
    var weighted = score + durationBoost;
    if (impact === 'risk_on') riskOnScore += weighted;
    if (impact === 'risk_off') riskOffScore += weighted;
    if (impact === 'sector_specific') sectorScore += weighted;
    (item.affected_sectors || []).forEach(function(sector) {
      var key = String(sector || '').trim();
      if (!key) return;
      sectors[key] = (sectors[key] || 0) + weighted;
    });
  });
  var net = riskOnScore - riskOffScore;
  var dominant = net >= 3 ? 'risk_on' : net <= -3 ? 'risk_off' : (sectorScore > 0 ? 'sector_specific' : 'neutral');
  return {
    date: today,
    session: row.session,
    risk_on_score: riskOnScore,
    risk_off_score: riskOffScore,
    sector_score: sectorScore,
    net_news_score: net,
    top_sectors: formatTopNewsSectors_(sectors),
    dominant_impact: dominant,
    memo: buildNewsScoreMemo_(row.session, dominant, net, sectorScore, sectors)
  };
}

function inferNewsImpactScore_(impact, text) {
  var value = String(text || '');
  var score = 2;
  if (String(impact || '').toLowerCase() === 'neutral') score = 1;
  if (String(impact || '').toLowerCase() === 'risk_on' || String(impact || '').toLowerCase() === 'risk_off') score = 3;
  if (value.indexOf('급등') >= 0 || value.indexOf('급락') >= 0 || value.indexOf('폭락') >= 0 || value.indexOf('충격') >= 0) score += 1;
  if (value.indexOf('금리') >= 0 || value.indexOf('환율') >= 0 || value.indexOf('나스닥') >= 0 || value.indexOf('외국인') >= 0) score += 1;
  return Math.max(1, Math.min(5, score));
}

function formatTopNewsSectors_(sectorMap) {
  return Object.keys(sectorMap || {}).sort(function(a, b) {
    return Number(sectorMap[b] || 0) - Number(sectorMap[a] || 0);
  }).slice(0, 5).map(function(sector) {
    return sector + '(' + sectorMap[sector] + ')';
  }).join(', ');
}

function buildNewsScoreMemo_(session, dominant, net, sectorScore, sectorMap) {
  var sessionName = session === 'korea_close' ? '국내 마감 뉴스' : '미국/글로벌 뉴스';
  var topSectors = formatTopNewsSectors_(sectorMap);
  var tone = dominant === 'risk_on' ? '위험 선호 쪽 재료가 우세합니다.' :
    dominant === 'risk_off' ? '위험 회피 쪽 재료가 우세합니다.' :
    dominant === 'sector_specific' ? '시장 전체보다 특정 섹터 재료가 중요합니다.' :
    '뉴스 영향은 중립에 가깝습니다.';
  return sessionName + ': ' + tone + ' 순뉴스점수 ' + net + ', 섹터점수 ' + sectorScore +
    (topSectors ? ', 관련 섹터 ' + topSectors : '') + '.';
}

function getNewsScoresForDate_(dateValue) {
  var target = normalizeDateValue_(dateValue);
  return readObjects_(AM_CONFIG.SHEETS.NEWS_SCORE_DAILY).filter(function(row) {
    return normalizeDateValue_(row.date) === target;
  });
}
