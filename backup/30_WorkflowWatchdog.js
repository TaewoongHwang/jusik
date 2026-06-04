function installWorkflowWatchdogTrigger(suppressAlert) {
  deleteTriggersByHandler_('runWorkflowWatchdog');
  ScriptApp.newTrigger('runWorkflowWatchdog')
    .timeBased()
    .everyMinutes(10)
    .create();
  setScriptProperty_('AM_WORKFLOW_WATCHDOG_TRIGGER_TIME', 'every_10_minutes');
  logInfo_('triggers', 'Installed workflow watchdog trigger every 10 minutes', {});
  if (!suppressAlert) {
    safeUiAlert_('복구 워치독 자동화가 10분마다 실행되도록 설치되었습니다.\n\n멈춘 장마감 워크플로우와 누락된 메일 발송을 자동으로 복구합니다.');
  }
}

function recoverDailyWorkflowNow() {
  var result = runWorkflowWatchdog({ force: true, interactive: true });
  safeUiAlert_(formatWorkflowWatchdogResult_(result));
  return result;
}

function runWorkflowWatchdog(options) {
  var opts = options || {};
  if (!opts.interactive) {
    globalIsInteractiveContext_ = false;
  }
  return withLogging_('workflow_watchdog', function() {
    ensureAllSheets_();
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) {
      logWarn_('workflow_watchdog', 'Skipped because another workflow run holds the lock', {});
      return { checked_at: amNowString_(), skipped: true, reason: 'lock_busy', actions: [] };
    }
    try {
      var opts = options || {};
      var result = {
        checked_at: amNowString_(),
        force: opts.force === true,
        actions: [],
        state_before: getFullWorkflowState_(),
        state_after: null,
        daily_email_sent_before: hasDailyEmailAlreadySent_(amTodayString_()) ? 1 : 0,
        daily_email_sent_after: 0
      };

      ensureCoreAutomationTriggersForWatchdog_(result);
      recoverCloseWorkflowForWatchdog_(result);
      sendLateDailyEmailForWatchdog_(result);
      recoverPremarketForWatchdog_(result);

      result.state_after = getFullWorkflowState_();
      result.daily_email_sent_after = hasDailyEmailAlreadySent_(amTodayString_()) ? 1 : 0;
      logInfo_('workflow_watchdog', 'Workflow watchdog checked automation state', result);
      return result;
    } finally {
      lock.releaseLock();
    }
  });
}

function ensureCoreAutomationTriggersForWatchdog_(result) {
  var triggers = ScriptApp.getProjectTriggers().map(function(trigger) {
    return { handler: trigger.getHandlerFunction() };
  });
  if (countTriggersByHandler_(triggers, 'runDomesticCloseDataWorkflow') === 0) {
    installDomesticCloseDataTrigger(true);
    result.actions.push('국내 장마감 1차 수집 트리거 재설치');
  }
  if (countTriggersByHandler_(triggers, 'runFullDailyWorkflow') === 0) {
    installFullDailyWorkflowTrigger(true);
    result.actions.push('장마감 전체 워크플로우 트리거 재설치');
  }
  if (countTriggersByHandler_(triggers, 'runPremarketWorkflow') === 0) {
    installPremarketTrigger(true);
    result.actions.push('장전 브리핑 트리거 재설치');
  }
  if (countTriggersByHandler_(triggers, 'runWorkflowWatchdog') === 0) {
    installWorkflowWatchdogTrigger(true);
    result.actions.push('복구 워치독 트리거 재설치');
  }
  if (countTriggersByHandler_(triggers, 'handleMobileCommandEdit') === 0 ||
      countTriggersByHandler_(triggers, 'processMobileCommandQueue') === 0) {
    installMobileCommandTriggers(true);
    result.actions.push('모바일 명령 트리거 재설치');
  }
}

function recoverCloseWorkflowForWatchdog_(result) {
  var today = amTodayString_();
  var state = getFullWorkflowState_();
  var dailyEmailSent = result.daily_email_sent_before;
  if (dailyEmailSent > 0) return;
  if (isWorkflowFailureBlocked_(AM_FULL_WORKFLOW_PROP_PREFIX) || isWorkflowFailureBlocked_(AM_PIPELINE_PROP_PREFIX)) {
    result.actions.push('recovery paused: workflow failure guard is blocked. Check logs, fix the error, then start the workflow manually.');
    return;
  }
  if (!result.force && !isAfterTimeForWatchdog_(1720)) return;
  if (state.date && normalizeDateValue_(state.date) !== today) return;

  if (!state.date) {
    if (result.force || isAfterTimeForWatchdog_(1730)) {
      result.actions.push('오늘 장마감 워크플로우 새로 시작');
      runWorkflowStepSafely_('장마감 워크플로우 시작 실패', runFullDailyWorkflow, result);
    }
    return;
  }

  if (state.stage === 'done') return;

  var ageMinutes = minutesSinceWorkflowTimestamp_(state.updated_at);
  var triggers = ScriptApp.getProjectTriggers().map(function(trigger) {
    return { handler: trigger.getHandlerFunction() };
  });
  var continuationCount = countTriggersByHandler_(triggers, 'continueFullDailyWorkflow') +
    countTriggersByHandler_(triggers, 'continueDailyPipeline');
  if (result.force || ageMinutes >= 12 || continuationCount === 0) {
    deleteTriggersByHandler_('continueFullDailyWorkflow');
    result.actions.push('멈춘 전체 워크플로우 이어서 실행: ' + formatStageKo_(state.stage) + ', ' + Math.round(ageMinutes) + '분 정체');
    runWorkflowStepSafely_('전체 워크플로우 이어서 실행 실패', continueFullDailyWorkflow, result);
  }
}

function sendLateDailyEmailForWatchdog_(result) {
  var today = amTodayString_();
  if (hasDailyEmailAlreadySent_(today)) return;
  var state = getFullWorkflowState_();
  if (normalizeDateValue_(state.date) !== today) return;
  if (state.stage === 'email') {
    result.actions.push('메일 단계에서 멈춘 워크플로우 이어서 실행');
    runWorkflowStepSafely_('메일 단계 이어서 실행 실패', continueFullDailyWorkflow, result);
    return;
  }
  if (state.stage === 'gemini' && hasDailyEmailInputsForWatchdog_(today)) {
    result.actions.push('Gemini 단계가 멈췄지만 AI 리포트 행이 있어 장마감 메일 발송을 복구');
    var beforeSent = hasDailyEmailAlreadySent_(today);
    runWorkflowStepSafely_('장마감 메일 복구 발송 실패', sendDailyEmailReport, result);
    var afterSent = hasDailyEmailAlreadySent_(today);
    if (!beforeSent && afterSent) {
      saveFullWorkflowState_(updateFullWorkflowState_(state, 'done'));
      result.actions.push('장마감 메일 발송 확인 후 전체 워크플로우를 완료 처리');
    }
    return;
  }
  if (state.stage !== 'done') return;
  if (!hasDailyEmailInputsForWatchdog_(today)) return;
  result.actions.push('누락된 장마감 메일 늦게 발송');
  runWorkflowStepSafely_('누락 메일 발송 실패', sendDailyEmailReport, result);
}

function runWorkflowStepSafely_(failureLabel, fn, result) {
  try {
    return fn();
  } catch (err) {
    var message = failureLabel + ': ' + (err.message || String(err));
    result.actions.push(message);
    logWarn_('workflow_watchdog', failureLabel, { error: err.message || String(err), stack: err.stack });
    return null;
  }
}

function recoverPremarketForWatchdog_(result) {
  if (!isTimeBetweenForWatchdog_(715, 1000)) return;
  if (hasPremarketEmailAlreadySent_(amTodayString_())) return;
  try {
    result.actions.push('누락된 장전 브리핑 늦게 실행');
    runPremarketWorkflow();
  } catch (err) {
    result.actions.push('장전 브리핑 복구 실패: ' + (err.message || String(err)));
    logWarn_('workflow_watchdog', 'Premarket recovery failed', { error: err.message || String(err) });
  }
}

function hasDailyEmailInputsForWatchdog_(dateValue) {
  return countRowsByDate_(AM_CONFIG.SHEETS.AI_MARKET_BRIEFING, dateValue) > 0 &&
    countRowsByDate_(AM_CONFIG.SHEETS.AI_STOCK_ANALYSIS, dateValue) > 0;
}

function isAfterTimeForWatchdog_(hhmm) {
  return Number(Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'HHmm')) >= Number(hhmm);
}

function isTimeBetweenForWatchdog_(startHhmm, endHhmm) {
  var now = Number(Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'HHmm'));
  return now >= Number(startHhmm) && now <= Number(endHhmm);
}

function minutesSinceWorkflowTimestamp_(timestamp) {
  var millis = parseWorkflowTimestampMillis_(timestamp);
  if (!millis) return 9999;
  return Math.max(0, (new Date().getTime() - millis) / 60000);
}

function parseWorkflowTimestampMillis_(timestamp) {
  var text = String(timestamp || '').trim();
  var match = text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!match) return 0;
  return new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6])
  ).getTime();
}

function formatWorkflowWatchdogResult_(result) {
  var lines = [
    '장마감 누락 복구 점검 완료',
    '',
    '확인 시각: ' + result.checked_at,
    '강제 실행: ' + (result.force ? '예' : '아니오'),
    '',
    '[실행한 조치]'
  ];
  if (!result.actions || result.actions.length === 0) {
    lines.push('- 추가 조치 없음');
  } else {
    result.actions.forEach(function(action) {
      lines.push('- ' + action);
    });
  }
  lines.push('');
  lines.push('[상태]');
  lines.push('이전: ' + formatStateLineForAutomation_(result.state_before));
  lines.push('현재: ' + formatStateLineForAutomation_(result.state_after));
  lines.push('장마감 메일 로그: ' + result.daily_email_sent_before + '건 -> ' + result.daily_email_sent_after + '건');
  lines.push('');
  lines.push('아직 메일 로그가 0건이면 1~2분 뒤 다시 "장마감 누락 복구 실행"을 눌러 주세요.');
  return lines.join('\n');
}
