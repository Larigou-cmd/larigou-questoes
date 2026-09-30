"use strict";
/* Larigou Questões — Fase 2: resolver questões (filtros, uma questão por vez, feedback imediato).
   Usa os utilitários de app.js ($, $$, api, esc, formatar, avisar, carregarMeta). */

const CHAVE_FILTROS = "larigou.filtros";
const CHAVE_SESSAO = "larigou.sessao";

/** Como formatar(), mas sem <p> (pode ir dentro de botão). */
function formatarInline(t) {
  return formatar(t).replace(/<\/p><p>/g, "<br><br>").replace(/<\/?p>/g, "");
}

function lerLocal(chave, padrao) {
  try { return JSON.parse(localStorage.getItem(chave)) ?? padrao; } catch (e) { return padrao; }
}
function gravarLocal(chave, valor) {
  try { localStorage.setItem(chave, JSON.stringify(valor)); } catch (e) {}
}

const FILTROS_PADRAO = { disciplina: [], assunto: [], banca: [], orgao: [], cargo: [], ano: [], tipo: [],
  status: "", favoritas: false, com_anotacao: false, sem_anuladas: true, ordem: "prova" };

/** Cópia independente dos filtros padrão, com os valores salvos por cima. */
function novosFiltros(salvos) {
  return { ...structuredClone(FILTROS_PADRAO), ...structuredClone(salvos || {}) };
}

/** Monta a query string com valores repetidos (?disciplina=a&disciplina=b). */
function queryDeFiltros(f) {
  const p = new URLSearchParams();
  for (const campo of ["disciplina", "assunto", "banca", "orgao", "cargo", "ano", "tipo"])
    (f[campo] || []).forEach(v => p.append(campo, v));
  if (f.status) p.set("status", f.status);
  for (const b of ["favoritas", "com_anotacao", "sem_anuladas"]) if (f[b]) p.set(b, "1");
  if (f.ordem) p.set("ordem", f.ordem);
  return p.toString();
}

// ------------------------------------------------------------------ formulário de filtros (reusado no simulado)
const TIPOS = [["ME", "Múltipla escolha"], ["CE", "Certo ou errado"]];
const SITUACOES = [["", "Todas"], ["nao_resolvidas", "Que não resolvi"], ["erradas", "Que errei da última vez"],
  ["ja_errei", "Que já errei alguma vez"], ["acertadas", "Que acertei da última vez"]];

/** HTML dos grupos de filtros. `f` é o objeto de filtros (mesmo formato de FILTROS_PADRAO). */
function htmlFiltros(f, meta, { ordem = true } = {}) {
  const grupoChips = (campo, titulo, valores, rotulos = {}) => valores.length ? `
    <fieldset class="grupo-filtro"><legend>${titulo}</legend><div class="chips">
      ${valores.map(v => `<button type="button" class="chip" data-campo="${campo}" data-valor="${esc(v)}"
        aria-pressed="${f[campo].map(String).includes(String(v))}">${esc(rotulos[v] ?? v)}</button>`).join("")}
    </div></fieldset>` : "";
  return `
    <fieldset class="grupo-filtro"><legend>Disciplina</legend><div class="chips">
      ${Object.entries(meta.arvore).filter(([d]) => d).map(([d, ass]) => `<button type="button" class="chip" data-campo="disciplina"
        data-valor="${esc(d)}" aria-pressed="${f.disciplina.includes(d)}">${esc(d)} <span class="n">${Object.values(ass).reduce((a, b) => a + b, 0)}</span></button>`).join("")}
    </div></fieldset>
    <div class="grupo-assuntos"></div>
    ${grupoChips("banca", "Banca", meta.bancas)}
    ${grupoChips("orgao", "Órgão", meta.orgaos)}
    ${grupoChips("cargo", "Cargo", meta.cargos)}
    ${grupoChips("ano", "Ano", meta.anos)}
    ${meta.tipos.length > 1 ? grupoChips("tipo", "Tipo", meta.tipos, Object.fromEntries(TIPOS)) : ""}
    <fieldset class="grupo-filtro"><legend>Situação</legend><div class="chips">
      ${SITUACOES.map(([v, r]) => `<label class="chip radio"><input type="radio" name="status" value="${v}" ${f.status === v ? "checked" : ""}>${r}</label>`).join("")}
    </div></fieldset>
    <fieldset class="grupo-filtro"><legend>Outros</legend><div class="chips">
      <label class="check"><input type="checkbox" name="favoritas" ${f.favoritas ? "checked" : ""}> Só favoritas</label>
      <label class="check"><input type="checkbox" name="com_anotacao" ${f.com_anotacao ? "checked" : ""}> Só com anotação minha</label>
      <label class="check"><input type="checkbox" name="sem_anuladas" ${f.sem_anuladas ? "checked" : ""}> Deixar de fora as anuladas</label>
    </div></fieldset>
    ${ordem ? `<label class="campo" style="max-width:320px"><span>Ordem</span>
      <select class="entrada" name="ordem">
        <option value="prova" ${f.ordem === "prova" ? "selected" : ""}>Como na prova</option>
        <option value="disciplina" ${f.ordem === "disciplina" ? "selected" : ""}>Por disciplina e assunto</option>
        <option value="aleatoria" ${f.ordem === "aleatoria" ? "selected" : ""}>Aleatória</option>
        <option value="recentes" ${f.ordem === "recentes" ? "selected" : ""}>Provas mais recentes primeiro</option>
      </select></label>` : ""}`;
}

/** Liga cliques e mudanças do formulário ao objeto `f`; chama `aoMudar` a cada alteração. */
function ligarFiltros(form, f, meta, aoMudar) {
  const desenharAssuntos = () => {
    const blocos = f.disciplina.map(d => {
      const ass = Object.entries(meta.arvore[d] || {}).filter(([a]) => a);
      return ass.length ? `<div class="sub-grupo"><span class="dica">${esc(d)}</span><div class="chips">
        ${ass.map(([a, n]) => `<button type="button" class="chip" data-campo="assunto" data-valor="${esc(a)}"
          aria-pressed="${f.assunto.includes(a)}">${esc(a)} <span class="n">${n}</span></button>`).join("")}</div></div>` : "";
    }).join("");
    $(".grupo-assuntos", form).innerHTML = blocos ? `<fieldset class="grupo-filtro"><legend>Assunto</legend>${blocos}</fieldset>` : "";
    // assuntos de disciplinas desmarcadas saem do filtro
    const validos = new Set(f.disciplina.flatMap(d => Object.keys(meta.arvore[d] || {})));
    f.assunto = f.assunto.filter(a => validos.has(a));
  };
  form.addEventListener("click", e => {
    const chip = e.target.closest("button.chip");
    if (!chip) return;
    const { campo, valor } = chip.dataset;
    const lista = f[campo];
    const i = lista.map(String).indexOf(valor);
    if (i >= 0) lista.splice(i, 1); else lista.push(campo === "ano" ? Number(valor) : valor);
    chip.setAttribute("aria-pressed", i < 0);
    if (campo === "disciplina") desenharAssuntos();
    aoMudar();
  });
  form.addEventListener("change", e => {
    const el = e.target;
    if (el.name === "status") f.status = el.value;
    else if (el.type === "checkbox" && el.name in FILTROS_PADRAO) f[el.name] = el.checked;
    else if (el.name === "ordem") f.ordem = el.value;
    else return;
    aoMudar();
  });
  desenharAssuntos();
}

// ------------------------------------------------------------------ tela de filtros
async function telaResolverFiltros() {
  saindo = null;
  const meta = await carregarMeta(true);
  const f = novosFiltros(lerLocal(CHAVE_FILTROS, {}));
  const sessao = lerLocal(CHAVE_SESSAO, null);

  main.innerHTML = `
    <div class="resolver-filtros">
      <div>
        <h1>Resolver questões</h1>
        <p class="dica">Escolha o que quer estudar. Sem nada marcado num grupo, vale tudo daquele grupo.</p>
        ${sessao && sessao.ids?.length && sessao.pos < sessao.ids.length ? `<div class="caixa-alerta aviso" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
          <span>Você parou na questão ${sessao.pos + 1} de ${sessao.ids.length} da última sessão.</span>
          <a class="botao pequeno" href="#/resolver/${sessao.pos + 1}">Continuar de onde parei</a></div>` : ""}
        <form id="form-filtros" class="painel">${htmlFiltros(f, meta)}</form>
      </div>
      <aside class="resumo-filtros">
        <div class="painel">
          <div class="numero-grande" id="n-filtradas">…</div>
          <p class="dica" id="n-rotulo">questões com esses filtros</p>
          <button class="botao primario" id="comecar" type="button" style="width:100%">Começar</button>
          <button class="botao-texto" id="limpar" type="button" style="margin-top:10px">Limpar filtros</button>
        </div>
      </aside>
    </div>`;

  let t;
  const atualizar = () => {
    gravarLocal(CHAVE_FILTROS, f);
    clearTimeout(t);
    t = setTimeout(async () => {
      const { total } = await api("/api/resolver/contar?" + queryDeFiltros(f));
      $("#n-filtradas").textContent = total;
      $("#n-rotulo").textContent = total === 1 ? "questão com esses filtros" : "questões com esses filtros";
      $("#comecar").disabled = !total;
    }, 150);
  };
  ligarFiltros($("#form-filtros"), f, meta, atualizar);
  $("#limpar").onclick = () => { gravarLocal(CHAVE_FILTROS, FILTROS_PADRAO); telaResolverFiltros(); };
  $("#comecar").onclick = async () => {
    const { ids } = await api("/api/resolver/ids?" + queryDeFiltros(f));
    if (!ids.length) return avisar("Nenhuma questão com esses filtros.");
    gravarLocal(CHAVE_SESSAO, { ids, pos: 0, resultados: {}, filtros: f, inicio: new Date().toISOString() });
    location.hash = "#/resolver/1";
  };
  atualizar();
}

// ------------------------------------------------------------------ tela da questão
let estadoQuestao = null; // { q, sessao, selecionada, riscadas, respondida, inicio }

async function telaResolverQuestao(posStr) {
  saindo = null;
  const sessao = lerLocal(CHAVE_SESSAO, null);
  const pos = Number(posStr) - 1;
  if (!sessao || !sessao.ids?.length) { location.hash = "#/resolver"; return; }
  if (pos >= sessao.ids.length) return telaFimSessao(sessao);
  if (pos < 0) { location.hash = "#/resolver/1"; return; }
  sessao.pos = pos;
  gravarLocal(CHAVE_SESSAO, sessao);

  const qid = sessao.ids[pos];
  let q;
  try { q = await api(`/api/questoes/${qid}`); }
  catch (e) {
    // questão excluída depois de a sessão começar: pula
    sessao.ids.splice(pos, 1);
    gravarLocal(CHAVE_SESSAO, sessao);
    return telaResolverQuestao(pos + 1);
  }
  const anteriorTb = pos > 0 ? sessao.tbVistos?.includes(q.texto_base_id) : false;
  sessao.tbVistos = [...new Set([...(sessao.tbVistos || []), q.texto_base_id].filter(Boolean))];
  gravarLocal(CHAVE_SESSAO, sessao);

  const jaNaSessao = sessao.resultados[qid]; // { resposta, correta } se respondeu nesta sessão
  estadoQuestao = { q, sessao, pos, selecionada: jaNaSessao?.resposta ?? null, riscadas: new Set(q.usuario.riscadas),
    respondida: !!jaNaSessao, inicio: Date.now() };

  const total = sessao.ids.length;
  const feitas = Object.keys(sessao.resultados).length;
  const acertos = Object.values(sessao.resultados).filter(r => r.correta === 1).length;
  const h = q.historico;

  main.innerHTML = `
    <article class="resolver" aria-labelledby="titulo-questao">
      <div class="resolver-topo">
        <a class="botao-texto" href="#/resolver" style="padding-left:0">Filtros</a>
        <div class="progresso" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${pos + 1}"
          aria-label="Questão ${pos + 1} de ${total}"><span style="width:${((pos + 1) / total) * 100}%"></span></div>
        <span class="placar" title="Nesta sessão">${feitas ? `${acertos} de ${feitas} certas` : ""}</span>
      </div>

      <header class="questao-cabeca">
        <div>
          <h1 id="titulo-questao" class="questao-titulo">Questão ${pos + 1} <span>de ${total}</span></h1>
          <div class="questao-meta">
            <span class="etiqueta roxa">${esc(q.disciplina || "Sem disciplina")}${q.assunto ? " / " + esc(q.assunto) : ""}</span>
            ${q.anulada ? `<span class="etiqueta aviso">anulada</span>` : ""}
            <span>${[q.banca, q.orgao, q.cargo, q.ano].filter(Boolean).map(esc).join(", ")}${q.numero ? `, questão ${q.numero} da prova` : ""}</span>
          </div>
        </div>
        <div class="questao-acoes">
          <button type="button" class="botao-icone" id="favoritar" aria-pressed="${q.usuario.favorita}"
            title="Favoritar (F)" aria-label="Favoritar questão">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/></svg></button>
          <a class="botao-icone so-local" href="#/questoes/${q.id}" title="Editar esta questão" aria-label="Editar esta questão">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4"/></svg></a>
        </div>
      </header>

      ${q.texto_base ? `<details class="texto-base leitura-tb" ${anteriorTb ? "" : "open"}>
        <summary>Texto${q.texto_base.titulo ? ": " + esc(q.texto_base.titulo) : ""} <span class="dica">(questões ${q.texto_base.q_inicio} a ${q.texto_base.q_fim})</span></summary>
        <div class="conteudo-tb leitura">${formatar(q.texto_base.conteudo)}</div></details>` : ""}

      <div class="leitura enunciado">${formatar(q.enunciado)}</div>

      <div id="opcoes" class="opcoes" role="radiogroup" aria-label="Alternativas"></div>

      <div id="feedback" aria-live="assertive"></div>

      <div class="barra-resposta">
        <button type="button" class="botao" id="btn-anterior" ${pos === 0 ? "disabled" : ""}>Anterior</button>
        <span class="espaco"></span>
        <button type="button" class="botao primario" id="btn-responder">Responder</button>
        <button type="button" class="botao primario" id="btn-proxima" hidden>${pos + 1 < total ? "Próxima" : "Ver resultado"}</button>
      </div>

      <section class="anotacao painel">
        <label class="campo"><span>Minhas anotações <span class="dica" id="status-anotacao"></span></span>
          <textarea class="entrada" id="anotacao" rows="3" placeholder="Algo para lembrar sobre esta questão">${esc(q.usuario.anotacao)}</textarea></label>
        <p class="dica historico">${h.tentativas ? `Você já respondeu esta questão ${h.tentativas} ${h.tentativas === 1 ? "vez" : "vezes"} e acertou ${h.acertos}.` : "Primeira vez que você vê esta questão."}</p>
      </section>

      <p class="dica atalhos">Atalhos: ${q.tipo === "CE" ? "C ou E marca" : "A a E marca, Shift + letra risca"}; Enter responde; setas navegam; F favorita.</p>
    </article>`;

  desenharOpcoes();
  if (jaNaSessao) mostrarFeedback(jaNaSessao);

  $("#btn-responder").onclick = responderAtual;
  $("#btn-proxima").onclick = () => irPara(pos + 1);
  $("#btn-anterior").onclick = () => irPara(pos - 1);
  $("#favoritar").onclick = alternarFavorita;

  let tAnot;
  $("#anotacao").addEventListener("input", () => {
    $("#status-anotacao").textContent = "(salvando…)";
    clearTimeout(tAnot);
    tAnot = setTimeout(async () => {
      await api(`/api/questoes/${qid}/usuario`, { method: "PUT", body: { anotacao: $("#anotacao").value } });
      $("#status-anotacao").textContent = "(salvo)";
    }, 600);
  });
}

function desenharOpcoes() {
  const { q, selecionada, riscadas, respondida } = estadoQuestao;
  const r = estadoQuestao.resultado;
  const box = $("#opcoes");
  if (q.tipo === "CE") {
    box.className = "opcoes opcoes-ce";
    box.innerHTML = [["C", "Certo"], ["E", "Errado"]].map(([l, rot]) => {
      const classes = ["opcao-ce", l === "C" ? "certo" : "errado"];
      if (selecionada === l) classes.push("selecionada");
      if (respondida && r && q.gabarito === l) classes.push("gabarito");
      else if (respondida && r && selecionada === l) classes.push("errada");
      return `<button type="button" role="radio" aria-checked="${selecionada === l}" class="${classes.join(" ")}"
        data-letra="${l}" ${respondida ? "disabled" : ""}>${rot}</button>`;
    }).join("");
  } else {
    box.className = "opcoes";
    box.innerHTML = q.alternativas.map(a => {
      const l = a.letra;
      const classes = ["opcao"];
      if (selecionada === l) classes.push("selecionada");
      if (riscadas.has(l)) classes.push("riscada");
      if (respondida && r) {
        if (q.gabarito === l) classes.push("gabarito");
        else if (selecionada === l) classes.push("errada");
      }
      return `<div class="${classes.join(" ")}">
        <button type="button" class="opcao-escolher" role="radio" aria-checked="${selecionada === l}" data-letra="${l}" ${respondida ? "disabled" : ""}>
          <span class="hex ${selecionada === l ? "marcado" : ""}" aria-hidden="true"><span>${l}</span></span>
          <span class="opcao-texto">${formatarInline(a.texto)}</span>
        </button>
        <button type="button" class="opcao-riscar" data-riscar="${l}" aria-pressed="${riscadas.has(l)}"
          title="${riscadas.has(l) ? "Desfazer risco" : "Riscar alternativa"} (Shift+${l})" aria-label="${riscadas.has(l) ? "Desfazer risco da" : "Riscar"} alternativa ${l}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12"/></svg>
        </button></div>`;
    }).join("");
  }
  box.onclick = e => {
    const esc_ = e.target.closest("[data-riscar]");
    if (esc_) return riscar(esc_.dataset.riscar);
    const b = e.target.closest("[data-letra]");
    if (b && !estadoQuestao.respondida) selecionar(b.dataset.letra);
  };
  box.oncontextmenu = e => {
    const b = e.target.closest(".opcao [data-letra]");
    if (b && !estadoQuestao.respondida) { e.preventDefault(); riscar(b.dataset.letra); }
  };
}

function selecionar(letra) {
  const est = estadoQuestao;
  est.selecionada = est.selecionada === letra ? null : letra;
  if (est.riscadas.has(letra)) { est.riscadas.delete(letra); salvarRiscadas(); }
  desenharOpcoes();
  $(`[data-letra="${letra}"]`)?.focus({ preventScroll: true });
}

function riscar(letra) {
  const est = estadoQuestao;
  if (est.q.tipo === "CE") return;
  if (est.riscadas.has(letra)) est.riscadas.delete(letra);
  else {
    est.riscadas.add(letra);
    if (est.selecionada === letra && !est.respondida) est.selecionada = null;
  }
  desenharOpcoes();
  salvarRiscadas();
}

let tRiscadas;
function salvarRiscadas() {
  const { q, riscadas } = estadoQuestao;
  clearTimeout(tRiscadas);
  tRiscadas = setTimeout(() => api(`/api/questoes/${q.id}/usuario`, { method: "PUT", body: { riscadas: [...riscadas] } }), 400);
}

async function alternarFavorita() {
  const { q } = estadoQuestao;
  const u = await api(`/api/questoes/${q.id}/usuario`, { method: "PUT", body: { favorita: !q.usuario.favorita } });
  q.usuario.favorita = u.favorita;
  $("#favoritar").setAttribute("aria-pressed", u.favorita);
  avisar(u.favorita ? "Adicionada às favoritas" : "Removida das favoritas");
}

async function responderAtual() {
  const est = estadoQuestao;
  if (est.respondida) return irPara(est.pos + 1);
  if (!est.selecionada) {
    avisar(est.q.tipo === "CE" ? "Marque Certo ou Errado antes de responder." : "Marque uma alternativa antes de responder.");
    return;
  }
  try {
    const r = await api(`/api/questoes/${est.q.id}/responder`, { method: "POST",
      body: { resposta: est.selecionada, tempo_seg: Math.round((Date.now() - est.inicio) / 1000) } });
    est.q.gabarito = r.gabarito;
    const resultado = { resposta: est.selecionada, correta: r.correta, gabarito: r.gabarito };
    est.sessao.resultados[est.q.id] = resultado;
    gravarLocal(CHAVE_SESSAO, est.sessao);
    est.q.historico = r.historico;
    mostrarFeedback(resultado);
    const h = r.historico;
    $(".historico").textContent = `Você já respondeu esta questão ${h.tentativas} ${h.tentativas === 1 ? "vez" : "vezes"} e acertou ${h.acertos}.`;
    const feitas = Object.values(est.sessao.resultados);
    $(".placar").textContent = `${feitas.filter(x => x.correta === 1).length} de ${feitas.length} certas`;
    const ganho = await atualizarJogo();
    if (ganho?.xp > 0 && estadoQuestao === est) $("#feedback .feedback")?.insertAdjacentHTML("beforeend", ` <span class="ganho-xp">+${ganho.xp} XP</span>`);
  } catch (e) {
    avisar(e.message, "erro");
  }
}

function mostrarFeedback(resultado) {
  const est = estadoQuestao;
  est.respondida = true;
  est.resultado = resultado;
  est.selecionada = resultado.resposta;
  est.q.gabarito = resultado.gabarito ?? est.q.gabarito;
  desenharOpcoes();
  const q = est.q;
  const nomeGab = q.tipo === "CE" ? (q.gabarito === "C" ? "Certo" : "Errado") : q.gabarito;
  let html;
  if (q.anulada) html = `<div class="feedback neutro"><strong>Questão anulada pela banca.</strong> Não conta como acerto nem erro.${q.gabarito ? ` O gabarito original era ${esc(nomeGab)}.` : ""}</div>`;
  else if (resultado.correta === 1) html = `<div class="feedback certo"><strong>Você acertou!</strong> Gabarito: ${esc(nomeGab)}.</div>`;
  else html = `<div class="feedback errado"><strong>Você errou.</strong> Gabarito: ${esc(nomeGab)}.</div>`;
  const notas = [];
  if (q.gabarito_status === "preliminar") notas.push("Este é o gabarito preliminar da banca.");
  if (q.gabarito_alterado) notas.push("O gabarito desta questão foi alterado após recursos.");
  $("#feedback").innerHTML = html + (notas.length ? `<p class="dica" style="margin-top:6px">${notas.join(" ")}</p>` : "") +
    `<button type="button" class="botao-texto" id="refazer">Responder de novo</button>`;
  $("#refazer").onclick = () => {
    delete est.sessao.resultados[q.id];
    gravarLocal(CHAVE_SESSAO, est.sessao);
    Object.assign(est, { respondida: false, resultado: null, selecionada: null, inicio: Date.now() });
    $("#feedback").innerHTML = "";
    $("#btn-responder").hidden = false; $("#btn-proxima").hidden = true;
    desenharOpcoes();
  };
  $("#btn-responder").hidden = true;
  $("#btn-proxima").hidden = false;
  $("#btn-proxima").focus({ preventScroll: true });
}

function irPara(pos) {
  if (pos < 0) return;
  location.hash = `#/resolver/${pos + 1}`;
}

function telaFimSessao(sessao) {
  const res = sessao.ids.map(id => [id, sessao.resultados[id]]).filter(([, r]) => r);
  const certas = res.filter(([, r]) => r.correta === 1).length;
  const erradas = res.filter(([, r]) => r.correta === 0).map(([id]) => id);
  const pct = res.length ? Math.round((certas / res.length) * 100) : 0;
  main.innerHTML = `
    <div class="fim-sessao">
      <h1>Fim da lista</h1>
      ${res.length ? `<div class="numero-grande">${pct}%</div>
        <p>Você respondeu ${res.length} de ${sessao.ids.length} questões e acertou ${certas}.</p>` :
        `<p>Você passou pelas ${sessao.ids.length} questões sem responder nenhuma.</p>`}
      <div class="linha-atalhos" style="justify-content:center">
        ${erradas.length ? `<button class="botao primario" id="refazer-erradas" type="button">Refazer as ${erradas.length} que errei</button>` : ""}
        <a class="botao ${erradas.length ? "" : "primario"}" href="#/resolver">Escolher outros filtros</a>
        <a class="botao" href="#/resolver/1">Voltar ao início da lista</a>
      </div>
    </div>`;
  if ($("#refazer-erradas")) $("#refazer-erradas").onclick = () => {
    gravarLocal(CHAVE_SESSAO, { ids: erradas, pos: 0, resultados: {}, filtros: sessao.filtros, inicio: new Date().toISOString() });
    location.hash = "#/resolver/1";
  };
}

// ------------------------------------------------------------------ atalhos de teclado
document.addEventListener("keydown", e => {
  if (!estadoQuestao || !$(".resolver") || $(".fazer-simulado")) return; // no simulado valem os atalhos dele
  if (e.target.closest("input, textarea, select, [contenteditable]") || e.ctrlKey || e.metaKey || e.altKey) return;
  const est = estadoQuestao;
  const k = e.key.toUpperCase();
  if (e.key === "Enter") {
    if (e.target.closest("a, summary, .botao-icone, #btn-anterior, #refazer")) return; // Enter nativo nesses
    e.preventDefault();
    return est.respondida ? irPara(est.pos + 1) : responderAtual();
  }
  if (e.key === "ArrowRight") { e.preventDefault(); return irPara(est.pos + 1); }
  if (e.key === "ArrowLeft") { e.preventDefault(); return irPara(est.pos - 1); }
  if (k === "F" && !e.shiftKey) { e.preventDefault(); return alternarFavorita(); }
  if (est.respondida) return;
  if (est.q.tipo === "CE") {
    if (k === "C" || k === "E") { e.preventDefault(); selecionar(k); }
    return;
  }
  const letras = est.q.alternativas.map(a => a.letra);
  if (letras.includes(k)) {
    e.preventDefault();
    if (e.shiftKey) riscar(k); else selecionar(k);
  }
});
