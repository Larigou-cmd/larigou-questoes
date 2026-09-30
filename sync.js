"use strict";
/* Larigou Questões — sincronização do progresso com o Supabase (só na versão web).
   Guarda o progresso inteiro (o mesmo JSON do "Exportar progresso") numa linha da tabela
   public.progresso, uma por usuária, protegida por login. Sincronizar = baixar, juntar, enviar. */

const NUVEM = {
  url: "https://lfxlyobcfxcoffhjjpyt.supabase.co",
  chave: "sb_publishable_fcmgUtR-qv5hSCsH8FN1qg_Pf9E6NaU", // chave pública (feita para ficar no site)
  chaveSessao: "larigou.nuvem.sessao",
  sessao: null,
  estado: "desconectado",   // desconectado | sincronizando | ok | erro
  ultimaSinc: null,
  erro: "",
  timer: null,
  aplicandoRemoto: false,
};

function lerSessaoNuvem() {
  try { return JSON.parse(localStorage.getItem(NUVEM.chaveSessao)); } catch (e) { return null; }
}
function gravarSessaoNuvem(s) {
  NUVEM.sessao = s;
  try { s ? localStorage.setItem(NUVEM.chaveSessao, JSON.stringify(s)) : localStorage.removeItem(NUVEM.chaveSessao); } catch (e) {}
}

function sessaoDeResposta(j) {
  return { access_token: j.access_token, refresh_token: j.refresh_token,
    expires_at: j.expires_at || Math.floor(Date.now() / 1000) + (j.expires_in || 3600),
    user: { id: j.user?.id, email: j.user?.email } };
}

async function chamarAuth(caminho, corpo, token) {
  const r = await fetch(`${NUVEM.url}/auth/v1/${caminho}`, {
    method: "POST",
    headers: { apikey: NUVEM.chave, "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(corpo || {}),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(traduzirErroAuth(j.error_code || j.code, j.msg || j.error_description || j.message || ""));
  return j;
}

function traduzirErroAuth(codigo, msg) {
  const m = String(codigo || "") + " " + msg;
  if (/invalid_credentials|Invalid login/i.test(m)) return "E-mail ou senha incorretos.";
  if (/email_not_confirmed|not confirmed/i.test(m)) return "Confirme seu e-mail primeiro: abra o link que o Supabase enviou para sua caixa de entrada.";
  if (/user_already_exists|already registered/i.test(m)) return "Já existe uma conta com esse e-mail. Use Entrar.";
  if (/weak_password|at least/i.test(m)) return "A senha precisa ter pelo menos 6 caracteres.";
  if (/signup_disabled|Signups not allowed/i.test(m)) return "Novas contas estão desativadas neste projeto.";
  if (/rate|too many/i.test(m)) return "Muitas tentativas seguidas. Espere um pouco e tente de novo.";
  return msg || "Não foi possível falar com o servidor. Confira a internet.";
}

async function tokenValido() {
  const s = NUVEM.sessao;
  if (!s) return null;
  if (s.expires_at - 60 > Date.now() / 1000) return s.access_token;
  try {
    const j = await chamarAuth("token?grant_type=refresh_token", { refresh_token: s.refresh_token });
    gravarSessaoNuvem(sessaoDeResposta(j));
    return NUVEM.sessao.access_token;
  } catch (e) {
    if (navigator.onLine) { gravarSessaoNuvem(null); NUVEM.estado = "desconectado"; }
    return null;
  }
}

async function rest(metodo, caminho, corpo, extras = {}) {
  const token = await tokenValido();
  if (!token) throw new Error("Sessão expirada. Entre de novo.");
  const r = await fetch(`${NUVEM.url}/rest/v1/${caminho}`, {
    method: metodo,
    headers: { apikey: NUVEM.chave, Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...extras.headers },
    body: corpo ? JSON.stringify(corpo) : undefined,
    keepalive: !!extras.keepalive,
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    if (/relation .*progresso.* does not exist|PGRST205/i.test((j.message || "") + (j.code || "")))
      throw new Error("A tabela 'progresso' ainda não foi criada no Supabase (falta rodar o SQL de configuração).");
    throw new Error(j.message || `Erro ${r.status} ao sincronizar.`);
  }
  return r.status === 204 ? null : r.json().catch(() => null);
}

function atualizarIndicador() {
  const el = document.getElementById("indicador-nuvem");
  if (!el) return;
  const textos = { desconectado: "", sincronizando: "Sincronizando…", ok: "Sincronizado", erro: "Sem sincronizar" };
  el.textContent = textos[NUVEM.estado];
  el.dataset.estado = NUVEM.estado;
  el.hidden = !textos[NUVEM.estado];
  el.title = NUVEM.estado === "erro" ? NUVEM.erro : NUVEM.ultimaSinc ? `Última sincronização: ${NUVEM.ultimaSinc.toLocaleString("pt-BR")}` : "";
  window.aoMudarNuvem?.();
}

/** Baixa o progresso da nuvem, junta com o deste aparelho e envia o resultado. */
async function sincronizar() {
  if (!NUVEM.sessao) return;
  if (!navigator.onLine) { NUVEM.estado = "erro"; NUVEM.erro = "Sem internet: o progresso fica salvo aqui e sincroniza depois."; atualizarIndicador(); return; }
  NUVEM.estado = "sincronizando"; atualizarIndicador();
  try {
    await carregando;
    const linhas = await rest("GET", `progresso?select=dados,atualizado_em&user_id=eq.${NUVEM.sessao.user.id}`);
    if (linhas?.length && linhas[0].dados?.tipo === "progresso") {
      NUVEM.aplicandoRemoto = true;
      try { mesclarProgresso(linhas[0].dados); } finally { NUVEM.aplicandoRemoto = false; }
    }
    await enviarProgresso();
    NUVEM.estado = "ok"; NUVEM.ultimaSinc = new Date(); NUVEM.erro = "";
  } catch (e) {
    NUVEM.estado = "erro"; NUVEM.erro = e.message;
  }
  atualizarIndicador();
}

async function enviarProgresso(keepalive = false) {
  await rest("POST", "progresso?on_conflict=user_id", { user_id: NUVEM.sessao.user.id, dados: progressoParaArquivo(),
    atualizado_em: new Date().toISOString() },
    { headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, keepalive });
}

// cada alteração local agenda um envio (juntando antes, para não sobrescrever outro aparelho)
window.aoSalvarProgresso = () => {
  if (!NUVEM.sessao || NUVEM.aplicandoRemoto) return;
  clearTimeout(NUVEM.timer);
  NUVEM.timer = setTimeout(sincronizar, 2500);
};

document.addEventListener("visibilitychange", () => {
  if (!NUVEM.sessao) return;
  if (document.hidden) {
    if (NUVEM.timer) { clearTimeout(NUVEM.timer); NUVEM.timer = null; enviarProgresso(true).catch(() => {}); }
  } else sincronizar(); // voltou para o app: busca o que foi feito em outro aparelho
});
window.addEventListener("online", () => NUVEM.sessao && sincronizar());

// links de confirmação de e-mail / troca de senha voltam com #access_token=... na URL
(function lerRetornoDoEmail() {
  if (!/access_token=/.test(location.hash)) return;
  const p = new URLSearchParams(location.hash.slice(1));
  gravarSessaoNuvem({ access_token: p.get("access_token"), refresh_token: p.get("refresh_token"),
    expires_at: Number(p.get("expires_at")) || Math.floor(Date.now() / 1000) + Number(p.get("expires_in") || 3600), user: {} });
  NUVEM.retornoTipo = p.get("type");
  history.replaceState(null, "", location.pathname + "#/backup");
})();

async function completarUsuario() {
  if (!NUVEM.sessao || NUVEM.sessao.user?.id) return;
  const token = await tokenValido();
  const r = await fetch(`${NUVEM.url}/auth/v1/user`, { headers: { apikey: NUVEM.chave, Authorization: `Bearer ${token}` } });
  if (r.ok) { const u = await r.json(); gravarSessaoNuvem({ ...NUVEM.sessao, user: { id: u.id, email: u.email } }); }
}

NUVEM.sessao = lerSessaoNuvem();
carregando.then(async () => {
  await completarUsuario().catch(() => {});
  if (NUVEM.sessao) sincronizar();
});

// ------------------------------------------------------------------ ações da tela
async function entrarNuvem(email, senha) {
  gravarSessaoNuvem(sessaoDeResposta(await chamarAuth("token?grant_type=password", { email, password: senha })));
  await sincronizar();
}
async function criarContaNuvem(email, senha) {
  const j = await chamarAuth("signup", { email, password: senha });
  if (j.access_token) { gravarSessaoNuvem(sessaoDeResposta(j)); await sincronizar(); return "logada"; }
  return "confirmar"; // o Supabase mandou um e-mail de confirmação
}
async function esqueciSenhaNuvem(email) {
  await chamarAuth(`recover?redirect_to=${encodeURIComponent(location.origin + location.pathname)}`, { email });
}
async function trocarSenhaNuvem(senha) {
  const token = await tokenValido();
  const r = await fetch(`${NUVEM.url}/auth/v1/user`, { method: "PUT",
    headers: { apikey: NUVEM.chave, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ password: senha }) });
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(traduzirErroAuth(j.error_code, j.msg || j.message)); }
}
async function sairNuvem() {
  if (NUVEM.timer) { clearTimeout(NUVEM.timer); await enviarProgresso().catch(() => {}); }
  const token = NUVEM.sessao?.access_token;
  gravarSessaoNuvem(null);
  NUVEM.estado = "desconectado";
  atualizarIndicador();
  if (token) fetch(`${NUVEM.url}/auth/v1/logout`, { method: "POST", headers: { apikey: NUVEM.chave, Authorization: `Bearer ${token}` } }).catch(() => {});
}

/** Bloco "Sincronizar entre aparelhos" dentro da tela Meu progresso. */
function htmlContaNuvem() {
  const s = NUVEM.sessao;
  if (s && NUVEM.retornoTipo === "recovery") return `
    <section class="painel conta-nuvem" style="margin-top:16px">
      <h2>Criar uma senha nova</h2>
      <form id="form-nova-senha" class="form-nuvem">
        <label class="campo"><span>Nova senha</span><input class="entrada" type="password" name="senha" minlength="6" autocomplete="new-password" required></label>
        <button class="botao primario" type="submit">Salvar nova senha</button>
      </form></section>`;
  if (s) return `
    <section class="painel conta-nuvem" style="margin-top:16px">
      <h2>Sincronizar entre aparelhos</h2>
      <p>Conectada como <strong>${esc(s.user?.email || "")}</strong>. Seu progresso é enviado sozinho a cada resposta e
        atualizado ao abrir o app em outro aparelho.</p>
      <p class="dica" id="status-nuvem"></p>
      <div class="linha-atalhos">
        <button class="botao primario" type="button" id="sinc-agora">Sincronizar agora</button>
        <button class="botao" type="button" id="sair-nuvem">Sair da conta</button>
      </div></section>`;
  return `
    <section class="painel conta-nuvem" style="margin-top:16px">
      <h2>Sincronizar entre aparelhos</h2>
      <p>Entre com seu e-mail para o progresso ficar igual no celular, no notebook e em qualquer navegador.
        O que já está salvo neste aparelho é juntado ao da sua conta, sem perder nada.</p>
      <form id="form-nuvem" class="form-nuvem">
        <label class="campo"><span>E-mail</span><input class="entrada" type="email" name="email" autocomplete="email" required></label>
        <label class="campo"><span>Senha</span><input class="entrada" type="password" name="senha" minlength="6" autocomplete="current-password" required></label>
        <div class="linha-atalhos">
          <button class="botao primario" type="submit" data-acao="entrar">Entrar</button>
          <button class="botao" type="submit" data-acao="criar">Criar conta</button>
          <button class="botao-texto" type="button" id="esqueci">Esqueci a senha</button>
        </div>
      </form></section>`;
}

function ligarContaNuvem(redesenhar) {
  const status = () => {
    const el = $("#status-nuvem");
    if (!el) return;
    el.textContent = NUVEM.estado === "sincronizando" ? "Sincronizando…"
      : NUVEM.estado === "erro" ? `Não sincronizou: ${NUVEM.erro}`
      : NUVEM.ultimaSinc ? `Última sincronização: ${NUVEM.ultimaSinc.toLocaleString("pt-BR")}` : "";
  };
  window.aoMudarNuvem = status;
  status();
  const form = $("#form-nuvem");
  if (form) {
    let acao = "entrar";
    $$("[data-acao]", form).forEach(b => b.onclick = () => { acao = b.dataset.acao; });
    form.onsubmit = async e => {
      e.preventDefault();
      const email = form.email.value.trim(), senha = form.senha.value;
      const botoes = $$("button", form);
      botoes.forEach(b => b.disabled = true);
      try {
        if (acao === "criar") {
          const r = await criarContaNuvem(email, senha);
          if (r === "confirmar") { avisar("Conta criada! Abra o link enviado para o seu e-mail para confirmar."); return; }
          avisar("Conta criada e progresso sincronizado");
        } else {
          await entrarNuvem(email, senha);
          avisar(NUVEM.estado === "erro" ? NUVEM.erro : "Conectada! Progresso sincronizado", NUVEM.estado === "erro" ? "erro" : "");
        }
        await carregarMeta(true);
        redesenhar();
      } catch (err) { avisar(err.message, "erro"); }
      finally { botoes.forEach(b => b.disabled = false); }
    };
    $("#esqueci").onclick = async () => {
      const email = form.email.value.trim();
      if (!email) return avisar("Escreva seu e-mail primeiro.");
      try { await esqueciSenhaNuvem(email); avisar("Enviamos um link para criar uma senha nova."); }
      catch (err) { avisar(err.message, "erro"); }
    };
  }
  const formSenha = $("#form-nova-senha");
  if (formSenha) formSenha.onsubmit = async e => {
    e.preventDefault();
    try { await trocarSenhaNuvem(formSenha.senha.value); NUVEM.retornoTipo = null; avisar("Senha alterada"); await sincronizar(); redesenhar(); }
    catch (err) { avisar(err.message, "erro"); }
  };
  if ($("#sinc-agora")) $("#sinc-agora").onclick = async () => { await sincronizar(); await carregarMeta(true); redesenhar(); };
  if ($("#sair-nuvem")) $("#sair-nuvem").onclick = async () => {
    if (!confirm("Sair da conta? O progresso continua salvo neste aparelho e na nuvem.")) return;
    await sairNuvem(); redesenhar();
  };
}
