function collectInvestorFlowDaily() {
  return withLogging_('investor_flow', function() {
    validateRealRuntimeConfig_();
    ensureAllSheets_();
    if (!isInvestorFlowCollectionWindowOpen_()) {
      var message = buildInvestorFlowTimeWindowMessage_();
      logWarn_('investor_flow', 'Skipped investor flow collection before KIS time window', {
        current_time: amNowString_(),
        message: message
      });
      safeUiAlert_(message);
      return [];
    }
    var today = amTodayString_();
    var marketRows = readObjects_(AM_CONFIG.SHEETS.MARKET_DAILY).filter(function(row) {
      return normalizeDateValue_(row.date) === today;
    });
    if (marketRows.length === 0) {
      throw new Error('오늘 날짜의 market_daily 데이터가 없습니다. 핵심 파이프라인을 먼저 완료하세요.');
    }
    deleteRowsByDate_(AM_CONFIG.SHEETS.INVESTOR_FLOW_DAILY, today);
    var collected = [];
    marketRows.forEach(function(row) {
      var symbol = normalizeStockSymbol_(row.symbol);
      try {
        var response = fetchKisInvestorTradeByStockDaily_(symbol);
        var flow = normalizeKisInvestorFlow_(today, symbol, response);
        collected.push(flow);
        Utilities.sleep(120);
      } catch (err) {
        logWarn_('investor_flow', 'Skipped investor flow because KIS request failed', {
          symbol: symbol,
          name: row.name || '',
          error: err.message || String(err)
        });
      }
    });
    appendObjectRows_(AM_CONFIG.SHEETS.INVESTOR_FLOW_DAILY, collected);
    logInfo_('investor_flow', 'Collected investor flow rows', { date: today, count: collected.length });
    return collected;
  });
}

function calculateInvestorFlowScores() {
  return withLogging_('investor_flow', function() {
    var today = amTodayString_();
    var flowRows = readObjects_(AM_CONFIG.SHEETS.INVESTOR_FLOW_DAILY).filter(function(row) {
      return normalizeDateValue_(row.date) === today;
    });
    var marketMap = rowsBySymbolForDate_(AM_CONFIG.SHEETS.MARKET_DAILY, today);
    deleteRowsByDate_(AM_CONFIG.SHEETS.INVESTOR_FLOW_SCORE, today);
    if (flowRows.length === 0) {
      logWarn_('investor_flow', 'No investor_flow_daily rows. Flow score will be 0.', { date: today });
      return [];
    }
    var scored = flowRows.map(function(row) {
      var symbol = normalizeStockSymbol_(row.symbol);
      var market = marketMap[symbol] || {};
      var tradingValue = Math.max(1, Number(market.trading_value || 0));
      var foreignValue = Number(row.foreign_net_buy_value || 0);
      var institutionValue = Number(row.institution_net_buy_value || 0);
      var individualValue = Number(row.individual_net_buy_value || 0);
      var foreignIntensity = foreignValue / tradingValue * 100;
      var institutionIntensity = institutionValue / tradingValue * 100;
      var foreignScore = scoreNetBuyIntensity_(foreignIntensity);
      var institutionScore = scoreNetBuyIntensity_(institutionIntensity);
      var combined = Math.max(0, Math.min(10, foreignScore + institutionScore + scoreFlowConfirmation_(foreignValue, institutionValue, individualValue)));
      var comment = buildFlowComment_(foreignValue, institutionValue, individualValue, combined);
      var output = {
        date: today,
        symbol: symbol,
        foreign_score: roundNumber_(foreignScore, 2),
        institution_score: roundNumber_(institutionScore, 2),
        combined_flow_score: roundNumber_(combined, 2),
        flow_comment: comment
      };
      appendObjectRow_(AM_CONFIG.SHEETS.INVESTOR_FLOW_SCORE, output);
      return output;
    });
    logInfo_('investor_flow', 'Calculated investor flow scores', { date: today, count: scored.length });
    return scored;
  });
}

function fetchKisInvestorTradeByStockDaily_(symbol) {
  var inputDate = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd');
  // KIS domestic stock investor daily trade endpoint. Verified against Korea Investment open-trading-api sample.
  return kisGet_('/uapi/domestic-stock/v1/quotations/investor-trade-by-stock-daily', {
    FID_COND_MRKT_DIV_CODE: 'J',
    FID_INPUT_ISCD: normalizeStockSymbol_(symbol),
    FID_INPUT_DATE_1: inputDate,
    FID_ORG_ADJ_PRC: '',
    FID_ETC_CLS_CODE: ''
  }, 'FHPTJ04160001');
}

function runInvestorFlowDiagnostics() {
  return withLogging_('investor_flow_diagnostics', function() {
    validateRealRuntimeConfig_();
    ensureAllSheets_();
    var sampleSymbol = '005930';
    if (!isInvestorFlowCollectionWindowOpen_()) {
      var timeResult = {
        checked_at: amNowString_(),
        symbol: sampleSymbol,
        investor_flow: {
          ok: false,
          step: 'time_window',
          error: 'KIS investor flow API is available after 15:40 KST.'
        }
      };
      logWarn_('investor_flow_diagnostics', 'Investor flow diagnostics skipped before KIS time window', timeResult);
      safeUiAlert_(formatInvestorFlowDiagnosticMessage_(timeResult));
      return timeResult;
    }
    var result = {
      checked_at: amNowString_(),
      symbol: sampleSymbol,
      investor_flow: diagnoseStep_('investor_flow', function() {
        var response = fetchKisInvestorTradeByStockDaily_(sampleSymbol);
        var rows = extractKisInvestorOutputRows_(response);
        var flow = normalizeKisInvestorFlow_(amTodayString_(), sampleSymbol, response);
        return {
          ok: rows.length > 0,
          rows: rows.length,
          foreign_net_buy_value: flow.foreign_net_buy_value,
          institution_net_buy_value: flow.institution_net_buy_value,
          individual_net_buy_value: flow.individual_net_buy_value,
          raw_keys: rows.length ? Object.keys(rows[0]).slice(0, 12).join(', ') : ''
        };
      })
    };
    logInfo_('investor_flow_diagnostics', 'Investor flow diagnostics completed', result);
    safeUiAlert_(formatInvestorFlowDiagnosticMessage_(result));
    return result;
  });
}

function formatInvestorFlowDiagnosticMessage_(result) {
  var lines = [];
  lines.push('투자자 수급 연결 진단 결과');
  lines.push('');
  lines.push('종목: 삼성전자 ' + result.symbol);
  lines.push('수급 조회: ' + diagnosticStatusText_(result.investor_flow));
  if (result.investor_flow && isInvestorFlowTimeLimitError_(result.investor_flow.error)) {
    lines.push('');
    lines.push('해석: KIS가 종목별 투자자 수급 API를 15:40 이전에는 제한하고 있습니다.');
    lines.push('다음: 장마감 후 15:40 이후에 다시 실행하세요.');
  }
  if (result.investor_flow && result.investor_flow.ok) {
    lines.push('응답 행 수: ' + result.investor_flow.rows);
    lines.push('외국인 순매수 금액: ' + formatNumber_(result.investor_flow.foreign_net_buy_value));
    lines.push('기관 순매수 금액: ' + formatNumber_(result.investor_flow.institution_net_buy_value));
    lines.push('개인 순매수 금액: ' + formatNumber_(result.investor_flow.individual_net_buy_value));
  }
  lines.push('');
  lines.push('자세한 오류는 logs 시트의 investor_flow_diagnostics 행을 확인하세요.');
  return lines.join('\n');
}

function isInvestorFlowCollectionWindowOpen_() {
  var hhmm = Number(Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'HHmm'));
  return hhmm >= 1540;
}

function buildInvestorFlowTimeWindowMessage_() {
  return [
    '투자자 수급 수집 안내',
    '',
    'KIS 종목별 투자자 수급 API는 장마감 후 15:40 이후에 조회 가능합니다.',
    '현재는 수급 수집을 건너뜁니다.',
    '',
    '다음: 15:40 이후에 투자자 수급 연결 진단 또는 투자자 수급 수집을 다시 실행하세요.'
  ].join('\n');
}

function isInvestorFlowTimeLimitError_(errorText) {
  var text = String(errorText || '');
  return text.indexOf('OPSQ2001') >= 0 || text.indexOf('TIME LIMIT') >= 0 || text.indexOf('15:40') >= 0;
}

function normalizeKisInvestorFlow_(today, symbol, response) {
  var rows = extractKisInvestorOutputRows_(response);
  if (rows.length === 0) {
    throw new Error('KIS investor flow response has no output rows for ' + symbol + ': ' + JSON.stringify(response).slice(0, 1200));
  }
  var row = pickLatestInvestorFlowRow_(rows);
  return {
    date: today,
    symbol: normalizeStockSymbol_(symbol),
    foreign_net_buy_qty: firstNumber_(row.frgn_ntby_qty, row.frgn_ntby_qty_icdc, row.foreign_net_buy_qty),
    foreign_net_buy_value: firstNumber_(row.frgn_ntby_tr_pbmn, row.frgn_ntby_tr_pbmn_icdc, row.frgn_ntby_amt, row.foreign_net_buy_value),
    institution_net_buy_qty: firstNumber_(row.orgn_ntby_qty, row.inst_ntby_qty, row.institution_net_buy_qty),
    institution_net_buy_value: firstNumber_(row.orgn_ntby_tr_pbmn, row.inst_ntby_tr_pbmn, row.orgn_ntby_amt, row.institution_net_buy_value),
    individual_net_buy_qty: firstNumber_(row.prsn_ntby_qty, row.indv_ntby_qty, row.individual_net_buy_qty),
    individual_net_buy_value: firstNumber_(row.prsn_ntby_tr_pbmn, row.indv_ntby_tr_pbmn, row.prsn_ntby_amt, row.individual_net_buy_value),
    source: 'kis_investor_trade_by_stock_daily',
    raw_json: row
  };
}

function extractKisInvestorOutputRows_(response) {
  if (!response) return [];
  var rows = [];
  var candidates = [response.output, response.output1, response.output2, response.output3];
  for (var i = 0; i < candidates.length; i += 1) {
    if (Array.isArray(candidates[i]) && candidates[i].length > 0) {
      rows = rows.concat(candidates[i]);
    } else if (candidates[i] && typeof candidates[i] === 'object') {
      rows.push(candidates[i]);
    }
  }
  if (rows.length > 0) return rows;
  if (Array.isArray(response)) return response;
  return [];
}

function pickLatestInvestorFlowRow_(rows) {
  return rows.slice().sort(function(a, b) {
    return String(firstNonEmpty_(b.stck_bsop_date, b.trad_dt, b.date)).localeCompare(String(firstNonEmpty_(a.stck_bsop_date, a.trad_dt, a.date)));
  })[0];
}

function scoreNetBuyIntensity_(intensityPct) {
  var value = Number(intensityPct || 0);
  if (value <= 0) return 0;
  if (value >= 8) return 4;
  if (value >= 4) return 3;
  if (value >= 2) return 2;
  return 1;
}

function scoreFlowConfirmation_(foreignValue, institutionValue, individualValue) {
  if (foreignValue > 0 && institutionValue > 0) return 2;
  if ((foreignValue > 0 || institutionValue > 0) && individualValue < 0) return 1;
  if (foreignValue < 0 && institutionValue < 0) return -2;
  return 0;
}

function buildFlowComment_(foreignValue, institutionValue, individualValue, score) {
  if (foreignValue > 0 && institutionValue > 0) return '외국인과 기관 동반 순매수';
  if (foreignValue > 0 && institutionValue <= 0) return '외국인 순매수, 기관 확인 필요';
  if (institutionValue > 0 && foreignValue <= 0) return '기관 순매수, 외국인 확인 필요';
  if (foreignValue < 0 && institutionValue < 0) return '외국인과 기관 동반 순매도';
  if (individualValue > 0 && score <= 2) return '개인 중심 수급, 추격 주의';
  return '수급 중립';
}
