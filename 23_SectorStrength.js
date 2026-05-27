function buildSectorStrengthDaily() {
  return withLogging_('sector_strength', function() {
    var today = amTodayString_();
    var rows = readObjects_(AM_CONFIG.SHEETS.MARKET_DAILY).filter(function(row) {
      return normalizeDateValue_(row.date) === today;
    });
    deleteRowsByDate_(AM_CONFIG.SHEETS.SECTOR_STRENGTH_DAILY, today);
    if (rows.length === 0) {
      logWarn_('sector_strength', 'No market_daily rows for sector strength', { date: today });
      return [];
    }
    var totalTradingValue = rows.reduce(function(sum, row) {
      return sum + Number(row.trading_value || 0);
    }, 0);
    var bySector = {};
    rows.forEach(function(row) {
      var sector = String(row.sector || 'unknown').trim() || 'unknown';
      if (!bySector[sector]) {
        bySector[sector] = {
          sector: sector,
          stock_count: 0,
          change_sum: 0,
          up_count: 0,
          total_trading_value: 0
        };
      }
      var item = bySector[sector];
      var changePct = Number(row.change_pct || 0);
      item.stock_count += 1;
      item.change_sum += changePct;
      if (changePct > 0) item.up_count += 1;
      item.total_trading_value += Number(row.trading_value || 0);
    });
    var results = Object.keys(bySector).map(function(sector) {
      var item = bySector[sector];
      var avgChange = item.stock_count ? item.change_sum / item.stock_count : 0;
      var upRatio = item.stock_count ? item.up_count / item.stock_count * 100 : 0;
      var relativeTradingValuePct = totalTradingValue ? item.total_trading_value / totalTradingValue * 100 : 0;
      var sectorScore = calculateSectorScore_(avgChange, upRatio, relativeTradingValuePct, item.stock_count);
      return {
        date: today,
        sector: sector,
        stock_count: item.stock_count,
        avg_change_pct: roundNumber_(avgChange, 2),
        up_ratio: roundNumber_(upRatio, 2),
        total_trading_value: Math.round(item.total_trading_value),
        relative_trading_value_pct: roundNumber_(relativeTradingValuePct, 2),
        sector_score: sectorScore
      };
    }).sort(function(a, b) {
      return b.sector_score - a.sector_score;
    });
    results.forEach(function(row) {
      appendObjectRow_(AM_CONFIG.SHEETS.SECTOR_STRENGTH_DAILY, row);
    });
    logInfo_('sector_strength', 'Sector strength built', { date: today, count: results.length });
    return results;
  });
}

function calculateSectorScore_(avgChangePct, upRatio, relativeTradingValuePct, stockCount) {
  var score = 0;
  score += Math.max(0, Math.min(35, (avgChangePct + 3) / 6 * 35));
  score += Math.max(0, Math.min(30, upRatio / 100 * 30));
  score += Math.max(0, Math.min(25, relativeTradingValuePct / 20 * 25));
  score += Math.max(0, Math.min(10, stockCount / 5 * 10));
  return Math.round(Math.max(0, Math.min(100, score)));
}

function getSectorScoreMapForDate_(dateValue) {
  var map = {};
  readObjects_(AM_CONFIG.SHEETS.SECTOR_STRENGTH_DAILY).forEach(function(row) {
    if (normalizeDateValue_(row.date) === normalizeDateValue_(dateValue)) {
      map[String(row.sector || '')] = Number(row.sector_score || 0);
    }
  });
  return map;
}

function getSectorScoreForRow_(row, sectorMap) {
  return Number(sectorMap[String(row.sector || '')] || 0);
}
