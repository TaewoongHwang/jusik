// ==================================================
// 🚀 [금융 관제 2.0] 실시간 금융 & 주식 뉴스 RSS 연동 파이프라인
// ==================================================

/**
 * 매일경제 증권/주식 RSS 피드로부터 최신 시황 뉴스 15개를 실시간으로 파싱하여 반환
 */
function fetchLiveFinancialNews_() {
  try {
    // 🚀 [글로벌 매크로 금융 관제 강화] 밤샘 뉴욕 증시, 엔비디아, 금리 및 실시간 국내 시황을 100% 무결하게 긁어오는 구글 뉴스 금융 RSS 전격 연동
    var url = 'https://news.google.com/rss/search?q=%EC%A3%BC%EC%8B%9D+OR+%EC%A6%9D%EC%8B%9C+OR+%EA%B8%88%EC%9C%B5&hl=ko&gl=KR&ceid=KR:ko';
    
    var response = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      muteHttpExceptions: true
    });
    
    if (response.getResponseCode() !== 200) {
      throw new Error('Google News RSS HTTP ' + response.getResponseCode());
    }
    
    var xml = response.getContentText('UTF-8');
    var items = [];
    
    var itemPattern = /<item>([\s\S]*?)<\/item>/g;
    var match;
    var count = 0;
    
    // 🚀 유저의 니즈에 부합하여 노출 기사를 기존 3개/15개 수준에서 최대 25개로 전격 대폭 확장
    while ((match = itemPattern.exec(xml)) !== null && count < 25) {
      var content = match[1];
      
      var titleMatch = content.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/) || content.match(/<title>([\s\S]*?)<\/title>/);
      var linkMatch = content.match(/<link>([\s\S]*?)<\/link>/) || content.match(/<link><!\[CDATA\[([\s\S]*?)\]\]><\/link>/);
      var dateMatch = content.match(/<pubDate><!\[CDATA\[([\s\S]*?)\]\]><\/pubDate>/) || content.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
      var descMatch = content.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/) || content.match(/<description>([\s\S]*?)<\/description>/);
      var sourceMatch = content.match(/<source[^>]*>([\s\S]*?)<\/source>/);
      
      var rawTitle = titleMatch ? titleMatch[1].trim() : "글로벌 금융 시장 뉴스";
      var link = linkMatch ? linkMatch[1].trim() : "https://news.google.com";
      var dateVal = dateMatch ? dateMatch[1].trim() : "";
      var desc = descMatch ? descMatch[1].trim() : "";
      var source = sourceMatch ? sourceMatch[1].trim() : "종합비즈니스";
      
      // 기사 제목에서 중복 언론사 꼬리표 " - 언론사" 깔끔하게 가공분리 정돈
      var cleanTitle = rawTitle;
      if (rawTitle.indexOf(' - ') >= 0) {
        var titleParts = rawTitle.split(' - ');
        cleanTitle = titleParts.slice(0, titleParts.length - 1).join(' - ');
        if (source === "종합비즈니스" && titleParts.length > 1) {
          source = titleParts[titleParts.length - 1].trim();
        }
      }
      
      // 날짜 표준 포맷 (GMT+09:00 고정)
      var displayDate = dateVal;
      try {
        var d = new Date(dateVal);
        if (d && !isNaN(d.getTime())) {
          displayDate = Utilities.formatDate(d, 'GMT+09:00', 'MM-dd HH:mm');
        }
      } catch(de) {}
      
      // 설명글 HTML 태그 제거 및 85자 절삭
      var cleanDesc = desc.replace(/<[^>]*>/g, '')
                          .replace(/&quot;/g, '"')
                          .replace(/&amp;/g, '&')
                          .replace(/&lt;/g, '<')
                          .replace(/&gt;/g, '>')
                          .replace(/\s+/g, ' ')
                          .trim();
      if (cleanDesc.length > 85) {
        cleanDesc = cleanDesc.substring(0, 85) + '...';
      }
      
      items.push({
        title: cleanTitle,
        link: link,
        pubDate: displayDate,
        description: cleanDesc || "기사 상세 보고는 원문 상세 링크에서 무결하게 조회하실 수 있습니다.",
        source: source,
        is_mock: false,
        fetched_at: amNowString_()
      });
      count++;
    }
    
    // 만약 파싱에 성공했으나 XML 규격 불일치로 파싱된 기사가 0개인 경우 비상 fallback 기동
    if (items.length === 0) {
      logWarn_('news_engine', 'Google News XML parsed 0 items. Using fallback.');
      return getFallbackNews_();
    }
    
    return items;
  } catch(e) {
    logWarn_('news_engine', 'Failed to fetch Google News RSS. Using fallback.', { error: e.message });
    return getFallbackNews_();
  }
}

/**
 * 📰 [비상용 고품격 글로벌 & 한국 증권 시황 뉴스 동적 Fallback 세트]
 * 유저 클릭 시 구글 뉴스 검색을 연계하여 살아 숨쉬는 상세 리포트 검색창으로 다이렉트 이송
 */
function getFallbackNews_() {
  var nowStr = amNowString_();
  var warnStr = '실시간 뉴스 RSS 수신 장애 또는 주말/휴일 등으로 인해 예시(Mock) 뉴스를 반환합니다.';
  return [
    { 
      title: "엔비디아(NVIDIA) 랠리 질주... AI 데이터센터 인프라 수혜주 연쇄 폭등", 
      link: "https://news.google.com/search?q=NVIDIA", 
      pubDate: "방금 전", 
      description: "인공지능 HBM 연산 폭증으로 엔비디아 칩셋 공급난이 연일 고조되는 가운데, 뉴욕 증시 전반의 기술적 매수 물량이 HBM 부품사로 가속 유입되고 있습니다...", 
      source: "글로벌마켓",
      is_mock: true,
      fetched_at: nowStr,
      warning: warnStr
    },
    { 
      title: "미 연준(FED) 금리 피벗 연내 단행 기대감 고조... 글로벌 증시 안도 기류", 
      link: "https://news.google.com/search?q=FED", 
      pubDate: "5분 전", 
      description: "미국 인플레이션 둔화 지표 하방 안정이 뚜렷해짐에 따라 글로벌 기준금리 인하 스탠스가 명확해지며 테크 성장주 위주의 강력한 상방 랠리가 개시됩니다...", 
      source: "글로벌매크로",
      is_mock: true,
      fetched_at: nowStr,
      warning: warnStr
    },
    { 
      title: "HBM3E 퀄테스트 통과 임박... 반도체 소부장 밸류체인 연일 신고가 경신", 
      link: "https://news.google.com/search?q=HBM", 
      pubDate: "10분 전", 
      description: "HBM 차세대 라인 양산 스케줄이 전격 합의되면서 패키징 장비 및 소재 핵심 납품사들의 2분기 영업이익 턴어라운드 성과가 연일 증명되고 있습니다...", 
      source: "산업특보",
      is_mock: true,
      fetched_at: nowStr,
      warning: warnStr
    },
    { 
      title: "글로벌 전력 인프라 쇼크... AI 데이터센터 변압기 수혜주 공급 계약 폭증", 
      link: "https://news.google.com/search?q=데이터센터+변압기", 
      pubDate: "15분 전", 
      description: "빅테크 기업들의 초대형 데이터센터 신축 열풍으로 인해 초고압 변압기 및 전기 구리 원자재 수요가 기하급수적으로 팽창하고 있습니다...", 
      source: "에너지인프라",
      is_mock: true,
      fetched_at: nowStr,
      warning: warnStr
    },
    { 
      title: "테슬라(Tesla) 완전자율주행 FSD 라이센스 승인... 글로벌 로보택시 훈풍", 
      link: "https://news.google.com/search?q=TESLA", 
      pubDate: "25분 전", 
      description: "로보택시 운행 가이드라인 통과에 힘입어 테슬라 자율주행 알고리즘 채택이 확산되고 있으며, 국내 자율주행 전장 센서 부품사들도 강세를 보입니다...", 
      source: "모빌리티",
      is_mock: true,
      fetched_at: nowStr,
      warning: warnStr
    },
    { 
      title: "원/달러 환율, 매크로 리스크 감소 속 1340원선 하향 안착 성공", 
      link: "https://news.google.com/search?q=환율", 
      pubDate: "35분 전", 
      description: "글로벌 위험 자산 선호 심리가 빠르게 복원됨에 따라 안전 자산인 달러 매도 물량이 출회되며 국내 원화 외환 시장의 변동성이 급속도로 안정되고 있습니다...", 
      source: "외환시장",
      is_mock: true,
      fetched_at: nowStr,
      warning: warnStr
    },
    { 
      title: "코스피, 외국인·기관 쌍끌이 대규모 수급 유입에 2750선 돌파 안착", 
      link: "https://news.google.com/search?q=KOSPI", 
      pubDate: "45분 전", 
      description: "시총 상위 IT 반도체 및 자동차 대장주 위주로 외국인 투자자들의 바스켓 순매수 물량이 집중 유입되며 견고한 상승 지지 파이프라인을 구축 중입니다...", 
      source: "마켓시황",
      is_mock: true,
      fetched_at: nowStr,
      warning: warnStr
    },
    { 
      title: "국제유가, 중동 리스크 소폭 진정 속 WTI 배럴당 78달러선으로 하향 조율", 
      link: "https://news.google.com/search?q=국제유가", 
      pubDate: "50분 전", 
      description: "중동 지정학적 긴장 강도가 차분히 연화되면서 공급 불안정 우려가 해소되었고, 글로벌 원유 재고도 여유 구간에 들어서며 하방 지지를 받고 있습니다...", 
      source: "원자재동향",
      is_mock: true,
      fetched_at: nowStr,
      warning: warnStr
    },
    { 
      title: "구글·애플 온디바이스 AI 탑재 스마트폰 가시화... OLED 부품사 낙수효과", 
      link: "https://news.google.com/search?q=온디바이스AI", 
      pubDate: "1시간 전", 
      description: "하반기 출시될 스마트폰 플래그십 전 라인업에 고성능 NPU 온디바이스 AI 및 고휘도 OLED 탑재가 확정되면서 국내 공급 부품사들의 실적 랠리가 예고됩니다...", 
      source: "IT기기특보",
      is_mock: true,
      fetched_at: nowStr,
      warning: warnStr
    },
    { 
      title: "코스닥, 테크 섹터 주도로 900선 정밀 안착 랠리 본궤도 진입", 
      link: "https://news.google.com/search?q=KOSDAQ", 
      pubDate: "1시간 전", 
      description: "반도체 패키징 및 고부가 IT 하드웨어 중소 부품사들의 기관 투신 매수 우위 속에 코스닥 지수가 900선 안착을 위한 힘찬 계단식 랠리를 시작했습니다...", 
      source: "코스닥전망",
      is_mock: true,
      fetched_at: nowStr,
      warning: warnStr
    }
  ];
}

/**
 * 💡 [신설] 서울 표준시(GMT+09:00) 기준 뉴스 캐시 만료시간(TTL) 판별 헬퍼
 * 장전 집중(08:00~09:30) 및 장후 집중(15:30~17:30) 거래 황금시간대는 5분(300초), 그 외는 30분(1800초) 반환
 */
function getNewsCacheTtl_() {
  try {
    var now = new Date();
    // 서울 표준시(GMT+09:00) 기준으로 시간 포맷 변환
    var timeStr = Utilities.formatDate(now, 'GMT+09:00', 'HH:mm');
    var parts = timeStr.split(':');
    var hour = parseInt(parts[0], 10);
    var min = parseInt(parts[1], 10);
    
    // 1. 장전 집중 대응 시간대 (오전 08:00 ~ 오전 09:30) -> 5분 (300초)
    if (hour === 8 || (hour === 9 && min < 30)) {
      return 300;
    }
    
    // 2. 장후 공시 및 시간외 대응 시간대 (오후 15:30 ~ 오후 17:29) -> 5분 (300초)
    if ((hour === 15 && min >= 30) || hour === 16 || (hour === 17 && min < 30)) {
      return 300;
    }
  } catch(e) {
    console.error('Failed to parse Seoul Time inside getNewsCacheTtl_: ' + e.message);
  }
  
  // 3. 그 외 일반 시간대 -> 30분 (1800초)
  return 1800;
}
