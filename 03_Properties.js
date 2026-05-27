function getScriptProperty_(key, defaultValue) {
  var value = PropertiesService.getScriptProperties().getProperty(key);
  return value === null || value === undefined || value === '' ? defaultValue : value;
}

function setScriptProperty_(key, value) {
  PropertiesService.getScriptProperties().setProperty(key, String(value));
}

function getRequiredScriptProperty_(key) {
  var value = getScriptProperty_(key, '');
  if (!value) {
    throw new Error('Missing required Script Property: ' + key);
  }
  return value;
}

function setKisCredentials(appKey, appSecret, baseUrl, env) {
  setScriptProperty_(AM_CONFIG.PROPERTY_KEYS.KIS_APP_KEY, appKey);
  setScriptProperty_(AM_CONFIG.PROPERTY_KEYS.KIS_APP_SECRET, appSecret);
  setScriptProperty_(AM_CONFIG.PROPERTY_KEYS.KIS_BASE_URL, baseUrl || AM_CONFIG.DEFAULT_KIS_BASE_URL);
  setScriptProperty_(AM_CONFIG.PROPERTY_KEYS.KIS_ENV, env || AM_CONFIG.DEFAULT_ENV);
  logInfo_('properties', 'KIS credentials saved without exposing secret values', { env: env || AM_CONFIG.DEFAULT_ENV });
}

function setKisAccountProperties(cano, accountProductCode) {
  setScriptProperty_(AM_CONFIG.PROPERTY_KEYS.KIS_CANO, String(cano || '').trim());
  setScriptProperty_(AM_CONFIG.PROPERTY_KEYS.KIS_ACNT_PRDT_CD, String(accountProductCode || '').trim());
  logInfo_('properties', 'KIS account properties saved without exposing account number', {
    has_cano: !!cano,
    account_product_code: accountProductCode || ''
  });
}

function getKisAccountConfig_() {
  return {
    cano: getRequiredScriptProperty_(AM_CONFIG.PROPERTY_KEYS.KIS_CANO),
    accountProductCode: getRequiredScriptProperty_(AM_CONFIG.PROPERTY_KEYS.KIS_ACNT_PRDT_CD)
  };
}

function setKrxApiKey(apiKey) {
  setScriptProperty_(AM_CONFIG.PROPERTY_KEYS.KRX_API_KEY, String(apiKey || '').trim());
  logInfo_('properties', 'KRX API key saved without exposing secret value', {
    has_key: !!apiKey
  });
}

function getKisEnv_() {
  return getScriptProperty_(AM_CONFIG.PROPERTY_KEYS.KIS_ENV, AM_CONFIG.DEFAULT_ENV);
}

function validateRealRuntimeConfig_() {
  var env = getKisEnv_();
  if (env !== 'real') {
    throw new Error('KIS_ENV must be real. This build does not generate substitute data.');
  }
  getRequiredScriptProperty_(AM_CONFIG.PROPERTY_KEYS.KIS_APP_KEY);
  getRequiredScriptProperty_(AM_CONFIG.PROPERTY_KEYS.KIS_APP_SECRET);
  if (!getScriptProperty_(AM_CONFIG.PROPERTY_KEYS.KIS_BASE_URL, '')) {
    setScriptProperty_(AM_CONFIG.PROPERTY_KEYS.KIS_BASE_URL, AM_CONFIG.DEFAULT_KIS_BASE_URL);
  }
}

function getStrategyNumber_(key, defaultValue) {
  var rows = readObjects_(AM_CONFIG.SHEETS.STRATEGY_SETTINGS);
  for (var i = 0; i < rows.length; i += 1) {
    if (String(rows[i].key) === key) {
      var parsed = Number(rows[i].value);
      return isNaN(parsed) ? defaultValue : parsed;
    }
  }
  return defaultValue;
}

function getSettingNumber_(key, defaultValue) {
  var rows = readObjects_(AM_CONFIG.SHEETS.SETTINGS);
  for (var i = 0; i < rows.length; i += 1) {
    if (String(rows[i].key) === key) {
      var parsed = Number(rows[i].value);
      return isNaN(parsed) ? defaultValue : parsed;
    }
  }
  return defaultValue;
}

function getSettingString_(key, defaultValue) {
  var rows = readObjects_(AM_CONFIG.SHEETS.SETTINGS);
  for (var i = 0; i < rows.length; i += 1) {
    if (String(rows[i].key) === key) {
      var value = String(rows[i].value || '').trim();
      return value || defaultValue;
    }
  }
  return defaultValue;
}

function getPromptTemplate_(key, defaultValue) {
  var rows = readObjects_(AM_CONFIG.SHEETS.PROMPTS);
  for (var i = 0; i < rows.length; i += 1) {
    if (String(rows[i].key) === key) {
      var value = String(rows[i].value || '').trim();
      return value || defaultValue;
    }
  }
  return defaultValue;
}
