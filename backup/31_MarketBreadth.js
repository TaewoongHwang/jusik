function buildMarketBreadthDaily() {
  return withLogging_('market_breadth', function() {
    var today = amTodayString_();
    var marketRows = readObjects_(AM_CONFIG.SHEETS.MARKET_DAILY).filter(function(row) {
      return normalizeDateValue_(row.date) === today;
    });
    var indicatorRows = readObjects_(AM_CONFIG.SHEETS.INDICATORS_DAILY).filter(function(row) {
      return normalizeDateValue_(row.date) === today;
    });
    deleteRowsByDate_(AM_CONFIG.SHEETS.MARKET_BREADTH_DAILY, today);
    if (marketRows.length === 0) {
      logWarn_('market_breadth', 'No market_daily rows for market breadth', { date: today });
      return [];
    }
    var indicatorMap = {};
    indicatorRows.forEach(function(row) {
      indicatorMap[normalizeStockSymbol_(row.symbol)] = row;
    });
    var groups = { ALL: [] };
    marketRows.forEach(function(row) {
      var market = String(row.market || 'UNKNOWN').trim() || 'UNKNOWN';
      if (!groups[market]) groups[market] = [];
      groups[market].push(row);
      groups.ALL.push(row);
    });
    var results = Object.keys(groups).map(function(market) {
      return buildBreadthRowForMarket_(today, market, groups[market], indicatorMap);
    }).sort(function(a, b) {
      if (a.market === 'ALL') return -1;
      if (b.market === 'ALL') return 1;
      return String(a.market).localeCompare(String(b.market));
    });
    results.forEach(function(row) {
      appendObjectRow_(AM_CONFIG.SHEETS.MARKET_BREADTH_DAILY, row);
    });
    logInfo_('market_breadth', 'Market breadth built', { date: today, count: results.length });
    return results;
  });
}

function buildBreadthRowForMarket_(today, market, rows, indicatorMap) {
  var stockCount = rows.length;
  var upCount = 0;
  var downCount = 0;
  var flatCount = 0;
  var ma20AboveCount = 0;
  var nearHighCount = 0;
  var volumeExpansionCount = 0;
  var changeSum = 0;
  var totalTradingValue = 0;
  rows.forEach(function(row) {
    var changePct = Number(row.change_pct || 0);
    var close = Number(row.close || 0);
    var indicator = indicatorMap[normalizeStockSymbol_(row.symbol)] || {};
    var ma20 = Number(indicator.ma20 || 0);
    var nearHighPct = Number(indicator.near_52w_high_pct || 999);
    var volumeRatio = Number(indicator.volume_ratio || 0);
    if (changePct > 0) upCount += 1;
    else if (changePct < 0) downCount += 1;
    else flatCount += 1;
    if (close && ma20 && close >= ma20) ma20AboveCount += 1;
    if (nearHighPct <= 5) nearHighCount += 1;
    if (volumeRatio >= 1.5) volumeExpansionCount += 1;
    changeSum += changePct;
    totalTradingValue += Number(row.trading_value || 0);
  });
  var upRatio = ratioPct_(upCount, stockCount);
  var downRatio = ratioPct_(downCount, stockCount);
  var ma20AboveRatio = ratioPct_(ma20AboveCount, stockCount);
  var nearHighRatio = ratioPct_(nearHighCount, stockCount);
  var volumeExpansionRatio = ratioPct_(volumeExpansionCount, stockCount);
  var avgChangePct = stockCount ? changeSum / stockCount : 0;
  var breadthScore = calculateBreadthScore_(upRatio, ma20AboveRatio, nearHighRatio, volumeExpansionRatio, avgChangePct);
  return {
    date: today,
    market: market,
    stock_count: stockCount,
    up_count: upCount,
    down_count: downCount,
    flat_count: flatCount,
    up_ratio: roundNumber_(upRatio, 2),
    down_ratio: roundNumber_(downRatio, 2),
    ma20_above_count: ma20AboveCount,
    ma20_above_ratio: roundNumber_(ma20AboveRatio, 2),
    near_high_count: nearHighCount,
    near_high_ratio: roundNumber_(nearHighRatio, 2),
    volume_expansion_count: volumeExpansionCount,
    volume_expansion_ratio: roundNumber_(volumeExpansionRatio, 2),
    total_trading_value: Math.round(totalTradingValue),
    avg_change_pct: roundNumber_(avgChangePct, 2),
    breadth_score: breadthScore,
    memo: buildBreadthMemo_(market, breadthScore, upRatio, ma20AboveRatio, volumeExpansionRatio)
  };
}

function ratioPct_(count, total) {
  return total ? count / total * 100 : 0;
}

function calculateBreadthScore_(upRatio, ma20AboveRatio, nearHighRatio, volumeExpansionRatio, avgChangePct) {
  var avgChangeScore = Math.max(0, Math.min(10, (avgChangePct + 3) / 6 * 10));
  var score = upRatio * 0.35 +
    ma20AboveRatio * 0.30 +
    nearHighRatio * 0.15 +
    volumeExpansionRatio * 0.10 +
    avgChangeScore;
  return Math.round(Math.max(0, Math.min(100, score)));
}

function buildBreadthMemo_(market, score, upRatio, ma20AboveRatio, volumeExpansionRatio) {
  var tone = score >= 70 ? '시장 참여가 넓고 추세가 양호합니다.' :
    score >= 45 ? '일부 종목 중심의 선별 장세입니다.' :
    '상승 참여가 좁아 방어적으로 봐야 합니다.';
  return market + ': ' + tone +
    ' 상승비율 ' + formatPercentText_(upRatio) +
    ', 20일선 위 ' + formatPercentText_(ma20AboveRatio) +
    ', 거래량 증가 ' + formatPercentText_(volumeExpansionRatio) + '.';
}

function getMarketBreadthForDate_(dateValue) {
  var target = normalizeDateValue_(dateValue);
  return readObjects_(AM_CONFIG.SHEETS.MARKET_BREADTH_DAILY).filter(function(row) {
    return normalizeDateValue_(row.date) === target;
  }).sort(function(a, b) {
    if (a.market === 'ALL') return -1;
    if (b.market === 'ALL') return 1;
    return Number(b.breadth_score || 0) - Number(a.breadth_score || 0);
  });
}
