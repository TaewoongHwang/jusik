var globalIsInteractiveContext_ = true;

function logInfo_(moduleName, message, details) {
  logMessage_('INFO', moduleName, message, details);
}

function logWarn_(moduleName, message, details) {
  logMessage_('WARN', moduleName, message, details);
}

function logError_(moduleName, message, details) {
  logMessage_('ERROR', moduleName, message, details);
}

function logMessage_(level, moduleName, message, details) {
  try {
    pruneLogsIfNeeded_();
    prependObjectRow_(AM_CONFIG.SHEETS.LOGS, {
      timestamp: amNowString_(),
      level: level,
      module: moduleName,
      message: message,
      details: details || ''
    });
  } catch (err) {
    console.error(level + ' [' + moduleName + '] ' + message + ' ' + JSON.stringify(details || '') + ' ' + err);
  }
}

function pruneLogsIfNeeded_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var logSheet = ss.getSheetByName(AM_CONFIG.SHEETS.LOGS);
  if (!logSheet) return;
  var lastRow = logSheet.getLastRow();
  if (lastRow > 2000) {
    var deleteCount = Math.min(500, lastRow - 1);
    var startRow = lastRow - deleteCount + 1;
    logSheet.deleteRows(startRow, deleteCount);
  }
}

function withLogging_(moduleName, fn) {
  try {
    return fn();
  } catch (err) {
    logError_(moduleName, err.message || String(err), { stack: err.stack });
    throw err;
  }
}

function safeUiAlert_(message) {
  if (typeof globalIsInteractiveContext_ !== 'undefined' && !globalIsInteractiveContext_) {
    logInfo_('ui', 'UI alert skipped in non-interactive context', { message: message });
    return;
  }
  try {
    showCopyableUiAlert_('AI Scanner', message);
  } catch (err) {
    try {
      SpreadsheetApp.getUi().alert(String(message === undefined || message === null ? '' : message));
      logWarn_('ui', 'Copyable UI alert failed; used basic alert fallback', {
        error: err.message || String(err),
        message: message
      });
    } catch (fallbackErr) {
      logInfo_('ui', 'UI alert skipped in non-interactive context', {
        error: fallbackErr.message || String(fallbackErr),
        copyable_error: err.message || String(err),
        message: message
      });
    }
  }
}

function showCopyableUiAlert_(title, message) {
  var text = String(message === undefined || message === null ? '' : message);
  var html = HtmlService.createHtmlOutput(buildCopyableAlertHtml_(title, text))
    .setWidth(680)
    .setHeight(520);
  SpreadsheetApp.getUi().showModalDialog(html, title || 'AI Scanner');
}

function buildCopyableAlertHtml_(title, message) {
  return [
    '<!doctype html>',
    '<html>',
    '<head>',
    '<base target="_top">',
    '<style>',
    'body{font-family:Arial,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;margin:0;color:#111827;background:#ffffff;}',
    '.wrap{padding:18px;}',
    'h1{font-size:18px;margin:0 0 12px;}',
    'textarea{box-sizing:border-box;width:100%;height:360px;border:1px solid #d1d5db;border-radius:8px;padding:12px;font-size:13px;line-height:1.5;white-space:pre;resize:vertical;color:#111827;background:#f9fafb;}',
    '.actions{display:flex;gap:8px;justify-content:flex-end;margin-top:12px;}',
    'button{border:1px solid #d1d5db;border-radius:8px;background:#ffffff;color:#111827;padding:9px 13px;font-weight:700;cursor:pointer;}',
    'button.primary{background:#2563eb;border-color:#2563eb;color:#ffffff;}',
    '.status{font-size:12px;color:#047857;margin-right:auto;align-self:center;min-height:18px;}',
    '</style>',
    '</head>',
    '<body>',
    '<div class="wrap">',
    '<h1>' + escapeHtmlForUi_(title || 'AI Scanner') + '</h1>',
    '<textarea id="copyText" readonly>' + escapeHtmlForUi_(message) + '</textarea>',
    '<div class="actions">',
    '<div id="status" class="status"></div>',
    '<button type="button" class="primary" onclick="copyText()">복사하기</button>',
    '<button type="button" onclick="google.script.host.close()">닫기</button>',
    '</div>',
    '</div>',
    '<script>',
    'function copyText(){',
    '  var el=document.getElementById("copyText");',
    '  el.focus(); el.select();',
    '  var done=function(){document.getElementById("status").textContent="복사되었습니다.";};',
    '  if(navigator.clipboard&&navigator.clipboard.writeText){',
    '    navigator.clipboard.writeText(el.value).then(done).catch(function(){document.execCommand("copy");done();});',
    '  }else{',
    '    document.execCommand("copy");done();',
    '  }',
    '}',
    '</script>',
    '</body>',
    '</html>'
  ].join('');
}

function escapeHtmlForUi_(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
