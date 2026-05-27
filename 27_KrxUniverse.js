var AM_KRX_DATA_URL = 'https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd';
var AM_KRX_OPEN_API_BASE_URL = 'http://data-dbg.krx.co.kr/svc/apis/sto';

function expandUniverseFromKrxLiquidity() {
  return withLogging_('krx_universe', function() {
    ensureAllSheets_();
    applySheetFormats_();
    var listedRows = fetchKrxListedStocks_();
    var listedResult = upsertMarketUniverseRowsBulk_(listedRows, {
      newActive: 'N',
      preserveExistingActive: true,
      overwriteMetadata: false
    });
    var activatedResult = activateKrxLiquidUniverse_();
    var totalRows = readObjects_(AM_CONFIG.SHEETS.MARKET_UNIVERSE).length;
    var activeRows = readObjects_(AM_CONFIG.SHEETS.MARKET_UNIVERSE).filter(function(row) {
      return String(row.active || '').toUpperCase() === 'Y';
    }).length;
    safeUiAlert_([
      'KRX 전체 universe 확장 완료',
      '',
      '전체 상장종목 동기화: ' + listedRows.length + '개',
      '새로 추가: ' + listedResult.added + '개',
      '기존 보강: ' + listedResult.updated + '개',
      '',
      '거래대금 상위 활성화',
      '- 기준일: ' + activatedResult.snapshot_date,
      '- KOSPI: ' + activatedResult.kospi_selected + '개',
      '- KOSDAQ: ' + activatedResult.kosdaq_selected + '개',
      '',
      '현재 market_universe 전체: ' + totalRows + '개',
      '현재 active=Y: ' + activeRows + '개',
      '',
      '다음 순서:',
      '1. AI Scanner > 1. 처음 설정 > 분석 종목 검증',
      '2. 완료 후 무효 종목 비활성화',
      '3. 장마감 전체 워크플로우 실행 또는 자동화 확인',
      '',
      '참고: 기본 활성화 개수는 settings의 krx_active_kospi_count, krx_active_kosdaq_count에서 조정할 수 있습니다.'
    ].join('\n'));
    return {
      listed: listedResult,
      activated: activatedResult,
      total_rows: totalRows,
      active_rows: activeRows
    };
  });
}

function syncKrxListedUniverse() {
  return withLogging_('krx_universe', function() {
    ensureAllSheets_();
    applySheetFormats_();
    var rows = fetchKrxListedStocks_();
    var result = upsertMarketUniverseRowsBulk_(rows, {
      newActive: 'N',
      preserveExistingActive: true,
      overwriteMetadata: false
    });
    logInfo_('krx_universe', 'KRX listed universe synced', result);
    safeUiAlert_([
      'KRX 전체 상장종목 동기화 완료',
      '',
      '수집 종목: ' + rows.length + '개',
      '새로 추가: ' + result.added + '개',
      '기존 보강: ' + result.updated + '개',
      '',
      '새로 들어온 종목은 기본 active=N입니다.',
      '실제 스캔 대상으로 쓰려면 KRX 거래대금 상위 활성화를 실행하세요.'
    ].join('\n'));
    return result;
  });
}

function activateKrxLiquidUniverse() {
  return withLogging_('krx_universe', function() {
    ensureAllSheets_();
    applySheetFormats_();
    var result = activateKrxLiquidUniverse_();
    safeUiAlert_([
      'KRX 거래대금 상위 종목 활성화 완료',
      '',
      '기준일: ' + result.snapshot_date,
      'KOSPI 활성화: ' + result.kospi_selected + '개',
      'KOSDAQ 활성화: ' + result.kosdaq_selected + '개',
      '새로 추가: ' + result.upsert.added + '개',
      '기존 보강/활성화: ' + result.upsert.updated + '개',
      '',
      '다음: AI Scanner > 1. 처음 설정 > 분석 종목 검증'
    ].join('\n'));
    return result;
  });
}

function runKrxOpenApiDiagnostics() {
  return withLogging_('krx_diagnostics', function() {
    var apiKey = getScriptProperty_(AM_CONFIG.PROPERTY_KEYS.KRX_API_KEY, '');
    var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd');
    var result = {
      checked_at: amNowString_(),
      api_key: apiKey ? 'OK' : 'MISSING',
      kospi_base_info: null,
      kosdaq_base_info: null,
      kospi_daily_trade: null,
      kosdaq_daily_trade: null
    };
    if (!apiKey) {
      safeUiAlert_(formatKrxOpenApiDiagnosticMessage_(result));
      return result;
    }
    result.kospi_base_info = diagnoseStep_('kospi_base_info', function() {
      var rows = fetchKrxOpenApiRowsQuick_('stk_isu_base_info', today);
      return { ok: true, date: today, rows: rows.length };
    });
    result.kosdaq_base_info = diagnoseStep_('kosdaq_base_info', function() {
      var rows = fetchKrxOpenApiRowsQuick_('ksq_isu_base_info', today);
      return { ok: true, date: today, rows: rows.length };
    });
    result.kospi_daily_trade = diagnoseStep_('kospi_daily_trade', function() {
      var rows = fetchKrxOpenApiRowsQuick_('stk_bydd_trd', today);
      return { ok: true, date: today, rows: rows.length };
    });
    result.kosdaq_daily_trade = diagnoseStep_('kosdaq_daily_trade', function() {
      var rows = fetchKrxOpenApiRowsQuick_('ksq_bydd_trd', today);
      return { ok: true, date: today, rows: rows.length };
    });
    logInfo_('krx_diagnostics', 'KRX Open API diagnostics completed', result);
    safeUiAlert_(formatKrxOpenApiDiagnosticMessage_(result));
    return result;
  });
}

function activateKrxLiquidUniverse_() {
  var lookbackDays = Math.max(10, Math.round(getSettingNumber_('krx_snapshot_lookback_days', 45)));
  var snapshot = fetchLatestKrxMarketSnapshot_(lookbackDays);
  var kospiCount = Math.max(0, Math.round(getSettingNumber_('krx_active_kospi_count', 120)));
  var kosdaqCount = Math.max(0, Math.round(getSettingNumber_('krx_active_kosdaq_count', 180)));
  var selected = selectKrxLiquidUniverseRows_(snapshot.rows, kospiCount, kosdaqCount);
  var upsert = upsertMarketUniverseRowsBulk_(selected.rows, {
    newActive: 'Y',
    forceActive: true,
    preserveExistingActive: false,
    overwriteMetadata: true
  });
  logInfo_('krx_universe', 'KRX liquid universe activated', {
    snapshot_date: snapshot.date,
    kospi_selected: selected.kospi.length,
    kosdaq_selected: selected.kosdaq.length,
    upsert: upsert
  });
  return {
    snapshot_date: snapshot.date,
    kospi_selected: selected.kospi.length,
    kosdaq_selected: selected.kosdaq.length,
    selected_total: selected.rows.length,
    upsert: upsert
  };
}

function fetchKrxListedStocks_() {
  if (hasKrxOpenApiKey_()) {
    return fetchKrxOpenApiListedStocks_();
  }
  throw new Error('KRX_API_KEY가 없습니다. KRX 웹 조회는 Apps Script에서 LOGOUT으로 막힐 수 있어 KRX OPEN API 인증키가 필요합니다. 스크립트 속성에 KRX_API_KEY를 저장한 뒤 다시 실행하세요.');
}

function fetchKrxWebListedStocks_() {
  var json = fetchKrxJson_({
    bld: 'dbms/MDC/STAT/standard/MDCSTAT01901',
    locale: 'ko_KR',
    mktId: 'ALL',
    share: '1',
    csvxls_isNo: 'false'
  });
  var rows = json.OutBlock_1 || json.output || [];
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('KRX 상장종목 목록 응답이 비어 있습니다: ' + JSON.stringify(json).slice(0, 500));
  }
  return rows.map(function(row) {
    return normalizeKrxListedRow_(row);
  }).filter(function(row) {
    return row.symbol && isKrxStockMarket_(row.market);
  });
}

function fetchKrxOpenApiListedStocks_() {
  var kospi = fetchKrxOpenApiRowsForLatestDate_('stk_isu_base_info', 10).rows.map(function(row) {
    return normalizeKrxOpenApiListedRow_(row, 'KOSPI');
  });
  var kosdaq = fetchKrxOpenApiRowsForLatestDate_('ksq_isu_base_info', 10).rows.map(function(row) {
    return normalizeKrxOpenApiListedRow_(row, 'KOSDAQ');
  });
  return kospi.concat(kosdaq).filter(function(row) {
    return row.symbol && isKrxStockMarket_(row.market);
  });
}

function fetchLatestKrxMarketSnapshot_(lookbackDays) {
  var days = Math.max(0, lookbackDays || 0);
  var lastError = null;
  for (var i = 0; i <= days; i += 1) {
    var date = new Date(new Date().getTime() - i * 24 * 60 * 60 * 1000);
    var ymd = Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyyMMdd');
    try {
      var rows = fetchKrxMarketSnapshotForDate_(ymd);
      if (rows.length > 0) {
        return { date: ymd, rows: rows };
      }
    } catch (err) {
      lastError = err;
      logWarn_('krx_universe', 'KRX market snapshot fetch failed for date', {
        date: ymd,
        error: err.message || String(err)
      });
    }
  }
  throw new Error('최근 ' + (days + 1) + '일 안에서 KRX 전종목 시세를 찾지 못했습니다: ' + (lastError ? lastError.message || String(lastError) : 'empty response'));
}

function fetchKrxMarketSnapshotForDate_(yyyymmdd) {
  if (hasKrxOpenApiKey_()) {
    return fetchKrxOpenApiMarketSnapshotForDate_(yyyymmdd);
  }
  throw new Error('KRX_API_KEY가 없습니다. 거래대금 상위 universe를 만들려면 KRX OPEN API 인증키가 필요합니다.');
}

function fetchKrxWebMarketSnapshotForDate_(yyyymmdd) {
  var json = fetchKrxJson_({
    bld: 'dbms/MDC/STAT/standard/MDCSTAT01501',
    locale: 'ko_KR',
    mktId: 'ALL',
    trdDd: yyyymmdd,
    share: '1',
    money: '1',
    csvxls_isNo: 'false'
  });
  var rows = json.OutBlock_1 || json.output || [];
  if (!Array.isArray(rows)) return [];
  return rows.map(function(row) {
    return normalizeKrxSnapshotRow_(row);
  }).filter(function(row) {
    return row.symbol &&
      isKrxStockMarket_(row.market) &&
      row.close > 0 &&
      row.trading_value > 0;
  });
}

function fetchKrxOpenApiMarketSnapshotForDate_(yyyymmdd) {
  var kospi = fetchKrxOpenApiRows_('stk_bydd_trd', yyyymmdd).map(function(row) {
    return normalizeKrxOpenApiSnapshotRow_(row, 'KOSPI');
  });
  var kosdaq = fetchKrxOpenApiRows_('ksq_bydd_trd', yyyymmdd).map(function(row) {
    return normalizeKrxOpenApiSnapshotRow_(row, 'KOSDAQ');
  });
  return kospi.concat(kosdaq).filter(function(row) {
    return row.symbol &&
      isKrxStockMarket_(row.market) &&
      row.close > 0 &&
      row.trading_value > 0;
  });
}

function fetchKrxJson_(payload) {
  try {
    return apiFetchJson_(AM_KRX_DATA_URL, {
      method: 'post',
      payload: payload,
      headers: {
        Referer: 'https://data.krx.co.kr/contents/MDC/MAIN/main/index.cmd',
        'User-Agent': 'Mozilla/5.0'
      },
      muteHttpExceptions: true
    }, 'krx_universe');
  } catch (err) {
    var text = String(err && err.message ? err.message : err);
    if (text.indexOf('LOGOUT') >= 0) {
      throw new Error('KRX 웹 조회가 LOGOUT으로 차단되었습니다. KRX OPEN API 인증키를 스크립트 속성 KRX_API_KEY에 저장한 뒤 다시 실행하세요.');
    }
    throw err;
  }
}

function hasKrxOpenApiKey_() {
  return !!getScriptProperty_(AM_CONFIG.PROPERTY_KEYS.KRX_API_KEY, '');
}

function fetchKrxOpenApiRowsForLatestDate_(endpoint, lookbackDays) {
  var days = Math.max(0, lookbackDays || 0);
  var lastError = null;
  for (var i = 0; i <= days; i += 1) {
    var date = new Date(new Date().getTime() - i * 24 * 60 * 60 * 1000);
    var ymd = Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyyMMdd');
    try {
      var rows = fetchKrxOpenApiRows_(endpoint, ymd);
      if (rows.length > 0) return { date: ymd, rows: rows };
    } catch (err) {
      lastError = err;
      logWarn_('krx_open_api', 'KRX Open API fetch failed for date', {
        endpoint: endpoint,
        date: ymd,
        error: err.message || String(err)
      });
    }
  }
  throw new Error('KRX OPEN API에서 최근 ' + (days + 1) + '일 데이터 조회에 실패했습니다. endpoint=' + endpoint + ', error=' + (lastError ? lastError.message || String(lastError) : 'empty response'));
}

function fetchKrxOpenApiRows_(endpoint, yyyymmdd) {
  var apiKey = getRequiredScriptProperty_(AM_CONFIG.PROPERTY_KEYS.KRX_API_KEY);
  var url = AM_KRX_OPEN_API_BASE_URL + '/' + endpoint + '?basDd=' + encodeURIComponent(yyyymmdd);
  var json = apiFetchJson_(url, {
    method: 'get',
    headers: {
      AUTH_KEY: apiKey
    },
    muteHttpExceptions: true
  }, 'krx_open_api');
  var rows = extractKrxOpenApiRows_(json);
  if (isKrxOpenApiError_(json)) {
    throw new Error('KRX OPEN API 오류: ' + JSON.stringify(json).slice(0, 800));
  }
  return rows;
}

function fetchKrxOpenApiRowsQuick_(endpoint, yyyymmdd) {
  var apiKey = getRequiredScriptProperty_(AM_CONFIG.PROPERTY_KEYS.KRX_API_KEY);
  var url = AM_KRX_OPEN_API_BASE_URL + '/' + endpoint + '?basDd=' + encodeURIComponent(yyyymmdd);
  var response = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: {
      AUTH_KEY: apiKey
    },
    muteHttpExceptions: true
  });
  var status = response.getResponseCode();
  var text = response.getContentText();
  if (status < 200 || status >= 300) {
    throw new Error('HTTP ' + status + ': ' + text.slice(0, 500));
  }
  var json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch (err) {
    throw new Error('KRX OPEN API JSON 파싱 실패: ' + err.message + ' text=' + text.slice(0, 500));
  }
  if (isKrxOpenApiError_(json)) {
    throw new Error('KRX OPEN API 오류: ' + JSON.stringify(json).slice(0, 800));
  }
  return extractKrxOpenApiRows_(json);
}

function extractKrxOpenApiRows_(json) {
  if (!json) return [];
  if (Array.isArray(json.OutBlock_1)) return json.OutBlock_1;
  if (Array.isArray(json.outBlock1)) return json.outBlock1;
  if (Array.isArray(json.output)) return json.output;
  if (Array.isArray(json.data)) return json.data;
  if (json.response && json.response.body && json.response.body.items) {
    var item = json.response.body.items.item;
    if (Array.isArray(item)) return item;
    if (item) return [item];
  }
  return [];
}

function isKrxOpenApiError_(json) {
  var text = JSON.stringify(json || {});
  return text.indexOf('Unauthorized') >= 0 ||
    text.indexOf('INVALID') >= 0 ||
    text.indexOf('ERROR') >= 0 ||
    text.indexOf('ERR_CD') >= 0 ||
    text.indexOf('resultCode') >= 0 && text.indexOf('"resultCode":"0"') < 0 && text.indexOf('"resultCode":0') < 0;
}

function normalizeKrxListedRow_(row) {
  var symbol = normalizeStockSymbol_(extractKrxSymbol_(row));
  return {
    symbol: symbol,
    name: String(row.ISU_ABBRV || row.ISU_NM || row.codeName || '').trim(),
    market: normalizeKrxMarketName_(row.MKT_TP_NM || row.MKT_NM || row.marketName || ''),
    sector: normalizeKrxSectorName_(row.SECT_TP_NM || row.SECUGRP_NM || row.MKT_TP_NM || '')
  };
}

function normalizeKrxSnapshotRow_(row) {
  var listed = normalizeKrxListedRow_(row);
  listed.close = parseKrxNumber_(row.TDD_CLSPRC || row.Close || row.close);
  listed.change_pct = parseKrxNumber_(row.FLUC_RT || row.ChangeRate || row.change_pct);
  listed.volume = parseKrxNumber_(row.ACC_TRDVOL || row.Volume || row.volume);
  listed.trading_value = parseKrxNumber_(row.ACC_TRDVAL || row.Amount || row.trading_value);
  return listed;
}

function normalizeKrxOpenApiListedRow_(row, marketFallback) {
  var symbol = normalizeStockSymbol_(extractKrxSymbol_(row));
  return {
    symbol: symbol,
    name: String(row.ISU_ABBRV || row.ISU_NM || row.ISU_NM_KOR || row.KOR_ISU_NM || '').trim(),
    market: normalizeKrxMarketName_(row.MKT_TP_NM || row.MKT_NM || marketFallback || ''),
    sector: normalizeKrxSectorName_(row.SECT_TP_NM || row.SECUGRP_NM || row.IDX_IND_NM || row.MKT_TP_NM || '')
  };
}

function normalizeKrxOpenApiSnapshotRow_(row, marketFallback) {
  var listed = normalizeKrxOpenApiListedRow_(row, marketFallback);
  listed.close = parseKrxNumber_(row.TDD_CLSPRC || row.CLSPRC || row.Close || row.close);
  listed.change_pct = parseKrxNumber_(row.FLUC_RT || row.ChangeRate || row.change_pct);
  listed.volume = parseKrxNumber_(row.ACC_TRDVOL || row.ACC_TRD_VOL || row.Volume || row.volume);
  listed.trading_value = parseKrxNumber_(row.ACC_TRDVAL || row.ACC_TRD_VAL || row.Amount || row.trading_value);
  return listed;
}

function extractKrxSymbol_(row) {
  return row.ISU_SRT_CD ||
    row.SRT_CD ||
    row.ISU_CD ||
    row.STK_CD ||
    row.SHRT_CODE ||
    row.short_code ||
    row.code ||
    '';
}

function formatKrxOpenApiDiagnosticMessage_(result) {
  return [
    'KRX OPEN API 연결 진단',
    '',
    'KRX_API_KEY: ' + result.api_key,
    '',
    'KOSPI 종목기본정보: ' + formatKrxDiagnosticStatus_(result.kospi_base_info),
    'KOSDAQ 종목기본정보: ' + formatKrxDiagnosticStatus_(result.kosdaq_base_info),
    'KOSPI 일별매매정보: ' + formatKrxDiagnosticStatus_(result.kospi_daily_trade),
    'KOSDAQ 일별매매정보: ' + formatKrxDiagnosticStatus_(result.kosdaq_daily_trade),
    '',
    '참고: 진단은 시간초과 방지를 위해 오늘 날짜 1회만 빠르게 확인합니다. 장 시작 전/휴장일에는 연결이 정상이어도 rows가 0일 수 있습니다.',
    '',
    '실패하면 KRX OPEN API 사이트에서 주식 서비스 신청/승인 여부와 인증키를 확인하세요.'
  ].join('\n');
}

function formatKrxDiagnosticStatus_(stepResult) {
  if (!stepResult) return '실행 안 됨';
  if (!stepResult.ok) return '실패 - ' + formatKrxErrorHint_(stepResult.error);
  return '정상' +
    (stepResult.date ? ' / 기준일 ' + stepResult.date : '') +
    (stepResult.rows !== undefined ? ' / rows ' + stepResult.rows : '');
}

function formatKrxErrorHint_(errorText) {
  var text = String(errorText || '');
  if (text.indexOf('HTTP 401') >= 0 || text.indexOf('Unauthorized API Call') >= 0) {
    return text + '\n  → 인증키는 입력됐지만 이 API에 대한 이용신청/승인이 안 되었거나, 다른 계정/서비스의 키일 가능성이 큽니다.';
  }
  if (text.indexOf('KRX_API_KEY') >= 0) {
    return text + '\n  → Apps Script 속성에 KRX_API_KEY를 저장해야 합니다.';
  }
  return text;
}

function normalizeKrxMarketName_(value) {
  var text = String(value || '').trim();
  var upper = text.toUpperCase();
  if (upper.indexOf('KOSDAQ') >= 0 || text.indexOf('코스닥') >= 0) return 'KOSDAQ';
  if (upper.indexOf('KOSPI') >= 0 || text.indexOf('유가증권') >= 0) return 'KOSPI';
  if (upper.indexOf('KONEX') >= 0 || text.indexOf('코넥스') >= 0) return 'KONEX';
  return text || 'UNKNOWN';
}

function normalizeKrxSectorName_(value) {
  var text = String(value || '').trim();
  if (!text || text === '-' || text === '주권') return '미분류';
  return text;
}

function isKrxStockMarket_(market) {
  var text = String(market || '').toUpperCase();
  return text === 'KOSPI' || text === 'KOSDAQ';
}

function parseKrxNumber_(value) {
  var text = String(value === undefined || value === null ? '' : value)
    .replace(/,/g, '')
    .replace(/%/g, '')
    .trim();
  if (!text || text === '-') return 0;
  var parsed = Number(text);
  return isNaN(parsed) ? 0 : parsed;
}

function selectKrxLiquidUniverseRows_(rows, kospiCount, kosdaqCount) {
  var kospi = [];
  var kosdaq = [];
  rows.forEach(function(row) {
    if (row.market === 'KOSPI') kospi.push(row);
    if (row.market === 'KOSDAQ') kosdaq.push(row);
  });
  kospi.sort(sortByTradingValueDesc_);
  kosdaq.sort(sortByTradingValueDesc_);
  var selectedKospi = kospi.slice(0, kospiCount);
  var selectedKosdaq = kosdaq.slice(0, kosdaqCount);
  return {
    kospi: selectedKospi,
    kosdaq: selectedKosdaq,
    rows: selectedKospi.concat(selectedKosdaq)
  };
}

function sortByTradingValueDesc_(a, b) {
  return Number(b.trading_value || 0) - Number(a.trading_value || 0);
}

function upsertMarketUniverseRowsBulk_(rows, options) {
  options = options || {};
  var sheetName = AM_CONFIG.SHEETS.MARKET_UNIVERSE;
  var headers = AM_SHEET_SCHEMAS[sheetName];
  var sheet = ensureSheet_(sheetName, headers);
  var values = sheet.getDataRange().getValues();
  var dataRows = values.slice(1).filter(function(row) {
    return row.some(function(cell) { return cell !== ''; });
  });
  var indexes = {
    symbol: headers.indexOf('symbol'),
    name: headers.indexOf('name'),
    market: headers.indexOf('market'),
    sector: headers.indexOf('sector'),
    active: headers.indexOf('active')
  };
  var rowBySymbol = {};
  dataRows.forEach(function(row, index) {
    var symbol = normalizeStockSymbol_(row[indexes.symbol]);
    if (symbol) {
      row[indexes.symbol] = symbol;
      rowBySymbol[symbol] = index;
    }
  });
  var added = 0;
  var updated = 0;
  var activated = 0;
  rows.forEach(function(inputRow) {
    var symbol = normalizeStockSymbol_(inputRow.symbol);
    if (!symbol) return;
    var rowIndex = rowBySymbol[symbol];
    if (rowIndex !== undefined) {
      var existing = dataRows[rowIndex];
      existing[indexes.symbol] = symbol;
      if (options.overwriteMetadata || !existing[indexes.name]) existing[indexes.name] = inputRow.name || existing[indexes.name] || '';
      if (options.overwriteMetadata || !existing[indexes.market]) existing[indexes.market] = inputRow.market || existing[indexes.market] || '';
      if (options.overwriteMetadata || !existing[indexes.sector]) existing[indexes.sector] = inputRow.sector || existing[indexes.sector] || '미분류';
      if (options.forceActive) {
        if (String(existing[indexes.active] || '').toUpperCase() !== 'Y') activated += 1;
        existing[indexes.active] = 'Y';
      } else if (!options.preserveExistingActive && options.newActive) {
        existing[indexes.active] = options.newActive;
      } else if (!existing[indexes.active]) {
        existing[indexes.active] = options.newActive || 'N';
      }
      updated += 1;
      return;
    }
    var active = options.forceActive ? 'Y' : (options.newActive || 'N');
    var newRow = [];
    newRow[indexes.symbol] = symbol;
    newRow[indexes.name] = inputRow.name || '';
    newRow[indexes.market] = inputRow.market || '';
    newRow[indexes.sector] = inputRow.sector || '미분류';
    newRow[indexes.active] = active;
    dataRows.push(headers.map(function(_, index) {
      return newRow[index] === undefined ? '' : newRow[index];
    }));
    rowBySymbol[symbol] = dataRows.length - 1;
    added += 1;
    if (active === 'Y') activated += 1;
  });
  rewriteDataRows_(sheet, headers.length, dataRows);
  applySheetFormats_();
  normalizeMarketUniverseSheet_();
  return {
    added: added,
    updated: updated,
    activated: activated,
    input: rows.length
  };
}
