import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Gestão Loja 3D", description: "Pedidos, produção, margens e estoque" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="antialiased">{children}</body>
    </html>
  );
}
