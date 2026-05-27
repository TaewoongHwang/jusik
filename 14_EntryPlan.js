function buildEntryPlan() {
  return withLogging_('entry_plan', function() {
    var today = amTodayString_();
    var leaders = readObjects_(AM_CONFIG.SHEETS.LEADER_50).filter(function(row) {
      return normalizeDateValue_(row.date) === today;
    });
    var indicatorMap = rowsBySymbolForDate_(AM_CONFIG.SHEETS.INDICATORS_DAILY, today);
    deleteRowsByDate_(AM_CONFIG.SHEETS.ENTRY_PLAN, today);
    var plansToAppend = [];
    leaders.slice(0, 10).forEach(function(row) {
      var symbol = normalizeStockSymbol_(row.symbol);
      var indicator = indicatorMap[symbol] || {};
      
      // 장기 역배열 필터링 통과 여부 검증 (Hard Filter)
      if (indicator.trend_filter_passed === 'N') {
        logInfo_('entry_plan', 'Skipping entry plan for stock in long-term downtrend', { symbol: symbol, name: row.name });
        return;
      }
      
      var plan = calculateEntryPlan_(row, 'neutral', indicator);
      plansToAppend.push(plan);
    });
    appendObjectRows_(AM_CONFIG.SHEETS.ENTRY_PLAN, plansToAppend);
    logInfo_('entry_plan', 'Entry plan built for top leaders', { count: Math.min(10, leaders.length) });
  });
}

function calculateEntryPlan_(leaderRow, scenario, indicatorRow) {
  var currentPrice = Number(leaderRow.close);
  var riskLevel = String(leaderRow.risk_level || 'medium');
  var maxPositionPct = getMaxPositionPctByRisk_(riskLevel);
  var firstRatio = getStrategyNumber_('first_entry_ratio', 30) / 100;
  var secondRatio = getStrategyNumber_('second_entry_ratio', 30) / 100;
  var breakoutRatio = getStrategyNumber_('breakout_entry_ratio', 40) / 100;
  var margins = calculateEntryMarginsFromAtr_(indicatorRow);
  return {
    date: amTodayString_(),
    symbol: normalizeStockSymbol_(leaderRow.symbol),
    name: leaderRow.name,
    current_price: currentPrice,
    first_entry_price: roundPrice_(currentPrice * (1 - margins.first_drop_pct / 100)),
    first_entry_pct: roundPct_(maxPositionPct * firstRatio),
    second_entry_price: roundPrice_(currentPrice * (1 - margins.second_drop_pct / 100)),
    second_entry_pct: roundPct_(maxPositionPct * secondRatio),
    breakout_price: roundPrice_(currentPrice * (1 + margins.breakout_pct / 100)),
    breakout_entry_pct: roundPct_(maxPositionPct * breakoutRatio),
    invalid_price: roundPrice_(currentPrice * (1 - margins.invalid_drop_pct / 100)),
    max_position_pct: maxPositionPct,
    scenario: scenario,
    memo: margins.uses_atr ?
      'Rule-based ATR plan. Prices use each stock volatility; Gemini may explain but must not recalculate prices or position size.' :
      'Rule-based fallback plan. ATR unavailable; Gemini may explain but must not recalculate prices or position size.'
  };
}

function calculateEntryMarginsFromAtr_(indicatorRow) {
  var atrPct = Number(indicatorRow && indicatorRow.atr14_pct || 0);
  if (!atrPct || atrPct <= 0) {
    return {
      first_drop_pct: 1.5,
      second_drop_pct: 4.5,
      breakout_pct: 2.0,
      invalid_drop_pct: 6.0,
      uses_atr: false
    };
  }
  return {
    first_drop_pct: clampNumber_(atrPct * 0.55, 0.8, 2.8),
    second_drop_pct: clampNumber_(atrPct * 1.25, 2.2, 6.5),
    breakout_pct: clampNumber_(atrPct * 0.65, 1.0, 3.5),
    invalid_drop_pct: clampNumber_(atrPct * 1.8, 3.5, 9.0),
    uses_atr: true
  };
}

function clampNumber_(value, minValue, maxValue) {
  return Math.max(minValue, Math.min(maxValue, Number(value || 0)));
}

function getMaxPositionPctByRisk_(riskLevel) {
  if (riskLevel === 'low') return getStrategyNumber_('low_risk_max_pct', 5);
  if (riskLevel === 'high') return getStrategyNumber_('high_risk_max_pct', 2);
  return getStrategyNumber_('medium_risk_max_pct', 3);
}

function roundPrice_(price) {
  return Math.round(price / 10) * 10;
}

function roundPct_(value) {
  return Math.round(value * 10) / 10;
}
