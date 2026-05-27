function installDailyCloseTrigger() {
  deleteTriggersByHandler_('runDailyMvpPipeline');
  ScriptApp.newTrigger('runDailyMvpPipeline')
    .timeBased()
    .everyDays(1)
    .atHour(17)
    .create();
  logInfo_('triggers', 'Installed daily close trigger at script timezone hour 17', {});
}

function deleteTriggersByHandler_(handlerFunctionName) {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === handlerFunctionName) {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}

function onOpen() {
  var ui = SpreadsheetApp.getUi();
  var menu = ui.createMenu('AI Scanner');
  addAiScannerMenuEntries_(menu, getAiScannerQuickActions_(), ui);
  getAiScannerMenuGroups_().forEach(function(group) {
    menu.addSubMenu(buildAiScannerSubMenu_(ui, group));
  });
  menu.addToUi();
}

function buildAiScannerSubMenu_(ui, group) {
  var subMenu = ui.createMenu(group.title);
  addAiScannerMenuEntries_(subMenu, group.items, ui);
  return subMenu;
}

function addAiScannerMenuEntries_(menu, entries, ui) {
  entries.forEach(function(entry) {
    if (entry.separator) {
      menu.addSeparator();
      return;
    }
    if (entry.items) {
      menu.addSubMenu(buildAiScannerSubMenu_(ui, entry));
      return;
    }
    menu.addItem(entry.label, entry.functionName);
  });
  return menu;
}

// 새 명령은 onOpen에 직접 쓰지 말고, 아래 빠른 실행 또는 분류 그룹 중 하나에 추가한다.
function getAiScannerQuickActions_() {
  return [
    menuItem_('오늘 전체 실행', 'runFullDailyWorkflow'),
    menuItem_('이어서 실행', 'continueFullDailyWorkflow'),
    menuItem_('진행 상태 확인', 'getFullDailyWorkflowStatus'),
    menuItem_('품질 체크', 'validatePipelineResults'),
    menuItem_('시장 뉴스 수집', 'collectMarketNewsBriefing'),
    menuItem_('뉴스 점수 계산', 'scoreNewsBriefingDaily'),
    menuItem_('장전 예측 사후검증', 'buildPremarketResultReview'),
    menuItem_('모바일 명령판 갱신', 'refreshMobileCommandSheet'),
    menuItem_('모바일 명령 트리거 설치', 'installMobileCommandTriggers'),
    menuItem_('상황별 명령 가이드 갱신', 'refreshCommandGuideSheet'),
    menuSeparator_()
  ];
}

function getAiScannerMenuGroups_() {
  return [
    {
      title: '1. 처음 설정',
      items: [
        menuItem_('시트 만들기/초기화', 'setupAiMarketLeaderScanner'),
        menuItem_('상황별 명령 가이드 갱신', 'refreshCommandGuideSheet'),
        menuItem_('종목코드 텍스트 서식 고정', 'formatSymbolColumns'),
        menuItem_('프롬프트 기본값 적용', 'applyDefaultPromptTemplates'),
        menuItem_('시장 캘린더 갱신', 'refreshMarketCalendarSheet'),
        menuItem_('시장 캘린더 진단', 'runMarketCalendarDiagnostics'),
        menuItem_('코스닥 대표 종목 추가', 'addKosdaqRepresentativeUniverse'),
        menuItem_('KRX 전체 universe 확장', 'expandUniverseFromKrxLiquidity'),
        menuItem_('KRX 전체 상장종목 동기화', 'syncKrxListedUniverse'),
        menuItem_('KRX 거래대금 상위 활성화', 'activateKrxLiquidUniverse'),
        menuItem_('분석 종목 검증', 'validateMarketUniverse'),
        menuItem_('분석 종목 검증 이어서 실행', 'continueMarketUniverseValidation'),
        menuItem_('분석 종목 검증 상태 확인', 'getMarketUniverseValidationStatus'),
        menuItem_('무효 종목 비활성화', 'deactivateInvalidUniverseRows')
      ]
    },
    {
      title: '2. 매일 실행',
      items: [
        menuItem_('국내 장마감 1차 수집 실행', 'runDomesticCloseDataWorkflow'),
        menuSeparator_(),
        menuItem_('전체 워크플로우 실행', 'runFullDailyWorkflow'),
        menuItem_('전체 워크플로우 이어서 실행', 'continueFullDailyWorkflow'),
        menuItem_('전체 워크플로우 상태', 'getFullDailyWorkflowStatus'),
        menuSeparator_(),
        menuItem_('핵심 파이프라인 실행', 'runDailyMvpPipeline'),
        menuItem_('핵심 파이프라인 이어서 실행', 'continueDailyPipeline'),
        menuItem_('핵심 파이프라인 상태', 'getDailyPipelineStatus'),
        menuItem_('결과 검증/품질 체크', 'validatePipelineResults')
      ]
    },
    {
      title: '3. 장전 리포트',
      items: [
        menuItem_('장전 리포트 실행', 'runPremarketWorkflow'),
        menuItem_('장전 자동화 설치 07:00', 'installPremarketTrigger')
      ]
    },
    {
      title: '4. 데이터 수집/계산',
      items: [
        menuItem_('거시지표 수집', 'collectMacroRaw'),
        menuItem_('시장 뉴스 수집', 'collectMarketNewsBriefing'),
        menuItem_('시나리오 생성', 'buildScenariosDaily'),
        menuItem_('시장 폭 지표 계산', 'buildMarketBreadthDaily'),
        menuItem_('주도주/코스닥 점수 재계산', 'rebuildLeaderScores'),
        menuItem_('주도주 변화 기록 생성', 'buildLeaderHistoryDaily'),
        menuItem_('전일 리포트 사후검증', 'buildDailyBacktestLog'),
        menuItem_('장전 예측 사후검증', 'buildPremarketResultReview'),
        menuSeparator_(),
        menuItem_('섹터 강도 계산', 'buildSectorStrengthDaily'),
        menuItem_('ETF 구성종목 수집', 'collectEtfHoldings'),
        menuItem_('ETF 점수 계산', 'calculateEtfScoresFromHoldings'),
        menuItem_('투자자 수급 연결 진단', 'runInvestorFlowDiagnostics'),
        menuItem_('투자자 수급 수집', 'collectInvestorFlowDaily'),
        menuItem_('투자자 수급 점수 계산', 'calculateInvestorFlowScores'),
        menuSeparator_(),
        menuItem_('뉴스 점수 계산', 'scoreNewsBriefingDaily'),
        menuSeparator_(),
        menuItem_('DART 기업코드 동기화', 'syncDartCorpMaster'),
        menuItem_('DART 재무/공시 수집', 'collectDartFinancialsForLeaders')
      ]
    },
    {
      title: '5. AI/메일',
      items: [
        menuItem_('Gemini 비용 효율 정책 적용', 'applyGeminiCostAwareModelPolicy'),
        menuItem_('Gemini 모델 정책 확인', 'runGeminiModelPolicyDiagnostics'),
        menuItem_('Gemini 리포트 생성', 'buildAiReports'),
        menuItem_('메일 리포트 발송', 'sendDailyEmailReport')
      ]
    },
    {
      title: '6. 내 계좌/보유종목',
      items: [
        menuItem_('계좌 잔고 조회 진단', 'runAccountBalanceDiagnostics'),
        menuItem_('보유종목 수집', 'collectHoldingsCurrent'),
        menuItem_('수동 보유종목 가져오기', 'importManualHoldingsCurrent'),
        menuItem_('보유종목 어드바이스 생성', 'buildHoldingsAdvice'),
        menuSeparator_(),
        menuItem_('가상 시뮬레이터 실행', 'runPaperTradingSimulationFromMenu'),
        menuItem_('가상 자산 리셋 (500만원)', 'resetPaperTradingSimulation')
      ]
    },
    {
      title: '7. 연결 진단',
      items: [
        menuItem_('KIS 연결 진단', 'runKisConnectionDiagnostics'),
        menuItem_('계좌 잔고 조회 진단', 'runAccountBalanceDiagnostics'),
        menuItem_('KIS 현재가 테스트', 'testKisCurrentPrice'),
        menuItem_('KIS 일봉 테스트', 'testKisDailyPrices'),
        menuSeparator_(),
        menuItem_('ETF 연결 진단', 'runEtfDiagnostics'),
        menuItem_('투자자 수급 연결 진단', 'runInvestorFlowDiagnostics'),
        menuItem_('KRX OPEN API 연결 진단', 'runKrxOpenApiDiagnostics'),
        menuItem_('DART 연결 진단', 'runDartConnectionDiagnostics'),
        menuItem_('거시지표 연결 진단', 'runMacroDiagnostics'),
        menuItem_('Gemini 연결 진단', 'runGeminiDiagnostics'),
        menuItem_('Gemini 비용 효율 정책 적용', 'applyGeminiCostAwareModelPolicy'),
        menuItem_('Gemini 모델 정책 확인', 'runGeminiModelPolicyDiagnostics'),
        menuItem_('텔레그램 모바일 연동 테스트', 'runTelegramTestConnection'),
        menuItem_('텔레그램 챗봇 실시간 진단', 'runTelegramConnectionDiagnostics')
      ]
    },
    {
      title: '8. 자동화',
      items: [
        menuItem_('자동화 상태 진단', 'runAutomationStatusDiagnostics'),
        menuItem_('장마감+장전 자동화 모두 설치', 'installCoreAutomationTriggers'),
        menuItem_('장마감 누락 복구 실행', 'recoverDailyWorkflowNow'),
        menuItem_('복구 워치독 설치 10분', 'installWorkflowWatchdogTrigger'),
        menuItem_('모바일 명령판 갱신', 'refreshMobileCommandSheet'),
        menuItem_('모바일 명령 트리거 설치', 'installMobileCommandTriggers'),
        menuItem_('모바일 명령 즉시 처리', 'processMobileCommandQueue'),
        menuItem_('국내 장마감 1차 수집 설치 16:10', 'installDomesticCloseDataTrigger'),
        menuItem_('장마감 자동화 설치', 'installFullDailyWorkflowTrigger'),
        menuItem_('장전 자동화 설치 07:00', 'installPremarketTrigger'),
        menuItem_('기본 일일 파이프라인 트리거 설치', 'installDailyCloseTrigger'),
        menuItem_('텔레그램 양방향 웹훅 등록', 'registerTelegramWebhook'),
        menuItem_('텔레그램 실시간 감시 트리거 설치', 'installTelegramIntradayTriggers'),
        menuItem_('텔레그램 챗봇 실시간 진단', 'runTelegramConnectionDiagnostics')
      ]
    }
  ];
}

function menuItem_(label, functionName) {
  return {
    label: label,
    functionName: functionName
  };
}

function menuSeparator_() {
  return { separator: true };
}

function installCoreAutomationTriggers() {
  return withLogging_('triggers', function() {
    deleteTriggersByHandler_('runDailyMvpPipeline');
    installDomesticCloseDataTrigger(true);
    installFullDailyWorkflowTrigger(true);
    installPremarketTrigger(true);
    installWorkflowWatchdogTrigger(true);
    installMobileCommandTriggers(true);
    safeUiAlert_([
      '핵심 자동화 설치 완료',
      '',
      '국내 장마감 1차 수집: 16:10 근처',
      '장마감 전체 워크플로우: 17:10 근처',
      '장전 브리핑: 07:00 근처',
      '복구 워치독: 10분마다',
      '모바일 명령 감지: 체크박스 수정 시 즉시, 백업 5분마다',
      '',
      '다음: AI Scanner > 8. 자동화 > 자동화 상태 진단'
    ].join('\n'));
  });
}

function runAutomationStatusDiagnostics() {
  return withLogging_('automation_diagnostics', function() {
    ensureAllSheets_();
    var triggers = ScriptApp.getProjectTriggers().map(function(trigger) {
      return {
        handler: trigger.getHandlerFunction(),
        event_type: String(trigger.getEventType()),
        source: String(trigger.getTriggerSource())
      };
    });
    var fullTriggerCount = countTriggersByHandler_(triggers, 'runFullDailyWorkflow');
    var domesticTriggerCount = countTriggersByHandler_(triggers, 'runDomesticCloseDataWorkflow');
    var premarketTriggerCount = countTriggersByHandler_(triggers, 'runPremarketWorkflow');
    var watchdogTriggerCount = countTriggersByHandler_(triggers, 'runWorkflowWatchdog');
    var mobileEditTriggerCount = countTriggersByHandler_(triggers, 'handleMobileCommandEdit');
    var mobileQueueTriggerCount = countTriggersByHandler_(triggers, 'processMobileCommandQueue');
    var pipelineTriggerCount = countTriggersByHandler_(triggers, 'runDailyMvpPipeline');
    var continuationCount = countTriggersByHandler_(triggers, 'continueFullDailyWorkflow') +
      countTriggersByHandler_(triggers, 'continueDailyPipeline');
    var fullTriggerTime = getScriptProperty_('AM_FULL_WORKFLOW_TRIGGER_TIME', '');
    var domesticTriggerTime = getScriptProperty_('AM_DOMESTIC_CLOSE_TRIGGER_TIME', '');
    var premarketTriggerTime = getScriptProperty_('AM_PREMARKET_TRIGGER_TIME', '');
    var result = {
      checked_at: amNowString_(),
      timezone: Session.getScriptTimeZone(),
      domestic_close_trigger_installed: domesticTriggerCount > 0,
      domestic_close_trigger_time: domesticTriggerTime,
      domestic_close_trigger_target_ok: domesticTriggerCount > 0 && domesticTriggerTime === '16:10',
      full_close_trigger_installed: fullTriggerCount > 0,
      full_close_trigger_time: fullTriggerTime,
      full_close_trigger_target_ok: fullTriggerCount > 0 && fullTriggerTime === '17:10',
      premarket_trigger_installed: premarketTriggerCount > 0,
      premarket_trigger_time: premarketTriggerTime,
      premarket_trigger_target_ok: premarketTriggerCount > 0 && premarketTriggerTime === '07:00',
      watchdog_trigger_installed: watchdogTriggerCount > 0,
      mobile_command_edit_trigger_installed: mobileEditTriggerCount > 0,
      mobile_command_queue_trigger_installed: mobileQueueTriggerCount > 0,
      legacy_daily_pipeline_trigger_installed: pipelineTriggerCount > 0,
      continuation_triggers: continuationCount,
      full_workflow_status: getFullWorkflowState_(),
      daily_pipeline_status: getDailyPipelineState_(),
      today_daily_email_sent: countLogRowsTodayByModuleAndMessage_('email_report', 'Daily email report sent'),
      today_premarket_email_sent: countLogRowsTodayByModuleAndMessage_('premarket_email', 'Premarket email report sent'),
      triggers: triggers
    };
    logInfo_('automation_diagnostics', 'Automation status checked', result);
    safeUiAlert_(formatAutomationStatusMessage_(result));
    return result;
  });
}

function countTriggersByHandler_(triggers, handlerName) {
  return triggers.filter(function(trigger) {
    return trigger.handler === handlerName;
  }).length;
}

function formatAutomationStatusMessage_(result) {
  var lines = [
    'AI Scanner 자동화 상태 진단',
    '',
    '확인 시각: ' + result.checked_at,
    '스크립트 시간대: ' + result.timezone,
    '',
    '[설치 상태]',
    '국내 장마감 1차 수집 16:10: ' + formatTargetTriggerStatusKo_(result.domestic_close_trigger_installed, result.domestic_close_trigger_target_ok, result.domestic_close_trigger_time),
    '장마감 전체 워크플로우 17:10: ' + formatTargetTriggerStatusKo_(result.full_close_trigger_installed, result.full_close_trigger_target_ok, result.full_close_trigger_time),
    '장전 브리핑 07:00: ' + formatTargetTriggerStatusKo_(result.premarket_trigger_installed, result.premarket_trigger_target_ok, result.premarket_trigger_time),
    '복구 워치독 10분: ' + formatInstalledKo_(result.watchdog_trigger_installed),
    '모바일 명령 감지: ' + formatInstalledKo_(result.mobile_command_edit_trigger_installed) + ' / 5분 백업: ' + formatInstalledKo_(result.mobile_command_queue_trigger_installed),
    '기본 일일 파이프라인 17시: ' + formatInstalledKo_(result.legacy_daily_pipeline_trigger_installed),
    '이어서 실행 대기 트리거: ' + result.continuation_triggers,
    '',
    '[오늘 발송 로그]',
    '장마감 메일: ' + result.today_daily_email_sent + '건',
    '장전 메일: ' + result.today_premarket_email_sent + '건',
    '',
    '[진행 상태]',
    '전체 워크플로우: ' + formatStateLineForAutomation_(result.full_workflow_status),
    '핵심 파이프라인: ' + formatStateLineForAutomation_(result.daily_pipeline_status),
    '',
    '참고: Apps Script 시간 기반 트리거는 지정 시각 근처에 실행되며 몇 분 정도 지연될 수 있습니다.'
  ];
  if (!result.domestic_close_trigger_target_ok || !result.full_close_trigger_target_ok || !result.premarket_trigger_target_ok || !result.watchdog_trigger_installed || !result.mobile_command_edit_trigger_installed || !result.mobile_command_queue_trigger_installed) {
    lines.push('');
    lines.push('[필요 조치]');
    if (!result.domestic_close_trigger_target_ok) lines.push('- AI Scanner > 8. 자동화 > 국내 장마감 1차 수집 설치 16:10 또는 장마감+장전 자동화 모두 설치');
    if (!result.full_close_trigger_target_ok) lines.push('- AI Scanner > 8. 자동화 > 장마감 자동화 설치 또는 장마감+장전 자동화 모두 설치');
    if (!result.premarket_trigger_target_ok) lines.push('- AI Scanner > 8. 자동화 > 장전 자동화 설치 07:00 또는 장마감+장전 자동화 모두 설치');
    if (!result.watchdog_trigger_installed) lines.push('- AI Scanner > 8. 자동화 > 복구 워치독 설치 10분 또는 장마감+장전 자동화 모두 설치');
    if (!result.mobile_command_edit_trigger_installed || !result.mobile_command_queue_trigger_installed) lines.push('- AI Scanner > 8. 자동화 > 모바일 명령 트리거 설치');
  }
  return lines.join('\n');
}

function formatInstalledKo_(installed) {
  return installed ? '설치됨' : '미설치';
}

function formatTargetTriggerStatusKo_(installed, targetOk, recordedTime) {
  if (!installed) return '미설치';
  if (targetOk) return '설치됨';
  return '설치됨, 시간 재설치 필요' + (recordedTime ? ' (기록: ' + recordedTime + ')' : '');
}

function formatStateLineForAutomation_(state) {
  if (!state || !state.stage) return '(기록 없음)';
  var parts = [formatStageKo_(state.stage)];
  if (state.index !== undefined && state.index !== '') parts.push('진행 위치=' + state.index);
  if (state.dart_index !== undefined && state.dart_index !== '') parts.push('DART=' + state.dart_index + '/' + (state.dart_total || ''));
  if (state.updated_at) parts.push('업데이트=' + state.updated_at);
  return parts.join(', ');
}

// === 텔레그램 실시간 스마트 감시 및 시간 연동 트리거 설치 ===

function installTelegramIntradayTriggers() {
  return withLogging_('triggers', function() {
    deleteTriggersByHandler_('checkIntradayMonitors');
    deleteTriggersByHandler_('checkIntradayInvestorFlow');
    deleteTriggersByHandler_('checkOvernightUsMarket');
    
    // 1. 장중 5분 감시 트리거 설치
    ScriptApp.newTrigger('checkIntradayMonitors')
      .timeBased()
      .everyMinutes(5)
      .create();
      
    // 2. 오후 13:40 장중 수급 브리핑 트리거 설치
    ScriptApp.newTrigger('checkIntradayInvestorFlow')
      .timeBased()
      .everyDays(1)
      .atHour(13)
      .nearMinute(40)
      .create();
      
    // 3. 오전 06:30 야간 미 증시 변동 요약 트리거 설치
    ScriptApp.newTrigger('checkOvernightUsMarket')
      .timeBased()
      .everyDays(1)
      .atHour(6)
      .nearMinute(30)
      .create();
      
    safeUiAlert_([
      '텔레그램 실시간 스마트 알림 트리거 설치 완료 🚀',
      '',
      '- 장중 돌파 및 손절선 위격 실시간 감시: 매 5분마다',
      '- 오후 13:40 장중 수급 유입 브리핑: 매일 13:40',
      '- 아침 06:30 야간 미 증시 변동 요약: 매일 06:30',
      '',
      '이제 모바일을 통해 장중 돌파 속보 및 야간 변동 보고가 실시간으로 자동 배달됩니다!'
    ].join('\n'));
    
    logInfo_('triggers', 'Installed 3 Advanced Telegram Intraday scheduled triggers successfully', {});
  });
}
