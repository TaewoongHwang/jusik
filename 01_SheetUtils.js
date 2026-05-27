function setupAiMarketLeaderScanner() {
  ensureAllSheets_();
  applySheetFormats_();
  normalizeMarketUniverseSheet_();
  seedDefaultSettings_();
  seedDefaultPrompts_();
  seedDefaultEtfWatch_();
  seedMarketCalendarDefaults_();
  seedCommandGuide_();
  seedMobileCommandSheet_();
  logInfo_('setup', 'Real-data sheets and defaults initialized', { version: AM_CONFIG.VERSION });
}

function ensureAllSheets_() {
  Object.keys(AM_SHEET_SCHEMAS).forEach(function(sheetName) {
    ensureSheet_(sheetName, AM_SHEET_SCHEMAS[sheetName]);
  });
}

function applySheetFormats_() {
  Object.keys(AM_SHEET_SCHEMAS).forEach(function(sheetName) {
    var headers = AM_SHEET_SCHEMAS[sheetName];
    var sheet = ensureSheet_(sheetName, headers);
    headers.forEach(function(header, index) {
      if (isTextCodeColumn_(header)) {
        sheet.getRange(1, index + 1, sheet.getMaxRows(), 1).setNumberFormat('@');
      }
    });
  });
}

function isTextCodeColumn_(header) {
  return ['symbol', 'etf_symbol', 'corp_code', 'stock_code'].indexOf(header) >= 0;
}

function normalizeTextCodeValue_(header, value) {
  if (header === 'symbol' || header === 'stock_code') {
    return normalizeStockSymbol_(value);
  }
  return String(value || '').trim();
}

function ensureSheet_(sheetName, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }
  ensureHeader_(sheet, headers);
  return sheet;
}

function ensureHeader_(sheet, headers) {
  var width = headers.length;
  var current = sheet.getRange(1, 1, 1, width).getValues()[0];
  var needsUpdate = false;
  for (var i = 0; i < width; i += 1) {
    if (current[i] !== headers[i]) {
      needsUpdate = true;
      break;
    }
  }
  if (needsUpdate) {
    sheet.getRange(1, 1, 1, width).setValues([headers]);
    sheet.setFrozenRows(1);
  }
}

function appendObjectRow_(sheetName, obj) {
  appendObjectRows_(sheetName, [obj]);
}

function appendObjectRows_(sheetName, objects) {
  if (!objects || objects.length === 0) return;
  var headers = AM_SHEET_SCHEMAS[sheetName];
  var rows = objects.map(function(obj) {
    return objectToSheetRow_(headers, obj || {});
  });
  var sheet = ensureSheet_(sheetName, headers);
  var rowIndex = sheet.getLastRow() + 1;
  headers.forEach(function(header, index) {
    if (isTextCodeColumn_(header)) {
      sheet.getRange(rowIndex, index + 1, rows.length, 1).setNumberFormat('@');
    }
  });
  sheet.getRange(rowIndex, 1, rows.length, headers.length).setValues(rows);
}

function prependObjectRow_(sheetName, obj) {
  prependObjectRows_(sheetName, [obj]);
}

function prependObjectRows_(sheetName, objects) {
  if (!objects || objects.length === 0) return;
  var headers = AM_SHEET_SCHEMAS[sheetName];
  var rows = objects.map(function(obj) {
    return objectToSheetRow_(headers, obj || {});
  });
  var sheet = ensureSheet_(sheetName, headers);
  sheet.insertRowsAfter(1, rows.length);
  var rowIndex = 2;
  headers.forEach(function(header, index) {
    if (isTextCodeColumn_(header)) {
      sheet.getRange(rowIndex, index + 1, rows.length, 1).setNumberFormat('@');
    }
  });
  sheet.getRange(rowIndex, 1, rows.length, headers.length).setValues(rows);
}

function objectToSheetRow_(headers, obj) {
  return headers.map(function(key) {
    var value = obj[key];
    if (value === undefined || value === null) return '';
    if (key === 'date') return normalizeDateValue_(value);
    if (isTextCodeColumn_(key)) return normalizeTextCodeValue_(key, value);
    if (typeof value === 'object') return JSON.stringify(value);
    return value;
  });
}

function readObjects_(sheetName) {
  var sheet = ensureSheet_(sheetName, AM_SHEET_SCHEMAS[sheetName]);
  var values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];
  var headers = values[0];
  return values.slice(1).filter(function(row) {
    return row.some(function(cell) { return cell !== ''; });
  }).map(function(row) {
    var obj = {};
    headers.forEach(function(key, index) {
      obj[key] = row[index];
    });
    return obj;
  });
}

function readRecentObjects_(sheetName, maxRowsToRead) {
  var headers = AM_SHEET_SCHEMAS[sheetName];
  var sheet = ensureSheet_(sheetName, headers);
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];
  var limit = maxRowsToRead || 500;
  
  var values;
  if (sheetName === AM_CONFIG.SHEETS.LOGS) {
    var numRows = Math.min(limit, lastRow - 1);
    values = sheet.getRange(2, 1, numRows, headers.length).getValues();
  } else {
    var startRow = Math.max(2, lastRow - limit + 1);
    var numRows = lastRow - startRow + 1;
    values = sheet.getRange(startRow, 1, numRows, headers.length).getValues();
  }
  
  var headerValues = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  return values.filter(function(row) {
    return row.some(function(cell) { return cell !== ''; });
  }).map(function(row) {
    var obj = {};
    headerValues.forEach(function(key, index) {
      obj[key] = row[index];
    });
    return obj;
  });
}

function normalizeMarketUniverseSheet_() {
  var sheetName = AM_CONFIG.SHEETS.MARKET_UNIVERSE;
  var sheet = ensureSheet_(sheetName, AM_SHEET_SCHEMAS[sheetName]);
  var values = sheet.getDataRange().getValues();
  if (values.length <= 1) return;
  var headers = values[0];
  var symbolIndex = headers.indexOf('symbol');
  if (symbolIndex < 0) return;
  var updates = [];
  for (var i = 1; i < values.length; i += 1) {
    updates.push([normalizeStockSymbol_(values[i][symbolIndex])]);
  }
  sheet.getRange(2, symbolIndex + 1, updates.length, 1).setNumberFormat('@').setValues(updates);
}

function clearDataRows_(sheetName) {
  var sheet = ensureSheet_(sheetName, AM_SHEET_SCHEMAS[sheetName]);
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).clearContent();
  }
}

function deleteRowsByDate_(sheetName, dateValue) {
  var sheet = ensureSheet_(sheetName, AM_SHEET_SCHEMAS[sheetName]);
  var values = sheet.getDataRange().getValues();
  if (values.length <= 1) return;
  var headers = values[0];
  var dateIndex = headers.indexOf('date');
  if (dateIndex < 0) return;
  var keepRows = [];
  for (var rowIndex = 1; rowIndex < values.length; rowIndex += 1) {
    if (normalizeDateValue_(values[rowIndex][dateIndex]) !== normalizeDateValue_(dateValue)) {
      keepRows.push(values[rowIndex]);
    }
  }
  rewriteDataRows_(sheet, headers.length, keepRows);
}

function rewriteDataRows_(sheet, width, rows) {
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, sheet.getMaxColumns()).clearContent();
  }
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, width).setValues(rows.map(function(row) {
      return row.slice(0, width);
    }));
  }
}

function upsertKeyValueRows_(sheetName, rows) {
  var sheet = ensureSheet_(sheetName, AM_SHEET_SCHEMAS[sheetName]);
  var values = sheet.getDataRange().getValues();
  var headers = values[0];
  var keyIndex = headers.indexOf('key');
  var valueIndex = headers.indexOf('value');
  var descriptionIndex = headers.indexOf('description');
  var updatedAtIndex = headers.indexOf('updated_at');
  var rowByKey = {};
  for (var i = 1; i < values.length; i += 1) {
    rowByKey[String(values[i][keyIndex])] = i + 1;
  }
  rows.forEach(function(row) {
    var existingRow = rowByKey[String(row.key)];
    if (existingRow) {
      sheet.getRange(existingRow, valueIndex + 1).setValue(row.value);
      sheet.getRange(existingRow, descriptionIndex + 1).setValue(row.description);
      sheet.getRange(existingRow, updatedAtIndex + 1).setValue(amNowString_());
    } else {
      appendObjectRow_(sheetName, {
        key: row.key,
        value: row.value,
        description: row.description,
        updated_at: amNowString_()
      });
    }
  });
}

function seedDefaultSettings_() {
  upsertKeyValueRows_(AM_CONFIG.SHEETS.SETTINGS, [
    { key: 'system_version', value: AM_CONFIG.VERSION, description: 'Current MVP version' },
    { key: 'kis_env', value: AM_CONFIG.DEFAULT_ENV, description: 'real only for this build. No substitute data is generated.' },
    { key: 'kis_base_url', value: AM_CONFIG.DEFAULT_KIS_BASE_URL, description: 'KIS real trading Open API base URL' },
    { key: 'report_top_n', value: 10, description: 'Number of stocks for AI deep analysis' },
    { key: 'dart_collect_top_n', value: 20, description: 'Number of leader stocks for OpenDART financial/risk collection' },
    { key: 'leader_count', value: 50, description: 'Final leader list size' },
    { key: 'krx_active_kospi_count', value: 120, description: 'KOSPI liquidity-ranked stocks to activate when expanding KRX universe' },
    { key: 'krx_active_kosdaq_count', value: 180, description: 'KOSDAQ liquidity-ranked stocks to activate when expanding KRX universe' },
    { key: 'krx_snapshot_lookback_days', value: 45, description: 'Calendar days to look back when searching latest KRX daily trade snapshot' },
    { key: 'backtest_top_n', value: 10, description: 'Overall top N stocks to verify against the next trading day' },
    { key: 'backtest_kosdaq_top_n', value: 10, description: 'KOSDAQ top N stocks to verify against the next trading day' },
    { key: 'gemini_premium_stock_top_n', value: 4, description: 'Top N stocks that use the premium daily stock model policy' },
    { key: 'gemini_models_daily_market', value: 'gemini-3.5-flash,gemini-3.1-flash-lite,gemini-2.5-flash', description: 'Model priority for daily close market-level expert judgment' },
    { key: 'gemini_models_daily_stock_top', value: 'gemini-3.5-flash,gemini-3.1-flash-lite,gemini-2.5-flash', description: 'Model priority for top-ranked daily stock expert notes' },
    { key: 'gemini_models_daily_stock_rest', value: 'gemini-3.1-flash-lite,gemini-2.5-flash-lite,gemini-2.5-flash', description: 'Model priority for remaining daily stock notes with cost control' },
    { key: 'gemini_models_daily_close', value: 'gemini-3.5-flash,gemini-3.1-flash-lite,gemini-2.5-flash,gemini-2.5-flash-lite', description: 'Legacy daily close model priority fallback' },
    { key: 'gemini_models_premarket', value: 'gemini-3.1-flash-lite,gemini-2.5-flash-lite,gemini-3.5-flash', description: 'Model priority for premarket quick report' },
    { key: 'gemini_models_weekly', value: 'gemini-3.1-pro-preview,gemini-2.5-pro,gemini-3.5-flash,gemini-3.1-flash-lite', description: 'Model priority for weekly deep review' },
    { key: 'gemini_models_news_grounding', value: 'gemini-2.5-flash-lite,gemini-3.1-flash-lite,gemini-2.5-flash,gemini-3.5-flash', description: 'Model priority for Google Search grounded news collection' },
    { key: 'gemini_models_cheap_backup', value: 'gemini-2.5-flash-lite,gemini-2.5-flash', description: 'Low-cost backup model priority' }
  ]);
  upsertKeyValueRows_(AM_CONFIG.SHEETS.STRATEGY_SETTINGS, [
    { key: 'max_position_pct', value: 5, description: 'Maximum position percentage per stock' },
    { key: 'low_risk_max_pct', value: 5, description: 'Maximum position for low-risk candidate' },
    { key: 'medium_risk_max_pct', value: 3, description: 'Maximum position for medium-risk candidate' },
    { key: 'high_risk_max_pct', value: 2, description: 'Maximum position for high-risk candidate' },
    { key: 'first_entry_ratio', value: 30, description: 'First entry ratio of planned position' },
    { key: 'second_entry_ratio', value: 30, description: 'Second entry ratio of planned position' },
    { key: 'breakout_entry_ratio', value: 40, description: 'Breakout entry ratio of planned position' },
    { key: 'max_daily_new_entries', value: 3, description: 'Maximum new entries per day' },
    { key: 'stop_loss_basis', value: 'support_break', description: 'Invalidation basis' },
    { key: 'use_auto_order', value: 'false', description: 'Always false in MVP' },
    { key: 'total_investment', value: 5000000, description: '전체 주식 투자 설정 금액 (원)' }
  ]);
}

function seedDefaultPrompts_() {
  upsertKeyValueRows_(AM_CONFIG.SHEETS.PROMPTS, [
    {
      key: 'market_prompt_base',
      value: '전문 리서치 애널리스트처럼 설명하되, 자동매매 신호나 매수 추천처럼 쓰지 마세요. 계산값은 바꾸지 말고 조건부 관찰, 리스크, 무효화 조건 중심으로 한국어로 작성하세요.',
      description: 'Base instruction prepended to daily market briefing prompt'
    },
    {
      key: 'stock_prompt_base',
      value: '종목별 설명은 초보 투자자가 바로 이해할 수 있게 쓰세요. 보유/관찰/추가검토/회피 조건을 분리하고, 입력된 가격과 비중은 절대 재계산하지 마세요.',
      description: 'Base instruction prepended to stock analysis prompt'
    },
    {
      key: 'holdings_prompt_base',
      value: '보유종목 어드바이스는 매수/매도 지시가 아니라 리스크 점검 메모입니다. 비중, 손익, 무효화 가격, 주도주 여부, 위험 공시를 근거로 조건부 대응만 설명하세요.',
      description: 'Base instruction prepended to holdings advice prompt'
    }
  ]);
}

function applyDefaultPromptTemplates() {
  return withLogging_('setup', function() {
    ensureAllSheets_();
    seedDefaultPrompts_();
    safeUiAlert_('프롬프트 기본값을 prompts 시트에 적용했습니다.');
  });
}

function seedDefaultEtfWatch_() {
  var sheetName = AM_CONFIG.SHEETS.ETF_WATCH;
  var existing = readObjects_(sheetName);
  if (existing.length > 0) return;
  [
    { etf_symbol: '069500', etf_name: 'KODEX 200', category: 'representative', active: 'Y' },
    { etf_symbol: '102110', etf_name: 'TIGER 200', category: 'representative', active: 'Y' },
    { etf_symbol: '152100', etf_name: 'ARIRANG 200', category: 'representative', active: 'Y' },
    { etf_symbol: '229200', etf_name: 'KODEX 코스닥150', category: 'representative', active: 'Y' },
    { etf_symbol: '091160', etf_name: 'KODEX 반도체', category: 'sector', active: 'Y' },
    { etf_symbol: '091170', etf_name: 'KODEX 은행', category: 'sector', active: 'Y' },
    { etf_symbol: '091180', etf_name: 'KODEX 자동차', category: 'sector', active: 'Y' }
  ].forEach(function(row) {
    appendObjectRow_(sheetName, row);
  });
  logInfo_('setup', 'Seeded default ETF watch list', { count: 7 });
}
