(() => {
  'use strict';

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const FLOOR = 447;
  const $ = (id) => document.getElementById(id);
  const screens = ['mainMenu', 'instructionsScreen', 'creditsScreen', 'pauseScreen', 'transitionScreen', 'endingScreen'];
  const quotes = [
    'El destino de las medialunas está en tus manos.',
    'No sabemos por qué estamos acá.',
    'Este juego fue aprobado por 3 tractores.',
    'Dios está observando tu FPS.',
    'Un cactus dijo que sí. No pidió detalles.',
    'La arena tiene una reunión que pudo ser un mail.'
  ];
  const state = {
    mode: 'menu', stage: 1, health: 100, score: 0, player: null, enemies: [], particles: [], projectiles: [],
    camera: 0, worldWidth: 1700, elapsed: 0, spawnClock: 0, attackCooldown: 0, hurtCooldown: 0,
    shake: 0, stageClock: 0, transitionNext: 0, bossProgress: 0, bossPrompt: 0, bossPromptClock: 0,
    bossAttackClock: 0, debateCooldown: 0, endType: '', endClock: 0, audioOn: true, lastTime: 0,
    menuTime: 0, keys: new Set(), touch: new Set(), musicTimer: null, musicStep: 0, audio: null
  };

  const stageNames = { 1: 'EL DESPERTAR', 2: 'REVOLUCIÓN TRACTORIL', 3: 'EL GRAN DEBATE' };
  const objectives = { 1: 'Ahuyenta a la fauna de oficina', 2: 'Neutraliza los tractores meme', 3: 'Gana el debate. Esquiva micrófonos.' };
  const prompts = [
    { line: '¿Y si el verdadero tesoro eran las medialunas? Respiremos.', best: 1 },
    { line: 'La gráfica dice 400% más vibraciones. ¿Fuente?', best: 0 },
    { line: 'Objeción: el cactus solicita vibraciones.', best: 2 },
    { line: 'El comité agrícola solicita contexto con datos.', best: 0 },
    { line: '¿Un kazoo? Objeción: vibraciones.', best: 2 }
  ];
  const argumentLabels = ['DATOS SOSPECHOSAMENTE ESPECÍFICOS', '¿Y SI RESPIRAMOS?', 'OBJECIÓN: VIBRACIONES'];

  // Audio sintético: todo se crea localmente con Web Audio, sin archivos externos.
  const audio = {
    ensure() {
      if (!state.audio) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) state.audio = new AudioContext();
      }
      if (state.audio?.state === 'suspended') state.audio.resume();
    },
    tone(freq, duration = 0.12, type = 'triangle', volume = 0.045, slide = 0) {
      if (!state.audioOn) return;
      this.ensure();
      if (!state.audio) return;
      const now = state.audio.currentTime;
      const osc = state.audio.createOscillator();
      const gain = state.audio.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(Math.max(35, freq), now);
      if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(35, freq + slide), now + duration);
      gain.gain.setValueAtTime(volume, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
      osc.connect(gain); gain.connect(state.audio.destination);
      osc.start(now); osc.stop(now + duration + 0.02);
    },
    noise(duration = 0.12, volume = 0.035) {
      if (!state.audioOn) return;
      this.ensure();
      if (!state.audio) return;
      const size = Math.floor(state.audio.sampleRate * duration);
      const buffer = state.audio.createBuffer(1, size, state.audio.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < size; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / size);
      const source = state.audio.createBufferSource();
      const gain = state.audio.createGain();
      source.buffer = buffer; gain.gain.value = volume;
      source.connect(gain); gain.connect(state.audio.destination); source.start();
    },
    sfx(name) {
      const sounds = {
        jump: () => this.tone(260, .16, 'sine', .055, 280),
        attack: () => { this.tone(190, .11, 'square', .04, 360); this.tone(520, .09, 'triangle', .025, -220); },
        hurt: () => { this.tone(180, .24, 'sawtooth', .055, -110); this.noise(.08, .02); },
        tractor: () => { this.tone(95, .25, 'square', .035, 45); this.tone(145, .18, 'triangle', .02, -50); },
        mic: () => this.tone(440, .13, 'triangle', .025, -180),
        win: () => [523, 659, 784, 1047].forEach((n, i) => setTimeout(() => this.tone(n, .35, 'sine', .06), i * 120)),
        lose: () => [440, 349, 261, 196].forEach((n, i) => setTimeout(() => this.tone(n, .4, 'sine', .045), i * 190)),
        click: () => this.tone(420, .06, 'sine', .025, 100)
      };
      sounds[name]?.();
    },
    setMusic(kind) {
      clearInterval(state.musicTimer);
      state.musicStep = 0;
      const tunes = {
        menu: [392, 0, 523, 440, 0, 587, 523, 330],
        stage1: [330, 392, 440, 0, 392, 523, 440, 0],
        stage2: [196, 0, 262, 220, 294, 0, 262, 165],
        boss: [220, 0, 220, 330, 294, 0, 196, 262],
        win: [523, 659, 784, 659, 880, 784],
        lose: [220, 196, 165, 146]
      };
      const notes = tunes[kind] || tunes.menu;
      state.musicTimer = setInterval(() => {
        if (!state.audioOn) return;
        const note = notes[state.musicStep % notes.length];
        if (note) this.tone(note, kind === 'boss' ? .24 : .3, 'sine', kind === 'boss' ? .018 : .014);
        state.musicStep++;
      }, kind === 'boss' ? 350 : 470);
    }
  };

  function showScreen(id, visible = true) { $(id).hidden = !visible; }
  function hideAllScreens() { screens.forEach((id) => showScreen(id, false)); }
  function rand(min, max) { return min + Math.random() * (max - min); }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function roundedRect(x, y, w, h, r, color) {
    ctx.fillStyle = color; ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill();
  }
  function text(str, x, y, size, color = '#fff', align = 'center', font = '700') {
    ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'middle';
    ctx.font = `${font} ${size}px "Space Grotesk", sans-serif`; ctx.fillText(str, x, y);
  }

  function addParticles(x, y, count, colors, force = 180, shapes = ['circle']) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = rand(force * .25, force);
      state.particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 35, life: rand(.4, 1.15), maxLife: 1.15, color: colors[i % colors.length], size: rand(3, 8), shape: shapes[i % shapes.length], gravity: 310 });
    }
  }

  function setHUD() {
    $('healthFill').style.width = `${state.health}%`;
    $('healthText').textContent = Math.ceil(state.health);
    $('stageName').textContent = stageNames[state.stage];
    $('objective').textContent = state.stage === 3 ? `“${prompts[state.bossPrompt].line}”` : objectives[state.stage];
    $('score').textContent = String(state.score).padStart(4, '0');
    $('bossHud').hidden = state.stage !== 3 || state.mode !== 'play';
    $('bossFill').style.width = `${state.bossProgress}%`;
    $('touchControls').hidden = state.mode !== 'play';
    $('debateControls').hidden = state.mode !== 'play' || state.stage !== 3;
    $('canvas-wrap')?.classList.toggle('boss-mode', state.mode === 'play' && state.stage === 3);
  }

  function makePlayer() {
    return { x: 120, y: FLOOR - 76, w: 42, h: 76, vx: 0, vy: 0, facing: 1, grounded: true, anim: 0, attack: 0, hurt: 0, walkBob: 0 };
  }

  function beginGame() {
    audio.ensure(); hideAllScreens(); state.mode = 'play'; state.stage = 1; state.health = 100; state.score = 0;
    state.player = makePlayer(); state.enemies = []; state.particles = []; state.projectiles = []; state.camera = 0;
    state.elapsed = 0; state.spawnClock = 0; state.attackCooldown = 0; state.hurtCooldown = 0; state.shake = 0;
    state.stageClock = 0; state.bossProgress = 0; state.bossPrompt = 0; state.bossPromptClock = 0; state.bossAttackClock = 0; state.debateCooldown = 0;
    state.worldWidth = 1700; state.endType = '';
    for (let i = 0; i < 7; i++) spawnEnemy('npc', 370 + i * 175 + rand(-35, 35));
    $('hud').hidden = false; setHUD(); audio.setMusic('stage1'); audio.sfx('click');
  }

  function startStage(stage) {
    state.stage = stage; state.stageClock = 0; state.player.x = 130; state.player.y = FLOOR - state.player.h; state.player.vx = 0; state.player.vy = 0;
    state.camera = 0; state.projectiles = []; state.enemies = []; state.worldWidth = stage === 3 ? 1250 : 1850;
    state.health = Math.min(100, state.health + 45);
    if (stage === 2) {
      for (let i = 0; i < 5; i++) spawnEnemy('tractor', 430 + i * 260 + rand(-35, 35));
      audio.setMusic('stage2');
    } else {
      state.bossProgress = 0; state.bossPrompt = 0; state.bossPromptClock = 0; state.bossAttackClock = 1.2; state.debateCooldown = 0;
      state.boss = { x: 940, y: FLOOR - 108, w: 65, h: 108, bob: 0 };
      audio.setMusic('boss');
    }
    hideAllScreens(); state.mode = 'play'; $('hud').hidden = false; setHUD();
  }

  function spawnEnemy(type, x) {
    state.enemies.push({ type, x, y: FLOOR - (type === 'tractor' ? 58 : 57), w: type === 'tractor' ? 88 : 48, h: type === 'tractor' ? 58 : 57, vx: 0, vy: 0, hp: 1, alive: true, phase: rand(0, 6), jump: 0, hurt: 0, attackClock: rand(.4, 1.6) });
  }

  function startAttack() {
    if (state.mode !== 'play' || state.attackCooldown > 0) return;
    if (state.stage === 3) { chooseArgument(Math.floor(Math.random() * 3)); return; }
    const p = state.player; p.attack = .28; state.attackCooldown = .42; audio.sfx('attack');
    for (const e of state.enemies) {
      if (!e.alive) continue;
      const dx = e.x - p.x;
      const reach = state.stage === 2 ? 122 : 108;
      // The swing is deliberately generous: nearby enemies can be bonked on either side.
      const forward = Math.abs(dx) < reach;
      const vertical = Math.abs((e.y + e.h * .5) - (p.y + p.h * .5)) < 78;
      if (forward && vertical) {
        e.alive = false; state.score += state.stage === 2 ? 250 : 100;
        addParticles(e.x, e.y + e.h / 2, state.stage === 2 ? 26 : 18, state.stage === 2 ? ['#d8ff72', '#ffb45c', '#fff2a1'] : ['#ff759d', '#a8f3d0', '#fff2a1'], 220, ['circle', 'star']);
        state.shake = .16; audio.sfx(state.stage === 2 ? 'tractor' : 'attack');
      }
    }
    setHUD();
  }

  function hurtPlayer(amount = 18) {
    if (state.hurtCooldown > 0 || state.mode !== 'play') return;
    state.health = Math.max(0, state.health - amount); state.hurtCooldown = 1.15;
    state.player.hurt = .5; state.player.vy = Math.min(state.player.vy, -160); state.player.vx -= state.player.facing * 95;
    state.shake = .27; addParticles(state.player.x, state.player.y + 32, 12, ['#ff759d', '#fff1be'], 120); audio.sfx('hurt'); setHUD();
    if (state.health <= 0) finishGame('lose');
  }

  function chooseArgument(index) {
    if (state.mode !== 'play' || state.stage !== 3 || state.debateCooldown > 0) return;
    state.debateCooldown = .82;
    const correct = index === prompts[state.bossPrompt].best;
    state.bossProgress = Math.min(100, state.bossProgress + (correct ? 16 : 9));
    state.score += correct ? 180 : 90;
    addParticles(state.player.x + state.player.w, state.player.y + 14, correct ? 12 : 7, correct ? ['#d8ff72', '#fff2a1', '#76e3e8'] : ['#ffb45c', '#ff759d'], 120, ['star', 'circle']);
    floatMessage(correct ? '¡CONTRAARGUMENTO ESTELAR!' : 'PUNTO POR VIBRACIONES', state.player.x, state.player.y - 28, correct ? '#d8ff72' : '#ffcf83');
    audio.tone(correct ? 660 : 430, .16, 'triangle', .035, 180);
    state.bossPrompt = (state.bossPrompt + 1) % prompts.length; state.bossPromptClock = 0; setHUD();
    if (state.bossProgress >= 100) finishGame('win');
  }

  function floatMessage(label, x, y, color) {
    state.particles.push({ x, y, vx: 0, vy: -32, life: .9, maxLife: .9, color, size: 12, shape: 'text', label, gravity: 0 });
  }

  function finishGame(type) {
    if (state.mode === 'ending') return;
    state.mode = 'ending'; state.endType = type; state.endClock = 0; state.projectiles = []; state.particles = []; state.keys.clear(); state.touch.clear();
    hideAllScreens(); $('hud').hidden = true; $('touchControls').hidden = true; $('debateControls').hidden = true; showScreen('endingScreen');
    if (type === 'win') {
      $('endingKicker').textContent = 'FINAL GANADOR'; $('endingTitle').textContent = 'EL AMOR HA DERROTADO AL ABSURDO.'; $('endingSubtitle').textContent = 'ENDING A: EL AMOR TRIUNFA.';
      $('endingScreen').classList.remove('loss-ending'); audio.setMusic('win'); audio.sfx('win');
    } else {
      $('endingKicker').textContent = 'FINAL CELESTIAL'; $('endingTitle').textContent = 'ERA TU MOMENTO, TUNG TUNG.'; $('endingSubtitle').textContent = 'ENDING B: EL VIAJE CELESTIAL.';
      $('endingScreen').classList.add('loss-ending'); clearInterval(state.musicTimer); audio.sfx('lose');
    }
  }

  function returnToMenu() {
    hideAllScreens(); showScreen('mainMenu');
    state.mode = 'menu'; state.player = null; state.enemies = []; state.projectiles = [];
    state.keys.clear(); state.touch.clear(); state.camera = 0;
    $('hud').hidden = true; $('touchControls').hidden = true; $('debateControls').hidden = true;
    $('endingScreen').classList.remove('loss-ending');
    $('tagline').textContent = quotes[Math.floor(Math.random() * quotes.length)];
    audio.setMusic('menu');
  }

  function update(dt) {
    state.menuTime += dt;
    if (state.mode === 'ending') {
      state.endClock += dt;
      if (state.endType === 'win' && Math.random() < dt * 13) addParticles(rand(0, W), rand(0, H), 1, ['#ff759d', '#fff2a1', '#76e3e8'], 36, ['heart', 'star']);
      if (state.endType === 'lose' && Math.random() < dt * 5) addParticles(rand(100, W - 100), rand(0, H), 1, ['#ffffff', '#b8e4ff'], 24, ['circle']);
      updateParticles(dt); return;
    }
    if (state.mode !== 'play') { updateParticles(dt); return; }
    state.elapsed += dt; state.stageClock += dt;
    state.attackCooldown = Math.max(0, state.attackCooldown - dt); state.hurtCooldown = Math.max(0, state.hurtCooldown - dt); state.debateCooldown = Math.max(0, state.debateCooldown - dt);
    state.shake = Math.max(0, state.shake - dt); state.player.attack = Math.max(0, state.player.attack - dt); state.player.hurt = Math.max(0, state.player.hurt - dt);
    const p = state.player;
    const left = state.keys.has('a') || state.keys.has('arrowleft') || state.touch.has('left');
    const right = state.keys.has('d') || state.keys.has('arrowright') || state.touch.has('right');
    const jump = state.keys.has('w') || state.keys.has(' ') || state.keys.has('arrowup') || state.touch.has('jump');
    if (left !== right) { p.vx += (left ? -1 : 1) * 950 * dt; p.facing = left ? -1 : 1; }
    else p.vx *= Math.pow(.001, dt);
    p.vx = clamp(p.vx, -260, 260);
    if (jump && p.grounded) { p.vy = -480; p.grounded = false; audio.sfx('jump'); }
    p.vy += 1250 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
    p.x = clamp(p.x, 40, state.worldWidth - 60);
    if (p.y + p.h >= FLOOR) { p.y = FLOOR - p.h; p.vy = 0; p.grounded = true; }
    p.anim += dt * (Math.abs(p.vx) > 15 ? 11 : 3.2); p.walkBob = Math.sin(p.anim) * (Math.abs(p.vx) > 15 && p.grounded ? 3 : 1.1);
    state.camera = clamp(p.x - 330, 0, state.worldWidth - W);

    if (state.stage < 3) updateEnemies(dt, p);
    else updateBoss(dt, p);
    for (const shot of state.projectiles) {
      shot.x += shot.vx * dt; shot.y += shot.vy * dt; shot.vy += (shot.gravity || 0) * dt; shot.life -= dt; shot.rot += dt * 8;
      if (Math.abs(shot.x - (p.x + p.w / 2)) < 25 && Math.abs(shot.y - (p.y + p.h / 2)) < 30) { shot.life = 0; hurtPlayer(9); addParticles(shot.x, shot.y, 8, ['#fff1c1', '#ff759d'], 90); }
    }
    state.projectiles = state.projectiles.filter((s) => s.life > 0 && s.x > state.camera - 100 && s.x < state.camera + W + 100);
    updateParticles(dt); setHUD();
  }

  function updateEnemies(dt, p) {
    let alive = 0;
    for (const e of state.enemies) {
      if (!e.alive) continue;
      alive++; e.phase += dt * (e.type === 'tractor' ? 4 : 2.5); e.hurt = Math.max(0, e.hurt - dt);
      const dir = p.x < e.x ? -1 : 1;
      const distance = Math.abs(p.x - e.x);
      if (e.type === 'npc') {
        e.x += dir * (40 + state.stageClock * 1.3) * dt;
        if (distance < 45 && Math.abs((p.y + p.h) - FLOOR) < 4) { e.attackClock -= dt; if (e.attackClock <= 0) { hurtPlayer(7); e.attackClock = 1.3; } }
      } else {
        e.x += dir * (70 + Math.sin(e.phase * 2) * 58 + Math.min(state.stageClock * 1.4, 45)) * dt;
        e.jump -= dt;
        if (e.jump <= 0 && Math.random() < dt * .34) { e.vy = -rand(210, 300); e.jump = rand(.7, 1.7); audio.sfx('tractor'); }
        e.vy += 950 * dt; e.y += e.vy * dt;
        if (e.y + e.h > FLOOR) { e.y = FLOOR - e.h; e.vy = 0; }
        if (distance < 65 && Math.abs((p.y + p.h) - FLOOR) < 8) { e.attackClock -= dt; if (e.attackClock <= 0) { hurtPlayer(10); e.attackClock = 1.3; } }
      }
      if (distance < 40 && Math.abs((p.y + p.h) - (e.y + e.h)) < 35 && p.hurt <= 0 && state.hurtCooldown <= 0) hurtPlayer(e.type === 'tractor' ? 10 : 7);
    }
    if (alive === 0) {
      state.stageClock += dt;
      if (state.stageClock > 1.2) {
        state.mode = 'transition'; showScreen('transitionScreen'); $('hud').hidden = true; $('touchControls').hidden = true; $('debateControls').hidden = true;
        $('transitionTitle').textContent = state.stage === 1 ? 'EL DESIERTO HA SIDO PROMOVIDO A REUNIÓN.' : 'EL SECTOR AGRÍCOLA HA SIDO DESACTIVADO.';
        state.transitionNext = state.stage + 1; audio.tone(700, .24, 'sine', .04, 240);
      }
    }
  }

  function updateBoss(dt, p) {
    state.boss.bob += dt * 3; state.bossPromptClock += dt; state.bossAttackClock -= dt;
    if (state.bossPromptClock > 6) { state.bossPrompt = (state.bossPrompt + 1) % prompts.length; state.bossPromptClock = 0; }
    if (state.bossAttackClock <= 0) {
      const bx = state.boss.x - 25; const by = state.boss.y + 40 + Math.sin(state.boss.bob) * 9;
      const dx = p.x + 20 - bx; const dy = p.y + 28 - by; const mag = Math.max(1, Math.hypot(dx, dy));
      state.projectiles.push({ x: bx, y: by, vx: dx / mag * 285, vy: dy / mag * 285 - 40, gravity: 58, life: 4, rot: 0, type: Math.random() > .5 ? 'mic' : 'paper' });
      state.bossAttackClock = Math.max(1.05, 2.1 - state.stageClock * .025); audio.sfx('mic');
      if (Math.random() < .48) floatMessage(['¡FUENTE: UN TRACTOR!', 'DATO: CONFÍA EN MÍ', '¡OBJECIÓN, SU SEÑORÍA CACTUS!'][Math.floor(Math.random() * 3)], state.boss.x, 160, '#fff0b0');
    }
  }

  function updateParticles(dt) {
    for (const p of state.particles) { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += p.gravity * dt; p.vx *= Math.pow(.55, dt); }
    state.particles = state.particles.filter((p) => p.life > 0);
  }

  function drawBackground(stage, camera = 0, time = state.menuTime) {
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    if (stage === 3) { sky.addColorStop(0, '#302149'); sky.addColorStop(.58, '#d77b91'); sky.addColorStop(1, '#f8bd91'); }
    else if (stage === 2) { sky.addColorStop(0, '#7b9ac3'); sky.addColorStop(.55, '#f2b076'); sky.addColorStop(1, '#f7d38c'); }
    else { sky.addColorStop(0, '#7ad6d2'); sky.addColorStop(.56, '#f4c078'); sky.addColorStop(1, '#f9d890'); }
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
    // Sol y nubes absurdamente tranquilas
    ctx.fillStyle = stage === 3 ? '#ffe4a0' : '#fff1ad'; ctx.beginPath(); ctx.arc(770 - camera * .04, 107, 47, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = .45; ctx.fillStyle = '#fff7df';
    for (let i = 0; i < 5; i++) { const x = ((i * 239 - camera * .16 + time * 8) % (W + 180) + W + 180) % (W + 180) - 70; const y = 75 + (i % 3) * 46; ctx.beginPath(); ctx.ellipse(x, y, 35, 9, 0, 0, Math.PI * 2); ctx.ellipse(x + 16, y - 6, 18, 12, 0, 0, Math.PI * 2); ctx.fill(); }
    ctx.globalAlpha = 1;
    if (stage === 3) drawArenaBackdrop(camera);
    else drawDesertBackdrop(stage, camera, time);
    // Suelo
    ctx.fillStyle = stage === 3 ? '#4a344d' : '#d79a55'; ctx.fillRect(0, FLOOR, W, H - FLOOR);
    ctx.fillStyle = stage === 3 ? '#efb47e' : '#f5cb79'; ctx.fillRect(0, FLOOR, W, 9);
    ctx.globalAlpha = .18; ctx.fillStyle = '#774a49';
    for (let i = 0; i < 24; i++) { const x = ((i * 67 - camera * .65) % (W + 70) + W + 70) % (W + 70) - 20; ctx.fillRect(x, FLOOR + 18 + (i % 4) * 14, 14 + i % 3 * 8, 2); }
    ctx.globalAlpha = 1;
  }

  function drawDesertBackdrop(stage, camera, time) {
    ctx.fillStyle = '#da9c78';
    for (let i = 0; i < 5; i++) { const x = ((i * 285 - camera * .26) % (W + 400) + W + 400) % (W + 400) - 200; ctx.beginPath(); ctx.moveTo(x - 180, FLOOR); ctx.quadraticCurveTo(x, 245 + (i % 2) * 45, x + 170, FLOOR); ctx.fill(); }
    ctx.fillStyle = '#bd806e';
    for (let i = 0; i < 4; i++) { const x = ((i * 350 - camera * .43) % (W + 400) + W + 400) % (W + 400) - 180; ctx.beginPath(); ctx.moveTo(x - 130, FLOOR); ctx.quadraticCurveTo(x, 316 + (i % 2) * 20, x + 130, FLOOR); ctx.fill(); }
    for (let i = 0; i < 7; i++) {
      const x = ((i * 245 + 95 - camera * .72) % (W + 260) + W + 260) % (W + 260) - 120;
      const y = 330 + (i % 3) * 30;
      if (i % 3 === 1) drawPalm(x, y);
      else drawBuilding(x, y, i, stage === 2);
    }
    // Cartelitos de la zona
    const signs = ['AGUA (QUIZÁ)', 'BIENVENIDOS AL LORE', 'NO ALIMENTAR AL CACTUS', 'A 3 MEMES DE AQUÍ'];
    for (let i = 0; i < 4; i++) {
      const x = ((i * 420 + 280 - camera * .92) % (W + 500) + W + 500) % (W + 500) - 100;
      ctx.fillStyle = '#81513e'; ctx.fillRect(x, FLOOR - 74, 5, 74);
      roundedRect(x - 52, FLOOR - 104, 110, 35, 5, i % 2 ? '#f2db99' : '#d9efb0');
      text(signs[i], x + 3, FLOOR - 86, 8, '#493c48', 'center', '500');
    }
    if (stage === 2) { ctx.globalAlpha = .22; for (let i = 0; i < 3; i++) { const x = ((i * 450 - camera * .45) % (W + 200) + W + 200) % (W + 200); text('TRACTOR RADIO', x, 290 + i * 25, 16, '#fff0bb'); } ctx.globalAlpha = 1; }
    if (stage === 1 && time % 9 < 3) { ctx.globalAlpha = .5; text('¿?', 790, 263, 29, '#fff4bd'); ctx.globalAlpha = 1; }
  }

  function drawBuilding(x, y, i, tractor) {
    const width = 70 + (i % 3) * 14; const height = 66 + (i % 2) * 27;
    ctx.fillStyle = tractor ? ['#c18a65', '#9279a1', '#e3b276'][i % 3] : ['#d28b68', '#c87969', '#e8b878'][i % 3];
    ctx.fillRect(x, y - height, width, height);
    ctx.fillStyle = '#744f5d'; ctx.beginPath(); ctx.moveTo(x - 7, y - height); ctx.lineTo(x + width / 2, y - height - 23); ctx.lineTo(x + width + 7, y - height); ctx.fill();
    ctx.fillStyle = '#ffe5a0';
    for (let j = 0; j < 3; j++) ctx.fillRect(x + 12 + j * 20, y - height + 17 + (j % 2) * 22, 9, 14);
    ctx.fillStyle = '#774b52'; ctx.fillRect(x + width / 2 - 9, y - 35, 18, 35);
  }
  function drawPalm(x, y) {
    ctx.strokeStyle = '#805044'; ctx.lineWidth = 9; ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x - 7, y - 49, x + 4, y - 88); ctx.stroke();
    ctx.strokeStyle = '#4d9870'; ctx.lineWidth = 7;
    for (let i = 0; i < 7; i++) { const a = -Math.PI * .92 + i * Math.PI * .31 + Math.sin(state.menuTime * 2 + i) * .035; ctx.beginPath(); ctx.moveTo(x + 4, y - 84); ctx.quadraticCurveTo(x + Math.cos(a) * 25, y - 116, x + Math.cos(a) * 53, y - 83 + Math.sin(a) * 17); ctx.stroke(); }
    ctx.fillStyle = '#9b6447'; ctx.beginPath(); ctx.arc(x + 4, y - 84, 9, 0, Math.PI * 2); ctx.fill();
  }
  function drawArenaBackdrop(camera) {
    const stageX = 120 - camera;
    ctx.fillStyle = '#332647'; ctx.fillRect(0, 320, W, 130);
    for (let i = 0; i < 8; i++) {
      const x = ((i * 145 - camera * .68) % (W + 160) + W + 160) % (W + 160) - 60;
      ctx.fillStyle = i % 2 ? '#54405d' : '#63435b'; ctx.fillRect(x, 260, 18, 190);
      ctx.fillStyle = '#ffdb91'; ctx.fillRect(x + 5, 275, 4, 16); ctx.fillRect(x + 5, 315, 4, 16);
    }
    ctx.fillStyle = '#e7939c'; ctx.fillRect(stageX, 298, 990, 10); ctx.fillStyle = '#ffde9a'; ctx.fillRect(stageX, 309, 990, 5);
    for (let i = 0; i < 6; i++) {
      const x = 170 + i * 145 - camera; ctx.globalAlpha = .42;
      ctx.fillStyle = i % 2 ? '#7ce6e9' : '#ff81b0'; ctx.beginPath(); ctx.moveTo(x, 100); ctx.lineTo(x - 76, FLOOR); ctx.lineTo(x + 76, FLOOR); ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (stageX > -200 && stageX < W) {
      roundedRect(stageX + 235, 239, 340, 66, 10, '#542b56'); roundedRect(stageX + 245, 249, 320, 48, 7, '#302243');
      text('DEBATE-O-RAMA', stageX + 405, 267, 20, '#fff0b8'); text('PRESENTADO POR: NADIE SABE', stageX + 405, 286, 8, '#dcb7d4', 'center', '500');
    }
  }

  function drawPlayer(p, screenX, time = state.elapsed) {
    ctx.save(); ctx.translate(screenX + p.w / 2, p.y + p.h / 2 + (p.walkBob || 0));
    if (p.hurt > 0 && Math.floor(time * 22) % 2 === 0) ctx.globalAlpha = .45;
    ctx.scale(p.facing, 1);
    const jumpTilt = !p.grounded ? -.09 : 0; ctx.rotate(jumpTilt);
    // Bastón, brazos y cuerpo de madera con cara expresiva.
    ctx.fillStyle = '#503530'; ctx.fillRect(-21, 21, 14, 7); ctx.fillRect(6, 21, 14, 7);
    ctx.fillStyle = '#f1bf83'; ctx.fillRect(-19, 26, 10, 5); ctx.fillRect(8, 26, 10, 5);
    ctx.fillStyle = '#b66d45'; ctx.fillRect(-17, -4, 34, 32); ctx.fillStyle = '#d58a55'; ctx.fillRect(-14, -1, 28, 25);
    ctx.fillStyle = '#704334'; ctx.fillRect(-17, -8, 34, 6); ctx.fillRect(-13, 24, 26, 4);
    ctx.fillStyle = '#f4d28f'; ctx.fillRect(-21, -32, 42, 30); ctx.fillStyle = '#dca46a'; ctx.fillRect(-19, -36, 38, 6);
    ctx.fillStyle = '#2c2734'; ctx.fillRect(-12, -24, 5, 7); ctx.fillRect(7, -24, 5, 7); ctx.fillStyle = '#fff'; ctx.fillRect(-11, -24, 2, 2); ctx.fillRect(8, -24, 2, 2);
    ctx.strokeStyle = '#72434a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, -13, 6, .18, Math.PI - .18); ctx.stroke();
    ctx.fillStyle = '#eaa871'; ctx.fillRect(-25, -10, 5, 13); ctx.fillRect(20, -10, 5, 13);
    // Bastón animado al atacar
    if (p.hug) { ctx.strokeStyle = '#f1bf83'; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(20, -8); ctx.quadraticCurveTo(39, -25, 50, -9); ctx.stroke(); }
    else {
      ctx.save(); ctx.translate(17, 1);
      if (p.attack > 0) { ctx.rotate(-1.65 + p.attack * 2.2); ctx.strokeStyle = '#fff2a1'; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(0, 0, 48, -1.2, .8); ctx.stroke(); }
      else ctx.rotate(-.16 + Math.sin(time * 3) * .08);
      ctx.fillStyle = '#754932'; ctx.fillRect(0, -3, 55, 6); ctx.fillStyle = '#efc47b'; ctx.fillRect(48, -4, 8, 8); ctx.restore();
      if (p.attack > 0) { ctx.strokeStyle = '#fff4c2'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(12, -1, 47, -1.4, .75); ctx.stroke(); }
    }
    ctx.restore();
  }

  function drawEnemy(e, x) {
    ctx.save(); ctx.translate(x, e.y + e.h / 2 + (e.type === 'tractor' ? Math.sin(e.phase * 2) * 2 : Math.sin(e.phase) * 1.5));
    if (e.hurt > 0) ctx.globalAlpha = .55;
    if (e.type === 'npc') {
      ctx.fillStyle = '#6e475e'; ctx.fillRect(-16, -2, 32, 25); ctx.fillStyle = '#f1be89'; ctx.fillRect(-20, -24, 40, 27);
      ctx.fillStyle = '#4a394f'; ctx.fillRect(-21, -28, 42, 8); ctx.fillRect(-18, 22, 11, 6); ctx.fillRect(7, 22, 11, 6);
      ctx.fillStyle = '#29243b'; ctx.fillRect(-10, -16, 5, 6); ctx.fillRect(6, -16, 5, 6); ctx.fillStyle = '#fff'; ctx.fillRect(-9, -15, 2, 2);
      ctx.strokeStyle = '#9b4e56'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-5, -4); ctx.quadraticCurveTo(0, 1, 6, -4); ctx.stroke();
      text('?', 23, -29, 13, '#fff2a0');
    } else drawTractor(e);
    ctx.restore();
  }
  function drawTractor(e) {
    const wheel = Math.sin(e.phase * 4) * .16;
    ctx.fillStyle = '#334642'; ctx.beginPath(); ctx.ellipse(-22, 21, 18, 18, wheel, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.ellipse(26, 22, 12, 12, -wheel, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#a4e266'; ctx.beginPath(); ctx.ellipse(-22, 21, 7, 7, 0, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.ellipse(26, 22, 5, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ed9b47'; ctx.fillRect(-41, -9, 78, 28); ctx.fillStyle = '#ffc65d'; ctx.fillRect(-39, -14, 64, 15);
    ctx.fillStyle = '#6cae68'; ctx.fillRect(-3, -34, 30, 25); ctx.fillStyle = '#8ed58a'; ctx.fillRect(0, -31, 23, 18);
    ctx.fillStyle = '#4b6654'; ctx.fillRect(-32, -28, 25, 19); ctx.fillStyle = '#b8f5de'; ctx.fillRect(-29, -25, 19, 13);
    ctx.fillStyle = '#253347'; ctx.fillRect(5, -25, 5, 7); ctx.fillRect(16, -25, 5, 7); ctx.fillStyle = '#fff'; ctx.fillRect(6, -25, 2, 2); ctx.fillRect(17, -25, 2, 2);
    ctx.strokeStyle = '#5c4337'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(12, -13, 6, .2, Math.PI - .2); ctx.stroke();
    ctx.fillStyle = '#ffe9a3'; ctx.fillRect(31, -2, 9, 8); ctx.fillStyle = '#d9ff93'; ctx.fillRect(-43, -1, 5, 8);
    ctx.fillStyle = '#fff2a1'; ctx.fillRect(-33, -42, 20, 7); ctx.fillStyle = '#543e48'; ctx.font = '6px "DM Mono", monospace'; ctx.textAlign = 'center'; ctx.fillText('BRUM', -23, -37);
  }

  function drawBoss(boss, x) {
    ctx.save(); ctx.translate(x, boss.y + Math.sin(boss.bob) * 4);
    // Caricatura satírica y genérica de un polemista televisivo; no es un retrato realista.
    ctx.fillStyle = '#352a46'; ctx.fillRect(-31, 0, 62, 70); ctx.fillStyle = '#f0d7b6'; ctx.fillRect(-25, 8, 50, 42);
    ctx.fillStyle = '#d9a178'; ctx.fillRect(-22, 5, 44, 13); ctx.fillStyle = '#e8ba72'; ctx.fillRect(-26, -4, 52, 16); ctx.fillRect(-30, 5, 13, 10);
    ctx.fillStyle = '#29263a'; ctx.fillRect(-14, 19, 7, 7); ctx.fillRect(7, 19, 7, 7); ctx.fillStyle = '#fff'; ctx.fillRect(-12, 20, 2, 2); ctx.fillRect(9, 20, 2, 2);
    ctx.strokeStyle = '#8f504d'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-6, 37); ctx.quadraticCurveTo(0, 42, 7, 36); ctx.stroke();
    ctx.fillStyle = '#ef718b'; ctx.fillRect(-7, 2, 14, 33); ctx.fillStyle = '#f4dbaf'; ctx.beginPath(); ctx.moveTo(0, 5); ctx.lineTo(-8, 17); ctx.lineTo(0, 28); ctx.lineTo(8, 17); ctx.fill();
    ctx.fillStyle = '#2b2638'; ctx.fillRect(-25, 67, 19, 32); ctx.fillRect(6, 67, 19, 32); ctx.fillStyle = '#dfb174'; ctx.fillRect(-28, 96, 25, 7); ctx.fillRect(5, 96, 25, 7);
    ctx.fillStyle = '#f2dbac'; ctx.fillRect(20, 35, 24, 6); ctx.fillStyle = '#bb784e'; ctx.fillRect(40, 32, 8, 12); // mic
    ctx.fillStyle = '#eae2d0'; ctx.fillRect(-49, 42, 23, 18); ctx.strokeStyle = '#bdaec4'; ctx.strokeRect(-49, 42, 23, 18);
    text('DEBATE', 0, -18, 7, '#fff2b3');
    ctx.restore();
  }

  function drawProjectile(s) {
    ctx.save(); ctx.translate(s.x - state.camera, s.y); ctx.rotate(s.rot);
    if (s.type === 'mic') {
      ctx.strokeStyle = '#332b43'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(0, -5); ctx.lineTo(0, 17); ctx.stroke();
      ctx.fillStyle = '#f2d89e'; ctx.beginPath(); ctx.ellipse(0, -9, 7, 10, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#4b4260'; ctx.fillRect(-4, -13, 8, 8);
    } else { ctx.fillStyle = '#fff5dd'; ctx.fillRect(-10, -7, 20, 15); ctx.fillStyle = '#db8194'; ctx.fillRect(-6, -3, 12, 2); ctx.fillRect(-6, 1, 8, 2); }
    ctx.restore();
  }

  function drawParticles() {
    const offset = state.mode === 'ending' ? 0 : state.camera;
    for (const p of state.particles) {
      ctx.globalAlpha = clamp(p.life / p.maxLife, 0, 1); ctx.fillStyle = p.color;
      if (p.shape === 'text') { ctx.font = '700 12px "Space Grotesk", sans-serif'; ctx.textAlign = 'center'; ctx.fillText(p.label, p.x - offset, p.y); }
      else if (p.shape === 'star') { ctx.font = `${p.size * 2}px sans-serif`; ctx.textAlign = 'center'; ctx.fillText('✦', p.x - offset, p.y); }
      else if (p.shape === 'heart') { ctx.font = `${p.size * 2}px sans-serif`; ctx.textAlign = 'center'; ctx.fillText('♥', p.x, p.y); }
      else { ctx.beginPath(); ctx.arc(p.x - offset, p.y, p.size, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.globalAlpha = 1;
  }

  function drawEndScene() {
    const t = state.endClock;
    if (state.endType === 'win') {
      const pastelSky = ctx.createLinearGradient(0, 0, 0, H);
      pastelSky.addColorStop(0, '#f4d8ee'); pastelSky.addColorStop(.58, '#ffe8c8'); pastelSky.addColorStop(1, '#cdeee4');
      ctx.fillStyle = pastelSky; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#fff2b7'; ctx.beginPath(); ctx.arc(770, 110, 47, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff8ec';
      for (let i = 0; i < 5; i++) { const x = 70 + i * 205; const y = 93 + (i % 2) * 55; ctx.beginPath(); ctx.ellipse(x, y, 34, 9, 0, 0, Math.PI * 2); ctx.ellipse(x + 15, y - 6, 18, 12, 0, 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = '#d7e9d8'; ctx.beginPath(); ctx.moveTo(0, FLOOR); ctx.quadraticCurveTo(180, 328, 380, FLOOR); ctx.quadraticCurveTo(640, 345, 960, FLOOR); ctx.fill();
      ctx.fillStyle = '#f9d7e5'; ctx.fillRect(0, FLOOR, W, H - FLOOR);
      ctx.fillStyle = '#fff0d6'; ctx.beginPath(); ctx.ellipse(480, 427, 190, 31, 0, 0, Math.PI * 2); ctx.fill();
      const arrival = clamp((t - .5) / 2, 0, 1);
      drawPlayer({ ...makePlayer(), x: 410, y: 349, facing: 1, grounded: true, attack: 0, hurt: 0, walkBob: 0, hug: true }, 410, t);
      drawBallerina(495, -45 + arrival * 395, t);
      if (t > 1.2) { ctx.strokeStyle = '#ff83aa'; ctx.lineWidth = 9; ctx.beginPath(); ctx.arc(480, 350, 50, .2, 2.7); ctx.stroke(); ctx.fillStyle = '#ff83aa'; ctx.font = '24px sans-serif'; ctx.fillText('♥', 475, 315); }
      if (t > 1) { ctx.globalAlpha = Math.min(.38, (t - 1) * .12); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
    } else {
      drawBackground(1, 0, t);
      const fade = clamp(t / 5, 0, 1); ctx.fillStyle = `rgba(18,20,45,${fade * .76})`; ctx.fillRect(0, 0, W, H);
      const walkIn = Math.min(Math.max(0, t - 1) * 18, 110);
      const rise = clamp((t - 3) * 28, 0, 165);
      drawGod(670, 310 - rise);
      const playerX = 430 + walkIn;
      const playerY = FLOOR - 76 - rise;
      drawPlayer({ ...makePlayer(), x: playerX, y: playerY, facing: 1, grounded: true, attack: 0, hurt: 0, walkBob: t < 5 ? Math.sin(t * 4) : 0, hug: t > 4 }, playerX, t);
      if (t > 7) { ctx.fillStyle = `rgba(255,255,255,${clamp((t - 7) / 3, 0, 1)})`; ctx.fillRect(0, 0, W, H); }
    }
    drawParticles();
  }
  function drawBallerina(x, y, t) {
    ctx.save(); ctx.translate(x, y + Math.sin(t * 4) * 5); ctx.rotate(-.08);
    ctx.fillStyle = '#6d4c77'; ctx.beginPath(); ctx.arc(0, -25, 16, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f0c89f'; ctx.beginPath(); ctx.arc(0, -30, 12, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff4e8'; ctx.beginPath(); ctx.moveTo(0, -17); ctx.lineTo(-24, 7); ctx.lineTo(23, 7); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#f6e8fa'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(0, -5); ctx.lineTo(-16, 22); ctx.moveTo(1, -4); ctx.lineTo(17, 20); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(-22, 7, 23, 10, -.25, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.ellipse(22, 7, 23, 10, .25, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ff9bbd'; ctx.beginPath(); ctx.arc(-4, -32, 2, 0, Math.PI * 2); ctx.arc(4, -32, 2, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
  function drawGod(x, y) {
    ctx.save(); ctx.translate(x, y); ctx.globalAlpha = .55 + Math.sin(state.endClock * 2) * .08;
    const glow = ctx.createRadialGradient(0, 0, 15, 0, 0, 130); glow.addColorStop(0, '#fff7bd'); glow.addColorStop(1, '#fff7bd00'); ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(0, 0, 130, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
    ctx.fillStyle = '#fff4cc'; ctx.beginPath(); ctx.ellipse(0, 0, 42, 57, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#e9bd8f'; ctx.beginPath(); ctx.arc(0, -46, 22, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#fff8e4'; ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(-29, -2); ctx.lineTo(-61, 8); ctx.moveTo(29, -2); ctx.lineTo(54, 15); ctx.stroke();
    ctx.fillStyle = '#554a5d'; ctx.beginPath(); ctx.arc(-8, -48, 3, 0, Math.PI * 2); ctx.arc(8, -48, 3, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#bd7d70'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, -39, 7, .2, Math.PI - .2); ctx.stroke();
    ctx.fillStyle = '#fff0ad'; ctx.font = '16px sans-serif'; ctx.fillText('✦', -63, -51); ctx.fillText('✦', 55, -65); ctx.restore();
  }

  function render() {
    ctx.save();
    if (state.shake > 0 && state.mode === 'play') ctx.translate(rand(-6, 6) * state.shake * 4, rand(-4, 4) * state.shake * 4);
    if (state.mode === 'ending') drawEndScene();
    else {
      const stage = state.mode === 'menu' ? 1 : state.stage;
      drawBackground(stage, state.mode === 'menu' ? 0 : state.camera, state.menuTime);
      if (state.mode === 'menu') {
        const p = { ...makePlayer(), x: 690, y: FLOOR - 76 + Math.sin(state.menuTime * 2.2) * 7, grounded: true, facing: -1, attack: .1 + Math.max(0, Math.sin(state.menuTime * 1.8)) * .13, walkBob: Math.sin(state.menuTime * 4) * 2 };
        drawPlayer(p, p.x, state.menuTime);
        if (Math.random() < .035) addParticles(rand(610, 800), rand(230, 380), 1, ['#fff2a1', '#d8ff72'], 25, ['star']);
      } else {
        for (const e of state.enemies) if (e.alive) drawEnemy(e, e.x - state.camera);
        if (state.stage === 3 && state.boss) drawBoss(state.boss, state.boss.x - state.camera);
        for (const shot of state.projectiles) drawProjectile(shot);
        drawPlayer(state.player, state.player.x - state.camera);
        drawParticles();
        if (state.mode === 'transition') { /* la capa HTML gestiona la transición */ }
      }
    }
    ctx.restore();
  }

  function loop(now) {
    const dt = Math.min(.034, (now - (state.lastTime || now)) / 1000); state.lastTime = now;
    update(dt); render(); requestAnimationFrame(loop);
  }

  function toggleSound() {
    state.audioOn = !state.audioOn; $('soundLabel').textContent = state.audioOn ? 'SONIDO ON' : 'SONIDO OFF'; $('soundToggle').setAttribute('aria-label', state.audioOn ? 'Silenciar sonido' : 'Activar sonido');
    if (state.audioOn) {
      audio.ensure();
      if (state.mode === 'ending' && state.endType === 'lose') clearInterval(state.musicTimer);
      else audio.setMusic(state.mode === 'ending' ? 'win' : state.mode === 'menu' ? 'menu' : state.stage === 3 ? 'boss' : state.stage === 2 ? 'stage2' : 'stage1');
      audio.sfx('click');
    }
    else clearInterval(state.musicTimer);
  }
  function pauseGame() {
    if (state.mode !== 'play') return;
    state.keys.clear(); state.touch.clear();
    state.mode = 'pause'; showScreen('pauseScreen'); $('hud').hidden = true; $('touchControls').hidden = true; $('debateControls').hidden = true;
  }

  $('playButton').addEventListener('click', beginGame);
  $('instructionsButton').addEventListener('click', () => showScreen('instructionsScreen'));
  $('creditsButton').addEventListener('click', () => showScreen('creditsScreen'));
  document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => showScreen(button.dataset.close, false)));
  $('soundToggle').addEventListener('click', toggleSound);
  $('resumeButton').addEventListener('click', () => { hideAllScreens(); state.mode = 'play'; setHUD(); audio.ensure(); });
  $('pauseMenuButton').addEventListener('click', returnToMenu);
  $('continueButton').addEventListener('click', () => startStage(state.transitionNext));
  $('endingMenuButton').addEventListener('click', returnToMenu);
  $('againButton').addEventListener('click', beginGame);
  document.querySelectorAll('[data-argument]').forEach((button) => button.addEventListener('click', () => chooseArgument(Number(button.dataset.argument))));

  window.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();
    if ([' ', 'arrowleft', 'arrowright', 'arrowup'].includes(key)) event.preventDefault();
    if (key === 'escape') {
      if (state.mode === 'play') pauseGame();
      else if (state.mode === 'pause') { hideAllScreens(); state.mode = 'play'; $('hud').hidden = false; setHUD(); }
      return;
    }
    if (key === 'm') { toggleSound(); return; }
    if (key === 'r' && state.mode === 'ending') { beginGame(); return; }
    if (key === 'j' && !event.repeat) startAttack();
    state.keys.add(key);
  });
  $('pauseButton').addEventListener('click', pauseGame);
  window.addEventListener('keyup', (event) => state.keys.delete(event.key.toLowerCase()));
  window.addEventListener('blur', () => { state.keys.clear(); state.touch.clear(); });

  document.querySelectorAll('[data-control]').forEach((button) => {
    const control = button.dataset.control;
    const press = (event) => { event.preventDefault(); audio.ensure(); if (control === 'attack') startAttack(); else state.touch.add(control); };
    const release = (event) => { event.preventDefault(); state.touch.delete(control); };
    button.addEventListener('pointerdown', press); button.addEventListener('pointerup', release); button.addEventListener('pointercancel', release); button.addEventListener('pointerleave', release);
  });

  let quoteIndex = Math.floor(Math.random() * quotes.length); $('tagline').textContent = quotes[quoteIndex];
  setInterval(() => { if (state.mode === 'menu') { quoteIndex = (quoteIndex + 1 + Math.floor(Math.random() * (quotes.length - 1))) % quotes.length; $('tagline').textContent = quotes[quoteIndex]; } }, 7500);
  audio.setMusic('menu');
  requestAnimationFrame(loop);
})();
