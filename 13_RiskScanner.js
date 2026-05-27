function scanRiskAlerts() {
  return withLogging_('risk_scanner', function() {
    var today = amTodayString_();
    var leaders = readObjects_(AM_CONFIG.SHEETS.LEADER_50).filter(function(row) {
      return normalizeDateValue_(row.date) === today;
    });
    deleteRiskAlertsByType_(today, 'chart');
    leaders.forEach(function(row) {
      if (Number(row.change_pct) >= 8) {
        appendObjectRow_(AM_CONFIG.SHEETS.RISK_ALERTS, {
          date: today,
          symbol: row.symbol,
          risk_type: 'chart',
          risk_level: 'high',
          message: 'Sharp daily rise. Avoid chase buying and check volume persistence.',
          source: 'mvp_rule'
        });
      }
    });
    logInfo_('risk_scanner', 'Risk scan completed', { leader_count: leaders.length });
  });
}

function deleteRiskAlertsByType_(dateValue, riskType) {
  var sheet = ensureSheet_(AM_CONFIG.SHEETS.RISK_ALERTS, AM_SHEET_SCHEMAS[AM_CONFIG.SHEETS.RISK_ALERTS]);
  var values = sheet.getDataRange().getValues();
  if (values.length <= 1) return;
  var headers = values[0];
  var dateIndex = headers.indexOf('date');
  var typeIndex = headers.indexOf('risk_type');
  if (dateIndex < 0 || typeIndex < 0) return;
  var keepRows = [];
  for (var rowIndex = 1; rowIndex < values.length; rowIndex += 1) {
    var shouldDelete = normalizeDateValue_(values[rowIndex][dateIndex]) === normalizeDateValue_(dateValue) && String(values[rowIndex][typeIndex]) === String(riskType);
    if (!shouldDelete) keepRows.push(values[rowIndex]);
  }
  rewriteDataRows_(sheet, headers.length, keepRows);
}

function dedupeRiskAlertsForDate_(dateValue) {
  var sheetName = AM_CONFIG.SHEETS.RISK_ALERTS;
  ensureSheet_(sheetName, AM_SHEET_SCHEMAS[sheetName]);
  var rows = readObjects_(sheetName).filter(function(row) {
    return normalizeDateValue_(row.date) === normalizeDateValue_(dateValue);
  });
  var seen = {};
  var deduped = [];
  rows.forEach(function(row) {
    var key = [
      normalizeStockSymbol_(row.symbol),
      row.risk_type,
      row.risk_level,
      row.message,
      row.source
    ].join('|');
    if (seen[key]) return;
    seen[key] = true;
    deduped.push(row);
  });
  deleteRowsByDate_(sheetName, dateValue);
  deduped.forEach(function(row) {
    appendObjectRow_(sheetName, row);
  });
  logInfo_('risk_scanner', 'Deduped risk alerts', {
    date: normalizeDateValue_(dateValue),
    before: rows.length,
    after: deduped.length
  });
}
