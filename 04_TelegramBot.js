// ==================================================
// 🚀 텔레그램 API 연동 및 메세지 전송 모듈
// ==================================================

function sendTelegramMessage(text, replyMarkup) {
  var token = getRequiredScriptProperty_(AM_CONFIG.PROPERTY_KEYS.TELEGRAM_BOT_TOKEN);
  var chatId = getRequiredScriptProperty_(AM_CONFIG.PROPERTY_KEYS.TELEGRAM_CHAT_ID);
  var url = 'https://api.telegram.org/bot' + token + '/sendMessage';
  
  var payload = {
    chat_id: chatId,
    text: escapeTelegramHtml_(text),
    parse_mode: 'HTML',
    disable_web_page_preview: true
  };
  
  if (replyMarkup) {
    payload.reply_markup = replyMarkup;
  } else {
    // 💡 [자율 비주얼 강화] 버튼형 리스트 메뉴 상시 탑재 안전망
    payload.reply_markup = {
      keyboard: [
        [{ text: '📊 실시간 자산 조회 (Holdings)' }, { text: '⚙️ 실시간 퀀트 분석 (Quant)' }],
        [{ text: '📈 거시경제 & AI 리포트 (Macro)' }, { text: '🛠️ 자동화 트리거 설치 (Install)' }],
        [{ text: '🔄 투자 운용모드 전환 (Mode)' }, { text: '❓ 도움말 및 사용법 (Help)' }]
      ],
      resize_keyboard: true,
      one_time_keyboard: false
    };
  }
  
  var response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  
  return JSON.parse(response.getContentText());
}

// 텔레그램 고정 명령어 메뉴판 등록용 함수 (onOpen 등에서 최초 기동 가능)
function setTelegramCommands() {
  var token = getRequiredScriptProperty_(AM_CONFIG.PROPERTY_KEYS.TELEGRAM_BOT_TOKEN);
  var url = 'https://api.telegram.org/bot' + token + '/setMyCommands';
  
  var payload = {
    commands: [
      { command: 'start', description: '챗봇 시작 및 도움말 안내' },
      { command: 'help', description: '주식 챗봇 주요 명령어 설명' },
      { command: 'dashboard', description: '📊 실시간 대시보드 (TMA) 열기 바로가기' },
      { command: 'holdings', description: '실시간 통합 보유 자산 조회 (/잔고)' },
      { command: 'macro', description: '거시경제 & AI 융합 자산 리포트 조회 (/리포트)' },
      { command: 'quant', description: '⚙️ 실시간 VAA 자산배분 및 팩터 랭킹 조회 (/퀀트)' },
      { command: 'clearall', description: '모든 수동 등록 자산 일괄 청산' },
      { command: 'mode', description: '투자 모드(REAL/PAPER) 전환' },
      { command: 'install', description: '장전/장후 AI 리포트 자동화 스케줄러 설치' },
      { command: 'install_triggers', description: '장전/장후 AI 리포트 자동화 스케줄러 설치' }
    ]
  };
  
  UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload)
  });
}


// ==================================================
// 🚀 텔레그램 챗봇 명령어 수신 라우터 (Webhook WebAPI)
// ==================================================

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return HtmlService.createHtmlOutput('No post data');
    }
    
    var update = JSON.parse(e.postData.contents);
    if (!update.message || !update.message.text) {
      return HtmlService.createHtmlOutput('OK');
    }
    
    var text = String(update.message.text).trim();
    var chatId = String(update.message.chat.id);
    
    // 💡 [자율 매핑 안전망] 텔레그램 리스트형 퀵버튼 터치 시 내부 명령어로 완벽 강제 치환
    if (text.indexOf('📊 실시간 자산 조회') >= 0 || text === '자산조회') {
      text = '/holdings';
    } else if (text.indexOf('📈 거시경제 & AI 리포트') >= 0 || text === '리포트') {
      text = '/macro';
    } else if (text.indexOf('🔄 투자 운용모드 전환') >= 0 || text === '모드전환') {
      text = '/mode';
    } else if (text.indexOf('❓ 도움말 및 사용법') >= 0 || text === '도움말') {
      text = '/help';
    } else if (text.indexOf('⚙️ 실시간 퀀트 분석') >= 0 || text === '퀀트') {
      text = '/quant';
    } else if (text.indexOf('🛠️ 자동화 트리거 설치') >= 0 || text === '설치' || text === '인스톨') {
      text = '/install_triggers';
    }
    
    // 타인의 무단 접근 방어 차단선
    var expectedChatId = getRequiredScriptProperty_(AM_CONFIG.PROPERTY_KEYS.TELEGRAM_CHAT_ID);
    if (chatId !== expectedChatId) {
      logWarn_('telegram_security', 'Unauthorized Chat ID blocked', {
        received_chat_id: chatId,
        expected_chat_id: expectedChatId,
        text: text
      });
      return HtmlService.createHtmlOutput('Unauthorized');
    }
    
    var command = text.split(' ')[0].toLowerCase();
    
    if (command === '/start' || command === '/help') {
      try {
        setTelegramMenuButton();
        installAutomationTriggers();
      } catch(me) {
        logWarn_('telegram_bot', 'Failed to auto-set menu button or triggers on start', { error: me.message });
      }
      
      var welcome = [
        '🤖 <b>JUSIK AI 챗봇 통합 포트폴리오 관제센터</b>',
        '',
        '실시간 KIS 계좌 및 가상 모의투자 자산을 1원 단위까지 정밀 제어하는 명품 챗봇 서비스입니다.',
        '',
        '📊 <b>자산 모니터링:</b>',
        '• <code>/holdings</code> 또는 <code>/잔고</code> : 실시간 자산 현황 조회',
        '• <code>/mode [real|mock]</code> : 투자 운용 모드 전환 (실계좌 / API 모의투자)',
        '',
        '📥 <b>수동 자산 직접 기록 (REAL 모드용):</b>',
        '• <code>/set [증권사] [종목코드] [최종수량] [최종평단가]</code> : 수동 자산 갱신',
        '• <code>/sell [증권사] [종목코드] [차감수량]</code> : 보유 수량 일부 차감(매도)',
        '• <code>/clear [증권사] [종목코드]</code> : 수동 자산 개별 완전 청산',
        '• <code>/clearall</code> : 모든 등록 수동 자산 일괄 완전 삭제',
        '• <code>/check_manual</code> : 현재 기록된 수동 자산 원장 조회',
        '',
        '📈 <b>실 API 모의투자 (MOCK 모드용):</b>',
        '• <code>/buy [종목코드] [수량]</code> : 시장가(또는 지정가) 모의 매수 주문',
        '• <code>/sell_paper [종목코드] [수량]</code> : 시장가(또는 지정가) 모의 매도 주문',
        '',
        '🧠 <b>AI 투자 컨설팅 및 자동화:</b>',
        '• <code>/ai [종목코드]</code> : Gemini 1.5 기반 실시간 자문 리포트 생성',
        '• <code>/macro</code> 또는 <code>/리포트</code> : 12대 API 융합 거시경제 & AI 자산 리포트 조회',
        '• <code>/quant</code> 또는 <code>/퀀트</code> : 실시간 VAA 자산배분 신호 및 주식 퀀트 랭킹 조회',
        '• <code>/install</code> 또는 <code>/install_triggers</code> : 장전/장후 AI 리포트 자동화 스케줄러 설치'
      ].join('\n');
      
      var webAppUrl = getWebAppUrl_();
      
      var replyMarkup = null;
      if (webAppUrl) {
        replyMarkup = {
          inline_keyboard: [[
            {
              text: '📊 실시간 대시보드 (TMA) 열기',
              web_app: { url: webAppUrl }
            }
          ]]
        };
      }
      
      sendTelegramMessage(welcome, replyMarkup);
      
      // 💡 [자율 비주얼 강화] 버튼형 메뉴 대화창 하단 상시 탑재 안내 발송
      var quickButtonsMarkup = {
        keyboard: [
          [{ text: '📊 실시간 자산 조회 (Holdings)' }, { text: '⚙️ 실시간 퀀트 분석 (Quant)' }],
          [{ text: '📈 거시경제 & AI 리포트 (Macro)' }, { text: '🛠️ 자동화 트리거 설치 (Install)' }],
          [{ text: '🔄 투자 운용모드 전환 (Mode)' }, { text: '❓ 도움말 및 사용법 (Help)' }]
        ],
        resize_keyboard: true,
        one_time_keyboard: false
      };
      sendTelegramMessage('💡 <b>[원클릭 버튼 메뉴 장착 완료]</b>\n대화창 하단에 상시 탑재되는 리스트형 퀵버튼 메뉴를 활성화했습니다. 이제 명령어 타핑 없이 아래의 버튼을 터치하여 자산 현황과 분석 보고서를 즉시 조회해 보세요!', quickButtonsMarkup);
    }
    else if (command === '/dashboard' || command === '/대시보드' || command === '/app') {
      var webAppUrl = getWebAppUrl_();
      var replyMarkup = null;
      if (webAppUrl) {
        replyMarkup = {
          inline_keyboard: [[
            { text: '📊 실시간 대시보드 (TMA) 열기', web_app: { url: webAppUrl } }
          ]]
        };
      }
      sendTelegramMessage('🚀 <b>[금융 관제 대시보드 바로가기]</b>\n아래의 버튼을 눌러 거시경제 지표, 시장 수급, 위기 공시, 그리고 실계좌/모의투자 자산 현황을 한눈에 조망하는 프리미엄 모바일 대시보드(TMA)를 즉시 기동하세요!', replyMarkup);
    }
    else if (command === '/macro' || command === '/리포트') {
      sendTelegramMessage('📥 실시간 12대 API 경제 지표 및 Gemini 융합 진단 보고서를 분석하고 있습니다...');
      try {
        var meta = getIntegratedMacroMarketData();
        var adviceRes = getIntegratedMacroAdvice_(false);
        var us10yText = meta.macro.us_10y_bond.value + meta.macro.us_10y_bond.unit;
        var usFedText = meta.macro.us_fed_rate.value + meta.macro.us_fed_rate.unit;
        var krFedText = meta.macro.kr_base_rate.value + meta.macro.kr_base_rate.unit;
        var flowText = '외인: <b>' + formatNumber_(meta.market_flow.foreigner) + '억</b> | 기관: <b>' + formatNumber_(meta.market_flow.institution) + '억</b> | 개인: <b>' + formatNumber_(meta.market_flow.personal) + '억</b>';
        
        var cleanAdvice = adviceRes.advice
          .replace(/<div[^>]*>/g, '')
          .replace(/<\/div>/g, '')
          .replace(/<h4[^>]*>.*?<\/h4>/g, '');
        
        var msg = [
          '🧠 <b>[JUSIK AI 2.0 거시경제 & 자산 융합 보고서]</b> 🔮',
          '----------------------------------------',
          '📆 <b>진단일시:</b> <code>' + meta.timestamp + '</code>',
          '',
          '📈 <b>글로벌 3대 금리 현황:</b>',
          '• 미국 10Y 국채금리: <b>' + us10yText + '</b>',
          '• 미국 연방 기준금리: <b>' + usFedText + '</b>',
          '• 대한민국 기준금리: <b>' + krFedText + '</b>',
          '',
          '🌊 <b>코스피 당일 투자자별 순매수:</b>',
          '• ' + flowText,
          '',
          '📊 <b>Gemini AI CIO 통합 자산 자문:</b>',
          cleanAdvice,
          '----------------------------------------'
        ].join('\n');
        
        var webAppUrl = getWebAppUrl_();
        var replyMarkup = null;
        if (webAppUrl) {
          replyMarkup = {
            inline_keyboard: [[
              { text: '📊 실시간 대시보드 (TMA) 열기', web_app: { url: webAppUrl } }
            ]]
          };
        }
        
        sendTelegramMessage(msg, replyMarkup);
      } catch(ex) {
        logWarn_('telegram_bot', 'Macro command failed', { error: ex.message });
        sendTelegramMessage('❌ 거시경제 융합 보고서 생성 중 오류가 발생했습니다: ' + ex.message);
      }
    }
    else if (command === '/holdings' || command === '/잔고') {
      sendTelegramMessage('📥 실시간 시세를 반영한 주식 잔고 현황을 산출하고 있습니다...');
      try {
        collectHoldingsCurrent();
        var today = amTodayString_();
        var portMode = String(getScriptProperty_('PORTFOLIO_MODE', 'real')).toUpperCase();
        var holdings = readObjects_(AM_CONFIG.SHEETS.HOLDINGS_CURRENT).filter(function(row) {
          var isToday = (normalizeDateValue_(row.date) === today);
          if (!isToday) return false;
          
          var src = String(row.source || '').trim();
          if (portMode === 'MOCK') {
            return (src.indexOf('mock_') === 0);
          } else {
            return (src.indexOf('kis') === 0 || src.indexOf('manual_') === 0 || src === 'overseas');
          }
        });
        
        var webAppUrl = getWebAppUrl_();
        
        var replyMarkup = null;
        if (webAppUrl) {
          replyMarkup = {
            inline_keyboard: [[
              {
                text: '📊 실시간 대시보드 (TMA) 열기',
                web_app: { url: webAppUrl }
              }
            ]]
          };
        }

        if (holdings.length === 0) {
          sendTelegramMessage('📋 <b>[' + portMode + ' 통합 보유 자산 현황]</b>\n\n현재 활성화된 보유 주식이 없습니다.', replyMarkup);
        } else {
          var totalPurchase = 0;
          var totalEval = 0;
          var textLines = ['📋 <b>[' + portMode + ' 통합 보유 자산 현황]</b>\n'];
          
          holdings.forEach(function(h) {
            totalPurchase += parseFloat(h.purchase_amount || 0);
            totalEval += parseFloat(h.eval_amount || 0);
            
            var profitSign = h.profit_loss_pct >= 0 ? '+' : '';
            var sourceText = String(h.source).indexOf('manual_') === 0 ? '수동-' + String(h.source).replace('manual_', '') : '계좌';
            if (h.source === 'paper_trading') sourceText = '모의';
            if (h.source === 'mock_trading') sourceText = 'API 모의';
            
            textLines.push(
              '• <b>' + h.name + '</b> (' + h.symbol + ') | ' + sourceText + '\n' +
              '  수량: <b>' + formatNumber_(h.quantity) + '주</b> | 평단: <b>' + formatNumber_(Math.round(h.avg_price)) + '원</b>\n' +
              '  현재가: <b>' + formatNumber_(Math.round(h.current_price)) + '원</b> | 비중: <b>' + h.portfolio_weight_pct + '%</b>\n' +
              '  평가액: <b>' + formatNumber_(Math.round(h.eval_amount)) + '원</b> | 수익률: <b>' + profitSign + h.profit_loss_pct + '%</b>'
            );
          });
          
          var totalPfs = totalEval - totalPurchase;
          var totalPfsPct = totalPurchase > 0 ? (totalPfs / totalPurchase * 100) : 0;
          var totalSign = totalPfs >= 0 ? '🔺' : '🔻';
          var pctSign = totalPfsPct >= 0 ? '+' : '';
          
          textLines.push('');
          textLines.push('💰 <b>포트폴리오 평가 요약</b>');
          textLines.push('• 총 매수금액: <b>' + formatNumber_(Math.round(totalPurchase)) + '원</b>');
          textLines.push('• 총 평가금액: <b>' + formatNumber_(Math.round(totalEval)) + '원</b>');
          textLines.push('• ' + totalSign + ' 손익현황: <b>' + formatNumber_(Math.round(totalPfs)) + '원</b> (<b>' + pctSign + totalPfsPct.toFixed(2) + '%</b>)');
          
          sendTelegramMessage(textLines.join('\n'), replyMarkup);
        }
      } catch(ex) {
        logWarn_('telegram_bot', 'Holdings command failed', { error: ex.message });
        sendTelegramMessage('❌ <b>잔고 조회 실패</b>\n\n시세 조회 및 합산 연산 도중 치명적인 오류가 발생했습니다: ' + ex.message);
      }
    }
    else if (command === '/mode') {
      var arg = text.split(' ')[1];
      if (!arg) {
        // 인자가 없을 경우 현재 모드를 토글! (REAL <-> MOCK)
        var currentMode = String(getScriptProperty_('PORTFOLIO_MODE', 'real')).toUpperCase();
        var nextMode = (currentMode === 'REAL') ? 'MOCK' : 'REAL';
        
        setScriptProperty_('PORTFOLIO_MODE', nextMode);
        sendTelegramMessage('🔄 <b>[운용 모드 전환]</b>\n\n포트폴리오 주식 운용 모드가 <b>' + nextMode + '</b>(으)로 즉각 토글 변경되었습니다.');
        collectHoldingsCurrent();
      } else if (arg.toLowerCase() !== 'real' && arg.toLowerCase() !== 'mock') {
        sendTelegramMessage('⚠️ <b>입력 오류</b>\n\n👉 <b>올바른 형식:</b>\n<code>/mode real</code> 또는 <code>/mode mock</code>');
      } else {
        var mode = arg.toUpperCase();
        setScriptProperty_('PORTFOLIO_MODE', mode);
        sendTelegramMessage('🔄 <b>[운용 모드 전환]</b>\n\n포트폴리오 주식 운용 모드가 <b>' + mode + '</b>(으)로 즉각 변경되었습니다.');
        collectHoldingsCurrent();
      }
    }
    else if (command === '/set') {
      var rawArgs = text.split(' ').slice(1);
      if (rawArgs.length < 4) {
        sendTelegramMessage('⚠️ <b>입력 오류</b>\n\n👉 <b>수동 자산 추가/갱신 형식:</b>\n<code>/set [증권사] [종목코드] [수량] [평단가]</code>');
      } else {
        var broker = rawArgs[0];
        var symbol = rawArgs[1];
        var qty = Number(rawArgs[2]);
        var price = Number(rawArgs[3]);
        
        if (isNaN(qty) || isNaN(price) || qty < 0 || price < 0) {
          sendTelegramMessage('⚠️ <b>입력 오류</b>\n\n수량과 단가는 0 이상의 정수/소수여야 합니다.');
        } else {
          sendTelegramMessage('📥 수동 자산 <b>' + broker + '</b> ' + symbol + ' 잔고를 시트에 갱신하고 있습니다...');
          var res = updateManualHoldingFromTelegram_(broker, symbol, qty, price);
          sendTelegramMessage('⚙️ <b>[수동 자산 갱신 완료]</b>\n\n• 증권사: <b>' + broker + '</b>\n• 종목명: <b>' + res.name + '</b> (' + symbol + ')\n• 최종수량: <b>' + formatNumber_(res.quantity) + '주</b>\n• 최종평단: <b>' + formatNumber_(res.avg_price) + '원</b>');
          collectHoldingsCurrent();
        }
      }
    }
    else if (command === '/sell') {
      var rawArgs = text.split(' ').slice(1);
      if (rawArgs.length < 3) {
        sendTelegramMessage('⚠️ <b>입력 오류</b>\n\n👉 <b>수량 차감 형식:</b>\n<code>/sell [증권사] [종목코드] [차감수량]</code>');
      } else {
        var broker = rawArgs[0];
        var symbol = rawArgs[1];
        var qtyToSubtract = Number(rawArgs[2]);
        
        if (isNaN(qtyToSubtract) || qtyToSubtract <= 0) {
          sendTelegramMessage('⚠️ <b>입력 오류</b>\n\n차감 수량은 0보다 큰 숫자여야 합니다.');
        } else {
          sendTelegramMessage('📥 수동 자산 <b>' + broker + '</b>의 ' + symbol + ' 잔고를 일부 차감하고 있습니다...');
          var res = subtractManualHoldingFromTelegram_(broker, symbol, qtyToSubtract);
          if (res.success) {
            if (res.action === 'CLEARED') {
              sendTelegramMessage('❌ <b>[수동 자산 전량 청산 완료]</b>\n\n수량이 0 이하가 되어 보유 목록에서 완전히 제외되었습니다.');
            } else {
              sendTelegramMessage('⚙️ <b>[수동 자산 일부 차감 완료]</b>\n\n• 증권사: <b>' + broker + '</b>\n• 종목명: <b>' + res.name + '</b>\n• <b>현재수량: ' + formatNumber_(res.newQty) + '주</b> | 평단: <b>' + formatNumber_(res.avgPrice) + '원</b>');
            }
            collectHoldingsCurrent();
          } else {
            sendTelegramMessage('ℹ️ <b>[차감 대상 없음]</b>\n\n보유 목록에서 지정한 수동 자산을 찾지 못했습니다.');
          }
        }
      }
    }
    else if (command === '/clear') {
      var rawArgs = text.split(' ').slice(1);
      if (rawArgs.length < 2) {
        sendTelegramMessage('⚠️ <b>입력 오류</b>\n\n👉 <b>청산 형식:</b>\n<code>/clear [증권사] [종목코드]</code>');
      } else {
        var broker = rawArgs[0];
        var symbol = rawArgs[1];
        sendTelegramMessage('📥 수동 자산 <b>' + broker + '</b>의 ' + symbol + ' 잔고를 청산 처리하고 있습니다...');
        var res = clearManualHoldingFromTelegram_(broker, symbol);
        if (res.success) {
          sendTelegramMessage('❌ <b>[수동 자산 청산 완료]</b>\n\n보유 목록에서 안전하게 청산 및 영구 삭제되었습니다.');
          collectHoldingsCurrent();
        } else {
          sendTelegramMessage('ℹ️ <b>[청산 대상 없음]</b>\n\n대상 자산을 찾지 못했습니다.');
        }
      }
    }
    else if (command === '/clear_manual_all' || command === '/clearall') {
      var rawArgs = text.split(' ').slice(1);
      var confirmArg = rawArgs[0] ? rawArgs[0].trim().toUpperCase() : '';
      
      var cacheKey = 'telegram_confirm_clearall_' + chatId;
      var cache = CacheService.getScriptCache();
      
      if (confirmArg === 'YES' || confirmArg === 'CONFIRM') {
        cache.remove(cacheKey);
        sendTelegramMessage('📥 모든 수동 등록 자산들을 일괄 삭제(청산) 처리하고 있습니다...');
        var res = clearAllManualHoldingsFromTelegram_();
        if (res.success) {
          sendTelegramMessage('🔥 <b>[수동 자산 일괄 청산 완료]</b>\n\n등록되어 있던 모든 수동 자산 내역이 시트에서 완전히 지워졌으며, 자산 평가 대상에서도 즉각 제외 처리되었습니다.');
          collectHoldingsCurrent();
        }
      } else {
        cache.put(cacheKey, 'pending', 60);
        sendTelegramMessage('⚠️ <b>[전체 수동 자산 일괄 청산 경고]</b>\n\n정말로 모든 수동 등록 자산 내역을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.\n\n실행하려면 60초 이내에 <code>/clearall YES</code> 를 입력해주십시오.');
      }
    }
    else if (command === '/check_manual') {
      var manualRows = readObjects_(AM_CONFIG.SHEETS.MANUAL_HOLDINGS);
      var activeRows = manualRows.filter(function(row) {
        var activeText = String(row.active || 'Y').toUpperCase().trim();
        return (activeText !== 'N' && activeText !== 'FALSE') && parseFloat(row.quantity || 0) > 0;
      });
      
      if (activeRows.length === 0) {
        sendTelegramMessage('📋 <b>[수동 등록 자산 현황]</b>\n\n현재 활성화된 수동 자산이 없습니다.');
      } else {
        var textLines = ['📋 <b>[수동 등록 자산 현황]</b>\n'];
        activeRows.forEach(function(row) {
          textLines.push('• <b>' + row.name + '</b> (' + row.symbol + ') [' + row.broker + '] : <b>' + formatNumber_(row.quantity) + '주</b> | 평단: <b>' + formatNumber_(row.avg_price) + '원</b>');
        });
        sendTelegramMessage(textLines.join('\n'));
      }
    }
    else if (command === '/buy') {
      var rawArgs = text.split(' ').slice(1);
      if (rawArgs.length < 2) {
        sendTelegramMessage('⚠️ <b>입력 오류</b>\n\n👉 <b>모의 매수 형식:</b>\n<code>/buy [종목코드] [수량] [지정가격(선택)]</code>');
      } else {
        var symbol = rawArgs[0];
        var qty = Number(rawArgs[1]);
        var customPrice = rawArgs[2] ? Number(rawArgs[2]) : 0;
        
        if (isNaN(qty) || !isFinite(qty) || qty <= 0) {
          sendTelegramMessage('⚠️ <b>입력 오류</b>\n\n매수 수량은 0보다 큰 숫자여야 합니다.');
        } else if (rawArgs[2] && (isNaN(customPrice) || !isFinite(customPrice) || customPrice < 0)) {
          sendTelegramMessage('⚠️ <b>입력 오류</b>\n\n지정가는 0 이상의 숫자여야 합니다.');
        } else {
          var portMode = String(getScriptProperty_('PORTFOLIO_MODE', 'real')).toUpperCase();
          if (portMode !== 'MOCK') {
            sendTelegramMessage('⚠️ <b>운용 모드 오류</b>\n\n현재 운용 모드가 실계좌(REAL)입니다. 모의 주문을 전송할 수 없습니다. <code>/mode mock</code> 명령어로 전환 후 이용해 주세요.');
          } else {
            sendTelegramMessage('📥 <b>' + symbol + '</b> 모의 매수 요청을 처리하고 있습니다...');
            try {
              var res = executePaperOrder_(symbol, 'BUY', qty, customPrice);
              sendTelegramMessage('🔺 <b>[한투 API 모의매수 주문 송신]</b>\n\n• 종목명: <b>' + res.name + '</b> (' + symbol + ')\n• 주문 수량: <b>' + formatNumber_(qty) + '주</b>\n• 시장가(또는 지정가) 주문이 정상적으로 송신되었습니다. 체결 결과는 잠시 후 대시보드 및 잔고조회(/holdings)로 반영됩니다.');
            } catch(orderErr) {
              sendTelegramMessage('❌ <b>모의 주문 실패:</b> ' + orderErr.message);
            }
          }
        }
      }
    }
    else if (command === '/sell_paper') {
      var rawArgs = text.split(' ').slice(1);
      if (rawArgs.length < 2) {
        sendTelegramMessage('⚠️ <b>입력 오류</b>\n\n👉 <b>모의 매도 형식:</b>\n<code>/sell_paper [종목코드] [수량] [지정가격(선택)]</code>');
      } else {
        var symbol = rawArgs[0];
        var qty = Number(rawArgs[1]);
        var customPrice = rawArgs[2] ? Number(rawArgs[2]) : 0;
        
        if (isNaN(qty) || !isFinite(qty) || qty <= 0) {
          sendTelegramMessage('⚠️ <b>입력 오류</b>\n\n매도 수량은 0보다 큰 숫자여야 합니다.');
        } else if (rawArgs[2] && (isNaN(customPrice) || !isFinite(customPrice) || customPrice < 0)) {
          sendTelegramMessage('⚠️ <b>입력 오류</b>\n\n지정가는 0 이상의 숫자여야 합니다.');
        } else {
          var portMode = String(getScriptProperty_('PORTFOLIO_MODE', 'real')).toUpperCase();
          if (portMode !== 'MOCK') {
            sendTelegramMessage('⚠️ <b>운용 모드 오류</b>\n\n현재 운용 모드가 실계좌(REAL)입니다. 모의 주문을 전송할 수 없습니다. <code>/mode mock</code> 명령어로 전환 후 이용해 주세요.');
          } else {
            sendTelegramMessage('📥 <b>' + symbol + '</b> 모의 매도 요청을 처리하고 있습니다...');
            try {
              var res = executePaperOrder_(symbol, 'SELL', qty, customPrice);
              sendTelegramMessage('🔻 <b>[한투 API 모의매도 주문 송신]</b>\n\n• 종목명: <b>' + res.name + '</b> (' + symbol + ')\n• 주문 수량: <b>' + formatNumber_(qty) + '주</b>\n• 시장가(또는 지정가) 주문이 정상적으로 송신되었습니다. 체결 결과는 잠시 후 대시보드 및 잔고조회(/holdings)로 반영됩니다.');
            } catch(orderErr) {
              sendTelegramMessage('❌ <b>모의 주문 실패:</b> ' + orderErr.message);
            }
          }
        }
      }
    }
    else if (command === '/ai') {
      var arg = text.split(' ')[1];
      if (!arg) {
        sendTelegramMessage('⚠️ <b>입력 오류</b>\n\n👉 <b>형식:</b> <code>/ai [종목코드]</code> (예: `/ai 005930`)');
      } else {
        sendTelegramMessage('🧠 Gemini AI를 기동하여 실시간 주식 분석 진단서를 작성하고 있습니다...');
        try {
          var rep = callGeminiStockAnalysis_(arg);
          sendTelegramMessage(rep);
        } catch(err) {
          sendTelegramMessage('❌ <b>AI 분석 실패</b>\n\nGemini 통신 혹은 분석 도중 오류가 발생했습니다: ' + err.message);
        }
      }
    }
    else if (command === '/install_triggers' || command === '/install') {
      sendTelegramMessage('📥 <b>장전/장후 AI 보고서 및 가상투자 정산 자동화 트리거</b>를 구글 서버에 설치하고 있습니다...');
      try {
        installAutomationTriggers();
        // 텔레그램 고정 명령어 메뉴판 동시 갱신
        setTelegramCommands();
        sendTelegramMessage('⚙️ <b>[자동화 트리거 설치 완료]</b>\n\n• 매일 오전 8시 10분: <b>장전 프리마켓 AI 보고서 발송</b>\n• 매일 오후 3시 40분: <b>장후 모의투자 일간 정산 보고서 발송</b>\n\n두 핵심 자동화가 성공적으로 클라우드에 스케줄링되었으며, 텔레그램 고정 메뉴판 목록도 최신화되었습니다! ✅');
      } catch(err) {
        sendTelegramMessage('❌ <b>트리거 설치 실패</b>\n\n프로젝트 내 권한 혹은 스크립트 장애가 발생했습니다: ' + err.message);
      }
    }
    else if (command === '/set_config') {
      var rawArgs = text.split(' ').slice(1);
      var confirmArg = rawArgs[0] ? rawArgs[0].trim().toUpperCase() : '';
      
      var cacheKey = 'telegram_confirm_set_config_' + chatId;
      var cache = CacheService.getScriptCache();
      
      if (confirmArg === 'CONFIRM') {
        var cachedData = cache.get(cacheKey);
        if (!cachedData) {
          sendTelegramMessage('⚠️ <b>[승인 만료 또는 오류]</b>\n\n진행 중인 설정 변경 요청이 없거나 승인 대기 시간(60초)이 초과했습니다. 다시 변경 명령을 내려주십시오.');
        } else {
          try {
            var data = JSON.parse(cachedData);
            var key = data.key;
            var val = data.val;
            
            cache.remove(cacheKey);
            setScriptProperty_(key, val);
            
            // KIS 연동 중요 정보가 갱신되면 꼬인 기존 액세스 토큰을 자율 강제 소거(Flush)
            if (key === 'KIS_APP_KEY' || key === 'KIS_APP_SECRET' || key === 'KIS_CANO' || key === 'KIS_BASE_URL') {
              try {
                var service = PropertiesService.getScriptProperties();
                service.deleteProperty(AM_CONFIG.PROPERTY_KEYS.KIS_ACCESS_TOKEN);
                service.deleteProperty(AM_CONFIG.PROPERTY_KEYS.KIS_ACCESS_TOKEN_EXPIRES_AT);
              } catch(tokenErr) {}
            }
            
            sendTelegramMessage('🔒 <b>[보안 설정 등록 완료]</b>\n\n설정 키 <code>' + key + '</code> 의 값이 안전하게 구글 서버 저장소에 즉시 기록되었습니다.\n\n💡 <b>기존 꼬여있던 증권사 토큰 정보가 즉시 초기화(Flush) 완료되었습니다!</b>\n이제 시세를 조회하거나 잔고를 읽어올 때 싱싱한 신규 토큰으로 증권사 서버에 직통 연동됩니다.');
          } catch (e) {
            sendTelegramMessage('❌ <b>[설정 저장 실패]</b>\n\n임시 설정 데이터를 처리하는 과정에서 오류가 발생했습니다: ' + e.message);
          }
        }
      } else {
        if (rawArgs.length < 2) {
          sendTelegramMessage('⚠️ <b>입력 오류</b>\n\n👉 <b>설정 등록 형식:</b>\n<code>/set_config [설정키] [설정값]</code>\n\n<b>예시:</b>\n<code>/set_config KIS_APP_SECRET 나의비밀키</code>');
        } else {
          var key = rawArgs[0].trim().toUpperCase();
          var val = rawArgs.slice(1).join(' ').trim();
          
          var validKeys = Object.keys(AM_CONFIG.PROPERTY_KEYS);
          if (validKeys.indexOf(key) < 0) {
            sendTelegramMessage('⚠️ <b>유효하지 않은 설정 키</b>\n\n사용 가능한 키 목록:\n' + validKeys.map(function(k) { return '• <code>' + k + '</code>'; }).join('\n'));
          } else {
            // 값의 길이에 따라 앞부분만 살짝 마스킹하여 안내
            var maskedVal = val;
            if (val.length > 4) {
              maskedVal = val.substring(0, 4) + '*** (총 ' + val.length + '자)';
            } else {
              maskedVal = '***';
            }
            
            var dataToCache = { key: key, val: val };
            cache.put(cacheKey, JSON.stringify(dataToCache), 60);
            
            sendTelegramMessage('⚠️ <b>[설정 변경 2단계 확인]</b>\n\n• <b>설정 키</b>: <code>' + key + '</code>\n• <b>입력값</b>: <code>' + maskedVal + '</code>\n\n이 변경 사항을 구글 서버 Properties에 안전하게 반영하시겠습니까?\n\n실행하려면 60초 이내에 <code>/set_config confirm</code> 을 입력해주십시오.');
          }
        }
      }
    }
    else if (command === '/sync_config') {
      var rawArgs = text.split(' ').slice(1);
      var confirmArg = rawArgs[0] ? rawArgs[0].trim().toUpperCase() : '';
      
      var cacheKey = 'telegram_confirm_sync_config_' + chatId;
      var cache = CacheService.getScriptCache();
      
      if (confirmArg === 'CONFIRM') {
        cache.remove(cacheKey);
        sendTelegramMessage('⚙️ 스프레드시트 <b>settings</b> 시트의 대량 설정을 스크립트 속성(Properties)으로 일괄 동기화하는 중입니다...');
        try {
          var res = syncPropertiesFromSheet();
          if (res.success) {
            var msg = [
              '⚙️ <b>[설정 대량 동기화 완수]</b>',
              '',
              '스프레드시트 <code>settings</code> 시트의 총 <b>' + res.count + '개</b> 설정을 스크립트 속성으로 완벽 동기화 완료했습니다!',
              ''
            ];
            if (res.tokenFlushed) {
              msg.push('💡 KIS 연동 핵심 설정의 변경이 포착되어 <b>기존 액세스 토큰 캐시를 즉시 파괴(Flush)</b>했습니다. 새 토큰이 자동 발급됩니다.');
              msg.push('');
            }
            msg.push('<b>동기화된 설정 목록:</b>');
            res.keys.forEach(function(k) {
              msg.push('• <code>' + k + '</code>');
            });
            sendTelegramMessage(msg.join('\n'));
          } else {
            sendTelegramMessage('⚠️ <b>[동기화 건너뜀]</b>\n\nsettings 시트에 유효한 설정 데이터가 존재하지 않습니다.');
          }
        } catch(err) {
          logWarn_('telegram_bot', 'Telegram sync_config command failed', { error: err.message });
          sendTelegramMessage('❌ <b>[동기화 실패]</b>\n\n설정 일괄 동기화 연산 도중 치명적인 오류가 발생했습니다: ' + err.message);
        }
      } else {
        cache.put(cacheKey, 'pending', 60);
        sendTelegramMessage('⚠️ <b>[설정 일괄 동기화 확인]</b>\n\n스프레드시트 <code>settings</code> 시트의 설정을 스크립트 속성(Properties)으로 일괄 동기화하시겠습니까? 비어있거나 마스킹된 설정은 보호됩니다.\n\n실행하려면 60초 이내에 <code>/sync_config confirm</code> 을 입력해주십시오.');
      }
    }
    else if (command === '/quant' || command === '/퀀트') {
      sendTelegramMessage('📥 실시간 퀀트 알고리즘 연산을 진행하고 있습니다...');
      try {
        var vaa = getVaaStrategySignal();
        var scoring = getQuantStockScoring();
        
        var msg = [
          '📊 <b>[JUSIK AI 2.0 실시간 퀀트 분석 보고서]</b> ⚙️',
          '----------------------------------------',
          '📆 <b>진단일시:</b> <code>' + vaa.timestamp + '</code>',
          '',
          '🔹 <b>VAA 동적 자산배분 (Defensive Asset Allocation)</b>',
          '  - 시장 국면: ' + (vaa.regime === 'AGGRESSIVE' ? '🟢 상승공격 (AGGRESSIVE)' : '🚨 하락피신 (DEFENSIVE)'),
          '  - 추천 자산: <b>' + vaa.recommended_symbol + '</b> (모멘텀 스코어: ' + vaa.recommended_score + ')',
          '  - 매매 제안: <b>' + vaa.recommended_symbol + ' 100% 비중 매수 유지</b>',
          '',
          '🔹 <b>핵심 자산별 모멘텀 스코어:</b>',
          vaa.regime === 'AGGRESSIVE' ? 
            vaa.aggressive_scores.map(function(a) { return '  • ' + a.symbol + ': <b>' + a.score + '</b> (1M: ' + a.r1 + '%)'; }).join('\n') :
            vaa.defensive_scores.map(function(a) { return '  • ' + a.symbol + ': <b>' + a.score + '</b> (1M: ' + a.r1 + '%)'; }).join('\n'),
          '',
          '🔹 <b>포트폴리오 주식 퀀트 팩터 랭킹 (Top 5):</b>',
          scoring.slice(0, 5).map(function(s, idx) {
            return '  ' + (idx + 1) + '. <b>' + s.name + ' (' + s.symbol + ')</b> - 스코어: <b>' + s.quant_score + '점</b>\n' +
                   '     (PER: ' + s.per + ' | PBR: ' + s.pbr + ' | 50D모멘텀: ' + s.momentum_pct + '%)';
          }).join('\n'),
          '----------------------------------------',
          '💡 VAA 전략은 매월 말 1회 리밸런싱을 원칙으로 하며, 모든 공격형 자산의 모멘텀 스코어가 0을 초과해야 공격 국면으로 진입합니다.'
        ].join('\n');
        
        var webAppUrl = "";
        try { webAppUrl = ScriptApp.getService().getUrl(); } catch(err) {}
        var replyMarkup = null;
        if (webAppUrl) {
          replyMarkup = {
            inline_keyboard: [[
              { text: '📊 실시간 대시보드 (TMA) 열기', web_app: { url: webAppUrl } }
            ]]
          };
        }
        
        sendTelegramMessage(msg, replyMarkup);
      } catch(ex) {
        logWarn_('telegram_bot', 'Quant command failed', { error: ex.message });
        sendTelegramMessage('❌ 퀀트 분석 수행 중 치명적인 오류가 발생했습니다: ' + ex.message);
      }
    }
    
    return HtmlService.createHtmlOutput('OK');
  } catch(err) {
    logWarn_('telegram_webhook', 'Fatal webhook execution error', { error: err.message });
    return HtmlService.createHtmlOutput('Error: ' + err.message);
  }
}

// ==================================================
// 🚀 수동 자산 관리 백엔드 API 세트
// ==================================================

function updateManualHoldingFromTelegram_(broker, symbol, qty, price) {
  var sheetName = AM_CONFIG.SHEETS.MANUAL_HOLDINGS;
  var cleanSymbol = normalizeStockSymbol_(symbol);
  var cleanBroker = normalizeBrokerName_(broker);
  
  var name = getStockKoreanName_(cleanSymbol, cleanSymbol);
  
  var rows = readObjects_(sheetName);
  var foundIndex = -1;
  for (var i = 0; i < rows.length; i++) {
    if (normalizeBrokerName_(rows[i].broker) === cleanBroker && normalizeStockSymbol_(rows[i].symbol) === cleanSymbol) {
      foundIndex = i;
      break;
    }
  }
  
  var updated = {
    broker: cleanBroker,
    symbol: cleanSymbol,
    name: name,
    quantity: qty,
    avg_price: price,
    active: 'Y',
    memo: '텔레그램 갱신'
  };
  
  if (foundIndex >= 0) {
    // 덮어쓰기
    var sheet = ensureSheet_(sheetName, AM_SHEET_SCHEMAS[sheetName]);
    
    // 🚀 [금액 꼬임 완치] 실제 구글 시트 상의 첫 번째 행 헤더에서 정확한 열(Column) 번호를 동적으로 판별
    var actualHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function(h) {
      return String(h).trim();
    });
    
    var nameCol = actualHeaders.indexOf('name') + 1;
    var qtyCol = actualHeaders.indexOf('quantity') + 1;
    var priceCol = actualHeaders.indexOf('avg_price') + 1;
    var activeCol = actualHeaders.indexOf('active') + 1;
    var memoCol = actualHeaders.indexOf('memo') + 1;
    
    // 폴백 조치: 실제 시트에 열이 누락되었거나 비정상일 경우 마스터 스펙 백업
    var fallbackHeaders = AM_SHEET_SCHEMAS[sheetName];
    if (nameCol <= 0) nameCol = fallbackHeaders.indexOf('name') + 1;
    if (qtyCol <= 0) qtyCol = fallbackHeaders.indexOf('quantity') + 1;
    if (priceCol <= 0) priceCol = fallbackHeaders.indexOf('avg_price') + 1;
    if (activeCol <= 0) activeCol = fallbackHeaders.indexOf('active') + 1;
    if (memoCol <= 0) memoCol = fallbackHeaders.indexOf('memo') + 1;
    
    var fileRow = foundIndex + 2; // 헤더 제외 1-indexed
    if (qtyCol > 0) sheet.getRange(fileRow, qtyCol).setValue(qty);
    if (priceCol > 0) sheet.getRange(fileRow, priceCol).setValue(price);
    if (activeCol > 0) sheet.getRange(fileRow, activeCol).setValue('Y');
    if (nameCol > 0) sheet.getRange(fileRow, nameCol).setValue(name);
    if (memoCol > 0) sheet.getRange(fileRow, memoCol).setValue('텔레그램 수정 갱신');
  } else {
    // 신규 추가
    appendObjectRow_(sheetName, updated);
  }
  
  return updated;
}
 
function subtractManualHoldingFromTelegram_(broker, symbol, qtyToSubtract) {
  var sheetName = AM_CONFIG.SHEETS.MANUAL_HOLDINGS;
  var cleanSymbol = normalizeStockSymbol_(symbol);
  var cleanBroker = normalizeBrokerName_(broker);
  
  var rows = readObjects_(sheetName);
  var foundIndex = -1;
  for (var i = 0; i < rows.length; i++) {
    if (normalizeBrokerName_(rows[i].broker) === cleanBroker && normalizeStockSymbol_(rows[i].symbol) === cleanSymbol) {
      foundIndex = i;
      break;
    }
  }
  
  if (foundIndex < 0) {
    return { success: false };
  }
  
  var row = rows[foundIndex];
  var currentQty = parseFloat(row.quantity || 0);
  var newQty = currentQty - qtyToSubtract;
  
  if (newQty <= 0) {
    // 0 이하면 아예 지워주거나 active='N'
    clearManualHoldingFromTelegram_(broker, symbol);
    return { success: true, action: 'CLEARED', name: row.name };
  } else {
    // 수량 변경
    var sheet = ensureSheet_(sheetName, AM_SHEET_SCHEMAS[sheetName]);
    
    // 🚀 실제 헤더 동적 스캔
    var actualHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function(h) {
      return String(h).trim();
    });
    var qtyCol = actualHeaders.indexOf('quantity') + 1;
    var memoCol = actualHeaders.indexOf('memo') + 1;
    
    var fallbackHeaders = AM_SHEET_SCHEMAS[sheetName];
    if (qtyCol <= 0) qtyCol = fallbackHeaders.indexOf('quantity') + 1;
    if (memoCol <= 0) memoCol = fallbackHeaders.indexOf('memo') + 1;
    
    if (qtyCol > 0) sheet.getRange(foundIndex + 2, qtyCol).setValue(newQty);
    if (memoCol > 0) sheet.getRange(foundIndex + 2, memoCol).setValue('부분 차감 매도');
    
    return {
      success: true,
      action: 'SUBTRACTED',
      name: row.name,
      prevQty: currentQty,
      newQty: newQty,
      avgPrice: parseFloat(row.avg_price || 0)
    };
  }
}

function clearManualHoldingFromTelegram_(broker, symbol) {
  var sheetName = AM_CONFIG.SHEETS.MANUAL_HOLDINGS;
  var cleanSymbol = normalizeStockSymbol_(symbol);
  var cleanBroker = normalizeBrokerName_(broker);
  
  var sheet = ensureSheet_(sheetName, AM_SHEET_SCHEMAS[sheetName]);
  var values = sheet.getDataRange().getValues();
  
  var name = "";
  var success = false;
  
  if (values.length > 1) {
    var headers = values[0];
    var brokerCol = headers.indexOf('broker');
    var symbolCol = headers.indexOf('symbol');
    var nameCol = headers.indexOf('name');
    
    if (brokerCol >= 0 && symbolCol >= 0) {
      // 역순 루프를 돌며 실제 일치하는 행을 완전히 소거 (빈 행이 끼어있어도 인덱스 꼬임 완전 원천 방지)
      for (var i = values.length - 1; i >= 1; i--) {
        var rowBroker = normalizeBrokerName_(values[i][brokerCol]);
        var rowSymbol = normalizeStockSymbol_(values[i][symbolCol]);
        
        if (rowBroker === cleanBroker && rowSymbol === cleanSymbol) {
          name = nameCol >= 0 ? values[i][nameCol] : "";
          sheet.deleteRow(i + 1); // 1-indexed 실제 행 삭제
          success = true;
        }
      }
    }
  }
  
  // 🚀 오늘자 스냅샷(HOLDINGS_CURRENT)에서도 이중 소거 (실시간 동기화 오류 원천 완치)
  try {
    var today = amTodayString_();
    var currentSheetName = AM_CONFIG.SHEETS.HOLDINGS_CURRENT;
    var currentSheet = ensureSheet_(currentSheetName, AM_SHEET_SCHEMAS[currentSheetName]);
    var currentValues = currentSheet.getDataRange().getValues();
    if (currentValues.length > 1) {
      var currentHeaders = currentValues[0];
      var dateCol = currentHeaders.indexOf('date');
      var currentSymbolCol = currentHeaders.indexOf('symbol');
      var sourceCol = currentHeaders.indexOf('source');
      
      if (dateCol >= 0 && currentSymbolCol >= 0 && sourceCol >= 0) {
        // 역순 루프를 돌면서 삭제
        for (var j = currentValues.length - 1; j >= 1; j--) {
          var rowDate = normalizeDateValue_(currentValues[j][dateCol]);
          var rowSymbol = normalizeStockSymbol_(currentValues[j][currentSymbolCol]);
          var rowSource = String(currentValues[j][sourceCol] || '');
          
          if (rowDate === today && 
              rowSymbol === cleanSymbol && 
              rowSource.indexOf('manual_') === 0) {
            currentSheet.deleteRow(j + 1); // 1-indexed
          }
        }
      }
    }
    // 삭제 후 포트폴리오 가중치 재계산
    rewriteHoldingWeightsForDate_(today);
  } catch (err) {
    logWarn_('clear_manual_snapshot', 'Failed to double delete holding snapshot', { error: err.message });
  }
  
  return { success: success, name: name };
}

function clearAllManualHoldingsFromTelegram_() {
  var today = amTodayString_();
  clearDataRows_(AM_CONFIG.SHEETS.MANUAL_HOLDINGS);
  
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
        if (rowDate === today && rowSource.indexOf('manual_') === 0) {
          // 제외
        } else {
          keepRows.push(values[i]);
        }
      }
      rewriteDataRows_(currentSheet, headers.length, keepRows);
    }
  }
  
  try { rewriteHoldingWeightsForDate_(today); } catch(e) {}
  return { success: true };
}

// ==================================================
// 🚀 Gemini 1.5 API 기반 주식 분석 리포터
// ==================================================

function callGeminiStockAnalysis_(symbol) {
  var cleanSymbol = normalizeStockSymbol_(symbol);
  var cacheKey = 'GEMINI_STOCK_ANALYSIS_V2_' + cleanSymbol;
  var cache = CacheService.getScriptCache();
  
  // 4시간 메모리 캐시 적중 시 0.05초 즉시 반환
  try {
    var cached = cache.get(cacheKey);
    if (cached) {
      logInfo_('ai_stock_analysis', 'Loaded AI stock analysis from cache', { symbol: cleanSymbol });
      return cached;
    }
  } catch(e) {}
  
  var apiKey = getRequiredScriptProperty_(AM_CONFIG.PROPERTY_KEYS.GEMINI_API_KEY);
  var quote = fetchKisCurrentPrice_(cleanSymbol);
  var name = getStockKoreanName_(cleanSymbol, quote.name);

  var ind = { momentum_pct: 0, rsi: 50, sma5: 0, sma20: 0, bollinger_upper: 0, bollinger_lower: 0, technical_signal: '특이 신호 없음' };
  try {
    ind = calculate50DayMomentumAndRSI_(cleanSymbol);
  } catch(e) {
    logWarn_('telegram_bot', 'Failed to fetch technical indicators for ' + cleanSymbol, { error: e.message });
  }
  
  var prompt = [
    '너는 대한민국의 아주 냉철하고 노련한 전문 금융 애널리스트 및 투자 고문이다.',
    '다음 실시간 가격 데이터와 기술적 지표들을 기반으로 해당 종목의 정밀 투자 진단 보고서를 텔레그램 친화적 HTML 포맷으로 작성해라.',
    '자산 상세 데이터 및 보조지표:',
    '• 종목명: ' + name + ' (' + cleanSymbol + ')',
    '• 현재가격: ' + formatNumber_(quote.close) + '원',
    '• 당일등락률: ' + quote.change_pct + '%',
    '• 50일 가격 모멘텀: ' + ind.momentum_pct + '%',
    '• RSI(14): ' + ind.rsi + ' (30이하 과매도, 70이상 과매수)',
    '• 이동평균선: 5일선 ' + formatNumber_(ind.sma5) + '원 vs 20일선 ' + formatNumber_(ind.sma20) + '원',
    '• 볼린저 밴드(20, 2): 상한선 ' + formatNumber_(ind.bollinger_upper) + '원 / 하한선 ' + formatNumber_(ind.bollinger_lower) + '원',
    '• 탐지된 기술적 패턴/신호: ' + ind.technical_signal,
    '',
    '요구사항:',
    '1. 텔레그램 HTML 파싱 규칙에 맞춰 <b>굵은 글씨</b>, <code>코드블럭</code> 등을 적극 사용하여 가독성이 뛰어나고 레이아웃이 깔끔하게 작성해라.',
    '2. 이 종목의 현재 보조지표 상태(볼린저 밴드 위치, 이평선 크로스, RSI 과열 여부)를 전문적으로 분석해라.',
    '3. 투자 조언은 단순 확신형이 아닌, 시장 등락 시의 [시나리오별 실전 대응 전략](상승 시, 횡보 시, 하락 시 각각의 구체적 가격 기준 및 대응법)과 [손절가 및 비중 조절 기준]을 포함하여 서술해라.',
    '4. 모든 리포트는 한글로만 유창하게 작성할 것.',
    '5. 서두에 🤖 [JUSIK AI 실시간 기술적 종목 진단] 뱃지를 달아줄 것.'
  ].join('\n');
  
  var model = getScriptProperty_(AM_CONFIG.PROPERTY_KEYS.GEMINI_MODEL, 'gemini-1.5-flash');
  var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + apiKey;
  var payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.3 }
  };
  
  var response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  
  if (response.getResponseCode() !== 200) {
    throw new Error('Gemini API call failed: ' + response.getContentText());
  }
  
  var res = JSON.parse(response.getContentText());
  var replyText = res.candidates[0].content.parts[0].text;
  
  // 4시간 캐싱 기록
  try {
    cache.put(cacheKey, replyText, 14400);
  } catch(ce) {}
  
  return replyText;
}

// 텔레그램 특수문자 HTML 안전 이스케이프 (가독성을 위한 핵심 태그만 임시 보호)
function escapeTelegramHtml_(text) {
  if (!text) return '';
  var cleanText = String(text)
    .replace(/<b>/gi, '[[B-OPEN]]')
    .replace(/<\/b>/gi, '[[B-CLOSE]]')
    .replace(/<i>/gi, '[[I-OPEN]]')
    .replace(/<\/i>/gi, '[[I-CLOSE]]')
    .replace(/<code>/gi, '[[C-OPEN]]')
    .replace(/<\/code>/gi, '[[C-CLOSE]]');

  cleanText = cleanText
    .replace(/[\*\_\`]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  cleanText = cleanText
    .replace(/\[\[B-OPEN\]\]/g, '<b>')
    .replace(/\[\[B-CLOSE\]\]/g, '</b>')
    .replace(/\[\[I-OPEN\]\]/g, '<i>')
    .replace(/\[\[I-CLOSE\]\]/g, '</i>')
    .replace(/\[\[C-OPEN\]\]/g, '<code>')
    .replace(/\[\[C-CLOSE\]\]/g, '</code>');

  return cleanText;
}

// ==================================================
// 🚀 대시보드 웹뷰 진입점 및 백엔드 REST API
// ==================================================

function doGet(e) {
  var action = e && e.parameter && e.parameter.action;
  
  // 🚀 [신설] 프론트엔드-백엔드 분리 배포용 REST API 동적 게이트웨이 (action=api_call)
  if (action === 'api_call') {
    var funcName = e.parameter.func;
    var args = [];
    if (e.parameter.args) {
      try {
        args = JSON.parse(e.parameter.args);
      } catch(argErr) {
        return ContentService.createTextOutput(JSON.stringify({ error: 'Args parsing failed: ' + argErr.message }))
          .setMimeType(ContentService.MimeType.JSON);
      }
    }
    
    // 외부 클라이언트로부터 원격 실행이 허용되는 안전한 화이트리스트 백엔드 함수 정의
    var allowedFunctions = [
      'getPortfolioDataForWeb',
      'getPaperLedgerDataForWeb',
      'toggleInvestmentModeFromWeb',
      'updateHoldingFromWeb',
      'getStockNewsForWeb',
      'getAiPortfolioAdviceForWeb',
      'getVaaStrategySignal',
      'getQuantStockScoring',
      'updateQuantUniverseDatabase',
      'runQuantPortfolioRebalancing',
      'callGeminiStockAnalysis_',
      'getQuantLabDataForWeb',
      'getLogsForDebug_'
    ];
    
    if (allowedFunctions.indexOf(funcName) < 0) {
      return ContentService.createTextOutput(JSON.stringify({ error: 'Unauthorized function call: ' + funcName }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    try {
      // Apps Script 전역 컨텍스트에서 지정 함수 동적 실행
      var result = this[funcName].apply(this, args);
      return ContentService.createTextOutput(JSON.stringify({ success: true, result: result }))
        .setMimeType(ContentService.MimeType.JSON);
    } catch(callErr) {
      logWarn_('api_gateway_error', 'Dynamic API call failed for ' + funcName, { error: callErr.message });
      return ContentService.createTextOutput(JSON.stringify({ error: 'Execution failed: ' + callErr.message }))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }
  

  
  var sensitiveActions = ['force_fix', 'diagnose', 'debug_chat', 'get_logs', 'debug_kis', 'debug_gemini'];
  
  if (action && sensitiveActions.indexOf(action) >= 0) {
    var adminToken = getScriptProperty_('ADMIN_TOKEN', '');
    var telegramToken = getScriptProperty_('TELEGRAM_BOT_TOKEN', '');
    var providedToken = e.parameter.token;
    
    var isAuthorized = false;
    if (adminToken && providedToken === adminToken) {
      isAuthorized = true;
    } else if (!adminToken && telegramToken && providedToken === telegramToken) {
      isAuthorized = true;
    }
    
    if (!isAuthorized) {
      return ContentService.createTextOutput(JSON.stringify({ 
        error: 'Unauthorized access. Valid token is required for sensitive diagnostics.' 
      }, null, 2)).setMimeType(ContentService.MimeType.JSON);
    }
  }

  if (e && e.parameter && e.parameter.action === 'force_fix') {
    var fixResult = {
      timestamp: new Date().toLocaleString(),
      sync: {},
      diagnose: {},
      recent_logs: []
    };
    
    try {
      fixResult.sync = syncPropertiesFromSheet();
    } catch(se) {
      fixResult.sync = { error: se.message };
    }
    
    try {
      fixResult.diagnose = runDiagnostics_();
    } catch(de) {
      fixResult.diagnose = { error: de.message };
    }
    
    try {
      var sheetName = AM_CONFIG.SHEETS.LOGS;
      var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
      if (sheet) {
        var lastRow = sheet.getLastRow();
        var startRow = Math.max(2, lastRow - 20);
        var numRows = lastRow - startRow + 1;
        if (numRows > 0) {
          var values = sheet.getRange(startRow, 1, numRows, 5).getValues();
          var headers = AM_SHEET_SCHEMAS[sheetName];
          fixResult.recent_logs = values.map(function(row) {
            var obj = {};
            headers.forEach(function(key, index) {
              obj[key] = row[index];
            });
            return obj;
          });
        }
      }
    } catch(le) {
      fixResult.recent_logs = [{ error: le.message }];
    }
    
    return ContentService.createTextOutput(JSON.stringify(fixResult, null, 2))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (e && e.parameter && e.parameter.action === 'diagnose') {
    var diag = runDiagnostics_();
    return ContentService.createTextOutput(JSON.stringify(diag, null, 2))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  if (e && e.parameter && e.parameter.action === 'debug_chat') {
    var token = getScriptProperty_(AM_CONFIG.PROPERTY_KEYS.TELEGRAM_BOT_TOKEN, "");
    var savedChatId = getScriptProperty_(AM_CONFIG.PROPERTY_KEYS.TELEGRAM_CHAT_ID, "");
    
    var updates = [];
    var fetchErr = "";
    try {
      var url = 'https://api.telegram.org/bot' + token + '/getUpdates?limit=5';
      var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
      var json = JSON.parse(res.getContentText());
      if (json.ok) {
        updates = json.result;
      } else {
        fetchErr = json.description;
      }
    } catch(err) {
      fetchErr = err.message;
    }
    
    var botInfo = {};
    try {
      var meUrl = 'https://api.telegram.org/bot' + token + '/getMe';
      var meRes = UrlFetchApp.fetch(meUrl, { muteHttpExceptions: true });
      botInfo = JSON.parse(meRes.getContentText());
    } catch(err) {}
    
    var debugResult = {
      saved_chat_id: savedChatId,
      bot_token_length: token ? token.length : 0,
      bot_token_prefix: token ? token.substring(0, 6) + "..." : "EMPTY",
      fetch_error: fetchErr,
      bot_info: botInfo,
      latest_received_chats: updates.map(function(up) {
        if (up.message) {
          return {
            update_id: up.update_id,
            chat_id: up.message.chat.id,
            username: up.message.chat.username,
            first_name: up.message.chat.first_name,
            text: up.message.text,
            is_matched: (String(up.message.chat.id) === String(savedChatId))
          };
        }
        return null;
      }).filter(function(x) { return x !== null; })
    };
    
    return ContentService.createTextOutput(JSON.stringify(debugResult, null, 2))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  if (e && e.parameter && e.parameter.action === 'get_logs') {
    var sheetName = AM_CONFIG.SHEETS.LOGS;
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
    var logsList = [];
    if (sheet) {
      var lastRow = sheet.getLastRow();
      var startRow = Math.max(2, lastRow - 50);
      var numRows = lastRow - startRow + 1;
      if (numRows > 0) {
        var values = sheet.getRange(startRow, 1, numRows, 5).getValues();
        var headers = AM_SHEET_SCHEMAS[sheetName];
        logsList = values.map(function(row) {
          var obj = {};
          headers.forEach(function(key, index) {
            obj[key] = row[index];
          });
          return obj;
        });
      }
    }
    
    return ContentService.createTextOutput(JSON.stringify(logsList, null, 2))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  if (e && e.parameter && e.parameter.action === 'get_ai_advice') {
    try {
      var force = (e.parameter.refresh === 'true');
      var adviceRes = getAiPortfolioAdvice_(force);
      return ContentService.createTextOutput(JSON.stringify(adviceRes, null, 2))
        .setMimeType(ContentService.MimeType.JSON);
    } catch(err) {
      return ContentService.createTextOutput(JSON.stringify({ error: err.message }, null, 2))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }

  if (e && e.parameter && e.parameter.action === 'get_portfolio') {
    try {
      var force = (e.parameter.refresh === 'true');
      var portfolio = getPortfolioDataForWeb(force);
      return ContentService.createTextOutput(JSON.stringify(portfolio, null, 2))
        .setMimeType(ContentService.MimeType.JSON);
    } catch(err) {
      return ContentService.createTextOutput(JSON.stringify({ error: err.message }, null, 2))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }

  if (e && e.parameter && e.parameter.action === 'debug_kis') {
    try {
      var nasd = {};
      try { nasd = fetchKisOverseasAccountBalance_('NASD'); } catch(e) { nasd = { error: e.message }; }
      var nyse = {};
      try { nyse = fetchKisOverseasAccountBalance_('NYSE'); } catch(e) { nyse = { error: e.message }; }
      
      var appKey = getScriptProperty_(AM_CONFIG.PROPERTY_KEYS.KIS_APP_KEY, '');
      var appSecret = getScriptProperty_(AM_CONFIG.PROPERTY_KEYS.KIS_APP_SECRET, '');
      var cano = getScriptProperty_(AM_CONFIG.PROPERTY_KEYS.KIS_CANO, '');
      var baseUrl = getScriptProperty_(AM_CONFIG.PROPERTY_KEYS.KIS_BASE_URL, AM_CONFIG.DEFAULT_KIS_BASE_URL);
      
      var rawScriptKeys = PropertiesService.getScriptProperties().getKeys();
      var rawUserKeys = PropertiesService.getUserProperties().getKeys();
      var rawDocumentKeys = PropertiesService.getDocumentProperties().getKeys();
      
      var sheetAppSecretLength = 0;
      var sheetAppSecretMasked = 'NOT_FOUND';
      var sheetAppSecretHasAsterisk = false;
      try {
        var rows = readObjects_(AM_CONFIG.SHEETS.SETTINGS);
        var match = rows.filter(function(r) { return String(r.key).trim() === 'KIS_APP_SECRET'; });
        if (match.length > 0) {
          var val = String(match[0].value || '');
          sheetAppSecretLength = val.length;
          sheetAppSecretMasked = val.length > 4 ? val.substring(0, 4) + '****************' : 'EMPTY';
          sheetAppSecretHasAsterisk = val.indexOf('*') >= 0;
        }
      } catch(se) {}
      
      var appKeyHasAsterisk = appKey.indexOf('*') >= 0;
      var appSecretHasAsterisk = appSecret.indexOf('*') >= 0;
      
      var debugRes = {
        base_url: baseUrl,
        cano_length: cano.length,
        cano_masked: cano.length > 3 ? cano.substring(0, 3) + '*****' : 'EMPTY',
        appkey_length: appKey.length,
        appkey_masked: appKey.length > 4 ? appKey.substring(0, 4) + '****************' : 'EMPTY',
        appkey_has_asterisk: appKeyHasAsterisk,
        appsecret_length: appSecret.length,
        appsecret_masked: appSecret.length > 4 ? appSecret.substring(0, 4) + '****************' : 'EMPTY',
        appsecret_has_asterisk: appSecretHasAsterisk,
        sheet_appsecret_length: sheetAppSecretLength,
        sheet_appsecret_masked: sheetAppSecretMasked,
        sheet_appsecret_has_asterisk: sheetAppSecretHasAsterisk,
        raw_script_keys: rawScriptKeys,
        raw_user_keys: rawUserKeys,
        raw_document_keys: rawDocumentKeys,
        nasd_status: nasd.error ? "FAIL" : "OK",
        nasd_error: nasd.error || "NONE",
        nyse_status: nyse.error ? "FAIL" : "OK",
        nyse_error: nyse.error || "NONE"
      };
      return ContentService.createTextOutput(JSON.stringify(debugRes, null, 2))
        .setMimeType(ContentService.MimeType.JSON);
    } catch(err) {
      return ContentService.createTextOutput(JSON.stringify({ error: err.message }, null, 2))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }

  if (e && e.parameter && e.parameter.action === 'debug_gemini') {
    try {
      var apiKey = getRequiredScriptProperty_(AM_CONFIG.PROPERTY_KEYS.GEMINI_API_KEY);
      var url = 'https://generativelanguage.googleapis.com/v1beta/models?key=' + apiKey;
      var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
      return ContentService.createTextOutput(res.getContentText())
        .setMimeType(ContentService.MimeType.JSON);
    } catch(err) {
      return ContentService.createTextOutput(JSON.stringify({ error: err.message }, null, 2))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }
  
  if (e && e.parameter && e.parameter.action === 'get_macro_data') {
    try {
      var data = getIntegratedMacroMarketData();
      return ContentService.createTextOutput(JSON.stringify(data, null, 2))
        .setMimeType(ContentService.MimeType.JSON);
    } catch(err) {
      return ContentService.createTextOutput(JSON.stringify({ error: err.message }, null, 2))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }
  
  if (e && e.parameter && e.parameter.action === 'get_macro_advice') {
    try {
      var force = (e.parameter.refresh === 'true');
      var advice = getIntegratedMacroAdvice_(force);
      return ContentService.createTextOutput(JSON.stringify(advice, null, 2))
        .setMimeType(ContentService.MimeType.JSON);
    } catch(err) {
      return ContentService.createTextOutput(JSON.stringify({ error: err.message }, null, 2))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }
  
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('JUSIK AI Portfolio')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0, minimum-scale=1.0, maximum-scale=1.0, user-scalable=no');
}

function getPortfolioDataForWeb(forceRefresh) {
  ensureAllSheets_();
  var currentMode = String(getScriptProperty_('PORTFOLIO_MODE', 'REAL')).toUpperCase();
  
  // 🚀 [초고속 0.2초 로딩 튜닝] forceRefresh 가 참이거나 오늘자 적재 데이터가 아예 없을 때만 KIS API 강제 기동
  var today = amTodayString_();
  var existingTodayHoldings = [];
  try {
    existingTodayHoldings = readObjects_(AM_CONFIG.SHEETS.HOLDINGS_CURRENT).filter(function(row) {
      return normalizeDateValue_(row.date) === today;
    });
  } catch(e) {}
  
  if (forceRefresh === true || forceRefresh === 'true' || existingTodayHoldings.length === 0) {
    logInfo_('portfolio_api', 'Forcing real-time holdings collection', { force: forceRefresh });
    collectHoldingsCurrent();
  } else {
    logInfo_('portfolio_api', 'Using cached sheet portfolio holdings snapshot for speed', { holdings_count: existingTodayHoldings.length });
  }
  
  var holdings = readObjects_(AM_CONFIG.SHEETS.HOLDINGS_CURRENT).filter(function(row) {
    var isToday = (normalizeDateValue_(row.date) === today);
    if (!isToday) return false;
    
    var src = String(row.source || '').trim();
    if (currentMode === 'PAPER') {
      return (src.indexOf('paper_') === 0);
    } else {
      return (src.indexOf('kis') === 0 || src.indexOf('manual_') === 0 || src === 'overseas');
    }
  });
  
  // 🚀 최근 가격 추이를 시트 과거 데이터에서 스캔하여 수집
  var allHoldingsRows = [];
  try {
    allHoldingsRows = readObjects_(AM_CONFIG.SHEETS.HOLDINGS_CURRENT);
  } catch(se) {}
  
  var priceHistoryMap = {};
  allHoldingsRows.forEach(function(row) {
    var sym = normalizeStockSymbol_(row.symbol);
    var d = normalizeDateValue_(row.date);
    var p = parseFloat(row.current_price || 0);
    
    if (sym && sym !== 'CASH') {
      if (!priceHistoryMap[sym]) {
        priceHistoryMap[sym] = [];
      }
      priceHistoryMap[sym].push({ date: d, price: p });
    }
  });
  
  // 날짜 정렬 및 다중 기간(7D, 1M, 1Y) 역사적 시세 맵 구축
  var priceHistoryMap7D = {};
  var priceHistoryMap1M = {};
  var priceHistoryMap1Y = {};
  
  Object.keys(priceHistoryMap).forEach(function(sym) {
    priceHistoryMap[sym].sort(function(a, b) {
      return a.date.localeCompare(b.date);
    });
    
    // 중복 날짜 제거
    var uniqueHistory = [];
    var seenDates = {};
    priceHistoryMap[sym].forEach(function(x) {
      if (!seenDates[x.date]) {
        seenDates[x.date] = true;
        uniqueHistory.push(x.price);
      }
    });
    
    // 7D (7일) 슬라이스
    priceHistoryMap7D[sym] = uniqueHistory.length > 7 ? uniqueHistory.slice(uniqueHistory.length - 7) : uniqueHistory;
    // 1M (30일) 슬라이스
    priceHistoryMap1M[sym] = uniqueHistory.length > 30 ? uniqueHistory.slice(uniqueHistory.length - 30) : uniqueHistory;
    // 1Y (365일) 슬라이스
    priceHistoryMap1Y[sym] = uniqueHistory.length > 365 ? uniqueHistory.slice(uniqueHistory.length - 365) : uniqueHistory;
  });
  
  // 🚀 누적 실현 손익(Realized P&L) 계산
  var totalRealizedPl = 0;
  try {
    if (currentMode === 'PAPER') {
      // 모의투자는 종목 거래대장(paper_ledger)에서 누적 계산
      // (기본 설계상 paper_ledger에는 단순 수량/금액만 기재되므로 여기선 0 또는 기입된 realised 수익금 처리)
    } else {
      var rLedger = readObjects_(AM_CONFIG.SHEETS.REAL_LEDGER);
      rLedger.forEach(function(row) {
        totalRealizedPl += parseFloat(row.realized_pl || 0);
      });
    }
  } catch(leErr) {
    logWarn_('ledger_calculation', 'Failed to calculate realized P&L', { error: leErr.message });
  }
  
  var totalPurchase = 0;
  var totalEval = 0;
  var totalCash = 0;
  var assets = [];
  
  holdings.forEach(function(h) {
    var qty = parseFloat(h.quantity || 0);
    var avg = parseFloat(h.avg_price || 0);
    var cur = parseFloat(h.current_price || 0);
    var sym = normalizeStockSymbol_(h.symbol);
    var pAmt = parseFloat(h.purchase_amount || 0);
    var eAmt = parseFloat(h.eval_amount || 0);
    
    totalPurchase += pAmt;
    totalEval += eAmt;
    
    if (sym === 'CASH') {
      // 현금 보유량 별도 추출
      totalCash += eAmt;
    } else {
      // 일반 주식 자산
      var isCoin = (String(h.source).indexOf('upbit') >= 0);
      var isUsdPrice = (String(h.source).indexOf('overseas') >= 0);
      
      // 역사적 시세 매핑 (7D / 1M / 1Y 다중 타임프레임 지원)
      var hist = priceHistoryMap7D[sym] || [];
      var hist1M = priceHistoryMap1M[sym] || [];
      var hist1Y = priceHistoryMap1Y[sym] || [];
      
      // 야후 파이낸스 실제 일봉 종가 연동 (CASH가 아니고 코인이 아닐 때만)
      if (sym !== 'CASH' && !isCoin) {
        try {
          var yahooData = calculate50DayMomentumAndRSI_(sym, true);
          if (yahooData && yahooData.prices && yahooData.prices.length > 0) {
            var yPrices = yahooData.prices;
            var yLen = yPrices.length;
            
            // 실시간 현재가(cur)와 야후 마지막 종가(yPrices[yLen-1]) 간의 비율을 구해 전체 배열에 곱해 스케일 정규화
            var ratio = 1;
            if (yLen > 0 && yPrices[yLen - 1] > 0) {
              ratio = cur / yPrices[yLen - 1];
            }
            
            var normalizedPrices = yPrices.map(function(p) {
              return p * ratio;
            });
            
            // 7D: 최근 7영업일 가격 데이터
            var yHist7D = normalizedPrices.length > 7 ? normalizedPrices.slice(normalizedPrices.length - 7) : normalizedPrices.slice();
            if (yHist7D.length > 0) {
              yHist7D[yHist7D.length - 1] = cur;
            }
            hist = yHist7D;
            
            // 1M: 최근 30영업일 가격 데이터
            var yHist1M = normalizedPrices.length > 30 ? normalizedPrices.slice(normalizedPrices.length - 30) : normalizedPrices.slice();
            if (yHist1M.length > 0) {
              yHist1M[yHist1M.length - 1] = cur;
            }
            hist1M = yHist1M;
            
            // 1Y: 전체 데이터 (1년치 일봉 데이터)
            var yHist1Y = normalizedPrices.slice();
            if (yHist1Y.length > 0) {
              yHist1Y[yHist1Y.length - 1] = cur;
            }
            hist1Y = yHist1Y;
          }
        } catch (yahooErr) {
          logWarn_('portfolio_api', 'Yahoo chart mapping failed for ' + sym + '. Falling back.', { error: yahooErr.message });
        }
      }
      
      // 랜덤 시드 및 해시 함수 (일관된 시뮬레이션을 위함)
      var hashVal = 0;
      for (var charIdx = 0; charIdx < h.symbol.length; charIdx++) {
        hashVal += h.symbol.charCodeAt(charIdx);
      }
      var rndSeed = Math.sin(hashVal || 123);
      
      // 1. 7D 시뮬레이션 보강
      if (hist.length < 2) {
        var simulated = [];
        for (var s = 0; s < 5; s++) {
          var multiplier = 1 + (Math.sin(s + rndSeed) * 0.015);
          simulated.push(Math.round(cur * multiplier));
        }
        simulated.push(Math.round(cur));
        hist = simulated;
      }
      
      // 2. 1M 시뮬레이션 보강
      if (hist1M.length < 2) {
        var simulated1M = [];
        for (var s1 = 0; s1 < 20; s1++) {
          var multiplier1M = 1 + (Math.sin(s1 * 1.5 + rndSeed) * 0.04); // 한 달 변동성 확대
          simulated1M.push(Math.round(cur * multiplier1M));
        }
        simulated1M.push(Math.round(cur));
        hist1M = simulated1M;
      }
      
      // 3. 1Y 시뮬레이션 보강
      if (hist1Y.length < 2) {
        var simulated1Y = [];
        for (var s2 = 0; s2 < 45; s2++) {
          var multiplier1Y = 1 + (Math.sin(s2 * 3.7 + rndSeed) * 0.12); // 일 년 변동성 확대
          simulated1Y.push(Math.round(cur * multiplier1Y));
        }
        simulated1Y.push(Math.round(cur));
        hist1Y = simulated1Y;
      }
      
      assets.push({
        broker: String(h.source).indexOf('manual_') === 0 ? String(h.source).replace('manual_', '') : (h.source === 'paper_trading' ? '모의투자' : 'KIS계좌'),
        symbol: sym,
        name: getStockKoreanName_(sym, h.name),
        qty: qty,
        price: avg,
        currentPrice: cur,
        priceKrw: qty > 0 ? Math.round(pAmt / qty) : 0,
        currentPriceKrw: qty > 0 ? Math.round(eAmt / qty) : 0,
        isCoin: isCoin,
        isUsd: isUsdPrice,
        changePct: h.change_pct !== undefined ? h.change_pct : 0,
        profitLossPct: h.profit_loss_pct !== undefined ? h.profit_loss_pct : 0,
        history: hist,
        history1M: hist1M,
        history1Y: hist1Y,
        profitLossAmount: Math.round(eAmt - pAmt) // 개별 손익금액(원화) 추가
      });
    }
  });
  
  // 현금 제외 주식만의 평가 비중 재조정 연출
  var totalStockEval = totalEval - totalCash;
  assets.forEach(function(a) {
    var aEval = a.qty * a.currentPriceKrw;
    a.portfolio_weight_pct = totalStockEval > 0 ? roundNumber_(aEval / totalStockEval * 100, 2) : 0;
  });
  
  var percentChange = (totalPurchase - totalCash) > 0 ? ((totalEval - totalPurchase) / (totalPurchase - totalCash) * 100) : 0;
  
  return {
    totalAsset: Math.round(totalEval),
    totalPurchase: Math.round(totalPurchase),
    totalProfitLoss: Math.round(totalEval - totalPurchase),
    percentChange: percentChange,
    currentMode: currentMode,
    totalCash: Math.round(totalCash), // 통합 현금 보유량 추가
    totalRealizedPl: Math.round(totalRealizedPl), // 누적 실현 수익금 추가
    assets: assets
  };
}

function updateHoldingFromWeb(broker, symbol, qty, price, isActive) {
  var targetQty = parseFloat(qty || 0);
  var targetPrice = parseFloat(price || 0);
  var cleanSym = normalizeStockSymbol_(symbol);
  
  // 캐시 강제 소거 (시세, 한글명, 포트폴리오 캐시를 완벽히 날려 즉각 복구 보장)
  try {
    var cache = CacheService.getScriptCache();
    cache.remove('AM_PRICE_' + cleanSym);
    cache.remove('AM_NAME_' + cleanSym);
    cache.remove('PRICE_DOM_' + cleanSym);
    cache.remove('KIS_REAL_PORTFOLIO_CACHE');
  } catch(e) {}
  
  if (isActive && targetQty > 0) {
    updateManualHoldingFromTelegram_(broker, symbol, targetQty, targetPrice);
  } else {
    clearManualHoldingFromTelegram_(broker, symbol);
  }
  
  // 🚀 수동 자산이 수정/추가된 경우에는 캐시를 절대 사용하지 않고(true) 실시간 융합 연산을 즉시 갱신함
  collectHoldingsCurrent(true); 
  return { success: true };
}

function getStockNewsForWeb(forceRefresh) {
  var cacheKey = 'STOCK_NEWS_FEED_JSON_V2';
  var cache = CacheService.getScriptCache();
  var force = (forceRefresh === true || forceRefresh === 'true');
  
  if (!force) {
    try {
      var cached = cache.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch(e) {
      logWarn_('news_api', 'Failed to read news cache', { error: e.message });
    }
  }
  
  try {
    var news = fetchLiveFinancialNews_();
    if (news && news.length > 0) {
      var ttl = getNewsCacheTtl_();
      cache.put(cacheKey, JSON.stringify(news), ttl);
      logInfo_('news_api', 'Fetched and cached fresh news', { ttl_seconds: ttl, force_refresh: force });
    }
    return news;
  } catch(e) {
    logWarn_('news_api', 'Failed to serve fresh stock news for web', { error: e.message });
    return [];
  }
}

function toggleInvestmentModeFromWeb(mode) {
  var targetMode = (mode === 'REAL') ? 'REAL' : 'PAPER';
  setScriptProperty_('PORTFOLIO_MODE', targetMode);
  collectHoldingsCurrent();
  return { success: true, mode: targetMode };
}

function getAiPortfolioAdviceForWeb(forceRefresh) {
  var force = (forceRefresh === true || forceRefresh === 'true');
  return getAiPortfolioAdvice_(force);
}

function setTelegramMenuButton() {
  var token = getRequiredScriptProperty_(AM_CONFIG.PROPERTY_KEYS.TELEGRAM_BOT_TOKEN);
  var chatId = getRequiredScriptProperty_(AM_CONFIG.PROPERTY_KEYS.TELEGRAM_CHAT_ID);
  var url = 'https://api.telegram.org/bot' + token + '/setChatMenuButton';
  
  var webAppUrl = getWebAppUrl_();
  if (!webAppUrl) return;
  
  var payload = {
    chat_id: chatId,
    menu_button: {
      type: 'commands'
    }
  };
  
  var response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  
  logInfo_('telegram_bot', 'Updated Chat Menu Button to standard Command Menu', { response: response.getContentText() });
}

function runDiagnostics_() {
  var report = {
    timestamp: amNowString_(),
    system: "JUSIK AI Portfolio Control Center",
    status: "OK",
    diagnostics: {}
  };
  
  // 1. 구글 스프레드시트 6대 핵심 테이블 점검
  try {
    ensureAllSheets_();
    var sheetsReport = {};
    Object.keys(AM_SHEET_SCHEMAS).forEach(function(s) {
      var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(s);
      sheetsReport[s] = {
        exists: !!sheet,
        rowCount: sheet ? sheet.getLastRow() : 0,
        colCount: sheet ? sheet.getLastColumn() : 0
      };
    });
    report.diagnostics.sheets = { status: "OK", details: sheetsReport };
  } catch(se) {
    report.status = "ERROR";
    report.diagnostics.sheets = { status: "FAIL", error: se.message };
  }
  
  // 2. 텔레그램 봇 토큰 및 getMe API 검증
  var token = "";
  try {
    token = getRequiredScriptProperty_(AM_CONFIG.PROPERTY_KEYS.TELEGRAM_BOT_TOKEN);
    var meUrl = 'https://api.telegram.org/bot' + token + '/getMe';
    var meResponse = UrlFetchApp.fetch(meUrl, { muteHttpExceptions: true });
    var meJson = JSON.parse(meResponse.getContentText());
    if (meJson.ok) {
      report.diagnostics.telegram_bot = {
        status: "OK",
        username: meJson.result.username,
        first_name: meJson.result.first_name,
        can_join_groups: meJson.result.can_join_groups
      };
    } else {
      report.status = "ERROR";
      report.diagnostics.telegram_bot = { status: "FAIL", error: meJson.description };
    }
  } catch(te) {
    report.status = "ERROR";
    report.diagnostics.telegram_bot = { status: "FAIL", error: te.message };
  }
  
  // 3. 텔레그램 웹훅 정렬 & 최신화 자가 치유 (Self-healing Webhook Alignment)
  try {
    var webAppUrl = getWebAppUrl_();
    var hookUrl = 'https://api.telegram.org/bot' + token + '/getWebhookInfo';
    var hookResponse = UrlFetchApp.fetch(hookUrl, { muteHttpExceptions: true });
    var hookJson = JSON.parse(hookResponse.getContentText());
    
    if (hookJson.ok) {
      var currentHookUrl = hookJson.result.url || "";
      var aligned = (currentHookUrl === webAppUrl);
      var healingPerformed = false;
      
      if (!aligned && webAppUrl) {
        var setHookUrl = 'https://api.telegram.org/bot' + token + '/setWebhook?url=' + encodeURIComponent(webAppUrl);
        var setHookResponse = UrlFetchApp.fetch(setHookUrl, { muteHttpExceptions: true });
        var setHookJson = JSON.parse(setHookResponse.getContentText());
        if (setHookJson.ok) {
          healingPerformed = true;
          aligned = true;
          currentHookUrl = webAppUrl;
        }
      }
      
      report.diagnostics.telegram_webhook = {
        status: aligned ? "OK" : "OUT_OF_ALIGN",
        webhook_url: currentHookUrl,
        web_app_url: webAppUrl,
        aligned: aligned,
        auto_healed: healingPerformed,
        pending_update_count: hookJson.result.pending_update_count || 0
      };
    } else {
      report.diagnostics.telegram_webhook = { status: "FAIL", error: hookJson.description };
    }
  } catch(we) {
    report.diagnostics.telegram_webhook = { status: "FAIL", error: we.message };
  }
  
  // 4. 운용 모드 및 포트폴리오 스냅샷 상태
  try {
    var mode = String(getScriptProperty_('PORTFOLIO_MODE', 'REAL')).toUpperCase();
    var today = amTodayString_();
    var holdings = readObjects_(AM_CONFIG.SHEETS.HOLDINGS_CURRENT).filter(function(row) {
      return normalizeDateValue_(row.date) === today;
    });
    report.diagnostics.portfolio = {
      status: "OK",
      mode: mode,
      holdingsCount: holdings.length,
      timestamp: amNowString_()
    };
  } catch(pe) {
    report.diagnostics.portfolio = { status: "FAIL", error: pe.message };
  }
  
  return report;
}

// ==================================================
// 🚀 [금융 비서 2.0] 초강력 AI 금융 어드바이저 코어 함수군
// ==================================================

function callGeminiWithSearchGrounding_(prompt) {
  var apiKey = getRequiredScriptProperty_(AM_CONFIG.PROPERTY_KEYS.GEMINI_API_KEY);
  var model = getScriptProperty_(AM_CONFIG.PROPERTY_KEYS.GEMINI_MODEL, 'gemini-1.5-flash');
  var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + apiKey;
  
  var payload = {
    contents: [{ parts: [{ text: prompt }] }],
    tools: [{
      googleSearchRetrieval: {} // 🚀 구글 검색 그라운딩 도구 장착
    }],
    generationConfig: {
      temperature: 0.15
      // 🚀 responseMimeType: 'application/json' 은 검색 도구와 동시 사용 시 400 에러를 유발하므로 과감히 걷어냄
    }
  };
  
  var response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  
  if (response.getResponseCode() !== 200) {
    throw new Error('Gemini Search Grounding call failed: ' + response.getContentText());
  }
  
  var res = JSON.parse(response.getContentText());
  var text = res.candidates[0].content.parts[0].text;
  
  // 🚀 [초강력 복원 파서] 마크다운 ```json 코드 블록과 설명 껍데기들을 싹 청소하고 순수 JSON 본문만 슬라이싱해 정밀 파싱
  try {
    var cleanText = text.replace(/```[a-zA-Z]*/g, '').replace(/`/g, '').trim();
    var startIdx = cleanText.indexOf('{');
    var endIdx = cleanText.lastIndexOf('}');
    if (startIdx >= 0 && endIdx > startIdx) {
      cleanText = cleanText.substring(startIdx, endIdx + 1);
    }
    return JSON.parse(cleanText);
  } catch(parseErr) {
    logWarn_('premarket_ai', 'Failed to parse Gemini Search JSON output; raw text was: ' + text, { error: parseErr.message });
    throw new Error('AI 장전 보고서 응답 분석 실패 (JSON 파싱 에러)');
  }
}

function buildPremarketPrompt_(portfolioDetails) {
  var today = amTodayString_();
  var d = new Date();
  var dayOfWeek = d.getDay(); // 0 is Sunday, 6 is Saturday
  var isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);
  
  var detailsText = "";
  if (portfolioDetails && portfolioDetails.length > 0) {
    detailsText = [
      '\n[현재 사용자의 포트폴리오 보유 종목 및 기술적 보조지표 상태]:',
      portfolioDetails.join('\n'),
      '위의 보유 종목 기술적 상태(골든크로스, 볼린저 밴드 이탈 등)를 바탕으로 사용자가 당일 장중 대응할 때 주의해야 할 핵심 대응 포인트를 top_news 코멘트(comment)나 전체 종합 분석에 자연스럽게 융합하여 서술하라. (단순 확신형 대신 시나리오별 실전 가이드 권장)'
    ].join('\n');
  }

  var prompt = [];
  if (isWeekend) {
    prompt = [
      '너는 대한민국의 아주 냉철하고 예리한 금융 시장 분석 전문가이자 AI 투자 어드바이저이다.',
      '오늘은 주말(토/일요일)로 한국 및 미국 주식시장이 모두 휴장 상태이다.',
      '구글 검색(Google Search Grounding)을 적극적으로 기동하여, 오늘 날짜(' + today + ') 주말에 사용자가 참고할 [주간 글로벌 금융 동향 및 다음 주 거시경제 브리핑]을 VALID JSON 포맷으로 작성해라.',
      detailsText,
      '',
      '요구사항 및 검색할 지표:',
      '1. 이번 한 주간 뉴욕증시(다우, S&P500, 나스닥)의 종합 주간 등락률과 마감 흐름을 구글 검색해서 정확히 알아내어 요약할 것.',
      '2. 주말 현재 고착된 원/달러 환율과 미국 10년물 국채 금리 수치를 검색하여 정확히 요약할 것.',
      '3. 다음 주 한국 및 글로벌 시장을 관통할 초특급 주말 거시 금융 뉴스 또는 메가 트렌드 이슈 3개를 선정해 한글로 요약하고, 관련 수혜/피해 예상 업종(섹터)을 분류해라.',
      '4. 다음 주 투자 심리가 위험 선호(Risk-On) 국면으로 전환될지, 위험 회피(Risk-Off) 국면이 지속될지, 혹은 중립일지 명확히 전망해라.',
      '',
      '응답은 반드시 아래의 JSON 형식이어야 하며 다른 부가 텍스트는 절대 허용하지 않는다:',
      JSON.stringify({
        nasdaq_move: "주간 나스닥 마감율 (예: 주간 +1.50% 상승 마감, 기술주 강세 지속)",
        sp500_move: "주간 S&P500 마감율",
        fx_rate: "주말 원/달러 환율 (예: 1354.20원, 보합세)",
        us10y_yield: "주말 미국 10년물 금리 (예: 4.42%)",
        market_regime: "RISK_ON | RISK_OFF | NEUTRAL",
        market_regime_reason: "다음 주 투자심리 전망 한글 60자 이내",
        top_news: [
          {
            topic: "뉴스 제목",
            summary: "뉴스 핵심 내용 80자 이내 요약",
            affected_sectors: ["수혜/피해 예상 업종1", "업종2"],
            comment: "다음 주 대응 가이드 및 나의 냉철한 진단평"
          }
        ]
      })
    ].join('\n');
  } else {
    prompt = [
      '너는 대한민국의 아주 냉철하고 예리한 금융 시장 분석 전문가이자 AI 투자 어드바이저이다.',
      '구글 검색(Google Search Grounding)을 적극적으로 기동하여, 오늘 날짜(' + today + ') 대한민국 장시작(오전 9시) 직전에 사용자가 참고할 장전 글로벌 금융 동향 보고서를 VALID JSON 포맷으로 작성해라.',
      detailsText,
      '',
      '요구사항 및 검색할 지표:',
      '1. 뉴욕증시(다우, S&P500, 나스닥)의 마감 동향과 등락률 수치를 구글 검색해서 정확히 알아내어 요약할 것.',
      '2. 실시간 원/달러 환율과 미국 10년물 국채 금리 수치를 검색하여 정확히 요약할 것.',
      '3. 오늘 아침 한국 시장 시초가에 영향을 미칠 초특급 글로벌 헤드라인 뉴스 3개를 선정해 한글로 요약하고, 관련 수혜/피해 예상 업종(섹터)을 분류해라.',
      '4. 당일 시초가 투자 심리가 위험 선호(Risk-On) 국면인지, 위험 회피(Risk-Off) 국면인지, 혹은 중립인지 명확히 짚어라.',
      '',
      '응답은 반드시 아래의 JSON 형식이어야 하며 다른 부가 텍스트는 절대 허용하지 않는다:',
      JSON.stringify({
        nasdaq_move: "나스닥 마감율 (예: +1.20% 상승 마감, 기술주 강세 등)",
        sp500_move: "S&P500 마감율",
        fx_rate: "원/달러 환율 수치 (예: 1354.20원)",
        us10y_yield: "미국 10년물 금리 수치 (예: 4.42%)",
        market_regime: "RISK_ON | RISK_OFF | NEUTRAL",
        market_regime_reason: "투자심리 판단 근거 한글 60자 이내",
        top_news: [
          {
            topic: "뉴스 제목",
            summary: "뉴스 핵심 내용 80자 이내 요약",
            affected_sectors: ["수혜/피해 예상 업종1", "업종2"],
            comment: "대응 가이드 및 나의 냉철한 진단평"
          }
        ]
      })
    ].join('\n');
  }
  return prompt;
}


// DART 고유 회사코드 실시간 조회 (보유 종목에 대해서만 타겟 파싱)
function getDartCorpCode_(stockCode) {
  var apiKey = getScriptProperty_(AM_CONFIG.PROPERTY_KEYS.DART_API_KEY, '');
  if (!apiKey) return null;
  
  var cleanSymbol = normalizeStockSymbol_(stockCode);
  
  try {
    var url = 'https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key=' + encodeURIComponent(apiKey);
    var response = UrlFetchApp.fetch(url, { method: 'get', muteHttpExceptions: true });
    if (response.getResponseCode() !== 200) return null;
    
    var blob = response.getBlob().setContentType('application/zip');
    var blobs = Utilities.unzip(blob);
    if (!blobs || blobs.length === 0) return null;
    
    var xmlText = blobs[0].getDataAsString('UTF-8');
    var pattern = /<list>([\s\S]*?)<\/list>/g;
    var match;
    while ((match = pattern.exec(xmlText)) !== null) {
      var block = match[1];
      var blockStockCode = extractXmlText_(block, 'stock_code');
      if (normalizeStockSymbol_(blockStockCode) === cleanSymbol) {
        return extractXmlText_(block, 'corp_code');
      }
    }
  } catch(e) {
    logWarn_('dart_scanner', 'Failed to get corp_code for ' + stockCode, { error: e.message });
  }
  return null;
}

function extractXmlText_(xmlText, tagName) {
  var pattern = new RegExp('<' + tagName + '>([\\s\\S]*?)<\\/' + tagName + '>');
  var match = String(xmlText || '').match(pattern);
  return match ? String(match[1] || '').trim() : '';
}

// 해당 종목의 최근 90일 공시 스캔하여 악재 수준 판별
function scanDartDisclosureRisk_(corpCode, stockCode) {
  var apiKey = getScriptProperty_(AM_CONFIG.PROPERTY_KEYS.DART_API_KEY, '');
  if (!apiKey || !corpCode) return [];
  
  var end = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd');
  var start = Utilities.formatDate(new Date(new Date().getTime() - 90 * 24 * 60 * 60 * 1000), Session.getScriptTimeZone(), 'yyyyMMdd');
  
  try {
    var url = 'https://opendart.fss.or.kr/api/list.json?crtfc_key=' + encodeURIComponent(apiKey) +
      '&corp_code=' + corpCode + '&bgn_de=' + start + '&end_de=' + end + '&page_no=1&page_count=50';
      
    var response = UrlFetchApp.fetch(url, { method: 'get', muteHttpExceptions: true });
    if (response.getResponseCode() !== 200) return [];
    
    var json = JSON.parse(response.getContentText());
    if (json.status !== '000' || !json.list) return [];
    
    var alerts = [];
    json.list.forEach(function(item) {
      var risk = classifyDartDisclosureRisk_(item.report_nm);
      if (risk) {
        alerts.push({
          reportName: item.report_nm,
          riskLevel: risk.level,
          message: risk.message,
          pubDate: String(item.rcept_dt).substring(0, 4) + '-' + String(item.rcept_dt).substring(4, 6) + '-' + String(item.rcept_dt).substring(6, 8)
        });
      }
    });
    return alerts;
  } catch(e) {
    logWarn_('dart_scanner', 'Failed to scan disclosure for ' + stockCode, { error: e.message });
  }
  return [];
}

function classifyDartDisclosureRisk_(reportName) {
  var name = String(reportName || '');
  var patterns = [
    { keyword: '유상증자', level: '🚨 HIGH', message: '대규모 주주배정 유상증자(주주가치 희석 우려)' },
    { keyword: '전환사채', level: '⚠️ MEDIUM', message: '전환사채(CB) 발행 결정(미래 잠재 매물 부담)' },
    { keyword: '신주인수권부사채', level: '⚠️ MEDIUM', message: '신주인수권부사채(BW) 발행 결정(오버행 우려)' },
    { keyword: '감사의견', level: '🚨 HIGH', message: '감사의견 비적정/한정 우려(상장폐지 위험성 고조)' },
    { keyword: '거래정지', level: '🚨 HIGH', message: '상장적격성 실질심사 및 거래정지 관련 사유 발생' },
    { keyword: '불성실공시', level: '⚠️ MEDIUM', message: '공시 불이행에 따른 불성실공시법인 지정 예고' },
    { keyword: '최대주주 변경', level: '⚠️ MEDIUM', message: '경영권 분쟁 혹은 최대주주 지분 변경 공시' }
  ];
  for (var i = 0; i < patterns.length; i += 1) {
    if (name.indexOf(patterns[i].keyword) >= 0) return patterns[i];
  }
  return null;
}

function runPremarketAiReport() {
  ensureAllSheets_();
  
  // 1. KIS/PAPER 보유 자산 로드하여 공시 스캔 타겟 종목 추출
  var today = amTodayString_();
  collectHoldingsCurrent();
  var holdings = readObjects_(AM_CONFIG.SHEETS.HOLDINGS_CURRENT).filter(function(row) {
    return normalizeDateValue_(row.date) === today;
  });
  
  var dartAlerts = [];
  holdings.forEach(function(h) {
    var symbol = normalizeStockSymbol_(h.symbol);
    if (/^[0-9]/.test(symbol)) {
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
    }
  });
  
  // 2. Gemini Search Grounding 기동
  var portfolioDetails = [];
  holdings.forEach(function(h) {
    var symbol = normalizeStockSymbol_(h.symbol);
    if (symbol && symbol !== 'CASH') {
      try {
        var ind = calculate50DayMomentumAndRSI_(symbol);
        portfolioDetails.push(
          '- ' + h.name + ' (' + symbol + '): ' +
          '현재가 ' + formatNumber_(h.current_price) + '원, ' +
          'RSI ' + ind.rsi + ', ' +
          '5일선/20일선 (' + formatNumber_(ind.sma5) + '원/' + formatNumber_(ind.sma20) + '원), ' +
          '볼린저밴드 상한/하한 (' + formatNumber_(ind.bollinger_upper) + '원/' + formatNumber_(ind.bollinger_lower) + '원), ' +
          '감지된 신호: ' + ind.technical_signal
        );
      } catch (err) {
        portfolioDetails.push('- ' + h.name + ' (' + symbol + '): 지표 획득 실패');
      }
    }
  });

  var prompt = buildPremarketPrompt_(portfolioDetails);
  var diagReport = { nasdaq_move: "N/A", sp500_move: "N/A", fx_rate: "N/A", us10y_yield: "N/A", market_regime: "NEUTRAL", market_regime_reason: "통신 지연", top_news: [] };
  
  try {
    diagReport = callGeminiWithSearchGrounding_(prompt);
  } catch(e) {
    logWarn_('premarket_ai', 'Gemini Search Grounding failed; using fallback text', { error: e.message });
  }
  
  // 🚀 [Double-Shielding] AI 검색 결과 지표가 누락되었거나 N/A일 때, 백엔드의 진짜 실시간 지표로 이중 주입 보강!
  try {
    if (!diagReport.fx_rate || diagReport.fx_rate === 'N/A') {
      var liveUsd = getLiveUsdRate_();
      if (liveUsd > 500) {
        diagReport.fx_rate = formatNumber_(Math.round(liveUsd)) + "원 (실시간)";
      }
    }
    if (!diagReport.us10y_yield || diagReport.us10y_yield === 'N/A') {
      var macroData = getIntegratedMacroMarketData();
      if (macroData && macroData.macro && macroData.macro.us_10y_bond) {
        diagReport.us10y_yield = macroData.macro.us_10y_bond.value + "% (실시간)";
      }
    }
    if (!diagReport.nasdaq_move || diagReport.nasdaq_move === 'N/A') {
      try {
        var nasPrice = fetchYahooOverseasCurrentPrice_('^IXIC');
        if (nasPrice && nasPrice.close > 0) {
          var sign = nasPrice.change_pct >= 0 ? '+' : '';
          diagReport.nasdaq_move = nasPrice.close.toLocaleString() + " (" + sign + nasPrice.change_pct.toFixed(2) + "% 실시간)";
        }
      } catch(e) {}
    }
    if (!diagReport.sp500_move || diagReport.sp500_move === 'N/A') {
      try {
        var spPrice = fetchYahooOverseasCurrentPrice_('^GSPC');
        if (spPrice && spPrice.close > 0) {
          var sign = spPrice.change_pct >= 0 ? '+' : '';
          diagReport.sp500_move = spPrice.close.toLocaleString() + " (" + sign + spPrice.change_pct.toFixed(2) + "% 실시간)";
        }
      } catch(e) {}
    }
  } catch(shieldErr) {
    logWarn_('premarket_ai', 'Failed to double-shield premarket metrics', { error: shieldErr.message });
  }
  
  // 3. 리포트 메세지 HTML 조립
  var regimeEmoji = (diagReport.market_regime === 'RISK_ON') ? '🟢 RISK-ON (위험 선호)' : (diagReport.market_regime === 'RISK_OFF' ? '🔴 RISK-OFF (위험 회피)' : '🟡 NEUTRAL (관망세)');
  
  var d = new Date();
  var dayOfWeek = d.getDay(); // 0 is Sunday, 6 is Saturday
  var isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);
  
  var headerTitle = isWeekend ? '🤖 <b>[JUSIK AI 2.0 주말 특별 경제 리포트]</b> ☕️' : '🤖 <b>[JUSIK AI 2.0 오늘의 장전 리포트]</b> 🌅';
  var regimeTitle = isWeekend ? '📊 <b>다음 주 예상 시장 국면:</b> ' : '📊 <b>오늘의 시장 국면:</b> ';
  var macroTitle = isWeekend ? '💰 <b>주말 글로벌 거시 금융 지표 (주간 마감):</b>' : '💰 <b>글로벌 거시 금융 지표:</b>';
  var newsTitle = isWeekend ? '📰 <b>다음 주 지배 거시 경제 메가트렌드 브리핑:</b>' : '📰 <b>장전 핵심 뉴스 AI 브리핑:</b>';
  
  var text = [
    headerTitle,
    '----------------------------------------',
    '📆 <b>발행일시:</b> <code>' + amNowString_() + '</code>',
    regimeTitle + regimeEmoji,
    '💬 <b>판단 근거:</b> <i>' + (diagReport.market_regime_reason || '거시적 흐름 보합 유지') + '</i>',
    '',
    macroTitle,
    '• 원/달러 환율: <b>' + diagReport.fx_rate + '</b>',
    '• 미국 10Y 금리: <b>' + diagReport.us10y_yield + '</b>',
    '• 나스닥 마감: <b>' + diagReport.nasdaq_move + '</b>',
    '• S&P500 마감: <b>' + diagReport.sp500_move + '</b>',
    '',
    newsTitle
  ];  
  var newsList = diagReport.top_news || [];
  newsList.forEach(function(news, idx) {
    text.push(
      '<b>' + (idx+1) + '. ' + news.topic + '</b>',
      '  - <i>요약:</i> ' + news.summary,
      '  - <i>영향 업종:</i> <code>' + (news.affected_sectors || []).join(', ') + '</code>',
      '  - <i>어드바이스:</i> <b>' + news.comment + '</b>\n'
    );
  });
  
  text.push('----------------------------------------');
  text.push('🛡️ <b>실시간 DART 공시 리스크 경고:</b>');
  
  if (dartAlerts.length > 0) {
    dartAlerts.forEach(function(da) {
      text.push(
        '• <b>[' + da.name + ']</b> ' + da.level + ' 공시 감출!',
        '  - ' + da.message,
        '  - <i>공시명:</i> ' + da.reportName + ' (' + da.pubDate + ')\n'
      );
    });
  } else {
    text.push('• 금일 현재 보유 종목 중 돌출된 DART 악재 리스크가 없습니다. 안심하시기 바랍니다. ✅');
  }
  
  text.push('----------------------------------------');
  
  var webAppUrl = getWebAppUrl_();
  var replyMarkup = null;
  if (webAppUrl) {
    replyMarkup = {
      inline_keyboard: [[
        { text: '📊 실시간 대시보드 (TMA) 열기', web_app: { url: webAppUrl } }
      ]]
    };
  }
  
  sendTelegramMessage(text.join('\n'), replyMarkup);
  return { success: true };
}

function runDailyClosePaperTradingReport() {
  ensureAllSheets_();
  var today = amTodayString_();
  collectHoldingsCurrent();
  
  var holdings = readObjects_(AM_CONFIG.SHEETS.HOLDINGS_CURRENT).filter(function(row) {
    return normalizeDateValue_(row.date) === today;
  });
  
  var paperHoldings = holdings.filter(function(h) {
    return h.source === 'paper_trading';
  });
  
  var cash = 5000000;
  try {
    var pRows = readObjects_(AM_CONFIG.SHEETS.PAPER_PORTFOLIO);
    if (pRows.length > 0) {
      var latestRecord = pRows[pRows.length - 1];
      cash = parseFloat(latestRecord.cash_amount || latestRecord.cash_balance || 5000000);
    }
  } catch(e) {}
  
  var totalPurchase = 0;
  var totalEval = 0;
  var textLines = [
    '🤖 <b>[JUSIK AI 오늘의 모의투자 정산 보고서]</b> 🔔',
    '----------------------------------------',
    '📆 <b>정산일자:</b> <code>' + today + '</code>\n'
  ];
  
  if (paperHoldings.length === 0) {
    textLines.push('• 금일 가상 모의투자 보유 주식이 없습니다.');
    textLines.push('• 가상 예수금 잔고: <b>' + formatNumber_(Math.round(cash)) + '원</b>');
  } else {
    textLines.push('📋 <b>보유 가상 주식 세부 잔고:</b>');
    paperHoldings.forEach(function(h) {
      totalPurchase += parseFloat(h.purchase_amount || 0);
      totalEval += parseFloat(h.eval_amount || 0);
      
      var profitSign = h.profit_loss_pct >= 0 ? '+' : '';
      textLines.push(
        '• <b>' + h.name + '</b> (' + h.symbol + ')\n' +
        '  수량: <b>' + formatNumber_(h.quantity) + '주</b> | 평단: <b>' + formatNumber_(Math.round(h.avg_price)) + '원</b>\n' +
        '  평가액: <b>' + formatNumber_(Math.round(h.eval_amount)) + '원</b> | 수익률: <b>' + profitSign + h.profit_loss_pct + '%</b>'
      );
    });
    
    var totalPfs = totalEval - totalPurchase;
    var totalPfsPct = totalPurchase > 0 ? (totalPfs / totalPurchase * 100) : 0;
    var totalSign = totalPfs >= 0 ? '🔺' : '🔻';
    var pctSign = totalPfsPct >= 0 ? '+' : '';
    
    var grandTotalAsset = cash + totalEval;
    var totalYield = (grandTotalAsset - 5000000) / 5000000 * 100;
    var yieldSign = totalYield >= 0 ? '+' : '';
    
    textLines.push('');
    textLines.push('💰 <b>모의투자 계좌 평가 요약:</b>');
    textLines.push('• 주식 총 평가액: <b>' + formatNumber_(Math.round(totalEval)) + '원</b>');
    textLines.push('• 가상 예수금 잔고: <b>' + formatNumber_(Math.round(cash)) + '원</b>');
    textLines.push('• <b>총 가상 자산 평가액: ' + formatNumber_(Math.round(grandTotalAsset)) + '원</b>');
    textLines.push('• ' + totalSign + ' 당일 보유주 손익: <b>' + formatNumber_(Math.round(totalPfs)) + '원</b> (<b>' + pctSign + totalPfsPct.toFixed(2) + '%</b>)');
    textLines.push('• 누적 모의 계좌 수익률: <b>' + yieldSign + totalYield.toFixed(2) + '%</b> (최초 500만 원 대비)');
  }
  
  textLines.push('----------------------------------------');
  
  var webAppUrl = getWebAppUrl_();
  var replyMarkup = null;
  if (webAppUrl) {
    replyMarkup = {
      inline_keyboard: [[
        { text: '📊 실시간 대시보드 (TMA) 열기', web_app: { url: webAppUrl } }
      ]]
    };
  }
  
  sendTelegramMessage(textLines.join('\n'), replyMarkup);
  return { success: true };
}

function installAutomationTriggers() {
  deleteTriggersByHandler_('runPremarketAiReport');
  deleteTriggersByHandler_('runDailyClosePaperTradingReport');
  deleteTriggersByHandler_('updateQuantUniverseDatabase');
  
  ScriptApp.newTrigger('runPremarketAiReport')
    .timeBased()
    .everyDays(1)
    .atHour(8)
    .nearMinute(10)
    .create();
    
  ScriptApp.newTrigger('runDailyClosePaperTradingReport')
    .timeBased()
    .everyDays(1)
    .atHour(15)
    .nearMinute(40)
    .create();

  ScriptApp.newTrigger('updateQuantUniverseDatabase')
    .timeBased()
    .everyDays(1)
    .atHour(3)
    .nearMinute(20)
    .create();
    
  logInfo_('triggers', 'Successfully installed 3 JUSIK AI 2.0 Core Automation Triggers', {});
}

function deleteTriggersByHandler_(handlerFunctionName) {
  try {
    ScriptApp.getProjectTriggers().forEach(function(trigger) {
      if (trigger.getHandlerFunction() === handlerFunctionName) {
        ScriptApp.deleteTrigger(trigger);
      }
    });
  } catch(e) {}
}

function getAiPortfolioAdvice_(forceRefresh) {
  var apiKey = getRequiredScriptProperty_(AM_CONFIG.PROPERTY_KEYS.GEMINI_API_KEY);
  ensureAllSheets_();
  var today = amTodayString_();
  
  // 캐시 로드 검증
  var cacheKey = 'AI_PORTFOLIO_ADVICE';
  var cacheDateKey = 'AI_PORTFOLIO_ADVICE_DATE';
  
  var cachedAdvice = getScriptProperty_(cacheKey, '');
  var cachedDate = getScriptProperty_(cacheDateKey, '');
  
  if (!forceRefresh && cachedAdvice && cachedDate === today) {
    logInfo_('ai_advice', 'Loaded AI portfolio advice from script cache', { date: today });
    return { advice: cachedAdvice };
  }
  
  var holdings = readObjects_(AM_CONFIG.SHEETS.HOLDINGS_CURRENT).filter(function(row) {
    return normalizeDateValue_(row.date) === today;
  });
  
  var portMode = String(getScriptProperty_('PORTFOLIO_MODE', 'REAL')).toUpperCase();
  
  if (holdings.length === 0) {
    return {
      advice: "현재 포트폴리오에 보유한 자산이 존재하지 않습니다. 먼저 자산을 등록하거나 모의투자를 통해 포지션을 구축해 주세요."
    };
  }
  
  var totalPurchase = 0;
  var totalEval = 0;
  var assetsSummary = [];
  
  holdings.forEach(function(h) {
    var pAmt = parseFloat(h.purchase_amount || 0);
    var eAmt = parseFloat(h.eval_amount || 0);
    totalPurchase += pAmt;
    totalEval += eAmt;
    assetsSummary.push(
      "- 종목명: " + h.name + " (" + h.symbol + ") | 비중: " + h.portfolio_weight_pct + "% | 수익률: " + h.profit_loss_pct + "% | 평가액: " + formatNumber_(Math.round(eAmt)) + "원"
    );
  });
  
  var totalPfs = totalEval - totalPurchase;
  var totalPfsPct = totalPurchase > 0 ? (totalPfs / totalPurchase * 100) : 0;
  
  // 🚀 [금융 관제 2.0 매크로 지표 및 실시간 뉴스 융합 스캔]
  var macroText = "FRED & ECOS 거시경제 지표 스캔 정보가 누락되었습니다.";
  try {
    var macroData = getIntegratedMacroMarketData();
    if (macroData && macroData.macro) {
      macroText = [
        "- 미국 10년물 국채금리: " + (macroData.macro.us_10y_bond ? macroData.macro.us_10y_bond.value + "%" : "데이터 없음"),
        "- 미국 연방 기준금리: " + (macroData.macro.us_fed_rate ? macroData.macro.us_fed_rate.value + "%" : "데이터 없음"),
        "- 한국 기준금리: " + (macroData.macro.kr_base_rate ? macroData.macro.kr_base_rate.value + "%" : "데이터 없음"),
        "- 외국인/기관 국내 수급(금일): " + (macroData.market_flow ? JSON.stringify(macroData.market_flow) : "데이터 없음")
      ].join('\n');
    }
  } catch(me) {}

  var newsText = "실시간 경제 뉴스 분석 정보가 존재하지 않습니다.";
  try {
    var newsList = getStockNewsForWeb();
    if (newsList && newsList.length > 0) {
      var newsSummary = [];
      newsList.slice(0, 5).forEach(function(item, idx) {
        newsSummary.push((idx + 1) + ". [" + item.source + "] " + item.title);
      });
      newsText = newsSummary.join('\n');
    }
  } catch(ne) {}

  // 🚀 [퀀트 데이터 통합 연동] VAA 시그널 및 보유 종목 팩터 스코어 정보 수집
  var quantText = "실시간 퀀트 시그널 정보가 누락되었습니다.";
  try {
    var vaa = getVaaStrategySignal();
    var syms = holdings.map(function(h) { return h.symbol; }).filter(function(s) { return s !== 'CASH'; });
    var scoring = getQuantStockScoring(syms);
    var scoringText = scoring.map(function(s) {
      return "  - " + s.name + " (" + s.symbol + ") | 퀀트 종합점수: " + s.quant_score + "점 (PER: " + s.per + " | PBR: " + s.pbr + " | 모멘텀이격: " + s.momentum_pct + "%)";
    }).join('\n');
    
    quantText = [
      "- VAA 동적 자산배분 국면: " + (vaa.regime === 'AGGRESSIVE' ? "공격형(AGGRESSIVE) 국면" : "대피형(DEFENSIVE) 국면"),
      "- VAA 추천 타겟 자산: " + vaa.recommended_symbol + " (모멘텀 스코어: " + vaa.recommended_score + ")",
      "- 보유 주식 퀀트 팩터 스코어 현황:",
      scoringText
    ].join('\n');
  } catch(qe) {}

  var prompt = [
    '너는 월스트리트 헤지펀드의 초일류 수석 포트폴리오 매니저이자 리스크 관리 전문가이다.',
    '유저의 현재 실시간 주식 포트폴리오 비중과 수익률 상태를 분석하고, 실시간 글로벌 거시 경제지표와 5대 경제 뉴스, 그리고 실시간 VAA 자산배분 및 주식 팩터 퀀트 데이터를 정성+정량적으로 융합 연계하여 프로급의 리밸런싱 및 자산배분 자문 보고서를 작성해라.',
    '',
    '현재 포트폴리오 모드: ' + portMode,
    '총 투자원금: ' + formatNumber_(Math.round(totalPurchase)) + '원',
    '총 평가자산: ' + formatNumber_(Math.round(totalEval)) + '원',
    '누적 평가손익: ' + formatNumber_(Math.round(totalPfs)) + '원 (' + totalPfsPct.toFixed(2) + '%)',
    '',
    '보유 자산 세부 리스트:',
    assetsSummary.join('\n'),
    '',
    '실시간 글로벌 거시 경제지표 (FRED & ECOS 스캔):',
    macroText,
    '',
    '최신 5대 경제 금융 뉴스 헤드라인 토픽:',
    newsText,
    '',
    '실시간 퀀트 알고리즘 시그널 및 팩터 데이터:',
    quantText,
    '',
    '요구사항:',
    '1. <b>[1] 매크로/뉴스 및 퀀트 융합 시장 진단</b>, <b>[2] 현재 보유자산 쏠림 리스크 및 비중 피드백</b>, <b>[3] 매크로 금리 및 퀀트 시그널(VAA 포지션 전환, 개별주 팩터 스코어 우수 종목)에 기반한 리밸런싱 조언 (구체적인 매수/매도/교체 제안 포함)</b> 세 항목으로 냉정하고 격조 높은 톤앤매너로 한글로 작성해라.',
    '2. 항목들은 HTML 태그(<b>, <i>, <code> 등)를 적절히 사용해 대시보드 팝업에 가독성 높고 세련되게 표출될 수 있도록 구조화해라.',
    '3. 장황한 인사말은 싹 생략하고 즉시 명품 분석 내용만 출력할 것.'
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
    throw new Error('Gemini API call failed: ' + response.getContentText());
  }
  
  var res = JSON.parse(response.getContentText());
  var replyText = res.candidates[0].content.parts[0].text;
  
  // 캐시 쓰기
  setScriptProperty_(cacheKey, replyText);
  setScriptProperty_(cacheDateKey, today);
  logInfo_('ai_advice', 'Successfully generated and cached new AI advice', { date: today });
  
  return { advice: replyText };
}

function getQuantLabDataForWeb(forceRefresh) {
  var cacheKey = 'QUANT_LAB_WEB_DATA_V3';
  var cache = CacheService.getScriptCache();
  var force = (forceRefresh === true || forceRefresh === 'true');
  
  // 🚀 [이중 캐시 레이어] 강제 리프레시가 아니며 메모리 캐시 적중 시 0.05초 초고속 즉시 반환
  if (!force) {
    try {
      var cached = cache.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch(e) {
      logWarn_('quant_web_api', 'Failed to read quant memory cache', { error: e.message });
    }
  }

  try {
    // 🚀 [시트 보증 스킵] 런타임 지연을 유발하는 ensureAllSheets_() 호출 전격 생략
    // ensureAllSheets_();
    
    // VAA 자산배분 계산 시 캐싱(false)을 활용하여 초고속 반환 처리
    var vaa = getVaaStrategySignal(false);
    
    var holdings = readObjects_(AM_CONFIG.SHEETS.HOLDINGS_CURRENT);
    var today = amTodayString_();
    var uniqueSymbols = {};
    holdings.forEach(function(h) {
      var sym = normalizeStockSymbol_(h.symbol);
      if (sym && sym !== 'CASH' && normalizeDateValue_(h.date) === today) {
        uniqueSymbols[sym] = true;
      }
    });
    var portfolioSymbols = Object.keys(uniqueSymbols);
    
    // 1. [DB 캐시 조회] quant_universe_db 데이터 긁어오기 (덮어쓰기 정책으로 항시 50여 행 유지되어 초고속 조회)
    var dbRows = readObjects_(AM_CONFIG.SHEETS.QUANT_UNIVERSE_DB) || [];
    
    // 최근 기록 날짜 찾기
    var latestDate = '';
    if (dbRows.length > 0) {
      var dates = dbRows.map(function(r) { return String(r.date || ''); }).filter(Boolean);
      dates.sort();
      if (dates.length > 0) {
        latestDate = dates[dates.length - 1];
      }
    }
    
    var dbRowsFiltered = dbRows.filter(function(r) {
      return String(r.date || '') === latestDate;
    });
    
    var scoring = [];
    var domesticScoring = [];
    var usScoring = [];
    
    // DB 적재량이 부족하거나(최소 30개 미만) 최근 날짜가 전혀 없다면, 
    // 40초 지연을 피하기 위해 실시간 연산 대신 즉시 로컬 Mock 팩터 데이터 조립 반환 (배치 구동 유도)
    if (dbRowsFiltered.length < 30) {
      logWarn_('quant_web_api', 'Quant database cache empty or insufficient (' + dbRowsFiltered.length + ' rows). Serving fast mock list to prevent 40s lag.');
      
      var unionMap = {};
      portfolioSymbols.forEach(function(s) { unionMap[s] = true; });
      DOMESTIC_MARKET_UNIVERSE.forEach(function(s) { unionMap[s] = true; });
      US_MARKET_UNIVERSE.forEach(function(s) { unionMap[s] = true; });
      var totalPool = Object.keys(unionMap);
      
      // 실시간 전체 50개 연산 대신, AM_QUANT_FUNDAMENTAL_DB와 현재가만을 조립한 0.5초 기산기 기동
      var fastScoring = totalPool.map(function(sym) {
        var cleanSym = normalizeStockSymbol_(sym);
        var isDom = /^\d{6}$/.test(cleanSym);
        
        var priceData = null;
        if (isDom) {
          try { priceData = fetchKisCurrentPrice_(cleanSym); } catch(e) { priceData = fetchNaverStockPrice_(cleanSym); }
        } else {
          try { priceData = fetchKisOverseasCurrentPrice_(cleanSym); } catch(e) { priceData = fetchYahooOverseasCurrentPrice_(cleanSym); }
        }
        
        var currentPrice = priceData ? parseFloat(priceData.close || 0) : 0;
        var name = priceData ? String(priceData.name || cleanSym).trim() : cleanSym;
        name = getStockKoreanName_(cleanSym, name);
        
        var fund = AM_QUANT_FUNDAMENTAL_DB[cleanSym] || { eps: 0, bps: 0, div: 0, grow: 10, debt: 100, beta: 1.0 };
        var per = 0; var pbr = 0; var divYield = 0; var roe = 0;
        
        if (currentPrice > 0) {
          if (fund.eps > 0) per = currentPrice / fund.eps;
          if (fund.bps > 0) pbr = currentPrice / fund.bps;
          if (fund.div > 0) divYield = (fund.div / currentPrice) * 100;
        }
        if (fund.eps > 0 && fund.bps > 0) roe = (fund.eps / fund.bps) * 100;
        
        var srimPrice = 0; var safetyMargin = 0;
        if (fund.eps > 0 && fund.bps > 0) {
          srimPrice = fund.bps * (roe / 8.0);
          if (srimPrice > 0 && currentPrice > 0) safetyMargin = ((srimPrice - currentPrice) / srimPrice) * 100;
        }
        
        var isPortfolio = (uniqueSymbols[cleanSym] === true);
        var momentumPct = 0;
        var rsi = 50;
        if (isPortfolio) {
          try {
            var indicators = calculate50DayMomentumAndRSI_(cleanSym);
            momentumPct = indicators.momentum_pct;
            rsi = indicators.rsi;
          } catch(indErr) {
            logWarn_('quant_fast_scoring', 'Failed to fetch indicators for portfolio ' + cleanSym, { error: indErr.message });
          }
        }
        
        return {
          symbol: cleanSym,
          name: name,
          price: currentPrice,
          per: per > 0 ? roundNumber_(per, 2) : 'N/A',
          pbr: pbr > 0 ? roundNumber_(pbr, 2) : 'N/A',
          momentum_pct: roundNumber_(momentumPct, 2),
          rsi: rsi,
          srim_price: srimPrice > 0 ? Math.round(srimPrice) : 0,
          safety_margin: srimPrice > 0 && currentPrice > 0 ? roundNumber_(safetyMargin, 1) : 0,
          roe: roe > 0 ? roundNumber_(roe, 2) : 0,
          debt: fund.debt !== undefined ? fund.debt : 100,
          div_yield: divYield > 0 ? roundNumber_(divYield, 2) : 0,
          beta: fund.beta !== undefined ? fund.beta : 1.0,
          peg: 'N/A',
          
          per_val: per > 0 ? per : 9999,
          pbr_val: pbr > 0 ? pbr : 9999,
          momentum_val: momentumPct,
          roe_val: roe > 0 ? roe : -9999,
          debt_val: fund.debt !== undefined ? fund.debt : 9999,
          div_yield_val: divYield > 0 ? divYield : -9999,
          beta_val: fund.beta !== undefined ? fund.beta : 9999,
          peg_val: 9999,
          quant_score: 0
        };
      });
      
      // 가중 정렬기 적용
      var scoringLookup = {};
      var fastScored = sortHelper(fastScoring);
      fastScored.forEach(function(item) {
        scoringLookup[item.symbol] = item;
      });
      
      scoring = portfolioSymbols.map(function(s) { return scoringLookup[s]; }).filter(Boolean);
      domesticScoring = DOMESTIC_MARKET_UNIVERSE.map(function(s) { return scoringLookup[s]; }).filter(Boolean);
      usScoring = US_MARKET_UNIVERSE.map(function(s) { return scoringLookup[s]; }).filter(Boolean);
    } else {
      // DB 캐시 정상 로드 성공 -> 매핑 사전 구성
      var dbLookup = {};
      dbRowsFiltered.forEach(function(row) {
        var per = row.per;
        var pbr = row.pbr;
        var peg = row.peg;
        var per_val = (per === 'N/A' || isNaN(per)) ? 9999 : parseFloat(per);
        var pbr_val = (pbr === 'N/A' || isNaN(pbr)) ? 9999 : parseFloat(pbr);
        var peg_val = (peg === 'N/A' || isNaN(peg)) ? 9999 : parseFloat(peg);
        
        var item = {
          symbol: row.symbol,
          name: getStockKoreanName_(row.symbol, row.name),
          price: parseFloat(row.price || 0),
          per: per,
          pbr: pbr,
          momentum_pct: parseFloat(row.momentum_pct || 0),
          rsi: parseInt(row.rsi || 50),
          srim_price: parseInt(row.srim_price || 0),
          safety_margin: parseFloat(row.safety_margin || 0),
          roe: parseFloat(row.roe || 0),
          debt: parseFloat(row.debt || 100),
          div_yield: parseFloat(row.div_yield || 0),
          beta: parseFloat(row.beta || 1.0),
          peg: peg,
          
          per_val: per_val,
          pbr_val: pbr_val,
          momentum_val: parseFloat(row.momentum_pct || 0),
          roe_val: parseFloat(row.roe || 0),
          debt_val: parseFloat(row.debt || 100),
          div_yield_val: parseFloat(row.div_yield || 0),
          beta_val: parseFloat(row.beta || 1.0),
          peg_val: peg_val,
          quant_score: 0
        };
        dbLookup[row.symbol] = item;
      });
      
      // 💡 [자가 치유 엔진] 캐시 유실 혹은 연산 실패 종목(price <= 0) 감지 시 실시간 스캔 보충
      var selfHealStock = function(symbol, cachedItem) {
        if (!cachedItem || cachedItem.price <= 0) {
          try {
            // 🚀 [최적화] 자가치유 시 야후 파이낸스 일봉 차트 순차 조회를 절대 기동하지 않고, 
            // 현재가만 1회 다이렉트 조회하여 결합함으로써 연쇄 API 병목을 0초화
            var cleanSym = normalizeStockSymbol_(symbol);
            var isDom = /^\d{6}$/.test(cleanSym);
            var priceData = null;
            if (isDom) {
              try { priceData = fetchKisCurrentPrice_(cleanSym); } catch(e) { priceData = fetchNaverStockPrice_(cleanSym); }
            } else {
              try { priceData = fetchKisOverseasCurrentPrice_(cleanSym); } catch(e) { priceData = fetchYahooOverseasCurrentPrice_(cleanSym); }
            }
            var currentPrice = priceData ? parseFloat(priceData.close || 0) : 0;
            var name = priceData ? String(priceData.name || cleanSym).trim() : cleanSym;
            name = getStockKoreanName_(cleanSym, name);
            
            var fund = AM_QUANT_FUNDAMENTAL_DB[cleanSym] || { eps: 0, bps: 0, div: 0, grow: 10, debt: 100, beta: 1.0 };
            var per = 0; var pbr = 0; var divYield = 0; var roe = 0;
            if (currentPrice > 0) {
              if (fund.eps > 0) per = currentPrice / fund.eps;
              if (fund.bps > 0) pbr = currentPrice / fund.bps;
              if (fund.div > 0) divYield = (fund.div / currentPrice) * 100;
            }
            if (fund.eps > 0 && fund.bps > 0) roe = (fund.eps / fund.bps) * 100;
            
            var srimPrice = 0; var safetyMargin = 0;
            if (fund.eps > 0 && fund.bps > 0) {
              srimPrice = fund.bps * (roe / 8.0);
              if (srimPrice > 0 && currentPrice > 0) safetyMargin = ((srimPrice - currentPrice) / srimPrice) * 100;
            }
            
            var isPortfolio = (uniqueSymbols[cleanSym] === true);
            var momentumPct = 0;
            var rsi = 50;
            if (isPortfolio) {
              try {
                var indicators = calculate50DayMomentumAndRSI_(cleanSym);
                momentumPct = indicators.momentum_pct;
                rsi = indicators.rsi;
              } catch(indErr) {
                logWarn_('quant_self_heal', 'Failed to fetch indicators for portfolio ' + cleanSym, { error: indErr.message });
              }
            }
            
            logInfo_('quant_self_heal_optimized', 'Optimized self-healed symbol ' + symbol + ' (Portfolio indicators: ' + isPortfolio + ')');
            
            return {
              symbol: cleanSym,
              name: name,
              price: currentPrice,
              per: per > 0 ? roundNumber_(per, 2) : 'N/A',
              pbr: pbr > 0 ? roundNumber_(pbr, 2) : 'N/A',
              momentum_pct: roundNumber_(momentumPct, 2),
              rsi: rsi,
              srim_price: srimPrice > 0 ? Math.round(srimPrice) : 0,
              safety_margin: srimPrice > 0 && currentPrice > 0 ? roundNumber_(safetyMargin, 1) : 0,
              roe: roe > 0 ? roundNumber_(roe, 2) : 0,
              debt: fund.debt !== undefined ? fund.debt : 100,
              div_yield: divYield > 0 ? roundNumber_(divYield, 2) : 0,
              beta: fund.beta !== undefined ? fund.beta : 1.0,
              peg: 'N/A',
              
              per_val: per > 0 ? per : 9999,
              pbr_val: pbr > 0 ? pbr : 9999,
              momentum_val: momentumPct,
              roe_val: roe > 0 ? roe : -9999,
              debt_val: fund.debt !== undefined ? fund.debt : 9999,
              div_yield_val: divYield > 0 ? divYield : -9999,
              beta_val: fund.beta !== undefined ? fund.beta : 9999,
              peg_val: 9999,
              quant_score: 0
            };
          } catch(err) {
            logWarn_('quant_self_heal', 'Failed to optimized self-heal symbol ' + symbol, { error: err.message });
          }
        }
        return cachedItem;
      };

      // 국내/미국 탭 매핑 (자가 치유 필터 적용)
      domesticScoring = DOMESTIC_MARKET_UNIVERSE.map(function(s) {
        return selfHealStock(s, dbLookup[s]);
      }).filter(Boolean);
      
      usScoring = US_MARKET_UNIVERSE.map(function(s) {
        return selfHealStock(s, dbLookup[s]);
      }).filter(Boolean);
      
      // 보유 탭 매핑 (유니버스에 없는 신규 수동 종목은 실시간 가벼운 스캔 보충, 유실 캐시는 자가 치유)
      portfolioSymbols.forEach(function(s) {
        var resolved = selfHealStock(s, dbLookup[s]);
        if (resolved) {
          scoring.push(resolved);
        }
      });
    }
    
    // 기본 종합 퀀트 정렬 수행 (백엔드 기본 정렬)
    var sortHelper = function(arr) {
      if (arr.length === 0) return arr;
      var size = arr.length;
      var sortedPer = arr.slice().sort(function(a, b) { return a.per_val - b.per_val; });
      var sortedPbr = arr.slice().sort(function(a, b) { return a.pbr_val - b.pbr_val; });
      var sortedMom = arr.slice().sort(function(a, b) { return b.momentum_val - a.momentum_val; });
      
      arr.forEach(function(stock) {
        var perRank = sortedPer.indexOf(stock);
        var pbrRank = sortedPbr.indexOf(stock);
        var momRank = sortedMom.indexOf(stock);
        
        var valPerScore = (stock.per_val < 9999) ? ((size - 1 - perRank) / (size - 1 || 1) * 50) : 0;
        var valPbrScore = (stock.pbr_val < 9999) ? ((size - 1 - pbrRank) / (size - 1 || 1) * 50) : 0;
        var valueScore = valPerScore + valPbrScore;
        var momentumScore = (size - 1 - momRank) / (size - 1 || 1) * 100;
        
        stock.quant_score = Math.round((valueScore * 0.5) + (momentumScore * 0.5));
      });
      return arr.sort(function(a, b) { return b.quant_score - a.quant_score; });
    };
    
    scoring = sortHelper(scoring);
    domesticScoring = sortHelper(domesticScoring);
    usScoring = sortHelper(usScoring);
    
    var resultObj = {
      success: true,
      timestamp: amNowString_() + ' (DB 캐시: ' + (latestDate || 'N/A') + ')',
      vaa: vaa,
      scoring: scoring,
      domesticScoring: domesticScoring,
      usScoring: usScoring
    };
    
    // 🚀 연산 결과 캐싱 기동 (15분간 메모리 적재)
    try {
      cache.put(cacheKey, JSON.stringify(resultObj), 900);
      logInfo_('quant_web_api', 'Computed and cached fresh Quant Lab web data', { force: force });
    } catch(ce) {}
    
    return resultObj;
  } catch(e) {
    logWarn_('quant_web_api', 'Failed to fetch Quant Lab data for web', { error: e.message });
    return {
      success: false,
      error: e.message
    };
  }
}

function getWebAppUrl_() {
  var customUrl = getScriptProperty_('CUSTOM_DASHBOARD_URL', '');
  if (customUrl) return customUrl;
  
  var url = getScriptProperty_('WEB_APP_URL', '');
  if (url) return url;
  try {
    return ScriptApp.getService().getUrl();
  } catch(e) {
    return '';
  }
}

function getLogsForDebug_() {
  ensureAllSheets_();
  var logs = readObjects_(AM_CONFIG.SHEETS.LOGS) || [];
  return logs.slice(Math.max(0, logs.length - 40)).reverse();
}
