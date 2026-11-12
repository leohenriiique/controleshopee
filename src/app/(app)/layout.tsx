"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

const NAV = [
  { href: "/", label: "Painel", icon: "◧" },
  { href: "/pedidos", label: "Pedidos", icon: "▤" },
  { href: "/producao", label: "Fila de produção", icon: "⚙" },
  { href: "/produtos", label: "Produtos e margens", icon: "◆" },
  { href: "/estoque", label: "Estoque e compras", icon: "▦" },
  { href: "/financeiro", label: "Financeiro", icon: "$" },
  { href: "/configuracoes", label: "Configurações", icon: "⚑" },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const r = useRouter();
  const [ok, setOk] = useState(false);
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) r.replace("/login");
      else setOk(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      if (!s) r.replace("/login");
    });
    return () => sub.subscription.unsubscribe();
  }, [r]);

  useEffect(() => setMenu(false), [path]);

  if (!ok) return <div className="p-10 text-center text-sm text-zinc-400">Carregando…</div>;

  const ativo = (h: string) => (h === "/" ? path === "/" : path.startsWith(h));

  return (
    <div className="min-h-screen md:flex">
      <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-4 py-3 md:hidden">
        <span className="font-semibold">Gestão Loja 3D</span>
        <button onClick={() => setMenu(!menu)} className="text-xl" aria-label="Menu">☰</button>
      </header>
      <aside className={`${menu ? "block" : "hidden"} border-r border-zinc-200 bg-white md:sticky md:top-0 md:block md:h-screen md:w-60 md:shrink-0`}>
        <div className="hidden px-5 py-5 md:block">
          <div className="text-lg font-semibold">Gestão Loja 3D</div>
          <div className="text-xs text-zinc-500">Shopee · impressão 3D</div>
        </div>
        <nav className="space-y-0.5 px-3 pb-4">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${ativo(n.href) ? "bg-orange-50 font-medium text-orange-700" : "text-zinc-600 hover:bg-zinc-50"}`}
            >
              <span className="w-4 text-center">{n.icon}</span>
              {n.label}
            </Link>
          ))}
          <button
            onClick={() => supabase.auth.signOut()}
            className="mt-4 w-full rounded-lg px-3 py-2 text-left text-sm text-zinc-400 hover:bg-zinc-50"
          >
            Sair
          </button>
        </nav>
      </aside>
      <main className="min-w-0 flex-1 p-4 md:p-8">{children}</main>
    </div>
  );
}
