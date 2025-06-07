// ==UserScript==
// @name         TypingMind Universal Command Selector
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  Adds a universal, keyboard-navigable command selector by reading app data directly, avoiding UI conflicts.
// @author       AI Assistant & User Collaboration
// @match        https://*.typingmind.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // --- 1. Configuration ---
  const CONFIG = {
    triggerCharacter: '$',
    theme: {
      dropdownBg: '#2D3748',
      dropdownBorder: '#4A5568',
      optionText: '#E2E8F0',
      optionNamespaceText: '#A0AEC0',
      optionHoverBg: '#4A5568',
      activeSelectionBg: '#4A5568',
    },
    // Paths to find data on the window object. This is an educated guess.
    // If it fails, the user can help find the right paths by inspecting `window`.
    dataPaths: {
      agents: 'app.agents.list',
      prompts: 'app.prompts.list',
    },
  };

  // --- 2. Selectors (Now used mostly for *setting* values, not scraping) ---
  const SELECTORS = {
    OUTPUT_FORMAT_SELECT: 'select[data-element-id="output-format-setting-options"]',
    OUTPUT_TONE_SELECT: 'select[data-element-id="output-tone-setting-options"]',
    OUTPUT_WRITING_STYLE_SELECT: 'select[data-element-id="output-writing-setting-options"]',
    OUTPUT_LANGUAGE_SELECT: 'select[data-element-id="output-language-setting-options"]',
    SHORTCUTS_MENU_BUTTON: 'button[data-element-id="search-shortcut-button"]',
    OUTPUT_SETTINGS_CATEGORY_BUTTON: 'div[data-element-id="search-action-open-output-settings"]',
  };

  // --- Core Script ---
  const CHAT_INPUT_ID = 'chat-input-textbox';
  const DROPDOWN_ID = 'universal-command-selector-dropdown';

  let dropdownVisible = false;
  let activeSelectionIndex = 0;
  let currentOptions = [];
  let originalText = '';
  let allOptionsCache = null;

  // Helper to safely access nested properties on an object.
  const getDescendantProp = (obj, desc) => {
    const arr = desc.split('.');
    while (arr.length && (obj = obj[arr.shift()]));
    return obj;
  };

  async function initialize() {
    const chatInput = await waitForElement(`#${CHAT_INPUT_ID}`);
    if (!chatInput) {
      console.error('TypingMind Extension: Could not find chat input. Script will not run.');
      return;
    }
    chatInput.addEventListener('keydown', handleKeyDown, true); // Use capture phase to intercept key
    chatInput.addEventListener('input', handleInput);
    document.addEventListener('click', handleClickOutside);
    console.log('TypingMind Command Selector Initialized (v2.0)');
  }

  function handleKeyDown(e) {
    if (e.key === CONFIG.triggerCharacter) {
      // Prevent the app from processing this character and potentially removing it.
      e.preventDefault();
      e.stopPropagation();
      // Manually insert the character
      const input = e.target;
      const start = input.selectionStart;
      const end = input.selectionEnd;
      input.value = input.value.substring(0, start) + CONFIG.triggerCharacter + input.value.substring(end);
      input.selectionStart = input.selectionEnd = start + 1;
      // Manually trigger the 'input' event so our other listener picks up the change.
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }

    if (!dropdownVisible) return;
    const keyMap = {
      ArrowDown: () => (activeSelectionIndex = (activeSelectionIndex + 1) % currentOptions.length),
      ArrowUp: () => (activeSelectionIndex = (activeSelectionIndex - 1 + currentOptions.length) % currentOptions.length),
      Enter: () => selectOption(currentOptions[activeSelectionIndex]),
      Escape: () => hideDropdown(),
    };
    if (keyMap[e.key]) {
      e.preventDefault();
      e.stopPropagation();
      keyMap[e.key]();
      if (e.key !== 'Enter' && e.key !== 'Escape') updateDropdownSelection();
    }
  }

  function handleInput(e) {
    const text = e.target.value;
    const triggerIndex = text.lastIndexOf(CONFIG.triggerCharacter);

    if (triggerIndex !== -1) {
      const query = text.substring(triggerIndex + 1);
      if (query.includes(' ')) {
        hideDropdown();
        return;
      }
      originalText = text.substring(0, triggerIndex);
      showDropdown(query);
    } else {
      hideDropdown();
    }
  }

  function handleClickOutside(e) {
    const dropdown = document.getElementById(DROPDOWN_ID);
    if (dropdown && !dropdown.contains(e.target)) hideDropdown();
  }

  async function showDropdown(query) {
    let dropdown = document.getElementById(DROPDOWN_ID);
    if (!dropdown) {
      dropdown = document.createElement('div');
      dropdown.id = DROPDOWN_ID;
      styleDropdown(dropdown);
      document.body.appendChild(dropdown);
    }

    if (!allOptionsCache) {
      renderLoading(dropdown);
      positionDropdown(dropdown);
      dropdown.style.display = 'block';
      dropdownVisible = true;
      allOptionsCache = await getAllOptions();
    }

    currentOptions = filterOptions(allOptionsCache, query);
    activeSelectionIndex = 0;

    if (currentOptions.length > 0) {
      renderOptions(dropdown, currentOptions);
    } else {
      renderNoResults(dropdown, query);
    }

    positionDropdown(dropdown);
    dropdown.style.display = 'block';
    dropdownVisible = true;
  }

  function hideDropdown() {
    const dropdown = document.getElementById(DROPDOWN_ID);
    if (dropdown) dropdown.style.display = 'none';
    dropdownVisible = false;
    allOptionsCache = null;
  }

  function updateDropdownSelection() {
    const dropdown = document.getElementById(DROPDOWN_ID);
    for (let i = 0; i < dropdown.children.length; i++) {
      dropdown.children[i].style.backgroundColor =
        i === activeSelectionIndex ? CONFIG.theme.activeSelectionBg : 'transparent';
    }
  }

  function renderOptions(dropdown, options) {
    dropdown.innerHTML = '';
    options.forEach((option, index) => {
      const optionElement = document.createElement('div');
      optionElement.innerHTML = `<span style="color: ${CONFIG.theme.optionNamespaceText}; margin-right: 8px;">${option.namespace}</span> <span style="color: ${CONFIG.theme.optionText};">${option.name}</span>`;
      styleOptionElement(optionElement);

      optionElement.addEventListener('mouseover', () => {
        activeSelectionIndex = index;
        updateDropdownSelection();
      });
      optionElement.addEventListener('click', () => selectOption(option));
      dropdown.appendChild(optionElement);
    });
    updateDropdownSelection();
  }

  function renderLoading(dropdown) {
    dropdown.innerHTML = '';
    const loadingElement = document.createElement('div');
    styleOptionElement(loadingElement);
    loadingElement.innerHTML = `<span style="color: ${CONFIG.theme.optionNamespaceText};">Loading options...</span>`;
    dropdown.appendChild(loadingElement);
  }

  function renderNoResults(dropdown, query) {
    dropdown.innerHTML = '';
    const noResultsElement = document.createElement('div');
    styleOptionElement(noResultsElement);
    noResultsElement.innerHTML = `<span style="color: ${CONFIG.theme.optionNamespaceText};">No results for "${query}"</span>`;
    dropdown.appendChild(noResultsElement);
  }

  function styleDropdown(dropdown) {
    Object.assign(dropdown.style, {
      position: 'absolute',
      backgroundColor: CONFIG.theme.dropdownBg,
      border: `1px solid ${CONFIG.theme.dropdownBorder}`,
      borderRadius: '8px',
      zIndex: '10001',
      maxHeight: '300px',
      overflowY: 'auto',
      boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
      display: 'none',
    });
  }

  function styleOptionElement(element) {
    Object.assign(element.style, {
      padding: '10px 12px',
      cursor: 'pointer',
      fontSize: '14px',
      borderBottom: `1px solid ${CONFIG.theme.dropdownBorder}`,
      color: CONFIG.theme.optionText,
      backgroundColor: 'transparent',
    });
  }

  function positionDropdown(dropdown) {
    const chatInput = document.getElementById(CHAT_INPUT_ID);
    if (!chatInput) return;
    const rect = chatInput.getBoundingClientRect();
    dropdown.style.left = `${rect.left}px`;
    dropdown.style.bottom = `${window.innerHeight - rect.top}px`;
    dropdown.style.width = `${rect.width}px`;
  }

  async function getAllOptions() {
    console.log('Scraping options without clicking...');
    let options = [];

    // Strategy 1: Read data directly from the window object.
    const agents = getDescendantProp(window, CONFIG.dataPaths.agents);
    if (agents && Array.isArray(agents)) {
      console.log(`Found ${agents.length} agents via window object.`);
      options.push(
        ...agents.map((agent) => ({
          type: 'agent',
          namespace: 'Agent',
          name: agent.name,
          id: agent.id,
        }))
      );
    } else {
      console.warn(`Could not find agents at window.${CONFIG.dataPaths.agents}`);
    }

    const prompts = getDescendantProp(window, CONFIG.dataPaths.prompts);
    if (prompts && Array.isArray(prompts)) {
      console.log(`Found ${prompts.length} prompts via window object.`);
      options.push(
        ...prompts.map((prompt) => ({
          type: 'prompt',
          namespace: 'Prompt',
          name: prompt.name,
          id: prompt.id,
        }))
      );
    } else {
      console.warn(`Could not find prompts at window.${CONFIG.dataPaths.prompts}`);
    }

    // Strategy 2: Read Output Settings directly from the DOM (if they exist).
    const scrapeSelect = (namespace, selector, type) => {
      const selectEl = document.querySelector(selector);
      if (!selectEl) return;
      Array.from(selectEl.options).forEach((opt) => {
        if (opt.value) {
          options.push({
            type: type,
            namespace: namespace,
            name: opt.textContent,
            value: opt.value,
            selectSelector: selector,
          });
        }
      });
    };

    scrapeSelect('Format', SELECTORS.OUTPUT_FORMAT_SELECT, 'outputSetting');
    scrapeSelect('Tone', SELECTORS.OUTPUT_TONE_SELECT, 'outputSetting');
    scrapeSelect('Style', SELECTORS.OUTPUT_WRITING_STYLE_SELECT, 'outputSetting');
    scrapeSelect('Lang', SELECTORS.OUTPUT_LANGUAGE_SELECT, 'outputSetting');

    console.log(`Total options found: ${options.length}`);
    return options;
  }

  async function selectOption(option) {
    if (!option) return;
    console.log('Selecting option:', option);

    // This is the ideal way - finding a function on the window object to call.
    // As we don't know the function name, we are making an educated guess.
    // If these don't work, this part needs to be updated.
    if (option.type === 'agent') {
      const setAgentFunc = getDescendantProp(window, 'app.setActiveAgentId'); // hypothetical function
      if (setAgentFunc) {
        setAgentFunc(option.id);
        console.log(`Called app.setActiveAgentId with ${option.id}`);
      } else {
        console.error('Could not find function to set agent.');
      }
    } else if (option.type === 'prompt') {
      const usePromptFunc = getDescendantProp(window, 'app.usePrompt'); // hypothetical function
      if (usePromptFunc) {
        usePromptFunc({ id: option.id, text: option.name });
        console.log(`Called app.usePrompt with ${option.id}`);
      } else {
        console.error('Could not find function to use prompt.');
      }
    } else if (option.type === 'outputSetting') {
      // For <select>, we still need to interact with the DOM, but it's much safer.
      const shortcutsButton = document.querySelector(SELECTORS.SHORTCUTS_MENU_BUTTON);
      if (shortcutsButton) {
        shortcutsButton.click();
        await new Promise((r) => setTimeout(r, 50));
        const categoryButton = document.querySelector(SELECTORS.OUTPUT_SETTINGS_CATEGORY_BUTTON);
        if (categoryButton) {
          categoryButton.click();
          await new Promise((r) => setTimeout(r, 50));
          const selectElement = document.querySelector(option.selectSelector);
          if (selectElement) {
            selectElement.value = option.value;
            selectElement.dispatchEvent(new Event('change', { bubbles: true }));
          }
          const doneButton = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Done');
          if (doneButton) doneButton.click();
        }
      }
    }

    const chatInput = document.getElementById(CHAT_INPUT_ID);
    chatInput.value = originalText;
    chatInput.focus();
    chatInput.setSelectionRange(chatInput.value.length, chatInput.value.length);
    hideDropdown();
  }

  function filterOptions(options, query) {
    if (!query) return options;
    const lowerCaseQuery = query.toLowerCase();
    return options.filter((option) => `${option.namespace} ${option.name}`.toLowerCase().includes(lowerCaseQuery));
  }

  function waitForElement(selector) {
    return new Promise((resolve) => {
      const el = document.querySelector(selector);
      if (el) return resolve(el);
      const observer = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el) {
          resolve(el);
          observer.disconnect();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    });
  }

  initialize();
})();
