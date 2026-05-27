function addKosdaqRepresentativeUniverse() {
  return withLogging_('kosdaq_universe', function() {
    ensureAllSheets_();
    applySheetFormats_();
    var rows = getKosdaqRepresentativeUniverseRows_();
    var result = upsertMarketUniverseRows_(rows);
    logInfo_('kosdaq_universe', 'KOSDAQ representative universe added', result);
    safeUiAlert_([
      '코스닥 대표 종목 추가 완료',
      '',
      '추가: ' + result.added + '개',
      '기존 유지/보강: ' + result.updated + '개',
      '전체 코스닥 후보 목록: ' + rows.length + '개',
      '',
      '다음 순서:',
      '1. AI Scanner > 1. 처음 설정 > 분석 종목 검증',
      '2. 필요하면 무효 종목 비활성화',
      '3. AI Scanner > 2. 매일 실행 > 전체 워크플로우 실행',
      '',
      '주의: universe가 늘어나면 전체 워크플로우가 더 오래 걸리며 이어서 실행 트리거가 여러 번 돌 수 있습니다.'
    ].join('\n'));
    return result;
  });
}

function upsertMarketUniverseRows_(rows) {
  var sheetName = AM_CONFIG.SHEETS.MARKET_UNIVERSE;
  var headers = AM_SHEET_SCHEMAS[sheetName];
  var sheet = ensureSheet_(sheetName, headers);
  var values = sheet.getDataRange().getValues();
  var symbolIndex = headers.indexOf('symbol');
  var nameIndex = headers.indexOf('name');
  var marketIndex = headers.indexOf('market');
  var sectorIndex = headers.indexOf('sector');
  var activeIndex = headers.indexOf('active');
  var rowBySymbol = {};
  for (var i = 1; i < values.length; i += 1) {
    var symbol = normalizeStockSymbol_(values[i][symbolIndex]);
    if (symbol) rowBySymbol[symbol] = i + 1;
  }
  var added = 0;
  var updated = 0;
  rows.forEach(function(row) {
    var symbol = normalizeStockSymbol_(row.symbol);
    var existingRow = rowBySymbol[symbol];
    if (existingRow) {
      var currentName = sheet.getRange(existingRow, nameIndex + 1).getValue();
      var currentMarket = sheet.getRange(existingRow, marketIndex + 1).getValue();
      var currentSector = sheet.getRange(existingRow, sectorIndex + 1).getValue();
      if (!currentName) sheet.getRange(existingRow, nameIndex + 1).setValue(row.name);
      if (!currentMarket) sheet.getRange(existingRow, marketIndex + 1).setValue(row.market);
      if (!currentSector) sheet.getRange(existingRow, sectorIndex + 1).setValue(row.sector);
      if (!sheet.getRange(existingRow, activeIndex + 1).getValue()) {
        sheet.getRange(existingRow, activeIndex + 1).setValue('Y');
      }
      updated += 1;
      return;
    }
    appendObjectRow_(sheetName, {
      symbol: symbol,
      name: row.name,
      market: row.market,
      sector: row.sector,
      active: 'Y'
    });
    added += 1;
  });
  normalizeMarketUniverseSheet_();
  return {
    added: added,
    updated: updated,
    total_input: rows.length
  };
}

function getKosdaqRepresentativeUniverseRows_() {
  return [
    kosdaqRow_('247540', '에코프로비엠', '배터리소재'),
    kosdaqRow_('086520', '에코프로', '배터리소재'),
    kosdaqRow_('196170', '알테오젠', '바이오'),
    kosdaqRow_('028300', 'HLB', '바이오'),
    kosdaqRow_('068760', '셀트리온제약', '바이오'),
    kosdaqRow_('214150', '클래시스', '미용의료'),
    kosdaqRow_('403870', 'HPSP', '반도체장비'),
    kosdaqRow_('058470', '리노공업', '반도체소부장'),
    kosdaqRow_('039030', '이오테크닉스', '반도체장비'),
    kosdaqRow_('035900', 'JYP Ent.', '엔터'),
    kosdaqRow_('041510', '에스엠', '엔터'),
    kosdaqRow_('122870', '와이지엔터테인먼트', '엔터'),
    kosdaqRow_('253450', '스튜디오드래곤', '콘텐츠'),
    kosdaqRow_('376300', '디어유', '엔터/플랫폼'),
    kosdaqRow_('293490', '카카오게임즈', '게임'),
    kosdaqRow_('112040', '위메이드', '게임'),
    kosdaqRow_('263750', '펄어비스', '게임'),
    kosdaqRow_('225570', '넥슨게임즈', '게임'),
    kosdaqRow_('078340', '컴투스', '게임'),
    kosdaqRow_('194480', '데브시스터즈', '게임'),
    kosdaqRow_('067310', '하나마이크론', '반도체소부장'),
    kosdaqRow_('240810', '원익IPS', '반도체장비'),
    kosdaqRow_('036930', '주성엔지니어링', '반도체장비'),
    kosdaqRow_('095340', 'ISC', '반도체소부장'),
    kosdaqRow_('089030', '테크윙', '반도체장비'),
    kosdaqRow_('357780', '솔브레인', '반도체소재'),
    kosdaqRow_('222800', '심텍', '반도체기판'),
    kosdaqRow_('101490', '에스앤에스텍', '반도체소부장'),
    kosdaqRow_('084370', '유진테크', '반도체장비'),
    kosdaqRow_('064760', '티씨케이', '반도체소부장'),
    kosdaqRow_('166090', '하나머티리얼즈', '반도체소부장'),
    kosdaqRow_('183300', '코미코', '반도체소부장'),
    kosdaqRow_('079370', '제우스', '반도체장비'),
    kosdaqRow_('140860', '파크시스템스', '반도체장비'),
    kosdaqRow_('092870', '엑시콘', '반도체장비'),
    kosdaqRow_('083450', 'GST', '반도체장비'),
    kosdaqRow_('036540', 'SFA반도체', '반도체후공정'),
    kosdaqRow_('036810', '에프에스티', '반도체소부장'),
    kosdaqRow_('064290', '인텍플러스', '반도체장비'),
    kosdaqRow_('095610', '테스', '반도체장비'),
    kosdaqRow_('319660', '피에스케이', '반도체장비'),
    kosdaqRow_('031980', '피에스케이홀딩스', '반도체장비'),
    kosdaqRow_('104830', '원익머트리얼즈', '반도체소재'),
    kosdaqRow_('053610', '프로텍', '반도체장비'),
    kosdaqRow_('036200', '유니셈', '반도체장비'),
    kosdaqRow_('089970', '에이피티씨', '반도체장비'),
    kosdaqRow_('348370', '엔켐', '배터리소재'),
    kosdaqRow_('121600', '나노신소재', '배터리소재'),
    kosdaqRow_('078600', '대주전자재료', '배터리소재'),
    kosdaqRow_('137400', '피엔티', '배터리장비'),
    kosdaqRow_('365340', '성일하이텍', '배터리리사이클'),
    kosdaqRow_('328130', '루닛', 'AI/의료'),
    kosdaqRow_('277810', '레인보우로보틱스', '로봇'),
    kosdaqRow_('058610', '에스피지', '로봇/부품'),
    kosdaqRow_('098460', '고영', '의료/검사장비'),
    kosdaqRow_('145020', '휴젤', '바이오'),
    kosdaqRow_('237690', '에스티팜', '바이오'),
    kosdaqRow_('085660', '차바이오텍', '바이오'),
    kosdaqRow_('214450', '파마리서치', '미용의료'),
    kosdaqRow_('086900', '메디톡스', '바이오'),
    kosdaqRow_('039200', '오스코텍', '바이오'),
    kosdaqRow_('141080', '리가켐바이오', '바이오'),
    kosdaqRow_('064550', '바이오니아', '바이오'),
    kosdaqRow_('053030', '바이넥스', '바이오'),
    kosdaqRow_('178320', '서진시스템', '통신장비/ESS'),
    kosdaqRow_('189300', '인텔리안테크', '통신장비'),
    kosdaqRow_('032500', '케이엠더블유', '통신장비'),
    kosdaqRow_('046890', '서울반도체', 'LED'),
    kosdaqRow_('091700', '파트론', '전자부품'),
    kosdaqRow_('084850', '아이티엠반도체', '전자부품'),
    kosdaqRow_('272290', '이녹스첨단소재', 'IT소재'),
    kosdaqRow_('131970', '두산테스나', '반도체테스트'),
    kosdaqRow_('215200', '메가스터디교육', '교육'),
    kosdaqRow_('215000', '골프존', '레저'),
    kosdaqRow_('053800', '안랩', '보안'),
    kosdaqRow_('042000', '카페24', '이커머스'),
    kosdaqRow_('060250', 'NHN KCP', '결제'),
    kosdaqRow_('041190', '우리기술투자', '가상자산'),
    kosdaqRow_('025980', '아난티', '레저'),
    kosdaqRow_('241710', '코스메카코리아', '화장품'),
    kosdaqRow_('033500', '동성화인텍', '조선기자재'),
    kosdaqRow_('095500', '미래나노텍', '소재'),
    kosdaqRow_('052400', '코나아이', '핀테크'),
    kosdaqRow_('064260', '다날', '핀테크'),
    kosdaqRow_('043610', '지니뮤직', '콘텐츠'),
    kosdaqRow_('091120', '이엠텍', '전자부품'),
    kosdaqRow_('192440', '슈피겐코리아', '소비재')
  ];
}

function kosdaqRow_(symbol, name, sector) {
  return {
    symbol: symbol,
    name: name,
    market: 'KOSDAQ',
    sector: sector
  };
}
