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
    mobileCommand_(200, '관리', 'refresh_mobile_commands', '모바일 명령판 갱신', 'mobile_commands 시트를 다시 정리합니다.')
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
    refresh_mobile_commands: refreshMobileCommandSheet
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
        '<b>🤖 AI 스캐너 텔레그램 모바일 챗봇 비서</b>',
        '',
        '스프레드시트 밖에서도 메신저를 통해 실시간으로 명령을 내릴 수 있습니다.',
        '',
        '👉 <b>대화형 명령어 목록:</b>',
        '• <b>/holdings</b> : 현재 계좌(실제/가상) 자산 평가액 및 세부 보유 주식 조회',
        '• <b>/plan</b> : 오늘 장전 수립된 관심종목 TOP 3 및 진입가 계획 조회',
        '• <b>/run</b> : 전체 일일 마감 워크플로우 원격 구동 (인라인 버튼 지원)',
        '• <b>/mode</b> : 자산 감시 및 잔고 조회 모드 간편 전환 (인라인 버튼 지원)',
        '• <b>/score [종목명/종목코드]</b> : 지정 종목의 주도주 분석 점수판 즉석 조회',
        '• <b>/add [종목코드]</b> : 장중 5분 돌파 실시간 감시 목록에 관심 종목 추가',
        '• <b>/del [종목코드]</b> : 실시간 감시 목록에서 해당 종목 해제',
        '• <b>/watchlist</b> : 현재 추가된 장중 실시간 관심 종목 리스트 조회',
        '• <b>/help</b> : 명령어 가이드 요약 보기',
        '',
        '<i>* 각 명령어는 뒤에 필요한 인자(코드/명)를 한 칸 띄우고 붙여 입력해 주시면 됩니다.</i>'
      ].join('\n');
      sendTelegramMessage(helpMsg);
    }
    else if (command === '/holdings') {
      sendTelegramMessage('📥 실시간 포트폴리오 자산 현황을 조회하고 있습니다. 잠시만 기다려 주세요...');
      
      var isRealAccount = false;
      var domesticPositions = [];
      var overseasPositions = [];
      var cashKrw = 0, stockEvalKrw = 0, totalKrw = 0;
      var dailyKrw = 0, cumulative = 0;
      var dateStr = '';
      
      var portMode = getScriptProperty_(AM_CONFIG.PROPERTY_KEYS.PORTFOLIO_MODE, 'real');
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
                // 해외 보유주식 병합 (중복 제거)
                var isDup = overseasPositions.some(function(op) {
                  return op.symbol.toLowerCase() === mPos.symbol.toLowerCase();
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
                // 국내 보유주식 병합 (중복 제거)
                var isDup = domesticPositions.some(function(dp) {
                  return normalizeStockSymbol_(dp.symbol) === normalizeStockSymbol_(mPos.symbol);
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
        sendTelegramMessage('⚠️ <b>조회 오류</b>\n\nAI 주식 비서에게 물어볼 질문 내용을 함께 입력해 주세요.\n(예: <code>/ai 오늘 시장 흐름은 어떻게 요약할 수 있을까?</code>)');
      } else {
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
  
  var response = ui.prompt(
    '텔레그램 양방향 웹훅 등록',
    '구글 Apps Script 화면 우측 상단의 [배포 > 새 배포] 클릭 후,\n' +
    '1. 유형 선택: 웹 앱\n' +
    '2. 액세스할 수 있는 사용자: 모든 사람\n' +
    '3. 배포 후 발급된 [웹 앱 URL] 주소를 아래에 붙여넣어 주세요:\n\n' +
    '(예: https://script.google.com/macros/s/.../exec)',
    ui.ButtonSet.OK_CANCEL
  );
  
  if (response.getSelectedButton() !== ui.Button.OK) return;
  
  var webAppUrl = String(response.getResponseText()).trim();
  if (!webAppUrl || webAppUrl.indexOf('https://script.google.com') !== 0) {
    ui.alert('오류: 올바르지 않은 구글 웹 앱 URL 주소입니다.');
    return;
  }
  
  try {
    var url = 'https://api.telegram.org/bot' + token + '/setWebhook?url=' + encodeURIComponent(webAppUrl);
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    var resText = res.getContentText();
    var resJson = JSON.parse(resText);
    
    if (resJson.ok) {
      ui.alert('🎉 웹훅 등록 완료!\n\n이제 텔레그램 봇 채팅방에 가셔서 /help 또는 /holdings 를 전송하여 챗봇을 즉시 테스트해 보세요!');
      logInfo_('telegram_webhook', 'Telegram webhook registered successfully', { url: webAppUrl });
    } else {
      ui.alert('웹훅 등록 실패\n\nTelegram API 응답: ' + resText);
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
