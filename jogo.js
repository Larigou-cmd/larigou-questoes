// Larigou Questões: XP, nível e sequência de dias.
// Tudo sai do histórico de respostas, então vale para o que já foi respondido e sincroniza junto com o progresso.
// As regras ficam só aqui; o servidor (notebook) e o modo-web só entregam a lista de respostas.

const XP_CERTA = 10;
const XP_ERRADA = 2;
const TITULOS = [[1, "Iniciante"], [3, "Aprendiz"], [5, "Em treinamento"], [8, "Foco total"],
  [12, "Alta performance"], [16, "Elite"], [20, "Lenda"]];
const DIAS_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

/** XP necessário para sair do nível n para o n + 1 (100, 150, 200...). */
const xpParaSubir = n => 100 + 50 * (n - 1);

function diaLocal(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function somarDias(dia, n) {
  const [a, m, d] = dia.split("-").map(Number);
  return diaLocal(new Date(a, m - 1, d + n));
}

/** registros: [chave da questão, "AAAA-MM-DD", correta (1/0/null)] */
function calcularJogo(registros, hoje = diaLocal()) {
  // por questão e por dia vale o melhor resultado: repetir a mesma questão no mesmo dia não soma XP
  const melhor = new Map();
  const dias = new Set();
  for (const [q, dia, correta] of registros) {
    if (correta !== 0 && correta !== 1) continue;
    dias.add(dia);
    const k = q + "|" + dia;
    melhor.set(k, Math.max(melhor.get(k) || 0, correta ? XP_CERTA : XP_ERRADA));
  }
  let xp = 0, xpHoje = 0;
  for (const [k, v] of melhor) { xp += v; if (k.endsWith("|" + hoje)) xpHoje += v; }

  let nivel = 1, base = 0;
  while (xp >= base + xpParaSubir(nivel)) { base += xpParaSubir(nivel); nivel++; }
  const titulo = TITULOS.filter(([n]) => n <= nivel).at(-1)[1];

  // a sequência continua viva até o fim do dia seguinte ao último estudo
  const estudouHoje = dias.has(hoje);
  let sequencia = 0;
  for (let d = estudouHoje ? hoje : somarDias(hoje, -1); dias.has(d); d = somarDias(d, -1)) sequencia++;
  let melhorSeq = 0, corrida = 0, anterior = null;
  for (const d of [...dias].sort()) {
    corrida = anterior && somarDias(anterior, 1) === d ? corrida + 1 : 1;
    melhorSeq = Math.max(melhorSeq, corrida);
    anterior = d;
  }
  const semana = [];
  for (let i = 6; i >= 0; i--) {
    const d = somarDias(hoje, -i);
    const [a, m, dd] = d.split("-").map(Number);
    semana.push({ dia: d, rotulo: DIAS_SEMANA[new Date(a, m - 1, dd).getDay()], feito: dias.has(d), hoje: i === 0 });
  }
  return { xp, xpHoje, nivel, titulo, xpNoNivel: xp - base, xpDoNivel: xpParaSubir(nivel),
    sequencia, melhorSequencia: melhorSeq, estudouHoje, semana };
}

// ------------------------------------------------------------------ estado e cabeçalho
let JOGO = null;

/** Recalcula e atualiza o cabeçalho. Devolve o que mudou desde a última vez ({xp, subiuNivel, comecouHoje}). */
async function atualizarJogo() {
  let r;
  try { r = await api("/api/jogo/respostas"); } catch (e) { return null; }
  const antes = JOGO;
  JOGO = calcularJogo(r.registros || []);
  desenharHudJogo();
  if (!antes) return null;
  const mudou = { xp: JOGO.xp - antes.xp, subiuNivel: JOGO.nivel > antes.nivel, comecouHoje: JOGO.estudouHoje && !antes.estudouHoje };
  if (mudou.subiuNivel) avisar(`Nível ${JOGO.nivel} alcançado: ${JOGO.titulo}!`);
  else if (mudou.comecouHoje && JOGO.sequencia > 1) avisar(`Sequência mantida: ${JOGO.sequencia} dias seguidos`);
  return mudou;
}

const ICONE_CHAMA = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5c.6 3.2 4.8 5.6 4.8 10.4a4.8 4.8 0 0 1-9.6 0c0-2.2 1-3.6 2.2-4.8.2 1.6.9 2.6 2 3.1-.6-3 .1-5.9.6-8.7z"/></svg>`;

function desenharHudJogo() {
  const el = document.getElementById("hud-jogo");
  if (!el || !JOGO) return;
  const j = JOGO;
  el.hidden = false;
  el.title = `Nível ${j.nivel} (${j.titulo}), ${j.xp} XP. Sequência: ${j.sequencia} ${j.sequencia === 1 ? "dia" : "dias"}.`;
  el.setAttribute("aria-label", el.title);
  el.innerHTML = `<span class="hud-nivel">${j.nivel}</span>
    <span class="hud-xp"><span class="hud-xp-cheio" style="width:${Math.round((j.xpNoNivel / j.xpDoNivel) * 100)}%"></span></span>
    <span class="hud-seq ${j.estudouHoje ? "acesa" : ""}">${ICONE_CHAMA}${j.sequencia}</span>`;
}

/** Painéis de nível e sequência da tela Início. */
function htmlPainelJogo() {
  if (!JOGO) return "";
  const j = JOGO;
  const falta = j.xpDoNivel - j.xpNoNivel;
  const recado = !j.sequencia ? "Resolva uma questão hoje para começar sua sequência."
    : j.estudouHoje ? `Você já estudou hoje. Melhor sequência: ${j.melhorSequencia} ${j.melhorSequencia === 1 ? "dia" : "dias"}.`
    : "Resolva pelo menos uma questão hoje para não perder a sequência.";
  return `
    <div class="grade-2 jogo-inicio">
      <section class="painel cartao-nivel" aria-label="Nível e XP">
        <div class="hex-nivel" aria-hidden="true">${j.nivel}</div>
        <div class="nivel-info">
          <h2>Nível ${j.nivel}: ${esc(j.titulo)}</h2>
          <p class="dica">Faltam ${falta} XP para o nível ${j.nivel + 1}${j.xpHoje ? `. Hoje: +${j.xpHoje} XP` : ""}</p>
          <div class="trilho-xp" role="progressbar" aria-valuemin="0" aria-valuemax="${j.xpDoNivel}" aria-valuenow="${j.xpNoNivel}"
            aria-label="XP no nível atual"><span style="width:${(j.xpNoNivel / j.xpDoNivel) * 100}%"></span></div>
          <div class="numeros-xp"><span>${j.xpNoNivel} / ${j.xpDoNivel} XP</span><span>Total: ${j.xp} XP</span></div>
          <p class="dica regra-xp">Questão certa: +${XP_CERTA} XP. Errada: +${XP_ERRADA} XP. Cada questão conta uma vez por dia.</p>
        </div>
      </section>
      <section class="painel cartao-sequencia" aria-label="Sequência de dias">
        <div class="sequencia-topo"><strong class="${j.estudouHoje ? "acesa" : ""}">${j.sequencia}</strong>
          <span>${j.sequencia === 1 ? "dia seguido" : "dias seguidos"}</span></div>
        <ol class="semana-jogo">${j.semana.map(d => `
          <li class="${d.feito ? "feito" : ""} ${d.hoje ? "hoje" : ""}"><i aria-hidden="true"></i>${d.rotulo}
            <span class="sr">${d.feito ? "estudou" : "não estudou"}</span></li>`).join("")}</ol>
        <p class="dica">${recado}</p>
      </section>
    </div>`;
}
