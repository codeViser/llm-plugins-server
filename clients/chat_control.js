// ==UserScript==
// @name         TypingMind Universal @ Selector (FINAL)
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Adds a universal, keyboard-navigable @ selector for agents, prompts, and settings in TypingMind, without clearing the chat input.
// @author       AI Assistant & User Collaboration
// @match        https://*.typingmind.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // --- Configuration ---
  // All selectors have been filled based on the provided HTML.
  const SELECTORS = {
    SHORTCUTS_MENU_BUTTON: 'button[data-element-id="search-shortcut-button"]',

    AGENTS_CATEGORY_BUTTON: 'div[data-element-id="search-action-open-ai-characters"]',
    // NOTE: The agent items are inside a combobox. This selector targets the options that appear.
    AGENT_LIST_ITEM: '[id^="headlessui-combobox-option-"]',

    PROMPTS_CATEGORY_BUTTON: 'div[data-element-id="search-action-open-prompt-library"]',
    PROMPT_LIST_ITEM: 'div[data-element-id="prompt-library-one-prompt-block"]',

    OUTPUT_SETTINGS_CATEGORY_BUTTON: 'div[data-element-id="search-action-open-output-settings"]',
    // Individual selectors for each dropdown menu in the output settings panel.
    OUTPUT_FORMAT_SELECT: 'select[data-element-id="output-format-setting-options"]',
    OUTPUT_TONE_SELECT: 'select[data-element-id="output-tone-setting-options"]',
    OUTPUT_WRITING_STYLE_SELECT: 'select[data-element-id="output-writing-setting-options"]',
    OUTPUT_LANGUAGE_SELECT: 'select[data-element-id="output-language-setting-options"]',
  };
  // --- End of Configuration ---

  // --- Core Script (No changes needed below this line) ---
  const CHAT_INPUT_ID = 'chat-input-textbox';
  const DROPDOWN_ID = 'universal-at-selector-dropdown';

  let dropdownVisible = false;
  let activeSelectionIndex = 0;
  let currentOptions = [];
  let originalText = '';

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
    const atIndex = text.lastIndexOf('@');
    if (atIndex !== -1) {
      originalText = text.substring(0, atIndex);
      showDropdown(text.substring(atIndex + 1));
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
    const options = await getAllOptions();
    currentOptions = filterOptions(options, query);
    activeSelectionIndex = 0;

    if (currentOptions.length > 0) {
      renderOptions(dropdown, currentOptions);
      positionDropdown(dropdown);
      dropdown.style.display = 'block';
      dropdownVisible = true;
    } else {
      hideDropdown();
    }
  }

  function hideDropdown() {
    const dropdown = document.getElementById(DROPDOWN_ID);
    if (dropdown) dropdown.style.display = 'none';
    dropdownVisible = false;
  }

  function updateDropdownSelection() {
    const dropdown = document.getElementById(DROPDOWN_ID);
    for (let i = 0; i < dropdown.children.length; i++) {
      dropdown.children[i].style.backgroundColor = i === activeSelectionIndex ? '#e0e0e0' : 'white';
    }
  }

  function renderOptions(dropdown, options) {
    dropdown.innerHTML = '';
    options.forEach((option, index) => {
      const optionElement = document.createElement('div');
      optionElement.innerHTML = `<span style="color: #888; margin-right: 8px;">${option.namespace}</span> ${option.name}`;
      styleOptionElement(optionElement);
      if (index === activeSelectionIndex) optionElement.style.backgroundColor = '#e0e0e0';
      optionElement.addEventListener('mouseover', () => {
        activeSelectionIndex = index;
        updateDropdownSelection();
      });
      optionElement.addEventListener('click', () => selectOption(option));
      dropdown.appendChild(optionElement);
    });
  }

  /**
   * Intelligently selects an option based on its type (Agent, Prompt, or Setting).
   */
  async function selectOption(option) {
    if (!option) return;

    // Open the main shortcuts menu first for all types.
    const shortcutsButton = document.querySelector(SELECTORS.SHORTCUTS_MENU_BUTTON);
    if (!shortcutsButton) return;
    shortcutsButton.click();
    await new Promise((r) => setTimeout(r, 100)); // Wait for menu

    // --- Logic for standard list items (Agents, Prompts) ---
    if (option.type === 'listItem') {
      const categoryButton = document.querySelector(option.categoryButtonSelector);
      if (categoryButton) {
        categoryButton.click();
        await new Promise((r) => setTimeout(r, 100)); // Wait for final list

        const allItems = document.querySelectorAll(option.finalItemSelector);
        const targetItem = Array.from(allItems).find((item) => item.textContent.includes(option.name));

        if (targetItem) {
          targetItem.click();
        } else {
          console.warn('TypingMind Extension: Could not find final item named:', option.name);
          document.body.click(); // Close menus
        }
      }
      // --- Logic for Output Settings (<select> dropdowns) ---
    } else if (option.type === 'outputSetting') {
      const categoryButton = document.querySelector(SELECTORS.OUTPUT_SETTINGS_CATEGORY_BUTTON);
      if (categoryButton) {
        categoryButton.click();
        await new Promise((r) => setTimeout(r, 100)); // Wait for settings panel

        const selectElement = document.querySelector(option.selectSelector);
        if (selectElement) {
          selectElement.value = option.value;
          // Dispatch 'change' event to notify the web application's framework (e.g., React)
          selectElement.dispatchEvent(new Event('change', { bubbles: true }));
        }
        // Find and click the "Done" button to close the panel
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

  // --- Data Scraping Functions ---

  /**
   * Scrapes standard list items after a two-click sequence.
   */
  function scrapeClickableList(namespace, categoryButtonSelector, finalItemSelector) {
    return new Promise(async (resolve) => {
      const shortcutsButton = document.querySelector(SELECTORS.SHORTCUTS_MENU_BUTTON);
      if (!shortcutsButton) return resolve([]);

      shortcutsButton.click();
      await new Promise((r) => setTimeout(r, 100));

      const categoryButton = document.querySelector(categoryButtonSelector);
      if (!categoryButton) {
        document.body.click();
        return resolve([]);
      }
      categoryButton.click();
      await new Promise((r) => setTimeout(r, 100));

      const items = Array.from(document.querySelectorAll(finalItemSelector)).map((item) => ({
        type: 'listItem',
        namespace: namespace,
        name: item.textContent.trim().split('\n')[0], // Get first line of text
        categoryButtonSelector: categoryButtonSelector,
        finalItemSelector: finalItemSelector,
      }));

      document.body.click(); // Close menus
      await new Promise((r) => setTimeout(r, 50));
      resolve(items);
    });
  }

  /**
   * Scrapes all the <option> values from the four <select> dropdowns in the Output Settings panel.
   */
  function scrapeOutputSettings() {
    return new Promise(async (resolve) => {
      const shortcutsButton = document.querySelector(SELECTORS.SHORTCUTS_MENU_BUTTON);
      if (!shortcutsButton) return resolve([]);

      shortcutsButton.click();
      await new Promise((r) => setTimeout(r, 100));

      const categoryButton = document.querySelector(SELECTORS.OUTPUT_SETTINGS_CATEGORY_BUTTON);
      if (!categoryButton) {
        document.body.click();
        return resolve([]);
      }
      categoryButton.click();
      await new Promise((r) => setTimeout(r, 100));

      const settings = [];
      const scrapeSelect = (namespace, selector) => {
        const selectEl = document.querySelector(selector);
        if (!selectEl) return;
        Array.from(selectEl.options).forEach((opt) => {
          if (opt.value) {
            // Ignore default/empty options
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

      document.body.click(); // Close menus
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

  // --- UI Styling and Positioning ---
  function styleDropdown(dropdown) {
    Object.assign(dropdown.style, {
      position: 'absolute',
      backgroundColor: 'white',
      border: '1px solid #ccc',
      borderRadius: '8px',
      zIndex: '10001',
      maxHeight: '300px',
      overflowY: 'auto',
      boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
      display: 'none',
    });
  }

  function styleOptionElement(element) {
    Object.assign(element.style, {
      padding: '10px 12px',
      cursor: 'pointer',
      fontSize: '14px',
      borderBottom: '1px solid #f0f0f0',
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

  initialize();
})();
