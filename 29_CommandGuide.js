function refreshCommandGuideSheet() {
  return withLogging_('command_guide', function() {
    ensureAllSheets_();
    seedCommandGuide_();
    safeUiAlert_([
      '상황별 명령 가이드 갱신 완료',
      '',
      '시트: command_guide',
      '사용법: 현재 상황 또는 품질 체크 메시지를 보고 run_command 열의 메뉴를 순서대로 실행하세요.'
    ].join('\n'));
  });
}

function seedCommandGuide_() {
  var sheetName = AM_CONFIG.SHEETS.COMMAND_GUIDE;
  var sheet = ensureSheet_(sheetName, AM_SHEET_SCHEMAS[sheetName]);
  clearDataRows_(sheetName);
  getCommandGuideRows_().forEach(function(row) {
    row.updated_at = amNowString_();
    appendObjectRow_(sheetName, row);
  });
  formatCommandGuideSheet_(sheet);
}

function getCommandGuideRows_() {
  return [
    guideRow_(10, '매일 확인', '오늘 시스템이 잘 돌고 있는지 궁금할 때', '자동화 설치 여부와 오늘 데이터 생성 여부', 'AI Scanner > 품질 체크', '품질 점수, 빈 시트, 다음 조치가 한글로 표시됩니다.', 'FAIL이면 critical 항목부터 처리하고, WARN이면 안내된 다음 조치를 실행합니다.', '가장 먼저 누르는 건강검진 버튼입니다.'),
    guideRow_(20, '매일 확인', '자동 메일이 실제 설치되어 있는지 확인할 때', '스크립트 시간대가 Asia/Seoul인지 확인', 'AI Scanner > 8. 자동화 > 자동화 상태 진단', '장마감 17:10, 장전 07:00 트리거 설치 여부가 표시됩니다.', '미설치가 보이면 장마감+장전 자동화 모두 설치를 실행합니다.', '시간 기반 트리거는 몇 분 정도 늦게 실행될 수 있습니다.'),
    guideRow_(25, '매일 확인', '오늘 국내 또는 미국 증시가 쉬는 날인지 확인하고 싶을 때', 'market_calendar 시트에 오늘 날짜가 수동 등록되어 있는지 확인', 'AI Scanner > 1. 처음 설정 > 시장 캘린더 진단', '국내/미국 개장 여부, 최근 거래일, 다음 거래일이 표시됩니다.', '공식 휴장일인데 개장으로 보이면 market_calendar에 날짜와 kr_open/us_open=N을 직접 추가합니다.', '주말은 자동 인식하고, 설/추석/미국 공휴일 같은 공식 휴장일은 필요할 때 시트에 보강합니다.'),
    guideRow_(30, '자동화 설치', '처음 자동화를 켜거나 트리거가 사라졌을 때', 'KIS, Gemini, DART, Macro 키가 저장되어 있는지 확인', 'AI Scanner > 8. 자동화 > 장마감+장전 자동화 모두 설치', '16:10 1차 수집, 17:10 전체 워크플로우, 07:00 장전 브리핑, 10분 복구 워치독이 설치됩니다.', '다시 자동화 상태 진단을 실행해 설치됨으로 바뀌었는지 확인합니다.', '복구 워치독은 멈춘 단계와 누락 메일을 늦게라도 복구합니다.'),
    guideRow_(40, '장마감 실행', '오늘 장마감 리포트를 수동으로 만들고 싶을 때', '장마감 이후인지 확인. 수급은 15:40 이후, 사후검증은 15:50 이후가 안정적입니다.', 'AI Scanner > 오늘 전체 실행', 'daily -> dart -> macro -> news -> gemini -> email 순서로 진행됩니다.', '시간 초과가 나면 전체 워크플로우 이어서 실행을 누릅니다.', '자동화가 설치되어 있으면 보통 직접 누르지 않아도 됩니다.'),
    guideRow_(50, '장마감 실행', '전체 워크플로우가 중간에서 멈춘 것 같을 때', 'AI Scanner > 진행 상태 확인으로 현재 stage 확인', 'AI Scanner > 8. 자동화 > 장마감 누락 복구 실행', '멈춘 stage를 이어서 실행하고, 리포트가 준비됐는데 메일만 빠졌으면 늦게 발송합니다.', '같은 stage가 계속 반복되면 logs 시트 마지막 error/warn 행을 확인합니다.', '평소에는 10분 복구 워치독이 자동으로 처리합니다.'),
    guideRow_(60, '장마감 실행', 'leader_50 데이터가 없다는 오류가 날 때', '핵심 파이프라인 상태가 done인지 확인', 'AI Scanner > 2. 매일 실행 > 핵심 파이프라인 이어서 실행', 'market_daily, indicators_daily, leader_candidates, leader_50, entry_plan이 채워집니다.', '상태가 finalize에서 멈추면 다시 이어서 실행합니다.', 'leader_50이 있어야 Gemini 리포트와 메일이 생성됩니다.'),
    guideRow_(70, '장마감 실행', 'Gemini 리포트는 있는데 메일이 안 왔을 때', 'ai_market_briefing과 ai_stock_analysis가 오늘 날짜로 있는지 확인', 'AI Scanner > 5. AI/메일 > 메일 리포트 발송', '오늘 리포트가 이메일로 발송되고 logs에 발송 기록이 남습니다.', 'AI 리포트가 없으면 Gemini 리포트 생성을 먼저 실행합니다.', '품질 체크의 장마감 메일 발송 로그가 1건이면 정상입니다.'),
    guideRow_(80, '장전 리포트', '아침 7시 장전 메일이 안 왔을 때', 'premarket_briefing과 premarket_email 로그 확인', 'AI Scanner > 3. 장전 리포트 > 장전 리포트 실행', '전날 주도주, 야간 뉴스, 거시지표 기반 장전 메일이 발송됩니다.', '전날 leader_50이 없으면 전날 장마감 워크플로우부터 확인합니다.', '장전 리포트는 새 가격 계산보다 대응 우선순위 정리에 집중합니다.'),
    guideRow_(90, '종목 universe', '코스닥 후보가 너무 적게 나올 때', 'market_universe의 KOSDAQ active=Y 개수 확인', 'AI Scanner > 1. 처음 설정 > KRX 전체 universe 확장', 'KRX 상장종목과 거래대금 상위 종목이 universe에 반영됩니다.', '이후 분석 종목 검증을 실행하고 시간 초과 시 이어서 실행합니다.', 'settings의 krx_active_kosdaq_count를 늘리면 더 많은 코스닥 종목을 활성화할 수 있습니다.'),
    guideRow_(100, '종목 universe', '분석 종목 검증이 시간 초과될 때', '분석 종목 검증 상태 확인에서 진행 수 확인', 'AI Scanner > 1. 처음 설정 > 분석 종목 검증 이어서 실행', '검증이 이어서 진행되고 market_universe_check가 누적됩니다.', '완료 후 무효 종목 비활성화를 실행합니다.', '348개 이상이면 여러 번 나눠 도는 것이 정상입니다.'),
    guideRow_(110, '종목 universe', '종목코드 앞의 0이 사라질 때', 'market_universe와 결과 시트 symbol 열 서식 확인', 'AI Scanner > 1. 처음 설정 > 종목코드 텍스트 서식 고정', 'symbol, etf_symbol, corp_code, stock_code 열이 텍스트 서식으로 고정됩니다.', '이미 깨진 값은 normalize 후 다시 수집하거나 universe를 갱신합니다.', '005930 같은 코드는 반드시 텍스트로 보관해야 합니다.'),
    guideRow_(115, '휴장일', '증시가 쉬는 날인데 장마감 파이프라인이 돌거나 메일이 이상할 때', '시장 캘린더 진단에서 kr_open/us_open 상태 확인', 'AI Scanner > 1. 처음 설정 > 시장 캘린더 갱신', 'market_calendar 시트가 생성되고 주말 휴장 기본값이 보강됩니다.', '공식 휴장일은 market_calendar에 yyyy-mm-dd, kr_open=N 또는 us_open=N으로 직접 추가합니다.', '국내 휴장일에는 가격 수집을 건너뛰고 휴장일 브리핑으로 바뀝니다. 미국 휴장일에는 신선한 미국 마감 신호가 없다고 표시합니다.'),
    guideRow_(120, '뉴스/거시', '뉴스 브리핑이 비어 있거나 시나리오가 빈약할 때', 'GEMINI_API_KEY와 Search Grounding 응답 로그 확인', 'AI Scanner > 4. 데이터 수집/계산 > 시장 뉴스 수집', 'news_briefing에 korea_close와 us_close가 생성됩니다.', 'Gemini 503/JSON 오류가 있으면 잠시 뒤 재실행합니다.', '국내 마감 뉴스는 장후 분석, 미국/글로벌 뉴스는 다음장 준비에 반영됩니다.'),
    guideRow_(125, '뉴스/거시', '뉴스는 있는데 영향 강도가 리포트에 약하게 느껴질 때', 'news_score_daily가 오늘 날짜로 있는지 확인', 'AI Scanner > 4. 데이터 수집/계산 > 뉴스 점수 계산', '뉴스별 risk_on/risk_off/sector_specific 강도가 점수화됩니다.', '비어 있으면 시장 뉴스 수집을 먼저 실행합니다.', '시나리오 판단에서 단순 뉴스 개수보다 뉴스 강도를 더 중요하게 봅니다.'),
    guideRow_(130, '뉴스/거시', '거시 점수나 금리/환율 정보가 비어 있을 때', 'FRED_API_KEY, ECOS_API_KEY 저장 여부 확인', 'AI Scanner > 4. 데이터 수집/계산 > 거시지표 수집', 'macro_raw와 macro_score가 갱신됩니다.', '실패하면 거시지표 연결 진단을 실행합니다.', '미국 10년물, 환율, 나스닥, VIX, 한국 기준금리 등이 리포트에 반영됩니다.'),
    guideRow_(135, '시장 폭', '지수는 올랐는데 체감상 장이 약한지 확인하고 싶을 때', 'market_daily와 indicators_daily가 오늘 날짜로 있는지 확인', 'AI Scanner > 4. 데이터 수집/계산 > 시장 폭 지표 계산', 'market_breadth_daily에 상승 비율, 20일선 위 비율, 거래량 증가 비율이 생성됩니다.', '비어 있으면 핵심 파이프라인을 먼저 완료합니다.', '시장 폭 지표는 주도주 후보가 넓게 확산되는지 판단하는 핵심 보조지표입니다.'),
    guideRow_(140, 'ETF', 'ETF 점수가 0이거나 etf_stock_score가 비어 있을 때', 'etf_holdings가 오늘 날짜로 있는지 확인', 'AI Scanner > 4. 데이터 수집/계산 > ETF 구성종목 수집', 'ETF 구성종목이 etf_holdings에 저장됩니다.', '이후 ETF 점수 계산을 실행합니다.', 'ETF API가 정상이어도 구성 ETF 목록이 적으면 점수 영향이 제한됩니다.'),
    guideRow_(150, 'ETF', 'ETF 구성종목은 있는데 점수가 비어 있을 때', 'etf_holdings 행 수 확인', 'AI Scanner > 4. 데이터 수집/계산 > ETF 점수 계산', 'etf_stock_score가 채워지고 leader_score에 반영됩니다.', '그래도 0이면 ETF 종목코드와 universe 종목코드 매칭을 확인합니다.', 'ETF 편입도는 주도주 점수의 보조 신호입니다.'),
    guideRow_(160, '수급', '투자자 수급 데이터가 비어 있을 때', '현재 시간이 15:40 이후인지 확인', 'AI Scanner > 4. 데이터 수집/계산 > 투자자 수급 수집', 'investor_flow_daily가 채워집니다.', 'KIS TIME LIMIT이면 15:40 이후 다시 실행합니다.', '수급 API는 장중 제한 시간이 있어 비어 있어도 오전에는 정상일 수 있습니다.'),
    guideRow_(170, '수급', '수급 원본은 있는데 수급 점수가 비어 있을 때', 'investor_flow_daily 행 수 확인', 'AI Scanner > 4. 데이터 수집/계산 > 투자자 수급 점수 계산', 'investor_flow_score가 생성됩니다.', '계속 비면 투자자 수급 연결 진단과 logs를 확인합니다.', '수급 점수는 가격/거래대금/ETF/재무를 보완하는 신호입니다.'),
    guideRow_(180, 'DART/재무', '재무 원본이나 재무비율이 비어 있을 때', 'dart_corp_master가 동기화되어 있는지 확인', 'AI Scanner > 4. 데이터 수집/계산 > DART 재무/공시 수집', 'financial_raw, financial_ratios, risk_alerts가 갱신됩니다.', '기업코드 매칭 실패가 있으면 DART 기업코드 동기화를 먼저 실행합니다.', 'DART는 상위 후보 중심으로 나눠 수집됩니다.'),
    guideRow_(190, 'AI/메일', 'Gemini 모델 오류나 503이 날 때', 'logs의 gemini warning/error 확인', 'AI Scanner > 5. AI/메일 > Gemini 모델 정책 확인', '용도별 모델 우선순위가 표시됩니다.', '수요 폭주 503이면 잠시 뒤 Gemini 리포트 생성을 다시 실행합니다.', '중요 판단은 상위 모델, 반복 요약은 저비용 모델을 우선 사용합니다.'),
    guideRow_(200, '보유종목', '내 보유종목 조언이 비어 있을 때', 'holdings_current가 오늘 날짜로 있는지 확인', 'AI Scanner > 6. 내 계좌/보유종목 > 보유종목 수집', 'KIS 계좌 또는 수동 보유종목이 holdings_current에 반영됩니다.', '타사 보유분은 manual_holdings에 넣고 수동 보유종목 가져오기를 실행합니다.', '실제 매수/매도 지시가 아니라 리스크 점검용입니다.'),
    guideRow_(210, '보유종목', '보유종목 수집 후 조언만 다시 만들고 싶을 때', 'holdings_current 행 수 확인', 'AI Scanner > 6. 내 계좌/보유종목 > 보유종목 어드바이스 생성', 'holdings_advice와 portfolio_risk가 갱신됩니다.', '보유종목이 없으면 manual_holdings 또는 KIS 계좌 설정을 확인합니다.', '메일 하단의 내 보유종목 어드바이스에 반영됩니다.'),
    guideRow_(220, '사후검증', '전날 리포트가 실제로 맞았는지 확인하고 싶을 때', '현재 시간이 15:50 이후인지 확인', 'AI Scanner > 4. 데이터 수집/계산 > 전일 리포트 사후검증', 'backtest_log에 전날 조건부 가격 도달 여부가 기록됩니다.', '오전이면 오늘 일봉이 확정되지 않아 실행하지 않습니다.', '추천 적중률이 아니라 시스템 품질 점검용입니다.'),
    guideRow_(230, '진단', '특정 API가 안 되는지 확인하고 싶을 때', '어느 데이터가 비었는지 품질 체크로 먼저 확인', 'AI Scanner > 7. 연결 진단 > 해당 API 연결 진단', 'KIS, ETF, KRX, DART, 거시지표, Gemini별 연결 상태가 표시됩니다.', '401/Unauthorized는 API 신청/승인 또는 키 저장 상태를 확인합니다.', '진단 결과 상세는 logs 시트에 남습니다.'),
    guideRow_(240, '최종 확인', '모든 조치를 끝낸 뒤 정상인지 보고 싶을 때', '오늘 전체 워크플로우가 done인지 확인', 'AI Scanner > 품질 체크', '품질 점수와 남은 확인 항목이 갱신됩니다.', '메일 발송 로그만 info로 남아 있으면 메일 발송 여부만 결정하면 됩니다.', 'WARN이어도 수급처럼 시간 조건 때문에 정상인 항목이 있을 수 있습니다.')
  ];
}

function guideRow_(priority, category, situation, checkFirst, runCommand, expectedResult, ifProblem, notes) {
  return {
    priority: priority,
    category: category,
    situation: situation,
    check_first: checkFirst,
    run_command: runCommand,
    expected_result: expectedResult,
    if_problem: ifProblem,
    notes: notes
  };
}

function formatCommandGuideSheet_(sheet) {
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, AM_SHEET_SCHEMAS[AM_CONFIG.SHEETS.COMMAND_GUIDE].length)
    .setFontWeight('bold')
    .setBackground('#f3f4f6');
  sheet.getDataRange().setWrap(true).setVerticalAlignment('top');
  sheet.setColumnWidth(1, 70);
  sheet.setColumnWidth(2, 110);
  sheet.setColumnWidth(3, 230);
  sheet.setColumnWidth(4, 230);
  sheet.setColumnWidth(5, 260);
  sheet.setColumnWidth(6, 250);
  sheet.setColumnWidth(7, 250);
  sheet.setColumnWidth(8, 260);
  sheet.setColumnWidth(9, 150);
  sheet.setTabColor('#2563eb');
}
