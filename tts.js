(() => {
  "use strict";

  if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) return;

  let preferredGermanVoice = null;

  function scoreVoice(voice) {
    const lang = String(voice.lang || "").toLowerCase();
    const name = String(voice.name || "").toLowerCase();
    let score = 0;

    if (lang === "de-de") score += 120;
    else if (lang.startsWith("de-")) score += 95;
    else if (lang === "de") score += 80;
    else if (lang.startsWith("de")) score += 65;
    else return -1000;

    // Prefer voices that can stay on-device when the browser exposes this flag.
    if (voice.localService === true) score += 35;

    // Prefer higher-quality variants when the OS/browser names them explicitly.
    if (name.includes("natural")) score += 30;
    if (name.includes("neural")) score += 28;
    if (name.includes("premium")) score += 24;
    if (name.includes("enhanced")) score += 20;
    if (name.includes("deutsch")) score += 8;
    if (voice.default) score += 5;

    return score;
  }

  function chooseGermanVoice() {
    const voices = speechSynthesis.getVoices();
    if (!voices.length) return null;

    const ranked = voices
      .map(voice => ({ voice, score: scoreVoice(voice) }))
      .filter(item => item.score > -1000)
      .sort((a, b) => b.score - a.score);

    return ranked[0]?.voice || null;
  }

  function refreshVoice() {
    preferredGermanVoice = chooseGermanVoice();
  }

  refreshVoice();
  speechSynthesis.addEventListener?.("voiceschanged", refreshVoice);

  window.speakDE = function speakDEImproved(text) {
    if (!("speechSynthesis" in window)) {
      alert("Озвучивание не поддерживается этим браузером.");
      return;
    }

    speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(String(text || ""));
    utterance.lang = "de-DE";
    // Slightly calmer than default, without making speech unnaturally slow.
    utterance.rate = 0.94;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;

    const voice = preferredGermanVoice || chooseGermanVoice();
    if (voice) utterance.voice = voice;

    speechSynthesis.speak(utterance);
  };
})();