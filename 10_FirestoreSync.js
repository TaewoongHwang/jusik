/**
 * Google Apps Script - Firebase Firestore Sync Engine
 * 
 * 헌장 제 1조(무결성 및 우아한 강하) 및 제 9조(순환 재귀 방지)를 준수하여 설계됨.
 * 외부 라이브러리 의존성 없이 순수 REST API를 활용해 대용량 포트폴리오 상태를
 * Firebase Firestore로 실시간 캐싱 동기화 처리합니다.
 */

/**
 * 포트폴리오 데이터를 Firebase Firestore로 동기화합니다.
 * @param {Object} payload getPortfolioDataForWeb(false)가 반환하는 원본 데이터 객체
 */
function syncPortfolioToFirestore_(payload) {
  var service = PropertiesService.getScriptProperties();
  var projectId = service.getProperty('FIREBASE_PROJECT_ID');
  var secretToken = service.getProperty('FIREBASE_SYNC_TOKEN');
  
  if (!projectId || !secretToken) {
    logWarn_('firestore_sync', 'FIREBASE_PROJECT_ID or FIREBASE_SYNC_TOKEN properties are not set. Skipping Firestore sync.');
    return;
  }
  
  // payload에 secretToken 삽입하여 Firestore 보안 규칙 통과 유도
  var syncData = {
    totalAsset: payload.totalAsset || 0,
    totalPurchase: payload.totalPurchase || 0,
    totalProfitLoss: payload.totalProfitLoss || 0,
    percentChange: payload.percentChange || 0,
    currentMode: payload.currentMode || 'REAL',
    totalCash: payload.totalCash || 0,
    totalRealizedPl: payload.totalRealizedPl || 0,
    assetsJson: JSON.stringify(payload.assets || []),
    secretToken: secretToken,
    updatedAt: new Date().toISOString()
  };
  
  var fields = {};
  var updateMaskParams = [];
  
  for (var key in syncData) {
    var val = syncData[key];
    updateMaskParams.push('updateMask.fieldPaths=' + encodeURIComponent(key));
    
    if (typeof val === 'number') {
      if (val % 1 === 0) {
        // Firestore REST API 규격 상 64비트 정수는 문자열로 변환해 전달해야 안전합니다.
        fields[key] = { integerValue: String(val) };
      } else {
        fields[key] = { doubleValue: val };
      }
    } else if (typeof val === 'boolean') {
      fields[key] = { booleanValue: val };
    } else if (key === 'updatedAt') {
      fields[key] = { timestampValue: val };
    } else {
      fields[key] = { stringValue: String(val) };
    }
  }
  
  var documentBody = {
    fields: fields
  };
  
  // PATCH 메소드를 사용해 기존 문서를 덮어쓰거나 없으면 생성합니다.
  var url = 'https://firestore.googleapis.com/v1/projects/' + encodeURIComponent(projectId) + 
            '/databases/(default)/documents/users/my_user/portfolio/current?' + 
            updateMaskParams.join('&');
            
  var options = {
    method: 'patch',
    contentType: 'application/json',
    payload: JSON.stringify(documentBody),
    muteHttpExceptions: true
  };
  
  var response = UrlFetchApp.fetch(url, options);
  var code = response.getResponseCode();
  
  if (code >= 200 && code < 300) {
    logInfo_('firestore_sync', 'Firestore portfolio sync completed successfully (HTTP ' + code + ')');
  } else {
    var responseText = response.getContentText();
    logWarn_('firestore_sync', 'Firestore sync failed (ERROR)', {
      responseCode: code,
      body: responseText
    });
    throw new Error('Firestore Sync Error: HTTP ' + code + ' - ' + responseText);
  }
}
