"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Button, Field, Input } from "@/components/ui";

export default function Login() {
  const r = useRouter();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [busy, setBusy] = useState(false);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErro("");
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      setBusy(false);
      return setErro("Variáveis NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY não configuradas neste deploy. Cadastre na Vercel e faça Redeploy.");
    }
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: senha });
    setBusy(false);
    if (!error) return r.replace("/");
    const msg = error.message || "";
    if (/email not confirmed/i.test(msg)) setErro("E-mail ainda não confirmado. No Supabase: Authentication → Users → abra o usuário → Confirm email.");
    else if (/invalid login credentials/i.test(msg)) setErro("E-mail ou senha incorretos (ou o usuário não existe neste projeto Supabase).");
    else if (/invalid api key|apikey/i.test(msg)) setErro("Chave do Supabase inválida. Confira a NEXT_PUBLIC_SUPABASE_ANON_KEY na Vercel e faça Redeploy.");
    else if (/fetch/i.test(msg)) setErro("Não consegui falar com o Supabase. Confira a NEXT_PUBLIC_SUPABASE_URL na Vercel e faça Redeploy.");
    else setErro(msg);
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={entrar} className="w-full max-w-sm space-y-4 rounded-2xl border border-zinc-200 bg-white p-6">
        <div>
          <div className="text-2xl font-semibold">Gestão Loja 3D</div>
          <p className="text-sm text-zinc-500">Entre com o usuário criado no Supabase.</p>
        </div>
        <Field label="E-mail"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
        <Field label="Senha"><Input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} required /></Field>
        {erro && <p className="text-sm text-rose-600">{erro}</p>}
        <Button className="w-full" disabled={busy}>{busy ? "Entrando…" : "Entrar"}</Button>
      </form>
    </div>
  );
}
