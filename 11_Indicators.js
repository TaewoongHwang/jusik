function calculateIndicatorsDaily() {
  return withLogging_('indicators', function() {
    validateRealRuntimeConfig_();
    var today = amTodayString_();
    var rows = latestMarketRows_();
    deleteRowsByDate_(AM_CONFIG.SHEETS.INDICATORS_DAILY, today);
    var indicatorRowsToAppend = [];
    var riskRowsToAppend = [];
    rows.forEach(function(row) {
      var symbol = normalizeStockSymbol_(row.symbol);
      var priceRows = safeFetchRecentDailyPricesForIndicators_(symbol, row.name);
      if (!priceRows || priceRows.length < 60) {
        riskRowsToAppend.push({
          date: today,
          symbol: symbol,
          risk_type: 'data',
          risk_level: 'high',
          message: 'No usable KIS daily price rows. Check whether the stock is delisted, merged, suspended, or an invalid symbol.',
          source: 'kis_daily_price'
        });
        logWarn_('indicators', 'Skipped indicator calculation because daily prices are unavailable', {
          symbol: symbol,
          name: row.name
        });
        return;
      }
      var indicator = calculateIndicatorFromDailyPrices_(priceRows);
      indicatorRowsToAppend.push({
        date: today,
        symbol: symbol,
        ma5: indicator.ma5,
        ma20: indicator.ma20,
        ma60: indicator.ma60,
        ma120: indicator.ma120,
        weekly_ma20: indicator.weekly_ma20,
        rsi14: indicator.rsi14,
        volume_ratio: indicator.volume_ratio,
        near_52w_high_pct: indicator.near_52w_high_pct,
        atr14: indicator.atr14,
        atr14_pct: indicator.atr14_pct,
        trend_filter_passed: indicator.trend_filter_passed,
        chart_score: indicator.chart_score
      });
    });
    appendObjectRows_(AM_CONFIG.SHEETS.INDICATORS_DAILY, indicatorRowsToAppend);
    appendObjectRows_(AM_CONFIG.SHEETS.RISK_ALERTS, riskRowsToAppend);
    logInfo_('indicators', 'Calculated indicators from KIS daily prices', { count: rows.length });
  });
}

function safeFetchRecentDailyPricesForIndicators_(symbol, name) {
  try {
    return fetchRecentDailyPricesForIndicators_(symbol);
  } catch (err) {
    logWarn_('indicators', 'KIS daily price fetch failed', {
      symbol: symbol,
      name: name || '',
      error: err.message || String(err)
    });
    return [];
  }
}

function fetchRecentDailyPricesForIndicators_(symbol) {
  var endDate = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd');
  var startDate = Utilities.formatDate(new Date(new Date().getTime() - 430 * 24 * 60 * 60 * 1000), Session.getScriptTimeZone(), 'yyyyMMdd');
  return fetchKisDailyPrices_(symbol, startDate, endDate);
}

function calculateIndicatorFromDailyPrices_(priceRows) {
  if (!priceRows || priceRows.length < 60) {
    throw new Error('At least 60 daily rows are required for indicators.');
  }
  var closes = priceRows.map(function(row) { return Number(row.close); });
  var volumes = priceRows.map(function(row) { return Number(row.volume); });
  var lastClose = closes[closes.length - 1];
  var previousClose = closes[closes.length - 2];
  var changePct = previousClose > 0 ? ((lastClose - previousClose) / previousClose) * 100 : 0;
  
  var ma5 = averageLast_(closes, 5);
  var ma20 = averageLast_(closes, 20);
  var ma60 = averageLast_(closes, 60);
  var ma120 = averageLast_(closes, 120);
  
  // 주간 종가 압축 및 주간 20이평선 계산
  var weeklyCloses = compressToWeeklyCloses_(priceRows);
  var weeklyMa20 = averageLast_(weeklyCloses, 20);
  
  // 다중 시간 프레임 장기 추세 필터 통과 조건: 일봉 120선 이상 AND 주봉 20선 이상
  var trendFilterPassed = (lastClose >= ma120 && lastClose >= weeklyMa20) ? 'Y' : 'N';
  
  var volumeAvg20 = averageLast_(volumes.slice(0, -1), 20);
  var volumeRatio = volumeAvg20 > 0 ? volumes[volumes.length - 1] / volumeAvg20 : 0;
  var yearRows = priceRows.slice(Math.max(0, priceRows.length - 260));
  var high52w = Math.max.apply(null, yearRows.map(function(row) { return Number(row.high || row.close); }));
  var near52wHighPct = high52w > 0 ? (lastClose / high52w) * 100 : 0;
  var rsi14 = calculateRsi_(closes, 14);
  var atr14 = calculateAtr_(priceRows, 14);
  var atr14Pct = lastClose > 0 ? (atr14 / lastClose) * 100 : 0;
  
  return {
    ma5: roundNumber_(ma5, 2),
    ma20: roundNumber_(ma20, 2),
    ma60: roundNumber_(ma60, 2),
    ma120: roundNumber_(ma120, 2),
    weekly_ma20: roundNumber_(weeklyMa20, 2),
    rsi14: roundNumber_(rsi14, 2),
    volume_ratio: roundNumber_(volumeRatio, 2),
    near_52w_high_pct: roundNumber_(near52wHighPct, 2),
    atr14: roundNumber_(atr14, 2),
    atr14_pct: roundNumber_(atr14Pct, 2),
    trend_filter_passed: trendFilterPassed,
    chart_score: scoreChart_(changePct, volumeRatio, lastClose, ma5, ma20, ma60, near52wHighPct, rsi14, trendFilterPassed)
  };
}

function scoreChart_(changePct, volumeRatio, close, ma5, ma20, ma60, near52wHighPct, rsi14, trendFilterPassed) {
  var score = 50;
  score += Math.max(-15, Math.min(20, changePct * 4));
  score += Math.max(0, Math.min(20, (volumeRatio - 1) * 15));
  if (close > ma5) score += 5;
  if (close > ma20) score += 8;
  if (close > ma60) score += 5; // 추가: 60일선 위에 있을 때 가점
  if (ma20 > ma60) score += 7;
  if (near52wHighPct >= 90) score += 5;
  if (rsi14 >= 75) score -= 8;
  
  // 장기 역배열 필터링 실패 시 차트 점수 강력 페널티 (-30점)
  if (trendFilterPassed === 'N') {
    score -= 30;
  }
  
  return Math.round(Math.max(0, Math.min(100, score)));
}

// === 헬퍼 함수: 날짜 파싱 및 주봉 압축 ===

function parseDateString_(dateStr) {
  var cleanStr = String(dateStr).replace(/[^0-9]/g, '');
  if (cleanStr.length !== 8) {
    return new Date();
  }
  var y = parseInt(cleanStr.substring(0, 4), 10);
  var m = parseInt(cleanStr.substring(4, 6), 10) - 1;
  var d = parseInt(cleanStr.substring(6, 8), 10);
  return new Date(y, m, d);
}

function getWeekKey_(date) {
  var tempDate = new Date(date.getTime());
  tempDate.setHours(0, 0, 0, 0);
  tempDate.setDate(tempDate.getDate() + 3 - (tempDate.getDay() + 6) % 7);
  var week1 = new Date(tempDate.getFullYear(), 0, 4);
  var weekNum = 1 + Math.round(((tempDate.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
  return tempDate.getFullYear() + '-W' + weekNum;
}

function compressToWeeklyCloses_(priceRows) {
  var weeklyCloses = [];
  var currentWeekKey = '';
  var currentWeekClose = 0;
  
  priceRows.forEach(function(row) {
    var date = parseDateString_(row.date);
    var weekKey = getWeekKey_(date);
    
    if (weekKey !== currentWeekKey) {
      if (currentWeekKey !== '') {
        weeklyCloses.push(currentWeekClose);
      }
      currentWeekKey = weekKey;
    }
    currentWeekClose = Number(row.close);
  });
  
  if (currentWeekKey !== '') {
    weeklyCloses.push(currentWeekClose);
  }
  
  return weeklyCloses;
}

function averageLast_(values, count) {
  var slice = values.slice(Math.max(0, values.length - count));
  if (slice.length === 0) return 0;
  return slice.reduce(function(sum, value) { return sum + Number(value || 0); }, 0) / slice.length;
}

function calculateRsi_(closes, period) {
  if (closes.length <= period) return 50;
  var gains = 0;
  var losses = 0;
  var start = closes.length - period;
  for (var i = start; i < closes.length; i += 1) {
    var diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }
  var avgGain = gains / period;
  var avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  var rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function calculateAtr_(priceRows, period) {
  if (!priceRows || priceRows.length < period + 1) return 0;
  var ranges = [];
  var start = Math.max(1, priceRows.length - period);
  for (var i = start; i < priceRows.length; i += 1) {
    var high = Number(priceRows[i].high || priceRows[i].close || 0);
    var low = Number(priceRows[i].low || priceRows[i].close || 0);
    var previousClose = Number(priceRows[i - 1].close || 0);
    var trueRange = Math.max(
      high - low,
      Math.abs(high - previousClose),
      Math.abs(low - previousClose)
    );
    ranges.push(trueRange);
  }
  return averageLast_(ranges, period);
}

function roundNumber_(value, digits) {
  var factor = Math.pow(10, digits || 0);
  return Math.round(Number(value || 0) * factor) / factor;
}

function latestMarketRows_() {
  var rows = readObjects_(AM_CONFIG.SHEETS.MARKET_DAILY);
  if (rows.length === 0) return [];
  var latestDate = rows.reduce(function(maxDate, row) {
    var date = normalizeDateValue_(row.date);
    return date > maxDate ? date : maxDate;
  }, '');
  return rows.filter(function(row) {
    return normalizeDateValue_(row.date) === latestDate;
  });
}
