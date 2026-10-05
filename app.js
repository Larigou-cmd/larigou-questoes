"use strict";
/* Larigou Questões — interface (JS puro, sem dependências externas). */

const $ = (sel, raiz = document) => raiz.querySelector(sel);
const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];
const main = $("#conteudo");
const LETRAS = ["A", "B", "C", "D", "E"];

// ------------------------------------------------------------------ utilidades
function esc(t) {
  return String(t ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** Converte o texto guardado no banco em HTML: parágrafos, **negrito** e [[img:arquivo]]. */
function formatar(texto) {
  if (!texto) return "";
  return String(texto).split(/\n{2,}/).map(par => {
    let h = esc(par.trim())
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\[\[img:([\w.\-]+)\]\]/g, (_, n) => `<img src="${window.MODO_WEB ? "" : "/"}imagens/${encodeURIComponent(n)}" alt="Figura da questão" loading="lazy">`)
      .replace(/\n/g, "<br>");
    return `<p>${h}</p>`;
  }).join("");
}

async function api(caminho, opcoes = {}) {
  const r = await fetch(caminho, {
    headers: { "Content-Type": "application/json" },
    ...opcoes,
    body: opcoes.body && typeof opcoes.body !== "string" ? JSON.stringify(opcoes.body) : opcoes.body,
  });
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) {
    const erro = new Error((dados.erros || ["Não foi possível completar a ação."]).join(" "));
    erro.erros = dados.erros || [];
    throw erro;
  }
  return dados;
}

let temporizadorAviso;
function avisar(msg, tipo = "") {
  const el = $("#aviso");
  el.textContent = msg;
  el.className = "aviso-flutuante " + tipo;
  el.hidden = false;
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => (el.hidden = true), 3200);
}

function opcoes(lista, selecionado, rotuloVazio) {
  return (rotuloVazio !== undefined ? `<option value="">${esc(rotuloVazio)}</option>` : "") +
    lista.map(v => `<option value="${esc(v)}" ${String(v) === String(selecionado ?? "") ? "selected" : ""}>${esc(v)}</option>`).join("");
}

function datalist(id, lista) {
  return `<datalist id="${id}">${lista.map(v => `<option value="${esc(v)}">`).join("")}</datalist>`;
}

function problemasDe(q) {
  const erros = (q.problemas || []).filter(p => p.nivel === "erro");
  const avisos = (q.problemas || []).filter(p => p.nivel !== "erro");
  return { erros, avisos };
}

let META = null;
async function carregarMeta(forcar = false) {
  if (!META || forcar) META = await api("/api/meta");
  const n = META.contagem.com_erro || 0;
  const c = $("#contador-revisao");
  if (c) { c.textContent = n; c.hidden = !n; }
  const hoje = META.caderno_hoje || 0;
  const cc = $("#contador-caderno");
  if (cc) { cc.textContent = hoje; cc.hidden = !hoje; cc.title = `${hoje} para revisar hoje`; }
  return META;
}

// ------------------------------------------------------------------ alturas para as barras que grudam no topo
// O cabeçalho muda de altura (celular, nível/XP, aviso de sincronização), então medimos em vez de chutar.
function medirBarra(el, variavel) {
  if (!el || !window.ResizeObserver) return;
  new ResizeObserver(() => document.documentElement.style.setProperty(variavel, el.offsetHeight + "px")).observe(el);
}
medirBarra($(".topo"), "--altura-topo");
// no celular o menu vira a barra de abas fixa embaixo; no computador ele fica no cabeçalho e não conta
if (window.ResizeObserver) new ResizeObserver(() => {
  const menu = $(".menu");
  const fixo = getComputedStyle(menu).position === "fixed";
  document.documentElement.style.setProperty("--altura-abas", fixo ? Math.floor(innerHeight - menu.getBoundingClientRect().top) + "px" : "0px");
}).observe($(".menu"));

// ------------------------------------------------------------------ tema
$("#botao-tema").addEventListener("click", () => {
  const raiz = document.documentElement;
  const escuroAgora = raiz.dataset.theme ? raiz.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  raiz.dataset.theme = escuroAgora ? "light" : "dark";
  try { localStorage.setItem("tema", raiz.dataset.theme); } catch (e) {}
});

// ------------------------------------------------------------------ rotas
const ROTAS = [
  [/^#?\/?$/, telaInicio, "inicio"],
  [/^#\/questoes(?:\/(\d+))?$/, telaQuestoes, "banco"],
  [/^#\/resolver$/, telaResolverFiltros, "resolver"],
  [/^#\/resolver\/(\d+)$/, telaResolverQuestao, "resolver"],
  [/^#\/simulados$/, telaSimulados, "simulados"],
  [/^#\/simulados\/(\d+)$/, telaFazerSimulado, "simulados"],
  [/^#\/simulados\/(\d+)\/resultado$/, telaResultadoSimulado, "simulados"],
  [/^#\/nova$/, telaNova, "banco"],
  [/^#\/revisao$/, telaRevisao, "banco"],
  [/^#\/importar$/, telaImportar, "banco"],
  [/^#\/backup$/, telaBackup, "banco"],
  [/^#\/desempenho$/, telaDesempenho, "desempenho"],
  [/^#\/desempenho\/historico$/, telaHistorico, "desempenho"],
  [/^#\/caderno$/, telaCaderno, "caderno"],
];

let saindo = null; // função que pergunta se pode sair (edição não salva)

async function navegar() {
  const hash = location.hash || "#/";
  for (const [re, tela, nome] of ROTAS) {
    const m = hash.split("?")[0].match(re);
    if (m) {
      $$(".menu a, #atalho-conta").forEach(a => a.dataset.rota === nome ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
      // versão web: sem edição do banco; "#/questoes/ID" abre a questão para resolver
      if (window.MODO_WEB && nome === "banco" && tela !== telaBackup) {
        if (tela === telaQuestoes && m[1]) {
          gravarLocal("larigou.sessao", { ids: [Number(m[1])], pos: 0, resultados: {}, filtros: null, inicio: new Date().toISOString() });
          location.hash = "#/resolver/1";
        } else location.hash = "#/resolver";
        return;
      }
      if (nome !== "inicio") atualizarJogo();  // a Início já atualiza antes de desenhar
      try {
        await tela(...m.slice(1));
        if (nome === "banco" && !window.MODO_WEB) submenuBanco();
      } catch (e) {
        main.innerHTML = `<div class="vazio"><h2>Algo deu errado</h2><p>${esc(e.message)}</p><p>Confira se a janela do servidor ainda está aberta e recarregue a página.</p></div>`;
      }
      return;
    }
  }
  location.hash = "#/";
}

window.addEventListener("hashchange", e => {
  if (saindo && !saindo()) {
    history.replaceState(null, "", e.oldURL);
    return;
  }
  navegar();
});
window.addEventListener("beforeunload", e => { if (saindo && !saindo(true)) e.preventDefault(); });

/** Submenu das telas de manutenção do banco (editar, nova, revisão, importar, backup). */
function submenuBanco() {
  const itens = [["#/questoes", "Editar questões"], ["#/nova", "Nova questão"], ["#/revisao", "Revisão da importação"],
    ["#/importar", "Importar provas"], ["#/backup", "Backup"]];
  let nav = $(".submenu");
  if (!nav) {
    main.insertAdjacentHTML("afterbegin", `<nav class="submenu" aria-label="Banco de questões">${itens.map(([h, t]) =>
      `<a href="${h}">${t}${h === "#/revisao" && META?.contagem.com_erro ? ` <span class="contador">${META.contagem.com_erro}</span>` : ""}</a>`).join("")}</nav>`);
    nav = $(".submenu");
  }
  const atual = location.hash.split("?")[0];
  $$("a", nav).forEach(a => {
    const ativo = atual === a.getAttribute("href") || (a.getAttribute("href") === "#/questoes" && atual.startsWith("#/questoes"));
    ativo ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current");
  });
}

// ------------------------------------------------------------------ BACKUP
async function telaBackup() {
  if (window.MODO_WEB) return telaBackupWeb();
  saindo = null;
  const lista = await api("/api/backup/lista");
  main.innerHTML = `
    <div style="max-width:860px;margin:0 auto">
      <h1>Backup</h1>
      <section class="painel">
        <h2>Fazer backup</h2>
        <p>Gera um arquivo <code>.json</code> com tudo: questões, textos, imagens, suas respostas, anotações, favoritas,
          simulados e caderno de erros. Uma cópia fica em <code>dados/backups</code> e outra é baixada pelo navegador —
          guarde essa num pen drive ou na nuvem de sua preferência.</p>
        <a class="botao primario" href="/api/backup" download id="baixar-backup">Baixar backup agora</a>
        ${lista.length ? `<h3 style="margin-top:20px">Backups salvos no computador</h3>
          <ul class="lista-backups">${lista.map(b => `<li><code>${esc(b.nome)}</code> <span class="dica">${b.tamanho_kb} KB</span></li>`).join("")}</ul>` : ""}
      </section>
      <section class="painel" style="margin-top:16px">
        <h2>Progresso com o celular (versão da internet)</h2>
        <p>Leve suas respostas, anotações, simulados e caderno de erros entre este notebook e o site.
          Importar <strong>junta</strong> os progressos, sem apagar nem duplicar.</p>
        <div class="linha-atalhos">
          <a class="botao" href="/api/progresso" download>Exportar progresso</a>
          <label class="botao" style="cursor:pointer">Importar progresso do celular
            <input type="file" id="importar-prog-local" accept=".json,application/json" hidden></label>
        </div>
      </section>
      <section class="painel" style="margin-top:16px">
        <h2>Restaurar um backup</h2>
        <p>Substitui <strong>todo</strong> o conteúdo atual pelo do arquivo escolhido. Antes, o app salva automaticamente um
          backup do estado atual em <code>dados/backups</code>, para você poder voltar atrás.</p>
        <p class="dica">Para acrescentar provas novas sem apagar nada, use <a href="#/importar">Importar provas</a>.</p>
        <form id="form-restaurar" class="linha-campos">
          <input class="entrada" type="file" name="arquivo" accept=".json,application/json" required style="max-width:420px">
          <button class="botao perigo" type="submit">Restaurar este backup</button>
        </form>
      </section>
      <section class="painel" style="margin-top:16px">
        <h2>Exportar só as questões</h2>
        <p>Atualiza <code>dados/questoes.json</code>, uma cópia legível das questões para conferência.</p>
        <button class="botao" type="button" id="exportar-json">Atualizar questoes.json</button>
      </section>
    </div>`;
  $("#baixar-backup").onclick = () => setTimeout(async () => { avisar("Backup gerado"); }, 400);
  $("#exportar-json").onclick = async () => { const r = await api("/api/exportar-json", { method: "POST" }); avisar("questoes.json atualizado"); };
  $("#importar-prog-local").onchange = async e => {
    const arquivo = e.target.files[0];
    if (!arquivo) return;
    const dados = new FormData();
    dados.append("arquivo", arquivo);
    const r = await fetch("/api/progresso/importar", { method: "POST", body: dados });
    const j = await r.json();
    if (!r.ok) return avisar((j.erros || ["Não foi possível importar."]).join(" "), "erro");
    avisar(`Importado: ${j.respostas} respostas, ${j.simulados} simulados, ${j.caderno} no caderno`);
    await carregarMeta(true);
    e.target.value = "";
  };
  $("#form-restaurar").onsubmit = async e => {
    e.preventDefault();
    const arquivo = e.target.arquivo.files[0];
    if (!arquivo) return avisar("Escolha o arquivo de backup.");
    if (!confirm(`Restaurar "${arquivo.name}"? Tudo o que está no app agora será substituído (uma cópia de segurança será salva antes).`)) return;
    const dados = new FormData();
    dados.append("arquivo", arquivo);
    const r = await fetch("/api/backup/restaurar", { method: "POST", body: dados });
    const j = await r.json();
    if (!r.ok) return avisar((j.erros || ["Não foi possível restaurar."]).join(" "), "erro");
    try { localStorage.removeItem("larigou.sessao"); } catch (err) {}
    avisar(`Backup restaurado: ${j.contagem.questoes} questões, ${j.contagem.respostas} respostas`);
    await carregarMeta(true);
    telaBackup();
  };
}

// ------------------------------------------------------------------ INÍCIO
async function telaInicio() {
  saindo = null;
  const m = await carregarMeta(true);
  const c = m.contagem;
  if (!c.total) {
    main.innerHTML = `<div class="vazio">
      <h1>Seu banco de questões está vazio</h1>
      <p>Coloque as provas (PDF, DOCX ou TXT) na pasta <code>questoes_brutas</code> e importe, ou cadastre uma questão à mão.</p>
      <div class="linha-atalhos" style="justify-content:center">
        <a class="botao primario" href="#/importar">Importar provas</a>
        <a class="botao" href="#/nova">Cadastrar questão</a>
      </div></div>`;
    return;
  }
  const porDisc = {};
  const discs = await Promise.all(m.disciplinas.map(async d => [d, (await api(`/api/questoes?disciplina=${encodeURIComponent(d)}&limite=1`)).total]));
  discs.forEach(([d, n]) => { if (n) porDisc[d] = n; });
  const maior = Math.max(...Object.values(porDisc), 1);
  await atualizarJogo();

  main.innerHTML = `
    <section class="inicio-cabeca">
      <div>
        <h1>Bora resolver?</h1>
        <p>Seu banco reúne ${m.provas.length} prova${m.provas.length === 1 ? "" : "s"} de ${m.bancas.join(", ")}.
        ${window.MODO_WEB ? "Seu progresso fica salvo neste aparelho." : "Revise a classificação das questões antes de começar a estudar: é ela que alimenta os filtros e as estatísticas."}</p>
        <div class="linha-atalhos">
          <a class="botao primario" href="#/resolver">Resolver questões</a>
          ${m.caderno_hoje ? `<a class="botao" href="#/caderno">Revisar ${m.caderno_hoje} do caderno de erros</a>` : ""}
          <a class="botao" href="#/simulados">Fazer um simulado</a>
          ${c.com_erro ? `<a class="botao" href="#/revisao">Revisar ${c.com_erro} com problema</a>` : ""}
          ${c.sugeridos ? `<a class="botao" href="#/questoes?situacao=sugerido">Confirmar ${c.sugeridos} assuntos sugeridos</a>` : ""}
        </div>
      </div>
      <div>
        <div class="numero-grande">${c.total}</div>
        <p style="margin:.4em 0 0;color:var(--tinta-2)">questões no banco${c.manuais ? `, ${c.manuais} cadastradas por você` : ""}${c.anuladas ? `, ${c.anuladas} anuladas` : ""}</p>
      </div>
    </section>
    ${htmlPainelJogo()}
    <div class="grade-2">
      <section class="painel">
        <h2>Provas importadas</h2>
        <table class="tabela-provas">
          <thead><tr><th>Órgão</th><th>Cargo</th><th class="opcional">Gabarito</th><th class="num">Questões</th></tr></thead>
          <tbody>${m.provas.map(p => `<tr>
            <td>${window.MODO_WEB ? esc(p.orgao || "Sem órgão") : `<a href="#/questoes?prova=${p.id}">${esc(p.orgao || "Sem órgão")}</a>`}<br><span class="dica">${esc(p.concurso || "")} ${p.ano ? `(${p.ano})` : ""}</span></td>
            <td>${esc(p.cargo || "")}</td>
            <td class="opcional"><span class="etiqueta ${p.gabarito_status === "definitivo" ? "ok" : "aviso"}">${esc(p.gabarito_status || "?")}</span></td>
            <td class="num">${p.n}</td></tr>`).join("")}</tbody>
        </table>
      </section>
      <section class="painel">
        <h2>Questões por disciplina</h2>
        <div class="barras">${Object.entries(porDisc).sort((a, b) => b[1] - a[1]).map(([d, n]) => `
          <a class="barra" href="${window.MODO_WEB ? "#/resolver" : `#/questoes?disciplina=${encodeURIComponent(d)}`}" style="text-decoration:none;color:inherit">
            <span>${esc(d)}</span><span class="trilho"><span class="cheio" style="width:${(n / maior) * 100}%;display:block"></span></span><span class="valor">${n}</span>
          </a>`).join("")}</div>
      </section>
    </div>`;
}

// ------------------------------------------------------------------ QUESTÕES (lista + editor)
const estadoLista = { filtros: {}, pagina: 1, itens: [], total: 0 };

function filtrosDaUrl() {
  const q = new URLSearchParams(location.hash.split("?")[1] || "");
  const f = {};
  for (const [k, v] of q) f[k] = v;
  return f;
}

async function telaQuestoes(id) {
  const meta = await carregarMeta();
  const vindoDeFora = !$(".editor-layout");
  if (vindoDeFora) {
    estadoLista.filtros = filtrosDaUrl();
    estadoLista.pagina = 1;
    main.innerHTML = `
      <div class="editor-layout">
        <aside class="lista-coluna" aria-label="Lista de questões">
          <form class="filtros" id="filtros">
            <input class="entrada largo" type="search" name="busca" placeholder="Buscar no enunciado ou alternativas" aria-label="Buscar">
            <select class="entrada" name="prova" aria-label="Prova">${opcoes(meta.provas.map(p => p.id), "", "Todas as provas")}</select>
            <select class="entrada" name="disciplina" aria-label="Disciplina">${opcoes(meta.disciplinas, "", "Todas as disciplinas")}</select>
            <select class="entrada largo" name="situacao" aria-label="Situação">
              <option value="">Todas as situações</option>
              <option value="erro">Com problema de importação</option>
              <option value="aviso">Com erro ou aviso não revisado</option>
              <option value="sugerido">Assunto sugerido (a confirmar)</option>
              <option value="sem_assunto">Sem assunto</option>
              <option value="manual">Cadastradas por mim</option>
              <option value="anulada">Anuladas</option>
            </select>
          </form>
          <div class="lista-info"><span id="lista-total"></span>
            <button class="botao-texto" id="confirmar-todos" type="button" hidden>Confirmar assuntos desta lista</button></div>
          <div class="lista" id="lista" role="list"></div>
          <div class="paginacao"><button class="botao pequeno" id="pag-ant" type="button">Anteriores</button>
            <button class="botao pequeno" id="pag-prox" type="button">Próximas</button></div>
        </aside>
        <section class="editor" id="editor" aria-live="polite"></section>
      </div>`;
    // rótulos legíveis para as provas
    const selProva = $("[name=prova]");
    meta.provas.forEach((p, i) => { selProva.options[i + 1].textContent = `${p.orgao} — ${p.cargo}`; });
    const form = $("#filtros");
    for (const [k, v] of Object.entries(estadoLista.filtros)) if (form.elements[k]) form.elements[k].value = v;
    let t;
    form.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(() => {
        estadoLista.filtros = Object.fromEntries([...new FormData(form)].filter(([, v]) => v));
        estadoLista.pagina = 1;
        carregarLista();
      }, 250);
    });
    form.addEventListener("submit", e => e.preventDefault());
    $("#pag-ant").onclick = () => { estadoLista.pagina--; carregarLista(); };
    $("#pag-prox").onclick = () => { estadoLista.pagina++; carregarLista(); };
    $("#confirmar-todos").onclick = confirmarAssuntosDaLista;
    await carregarLista();
  }
  $(".editor-layout").classList.toggle("com-questao", !!id);
  $$(".item-lista").forEach(el => el.setAttribute("aria-current", String(el.dataset.id === id)));
  if (id) await abrirEditor(Number(id));
  else {
    saindo = null;
    $("#editor").innerHTML = `<div class="vazio painel"><h2>Escolha uma questão na lista</h2>
      <p>Use os filtros para achar as que precisam de revisão ou de classificação.</p>
      <a class="botao" href="#/nova">Cadastrar questão nova</a></div>`;
  }
}

async function carregarLista() {
  const p = new URLSearchParams({ ...estadoLista.filtros, pagina: estadoLista.pagina, limite: 60 });
  const r = await api("/api/questoes?" + p);
  estadoLista.itens = r.itens;
  estadoLista.total = r.total;
  const atual = (location.hash.match(/questoes\/(\d+)/) || [])[1];
  $("#lista-total").textContent = `${r.total} ${r.total === 1 ? "questão" : "questões"}`;
  $("#lista").innerHTML = r.itens.length ? r.itens.map(q => {
    const { erros, avisos } = problemasDe(q);
    const pend = !q.revisada;
    return `<a role="listitem" class="item-lista" data-id="${q.id}" aria-current="${String(q.id) === atual}" href="#/questoes/${q.id}">
      <div class="item-topo"><strong>${q.numero ? "Q" + q.numero : "Nova"}</strong> ${esc(q.orgao || "")} ${q.cargo ? "/ " + esc(q.cargo) : ""}
        ${pend && erros.length ? `<span class="etiqueta erro">${erros.length} problema${erros.length > 1 ? "s" : ""}</span>` : ""}
        ${pend && !erros.length && avisos.length ? `<span class="etiqueta aviso">aviso</span>` : ""}
        ${q.anulada ? `<span class="etiqueta">anulada</span>` : ""}
      </div>
      <div class="item-topo">${esc(q.disciplina || "Sem disciplina")} ${q.assunto ? "/ " + esc(q.assunto) : ""} ${q.assunto_sugerido ? `<span class="etiqueta roxa">sugerido</span>` : ""}</div>
      <div class="item-resumo">${esc(q.resumo.replace(/\*\*|\[\[img:[^\]]+\]\]/g, ""))}</div></a>`;
  }).join("") : `<div class="vazio">Nenhuma questão com esses filtros.</div>`;
  $("#pag-ant").disabled = estadoLista.pagina <= 1;
  $("#pag-prox").disabled = estadoLista.pagina * 60 >= r.total;
  $("#confirmar-todos").hidden = !r.itens.some(q => q.assunto_sugerido);
}

async function confirmarAssuntosDaLista() {
  const ids = estadoLista.itens.filter(q => q.assunto_sugerido && q.assunto).map(q => q.id);
  if (!ids.length || !confirm(`Confirmar o assunto sugerido de ${ids.length} questões desta página?`)) return;
  await api("/api/questoes/confirmar-assuntos", { method: "POST", body: { ids } });
  avisar(`${ids.length} assuntos confirmados`);
  await carregarMeta(true);
  await carregarLista();
}

// ---------- formulário de questão (usado na edição e na criação)
function formularioQuestao(q, meta) {
  const alts = q.alternativas?.length ? q.alternativas : LETRAS.slice(0, 4).map(l => ({ letra: l, texto: "" }));
  const assuntosDisc = meta.assuntos[q.disciplina || ""] || [];
  return `
    <form id="form-questao" class="editor" novalidate>
      <div class="caixa-alerta erro" id="erros-form" hidden></div>
      <section class="painel">
        <div class="grade-class">
          <label class="campo"><span>Disciplina</span>
            <input class="entrada" name="disciplina" list="dl-disc" value="${esc(q.disciplina || "")}"></label>
          <label class="campo"><span>Assunto ${q.assunto_sugerido ? `<span class="etiqueta roxa">sugerido automaticamente</span>` : ""}</span>
            <input class="entrada" name="assunto" list="dl-assunto" value="${esc(q.assunto || "")}" placeholder="Ex.: Farmacocinética"></label>
        </div>
        ${datalist("dl-disc", meta.disciplinas)}${datalist("dl-assunto", assuntosDisc)}
        <div class="grade-meta" style="margin-top:12px">
          <label class="campo"><span>Banca</span><input class="entrada" name="banca" list="dl-banca" value="${esc(q.banca || "")}"></label>
          <label class="campo"><span>Órgão</span><input class="entrada" name="orgao" list="dl-orgao" value="${esc(q.orgao || "")}"></label>
          <label class="campo"><span>Cargo</span><input class="entrada" name="cargo" list="dl-cargo" value="${esc(q.cargo || "")}"></label>
          <label class="campo"><span>Ano</span><input class="entrada" name="ano" type="number" min="1990" max="2100" value="${esc(q.ano || "")}"></label>
          <label class="campo"><span>Nº na prova</span><input class="entrada" name="numero" type="number" min="1" value="${esc(q.numero || "")}"></label>
        </div>
        ${datalist("dl-banca", meta.bancas)}${datalist("dl-orgao", meta.orgaos)}${datalist("dl-cargo", meta.cargos)}
      </section>

      ${q.texto_base ? `<details class="texto-base">
        <summary>Texto-base das questões ${q.texto_base.q_inicio} a ${q.texto_base.q_fim}${q.texto_base.titulo ? ": " + esc(q.texto_base.titulo) : ""}</summary>
        <div class="conteudo-tb">
          <div class="leitura" id="tb-leitura">${formatar(q.texto_base.conteudo)}</div>
          <button class="botao pequeno" type="button" id="editar-tb">Editar texto-base</button>
          <div id="tb-edicao" hidden>
            <label class="campo"><span>Título</span><input class="entrada" id="tb-titulo" value="${esc(q.texto_base.titulo || "")}"></label>
            <label class="campo" style="margin-top:8px"><span>Texto (linha em branco separa parágrafos)</span>
              <textarea class="entrada" id="tb-conteudo" rows="12">${esc(q.texto_base.conteudo)}</textarea></label>
            <button class="botao pequeno primario" type="button" id="salvar-tb" style="margin-top:8px">Salvar texto-base</button>
            <span class="dica">Vale para todas as questões ${q.texto_base.q_inicio} a ${q.texto_base.q_fim}.</span>
          </div>
        </div></details>` : ""}

      <section class="painel">
        <div class="editor-cabeca" style="margin-bottom:10px">
          <h3 style="margin:0">Enunciado</h3>
          <button class="botao-texto" type="button" id="alternar-previa">Ver como vai aparecer</button>
        </div>
        <textarea class="entrada" name="enunciado" rows="8" aria-label="Enunciado">${esc(q.enunciado || "")}</textarea>
        <div class="leitura pre-visual" id="previa" hidden></div>
        <p class="dica" style="margin:.5em 0 0">Linha em branco separa parágrafos. Use **assim** para negrito.</p>
      </section>

      <section class="painel">
        <div class="editor-cabeca" style="margin-bottom:14px">
          <h3 style="margin:0">Resposta</h3>
          <div class="alternar" role="group" aria-label="Tipo de questão">
            <button type="button" data-tipo="ME" aria-pressed="${q.tipo !== "CE"}">Múltipla escolha</button>
            <button type="button" data-tipo="CE" aria-pressed="${q.tipo === "CE"}">Certo ou errado</button>
          </div>
        </div>
        <div id="bloco-me" ${q.tipo === "CE" ? "hidden" : ""}>
          <p class="dica">Clique no hexágono da alternativa correta para marcar o gabarito.</p>
          <div id="alternativas">${alts.map((a, i) => linhaAlternativa(a.texto, i, q.gabarito)).join("")}</div>
          <button class="botao pequeno" type="button" id="add-alt" style="margin-top:12px">Adicionar alternativa</button>
        </div>
        <div id="bloco-ce" ${q.tipo === "CE" ? "" : "hidden"}>
          <div class="ce-botoes">
            <button type="button" class="botao certo" data-ce="C" aria-pressed="${q.tipo === "CE" && q.gabarito === "C"}">Certo</button>
            <button type="button" class="botao errado" data-ce="E" aria-pressed="${q.tipo === "CE" && q.gabarito === "E"}">Errado</button>
          </div>
        </div>
        <label class="check" style="margin-top:16px"><input type="checkbox" name="anulada" ${q.anulada ? "checked" : ""}> Questão anulada pela banca</label>
      </section>
    </form>`;
}

function linhaAlternativa(texto, i, gabarito) {
  const l = LETRAS[i];
  return `<div class="alt-editor" data-i="${i}">
    <button type="button" class="hex ${gabarito === l ? "marcado" : ""}" data-letra="${l}" aria-pressed="${gabarito === l}"
      aria-label="Marcar ${l} como gabarito" title="Marcar ${l} como gabarito"><span>${l}</span></button>
    <textarea class="entrada" rows="2" aria-label="Texto da alternativa ${l}">${esc(texto)}</textarea>
    <button type="button" class="botao-texto remover-alt" aria-label="Remover alternativa ${l}" title="Remover alternativa">✕</button>
  </div>`;
}

/** Liga os controles do formulário e devolve uma função que lê os valores. */
function ligarFormulario(q, meta) {
  const form = $("#form-questao");
  let tipo = q.tipo || "ME";
  let gabarito = q.gabarito || null;

  const renumerar = () => {
    $$("#alternativas .alt-editor").forEach((el, i) => {
      const l = LETRAS[i];
      el.dataset.i = i;
      const hex = $(".hex", el);
      hex.dataset.letra = l;
      $("span", hex).textContent = l;
      hex.setAttribute("aria-label", `Marcar ${l} como gabarito`);
      $("textarea", el).setAttribute("aria-label", `Texto da alternativa ${l}`);
    });
    const n = $$("#alternativas .alt-editor").length;
    if (tipo === "ME" && gabarito && LETRAS.indexOf(gabarito) >= n) gabarito = null;
    marcar();
    $("#add-alt").disabled = n >= 5;
  };
  const marcar = () => {
    $$("#alternativas .hex").forEach(h => {
      const on = tipo === "ME" && h.dataset.letra === gabarito;
      h.classList.toggle("marcado", on);
      h.setAttribute("aria-pressed", on);
    });
    $$("[data-ce]").forEach(b => b.setAttribute("aria-pressed", tipo === "CE" && b.dataset.ce === gabarito));
  };

  $("#alternativas").addEventListener("click", e => {
    const hex = e.target.closest(".hex");
    if (hex) { gabarito = hex.dataset.letra; marcar(); }
    const rem = e.target.closest(".remover-alt");
    if (rem) {
      const linha = rem.closest(".alt-editor");
      const letra = LETRAS[Number(linha.dataset.i)];
      if (gabarito === letra) gabarito = null;
      else if (gabarito && LETRAS.indexOf(gabarito) > LETRAS.indexOf(letra)) gabarito = LETRAS[LETRAS.indexOf(gabarito) - 1];
      linha.remove();
      renumerar();
    }
  });
  $("#add-alt").onclick = () => {
    const n = $$("#alternativas .alt-editor").length;
    if (n >= 5) return;
    $("#alternativas").insertAdjacentHTML("beforeend", linhaAlternativa("", n, gabarito));
    renumerar();
    $$("#alternativas textarea").at(-1).focus();
  };
  $$("[data-tipo]").forEach(b => b.onclick = () => {
    if (tipo === b.dataset.tipo) return;
    tipo = b.dataset.tipo;
    gabarito = null;
    $$("[data-tipo]").forEach(x => x.setAttribute("aria-pressed", x === b));
    $("#bloco-me").hidden = tipo !== "ME";
    $("#bloco-ce").hidden = tipo !== "CE";
    marcar();
  });
  $$("[data-ce]").forEach(b => b.onclick = () => { gabarito = b.dataset.ce; marcar(); });

  // assuntos mudam conforme a disciplina
  form.elements.disciplina.addEventListener("change", () => {
    $("#dl-assunto").innerHTML = (meta.assuntos[form.elements.disciplina.value] || []).map(v => `<option value="${esc(v)}">`).join("");
  });

  $("#alternar-previa").onclick = () => {
    const prev = $("#previa");
    const ta = form.elements.enunciado;
    const mostrar = prev.hidden;
    prev.innerHTML = formatar(ta.value);
    prev.hidden = !mostrar;
    ta.hidden = mostrar;
    $("#alternar-previa").textContent = mostrar ? "Voltar a editar" : "Ver como vai aparecer";
  };

  if ($("#editar-tb")) {
    $("#editar-tb").onclick = () => { $("#tb-edicao").hidden = false; $("#editar-tb").hidden = true; };
    $("#salvar-tb").onclick = async () => {
      const tb = await api(`/api/textos-base/${q.texto_base.id}`, { method: "PUT",
        body: { titulo: $("#tb-titulo").value, conteudo: $("#tb-conteudo").value } });
      q.texto_base = tb;
      $("#tb-leitura").innerHTML = formatar(tb.conteudo);
      $("#tb-edicao").hidden = true; $("#editar-tb").hidden = false;
      avisar("Texto-base salvo");
    };
  }
  renumerar();

  return function ler() {
    const f = form.elements;
    return {
      tipo, gabarito,
      disciplina: f.disciplina.value, assunto: f.assunto.value,
      banca: f.banca.value, orgao: f.orgao.value, cargo: f.cargo.value, ano: f.ano.value, numero: f.numero.value,
      enunciado: f.enunciado.value,
      alternativas: tipo === "ME" ? $$("#alternativas textarea").map((t, i) => ({ letra: LETRAS[i], texto: t.value })) : [],
      anulada: f.anulada.checked,
    };
  };
}

function mostrarErros(erros) {
  const caixa = $("#erros-form");
  caixa.innerHTML = `<strong>Confira antes de salvar:</strong><ul>${erros.map(e => `<li>${esc(e)}</li>`).join("")}</ul>`;
  caixa.hidden = false;
  caixa.scrollIntoView({ behavior: "smooth", block: "center" });
}

function vigiarAlteracoes(lerFn) {
  const inicial = JSON.stringify(lerFn());
  const tbInicial = () => $("#tb-edicao") && !$("#tb-edicao").hidden;
  saindo = (silencioso) => {
    const mudou = JSON.stringify(lerFn()) !== inicial || tbInicial();
    if (!mudou) return true;
    return silencioso ? false : confirm("Há alterações não salvas nesta questão. Sair mesmo assim?");
  };
}

async function abrirEditor(id) {
  const [q, meta] = await Promise.all([api(`/api/questoes/${id}`), carregarMeta()]);
  const { erros, avisos } = problemasDe(q);
  const origem = q.prova ? `${q.prova.orgao} — ${q.prova.concurso || ""} — ${q.prova.cargo || ""}` : "Cadastrada por você";
  $("#editor").innerHTML = `
    <div class="editor-cabeca">
      <div>
        <a class="botao-texto voltar-lista" href="#/questoes" style="padding-left:0">Voltar à lista</a>
        <h2>Questão ${q.numero || ""} <span class="dica">#${q.id}</span></h2>
        <div class="origem">${esc(origem)}${q.gabarito_status ? `, gabarito ${esc(q.gabarito_status)}` : ""}</div>
      </div>
      <div style="display:flex;gap:8px">
        <a class="botao pequeno" ${q.anterior_id ? `href="#/questoes/${q.anterior_id}"` : `aria-disabled="true"`} title="Questão anterior">Anterior</a>
        <a class="botao pequeno" ${q.proxima_id ? `href="#/questoes/${q.proxima_id}"` : `aria-disabled="true"`} title="Próxima questão">Próxima</a>
      </div>
    </div>
    ${!q.revisada && erros.length ? `<div class="caixa-alerta erro"><strong>Problemas encontrados na importação:</strong><ul>${erros.map(p => `<li>${esc(p.msg)}</li>`).join("")}</ul>
      Corrija e salve — ao salvar, a questão sai da lista de revisão.</div>` : ""}
    ${avisos.length ? `<div class="caixa-alerta aviso">${avisos.map(p => esc(p.msg)).join("<br>")}</div>` : ""}
    ${formularioQuestao(q, meta)}
    <div class="acoes-editor">
      <button class="botao primario" type="button" id="salvar">Salvar</button>
      <button class="botao" type="button" id="salvar-prox" ${q.proxima_id ? "" : "hidden"}>Salvar e ir para a próxima</button>
      <span class="espaco"></span>
      <button class="botao perigo" type="button" id="excluir">Excluir</button>
    </div>
    <p class="dica">Atalho: Ctrl+S salva.</p>`;
  const ler = ligarFormulario(q, meta);
  vigiarAlteracoes(ler);

  const salvar = async (irProxima) => {
    try {
      await api(`/api/questoes/${id}`, { method: "PUT", body: ler() });
      saindo = null;
      avisar("Questão salva");
      await carregarMeta(true);
      await carregarLista();
      if (irProxima && q.proxima_id) location.hash = `#/questoes/${q.proxima_id}`;
      else await abrirEditor(id);
    } catch (e) {
      if (e.erros?.length) mostrarErros(e.erros); else avisar(e.message, "erro");
    }
  };
  $("#salvar").onclick = () => salvar(false);
  $("#salvar-prox").onclick = () => salvar(true);
  $("#excluir").onclick = async () => {
    if (!confirm("Excluir esta questão do banco? Não dá para desfazer.")) return;
    await api(`/api/questoes/${id}`, { method: "DELETE" });
    saindo = null;
    avisar("Questão excluída");
    await carregarMeta(true);
    await carregarLista();
    location.hash = q.proxima_id ? `#/questoes/${q.proxima_id}` : "#/questoes";
  };
}

// caixas de texto crescem conforme o conteúdo
function ajustarAltura(ta) { ta.style.height = "auto"; ta.style.height = ta.scrollHeight + 2 + "px"; }
document.addEventListener("input", e => { if (e.target.matches("textarea.entrada")) ajustarAltura(e.target); });
new MutationObserver(() => $$("textarea.entrada:not([data-ajustada])").forEach(ta => {
  ta.dataset.ajustada = "1";
  requestAnimationFrame(() => ajustarAltura(ta));
})).observe(main, { childList: true, subtree: true });

document.addEventListener("keydown", e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s" && $("#salvar")) {
    e.preventDefault();
    $("#salvar").click();
  }
});

// ------------------------------------------------------------------ NOVA QUESTÃO
async function telaNova() {
  const meta = await carregarMeta();
  const vazia = { tipo: "ME", alternativas: [], gabarito: null };
  main.innerHTML = `
    <div style="max-width:860px;margin:0 auto">
      <h1>Nova questão</h1>
      <p class="dica">Cadastre uma questão à mão. Ela entra nos filtros e simulados como qualquer outra.</p>
      ${formularioQuestao(vazia, meta)}
      <div class="acoes-editor">
        <button class="botao primario" type="button" id="criar">Salvar questão</button>
        <button class="botao" type="button" id="criar-outra">Salvar e cadastrar outra</button>
      </div>
    </div>`;
  const ler = ligarFormulario(vazia, meta);
  vigiarAlteracoes(ler);
  const criar = async (outra) => {
    try {
      const nova = await api("/api/questoes", { method: "POST", body: ler() });
      saindo = null;
      avisar("Questão salva");
      await carregarMeta(true);
      if (outra) {
        // mantém a classificação para agilizar o cadastro em sequência
        const manter = ler();
        await telaNova();
        const f = $("#form-questao").elements;
        for (const k of ["disciplina", "assunto", "banca", "orgao", "cargo", "ano"]) f[k].value = manter[k] || "";
        if (manter.numero) f.numero.value = Number(manter.numero) + 1;
        f.enunciado.focus();
      } else location.hash = `#/questoes/${nova.id}`;
    } catch (e) {
      if (e.erros?.length) mostrarErros(e.erros); else avisar(e.message, "erro");
    }
  };
  $("#criar").onclick = () => criar(false);
  $("#criar-outra").onclick = () => criar(true);
}

// ------------------------------------------------------------------ REVISÃO
async function telaRevisao() {
  saindo = null;
  const lista = await api("/api/relatorio");
  const comErro = lista.filter(q => q.problemas.some(p => p.nivel === "erro"));
  const soAviso = lista.filter(q => !comErro.includes(q));
  const cartao = q => `<a class="painel cartao-revisao" href="#/questoes/${q.id}">
      <div><div class="item-topo"><strong>Q${q.numero || "?"}</strong> ${esc(q.orgao || "")} / ${esc(q.cargo || "")} / ${esc(q.disciplina || "")}</div>
      <div class="item-resumo">${esc(q.resumo.replace(/\*\*|\[\[img:[^\]]+\]\]/g, ""))}</div>
      <div style="margin-top:6px">${q.problemas.map(p => `<span class="etiqueta ${p.nivel}">${esc(p.msg)}</span>`).join(" ")}</div></div>
      <span class="botao pequeno">Corrigir</span></a>`;
  main.innerHTML = `
    <div style="max-width:960px;margin:0 auto">
      <h1>Revisão da importação</h1>
      <p class="dica">Questões que o importador não conseguiu ler por completo (sem gabarito, alternativas faltando, texto quebrado) e avisos para conferir. Ao salvar uma questão no editor, ela sai desta lista.</p>
      <h2 style="margin-top:24px">Precisam de correção (${comErro.length})</h2>
      ${comErro.length ? `<div class="lista-revisao">${comErro.map(cartao).join("")}</div>` : `<p>Nenhuma questão com erro de importação.</p>`}
      <h2 style="margin-top:32px">Avisos para conferir (${soAviso.length})</h2>
      ${soAviso.length ? `<div class="lista-revisao">${soAviso.map(cartao).join("")}</div>` : `<p>Nenhum aviso pendente.</p>`}
    </div>`;
}

// ------------------------------------------------------------------ IMPORTAR
async function telaImportar() {
  saindo = null;
  main.innerHTML = `
    <div style="max-width:860px;margin:0 auto">
      <h1>Importar provas</h1>
      <section class="painel">
        <h2>Como adicionar provas novas</h2>
        <ol class="passos">
          <li>Copie os arquivos (PDF, DOCX ou TXT) para a pasta <code>questoes_brutas</code>. Pode criar subpastas por cargo.</li>
          <li>Se o gabarito vier em arquivo separado, coloque-o na mesma pasta com "gabarito" no nome.</li>
          <li>Clique em importar. Arquivos já importados e questões repetidas são ignorados.</li>
        </ol>
        <button class="botao primario" id="importar" type="button">Importar provas da pasta</button>
      </section>
      <section class="painel" id="resultado" hidden style="margin-top:16px">
        <h2>Resultado</h2>
        <div class="log" id="log"></div>
        <div class="linha-atalhos"><a class="botao" href="#/revisao">Ver revisão</a><a class="botao" href="#/questoes">Ver questões</a></div>
      </section>
    </div>`;
  $("#importar").onclick = async () => {
    const b = $("#importar");
    b.disabled = true; b.textContent = "Importando…";
    try {
      const r = await api("/api/importar", { method: "POST" });
      $("#log").textContent = r.log;
      $("#resultado").hidden = false;
      const novas = r.resultados.reduce((s, x) => s + (x.novas || 0), 0);
      avisar(novas ? `${novas} questões novas importadas` : "Nenhuma questão nova");
      await carregarMeta(true);
    } catch (e) {
      avisar(e.message, "erro");
    } finally {
      b.disabled = false; b.textContent = "Importar provas da pasta";
    }
  };
}

navegar();
carregarMeta().catch(() => {});
