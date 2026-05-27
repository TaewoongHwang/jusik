function sendTelegramMessage(text) {
  var token = getScriptProperty_(AM_CONFIG.PROPERTY_KEYS.TELEGRAM_BOT_TOKEN, '');
  var chatId = getScriptProperty_(AM_CONFIG.PROPERTY_KEYS.TELEGRAM_CHAT_ID, '');
  
  if (!token || !chatId) {
    logWarn_('telegram', 'Telegram is not configured. Skipping message', { text: text });
    return false;
  }
  
  try {
    var url = 'https://api.telegram.org/bot' + token + '/sendMessage';
    var payload = {
      chat_id: chatId,
      text: text,
      parse_mode: 'HTML' // HTML 스타일 태그 지원
    };
    
    var response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    
    var resCode = response.getResponseCode();
    var resText = response.getContentText();
    
    if (resCode !== 200) {
      logWarn_('telegram', 'Telegram sendMessage API failed', {
        response_code: resCode,
        response_text: resText
      });
      return false;
    }
    
    try {
      var resJson = JSON.parse(resText);
      if (resJson.ok && resJson.result) {
        return resJson.result; // message 객체 반환 (message_id 확보용)
      }
    } catch (e) {}
    
    return true;
  } catch (err) {
    logWarn_('telegram', 'Telegram notification skipped due to execution error', {
      error: err.message || String(err),
      text: text
    });
    return false;
  }
}

function sendTelegramMessageWithMarkup(text, replyMarkup) {
  var token = getScriptProperty_(AM_CONFIG.PROPERTY_KEYS.TELEGRAM_BOT_TOKEN, '');
  var chatId = getScriptProperty_(AM_CONFIG.PROPERTY_KEYS.TELEGRAM_CHAT_ID, '');
  
  if (!token || !chatId) {
    logWarn_('telegram', 'Telegram is not configured. Skipping message with markup', { text: text });
    return false;
  }
  
  try {
    var url = 'https://api.telegram.org/bot' + token + '/sendMessage';
    var payload = {
      chat_id: chatId,
      text: text,
      parse_mode: 'HTML',
      reply_markup: replyMarkup
    };
    
    var response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    
    var resCode = response.getResponseCode();
    var resText = response.getContentText();
    
    if (resCode !== 200) {
      logWarn_('telegram', 'Telegram sendMessage with markup failed', {
        response_code: resCode,
        response_text: resText
      });
      return false;
    }
    
    try {
      var resJson = JSON.parse(resText);
      if (resJson.ok && resJson.result) {
        return resJson.result;
      }
    } catch (e) {}
    
    return true;
  } catch (err) {
    logWarn_('telegram', 'Telegram markup notification skipped due to execution error', {
      error: err.message || String(err),
      text: text
    });
    return false;
  }
}

function editTelegramMessageText_(messageId, text, replyMarkup) {
  var token = getScriptProperty_(AM_CONFIG.PROPERTY_KEYS.TELEGRAM_BOT_TOKEN, '');
  var chatId = getScriptProperty_(AM_CONFIG.PROPERTY_KEYS.TELEGRAM_CHAT_ID, '');
  
  if (!token || !chatId) return false;
  
  try {
    var url = 'https://api.telegram.org/bot' + token + '/editMessageText';
    var payload = {
      chat_id: chatId,
      message_id: messageId,
      text: text,
      parse_mode: 'HTML'
    };
    if (replyMarkup) {
      payload.reply_markup = replyMarkup;
    }
    
    var response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    
    var resCode = response.getResponseCode();
    if (resCode !== 200) {
      logWarn_('telegram', 'Telegram editMessageText API failed', {
        response_code: resCode,
        response_text: response.getContentText()
      });
      return false;
    }
    return true;
  } catch (err) {
    logWarn_('telegram', 'Telegram editMessageText error', { error: err.message });
    return false;
  }
}

function buildAiChatGroundingPrompt_(userQuestion) {
  var today = amTodayString_();
  var groundingData = [];
  
  // A) 시장 폭 정보
  try {
    var breadthRows = readObjects_(AM_CONFIG.SHEETS.MARKET_BREADTH_DAILY);
    if (breadthRows && breadthRows.length > 0) {
      breadthRows.sort(function(a, b) { return String(b.date).localeCompare(String(a.date)); });
      var b = breadthRows[0];
      groundingData.push('[최신 시장 폭(Market Breadth)]');
      groundingData.push('- 기준일: ' + normalizeDateValue_(b.date));
      groundingData.push('- 상승비율: ' + (Number(b.up_ratio || 0)*100).toFixed(1) + '%');
      groundingData.push('- 20일선 상회비율: ' + (Number(b.ma20_above_ratio || 0)*100).toFixed(1) + '%');
      groundingData.push('- 종합 점수: ' + b.breadth_score + '점');
      groundingData.push('- 메모: ' + (b.memo || '없음'));
      groundingData.push('');
    }
  } catch(e) {}
  
  // B) 주도주 TOP 5 정보
  try {
    var leaderRows = readObjects_(AM_CONFIG.SHEETS.LEADER_50);
    var todayLeaders = leaderRows.filter(function(row) { return normalizeDateValue_(row.date) === today; });
    if (todayLeaders.length === 0 && leaderRows.length > 0) {
      leaderRows.sort(function(a, b) { return String(b.date).localeCompare(String(a.date)); });
      var latestDate = leaderRows[0].date;
      todayLeaders = leaderRows.filter(function(row) { return row.date === latestDate; });
    }
    if (todayLeaders.length > 0) {
      groundingData.push('[최신 주도주 TOP 5 목록]');
      todayLeaders.slice(0, 5).forEach(function(row) {
        groundingData.push('- ' + row.rank + '위: ' + row.name + ' (' + normalizeStockSymbol_(row.symbol) + ') | 점수: ' + row.total_score + '점 | 리스크: ' + row.risk_level);
      });
      groundingData.push('');
    }
  } catch(e) {}
  
  // C) 뉴스 브리핑 정보
  try {
    var newsRows = readObjects_(AM_CONFIG.SHEETS.NEWS_BRIEFING);
    if (newsRows && newsRows.length > 0) {
      newsRows.sort(function(a, b) { return String(b.date).localeCompare(String(a.date)) || String(b.created_at).localeCompare(String(a.created_at)); });
      var n = newsRows[0];
      var summary = parseJsonCell_(n.summary_json, {});
      if (summary && summary.key_news) {
        groundingData.push('[최신 시장 뉴스 핵심 브리핑 요약]');
        groundingData.push('- 기준일: ' + normalizeDateValue_(n.date));
        var newsList = Array.isArray(summary.key_news) ? summary.key_news : Object.keys(summary.key_news);
        newsList.slice(0, 3).forEach(function(item) {
          if (typeof item === 'string') {
            groundingData.push('  • ' + item);
          } else if (item && item.topic) {
            groundingData.push('  • ' + item.topic + ': ' + (item.impact || ''));
          }
        });
        groundingData.push('');
      }
    }
  } catch(e) {}

  var prompt = [
    '당신은 한국 주식 및 자산운용 시장에 특화된 고성능 AI 개인 투자 비서입니다.',
    '다음은 우리 계좌 스캐너 시스템에서 수집된 가장 최신의 실제 시장 데이터 및 분석 리포트 내용입니다.',
    '사용자의 질문에 답할 때, 이 수집된 실제 데이터를 적극적으로 참조하여 그라운딩(Grounding)된 전문적이고 객관적인 답변을 작성해 주세요.',
    '',
    '[수집된 실시간 시장 및 분석 데이터]',
    groundingData.join('\n'),
    '',
    '[주의 및 필수 지침]',
    '- 사용자의 질문에 전문적이되 친근한 존댓말로 성실히 답해 주십시오.',
    '- 매수 추천이나 확실한 미래 예측성 발언("반드시 오릅니다", "무조건 사세요")은 투자자 보호 및 규정 준수를 위해 철저히 배제해 주십시오. 철저히 사실과 조건부 시나리오에 기반해야 합니다.',
    '- 답변은 너무 길지 않게 텔레그램 가독성을 고려하여 핵심 위주로 문단과 불릿포인트를 깔끔하게 정리해 주십시오. (HTML 형식 태그인 <b>, <i>, <code> 등을 지원하므로 필요시 가독성을 위해 적절히 활용 가능합니다.)',
    '',
    '[사용자의 질문]',
    userQuestion
  ].join('\n');
  
  return prompt;
}

function answerTelegramCallback_(queryId, text) {
  var token = getScriptProperty_(AM_CONFIG.PROPERTY_KEYS.TELEGRAM_BOT_TOKEN, '');
  if (!token) return false;
  
  try {
    var url = 'https://api.telegram.org/bot' + token + '/answerCallbackQuery';
    var payload = {
      callback_query_id: queryId,
      text: text || ''
    };
    
    var response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    
    var resCode = response.getResponseCode();
    if (resCode !== 200) {
      logWarn_('telegram', 'Telegram answerCallbackQuery failed', {
        response_code: resCode,
        response_text: response.getContentText()
      });
      return false;
    }
    return true;
  } catch (err) {
    logWarn_('telegram', 'Telegram answerCallbackQuery error', { error: err.message });
    return false;
  }
}

function generateIntradayRiskTip_(symbol, name, currentPrice, changePct, returnPct, alertType, breadthText) {
  try {
    var prompt = [
      '당신은 한국 주식 시장의 실시간 리스크 관리 전문가입니다.',
      '현재 특정 보유 종목에 실시간 가격 변동성 마일스톤 경보가 발생했습니다.',
      '다음 데이터를 바탕으로, 초보 투자자가 지금 즉시 취해야 할 1~2문장의 아주 짧고 명확한 한국어 리스크 관리 팁(리스크 회피, 익절/손절 원칙 준수 등)을 작성해 주세요.',
      '설명이 아닌, 바로 행동 지침 위주로 존댓말로 작성해 주세요. (예: "~하는 것이 안전합니다", "~를 점검하십시오")',
      '',
      '[경보 종목 정보]',
      '- 종목명: ' + name + ' (' + symbol + ')',
      '- 현재가: ' + currentPrice + '원',
      '- 당일 등락률: ' + changePct + '%',
      '- 평단 대비 수익률: ' + returnPct + '%',
      '- 경보 유형: ' + alertType,
      '',
      '[최신 시장 폭(Market Breadth) 현황]',
      breadthText,
      '',
      '가장 핵심적인 리스크 관리 행동 지침 1~2문장만 텍스트로 출력하세요. (JSON 형태 아님, 따옴표 없이 텍스트만 출력)'
    ].join('\n');
    
    var tip = callGeminiText_(prompt, {
      modelUseCase: 'intraday_alert',
      temperature: 0.7,
      maxOutputTokens: 256
    });
    return tip;
  } catch (err) {
    logWarn_('telegram_monitor', 'Failed to generate intraday risk tip with Gemini', { error: err.message });
    return '';
  }
}

function runTelegramTestConnection() {
  var token = getScriptProperty_(AM_CONFIG.PROPERTY_KEYS.TELEGRAM_BOT_TOKEN, '');
  var chatId = getScriptProperty_(AM_CONFIG.PROPERTY_KEYS.TELEGRAM_CHAT_ID, '');
  var ui = SpreadsheetApp.getUi();
  
  if (!token || !chatId) {
    ui.alert(
      '텔레그램 설정 미완료\n\n' +
      '설정 방법:\n' +
      '1. 확장 프로그램 > Apps Script 실행\n' +
      '2. 왼쪽 메뉴의 [톱니바퀴 (프로젝트 설정)] 선택\n' +
      '3. 화면 아래로 이동해 [스크립트 속성 편집] 클릭\n' +
      '4. 아래 2개 키와 발급값을 등록해 주세요:\n' +
      '   - TELEGRAM_BOT_TOKEN (예: 123456:ABC-DEF...)\n' +
      '   - TELEGRAM_CHAT_ID (예: 987654321)\n\n' +
      '* 봇 생성법: 텔레그램에서 @BotFather 검색 후 /newbot 입력\n' +
      '* 내 ID 확인: 텔레그램에서 @userinfobot 검색 후 대화 시작'
    );
    return;
  }
  
  var response = ui.alert(
    '텔레그램 연동 테스트',
    '설정된 봇 정보로 테스트 알림 메시지를 스마트폰으로 전송하시겠습니까?',
    ui.ButtonSet.YES_NO
  );
  
  if (response !== ui.Button.YES) return;
  
  var testMsg = '<b>[AI 스캐너 모바일 알림]</b>\n\n' +
    '🎉 텔레그램 실시간 알림봇 연동에 성공했습니다!\n' +
    '이 시간 이후부터 장전/장마감 요약 및 가상 체결(Paper Trading) 알림이 이 채팅방으로 즉시 발송됩니다.';
    
  var success = sendTelegramMessage(testMsg);
  
  if (success) {
    ui.alert('테스트 알림 전송 성공!\n\n스마트폰 텔레그램 메신저 방에 메시지가 정상 도착했는지 확인해 주세요.');
  } else {
    ui.alert('전송 실패\n\n토큰 또는 Chat ID가 올바른지 다시 확인하고 logs 시트의 telegram 오류 로그를 점검하세요.');
  }
}

// === 실시간 및 시간 연동 스마트 알림 기능 ===

function checkIntradayMonitors() {
  globalIsInteractiveContext_ = false;
  return withLogging_('telegram_monitor', function() {
    var today = amTodayString_();
    var calendar = getMarketCalendarSummary_(today);
    if (!calendar.kr_open) {
      logInfo_('telegram_monitor', 'Korean market is closed today; skipping intraday check', {});
      return;
    }
    
    // 영업 시간 확인 (09:00 - 15:45 KST)
    var now = new Date();
    var hours = now.getHours();
    var minutes = now.getMinutes();
    var currentTimeVal = hours * 100 + minutes;
    if (currentTimeVal < 850 || currentTimeVal > 1545) {
      logInfo_('telegram_monitor', 'Outside market hours; skipping check', { time: currentTimeVal });
      return;
    }
    
    // 당일 또는 가장 최신의 시장 폭(Market Breadth) 데이터 조회
    var breadthText = '시장 폭 정보 없음';
    try {
      var breadthRows = readObjects_(AM_CONFIG.SHEETS.MARKET_BREADTH_DAILY);
      if (breadthRows && breadthRows.length > 0) {
        breadthRows.sort(function(a, b) {
          return String(b.date).localeCompare(String(a.date));
        });
        var latestBreadth = breadthRows[0];
        breadthText = '기준일: ' + normalizeDateValue_(latestBreadth.date) + 
                      ', 시장: ' + latestBreadth.market +
                      ', 상승종목비율: ' + (Number(latestBreadth.up_ratio || 0) * 100).toFixed(1) + '%' +
                      ', 20일선상회비율: ' + (Number(latestBreadth.ma20_above_ratio || 0) * 100).toFixed(1) + '%' +
                      ', 시장폭점수: ' + latestBreadth.breadth_score + '점' +
                      ', 메모: ' + (latestBreadth.memo || '없음');
      }
    } catch (breadthErr) {
      logWarn_('telegram_monitor', 'Failed to fetch market breadth for intraday alert. Proceeding with default text.', { error: breadthErr.message });
    }
    
    // ==========================================
    // 📢 [고도화 4번] 시장 지수 및 Surge Dampener (돌파 감쇠기) 판별
    // ==========================================
    var indexDampenerState = 'NORMAL'; // NORMAL, WARNING, MUTE
    var dampenerMsgSuffix = '';
    var indexDetailText = '';
    
    try {
      var kosdaqQuote = fetchKisCurrentPrice_('2001'); // 코스닥 종합지수
      var kosdaqChange = Number(kosdaqQuote.change_pct || 0);
      
      var kospiQuote = fetchKisCurrentPrice_('0001'); // 코스피 종합지수
      var kospiChange = Number(kospiQuote.change_pct || 0);
      
      indexDetailText = ' (코스피 ' + (kospiChange > 0 ? '+' : '') + kospiChange.toFixed(2) + '%, 코스닥 ' + (kosdaqChange > 0 ? '+' : '') + kosdaqChange.toFixed(2) + '%)';
      
      var minChange = Math.min(kosdaqChange, kospiChange);
      
      if (minChange <= -2.5) {
        indexDampenerState = 'MUTE';
      } else if (minChange <= -1.5) {
        indexDampenerState = 'WARNING';
        dampenerMsgSuffix = '\n\n⚠️ <b>[시장 폭락 경보]</b> 현재 지수' + indexDetailText + '가 -1.5% 이하 대폭락 중입니다. 속임수 돌파(Fakeout) 가능성이 극도로 높은 시장 투매 장세이므로 신규 진입 시 반드시 극소 비중 유지 및 분할 매수로 대응하세요!';
      }
    } catch(err) {
      logWarn_('telegram_monitor', 'Failed to fetch stock index for Surge Dampener. Proceeding normally.', { error: err.message });
    }
    
    if (indexDampenerState === 'MUTE') {
      var cacheKeyPanicMute = 'TG_SENT_PANIC_MUTE_' + today;
      if (getScriptProperty_(cacheKeyPanicMute, '') !== 'Y') {
        var panicMsg = [
          '🚨 <b>[긴급: 시장 패닉셀 도달 / 돌파 감시 음소거]</b>',
          '국내 종합 지수가 -2.5% 이하 패닉셀 상태에 도달했습니다.' + indexDetailText,
          '',
          '알고리즘의 자산 보호 및 리스크 원천 회피를 위해, <b>오늘의 모든 실시간 장중 돌파 속보 알림을 자동으로 음소거(Mute) 처리</b>합니다.',
          '뇌동매매 진입을 전면 보류하시고 안전하게 관망하며 보수적인 리스크 관리를 유지하세요.'
        ].join('\n');
        sendTelegramMessage(panicMsg);
        setScriptProperty_(cacheKeyPanicMute, 'Y');
      }
      // 돌파 속보 알림 감시를 건너뛰지만, 보유 주식의 손절 탈출(invalid_price) 감시는 생존 직결이므로 계속 가동하도록 하단 보유주식 감시는 실행함
    }
    
    // ==========================================
    // 📢 [고도화 3번] 장중 돌파 알림 대상 목록 빌드 (장전계획 TOP 5 + 텔레그램 수동 추가 watchlist)
    // ==========================================
    var plans = readObjects_(AM_CONFIG.SHEETS.ENTRY_PLAN).filter(function(row) {
      return normalizeDateValue_(row.date) === today;
    });
    
    var monitorMap = {};
    // A) 장전 수립 계획 중 상위 5종목 자동 편입
    plans.slice(0, 5).forEach(function(p) {
      var sym = normalizeStockSymbol_(p.symbol);
      monitorMap[sym] = {
        symbol: sym,
        name: p.name,
        breakout_price: Number(p.breakout_price || 0)
      };
    });
    
    // B) 텔레그램 `/add`로 모바일 추가한 커스텀 관심 목록 병합
    var watchlistStr = getScriptProperty_('TG_USER_WATCHLIST', '');
    var watchlist = watchlistStr ? watchlistStr.split(',') : [];
    
    watchlist.forEach(function(sym) {
      sym = normalizeStockSymbol_(sym);
      if (!sym) return;
      if (monitorMap[sym]) return; // 이미 있으면 패스
      
      var name = '';
      var pMatch = plans.filter(function(x) { return normalizeStockSymbol_(x.symbol) === sym; });
      if (pMatch.length > 0) name = pMatch[0].name || '';
      
      if (!name) {
        var candidates = readObjects_(AM_CONFIG.SHEETS.LEADER_CANDIDATES);
        var candMatch = candidates.filter(function(c) { return normalizeStockSymbol_(c.symbol) === sym; });
        if (candMatch.length > 0) name = candMatch[0].name || '';
      }
      
      if (!name) name = '원격 감시주';
      
      var bPrice = 0;
      if (pMatch.length > 0) {
        bPrice = Number(pMatch[0].breakout_price || 0);
      } else {
        try {
          var currentQuote = fetchKisCurrentPrice_(sym);
          bPrice = Math.round(currentQuote.close * 1.05); // 매칭 계획 없으면 당일 +5% 자동 계산 적용
          Utilities.sleep(120);
        } catch(e) {
          bPrice = 0;
        }
      }
      
      monitorMap[sym] = {
        symbol: sym,
        name: name,
        breakout_price: bPrice
      };
    });
    
    var finalMonitorList = Object.keys(monitorMap).map(function(k) { return monitorMap[k]; });
    
    // 1. 장중 돌파 검사 (음소거 상태가 아닐 때만 작동)
    if (indexDampenerState !== 'MUTE') {
      finalMonitorList.forEach(function(p) {
        var symbol = p.symbol;
        var cacheKey = 'TG_SENT_BREAKOUT_' + today + '_' + symbol;
        if (getScriptProperty_(cacheKey, '') === 'Y') return;
        
        try {
          var quote = fetchKisCurrentPrice_(symbol);
          var currentPrice = Number(quote.close);
          var breakoutPrice = Number(p.breakout_price || 0);
          
          if (breakoutPrice > 0 && currentPrice >= breakoutPrice) {
            var msg = [
              '🔥 <b>[장중 실시간 주도주 돌파 속보]</b>',
              '종목명: <b>' + p.name + '</b> (' + symbol + ')',
              '현재가: ' + formatNumber_(currentPrice) + ' 원',
              '목표 돌파가: ' + formatNumber_(breakoutPrice) + ' 원',
              '설명: 오늘의 핵심 돌파가 저항선을 강력하게 상향 돌파하고 있습니다! 실시간 수급 및 체결 거래대금을 점검해 보세요.' + dampenerMsgSuffix,
              '일시: ' + amNowString_()
            ].join('\n');
            sendTelegramMessage(msg);
            setScriptProperty_(cacheKey, 'Y');
            Utilities.sleep(150);
          }
        } catch(e) {
          logWarn_('telegram_monitor', 'Failed intraday quote fetch for breakout check', { symbol: symbol, error: e.message });
        }
      });
    }
    
    // ==========================================
    // 📢 [고도화 1번] 보유 종목 수집 (실계좌 KIS 동기화 우선 시도 -> 실패/미등록 시 모의 투자 백업 플랜)
    // ==========================================
    var positions = [];
    var isRealAccount = false;
    
    try {
      var portMode = getScriptProperty_(AM_CONFIG.PROPERTY_KEYS.PORTFOLIO_MODE, 'real');
      var isRealAccountMode = (portMode === 'real' && !!getScriptProperty_(AM_CONFIG.PROPERTY_KEYS.KIS_CANO, ''));
      
      if (isRealAccountMode) {
        // A) 실계좌 KIS 국내 잔고 로드
        var balResponse = fetchKisDomesticAccountBalance_();
        var normalizedBal = normalizeKisAccountBalance_(balResponse);
        if (normalizedBal && normalizedBal.holdings) {
          positions = normalizedBal.holdings.map(function(h) {
            return {
              symbol: h.symbol,
              name: h.name,
              quantity: h.quantity,
              entry_price: h.avg_price,
              current_price: h.current_price,
              profit_loss_pct: h.profit_loss_pct
            };
          });
          isRealAccount = true;
        }
        
        // B) 해외계좌 KIS 잔고 로드 및 병합
        try {
          var ovrResponse = fetchKisOverseasAccountBalance_();
          var normalizedOvr = normalizeKisOverseasAccountBalance_(ovrResponse);
          if (normalizedOvr && normalizedOvr.holdings) {
            normalizedOvr.holdings.forEach(function(h) {
              var isDup = positions.some(function(p) { return p.symbol.toLowerCase() === h.symbol.toLowerCase(); });
              if (!isDup) {
                positions.push({
                  symbol: h.symbol,
                  name: h.name,
                  quantity: h.quantity,
                  entry_price: h.avg_price,
                  current_price: h.current_price,
                  profit_loss_pct: h.profit_loss_pct
                });
              }
            });
          }
        } catch(ovrErr) {
          logWarn_('telegram_monitor', 'Failed overseas KIS balance sync in monitor', { error: ovrErr.message });
        }
        
        // C) 수동 보유종목 (manual_holdings) 로드 및 병합
        try {
          var today = amTodayString_();
          var manualRows = getActiveManualHoldingRows_();
          manualRows.forEach(function(mRow) {
            var mPos = normalizeManualHoldingRow_(today, mRow);
            if (!mPos || !mPos.symbol || mPos.quantity <= 0) return;
            
            var isDup = positions.some(function(p) { return p.symbol.toLowerCase() === mPos.symbol.toLowerCase(); });
            if (!isDup) {
              positions.push({
                symbol: mPos.symbol,
                name: mPos.name || mPos.symbol,
                quantity: mPos.quantity,
                entry_price: mPos.avg_price,
                current_price: mPos.current_price,
                profit_loss_pct: mPos.profit_loss_pct
              });
            }
          });
        } catch(manualErr) {
          logWarn_('telegram_monitor', 'Failed to merge manual holdings in monitor', { error: manualErr.message });
        }
        
        logInfo_('telegram_monitor', 'Successfully synchronized active holdings from Real Account (KIS + Manual)', { count: positions.length });
      }
    } catch(err) {
      logWarn_('telegram_monitor', 'Failed real KIS balance sync inside monitor; falling back to paper portfolio', { error: err.message });
    }
    
    if (positions.length === 0) {
      var latestRow = getLatestPaperPortfolioRow_();
      if (latestRow) {
        try {
          positions = JSON.parse(latestRow.active_positions_json || '[]').map(function(p) {
            return {
              symbol: p.symbol,
              name: p.name,
              quantity: p.quantity,
              entry_price: p.entry_price,
              current_price: p.current_price,
              profit_loss_pct: p.return_pct
            };
          });
          logInfo_('telegram_monitor', 'Synchronized holdings from Paper Portfolio backup', { count: positions.length });
        } catch(e) {
          positions = [];
        }
      }
    }
    
    // 2. 보유 종목 손절선 근접, 이탈 및 급등락/수익률 마일스톤 실시간 경보
    positions.forEach(function(pos) {
      var symbol = normalizeStockSymbol_(pos.symbol);
      
      try {
        var quote = fetchKisCurrentPrice_(symbol);
        var currentPrice = Number(quote.close);
        var changePct = Number(quote.change_pct || 0); // 당일 전일 대비 등락률
        
        var entryPrice = Number(pos.entry_price || 0);
        var returnPct = entryPrice > 0 ? Number(((currentPrice - entryPrice) / entryPrice * 100).toFixed(2)) : 0;
        
        // === [A] 당일 급등락(Surge/Plunge) 감시 ===
        // 1) 당일 급등 (+5%, +10%)
        if (changePct >= 10) {
          var cacheKeySurge10 = 'TG_SENT_SURGE_10_' + today + '_' + symbol;
          if (getScriptProperty_(cacheKeySurge10, '') !== 'Y') {
            var msgSurge10 = [
              '🚀 <b>[보유 종목 초급등 감지]</b>',
              '종목명: <b>' + pos.name + '</b> (' + symbol + ')',
              '현재가: ' + formatNumber_(currentPrice) + ' 원',
              '당일 등락률: <b>+' + changePct + '%</b> (전일 대비)',
              '설명: 당일 거래대금과 수급을 폭발시키며 10% 이상 대급등 중입니다! 실시간 호가 및 기사 뉴스를 확인해보세요.'
            ].join('\n');
            var tip = generateIntradayRiskTip_(symbol, pos.name, currentPrice, changePct, returnPct, '당일 10% 이상 초급등', breadthText);
            if (tip) msgSurge10 += '\n\n💡 <b>[AI 리스크 관리 팁]</b>\n' + tip;
            sendTelegramMessage(msgSurge10);
            setScriptProperty_(cacheKeySurge10, 'Y');
            Utilities.sleep(150);
          }
        } else if (changePct >= 5) {
          var cacheKeySurge5 = 'TG_SENT_SURGE_5_' + today + '_' + symbol;
          if (getScriptProperty_(cacheKeySurge5, '') !== 'Y') {
            var msgSurge5 = [
              '🔥 <b>[보유 종목 급등 감지]</b>',
              '종목명: <b>' + pos.name + '</b> (' + symbol + ')',
              '현재가: ' + formatNumber_(currentPrice) + ' 원',
              '당일 등락률: <b>+' + changePct + '%</b> (전일 대비)',
              '설명: 주가가 강력한 매수세와 함께 전일 대비 5% 이상 상승 돌파하고 있습니다!'
            ].join('\n');
            var tip = generateIntradayRiskTip_(symbol, pos.name, currentPrice, changePct, returnPct, '당일 5% 이상 급등', breadthText);
            if (tip) msgSurge5 += '\n\n💡 <b>[AI 리스크 관리 팁]</b>\n' + tip;
            sendTelegramMessage(msgSurge5);
            setScriptProperty_(cacheKeySurge5, 'Y');
            Utilities.sleep(150);
          }
        }
        
        // 2) 당일 급락 (-5%, -10%)
        if (changePct <= -10) {
          var cacheKeyPlunge10 = 'TG_SENT_PLUNGE_10_' + today + '_' + symbol;
          if (getScriptProperty_(cacheKeyPlunge10, '') !== 'Y') {
            var msgPlunge10 = [
              '🚨 <b>[보유 종목 폭락 긴급 경보]</b>',
              '종목명: <b>' + pos.name + '</b> (' + symbol + ')',
              '현재가: ' + formatNumber_(currentPrice) + ' 원',
              '당일 등락률: <b>' + changePct + '%</b> (전일 대비)',
              '설명: 전일 대비 -10% 이상 하락세가 깊어지고 있습니다. 돌발 악재 유무와 주요 지지선을 긴급 점검하십시오.'
            ].join('\n');
            var tip = generateIntradayRiskTip_(symbol, pos.name, currentPrice, changePct, returnPct, '당일 -10% 이상 폭락', breadthText);
            if (tip) msgPlunge10 += '\n\n💡 <b>[AI 리스크 관리 팁]</b>\n' + tip;
            sendTelegramMessage(msgPlunge10);
            setScriptProperty_(cacheKeyPlunge10, 'Y');
            Utilities.sleep(150);
          }
        } else if (changePct <= -5) {
          var cacheKeyPlunge5 = 'TG_SENT_PLUNGE_5_' + today + '_' + symbol;
          if (getScriptProperty_(cacheKeyPlunge5, '') !== 'Y') {
            var msgPlunge5 = [
              '⚠️ <b>[보유 종목 급락 주의보]</b>',
              '종목명: <b>' + pos.name + '</b> (' + symbol + ')',
              '현재가: ' + formatNumber_(currentPrice) + ' 원',
              '당일 등락률: <b>' + changePct + '%</b> (전일 대비)',
              '설명: 주가가 전일 대비 -5% 이하로 밀리며 하방 압력이 거세지고 있습니다.'
            ].join('\n');
            var tip = generateIntradayRiskTip_(symbol, pos.name, currentPrice, changePct, returnPct, '당일 -5% 이하 급락', breadthText);
            if (tip) msgPlunge5 += '\n\n💡 <b>[AI 리스크 관리 팁]</b>\n' + tip;
            sendTelegramMessage(msgPlunge5);
            setScriptProperty_(cacheKeyPlunge5, 'Y');
            Utilities.sleep(150);
          }
        }
        
        // === [B] 평단가 대비 수익률 마일스톤 감시 ===
        if (entryPrice > 0) {
          // 1) 수익 마일스톤 (+5%, +10%) -> 익절 대응 유도
          if (returnPct >= 10) {
            var cacheKeyProfit10 = 'TG_SENT_PROFIT_10_' + today + '_' + symbol;
            if (getScriptProperty_(cacheKeyProfit10, '') !== 'Y') {
              var msgProfit10 = [
                '💰 <b>[보유 수익률 경보: +10% 달성]</b>',
                '종목명: <b>' + pos.name + '</b> (' + symbol + ')',
                '현재가: ' + formatNumber_(currentPrice) + ' 원 | 평단가: ' + formatNumber_(entryPrice) + ' 원',
                '현재 수익률: <b>+' + returnPct + '%</b> 🎉',
                '설명: 평단 대비 +10% 이상 두 자릿수 수익권에 진입했습니다! 분할 익절 등을 통해 수익 확정을 고려해 보세요.'
              ].join('\n');
              var tip = generateIntradayRiskTip_(symbol, pos.name, currentPrice, changePct, returnPct, '평단 대비 +10% 수익 달성', breadthText);
              if (tip) msgProfit10 += '\n\n💡 <b>[AI 리스크 관리 팁]</b>\n' + tip;
              sendTelegramMessage(msgProfit10);
              setScriptProperty_(cacheKeyProfit10, 'Y');
              Utilities.sleep(150);
            }
          } else if (returnPct >= 5) {
            var cacheKeyProfit5 = 'TG_SENT_PROFIT_5_' + today + '_' + symbol;
            if (getScriptProperty_(cacheKeyProfit5, '') !== 'Y') {
              var msgProfit5 = [
                '✨ <b>[보유 수익률 알림: +5% 돌파]</b>',
                '종목명: <b>' + pos.name + '</b> (' + symbol + ')',
                '현재가: ' + formatNumber_(currentPrice) + ' 원 | 평단가: ' + formatNumber_(entryPrice) + ' 원',
                '현재 수익률: <b>+' + returnPct + '%</b>',
                '설명: 평단 대비 +5% 이상 순항 중입니다. 수익 보존을 위해 트레이드 전략을 점검하세요.'
              ].join('\n');
              var tip = generateIntradayRiskTip_(symbol, pos.name, currentPrice, changePct, returnPct, '평단 대비 +5% 수익 돌파', breadthText);
              if (tip) msgProfit5 += '\n\n💡 <b>[AI 리스크 관리 팁]</b>\n' + tip;
              sendTelegramMessage(msgProfit5);
              setScriptProperty_(cacheKeyProfit5, 'Y');
              Utilities.sleep(150);
            }
          }
          
          // 2) 손실 마일스톤 (-3%, -5%) -> 조기 리스크 관리
          if (returnPct <= -5) {
            var cacheKeyLoss5 = 'TG_SENT_LOSS_5_' + today + '_' + symbol;
            if (getScriptProperty_(cacheKeyLoss5, '') !== 'Y') {
              var msgLoss5 = [
                '⚡ <b>[보유 리스크 경보: -5% 도달]</b>',
                '종목명: <b>' + pos.name + '</b> (' + symbol + ')',
                '현재가: ' + formatNumber_(currentPrice) + ' 원 | 평단가: ' + formatNumber_(entryPrice) + ' 원',
                '현재 수익률: <b>' + returnPct + '%</b> 🔴',
                '설명: 평단 대비 손실률이 -5%에 달했습니다. 원칙적인 리스크 관리 및 추가 진입 계획 무효화 여부를 냉정히 확인하세요.'
              ].join('\n');
              var tip = generateIntradayRiskTip_(symbol, pos.name, currentPrice, changePct, returnPct, '평단 대비 -5% 손실 도달', breadthText);
              if (tip) msgLoss5 += '\n\n💡 <b>[AI 리스크 관리 팁]</b>\n' + tip;
              sendTelegramMessage(msgLoss5);
              setScriptProperty_(cacheKeyLoss5, 'Y');
              Utilities.sleep(150);
            }
          } else if (returnPct <= -3) {
            var cacheKeyLoss3 = 'TG_SENT_LOSS_3_' + today + '_' + symbol;
            if (getScriptProperty_(cacheKeyLoss3, '') !== 'Y') {
              var msgLoss3 = [
                '📉 <b>[보유 리스크 알림: -3% 하락]</b>',
                '종목명: <b>' + pos.name + '</b> (' + symbol + ')',
                '현재가: ' + formatNumber_(currentPrice) + ' 원 | 평단가: ' + formatNumber_(entryPrice) + ' 원',
                '현재 수익률: <b>' + returnPct + '%</b>',
                '설명: 평단 대비 -3% 수준으로 밀리고 있습니다. 단기 지지라인 붕괴 여부를 확인해 보세요.'
              ].join('\n');
              var tip = generateIntradayRiskTip_(symbol, pos.name, currentPrice, changePct, returnPct, '평단 대비 -3% 손실 하락', breadthText);
              if (tip) msgLoss3 += '\n\n💡 <b>[AI 리스크 관리 팁]</b>\n' + tip;
              sendTelegramMessage(msgLoss3);
              setScriptProperty_(cacheKeyLoss3, 'Y');
              Utilities.sleep(150);
            }
          }
        }
        
        // === [C] 기존 계획서(entry_plan) 기반 손절선 근접 및 이탈 감시 ===
        var plan = plans.filter(function(p) {
          return normalizeStockSymbol_(p.symbol) === symbol;
        })[0];
        
        if (plan) {
          var invalidPrice = Number(plan.invalid_price || 0);
          if (invalidPrice > 0) {
            var cacheKeyWarning = 'TG_SENT_WARN_' + today + '_' + symbol;
            var cacheKeyExit = 'TG_SENT_EXIT_WARN_' + today + '_' + symbol;
            
            // 1) 이탈 위험 경보 (손절가 근접 2% 이내)
            if (currentPrice > invalidPrice && currentPrice <= invalidPrice * 1.02 && getScriptProperty_(cacheKeyWarning, '') !== 'Y') {
              var msgWarn = [
                '⚠️ <b>[보유 포지션 위험 경보: 손절선 임박]</b>',
                '종목명: <b>' + pos.name + '</b> (' + symbol + ')',
                '현재가: ' + formatNumber_(currentPrice) + ' 원',
                '지정 손절가: ' + formatNumber_(invalidPrice) + ' 원 (이격 2% 이내)',
                '설명: 주가가 설정해 둔 가격 계획 무효화 지지선에 바짝 다가서고 있습니다. 보수적인 리스크 관리를 준비하세요.'
              ].join('\n');
              var tip = generateIntradayRiskTip_(symbol, pos.name, currentPrice, changePct, returnPct, '손절 지정가 2% 이내 임박', breadthText);
              if (tip) msgWarn += '\n\n💡 <b>[AI 리스크 관리 팁]</b>\n' + tip;
              sendTelegramMessage(msgWarn);
              setScriptProperty_(cacheKeyWarning, 'Y');
              Utilities.sleep(150);
            }
            
            // 2) 지지선 이탈 경보 (손절선 하회)
            if (currentPrice <= invalidPrice && getScriptProperty_(cacheKeyExit, '') !== 'Y') {
              var msgExit = [
                '🚨 <b>[보유 포지션 손절선 최종 이탈 경보]</b>',
                '종목명: <b>' + pos.name + '</b> (' + symbol + ')',
                '현재가: ' + formatNumber_(currentPrice) + ' 원',
                '지정 손절가: ' + formatNumber_(invalidPrice) + ' 원 (이탈 발생 🔴)',
                '설명: 오늘의 가격 계획 지지선(무효화 가격)을 최종 하회 돌파했습니다. 원칙에 의거해 가상 투자 청산 준비 및 손실 제한 조치를 취하시기 바랍니다.'
              ].join('\n');
              var tip = generateIntradayRiskTip_(symbol, pos.name, currentPrice, changePct, returnPct, '손절 지정가 최종 이탈', breadthText);
              if (tip) msgExit += '\n\n💡 <b>[AI 리스크 관리 팁]</b>\n' + tip;
              sendTelegramMessage(msgExit);
              setScriptProperty_(cacheKeyExit, 'Y');
              Utilities.sleep(150);
            }
          }
        }
      } catch(e) {
        logWarn_('telegram_monitor', 'Failed intraday quote fetch for volatility warning', { symbol: symbol, error: e.message });
      }
    });
  });
}

function checkIntradayInvestorFlow() {
  globalIsInteractiveContext_ = false;
  return withLogging_('telegram_flow_monitor', function() {
    var today = amTodayString_();
    var calendar = getMarketCalendarSummary_(today);
    if (!calendar.kr_open) return;
    
    var plans = readObjects_(AM_CONFIG.SHEETS.ENTRY_PLAN).filter(function(row) {
      return normalizeDateValue_(row.date) === today;
    });
    
    if (plans.length === 0) return;
    
    var flowLines = [];
    plans.slice(0, 5).forEach(function(p) {
      var symbol = normalizeStockSymbol_(p.symbol);
      try {
        var response = kisGet_('/uapi/domestic-stock/v1/quotations/inquire-investor', {
          FID_COND_MRKT_DIV_CODE: 'J',
          FID_INPUT_ISCD: symbol
        }, 'FHKST01010900');
        
        var output = response.output || response;
        if (output) {
          var foreignQty = Number(output.frgn_ntby_qty || 0);
          var instQty = Number(output.orgn_ntby_qty || 0);
          
          if (foreignQty > 0 || instQty > 0) {
            var detail = [];
            if (foreignQty > 0) detail.push('외인 +' + formatNumber_(foreignQty) + '주');
            if (instQty > 0) detail.push('기관 +' + formatNumber_(instQty) + '주');
            
            if (detail.length > 0) {
              flowLines.push('• <b>' + p.name + '</b> (' + symbol + '): ' + detail.join(' | '));
            }
          }
        }
        Utilities.sleep(150);
      } catch(e) {
        logWarn_('telegram_flow_monitor', 'Failed to fetch intraday investor flow', { symbol: symbol, error: e.message });
      }
    });
    
    if (flowLines.length > 0) {
      var msg = [
        '📈 <b>[장중 13:40 주도주 외인/기관 수급 잠정 집계]</b>',
        '현재 핵심 진입 후보군에 세력들의 잠정 순매수 자금이 포착되고 있습니다.',
        '',
        flowLines.join('\n'),
        '',
        '<i>* 잠정 수급 집계이므로 장 마감 후 최종 집계에서 변동될 수 있습니다.</i>'
      ].join('\n');
      sendTelegramMessage(msg);
    }
  });
}

function checkOvernightUsMarket() {
  globalIsInteractiveContext_ = false;
  return withLogging_('telegram_overnight', function() {
    var today = amTodayString_();
    
    try {
      collectMacroRaw();
    } catch(e) {
      logWarn_('telegram_overnight', 'Overnight macro collection failed; checking existing rows', { error: e.message });
    }
    
    var macroRows = readObjects_(AM_CONFIG.SHEETS.MACRO_RAW);
    if (macroRows.length === 0) return;
    
    macroRows.sort(function(a, b) {
      return String(b.date).localeCompare(String(a.date)) || Number(b.timestamp || 0) - Number(a.timestamp || 0);
    });
    
    var latestDate = macroRows[0].date;
    var currentMacro = macroRows.filter(function(row) {
      return row.date === latestDate;
    });
    
    var nasdaqChange = 0;
    var sp500Change = 0;
    var us10y = '';
    var fxRate = '';
    
    currentMacro.forEach(function(m) {
      var name = String(m.name).toLowerCase();
      var pct = Number(m.change_pct || 0);
      var val = String(m.value || '');
      
      if (name.indexOf('nasdaq') >= 0 || name.indexOf('나스닥') >= 0) nasdaqChange = pct;
      if (name.indexOf('s&p') >= 0 || name.indexOf('sp500') >= 0) sp500Change = pct;
      if (name.indexOf('10년') >= 0 || name.indexOf('10y') >= 0) us10y = val;
      if (name.indexOf('환율') >= 0 || name.indexOf('fx') >= 0 || name.indexOf('원달러') >= 0) fxRate = val;
    });
    
    var isNasdaqShift = Math.abs(nasdaqChange) >= 1.5;
    var nasdaqSign = nasdaqChange > 0 ? '📈' : '📉';
    var nasdaqColorSign = nasdaqChange > 0 ? '+' : '';
    
    var msg = [
      '<b>🇺🇸 [오전 06:30 야간 미 증시 변동 요약 보고]</b>',
      '수집 기준일: ' + latestDate,
      '',
      nasdaqSign + ' <b>나스닥 종합</b>: ' + nasdaqColorSign + nasdaqChange.toFixed(2) + '%',
      '📊 <b>S&P 500</b>: ' + (sp500Change > 0 ? '+' : '') + sp500Change.toFixed(2) + '%',
      '💵 <b>원/달러 환율</b>: ' + (fxRate ? fxRate + ' 원' : '정보 없음'),
      '🔌 <b>미 국채 10년물 금리</b>: ' + (us10y ? us10y + '%' : '정보 없음'),
      '',
      isNasdaqShift ? '📢 <b>[핵심 알림] 나스닥 지수가 1.5% 이상 급등락했습니다.</b> 오늘 한국 시장 개장 시 시초가 변동성이 매우 커질 수 있으므로 차분히 계획된 무효화 가격과 매매 비중을 다시 확인하세요!' : '📢 미 증시 변동폭이 차분한 수준입니다. 오늘 국내 장 개시도 정상 범위 내에서 시작될 것으로 전망됩니다.'
    ].join('\n');
    
    sendTelegramMessage(msg);
  });
}
