// ==UserScript==
// @name         TypingMind Universal Command Selector
// @namespace    http://tampermonkey.net/
// @version      1.2
// @description  Adds a universal, keyboard-navigable command selector for agents, prompts, and settings in TypingMind.
// @author       AI Assistant & User Collaboration
// @match        https://*.typingmind.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // --- 1. Configuration ---
  const CONFIG = {
    // You can change the trigger character here (e.g., '@', '/', ':')
    triggerCharacter: '$',

    // Dark theme colors inspired by ping_server.js
    theme: {
      dropdownBg: '#2D3748', // gray-800
      dropdownBorder: '#4A5568', // gray-700
      optionText: '#E2E8F0', // gray-300
      optionNamespaceText: '#A0AEC0', // gray-500
      optionHoverBg: '#4A5568', // gray-700
      activeSelectionBg: '#4A5568', // gray-700
    },
  };

  // --- 2. Selectors (Verified from previous steps) ---
  const SELECTORS = {
    SHORTCUTS_MENU_BUTTON: 'button[data-element-id="search-shortcut-button"]',
    AGENTS_CATEGORY_BUTTON: 'div[data-element-id="search-action-open-ai-characters"]',
    AGENT_LIST_ITEM: '[id^="headlessui-combobox-option-"]',
    PROMPTS_CATEGORY_BUTTON: 'div[data-element-id="search-action-open-prompt-library"]',
    PROMPT_LIST_ITEM: 'div[data-element-id="prompt-library-one-prompt-block"]',
    OUTPUT_SETTINGS_CATEGORY_BUTTON: 'div[data-element-id="search-action-open-output-settings"]',
    OUTPUT_FORMAT_SELECT: 'select[data-element-id="output-format-setting-options"]',
    OUTPUT_TONE_SELECT: 'select[data-element-id="output-tone-setting-options"]',
    OUTPUT_WRITING_STYLE_SELECT: 'select[data-element-id="output-writing-setting-options"]',
    OUTPUT_LANGUAGE_SELECT: 'select[data-element-id="output-language-setting-options"]',
  };

  // --- Core Script (No changes needed below this line) ---
  const CHAT_INPUT_ID = 'chat-input-textbox';
  const DROPDOWN_ID = 'universal-command-selector-dropdown';

  let dropdownVisible = false;
  let activeSelectionIndex = 0;
  let currentOptions = [];
  let originalText = '';
  let allOptionsCache = null; // Cache options to prevent re-scraping on every keystroke.

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

  async function initialize() {
    const chatInput = await waitForElement(`#${CHAT_INPUT_ID}`);
    if (!chatInput) {
      console.error('TypingMind Extension: Could not find chat input. Script will not run.');
      return;
    }
    chatInput.addEventListener('input', handleInput);
    chatInput.addEventListener('keydown', handleKeyDown);
    document.addEventListener('click', handleClickOutside);
  }

  function handleKeyDown(e) {
    if (!dropdownVisible) return;
    const keyMap = {
      ArrowDown: () => (activeSelectionIndex = (activeSelectionIndex + 1) % currentOptions.length),
      ArrowUp: () =>
        (activeSelectionIndex = (activeSelectionIndex - 1 + currentOptions.length) % currentOptions.length),
      Enter: () => selectOption(currentOptions[activeSelectionIndex]),
      Escape: () => hideDropdown(),
    };
    if (keyMap[e.key]) {
      e.preventDefault();
      keyMap[e.key]();
      if (e.key !== 'Enter' && e.key !== 'Escape') updateDropdownSelection();
    }
  }

  function handleInput(e) {
    const text = e.target.value;
    const triggerIndex = text.lastIndexOf(CONFIG.triggerCharacter);

    if (triggerIndex !== -1) {
      const query = text.substring(triggerIndex + 1);
      // If there's a space in the query, the user has likely finished with the command
      // and wants to type normally. So, we hide the dropdown.
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

    // If we don't have the options cached, fetch them.
    if (!allOptionsCache) {
      renderLoading(dropdown); // Show a loading indicator
      positionDropdown(dropdown);
      dropdown.style.display = 'block';
      dropdownVisible = true;

      allOptionsCache = await getAllOptions();
    }

    // Now we have the options, filter and render them.
    currentOptions = filterOptions(allOptionsCache, query);
    activeSelectionIndex = 0;

    if (currentOptions.length > 0) {
      renderOptions(dropdown, currentOptions);
    } else {
      renderNoResults(dropdown, query);
    }

    // Ensure dropdown is still visible and positioned correctly after async fetch
    positionDropdown(dropdown);
    dropdown.style.display = 'block';
    dropdownVisible = true;
  }

  function hideDropdown() {
    const dropdown = document.getElementById(DROPDOWN_ID);
    if (dropdown) dropdown.style.display = 'none';
    dropdownVisible = false;
    allOptionsCache = null; // Clear the cache when the interaction is over.
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
      // Added specific styles for namespace and name
      optionElement.innerHTML = `<span style="color: ${CONFIG.theme.optionNamespaceText}; margin-right: 8px;">${option.namespace}</span> <span style="color: ${CONFIG.theme.optionText};">${option.name}</span>`;
      styleOptionElement(optionElement);

      optionElement.addEventListener('mouseover', () => {
        activeSelectionIndex = index;
        updateDropdownSelection();
      });
      optionElement.addEventListener('click', () => selectOption(option));
      dropdown.appendChild(optionElement);
    });
    // After creating all elements, apply the initial selection highlight
    updateDropdownSelection();
  }

  function renderLoading(dropdown) {
    dropdown.innerHTML = '';
    const loadingElement = document.createElement('div');
    styleOptionElement(loadingElement); // Use the same base style
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

  async function selectOption(option) {
    if (!option) return;

    const shortcutsButton = document.querySelector(SELECTORS.SHORTCUTS_MENU_BUTTON);
    if (!shortcutsButton) return;
    shortcutsButton.click();
    document.getElementById(CHAT_INPUT_ID)?.focus();
    await new Promise((r) => setTimeout(r, 100));

    if (option.type === 'listItem') {
      const categoryButton = document.querySelector(option.categoryButtonSelector);
      if (categoryButton) {
        categoryButton.click();
        document.getElementById(CHAT_INPUT_ID)?.focus();
        await new Promise((r) => setTimeout(r, 100));
        const allItems = document.querySelectorAll(option.finalItemSelector);
        const targetItem = Array.from(allItems).find((item) => item.textContent.includes(option.name));
        if (targetItem) {
          targetItem.click();
        } else {
          console.warn('TypingMind Extension: Could not find final item named:', option.name);
          document.body.click();
        }
      }
    } else if (option.type === 'outputSetting') {
      const categoryButton = document.querySelector(SELECTORS.OUTPUT_SETTINGS_CATEGORY_BUTTON);
      if (categoryButton) {
        categoryButton.click();
        document.getElementById(CHAT_INPUT_ID)?.focus();
        await new Promise((r) => setTimeout(r, 100));
        const selectElement = document.querySelector(option.selectSelector);
        if (selectElement) {
          selectElement.value = option.value;
          selectElement.dispatchEvent(new Event('change', { bubbles: true }));
        }
        const doneButton = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Done');
        if (doneButton) doneButton.click();
      }
    }

    const chatInput = document.getElementById(CHAT_INPUT_ID);
    chatInput.value = originalText;
    chatInput.focus();
    chatInput.setSelectionRange(chatInput.value.length, chatInput.value.length);
    hideDropdown();
  }

  function scrapeClickableList(namespace, categoryButtonSelector, finalItemSelector) {
    return new Promise(async (resolve) => {
      const shortcutsButton = document.querySelector(SELECTORS.SHORTCUTS_MENU_BUTTON);
      if (!shortcutsButton) return resolve([]);
      shortcutsButton.click();
      document.getElementById(CHAT_INPUT_ID)?.focus();
      await new Promise((r) => setTimeout(r, 100));

      // Hide the first native menu to make scraping invisible
      const firstMenu = document.querySelector(SELECTORS.AGENTS_CATEGORY_BUTTON)?.closest('[role="listbox"]');
      if (firstMenu) firstMenu.style.visibility = 'hidden';

      const categoryButton = document.querySelector(categoryButtonSelector);
      if (!categoryButton) {
        document.body.click(); // Clean up
        return resolve([]);
      }
      categoryButton.click();
      document.getElementById(CHAT_INPUT_ID)?.focus();
      await new Promise((r) => setTimeout(r, 100));

      // Hide the second native menu
      const secondMenu = document.querySelector(finalItemSelector)?.closest('[role="listbox"]');
      if (secondMenu) secondMenu.style.visibility = 'hidden';

      const items = Array.from(document.querySelectorAll(finalItemSelector)).map((item) => ({
        type: 'listItem',
        namespace: namespace,
        name: item.textContent.trim().split('\n')[0],
        categoryButtonSelector: categoryButtonSelector,
        finalItemSelector: finalItemSelector,
      }));
      document.body.click(); // Clean up and close invisible menus
      await new Promise((r) => setTimeout(r, 50));
      resolve(items);
    });
  }

  function scrapeOutputSettings() {
    return new Promise(async (resolve) => {
      const shortcutsButton = document.querySelector(SELECTORS.SHORTCUTS_MENU_BUTTON);
      if (!shortcutsButton) return resolve([]);
      shortcutsButton.click();
      document.getElementById(CHAT_INPUT_ID)?.focus();
      await new Promise((r) => setTimeout(r, 100));

      // Hide the first native menu
      const firstMenu = document.querySelector(SELECTORS.AGENTS_CATEGORY_BUTTON)?.closest('[role="listbox"]');
      if (firstMenu) firstMenu.style.visibility = 'hidden';

      const categoryButton = document.querySelector(SELECTORS.OUTPUT_SETTINGS_CATEGORY_BUTTON);
      if (!categoryButton) {
        document.body.click();
        return resolve([]);
      }
      categoryButton.click();
      document.getElementById(CHAT_INPUT_ID)?.focus();
      await new Promise((r) => setTimeout(r, 100));

      // Hide the settings panel itself
      const settingsPanel = document
        .querySelector(SELECTORS.OUTPUT_FORMAT_SELECT)
        ?.closest('div.space-y-4.my-4')?.parentElement;
      if (settingsPanel) settingsPanel.style.visibility = 'hidden';

      const settings = [];
      const scrapeSelect = (namespace, selector) => {
        const selectEl = document.querySelector(selector);
        if (!selectEl) return;
        Array.from(selectEl.options).forEach((opt) => {
          if (opt.value) {
            settings.push({
              type: 'outputSetting',
              namespace: namespace,
              name: opt.textContent,
              value: opt.value,
              selectSelector: selector,
            });
          }
        });
      };
      scrapeSelect('Format', SELECTORS.OUTPUT_FORMAT_SELECT);
      scrapeSelect('Tone', SELECTORS.OUTPUT_TONE_SELECT);
      scrapeSelect('Style', SELECTORS.OUTPUT_WRITING_STYLE_SELECT);
      scrapeSelect('Lang', SELECTORS.OUTPUT_LANGUAGE_SELECT);

      // Click the "Done" button if it exists to properly close the panel, otherwise click body.
      const doneButton = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Done');
      if (doneButton) {
        doneButton.click();
      } else {
        document.body.click();
      }

      await new Promise((r) => setTimeout(r, 50));
      resolve(settings);
    });
  }

  async function getAllOptions() {
    const agents = await scrapeClickableList('Agent', SELECTORS.AGENTS_CATEGORY_BUTTON, SELECTORS.AGENT_LIST_ITEM);
    const prompts = await scrapeClickableList('Prompt', SELECTORS.PROMPTS_CATEGORY_BUTTON, SELECTORS.PROMPT_LIST_ITEM);
    const settings = await scrapeOutputSettings();
    return [...agents, ...prompts, ...settings];
  }

  function filterOptions(options, query) {
    if (!query) return options;
    const lowerCaseQuery = query.toLowerCase();
    return options.filter((option) => `${option.namespace} ${option.name}`.toLowerCase().includes(lowerCaseQuery));
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
    element.onmouseover = () => (element.style.backgroundColor = CONFIG.theme.optionHoverBg);
    element.onmouseout = () => {
      // Revert background only if it's not the currently active item via keyboard selection
      if (element.style.backgroundColor !== CONFIG.theme.activeSelectionBg) {
        element.style.backgroundColor = 'transparent';
      }
    };
  }

  function positionDropdown(dropdown) {
    const chatInput = document.getElementById(CHAT_INPUT_ID);
    if (!chatInput) return;
    const rect = chatInput.getBoundingClientRect();
    dropdown.style.left = `${rect.left}px`;
    dropdown.style.bottom = `${window.innerHeight - rect.top}px`;
    dropdown.style.width = `${rect.width}px`;
  }

  initialize();
})();
