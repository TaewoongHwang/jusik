function collectMarketDaily() {
  return withLogging_('market_collector', function() {
    validateRealRuntimeConfig_();
    ensureAllSheets_();
    var today = amTodayString_();
    var universe = readObjects_(AM_CONFIG.SHEETS.MARKET_UNIVERSE).filter(function(row) {
      return String(row.active).toUpperCase() === 'Y';
    });
    if (universe.length === 0) {
      throw new Error('market_universe has no active rows. Add real KRX stock rows before running collection.');
    }
    deleteRowsByDate_(AM_CONFIG.SHEETS.MARKET_DAILY, today);
    var rows = [];
    universe.forEach(function(stock) {
      var symbol = normalizeStockSymbol_(stock.symbol);
      var quote = safeFetchKisCurrentPriceForMarket_(symbol, stock.name);
      if (!quote) {
        appendObjectRow_(AM_CONFIG.SHEETS.RISK_ALERTS, {
          date: today,
          symbol: symbol,
          risk_type: 'data',
          risk_level: 'high',
          message: 'Current price is unavailable. Stock skipped from market_daily.',
          source: 'kis_current_price'
        });
        return;
      }
      rows.push({
        date: today,
        symbol: symbol,
        name: stock.name,
        market: quote.market || stock.market,
        sector: quote.sector || stock.sector,
        close: quote.close,
        change_pct: quote.change_pct,
        volume: quote.volume,
        trading_value: quote.trading_value,
        source: 'kis',
        raw_json: quote.raw
      });
    });
    rows.forEach(function(row) {
      appendObjectRow_(AM_CONFIG.SHEETS.MARKET_DAILY, row);
    });
    logInfo_('market_collector', 'Collected market daily rows', { count: rows.length, date: today });
    return rows;
  });
}

function safeFetchKisCurrentPriceForMarket_(symbol, name) {
  try {
    return fetchKisCurrentPrice_(symbol);
  } catch (err) {
    logWarn_('market_collector', 'Skipped market row because current price fetch failed', {
      symbol: symbol,
      name: name || '',
      error: err.message || String(err)
    });
    return null;
  }
}
