"use strict";
/* Larigou Questões — Fase 3: simulados (montar, fazer com cronômetro, corrigir no final). */

function formatarTempo(seg) {
  seg = Math.max(0, Math.round(seg));
  const h = Math.floor(seg / 3600), m = Math.floor((seg % 3600) / 60), s = seg % 60;
  const dois = n => String(n).padStart(2, "0");
  return h ? `${h}:${dois(m)}:${dois(s)}` : `${dois(m)}:${dois(s)}`;
}

function tempoPorExtenso(seg) {
  const h = Math.floor(seg / 3600), m = Math.round((seg % 3600) / 60);
  if (!h) return `${m} min`;
  return `${h} h${m ? ` ${m} min` : ""}`;
}

function dataCurta(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR") + " às " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

// ------------------------------------------------------------------ lista + montar simulado
async function telaSimulados() {
  saindo = null;
  pararCronometro();
  const [meta, lista] = await Promise.all([carregarMeta(true), api("/api/simulados")]);
  const f = novosFiltros({ ...lerLocal("larigou.filtrosSimulado", {}), ordem: "" });
  const cfg = { modo: "filtros", quantidade: 20, comTempo: true, minutos: 60, anula: true, ...lerLocal("larigou.configSimulado", {}) };

  const emAndamento = lista.filter(s => s.estado === "andamento");
  const feitos = lista.filter(s => s.estado === "finalizado");
  const cartao = s => {
    const r = s.resultado?.geral;
    return `<a class="painel cartao-simulado" href="#/simulados/${s.id}${s.estado === "finalizado" ? "/resultado" : ""}">
      <div>
        <strong>${esc(s.titulo)}</strong>
        <div class="dica">${dataCurta(s.finalizado_em || s.criado_em)}, ${s.n} questões${s.duracao_min ? `, ${tempoPorExtenso(s.duracao_min * 60)}` : ""}</div>
      </div>
      ${s.estado === "finalizado"
        ? `<span class="nota-cartao ${r.percentual >= 70 ? "boa" : r.percentual >= 50 ? "media" : "baixa"}">${r.percentual.toLocaleString("pt-BR")}%</span>`
        : `<span class="botao pequeno primario">Continuar (${s.respondidas || 0}/${s.n})</span>`}
    </a>`;
  };

  main.innerHTML = `
    <div class="simulados">
      <h1>Simulados</h1>
      ${emAndamento.length ? `<section><h2>Em andamento</h2><div class="lista-revisao">${emAndamento.map(cartao).join("")}</div></section>` : ""}
      <section class="painel montar">
        <h2>Montar simulado</h2>
        <div class="alternar" role="group" aria-label="Como montar">
          <button type="button" data-modo="filtros" aria-pressed="${cfg.modo === "filtros"}">Escolher por filtros</button>
          <button type="button" data-modo="prova" aria-pressed="${cfg.modo === "prova"}">Prova completa original</button>
        </div>
        <form id="form-sim-filtros" ${cfg.modo === "prova" ? "hidden" : ""} style="margin-top:20px">
          ${htmlFiltros(f, meta, { ordem: false })}
          <div class="linha-campos">
            <label class="campo"><span>Quantidade de questões</span>
              <input class="entrada" type="number" min="1" max="500" name="quantidade" value="${cfg.quantidade}"></label>
            <p class="dica" id="disponiveis" style="align-self:end;margin:0 0 10px"></p>
          </div>
          <p class="dica">As questões são sorteadas entre as que atendem aos filtros e agrupadas por disciplina, como numa prova.</p>
        </form>
        <div id="form-sim-prova" ${cfg.modo === "prova" ? "" : "hidden"} style="margin-top:20px">
          <label class="campo"><span>Prova</span>
            <select class="entrada" id="prova-sim">${meta.provas.map(p => `<option value="${p.id}">${esc(p.orgao)} — ${esc(p.cargo)} ${p.ano ? `(${p.ano})` : ""}, ${p.n} questões</option>`).join("")}</select></label>
        </div>
        <hr class="divisor">
        <div class="linha-campos">
          <label class="check"><input type="checkbox" id="com-tempo" ${cfg.comTempo ? "checked" : ""}> Com tempo limite</label>
          <label class="campo" id="campo-minutos" ${cfg.comTempo ? "" : "hidden"}><span>Minutos</span>
            <input class="entrada" type="number" min="1" max="600" id="minutos" value="${cfg.minutos}"></label>
          <p class="dica" id="dica-tempo" style="align-self:end;margin:0 0 10px"></p>
        </div>
        <label class="check" id="linha-anula" hidden style="margin-top:12px">
          <input type="checkbox" id="anula" ${cfg.anula ? "checked" : ""}> Certo/Errado: uma errada anula uma certa (estilo Cebraspe)</label>
        <label class="campo" style="margin-top:16px;max-width:520px"><span>Nome do simulado (opcional)</span>
          <input class="entrada" id="titulo-sim" placeholder="Ex.: Revisão de farmacologia"></label>
        <div class="linha-atalhos"><button class="botao primario" type="button" id="iniciar-sim">Iniciar simulado</button></div>
      </section>
      ${feitos.length ? `<section style="margin-top:32px"><h2>Já feitos</h2><div class="lista-revisao">${feitos.map(cartao).join("")}</div></section>` : ""}
    </div>`;

  let disponiveis = 0, tiposDisp = [];
  const salvarCfg = () => {
    gravarLocal("larigou.filtrosSimulado", f);
    gravarLocal("larigou.configSimulado", cfg);
  };
  const qtdEfetiva = () => cfg.modo === "prova"
    ? (meta.provas.find(p => String(p.id) === $("#prova-sim").value)?.n || 0)
    : Math.min(cfg.quantidade, disponiveis);
  const atualizarDicas = () => {
    const n = qtdEfetiva();
    $("#dica-tempo").textContent = cfg.comTempo && n ? `${(cfg.minutos / n).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} min por questão` : "";
    $("#linha-anula").hidden = !(cfg.modo === "filtros" ? tiposDisp.includes("CE") : false);
  };
  let t;
  const contar = () => {
    salvarCfg();
    clearTimeout(t);
    t = setTimeout(async () => {
      const r = await api("/api/simulados/contar", { method: "POST", body: { filtros: f } });
      disponiveis = r.total; tiposDisp = r.tipos;
      $("#disponiveis").textContent = `${r.total} ${r.total === 1 ? "disponível" : "disponíveis"} com esses filtros`;
      atualizarDicas();
    }, 150);
  };
  ligarFiltros($("#form-sim-filtros"), f, meta, contar);
  $$("[data-modo]").forEach(b => b.onclick = () => {
    cfg.modo = b.dataset.modo;
    $$("[data-modo]").forEach(x => x.setAttribute("aria-pressed", x === b));
    $("#form-sim-filtros").hidden = cfg.modo !== "filtros";
    $("#form-sim-prova").hidden = cfg.modo !== "prova";
    salvarCfg(); atualizarDicas();
  });
  $("[name=quantidade]").oninput = e => { cfg.quantidade = Number(e.target.value) || 1; salvarCfg(); atualizarDicas(); };
  $("#prova-sim").onchange = atualizarDicas;
  $("#com-tempo").onchange = e => { cfg.comTempo = e.target.checked; $("#campo-minutos").hidden = !cfg.comTempo; salvarCfg(); atualizarDicas(); };
  $("#minutos").oninput = e => { cfg.minutos = Number(e.target.value) || 1; salvarCfg(); atualizarDicas(); };
  $("#anula").onchange = e => { cfg.anula = e.target.checked; salvarCfg(); };
  $("#iniciar-sim").onclick = async () => {
    try {
      const r = await api("/api/simulados", { method: "POST", body: {
        modo: cfg.modo, filtros: f, quantidade: cfg.quantidade, prova_id: Number($("#prova-sim").value),
        duracao_min: cfg.comTempo ? cfg.minutos : null, anula_errada: cfg.anula && !$("#linha-anula").hidden,
        titulo: $("#titulo-sim").value } });
      location.hash = `#/simulados/${r.id}`;
    } catch (e) { avisar(e.message, "erro"); }
  };
  contar();
}

// ------------------------------------------------------------------ fazendo o simulado
let cron = null; // { sid, base, inicio, limite, timer, salvador }

function segundosGastos() {
  if (!cron) return 0;
  return cron.pausado ? cron.base : cron.base + (Date.now() - cron.inicio) / 1000;
}

function salvarTempo(usarBeacon = false) {
  if (!cron) return;
  const corpo = JSON.stringify({ tempo_gasto_seg: Math.round(segundosGastos()) });
  if (usarBeacon && navigator.sendBeacon) navigator.sendBeacon(`/api/simulados/${cron.sid}/tempo`, new Blob([corpo], { type: "application/json" }));
  else api(`/api/simulados/${cron.sid}/tempo`, { method: "PUT", body: corpo }).catch(() => {});
}

function pararCronometro() {
  if (!cron) return;
  salvarTempo();
  clearInterval(cron.timer);
  clearInterval(cron.salvador);
  cron = null;
}
window.addEventListener("pagehide", () => salvarTempo(true));
document.addEventListener("visibilitychange", () => {
  if (!cron) return;
  if (document.hidden) { salvarTempo(true); cron.base = segundosGastos(); cron.pausado = true; }
  else if (cron.pausado) { cron.inicio = Date.now(); cron.pausado = false; }
});

let estadoSim = null; // { sim, atual }

async function telaFazerSimulado(sidStr) {
  saindo = null;
  pararCronometro();
  const sid = Number(sidStr);
  const sim = await api(`/api/simulados/${sid}`);
  if (sim.estado === "finalizado") { location.hash = `#/simulados/${sid}/resultado`; return; }
  const primeiraEmBranco = sim.questoes.findIndex(q => !q.resposta);
  estadoSim = { sim, atual: lerLocal(`larigou.sim${sid}.atual`, primeiraEmBranco >= 0 ? primeiraEmBranco : 0) };

  main.innerHTML = `
    <div class="fazer-simulado">
      <header class="barra-simulado">
        <div class="titulo-sim"><strong>${esc(sim.titulo)}</strong>
          <span class="dica" id="respondidas"></span></div>
        <div class="cronometro" id="cronometro" role="timer" aria-live="off" title="${sim.duracao_min ? "Tempo restante" : "Tempo gasto"}"></div>
        <button class="botao primario" type="button" id="entregar">Entregar</button>
      </header>
      <div class="sim-layout">
        <article class="resolver" id="questao-sim" aria-live="polite"></article>
        <aside class="mapa-coluna">
          <h2 class="mapa-titulo">Mapa da prova</h2>
          <div class="mapa" id="mapa" role="list"></div>
          <p class="dica legenda-mapa"><span class="amostra respondida"></span> respondida <span class="amostra revisar"></span> revisar depois</p>
          <p class="dica">O cronômetro só corre com o simulado aberto. Pode sair e voltar depois.</p>
        </aside>
      </div>
    </div>`;

  cron = { sid, base: sim.tempo_gasto_seg, inicio: Date.now(), limite: sim.duracao_min ? sim.duracao_min * 60 : null };
  const tique = () => {
    if (!cron) return;
    const gasto = segundosGastos();
    const el = $("#cronometro");
    if (!el) return pararCronometro();
    if (cron.limite) {
      const resta = cron.limite - gasto;
      el.textContent = formatarTempo(resta);
      el.classList.toggle("acabando", resta <= 300);
      if (resta <= 0) { entregarSimulado(true); }
    } else el.textContent = formatarTempo(gasto);
  };
  tique();
  cron.timer = setInterval(tique, 1000);
  cron.salvador = setInterval(() => salvarTempo(), 15000);

  $("#entregar").onclick = () => entregarSimulado(false);
  desenharMapa();
  desenharQuestaoSim();
}

function desenharMapa() {
  const { sim, atual } = estadoSim;
  $("#mapa").innerHTML = sim.questoes.map((q, i) => `<button type="button" role="listitem" class="celula-mapa
    ${q.resposta ? "respondida" : ""} ${q.revisar ? "revisar" : ""}" data-i="${i}" aria-current="${i === atual}"
    aria-label="Questão ${i + 1}${q.resposta ? ", respondida" : ", em branco"}${q.revisar ? ", marcada para revisar" : ""}">${i + 1}</button>`).join("");
  $("#mapa").onclick = e => { const b = e.target.closest("[data-i]"); if (b) irParaSim(Number(b.dataset.i)); };
  const n = sim.questoes.filter(q => q.resposta).length;
  $("#respondidas").textContent = `${n} de ${sim.questoes.length} respondidas`;
}

function irParaSim(i) {
  const { sim } = estadoSim;
  if (i < 0 || i >= sim.questoes.length) return;
  estadoSim.atual = i;
  gravarLocal(`larigou.sim${sim.id}.atual`, i);
  desenharMapa();
  desenharQuestaoSim();
  $("#questao-sim").scrollIntoView({ block: "start" });
}

function desenharQuestaoSim() {
  const { sim, atual } = estadoSim;
  const q = sim.questoes[atual];
  const tb = q.texto_base_id ? sim.textos_base[q.texto_base_id] : null;
  const tbAntes = atual > 0 && sim.questoes[atual - 1].texto_base_id === q.texto_base_id;
  $("#questao-sim").innerHTML = `
    <header class="questao-cabeca">
      <div>
        <h1 class="questao-titulo">Questão ${atual + 1} <span>de ${sim.questoes.length}</span></h1>
        <div class="questao-meta"><span class="etiqueta roxa">${esc(q.disciplina || "Sem disciplina")}</span></div>
      </div>
      <div class="questao-acoes">
        <button type="button" class="botao pequeno" id="revisar" aria-pressed="${!!q.revisar}" title="Marcar para revisar (R)">
          ${q.revisar ? "Marcada para revisar" : "Revisar depois"}</button>
      </div>
    </header>
    ${tb ? `<details class="texto-base leitura-tb" ${tbAntes ? "" : "open"}>
      <summary>Texto${tb.titulo ? ": " + esc(tb.titulo) : ""}</summary>
      <div class="conteudo-tb leitura">${formatar(tb.conteudo)}</div></details>` : ""}
    <div class="leitura enunciado">${formatar(q.enunciado)}</div>
    <div class="opcoes ${q.tipo === "CE" ? "opcoes-ce" : ""}" id="opcoes-sim" role="radiogroup" aria-label="Alternativas"></div>
    ${q.tipo === "CE" ? `<p class="dica">Clique de novo na opção marcada para deixar em branco.</p>` : ""}
    <div class="barra-resposta">
      <button type="button" class="botao" id="sim-ant" ${atual === 0 ? "disabled" : ""}>Anterior</button>
      <span class="espaco"></span>
      <button type="button" class="botao primario" id="sim-prox">${atual + 1 < sim.questoes.length ? "Próxima" : "Revisar e entregar"}</button>
    </div>
    <p class="dica atalhos">Atalhos: ${q.tipo === "CE" ? "C ou E marca" : "A a E marca, Shift + letra risca"}; setas navegam; R marca para revisar.</p>`;
  desenharOpcoesSim();
  $("#sim-ant").onclick = () => irParaSim(atual - 1);
  $("#sim-prox").onclick = () => atual + 1 < sim.questoes.length ? irParaSim(atual + 1) : entregarSimulado(false);
  $("#revisar").onclick = alternarRevisar;
}

function desenharOpcoesSim() {
  const q = estadoSim.sim.questoes[estadoSim.atual];
  const box = $("#opcoes-sim");
  const riscadas = new Set(q.riscadas || []);
  if (q.tipo === "CE") {
    box.innerHTML = [["C", "Certo"], ["E", "Errado"]].map(([l, rot]) => `<button type="button" role="radio"
      aria-checked="${q.resposta === l}" class="opcao-ce ${l === "C" ? "certo" : "errado"} ${q.resposta === l ? "selecionada" : ""}"
      data-letra="${l}">${rot}</button>`).join("");
  } else {
    box.innerHTML = q.alternativas.map(a => {
      const l = a.letra, sel = q.resposta === l;
      return `<div class="opcao ${sel ? "selecionada" : ""} ${riscadas.has(l) ? "riscada" : ""}">
        <button type="button" class="opcao-escolher" role="radio" aria-checked="${sel}" data-letra="${l}">
          <span class="hex ${sel ? "marcado" : ""}" aria-hidden="true"><span>${l}</span></span>
          <span class="opcao-texto">${formatarInline(a.texto)}</span></button>
        <button type="button" class="opcao-riscar" data-riscar="${l}" aria-pressed="${riscadas.has(l)}"
          aria-label="${riscadas.has(l) ? "Desfazer risco da" : "Riscar"} alternativa ${l}" title="Riscar (Shift+${l})">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12"/></svg>
        </button></div>`;
    }).join("");
  }
  box.onclick = e => {
    const r = e.target.closest("[data-riscar]");
    if (r) return riscarSim(r.dataset.riscar);
    const b = e.target.closest("[data-letra]");
    if (b) marcarSim(b.dataset.letra);
  };
  box.oncontextmenu = e => {
    const b = e.target.closest(".opcao [data-letra]");
    if (b) { e.preventDefault(); riscarSim(b.dataset.letra); }
  };
}

async function salvarNoSim(q, corpo) {
  try {
    await api(`/api/simulados/${estadoSim.sim.id}/resposta`, { method: "PUT",
      body: { ordem: q.ordem, tempo_gasto_seg: Math.round(segundosGastos()), ...corpo } });
  } catch (e) { avisar(e.message, "erro"); }
}

function marcarSim(letra) {
  const q = estadoSim.sim.questoes[estadoSim.atual];
  q.resposta = q.resposta === letra ? null : letra; // clicar de novo deixa em branco
  if (q.riscadas?.includes(letra)) q.riscadas = q.riscadas.filter(x => x !== letra);
  desenharOpcoesSim();
  desenharMapa();
  $(`#opcoes-sim [data-letra="${letra}"]`)?.focus({ preventScroll: true });
  salvarNoSim(q, { resposta: q.resposta, riscadas: q.riscadas || [] });
}

function riscarSim(letra) {
  const q = estadoSim.sim.questoes[estadoSim.atual];
  if (q.tipo === "CE") return;
  const r = new Set(q.riscadas || []);
  if (r.has(letra)) r.delete(letra);
  else { r.add(letra); if (q.resposta === letra) q.resposta = null; }
  q.riscadas = [...r];
  desenharOpcoesSim();
  desenharMapa();
  salvarNoSim(q, { riscadas: q.riscadas, resposta: q.resposta });
}

function alternarRevisar() {
  const q = estadoSim.sim.questoes[estadoSim.atual];
  q.revisar = q.revisar ? 0 : 1;
  $("#revisar").setAttribute("aria-pressed", !!q.revisar);
  $("#revisar").textContent = q.revisar ? "Marcada para revisar" : "Revisar depois";
  desenharMapa();
  salvarNoSim(q, { revisar: q.revisar });
}

async function entregarSimulado(tempoEsgotado) {
  if (!estadoSim || !cron) return;
  const { sim } = estadoSim;
  if (!tempoEsgotado) {
    const brancos = sim.questoes.filter(q => !q.resposta).length;
    const revisar = sim.questoes.filter(q => q.revisar).length;
    const partes = [];
    if (brancos) partes.push(`${brancos} em branco`);
    if (revisar) partes.push(`${revisar} marcada${revisar > 1 ? "s" : ""} para revisar`);
    if (!confirm(`Entregar o simulado?${partes.length ? `\n\nVocê tem ${partes.join(" e ")}.` : ""}\n\nDepois de entregar não dá para mudar as respostas.`)) return;
  }
  const gasto = Math.round(segundosGastos());
  clearInterval(cron.timer); clearInterval(cron.salvador);
  cron = null;
  try {
    await api(`/api/simulados/${sim.id}/finalizar`, { method: "POST", body: { tempo_gasto_seg: gasto } });
    try { localStorage.removeItem(`larigou.sim${sim.id}.atual`); } catch (e) {}
    if (tempoEsgotado) avisar("O tempo acabou. Simulado entregue.");
    location.hash = `#/simulados/${sim.id}/resultado`;
  } catch (e) { avisar(e.message, "erro"); }
}

// ------------------------------------------------------------------ resultado
async function telaResultadoSimulado(sidStr) {
  saindo = null;
  pararCronometro();
  const sim = await api(`/api/simulados/${sidStr}`);
  if (sim.estado !== "finalizado") { location.hash = `#/simulados/${sidStr}`; return; }
  const r = sim.resultado, g = r.geral;
  const situacao = Object.fromEntries(r.itens.map(i => [i.ordem, i.situacao]));
  const disc = Object.entries(r.por_disciplina).sort((a, b) => b[1].total - a[1].total);
  const ROTULO = { certa: "Certa", errada: "Errada", branco: "Em branco", anulada: "Anulada" };
  const liquida = r.anula_errada && r.tem_ce;

  main.innerHTML = `
    <div class="resultado-sim">
      <a class="botao-texto" href="#/simulados" style="padding-left:0">Todos os simulados</a>
      <h1>${esc(sim.titulo)}</h1>
      <p class="dica">Entregue em ${dataCurta(sim.finalizado_em)}</p>
      <section class="placar-sim">
        <div>
          <div class="numero-grande">${g.percentual.toLocaleString("pt-BR")}%</div>
          <p>${liquida ? `Nota líquida: ${g.pontos} de ${g.total} (cada errada no Certo/Errado anulou uma certa)` : `${g.pontos} de ${g.total} pontos`}</p>
        </div>
        <dl class="numeros-sim">
          <div><dt>Certas</dt><dd class="c-certo">${g.certas}</dd></div>
          <div><dt>Erradas</dt><dd class="c-errado">${g.erradas}</dd></div>
          <div><dt>Em branco</dt><dd>${g.brancos}</dd></div>
          ${g.anuladas ? `<div><dt>Anuladas</dt><dd>${g.anuladas}</dd></div>` : ""}
          <div><dt>Tempo</dt><dd>${formatarTempo(r.tempo_gasto_seg)}</dd>${sim.duracao_min ? `<span class="dica">de ${tempoPorExtenso(sim.duracao_min * 60)}</span>` : ""}</div>
        </dl>
      </section>
      ${g.anuladas ? `<p class="dica">Questões anuladas contam ponto para todos, como no concurso.</p>` : ""}

      <section class="painel">
        <h2>Por disciplina</h2>
        <table class="tabela-provas tabela-disc">
          <thead><tr><th>Disciplina</th><th class="num">Questões</th><th class="num opcional">Certas</th><th class="num opcional">Erradas</th><th class="num opcional">Branco</th><th>Aproveitamento</th></tr></thead>
          <tbody>${disc.map(([d, x]) => `<tr><td>${esc(d)}</td><td class="num">${x.total}</td><td class="num opcional">${x.certas}</td>
            <td class="num opcional">${x.erradas}</td><td class="num opcional">${x.brancos}</td>
            <td><div class="barra-pct"><span class="trilho"><span class="cheio ${x.percentual >= 70 ? "boa" : x.percentual >= 50 ? "media" : "baixa"}" style="width:${Math.max(0, x.percentual)}%"></span></span>
            <span class="valor">${x.percentual.toLocaleString("pt-BR")}%</span></div></td></tr>`).join("")}</tbody>
        </table>
      </section>

      <div class="linha-atalhos">
        ${g.erradas ? `<button class="botao primario" id="estudar-erradas" type="button">Estudar as ${g.erradas} que errei</button>` : ""}
        <a class="botao" href="#/simulados">Novo simulado</a>
        <button class="botao perigo" id="excluir-sim" type="button">Excluir simulado</button>
      </div>

      <section style="margin-top:32px">
        <div class="editor-cabeca"><h2 style="margin:0">Revisão questão a questão</h2>
          <div class="alternar" role="group" aria-label="Mostrar">
            ${[["todas", "Todas"], ["errada", "Erradas"], ["branco", "Em branco"], ["certa", "Certas"]].map(([v, t], i) =>
              `<button type="button" data-ver="${v}" aria-pressed="${i === 0}">${t}</button>`).join("")}
          </div></div>
        <div id="revisao-sim" class="revisao-sim"></div>
      </section>
    </div>`;

  const desenharRevisao = ver => {
    $("#revisao-sim").innerHTML = sim.questoes.filter(q => ver === "todas" || situacao[q.ordem] === ver).map(q => {
      const s = situacao[q.ordem];
      const tb = q.texto_base_id ? sim.textos_base[q.texto_base_id] : null;
      const nomeResp = l => q.tipo === "CE" ? ({ C: "Certo", E: "Errado" }[l] || "—") : (l || "—");
      return `<details class="item-revisao ${s}">
        <summary><span class="marca-sit ${s}">${ROTULO[s]}</span> <strong>Questão ${q.ordem}</strong>
          <span class="dica">${esc(q.disciplina || "")}${q.assunto ? " / " + esc(q.assunto) : ""}</span>
          <span class="resp-resumo">Sua: ${esc(nomeResp(q.resposta))}, gabarito: ${esc(nomeResp(q.gabarito))}</span></summary>
        <div class="corpo-revisao">
          <p class="dica">${[q.banca, q.orgao, q.cargo, q.ano].filter(Boolean).map(esc).join(", ")}${q.numero ? `, questão ${q.numero} da prova` : ""}</p>
          ${tb ? `<details class="texto-base"><summary>Ver texto${tb.titulo ? ": " + esc(tb.titulo) : ""}</summary><div class="conteudo-tb leitura">${formatar(tb.conteudo)}</div></details>` : ""}
          <div class="leitura enunciado">${formatar(q.enunciado)}</div>
          ${q.tipo === "CE" ? `<div class="opcoes opcoes-ce">${["C", "E"].map(l => `<div class="opcao-ce ${l === "C" ? "certo" : "errado"}
              ${q.gabarito === l ? "gabarito" : q.resposta === l ? "selecionada errada" : ""}">${nomeResp(l)}</div>`).join("")}</div>`
            : `<div class="opcoes">${q.alternativas.map(a => `<div class="opcao ${q.gabarito === a.letra ? "gabarito" : q.resposta === a.letra ? "errada" : ""}">
              <div class="opcao-escolher"><span class="hex ${q.resposta === a.letra ? "marcado" : ""}"><span>${a.letra}</span></span>
              <span class="opcao-texto">${formatarInline(a.texto)}</span></div></div>`).join("")}</div>`}
          <a class="botao-texto so-local" href="#/questoes/${q.id}">Abrir no editor</a>
        </div></details>`;
    }).join("") || `<p class="vazio">Nenhuma questão nesta categoria.</p>`;
  };
  desenharRevisao("todas");
  $$("[data-ver]").forEach(b => b.onclick = () => {
    $$("[data-ver]").forEach(x => x.setAttribute("aria-pressed", x === b));
    desenharRevisao(b.dataset.ver);
  });
  if ($("#estudar-erradas")) $("#estudar-erradas").onclick = () => {
    const ids = sim.questoes.filter(q => situacao[q.ordem] === "errada").map(q => q.id);
    gravarLocal("larigou.sessao", { ids, pos: 0, resultados: {}, filtros: null, inicio: new Date().toISOString() });
    location.hash = "#/resolver/1";
  };
  $("#excluir-sim").onclick = async () => {
    if (!confirm("Excluir este simulado? As respostas dele continuam no seu histórico de desempenho.")) return;
    await api(`/api/simulados/${sim.id}`, { method: "DELETE" });
    avisar("Simulado excluído");
    location.hash = "#/simulados";
  };
}

// ------------------------------------------------------------------ atalhos do simulado
document.addEventListener("keydown", e => {
  if (!estadoSim || !cron || !$(".fazer-simulado")) return;
  if (e.target.closest("input, textarea, select") || e.ctrlKey || e.metaKey || e.altKey) return;
  const q = estadoSim.sim.questoes[estadoSim.atual];
  const k = e.key.toUpperCase();
  if (e.key === "ArrowRight" || (e.key === "Enter" && !e.target.closest("a, button, summary"))) {
    e.preventDefault(); return irParaSim(estadoSim.atual + 1);
  }
  if (e.key === "ArrowLeft") { e.preventDefault(); return irParaSim(estadoSim.atual - 1); }
  if (k === "R" && !e.shiftKey) { e.preventDefault(); return alternarRevisar(); }
  if (q.tipo === "CE") { if (k === "C" || k === "E") { e.preventDefault(); marcarSim(k); } return; }
  if (q.alternativas.some(a => a.letra === k)) {
    e.preventDefault();
    if (e.shiftKey) riscarSim(k); else marcarSim(k);
  }
});
