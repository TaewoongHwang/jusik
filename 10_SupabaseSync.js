/**
 * Google Apps Script - Supabase (PostgreSQL) REST Sync Engine
 * 
 * 헌장 제 1조(무결성) 및 제 9조(순환 재귀 방지)를 준수하여 설계됨.
 * 외부 라이브러리 의존성 없이 순수 REST API를 활용해 대용량 포트폴리오 상태를
 * Supabase PostgreSQL 데이터베이스로 초고속 캐싱 동기화 처리합니다.
 */

/**
 * 포트폴리오 데이터를 Supabase PostgreSQL로 동기화합니다.
 * @param {Object} payload getPortfolioDataForWeb(false)가 반환하는 원본 데이터 객체
 */
function syncPortfolioToSupabase_(payload) {
  var service = PropertiesService.getScriptProperties();
  var supabaseUrl = service.getProperty('SUPABASE_URL');
  var supabaseKey = service.getProperty('SUPABASE_SECRET_KEY');
  
  if (!supabaseUrl || !supabaseKey) {
    logWarn_('supabase_sync', 'SUPABASE_URL or SUPABASE_SECRET_KEY properties are not set. Skipping Supabase sync.');
    return;
  }

  if (!isSupabaseServerKey_(supabaseKey)) {
    logWarn_('supabase_sync', 'Supabase sync blocked because SUPABASE_SECRET_KEY is not a server-only secret/service_role key.');
    return;
  }
  
  // URL 끝 슬래시 제거 처리
  if (supabaseUrl.charAt(supabaseUrl.length - 1) === '/') {
    supabaseUrl = supabaseUrl.substring(0, supabaseUrl.length - 1);
  }

  var headers = {
    'apikey': supabaseKey,
    'Authorization': 'Bearer ' + supabaseKey,
    'Content-Type': 'application/json'
  };

  // 1단계: 기존 holdings 테이블 데이터 전체 비우기 (오래된 고립 데이터 방지)
  // PostgREST 보안 정책 상 안전 삭제를 위해 'symbol=not.is.null' 필터를 적용합니다.
  try {
    var deleteUrl = supabaseUrl + '/rest/v1/holdings?symbol=not.is.null';
    var deleteOptions = {
      method: 'delete',
      headers: headers,
      muteHttpExceptions: true
    };
    var deleteResponse = UrlFetchApp.fetch(deleteUrl, deleteOptions);
    if (deleteResponse.getResponseCode() >= 300) {
      logWarn_('supabase_sync', 'Failed to clear holdings table', { code: deleteResponse.getResponseCode(), body: deleteResponse.getContentText() });
    }
  } catch(delErr) {
    logWarn_('supabase_sync', 'Error clearing holdings table', { error: delErr.message });
  }

  // 2단계: 신규 holdings 데이터 벌크 삽입 (Bulk Insert)
  var holdingsPayload = [];
  var todayIso = new Date().toISOString();
  var usdRate = parseFloat(payload.usdRate || 0) || 1350;
  try {
    var liveUsdRate = getLiveUsdRate_();
    if (liveUsdRate > 500) usdRate = liveUsdRate;
  } catch(rateErr) {}
  
  if (payload.assets && payload.assets.length > 0) {
    payload.assets.forEach(function(a) {
      var qty = parseFloat(a.qty || 0);
      var priceKrw = parseFloat(a.priceKrw || 0);
      var currentPriceKrw = parseFloat(a.currentPriceKrw || 0);
      var isUsd = a.isUsd === true;
      var unitAvg = isUsd ? (priceKrw > 0 ? roundNumber_(priceKrw / usdRate, 4) : parseFloat(a.price || 0)) : (priceKrw || parseFloat(a.price || 0));
      var unitCurrent = isUsd ? (currentPriceKrw > 0 ? roundNumber_(currentPriceKrw / usdRate, 4) : parseFloat(a.currentPrice || 0)) : (currentPriceKrw || parseFloat(a.currentPrice || 0));
      var purchaseAmountKrw = qty * (priceKrw || (isUsd ? unitAvg * usdRate : unitAvg));
      var evalAmountKrw = qty * (currentPriceKrw || (isUsd ? unitCurrent * usdRate : unitCurrent));
      holdingsPayload.push({
        symbol: a.symbol,
        name: a.name,
        quantity: qty,
        avg_price: unitAvg,
        current_price: unitCurrent,
        purchase_amount: purchaseAmountKrw,
        eval_amount: evalAmountKrw,
        profit_loss_amount: evalAmountKrw - purchaseAmountKrw,
        profit_loss_pct: a.profitLossPct || 0,
        portfolio_weight_pct: a.portfolio_weight_pct || 0,
        source: a.broker || 'KIS계좌',
        currency: isUsd ? 'USD' : 'KRW',
        change_pct: a.changePct || 0,
        updated_at: todayIso
      });
    });
  }

  if (holdingsPayload.length > 0) {
    try {
      var insertUrl = supabaseUrl + '/rest/v1/holdings';
      var insertOptions = {
        method: 'post',
        headers: headers,
        payload: JSON.stringify(holdingsPayload),
        muteHttpExceptions: true
      };
      var insertResponse = UrlFetchApp.fetch(insertUrl, insertOptions);
      var code = insertResponse.getResponseCode();
      if (code >= 200 && code < 300) {
        logInfo_('supabase_sync', 'Successfully synced holdings to Supabase (' + holdingsPayload.length + ' assets)');
      } else {
        logWarn_('supabase_sync', 'Failed to insert holdings', { code: code, body: insertResponse.getContentText() });
      }
    } catch(insErr) {
      logWarn_('supabase_sync', 'Error inserting holdings to Supabase', { error: insErr.message });
    }
  }

  // 3단계: 포트폴리오 종합 메트릭 데이터를 settings 테이블에 Upsert
  var settingsPayload = [
    { key: 'portfolio_total_asset', value: String(payload.totalAsset || 0), description: '총 평가자산', updated_at: todayIso },
    { key: 'portfolio_total_purchase', value: String(payload.totalPurchase || 0), description: '총 매수금액', updated_at: todayIso },
    { key: 'portfolio_total_profit_loss', value: String(payload.totalProfitLoss || 0), description: '평가손익금액', updated_at: todayIso },
    { key: 'portfolio_percent_change', value: String(payload.percentChange || 0), description: '누적 수익률', updated_at: todayIso },
    { key: 'portfolio_total_cash', value: String(payload.totalCash || 0), description: '예수금 잔고', updated_at: todayIso },
    { key: 'portfolio_total_realized_pl', value: String(payload.totalRealizedPl || 0), description: '누적 실현 손익', updated_at: todayIso },
    { key: 'portfolio_current_mode', value: String(payload.currentMode || 'REAL'), description: '투자 모드', updated_at: todayIso }
  ];

  settingsPayload.push({
    key: 'portfolio_usd_rate',
    value: String(payload.usdRate || usdRate || 1350),
    description: 'USD/KRW exchange rate used for display conversion',
    updated_at: todayIso
  });

  try {
    var settingsUrl = supabaseUrl + '/rest/v1/settings';
    
    // PostgREST에서 Upsert(ON CONFLICT DO UPDATE)를 수행하기 위해 Prefer 헤더를 삽입합니다.
    var settingsHeaders = Object.assign({}, headers, {
      'Prefer': 'resolution=merge-dup'
    });
    
    var settingsOptions = {
      method: 'post',
      headers: settingsHeaders,
      payload: JSON.stringify(settingsPayload),
      muteHttpExceptions: true
    };
    
    var settingsResponse = UrlFetchApp.fetch(settingsUrl, settingsOptions);
    var sCode = settingsResponse.getResponseCode();
    if (sCode >= 200 && sCode < 300) {
      logInfo_('supabase_sync', 'Successfully synced settings metrics to Supabase');
    } else {
      logWarn_('supabase_sync', 'Failed to upsert settings metrics', { code: sCode, body: settingsResponse.getContentText() });
    }
  } catch(setErr) {
    logWarn_('supabase_sync', 'Error syncing settings metrics to Supabase', { error: setErr.message });
  }
}

function syncQuantScoresToSupabase_(scores, dateText, vaaPayload) {
  var service = PropertiesService.getScriptProperties();
  var supabaseUrl = service.getProperty('SUPABASE_URL');
  var supabaseKey = service.getProperty('SUPABASE_SECRET_KEY');

  if (!supabaseUrl || !supabaseKey) {
    logWarn_('supabase_sync', 'SUPABASE_URL or SUPABASE_SECRET_KEY properties are not set. Skipping quant score sync.');
    return;
  }

  if (!isSupabaseServerKey_(supabaseKey)) {
    logWarn_('supabase_sync', 'Quant score sync blocked because SUPABASE_SECRET_KEY is not a server-only secret/service_role key.');
    return;
  }

  supabaseUrl = String(supabaseUrl).replace(/\/+$/, '');
  var headers = {
    'apikey': supabaseKey,
    'Authorization': 'Bearer ' + supabaseKey,
    'Content-Type': 'application/json'
  };

  var today = dateText || amTodayString_();
  var nowIso = new Date().toISOString();
  var rows = (scores || []).map(function(s) {
    var symbol = normalizeStockSymbol_(s.symbol);
    return {
      date: today,
      symbol: symbol,
      market: /^[0-9][A-Z0-9]{5}$/i.test(symbol) ? 'KR' : 'US',
      name: s.name || symbol,
      price: supabaseNumberOrNull_(s.price),
      per: String(s.per === undefined ? 'N/A' : s.per),
      pbr: String(s.pbr === undefined ? 'N/A' : s.pbr),
      gpa: String(s.gpa === undefined ? 'N/A' : s.gpa),
      momentum_pct: supabaseNumberOrNull_(s.momentum_pct),
      momentum_val: supabaseNumberOrNull_(s.momentum_val),
      rsi: supabaseNumberOrNull_(s.rsi),
      roe: String(s.roe === undefined ? 'N/A' : s.roe),
      debt: String(s.debt === undefined ? 'N/A' : s.debt),
      div_yield: supabaseNumberOrNull_(s.div_yield),
      beta: supabaseNumberOrNull_(s.beta),
      peg: String(s.peg === undefined ? 'N/A' : s.peg),
      srim_price: String(s.srim_price === undefined ? 'N/A' : s.srim_price),
      safety_margin: String(s.safety_margin === undefined ? 'N/A' : s.safety_margin),
      is_etf: s.is_etf === true,
      quant_score: supabaseNumberOrNull_(s.quant_score),
      per_val: supabaseNumberOrNull_(s.per_val),
      pbr_val: supabaseNumberOrNull_(s.pbr_val),
      gpa_val: supabaseNumberOrNull_(s.gpa_val),
      roe_val: supabaseNumberOrNull_(s.roe_val),
      debt_val: supabaseNumberOrNull_(s.debt_val),
      div_yield_val: supabaseNumberOrNull_(s.div_yield_val),
      beta_val: supabaseNumberOrNull_(s.beta_val),
      peg_val: supabaseNumberOrNull_(s.peg_val),
      updated_at: nowIso
    };
  });

  try {
    var deleteResponse = UrlFetchApp.fetch(supabaseUrl + '/rest/v1/quant_scores?symbol=not.is.null', {
      method: 'delete',
      headers: headers,
      muteHttpExceptions: true
    });
    if (deleteResponse.getResponseCode() >= 300) {
      logWarn_('supabase_sync', 'Failed to clear quant_scores table', {
        code: deleteResponse.getResponseCode(),
        body: deleteResponse.getContentText()
      });
    }
  } catch(delErr) {
    logWarn_('supabase_sync', 'Error clearing quant_scores table', { error: delErr.message });
  }

  if (rows.length > 0) {
    try {
      var insertResponse = UrlFetchApp.fetch(supabaseUrl + '/rest/v1/quant_scores', {
        method: 'post',
        headers: headers,
        payload: JSON.stringify(rows),
        muteHttpExceptions: true
      });
      var code = insertResponse.getResponseCode();
      if (code >= 200 && code < 300) {
        logInfo_('supabase_sync', 'Successfully synced quant scores to Supabase', { count: rows.length });
      } else {
        logWarn_('supabase_sync', 'Failed to insert quant scores', { code: code, body: insertResponse.getContentText() });
      }
    } catch(insErr) {
      logWarn_('supabase_sync', 'Error inserting quant scores to Supabase', { error: insErr.message });
    }
  }

  try {
    var settingsPayload = [
      { key: 'quant_scores_updated_at', value: nowIso, description: 'Latest quant score cache timestamp', updated_at: nowIso },
      { key: 'quant_scores_date', value: today, description: 'Latest quant score cache date', updated_at: nowIso }
    ];
    if (vaaPayload) {
      settingsPayload.push({
        key: 'quant_vaa_payload',
        value: JSON.stringify(vaaPayload),
        description: 'Latest VAA strategy signal payload',
        updated_at: nowIso
      });
    }

    var settingsHeaders = Object.assign({}, headers, { 'Prefer': 'resolution=merge-dup' });
    var settingsResponse = UrlFetchApp.fetch(supabaseUrl + '/rest/v1/settings', {
      method: 'post',
      headers: settingsHeaders,
      payload: JSON.stringify(settingsPayload),
      muteHttpExceptions: true
    });
    if (settingsResponse.getResponseCode() >= 300) {
      logWarn_('supabase_sync', 'Failed to upsert quant settings metrics', {
        code: settingsResponse.getResponseCode(),
        body: settingsResponse.getContentText()
      });
    }
  } catch(setErr) {
    logWarn_('supabase_sync', 'Error syncing quant settings metrics', { error: setErr.message });
  }
}

function supabaseNumberOrNull_(value) {
  if (value === undefined || value === null || value === '' || value === 'N/A') return null;
  var n = parseFloat(value);
  return isNaN(n) ? null : n;
}

function isSupabaseServerKey_(key) {
  var value = String(key || '').trim();
  if (value.indexOf('sb_secret_') === 0) return true;
  if (value.indexOf('eyJ') !== 0) return false;

  try {
    var parts = value.split('.');
    if (parts.length < 2) return false;
    var payloadText = Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[1])).getDataAsString();
    var payload = JSON.parse(payloadText);
    return payload.role === 'service_role';
  } catch(e) {
    return false;
  }
}

function getSupabaseSecurityStatus_() {
  var service = PropertiesService.getScriptProperties();
  var publicKey = service.getProperty('SUPABASE_KEY') || '';
  var secretKey = service.getProperty('SUPABASE_SECRET_KEY') || '';
  return {
    urlConfigured: !!service.getProperty('SUPABASE_URL'),
    legacyKeyConfigured: !!publicKey,
    legacyKeyIsPublishable: publicKey.indexOf('sb_publishable_') === 0,
    secretKeyConfigured: !!secretKey,
    secretKeyAccepted: isSupabaseServerKey_(secretKey)
  };
}

function probeSupabaseServerAccess_() {
  var service = PropertiesService.getScriptProperties();
  var supabaseUrl = String(service.getProperty('SUPABASE_URL') || '').replace(/\/+$/, '');
  var supabaseKey = String(service.getProperty('SUPABASE_SECRET_KEY') || '').trim();

  if (!supabaseUrl) throw new Error('SUPABASE_URL이 설정되어 있지 않습니다.');
  if (!isSupabaseServerKey_(supabaseKey)) {
    throw new Error('SUPABASE_SECRET_KEY가 서버 전용 키 형식이 아닙니다.');
  }

  var headers = {
    apikey: supabaseKey,
    Authorization: 'Bearer ' + supabaseKey
  };

  function requestStatus_(table, select) {
    var response = UrlFetchApp.fetch(
      supabaseUrl + '/rest/v1/' + table + '?select=' + encodeURIComponent(select) + '&limit=1',
      {
        method: 'get',
        headers: headers,
        muteHttpExceptions: true
      }
    );
    return response.getResponseCode();
  }

  return {
    holdingsStatus: requestStatus_('holdings', 'symbol'),
    settingsStatus: requestStatus_('settings', 'key')
  };
}

function probeSupabaseTableCounts_() {
  var service = PropertiesService.getScriptProperties();
  var supabaseUrl = String(service.getProperty('SUPABASE_URL') || '').replace(/\/+$/, '');
  var supabaseKey = String(service.getProperty('SUPABASE_SECRET_KEY') || '').trim();

  if (!supabaseUrl) throw new Error('SUPABASE_URL이 설정되어 있지 않습니다.');
  if (!isSupabaseServerKey_(supabaseKey)) {
    throw new Error('SUPABASE_SECRET_KEY가 서버 전용 키 형식이 아닙니다.');
  }

  var headers = {
    apikey: supabaseKey,
    Authorization: 'Bearer ' + supabaseKey,
    Prefer: 'count=exact'
  };

  function countRows_(table, select) {
    var response = UrlFetchApp.fetch(
      supabaseUrl + '/rest/v1/' + table + '?select=' + encodeURIComponent(select) + '&limit=1',
      {
        method: 'get',
        headers: headers,
        muteHttpExceptions: true
      }
    );
    var code = response.getResponseCode();
    if (code >= 300) {
      return {
        ok: false,
        code: code,
        count: null,
        error: response.getContentText()
      };
    }
    var range = response.getHeaders()['Content-Range'] || response.getAllHeaders()['Content-Range'] || '';
    var match = String(range).match(/\/(\d+)$/);
    return {
      ok: true,
      code: code,
      count: match ? Number(match[1]) : null,
      contentRange: range
    };
  }

  return {
    holdings: countRows_('holdings', 'symbol'),
    settings: countRows_('settings', 'key')
  };
}

function forceSyncSupabasePortfolioCache_() {
  var payload = getPortfolioDataForWeb(false);
  var counts = probeSupabaseTableCounts_();
  return {
    ok: true,
    payloadAssets: payload && payload.assets ? payload.assets.length : 0,
    totalAsset: payload ? payload.totalAsset : 0,
    currentMode: payload ? payload.currentMode : '',
    counts: counts
  };
}

function menuForceSyncSupabasePortfolio() {
  var ui = SpreadsheetApp.getUi();
  try {
    var result = forceSyncSupabasePortfolioCache_();
    ui.alert(
      'Supabase 포트폴리오 캐시 동기화 완료',
      [
        'payload assets: ' + result.payloadAssets,
        'mode: ' + result.currentMode,
        'totalAsset: ' + result.totalAsset,
        'holdings rows: ' + (result.counts.holdings.count === null ? JSON.stringify(result.counts.holdings) : result.counts.holdings.count),
        'settings rows: ' + (result.counts.settings.count === null ? JSON.stringify(result.counts.settings) : result.counts.settings.count)
      ].join('\n'),
      ui.ButtonSet.OK
    );
  } catch (err) {
    ui.alert('Supabase 포트폴리오 캐시 동기화 실패', err.message || String(err), ui.ButtonSet.OK);
    throw err;
  }
}

function saveSupabaseSecretFromUi(secretKey) {
  var value = String(secretKey || '').trim();
  if (!isSupabaseServerKey_(value)) {
    throw new Error('sb_secret_ 서버 키 또는 service_role 키만 저장할 수 있습니다.');
  }

  var service = PropertiesService.getScriptProperties();
  service.setProperty('SUPABASE_SECRET_KEY', value);
  service.deleteProperty('SUPABASE_KEY');

  var status = getSupabaseSecurityStatus_();
  if (!status.secretKeyConfigured || !status.secretKeyAccepted) {
    throw new Error('서버 키 저장 상태를 확인하지 못했습니다.');
  }

  return {
    ok: true,
    message: '서버 키를 Script Properties에 저장하고 기존 공개 키 속성을 제거했습니다.'
  };
}
