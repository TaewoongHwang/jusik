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
  var supabaseKey = service.getProperty('SUPABASE_KEY'); // anon key
  
  if (!supabaseUrl || !supabaseKey) {
    logWarn_('supabase_sync', 'SUPABASE_URL or SUPABASE_KEY properties are not set. Skipping Supabase sync.');
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
  
  if (payload.assets && payload.assets.length > 0) {
    payload.assets.forEach(function(a) {
      holdingsPayload.push({
        symbol: a.symbol,
        name: a.name,
        quantity: a.qty,
        avg_price: a.price,
        current_price: a.currentPrice,
        purchase_amount: a.qty * a.price,
        eval_amount: a.qty * a.currentPrice,
        profit_loss_amount: a.profitLossAmount || 0,
        profit_loss_pct: a.profitLossPct || 0,
        portfolio_weight_pct: a.portfolio_weight_pct || 0,
        source: a.broker || 'KIS계좌',
        currency: a.isUsd ? 'USD' : 'KRW',
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
