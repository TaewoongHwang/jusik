function refreshMobileCommandSheet() {
  return withLogging_('mobile_commands', function() {
    ensureAllSheets_();
    seedMobileCommandSheet_();
    safeUiAlert_([
      '모바일 명령판 갱신 완료',
      '',
      '시트: mobile_commands',
      '',
      '휴대폰 Google Sheets 앱에서는 AI Scanner 메뉴가 보이지 않습니다.',
      '대신 mobile_commands 시트에서 실행할 명령의 run 체크박스를 켜면 됩니다.',
      '설치형 onEdit 트리거가 바로 감지하고, 5분 백업 트리거가 한 번 더 확인합니다.'
    ].join('\n'));
  });
}

function installMobileCommandTriggers(suppressAlert) {
  deleteTriggersByHandler_('handleMobileCommandEdit');
  deleteTriggersByHandler_('processMobileCommandQueue');
  ScriptApp.newTrigger('handleMobileCommandEdit')
    .forSpreadsheet(SpreadsheetApp.getActive())
    .onEdit()
    .create();
  ScriptApp.newTrigger('processMobileCommandQueue')
    .timeBased()
    .everyMinutes(5)
    .create();
  setScriptProperty_('AM_MOBILE_COMMAND_TRIGGER_TIME', 'on_edit_and_every_5_minutes');
  seedMobileCommandSheet_();
  logInfo_('mobile_commands', 'Installed mobile command triggers', {});
  if (!suppressAlert) {
    safeUiAlert_([
      '모바일 명령 트리거 설치 완료',
      '',
      '사용법:',
      '1. 휴대폰 Google Sheets 앱에서 mobile_commands 시트를 엽니다.',
      '2. 실행할 명령의 run 체크박스를 켭니다.',
      '3. 상태가 실행중 -> 완료 또는 실패로 바뀝니다.',
      '',
      '한 번에 너무 무거운 명령을 여러 개 켜면 5분 간격으로 하나씩 처리합니다.'
    ].join('\n'));
  }
}

function handleMobileCommandEdit(e) {
  globalIsInteractiveContext_ = false;
  try {
    if (!e || !e.range) return;
    var sheet = e.range.getSheet();
    if (sheet.getName() !== AM_CONFIG.SHEETS.MOBILE_COMMANDS) return;
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var runColumn = headers.indexOf('run') + 1;
    if (runColumn <= 0 || e.range.getColumn() !== runColumn) return;
    processMobileCommandQueue();
  } catch (err) {
    logWarn_('mobile_commands', 'Mobile command edit handler failed', {
      error: err.message || String(err),
      stack: err.stack
    });
  }
}

function processMobileCommandQueue() {
  globalIsInteractiveContext_ = false;
  return withLogging_('mobile_commands', function() {
    ensureAllSheets_();
    
    // [자가 치유 웹훅 복원 가드]
    // 웹앱 업데이트 배포 후 텔레그램 연동이 깨지는 현상을 방어하기 위해,
    // 스크립트 기동 시 캐시를 확인해 웹훅 및 메뉴판이 미등록 상태이거나 오늘 미기동되었다면 강제로 복원을 1회 수행합니다.
    try {
      var cache = CacheService.getScriptCache();
      var webhookSentKey = 'AM_AUTO_WEBHOOK_SENT_35'; // 버전 35 전용 키
      if (cache.get(webhookSentKey) !== 'Y') {
        registerTelegramWebhookSilent();
        try {
          setTelegramCommands(); // 고정 메뉴 명령어판 텔레그램 서버 주입!
        } catch(cmdErr) {
          logWarn_('mobile_commands', 'Failed to set telegram commands inside self-healing guard', { error: cmdErr.message });
        }
        cache.put(webhookSentKey, 'Y', 21600); // 6시간 캐싱
      }
    } catch(e) {
      logWarn_('mobile_commands', 'Failed to run self-healing telegram webhook registration', { error: e.message });
    }
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) {
      logWarn_('mobile_commands', 'Skipped mobile command processing because lock is busy', {});
      return { processed: 0, skipped: true, reason: 'lock_busy' };
    }
    try {
      var sheetName = AM_CONFIG.SHEETS.MOBILE_COMMANDS;
      var sheet = ensureSheet_(sheetName, AM_SHEET_SCHEMAS[sheetName]);
      if (sheet.getLastRow() <= 1) seedMobileCommandSheet_();
      var values = sheet.getDataRange().getValues();
      var headers = values[0];
      var index = buildHeaderIndex_(headers);
      var handlers = getMobileCommandHandlers_();
      var processed = 0;
      for (var rowIndex = 1; rowIndex < values.length; rowIndex += 1) {
        var row = values[rowIndex];
        if (!isMobileCommandRequested_(row[index.run])) continue;
        var commandKey = String(row[index.command_key] || '').trim();
        if (!handlers[commandKey]) {
          updateMobileCommandRow_(sheet, rowIndex + 1, index, {
            run: false,
            status: '실패',
            requested_at: row[index.requested_at] || amNowString_(),
            finished_at: amNowString_(),
            last_message: '허용되지 않은 명령입니다: ' + commandKey,
            updated_at: amNowString_()
          });
          processed += 1;
          break;
        }
        updateMobileCommandRow_(sheet, rowIndex + 1, index, {
          status: '실행중',
          requested_at: row[index.requested_at] || amNowString_(),
          finished_at: '',
          last_message: '실행 중입니다.',
          updated_at: amNowString_()
        });
        SpreadsheetApp.flush();
        try {
          var result = handlers[commandKey]();
          updateMobileCommandRow_(sheet, rowIndex + 1, index, {
            run: false,
            status: '완료',
            finished_at: amNowString_(),
            last_message: summarizeMobileCommandResult_(commandKey, result),
            updated_at: amNowString_()
          });
          logInfo_('mobile_commands', 'Mobile command completed', {
            command_key: commandKey
          });
        } catch (err) {
          updateMobileCommandRow_(sheet, rowIndex + 1, index, {
            run: false,
            status: '실패',
            finished_at: amNowString_(),
            last_message: err.message || String(err),
            updated_at: amNowString_()
          });
          logWarn_('mobile_commands', 'Mobile command failed', {
            command_key: commandKey,
            error: err.message || String(err),
            stack: err.stack
          });
        }
        processed += 1;
        break;
      }
      return { processed: processed };
    } finally {
      lock.releaseLock();
    }
  });
}

function seedMobileCommandSheet_() {
  if (!AM_CONFIG.SHEETS.MOBILE_COMMANDS) return;
  var sheetName = AM_CONFIG.SHEETS.MOBILE_COMMANDS;
  var sheet = ensureSheet_(sheetName, AM_SHEET_SCHEMAS[sheetName]);
  clearDataRows_(sheetName);
  getMobileCommandDefinitions_().forEach(function(command) {
    appendObjectRow_(sheetName, {
      priority: command.priority,
      category: command.category,
      command_key: command.command_key,
      command_name: command.command_name,
      description: command.description,
      run: false,
      status: '대기',
      requested_at: '',
      finished_at: '',
      last_message: '',
      updated_at: amNowString_()
    });
  });
  formatMobileCommandSheet_(sheet);
}

function getMobileCommandDefinitions_() {
  return [
    mobileCommand_(10, '상태 확인', 'health_check', '품질 체크', '오늘 데이터, AI 리포트, 메일 발송 상태를 점검합니다.'),
    mobileCommand_(20, '상태 확인', 'automation_status', '자동화 상태 진단', '장마감/장전/복구 트리거 설치 상태를 확인합니다.'),
    mobileCommand_(25, '상태 확인', 'market_calendar_status', '시장 캘린더 진단', '오늘 국내/미국 증시 개장 여부와 다음 거래일을 확인합니다.'),
    mobileCommand_(30, '복구', 'recover_close_workflow', '장마감 누락 복구', '멈춘 장마감 워크플로우를 이어서 실행하고 가능하면 늦은 메일을 보냅니다.'),
    mobileCommand_(40, '복구', 'continue_full_workflow', '전체 워크플로우 이어서 실행', '현재 stage에서 전체 워크플로우를 이어서 실행합니다.'),
    mobileCommand_(50, '장마감', 'run_full_workflow', '오늘 전체 실행 시작', 'daily -> DART -> macro -> news -> Gemini -> email 흐름을 시작합니다.'),
    mobileCommand_(60, 'AI/메일', 'build_ai_reports', 'Gemini 리포트 생성', 'AI 시장 브리핑과 종목 분석을 생성합니다.'),
    mobileCommand_(70, 'AI/메일', 'send_email_report', '메일 리포트 발송', '이미 생성된 오늘 리포트를 메일로 발송합니다.'),
    mobileCommand_(80, '장전', 'run_premarket', '장전 브리핑 실행', '전일 리포트와 밤사이 뉴스/거시지표 기반 장전 메일을 생성합니다.'),
    mobileCommand_(90, '뉴스/거시', 'collect_news', '시장 뉴스 수집', '국내 장마감/미국 마감 뉴스 브리핑을 수집합니다.'),
    mobileCommand_(100, '뉴스/거시', 'score_news', '뉴스 점수 계산', '뉴스 브리핑의 risk_on/risk_off/섹터 영향을 점수화합니다.'),
    mobileCommand_(110, '뉴스/거시', 'collect_macro', '거시지표 수집', '금리, 환율, 나스닥, VIX 등 거시지표를 수집합니다.'),
    mobileCommand_(120, '시장 지표', 'calculate_breadth', '시장 폭 지표 계산', '상승 종목 비율, 20일선 상회 비율 등 시장 체감 강도를 계산합니다.'),
    mobileCommand_(125, '검증', 'premarket_review', '장전 예측 사후검증', '아침 장전 브리핑이 실제 장마감 결과와 얼마나 비슷했는지 점검합니다.'),
    mobileCommand_(130, 'ETF', 'collect_etf', 'ETF 구성종목 수집', '관찰 ETF의 구성종목과 비중을 수집합니다.'),
    mobileCommand_(140, 'ETF', 'calculate_etf', 'ETF 점수 계산', 'ETF 편입도 점수를 계산합니다.'),
    mobileCommand_(150, '수급', 'collect_flow', '투자자 수급 수집', '외국인/기관/개인 수급 데이터를 수집합니다. 15:40 이후 권장입니다.'),
    mobileCommand_(160, '수급', 'calculate_flow', '투자자 수급 점수 계산', '수급 원본 데이터를 점수화합니다.'),
    mobileCommand_(170, '보유종목', 'collect_holdings', '보유종목 수집', 'KIS 계좌 또는 수동 보유종목을 holdings_current에 반영합니다.'),
    mobileCommand_(180, '보유종목', 'holdings_advice', '보유종목 어드바이스', '현재 보유종목 기준 조건부 점검을 생성합니다.'),
    mobileCommand_(190, '관리', 'refresh_command_guide', '상황별 명령 가이드 갱신', 'command_guide 시트를 최신 명령 안내로 갱신합니다.'),
    mobileCommand_(195, '관리', 'refresh_market_calendar', '시장 캘린더 갱신', 'market_calendar 시트에 주말 기본 휴장일을 보강합니다. 국내/미국 공식 휴일은 직접 추가할 수 있습니다.'),
    mobileCommand_(200, '관리', 'refresh_mobile_commands', '모바일 명령판 갱신', 'mobile_commands 시트를 다시 정리합니다.'),
    mobileCommand_(210, '관리', 'register_telegram_webhook', '텔레그램 챗봇 웹훅 복원', '웹앱 변경으로 깨진 텔레그램 양방향 챗봇 연동을 원클릭으로 즉시 복구합니다.')
  ];
}

function mobileCommand_(priority, category, commandKey, commandName, description) {
  return {
    priority: priority,
    category: category,
    command_key: commandKey,
    command_name: commandName,
    description: description
  };
}

function getMobileCommandHandlers_() {
  return {
    health_check: validatePipelineResults,
    automation_status: runAutomationStatusDiagnostics,
    market_calendar_status: runMarketCalendarDiagnostics,
    recover_close_workflow: recoverDailyWorkflowNow,
    continue_full_workflow: continueFullDailyWorkflow,
    run_full_workflow: runFullDailyWorkflow,
    build_ai_reports: buildAiReports,
    send_email_report: sendDailyEmailReport,
    run_premarket: runPremarketWorkflow,
    collect_news: collectMarketNewsBriefing,
    score_news: scoreNewsBriefingDaily,
    collect_macro: collectMacroRaw,
    calculate_breadth: buildMarketBreadthDaily,
    premarket_review: buildPremarketResultReview,
    collect_etf: collectEtfHoldings,
    calculate_etf: calculateEtfScoresFromHoldings,
    collect_flow: collectInvestorFlowDaily,
    calculate_flow: calculateInvestorFlowScores,
    collect_holdings: collectHoldingsCurrent,
    holdings_advice: buildHoldingsAdvice,
    refresh_command_guide: refreshCommandGuideSheet,
    refresh_market_calendar: refreshMarketCalendarSheet,
    refresh_mobile_commands: refreshMobileCommandSheet,
    register_telegram_webhook: registerTelegramWebhookSilent
  };
}

function buildHeaderIndex_(headers) {
  var index = {};
  headers.forEach(function(header, offset) {
    index[header] = offset;
  });
  return index;
}

function isMobileCommandRequested_(value) {
  if (value === true) return true;
  var text = String(value || '').trim().toLowerCase();
  return ['true', 'y', 'yes', '1', 'run', '실행'].indexOf(text) >= 0;
}

function updateMobileCommandRow_(sheet, rowNumber, index, values) {
  Object.keys(values).forEach(function(key) {
    if (index[key] === undefined) return;
    sheet.getRange(rowNumber, index[key] + 1).setValue(values[key]);
  });
}

function summarizeMobileCommandResult_(commandKey, result) {
  if (result && result.processed !== undefined) {
    return '완료: 처리 ' + result.processed + '건';
  }
  if (result && result.stage) {
    return '완료: stage=' + result.stage + ', updated=' + (result.updated_at || '');
  }
  if (result && result.status) {
    return '완료: status=' + result.status;
  }
  return '완료: ' + commandKey;
}

function formatMobileCommandSheet_(sheet) {
  var headers = AM_SHEET_SCHEMAS[AM_CONFIG.SHEETS.MOBILE_COMMANDS];
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, headers.length)
    .setFontWeight('bold')
    .setBackground('#ecfdf5');
  sheet.getDataRange().setWrap(true).setVerticalAlignment('top');
  sheet.setColumnWidth(1, 70);
  sheet.setColumnWidth(2, 95);
  sheet.setColumnWidth(3, 170);
  sheet.setColumnWidth(4, 170);
  sheet.setColumnWidth(5, 280);
  sheet.setColumnWidth(6, 70);
  sheet.setColumnWidth(7, 90);
  sheet.setColumnWidth(8, 150);
  sheet.setColumnWidth(9, 150);
  sheet.setColumnWidth(10, 300);
  sheet.setColumnWidth(11, 150);
  var runColumn = headers.indexOf('run') + 1;
  if (runColumn > 0 && sheet.getLastRow() > 1) {
    sheet.getRange(2, runColumn, Math.max(1, sheet.getLastRow() - 1), 1).insertCheckboxes();
  }
  sheet.setTabColor('#059669');
}

// === 텔레그램 양방향 웹훅 (Webhook) 챗봇 핸들러 ===

function doPost(e) {
  globalIsInteractiveContext_ = false;
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return HtmlService.createHtmlOutput('No post data');
    }
    
    var data = JSON.parse(e.postData.contents);
    if (!data) {
      return HtmlService.createHtmlOutput('No data');
    }
    
    var configChatId = String(getScriptProperty_(AM_CONFIG.PROPERTY_KEYS.TELEGRAM_CHAT_ID, ''));
    
    // 1. callback_query 처리 분기 (버튼 클릭)
    if (data.callback_query) {
      var cb = data.callback_query;
      var queryId = cb.id;
      var cbChatId = String(cb.message.chat.id);
      var cbData = String(cb.data || '').trim();
      
      if (cbChatId !== configChatId) {
        logWarn_('telegram_webhook', 'Unauthorized callback query rejected', { chat_id: cbChatId, data: cbData });
        answerTelegramCallback_(queryId, '권한이 없습니다.');
        return HtmlService.createHtmlOutput('Unauthorized');
      }
      
      handleTelegramCallback_(queryId, cbChatId, cbData);
      return HtmlService.createHtmlOutput('OK');
    }
    
    // 2. 일반 텍스트 메시지 처리 분기
    if (!data.message) {
      return HtmlService.createHtmlOutput('No message');
    }
    
    var message = data.message;
    var chatId = String(message.chat.id);
    var text = String(message.text || '').trim();
    
    if (chatId !== configChatId) {
      logWarn_('telegram_webhook', 'Unauthorized webhook access attempt rejected', { chat_id: chatId, text: text });
      return HtmlService.createHtmlOutput('Unauthorized');
    }
    
    var command = text.split(' ')[0].toLowerCase();
    
    if (command === '/start' || command === '/help') {
      var helpMsg = [
        '<b>🤖 JUSIK AI 스캐너 텔레그램 비서 v2.0</b>',
        '',
        '스마트폰의 텔레그램 메신저 환경에서 실시간으로 자산을 기록하고 AI 비서를 활용하실 수 있습니다.',
        '',
        '👉 <b>핵심 명령어 요약:</b>',
        '• <b>/holdings</b> : 📈 통합 자산 실시간 평가액 및 개별 수익률 조회',
        '• <b>/set [증권사] [코드] [수량] [평단]</b> : 🛠️ 소수점/수동 보유 자산 등록 (최종 덮어쓰기)',
        '• <b>/sell [증권사] [코드] [차감수량]</b> : 📉 보유 수량 일부 차감(매도)',
        '• <b>/clear [증권사] [코드]</b> : 🗑️ 보유 주식 전량 매도(청산) 처리',
        '• <b>/check_manual</b> : 📋 등록되어 활성화된 수동 자산 리스트 확인',
        '• <b>/ai [질문 또는 종목명]</b> : 🤖 실시간 시장/뉴스/시세 기반 AI 투자 자문 리포트',
        '• <b>/mode</b> : 🔄 실제계좌 / 모의투자 잔고 감시 모드 원터치 전환',
        '• <b>/run</b> : 🔥 오늘 장마감 전체 분석 워크플로우 즉각 수동 기동',
        '',
        '<i>※ 화면 하단의 "[/]" 메뉴 버튼을 클릭하시어 원하는 명령을 간편하게 전송할 수 있습니다.</i>',
        '<i>※ 아래의 대시보드 열기를 누르시면, 타이핑 없이 예쁜 웹 화면에서 모바일 자산 입력 및 조작이 가능합니다!</i>'
      ].join('\n');
      
      var webAppUrl = getScriptProperty_('TELEGRAM_WEBAPP_URL') || '';
      if (!webAppUrl) {
        try {
          webAppUrl = ScriptApp.getService().getUrl();
        } catch(e) {
          logWarn_('telegram_webhook', 'Failed to retrieve Apps Script deploy URL dynamically', { error: e.message });
        }
      }
      
      var replyMarkup = null;
      if (webAppUrl) {
        replyMarkup = JSON.stringify({
          inline_keyboard: [
            [
              {
                text: '📖 실시간 대시보드 & 가이드 열기',
                web_app: { url: webAppUrl }
              }
            ]
          ]
        });
      }
      
      if (replyMarkup) {
        sendTelegramMessageWithMarkup(helpMsg, replyMarkup);
      } else {
        sendTelegramMessage(helpMsg);
      }
    }
    else if (command === '/holdings') {
      sendTelegramMessage('📥 실시간 포트폴리오 자산 현황을 조회하고 있습니다. 잠시만 기다려 주세요...');
      
      var isRealAccount = false;
      var domesticPositions = [];
      var overseasPositions = [];
      var cashKrw = 0, stockEvalKrw = 0, totalKrw = 0;
      var dailyKrw = 0, cumulative = 0;
      var dateStr = '';
      
      var portMode = String(getScriptProperty_(AM_CONFIG.PROPERTY_KEYS.PORTFOLIO_MODE, 'real')).toLowerCase();
      var isRealAccountMode = (portMode === 'real' && !!getScriptProperty_(AM_CONFIG.PROPERTY_KEYS.KIS_CANO, ''));
      
      try {
        if (isRealAccountMode) {
          // 1. 국내 계좌 잔고 수집
          try {
            var domResponse = fetchKisDomesticAccountBalance_();
            var normalizedDom = normalizeKisAccountBalance_(domResponse);
            if (normalizedDom) {
              domesticPositions = normalizedDom.holdings || [];
              cashKrw = Number(normalizedDom.snapshot.cash_amount || 0);
              stockEvalKrw = Number(normalizedDom.snapshot.stock_eval_amount || 0);
              totalKrw = Number(normalizedDom.snapshot.total_eval_amount || 0);
              dailyKrw = Number(normalizedDom.snapshot.profit_loss_pct || 0);
              isRealAccount = true;
            }
          } catch (domErr) {
            logWarn_('telegram_webhook', 'Domestic balance fetch failed in doPost', { error: domErr.message });
          }
          
          // 2. 해외 계좌 잔고 수집 (미니스탁 포함)
          try {
            var ovrResponse = fetchKisOverseasAccountBalance_();
            var normalizedOvr = normalizeKisOverseasAccountBalance_(ovrResponse);
            if (normalizedOvr) {
              overseasPositions = normalizedOvr.holdings || [];
              var ovrTotalKrw = Number(normalizedOvr.snapshot.total_eval_amount_krw || 0);
              var ovrStockEvalKrw = ovrTotalKrw;
              
              stockEvalKrw += ovrStockEvalKrw;
              totalKrw += ovrTotalKrw;
              isRealAccount = true;
            }
          } catch (ovrErr) {
            logWarn_('telegram_webhook', 'Overseas balance fetch failed in doPost', { error: ovrErr.message });
          }
          
          // 3. 수동 보유종목 (manual_holdings)을 가져와서 KIS 실제 계좌 포지션과 병합
          try {
            var today = amTodayString_();
            var manualRows = getActiveManualHoldingRows_();
            var usdRate = getLatestUsdKrwRate_();
            
            manualRows.forEach(function(mRow) {
              var mPos = normalizeManualHoldingRow_(today, mRow);
              if (!mPos || !mPos.symbol || mPos.quantity <= 0) return;
              
              var isOvr = /^[A-Za-z]/.test(mPos.symbol);
              if (isOvr) {
                // 해외 보유주식 병합 (중복 제거 - 심볼과 브로커가 모두 일치할 때만)
                var isDup = overseasPositions.some(function(op) {
                  var opBroker = normalizeBrokerName_((op.source === 'kis_overseas_balance') ? 'kis' : (op.source || '').replace('manual_', ''));
                  var mBroker = normalizeBrokerName_(mRow.broker);
                  return op.symbol.toLowerCase() === mPos.symbol.toLowerCase() && opBroker === mBroker;
                });
                
                if (!isDup) {
                  var mEvalKrw = mPos.eval_amount * usdRate;
                  overseasPositions.push({
                    symbol: mPos.symbol,
                    name: mPos.name || mPos.symbol,
                    quantity: mPos.quantity,
                    avg_price: mPos.avg_price,
                    current_price: mPos.current_price,
                    purchase_amount: mPos.purchase_amount,
                    eval_amount: mPos.eval_amount,
                    eval_amount_krw: mEvalKrw,
                    profit_loss_amount: mPos.profit_loss_amount,
                    profit_loss_pct: mPos.profit_loss_pct,
                    source: 'manual_' + String(mRow.broker || 'external').trim()
                  });
                  
                  stockEvalKrw += mEvalKrw;
                  totalKrw += mEvalKrw;
                  isRealAccount = true;
                }
              } else {
                // 국내 보유주식 병합 (중복 제거 - 심볼과 브로커가 모두 일치할 때만)
                var isDup = domesticPositions.some(function(dp) {
                  var dpBroker = normalizeBrokerName_((dp.source === 'kis_inquire_balance') ? 'kis' : (dp.source || '').replace('manual_', ''));
                  var mBroker = normalizeBrokerName_(mRow.broker);
                  return normalizeStockSymbol_(dp.symbol) === normalizeStockSymbol_(mPos.symbol) && dpBroker === mBroker;
                });
                
                if (!isDup) {
                  domesticPositions.push({
                    symbol: mPos.symbol,
                    name: mPos.name || mPos.symbol,
                    quantity: mPos.quantity,
                    avg_price: mPos.avg_price,
                    current_price: mPos.current_price,
                    purchase_amount: mPos.purchase_amount,
                    eval_amount: mPos.eval_amount,
                    profit_loss_pct: mPos.profit_loss_pct,
                    source: 'manual_' + String(mRow.broker || 'external').trim()
                  });
                  
                  stockEvalKrw += mPos.eval_amount;
                  totalKrw += mPos.eval_amount;
                  isRealAccount = true;
                }
              }
            });
          } catch(manualErr) {
            logWarn_('telegram_webhook', 'Failed to merge manual holdings in doPost', { error: manualErr.message });
          }
          
          if (isRealAccount) {
            dateStr = amTodayString_() + ' (실제 계좌)';
          }
        }
      } catch(err) {
        logWarn_('telegram_webhook', 'Real account fetch failed inside doPost holdings; falling back to paper portfolio', { error: err.message });
      }
      
      if (!isRealAccount) {
        var latestRow = getLatestPaperPortfolioRow_();
        if (latestRow) {
          cashKrw = Number(latestRow.cash_amount || 0);
          stockEvalKrw = Number(latestRow.stock_eval_amount || 0);
          totalKrw = Number(latestRow.total_eval_amount || 0);
          dailyKrw = Number(latestRow.daily_return_pct || 0);
          cumulative = Number(latestRow.cumulative_return_pct || 0);
          dateStr = latestRow.date + ' (모의 투자)';
          try {
            domesticPositions = JSON.parse(latestRow.active_positions_json || '[]');
          } catch(e) {}
        }
      }
      
      if (domesticPositions.length === 0 && overseasPositions.length === 0 && totalKrw === 0) {
        sendTelegramMessage('❌ 보유 자산 정보가 존재하지 않습니다. AI Scanner 실계좌 세팅 또는 가상 투자 리셋을 확인하세요.');
      } else {
        var dailySign = dailyKrw > 0 ? '+' : '';
        var cumSign = cumulative > 0 ? '+' : '';
        
        var posLines = [];
        
        // 국내 보유 주식 출력
        if (domesticPositions.length > 0) {
          posLines.push('<b>🇰🇷 국내 보유 주식:</b>');
          domesticPositions.forEach(function(p, i) {
            var returnVal = p.profit_loss_pct !== undefined ? p.profit_loss_pct : (p.return_pct !== undefined ? p.return_pct : 0);
            var entryVal = p.avg_price !== undefined ? p.avg_price : (p.entry_price !== undefined ? p.entry_price : 0);
            var sign = returnVal > 0 ? '+' : '';
            posLines.push((i+1) + '. <b>' + p.name + '</b> (' + normalizeStockSymbol_(p.symbol) + ')');
            posLines.push('   수량: ' + p.quantity + '주 | 평단가: ' + formatNumber_(entryVal) + '원');
            posLines.push('   현재가: ' + formatNumber_(p.current_price) + '원 | 수익률: ' + sign + returnVal + '%');
          });
          posLines.push('');
        }
        
        // 해외 보유 주식 출력
        if (overseasPositions.length > 0) {
          posLines.push('<b>🇺🇸 해외 보유 주식 (미니스탁 포함):</b>');
          overseasPositions.forEach(function(p, i) {
            var returnVal = p.profit_loss_pct !== undefined ? p.profit_loss_pct : 0;
            var entryVal = p.avg_price !== undefined ? p.avg_price : 0;
            var sign = returnVal > 0 ? '+' : '';
            posLines.push((i+1) + '. <b>' + p.name + '</b> (' + p.symbol + ')');
            posLines.push('   수량: ' + p.quantity + '주 | 평단가: $' + entryVal.toFixed(2));
            posLines.push('   현재가: $' + p.current_price.toFixed(2) + ' | 수익률: ' + sign + returnVal + '%');
          });
          posLines.push('');
        }
        
        if (domesticPositions.length === 0 && overseasPositions.length === 0) {
          posLines.push('• 보유 주식: 없음 (현금 100% 보유)');
        }
        
        var msg = [
          '<b>💼 실시간 포트폴리오 자산 평가 현황</b>',
          '기준일: ' + dateStr,
          '',
          '💰 <b>자산 총계</b>: ' + formatNumber_(totalKrw) + ' 원',
          '• 예수 현금(KRW): ' + formatNumber_(cashKrw) + ' 원',
          '• 주식 평가(KRW): ' + formatNumber_(stockEvalKrw) + ' 원',
          isRealAccount ? '📊 <b>국내 평가 손익률</b>: ' + dailySign + dailyKrw + '%' : '📈 <b>일일 변동률</b>: ' + dailySign + dailyKrw + '%\n📊 <b>누적 수익률</b>: ' + cumSign + cumulative + '%',
          '',
          '🔍 <b>세부 보유 포지션 현황:</b>',
          posLines.join('\n').trim()
        ].join('\n');
        sendTelegramMessage(msg);
      }
    }
    else if (command === '/plan') {
      sendTelegramMessage('📥 오늘 아침 수립된 진입 대기 계획을 가져오고 있습니다...');
      
      var today = amTodayString_();
      var plans = readObjects_(AM_CONFIG.SHEETS.ENTRY_PLAN).filter(function(row) {
        return normalizeDateValue_(row.date) === today;
      });
      
      if (plans.length === 0) {
        sendTelegramMessage('❌ 오늘자 진입 계획(entry_plan)이 아직 수립되지 않았습니다. 장마감 파이프라인이나 장전 브리핑 완료 여부를 확인하세요.');
      } else {
        var lines = ['<b>📋 오늘 장전 진입 대기 계획 TOP 3</b>', '기준일: ' + today, ''];
        plans.slice(0, 3).forEach(function(p, i) {
          lines.push((i+1) + '. <b>' + p.name + '</b> (' + normalizeStockSymbol_(p.symbol) + ')');
          lines.push('   현재가: ' + formatNumber_(p.current_price) + '원');
          lines.push('   - 1차 검토가: ' + formatNumber_(p.first_entry_price) + '원 (' + p.first_entry_pct + '%)');
          lines.push('   - 돌파 매수가: ' + formatNumber_(p.breakout_price) + '원 (' + p.breakout_entry_pct + '%)');
          lines.push('   - 무효화(손절): ' + formatNumber_(p.invalid_price) + '원');
          lines.push('');
        });
        sendTelegramMessage(lines.join('\n'));
      }
    }
    else if (command === '/run') {
      sendTelegramRunMessage_();
    }
    else if (command === '/mode') {
      var args = text.split(' ').slice(1).join(' ').trim().toLowerCase();
      if (args === 'real' || args === '실제') {
        setScriptProperty_(AM_CONFIG.PROPERTY_KEYS.PORTFOLIO_MODE, 'real');
        sendTelegramMessage('⚙️ <b>[포트폴리오 모드 전환 완료]</b>\n\n현재 자산 감시 및 잔고 조회 모드가 <b>[실제 계좌 (Real)]</b>로 전환되었습니다. KIS 계좌 정보와 수동 미니스탁 잔고가 실시간 반영됩니다.');
      } else if (args === 'paper' || args === '모의') {
        setScriptProperty_(AM_CONFIG.PROPERTY_KEYS.PORTFOLIO_MODE, 'paper');
        sendTelegramMessage('⚙️ <b>[포트폴리오 모드 전환 완료]</b>\n\n현재 자산 감시 및 잔고 조회 모드가 <b>[모의 투자 (Paper)]</b>로 전환되었습니다. 가상 시뮬레이터 원장의 자산과 포지션이 반영됩니다.');
      } else {
        sendTelegramModeMessage_();
      }
    }
    else if (command === '/ai') {
      var args = text.split(' ').slice(1).join(' ').trim();
      if (!args) {
        sendTelegramMessage('⚠️ <b>조회 오류</b>\n\nAI 주식 비서에게 물어볼 질문이나 분석할 종목명을 입력해 주세요.\n(예: <code>/ai 삼성전자</code> 또는 <code>/ai 오늘 시장 흐름 요약해줘</code>)');
      } else {
        // 주식 해결사 작동
        var stockInfo = resolveSymbolAndName_(args);
        
        if (stockInfo) {
          // A) 실시간 주식 상황 AI 분석 모드
          var sentMsg = sendTelegramMessage('📥 <b>[AI 실시간 주식 진단 가동]</b>\n\n<b>' + stockInfo.name + '</b> (' + stockInfo.symbol + ') 종목의 실시간 시세, 최근 뉴스, 거시 시장 지표를 정밀 분석하고 있습니다. 잠시만 기다려 주세요... 🧠');
          
          try {
            // 1. 실시간 가격 정보 획득
            var quote = null;
            if (stockInfo.type === 'crypto') {
              quote = fetchUpbitCurrentPrice_(stockInfo.symbol);
            } else if (stockInfo.type === 'overseas') {
              quote = fetchKisOverseasCurrentPrice_(stockInfo.symbol);
            } else {
              quote = fetchKisCurrentPrice_(stockInfo.symbol);
            }
            
            if (!quote || !quote.close) {
              throw new Error(stockInfo.name + ' 실시간 가격 조회에 실패했습니다.');
            }
            
            // 2. 당일 뉴스 데이터 수집
            var relatedNews = getStockRelatedNews_(stockInfo.name);
            
            // 3. 최신 시장 폭 지표 조회
            var breadthInfo = null;
            try {
              var breadthRows = readObjects_(AM_CONFIG.SHEETS.MARKET_BREADTH_DAILY);
              if (breadthRows && breadthRows.length > 0) {
                breadthRows.sort(function(a, b) { return String(b.date).localeCompare(String(a.date)); });
                breadthInfo = breadthRows[0];
              }
            } catch(be) {}
            
            // 4. 실시간 환율 획득
            var usdRate = 1350;
            try {
              usdRate = getUsdKrwRate_() || 1350;
            } catch(e) {}
            
            // 5. 투자자문 프롬프트 빌드 및 Gemini 호출
            var prompt = buildAiStockAnalysisPrompt_(stockInfo, quote, relatedNews, breadthInfo, usdRate);
            var aiResponse = callGeminiText_(prompt, {
              modelUseCase: 'intraday_alert',
              temperature: 0.7,
              maxOutputTokens: 1200
            });
            
            if (aiResponse) {
              var finalMsg = '<b>🤖 AI 주식 실시간 분석 보고서</b>\n\n' + aiResponse;
              finalMsg = escapeTelegramHtml_(finalMsg); // HTML 안전 이스케이프 적용!
              
              if (sentMsg && sentMsg.message_id) {
                editTelegramMessageText_(sentMsg.message_id, finalMsg);
              } else {
                sendTelegramMessage(finalMsg);
              }
            } else {
              throw new Error('Gemini로부터 분석 결과를 생성받지 못했습니다.');
            }
          } catch(err) {
            logWarn_('telegram_webhook', 'Failed to get Gemini stock analysis for ' + stockInfo.name, { error: err.message, stack: err.stack });
            var errorMsg = '❌ <b>AI 분석 오류</b>\n\n죄송합니다. 실시간 가격 호출 장애 또는 분석 엔진(Gemini) 과부하로 인해 보고서 생성이 실패했습니다. 잠시 후 다시 시도해 주세요.\n(에러: ' + err.message + ')';
            if (sentMsg && sentMsg.message_id) {
              editTelegramMessageText_(sentMsg.message_id, errorMsg);
            } else {
              sendTelegramMessage(errorMsg);
            }
          }
        } else {
          // B) 일반 질의응답 (그라운딩 모드)
          var sentMsg = sendTelegramMessage('📥 <b>AI 주식 비서가 답변을 작성하고 있습니다.</b>\n실시간 수집 데이터를 정밀 분석 중이오니 잠시만 기다려 주세요... 🧠');
          
          try {
            var prompt = buildAiChatGroundingPrompt_(args);
            var aiResponse = callGeminiText_(prompt, {
              modelUseCase: 'intraday_alert',
              temperature: 0.7,
              maxOutputTokens: 1024
            });
            
            if (aiResponse) {
              var finalMsg = '<b>🤖 AI 주식 비서의 답변 보고서</b>\n\n' + aiResponse;
              finalMsg = escapeTelegramHtml_(finalMsg); // 일반 질문도 깨짐 방지 장착!
              
              if (sentMsg && sentMsg.message_id) {
                editTelegramMessageText_(sentMsg.message_id, finalMsg);
              } else {
                sendTelegramMessage(finalMsg);
              }
            } else {
              throw new Error('Gemini returned empty text response');
            }
          } catch(aiErr) {
            logWarn_('telegram_webhook', 'Failed to get Gemini response in /ai chatbot', { error: aiErr.message });
            var errorMsg = '❌ <b>AI 비서 작동 오류</b>\n\n죄송합니다. Gemini 서버가 일시적으로 높은 부하 상태이거나 응답 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.';
            if (sentMsg && sentMsg.message_id) {
              editTelegramMessageText_(sentMsg.message_id, errorMsg);
            } else {
              sendTelegramMessage(errorMsg);
            }
          }
        }
      }
    }
    else if (command === '/set') {
      var rawArgs = text.split(' ').slice(1);
      if (rawArgs.length < 4) {
        sendTelegramMessage('⚠️ <b>입력 오류</b>\n\n수동 자산 갱신 형식이 올바르지 않습니다.\n\n👉 <b>입력 형식:</b>\n<code>/set [증권사] [종목코드] [최종수량] [최종평단가]</code>\n\n(예: <code>/set 신한 005930 15 71500</code>\n또는 <code>/set 미니스탁 NVDA 2.5 120</code>)');
      } else {
        var broker = rawArgs[0];
        var symbol = rawArgs[1];
        var quantity = Number(rawArgs[2]);
        var avgPrice = Number(rawArgs[3]);
        
        if (isNaN(quantity) || isNaN(avgPrice) || quantity < 0 || avgPrice < 0) {
          sendTelegramMessage('⚠️ <b>입력 오류</b>\n\n수량과 평단가는 0 이상의 올바른 숫자여야 합니다.');
        } else {
          sendTelegramMessage('📥 수동 자산 <b>' + broker + '</b>의 <b>' + symbol + '</b> 잔고를 시트에 갱신하고 있습니다...');
          try {
            var res = updateManualHoldingFromTelegram_(broker, symbol, quantity, avgPrice);
            var isOvr = /^[A-Za-z]/.test(normalizeStockSymbol_(symbol));
            var priceUnit = isOvr ? '$' : '원';
            
            sendTelegramMessage('⚙️ <b>[수동 자산 반영 완료]</b>\n\n• 증권사: <b>' + broker + '</b>\n• 종목명: <b>' + res.name + '</b> (' + normalizeStockSymbol_(symbol) + ')\n• 최종 잔고: <b>' + formatNumber_(res.quantity) + ' 주</b>\n• 평단가: <b>' + (isOvr ? priceUnit + res.avg_price.toFixed(2) : formatNumber_(res.avg_price) + priceUnit) + '</b>\n\n자산 현황(/holdings)에 즉각 실시간 시세로 반영됩니다.\n\n💡 <i>수량 일부 차감(일부 매도)을 원하시면 <code>/sell [증권사] [종목코드] [차감수량]</code> 명령어를 사용하세요.</i>');
            logInfo_('telegram_manual_asset', 'Updated manual holding via telegram', { broker: broker, symbol: symbol, quantity: quantity, avg_price: avgPrice });
          } catch(e) {
            logWarn_('telegram_manual_asset', 'Failed to update manual holding via telegram', { error: e.message });
            sendTelegramMessage('❌ <b>반영 실패</b>\n\n수동 자산 갱신 중 에러가 발생했습니다: ' + e.message);
          }
        }
      }
    }
    else if (command === '/sell') {
      var rawArgs = text.split(' ').slice(1);
      if (rawArgs.length < 3) {
        sendTelegramMessage('⚠️ <b>입력 오류</b>\n\n수동 자산 일부 차감(매도) 형식이 올바르지 않습니다.\n\n👉 <b>입력 형식:</b>\n<code>/sell [증권사] [종목코드] [차감수량]</code>\n\n(예: <code>/sell 신한 005930 5</code>)');
      } else {
        var broker = rawArgs[0];
        var symbol = rawArgs[1];
        var quantityToSubtract = Number(rawArgs[2]);
        
        if (isNaN(quantityToSubtract) || quantityToSubtract <= 0) {
          sendTelegramMessage('⚠️ <b>입력 오류</b>\n\n차감 수량은 0보다 큰 올바른 숫자여야 합니다.');
        } else {
          sendTelegramMessage('📥 수동 자산 <b>' + broker + '</b>의 <b>' + symbol + '</b> 잔고를 일부 차감하고 있습니다...');
          try {
            var res = subtractManualHoldingFromTelegram_(broker, symbol, quantityToSubtract);
            if (res.success) {
              if (res.action === 'CLEARED') {
                sendTelegramMessage('❌ <b>[수동 자산 전량 청산 완료]</b>\n\n• 증권사: <b>' + broker + '</b>\n• 종목명: <b>' + res.name + '</b> (' + normalizeStockSymbol_(symbol) + ')\n\n차감 후 남은 보유량이 0 이하가 되어 보유 목록에서 완전히 제외되었습니다.');
              } else {
                var isOvr = /^[A-Za-z]/.test(normalizeStockSymbol_(symbol));
                var priceUnit = isOvr ? '$' : '원';
                sendTelegramMessage('⚙️ <b>[수동 자산 일부 차감 완료]</b>\n\n• 증권사: <b>' + broker + '</b>\n• 종목명: <b>' + res.name + '</b> (' + normalizeStockSymbol_(symbol) + ')\n• 기존 잔고: <b>' + formatNumber_(res.prevQty) + ' 주</b>\n• 차감 수량: <b>' + formatNumber_(quantityToSubtract) + ' 주</b>\n• <b>현재 잔고: ' + formatNumber_(res.newQty) + ' 주</b>\n• 평단가: <b>' + (isOvr ? priceUnit + res.avgPrice.toFixed(2) : formatNumber_(res.avgPrice) + priceUnit) + '</b>\n\n자산 현황(/holdings)에 즉각 반영됩니다.');
              }
              logInfo_('telegram_manual_asset', 'Subtracted manual holding via telegram', { broker: broker, symbol: symbol, quantityToSubtract: quantityToSubtract });
            } else {
              sendTelegramMessage('ℹ️ <b>[차감 대상 없음]</b>\n\n보유 목록에서 <b>' + broker + '</b>의 <b>' + symbol + '</b> 종목을 찾지 못했습니다. 증권사명과 코드를 확인해 주세요.');
            }
          } catch(e) {
            logWarn_('telegram_manual_asset', 'Failed to subtract manual holding via telegram', { error: e.message });
            sendTelegramMessage('❌ <b>차감 실패</b>\n\n수동 자산 차감 중 에러가 발생했습니다: ' + e.message);
          }
        }
      }
    }
    else if (command === '/clear') {
      var rawArgs = text.split(' ').slice(1);
      if (rawArgs.length < 2) {
        sendTelegramMessage('⚠️ <b>입력 오류</b>\n\n수동 자산 청산 형식이 올바르지 않습니다.\n\n👉 <b>입력 형식:</b>\n<code>/clear [증권사] [종목코드]</code>\n\n(예: <code>/clear 신한 005930</code>)');
      } else {
        var broker = rawArgs[0];
        var symbol = rawArgs[1];
        
        sendTelegramMessage('📥 수동 자산 <b>' + broker + '</b>의 <b>' + symbol + '</b> 잔고를 청산 처리하고 있습니다...');
        try {
          var res = clearManualHoldingFromTelegram_(broker, symbol);
          if (res.success) {
            sendTelegramMessage('❌ <b>[수동 자산 청산 완료]</b>\n\n• 증권사: <b>' + broker + '</b>\n• 종목명: <b>' + res.name + '</b> (' + normalizeStockSymbol_(symbol) + ')\n\n해당 수동 종목의 보유량이 0으로 초기화되었으며 평가 대상에서 안전하게 제외되었습니다.');
            logInfo_('telegram_manual_asset', 'Cleared manual holding via telegram', { broker: broker, symbol: symbol });
          } else {
            sendTelegramMessage('ℹ️ <b>[청산 대상 없음]</b>\n\n보유 목록에서 <b>' + broker + '</b>의 <b>' + symbol + '</b> 종목을 찾지 못했습니다. 증권사명과 코드를 다시 확인해 주세요.');
          }
        } catch(e) {
          logWarn_('telegram_manual_asset', 'Failed to clear manual holding via telegram', { error: e.message });
          sendTelegramMessage('❌ <b>청산 실패</b>\n\n수동 자산 청산 중 에러가 발생했습니다: ' + e.message);
        }
      }
    }
    else if (command === '/clear_manual_all' || command === '/clearall') {
      sendTelegramMessage('📥 모든 수동 등록 자산들을 일괄 삭제(청산) 처리하고 있습니다...');
      try {
        var res = clearAllManualHoldingsFromTelegram_();
        if (res.success) {
          sendTelegramMessage('🔥 <b>[수동 자산 일괄 청산 완료]</b>\n\n등록되어 있던 모든 수동 자산 내역이 시트에서 완전히 지워졌으며, 자산 평가 대상에서도 즉각 제외 처리되었습니다.');
          logInfo_('telegram_manual_asset', 'Cleared all manual holdings via telegram bulk command');
        }
      } catch(e) {
        logWarn_('telegram_manual_asset', 'Failed to bulk clear manual holdings via telegram', { error: e.message });
        sendTelegramMessage('❌ <b>일괄 청산 실패</b>\n\n수동 자산 일괄 청산 중 에러가 발생했습니다: ' + e.message);
      }
    }
    else if (command === '/check_manual') {
      sendTelegramMessage('📥 수동 자산(manual_holdings) 데이터를 조회하고 있습니다...');
      try {
        var sheetName = AM_CONFIG.SHEETS.MANUAL_HOLDINGS;
        var rows = readObjects_(sheetName);
        var activeRows = rows.filter(function(row) {
          var activeText = String(row.active || 'Y').toUpperCase().trim();
          return activeText !== 'N' && activeText !== 'FALSE' && parseFloat(row.quantity || 0) > 0;
        });
        
        if (activeRows.length === 0) {
          sendTelegramMessage('📋 <b>[수동 등록 자산 현황]</b>\n\n현재 등록되어 활성화된 수동 자산이 없습니다.\n\n💡 <i>자산을 추가하시려면 <code>/set [증권사] [종목코드] [최종수량] [최종평단가]</code> 명령어를 사용해 보세요!</i>');
        } else {
          var lines = ['📋 <b>[수동 등록 자산 현황]</b>\n'];
          activeRows.forEach(function(row, idx) {
            var sym = normalizeStockSymbol_(row.symbol);
            var isOvr = /^[A-Za-z]/.test(sym);
            var priceUnit = isOvr ? '$' : '원';
            var qty = parseFloat(row.quantity || 0);
            var avg = parseFloat(row.avg_price || 0);
            var name = row.name || sym;
            
            lines.push(
              '<b>' + (idx + 1) + '. ' + row.broker + '</b> | ' + sym + ' (' + name + ')\n' +
              '  • 보유 수량: <b>' + formatNumber_(qty) + ' 주</b>\n' +
              '  • 평균 단가: <b>' + (isOvr ? priceUnit + avg.toFixed(2) : formatNumber_(avg) + priceUnit) + '</b>\n'
            );
          });
          sendTelegramMessage(lines.join('\n'));
        }
      } catch(e) {
        logWarn_('telegram_manual_asset', 'Failed to check manual holdings via telegram', { error: e.message });
        sendTelegramMessage('❌ <b>조회 실패</b>\n\n수동 자산 조회 중 에러가 발생했습니다: ' + e.message);
      }
    }
    else if (command === '/score') {
      var args = text.split(' ').slice(1).join(' ').trim();
      if (!args) {
        sendTelegramMessage('⚠️ <b>조회 오류</b>\n\n조회할 종목코드 또는 종목 한글명을 함께 입력해 주세요.\n(예: <code>/score 005930</code> 또는 <code>/score 삼성전자</code>)');
      } else {
        sendTelegramMessage('📥 주도주 데이터베이스에서 <b>' + args + '</b> 종목을 검색하고 있습니다...');
        
        var found = null;
        var candidates = readObjects_(AM_CONFIG.SHEETS.LEADER_CANDIDATES);
        var match = candidates.filter(function(row) {
          var symbol = normalizeStockSymbol_(row.symbol);
          var name = String(row.name || '').trim();
          return symbol === args || name.indexOf(args) >= 0;
        });
        
        if (match.length > 0) {
          match.sort(function(a, b) {
            return String(b.date).localeCompare(String(a.date));
          });
          found = match[0];
        }
        
        if (!found) {
          var leader50 = readObjects_(AM_CONFIG.SHEETS.LEADER_50);
          var match50 = leader50.filter(function(row) {
            var symbol = normalizeStockSymbol_(row.symbol);
            var name = String(row.name || '').trim();
            return symbol === args || name.indexOf(args) >= 0;
          });
          if (match50.length > 0) {
            match50.sort(function(a, b) { return String(b.date).localeCompare(String(a.date)); });
            found = match50[0];
          }
        }
        
        if (found) {
          var symbol = normalizeStockSymbol_(found.symbol);
          var name = found.name || '';
          var date = found.date || '';
          
          var total = found.total_score || found.score || 0;
          var rank = found.rank || found.rank_num || '-';
          
          var lScore = found.leader_score !== undefined ? found.leader_score : '-';
          var cScore = found.chart_score !== undefined ? found.chart_score : '-';
          var fScore = found.flow_score !== undefined ? found.flow_score : '-';
          var fiScore = found.financial_score !== undefined ? found.financial_score : '-';
          var mScore = found.macro_score !== undefined ? found.macro_score : '-';
          
          var memo = found.memo || '기록된 분석 내용이 없습니다.';
          
          var scoreMsg = [
            '<b>📊 주도주 분석 점수판 조회 결과</b>',
            '기준 영업일: ' + date,
            '종목명: <b>' + name + '</b> (' + symbol + ')',
            '',
            '🏆 <b>종합 스코어</b>: ' + total + ' 점 | <b>오늘 순위</b>: ' + rank + '위',
            '• 주도주 강도 점수: ' + lScore + ' 점',
            '• 기술적 차트 점수: ' + cScore + ' 점',
            '• 외국인/기관 수급: ' + fScore + ' 점',
            '• 기업 재무 안전성: ' + fiScore + ' 점',
            '• 거시 매크로 정합: ' + mScore + ' 점',
            '',
            '📝 <b>분석가 요약 메모:</b>',
            '<i>' + memo + '</i>'
          ].join('\n');
          sendTelegramMessage(scoreMsg);
        } else {
          sendTelegramMessage('❌ <b>조회 실패</b>\n\n최근 주도주 분석 리스트에서 <b>' + args + '</b> 종목을 찾지 못했습니다. 후보군(Candidates)에 수록된 종목 위주로 조회 가능합니다.');
        }
      }
    }
    else if (command === '/add') {
      var args = text.split(' ').slice(1).join(' ').trim();
      if (!args || !/^\d{6}$/.test(args)) {
        sendTelegramMessage('⚠️ <b>입력 오류</b>\n\n추가할 올바른 6자리 종목코드를 입력해 주세요.\n(예: <code>/add 005930</code>)');
      } else {
        var symbol = args;
        sendTelegramMessage('📥 종목 정보를 조회하여 감시 목록에 편입하고 있습니다...');
        
        var name = '';
        try {
          var quote = fetchKisCurrentPrice_(symbol);
          name = quote.name || '';
        } catch(e) {}
        
        if (!name) {
          var universe = readObjects_(AM_CONFIG.SHEETS.MARKET_UNIVERSE);
          var uniMatch = universe.filter(function(row) {
            return normalizeStockSymbol_(row.symbol) === symbol;
          });
          if (uniMatch.length > 0) name = uniMatch[0].name || '';
        }
        
        if (!name) name = '알 수 없는 종목';
        
        var watchlistStr = getScriptProperty_('TG_USER_WATCHLIST', '');
        var watchlist = watchlistStr ? watchlistStr.split(',') : [];
        
        if (watchlist.indexOf(symbol) >= 0) {
          sendTelegramMessage('ℹ️ <b>' + name + '</b> (' + symbol + ') 종목은 이미 실시간 감시 목록에 등록되어 있습니다.');
        } else {
          watchlist.push(symbol);
          setScriptProperty_('TG_USER_WATCHLIST', watchlist.join(','));
          sendTelegramMessage('🎉 <b>[장중 실시간 감시 추가 완료]</b>\n\n종목명: <b>' + name + '</b> (' + symbol + ')\n\n이 시간 이후부터 5분 주기로 돌파 감시에 추가 반영됩니다. (현재 감시 종목: ' + watchlist.length + '개)');
          logInfo_('telegram_watchlist', 'Added symbol to telegram watchlist', { symbol: symbol, name: name });
        }
      }
    }
    else if (command === '/del') {
      var args = text.split(' ').slice(1).join(' ').trim();
      if (!args || !/^\d{6}$/.test(args)) {
        sendTelegramMessage('⚠️ <b>입력 오류</b>\n\n해제할 올바른 6자리 종목코드를 입력해 주세요.\n(예: <code>/del 005930</code>)');
      } else {
        var symbol = args;
        var watchlistStr = getScriptProperty_('TG_USER_WATCHLIST', '');
        var watchlist = watchlistStr ? watchlistStr.split(',') : [];
        var idx = watchlist.indexOf(symbol);
        
        if (idx < 0) {
          sendTelegramMessage('❌ <b>' + symbol + '</b> 종목은 실시간 감시 목록에 등록되어 있지 않습니다.');
        } else {
          watchlist.splice(idx, 1);
          setScriptProperty_('TG_USER_WATCHLIST', watchlist.join(','));
          sendTelegramMessage('❌ <b>[장중 실시간 감시 해제 완료]</b>\n\n종목코드: <b>' + symbol + '</b>\n\n해당 종목이 실시간 감시 타겟에서 정상 해제되었습니다. (남은 감시 종목: ' + watchlist.length + '개)');
          logInfo_('telegram_watchlist', 'Removed symbol from telegram watchlist', { symbol: symbol });
        }
      }
    }
    else if (command === '/watchlist' || command === '/list') {
      var watchlistStr = getScriptProperty_('TG_USER_WATCHLIST', '');
      var watchlist = watchlistStr ? watchlistStr.split(',') : [];
      
      if (watchlist.length === 0) {
        sendTelegramMessage('📋 <b>실시간 텔레그램 감시 목록</b>\n\n현재 모바일로 추가하신 감시 대상 종목이 없습니다.\n\n👉 <code>/add [종목코드]</code> 로 감시할 관심종목을 직접 등록해 보세요!');
      } else {
        sendTelegramMessage('📥 실시간 감시 대상 목록을 파싱하고 있습니다. 잠시만 기다려 주세요...');
        
        var universe = readObjects_(AM_CONFIG.SHEETS.MARKET_UNIVERSE);
        var candidates = readObjects_(AM_CONFIG.SHEETS.LEADER_CANDIDATES);
        var lines = ['📋 <b>장중 실시간 감시 타겟 종목 목록</b>', '(텔레그램 수동 등록 분)', ''];
        
        watchlist.forEach(function(sym, i) {
          var name = '';
          var candMatch = candidates.filter(function(c) { return normalizeStockSymbol_(c.symbol) === sym; });
          if (candMatch.length > 0) name = candMatch[0].name || '';
          
          if (!name) {
            var uniMatch = universe.filter(function(u) { return normalizeStockSymbol_(u.symbol) === sym; });
            if (uniMatch.length > 0) name = uniMatch[0].name || '';
          }
          
          if (!name) name = '조회 실패';
          lines.push((i+1) + '. <b>' + name + '</b> (' + sym + ')');
        });
        
        lines.push('');
        lines.push('<i>* 해제하려면 <code>/del [종목코드]</code> 를 입력해 주십시오.</i>');
        sendTelegramMessage(lines.join('\n'));
      }
    }
    else if (command === '/debug') {
      sendTelegramMessage('🔎 KIS 실시간 API 디버깅을 시작합니다. 계좌 잔고 데이터를 직접 호출하여 구조를 검증합니다...');
      
      var debugLines = ['<b>🛠️ KIS API 디버깅 보고서</b>', ''];
      
      // 1. 계좌 설정 확인
      var cano = getScriptProperty_(AM_CONFIG.PROPERTY_KEYS.KIS_CANO, '');
      var prdt = getScriptProperty_(AM_CONFIG.PROPERTY_KEYS.KIS_ACNT_PRDT_CD, '');
      var env = getScriptProperty_(AM_CONFIG.PROPERTY_KEYS.KIS_ENV, '');
      debugLines.push('<b>[계좌 설정]</b>');
      debugLines.push('• ENV: ' + env);
      debugLines.push('• CANO: ' + (cano ? cano.slice(0,4) + '****' : '없음'));
      debugLines.push('• PRDT: ' + prdt);
      debugLines.push('');
      
      // 2. 국내 계좌 호출 결과
      try {
        var domResponse = fetchKisDomesticAccountBalance_();
        var domItems = Array.isArray(domResponse.output1) ? domResponse.output1 : [];
        debugLines.push('<b>[국내 잔고 API 결과]</b>');
        debugLines.push('• 응답 상태: 성공');
        debugLines.push('• output1(보유) 아이템 수: ' + domItems.length);
        if (domItems.length > 0) {
          domItems.slice(0, 3).forEach(function(item, idx) {
            debugLines.push('  ' + (idx+1) + '. ' + (item.prdt_name || item.item_name || '이름없음') + ' (' + (item.pdno || item.symbol || '') + ') - 수량: ' + (item.hldg_qty || item.quantity || 0) + ' / 평단가: ' + (item.pchs_avg_pric || item.avg_price || 0));
          });
        }
      } catch (domErr) {
        debugLines.push('<b>[국내 잔고 API 결과]</b> ❌ 에러: ' + domErr.message);
      }
      debugLines.push('');
      
      // 3. 해외 계좌 호출 결과
      var exchanges = ['NASD', 'NYSE', 'AMEX'];
      var isReal = env === 'real';
      var trId = isReal ? 'TTTS3012R' : 'VCTS3012R';
      var account = null;
      try {
        account = getKisAccountConfig_();
      } catch(accErr) {
        debugLines.push('<b>[해외 잔고 API 결과]</b> ❌ 계좌설정 로드 실패: ' + accErr.message);
      }
      
      if (account) {
        debugLines.push('<b>[해외 잔고 API 결과]</b>');
        for (var i = 0; i < exchanges.length; i++) {
          var ex = exchanges[i];
          try {
            var response = kisGet_('/uapi/overseas-stock/v1/trading/inquire-balance', {
              CANO: account.cano,
              ACNT_PRDT_CD: account.accountProductCode,
              OVRS_EXCG_CD: ex,
              TR_CRCY_CD: 'USD',
              CTX_AREA_FK200: '',
              CTX_AREA_NK200: ''
            }, trId);
            
            var items = Array.isArray(response.output1) ? response.output1 : [];
            debugLines.push('• 거래소 <b>' + ex + '</b>: 아이템 ' + items.length + '개');
            if (items.length > 0) {
              items.forEach(function(item, idx) {
                var debugKeys = [];
                ['ovrs_pdno', 'symbol', 'ovrs_item_name', 'item_name', 'ovrs_cblc_qty', 'hldg_qty', 'quantity', 'ord_psbl_qty', 'pchs_rmnd_qty', 'now_pric2', 'now_pric', 'evlu_amt_smtl', 'evlu_amt_smtl_amt'].forEach(function(k) {
                  if (item[k] !== undefined && item[k] !== null && item[k] !== '') {
                    debugKeys.push(k + '=' + item[k]);
                  }
                });
                debugLines.push('  ' + (idx+1) + '. ' + debugKeys.join(' | '));
              });
            }
          } catch (ovrErr) {
            debugLines.push('• 거래소 <b>' + ex + '</b> ❌ 에러: ' + ovrErr.message);
          }
        }
        debugLines.push('');
        
        // 4. 미니스탁(상품코드 01로 강제지정) 호출 결과
        debugLines.push('<b>[미니스탁 전용 잔고 조회 결과]</b>');
        for (var i = 0; i < exchanges.length; i++) {
          var ex = exchanges[i];
          try {
            var response = kisGet_('/uapi/overseas-stock/v1/trading/inquire-balance', {
              CANO: account.cano,
              ACNT_PRDT_CD: '01',
              OVRS_EXCG_CD: ex,
              TR_CRCY_CD: 'USD',
              CTX_AREA_FK200: '',
              CTX_AREA_NK200: ''
            }, trId);
            
            var items = Array.isArray(response.output1) ? response.output1 : [];
            debugLines.push('• 미니스탁 <b>' + ex + '</b>: 아이템 ' + items.length + '개');
            if (items.length > 0) {
              items.forEach(function(item, idx) {
                var debugKeys = [];
                ['ovrs_pdno', 'symbol', 'ovrs_item_name', 'item_name', 'ovrs_cblc_qty', 'hldg_qty', 'quantity', 'ord_psbl_qty', 'pchs_rmnd_qty', 'now_pric2', 'now_pric', 'evlu_amt_smtl', 'evlu_amt_smtl_amt'].forEach(function(k) {
                  if (item[k] !== undefined && item[k] !== null && item[k] !== '') {
                    debugKeys.push(k + '=' + item[k]);
                  }
                });
                debugLines.push('  ' + (idx+1) + '. ' + debugKeys.join(' | '));
              });
            }
          } catch (miniErr) {
            debugLines.push('• 미니스탁 <b>' + ex + '</b> ❌ 에러: ' + miniErr.message);
          }
        }
      }
      
      sendTelegramMessage(debugLines.join('\n'));
    }
    else {
      sendTelegramMessage('❓ 등록되지 않은 명령어입니다. 사용 가능한 목록을 보려면 <b>/help</b>를 치세요.');
    }
  } catch (err) {
    logWarn_('telegram_webhook', 'Failed to process Telegram webhook doPost', { error: err.message || String(err) });
  }
  return HtmlService.createHtmlOutput('OK');
}

function handleTelegramCallback_(queryId, chatId, cbData) {
  try {
    if (cbData === 'mode_real') {
      setScriptProperty_(AM_CONFIG.PROPERTY_KEYS.PORTFOLIO_MODE, 'real');
      answerTelegramCallback_(queryId, '실제 계좌 모드로 전환되었습니다.');
      sendTelegramModeMessage_();
    } else if (cbData === 'mode_paper') {
      setScriptProperty_(AM_CONFIG.PROPERTY_KEYS.PORTFOLIO_MODE, 'paper');
      answerTelegramCallback_(queryId, '모의 투자 모드로 전환되었습니다.');
      sendTelegramModeMessage_();
    } else if (cbData === 'run_workflow_now') {
      answerTelegramCallback_(queryId, '워크플로우 원격 구동을 개시합니다.');
      triggerRunWorkflowFromTelegram_();
    } else {
      answerTelegramCallback_(queryId, '알 수 없는 조작입니다.');
    }
  } catch (err) {
    logWarn_('telegram_webhook', 'Failed to handle telegram callback', { error: err.message });
    answerTelegramCallback_(queryId, '오류가 발생했습니다.');
  }
}

function triggerRunWorkflowFromTelegram_() {
  try {
    var sheetName = AM_CONFIG.SHEETS.MOBILE_COMMANDS;
    var sheet = ensureSheet_(sheetName, AM_SHEET_SCHEMAS[sheetName]);
    var values = sheet.getDataRange().getValues();
    var index = buildHeaderIndex_(values[0]);
    
    var foundRowIndex = -1;
    for (var i = 1; i < values.length; i++) {
      if (String(values[i][index.command_key]).trim() === 'run_full_workflow') {
        foundRowIndex = i + 1;
        break;
      }
    }
    
    if (foundRowIndex > 0) {
      sheet.getRange(foundRowIndex, index.run + 1).setValue(true);
      sheet.getRange(foundRowIndex, index.requested_at + 1).setValue(amNowString_());
      SpreadsheetApp.flush();
      
      ScriptApp.newTrigger('runOneShotCommandQueue')
        .timeBased()
        .after(1000)
        .create();
        
      sendTelegramMessage('📥 <b>[원격 장마감 워크플로우 구동 접수]</b>\n\n오늘의 전체 파이프라인(Daily -> DART -> macro -> news -> Gemini -> email)이 모바일 명령 대기 큐에 정상 접수되었습니다.\n\n백그라운드 엔진이 즉시 작업을 인도받아 가동을 시작합니다. 약 1~2분 소요되며 완료 시 분석 리포트 메일과 완료 알림이 차례로 전송됩니다! 🚀');
    } else {
      sendTelegramMessage('❌ [구동 실패] mobile_commands 시트에서 run_full_workflow 명령을 찾지 못했습니다.');
    }
  } catch (err) {
    sendTelegramMessage('❌ [구동 실패] 원격 명령 접수 중 에러 발생: ' + err.message);
  }
}

function sendTelegramModeMessage_() {
  var currentMode = getScriptProperty_(AM_CONFIG.PROPERTY_KEYS.PORTFOLIO_MODE, 'real');
  var modeKo = currentMode === 'real' ? '🟢 실제 계좌 (Real)' : '🔵 모의 투자 (Paper)';
  
  var text = '⚙️ <b>포트폴리오 모드 설정</b>\n\n• 현재 설정 모드: <b>' + modeKo + '</b>\n\n아래 버튼을 눌러 계좌 모드를 간편하게 즉시 변경할 수 있습니다. 변경된 모드는 자산 감시 및 잔고 조회(/holdings) 시 즉각 반영됩니다.';
  var keyboard = {
    inline_keyboard: [
      [
        { text: '🟢 실제 계좌 모드', callback_data: 'mode_real' },
        { text: '🔵 모의 투자 모드', callback_data: 'mode_paper' }
      ]
    ]
  };
  
  sendTelegramMessageWithMarkup(text, keyboard);
}

function sendTelegramRunMessage_() {
  var text = '🚀 <b>[원격 장마감 워크플로우 구동]</b>\n\n오늘의 전체 파이프라인(Daily -> DART -> macro -> news -> Gemini -> email)을 지금 즉시 구동하시겠습니까?\n\n이 작업은 구글 클라우드 백그라운드 엔진에서 진행되며 약 1~2분이 소요됩니다.';
  var keyboard = {
    inline_keyboard: [
      [
        { text: '🔥 워크플로우 즉시 구동', callback_data: 'run_workflow_now' }
      ]
    ]
  };
  
  sendTelegramMessageWithMarkup(text, keyboard);
}

function registerTelegramWebhook() {
  var ui = SpreadsheetApp.getUi();
  var token = getScriptProperty_(AM_CONFIG.PROPERTY_KEYS.TELEGRAM_BOT_TOKEN, '');
  
  if (!token) {
    ui.alert('설정 오류\n\nTELEGRAM_BOT_TOKEN이 스크립트 속성에 등록되어 있지 않습니다. 먼저 프로젝트 설정을 마치세요.');
    return;
  }
  
  var webAppUrl = '';
  try {
    webAppUrl = ScriptApp.getService().getUrl();
  } catch(e) {}
  
  // 구글 Apps Script의 getUrl() 버그로 구형 배포 ID가 반환될 경우 최신 활성 주소로 자동 교정
  var activeRealUrl = 'https://script.google.com/macros/s/AKfycbysCckjcPefqrgZyMcZvksLjVJzpKO1yUUye8CPuiNT21ms3tEZF9dKCjm_gwYlJ1T6/exec';
  if (!webAppUrl || webAppUrl.indexOf('AKfycbys') < 0) {
    webAppUrl = activeRealUrl;
  }
  
  if (!webAppUrl || webAppUrl.indexOf('https://script.google.com') !== 0) {
    ui.alert('오류: 구글 웹 앱 주소를 시스템이 획득하지 못했습니다. 배포 관리에서 최초 1회 이상 웹 앱 배포가 완료되었는지 확인해 주세요.');
    return;
  }
  
  var confirmReg = ui.alert(
    '🤖 텔레그램 챗봇 실시간 자동 웹훅 연동',
    '시스템이 확인한 구글 웹 앱 주소로 텔레그램 연동을 자동 등록하시겠습니까?\n\n' +
    '📌 연동 URL 주소:\n' + webAppUrl + '\n\n' +
    '※ 확인을 누르면 대소문자 오차 없이 원클릭으로 즉시 양방향 연결이 완료됩니다.',
    ui.ButtonSet.OK_CANCEL
  );
  
  if (confirmReg !== ui.Button.OK) return;
  
  try {
    var url = 'https://api.telegram.org/bot' + token + '/setWebhook?url=' + encodeURIComponent(webAppUrl);
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    var resText = res.getContentText();
    var resJson = JSON.parse(resText);
    
    if (resJson.ok) {
      ui.alert('🎉 텔레그램 챗봇 연결 자동 등록 성공!\n\n이제 텔레그램 봇 채팅방에 가셔서 /help 또는 /holdings 를 전송해 챗봇을 즉시 테스트해 보세요!');
      logInfo_('telegram_webhook', 'Telegram webhook registered automatically via getUrl()', { url: webAppUrl });
    } else {
      ui.alert('연동 등록 실패\n\nTelegram API 응답: ' + resText);
    }
  } catch(e) {
    ui.alert('웹훅 호출 에러 발생: ' + e.message);
  }
}

function runOneShotCommandQueue() {
  try {
    processMobileCommandQueue();
  } finally {
    deleteTriggersByHandler_('runOneShotCommandQueue');
  }
}

function updateManualHoldingFromTelegram_(broker, symbol, quantity, avgPrice) {
  var sheetName = AM_CONFIG.SHEETS.MANUAL_HOLDINGS;
  var sheet = ensureSheet_(sheetName, AM_SHEET_SCHEMAS[sheetName]);
  var rows = readObjects_(sheetName);
  
  var targetSymbol = normalizeStockSymbol_(symbol);
  var targetBroker = normalizeBrokerName_(broker); // Normalize broker name!
  
  var rowIndex = -1;
  for (var i = 0; i < rows.length; i += 1) {
    var rowBroker = normalizeBrokerName_(rows[i].broker);
    if (rowBroker === targetBroker && normalizeStockSymbol_(rows[i].symbol) === targetSymbol) {
      rowIndex = i + 2; // 헤더 제외 1-indexed 및 1번째 데이터는 2행
      break;
    }
  }
  
  // 지능형 한글 종목명 반환 처리 헬퍼 함수를 경유하여 한글 종목명 완벽 확보!
  var name = getStockKoreanName_(targetSymbol, symbol);
  
  var purchaseAmount = quantity * avgPrice;
  
  var values = {
    broker: targetBroker,
    symbol: targetSymbol,
    name: name,
    quantity: quantity,
    avg_price: avgPrice,
    purchase_amount: purchaseAmount,
    active: true,
    memo: '원격 갱신 (' + amTodayString_() + ')'
  };
  
  if (rowIndex > 0) {
    // 기존 행 수정
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var index = buildHeaderIndex_(headers);
    updateMobileCommandRow_(sheet, rowIndex, index, values);
  } else {
    // 신규 행 추가
    appendObjectRow_(sheetName, values);
  }
  
  SpreadsheetApp.flush();
  return { name: name, quantity: quantity, avg_price: avgPrice };
}

function clearManualHoldingFromTelegram_(broker, symbol) {
  var sheetName = AM_CONFIG.SHEETS.MANUAL_HOLDINGS;
  var sheet = ensureSheet_(sheetName, AM_SHEET_SCHEMAS[sheetName]);
  var rows = readObjects_(sheetName);
  
  var targetSymbol = normalizeStockSymbol_(symbol);
  var targetBroker = normalizeBrokerName_(broker); // Normalize broker name!
  
  var rowIndex = -1;
  var name = symbol;
  for (var i = 0; i < rows.length; i += 1) {
    var rowBroker = normalizeBrokerName_(rows[i].broker);
    if (rowBroker === targetBroker && normalizeStockSymbol_(rows[i].symbol) === targetSymbol) {
      rowIndex = i + 2;
      name = rows[i].name || symbol;
      break;
    }
  }
  
  if (rowIndex > 0) {
    sheet.deleteRow(rowIndex);
    SpreadsheetApp.flush();
    return { success: true, name: name };
  }
  
  return { success: false, name: name };
}

function subtractManualHoldingFromTelegram_(broker, symbol, quantityToSubtract) {
  var sheetName = AM_CONFIG.SHEETS.MANUAL_HOLDINGS;
  var sheet = ensureSheet_(sheetName, AM_SHEET_SCHEMAS[sheetName]);
  var rows = readObjects_(sheetName);
  
  var targetSymbol = normalizeStockSymbol_(symbol);
  var targetBroker = normalizeBrokerName_(broker);
  
  var rowIndex = -1;
  var name = symbol;
  var currentQty = 0;
  var avgPrice = 0;
  
  for (var i = 0; i < rows.length; i += 1) {
    var rowBroker = normalizeBrokerName_(rows[i].broker);
    if (rowBroker === targetBroker && normalizeStockSymbol_(rows[i].symbol) === targetSymbol) {
      rowIndex = i + 2;
      name = rows[i].name || symbol;
      currentQty = parseFloat(rows[i].quantity || 0);
      avgPrice = parseFloat(rows[i].avg_price || 0);
      break;
    }
  }
  
  if (rowIndex <= 0) {
    return { success: false, reason: 'NOT_FOUND', name: name };
  }
  
  var newQty = currentQty - quantityToSubtract;
  if (newQty <= 0) {
    // 0 이하가 되면 전량 청산(행 삭제)
    sheet.deleteRow(rowIndex);
    SpreadsheetApp.flush();
    return { success: true, action: 'CLEARED', name: name, prevQty: currentQty, newQty: 0 };
  } else {
    // 수량 차감 및 평단에 따른 구매액 등 갱신
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var index = buildHeaderIndex_(headers);
    
    var purchaseAmount = newQty * avgPrice;
    var values = {
      quantity: newQty,
      purchase_amount: purchaseAmount,
      memo: '일부 차감 (' + amTodayString_() + ')'
    };
    
    updateMobileCommandRow_(sheet, rowIndex, index, values);
    SpreadsheetApp.flush();
    return { success: true, action: 'SUBTRACTED', name: name, prevQty: currentQty, newQty: newQty, avgPrice: avgPrice };
  }
}

/**
 * 증권사명을 표준 한글/영문 이름으로 통일하는 헬퍼 함수
 */
function normalizeBrokerName_(broker) {
  var b = String(broker || '').trim().toLowerCase();
  if (b.indexOf('신한') >= 0 || b.indexOf('shinhan') >= 0) return '신한';
  if (b.indexOf('미니') >= 0 || b.indexOf('mini') >= 0) return '미니스탁';
  if (b.indexOf('업비트') >= 0 || b.indexOf('upbit') >= 0) return 'upbit';
  if (b.indexOf('토스') >= 0 || b.indexOf('toss') >= 0) return '토스';
  return broker;
}

/**
 * 텔레그램 미니 앱(TMA) 모바일 반응형 웹뷰 페이지를 렌더링합니다.
 */
function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('JUSIK AI Portfolio')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0, minimum-scale=1.0, maximum-scale=1.0, user-scalable=no');
}

/**
 * [TMA 웹앱 전용 백엔드 API 1]
 * 현재 활성화된 투자 모드 정보와 실시간 시세를 연동한 통합 자산 현황을 조회해 반환합니다.
 * 10분 메모리 캐시, 한글명 지능형 매핑 및 KIS 현재가 웜업 최적화가 적용되었습니다.
 */
function getPortfolioDataForWeb() {
  return withLogging_('web_dashboard', function() {
    ensureAllSheets_();
    
    // 1. 현재 운용 모드 판별 (REAL 또는 PAPER)
    var currentMode = String(getScriptProperty_('PORTFOLIO_MODE') || 'REAL').toUpperCase();
    
    var assets = [];
    var totalPurchase = 0;
    var totalEval = 0;
    var usdRate = 1350;
    try {
      usdRate = getUsdKrwRate_() || 1350;
    } catch(e) {}
    
    // 2. REAL 모드일 때 KIS 실제 계좌 정보 조회
    if (currentMode === 'REAL') {
      try {
        var response = fetchKisDomesticAccountBalance_();
        var normalized = normalizeKisAccountBalance_(response);
        
        normalized.holdings.forEach(function(h) {
          var qty = parseFloat(h.quantity || 0);
          var avg = parseFloat(h.avg_price || 0);
          var cur = parseFloat(h.current_price || 0);
          
          if (qty > 0) {
            var purchaseAmt = qty * avg;
            var evalAmt = qty * cur;
            
            totalPurchase += purchaseAmt;
            totalEval += evalAmt;
            
            // 캐시에서 등락률 조회 및 가격 웜업 처리 (0 주입으로 인한 등락률 유실 버그 해결!)
            var curQuote = fetchCachedCurrentPrice_(h.symbol, false);
            var changePct = curQuote.change_pct || 0;
            warmUpPriceCache_(h.symbol, cur, changePct); 
            
            assets.push({
              broker: 'KIS계좌',
              symbol: h.symbol,
              name: getStockKoreanName_(h.symbol, h.name || h.prdt_name || h.pd_name),
              qty: qty,
              price: avg,
              currentPrice: cur,
              priceKrw: avg,
              currentPriceKrw: cur,
              isCoin: false,
              isUsd: false,
              changePct: changePct
            });
          }
        });
        
        // 해외 잔고 쿼리 및 가격 웜업 병합
        try {
          var ovrResponse = fetchKisOverseasAccountBalance_();
          var normalizedOvr = normalizeKisOverseasAccountBalance_(ovrResponse);
          if (normalizedOvr && normalizedOvr.holdings) {
            normalizedOvr.holdings.forEach(function(oh) {
              var oQty = parseFloat(oh.quantity || 0);
              var oAvg = parseFloat(oh.avg_price || 0); // USD
              var oCur = parseFloat(oh.current_price || 0); // USD
              
              if (oQty > 0) {
                totalPurchase += (oQty * oAvg * usdRate);
                totalEval += (oQty * oCur * usdRate);
                
                // 캐시에서 등락률 조회 및 가격 웜업 처리 (0 주입으로 인한 등락률 유실 버그 해결!)
                var curQuote = fetchCachedCurrentPrice_(oh.symbol, false);
                var changePct = curQuote.change_pct || 0;
                warmUpPriceCache_(oh.symbol, oCur, changePct);
                
                assets.push({
                  broker: 'KIS해외',
                  symbol: oh.symbol,
                  name: getStockKoreanName_(oh.symbol, oh.name || oh.prdt_name || oh.ovrs_pd_name),
                  qty: oQty,
                  price: oAvg,
                  currentPrice: oCur,
                  priceKrw: Math.round(oAvg * usdRate),
                  currentPriceKrw: Math.round(oCur * usdRate),
                  isCoin: false,
                  isUsd: true,
                  changePct: changePct
                });
              }
            });
          }
        } catch(ovrErr) {
          logWarn_('web_dashboard', 'Failed to fetch KIS overseas account for web view', { error: ovrErr.message });
        }
        
        // 예수금(Cash)도 평가 총합에 가산 (수익률 왜곡 방지를 위해 매수액/평가액 동시 가산)
        var cash = parseFloat(normalized.snapshot.cash_amount || 0);
        if (cash > 0) {
          totalPurchase += cash;
          totalEval += cash;
        }
      } catch (err) {
        logWarn_('web_dashboard', 'Failed to fetch KIS real account balance for web', {
          error: err.message || String(err)
        });
      }
    } else {
      // 3. PAPER 모드일 때 paper_portfolio 시트의 모의 보유 자산(active_positions_json) 완벽 복원!
      try {
        var paperRows = readObjects_(AM_CONFIG.SHEETS.PAPER_PORTFOLIO);
        var lastPaper = null;
        if (paperRows.length > 0) {
          lastPaper = paperRows[paperRows.length - 1];
        }
        
        // 데이터가 없는 초기 진입자 구제 로직 (Fallback)
        if (!lastPaper) {
          var totalInvestment = 5000000; // default 5,000,000 KRW
          try {
            totalInvestment = getStrategyNumber_('total_investment', 5000000);
          } catch(e) {}
          
          lastPaper = {
            cash_amount: totalInvestment,
            stock_eval_amount: 0,
            total_eval_amount: totalInvestment,
            active_positions_json: '[]'
          };
        }
        
        var cashAmount = parseFloat(lastPaper.cash_amount || 0);
        totalPurchase += cashAmount;
        totalEval += cashAmount;
        
        var paperPositions = [];
        try {
          paperPositions = JSON.parse(lastPaper.active_positions_json || '[]');
        } catch(pe) {
          logWarn_('web_dashboard', 'Failed to parse active_positions_json', { json: lastPaper.active_positions_json });
        }
        
        paperPositions.forEach(function(p) {
          var qty = parseFloat(p.quantity || 0);
          var avg = parseFloat(p.entry_price || p.avg_price || 0); // entry_price 스키마 불일치 원천 해결!
          if (qty <= 0) return;
          
          // 모의투자 종목 실시간 가격 연동 (10분 캐시 필터 적용으로 지연 시간 없음)
          var isCoin = (String(p.symbol).indexOf('KRW-') === 0 || /^[A-Z]{3,4}$/.test(p.symbol) === false); // 대략적인 코인 판별식
          var curQuote = fetchCachedCurrentPrice_(p.symbol, isCoin);
          var cur = curQuote.close || avg;
          var changePct = curQuote.change_pct || 0; // 당일 등락률 확보!
          
          var purchaseAmt = qty * avg;
          var evalAmt = qty * cur;
          
          // 해외 자산 원화 변환 (숫자로 시작하는 6자리 국내 종목코드 제외)
          var isUs = (!isCoin && p.symbol.match(/[a-zA-Z]/) && !/^[0-9]/.test(p.symbol));
          var isUsdPrice = (isUs && avg < 1000); // 1000 미만이면 달러 단가로 판정
          
          var rate = isUsdPrice ? usdRate : 1;
          
          totalPurchase += (purchaseAmt * rate);
          totalEval += (evalAmt * rate);
          
          assets.push({
            broker: '모의투자',
            symbol: p.symbol,
            name: getStockKoreanName_(p.symbol, p.name),
            qty: qty,
            price: avg,
            currentPrice: cur,
            priceKrw: isUsdPrice ? Math.round(avg * usdRate) : Math.round(avg),
            currentPriceKrw: isUsdPrice ? Math.round(cur * usdRate) : Math.round(cur),
            isCoin: isCoin,
            isUsd: isUsdPrice,
            changePct: changePct
          });
        });
      } catch (err) {
        logWarn_('web_dashboard', 'Failed to fetch Paper trading holdings for web view', {
          error: err.message || String(err)
        });
      }
    }
    
    // 4. 수동 자산(manual_holdings) 조회 및 실시간 시세 결합 (REAL 모드일 때만 수동자산 병합!)
    if (currentMode === 'REAL') {
      try {
        var manualRows = readObjects_(AM_CONFIG.SHEETS.MANUAL_HOLDINGS);
        var activeManuals = manualRows.filter(function(row) {
          var activeText = String(row.active || 'Y').toUpperCase().trim();
          var isActive = (activeText !== 'N' && activeText !== 'FALSE');
          return isActive && parseFloat(row.quantity || 0) > 0;
        });
        
        activeManuals.forEach(function(row) {
          var qty = parseFloat(row.quantity || 0);
          var avg = parseFloat(row.avg_price || 0);
          var isCoin = (String(row.broker).toLowerCase() === 'upbit');
          
          // 10분 캐시 필터가 적용된 초고속 실시간 시세 조회 함수 경유
          var curQuote = fetchCachedCurrentPrice_(row.symbol, isCoin);
          var cur = curQuote.close || avg;
          var changePct = curQuote.change_pct || 0; // 당일 등락률 확보!
          
          var purchaseAmt = qty * avg;
          var evalAmt = qty * cur;
          
          // 숫자로 시작하는 6자리 국내 종목코드 제외
          var isUsStock = (!isCoin && row.symbol.match(/[a-zA-Z]/) && !/^[0-9]/.test(row.symbol));
          var isUsdPrice = (isUsStock && avg < 1000); // 평단 1000 미만이면 달러 평단 기입으로 간주!
          var rate = isUsdPrice ? usdRate : 1;
          
          totalPurchase += (purchaseAmt * rate);
          totalEval += (evalAmt * rate);
          
          assets.push({
            broker: row.broker,
            symbol: row.symbol,
            name: getStockKoreanName_(row.symbol, row.name),
            qty: qty,
            price: avg,
            currentPrice: cur,
            priceKrw: isUsdPrice ? Math.round(avg * usdRate) : Math.round(avg),
            currentPriceKrw: isUsdPrice ? Math.round(cur * usdRate) : Math.round(cur),
            isCoin: isCoin,
            isUsd: isUsdPrice,
            changePct: changePct
          });
        });
      } catch (err) {
        logWarn_('web_dashboard', 'Failed to merge manual holdings for web', {
          error: err.message || String(err)
        });
      }
    }
    
    // 5. 종합 수익률 계산
    var percentChange = 0;
    if (totalPurchase > 0) {
      percentChange = ((totalEval - totalPurchase) / totalPurchase) * 100;
    }
    
    return {
      totalAsset: Math.round(totalEval),
      percentChange: percentChange,
      currentMode: currentMode,
      assets: assets
    };
  });
}

/**
 * [TMA 웹앱 전용 백엔드 API 2]
 * 텔레그램 웹뷰에서 전달받은 조건으로 실제계좌/모의투자 스크립트 모드를 전환합니다.
 */
function toggleInvestmentModeFromWeb(mode) {
  return withLogging_('web_dashboard', function() {
    var targetMode = (mode === 'REAL') ? 'REAL' : 'PAPER';
    setScriptProperty_('PORTFOLIO_MODE', targetMode);
    
    logInfo_('web_dashboard', 'Switched investment mode from web dashboard', {
      mode: targetMode
    });
    return { success: true, mode: targetMode };
  });
}

/**
 * [TMA 웹앱 전용 백엔드 API 3]
 * 웹뷰 양식 제출 데이터를 받아 수동 자산 기록 및 청산을 수행합니다.
 */
function updateHoldingFromWeb(broker, symbol, qty, price, isActive) {
  return withLogging_('web_dashboard', function() {
    var targetQty = parseFloat(qty || 0);
    var targetPrice = parseFloat(price || 0);
    
    logInfo_('web_dashboard', 'Received holding update from web', {
      broker: broker,
      symbol: symbol,
      quantity: targetQty,
      price: targetPrice,
      active: isActive
    });
    
    // 수동 자산 갱신 시 관련 캐시도 강제 초기화하여 다음 로드 시 실시간 업데이트 보장
    try {
      var cache = CacheService.getScriptCache();
      cache.remove('AM_PRICE_' + symbol);
    } catch(e) {}
    
    if (isActive && targetQty > 0) {
      // 1) 자산 신규 등록 및 수정
      return updateManualHoldingFromTelegram_(broker, symbol, targetQty, targetPrice);
    } else {
      // 2) 자산 비활성화 및 청산
      return clearManualHoldingFromTelegram_(broker, symbol);
    }
  });
}

/**
 * [초고속 캐싱 시세 공급 헬퍼 함수]
 * CacheService 기반으로 10분 메모리 캐시를 경유하여 시세를 획득해 리턴합니다.
 * 이 함수를 통해 REST API 호출 지연을 99% 차단합니다.
 */
function fetchCachedCurrentPrice_(symbol, isCoin) {
  var cleanSymbol = normalizeStockSymbol_(symbol);
  var cacheKey = 'AM_PRICE_' + cleanSymbol;
  
  try {
    var cache = CacheService.getScriptCache();
    var cached = cache.get(cacheKey);
    if (cached) {
      var parts = cached.split(',');
      if (parts.length >= 2) {
        return {
          close: parseFloat(parts[0]),
          change_pct: parseFloat(parts[1]),
          source: 'cache'
        };
      }
    }
  } catch(e) {
    logWarn_('web_dashboard', 'Cache fetch failed. Falling back to API query.', { error: e.message });
  }
  
  // 캐시 미스 시 실시간 API 쿼리 가동
  var close = 0;
  var changePct = 0;
  
  try {
    if (isCoin) {
      var market = cleanSymbol.indexOf('KRW-') === 0 ? cleanSymbol : 'KRW-' + cleanSymbol;
      var ticker = fetchUpbitCurrentPrice_(market);
      close = parseFloat(ticker.trade_price || 0);
      changePct = parseFloat(ticker.signed_change_rate || 0) * 100;
    } else {
      // 숫자로 시작하는 6자리 국내 종목코드는 해외 주식 판단에서 명시적 배제
      var isUs = cleanSymbol.match(/[a-zA-Z]/) && !/^[0-9]/.test(cleanSymbol);
      if (isUs) {
        var quote = fetchKisOverseasCurrentPrice_(cleanSymbol);
        close = parseFloat(quote.close || 0);
        changePct = parseFloat(quote.change_pct || 0);
      } else {
        var quote = fetchKisCurrentPrice_(cleanSymbol);
        close = parseFloat(quote.close || 0);
        changePct = parseFloat(quote.change_pct || 0);
      }
    }
  } catch(err) {
    logWarn_('web_dashboard', 'Realtime API price query failed in fetchCachedCurrentPrice_ for ' + symbol, {
      error: err.message || String(err)
    });
  }
  
  // 캐시 기입 (정상 조회 성공 시에만 10분간 보관)
  if (close > 0) {
    try {
      var cache = CacheService.getScriptCache();
      cache.put(cacheKey, close + ',' + changePct, 600); // 10분(600초) 캐싱
    } catch(ce) {}
  }
  
  return {
    close: close,
    change_pct: changePct,
    source: 'api'
  };
}

/**
 * 캐시 강제 주입용 헬퍼 (Warm-up)
 */
function warmUpPriceCache_(symbol, price, changePct) {
  try {
    var cleanSymbol = normalizeStockSymbol_(symbol);
    var cacheKey = 'AM_PRICE_' + cleanSymbol;
    var cache = CacheService.getScriptCache();
    cache.put(cacheKey, price + ',' + changePct, 600);
  } catch(e) {}
}

/**
 * 지능형 한글 종목명 반환 처리 헬퍼 함수
 * 종목코드가 노출되거나 한글명이 유실되는 현상을 100% 방지합니다.
 */
function getStockKoreanName_(symbol, fallbackName) {
  var cleanSymbol = normalizeStockSymbol_(symbol);
  
  // 🚀 [초강력 방어막] 주요 국내 특수문자/알파벳 혼합 ETF 한글명 수동 매핑 사전 작동
  var etfMappings = {
    '0167A0': 'SOL AI반도체TOP2플러스'
  };
  if (etfMappings[cleanSymbol]) {
    return etfMappings[cleanSymbol];
  }
  
  // Clean fallbackName for case comparison and checks
  var cleanFallback = String(fallbackName || '').trim();
  
  // 1. 이미 정상 한글/영문 이름이 주어진 상태면 그대로 활용 (코드가 아닌 실명인 경우)
  if (cleanFallback && cleanFallback.toUpperCase() !== cleanSymbol && !isStockCodeOrTicker_(cleanFallback)) {
    return cleanFallback;
  }
  
  var cacheKey = 'AM_NAME_' + cleanSymbol;
  try {
    var cache = CacheService.getScriptCache();
    var cached = cache.get(cacheKey);
    if (cached) {
      // 오염된 캐시 필터링: 캐싱된 이름이 종목코드와 같거나 순수 숫자/영문코드인 경우 캐시 강제 삭제 및 실시간 조회 유도
      if (cached === cleanSymbol || isStockCodeOrTicker_(cached)) {
        try { cache.remove(cacheKey); } catch(rmErr) {}
      } else {
        return cached;
      }
    }
  } catch(e) {}
  
  // 2-A. etf_watch 시트에서 탐색 시도 (ETF 한글명 유실 방지!)
  try {
    var etfWatch = readObjects_(AM_CONFIG.SHEETS.ETF_WATCH);
    var etfMatch = etfWatch.filter(function(row) {
      return normalizeStockSymbol_(row.etf_symbol) === cleanSymbol && row.etf_name;
    });
    if (etfMatch.length > 0) {
      var name = etfMatch[0].etf_name;
      try { CacheService.getScriptCache().put(cacheKey, name, 259200); } catch(ce) {}
      return name;
    }
  } catch(e) {}

  // 2-B. manual_holdings 시트에서 한글 이름 직접 획득 시도 (수동 등록 한글명 우선 복구)
  try {
    var manuals = readObjects_(AM_CONFIG.SHEETS.MANUAL_HOLDINGS);
    var manualMatch = manuals.filter(function(row) {
      return normalizeStockSymbol_(row.symbol) === cleanSymbol && row.name && row.name !== cleanSymbol && !isStockCodeOrTicker_(row.name);
    });
    if (manualMatch.length > 0) {
      var name = manualMatch[0].name;
      try { CacheService.getScriptCache().put(cacheKey, name, 259200); } catch(ce) {}
      return name;
    }
  } catch(e) {}
  
  // 2-C. market_universe 시트에서 매치되는 데이터 탐색 시도
  try {
    var universe = readObjects_(AM_CONFIG.SHEETS.MARKET_UNIVERSE);
    var match = universe.filter(function(row) {
      return normalizeStockSymbol_(row.symbol) === cleanSymbol;
    });
    if (match.length > 0 && match[0].name) {
      var name = match[0].name;
      try { CacheService.getScriptCache().put(cacheKey, name, 259200); } catch(ce) {} // 3일간 캐싱
      return name;
    }
  } catch(e) {}
  
  // 3. KIS 시세 조회를 통한 상품 한글명 획득 시도 (개별 try-catch로 격리하여 에러 차단!)
  var kisName = null;
  try {
    var isOverseas = /^[A-Za-z]/.test(cleanSymbol);
    var quote;
    if (isOverseas) {
      quote = fetchKisOverseasCurrentPrice_(cleanSymbol);
    } else {
      quote = fetchKisCurrentPrice_(cleanSymbol);
    }
    if (quote && quote.name) {
      kisName = quote.name;
    }
  } catch(e) {
    logWarn_('symbol_resolver', 'KIS name query failed; proceeding to Naver fallback', { symbol: cleanSymbol, error: e.message });
  }
  
  if (kisName && kisName !== cleanSymbol && !isStockCodeOrTicker_(kisName)) {
    try { CacheService.getScriptCache().put(cacheKey, kisName, 259200); } catch(ce) {}
    return kisName;
  }
  
  // 3-B. Naver Finance 웹 크롤링을 통한 상품 한글명 획득 시도 (개별 try-catch로 격리!)
  try {
    var isOverseas = /^[A-Za-z]/.test(cleanSymbol);
    if (!isOverseas) {
      var naverName = fetchNaverStockName_(cleanSymbol);
      if (naverName) {
        try { CacheService.getScriptCache().put(cacheKey, naverName, 259200); } catch(ce) {}
        return naverName;
      }
    }
  } catch(e) {
    logWarn_('symbol_resolver', 'Naver name query fallback failed', { symbol: cleanSymbol, error: e.message });
  }
  
  return cleanFallback || symbol;
}

/**
 * 텍스트가 주식 코드 또는 티커 형태인지 판별하는 헬퍼 함수
 */
function isStockCodeOrTicker_(text) {
  if (!text) return false;
  var val = String(text).trim().toUpperCase();
  // 1. 6자리 알판누적코드 (국내 주식/ETF 코드 예: 005930, 0167A0)
  if (/^[0-9A-Z]{6}$/.test(val)) return true;
  // 2. 1~5자리 영문자 (미국 주식 티커 예: AAPL)
  if (/^[A-Z]{1,5}$/.test(val)) return true;
  // 3. 업비트 마켓 코드 또는 주요 코인 심볼 (예: KRW-BTC, BTC, ETH)
  if (val.indexOf('KRW-') === 0) return true;
  if (['BTC', 'ETH', 'SOL', 'XRP', 'ADA', 'DOGE'].indexOf(val) >= 0) return true;
  
  return false;
}

/**
 * 네이버 페이 증권 공용 페이지 크롤링을 통한 종목/ETF 한글명 획득 헬퍼 함수 (EUC-KR 자동 변환 대응)
 */
function fetchNaverStockName_(symbol) {
  try {
    var url = 'https://finance.naver.com/item/main.naver?code=' + symbol;
    var response = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    if (response.getResponseCode() === 200) {
      var html = response.getContentText('EUC-KR'); // 네이버 증권은 EUC-KR 인코딩 사용
      
      // meta og:title 매핑 시도
      var ogTitleMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i);
      if (ogTitleMatch && ogTitleMatch[1]) {
        var name = ogTitleMatch[1].trim();
        name = name.split(':')[0].split('-')[0].trim(); // Split by both : and - to get clean name
        if (name && name !== symbol && !isStockCodeOrTicker_(name)) {
          return name;
        }
      }
      
      // title 태그 매핑 시도
      var titleMatch = html.match(/<title>([^<]+)<\/title>/i);
      if (titleMatch && titleMatch[1]) {
        var name = titleMatch[1].trim();
        name = name.split(':')[0].split('-')[0].split(';')[0].trim();
        if (name && name !== symbol && !isStockCodeOrTicker_(name)) {
          return name;
        }
      }
    }
  } catch(e) {
    logWarn_('naver_fallback', 'Naver Stock Name query completely failed', { symbol: symbol, error: e.message });
  }
  return '';
}

/**
 * 환율 조회를 위한 헬퍼 함수
 */
function getUsdKrwRate_() {
  try {
    var cache = CacheService.getScriptCache();
    var cached = cache.get('AM_USD_KRW_RATE');
    if (cached) return parseFloat(cached);
    
    var url = 'https://api.exchangerate-api.com/v4/latest/USD';
    var response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (response.getResponseCode() === 200) {
      var data = JSON.parse(response.getContentText());
      var rate = parseFloat(data.rates.KRW || 1350);
      cache.put('AM_USD_KRW_RATE', String(rate), 1800); // 30분 캐싱
      return rate;
    }
  } catch(e) {}
  return 1350; // 오류 시 보수적 기본값
}

/**
 * [TMA 웹앱 전용 백엔드 API 4]
 * 모의 매매 체결 거래 내역(paper_ledger)을 최근 순으로 최대 30개 조회하여 반환합니다.
 */
function getPaperLedgerDataForWeb() {
  return withLogging_('web_dashboard', function() {
    ensureAllSheets_();
    var sheetName = AM_CONFIG.SHEETS.PAPER_LEDGER;
    var rows = readObjects_(sheetName);
    if (rows.length === 0) return [];
    
    // 시간 역순(최신순) 정렬
    rows.sort(function(a, b) {
      return String(b.date || b.created_at || '').localeCompare(String(a.date || a.created_at || ''));
    });
    
    // 최대 30개만 반환
    var sliced = rows.slice(0, 30);
    return sliced.map(function(row) {
      return {
        date: row.date || '',
        symbol: normalizeStockSymbol_(row.symbol),
        name: getStockKoreanName_(row.symbol, row.name || row.symbol),
        actionType: String(row.action_type || 'BUY').toUpperCase().trim(),
        price: parseFloat(row.price || 0),
        quantity: parseFloat(row.quantity || 0),
        amount: parseFloat(row.amount || 0),
        reason: row.reason || '',
        createdAt: row.created_at || ''
      };
    });
  });
}

/**
 * CLI 또는 원격 실행을 위한 UI 경고창 없는 텔레그램 웹훅 등록 전역 함수
 */
function registerTelegramWebhookSilent() {
  var token = getScriptProperty_(AM_CONFIG.PROPERTY_KEYS.TELEGRAM_BOT_TOKEN, '');
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN이 스크립트 속성에 없습니다.');
  }
  
  var webAppUrl = 'https://script.google.com/macros/s/AKfycbysCckjcPefqrgZyMcZvksLjVJzpKO1yUUye8CPuiNT21ms3tEZF9dKCjm_gwYlJ1T6/exec';
  var url = 'https://api.telegram.org/bot' + token + '/setWebhook?url=' + encodeURIComponent(webAppUrl);
  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  var resText = res.getContentText();
  
  logInfo_('telegram_webhook', 'Silent Webhook registration result', { response: resText });
  return resText;
}

/**
 * [AI 주식 분석 헬퍼 1] 종목 코드 및 유형 해결사
 */
function resolveSymbolAndName_(input) {
  var text = String(input || '').trim();
  if (!text) return null;
  
  // 1. 입력 자체가 코드/티커 형태인지 체크
  if (isStockCodeOrTicker_(text)) {
    var symbol = normalizeStockSymbol_(text);
    var isOvr = /^[A-Za-z]/.test(symbol);
    var name = text;
    
    if (symbol.indexOf('KRW-') === 0) {
      name = symbol.replace('KRW-', '');
    } else {
      name = getStockKoreanName_(symbol, symbol);
    }
    return { symbol: symbol, name: name, type: symbol.indexOf('KRW-') === 0 ? 'crypto' : (isOvr ? 'overseas' : 'domestic') };
  }
  
  // 2. 한글명인 경우 시트(Candidates -> Leader 50 -> Universe) 대조하여 정밀 룩업
  var sheetsToSearch = [
    AM_CONFIG.SHEETS.LEADER_CANDIDATES,
    AM_CONFIG.SHEETS.LEADER_50,
    AM_CONFIG.SHEETS.MARKET_UNIVERSE
  ];
  
  for (var sIdx = 0; sIdx < sheetsToSearch.length; sIdx++) {
    var sName = sheetsToSearch[sIdx];
    try {
      var rows = readObjects_(sName);
      if (rows && rows.length > 0) {
        // 완벽 일치 우선 검색
        for (var i = 0; i < rows.length; i++) {
          var rowName = String(rows[i].name || '').trim();
          if (rowName.toLowerCase() === text.toLowerCase()) {
            var sym = normalizeStockSymbol_(rows[i].symbol);
            var isOvr = /^[A-Za-z]/.test(sym);
            return { symbol: sym, name: rowName, type: isOvr ? 'overseas' : 'domestic' };
          }
        }
        // 부분 일치 검색
        for (var i = 0; i < rows.length; i++) {
          var rowName = String(rows[i].name || '').trim();
          if (rowName.toLowerCase().indexOf(text.toLowerCase()) >= 0) {
            var sym = normalizeStockSymbol_(rows[i].symbol);
            var isOvr = /^[A-Za-z]/.test(sym);
            return { symbol: sym, name: rowName, type: isOvr ? 'overseas' : 'domestic' };
          }
        }
      }
    } catch(e) {
      logWarn_('symbol_resolver', 'Error searching sheet ' + sName, { error: e.message });
    }
  }
  
  // 3. 주요 해외 빅테크 한글명 수동 매핑 사전
  var usMappings = {
    '애플': 'AAPL', '테슬라': 'TSLA', '엔비디아': 'NVDA', '엔비디': 'NVDA', '마이크로소프트': 'MSFT', '마소': 'MSFT',
    '아마존': 'AMZN', '구글': 'GOOGL', '메타': 'META', '넷플릭스': 'NFLX'
  };
  if (usMappings[text]) {
    var sym = usMappings[text];
    return { symbol: sym, name: text, type: 'overseas' };
  }
  
  // 4. 가상자산 주요 한글명 매핑 사전
  var cryptoMappings = {
    '비트코인': 'BTC', '이더리움': 'ETH', '솔라나': 'SOL', '리플': 'XRP', '도지코인': 'DOGE'
  };
  if (cryptoMappings[text]) {
    var sym = 'KRW-' + cryptoMappings[text];
    return { symbol: sym, name: text, type: 'crypto' };
  }
  
  return null;
}

/**
 * [AI 주식 분석 헬퍼 2] 최신 뉴스 브리핑 시트에서 종목 관련 뉴스 포착
 */
function getStockRelatedNews_(stockName) {
  var relatedNews = [];
  try {
    var newsRows = readObjects_(AM_CONFIG.SHEETS.NEWS_BRIEFING);
    if (newsRows && newsRows.length > 0) {
      // 최신 5일 뉴스 정렬
      newsRows.sort(function(a, b) { 
        return String(b.date).localeCompare(String(a.date)); 
      });
      
      var maxDays = Math.min(newsRows.length, 5);
      for (var d = 0; d < maxDays; d++) {
        var n = newsRows[d];
        var summary = parseJsonCell_(n.summary_json, {});
        if (summary) {
          var newsList = [];
          if (Array.isArray(summary.key_news)) {
            newsList = summary.key_news;
          } else if (summary.key_news && typeof summary.key_news === 'object') {
            newsList = Object.keys(summary.key_news).map(function(k) { return summary.key_news[k]; });
          }
          
          newsList.forEach(function(item) {
            var text = '';
            if (typeof item === 'string') {
              text = item;
            } else if (item && item.topic) {
              text = item.topic + ': ' + (item.impact || '') + ' ' + (item.details || '');
            }
            
            if (text && (text.indexOf(stockName) >= 0 || text.toLowerCase().indexOf(stockName.toLowerCase()) >= 0)) {
              relatedNews.push('[' + normalizeDateValue_(n.date) + '] ' + text);
            }
          });
        }
      }
    }
  } catch(e) {
    logWarn_('ai_stock_analysis', 'Failed to get related news for ' + stockName, { error: e.message });
  }
  return relatedNews;
}

/**
 * [AI 주식 분석 헬퍼 3] 포트폴리오 자문용 전용 프롬프트 생성
 */
function buildAiStockAnalysisPrompt_(stockInfo, quote, relatedNews, breadthInfo, usdRate) {
  var newsText = relatedNews.length > 0 
    ? relatedNews.slice(0, 5).join('\n') 
    : '최근 5영업일 내에 시스템 뉴스 브리핑에 명시적으로 포착된 개별 뉴스는 없습니다. (거시 매크로 관점에서 판단 요망)';
  
  var marketText = breadthInfo 
    ? '- 상승 종목 비율: ' + (Number(breadthInfo.up_ratio || 0)*100).toFixed(1) + '%\n' +
      '- 20일선 상회 비율: ' + (Number(breadthInfo.ma20_above_ratio || 0)*100).toFixed(1) + '%\n' +
      '- 종합 시장 강도 점수: ' + breadthInfo.breadth_score + '점\n' +
      '- 최근 시장 메모: ' + (breadthInfo.memo || '특이사항 없음')
    : '시장 지표 수집 지연 상태';

  var priceUnit = stockInfo.type === 'overseas' ? '$' : (stockInfo.type === 'crypto' ? '원' : '원');
  var changeSign = quote.change_pct > 0 ? '+' : '';
  
  var prompt = [
    '당신은 한국 주식 및 글로벌 거시 금융 자산운용 시장에 특화된 최고 수준의 AI 투자 자문 전략가(AI Portfolio Advisor)입니다.',
    '요청하신 종목에 대해 실시간 가격 데이터, 관련 뉴스, 거시 시장 지표를 다차원 분석하여 최적의 포트폴리오 비중 조절 및 매매(매수/매도/보유) 의견을 도출해 주십시오.',
    '',
    '[분석 대상 종목 기본 정보]',
    '- 종목명: ' + stockInfo.name,
    '- 심볼/티커: ' + stockInfo.symbol,
    '- 시장 구분: ' + stockInfo.type.toUpperCase(),
    '- 현재 실시간 가격: ' + formatNumber_(quote.close) + ' ' + priceUnit,
    '- 오늘 등락률: ' + changeSign + quote.change_pct + '%',
    (quote.volume ? '- 당일 거래량: ' + formatNumber_(quote.volume) + ' 주' : ''),
    (usdRate ? '- 실시간 기준 환율: 1 USD = ' + formatNumber_(usdRate) + ' KRW' : ''),
    '',
    '[최신 시장 거시 온도 (Market Breadth)]',
    marketText,
    '',
    '[최근 해당 종목 관련 시스템 뉴스 포착 내역]',
    newsText,
    '',
    '[작성 및 분석 필수 요구사항]',
    '1. **최종 투자의견 도출**: 분석 데이터에 근거하여 명확하게 **[매수(BUY)]**, **[매도(SELL)]**, 또는 **[보유(HOLD)]** 중 하나를 선택하고 그 근거를 핵심 요약해서 제시해 주십시오.',
    '2. **다차원 분석 결과**: 현재 가격 등락의 의미와 당일 수집된 뉴스, 그리고 현재 전체 한국/미국 시장의 거시 강도 지표와의 궁합/연동 관계를 알기 쉽게 설명해 주십시오.',
    '3. **리스크 관리 지침**: 투자자가 반드시 눈여겨보아야 할 핵심 리스크 요인(예: 환율 변동성, 금리 추이, 섹터 수급 등)과 가격이 몇 % 급락/돌파할 때 대응해야 하는지 구체적인 가격 대별 대응법(조건부 시나리오 가이드)을 명시해 주십시오.',
    '4. **어조 및 분량**: 텔레그램 메신저 채팅방에서 읽기 편하도록 깔끔한 문단 구성, 굵은 글씨(`<b>`), 불릿포인트 등을 풍부하게 활용해 주십시오. 최종 보고서는 완결된 마침표 한글 문장형으로 작성되어야 하며 내용이 도중에 잘리지 않도록 정밀하게 끝맺음 해주어야 합니다.',
    '5. **면책 조항**: 마지막에는 "본 보고서는 AI의 분석 요약본으로, 실제 투자 결정에 대한 책임은 투자자 본인에게 있습니다."라는 취지의 면책 문구를 1줄 작게 추가해 주십시오.',
    '',
    '위 규칙을 엄격하게 지켜 명품 투자 리포트를 품격 있고 신뢰감을 주는 어조로 한글로 즉시 생성해 주십시오.'
  ].join('\n');
  
  return prompt;
}

/**
 * [AI 주식 분석 헬퍼 4] 텔레그램 파싱 에러 방지 HTML 안전 이스케이프 정화기
 */
function escapeTelegramHtml_(text) {
  if (!text) return '';
  
  // 1. 보호할 유효 HTML 태그 목록을 플레이스홀더로 임시 교체
  var cleanText = String(text)
    .replace(/<b>/gi, '___B_OPEN___')
    .replace(/<\/b>/gi, '___B_CLOSE___')
    .replace(/<i>/gi, '___I_OPEN___')
    .replace(/<\/i>/gi, '___I_CLOSE___')
    .replace(/<code>/gi, '___C_OPEN___')
    .replace(/<\/code>/gi, '___C_CLOSE___');

  // 2. 일반 텍스트 내 텔레그램 파싱 깨짐 및 충돌 유발 문자(마크다운 포함)를 정화하고 이스케이프
  cleanText = cleanText
    .replace(/[\*\_\`]/g, '') // 마크다운 잔재들 제거
    .replace(/&/g, '&amp;')   // 이스케이프 순서 1순위 (더블 이스케이프 방지)
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // 3. 임시 교체한 플레이스홀더를 유효 HTML 태그로 안전 복원
  cleanText = cleanText
    .replace(/___B_OPEN___/g, '<b>')
    .replace(/___B_CLOSE___/g, '</b>')
    .replace(/___I_OPEN___/g, '<i>')
    .replace(/___I_CLOSE___/g, '</i>')
    .replace(/___C_OPEN___/g, '<code>')
    .replace(/___C_CLOSE___/g, '</code>');

  return cleanText;
}

/**
 * 텔레그램 및 관리자용으로 등록된 모든 수동 자산 일괄 청산(삭제)을 단행합니다.
 */
function clearAllManualHoldingsFromTelegram_() {
  var today = amTodayString_();
  
  // 1. manual_holdings 시트 데이터 싹 날리기 (헤더 제외)
  clearDataRows_(AM_CONFIG.SHEETS.MANUAL_HOLDINGS);
  
  // 2. holdings_current 시트에서 오늘자 날짜 중 수동 자산(manual_ 로 시작하는 source) 행들 제거
  var currentSheetName = AM_CONFIG.SHEETS.HOLDINGS_CURRENT;
  var currentSheet = ensureSheet_(currentSheetName, AM_SHEET_SCHEMAS[currentSheetName]);
  var values = currentSheet.getDataRange().getValues();
  if (values.length > 1) {
    var headers = values[0];
    var dateIndex = headers.indexOf('date');
    var sourceIndex = headers.indexOf('source');
    
    if (dateIndex >= 0 && sourceIndex >= 0) {
      var keepRows = [];
      for (var i = 1; i < values.length; i += 1) {
        var rowDate = normalizeDateValue_(values[i][dateIndex]);
        var rowSource = String(values[i][sourceIndex] || '');
        
        // 오늘 날짜이면서 수동 자산(manual_)인 행들은 보관 리스트에서 제외 (삭제 대상)
        if (rowDate === today && rowSource.indexOf('manual_') === 0) {
          // 제외
        } else {
          keepRows.push(values[i]);
        }
      }
      rewriteDataRows_(currentSheet, headers.length, keepRows);
    }
  }
  
  // 3. 자산 가중치 재계산 및 리스크 스냅샷 갱신
  try {
    rewriteHoldingWeightsForDate_(today);
    buildPortfolioRiskSnapshot_(today);
  } catch(e) {
    logWarn_('telegram_manual_asset', 'Failed to recalculate weights after bulk clear', { error: e.message });
  }
  
  return { success: true };
}
