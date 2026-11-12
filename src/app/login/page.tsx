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
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
    setBusy(false);
    if (error) setErro("E-mail ou senha inválidos.");
    else r.replace("/");
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
