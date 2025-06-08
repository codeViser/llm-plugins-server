// ==UserScript==
// @name         TypingMind Command & Patch (Final)
// @namespace    http://tampermonkey.net/
// @version      4.4
// @description  Adds a '$' command, and patches '@'/'/' menus. Triggers are event-driven to distinguish between typing and pasting.
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
      dropdownBg: '#2D3748', dropdownBorder: '#4A5568', optionText: '#E2E8F0',
      optionNamespaceText: '#A0AEC0', optionHoverBg: '#4A5568', activeSelectionBg: '#4A5568',
    },
  };

  // --- 2. Hardcoded Mappings for Output Settings ---
  const MAPPINGS = {
    "Format": {
        "Concise": "Answer as concise as possible", "Step-by-step": "Think step-by-step", "Extreme Detail": "Answer in painstakingly detail", "ELI5": "Explain like I'm five", "Essay": "Answer in Essay format", "Report": "Answer in Report format", "Summary": "Answer in Summary format", "Table": "Answer in Table format", "FAQ": "Answer in FAQ format", "Listicle": "Answer in Listicle format", "Interview": "Answer in Interview format", "Review": "Answer in Review format", "News": "Answer in News format", "Opinion": "Answer in Opinion format", "Tutorial": "Answer in Tutorial format", "Case Study": "Answer in Case Study format", "Profile": "Answer in Profile format", "Blog": "Answer in Blog format", "Poem": "Answer in Poem format", "Script": "Answer in Script format", "Whitepaper": "Answer in Whitepaper format", "eBook": "Answer in eBook format", "Press Release": "Answer in Press Release format", "Infographic": "Answer in Infographic format", "Webinar": "Answer in Webinar format", "Podcast Script": "Answer in Podcast Script format", "Email Campaign": "Answer in Email Campaign format", "Social Media Post": "Answer in Social Media Post format", "Proposal": "Answer in Proposal format", "Brochure": "Answer in Brochure format", "Newsletter": "Answer in Newsletter format", "Presentation": "Answer in Presentation format", "Product Description": "Answer in Product Description format", "Research Paper": "Answer in Research Paper format", "Speech": "Answer in Speech format", "Memo": "Answer in Memo format", "Policy Document": "Answer in Policy Document format", "User Guide": "Answer in User Guide format", "Technical Documentation": "Answer in Technical Documentation format", "Q&A": "Answer in Q&A format",
    },
    "Tone": {
        "Authoritative": "Authoritative", "Clinical": "Clinical", "Cold": "Cold", "Confident": "Confident", "Cynical": "Cynical", "Emotional": "Emotional", "Empathetic": "Empathetic", "Formal": "Formal", "Friendly": "Friendly", "Humorous": "Humorous", "Informal": "Informal", "Ironic": "Ironic", "Optimistic": "Optimistic", "Pessimistic": "Pessimistic", "Playful": "Playful", "Sarcastic": "Sarcastic", "Serious": "Serious", "Sympathetic": "Sympathetic", "Tentative": "Tentative", "Warm": "Warm",
    },
    "Style": {
        "Academic": "Academic", "Analytical": "Analytical", "Argumentative": "Argumentative", "Conversational": "Conversational", "Creative": "Creative", "Critical": "Critical", "Descriptive": "Descriptive", "Epigrammatic": "Epigrammatic", "Epistolary": "Epistolary", "Expository": "Expository", "Informative": "Informative", "Instructive": "Instructive", "Journalistic": "Journalistic", "Metaphorical": "Metaphorical", "Narrative": "Narrative", "Persuasive": "Persuasive", "Poetic": "Poetic", "Satirical": "Satirical", "Technical": "Technical",
    },
    "Language": {
        "English": "English", "Spanish": "Español", "French": "Français", "German": "Deutsch", "Italian": "Italiano", "Portuguese": "Português", "Polish": "Polski", "Ukrainian": "Українська", "Somali": "Af Soomaali", "Afrikaans": "Afrikaans", "Azerbaijani": "Azərbaycan dili", "Indonesian": "Bahasa Indonesia", "Malaysian Malay": "Bahasa Malaysia", "Malay": "Bahasa Melayu", "Javanese": "Basa Jawa", "Sundanese": "Basa Sunda", "Bosnian": "Bosanski jezik", "Catalan": "Català", "Czech": "Čeština", "Chichewa": "Chichewa", "Welsh": "Cymraeg", "Danish": "Dansk", "Estonian": "Eesti keel", "English (UK)": "English (UK)", "English (US)": "English (US)", "Esperanto": "Esperanto", "Basque": "Euskara", "Irish": "Gaeilge", "Galician": "Galego", "Croatian": "Hrvatski jezik", "Xhosa": "isiXhosa", "Zulu": "isiZulu", "Icelandic": "Íslenska", "Swahili": "Kiswahili", "Haitian Creole": "Kreyòl Ayisyen", "Kurdish": "Kurdî", "Latin": "Latīna", "Latvian": "Latviešu valoda", "Luxembourgish": "Lëtzebuergesch", "Lithuanian": "Lietuvių kalba", "Hungarian": "Magyar", "Malagasy": "Malagasy", "Maltese": "Malti", "Maori": "Māori", "Dutch": "Nederlands", "Norwegian": "Norsk", "Uzbek": "O'zbek tili", "Romanian": "Română", "Sesotho": "Sesotho", "Albanian": "Shqip", "Slovak": "Slovenčina", "Slovenian": "Slovenščina", "Finnish": "Suomi", "Swedish": "Svenska", "Tagalog": "Tagalog", "Tatar": "Tatarça", "Turkish": "Türkçe", "Vietnamese": "Tiếng Việt", "Yoruba": "Yorùbá", "Greek": "Ελληνικά", "Belarusian": "Беларуская мова", "Bulgarian": "Български език", "Kyrgyz": "Кыр", "Kazakh": "Қазақ тілі", "Macedonian": "Македонски јазик", "Mongolian": "Монгол хэл", "Russian": "Русский", "Serbian": "Српски језик", "Tajik": "Тоҷикӣ", "Georgian": "ქართული", "Armenian": "Հայերեն", "Yiddish": "ייִדיש", "Hebrew": "עברית", "Uyghur": "ئۇيغۇرچە", "Urdu": "اردو", "Arabic": "العربية", "Pashto": "پښتو", "Persian": "فارسی", "Nepali": "नेपाली", "Marathi": "मराठी", "Hindi": "हिन्दी", "Bengali": "বাংলা", "Punjabi": "ਪੰਜਾਬੀ", "Gujarati": "ગુજરાતી", "Oriya": "ଓଡ଼ିଆ", "Tamil": "தமிழ்", "Telugu": "తెలుగు", "Kannada": "ಕನ್ನಡ", "Malayalam": "മലയാളം", "Sinhala": "සිංහල", "Thai": "ไทย", "Lao": "ພາສາລາວ", "Burmese": "ဗမာစာ", "Khmer": "ភាសាខ្មែរ", "Korean": "한국어", "Chinese": "中文", "Traditional Chinese": "繁體中文", "Japanese": "日本語",
    }
  };

  // --- 3. Script State and Selectors ---
  const SELECTORS = {
    CHAT_INPUT: '#chat-input-textbox',
    NATIVE_MENU_OPTIONS: '[id^="headlessui-combobox-option-"]', // Generic selector for both @ and / menus
  };
  const DROPDOWN_ID = 'tm-patch-dropdown';
  let dropdownVisible = false;
  let activeSelectionIndex = 0;
  let currentOptions = [];
  let originalText = '';
  let allOptionsCache = null;
  let wasTriggeredByTyping = false; // The new flag to distinguish typing vs. pasting

  async function initialize() {
    const chatInput = await waitForElement(SELECTORS.CHAT_INPUT);
    if (!chatInput) return;
    chatInput.addEventListener('keydown', handleKeyDown, true);
    chatInput.addEventListener('input', handleInput, true); // Use capture to run before the app
    chatInput.addEventListener('paste', handlePaste, true);
    document.addEventListener('click', handleClickOutside);
    patchNativeMenus(chatInput);
    console.log('TypingMind Command & Patch Initialized (v4.4)');
  }

  // --- 4. Core Logic & Event Handling ---

  function patchNativeMenus(chatInput) {
    const observer = new MutationObserver(() => {
        const nativeOptions = Array.from(document.querySelectorAll(SELECTORS.NATIVE_MENU_OPTIONS));
        if (nativeOptions.length === 0) return;

        // Differentiate between @ and / menus based on content
        const isAgentMenu = nativeOptions.some(opt => opt.textContent.includes('GPT') || opt.textContent.includes('Claude'));
        const isSlashMenu = !isAgentMenu && nativeOptions.some(opt => opt.querySelector('svg'));

        if (isAgentMenu || isSlashMenu) {
            nativeOptions.forEach((optionNode) => {
                if (optionNode.dataset.patched) return;
                optionNode.dataset.patched = 'true';
                optionNode.addEventListener('mousedown', () => {
                    const textToPreserve = chatInput.value;
                    const triggerChar = isAgentMenu ? '@' : '/';
                    const triggerIndex = textToPreserve.lastIndexOf(triggerChar);

                    // Only preserve text before the trigger
                    const textBeforeTrigger = triggerIndex !== -1 ? textToPreserve.substring(0, triggerIndex) : textToPreserve;

                    requestAnimationFrame(() => {
                        // The app's default action might leave the selected item's text, or clear it.
                        // We want to prepend our preserved text to whatever the app does.
                        const currentText = chatInput.value;
                        if (!currentText.startsWith(textBeforeTrigger)) {
                           chatInput.value = textBeforeTrigger + currentText;
                        }
                    });
                });
            });
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function getOptionsFromMappings() {
      if (allOptionsCache) return allOptionsCache;
      allOptionsCache = Object.entries(MAPPINGS).flatMap(([namespace, options]) =>
        Object.entries(options).map(([name, value]) => ({ namespace, name, value }))
      );
      return allOptionsCache;
  }

  function selectOption(option) {
    if (!option) return;
    const chatInput = document.querySelector(SELECTORS.CHAT_INPUT);
    if (!chatInput) return;
    
    // Replace the trigger and query with the selected command's text value
    chatInput.value = originalText + option.value + " ";
    
    chatInput.dispatchEvent(new Event('input', { bubbles: true }));
    chatInput.focus();
    requestAnimationFrame(() => {
        chatInput.setSelectionRange(chatInput.value.length, chatInput.value.length);
    });

    hideDropdown();
  }

  function handleKeyDown(e) {
    // This is the new gatekeeper. It checks if a trigger was *manually typed*.
    const triggerChars = [CONFIG.triggerCharacter, '@', '/'];
    if (triggerChars.includes(e.key) && !e.repeat) {
        // If the typed key is our special '$' command, we prevent default to manage it ourselves
        // and set a flag for the 'input' event listener.
        if (e.key === CONFIG.triggerCharacter) {
            e.preventDefault();
            wasTriggeredByTyping = true; // Set the flag
            document.execCommand('insertText', false, CONFIG.triggerCharacter);
        } else {
            // For native '@' and '/' commands, we don't prevent default, but we can still
            // let our input handler know a trigger was just typed if we needed to.
            // For now, only the '$' command needs this special flag.
            wasTriggeredByTyping = false;
        }
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

  function handlePaste() {
      // If a paste occurs, we know any trigger character that appears was not typed.
      wasTriggeredByTyping = false;
  }

  function handleInput(e) {
    // For our '$' command, we only proceed if our keydown listener flagged it as intentional typing.
    if (wasTriggeredByTyping) {
        const text = e.target.value;
        const triggerIndex = text.lastIndexOf(CONFIG.triggerCharacter);
        if (triggerIndex !== -1) {
            const query = text.substring(triggerIndex + 1);
            originalText = text.substring(0, triggerIndex);
            showDropdown(query);
        }
        // Reset the flag immediately after processing.
        wasTriggeredByTyping = false;
    } else {
        // If not triggered by our keydown, check if it's a native command we should not show our menu for.
        const text = e.target.value;
        const lastChar = text.trim().slice(-1);
        if (lastChar !== CONFIG.triggerCharacter) {
             hideDropdown();
        }
    }
  }

  function handleClickOutside(e) {
    const dropdown = document.getElementById(DROPDOWN_ID);
    if (dropdown && !dropdown.contains(e.target)) hideDropdown();
  }

  function showDropdown(query) {
    let dropdown = document.getElementById(DROPDOWN_ID);
    if (!dropdown) {
      dropdown = document.createElement('div');
      dropdown.id = DROPDOWN_ID;
      styleDropdown(dropdown);
      document.body.appendChild(dropdown);
    }
    const options = getOptionsFromMappings();
    currentOptions = filterOptions(options, query);
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
  }

  function filterOptions(options, query) {
    if (!query) return options;
    const lowerCaseQuery = query.toLowerCase();
    return options.filter((option) => `${option.namespace} ${option.name}`.toLowerCase().includes(lowerCaseQuery));
  }

  function updateDropdownSelection() {
    const dropdown = document.getElementById(DROPDOWN_ID);
    Array.from(dropdown.children).forEach((child, index) => {
        child.style.backgroundColor = index === activeSelectionIndex ? CONFIG.theme.activeSelectionBg : 'transparent';
    });
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
      borderRadius: '8px', zIndex: '99999', maxHeight: '300px',
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
