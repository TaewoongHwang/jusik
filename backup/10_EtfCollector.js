function collectEtfHoldings() {
  return withLogging_('etf_collector', function() {
    validateRealRuntimeConfig_();
    ensureAllSheets_();
    var today = amTodayString_();
    var watchList = readActiveEtfWatchRows_();
    deleteRowsByDate_(AM_CONFIG.SHEETS.ETF_HOLDINGS, today);
    if (watchList.length === 0) {
      logWarn_('etf_collector', 'etf_watch has no active ETF rows. ETF score will be 0.', {});
      return [];
    }
    var collected = [];
    watchList.forEach(function(etf) {
      var etfSymbol = normalizeStockSymbol_(etf.etf_symbol);
      try {
        var response = fetchKisEtfComponentStockPrice_(etfSymbol);
        var holdings = normalizeKisEtfHoldings_(etf, response);
        collected = collected.concat(holdings);
        logInfo_('etf_collector', 'Collected ETF holdings', {
          etf_symbol: etfSymbol,
          etf_name: etf.etf_name,
          count: holdings.length
        });
        Utilities.sleep(250);
      } catch (err) {
        logWarn_('etf_collector', 'Skipped ETF holdings because KIS request failed', {
          etf_symbol: etfSymbol,
          etf_name: etf.etf_name || '',
          error: err.message || String(err)
        });
      }
    });
    appendObjectRows_(AM_CONFIG.SHEETS.ETF_HOLDINGS, collected);
    if (collected.length === 0) {
      logWarn_('etf_collector', 'No ETF holdings were collected. Check KIS ETF endpoint parameters/TR ID in logs.', {});
    }
    return collected;
  });
}

function fetchKisEtfComponentStockPrice_(etfSymbol) {
  // KIS ETF/ETN component stock endpoint. Verified against Korea Investment open-trading-api ETF/ETN sample.
  return kisGet_('/uapi/etfetn/v1/quotations/inquire-component-stock-price', {
    FID_COND_MRKT_DIV_CODE: 'J',
    FID_COND_SCR_DIV_CODE: '11216',
    FID_INPUT_ISCD: normalizeStockSymbol_(etfSymbol)
  }, 'FHKST121600C0');
}

function runEtfDiagnostics() {
  return withLogging_('etf_diagnostics', function() {
    validateRealRuntimeConfig_();
    ensureAllSheets_();
    var sampleEtf = {
      etf_symbol: '069500',
      etf_name: 'KODEX 200',
      category: 'representative'
    };
    var result = {
      checked_at: amNowString_(),
      etf_symbol: sampleEtf.etf_symbol,
      etf_name: sampleEtf.etf_name,
      holdings: diagnoseStep_('etf_holdings', function() {
        var response = fetchKisEtfComponentStockPrice_(sampleEtf.etf_symbol);
        var holdings = normalizeKisEtfHoldings_(sampleEtf, response);
        return {
          ok: holdings.length > 0,
          count: holdings.length,
          first_symbol: holdings.length ? holdings[0].symbol : '',
          first_name: holdings.length ? holdings[0].name : '',
          first_weight_pct: holdings.length ? holdings[0].weight_pct : ''
        };
      })
    };
    logInfo_('etf_diagnostics', 'ETF diagnostics completed', result);
    safeUiAlert_(formatEtfDiagnosticMessage_(result));
    return result;
  });
}

function formatEtfDiagnosticMessage_(result) {
  var lines = [];
  lines.push('ETF 연결 진단 결과');
  lines.push('');
  lines.push('ETF: ' + result.etf_name + ' ' + result.etf_symbol);
  lines.push('구성종목 조회: ' + diagnosticStatusText_(result.holdings));
  if (result.holdings && result.holdings.ok) {
    lines.push('구성종목 수: ' + result.holdings.count);
    lines.push('첫 종목: ' + result.holdings.first_name + ' ' + result.holdings.first_symbol);
    lines.push('첫 비중: ' + result.holdings.first_weight_pct);
  }
  lines.push('');
  lines.push('자세한 오류는 logs 시트의 etf_diagnostics 행을 확인하세요.');
  return lines.join('\n');
}

function normalizeKisEtfHoldings_(etf, response) {
  var today = amTodayString_();
  var etfSymbol = normalizeStockSymbol_(etf.etf_symbol);
  var rows = extractKisOutputRows_(response);
  if (rows.length === 0) {
    throw new Error('KIS ETF holdings response has no output rows for ' + etfSymbol + ': ' + JSON.stringify(response).slice(0, 1200));
  }
  var normalized = rows.map(function(row) {
    var symbol = normalizeStockSymbol_(firstNonEmpty_(row.mksc_shrn_iscd, row.stck_shrn_iscd, row.stck_code, row.iscd, row.symbol));
    var name = firstNonEmpty_(row.hts_kor_isnm, row.prdt_name, row.stck_kor_isnm, row.name);
    var explicitWeight = firstNumber_(row.etf_cnfg_stk_wigh, row.cnfg_wigt, row.compst_wght, row.weight_pct, row.wght);
    var valueAmount = firstNumber_(row.stck_avls, row.etf_vltn_amt, row.cnfg_stk_vltn_amt, row.vltn_amt, row.market_value);
    return {
      date: today,
      etf_symbol: etfSymbol,
      etf_name: etf.etf_name || '',
      category: etf.category || '',
      symbol: symbol,
      name: name,
      weight_pct: explicitWeight,
      value_amount: valueAmount,
      source: 'kis_etfetn_component',
      raw_json: row
    };
  }).filter(function(row) {
    return row.symbol && row.symbol !== etfSymbol;
  });
  fillMissingEtfWeights_(normalized);
  return normalized.map(function(row) {
    return {
      date: row.date,
      etf_symbol: row.etf_symbol,
      etf_name: row.etf_name,
      category: row.category,
      symbol: row.symbol,
      name: row.name,
      weight_pct: roundNumber_(row.weight_pct, 4),
      source: row.source,
      raw_json: row.raw_json
    };
  });
}

function extractKisOutputRows_(response) {
  if (!response) return [];
  var candidates = [response.output, response.output1, response.output2, response.output3];
  for (var i = 0; i < candidates.length; i += 1) {
    if (Array.isArray(candidates[i]) && candidates[i].length > 0) return candidates[i];
  }
  if (Array.isArray(response)) return response;
  return [];
}

function fillMissingEtfWeights_(rows) {
  var hasWeight = rows.some(function(row) {
    return Number(row.weight_pct || 0) > 0;
  });
  if (hasWeight) return;
  var totalValue = rows.reduce(function(sum, row) {
    return sum + Number(row.value_amount || 0);
  }, 0);
  if (totalValue > 0) {
    rows.forEach(function(row) {
      row.weight_pct = Number(row.value_amount || 0) / totalValue * 100;
    });
    return;
  }
  var equalWeight = rows.length > 0 ? 100 / rows.length : 0;
  rows.forEach(function(row) {
    row.weight_pct = equalWeight;
  });
}

function readActiveEtfWatchRows_() {
  return readObjects_(AM_CONFIG.SHEETS.ETF_WATCH).filter(function(row) {
    return String(row.active || '').toUpperCase() === 'Y';
  });
}

function firstNonEmpty_() {
  for (var i = 0; i < arguments.length; i += 1) {
    var value = arguments[i];
    if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim();
  }
  return '';
}

function firstNumber_() {
  for (var i = 0; i < arguments.length; i += 1) {
    var value = arguments[i];
    if (value === undefined || value === null || value === '') continue;
    var number = Number(String(value).replace(/,/g, ''));
    if (!isNaN(number)) return number;
  }
  return 0;
}

function calculateEtfScoresFromHoldings() {
  return withLogging_('etf_collector', function() {
    var today = amTodayString_();
    var holdings = readObjects_(AM_CONFIG.SHEETS.ETF_HOLDINGS).filter(function(row) {
      return normalizeDateValue_(row.date) === today;
    });
    deleteRowsByDate_(AM_CONFIG.SHEETS.ETF_STOCK_SCORE, today);
    if (holdings.length === 0) {
      logWarn_('etf_collector', 'No ETF holdings for today. ETF score will be 0 until real holdings are collected.', { date: today });
      return [];
    }
    var bySymbol = {};
    holdings.forEach(function(row) {
      var symbol = normalizeStockSymbol_(row.symbol);
      if (!bySymbol[symbol]) {
        bySymbol[symbol] = { symbol: symbol, etf_count: 0, total_weight: 0, sector_etf_count: 0 };
      }
      bySymbol[symbol].etf_count += 1;
      bySymbol[symbol].total_weight += Number(row.weight_pct || 0);
      if (String(row.etf_symbol).indexOf('sector') >= 0 || String(row.category) === 'sector') {
        bySymbol[symbol].sector_etf_count += 1;
      }
    });
    Object.keys(bySymbol).forEach(function(symbol) {
      var item = bySymbol[symbol];
      var avgWeight = item.etf_count > 0 ? item.total_weight / item.etf_count : 0;
      var etfScore = Math.min(15, item.etf_count * 3 + avgWeight + item.sector_etf_count * 2);
      appendObjectRow_(AM_CONFIG.SHEETS.ETF_STOCK_SCORE, {
        date: today,
        symbol: symbol,
        etf_count: item.etf_count,
        avg_weight_pct: roundNumber_(avgWeight, 2),
        sector_etf_count: item.sector_etf_count,
        etf_score: roundNumber_(etfScore, 2)
      });
    });
    return bySymbol;
  });
}
