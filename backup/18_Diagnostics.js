function runKisConnectionDiagnostics() {
  return withLogging_('kis_diagnostics', function() {
    ensureAllSheets_();
    var result = {
      checked_at: amNowString_(),
      properties: diagnoseKisProperties_(),
      token: null,
      current_price: null,
      daily_prices: null
    };

    result.token = diagnoseStep_('token', function() {
      var token = getKisAccessToken_();
      return {
        ok: !!token,
        token_prefix: token ? token.substring(0, 8) + '...' : ''
      };
    });

    result.current_price = diagnoseStep_('current_price', function() {
      var quote = fetchKisCurrentPrice_('005930');
      return {
        ok: true,
        symbol: quote.symbol,
        close: quote.close,
        change_pct: quote.change_pct,
        volume: quote.volume,
        trading_value: quote.trading_value
      };
    });

    result.daily_prices = diagnoseStep_('daily_prices', function() {
      var endDate = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd');
      var startDate = Utilities.formatDate(new Date(new Date().getTime() - 180 * 24 * 60 * 60 * 1000), Session.getScriptTimeZone(), 'yyyyMMdd');
      var rows = fetchKisDailyPrices_('005930', startDate, endDate);
      return {
        ok: rows.length > 0,
        rows: rows.length,
        first_date: rows.length ? rows[0].date : '',
        last_date: rows.length ? rows[rows.length - 1].date : ''
      };
    });

    logInfo_('kis_diagnostics', 'KIS diagnostics completed', result);
    SpreadsheetApp.getUi().alert(formatKisDiagnosticMessage_(result));
    return result;
  });
}

function diagnoseKisProperties_() {
  var keys = AM_CONFIG.PROPERTY_KEYS;
  return {
    KIS_ENV: getScriptProperty_(keys.KIS_ENV, ''),
    KIS_BASE_URL: getScriptProperty_(keys.KIS_BASE_URL, ''),
    KIS_APP_KEY: maskSecret_(getScriptProperty_(keys.KIS_APP_KEY, '')),
    KIS_APP_SECRET: maskSecret_(getScriptProperty_(keys.KIS_APP_SECRET, '')),
    has_token: !!getScriptProperty_(keys.KIS_ACCESS_TOKEN, ''),
    token_expires_at: getScriptProperty_(keys.KIS_ACCESS_TOKEN_EXPIRES_AT, '')
  };
}

function diagnoseStep_(name, fn) {
  try {
    return fn();
  } catch (err) {
    return {
      ok: false,
      step: name,
      error: err.message || String(err)
    };
  }
}

function formatKisDiagnosticMessage_(result) {
  var lines = [];
  lines.push('KIS 연결 진단 결과');
  lines.push('');
  lines.push('KIS_ENV: ' + (result.properties.KIS_ENV || '(missing)'));
  lines.push('KIS_BASE_URL: ' + (result.properties.KIS_BASE_URL || '(missing)'));
  lines.push('APP_KEY: ' + (result.properties.KIS_APP_KEY || '(missing)'));
  lines.push('APP_SECRET: ' + (result.properties.KIS_APP_SECRET || '(missing)'));
  lines.push('');
  lines.push('토큰: ' + diagnosticStatusText_(result.token));
  lines.push('현재가 005930: ' + diagnosticStatusText_(result.current_price));
  lines.push('일봉 005930: ' + diagnosticStatusText_(result.daily_prices));
  lines.push('');
  lines.push('자세한 오류는 logs 시트의 kis_diagnostics 행을 확인하세요.');
  return lines.join('\n');
}

function diagnosticStatusText_(stepResult) {
  if (!stepResult) return '실행 안 됨';
  if (stepResult.ok) return '정상';
  return '실패 - ' + stepResult.error;
}

function maskSecret_(value) {
  if (!value) return '';
  if (String(value).length <= 8) return '****';
  return String(value).substring(0, 4) + '...' + String(value).slice(-4);
}

function runTelegramConnectionDiagnostics() {
  return withLogging_('telegram_diagnostics', function() {
    ensureAllSheets_();
    var ui = SpreadsheetApp.getUi();
    
    var token = getScriptProperty_(AM_CONFIG.PROPERTY_KEYS.TELEGRAM_BOT_TOKEN, '');
    var chatId = getScriptProperty_(AM_CONFIG.PROPERTY_KEYS.TELEGRAM_CHAT_ID, '');
    
    var result = {
      checked_at: amNowString_(),
      has_token: !!token,
      has_chat_id: !!chatId,
      chat_id_masked: chatId ? chatId.substring(0, 4) + '...' : '',
      script_url: null,
      telegram_webhook: null,
      api_ok: false,
      api_error: null
    };
    
    // 1. Get Google Apps Script Web App URL
    try {
      var detectedUrl = ScriptApp.getService().getUrl();
      var activeRealUrl = 'https://script.google.com/macros/s/AKfycbysCckjcPefqrgZyMcZvksLjVJzpKO1yUUye8CPuiNT21ms3tEZF9dKCjm_gwYlJ1T6/exec';
      if (!detectedUrl || detectedUrl.indexOf('AKfycbys') < 0) {
        result.script_url = activeRealUrl;
      } else {
        result.script_url = detectedUrl;
      }
    } catch (e) {
      result.script_url = 'https://script.google.com/macros/s/AKfycbysCckjcPefqrgZyMcZvksLjVJzpKO1yUUye8CPuiNT21ms3tEZF9dKCjm_gwYlJ1T6/exec';
    }
    
    // 2. Fetch webhook info from Telegram
    if (token) {
      try {
        var url = 'https://api.telegram.org/bot' + token + '/getWebhookInfo';
        var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
        var resText = res.getContentText();
        var resJson = JSON.parse(resText);
        
        if (resJson.ok) {
          result.api_ok = true;
          result.telegram_webhook = resJson.result;
        } else {
          result.api_error = resText;
        }
      } catch (err) {
        result.api_error = err.message || String(err);
      }
    }
    
    logInfo_('telegram_diagnostics', 'Telegram diagnostics completed', result);
    
    // 3. Show beautiful diagnostic popup
    var htmlContent = buildTelegramDiagnosticHtml_(result);
    var htmlOutput = HtmlService.createHtmlOutput(htmlContent)
      .setWidth(720)
      .setHeight(560);
    ui.showModalDialog(htmlOutput, '텔레그램 챗봇 실시간 진단 도구');
    
    return result;
  });
}

function buildTelegramDiagnosticHtml_(result) {
  var tg = result.telegram_webhook || {};
  var matchStatus = '❌ 주소 불일치';
  var matchColor = '#ef4444';
  
  if (result.script_url && tg.url) {
    var cleanedScriptUrl = result.script_url.trim().toLowerCase();
    var cleanedTgUrl = tg.url.trim().toLowerCase();
    if (cleanedScriptUrl === cleanedTgUrl) {
      matchStatus = '✅ 주소 일치';
      matchColor = '#10b981';
    }
  }
  
  var tgUrlDisplay = tg.url || '(등록된 웹훅 없음)';
  var lastError = tg.last_error_message || '(에러 기록 없음)';
  var lastErrorDate = tg.last_error_date ? new Date(tg.last_error_date * 1000).toLocaleString('ko-KR') : '-';
  var pendingCount = tg.pending_update_count !== undefined ? tg.pending_update_count : 0;
  
  var diagnosticLines = [];
  diagnosticLines.push('<!doctype html><html><head><base target="_top">');
  diagnosticLines.push('<style>');
  diagnosticLines.push('body{font-family:"Segoe UI",Roboto,sans-serif;margin:0;padding:16px;color:#1f2937;background:#f3f4f6;}');
  diagnosticLines.push('.card{background:#ffffff;border-radius:12px;box-shadow:0 4px 6px -1px rgba(0,0,0,0.1);padding:20px;margin-bottom:16px;}');
  diagnosticLines.push('h1{font-size:20px;font-weight:700;margin-top:0;margin-bottom:16px;color:#1e3a8a;}');
  diagnosticLines.push('table{width:100%;border-collapse:collapse;margin:12px 0;}');
  diagnosticLines.push('th,td{text-align:left;padding:10px;border-bottom:1px solid #e5e7eb;font-size:14px;}');
  diagnosticLines.push('th{font-weight:600;color:#4b5563;width:180px;}');
  diagnosticLines.push('.badge{display:inline-block;padding:4px 8px;border-radius:6px;font-size:12px;font-weight:700;color:#ffffff;}');
  diagnosticLines.push('.badge-success{background:#10b981;}');
  diagnosticLines.push('.badge-danger{background:#ef4444;}');
  diagnosticLines.push('.action-title{font-size:15px;font-weight:700;color:#1e3a8a;margin-top:0;margin-bottom:8px;}');
  diagnosticLines.push('.action-box{background:#fef3c7;border-left:4px solid #f59e0b;padding:12px;border-radius:4px;margin-top:12px;font-size:13px;line-height:1.5;}');
  diagnosticLines.push('textarea{width:100%;box-sizing:border-box;height:60px;font-family:monospace;font-size:12px;margin-top:4px;padding:6px;background:#f9fafb;border:1px solid #d1d5db;border-radius:6px;resize:none;}');
  diagnosticLines.push('</style></head><body>');
  
  diagnosticLines.push('<div class="card">');
  diagnosticLines.push('<h1>🤖 텔레그램 챗봇 및 웹훅 연결 정밀 진단</h1>');
  
  diagnosticLines.push('<table>');
  diagnosticLines.push('<tr><th>텔레그램 봇 토큰 설정</th><td>' + (result.has_token ? '<span class="badge badge-success">등록됨</span>' : '<span class="badge badge-danger">미등록 (설정 필요)</span>') + '</td></tr>');
  diagnosticLines.push('<tr><th>내 텔레그램 Chat ID 설정</th><td>' + (result.has_chat_id ? '<span class="badge badge-success">등록됨 (' + result.chat_id_masked + ')</span>' : '<span class="badge badge-danger">미등록 (설정 필요)</span>') + '</td></tr>');
  diagnosticLines.push('<tr><th>구글 시트 웹 앱 URL</th><td><textarea readonly>' + (result.script_url || '조회 실패') + '</textarea></td></tr>');
  diagnosticLines.push('<tr><th>텔레그램에 등록된 웹훅</th><td><textarea readonly>' + tgUrlDisplay + '</textarea></td></tr>');
  
  if (result.has_token && result.api_ok) {
    diagnosticLines.push('<tr><th>웹훅 주소 매칭 상태</th><td><span class="badge" style="background:' + matchColor + ';">' + matchStatus + '</span></td></tr>');
    diagnosticLines.push('<tr><th>대기 중인 메시지 수</th><td>' + pendingCount + ' 건' + (pendingCount > 0 ? ' <span style="color:#f59e0b;font-weight:700;">(구글 서버가 응답하지 않는 중)</span>' : '') + '</td></tr>');
    diagnosticLines.push('<tr><th>마지막 전송 실패 시각</th><td>' + lastErrorDate + '</td></tr>');
    diagnosticLines.push('<tr><th>마지막 전송 실패 원인</th><td><strong style="color:#ef4444;">' + lastError + '</strong></td></tr>');
  } else {
    diagnosticLines.push('<tr><th>텔레그램 API 통신</th><td><span class="badge badge-danger">실패</span><br/><small style="color:#ef4444;">' + (result.api_error || '토큰이 올바르지 않거나 텔레그램 서버와 연결할 수 없습니다.') + '</small></td></tr>');
  }
  diagnosticLines.push('</table>');
  diagnosticLines.push('</div>');
  
  diagnosticLines.push('<div class="card" style="background:#eff6ff;border:1px solid #bfdbfe;">');
  diagnosticLines.push('<div class="action-title">🛠️ 진단 결과에 따른 해결 가이드</div>');
  
  if (!result.has_token || !result.has_chat_id) {
    diagnosticLines.push('<div class="action-box">스프레드시트의 <strong>ScriptProperties</strong>에 <code>TELEGRAM_BOT_TOKEN</code>과 <code>TELEGRAM_CHAT_ID</code>가 완벽히 등록되었는지 확인해 주세요. 등록되어 있지 않으면 챗봇이 시작조차 되지 않습니다.</div>');
  } else if (!result.api_ok) {
    diagnosticLines.push('<div class="action-box">텔레그램 봇 토큰(Token) 값이 올바르지 않습니다. BotFather를 통해 발급받은 정식 봇 토큰 값을 시트 설정에 정확하게 입력했는지 대조해 보세요.</div>');
  } else if (matchStatus.indexOf('불일치') >= 0) {
    diagnosticLines.push('<div class="action-box">텔레그램에 등록된 주소와 현재 구글 웹 앱의 주소가 다릅니다! <strong>구글 시트 상단 메뉴 [AI Scanner] > [8. 자동화] > [텔레그램 양방향 웹훅 등록]</strong>을 실행하여 위의 <strong>구글 시트 웹 앱 URL</strong>을 복사해서 붙여넣고 확인을 눌러 다시 등록해 주세요.</div>');
  } else if (pendingCount > 0 || lastError.indexOf('Unauthorized') >= 0 || lastError.indexOf('401') >= 0 || lastError.indexOf('403') >= 0) {
    diagnosticLines.push('<div class="action-box"><strong>구글 웹 앱 배포 권한 에러(401/403)</strong>가 발생 중입니다! 구글 웹 앱 배포 시 <strong>[액세스할 수 있는 사용자(Who has access)]</strong>를 반드시 <strong>[모든 사람(Anyone)]</strong>으로 지정하여 새 버전을 다시 배포해야 합니다. 나만(Me)으로 설정되어 있을 시 텔레그램 서버의 노크가 전부 거절당합니다.</div>');
  } else if (lastError.indexOf('Connection') >= 0 || lastError.indexOf('DNS') >= 0) {
    diagnosticLines.push('<div class="action-box">구글 서버 또는 텔레그램 서버 간 일시적인 네트워크 장애입니다. 잠시 후 웹 앱을 재배포하거나 웹훅을 재등록해 주세요.</div>');
  } else {
    diagnosticLines.push('<div class="action-box">연결 상태가 기술적으로 <strong>100% 정상</strong>입니다! 현재 사용자님의 텔레그램 대화방이 스프레드시트에 지정된 봇 대화방이 맞는지 대화창을 확인해 주시고, 봇에게 <code>/help</code>를 전송한 뒤 에디터의 [실행] 기록을 다시 관찰해 보세요.</div>');
  }
  
  diagnosticLines.push('<div style="text-align:right;margin-top:16px;">');
  diagnosticLines.push('<button type="button" style="padding:8px 16px;background:#1e3a8a;color:#ffffff;border:none;border-radius:6px;font-weight:700;cursor:pointer;" onclick="google.script.host.close()">진단 완료 및 닫기</button>');
  diagnosticLines.push('</div>');
  diagnosticLines.push('</div>');
  
  diagnosticLines.push('</body></html>');
  return diagnosticLines.join('');
}

