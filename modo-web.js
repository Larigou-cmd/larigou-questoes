"use strict";
/* Larigou Questões — versão web (GitHub Pages).
   Não há servidor: este arquivo responde às mesmas chamadas /api/... que o Flask responde no notebook,
   usando as questões publicadas em dados/questoes.json e o progresso guardado neste aparelho (localStorage).
   O progresso é identificado pelo "hash" de cada questão, para poder ir e vir entre aparelhos. */

window.MODO_WEB = true;
document.documentElement.classList.add("modo-web");

const WEB = {
  chave: "larigou.web.v1",
  dados: null,          // { questoes, textos_base, provas, gerado_em }
  porId: new Map(),
  porHash: new Map(),
  textos: new Map(),
  provas: new Map(),
  store: null,          // progresso deste aparelho
};

const INTERVALOS_REVISAO = [1, 3, 7, 15, 30, 60];

// ------------------------------------------------------------------ datas no mesmo formato do Python
const dois = n => String(n).padStart(2, "0");
function agoraIso() {
  const d = new Date();
  return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}T${dois(d.getHours())}:${dois(d.getMinutes())}:${dois(d.getSeconds())}`;
}
function hojeIso(somaDias = 0) {
  const d = new Date();
  d.setDate(d.getDate() + somaDias);
  return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;
}

// ------------------------------------------------------------------ progresso local
function storeVazio() {
  return { versao: 1, respostas: [], usuario: {}, revisao: {}, simulados: [], seq: { resposta: 0, simulado: 0 },
    removidos: { revisao: {}, simulados: {} } };
}
function carregarStore() {
  try {
    const s = JSON.parse(localStorage.getItem(WEB.chave));
    if (s && s.versao === 1) { s.removidos ??= { revisao: {}, simulados: {} }; return s; }
  } catch (e) {}
  return storeVazio();
}
function salvarStore() {
  try { localStorage.setItem(WEB.chave, JSON.stringify(WEB.store)); }
  catch (e) { console.error("Não foi possível salvar o progresso neste aparelho:", e); }
  window.aoSalvarProgresso?.(); // gancho para sincronização futura (ex.: Supabase)
}

const carregando = (async () => {
  WEB.store = carregarStore();
  try { await navigator.storage?.persist?.(); } catch (e) {}
  const r = await fetch("dados/questoes.json", { cache: "no-cache" });
  WEB.dados = await r.json();
  for (const q of WEB.dados.questoes) { WEB.porId.set(q.id, q); WEB.porHash.set(q.hash, q); }
  for (const t of WEB.dados.textos_base) WEB.textos.set(t.id, t);
  for (const p of WEB.dados.provas) WEB.provas.set(p.id, p);
})();

// ------------------------------------------------------------------ consultas de apoio
const respostasValidas = () => WEB.store.respostas.filter(r => r.resposta && WEB.porHash.has(r.hash));
function historicoDe(hash) {
  const rs = WEB.store.respostas.filter(r => r.hash === hash && r.resposta)
    .sort((a, b) => (a.respondida_em < b.respondida_em ? -1 : a.respondida_em > b.respondida_em ? 1 : a.id - b.id));
  const ult = rs.at(-1);
  return { tentativas: rs.length, acertos: rs.filter(r => r.correta === 1).length, erros: rs.filter(r => r.correta === 0).length,
    ultima: ult ? { resposta: ult.resposta, correta: ult.correta, respondida_em: ult.respondida_em, modo: ult.modo } : null };
}
function usuarioDe(hash) {
  const u = WEB.store.usuario[hash];
  return { favorita: !!u?.favorita, anotacao: u?.anotacao || "", riscadas: u?.riscadas || [] };
}

/** Porta de consultas.filtros_sql: devolve as questões que passam nos filtros. */
function filtrar(args) {
  const lista = campo => args.getAll(campo).filter(Boolean);
  const campos = ["banca", "orgao", "cargo", "disciplina", "assunto", "tipo"].map(c => [c, new Set(lista(c))]);
  const anos = new Set(lista("ano").map(Number));
  const prova = args.get("prova") ? Number(args.get("prova")) : null;
  const status = args.get("status");
  const busca = (args.get("busca") || "").trim().toLowerCase();
  const ultimaCorreta = new Map();
  if (status) {
    for (const r of [...WEB.store.respostas].filter(r => r.resposta).sort((a, b) => (a.respondida_em < b.respondida_em ? -1 : 1)))
      ultimaCorreta.set(r.hash, r.correta);
  }
  const jaErrou = status === "ja_errei" ? new Set(WEB.store.respostas.filter(r => r.correta === 0).map(r => r.hash)) : null;
  return WEB.dados.questoes.filter(q => {
    for (const [c, vals] of campos) if (vals.size && !vals.has(q[c])) return false;
    if (anos.size && !anos.has(q.ano)) return false;
    if (prova && q.prova_id !== prova) return false;
    if (status === "nao_resolvidas" && ultimaCorreta.has(q.hash)) return false;
    if (status === "resolvidas" && !ultimaCorreta.has(q.hash)) return false;
    if (status === "erradas" && ultimaCorreta.get(q.hash) !== 0) return false;
    if (status === "acertadas" && ultimaCorreta.get(q.hash) !== 1) return false;
    if (jaErrou && !jaErrou.has(q.hash)) return false;
    if (args.get("favoritas") && !WEB.store.usuario[q.hash]?.favorita) return false;
    if (args.get("com_anotacao") && !WEB.store.usuario[q.hash]?.anotacao) return false;
    if (args.get("sem_anuladas") && q.anulada) return false;
    if (args.get("situacao") === "anulada" && !q.anulada) return false;
    if (busca && !(q.enunciado.toLowerCase().includes(busca) || q.alternativas.some(a => a.texto.toLowerCase().includes(busca)))) return false;
    return true;
  });
}

function comparar(...chaves) {
  return (a, b) => {
    for (const k of chaves) {
      const [va, vb] = [k(a), k(b)];
      if (va < vb) return -1;
      if (va > vb) return 1;
    }
    return 0;
  };
}
const ORDENS = {
  prova: comparar(q => (q.prova_id == null ? 1 : 0), q => q.prova_id ?? 0, q => q.numero ?? 0, q => q.id),
  disciplina: comparar(q => q.disciplina || "", q => q.assunto || "", q => q.prova_id ?? 0, q => q.numero ?? 0),
  recentes: comparar(q => -(q.ano || 0), q => -(q.prova_id || 0), q => q.numero ?? 0),
};
function embaralhar(v) {
  for (let i = v.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [v[i], v[j]] = [v[j], v[i]]; }
  return v;
}
function ordenar(lista, ordem) {
  return ordem === "aleatoria" ? embaralhar([...lista]) : [...lista].sort(ORDENS[ordem] || ORDENS.prova);
}

/** Filtros no formato da tela ({disciplina: [...], status: ""}) -> URLSearchParams. */
function paramsDeFiltros(f) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f || {})) {
    if (Array.isArray(v)) v.forEach(x => p.append(k, x));
    else if (v === true) p.set(k, "1");
    else if (v !== false && v != null && v !== "") p.set(k, v);
  }
  return p;
}

// ------------------------------------------------------------------ caderno de erros (porta de revisao.py)
function registrarRevisao(hash, correta) {
  if (correta === null || correta === undefined) return;
  const rv = WEB.store.revisao;
  const item = rv[hash];
  const agora = agoraIso(), hoje = hojeIso();
  if (!correta) {
    const amanha = hojeIso(INTERVALOS_REVISAO[0]);
    rv[hash] = item ? { ...item, etapa: 0, proxima_em: amanha, erros: item.erros + 1, dominada: 0, ultima_em: agora }
      : { etapa: 0, proxima_em: amanha, erros: 1, dominada: 0, entrou_em: agora, ultima_em: agora };
    return;
  }
  if (!item || item.dominada || item.proxima_em > hoje) return;
  const etapa = item.etapa + 1;
  if (etapa >= INTERVALOS_REVISAO.length) Object.assign(item, { dominada: 1, ultima_em: agora });
  else Object.assign(item, { etapa, proxima_em: hojeIso(INTERVALOS_REVISAO[etapa]), ultima_em: agora });
}
function contagemCaderno() {
  const itens = Object.entries(WEB.store.revisao).filter(([h]) => WEB.porHash.has(h)).map(([, v]) => v);
  const hoje = hojeIso();
  return { total: itens.length, hoje: itens.filter(i => !i.dominada && i.proxima_em <= hoje).length,
    pendentes: itens.filter(i => !i.dominada).length, dominadas: itens.filter(i => i.dominada).length };
}

// ------------------------------------------------------------------ simulados (porta de simulados.py)
function corrigir(questoes, anulaErrada) {
  const zero = () => ({ total: 0, certas: 0, erradas: 0, brancos: 0, anuladas: 0, pontos: 0 });
  const geral = zero(), porDisc = {}, itens = [];
  const nomes = { certa: "certas", errada: "erradas", branco: "brancos", anulada: "anuladas" };
  for (const q of questoes) {
    let situacao, pontos;
    if (q.anulada) [situacao, pontos] = ["anulada", 1];
    else if (!q.resposta) [situacao, pontos] = ["branco", 0];
    else if (q.resposta === q.gabarito) [situacao, pontos] = ["certa", 1];
    else [situacao, pontos] = ["errada", q.tipo === "CE" && anulaErrada ? -1 : 0];
    itens.push({ ordem: q.ordem, questao_id: q.id, situacao, pontos });
    const d = porDisc[q.disciplina || "Sem disciplina"] ??= zero();
    for (const alvo of [geral, d]) { alvo.total++; alvo.pontos += pontos; alvo[nomes[situacao]]++; }
  }
  for (const alvo of [geral, ...Object.values(porDisc)])
    alvo.percentual = alvo.total ? Math.round((1000 * alvo.pontos) / alvo.total) / 10 : 0;
  return { geral, por_disciplina: porDisc, itens, anula_errada: anulaErrada, tem_ce: questoes.some(q => q.tipo === "CE") };
}
function ordemDeProva(qs) {
  const ordemDisc = new Map();
  for (const q of qs) if (!ordemDisc.has(q.disciplina)) ordemDisc.set(q.disciplina, ordemDisc.size);
  return [...qs].sort(comparar(q => ordemDisc.get(q.disciplina), q => q.prova_id ?? 0, q => q.numero ?? 0, q => q.id));
}
function questoesDoSimulado(sim, comGabarito) {
  const textos = {};
  const qs = sim.questoes.map(sq => {
    const q = WEB.porHash.get(sq.hash);
    if (!q) return null;
    if (q.texto_base_id && !(q.texto_base_id in textos)) textos[q.texto_base_id] = WEB.textos.get(q.texto_base_id) || null;
    const item = { ordem: sq.ordem, resposta: sq.resposta, riscadas: sq.riscadas || [], revisar: sq.revisar || 0 };
    for (const k of ["id", "tipo", "enunciado", "alternativas", "disciplina", "assunto", "banca", "orgao", "cargo", "ano", "numero", "texto_base_id"]) item[k] = q[k];
    if (comGabarito) for (const k of ["gabarito", "anulada", "gabarito_status", "gabarito_alterado"]) item[k] = q[k];
    return item;
  }).filter(Boolean);
  return [qs, textos];
}
const simPorId = id => WEB.store.simulados.find(s => s.id === id);
function resumoSimulado(s) {
  const { questoes, ...resto } = s;
  return { ...resto, n: questoes.length, respondidas: questoes.filter(q => q.resposta).length };
}

// ------------------------------------------------------------------ rotas da "API"
const ROTAS_WEB = [];
const rota = (metodo, padrao, fn) => ROTAS_WEB.push([metodo, padrao, fn]);
class ErroApi extends Error { constructor(status, erros) { super(erros.join(" ")); this.status = status; this.erros = erros; } }

rota("GET", /^\/api\/meta$/, () => {
  const qs = WEB.dados.questoes;
  const distintos = campo => [...new Set(qs.map(q => q[campo]).filter(v => v !== null && v !== ""))]
    .sort((a, b) => (typeof a === "number" ? a - b : String(a).localeCompare(String(b), "pt-BR")));
  const arvore = {}, assuntos = {};
  for (const q of qs) {
    const d = q.disciplina || "", a = q.assunto || "";
    (arvore[d] ??= {})[a] = (arvore[d][a] || 0) + 1;
    if (a) (assuntos[d] ??= new Set()).add(a);
  }
  const provas = [...WEB.provas.values()].map(p => ({ ...p, n: qs.filter(q => q.prova_id === p.id).length }))
    .sort(comparar(p => p.orgao || "", p => p.cargo || ""));
  return {
    arvore, caderno_hoje: contagemCaderno().hoje, tipos: distintos("tipo"), bancas: distintos("banca"),
    orgaos: distintos("orgao"), cargos: distintos("cargo"), anos: distintos("ano"), disciplinas: distintos("disciplina"),
    assuntos: Object.fromEntries(Object.entries(assuntos).map(([d, s]) => [d, [...s].sort()])), provas,
    contagem: { total: qs.length, com_erro: 0, sem_assunto: qs.filter(q => !q.assunto).length, sugeridos: 0, manuais: 0,
      anuladas: qs.filter(q => q.anulada).length },
  };
});

rota("GET", /^\/api\/questoes$/, (_, args) => {
  const todas = ordenar(filtrar(args), "prova");
  const limite = Math.min(Number(args.get("limite") || 60), 500), pagina = Math.max(Number(args.get("pagina") || 1), 1);
  return { total: todas.length, pagina, itens: todas.slice((pagina - 1) * limite, pagina * limite).map(q => ({
    ...q, revisada: 1, origem: "importada", problemas: [], assunto_sugerido: 0, resumo: q.enunciado.slice(0, 180) })) };
});

rota("GET", /^\/api\/questoes\/(\d+)$/, ([id]) => {
  const q = WEB.porId.get(Number(id));
  if (!q) throw new ErroApi(404, ["Questão não encontrada."]);
  return { ...q, texto_base: q.texto_base_id ? WEB.textos.get(q.texto_base_id) || null : null,
    prova: q.prova_id ? WEB.provas.get(q.prova_id) || null : null, usuario: usuarioDe(q.hash), historico: historicoDe(q.hash),
    problemas: [], revisada: 1, anterior_id: null, proxima_id: null };
});

rota("POST", /^\/api\/questoes\/(\d+)\/responder$/, ([id], _, corpo) => {
  const q = WEB.porId.get(Number(id));
  if (!q) throw new ErroApi(404, ["Questão não encontrada."]);
  const resposta = (corpo.resposta || "").trim().toUpperCase() || null;
  const validas = q.tipo === "CE" ? ["C", "E"] : ["A", "B", "C", "D", "E"];
  if (resposta && !validas.includes(resposta)) throw new ErroApi(400, ["Resposta inválida para este tipo de questão."]);
  if (!q.gabarito && !q.anulada) throw new ErroApi(400, ["Esta questão ainda não tem gabarito cadastrado."]);
  const correta = resposta === null || q.anulada ? null : Number(resposta === q.gabarito);
  WEB.store.respostas.push({ id: ++WEB.store.seq.resposta, hash: q.hash, resposta, correta, modo: "estudo",
    simulado_id: null, tempo_seg: typeof corpo.tempo_seg === "number" ? Math.round(corpo.tempo_seg) : null, respondida_em: agoraIso() });
  registrarRevisao(q.hash, correta);
  salvarStore();
  return { correta, gabarito: q.gabarito, anulada: !!q.anulada, historico: historicoDe(q.hash) };
});

rota("PUT", /^\/api\/questoes\/(\d+)\/usuario$/, ([id], _, corpo) => {
  const q = WEB.porId.get(Number(id));
  if (!q) throw new ErroApi(404, ["Questão não encontrada."]);
  const u = WEB.store.usuario[q.hash] ??= { favorita: 0, anotacao: "", riscadas: [] };
  if ("favorita" in corpo) u.favorita = corpo.favorita ? 1 : 0;
  if ("anotacao" in corpo) u.anotacao = (corpo.anotacao || "").trim();
  if ("riscadas" in corpo) u.riscadas = [...new Set(corpo.riscadas.filter(l => "ABCDE".includes(l)))].sort();
  u.atualizado_em = agoraIso();
  salvarStore();
  return usuarioDe(q.hash);
});

rota("GET", /^\/api\/resolver\/ids$/, (_, args) =>
  ({ ids: ordenar(filtrar(args), args.get("ordem")).slice(0, 5000).map(q => q.id), get total() { return this.ids.length; } }));
rota("GET", /^\/api\/resolver\/contar$/, (_, args) => ({ total: filtrar(args).length }));

// ---- simulados
rota("GET", /^\/api\/simulados$/, () =>
  [...WEB.store.simulados].sort((a, b) => (a.criado_em < b.criado_em ? 1 : -1)).map(resumoSimulado));

rota("POST", /^\/api\/simulados\/contar$/, (_, __, corpo) => {
  const qs = filtrar(paramsDeFiltros(corpo.filtros)).filter(q => q.gabarito || q.anulada);
  return { total: qs.length, tipos: [...new Set(qs.map(q => q.tipo))] };
});

rota("POST", /^\/api\/simulados$/, (_, __, corpo) => {
  let qs, tituloPadrao;
  if (corpo.modo === "prova") {
    const p = WEB.provas.get(Number(corpo.prova_id));
    if (!p) throw new ErroApi(400, ["Escolha uma prova."]);
    qs = WEB.dados.questoes.filter(q => q.prova_id === p.id).sort(comparar(q => q.numero ?? 0, q => q.id));
    tituloPadrao = `${p.orgao} — ${p.cargo} (prova completa)`;
  } else {
    const quantidade = Math.max(1, Math.min(Number(corpo.quantidade) || 20, 500));
    qs = ordemDeProva(embaralhar(filtrar(paramsDeFiltros(corpo.filtros)).filter(q => q.gabarito || q.anulada)).slice(0, quantidade));
    tituloPadrao = `Simulado de ${new Date().toLocaleDateString("pt-BR")} (${qs.length} questões)`;
  }
  if (!qs.length) throw new ErroApi(400, ["Nenhuma questão encontrada para montar o simulado."]);
  const duracao = Number(corpo.duracao_min) || null;
  const sim = { id: ++WEB.store.seq.simulado, titulo: (corpo.titulo || "").trim() || tituloPadrao,
    config: { modo: corpo.modo || "filtros", filtros: corpo.filtros || {}, prova_id: corpo.prova_id, anula_errada: !!corpo.anula_errada },
    duracao_min: duracao, tempo_gasto_seg: 0, estado: "andamento", resultado: null, criado_em: agoraIso(), finalizado_em: null,
    questoes: qs.map((q, i) => ({ ordem: i + 1, hash: q.hash, resposta: null, riscadas: [], revisar: 0 })) };
  WEB.store.simulados.push(sim);
  salvarStore();
  return { id: sim.id };
});

rota("GET", /^\/api\/simulados\/(\d+)$/, ([id]) => {
  const s = simPorId(Number(id));
  if (!s) throw new ErroApi(404, ["Simulado não encontrado."]);
  const [questoes, textos_base] = questoesDoSimulado(s, s.estado === "finalizado");
  const { questoes: _, ...resto } = s;
  return { ...resto, questoes, textos_base };
});

rota("PUT", /^\/api\/simulados\/(\d+)\/resposta$/, ([id], _, corpo) => {
  const s = simPorId(Number(id));
  if (!s) throw new ErroApi(404, ["Simulado não encontrado."]);
  if (s.estado !== "andamento") throw new ErroApi(409, ["Este simulado já foi entregue."]);
  const sq = s.questoes.find(x => x.ordem === Number(corpo.ordem));
  if (sq) {
    if ("resposta" in corpo) sq.resposta = (corpo.resposta || "").toUpperCase() || null;
    if ("riscadas" in corpo) sq.riscadas = [...new Set(corpo.riscadas.filter(l => "ABCDE".includes(l)))].sort();
    if ("revisar" in corpo) sq.revisar = corpo.revisar ? 1 : 0;
  }
  if (typeof corpo.tempo_gasto_seg === "number") s.tempo_gasto_seg = Math.max(s.tempo_gasto_seg, Math.round(corpo.tempo_gasto_seg));
  salvarStore();
  return { ok: true };
});

rota("PUT", /^\/api\/simulados\/(\d+)\/tempo$/, ([id], _, corpo) => {
  const s = simPorId(Number(id));
  if (s && s.estado === "andamento") { s.tempo_gasto_seg = Math.max(s.tempo_gasto_seg, Math.round(corpo.tempo_gasto_seg || 0)); salvarStore(); }
  return { ok: true };
});

rota("POST", /^\/api\/simulados\/(\d+)\/finalizar$/, ([id], _, corpo) => {
  const s = simPorId(Number(id));
  if (!s) throw new ErroApi(404, ["Simulado não encontrado."]);
  if (s.estado === "finalizado") return s.resultado;
  let tempo = Math.round(corpo.tempo_gasto_seg || s.tempo_gasto_seg);
  if (s.duracao_min) tempo = Math.min(tempo, s.duracao_min * 60);
  const [questoes] = questoesDoSimulado(s, true);
  const resultado = { ...corrigir(questoes, !!s.config.anula_errada), tempo_gasto_seg: tempo };
  const agora = agoraIso();
  for (const q of questoes) {
    if (!q.resposta) continue;
    const correta = q.anulada ? null : Number(q.resposta === q.gabarito);
    const hash = WEB.porId.get(q.id).hash;
    WEB.store.respostas.push({ id: ++WEB.store.seq.resposta, hash, resposta: q.resposta, correta, modo: "simulado",
      simulado_id: s.id, tempo_seg: null, respondida_em: agora });
    registrarRevisao(hash, correta);
  }
  Object.assign(s, { estado: "finalizado", resultado, tempo_gasto_seg: tempo, finalizado_em: agora });
  salvarStore();
  return resultado;
});

rota("DELETE", /^\/api\/simulados\/(\d+)$/, ([id]) => {
  const alvo = simPorId(Number(id));
  if (alvo) WEB.store.removidos.simulados[chaveSimulado(alvo)] = agoraIso();
  WEB.store.simulados = WEB.store.simulados.filter(s => s.id !== Number(id));
  salvarStore();
  return { ok: true };
});

// ---- desempenho
rota("GET", /^\/api\/desempenho\/resumo$/, () => {
  const rs = respostasValidas();
  const pct = (c, t) => (t ? Math.round((1000 * c) / t) / 10 : null);
  const datas = rs.map(r => r.respondida_em).sort();
  const certas = rs.filter(r => r.correta === 1).length, erradas = rs.filter(r => r.correta === 0).length;
  const geral = { respostas: rs.length, certas, erradas, questoes: new Set(rs.map(r => r.hash)).size,
    dias: new Set(rs.map(r => r.respondida_em.slice(0, 10))).size, primeira: datas[0] || null, ultima: datas.at(-1) || null,
    total_banco: WEB.dados.questoes.length, percentual: pct(certas, certas + erradas) };
  const totalDisc = {}, totalAss = {};
  for (const q of WEB.dados.questoes) {
    const d = q.disciplina || "Sem disciplina", a = q.assunto || "Sem assunto";
    totalDisc[d] = (totalDisc[d] || 0) + 1;
    totalAss[d + "|" + a] = (totalAss[d + "|" + a] || 0) + 1;
  }
  const discs = {}, serie = {};
  for (const r of rs) {
    const q = WEB.porHash.get(r.hash);
    const d = q.disciplina || "Sem disciplina", a = q.assunto || "Sem assunto";
    const disc = discs[d] ??= { disciplina: d, respostas: 0, certas: 0, erradas: 0, questoes: new Set(), assuntos: {}, total_banco: totalDisc[d] || 0 };
    const ass = disc.assuntos[a] ??= { disciplina: d, assunto: a, respostas: 0, certas: 0, erradas: 0, questoes: new Set(), total_banco: totalAss[d + "|" + a] || 0 };
    for (const x of [disc, ass]) { x.respostas++; x.certas += r.correta === 1; x.erradas += r.correta === 0; x.questoes.add(r.hash); }
    const s = serie[r.respondida_em.slice(0, 10) + "|" + d] ??= { dia: r.respondida_em.slice(0, 10), disciplina: d, respostas: 0, certas: 0, erradas: 0 };
    s.respostas++; s.certas += r.correta === 1; s.erradas += r.correta === 0;
  }
  const disciplinas = Object.values(discs).map(d => ({ ...d, questoes: d.questoes.size, percentual: pct(d.certas, d.certas + d.erradas),
    assuntos: Object.values(d.assuntos).map(a => ({ ...a, questoes: a.questoes.size, percentual: pct(a.certas, a.certas + a.erradas) }))
      .sort(comparar(a => a.percentual ?? 101, a => -a.respostas)) })).sort((a, b) => b.respostas - a.respostas);
  return { geral, disciplinas, serie: Object.values(serie).sort((a, b) => (a.dia < b.dia ? -1 : 1)), caderno: contagemCaderno() };
});

rota("GET", /^\/api\/desempenho\/historico$/, (_, args) => {
  let rs = respostasValidas().map(r => ({ r, q: WEB.porHash.get(r.hash) }));
  if (args.get("disciplina")) rs = rs.filter(x => x.q.disciplina === args.get("disciplina"));
  if (args.get("resultado") === "certa") rs = rs.filter(x => x.r.correta === 1);
  if (args.get("resultado") === "errada") rs = rs.filter(x => x.r.correta === 0);
  if (["estudo", "simulado"].includes(args.get("modo"))) rs = rs.filter(x => x.r.modo === args.get("modo"));
  rs.sort((a, b) => (a.r.respondida_em < b.r.respondida_em ? 1 : a.r.respondida_em > b.r.respondida_em ? -1 : b.r.id - a.r.id));
  const pagina = Math.max(Number(args.get("pagina") || 1), 1);
  return { total: rs.length, pagina, por_pagina: 50, itens: rs.slice((pagina - 1) * 50, pagina * 50).map(({ r, q }) => ({
    id: r.id, questao_id: q.id, resposta: r.resposta, correta: r.correta, modo: r.modo, simulado_id: r.simulado_id,
    tempo_seg: r.tempo_seg, respondida_em: r.respondida_em, gabarito: q.gabarito, tipo: q.tipo, disciplina: q.disciplina,
    assunto: q.assunto, orgao: q.orgao, cargo: q.cargo, numero: q.numero, resumo: q.enunciado.slice(0, 160) })) };
});

// ---- caderno
function itensCaderno() {
  return Object.entries(WEB.store.revisao).filter(([h]) => WEB.porHash.has(h)).map(([h, rv]) => {
    const q = WEB.porHash.get(h);
    return { ...rv, questao_id: q.id, disciplina: q.disciplina, assunto: q.assunto, orgao: q.orgao, cargo: q.cargo,
      numero: q.numero, tipo: q.tipo, resumo: q.enunciado.slice(0, 180) };
  });
}
rota("GET", /^\/api\/caderno$/, (_, args) => {
  const hoje = hojeIso(), mostrar = args.get("mostrar") || "pendentes";
  let itens = itensCaderno();
  if (mostrar === "hoje") itens = itens.filter(i => !i.dominada && i.proxima_em <= hoje);
  else if (mostrar === "pendentes") itens = itens.filter(i => !i.dominada);
  else if (mostrar === "dominadas") itens = itens.filter(i => i.dominada);
  const todas = itensCaderno();
  if (args.get("disciplina")) itens = itens.filter(i => i.disciplina === args.get("disciplina"));
  itens.sort(comparar(i => i.dominada, i => i.proxima_em, i => -i.erros));
  return { itens, contagem: contagemCaderno(), hoje, intervalos: INTERVALOS_REVISAO,
    disciplinas: [...new Set(todas.map(i => i.disciplina).filter(Boolean))].sort() };
});
rota("GET", /^\/api\/caderno\/ids$/, (_, args) => {
  const hoje = hojeIso();
  const ids = itensCaderno().filter(i => !i.dominada && i.proxima_em <= hoje && (!args.get("disciplina") || i.disciplina === args.get("disciplina")))
    .sort(comparar(i => i.proxima_em, i => -i.erros)).map(i => i.questao_id);
  return { ids };
});
rota("DELETE", /^\/api\/caderno\/(\d+)$/, ([id]) => {
  const q = WEB.porId.get(Number(id));
  if (q) { delete WEB.store.revisao[q.hash]; WEB.store.removidos.revisao[q.hash] = agoraIso(); salvarStore(); }
  return { ok: true };
});

// ------------------------------------------------------------------ troca do fetch
const fetchOriginal = window.fetch.bind(window);
window.fetch = async (entrada, opcoes = {}) => {
  const url = new URL(typeof entrada === "string" ? entrada : entrada.url, location.href);
  const caminho = url.pathname.replace(/^.*?(\/api\/)/, "/api/");
  if (!caminho.startsWith("/api/")) return fetchOriginal(entrada, opcoes);
  await carregando;
  const metodo = (opcoes.method || "GET").toUpperCase();
  let corpo = {};
  if (typeof opcoes.body === "string") { try { corpo = JSON.parse(opcoes.body); } catch (e) {} }
  const responder = (status, dados) => new Response(JSON.stringify(dados), { status, headers: { "Content-Type": "application/json" } });
  for (const [m, re, fn] of ROTAS_WEB) {
    const achou = caminho.match(re);
    if (achou && (m === metodo || (m === "PUT" && metodo === "POST" && /\/tempo$/.test(caminho)))) {
      try { return responder(200, fn(achou.slice(1), url.searchParams, corpo)); }
      catch (e) {
        if (e instanceof ErroApi) return responder(e.status, { erros: e.erros });
        console.error(e);
        return responder(500, { erros: ["Erro inesperado: " + e.message] });
      }
    }
  }
  return responder(404, { erros: ["Esta função só existe na versão do notebook."] });
};

// ------------------------------------------------------------------ progresso: exportar / importar / mesclar
function progressoParaArquivo() {
  const s = WEB.store;
  return {
    app: "Larigou Questões", tipo: "progresso", versao: 1, gerado_em: agoraIso(), origem: "web",
    respostas: s.respostas.map(({ id, ...r }) => r),
    usuario: Object.entries(s.usuario).map(([hash, u]) => ({ hash, ...u })),
    revisao: Object.entries(s.revisao).map(([hash, r]) => ({ hash, ...r })),
    simulados: s.simulados.map(({ id, ...sim }) => sim),
    removidos: s.removidos,
  };
}

const chaveSimulado = x => x.criado_em + "|" + x.titulo;

/** Junta um progresso vindo de outro aparelho com o deste, sem duplicar nada. */
function mesclarProgresso(p) {
  if (p?.app !== "Larigou Questões" || p.tipo !== "progresso") throw new Error("Este arquivo não é um progresso do Larigou Questões.");
  const s = WEB.store;
  const cont = { respostas: 0, anotacoes: 0, caderno: 0, simulados: 0 };
  const chave = r => [r.hash, r.respondida_em, r.resposta, r.modo].join("|");
  const existentes = new Set(s.respostas.map(chave));
  for (const r of p.respostas || []) {
    if (existentes.has(chave(r))) continue;
    s.respostas.push({ ...r, id: ++s.seq.resposta, simulado_id: null });
    existentes.add(chave(r));
    cont.respostas++;
  }
  for (const u of p.usuario || []) {
    const atual = s.usuario[u.hash];
    if (!atual || (u.atualizado_em || "") > (atual.atualizado_em || "")) {
      const { hash, ...resto } = u;
      s.usuario[hash] = { favorita: resto.favorita ? 1 : 0, anotacao: resto.anotacao || "", riscadas: resto.riscadas || [], atualizado_em: resto.atualizado_em };
      cont.anotacoes++;
    }
  }
  for (const r of p.revisao || []) {
    const atual = s.revisao[r.hash];
    if (!atual || (r.ultima_em || r.entrou_em || "") > (atual.ultima_em || atual.entrou_em || "")) {
      const { hash, ...resto } = r;
      s.revisao[hash] = resto;
      cont.caderno++;
    }
  }
  // remoções feitas em outro aparelho (tirar do caderno, excluir simulado)
  for (const tipo of ["revisao", "simulados"])
    for (const [k, quando] of Object.entries(p.removidos?.[tipo] || {}))
      if (!s.removidos[tipo][k] || quando > s.removidos[tipo][k]) s.removidos[tipo][k] = quando;
  for (const [hash, quando] of Object.entries(s.removidos.revisao)) {
    const r = s.revisao[hash];
    if (r && (r.ultima_em || r.entrou_em || "") <= quando) delete s.revisao[hash];
  }
  s.simulados = s.simulados.filter(x => !s.removidos.simulados[chaveSimulado(x)]);
  const simExist = new Set(s.simulados.map(chaveSimulado));
  for (const sim of p.simulados || []) {
    if (simExist.has(chaveSimulado(sim)) || s.removidos.simulados[chaveSimulado(sim)]) continue;
    s.simulados.push({ ...sim, id: ++s.seq.simulado });
    cont.simulados++;
  }
  salvarStore();
  return cont;
}

function baixarArquivo(nome, texto) {
  const url = URL.createObjectURL(new Blob([texto], { type: "application/json" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: nome });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ------------------------------------------------------------------ tela "Meu progresso" (substitui Backup na web)
async function telaBackupWeb() {
  saindo = null;
  await carregando;
  const s = WEB.store;
  main.innerHTML = `
    <div style="max-width:860px;margin:0 auto">
      <h1>Meu progresso</h1>
      <section class="painel">
        <p>Nesta versão da internet, suas respostas, anotações, favoritas, simulados e caderno de erros ficam guardados
          <strong>neste aparelho</strong>, no navegador. Se você entrar na sua conta, eles também ficam guardados na nuvem,
          protegidos pela sua senha. Ninguém mais vê.</p>
        <p class="dica">Guardado aqui: ${s.respostas.length} respostas, ${Object.keys(s.usuario).length} questões com anotação/favorita,
          ${s.simulados.length} simulados, ${Object.keys(s.revisao).length} questões no caderno de erros.
          Questões publicadas em ${new Date(WEB.dados.gerado_em).toLocaleDateString("pt-BR")}: ${WEB.dados.questoes.length}.</p>
      </section>
      ${typeof htmlContaNuvem === "function" ? htmlContaNuvem() : ""}
      <section class="painel" style="margin-top:16px">
        <h2>Levar para outro aparelho sem conta</h2>
        <ol class="passos">
          <li>Aqui, toque em <strong>Exportar meu progresso</strong>. Um arquivo <code>.json</code> é baixado.</li>
          <li>No outro aparelho (celular, outro navegador ou o app do notebook), abra a tela de backup e use
            <strong>Importar progresso</strong> com esse arquivo.</li>
        </ol>
        <p class="dica">Importar <strong>junta</strong> os progressos, sem apagar nem duplicar nada.</p>
        <div class="linha-atalhos">
          <button class="botao primario" type="button" id="exportar-prog">Exportar meu progresso</button>
          <label class="botao" style="cursor:pointer">Importar progresso
            <input type="file" id="importar-prog" accept=".json,application/json" hidden></label>
        </div>
      </section>
      <section class="painel" style="margin-top:16px">
        <h2>Para não perder nada</h2>
        <ul class="passos">
          <li>No celular, use <strong>Adicionar à tela inicial</strong>. Assim o navegador guarda seus dados por mais tempo
            (o Safari do iPhone pode apagar dados de sites que você não abre há semanas).</li>
          <li>Não use aba anônima: ela apaga tudo ao fechar.</li>
          <li>De vez em quando, exporte seu progresso e guarde o arquivo.</li>
        </ul>
        <button class="botao perigo pequeno" type="button" id="apagar-prog">Apagar o progresso deste aparelho</button>
      </section>
    </div>`;
  if (typeof ligarContaNuvem === "function") ligarContaNuvem(telaBackupWeb);
  $("#exportar-prog").onclick = () => {
    const d = new Date();
    baixarArquivo(`larigou-progresso-${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}-${dois(d.getHours())}${dois(d.getMinutes())}.json`,
      JSON.stringify(progressoParaArquivo()));
    avisar("Progresso exportado");
  };
  $("#importar-prog").onchange = async e => {
    const arq = e.target.files[0];
    if (!arq) return;
    try {
      const c = mesclarProgresso(JSON.parse(await arq.text()));
      avisar(`Importado: ${c.respostas} respostas, ${c.simulados} simulados`);
      await carregarMeta(true);
      telaBackupWeb();
    } catch (err) { avisar(err.message.includes("JSON") ? "O arquivo não é um JSON válido." : err.message, "erro"); }
  };
  $("#apagar-prog").onclick = () => {
    const logada = typeof NUVEM !== "undefined" && NUVEM.sessao;
    if (!confirm(logada ? "Apagar o progresso deste aparelho? Como você está conectada, ele volta da nuvem na próxima sincronização. Para apagar de vez, saia da conta antes."
      : "Apagar TODO o seu progresso deste aparelho? Exporte antes se quiser guardar.")) return;
    WEB.store = storeVazio();
    salvarStore();
    try { localStorage.removeItem("larigou.sessao"); } catch (e) {}
    avisar("Progresso apagado");
    telaBackupWeb();
  };
}

// ------------------------------------------------------------------ ajustes de navegação da versão web
(function ajustarMenu() {
  const banco = document.querySelector('.menu a[data-rota="banco"]');
  if (banco) {
    // o contador fica no lugar; troca só o ícone e os rótulos
    banco.href = "#/backup";
    banco.querySelector(".icone").innerHTML = `<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>`;
    banco.querySelector(".longo").textContent = "Meu progresso";
    banco.querySelector(".curto").textContent = "Progresso";
  }
  const conta = document.getElementById("atalho-conta");
  if (conta) {
    conta.href = "#/backup";
    conta.setAttribute("aria-label", "Meu progresso"); conta.title = "Meu progresso";
    conta.querySelector("svg").innerHTML = `<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>`;
  }
  const tema = document.getElementById("atalho-conta") || document.getElementById("botao-tema");
  if (tema) tema.insertAdjacentHTML("beforebegin", `<a class="indicador-nuvem" id="indicador-nuvem" href="#/backup" hidden></a>`);
})();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
