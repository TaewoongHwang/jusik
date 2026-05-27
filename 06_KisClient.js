function kisGet_(path, params, trId) {
  validateRealRuntimeConfig_();
  var baseUrl = getScriptProperty_(AM_CONFIG.PROPERTY_KEYS.KIS_BASE_URL, AM_CONFIG.DEFAULT_KIS_BASE_URL);
  var appKey = getRequiredScriptProperty_(AM_CONFIG.PROPERTY_KEYS.KIS_APP_KEY);
  var appSecret = getRequiredScriptProperty_(AM_CONFIG.PROPERTY_KEYS.KIS_APP_SECRET);
  var query = buildQueryString_(params || {});
  var url = baseUrl + path + (query ? '?' + query : '');
  return apiFetchJson_(url, {
    method: 'get',
    headers: {
      'content-type': 'application/json; charset=utf-8',
      authorization: 'Bearer ' + getKisAccessToken_(),
      appkey: appKey,
      appsecret: appSecret,
      tr_id: trId
    },
    muteHttpExceptions: true
  }, 'kis_client');
}

function fetchKisCurrentPrice_(symbol) {
  symbol = normalizeStockSymbol_(symbol);
  var response = kisGet_('/uapi/domestic-stock/v1/quotations/inquire-price', {
    FID_COND_MRKT_DIV_CODE: 'J',
    FID_INPUT_ISCD: symbol
  }, 'FHKST01010100');
  return normalizeKisCurrentPrice_(symbol, response);
}

function fetchKisDailyPrices_(symbol, startDate, endDate) {
  symbol = normalizeStockSymbol_(symbol);
  var response = kisGet_('/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice', {
    FID_COND_MRKT_DIV_CODE: 'J',
    FID_INPUT_ISCD: symbol,
    FID_INPUT_DATE_1: startDate,
    FID_INPUT_DATE_2: endDate,
    FID_PERIOD_DIV_CODE: 'D',
    FID_ORG_ADJ_PRC: '0'
  }, 'FHKST03010100');
  return normalizeKisDailyPrices_(symbol, response);
}

function normalizeKisCurrentPrice_(symbol, response) {
  var output = response.output || response;
  if (!output || !output.stck_prpr) {
    throw new Error('KIS current price response missing output.stck_prpr for ' + symbol + ': ' + JSON.stringify(response));
  }
  var close = Number(output.stck_prpr || output.close || 0);
  if (close <= 0) {
    throw new Error('KIS current price is zero for ' + symbol + '. Check whether the stock is delisted, merged, suspended, or an invalid symbol: ' + JSON.stringify(response));
  }
  return {
    symbol: symbol,
    close: close,
    change_pct: Number(output.prdy_ctrt || output.change_pct || 0),
    volume: Number(output.acml_vol || output.volume || 0),
    trading_value: Number(output.acml_tr_pbmn || output.trading_value || 0),
    market: normalizeKisMarketName_(output.rprs_mrkt_kor_name || ''),
    sector: String(output.bstp_kor_isnm || '').trim(),
    raw: response
  };
}

function normalizeKisMarketName_(value) {
  var text = String(value || '').trim();
  var upper = text.toUpperCase();
  if (upper.indexOf('KOSDAQ') >= 0 || text.indexOf('코스닥') >= 0) return 'KOSDAQ';
  if (upper.indexOf('KOSPI') >= 0 || text.indexOf('유가') >= 0) return 'KOSPI';
  if (upper.indexOf('KONEX') >= 0 || text.indexOf('코넥스') >= 0) return 'KONEX';
  return text;
}

function normalizeKisDailyPrices_(symbol, response) {
  var output = response.output2 || response.output || [];
  if (!Array.isArray(output) || output.length === 0) {
    throw new Error('KIS daily price response missing output2 rows for ' + symbol + ': ' + JSON.stringify(response));
  }
  return output.map(function(row) {
    return {
      symbol: symbol,
      date: row.stck_bsop_date,
      open: Number(row.stck_oprc || 0),
      high: Number(row.stck_hgpr || 0),
      low: Number(row.stck_lwpr || 0),
      close: Number(row.stck_clpr || 0),
      volume: Number(row.acml_vol || 0),
      trading_value: Number(row.acml_tr_pbmn || 0),
      raw: row
    };
  }).filter(function(row) {
    return row.date && row.close > 0;
  }).sort(function(a, b) {
    return String(a.date).localeCompare(String(b.date));
  });
}

function testKisCurrentPrice(symbol) {
  return withLogging_('kis_client', function() {
    var targetSymbol = symbol || '005930';
    var quote = fetchKisCurrentPrice_(targetSymbol);
    logInfo_('kis_client', 'KIS current price test succeeded', {
      symbol: targetSymbol,
      close: quote.close,
      change_pct: quote.change_pct
    });
    return quote;
  });
}

function testKisDailyPrices(symbol) {
  return withLogging_('kis_client', function() {
    var targetSymbol = symbol || '005930';
    var endDate = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd');
    var startDate = Utilities.formatDate(new Date(new Date().getTime() - 180 * 24 * 60 * 60 * 1000), Session.getScriptTimeZone(), 'yyyyMMdd');
    var rows = fetchKisDailyPrices_(targetSymbol, startDate, endDate);
    logInfo_('kis_client', 'KIS daily price test succeeded', {
      symbol: targetSymbol,
      rows: rows.length
    });
    return rows.slice(-5);
  });
}

function fetchKisOverseasCurrentPrice_(symbol) {
  symbol = String(symbol || '').trim().toUpperCase();
  var exchanges = ['NAS', 'NYS', 'AMS'];
  
  // 주요 미국 빅테크 종목 거래소 다이렉트 매핑 (스캔 지연 100% 방지)
  var directMappings = {
    'NVDA': 'NAS', 'AAPL': 'NAS', 'MSFT': 'NAS', 'TSLA': 'NAS',
    'AMZN': 'NAS', 'GOOGL': 'NAS', 'GOOG': 'NAS', 'META': 'NAS',
    'NFLX': 'NAS', 'AVGO': 'NAS', 'AMD': 'NAS', 'QCOM': 'NAS',
    'T': 'NYS', 'DIS': 'NYS', 'KO': 'NYS', 'PEP': 'NYS',
    'NKE': 'NYS', 'XOM': 'NYS', 'JPM': 'NYS', 'V': 'NYS'
  };
  
  if (directMappings[symbol]) {
    exchanges = [directMappings[symbol]];
  }
  
  var lastErr = null;
  for (var i = 0; i < exchanges.length; i++) {
    try {
      var response = kisGet_('/uapi/overseas-price/v1/quotations/price', {
        AUTH_CODE: '',
        EXCD: exchanges[i],
        SYMB: symbol
      }, 'HHDFS00000300');
      
      var output = response.output || response;
      if (output && output.last && Number(output.last) > 0) {
        return {
          symbol: symbol,
          close: Number(output.last),
          change_pct: Number(output.rate || 0),
          exchange: exchanges[i],
          raw: response
        };
      }
    } catch (err) {
      lastErr = err;
    }
  }
  
  throw new Error('Failed to fetch KIS overseas current price for ' + symbol + '. Last error: ' + (lastErr ? lastErr.message : 'unknown'));
}

function fetchUpbitCurrentPrice_(market) {
  market = String(market || '').trim().toUpperCase();
  if (market.indexOf('KRW-') !== 0) {
    market = 'KRW-' + market;
  }
  
  // CacheService 캐싱 우선 시도 (10분 캐싱)
  var cache = CacheService.getScriptCache();
  var cacheKey = 'UPBIT_TICKER_' + market;
  var cached = cache.get(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch(e) {}
  }
  
  var url = 'https://api.upbit.com/v1/ticker?markets=' + market;
  var response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  var resCode = response.getResponseCode();
  var resText = response.getContentText();
  
  if (resCode !== 200) {
    throw new Error('Upbit ticker query failed: ' + resText);
  }
  
  var json = JSON.parse(resText);
  if (!Array.isArray(json) || json.length === 0) {
    throw new Error('Upbit ticker response empty for ' + market);
  }
  
  var result = {
    symbol: market.replace('KRW-', ''),
    close: Number(json[0].trade_price || 0),
    change_pct: roundNumber_(Number((json[0].signed_change_rate || 0) * 100), 2)
  };
  
  // 10분간 메모리 캐싱 (600초)
  cache.put(cacheKey, JSON.stringify(result), 600);
  
  return result;
}
