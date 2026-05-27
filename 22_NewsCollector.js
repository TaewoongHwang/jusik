function collectMarketNewsBriefing() {
  return withLogging_('news_briefing', function() {
    ensureAllSheets_();
    var today = amTodayString_();
    deleteRowsByDate_(AM_CONFIG.SHEETS.NEWS_BRIEFING, today);
    ['korea_close', 'us_close'].forEach(function(session) {
      var result = collectNewsSessionSafely_(session, today);
      appendObjectRow_(AM_CONFIG.SHEETS.NEWS_BRIEFING, {
        date: today,
        session: session,
        summary_json: result.json,
        sources_json: result.sources,
        created_at: amNowString_()
      });
    });
    scoreNewsBriefingDaily();
    logInfo_('news_briefing', 'Market news briefing collected', { date: today, sessions: 2 });
    safeUiAlert_([
      '시장 뉴스 브리핑 수집 완료',
      '',
      '수집 세션: 국내 마감 뉴스, 미국 마감 뉴스',
      '결과 시트: news_briefing'
    ].join('\n'));
  });
}

function collectNewsSessionSafely_(session, today) {
  try {
    var result = callGeminiGroundedJson_(buildNewsGroundingPrompt_(session, today), {
      maxOutputTokens: 2048,
      temperature: 0.15,
      modelUseCase: 'news_grounding'
    });
    result.json = normalizeNewsBriefingJson_(session, result.json);
    return result;
  } catch (err) {
    logWarn_('news_briefing', 'Grounded news collection failed; writing fallback briefing', {
      date: today,
      session: session,
      error: err.message || String(err)
    });
    return {
      json: buildFallbackNewsBriefing_(session),
      sources: [],
      model: 'fallback'
    };
  }
}

function normalizeNewsBriefingJson_(session, json) {
  var value = json && typeof json === 'object' ? json : {};
  var keyNews = Array.isArray(value.key_news) ? value.key_news.filter(function(item) {
    return item && (item.topic || item.comment);
  }) : [];
  if (keyNews.length === 0) {
    logWarn_('news_briefing', 'Grounded news response had empty key_news; using fallback briefing', {
      session: session,
      headline_summary: value.headline_summary || ''
    });
    return buildFallbackNewsBriefing_(session);
  }
  value.session = value.session || session;
  value.headline_summary = value.headline_summary || buildNewsHeadlineFallback_(session);
  value.key_news = keyNews.slice(0, 3).map(function(item) {
    var impact = item.impact || 'neutral';
    var impactScore = Number(item.impact_score || 0);
    if (!impactScore) impactScore = inferNewsImpactScore_(impact, item.comment || item.topic || '');
    return {
      topic: item.topic || '시장 이슈',
      impact: impact,
      impact_score: Math.max(1, Math.min(5, impactScore)),
      duration: item.duration || 'short',
      affected_sectors: Array.isArray(item.affected_sectors) ? item.affected_sectors : ['전반'],
      comment: item.comment || '영향을 확인해야 합니다.'
    };
  });
  value.korea_market_implications = Array.isArray(value.korea_market_implications) ? value.korea_market_implications : [];
  value.watch_points = Array.isArray(value.watch_points) ? value.watch_points : [];
  return value;
}

function buildNewsHeadlineFallback_(session) {
  return session === 'korea_close'
    ? '국내 장마감 뉴스 요약입니다. 지수, 업종, 환율, 금리, 주요 공시를 함께 확인합니다.'
    : '미국 장마감 뉴스 요약입니다. 나스닥, 금리, 환율, VIX가 한국 증시에 미칠 영향을 확인합니다.';
}

function buildFallbackNewsBriefing_(session) {
  return {
    session: session,
    headline_summary: '뉴스 자동 수집 결과를 JSON으로 해석하지 못했습니다. 이번 리포트는 매크로 지표와 내부 스코어를 우선 기준으로 해석합니다.',
    key_news: [
      {
        topic: '뉴스 수집 보류',
        impact: 'neutral',
        affected_sectors: ['전반'],
        comment: 'Gemini Search Grounding 응답이 깨진 JSON으로 반환되어 보수적으로 중립 처리했습니다.'
      }
    ],
    korea_market_implications: ['뉴스 영향은 중립으로 두고 금리, 환율, 지수, 수급 데이터를 우선 확인합니다.'],
    watch_points: ['다음 실행에서 뉴스 수집이 정상 복구되는지 logs 시트를 확인합니다.']
  };
}

function buildNewsGroundingPrompt_(session, dateValue) {
  var calendar = getMarketCalendarSummary_(dateValue);
  var leaders = readObjects_(AM_CONFIG.SHEETS.LEADER_50).filter(function(row) {
    return normalizeDateValue_(row.date) === normalizeDateValue_(dateValue);
  }).slice(0, 10).map(function(row) {
    return {
      symbol: normalizeStockSymbol_(row.symbol),
      name: row.name,
      sector: row.sector,
      risk_level: row.risk_level,
      total_score: Number(row.total_score || 0)
    };
  });
  var macro = getLatestMacroSnapshot_();
  var focus = session === 'us_close'
    ? [
        '미국 장마감 이후 한국 장전 판단에 필요한 뉴스만 우선 검색하세요.',
        '검색 의도: 미국 증시 마감, 나스닥, S&P500, 미국 10년물 금리, 달러, 원/달러 환율, VIX, 반도체, AI, 바이오, 방산, 에너지.',
        '한국 장전 리포트에서 오늘 시초가 방향, 위험 선호/회피, 피해야 할 섹터를 판단하는 데 쓸 수 있게 요약하세요.'
      ].join(' ')
    : [
        '한국 장마감 뉴스만 우선 검색하세요.',
        '검색 의도: 오늘 코스피 마감, 코스닥 마감, 국내 증시 마감, 환율, 금리, 외국인 수급, 기관 수급, 업종 강세, 특징주, 공시, 정책.',
        '가능하면 한국어 기사와 국내 시장 마감 기사 중심으로 요약하세요.',
        '장후 리포트에서 오늘 시장 복기와 다음 거래일 준비에 쓸 수 있게, 오늘 시장을 움직인 원인과 내일 남는 위험/기회만 설명하세요.'
      ].join(' ');
  return [
    'Use Google Search grounding to summarize recent market news.',
    'Write Korean strings. Return valid JSON only. No markdown.',
    'Do not include citations such as [cite: 1] inside JSON string values.',
    'Return exactly one JSON object. Do not repeat the object. Do not add text before or after JSON.',
    'Do not make buy recommendations. Explain likely relevance and risks only.',
    'Limit key_news to exactly 3 items. key_news must not be empty. Keep each comment under 80 Korean characters.',
    calendar.kr_open ? '' : 'Korea market is closed on this date. Do not invent KOSPI/KOSDAQ close movements; summarize holiday context, overseas news, and next trading-day preparation.',
    (!calendar.us_open && session === 'us_close') ? 'US market is closed on this date. Clearly state that there is no fresh US close signal; do not invent US index moves.' : '',
    session === 'korea_close' ? 'For korea_close, all topic/comment strings must be about Korean market close, KOSPI/KOSDAQ, sectors, FX, rates, flows, disclosures, or policy.' : '',
    'Focus: ' + focus,
    'Date: ' + dateValue,
    'Market calendar:',
    JSON.stringify(calendar),
    'Required JSON shape:',
    JSON.stringify({
      session: session,
      headline_summary: 'short Korean summary',
      key_news: [
        {
          topic: 'short topic',
          impact: 'risk_on|neutral|risk_off|sector_specific',
          impact_score: 1,
          duration: 'short|medium|long',
          affected_sectors: ['sector'],
          comment: 'short Korean explanation'
        }
      ],
      korea_market_implications: ['short Korean implication'],
      watch_points: ['short Korean checklist item']
    }),
    'Current macro snapshot:',
    JSON.stringify(macro),
    'Current leader candidates:',
    JSON.stringify(leaders)
  ].join('\n');
}

function getNewsBriefingForDate_(dateValue) {
  var target = normalizeDateValue_(dateValue);
  return readObjects_(AM_CONFIG.SHEETS.NEWS_BRIEFING).filter(function(row) {
    return normalizeDateValue_(row.date) === target;
  }).map(function(row) {
    return {
      session: row.session,
      summary: parseJsonCell_(row.summary_json, {}),
      sources: parseJsonCell_(row.sources_json, [])
    };
  });
}
