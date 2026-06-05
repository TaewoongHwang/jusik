function kisPost_(path, payload, trId, customAuth) {
  var baseUrl = String(getScriptProperty_(AM_CONFIG.PROPERTY_KEYS.KIS_BASE_URL, AM_CONFIG.DEFAULT_KIS_BASE_URL)).trim();
  var appKey = sanitizeKey_(getScriptProperty_(AM_CONFIG.PROPERTY_KEYS.KIS_APP_KEY, ''));
  var appSecret = sanitizeKey_(getScriptProperty_(AM_CONFIG.PROPERTY_KEYS.KIS_APP_SECRET, ''));
  
  if (customAuth) {
    if (customAuth.appKey && customAuth.appSecret) {
      appKey = sanitizeKey_(customAuth.appKey);
      appSecret = sanitizeKey_(customAuth.appSecret);
    }
    if (customAuth.baseUrl) {
      baseUrl = String(customAuth.baseUrl).trim();
    }
  }
  
  if (!appKey || !appSecret) {
    throw new Error('KIS_APP_KEY or KIS_APP_SECRET is missing. Please configure them.');
  }
  
  var url = baseUrl + path;
  
  return apiFetchJson_(url, {
    method: 'post',
    headers: {
      'content-type': 'application/json; charset=utf-8',
      authorization: 'Bearer ' + getKisAccessToken_(customAuth),
      appkey: appKey,
      appsecret: appSecret,
      tr_id: trId
    },
    payload: JSON.stringify(payload || {}),
    muteHttpExceptions: true
  });
}

function kisGet_(path, params, trId, customAuth) {
  var baseUrl = String(getScriptProperty_(AM_CONFIG.PROPERTY_KEYS.KIS_BASE_URL, AM_CONFIG.DEFAULT_KIS_BASE_URL)).trim();
  var appKey = sanitizeKey_(getScriptProperty_(AM_CONFIG.PROPERTY_KEYS.KIS_APP_KEY, ''));
  var appSecret = sanitizeKey_(getScriptProperty_(AM_CONFIG.PROPERTY_KEYS.KIS_APP_SECRET, ''));
  
  if (customAuth) {
    if (customAuth.appKey && customAuth.appSecret) {
      appKey = sanitizeKey_(customAuth.appKey);
      appSecret = sanitizeKey_(customAuth.appSecret);
    }
    if (customAuth.baseUrl) {
      baseUrl = String(customAuth.baseUrl).trim();
    }
  }
  
  if (!appKey || !appSecret) {
    throw new Error('KIS_APP_KEY or KIS_APP_SECRET is missing. Please configure them.');
  }
  
  var query = buildQueryString_(params || {});
  var url = baseUrl + path + (query ? '?' + query : '');
  
  return apiFetchJson_(url, {
    method: 'get',
    headers: {
      'content-type': 'application/json; charset=utf-8',
      authorization: 'Bearer ' + getKisAccessToken_(customAuth),
      appkey: appKey,
      appsecret: appSecret,
      tr_id: trId
    },
    muteHttpExceptions: true
  });
}

function buildQueryString_(params) {
  return Object.keys(params).map(function(key) {
    return encodeURIComponent(key) + '=' + encodeURIComponent(params[key]);
  }).join('&');
}

function apiFetchJson_(url, options) {
  var response = UrlFetchApp.fetch(url, options);
  var text = response.getContentText();
  if (response.getResponseCode() !== 200) {
    throw new Error('API fetch failed with code ' + response.getResponseCode() + ': ' + text);
  }
  var json = JSON.parse(text);
  if (json && json.rt_cd !== undefined && json.rt_cd !== null && String(json.rt_cd) !== '0') {
    throw new Error('KIS API Business Error (' + json.rt_cd + '): ' + (json.msg1 || 'Unknown business error') + ' [Code: ' + (json.msg_cd || '') + ']');
  }
  return json;
}

function getKisAccessToken_(customAuth) {
  var appKey = sanitizeKey_(getScriptProperty_(AM_CONFIG.PROPERTY_KEYS.KIS_APP_KEY, ''));
  var appSecret = sanitizeKey_(getScriptProperty_(AM_CONFIG.PROPERTY_KEYS.KIS_APP_SECRET, ''));
  var baseUrl = String(getScriptProperty_(AM_CONFIG.PROPERTY_KEYS.KIS_BASE_URL, AM_CONFIG.DEFAULT_KIS_BASE_URL)).trim();
  
  if (customAuth) {
    if (customAuth.appKey && customAuth.appSecret) {
      appKey = sanitizeKey_(customAuth.appKey);
      appSecret = sanitizeKey_(customAuth.appSecret);
    }
    if (customAuth.baseUrl) {
      baseUrl = String(customAuth.baseUrl).trim();
    }
  }
  
  // AppKey 별로 고유한 프로퍼티 캐시 키 생성 (뒤 6자리만 섞음)
  var keyHash = appKey ? appKey.substring(Math.max(0, appKey.length - 6)) : 'default';
  var propKey = AM_CONFIG.PROPERTY_KEYS.KIS_ACCESS_TOKEN + '_' + keyHash;
  var propExpiryKey = AM_CONFIG.PROPERTY_KEYS.KIS_ACCESS_TOKEN_EXPIRES_AT + '_' + keyHash;
  
  var token = getScriptProperty_(propKey, null);
  var expiresAt = Number(getScriptProperty_(propExpiryKey, 0));
  var now = new Date().getTime();
  
  if (token && expiresAt > now + 600000) { // 10분 마진
    return token;
  }
  
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    throw new Error('Access Token 생성 중 락을 획득하지 못했습니다.');
  }
  
  try {
    token = getScriptProperty_(propKey, null);
    expiresAt = Number(getScriptProperty_(propExpiryKey, 0));
    if (token && expiresAt > now + 600000) {
      return token;
    }
    
    if (!appKey || !appSecret) {
      throw new Error('KIS_APP_KEY or KIS_APP_SECRET is missing for access token.');
    }
    
    var response = UrlFetchApp.fetch(baseUrl + '/oauth2/tokenP', {
      method: 'post',
      headers: {
        'Content-Type': 'application/json; charset=utf-8'
      },
      payload: JSON.stringify({
        grant_type: 'client_credentials',
        appkey: appKey,
        appsecret: appSecret
      }),
      muteHttpExceptions: true
    });
    
    var text = response.getContentText();
    if (response.getResponseCode() !== 200) {
      throw new Error('KIS token generation failed: ' + text);
    }
    
    var res = JSON.parse(text);
    if (!res.access_token) {
      throw new Error('KIS token missing in response: ' + text);
    }
    
    setScriptProperty_(propKey, res.access_token);
    var expiry = new Date().getTime() + (Number(res.expires_in || 7200) * 1000);
    setScriptProperty_(propExpiryKey, expiry);
    
    logInfo_('kis_auth', 'Generated new KIS access token for appkey suffix ' + keyHash, { expires_at: new Date(expiry).toLocaleString() });
    return res.access_token;
  } finally {
    lock.releaseLock();
  }
}

/**
 * 🚀 [신설] 계좌번호와 상품코드의 유해 공백/하이픈 제거 및 스마트 10자리/하이픈 자동 분할 정제기
 */
function cleanAndExtractKisAccount_(canoVal, prdtCdVal) {
  var rawCano = String(canoVal || '').trim();
  var rawPrdt = String(prdtCdVal || '').trim();
  
  // 보이지 않는 제로너비 공백 및 특수 공백 소거
  var cleaningRegex = /[\u200B-\u200D\uFEFF\u00A0\u1680\u180E\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\s]/g;
  rawCano = rawCano.replace(cleaningRegex, '');
  rawPrdt = rawPrdt.replace(cleaningRegex, '');

  var cleanCano = '';
  var cleanPrdt = rawPrdt;
  
  if (rawCano) {
    // 1. 하이픈 기준 분할 시도 (예: "12345678-03" -> ["12345678", "03"])
    var parts = rawCano.split('-');
    if (parts.length > 1) {
      cleanCano = parts[0].replace(/[^0-9]/g, '');
      if (!cleanPrdt) {
        cleanPrdt = parts[1].replace(/[^0-9]/g, '');
      }
    } else {
      // 2. 숫자가 아닌 모든 문자 제거
      var digits = rawCano.replace(/[^0-9]/g, '');
      if (digits.length === 10) {
        // 10자리인 경우 8자리 계좌번호 + 2자리 상품코드로 자동 분할
        cleanCano = digits.substring(0, 8);
        if (!cleanPrdt) {
          cleanPrdt = digits.substring(8, 10);
        }
      } else {
        cleanCano = digits;
      }
    }
  }
  
  // 상품코드 정화 및 자릿수 맞춤
  cleanPrdt = cleanPrdt.replace(/[^0-9]/g, '');
  if (cleanPrdt.length === 1) {
    cleanPrdt = '0' + cleanPrdt;
  }
  
  return {
    cano: cleanCano.substring(0, 8),
    productCode: cleanPrdt.substring(0, 2)
  };
}

function getKisAccountConfig_() {
  var service = PropertiesService.getScriptProperties();
  var cano = service.getProperty(AM_CONFIG.PROPERTY_KEYS.KIS_CANO) || '';
  var accountProductCode = service.getProperty(AM_CONFIG.PROPERTY_KEYS.KIS_ACNT_PRDT_CD) || '01';
  var isaCano = service.getProperty(AM_CONFIG.PROPERTY_KEYS.KIS_ISA_CANO) || '';
  var isaProductCode = service.getProperty(AM_CONFIG.PROPERTY_KEYS.KIS_ISA_ACNT_PRDT_CD) || '';
  var isaAppKey = service.getProperty(AM_CONFIG.PROPERTY_KEYS.KIS_ISA_APP_KEY) || '';
  var isaAppSecret = service.getProperty(AM_CONFIG.PROPERTY_KEYS.KIS_ISA_APP_SECRET) || '';
  
  // 모의투자 속성 로드
  var mockCano = service.getProperty(AM_CONFIG.PROPERTY_KEYS.KIS_MOCK_CANO) || '';
  var mockProductCode = service.getProperty(AM_CONFIG.PROPERTY_KEYS.KIS_MOCK_ACNT_PRDT_CD) || '';
  var mockAppKey = service.getProperty(AM_CONFIG.PROPERTY_KEYS.KIS_MOCK_APP_KEY) || '';
  var mockAppSecret = service.getProperty(AM_CONFIG.PROPERTY_KEYS.KIS_MOCK_APP_SECRET) || '';
  var mockBaseUrl = service.getProperty(AM_CONFIG.PROPERTY_KEYS.KIS_MOCK_BASE_URL) || '';
  
  // 🚀 [자율 동기화 세이프 가드] 만약 Properties 에 ISA 또는 MOCK 정보가 비어있다면 settings 시트에서 즉시 자동 룩업 동기화
  if (!isaCano || !isaProductCode || !mockCano || !mockProductCode) {
    try {
      var settingsRows = readObjects_(AM_CONFIG.SHEETS.SETTINGS) || [];
      var sheetProps = {};
      var hasUpdates = false;
      
      settingsRows.forEach(function(row) {
        var key = String(row.key || '').trim();
        var val = String(row.value !== undefined && row.value !== null ? row.value : '').trim();
        if (key && val && val.indexOf('****') < 0) {
          if (key === 'KIS_ISA_CANO' && !isaCano) {
            isaCano = val;
            sheetProps[key] = val;
            hasUpdates = true;
          }
          if (key === 'KIS_ISA_ACNT_PRDT_CD' && !isaProductCode) {
            isaProductCode = val;
            sheetProps[key] = val;
            hasUpdates = true;
          }
          if (key === 'KIS_ISA_APP_KEY' && !isaAppKey) {
            isaAppKey = val;
            sheetProps[key] = val;
            hasUpdates = true;
          }
          if (key === 'KIS_ISA_APP_SECRET' && !isaAppSecret) {
            isaAppSecret = val;
            sheetProps[key] = val;
            hasUpdates = true;
          }
          if (key === 'KIS_MOCK_CANO' && !mockCano) {
            mockCano = val;
            sheetProps[key] = val;
            hasUpdates = true;
          }
          if (key === 'KIS_MOCK_ACNT_PRDT_CD' && !mockProductCode) {
            mockProductCode = val;
            sheetProps[key] = val;
            hasUpdates = true;
          }
          if (key === 'KIS_MOCK_APP_KEY' && !mockAppKey) {
            mockAppKey = val;
            sheetProps[key] = val;
            hasUpdates = true;
          }
          if (key === 'KIS_MOCK_APP_SECRET' && !mockAppSecret) {
            mockAppSecret = val;
            sheetProps[key] = val;
            hasUpdates = true;
          }
          if (key === 'KIS_MOCK_BASE_URL' && !mockBaseUrl) {
            mockBaseUrl = val;
            sheetProps[key] = val;
            hasUpdates = true;
          }
        }
      });
      
      if (hasUpdates) {
        service.setProperties(sheetProps, false);
        logInfo_('properties_sync', 'Auto-synced ISA/MOCK account config from Settings sheet', {
          keys: Object.keys(sheetProps)
        });
      }
    } catch(syncErr) {
      logWarn_('properties_sync', 'Auto-sync config failed', { error: syncErr.message });
    }
  }
  
  // 🚀 [강화된 계좌번호 및 상품코드 스마트 정제 및 추출]
  var cleanNormal = cleanAndExtractKisAccount_(cano, accountProductCode);
  var cleanIsa = cleanAndExtractKisAccount_(isaCano, isaProductCode);
  var cleanMock = cleanAndExtractKisAccount_(mockCano, mockProductCode);
  
  // 원격 추적성을 위한 안전 마스킹 로깅 (앞 4자리 노출)
  var debugNormalCano = cleanNormal.cano ? (cleanNormal.cano.substring(0, 4) + '****') : 'MISSING';
  var debugIsaCano = cleanIsa.cano ? (cleanIsa.cano.substring(0, 4) + '****') : 'MISSING';
  var debugMockCano = cleanMock.cano ? (cleanMock.cano.substring(0, 4) + '****') : 'MISSING';
  logInfo_('kis_client', 'Resolved sanitized KIS account configuration', {
    cano: debugNormalCano,
    productCode: cleanNormal.productCode,
    isaCano: debugIsaCano,
    isaProductCode: cleanIsa.productCode,
    mockCano: debugMockCano,
    mockProductCode: cleanMock.productCode
  });
  
  return {
    cano: cleanNormal.cano,
    accountProductCode: cleanNormal.productCode || '01',
    isaCano: cleanIsa.cano,
    isaProductCode: cleanIsa.productCode,
    isaAppKey: sanitizeKey_(isaAppKey),
    isaAppSecret: sanitizeKey_(isaAppSecret),
    mockCano: cleanMock.cano,
    mockProductCode: cleanMock.productCode || '01',
    mockAppKey: sanitizeKey_(mockAppKey),
    mockAppSecret: sanitizeKey_(mockAppSecret),
    mockBaseUrl: mockBaseUrl || 'https://openapivts.koreainvestment.com:29443'
  };
}

// ==================================================
// 🚀 실시간 주가 / 등락률 조회 코어 함수
// ==================================================

function fetchKisCurrentPrice_(symbol) {
  symbol = normalizeStockSymbol_(symbol);
  
  // 🚀 [초고속 3분 시세 캐시 피드] 중복 호출 병목 제거
  var cacheKey = 'PRICE_DOM_' + symbol;
  try {
    var cached = CacheService.getScriptCache().get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }
  } catch(e) {}
  
  var lastError = null;
  var quote = null;
  
  // 1. KIS 국내 현재가 API 3회 지수적 백오프 재시도 루프
  for (var attempt = 1; attempt <= 3; attempt++) {
    try {
      var response = kisGet_('/uapi/domestic-stock/v1/quotations/inquire-price', {
        FID_COND_MRKT_DIV_CODE: 'J',
        FID_INPUT_ISCD: symbol
      }, 'FHKST01010100');
      quote = normalizeKisCurrentPrice_(symbol, response);
      break;
    } catch (err) {
      lastError = err;
      logWarn_('kis_client', 'KIS domestic price fetch failed; retrying...', { symbol: symbol, attempt: attempt, error: err.message });
      Utilities.sleep(1000 * attempt);
    }
  }
  
  // 2. 🚀 [우회 백업] KIS 완전 실패 시 네이버 금융 실시간 크롤러 구동
  if (!quote) {
    logWarn_('kis_client', 'KIS price fetch failed after 3 attempts; trying Naver finance crawler', { symbol: symbol });
    try {
      var naverQuote = fetchNaverStockPrice_(symbol);
      if (naverQuote) {
        quote = naverQuote;
      }
    } catch(naverErr) {
      logWarn_('kis_client', 'Naver price crawler fallback failed', { symbol: symbol, error: naverErr.message });
    }
  }
  
  if (quote) {
    try {
      CacheService.getScriptCache().put(cacheKey, JSON.stringify(quote), 600); // 10분 캐싱
    } catch(e) {}
    return quote;
  }
  
  throw lastError || new Error('Failed to fetch price for ' + symbol);
}

function normalizeKisCurrentPrice_(symbol, response) {
  var output = response.output || response;
  if (!output || !output.stck_prpr) {
    throw new Error('KIS current price response missing output.stck_prpr for ' + symbol);
  }
  var close = Number(output.stck_prpr || output.close || 0);
  if (close <= 0) {
    throw new Error('KIS current price is zero for ' + symbol);
  }
  return {
    symbol: symbol,
    name: String(output.hts_kor_isnm || output.prdt_abrv_name || output.prdt_name || '').trim(),
    close: close,
    change_pct: Number(output.prdy_ctrt || output.change_pct || 0),
    volume: Number(output.acml_vol || output.volume || 0),
    trading_value: Number(output.acml_tr_pbmn || output.trading_value || 0),
    market: 'KOSPI',
    sector: String(output.bstp_kor_isnm || '').trim()
  };
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
      var html = response.getContentText('EUC-KR'); // 네이버 증권 EUC-KR
      
      // 1. 현재가 파싱 (클래스 no_today 기반 정교한 파싱 1순위 적용)
      var close = 0;
      var blindMatch = html.match(/<p\s+class="no_today">[^]*?<span\s+class="blind">([0-9,]+)<\/span>/i);
      if (blindMatch && blindMatch[1]) {
        close = Number(blindMatch[1].replace(/,/g, ''));
      } else {
        var priceMatch = html.match(/현재가\s+([0-9,]+)/i);
        if (priceMatch && priceMatch[1]) {
          close = Number(priceMatch[1].replace(/,/g, ''));
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
          sector: 'ETF'
        };
      }
    }
  } catch(e) {
    logWarn_('kis_client', 'Failed to fetch price from Naver fallback for ' + symbol, { error: e.message });
  }
  return null;
}

function fetchYahooOverseasCurrentPrice_(symbol) {
  var cleanSymbol = normalizeStockSymbol_(symbol);
  try {
    var url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(cleanSymbol);
    var response = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    
    if (response.getResponseCode() === 200) {
      var jsonStr = response.getContentText('UTF-8');
      var obj = JSON.parse(jsonStr);
      var chart = obj.chart;
      if (chart && chart.result && chart.result[0]) {
        var result = chart.result[0];
        var meta = result.meta;
        var close = parseFloat(meta.regularMarketPrice || 0); // 실시간 현재 주가
        var prevClose = parseFloat(meta.chartPreviousClose || 0); // 전일 종가
        
        var changeAmt = close - prevClose;
        var changePct = prevClose > 0 ? (changeAmt / prevClose * 100) : 0;
        
        if (close > 0) {
          logInfo_('yahoo_fallback', 'Successfully fetched overseas price from Yahoo Finance for ' + symbol, { close: close, pct: changePct });
          return {
            symbol: cleanSymbol,
            name: symbol,
            close: close,
            change_pct: changePct,
            volume: 0,
            trading_value: 0,
            market: 'US_STOCK',
            sector: '해외주식'
          };
        }
      }
    }
  } catch(e) {
    logWarn_('yahoo_fallback', 'Failed to fetch overseas price from Yahoo Finance for ' + symbol, { error: e.message });
  }
  return null;
}

function fetchKisOverseasCurrentPrice_(symbol) {
  symbol = normalizeStockSymbol_(symbol);
  
  // 🚀 [초고속 3분 시세 캐시 피드] 중복 호출 병목 제거
  var cacheKey = 'PRICE_OVS_' + symbol;
  try {
    var cached = CacheService.getScriptCache().get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }
  } catch(e) {}
  
  var quote = null;
  
  // 🚀 [1순위 최우선 조회망] 야후 파이낸스로 초고속 실시간 등락률/현재가 획득
  try {
    quote = fetchYahooOverseasCurrentPrice_(symbol);
    if (quote && quote.close > 0) {
      logInfo_('kis_client', 'Successfully fetched real-time price from Yahoo (Core) for ' + symbol, { close: quote.close, pct: quote.change_pct });
    }
  } catch(yahooErr) {
    logWarn_('kis_client', 'Yahoo Finance core fetch failed; falling back to KIS API', { symbol: symbol, error: yahooErr.message });
  }
  
  // 🚀 [2순위 백업 폴백] 야후 파이낸스 실패 시에만 한국투자증권(KIS) 해외 시세 API 구동
  if (!quote) {
    try {
      // 미국 주식 거래소 매핑
      var exchange = 'NAS';
      var nyseList = ['NYS', 'T', 'DIS', 'KO', 'PEP', 'JNJ', 'PG', 'XOM', 'CVX', 'BRK.B', 'V', 'MA'];
      if (nyseList.indexOf(symbol) >= 0) {
        exchange = 'NYS';
      }
      
      var response = kisGet_('/uapi/overseas-price/v1/quotations/price', {
        AUTH: '',
        EXCD: exchange,
        SYMB: symbol
      }, 'HHDFS76201E0');
      
      var output = response.output || response;
      var close = Number(output.last || 0);
      if (close > 0) {
        quote = {
          symbol: symbol,
          name: String(output.name || symbol).trim(),
          close: close,
          change_pct: Number(output.rate || 0),
          volume: Number(output.tvol || 0),
          trading_value: Number(output.tamt || 0),
          market: 'US_STOCK',
          sector: '해외주식'
        };
      }
    } catch(e) {
      logWarn_('kis_client', 'Backup KIS API also failed for overseas symbol ' + symbol, { error: e.message });
    }
  }
  
  if (quote) {
    try {
      CacheService.getScriptCache().put(cacheKey, JSON.stringify(quote), 600); // 10분 캐싱
    } catch(e) {}
    return quote;
  }
  
  throw new Error('All overseas price fetches failed for ' + symbol);
}

// ==================================================
// 🚀 업비트 가상자산 시세 조회
// ==================================================

function fetchUpbitCurrentPrice_(market) {
  var cleanMarket = String(market || '').trim().toUpperCase();
  if (cleanMarket.indexOf('KRW-') !== 0) {
    cleanMarket = 'KRW-' + cleanMarket;
  }
  var url = 'https://api.upbit.com/v1/ticker?markets=' + cleanMarket;
  var response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) {
    throw new Error('Upbit API fetch failed: ' + response.getContentText());
  }
  var res = JSON.parse(response.getContentText());
  if (!Array.isArray(res) || res.length === 0) {
    throw new Error('Upbit ticker empty for ' + cleanMarket);
  }
  var t = res[0];
  return {
    symbol: cleanMarket.replace('KRW-', ''),
    name: cleanMarket.replace('KRW-', ''),
    close: parseFloat(t.trade_price || 0),
    change_pct: parseFloat(t.signed_change_rate || 0) * 100,
    volume: parseFloat(t.acc_trade_volume || 0),
    trading_value: parseFloat(t.acc_trade_price_24h || 0),
    market: 'UPBIT',
    sector: 'COIN'
  };
}

// ==================================================
// 🚀 국내 특수 ETF 단축코드 한글명 수동 매핑 사전
// ==================================================

function getStockKoreanName_(symbol, fallbackName) {
  var cleanSymbol = normalizeStockSymbol_(symbol);
  
  // 1. 하드코딩 매핑 사전 (초대형 우량주 기본 가이드)
  var etfMappings = {
    // 국내 특수 ETF 및 핵심 우량주 30종
    '0167A0': 'SOL AI반도체TOP2플러스',
    '005930': '삼성전자',
    '000660': 'SK하이닉스',
    '005380': '현대차',
    '000270': '기아',
    '068270': '셀트리온',
    '373220': 'LG에너지솔루션',
    '207940': '삼성바이오로직스',
    '105560': 'KB금융',
    '055550': '신한지주',
    '035420': 'NAVER',
    '035720': '카카오',
    '051910': 'LG화학',
    '005490': 'POSCO홀딩스',
    '028260': '삼성물산',
    '012330': '현대모비스',
    '000810': '삼성화재',
    '015760': '한국전력',
    '032830': '삼성생명',
    '086790': '하나금융지주',
    '017670': 'SK텔레콤',
    '003550': 'LG',
    '034730': 'SK',
    '009150': '삼성전기',
    '010130': '고려아연',
    '018260': '삼성에스디에스',
    '000720': '현대건설',
    '003670': '포스코퓨처엠',
    '035250': '강원랜드',
    '009830': '한화솔루션',
    '011170': '롯데케미칼',
    
    // 미국 주요 대형주 및 핵심 우량주 21종
    'GOOG': '알파벳 C (구글 C)',
    'GOOGL': '알파벳 A (구글 A)',
    'NVDA': '엔비디아 (NVIDIA)',
    'AAPL': '애플 (Apple)',
    'MSFT': '마이크로소프트 (Microsoft)',
    'TSLA': '테슬라 (Tesla)',
    'AMZN': '아마존 (Amazon)',
    'META': '메타 (Meta)',
    'NFLX': '넷플릭스 (Netflix)',
    'AVGO': '브로드컴 (Broadcom)',
    'ARM': '암 홀딩스 (ARM)',
    'ASML': 'ASML 홀딩 (ASML)',
    'AMD': 'AMD',
    'NKE': '나이키 (Nike)',
    'KO': '코카콜라 (Coca-Cola)',
    'DIS': '디즈니 (Disney)',
    'PEP': '펩시코 (PepsiCo)',
    'NVO': '노보 노디스크 (Novo Nordisk)',
    'LLY': '일라이 릴리 (Eli Lilly)',
    'JNJ': '존슨앤존슨 (J&J)',
    'V': '비자 (Visa)',
    'MA': '마스터카드 (Mastercard)',
    'PG': '프록터앤갬블 (P&G)',
    'XOM': '엑슨모빌 (ExxonMobil)',
    'HD': '홈디포 (Home Depot)',
    'COST': '코스트코 (Costco)',
    'ABBV': '애브비 (AbbVie)',
    'UNH': '유나이티드헬스 (UNH)',
    'JPM': '제이피모간 체이스 (JPM)',
    'NVDA.O': '엔비디아 (NVIDIA)'
  };
  
  if (etfMappings[cleanSymbol]) {
    return etfMappings[cleanSymbol];
  }
  
  var cleanFallback = String(fallbackName || '').trim();
  if (cleanFallback && cleanFallback.toUpperCase() !== cleanSymbol && !/^[0-9]/.test(cleanFallback)) {
    return cleanFallback;
  }
  
  var cacheKey = 'AM_NAME_' + cleanSymbol;
  
  // [1단계 검사] CacheService 메모리 캐싱 (매우 빠름, 3일 보존)
  try {
    var cached = CacheService.getScriptCache().get(cacheKey);
    if (cached && cached !== cleanSymbol && !/^[0-9]/.test(cached)) return cached;
  } catch(e) {}
  
  // [2단계 검사] PropertiesService 영구 캐싱 (디스크 반영구 보존)
  try {
    var propName = PropertiesService.getScriptProperties().getProperty(cacheKey);
    if (propName && propName !== cleanSymbol && !/^[0-9]/.test(propName)) {
      // 메모리 캐시로 승격(Cache hit 레이턴시 단축)
      try { CacheService.getScriptCache().put(cacheKey, propName, 259200); } catch(ce) {}
      return propName;
    }
  } catch(e) {}
  
  // [3단계 검사] manual_holdings 수동 이름 룩업 (사용자 수동 제어)
  try {
    var manuals = readObjects_(AM_CONFIG.SHEETS.MANUAL_HOLDINGS);
    var manualMatch = manuals.filter(function(row) {
      return normalizeStockSymbol_(row.symbol) === cleanSymbol && row.name && row.name !== cleanSymbol && !/^[0-9]/.test(row.name);
    });
    if (manualMatch.length > 0) {
      var name = manualMatch[0].name;
      try { CacheService.getScriptCache().put(cacheKey, name, 259200); } catch(ce) {}
      try { PropertiesService.getScriptProperties().setProperty(cacheKey, name); } catch(pe) {}
      return name;
    }
  } catch(e) {}
  
  // [4단계 검사] 실시간 시세 조회를 통한 상품 한글명 획득 시도 (온디맨드 자동 학습)
  var resolvedName = null;
  try {
    var isOverseas = /^[A-Za-z]/.test(cleanSymbol);
    var quote;
    if (isOverseas) {
      quote = fetchSingleKisOverseasNameAndPrice_(cleanSymbol);
    } else {
      quote = fetchKisCurrentPrice_(cleanSymbol);
    }
    if (quote && quote.name && quote.name !== cleanSymbol && !/^[0-9]/.test(quote.name)) {
      resolvedName = quote.name;
    }
  } catch(e) {}
  
  if (resolvedName) {
    try { CacheService.getScriptCache().put(cacheKey, resolvedName, 259200); } catch(ce) {}
    try { PropertiesService.getScriptProperties().setProperty(cacheKey, resolvedName); } catch(pe) {}
    return resolvedName;
  }
  
  return fallbackName || symbol;
}

/**
 * 🚀 순환 재귀 호출(Stack Overflow)을 완벽 차단하기 위한 
 * 해외 주식 한글명 및 원시 시세 단독 획득 조회기 (야후 Fallback 미탑재로 안전 격리 보장)
 */
function fetchSingleKisOverseasNameAndPrice_(symbol) {
  symbol = normalizeStockSymbol_(symbol);
  try {
    var exchange = 'NAS';
    var nyseList = ['NYS', 'T', 'DIS', 'KO', 'PEP', 'JNJ', 'PG', 'XOM', 'CVX', 'BRK.B', 'V', 'MA'];
    if (nyseList.indexOf(symbol) >= 0) {
      exchange = 'NYS';
    }
    
    var response = kisGet_('/uapi/overseas-price/v1/quotations/price', {
      AUTH: '',
      EXCD: exchange,
      SYMB: symbol
    }, 'HHDFS76201E0');
    
    var output = response.output || response;
    var close = Number(output.last || 0);
    if (close > 0) {
      return {
        symbol: symbol,
        name: String(output.name || symbol).trim(),
        close: close,
        change_pct: Number(output.rate || 0),
        market: 'US_STOCK'
      };
    }
  } catch(e) {
    logWarn_('kis_client', 'fetchSingleKisOverseasNameAndPrice_ failed for ' + symbol, { error: e.message });
  }
  return null;
}

function sanitizeKey_(val) {
  return String(val || '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '') // ZWSP 제로 너비 공백 영구 소거
    .replace(/[\u00A0\u1680\u180E\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]/g, '') // NBSP 유령 공백 영구 소거
    .replace(/\s+/g, '') // 모든 빈칸 공백, 줄바꿈, 탭 문자 완벽 소거
    .trim();
}

/**
 * 🚀 야후 파이낸스 실시간 원/달러 환율 조회망 기동 (USDKRW=X 또는 KRW=X)
 */
function getLiveUsdRate_() {
  var cacheKey = 'AM_LIVE_USD_RATE';
  try {
    var cached = CacheService.getScriptCache().get(cacheKey);
    if (cached) return parseFloat(cached);
  } catch(e) {}
  
  try {
    // 야후 파이낸스 원/달러 환율 티커 조회
    var url = 'https://query1.finance.yahoo.com/v8/finance/chart/USDKRW=X';
    var response = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    
    if (response.getResponseCode() === 200) {
      var obj = JSON.parse(response.getContentText('UTF-8'));
      var chart = obj.chart;
      if (chart && chart.result && chart.result[0]) {
        var rate = parseFloat(chart.result[0].meta.regularMarketPrice || 0);
        if (rate > 500) { // 비상식적 환율 방지 안전망
          try { CacheService.getScriptCache().put(cacheKey, String(rate), 1800); } catch(ce) {} // 30분 캐싱
          return rate;
        }
      }
    }
  } catch(e) {
    logWarn_('kis_client', 'Failed to fetch live USD rate from Yahoo; trying KRW=X fallback', { error: e.message });
  }
  
  // 차선책 Fallback 티커
  try {
    var urlFallback = 'https://query1.finance.yahoo.com/v8/finance/chart/KRW=X';
    var responseFallback = UrlFetchApp.fetch(urlFallback, {
      muteHttpExceptions: true,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (responseFallback.getResponseCode() === 200) {
      var objFallback = JSON.parse(responseFallback.getContentText('UTF-8'));
      var rateFallback = parseFloat(objFallback.chart.result[0].meta.regularMarketPrice || 0);
      if (rateFallback > 500) {
        try { CacheService.getScriptCache().put(cacheKey, String(rateFallback), 1800); } catch(ce) {}
        return rateFallback;
      }
    }
  } catch(e) {}
  
  return 1500; // 최종 2026년 기준 실 상응 폴백 환율
}
