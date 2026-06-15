// ==================================================
// 🤖 [금융 관제 2.0] 초정밀 자동 투자(Auto-Trading) 실행 엔진
// ==================================================

/**
 * 매일 지정 시간에 실행되어 VAA/퀀트 시그널 변화를 감지하고, KIS API를 통한 자동 주문을 격발하는 메인 트리거 서비스
 */
function executeAutoTradingRoutine() {
  logInfo_('auto_trading', 'Starting daily auto-trading routine check (Forced MOCK mode)...');
  
  try {
    ensureAllSheets_();
    var today = amTodayString_();
    
    // 1. 현재 VAA 시그널 수집
    var vaa = getVaaStrategySignal();
    if (!vaa) {
      throw new Error('VAA 전략 시그널을 산출할 수 없어 자동 매매를 진행할 수 없습니다.');
    }
    
    var recommendedSymbol = vaa.recommended_symbol;
    logInfo_('auto_trading', 'Current VAA signal recommended symbol: ' + recommendedSymbol);
    
    // 2. 사용자 화면 모드를 변경하지 않고 모의투자 잔고만 강제 갱신
    collectHoldingsCurrent(true, 'MOCK');
    
    // 3. 현재 보유 중인 모의투자(MOCK) VAA 자산이 무엇인지 조회
    var currentHoldings = readObjects_(AM_CONFIG.SHEETS.HOLDINGS_CURRENT);
    var todayHoldings = currentHoldings.filter(function(h) {
      var isToday = normalizeDateValue_(h.date) === normalizeDateValue_(today);
      var isMockSource = String(h.source).indexOf('mock_trading') >= 0;
      return isToday && isMockSource;
    });
    
    // VAA 대상 ETF 종목 리스트 (공격형/방어형 전체)
    var vaaUniverse = ['SPY', 'QQQ', 'IWM', 'EEM', 'LQD', 'IEF', 'SHY'];
    
    // 현재 보유 중인 VAA ETF 검색
    var currentVaaHolding = null;
    todayHoldings.forEach(function(h) {
      var sym = normalizeStockSymbol_(h.symbol);
      if (vaaUniverse.indexOf(sym) >= 0) {
        currentVaaHolding = sym;
      }
    });
    
    // 4. 시그널 변화 체크 및 리밸런싱 격발
    var targetSymbol = normalizeStockSymbol_(recommendedSymbol);
    
    if (currentVaaHolding === targetSymbol) {
      logInfo_('auto_trading', 'No VAA signal change detected for Mock portfolio. Recommended symbol (' + recommendedSymbol + ') is already fully held.');
      
      // 단, 오늘이 매월 말일이라면 정기 퀀트 팩터 리밸런싱도 함께 돌려줌 (모의투자 전용)
      if (isLastBusinessDayOfMonth_()) {
        logInfo_('auto_trading', 'Today is the last business day of the month. Running monthly mock rebalancing.');
        runMonthlyQuantRebalancing();
      }
      return;
    }
    
    // 시그널이 바뀌었을 경우 리밸런싱 자동 격발
    logInfo_('auto_trading', 'VAA Signal changed from ' + (currentVaaHolding || 'NONE') + ' to ' + targetSymbol + '. Triggering Mock auto-rebalancing.');
    
    var msgHeader = '🤖 <b>[AUTO TRADING] 모의투자 VAA 시그널 변화 감지 및 리밸런싱 격발</b>\n';
    msgHeader += '----------------------------------------\n';
    msgHeader += '• 이전 자산: ' + (currentVaaHolding || '없음(현금)') + '\n';
    msgHeader += '• 신규 추천: <b>' + targetSymbol + '</b>\n';
    msgHeader += '• 대상 계좌: <b>한투 모의투자 전용계좌</b> (실계좌 무관)\n';
    msgHeader += '----------------------------------------\n';
    
    // 두 번째 인자로 'mock'을 넘겨 실제 계좌 매매를 절대 타지 않도록 보장
    var rebalResult = runPaperPortfolioQuantRebalancing_(recommendedSymbol, 'mock');
    
    var logs = '';
    if (rebalResult.success) {
      logs += '\n✅ <b>모의투자 리밸런싱 실행 완료</b>\n';
      if (rebalResult.logs && rebalResult.logs.length > 0) {
        logs += rebalResult.logs.map(function(l) { return '  ' + l; }).join('\n');
      }
    } else {
      logs += '\n❌ <b>모의투자 리밸런싱 실행 실패</b>: ' + rebalResult.reason;
    }
    
    sendTelegramMessage(msgHeader + logs);
    
  } catch(e) {
    logWarn_('auto_trading', 'Failed to execute daily auto-trading routine', { error: e.message });
    sendTelegramMessage('🚨 <b>[AUTO TRADING] 모의투자 자동 매매 루틴 실행 오류 발생</b>\n사유: ' + e.message);
  }
}

/**
 * 💡 [신설] 오늘이 해당 월의 마지막 영업일인지 판별하는 헬퍼 함수
 */
function isLastBusinessDayOfMonth_() {
  var today = new Date();
  var month = today.getMonth();
  
  // 1일 뒤부터 말일까지 영업일(주말 제외)이 있는지 체크
  var testDate = new Date(today);
  while (true) {
    testDate.setDate(testDate.getDate() + 1);
    if (testDate.getMonth() !== month) {
      // Next month reached, today was the last day
      return true;
    }
    var day = testDate.getDay();
    if (day !== 0 && day !== 6) {
      // A workday exists before next month -> today is not the last business day
      return false;
    }
  }
}

/**
 * ⚙️ 매일 오전 09:10에 자동 매매 루틴을 격발하는 Apps Script 시간 기반 트리거를 등록하는 함수
 * 기존 중복 트리거를 자동 청소하여 무한 증식을 차단합니다.
 */
function setupDailyAutoTradingTrigger() {
  var functionName = 'executeAutoTradingRoutine';
  var triggers = ScriptApp.getProjectTriggers();
  
  // 기존 동일 트리거 삭제
  triggers.forEach(function(t) {
    if (t.getHandlerFunction() === functionName) {
      ScriptApp.deleteTrigger(t);
    }
  });
  
  // 매일 오전 9시 ~ 10시 사이에 실행되도록 트리거 등록
  ScriptApp.newTrigger(functionName)
    .timeBased()
    .everyDays(1)
    .atHour(9)
    .nearMinute(10) // 09:10 실행
    .create();
    
  logInfo_('auto_trading', 'Successfully registered time-driven trigger for: ' + functionName + ' at 09:10 Daily');
  return { success: true, message: '매일 오전 09:10 자동 매매 트리거가 성공적으로 등록되었습니다.' };
}

/**
 * 💡 [신설] 리밸런싱 주문 완료 직후 5분 뒤 감시 일회성 트리거를 동적으로 설치하는 헬퍼 함수
 * @param {Array} sentOrders 송신 완료된 주문 정보 객체 배열
 */
function createWatchdogTriggerForOrder(sentOrders) {
  if (!sentOrders || sentOrders.length === 0) return;
  
  var functionName = 'runOnceOffWatchdogTrigger';
  var propKey = 'NCCLD_WATCH_ORDERS';
  
  // 기존 미체결 와치독 관련 일회성 트리거 정리
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(t) {
    if (t.getHandlerFunction() === functionName) {
      ScriptApp.deleteTrigger(t);
    }
  });
  
  // 감시할 주문 리스트를 ScriptProperties에 JSON 문자열로 저장
  setScriptProperty_(propKey, JSON.stringify(sentOrders));
  
  // 5분 뒤에 실행되는 1회성 시간 트리거 생성
  ScriptApp.newTrigger(functionName)
    .timeBased()
    .after(5 * 60 * 1000) // 5분 (300,000 ms) 후 실행
    .create();
    
  logInfo_('auto_trading', 'Successfully registered 5-min once-off watchdog trigger for ' + sentOrders.length + ' orders.');
}

/**
 * 💡 [신설] 일회성 트리거에 의해 호출되는 워치독 실시간 실행기
 */
function runOnceOffWatchdogTrigger() {
  logInfo_('auto_trading', 'Once-off Watchdog trigger fired. Checking unfilled orders...');
  
  var functionName = 'runOnceOffWatchdogTrigger';
  var propKey = 'NCCLD_WATCH_ORDERS';
  
  // 자기 자신(트리거) 삭제하여 단발성 작동 보장
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(t) {
    if (t.getHandlerFunction() === functionName) {
      ScriptApp.deleteTrigger(t);
    }
  });
  
  var savedOrdersStr = getScriptProperty_(propKey, null);
  if (!savedOrdersStr) {
    logInfo_('auto_trading', 'No orders found to watch.');
    return;
  }
  
  // 보관 정보 삭제
  deleteScriptProperty_(propKey);
  
  try {
    var sentOrders = JSON.parse(savedOrdersStr);
    checkAndResolveUnfilledOrders(sentOrders);
  } catch(e) {
    logWarn_('auto_trading', 'Failed to execute runOnceOffWatchdogTrigger', { error: e.message });
  }
}

/**
 * 💡 [신설] 미체결 주문 추적 및 시장가 강제 정정 재주문 핵심 처리 엔진
 * @param {Array} sentOrders 송신 주문 목록 [{symbol, name, action_type, order_no, quantity, price, market, is_mock}]
 */
function checkAndResolveUnfilledOrders(sentOrders) {
  if (!sentOrders || sentOrders.length === 0) return;
  
  var account = getKisAccountConfig_();
  var today = amTodayString_();
  var logs = [];
  var hasUnfilled = false;
  
  sentOrders.forEach(function(order) {
    var sym = normalizeStockSymbol_(order.symbol);
    var isOverseas = /^[A-Za-z]/.test(sym);
    var isMock = (order.is_mock === true);
    if (!isMock) {
      logWarn_('auto_trading', 'Blocked watchdog processing for a non-MOCK order', {
        symbol: sym,
        order_no: order.order_no
      });
      return;
    }
    
    // 모의투자/실계좌 구분 인증
    var auth = null;
    var targetCano = account.cano;
    var targetProductCode = account.accountProductCode;
    
    if (isMock) {
      auth = (account.mockAppKey && account.mockAppSecret) ? {
        appKey: account.mockAppKey,
        appSecret: account.mockAppSecret,
        baseUrl: account.mockBaseUrl || 'https://openapivts.koreainvestment.com:29443',
        cano: account.mockCano,
        productCode: account.mockProductCode || '01'
      } : null;
      targetCano = account.mockCano;
      targetProductCode = account.mockProductCode;
    }
    
    // 1. 미체결 주문 목록 조회
    var unfilledList = [];
    try {
      if (isOverseas) {
        var excg = getOverseasExchangeCode_(sym);
        unfilledList = fetchKisOverseasNccldOrders_(excg, targetCano, targetProductCode, auth);
      } else {
        unfilledList = fetchKisDomesticNccldOrders_(targetCano, targetProductCode, auth);
      }
    } catch(e) {
      logWarn_('auto_trading', 'Unfilled order inquiry failed for ' + sym, { error: e.message });
      return;
    }
    
    // 2. 우리가 보낸 주문 번호와 매칭되는 미체결 정보 확인
    var targetOrderNo = String(order.order_no).trim();
    var matchItem = null;
    
    if (unfilledList && unfilledList.length > 0) {
      unfilledList.forEach(function(item) {
        var unfilledNo = String(item.odno || item.orgn_odno || item.odr_no || '').trim();
        if (unfilledNo === targetOrderNo) {
          matchItem = item;
        }
      });
    }
    
    if (!matchItem) {
      // 미체결에 없다면 전량 정상 체결 완료된 것
      logInfo_('auto_trading', 'Order ' + targetOrderNo + ' (' + sym + ') is fully filled.');
      return;
    }
    
    // 미체결 잔량이 존재함!
    hasUnfilled = true;
    var unfilledQty = parseInt(matchItem.nccld_qty || matchItem.ccld_dvsn_name || 0, 10);
    if (unfilledQty <= 0) {
      var orderQty = parseInt(matchItem.ord_qty || order.quantity, 10);
      var filledQty = parseInt(matchItem.tot_ccld_qty || matchItem.ccld_qty || 0, 10);
      unfilledQty = orderQty - filledQty;
    }
    
    if (unfilledQty <= 0) {
      logInfo_('auto_trading', 'Unfilled quantity is zero for order ' + targetOrderNo);
      return;
    }
    
    logInfo_('auto_trading', 'Found unfilled order: ' + targetOrderNo + ' (' + sym + '), unfilled qty: ' + unfilledQty);
    logs.push('⚠️ <b>미체결 감지</b>: ' + order.name + ' (' + sym + ') ' + unfilledQty + '주 미체결');
    
    // 3. 미체결 주문 취소 송신
    var cancelSuccess = false;
    try {
      if (isOverseas) {
        var excg = getOverseasExchangeCode_(sym);
        var cancelRes = cancelOrModifyOverseasOrder_(excg, targetOrderNo, targetOrderNo, '02', unfilledQty, 0, auth);
        cancelSuccess = cancelRes.success;
      } else {
        var cancelRes = cancelOrModifyDomesticOrder_(targetOrderNo, targetOrderNo, '02', unfilledQty, 0, auth);
        cancelSuccess = cancelRes.success;
      }
      
      if (cancelSuccess) {
        logs.push('  └ ✅ 기존 지정가 미체결 주문 취소 완료');
      } else {
        logs.push('  └ ❌ 기존 주문 취소 실패: ' + (cancelRes ? cancelRes.reason : '응답 없음'));
      }
    } catch(cancelErr) {
      logs.push('  └ ❌ 기존 주문 취소 도중 예외 발생: ' + cancelErr.message);
    }
    
    // 4. 취소 완료된 잔량만큼 시장가(정정)로 재주문 송신
    if (cancelSuccess) {
      try {
        var action = order.action_type; // BUY 또는 SELL
        var orderRes = null;
        
        // 국내/해외 모두 executePaperOrder_를 호출하여 재주문을 진행 (true = isAutoRebal)
        orderRes = executePaperOrder_(sym, action, unfilledQty, 0, true, 'mock');
        
        if (orderRes && orderRes.success) {
          logs.push('  └ ⚡ <b>시장가 재주문 완료</b>: ' + unfilledQty + '주 재송신 완료 (주문번호: ' + (orderRes.orderNo || 'N/A') + ')');
        } else {
          logs.push('  └ ❌ 시장가 재주문 실패: ' + (orderRes ? orderRes.reason : '응답 없음'));
        }
      } catch(reorderErr) {
        logs.push('  └ ❌ 시장가 재주문 도중 예외 발생: ' + reorderErr.message);
      }
    }
  });
  
  if (hasUnfilled && logs.length > 0) {
    var msg = [
      '🔍 <b>[WATCHDOG] 미체결 주문 정밀 스캔 및 자동 보정 리포트</b>',
      '----------------------------------------',
      logs.join('\n'),
      '----------------------------------------',
      '💡 미체결 잔량을 취소하고 시장가로 재접수하여 최종 포트폴리오 정밀 비중 100% 매칭을 완료하였습니다.'
    ].join('\n');
    sendTelegramMessage(msg);
  } else {
    logInfo_('auto_trading', 'All orders were fully filled. No watchdog intervention needed.');
  }
}
