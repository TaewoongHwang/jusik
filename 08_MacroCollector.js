var AM_FRED_SERIES = [
  { name: 'us_10y_yield', series_id: 'DGS10', role: 'risk_rate' },
  { name: 'us_2y_yield', series_id: 'DGS2', role: 'risk_rate' },
  { name: 'us_fed_funds', series_id: 'FEDFUNDS', role: 'policy_rate' },
  { name: 'usd_krw', series_id: 'DEXKOUS', role: 'fx' },
  { name: 'nasdaq_composite', series_id: 'NASDAQCOM', role: 'risk_asset' },
  { name: 'sp500', series_id: 'SP500', role: 'risk_asset' },
  { name: 'dow_jones', series_id: 'DJIA', role: 'risk_asset' },
  { name: 'vix', series_id: 'VIXCLS', role: 'volatility' },
  { name: 'japan_10y_yield', series_id: 'IRLTLT01JPM156N', role: 'global_rate' },
  { name: 'germany_10y_yield', series_id: 'IRLTLT01DEM156N', role: 'global_rate' },
  { name: 'uk_10y_yield', series_id: 'IRLTLT01GBM156N', role: 'global_rate' }
];

function runMacroDiagnostics() {
  return withLogging_('macro_diagnostics', function() {
    ensureAllSheets_();
    var fredKey = getScriptProperty_(AM_CONFIG.PROPERTY_KEYS.FRED_API_KEY, '');
    var ecosKey = getScriptProperty_(AM_CONFIG.PROPERTY_KEYS.ECOS_API_KEY, '');
    var messages = [];
    if (fredKey) {
      var test = fetchFredLatestObservation_('DGS10', fredKey);
      messages.push('FRED: 정상 / 미국 10년물 금리=' + test.value + ' / 기준일=' + test.observation_date);
    } else {
      messages.push('FRED: FRED_API_KEY가 없습니다.');
    }
    if (ecosKey) {
      var ecosTest = fetchEcosKoreaBaseRate_(ecosKey);
      messages.push('ECOS: 정상 / 한국 기준금리=' + ecosTest.value + ' / 기준일=' + ecosTest.observation_date);
    } else {
      messages.push('ECOS: ECOS_API_KEY가 없습니다.');
    }
    logInfo_('macro_diagnostics', 'Macro diagnostics completed', {
      fred_key: fredKey ? maskSecret_(fredKey) : '',
      ecos_key: ecosKey ? maskSecret_(ecosKey) : '',
      messages: messages
    });
    safeUiAlert_(['거시지표 연결 진단', ''].concat(messages).join('\n'));
    return messages;
  });
}

function collectMacroRaw() {
  return withLogging_('macro_collector', function() {
    ensureAllSheets_();
    var today = amTodayString_();
    var fredKey = getRequiredScriptProperty_(AM_CONFIG.PROPERTY_KEYS.FRED_API_KEY);
    deleteRowsByDate_(AM_CONFIG.SHEETS.MACRO_RAW, today);
    deleteRowsByDate_(AM_CONFIG.SHEETS.MACRO_SCORE, today);

    var observations = [];
    AM_FRED_SERIES.forEach(function(series) {
      observations.push(fetchFredObservationRowSafely_(series, fredKey, today));
    });

    appendEcosKoreaBaseRate_(observations, today);
    observations.forEach(function(row) {
      appendObjectRow_(AM_CONFIG.SHEETS.MACRO_RAW, row);
    });
    var score = calculateMacroScore_(observations);
    appendObjectRow_(AM_CONFIG.SHEETS.MACRO_SCORE, score);
    logInfo_('macro_collector', 'Macro raw and score collected', {
      date: today,
      count: observations.length,
      market_regime: score.market_regime,
      macro_alignment_score: score.macro_alignment_score
    });
    safeUiAlert_([
      '거시지표 수집 완료',
      '',
      '수집 행 수: ' + observations.length,
      '시장 국면: ' + score.market_regime,
      '거시 점수: ' + score.macro_alignment_score,
      '',
      '결과 시트: macro_raw, macro_score'
    ].join('\n'));
    return score;
  });
}

function fetchFredObservationRowSafely_(series, fredKey, today) {
  try {
    var observation = fetchFredLatestObservation_(series.series_id, fredKey);
    return {
      date: today,
      name: series.name,
      value: observation.value,
      change: observation.change,
      change_pct: observation.change_pct,
      source: 'fred:' + series.series_id,
      raw_json: observation
    };
  } catch (err) {
    logWarn_('macro_collector', 'FRED series skipped', {
      name: series.name,
      series_id: series.series_id,
      error: err.message || String(err)
    });
    return {
      date: today,
      name: series.name,
      value: '',
      change: '',
      change_pct: '',
      source: 'fred_error:' + series.series_id,
      raw_json: { error: err.message || String(err) }
    };
  }
}

function fetchFredLatestObservation_(seriesId, apiKey) {
  var startDate = Utilities.formatDate(new Date(new Date().getTime() - 120 * 24 * 60 * 60 * 1000), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var url = 'https://api.stlouisfed.org/fred/series/observations?' + buildQueryString_({
    series_id: seriesId,
    api_key: apiKey,
    file_type: 'json',
    observation_start: startDate,
    sort_order: 'desc',
    limit: 20
  });
  var json = apiFetchJson_(url, { method: 'get', muteHttpExceptions: true }, 'fred');
  var usable = (json.observations || []).filter(function(row) {
    return row.value !== undefined && row.value !== null && row.value !== '.';
  }).map(function(row) {
    return {
      date: row.date,
      value: Number(row.value)
    };
  }).filter(function(row) {
    return !isNaN(row.value);
  });
  if (usable.length === 0) {
    throw new Error('FRED series has no usable observations: ' + seriesId);
  }
  var latest = usable[0];
  var previous = usable.length > 1 ? usable[1] : latest;
  var change = latest.value - previous.value;
  return {
    series_id: seriesId,
    observation_date: latest.date,
    previous_date: previous.date,
    value: latest.value,
    previous_value: previous.value,
    change: roundMacroNumber_(change),
    change_pct: previous.value === 0 ? 0 : roundMacroNumber_(change / previous.value * 100)
  };
}

function appendEcosKoreaBaseRate_(observations, today) {
  var ecosKey = getScriptProperty_(AM_CONFIG.PROPERTY_KEYS.ECOS_API_KEY, '');
  if (!ecosKey) {
    observations.push({
      date: today,
      name: 'korea_base_rate',
      value: '',
      change: '',
      change_pct: '',
      source: 'ecos:not_configured',
      raw_json: { message: 'Set ECOS_API_KEY to enable Korea base-rate collection.' }
    });
    return;
  }
  var observation = fetchEcosKoreaBaseRate_(ecosKey);
  observations.push({
    date: today,
    name: 'korea_base_rate',
    value: observation.value,
    change: observation.change,
    change_pct: observation.change_pct,
    source: 'ecos:722Y001:0101000',
    raw_json: observation
  });
}

function fetchEcosKoreaBaseRate_(apiKey) {
  // ECOS StatisticSearch format: /StatisticSearch/{key}/json/{lang}/1/{count}/{stat_code}/{cycle}/{start}/{end}/{item_code1}
  // Korea base rate: stat_code=722Y001, item_code1=0101000, monthly cycle.
  var now = new Date();
  var start = Utilities.formatDate(new Date(now.getFullYear() - 2, now.getMonth(), 1), Session.getScriptTimeZone(), 'yyyyMM');
  var end = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyyMM');
  var url = 'https://ecos.bok.or.kr/api/StatisticSearch/' +
    encodeURIComponent(apiKey) + '/json/kr/1/100/722Y001/M/' +
    encodeURIComponent(start) + '/' + encodeURIComponent(end) + '/0101000';
  var json = apiFetchJson_(url, { method: 'get', muteHttpExceptions: true }, 'ecos');
  var root = json.StatisticSearch;
  if (!root || !root.row || !Array.isArray(root.row)) {
    throw new Error('ECOS korea base-rate response missing StatisticSearch.row: ' + JSON.stringify(json));
  }
  var usable = root.row.map(function(row) {
    return {
      date: String(row.TIME || ''),
      value: Number(row.DATA_VALUE)
    };
  }).filter(function(row) {
    return row.date && !isNaN(row.value);
  }).sort(function(a, b) {
    return a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
  });
  if (usable.length === 0) {
    throw new Error('ECOS korea base-rate has no usable observations.');
  }
  var latest = usable[0];
  var previous = usable.length > 1 ? usable[1] : latest;
  var change = latest.value - previous.value;
  return {
    stat_code: '722Y001',
    item_code1: '0101000',
    observation_date: latest.date,
    previous_date: previous.date,
    value: latest.value,
    previous_value: previous.value,
    change: roundMacroNumber_(change),
    change_pct: previous.value === 0 ? 0 : roundMacroNumber_(change / previous.value * 100)
  };
}

function calculateMacroScore_(observations) {
  var byName = {};
  observations.forEach(function(row) {
    byName[row.name] = row;
  });
  var score = 5;
  var reasons = [];
  var us10Change = Number((byName.us_10y_yield || {}).change || 0);
  var usdKrwChangePct = Number((byName.usd_krw || {}).change_pct || 0);
  var nasdaqChangePct = Number((byName.nasdaq_composite || {}).change_pct || 0);
  var sp500ChangePct = Number((byName.sp500 || {}).change_pct || 0);
  var dowChangePct = Number((byName.dow_jones || {}).change_pct || 0);
  var vixChangePct = Number((byName.vix || {}).change_pct || 0);
  var koreaBaseRateChange = Number((byName.korea_base_rate || {}).change || 0);

  if (us10Change <= -0.05) {
    score += 1;
    reasons.push('US 10Y yield eased.');
  } else if (us10Change >= 0.05) {
    score -= 1;
    reasons.push('US 10Y yield rose.');
  }

  if (usdKrwChangePct <= -0.4) {
    score += 1;
    reasons.push('USD/KRW eased.');
  } else if (usdKrwChangePct >= 0.4) {
    score -= 1;
    reasons.push('USD/KRW rose.');
  }

  if (nasdaqChangePct >= 0.8) {
    score += 2;
    reasons.push('Nasdaq strengthened.');
  } else if (nasdaqChangePct <= -0.8) {
    score -= 2;
    reasons.push('Nasdaq weakened.');
  }

  if (sp500ChangePct >= 0.6 && dowChangePct >= 0.4) {
    score += 1;
    reasons.push('US broad indices strengthened.');
  } else if (sp500ChangePct <= -0.6 && dowChangePct <= -0.4) {
    score -= 1;
    reasons.push('US broad indices weakened.');
  }

  if (vixChangePct <= -5) {
    score += 1;
    reasons.push('VIX cooled.');
  } else if (vixChangePct >= 5) {
    score -= 1;
    reasons.push('VIX rose.');
  }

  if (koreaBaseRateChange < 0) {
    score += 1;
    reasons.push('Korea base rate eased.');
  } else if (koreaBaseRateChange > 0) {
    score -= 1;
    reasons.push('Korea base rate rose.');
  }

  score = Math.max(0, Math.min(10, score));
  var regime = score >= 7 ? 'risk_on' : score <= 3 ? 'risk_off' : 'neutral';
  return {
    date: amTodayString_(),
    market_regime: regime,
    macro_alignment_score: score,
    memo: reasons.join(' ') || 'Macro signals are mixed or unchanged.'
  };
}

function getLatestMacroAlignmentScore_() {
  var rows = readObjects_(AM_CONFIG.SHEETS.MACRO_SCORE);
  if (rows.length === 0) return 0;
  var latest = rows.reduce(function(best, row) {
    if (!best) return row;
    return normalizeDateValue_(row.date) > normalizeDateValue_(best.date) ? row : best;
  }, null);
  return Number(latest.macro_alignment_score || 0);
}

function getLatestMacroSnapshot_() {
  var scoreRows = readObjects_(AM_CONFIG.SHEETS.MACRO_SCORE);
  if (scoreRows.length === 0) {
    return { market_regime: 'neutral', macro_alignment_score: 0, memo: 'Macro data is not collected yet.', raw: [] };
  }
  var latestScore = scoreRows.reduce(function(best, row) {
    if (!best) return row;
    return normalizeDateValue_(row.date) > normalizeDateValue_(best.date) ? row : best;
  }, null);
  var dateValue = normalizeDateValue_(latestScore.date);
  var raw = readObjects_(AM_CONFIG.SHEETS.MACRO_RAW).filter(function(row) {
    return normalizeDateValue_(row.date) === dateValue;
  });
  return {
    date: dateValue,
    market_regime: latestScore.market_regime || 'neutral',
    macro_alignment_score: Number(latestScore.macro_alignment_score || 0),
    memo: latestScore.memo || '',
    raw: raw.map(function(row) {
      return {
        name: row.name,
        value: row.value,
        change: row.change,
        change_pct: row.change_pct,
        source: row.source
      };
    })
  };
}

function roundMacroNumber_(value) {
  return Math.round(Number(value) * 10000) / 10000;
}
