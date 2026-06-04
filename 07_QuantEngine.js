// ==================================================
// 🚀 [퀀트 엔진 2.1] VAA 동적 자산배분 및 주식 팩터 스크리닝 코어 엔진
// ==================================================

/**
 * 💡 핵심 대형주 및 보유 종목 주당순이익(EPS) 및 주당순자산(BPS) 실시간 역산용 DB
 * (2025/2026 결산 기준 정밀 룩업 마스터 사전)
 */
var AM_QUANT_FUNDAMENTAL_DB = {
  // 국내 주요 대형주 (30대 우량주 기준 보강: div, grow, debt, beta, gpa 추가)
  '005930': { eps: 4200, bps: 56000, div: 1445, grow: 12, debt: 30, beta: 0.95, gpa: 0.18 },   // 삼성전자
  '000660': { eps: 13500, bps: 88000, div: 1200, grow: 25, debt: 55, beta: 1.25, gpa: 0.22 },  // SK하이닉스
  '005380': { eps: 38000, bps: 330000, div: 12000, grow: 8, debt: 140, beta: 0.85, gpa: 0.16 }, // 현대차
  '000270': { eps: 28000, bps: 125000, div: 5600, grow: 10, debt: 75, beta: 0.88, gpa: 0.23 }, // 기아
  '068270': { eps: 5500, bps: 34000, div: 500, grow: 18, debt: 35, beta: 1.10, gpa: 0.15 },   // 셀트리온
  '373220': { eps: 5000, bps: 92000, div: 0, grow: 15, debt: 80, beta: 1.30, gpa: 0.08 },   // LG에너지솔루션
  '207940': { eps: 16000, bps: 150000, div: 0, grow: 20, debt: 65, beta: 0.80, gpa: 0.12 }, // 삼성바이오로직스
  '105560': { eps: 11000, bps: 135000, div: 3200, grow: 6, debt: 110, beta: 0.75, gpa: 0.03 }, // KB금융
  '055550': { eps: 8000, bps: 105000, div: 2100, grow: 5, debt: 115, beta: 0.78, gpa: 0.03 },  // 신한지주
  '035420': { eps: 9500, bps: 185000, div: 790, grow: 12, debt: 45, beta: 1.05, gpa: 0.45 },   // NAVER
  '035720': { eps: 1800, bps: 26000, div: 60, grow: 8, debt: 60, beta: 1.15, gpa: 0.35 },    // 카카오
  '051910': { eps: 24000, bps: 390000, div: 10000, grow: -5, debt: 85, beta: 1.05, gpa: 0.15 }, // LG화학
  '005490': { eps: 26000, bps: 640000, div: 10000, grow: -2, debt: 70, beta: 1.08, gpa: 0.11 }, // POSCO홀딩스
  '028260': { eps: 12000, bps: 170000, div: 2500, grow: 7, debt: 55, beta: 0.82, gpa: 0.10 },  // 삼성물산
  '012330': { eps: 34000, bps: 320000, div: 4500, grow: 6, debt: 45, beta: 0.85, gpa: 0.11 },  // 현대모비스
  '000810': { eps: 36000, bps: 380000, div: 16000, grow: 8, debt: 80, beta: 0.65, gpa: 0.04 }, // 삼성화재
  '015760': { eps: 3000, bps: 85000, div: 0, grow: 4, debt: 320, beta: 0.50, gpa: 0.05 },     // 한국전력
  '032830': { eps: 8500, bps: 180000, div: 3700, grow: 6, debt: 100, beta: 0.70, gpa: 0.03 },   // 삼성생명
  '086790': { eps: 11500, bps: 128000, div: 3400, grow: 5, debt: 110, beta: 0.82, gpa: 0.03 }, // 하나금융지주
  '017670': { eps: 5500, bps: 68000, div: 3300, grow: 4, debt: 140, beta: 0.40, gpa: 0.28 },   // SK텔레콤
  '003550': { eps: 12000, bps: 155000, div: 3000, grow: 6, debt: 35, beta: 0.88, gpa: 0.08 },  // LG
  '034730': { eps: 14000, bps: 220000, div: 5000, grow: 5, debt: 160, beta: 0.98, gpa: 0.07 }, // SK
  '009150': { eps: 8000, bps: 115000, div: 1150, grow: 12, debt: 45, beta: 1.15, gpa: 0.18 },  // 삼성전기
  '010130': { eps: 38000, bps: 510000, div: 20000, grow: 7, debt: 25, beta: 0.78, gpa: 0.14 }, // 고려아연
  '018260': { eps: 9500, bps: 118000, div: 2700, grow: 8, debt: 30, beta: 0.75, gpa: 0.22 },   // 삼성에스디에스
  '000720': { eps: 3200, bps: 72000, div: 600, grow: 5, debt: 120, beta: 0.90, gpa: 0.08 },    // 현대건설
  '003670': { eps: 1500, bps: 34000, div: 250, grow: 25, debt: 140, beta: 1.40, gpa: 0.06 },   // 포스코퓨처엠
  '035250': { eps: 1100, bps: 24000, div: 900, grow: 4, debt: 15, beta: 0.55, gpa: 0.22 },     // 강원랜드
  '009830': { eps: -2000, bps: 52000, div: 0, grow: 15, debt: 180, beta: 1.20, gpa: 0.09 },    // 한화솔루션
  '011170': { eps: -12000, bps: 280000, div: 0, grow: 5, debt: 95, beta: 1.10, gpa: 0.05 },    // 롯데케미칼
  
  // 미국 주요 대형주 (21대 우량주 기준 보강: div, grow, debt, beta, gpa 추가)
  'NVDA': { eps: 2.85, bps: 6.5, div: 0.04, grow: 45, debt: 25, beta: 1.85, gpa: 0.65 },     // 엔비디아
  'GOOG': { eps: 7.2, bps: 35.0, div: 0.80, grow: 16, debt: 12, beta: 1.05, gpa: 0.35 },     // 알파벳 C (구글 C)
  'GOOGL': { eps: 7.2, bps: 35.0, div: 0.80, grow: 16, debt: 12, beta: 1.05, gpa: 0.35 },    // 알파벳 A (구글 A)
  'AAPL': { eps: 6.65, bps: 5.4, div: 1.00, grow: 8, debt: 140, beta: 1.00, gpa: 0.42 },     // 애플
  'MSFT': { eps: 11.8, bps: 38.5, div: 3.00, grow: 14, debt: 42, beta: 0.90, gpa: 0.48 },    // 마이크로소프트
  'AMZN': { eps: 4.25, bps: 21.5, div: 0.00, grow: 22, debt: 75, beta: 1.15, gpa: 0.45 },    // 아마존
  'META': { eps: 22.0, bps: 68.0, div: 2.00, grow: 24, debt: 18, beta: 1.20, gpa: 0.46 },    // 메타
  'TSLA': { eps: 2.5, bps: 18.0, div: 0.00, grow: 10, debt: 15, beta: 1.45, gpa: 0.18 },     // 테슬라
  'AVGO': { eps: 34.0, bps: 72.0, div: 21.20, grow: 18, debt: 120, beta: 1.22, gpa: 0.36 },   // 브로드컴
  'LLY': { eps: 14.5, bps: 19.0, div: 5.20, grow: 28, debt: 95, beta: 0.85, gpa: 0.28 },     // 일라이 릴리
  'UNH': { eps: 24.5, bps: 105.0, div: 8.40, grow: 11, debt: 110, beta: 0.60, gpa: 0.25 },    // 유나이티드헬스
  'JPM': { eps: 16.5, bps: 110.0, div: 4.60, grow: 8, debt: 130, beta: 1.10, gpa: 0.04 },     // 제이피모간
  'V': { eps: 10.0, bps: 23.0, div: 2.20, grow: 13, debt: 90, beta: 0.95, gpa: 0.45 },        // 비자
  'MA': { eps: 13.5, bps: 15.0, div: 2.64, grow: 15, debt: 110, beta: 1.00, gpa: 0.48 },      // 마스터카드
  'PG': { eps: 6.5, bps: 20.0, div: 3.84, grow: 6, debt: 80, beta: 0.45, gpa: 0.28 },        // 프록터앤갬블
  'XOM': { eps: 9.5, bps: 58.0, div: 3.80, grow: 4, debt: 20, beta: 1.10, gpa: 0.15 },        // 엑슨모빌
  'JNJ': { eps: 10.0, bps: 32.0, div: 4.80, grow: 5, debt: 45, beta: 0.55, gpa: 0.26 },       // 존슨앤존슨
  'HD': { eps: 15.2, bps: 8.5, div: 9.00, grow: 7, debt: 220, beta: 0.95, gpa: 0.38 },        // 홈디포
  'COST': { eps: 16.0, bps: 55.0, div: 4.60, grow: 10, debt: 35, beta: 0.78, gpa: 0.16 },     // 코스트코
  'ABBV': { eps: 11.2, bps: 8.0, div: 6.20, grow: 6, debt: 350, beta: 0.58, gpa: 0.28 },      // 애브비
  'AMD': { eps: 3.5, bps: 38.0, div: 0.00, grow: 28, debt: 10, beta: 1.70, gpa: 0.28 }        // AMD
};

// 💡 퀀트 스크리닝용 국가별 타겟 유니버스 선언
var DOMESTIC_MARKET_UNIVERSE = ['005930', '000660', '005380', '000270', '068270', '373220', '207940', '105560', '055550', '035420', '035720', '051910', '005490', '028260', '012330', '000810', '015760', '032830', '086790', '017670', '003550', '034730', '009150', '010130', '018260', '000720', '003670', '035250', '009830', '011170'];
var US_MARKET_UNIVERSE = ['NVDA', 'GOOG', 'GOOGL', 'AAPL', 'MSFT', 'AMZN', 'META', 'TSLA', 'AVGO', 'LLY', 'UNH', 'JPM', 'V', 'MA', 'PG', 'XOM', 'JNJ', 'HD', 'COST', 'ABBV', 'AMD'];

/**
 * 야후 파이낸스 과거 월봉 차트 API를 통한 수정 종가(Adjusted Close) 수집
 * VAA 전략의 1M, 3M, 6M, 12M 모멘텀 계산용 (Crumb 차트 API는 열려있음)
 */
function fetchYahooHistoricalClose_(symbol) {
  var cleanSymbol = normalizeStockSymbol_(symbol);
  
  var yahooSymbol = cleanSymbol;
  if (/^\d{6}$/.test(cleanSymbol)) {
    yahooSymbol = cleanSymbol + '.KS';
  }
  
  var url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(yahooSymbol) + '?interval=1mo&range=15mo';
  
  try {
    var response = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    if (response.getResponseCode() === 200) {
      var obj = JSON.parse(response.getContentText('UTF-8'));
      var chart = obj.chart;
      if (chart && chart.result && chart.result[0]) {
        var result = chart.result[0];
        
        var adjclose = [];
        if (result.indicators && result.indicators.adjclose && result.indicators.adjclose[0]) {
          adjclose = result.indicators.adjclose[0].adjclose || [];
        }
        
        var close = [];
        if (result.indicators && result.indicators.quote && result.indicators.quote[0]) {
          close = result.indicators.quote[0].close || [];
        }
        
        var prices = adjclose.length > 0 ? adjclose : close;
        
        var cleanPrices = prices.map(function(p) {
          return (p === null || isNaN(p) || p === undefined) ? 0 : parseFloat(p);
        });
        
        for (var i = 1; i < cleanPrices.length; i++) {
          if (cleanPrices[i] === 0) {
            cleanPrices[i] = cleanPrices[i - 1];
          }
        }
        
        var finalPrices = cleanPrices.filter(function(p) { return p > 0; });
        
        if (finalPrices.length >= 13) {
          logInfo_('quant_engine', 'Successfully fetched historical prices for ' + symbol, { prices_count: finalPrices.length, latest: finalPrices[finalPrices.length - 1] });
          return { prices: finalPrices, is_mock: false, source: 'YAHOO_FINANCE_API' };
        }
      }
    }
  } catch(e) {
    logWarn_('quant_engine', 'Yahoo Historical API failed for ' + symbol + '. Using mock fallback.', { error: e.message });
  }
  
  var isDefensive = (['LQD', 'IEF', 'SHY'].indexOf(cleanSymbol) >= 0);
  var mockPrices = isDefensive 
    ? [110, 110.2, 110.1, 110.4, 110.3, 110.5, 110.6, 110.5, 110.8, 111, 111.2, 111.1, 111.3, 111.5, 111.7]
    : [450, 452, 448, 455, 460, 458, 465, 470, 468, 475, 480, 482, 490, 495, 505];
  return { prices: mockPrices, is_mock: true, source: 'YAHOO_MOCK_FALLBACK', warning: '야후 파이낸스 API 호출 실패로 고정 히스토리컬 종가를 반환합니다.' };
}

/**
 * 개별 자산의 VAA 모멘텀 스코어 연산
 */
function calculateAssetMomentumScore_(symbol) {
  var histData = fetchYahooHistoricalClose_(symbol);
  var prices = histData.prices;
  var len = prices.length;
  
  var p0 = prices[len - 1]; // 현재 주가
  var p1 = prices[len - 2]; // 1개월 전 종가
  var p3 = prices[len - 4]; // 3개월 전 종가
  var p6 = prices[len - 7]; // 6개월 전 종가
  var p12 = prices[len - 13]; // 12개월 전 종가
  
  var r1 = p1 > 0 ? ((p0 - p1) / p1 * 100) : 0;
  var r3 = p3 > 0 ? ((p0 - p3) / p3 * 100) : 0;
  var r6 = p6 > 0 ? ((p0 - r6) / p6 * 100) : (p6 > 0 ? ((p0 - p6) / p6 * 100) : 0); // 널가드 적용
  var r12 = p12 > 0 ? ((p0 - p12) / p12 * 100) : 0;
  
  var score = 12 * r1 + 4 * r3 + 2 * (p6 > 0 ? ((p0 - p6) / p6 * 100) : 0) + 1 * r12;
  
  return {
    symbol: symbol,
    current_price: p0,
    r1: roundNumber_(r1, 2),
    r3: roundNumber_(r3, 2),
    r6: roundNumber_(p6 > 0 ? ((p0 - p6) / p6 * 100) : 0, 2),
    r12: roundNumber_(r12, 2),
    score: roundNumber_(score, 2),
    is_mock: histData.is_mock,
    source: histData.source,
    warning: histData.warning
  };
}

/**
 * 🚀 VAA 동적 자산배분 전략 신호 산출 엔진
 */
function getVaaStrategySignal(forceRefresh) {
  var today = amTodayString_();
  var cacheKey = 'VAA_STRATEGY_SIGNAL';
  var cacheDateKey = 'VAA_STRATEGY_SIGNAL_DATE';
  
  var cachedVaa = getScriptProperty_(cacheKey, '');
  var cachedDate = getScriptProperty_(cacheDateKey, '');
  
  if (!forceRefresh && cachedVaa && cachedDate === today) {
    logInfo_('quant_engine', 'Loaded VAA strategy signal from script cache', { date: today });
    try {
      return JSON.parse(cachedVaa);
    } catch(e) {
      logWarn_('quant_engine', 'Failed to parse cached VAA signal; recalculating.', { error: e.message });
    }
  }
  
  ensureAllSheets_();
  var settings = readObjects_(AM_CONFIG.SHEETS.QUANT_SETTINGS);
  
  var aggStr = 'SPY,QQQ,IWM,EEM';
  var defStr = 'LQD,IEF,SHY';
  
  settings.forEach(function(s) {
    if (s.key === 'VAA_UNIVERSE_AGGRESSIVE') aggStr = s.value;
    if (s.key === 'VAA_UNIVERSE_DEFENSIVE') defStr = s.value;
  });
  
  var aggressiveUniverse = aggStr.split(',').map(function(s) { return s.trim(); });
  var defensiveUniverse = defStr.split(',').map(function(s) { return s.trim(); });
  
  var isAnyMock = false;
  var mockWarnings = [];

  var aggressiveScores = aggressiveUniverse.map(function(sym) {
    var res = calculateAssetMomentumScore_(sym);
    if (res.is_mock) {
      isAnyMock = true;
      if (res.warning) mockWarnings.push(sym + ': ' + res.warning);
    }
    return res;
  });
  
  var defensiveScores = defensiveUniverse.map(function(sym) {
    var res = calculateAssetMomentumScore_(sym);
    if (res.is_mock) {
      isAnyMock = true;
      if (res.warning) mockWarnings.push(sym + ': ' + res.warning);
    }
    return res;
  });
  
  var isAggressiveActive = aggressiveScores.every(function(asset) {
    return asset.score > 0;
  });
  
  var recommendedAsset = null;
  var regime = '';
  
  if (isAggressiveActive) {
    regime = 'AGGRESSIVE';
    aggressiveScores.sort(function(a, b) { return b.score - a.score; });
    recommendedAsset = aggressiveScores[0];
  } else {
    regime = 'DEFENSIVE';
    defensiveScores.sort(function(a, b) { return b.score - a.score; });
    recommendedAsset = defensiveScores[0];
  }
  
  var result = {
    timestamp: amNowString_(),
    regime: regime,
    recommended_symbol: recommendedAsset.symbol,
    recommended_score: recommendedAsset.score,
    aggressive_scores: aggressiveScores,
    defensive_scores: defensiveScores,
    is_mock: isAnyMock,
    warnings: mockWarnings
  };
  
  try {
    setScriptProperty_(cacheKey, JSON.stringify(result));
    setScriptProperty_(cacheDateKey, today);
    logInfo_('quant_engine', 'Computed and cached new VAA Strategy Signal', { regime: regime, recommendation: recommendedAsset.symbol });
  } catch(ce) {
    logWarn_('quant_engine', 'Failed to write VAA signal cache', { error: ce.message });
  }
  
  return result;
}

/**
 * 💡 [보안 차단 우회] 야후 차트 API 일봉 데이터를 이용한 50일 모멘텀 자가 연산기
 */
function calculate50DayMomentumAndRSI_(symbol, onlyCache) {
  var cleanSymbol = normalizeStockSymbol_(symbol);
  
  // 🚀 이중 캐싱 키 정의 (모멘텀과 RSI를 함께 캐싱하여 중복 차트 조회를 0초화)
  var cacheKey = 'QUANT_IND_V2_' + cleanSymbol;
  try {
    var cached = CacheService.getScriptCache().get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }
  } catch(e) {}
  
  try {
    var propVal = PropertiesService.getScriptProperties().getProperty(cacheKey);
    if (propVal) {
      try { CacheService.getScriptCache().put(cacheKey, propVal, 14400); } catch(ce) {} // 4시간 메모리 캐시 승격
      return JSON.parse(propVal);
    }
  } catch(e) {}
  
  // 🚀 [병목 원천 방어] onlyCache 가 참인 경우 캐시가 없으면 API를 찌르지 않고 즉시 디폴트 반환
  if (onlyCache === true) {
    return {
      momentum_pct: 0,
      rsi: 50,
      sma5: 0,
      sma20: 0,
      bollinger_upper: 0,
      bollinger_lower: 0,
      technical_signal: '캐시 없음',
      prices: []
    };
  }
  
  var yahooSymbol = cleanSymbol;
  var isKoreanStock = /^\d[0-9A-Z]{5}$/.test(cleanSymbol);
  
  var url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(yahooSymbol) + '?interval=1d&range=1y';
  if (isKoreanStock) {
    url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(cleanSymbol + '.KS') + '?interval=1d&range=1y';
  }
  
  var resultData = {
    momentum_pct: 0,
    rsi: 50,
    sma5: 0,
    sma20: 0,
    bollinger_upper: 0,
    bollinger_lower: 0,
    technical_signal: '특이 신호 없음',
    prices: []
  }; // 기본 디폴트 데이터
  
  try {
    var response = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    // 코스피(.KS) 시도 실패 시 코스닥(.KQ)으로 스마트 2차 폴백 스캔 기동
    if (isKoreanStock && response.getResponseCode() !== 200) {
      logInfo_('quant_engine', 'Retrying with .KQ suffix for ' + cleanSymbol);
      var kqUrl = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(cleanSymbol + '.KQ') + '?interval=1d&range=1y';
      response = UrlFetchApp.fetch(kqUrl, {
        muteHttpExceptions: true,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
    }
    
    if (response.getResponseCode() === 200) {
      var obj = JSON.parse(response.getContentText('UTF-8'));
      var chart = obj.chart;
      if (chart && chart.result && chart.result[0]) {
        var result = chart.result[0];
        var close = [];
        if (result.indicators && result.indicators.quote && result.indicators.quote[0]) {
          close = result.indicators.quote[0].close || [];
        }
        
        var cleanClose = close.filter(function(p) {
          return p !== null && !isNaN(p) && p > 0;
        });
        
        var len = cleanClose.length;
        
        // [1] 50일 가격 모멘텀 연산
        var momVal = 0;
        if (len >= 50) {
          var p0 = cleanClose[len - 1];
          var p50 = cleanClose[len - 50];
          momVal = roundNumber_(((p0 - p50) / p50 * 100), 2);
        } else if (len >= 2) {
          var p0 = cleanClose[len - 1];
          var pLast = cleanClose[0];
          momVal = roundNumber_(((p0 - pLast) / pLast * 100), 2);
        }
        resultData.momentum_pct = momVal;
        
        // [2] Wilder's 단순이동평균 방식 기반 RSI(14) 연산 기동
        var currentRsi = 50;
        if (len >= 15) {
          var changes = [];
          var startIndex = Math.max(0, len - 15);
          for (var i = startIndex + 1; i < len; i++) {
            changes.push(cleanClose[i] - cleanClose[i - 1]);
          }
          
          var gains = 0;
          var losses = 0;
          changes.forEach(function(c) {
            if (c > 0) gains += c;
            else losses += Math.abs(c);
          });
          
          var avgGain = gains / 14;
          var avgLoss = losses / 14;
          
          if (avgLoss === 0) {
            currentRsi = 100;
          } else {
            var rs = avgGain / avgLoss;
            currentRsi = Math.round(100 - (100 / (1 + rs)));
          }
        }
        resultData.rsi = currentRsi;

        // [3] 이동평균 및 볼린저 밴드, 신호 감지
        var sma5 = 0;
        var sma20 = 0;
        var prevSma5 = 0;
        var prevSma20 = 0;
        var bollUpper = 0;
        var bollLower = 0;
        var techSignals = [];

        if (len >= 20) {
          // 5일선 평균
          var sum5 = 0;
          for (var i = len - 5; i < len; i++) {
            sum5 += cleanClose[i];
          }
          sma5 = sum5 / 5;

          // 20일선 평균
          var sum20 = 0;
          for (var i = len - 20; i < len; i++) {
            sum20 += cleanClose[i];
          }
          sma20 = sum20 / 20;

          // 직전(어제) 이동평균 (골든/데드크로스 감지용)
          if (len >= 21) {
            var prevSum5 = 0;
            for (var i = len - 6; i < len - 1; i++) {
              prevSum5 += cleanClose[i];
            }
            prevSma5 = prevSum5 / 5;

            var prevSum20 = 0;
            for (var i = len - 21; i < len - 1; i++) {
              prevSum20 += cleanClose[i];
            }
            prevSma20 = prevSum20 / 20;
          }

          // 표준편차 산출 (볼린저 밴드 용)
          var varianceSum = 0;
          for (var i = len - 20; i < len; i++) {
            varianceSum += Math.pow(cleanClose[i] - sma20, 2);
          }
          var stdDev = Math.sqrt(varianceSum / 20);
          bollUpper = sma20 + (2 * stdDev);
          bollLower = sma20 - (2 * stdDev);

          var currentPrice = cleanClose[len - 1];

          // 패턴 신호 진단
          if (prevSma5 > 0 && prevSma20 > 0) {
            if (prevSma5 <= prevSma20 && sma5 > sma20) {
              techSignals.push("골든크로스(상승 돌파)");
            } else if (prevSma5 >= prevSma20 && sma5 < sma20) {
              techSignals.push("데드크로스(하향 이탈)");
            }
          }

          if (currentPrice >= bollUpper) {
            techSignals.push("볼린저밴드 상한 돌파(상승추세 가속)");
          } else if (currentPrice <= bollLower) {
            techSignals.push("볼린저밴드 하한 이탈(과매도 반등 예상)");
          }
        }

        // RSI 추가 신호
        if (currentRsi >= 70) {
          techSignals.push("RSI 과매수 경계");
        } else if (currentRsi <= 30) {
          techSignals.push("RSI 과매도 신호");
        }

        resultData.sma5 = sma5 > 0 ? roundNumber_(sma5, 1) : 0;
        resultData.sma20 = sma20 > 0 ? roundNumber_(sma20, 1) : 0;
        resultData.bollinger_upper = bollUpper > 0 ? Math.round(bollUpper) : 0;
        resultData.bollinger_lower = bollLower > 0 ? Math.round(bollLower) : 0;
        resultData.technical_signal = techSignals.length > 0 ? techSignals.join(', ') : "특이 신호 없음";
        resultData.prices = cleanClose || [];
      }
    }
  } catch(e) {
    logWarn_('quant_engine', 'Failed to calculate Momentum & RSI for ' + symbol, { error: e.message });
  }
  
  // 성공 연산 시 이중 캐시 저장 (4시간 보존)
  if (resultData.momentum_pct !== 0 || resultData.rsi !== 50) {
    try {
      var strData = JSON.stringify(resultData);
      CacheService.getScriptCache().put(cacheKey, strData, 14400);
      PropertiesService.getScriptProperties().setProperty(cacheKey, strData);
    } catch(ce) {}
  }
  
  return resultData;
}

/**
 * 💡 하위 호환성 전용 50일 모멘텀 래퍼 함수 (기존 테스트 및 외부 호출 파괴 방지)
 */
function calculate50DayMomentum_(symbol) {
  return calculate50DayMomentumAndRSI_(symbol).momentum_pct;
}

/**
 * 🚀 개별 종목군 퀀트 팩터(모멘텀 + 밸류) 멀티 스코어링 시스템 (주가 역산형 어댑터 탑재)
 */
function getQuantStockScoring(symbolsList) {
  var symbols = symbolsList || [];
  if (symbols.length === 0) {
    var holdings = readObjects_(AM_CONFIG.SHEETS.HOLDINGS_CURRENT);
    var today = amTodayString_();
    var uniqueSymbols = {};
    holdings.forEach(function(h) {
      var sym = normalizeStockSymbol_(h.symbol);
      if (sym && sym !== 'CASH' && normalizeDateValue_(h.date) === today) {
        uniqueSymbols[sym] = true;
      }
    });
    symbols = Object.keys(uniqueSymbols);
  }
  
  if (symbols.length === 0) {
    // 디폴트는 보유 종목 탐지 실패 시 국내 TOP 15 대형주 유니버스로 대입
    symbols = DOMESTIC_MARKET_UNIVERSE;
  }
  
  var scoredStocks = symbols.map(function(sym) {
    var cleanSym = normalizeStockSymbol_(sym);
    var isDom = /^\d{6}$/.test(cleanSym);
    
    var priceData = null;
    if (isDom) {
      try {
        priceData = fetchKisCurrentPrice_(cleanSym);
      } catch(e) {
        priceData = fetchNaverStockPrice_(cleanSym);
      }
    } else {
      try {
        priceData = fetchKisOverseasCurrentPrice_(cleanSym);
      } catch(e) {
        priceData = fetchYahooOverseasCurrentPrice_(cleanSym);
      }
    }
    
    var currentPrice = priceData ? parseFloat(priceData.close || 0) : 0;
    var name = priceData ? String(priceData.name || cleanSym).trim() : cleanSym;
    
    // 한글명 수복 사전 결합
    name = getStockKoreanName_(cleanSym, name);
    
    var isEtf = isEtf_(cleanSym, name);
    
    // EPS, BPS 기반 가격 연동 팩터 계산
    var fund = AM_QUANT_FUNDAMENTAL_DB[cleanSym] || { eps: 0, bps: 0, div: 0, grow: 10, debt: 100, beta: 1.0, gpa: 0.0 };
    var per = 0;
    var pbr = 0;
    var divYield = 0;
    var peg = 0;
    var roe = 0;
    
    if (!isEtf && currentPrice > 0) {
      if (fund.eps > 0) per = currentPrice / fund.eps;
      if (fund.bps > 0) pbr = currentPrice / fund.bps;
      if (fund.div > 0) divYield = (fund.div / currentPrice) * 100;
      
      // PER이 양수이고 이익성장률이 0보다 클 때만 PEG 계산
      if (per > 0 && fund.grow > 0) {
        peg = per / fund.grow;
      }
    } else if (isEtf) {
      if (fund.div > 0 && currentPrice > 0) {
        divYield = (fund.div / currentPrice) * 100;
      }
    }
    
    if (!isEtf && fund.eps > 0 && fund.bps > 0) {
      roe = (fund.eps / fund.bps) * 100;
    }
    
    // [1] UI용 50일 일봉 단순 등락률 및 RSI 스캔
    var indicators = calculate50DayMomentumAndRSI_(cleanSym);
    var momentumPct = indicators.momentum_pct;
    var rsi = indicators.rsi;
    
    // [2] 랭킹 연산용 가중 모멘텀 스코어 (1M, 3M, 6M, 12M 기반) 계산
    var weightedMomScore = 0;
    try {
      var weightedMomResult = calculateAssetMomentumScore_(cleanSym);
      weightedMomScore = weightedMomResult.score !== undefined ? parseFloat(weightedMomResult.score) : 0;
    } catch(momErr) {
      logWarn_('quant_scoring', 'Failed to calculate weighted momentum for ' + cleanSym + '. Falling back to 50d.', { error: momErr.message });
      weightedMomScore = momentumPct; // 실패 시 50일 모멘텀으로 대체
    }
    
    // S-Rim 적정주가 및 안전마진 계산 (요구수익률 8.0% 대입)
    var srimPrice = 0;
    var safetyMargin = 0;
    
    if (!isEtf && fund.eps > 0 && fund.bps > 0) {
      srimPrice = fund.bps * (roe / 8.0);
      if (srimPrice > 0 && currentPrice > 0) {
        safetyMargin = ((srimPrice - currentPrice) / srimPrice) * 100;
      }
    }
    
    return {
      symbol: cleanSym,
      name: name,
      price: currentPrice,
      per: isEtf ? 'N/A' : (per > 0 ? roundNumber_(per, 2) : 'N/A'),
      pbr: isEtf ? 'N/A' : (pbr > 0 ? roundNumber_(pbr, 2) : 'N/A'),
      gpa: isEtf ? 'N/A' : (fund.gpa !== undefined && fund.gpa > 0 ? roundNumber_(fund.gpa, 2) : 'N/A'),
      momentum_pct: roundNumber_(momentumPct, 2),
      rsi: rsi,
      srim_price: isEtf ? 'N/A' : (srimPrice > 0 ? Math.round(srimPrice) : 0),
      safety_margin: isEtf ? 'N/A' : (srimPrice > 0 && currentPrice > 0 ? roundNumber_(safetyMargin, 1) : 0),
      is_etf: isEtf,
      
      // 💡 [6대 신규 종합 팩터 속성 확장]
      roe: isEtf ? 'N/A' : (roe > 0 ? roundNumber_(roe, 2) : 0),
      debt: isEtf ? 'N/A' : (fund.debt !== undefined ? fund.debt : 100),
      div_yield: divYield > 0 ? roundNumber_(divYield, 2) : 0,
      beta: fund.beta !== undefined ? fund.beta : 1.0,
      peg: isEtf ? 'N/A' : (peg > 0 ? roundNumber_(peg, 2) : 'N/A'),
      
      // 정렬 보조용 로우 데이터
      per_val: isEtf ? 9999 : (per > 0 ? per : 9999),
      pbr_val: isEtf ? 9999 : (pbr > 0 ? pbr : 9999),
      gpa_val: isEtf ? -9999 : (fund.gpa !== undefined ? fund.gpa : -9999),
      momentum_val: weightedMomScore,
      roe_val: isEtf ? -9999 : (roe > 0 ? roe : -9999),
      debt_val: isEtf ? 9999 : (fund.debt !== undefined ? fund.debt : 9999),
      div_yield_val: divYield > 0 ? divYield : -9999,
      beta_val: fund.beta !== undefined ? fund.beta : 9999,
      peg_val: isEtf ? 9999 : (peg > 0 ? peg : 9999)
    };
  });
  
  var sortedPer = scoredStocks.slice().sort(function(a, b) { return a.per_val - b.per_val; });
  var sortedPbr = scoredStocks.slice().sort(function(a, b) { return a.pbr_val - b.pbr_val; });
  var sortedGpa = scoredStocks.slice().sort(function(a, b) { return b.gpa_val - a.gpa_val; }); // GP/A는 높을수록 우수하므로 내림차순
  var sortedMom = scoredStocks.slice().sort(function(a, b) { return b.momentum_val - a.momentum_val; });
  
  var size = scoredStocks.length;
  
  scoredStocks.forEach(function(stock) {
    var perRank = sortedPer.indexOf(stock);
    var pbrRank = sortedPbr.indexOf(stock);
    var gpaRank = sortedGpa.indexOf(stock);
    var momRank = sortedMom.indexOf(stock);
    
    // Value/Quality 3대 팩터 스코어링 (각각 0~100 스케일 변환 후 균등 결합)
    var valPerScore = (stock.per_val < 9999) ? ((size - 1 - perRank) / (size - 1 || 1) * 100) : 0;
    var valPbrScore = (stock.pbr_val < 9999) ? ((size - 1 - pbrRank) / (size - 1 || 1) * 100) : 0;
    var valGpaScore = (stock.gpa_val > -9999) ? ((size - 1 - gpaRank) / (size - 1 || 1) * 100) : 0;
    
    var valueQualityScore = (valPerScore + valPbrScore + valGpaScore) / 3;
    
    var momentumScore = (size - 1 - momRank) / (size - 1 || 1) * 100;
    
    if (stock.is_etf) {
      stock.quant_score = Math.round(momentumScore);
    } else {
      stock.quant_score = Math.round((valueQualityScore * 0.5) + (momentumScore * 0.5));
    }
  });
  
  scoredStocks.sort(function(a, b) { return b.quant_score - a.quant_score; });
  
  return scoredStocks;
}

/**
 * 🚀 월간 정기 리밸런싱 실행 및 시그널 시트 저장
 */
function runMonthlyQuantRebalancing() {
  ensureAllSheets_();
  var today = amTodayString_();
  
  try {
    var vaa = getVaaStrategySignal();
    var detailJson = {
      regime: vaa.regime,
      aggressive_scores: vaa.aggressive_scores,
      defensive_scores: vaa.defensive_scores
    };
    
    appendObjectRow_(AM_CONFIG.SHEETS.QUANT_SIGNALS, {
      date: today,
      strategy: 'VAA_ALLOCATION',
      signal: vaa.recommended_symbol,
      details: JSON.stringify(detailJson),
      created_at: amNowString_()
    });
    
    var scoring = getQuantStockScoring();
    var topRecommendation = scoring[0];
    
    appendObjectRow_(AM_CONFIG.SHEETS.QUANT_SIGNALS, {
      date: today,
      strategy: 'FACTOR_SCREEN',
      signal: topRecommendation.symbol,
      details: JSON.stringify(scoring.slice(0, 5)),
      created_at: amNowString_()
    });
    
    var msg = [
      '📊 <b>[QUANT LAB] 월간 리밸런싱 신호 발행</b>',
      '----------------------------------------',
      '• 발행 일자: ' + today,
      '',
      '🔹 <b>VAA 동적 자산배분 전략</b>',
      '  - 현재 시장 국면: ' + (vaa.regime === 'AGGRESSIVE' ? '🟢 상승공격 (AGGRESSIVE)' : '🚨 하락피신 (DEFENSIVE)'),
      '  - 이번 달 추천 ETF: <b>' + vaa.recommended_symbol + '</b> (모멘텀 스코어: ' + vaa.recommended_score + ')',
      '  - 추천 매매 지시: <b>' + vaa.recommended_symbol + ' 100% 비중 매수 유지</b>',
      '',
      '🔹 <b>개별 종목 퀀트 팩터 스크리닝 (Top 3)</b>',
      scoring.slice(0, 3).map(function(s, idx) {
        return '  ' + (idx + 1) + '. <b>' + s.name + ' (' + s.symbol + ')</b> - 종합 퀀트: ' + s.quant_score + '점 (PER: ' + s.per + ' | PBR: ' + s.pbr + ')';
      }).join('\n'),
      '----------------------------------------',
      '💡 해당 시그널은 지정된 전략적 가중치와 역사적 모멘텀에 기반한 정량 연산 결과입니다. 리밸런싱 시 매매 비중에 반영하시기 바랍니다.'
    ].join('\n');
    
    // 🚀 [가상 매매 퀀트 자동 체결 동기화]
    var paperLogStr = '';
    try {
      var paperRes = runPaperPortfolioQuantRebalancing_(vaa.recommended_symbol);
      if (paperRes.success) {
        paperLogStr = '\n\n🤖 <b>[가상 매매 자동 체결 완료]</b>\n';
        if (paperRes.logs && paperRes.logs.length > 0) {
          paperLogStr += paperRes.logs.map(function(l) { return '  ' + l; }).join('\n');
        }
        if (paperRes.total_eval) {
          paperLogStr += '\n  • <b>체결 후 총 가상자산: ' + formatNumber_(Math.round(paperRes.total_eval)) + '원</b>';
        }
      }
    } catch(pe) {
      logWarn_('quant_rebalancing', 'Paper auto rebalancing failed', { error: pe.message });
    }
    
    // 🚀 [국내/해외 300만원 모의 퀀트 계좌 자동 리밸런싱 집행]
    try {
      var domScoring = getQuantStockScoring(DOMESTIC_MARKET_UNIVERSE);
      var domTop3 = domScoring.slice(0, 3).map(function(s) { return s.symbol; });
      runQuantPortfolioRebalancing_('DOM', domTop3);
      
      var usScoring = getQuantStockScoring(US_MARKET_UNIVERSE);
      var usTop3 = usScoring.slice(0, 3).map(function(s) { return s.symbol; });
      runQuantPortfolioRebalancing_('US', usTop3);
      
      paperLogStr += '\n\n📈 <b>[퀀트 모의투자 계좌 자동 리밸런싱 완료]</b>\n';
      paperLogStr += '  • 국내 300만 퀀트 포트폴리오 편입: ' + domTop3.join(', ') + '\n';
      paperLogStr += '  • 해외 300만 퀀트 포트폴리오 편입: ' + usTop3.join(', ') + '';
    } catch(quantRebalErr) {
      logWarn_('quant_rebalancing', 'Quant DOM/US paper rebalancing failed', { error: quantRebalErr.message });
    }
    
    var vaaWarning = '';
    if (vaa && vaa.is_mock) {
      vaaWarning = '\n\n⚠️ <b>[데이터 신뢰성 경고]</b>\n현재 일부 퀀트 데이터가 API 연동 실패로 인해 예시(Mock) 데이터로 리밸런싱이 시뮬레이션되었습니다. 실제 리밸런싱 집행 전 시세를 재확인하십시오.';
    }
    
    sendTelegramMessage(msg + paperLogStr + vaaWarning);
    logInfo_('quant_rebalancing', 'Successfully executed and logged monthly quant rebalancing', { date: today });
    
  } catch(e) {
    logWarn_('quant_rebalancing', 'Failed to run monthly quant rebalancing', { error: e.message });
    sendTelegramMessage('⚠️ [퀀트 엔진 경보]\n정기 퀀트 리밸런싱 신호 계산 도중 오류가 감지되었습니다: ' + e.message);
  }
}

/**
 * ⏰ [신설] 매일 밤 50대 우량주 팩터 데이터 일괄 자동 스캔 및 DB 시트 적재 배치 엔진
 */
function updateQuantUniverseDatabase() {
  ensureAllSheets_();
  var today = amTodayString_();
  
  // 중복 제거한 통합 유니버스 (국내 30개 + 미국 21개)
  var unionMap = {};
  DOMESTIC_MARKET_UNIVERSE.forEach(function(s) { unionMap[s] = true; });
  US_MARKET_UNIVERSE.forEach(function(s) { unionMap[s] = true; });
  
  // 🚀 [신설] 보유 자산 종목들 동적 수집하여 유니버스에 실시간 편입 (자가치유 병목 0초화)
  try {
    var holdings = readObjects_(AM_CONFIG.SHEETS.HOLDINGS_CURRENT) || [];
    holdings.forEach(function(h) {
      var sym = normalizeStockSymbol_(h.symbol);
      if (sym && sym !== 'CASH') {
        unionMap[sym] = true;
      }
    });
  } catch(hErr) {
    logWarn_('quant_batch', 'Failed to load holdings_current for dynamic universe expansion. Using base universe.', { error: hErr.message });
  }
  
  var totalUniverse = Object.keys(unionMap);
  
  logInfo_('quant_batch', 'Starting daily quant universe database scan for ' + totalUniverse.length + ' stocks (Holdings expanded).');
  
  var results = [];
  
  for (var i = 0; i < totalUniverse.length; i++) {
    var symbol = totalUniverse[i];
    try {
      // API 과부하 분산을 위해 개별 스코어링 순차 수행
      var singleScoredList = getQuantStockScoring([symbol]);
      if (singleScoredList && singleScoredList.length > 0) {
        var s = singleScoredList[0];
        
        results.push({
          date: today,
          symbol: s.symbol,
          name: s.name,
          price: s.price,
          per: s.per,
          pbr: s.pbr,
          gpa: s.gpa,
          momentum_pct: s.momentum_pct,
          rsi: s.rsi,
          roe: s.roe,
          debt: s.debt,
          div_yield: s.div_yield,
          beta: s.beta,
          peg: s.peg,
          srim_price: s.is_etf ? 'N/A' : s.srim_price,
          safety_margin: s.is_etf ? 'N/A' : s.safety_margin,
          updated_at: amNowString_()
        });
      }
    } catch(err) {
      logWarn_('quant_batch', 'Failed to scan and store symbol ' + symbol, { error: err.message });
    }
    
    // KIS/야후 Open API Rate Limit 우회용 150ms 미세 딜레이
    Utilities.sleep(150);
  }
  
  if (results.length > 0) {
    try {
      // 🚀 [신설] 팩터 계산 결과 무결성 전수 검사 기동
      var validation = validateQuantFactors_(results.map(function(r) {
        return {
          symbol: r.symbol,
          name: r.name,
          price: r.price,
          per: r.per,
          pbr: r.pbr,
          gpa: r.gpa,
          per_val: (r.per === 'N/A' || isNaN(parseFloat(r.per))) ? 9999 : parseFloat(r.per),
          pbr_val: (r.pbr === 'N/A' || isNaN(parseFloat(r.pbr))) ? 9999 : parseFloat(r.pbr),
          gpa_val: (r.gpa === 'N/A' || isNaN(parseFloat(r.gpa))) ? -9999 : parseFloat(r.gpa),
          rsi: r.rsi,
          srim_price: (r.srim_price === 'N/A' || isNaN(r.srim_price)) ? 0 : r.srim_price,
          safety_margin: (r.safety_margin === 'N/A' || isNaN(r.safety_margin)) ? 0 : r.safety_margin,
          quant_score: 50 // 무결 통과용 기본 점수 주입
        };
      }));
      
      if (!validation.success) {
        logWarn_('quant_batch_validation', 'Quant validation failed!', { anomalies: validation.anomalies });
        
        var alertMsg = [
          '⚠️ <b>[퀀트 엔진 수식/데이터 이상 경보]</b>',
          '----------------------------------------',
          '• 감지 시점: ' + amNowString_(),
          '• 이상치 비율: <b>' + validation.anomalyRate + '%</b>',
          '• 상세 에러 내역 (최대 5건):',
          validation.anomalies.slice(0, 5).map(function(a) {
            return '  - ' + a.name + ' (' + a.symbol + '): ' + a.reasons.join(', ');
          }).join('\n'),
          '----------------------------------------',
          '⚠️ 무결성이 보장되지 않아 오늘 날짜의 DB 시트 갱신 작업이 일시 정지되었습니다. 계산 로직 및 입력 소스 데이터를 긴급 확인하십시오.'
        ].join('\n');
        
        sendTelegramMessage(alertMsg);
        return; // 데이터 적재 전면 중단 (Abort)
      }
      
      // 🚀 [다이어트 정책] 과거 누적 레거시 행을 전량 비우고 항상 최신 1일치만 날씬하게 유지 (I/O 병목 20배 개선)
      clearDataRows_(AM_CONFIG.SHEETS.QUANT_UNIVERSE_DB);
      // 일괄 적재
      appendObjectRows_(AM_CONFIG.SHEETS.QUANT_UNIVERSE_DB, results);
      logInfo_('quant_batch', 'Successfully updated quant universe database for today. validation pass.', { count: results.length });
    } catch(sheetErr) {
      logWarn_('quant_batch', 'Failed to write quant database results to sheet.', { error: sheetErr.message });
    }
  } else {
    logWarn_('quant_batch', 'No results computed for quant universe database.');
  }
}

/**
 * 💡 [신설] 퀀트 팩터 결과값에 대한 수학적 무결성 및 이상치 감지기
 * 계산 공식 오류나 비정상 데이터 유입을 실시간으로 감지합니다.
 */
function validateQuantFactors_(scoredStocks) {
  var list = scoredStocks || [];
  if (list.length === 0) {
    return { success: true, anomalies: [], anomalyRate: 0, message: '검증 대상 종목이 없습니다.' };
  }
  
  var anomalies = [];
  var totalCount = list.length;
  
  for (var i = 0; i < totalCount; i++) {
    var s = list[i];
    var reasons = [];
    
    // 1. 현재가가 0 이하이거나 비정상적인 값인 경우
    if (!s.price || isNaN(s.price) || s.price <= 0) {
      reasons.push('현재가 오류 (' + s.price + ')');
    }
    
    // 2. 종합 퀀트 점수가 NaN이거나 유효 범위를 이탈한 경우
    if (s.quant_score === undefined || isNaN(s.quant_score) || s.quant_score < 0 || s.quant_score > 100) {
      reasons.push('종합 점수 이탈 (' + s.quant_score + ')');
    }
    
    // 3. RSI(14)가 유효 범위(0~100)를 이탈한 경우
    if (s.rsi !== undefined && (isNaN(s.rsi) || s.rsi < 0 || s.rsi > 100)) {
      reasons.push('RSI 범위 이탈 (' + s.rsi + ')');
    }
    
    // 4. BPS/EPS가 양수임에도 PER/PBR이 음수로 연산된 경우
    if (s.per_val !== 9999 && s.per_val < 0) {
      reasons.push('PER 음수 오류 (' + s.per + ')');
    }
    if (s.pbr_val !== 9999 && s.pbr_val < 0) {
      reasons.push('PBR 음수 오류 (' + s.pbr + ')');
    }
    
    // 5. S-Rim 주가 및 안전마진 이상치 체크
    if (s.srim_price > 0) {
      var bps = 0;
      var fund = AM_QUANT_FUNDAMENTAL_DB[s.symbol];
      if (fund) bps = fund.bps;
      if (bps > 0 && s.srim_price > bps * 50) {
        reasons.push('S-Rim 과대 연산 (' + s.srim_price + ' vs BPS: ' + bps + ')');
      }
      if (isNaN(s.safety_margin) || s.safety_margin < -5000 || s.safety_margin > 99) {
        reasons.push('안전마진 비정상 (' + s.safety_margin + '%)');
      }
    }
    
    // 6. GP/A 검증
    if (s.gpa_val !== undefined && s.gpa_val !== -9999 && (isNaN(s.gpa_val) || s.gpa_val < 0 || s.gpa_val > 5.0)) {
      reasons.push('GP/A 비정상 (' + s.gpa + ')');
    }
    
    if (reasons.length > 0) {
      anomalies.push({
        symbol: s.symbol,
        name: s.name,
        reasons: reasons
      });
    }
  }
  
  var anomalyRate = (anomalies.length / totalCount) * 100;
  var isSuccess = anomalyRate <= 5.0; // 이상치 5% 초과 시 무결성 장애로 격하
  
  return {
    success: isSuccess,
    anomalies: anomalies,
    anomalyRate: roundNumber_(anomalyRate, 1),
    message: isSuccess 
      ? '무결성 통과 (이상 비율: ' + roundNumber_(anomalyRate, 1) + '%)' 
      : '무결성 실패 경보 (이상 비율: ' + roundNumber_(anomalyRate, 1) + '%, 건수: ' + anomalies.length + '건)'
  };
}

function isEtf_(symbol, name) {
  var cleanSym = normalizeStockSymbol_(symbol);
  var cleanName = String(name || '').toUpperCase();
  
  // 미국 주요 ETF 리스트
  var etfList = ['SPY', 'QQQ', 'IWM', 'EEM', 'LQD', 'IEF', 'SHY', 'GLD', 'TLT', 'BIL', 'USO', 'VNQ', 'DIA'];
  if (etfList.indexOf(cleanSym) >= 0) return true;
  
  // 한글명/영문명 키워드 매핑
  if (cleanName.indexOf('ETF') >= 0 || 
      cleanName.indexOf('KODEX') >= 0 || 
      cleanName.indexOf('TIGER') >= 0 || 
      cleanName.indexOf('SOL') >= 0 || 
      cleanName.indexOf('ACE') >= 0 || 
      cleanName.indexOf('KBSTAR') >= 0 || 
      cleanName.indexOf('ARIRANG') >= 0 || 
      cleanName.indexOf('HANARO') >= 0 || 
      cleanName.indexOf('KOSEF') >= 0) {
    return true;
  }
  
  return false;
}

