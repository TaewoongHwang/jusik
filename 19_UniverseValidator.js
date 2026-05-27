var AM_UNIVERSE_VALIDATION_PROP_PREFIX = 'AM_UNIVERSE_VALIDATION_';
var AM_UNIVERSE_VALIDATION_MAX_RUNTIME_MS = 4.5 * 60 * 1000;
var AM_UNIVERSE_VALIDATION_BATCH_SIZE = 3;

function validateMarketUniverse() {
  return withLogging_('universe_validator', function() {
    startMarketUniverseValidation_();
    return continueMarketUniverseValidation();
  });
}

function continueMarketUniverseValidation() {
  return withLogging_('universe_validator', function() {
    validateRealRuntimeConfig_();
    ensureAllSheets_();
    var state = getMarketUniverseValidationState_();
    if (!state.checked_at) {
      startMarketUniverseValidation_();
      state = getMarketUniverseValidationState_();
    }
    var deadline = new Date().getTime() + AM_UNIVERSE_VALIDATION_MAX_RUNTIME_MS;
    var allRows = readObjects_(AM_CONFIG.SHEETS.MARKET_UNIVERSE);
    var rows = getActiveValidationUniverseRows_(allRows);
    if (allRows.length === 0) {
      throw new Error('market_universe is empty.');
    }
    if (state.total_rows !== rows.length || state.inactive !== allRows.length - rows.length) {
      state.total_rows = rows.length;
      state.inactive = allRows.length - rows.length;
      saveMarketUniverseValidationState_(state);
    }
    var processed = 0;
    while (state.index < rows.length &&
      processed < AM_UNIVERSE_VALIDATION_BATCH_SIZE &&
      new Date().getTime() < deadline - 20000) {
      state = validateUniverseRow_(state, rows[state.index]);
      state.index += 1;
      state.updated_at = amNowString_();
      processed += 1;
      saveMarketUniverseValidationState_(state);
    }
    if (state.index >= rows.length) {
      state.stage = 'done';
      state.updated_at = amNowString_();
      saveMarketUniverseValidationState_(state);
      deleteTriggersByHandler_('continueMarketUniverseValidation');
      logInfo_('universe_validator', 'Universe validation completed', state);
      safeUiAlert_(formatUniverseValidationMessage_(state));
      return state;
    }
    scheduleMarketUniverseValidationContinuation_();
    logInfo_('universe_validator', 'Universe validation chunk completed; continuation scheduled', state);
    safeUiAlert_(formatUniverseValidationProgressMessage_(state));
    return state;
  });
}

function getMarketUniverseValidationStatus() {
  return withLogging_('universe_validator', function() {
    var state = getMarketUniverseValidationState_();
    if (!state.checked_at) {
      safeUiAlert_('분석 종목 검증 상태 기록이 없습니다.\n\nAI Scanner > 1. 처음 설정 > 분석 종목 검증을 먼저 실행하세요.');
      return state;
    }
    safeUiAlert_(state.stage === 'done'
      ? formatUniverseValidationMessage_(state)
      : formatUniverseValidationProgressMessage_(state));
    return state;
  });
}

function startMarketUniverseValidation_() {
  validateRealRuntimeConfig_();
  ensureAllSheets_();
  var allRows = readObjects_(AM_CONFIG.SHEETS.MARKET_UNIVERSE);
  var rows = getActiveValidationUniverseRows_(allRows);
  if (allRows.length === 0) {
    throw new Error('market_universe is empty.');
  }
  clearDataRows_(AM_CONFIG.SHEETS.MARKET_UNIVERSE_CHECK);
  deleteTriggersByHandler_('continueMarketUniverseValidation');
  var state = {
    checked_at: amNowString_(),
    stage: 'running',
    index: 0,
    total_rows: rows.length,
    total: 0,
    ok: 0,
    invalid: 0,
    inactive: allRows.length - rows.length,
    started_at: amNowString_(),
    updated_at: amNowString_()
  };
  saveMarketUniverseValidationState_(state);
  logInfo_('universe_validator', 'Universe validation started', state);
}

function getActiveValidationUniverseRows_(rows) {
  return (rows || []).filter(function(row) {
    return String(row.active || '').toUpperCase() === 'Y';
  });
}

function validateUniverseRow_(state, row) {
  var symbol = normalizeStockSymbol_(row.symbol);
  var active = String(row.active).toUpperCase() === 'Y';
  if (!active) {
    state.inactive += 1;
    return state;
  }
  state.total += 1;
  var currentResult = checkUniverseCurrentPrice_(symbol);
  if (!currentResult.ok) {
    state.invalid += 1;
    appendUniverseCheckRow_(state.checked_at, row, symbol, false, false, 0, 'invalid_current', currentResult.message);
    return state;
  }
  var dailyResult = checkUniverseDailyPrices_(symbol);
  if (!dailyResult.ok) {
    state.invalid += 1;
    appendUniverseCheckRow_(state.checked_at, row, symbol, true, false, dailyResult.rows, 'invalid_daily', dailyResult.message);
    return state;
  }
  state.ok += 1;
  appendUniverseCheckRow_(state.checked_at, row, symbol, true, true, dailyResult.rows, 'ok', 'KIS 현재가와 일봉 데이터가 정상 조회되었습니다.');
  return state;
}

function scheduleMarketUniverseValidationContinuation_() {
  deleteTriggersByHandler_('continueMarketUniverseValidation');
  ScriptApp.newTrigger('continueMarketUniverseValidation')
    .timeBased()
    .after(60 * 1000)
    .create();
}

function getMarketUniverseValidationState_() {
  var props = PropertiesService.getScriptProperties();
  return {
    checked_at: props.getProperty(AM_UNIVERSE_VALIDATION_PROP_PREFIX + 'CHECKED_AT') || '',
    stage: props.getProperty(AM_UNIVERSE_VALIDATION_PROP_PREFIX + 'STAGE') || '',
    index: Number(props.getProperty(AM_UNIVERSE_VALIDATION_PROP_PREFIX + 'INDEX') || 0),
    total_rows: Number(props.getProperty(AM_UNIVERSE_VALIDATION_PROP_PREFIX + 'TOTAL_ROWS') || 0),
    total: Number(props.getProperty(AM_UNIVERSE_VALIDATION_PROP_PREFIX + 'TOTAL') || 0),
    ok: Number(props.getProperty(AM_UNIVERSE_VALIDATION_PROP_PREFIX + 'OK') || 0),
    invalid: Number(props.getProperty(AM_UNIVERSE_VALIDATION_PROP_PREFIX + 'INVALID') || 0),
    inactive: Number(props.getProperty(AM_UNIVERSE_VALIDATION_PROP_PREFIX + 'INACTIVE') || 0),
    started_at: props.getProperty(AM_UNIVERSE_VALIDATION_PROP_PREFIX + 'STARTED_AT') || '',
    updated_at: props.getProperty(AM_UNIVERSE_VALIDATION_PROP_PREFIX + 'UPDATED_AT') || ''
  };
}

function saveMarketUniverseValidationState_(state) {
  var props = PropertiesService.getScriptProperties();
  props.setProperty(AM_UNIVERSE_VALIDATION_PROP_PREFIX + 'CHECKED_AT', state.checked_at || '');
  props.setProperty(AM_UNIVERSE_VALIDATION_PROP_PREFIX + 'STAGE', state.stage || '');
  props.setProperty(AM_UNIVERSE_VALIDATION_PROP_PREFIX + 'INDEX', String(state.index || 0));
  props.setProperty(AM_UNIVERSE_VALIDATION_PROP_PREFIX + 'TOTAL_ROWS', String(state.total_rows || 0));
  props.setProperty(AM_UNIVERSE_VALIDATION_PROP_PREFIX + 'TOTAL', String(state.total || 0));
  props.setProperty(AM_UNIVERSE_VALIDATION_PROP_PREFIX + 'OK', String(state.ok || 0));
  props.setProperty(AM_UNIVERSE_VALIDATION_PROP_PREFIX + 'INVALID', String(state.invalid || 0));
  props.setProperty(AM_UNIVERSE_VALIDATION_PROP_PREFIX + 'INACTIVE', String(state.inactive || 0));
  props.setProperty(AM_UNIVERSE_VALIDATION_PROP_PREFIX + 'STARTED_AT', state.started_at || '');
  props.setProperty(AM_UNIVERSE_VALIDATION_PROP_PREFIX + 'UPDATED_AT', state.updated_at || '');
}

function deactivateInvalidUniverseRows() {
  return withLogging_('universe_validator', function() {
    ensureAllSheets_();
    var checkRows = readObjects_(AM_CONFIG.SHEETS.MARKET_UNIVERSE_CHECK);
    if (checkRows.length === 0) {
      throw new Error('market_universe_check is empty. Run validateMarketUniverse first.');
    }
    var state = getMarketUniverseValidationState_();
    if (state.stage && state.stage !== 'done') {
      throw new Error('분석 종목 검증이 아직 완료되지 않았습니다. 검증 상태 확인 후 완료되면 다시 실행하세요.');
    }
    var latestCheckedAt = findLatestUniverseCheckAt_(checkRows);
    var invalidSymbols = {};
    checkRows.forEach(function(row) {
      if (String(row.checked_at) !== latestCheckedAt) return;
      if (String(row.status) !== 'ok' && String(row.active).toUpperCase() === 'Y') {
        invalidSymbols[normalizeStockSymbol_(row.symbol)] = true;
      }
    });
    var count = deactivateUniverseSymbols_(invalidSymbols);
    logInfo_('universe_validator', 'Deactivated invalid universe rows', { count: count, checked_at: latestCheckedAt });
    safeUiAlert_('무효 종목 비활성화 완료\n\n비활성화 종목 수: ' + count);
    return count;
  });
}

function findLatestUniverseCheckAt_(checkRows) {
  return checkRows.reduce(function(latest, row) {
    var checkedAt = String(row.checked_at || '');
    return checkedAt > latest ? checkedAt : latest;
  }, '');
}

function deactivateUniverseSymbols_(symbolsMap) {
  var sheet = ensureSheet_(AM_CONFIG.SHEETS.MARKET_UNIVERSE, AM_SHEET_SCHEMAS[AM_CONFIG.SHEETS.MARKET_UNIVERSE]);
  var values = sheet.getDataRange().getValues();
  if (values.length <= 1) return 0;
  var headers = values[0];
  var symbolIndex = headers.indexOf('symbol');
  var activeIndex = headers.indexOf('active');
  if (symbolIndex < 0 || activeIndex < 0) return 0;
  var count = 0;
  for (var i = 1; i < values.length; i += 1) {
    var symbol = normalizeStockSymbol_(values[i][symbolIndex]);
    if (symbolsMap[symbol]) {
      sheet.getRange(i + 1, symbolIndex + 1).setNumberFormat('@').setValue(symbol);
      sheet.getRange(i + 1, activeIndex + 1).setValue('N');
      count += 1;
    }
  }
  return count;
}

function checkUniverseCurrentPrice_(symbol) {
  try {
    var quote = fetchKisCurrentPrice_(symbol);
    return { ok: quote.close > 0, message: 'OK' };
  } catch (err) {
    return { ok: false, message: err.message || String(err) };
  }
}

function checkUniverseDailyPrices_(symbol) {
  try {
    var endDate = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd');
    var startDate = Utilities.formatDate(new Date(new Date().getTime() - 180 * 24 * 60 * 60 * 1000), Session.getScriptTimeZone(), 'yyyyMMdd');
    var prices = fetchKisDailyPrices_(symbol, startDate, endDate);
    return {
      ok: prices.length >= 60,
      rows: prices.length,
      message: prices.length >= 60 ? 'OK' : '일봉 데이터가 60개 미만입니다.'
    };
  } catch (err) {
    return { ok: false, rows: 0, message: err.message || String(err) };
  }
}

function appendUniverseCheckRow_(checkedAt, row, symbol, currentOk, dailyOk, dailyRows, status, message) {
  appendObjectRow_(AM_CONFIG.SHEETS.MARKET_UNIVERSE_CHECK, {
    checked_at: checkedAt,
    symbol: symbol,
    name: row.name,
    market: row.market,
    sector: row.sector,
    active: row.active,
    current_ok: currentOk ? 'Y' : 'N',
    daily_ok: dailyOk ? 'Y' : 'N',
    daily_rows: dailyRows,
    status: status,
    message: message
  });
}

function formatUniverseValidationProgressMessage_(state) {
  return [
    '분석 종목 검증 진행 중',
    '',
    '진행: ' + state.index + ' / ' + state.total_rows + ' active 종목',
    '활성 종목 검증 수: ' + state.total,
    '정상: ' + state.ok,
    '무효: ' + state.invalid,
    '비활성 제외: ' + state.inactive,
    '',
    '이어서 실행 트리거가 예약되었습니다.',
    '잠시 뒤 AI Scanner > 1. 처음 설정 > 분석 종목 검증 상태 확인을 눌러 확인하세요.'
  ].join('\n');
}

function formatUniverseValidationMessage_(summary) {
  return [
    '분석 종목 검증 완료',
    '',
    '진행: ' + summary.index + ' / ' + summary.total_rows + ' active 종목',
    '활성 종목 검증 수: ' + summary.total,
    '정상: ' + summary.ok,
    '무효: ' + summary.invalid,
    '비활성 제외: ' + summary.inactive,
    '',
    '결과 시트: market_universe_check',
    summary.invalid > 0 ? '다음: AI Scanner > 1. 처음 설정 > 무효 종목 비활성화' : '무효 종목 없음'
  ].join('\n');
}
