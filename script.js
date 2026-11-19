(() => {
  "use strict";

  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas.getContext("2d");
  const $ = (id) => document.getElementById(id);

  const els = {
    start: $("startScreen"), pause: $("pauseScreen"), over: $("gameOverScreen"),
    hud: $("hud"), controls: $("mobileControls"), score: $("score"), coins: $("coins"),
    best: $("bestScore"), finalScore: $("finalScore"), finalBest: $("finalBest"),
    nitroFill: $("nitroFill")
  };

  const carColors = ["#ef3868", "#34a7ff", "#ffc928"];
  const difficultyConfig = {
    easy: { enemyEvery: 1.45, enemySpeed: 0.82, scoreSpeed: 1 },
    normal: { enemyEvery: 1.12, enemySpeed: 1, scoreSpeed: 1.25 },
    hard: { enemyEvery: .82, enemySpeed: 1.16, scoreSpeed: 1.5 }
  };

  let W = 0, H = 0, dpr = 1, road = {}, state = "menu";
  let selectedCar = Number(localStorage.getItem("neonCar") || 0);
  let difficulty = localStorage.getItem("neonDifficulty") || "normal";
  let theme = localStorage.getItem("neonTheme") || "night";
  let soundOn = localStorage.getItem("neonSound") !== "off";
  let highScore = Number(localStorage.getItem("neonHighScore") || 0);
  let score = 0, coinCount = 0, roadOffset = 0, speed = 260;
  let enemyTimer = 0, coinTimer = 0, nitro = 100, shake = 0;
  let enemies = [], coins = [], particles = [], trees = [];
  let lastTime = 0, keys = {}, laneCooldown = 0;
  let swipeStart = null, nitroSwipeTime = 0;
  let audioContext = null, engineOscillator = null, engineGain = null;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const bounds = document.getElementById("app").getBoundingClientRect();
    W = bounds.width;
    H = bounds.height;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    road.width = Math.min(W * .88, 430);
    road.left = (W - road.width) / 2;
    road.lane = road.width / 3;
  }

  function laneX(lane) {
    return road.left + road.lane * lane + road.lane / 2;
  }

  const player = { lane: 1, x: 0, y: 0, width: 50, height: 92, tilt: 0 };

  function resetGame() {
    player.lane = 1;
    player.width = Math.max(42, Math.min(54, W * .09));
    player.height = player.width * 1.84;
    player.x = laneX(1);
    player.y = H - player.height - (W < 600 ? 82 : 48);
    player.tilt = 0;
    score = 0; coinCount = 0; roadOffset = 0; speed = 260;
    enemyTimer = 0; coinTimer = 1; nitro = 100; shake = 0;
    laneCooldown = 0;
    enemies = []; coins = []; particles = [];
    els.score.textContent = "0";
    els.coins.textContent = "0";
    els.nitroFill.style.width = "100%";
  }

  function initAudio() {
    if (!soundOn) return;
    if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === "suspended") audioContext.resume();
  }

  function startEngine() {
    initAudio();
    if (!audioContext || engineOscillator) return;
    engineOscillator = audioContext.createOscillator();
    engineGain = audioContext.createGain();
    engineOscillator.type = "sawtooth";
    engineOscillator.frequency.value = 55;
    engineGain.gain.value = .025;
    engineOscillator.connect(engineGain).connect(audioContext.destination);
    engineOscillator.start();
  }

  function stopEngine() {
    if (engineOscillator) {
      engineOscillator.stop();
      engineOscillator.disconnect();
      engineOscillator = null;
      engineGain = null;
    }
  }

  function tone(freq, duration, type = "square", volume = .04) {
    if (!soundOn) return;
    initAudio();
    if (!audioContext) return;
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(volume, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001, audioContext.currentTime + duration);
    osc.connect(gain).connect(audioContext.destination);
    osc.start();
    osc.stop(audioContext.currentTime + duration);
  }

  function updateEngine() {
    if (engineOscillator) engineOscillator.frequency.setTargetAtTime(55 + speed * .12, audioContext.currentTime, .08);
  }

  function spawnEnemy() {
    const occupied = enemies.filter(e => e.y < 180).map(e => e.lane);
    let lane = Math.floor(Math.random() * 3);
    for (let i = 0; i < 3 && occupied.includes(lane); i++) lane = (lane + 1) % 3;
    enemies.push({
      lane, x: laneX(lane), y: -110,
      width: player.width * (.9 + Math.random() * .12),
      height: player.height,
      color: carColors[(lane + 1 + Math.floor(Math.random() * 2)) % 3]
    });
  }

  function spawnCoin() {
    const lane = Math.floor(Math.random() * 3);
    coins.push({ lane, x: laneX(lane), y: -40, radius: 11, spin: 0 });
  }

  function movePlayer(dt) {
    const nitroActive = (keys.nitro || nitroSwipeTime > 0) && nitro > 0;
    const targetX = laneX(player.lane);
    const follow = nitroActive ? 16 : 11;
    player.x += (targetX - player.x) * Math.min(1, dt * follow);
    player.tilt += (((targetX - player.x) * .0025) - player.tilt) * Math.min(1, dt * 8);
  }

  function rectHit(a, b) {
    const aw = a.width * .72, ah = a.height * .82;
    const bx = b.x - b.width * .36, by = b.y - b.height * .41;
    return Math.abs(a.x - b.x) < (aw + b.width * .72) / 2 &&
      Math.abs(a.y - b.y) < (ah + b.height * .82) / 2;
  }

  function explode(x, y) {
    for (let i = 0; i < 35; i++) {
      particles.push({ x, y, vx: (Math.random() - .5) * 420, vy: (Math.random() - .5) * 420,
        life: .5 + Math.random() * .7, size: 3 + Math.random() * 8, color: i % 3 ? "#ffb12b" : "#ff3d81" });
    }
  }

  function gameOver() {
    state = "over";
    stopEngine();
    shake = 14;
    explode(player.x, player.y);
    tone(70, .55, "sawtooth", .11);
    highScore = Math.max(highScore, Math.floor(score));
    localStorage.setItem("neonHighScore", highScore);
    els.finalScore.textContent = Math.floor(score);
    els.finalBest.textContent = highScore;
    els.controls.classList.add("hidden");
    setTimeout(() => els.over.classList.remove("hidden"), 450);
  }

  function update(dt) {
    if (state !== "playing") return;
    laneCooldown = Math.max(0, laneCooldown - dt);
    if (laneCooldown === 0) {
      if (keys.left) {
        player.lane = Math.max(0, player.lane - 1);
        laneCooldown = .22;
      } else if (keys.right) {
        player.lane = Math.min(2, player.lane + 1);
        laneCooldown = .22;
      }
    }
    const cfg = difficultyConfig[difficulty];
    nitroSwipeTime = Math.max(0, nitroSwipeTime - dt);
    const nitroActive = (keys.nitro || nitroSwipeTime > 0) && nitro > 0;
    if (nitroActive) {
      nitro = Math.max(0, nitro - 25 * dt);
      speed += (520 - speed) * dt * 4;
    } else {
      nitro = Math.min(100, nitro + 7 * dt);
      speed += (260 + score * .16 - speed) * dt * 2;
    }
    els.nitroFill.style.width = nitro + "%";
    updateEngine();
    roadOffset = (roadOffset + speed * dt) % 80;
    score += speed * dt * cfg.scoreSpeed * .02;
    els.score.textContent = Math.floor(score);

    enemyTimer -= dt;
    coinTimer -= dt;
    if (enemyTimer <= 0) {
      spawnEnemy();
      enemyTimer = cfg.enemyEvery * (.75 + Math.random() * .5);
    }
    if (coinTimer <= 0) {
      spawnCoin();
      coinTimer = 2 + Math.random() * 2;
    }

    movePlayer(dt);
    enemies.forEach(e => e.y += speed * cfg.enemySpeed * dt);
    coins.forEach(c => { c.y += speed * dt; c.spin += dt * 5; });
    enemies = enemies.filter(e => e.y < H + 130);
    coins = coins.filter(c => c.y < H + 50);

    for (const e of enemies) {
      if (rectHit({ x: player.x, y: player.y, width: player.width, height: player.height }, e)) {
        gameOver();
        return;
      }
    }
    for (let i = coins.length - 1; i >= 0; i--) {
      const c = coins[i];
      if (Math.hypot(player.x - c.x, player.y - c.y) < player.width * .65) {
        coinCount++;
        els.coins.textContent = coinCount;
        nitro = Math.min(100, nitro + 12);
        tone(880, .12, "sine", .05);
        coins.splice(i, 1);
      }
    }
  }

  function drawRoad() {
    ctx.fillStyle = theme === "day" ? "#74b7d1" : "#090f20";
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = theme === "day" ? "#79a84c" : "#10172b";
    ctx.fillRect(0, 0, road.left, H);
    ctx.fillRect(road.left + road.width, 0, W - road.left - road.width, H);

    ctx.fillStyle = theme === "day" ? "#4f5960" : "#161d31";
    ctx.fillRect(road.left, 0, road.width, H);
    ctx.fillStyle = "#b7c0c7";
    ctx.fillRect(road.left - 5, 0, 5, H);
    ctx.fillRect(road.left + road.width, 0, 5, H);

    ctx.fillStyle = theme === "day" ? "rgba(255,255,255,.72)" : "rgba(173,211,255,.62)";
    for (let lane = 1; lane < 3; lane++) {
      const x = road.left + road.lane * lane;
      for (let y = -80 + roadOffset; y < H + 80; y += 80) ctx.fillRect(x - 2, y, 4, 38);
    }

    ctx.fillStyle = theme === "day" ? "#55782f" : "#151d38";
    for (let y = -50 + (roadOffset * .7) % 160; y < H + 100; y += 160) {
      drawTree(road.left - 28, y);
      drawTree(road.left + road.width + 28, y + 80);
    }
  }

  function drawTree(x, y) {
    ctx.fillStyle = "#4b2d25";
    ctx.fillRect(x - 3, y + 10, 6, 16);
    ctx.fillStyle = theme === "day" ? "#4e8b42" : "#202d55";
    ctx.beginPath();
    ctx.arc(x, y, 11, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawCar(x, y, w, h, color, enemy = false) {
    ctx.save();
    ctx.translate(x, y);
    if (!enemy) ctx.rotate(player.tilt);
    ctx.shadowColor = enemy ? "rgba(0,0,0,.5)" : color;
    ctx.shadowBlur = enemy ? 8 : 12;

    ctx.fillStyle = "#090b12";
    ctx.fillRect(-w * .58, -h * .28, w * .18, h * .24);
    ctx.fillRect(w * .40, -h * .28, w * .18, h * .24);
    ctx.fillRect(-w * .58, h * .10, w * .18, h * .24);
    ctx.fillRect(w * .40, h * .10, w * .18, h * .24);

    ctx.beginPath();
    ctx.moveTo(-w * .38, h * .48);
    ctx.quadraticCurveTo(-w * .55, h * .38, -w * .48, h * .05);
    ctx.lineTo(-w * .38, -h * .38);
    ctx.quadraticCurveTo(0, -h * .58, w * .38, -h * .38);
    ctx.lineTo(w * .48, h * .05);
    ctx.quadraticCurveTo(w * .55, h * .38, w * .38, h * .48);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();

    ctx.fillStyle = "#17243c";
    ctx.beginPath();
    ctx.moveTo(-w * .28, -h * .20);
    ctx.lineTo(w * .28, -h * .20);
    ctx.lineTo(w * .34, h * .04);
    ctx.lineTo(-w * .34, h * .04);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = enemy ? "#ffdd78" : "#fff5ca";
    ctx.fillRect(-w * .32, -h * .42, w * .16, h * .07);
    ctx.fillRect(w * .16, -h * .42, w * .16, h * .07);
    ctx.fillStyle = "#b81745";
    ctx.fillRect(-w * .30, h * .38, w * .14, h * .07);
    ctx.fillRect(w * .16, h * .38, w * .14, h * .07);
    ctx.restore();
  }

  function drawCoins() {
    coins.forEach(c => {
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.scale(Math.abs(Math.cos(c.spin)) * .7 + .3, 1);
      ctx.fillStyle = "#ffc928";
      ctx.shadowColor = "#ffc928";
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.arc(0, 0, c.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff09a";
      ctx.beginPath();
      ctx.arc(-3, -3, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }

  function drawParticles(dt) {
    particles = particles.filter(p => p.life > 0);
    particles.forEach(p => {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 500 * dt;
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  function draw() {
    ctx.save();
    if (shake > 0) {
      ctx.translate((Math.random() - .5) * shake, (Math.random() - .5) * shake);
      shake *= .88;
    }
    drawRoad();
    drawCoins();
    enemies.forEach(e => drawCar(e.x, e.y, e.width, e.height, e.color, true));
    if (state !== "over" || shake > 1) drawCar(player.x, player.y, player.width, player.height, carColors[selectedCar]);
    drawParticles(1 / 60);
    ctx.restore();
  }

  function loop(time) {
    const dt = Math.min(.033, (time - lastTime) / 1000 || 0);
    lastTime = time;
    update(dt);
    draw();
    requestAnimationFrame(loop);
  }

  function startGame() {
    resize();
    resetGame();
    keys = {};
    swipeStart = null;
    nitroSwipeTime = 0;
    state = "playing";
    els.start.classList.add("hidden");
    els.pause.classList.add("hidden");
    els.over.classList.add("hidden");
    els.hud.classList.remove("hidden");
    els.controls.classList.remove("hidden");
    initAudio();
    startEngine();
  }

  function pauseGame() {
    if (state !== "playing") return;
    state = "paused";
    els.pause.classList.remove("hidden");
    stopEngine();
  }

  function resumeGame() {
    if (state !== "paused") return;
    state = "playing";
    els.pause.classList.add("hidden");
    lastTime = performance.now();
    startEngine();
  }

  function goHome() {
    state = "menu";
    stopEngine();
    els.over.classList.add("hidden");
    els.pause.classList.add("hidden");
    els.hud.classList.add("hidden");
    els.controls.classList.add("hidden");
    els.start.classList.remove("hidden");
  }

  $("startButton").addEventListener("click", startGame);
  $("restartButton").addEventListener("click", startGame);
  $("pauseRestartButton").addEventListener("click", startGame);
  $("homeButton").addEventListener("click", goHome);
  $("pauseButton").addEventListener("click", pauseGame);
  $("resumeButton").addEventListener("click", resumeGame);

  document.querySelectorAll(".car-choice").forEach(btn => {
    btn.addEventListener("click", () => {
      selectedCar = Number(btn.dataset.car);
      localStorage.setItem("neonCar", selectedCar);
      document.querySelectorAll(".car-choice").forEach(b => b.classList.remove("selected"));
      btn.classList.add("selected");
    });
  });

  $("difficulty").value = difficulty;
  $("difficulty").addEventListener("change", e => {
    difficulty = e.target.value;
    localStorage.setItem("neonDifficulty", difficulty);
  });

  function applyTheme() {
    $("themeButton").textContent = theme === "night" ? "Night" : "Day";
  }
  applyTheme();
  $("themeButton").addEventListener("click", () => {
    theme = theme === "night" ? "day" : "night";
    localStorage.setItem("neonTheme", theme);
    applyTheme();
  });

  function applySoundLabel() {
    $("soundButton").textContent = "Sound: " + (soundOn ? "On" : "Off");
  }
  applySoundLabel();
  $("soundButton").addEventListener("click", () => {
    soundOn = !soundOn;
    localStorage.setItem("neonSound", soundOn ? "on" : "off");
    applySoundLabel();
    if (soundOn) tone(600, .1);
  });

  els.best.textContent = highScore;
  document.querySelectorAll(".car-choice").forEach((b, i) => b.classList.toggle("selected", i === selectedCar));

  window.addEventListener("keydown", e => {
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " "].includes(e.key)) e.preventDefault();
    if (e.key === "ArrowLeft" || e.key.toLowerCase() === "a") {
      keys.left = true;
    }
    if (e.key === "ArrowRight" || e.key.toLowerCase() === "d") {
      keys.right = true;
    }
    if (e.key.toLowerCase() === "w" || e.key === "Shift") keys.nitro = true;
    if (e.key === "ArrowUp") keys.nitro = true;
    if (e.key === "Escape" || e.key.toLowerCase() === "p") state === "playing" ? pauseGame() : state === "paused" && resumeGame();
  });
  window.addEventListener("keyup", e => {
    if (e.key === "ArrowLeft" || e.key.toLowerCase() === "a") keys.left = false;
    if (e.key === "ArrowRight" || e.key.toLowerCase() === "d") keys.right = false;
    if (e.key.toLowerCase() === "w" || e.key === "Shift" || e.key === "ArrowUp") keys.nitro = false;
  });

  function bindHold(id, key) {
    const el = $(id);
    const down = e => {
      e.preventDefault();
      keys[key] = true;
      if (el.setPointerCapture) el.setPointerCapture(e.pointerId);
    };
    const up = e => {
      e.preventDefault();
      keys[key] = false;
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("lostpointercapture", up);
  }
  bindHold("leftButton", "left");
  bindHold("rightButton", "right");
  bindHold("nitroButton", "nitro");

  canvas.addEventListener("pointerdown", e => {
    if (state !== "playing" || e.pointerType === "mouse" || !e.isPrimary) return;
    e.preventDefault();
    swipeStart = { id: e.pointerId, x: e.clientX, y: e.clientY };
    if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointerup", e => {
    if (!swipeStart || e.pointerId !== swipeStart.id) return;
    const dx = e.clientX - swipeStart.x;
    const dy = e.clientY - swipeStart.y;
    const threshold = Math.max(24, Math.min(48, W * .07));
    if (Math.max(Math.abs(dx), Math.abs(dy)) >= threshold) {
      if (Math.abs(dx) > Math.abs(dy)) {
        player.lane = Math.max(0, Math.min(2, player.lane + (dx < 0 ? -1 : 1)));
      } else if (dy < 0) {
        nitroSwipeTime = .6;
      }
    }
    swipeStart = null;
  });
  canvas.addEventListener("pointercancel", () => { swipeStart = null; });
  window.addEventListener("blur", () => {
    keys = {};
    swipeStart = null;
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      keys = {};
      swipeStart = null;
      if (state === "playing") pauseGame();
    }
  });

  window.addEventListener("resize", () => {
    resize();
    if (state !== "menu") {
      player.width = Math.max(42, Math.min(54, W * .09));
      player.height = player.width * 1.84;
      player.x = laneX(player.lane);
      player.y = Math.max(player.height, Math.min(player.y, H - player.height - (W < 600 ? 82 : 48)));
    }
  });
  resize();
  els.best.textContent = highScore;
  requestAnimationFrame(loop);
})();
