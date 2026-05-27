function getKisAccessToken_() {
  validateRealRuntimeConfig_();
  
  // 1. CacheService에서 인메모리 빠른 조회 시도 (100ms -> 5ms 미만 단축)
  var cache = CacheService.getScriptCache();
  var cachedToken = cache.get(AM_CONFIG.PROPERTY_KEYS.KIS_ACCESS_TOKEN);
  if (cachedToken) {
    return cachedToken;
  }
  
  // 2. 캐시 미스 시 Script Properties에서 백업 조회
  var token = getScriptProperty_(AM_CONFIG.PROPERTY_KEYS.KIS_ACCESS_TOKEN, '');
  var expiresAt = Number(getScriptProperty_(AM_CONFIG.PROPERTY_KEYS.KIS_ACCESS_TOKEN_EXPIRES_AT, '0'));
  var now = new Date().getTime();
  
  if (token && expiresAt > now + 5 * 60 * 1000) {
    var cacheSec = Math.floor((expiresAt - now - 5 * 60 * 1000) / 1000);
    if (cacheSec > 0) {
      // 최대 캐시 타임아웃 제한 적용 (Apps Script는 최대 6시간 = 21600초 제한)
      cache.put(AM_CONFIG.PROPERTY_KEYS.KIS_ACCESS_TOKEN, token, Math.min(cacheSec, 21600));
    }
    return token;
  }
  
  return issueKisAccessToken_();
}

function issueKisAccessToken_() {
  var baseUrl = getScriptProperty_(AM_CONFIG.PROPERTY_KEYS.KIS_BASE_URL, AM_CONFIG.DEFAULT_KIS_BASE_URL);
  var appKey = getRequiredScriptProperty_(AM_CONFIG.PROPERTY_KEYS.KIS_APP_KEY);
  var appSecret = getRequiredScriptProperty_(AM_CONFIG.PROPERTY_KEYS.KIS_APP_SECRET);

  var url = baseUrl + '/oauth2/tokenP';
  var payload = {
    grant_type: 'client_credentials',
    appkey: appKey,
    appsecret: appSecret
  };
  var result = apiFetchJson_(url, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'content-type': 'application/json; charset=utf-8'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  }, 'kis_auth');

  var accessToken = result.access_token;
  if (!accessToken) {
    throw new Error('KIS token response did not include access_token');
  }
  var expiresInSeconds = Number(result.expires_in || 86400);
  var expiresAt = new Date().getTime() + expiresInSeconds * 1000;
  
  // Script Properties 영구 보관
  setScriptProperty_(AM_CONFIG.PROPERTY_KEYS.KIS_ACCESS_TOKEN, accessToken);
  setScriptProperty_(AM_CONFIG.PROPERTY_KEYS.KIS_ACCESS_TOKEN_EXPIRES_AT, expiresAt);
  
  // CacheService 즉시 캐싱 등록 (Apps Script 메모리 저장)
  var cache = CacheService.getScriptCache();
  var now = new Date().getTime();
  var cacheSec = Math.floor((expiresAt - now - 5 * 60 * 1000) / 1000);
  if (cacheSec > 0) {
    cache.put(AM_CONFIG.PROPERTY_KEYS.KIS_ACCESS_TOKEN, accessToken, Math.min(cacheSec, 21600));
  }
  
  logInfo_('kis_auth', 'Issued KIS access token and cached in memory', { expires_at: expiresAt });
  return accessToken;
}
