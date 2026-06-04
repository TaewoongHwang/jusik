function formatSymbolColumns() {
  return withLogging_('format_tools', function() {
    ensureAllSheets_();
    applySheetFormats_();
    normalizeMarketUniverseSheet_();
    logInfo_('format_tools', 'Formatted symbol/code columns as plain text', {});
    safeUiAlert_('종목코드/코드 열 서식 고정 완료\n\n앞자리 0이 사라지지 않도록 관련 열을 일반 텍스트 형식으로 고정했습니다.');
  });
}
