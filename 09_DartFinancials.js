function runDartConnectionDiagnostics() {
  return withLogging_('dart_diagnostics', function() {
    ensureAllSheets_();
    var xmlText = '';
    var result = {
      checked_at: amNowString_(),
      has_api_key: !!getScriptProperty_(AM_CONFIG.PROPERTY_KEYS.DART_API_KEY, ''),
      corp_code_zip: null,
      samsung_match: null
    };

    result.corp_code_zip = diagnoseStep_('dart_corp_code_zip', function() {
      xmlText = fetchDartCorpCodeXmlText_();
      return {
        ok: xmlText.indexOf('<result>') >= 0,
        bytes: xmlText.length
      };
    });

    result.samsung_match = diagnoseStep_('dart_samsung_match', function() {
      var match = findDartCorpCodeByStockCodeInXml_(xmlText, '005930');
      if (!match) {
        throw new Error('Could not find Samsung Electronics stock_code 005930 in OpenDART corpCode.xml');
      }
      return {
        ok: true,
        corp_code: match.corp_code,
        corp_name: match.corp_name,
        stock_code: match.stock_code
      };
    });

    logInfo_('dart_diagnostics', 'OpenDART diagnostics completed', result);
    safeUiAlert_(formatDartDiagnosticMessage_(result));
    return result;
  });
}

function syncDartCorpMaster() {
  return withLogging_('dart_corp_master', function() {
    ensureAllSheets_();
    var entries = fetchDartCorpCodeEntries_().filter(function(row) {
      return normalizeStockSymbol_(row.stock_code);
    });
    writeDartCorpMasterRows_(entries);
    logInfo_('dart_corp_master', 'Synced DART corp master', { count: entries.length });
    safeUiAlert_('DART 기업코드 동기화 완료\n\n상장사 수: ' + entries.length + '개');
    return entries.length;
  });
}

function writeDartCorpMasterRows_(entries) {
  var sheetName = AM_CONFIG.SHEETS.DART_CORP_MASTER;
  var headers = AM_SHEET_SCHEMAS[sheetName];
  var sheet = ensureSheet_(sheetName, headers);
  clearDataRows_(sheetName);
  if (entries.length === 0) return;
  var now = amNowString_();
  var rows = entries.map(function(row) {
    var symbol = normalizeStockSymbol_(row.stock_code);
    return [
      symbol,
      String(row.corp_code || '').trim(),
      row.corp_name,
      symbol,
      now
    ];
  });
  var symbolIndex = headers.indexOf('symbol') + 1;
  var corpCodeIndex = headers.indexOf('corp_code') + 1;
  var stockCodeIndex = headers.indexOf('stock_code') + 1;
  if (symbolIndex > 0) sheet.getRange(2, symbolIndex, rows.length, 1).setNumberFormat('@');
  if (corpCodeIndex > 0) sheet.getRange(2, corpCodeIndex, rows.length, 1).setNumberFormat('@');
  if (stockCodeIndex > 0) sheet.getRange(2, stockCodeIndex, rows.length, 1).setNumberFormat('@');
  sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
}

function collectDartFinancialsForLeaders() {
  return withLogging_('dart_financials', function() {
    ensureAllSheets_();
    var today = amTodayString_();
    var topN = Math.max(getSettingNumber_('report_top_n', 10), getSettingNumber_('dart_collect_top_n', 20));
    var leaders = readObjects_(AM_CONFIG.SHEETS.LEADER_50).filter(function(row) {
      return normalizeDateValue_(row.date) === today;
    }).slice(0, topN);
    if (leaders.length === 0) {
      throw new Error('오늘 날짜의 leader_50 데이터가 없습니다. 핵심 파이프라인을 먼저 완료하세요.');
    }
    var corpMap = getDartCorpMasterMap_();
    if (Object.keys(corpMap).length === 0) {
      throw new Error('dart_corp_master가 비어 있습니다. DART 기업코드 동기화를 먼저 실행하세요.');
    }
    deleteRowsByDate_(AM_CONFIG.SHEETS.FINANCIAL_RAW, today);
    deleteRowsByDate_(AM_CONFIG.SHEETS.FINANCIAL_RATIOS, today);
    deleteRowsByDate_(AM_CONFIG.SHEETS.RISK_ALERTS, today);
    leaders.forEach(function(leader) {
      var symbol = normalizeStockSymbol_(leader.symbol);
      var master = corpMap[symbol];
      if (!master) {
        appendObjectRow_(AM_CONFIG.SHEETS.RISK_ALERTS, {
          date: today,
          symbol: symbol,
          risk_type: 'dart',
          risk_level: 'medium',
          message: 'No DART corp_code mapping found.',
          source: 'dart_corp_master'
        });
        return;
      }
      collectDartFinancialForStock_(today, symbol, leader.sector, master.corp_code);
      scanDartDisclosureRiskForStock_(today, symbol, master.corp_code);
    });
    buildLeaderCandidates();
    scanRiskAlerts();
    dedupeRiskAlertsForDate_(today);
    buildEntryPlan();
    buildScenarioDaily_();
    logInfo_('dart_financials', 'Collected DART financials for leaders and rebuilt scores', { count: leaders.length });
  });
}

function collectDartFinancialForStock_(today, symbol, sector, corpCode) {
  var result = fetchLatestDartAnnualAccounts_(corpCode, new Date().getFullYear() - 1, 3);
  if (!result || !result.accounts || result.accounts.length === 0) {
    appendObjectRow_(AM_CONFIG.SHEETS.RISK_ALERTS, {
      date: today,
      symbol: symbol,
      risk_type: 'financial',
      risk_level: 'medium',
      message: 'No annual financial statement data found from OpenDART.',
      source: 'opendart_fnlttSinglAcnt'
    });
    return;
  }
  result.accounts.forEach(function(account) {
    appendObjectRow_(AM_CONFIG.SHEETS.FINANCIAL_RAW, {
      date: today,
      symbol: symbol,
      corp_code: corpCode,
      period: String(result.year),
      account_name: account.account_nm,
      amount: normalizeDartAmount_(account.thstrm_amount),
      raw_json: account
    });
  });
  var ratios = calculateFinancialRatiosFromAccounts_(result.accounts, sector);
  appendObjectRow_(AM_CONFIG.SHEETS.FINANCIAL_RATIOS, {
    date: today,
    symbol: symbol,
    revenue_growth: ratios.revenue_growth,
    op_income_growth: ratios.op_income_growth,
    op_margin: ratios.op_margin,
    roe: ratios.roe,
    debt_ratio: ratios.debt_ratio,
    current_ratio: ratios.current_ratio,
    ocf: '',
    fcf: '',
    financial_score: ratios.financial_score
  });
  appendFinancialRiskAlerts_(today, symbol, sector, ratios);
}

function fetchLatestDartAnnualAccounts_(corpCode, startYear, maxLookbackYears) {
  for (var offset = 0; offset < maxLookbackYears; offset += 1) {
    var year = startYear - offset;
    var response = fetchDartJson_('fnlttSinglAcnt.json', {
      corp_code: corpCode,
      bsns_year: year,
      reprt_code: '11011'
    });
    if (response.status === '000' && response.list && response.list.length > 0) {
      return { year: year, accounts: preferConsolidatedAccounts_(response.list) };
    }
  }
  return null;
}

function preferConsolidatedAccounts_(accounts) {
  var consolidated = accounts.filter(function(row) {
    return row.fs_div === 'CFS';
  });
  return consolidated.length > 0 ? consolidated : accounts;
}

function calculateFinancialRatiosFromAccounts_(accounts, sector) {
  var revenue = getAccountAmount_(accounts, ['매출액', '영업수익'], 'thstrm_amount');
  var revenuePrev = getAccountAmount_(accounts, ['매출액', '영업수익'], 'frmtrm_amount');
  var opIncome = getAccountAmount_(accounts, ['영업이익'], 'thstrm_amount');
  var opIncomePrev = getAccountAmount_(accounts, ['영업이익'], 'frmtrm_amount');
  var netIncome = getAccountAmount_(accounts, ['당기순이익'], 'thstrm_amount');
  var liabilities = getAccountAmount_(accounts, ['부채총계'], 'thstrm_amount');
  var equity = getAccountAmount_(accounts, ['자본총계'], 'thstrm_amount');
  var currentAssets = getAccountAmount_(accounts, ['유동자산'], 'thstrm_amount');
  var currentLiabilities = getAccountAmount_(accounts, ['유동부채'], 'thstrm_amount');
  var ratios = {
    revenue_growth: calcGrowthPct_(revenue, revenuePrev),
    op_income_growth: calcGrowthPct_(opIncome, opIncomePrev),
    op_margin: revenue ? roundNumber_((opIncome / revenue) * 100, 2) : 0,
    roe: equity ? roundNumber_((netIncome / equity) * 100, 2) : 0,
    debt_ratio: equity ? roundNumber_((liabilities / equity) * 100, 2) : 0,
    current_ratio: currentLiabilities ? roundNumber_((currentAssets / currentLiabilities) * 100, 2) : 0
  };
  ratios.financial_score = calculateFinancialScore_(ratios, sector);
  return ratios;
}

function getAccountAmount_(accounts, names, field) {
  var accountIds = getDartAccountIdsForNames_(names);
  for (var idIndex = 0; idIndex < accountIds.length; idIndex += 1) {
    for (var accountIndex = 0; accountIndex < accounts.length; accountIndex += 1) {
      var account = accounts[accountIndex];
      if (String(account.account_id || '') === accountIds[idIndex] && hasDartAmountValue_(account[field])) {
        return normalizeDartAmount_(account[field]);
      }
    }
  }
  for (var i = 0; i < names.length; i += 1) {
    for (var j = 0; j < accounts.length; j += 1) {
      var accountName = String(accounts[j].account_nm || '');
      if (accountName === names[i] || accountName.indexOf(names[i]) >= 0) {
        return normalizeDartAmount_(accounts[j][field]);
      }
    }
  }
  return 0;
}

function getDartAccountIdsForNames_(names) {
  var text = String((names || []).join('|'));
  if (text.indexOf('매출') >= 0 || text.indexOf('영업수익') >= 0) {
    return [
      'ifrs-full_Revenue',
      'ifrs-full_RevenueFromContractsWithCustomersExcludingAssessedTax',
      'ifrs-full_RevenueFromContractsWithCustomersIncludingAssessedTax',
      'ifrs-full_SalesRevenueGoods',
      'ifrs-full_SalesRevenueServices'
    ];
  }
  if (text.indexOf('영업이익') >= 0) {
    return ['dart_OperatingIncomeLoss', 'ifrs-full_OperatingIncomeLoss'];
  }
  if (text.indexOf('당기순이익') >= 0) {
    return ['ifrs-full_ProfitLoss'];
  }
  if (text.indexOf('부채총계') >= 0) {
    return ['ifrs-full_Liabilities'];
  }
  if (text.indexOf('자본총계') >= 0) {
    return ['ifrs-full_Equity'];
  }
  if (text.indexOf('유동자산') >= 0) {
    return ['ifrs-full_CurrentAssets'];
  }
  if (text.indexOf('유동부채') >= 0) {
    return ['ifrs-full_CurrentLiabilities'];
  }
  return [];
}

function hasDartAmountValue_(value) {
  var text = String(value || '').replace(/,/g, '').trim();
  return !!text && text !== '-';
}

function normalizeDartAmount_(value) {
  var text = String(value || '').replace(/,/g, '').trim();
  if (!text || text === '-') return 0;
  var negative = /^\(.*\)$/.test(text);
  text = text.replace(/[()]/g, '');
  var amount = Number(text);
  if (isNaN(amount)) return 0;
  return negative ? -amount : amount;
}

function calcGrowthPct_(current, previous) {
  if (!previous) return 0;
  return roundNumber_(((current - previous) / Math.abs(previous)) * 100, 2);
}

function calculateFinancialScore_(ratios, sector) {
  if (isFinancialSector_(sector)) {
    return calculateFinancialSectorScore_(ratios);
  }
  var score = 50;
  score += boundedScore_(ratios.revenue_growth, -20, 30, -10, 15);
  score += boundedScore_(ratios.op_income_growth, -30, 40, -10, 15);
  score += boundedScore_(ratios.op_margin, 0, 20, 0, 15);
  score += boundedScore_(ratios.roe, 0, 20, 0, 10);
  score += boundedScore_(200 - ratios.debt_ratio, 0, 200, -10, 10);
  if (ratios.current_ratio > 0) score += boundedScore_(ratios.current_ratio, 80, 200, -5, 10);
  return Math.round(Math.max(0, Math.min(100, score)));
}

function calculateFinancialSectorScore_(ratios) {
  var score = 50;
  score += boundedScore_(ratios.op_income_growth, -20, 30, -8, 15);
  score += boundedScore_(ratios.roe, 0, 15, -5, 25);
  if (ratios.revenue_growth !== 0) {
    score += boundedScore_(ratios.revenue_growth, -10, 20, -5, 10);
  }
  return Math.round(Math.max(0, Math.min(100, score)));
}

function boundedScore_(value, minValue, maxValue, minScore, maxScore) {
  if (value <= minValue) return minScore;
  if (value >= maxValue) return maxScore;
  return minScore + ((value - minValue) / (maxValue - minValue)) * (maxScore - minScore);
}

function appendFinancialRiskAlerts_(today, symbol, sector, ratios) {
  if (ratios.revenue_growth > 0 && ratios.op_income_growth < 0) {
    appendObjectRow_(AM_CONFIG.SHEETS.RISK_ALERTS, {
      date: today,
      symbol: symbol,
      risk_type: 'financial',
      risk_level: 'medium',
      message: 'Revenue increased but operating income decreased.',
      source: 'opendart_financial_ratios'
    });
  }
  if (!isFinancialSector_(sector) && ratios.debt_ratio >= 250) {
    appendObjectRow_(AM_CONFIG.SHEETS.RISK_ALERTS, {
      date: today,
      symbol: symbol,
      risk_type: 'financial',
      risk_level: 'high',
      message: 'Debt ratio is high: ' + ratios.debt_ratio + '%.',
      source: 'opendart_financial_ratios'
    });
  }
}

function isFinancialSector_(sector) {
  var text = String(sector || '');
  return ['금융', '은행', '보험', '증권', '카드'].some(function(keyword) {
    return text.indexOf(keyword) >= 0;
  });
}

function scanDartDisclosureRiskForStock_(today, symbol, corpCode) {
  var end = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd');
  var start = Utilities.formatDate(new Date(new Date().getTime() - 120 * 24 * 60 * 60 * 1000), Session.getScriptTimeZone(), 'yyyyMMdd');
  var response = fetchDartJson_('list.json', {
    corp_code: corpCode,
    bgn_de: start,
    end_de: end,
    page_no: 1,
    page_count: 100
  });
  if (response.status !== '000' || !response.list) return;
  response.list.forEach(function(item) {
    var risk = classifyDartDisclosureRisk_(item.report_nm);
    if (!risk) return;
    appendObjectRow_(AM_CONFIG.SHEETS.RISK_ALERTS, {
      date: today,
      symbol: symbol,
      risk_type: 'disclosure',
      risk_level: risk.level,
      message: risk.message + ': ' + item.report_nm,
      source: 'opendart_list'
    });
  });
}

function classifyDartDisclosureRisk_(reportName) {
  var name = String(reportName || '');
  var patterns = [
    { keyword: '유상증자', level: 'high', message: 'Paid-in capital increase disclosure detected' },
    { keyword: '전환사채', level: 'medium', message: 'Convertible bond disclosure detected' },
    { keyword: '신주인수권부사채', level: 'medium', message: 'Bond with warrants disclosure detected' },
    { keyword: '감사의견', level: 'high', message: 'Audit opinion related disclosure detected' },
    { keyword: '거래정지', level: 'high', message: 'Trading suspension related disclosure detected' },
    { keyword: '불성실공시', level: 'medium', message: 'Unfaithful disclosure related item detected' },
    { keyword: '소송', level: 'medium', message: 'Litigation related disclosure detected' },
    { keyword: '최대주주 변경', level: 'medium', message: 'Largest shareholder change detected' }
  ];
  for (var i = 0; i < patterns.length; i += 1) {
    if (name.indexOf(patterns[i].keyword) >= 0) return patterns[i];
  }
  return null;
}

function fetchDartJson_(endpoint, params) {
  var apiKey = getRequiredScriptProperty_(AM_CONFIG.PROPERTY_KEYS.DART_API_KEY);
  var merged = { crtfc_key: apiKey };
  Object.keys(params || {}).forEach(function(key) {
    merged[key] = params[key];
  });
  var url = 'https://opendart.fss.or.kr/api/' + endpoint + '?' + buildQueryString_(merged);
  var json = apiFetchJson_(url, { method: 'get', muteHttpExceptions: true }, 'opendart');
  if (json.status && json.status !== '000' && json.status !== '013') {
    throw new Error('OpenDART ' + endpoint + ' failed: ' + json.status + ' ' + json.message);
  }
  return json;
}

function getDartCorpMasterMap_() {
  var map = {};
  readObjects_(AM_CONFIG.SHEETS.DART_CORP_MASTER).forEach(function(row) {
    map[normalizeStockSymbol_(row.symbol)] = row;
  });
  return map;
}

function fetchDartCorpCodeEntries_() {
  return parseDartCorpCodeXml_(fetchDartCorpCodeXmlText_());
}

function fetchDartCorpCodeXmlText_() {
  var apiKey = getRequiredScriptProperty_(AM_CONFIG.PROPERTY_KEYS.DART_API_KEY);
  var url = 'https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key=' + encodeURIComponent(apiKey);
  var response = UrlFetchApp.fetch(url, { method: 'get', muteHttpExceptions: true });
  var status = response.getResponseCode();
  if (status < 200 || status >= 300) {
    throw new Error('OpenDART corpCode request failed HTTP ' + status + ': ' + response.getContentText());
  }
  var blob = response.getBlob();
  var contentType = String(blob.getContentType() || response.getHeaders()['Content-Type'] || '');
  var bytes = blob.getBytes();
  var isZipSignature = bytes && bytes.length >= 2 && bytes[0] === 80 && bytes[1] === 75;
  if (!isZipSignature && contentType.indexOf('zip') < 0 && contentType.indexOf('octet-stream') < 0 && contentType.indexOf('x-msdownload') < 0) {
    var text = response.getContentText('UTF-8');
    throw new Error('OpenDART corpCode did not return a zip file. contentType=' + contentType + ', body=' + summarizeDartErrorBody_(text));
  }
  blob = blob.setContentType('application/zip');
  var blobs = Utilities.unzip(blob);
  if (!blobs || blobs.length === 0) {
    throw new Error('OpenDART corpCode zip did not contain files.');
  }
  var xmlText = blobs[0].getDataAsString('UTF-8');
  return xmlText;
}

function findDartCorpCodeByStockCodeInXml_(xmlText, stockCode) {
  var normalized = normalizeStockSymbol_(stockCode);
  var pattern = /<list>([\s\S]*?)<\/list>/g;
  var match;
  while ((match = pattern.exec(String(xmlText || ''))) !== null) {
    var block = match[1];
    if (normalizeStockSymbol_(extractXmlText_(block, 'stock_code')) === normalized) {
      return {
        corp_code: extractXmlText_(block, 'corp_code'),
        corp_name: extractXmlText_(block, 'corp_name'),
        stock_code: normalized
      };
    }
  }
  return null;
}

function extractXmlText_(xmlText, tagName) {
  var pattern = new RegExp('<' + tagName + '>([\\s\\S]*?)<\\/' + tagName + '>');
  var match = String(xmlText || '').match(pattern);
  return match ? String(match[1] || '').trim() : '';
}

function summarizeDartErrorBody_(text) {
  var body = String(text || '').replace(/\s+/g, ' ').trim();
  var statusMatch = body.match(/<status>(.*?)<\/status>/);
  var messageMatch = body.match(/<message>(.*?)<\/message>/);
  if (statusMatch || messageMatch) {
    return 'status=' + (statusMatch ? statusMatch[1] : '') + ', message=' + (messageMatch ? messageMatch[1] : '');
  }
  return body.substring(0, 500);
}

function parseDartCorpCodeXml_(xmlText) {
  var entries = [];
  var pattern = /<list>([\s\S]*?)<\/list>/g;
  var match;
  while ((match = pattern.exec(String(xmlText || ''))) !== null) {
    var block = match[1];
    entries.push({
      corp_code: extractXmlText_(block, 'corp_code'),
      corp_name: extractXmlText_(block, 'corp_name'),
      stock_code: normalizeStockSymbol_(extractXmlText_(block, 'stock_code')),
      modify_date: extractXmlText_(block, 'modify_date')
    });
  }
  return entries;
}

function getDartChildText_(element, childName) {
  var child = element.getChild(childName);
  return child ? String(child.getText() || '').trim() : '';
}

function formatDartDiagnosticMessage_(result) {
  var lines = [];
  lines.push('OpenDART 연결 진단');
  lines.push('');
  lines.push('DART_API_KEY: ' + (result.has_api_key ? '정상' : '없음'));
  lines.push('corpCode.xml: ' + diagnosticStatusText_(result.corp_code_zip));
  lines.push('삼성전자 005930 매칭: ' + diagnosticStatusText_(result.samsung_match));
  if (result.samsung_match && result.samsung_match.ok) {
    lines.push('');
    lines.push('DART 고유번호: ' + result.samsung_match.corp_code);
    lines.push('회사명: ' + result.samsung_match.corp_name);
  }
  lines.push('');
  lines.push('자세한 내용은 logs 시트를 확인하세요.');
  return lines.join('\n');
}
