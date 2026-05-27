function buildLeaderCandidates() {
  return withLogging_('leader_score', function() {
    var rows = latestMarketRows_();
    var today = amTodayString_();
    var indicatorMap = rowsBySymbolForDate_(AM_CONFIG.SHEETS.INDICATORS_DAILY, today);
    var etfMap = rowsBySymbolForDate_(AM_CONFIG.SHEETS.ETF_STOCK_SCORE, today);
    var flowMap = rowsBySymbolForDate_(AM_CONFIG.SHEETS.INVESTOR_FLOW_SCORE, today);
    var financialMap = rowsBySymbolForDate_(AM_CONFIG.SHEETS.FINANCIAL_RATIOS, today);
    var riskMap = riskPenaltyBySymbolForDate_(today);
    var sectorMap = getSectorScoreMapForDate_(today);
    var macroScore = getLatestMacroAlignmentScore_();
    deleteRowsByDate_(AM_CONFIG.SHEETS.LEADER_CANDIDATES, today);
    deleteRowsByDate_(AM_CONFIG.SHEETS.LEADER_50, today);
    deleteRowsByDate_(AM_CONFIG.SHEETS.KOSDAQ_LEADER_50, today);
    var scored = rows.map(function(row) {
      var symbol = normalizeStockSymbol_(row.symbol);
      var indicator = indicatorMap[symbol] || {};
      var etf = etfMap[symbol] || {};
      var flow = flowMap[symbol] || {};
      var financial = financialMap[symbol] || {};
      var chartScore = Number(indicator.chart_score || 0);
      if (!indicator.chart_score) {
        return null;
      }
      var etfScore = Number(etf.etf_score || 0);
      var flowScore = Number(flow.combined_flow_score || 0);
      var leaderScore = calculateLeaderScore_(row, flowScore);
      var financialScore = Number(financial.financial_score || 0);
      var riskInfo = riskMap[symbol] || { penalty: 0, risk_level: '' };
      var riskPenalty = riskInfo.penalty;
      var sectorScore = getSectorScoreForRow_(row, sectorMap);
      
      // 다중 시간 프레임 장기 추세 필터 확인
      var trendFilterPassed = indicator.trend_filter_passed || 'Y';
      var baseTotalScore = calculateTotalScore_(leaderScore, chartScore, etfScore, financialScore, macroScore, riskPenalty) + calculateSectorAdjustment_(sectorScore);
      var trendPenalty = 0;
      var memoTag = '';
      
      if (trendFilterPassed === 'N') {
        trendPenalty = 20; // 장기 역배열 추가 감점
        baseTotalScore = Math.max(0, baseTotalScore - trendPenalty);
        memoTag = '[장기 역배열 필터링됨] ';
      }
      
      return {
        date: today,
        symbol: symbol,
        name: row.name,
        market: row.market,
        sector: row.sector,
        close: Number(row.close),
        change_pct: Number(row.change_pct),
        trading_value: Number(row.trading_value),
        leader_score: leaderScore,
        chart_score: chartScore,
        etf_score: etfScore,
        flow_score: flowScore,
        financial_score: financialScore,
        macro_score: macroScore,
        sector_score: sectorScore,
        risk_penalty: riskPenalty,
        risk_level: riskInfo.risk_level,
        total_score: baseTotalScore,
        memo: memoTag + 'Real KIS price, daily-chart, ETF, sector and investor-flow data. ' + (flow.flow_comment || 'Investor flow data unavailable or neutral.')
      };
    }).filter(function(row) {
      return row !== null;
    }).sort(function(a, b) {
      return b.total_score - a.total_score;
    });
    var candidateRows = scored.map(function(row, index) {
      row.rank = index + 1;
      return row;
    });
    appendObjectRows_(AM_CONFIG.SHEETS.LEADER_CANDIDATES, candidateRows);
    var leaderRows = scored.slice(0, 50).map(function(row, index) {
      return {
        date: today,
        rank: index + 1,
        symbol: row.symbol,
        name: row.name,
        sector: row.sector,
        close: row.close,
        change_pct: row.change_pct,
        trading_value: row.trading_value,
        leader_score: row.leader_score,
        etf_score: row.etf_score,
        flow_score: row.flow_score,
        financial_score: row.financial_score,
        risk_level: classifyRiskLevel_(row),
        total_score: row.total_score
      };
    });
    appendObjectRows_(AM_CONFIG.SHEETS.LEADER_50, leaderRows);
    var kosdaqScored = scored.filter(function(row) {
      return isKosdaqMarket_(row.market);
    });
    var kosdaqRows = kosdaqScored.slice(0, 50).map(function(row, index) {
      return {
        date: today,
        rank: index + 1,
        symbol: row.symbol,
        name: row.name,
        market: row.market,
        sector: row.sector,
        close: row.close,
        change_pct: row.change_pct,
        trading_value: row.trading_value,
        leader_score: row.leader_score,
        chart_score: row.chart_score,
        etf_score: row.etf_score,
        flow_score: row.flow_score,
        financial_score: row.financial_score,
        risk_level: classifyRiskLevel_(row),
        total_score: row.total_score
      };
    });
    appendObjectRows_(AM_CONFIG.SHEETS.KOSDAQ_LEADER_50, kosdaqRows);
    buildLeaderHistoryDaily_(today);
    logInfo_('leader_score', 'Built leader candidates', {
      count: scored.length,
      kosdaq_count: kosdaqScored.length
    });
    return scored;
  });
}

function buildLeaderHistoryDaily(dateValue) {
  return withLogging_('leader_history', function() {
    ensureAllSheets_();
    var today = normalizeDateValue_(dateValue || amTodayString_());
    var result = buildLeaderHistoryDaily_(today);
    safeUiAlert_([
      '주도주 변화 기록 완료',
      '',
      '날짜: ' + today,
      '전체 TOP50 기록: ' + result.overall + '개',
      '코스닥 TOP50 기록: ' + result.kosdaq + '개',
      '',
      '결과 시트: leader_history'
    ].join('\n'));
    return result;
  });
}

function buildLeaderHistoryDaily_(dateValue) {
  var today = normalizeDateValue_(dateValue || amTodayString_());
  deleteRowsByDate_(AM_CONFIG.SHEETS.LEADER_HISTORY, today);
  var overall = buildLeaderHistoryForList_(today, AM_CONFIG.SHEETS.LEADER_50, 'overall');
  var kosdaq = buildLeaderHistoryForList_(today, AM_CONFIG.SHEETS.KOSDAQ_LEADER_50, 'kosdaq');
  logInfo_('leader_history', 'Built leader history', {
    date: today,
    overall: overall,
    kosdaq: kosdaq
  });
  return {
    overall: overall,
    kosdaq: kosdaq
  };
}

function buildLeaderHistoryForList_(today, sheetName, listType) {
  var rows = readObjects_(sheetName);
  var currentRows = rows.filter(function(row) {
    return normalizeDateValue_(row.date) === today;
  });
  if (currentRows.length === 0) return 0;
  var previousDate = findPreviousLeaderListDate_(rows, today);
  var previousRows = previousDate ? rows.filter(function(row) {
    return normalizeDateValue_(row.date) === previousDate;
  }) : [];
  var previousMap = mapLeaderRowsBySymbol_(previousRows);
  var currentMap = mapLeaderRowsBySymbol_(currentRows);
  var count = 0;
  currentRows.sort(sortByRankAsc_).forEach(function(row) {
    var symbol = normalizeStockSymbol_(row.symbol);
    var previous = previousMap[symbol] || null;
    appendLeaderHistoryRow_(today, listType, row, previous, classifyLeaderHistoryStatus_(row, previous));
    count += 1;
  });
  previousRows.sort(sortByRankAsc_).forEach(function(row) {
    var symbol = normalizeStockSymbol_(row.symbol);
    if (currentMap[symbol]) return;
    appendLeaderHistoryRow_(today, listType, {
      symbol: symbol,
      name: row.name,
      market: row.market,
      sector: row.sector,
      rank: '',
      total_score: ''
    }, row, '이탈');
    count += 1;
  });
  return count;
}

function findPreviousLeaderListDate_(rows, today) {
  var latest = '';
  rows.forEach(function(row) {
    var date = normalizeDateValue_(row.date);
    if (date && date < today && date > latest) latest = date;
  });
  return latest;
}

function mapLeaderRowsBySymbol_(rows) {
  var map = {};
  (rows || []).forEach(function(row) {
    var symbol = normalizeStockSymbol_(row.symbol);
    if (symbol) map[symbol] = row;
  });
  return map;
}

function classifyLeaderHistoryStatus_(current, previous) {
  if (!previous) return '신규';
  var rank = Number(current.rank || 0);
  var previousRank = Number(previous.rank || 0);
  if (!rank || !previousRank) return '유지';
  if (rank < previousRank) return '상승';
  if (rank > previousRank) return '하락';
  return '유지';
}

function appendLeaderHistoryRow_(today, listType, current, previous, status) {
  var rank = Number(current.rank || 0);
  var previousRank = Number(previous && previous.rank || 0);
  appendObjectRow_(AM_CONFIG.SHEETS.LEADER_HISTORY, {
    date: today,
    list_type: listType,
    symbol: normalizeStockSymbol_(current.symbol),
    name: current.name || (previous ? previous.name : ''),
    market: current.market || (previous ? previous.market : ''),
    sector: current.sector || (previous ? previous.sector : ''),
    rank: rank || '',
    previous_rank: previousRank || '',
    rank_change: rank && previousRank ? previousRank - rank : '',
    status: status,
    total_score: current.total_score || '',
    previous_total_score: previous ? previous.total_score || '' : ''
  });
}

function sortByRankAsc_(a, b) {
  return Number(a.rank || 9999) - Number(b.rank || 9999);
}

function rebuildLeaderScores() {
  var scored = buildLeaderCandidates();
  buildEntryPlan();
  var today = amTodayString_();
  var kosdaqCount = countRowsByDate_(AM_CONFIG.SHEETS.KOSDAQ_LEADER_50, today);
  safeUiAlert_([
    '주도주 점수 재계산 완료',
    '',
    '전체 후보: ' + scored.length,
    '코스닥 주도주 후보: ' + kosdaqCount,
    '',
    '결과 시트: leader_candidates, leader_50, kosdaq_leader_50, entry_plan'
  ].join('\n'));
  return scored;
}

function isKosdaqMarket_(marketValue) {
  var text = String(marketValue || '').trim();
  var upper = text.toUpperCase();
  return upper.indexOf('KOSDAQ') >= 0 || text.indexOf('코스닥') >= 0;
}

function calculateSectorAdjustment_(sectorScore) {
  var score = Number(sectorScore || 0);
  if (score >= 80) return 4;
  if (score >= 65) return 2;
  if (score <= 25) return -2;
  return 0;
}

function riskPenaltyBySymbolForDate_(dateValue) {
  var map = {};
  readObjects_(AM_CONFIG.SHEETS.RISK_ALERTS).forEach(function(row) {
    if (normalizeDateValue_(row.date) !== normalizeDateValue_(dateValue)) return;
    var symbol = normalizeStockSymbol_(row.symbol);
    if (!map[symbol]) {
      map[symbol] = { penalty: 0, risk_level: '' };
    }
    var level = String(row.risk_level || '').toLowerCase();
    if (level === 'high') {
      map[symbol].penalty += 10;
      map[symbol].risk_level = 'high';
    } else if (level === 'medium') {
      map[symbol].penalty += 5;
      if (map[symbol].risk_level !== 'high') map[symbol].risk_level = 'medium';
    }
    if (map[symbol].penalty > 25) map[symbol].penalty = 25;
  });
  return map;
}

function rowsBySymbolForDate_(sheetName, dateValue) {
  var map = {};
  readObjects_(sheetName).forEach(function(row) {
    if (normalizeDateValue_(row.date) === normalizeDateValue_(dateValue)) {
      map[normalizeStockSymbol_(row.symbol)] = row;
    }
  });
  return map;
}

function calculateLeaderScore_(row, flowScoreInput) {
  var tradingValue = Number(row.trading_value);
  var changePct = Number(row.change_pct);
  var volume = Number(row.volume);
  var tradingValueScore = Math.min(20, tradingValue / 5000000000);
  var momentumScore = Math.max(0, Math.min(15, changePct * 2 + 7));
  var relativeStrengthScore = Math.max(0, Math.min(10, changePct + 5));
  var volumeScore = Math.min(10, volume / 500000);
  var trendScore = changePct > 0 ? 8 : 4;
  var highProximityScore = changePct > 2 ? 8 : 5;
  var flowScore = Math.max(0, Math.min(10, Number(flowScoreInput || 0)));
  var etfScore = 0;
  var eventScore = 0;
  return Math.round(tradingValueScore + momentumScore + relativeStrengthScore + volumeScore + trendScore + highProximityScore + flowScore + etfScore + eventScore);
}

function calculateTotalScore_(leaderScore, chartScore, etfScore, financialScore, macroScore, riskPenalty) {
  var total = leaderScore * 0.45 + chartScore * 0.15 + etfScore * 0.15 + financialScore * 0.15 + macroScore * 0.10 - riskPenalty;
  return Math.round(Math.max(0, Math.min(100, total)));
}

function classifyRiskLevel_(row) {
  if (row.risk_level === 'high') return 'high';
  if (row.risk_level === 'medium') return 'medium';
  if (Number(row.change_pct) >= 8) return 'high';
  if (Number(row.change_pct) >= 4) return 'medium';
  return 'low';
}
