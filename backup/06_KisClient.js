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
  var lastError = null;
  
  // KIS 점검 및 통신 장애 시 3회 지수적 백오프 재시도 루프
  for (var attempt = 1; attempt <= 3; attempt++) {
    try {
      var response = kisGet_('/uapi/domestic-stock/v1/quotations/inquire-price', {
        FID_COND_MRKT_DIV_CODE: 'J',
        FID_INPUT_ISCD: symbol
      }, 'FHKST01010100');
      return normalizeKisCurrentPrice_(symbol, response);
    } catch (err) {
      lastError = err;
      logWarn_('kis_client', 'KIS domestic price fetch failed; retrying...', { symbol: symbol, attempt: attempt, error: err.message });
      Utilities.sleep(1000 * attempt); // 1초, 2초, 3초 지연
    }
  }
  
  // ==================================================
  // 🚀 [명품 우회 백업] KIS API 완전 실패 시 네이버 금융 실시간 크롤링 기동!
  // ==================================================
  logWarn_('kis_client', 'KIS price fetch completely failed after 3 attempts; trying Naver finance crawler', { symbol: symbol });
  try {
    var naverQuote = fetchNaverStockPrice_(symbol);
    if (naverQuote) {
      logInfo_('kis_client', 'Successfully fetched fallback price from Naver finance', { symbol: symbol, price: naverQuote.close, change: naverQuote.change_pct });
      return naverQuote;
    }
  } catch(naverErr) {
    logWarn_('kis_client', 'Naver price crawler fallback failed', { symbol: symbol, error: naverErr.message });
  }
  
  // 3회 실패 및 네이버 실패 시 데이터베이스 시트 백업 가격 조회 작동
  logWarn_('kis_client', 'Naver crawler failed; looking up database backup', { symbol: symbol });
  try {
    var backupPrice = getLatestBackupPriceForSymbol_(symbol);
    if (backupPrice > 0) {
      return {
        symbol: symbol,
        close: backupPrice,
        change_pct: 0,
        volume: 0,
        trading_value: 0,
        market: 'KOSPI',
        sector: '기타',
        is_backup: true
      };
    }
  } catch(ex) {
    logWarn_('kis_client', 'Database backup price lookup failed', { symbol: symbol, error: ex.message });
  }
  
  throw lastError;
}

/**
  * 네이버 금융 메인 페이지 웹 크롤링을 통한 실시간 현재가/등락률 획득 (EUC-KR 자동 변환 대응)
  */
function fetchNaverStockPrice_(symbol) {
  try {
    var cleanSymbol = normalizeStockSymbol_(symbol);
    var url = 'https://finance.naver.com/item/main.naver?code=' + cleanSymbol;
    var response = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    
    if (response.getResponseCode() === 200) {
      var html = response.getContentText('EUC-KR'); // 네이버 증권은 EUC-KR 인코딩 사용
      
      // 1. 현재가 파싱
      var priceMatch = html.match(/현재가\s+([0-9,]+)/i);
      var close = 0;
      if (priceMatch && priceMatch[1]) {
        close = Number(priceMatch[1].replace(/,/g, ''));
      } else {
        var blindMatch = html.match(/<p\s+class="no_today">[^]*?<span\s+class="blind">([0-9,]+)<\/span>/i);
        if (blindMatch && blindMatch[1]) {
          close = Number(blindMatch[1].replace(/,/g, ''));
        }
      }
      
      // 2. 등락률 파싱
      var changePct = 0;
      var changeMatch = html.match(/([플러스|마이너스]+)\s+([0-9.]+)\s+퍼센트/i);
      if (changeMatch && changeMatch[2]) {
        var sign = (changeMatch[1] === '플러스') ? 1 : -1;
        changePct = Number(changeMatch[2]) * sign;
      } else {
        var pctMatch = html.match(/([+\-]?([0-9.]+))\s*%/);
        if (pctMatch && pctMatch[2]) {
          changePct = Number(pctMatch[1]);
        }
      }
      
      // 3. 한글명 파싱
      var name = symbol;
      var ogTitleMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i);
      if (ogTitleMatch && ogTitleMatch[1]) {
        name = ogTitleMatch[1].split(':')[0].split('-')[0].trim();
      }
      
      if (close > 0) {
        return {
          symbol: cleanSymbol,
          name: name,
          close: close,
          change_pct: changePct,
          volume: 0,
          trading_value: 0,
          market: 'KOSPI',
          sector: 'ETF',
          is_naver_fallback: true
        };
      }
    }
  } catch(e) {
    logWarn_('kis_client', 'Failed to fetch price from Naver fallback for ' + symbol, { error: e.message });
  }
  return null;
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
    name: String(output.hts_kor_isnm || output.prdt_abrv_name || output.prdt_name || '').trim(),
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
          name: String(output.expl || output.name || symbol).trim(),
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

/**
 * KIS 가격 조회 최종 실패 시, 데이터베이스 시트에서 해당 종목의 가장 최신 시세를 백업으로 탐색합니다.
 */
function getLatestBackupPriceForSymbol_(symbol) {
  symbol = normalizeStockSymbol_(symbol);
  
  // 1순위: holdings_current 시트에서 최신 평가 가격 탐색
  try {
    var holdings = readObjects_(AM_CONFIG.SHEETS.HOLDINGS_CURRENT);
    var matches = holdings.filter(function(row) {
      return normalizeStockSymbol_(row.symbol) === symbol && Number(row.current_price || 0) > 0;
    });
    if (matches.length > 0) {
      matches.sort(function(a, b) {
        return String(b.date).localeCompare(String(a.date));
      });
      return Number(matches[0].current_price);
    }
  } catch(e) {}
  
  // 2순위: market_universe 시트에서 최종 백업 가격 탐색
  try {
    var universe = readObjects_(AM_CONFIG.SHEETS.MARKET_UNIVERSE);
    var matches = universe.filter(function(row) {
      return normalizeStockSymbol_(row.symbol) === symbol && Number(row.close || row.current_price || 0) > 0;
    });
    if (matches.length > 0) {
      return Number(matches[0].close || matches[0].current_price);
    }
  } catch(e) {}
  
  return 0; // 백업 실패 시 0 리턴
}
