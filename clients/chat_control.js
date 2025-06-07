// ==UserScript==
// @name         TypingMind Command & Patch
// @namespace    http://tampermonkey.net/
// @version      3.0
// @description  Adds a '$' command for Output Settings and prevents the native '@' menu from clearing chat input on selection.
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
  };

  // --- 2. Selectors ---
  const SELECTORS = {
    CHAT_INPUT: '#chat-input-textbox',
    SHORTCUTS_MENU_BUTTON: 'button[data-element-id="search-shortcut-button"]',
    OUTPUT_SETTINGS_CATEGORY_BUTTON: 'div[data-element-id="search-action-open-output-settings"]',
    OUTPUT_FORMAT_SELECT: 'select[data-element-id="output-format-setting-options"]',
    OUTPUT_TONE_SELECT: 'select[data-element-id="output-tone-setting-options"]',
    OUTPUT_WRITING_STYLE_SELECT: 'select[data-element-id="output-writing-setting-options"]',
    OUTPUT_LANGUAGE_SELECT: 'select[data-element-id="output-language-setting-options"]',
    // Selector for the native @mention dropdown menu to patch its behavior
    NATIVE_AT_MENU_OPTIONS: '[id^="headlessui-combobox-option-"]',
  };

  // --- Core Script ---
  const DROPDOWN_ID = 'universal-command-selector-dropdown';
  let dropdownVisible = false;
  let activeSelectionIndex = 0;
  let currentOptions = [];
  let originalText = '';
  let allOptionsCache = null;

  async function initialize() {
    const chatInput = await waitForElement(SELECTORS.CHAT_INPUT);
    if (!chatInput) return;

    // Listeners for our custom '$' command
    chatInput.addEventListener('keydown', handleKeyDown, true);
    chatInput.addEventListener('input', handleInput);
    document.addEventListener('click', handleClickOutside);

    // Start the process to patch the native '@' menu behavior
    patchNativeAgentSelector(chatInput);

    console.log('TypingMind Command & Patch Initialized (v3.0)');
  }

  // --- 1. Patch Native '@' Menu to Preserve Text ---

  function patchNativeAgentSelector(chatInput) {
    // This function observes the DOM for the native @-menu to appear.
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.addedNodes.length) {
          const agentOptions = document.querySelectorAll(SELECTORS.NATIVE_AT_MENU_OPTIONS);
          // Check if it's the agent menu (and not our own menu)
          if (agentOptions.length > 0 && agentOptions[0].textContent.includes('GPT')) {
            // It appeared, so add our text-preserving logic to each item.
            agentOptions.forEach((optionNode) => {
              optionNode.addEventListener('mousedown', () => {
                const textToPreserve = chatInput.value;
                // Schedule the text to be restored right after the app clears it.
                requestAnimationFrame(() => {
                  if (chatInput.value === '' || chatInput.value !== textToPreserve) {
                    chatInput.value = textToPreserve;
                  }
                });
              }, { once: true }); // Use `once` so our listener cleans itself up.
            });
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }


  // --- 2. Custom '$' Command Functionality ---

  function handleKeyDown(e) {
    if (e.key === CONFIG.triggerCharacter && !e.repeat) {
      e.preventDefault();
      e.stopPropagation();
      const input = e.target;
      const start = input.selectionStart;
      const end = input.selectionEnd;
      input.value = input.value.substring(0, start) + CONFIG.triggerCharacter + input.value.substring(end);
      input.selectionStart = input.selectionEnd = start + 1;
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

  const applyOffscreenStyle = (element) => {
    if (!element) return;
    Object.assign(element.style, { position: 'absolute', left: '-9999px', top: '-9999px', visibility: 'hidden' });
  };

  function getOutputSettings() {
    return new Promise(async (resolve) => {
      const shortcutsButton = document.querySelector(SELECTORS.SHORTCUTS_MENU_BUTTON);
      if (!shortcutsButton) return resolve([]);
      shortcutsButton.click();
      document.querySelector(SELECTORS.CHAT_INPUT)?.focus();
      await new Promise((r) => setTimeout(r, 50));

      const firstMenu = document.querySelector(SELECTORS.OUTPUT_SETTINGS_CATEGORY_BUTTON)?.closest('[role="listbox"]');
      applyOffscreenStyle(firstMenu);

      const categoryButton = document.querySelector(SELECTORS.OUTPUT_SETTINGS_CATEGORY_BUTTON);
      if (!categoryButton) {
        document.body.click();
        return resolve([]);
      }
      categoryButton.click();
      document.querySelector(SELECTORS.CHAT_INPUT)?.focus();
      await new Promise((r) => setTimeout(r, 50));

      const settingsPanel = document.querySelector(SELECTORS.OUTPUT_FORMAT_SELECT)?.closest('div.space-y-4.my-4')?.parentElement;
      applyOffscreenStyle(settingsPanel);

      const settings = [];
      const scrapeSelect = (namespace, selector) => {
        const selectEl = document.querySelector(selector);
        if (!selectEl) return;
        Array.from(selectEl.options).forEach((opt) => {
          if (opt.value) {
            settings.push({ type: 'outputSetting', namespace, name: opt.textContent, value: opt.value, selectSelector: selector });
          }
        });
      };
      scrapeSelect('Format', SELECTORS.OUTPUT_FORMAT_SELECT);
      scrapeSelect('Tone', SELECTORS.OUTPUT_TONE_SELECT);
      scrapeSelect('Style', SELECTORS.OUTPUT_WRITING_STYLE_SELECT);
      scrapeSelect('Lang', SELECTORS.OUTPUT_LANGUAGE_SELECT);

      const doneButton = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Done');
      if (doneButton) doneButton.click(); else document.body.click();

      await new Promise((r) => setTimeout(r, 50));
      resolve(settings);
    });
  }

  async function selectOption(option) {
    if (!option || option.type !== 'outputSetting') return;

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

    const chatInput = document.querySelector(SELECTORS.CHAT_INPUT);
    if (chatInput) {
        chatInput.value = originalText;
        chatInput.focus();
        chatInput.setSelectionRange(chatInput.value.length, chatInput.value.length);
    }
    hideDropdown();
  }

  // --- Standard Helper & UI Functions ---
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
      allOptionsCache = await getOutputSettings(); // Only fetch output settings
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

  function filterOptions(options, query) {
    if (!query) return options;
    const lowerCaseQuery = query.toLowerCase();
    return options.filter((option) => `${option.namespace} ${option.name}`.toLowerCase().includes(lowerCaseQuery));
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
    loadingElement.innerHTML = `<span style="color: ${CONFIG.theme.optionNamespaceText};">Loading settings...</span>`;
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
      position: 'absolute', backgroundColor: CONFIG.theme.dropdownBg, border: `1px solid ${CONFIG.theme.dropdownBorder}`,
      borderRadius: '8px', zIndex: '10001', maxHeight: '300px',
      overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.25)', display: 'none',
    });
  }

  function styleOptionElement(element) {
    Object.assign(element.style, {
      padding: '10px 12px', cursor: 'pointer', fontSize: '14px',
      borderBottom: `1px solid ${CONFIG.theme.dropdownBorder}`, color: CONFIG.theme.optionText, backgroundColor: 'transparent',
    });
  }

  function positionDropdown(dropdown) {
    const chatInput = document.querySelector(SELECTORS.CHAT_INPUT);
    if (!chatInput) return;
    const rect = chatInput.getBoundingClientRect();
    dropdown.style.left = `${rect.left}px`;
    dropdown.style.bottom = `${window.innerHeight - rect.top}px`;
    dropdown.style.width = `${rect.width}px`;
  }

  initialize();
})();
