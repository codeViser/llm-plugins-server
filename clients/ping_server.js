// TypingMind Extension: Plugin Server Ping & Status
// Version 1.1.0

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
  let statusButtonContainer = null; // Will hold both status and settings button
  let configPanel = null;
  let isConfigPanelOpen = false;

  // --- DOM Elements & Styling ---
  const CONTAINER_ID = `${EXTENSION_ID}-container`;
  const STATUS_BUTTON_ID = `${EXTENSION_ID}-status-btn`;
  const SETTINGS_BUTTON_ID = `${EXTENSION_ID}-settings-btn`;
  const CONFIG_PANEL_ID = `${EXTENSION_ID}-config-panel`;

  function addStyles() {
    const styleId = `${EXTENSION_ID}-styles`;
    if (document.getElementById(styleId)) return;

    const css = `
      #${CONTAINER_ID} {
        display: flex;
        align-items: center;
        margin-left: 8px;
        position: relative; /* For config panel positioning */
      }
      #${STATUS_BUTTON_ID}, #${SETTINGS_BUTTON_ID} {
        padding: 5px 8px;
        font-size: 12px;
        border-radius: 5px;
        cursor: pointer;
        border: 1px solid #ccc;
        background-color: #f0f0f0;
        display: flex;
        align-items: center;
        gap: 5px;
        transition: background-color 0.3s, border-color 0.3s;
      }
      #${STATUS_BUTTON_ID} {
        border-top-right-radius: 0;
        border-bottom-right-radius: 0;
        border-right: none;
      }
      #${SETTINGS_BUTTON_ID} {
        border-top-left-radius: 0;
        border-bottom-left-radius: 0;
        padding: 5px; /* Smaller padding for icon button */
      }
      #${SETTINGS_BUTTON_ID} svg {
        width: 14px;
        height: 14px;
        fill: #333;
      }
      #${STATUS_BUTTON_ID}:hover, #${SETTINGS_BUTTON_ID}:hover {
        border-color: #bbb;
        background-color: #e0e0e0;
      }
      #${STATUS_BUTTON_ID} .status-indicator {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background-color: grey; /* Default: Unknown */
        transition: background-color 0.3s;
      }
      #${STATUS_BUTTON_ID}.online .status-indicator { background-color: #28a745; /* Green */ }
      #${STATUS_BUTTON_ID}.offline .status-indicator { background-color: #dc3545; /* Red */ }
      #${STATUS_BUTTON_ID}.pending .status-indicator { background-color: #ffc107; animation: pulse 1.5s infinite; }
      #${STATUS_BUTTON_ID}.unconfigured .status-indicator { background-color: #6c757d; /* Bootstrap secondary/grey */ }

      #${CONFIG_PANEL_ID} {
        position: absolute;
        bottom: calc(100% + 5px); /* Position above the button container */
        right: 0;
        background-color: white;
        border: 1px solid #ccc;
        border-radius: 5px;
        padding: 15px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        z-index: 1000;
        width: 300px;
        display: none; /* Hidden by default */
      }
      #${CONFIG_PANEL_ID} label { display: block; margin-bottom: 5px; font-size: 12px; }
      #${CONFIG_PANEL_ID} input[type="text"], #${CONFIG_PANEL_ID} input[type="number"] {
        width: calc(100% - 12px);
        padding: 6px;
        margin-bottom: 10px;
        border: 1px solid #ddd;
        border-radius: 3px;
        font-size: 13px;
      }
      #${CONFIG_PANEL_ID} button {
        padding: 8px 12px;
        border: none;
        border-radius: 3px;
        cursor: pointer;
        font-size: 13px;
        margin-right: 5px;
      }
      #${CONFIG_PANEL_ID} .save-btn { background-color: #007bff; color: white; }
      #${CONFIG_PANEL_ID} .save-btn:hover { background-color: #0056b3; }
      #${CONFIG_PANEL_ID} .close-btn { background-color: #f0f0f0; color: #333; }
      #${CONFIG_PANEL_ID} .close-btn:hover { background-color: #e0e0e0; }
      #${CONFIG_PANEL_ID} .config-note { font-size: 11px; color: #666; margin-top:10px;}

      @keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.5; } 100% { opacity: 1; } }
    `;
    const styleElement = document.createElement('style');
    styleElement.id = styleId;
    styleElement.textContent = css;
    document.head.appendChild(styleElement);
  }

  function createConfigPanel() {
    if (document.getElementById(CONFIG_PANEL_ID)) return;

    configPanel = document.createElement('div');
    configPanel.id = CONFIG_PANEL_ID;

    configPanel.innerHTML = 
      `<label for="${EXTENSION_ID}-server-url">Server Health Endpoint URL:</label>
      <input type="text" id="${EXTENSION_ID}-server-url" placeholder="e.g., https://your-server.com/health-check">
      
      <label for="${EXTENSION_ID}-ping-interval">Ping Interval (minutes):</label>
      <input type="number" id="${EXTENSION_ID}-ping-interval" min="1" placeholder="e.g., 10">
      
      <button class="save-btn">Save</button>
      <button class="close-btn">Close</button>
      <p class="config-note">Ensure the server URL is correct and accessible. The extension will use a GET request.</p>`
    ;

    configPanel.querySelector('.save-btn').addEventListener('click', saveConfig);
    configPanel.querySelector('.close-btn').addEventListener('click', toggleConfigPanel);
    
    document.body.appendChild(configPanel);
  }
  
  function toggleConfigPanel() {
    if (!configPanel) createConfigPanel();
    
    if (isConfigPanelOpen) {
      configPanel.style.display = 'none';
    } else {
      document.getElementById(`${EXTENSION_ID}-server-url`).value = serverUrl || '';
      document.getElementById(`${EXTENSION_ID}-ping-interval`).value = pingIntervalMinutes;
      
      const containerRect = statusButtonContainer.getBoundingClientRect();
      configPanel.style.position = 'absolute';
      configPanel.style.bottom = 'calc(100% + 5px)';
      configPanel.style.right = '0px'; 

      configPanel.style.display = 'block';
    }
    isConfigPanelOpen = !isConfigPanelOpen;
  }

  function saveConfig() {
    const newUrl = document.getElementById(`${EXTENSION_ID}-server-url`).value.trim();
    const newInterval = parseInt(document.getElementById(`${EXTENSION_ID}-ping-interval`).value, 10);

    if (!newUrl) {
      alert("Server URL cannot be empty.");
      return;
    }
    if (isNaN(newInterval) || newInterval < 1) {
      alert("Ping interval must be a number greater than or equal to 1.");
      return;
    }

    serverUrl = newUrl;
    pingIntervalMinutes = newInterval;
    PING_INTERVAL_MS = pingIntervalMinutes * 60 * 1000;

    localStorage.setItem(STORAGE_KEY_SERVER_URL, serverUrl);
    localStorage.setItem(STORAGE_KEY_PING_INTERVAL, pingIntervalMinutes.toString());

    console.log(`[${EXTENSION_ID}] Configuration saved. URL: ${serverUrl}, Interval: ${pingIntervalMinutes} min`);
    toggleConfigPanel();
    
    serverStatus.isReachable = null; 
    updateStatusButtonUI();
    if (pingIntervalId) clearInterval(pingIntervalId);
    pingServer(true);
    startPeriodicPing();
  }

  function createToolbarButton() {
    if (document.getElementById(CONTAINER_ID)) return;

    statusButtonContainer = document.createElement('div');
    statusButtonContainer.id = CONTAINER_ID;

    const statusBtn = document.createElement('button');
    statusBtn.id = STATUS_BUTTON_ID;
    
    const indicator = document.createElement('span');
    indicator.className = 'status-indicator';
    statusBtn.appendChild(indicator);
    
    const text = document.createElement('span');
    text.className = 'status-text';
    statusBtn.appendChild(text);

    statusBtn.addEventListener('click', () => {
      if (serverStatus.isReachable === 'unconfigured') {
        toggleConfigPanel();
        return;
      }
      console.log(`[${EXTENSION_ID}] Manual server ping triggered.`);
      pingServer(true);
    });

    const settingsBtn = document.createElement('button');
    settingsBtn.id = SETTINGS_BUTTON_ID;
    settingsBtn.title = 'Configure Server Ping';
    settingsBtn.innerHTML = 
      `<svg viewBox="0 0 24 24">
        <path d="M19.43 12.98c.04-.32.07-.64.07-.98s-.03-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.3-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65C14.46 2.18 14.25 2 14 2h-4c-.25 0-.46.18-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1c-.23-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64l2.11 1.65c-.04.32-.07.65-.07.98s.03.66.07.98l-2.11 1.65c-.19.15-.24.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.65c.61-.25 1.17-.59 1.69-.98l2.49 1c.23.09.49 0 .61.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.65zM12 15.5c-1.93 0-3.5-1.57-3.5-3.5s1.57-3.5 3.5-3.5 3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5z"/>
      </svg>`
    ;
    settingsBtn.addEventListener('click', toggleConfigPanel);

    statusButtonContainer.appendChild(statusBtn);
    statusButtonContainer.appendChild(settingsBtn);

    const chatToolbarSelectors = [
      '.chat-input-actions', '.chat-controls', 'div[class*="ChatInput_actions"]', 'div[class*="ChatInputToolbar_toolbar"]'
    ];
    let parentToAttach = null;
    for (const selector of chatToolbarSelectors) {
        parentToAttach = document.querySelector(selector);
        if (parentToAttach) break;
    }

    if (parentToAttach) {
      parentToAttach.appendChild(statusButtonContainer);
      console.log(`[${EXTENSION_ID}] Toolbar buttons added to:`, parentToAttach);
    } else {
      console.warn(`[${EXTENSION_ID}] Could not find a suitable chat toolbar element. Buttons will not be visible.`);
    }
    updateStatusButtonUI();
    createConfigPanel();
  }

  function updateStatusButtonUI() {
    const statusBtn = document.getElementById(STATUS_BUTTON_ID);
    if (!statusBtn) return;

    statusBtn.classList.remove('online', 'offline', 'pending', 'unconfigured');
    const textEl = statusBtn.querySelector('.status-text');
    let statusTextContent = '';
    let titleText = '';

    switch (serverStatus.isReachable) {
      case true:
        statusBtn.classList.add('online');
        statusTextContent = `Online`;
        if(serverStatus.responseTime) statusTextContent += ` (${serverStatus.responseTime}ms)`;
        titleText = `Server is Online. Last check: ${serverStatus.lastChecked?.toLocaleTimeString()}. Response: ${serverStatus.responseTime}ms. Click to re-ping.`;
        break;
      case false:
        statusBtn.classList.add('offline');
        statusTextContent = 'Offline';
        titleText = `Server is Offline. Last check: ${serverStatus.lastChecked?.toLocaleTimeString()}.`;
        if(serverStatus.error) titleText += ` Error: ${serverStatus.error}. Click to re-ping.`;
        else titleText += ` Click to re-ping.`;
        break;
      case 'pending':
        statusBtn.classList.add('pending');
        statusTextContent = 'Pinging...';
        titleText = 'Pinging server...';
        break;
      case 'unconfigured':
        statusBtn.classList.add('unconfigured');
        statusTextContent = 'Not Configured';
        titleText = 'Server ping not configured. Click settings to setup.';
        break;
      default: // null (unknown)
        statusBtn.classList.remove('online', 'offline', 'pending', 'unconfigured');
        statusBtn.querySelector('.status-indicator').style.backgroundColor = 'grey';
        statusTextContent = 'Unknown';
        titleText = 'Server status unknown. Click to check, or configure if needed.';
        break;
    }
    textEl.textContent = statusTextContent;
    statusBtn.title = titleText;
  }

  async function pingServer(isManualTrigger = false) {
    if (!serverUrl) {
      console.warn(`[${EXTENSION_ID}] Server URL not configured. Skipping ping.`);
      serverStatus.isReachable = 'unconfigured';
      serverStatus.lastChecked = new Date();
      serverStatus.error = "URL not configured";
      updateStatusButtonUI();
      return;
    }
    
    if (serverStatus.isReachable === 'pending' && !isManualTrigger) {
        console.log(`[${EXTENSION_ID}] Ping already in progress. Skipping automatic ping.`);
        return;
    }

    console.log(`[${EXTENSION_ID}] Pinging server: ${serverUrl}`);
    serverStatus.isReachable = 'pending';
    updateStatusButtonUI();

    const startTime = Date.now();
    try {
      const response = await fetch(serverUrl, {
        method: 'GET',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        mode: 'cors', cache: 'no-cache',
      });

      serverStatus.responseTime = Date.now() - startTime;
      serverStatus.lastChecked = new Date();

      if (response.ok) {
        serverStatus.isReachable = true;
        serverStatus.error = null;
        console.log(`[${EXTENSION_ID}] Server is reachable. Status: ${response.status}. Response time: ${serverStatus.responseTime}ms.`);
      } else {
        serverStatus.isReachable = false;
        serverStatus.error = `Status: ${response.status}`;
        console.warn(`[${EXTENSION_ID}] Server ping failed. Status: ${response.status}. Response time: ${serverStatus.responseTime}ms.`);
      }
    } catch (error) {
      serverStatus.responseTime = Date.now() - startTime;
      serverStatus.lastChecked = new Date();
      serverStatus.isReachable = false;
      serverStatus.error = error.message;
      console.error(`[${EXTENSION_ID}] Error pinging server:`, error);
    }
    updateStatusButtonUI();
  }

  function startPeriodicPing() {
    if (pingIntervalId) clearInterval(pingIntervalId);
    
    if (serverUrl && PING_INTERVAL_MS > 0) {
      pingIntervalId = setInterval(pingServer, PING_INTERVAL_MS);
      console.log(`[${EXTENSION_ID}] Periodic ping scheduled every ${pingIntervalMinutes} minutes for ${serverUrl}.`);
    } else if (!serverUrl) {
      console.log(`[${EXTENSION_ID}] Periodic ping not started: Server URL not configured.`);
    } else {
       console.log(`[${EXTENSION_ID}] Periodic ping disabled (interval is 0).`);
    }
  }
  
  function init() {
    console.log(`[${EXTENSION_ID}] Initializing extension v1.1.0...`);
    addStyles();

    let attempts = 0;
    const maxAttempts = 10;
    function trySetupUI() {
      const potentialToolbarParent = document.querySelector('.chat-input-actions') || document.querySelector('.chat-controls') || document.querySelector('div[class*="ChatInput_actions"]');
        
      if (potentialToolbarParent || attempts > 2) { 
        createToolbarButton();
        
        if (serverUrl) {
          pingServer();
          startPeriodicPing();
        } else {
          updateStatusButtonUI();
          console.log(`[${EXTENSION_ID}] Extension loaded. Server URL not yet configured.`);
        }
      } else if (attempts < maxAttempts) {
        attempts++;
        console.log(`[${EXTENSION_ID}] Chat UI not ready, retrying UI setup (attempt ${attempts}/${maxAttempts})`);
        setTimeout(trySetupUI, 1000 * attempts);
      } else {
        console.warn(`[${EXTENSION_ID}] Max attempts reached. Could not reliably find chat UI for optimal button placement.`);
        createToolbarButton(); 
        if (serverUrl) {
          pingServer();
          startPeriodicPing();
        } else {
          updateStatusButtonUI();
        }
      }
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      trySetupUI();
    } else {
      document.addEventListener('DOMContentLoaded', trySetupUI);
    }
  }

  if (!window.pluginServerPingerInitialized) {
    init();
    window.pluginServerPingerInitialized = true;
  }
})(); 