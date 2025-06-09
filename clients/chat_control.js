// ==UserScript==
// @name         TypingMind Command & Patch (Final)
// @namespace    http://tampermonkey.net/
// @version      5.1
// @description  Adds '$' command for Output Settings with context preservation, patches native '@' menu for context preservation, and enables native '/' menu anywhere in chat. Mobile-friendly with touch support.
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
    slashTriggerCharacter: '/',
    theme: {
      dropdownBg: '#2D3748', dropdownBorder: '#4A5568', optionText: '#E2E8F0',
      optionNamespaceText: '#A0AEC0', optionHoverBg: '#4A5568', activeSelectionBg: '#4A5568',
    },
  };

  // --- 2. Hardcoded Mappings for Output Settings ---
  // This is a reliable, high-performance approach that avoids all UI interaction for scraping.
  const MAPPINGS = {
    "Format": {
        "Concise": "Answer as concise as possible", "Step-by-step": "Think step-by-step", "Extreme Detail": "Answer in painstakingly detail",
        "ELI5": "Explain like I'm five", "Essay": "Answer in Essay format", "Report": "Answer in Report format", "Summary": "Answer in Summary format",
        "Table": "Answer in Table format", "FAQ": "Answer in FAQ format", "Listicle": "Answer in Listicle format", "Interview": "Answer in Interview format",
        "Review": "Answer in Review format", "News": "Answer in News format", "Opinion": "Answer in Opinion format", "Tutorial": "Answer in Tutorial format",
        "Case Study": "Answer in Case Study format", "Profile": "Answer in Profile format", "Blog": "Answer in Blog format", "Poem": "Answer in Poem format",
        "Script": "Answer in Script format", "Whitepaper": "Answer in Whitepaper format", "eBook": "Answer in eBook format",
        "Press Release": "Answer in Press Release format", "Infographic": "Answer in Infographic format", "Webinar": "Answer in Webinar format",
        "Podcast Script": "Answer in Podcast Script format", "Email Campaign": "Answer in Email Campaign format", "Social Media Post": "Answer in Social Media Post format",
        "Proposal": "Answer in Proposal format", "Brochure": "Answer in Brochure format", "Newsletter": "Answer in Newsletter format",
        "Presentation": "Answer in Presentation format", "Product Description": "Answer in Product Description format", "Research Paper": "Answer in Research Paper format",
        "Speech": "Answer in Speech format", "Memo": "Answer in Memo format", "Policy Document": "Answer in Policy Document format",
        "User Guide": "Answer in User Guide format", "Technical Documentation": "Answer in Technical Documentation format", "Q&A": "Answer in Q&A format",
    },
    "Tone": {
        "Authoritative": "Authoritative", "Clinical": "Clinical", "Cold": "Cold", "Confident": "Confident", "Cynical": "Cynical",
        "Emotional": "Emotional", "Empathetic": "Empathetic", "Formal": "Formal", "Friendly": "Friendly", "Humorous": "Humorous",
        "Informal": "Informal", "Ironic": "Ironic", "Optimistic": "Optimistic", "Pessimistic": "Pessimistic", "Playful": "Playful",
        "Sarcastic": "Sarcastic", "Serious": "Serious", "Sympathetic": "Sympathetic", "Tentative": "Tentative", "Warm": "Warm",
    },
    "Style": {
        "Academic": "Academic", "Analytical": "Analytical", "Argumentative": "Argumentative", "Conversational": "Conversational",
        "Creative": "Creative", "Critical": "Critical", "Descriptive": "Descriptive", "Epigrammatic": "Epigrammatic",
        "Epistolary": "Epistolary", "Expository": "Expository", "Informative": "Informative", "Instructive": "Instructive",
        "Journalistic": "Journalistic", "Metaphorical": "Metaphorical", "Narrative": "Narrative", "Persuasive": "Persuasive",
        "Poetic": "Poetic", "Satirical": "Satirical", "Technical": "Technical",
    },
    "Language": {
        "English": "English", "Spanish": "Español", "French": "Français", "German": "Deutsch", "Italian": "Italiano", "Portuguese": "Português",
        "Polish": "Polski", "Ukrainian": "Українська", "Somali": "Af Soomaali", "Afrikaans": "Afrikaans", "Azerbaijani": "Azərbaycan dili",
        "Indonesian": "Bahasa Indonesia", "Malaysian Malay": "Bahasa Malaysia", "Malay": "Bahasa Melayu", "Javanese": "Basa Jawa",
        "Sundanese": "Basa Sunda", "Bosnian": "Bosanski jezik", "Catalan": "Català", "Czech": "Čeština", "Chichewa": "Chichewa",
        "Welsh": "Cymraeg", "Danish": "Dansk", "Estonian": "Eesti keel", "English (UK)": "English (UK)", "English (US)": "English (US)",
        "Esperanto": "Esperanto", "Basque": "Euskara", "Irish": "Gaeilge", "Galician": "Galego", "Croatian": "Hrvatski jezik",
        "Xhosa": "isiXhosa", "Zulu": "isiZulu", "Icelandic": "Íslenska", "Swahili": "Kiswahili", "Haitian Creole": "Kreyòl Ayisyen",
        "Kurdish": "Kurdî", "Latin": "Latīna", "Latvian": "Latviešu valoda", "Luxembourgish": "Lëtzebuergesch", "Lithuanian": "Lietuvių kalba",
        "Hungarian": "Magyar", "Malagasy": "Malagasy", "Maltese": "Malti", "Maori": "Māori", "Dutch": "Nederlands", "Norwegian": "Norsk",
        "Uzbek": "O'zbek tili", "Romanian": "Română", "Sesotho": "Sesotho", "Albanian": "Shqip", "Slovak": "Slovenčina",
        "Slovenian": "Slovenščina", "Finnish": "Suomi", "Swedish": "Svenska", "Tagalog": "Tagalog", "Tatar": "Tatarça", "Turkish": "Türkçe",
        "Vietnamese": "Tiếng Việt", "Yoruba": "Yorùbá", "Greek": "Ελληνικά", "Belarusian": "Беларуская мова", "Bulgarian": "Български език",
        "Kyrgyz": "Кыр", "Kazakh": "Қазақ тілі", "Macedonian": "Македонски јазик", "Mongolian": "Монгол хэл", "Russian": "Русский",
        "Serbian": "Српски језик", "Tajik": "Тоҷикӣ", "Georgian": "ქართული", "Armenian": "Հայերեն", "Yiddish": "ייִדיש",
        "Hebrew": "עברית", "Uyghur": "ئۇيغۇرچە", "Urdu": "اردو", "Arabic": "العربية", "Pashto": "پښتو", "Persian": "فارسی",
        "Nepali": "नेपाली", "Marathi": "मराठी", "Hindi": "हिन्दी", "Bengali": "বাংলা", "Punjabi": "ਪੰਜਾਬੀ", "Gujarati": "ગુજરાતી",
        "Oriya": "ଓଡ଼ିଆ", "Tamil": "தமிழ்", "Telugu": "తెలుగు", "Kannada": "ಕನ್ನಡ", "Malayalam": "മലയാളം", "Sinhala": "සිංහල",
        "Thai": "ไทย", "Lao": "ພາສາລາວ", "Burmese": "ဗမာစာ", "Khmer": "ភាសាខ្មែរ", "Korean": "한국어", "Chinese": "中文",
        "Traditional Chinese": "繁體中文", "Japanese": "日本語",
    }
  };



  // --- 3. Script State and Selectors ---
  const SELECTORS = {
    CHAT_INPUT: '#chat-input-textbox',
    NATIVE_AT_MENU_OPTIONS: '[id^="headlessui-combobox-option-"]',
    NATIVE_SLASH_MENU_OPTIONS: '[data-element-id^="search-action-"]', // Native slash menu options
    SEARCH_SHORTCUT_BUTTON: '[data-element-id="search-shortcut-button"]', // The existing search button
  };
  const DROPDOWN_ID = 'tm-patch-dropdown';
  let dropdownVisible = false;
  let activeSelectionIndex = 0;
  let currentOptions = [];
  let originalText = '';
  let allOptionsCache = null;
  let currentChatInput = null; // Track current chat input element
  let chatInputObserver = null; // Observer for chat input monitoring

  async function initialize() {
    console.log('TypingMind Command & Patch Initializing (v5.1)...');
    
    // Set up global event listeners that don't depend on specific elements
    document.addEventListener('click', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    
    // Start monitoring for chat input element
    startChatInputMonitoring();
    
    // Set up native menu patching
    patchNativeMenus();
    
    // Add global test functions for debugging
    window.tmDebug = {
      testContextRestore: () => {
        const testText = "Test context: " + new Date().toISOString();
        localStorage.setItem('tm_slash_context', JSON.stringify({
          text: testText,
          timestamp: Date.now(),
          url: window.location.href
        }));
        console.log('Test context stored:', testText);
        setTimeout(() => {
          checkForStoredContextRestore(currentChatInput);
        }, 100);
      },
      
      showStoredContext: () => {
        const stored = localStorage.getItem('tm_slash_context');
        console.log('Currently stored context:', stored);
        return stored;
      },
      
      clearStoredContext: () => {
         // Clean up any legacy slash context storage
         localStorage.removeItem('tm_slash_context');
         window._beforeSlashText = null;
         console.log('All stored context cleared (slash context preservation disabled)');
       },
       
      getCurrentChatInput: () => {
        console.log('Current chat input:', currentChatInput);
        return currentChatInput;
      },
      
      recheckChatInput: () => {
        console.log('Manually rechecking chat input...');
        attachToCurrentChatInput();
      }
    };
    
    console.log('TypingMind Command & Patch Initialized (v5.1)');
    console.log('Features: $-command (with context), @-menu (with context), /-menu (anywhere, no context preservation)');
    console.log('Now using resilient event listener system');
  }

  function startChatInputMonitoring() {
    // Initial attachment
    attachToCurrentChatInput();
    
    // Set up observer to watch for chat input changes
    if (chatInputObserver) {
      chatInputObserver.disconnect();
    }
    
    chatInputObserver = new MutationObserver(() => {
      // Check if chat input has changed or been recreated
      const newChatInput = document.querySelector(SELECTORS.CHAT_INPUT);
      if (newChatInput && newChatInput !== currentChatInput) {
        console.log('Chat input element changed, re-attaching event listeners');
        attachToCurrentChatInput();
      }
    });
    
    // Observe the entire document for changes
    chatInputObserver.observe(document.body, { 
      childList: true, 
      subtree: true,
      attributes: true,
      attributeFilter: ['id'] // Watch for id changes
    });
  }

  function attachToCurrentChatInput() {
    const chatInput = document.querySelector(SELECTORS.CHAT_INPUT);
    
    if (!chatInput) {
      console.log('Chat input not found, will retry when DOM changes');
      currentChatInput = null;
      return;
    }
    
    if (chatInput === currentChatInput) {
      // Already attached to this element
      return;
    }
    
    // Remove old listeners if they exist
    if (currentChatInput) {
      console.log('Removing old event listeners');
      currentChatInput.removeEventListener('keydown', handleKeyDown, true);
      currentChatInput.removeEventListener('input', handleInput);
    }
    
    // Attach new listeners
    console.log('Attaching event listeners to chat input');
    currentChatInput = chatInput;
    chatInput.addEventListener('keydown', handleKeyDown, true);
    chatInput.addEventListener('input', handleInput);
    
    // Check for stored context restore
    checkForStoredContextRestore(chatInput);
    
    // Set up input monitoring
    setupInputMonitoring(chatInput);
  }
  
  function checkForStoredContextRestore(chatInput) {
    // Slash context preservation disabled - clean up any existing storage
    const storedContext = localStorage.getItem('tm_slash_context');
    if (storedContext) {
      localStorage.removeItem('tm_slash_context');
      console.log('Cleaned up existing slash context storage (feature disabled)');
    }
  }
  
  function setupInputMonitoring(chatInput) {
    // Input monitoring for slash context restoration disabled
    // This function is kept for compatibility but does nothing
    console.log('Input monitoring disabled (slash context preservation disabled)');
  }

  // --- 4. Core Logic ($ Command, / Command & @/# Patch) ---

  function patchNativeMenus() {
    const observer = new MutationObserver(() => {
        // Patch @ menu (agent selector)
        const agentOptions = Array.from(document.querySelectorAll(SELECTORS.NATIVE_AT_MENU_OPTIONS));
        const isAgentMenu = agentOptions.some(opt => opt.textContent.includes('GPT') || opt.textContent.includes('Claude'));
        if (isAgentMenu) {
            agentOptions.forEach((optionNode) => {
                if (optionNode.dataset.patchedAgent) return;
                optionNode.dataset.patchedAgent = 'true';
                optionNode.addEventListener('mousedown', () => {
                    const textToPreserve = currentChatInput ? currentChatInput.value : '';
                    requestAnimationFrame(() => {
                        if (currentChatInput && currentChatInput.value !== textToPreserve) {
                            currentChatInput.value = textToPreserve;
                        }
                    });
                });
            });
        }

        // Patch native / menu (slash commands) - DISABLED for now due to event interception issues
        // The native TypingMind slash menu intercepts our event listeners
        console.log('Slash context preservation temporarily disabled - TypingMind event conflicts');
        
        // Simple logging to show the slash menu is detected but not patched
        const slashOptions = Array.from(document.querySelectorAll(SELECTORS.NATIVE_SLASH_MENU_OPTIONS));
        if (slashOptions.length > 0) {
            console.log(`Found ${slashOptions.length} slash options but skipping patch due to event conflicts`);
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function getOptionsFromMappings() {
      if (allOptionsCache) return allOptionsCache;
      let options = [];
      for (const namespace in MAPPINGS) {
          for (const name in MAPPINGS[namespace]) {
              options.push({ namespace, name, value: MAPPINGS[namespace][name] });
          }
      }
      allOptionsCache = options;
      return options;
  }

  function selectOption(option) {
    if (!option) return;
    if (!currentChatInput) {
      console.warn('No chat input available for option selection');
      return;
    }

    // Build the replacement text, including the rest of the user's prompt
    const replacementText = originalText + option.value + " ";
    
    currentChatInput.value = replacementText;
    
    // Manually trigger input event to ensure UI updates, then focus.
    currentChatInput.dispatchEvent(new Event('input', { bubbles: true }));
    currentChatInput.focus();
    // Move cursor to the end of the newly inserted text.
    requestAnimationFrame(() => {
        currentChatInput.setSelectionRange(replacementText.length, replacementText.length);
    });

    hideDropdown();
  }

  function ensureChatInputValid() {
    // Check if current chat input is still in the DOM
    if (currentChatInput && !document.contains(currentChatInput)) {
      console.log('Current chat input is no longer in DOM, re-attaching...');
      currentChatInput = null;
      attachToCurrentChatInput();
    }
  }

  function handleKeyDown(e) {
    // Ensure we have a valid chat input
    ensureChatInputValid();
    
    // Handle $ trigger
    if (e.key === CONFIG.triggerCharacter && !e.repeat) {
      // Only trigger if this might be a command (not part of normal text)
      const chatInput = e.target;
      const cursorPos = chatInput.selectionStart;
      const textBefore = chatInput.value.substring(0, cursorPos);
      
      // Check if this might be a command trigger
      // Don't trigger if there's text immediately before (no space/start of line)
      const charBefore = textBefore[textBefore.length - 1];
      const shouldTrigger = !charBefore || charBefore === ' ' || charBefore === '\n';
      
      if (shouldTrigger) {
        e.preventDefault();
        document.execCommand('insertText', false, e.key);
      }
    }
    
    // Handle / trigger - click existing search button to open native menu (NO context preservation)
    if (e.key === CONFIG.slashTriggerCharacter && !e.repeat) {
      const chatInput = e.target;
      const cursorPos = chatInput.selectionStart;
      const textBefore = chatInput.value.substring(0, cursorPos);
      
      // Check if this might be a command trigger
      const charBefore = textBefore[textBefore.length - 1];
      const shouldTrigger = !charBefore || charBefore === ' ' || charBefore === '\n';
      
      if (shouldTrigger) {
        e.preventDefault();
        
        console.log('Slash trigger detected - opening native menu (no context preservation)');
        
        // Click the existing search shortcut button to open the native menu
        const searchButton = document.querySelector(SELECTORS.SEARCH_SHORTCUT_BUTTON);
        if (searchButton) {
          console.log('Clicking search button to open native menu');
          searchButton.click();
        } else {
          console.log('Search button not found, fallback to normal slash');
          // Fallback: just insert the slash normally if button not found
          document.execCommand('insertText', false, '/');
        }
      }
    }
    
    // Note: Escape key handling for slash menu not needed (no context preservation)
    
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

  // --- 5. Standard Helper & UI Functions ---

  function handleInput(e) {
    // Ensure we have a valid chat input
    ensureChatInputValid();
    
    const text = e.target.value;
    const cursorPos = e.target.selectionStart;
    const triggerIndex = text.lastIndexOf(CONFIG.triggerCharacter, cursorPos - 1);
    
    if (triggerIndex !== -1) {
      // Check if this is a valid trigger context
      const charBefore = triggerIndex > 0 ? text[triggerIndex - 1] : '';
      const isValidContext = !charBefore || charBefore === ' ' || charBefore === '\n';
      
      if (isValidContext) {
        const textAfterTrigger = text.substring(triggerIndex + 1, cursorPos);
        const hasSpaceAfter = textAfterTrigger.includes(' ') || textAfterTrigger.includes('\n');
        
        if (!hasSpaceAfter) {
          originalText = text.substring(0, triggerIndex);
          showDropdown(textAfterTrigger);
          return;
        }
      }
    }
    
    hideDropdown();
  }

  function handleClickOutside(e) {
    const dropdown = document.getElementById(DROPDOWN_ID);
    if (dropdown && !dropdown.contains(e.target)) hideDropdown();
    
    // Note: Slash menu dismissal handling not needed (no context preservation)
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
      optionElement.innerHTML = `<span style="color: ${CONFIG.theme.optionNamespaceText}; margin-right: 8px;">$ ${option.namespace}</span> <span style="color: ${CONFIG.theme.optionText};">${option.name}</span>`;
      styleOptionElement(optionElement);
      
      // Store option data on element for easy access
      optionElement._optionData = option;
      optionElement._optionIndex = index;
      
      // Desktop hover interaction
      optionElement.addEventListener('mouseover', () => {
        activeSelectionIndex = index;
        updateDropdownSelection();
      });
      
      // Click handling - simplified approach
      optionElement.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        activeSelectionIndex = index;
        selectOption(option);
      });
      
      // Touch handling for mobile
      optionElement.addEventListener('touchstart', (e) => {
        e.preventDefault();
        activeSelectionIndex = index;
        updateDropdownSelection();
      });
      
      optionElement.addEventListener('touchend', (e) => {
        e.preventDefault();
        e.stopPropagation();
        selectOption(option);
      });
      
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
      // Mobile-friendly touch scrolling
      WebkitOverflowScrolling: 'touch',
      // Prevent text selection on mobile
      userSelect: 'none',
      WebkitUserSelect: 'none',
    });
  }

  function styleOptionElement(element) {
    Object.assign(element.style, {
      padding: '12px 16px', cursor: 'pointer', fontSize: '14px',
      borderBottom: `1px solid ${CONFIG.theme.dropdownBorder}`, color: CONFIG.theme.optionText, backgroundColor: 'transparent',
      // Mobile-friendly touch targets
      minHeight: '44px', display: 'flex', alignItems: 'center',
      // Prevent text selection
      userSelect: 'none', WebkitUserSelect: 'none',
      // Smooth transitions
      transition: 'background-color 0.15s ease',
    });
  }

  function positionDropdown(dropdown) {
    if (!currentChatInput) return;
    const rect = currentChatInput.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    
    // Calculate available space above and below
    const spaceAbove = rect.top;
    const spaceBelow = viewportHeight - rect.bottom;
    
    // Position dropdown above input (default behavior)
    dropdown.style.left = `${Math.max(8, rect.left)}px`;
    dropdown.style.bottom = `${viewportHeight - rect.top + 8}px`;
    
    // Adjust width for mobile screens
    const maxWidth = Math.min(rect.width, viewportWidth - 16);
    dropdown.style.width = `${maxWidth}px`;
    
    // If on mobile and space is limited, position below instead
    if (viewportWidth <= 768 && spaceAbove < 200 && spaceBelow > spaceAbove) {
      dropdown.style.bottom = 'auto';
      dropdown.style.top = `${rect.bottom + 8}px`;
    }
    
    // Ensure dropdown doesn't go off-screen horizontally
    const rightEdge = rect.left + maxWidth;
    if (rightEdge > viewportWidth - 8) {
      dropdown.style.left = `${viewportWidth - maxWidth - 8}px`;
    }
  }

      initialize();
})(); 