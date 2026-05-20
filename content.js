(() => {
  "use strict";

  const EXT_ROOT_CLASS = "codex-usage-pace";
  const EXT_CARD_ATTR = "data-codex-usage-pace-card";
  const SCAN_DEBOUNCE_MS = 150;
  const REFRESH_MS = 60 * 1000;

  const TARGETS = [
    {
      id: "five-hour-limit",
      title: "5時間の使用制限",
      periodMs: 5 * 60 * 60 * 1000,
      kind: "hours",
    },
    {
      id: "weekly-limit",
      title: "週あたりの使用制限",
      aliases: ["1週間の使用上限"],
      periodMs: 7 * 24 * 60 * 60 * 1000,
      kind: "week",
    },
  ];

  const EXCLUDED_TITLES = ["残りのクレジット", "自動チャージ", "コードレビュータブ"];

  let scanTimer = null;

  function scheduleScan() {
    window.clearTimeout(scanTimer);
    scanTimer = window.setTimeout(scan, SCAN_DEBOUNCE_MS);
  }

  function scan() {
    for (const target of TARGETS) {
      const cards = findLimitCards(target);
      for (const card of cards) {
        renderIntoCard(card, target);
      }
    }
  }

  function findLimitCards(target) {
    const titles = getTargetTitles(target);
    const titleNodes = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6,p,span,div"))
      .filter((node) => titles.includes(normalizeText(node.textContent)));

    const cards = [];
    for (const titleNode of titleNodes) {
      const matchedTitle = normalizeText(titleNode.textContent);
      const card = findCardContainer(titleNode, matchedTitle);
      if (!card || cards.includes(card)) continue;

      const cardText = normalizeText(card.textContent);
      if (!titles.some((title) => cardText.includes(title))) continue;
      if (EXCLUDED_TITLES.some((title) => title !== target.title && cardText.includes(title))) continue;

      cards.push(card);
    }

    return cards;
  }

  function getTargetTitles(target) {
    return [target.title].concat(target.aliases || []);
  }

  function findCardContainer(startNode, title) {
    let node = startNode;
    for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
      if (!(node instanceof HTMLElement)) continue;

      const text = normalizeText(node.textContent);
      if (!text.includes(title)) continue;
      if (!/%\s*残り/.test(text)) continue;
      if (findResetDate(node, Date.now())) return node;

      const ariaRole = node.getAttribute("role");
      const className = String(node.className || "");
      const looksLikeCard =
        ariaRole === "article" ||
        ariaRole === "group" ||
        /card|panel|rounded|border|shadow|surface/i.test(className);

      if (looksLikeCard) return node;
    }

    return startNode.closest("section,article,[role='article'],[role='group']") || startNode.parentElement;
  }

  function renderIntoCard(card, target) {
    const now = Date.now();
    const data = readUsageData(card, target, now);
    let root = card.querySelector(`:scope > .${EXT_ROOT_CLASS}`);

    if (!data) {
      if (root) root.remove();
      card.removeAttribute(EXT_CARD_ATTR);
      return;
    }

    if (!root) {
      root = document.createElement("div");
      root.className = EXT_ROOT_CLASS;
      card.append(root);
    }

    card.setAttribute(EXT_CARD_ATTR, target.id);
    root.innerHTML = buildUi(data);
  }

  function readUsageData(card, target, now) {
    const remainingPercent = readRemainingPercent(card);
    const resetAt = findResetDate(card, now);
    if (remainingPercent === null || !resetAt) return null;

    const usedPercent = clamp(100 - remainingPercent, 0, 100);
    const startAt = resetAt.getTime() - target.periodMs;
    const elapsedPercent = clamp(((now - startAt) / target.periodMs) * 100, 0, 100);
    const diff = usedPercent - elapsedPercent;
    const pace = judgePace(diff);
    const remainingMs = Math.max(resetAt.getTime() - now, 0);

    return {
      id: target.id,
      title: target.title,
      kind: target.kind,
      usedPercent,
      elapsedPercent,
      diff,
      pace,
      remainingText: formatRemaining(remainingMs, target.kind),
      dailyAllowance: target.kind === "week" ? calculateTodayAllowance(remainingPercent, resetAt, now) : null,
    };
  }

  function readRemainingPercent(card) {
    const text = normalizeText(card.textContent);
    const match = text.match(/(\d+(?:\.\d+)?)\s*%\s*残り/);
    if (!match) return null;
    return clamp(Number(match[1]), 0, 100);
  }

  function findResetDate(card, now) {
    const datedElement = card.querySelector("time[datetime],[datetime]");
    if (datedElement) {
      const raw = datedElement.getAttribute("datetime");
      const parsed = parseDateLike(raw, now);
      if (parsed) return parsed;
    }

    const text = normalizeText(card.textContent);
    const candidates = extractResetCandidateTexts(text);
    for (const candidate of candidates) {
      const parsed = parseDateLike(candidate, now);
      if (parsed) return parsed;
    }

    return parseRelativeReset(text, now);
  }

  function extractResetCandidateTexts(text) {
    const candidates = [];
    const resetWords = "(?:リセット|更新|reset|renews?)";
    const untilWords = "(?:まで|at|on|in|日時|時刻)";
    const pattern = new RegExp(`${resetWords}[^。\\n]*?${untilWords}?\\s*([^。\\n]{3,80})`, "gi");
    let match = null;
    while ((match = pattern.exec(text)) !== null) {
      candidates.push(match[0]);
      candidates.push(match[1]);
    }
    return candidates.concat(text.match(/\d{4}[/-]\d{1,2}[/-]\d{1,2}\s+\d{1,2}:\d{2}/g) || []);
  }

  function parseDateLike(raw, now) {
    if (!raw) return null;

    const text = String(raw).trim();
    const direct = new Date(text);
    if (Number.isFinite(direct.getTime())) return direct;

    const ymd = text.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})[^\d]+(\d{1,2}):(\d{2})/);
    if (ymd) {
      return new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]), Number(ymd[4]), Number(ymd[5]));
    }

    const jp = text.match(/(?:(\d{4})年)?\s*(\d{1,2})月\s*(\d{1,2})日[^\d]*(\d{1,2}):(\d{2})/);
    if (jp) {
      const current = new Date(now);
      const year = jp[1] ? Number(jp[1]) : current.getFullYear();
      let date = new Date(year, Number(jp[2]) - 1, Number(jp[3]), Number(jp[4]), Number(jp[5]));
      if (!jp[1] && date.getTime() < now - 24 * 60 * 60 * 1000) {
        date = new Date(year + 1, Number(jp[2]) - 1, Number(jp[3]), Number(jp[4]), Number(jp[5]));
      }
      return date;
    }

    const timeOnly = text.match(/(?:^|[^\d])(\d{1,2}):(\d{2})(?:[^\d]|$)/);
    if (timeOnly) {
      const current = new Date(now);
      const hours = Number(timeOnly[1]);
      const minutes = Number(timeOnly[2]);
      if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
        const date = new Date(current.getFullYear(), current.getMonth(), current.getDate(), hours, minutes);
        if (date.getTime() < now - 60 * 1000) {
          date.setDate(date.getDate() + 1);
        }
        return date;
      }
    }

    return parseRelativeReset(text, now);
  }

  function parseRelativeReset(text, now) {
    const source = normalizeText(text);
    const dayMatch = source.match(/(\d+(?:\.\d+)?)\s*(?:日|days?|d)(?=\s|$|\d)/i);
    const hourMatch = source.match(/(\d+(?:\.\d+)?)\s*(?:時間|hours?|hrs?|h)(?=\s|$|\d)/i);
    const minuteMatch = source.match(/(\d+(?:\.\d+)?)\s*(?:分|minutes?|mins?|m)(?=\s|$|\d)/i);

    if (!dayMatch && !hourMatch && !minuteMatch) return null;

    const days = dayMatch ? Number(dayMatch[1]) : 0;
    const hours = hourMatch ? Number(hourMatch[1]) : 0;
    const minutes = minuteMatch ? Number(minuteMatch[1]) : 0;
    const ms = ((days * 24 + hours) * 60 + minutes) * 60 * 1000;
    if (!Number.isFinite(ms) || ms <= 0) return null;
    return new Date(now + ms);
  }

  function buildUi(data) {
    const diffText = `${formatPercent(data.diff, true)}pt`;
    const todayAllowance = data.dailyAllowance === null
      ? ""
      : `<div class="codex-usage-pace__metric">
          <span>今日の残り時間での使用目安</span>
          <strong>${escapeHtml(data.dailyAllowance)}</strong>
        </div>`;

    return `
      <div class="codex-usage-pace__header">
        <span class="codex-usage-pace__title">使用ペース</span>
        <span class="codex-usage-pace__badge ${data.pace.className}">${data.pace.label}</span>
      </div>
      <div class="codex-usage-pace__metrics">
        <div class="codex-usage-pace__metric">
          <span>リセットまで</span>
          <strong>${escapeHtml(data.remainingText)}</strong>
        </div>
        <div class="codex-usage-pace__metric">
          <span>差分</span>
          <strong>${escapeHtml(diffText)}</strong>
        </div>
        ${todayAllowance}
      </div>
      <div class="codex-usage-pace__bars" aria-label="使用済みパーセントと時間経過パーセント">
        ${buildBar("使用済み", data.usedPercent, "used")}
        ${buildBar("時間経過", data.elapsedPercent, "elapsed")}
      </div>
    `;
  }

  function buildBar(label, value, variant) {
    const display = `${formatPercent(value)}%`;
    return `
      <div class="codex-usage-pace__bar-row">
        <div class="codex-usage-pace__bar-label">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(display)}</strong>
        </div>
        <div class="codex-usage-pace__bar-track">
          <div class="codex-usage-pace__bar-fill codex-usage-pace__bar-fill--${variant}" style="width:${clamp(value, 0, 100)}%"></div>
        </div>
      </div>
    `;
  }

  function judgePace(diff) {
    if (diff <= -10) return { label: "余裕あり", className: "codex-usage-pace__badge--relaxed" };
    if (diff <= 10) return { label: "標準ペース", className: "codex-usage-pace__badge--normal" };
    if (diff < 25) return { label: "やや使いすぎ", className: "codex-usage-pace__badge--high" };
    return { label: "使いすぎ", className: "codex-usage-pace__badge--over" };
  }

  function calculateTodayAllowance(remainingPercent, resetAt, now) {
    const reset = resetAt.getTime();
    const remainingMs = Math.max(reset - now, 0);
    if (remainingMs <= 0) return "0%";

    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);

    const todayMs = Math.max(Math.min(endOfToday.getTime(), reset) - now, 0);
    const allowance = remainingPercent * (todayMs / remainingMs);
    return `${formatPercent(allowance)}%`;
  }

  function formatRemaining(ms, kind) {
    if (kind === "week") {
      const days = Math.floor(ms / (24 * 60 * 60 * 1000));
      const hours = (ms - days * 24 * 60 * 60 * 1000) / (60 * 60 * 1000);
      return `${days}日${hours.toFixed(1)}時間`;
    }

    const totalMinutes = Math.ceil(ms / (60 * 1000));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours}時間${minutes}分`;
  }

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function formatPercent(value, withSign = false) {
    const rounded = Math.round(value * 10) / 10;
    const sign = withSign && rounded > 0 ? "+" : "";
    return `${sign}${rounded.toFixed(Math.abs(rounded) % 1 === 0 ? 0 : 1)}`;
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  const observer = new MutationObserver((mutations) => {
    if (mutations.some((mutation) => mutation.addedNodes.length || mutation.removedNodes.length)) {
      scheduleScan();
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  scheduleScan();
  window.setInterval(scan, REFRESH_MS);
})();
