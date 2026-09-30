"use strict";
/* Larigou Questões — Fase 4: desempenho (estatísticas e gráficos), histórico e caderno de erros. */

const fmtPct = v => v === null || v === undefined ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
const fmtData = iso => iso ? new Date(iso.length === 10 ? iso + "T12:00:00" : iso).toLocaleDateString("pt-BR") : "";

// ------------------------------------------------------------------ agrupamento por período
function inicioDoPeriodo(d, unidade) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (unidade === "semana") x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // segunda-feira
  if (unidade === "mes") x.setDate(1);
  return x;
}
function proximoPeriodo(d, unidade) {
  const x = new Date(d);
  if (unidade === "dia") x.setDate(x.getDate() + 1);
  else if (unidade === "semana") x.setDate(x.getDate() + 7);
  else x.setMonth(x.getMonth() + 1);
  return x;
}
function rotuloPeriodo(d, unidade, longo = false) {
  if (unidade === "mes") return d.toLocaleDateString("pt-BR", { month: longo ? "long" : "short", year: "numeric" });
  const curto = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  return unidade === "semana" && longo ? `Semana de ${curto}` : curto;
}
function unidadeAutomatica(serie) {
  if (!serie.length) return "dia";
  const dias = (new Date(serie.at(-1).dia) - new Date(serie[0].dia)) / 864e5;
  return dias <= 21 ? "dia" : dias <= 180 ? "semana" : "mes";
}

/** Agrupa a série diária em períodos contínuos (períodos sem estudo aparecem vazios). */
function agrupar(serie, unidade, disciplina) {
  const linhas = serie.filter(r => !disciplina || r.disciplina === disciplina);
  if (!linhas.length) return [];
  const mapa = new Map();
  for (const r of linhas) {
    const chave = inicioDoPeriodo(new Date(r.dia + "T12:00:00"), unidade).getTime();
    const p = mapa.get(chave) || { respostas: 0, certas: 0, erradas: 0 };
    p.respostas += r.respostas; p.certas += r.certas; p.erradas += r.erradas;
    mapa.set(chave, p);
  }
  const chaves = [...mapa.keys()].sort((a, b) => a - b);
  const saida = [];
  for (let d = new Date(chaves[0]); d.getTime() <= chaves.at(-1); d = proximoPeriodo(d, unidade)) {
    const p = mapa.get(inicioDoPeriodo(d, unidade).getTime()) || { respostas: 0, certas: 0, erradas: 0 };
    const corrigidas = p.certas + p.erradas;
    saida.push({ data: new Date(d), rotulo: rotuloPeriodo(d, unidade), rotuloLongo: rotuloPeriodo(d, unidade, true),
      ...p, pct: corrigidas ? Math.round((1000 * p.certas) / corrigidas) / 10 : null });
  }
  return saida;
}

// ------------------------------------------------------------------ gráficos (SVG)
const svgNS = "http://www.w3.org/2000/svg";

function dicaGrafico(caixa) {
  let d = $(".dica-grafico", caixa);
  if (!d) { d = document.createElement("div"); d.className = "dica-grafico"; d.hidden = true; caixa.appendChild(d); }
  return d;
}

/** Eixos + área de desenho comuns. Retorna funções de escala e o <svg>. */
function baseGrafico(caixa, n, { yMax, ticks, formatoY }) {
  const largura = Math.max(caixa.clientWidth, 280), altura = 220;
  const m = { t: 12, r: 12, b: 28, l: 44 };
  const w = largura - m.l - m.r, h = altura - m.t - m.b;
  const banda = w / Math.max(n, 1);
  const x = i => m.l + banda * i + banda / 2;
  const y = v => m.t + h - (v / yMax) * h;
  let s = `<svg viewBox="0 0 ${largura} ${altura}" width="${largura}" height="${altura}" role="img">`;
  for (const t of ticks) {
    s += `<line class="grade" x1="${m.l}" x2="${largura - m.r}" y1="${y(t)}" y2="${y(t)}"/>
      <text class="eixo" x="${m.l - 8}" y="${y(t) + 4}" text-anchor="end">${formatoY(t)}</text>`;
  }
  return { largura, altura, m, w, h, banda, x, y, inicio: s };
}

function rotulosX(g, pontos) {
  // no máximo ~8 rótulos para não encavalar
  const passo = Math.max(1, Math.ceil(pontos.length / Math.max(2, Math.floor(g.w / 70))));
  return pontos.map((p, i) => i % passo === 0 || i === pontos.length - 1 && pontos.length < 4
    ? `<text class="eixo" x="${g.x(i)}" y="${g.altura - 8}" text-anchor="middle">${esc(p.rotulo)}</text>` : "").join("");
}

function ligarDica(caixa, g, pontos, texto, marcarFn) {
  const dica = dicaGrafico(caixa);
  const svg = $("svg", caixa);
  const mover = ev => {
    const r = svg.getBoundingClientRect();
    const px = (ev.clientX - r.left) * (g.largura / r.width);
    const i = Math.min(pontos.length - 1, Math.max(0, Math.floor((px - g.m.l) / g.banda)));
    dica.innerHTML = texto(pontos[i]);
    dica.hidden = false;
    const esquerda = (g.x(i) / g.largura) * r.width;
    dica.style.left = Math.min(Math.max(esquerda, 70), r.width - 70) + "px";
    marcarFn(i);
  };
  svg.addEventListener("pointermove", mover);
  svg.addEventListener("pointerdown", mover);
  svg.addEventListener("pointerleave", () => { dica.hidden = true; marcarFn(-1); });
}

function graficoLinhaPct(caixa, pontos) {
  const g = baseGrafico(caixa, pontos.length, { yMax: 100, ticks: [0, 25, 50, 75, 100], formatoY: t => t + "%" });
  let caminho = "", aberto = false;
  pontos.forEach((p, i) => {
    if (p.pct === null) { aberto = false; return; }
    caminho += `${aberto ? "L" : "M"}${g.x(i).toFixed(1)},${g.y(p.pct).toFixed(1)}`;
    aberto = true;
  });
  const marcadores = pontos.map((p, i) => p.pct === null ? "" :
    `<circle class="ponto" data-i="${i}" cx="${g.x(i)}" cy="${g.y(p.pct)}" r="4"/>`).join("");
  caixa.innerHTML = g.inicio +
    `<line class="mira" x1="0" x2="0" y1="${g.m.t}" y2="${g.m.t + g.h}" visibility="hidden"/>
     <path class="linha" d="${caminho}"/>${marcadores}${rotulosX(g, pontos)}</svg>`;
  const mira = $(".mira", caixa);
  ligarDica(caixa, g, pontos,
    p => `<strong>${esc(p.rotuloLongo)}</strong><br>${p.pct === null ? "Sem questões corrigidas" : `${fmtPct(p.pct)} de acerto`}<br><span>${p.respostas} ${p.respostas === 1 ? "resposta" : "respostas"}</span>`,
    i => {
      mira.setAttribute("visibility", i < 0 ? "hidden" : "visible");
      if (i >= 0) { mira.setAttribute("x1", g.x(i)); mira.setAttribute("x2", g.x(i)); }
      $$(".ponto", caixa).forEach(c => c.classList.toggle("ativo", Number(c.dataset.i) === i));
    });
}

function graficoBarrasVolume(caixa, pontos) {
  const max = Math.max(...pontos.map(p => p.respostas), 1);
  const passo = max <= 5 ? 1 : max <= 20 ? 5 : max <= 50 ? 10 : max <= 100 ? 25 : Math.ceil(max / 4 / 50) * 50;
  const topo = Math.ceil(max / passo) * passo;
  const ticks = [];
  for (let t = 0; t <= topo; t += passo) ticks.push(t);
  const g = baseGrafico(caixa, pontos.length, { yMax: topo, ticks, formatoY: t => t });
  const largBarra = Math.max(2, Math.min(28, g.banda - 2)); // 2px de respiro entre barras
  const barras = pontos.map((p, i) => {
    if (!p.respostas) return "";
    const x0 = g.x(i) - largBarra / 2, y0 = g.y(p.respostas), base = g.y(0), r = Math.min(4, largBarra / 2, base - y0);
    // topo arredondado (4px), base reta no eixo
    return `<path class="barra" data-i="${i}" d="M${x0},${base}V${y0 + r}Q${x0},${y0} ${x0 + r},${y0}H${x0 + largBarra - r}Q${x0 + largBarra},${y0} ${x0 + largBarra},${y0 + r}V${base}Z"/>`;
  }).join("");
  caixa.innerHTML = g.inicio + barras + rotulosX(g, pontos) + "</svg>";
  ligarDica(caixa, g, pontos,
    p => `<strong>${esc(p.rotuloLongo)}</strong><br>${p.respostas} ${p.respostas === 1 ? "resposta" : "respostas"}<br><span>${p.certas} certas, ${p.erradas} erradas</span>`,
    i => $$(".barra", caixa).forEach(b => b.classList.toggle("ativo", Number(b.dataset.i) === i)));
}

// ------------------------------------------------------------------ tela de desempenho
let redesenharGraficos = null;
window.addEventListener("resize", () => { clearTimeout(window.__tRes); window.__tRes = setTimeout(() => redesenharGraficos?.(), 150); });

async function telaDesempenho() {
  saindo = null;
  redesenharGraficos = null;
  const r = await api("/api/desempenho/resumo");
  const g = r.geral;
  if (!g.respostas) {
    main.innerHTML = `<div class="vazio"><h1>Ainda não há respostas</h1>
      <p>Resolva algumas questões ou faça um simulado. Suas estatísticas aparecem aqui.</p>
      <div class="linha-atalhos" style="justify-content:center"><a class="botao primario" href="#/resolver">Resolver questões</a>
      <a class="botao" href="#/simulados">Fazer um simulado</a></div></div>`;
    return;
  }
  const estado = { unidade: unidadeAutomatica(r.serie), disciplina: "", tabela: false };

  main.innerHTML = `
    <div class="desempenho">
      <div class="editor-cabeca"><h1 style="margin:0">Desempenho</h1>
        <a class="botao" href="#/desempenho/historico">Histórico de respostas</a></div>
      <section class="kpis">
        <div class="kpi principal"><div class="numero-grande">${fmtPct(g.percentual)}</div><p>de acerto em ${g.respostas} respostas</p></div>
        <div class="kpi"><strong>${g.questoes}</strong><span>questões diferentes resolvidas, de ${g.total_banco} no banco</span></div>
        <div class="kpi"><strong>${g.dias}</strong><span>${g.dias === 1 ? "dia" : "dias"} de estudo desde ${fmtData(g.primeira)}</span></div>
        <a class="kpi kpi-link" href="#/caderno"><strong>${r.caderno.hoje}</strong><span>${r.caderno.hoje === 1 ? "questão" : "questões"} para revisar hoje no caderno de erros</span></a>
      </section>

      <section class="painel">
        <div class="filtros-graficos">
          <h2 style="margin:0">Evolução</h2>
          <label class="campo"><span>Disciplina</span><select class="entrada" id="g-disc">
            <option value="">Todas</option>${r.disciplinas.map(d => `<option>${esc(d.disciplina)}</option>`).join("")}</select></label>
          <div class="alternar" role="group" aria-label="Agrupar por">
            ${[["dia", "Dia"], ["semana", "Semana"], ["mes", "Mês"]].map(([v, t]) =>
              `<button type="button" data-unidade="${v}" aria-pressed="${estado.unidade === v}">${t}</button>`).join("")}
          </div>
          <button class="botao-texto" type="button" id="g-tabela">Ver como tabela</button>
        </div>
        <div id="area-graficos">
          <h3 class="titulo-grafico">Percentual de acerto</h3>
          <div class="grafico" id="g-pct"></div>
          <h3 class="titulo-grafico">Questões respondidas</h3>
          <div class="grafico" id="g-vol"></div>
        </div>
        <div id="tabela-graficos" hidden></div>
      </section>

      <section class="painel" style="margin-top:24px">
        <h2>Por disciplina e assunto</h2>
        <p class="dica">Os assuntos aparecem do pior para o melhor aproveitamento. Clique numa disciplina para ver os assuntos.</p>
        <div class="tabela-desempenho">
          ${r.disciplinas.map(d => `
            <details class="linha-disc">
              <summary>${linhaDesempenho(d.disciplina, d, true)}</summary>
              <div class="assuntos-disc">${d.assuntos.map(a => linhaDesempenho(a.assunto, a, false, d.disciplina)).join("")}</div>
            </details>`).join("")}
        </div>
      </section>
    </div>`;

  const desenhar = () => {
    const pontos = agrupar(r.serie, estado.unidade, estado.disciplina);
    $("#area-graficos").hidden = estado.tabela;
    $("#tabela-graficos").hidden = !estado.tabela;
    $("#g-tabela").textContent = estado.tabela ? "Ver como gráfico" : "Ver como tabela";
    if (estado.tabela) {
      $("#tabela-graficos").innerHTML = `<table class="tabela-provas"><thead><tr><th>Período</th><th class="num">Respostas</th>
        <th class="num">Certas</th><th class="num">Erradas</th><th class="num">Acerto</th></tr></thead><tbody>
        ${pontos.filter(p => p.respostas).reverse().map(p => `<tr><td>${esc(p.rotuloLongo)}</td><td class="num">${p.respostas}</td>
          <td class="num">${p.certas}</td><td class="num">${p.erradas}</td><td class="num">${fmtPct(p.pct)}</td></tr>`).join("")}</tbody></table>`;
      return;
    }
    const comResposta = pontos.filter(p => p.respostas);
    $$("#area-graficos .titulo-grafico, #g-vol").forEach(el => el.hidden = comResposta.length < 2);
    if (!comResposta.length) { $("#g-pct").innerHTML = `<p class="dica">Sem respostas nesta disciplina.</p>`; return; }
    if (comResposta.length < 2) {
      // com um período só, o gráfico vira um ponto solto: melhor dizer o que vai aparecer
      const unid = { dia: ["dia", "dias"], semana: ["semana", "semanas"], mes: ["mês", "meses"] }[estado.unidade];
      const p = comResposta[0];
      $("#g-pct").innerHTML = `<div class="grafico-espera">
        <p><strong>${p.rotuloLongo}:</strong> ${p.respostas} ${p.respostas === 1 ? "resposta" : "respostas"}, ${fmtPct(p.pct)} de acerto.</p>
        <p class="dica">O gráfico de evolução aparece quando você tiver estudado em pelo menos 2 ${unid[1]} diferentes.</p></div>`;
      return;
    }
    graficoLinhaPct($("#g-pct"), pontos);
    graficoBarrasVolume($("#g-vol"), pontos);
  };
  redesenharGraficos = () => { if ($("#g-pct")) desenhar(); else redesenharGraficos = null; };
  $("#g-disc").onchange = e => { estado.disciplina = e.target.value; desenhar(); };
  $$("[data-unidade]").forEach(b => b.onclick = () => {
    estado.unidade = b.dataset.unidade;
    $$("[data-unidade]").forEach(x => x.setAttribute("aria-pressed", x === b));
    desenhar();
  });
  $("#g-tabela").onclick = () => { estado.tabela = !estado.tabela; desenhar(); };
  desenhar();
}

function linhaDesempenho(nome, x, ehDisciplina, disciplinaPai) {
  const corrigidas = x.certas + x.erradas;
  const filtro = ehDisciplina ? { disciplina: [nome] } : { disciplina: [disciplinaPai], assunto: [nome] };
  return `<div class="linha-desemp ${ehDisciplina ? "" : "sub"}">
    <span class="nome">${esc(nome)}</span>
    <span class="barra-pct"><span class="trilho"><span class="cheio" style="width:${x.percentual ?? 0}%"></span></span>
      <span class="valor">${fmtPct(x.percentual)}</span></span>
    <span class="numeros dica">${x.certas} de ${corrigidas} certas, ${x.questoes} de ${x.total_banco} questões vistas</span>
    ${ehDisciplina ? "" : `<button type="button" class="botao-texto estudar-assunto" data-filtro='${esc(JSON.stringify(filtro))}'>Estudar</button>`}
  </div>`;
}

// "Estudar" num assunto abre o Resolver já filtrado
document.addEventListener("click", e => {
  const b = e.target.closest(".estudar-assunto");
  if (!b) return;
  gravarLocal("larigou.filtros", { ...novosFiltros({}), ...JSON.parse(b.dataset.filtro) });
  location.hash = "#/resolver";
});

// ------------------------------------------------------------------ histórico
async function telaHistorico() {
  saindo = null;
  const meta = await carregarMeta();
  const f = { disciplina: "", resultado: "", modo: "", pagina: 1 };
  main.innerHTML = `
    <div class="desempenho">
      <a class="botao-texto" href="#/desempenho" style="padding-left:0">Desempenho</a>
      <h1>Histórico de respostas</h1>
      <form class="filtros-graficos" id="f-hist">
        <label class="campo"><span>Disciplina</span><select class="entrada" name="disciplina"><option value="">Todas</option>
          ${meta.disciplinas.map(d => `<option>${esc(d)}</option>`).join("")}</select></label>
        <label class="campo"><span>Resultado</span><select class="entrada" name="resultado"><option value="">Todos</option>
          <option value="certa">Certas</option><option value="errada">Erradas</option></select></label>
        <label class="campo"><span>Onde</span><select class="entrada" name="modo"><option value="">Estudo e simulados</option>
          <option value="estudo">Só estudo</option><option value="simulado">Só simulados</option></select></label>
      </form>
      <p class="dica" id="hist-total"></p>
      <div id="hist-lista" class="lista-historico"></div>
      <div class="paginacao" style="margin-top:12px"><button class="botao pequeno" id="h-ant" type="button">Mais recentes</button>
        <button class="botao pequeno" id="h-prox" type="button">Mais antigas</button></div>
    </div>`;
  const carregar = async () => {
    const r = await api("/api/desempenho/historico?" + new URLSearchParams(f));
    $("#hist-total").textContent = `${r.total} ${r.total === 1 ? "resposta" : "respostas"}`;
    const nome = (x, l) => x.tipo === "CE" ? ({ C: "Certo", E: "Errado" }[l] || "—") : (l || "—");
    $("#hist-lista").innerHTML = r.itens.map(x => `
      <a class="item-hist" href="#/questoes/${x.questao_id}">
        <span class="marca-sit ${x.correta === 1 ? "certa" : x.correta === 0 ? "errada" : "branco"}">${x.correta === 1 ? "Certa" : x.correta === 0 ? "Errada" : "Anulada"}</span>
        <span class="hist-corpo"><span class="item-topo"><strong>${esc(x.disciplina || "")}</strong>${x.assunto ? " / " + esc(x.assunto) : ""}</span>
          <span class="item-resumo">${esc(x.resumo.replace(/\*\*|\[\[img:[^\]]+\]\]/g, ""))}</span></span>
        <span class="hist-meta dica">${new Date(x.respondida_em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}<br>
          ${x.modo === "simulado" ? "Simulado" : "Estudo"}, sua: ${esc(nome(x, x.resposta))}, gabarito: ${esc(nome(x, x.gabarito))}</span>
      </a>`).join("") || `<p class="vazio">Nenhuma resposta com esses filtros.</p>`;
    $("#h-ant").disabled = f.pagina <= 1;
    $("#h-prox").disabled = f.pagina * r.por_pagina >= r.total;
  };
  $("#f-hist").onchange = e => { f[e.target.name] = e.target.value; f.pagina = 1; carregar(); };
  $("#h-ant").onclick = () => { f.pagina--; carregar(); };
  $("#h-prox").onclick = () => { f.pagina++; carregar(); };
  carregar();
}

// ------------------------------------------------------------------ caderno de erros
async function telaCaderno() {
  saindo = null;
  const f = { mostrar: "hoje", disciplina: "" };
  main.innerHTML = `
    <div class="caderno">
      <h1>Caderno de erros</h1>
      <p class="dica caderno-explica">Toda questão que você erra entra aqui. Ela volta para revisão no dia seguinte e,
        a cada acerto no dia marcado, o intervalo aumenta (1, 3, 7, 15, 30 e 60 dias). Errou de novo, recomeça.
        Depois de acertar na última etapa, a questão é considerada dominada.</p>
      <section class="painel revisar-hoje">
        <div><div class="numero-grande" id="n-hoje">…</div><p id="rot-hoje">para revisar hoje</p></div>
        <div class="revisar-acoes">
          <label class="campo"><span>Disciplina</span><select class="entrada" id="cad-disc"><option value="">Todas</option></select></label>
          <button class="botao primario" id="revisar-agora" type="button">Revisar agora</button>
        </div>
      </section>
      <div class="editor-cabeca" style="margin-top:24px">
        <div class="alternar" role="group" aria-label="Mostrar">
          ${[["hoje", "Para hoje"], ["pendentes", "Todas pendentes"], ["dominadas", "Dominadas"]].map(([v, t]) =>
            `<button type="button" data-mostrar="${v}" aria-pressed="${f.mostrar === v}">${t} <span class="n" data-n="${v}"></span></button>`).join("")}
        </div>
      </div>
      <div class="lista-revisao" id="cad-lista" style="margin-top:14px"></div>
    </div>`;
  const carregar = async () => {
    const r = await api("/api/caderno?" + new URLSearchParams(f));
    const c = r.contagem;
    const sel = $("#cad-disc");
    if (sel.options.length === 1) sel.insertAdjacentHTML("beforeend", r.disciplinas.map(d => `<option>${esc(d)}</option>`).join(""));
    const hojeFiltrado = f.disciplina ? (await api("/api/caderno/ids?" + new URLSearchParams({ disciplina: f.disciplina }))).ids.length : c.hoje;
    $("#n-hoje").textContent = hojeFiltrado;
    $("#rot-hoje").textContent = `${hojeFiltrado === 1 ? "questão" : "questões"} para revisar hoje${f.disciplina ? " em " + f.disciplina : ""}`;
    $("#revisar-agora").disabled = !hojeFiltrado;
    $('[data-n="hoje"]').textContent = c.hoje;
    $('[data-n="pendentes"]').textContent = c.pendentes;
    $('[data-n="dominadas"]').textContent = c.dominadas;
    const hoje = r.hoje;
    $("#cad-lista").innerHTML = r.itens.map(x => {
      const atrasada = !x.dominada && x.proxima_em < hoje;
      const quando = x.dominada ? "Dominada" : x.proxima_em <= hoje ? (atrasada ? `Atrasada desde ${fmtData(x.proxima_em)}` : "Revisar hoje") : `Próxima revisão em ${fmtData(x.proxima_em)}`;
      return `<div class="painel item-caderno">
        <a href="#/questoes/${x.questao_id}" class="item-caderno-corpo">
          <span class="item-topo"><strong>${esc(x.disciplina || "")}</strong>${x.assunto ? " / " + esc(x.assunto) : ""}
            <span class="dica">${esc(x.orgao || "")}${x.numero ? `, questão ${x.numero}` : ""}</span></span>
          <span class="item-resumo">${esc(x.resumo.replace(/\*\*|\[\[img:[^\]]+\]\]/g, ""))}</span>
          <span class="dica">${quando}. Errou ${x.erros} ${x.erros === 1 ? "vez" : "vezes"}. Etapa ${Math.min(x.etapa + 1, r.intervalos.length)} de ${r.intervalos.length}.</span>
        </a>
        <button class="botao-texto tirar" data-id="${x.questao_id}" type="button">Tirar do caderno</button>
      </div>`;
    }).join("") || `<p class="vazio">${f.mostrar === "hoje" ? "Nada para revisar hoje. Bom trabalho!" : "Nenhuma questão aqui."}</p>`;
  };
  $("#cad-disc").onchange = e => { f.disciplina = e.target.value; carregar(); };
  $$("[data-mostrar]").forEach(b => b.onclick = () => {
    f.mostrar = b.dataset.mostrar;
    $$("[data-mostrar]").forEach(x => x.setAttribute("aria-pressed", x === b));
    carregar();
  });
  $("#cad-lista").onclick = async e => {
    const b = e.target.closest(".tirar");
    if (!b || !confirm("Tirar esta questão do caderno de erros?")) return;
    await api(`/api/caderno/${b.dataset.id}`, { method: "DELETE" });
    avisar("Questão tirada do caderno");
    carregar();
  };
  $("#revisar-agora").onclick = async () => {
    const { ids } = await api("/api/caderno/ids?" + new URLSearchParams(f.disciplina ? { disciplina: f.disciplina } : {}));
    if (!ids.length) return avisar("Nada para revisar hoje.");
    gravarLocal("larigou.sessao", { ids, pos: 0, resultados: {}, filtros: null, origem: "caderno", inicio: new Date().toISOString() });
    location.hash = "#/resolver/1";
  };
  carregar();
}
