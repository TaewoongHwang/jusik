function buildPremarketResultReview(dateValue) {
  return withLogging_('premarket_result_review', function() {
    ensureAllSheets_();
    var target = normalizeDateValue_(dateValue || amTodayString_());
    if (target === amTodayString_() && !isBacktestCollectionWindowOpen_()) {
      throw new Error('장전 예측 사후검증은 오늘 일봉이 어느 정도 확정되는 15:50 이후에 실행하세요.');
    }
    var result = buildPremarketResultReviewForDate_(target);
    safeUiAlert_(formatPremarketResultReviewMessage_(result));
    return result;
  });
}

function ensurePremarketResultReviewForToday_() {
  return ensurePremarketResultReviewForDate_(amTodayString_());
}

function ensurePremarketResultReviewForDate_(dateValue) {
  var target = normalizeDateValue_(dateValue);
  if (!target) return { skipped: true, reason: 'empty_date' };
  if (target === amTodayString_() && !isBacktestCollectionWindowOpen_()) {
    logInfo_('premarket_result_review', 'Skipped before review window', { date: target });
    return { date: target, skipped: true, reason: 'before_review_window' };
  }
  if (countRowsByDate_(AM_CONFIG.SHEETS.PREMARKET_RESULT_REVIEW, target) > 0) {
    return { date: target, skipped: true, reason: 'already_exists' };
  }
  try {
    return buildPremarketResultReviewForDate_(target);
  } catch (err) {
    logWarn_('premarket_result_review', 'Premarket result review skipped', {
      date: target,
      error: err.message || String(err),
      stack: err.stack
    });
    return { date: target, skipped: true, reason: err.message || String(err) };
  }
}

function buildPremarketResultReviewForDate_(dateValue) {
  var target = normalizeDateValue_(dateValue);
  var premarketRow = readObjects_(AM_CONFIG.SHEETS.PREMARKET_BRIEFING).filter(function(row) {
    return normalizeDateValue_(row.date) === target;
  })[0];
  if (!premarketRow) {
    throw new Error(target + ' 장전 브리핑이 없어 장전 예측 사후검증을 만들 수 없습니다.');
  }
  var report = parseJsonCell_(premarketRow.briefing_json, {});
  var baseDate = normalizeDateValue_(premarketRow.base_leader_date);
  var marketRows = readObjects_(AM_CONFIG.SHEETS.MARKET_DAILY).filter(function(row) {
    return normalizeDateValue_(row.date) === target;
  });
  if (marketRows.length === 0) {
    throw new Error(target + ' 시장 일별 데이터가 없어 장전 예측 사후검증을 만들 수 없습니다.');
  }

  var breadthRows = getMarketBreadthForDate_(target);
  var actualRegime = classifyActualMarketRegimeForPremarketReview_(marketRows, breadthRows);
  var bias = String(report.market_bias || 'neutral').toLowerCase();
  var biasScore = scorePremarketBias_(bias, actualRegime);
  var watchDetails = buildPremarketWatchReviewDetails_(target, baseDate, report.today_watch || [], marketRows);
  var watchSummary = summarizePremarketWatchDetails_(watchDetails);
  var sectorReview = buildPremarketSectorReview_(report.sector_watch || [], getSectorStrengthForDate_(target));
  var predictionScore = Math.round(Math.min(100, Math.max(0,
    biasScore * 0.35 +
    watchSummary.watch_score * 0.45 +
    sectorReview.sector_match_score * 0.20
  )));
  var summaryText = buildPremarketReviewSummaryText_(bias, actualRegime, predictionScore, watchSummary, sectorReview);
  var detail = {
    opening_view: report.opening_view || '',
    do_first: report.do_first || [],
    avoid: report.avoid || [],
    actual_market: summarizeActualMarketForPremarketReview_(marketRows, breadthRows),
    watch_details: watchDetails,
    sector_review: sectorReview
  };
  var row = {
    date: target,
    base_leader_date: baseDate,
    market_bias: bias,
    actual_market_regime: actualRegime,
    bias_score: biasScore,
    watch_count: watchSummary.watch_count,
    watch_positive_count: watchSummary.watch_positive_count,
    watch_avg_return_pct: watchSummary.watch_avg_return_pct,
    sector_match_score: sectorReview.sector_match_score,
    prediction_score: predictionScore,
    summary: summaryText,
    detail_json: detail,
    created_at: amNowString_()
  };
  deleteRowsByDate_(AM_CONFIG.SHEETS.PREMARKET_RESULT_REVIEW, target);
  appendObjectRow_(AM_CONFIG.SHEETS.PREMARKET_RESULT_REVIEW, row);
  logInfo_('premarket_result_review', 'Premarket result review built', row);
  return {
    date: target,
    base_leader_date: baseDate,
    row: row,
    detail: detail
  };
}

function classifyActualMarketRegimeForPremarketReview_(marketRows, breadthRows) {
  var avgChange = averageNumber_(marketRows.map(function(row) {
    return Number(row.change_pct || 0);
  }));
  var allBreadth = findPremarketReviewBreadthRow_(breadthRows, 'ALL');
  var upRatio = allBreadth ? Number(allBreadth.up_ratio || 0) : percentageOfRows_(marketRows, function(row) {
    return Number(row.change_pct || 0) > 0;
  });
  if (avgChange >= 1.0 && upRatio >= 55) return 'risk_on';
  if (avgChange <= -1.0 || upRatio <= 40) return 'risk_off';
  return 'neutral';
}

function scorePremarketBias_(bias, actualRegime) {
  var predicted = String(bias || 'neutral').toLowerCase();
  var actual = String(actualRegime || 'neutral').toLowerCase();
  if (predicted === actual) return 100;
  if (predicted === 'neutral' || actual === 'neutral') return 60;
  return 20;
}

function buildPremarketWatchReviewDetails_(targetDate, baseDate, watchItems, marketRows) {
  var baseLeaders = readObjects_(AM_CONFIG.SHEETS.LEADER_50).filter(function(row) {
    return normalizeDateValue_(row.date) === baseDate;
  }).concat(readObjects_(AM_CONFIG.SHEETS.KOSDAQ_LEADER_50).filter(function(row) {
    return normalizeDateValue_(row.date) === baseDate;
  }));
  var todayLeaders = readObjects_(AM_CONFIG.SHEETS.LEADER_50).filter(function(row) {
    return normalizeDateValue_(row.date) === targetDate;
  }).concat(readObjects_(AM_CONFIG.SHEETS.KOSDAQ_LEADER_50).filter(function(row) {
    return normalizeDateValue_(row.date) === targetDate;
  }));
  var seen = {};
  return (watchItems || []).map(function(item) {
    var symbol = normalizeStockSymbol_(item.symbol);
    if (!symbol || seen[symbol]) return null;
    seen[symbol] = true;
    var actual = findFirstBySymbol_(marketRows, symbol) || {};
    var base = findFirstBySymbol_(baseLeaders, symbol) || {};
    var todayLeader = findFirstBySymbol_(todayLeaders, symbol) || {};
    var baseClose = Number(base.close || 0);
    var actualClose = Number(actual.close || 0);
    var returnPct = baseClose && actualClose ? roundNumber_((actualClose - baseClose) / baseClose * 100, 2) : Number(actual.change_pct || 0);
    var stayedLeader = !!todayLeader.symbol;
    var positive = returnPct > 0;
    var result = positive && stayedLeader ? '가격 상승 및 주도주 유지' :
      positive ? '가격 상승' :
      stayedLeader ? '주도주 유지' :
      returnPct <= -2 ? '관찰 부진' : '중립';
    return {
      symbol: symbol,
      name: item.name || actual.name || base.name || '',
      predicted_reason: item.watch_reason || '',
      first_check: item.first_check || '',
      risk_note: item.risk_note || '',
      base_close: baseClose || '',
      actual_close: actualClose || '',
      return_pct: returnPct,
      actual_change_pct: actual.change_pct,
      actual_trading_value: actual.trading_value,
      stayed_leader: yesNo_(stayedLeader),
      today_rank: todayLeader.rank || '',
      result: result
    };
  }).filter(function(row) {
    return !!row;
  });
}

function summarizePremarketWatchDetails_(details) {
  var rows = details || [];
  var withReturn = rows.filter(function(row) {
    return row.return_pct !== '' && row.return_pct !== undefined && !isNaN(Number(row.return_pct));
  });
  var positiveCount = withReturn.filter(function(row) {
    return Number(row.return_pct || 0) > 0;
  }).length;
  var stayedCount = rows.filter(function(row) {
    return String(row.stayed_leader || '').toUpperCase() === 'Y';
  }).length;
  var avgReturn = withReturn.length ? roundNumber_(averageNumber_(withReturn.map(function(row) {
    return Number(row.return_pct || 0);
  })), 2) : 0;
  var positiveRatio = withReturn.length ? positiveCount / withReturn.length : 0;
  var stayedRatio = rows.length ? stayedCount / rows.length : 0;
  var watchScore = Math.round(Math.min(100, Math.max(0, positiveRatio * 65 + stayedRatio * 35)));
  return {
    watch_count: rows.length,
    watch_positive_count: positiveCount,
    stayed_leader_count: stayedCount,
    watch_avg_return_pct: avgReturn,
    watch_score: watchScore
  };
}

function buildPremarketSectorReview_(sectorWatchItems, actualSectors) {
  var watchText = (sectorWatchItems || []).join(' ');
  var topSectors = (actualSectors || []).slice(0, 5).map(function(row) {
    return String(row.sector || '').trim();
  }).filter(function(sector) {
    return sector !== '';
  });
  var matched = topSectors.filter(function(sector) {
    return watchText.indexOf(sector) >= 0;
  });
  var score = topSectors.length ? Math.round(matched.length / Math.min(3, topSectors.length) * 100) : 0;
  score = Math.max(0, Math.min(100, score));
  return {
    sector_watch: sectorWatchItems || [],
    actual_top_sectors: topSectors,
    matched_sectors: matched,
    sector_match_score: score
  };
}

function buildPremarketReviewSummaryText_(bias, actualRegime, predictionScore, watchSummary, sectorReview) {
  var parts = [
    '장전 시장 방향은 ' + formatRegimeForPremarketReview_(bias) + '로 봤고, 실제 장마감은 ' + formatRegimeForPremarketReview_(actualRegime) + '였습니다.',
    '관찰 후보 ' + watchSummary.watch_count + '개 중 상승 마감 ' + watchSummary.watch_positive_count + '개, 평균 수익률 ' + formatPercentText_(watchSummary.watch_avg_return_pct) + '입니다.',
    '섹터 일치 점수는 ' + sectorReview.sector_match_score + '점입니다.'
  ];
  return '예측 검증 점수 ' + predictionScore + '/100. ' + parts.join(' ');
}

function summarizeActualMarketForPremarketReview_(marketRows, breadthRows) {
  var allBreadth = findPremarketReviewBreadthRow_(breadthRows, 'ALL');
  return {
    stock_count: marketRows.length,
    avg_change_pct: roundNumber_(averageNumber_(marketRows.map(function(row) {
      return Number(row.change_pct || 0);
    })), 2),
    up_ratio: allBreadth ? Number(allBreadth.up_ratio || 0) : percentageOfRows_(marketRows, function(row) {
      return Number(row.change_pct || 0) > 0;
    }),
    total_trading_value: marketRows.reduce(function(sum, row) {
      return sum + Number(row.trading_value || 0);
    }, 0)
  };
}

function findPremarketReviewBreadthRow_(rows, market) {
  var target = String(market || 'ALL');
  for (var i = 0; i < (rows || []).length; i += 1) {
    if (String(rows[i].market || '') === target) return rows[i];
  }
  return null;
}

function averageNumber_(values) {
  var rows = (values || []).filter(function(value) {
    return !isNaN(Number(value));
  }).map(function(value) {
    return Number(value);
  });
  if (rows.length === 0) return 0;
  return rows.reduce(function(sum, value) {
    return sum + value;
  }, 0) / rows.length;
}

function percentageOfRows_(rows, predicate) {
  if (!rows || rows.length === 0) return 0;
  var count = rows.filter(predicate).length;
  return roundNumber_(count / rows.length * 100, 2);
}

function formatRegimeForPremarketReview_(value) {
  var key = String(value || 'neutral').toLowerCase();
  if (key === 'risk_on') return '위험 선호';
  if (key === 'risk_off') return '위험 회피';
  return '중립';
}

function formatPremarketResultReviewMessage_(result) {
  var row = (result || {}).row || {};
  return [
    '장전 예측 사후검증 완료',
    '',
    '검증일: ' + (result.date || row.date || ''),
    '기준 주도주 날짜: ' + (result.base_leader_date || row.base_leader_date || ''),
    '예측 방향: ' + formatRegimeForPremarketReview_(row.market_bias),
    '실제 장마감: ' + formatRegimeForPremarketReview_(row.actual_market_regime),
    '예측 검증 점수: ' + (row.prediction_score || 0) + '/100',
    '관찰 후보 상승: ' + (row.watch_positive_count || 0) + ' / ' + (row.watch_count || 0),
    '관찰 후보 평균 수익률: ' + formatPercentText_(row.watch_avg_return_pct),
    '',
    '결과 시트: premarket_result_review'
  ].join('\n');
}
