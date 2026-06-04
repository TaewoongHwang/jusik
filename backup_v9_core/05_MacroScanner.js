// ==================================================
// 🚀 [금융 관제 2.0] ECOS / FRED / KRX / DART 12대 API 융합 거시경제 스캐너
// ==================================================

/**
 * FRED (미국 연준 경제통계) API 호출 및 최신 거시지표 수집
 * seriesId: DGS10 (미국 10년물 금리), FEDFUNDS (미국 기준금리), CPIAUCSL (소비자물가) 등
 */
function getFredData_(seriesId, limit) {
  var apiKey = getScriptProperty_('FRED_API_KEY', '');
  if (!apiKey) {
    // API 키가 없을 때의 안전한 우아한 Mock Fallback 데이터
    if (seriesId === 'DGS10') return { value: 4.42, date: amTodayString_(), name: '미국 10년물 국채금리', unit: '%', is_mock: true, source: 'FRED_FALLBACK_STATIC', warning: 'FRED API 키가 설정되지 않아 고정값을 반환합니다.' };
    if (seriesId === 'FEDFUNDS') return { value: 5.25, date: amTodayString_(), name: '미국 연방 기준금리', unit: '%', is_mock: true, source: 'FRED_FALLBACK_STATIC', warning: 'FRED API 키가 설정되지 않아 고정값을 반환합니다.' };
    if (seriesId === 'CPIAUCSL') return { value: 3.40, date: amTodayString_(), name: '미국 소비자물가지수 (CPI)', unit: '%', is_mock: true, source: 'FRED_FALLBACK_STATIC', warning: 'FRED API 키가 설정되지 않아 고정값을 반환합니다.' };
    return { value: 0, date: amTodayString_(), name: seriesId, unit: '', is_mock: true, source: 'FRED_FALLBACK_STATIC', warning: 'FRED API 키가 설정되지 않아 고정값을 반환합니다.' };
  }
  
  try {
    var url = 'https://api.stlouisfed.org/fred/series/observations?series_id=' + seriesId + 
              '&api_key=' + encodeURIComponent(apiKey) + 
              '&file_type=json&sort_order=desc&limit=' + (limit || 1);
              
    var response = UrlFetchApp.fetch(url, { method: 'get', muteHttpExceptions: true });
    if (response.getResponseCode() !== 200) {
      throw new Error('FRED HTTP ' + response.getResponseCode());
    }
    
    var json = JSON.parse(response.getContentText());
    if (json.observations && json.observations.length > 0) {
      var latest = json.observations[0];
      var val = parseFloat(latest.value);
      if (isNaN(val)) val = latest.value; // 숫자가 아닐 시 원래 문자열 유지
      
      var name = seriesId;
      var unit = '';
      if (seriesId === 'DGS10') { name = '미국 10년물 국채금리'; unit = '%'; }
      else if (seriesId === 'FEDFUNDS') { name = '미국 연방 기준금리'; unit = '%'; }
      else if (seriesId === 'CPIAUCSL') { name = '미국 소비자물가지수 (CPI)'; unit = '%'; }
      
      return {
        value: val,
        date: latest.date,
        name: name,
        unit: unit,
        is_mock: false,
        source: 'FRED_API'
      };
    }
  } catch(e) {
    logWarn_('macro_scanner', 'Failed to fetch FRED data for ' + seriesId + '. Using fallback.', { error: e.message });
  }
  
  // 에러 발생 시의 안전한 Fallback
  if (seriesId === 'DGS10') return { value: 4.42, date: amTodayString_(), name: '미국 10년물 국채금리', unit: '%', is_mock: true, source: 'FRED_ERROR_FALLBACK', warning: 'FRED API 호출 에러로 폴백되었습니다.' };
  if (seriesId === 'FEDFUNDS') return { value: 5.25, date: amTodayString_(), name: '미국 연방 기준금리', unit: '%', is_mock: true, source: 'FRED_ERROR_FALLBACK', warning: 'FRED API 호출 에러로 폴백되었습니다.' };
  return { value: 0, date: amTodayString_(), name: seriesId, unit: '', is_mock: true, source: 'FRED_ERROR_FALLBACK', warning: 'FRED API 호출 에러로 폴백되었습니다.' };
}

/**
 * ECOS (한국은행 경제통계시스템) API 호출 및 최신 지표 수집
 * statCode: 722Y001 (한국은행 기준금리), statItemCode1: 0101000 (기준금리)
 */
function getEcosData_(statCode, statItemCode1, limit) {
  var apiKey = getScriptProperty_('ECOS_API_KEY', '');
  if (!apiKey) {
    // API 키가 없을 때의 안전한 Mock Fallback 데이터
    if (statCode === '722Y001') return { value: 3.50, date: amTodayString_(), name: '한국 기준금리', unit: '%', is_mock: true, source: 'ECOS_FALLBACK_STATIC', warning: 'ECOS API 키가 설정되지 않아 고정값을 반환합니다.' };
    return { value: 0, date: amTodayString_(), name: statCode, unit: '', is_mock: true, source: 'ECOS_FALLBACK_STATIC', warning: 'ECOS API 키가 설정되지 않아 고정값을 반환합니다.' };
  }
  
  try {
    var todayStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd');
    var startStr = Utilities.formatDate(new Date(new Date().getTime() - 15 * 24 * 60 * 60 * 1000), Session.getScriptTimeZone(), 'yyyyMMdd'); // 최근 15일치 범위
    
    // ECOS API 표준 URL 형식
    // http://ecos.bok.or.kr/api/StatisticSearch/[APIKEY]/json/kr/1/[LIMIT]/[STATCODE]/[CYCLE]/[START]/[END]/[ITEMCODE]
    var url = 'http://ecos.bok.or.kr/api/StatisticSearch/' + encodeURIComponent(apiKey) + 
              '/json/kr/1/' + (limit || 1) + '/' + statCode + '/D/' + startStr + '/' + todayStr + '/' + statItemCode1;
              
    var response = UrlFetchApp.fetch(url, { method: 'get', muteHttpExceptions: true });
    if (response.getResponseCode() !== 200) {
      // 주별/월별 조회를 위해 보완 호출 (사이클을 M으로 강제 전환)
      var startStrM = startStr.substring(0, 6);
      var todayStrM = todayStr.substring(0, 6);
      url = 'http://ecos.bok.or.kr/api/StatisticSearch/' + encodeURIComponent(apiKey) + 
            '/json/kr/1/' + (limit || 1) + '/' + statCode + '/M/' + startStrM + '/' + todayStrM + '/' + statItemCode1;
      response = UrlFetchApp.fetch(url, { method: 'get', muteHttpExceptions: true });
    }
    
    if (response.getResponseCode() === 200) {
      var json = JSON.parse(response.getContentText());
      if (json.StatisticSearch && json.StatisticSearch.row && json.StatisticSearch.row.length > 0) {
        // 정렬 및 최신값 로드
        var rows = json.StatisticSearch.row;
        rows.sort(function(a, b) {
          return String(b.TIME || '').localeCompare(String(a.TIME || ''));
        });
        
        var latest = rows[0];
        var val = parseFloat(latest.DATA_VALUE);
        
        var name = statCode;
        var unit = '';
        if (statCode === '722Y001') { name = '한국 기준금리'; unit = '%'; }
        
        return {
          value: val,
          date: String(latest.TIME || '').replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3').replace(/(\d{4})(\d{2})/, '$1-$2'),
          name: name,
          unit: unit,
          is_mock: false,
          source: 'ECOS_API'
        };
      }
    }
  } catch(e) {
    logWarn_('macro_scanner', 'Failed to fetch ECOS data for ' + statCode + '. Using fallback.', { error: e.message });
  }
  
  // 에러 대비 안전 수치 리턴
  if (statCode === '722Y001') return { value: 3.50, date: amTodayString_(), name: '한국 기준금리', unit: '%', is_mock: true, source: 'ECOS_ERROR_FALLBACK', warning: 'ECOS API 호출 에러로 폴백되었습니다.' };
  return { value: 0, date: amTodayString_(), name: statCode, unit: '', is_mock: true, source: 'ECOS_ERROR_FALLBACK', warning: 'ECOS API 호출 에러로 폴백되었습니다.' };
}

/**
 * KRX / 시장 수급 동향 데이터 파싱 엔진
 * 코스피 시장의 외국인, 기관, 개인 순매수 데이터를 실시간 크롤링 및 파싱
 */
function getKrxInvestorTrend_() {
  var trend = {
    personal: 0, // 개인 (억원)
    foreigner: 0, // 외국인 (억원)
    institution: 0, // 기관 (억원)
    date: amTodayString_(),
    source: 'NAVER_FINANCE_FALLBACK'
  };
  
  try {
    // 한국 주식시장 투자자별 거래동향 실시간 페이지
    var url = 'https://finance.naver.com/sise/sise_trans_style.naver';
    var response = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      muteHttpExceptions: true
    });
    
    if (response.getResponseCode() === 200) {
      var html = response.getContentText('EUC-KR'); // 네이버 금융은 EUC-KR 인코딩 사용
      
      // 코스피 수급 파싱 정규식 설계
      // HTML 내 <table class="type_1"> 코스피 투자자별 매매동향 파싱
      // 개인, 외국인, 기관 순으로 적혀 있는 테이블 행을 역추적 스캔
      var kospiBlockMatch = html.match(/<h3 class="sub_tlt1">.*?<\/h3>([\s\S]*?)<\/table>/);
      if (kospiBlockMatch) {
        var tableHtml = kospiBlockMatch[1];
        // 금액 추출 정규식 (순서: 개인, 외국인, 기관)
        // 금액은 플러스일 경우 빨간색 클래스(red), 마이너스일 경우 파란색 클래스(blue)로 래핑되어 있음
        // 예: <td class="number_2"><span>-1,234</span></td> 또는 <td class="number_2 red"><span>+4,567</span></td>
        var numberPattern = /<td class="number_2[^"]*"><span>([^<]+)<\/span>/g;
        var matches = [];
        var m;
        while ((m = numberPattern.exec(tableHtml)) !== null) {
          matches.push(m[1].replace(/,/g, '').trim());
        }
        
        // 코스피 테이블 첫 행의 값들이 당일 장중 순매수 금액(억원 단위)임
        if (matches.length >= 3) {
          trend.personal = parseInt(matches[0]);
          trend.foreigner = parseInt(matches[1]);
          trend.institution = parseInt(matches[2]);
          trend.source = 'NAVER_KOSPI_LIVE';
          trend.is_mock = false;
          return trend;
        }
      }
    }
  } catch(e) {
    logWarn_('macro_scanner', 'Failed to parse live KRX market flow from NAVER. Using mock.', { error: e.message });
  }
  
  // 주말 또는 파싱 차단 대비 안정적인 Mock 수급 데이터
  trend.personal = -2450;
  trend.foreigner = 1890;
  trend.institution = 560;
  trend.source = 'MOCK_WEEKEND_FLOW';
  trend.is_mock = true;
  trend.warning = '네이버 금융 수급 페이지 파싱 실패 또는 주말 시간대여서 예시(mock) 데이터를 반환합니다.';
  return trend;
}

/**
 * 12대 API를 융합하여 종합 거시, 수급, 공시, 계좌잔고 데이터를 웹앱 및 AI 비서용 단일 JSON으로 조립
 */
function getIntegratedMacroMarketData() {
  ensureAllSheets_();
  var today = amTodayString_();
  
  // 1. 거시경제 지표 스캔 (FRED & ECOS)
  var us10y = getFredData_('DGS10');
  var usFed = getFredData_('FEDFUNDS');
  var krFed = getEcosData_('722Y001', '0101000');
  
  // 2. 시장 수급 스캔 (KRX / Live Flow)
  var marketFlow = getKrxInvestorTrend_();
  
  // 3. 실시간 보유 주식 DART 리스크 스캔 & KIS 포트폴리오 로드
  var holdings = [];
  try {
    collectHoldingsCurrent();
    holdings = readObjects_(AM_CONFIG.SHEETS.HOLDINGS_CURRENT).filter(function(row) {
      return normalizeDateValue_(row.date) === today;
    });
  } catch(e) {}
  
  var dartAlerts = [];
  var holdingsSummary = [];
  
  holdings.forEach(function(h) {
    var symbol = normalizeStockSymbol_(h.symbol);
    var pAmt = parseFloat(h.purchase_amount || 0);
    var eAmt = parseFloat(h.eval_amount || 0);
    
    if (symbol !== 'CASH') {
      holdingsSummary.push({
        name: h.name,
        symbol: symbol,
        weight: h.portfolio_weight_pct,
        yield: h.profit_loss_pct,
        eval_amount: eAmt,
        source: h.source
      });
      
      // DART 공시 위험 실시간 스캔 연동
      if (/^[0-9]/.test(symbol)) {
        try {
          var corpCode = getDartCorpCode_(symbol);
          if (corpCode) {
            var alerts = scanDartDisclosureRisk_(corpCode, symbol);
            alerts.forEach(function(al) {
              dartAlerts.push({
                name: h.name,
                symbol: symbol,
                reportName: al.reportName,
                level: al.riskLevel,
                message: al.message,
                pubDate: al.pubDate
              });
            });
          }
        } catch(de) {}
      }
    }
  });
  
  var portMode = String(getScriptProperty_('PORTFOLIO_MODE', 'REAL')).toUpperCase();
  
  return {
    timestamp: amNowString_(),
    portfolio_mode: portMode,
    macro: {
      us_10y_bond: us10y,
      us_fed_rate: usFed,
      kr_base_rate: krFed
    },
    market_flow: marketFlow,
    holdings: holdingsSummary,
    dart_alerts: dartAlerts
  };
}

/**
 * ECOS + FRED + KRX + DART + KIS 12대 API 융합형 Gemini AI 관제 분석 진단 보고서 발행 및 캐싱
 */
function getIntegratedMacroAdvice_(forceRefresh) {
  var apiKey = getRequiredScriptProperty_(AM_CONFIG.PROPERTY_KEYS.GEMINI_API_KEY);
  var today = amTodayString_();
  
  var cacheKey = 'AI_INTEGRATED_MACRO_ADVICE';
  var cacheDateKey = 'AI_INTEGRATED_MACRO_ADVICE_DATE';
  
  var cachedAdvice = getScriptProperty_(cacheKey, '');
  var cachedDate = getScriptProperty_(cacheDateKey, '');
  
  if (!forceRefresh && cachedAdvice && cachedDate === today) {
    logInfo_('macro_advice', 'Loaded integrated macro advice from script cache', { date: today });
    return { advice: cachedAdvice };
  }
  
  // 통합 융합 데이터 로드
  var meta = getIntegratedMacroMarketData();
  
  if (meta.holdings.length === 0) {
    return {
      advice: "<div class='no-assets-card'><h4>📋 포트폴리오 미감지</h4><p>현재 활성화된 보유 주식이 존재하지 않습니다. 먼저 스프레드시트에 수동 자산을 기록하거나 모의투자를 통해 포지션을 구축한 뒤 AI 융합 관제 보고서를 요청해 주세요.</p></div>"
    };
  }
  
  // Gemini Context 주입 프롬프트 빌드
  var us10yText = meta.macro.us_10y_bond.value + meta.macro.us_10y_bond.unit + ' (' + meta.macro.us_10y_bond.date + ')';
  var usFedText = meta.macro.us_fed_rate.value + meta.macro.us_fed_rate.unit + ' (' + meta.macro.us_fed_rate.date + ')';
  var krFedText = meta.macro.kr_base_rate.value + meta.macro.kr_base_rate.unit + ' (' + meta.macro.kr_base_rate.date + ')';
  
  var flowText = '개인: ' + formatNumber_(meta.market_flow.personal) + '억 원 | 외국인: ' + formatNumber_(meta.market_flow.foreigner) + '억 원 | 기관: ' + formatNumber_(meta.market_flow.institution) + '억 원 (코스피 수급)';
  
  var assetLines = meta.holdings.map(function(h) {
    return "- " + h.name + " (" + h.symbol + ") | 비중: " + h.weight + "% | 수익률: " + h.yield + "% | 평가액: " + formatNumber_(Math.round(h.eval_amount)) + "원";
  }).join('\n');
  
  var dartLines = meta.dart_alerts.length > 0 ? meta.dart_alerts.map(function(d) {
    return "- [" + d.name + "] " + d.level + " 위험 발생! 공시명: " + d.reportName + " (" + d.pubDate + ") - 내용: " + d.message;
  }).join('\n') : "보보유 종목 중 특이 공시 리스크 없음.";
  
  var isAnyMock = meta.macro.us_10y_bond.is_mock || meta.macro.us_fed_rate.is_mock || meta.macro.kr_base_rate.is_mock || meta.market_flow.is_mock;
  var mockWarningText = isAnyMock ? '\n⚠️ 주의: 현재 일부 거시경제 지표 또는 시장 수급 데이터가 API 연동 실패로 인해 예시(Mock) 데이터로 대체되었습니다. AI 자문 분석 시 이 점을 감안하여 분석 결과 상단에 "⚠️ 일부 데이터가 예시(Mock) 데이터이므로 실제 투자 시 참고용으로만 제한하여 활용하십시오"라는 안내 경고를 가독성 높은 HTML 디자인으로 반드시 포함하십시오.' : '';

  var prompt = [
    '너는 글로벌 헤지펀드 최고투자책임자(CIO)이자 리스크 관리 총괄 매니저이다.',
    '유저의 "미국/한국 거시경제 지표 + 한국 주식시장 수급동향 + 실시간 DART 위험 공시 + 현재 주식 계좌 잔고"를 연동 분석하여 종합 금융 자문 진단서를 작성해라.',
    '',
    '========================================',
    '📊 [실시간 통합 융합 데이터]',
    '========================================',
    '• 미국 10Y 국채금리: ' + us10yText,
    '• 미국 연방 기준금리: ' + usFedText,
    '• 대한민국 기준금리: ' + krFedText,
    '• 당일 시장 수급 흐름: ' + flowText,
    '',
    '• 실시간 보유 포트폴리오 자산:',
    assetLines,
    '',
    '• 실시간 DART 공시 위험 리스트:',
    dartLines,
    '========================================',
    '',
    '요구사항 및 형식:',
    '1. 아래 3대 항목으로 구성하고, 군더더기 서두나 결미 인사말 없이 명품 본론만 바로 출력해라.',
    '   - <b>[1] 🚨 거시경제 & 수급 종합 리스크 등급</b>: 현재 매크로 금리 차이와 외인 수급 상태를 고려한 종합 리스크 등급(안정/경계/위험) 판정과 명쾌한 1줄 근거 제시.',
    '   - <b>[2] 📉 거시 지표에 따른 보유 자산 민감도 진단</b>: 미국/한국 기준금리 수준과 보유 중인 종목군의 비중을 매칭하여 거시적 변화에 따른 포트폴리오 취약점 예리하게 지적.',
    '   - <b>[3] ⚙️ 자산배분 및 리밸런싱 핵심 대응 가이드</b>: 향후 추가 매수, 일부 매도, 현금 비중 조절 등 액션 플랜을 매우 구체적인 한글 조언으로 도출.',
    '2. HTML 태그(<b>, <i>, <code> 등)를 적재적소에 활용하여 다크 테마의 글래스모피즘 화면 안에서 최상의 가독성과 프리미엄 잡지 느낌을 줄 수 있도록 설계할 것.',
    '3. 반드시 격조 높고 전문성이 물씬 풍기는 냉철한 어조로 한글로 대답할 것.' + mockWarningText
  ].join('\n');
  
  var model = getScriptProperty_(AM_CONFIG.PROPERTY_KEYS.GEMINI_MODEL, 'gemini-1.5-flash');
  var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + apiKey;
  var payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.2 }
  };
  
  var response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  
  if (response.getResponseCode() !== 200) {
    throw new Error('Gemini Macro Advice API failed: ' + response.getContentText());
  }
  
  var res = JSON.parse(response.getContentText());
  var replyText = res.candidates[0].content.parts[0].text;
  
  // 캐싱 저장
  setScriptProperty_(cacheKey, replyText);
  setScriptProperty_(cacheDateKey, today);
  logInfo_('macro_advice', 'Successfully generated and cached new Integrated Macro Advice', { date: today });
  
  return { advice: replyText };
}
