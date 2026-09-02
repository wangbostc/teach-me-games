"use strict";

let board = null;
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
  section.textContent = text;
}

function showStartError(message) {
  let el = document.getElementById("start-error");
  if (!el) {
    el = document.createElement("p");
    el.id = "start-error";
    el.style.color = "#b00";
    document.getElementById("setup").appendChild(el);
  }
  el.textContent = message;
}

function maybeFetchReport(gameOver) {
  if (!gameOver) return;
  apiGet("/api/game/report").then(({ ok, data }) => {
    if (ok) showReport(data.report_text);
  });
}

function renderOptions() {
  apiGet("/api/game/options").then(({ ok, data }) => {
    if (!ok) return;
    const container = document.getElementById("options");
    container.hidden = false;
    container.innerHTML = "";
    data.options.forEach((option) => {
      const div = document.createElement("div");
      div.className = "option";
      // option.move_text and option.eval_text are our own rendered text,
      // but option.explanation is claude-generated prose -- the one place
      // in this app where model output reaches the DOM. Insert all three
      // as text nodes (never innerHTML) so nothing it contains is ever
      // parsed as markup.
      const strong = document.createElement("strong");
      strong.textContent = option.move_text;
      div.appendChild(strong);
      div.appendChild(document.createTextNode(" (" + option.eval_text + ")"));
      div.appendChild(document.createElement("br"));
      div.appendChild(document.createTextNode(option.explanation));
      div.addEventListener("click", () => playMove(option.uci));
      container.appendChild(div);
    });
  });
}

function afterMove(data) {
  lastKnownFen = data.fen;
  board.position(data.fen);
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
      board.position(lastKnownFen);
      return;
    }
    afterMove(data);
  });
}

function onDrop(source, target) {
  // Always queen on promotion -- a v1 simplification; under-promotion is
  // rare enough at beginner level that a picker isn't worth building yet.
  const piece = board.position()[source];
  const isPromotion = piece && piece[1] === "P" && (target[1] === "8" || target[1] === "1");
  const uci = source + target + (isPromotion ? "q" : "");
  playMove(uci);
  // Optimistic: chessboard.js already placed the piece; playMove reverts
  // it via lastKnownFen if the server rejects the move.
}

function startGame() {
  userColor = document.getElementById("side").value;
  const difficulty = document.getElementById("difficulty").value;
  learningMode = document.getElementById("learning-mode").checked;

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

    lastKnownFen = data.fen;
    board = Chessboard("board", {
      position: data.fen,
      draggable: !learningMode,
      orientation: userColor,
      onDrop: onDrop,
      // The npm/unpkg tarball for chessboardjs 1.0.0 does not ship the
      // piece PNGs (only css/js) -- pieceTheme's default relative path
      // ("img/chesspieces/wikipedia/{piece}.png") 404s against our own
      // FastAPI origin, leaving the board pieceless. Point it at the
      // project's own site, which does host them.
      pieceTheme: "https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png",
    });

    if (learningMode) {
      renderOptions();
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("start").addEventListener("click", startGame);
});
