function buildDailyBacktestLog(dateValue) {
  return withLogging_('backtest', function() {
    validateRealRuntimeConfig_();
    ensureAllSheets_();
    var target = normalizeDateValue_(dateValue || amTodayString_());
    if (target === amTodayString_() && !isBacktestCollectionWindowOpen_()) {
      throw new Error('사후검증은 오늘 일봉이 확정되는 15:50 이후에 실행하세요.');
    }
    var baseDate = resolvePreviousBacktestBaseDate_(target);
    if (!baseDate) {
      throw new Error('사후검증할 이전 leader_50 날짜가 없습니다.');
    }
    var result = buildBacktestForBaseDate_(baseDate, target);
    try {
      runPaperTradingSimulation(target);
    } catch(e) {
      logWarn_('backtest', 'Paper trading simulation auto-run failed from menu', { error: e.message || String(e) });
    }
    safeUiAlert_(formatBacktestSummaryMessage_(result));
    return result;
  });
}

function ensureBacktestLogForToday_() {
  var target = amTodayString_();
  if (!isBacktestCollectionWindowOpen_()) {
    logInfo_('backtest', 'Daily backtest skipped before collection window', { date: target });
    return { date: target, skipped: true, reason: 'before_collection_window' };
  }
  if (countRowsByDate_(AM_CONFIG.SHEETS.BACKTEST_LOG, target) > 0) {
    return { date: target, skipped: true, reason: 'already_exists' };
  }
  var baseDate = resolvePreviousBacktestBaseDate_(target);
  if (!baseDate) {
    logWarn_('backtest', 'Daily backtest skipped because no previous leader date exists', { date: target });
    return { date: target, skipped: true, reason: 'no_base_date' };
  }
  try {
    var result = buildBacktestForBaseDate_(baseDate, target);
    try {
      runPaperTradingSimulation(target);
    } catch(e) {
      logWarn_('backtest', 'Paper trading simulation auto-run failed from daily workflow', { error: e.message || String(e) });
    }
    return result;
  } catch (err) {
    logWarn_('backtest', 'Daily backtest skipped before report', {
      date: target,
      base_date: baseDate,
      error: err.message || String(err)
    });
    return { date: target, base_date: baseDate, skipped: true, reason: err.message || String(err) };
  }
}

function isBacktestCollectionWindowOpen_() {
  var hhmm = Number(Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'HHmm'));
  return hhmm >= 1550;
}

function buildBacktestForBaseDate_(baseDate, targetDate) {
  var base = normalizeDateValue_(baseDate);
  var target = normalizeDateValue_(targetDate);
  var plans = readObjects_(AM_CONFIG.SHEETS.ENTRY_PLAN).filter(function(row) {
    return normalizeDateValue_(row.date) === base;
  });
  var overall = readObjects_(AM_CONFIG.SHEETS.LEADER_50).filter(function(row) {
    return normalizeDateValue_(row.date) === base;
  }).slice(0, getSettingNumber_('backtest_top_n', 10));
  var kosdaq = readObjects_(AM_CONFIG.SHEETS.KOSDAQ_LEADER_50).filter(function(row) {
    return normalizeDateValue_(row.date) === base;
  }).slice(0, getSettingNumber_('backtest_kosdaq_top_n', 10));

  var rows = [];
  overall.forEach(function(row) {
    rows.push(buildBacktestRowForLeader_(target, base, 'overall', row, findFirstBySymbol_(plans, row.symbol) || {}));
  });
  kosdaq.forEach(function(row) {
    rows.push(buildBacktestRowForLeader_(target, base, 'kosdaq', row, findFirstBySymbol_(plans, row.symbol) || {}));
  });

  deleteRowsByDate_(AM_CONFIG.SHEETS.BACKTEST_LOG, target);
  rows.forEach(function(row) {
    appendObjectRow_(AM_CONFIG.SHEETS.BACKTEST_LOG, row);
  });

  var summary = summarizeBacktestRows_(rows);
  logInfo_('backtest', 'Daily backtest log built', {
    date: target,
    base_date: base,
    rows: rows.length,
    summary: summary
  });
  return {
    date: target,
    base_date: base,
    rows: rows.length,
    summary: summary
  };
}

function buildBacktestRowForLeader_(targetDate, baseDate, listType, leader, plan) {
  var symbol = normalizeStockSymbol_(leader.symbol);
  var baseClose = Number(leader.close || plan.current_price || 0);
  var firstEntry = Number(plan.first_entry_price || 0);
  var secondEntry = Number(plan.second_entry_price || 0);
  var breakout = Number(plan.breakout_price || 0);
  var invalid = Number(plan.invalid_price || 0);
  try {
    var nextBar = fetchKisDailyBarForDate_(symbol, targetDate);
    return {
      date: targetDate,
      base_date: baseDate,
      list_type: listType,
      symbol: symbol,
      name: leader.name,
      rank: Number(leader.rank || 0),
      base_close: baseClose,
      next_open: nextBar.open,
      next_high: nextBar.high,
      next_low: nextBar.low,
      next_close: nextBar.close,
      next_return_pct: baseClose > 0 ? roundNumber_((nextBar.close - baseClose) / baseClose * 100, 2) : '',
      first_entry_price: firstEntry || '',
      first_entry_hit: firstEntry ? yesNo_(nextBar.low <= firstEntry && nextBar.high >= firstEntry) : '',
      second_entry_price: secondEntry || '',
      second_entry_hit: secondEntry ? yesNo_(nextBar.low <= secondEntry && nextBar.high >= secondEntry) : '',
      breakout_price: breakout || '',
      breakout_hit: breakout ? yesNo_(nextBar.high >= breakout) : '',
      invalid_price: invalid || '',
      invalid_hit: invalid ? yesNo_(nextBar.low <= invalid) : '',
      scenario: plan.scenario || '',
      result: classifyBacktestResult_(nextBar, baseClose, firstEntry, breakout, invalid),
      memo: buildBacktestMemo_(nextBar, baseClose, firstEntry, secondEntry, breakout, invalid)
    };
  } catch (err) {
    return {
      date: targetDate,
      base_date: baseDate,
      list_type: listType,
      symbol: symbol,
      name: leader.name,
      rank: Number(leader.rank || 0),
      base_close: baseClose,
      first_entry_price: firstEntry || '',
      second_entry_price: secondEntry || '',
      breakout_price: breakout || '',
      invalid_price: invalid || '',
      scenario: plan.scenario || '',
      result: '데이터 없음',
      memo: 'KIS 일봉 확인 실패: ' + (err.message || String(err))
    };
  }
}

function fetchKisDailyBarForDate_(symbol, targetDate) {
  var target = normalizeDateValue_(targetDate);
  var endDate = target.replace(/-/g, '');
  var startDate = Utilities.formatDate(addDaysForBacktest_(target, -7), Session.getScriptTimeZone(), 'yyyyMMdd');
  var prices = fetchKisDailyPrices_(symbol, startDate, endDate);
  var exact = prices.filter(function(row) {
    return String(row.date) === endDate;
  })[0];
  if (exact) return exact;
  if (prices.length > 0) return prices[prices.length - 1];
  throw new Error('KIS 일봉 데이터가 없어 사후검증할 수 없습니다: ' + symbol + ' ' + targetDate);
}

function addDaysForBacktest_(dateValue, dayOffset) {
  var parts = normalizeDateValue_(dateValue).split('-');
  var date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  date.setDate(date.getDate() + Number(dayOffset || 0));
  return date;
}

function classifyBacktestResult_(bar, baseClose, firstEntry, breakout, invalid) {
  var invalidHit = invalid && bar.low <= invalid;
  var breakoutHit = breakout && bar.high >= breakout;
  var firstHit = firstEntry && bar.low <= firstEntry && bar.high >= firstEntry;
  var returnPct = baseClose > 0 ? (bar.close - baseClose) / baseClose * 100 : 0;
  if (invalidHit) return '무효화 가격 터치';
  if (breakoutHit && returnPct > 0) return '돌파 조건 유효';
  if (firstHit && bar.close >= firstEntry) return '1차 검토가 반응';
  if (returnPct >= 2) return '관찰 유효';
  if (returnPct <= -2) return '관찰 부진';
  return '중립';
}

function buildBacktestMemo_(bar, baseClose, firstEntry, secondEntry, breakout, invalid) {
  var items = [];
  if (baseClose) items.push('기준 종가 대비 다음 종가 ' + formatPercentText_((bar.close - baseClose) / baseClose * 100));
  if (firstEntry) items.push('1차 ' + (bar.low <= firstEntry && bar.high >= firstEntry ? '도달' : '미도달'));
  if (secondEntry) items.push('2차 ' + (bar.low <= secondEntry && bar.high >= secondEntry ? '도달' : '미도달'));
  if (breakout) items.push('돌파 ' + (bar.high >= breakout ? '도달' : '미도달'));
  if (invalid) items.push('무효화 ' + (bar.low <= invalid ? '터치' : '미터치'));
  return items.join(' / ');
}

function summarizeBacktestRows_(rows) {
  var validRows = (rows || []).filter(function(row) {
    return row.next_return_pct !== '' && row.next_return_pct !== undefined;
  });
  var values = validRows.map(function(row) {
    return Number(row.next_return_pct || 0);
  });
  var avg = values.length ? values.reduce(function(sum, value) { return sum + value; }, 0) / values.length : 0;
  return {
    avg_return_pct: roundNumber_(avg, 2),
    first_entry_hits: countBacktestHits_(rows, 'first_entry_hit'),
    second_entry_hits: countBacktestHits_(rows, 'second_entry_hit'),
    breakout_hits: countBacktestHits_(rows, 'breakout_hit'),
    invalid_hits: countBacktestHits_(rows, 'invalid_hit'),
    positive_count: values.filter(function(value) { return value > 0; }).length,
    negative_count: values.filter(function(value) { return value < 0; }).length,
    valid_count: validRows.length,
    missing_count: (rows || []).length - validRows.length
  };
}

function countBacktestHits_(rows, field) {
  return (rows || []).filter(function(row) {
    return String(row[field] || '').toUpperCase() === 'Y';
  }).length;
}

function resolvePreviousBacktestBaseDate_(targetDate) {
  var target = normalizeDateValue_(targetDate);
  var rows = readObjects_(AM_CONFIG.SHEETS.LEADER_50);
  var latest = '';
  rows.forEach(function(row) {
    var date = normalizeDateValue_(row.date);
    if (date && date < target && date > latest) latest = date;
  });
  return latest;
}

function formatBacktestSummaryMessage_(result) {
  var summary = result.summary || {};
  return [
    '사후검증 기록 완료',
    '',
    '검증일: ' + result.date,
    '기준 리포트 날짜: ' + result.base_date,
    '검증 종목 수: ' + result.rows,
    '',
    '평균 다음 종가 수익률: ' + formatPercentText_(summary.avg_return_pct),
    '1차 검토가 도달: ' + summary.first_entry_hits + '개',
    '돌파가 도달: ' + summary.breakout_hits + '개',
    '무효화 터치: ' + summary.invalid_hits + '개',
    '상승 마감/하락 마감: ' + summary.positive_count + '개 / ' + summary.negative_count + '개',
    '',
    '결과 시트: backtest_log'
  ].join('\n');
}

function yesNo_(value) {
  return value ? 'Y' : 'N';
}
