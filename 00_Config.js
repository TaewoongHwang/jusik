var AM_CONFIG = {
  VERSION: '0.3.0-clean-core',
  DEFAULT_ENV: 'real',
  DEFAULT_KIS_BASE_URL: 'https://openapi.koreainvestment.com:9443',
  SHEETS: {
    SETTINGS: 'settings',
    MANUAL_HOLDINGS: 'manual_holdings',
    HOLDINGS_CURRENT: 'holdings_current',
    PAPER_PORTFOLIO: 'paper_portfolio',
    PAPER_PORTFOLIO_DOM: 'paper_portfolio_dom',
    PAPER_PORTFOLIO_US: 'paper_portfolio_us',
    PAPER_LEDGER: 'paper_ledger',
    REAL_LEDGER: 'real_ledger',
    LOGS: 'logs',
    QUANT_SETTINGS: 'quant_settings',
    QUANT_SIGNALS: 'quant_signals',
    QUANT_UNIVERSE_DB: 'quant_universe_db'
  },
  PROPERTY_KEYS: {
    KIS_ENV: 'KIS_ENV',
    KIS_BASE_URL: 'KIS_BASE_URL',
    KIS_APP_KEY: 'KIS_APP_KEY',
    KIS_APP_SECRET: 'KIS_APP_SECRET',
    KIS_ACCESS_TOKEN: 'KIS_ACCESS_TOKEN',
    KIS_ACCESS_TOKEN_EXPIRES_AT: 'KIS_ACCESS_TOKEN_EXPIRES_AT',
    GEMINI_API_KEY: 'GEMINI_API_KEY',
    GEMINI_MODEL: 'GEMINI_MODEL',
    KIS_CANO: 'KIS_CANO',
    KIS_ACNT_PRDT_CD: 'KIS_ACNT_PRDT_CD',
    KIS_ISA_CANO: 'KIS_ISA_CANO',
    KIS_ISA_ACNT_PRDT_CD: 'KIS_ISA_ACNT_PRDT_CD',
    KIS_ISA_APP_KEY: 'KIS_ISA_APP_KEY',
    KIS_ISA_APP_SECRET: 'KIS_ISA_APP_SECRET',
    TELEGRAM_BOT_TOKEN: 'TELEGRAM_BOT_TOKEN',
    TELEGRAM_CHAT_ID: 'TELEGRAM_CHAT_ID',
    PORTFOLIO_MODE: 'PORTFOLIO_MODE',
    ADMIN_TOKEN: 'ADMIN_TOKEN'
  }
};

var AM_SHEET_SCHEMAS = {};
AM_SHEET_SCHEMAS[AM_CONFIG.SHEETS.SETTINGS] = ['key', 'value', 'description', 'updated_at'];
AM_SHEET_SCHEMAS[AM_CONFIG.SHEETS.MANUAL_HOLDINGS] = ['broker', 'symbol', 'name', 'quantity', 'avg_price', 'active', 'memo'];
AM_SHEET_SCHEMAS[AM_CONFIG.SHEETS.HOLDINGS_CURRENT] = [
  'date', 'symbol', 'name', 'quantity', 'avg_price', 'current_price', 
  'purchase_amount', 'eval_amount', 'profit_loss_amount', 'profit_loss_pct', 
  'portfolio_weight_pct', 'source', 'currency'
];
AM_SHEET_SCHEMAS[AM_CONFIG.SHEETS.PAPER_PORTFOLIO] = [
  'date', 'cash_amount', 'stock_eval_amount', 'total_eval_amount', 
  'cumulative_return_pct', 'active_positions_json'
];
AM_SHEET_SCHEMAS[AM_CONFIG.SHEETS.PAPER_PORTFOLIO_DOM] = [
  'date', 'cash_amount', 'stock_eval_amount', 'total_eval_amount', 
  'cumulative_return_pct', 'active_positions_json'
];
AM_SHEET_SCHEMAS[AM_CONFIG.SHEETS.PAPER_PORTFOLIO_US] = [
  'date', 'cash_amount', 'stock_eval_amount', 'total_eval_amount', 
  'cumulative_return_pct', 'active_positions_json'
];
AM_SHEET_SCHEMAS[AM_CONFIG.SHEETS.PAPER_LEDGER] = [
  'date', 'symbol', 'name', 'action_type', 'price', 'quantity', 'amount', 'reason', 'created_at'
];
AM_SHEET_SCHEMAS[AM_CONFIG.SHEETS.REAL_LEDGER] = [
  'date', 'symbol', 'name', 'action_type', 'price', 'quantity', 'amount', 'realized_pl', 'broker', 'created_at'
];
AM_SHEET_SCHEMAS[AM_CONFIG.SHEETS.LOGS] = ['timestamp', 'level', 'module', 'message', 'details'];
AM_SHEET_SCHEMAS[AM_CONFIG.SHEETS.QUANT_SETTINGS] = ['key', 'value', 'description', 'updated_at'];
AM_SHEET_SCHEMAS[AM_CONFIG.SHEETS.QUANT_SIGNALS] = ['date', 'strategy', 'signal', 'details', 'created_at'];
AM_SHEET_SCHEMAS[AM_CONFIG.SHEETS.QUANT_UNIVERSE_DB] = ['date', 'symbol', 'name', 'price', 'per', 'pbr', 'gpa', 'momentum_pct', 'rsi', 'roe', 'debt', 'div_yield', 'beta', 'peg', 'srim_price', 'safety_margin', 'updated_at'];
