function validatePipelineResults() {
  return withLogging_('result_validator', function() {
    var today = amTodayString_();
    var calendar = getMarketCalendarSummary_(today);
    var summary = {
      date: today,
      market_calendar: calendar,
      market_daily: countRowsByDate_(AM_CONFIG.SHEETS.MARKET_DAILY, today),
      indicators_daily: countRowsByDate_(AM_CONFIG.SHEETS.INDICATORS_DAILY, today),
      market_breadth_daily: countRowsByDate_(AM_CONFIG.SHEETS.MARKET_BREADTH_DAILY, today),
      sector_strength_daily: countRowsByDate_(AM_CONFIG.SHEETS.SECTOR_STRENGTH_DAILY, today),
      etf_holdings: countRowsByDate_(AM_CONFIG.SHEETS.ETF_HOLDINGS, today),
      etf_stock_score: countRowsByDate_(AM_CONFIG.SHEETS.ETF_STOCK_SCORE, today),
      investor_flow_daily: countRowsByDate_(AM_CONFIG.SHEETS.INVESTOR_FLOW_DAILY, today),
      investor_flow_score: countRowsByDate_(AM_CONFIG.SHEETS.INVESTOR_FLOW_SCORE, today),
      leader_candidates: countRowsByDate_(AM_CONFIG.SHEETS.LEADER_CANDIDATES, today),
      leader_50: countRowsByDate_(AM_CONFIG.SHEETS.LEADER_50, today),
      kosdaq_leader_50: countRowsByDate_(AM_CONFIG.SHEETS.KOSDAQ_LEADER_50, today),
      entry_plan: countRowsByDate_(AM_CONFIG.SHEETS.ENTRY_PLAN, today),
      risk_alerts: countRowsByDate_(AM_CONFIG.SHEETS.RISK_ALERTS, today),
      financial_raw: countRowsByDate_(AM_CONFIG.SHEETS.FINANCIAL_RAW, today),
      financial_ratios: countRowsByDate_(AM_CONFIG.SHEETS.FINANCIAL_RATIOS, today),
      macro_raw: countRowsByDate_(AM_CONFIG.SHEETS.MACRO_RAW, today),
      macro_score: countRowsByDate_(AM_CONFIG.SHEETS.MACRO_SCORE, today),
      news_briefing: countRowsByDate_(AM_CONFIG.SHEETS.NEWS_BRIEFING, today),
      news_score_daily: countRowsByDate_(AM_CONFIG.SHEETS.NEWS_SCORE_DAILY, today),
      ai_market_briefing: countRowsByDate_(AM_CONFIG.SHEETS.AI_MARKET_BRIEFING, today),
      ai_stock_analysis: countRowsByDate_(AM_CONFIG.SHEETS.AI_STOCK_ANALYSIS, today),
      premarket_briefing: countRowsByDate_(AM_CONFIG.SHEETS.PREMARKET_BRIEFING, today),
      premarket_result_review: countRowsByDate_(AM_CONFIG.SHEETS.PREMARKET_RESULT_REVIEW, today),
      backtest_log: countRowsByDate_(AM_CONFIG.SHEETS.BACKTEST_LOG, today),
      email_sent: countLogRowsTodayByModuleAndMessage_('email_report', 'Daily email report sent'),
      premarket_email_sent: countLogRowsTodayByModuleAndMessage_('premarket_email', 'Premarket email report sent'),
      pipeline_status: getDailyPipelineState_(),
      full_workflow_status: getFullWorkflowState_()
    };
    var quality = buildQualityAssessment_(summary);
    summary.issues = quality.issues;
    summary.quality = quality;
    writeQualityCheckRow_(summary);
    logInfo_('result_validator', 'Pipeline result validation completed', summary);
    safeUiAlert_(formatPipelineValidationMessage_(summary));
    return summary;
  });
}

function buildQualityAssessment_(summary) {
  var checks = [];
  if (summary.market_calendar && summary.market_calendar.kr_open === false) {
    addQualityCheck_(checks, true, 'info', '국내 증시 휴장일입니다. 장마감 가격 수집과 주도주 산출이 비어 있어도 정상입니다.', '휴장일 브리핑 메일과 다음 국내 거래일을 확인하세요.');
    var holidayCounts = countQualityIssues_(checks);
    return {
      status: 'OK',
      quality_score: 100,
      critical_count: holidayCounts.critical,
      warning_count: holidayCounts.warning,
      info_count: holidayCounts.info,
      issues: [],
      next_action: '국내 증시 휴장일입니다. 다음 국내 거래일에 자동 파이프라인이 다시 실행됩니다.'
    };
  }
  addQualityCheck_(checks, summary.market_daily > 0, 'critical', '시장 일별 데이터가 비어 있습니다.', '핵심 파이프라인을 실행하세요.');
  addQualityCheck_(checks, summary.indicators_daily > 0, 'critical', '차트 지표 데이터가 비어 있습니다.', '핵심 파이프라인 이어서 실행을 누르세요.');
  addQualityCheck_(checks, summary.leader_50 > 0, 'critical', '주도주 50 결과가 비어 있습니다.', '핵심 파이프라인을 실행하거나 이어서 실행하세요.');
  addQualityCheck_(checks, summary.kosdaq_leader_50 > 0, 'info', '코스닥 전용 주도주 결과가 비어 있습니다.', '주도주 점수 재계산 또는 핵심 파이프라인 실행 후 kosdaq_leader_50 시트를 확인하세요.');
  addQualityCheck_(checks, summary.entry_plan > 0, 'critical', '진입 계획 데이터가 비어 있습니다.', '핵심 파이프라인 마무리 단계를 실행하세요.');
  addQualityCheck_(checks, summary.macro_score > 0, 'critical', '거시환경 점수가 비어 있습니다.', '거시지표 수집을 실행하세요.');
  addQualityCheck_(checks, summary.ai_market_briefing > 0, 'critical', 'AI 시장 브리핑이 비어 있습니다.', 'Gemini 리포트 생성을 실행하세요.');
  addQualityCheck_(checks, summary.ai_stock_analysis >= Math.min(10, summary.entry_plan), 'critical', 'AI 종목 분석 행이 예상보다 적습니다.', 'Gemini 리포트 생성을 다시 실행하세요.');
  addQualityCheck_(checks, !summary.pipeline_status.stage || summary.pipeline_status.stage === 'done', 'warning', '핵심 파이프라인이 아직 완료되지 않았습니다: ' + formatStageKo_(summary.pipeline_status.stage), '핵심 파이프라인 이어서 실행을 누르세요.');
  addQualityCheck_(checks, !summary.full_workflow_status.stage || summary.full_workflow_status.stage === 'done', 'warning', '전체 워크플로우가 아직 완료되지 않았습니다: ' + formatStageKo_(summary.full_workflow_status.stage), '전체 워크플로우 이어서 실행을 누르세요.');
  addQualityCheck_(checks, summary.market_breadth_daily > 0, 'warning', '시장 폭 지표가 비어 있습니다. 시장 전체 참여도를 판단하기 어렵습니다.', '시장 폭 지표 계산을 실행하세요.');
  addQualityCheck_(checks, summary.sector_strength_daily > 0, 'warning', '섹터 강도 데이터가 비어 있습니다.', '섹터 강도 계산을 실행하세요.');
  addQualityCheck_(checks, summary.etf_holdings > 0, 'warning', 'ETF 구성종목 데이터가 비어 있습니다. ETF 점수가 0일 수 있습니다.', 'ETF 구성종목 수집을 실행하거나 ETF API 로그를 확인하세요.');
  if (summary.etf_holdings > 0) {
    addQualityCheck_(checks, summary.etf_stock_score > 0, 'warning', 'ETF 점수 데이터가 비어 있습니다. ETF 점수가 0일 수 있습니다.', 'ETF 점수 계산을 실행하세요.');
  }
  if (summary.investor_flow_daily === 0) {
    if (isInvestorFlowCollectionWindowOpen_()) {
      addQualityCheck_(checks, false, 'warning', '장마감 후인데 외국인/기관 수급 데이터가 아직 없습니다. 수급 점수가 0으로 계산됩니다.', '투자자 수급 연결 진단 후 투자자 수급 수집을 실행하세요.');
    } else {
      addQualityCheck_(checks, false, 'info', '외국인/기관 수급 데이터는 15:40 이후에 수집 가능합니다. 현재 리포트는 가격, 차트, ETF, 재무, 거시, 뉴스 기준으로 생성됩니다.', '15:40 이후 투자자 수급 연결 진단 또는 투자자 수급 수집을 실행하세요.');
    }
  } else {
    addQualityCheck_(checks, summary.investor_flow_score > 0, 'warning', '투자자 수급 원본은 있지만 점수 계산이 아직 안 됐습니다.', '투자자 수급 점수 계산을 실행하세요.');
  }
  addQualityCheck_(checks, summary.financial_raw > 0, 'warning', '재무 원본 데이터가 비어 있습니다. 재무 점수가 제한될 수 있습니다.', '전체 워크플로우 이어서 실행 또는 DART 재무/공시 수집을 실행하세요.');
  addQualityCheck_(checks, summary.financial_ratios > 0, 'warning', '재무비율 데이터가 비어 있습니다. 재무 점수가 제한될 수 있습니다.', '전체 워크플로우 이어서 실행 또는 DART 재무/공시 수집을 실행하세요.');
  addQualityCheck_(checks, summary.news_briefing > 0, 'warning', '뉴스 브리핑 데이터가 비어 있습니다.', '시장 뉴스 수집을 실행하세요.');
  if (summary.news_briefing > 0) {
    addQualityCheck_(checks, summary.news_score_daily > 0, 'warning', '뉴스 점수 데이터가 비어 있습니다. 뉴스 영향 강도를 판단하기 어렵습니다.', '뉴스 점수 계산을 실행하세요.');
  }
  addQualityCheck_(checks, summary.backtest_log > 0, 'info', '전일 리포트 사후검증 기록이 아직 없습니다.', '전일 리포트 사후검증을 실행하거나 장마감 전체 워크플로우를 완료하세요.');
  if (summary.premarket_briefing > 0) {
    addQualityCheck_(checks, summary.premarket_result_review > 0, 'info', '장전 예측 사후검증 기록이 아직 없습니다.', '장전 예측 사후검증을 실행하거나 장마감 전체 워크플로우를 완료하세요.');
  }
  addQualityCheck_(checks, summary.email_sent > 0, 'info', '오늘 장마감 메일 발송 로그가 아직 없습니다. 시트 리포트는 생성됐지만 메일로는 아직 보내지 않았다는 뜻입니다.', '메일로 받으려면 메일 리포트 발송을 실행하세요.');
  var counts = countQualityIssues_(checks);
  var score = calculateQualityScore_(checks);
  return {
    status: classifyQualityStatus_(counts, score),
    quality_score: score,
    critical_count: counts.critical,
    warning_count: counts.warning,
    info_count: counts.info,
    issues: checks.filter(function(check) { return !check.ok; }),
    next_action: resolveNextQualityAction_(checks)
  };
}

function addQualityCheck_(checks, ok, severity, message, action) {
  checks.push({
    ok: !!ok,
    severity: severity,
    message: message,
    action: action
  });
}

function countQualityIssues_(checks) {
  var counts = { critical: 0, warning: 0, info: 0 };
  checks.forEach(function(check) {
    if (check.ok) return;
    counts[check.severity] += 1;
  });
  return counts;
}

function calculateQualityScore_(checks) {
  var score = 100;
  checks.forEach(function(check) {
    if (check.ok) return;
    if (check.severity === 'critical') score -= 18;
    if (check.severity === 'warning') score -= 6;
    if (check.severity === 'info') score -= 2;
  });
  return Math.max(0, Math.min(100, score));
}

function classifyQualityStatus_(counts, score) {
  if (counts.critical > 0) return 'FAIL';
  if (counts.warning > 0 || score < 90) return 'WARN';
  return 'OK';
}

function resolveNextQualityAction_(checks) {
  var failed = checks.filter(function(check) { return !check.ok; });
  if (failed.length === 0) return '추가 조치가 필요 없습니다.';
  var actionable = failed.filter(function(check) {
    return check.severity === 'critical' || check.severity === 'warning';
  });
  if (actionable.length === 0) return '필수 조치 없음. 선택/안내 항목만 확인하세요.';
  var order = { critical: 0, warning: 1, info: 2 };
  actionable.sort(function(a, b) {
    return order[a.severity] - order[b.severity];
  });
  return actionable[0].action;
}

function writeQualityCheckRow_(summary) {
  appendObjectRow_(AM_CONFIG.SHEETS.QUALITY_CHECKS, {
    date: summary.date,
    checked_at: amNowString_(),
    status: summary.quality.status,
    quality_score: summary.quality.quality_score,
    critical_count: summary.quality.critical_count,
    warning_count: summary.quality.warning_count,
    info_count: summary.quality.info_count,
    next_action: summary.quality.next_action,
    summary_json: {
      counts: {
        market_daily: summary.market_daily,
        indicators_daily: summary.indicators_daily,
        market_breadth_daily: summary.market_breadth_daily,
        leader_50: summary.leader_50,
        kosdaq_leader_50: summary.kosdaq_leader_50,
        entry_plan: summary.entry_plan,
        macro_score: summary.macro_score,
        news_score_daily: summary.news_score_daily,
        ai_market_briefing: summary.ai_market_briefing,
        ai_stock_analysis: summary.ai_stock_analysis,
        premarket_result_review: summary.premarket_result_review,
        backtest_log: summary.backtest_log
      },
      issues: summary.quality.issues,
      pipeline_status: summary.pipeline_status,
      full_workflow_status: summary.full_workflow_status
    }
  });
}

function countRowsByDate_(sheetName, dateValue) {
  return readObjects_(sheetName).filter(function(row) {
    return normalizeDateValue_(row.date) === normalizeDateValue_(dateValue);
  }).length;
}

function formatPipelineValidationMessage_(summary) {
  var lines = [
    'AI Scanner 품질 체크',
    '',
    '날짜: ' + summary.date,
    '상태: ' + formatQualityStatusKo_(summary.quality.status),
    '품질 점수: ' + summary.quality.quality_score + '/100',
    '다음 조치: ' + summary.quality.next_action,
    '',
    '핵심 파이프라인: ' + formatStateLine_(summary.pipeline_status),
    '전체 워크플로우: ' + formatStateLine_(summary.full_workflow_status),
    '',
    '[핵심 시장 데이터]',
    '시장 일별 데이터(market_daily): ' + summary.market_daily,
    '차트 지표(indicators_daily): ' + summary.indicators_daily,
    '시장 폭 지표(market_breadth_daily): ' + summary.market_breadth_daily,
    '섹터 강도(sector_strength_daily): ' + summary.sector_strength_daily,
    'ETF 구성종목(etf_holdings): ' + summary.etf_holdings,
    'ETF 점수(etf_stock_score): ' + summary.etf_stock_score,
    '투자자 수급 원본(investor_flow_daily): ' + summary.investor_flow_daily,
    '투자자 수급 점수(investor_flow_score): ' + summary.investor_flow_score,
    '주도주 후보(leader_candidates): ' + summary.leader_candidates,
    '주도주 50(leader_50): ' + summary.leader_50,
    '코스닥 주도주 50(kosdaq_leader_50): ' + summary.kosdaq_leader_50,
    '진입 계획(entry_plan): ' + summary.entry_plan,
    '위험 알림(risk_alerts): ' + summary.risk_alerts,
    '',
    '[재무 / 거시 / 뉴스]',
    '재무 원본(financial_raw): ' + summary.financial_raw,
    '재무비율(financial_ratios): ' + summary.financial_ratios,
    '거시지표 원본(macro_raw): ' + summary.macro_raw,
    '거시환경 점수(macro_score): ' + summary.macro_score,
    '뉴스 브리핑(news_briefing): ' + summary.news_briefing,
    '뉴스 점수(news_score_daily): ' + summary.news_score_daily,
    '',
    '[AI / 메일]',
    'AI 시장 브리핑(ai_market_briefing): ' + summary.ai_market_briefing,
    'AI 종목 분석(ai_stock_analysis): ' + summary.ai_stock_analysis,
    '장전 브리핑(premarket_briefing): ' + summary.premarket_briefing,
    '장전 예측 사후검증(premarket_result_review): ' + summary.premarket_result_review,
    '전일 리포트 사후검증(backtest_log): ' + summary.backtest_log,
    '장마감 메일 발송 로그: ' + summary.email_sent,
    '장전 메일 발송 로그: ' + summary.premarket_email_sent
  ];
  if (summary.quality.issues.length > 0) {
    appendIssueGroup_(lines, '필수 조치', summary.quality.issues, 'critical');
    appendIssueGroup_(lines, '개선 권장', summary.quality.issues, 'warning');
    appendIssueGroup_(lines, '선택/안내', summary.quality.issues, 'info');
  } else {
    lines.push('');
    lines.push('정상: 필수 결과 시트가 채워져 있고 워크플로우가 완료되었습니다.');
  }
  return lines.join('\n');
}

function appendIssueGroup_(lines, title, issues, severity) {
  var group = issues.filter(function(issue) {
    return issue.severity === severity;
  });
  if (group.length === 0) return;
  lines.push('');
  lines.push('[' + title + ']');
  group.forEach(function(issue) {
    lines.push('- ' + issue.message);
    lines.push('  다음: ' + issue.action);
  });
}

function formatStateLine_(state) {
  if (!state || !state.stage) return '(기록 없음)';
  var parts = [formatStageKo_(state.stage)];
  if (state.index !== undefined && state.index !== '') parts.push('index=' + state.index);
  if (state.dart_index !== undefined && state.dart_index !== '') parts.push('dart_index=' + state.dart_index + '/' + (state.dart_total || ''));
  if (state.gemini_index !== undefined && state.gemini_index !== '') parts.push('gemini=' + state.gemini_index + '/' + (state.gemini_total || ''));
  if (state.updated_at) parts.push('updated=' + state.updated_at);
  return parts.join(', ');
}

function formatQualityStatusKo_(status) {
  if (status === 'OK') return '정상(OK)';
  if (status === 'WARN') return '주의(WARN)';
  if (status === 'FAIL') return '실패(FAIL)';
  return status || '';
}

function formatSeverityKo_(severity) {
  if (severity === 'critical') return '필수';
  if (severity === 'warning') return '주의';
  if (severity === 'info') return '안내';
  return severity || '';
}

function formatStageKo_(stage) {
  var map = {
    done: '완료',
    market: '시장 데이터 수집',
    indicators: '차트 지표 계산',
    finalize: '최종 점수/진입 계획',
    daily: '핵심 파이프라인',
    dart: 'DART 재무/공시',
    dart_done: 'DART 재무/공시 완료',
    macro: '거시지표',
    news: '뉴스',
    gemini: 'AI 리포트',
    gemini_done: 'AI 리포트 완료',
    email: '메일 발송'
  };
  return map[stage] ? map[stage] + '(' + stage + ')' : String(stage || '');
}

function countLogRowsTodayByModuleAndMessage_(moduleName, messageText) {
  return countLogRowsByDateAndModuleAndMessage_(amTodayString_(), moduleName, messageText);
}

function countLogRowsByDateAndModuleAndMessage_(dateValue, moduleName, messageText) {
  var target = normalizeDateValue_(dateValue);
  return readRecentObjects_(AM_CONFIG.SHEETS.LOGS, 5000).filter(function(row) {
    var message = String(row.message || '');
    return normalizeLogTimestampDate_(row.timestamp) === target &&
      String(row.module || '') === moduleName &&
      (message === messageText || message.indexOf(messageText) >= 0);
  }).length;
}

function normalizeLogTimestampDate_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  var text = String(value || '').trim();
  if (!text) return '';
  var match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return match[1] + '-' + match[2] + '-' + match[3];
  var parsed = new Date(text);
  if (!isNaN(parsed.getTime())) {
    return Utilities.formatDate(parsed, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return '';
}
