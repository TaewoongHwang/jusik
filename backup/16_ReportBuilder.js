var AM_PIPELINE_PROP_PREFIX = 'AM_DAILY_PIPELINE_';
var AM_FULL_WORKFLOW_PROP_PREFIX = 'AM_FULL_WORKFLOW_';
var AM_PIPELINE_MAX_RUNTIME_MS = 4.5 * 60 * 1000;
var AM_PIPELINE_CURRENT_PRICE_BATCH = 12;
var AM_PIPELINE_DAILY_PRICE_BATCH = 8;
var AM_PIPELINE_FINALIZE_BATCH = 1;
var AM_PIPELINE_FINALIZE_ETF_BATCH = 2;
var AM_PIPELINE_FINALIZE_FLOW_BATCH = 5;
var AM_WORKFLOW_MAX_CONSECUTIVE_FAILURES = 3;

function runDailyMvpPipeline() {
  globalIsInteractiveContext_ = false;
  return withLogging_('daily_pipeline', function() {
    ensureAllSheets_();
    if (!isKrMarketOpenDate_(amTodayString_())) {
      logInfo_('daily_pipeline', 'Skipped daily pipeline because Korea market is closed', getMarketCalendarSummary_(amTodayString_()));
      safeUiAlert_('오늘은 국내 증시 휴장일로 판단되어 핵심 파이프라인을 실행하지 않았습니다.\n\n시장 캘린더를 확인하려면 AI Scanner > 1. 처음 설정 > 시장 캘린더 진단을 실행하세요.');
      return getDailyPipelineState_();
    }
    startDailyPipeline_();
    continueDailyPipeline();
  });
}

function continueDailyPipeline() {
  return withLogging_('daily_pipeline', function() {
    return runDailyPipelineWithFailureGuard_('continueDailyPipeline');
  });
}

function continueDailyPipelineForFullWorkflow_() {
  return runDailyPipelineWithFailureGuard_('continueFullDailyWorkflow');
}

function runDailyPipelineWithFailureGuard_(continuationHandler) {
  try {
    var wasBlocked = isWorkflowFailureBlocked_(AM_PIPELINE_PROP_PREFIX);
    var result = continueDailyPipelineCore_(continuationHandler);
    if (!wasBlocked && !isWorkflowFailureBlocked_(AM_PIPELINE_PROP_PREFIX)) {
      resetWorkflowFailureGuard_(AM_PIPELINE_PROP_PREFIX);
    }
    return result;
  } catch (err) {
    handleWorkflowFailureGuard_(AM_PIPELINE_PROP_PREFIX, 'daily_pipeline', getDailyPipelineState_(), continuationHandler, err);
    throw err;
  }
}

function runDomesticCloseDataWorkflow() {
  return withLogging_('domestic_close_workflow', function() {
    ensureAllSheets_();
    var calendar = getMarketCalendarSummary_(amTodayString_());
    if (!calendar.kr_open) {
      logInfo_('domestic_close_workflow', 'Skipped domestic close collection because Korea market is closed', calendar);
      safeUiAlert_([
        '국내 장마감 1차 수집 건너뜀',
        '',
        '오늘은 국내 증시 휴장일로 판단했습니다.',
        '구분: ' + (calendar.holiday_name || '휴장'),
        '',
        '장전 휴장일 브리핑이 이미 발송됐으면 장마감 수집은 실행하지 않습니다.'
      ].join('\n'));
      return { date: calendar.date, skipped: true, reason: 'kr_market_closed', calendar: calendar };
    }
    startDailyPipeline_();
    var state = continueDailyPipeline();
    if (state.stage === 'done') {
      safeUiAlert_([
        '국내 장마감 1차 수집 완료',
        '',
        '날짜: ' + state.date,
        '상태: 완료(done)',
        '',
        '17:10 장마감 전체 워크플로우에서 이 데이터를 이어서 사용합니다.'
      ].join('\n'));
    } else {
      safeUiAlert_([
        '국내 장마감 1차 수집 진행 중',
        '',
        '날짜: ' + state.date,
        '단계: ' + formatStageKo_(state.stage),
        '진행 위치: ' + state.index + formatDailySubProgress_(state),
        '',
        '이어서 실행 트리거를 예약했습니다.'
      ].join('\n'));
    }
    return state;
  });
}

function continueDailyPipelineCore_(continuationHandler) {
    validateRealRuntimeConfig_();
    ensureAllSheets_();
    var deadline = new Date().getTime() + AM_PIPELINE_MAX_RUNTIME_MS;
    var state = getDailyPipelineState_();
    if (isWorkflowFailureBlocked_(AM_PIPELINE_PROP_PREFIX)) {
      deleteTriggersByHandler_(continuationHandler);
      logError_('daily_pipeline', 'Daily pipeline continuation blocked after repeated failures', {
        date: state.date || '',
        stage: state.stage || '',
        sub_key: state.sub_key || '',
        failure_count: getWorkflowFailureCount_(AM_PIPELINE_PROP_PREFIX),
        last_error: getScriptProperty_(AM_PIPELINE_PROP_PREFIX + 'FAIL_LAST_ERROR', '')
      });
      return state;
    }
    if (!state.date) {
      startDailyPipeline_();
      state = getDailyPipelineState_();
    }

    while (new Date().getTime() < deadline) {
      if (state.stage === 'market') {
        state = runMarketStageChunk_(state, deadline);
      } else if (state.stage === 'indicators') {
        state = runIndicatorStageChunk_(state, deadline);
      } else if (state.stage === 'finalize') {
        state = runFinalizeStageChunk_(state, deadline);
      } else if (state.stage === 'stale') {
        deleteTriggersByHandler_(continuationHandler);
        logWarn_('daily_pipeline', 'Stale daily pipeline continuation stopped', state);
        return state;
      } else if (state.stage === 'done') {
        deleteTriggersByHandler_(continuationHandler);
        logInfo_('daily_pipeline', 'Daily pipeline completed', { date: state.date });
        return state;
      } else {
        throw new Error('알 수 없는 핵심 파이프라인 단계입니다: ' + state.stage);
      }

      if (state.needs_continuation) {
        state.needs_continuation = false;
        saveDailyPipelineState_(state);
        scheduleDailyPipelineContinuation_(continuationHandler);
        logInfo_('daily_pipeline', 'Daily pipeline chunk completed; continuation scheduled', state);
        return state;
      }
    }

    scheduleDailyPipelineContinuation_(continuationHandler);
    logInfo_('daily_pipeline', 'Daily pipeline paused by runtime guard; continuation scheduled', state);
    return state;
}

function startDailyPipeline_() {
  validateRealRuntimeConfig_();
  setupAiMarketLeaderScanner();
  resetWorkflowFailureGuard_(AM_PIPELINE_PROP_PREFIX);
  var today = amTodayString_();
  [
    AM_CONFIG.SHEETS.MARKET_DAILY,
    AM_CONFIG.SHEETS.INDICATORS_DAILY,
    AM_CONFIG.SHEETS.SECTOR_STRENGTH_DAILY,
    AM_CONFIG.SHEETS.INVESTOR_FLOW_DAILY,
    AM_CONFIG.SHEETS.INVESTOR_FLOW_SCORE,
    AM_CONFIG.SHEETS.ETF_HOLDINGS,
    AM_CONFIG.SHEETS.ETF_STOCK_SCORE,
    AM_CONFIG.SHEETS.LEADER_CANDIDATES,
    AM_CONFIG.SHEETS.LEADER_50,
    AM_CONFIG.SHEETS.KOSDAQ_LEADER_50,
    AM_CONFIG.SHEETS.RISK_ALERTS,
    AM_CONFIG.SHEETS.ENTRY_PLAN,
    AM_CONFIG.SHEETS.SCENARIO_DAILY
  ].forEach(function(sheetName) {
    deleteRowsByDate_(sheetName, today);
  });
  deleteTriggersByHandler_('continueDailyPipeline');
    saveDailyPipelineState_({
      date: today,
      stage: 'market',
      index: 0,
      sub_key: '',
      sub_index: 0,
      sub_total: 0,
      started_at: amNowString_(),
      updated_at: amNowString_()
    });
  logInfo_('daily_pipeline', 'Daily pipeline started', { date: today });
}

function runMarketStageChunk_(state, deadline) {
  var universe = readActiveUniverseRows_();
  var processed = 0;
  var marketRowsToAppend = [];
  var riskRowsToAppend = [];
  while (state.index < universe.length && processed < AM_PIPELINE_CURRENT_PRICE_BATCH && new Date().getTime() < deadline) {
    var stock = universe[state.index];
    var symbol = normalizeStockSymbol_(stock.symbol);
    var quote = safeFetchKisCurrentPriceForMarket_(symbol, stock.name);
    if (quote) {
      marketRowsToAppend.push({
        date: state.date,
        symbol: symbol,
        name: stock.name,
        market: quote.market || stock.market,
        sector: quote.sector || stock.sector,
        close: quote.close,
        change_pct: quote.change_pct,
        volume: quote.volume,
        trading_value: quote.trading_value,
        source: 'kis',
        raw_json: quote.raw
      });
    } else {
      riskRowsToAppend.push({
        date: state.date,
        symbol: symbol,
        risk_type: 'data',
        risk_level: 'high',
        message: 'Current price is unavailable. Stock skipped from market_daily.',
        source: 'kis_current_price'
      });
    }
    state.index += 1;
    processed += 1;
  }
  appendObjectRows_(AM_CONFIG.SHEETS.MARKET_DAILY, marketRowsToAppend);
  appendObjectRows_(AM_CONFIG.SHEETS.RISK_ALERTS, riskRowsToAppend);
  state.updated_at = amNowString_();
  if (state.index >= universe.length) {
    SpreadsheetApp.flush();
    state.stage = 'indicators';
    state.index = 0;
    clearDailySubStepState_(state);
    saveDailyPipelineState_(state);
    logInfo_('daily_pipeline', 'Market stage completed', { count: universe.length });
    return state;
  }
  state.needs_continuation = true;
  saveDailyPipelineState_(state);
  return state;
}

function runIndicatorStageChunk_(state, deadline) {
  var marketRows = readObjects_(AM_CONFIG.SHEETS.MARKET_DAILY).filter(function(row) {
    return normalizeDateValue_(row.date) === normalizeDateValue_(state.date);
  });
  var processed = 0;
  var indicatorRowsToAppend = [];
  var riskRowsToAppend = [];
  while (state.index < marketRows.length && processed < AM_PIPELINE_DAILY_PRICE_BATCH && new Date().getTime() < deadline) {
    var row = marketRows[state.index];
    var symbol = normalizeStockSymbol_(row.symbol);
    var priceRows = safeFetchRecentDailyPricesForIndicators_(symbol, row.name);
    if (priceRows && priceRows.length >= 60) {
      var indicator = calculateIndicatorFromDailyPrices_(priceRows);
      indicatorRowsToAppend.push({
        date: state.date,
        symbol: symbol,
        ma5: indicator.ma5,
        ma20: indicator.ma20,
        ma60: indicator.ma60,
        rsi14: indicator.rsi14,
        volume_ratio: indicator.volume_ratio,
        near_52w_high_pct: indicator.near_52w_high_pct,
        atr14: indicator.atr14,
        atr14_pct: indicator.atr14_pct,
        chart_score: indicator.chart_score
      });
    } else {
      riskRowsToAppend.push({
        date: state.date,
        symbol: symbol,
        risk_type: 'data',
        risk_level: 'high',
        message: 'No usable KIS daily price rows. Stock skipped from indicator and leader scoring.',
        source: 'kis_daily_price'
      });
    }
    state.index += 1;
    processed += 1;
  }
  appendObjectRows_(AM_CONFIG.SHEETS.INDICATORS_DAILY, indicatorRowsToAppend);
  appendObjectRows_(AM_CONFIG.SHEETS.RISK_ALERTS, riskRowsToAppend);
  state.updated_at = amNowString_();
  if (state.index >= marketRows.length) {
    SpreadsheetApp.flush();
    state.stage = 'finalize';
    state.index = 0;
    clearDailySubStepState_(state);
    saveDailyPipelineState_(state);
    logInfo_('daily_pipeline', 'Indicator stage completed', { count: marketRows.length });
    return state;
  }
  state.needs_continuation = true;
  saveDailyPipelineState_(state);
  return state;
}

function runFinalizeStage_(state) {
  buildMarketBreadthDaily();
  buildSectorStrengthDaily();
  collectEtfHoldings();
  calculateEtfScoresFromHoldings();
  collectInvestorFlowDaily();
  calculateInvestorFlowScores();
  buildLeaderCandidates();
  scanRiskAlerts();
  buildEntryPlan();
  buildScenarioDaily_();
  logInfo_('daily_pipeline', 'Finalize stage completed', { date: state.date });
}

function runFinalizeStageChunk_(state, deadline) {
  var steps = getDailyFinalizeSteps_();
  var processed = 0;
  state.index = Number(state.index || 0);
  while (
    state.index < steps.length &&
    processed < AM_PIPELINE_FINALIZE_BATCH &&
    new Date().getTime() < deadline - 20000
  ) {
    var step = steps[state.index];
    logInfo_('daily_pipeline', 'Finalize step started', {
      date: state.date,
      step: step.key,
      index: state.index + 1,
      total: steps.length,
      sub_index: state.sub_index || 0,
      sub_total: state.sub_total || ''
    });
    var completed = step.run(state, deadline);
    state.updated_at = amNowString_();
    if (completed) {
      clearDailySubStepState_(state);
      state.index += 1;
      processed += 1;
      saveDailyPipelineState_(state);
      SpreadsheetApp.flush();
      logInfo_('daily_pipeline', 'Finalize step completed', {
        date: state.date,
        step: step.key,
        index: state.index,
        total: steps.length
      });
    } else {
      state.needs_continuation = true;
      saveDailyPipelineState_(state);
      logInfo_('daily_pipeline', 'Finalize sub-step paused; continuation required', {
        date: state.date,
        step: step.key,
        index: state.index + 1,
        total: steps.length,
        sub_index: state.sub_index || 0,
        sub_total: state.sub_total || ''
      });
      return state;
    }
  }
  if (state.index >= steps.length) {
    state.stage = 'done';
    state.index = 0;
    clearDailySubStepState_(state);
    state.updated_at = amNowString_();
    saveDailyPipelineState_(state);
    logInfo_('daily_pipeline', 'Finalize stage completed', { date: state.date });
    return state;
  }
  state.needs_continuation = true;
  saveDailyPipelineState_(state);
  return state;
}

function getDailyFinalizeSteps_() {
  return [
    { key: 'market_breadth', run: runImmediateFinalizeStep_(buildMarketBreadthDaily) },
    { key: 'sector_strength', run: runImmediateFinalizeStep_(buildSectorStrengthDaily) },
    { key: 'etf_holdings', run: collectEtfHoldingsForPipeline_ },
    { key: 'etf_scores', run: runImmediateFinalizeStep_(calculateEtfScoresFromHoldings) },
    { key: 'investor_flow', run: collectInvestorFlowForPipeline_ },
    { key: 'investor_flow_scores', run: runImmediateFinalizeStep_(calculateInvestorFlowScores) },
    { key: 'leader_scores', run: runImmediateFinalizeStep_(buildLeaderCandidates) },
    { key: 'risk_alerts', run: runImmediateFinalizeStep_(scanRiskAlerts) },
    { key: 'entry_plan', run: runImmediateFinalizeStep_(buildEntryPlan) },
    { key: 'scenario_daily', run: runImmediateFinalizeStep_(buildScenarioDaily_) }
  ];
}

function runImmediateFinalizeStep_(fn) {
  return function() {
    fn();
    return true;
  };
}

function collectEtfHoldingsForPipeline_(state, deadline) {
  validateRealRuntimeConfig_();
  ensureAllSheets_();
  var today = normalizeDateValue_(state.date || amTodayString_());
  var watchList = readActiveEtfWatchRows_();
  initializeDailySubStep_(state, 'etf_holdings', watchList.length, function() {
    deleteRowsByDate_(AM_CONFIG.SHEETS.ETF_HOLDINGS, today);
  });
  if (watchList.length === 0) {
    logWarn_('etf_collector', 'etf_watch has no active ETF rows. ETF score will be 0.', {});
    return true;
  }
  var processed = 0;
  var holdingsToAppend = [];
  while (
    Number(state.sub_index || 0) < watchList.length &&
    processed < AM_PIPELINE_FINALIZE_ETF_BATCH &&
    new Date().getTime() < deadline - 25000
  ) {
    var etf = watchList[Number(state.sub_index || 0)];
    var etfSymbol = normalizeStockSymbol_(etf.etf_symbol);
    try {
      var response = fetchKisEtfComponentStockPrice_(etfSymbol);
      var holdings = normalizeKisEtfHoldings_(etf, response);
      holdingsToAppend = holdingsToAppend.concat(holdings);
      logInfo_('etf_collector', 'Collected ETF holdings chunk', {
        etf_symbol: etfSymbol,
        etf_name: etf.etf_name,
        count: holdings.length
      });
      Utilities.sleep(250);
    } catch (err) {
      logWarn_('etf_collector', 'Skipped ETF holdings because KIS request failed', {
        etf_symbol: etfSymbol,
        etf_name: etf.etf_name || '',
        error: err.message || String(err)
      });
    }
    state.sub_index = Number(state.sub_index || 0) + 1;
    state.updated_at = amNowString_();
    saveDailyPipelineState_(state);
    processed += 1;
  }
  appendObjectRows_(AM_CONFIG.SHEETS.ETF_HOLDINGS, holdingsToAppend);
  return Number(state.sub_index || 0) >= watchList.length;
}

function collectInvestorFlowForPipeline_(state, deadline) {
  validateRealRuntimeConfig_();
  ensureAllSheets_();
  if (!isInvestorFlowCollectionWindowOpen_()) {
    var message = buildInvestorFlowTimeWindowMessage_();
    logWarn_('investor_flow', 'Skipped investor flow collection before KIS time window', {
      current_time: amNowString_(),
      message: message
    });
    return true;
  }
  var today = normalizeDateValue_(state.date || amTodayString_());
  var marketRows = readObjects_(AM_CONFIG.SHEETS.MARKET_DAILY).filter(function(row) {
    return normalizeDateValue_(row.date) === today;
  });
  if (marketRows.length === 0) {
    throw new Error('오늘 날짜의 market_daily 데이터가 없습니다. 핵심 파이프라인을 먼저 완료하세요.');
  }
  initializeDailySubStep_(state, 'investor_flow', marketRows.length, function() {
    deleteRowsByDate_(AM_CONFIG.SHEETS.INVESTOR_FLOW_DAILY, today);
  });
  var processed = 0;
  var flowsToAppend = [];
  while (
    Number(state.sub_index || 0) < marketRows.length &&
    processed < AM_PIPELINE_FINALIZE_FLOW_BATCH &&
    new Date().getTime() < deadline - 25000
  ) {
    var row = marketRows[Number(state.sub_index || 0)];
    var symbol = normalizeStockSymbol_(row.symbol);
    try {
      var response = fetchKisInvestorTradeByStockDaily_(symbol);
      var flow = normalizeKisInvestorFlow_(today, symbol, response);
      flowsToAppend.push(flow);
      Utilities.sleep(120);
    } catch (err) {
      logWarn_('investor_flow', 'Skipped investor flow because KIS request failed', {
        symbol: symbol,
        name: row.name || '',
        error: err.message || String(err)
      });
    }
    state.sub_index = Number(state.sub_index || 0) + 1;
    state.updated_at = amNowString_();
    saveDailyPipelineState_(state);
    processed += 1;
  }
  appendObjectRows_(AM_CONFIG.SHEETS.INVESTOR_FLOW_DAILY, flowsToAppend);
  return Number(state.sub_index || 0) >= marketRows.length;
}

function initializeDailySubStep_(state, key, total, initializer) {
  if (state.sub_key === key) return;
  clearDailySubStepState_(state);
  state.sub_key = key;
  state.sub_index = 0;
  state.sub_total = total || 0;
  state.updated_at = amNowString_();
  if (initializer) initializer();
  saveDailyPipelineState_(state);
}

function clearDailySubStepState_(state) {
  state.sub_key = '';
  state.sub_index = 0;
  state.sub_total = 0;
}

function readActiveUniverseRows_() {
  var universe = readObjects_(AM_CONFIG.SHEETS.MARKET_UNIVERSE).filter(function(row) {
    return String(row.active).toUpperCase() === 'Y';
  });
  if (universe.length === 0) {
    throw new Error('market_universe has no active rows. Add real KRX stock rows before running collection.');
  }
  return universe;
}

function scheduleDailyPipelineContinuation_(handlerFunctionName) {
  var handler = handlerFunctionName || 'continueDailyPipeline';
  deleteTriggersByHandler_(handler);
  ScriptApp.newTrigger(handler)
    .timeBased()
    .after(60 * 1000)
    .create();
}

function runFullDailyWorkflow() {
  return withLogging_('full_workflow', function() {
    ensureAllSheets_();
    var today = amTodayString_();
    var calendar = getMarketCalendarSummary_(today);
    if (!calendar.kr_open) {
      resetWorkflowFailureGuard_(AM_FULL_WORKFLOW_PROP_PREFIX);
      resetWorkflowFailureGuard_(AM_PIPELINE_PROP_PREFIX);
      deleteTriggersByHandler_('continueFullDailyWorkflow');
      deleteTriggersByHandler_('continueDailyPipeline');
      if (hasPremarketEmailAlreadySent_(today)) {
        markDailyEmailSent_(today);
        logInfo_('email_report', 'Daily email report sent', {
          date: today,
          holiday: true,
          skipped: true,
          reason: 'premarket holiday briefing already sent'
        });
        saveFullWorkflowState_({
          date: today,
          stage: 'done',
          started_at: amNowString_(),
          updated_at: amNowString_()
        });
        logInfo_('full_workflow', 'Skipped full workflow because Korea market is closed and holiday briefing was already sent', calendar);
        return { date: today, skipped: true, reason: 'kr_market_closed_already_briefed', calendar: calendar };
      }
      collectMacroRaw();
      collectMarketNewsBriefing();
      ensureHoldingsAdviceForPremarket_();
      sendMarketHolidayEmail_('daily_close', calendar);
      saveFullWorkflowState_({
        date: today,
        stage: 'done',
        started_at: amNowString_(),
        updated_at: amNowString_()
      });
      return { date: today, skipped: true, reason: 'kr_market_closed', calendar: calendar };
    }
    resetWorkflowFailureGuard_(AM_FULL_WORKFLOW_PROP_PREFIX);
    resetWorkflowFailureGuard_(AM_PIPELINE_PROP_PREFIX);
    saveFullWorkflowState_({
      date: amTodayString_(),
      stage: 'daily',
      started_at: amNowString_(),
      updated_at: amNowString_()
    });
    deleteTriggersByHandler_('continueFullDailyWorkflow');
    prepareDailyPipelineForFullWorkflow_();
    return continueFullDailyWorkflow();
  });
}

function prepareDailyPipelineForFullWorkflow_() {
  ensureAllSheets_();
  var today = amTodayString_();
  var state = getDailyPipelineState_();
  deleteTriggersByHandler_('continueDailyPipeline');
  if (normalizeDateValue_(state.date) === today && state.stage && state.stage !== 'stale') {
    if (state.stage === 'done' && !hasMinimumDailyOutputsForDate_(today)) {
      recoverDailyPipelineStateForDate_(today, state);
    }
    return;
  }
  startDailyPipeline_();
}

function hasMinimumDailyOutputsForDate_(dateValue) {
  var target = normalizeDateValue_(dateValue);
  return countRowsByDate_(AM_CONFIG.SHEETS.MARKET_DAILY, target) > 0 &&
    countRowsByDate_(AM_CONFIG.SHEETS.INDICATORS_DAILY, target) > 0 &&
    countRowsByDate_(AM_CONFIG.SHEETS.LEADER_50, target) > 0 &&
    countRowsByDate_(AM_CONFIG.SHEETS.ENTRY_PLAN, target) > 0;
}

function recoverDailyPipelineStateForDate_(dateValue, previousState) {
  var target = normalizeDateValue_(dateValue);
  var marketCount = countRowsByDate_(AM_CONFIG.SHEETS.MARKET_DAILY, target);
  var indicatorCount = countRowsByDate_(AM_CONFIG.SHEETS.INDICATORS_DAILY, target);
  var stage = marketCount === 0 ? 'market' : (indicatorCount === 0 ? 'indicators' : 'finalize');
  saveDailyPipelineState_({
    date: target,
    stage: stage,
    index: 0,
    sub_key: '',
    sub_index: 0,
    sub_total: 0,
    started_at: previousState && previousState.started_at ? previousState.started_at : amNowString_(),
    updated_at: amNowString_()
  });
  logWarn_('daily_pipeline', 'Recovered daily pipeline state because required daily outputs were missing', {
    date: target,
    stage: stage,
    market_daily: marketCount,
    indicators_daily: indicatorCount,
    leader_50: countRowsByDate_(AM_CONFIG.SHEETS.LEADER_50, target),
    entry_plan: countRowsByDate_(AM_CONFIG.SHEETS.ENTRY_PLAN, target)
  });
}

function continueFullDailyWorkflow() {
  return withLogging_('full_workflow', function() {
    try {
      var wasBlocked = isWorkflowFailureBlocked_(AM_FULL_WORKFLOW_PROP_PREFIX);
      var result = continueFullDailyWorkflowCore_();
      if (!wasBlocked && !isWorkflowFailureBlocked_(AM_FULL_WORKFLOW_PROP_PREFIX)) {
        resetWorkflowFailureGuard_(AM_FULL_WORKFLOW_PROP_PREFIX);
      }
      return result;
    } catch (err) {
      handleWorkflowFailureGuard_(AM_FULL_WORKFLOW_PROP_PREFIX, 'full_workflow', getFullWorkflowState_(), 'continueFullDailyWorkflow', err);
      throw err;
    }
  });
}

function continueFullDailyWorkflowCore_() {
    ensureAllSheets_();
    var deadline = new Date().getTime() + AM_PIPELINE_MAX_RUNTIME_MS;
    var state = getFullWorkflowState_();
    if (isWorkflowFailureBlocked_(AM_FULL_WORKFLOW_PROP_PREFIX) || isWorkflowFailureBlocked_(AM_PIPELINE_PROP_PREFIX)) {
      deleteTriggersByHandler_('continueFullDailyWorkflow');
      deleteTriggersByHandler_('continueDailyPipeline');
      logError_('full_workflow', 'Full workflow continuation blocked after repeated failures', {
        date: state.date || '',
        stage: state.stage || '',
        full_failure_count: getWorkflowFailureCount_(AM_FULL_WORKFLOW_PROP_PREFIX),
        daily_failure_count: getWorkflowFailureCount_(AM_PIPELINE_PROP_PREFIX),
        full_last_error: getScriptProperty_(AM_FULL_WORKFLOW_PROP_PREFIX + 'FAIL_LAST_ERROR', ''),
        daily_last_error: getScriptProperty_(AM_PIPELINE_PROP_PREFIX + 'FAIL_LAST_ERROR', '')
      });
      return state;
    }
    if (!state.date) {
      saveFullWorkflowState_({
        date: amTodayString_(),
        stage: 'daily',
        started_at: amNowString_(),
        updated_at: amNowString_()
      });
      state = getFullWorkflowState_();
    }
    if (isStaleFullWorkflowState_(state)) {
      return abortStaleFullWorkflow_(state);
    }

    if (state.stage === 'daily') {
      var dailyState = continueDailyPipelineForFullWorkflow_();
      if (dailyState.stage !== 'done') {
        saveFullWorkflowState_(updateFullWorkflowState_(state, 'daily'));
        safeUiAlert_([
          '전체 워크플로우 진행 중',
          '',
          '현재 단계: 핵심 파이프라인',
          '세부 단계: ' + formatStageKo_(dailyState.stage),
          '진행 위치: ' + dailyState.index + formatDailySubProgress_(dailyState),
          '',
          '이어서 실행 트리거를 예약했습니다.',
          '약 1분 뒤 AI Scanner > 진행 상태 확인을 눌러 확인하세요.'
        ].join('\n'));
        return getFullWorkflowState_();
      }
      ensureBacktestLogForToday_();
      state = updateFullWorkflowState_(state, 'dart');
      saveFullWorkflowState_(state);
    }

    if (state.stage === 'dart') {
      state = ensureFullWorkflowPostDailyData_(state);
      saveFullWorkflowState_(state);
      if (!hasLeaderRowsForWorkflowDate_(state)) {
        state = rewindFullWorkflowToDailyFinalize_(state);
        saveFullWorkflowState_(state);
        scheduleFullWorkflowContinuation_();
        safeUiAlert_([
          '주도주 결과가 아직 비어 있습니다',
          '',
          'DART 재무/공시 단계로 넘어가기 전에 leader_50이 필요합니다.',
          '핵심 파이프라인 마무리 단계로 되돌리고 이어서 실행 트리거를 예약했습니다.',
          '',
          '약 1분 뒤 AI Scanner > 진행 상태 확인을 눌러 확인하세요.'
        ].join('\n'));
        return state;
      }
      state = continueDartFinancialsForLeaders_(state, deadline);
      if (state.stage === 'dart') {
        saveFullWorkflowState_(state);
        scheduleFullWorkflowContinuation_();
        safeUiAlert_([
          '전체 워크플로우 진행 중',
          '',
          '현재 단계: DART 재무/공시',
          'DART 진행 위치: ' + (state.dart_index || 0) + ' / ' + (state.dart_total || ''),
          '',
          '이어서 실행 트리거를 예약했습니다.',
          '약 1분 뒤 AI Scanner > 진행 상태 확인을 눌러 확인하세요.'
        ].join('\n'));
        return state;
      }
      state = updateFullWorkflowState_(state, 'macro');
      saveFullWorkflowState_(state);
      scheduleFullWorkflowContinuation_();
      safeUiAlert_('전체 워크플로우 진행 상황\n\nDART 재무/공시 수집 완료\n다음 단계: 거시지표 수집\n이어서 실행 트리거를 예약했습니다.');
      return state;
    }

    if (state.stage === 'macro') {
      collectMacroRaw();
      state = updateFullWorkflowState_(state, 'news');
      saveFullWorkflowState_(state);
      scheduleFullWorkflowContinuation_();
      return state;
    }

    if (state.stage === 'news') {
      collectMarketNewsBriefing();
      state = updateFullWorkflowState_(state, 'gemini');
      saveFullWorkflowState_(state);
      scheduleFullWorkflowContinuation_();
      safeUiAlert_('전체 워크플로우 진행 상황\n\n거시지표와 뉴스 수집 완료\n다음 단계: Gemini 리포트 생성\n이어서 실행 트리거를 예약했습니다.');
      return state;
    }

    if (state.stage === 'gemini') {
      state = continueAiReportsForLeaders_(state, deadline);
      if (state.stage === 'gemini') {
        // 아직 Gemini 진행 중 → 상태 저장 후 이어서 실행 트리거 예약
        saveFullWorkflowState_(state);
        scheduleFullWorkflowContinuation_();
        safeUiAlert_([
          '전체 워크플로우 진행 중',
          '',
          '현재 단계: AI 리포트 생성',
          'Gemini 진행 위치: ' + (state.gemini_index || 0) + ' / ' + (state.gemini_total || ''),
          '시장 브리핑: ' + (state.gemini_market_done ? '완료' : '대기'),
          '',
          '이어서 실행 트리거를 예약했습니다.',
          '약 1분 뒤 AI Scanner > 진행 상태 확인을 눌러 확인하세요.'
        ].join('\n'));
        return state;
      }
      // Gemini 단계 완료 ('gemini_done') → 'email' 단계로 이동
      state = updateFullWorkflowState_(state, 'email');
      saveFullWorkflowState_(state);
      scheduleFullWorkflowContinuation_();
      safeUiAlert_('전체 워크플로우 진행 상황\n\nGemini 리포트 생성 완료\n다음 단계: 메일 발송\n이어서 실행 트리거를 예약했습니다.');
      return state;
    }

    if (state.stage === 'email') {
      sendDailyEmailReport();
      state = updateFullWorkflowState_(state, 'done');
      saveFullWorkflowState_(state);
    }

    if (state.stage === 'done') {
      deleteTriggersByHandler_('continueFullDailyWorkflow');
      deleteTriggersByHandler_('continueDailyPipeline');
      logInfo_('full_workflow', 'Full daily workflow completed', state);
      safeUiAlert_([
        '장마감 전체 워크플로우 완료',
        '',
        '날짜: ' + state.date,
        '상태: 완료(done)',
        '장마감 메일 발송까지 완료됐어야 합니다.'
      ].join('\n'));
      return state;
    }

    throw new Error('알 수 없는 전체 워크플로우 단계입니다: ' + state.stage);
}

function isStaleFullWorkflowState_(state) {
  var stateDate = normalizeDateValue_(state.date);
  if (!stateDate) return false;
  if (state.stage === 'done' || state.stage === 'stale') return false;
  return stateDate !== amTodayString_();
}

function abortStaleFullWorkflow_(state) {
  deleteTriggersByHandler_('continueFullDailyWorkflow');
  deleteTriggersByHandler_('continueDailyPipeline');
  var dailyState = getDailyPipelineState_();
  if (normalizeDateValue_(dailyState.date) !== amTodayString_() && dailyState.stage !== 'done') {
    saveDailyPipelineState_({
      date: dailyState.date || state.date,
      stage: 'stale',
      index: 0,
      started_at: dailyState.started_at || '',
      updated_at: amNowString_()
    });
  }
  var staleState = {
    date: state.date,
    stage: 'stale',
    started_at: state.started_at || '',
    updated_at: amNowString_()
  };
  saveFullWorkflowState_(staleState);
  logWarn_('full_workflow', 'Stopped stale full workflow continuation after date changed', {
    workflow_date: state.date,
    today: amTodayString_(),
    previous_stage: state.stage
  });
  safeUiAlert_([
    '오래된 이어서 실행을 정리했습니다',
    '',
    '워크플로우 날짜: ' + state.date,
    '오늘 날짜: ' + amTodayString_(),
    '이전 단계: ' + state.stage,
    '',
    '날짜가 넘어간 상태에서 이어 실행하면 데이터가 섞일 수 있어 중단했습니다.',
    '오늘 17:10 장마감 자동화는 새 워크플로우로 다시 시작됩니다.',
    '',
    '오늘 데이터를 지금 강제로 만들고 싶으면 AI Scanner > 오늘 전체 실행을 사용하세요.'
  ].join('\n'));
  return staleState;
}

function ensureFullWorkflowPostDailyData_(state) {
  var today = normalizeDateValue_(state.date || amTodayString_());
  if (state.post_daily_repaired) return state;
  if (countRowsByDate_(AM_CONFIG.SHEETS.MARKET_BREADTH_DAILY, today) === 0) {
    buildMarketBreadthDaily();
  }
  if (countRowsByDate_(AM_CONFIG.SHEETS.SECTOR_STRENGTH_DAILY, today) === 0) {
    buildSectorStrengthDaily();
  }
  var etfHoldingsCount = countRowsByDate_(AM_CONFIG.SHEETS.ETF_HOLDINGS, today);
  if (etfHoldingsCount > 0 && countRowsByDate_(AM_CONFIG.SHEETS.ETF_STOCK_SCORE, today) === 0) {
    calculateEtfScoresFromHoldings();
  }
  var investorFlowCount = countRowsByDate_(AM_CONFIG.SHEETS.INVESTOR_FLOW_DAILY, today);
  if (investorFlowCount > 0 && countRowsByDate_(AM_CONFIG.SHEETS.INVESTOR_FLOW_SCORE, today) === 0) {
    calculateInvestorFlowScores();
  }
  buildLeaderCandidates();
  buildEntryPlan();
  state.post_daily_repaired = true;
  state.updated_at = amNowString_();
  logInfo_('full_workflow', 'Post-daily derived data checked before DART', {
    date: today,
    market_breadth_daily: countRowsByDate_(AM_CONFIG.SHEETS.MARKET_BREADTH_DAILY, today),
    sector_strength_daily: countRowsByDate_(AM_CONFIG.SHEETS.SECTOR_STRENGTH_DAILY, today),
    etf_stock_score: countRowsByDate_(AM_CONFIG.SHEETS.ETF_STOCK_SCORE, today),
    investor_flow_score: countRowsByDate_(AM_CONFIG.SHEETS.INVESTOR_FLOW_SCORE, today)
  });
  return state;
}

function hasLeaderRowsForWorkflowDate_(state) {
  var dateValue = normalizeDateValue_(state.date || amTodayString_());
  return countRowsByDate_(AM_CONFIG.SHEETS.LEADER_50, dateValue) > 0;
}

function rewindFullWorkflowToDailyFinalize_(state) {
  var dateValue = normalizeDateValue_(state.date || amTodayString_());
  var dailyState = getDailyPipelineState_();
  var marketCount = countRowsByDate_(AM_CONFIG.SHEETS.MARKET_DAILY, dateValue);
  var indicatorCount = countRowsByDate_(AM_CONFIG.SHEETS.INDICATORS_DAILY, dateValue);
  var recoveryStage = marketCount === 0 ? 'market' : (indicatorCount === 0 ? 'indicators' : 'finalize');
  var recoveryIndex = recoveryStage === 'finalize' ? 0 : 0;
  if (
    normalizeDateValue_(dailyState.date) !== dateValue ||
    dailyState.stage === 'done' ||
    dailyState.stage === 'stale' ||
    !dailyState.stage ||
    (dailyState.stage === 'finalize' && Number(dailyState.index || 0) >= getDailyFinalizeSteps_().length)
  ) {
    saveDailyPipelineState_({
      date: dateValue,
      stage: recoveryStage,
      index: recoveryIndex,
      sub_key: '',
      sub_index: 0,
      sub_total: 0,
      started_at: dailyState.started_at || amNowString_(),
      updated_at: amNowString_()
    });
  }
  return {
    date: dateValue,
    stage: 'daily',
    started_at: state.started_at || amNowString_(),
    updated_at: amNowString_()
  };
}

function continueDartFinancialsForLeaders_(state, deadline) {
  var today = normalizeDateValue_(state.date || amTodayString_());
  var topN = Math.max(getSettingNumber_('report_top_n', 10), getSettingNumber_('dart_collect_top_n', 20));
  var leaders = readObjects_(AM_CONFIG.SHEETS.LEADER_50).filter(function(row) {
    return normalizeDateValue_(row.date) === today;
  }).slice(0, topN);
  if (leaders.length === 0) {
    throw new Error('오늘 날짜의 leader_50 데이터가 없습니다. 핵심 파이프라인을 먼저 완료하세요.');
  }
  var corpMap = getDartCorpMasterMap_();
  if (Object.keys(corpMap).length === 0) {
    throw new Error('dart_corp_master is empty. Run Sync DART corp master first.');
  }
  if (!state.dart_initialized) {
    deleteRowsByDate_(AM_CONFIG.SHEETS.FINANCIAL_RAW, today);
    deleteRowsByDate_(AM_CONFIG.SHEETS.FINANCIAL_RATIOS, today);
    state.dart_index = 0;
    state.dart_total = leaders.length;
    state.dart_initialized = true;
  }
  var processed = 0;
  var batchLimit = 4;
  while (Number(state.dart_index || 0) < leaders.length && processed < batchLimit && new Date().getTime() < deadline - 20000) {
    var leader = leaders[Number(state.dart_index || 0)];
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
    } else {
      collectDartFinancialForStock_(today, symbol, leader.sector, master.corp_code);
      scanDartDisclosureRiskForStock_(today, symbol, master.corp_code);
    }
    state.dart_index = Number(state.dart_index || 0) + 1;
    state.updated_at = amNowString_();
    processed += 1;
  }
  if (Number(state.dart_index || 0) >= leaders.length) {
    buildLeaderCandidates();
    scanRiskAlerts();
    dedupeRiskAlertsForDate_(today);
    buildEntryPlan();
    buildScenarioDaily_();
    delete state.dart_initialized;
    delete state.dart_index;
    delete state.dart_total;
    logInfo_('full_workflow', 'DART stage completed', { date: today, count: leaders.length });
    state.stage = 'dart_done';
    state.updated_at = amNowString_();
  }
  return state;
}

function installFullDailyWorkflowTrigger(suppressAlert) {
  deleteTriggersByHandler_('runFullDailyWorkflow');
  ScriptApp.newTrigger('runFullDailyWorkflow')
    .timeBased()
    .everyDays(1)
    .atHour(17)
    .nearMinute(10)
    .create();
  setScriptProperty_('AM_FULL_WORKFLOW_TRIGGER_TIME', '17:10');
  logInfo_('triggers', 'Installed full daily workflow trigger near 17:10', {});
  if (!suppressAlert) {
    safeUiAlert_('장마감 전체 워크플로우 자동화가 17:10 근처로 설치되었습니다.\n\n다음 확인: AI Scanner > 8. 자동화 > 자동화 상태 진단');
  }
}

function installDomesticCloseDataTrigger(suppressAlert) {
  deleteTriggersByHandler_('runDomesticCloseDataWorkflow');
  ScriptApp.newTrigger('runDomesticCloseDataWorkflow')
    .timeBased()
    .everyDays(1)
    .atHour(16)
    .nearMinute(10)
    .create();
  setScriptProperty_('AM_DOMESTIC_CLOSE_TRIGGER_TIME', '16:10');
  logInfo_('triggers', 'Installed domestic close data trigger near 16:10', {});
  if (!suppressAlert) {
    safeUiAlert_('국내 장마감 1차 수집 자동화가 16:10 근처로 설치되었습니다.\n\n다음 확인: AI Scanner > 8. 자동화 > 자동화 상태 진단');
  }
}

function runPremarketWorkflow() {
  return withLogging_('premarket_workflow', function() {
    ensureAllSheets_();
    var today = amTodayString_();
    if (hasPremarketEmailAlreadySent_(today)) {
      logInfo_('premarket_workflow', 'Premarket workflow skipped because email already sent', { date: today });
      return { date: today, skipped: true, reason: 'already_sent' };
    }
    var calendar = getMarketCalendarSummary_(today);
    collectMacroRaw();
    collectMarketNewsBriefing();
    ensureHoldingsAdviceForPremarket_();
    if (!calendar.kr_open) {
      sendMarketHolidayEmail_('premarket', calendar);
      logInfo_('premarket_workflow', 'Premarket holiday briefing completed', calendar);
      return { date: today, skipped: true, reason: 'kr_market_closed', calendar: calendar };
    }
    var briefing = buildPremarketBriefing();
    sendPremarketEmailReport();
    logInfo_('premarket_workflow', 'Premarket workflow completed', {
      date: briefing.date,
      base_leader_date: briefing.base_leader_date
    });
    safeUiAlert_([
      '장전 리포트 실행 완료',
      '',
      '날짜: ' + briefing.date,
      '기준 주도주 날짜: ' + briefing.base_leader_date,
      '장전 메일 발송 완료'
    ].join('\n'));
  });
}

function installPremarketTrigger(suppressAlert) {
  deleteTriggersByHandler_('runPremarketWorkflow');
  ScriptApp.newTrigger('runPremarketWorkflow')
    .timeBased()
    .everyDays(1)
    .atHour(7)
    .nearMinute(0)
    .create();
  setScriptProperty_('AM_PREMARKET_TRIGGER_TIME', '07:00');
  logInfo_('triggers', 'Installed premarket workflow trigger near 07:00', {});
  if (!suppressAlert) {
    safeUiAlert_('장전 브리핑 자동화가 07:00 근처로 설치되었습니다.\n\n다음 확인: AI Scanner > 8. 자동화 > 자동화 상태 진단');
  }
}

function buildPremarketBriefing() {
  return withLogging_('premarket_briefing', function() {
    ensureAllSheets_();
    var today = amTodayString_();
    var baseDate = resolveLatestLeaderDate_();
    var input = buildPremarketInput_(today, baseDate);
    var report = callGeminiJson_(buildPremarketPrompt_(input), {
      maxOutputTokens: 4096,
      temperature: 0.2,
      modelUseCase: 'premarket'
    });
    validatePremarketReport_(report);
    deleteRowsByDate_(AM_CONFIG.SHEETS.PREMARKET_BRIEFING, today);
    appendObjectRow_(AM_CONFIG.SHEETS.PREMARKET_BRIEFING, {
      date: today,
      base_leader_date: baseDate,
      briefing_json: report,
      created_at: amNowString_()
    });
    logInfo_('premarket_briefing', 'Premarket briefing built', { date: today, base_leader_date: baseDate });
    return {
      date: today,
      base_leader_date: baseDate,
      report: report
    };
  });
}

function sendPremarketEmailReport() {
  return withLogging_('premarket_email', function() {
    ensureAllSheets_();
    var today = amTodayString_();
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) {
      logWarn_('premarket_email', 'Skipped duplicate send because email lock is busy', { date: today });
      return { date: today, skipped: true, reason: 'lock_busy' };
    }
    try {
      if (hasPremarketEmailAlreadySent_(today)) {
        logInfo_('premarket_email', 'Premarket email already sent; skipped duplicate', { date: today });
        safeUiAlert_('장전 메일은 오늘 이미 발송되었습니다.\n\n날짜: ' + today + '\n중복 발송을 막기 위해 이번 실행은 건너뜁니다.');
        return { date: today, skipped: true, reason: 'already_sent' };
      }
    var row = readObjects_(AM_CONFIG.SHEETS.PREMARKET_BRIEFING).filter(function(item) {
      return normalizeDateValue_(item.date) === today;
    })[0];
    if (!row) {
      throw new Error(today + ' 장전 브리핑 데이터가 없습니다. 장전 리포트 실행을 먼저 실행하세요.');
    }
    var report = parseJsonCell_(row.briefing_json, {});
    var baseLeaderDate = normalizeDateValue_(row.base_leader_date);
    var macro = getLatestMacroSnapshot_();
    var news = getNewsBriefingForDate_(today);
    var breadth = getMarketBreadthForDate_(baseLeaderDate);
    var payload = {
      date: today,
      base_leader_date: baseLeaderDate,
      briefing: report,
      report: report,
      macro: macro,
      news: news,
      market_calendar: getMarketCalendarSummary_(today),
      news_scores: getNewsScoresForDate_(today),
      market_breadth: breadth,
      leader_history: readObjects_(AM_CONFIG.SHEETS.LEADER_HISTORY).filter(function(item) {
        return normalizeDateValue_(item.date) === baseLeaderDate;
      }),
      leaders: readObjects_(AM_CONFIG.SHEETS.LEADER_50).filter(function(item) {
        return normalizeDateValue_(item.date) === baseLeaderDate;
      }),
      kosdaq_leaders: readObjects_(AM_CONFIG.SHEETS.KOSDAQ_LEADER_50).filter(function(item) {
        return normalizeDateValue_(item.date) === baseLeaderDate;
      }),
      plans: readObjects_(AM_CONFIG.SHEETS.ENTRY_PLAN).filter(function(item) {
        return normalizeDateValue_(item.date) === baseLeaderDate;
      }),
      indicators: readObjects_(AM_CONFIG.SHEETS.INDICATORS_DAILY).filter(function(item) {
        return normalizeDateValue_(item.date) === baseLeaderDate;
      }),
      flows: readObjects_(AM_CONFIG.SHEETS.INVESTOR_FLOW_SCORE).filter(function(item) {
        return normalizeDateValue_(item.date) === baseLeaderDate;
      }),
      scenarios: buildRuleBasedScenarioRowsKo_(buildScenarioSignals_(macro, news, breadth)),
      sectors: getSectorStrengthForDate_(baseLeaderDate),
      holdings: readObjects_(AM_CONFIG.SHEETS.HOLDINGS_CURRENT).filter(function(item) {
        return normalizeDateValue_(item.date) === today;
      }),
      holdings_advice: readObjects_(AM_CONFIG.SHEETS.HOLDINGS_ADVICE).filter(function(item) {
        return normalizeDateValue_(item.date) === today;
      }),
      portfolio_risks: readObjects_(AM_CONFIG.SHEETS.PORTFOLIO_RISK).filter(function(item) {
        return normalizeDateValue_(item.date) === today;
      }),
      account_snapshot: readObjects_(AM_CONFIG.SHEETS.ACCOUNT_SNAPSHOT).filter(function(item) {
        return normalizeDateValue_(item.date) === today;
      })[0] || null,
      paper_portfolio: readObjects_(AM_CONFIG.SHEETS.PAPER_PORTFOLIO).filter(function(item) {
        return normalizeDateValue_(item.date) === today;
      })[0] || getLatestPaperPortfolioRow_(),
      paper_trades: (function() {
        var trades = readObjects_(AM_CONFIG.SHEETS.PAPER_LEDGER);
        trades.sort(function(a, b) {
          return String(b.date).localeCompare(String(a.date)) || String(b.created_at || '').localeCompare(String(a.created_at || ''));
        });
        return trades.slice(0, 5);
      })()
    };
    var recipient = getReportRecipientEmail_();
    MailApp.sendEmail({
      to: recipient,
      subject: '[AI Scanner] ' + today + ' premarket briefing',
      htmlBody: buildPremarketEmailHtml_(payload),
      body: buildPremarketEmailText_(payload),
      name: 'AI Market Leader Scanner'
    });
    markPremarketEmailSent_(today);
    try {
      var indicatorMap = {};
      try {
        readObjects_(AM_CONFIG.SHEETS.INDICATORS_DAILY).forEach(function(row) {
          if (normalizeDateValue_(row.date) === baseLeaderDate) {
            indicatorMap[normalizeStockSymbol_(row.symbol)] = row;
          }
        });
      } catch(e) {}

      // A) 지정학적 전쟁/군사 리스크 감지 및 밤사이 뉴스 수집
      var isGeopoliticalRisk = false;
      var geopoliticalDetails = '';
      var overnightNewsLines = [];
      try {
        if (payload.news && payload.news.length > 0) {
          payload.news.forEach(function(row) {
            var summary = row.summary || {};
            var keyNews = summary.key_news || [];
            
            if (keyNews.length > 0) {
              keyNews.slice(0, 3).forEach(function(item) {
                var topic = item.topic || '';
                var comment = item.comment || '';
                var combinedText = topic + ' ' + comment;
                
                var riskKeywords = ['전쟁', '지정학', '무력', '충돌', '공격', '폭격', '미사일', '군사', '이란', '이스라엘', '우크라이나', '대만', '북한'];
                var matched = riskKeywords.some(function(kw) {
                  return combinedText.indexOf(kw) >= 0;
                });
                
                if (matched) {
                  isGeopoliticalRisk = true;
                  geopoliticalDetails = topic + ': ' + comment;
                }
                
                if (row.session === 'us_close') {
                  var impactBadge = (item.impact === 'risk_off') ? '🔴위험회피' : ((item.impact === 'risk_on') ? '🟢위험선호' : '⚪중립');
                  overnightNewsLines.push('• <b>' + topic + '</b> (' + impactBadge + ' / ' + (item.affected_sectors || []).join(',') + ')');
                  overnightNewsLines.push('  ' + comment);
                }
              });
            }
          });
        }
      } catch(eNews) {
        logWarn_('premarket_email', 'Failed to scan overnight news for risk alarms in telegram builder', { error: eNews.message });
      }

      var tgLines = [
        '🌅 <b>[AI 스캐너 장전 프리마켓 풀 브리핑]</b>',
        '📅 ' + today,
        ''
      ];

      // 지정학적 리스크 경보 우선 기입!
      if (isGeopoliticalRisk) {
        tgLines.push('🚨 <b>[글로벌 지정학적 전쟁 위험 경보]</b>');
        tgLines.push('밤사이 지정학적 군사 충돌 및 전쟁 리스크 뉴스가 수집되었습니다! 오늘 시초가 코스피/코스닥 지수의 강한 급락 변동성이 우려되오니 안전자산 방어전략과 시나리오별 손절선을 차분히 고수하십시오.');
        if (geopoliticalDetails) {
          tgLines.push('👉 <i>포착 악재: ' + geopoliticalDetails + '</i>');
        }
        tgLines.push('');
      }

      tgLines.push('━━━━━━━━━━━━━━━━━━━━━');
      tgLines.push('📊 <b>시장 전망</b>: ' + (report.market_bias || '중립'));

      // 전일 요약이 있으면 추가
      if (report.opening_view || report.summary) {
        tgLines.push('');
        tgLines.push('📝 <b>아침 시황 가이드</b>');
        tgLines.push(report.opening_view || report.summary);
      }

      // 밤사이 주요 미국 마감 뉴스 추가
      if (overnightNewsLines.length > 0) {
        tgLines.push('');
        tgLines.push('━━━━━━━━━━━━━━━━━━━━━');
        tgLines.push('🌐 <b>새벽 주요 글로벌 뉴스:</b>');
        tgLines.push(overnightNewsLines.join('\n'));
      }

      // 관찰 종목 TOP 5
      tgLines.push('');
      tgLines.push('━━━━━━━━━━━━━━━━━━━━━');
      tgLines.push('💡 <b>오늘 관찰 우선순위 종목</b>');
      (report.today_watch || []).slice(0, 5).forEach(function(w, idx) {
        var sym = normalizeStockSymbol_(w.symbol || '');
        var ind = indicatorMap[sym] || {};
        var trendBadge = (ind.trend_filter_passed === 'N') ? '🔴역배열' : '🟢정배열';
        tgLines.push((idx + 1) + '. <b>' + w.name + '</b> ' + trendBadge);
        tgLines.push('   ' + (w.watch_reason || ''));
        
        var plan = null;
        if (payload.plans) {
          for (var pi = 0; pi < payload.plans.length; pi++) {
            if (normalizeStockSymbol_(payload.plans[pi].symbol) === sym) {
              plan = payload.plans[pi]; break;
            }
          }
        }
        if (plan && plan.first_entry_price) {
          tgLines.push('   📍 1차 검토가: ' + formatNumber_(plan.first_entry_price));
        }
      });

      // 시나리오 전망
      if (payload.scenarios && payload.scenarios.length > 0) {
        tgLines.push('');
        tgLines.push('━━━━━━━━━━━━━━━━━━━━━');
        tgLines.push('🔮 <b>시나리오 전망</b>');
        payload.scenarios.slice(0, 3).forEach(function(s) {
          var label = s.label || s.scenario_label || '';
          var desc = s.description || s.action || '';
          tgLines.push('• <b>' + label + '</b>: ' + desc);
        });
      }

      // 모의투자 현황
      if (payload.paper_portfolio) {
        var pTotal = Number(payload.paper_portfolio.total_eval_amount || 0);
        var pCum = Number(payload.paper_portfolio.cumulative_return_pct || 0);
        var pCumSign = pCum > 0 ? '+' : '';
        tgLines.push('');
        tgLines.push('━━━━━━━━━━━━━━━━━━━━━');
        tgLines.push('💰 <b>모의투자 현황</b>');
        tgLines.push('총자산: ' + formatNumber_(pTotal) + ' 원 (' + pCumSign + formatPercentText_(pCum) + ')');
      }

      tgLines.push('');
      tgLines.push('📬 장전 상세 이메일 보고서가 발송되었습니다.');

      sendTelegramMessage(tgLines.join('\n'));
    } catch(errTg) {
      logWarn_('premarket_email', 'Failed to send premarket summary telegram', { error: errTg.message || String(errTg) });
    }
    logInfo_('premarket_email', 'Premarket email report sent', { date: today, recipient: recipient });
    safeUiAlert_([
      '장전 메일 발송 완료',
      '',
      '날짜: ' + today,
      '받는 사람: ' + recipient
    ].join('\n'));
    return { date: today, recipient: recipient, sent: true };
    } finally {
      lock.releaseLock();
    }
  });
}

function hasEmailSendMarker_(propertyKey, dateValue) {
  return normalizeDateValue_(getScriptProperty_(propertyKey, '')) === normalizeDateValue_(dateValue);
}

function markEmailSendMarker_(propertyKey, dateValue) {
  setScriptProperty_(propertyKey, normalizeDateValue_(dateValue));
}

function hasPremarketEmailAlreadySent_(dateValue) {
  var target = normalizeDateValue_(dateValue);
  return hasEmailSendMarker_('AM_PREMARKET_EMAIL_SENT_DATE', target) ||
    countLogRowsByDateAndModuleAndMessage_(target, 'premarket_email', 'Premarket email report sent') > 0;
}

function markPremarketEmailSent_(dateValue) {
  markEmailSendMarker_('AM_PREMARKET_EMAIL_SENT_DATE', dateValue);
}

function hasDailyEmailAlreadySent_(dateValue) {
  var target = normalizeDateValue_(dateValue);
  return hasEmailSendMarker_('AM_DAILY_EMAIL_SENT_DATE', target) ||
    countLogRowsByDateAndModuleAndMessage_(target, 'email_report', 'Daily email report sent') > 0;
}

function markDailyEmailSent_(dateValue) {
  markEmailSendMarker_('AM_DAILY_EMAIL_SENT_DATE', dateValue);
}

function sendMarketHolidayEmail_(context, calendar) {
  var today = amTodayString_();
  var isPremarket = context === 'premarket';
  if (isPremarket && hasPremarketEmailAlreadySent_(today)) return { date: today, skipped: true, reason: 'already_sent' };
  if (!isPremarket && hasDailyEmailAlreadySent_(today)) return { date: today, skipped: true, reason: 'already_sent' };
  var payload = buildMarketHolidayEmailPayload_(context, calendar || getMarketCalendarSummary_(today));
  var recipient = getReportRecipientEmail_();
  MailApp.sendEmail({
    to: recipient,
    subject: '[AI Scanner] ' + today + ' 휴장일 브리핑',
    htmlBody: buildMarketHolidayEmailHtml_(payload),
    body: buildMarketHolidayEmailText_(payload),
    name: 'AI Market Leader Scanner'
  });
  if (isPremarket) {
    markPremarketEmailSent_(today);
    logInfo_('premarket_email', 'Premarket email report sent', { date: today, recipient: recipient, holiday: true });
  } else {
    markDailyEmailSent_(today);
    logInfo_('email_report', 'Daily email report sent', { date: today, recipient: recipient, holiday: true });
  }
  logInfo_('holiday_email', 'Market holiday email sent', { date: today, context: context, recipient: recipient, calendar: payload.calendar });
  try {
    var cal = payload.calendar || {};
    var tgMsg = [
      '🏖️ <b>[AI 스캐너 휴장일 브리핑]</b> ' + today,
      '',
      '📅 오늘은 <b>' + (cal.holiday_name || '휴장일') + '</b>입니다.',
      cal.next_open_date ? '📌 다음 개장일: ' + cal.next_open_date : '',
      '',
      '💡 휴장일에도 AI 스캐너는 해외 시장 동향, 거시경제 데이터, 뉴스 센티먼트를 꾸준히 수집하고 있습니다.',
      '',
      '📬 휴장일 상세 브리핑 이메일이 발송되었습니다.'
    ].filter(function(line) { return line !== ''; }).join('\n');
    sendTelegramMessage(tgMsg);
  } catch(errTg) {
    logWarn_('holiday_email', 'Failed to send holiday telegram', { error: errTg.message || String(errTg) });
  }
  return { date: today, recipient: recipient, sent: true, holiday: true };
}

function buildMarketHolidayEmailPayload_(context, calendar) {
  var today = amTodayString_();
  var baseDate = '';
  try {
    baseDate = resolveLatestLeaderDate_();
  } catch (err) {
    baseDate = calendar.latest_kr_trading_date || '';
  }
  return {
    date: today,
    context: context,
    calendar: calendar,
    base_leader_date: baseDate,
    macro: getLatestMacroSnapshot_(),
    news: getNewsBriefingForDate_(today),
    leaders: baseDate ? readObjects_(AM_CONFIG.SHEETS.LEADER_50).filter(function(row) {
      return normalizeDateValue_(row.date) === baseDate;
    }).slice(0, 5) : [],
    kosdaq_leaders: baseDate ? readObjects_(AM_CONFIG.SHEETS.KOSDAQ_LEADER_50).filter(function(row) {
      return normalizeDateValue_(row.date) === baseDate;
    }).slice(0, 5) : [],
    holdings: readObjects_(AM_CONFIG.SHEETS.HOLDINGS_CURRENT).filter(function(row) {
      return normalizeDateValue_(row.date) === today;
    }),
    holdings_advice: readObjects_(AM_CONFIG.SHEETS.HOLDINGS_ADVICE).filter(function(row) {
      return normalizeDateValue_(row.date) === today;
    }),
    portfolio_risks: readObjects_(AM_CONFIG.SHEETS.PORTFOLIO_RISK).filter(function(row) {
      return normalizeDateValue_(row.date) === today;
    }),
    account_snapshot: readObjects_(AM_CONFIG.SHEETS.ACCOUNT_SNAPSHOT).filter(function(row) {
      return normalizeDateValue_(row.date) === today;
    })[0] || null,
    paper_portfolio: readObjects_(AM_CONFIG.SHEETS.PAPER_PORTFOLIO).filter(function(row) {
      return normalizeDateValue_(row.date) === today;
    })[0] || getLatestPaperPortfolioRow_(),
    paper_trades: (function() {
      var trades = readObjects_(AM_CONFIG.SHEETS.PAPER_LEDGER);
      trades.sort(function(a, b) {
        return String(b.date).localeCompare(String(a.date)) || String(b.created_at || '').localeCompare(String(a.created_at || ''));
      });
      return trades.slice(0, 5);
    })()
  };
}

function buildMarketHolidayEmailHtml_(payload) {
  var calendar = payload.calendar || {};
  return [
    '<div style="font-family:Arial,Apple SD Gothic Neo,Malgun Gothic,sans-serif;color:#111827;max-width:880px">',
    '<h1 style="font-size:24px;margin:0 0 6px">AI Scanner 휴장일 브리핑</h1>',
    '<div style="color:#6b7280;margin-bottom:14px">' + escapeHtml_(payload.date) + '</div>',
    '<div style="border:1px solid #f59e0b;border-radius:8px;background:#fffbeb;padding:14px;margin-bottom:14px;line-height:1.6">',
    '<strong>오늘 국내 증시는 ' + (calendar.kr_open ? '개장' : '휴장') + '입니다.</strong><br>',
    '구분: ' + escapeHtml_(calendar.holiday_name || '휴장일') + '<br>',
    '최근 국내 거래일: ' + escapeHtml_(calendar.latest_kr_trading_date || '-') + ' / 다음 국내 거래일: ' + escapeHtml_(calendar.next_kr_trading_date || '-') + '<br>',
    '미국 증시: ' + (calendar.us_open ? '개장' : '휴장 또는 신호 제한'),
    '</div>',
    buildHoldingsAdviceHtml_(payload),
    buildPaperTradingHtml_(payload),
    buildNewsBriefingHtml_(payload.news || []),
    buildHolidayLeaderHtml_('최근 주도주 TOP 5', payload.leaders || []),
    buildHolidayLeaderHtml_('최근 코스닥 주도주 TOP 5', payload.kosdaq_leaders || []),
    buildMacroTableHtml_(payload.macro.raw || []),
    '<div style="border-top:1px solid #e5e7eb;margin-top:18px;padding-top:12px;font-size:12px;color:#6b7280;line-height:1.5">휴장일 브리핑은 자동매매 신호나 매수 추천이 아닙니다. 오늘은 신규 매매 판단보다 보유종목 리스크, 뉴스, 다음 개장 준비를 확인합니다.</div>',
    '</div>'
  ].join('');
}

function buildHolidayLeaderHtml_(title, rows) {
  if (!rows || rows.length === 0) return '';
  return '<h2 style="font-size:18px;margin:22px 0 8px">' + escapeHtml_(title) + '</h2>' +
    rows.map(function(row) {
      return '<div style="border:1px solid #e5e7eb;border-radius:8px;padding:10px;margin-bottom:8px;line-height:1.5">' +
        '<strong>' + escapeHtml_(row.rank || '') + '. ' + escapeHtml_(row.name || '') + '</strong> <span style="color:#6b7280">' + escapeHtml_(normalizeStockSymbol_(row.symbol)) + '</span><br>' +
        '<span style="color:#6b7280">섹터:</span> ' + escapeHtml_(row.sector || '') +
        ' / <span style="color:#6b7280">점수:</span> ' + escapeHtml_(formatNumber_(row.total_score)) +
        ' / <span style="color:#6b7280">등락률:</span> ' + escapeHtml_(formatPercentText_(row.change_pct)) +
        '</div>';
    }).join('');
}

function buildMarketHolidayEmailText_(payload) {
  var calendar = payload.calendar || {};
  var lines = [
    'AI Scanner 휴장일 브리핑',
    payload.date,
    '',
    '국내 증시: ' + (calendar.kr_open ? '개장' : '휴장'),
    '미국 증시: ' + (calendar.us_open ? '개장' : '휴장 또는 신호 제한'),
    '구분: ' + (calendar.holiday_name || '휴장일'),
    '최근 국내 거래일: ' + (calendar.latest_kr_trading_date || '-'),
    '다음 국내 거래일: ' + (calendar.next_kr_trading_date || '-'),
    '',
    '오늘은 신규 매매 판단보다 보유종목 리스크, 뉴스, 다음 개장 준비를 확인합니다.'
  ];
  appendPremarketHoldingsText_(lines, payload);
  if ((payload.leaders || []).length > 0) {
    lines.push('', '[최근 주도주 TOP 5]');
    payload.leaders.forEach(function(row) {
      lines.push(row.rank + '. ' + row.name + ' ' + normalizeStockSymbol_(row.symbol) + ' / 점수=' + row.total_score + ' / 등락률=' + formatPercentText_(row.change_pct));
    });
  }
  lines.push('', '이 메일은 휴장일 점검 리포트이며 자동매매 신호나 매수 추천이 아닙니다.');
  return lines.join('\n');
}

function resolveLatestLeaderDate_() {
  var rows = readObjects_(AM_CONFIG.SHEETS.LEADER_50);
  if (rows.length === 0) throw new Error('leader_50 데이터가 없습니다. 핵심 파이프라인을 먼저 완료하세요.');
  var latest = rows.reduce(function(best, row) {
    if (!best) return row;
    return normalizeDateValue_(row.date) > normalizeDateValue_(best.date) ? row : best;
  }, null);
  return normalizeDateValue_(latest.date);
}

function buildPremarketInput_(today, baseDate) {
  var leaders = readObjects_(AM_CONFIG.SHEETS.LEADER_50).filter(function(row) {
    return normalizeDateValue_(row.date) === baseDate;
  }).slice(0, 10);
  var kosdaqLeaders = readObjects_(AM_CONFIG.SHEETS.KOSDAQ_LEADER_50).filter(function(row) {
    return normalizeDateValue_(row.date) === baseDate;
  }).slice(0, 10);
  var plans = readObjects_(AM_CONFIG.SHEETS.ENTRY_PLAN).filter(function(row) {
    return normalizeDateValue_(row.date) === baseDate;
  });
  var risks = readObjects_(AM_CONFIG.SHEETS.RISK_ALERTS).filter(function(row) {
    return normalizeDateValue_(row.date) === baseDate;
  });
  var flows = readObjects_(AM_CONFIG.SHEETS.INVESTOR_FLOW_SCORE).filter(function(row) {
    return normalizeDateValue_(row.date) === baseDate;
  });
  var leaderHistory = readObjects_(AM_CONFIG.SHEETS.LEADER_HISTORY).filter(function(row) {
    return normalizeDateValue_(row.date) === baseDate;
  });
  var news = getNewsBriefingForDate_(today);
  var macro = getLatestMacroSnapshot_();
  var breadth = getMarketBreadthForDate_(baseDate);
  var calendar = getMarketCalendarSummary_(today);
  return {
    date: today,
    base_leader_date: baseDate,
    market_calendar: calendar,
    macro: macro,
    news: news,
    news_scores: getNewsScoresForDate_(today),
    market_breadth: breadth,
    leader_history: leaderHistory,
    scenarios: buildRuleBasedScenarioRowsKo_(buildScenarioSignals_(macro, news, breadth)),
    sector_strength: getSectorStrengthForDate_(baseDate).slice(0, 8),
    leaders: leaders.map(function(row) {
      var flow = findFirstBySymbol_(flows, row.symbol) || {};
      return {
        rank: Number(row.rank),
        symbol: normalizeStockSymbol_(row.symbol),
        name: row.name,
        sector: row.sector,
        close: Number(row.close || 0),
        change_pct: Number(row.change_pct || 0),
        trading_value: Number(row.trading_value || 0),
        risk_level: row.risk_level,
        total_score: Number(row.total_score || 0),
        flow_score: Number(flow.combined_flow_score || 0),
        flow_comment: flow.flow_comment || '',
        entry_plan: compactEntryPlanForGemini_(findFirstBySymbol_(plans, row.symbol) || {}),
        risk_alerts: risks.filter(function(risk) {
          return normalizeStockSymbol_(risk.symbol) === normalizeStockSymbol_(row.symbol);
        }).map(compactRiskAlertForGemini_)
      };
    }),
    kosdaq_leaders: kosdaqLeaders.map(function(row) {
      var flow = findFirstBySymbol_(flows, row.symbol) || {};
      return {
        rank: Number(row.rank),
        symbol: normalizeStockSymbol_(row.symbol),
        name: row.name,
        sector: row.sector,
        close: Number(row.close || 0),
        change_pct: Number(row.change_pct || 0),
        trading_value: Number(row.trading_value || 0),
        risk_level: row.risk_level,
        total_score: Number(row.total_score || 0),
        chart_score: Number(row.chart_score || 0),
        etf_score: Number(row.etf_score || 0),
        flow_score: Number(flow.combined_flow_score || 0),
        flow_comment: flow.flow_comment || ''
      };
    })
  };
}

function buildPremarketPrompt_(input) {
  return [
    'You are a premarket briefing assistant for a Korean stock scanner.',
    'Write Korean strings. Return valid JSON only. No markdown.',
    'This is not investment advice or a buy recommendation.',
    'Do not predict with certainty. Use scenario and checklist language.',
    'Purpose: premarket preparation for today. Focus on what to check after the open, what to avoid, and which conditions must be confirmed.',
    'Use the previous leader list, leader_history, and entry plan only as watch candidates. Do not recalculate prices or position sizes.',
    'Use macro, Korea/US overnight news, sector strength, KOSDAQ leaders, flow, risk alerts, and scenarios when available.',
    'Use market_calendar. If Korea market is closed, do not write trading action plans. If US market is closed, clearly say there is no fresh US close signal and do not overinterpret unchanged US index/rate data.',
    'Interpret news in a premarket way: US close news and overnight macro are used for today opening bias; previous Korea close news is used as context, not as a fresh intraday signal.',
    'today_watch should contain 5 to 7 candidates when enough data exists. Mix KOSPI and KOSDAQ only when the data supports it.',
    'Prioritize newly entered leaders, rank risers, strong sectors, and holdings risk, but avoid chase-buy wording.',
    'Avoid generic fallback sentences. Mention concrete prices, sectors, macro pressure, news, or risk alerts from input.',
    'Required JSON shape:',
    JSON.stringify({
      date: 'yyyy-mm-dd',
      base_leader_date: 'yyyy-mm-dd',
      opening_view: 'short Korean paragraph',
      market_bias: 'risk_on|neutral|risk_off',
      today_watch: [
        {
          name: 'stock name',
          symbol: '000000',
          watch_reason: 'short reason',
          first_check: 'what to check first after open',
          risk_note: 'short risk note'
        }
      ],
      sector_watch: ['short Korean sentence'],
      do_first: ['short Korean checklist item'],
      avoid: ['short Korean caution item'],
      data_quality_notes: ['short Korean data freshness or missing data note']
    }),
    'Input data:',
    JSON.stringify(input)
  ].join('\n');
}

function validatePremarketReport_(report) {
  if (!report || typeof report !== 'object') throw new Error('장전 리포트 응답 형식이 올바르지 않습니다.');
  if (!Array.isArray(report.today_watch)) throw new Error('장전 리포트에 오늘 관찰 후보(today_watch)가 없습니다.');
}

function buildPremarketEmailHtml_(payload) {
  var report = payload.report || {};
  payload.briefing = payload.briefing || report;
  
  // 지정학적 전쟁/군사 충돌 리스크 키워드 감지
  var isGeopoliticalRisk = false;
  var geopoliticalAlertHtml = '';
  try {
    if (payload.news && payload.news.length > 0) {
      var riskKeywords = ['전쟁', '지정학', '무력', '충돌', '공격', '폭격', '미사일', '군사', '이란', '이스라엘', '우크라이나', '대만', '북한'];
      for (var nIdx = 0; nIdx < payload.news.length; nIdx++) {
        var row = payload.news[nIdx];
        var summary = row.summary || {};
        var keyNews = summary.key_news || [];
        for (var kIdx = 0; kIdx < keyNews.length; kIdx++) {
          var item = keyNews[kIdx];
          var combinedText = (item.topic || '') + ' ' + (item.comment || '');
          var matched = riskKeywords.some(function(kw) {
            return combinedText.indexOf(kw) >= 0;
          });
          if (matched) {
            isGeopoliticalRisk = true;
            geopoliticalAlertHtml = 
              '<div style="border:2px solid #ef4444;border-radius:8px;padding:14px;background:#fef2f2;margin-bottom:16px;color:#991b1b;font-size:14px;line-height:1.6">' +
              '<div style="font-size:16px;font-weight:bold;margin-bottom:6px">🚨 글로벌 지정학적 전쟁 및 군사적 리스크 감지 경보</div>' +
              '밤사이 글로벌 지정학적 무력 충돌 및 전쟁 관련 심각한 악재 뉴스가 포착되었습니다. (<b>' + escapeHtml_(item.topic) + '</b>: ' + escapeHtml_(item.comment) + ') ' +
              '<br/>방산, 에너지 섹터의 수급 유입 및 전체 시장 투매(Risk-Off) 충격에 대응하기 위해 사전에 세운 무효화(손절) 기준선과 자산 비중 조절 계획을 보수적으로 철저하게 고수하십시오.' +
              '</div>';
            break;
          }
        }
        if (isGeopoliticalRisk) break;
      }
    }
  } catch(e) {}

  return [
    '<div style="font-family:Arial,Apple SD Gothic Neo,Malgun Gothic,sans-serif;color:#111827;max-width:1040px">',
    '<h1 style="font-size:24px;margin:0 0 6px">' + ko_('premarket_title') + '</h1>',
    '<div style="color:#6b7280;margin-bottom:14px">' + escapeHtml_(payload.date) + ' / ' + ko_('base_leader_date') + ': ' + escapeHtml_(payload.base_leader_date) + '</div>',
    geopoliticalAlertHtml, // 지정학적 리스크 긴급 박스 삽입!
    buildPremarketDataFreshnessHtml_(payload),
    buildMarketCalendarNoticeHtml_(payload.market_calendar),
    '<div style="border:1px solid #d1d5db;border-radius:8px;padding:14px;background:#f9fafb;margin-bottom:16px">',
    '<div style="font-size:17px;margin-bottom:8px">' + buildRegimeBadge_(report.market_bias || payload.macro.market_regime || 'neutral') + ' <strong>' + ko_('macro_score') + ' ' + escapeHtml_(payload.macro.macro_alignment_score || '') + '/10</strong></div>',
    '<p style="line-height:1.6;margin:0">' + escapeHtml_(report.opening_view || '') + '</p>',
    '</div>',
    buildHoldingsAdviceHtml_(payload),
    buildPaperTradingHtml_(payload),
    buildNewsBriefingHtml_(payload.news || []),
    buildPremarketPriorityHtml_(payload),
    buildSectorStrengthHtml_(payload.sectors || getSectorStrengthForDate_(payload.base_leader_date)),
    buildMacroTableHtml_(payload.macro.raw || []),
    '<h2 style="font-size:18px;margin:22px 0 8px">' + ko_('next_scenarios') + '</h2>',
    buildScenarioCardsHtml_(payload),
    '<h2 style="font-size:18px;margin:22px 0 8px">' + ko_('today_watch') + '</h2>',
    buildPremarketWatchCardsHtml_(payload),
    '<h2 style="font-size:18px;margin:22px 0 8px">전날 주도주 TOP 10 가격 체크</h2>',
    buildTopLeaderCardsHtml_(payload, report.market_bias || payload.macro.market_regime || 'neutral'),
    buildKosdaqLeaderSectionHtml_(payload),
    buildSimpleListSectionHtml_(ko_('sector_watch'), report.sector_watch || []),
    buildSimpleListSectionHtml_(ko_('do_first'), report.do_first || []),
    buildSimpleListSectionHtml_(ko_('avoid'), report.avoid || []),
    buildSimpleListSectionHtml_('데이터 주의점', report.data_quality_notes || []),
    '<p style="font-size:12px;color:#6b7280;line-height:1.5;border-top:1px solid #e5e7eb;padding-top:12px">' + ko_('premarket_disclaimer') + '</p>',
    '</div>'
  ].join('');
}

function buildPremarketWatchCardsHtml_(payload) {
  var report = payload.report || {};
  var items = (report.today_watch || []).slice(0, 8);
  if (items.length === 0) {
    items = (payload.leaders || []).slice(0, 5).map(function(row) {
      var plan = findFirstBySymbol_(payload.plans || [], row.symbol) || {};
      return {
        name: row.name,
        symbol: normalizeStockSymbol_(row.symbol),
        watch_reason: '전날 주도주 순위 ' + row.rank + '위, 총점 ' + row.total_score + '점 기준의 관찰 후보입니다.',
        first_check: plan.first_entry_price ? '시가 형성 후 1차 검토가 ' + formatNumber_(plan.first_entry_price) + ' 부근 지지와 거래대금 유지 여부' : '시가 형성 후 거래대금과 섹터 동반 강세 여부',
        risk_note: row.risk_level === 'high' ? '고위험 후보이므로 관찰만 우선합니다.' : '시장 방향과 무효화 가격을 같이 확인합니다.'
      };
    });
  }
  return items.map(function(item) {
    var leader = findFirstBySymbol_(payload.leaders || [], item.symbol) || findFirstBySymbol_(payload.kosdaq_leaders || [], item.symbol) || {};
    var plan = findFirstBySymbol_(payload.plans || [], item.symbol) || {};
    var indicator = findFirstBySymbol_(payload.indicators || [], item.symbol) || {};
    
    var trendPassed = indicator.trend_filter_passed || 'Y';
    var trendBadge = trendPassed === 'Y'
      ? '<span style="display:inline-block;padding:2px 6px;font-size:11px;font-weight:bold;color:#15803d;background:#dcfce7;border-radius:4px;margin-left:6px">장기정배열 🟢</span>'
      : '<span style="display:inline-block;padding:2px 6px;font-size:11px;font-weight:bold;color:#b91c1c;background:#fee2e2;border-radius:4px;margin-left:6px">장기역배열 🔴</span>';
      
    var priceLine = plan.first_entry_price
      ? '<div style="font-size:13px;color:#374151;margin-top:6px">1차: <strong>' + escapeHtml_(formatNumber_(plan.first_entry_price)) + '</strong> / 돌파: <strong>' + escapeHtml_(formatNumber_(plan.breakout_price)) + '</strong> / 무효화: <strong>' + escapeHtml_(formatNumber_(plan.invalid_price)) + '</strong></div>'
      : '<div style="font-size:13px;color:#374151;margin-top:6px">현재가: <strong>' + escapeHtml_(formatNumber_(leader.close)) + '</strong> / 등락률: <strong>' + escapeHtml_(formatPercentText_(leader.change_pct)) + '</strong></div>';
    return '<div style="border:1px solid #d1d5db;border-radius:8px;padding:12px;margin:0 0 10px;background:#ffffff">' +
      '<div style="font-size:15px;line-height:1.45"><strong>' + escapeHtml_(item.name || leader.name || '') + '</strong> <span style="color:#6b7280">' + escapeHtml_(normalizeStockSymbol_(item.symbol || leader.symbol)) + '</span>' + trendBadge + '</div>' +
      '<div style="font-size:13px;line-height:1.6;margin-top:6px"><strong>' + ko_('why_watch') + ':</strong> ' + escapeHtml_(item.watch_reason || '') + '</div>' +
      '<div style="font-size:13px;line-height:1.6;margin-top:4px"><strong>' + ko_('check_first') + ':</strong> ' + escapeHtml_(item.first_check || '') + '</div>' +
      '<div style="font-size:13px;line-height:1.6;margin-top:4px"><strong>' + ko_('main_risk') + ':</strong> ' + escapeHtml_(item.risk_note || '') + '</div>' +
      priceLine +
      '</div>';
  }).join('');
}

function buildPremarketPriorityHtml_(payload) {
  var rows = payload.leader_history || [];
  var interesting = rows.filter(function(row) {
    var status = String(row.status || '');
    return status === '신규' || status === '상승';
  }).sort(function(a, b) {
    if (String(a.status) !== String(b.status)) return String(a.status) === '신규' ? -1 : 1;
    return Number(b.rank_change || 0) - Number(a.rank_change || 0);
  }).slice(0, 6);
  if (interesting.length === 0) return '';
  return '<h2 style="font-size:18px;margin:22px 0 8px">장전 우선 확인</h2>' +
    '<div style="border:1px solid #d1d5db;border-radius:8px;background:#ffffff;padding:12px;margin:0 0 12px">' +
    '<div style="font-size:13px;color:#374151;line-height:1.5;margin-bottom:8px">전날 새로 편입되었거나 순위가 오른 종목입니다. 시초가 추격보다 거래대금 유지와 가격 조건을 먼저 확인합니다.</div>' +
    interesting.map(function(row) {
      var plan = findFirstBySymbol_(payload.plans || [], row.symbol) || {};
      return '<div style="border-top:1px solid #f3f4f6;padding:7px 0;font-size:13px;line-height:1.5">' +
        '<strong>' + escapeHtml_(row.name || '') + '</strong> ' +
        '<span style="color:#6b7280">' + escapeHtml_(normalizeStockSymbol_(row.symbol)) + '</span> ' +
        '<span style="color:#2563eb">' + escapeHtml_(row.status || '') + '</span> ' +
        '<span style="color:#6b7280">' + escapeHtml_(formatLeaderHistoryRankText_(row)) + '</span>' +
        (plan.first_entry_price ? '<div style="color:#374151">1차 ' + escapeHtml_(formatNumber_(plan.first_entry_price)) + ' / 돌파 ' + escapeHtml_(formatNumber_(plan.breakout_price)) + ' / 무효화 ' + escapeHtml_(formatNumber_(plan.invalid_price)) + '</div>' : '') +
        '</div>';
    }).join('') +
    '</div>';
}

function buildPremarketDataFreshnessHtml_(payload) {
  var diff = daysBetweenDateStrings_(payload.base_leader_date, payload.date);
  if (diff < 2) return '';
  return '<div style="border:1px solid #f59e0b;border-radius:8px;background:#fffbeb;padding:10px;margin:0 0 12px;font-size:13px;line-height:1.55">' +
    '<strong>데이터 신선도 확인:</strong> 기준 주도주 날짜가 오늘보다 ' + escapeHtml_(diff) + '일 전입니다. 전날 장마감 워크플로우가 완료됐는지 확인하세요. 주말이나 휴일 직후라면 정상일 수 있습니다.' +
    '</div>';
}

function buildMarketCalendarNoticeHtml_(calendar) {
  if (!calendar) return '';
  if (calendar.kr_open && calendar.us_open) return '';
  var lines = [];
  if (!calendar.kr_open) {
    lines.push('국내 증시 휴장: ' + (calendar.holiday_name || '휴장일') + '. 오늘은 신규 매매 대응보다 보유종목 점검과 다음 개장 준비가 우선입니다.');
  }
  if (!calendar.us_open) {
    lines.push('미국 증시 휴장: 신선한 미국 장마감 신호가 제한적입니다. 미국 지수/금리 변화가 없더라도 방향 신호로 과해석하지 않습니다.');
  }
  return '<div style="border:1px solid #f59e0b;border-radius:8px;background:#fffbeb;padding:10px;margin:0 0 12px;font-size:13px;line-height:1.55">' +
    '<strong>시장 캘린더:</strong><br>' + lines.map(escapeHtml_).join('<br>') +
    '</div>';
}

function daysBetweenDateStrings_(startDate, endDate) {
  var start = parseDateOnly_(startDate);
  var end = parseDateOnly_(endDate);
  if (!start || !end) return 0;
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)));
}

function parseDateOnly_(dateValue) {
  var text = normalizeDateValue_(dateValue);
  var match = String(text || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function buildPremarketEmailText_(payload) {
  var report = payload.report || {};
  var lines = [
    ko_('premarket_title') + ' - ' + payload.date,
    ko_('base_leader_date') + ': ' + payload.base_leader_date,
    ko_('market_regime') + ': ' + (report.market_bias || payload.macro.market_regime || 'neutral'),
    '',
    report.opening_view || ''
  ];
  appendPremarketHoldingsText_(lines, payload);
  lines.push('', '[' + ko_('today_watch') + ']');
  (report.today_watch || []).forEach(function(item) {
    lines.push((item.name || '') + ' ' + (item.symbol || '') + ' - ' + (item.first_check || ''));
  });
  lines.push('', '[' + ko_('next_scenarios') + ']');
  (payload.scenarios || []).forEach(function(row) {
    lines.push(row.scenario + ': ' + row.conditions + ' / ' + row.response_plan);
  });
  if ((payload.leaders || []).length > 0) {
    lines.push('', '[전날 주도주 TOP 10]');
    payload.leaders.slice(0, 10).forEach(function(row) {
      var plan = findFirstBySymbol_(payload.plans || [], row.symbol) || {};
      lines.push(row.rank + '. ' + row.name + ' ' + normalizeStockSymbol_(row.symbol) +
        ' 점수=' + row.total_score +
        ' 1차=' + formatNumber_(plan.first_entry_price) +
        ' 돌파=' + formatNumber_(plan.breakout_price) +
        ' 무효화=' + formatNumber_(plan.invalid_price));
    });
  }
  if ((payload.kosdaq_leaders || []).length > 0) {
    lines.push('', '[코스닥 주도주 후보]');
    payload.kosdaq_leaders.slice(0, 10).forEach(function(row) {
      lines.push(row.rank + '. ' + row.name + ' ' + normalizeStockSymbol_(row.symbol) +
        ' 점수=' + row.total_score +
        ' 현재가=' + formatNumber_(row.close) +
        ' 등락률=' + formatPercentText_(row.change_pct));
    });
  }
  if (false && (payload.holdings_advice || []).length > 0) {
    lines.push('', '[내 보유종목 어드바이스]');
    payload.holdings_advice.forEach(function(row) {
      var holding = findFirstBySymbol_(payload.holdings || [], row.symbol) || {};
      lines.push((row.name || holding.name || '') + ' ' + normalizeStockSymbol_(row.symbol || holding.symbol) +
        ' / 판단=' + ko_('holding_action_' + String(row.action_view || 'needs_review').toLowerCase()) +
        ' / 비중=' + formatPercentText_(holding.portfolio_weight_pct) +
        ' / 손익률=' + formatPercentText_(holding.profit_loss_pct));
      if (row.next_check) lines.push('다음 확인: ' + row.next_check);
    });
  }
  lines.push('', ko_('premarket_disclaimer'));
  return lines.join('\n');
}

function appendPremarketHoldingsText_(lines, payload) {
  if ((payload.holdings_advice || []).length === 0) return;
  lines.push('', '[내 보유종목 어드바이스]');
  payload.holdings_advice.forEach(function(row) {
    var holding = findFirstBySymbol_(payload.holdings || [], row.symbol) || {};
    lines.push((row.name || holding.name || '') + ' ' + normalizeStockSymbol_(row.symbol || holding.symbol) +
      ' / 판단=' + ko_('holding_action_' + String(row.action_view || 'needs_review').toLowerCase()) +
      ' / 비중=' + formatPercentText_(holding.portfolio_weight_pct) +
      ' / 손익률=' + formatPercentText_(holding.profit_loss_pct));
    if (row.summary) lines.push('요약: ' + row.summary);
    if (row.next_check) lines.push('다음 확인: ' + row.next_check);
  });
}

function buildSimpleListSectionHtml_(title, items) {
  if (!items || items.length === 0) return '';
  return '<h2 style="font-size:18px;margin:22px 0 8px">' + escapeHtml_(title) + '</h2><ul style="line-height:1.6;margin-top:0">' +
    items.map(function(item) { return '<li>' + escapeHtml_(item) + '</li>'; }).join('') +
    '</ul>';
}

function getSectorStrengthForDate_(dateValue) {
  var target = normalizeDateValue_(dateValue);
  if (!AM_CONFIG.SHEETS.SECTOR_STRENGTH_DAILY) return [];
  return readObjects_(AM_CONFIG.SHEETS.SECTOR_STRENGTH_DAILY).filter(function(row) {
    return normalizeDateValue_(row.date) === target;
  }).sort(function(a, b) {
    return toNumber_(b.sector_score) - toNumber_(a.sector_score);
  });
}

function buildMarketBreadthHtml_(rows) {
  if (!rows || rows.length === 0) return '';
  var cards = rows.slice(0, 4).map(function(row) {
    var bg = Number(row.breadth_score || 0) >= 70 ? '#ecfdf5' :
      Number(row.breadth_score || 0) >= 45 ? '#f9fafb' : '#fef2f2';
    return '<div style="border:1px solid #e5e7eb;border-radius:8px;background:' + bg + ';padding:10px;margin:0 0 8px;font-size:13px;line-height:1.55">' +
      '<div><strong>' + escapeHtml_(row.market || '') + '</strong> <span style="color:#6b7280">' + escapeHtml_(row.stock_count || 0) + '종목</span></div>' +
      '<div><span style="color:#6b7280">시장 폭 점수:</span> <strong>' + escapeHtml_(row.breadth_score || 0) + '</strong></div>' +
      '<div><span style="color:#6b7280">상승 비율:</span> ' + escapeHtml_(formatPercentText_(row.up_ratio)) +
      ' / <span style="color:#6b7280">20일선 위:</span> ' + escapeHtml_(formatPercentText_(row.ma20_above_ratio)) + '</div>' +
      '<div><span style="color:#6b7280">거래량 증가:</span> ' + escapeHtml_(formatPercentText_(row.volume_expansion_ratio)) +
      ' / <span style="color:#6b7280">신고가 근접:</span> ' + escapeHtml_(formatPercentText_(row.near_high_ratio)) + '</div>' +
      '<div style="color:#6b7280;margin-top:4px">' + escapeHtml_(row.memo || '') + '</div>' +
      '</div>';
  }).join('');
  return '<h2 style="font-size:18px;margin:22px 0 8px">시장 폭 지표</h2>' + cards;
}

function buildSectorStrengthHtml_(sectorRows) {
  if (!sectorRows || sectorRows.length === 0) return '';
  var strongRows = sectorRows.slice(0, 5).map(buildSectorStrengthCardHtml_).join('');
  var weakText = sectorRows.slice().sort(function(a, b) {
    return toNumber_(a.sector_score) - toNumber_(b.sector_score);
  }).slice(0, 3).map(function(row) {
    return escapeHtml_(row.sector || '') + ' ' + formatNumber_(row.sector_score) + ko_('score_suffix');
  }).join(' / ');
  return '<h2 style="font-size:18px;margin:22px 0 8px">' + ko_('sector_strength') + '</h2>' +
    strongRows +
    '<div style="font-size:13px;color:#374151;margin:6px 0 18px"><strong>' + ko_('weak_sectors') + ':</strong> ' +
    weakText +
    '</div>';
}

function buildSectorStrengthCardHtml_(row) {
  return '<div style="border:1px solid #e5e7eb;border-radius:8px;padding:10px;margin:0 0 8px;background:#ffffff;font-size:13px;line-height:1.6">' +
    '<div><strong>' + escapeHtml_(row.sector || '') + '</strong> <span style="color:#6b7280">' + escapeHtml_(row.stock_count || 0) + ' ' + ko_('stocks_count') + '</span></div>' +
    '<div><span style="color:#6b7280">' + ko_('sector_score') + ':</span> ' + formatNumber_(row.sector_score) +
    ' / <span style="color:#6b7280">' + ko_('avg_change') + ':</span> ' + formatPercentText_(row.avg_change_pct) + '</div>' +
    '<div><span style="color:#6b7280">' + ko_('up_ratio') + ':</span> ' + formatPercentText_(row.up_ratio) +
    ' / <span style="color:#6b7280">' + ko_('trading_value_share') + ':</span> ' + formatPercentText_(row.relative_trading_value_pct) + '</div>' +
    '</div>';
}

function buildSectorStrengthRowHtml_(row) {
  return '<tr>' +
    '<td style="padding:7px;border:1px solid #e5e7eb"><strong>' + escapeHtml_(row.sector || '') + '</strong><br><span style="color:#6b7280">' + escapeHtml_(row.stock_count || 0) + ' ' + ko_('stocks_count') + '</span></td>' +
    '<td style="padding:7px;border:1px solid #e5e7eb;text-align:right">' + formatNumber_(row.sector_score) + '</td>' +
    '<td style="padding:7px;border:1px solid #e5e7eb;text-align:right">' + formatPercentText_(row.avg_change_pct) + '</td>' +
    '<td style="padding:7px;border:1px solid #e5e7eb;text-align:right">' + formatPercentText_(row.up_ratio) + '</td>' +
    '<td style="padding:7px;border:1px solid #e5e7eb;text-align:right">' + formatPercentText_(row.relative_trading_value_pct) + '</td>' +
    '</tr>';
}

function getFullDailyWorkflowStatus() {
  var state = getFullWorkflowState_();
  var lines = [
    '전체 워크플로우 상태',
    '',
    '날짜: ' + (state.date || '(없음)'),
    '단계: ' + formatStageKo_(state.stage || ''),
    state.sub_key ? '세부 진행: ' + formatFinalizeStepKeyKo_(state.sub_key) + ' ' + state.sub_index + ' / ' + state.sub_total : '',
    '시작: ' + (state.started_at || '(없음)'),
    '업데이트: ' + (state.updated_at || '(없음)')
  ].filter(function(line) { return line !== ''; });
  if (state.dart_index !== undefined && state.dart_index !== '') {
    lines.push('DART 진행 위치: ' + state.dart_index + ' / ' + (state.dart_total || ''));
  }
  if (state.gemini_index !== undefined && state.gemini_index !== '') {
    lines.push('Gemini 진행 위치: ' + state.gemini_index + ' / ' + (state.gemini_total || ''));
    lines.push('시장 브리핑: ' + (state.gemini_market_done ? '완료' : '대기'));
  }
  safeUiAlert_(lines.join('\n'));
  return state;
}

function scheduleFullWorkflowContinuation_() {
  deleteTriggersByHandler_('continueFullDailyWorkflow');
  ScriptApp.newTrigger('continueFullDailyWorkflow')
    .timeBased()
    .after(60 * 1000)
    .create();
}

function getFullWorkflowState_() {
  var props = PropertiesService.getScriptProperties();
  return {
    date: props.getProperty(AM_FULL_WORKFLOW_PROP_PREFIX + 'DATE') || '',
    stage: props.getProperty(AM_FULL_WORKFLOW_PROP_PREFIX + 'STAGE') || '',
    started_at: props.getProperty(AM_FULL_WORKFLOW_PROP_PREFIX + 'STARTED_AT') || '',
    updated_at: props.getProperty(AM_FULL_WORKFLOW_PROP_PREFIX + 'UPDATED_AT') || '',
    dart_initialized: props.getProperty(AM_FULL_WORKFLOW_PROP_PREFIX + 'DART_INITIALIZED') === 'true',
    dart_index: props.getProperty(AM_FULL_WORKFLOW_PROP_PREFIX + 'DART_INDEX') || '',
    dart_total: props.getProperty(AM_FULL_WORKFLOW_PROP_PREFIX + 'DART_TOTAL') || '',
    gemini_initialized: props.getProperty(AM_FULL_WORKFLOW_PROP_PREFIX + 'GEMINI_INITIALIZED') === 'true',
    gemini_index: props.getProperty(AM_FULL_WORKFLOW_PROP_PREFIX + 'GEMINI_INDEX') || '',
    gemini_total: props.getProperty(AM_FULL_WORKFLOW_PROP_PREFIX + 'GEMINI_TOTAL') || '',
    gemini_market_done: props.getProperty(AM_FULL_WORKFLOW_PROP_PREFIX + 'GEMINI_MARKET_DONE') === 'true',
    post_daily_repaired: props.getProperty(AM_FULL_WORKFLOW_PROP_PREFIX + 'POST_DAILY_REPAIRED') === 'true',
    failure_count: getWorkflowFailureCount_(AM_FULL_WORKFLOW_PROP_PREFIX),
    failure_stage: props.getProperty(AM_FULL_WORKFLOW_PROP_PREFIX + 'FAIL_STAGE') || '',
    failure_blocked: isWorkflowFailureBlocked_(AM_FULL_WORKFLOW_PROP_PREFIX),
    last_error: props.getProperty(AM_FULL_WORKFLOW_PROP_PREFIX + 'FAIL_LAST_ERROR') || ''
  };
}

function saveFullWorkflowState_(state) {
  var props = PropertiesService.getScriptProperties();
  props.setProperty(AM_FULL_WORKFLOW_PROP_PREFIX + 'DATE', state.date || '');
  props.setProperty(AM_FULL_WORKFLOW_PROP_PREFIX + 'STAGE', state.stage || '');
  props.setProperty(AM_FULL_WORKFLOW_PROP_PREFIX + 'STARTED_AT', state.started_at || '');
  props.setProperty(AM_FULL_WORKFLOW_PROP_PREFIX + 'UPDATED_AT', state.updated_at || amNowString_());
  setOptionalWorkflowProperty_(props, 'DART_INITIALIZED', state.dart_initialized ? 'true' : '');
  setOptionalWorkflowProperty_(props, 'DART_INDEX', state.dart_index !== undefined && state.dart_index !== '' ? String(state.dart_index) : '');
  setOptionalWorkflowProperty_(props, 'DART_TOTAL', state.dart_total !== undefined && state.dart_total !== '' ? String(state.dart_total) : '');
  setOptionalWorkflowProperty_(props, 'GEMINI_INITIALIZED', state.gemini_initialized ? 'true' : '');
  setOptionalWorkflowProperty_(props, 'GEMINI_INDEX', state.gemini_index !== undefined && state.gemini_index !== '' ? String(state.gemini_index) : '');
  setOptionalWorkflowProperty_(props, 'GEMINI_TOTAL', state.gemini_total !== undefined && state.gemini_total !== '' ? String(state.gemini_total) : '');
  setOptionalWorkflowProperty_(props, 'GEMINI_MARKET_DONE', state.gemini_market_done ? 'true' : '');
  setOptionalWorkflowProperty_(props, 'POST_DAILY_REPAIRED', state.post_daily_repaired ? 'true' : '');
}

function setOptionalWorkflowProperty_(props, suffix, value) {
  var key = AM_FULL_WORKFLOW_PROP_PREFIX + suffix;
  if (value === undefined || value === null || value === '') {
    props.deleteProperty(key);
  } else {
    props.setProperty(key, String(value));
  }
}

function updateFullWorkflowState_(state, nextStage) {
  return {
    date: state.date || amTodayString_(),
    stage: nextStage,
    started_at: state.started_at || amNowString_(),
    updated_at: amNowString_()
  };
}

function getDailyPipelineState_() {
  var props = PropertiesService.getScriptProperties();
  return {
    date: props.getProperty(AM_PIPELINE_PROP_PREFIX + 'DATE') || '',
    stage: props.getProperty(AM_PIPELINE_PROP_PREFIX + 'STAGE') || '',
    index: Number(props.getProperty(AM_PIPELINE_PROP_PREFIX + 'INDEX') || 0),
    sub_key: props.getProperty(AM_PIPELINE_PROP_PREFIX + 'SUB_KEY') || '',
    sub_index: Number(props.getProperty(AM_PIPELINE_PROP_PREFIX + 'SUB_INDEX') || 0),
    sub_total: Number(props.getProperty(AM_PIPELINE_PROP_PREFIX + 'SUB_TOTAL') || 0),
    started_at: props.getProperty(AM_PIPELINE_PROP_PREFIX + 'STARTED_AT') || '',
    updated_at: props.getProperty(AM_PIPELINE_PROP_PREFIX + 'UPDATED_AT') || '',
    failure_count: getWorkflowFailureCount_(AM_PIPELINE_PROP_PREFIX),
    failure_stage: props.getProperty(AM_PIPELINE_PROP_PREFIX + 'FAIL_STAGE') || '',
    failure_blocked: isWorkflowFailureBlocked_(AM_PIPELINE_PROP_PREFIX),
    last_error: props.getProperty(AM_PIPELINE_PROP_PREFIX + 'FAIL_LAST_ERROR') || ''
  };
}

function saveDailyPipelineState_(state) {
  var props = PropertiesService.getScriptProperties();
  props.setProperty(AM_PIPELINE_PROP_PREFIX + 'DATE', state.date || '');
  props.setProperty(AM_PIPELINE_PROP_PREFIX + 'STAGE', state.stage || '');
  props.setProperty(AM_PIPELINE_PROP_PREFIX + 'INDEX', String(state.index || 0));
  setOptionalPipelineProperty_(props, 'SUB_KEY', state.sub_key || '');
  setOptionalPipelineProperty_(props, 'SUB_INDEX', state.sub_key ? String(state.sub_index || 0) : '');
  setOptionalPipelineProperty_(props, 'SUB_TOTAL', state.sub_key ? String(state.sub_total || 0) : '');
  props.setProperty(AM_PIPELINE_PROP_PREFIX + 'STARTED_AT', state.started_at || '');
  props.setProperty(AM_PIPELINE_PROP_PREFIX + 'UPDATED_AT', state.updated_at || amNowString_());
}

function setOptionalPipelineProperty_(props, suffix, value) {
  var key = AM_PIPELINE_PROP_PREFIX + suffix;
  if (value === undefined || value === null || value === '') {
    props.deleteProperty(key);
  } else {
    props.setProperty(key, String(value));
  }
}

function getWorkflowFailureCount_(prefix) {
  return Number(PropertiesService.getScriptProperties().getProperty(prefix + 'FAIL_COUNT') || 0);
}

function isWorkflowFailureBlocked_(prefix) {
  return PropertiesService.getScriptProperties().getProperty(prefix + 'FAIL_BLOCKED') === 'true';
}

function resetWorkflowFailureGuard_(prefix) {
  var props = PropertiesService.getScriptProperties();
  ['FAIL_STAGE', 'FAIL_COUNT', 'FAIL_LAST_ERROR', 'FAIL_UPDATED_AT', 'FAIL_BLOCKED', 'FAIL_NOTIFIED'].forEach(function(suffix) {
    props.deleteProperty(prefix + suffix);
  });
}

function handleWorkflowFailureGuard_(prefix, moduleName, state, continuationHandler, err) {
  var props = PropertiesService.getScriptProperties();
  var stageKey = buildWorkflowFailureStageKey_(state);
  var previousStage = props.getProperty(prefix + 'FAIL_STAGE') || '';
  var count = previousStage === stageKey ? Number(props.getProperty(prefix + 'FAIL_COUNT') || 0) + 1 : 1;
  var errorText = String(err && err.message ? err.message : err).slice(0, 1000);
  props.setProperty(prefix + 'FAIL_STAGE', stageKey);
  props.setProperty(prefix + 'FAIL_COUNT', String(count));
  props.setProperty(prefix + 'FAIL_LAST_ERROR', errorText);
  props.setProperty(prefix + 'FAIL_UPDATED_AT', amNowString_());
  logWarn_(moduleName, 'Workflow failure guard counted a failure', {
    stage: stageKey,
    count: count,
    max: AM_WORKFLOW_MAX_CONSECUTIVE_FAILURES,
    error: errorText
  });
  if (count < AM_WORKFLOW_MAX_CONSECUTIVE_FAILURES) return;
  props.setProperty(prefix + 'FAIL_BLOCKED', 'true');
  deleteTriggersByHandler_(continuationHandler);
  logError_(moduleName, 'Workflow continuation blocked after repeated failures', {
    stage: stageKey,
    count: count,
    handler: continuationHandler,
    error: errorText
  });
  notifyWorkflowFailureGuard_(prefix, moduleName, state, continuationHandler, count, errorText);
}

function buildWorkflowFailureStageKey_(state) {
  if (!state) return 'unknown';
  var parts = [state.stage || 'unknown'];
  if (state.sub_key) parts.push(state.sub_key);
  if (state.dart_index !== undefined && state.dart_index !== '') parts.push('dart_' + state.dart_index);
  return parts.join(':');
}

function notifyWorkflowFailureGuard_(prefix, moduleName, state, continuationHandler, count, errorText) {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty(prefix + 'FAIL_NOTIFIED') === 'true') return;
  props.setProperty(prefix + 'FAIL_NOTIFIED', 'true');
  try {
    var recipient = getReportRecipientEmail_();
    MailApp.sendEmail({
      to: recipient,
      subject: '[AI Scanner] 자동화 반복 실패로 중단됨: ' + moduleName,
      body: [
        'AI Scanner 자동화가 같은 단계에서 반복 실패하여 자동 재시도를 중단했습니다.',
        '',
        '모듈: ' + moduleName,
        '날짜: ' + (state && state.date ? state.date : ''),
        '실패 단계: ' + buildWorkflowFailureStageKey_(state),
        '연속 실패 횟수: ' + count,
        '중단된 이어서 실행 함수: ' + continuationHandler,
        '',
        '마지막 오류:',
        errorText,
        '',
        '다음 조치: logs 시트에서 마지막 ERROR/WARN 행을 확인한 뒤 원인을 해결하고 워크플로우를 수동으로 다시 실행하세요. 새 일일/전체 워크플로우를 시작하면 이 차단 상태는 초기화됩니다.'
      ].join('\n')
    });
  } catch (notifyErr) {
    logWarn_(moduleName, 'Workflow failure notification email failed', {
      error: notifyErr.message || String(notifyErr)
    });
  }
}

function formatDailySubProgress_(state) {
  if (!state || !state.sub_key) return '';
  return ' / ' + formatFinalizeStepKeyKo_(state.sub_key) + ' ' + (state.sub_index || 0) + ' / ' + (state.sub_total || 0);
}

function formatFinalizeStepKeyKo_(key) {
  var map = {
    market_breadth: '시장 폭',
    sector_strength: '섹터 강도',
    etf_holdings: 'ETF 구성종목',
    etf_scores: 'ETF 점수',
    investor_flow: '투자자 수급',
    investor_flow_scores: '투자자 수급 점수',
    leader_scores: '주도주 점수',
    risk_alerts: '위험 신호',
    entry_plan: '진입 계획',
    scenario_daily: '시나리오'
  };
  return map[key] || String(key || '');
}

function getDailyPipelineStatus() {
  var state = getDailyPipelineState_();
  safeUiAlert_([
    '핵심 파이프라인 상태',
    '',
    '날짜: ' + (state.date || '(없음)'),
    '단계: ' + formatStageKo_(state.stage || ''),
    '진행 위치: ' + state.index + formatDailySubProgress_(state),
    '시작: ' + (state.started_at || '(없음)'),
    '업데이트: ' + (state.updated_at || '(없음)')
  ].join('\n'));
  return state;
}

function getDailyPipelineStatusForApi() {
  return getDailyPipelineState_();
}

function buildScenarioDaily_() {
  var today = amTodayString_();
  var macro = getLatestMacroSnapshot_();
  var news = getNewsBriefingForDate_(today);
  var signals = buildScenarioSignals_(macro, news, getMarketBreadthForDate_(today));
  deleteRowsByDate_(AM_CONFIG.SHEETS.SCENARIO_DAILY, today);
  buildRuleBasedScenarioRowsKo_(signals).forEach(function(row) {
    appendObjectRow_(AM_CONFIG.SHEETS.SCENARIO_DAILY, {
      date: today,
      scenario: row.scenario,
      conditions: row.conditions,
      response_plan: row.response_plan
    });
  });
}

function buildScenarioSignals_(macro, newsRows, breadthRows) {
  var byName = {};
  (macro.raw || []).forEach(function(row) {
    byName[row.name] = row;
  });
  var newsScores = { risk_on: 0, risk_off: 0, sector_specific: 0 };
  (newsRows || []).forEach(function(row) {
    var keyNews = ((row.summary || {}).key_news || []);
    keyNews.forEach(function(item) {
      var impact = String(item.impact || '').toLowerCase();
      var score = Number(item.impact_score || inferNewsImpactScore_(impact, item.comment || item.topic || ''));
      newsScores[impact] = Number(newsScores[impact] || 0) + Math.max(1, Math.min(5, score));
    });
  });
  var allBreadth = (breadthRows || []).filter(function(row) {
    return String(row.market || '') === 'ALL';
  })[0] || {};
  return {
    macro_regime: macro.market_regime || 'neutral',
    macro_score: Number(macro.macro_alignment_score || 0),
    us10_change: Number((byName.us_10y_yield || {}).change || 0),
    usd_krw_change_pct: Number((byName.usd_krw || {}).change_pct || 0),
    nasdaq_change_pct: Number((byName.nasdaq_composite || {}).change_pct || 0),
    sp500_change_pct: Number((byName.sp500 || {}).change_pct || 0),
    dow_change_pct: Number((byName.dow_jones || {}).change_pct || 0),
    vix_change_pct: Number((byName.vix || {}).change_pct || 0),
    breadth_score: Number(allBreadth.breadth_score || 0),
    breadth_up_ratio: Number(allBreadth.up_ratio || 0),
    risk_on_news_count: Number(newsScores.risk_on || 0),
    risk_off_news_count: Number(newsScores.risk_off || 0),
    sector_news_count: Number(newsScores.sector_specific || 0)
  };
}

function buildRuleBasedScenarioRows_(signals) {
  var pressure = [];
  var support = [];
  if (signals.us10_change >= 0.03) pressure.push('미국 10년물 금리 상승');
  if (signals.us10_change <= -0.03) support.push('미국 10년물 금리 안정 또는 하락');
  if (signals.usd_krw_change_pct >= 0.3) pressure.push('원/달러 환율 상승');
  if (signals.usd_krw_change_pct <= -0.3) support.push('원/달러 환율 안정 또는 하락');
  if (signals.nasdaq_change_pct <= -0.4) pressure.push('나스닥 약세');
  if (signals.nasdaq_change_pct >= 0.4) support.push('나스닥 강세');
  if (signals.vix_change_pct >= 4) pressure.push('VIX 상승');
  if (signals.vix_change_pct <= -4) support.push('VIX 하락');
  if (signals.risk_off_news_count > signals.risk_on_news_count) pressure.push('뉴스 흐름 위험 회피 우세');
  if (signals.risk_on_news_count > signals.risk_off_news_count) support.push('뉴스 흐름 위험 선호 우세');
  if (signals.sector_news_count > 0) support.push('섹터별 재료 존재');
  return [
    {
      scenario: 'up',
      conditions: joinScenarioParts_(support, '나스닥 반등, 금리와 환율 안정, 주도 섹터 거래대금 유지'),
      response_plan: '상위 후보 중 1차 검토가 근처 눌림 또는 전일 고점 돌파 후 거래대금 유지 종목만 관찰합니다. 장 초반 급등 추격은 피합니다.'
    },
    {
      scenario: 'neutral',
      conditions: '금리, 환율, 나스닥 신호가 엇갈리거나 섹터 순환매가 제한적으로 이어지는 경우',
      response_plan: '신규 검토는 줄이고 재무 안정성, 리스크 낮음, 가격 조건이 맞는 종목만 1차 검토가 중심으로 관찰합니다.'
    },
    {
      scenario: 'down',
      conditions: joinScenarioParts_(pressure, '미국 금리 또는 원/달러 환율 상승, 나스닥 약세, 위험 회피 뉴스 우세'),
      response_plan: '신규 진입 검토를 최소화하고, 기존 관심 후보도 무효화 가격과 현금 비중을 먼저 확인합니다.'
    }
  ];
}

function joinScenarioParts_(parts, fallback) {
  return parts.length > 0 ? parts.join(', ') : fallback;
}

function buildRuleBasedScenarioRowsKo_(signals) {
  var pressure = [];
  var support = [];
  if (signals.us10_change >= 0.03) pressure.push('\ubbf8\uad6d 10\ub144\ubb3c \uae08\ub9ac \uc0c1\uc2b9');
  if (signals.us10_change <= -0.03) support.push('\ubbf8\uad6d 10\ub144\ubb3c \uae08\ub9ac \uc548\uc815 \ub610\ub294 \ud558\ub77d');
  if (signals.usd_krw_change_pct >= 0.3) pressure.push('\uc6d0/\ub2ec\ub7ec \ud658\uc728 \uc0c1\uc2b9');
  if (signals.usd_krw_change_pct <= -0.3) support.push('\uc6d0/\ub2ec\ub7ec \ud658\uc728 \uc548\uc815 \ub610\ub294 \ud558\ub77d');
  if (signals.nasdaq_change_pct <= -0.4) pressure.push('\ub098\uc2a4\ub2e5 \uc57d\uc138');
  if (signals.nasdaq_change_pct >= 0.4) support.push('\ub098\uc2a4\ub2e5 \uac15\uc138');
  if (signals.sp500_change_pct <= -0.6 && signals.dow_change_pct <= -0.4) pressure.push('\ubbf8\uad6d \ub300\ud45c\uc9c0\uc218 \ub3d9\ubc18 \uc57d\uc138');
  if (signals.sp500_change_pct >= 0.6 && signals.dow_change_pct >= 0.4) support.push('\ubbf8\uad6d \ub300\ud45c\uc9c0\uc218 \ub3d9\ubc18 \uac15\uc138');
  if (signals.vix_change_pct >= 4) pressure.push('VIX \uc0c1\uc2b9');
  if (signals.vix_change_pct <= -4) support.push('VIX \ud558\ub77d');
  if (signals.breadth_score && signals.breadth_score < 45) pressure.push('\uc2dc\uc7a5 \ud3ed \uc9c0\ud45c \uc57d\ud654');
  if (signals.breadth_score >= 70) support.push('\uc2dc\uc7a5 \ucc38\uc5ec\ub3c4 \ud655\uc0b0');
  if (signals.risk_off_news_count > signals.risk_on_news_count) pressure.push('\ub274\uc2a4 \ud750\ub984 \uc704\ud5d8 \ud68c\ud53c \uc6b0\uc138');
  if (signals.risk_on_news_count > signals.risk_off_news_count) support.push('\ub274\uc2a4 \ud750\ub984 \uc704\ud5d8 \uc120\ud638 \uc6b0\uc138');
  if (signals.sector_news_count > 0) support.push('\uc139\ud130\ubcc4 \uc7ac\ub8cc \uc874\uc7ac');
  return [
    {
      scenario: 'up',
      conditions: joinScenarioParts_(support, '\ub098\uc2a4\ub2e5 \ubc18\ub4f1, \uae08\ub9ac\uc640 \ud658\uc728 \uc548\uc815, \uc8fc\ub3c4 \uc139\ud130 \uac70\ub798\ub300\uae08 \uc720\uc9c0'),
      response_plan: '\uc0c1\uc704 \ud6c4\ubcf4 \uc911 1\ucc28 \uac80\ud1a0\uac00 \uadfc\ucc98 \ub20c\ub9bc \ub610\ub294 \uc804\uc77c \uace0\uc810 \ub3cc\ud30c \ud6c4 \uac70\ub798\ub300\uae08 \uc720\uc9c0 \uc885\ubaa9\ub9cc \uad00\ucc30\ud569\ub2c8\ub2e4. \uc7a5 \ucd08\ubc18 \uae09\ub4f1 \ucd94\uaca9\uc740 \ud53c\ud569\ub2c8\ub2e4.'
    },
    {
      scenario: 'neutral',
      conditions: '\uae08\ub9ac, \ud658\uc728, \ub098\uc2a4\ub2e5 \uc2e0\ud638\uac00 \uc5c7\uac08\ub9ac\uac70\ub098 \uc139\ud130 \uc21c\ud658\ub9e4\uac00 \uc81c\ud55c\uc801\uc73c\ub85c \uc774\uc5b4\uc9c0\ub294 \uacbd\uc6b0',
      response_plan: '\uc2e0\uaddc \uac80\ud1a0\ub294 \uc904\uc774\uace0 \uc7ac\ubb34 \uc548\uc815\uc131, \ub9ac\uc2a4\ud06c \ub0ae\uc74c, \uac00\uaca9 \uc870\uac74\uc774 \ub9de\ub294 \uc885\ubaa9\ub9cc 1\ucc28 \uac80\ud1a0\uac00 \uc911\uc2ec\uc73c\ub85c \uad00\ucc30\ud569\ub2c8\ub2e4.'
    },
    {
      scenario: 'down',
      conditions: joinScenarioParts_(pressure, '\ubbf8\uad6d \uae08\ub9ac \ub610\ub294 \uc6d0/\ub2ec\ub7ec \ud658\uc728 \uc0c1\uc2b9, \ub098\uc2a4\ub2e5 \uc57d\uc138, \uc704\ud5d8 \ud68c\ud53c \ub274\uc2a4 \uc6b0\uc138'),
      response_plan: '\uc2e0\uaddc \uc9c4\uc785 \uac80\ud1a0\ub97c \ucd5c\uc18c\ud654\ud558\uace0, \uae30\uc874 \uad00\uc2ec \ud6c4\ubcf4\ub3c4 \ubb34\ud6a8\ud654 \uac00\uaca9\uacfc \ud604\uae08 \ube44\uc911\uc744 \uba3c\uc800 \ud655\uc778\ud569\ub2c8\ub2e4.'
    }
  ];
}

function buildScenariosDaily() {
  return withLogging_('scenario_daily', function() {
    buildScenarioDaily_();
    safeUiAlert_('다음 거래일 시나리오 생성 완료\n\n거시지표와 뉴스 흐름을 기준으로 scenario_daily 시트를 갱신했습니다.');
  });
}

function sendDailyEmailReport() {
  return withLogging_('email_report', function() {
    ensureAllSheets_();
    var dateValue = resolveLatestAiReportDate_();
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) {
      logWarn_('email_report', 'Skipped duplicate send because email lock is busy', { date: dateValue });
      return { date: dateValue, skipped: true, reason: 'lock_busy' };
    }
    try {
    if (hasDailyEmailAlreadySent_(dateValue)) {
      logInfo_('email_report', 'Daily email already sent; skipped duplicate', { date: dateValue });
      safeUiAlert_('장마감 메일은 해당 리포트 날짜로 이미 발송되었습니다.\n\n날짜: ' + dateValue + '\n중복 발송을 막기 위해 이번 실행은 건너뜁니다.');
      return { date: dateValue, skipped: true, reason: 'already_sent' };
    }
    var recipient = getReportRecipientEmail_();
    ensureHoldingsAdviceForEmail_(dateValue);
    ensureEntryPlanCoverageForEmail_(dateValue);
    if (dateValue === amTodayString_()) ensureBacktestLogForToday_();
    if (dateValue === amTodayString_()) ensurePremarketResultReviewForToday_();
    var payload = buildEmailReportPayload_(dateValue);
    var subject = '[AI Scanner] ' + dateValue + ' Korean market leader report';
    MailApp.sendEmail({
      to: recipient,
      subject: subject,
      htmlBody: buildEmailReportHtml_(payload),
      body: buildEmailReportText_(payload),
      name: 'AI Market Leader Scanner'
    });
    markDailyEmailSent_(dateValue);
    try {
      sendDailyTelegramReport_(payload, dateValue);
    } catch(errTg) {
      logWarn_('email_report', 'Failed to send daily summary telegram', { error: errTg.message || String(errTg) });
    }
    logInfo_('email_report', 'Daily email report sent', {
      date: dateValue,
      recipient: recipient,
      stocks: payload.stocks.length
    });
    safeUiAlert_([
      '장마감 메일 발송 완료',
      '',
      '날짜: ' + dateValue,
      '받는 사람: ' + recipient,
      '분석 종목 수: ' + payload.stocks.length
    ].join('\n'));
    return payload;
    } finally {
      lock.releaseLock();
    }
  });
}

function ensureHoldingsAdviceForEmail_(dateValue) {
  var target = normalizeDateValue_(dateValue);
  if (target !== amTodayString_()) return;
  try {
    if (!hasConfiguredHoldingsSource_()) return;
    collectHoldingsCurrent();
    if (countRowsByDate_(AM_CONFIG.SHEETS.HOLDINGS_CURRENT, target) > 0) {
      buildHoldingsAdvice();
    }
  } catch (err) {
    logWarn_('email_report', 'Holdings advice refresh skipped before email', {
      date: target,
      error: err.message || String(err)
    });
  }
}

function ensureHoldingsAdviceForPremarket_() {
  var today = amTodayString_();
  try {
    if (!hasConfiguredHoldingsSource_()) return;
    collectHoldingsCurrent();
    if (countRowsByDate_(AM_CONFIG.SHEETS.HOLDINGS_CURRENT, today) > 0) {
      buildHoldingsAdvice();
    }
  } catch (err) {
    logWarn_('premarket_workflow', 'Holdings advice refresh skipped before premarket email', {
      date: today,
      error: err.message || String(err)
    });
  }
}

function hasConfiguredHoldingsSource_() {
  var hasKisAccount = !!getScriptProperty_(AM_CONFIG.PROPERTY_KEYS.KIS_CANO, '') &&
    !!getScriptProperty_(AM_CONFIG.PROPERTY_KEYS.KIS_ACNT_PRDT_CD, '');
  var manualRows = readObjects_(AM_CONFIG.SHEETS.MANUAL_HOLDINGS).filter(function(row) {
    return String(row.active || 'Y').toUpperCase() !== 'N' && normalizeStockSymbol_(row.symbol);
  });
  return hasKisAccount || manualRows.length > 0;
}

function ensureEntryPlanCoverageForEmail_(dateValue) {
  var target = normalizeDateValue_(dateValue);
  if (target !== amTodayString_()) return;
  try {
    var leaders = readObjects_(AM_CONFIG.SHEETS.LEADER_50).filter(function(row) {
      return normalizeDateValue_(row.date) === target;
    }).slice(0, 10);
    if (leaders.length === 0) return;
    var plans = readObjects_(AM_CONFIG.SHEETS.ENTRY_PLAN).filter(function(row) {
      return normalizeDateValue_(row.date) === target;
    });
    var hasMissingPlan = leaders.some(function(row) {
      return !findFirstBySymbol_(plans, row.symbol);
    });
    if (hasMissingPlan || plans.length < Math.min(10, leaders.length)) {
      buildEntryPlan();
      logInfo_('email_report', 'Entry plan rebuilt before email to match current top leaders', {
        date: target,
        leaders: leaders.length,
        previous_plans: plans.length
      });
    }
  } catch (err) {
    logWarn_('email_report', 'Entry plan coverage check skipped before email', {
      date: target,
      error: err.message || String(err)
    });
  }
}

function resolveLatestAiReportDate_() {
  var rows = readObjects_(AM_CONFIG.SHEETS.AI_MARKET_BRIEFING);
  if (rows.length === 0) {
    throw new Error('ai_market_briefing 데이터가 없습니다. Gemini 리포트 생성을 먼저 실행하세요.');
  }
  var today = amTodayString_();
  var todayRows = rows.filter(function(row) {
    return normalizeDateValue_(row.date) === today;
  });
  if (todayRows.length > 0) return today;
  var latest = rows.reduce(function(best, row) {
    if (!best) return row;
    return normalizeDateValue_(row.date) > normalizeDateValue_(best.date) ? row : best;
  }, null);
  return normalizeDateValue_(latest.date);
}

function getReportRecipientEmail_() {
  var propertyEmail = getScriptProperty_(AM_CONFIG.PROPERTY_KEYS.REPORT_EMAIL, '');
  if (propertyEmail) return propertyEmail;
  var activeEmail = Session.getActiveUser().getEmail();
  if (activeEmail) return activeEmail;
  throw new Error('리포트 받을 이메일 주소가 없습니다. Script Property에 REPORT_EMAIL을 추가하세요.');
}

function buildEmailReportPayload_(dateValue) {
  var target = normalizeDateValue_(dateValue);
  ensurePremarketResultReviewForDate_(target);
  var briefingRow = readObjects_(AM_CONFIG.SHEETS.AI_MARKET_BRIEFING).filter(function(row) {
    return normalizeDateValue_(row.date) === target;
  })[0];
  if (!briefingRow) {
    throw new Error('No ai_market_briefing row for ' + target + '.');
  }
  var briefing = parseJsonCell_(briefingRow.briefing_json, {});
  var rawStocks = readObjects_(AM_CONFIG.SHEETS.AI_STOCK_ANALYSIS).filter(function(row) {
    return normalizeDateValue_(row.date) === target;
  }).map(function(row) {
    return parseJsonCell_(row.analysis_json, {
      symbol: normalizeStockSymbol_(row.symbol),
      name: row.name
    });
  });
  var leaders = readObjects_(AM_CONFIG.SHEETS.LEADER_50).filter(function(row) {
    return normalizeDateValue_(row.date) === target;
  });
  var kosdaqLeaders = readObjects_(AM_CONFIG.SHEETS.KOSDAQ_LEADER_50).filter(function(row) {
    return normalizeDateValue_(row.date) === target;
  });
  var plans = readObjects_(AM_CONFIG.SHEETS.ENTRY_PLAN).filter(function(row) {
    return normalizeDateValue_(row.date) === target;
  });
  var risks = readObjects_(AM_CONFIG.SHEETS.RISK_ALERTS).filter(function(row) {
    return normalizeDateValue_(row.date) === target;
  });
  var flows = readObjects_(AM_CONFIG.SHEETS.INVESTOR_FLOW_SCORE).filter(function(row) {
    return normalizeDateValue_(row.date) === target;
  });
  var leaderHistory = readObjects_(AM_CONFIG.SHEETS.LEADER_HISTORY).filter(function(row) {
    return normalizeDateValue_(row.date) === target;
  });
  var backtestRows = readObjects_(AM_CONFIG.SHEETS.BACKTEST_LOG).filter(function(row) {
    return normalizeDateValue_(row.date) === target;
  });
  var premarketReviewRows = readObjects_(AM_CONFIG.SHEETS.PREMARKET_RESULT_REVIEW).filter(function(row) {
    return normalizeDateValue_(row.date) === target;
  });
  var stocks = alignStockAnalysesWithLeaders_(rawStocks, leaders, plans, risks);
  var news = getNewsBriefingForDate_(target);
  var newsScores = getNewsScoresForDate_(target);
  var breadth = getMarketBreadthForDate_(target);
  var macro = getLatestMacroSnapshot_();
  var scenarios = buildRuleBasedScenarioRowsKo_(buildScenarioSignals_(macro, news, breadth));
  return {
    date: target,
    market_calendar: getMarketCalendarSummary_(target),
    briefing: briefing,
    stocks: stocks,
    leaders: leaders,
    kosdaq_leaders: kosdaqLeaders,
    plans: plans,
    risks: risks,
    flows: flows,
    leader_history: leaderHistory,
    backtest_rows: backtestRows,
    premarket_review: premarketReviewRows,
    news: news,
    news_scores: newsScores,
    scenarios: scenarios,
    market_breadth: breadth,
    sectors: getSectorStrengthForDate_(target),
    macro: macro,
    holdings: readObjects_(AM_CONFIG.SHEETS.HOLDINGS_CURRENT).filter(function(row) {
      return normalizeDateValue_(row.date) === target;
    }),
    holdings_advice: readObjects_(AM_CONFIG.SHEETS.HOLDINGS_ADVICE).filter(function(row) {
      return normalizeDateValue_(row.date) === target;
    }),
    portfolio_risks: readObjects_(AM_CONFIG.SHEETS.PORTFOLIO_RISK).filter(function(row) {
      return normalizeDateValue_(row.date) === target;
    }),
    account_snapshot: readObjects_(AM_CONFIG.SHEETS.ACCOUNT_SNAPSHOT).filter(function(row) {
      return normalizeDateValue_(row.date) === target;
    })[0] || null,
    paper_portfolio: readObjects_(AM_CONFIG.SHEETS.PAPER_PORTFOLIO).filter(function(row) {
      return normalizeDateValue_(row.date) === target;
    })[0] || getLatestPaperPortfolioRow_(),
    paper_trades: (function() {
      var trades = readObjects_(AM_CONFIG.SHEETS.PAPER_LEDGER);
      trades.sort(function(a, b) {
        return String(b.date).localeCompare(String(a.date)) || String(b.created_at || '').localeCompare(String(a.created_at || ''));
      });
      return trades.slice(0, 5);
    })()
  };
}

function alignStockAnalysesWithLeaders_(stocks, leaders, plans, risks) {
  return (leaders || []).slice(0, 10).map(function(leader) {
    var existing = findFirstBySymbol_(stocks || [], leader.symbol);
    if (existing) {
      existing.symbol = normalizeStockSymbol_(existing.symbol || leader.symbol);
      existing.name = existing.name || leader.name;
      return existing;
    }
    return buildRuleBasedStockAnalysisForEmail_(leader, findFirstBySymbol_(plans || [], leader.symbol) || {}, risks || []);
  });
}

function buildRuleBasedStockAnalysisForEmail_(leader, plan, risks) {
  var symbol = normalizeStockSymbol_(leader.symbol);
  var stockRisks = (risks || []).filter(function(row) {
    return normalizeStockSymbol_(row.symbol) === symbol;
  });
  var riskComment = stockRisks.length > 0
    ? stockRisks[0].message
    : '특이 위험 공시는 없지만 시장 변동성과 거래대금 유지 여부를 확인해야 합니다.';
  return {
    symbol: symbol,
    name: leader.name,
    scenario: 'conditional_watch',
    summary: leader.name + '은 현재 주도주 순위 ' + leader.rank + '위, 총점 ' + leader.total_score + '점 기준의 조건부 관찰 후보입니다.',
    expert_view: '현재 점수, 차트, 리스크, 가격 계획을 기준으로 보되 신규 진입은 시나리오 조건이 맞을 때만 검토합니다.',
    beginner_action: plan.first_entry_price
      ? '현재가를 쫓기보다 1차 검토가 ' + formatNumber_(plan.first_entry_price) + ' 부근 반응과 거래대금 유지 여부를 먼저 확인합니다.'
      : '가격 계획이 없으면 신규 검토보다 관찰만 우선합니다.',
    risk_comment: [riskComment],
    valid_conditions: [
      plan.invalid_price ? '무효화 가격 ' + formatNumber_(plan.invalid_price) + ' 위에서 유지' : '단기 지지선 유지',
      '거래대금 유지',
      '같은 섹터 동반 강세'
    ],
    avoid_conditions: [
      '장 초반 급등 추격',
      plan.invalid_price ? '무효화 가격 이탈 후 방치' : '가격 조건 없이 추격',
      '거래대금 급감'
    ],
    check_points: [
      plan.first_entry_price ? '1차 검토가 ' + formatNumber_(plan.first_entry_price) + ' 부근 반응' : '가격 계획 재확인',
      '20일선 유지 여부',
      '거래대금과 섹터 동반 강세'
    ]
  };
}

function buildEmailReportHtml_(payload) {
  var regime = payload.macro.market_regime || payload.briefing.market_regime || 'neutral';
  return [
    '<div style="font-family:Arial,Apple SD Gothic Neo,Malgun Gothic,sans-serif;color:#111827;max-width:1040px">',
    '<h1 style="font-size:24px;margin:0 0 6px">' + ko_('report_title') + '</h1>',
    '<div style="color:#6b7280;margin-bottom:18px">' + escapeHtml_(payload.date) + '</div>',
    buildExecutiveSummaryHtml_(payload, regime),
    '<h2 style="font-size:18px;margin:22px 0 8px">세부 분석</h2>',
    '<div style="border:1px solid #d1d5db;border-radius:8px;padding:14px;margin:0 0 16px;background:#f9fafb">',
    '<div style="font-size:13px;color:#6b7280;margin-bottom:6px">' + ko_('beginner_quick_read') + '</div>',
    '<div style="font-size:17px;margin-bottom:8px">' + buildRegimeBadge_(regime) + ' <strong>' + ko_('macro_score') + ' ' + escapeHtml_(payload.macro.macro_alignment_score || '') + '/10</strong></div>',
    '<p style="line-height:1.6;margin:0">' + escapeHtml_(payload.briefing.summary || '') + '</p>',
    '</div>',
    buildExpertAdviceHtml_(payload),
    buildMarketCalendarNoticeHtml_(payload.market_calendar),
    buildBeginnerSummaryHtml_(payload, regime),
    buildNewsBriefingHtml_(payload.news || []),
    buildNewsScoreHtml_(payload.news_scores || []),
    buildMarketBreadthHtml_(payload.market_breadth || []),
    buildSectorStrengthHtml_(payload.sectors || []),
    buildMacroTableHtml_(payload.macro.raw || []),
    '<h2 style="font-size:18px;margin:22px 0 8px">' + ko_('top10_summary') + '</h2>',
    buildTopLeaderCardsHtml_(payload, regime),
    buildLeaderHistorySummaryHtml_(payload),
    buildBacktestSummaryHtml_(payload),
    buildPremarketResultReviewHtml_(payload),
    buildKosdaqLeaderSectionHtml_(payload),
    '<h2 style="font-size:18px;margin:22px 0 8px">' + ko_('next_scenarios') + '</h2>',
    buildScenarioCardsHtml_(payload),
    '<h2 style="font-size:18px;margin:22px 0 8px">' + ko_('stock_notes') + '</h2>',
    buildStockAnalysisCardsHtml_(payload),
    buildHoldingsAdviceHtml_(payload),
    buildPaperTradingHtml_(payload),
    '<p style="font-size:12px;color:#6b7280;line-height:1.5;border-top:1px solid #e5e7eb;padding-top:12px">' + ko_('report_disclaimer') + '</p>',
    '</div>'
  ].join('');
}

function buildExecutiveSummaryHtml_(payload, regime) {
  var summary = buildExecutiveSummaryData_(payload, regime);
  return '<div style="border:1px solid #bfdbfe;border-radius:8px;background:#eff6ff;padding:14px;margin:0 0 16px">' +
    '<div style="font-size:13px;color:#1d4ed8;font-weight:700;margin-bottom:6px">상단 1분 요약</div>' +
    '<div style="font-size:19px;line-height:1.35;font-weight:800;margin-bottom:8px">' + escapeHtml_(summary.headline) + '</div>' +
    '<div style="font-size:13px;line-height:1.6;color:#374151;margin-bottom:10px">' + escapeHtml_(summary.subline) + '</div>' +
    '<div style="margin:0 0 10px">' +
      buildExecutiveMetricPillHtml_('시장 자세', summary.stance) +
      buildExecutiveMetricPillHtml_('뉴스', summary.news_tone) +
      buildExecutiveMetricPillHtml_('시장 폭', summary.breadth_tone) +
      buildExecutiveMetricPillHtml_('리스크', summary.risk_tone) +
    '</div>' +
    buildExecutiveMiniSectionHtml_('왜 이렇게 보나', summary.reasons) +
    buildExecutiveMiniSectionHtml_('오늘 먼저 볼 것', summary.watch_items) +
    buildExecutiveMiniSectionHtml_('오늘 피할 것', summary.avoid_items) +
    buildExecutiveMiniSectionHtml_('아침 전망 사후검증', summary.premarket_review) +
    buildExecutiveMiniSectionHtml_('내 보유종목 한줄 점검', summary.holding_items) +
    '</div>';
}

function buildExecutiveMetricPillHtml_(label, value) {
  return '<span style="display:inline-block;box-sizing:border-box;width:48%;min-width:230px;border:1px solid #dbeafe;border-radius:8px;background:#ffffff;padding:9px;margin:0 1% 8px 0;vertical-align:top">' +
    '<span style="display:block;font-size:12px;color:#6b7280;margin-bottom:3px">' + escapeHtml_(label) + '</span>' +
    '<strong style="font-size:13px;line-height:1.4">' + escapeHtml_(value || '-') + '</strong>' +
    '</span>';
}

function buildExecutiveMiniSectionHtml_(title, items) {
  var list = normalizeTextList_(items).slice(0, 4);
  if (list.length === 0) return '';
  return '<div style="border-top:1px solid #dbeafe;padding-top:9px;margin-top:8px">' +
    '<div style="font-size:13px;font-weight:800;color:#1f2937;margin-bottom:5px">' + escapeHtml_(title) + '</div>' +
    list.map(function(item) {
      return '<div style="font-size:13px;line-height:1.55;margin:0 0 4px">- ' + escapeHtml_(item) + '</div>';
    }).join('') +
    '</div>';
}

function buildExecutiveSummaryData_(payload, regime) {
  var leaders = payload.leaders || [];
  var sectors = payload.sectors || [];
  var kosdaqLeaders = payload.kosdaq_leaders || [];
  var breadthAll = findBreadthRowForSummary_(payload.market_breadth || [], 'ALL');
  var netNews = sumNewsScoreForSummary_(payload.news_scores || []);
  var highRiskCount = leaders.filter(function(row) {
    return String(row.risk_level || '').toLowerCase() === 'high';
  }).length;
  var premarketReview = getFirstPremarketReviewRow_(payload);
  var topNames = leaders.slice(0, 3).map(function(row) {
    return row.name;
  }).filter(Boolean);
  var topKosdaqNames = kosdaqLeaders.slice(0, 3).map(function(row) {
    return row.name;
  }).filter(Boolean);
  var topSectorNames = sectors.slice(0, 3).map(function(row) {
    return row.sector;
  }).filter(Boolean);
  var headline = buildExecutiveHeadline_(payload, regime, netNews, breadthAll, topSectorNames);
  var subline = '오늘 리포트는 위에서 핵심 결론을 먼저 보고, 아래 세부 분석에서 뉴스·거시·섹터·종목별 가격 조건을 확인하는 구조입니다.';
  return {
    headline: headline,
    subline: subline,
    stance: buildMarketStanceText_(regime) + ' / 거시 ' + (payload.macro.macro_alignment_score || '-') + '/10',
    news_tone: formatNewsToneForSummary_(netNews),
    breadth_tone: formatBreadthToneForSummary_(breadthAll),
    risk_tone: highRiskCount ? '고위험 후보 ' + highRiskCount + '개, 관찰 강도 조절' : '상위 후보 고위험 부담 낮음',
    reasons: buildExecutiveReasonItems_(payload, netNews, breadthAll, topSectorNames),
    watch_items: buildExecutiveWatchItems_(leaders, topNames, topKosdaqNames, topSectorNames),
    avoid_items: buildExecutiveAvoidItems_(regime, highRiskCount, payload),
    holding_items: buildExecutiveHoldingItems_(payload),
    premarket_review: premarketReview ? [
      '장전 예측 검증: ' + premarketReview.prediction_score + '/100',
      premarketReview.summary || ''
    ] : []
  };
}

function buildExecutiveHeadline_(payload, regime, netNews, breadthAll, topSectorNames) {
  var stance = buildMarketStanceText_(regime);
  var sectorText = topSectorNames.length > 0 ? topSectorNames.slice(0, 2).join(', ') : '상위 섹터';
  if (String(regime || '').toLowerCase() === 'risk_on' || netNews >= 5) {
    return '위험 선호 재료는 우호적이지만, 추격보다 ' + sectorText + ' 중심의 조건 확인이 우선입니다.';
  }
  if (String(regime || '').toLowerCase() === 'risk_off' || netNews <= -5) {
    return '방어 우선 장세입니다. 신규 진입보다 무효화 가격과 보유 비중 점검이 먼저입니다.';
  }
  if (breadthAll && Number(breadthAll.up_ratio || 0) >= 70 && Number(breadthAll.ma20_above_ratio || 0) < 40) {
    return '상승 종목은 많지만 중기 추세는 아직 약해 선별 관찰이 필요합니다.';
  }
  return stance + ' 장세입니다. 상위 주도주도 가격 조건이 맞을 때만 봅니다.';
}

function buildExecutiveReasonItems_(payload, netNews, breadthAll, topSectorNames) {
  var items = [];
  items.push(formatNewsToneForSummary_(netNews));
  if (topSectorNames.length > 0) {
    items.push('강한 섹터: ' + topSectorNames.slice(0, 3).join(', '));
  }
  if (breadthAll) {
    items.push('시장 폭: 상승비율 ' + formatPercentText_(breadthAll.up_ratio) + ', 20일선 위 ' + formatPercentText_(breadthAll.ma20_above_ratio));
  }
  var macroRows = (payload.macro || {}).raw || [];
  var nasdaq = findMacroRowForSummary_(macroRows, 'nasdaq_composite');
  var us10 = findMacroRowForSummary_(macroRows, 'us_10y_yield');
  var usdKrw = findMacroRowForSummary_(macroRows, 'usd_krw');
  var macroParts = [];
  if (nasdaq) macroParts.push('나스닥 ' + formatPercentText_(nasdaq.change_pct));
  if (us10) macroParts.push('미 10년물 ' + formatMacroNumber_(us10.value));
  if (usdKrw) macroParts.push('환율 ' + formatMacroNumber_(usdKrw.value));
  if (macroParts.length > 0) items.push('거시 체크: ' + macroParts.join(' / '));
  return items;
}

function buildExecutiveWatchItems_(leaders, topNames, topKosdaqNames, topSectorNames) {
  var items = [];
  if (topNames.length > 0) items.push('전체 TOP 후보: ' + topNames.join(', '));
  if (topKosdaqNames.length > 0) items.push('코스닥 후보: ' + topKosdaqNames.join(', '));
  if (topSectorNames.length > 0) items.push('섹터 동반 강세가 유지되는지 확인: ' + topSectorNames.slice(0, 3).join(', '));
  if (leaders.length > 0) items.push('각 종목은 1차 검토가, 돌파가, 무효화 가격 순서로만 확인합니다.');
  return items;
}

function buildExecutiveAvoidItems_(regime, highRiskCount, payload) {
  var items = [
    '장 초반 급등 추격매수',
    '무효화 가격 아래에서 물타기',
    '거래대금이 줄어드는 종목의 신규 검토'
  ];
  if (String(regime || '').toLowerCase() === 'risk_off') {
    items.unshift('방어 우선 장세에서 신규 후보를 많이 늘리는 행동');
  }
  if (highRiskCount > 0) {
    items.push('고위험 후보 ' + highRiskCount + '개는 관찰만 하거나 비중을 낮게 봅니다.');
  }
  if ((payload.flows || []).length === 0) {
    items.push('수급 미수집 상태에서 외국인/기관 방향을 단정하지 않습니다.');
  }
  return items;
}

function buildExecutiveHoldingItems_(payload) {
  var holdings = payload.holdings || [];
  var risks = payload.portfolio_risks || [];
  var advice = payload.holdings_advice || [];
  var items = [];
  if (risks.length > 0) {
    items.push(risks[0].message || '');
  }
  holdings.slice().sort(function(a, b) {
    return Number(b.portfolio_weight_pct || 0) - Number(a.portfolio_weight_pct || 0);
  }).slice(0, 2).forEach(function(row) {
    var adviceRow = findFirstBySymbol_(advice, row.symbol) || {};
    var action = adviceRow.action_view ? ko_('holding_action_' + String(adviceRow.action_view || '').toLowerCase()) : '점검';
    items.push((row.name || '') + ': 비중 ' + formatPercentText_(row.portfolio_weight_pct) + ', 손익률 ' + formatPercentText_(row.profit_loss_pct) + ', 판단 ' + action);
  });
  if (items.length === 0) {
    items.push('등록된 보유종목이 없으면 이 영역은 생략됩니다.');
  }
  return items.filter(function(item) {
    return String(item || '').trim() !== '';
  });
}

function findBreadthRowForSummary_(rows, market) {
  var target = String(market || 'ALL');
  for (var i = 0; i < rows.length; i += 1) {
    if (String(rows[i].market || '') === target) return rows[i];
  }
  return rows[0] || null;
}

function sumNewsScoreForSummary_(rows) {
  return (rows || []).reduce(function(sum, row) {
    return sum + Number(row.net_news_score || 0);
  }, 0);
}

function formatNewsToneForSummary_(netNews) {
  if (netNews >= 5) return '뉴스 우호 우세, 순뉴스점수 +' + netNews;
  if (netNews <= -5) return '뉴스 부담 우세, 순뉴스점수 ' + netNews;
  return '뉴스 혼조 또는 중립, 순뉴스점수 ' + netNews;
}

function formatBreadthToneForSummary_(row) {
  if (!row) return '시장 폭 데이터 없음';
  return '상승 ' + formatPercentText_(row.up_ratio) + ' / 20일선 위 ' + formatPercentText_(row.ma20_above_ratio);
}

function findMacroRowForSummary_(rows, name) {
  for (var i = 0; i < (rows || []).length; i += 1) {
    if (String(rows[i].name || '') === name) return rows[i];
  }
  return null;
}

function buildLeaderHistorySummaryHtml_(payload) {
  var rows = payload.leader_history || [];
  if (rows.length === 0) return '';
  var overall = rows.filter(function(row) {
    return String(row.list_type || '') === 'overall';
  });
  var kosdaq = rows.filter(function(row) {
    return String(row.list_type || '') === 'kosdaq';
  });
  var html = buildLeaderHistoryListBlockHtml_('전체 TOP50 변화', overall) +
    buildLeaderHistoryListBlockHtml_('코스닥 TOP50 변화', kosdaq);
  if (!html) return '';
  return '<h2 style="font-size:18px;margin:22px 0 8px">주도주 변화</h2>' + html;
}

function buildLeaderHistoryListBlockHtml_(title, rows) {
  if (!rows || rows.length === 0) return '';
  var newRows = filterLeaderHistoryByStatus_(rows, '신규').slice(0, 5);
  var upRows = filterLeaderHistoryByStatus_(rows, '상승').sort(sortLeaderHistoryByRankChangeDesc_).slice(0, 5);
  var downRows = filterLeaderHistoryByStatus_(rows, '하락').sort(sortLeaderHistoryByRankChangeAsc_).slice(0, 5);
  var exitRows = filterLeaderHistoryByStatus_(rows, '이탈').slice(0, 5);
  return '<div style="border:1px solid #d1d5db;border-radius:8px;background:#ffffff;padding:12px;margin:0 0 10px">' +
    '<div style="font-weight:700;margin-bottom:8px">' + escapeHtml_(title) + '</div>' +
    buildLeaderHistoryMiniListHtml_('신규 편입', newRows) +
    buildLeaderHistoryMiniListHtml_('순위 상승', upRows) +
    buildLeaderHistoryMiniListHtml_('순위 하락', downRows) +
    buildLeaderHistoryMiniListHtml_('이탈', exitRows) +
    '</div>';
}

function buildLeaderHistoryMiniListHtml_(label, rows) {
  if (!rows || rows.length === 0) return '';
  return '<div style="font-size:13px;line-height:1.5;margin:0 0 8px">' +
    '<span style="display:block;color:#6b7280;font-weight:700;margin-bottom:3px">' + escapeHtml_(label) + '</span>' +
    rows.map(function(row) {
      return '<div style="border-top:1px solid #f3f4f6;padding:5px 0">' +
        '<strong>' + escapeHtml_(row.name || '') + '</strong> ' +
        '<span style="color:#6b7280">' + escapeHtml_(normalizeStockSymbol_(row.symbol)) + '</span>' +
        ' <span style="color:#6b7280">' + formatLeaderHistoryRankText_(row) + '</span>' +
        '</div>';
    }).join('') +
    '</div>';
}

function filterLeaderHistoryByStatus_(rows, status) {
  return (rows || []).filter(function(row) {
    return String(row.status || '') === status;
  });
}

function sortLeaderHistoryByRankChangeDesc_(a, b) {
  return Number(b.rank_change || 0) - Number(a.rank_change || 0);
}

function sortLeaderHistoryByRankChangeAsc_(a, b) {
  return Number(a.rank_change || 0) - Number(b.rank_change || 0);
}

function formatLeaderHistoryRankText_(row) {
  var status = String(row.status || '');
  if (status === '신규') return '현재 ' + row.rank + '위';
  if (status === '이탈') return '전일 ' + row.previous_rank + '위';
  if (row.previous_rank && row.rank) {
    return row.previous_rank + '위 → ' + row.rank + '위';
  }
  return '';
}

function buildBacktestSummaryHtml_(payload) {
  var rows = payload.backtest_rows || [];
  if (rows.length === 0) return '';
  var baseDate = normalizeDateValue_(rows[0].base_date);
  var overall = rows.filter(function(row) {
    return String(row.list_type || '') === 'overall';
  });
  var kosdaq = rows.filter(function(row) {
    return String(row.list_type || '') === 'kosdaq';
  });
  return '<h2 style="font-size:18px;margin:22px 0 8px">전일 리포트 사후검증</h2>' +
    '<div style="font-size:12px;color:#6b7280;line-height:1.5;margin:0 0 8px">' +
    escapeHtml_(baseDate) + ' 리포트의 조건부 가격이 다음 거래일에 실제로 어떻게 움직였는지 확인한 기록입니다. 추천 적중률이 아니라 시스템 품질 점검용입니다.' +
    '</div>' +
    buildBacktestGroupHtml_('전체 TOP 검증', overall) +
    buildBacktestGroupHtml_('코스닥 TOP 검증', kosdaq);
}

function buildPremarketResultReviewHtml_(payload) {
  var row = getFirstPremarketReviewRow_(payload);
  if (!row) return '';
  var detail = parseJsonCell_(row.detail_json, {});
  var watchDetails = (detail.watch_details || []).slice(0, 6);
  var sectorReview = detail.sector_review || {};
  var statCards = [
    ['예측 검증 점수', (row.prediction_score || 0) + '/100'],
    ['시장 방향 점수', (row.bias_score || 0) + '/100'],
    ['관찰 후보 상승', (row.watch_positive_count || 0) + ' / ' + (row.watch_count || 0)],
    ['후보 평균 수익률', formatPercentText_(row.watch_avg_return_pct)]
  ].map(function(item) {
    return '<span style="display:inline-block;width:48%;box-sizing:border-box;border-top:1px solid #f3f4f6;padding:7px 0;font-size:13px">' +
      '<span style="display:block;color:#6b7280">' + escapeHtml_(item[0]) + '</span>' +
      '<strong>' + escapeHtml_(item[1]) + '</strong>' +
      '</span>';
  }).join('');
  var watchHtml = watchDetails.map(function(item) {
    var color = Number(item.return_pct || 0) >= 0 ? '#047857' : '#b91c1c';
    return '<div style="border-top:1px solid #f3f4f6;padding:8px 0;font-size:13px;line-height:1.5">' +
      '<div><strong>' + escapeHtml_(item.name || '') + '</strong> <span style="color:#6b7280">' + escapeHtml_(normalizeStockSymbol_(item.symbol)) + '</span></div>' +
      '<div>결과: <strong>' + escapeHtml_(item.result || '-') + '</strong> / 수익률: <strong style="color:' + color + '">' + escapeHtml_(formatPercentText_(item.return_pct)) + '</strong></div>' +
      '<div style="color:#6b7280">아침 체크: ' + escapeHtml_(truncateText_(item.first_check || '', 90)) + '</div>' +
      '</div>';
  }).join('');
  var sectorText = '';
  if ((sectorReview.actual_top_sectors || []).length > 0) {
    sectorText = '<div style="font-size:13px;color:#374151;line-height:1.5;margin-top:8px">' +
      '실제 강한 섹터: <strong>' + escapeHtml_((sectorReview.actual_top_sectors || []).slice(0, 5).join(', ')) + '</strong><br>' +
      '아침 섹터 관찰과 일치: <strong>' + escapeHtml_((sectorReview.matched_sectors || []).join(', ') || '-') + '</strong>' +
      '</div>';
  }
  return '<h2 style="font-size:18px;margin:22px 0 8px">장전 예측 사후검증</h2>' +
    '<div style="border:1px solid #d1d5db;border-radius:8px;background:#ffffff;padding:12px;margin:0 0 10px">' +
    '<div style="font-size:12px;color:#6b7280;line-height:1.5;margin-bottom:8px">아침 장전 브리핑이 실제 장마감 결과와 얼마나 비슷했는지 확인합니다. 투자 성과가 아니라 예측 품질 개선용 기록입니다.</div>' +
    '<div style="font-size:13px;line-height:1.55;margin-bottom:8px"><strong>' + escapeHtml_(row.summary || '') + '</strong></div>' +
    '<div style="margin-bottom:8px">' + statCards + '</div>' +
    sectorText +
    watchHtml +
    '</div>';
}

function getFirstPremarketReviewRow_(payload) {
  var rows = payload.premarket_review || [];
  return rows.length > 0 ? rows[0] : null;
}

function buildBacktestGroupHtml_(title, rows) {
  if (!rows || rows.length === 0) return '';
  var summary = summarizeBacktestRows_(rows);
  var statCards = [
    ['평균 다음 종가', formatPercentText_(summary.avg_return_pct)],
    ['1차 도달', summary.first_entry_hits + '개'],
    ['돌파 도달', summary.breakout_hits + '개'],
    ['무효화 터치', summary.invalid_hits + '개']
  ].map(function(item) {
    return '<span style="display:inline-block;width:48%;box-sizing:border-box;border-top:1px solid #f3f4f6;padding:7px 0;font-size:13px">' +
      '<span style="display:block;color:#6b7280">' + escapeHtml_(item[0]) + '</span>' +
      '<strong>' + escapeHtml_(item[1]) + '</strong>' +
      '</span>';
  }).join('');
  var detailCards = rows.slice(0, 6).map(function(row) {
    return '<div style="border-top:1px solid #f3f4f6;padding:8px 0;font-size:13px;line-height:1.5">' +
      '<div><strong>' + escapeHtml_(row.rank + '. ' + (row.name || '')) + '</strong> <span style="color:#6b7280">' + escapeHtml_(normalizeStockSymbol_(row.symbol)) + '</span></div>' +
      '<div style="color:#374151">결과: <strong>' + escapeHtml_(row.result || '-') + '</strong> / 다음 종가: ' + escapeHtml_(formatBacktestReturnText_(row.next_return_pct)) + '</div>' +
      '<div style="color:#6b7280">' + escapeHtml_(row.memo || '') + '</div>' +
      '</div>';
  }).join('');
  return '<div style="border:1px solid #d1d5db;border-radius:8px;background:#ffffff;padding:12px;margin:0 0 10px">' +
    '<div style="font-weight:700;margin-bottom:8px">' + escapeHtml_(title) + '</div>' +
    '<div style="margin-bottom:8px">' + statCards + '</div>' +
    detailCards +
    '</div>';
}

function formatBacktestReturnText_(value) {
  if (value === '' || value === undefined || value === null) return '-';
  return formatPercentText_(value);
}

function buildExpertAdviceHtml_(payload) {
  var briefing = payload.briefing || {};
  var blocks = [
    buildExpertAdviceBlockHtml_('전문가 핵심 판단', briefing.expert_takeaways || []),
    buildExpertAdviceBlockHtml_('초보자 오늘 행동', briefing.beginner_actions || []),
    buildExpertAdviceBlockHtml_('하지 말 것', briefing.avoid_actions || []),
    buildExpertAdviceBlockHtml_('데이터 주의점', briefing.data_quality_notes || [])
  ].filter(function(html) {
    return !!html;
  }).join('');
  if (!blocks) return '';
  return '<h2 style="font-size:18px;margin:22px 0 8px">전문가 조언 요약</h2>' +
    '<div style="border:1px solid #d1d5db;border-radius:8px;background:#ffffff;padding:12px;margin-bottom:14px">' +
    blocks +
    '</div>';
}

function buildExpertAdviceBlockHtml_(title, items) {
  var list = normalizeTextList_(items);
  if (list.length === 0) return '';
  return '<div style="margin:0 0 10px">' +
    '<div style="font-weight:700;margin-bottom:4px">' + escapeHtml_(title) + '</div>' +
    '<ul style="margin:0;padding-left:18px;line-height:1.55;font-size:13px">' +
    list.slice(0, 4).map(function(item) {
      return '<li>' + escapeHtml_(item) + '</li>';
    }).join('') +
    '</ul>' +
    '</div>';
}

function buildNewsScoreHtml_(rows) {
  if (!rows || rows.length === 0) return '';
  var cards = rows.map(function(row) {
    return '<div style="border:1px solid #e5e7eb;border-radius:8px;background:#ffffff;padding:10px;margin:0 0 8px;font-size:13px;line-height:1.5">' +
      '<div style="font-weight:700">' + escapeHtml_(formatNewsSessionKo_(row.session)) + ' 뉴스 점수</div>' +
      '<div style="margin-top:5px">' +
        '<span style="color:#6b7280">우호:</span> <strong>' + escapeHtml_(row.risk_on_score || 0) + '</strong> &nbsp; ' +
        '<span style="color:#6b7280">부담:</span> <strong>' + escapeHtml_(row.risk_off_score || 0) + '</strong> &nbsp; ' +
        '<span style="color:#6b7280">순점수:</span> <strong>' + escapeHtml_(row.net_news_score || 0) + '</strong>' +
      '</div>' +
      '<div style="color:#6b7280;margin-top:4px">' + escapeHtml_(row.memo || '') + '</div>' +
      '</div>';
  }).join('');
  return '<h2 style="font-size:18px;margin:22px 0 8px">뉴스 영향 점수</h2>' + cards;
}

function formatNewsSessionKo_(session) {
  if (session === 'korea_close') return '국내 마감';
  if (session === 'us_close') return '미국 마감';
  return String(session || '');
}

function buildNewsBriefingHtml_(newsRows) {
  if (!newsRows || newsRows.length === 0) return '';
  var blocks = newsRows.map(function(row) {
    var summary = row.summary || {};
    var keyNews = summary.key_news || [];
    if (keyNews.length === 0) {
      keyNews = [buildEmptyNewsItem_(row.session)];
      if (!summary.headline_summary) {
        summary.headline_summary = '\uad6d\ub0b4 \ub9c8\uac10 \ub274\uc2a4 \uc694\uc57d\uc774 \ube44\uc5b4 \uc788\uc2b5\ub2c8\ub2e4. \uc624\ub298 \ub9ac\ud3ec\ud2b8\ub294 \uac70\uc2dc \uc9c0\ud45c, \uc139\ud130 \uac15\ub3c4, \uc885\ubaa9 \uc810\uc218\ub97c \uc6b0\uc120 \uae30\uc900\uc73c\ub85c \ud574\uc11d\ud569\ub2c8\ub2e4.';
      }
    }
    var rows = keyNews.slice(0, 5).map(function(item) {
      return '<div style="border:1px solid #e5e7eb;border-radius:8px;padding:9px;margin:0 0 8px;background:#ffffff;font-size:13px;line-height:1.5">' +
        '<div><strong>' + escapeHtml_(item.topic || '') + '</strong></div>' +
        '<div style="color:#6b7280;margin:2px 0">' + ko_('impact') + ': ' + escapeHtml_(item.impact || '') + ' / ' + ko_('related_sectors') + ': ' + escapeHtml_((item.affected_sectors || []).join(', ')) + '</div>' +
        '<div>' + escapeHtml_(item.comment || '') + '</div>' +
        '</div>';
    }).join('');
    return '<h3 style="font-size:15px;margin:14px 0 6px">' + escapeHtml_(row.session) + '</h3>' +
      '<p style="margin:0 0 8px;line-height:1.55">' + escapeHtml_(summary.headline_summary || '') + '</p>' +
      rows +
      buildSourcesHtml_(row.sources || []);
  }).join('');
  return '<h2 style="font-size:18px;margin:22px 0 8px">' + ko_('market_news_brief') + '</h2>' + blocks;
}

function buildEmptyNewsItem_(session) {
  return {
    topic: session === 'korea_close' ? '\uad6d\ub0b4 \ub274\uc2a4 \uc694\uc57d \uc5c6\uc74c' : '\ub274\uc2a4 \uc694\uc57d \uc5c6\uc74c',
    impact: 'neutral',
    affected_sectors: ['\uc804\ubc18'],
    comment: 'Search Grounding \uacb0\uacfc\uac00 \ube44\uc5b4 \uc788\uc5b4 \ubcf4\uc218\uc801\uc73c\ub85c \uc911\ub9bd \ucc98\ub9ac\ud588\uc2b5\ub2c8\ub2e4.'
  };
}

function buildSourcesHtml_(sources) {
  if (!sources || sources.length === 0) return '';
  var links = sources.slice(0, 5).map(function(source, index) {
    return '<a href="' + escapeHtml_(source.uri) + '" style="color:#2563eb;text-decoration:none">[' + (index + 1) + '] ' + escapeHtml_(truncateText_(source.title || source.uri, 50)) + '</a>';
  }).join(' &nbsp; ');
  return '<div style="font-size:12px;color:#6b7280;margin:4px 0 12px">' + ko_('sources') + ': ' + links + '</div>';
}

function buildBeginnerSummaryHtml_(payload, regime) {
  var leaders = payload.leaders || [];
  var sectors = payload.sectors || [];
  var topNames = leaders.slice(0, 3).map(function(row) {
    return escapeHtml_(row.name || '');
  }).join(', ');
  var sectorNames = sectors.slice(0, 3).map(function(row) {
    return escapeHtml_(row.sector || '');
  }).join(', ');
  var highRiskCount = leaders.filter(function(row) {
    return String(row.risk_level || '').toLowerCase() === 'high';
  }).length;
  var summaryRows = [
    [ko_('market_stance'), buildMarketStanceText_(regime)],
    [ko_('strong_sectors'), sectorNames || '-'],
    [ko_('first_watch'), topNames || '-'],
    [ko_('risk_check'), highRiskCount ? ko_('high_risk_exists') + ' ' + highRiskCount + ko_('count_suffix') : ko_('no_high_risk_top10')]
  ];
  return '<h2 style="font-size:18px;margin:22px 0 8px">' + ko_('today_conclusion') + '</h2>' +
    '<div style="margin:0 0 14px">' +
    summaryRows.map(function(item) {
      return '<div style="border:1px solid #e5e7eb;border-radius:8px;background:#ffffff;padding:10px;margin:0 0 8px;font-size:13px;line-height:1.5">' +
        '<div style="font-weight:700;color:#374151;margin-bottom:3px">' + escapeHtml_(item[0]) + '</div>' +
        '<div>' + escapeHtml_(item[1]) + '</div>' +
        '</div>';
    }).join('') +
    '</div>';
}

function buildMarketStanceText_(regime) {
  var value = String(regime || 'neutral').toLowerCase();
  if (value === 'risk_on') return ko_('stance_attack');
  if (value === 'risk_off') return ko_('stance_defense');
  return ko_('stance_selective');
}

function buildTopLeaderCardsHtml_(payload, regime) {
  return payload.leaders.slice(0, 10).map(function(row) {
    var plan = findFirstBySymbol_(payload.plans, row.symbol) || {};
    var flow = findFirstBySymbol_(payload.flows || [], row.symbol) || {};
    var action = buildActionAdvice_(row, plan, regime);
    return '<div style="border:1px solid #d1d5db;border-radius:8px;padding:12px;margin:0 0 10px;background:#ffffff">' +
      '<div style="font-size:15px;line-height:1.45"><strong>' + escapeHtml_(row.rank) + '. ' + escapeHtml_(row.name) + '</strong> <span style="color:#6b7280">' + escapeHtml_(normalizeStockSymbol_(row.symbol)) + '</span></div>' +
      '<div style="margin:6px 0;line-height:1.7;font-size:13px">' +
        '<span style="color:#6b7280">' + ko_('sector') + ':</span> ' + escapeHtml_(row.sector || '') + ' &nbsp; ' +
        '<span style="color:#6b7280">' + ko_('risk') + ':</span> ' + buildRiskBadge_(row.risk_level) + ' &nbsp; ' +
        '<span style="color:#6b7280">' + ko_('score') + ':</span> <strong>' + escapeHtml_(row.total_score || '') + '</strong> &nbsp; ' +
        '<span style="color:#6b7280">' + ko_('action_now') + ':</span> ' + buildActionBadge_(action) +
      '</div>' +
      '<div style="font-size:13px;margin:6px 0"><span style="color:#6b7280">' + ko_('flow') + ':</span> ' + buildFlowMiniHtml_(flow) + '</div>' +
      buildPriceGridHtml_(row, plan) +
      '</div>';
  }).join('');
}

function buildKosdaqLeaderSectionHtml_(payload) {
  var rows = payload.kosdaq_leaders || [];
  if (rows.length === 0) return '';
  var note = rows.length < 50
    ? '<div style="font-size:12px;color:#6b7280;line-height:1.5;margin:0 0 8px">현재 코스닥 분석 종목 ' + rows.length + '개 기준입니다. 코스닥 universe를 넓히면 후보가 50개까지 채워집니다.</div>'
    : '';
  var cards = rows.slice(0, 10).map(function(row) {
    var flow = findFirstBySymbol_(payload.flows || [], row.symbol) || {};
    return '<div style="border:1px solid #d1d5db;border-radius:8px;padding:12px;margin:0 0 10px;background:#ffffff">' +
      '<div style="font-size:15px;line-height:1.45"><strong>' + escapeHtml_(row.rank) + '. ' + escapeHtml_(row.name) + '</strong> <span style="color:#6b7280">' + escapeHtml_(normalizeStockSymbol_(row.symbol)) + '</span></div>' +
      '<div style="margin:6px 0;line-height:1.7;font-size:13px">' +
        '<span style="color:#6b7280">' + ko_('sector') + ':</span> ' + escapeHtml_(row.sector || '') + ' &nbsp; ' +
        '<span style="color:#6b7280">' + ko_('risk') + ':</span> ' + buildRiskBadge_(row.risk_level) + ' &nbsp; ' +
        '<span style="color:#6b7280">' + ko_('score') + ':</span> <strong>' + escapeHtml_(row.total_score || '') + '</strong>' +
      '</div>' +
      '<div style="font-size:13px;margin:6px 0"><span style="color:#6b7280">' + ko_('flow') + ':</span> ' + buildFlowMiniHtml_(flow) + '</div>' +
      buildKosdaqLeaderGridHtml_(row) +
      '</div>';
  }).join('');
  return '<h2 style="font-size:18px;margin:22px 0 8px">코스닥 주도주 후보 TOP 10</h2>' + note + cards;
}

function buildKosdaqLeaderGridHtml_(row) {
  var cells = [
    ['현재가', formatNumber_(row.close)],
    ['등락률', formatPercentText_(row.change_pct)],
    ['거래대금', formatTradingValueText_(row.trading_value)],
    ['차트 점수', formatScoreValue_(row.chart_score)],
    ['ETF 점수', formatScoreValue_(row.etf_score)]
  ];
  return '<div style="font-size:13px;margin-top:8px">' +
    cells.map(function(cell) {
      return '<div style="border-top:1px solid #f3f4f6;padding:7px 0;line-height:1.35">' +
        '<span style="display:inline-block;width:42%;color:#6b7280">' + escapeHtml_(cell[0]) + '</span>' +
        '<span style="display:inline-block;width:56%;text-align:right"><strong>' + escapeHtml_(cell[1] || '-') + '</strong></span>' +
        '</div>';
    }).join('') +
    '</div>';
}

function buildPriceGridHtml_(leader, plan) {
  var cells = [
    [ko_('current_price'), formatNumber_(leader.close)],
    [ko_('first'), formatNumber_(plan.first_entry_price)],
    [ko_('second'), formatNumber_(plan.second_entry_price)],
    [ko_('breakout'), formatNumber_(plan.breakout_price)],
    [ko_('invalid'), formatNumber_(plan.invalid_price)]
  ];
  return '<div style="font-size:13px;margin-top:8px">' +
    cells.map(function(cell) {
      return '<div style="border-top:1px solid #f3f4f6;padding:7px 0;line-height:1.35">' +
        '<span style="display:inline-block;width:42%;color:#6b7280">' + escapeHtml_(cell[0]) + '</span>' +
        '<span style="display:inline-block;width:56%;text-align:right"><strong>' + escapeHtml_(cell[1] || '-') + '</strong></span>' +
        '</div>';
    }).join('') +
    '</div>';
}

function buildScenarioCardsHtml_(payload) {
  var scenario = buildScenarioFallbackObject_(payload);
  return [
    buildScenarioCardHtml_(ko_('up'), scenario.up, '#ecfdf5'),
    buildScenarioCardHtml_(ko_('neutral'), scenario.neutral, '#f9fafb'),
    buildScenarioCardHtml_(ko_('down'), scenario.down, '#fef2f2')
  ].join('');
}

function buildScenarioCardHtml_(title, text, bg) {
  return '<div style="border:1px solid #e5e7eb;border-radius:8px;padding:10px;margin:0 0 8px;background:' + bg + '">' +
    '<div style="font-weight:700;margin-bottom:4px">' + escapeHtml_(title) + '</div>' +
    '<div style="font-size:13px;line-height:1.55">' + escapeHtml_(text || '-') + '</div>' +
    '</div>';
}

function buildScenarioFallbackObject_(payload) {
  var scenario = payload.briefing.next_day_scenarios || {};
  var ruleScenario = scenarioRowsToObject_(payload.scenarios || []);
  return {
    up: firstUsefulText_(ruleScenario.up, firstUsefulText_(scenario.up, getDefaultScenarioText_('up'))),
    neutral: firstUsefulText_(ruleScenario.neutral, firstUsefulText_(scenario.neutral, getDefaultScenarioText_('neutral'))),
    down: firstUsefulText_(ruleScenario.down, firstUsefulText_(scenario.down, getDefaultScenarioText_('down')))
  };
}

function scenarioRowsToObject_(rows) {
  var output = {};
  (rows || []).forEach(function(row) {
    var key = String(row.scenario || '').toLowerCase();
    output[key] = [
      row.conditions ? '조건: ' + row.conditions : '',
      row.response_plan ? '대응: ' + row.response_plan : ''
    ].filter(function(text) { return text; }).join('\n');
  });
  return output;
}

function firstUsefulText_(value, fallback) {
  var text = String(value || '').trim();
  return text ? text : fallback;
}

function getDefaultScenarioText_(scenarioKey) {
  if (scenarioKey === 'up') {
    return '나스닥 반등, 금리와 환율 안정, 국내 거래대금 유지가 확인될 때 상위 후보의 눌림 또는 돌파만 관찰합니다. 장 초반 급등 추격은 피합니다.';
  }
  if (scenarioKey === 'down') {
    return '금리 또는 환율 상승, 나스닥 약세, 국내 지수 단기선 이탈이 나오면 신규 진입을 줄이고 무효화 가격과 현금 비중을 먼저 확인합니다.';
  }
  return '지수가 박스권이고 섹터 순환매가 이어지면 재무 안정성과 가격 조건이 맞는 종목만 1차 검토가 중심으로 관찰합니다.';
}

function buildStockAnalysisTableHtml_(payload) {
  var rows = payload.stocks.map(function(stock) {
    var leader = findFirstBySymbol_(payload.leaders, stock.symbol) || {};
    var plan = findFirstBySymbol_(payload.plans, stock.symbol) || {};
    return '<tr>' +
      '<td style="vertical-align:top;padding:8px;border:1px solid #e5e7eb"><strong>' + escapeHtml_(stock.name) + '</strong><br><span style="color:#6b7280">' + escapeHtml_(normalizeStockSymbol_(stock.symbol)) + '</span></td>' +
      '<td style="vertical-align:top;padding:8px;border:1px solid #e5e7eb">' + buildRiskBadge_(leader.risk_level) + '<br><span style="color:#6b7280">' + ko_('score') + ' ' + escapeHtml_(leader.total_score || '') + '</span></td>' +
      '<td style="vertical-align:top;padding:8px;border:1px solid #e5e7eb;line-height:1.5">' + escapeHtml_(stock.summary || '') + '</td>' +
      '<td style="vertical-align:top;padding:8px;border:1px solid #e5e7eb;line-height:1.55">' + buildPlanMiniTable_(plan) + '</td>' +
      '<td style="vertical-align:top;padding:8px;border:1px solid #e5e7eb;line-height:1.5">' + escapeHtml_(firstArrayItem_(stock.risk_comment)) + '</td>' +
      '<td style="vertical-align:top;padding:8px;border:1px solid #e5e7eb;line-height:1.5">' + escapeHtml_(firstArrayItem_(stock.check_points)) + '</td>' +
      '</tr>';
  }).join('');
  return '<table style="border-collapse:collapse;width:100%;font-size:13px;table-layout:fixed"><thead><tr style="background:#f3f4f6">' +
    '<th style="width:120px;text-align:left;padding:8px;border:1px solid #e5e7eb">' + ko_('stock') + '</th>' +
    '<th style="width:80px;text-align:left;padding:8px;border:1px solid #e5e7eb">' + ko_('risk') + '</th>' +
    '<th style="text-align:left;padding:8px;border:1px solid #e5e7eb">' + ko_('view') + '</th>' +
    '<th style="width:190px;text-align:left;padding:8px;border:1px solid #e5e7eb">' + ko_('plan') + '</th>' +
    '<th style="text-align:left;padding:8px;border:1px solid #e5e7eb">' + ko_('main_risk') + '</th>' +
    '<th style="text-align:left;padding:8px;border:1px solid #e5e7eb">' + ko_('check_first') + '</th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table>';
}

function buildStockAnalysisCardsHtml_(payload) {
  return payload.stocks.map(function(stock) {
    var leader = findFirstBySymbol_(payload.leaders, stock.symbol) || {};
    var plan = findFirstBySymbol_(payload.plans, stock.symbol) || {};
    
    var themeBlock = '';
    if (stock.theme_match && stock.theme_match.matched_topic) {
      themeBlock = buildSmallTextBlockHtml_('실시간 뉴스 테마 매칭',
        '[' + buildThemeMatchBadge_(stock.theme_match.correlation_level) + '] ' +
        '<strong>' + escapeHtml_(stock.theme_match.matched_topic) + '</strong> - ' +
        escapeHtml_(stock.theme_match.matching_rationale || '')
      );
    }
    
    return '<div style="border:1px solid #d1d5db;border-radius:8px;padding:12px;margin:0 0 12px;background:#ffffff">' +
      '<div style="font-size:15px;line-height:1.45"><strong>' + escapeHtml_(stock.name || leader.name || '') + '</strong> <span style="color:#6b7280">' + escapeHtml_(normalizeStockSymbol_(stock.symbol || leader.symbol)) + '</span></div>' +
      '<div style="margin:6px 0;font-size:13px;line-height:1.7">' + buildRiskBadge_(leader.risk_level) + ' <span style="color:#6b7280">' + ko_('score') + ' ' + escapeHtml_(leader.total_score || '') + '</span></div>' +
      buildSmallTextBlockHtml_(ko_('view'), stock.summary || '') +
      buildSmallTextBlockHtml_('전문가 관점', stock.expert_view || '') +
      themeBlock +
      buildSmallTextBlockHtml_('초보자 행동', stock.beginner_action || '') +
      buildSmallTextBlockHtml_(ko_('plan'), buildPlanText_(plan)) +
      buildSmallTextBlockHtml_(ko_('main_risk'), firstArrayItem_(stock.risk_comment)) +
      buildSmallTextBlockHtml_('유효 조건', normalizeTextList_(stock.valid_conditions).join('\n')) +
      buildSmallTextBlockHtml_('피해야 할 조건', normalizeTextList_(stock.avoid_conditions).join('\n')) +
      buildSmallTextBlockHtml_(ko_('check_first'), normalizeTextList_(stock.check_points).join('\n')) +
      '</div>';
  }).join('');
}

function buildThemeMatchBadge_(level) {
  var text = String(level || 'none').toLowerCase().trim();
  if (text === 'high') {
    return '<span style="display:inline-block;padding:2px 6px;font-size:11px;font-weight:bold;color:#b91c1c;background:#fee2e2;border-radius:4px">강한 연관성 🔥</span>';
  } else if (text === 'medium') {
    return '<span style="display:inline-block;padding:2px 6px;font-size:11px;font-weight:bold;color:#d97706;background:#fef3c7;border-radius:4px">보통 연관성 ⚡</span>';
  } else if (text === 'low') {
    return '<span style="display:inline-block;padding:2px 6px;font-size:11px;font-weight:bold;color:#2563eb;background:#dbeafe;border-radius:4px">낮은 연관성 💧</span>';
  }
  return '<span style="display:inline-block;padding:2px 6px;font-size:11px;font-weight:bold;color:#4b5563;background:#f3f4f6;border-radius:4px">개별 모멘텀</span>';
}

function buildHoldingsAdviceHtml_(payload) {
  var adviceRows = payload.holdings_advice || [];
  var holdings = payload.holdings || [];
  var risks = payload.portfolio_risks || [];
  var snapshot = payload.account_snapshot || null;
  var totalInvestment = getStrategyNumber_('total_investment', 50000000);
  
  if (adviceRows.length === 0 && holdings.length === 0) return '';
  
  var accountBlock = '';
  if (snapshot || totalInvestment > 0 || holdings.length > 0) {
    var cashAmt = snapshot ? Number(snapshot.cash_amount || 0) : 0;
    var stockAmt = snapshot ? Number(snapshot.stock_eval_amount || 0) : 0;
    var totalAmt = snapshot ? Number(snapshot.total_eval_amount || 0) : 0;
    
    // Fallback if KIS account snapshot is missing but manual holdings have eval_amount
    if (totalAmt <= 0 && holdings.length > 0) {
      stockAmt = holdings.reduce(function(sum, h) {
        return sum + Number(h.eval_amount || 0);
      }, 0);
      totalAmt = stockAmt;
    }
    
    var budgetUsagePct = totalInvestment > 0 ? (totalAmt / totalInvestment) * 100 : 0;
    var cashPct = totalAmt > 0 ? (cashAmt / totalAmt) * 100 : 0;
    var stockPct = totalAmt > 0 ? (stockAmt / totalAmt) * 100 : 0;
    
    accountBlock = 
      '<div style="border:1px solid #bfdbfe;border-radius:8px;background:#f0f9ff;padding:12px;margin:0 0 10px;font-size:13px;line-height:1.55">' +
        '<div style="font-weight:700;font-size:14px;color:#0369a1;margin-bottom:6px">포트폴리오 자산 및 예산 현황</div>' +
        '<table style="width:100%;border-collapse:collapse">' +
          '<tr>' +
            '<td style="color:#4b5563;padding:2px 0">설정 투자 예산:</td>' +
            '<td style="text-align:right;font-weight:700">' + formatNumber_(totalInvestment) + ' 원</td>' +
          '</tr>' +
          '<tr>' +
            '<td style="color:#4b5563;padding:2px 0">현재 총 평가 자산:</td>' +
            '<td style="text-align:right;font-weight:700;color:#0284c7">' + formatNumber_(totalAmt) + ' 원</td>' +
          '</tr>' +
          (totalAmt > 0 && snapshot ? 
          '<tr>' +
            '<td style="color:#4b5563;padding:2px 0">보유 주식 평가액:</td>' +
            '<td style="text-align:right">' + formatNumber_(stockAmt) + ' 원 (' + roundNumber_(stockPct, 1) + '%)</td>' +
          '</tr>' +
          '<tr>' +
            '<td style="color:#4b5563;padding:2px 0">보유 예수금 현금:</td>' +
            '<td style="text-align:right">' + formatNumber_(cashAmt) + ' 원 (' + roundNumber_(cashPct, 1) + '%)</td>' +
          '</tr>' : '') +
          (totalInvestment > 0 ?
          '<tr>' +
            '<td style="color:#4b5563;padding:4px 0 2px;border-top:1px dashed #bae6fd;margin-top:2px">예산 대비 자산비율:</td>' +
            '<td style="text-align:right;font-weight:700;border-top:1px dashed #bae6fd;margin-top:2px;color:#0369a1">' + roundNumber_(budgetUsagePct, 1) + '%</td>' +
          '</tr>' : '') +
        '</table>' +
      '</div>';
  }
  
  var riskBlock = risks.length === 0 ? '' :
    '<div style="border:1px solid #fbbf24;border-radius:8px;background:#fffbeb;padding:10px;margin:0 0 10px;font-size:13px;line-height:1.55">' +
    '<div style="font-weight:700;margin-bottom:4px">포트폴리오 리스크</div>' +
    risks.slice(0, 5).map(function(row) {
      return '<div style="margin-top:4px">- ' + escapeHtml_(row.message || '') + '</div>';
    }).join('') +
    '</div>';
    
  var cards = adviceRows.map(function(row) {
    var holding = findFirstBySymbol_(holdings, row.symbol) || {};
    var adviceJson = {};
    try {
      adviceJson = typeof row.advice_json === 'string' ? JSON.parse(row.advice_json) : (row.advice_json || {});
    } catch(e) {}
    
    var rebalanceUp = row.rebalance_up || adviceJson.rebalance_up || '';
    var rebalanceDown = row.rebalance_down || adviceJson.rebalance_down || '';
    
    return '<div style="border:1px solid #d1d5db;border-radius:8px;padding:12px;margin:0 0 10px;background:#ffffff">' +
      '<div style="font-size:15px;line-height:1.45"><strong>' + escapeHtml_(row.name || holding.name || '') + '</strong> <span style="color:#6b7280">' + escapeHtml_(normalizeStockSymbol_(row.symbol || holding.symbol)) + '</span></div>' +
      '<div style="margin:6px 0;font-size:13px;line-height:1.7">' +
        '<span style="color:#6b7280">판단:</span> ' + buildHoldingActionBadge_(row.action_view) + ' &nbsp; ' +
        '<span style="color:#6b7280">비중:</span> <strong>' + escapeHtml_(formatPercentText_(holding.portfolio_weight_pct)) + '</strong> &nbsp; ' +
        '<span style="color:#6b7280">손익률:</span> <strong>' + escapeHtml_(formatPercentText_(holding.profit_loss_pct)) + '</strong>' +
      '</div>' +
      buildSmallTextBlockHtml_('요약', row.summary || '') +
      buildSmallTextBlockHtml_('포지션 체크', row.position_check || '') +
      buildSmallTextBlockHtml_('주요 리스크', row.risk_comment || '') +
      buildSmallTextBlockHtml_('📈 상승 시 리밸런싱 가이드', rebalanceUp) +
      buildSmallTextBlockHtml_('📉 하락 시 리밸런싱 가이드', rebalanceDown) +
      buildSmallTextBlockHtml_('유효 조건', row.valid_condition || '') +
      buildSmallTextBlockHtml_('피해야 할 조건', row.avoid_condition || '') +
      buildSmallTextBlockHtml_('다음 확인', row.next_check || '') +
      '</div>';
  }).join('');
  
  return '<h2 style="font-size:18px;margin:22px 0 8px">내 보유종목 어드바이스</h2>' +
    '<div style="font-size:12px;color:#6b7280;line-height:1.5;margin:0 0 8px">현재 보유종목 기준의 조건부 점검입니다. 매수·매도 지시가 아니라 비중, 손실 확대 조건, 다음 확인 포인트를 정리한 것입니다.</div>' +
    accountBlock +
    riskBlock +
    (cards || '<div style="font-size:13px;color:#6b7280">오늘 생성된 보유종목 어드바이스가 없습니다.</div>');
}

function buildHoldingActionBadge_(actionView) {
  var key = String(actionView || 'needs_review').toLowerCase();
  var bg = key === 'hold_watch' ? '#ecfdf5' :
    key === 'avoid_add' ? '#fef3c7' :
    key === 'risk_reduce_review' ? '#fee2e2' : '#f3f4f6';
  var color = key === 'hold_watch' ? '#166534' :
    key === 'avoid_add' ? '#92400e' :
    key === 'risk_reduce_review' ? '#991b1b' : '#374151';
  return '<span style="display:inline-block;padding:3px 8px;border-radius:999px;background:' + bg + ';color:' + color + ';font-weight:700;font-size:12px;white-space:nowrap">' + escapeHtml_(ko_('holding_action_' + key)) + '</span>';
}

function normalizeTextList_(items) {
  if (items === undefined || items === null || items === '') return [];
  if (!Array.isArray(items)) return [String(items)];
  return items.map(function(item) {
    return String(item || '').trim();
  }).filter(function(item) {
    return item !== '';
  });
}

function buildSmallTextBlockHtml_(title, text) {
  if (!text) return '';
  return '<div style="border-top:1px solid #f3f4f6;padding-top:8px;margin-top:8px;font-size:13px;line-height:1.55;white-space:pre-line">' +
    '<div style="font-weight:700;color:#374151;margin-bottom:3px">' + escapeHtml_(title) + '</div>' +
    '<div>' + escapeHtml_(text) + '</div>' +
    '</div>';
}

function buildPlanText_(plan) {
  return [
    ko_('first') + ': ' + formatNumber_(plan.first_entry_price) + ' / ' + String(plan.first_entry_pct || '') + '%',
    ko_('second') + ': ' + formatNumber_(plan.second_entry_price) + ' / ' + String(plan.second_entry_pct || '') + '%',
    ko_('breakout_short') + ': ' + formatNumber_(plan.breakout_price) + ' / ' + String(plan.breakout_entry_pct || '') + '%',
    ko_('invalid') + ': ' + formatNumber_(plan.invalid_price)
  ].join('\n');
}

function buildPlanMiniTable_(plan) {
  return [
    '<div><strong>' + ko_('first') + ':</strong> ' + formatNumber_(plan.first_entry_price) + ' / ' + escapeHtml_(plan.first_entry_pct || '') + '%</div>',
    '<div><strong>' + ko_('second') + ':</strong> ' + formatNumber_(plan.second_entry_price) + ' / ' + escapeHtml_(plan.second_entry_pct || '') + '%</div>',
    '<div><strong>' + ko_('breakout_short') + ':</strong> ' + formatNumber_(plan.breakout_price) + ' / ' + escapeHtml_(plan.breakout_entry_pct || '') + '%</div>',
    '<div><strong>' + ko_('invalid') + ':</strong> ' + formatNumber_(plan.invalid_price) + '</div>'
  ].join('');
}

function buildActionAdvice_(leader, plan, regime) {
  var risk = String(leader.risk_level || '').toLowerCase();
  var close = toNumber_(leader.close);
  var first = toNumber_(plan.first_entry_price);
  var breakout = toNumber_(plan.breakout_price);
  var invalid = toNumber_(plan.invalid_price);
  if (invalid && close && close <= invalid) return 'invalid_break';
  if (risk === 'high') return 'watch_only';
  if (breakout && close && close >= breakout) return 'breakout_check';
  if (first && close && close <= first * 1.01 && close >= first * 0.985) return 'near_first';
  if (String(regime || '').toLowerCase() === 'risk_off') return 'defensive_wait';
  return 'wait';
}

function buildActionBadge_(actionKey) {
  var key = actionKey || 'wait';
  var bg = key === 'near_first' ? '#ecfdf5' :
    key === 'breakout_check' ? '#eff6ff' :
    key === 'watch_only' || key === 'invalid_break' ? '#fee2e2' :
    key === 'defensive_wait' ? '#fef3c7' : '#f3f4f6';
  var color = key === 'near_first' ? '#166534' :
    key === 'breakout_check' ? '#1d4ed8' :
    key === 'watch_only' || key === 'invalid_break' ? '#991b1b' :
    key === 'defensive_wait' ? '#92400e' : '#374151';
  return '<span style="display:inline-block;padding:3px 8px;border-radius:999px;background:' + bg + ';color:' + color + ';font-weight:700;font-size:12px;white-space:nowrap">' + escapeHtml_(ko_('action_' + key)) + '</span>';
}

function buildFlowMiniHtml_(flow) {
  if (!flow || !flow.symbol) {
    return '<span style="display:inline-block;padding:2px 7px;border-radius:999px;background:#f3f4f6;color:#6b7280;font-weight:700;font-size:12px;white-space:nowrap">수급 미수집</span><br><span style="color:#6b7280;font-size:12px">15:40 이후 수집 확인</span>';
  }
  var score = Number(flow.combined_flow_score || 0);
  var bg = score >= 7 ? '#dcfce7' : score >= 4 ? '#fef3c7' : '#f3f4f6';
  var color = score >= 7 ? '#166534' : score >= 4 ? '#92400e' : '#374151';
  return '<span style="display:inline-block;padding:2px 7px;border-radius:999px;background:' + bg + ';color:' + color + ';font-weight:700;font-size:12px;white-space:nowrap">' +
    escapeHtml_(score.toLocaleString('ko-KR', { maximumFractionDigits: 1 }) + ko_('score_suffix')) + '</span><br><span style="color:#6b7280;font-size:12px">' + escapeHtml_(truncateText_(flow.flow_comment || '', 24)) + '</span>';
}

function buildEmailReportText_(payload) {
  var lines = [
    ko_('report_title') + ' - ' + payload.date,
    '',
    '[상단 1분 요약]'
  ];
  appendExecutiveSummaryText_(lines, payload, payload.macro.market_regime || payload.briefing.market_regime || 'neutral');
  lines.push(
    '',
    '[세부 분석]',
    '',
    '[' + ko_('market_regime') + ']',
    payload.briefing.summary || '',
    ko_('regime') + ': ' + (payload.macro.market_regime || payload.briefing.market_regime || 'neutral') + ' / ' + ko_('macro_score') + ': ' + (payload.macro.macro_alignment_score || ''),
    ''
  );
  appendTextListSection_(lines, '전문가 핵심 판단', payload.briefing.expert_takeaways);
  appendTextListSection_(lines, '초보자 오늘 행동', payload.briefing.beginner_actions);
  appendTextListSection_(lines, '하지 말 것', payload.briefing.avoid_actions);
  appendMarketBreadthTextSection_(lines, payload.market_breadth || []);
  appendNewsScoreTextSection_(lines, payload.news_scores || []);
  lines.push(
    '[' + ko_('top10_summary') + ']'
  );
  payload.leaders.slice(0, 10).forEach(function(row) {
    var plan = findFirstBySymbol_(payload.plans, row.symbol) || {};
    lines.push(row.rank + '. ' + row.name + ' ' + normalizeStockSymbol_(row.symbol) +
      ' ' + ko_('score') + '=' + row.total_score +
      ' ' + ko_('risk') + '=' + row.risk_level +
      ' ' + ko_('first') + '=' + plan.first_entry_price +
      ' ' + ko_('breakout') + '=' + plan.breakout_price +
      ' ' + ko_('invalid') + '=' + plan.invalid_price);
  });
  if ((payload.kosdaq_leaders || []).length > 0) {
    lines.push('', '[코스닥 주도주 후보 TOP 10]');
    payload.kosdaq_leaders.slice(0, 10).forEach(function(row) {
      lines.push(row.rank + '. ' + row.name + ' ' + normalizeStockSymbol_(row.symbol) +
        ' ' + ko_('score') + '=' + row.total_score +
        ' ' + ko_('risk') + '=' + row.risk_level +
        ' 현재가=' + row.close +
        ' 등락률=' + row.change_pct + '%');
    });
  }
  appendBacktestTextSection_(lines, payload.backtest_rows || []);
  appendPremarketReviewTextSection_(lines, payload.premarket_review || []);
  lines.push('', '[' + ko_('stock_notes') + ']');
  payload.stocks.forEach(function(stock) {
    lines.push(stock.name + ' ' + stock.symbol);
    lines.push(stock.summary || '');
    if (stock.expert_view) lines.push('전문가 관점: ' + stock.expert_view);
    if (stock.beginner_action) lines.push('초보자 행동: ' + stock.beginner_action);
  });
  if ((payload.holdings_advice || []).length > 0) {
    lines.push('', '[내 보유종목 어드바이스]');
    payload.holdings_advice.forEach(function(row) {
      var holding = findFirstBySymbol_(payload.holdings || [], row.symbol) || {};
      lines.push((row.name || holding.name || '') + ' ' + normalizeStockSymbol_(row.symbol || holding.symbol) +
        ' / 판단=' + ko_('holding_action_' + String(row.action_view || 'needs_review').toLowerCase()) +
        ' / 비중=' + formatPercentText_(holding.portfolio_weight_pct) +
        ' / 손익률=' + formatPercentText_(holding.profit_loss_pct));
      lines.push(row.summary || '');
      if (row.next_check) lines.push('다음 확인: ' + row.next_check);
    });
  }
  lines.push('', ko_('report_disclaimer'));
  return lines.join('\n');
}

function appendExecutiveSummaryText_(lines, payload, regime) {
  var summary = buildExecutiveSummaryData_(payload, regime);
  lines.push(summary.headline);
  lines.push(summary.subline);
  lines.push('');
  lines.push('시장 자세: ' + summary.stance);
  lines.push('뉴스: ' + summary.news_tone);
  lines.push('시장 폭: ' + summary.breadth_tone);
  lines.push('리스크: ' + summary.risk_tone);
  lines.push('');
  appendPlainList_(lines, '왜 이렇게 보나', summary.reasons);
  appendPlainList_(lines, '오늘 먼저 볼 것', summary.watch_items);
  appendPlainList_(lines, '오늘 피할 것', summary.avoid_items);
  appendPlainList_(lines, '아침 전망 사후검증', summary.premarket_review);
  appendPlainList_(lines, '내 보유종목 한줄 점검', summary.holding_items);
}

function appendPlainList_(lines, title, items) {
  var list = normalizeTextList_(items);
  if (list.length === 0) return;
  lines.push('[' + title + ']');
  list.slice(0, 4).forEach(function(item) {
    lines.push('- ' + item);
  });
  lines.push('');
}

function appendTextListSection_(lines, title, items) {
  var list = normalizeTextList_(items);
  if (list.length === 0) return;
  lines.push('[' + title + ']');
  list.forEach(function(item) {
    lines.push('- ' + item);
  });
  lines.push('');
}

function appendMarketBreadthTextSection_(lines, rows) {
  if (!rows || rows.length === 0) return;
  lines.push('[시장 폭 지표]');
  rows.slice(0, 4).forEach(function(row) {
    lines.push((row.market || '') + ': 점수=' + row.breadth_score +
      ' / 상승비율=' + formatPercentText_(row.up_ratio) +
      ' / 20일선 위=' + formatPercentText_(row.ma20_above_ratio) +
      ' / 거래량 증가=' + formatPercentText_(row.volume_expansion_ratio));
  });
  lines.push('');
}

function appendNewsScoreTextSection_(lines, rows) {
  if (!rows || rows.length === 0) return;
  lines.push('[뉴스 영향 점수]');
  rows.forEach(function(row) {
    lines.push(formatNewsSessionKo_(row.session) + ': 우호=' + row.risk_on_score +
      ' / 부담=' + row.risk_off_score +
      ' / 순점수=' + row.net_news_score +
      ' / ' + (row.memo || ''));
  });
  lines.push('');
}

function appendBacktestTextSection_(lines, rows) {
  if (!rows || rows.length === 0) return;
  var summary = summarizeBacktestRows_(rows);
  lines.push('', '[전일 리포트 사후검증]');
  lines.push('기준 리포트 날짜: ' + normalizeDateValue_(rows[0].base_date));
  lines.push('평균 다음 종가: ' + formatPercentText_(summary.avg_return_pct) +
    ' / 1차 도달: ' + summary.first_entry_hits + '개' +
    ' / 돌파 도달: ' + summary.breakout_hits + '개' +
    ' / 무효화 터치: ' + summary.invalid_hits + '개');
  rows.slice(0, 8).forEach(function(row) {
    lines.push(row.rank + '. ' + row.name + ' ' + normalizeStockSymbol_(row.symbol) +
      ' / 결과=' + (row.result || '-') +
      ' / 다음 종가=' + formatBacktestReturnText_(row.next_return_pct));
  });
}

function appendPremarketReviewTextSection_(lines, rows) {
  if (!rows || rows.length === 0) return;
  var row = rows[0];
  var detail = parseJsonCell_(row.detail_json, {});
  lines.push('', '[장전 예측 사후검증]');
  lines.push(row.summary || '');
  lines.push('예측 검증 점수: ' + (row.prediction_score || 0) + '/100');
  lines.push('시장 방향: 장전 ' + formatRegimeForPremarketReview_(row.market_bias) + ' / 실제 ' + formatRegimeForPremarketReview_(row.actual_market_regime));
  lines.push('관찰 후보 상승: ' + (row.watch_positive_count || 0) + ' / ' + (row.watch_count || 0) + ' / 평균 ' + formatPercentText_(row.watch_avg_return_pct));
  (detail.watch_details || []).slice(0, 5).forEach(function(item) {
    lines.push('- ' + (item.name || '') + ' ' + normalizeStockSymbol_(item.symbol) + ': ' + (item.result || '-') + ', ' + formatPercentText_(item.return_pct));
  });
}

function buildMacroTableHtml_(rows) {
  if (!rows || rows.length === 0) return '';
  var cards = rows.map(function(row) {
    var change = Number(row.change || 0);
    var changeColor = change > 0 ? '#b91c1c' : change < 0 ? '#047857' : '#374151';
    var meta = getMacroIndicatorMeta_(row.name, change);
    return '<div style="border:1px solid #e5e7eb;border-radius:8px;background:#ffffff;padding:10px;margin:0 0 8px;font-size:13px;line-height:1.45">' +
      '<div style="font-weight:700">' + escapeHtml_(meta.label) + '</div>' +
      '<div style="color:#6b7280;font-size:12px;margin:2px 0 8px">' + escapeHtml_(meta.comment) + '</div>' +
      '<div style="display:block">' +
        '<span style="display:inline-block;width:32%;color:#6b7280">' + ko_('value') + '<br><strong style="color:#111827">' + formatMacroNumber_(row.value) + '</strong></span>' +
        '<span style="display:inline-block;width:32%;color:#6b7280">' + ko_('change') + '<br><strong style="color:' + changeColor + '">' + formatMacroNumber_(row.change) + '</strong></span>' +
        '<span style="display:inline-block;width:32%;color:#6b7280">' + ko_('change_pct') + '<br><strong style="color:' + changeColor + '">' + formatMacroNumber_(row.change_pct) + '%</strong></span>' +
      '</div>' +
      '</div>';
  }).join('');
  return '<h2 style="font-size:18px;margin:22px 0 8px">거시지표 해석</h2>' + cards;
}

function getMacroIndicatorMeta_(name, change) {
  var key = String(name || '');
  var map = {
    us_10y_yield: ['미국 10년물 금리', change > 0 ? '상승하면 성장주와 기술주에 부담' : change < 0 ? '하락하면 성장주 부담 완화' : '변화 없음'],
    us_2y_yield: ['미국 2년물 금리', change > 0 ? '연준 긴축 기대가 강해질 수 있음' : change < 0 ? '금리 부담 완화 신호' : '변화 없음'],
    us_fed_funds: ['미국 기준금리', change > 0 ? '미국 유동성 부담 증가' : change < 0 ? '미국 유동성 부담 완화' : '변화 없음'],
    usd_krw: ['원/달러 환율', change > 0 ? '상승하면 외국인 수급에 부담' : change < 0 ? '하락하면 외국인 수급에 우호적' : '변화 없음'],
    nasdaq_composite: ['나스닥 종합지수', change > 0 ? '상승하면 반도체/성장주에 우호적' : change < 0 ? '하락하면 반도체/성장주에 부담' : '변화 없음'],
    sp500: ['S&P500 지수', change > 0 ? '미국 대표지수 강세 참고' : change < 0 ? '미국 대표지수 약세 참고' : '변화 없음'],
    dow_jones: ['다우존스 지수', change > 0 ? '미국 대형 가치주 흐름 우호' : change < 0 ? '미국 대형 가치주 흐름 약세' : '변화 없음'],
    vix: ['VIX 공포지수', change > 0 ? '상승하면 시장 불안 확대' : change < 0 ? '하락하면 시장 불안 완화' : '변화 없음'],
    japan_10y_yield: ['일본 10년물 금리', change > 0 ? '글로벌 금리 부담 참고' : change < 0 ? '글로벌 금리 부담 완화 참고' : '변화 없음'],
    germany_10y_yield: ['독일 10년물 금리', change > 0 ? '유럽 금리 상승 참고' : change < 0 ? '유럽 금리 부담 완화 참고' : '변화 없음'],
    uk_10y_yield: ['영국 10년물 금리', change > 0 ? '글로벌 금리 상승 참고' : change < 0 ? '글로벌 금리 부담 완화 참고' : '변화 없음'],
    korea_base_rate: ['한국 기준금리', change > 0 ? '국내 유동성 부담 증가' : change < 0 ? '국내 유동성 부담 완화' : '변화 없음']
  };
  var item = map[key] || [key, '참고 지표'];
  return { label: item[0], comment: item[1] };
}

function buildSmallListHtml_(title, items) {
  if (!items || items.length === 0) return '';
  return '<div style="margin-top:8px"><strong>' + escapeHtml_(title) + ':</strong><ul style="margin:4px 0 0;padding-left:18px;line-height:1.5">' +
    items.map(function(item) { return '<li>' + escapeHtml_(item) + '</li>'; }).join('') +
    '</ul></div>';
}

function parseJsonCell_(value, fallback) {
  if (value && typeof value === 'object') return value;
  var text = String(value || '').trim();
  if (!text) return fallback;
  try {
    return JSON.parse(text);
  } catch (err) {
    return fallback;
  }
}

function escapeHtml_(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatNumber_(value) {
  var number = Number(value || 0);
  if (!number) return '';
  return number.toLocaleString('ko-KR');
}

function formatScoreValue_(value) {
  var number = Number(value);
  if (isNaN(number)) return '';
  return number.toLocaleString('ko-KR', { maximumFractionDigits: 1 });
}

function formatTradingValueText_(value) {
  var number = Number(value || 0);
  if (!number) return '';
  if (number >= 100000000) {
    return Math.round(number / 100000000).toLocaleString('ko-KR') + '억원';
  }
  return number.toLocaleString('ko-KR') + '원';
}

function formatMacroNumber_(value) {
  var number = Number(value);
  if (isNaN(number)) return escapeHtml_(value);
  return number.toLocaleString('ko-KR', { maximumFractionDigits: 2 });
}

function formatPercentText_(value) {
  var number = Number(value);
  if (isNaN(number)) return '';
  return number.toLocaleString('ko-KR', { maximumFractionDigits: 2 }) + '%';
}

function toNumber_(value) {
  var number = Number(value);
  return isNaN(number) ? 0 : number;
}

function buildRiskBadge_(riskLevel) {
  var risk = String(riskLevel || 'medium').toLowerCase();
  var bg = risk === 'low' ? '#dcfce7' : risk === 'high' ? '#fee2e2' : '#fef3c7';
  var color = risk === 'low' ? '#166534' : risk === 'high' ? '#991b1b' : '#92400e';
  return '<span style="display:inline-block;padding:2px 7px;border-radius:999px;background:' + bg + ';color:' + color + ';font-weight:700;font-size:12px">' + escapeHtml_(ko_('risk_' + risk)) + '</span>';
}

function buildRegimeBadge_(regimeValue) {
  var regime = String(regimeValue || 'neutral').toLowerCase();
  var bg = regime === 'risk_on' ? '#dcfce7' : regime === 'risk_off' ? '#fee2e2' : '#f3f4f6';
  var color = regime === 'risk_on' ? '#166534' : regime === 'risk_off' ? '#991b1b' : '#374151';
  return '<span style="display:inline-block;padding:4px 10px;border-radius:999px;background:' + bg + ';color:' + color + ';font-weight:700">' + escapeHtml_(ko_('regime_' + regime)) + '</span>';
}

function firstArrayItem_(items) {
  if (!items || items.length === 0) return '';
  return String(items[0] || '');
}

function truncateText_(text, maxLength) {
  var value = String(text || '');
  if (value.length <= maxLength) return value;
  return value.slice(0, Math.max(0, maxLength - 1)) + '...';
}

function ko_(key) {
  var labels = {
    report_title: '\u0041\u0049 \uc8fc\ub3c4\uc8fc \ub9ac\ud3ec\ud2b8',
    beginner_quick_read: '\ucd08\ubcf4\uc790\uc6a9 \ud55c\ub208 \uc694\uc57d',
    market_regime: '\uc2dc\uc7a5 \ud658\uacbd',
    regime: '\uc2dc\uc7a5\uad6d\uba74',
    macro_score: '\uac70\uc2dc \uc810\uc218',
    top10_summary: '\u0054\u004f\u0050 \u0031\u0030 \ud55c\ub208 \uc694\uc57d',
    rank: '\uc21c\uc704',
    stock: '\uc885\ubaa9',
    sector: '\uc139\ud130',
    risk: '\uc704\ud5d8',
    flow: '\uc218\uae09',
    score: '\uc810\uc218',
    why_watch: '\uad00\ucc30 \uc774\uc720',
    first: '\u0031\ucc28',
    second: '\u0032\ucc28',
    breakout: '\ub3cc\ud30c',
    breakout_short: '\ub3cc\ud30c',
    invalid: '\ubb34\ud6a8\ud654',
    next_scenarios: '\ub2e4\uc74c \uac70\ub798\uc77c \uc2dc\ub098\ub9ac\uc624',
    up: '\uc0c1\uc2b9',
    neutral: '\uc911\ub9bd',
    down: '\ud558\ub77d',
    stock_notes: '\uc885\ubaa9\ubcc4 \uc0c1\uc138 \ud45c',
    view: '\ud574\uc11d',
    plan: '\uac00\uaca9 \uacc4\ud68d',
    main_risk: '\uc8fc\uc694 \ub9ac\uc2a4\ud06c',
    check_first: '\uba3c\uc800 \ud655\uc778',
    indicator: '\uc9c0\ud45c',
    value: '\uac12',
    change: '\ubcc0\ud654',
    change_pct: '\ubcc0\ud654\uc728',
    market_news_brief: '\uc2dc\uc7a5 \ub274\uc2a4 \ube0c\ub9ac\ud551',
    topic: '\uc774\uc288',
    impact: '\uc601\ud5a5',
    related_sectors: '\uad00\ub828 \uc139\ud130',
    meaning: '\uc758\ubbf8',
    sources: '\ucd9c\ucc98'
    ,
    sector_strength: '\uc139\ud130 \uac15\ub3c4',
    sector_score: '\uc139\ud130 \uc810\uc218',
    avg_change: '\ud3c9\uade0 \ub4f1\ub77d\ub960',
    up_ratio: '\uc0c1\uc2b9 \ube44\uc728',
    trading_value_share: '\uac70\ub798\ub300\uae08 \ube44\uc911',
    weak_sectors: '\uc57d\ud55c \uc139\ud130',
    stocks_count: '\uc885\ubaa9',
    score_suffix: '\uc810',
    current_price: '\ud604\uc7ac\uac00',
    action_now: '\uc9c0\uae08 \ud589\ub3d9',
    risk_low: '\ub0ae\uc74c',
    risk_medium: '\ubcf4\ud1b5',
    risk_high: '\ub192\uc74c',
    regime_risk_on: '\uacf5\uaca9 \uac00\ub2a5',
    regime_neutral: '\uc120\ubcc4 \uad00\ucc30',
    regime_risk_off: '\ubc29\uc5b4 \uc6b0\uc120',
    action_invalid_break: '\ubb34\ud6a8\ud654 \uc774\ud0c8',
    action_watch_only: '\uad00\ucc30\ub9cc',
    action_breakout_check: '\ub3cc\ud30c \ud655\uc778',
    action_near_first: '1\ucc28 \uadfc\uc811',
    action_defensive_wait: '\ubc29\uc5b4\uc801 \ub300\uae30',
    action_wait: '\uae30\ub2e4\ub9bc',
    holding_action_hold_watch: '유지 관찰',
    holding_action_risk_reduce_review: '리스크 축소 검토',
    holding_action_avoid_add: '추가매수 회피',
    holding_action_needs_review: '재점검 필요',
    today_conclusion: '\uc624\ub298 \uacb0\ub860',
    market_stance: '\uc2dc\uc7a5 \uc790\uc138',
    strong_sectors: '\uac15\ud55c \uc139\ud130',
    first_watch: '\uba3c\uc800 \ubcfc \ud6c4\ubcf4',
    risk_check: '\ub9ac\uc2a4\ud06c \uccb4\ud06c',
    high_risk_exists: '\uace0\uc704\ud5d8 \ud6c4\ubcf4 \uc788\uc74c',
    count_suffix: '\uac1c',
    no_high_risk_top10: 'TOP 10 \uc548\uc5d0 \uace0\uc704\ud5d8 \ud6c4\ubcf4 \uc5c6\uc74c',
    stance_attack: '\uacf5\uaca9\ubcf4\ub2e4 \ud655\uc778\ub41c \ub3cc\ud30c\uc640 \ub20c\ub9bc\ub9cc \uc120\ubcc4 \uad00\ucc30',
    stance_defense: '\uc2e0\uaddc \uc9c4\uc785\uc740 \uc904\uc774\uace0, \ubb34\ud6a8\ud654 \uac00\uaca9\uacfc \ud604\uae08 \ube44\uc911\uc744 \uba3c\uc800 \ud655\uc778',
    stance_selective: '\uc88b\uc740 \uc139\ud130\uc640 \uc7ac\ubb34 \uc548\uc815 \uc885\ubaa9\ub9cc \uc120\ubcc4 \uad00\ucc30',
    report_disclaimer: '\uc774 \ub9ac\ud3ec\ud2b8\ub294 \uc790\ub3d9\ub9e4\ub9e4 \uc2e0\ud638\ub098 \ub9e4\uc218 \ucd94\ucc9c\uc774 \uc544\ub2c8\ub77c \uc870\uac74\ubd80 \uad00\ucc30 \ub9ac\ud3ec\ud2b8\uc785\ub2c8\ub2e4. \uac00\uaca9\uacfc \ube44\uc911\uc740 \uaddc\uce59 \uae30\ubc18 \uacc4\uc0b0\uac12\uc774\uba70, \ucd5c\uc885 \ud310\ub2e8\uc740 \uc0ac\uc6a9\uc790\uac00 \ud569\ub2c8\ub2e4.',
    premarket_disclaimer: '\uc774 \uba54\uc77c\uc740 \uc7a5\uc804 \uad00\ucc30 \ub9ac\ud3ec\ud2b8\uc774\uba70 \uc790\ub3d9\ub9e4\ub9e4 \uc2e0\ud638\ub098 \ub9e4\uc218 \ucd94\ucc9c\uc774 \uc544\ub2d9\ub2c8\ub2e4.',
    premarket_title: '\uc7a5\uc804 \ud504\ub9ac\ub9c8\ucf13 \ube0c\ub9ac\ud551',
    base_leader_date: '\uae30\uc900 \uc8fc\ub3c4\uc8fc \ub0a0\uc9dc',
    today_watch: '\uc624\ub298 \uc7a5 \uad00\ucc30 \ud6c4\ubcf4',
    sector_watch: '\uc139\ud130 \uad00\ucc30',
    do_first: '\uc7a5 \uc2dc\uc791 \ud6c4 \uba3c\uc800 \ud560 \uc77c',
    avoid: '\ud53c\ud560 \ud589\ub3d9'
  };
  return labels[key] || key;
}

function buildPaperTradingHtml_(payload) {
  var portfolio = payload.paper_portfolio || null;
  var trades = payload.paper_trades || [];
  
  if (!portfolio) return '';
  
  var cash = Number(portfolio.cash_amount || 0);
  var stock = Number(portfolio.stock_eval_amount || 0);
  var total = Number(portfolio.total_eval_amount || 0);
  var daily = Number(portfolio.daily_return_pct || 0);
  var cumulative = Number(portfolio.cumulative_return_pct || 0);
  
  var activePositions = [];
  try {
    activePositions = JSON.parse(portfolio.active_positions_json || '[]');
  } catch(e) {
    activePositions = [];
  }
  
  var dailyColor = daily > 0 ? '#b91c1c' : (daily < 0 ? '#1d4ed8' : '#374151');
  var dailySign = daily > 0 ? '+' : '';
  var cumColor = cumulative > 0 ? '#b91c1c' : (cumulative < 0 ? '#1d4ed8' : '#374151');
  var cumSign = cumulative > 0 ? '+' : '';
  
  var posRows = activePositions.map(function(pos) {
    var retColor = pos.return_pct > 0 ? '#b91c1c' : (pos.return_pct < 0 ? '#1d4ed8' : '#374151');
    var retSign = pos.return_pct > 0 ? '+' : '';
    return '<tr style="border-bottom:1px solid #e5e7eb">' +
      '<td style="padding:8px 4px;font-weight:700">' + escapeHtml_(pos.name) + ' <span style="font-size:11px;color:#6b7280;font-weight:400">' + escapeHtml_(normalizeStockSymbol_(pos.symbol)) + '</span></td>' +
      '<td style="padding:8px 4px;text-align:right">' + formatNumber_(pos.quantity) + ' 주</td>' +
      '<td style="padding:8px 4px;text-align:right">' + formatNumber_(pos.entry_price) + ' 원</td>' +
      '<td style="padding:8px 4px;text-align:right">' + formatNumber_(pos.current_price) + ' 원</td>' +
      '<td style="padding:8px 4px;text-align:right;font-weight:700;color:' + retColor + '">' + retSign + formatPercentText_(pos.return_pct) + '</td>' +
      '<td style="padding:8px 4px;text-align:right;font-size:11px;color:#6b7280">' + pos.holding_days + ' 일째</td>' +
    '</tr>';
  }).join('');
  
  var posTable = activePositions.length === 0 ? 
    '<div style="font-size:13px;color:#6b7280;text-align:center;padding:12px 0">현재 가상 보유 포지션이 없습니다. (조건 체결 시 자동 매수)</div>' :
    '<table style="width:100%;border-collapse:collapse;font-size:12px">' +
      '<thead style="background:#f3f4f6;color:#4b5563">' +
        '<tr>' +
          '<th style="padding:6px 4px;text-align:left">종목명</th>' +
          '<th style="padding:6px 4px;text-align:right">보유수량</th>' +
          '<th style="padding:6px 4px;text-align:right">매수가</th>' +
          '<th style="padding:6px 4px;text-align:right">현재가</th>' +
          '<th style="padding:6px 4px;text-align:right">수익률</th>' +
          '<th style="padding:6px 4px;text-align:right">보유일</th>' +
        '</tr>' +
      '</thead>' +
      '<tbody>' + posRows + '</tbody>' +
    '</table>';
    
  var tradeRows = trades.map(function(t) {
    var isBuy = String(t.action_type).toUpperCase() === 'BUY';
    var badgeBg = isBuy ? '#fef2f2' : '#eff6ff';
    var badgeColor = isBuy ? '#991b1b' : '#1e40af';
    var actionKo = isBuy ? '가상매수' : '가상매도';
    
    return '<div style="font-size:12px;border-bottom:1px dashed #e5e7eb;padding:6px 0;line-height:1.5">' +
      '<span style="color:#6b7280;margin-right:6px">' + escapeHtml_(t.date) + '</span>' +
      '<span style="display:inline-block;padding:2px 6px;border-radius:4px;background:' + badgeBg + ';color:' + badgeColor + ';font-weight:700;font-size:11px;margin-right:8px">' + actionKo + '</span>' +
      '<strong>' + escapeHtml_(t.name) + '</strong> (' + formatNumber_(t.price) + '원, ' + t.quantity + '주) &nbsp; ' +
      '<span style="font-size:11px;color:#4b5563">' + escapeHtml_(t.reason || '') + '</span>' +
      '</div>';
  }).join('');
  
  var tradeBlock = trades.length === 0 ? 
    '<div style="font-size:12px;color:#6b7280;padding:6px 0">체결된 모의 거래 내역이 없습니다.</div>' : tradeRows;
    
  return '<h2 style="font-size:18px;margin:24px 0 8px">가상 투자 시뮬레이터 성과 (Paper Trading)</h2>' +
    '<div style="font-size:12px;color:#6b7280;line-height:1.5;margin:0 0 10px">주도주 스캐너의 1차 검토가/돌파 가격계획 진입 및 무효화 이탈 손절 규칙을 100% 기계적으로 적용한 모의 투자 성과 현황입니다.</div>' +
    
    '<div style="border:1px solid #bfdbfe;border-radius:8px;background:#f0f9ff;padding:14px;margin-bottom:12px">' +
      '<table style="width:100%;border-collapse:collapse;font-size:13px">' +
        '<tr>' +
          '<td style="color:#4b5563;padding:3px 0">가상 계좌 총자산:</td>' +
          '<td style="text-align:right;font-weight:800;font-size:15px;color:#0369a1">' + formatNumber_(total) + ' 원</td>' +
          '<td style="color:#4b5563;padding:3px 0;padding-left:16px">누적 수익률:</td>' +
          '<td style="text-align:right;font-weight:800;font-size:15px;color:' + cumColor + '">' + cumSign + formatPercentText_(cumulative) + '</td>' +
        '</tr>' +
        '<tr>' +
          '<td style="color:#4b5563;padding:3px 0">보유 예수금 현금:</td>' +
          '<td style="text-align:right">' + formatNumber_(cash) + ' 원</td>' +
          '<td style="color:#4b5563;padding:3px 0;padding-left:16px">일일 변동률:</td>' +
          '<td style="text-align:right;font-weight:700;color:' + dailyColor + '">' + dailySign + formatPercentText_(daily) + '</td>' +
        '</tr>' +
        '<tr>' +
          '<td style="color:#4b5563;padding:3px 0">가상 주식 평가액:</td>' +
          '<td style="text-align:right">' + formatNumber_(stock) + ' 원</td>' +
          '<td colspan="2">&nbsp;</td>' +
        '</tr>' +
      '</table>' +
    '</div>' +
    
    '<div style="border:1px solid #e5e7eb;border-radius:8px;padding:12px;margin-bottom:12px;background:#ffffff">' +
      '<div style="font-weight:700;font-size:13px;margin-bottom:8px;color:#1f2937">현재 가상 보유 종목</div>' +
      posTable +
    '</div>' +
    
    '<div style="border:1px solid #e5e7eb;border-radius:8px;padding:12px;background:#ffffff;margin-bottom:12px">' +
      '<div style="font-weight:700;font-size:13px;margin-bottom:6px;color:#1f2937">최근 가상 체결 내역 (최대 5건)</div>' +
      tradeBlock +
    '</div>';
}

/**
 * 장마감 이메일 리포트와 동일한 핵심 데이터를 텔레그램 메시지로 풍부하게 전송합니다.
 * 텔레그램 4096자 제한을 고려하여 최대 3개 메시지로 분할 전송합니다.
 */
function sendDailyTelegramReport_(payload, dateValue) {
  var indicatorMap = {};
  try {
    readObjects_(AM_CONFIG.SHEETS.INDICATORS_DAILY).forEach(function(row) {
      if (normalizeDateValue_(row.date) === normalizeDateValue_(dateValue)) {
        indicatorMap[normalizeStockSymbol_(row.symbol)] = row;
      }
    });
  } catch(e) {}

  // ── 메시지 1: 시장 진단 + 핵심 요약 ──
  var regime = payload.macro.market_regime || payload.briefing.market_regime || '중립';
  var macroScore = payload.macro.macro_alignment_score || '-';
  var summary = payload.briefing.summary || '';

  var daily = payload.paper_portfolio ? Number(payload.paper_portfolio.daily_return_pct || 0) : 0;
  var cumulative = payload.paper_portfolio ? Number(payload.paper_portfolio.cumulative_return_pct || 0) : 0;
  var total = payload.paper_portfolio ? Number(payload.paper_portfolio.total_eval_amount || 0) : 0;
  var dailySign = daily > 0 ? '+' : '';
  var cumSign = cumulative > 0 ? '+' : '';

  var msg1Lines = [
    '📊 <b>[AI 스캐너 장마감 풀 리포트]</b>',
    '📅 ' + dateValue,
    '',
    '━━━━━━━━━━━━━━━━━━━━━',
    '🎯 <b>시장 진단</b>: ' + regime + ' (매크로 점수 ' + macroScore + '/10)',
    '',
    '📝 <b>1분 요약</b>',
    summary,
    ''
  ];

  // 뉴스 핵심 요약 (상위 3개)
  if (payload.news && payload.news.length > 0) {
    msg1Lines.push('━━━━━━━━━━━━━━━━━━━━━');
    msg1Lines.push('📰 <b>주요 뉴스</b>');
    payload.news.slice(0, 3).forEach(function(n) {
      msg1Lines.push('• ' + (n.title || n.headline || ''));
    });
    msg1Lines.push('');
  }

  // 시나리오 요약
  if (payload.scenarios && payload.scenarios.length > 0) {
    msg1Lines.push('━━━━━━━━━━━━━━━━━━━━━');
    msg1Lines.push('🔮 <b>시나리오 전망</b>');
    payload.scenarios.slice(0, 3).forEach(function(s) {
      var label = s.label || s.scenario_label || '';
      var desc = s.description || s.action || '';
      msg1Lines.push('• <b>' + label + '</b>: ' + desc);
    });
    msg1Lines.push('');
  }

  // 모의투자 현황
  msg1Lines.push('━━━━━━━━━━━━━━━━━━━━━');
  msg1Lines.push('💰 <b>모의투자 현황</b>');
  msg1Lines.push('총자산: ' + formatNumber_(total) + ' 원');
  msg1Lines.push('일일 변동: ' + dailySign + formatPercentText_(daily));
  msg1Lines.push('누적 수익률: ' + cumSign + formatPercentText_(cumulative));

  sendTelegramMessage(msg1Lines.join('\n'));
  Utilities.sleep(500);

  // ── 메시지 2: 주도주 TOP 5 상세 ──
  var msg2Lines = [
    '🔥 <b>[주도주 TOP 5 상세]</b> ' + dateValue,
    ''
  ];
  (payload.leaders || []).slice(0, 5).forEach(function(l, idx) {
    var sym = normalizeStockSymbol_(l.symbol || '');
    var ind = indicatorMap[sym] || {};
    var trendBadge = (ind.trend_filter_passed === 'N') ? '🔴역배열' : '🟢정배열';
    var plan = null;
    if (payload.plans) {
      for (var pi = 0; pi < payload.plans.length; pi++) {
        if (normalizeStockSymbol_(payload.plans[pi].symbol) === sym) {
          plan = payload.plans[pi]; break;
        }
      }
    }
    msg2Lines.push((idx + 1) + '. <b>' + l.name + '</b> (' + sym + ') ' + trendBadge);
    msg2Lines.push('   섹터: ' + (l.sector || '-') + ' | 총점: ' + (l.total_score || '-') + '점');
    if (plan) {
      if (plan.first_entry_price) msg2Lines.push('   📍 1차 검토가: ' + formatNumber_(plan.first_entry_price));
      if (plan.invalid_price) msg2Lines.push('   ⛔ 무효화 가격: ' + formatNumber_(plan.invalid_price));
    }
    msg2Lines.push('');
  });

  // 코스닥 TOP 3
  if (payload.kosdaq_leaders && payload.kosdaq_leaders.length > 0) {
    msg2Lines.push('━━━━━━━━━━━━━━━━━━━━━');
    msg2Lines.push('📈 <b>코스닥 주도주 TOP 3</b>');
    payload.kosdaq_leaders.slice(0, 3).forEach(function(kl, idx) {
      msg2Lines.push((idx + 1) + '. ' + kl.name + ' (' + normalizeStockSymbol_(kl.symbol) + ') 총점 ' + (kl.total_score || '-'));
    });
  }

  sendTelegramMessage(msg2Lines.join('\n'));
  Utilities.sleep(500);

  // ── 메시지 3: 보유종목 어드바이스 ──
  if (payload.holdings_advice && payload.holdings_advice.length > 0) {
    var msg3Lines = [
      '📋 <b>[보유종목 AI 어드바이스]</b> ' + dateValue,
      ''
    ];
    payload.holdings_advice.forEach(function(ha) {
      var actionBadge = '';
      var act = String(ha.action_view || '').toLowerCase();
      if (act === 'hold_watch') actionBadge = '🟢 보유관찰';
      else if (act === 'risk_reduce_review') actionBadge = '🟡 리스크점검';
      else if (act === 'avoid_add') actionBadge = '🔴 추가매수금지';
      else actionBadge = '⚪ 재점검필요';

      msg3Lines.push('<b>' + (ha.name || ha.symbol) + '</b> ' + actionBadge);
      if (ha.summary) msg3Lines.push('  ' + ha.summary);
      if (ha.risk_comment) msg3Lines.push('  ⚠️ ' + ha.risk_comment);
      msg3Lines.push('');
    });

    // 포트폴리오 리스크 경고
    if (payload.portfolio_risks && payload.portfolio_risks.length > 0) {
      msg3Lines.push('━━━━━━━━━━━━━━━━━━━━━');
      msg3Lines.push('⚠️ <b>포트폴리오 리스크</b>');
      payload.portfolio_risks.forEach(function(pr) {
        msg3Lines.push('• ' + (pr.message || ''));
      });
    }

    sendTelegramMessage(msg3Lines.join('\n'));
  }
}
