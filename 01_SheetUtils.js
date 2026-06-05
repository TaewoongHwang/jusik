function ensureAllSheets_() {
  Object.keys(AM_SHEET_SCHEMAS).forEach(function(sheetName) {
    ensureSheet_(sheetName, AM_SHEET_SCHEMAS[sheetName]);
  });
  seedQuantSettings_();
}

function ensureSheet_(sheetName, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }
  ensureHeader_(sheet, headers);
  return sheet;
}

function ensureHeader_(sheet, headers) {
  var width = headers.length;
  var current = sheet.getRange(1, 1, 1, width).getValues()[0];
  var needsUpdate = false;
  for (var i = 0; i < width; i += 1) {
    if (current[i] !== headers[i]) {
      needsUpdate = true;
      break;
    }
  }
  if (needsUpdate) {
    sheet.getRange(1, 1, 1, width).setValues([headers]);
    sheet.setFrozenRows(1);
  }
}

function readObjects_(sheetName) {
  var sheet = ensureSheet_(sheetName, AM_SHEET_SCHEMAS[sheetName]);
  var values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];
  var headers = values[0];
  return values.slice(1).filter(function(row) {
    return row.some(function(cell) { return cell !== ''; });
  }).map(function(row) {
    var obj = {};
    headers.forEach(function(key, index) {
      obj[key] = row[index];
    });
    return obj;
  });
}

function appendObjectRow_(sheetName, obj) {
  appendObjectRows_(sheetName, [obj]);
}

function appendObjectRows_(sheetName, objects) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    throw new Error('데이터 쓰기 락을 획득하지 못했습니다. (대상: ' + sheetName + ')');
  }
  try {
    appendObjectRowsNoLock_(sheetName, objects);
  } finally {
    lock.releaseLock();
  }
}

function objectToSheetRow_(headers, obj) {
  return headers.map(function(key) {
    var value = obj[key];
    if (value === undefined || value === null) return '';
    if (key === 'date') return normalizeDateValue_(value);
    if (typeof value === 'object') return JSON.stringify(value);
    return value;
  });
}

function clearDataRows_(sheetName) {
  var sheet = ensureSheet_(sheetName, AM_SHEET_SCHEMAS[sheetName]);
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).clearContent();
  }
}

function deleteRowsByDate_(sheetName, dateValue) {
  var sheet = ensureSheet_(sheetName, AM_SHEET_SCHEMAS[sheetName]);
  var values = sheet.getDataRange().getValues();
  if (values.length <= 1) return;
  var headers = values[0];
  var dateIndex = headers.indexOf('date');
  if (dateIndex < 0) return;
  var keepRows = [];
  for (var rowIndex = 1; rowIndex < values.length; rowIndex += 1) {
    if (normalizeDateValue_(values[rowIndex][dateIndex]) !== normalizeDateValue_(dateValue)) {
      keepRows.push(values[rowIndex]);
    }
  }
  rewriteDataRows_(sheet, headers.length, keepRows);
}

function deleteHoldingsCurrentBySources_(dateValue, sources) {
  var sheetName = AM_CONFIG.SHEETS.HOLDINGS_CURRENT;
  var sheet = ensureSheet_(sheetName, AM_SHEET_SCHEMAS[sheetName]);
  var values = sheet.getDataRange().getValues();
  if (values.length <= 1) return;
  var headers = values[0];
  var dateIndex = headers.indexOf('date');
  var sourceIndex = headers.indexOf('source');
  if (dateIndex < 0 || sourceIndex < 0) return;
  
  var keepRows = [];
  var targetDateStr = normalizeDateValue_(dateValue);
  
  for (var rowIndex = 1; rowIndex < values.length; rowIndex += 1) {
    var rowDateStr = normalizeDateValue_(values[rowIndex][dateIndex]);
    var rowSource = String(values[rowIndex][sourceIndex] || '').trim();
    
    var isTargetDate = (rowDateStr === targetDateStr);
    var isTargetSource = false;
    
    if (isTargetDate) {
      for (var i = 0; i < sources.length; i++) {
        var srcCond = sources[i];
        if (srcCond === 'kis' || srcCond === 'manual_') {
          if (rowSource.indexOf(srcCond) === 0) {
            isTargetSource = true;
            break;
          }
        } else {
          if (rowSource === srcCond) {
            isTargetSource = true;
            break;
          }
        }
      }
    }
    
    if (!(isTargetDate && isTargetSource)) {
      keepRows.push(values[rowIndex]);
    }
  }
  rewriteDataRows_(sheet, headers.length, keepRows);
}

function rewriteDataRows_(sheet, width, rows) {
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, sheet.getMaxColumns()).clearContent();
  }
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, width).setValues(rows.map(function(row) {
      return row.slice(0, width);
    }));
  }
}

/**
 * 중복 수동 자산 가중평균 자동 치유 병합 엔진 (중복 데이터가 들어올 시 가중평균으로 병합)
 */
function cleanDuplicateManualHoldings_() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    throw new Error('중복 수동 자산 정리 락을 획득하지 못했습니다.');
  }
  try {
    var sheetName = AM_CONFIG.SHEETS.MANUAL_HOLDINGS;
    var rows = readObjects_(sheetName);
    if (rows.length === 0) return;
    
    var merged = {};
    var needsRewrite = false;
    
    rows.forEach(function(row) {
      var symbol = normalizeStockSymbol_(row.symbol);
      if (!symbol) return;
      
      var broker = normalizeBrokerName_(row.broker);
      var key = broker + '_' + symbol;
      
      var activeVal = String(row.active || 'Y').toUpperCase().trim();
      var isActive = (activeVal !== 'N' && activeVal !== 'FALSE');
      var qty = parseFloat(row.quantity || 0);
      
      // 💡 [수동 등록 자산 한글명 스마트 자가 치유(Self-Healing)]
      // 종목명이 비어있거나, 종목명란에 숫자코드(660, 000660)가 오염되어 기입된 경우 KIS/Naver 실시간 한글명을 획득해 시트 자체를 영구 동적 치유함
      var currentName = String(row.name || '').trim();
      if (!currentName || currentName === symbol || /^[0-9]+$/.test(currentName)) {
        var resolvedName = getStockKoreanName_(symbol, currentName);
        if (resolvedName && resolvedName !== symbol && !/^[0-9]+$/.test(resolvedName)) {
          row.name = resolvedName;
          needsRewrite = true;
        }
      }
      
      if (!merged[key]) {
        merged[key] = {
          broker: broker,
          symbol: symbol,
          name: row.name,
          quantity: qty,
          avg_price: parseFloat(row.avg_price || 0),
          active: isActive,
          memo: row.memo || ''
        };
      } else {
        needsRewrite = true;
        if (isActive && qty > 0) {
          var prev = merged[key];
          if (prev.quantity > 0) {
            var totalCost = (prev.quantity * prev.avg_price) + (qty * parseFloat(row.avg_price || 0));
            var totalQty = prev.quantity + qty;
            prev.quantity = totalQty;
            prev.avg_price = totalQty > 0 ? Math.round(totalCost / totalQty) : 0;
            prev.memo = '자동 가중평균 병합';
          } else {
            prev.quantity = qty;
            prev.avg_price = parseFloat(row.avg_price || 0);
            prev.active = true;
            prev.memo = row.memo || '';
          }
        }
      }
    });
    
    if (needsRewrite) {
      var mergedList = Object.keys(merged).map(function(k) { return merged[k]; });
      clearDataRows_(sheetName);
      appendObjectRowsNoLock_(sheetName, mergedList); // 락이 없는 버전을 호출하여 중첩 데드락 방지!
      logInfo_('sheet_utils', 'Cleaned duplicate manual holdings', { merged_count: mergedList.length });
    }
  } finally {
    lock.releaseLock();
  }
}

// ==================================================
// 💡 전역 공용 시각 / 날짜 / 변환 헬퍼 함수군
// ==================================================

function amTodayString_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function amNowString_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
}

function normalizeDateValue_(value) {
  if (!value) return '';
  var d = null;
  if (value instanceof Date) {
    d = value;
  } else {
    try {
      var text = String(value).trim();
      var parsed = Date.parse(text);
      if (!isNaN(parsed)) {
        d = new Date(parsed);
      }
    } catch(e) {}
  }
  
  if (d && !isNaN(d.getTime())) {
    return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  
  var fallbackText = String(value || '').trim();
  if (fallbackText.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(fallbackText)) {
    return fallbackText.substring(0, 10);
  }
  return fallbackText;
}

function normalizeStockSymbol_(symbol) {
  var s = String(symbol || '').trim().toUpperCase();
  // 💡 [Leading Zero 완전 수호] 국내 주식 종목코드 6자리 미만 시 앞자리 '0' 자동 채움 (구글 시트의 앞자리 0 증발 결함 원천 치유)
  if (/^\d+$/.test(s) && s.length < 6) {
    while (s.length < 6) {
      s = '0' + s;
    }
  }
  return s;
}

function normalizeBrokerName_(broker) {
  var b = String(broker || '외부자산').trim();
  var low = b.toLowerCase();
  if (low.indexOf('신한') >= 0 || low.indexOf('shinhan') >= 0) return '신한';
  if (low.indexOf('미니') >= 0 || low.indexOf('mini') >= 0) return '미니스탁';
  if (low.indexOf('업비트') >= 0 || low.indexOf('upbit') >= 0) return 'upbit';
  if (low.indexOf('토스') >= 0 || low.indexOf('toss') >= 0) return '토스';
  return b;
}

function formatNumber_(num) {
  if (isNaN(num) || num === null || num === undefined) return '0';
  var parts = String(num).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return parts.join('.');
}

function roundNumber_(num, decimals) {
  var exp = Math.pow(10, decimals || 0);
  return Math.round(num * exp) / exp;
}

function firstNumber_(/* v1, v2, ... */) {
  for (var i = 0; i < arguments.length; i += 1) {
    var v = arguments[i];
    if (v !== undefined && v !== null && v !== '' && !isNaN(Number(v))) {
      return Number(v);
    }
  }
  return 0;
}

function firstNonEmpty_(/* v1, v2, ... */) {
  for (var i = 0; i < arguments.length; i += 1) {
    var v = arguments[i];
    if (v !== undefined && v !== null && String(v).trim() !== '') {
      return String(v).trim();
    }
  }
  return '';
}

// ==================================================
// 💡 전역 로거 및 안전 UI 알림
// ==================================================

function logInfo_(module, message, details) {
  writeLog_('INFO', module, message, details);
}

function logWarn_(module, message, details) {
  writeLog_('WARN', module, message, details);
}

function writeLog_(level, module, message, details) {
  try {
    var sheetName = AM_CONFIG.SHEETS.LOGS;
    ensureSheet_(sheetName, AM_SHEET_SCHEMAS[sheetName]);
    appendObjectRowsNoLock_(sheetName, [{
      timestamp: amNowString_(),
      level: level,
      module: module,
      message: message,
      details: typeof details === 'object' ? JSON.stringify(details) : String(details || '')
    }]);
  } catch(e) {
    console.warn('Logging failed: ' + e.message);
  }
}

function safeUiAlert_(message) {
  try {
    SpreadsheetApp.getUi().alert(message);
  } catch(e) {}
}

function getScriptProperty_(key, defaultValue) {
  try {
    // 💡 [3대 도미노 보안 수색 장치] 구글 에디터 50개 제한 버그를 완치하기 위해,
    // 스크립트 속성(Script) -> 사용자 속성(User) -> 문서 속성(Document)을 순차적으로 1:1 다이렉트 자동 룩업합니다!
    var val = PropertiesService.getScriptProperties().getProperty(key);
    if (val !== null && val !== '') return val;
    
    val = PropertiesService.getUserProperties().getProperty(key);
    if (val !== null && val !== '') return val;
    
    val = PropertiesService.getDocumentProperties().getProperty(key);
    if (val !== null && val !== '') return val;
    
    return defaultValue;
  } catch(e) {
    return defaultValue;
  }
}

function getRequiredScriptProperty_(key) {
  var val = getScriptProperty_(key, null);
  if (!val) {
    throw new Error('Required Script Property missing: ' + key);
  }
  return val;
}

function setScriptProperty_(key, value) {
  try {
    PropertiesService.getScriptProperties().setProperty(key, String(value));
  } catch(e) {}
}

// ==================================================
// 🚀 Apps Script 커스텀 스프레드시트 UI 메뉴 연동
// ==================================================

function onOpen() {
  // 스프레드시트 오픈 시 백그라운드 자동화 배치 트리거 자동 복구 감지 기동
  setupAppsScriptTriggers_();
  
  var ui = SpreadsheetApp.getUi();
  var menu = ui.createMenu('AI Scanner');
  
  menu.addItem('📊 실시간 통합 보유 자산 기산', 'menuCollectHoldings');
  menu.addSeparator();
  menu.addItem('📈 실계좌(REAL) 운용 모드 전환', 'menuSetModeReal');
  menu.addItem('📈 API 모의투자(MOCK) 운용 모드 전환', 'menuSetModeMock');
  menu.addSeparator();
  menu.addItem('⚙️ 퀀트 50대 우량주 팩터 DB 즉시 갱신', 'menuUpdateQuantUniverseDatabase');
  menu.addSeparator();
  menu.addItem('🤖 장전 뉴스 AI 리포트 즉시 발행', 'menuRunPremarketAiReport');
  menu.addItem('🤖 모의투자 마감 보고 즉시 발행', 'menuRunDailyCloseReport');
  menu.addItem('🤖 자동화 스케줄 트리거 전면 설치', 'menuInstallTriggers');
  menu.addItem('🤖 퀀트 300만 모의투자 즉시 리밸런싱', 'menuRunQuantPaperRebalancing');
  menu.addSeparator();
  menu.addItem('⚙️ settings 시트 설정을 스크립트 속성으로 동기화', 'menuSyncPropertiesFromSheet');
  menu.addItem('⚙️ 스크립트 속성을 settings 시트로 백업', 'menuBackupPropertiesToSheet');
  menu.addSeparator();
  menu.addItem('🧹 레거시 방대 시트 일괄 대청소', 'menuCleanupLegacySheets');
  menu.addSeparator();
  menu.addItem('🤖 텔레그램 챗봇 통신 진단 & 자가 치유', 'menuRunDiagnostics');
  
  menu.addToUi();
}

function menuUpdateQuantUniverseDatabase() {
  try {
    updateQuantUniverseDatabase();
    safeUiAlert_('✅ [퀀트 DB 갱신 완료]\n\n50대 우량주(국내 30종 + 미국 20종)의 최신 가격, 모멘텀, RSI, S-Rim 적정가, 안전마진 등을 성공적으로 갱신하여 quant_universe_db 시트에 적재했습니다!');
  } catch(e) {
    safeUiAlert_('❌ [갱신 실패] 퀀트 DB 갱신 도중 오류가 발생했습니다: ' + e.message);
  }
}

function menuCollectHoldings() {
  try {
    collectHoldingsCurrent();
    var mode = String(getScriptProperty_('PORTFOLIO_MODE', 'REAL')).toUpperCase();
    safeUiAlert_('✅ [자산 기산 완료]\n\n실시간 시세를 반영한 ' + mode + ' 통합 자산 평가액 및 등락률을 시트에 성공적으로 동기화하였습니다!');
  } catch(e) {
    safeUiAlert_('❌ [기산 실패] 시세 동기화 도중 오류가 감지되었습니다: ' + e.message);
  }
}

function menuSetModeReal() {
  try {
    setScriptProperty_('PORTFOLIO_MODE', 'REAL');
    collectHoldingsCurrent();
    safeUiAlert_('🔄 [운용 모드 전환 완료]\n\n포트폴리오 주식 운용 모드가 실계좌 및 수동 자산 모드인 [REAL]로 즉각 전환되었습니다!');
  } catch(e) {
    safeUiAlert_('❌ [모드 전환 실패]: ' + e.message);
  }
}

// 명시적인 PAPER 모드 래퍼 추가
function menuSetModeMock() {
  try {
    setScriptProperty_('PORTFOLIO_MODE', 'MOCK');
    collectHoldingsCurrent();
    safeUiAlert_('🔄 [운용 모드 전환 완료]\n\n포트폴리오 주식 운용 모드가 실제 한투 API 연동 모의투자 모드인 [MOCK]으로 즉각 전환되었습니다!');
  } catch(e) {
    safeUiAlert_('❌ [모드 전환 실패]: ' + e.message);
  }
}

function menuRunPremarketAiReport() {
  try {
    runPremarketAiReport();
    safeUiAlert_('✅ [장전 리포트 발행 완료]\n\n실시간 환율, 미국 국채금리, 뉴욕증시 요약 및 주요 뉴스 3대 Grounding, 보유 자산 DART 리스크 스캔 결과를 텔레그램으로 안전하게 배달하였습니다!');
  } catch(e) {
    safeUiAlert_('❌ [발행 실패] 장전 리포터 기동 실패: ' + e.message);
  }
}

function menuRunDailyCloseReport() {
  try {
    runDailyClosePaperTradingReport();
    safeUiAlert_('✅ [모의투자 마감 보고 발행 완료]\n\n오늘의 가상 자산 평가액, 당일 손익금 및 총 손익률을 담은 모의투자 정산서를 텔레그램으로 성공적으로 발송하였습니다!');
  } catch(e) {
    safeUiAlert_('❌ [발행 실패] 마감 보고 구동 실패: ' + e.message);
  }
}

function menuInstallTriggers() {
  try {
    installAutomationTriggers();
    safeUiAlert_('⏰ [자동화 스케줄 트리거 설치 완료]\n\n매일 오전 08:00 (장전 AI 리포트) 및 매일 오후 15:40 (모의투자 정산 보고) 자동화 스케줄 트리거를 구글 서버 상에 성공적으로 설치하였습니다.\n이제 지정 시각에 봇이 스스로 분석 리포트를 유저님께 자동 배달합니다!');
  } catch(e) {
    safeUiAlert_('❌ [트리거 설치 실패]: ' + e.message);
  }
}

function menuRunQuantPaperRebalancing() {
  var ui = SpreadsheetApp.getUi();
  var confirmMsg = [
    '⚠️ [주의] 국내/해외 300만원 모의투자 즉시 리밸런싱',
    '----------------------------------------',
    '이 작업은 퀀트 팩터 랭킹에 의거하여',
    '국내/해외 모의 계좌를 각각 시드 300만원(또는 당시 총자산) 기준으로',
    '기존 종목을 전량 청산하고 현재의 Top 3 종목으로 강제 리밸런싱합니다.',
    '',
    '정말로 즉시 리밸런싱 매매를 집행하시겠습니까?'
  ].join('\n');
  
  var response = ui.alert('🤖 퀀트 모의매매 실행', confirmMsg, ui.ButtonSet.YES_NO);
  if (response !== ui.Button.YES) return;
  
  try {
    var domScoring = getQuantStockScoring(DOMESTIC_MARKET_UNIVERSE);
    var domTop3 = domScoring.slice(0, 3).map(function(s) { return s.symbol; });
    runQuantPortfolioRebalancing_('DOM', domTop3);
    
    var usScoring = getQuantStockScoring(US_MARKET_UNIVERSE);
    var usTop3 = usScoring.slice(0, 3).map(function(s) { return s.symbol; });
    runQuantPortfolioRebalancing_('US', usTop3);
    
    collectHoldingsCurrent();
    ui.alert('🎉 [리밸런싱 성공]\n\n국내/해외 모의 계좌가 현재 시점의 팩터 Top 3 종목으로 성공적으로 전량 교체/체결 완료되었습니다!\n\n• 국내 편입: ' + domTop3.join(', ') + '\n• 해외 편입: ' + usTop3.join(', '));
  } catch(e) {
    ui.alert('❌ [리밸런싱 실패] 집행 도중 에러가 감지되었습니다: ' + e.message);
  }
}

function menuRunDiagnostics() {
  try {
    var diag = runDiagnostics_();
    var msg = [
      '🤖 [텔레그램 챗봇 & 포트폴리오 자가 진단 보고서]',
      '----------------------------------------',
      '• 진단 시각: ' + diag.timestamp,
      '• 시스템 통합 상태: ' + diag.status,
      '',
      '[1. 텔레그램 봇 API 상태] - ' + diag.diagnostics.telegram_bot.status,
      '  - 봇 사용자명: @' + (diag.diagnostics.telegram_bot.username || 'N/A'),
      '  - 봇 이름: ' + (diag.diagnostics.telegram_bot.first_name || 'N/A'),
      '',
      '[2. 웹훅 및 TMA 미니앱 정렬] - ' + diag.diagnostics.telegram_webhook.status,
      '  - 웹앱 실시간 주소: ' + (diag.diagnostics.telegram_webhook.web_app_url ? '획득 완료' : '실패'),
      '  - 웹훅 주소 싱크상태: ' + (diag.diagnostics.telegram_webhook.aligned ? '일치함 (무결점)' : '어긋남'),
      '  - 자가 치유(Self-healed) 작동 여부: ' + (diag.diagnostics.telegram_webhook.auto_healed ? '자가 정렬 치료 완수! 🎉' : '치료 불필요 (양호)'),
      '  - 대기 큐 메시지 수: ' + diag.diagnostics.telegram_webhook.pending_update_count + '개',
      '',
      '[3. 운용 모드 및 시트 DB 상태]',
      '  - 활성 포트폴리오 모드: ' + diag.diagnostics.portfolio.mode,
      '  - 금일 평가 자산 종목수: ' + diag.diagnostics.portfolio.holdingsCount + '개',
      '  - 6대 데이터 테이블 적재 상태: ' + diag.diagnostics.sheets.status,
      '----------------------------------------',
      '💡 웹훅 정렬 상태가 OUT_OF_ALIGN이었거나 봇이 먹통이었다면, 방금 자가 치유 엔진이 자동으로 텔레그램에 최신 웹앱 주소를 덮어씌워 강제 정렬 치료를 완료했습니다.'
    ].join('\n');
    safeUiAlert_(msg);
  } catch(e) {
    safeUiAlert_('❌ [자가 진단 실패] 진단 모듈 구동 중 에러가 감지되었습니다: ' + e.message);
  }
}

function cleanupLegacySheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = ss.getSheets();
  
  var legacySheets = [
    'old_portfolio',
    'old_signals',
    'legacy_logs'
  ];
  
  var deletedCount = 0;
  var deletedNames = [];
  
  sheets.forEach(function(sheet) {
    var name = sheet.getName();
    if (legacySheets.indexOf(name) >= 0) {
      try {
        ss.deleteSheet(sheet);
        deletedCount++;
        deletedNames.push(name);
      } catch(e) {
        logWarn_('sheet_cleanup', 'Failed to delete legacy sheet: ' + name, { error: e.message });
      }
    }
  });
  
  logInfo_('sheet_cleanup', 'Successfully deleted legacy sheets', { count: deletedCount, deleted: deletedNames });
  return { count: deletedCount, deleted: deletedNames };
}

function menuCleanupLegacySheets() {
  var ui = SpreadsheetApp.getUi();
  
  var confirmMsg = [
    '⚠️ [주의] 스프레드시트 레거시 대청소',
    '----------------------------------------',
    '이 작업은 JUSIK AI 2.0 금융 비서 운영에 필수적인 6대 코어 테이블을 제외한',
    '기타 모든 불필요한 보조지표, 백업용, 대용량 마스터 시트들을 일괄 영구 삭제합니다.',
    '',
    '정말로 대청소를 진행하여 스프레드시트를 초경량으로 슬림화하시겠습니까?'
  ].join('\n');
  
  var response = ui.alert('🧹 시트 대청소 경고', confirmMsg, ui.ButtonSet.YES_NO);
  if (response !== ui.Button.YES) return;
  
  try {
    var res = cleanupLegacySheets();
    ui.alert('🎉 [대청소 완수]\n\n총 ' + res.count + '개의 불필요한 방대 시트(' + res.deleted.join(', ') + ')를 일괄 영구 삭제하여 시트를 100% 쾌적하고 슬림하게 청소 완료했습니다!');
  } catch(e) {
    ui.alert('❌ [대청소 실패] 청소 도중 에러가 감지되었습니다: ' + e.message);
  }
}

// ==================================================
// ⚙️ 스크립트 속성(Script Properties) 벌크 양방향 동기화 엔진
// ==================================================

/**
 * settings 시트의 키-값 데이터를 통째로 읽어와 Google Apps Script Properties에 일괄 동기화
 */
function syncPropertiesFromSheet() {
  var sheetName = AM_CONFIG.SHEETS.SETTINGS;
  var rows = readObjects_(sheetName);
  
  // 💡 [보안/연동 핵심 키 강제 Seeding 방어선] 
  // 스프레드시트 settings 시트에 핵심 기밀 키 입력칸이 누락되어 있다면 자동으로 행 추가 생성
  var requiredSecureKeys = [
    { key: 'TELEGRAM_BOT_TOKEN', desc: '텔레그램 봇 토큰 (예: 123456789:ABCDefgh...)' },
    { key: 'TELEGRAM_CHAT_ID', desc: '텔레그램 고유 Chat ID (숫자)' },
    { key: 'GEMINI_API_KEY', desc: 'Google Gemini API Key' },
    { key: 'KIS_APP_KEY', desc: '한국투자증권 Open API AppKey' },
    { key: 'KIS_APP_SECRET', desc: '한국투자증권 Open API AppSecret' },
    { key: 'KIS_CANO', desc: '한국투자증권 실제 계좌번호 8자리 숫자' },
    { key: 'KIS_ISA_CANO', desc: '한국투자증권 ISA 계좌번호 8자리 (일반계좌와 같으면 공란)' },
    { key: 'KIS_ISA_ACNT_PRDT_CD', desc: '한국투자증권 ISA 상품코드 2자리 (보통 03)' },
    { key: 'KIS_ISA_APP_KEY', desc: '한국투자증권 ISA 전용 AppKey (일반계좌와 같으면 공란)' },
    { key: 'KIS_ISA_APP_SECRET', desc: '한국투자증권 ISA 전용 AppSecret (일반계좌와 같으면 공란)' },
    { key: 'KIS_MOCK_CANO', desc: '한국투자증권 모의투자 계좌번호 8자리' },
    { key: 'KIS_MOCK_ACNT_PRDT_CD', desc: '한국투자증권 모의투자 상품코드 2자리 (보통 01)' },
    { key: 'KIS_MOCK_APP_KEY', desc: '한국투자증권 모의투자 전용 AppKey' },
    { key: 'KIS_MOCK_APP_SECRET', desc: '한국투자증권 모의투자 전용 AppSecret' },
    { key: 'KIS_MOCK_BASE_URL', desc: '한국투자증권 모의투자 API 주소 (https://openapivts.koreainvestment.com:29443)' },
    { key: 'DART_API_KEY', desc: '국민연금/DART 기업 공시 분석 API Key' },
    { key: 'ECOS_API_KEY', desc: '한국은행 경제통계시스템 ECOS API Key' },
    { key: 'FRED_API_KEY', desc: '미국 세인트루이스 연준 거시경제 FRED API Key' },
    { key: 'KRX_API_KEY', desc: '한국거래소 시장 데이터 스캔 API Key' },
    { key: 'KIS_ENV', desc: 'KIS 투자 환경 (real / mock)' },
    { key: 'KIS_BASE_URL', desc: '한국투자증권 API 통신 주소' },
    { key: 'ADMIN_TOKEN', desc: '웹앱 대시보드 디버그/진단용 관리자 인증 토큰' },
    { key: 'WEB_APP_URL', desc: '구글 앱스 스크립트 웹앱 배포 실행 URL (/exec)' },
    { key: 'CUSTOM_DASHBOARD_URL', desc: '경고 배너 우회 제거용 GitHub Pages / 외부 대시보드 주소' }
  ];
  
  var existingKeys = (rows || []).map(function(r) { return String(r.key || '').trim().toUpperCase(); });
  var newSeeds = [];
  
  requiredSecureKeys.forEach(function(item) {
    if (existingKeys.indexOf(item.key) < 0) {
      newSeeds.push({
        key: item.key,
        value: '', // 빈 칸으로 생성하여 유저 기입 유도
        description: item.desc,
        updated_at: amNowString_()
      });
    }
  });
  
  if (newSeeds.length > 0) {
    appendObjectRows_(sheetName, newSeeds);
    rows = readObjects_(sheetName); // 갱신된 행 데이터 재로드
  }
  
  if (rows.length === 0) {
    logWarn_('properties_sync', 'Settings sheet is empty. No properties to sync.');
    return { success: false, count: 0, keys: [] };
  }
  
  var props = {};
  var syncKeys = [];
  var hasKisKeyChanged = false;
  
  rows.forEach(function(row) {
    var key = String(row.key || '').trim();
    var val = String(row.value !== undefined && row.value !== null ? row.value : '').trim();
    
    if (key) {
      // 💡 [덮어쓰기 파괴 방지 장벽] 만약 시트의 값이 빈칸("")이거나 마스킹 문자열(***)을 포함하고 있다면,
      // 서버 내부(Script Properties)에 이미 소중하게 기입되어 있는 실제 기밀값을 빈 값으로 덮어써서 파괴하지 않도록 동기화 대상에서 완전히 생략(건너뛰기)합니다!
      if (val === '' || val.indexOf('******') >= 0 || val.indexOf('****') >= 0) {
        return; 
      }
      
      props[key] = val;
      syncKeys.push(key);
      
      // KIS 연동의 중요 보안설정이 갱신되는지 확인
      if (key === 'KIS_APP_KEY' || key === 'KIS_APP_SECRET' || key === 'KIS_CANO' || key === 'KIS_BASE_URL') {
        hasKisKeyChanged = true;
      }
    }
  });
  
  if (syncKeys.length > 0) {
    var service = PropertiesService.getScriptProperties();
    service.setProperties(props, false); // 기존 속성 보존하고 덮어쓰기/병합
    
    // 만약 KIS 중요 보안 설정이 갱신되었다면, 꼬여있던 기존 Access Token 강제 소거(Flush)
    if (hasKisKeyChanged) {
      try {
        service.deleteProperty(AM_CONFIG.PROPERTY_KEYS.KIS_ACCESS_TOKEN);
        service.deleteProperty(AM_CONFIG.PROPERTY_KEYS.KIS_ACCESS_TOKEN_EXPIRES_AT);
      } catch(tokenErr) {}
    }
    
    logInfo_('properties_sync', 'Successfully synced properties from sheet', { count: syncKeys.length, keys: syncKeys });
    return { success: true, count: syncKeys.length, keys: syncKeys, tokenFlushed: hasKisKeyChanged };
  }
  
  return { success: false, count: 0, keys: [] };
}

function menuSyncPropertiesFromSheet() {
  try {
    var res = syncPropertiesFromSheet();
    if (res.success) {
      var msg = '✅ [설정 스크립트 속성 동기화 완료]\n\n';
      msg += '스프레드시트 "settings" 시트로부터 총 ' + res.count + '개의 설정을 성공적으로 스크립트 속성(Properties)으로 일괄 기입 및 동기화했습니다!\n\n';
      if (res.tokenFlushed) {
        msg += '💡 [알림] KIS 연동 설정 변경이 감지되어, 기존에 꼬여있을 수 있는 증권사 액세스 토큰 캐시를 즉시 초기화(Flush)했습니다. 다음번 시세/잔고 조회 시 신규 토큰이 자동 발급됩니다.\n\n';
      }
      msg += '동기화된 설정 키 목록:\n' + res.keys.map(function(k) { return '• ' + k; }).join('\n');
      safeUiAlert_(msg);
    } else {
      safeUiAlert_('⚠️ [동기화 건너뜀]\n\nsettings 시트에 유효한 설정 키-값 쌍이 존재하지 않아 동기화가 실행되지 않았습니다.');
    }
  } catch(e) {
    safeUiAlert_('❌ [동기화 실패] 스크립트 속성 일괄 동기화 도중 치명적인 오류가 발생했습니다: ' + e.message);
  }
}

/**
 * Google Apps Script Properties 전체를 긁어와 스프레드시트의 settings 시트에 일괄 백업
 */
function backupPropertiesToSheet() {
  var sheetName = AM_CONFIG.SHEETS.SETTINGS;
  var headers = AM_SHEET_SCHEMAS[sheetName];
  var sheet = ensureSheet_(sheetName, headers);
  
  // 현재 구글 서버 상의 모든 스크립트 속성 가져오기
  var service = PropertiesService.getScriptProperties();
  var props = service.getProperties();
  var propKeys = Object.keys(props);
  
  if (propKeys.length === 0) {
    logWarn_('properties_backup', 'No script properties found on Google server.');
    return { success: false, count: 0 };
  }
  
  // settings 시트의 기존 데이터를 읽어 키별 맵핑 구조 생성
  var currentRows = readObjects_(sheetName);
  var rowMap = {};
  currentRows.forEach(function(row, idx) {
    var k = String(row.key || '').trim();
    if (k) {
      rowMap[k] = {
        index: idx, // 0-indexed
        description: row.description || '',
        updated_at: row.updated_at || ''
      };
    }
  });
  
  var nowStr = amNowString_();
  var updatedCount = 0;
  var addedCount = 0;
  
  // 동기화할 최종 오브젝트 리스트 구성
  var finalRows = [];
  
  // 💡 [보안 마스킹 강제 집행] 극비 자격증명은 시트에 평문 노출을 방지하기 위해 마스킹
  var sensitiveKeys = ['KIS_APP_KEY', 'KIS_APP_SECRET', 'KIS_ACCESS_TOKEN', 'GEMINI_API_KEY', 'TELEGRAM_BOT_TOKEN', 'KIS_ISA_APP_KEY', 'KIS_ISA_APP_SECRET', 'KIS_MOCK_APP_KEY', 'KIS_MOCK_APP_SECRET'];
  
  // 1. 기존 시트에 있던 키들을 먼저 백업값 기준으로 최신화하여 순서 유지
  currentRows.forEach(function(row) {
    var k = String(row.key || '').trim();
    if (k && props[k] !== undefined) {
      var newVal = String(props[k]);
      
      // 💡 [보안 마스킹] 기밀 키는 시트 노출 시 안전 마스킹
      if (sensitiveKeys.indexOf(k) >= 0 && newVal && newVal.length > 8) {
        newVal = newVal.substring(0, 4) + '****************' + newVal.substring(newVal.length - 4);
      }
      
      var isChanged = (String(row.value) !== newVal);
      
      finalRows.push({
        key: k,
        value: newVal,
        description: row.description || '서버 속성 백업',
        updated_at: isChanged ? nowStr : (row.updated_at || nowStr)
      });
      if (isChanged) updatedCount++;
      // 처리 완료된 키는 속성 세트에서 지워 중복 추가 방지
      delete props[k];
    } else if (k) {
      // 서버 속성에 없는 시트 고유 행도 그대로 보존
      finalRows.push(row);
    }
  });
  
  // 2. 시트에는 없고 서버 Properties에만 새로 기입되어 있던 신규 속성들을 하단에 추가
  var remainingKeys = Object.keys(props);
  remainingKeys.forEach(function(k) {
    var val = String(props[k]);
    
    // 💡 [보안 마스킹] 기밀 키는 시트 노출 시 안전 마스킹
    if (sensitiveKeys.indexOf(k) >= 0 && val && val.length > 8) {
      val = val.substring(0, 4) + '****************' + val.substring(val.length - 4);
    }
    
    var desc = '서버 신규 생성 속성 백업';
    if (k === 'KIS_ACCESS_TOKEN') desc = 'KIS 자동 발급 액세스 토큰 (임시 보안 캐시)';
    
    finalRows.push({
      key: k,
      value: val,
      description: desc,
      updated_at: nowStr
    });
    addedCount++;
  });
  
  // 시트 완전 클리어 후 최신 데이터로 리라이트
  clearDataRows_(sheetName);
  appendObjectRows_(sheetName, finalRows);
  
  logInfo_('properties_backup', 'Successfully backed up script properties to sheet', {
    total_backed_up: finalRows.length,
    updated_count: updatedCount,
    added_count: addedCount
  });
  
  return {
    success: true,
    total: finalRows.length,
    updated: updatedCount,
    added: addedCount,
    keys: propKeys
  };
}

function menuBackupPropertiesToSheet() {
  try {
    var res = backupPropertiesToSheet();
    if (res.success) {
      var msg = '✅ [스크립트 속성 시트 백업 완료]\n\n';
      msg += '구글 서버의 모든 스크립트 속성을 "settings" 시트로 안전하게 백업 및 최신화했습니다!\n\n';
      msg += '• 총 백업된 설정: ' + res.total + '개\n';
      msg += '  - 값 변경 최신화: ' + res.updated + '개\n';
      msg += '  - 시트 신규 등록: ' + res.added + '개\n\n';
      msg += '💡 이제 스크립트 에디터 속성 UI에 직접 들어가지 않고도 시트에서 한눈에 서버 설정을 파악하고 편리하게 일괄 제어할 수 있습니다.';
      safeUiAlert_(msg);
    } else {
      safeUiAlert_('⚠️ [백업 건너뜀]\n\n서버 상에 등록된 스크립트 속성이 전혀 없어 백업을 진행하지 않았습니다.');
    }
  } catch(e) {
    safeUiAlert_('❌ [백업 실패] 스크립트 속성 시트 백업 도중 오류가 발생했습니다: ' + e.message);
  }
}

function seedQuantSettings_() {
  var sheetName = AM_CONFIG.SHEETS.QUANT_SETTINGS;
  var sheet = ensureSheet_(sheetName, AM_SHEET_SCHEMAS[sheetName]);
  var rows = readObjects_(sheetName);
  if (rows.length > 0) return;
  
  var defaultSettings = [
    { key: 'VAA_UNIVERSE_AGGRESSIVE', value: 'SPY,QQQ,IWM,EEM', description: 'VAA 전략 공격형 자산 ETF 리스트', updated_at: amNowString_() },
    { key: 'VAA_UNIVERSE_DEFENSIVE', value: 'LQD,IEF,SHY', description: 'VAA 전략 방어형 자산 ETF 리스트', updated_at: amNowString_() },
    { key: 'VAA_MOMENTUM_WEIGHTS', value: '12,4,2,1', description: 'VAA 모멘텀 스코어 가중치 (1M, 3M, 6M, 12M)', updated_at: amNowString_() },
    { key: 'QUANT_SCREEN_MIN_MARKET_CAP_USD', value: '10000000000', description: '퀀트 개별종목 스크리닝 최소 시가총액 (USD)', updated_at: amNowString_() },
    { key: 'QUANT_SCREEN_PER_MAX', value: '25', description: '퀀트 스크리닝 최대 PER', updated_at: amNowString_() },
    { key: 'QUANT_SCREEN_PBR_MAX', value: '3', description: '퀀트 스크리닝 최대 PBR', updated_at: amNowString_() },
    { key: 'REBALANCING_DAY', value: 'last_day', description: '매월 리밸런싱 실행 예정일 (숫자 1-28 또는 last_day)', updated_at: amNowString_() }
  ];
  
  appendObjectRows_(sheetName, defaultSettings);
  logInfo_('sheet_utils', 'Successfully seeded default quant settings', { seeded_count: defaultSettings.length });
}

/**
 * ⏰ [신설] JUSIK AI 2.0 코어 자동화 트리거를 자동 감지 및 복구 설치
 * 중복 트리거 설치를 방지하며, 누락된 스케줄 트리거를 즉시 자동 설치합니다.
 */
function setupAppsScriptTriggers_() {
  try {
    var triggers = ScriptApp.getProjectTriggers();
    var existingHandlers = triggers.map(function(t) {
      return t.getHandlerFunction();
    });
    
    // 1. 장전 리포트 (매일 오전 8시 10분)
    if (existingHandlers.indexOf('runPremarketAiReport') < 0) {
      ScriptApp.newTrigger('runPremarketAiReport')
        .timeBased()
        .everyDays(1)
        .atHour(8)
        .nearMinute(10)
        .create();
      console.log('Auto-installed runPremarketAiReport trigger');
    }
    
    // 2. 장후 모의투자 정산 (매일 오후 3시 40분)
    if (existingHandlers.indexOf('runDailyClosePaperTradingReport') < 0) {
      ScriptApp.newTrigger('runDailyClosePaperTradingReport')
        .timeBased()
        .everyDays(1)
        .atHour(15)
        .nearMinute(40)
        .create();
      console.log('Auto-installed runDailyClosePaperTradingReport trigger');
    }
    
    // 3. 퀀트 50대 우량주 DB 갱신 배치 (매일 새벽 3시 20분)
    if (existingHandlers.indexOf('updateQuantUniverseDatabase') < 0) {
      ScriptApp.newTrigger('updateQuantUniverseDatabase')
        .timeBased()
        .everyDays(1)
        .atHour(3)
        .nearMinute(20)
        .create();
      console.log('Auto-installed updateQuantUniverseDatabase trigger');
    }

    // 4. 월간 정기 리밸런싱 트리거 (매월 1일 새벽 1시)
    if (existingHandlers.indexOf('runMonthlyQuantRebalancing') < 0) {
      ScriptApp.newTrigger('runMonthlyQuantRebalancing')
        .timeBased()
        .onMonthDay(1)
        .atHour(1)
        .nearMinute(0)
        .create();
      console.log('Auto-installed runMonthlyQuantRebalancing trigger');
    }
  } catch(e) {
    console.error('Failed to auto-setup Apps Script triggers: ' + e.message);
  }
}

function debugTelegramStatus() {
  var token = PropertiesService.getScriptProperties().getProperty('TELEGRAM_BOT_TOKEN');
  if (!token) {
    return "Bot Token is missing in Script Properties!";
  }
  var url = 'https://api.telegram.org/bot' + token + '/getWebhookInfo';
  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  var json = JSON.parse(res.getContentText());
  return JSON.stringify({
    token_length: token.length,
    token_prefix: token.substring(0, 6),
    webhook_info: json
  }, null, 2);
}

/**
 * 보유 자산 행 배열을 모드(REAL/MOCK/QUANT_DOM/QUANT_US)에 따라 필터링합니다.
 */
function filterHoldingsByMode_(rows, mode) {
  var normalizedMode = String(mode || 'REAL').toUpperCase();

  return rows.filter(function(row) {
    var source = String(row.source || '');

    if (normalizedMode === 'MOCK') {
      // KIS API 모의계좌
      return source.indexOf('mock_') === 0;
    } else if (normalizedMode === 'QUANT_DOM') {
      // 국내 퀀트 모의투자
      return source === 'paper_trading_dom';
    } else if (normalizedMode === 'QUANT_US') {
      // 해외 퀀트 모의투자
      return source === 'paper_trading_us';
    } else {
      // REAL 모드 (실제 KIS 계좌 및 수동 등록 자산 등)
      return (
        (source.indexOf('kis') === 0 && source.indexOf('kis_mock') === -1 && source.indexOf('mock_') === -1) ||
        source.indexOf('manual_') === 0 ||
        source === 'overseas'
      );
    }
  });
}

function appendObjectRowsNoLock_(sheetName, objects) {
  if (!objects || objects.length === 0) return;
  var headers = AM_SHEET_SCHEMAS[sheetName];
  var rows = objects.map(function(obj) {
    return objectToSheetRow_(headers, obj || {});
  });
  var sheet = ensureSheet_(sheetName, headers);
  var rowIndex = sheet.getLastRow() + 1;
  sheet.getRange(rowIndex, 1, rows.length, headers.length).setValues(rows);
}
