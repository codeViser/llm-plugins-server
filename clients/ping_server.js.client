// TypingMind Extension: Plugin Server Ping & Status
// Version 1.1.6 (Dynamic UI injection with MutationObserver)

(() => {
  const EXTENSION_ID = 'pluginServerPinger';
  const STORAGE_KEY_SERVER_URL = `typingMind.extension.${EXTENSION_ID}.serverUrl`;
  const STORAGE_KEY_PING_INTERVAL = `typingMind.extension.${EXTENSION_ID}.pingIntervalMinutes`;

  // --- Configuration (loaded from localStorage) ---
  let serverUrl = localStorage.getItem(STORAGE_KEY_SERVER_URL);
  let pingIntervalMinutes = parseInt(localStorage.getItem(STORAGE_KEY_PING_INTERVAL) || '10', 10);
  let PING_INTERVAL_MS = pingIntervalMinutes * 60 * 1000;

  // --- State ---
  let serverStatus = {
    isReachable: serverUrl ? null : 'unconfigured', // null: unknown, true: online, false: offline, 'unconfigured', 'pending'
    lastChecked: null,
    responseTime: null,
    error: null,
  };
  let pingIntervalId = null;
  let statusButtonContainer = null; 
  let configPanel = null;
  let isConfigPanelOpen = false;
  let currentInjectedToolbar = null; // Keep track of where the button is currently injected

  // --- DOM Elements & Styling ---
  const CONTAINER_ID = `${EXTENSION_ID}-container`;
  const STATUS_BUTTON_ID = `${EXTENSION_ID}-status-btn`;
  const SETTINGS_BUTTON_ID = `${EXTENSION_ID}-settings-btn`;
  const CONFIG_PANEL_ID = `${EXTENSION_ID}-config-panel`;

  // Theme Colors (Dark Grey)
  const theme = {
    buttonBg: '#4A5568', // Equivalent to Tailwind's gray-700
    buttonText: '#E2E8F0', // Equivalent to Tailwind's gray-300
    buttonBorder: '#2D3748', // Equivalent to Tailwind's gray-800
    buttonHoverBg: '#2D3748',
    configBg: '#2D3748', // Darker bg for config panel
    configText: '#E2E8F0',
    configInputBorder: '#4A5568',
    indicatorOnline: '#48BB78',
    indicatorOffline: '#F56565', 
    indicatorPending: '#ECC94B',
    indicatorUnconfigured: '#718096',
    indicatorUnknown: '#A0AEC0'
  };

  function addStyles() {
    const styleId = `${EXTENSION_ID}-styles`;
    if (document.getElementById(styleId)) return;

    const css = `
      #${CONTAINER_ID} {
        display: flex;
        align-items: center;
        /* margin-left will be dynamic based on parent */
        position: relative; 
      }
      #${STATUS_BUTTON_ID}, #${SETTINGS_BUTTON_ID} {
        padding: 2px 5px; /* Further reduced padding */
        font-size: 10px;  /* Further reduced font size */
        border-radius: 3px; 
        cursor: pointer;
        background-color: ${theme.buttonBg};
        color: ${theme.buttonText};
        border: 1px solid ${theme.buttonBorder};
        display: flex;
        align-items: center;
        gap: 3px; 
        transition: background-color 0.2s, border-color 0.2s;
      }
      #${STATUS_BUTTON_ID} {
        border-top-right-radius: 0;
        border-bottom-right-radius: 0;
        border-right-color: ${theme.buttonBorder};
      }
      #${SETTINGS_BUTTON_ID} {
        border-top-left-radius: 0;
        border-bottom-left-radius: 0;
        padding: 2px; /* Further reduced padding for icon button */
        border-left: none;
      }
      #${SETTINGS_BUTTON_ID} svg {
        width: 10px; /* Further reduced icon size */
        height: 10px; /* Further reduced icon size */
        fill: ${theme.buttonText};
      }
      #${STATUS_BUTTON_ID}:hover, #${SETTINGS_BUTTON_ID}:hover {
        background-color: ${theme.buttonHoverBg};
        border-color: #4A5568;
      }
      #${STATUS_BUTTON_ID} .status-indicator {
        width: 7px; /* Smaller indicator */
        height: 7px; /* Smaller indicator */
        border-radius: 50%;
        background-color: ${theme.indicatorUnknown}; /* Default, overridden by JS */
        transition: background-color 0.3s, opacity 0.3s;
        flex-shrink: 0; /* Prevent shrinking */
      }
      #${STATUS_BUTTON_ID}.online .status-indicator { background-color: ${theme.indicatorOnline}; /* Tailwind green-500 */ }
      #${STATUS_BUTTON_ID}.offline .status-indicator { background-color: ${theme.indicatorOffline}; /* Tailwind red-500 */ }
      #${STATUS_BUTTON_ID}.pending .status-indicator { background-color: ${theme.indicatorPending}; /* Tailwind yellow-500 */ animation: pulse 1.2s infinite alternate; }
      #${STATUS_BUTTON_ID}.unconfigured .status-indicator { background-color: ${theme.indicatorUnconfigured}; /* Tailwind gray-600 */ }

      #${CONFIG_PANEL_ID} {
        position: absolute;
        bottom: calc(100% + 4px); 
        right: 0;
        background-color: ${theme.configBg};
        color: ${theme.configText};
        border: 1px solid ${theme.buttonBorder};
        border-radius: 5px;
        padding: 12px;
        box-shadow: 0 3px 10px rgba(0,0,0,0.2);
        z-index: 1000;
        width: 260px; /* Slightly narrower */
        display: none; 
      }
      body > #${CONTAINER_ID} #${CONFIG_PANEL_ID} {
          bottom: calc(100% + 4px); 
          right: 0;
          left: auto;
          top: auto;
      }
      #${CONFIG_PANEL_ID} label { display: block; margin-bottom: 4px; font-size: 10px; color: ${theme.configText}; }
      #${CONFIG_PANEL_ID} input[type="text"], #${CONFIG_PANEL_ID} input[type="number"] {
        width: calc(100% - 10px);
        padding: 4px;
        margin-bottom: 6px;
        border: 1px solid ${theme.configInputBorder};
        border-radius: 2px;
        font-size: 11px;
        background-color: ${theme.buttonBg};
        color: ${theme.configText};
      }
      #${CONFIG_PANEL_ID} input::placeholder { color: #A0AEC0; }
      #${CONFIG_PANEL_ID} button {
        padding: 5px 8px;
        border: 1px solid ${theme.buttonBorder};
        border-radius: 2px;
        cursor: pointer;
        font-size: 11px;
        margin-right: 4px;
        color: ${theme.buttonText};
      }
      #${CONFIG_PANEL_ID} .save-btn { background-color: #38A169; /* Tailwind green-600 */ }
      #${CONFIG_PANEL_ID} .save-btn:hover { background-color: #2F855A; /* Tailwind green-700 */ }
      #${CONFIG_PANEL_ID} .close-btn { background-color: ${theme.buttonBg}; }
      #${CONFIG_PANEL_ID} .close-btn:hover { background-color: ${theme.buttonHoverBg}; }
      #${CONFIG_PANEL_ID} .config-note { font-size: 9px; color: #A0AEC0; margin-top:6px;}

      @keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.3; } 100% { opacity: 1; } }
    `;
    const styleElement = document.createElement('style');
    styleElement.id = styleId;
    styleElement.textContent = css;
    document.head.appendChild(styleElement);
  }

  function ensureUIElementsExist() {
    if (!statusButtonContainer) {
        statusButtonContainer = document.createElement('div'); statusButtonContainer.id = CONTAINER_ID;
        const statusBtn = document.createElement('button'); statusBtn.id = STATUS_BUTTON_ID;
        const indicator = document.createElement('span'); indicator.className = 'status-indicator'; statusBtn.appendChild(indicator);
        const text = document.createElement('span'); text.className = 'status-text'; statusBtn.appendChild(text);
        statusBtn.addEventListener('click', () => { if (serverStatus.isReachable === 'unconfigured') { toggleConfigPanel(); return; } pingServer(true); });
        const settingsBtn = document.createElement('button'); settingsBtn.id = SETTINGS_BUTTON_ID; settingsBtn.title = 'Configure Server Ping';
        settingsBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M19.43 12.98c.04-.32.07-.64.07-.98s-.03-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.3-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65C14.46 2.18 14.25 2 14 2h-4c-.25 0-.46.18-.49.42l-.38 2.65c-.61.25-1.17-.59-1.69-.98l-2.49-1c-.23-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64l2.11 1.65c-.04.32-.07.65-.07.98s.03.66.07.98l-2.11 1.65c-.19-.15-.24-.42-.12-.64l2 3.46c.12.22.39.3.61-.22l2.49-1c.52.4 1.08.73 1.69-.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.65c.61-.25 1.17-.59 1.69-.98l2.49 1c.23.09.49 0 .61.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.65zM12 15.5c-1.93 0-3.5-1.57-3.5-3.5s1.57-3.5 3.5-3.5 3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5z"/></svg>`;
        settingsBtn.addEventListener('click', toggleConfigPanel);
        statusButtonContainer.appendChild(statusBtn); statusButtonContainer.appendChild(settingsBtn);
    }
    if (!configPanel) {
        configPanel = document.createElement('div'); configPanel.id = CONFIG_PANEL_ID;
        configPanel.innerHTML = 
          `<label for="${EXTENSION_ID}-server-url">Server Health Endpoint URL:</label>
          <input type="text" id="${EXTENSION_ID}-server-url" placeholder="e.g., https://host.com/health">
          <label for="${EXTENSION_ID}-ping-interval">Ping Interval (minutes):</label>
          <input type="number" id="${EXTENSION_ID}-ping-interval" min="1">
          <button class="save-btn">Save</button><button class="close-btn">Close</button>
          <p class="config-note">URL for GET request. e.g. https://plugins.onrender.com/health-check</p>`;
        configPanel.querySelector('.save-btn').addEventListener('click', saveConfig);
        configPanel.querySelector('.close-btn').addEventListener('click', toggleConfigPanel);
        document.body.appendChild(configPanel); // Append to body initially, will be hidden
    }
  }

  function toggleConfigPanel() {
    ensureUIElementsExist(); 
    isConfigPanelOpen = !isConfigPanelOpen;
    configPanel.style.display = isConfigPanelOpen ? 'block' : 'none';
    if (isConfigPanelOpen) {
      document.getElementById(`${EXTENSION_ID}-server-url`).value = serverUrl || '';
      document.getElementById(`${EXTENSION_ID}-ping-interval`).value = pingIntervalMinutes;
      // Position config panel relative to the statusButtonContainer
      if (statusButtonContainer && statusButtonContainer.offsetParent) {
          const containerRect = statusButtonContainer.getBoundingClientRect();
          if (statusButtonContainer.style.position === 'fixed') {
            Object.assign(configPanel.style, {
                position: 'fixed',
                bottom: `calc(${window.innerHeight - containerRect.top}px + 5px)`,
                right: `calc(${window.innerWidth - containerRect.right + (containerRect.width / 2) - (configPanel.offsetWidth / 2)}px)`,
                left: 'auto', top: 'auto', zIndex: '1002'
            });
          } else {
            // If container is not fixed, check if configPanel should be its child
            if (!statusButtonContainer.contains(configPanel) && configPanel.parentElement !== statusButtonContainer) {
                statusButtonContainer.appendChild(configPanel); // Make it a child for relative positioning
            }
            Object.assign(configPanel.style, {position: 'absolute', bottom: 'calc(100% + 4px)', right: '0px', left:'auto', top:'auto', zIndex: '1000'});
          }
      } else {
          Object.assign(configPanel.style, {position: 'fixed', bottom: '50px', right: '20px', zIndex: '1002'}); // Fallback if container has no offsetParent
      }
    }
  }

  function saveConfig() {
    const newUrl = document.getElementById(`${EXTENSION_ID}-server-url`).value.trim();
    const newInterval = parseInt(document.getElementById(`${EXTENSION_ID}-ping-interval`).value, 10);
    if (!newUrl) {
      alert("Server URL cannot be empty."); return;
    }
    try {
      new URL(newUrl);
    } catch (_) {
      alert("Invalid Server URL. Include http(s)://"); return;
    }
    if (isNaN(newInterval) || newInterval < 1) {
      alert("Interval must be >= 1 minute."); return;
    }
    serverUrl = newUrl;
    pingIntervalMinutes = newInterval;
    PING_INTERVAL_MS = newInterval * 60 * 1000;
    localStorage.setItem(STORAGE_KEY_SERVER_URL, serverUrl);
    localStorage.setItem(STORAGE_KEY_PING_INTERVAL, pingIntervalMinutes.toString());
    console.log(`[${EXTENSION_ID}] Config saved. URL: ${serverUrl}, Interval: ${pingIntervalMinutes}m`);
    toggleConfigPanel();
    serverStatus.isReachable = null; 
    updateStatusButtonUI();
    if (pingIntervalId) clearInterval(pingIntervalId);
    pingServer(true);
    startPeriodicPing();
  }

  function attemptInjectUIToToolbar(toolbarElement) {
    ensureUIElementsExist();
    if (statusButtonContainer.parentElement && statusButtonContainer.parentElement !== toolbarElement) {
        statusButtonContainer.parentElement.removeChild(statusButtonContainer);
    }
    if (statusButtonContainer.parentElement !== toolbarElement) {
        toolbarElement.appendChild(statusButtonContainer);
    }
    toolbarElement.style.position = 'relative'; 
    Object.assign(statusButtonContainer.style, {
        position: 'absolute', left: '50%', 
        bottom: 'calc(50% - ' + (statusButtonContainer.offsetHeight / 2 || 7) + 'px)', 
        transform: 'translateX(-50%)', zIndex: '100', right: 'auto', top: 'auto'
    });
    currentInjectedToolbar = toolbarElement;
    console.log(`[${EXTENSION_ID}] UI injected into: ${toolbarElement.tagName}${toolbarElement.id ? '#'+toolbarElement.id : ''}${toolbarElement.className ? '.'+toolbarElement.className.trim().replace(/ /g, '.') : ''}`);
  }

  function fallbackInjectUI() {
      ensureUIElementsExist();
      if (statusButtonContainer.parentElement && statusButtonContainer.parentElement !== document.body) {
          statusButtonContainer.parentElement.removeChild(statusButtonContainer);
      }
      if (statusButtonContainer.parentElement !== document.body) { 
          document.body.appendChild(statusButtonContainer);
      }
      Object.assign(statusButtonContainer.style, { position: 'fixed', bottom: '8px', right: '8px', zIndex: '1001', left:'auto', top:'auto', transform:'none' });
      currentInjectedToolbar = document.body; 
      console.warn(`[${EXTENSION_ID}] Chat toolbar not found. UI moved to fallback (bottom-right).`);
  }

  function updateStatusButtonUI() {
    ensureUIElementsExist();
    const statusBtn = document.getElementById(STATUS_BUTTON_ID);
    if (!statusBtn) { /* console.error("[Pinger] Status button not found for UI update"); */ return; }
    const indicator = statusBtn.querySelector('.status-indicator');
    if (!indicator) { /* console.error("[Pinger] Status indicator not found for UI update"); */ return; }
    
    indicator.style.animation = '';
    let newIndicatorColor = theme.indicatorUnknown;
    let statusText = 'ps-Unknown';
    let titleText = 'Server status unknown. Click to check.';

    switch (serverStatus.isReachable) {
      case true: newIndicatorColor = theme.indicatorOnline; statusText = 'ps-Online'; titleText = `Online. Last check: ${serverStatus.lastChecked?.toLocaleTimeString()}. Response: ${serverStatus.responseTime}ms. Click to re-ping.`; break;
      case false: newIndicatorColor = theme.indicatorOffline; statusText = 'ps-Offline'; titleText = `Offline. Last check: ${serverStatus.lastChecked?.toLocaleTimeString()}.`; if(serverStatus.error) titleText += ` Error: ${serverStatus.error}.`; titleText += ` Click to re-ping.`; break;
      case 'pending': newIndicatorColor = theme.indicatorPending; indicator.style.animation = 'pulse 1.2s infinite alternate'; statusText = 'ps-Pinging'; titleText = 'Pinging server...'; break;
      case 'unconfigured': newIndicatorColor = theme.indicatorUnconfigured; statusText = 'ps-Not Set'; titleText = 'Server not configured. Click gear icon.'; break;
    }
    indicator.style.backgroundColor = newIndicatorColor;
    const textEl = statusBtn.querySelector('.status-text');
    if (textEl) textEl.textContent = statusText;
    statusBtn.title = titleText;
  }

  async function pingServer(isManualTrigger = false) {
    if (!serverUrl) {
      serverStatus.isReachable = 'unconfigured';
      updateStatusButtonUI();
      return;
    }
    if (serverStatus.isReachable === 'pending' && !isManualTrigger) {
        console.log(`[${EXTENSION_ID}] Ping in progress.`);
        return;
    }
    serverStatus.isReachable = 'pending'; 
    updateStatusButtonUI(); 

    console.log(`[${EXTENSION_ID}] Pinging: ${serverUrl}`);
    const startTime = Date.now();
    try {
      const response = await fetch(serverUrl, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        mode: 'cors', cache: 'no-cache',
      });
      serverStatus.responseTime = Date.now() - startTime;
      serverStatus.lastChecked = new Date();
      serverStatus.isReachable = response.ok;
      serverStatus.error = response.ok ? null : `Status: ${response.status}`;
    } catch (error) {
      serverStatus.responseTime = Date.now() - startTime; 
      serverStatus.lastChecked = new Date();
      serverStatus.isReachable = false;
      serverStatus.error = error.message;
    }
    console.log(`[${EXTENSION_ID}] Ping result: ${serverStatus.isReachable ? 'Online' : 'Offline/Error'}, Time: ${serverStatus.responseTime}ms, Error: ${serverStatus.error || 'None'}`);
    updateStatusButtonUI(); 
  }

  function startPeriodicPing() {
    if (pingIntervalId) clearInterval(pingIntervalId);
    if (serverUrl && PING_INTERVAL_MS > 0) {
      pingIntervalId = setInterval(pingServer, PING_INTERVAL_MS);
      console.log(`[${EXTENSION_ID}] Auto-ping every ${pingIntervalMinutes}m for ${serverUrl}`);
    } else if (!serverUrl) {
      console.log(`[${EXTENSION_ID}] Auto-ping not started: URL not set.`);
    } else {
       console.log(`[${EXTENSION_ID}] Auto-ping disabled: interval <= 0.`);
    }
  }
  
  const CHAT_TOOLBAR_SELECTORS = [
      'div[data-element-id="chat-input-actions"]', 
      'div[class*="chat-input_actions" i]', 'div[class*="chat-input-toolbar" i]', 
      'div[class*="composer_actions" i]', '.chat-input-actions', '.chat-controls' 
  ];

  function findTargetToolbar() {
      for (const selector of CHAT_TOOLBAR_SELECTORS) {
          const element = document.querySelector(selector);
          if (element && document.body.contains(element)) return element; 
      }
      return null;
  }

  let uiSetupRetryTimeout = null;

  // This function will be called by MutationObserver or initial setup
  function setupOrRepositionUI() {
    ensureUIElementsExist();
    const targetToolbar = findTargetToolbar();

    if (targetToolbar) {
        if (currentInjectedToolbar !== targetToolbar || !targetToolbar.contains(statusButtonContainer)) {
            console.log(`[${EXTENSION_ID}] Target toolbar found. Attempting to inject/move UI.`);
            attemptInjectUIToToolbar(targetToolbar);
        }
    } else {
        // Only move to fallback if it's not already in fallback OR if the button isn't in the DOM at all.
        if (currentInjectedToolbar !== document.body || !document.body.contains(statusButtonContainer)) {
            console.log(`[${EXTENSION_ID}] Target toolbar NOT found. Moving to fallback.`);
            fallbackInjectUI();
        }
    }
    updateStatusButtonUI(); 
  }

  function initialSetupWithRetries(attemptsLeft) {
    ensureUIElementsExist(); // Ensure elements are created before first check
    const targetToolbar = findTargetToolbar();
    if (targetToolbar) {
        console.log(`[${EXTENSION_ID}] Initial: Toolbar found. Injecting.`);
        attemptInjectUIToToolbar(targetToolbar);
        if (serverUrl) { pingServer(); startPeriodicPing(); }
        else { updateStatusButtonUI(); console.log(`[${EXTENSION_ID}] Loaded. URL not set.`); }
    } else if (attemptsLeft > 0) {
        console.log(`[${EXTENSION_ID}] Initial: Toolbar not found. Retries left: ${attemptsLeft -1}`);
        if (uiSetupRetryTimeout) clearTimeout(uiSetupRetryTimeout);
        uiSetupRetryTimeout = setTimeout(() => initialSetupWithRetries(attemptsLeft - 1), 750);
        return;
    } else {
        console.warn(`[${EXTENSION_ID}] Initial: Max retries for toolbar. Using fallback.`);
        fallbackInjectUI();
        if (serverUrl) { pingServer(); startPeriodicPing(); }
        else { updateStatusButtonUI(); console.log(`[${EXTENSION_ID}] Loaded. URL not set.`); }
    }
  }

  function init() {
    console.log(`[${EXTENSION_ID}] Initializing v1.1.6...`);
    addStyles();
    ensureUIElementsExist(); 

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        initialSetupWithRetries(5);
    } else {
        document.addEventListener('DOMContentLoaded', () => initialSetupWithRetries(5));
    }

    const observer = new MutationObserver((mutationsList) => {
        let mainUITargetChanged = false;
        for(const mutation of mutationsList) {
            if (mutation.type === 'childList') {
                const targetNow = findTargetToolbar();
                // Condition to re-evaluate: 
                // 1. Target toolbar exists AND (our UI isn't there OR it's in the wrong toolbar)
                // 2. Target toolbar DOESN'T exist AND our UI was previously in a toolbar (not fallback)
                if (targetNow && (!currentInjectedToolbar || !targetNow.contains(statusButtonContainer) || currentInjectedToolbar !== targetNow )) {
                    mainUITargetChanged = true; break;
                }
                if (!targetNow && currentInjectedToolbar && currentInjectedToolbar !== document.body) {
                    mainUITargetChanged = true; break;
                }
            }
        }
        if (mainUITargetChanged) {
            console.log(`[${EXTENSION_ID}] MutationObserver: Relevant DOM change. Re-evaluating UI.`);
            setupOrRepositionUI();
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    console.log(`[${EXTENSION_ID}] MutationObserver watching document body.`);
  }

  if (!window.pluginServerPingerInitialized) {
    init();
    window.pluginServerPingerInitialized = true;
  }
})(); 