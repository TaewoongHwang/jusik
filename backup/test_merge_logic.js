// 수동 자산 가중평균 병합 시뮬레이터 테스트
function normalizeBrokerName_(broker) {
  var b = String(broker || '').trim().toLowerCase();
  if (b.indexOf('신한') >= 0 || b.indexOf('shinhan') >= 0) return '신한';
  if (b.indexOf('미니') >= 0 || b.indexOf('mini') >= 0) return '미니스탁';
  if (b.indexOf('업비트') >= 0 || b.indexOf('upbit') >= 0) return 'upbit';
  if (b.indexOf('토스') >= 0 || b.indexOf('toss') >= 0) return '토스';
  return broker;
}

function normalizeStockSymbol_(symbol) {
  return String(symbol || '').trim().toUpperCase();
}

function cleanDuplicateManualHoldingsTest(rows) {
  var merged = {};
  var needsRewrite = false;
  
  rows.forEach(function(row) {
    var symbol = normalizeStockSymbol_(row.symbol);
    if (!symbol) return;
    
    var broker = normalizeBrokerName_(row.broker);
    var key = broker + '_' + symbol;
    
    var activeVal = String(row.active || 'Y').toUpperCase().trim();
    var isActive = (activeVal !== 'N' && activeVal !== 'FALSE');
    var qty = parseFloat(row.quantity || 0);
    
    if (!merged[key]) {
      merged[key] = {
        broker: broker,
        symbol: symbol,
        name: row.name,
        quantity: qty,
        avg_price: parseFloat(row.avg_price || 0),
        active: isActive,
        memo: row.memo || ''
      };
    } else {
      needsRewrite = true;
      if (isActive && qty > 0) {
        var prev = merged[key];
        if (prev.quantity > 0) {
          var totalCost = (prev.quantity * prev.avg_price) + (qty * parseFloat(row.avg_price || 0));
          var totalQty = prev.quantity + qty;
          prev.quantity = totalQty;
          prev.avg_price = totalQty > 0 ? Math.round(totalCost / totalQty) : 0;
          prev.memo = '자동 병합';
        } else {
          prev.quantity = qty;
          prev.avg_price = parseFloat(row.avg_price || 0);
          prev.active = true;
          prev.memo = row.memo || '';
        }
      }
    }
  });
  
  return {
    needsRewrite: needsRewrite,
    merged: Object.keys(merged).map(key => merged[key])
  };
}

// 테스트 케이스 구동
const mockManualHoldings = [
  { broker: 'shinhan', symbol: '0167A0', name: 'SOL AI반도체TOP2플러스', quantity: 5, avg_price: 22510, active: 'Y' },
  { broker: '신한', symbol: '0167A0', name: 'SOL AI반도체TOP2플러스', quantity: 5, avg_price: 22510, active: 'Y' },
  { broker: 'shinhan', symbol: '102110', name: 'TIGER 200', quantity: 2, avg_price: 130560, active: 'Y' },
  { broker: '신한', symbol: '102110', name: 'TIGER 200', quantity: 2, avg_price: 130560, active: 'Y' },
  { broker: '신한', symbol: '005930', name: '삼성전자', quantity: 1, avg_price: 307000, active: 'Y' }
];

console.log("=== 중복 병합 및 가중평균 평단가 로직 유닛 테스트 ===");
console.log("입력 데이터 수:", mockManualHoldings.length);
const result = cleanDuplicateManualHoldingsTest(mockManualHoldings);
console.log("재기록 필요 여부 (중복 존재):", result.needsRewrite);
console.log("병합 완료된 최종 데이터 리스트:");
result.merged.forEach(item => {
  console.log(`- [${item.broker}] ${item.symbol} (${item.name}): 수량=${item.quantity}주, 평단가=${item.avg_price}원, 상태=${item.active}, 메모=${item.memo}`);
});

// 단가 검증
const expected_0167A0 = result.merged.find(i => i.symbol === '0167A0');
if (expected_0167A0 && expected_0167A0.quantity === 10 && expected_0167A0.avg_price === 22510) {
  console.log("\n✅ SOL AI반도체(0167A0) 병합 성공! (수량 10주, 평단 W22,510 일치)");
} else {
  console.log("\n❌ SOL AI반도체(0167A0) 병합 실패!");
}

const expected_102110 = result.merged.find(i => i.symbol === '102110');
if (expected_102110 && expected_102110.quantity === 4 && expected_102110.avg_price === 130560) {
  console.log("✅ TIGER 200(102110) 병합 성공! (수량 4주, 평단 W130,560 일치)");
} else {
  console.log("❌ TIGER 200(102110) 병합 실패!");
}
