function runGeminiDiagnostics() {
  return withLogging_('gemini_diagnostics', function() {
    var apiKey = getRequiredScriptProperty_(AM_CONFIG.PROPERTY_KEYS.GEMINI_API_KEY);
    var models = getGeminiModelCandidates_('diagnostics');
    var result = callGeminiJson_([
      'Return JSON only.',
      'Schema: {"status":"ok","message":"short Korean message"}',
      'This is a connection test for a Google Apps Script stock analysis assistant.'
    ].join('\n'), {
      maxOutputTokens: 256,
      modelUseCase: 'diagnostics'
    });
    logInfo_('gemini_diagnostics', 'Gemini connection diagnostics completed', {
      key: maskSecret_(apiKey),
      model_candidates: models,
      result: result
    });
    safeUiAlert_([
      'Gemini 연결 진단',
      '',
      'GEMINI_API_KEY: OK',
      '모델 후보: ' + models.join(' -> '),
      '응답: 정상',
      '',
      JSON.stringify(result)
    ].join('\n'));
    return result;
  });
}

function runGeminiModelPolicyDiagnostics() {
  return withLogging_('gemini_model_policy', function() {
    var result = {
      override_model: getGeminiModel_() || '(none)',
      daily_market: getGeminiModelCandidates_('daily_market'),
      daily_stock_top: getGeminiModelCandidates_('daily_stock_top'),
      daily_stock_rest: getGeminiModelCandidates_('daily_stock_rest'),
      premarket: getGeminiModelCandidates_('premarket'),
      weekly: getGeminiModelCandidates_('weekly'),
      news_grounding: getGeminiGroundingModelCandidates_('news_grounding'),
      cheap_backup: getGeminiModelCandidates_('cheap_backup')
    };
    logInfo_('gemini_model_policy', 'Gemini model policy checked', result);
    safeUiAlert_([
      'Gemini 모델 정책',
      '',
      'GEMINI_MODEL 우선 지정: ' + result.override_model,
      '',
      '장마감 시장 판단: ' + result.daily_market.join(' -> '),
      '',
      '장마감 TOP 핵심 종목: ' + result.daily_stock_top.join(' -> '),
      '',
      '장마감 나머지 종목: ' + result.daily_stock_rest.join(' -> '),
      '',
      '장전 요약: ' + result.premarket.join(' -> '),
      '',
      '주간 심층 리뷰: ' + result.weekly.join(' -> '),
      '',
      '뉴스 Search Grounding: ' + result.news_grounding.join(' -> '),
      '',
      '저비용 백업: ' + result.cheap_backup.join(' -> ')
    ].join('\n'));
    return result;
  });
}

function applyGeminiCostAwareModelPolicy() {
  return withLogging_('gemini_model_policy', function() {
    ensureAllSheets_();
    var rows = getGeminiCostAwarePolicyRows_();
    upsertKeyValueRows_(AM_CONFIG.SHEETS.SETTINGS, rows);
    logInfo_('gemini_model_policy', 'Cost-aware Gemini model policy applied', { count: rows.length });
    safeUiAlert_([
      'Gemini 비용 효율 모델 정책 적용 완료',
      '',
      '장마감 시장 판단: gemini-3.5-flash 우선',
      '장마감 TOP 핵심 종목: gemini-3.5-flash 우선',
      '장마감 나머지 종목: gemini-3.1-flash-lite 우선',
      '장전/뉴스/진단: 저비용 모델 우선',
      '',
      '다음: Gemini 모델 정책 확인을 실행해 실제 우선순위를 확인하세요.'
    ].join('\n'));
    return rows;
  });
}

function getGeminiCostAwarePolicyRows_() {
  return [
    { key: 'gemini_premium_stock_top_n', value: 4, description: 'Top N stocks that use the premium daily stock model policy' },
    { key: 'gemini_models_daily_market', value: 'gemini-3.5-flash,gemini-3.1-flash-lite,gemini-2.5-flash', description: 'Cost-aware policy: premium model for daily close market-level expert judgment' },
    { key: 'gemini_models_daily_stock_top', value: 'gemini-3.5-flash,gemini-3.1-flash-lite,gemini-2.5-flash', description: 'Cost-aware policy: premium model for top-ranked daily stock expert notes' },
    { key: 'gemini_models_daily_stock_rest', value: 'gemini-3.1-flash-lite,gemini-2.5-flash-lite,gemini-2.5-flash', description: 'Cost-aware policy: lower-cost model for remaining daily stock notes' },
    { key: 'gemini_models_daily_close', value: 'gemini-3.5-flash,gemini-3.1-flash-lite,gemini-2.5-flash,gemini-2.5-flash-lite', description: 'Legacy daily close model priority fallback' },
    { key: 'gemini_models_premarket', value: 'gemini-3.1-flash-lite,gemini-2.5-flash-lite,gemini-3.5-flash', description: 'Cost-aware policy: cheaper model first for premarket quick report' },
    { key: 'gemini_models_weekly', value: 'gemini-3.1-pro-preview,gemini-2.5-pro,gemini-3.5-flash,gemini-3.1-flash-lite', description: 'Cost-aware policy: premium model first for weekly deep review' },
    { key: 'gemini_models_news_grounding', value: 'gemini-2.5-flash-lite,gemini-3.1-flash-lite,gemini-2.5-flash,gemini-3.5-flash', description: 'Cost-aware policy: cheaper model first for Search Grounding news collection' },
    { key: 'gemini_models_cheap_backup', value: 'gemini-2.5-flash-lite,gemini-2.5-flash', description: 'Low-cost backup model priority' }
  ];
}

function buildAiReports() {
  return withLogging_('gemini_report', function() {
    ensureAllSheets_();
    var today = amTodayString_();
    var state = getFullWorkflowState_();

    // 수동 실행 시: 워크플로우 상태가 오늘 gemini 단계가 아니면 신규 세션으로 초기화
    if (normalizeDateValue_(state.date) !== today || state.stage !== 'gemini') {
      state = {
        date: today,
        stage: 'gemini',
        started_at: state.started_at || amNowString_(),
        updated_at: amNowString_()
      };
      saveFullWorkflowState_(state);
    }

    var deadline = new Date().getTime() + 330000; // 5분 30초 안전 마진
    state = continueAiReportsForLeaders_(state, deadline);

    if (state.stage === 'gemini') {
      // 시간 제한으로 분할 실행 → 1분 뒤 자동 이어서 실행 트리거 예약
      scheduleFullWorkflowContinuation_();
      safeUiAlert_([
        'Gemini AI 리포트 생성 중 (시간 제한으로 분할 실행)',
        '',
        '진행 위치: ' + (state.gemini_index || 0) + ' / ' + (state.gemini_total || ''),
        '시장 브리핑: ' + (state.gemini_market_done ? '완료' : '대기'),
        '',
        '남은 종목은 1분 뒤 자동 트리거로 이어서 채워집니다.',
        '약 1분 뒤 AI Scanner > 진행 상태 확인을 눌러 확인하세요.'
      ].join('\n'));
    } else {
      var stockCount = countRowsByDate_(AM_CONFIG.SHEETS.AI_STOCK_ANALYSIS, today);
      safeUiAlert_([
        'Gemini AI 리포트 생성 완료',
        '',
        '시장 브리핑: 정상',
        '종목 분석 행 수: ' + stockCount,
        '',
        '결과 시트: ai_market_briefing, ai_stock_analysis'
      ].join('\n'));
    }
    return state;
  });
}

function continueAiReportsForLeaders_(state, deadline) {
  var today = normalizeDateValue_(state.date || amTodayString_());
  ensureAllSheets_();
  ensureBacktestLogForToday_();
  ensurePremarketResultReviewForToday_();
  var input = buildAiReportInput_(today);

  if (input.leaders.length === 0) {
    throw new Error(buildMissingAiInputMessage_(today, AM_CONFIG.SHEETS.LEADER_50));
  }
  if (input.entry_plans.length === 0) {
    throw new Error(buildMissingAiInputMessage_(today, AM_CONFIG.SHEETS.ENTRY_PLAN));
  }

  // ── 1단계: 첫 진입 시 초기화 ── 규칙 기반 Fallback을 먼저 기록
  if (!state.gemini_initialized) {
    deleteRowsByDate_(AM_CONFIG.SHEETS.AI_MARKET_BRIEFING, today);
    deleteRowsByDate_(AM_CONFIG.SHEETS.AI_STOCK_ANALYSIS, today);

    var fallbackReport = buildRuleBasedGeminiFallbackReport_(input, null);
    appendAiMarketBriefingRow_(today, fallbackReport.market_briefing);
    fallbackReport.stocks.forEach(function(stock) {
      appendAiStockAnalysisRow_(today, stock);
    });
    SpreadsheetApp.flush();

    state.gemini_index = 0;
    state.gemini_total = input.leaders.length;
    state.gemini_market_done = false;
    state.gemini_initialized = true;
    state.updated_at = amNowString_();
    saveFullWorkflowState_(state);
    logInfo_('gemini_report', 'Gemini milestone initialized with rule-based fallback', {
      date: today,
      leader_count: input.leaders.length
    });
  }

  // ── 2단계: 시장 브리핑 생성 (미완료 시) ──
  if (!state.gemini_market_done && new Date().getTime() < deadline - 30000) {
    var fallbackForMarket = buildRuleBasedGeminiFallbackReport_(input, null);
    try {
      var marketBriefing = callGeminiJson_(buildGeminiMarketPrompt_(input), {
        maxOutputTokens: 2048,
        temperature: 0.2,
        modelUseCase: 'daily_market'
      });
      marketBriefing = normalizeGeminiMarketBriefing_(marketBriefing, fallbackForMarket.market_briefing);
      replaceAiMarketBriefingRow_(today, marketBriefing);
    } catch (err) {
      logWarn_('gemini_report', 'Gemini market briefing failed; using rule-based fallback', {
        date: today,
        error: err.message || String(err)
      });
    }
    state.gemini_market_done = true;
    state.updated_at = amNowString_();
    saveFullWorkflowState_(state);
    logInfo_('gemini_report', 'Gemini market briefing step completed', { date: today });
  }

  // ── 3단계: 종목 분석 청크 분할 + 잔여 시간 검사 루프 ──
  var chunkSize = Math.max(1, getSettingNumber_('gemini_stock_chunk_size', 2));
  var premiumTopN = Math.max(1, getSettingNumber_('gemini_premium_stock_top_n', 4));

  while (
    Number(state.gemini_index || 0) < input.leaders.length &&
    new Date().getTime() < deadline - 30000
  ) {
    var index = Number(state.gemini_index || 0);
    var leaderChunk = input.leaders.slice(index, index + chunkSize);
    var chunkUseCase = leaderChunk.some(function(row) {
      return Number(row.rank || 999) <= premiumTopN;
    }) ? 'daily_stock_top' : 'daily_stock_rest';

    var chunkInput = {
      date: input.date,
      macro: input.macro,
      news: input.news,
      news_scores: input.news_scores,
      market_breadth: input.market_breadth,
      scenarios: input.scenarios,
      market_regime: input.market_regime,
      safety_policy: input.safety_policy,
      leaders: leaderChunk
    };

    try {
      var chunkResult = callGeminiJson_(buildGeminiStocksPrompt_(chunkInput), {
        maxOutputTokens: 3072,
        temperature: 0.2,
        modelUseCase: chunkUseCase
      });
      validateGeminiStocksChunk_(chunkResult, leaderChunk);
      chunkResult.stocks.forEach(function(stock, offset) {
        var normalized = normalizeGeminiStockAnalysis_(stock, leaderChunk[offset]);
        replaceAiStockAnalysisRow_(today, normalized);
      });
    } catch (err) {
      logWarn_('gemini_report', 'Gemini stock chunk failed; keeping rule-based fallback rows', {
        date: today,
        start_rank: leaderChunk[0] ? leaderChunk[0].rank : '',
        end_rank: leaderChunk[leaderChunk.length - 1] ? leaderChunk[leaderChunk.length - 1].rank : '',
        error: err.message || String(err)
      });
    }

    state.gemini_index = index + leaderChunk.length;
    state.updated_at = amNowString_();
    saveFullWorkflowState_(state);
    logInfo_('gemini_report', 'Gemini stock chunk completed', {
      date: today,
      index: state.gemini_index,
      total: state.gemini_total
    });
  }

  // ── 4단계: 전체 완료 시 상태 정리 ──
  if (Number(state.gemini_index || 0) >= input.leaders.length && state.gemini_market_done) {
    delete state.gemini_initialized;
    delete state.gemini_index;
    delete state.gemini_total;
    delete state.gemini_market_done;
    state.stage = 'gemini_done';
    state.updated_at = amNowString_();
    logInfo_('gemini_report', 'All Gemini AI reports completed', { date: today, stocks: input.leaders.length });
  }

  return state;
}

function buildAiReportInput_(dateValue) {
  var today = normalizeDateValue_(dateValue);
  var leaders = readObjects_(AM_CONFIG.SHEETS.LEADER_50).filter(function(row) {
    return normalizeDateValue_(row.date) === today;
  }).slice(0, getSettingNumber_('report_top_n', 10));
  var plans = readObjects_(AM_CONFIG.SHEETS.ENTRY_PLAN).filter(function(row) {
    return normalizeDateValue_(row.date) === today;
  });
  var risks = readObjects_(AM_CONFIG.SHEETS.RISK_ALERTS).filter(function(row) {
    return normalizeDateValue_(row.date) === today;
  });
  var scenarios = readObjects_(AM_CONFIG.SHEETS.SCENARIO_DAILY).filter(function(row) {
    return normalizeDateValue_(row.date) === today;
  });
  var financials = readObjects_(AM_CONFIG.SHEETS.FINANCIAL_RATIOS).filter(function(row) {
    return normalizeDateValue_(row.date) === today;
  });
  var candidates = readObjects_(AM_CONFIG.SHEETS.LEADER_CANDIDATES).filter(function(row) {
    return normalizeDateValue_(row.date) === today;
  });
  var indicators = readObjects_(AM_CONFIG.SHEETS.INDICATORS_DAILY).filter(function(row) {
    return normalizeDateValue_(row.date) === today;
  });
  var etfScores = readObjects_(AM_CONFIG.SHEETS.ETF_STOCK_SCORE).filter(function(row) {
    return normalizeDateValue_(row.date) === today;
  });
  var flows = readObjects_(AM_CONFIG.SHEETS.INVESTOR_FLOW_SCORE).filter(function(row) {
    return normalizeDateValue_(row.date) === today;
  });
  var leaderHistory = readObjects_(AM_CONFIG.SHEETS.LEADER_HISTORY).filter(function(row) {
    return normalizeDateValue_(row.date) === today;
  });
  var backtestRows = readObjects_(AM_CONFIG.SHEETS.BACKTEST_LOG).filter(function(row) {
    return normalizeDateValue_(row.date) === today;
  });
  var premarketReviewRows = readObjects_(AM_CONFIG.SHEETS.PREMARKET_RESULT_REVIEW).filter(function(row) {
    return normalizeDateValue_(row.date) === today;
  });
  var sectors = readObjects_(AM_CONFIG.SHEETS.SECTOR_STRENGTH_DAILY).filter(function(row) {
    return normalizeDateValue_(row.date) === today;
  });
  var breadth = readObjects_(AM_CONFIG.SHEETS.MARKET_BREADTH_DAILY).filter(function(row) {
    return normalizeDateValue_(row.date) === today;
  });
  var newsScores = readObjects_(AM_CONFIG.SHEETS.NEWS_SCORE_DAILY).filter(function(row) {
    return normalizeDateValue_(row.date) === today;
  });
  var news = readObjects_(AM_CONFIG.SHEETS.NEWS_BRIEFING).filter(function(row) {
    return normalizeDateValue_(row.date) === today;
  }).map(function(row) {
    return {
      session: row.session,
      summary: parseJsonCell_(row.summary_json, {}),
      sources: parseJsonCell_(row.sources_json, [])
    };
  });
  var macro = getLatestMacroSnapshot_();
  return {
    date: today,
    market_calendar: getMarketCalendarSummary_(today),
    macro: macro,
    news: news,
    news_scores: newsScores,
    market_breadth: breadth,
    market_regime: macro.market_regime || inferMarketRegimeFromScenario_(scenarios),
    safety_policy: {
      role: 'interpretation_only',
      forbidden: ['buy recommendation', 'strong buy', 'certainty that price will rise tomorrow', 'direct order to buy at a price', 'guaranteed profit'],
      allowed: ['conditional watch price', 'split-entry candidate', 'scenario validity condition', 'invalidation price', 'needs observation', 'avoid chasing', 'high risk']
    },
    leaders: leaders.map(function(row) {
      return compactLeaderForGemini_(row, plans, risks, financials, candidates, indicators, etfScores, flows, sectors);
    }),
    entry_plans: plans.map(compactEntryPlanForGemini_),
    risk_alerts: risks.map(compactRiskAlertForGemini_),
    scenarios: scenarios,
    leader_history: compactLeaderHistoryForGemini_(leaderHistory),
    backtest: compactBacktestForGemini_(backtestRows),
    premarket_review: compactPremarketReviewForGemini_(premarketReviewRows)
  };
}

function compactPremarketReviewForGemini_(rows) {
  return (rows || []).slice(0, 3).map(function(row) {
    return {
      date: normalizeDateValue_(row.date),
      base_leader_date: normalizeDateValue_(row.base_leader_date),
      market_bias: row.market_bias,
      actual_market_regime: row.actual_market_regime,
      bias_score: Number(row.bias_score || 0),
      watch_count: Number(row.watch_count || 0),
      watch_positive_count: Number(row.watch_positive_count || 0),
      watch_avg_return_pct: Number(row.watch_avg_return_pct || 0),
      sector_match_score: Number(row.sector_match_score || 0),
      prediction_score: Number(row.prediction_score || 0),
      summary: row.summary
    };
  });
}

function compactBacktestForGemini_(rows) {
  return (rows || []).slice(0, 30).map(function(row) {
    return {
      list_type: row.list_type,
      symbol: normalizeStockSymbol_(row.symbol),
      name: row.name,
      rank: Number(row.rank || 0),
      base_date: normalizeDateValue_(row.base_date),
      next_return_pct: Number(row.next_return_pct || 0),
      first_entry_hit: row.first_entry_hit,
      breakout_hit: row.breakout_hit,
      invalid_hit: row.invalid_hit,
      result: row.result,
      memo: row.memo
    };
  });
}

function compactLeaderHistoryForGemini_(rows) {
  return (rows || []).filter(function(row) {
    var status = String(row.status || '');
    return status === '신규' || status === '상승' || status === '이탈';
  }).slice(0, 40).map(function(row) {
    return {
      list_type: row.list_type,
      symbol: normalizeStockSymbol_(row.symbol),
      name: row.name,
      sector: row.sector,
      rank: Number(row.rank || 0),
      previous_rank: Number(row.previous_rank || 0),
      rank_change: Number(row.rank_change || 0),
      status: row.status,
      total_score: Number(row.total_score || 0),
      previous_total_score: Number(row.previous_total_score || 0)
    };
  });
}

function buildMissingAiInputMessage_(dateValue, missingSheetName) {
  var today = normalizeDateValue_(dateValue);
  var counts = {};
  [
    AM_CONFIG.SHEETS.MARKET_DAILY,
    AM_CONFIG.SHEETS.INDICATORS_DAILY,
    AM_CONFIG.SHEETS.LEADER_CANDIDATES,
    AM_CONFIG.SHEETS.LEADER_50,
    AM_CONFIG.SHEETS.ENTRY_PLAN
  ].forEach(function(sheetName) {
    counts[sheetName] = countRowsByDate_(sheetName, today);
  });
  return [
    today + ' 기준 ' + missingSheetName + ' 시트에 데이터가 없습니다.',
    '해당 날짜의 핵심 파이프라인이 아직 완료되지 않았습니다.',
    '현재 건수: market_daily=' + counts[AM_CONFIG.SHEETS.MARKET_DAILY] +
      ', indicators_daily=' + counts[AM_CONFIG.SHEETS.INDICATORS_DAILY] +
      ', leader_candidates=' + counts[AM_CONFIG.SHEETS.LEADER_CANDIDATES] +
      ', leader_50=' + counts[AM_CONFIG.SHEETS.LEADER_50] +
      ', entry_plan=' + counts[AM_CONFIG.SHEETS.ENTRY_PLAN] + '.',
    'AI Scanner > 핵심 파이프라인 상태를 확인하고, 완료 전이면 핵심 파이프라인 이어서 실행을 누르세요.'
  ].join(' ');
}

function countRowsByDate_(sheetName, dateValue) {
  var target = normalizeDateValue_(dateValue);
  return readObjects_(sheetName).filter(function(row) {
    return normalizeDateValue_(row.date) === target;
  }).length;
}

function compactLeaderForGemini_(row, plans, risks, financials, candidates, indicators, etfScores, flows, sectors) {
  var symbol = normalizeStockSymbol_(row.symbol);
  var plan = findFirstBySymbol_(plans, symbol) || {};
  var financial = findFirstBySymbol_(financials, symbol) || {};
  var candidate = findFirstBySymbol_(candidates || [], symbol) || {};
  var indicator = findFirstBySymbol_(indicators || [], symbol) || {};
  var etf = findFirstBySymbol_(etfScores || [], symbol) || {};
  var flow = findFirstBySymbol_(flows || [], symbol) || {};
  var sector = findFirstBySector_(sectors || [], row.sector) || {};
  var symbolRisks = risks.filter(function(risk) {
    return normalizeStockSymbol_(risk.symbol) === symbol;
  }).map(compactRiskAlertForGemini_);
  return {
    rank: Number(row.rank),
    symbol: symbol,
    name: row.name,
    sector: row.sector,
    close: Number(row.close),
    change_pct: Number(row.change_pct),
    trading_value: Number(row.trading_value),
    leader_score: Number(row.leader_score),
    chart_score: Number(candidate.chart_score || indicator.chart_score || 0),
    etf_score: Number(row.etf_score || etf.etf_score || 0),
    flow_score: Number(row.flow_score || flow.combined_flow_score || 0),
    financial_score: Number(row.financial_score),
    risk_level: row.risk_level,
    total_score: Number(row.total_score),
    score_breakdown: {
      leader_score: Number(row.leader_score || 0),
      chart_score: Number(candidate.chart_score || indicator.chart_score || 0),
      etf_score: Number(row.etf_score || etf.etf_score || 0),
      flow_score: Number(row.flow_score || flow.combined_flow_score || 0),
      financial_score: Number(row.financial_score || financial.financial_score || 0),
      macro_score: Number(candidate.macro_score || 0),
      sector_score: Number(candidate.sector_score || sector.sector_score || 0),
      risk_penalty: Number(candidate.risk_penalty || 0),
      total_score: Number(row.total_score || 0)
    },
    chart: {
      ma5: Number(indicator.ma5 || 0),
      ma20: Number(indicator.ma20 || 0),
      ma60: Number(indicator.ma60 || 0),
      rsi14: Number(indicator.rsi14 || 0),
      volume_ratio: Number(indicator.volume_ratio || 0),
      near_52w_high_pct: Number(indicator.near_52w_high_pct || 0)
    },
    etf: {
      etf_count: Number(etf.etf_count || 0),
      avg_weight_pct: Number(etf.avg_weight_pct || 0),
      sector_etf_count: Number(etf.sector_etf_count || 0),
      etf_score: Number(etf.etf_score || row.etf_score || 0)
    },
    flow: {
      foreign_score: Number(flow.foreign_score || 0),
      institution_score: Number(flow.institution_score || 0),
      combined_flow_score: Number(flow.combined_flow_score || row.flow_score || 0),
      flow_comment: flow.flow_comment || ''
    },
    sector_strength: {
      sector_score: Number(sector.sector_score || candidate.sector_score || 0),
      avg_change_pct: Number(sector.avg_change_pct || 0),
      up_ratio: Number(sector.up_ratio || 0),
      relative_trading_value_pct: Number(sector.relative_trading_value_pct || 0)
    },
    entry_plan: compactEntryPlanForGemini_(plan),
    financial: {
      revenue_growth: Number(financial.revenue_growth || 0),
      op_income_growth: Number(financial.op_income_growth || 0),
      op_margin: Number(financial.op_margin || 0),
      roe: Number(financial.roe || 0),
      debt_ratio: Number(financial.debt_ratio || 0),
      financial_score: Number(financial.financial_score || row.financial_score || 0)
    },
    risk_alerts: symbolRisks
  };
}

function findFirstBySector_(rows, sectorName) {
  var target = String(sectorName || '').trim();
  for (var i = 0; i < rows.length; i += 1) {
    if (String(rows[i].sector || '').trim() === target) return rows[i];
  }
  return null;
}

function compactEntryPlanForGemini_(row) {
  return {
    symbol: normalizeStockSymbol_(row.symbol),
    name: row.name,
    current_price: Number(row.current_price || 0),
    first_entry_price: Number(row.first_entry_price || 0),
    first_entry_pct: Number(row.first_entry_pct || 0),
    second_entry_price: Number(row.second_entry_price || 0),
    second_entry_pct: Number(row.second_entry_pct || 0),
    breakout_price: Number(row.breakout_price || 0),
    breakout_entry_pct: Number(row.breakout_entry_pct || 0),
    invalid_price: Number(row.invalid_price || 0),
    max_position_pct: Number(row.max_position_pct || 0),
    scenario: row.scenario || 'neutral',
    memo: row.memo || ''
  };
}

function compactRiskAlertForGemini_(row) {
  return {
    symbol: normalizeStockSymbol_(row.symbol),
    risk_type: row.risk_type,
    risk_level: row.risk_level,
    message: row.message,
    source: row.source
  };
}

function findFirstBySymbol_(rows, symbol) {
  var target = normalizeStockSymbol_(symbol);
  for (var i = 0; i < rows.length; i += 1) {
    if (normalizeStockSymbol_(rows[i].symbol) === target) return rows[i];
  }
  return null;
}

function inferMarketRegimeFromScenario_(scenarios) {
  if (!scenarios || scenarios.length === 0) return 'neutral';
  return 'neutral';
}

function buildGeminiReportInChunks_(input) {
  var marketBriefing = callGeminiJson_(buildGeminiMarketPrompt_(input), {
    maxOutputTokens: 2048,
    temperature: 0.2,
    modelUseCase: 'daily_market'
  });
  var stocks = [];
  var chunkSize = 2;
  var premiumTopN = Math.max(1, getSettingNumber_('gemini_premium_stock_top_n', 4));
  for (var i = 0; i < input.leaders.length; i += chunkSize) {
    var leaderChunk = input.leaders.slice(i, i + chunkSize);
    var chunkUseCase = leaderChunk.some(function(row) {
      return Number(row.rank || 999) <= premiumTopN;
    }) ? 'daily_stock_top' : 'daily_stock_rest';
    var chunkInput = {
      date: input.date,
      macro: input.macro,
      news: input.news,
      news_scores: input.news_scores,
      market_breadth: input.market_breadth,
      scenarios: input.scenarios,
      market_regime: input.market_regime,
      safety_policy: input.safety_policy,
      leaders: leaderChunk
    };
    var chunkResult = callGeminiJson_(buildGeminiStocksPrompt_(chunkInput), {
      maxOutputTokens: 4096,
      temperature: 0.2,
      modelUseCase: chunkUseCase
    });
    validateGeminiStocksChunk_(chunkResult, chunkInput.leaders);
    stocks = stocks.concat(chunkResult.stocks);
  }
  return {
    market_briefing: marketBriefing,
    stocks: stocks
  };
}

function buildAndSaveGeminiReportIncrementally_(dateValue, input) {
  var today = normalizeDateValue_(dateValue);
  deleteRowsByDate_(AM_CONFIG.SHEETS.AI_MARKET_BRIEFING, today);
  deleteRowsByDate_(AM_CONFIG.SHEETS.AI_STOCK_ANALYSIS, today);

  var fallbackReport = buildRuleBasedGeminiFallbackReport_(input, null);
  appendAiMarketBriefingRow_(today, fallbackReport.market_briefing);
  fallbackReport.stocks.forEach(function(stock) {
    appendAiStockAnalysisRow_(today, stock);
  });

  var marketBriefing = fallbackReport.market_briefing;
  try {
    marketBriefing = callGeminiJson_(buildGeminiMarketPrompt_(input), {
      maxOutputTokens: 2048,
      temperature: 0.2,
      modelUseCase: 'daily_market'
    });
    marketBriefing = normalizeGeminiMarketBriefing_(marketBriefing, fallbackReport.market_briefing);
    replaceAiMarketBriefingRow_(today, marketBriefing);
  } catch (err) {
    logWarn_('gemini_report', 'Gemini market briefing failed; using rule-based fallback', {
      date: today,
      error: err.message || String(err)
    });
  }

  var stocks = fallbackReport.stocks.slice();
  var chunkSize = Math.max(1, getSettingNumber_('gemini_stock_chunk_size', 2));
  var premiumTopN = Math.max(1, getSettingNumber_('gemini_premium_stock_top_n', 4));
  for (var i = 0; i < input.leaders.length; i += chunkSize) {
    var leaderChunk = input.leaders.slice(i, i + chunkSize);
    var chunkUseCase = leaderChunk.some(function(row) {
      return Number(row.rank || 999) <= premiumTopN;
    }) ? 'daily_stock_top' : 'daily_stock_rest';
    var chunkInput = {
      date: input.date,
      macro: input.macro,
      news: input.news,
      news_scores: input.news_scores,
      market_breadth: input.market_breadth,
      scenarios: input.scenarios,
      market_regime: input.market_regime,
      safety_policy: input.safety_policy,
      leaders: leaderChunk
    };
    try {
      var chunkResult = callGeminiJson_(buildGeminiStocksPrompt_(chunkInput), {
        maxOutputTokens: 3072,
        temperature: 0.2,
        modelUseCase: chunkUseCase
      });
      validateGeminiStocksChunk_(chunkResult, leaderChunk);
      chunkResult.stocks.forEach(function(stock, offset) {
        var normalized = normalizeGeminiStockAnalysis_(stock, leaderChunk[offset]);
        replaceAiStockAnalysisRow_(today, normalized);
        stocks = replaceStockInArray_(stocks, normalized);
      });
    } catch (err) {
      logWarn_('gemini_report', 'Gemini stock chunk failed; keeping rule-based fallback rows', {
        date: today,
        start_rank: leaderChunk[0] ? leaderChunk[0].rank : '',
        end_rank: leaderChunk[leaderChunk.length - 1] ? leaderChunk[leaderChunk.length - 1].rank : '',
        error: err.message || String(err)
      });
    }
  }

  return {
    market_briefing: marketBriefing,
    stocks: stocks
  };
}

function buildRuleBasedGeminiFallbackReport_(input, error) {
  return {
    market_briefing: buildRuleBasedGeminiMarketFallback_(input, error),
    stocks: (input.leaders || []).map(function(leader) {
      return buildRuleBasedGeminiStockFallback_(leader, error);
    })
  };
}

function buildRuleBasedGeminiMarketFallback_(input, error) {
  var macro = input.macro || {};
  var regime = input.market_regime || macro.market_regime || 'neutral';
  var breadth = findMarketBreadthForFallback_(input.market_breadth, 'ALL');
  var topSectors = summarizeTopSectorsForFallback_(input.leaders || []);
  var newsTone = summarizeNewsToneForFallback_(input.news_scores || []);
  var dataQualityNotes = [];
  if (error) {
    dataQualityNotes.push('Gemini 응답이 불안정해 규칙 기반 요약을 먼저 저장했습니다.');
  }
  if (!input.news || input.news.length === 0) {
    dataQualityNotes.push('뉴스 브리핑 데이터가 부족해 가격, 거시지표, 시장 폭 중심으로 해석했습니다.');
  }
  if (!hasPositiveFlowScoreForFallback_(input.leaders || [])) {
    dataQualityNotes.push('외국인/기관 수급 데이터가 없거나 제한적이어서 수급 점수는 보수적으로 반영했습니다.');
  }
  if (dataQualityNotes.length === 0) {
    dataQualityNotes.push('핵심 데이터 수집은 완료됐고, 리포트 문장은 규칙 기반 안전 요약으로 보강됐습니다.');
  }
  return {
    market_regime: regime,
    summary: '거시 점수, 뉴스 점수, 시장 폭, 섹터 강도, 주도주 점수를 기준으로 ' + describeRegimeKoForFallback_(regime) + ' 관점의 조건부 관찰이 필요합니다.',
    sector_view: topSectors.length > 0
      ? topSectors.map(function(text) { return text + ' 섹터의 상대 강도를 우선 확인합니다.'; })
      : ['강한 섹터가 뚜렷하지 않으면 상위 종목도 가격 조건을 기다립니다.'],
    risk_view: [
      newsTone,
      breadth && breadth.breadth_score ? '시장 폭 점수는 ' + breadth.breadth_score + '점으로, 지수보다 상승 종목 확산 여부를 같이 확인해야 합니다.' : '시장 폭 데이터가 제한적이어서 지수와 개별 종목 반응을 함께 봅니다.'
    ],
    expert_takeaways: [
      '오늘 리포트는 자동매매 신호가 아니라 장마감 후 조건부 점검 자료입니다.',
      '상위 후보라도 무효화 가격 이탈, 거래대금 감소, 위험 공시가 있으면 관찰 강도를 낮춥니다.'
    ],
    beginner_actions: [
      '먼저 시장 자세를 확인하고, 관심 종목은 1차 검토가와 무효화 가격만 체크합니다.',
      '장 초반 급등 종목을 따라가기보다 거래대금 유지와 섹터 동반 강세를 확인합니다.'
    ],
    avoid_actions: [
      '무효화 가격 아래에서 물타기하지 않습니다.',
      '뉴스가 위험 회피 쪽이면 신규 진입 검토 수를 줄입니다.'
    ],
    data_quality_notes: dataQualityNotes,
    next_day_scenarios: {
      up: scenarioTextForFallback_(input.scenarios, 'up', '조건: 금리와 환율 안정, 나스닥 반등, 시장 폭 개선. 대응: 상위 후보 중 눌림 또는 돌파 확인 종목만 관찰합니다.'),
      neutral: scenarioTextForFallback_(input.scenarios, 'neutral', '조건: 지수 박스권과 섹터 순환매. 대응: 신규 검토를 줄이고 1차 검토가 중심으로만 봅니다.'),
      down: scenarioTextForFallback_(input.scenarios, 'down', '조건: 금리 또는 환율 상승, 나스닥 약세, 위험 회피 뉴스 우세. 대응: 신규 진입 검토를 최소화하고 무효화 가격을 먼저 확인합니다.')
    },
    checklist: [
      '원/달러 환율과 미국 10년물 금리 방향',
      '코스피/코스닥 상승 종목 확산 여부',
      '상위 후보의 거래대금 유지 여부'
    ]
  };
}

function buildRuleBasedGeminiStockFallback_(leader, error) {
  var plan = leader.entry_plan || {};
  var riskComments = (leader.risk_alerts || []).map(function(row) {
    return row.message;
  }).filter(function(text) {
    return String(text || '').trim() !== '';
  });
  if (riskComments.length === 0) {
    riskComments = [leader.risk_level === 'high'
      ? '위험 수준이 높아 가격 조건이 맞아도 관찰 강도를 낮춰야 합니다.'
      : '특정 위험 공시가 없더라도 시장 변동성과 거래대금 감소 여부를 확인해야 합니다.'];
  }
  var action = leader.risk_level === 'high'
    ? '관찰만 유지하고 추가 진입 검토는 보수적으로 제한합니다.'
    : '현재가를 따라가기보다 1차 검토가, 돌파가, 무효화 가격을 순서대로 확인합니다.';
  return {
    symbol: normalizeStockSymbol_(leader.symbol),
    name: leader.name,
    scenario: plan.scenario || 'conditional_watch',
    summary: leader.name + '은 주도주 순위 ' + leader.rank + '위, 총점 ' + Number(leader.total_score || 0) + '점 기준의 조건부 관찰 후보입니다.',
    expert_view: '차트 점수, ETF 편입도, 재무 점수, 뉴스/거시 환경을 함께 보면 가격 조건 확인 전까지는 선제 판단보다 리스크 관리가 우선입니다.',
    beginner_action: action,
    entry_view: {
      mode: 'conditional_watch',
      first_entry: plan.first_entry_price ? formatPriceForGeminiFallback_(plan.first_entry_price) + ' 부근 / ' + formatPctForGeminiFallback_(plan.first_entry_pct) : '가격 계획 없음',
      second_entry: plan.second_entry_price ? formatPriceForGeminiFallback_(plan.second_entry_price) + ' 부근 / ' + formatPctForGeminiFallback_(plan.second_entry_pct) : '가격 계획 없음',
      breakout_entry: plan.breakout_price ? formatPriceForGeminiFallback_(plan.breakout_price) + ' 돌파 후 거래대금 유지 / ' + formatPctForGeminiFallback_(plan.breakout_entry_pct) : '돌파 가격 없음',
      invalid_condition: plan.invalid_price ? formatPriceForGeminiFallback_(plan.invalid_price) + ' 이탈 시 시나리오 무효화 검토' : '무효화 가격 없음'
    },
    risk_comment: riskComments.slice(0, 3),
    valid_conditions: [
      '무효화 가격 위에서 지지',
      '거래대금 유지 또는 증가',
      '같은 섹터 동반 강세'
    ],
    avoid_conditions: [
      '장 초반 급등 추격',
      '무효화 가격 이탈 후 방치',
      '거래대금 급감 구간의 신규 검토'
    ],
    check_points: [
      plan.first_entry_price ? '1차 검토가 ' + formatPriceForGeminiFallback_(plan.first_entry_price) + ' 부근 반응' : '가격 계획 재확인',
      '20일선과 거래대금 유지 여부',
      '관련 뉴스와 위험 공시 추가 발생 여부'
    ],
    theme_match: {
      matched_topic: '개별 모멘텀',
      correlation_level: 'none',
      matching_rationale: 'API 통신 차절 또는 일시적 오류 상태로, 규칙 기반 룰북 엔진이 기술적 모멘텀을 우선 매칭했습니다.'
    },
    data_quality_note: error ? 'Gemini 응답 실패로 규칙 기반 분석이 사용됐습니다.' : ''
  };
}

function normalizeGeminiMarketBriefing_(briefing, fallback) {
  var safe = fallback || buildRuleBasedGeminiMarketFallback_({}, null);
  briefing = briefing && typeof briefing === 'object' ? briefing : {};
  return {
    market_regime: briefing.market_regime || safe.market_regime || 'neutral',
    summary: briefing.summary || safe.summary,
    sector_view: normalizeGeminiTextArray_(briefing.sector_view, safe.sector_view),
    risk_view: normalizeGeminiTextArray_(briefing.risk_view, safe.risk_view),
    expert_takeaways: normalizeGeminiTextArray_(briefing.expert_takeaways, safe.expert_takeaways),
    beginner_actions: normalizeGeminiTextArray_(briefing.beginner_actions, safe.beginner_actions),
    avoid_actions: normalizeGeminiTextArray_(briefing.avoid_actions, safe.avoid_actions),
    data_quality_notes: normalizeGeminiTextArray_(briefing.data_quality_notes, safe.data_quality_notes),
    next_day_scenarios: {
      up: (briefing.next_day_scenarios || {}).up || safe.next_day_scenarios.up,
      neutral: (briefing.next_day_scenarios || {}).neutral || safe.next_day_scenarios.neutral,
      down: (briefing.next_day_scenarios || {}).down || safe.next_day_scenarios.down
    },
    checklist: normalizeGeminiTextArray_(briefing.checklist, safe.checklist)
  };
}

function normalizeGeminiStockAnalysis_(stock, leader) {
  var fallback = buildRuleBasedGeminiStockFallback_(leader, null);
  stock = stock && typeof stock === 'object' ? stock : {};
  var entryView = stock.entry_view || {};
  var themeMatch = stock.theme_match || {};
  var fallbackThemeMatch = fallback.theme_match || {};
  return {
    symbol: normalizeStockSymbol_(stock.symbol || leader.symbol),
    name: stock.name || leader.name,
    scenario: stock.scenario || fallback.scenario,
    summary: stock.summary || fallback.summary,
    expert_view: stock.expert_view || fallback.expert_view,
    beginner_action: stock.beginner_action || fallback.beginner_action,
    entry_view: {
      mode: entryView.mode || fallback.entry_view.mode,
      first_entry: entryView.first_entry || fallback.entry_view.first_entry,
      second_entry: entryView.second_entry || fallback.entry_view.second_entry,
      breakout_entry: entryView.breakout_entry || fallback.entry_view.breakout_entry,
      invalid_condition: entryView.invalid_condition || fallback.entry_view.invalid_condition
    },
    risk_comment: normalizeGeminiTextArray_(stock.risk_comment, fallback.risk_comment),
    valid_conditions: normalizeGeminiTextArray_(stock.valid_conditions, fallback.valid_conditions),
    avoid_conditions: normalizeGeminiTextArray_(stock.avoid_conditions, fallback.avoid_conditions),
    check_points: normalizeGeminiTextArray_(stock.check_points, fallback.check_points),
    theme_match: {
      matched_topic: themeMatch.matched_topic || fallbackThemeMatch.matched_topic || '개별 모멘텀',
      correlation_level: themeMatch.correlation_level || fallbackThemeMatch.correlation_level || 'none',
      matching_rationale: themeMatch.matching_rationale || fallbackThemeMatch.matching_rationale || '이 종목 고유의 차트 및 개별 수급 호조에 기반해 선정되었습니다.'
    },
    data_quality_note: stock.data_quality_note || fallback.data_quality_note || ''
  };
}

function normalizeGeminiTextArray_(value, fallback) {
  if (Array.isArray(value)) {
    var rows = value.map(function(item) {
      return String(item || '').trim();
    }).filter(function(item) {
      return item !== '';
    });
    if (rows.length > 0) return rows;
  }
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return Array.isArray(fallback) ? fallback : [];
}

function appendAiMarketBriefingRow_(dateValue, marketBriefing) {
  var today = normalizeDateValue_(dateValue);
  appendObjectRow_(AM_CONFIG.SHEETS.AI_MARKET_BRIEFING, {
    date: today,
    market_regime: marketBriefing.market_regime || 'neutral',
    briefing_json: marketBriefing,
    created_at: amNowString_()
  });
}

function replaceAiMarketBriefingRow_(dateValue, marketBriefing) {
  deleteRowsByDate_(AM_CONFIG.SHEETS.AI_MARKET_BRIEFING, dateValue);
  appendAiMarketBriefingRow_(dateValue, marketBriefing);
}

function appendAiStockAnalysisRow_(dateValue, stock) {
  var today = normalizeDateValue_(dateValue);
  appendObjectRow_(AM_CONFIG.SHEETS.AI_STOCK_ANALYSIS, {
    date: today,
    symbol: stock.symbol,
    name: stock.name,
    analysis_json: stock,
    created_at: amNowString_()
  });
}

function replaceAiStockAnalysisRow_(dateValue, stock) {
  deleteAiStockAnalysisRowBySymbol_(dateValue, stock.symbol);
  appendAiStockAnalysisRow_(dateValue, stock);
}

function deleteAiStockAnalysisRowBySymbol_(dateValue, symbol) {
  var today = normalizeDateValue_(dateValue);
  var targetSymbol = normalizeStockSymbol_(symbol);
  var sheetName = AM_CONFIG.SHEETS.AI_STOCK_ANALYSIS;
  var sheet = ensureSheet_(sheetName, AM_SHEET_SCHEMAS[sheetName]);
  var values = sheet.getDataRange().getValues();
  if (values.length <= 1) return;
  var headers = values[0];
  var dateIndex = headers.indexOf('date');
  var symbolIndex = headers.indexOf('symbol');
  var keepRows = [];
  for (var i = 1; i < values.length; i += 1) {
    var isTarget = normalizeDateValue_(values[i][dateIndex]) === today &&
      normalizeStockSymbol_(values[i][symbolIndex]) === targetSymbol;
    if (!isTarget) keepRows.push(values[i]);
  }
  rewriteDataRows_(sheet, headers.length, keepRows);
}

function replaceStockInArray_(stocks, stock) {
  var targetSymbol = normalizeStockSymbol_(stock.symbol);
  var replaced = false;
  var result = (stocks || []).map(function(existing) {
    if (normalizeStockSymbol_(existing.symbol) === targetSymbol) {
      replaced = true;
      return stock;
    }
    return existing;
  });
  if (!replaced) result.push(stock);
  return result;
}

function findMarketBreadthForFallback_(rows, market) {
  var target = String(market || 'ALL');
  for (var i = 0; i < (rows || []).length; i += 1) {
    if (String(rows[i].market || '') === target) return rows[i];
  }
  return null;
}

function summarizeTopSectorsForFallback_(leaders) {
  var bySector = {};
  (leaders || []).forEach(function(row) {
    var sector = String(row.sector || '').trim();
    if (!sector) return;
    if (!bySector[sector]) bySector[sector] = { sector: sector, count: 0, score: 0 };
    bySector[sector].count += 1;
    bySector[sector].score += Number(row.total_score || 0);
  });
  return Object.keys(bySector).map(function(key) {
    var row = bySector[key];
    row.avg = row.count ? row.score / row.count : 0;
    return row;
  }).sort(function(a, b) {
    return b.avg - a.avg;
  }).slice(0, 3).map(function(row) {
    return row.sector + '(' + row.count + '개)';
  });
}

function summarizeNewsToneForFallback_(rows) {
  var riskOn = 0;
  var riskOff = 0;
  (rows || []).forEach(function(row) {
    riskOn += Number(row.risk_on_score || 0);
    riskOff += Number(row.risk_off_score || 0);
  });
  if (riskOff > riskOn) return '뉴스 점수는 위험 회피 쪽이 우세해 신규 검토를 줄이는 편이 적절합니다.';
  if (riskOn > riskOff) return '뉴스 점수는 위험 선호 쪽이 우세하지만 가격 조건 확인은 필요합니다.';
  return '뉴스 점수는 한쪽으로 뚜렷하지 않아 섹터와 가격 반응을 함께 확인합니다.';
}

function hasPositiveFlowScoreForFallback_(leaders) {
  return (leaders || []).some(function(row) {
    return Number((row.flow || {}).combined_flow_score || row.flow_score || 0) !== 0;
  });
}

function describeRegimeKoForFallback_(regime) {
  var value = String(regime || '').toLowerCase();
  if (value === 'risk_on') return '공격적 관찰';
  if (value === 'risk_off') return '방어 우선';
  return '선별 관찰';
}

function scenarioTextForFallback_(rows, key, fallback) {
  var target = String(key || '').toLowerCase();
  for (var i = 0; i < (rows || []).length; i += 1) {
    if (String(rows[i].scenario || '').toLowerCase() === target) {
      return '조건: ' + rows[i].conditions + ' 대응: ' + rows[i].response_plan;
    }
  }
  return fallback;
}

function formatPriceForGeminiFallback_(value) {
  var numberValue = Number(value || 0);
  return numberValue ? formatNumber_(numberValue) + '원' : '-';
}

function formatPctForGeminiFallback_(value) {
  var numberValue = Number(value || 0);
  if (!numberValue) return '-';
  return String(Math.round(numberValue * 10) / 10).replace(/\.0$/, '') + '%';
}

function buildGeminiMarketPrompt_(input) {
  var promptBase = getPromptTemplate_('market_prompt_base', '');
  return [
    promptBase,
    'You are an investment analysis assistant for a Korean stock scanner.',
    'Explain only. Do not recalculate prices, position sizes, scores, or rankings.',
    'Purpose: daily close review and next-session preparation. Explain what led the market today, what changed in leader rankings, and what to prepare for the next trading session.',
    'Act like a professional Korean equity strategist writing a conditional after-close research memo for a beginner.',
    'Use all available data: market breadth, macro rates, FX, Nasdaq/VIX/US broad indices, Korean sector strength, leader scores, ETF inclusion, financial/risk alerts, news scores, leader history, previous-report backtest, premarket prediction review, and rule-based scenarios.',
    'Use market_calendar. If Korea market is closed, do not write trading action plans. If US market is closed, clearly say there is no fresh US close signal and do not overinterpret unchanged US index/rate data.',
    'Scenario rows in input.scenarios are rule-based from macro/news. Use them as the source of truth and only polish wording.',
    'Interpret news in an after-close way: Korea close news explains today market behavior; US close/global news and macro are used mainly for next-session risk setup.',
    'Do not use buy recommendation, strong buy, guarantee, or certainty wording.',
    'Use conditional and risk-aware wording. Write all string values in Korean.',
    'Return valid JSON only. No markdown. Keep each array to 2-4 short items.',
    'Required JSON shape:',
    JSON.stringify({
      market_regime: 'risk_on|neutral|risk_off',
      summary: 'short Korean summary',
      sector_view: ['short Korean sentence'],
      risk_view: ['short Korean sentence'],
      expert_takeaways: ['professional but conditional Korean takeaway'],
      beginner_actions: ['simple Korean action for a beginner'],
      avoid_actions: ['what not to do in Korean'],
      data_quality_notes: ['short Korean note about missing or weak data if any'],
      next_day_scenarios: {
        up: 'short Korean scenario',
        neutral: 'short Korean scenario',
        down: 'short Korean scenario'
      },
      checklist: ['short Korean checklist item']
    }),
    'Input data:',
    JSON.stringify({
      date: input.date,
      market_calendar: input.market_calendar,
      macro: input.macro,
      market_breadth: input.market_breadth,
      leaders: input.leaders.map(function(row) {
        return {
          rank: row.rank,
          symbol: row.symbol,
          name: row.name,
          sector: row.sector,
          total_score: row.total_score,
          risk_level: row.risk_level,
          score_breakdown: row.score_breakdown,
          chart: row.chart,
          etf: row.etf,
          flow: row.flow,
          financial: row.financial,
          sector_strength: row.sector_strength
        };
      }),
      news: input.news,
      news_scores: input.news_scores,
      leader_history: input.leader_history,
      backtest: input.backtest,
      premarket_review: input.premarket_review,
      risk_alerts: input.risk_alerts,
      scenarios: input.scenarios
    })
  ].join('\n');
}

function buildGeminiStocksPrompt_(input) {
  var promptBase = getPromptTemplate_('stock_prompt_base', '');
  return [
    promptBase,
    'You are an investment analysis assistant for a Korean stock scanner.',
    'Explain only. Do not recalculate entry prices, position sizes, invalidation prices, scores, or rankings.',
    'Use the exact entry_plan values from the input. Do not change numbers.',
    'Act like a professional Korean equity research advisor, but keep the output as conditional decision support for a beginner.',
    'Compare each stock candidate (leaders) with the collected news briefing (input.news key_news topics) and determine if there is a real-time market theme match.',
    'For the theme_match object in the output schema:',
    '  - matched_topic: The specific key news topic matched from the day\'s collected news (if any). If no direct match, write "개별 모멘텀".',
    '  - correlation_level: high | medium | low | none',
    '  - matching_rationale: Professional explanation (under 120 Korean characters) of how this stock candidate\'s business, recent events, or sector aligns with the matched news keyword/topic. If correlation_level is none, explain the stock\'s own technical chart/flow rationale instead.',
    'Use every available input field: market_calendar, score_breakdown, chart, ETF, investor flow, financials, risk alerts, macro, news, scenarios, and entry_plan.',
    'If US market is closed, do not infer fresh US confirmation from unchanged US index/rate data.',
    'Prioritize: 1) risk control, 2) whether the stock is still a market leader, 3) what condition must be checked before action.',
    'Do not use buy recommendation, strong buy, guarantee, or certainty wording.',
    'Use conditional wording such as watch price, split-entry candidate, invalidation price, avoid chasing, high risk.',
    'Write all string values in Korean.',
    'Return valid JSON only. No markdown. Keep each sentence concise.',
    'Required JSON shape:',
    JSON.stringify({
      stocks: [
        {
          symbol: '000000',
          name: 'stock_name',
          scenario: 'neutral',
          summary: 'one Korean sentence',
          expert_view: 'professional conditional interpretation using all available data',
          beginner_action: 'simple one-sentence action for a beginner',
          entry_view: {
            mode: 'conditional_watch',
            first_entry: 'use input first_entry_price and first_entry_pct',
            second_entry: 'use input second_entry_price and second_entry_pct',
            breakout_entry: 'use input breakout_price and breakout_entry_pct',
            invalid_condition: 'use input invalid_price'
          },
          risk_comment: ['short Korean risk comment'],
          valid_conditions: ['condition that must be true before considering action'],
          avoid_conditions: ['condition where beginner should avoid action'],
          check_points: ['short Korean checkpoint'],
          theme_match: {
            matched_topic: 'matched news topic or "개별 모멘텀"',
            correlation_level: 'high|medium|low|none',
            matching_rationale: 'short Korean business match rationale'
          }
        }
      ]
    }),
    'Input data:',
    JSON.stringify(input)
  ].join('\n');
}

function validateGeminiStocksChunk_(chunkResult, leaders) {
  if (!chunkResult || !Array.isArray(chunkResult.stocks)) {
    throw new Error('Gemini stock chunk missing stocks array.');
  }
  if (chunkResult.stocks.length !== leaders.length) {
    throw new Error('Gemini stock chunk length mismatch. expected=' + leaders.length + ' actual=' + chunkResult.stocks.length);
  }
}

function buildGeminiReportPrompt_(input) {
  return [
    'You are an investment analysis assistant for a Korean stock scanner.',
    'The system is NOT an auto-trading system. It is a personal decision-support report.',
    'You must explain the already-calculated data only.',
    'Do not recalculate entry prices, position sizes, invalidation prices, scores, or rankings.',
    'Do not use recommendation or certainty wording. Avoid phrases that mean buy recommendation, strong buy, tomorrow will rise, buy at this price, or guaranteed profit.',
    'Use conditional wording that means watch price, split-entry candidate, valid only under scenario conditions, invalidation price, needs observation, avoid chasing, and high risk.',
    'Write all human-readable string values in Korean.',
    'Return valid JSON only. No markdown.',
    'Required JSON shape:',
    JSON.stringify({
      market_briefing: {
        market_regime: 'neutral',
        summary: 'string',
        sector_view: ['string'],
        risk_view: ['string'],
        next_day_scenarios: {
          up: 'string',
          neutral: 'string',
          down: 'string'
        },
        checklist: ['string']
      },
      stocks: [
        {
          symbol: '000000',
          name: 'stock_name',
          scenario: 'neutral',
          summary: 'string',
          entry_view: {
            mode: 'conditional_watch',
            first_entry: 'string',
            second_entry: 'string',
            breakout_entry: 'string',
            invalid_condition: 'string'
          },
          risk_comment: ['string'],
          check_points: ['string']
        }
      ]
    }),
    'Input data:',
    JSON.stringify(input)
  ].join('\n');
}

function validateGeminiReport_(report) {
  if (!report || typeof report !== 'object') {
    throw new Error('Gemini report is not an object.');
  }
  if (!report.market_briefing || typeof report.market_briefing !== 'object') {
    throw new Error('Gemini report missing market_briefing.');
  }
  if (!Array.isArray(report.stocks)) {
    throw new Error('Gemini report missing stocks array.');
  }
}

function saveGeminiReport_(dateValue, report) {
  var today = normalizeDateValue_(dateValue);
  deleteRowsByDate_(AM_CONFIG.SHEETS.AI_MARKET_BRIEFING, today);
  deleteRowsByDate_(AM_CONFIG.SHEETS.AI_STOCK_ANALYSIS, today);
  appendAiMarketBriefingRow_(today, report.market_briefing);
  report.stocks.forEach(function(stock) {
    appendAiStockAnalysisRow_(today, stock);
  });
}

function callGeminiJson_(prompt, generationOptions) {
  var apiKey = getRequiredScriptProperty_(AM_CONFIG.PROPERTY_KEYS.GEMINI_API_KEY);
  var useCase = generationOptions && generationOptions.modelUseCase ? generationOptions.modelUseCase : 'daily_close';
  var models = getGeminiModelCandidates_(useCase);
  var lastError = null;
  for (var i = 0; i < models.length; i += 1) {
    try {
      return callGeminiJsonWithModel_(prompt, generationOptions, apiKey, models[i]);
    } catch (err) {
      lastError = err;
      if (!isRetryableGeminiError_(err)) {
        throw err;
      }
      logWarn_('gemini', 'Retryable Gemini error; trying next model or retry', {
        model: models[i],
        error: String(err)
      });
      Utilities.sleep(1500 * (i + 1));
    }
  }
  throw lastError;
}

function callGeminiJsonWithModel_(prompt, generationOptions, apiKey, model) {
  var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(apiKey);
  var generationConfig = {
    responseMimeType: 'application/json',
    temperature: generationOptions && generationOptions.temperature !== undefined ? generationOptions.temperature : 0.2,
    maxOutputTokens: generationOptions && generationOptions.maxOutputTokens ? generationOptions.maxOutputTokens : 4096
  };
  var result = apiFetchJson_(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: generationConfig
    }),
    muteHttpExceptions: true
  }, 'gemini');
  return parseGeminiJsonResponse_(result);
}

function callGeminiGroundedJson_(prompt, generationOptions) {
  var apiKey = getRequiredScriptProperty_(AM_CONFIG.PROPERTY_KEYS.GEMINI_API_KEY);
  var useCase = generationOptions && generationOptions.modelUseCase ? generationOptions.modelUseCase : 'news_grounding';
  var models = getGeminiGroundingModelCandidates_(useCase);
  var lastError = null;
  for (var i = 0; i < models.length; i += 1) {
    try {
      return callGeminiGroundedJsonWithModel_(prompt, generationOptions, apiKey, models[i]);
    } catch (err) {
      lastError = err;
      if (!isRetryableGeminiError_(err)) {
        throw err;
      }
      logWarn_('gemini_grounding', 'Retryable grounded Gemini error; trying next model', {
        model: models[i],
        error: String(err)
      });
      Utilities.sleep(1500 * (i + 1));
    }
  }
  throw lastError;
}

function callGeminiGroundedJsonWithModel_(prompt, generationOptions, apiKey, model) {
  var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(apiKey);
  var generationConfig = {
    temperature: generationOptions && generationOptions.temperature !== undefined ? generationOptions.temperature : 0.2,
    maxOutputTokens: generationOptions && generationOptions.maxOutputTokens ? generationOptions.maxOutputTokens : 4096
  };
  var response = apiFetchJson_(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      tools: [{ google_search: {} }],
      generationConfig: generationConfig
    }),
    muteHttpExceptions: true
  }, 'gemini_grounding');
  return {
    json: parseGeminiJsonResponse_(response),
    sources: extractGroundingSources_(response),
    model: model
  };
}

function extractGroundingSources_(response) {
  var metadata = (((response || {}).candidates || [])[0] || {}).groundingMetadata || {};
  var chunks = metadata.groundingChunks || [];
  return chunks.map(function(chunk) {
    var web = chunk.web || {};
    return {
      title: web.title || '',
      uri: web.uri || ''
    };
  }).filter(function(source) {
    return source.uri || source.title;
  });
}

function isRetryableGeminiError_(err) {
  var text = String(err && err.message ? err.message : err);
  return text.indexOf('HTTP 503') >= 0 ||
    text.indexOf('UNAVAILABLE') >= 0 ||
    text.indexOf('high demand') >= 0 ||
    text.indexOf('HTTP 429') >= 0 ||
    text.indexOf('RESOURCE_EXHAUSTED') >= 0 ||
    text.indexOf('HTTP 404') >= 0 ||
    text.indexOf('NOT_FOUND') >= 0 ||
    text.indexOf('not found') >= 0 ||
    text.indexOf('not supported') >= 0 ||
    text.indexOf('Gemini JSON parse failed') >= 0;
}

function parseGeminiJsonResponse_(response) {
  var text = '';
  try {
    var parts = response.candidates[0].content.parts || [];
    text = parts.map(function(part) { return part.text || ''; }).join('');
  } catch (err) {
    throw new Error('Gemini response missing candidates[0].content.parts text: ' + JSON.stringify(response));
  }
  text = String(text || '').trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  text = removeInlineGeminiCitations_(text);
  try {
    return JSON.parse(text);
  } catch (err) {
    var candidates = extractJsonCandidates_(text);
    for (var i = 0; i < candidates.length; i += 1) {
      try {
        return JSON.parse(candidates[i]);
      } catch (candidateErr) {
        // Try the next balanced JSON block.
      }
    }
    throw new Error('Gemini JSON parse failed: ' + err.message + ' text=' + text.slice(0, 2000));
  }
}

function removeInlineGeminiCitations_(text) {
  return String(text || '')
    .replace(/\s*\[cite:\s*[^\]]+\]/gi, '')
    .replace(/\s*\[\d+(?:,\s*\d+)*\]/g, '');
}

function extractJsonCandidates_(text) {
  var value = String(text || '');
  var candidates = [];
  for (var i = 0; i < value.length; i += 1) {
    var ch = value.charAt(i);
    if (ch !== '{' && ch !== '[') continue;
    var end = findBalancedJsonEnd_(value, i);
    if (end > i) {
      candidates.push(value.slice(i, end + 1));
      i = end;
    }
  }
  candidates.sort(function(a, b) {
    return b.length - a.length;
  });
  return candidates;
}

function findBalancedJsonEnd_(text, startIndex) {
  var stack = [];
  var inString = false;
  var escaped = false;
  for (var i = startIndex; i < text.length; i += 1) {
    var ch = text.charAt(i);
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '{' || ch === '[') {
      stack.push(ch);
    } else if (ch === '}' || ch === ']') {
      if (stack.length === 0) return -1;
      var expected = stack.pop();
      if ((expected === '{' && ch !== '}') || (expected === '[' && ch !== ']')) return -1;
      if (stack.length === 0) return i;
    }
  }
  return -1;
}

function getGeminiModel_() {
  return getScriptProperty_(AM_CONFIG.PROPERTY_KEYS.GEMINI_MODEL, '') ||
    getSettingString_('gemini_model', '');
}

function getGeminiModelCandidates_(useCase) {
  var configured = getGeminiModel_();
  var ordered = getGeminiModelPolicyCandidates_(useCase || 'daily_close');
  var candidates = configured ? [configured].concat(ordered) : ordered;
  return uniqueModelList_(candidates);
}

function getGeminiGroundingModelCandidates_(useCase) {
  var configured = getGeminiModel_();
  var ordered = getGeminiModelPolicyCandidates_(useCase || 'news_grounding').concat(['gemini-2.0-flash']);
  var candidates = configured ? [configured].concat(ordered) : ordered;
  return uniqueModelList_(candidates);
}

function getGeminiModelPolicyCandidates_(useCase) {
  var defaults = {
    daily_market: 'gemini-3.5-flash,gemini-3.1-flash-lite,gemini-2.5-flash',
    daily_stock_top: 'gemini-3.5-flash,gemini-3.1-flash-lite,gemini-2.5-flash',
    daily_stock_rest: 'gemini-3.1-flash-lite,gemini-2.5-flash-lite,gemini-2.5-flash',
    daily_close: 'gemini-3.5-flash,gemini-3.1-flash-lite,gemini-2.5-flash,gemini-2.5-flash-lite',
    premarket: 'gemini-3.1-flash-lite,gemini-2.5-flash-lite,gemini-3.5-flash',
    weekly: 'gemini-3.1-pro-preview,gemini-2.5-pro,gemini-3.5-flash,gemini-3.1-flash-lite',
    news_grounding: 'gemini-2.5-flash-lite,gemini-3.1-flash-lite,gemini-2.5-flash,gemini-3.5-flash',
    cheap_backup: 'gemini-2.5-flash-lite,gemini-2.5-flash',
    diagnostics: 'gemini-2.5-flash-lite,gemini-2.5-flash',
    intraday_alert: 'gemini-3.5-flash,gemini-3.1-flash-lite,gemini-2.5-flash'
  };
  var settingKeyByUseCase = {
    daily_market: 'gemini_models_daily_market',
    daily_stock_top: 'gemini_models_daily_stock_top',
    daily_stock_rest: 'gemini_models_daily_stock_rest',
    daily_close: 'gemini_models_daily_close',
    premarket: 'gemini_models_premarket',
    weekly: 'gemini_models_weekly',
    news_grounding: 'gemini_models_news_grounding',
    cheap_backup: 'gemini_models_cheap_backup',
    intraday_alert: 'gemini_models_intraday_alert'
  };
  var key = settingKeyByUseCase[useCase] || '';
  var configuredList = key ? getSettingString_(key, '') : '';
  var primary = parseGeminiModelList_(configuredList || defaults[useCase] || defaults.daily_close);
  var fallback = parseGeminiModelList_(defaults.cheap_backup);
  return uniqueModelList_(primary.concat(fallback));
}

function parseGeminiModelList_(value) {
  return String(value || '').split(',').map(function(model) {
    return String(model || '').trim();
  }).filter(function(model) {
    return model !== '';
  });
}

function uniqueModelList_(models) {
  var seen = {};
  return (models || []).filter(function(model) {
    if (!model || seen[model]) return false;
    seen[model] = true;
    return true;
  });
}

function maskSecret_(value) {
  var text = String(value || '');
  if (text.length <= 8) return '****';
  return text.slice(0, 4) + '...' + text.slice(-4);
}

function callGeminiText_(prompt, generationOptions) {
  var apiKey = getRequiredScriptProperty_(AM_CONFIG.PROPERTY_KEYS.GEMINI_API_KEY);
  var useCase = generationOptions && generationOptions.modelUseCase ? generationOptions.modelUseCase : 'intraday_alert';
  var models = getGeminiModelCandidates_(useCase);
  var lastError = null;
  for (var i = 0; i < models.length; i += 1) {
    try {
      return callGeminiTextWithModel_(prompt, generationOptions, apiKey, models[i]);
    } catch (err) {
      lastError = err;
      if (!isRetryableGeminiError_(err)) {
        throw err;
      }
      logWarn_('gemini_text', 'Retryable Gemini text error; trying next model or retry', {
        model: models[i],
        error: String(err)
      });
      Utilities.sleep(1500 * (i + 1));
    }
  }
  throw lastError;
}

function callGeminiTextWithModel_(prompt, generationOptions, apiKey, model) {
  var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(apiKey);
  var generationConfig = {
    temperature: generationOptions && generationOptions.temperature !== undefined ? generationOptions.temperature : 0.7,
    maxOutputTokens: generationOptions && generationOptions.maxOutputTokens ? generationOptions.maxOutputTokens : 256
  };
  var result = apiFetchJson_(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: generationConfig
    }),
    muteHttpExceptions: true
  }, 'gemini');
  
  try {
    var parts = result.candidates[0].content.parts || [];
    var text = parts.map(function(part) { return part.text || ''; }).join('');
    return String(text || '').trim();
  } catch (err) {
    throw new Error('Gemini response missing text parts: ' + JSON.stringify(result));
  }
}
