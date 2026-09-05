"use strict";

import { Board3D, FACTION_KEYS, factionLabel } from "/static/board3d.js";

let board3d = null;
let learningMode = false;
let userColor = "white";
let lastKnownFen = null;

function apiPost(path, body) {
  return fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  }).then((resp) => resp.json().then((data) => ({ ok: resp.ok, data })));
}

function apiGet(path) {
  return fetch(path).then((resp) => resp.json().then((data) => ({ ok: resp.ok, data })));
}

function showReport(text) {
  const section = document.getElementById("report");
  section.hidden = false;
  document.getElementById("report-text").textContent = text;
}

function showStartError(message) {
  let el = document.getElementById("start-error");
  if (!el) {
    el = document.createElement("p");
    el.id = "start-error";
    document.getElementById("setup").appendChild(el);
  }
  el.textContent = message;
}

// Commit a344cf9 gave game-start failures a visible message (showStartError
// above); the move path -- hit every turn a move is attempted -- never got
// the same treatment. A rejected move used to revert the board in total
// silence: no message, no console output (finding 6).
function showMoveError(message) {
  let el = document.getElementById("move-error");
  if (!el) {
    el = document.createElement("p");
    el.id = "move-error";
    document.getElementById("status").insertAdjacentElement("afterend", el);
  }
  el.textContent = message;
}

function clearMoveError() {
  const el = document.getElementById("move-error");
  if (el) el.textContent = "";
}

function maybeFetchReport(gameOver) {
  if (!gameOver) return;
  apiGet("/api/game/report").then(({ ok, data }) => {
    if (ok) showReport(data.report_text);
  });
}

// A move's own eval_text already says "good for you" / "bad for you" / "even"
// (see tmg.web.explain._eval_text) -- reused here only to pick the option
// card's edge-tab color, never re-derived or restated as a number of our own.
function evalClass(evalText) {
  if (evalText.indexOf("bad for you") !== -1) return "eval-bad";
  if (evalText.indexOf("even") !== -1) return "eval-even";
  return "";
}

// Bumped on every renderOptions() call so a late-arriving /explanations
// response from a PREVIOUS turn (the user already moved, or a new game
// started, while it was still in flight) can recognize itself as stale and
// skip touching a DOM that's since moved on to a different turn's options.
let optionsRequestId = 0;

function renderOptions() {
  const requestId = ++optionsRequestId;
  // The struct (move + eval) comes back instantly -- no LLM involved
  // (docs/PLAN.md section 7) -- and is rendered on its own first. The
  // explanatory prose is fetched separately right after and can take
  // several seconds (it's validated server-side before it's ever sent
  // here), so it must never hold up the struct the learner is waiting on.
  apiGet("/api/game/options").then(({ ok, data }) => {
    if (requestId !== optionsRequestId) return; // a newer turn already took over
    const container = document.getElementById("options");
    if (!ok) {
      // The position moved on (or the game just ended) since this call was
      // made -- the cards on screen, if any, describe a turn that's over.
      // Clear them instead of leaving stale, still-clickable cards up
      // (finding 6); playMove's failure path is the caller that needs this.
      container.hidden = true;
      container.innerHTML = "";
      return;
    }
    container.hidden = false;
    container.innerHTML = "";
    const cardsByUci = {};
    data.options.forEach((option) => {
      const div = document.createElement("div");
      div.className = "option-card loading " + evalClass(option.eval_text);
      // option.move_text and option.eval_text are our own rendered text.
      // The explanation text node (filled in below, once it arrives) will
      // hold claude-generated prose -- the one place in this app where
      // model output reaches the DOM. Insert everything as text nodes
      // (never innerHTML) so nothing it contains is ever parsed as markup.
      const moveText = document.createElement("span");
      moveText.className = "move-text";
      moveText.textContent = option.move_text;
      div.appendChild(moveText);
      div.appendChild(document.createTextNode(" "));
      const evalTextEl = document.createElement("span");
      evalTextEl.className = "eval-text";
      evalTextEl.textContent = "(" + option.eval_text + ")";
      div.appendChild(evalTextEl);
      const explanationEl = document.createElement("span");
      explanationEl.className = "explanation";
      explanationEl.textContent = "Thinking through this move…";
      div.appendChild(explanationEl);
      div.addEventListener("click", () => playMove(option.uci));
      container.appendChild(div);
      cardsByUci[option.uci] = { card: div, explanationEl: explanationEl };
    });

    apiGet("/api/game/options/explanations").then(({ ok: explainOk, data: explainData }) => {
      if (requestId !== optionsRequestId) return;
      Object.keys(cardsByUci).forEach((uci) => {
        const { card, explanationEl } = cardsByUci[uci];
        const text = explainOk && explainData.explanations[uci];
        explanationEl.textContent = text || "(explanation unavailable)";
        card.classList.remove("loading");
      });
    });
  });
}

function afterMove(data) {
  lastKnownFen = data.fen;
  board3d.setPosition(data.fen);
  document.getElementById("status").textContent = data.game_over
    ? "Game over: " + data.result
    : "";
  maybeFetchReport(data.game_over);
  if (!data.game_over && learningMode) {
    renderOptions();
  } else {
    document.getElementById("options").hidden = true;
  }
}

function playMove(uci) {
  apiPost("/api/game/move", { uci: uci }).then(({ ok, data }) => {
    if (!ok) {
      board3d.setPosition(lastKnownFen);
      showMoveError(data.detail || "That move was rejected.");
      // The cards on screen were built for the position before this
      // attempt; refresh them so a stale one doesn't sit there clickable
      // (finding 6) -- renderOptions() clears the container outright if
      // the position has since moved on (e.g. the game ended underneath
      // this request).
      if (learningMode) renderOptions();
      return;
    }
    clearMoveError();
    afterMove(data);
  });
}

function populateFactionSelect() {
  const select = document.getElementById("faction");
  FACTION_KEYS.forEach((key) => {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = factionLabel(key);
    select.appendChild(option);
  });
}

// The opponent's army is always a DIFFERENT one from the player's own --
// picked at random from the remaining eight, never chosen by the player for
// both sides.
function pickOpponentFaction(userFaction) {
  const others = FACTION_KEYS.filter((key) => key !== userFaction);
  return others[Math.floor(Math.random() * others.length)];
}

function showMatchup(userFaction, opponentFaction) {
  document.getElementById("matchup").textContent =
    "You: " + factionLabel(userFaction) + "  vs.  Opponent: " + factionLabel(opponentFaction);
}

function startGame() {
  userColor = document.getElementById("side").value;
  const difficulty = document.getElementById("difficulty").value;
  learningMode = document.getElementById("learning-mode").checked;
  const userFaction = document.getElementById("faction").value;
  const opponentFaction = pickOpponentFaction(userFaction);
  const factions =
    userColor === "white"
      ? { w: userFaction, b: opponentFaction }
      : { w: opponentFaction, b: userFaction };

  apiPost("/api/game", {
    side: userColor,
    difficulty: difficulty,
    learning_mode: learningMode,
  }).then(({ ok, data }) => {
    if (!ok) {
      showStartError(data.detail || "Failed to start game.");
      return;
    }
    document.getElementById("setup").hidden = true;
    document.getElementById("game").hidden = false;
    showMatchup(userFaction, opponentFaction);
    clearMoveError();

    lastKnownFen = data.fen;
    if (board3d) board3d.dispose();
    board3d = new Board3D(document.getElementById("board3d"), {
      orientation: userColor,
      onMove: playMove,
      factions: factions,
    });
    board3d.setPosition(data.fen);
    board3d.setInteractive(!learningMode);

    if (learningMode) {
      renderOptions();
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  populateFactionSelect();
  document.getElementById("start").addEventListener("click", startGame);
});
