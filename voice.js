(() => {
  "use strict";

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const consentKey = "manullern_voice_notice_v1";
  const appRoot = document.getElementById("app");
  let active = null;

  function setFeedback(feedback, message, kind = "good") {
    if (!feedback) return;
    feedback.className = `feedback ${kind}`;
    feedback.style.display = "block";
    feedback.textContent = message;
  }

  function resetButton(button) {
    if (!button) return;
    button.textContent = "🎤 Ответить голосом";
    button.setAttribute("aria-pressed", "false");
  }

  function cancelActive() {
    if (!active) return;
    const { recognition, button } = active;
    active = null;
    try { recognition.abort(); } catch {}
    resetButton(button);
  }

  function markVoiceButtons(scope = document) {
    if (!scope?.querySelectorAll) return;
    scope.querySelectorAll("button").forEach(button => {
      if (button.dataset.voiceInput === "1") return;
      if (button.textContent.trim() !== "🎤 Голосовой набор") return;
      button.dataset.voiceInput = "1";
      button.type = "button";
      button.textContent = "🎤 Ответить голосом";
      button.title = "Нажми и говори по-немецки";
      button.setAttribute("aria-pressed", "false");
    });
  }

  function voiceConsentGranted() {
    try {
      if (localStorage.getItem(consentKey) === "accepted") return true;
    } catch {}

    const ok = window.confirm(
      "Голосовой ввод использует службу распознавания речи браузера/ОС. " +
      "Аудио может обрабатываться внешним поставщиком, и для распознавания может требоваться интернет. " +
      "ManuLLern не сохраняет голосовую запись. Продолжить?"
    );

    if (ok) {
      try { localStorage.setItem(consentKey, "accepted"); } catch {}
    }
    return ok;
  }

  function startVoiceInput(button) {
    const task = button.closest(".task");
    const textarea = task?.querySelector("textarea");
    const feedback = task?.querySelector(".feedback");
    if (!textarea) return;

    if (active?.button === button) {
      try { active.recognition.stop(); } catch {}
      return;
    }

    cancelActive();

    if (!SpeechRecognition) {
      textarea.focus();
      setFeedback(
        feedback,
        "В этом браузере встроенное распознавание речи недоступно. Можно использовать микрофон клавиатуры.",
        "near"
      );
      return;
    }

    if (!voiceConsentGranted()) {
      setFeedback(feedback, "Голосовой ввод не включён. Ответ можно напечатать вручную.", "near");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "de-DE";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    let finalText = "";
    let heardAnything = false;
    let hadError = false;
    active = { recognition, button };

    recognition.onstart = () => {
      button.textContent = "🛑 Стоп";
      button.setAttribute("aria-pressed", "true");
      setFeedback(feedback, "Слушаю по-немецки… Говори обычным голосом.", "good");
    };

    recognition.onresult = event => {
      let interimText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0]?.transcript || "";
        if (!transcript) continue;
        heardAnything = true;
        if (event.results[i].isFinal) finalText += `${transcript} `;
        else interimText += transcript;
      }
      textarea.value = `${finalText}${interimText}`.trim();
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    };

    recognition.onerror = event => {
      hadError = true;
      let message = "Не удалось распознать речь. Попробуй ещё раз.";
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        message = "Нет доступа к микрофону. Разреши микрофон для ManuLLern/Chrome в настройках сайта или приложения.";
      } else if (event.error === "no-speech") {
        message = "Не расслышал речь. Нажми микрофон ещё раз и говори после сигнала.";
      } else if (event.error === "audio-capture") {
        message = "Микрофон сейчас недоступен другому приложению или браузеру.";
      } else if (event.error === "network") {
        message = "Службе распознавания речи сейчас нужен интернет или она недоступна. Текстовый ответ продолжает работать офлайн.";
      }
      setFeedback(feedback, message, "wrong");
    };

    recognition.onend = () => {
      if (active?.recognition === recognition) active = null;
      resetButton(button);
      if (hadError) return;
      if (heardAnything && textarea.value.trim()) {
        setFeedback(feedback, "Готово. Проверь распознанный текст и нажми «Проверить».", "good");
      } else {
        setFeedback(feedback, "Речь не распознана. Нажми микрофон и попробуй ещё раз.", "near");
      }
    };

    try {
      recognition.start();
    } catch {
      active = null;
      resetButton(button);
      setFeedback(feedback, "Не удалось запустить микрофон. Попробуй ещё раз через секунду.", "wrong");
    }
  }

  document.addEventListener("click", event => {
    const button = event.target.closest?.("button[data-voice-input='1']");
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    startVoiceInput(button);
  }, true);

  markVoiceButtons(document);

  if (appRoot) {
    new MutationObserver(mutations => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.matches?.("button")) markVoiceButtons(node.parentElement || node);
            else markVoiceButtons(node);
          }
        }
      }
      if (active && !document.body.contains(active.button)) cancelActive();
    }).observe(appRoot, { childList: true, subtree: true });
  }

  window.addEventListener("pagehide", cancelActive);
})();