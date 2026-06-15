// ==================================================
// 🧪 Test function to retrieve current holdings details
// ==================================================

function getHoldingDetails() {
  // Ensure latest holdings are collected
  collectHoldingsCurrent();

  var today = amTodayString_();
  var portMode = String(getScriptProperty_('PORTFOLIO_MODE', 'real')).toUpperCase();
  var holdings = filterHoldingsByMode_(
    getCachedHoldings_(AM_CONFIG.SHEETS.HOLDINGS_CURRENT),
    portMode
  ).filter(function(row) {
    return normalizeDateValue_(row.date) === today;
  });

  // Return as JSON string for clarity when running via clasp
  return JSON.stringify({ date: today, mode: portMode, holdings: holdings }, null, 2);
}
