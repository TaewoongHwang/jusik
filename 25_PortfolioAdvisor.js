function runAccountBalanceDiagnostics() {
  return withLogging_('account_diagnostics', function() {
    validateRealRuntimeConfig_();
    ensureAllSheets_();
    var result = {
      checked_at: amNowString_(),
      properties: diagnoseAccountProperties_(),
      balance: diagnoseStep_('account_balance', function() {
        var response = fetchKisDomesticAccountBalance_();
        var normalized = normalizeKisAccountBalance_(response);
        return {
          ok: true,
          holdings_count: normalized.holdings.length,
          total_eval_amount: normalized.snapshot.total_eval_amount,
          stock_eval_amount: normalized.snapshot.stock_eval_amount,
          cash_amount: normalized.snapshot.cash_amount
        };
      })
    };
    logInfo_('account_diagnostics', 'Account balance diagnostics completed', result);
    safeUiAlert_(formatAccountDiagnosticMessage_(result));
    return result;
  });
}

function collectHoldingsCurrent() {
  return withLogging_('portfolio_advisor', function() {
    validateRealRuntimeConfig_();
    ensureAllSheets_();
    var today = amTodayString_();
    var response = fetchKisDomesticAccountBalance_();
    var normalized = normalizeKisAccountBalance_(response);
    deleteRowsByDate_(AM_CONFIG.SHEETS.ACCOUNT_SNAPSHOT, today);
    deleteRowsByDate_(AM_CONFIG.SHEETS.HOLDINGS_CURRENT, today);
    appendObjectRow_(AM_CONFIG.SHEETS.ACCOUNT_SNAPSHOT, {
      date: today,
      cash_amount: normalized.snapshot.cash_amount,
      stock_eval_amount: normalized.snapshot.stock_eval_amount,
      total_eval_amount: normalized.snapshot.total_eval_amount,
      purchase_amount: normalized.snapshot.purchase_amount,
      profit_loss_amount: normalized.snapshot.profit_loss_amount,
      profit_loss_pct: normalized.snapshot.profit_loss_pct,
      raw_json: normalized.snapshot.raw,
      created_at: amNowString_()
    });
    appendObjectRows_(AM_CONFIG.SHEETS.HOLDINGS_CURRENT, normalized.holdings);
    var manualRows = appendManualHoldingsToCurrent_(today);
    rewriteHoldingWeightsForDate_(today);
    buildPortfolioRiskSnapshot_(today);
    logInfo_('portfolio_advisor', 'Holdings collected', {
      date: today,
      holdings_count: normalized.holdings.length,
      manual_holdings_count: manualRows.length
    });
    safeUiAlert_([
      '보유종목 수집 완료',
      '',
      'KIS 보유종목 수: ' + normalized.holdings.length,
      '수동 보유종목 수: ' + manualRows.length,
      '총 평가금액: ' + formatNumber_(normalized.snapshot.total_eval_amount),
      '주식 평가금액: ' + formatNumber_(normalized.snapshot.stock_eval_amount),
      '',
      '다음: 보유종목 어드바이스 생성을 실행하세요.'
    ].join('\n'));
    return normalized;
  });
}

function importManualHoldingsCurrent() {
  return withLogging_('portfolio_advisor', function() {
    ensureAllSheets_();
    var today = amTodayString_();
    deleteRowsByDate_(AM_CONFIG.SHEETS.HOLDINGS_CURRENT, today);
    var manualRows = appendManualHoldingsToCurrent_(today);
    rewriteHoldingWeightsForDate_(today);
    buildPortfolioRiskSnapshot_(today);
    safeUiAlert_([
      '수동 보유종목 가져오기 완료',
      '',
      '가져온 종목 수: ' + manualRows.length,
      '결과 시트: holdings_current',
      '',
      '다음: 보유종목 어드바이스 생성을 실행하세요.'
    ].join('\n'));
    return manualRows;
  });
}

function buildHoldingsAdvice() {
  return withLogging_('portfolio_advisor', function() {
    ensureAllSheets_();
    var today = amTodayString_();
    var holdings = getCurrentHoldingsForDate_(today);
    if (holdings.length === 0) {
      var manualRows = getActiveManualHoldingRows_();
      if (manualRows.length > 0) {
        appendManualHoldingsToCurrent_(today);
        rewriteHoldingWeightsForDate_(today);
        buildPortfolioRiskSnapshot_(today);
        holdings = getCurrentHoldingsForDate_(today);
      }
    }
    if (holdings.length === 0) {
      var message = buildNoHoldingsCurrentMessage_();
      safeUiAlert_(message);
      throw new Error(message);
    }
    var input = buildHoldingsAdviceInput_(today, holdings);
    var adviceRows = buildHoldingsAdviceWithGeminiOrFallback_(input);
    deleteRowsByDate_(AM_CONFIG.SHEETS.HOLDINGS_ADVICE, today);
    adviceRows.forEach(function(row) {
      appendObjectRow_(AM_CONFIG.SHEETS.HOLDINGS_ADVICE, {
        date: today,
        symbol: row.symbol,
        name: row.name,
        action_view: row.action_view,
        summary: row.summary,
        position_check: row.position_check,
        risk_comment: row.risk_comment,
        valid_condition: row.valid_condition,
        avoid_condition: row.avoid_condition,
        rebalance_up: row.rebalance_up || '',
        rebalance_down: row.rebalance_down || '',
        next_check: row.next_check,
        advice_json: row,
        created_at: amNowString_()
      });
    });
    logInfo_('portfolio_advisor', 'Holdings advice built', {
      date: today,
      holdings_count: adviceRows.length
    });
    safeUiAlert_([
      '보유종목 어드바이스 생성 완료',
      '',
      '종목 수: ' + adviceRows.length,
      '결과 시트: holdings_advice'
    ].join('\n'));
    return adviceRows;
  });
}

function getCurrentHoldingsForDate_(today) {
  return readObjects_(AM_CONFIG.SHEETS.HOLDINGS_CURRENT).filter(function(row) {
    return normalizeDateValue_(row.date) === today;
  });
}

function getActiveManualHoldingRows_() {
  return readObjects_(AM_CONFIG.SHEETS.MANUAL_HOLDINGS).filter(function(row) {
    return String(row.active || 'Y').toUpperCase() !== 'N' && normalizeStockSymbol_(row.symbol);
  });
}

function buildNoHoldingsCurrentMessage_() {
  var manualRows = getActiveManualHoldingRows_();
  if (manualRows.length === 0) {
    return [
      '오늘 보유종목 데이터가 없습니다.',
      '',
      'manual_holdings 시트에 보유 ETF/종목을 먼저 입력하세요.',
      '필수 입력값: symbol, name, quantity, avg_price',
      '',
      '입력 후 AI Scanner > 6. 내 계좌/보유종목 > 수동 보유종목 가져오기를 실행하세요.'
    ].join('\n');
  }
  var invalidRows = manualRows.filter(function(row) {
    return firstNumber_(row.quantity, row.qty) <= 0;
  });
  if (invalidRows.length > 0) {
    return [
      'manual_holdings에 종목은 있지만 수량(quantity)이 비어 있어 보유종목으로 가져오지 못했습니다.',
      '',
      '수량을 입력해야 합니다. 현재 수량이 비어 있는 행: ' + invalidRows.map(function(row) {
        return normalizeStockSymbol_(row.symbol) + ' ' + (row.name || '');
      }).join(', '),
      '',
      '필수 입력값: symbol, name, quantity, avg_price',
      'current_price는 비워도 되지만, KIS 현재가 조회가 실패하는 ETF는 직접 입력하는 것이 좋습니다.'
    ].join('\n');
  }
  return [
    '오늘 보유종목 데이터가 없습니다.',
    '',
    'manual_holdings 입력값을 확인한 뒤 수동 보유종목 가져오기를 다시 실행하세요.',
    '필수 입력값: symbol, name, quantity, avg_price'
  ].join('\n');
}

function fetchKisDomesticAccountBalance_() {
  var account = getKisAccountConfig_();
  return kisGet_('/uapi/domestic-stock/v1/trading/inquire-balance', {
    CANO: account.cano,
    ACNT_PRDT_CD: account.accountProductCode,
    AFHR_FLPR_YN: 'N',
    OFL_YN: '',
    INQR_DVSN: '02',
    UNPR_DVSN: '01',
    FUND_STTL_ICLD_YN: 'N',
    FNCG_AMT_AUTO_RDPT_YN: 'N',
    PRCS_DVSN: '01',
    CTX_AREA_FK100: '',
    CTX_AREA_NK100: ''
  }, 'TTTC8434R');
}

function normalizeKisAccountBalance_(response) {
  var today = amTodayString_();
  var holdingsRows = Array.isArray(response.output1) ? response.output1 : [];
  var summaryRows = Array.isArray(response.output2) ? response.output2 : (response.output2 ? [response.output2] : []);
  var summary = summaryRows[0] || {};
  var totalEval = firstNumber_(summary.tot_evlu_amt, summary.nass_amt, summary.total_eval_amount);
  var holdings = holdingsRows.map(function(row) {
    var symbol = normalizeStockSymbol_(firstNonEmpty_(row.pdno, row.prdt_code, row.symbol));
    var quantity = firstNumber_(row.hldg_qty, row.quantity);
    var evalAmount = firstNumber_(row.evlu_amt, row.eval_amount);
    return {
      date: today,
      symbol: symbol,
      name: firstNonEmpty_(row.prdt_name, row.item_name, row.name),
      quantity: quantity,
      avg_price: firstNumber_(row.pchs_avg_pric, row.avg_price),
      current_price: firstNumber_(row.prpr, row.current_price),
      purchase_amount: firstNumber_(row.pchs_amt, row.purchase_amount),
      eval_amount: evalAmount,
      profit_loss_amount: firstNumber_(row.evlu_pfls_amt, row.profit_loss_amount),
      profit_loss_pct: firstNumber_(row.evlu_pfls_rt, row.evlu_erng_rt, row.profit_loss_pct),
      portfolio_weight_pct: totalEval > 0 ? roundNumber_(evalAmount / totalEval * 100, 2) : 0,
      source: 'kis_inquire_balance',
      raw_json: row
    };
  }).filter(function(row) {
    return row.symbol && row.quantity > 0;
  });
  return {
    snapshot: {
      cash_amount: firstNumber_(summary.dnca_tot_amt, summary.cash_amount),
      stock_eval_amount: firstNumber_(summary.scts_evlu_amt, summary.stock_eval_amount),
      total_eval_amount: totalEval,
      purchase_amount: firstNumber_(summary.pchs_amt_smtl_amt, summary.purchase_amount),
      profit_loss_amount: firstNumber_(summary.evlu_pfls_smtl_amt, summary.profit_loss_amount),
      profit_loss_pct: firstNumber_(summary.asst_icdc_erng_rt, summary.profit_loss_pct),
      raw: summary
    },
    holdings: holdings
  };
}

function appendManualHoldingsToCurrent_(today) {
  var manualRows = getActiveManualHoldingRows_();
  var normalized = manualRows.map(function(row) {
    return normalizeManualHoldingRow_(today, row);
  }).filter(function(row) {
    return row.symbol && row.quantity > 0;
  });
  appendObjectRows_(AM_CONFIG.SHEETS.HOLDINGS_CURRENT, normalized);
  return normalized;
}

function normalizeManualHoldingRow_(today, row) {
  var symbol = String(row.symbol || '').trim().toUpperCase();
  var quantity = firstNumber_(row.quantity, row.qty);
  var avgPrice = firstNumber_(row.avg_price, row.average_price);
  var currentPrice = firstNumber_(row.current_price, row.close);
  
  var isCoin = (String(row.broker || '').toLowerCase() === 'upbit' || symbol.indexOf('KRW-') === 0 || ['BTC', 'ETH', 'SOL', 'XRP', 'ADA', 'DOGE'].indexOf(symbol) >= 0);
  var isOverseas = !isCoin && /^[A-Za-z]/.test(symbol);
  
  if (currentPrice <= 0 && symbol) {
    try {
      if (isCoin) {
        currentPrice = fetchUpbitCurrentPrice_(symbol).close;
      } else if (isOverseas) {
        currentPrice = fetchKisOverseasCurrentPrice_(symbol).close;
      } else {
        currentPrice = fetchKisCurrentPrice_(symbol).close;
      }
      Utilities.sleep(120);
    } catch (err) {
      logWarn_('portfolio_advisor', 'Manual holding current price lookup failed', {
        symbol: symbol,
        error: err.message || String(err)
      });
    }
  }
  var purchaseAmount = firstNumber_(row.purchase_amount);
  if (purchaseAmount <= 0) purchaseAmount = quantity * avgPrice;
  var evalAmount = firstNumber_(row.eval_amount);
  if (evalAmount <= 0) evalAmount = quantity * currentPrice;
  var profitLoss = firstNumber_(row.profit_loss_amount);
  if (!profitLoss && purchaseAmount > 0) profitLoss = evalAmount - purchaseAmount;
  var profitLossPct = firstNumber_(row.profit_loss_pct);
  if (!profitLossPct && purchaseAmount > 0) profitLossPct = profitLoss / purchaseAmount * 100;
  
  return {
    date: today,
    symbol: symbol,
    name: row.name || symbol,
    quantity: quantity,
    avg_price: avgPrice,
    current_price: currentPrice,
    purchase_amount: purchaseAmount,
    eval_amount: evalAmount,
    profit_loss_amount: profitLoss,
    profit_loss_pct: roundNumber_(profitLossPct, 2),
    portfolio_weight_pct: 0,
    source: 'manual_' + String(row.broker || 'external').trim(),
    currency: isCoin ? 'KRW' : (isOverseas ? 'USD' : 'KRW'),
    raw_json: row
  };
}

function rewriteHoldingWeightsForDate_(today) {
  var sheet = ensureSheet_(AM_CONFIG.SHEETS.HOLDINGS_CURRENT, AM_SHEET_SCHEMAS[AM_CONFIG.SHEETS.HOLDINGS_CURRENT]);
  var values = sheet.getDataRange().getValues();
  if (values.length <= 1) return;
  var headers = values[0];
  var dateIndex = headers.indexOf('date');
  var evalIndex = headers.indexOf('eval_amount');
  var weightIndex = headers.indexOf('portfolio_weight_pct');
  if (dateIndex < 0 || evalIndex < 0 || weightIndex < 0) return;
  var target = normalizeDateValue_(today);
  var total = 0;
  for (var i = 1; i < values.length; i += 1) {
    if (normalizeDateValue_(values[i][dateIndex]) === target) total += Number(values[i][evalIndex] || 0);
  }
  if (total <= 0) return;
  for (var rowIndex = 1; rowIndex < values.length; rowIndex += 1) {
    if (normalizeDateValue_(values[rowIndex][dateIndex]) === target) {
      sheet.getRange(rowIndex + 1, weightIndex + 1).setValue(roundNumber_(Number(values[rowIndex][evalIndex] || 0) / total * 100, 2));
    }
  }
}

function buildHoldingsAdviceInput_(today, holdings) {
  var leaderMap = rowsBySymbolForDate_(AM_CONFIG.SHEETS.LEADER_50, today);
  var planMap = rowsBySymbolForDate_(AM_CONFIG.SHEETS.ENTRY_PLAN, today);
  var indicatorMap = rowsBySymbolForDate_(AM_CONFIG.SHEETS.INDICATORS_DAILY, today);
  var financialMap = rowsBySymbolForDate_(AM_CONFIG.SHEETS.FINANCIAL_RATIOS, today);
  var flowMap = rowsBySymbolForDate_(AM_CONFIG.SHEETS.INVESTOR_FLOW_SCORE, today);
  var etfMap = rowsBySymbolForDate_(AM_CONFIG.SHEETS.ETF_STOCK_SCORE, today);
  var macro = getLatestMacroSnapshot_();
  var risks = readObjects_(AM_CONFIG.SHEETS.RISK_ALERTS).filter(function(row) {
    return normalizeDateValue_(row.date) === today;
  });
  var totalInvestment = getStrategyNumber_('total_investment', 50000000);
  return {
    date: today,
    total_investment: totalInvestment,
    macro: macro,
    portfolio_risks: readObjects_(AM_CONFIG.SHEETS.PORTFOLIO_RISK).filter(function(row) {
      return normalizeDateValue_(row.date) === today;
    }),
    holdings: holdings.map(function(row) {
      var symbol = normalizeStockSymbol_(row.symbol);
      return {
        symbol: symbol,
        name: row.name,
        quantity: Number(row.quantity || 0),
        avg_price: Number(row.avg_price || 0),
        current_price: Number(row.current_price || 0),
        eval_amount: Number(row.eval_amount || 0),
        profit_loss_amount: Number(row.profit_loss_amount || 0),
        profit_loss_pct: Number(row.profit_loss_pct || 0),
        portfolio_weight_pct: Number(row.portfolio_weight_pct || 0),
        leader: leaderMap[symbol] || null,
        entry_plan: planMap[symbol] || null,
        chart: indicatorMap[symbol] || null,
        financial: financialMap[symbol] || null,
        flow: flowMap[symbol] || null,
        etf: etfMap[symbol] || null,
        risk_alerts: risks.filter(function(risk) {
          return normalizeStockSymbol_(risk.symbol) === symbol;
        })
      };
    })
  };
}

function buildHoldingsAdviceWithGeminiOrFallback_(input) {
  try {
    if (!getScriptProperty_(AM_CONFIG.PROPERTY_KEYS.GEMINI_API_KEY, '')) {
      throw new Error('Gemini API key is not configured.');
    }
    var result = callGeminiJson_(buildHoldingsAdvicePrompt_(input), {
      maxOutputTokens: 4096,
      temperature: 0.2,
      modelUseCase: 'daily_stock_top'
    });
    if (!result || !Array.isArray(result.holdings)) {
      throw new Error('Gemini holdings advice missing holdings array.');
    }
    return result.holdings.map(normalizeHoldingAdviceOutput_);
  } catch (err) {
    logWarn_('portfolio_advisor', 'Falling back to rule-based holdings advice', { error: err.message || String(err) });
    return input.holdings.map(buildRuleBasedHoldingAdvice_);
  }
}

function buildHoldingsAdvicePrompt_(input) {
  var promptBase = getPromptTemplate_('holdings_prompt_base', '');
  return [
    promptBase,
    'You are a Korean equity portfolio advisor.',
    'This is not an auto-trading system. Do not recommend direct buy/sell orders.',
    'Explain only using the provided account holding, scanner, chart, ETF, flow, financial, risk, macro data and strategy settings.',
    'Formulate exact rebalancing advice for UP and DOWN price scenarios. Budget setting is total_investment.',
    'Use conditional wording such as maintain watch, reduce-risk review, avoid adding, invalidation check, rebalance review.',
    'Do not guarantee profit or predict certainty.',
    'Return valid JSON only. Write all human-readable strings in Korean.',
    'Required JSON shape:',
    JSON.stringify({
      holdings: [
        {
          symbol: '000000',
          name: 'stock name',
          action_view: 'hold_watch|risk_reduce_review|avoid_add|needs_review',
          summary: 'one sentence',
          position_check: 'portfolio weight, profit/loss, and budget usage interpretation',
          risk_comment: 'main risk',
          valid_condition: 'condition where holding thesis remains valid',
          avoid_condition: 'condition where adding or holding becomes risky',
          rebalance_up: 'rebalancing action plan when price goes up (e.g. target, breakout entry, partial profit sell rules)',
          rebalance_down: 'rebalancing action plan when price goes down (e.g. support, invalidation level stop loss, no-buy rules)',
          next_check: 'what to check next session'
        }
      ]
    }),
    'Input data:',
    JSON.stringify(input)
  ].join('\n');
}

function normalizeHoldingAdviceOutput_(row) {
  return {
    symbol: normalizeStockSymbol_(row.symbol),
    name: row.name || '',
    action_view: row.action_view || 'needs_review',
    summary: row.summary || '',
    position_check: row.position_check || '',
    risk_comment: row.risk_comment || '',
    valid_condition: row.valid_condition || '',
    avoid_condition: row.avoid_condition || '',
    rebalance_up: row.rebalance_up || '',
    rebalance_down: row.rebalance_down || '',
    next_check: row.next_check || ''
  };
}

function buildRuleBasedHoldingAdvice_(holding) {
  var leader = holding.leader || {};
  var plan = holding.entry_plan || {};
  var riskAlerts = holding.risk_alerts || [];
  var action = 'hold_watch';
  if (!leader.symbol) action = 'needs_review';
  if (riskAlerts.some(function(risk) { return String(risk.risk_level || '').toLowerCase() === 'high'; })) action = 'risk_reduce_review';
  if (Number(holding.portfolio_weight_pct || 0) >= 15) action = 'risk_reduce_review';
  var invalid = Number(plan.invalid_price || 0);
  if (invalid > 0 && Number(holding.current_price || 0) < invalid) action = 'risk_reduce_review';
  
  var rebalanceUp = '';
  if (plan.breakout_price) {
    rebalanceUp = '상승 시 돌파 가격 ' + formatNumber_(plan.breakout_price) + ' 돌파 후 안착 시에만 추가 진입을 검토하며, 목표 수익률 도달 시 분할 매도를 통해 비중을 축소합니다.';
  } else {
    rebalanceUp = '상승 시 추격 매수를 금지하고, 목표 수익률 도달 시 분할 매도를 진행하여 익절 및 비중 관리를 실행합니다.';
  }
  
  var rebalanceDown = '';
  if (plan.invalid_price) {
    rebalanceDown = '하락 시 무효화 가격 ' + formatNumber_(plan.invalid_price) + ' 이탈 시 즉시 리스크 관리(손절 또는 비중 대폭 축소)를 검토하며, 물타기 목적의 추가 매수는 절대 금지합니다.';
  } else if (plan.first_entry_price) {
    rebalanceDown = '하락 시 1차 검토가 ' + formatNumber_(plan.first_entry_price) + ' 부근에서의 지지 반응을 확인하고, 무조건적인 추가 매수보다 추세 유지 여부를 먼저 검증합니다.';
  } else {
    rebalanceDown = '하락 시 지지선 이탈 여부를 상시 점검하고, 리스크 관리를 최우선으로 하여 신규 추가 매수는 전면 보류합니다.';
  }

  return {
    symbol: holding.symbol,
    name: holding.name,
    action_view: action,
    summary: buildHoldingSummary_(holding, leader, plan),
    position_check: '현재 비중 ' + formatNumber_(holding.portfolio_weight_pct) + '%, 평가손익률 ' + formatNumber_(holding.profit_loss_pct) + '%입니다.',
    risk_comment: riskAlerts.length ? riskAlerts[0].message : '특이 위험 공시는 없지만 시장 변동성과 종목 비중을 함께 확인해야 합니다.',
    valid_condition: invalid > 0 ? '현재가가 무효화 가격 ' + formatNumber_(invalid) + ' 위에서 유지되면 보유 관찰 논리는 유지됩니다.' : '리더 점수, 차트 추세, 수급 악화 여부를 확인해야 합니다.',
    avoid_condition: '급등 구간 추가 매수, 과도한 단일 종목 비중 확대, 무효화 가격 이탈 후 방치는 피해야 합니다.',
    rebalance_up: rebalanceUp,
    rebalance_down: rebalanceDown,
    next_check: '다음 거래일에는 무효화 가격, 20일선, 거래대금 유지, 섹터 동반 강세 여부를 먼저 확인하세요.'
  };
}

function buildHoldingSummary_(holding, leader, plan) {
  if (!leader.symbol) {
    return holding.name + '은 오늘 주도주 50에 포함되지 않아 보유 사유를 별도로 재점검할 필요가 있습니다.';
  }
  var text = holding.name + '은 오늘 주도주 순위 ' + leader.rank + '위, 총점 ' + leader.total_score + '점입니다.';
  if (plan.invalid_price) {
    text += ' 무효화 가격 ' + formatNumber_(plan.invalid_price) + '을 기준으로 보유 관찰이 가능합니다.';
  }
  return text;
}

function buildPortfolioRiskSnapshot_(today) {
  deleteRowsByDate_(AM_CONFIG.SHEETS.PORTFOLIO_RISK, today);
  var holdings = readObjects_(AM_CONFIG.SHEETS.HOLDINGS_CURRENT).filter(function(row) {
    return normalizeDateValue_(row.date) === today;
  });
  var totalWeight = holdings.reduce(function(sum, row) {
    return sum + Number(row.portfolio_weight_pct || 0);
  }, 0);
  holdings.forEach(function(row) {
    if (Number(row.portfolio_weight_pct || 0) >= 15) {
      appendObjectRow_(AM_CONFIG.SHEETS.PORTFOLIO_RISK, {
        date: today,
        risk_type: 'position_concentration',
        risk_level: 'medium',
        message: row.name + ' 비중이 ' + formatNumber_(row.portfolio_weight_pct) + '%로 높습니다. 추가 진입보다 리스크 관리 관점이 우선입니다.',
        details_json: row,
        created_at: amNowString_()
      });
    }
  });
  if (totalWeight >= 95) {
    appendObjectRow_(AM_CONFIG.SHEETS.PORTFOLIO_RISK, {
      date: today,
      risk_type: 'cash_buffer',
      risk_level: 'medium',
      message: '주식 평가 비중이 높아 현금 완충 여력이 낮을 수 있습니다.',
      details_json: { total_stock_weight_pct: totalWeight },
      created_at: amNowString_()
    });
  }
}

function diagnoseAccountProperties_() {
  return {
    KIS_CANO: maskAccountNumber_(getScriptProperty_(AM_CONFIG.PROPERTY_KEYS.KIS_CANO, '')),
    KIS_ACNT_PRDT_CD: getScriptProperty_(AM_CONFIG.PROPERTY_KEYS.KIS_ACNT_PRDT_CD, '')
  };
}

function formatAccountDiagnosticMessage_(result) {
  var lines = [];
  lines.push('KIS 계좌 조회 진단 결과');
  lines.push('');
  lines.push('KIS_CANO: ' + (result.properties.KIS_CANO || '(missing)'));
  lines.push('KIS_ACNT_PRDT_CD: ' + (result.properties.KIS_ACNT_PRDT_CD || '(missing)'));
  lines.push('');
  lines.push('잔고 조회: ' + diagnosticStatusText_(result.balance));
  if (result.balance && result.balance.ok) {
    lines.push('보유종목 수: ' + result.balance.holdings_count);
    lines.push('총 평가금액: ' + formatNumber_(result.balance.total_eval_amount));
  }
  lines.push('');
  lines.push('자세한 오류는 logs 시트의 account_diagnostics 행을 확인하세요.');
  return lines.join('\n');
}

function maskAccountNumber_(value) {
  var text = String(value || '').trim();
  if (text.length <= 4) return text ? '****' : '';
  return text.slice(0, 2) + '****' + text.slice(-2);
}

function fetchKisOverseasAccountBalance_() {
  // KIS API는 OVRS_EXCG_CD에 와일드카드(%)를 지원하지 않으므로
  // 주요 미국 거래소를 개별 조회 후 병합한다.
  var exchanges = ['NASD', 'NYSE'];
  var account = getKisAccountConfig_();
  var isReal = getScriptProperty_(AM_CONFIG.PROPERTY_KEYS.KIS_ENV, '') === 'real';
  var trId = isReal ? 'TTTS3012R' : 'VCTS3012R';
  
  var allOutput1 = [];
  var latestOutput2 = null;
  
  for (var i = 0; i < exchanges.length; i++) {
    try {
      var response = kisGet_('/uapi/overseas-stock/v1/trading/inquire-balance', {
        CANO: account.cano,
        ACNT_PRDT_CD: account.accountProductCode,
        OVRS_EXCG_CD: exchanges[i],
        TR_CRCY_CD: 'USD',
        CTX_AREA_FK200: '',
        CTX_AREA_NK200: ''
      }, trId);
      
      var items = Array.isArray(response.output1) ? response.output1 : [];
      if (items.length > 0) {
        allOutput1 = allOutput1.concat(items);
      }
      if (!latestOutput2 && response.output2) {
        latestOutput2 = response.output2;
      }
    } catch (err) {
      logWarn_('overseas_balance', 'Failed to fetch overseas balance for exchange ' + exchanges[i], { error: err.message });
    }
  }
  
  // 미니스탁(소수점) 잔고도 별도 수집 시도
  try {
    var miniStockHoldings = fetchKisMiniStockBalance_();
    if (miniStockHoldings.length > 0) {
      allOutput1 = allOutput1.concat(miniStockHoldings);
    }
  } catch (miniErr) {
    logWarn_('overseas_balance', 'MiniStock fractional balance fetch skipped or failed', { error: miniErr.message });
  }
  
  return {
    output1: allOutput1,
    output2: latestOutput2 ? (Array.isArray(latestOutput2) ? latestOutput2 : [latestOutput2]) : []
  };
}

function fetchKisMiniStockBalance_() {
  // 미니스탁(소수점 해외주식) 전용 잔고 조회
  var account = getKisAccountConfig_();
  var isReal = getScriptProperty_(AM_CONFIG.PROPERTY_KEYS.KIS_ENV, '') === 'real';
  var trId = isReal ? 'TTTS3012R' : 'VCTS3012R';
  
  // 미니스탁은 NASD 거래소에서 소수점 수량으로 거래됨
  // 일반 잔고 조회에서 소수점 수량이 잡히지 않을 경우를 대비한 추가 시도
  var exchanges = ['NASD', 'NYSE'];
  var miniItems = [];
  
  for (var i = 0; i < exchanges.length; i++) {
    try {
      var response = kisGet_('/uapi/overseas-stock/v1/trading/inquire-balance', {
        CANO: account.cano,
        ACNT_PRDT_CD: '01',  // 미니스탁은 상품코드 01
        OVRS_EXCG_CD: exchanges[i],
        TR_CRCY_CD: 'USD',
        CTX_AREA_FK200: '',
        CTX_AREA_NK200: ''
      }, trId);
      
      var items = Array.isArray(response.output1) ? response.output1 : [];
      if (items.length > 0) {
        miniItems = miniItems.concat(items);
      }
    } catch (err) {
      // 미니스탁 조회 실패 시 무시 - 일반 조회에서 이미 잡혔을 수 있음
    }
  }
  
  return miniItems;
}

function normalizeKisOverseasAccountBalance_(response) {
  var today = amTodayString_();
  var holdingsRows = Array.isArray(response.output1) ? response.output1 : [];
  var summaryRows = Array.isArray(response.output2) ? response.output2 : (response.output2 ? [response.output2] : []);
  var summary = summaryRows[0] || {};
  
  var totalEval = firstNumber_(summary.tot_evlu_amt, summary.tot_evlu_amt_smtl, 0);
  
  // 중복 종목 제거 (같은 symbol이 일반/미니스탁에서 중복 조회될 수 있음)
  var seenSymbols = {};
  var holdings = holdingsRows.map(function(row) {
    var symbol = String(firstNonEmpty_(row.ovrs_pdno, row.symbol, '')).trim();
    var quantity = Number(row.ovrs_cblc_qty || row.hldg_qty || row.quantity || 0);
    // 소수점 수량 체크 (미니스탁의 경우 ord_psbl_qty에 소수점이 올 수 있음)
    if (quantity === 0) {
      quantity = parseFloat(row.ord_psbl_qty || row.pchs_rmnd_qty || 0);
    }
    var evalAmountKrw = Number(row.evlu_amt_smtl || row.evlu_amt_smtl_amt || 0);
    var profitLossPct = Number(row.evlu_pfls_rt1 || row.evlu_pfls_rt || row.profit_loss_pct || 0);
    
    return {
      date: today,
      symbol: symbol,
      name: firstNonEmpty_(row.ovrs_item_name, row.item_name, row.name, symbol),
      quantity: quantity,
      avg_price: Number(row.pchs_avg_pric || row.avg_price || 0),
      current_price: Number(row.now_pric2 || row.now_pric || row.current_price || 0),
      purchase_amount: Number(row.frcr_pchs_amt1 || row.pchs_amt || 0),
      eval_amount: Number(row.frcr_evlu_amt2 || row.eval_amount || 0),
      eval_amount_krw: evalAmountKrw,
      profit_loss_amount: Number(row.evlu_pfls_amt2 || 0),
      profit_loss_pct: profitLossPct,
      portfolio_weight_pct: totalEval > 0 ? roundNumber_(evalAmountKrw / totalEval * 100, 2) : 0,
      source: 'kis_overseas_balance',
      currency: 'USD',
      raw_json: row
    };
  }).filter(function(row) {
    if (!row.symbol || row.quantity <= 0) return false;
    // 중복 제거
    if (seenSymbols[row.symbol]) return false;
    seenSymbols[row.symbol] = true;
    return true;
  });
  
  return {
    snapshot: {
      cash_amount: firstNumber_(summary.frcr_dnca_amt, 0),
      stock_eval_amount: firstNumber_(summary.frcr_tot_evlu_amt, 0),
      total_eval_amount_krw: totalEval,
      purchase_amount_krw: firstNumber_(summary.tot_pchs_amt, 0),
      profit_loss_amount_krw: firstNumber_(summary.evlu_pfls_amt_smtl, 0),
      profit_loss_pct: firstNumber_(summary.evlu_pfls_rt, 0),
      raw: summary
    },
    holdings: holdings
  };
}

function getLatestUsdKrwRate_() {
  try {
    var rows = readObjects_(AM_CONFIG.SHEETS.MACRO_RAW);
    if (rows.length > 0) {
      rows.sort(function(a, b) {
        return String(b.date).localeCompare(String(a.date));
      });
      for (var i = 0; i < rows.length; i++) {
        var name = String(rows[i].name || '');
        if (name.indexOf('환율') >= 0 || name.indexOf('USD') >= 0 || name.indexOf('원달러') >= 0) {
          var val = parseFloat(rows[i].value);
          if (val > 1000 && val < 2000) return val;
        }
      }
    }
  } catch (e) {
    logWarn_('portfolio_advisor', 'Failed to read USD/KRW rate from macro_raw', { error: e.message });
  }
  return 1380; // 합리적인 기본 환율
}


