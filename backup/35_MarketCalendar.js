function seedMarketCalendarDefaults_() {
  if (!AM_CONFIG.SHEETS.MARKET_CALENDAR) return;
  var sheetName = AM_CONFIG.SHEETS.MARKET_CALENDAR;
  var existing = readObjects_(sheetName).reduce(function(map, row) {
    map[normalizeDateValue_(row.date)] = true;
    return map;
  }, {});
  var today = parseDateOnly_(amTodayString_());
  if (!today) return;
  var rows = [];
  for (var offset = -14; offset <= 180; offset += 1) {
    var date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
    var dateText = formatDateOnly_(date);
    if (existing[dateText]) continue;
    if (!isWeekendDateObject_(date)) continue;
    rows.push({
      date: dateText,
      kr_open: 'N',
      us_open: 'N',
      holiday_name: '주말',
      memo: '자동 생성. 실제 공휴일/임시휴장일은 이 시트에서 kr_open/us_open을 Y/N으로 수정하세요.',
      updated_at: amNowString_()
    });
  }
  appendObjectRows_(sheetName, rows);
}

function refreshMarketCalendarSheet() {
  return withLogging_('market_calendar', function() {
    ensureAllSheets_();
    seedMarketCalendarDefaults_();
    safeUiAlert_([
      '시장 캘린더 갱신 완료',
      '',
      '주말 행은 자동으로 채웠습니다.',
      '국내/미국 공휴일이나 임시휴장일은 market_calendar 시트에서 직접 보정할 수 있습니다.',
      '',
      '예: 2026-12-25 / kr_open=N / us_open=N / holiday_name=성탄절'
    ].join('\n'));
  });
}

function runMarketCalendarDiagnostics() {
  return withLogging_('market_calendar', function() {
    ensureAllSheets_();
    var today = amTodayString_();
    var summary = getMarketCalendarSummary_(today);
    safeUiAlert_(formatMarketCalendarDiagnostics_(summary));
    logInfo_('market_calendar', 'Market calendar diagnostics completed', summary);
    return summary;
  });
}

function getMarketCalendarSummary_(dateValue) {
  var target = normalizeDateValue_(dateValue || amTodayString_());
  var row = getMarketCalendarRow_(target);
  var dateObj = parseDateOnly_(target);
  var weekend = dateObj ? isWeekendDateObject_(dateObj) : false;
  var defaultOpen = !weekend;
  var krOpen = row ? parseOpenFlag_(row.kr_open, defaultOpen) : defaultOpen;
  var usOpen = row ? parseOpenFlag_(row.us_open, defaultOpen) : defaultOpen;
  var holidayName = row && row.holiday_name ? String(row.holiday_name) : (weekend ? '주말' : '');
  return {
    date: target,
    kr_open: krOpen,
    us_open: usOpen,
    is_weekend: weekend,
    holiday_name: holidayName,
    memo: row && row.memo ? String(row.memo) : '',
    source: row ? 'market_calendar' : 'weekday_default',
    latest_kr_trading_date: findNearestTradingDate_(target, -1, 'KR'),
    next_kr_trading_date: findNearestTradingDate_(target, 1, 'KR'),
    latest_us_trading_date: findNearestTradingDate_(target, -1, 'US'),
    next_us_trading_date: findNearestTradingDate_(target, 1, 'US')
  };
}

function getMarketCalendarRow_(dateValue) {
  var target = normalizeDateValue_(dateValue);
  var rows = readObjects_(AM_CONFIG.SHEETS.MARKET_CALENDAR || 'market_calendar');
  for (var i = 0; i < rows.length; i += 1) {
    if (normalizeDateValue_(rows[i].date) === target) return rows[i];
  }
  return null;
}

function isKrMarketOpenDate_(dateValue) {
  return getMarketCalendarSummary_(dateValue).kr_open === true;
}

function isUsMarketOpenDate_(dateValue) {
  return getMarketCalendarSummary_(dateValue).us_open === true;
}

function isWeekendDateObject_(dateObj) {
  var day = dateObj.getDay();
  return day === 0 || day === 6;
}

function parseOpenFlag_(value, defaultValue) {
  var text = String(value === undefined || value === null ? '' : value).trim().toUpperCase();
  if (['Y', 'YES', 'TRUE', '1', 'OPEN', '개장'].indexOf(text) >= 0) return true;
  if (['N', 'NO', 'FALSE', '0', 'CLOSED', '휴장'].indexOf(text) >= 0) return false;
  return defaultValue;
}

function findNearestTradingDate_(dateValue, direction, market) {
  var base = parseDateOnly_(dateValue);
  if (!base) return '';
  for (var offset = 1; offset <= 21; offset += 1) {
    var date = new Date(base.getFullYear(), base.getMonth(), base.getDate() + direction * offset);
    var text = formatDateOnly_(date);
    if (market === 'US' ? isUsMarketOpenDateSimple_(text) : isKrMarketOpenDateSimple_(text)) return text;
  }
  return '';
}

function isKrMarketOpenDateSimple_(dateValue) {
  var target = normalizeDateValue_(dateValue);
  var row = getMarketCalendarRow_(target);
  var dateObj = parseDateOnly_(target);
  var defaultOpen = dateObj ? !isWeekendDateObject_(dateObj) : true;
  return row ? parseOpenFlag_(row.kr_open, defaultOpen) : defaultOpen;
}

function isUsMarketOpenDateSimple_(dateValue) {
  var target = normalizeDateValue_(dateValue);
  var row = getMarketCalendarRow_(target);
  var dateObj = parseDateOnly_(target);
  var defaultOpen = dateObj ? !isWeekendDateObject_(dateObj) : true;
  return row ? parseOpenFlag_(row.us_open, defaultOpen) : defaultOpen;
}

function formatDateOnly_(dateObj) {
  return Utilities.formatDate(dateObj, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function formatMarketCalendarDiagnostics_(summary) {
  return [
    '시장 캘린더 진단',
    '',
    '날짜: ' + summary.date,
    '국내 증시: ' + (summary.kr_open ? '개장' : '휴장'),
    '미국 증시: ' + (summary.us_open ? '개장' : '휴장'),
    '구분: ' + (summary.holiday_name || (summary.is_weekend ? '주말' : '평일 기본값')),
    '판정 기준: ' + summary.source,
    '',
    '최근 국내 거래일: ' + (summary.latest_kr_trading_date || '-'),
    '다음 국내 거래일: ' + (summary.next_kr_trading_date || '-'),
    '최근 미국 거래일: ' + (summary.latest_us_trading_date || '-'),
    '다음 미국 거래일: ' + (summary.next_us_trading_date || '-'),
    '',
    '참고: 실제 공휴일/임시휴장일은 market_calendar 시트에서 kr_open/us_open을 Y/N으로 보정하세요.'
  ].join('\n');
}

